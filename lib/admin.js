const { db, kb, bustSettings, setting } = require('./db');
const { tg } = require('./telegram');
const { adminAgent } = require('./qwen');

const PRODUCTS = process.env.PRODUCTS_TABLE || 'products';
const CASES = process.env.CASES_TABLE || 'cases';
const TABLES = ['users', 'lessons', 'lesson_progress', 'quizzes', 'practice_sessions', 'leads', 'businesses',
  'assignments', 'sales', 'coin_ledger', 'shop_items', 'purchases', 'settings', 'broadcasts', 'audit_log', PRODUCTS, CASES];

const SYSTEM = `Ты — Hustlify Ops, секретный ИИ-администратор платформы отдела продаж Hustlify (Telegram-бот + мини-приложение). Ты говоришь только с администратором и имеешь полный доступ ко всем данным через инструменты.

Данные (таблицы Supabase):
- users(id, tg_id, login, full_name, role[intern|manager|admin], position, coins, balance, earned_total, tags[], training_done, city, percent_boost, boost_until, is_blocked)
- lessons(id, position, title, body[markdown], is_published) — обучение и методичка
- lesson_progress, quizzes, practice_sessions — прохождение обучения и практики
- leads(user_id, name, contact, niche, notes, status) — клиенты сотрудников
- businesses(city, name, category, address, phone, info) — база бизнесов без сайта
- assignments(user_id, business_id, day, status[assigned|submitted|approved|rejected], proof_text, reviewer_note, coins_awarded) — работа по базе
- sales(user_id, business_id, amount, percent, payout) — продажи и выплаты
- coin_ledger — журнал коинов; shop_items(title, description, price, kind[promo|boost|custom], payload, stock, is_active) — магазин; purchases
- settings(key, value): training_reward_coins, business_reward_coins, daily_batch, quiz_pass_percent, practice_max_turns, percent_tiers
- ${PRODUCTS}, ${CASES} — товары и кейсы компании (их читает «вредный клиент»)

Правила:
1. Отвечай по-русски, коротко и по делу. Сначала выполни задачу инструментами, затем кратко отчитайся, что изменено и сколько записей затронуто.
2. Для изменения коинов используй adjust_coins (пишет журнал), для тегов — set_tags, для настроек — set_setting, для рассылок — broadcast.
3. Необратимые и массовые действия (delete, update без точечного фильтра, broadcast) выполняй с confirm=true ТОЛЬКО после того, как администратор явно подтвердил это в диалоге. Сначала покажи, что именно будет затронуто (через db_query или count), и спроси подтверждение.
4. Никогда не выдумывай данные: если не уверен — сначала читай через db_query.
5. Хэши паролей недоступны и менять их нельзя.`;

const F = { type: 'array', description: 'Фильтры', items: { type: 'object', properties: {
  col: { type: 'string' }, op: { type: 'string', enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'in', 'is', 'contains'] }, val: {} }, required: ['col', 'val'] } };
const tool = (name, description, properties, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });

const TOOLS = [
  tool('db_query', 'Читает строки таблицы. Вернёт не более 100 строк.', { table: { type: 'string', enum: TABLES }, select: { type: 'string' }, filters: F, order: { type: 'string', description: 'колонка' }, desc: { type: 'boolean' }, limit: { type: 'integer' } }, ['table']),
  tool('db_count', 'Считает строки по фильтрам.', { table: { type: 'string', enum: TABLES }, filters: F }, ['table']),
  tool('db_insert', 'Добавляет строки.', { table: { type: 'string', enum: TABLES }, rows: { type: 'array', items: { type: 'object' } } }, ['table', 'rows']),
  tool('db_update', 'Обновляет строки по фильтрам (фильтры обязательны).', { table: { type: 'string', enum: TABLES }, filters: F, patch: { type: 'object' }, confirm: { type: 'boolean' } }, ['table', 'filters', 'patch']),
  tool('db_delete', 'Удаляет строки по фильтрам. Только с confirm=true после подтверждения админа.', { table: { type: 'string', enum: TABLES }, filters: F, confirm: { type: 'boolean' } }, ['table', 'filters', 'confirm']),
  tool('stats', 'Сводная статистика платформы.', {}),
  tool('adjust_coins', 'Начисляет или списывает HustlifyCoin пользователю (логин или id).', { user: { type: 'string' }, delta: { type: 'integer' }, reason: { type: 'string' } }, ['user', 'delta', 'reason']),
  tool('set_tags', 'Добавляет/убирает теги пользователя.', { user: { type: 'string' }, add: { type: 'array', items: { type: 'string' } }, remove: { type: 'array', items: { type: 'string' } } }, ['user']),
  tool('set_setting', 'Меняет настройку платформы.', { key: { type: 'string' }, value: {} }, ['key', 'value']),
  tool('broadcast', 'Рассылка в Telegram. Только с confirm=true. Аудитория: все, по тегу, по роли, прошедшие обучение.', { text: { type: 'string' }, tag: { type: 'string' }, role: { type: 'string' }, trained_only: { type: 'boolean' }, confirm: { type: 'boolean' } }, ['text', 'confirm']),
];

