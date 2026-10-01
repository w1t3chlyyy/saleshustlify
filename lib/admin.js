const { db, kb, bustSettings, setting, parseLessonRow } = require('./db');
const { tg } = require('./telegram');
const { adminAgent } = require('./qwen');

const PRODUCTS = process.env.PRODUCTS_TABLE || 'products';
const CASES = PRODUCTS; // кейсы лежат в той же таблице, колонка section = 'case'
const TABLES = ['users', 'lessons', 'lesson_progress', 'quizzes', 'practice_sessions', 'leads', 'businesses',
  'assignments', 'sales', 'coin_ledger', 'shop_items', 'purchases', 'settings', 'broadcasts', 'audit_log', 'promo_codes',
  'video_tasks', 'video_submissions', 'plan_requests', PRODUCTS];

const lastUploadedByAdmin = new Map();

const SYSTEM = `Ты — HustlifyAI, секретный ИИ-администратор платформы отдела продаж Hustlify (Telegram-бот + мини-приложение). Ты говоришь только с администратором и имеешь полный доступ ко всем данным через инструменты.

Данные (таблицы Supabase):
- users(id, tg_id, login, full_name, role[intern|manager|admin], position, coins, balance, earned_total, tags[], training_done, city, percent_boost, boost_until, is_blocked, track[seller|promoter], plan[worker|pro]) — track это выбранная роль ('seller' — продающий, 'promoter' — продвигающий), plan это тариф продвигающих
- lessons(id, position, title, body[markdown и/или фото], is_published, audience[all|seller|promoter]) — разделы обучения и методичка. У продающих (audience='seller') и продвигающих (audience='promoter') разные разделы (плюс общие с audience='all'). В разделе вместо текста (или вместе с текстом) могут быть одна или несколько фотографий. Для просмотра, создания, редактирования и удаления разделов ВСЕГДА используй специальные инструменты list_lessons, save_lesson, delete_lesson!
- lesson_progress, quizzes, practice_sessions — прохождение обучения и практики
- leads(user_id, name, contact, niche, notes, status) — клиенты сотрудников
- businesses(city, name, category, address, phone, info, contacts jsonb) — база бизнесов без сайта
- assignments(user_id, business_id, day, status[assigned|in_work|submitted|approved|rejected], proof_text, reviewer_note, coins_awarded) — работа по базе: статусы assigned (предложен), in_work (взят в работу), submitted, approved, rejected
- sales(user_id, business_id, amount, percent, payout) — продажи и выплаты
- coin_ledger — журнал коинов; shop_items(title, description, price, kind[promo|boost|custom], payload, stock, is_active) — магазин; purchases
- promo_codes(item_id, code, is_used, used_by, used_at) — промокоды товаров магазина (kind=promo). Покупатель получает один свободный код автоматически; пока свободных кодов нет, товар скрыт из магазина
- video_tasks(id, title, brief, kind[test|work], min_plan[worker|pro], reward_money, reward_coins, deadline, is_active) — видео-задания для продвигающих в базе данных: kind='test' — тестовое видео перед допуском в кабинет, kind='work' — рабочие видео-задания. Для управления ими используй list_video_tasks, save_video_task, delete_video_task
- video_submissions(task_id, user_id, video_url, status, reviewer_note, money_awarded, coins_awarded) — НЕ менять статус через db_update: проверка и выплата идут через вкладку «Проверка»
- plan_requests(user_id, portfolio_url, note, status) — заявки на Pro, решает вкладка «Проверка»
- settings(key, value): training_reward_coins, lesson_reward_coins (коины за раздел обучения), mentor_username (Telegram-юзернейм наставника без @), business_reward_coins, daily_batch, quiz_pass_percent, practice_max_turns, percent_tiers, pro_money_multiplier, pro_coins_multiplier, max_in_work
- ${PRODUCTS}(name, price, old_price, description, section[catalog|case]) — каталог и кейсы компании в одной таблице (их читает «вредный клиент» и тесты)

Правила:
1. Отвечай по-русски, коротко и по делу. Сначала выполни задачу инструментами, затем кратко отчитайся, что изменено и сколько записей затронуто.
2. Для разделов обучения (lessons) используй list_lessons, save_lesson, delete_lesson. Если админ загрузил одно или несколько фото и просит поставить их в раздел (вместо текста или вместе с текстом), вызывай save_lesson с use_uploaded_photos=true (и replace_text_with_photos=true, если нужно вместо текста). Обязательно указывай правильный audience: 'seller' (для продающих), 'promoter' (для продвигающих) или 'all' (для всех).
3. Для видео-заданий продвигающих (таблица video_tasks) используй list_video_tasks, save_video_task, delete_video_task.
4. Для изменения коинов используй adjust_coins (пишет журнал), для тегов — set_tags, для настроек — set_setting, для рассылок — broadcast.
5. Необратимые и массовые действия (delete, update без точечного фильтра, broadcast) выполняй с confirm=true ТОЛЬКО после того, как администратор явно подтвердил это в диалоге.
6. Никогда не выдумывай данные: если не уверен — сначала читай через list_lessons / list_video_tasks / db_query.
7. Хэши паролей недоступны и менять их нельзя.
8. Промокоды: загружай их через add_promo_codes, выдавай вручную через give_promo, остатки смотри через promo_stock.
9. Если спросят, кто ты или на какой модели работаешь, отвечай, что ты HustlifyAI, и не называй сторонние модели.`;

