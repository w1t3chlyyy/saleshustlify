const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

function createMockDb() {
  console.warn('[AI Studio] SUPABASE_URL not configured — using in-memory database mock');
  const seq = {
    lessons: 2,
    leads: 1,
    businesses: 4,
    assignments: 1,
    sales: 1,
    coin_ledger: 1,
    shop_items: 6,
    purchases: 1,
    broadcasts: 1,
    audit_log: 1,
    video_tasks: 3,
    video_submissions: 1,
    plan_requests: 1,
  };

  const tables = {
    users: [],
    lessons: [
      {
        id: 1,
        position: 1,
        title: 'О компании и продукте',
        body: '# Hustlify\n\nМы помогаем локальному бизнесу получать клиентов через современные сайты и цифровые инструменты.\n\n## Что важно запомнить\n- Мы продаём результат (заявки и выручку), а не просто функции\n- Всегда начинай с вопроса о бизнесе клиента и его текущей ситуации\n- Честность и конкретика важнее навязчивых скидок',
        is_published: true,
        audience: 'all',
        created_at: new Date().toISOString(),
      },
    ],
    lesson_progress: [],
    quizzes: [],
    practice_sessions: [],
    leads: [],
    businesses: [
      {
        id: 1,
        city: 'Казань',
        city_key: 'казань',
        name: 'Кофейня «Утро»',
        category: 'cafe',
        address: 'ул. Баумана, 24',
        phone: '+7 917 000-11-22',
        contacts: { telegram: '@utro_kazan' },
        info: 'Часы работы: 08:00-22:00',
        lat: 55.7903,
        lon: 49.1125,
        source: 'osm',
        ext_id: 'node/101',
        created_at: new Date().toISOString(),
      },
      {
        id: 2,
        city: 'Казань',
        city_key: 'казань',
        name: 'Барбершоп «Стиль»',
        category: 'hairdresser',
        address: 'ул. Пушкина, 12',
        phone: '+7 917 000-33-44',
        contacts: { vk: 'style_kzn' },
        info: 'Часы работы: 10:00-21:00',
        lat: 55.7887,
        lon: 49.1221,
        source: 'osm',
        ext_id: 'node/102',
        created_at: new Date().toISOString(),
      },
      {
        id: 3,
        city: 'Москва',
        city_key: 'москва',
        name: 'Автосервис «МастерПро»',
        category: 'car_repair',
        address: 'ул. Лесная, 15',
        phone: '+7 999 123-45-67',
        contacts: {},
        info: 'Часы работы: 09:00-20:00',
        lat: 55.7788,
        lon: 37.5878,
        source: 'osm',
        ext_id: 'node/103',
        created_at: new Date().toISOString(),
      },
    ],
    assignments: [],
    sales: [],
    coin_ledger: [],
    shop_items: [
      { id: 1, title: 'Промокод на скидку 10%', description: 'Скидка 10% на сервис Hustlify для твоего клиента', price: 30, kind: 'promo', payload: { discount_percent: 10 }, stock: null, is_active: true, position: 1 },
      { id: 2, title: 'Промокод на скидку 20%', description: 'Скидка 20% на сервис Hustlify для твоего клиента', price: 70, kind: 'promo', payload: { discount_percent: 20 }, stock: null, is_active: true, position: 2 },
      { id: 3, title: '+2% к ставке на 14 дней', description: 'Твой процент с продаж растёт на 2 п.п.', price: 120, kind: 'boost', payload: { percent: 2, days: 14 }, stock: null, is_active: true, position: 3 },
      { id: 4, title: '+5% к ставке на 7 дней', description: 'Максимальный буст на неделю', price: 200, kind: 'boost', payload: { percent: 5, days: 7 }, stock: null, is_active: true, position: 4 },
      { id: 5, title: 'Личная сессия с руководителем', description: 'Разбор твоих сделок 1 на 1', price: 150, kind: 'custom', payload: {}, stock: 5, is_active: true, position: 5 },
    ],
    purchases: [],
    settings: [
      { key: 'training_reward_coins', value: 20 },
      { key: 'lesson_reward_coins', value: 3 },
      { key: 'business_reward_coins', value: 10 },
      { key: 'daily_batch', value: 15 },
      { key: 'quiz_pass_percent', value: 70 },
      { key: 'practice_max_turns', value: 14 },
      { key: 'percent_tiers', value: [[0, 5], [8, 7], [20, 10], [40, 12]] },
      { key: 'pro_money_multiplier', value: 1.5 },
      { key: 'pro_coins_multiplier', value: 2 },
      { key: 'max_in_work', value: 30 },
    ],
    broadcasts: [],
    audit_log: [],
    promo_codes: [
      { item_id: 1, code: 'HUSTLE10-A1', is_used: false, used_by: null, used_at: null },
      { item_id: 1, code: 'HUSTLE10-B2', is_used: false, used_by: null, used_at: null },
      { item_id: 2, code: 'HUSTLE20-VIP', is_used: false, used_by: null, used_at: null },
    ],
    video_tasks: [
      {
        id: 1,
        title: 'Тестовое видео для допуска',
        brief: '# Задание\n\nСнимите короткий вертикальный ролик (30–60 секунд), в котором покажите, почему локальному бизнесу важно иметь собственный сайт, и приложите ссылку на видео.',
        kind: 'test',
        min_plan: 'worker',
        reward_money: 0,
        reward_coins: 0,
        deadline: null,
        is_active: true,
        created_at: new Date().toISOString(),
      },
      {
        id: 2,
        title: 'Разбор кейса клиента (Reels / Shorts)',
        brief: '# ТЗ на ролик\n\nСнимите динамичный обзор реального кейса Hustlify: как барбершоп увеличил запись на 42% за месяц.',
        kind: 'work',
        min_plan: 'worker',
        reward_money: 500,
        reward_coins: 15,
        deadline: null,
        is_active: true,
        created_at: new Date().toISOString(),
      },
    ],
    video_submissions: [],
    plan_requests: [],
    products: [
      { id: 1, name: 'Лендинг под ключ', price: 25000, old_price: 35000, description: 'Продающий сайт для малого бизнеса за 5 дней с формой заявки и аналитикой', section: 'catalog' },
      { id: 2, name: 'Корпоративный сайт + CRM', price: 55000, old_price: 70000, description: 'Многостраничный сайт с интеграцией Telegram и CRM', section: 'catalog' },
      { id: 3, name: 'Кейс: Барбершоп в Казани', price: 25000, description: 'Рост записей на 42% за первый месяц после запуска сайта', section: 'case' },
    ],
  };

  const files = new Map();

  function getTable(name) {
    if (!tables[name]) tables[name] = [];
    return tables[name];
  }

  function applyRowDefaults(table, row) {
    const r = { ...row };
    if (table === 'users') {
      if (!r.id) r.id = crypto.randomUUID();
      if (r.role === undefined) r.role = 'intern';
      if (r.position === undefined) r.position = 'Стажёр';
      if (r.coins === undefined) r.coins = 0;
      if (r.balance === undefined) r.balance = 0;
      if (r.earned_total === undefined) r.earned_total = 0;
      if (r.tags === undefined) r.tags = [];
      if (r.training_done === undefined) r.training_done = false;
      if (r.percent_boost === undefined) r.percent_boost = 0;
      if (r.is_blocked === undefined) r.is_blocked = false;
      if (r.fail_count === undefined) r.fail_count = 0;
      if (r.track === undefined) r.track = null;
      if (r.plan === undefined) r.plan = 'worker';
      if (!r.created_at) r.created_at = new Date().toISOString();
    } else if (table === 'quizzes' || table === 'practice_sessions') {
      if (!r.id) r.id = crypto.randomUUID();
      if (table === 'practice_sessions' && !r.status) r.status = 'active';
      if (!r.created_at) r.created_at = new Date().toISOString();
    } else if (seq[table] !== undefined) {
      if (!r.id) r.id = seq[table]++;
      if (table === 'lessons') {
        if (r.is_published === undefined) r.is_published = true;
        if (!r.audience) r.audience = 'all';
      }
      if (table === 'assignments' && !r.status) r.status = 'assigned';
      if (table === 'leads' && !r.status) r.status = 'new';
      if (table === 'shop_items' && r.is_active === undefined) r.is_active = true;
      if (table === 'video_tasks') {
        if (r.is_active === undefined) r.is_active = true;
        if (!r.kind) r.kind = 'work';
        if (!r.min_plan) r.min_plan = 'worker';
        if (r.reward_money === undefined) r.reward_money = 0;
        if (r.reward_coins === undefined) r.reward_coins = 0;
      }
      if (table === 'video_submissions' && !r.status) r.status = 'submitted';
      if (table === 'plan_requests' && !r.status) r.status = 'pending';
      if (!r.created_at) r.created_at = new Date().toISOString();
    }
    return r;
  }

  function enrichJoins(table, rows, selectStr) {
    if (!selectStr) return rows;
    return rows.map(r => {
      const copy = { ...r };
      if (selectStr.includes('business:businesses')) {
        copy.business = getTable('businesses').find(b => Number(b.id) === Number(r.business_id)) || null;
      }
      if (selectStr.includes('user:users')) {
        copy.user = getTable('users').find(u => u.id === r.user_id) || null;
      }
      if (selectStr.includes('task:video_tasks')) {
        copy.task = getTable('video_tasks').find(t => Number(t.id) === Number(r.task_id)) || null;
      }
      return copy;
    });
  }

  class QueryBuilder {
    constructor(table) {
      this.table = table;
      this.op = 'select';
      this.selectStr = '*';
      this.selectOpts = {};
      this.filters = [];
      this.orders = [];
      this.limitVal = null;
      this.singleMode = null;
      this.payload = null;
      this.upsertOpts = {};
    }

    select(cols = '*', opts = {}) {
      if (this.op === 'select') {
        this.selectStr = cols;
        this.selectOpts = opts;
      } else {
        this.returnSelect = cols;
      }
      return this;
    }

    insert(rows) {
      this.op = 'insert';
      this.payload = Array.isArray(rows) ? rows : [rows];
      return this;
    }

    update(patch) {
      this.op = 'update';
      this.payload = patch;
      return this;
    }

    upsert(rows, opts = {}) {
      this.op = 'upsert';
      this.payload = Array.isArray(rows) ? rows : [rows];
      this.upsertOpts = opts;
      return this;
    }

    delete() {
      this.op = 'delete';
      return this;
    }

    eq(col, val) { this.filters.push(r => r[col] === val || String(r[col]) === String(val)); return this; }
    neq(col, val) { this.filters.push(r => r[col] !== val); return this; }
    gt(col, val) { this.filters.push(r => r[col] > val); return this; }
    gte(col, val) { this.filters.push(r => r[col] >= val); return this; }
    lt(col, val) { this.filters.push(r => r[col] < val); return this; }
    lte(col, val) { this.filters.push(r => r[col] <= val); return this; }
    like(col, val) {
      const rx = new RegExp('^' + String(val).replace(/%/g, '.*') + '$');
      this.filters.push(r => rx.test(String(r[col] || '')));
      return this;
    }
    ilike(col, val) {
      const rx = new RegExp('^' + String(val).replace(/%/g, '.*') + '$', 'i');
      this.filters.push(r => rx.test(String(r[col] || '')));
      return this;
    }
    in(col, vals) {
      const arr = Array.isArray(vals) ? vals : [vals];
      this.filters.push(r => arr.includes(r[col]));
      return this;
    }
    is(col, val) { this.filters.push(r => r[col] === val || (val === null && r[col] === undefined)); return this; }
    contains(col, vals) {
      const arr = Array.isArray(vals) ? vals : [vals];
      this.filters.push(r => Array.isArray(r[col]) && arr.every(v => r[col].includes(v)));
      return this;
    }
    not(col, op, val) {
      if (op === 'is') this.filters.push(r => !(r[col] === val || (val === null && r[col] === undefined)));
      else this.filters.push(r => r[col] !== val);
      return this;
    }
    or(expr) {
      const parts = String(expr || '').split(',').map(s => s.trim()).filter(Boolean);
      this.filters.push(r => parts.some(p => {
        const [col, op, ...rest] = p.split('.');
        const val = rest.join('.');
        if (op === 'eq') return String(r[col]) === String(val);
        if (op === 'neq') return String(r[col]) !== String(val);
        return false;
      }));
      return this;
    }

    order(col, { ascending = true } = {}) {
      this.orders.push({ col, ascending });
      return this;
    }

    limit(n) {
      this.limitVal = n;
      return this;
    }

    single() {
      this.singleMode = 'single';
      return this;
    }

    maybeSingle() {
      this.singleMode = 'maybeSingle';
      return this;
    }

    _exec() {
      const tbl = getTable(this.table);
      const match = r => this.filters.every(fn => fn(r));

      if (this.op === 'insert') {
        const inserted = [];
        for (const raw of this.payload) {
          if (this.table === 'users') {
            if (tbl.some(u => u.login === raw.login)) {
              return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "users_login_key"' } };
            }
          }
          const item = applyRowDefaults(this.table, raw);
          tbl.push(item);
          inserted.push(item);
        }
        let res = inserted;
        if (this.singleMode) res = inserted[0] || null;
        return { data: res, error: null };
      }

      if (this.op === 'upsert') {
        const upserted = [];
        for (const raw of this.payload) {
          let existing = null;
          if (this.table === 'settings') existing = tbl.find(r => r.key === raw.key);
          else if (this.table === 'lesson_progress') existing = tbl.find(r => r.user_id === raw.user_id && Number(r.lesson_id) === Number(raw.lesson_id));
          else if (this.table === 'promo_codes') existing = tbl.find(r => Number(r.item_id) === Number(raw.item_id) && r.code === raw.code);
          else if (this.table === 'businesses') existing = tbl.find(r => r.source === raw.source && r.ext_id === raw.ext_id);
          else if (this.table === 'video_submissions') existing = tbl.find(r => Number(r.task_id) === Number(raw.task_id) && r.user_id === raw.user_id);
          else if (raw.id !== undefined) existing = tbl.find(r => r.id === raw.id);

          if (existing) {
            if (!this.upsertOpts.ignoreDuplicates) Object.assign(existing, raw);
            upserted.push(existing);
          } else {
            const item = applyRowDefaults(this.table, raw);
            tbl.push(item);
            upserted.push(item);
          }
        }
        let res = upserted;
        if (this.singleMode) res = upserted[0] || null;
        return { data: res, error: null };
      }

      if (this.op === 'update') {
        const updated = [];
        for (const r of tbl) {
          if (match(r)) {
            Object.assign(r, this.payload);
            updated.push({ ...r });
          }
        }
        let res = updated;
        if (this.singleMode) res = updated[0] || null;
        return { data: res, error: null };
      }

      if (this.op === 'delete') {
        const deleted = [];
        for (let i = tbl.length - 1; i >= 0; i--) {
          if (match(tbl[i])) {
            deleted.push(tbl[i]);
            tbl.splice(i, 1);
          }
        }
        return { data: deleted, error: null };
      }

      // select
      let rows = tbl.filter(match);
      const count = rows.length;
      if (this.selectOpts.head) {
        return { data: null, count, error: null };
      }
      for (const { col, ascending } of [...this.orders].reverse()) {
        rows.sort((a, b) => {
          if (a[col] === b[col]) return 0;
          const cmp = a[col] > b[col] ? 1 : -1;
          return ascending ? cmp : -cmp;
        });
      }
      if (this.limitVal !== null) rows = rows.slice(0, this.limitVal);
      rows = enrichJoins(this.table, rows, this.selectStr);

      if (this.singleMode === 'single') {
        if (!rows.length) return { data: null, error: { message: 'Row not found' } };
        return { data: rows[0], error: null };
      }
      if (this.singleMode === 'maybeSingle') {
        return { data: rows[0] || null, error: null };
      }
      return { data: rows, count, error: null };
    }

    then(resolve, reject) {
      try {
        resolve(this._exec());
      } catch (e) {
        if (reject) reject(e);
        else resolve({ data: null, error: e });
      }
    }
  }

  return {
    from: table => new QueryBuilder(table),
    rpc: async (fn, args = {}) => {
      if (fn === 'add_coins') {
        const u = getTable('users').find(x => x.id === args.p_user);
        if (!u || (u.coins || 0) + args.p_delta < 0) return { data: null, error: { message: 'insufficient_coins' } };
        u.coins = (u.coins || 0) + args.p_delta;
        getTable('coin_ledger').push({ id: seq.coin_ledger++, user_id: u.id, delta: args.p_delta, reason: args.p_reason, created_at: new Date().toISOString() });
        return { data: u.coins, error: null };
      }
      if (fn === 'add_money') {
        const u = getTable('users').find(x => x.id === args.p_user);
        if (u) {
          u.balance = Number(u.balance || 0) + Number(args.p_amount || 0);
          if (args.p_amount > 0) u.earned_total = Number(u.earned_total || 0) + Number(args.p_amount);
        }
        return { data: null, error: null };
      }
      if (fn === 'claim_businesses') {
        const cityKey = String(args.p_city || '').trim().toLowerCase();
        const assigns = getTable('assignments');
        const avail = getTable('businesses').filter(b =>
          b.city_key === cityKey &&
          !assigns.some(a =>
            Number(a.business_id) === Number(b.id) &&
            (a.user_id === args.p_user || ['in_work', 'submitted', 'approved'].includes(a.status) || (a.status === 'assigned' && a.day >= args.p_day))
          )
        ).slice(0, args.p_n || 15);
        const created = avail.map(b => {
          const row = applyRowDefaults('assignments', { user_id: args.p_user, business_id: b.id, day: args.p_day, status: 'assigned', coins_awarded: 0 });
          assigns.push(row);
          return row;
        });
        return { data: created, error: null };
      }
      if (fn === 'claim_promo') {
        const codeRow = getTable('promo_codes').find(c => Number(c.item_id) === Number(args.p_item) && !c.is_used);
        if (!codeRow) return { data: null, error: null };
        codeRow.is_used = true;
        codeRow.used_by = args.p_user;
        codeRow.used_at = new Date().toISOString();
        return { data: codeRow.code, error: null };
      }
      return { data: null, error: null };
    },
    storage: {
      from: () => ({
        upload: async (path, buf, opts = {}) => {
          const b64 = Buffer.isBuffer(buf) ? buf.toString('base64') : Buffer.from(buf).toString('base64');
          files.set(path, `data:${opts.contentType || 'image/jpeg'};base64,${b64}`);
          return { data: { path }, error: null };
        },
        createSignedUrl: async (path) => ({
          data: { signedUrl: files.get(path) || '' },
          error: null,
        }),
      }),
    },
  };
}

const db = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : createMockDb();

// Второй проект Supabase: товары, кейсы, цены. Если переменные не заданы, берём основной.
const kb = (process.env.KB_SUPABASE_URL && process.env.KB_SUPABASE_KEY)
  ? createClient(process.env.KB_SUPABASE_URL, process.env.KB_SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : db;

const cache = { t: 0, v: {} };
async function setting(key, def) {
  if (Date.now() - cache.t > 30000) {
    const { data } = await db.from('settings').select('*');
    cache.v = Object.fromEntries((data || []).map(r => [r.key, r.value]));
    cache.t = Date.now();
  }
  return cache.v[key] ?? def;
}
const bustSettings = () => { cache.t = 0; };

class Http extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

module.exports = { db, kb, setting, bustSettings, Http };