const COL = /^[a-z_][a-z0-9_]*$/i;
function assertTable(t) { if (!TABLES.includes(t)) throw new Error('Таблица недоступна: ' + t); }

function applyFilters(q, filters = []) {
  for (const f of filters) {
    if (!COL.test(f.col)) throw new Error('Плохое имя колонки: ' + f.col);
    const op = f.op || 'eq';
    if (op === 'in') q = q.in(f.col, Array.isArray(f.val) ? f.val : [f.val]);
    else if (op === 'contains') q = q.contains(f.col, Array.isArray(f.val) ? f.val : [f.val]);
    else if (op === 'is') q = q.is(f.col, f.val);
    else if (['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike'].includes(op)) q = q[op](f.col, f.val);
    else throw new Error('Неизвестный оператор: ' + op);
  }
  return q;
}

const strip = rows => (rows || []).map(r => { if (r && 'pass_hash' in r) { const { pass_hash, ...rest } = r; return rest; } return r; });

async function findUser(ref) {
  const col = /^[0-9a-f-]{36}$/i.test(ref) ? 'id' : 'login';
  const { data } = await db.from('users').select('*').eq(col, String(ref).toLowerCase()).maybeSingle();
  if (!data) throw new Error('Пользователь не найден: ' + ref);
  return data;
}

async function stats() {
  const c = async (t, f) => { let q = db.from(t).select('*', { count: 'exact', head: true }); if (f) q = f(q); return (await q).count || 0; };
  const [users, trained, leads, pending, approved, sales] = await Promise.all([
    c('users'), c('users', q => q.eq('training_done', true)), c('leads'),
    c('assignments', q => q.eq('status', 'submitted')), c('assignments', q => q.eq('status', 'approved')),
    db.from('sales').select('amount,payout'),
  ]);
  const s = sales.data || [];
  const { data: u } = await db.from('users').select('coins,balance');
  return {
    users, trained, leads, pending_reviews: pending, approved_businesses: approved,
    sales_count: s.length,
    sales_amount: s.reduce((a, r) => a + Number(r.amount), 0),
    payouts_total: s.reduce((a, r) => a + Number(r.payout), 0),
    coins_in_circulation: (u || []).reduce((a, r) => a + r.coins, 0),
  };
}

// Товары и кейсы живут во втором проекте Supabase, всё остальное в основном
const client = t => (t === PRODUCTS || t === CASES ? kb : db);