const F = { type: 'array', description: 'Фильтры', items: { type: 'object', properties: {
  col: { type: 'string' }, op: { type: 'string', enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'in', 'is', 'contains'] }, val: {} }, required: ['col', 'val'] } };
const tool = (name, description, properties, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });

const TOOLS = [
  tool('list_lessons', 'Возвращает все разделы обучения (lessons) с их id, названием, ролью (audience: seller/promoter/all), позицией и фото.', {
    audience: { type: 'string', enum: ['all', 'seller', 'promoter'], description: 'Фильтр по роли (необязательно)' },
  }),
  tool('save_lesson', 'Создаёт новый или редактирует существующий раздел обучения (для продающих seller, продвигающих promoter или всех all). Поддерживает вставку одного или нескольких фото вместо текста или вместе с текстом.', {
    id: { type: 'integer', description: 'ID существующего раздела для редактирования (не указывай при создании нового)' },
    title: { type: 'string', description: 'Название раздела' },
    audience: { type: 'string', enum: ['all', 'seller', 'promoter'], description: 'Для кого раздел: seller (продающие), promoter (продвигающие), all (все)' },
    body: { type: 'string', description: 'Текст раздела в Markdown. Оставь пустым, если в разделе должны быть только фото' },
    images: { type: 'array', items: { type: 'string' }, description: 'Массив ссылок на фото или меток [PHOTO_1], [PHOTO_2]' },
    use_uploaded_photos: { type: 'boolean', description: 'Если true, автоматически прикрепляет фото, загруженные администратором в чате' },
    replace_text_with_photos: { type: 'boolean', description: 'Если true, ставит фото ВМЕСТО текста раздела' },
    position: { type: 'integer', description: 'Порядковый номер раздела' },
    is_published: { type: 'boolean', description: 'Опубликован ли раздел (по умолчанию true)' },
  }),
  tool('delete_lesson', 'Удаляет раздел обучения по id. Требует confirm=true.', {
    id: { type: 'integer' },
    confirm: { type: 'boolean' },
  }, ['id', 'confirm']),
  tool('list_video_tasks', 'Возвращает все видео-задания для продвигающих из таблицы video_tasks (как тестовое kind=test, так и рабочие kind=work).', {}),
  tool('save_video_task', 'Создаёт или редактирует видео-задание для продвигающих в таблице video_tasks.', {
    id: { type: 'integer', description: 'ID задания для редактирования (не указывай при создании нового)' },
    title: { type: 'string', description: 'Название задания' },
    brief: { type: 'string', description: 'Описание / ТЗ задания в Markdown' },
    kind: { type: 'string', enum: ['test', 'work'], description: 'test — тестовое видео для допуска, work — рабочее задание' },
    min_plan: { type: 'string', enum: ['worker', 'pro'], description: 'worker — доступно всем, pro — только для тарифа Pro' },
    reward_money: { type: 'number', description: 'Оплата в рублях' },
    reward_coins: { type: 'integer', description: 'Награда в HustlifyCoin' },
    deadline: { type: 'string', description: 'Дедлайн в ISO или пусто' },
    is_active: { type: 'boolean', description: 'Активно ли задание' },
  }),
  tool('delete_video_task', 'Удаляет видео-задание для продвигающих по id. Требует confirm=true.', {
    id: { type: 'integer' },
    confirm: { type: 'boolean' },
  }, ['id', 'confirm']),
  tool('db_query', 'Читает строки таблицы. Вернёт не более 100 строк.', { table: { type: 'string', enum: TABLES }, select: { type: 'string' }, filters: F, order: { type: 'string', description: 'колонка' }, desc: { type: 'boolean' }, limit: { type: 'integer' } }, ['table']),
  tool('db_count', 'Считает строки по фильтрам.', { table: { type: 'string', enum: TABLES }, filters: F }, ['table']),
  tool('db_insert', 'Добавляет строки.', { table: { type: 'string', enum: TABLES }, rows: { type: 'array', items: { type: 'object', additionalProperties: true } } }, ['table', 'rows']),
  tool('db_update', 'Обновляет строки по фильтрам (фильтры обязательны).', { table: { type: 'string', enum: TABLES }, filters: F, patch: { type: 'object', additionalProperties: true }, confirm: { type: 'boolean' } }, ['table', 'filters', 'patch']),
  tool('db_delete', 'Удаляет строки по фильтрам. Только с confirm=true после подтверждения админа.', { table: { type: 'string', enum: TABLES }, filters: F, confirm: { type: 'boolean' } }, ['table', 'filters', 'confirm']),
  tool('stats', 'Сводная статистика платформы.', {}),
  tool('adjust_coins', 'Начисляет или списывает HustlifyCoin пользователю (логин или id).', { user: { type: 'string' }, delta: { type: 'integer' }, reason: { type: 'string' } }, ['user', 'delta', 'reason']),
  tool('set_tags', 'Добавляет/убирает теги пользователя.', { user: { type: 'string' }, add: { type: 'array', items: { type: 'string' } }, remove: { type: 'array', items: { type: 'string' } } }, ['user']),
  tool('set_setting', 'Меняет настройку платформы.', { key: { type: 'string' }, value: {} }, ['key', 'value']),
  tool('add_promo_codes', 'Добавляет промокоды к товару магазина (kind=promo). item — id или название. Если товара нет и указана price, он будет создан.', { item: { type: 'string' }, codes: { type: 'array', items: { type: 'string' } }, price: { type: 'integer', description: 'цена в коинах, только для нового товара' }, description: { type: 'string' }, discount_percent: { type: 'integer' } }, ['item', 'codes']),
  tool('give_promo', 'Выдаёт сотруднику свободный промокод товара бесплатно и отправляет ему в Telegram.', { user: { type: 'string' }, item: { type: 'string' } }, ['user', 'item']),
  tool('promo_stock', 'Остатки промокодов по товарам: свободные и выданные.', {}),
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

async function findItem(ref) {
  const r = String(ref).trim();
  if (/^\d+$/.test(r)) return (await db.from('shop_items').select('*').eq('id', Number(r)).maybeSingle()).data;
  const { data } = await db.from('shop_items').select('*').ilike('title', '%' + r.replace(/[%_]/g, '') + '%').limit(5);
  if ((data || []).length > 1) {
    const exact = data.find(i => i.title.toLowerCase() === r.toLowerCase());
    if (exact) return exact;
    throw new Error('Несколько товаров подходят: ' + data.map(i => `${i.id}: ${i.title}`).join('; ') + '. Уточни id.');
  }
  return data?.[0] || null;
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
const client = t => (t === PRODUCTS ? kb : db);

function normAudience(v) {
  const s = String(v || '').trim().toLowerCase();
  if (['seller', 'sales', 'продавец', 'продающий', 'продающие', 'продажи', 'я продаю'].includes(s)) return 'seller';
  if (['promoter', 'promo', 'промоутер', 'продвигающий', 'продвигающие', 'продвижение', 'я продвигаю'].includes(s)) return 'promoter';
  if (['all', 'все', 'общий', 'общие'].includes(s)) return 'all';
  return undefined;
}

function resolvePhotoRefs(str, refs = []) {
  let out = String(str || '');
  refs.forEach((ref, i) => {
    const n = i + 1;
    out = out
      .replace(new RegExp(`\\[(?:PHOTO|ФОТО)_?${n}\\]`, 'gi'), ref)
      .replace(new RegExp(`\\b(?:PHOTO|ФОТО)_${n}\\b`, 'gi'), ref);
  });
  return out;
}

function buildLessonBody({ body, images, replace_text_with_photos, audience }, refs = []) {
  let text = resolvePhotoRefs(body ?? '', refs)
    .replace(/^<!--audience:(?:all|seller|promoter)-->\n?/i, '')
    .trim();
  const imgList = (Array.isArray(images) ? images : [])
    .map(u => resolvePhotoRefs(u, refs).trim())
    .filter(Boolean);
  const imgMd = imgList.map((u, i) => `![Фото ${i + 1}](${u})`).join('\n\n');
  let content = text;
  if (replace_text_with_photos && imgMd) {
    content = imgMd;
  } else if (imgMd) {
    content = content ? `${content}\n\n${imgMd}` : imgMd;
  }
  const aud = normAudience(audience) || 'all';
  return { aud, content, withPrefix: `<!--audience:${aud}-->\n${content}` };
}

async function insertLessonRow(row, refs = []) {
  const { aud, withPrefix } = buildLessonBody(row, refs);
  const base = {
    title: String(row.title || 'Новый раздел').trim(),
    body: withPrefix,
    position: row.position != null ? Number(row.position) : 1,
    is_published: row.is_published !== undefined ? !!row.is_published : true,
  };
  let res = await db.from('lessons').insert({ ...base, audience: aud }).select();
  if (res.error && /audience/i.test(res.error.message)) {
    res = await db.from('lessons').insert(base).select();
  }
  if (res.error) throw new Error(res.error.message);
  return (res.data || []).map(parseLessonRow);
}

async function updateLessonRow(id, patch, existing, refs = []) {
  const cur = parseLessonRow(existing || {});
  const aud = normAudience(patch.audience) || cur.audience || 'all';
  const hasNewPhotos = (Array.isArray(patch.images) && patch.images.length > 0);
  let nextBody;
  if (patch.body !== undefined || hasNewPhotos) {
    const baseText = patch.replace_text_with_photos ? '' : (patch.body !== undefined ? patch.body : cur.body);
    nextBody = buildLessonBody({
      body: baseText,
      images: patch.images,
      replace_text_with_photos: patch.replace_text_with_photos,
      audience: aud,
    }, refs).withPrefix;
  } else {
    nextBody = `<!--audience:${aud}-->\n${cur.body || ''}`;
  }
  const basePatch = { body: nextBody };
  if (patch.title !== undefined) basePatch.title = String(patch.title).trim();
  if (patch.position !== undefined) basePatch.position = Number(patch.position);
  if (patch.is_published !== undefined) basePatch.is_published = !!patch.is_published;

  let res = await db.from('lessons').update({ ...basePatch, audience: aud }).eq('id', id).select();
  if (res.error && /audience/i.test(res.error.message)) {
    res = await db.from('lessons').update(basePatch).eq('id', id).select();
  }
  if (res.error) throw new Error(res.error.message);
  return (res.data || []).map(parseLessonRow);
}

async function runTool(admin, name, a, refs = []) {
  const audit = (extra = {}) => db.from('audit_log').insert({ admin_id: admin.id, action: name, payload: { ...a, ...extra } });

  switch (name) {
    case 'list_lessons': {
      const { data, error } = await db.from('lessons').select('*').order('position').order('id');
      if (error) throw new Error(error.message);
      const filterAud = normAudience(a.audience);
      const rows = (data || []).map(parseLessonRow)
        .filter(r => !filterAud || r.audience === filterAud)
        .map(r => {
          const photos = [...String(r.body || '').matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(m => m[1]);
          return {
            id: r.id,
            position: r.position,
            title: r.title,
            audience: r.audience,
            is_published: r.is_published,
            photos_count: photos.length,
            photos,
            body: r.body,
          };
        });
      return { count: rows.length, lessons: rows };
    }
    case 'save_lesson': {
      const images = [
        ...(Array.isArray(a.images) ? a.images : []),
        ...(a.use_uploaded_photos || (a.replace_text_with_photos && !(a.images && a.images.length)) ? refs : []),
      ];
      const uniqueImages = [...new Set(images)];
      let target = null;
      if (a.id != null) {
        const { data } = await db.from('lessons').select('*').eq('id', Number(a.id)).maybeSingle();
        if (!data) throw new Error('Раздел с id=' + a.id + ' не найден');
        target = data;
      } else if (a.title) {
        const { data: all } = await db.from('lessons').select('*').order('position').order('id');
        const aud = normAudience(a.audience);
        target = (all || []).map(parseLessonRow).find(l =>
          l.title.trim().toLowerCase() === String(a.title).trim().toLowerCase() &&
          (!aud || l.audience === aud)
        ) || null;
      }
      if (target) {
        const updated = await updateLessonRow(target.id, { ...a, images: uniqueImages }, target, refs);
        await audit({ lesson_id: target.id, mode: 'update' });
        return { mode: 'updated', lesson: updated[0] };
      }
      const { data: existingAll } = await db.from('lessons').select('position');
      const maxPos = (existingAll || []).reduce((m, r) => Math.max(m, Number(r.position) || 0), 0);
      const created = await insertLessonRow({
        ...a,
        position: a.position != null ? a.position : maxPos + 1,
        images: uniqueImages,
      }, refs);
      await audit({ lesson_id: created[0]?.id, mode: 'insert' });
      return { mode: 'created', lesson: created[0] };
    }
    case 'delete_lesson': {
      if (!a.confirm) return { needs_confirm: true, message: 'Подтверди удаление раздела у администратора (confirm=true).' };
      const { data, error } = await db.from('lessons').delete().eq('id', Number(a.id)).select();
      if (error) throw new Error(error.message);
      await audit({ deleted_id: a.id });
      return { deleted: (data || []).length };
    }
    case 'list_video_tasks': {
      const { data, error } = await db.from('video_tasks').select('*').order('id');
      if (error) throw new Error(error.message);
      return { count: (data || []).length, tasks: data || [] };
    }
    case 'save_video_task': {
      const patch = {};
      if (a.title !== undefined) patch.title = String(a.title).trim();
      if (a.brief !== undefined) patch.brief = resolvePhotoRefs(a.brief, refs);
      if (a.kind !== undefined) patch.kind = a.kind === 'test' ? 'test' : 'work';
      if (a.min_plan !== undefined) patch.min_plan = a.min_plan === 'pro' ? 'pro' : 'worker';
      if (a.reward_money !== undefined) patch.reward_money = Number(a.reward_money) || 0;
      if (a.reward_coins !== undefined) patch.reward_coins = Number(a.reward_coins) || 0;
      if (a.deadline !== undefined) patch.deadline = a.deadline || null;
      if (a.is_active !== undefined) patch.is_active = !!a.is_active;

      if (a.id != null) {
        const { data, error } = await db.from('video_tasks').update(patch).eq('id', Number(a.id)).select();
        if (error) throw new Error(error.message);
        await audit({ task_id: a.id, mode: 'update' });
        return { mode: 'updated', task: data?.[0] || null };
      }
      const row = {
        title: patch.title || 'Видео-задание',
        brief: patch.brief || '',
        kind: patch.kind || 'work',
        min_plan: patch.min_plan || 'worker',
        reward_money: patch.reward_money ?? 0,
        reward_coins: patch.reward_coins ?? 0,
        deadline: patch.deadline ?? null,
        is_active: patch.is_active ?? true,
      };
      const { data, error } = await db.from('video_tasks').insert(row).select();
      if (error) throw new Error(error.message);
      await audit({ task_id: data?.[0]?.id, mode: 'insert' });
      return { mode: 'created', task: data?.[0] || null };
    }
    case 'delete_video_task': {
      if (!a.confirm) return { needs_confirm: true, message: 'Подтверди удаление видео-задания у администратора (confirm=true).' };
      const { data, error } = await db.from('video_tasks').delete().eq('id', Number(a.id)).select();
      if (error) throw new Error(error.message);
      await audit({ deleted_id: a.id });
      return { deleted: (data || []).length };
    }
    case 'db_query': {
      assertTable(a.table);
      if (a.table === 'lessons') {
        const { data, error } = await db.from('lessons').select('*').order('position').order('id');
        if (error) throw new Error(error.message);
        let rows = (data || []).map(parseLessonRow);
        for (const f of a.filters || []) {
          if (f.col === 'audience') rows = rows.filter(r => r.audience === normAudience(f.val));
          else if (f.col === 'id') rows = rows.filter(r => Number(r.id) === Number(f.val));
          else if (f.col === 'is_published') rows = rows.filter(r => Boolean(r.is_published) === Boolean(f.val));
        }
        return { rows: rows.slice(0, Math.min(a.limit || 50, 100)), count: rows.length };
      }
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
      if (a.table === 'lessons') {
        const out = [];
        for (const r of a.rows || []) {
          const ins = await insertLessonRow(r, refs);
          out.push(...ins);
        }
        await audit({ affected: out.length });
        return { inserted: out.length, rows: out.slice(0, 10) };
      }
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
      if (a.table === 'lessons') {
        const { data: all } = await db.from('lessons').select('*');
        let matches = (all || []).map(parseLessonRow);
        for (const f of a.filters) {
          if (f.col === 'id') matches = matches.filter(r => Number(r.id) === Number(f.val));
          else if (f.col === 'audience') matches = matches.filter(r => r.audience === normAudience(f.val));
          else if (f.col === 'title') matches = matches.filter(r => String(r.title).toLowerCase().includes(String(f.val).toLowerCase()));
        }
        if (matches.length > 5 && !a.confirm) return { needs_confirm: true, would_affect: matches.length, message: 'Массовое изменение. Запроси подтверждение у админа.' };
        for (const m of matches) await updateLessonRow(m.id, a.patch, m, refs);
        await audit({ affected: matches.length });
        return { updated: matches.length };
      }
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
    case 'add_promo_codes': {
      const codes = [...new Set((a.codes || []).map(c => String(c).trim()).filter(Boolean))].slice(0, 500);
      if (!codes.length) throw new Error('Нет кодов для добавления');
      if (codes.some(c => c.length > 64)) throw new Error('Код длиннее 64 символов');
      let item = await findItem(a.item);
      if (!item) {
        if (!a.price) throw new Error('Товар «' + a.item + '» не найден. Укажи price, чтобы создать его');
        const ins = await db.from('shop_items').insert({
          title: String(a.item).slice(0, 120), description: a.description || null, price: a.price, kind: 'promo',
          payload: a.discount_percent ? { discount_percent: a.discount_percent } : {},
        }).select().single();
        if (ins.error) throw new Error(ins.error.message);
        item = ins.data;
      }
      if (item.kind !== 'promo') throw new Error('Товар «' + item.title + '» не типа promo');
      const { data, error } = await db.from('promo_codes')
        .upsert(codes.map(code => ({ item_id: item.id, code })), { onConflict: 'item_id,code', ignoreDuplicates: true }).select();
      if (error) throw new Error(error.message);
      const { count } = await db.from('promo_codes').select('*', { count: 'exact', head: true }).eq('item_id', item.id).eq('is_used', false);
      await audit({ item_id: item.id, added: data.length, codes: undefined });
      return { item_id: item.id, title: item.title, price: item.price, added: data.length, skipped_duplicates: codes.length - data.length, free_now: count };
    }
    case 'give_promo': {
      const u = await findUser(a.user);
      const item = await findItem(a.item);
      if (!item) throw new Error('Товар не найден: ' + a.item);
      const c = await db.rpc('claim_promo', { p_item: item.id, p_user: u.id });
      if (c.error) throw new Error(c.error.message);
      if (!c.data) throw new Error('Свободных кодов для «' + item.title + '» нет');
      await db.from('purchases').insert({ user_id: u.id, item_id: item.id, title: item.title, price: 0, result: { code: c.data, discount_percent: item.payload?.discount_percent, gift: true } });
      await tg('sendMessage', { chat_id: u.tg_id, text: `Вам выдан промокод «${item.title}»: ${c.data}` }).catch(() => null);
      await audit({ user_id: u.id, item_id: item.id });
      return { login: u.login, item: item.title, code: c.data };
    }
    case 'promo_stock': {
      const [{ data: items }, { data: codes }] = await Promise.all([
        db.from('shop_items').select('id,title,price').eq('kind', 'promo'),
        db.from('promo_codes').select('item_id,is_used').limit(20000),
      ]);
      return { items: (items || []).map(i => {
        const mine = (codes || []).filter(c => c.item_id === i.id);
        return { id: i.id, title: i.title, price: i.price, free: mine.filter(c => !c.is_used).length, issued: mine.filter(c => c.is_used).length };
      }) };
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

async function uploadAdminImages(adminId, images = []) {
  const refs = [];
  for (let i = 0; i < Math.min(images.length, 10); i++) {
    const raw = String(images[i] || '');
    const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(raw);
    if (!m) continue;
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 4e6) continue;
    const ext = m[1].split('/')[1];
    const path = `lessons/${Date.now()}-${i + 1}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
    const up = await db.storage.from('proofs').upload(path, buf, { contentType: m[1], upsert: true });
    if (up.error) throw new Error('Ошибка загрузки фото: ' + up.error.message);
    refs.push('storage:' + path);
  }
  if (refs.length) lastUploadedByAdmin.set(adminId, refs);
  return refs;
}

async function chatWithAdminAgent(admin, history, images = []) {
  const uploadedRefs = await uploadAdminImages(admin.id, Array.isArray(images) ? images : []);
  const activeRefs = uploadedRefs.length ? uploadedRefs : (lastUploadedByAdmin.get(admin.id) || []);
  const clean = (history || []).slice(-20)
    .filter(m => ['user', 'assistant'].includes(m.role) && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (uploadedRefs.length && clean.length) {
    const last = clean[clean.length - 1];
    if (last.role === 'user') {
      const tags = uploadedRefs.map((_, i) => `[PHOTO_${i + 1}]`).join(', ');
      last.content += `\n\n[Администратор прикрепил фото (${uploadedRefs.length} шт.): ${tags}. Чтобы поставить эти фото в раздел обучения вместо текста (или вместе с текстом), вызови инструмент save_lesson с use_uploaded_photos=true и replace_text_with_photos=true (если нужно вместо текста), указав нужный audience ('seller' для продающих, 'promoter' для продвигающих, 'all' для всех).]`;
    }
  }
  return adminAgent(SYSTEM, clean, TOOLS, (n, a) => runTool(admin, n, a, activeRefs));
}

module.exports = { chatWithAdminAgent, stats, PRODUCTS, CASES };