async function runTool(admin, name, a) {
  const audit = (extra = {}) => db.from('audit_log').insert({ admin_id: admin.id, action: name, payload: { ...a, ...extra } });

  switch (name) {
    case 'db_query': {
      assertTable(a.table);
      if (a.select && !/^[a-z0-9_,*\s():!.]+$/i.test(a.select)) throw new Error('Плохой select');
      let q = client(a.table).from(a.table).select(a.select || '*');
      q = applyFilters(q, a.filters);
      if (a.order) { if (!COL.test(a.order)) throw new Error('Плохая сортировка'); q = q.order(a.order, { ascending: !a.desc }); }
      const { data, error } = await q.limit(Math.min(a.limit || 50, 100));
      if (error) throw new Error(error.message);
      return { rows: strip(data), count: (data || []).length };
    }
    case 'db_count': {
      assertTable(a.table);
      const { count, error } = await applyFilters(client(a.table).from(a.table).select('*', { count: 'exact', head: true }), a.filters);
      if (error) throw new Error(error.message);
      return { count };
    }
    case 'db_insert': {
      assertTable(a.table);
      if (a.table === 'users') throw new Error('Пользователей создают через регистрацию');
      const { data, error } = await client(a.table).from(a.table).insert(a.rows).select();
      if (error) throw new Error(error.message);
      if (a.table === 'settings') bustSettings();
      await audit({ affected: data.length });
      return { inserted: data.length, rows: strip(data).slice(0, 10) };
    }
    case 'db_update': {
      assertTable(a.table);
      if (!a.filters?.length) throw new Error('Нужен хотя бы один фильтр');
      if ('pass_hash' in (a.patch || {})) throw new Error('Пароли менять нельзя');
      const { count } = await applyFilters(client(a.table).from(a.table).select('*', { count: 'exact', head: true }), a.filters);
      if (count > 5 && !a.confirm) return { needs_confirm: true, would_affect: count, message: 'Массовое изменение. Запроси подтверждение у админа.' };
      const { data, error } = await applyFilters(client(a.table).from(a.table).update(a.patch), a.filters).select();
      if (error) throw new Error(error.message);
      if (a.table === 'settings') bustSettings();
      await audit({ affected: data.length });
      return { updated: data.length };
    }
    case 'db_delete': {
      assertTable(a.table);
      if (!a.filters?.length) throw new Error('Нужен хотя бы один фильтр');
      const { count } = await applyFilters(client(a.table).from(a.table).select('*', { count: 'exact', head: true }), a.filters);
      if (!a.confirm) return { needs_confirm: true, would_delete: count, message: 'Запроси подтверждение у админа.' };
      const { data, error } = await applyFilters(client(a.table).from(a.table).delete(), a.filters).select();
      if (error) throw new Error(error.message);
      await audit({ affected: data.length });
      return { deleted: data.length };
    }
    case 'stats': return stats();
    case 'adjust_coins': {
      const u = await findUser(a.user);
      const { data, error } = await db.rpc('add_coins', { p_user: u.id, p_delta: a.delta, p_reason: 'admin: ' + a.reason });
      if (error) throw new Error(error.message);
      await audit({ user_id: u.id });
      return { login: u.login, coins: data };
    }
    case 'set_tags': {
      const u = await findUser(a.user);
      let tags = new Set(u.tags || []);
      (a.add || []).forEach(t => tags.add(t));
      (a.remove || []).forEach(t => tags.delete(t));
      await db.from('users').update({ tags: [...tags] }).eq('id', u.id);
      await audit({ user_id: u.id });
      return { login: u.login, tags: [...tags] };
    }
    case 'set_setting': {
      await db.from('settings').upsert({ key: a.key, value: a.value });
      bustSettings();
      await audit();
      return { ok: true, key: a.key, value: a.value };
    }
    case 'broadcast': {
      if (!a.confirm) return { needs_confirm: true, message: 'Рассылку нужно подтвердить.' };
      let q = db.from('users').select('id,tg_id').eq('is_blocked', false).not('tg_id', 'is', null);
      if (a.tag) q = q.contains('tags', [a.tag]);
      if (a.role) q = q.eq('role', a.role);
      if (a.trained_only) q = q.eq('training_done', true);
      const { data } = await q.limit(1000);
      let sent = 0, failed = 0;
      for (const u of data || []) {
        const r = await tg('sendMessage', { chat_id: u.tg_id, text: a.text }).catch(() => null);
        r?.ok ? sent++ : failed++;
        await new Promise(r => setTimeout(r, 45));
      }
      await db.from('broadcasts').insert({ text: a.text, audience: { tag: a.tag, role: a.role, trained_only: a.trained_only }, sent, failed });
      await audit({ sent, failed });
      return { sent, failed };
    }
    default: throw new Error('Неизвестный инструмент: ' + name);
  }
}

async function chatWithAdminAgent(admin, history) {
  const clean = (history || []).slice(-20)
    .filter(m => ['user', 'assistant'].includes(m.role) && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
  return adminAgent(SYSTEM, clean, TOOLS, (n, a) => runTool(admin, n, a));
}

module.exports = { chatWithAdminAgent, stats, PRODUCTS, CASES };
