const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { hashPassword } = require('./security');

function createMockDb() {
  console.warn('[AI Studio] SUPABASE_URL not configured — using in-memory database mock');
  const seq = {
    lessons: 3,
    leads: 1,
    businesses: 4,
    assignments: 2,
    sales: 1,
    coin_ledger: 1,
    shop_items: 6,
    purchases: 2,
    broadcasts: 1,
    audit_log: 1,
    video_tasks: 3,
    video_submissions: 2,
    plan_requests: 2,
    payout_requests: 1,
    products: 4,
    quiz_bank: 1,
  };

  const tables = {
    users: [
      {
        id: 'a0000000-0000-0000-0000-000000000001',
        tg_id: 1000001,
        tg_username: 'demo_user',
        login: 'admin',
        pass_hash: hashPassword('admin12345'),
        full_name: 'Администратор Hustlify',
        role: 'admin',
        position: 'Администратор',
        coins: 500,
        balance: 50000,
        earned_total: 150000,
        training_done: true,
        track: 'seller',
        plan: 'pro',
        created_at: new Date().toISOString(),
      },
      {
        id: 'a0000000-0000-0000-0000-000000000002',
        tg_id: 1000002,
        tg_username: 'seller_demo',
        login: 'seller',
        pass_hash: hashPassword('seller12345'),
        full_name: 'Иван Продавец',
        role: 'intern',
        position: 'Менеджер по продажам',
        coins: 85,
        balance: 12500,
        earned_total: 35000,
        training_done: true,
        track: 'seller',
        city: 'Казань',
        plan: 'worker',
        created_at: new Date().toISOString(),
      },
      {
        id: 'a0000000-0000-0000-0000-000000000003',
        tg_id: 1000003,
        tg_username: 'promoter_demo',
        login: 'promoter',
        pass_hash: hashPassword('promoter12345'),
        full_name: 'Ольга Видео',
        role: 'intern',
        position: 'Промоутер Pro',
        coins: 120,
        balance: 18000,
        earned_total: 42000,
        training_done: true,
        track: 'promoter',
        plan: 'pro',
        created_at: new Date().toISOString(),
      },
    ],
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
      {
        id: 2,
        position: 2,
        title: 'Работа с возражениями',
        body: '# Работа с возражениями\n\n## Главные принципы\n- Не спорьте с клиентом\n- Согласитесь с его правом сомневаться и уточните причину\n- Опирайтесь на конкретные кейсы и цифры окупаемости\n\n## Пример\nЕсли клиент говорит «дорого», покажите окупаемость: сайт за 25 000 ₽ окупается уже за 3–5 новых клиентов.',
        is_published: true,
        audience: 'seller',
        created_at: new Date().toISOString(),
      },
    ],
    lesson_progress: [
      { user_id: 'a0000000-0000-0000-0000-000000000002', lesson_id: 1, passed: true, best_score: 100 },
      { user_id: 'a0000000-0000-0000-0000-000000000003', lesson_id: 1, passed: true, best_score: 95 },
    ],
    quizzes: [],
    quiz_bank: [],
    practice_sessions: [],
    leads: [],
    businesses: [
      {
        id: 1,
        city: 'Казань',
        city_key: 'казань',
        name: 'Кафе на Сайдашева',
        category: 'Кафе',
        address: 'Казань, ул. Салиха Сайдашева',
        phone: '+7 843 293-40-27',
        contacts: {},
        info: 'Действующее кафе в Казани без официального сайта.',
        lat: 55.7725,
        lon: 49.1215,
        source: 'osm',
        ext_id: 'osm/node/7711201',
        created_at: new Date().toISOString(),
      },
      {
        id: 2,
        city: 'Казань',
        city_key: 'казань',
        name: 'Автосервис на Родины',
        category: 'Автосервис',
        address: 'Казань, ул. Родины, Азино-2',
        phone: '+7 843 240-25-21',
        contacts: {},
        info: 'Действующий автосервис. Часы работы: Mo-Sa 09:00-19:00',
        lat: 55.7702,
        lon: 49.2009,
        source: 'osm',
        ext_id: 'osm/node/7744399392',
        created_at: new Date().toISOString(),
      },
      {
        id: 3,
        city: 'Москва',
        city_key: 'москва',
        name: 'Fruits & Veges',
        category: 'Кафе',
        address: 'Москва, Нижняя Сыромятническая улица, Бауманка',
        phone: null,
        contacts: {},
        info: 'Действующее кафе на Artplay в Москве. Сайта нет.',
        lat: 55.7535,
        lon: 37.6685,
        source: 'osm',
        ext_id: 'osm/node/991203',
        created_at: new Date().toISOString(),
      },
    ],
    assignments: [
      {
        id: 1,
        user_id: 'a0000000-0000-0000-0000-000000000002',
        business_id: 1,
        day: new Date().toLocaleDateString('en-CA'),
        status: 'submitted',
        proof_text: 'Позвонил в «Кафе на Сайдашева», презентовал услуги Hustlify и обсудил онлайн-заказ. Руководитель заинтересовался сайтом под ключ.',
        coins_awarded: 0,
        submitted_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      },
    ],
    sales: [],
    coin_ledger: [],
    shop_items: [
      { id: 1, title: 'Промокод на скидку 10%', description: 'Скидка 10% на сервис Hustlify для твоего клиента', price: 30, kind: 'promo', payload: { discount_percent: 10 }, stock: null, is_active: true, position: 1 },
      { id: 2, title: 'Промокод на скидку 20%', description: 'Скидка 20% на сервис Hustlify для твоего клиента', price: 70, kind: 'promo', payload: { discount_percent: 20 }, stock: null, is_active: true, position: 2 },
      { id: 3, title: '+2% к ставке на 14 дней', description: 'Твой процент с продаж растёт на 2 п.п.', price: 120, kind: 'boost', payload: { percent: 2, days: 14 }, action_instructions: 'Начислять +2% к ставке на 14 дней. Если продвигающий — уведомить, что у него не процентная ставка.', stock: null, is_active: true, position: 3 },
      { id: 4, title: '+5% к ставке на 7 дней', description: 'Максимальный буст на неделю', price: 200, kind: 'boost', payload: { percent: 5, days: 7 }, action_instructions: 'Начислять +5% к ставке на 7 дней. Если продвигающий — уведомить, что у него не процентная ставка.', stock: null, is_active: true, position: 4 },
      { id: 5, title: 'Личная сессия с руководителем', description: 'Разбор твоих сделок 1 на 1', price: 150, kind: 'custom', payload: { requires_review: true }, action_instructions: 'Требуется вмешательство: админу приходит заявка в раздел «Проверка» для согласования созвона.', stock: 5, is_active: true, position: 5 },
    ],
    purchases: [
      {
        id: 1,
        user_id: 'a0000000-0000-0000-0000-000000000002',
        item_id: 5,
        title: 'Личная сессия с руководителем',
        price: 150,
        status: 'pending',
        instructions: 'Требуется вмешательство: админу приходит заявка в раздел «Проверка» для согласования созвона.',
        result: { status: 'pending', instructions: 'Требуется согласование созвона' },
        created_at: new Date().toISOString(),
      },
    ],
    settings: [
      { key: 'training_reward_coins', value: 20 },
      { key: 'lesson_reward_coins', value: 3 },
      { key: 'business_reward_coins', value: 10 },
      { key: 'daily_batch', value: 15 },
      { key: 'quiz_pass_percent', value: 70 },
      { key: 'practice_max_turns', value: 6 },
      { key: 'percent_tiers', value: [[0, 5], [8, 7], [20, 10], [40, 12]] },
      { key: 'pro_money_multiplier', value: 1.5 },
      { key: 'pro_coins_multiplier', value: 2 },
      { key: 'max_in_work', value: 30 },
      { key: 'base_guide_url', value: 'https://telegra.ph/Kak-rabotat-po-baze-biznesov-Hustlify-10-11' },
      { key: 'no_base_guide_url', value: 'https://telegra.ph/Kak-rabotat-bez-bazy-Hustlify-10-11' },
      { key: 'required_clients_for_base', value: 3 },
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
    video_submissions: [
      {
        id: 1,
        task_id: 2,
        user_id: 'a0000000-0000-0000-0000-000000000003',
        video_url: 'https://youtube.com/shorts/demo123',
        note: 'Смонтировал ролик по кейсу барбершопа: динамичные переходы, субтитры, хук в первые 3 секунды.',
        status: 'submitted',
        money_awarded: 0,
        coins_awarded: 0,
        created_at: new Date().toISOString(),
      },
    ],
    plan_requests: [
      {
        id: 1,
        user_id: 'a0000000-0000-0000-0000-000000000002',
        portfolio_url: 'https://drive.google.com/file/d/demo_portfolio',
        note: 'Опыт монтажа более 2 лет в CapCut и Premiere Pro. Хочу перейти на тариф Pro для выполнения сложных видео.',
        status: 'pending',
        created_at: new Date().toISOString(),
      },
    ],
    products: [
      { id: 1, name: 'Лендинг под ключ', price: 25000, old_price: 35000, description: 'Продающий сайт для малого бизнеса за 5 дней с формой заявки и аналитикой', section: 'catalog' },
      { id: 2, name: 'Корпоративный сайт + CRM', price: 55000, old_price: 70000, description: 'Многостраничный сайт с интеграцией Telegram и CRM', section: 'catalog' },
      { id: 3, name: 'Кейс: Барбершоп в Казани', price: 25000, description: 'Рост записей на 42% за первый месяц после запуска сайта', section: 'case' },
    ],
    payout_requests: [],
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
      if (table === 'payout_requests' && !r.status) r.status = 'pending';
      if (table === 'products') {
        if (!r.section) r.section = 'catalog';
        if (r.is_active === undefined) r.is_active = true;
      }
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
      if (selectStr.includes('item:shop_items')) {
        copy.item = getTable('shop_items').find(i => Number(i.id) === Number(r.item_id)) || null;
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

    eq(col, val) {
      this.filters.push(r => {
        if (val === false) return r[col] === false || r[col] === null || r[col] === undefined;
        if (val === true) return !!r[col];
        return r[col] === val || String(r[col]) === String(val);
      });
      return this;
    }
    neq(col, val) {
      this.filters.push(r => {
        if (val === false) return !!r[col];
        if (val === true) return !r[col];
        return r[col] !== val;
      });
      return this;
    }
    gt(col, val) { this.filters.push(r => r[col] > val); return this; }
    gte(col, val) { this.filters.push(r => r[col] >= val); return this; }
    lt(col, val) { this.filters.push(r => r[col] < val); return this; }
    lte(col, val) { this.filters.push(r => r[col] <= val); return this; }
    like(col, val) {
      const escaped = String(val).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*');
      const rx = new RegExp('^' + escaped + '$');
      this.filters.push(r => rx.test(String(r[col] || '')));
      return this;
    }
    ilike(col, val) {
      const escaped = String(val).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*');
      const rx = new RegExp('^' + escaped + '$', 'i');
      this.filters.push(r => rx.test(String(r[col] || '')));
      return this;
    }
    in(col, vals) {
      const arr = (Array.isArray(vals) ? vals : [vals]).map(v => String(v));
      this.filters.push(r => arr.includes(String(r[col])));
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
          else if (this.table === 'quiz_bank') existing = tbl.find(r => Number(r.lesson_id) === Number(raw.lesson_id) && r.variant === raw.variant);
          else if (this.table === 'products' && raw.id !== undefined) existing = tbl.find(r => Number(r.id) === Number(raw.id));
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
        const rawCity = String(args.p_city || '').trim();
        const cityKey = rawCity.toLowerCase().replace(/^(?:г|гор|город)\.?\s+/i, '');
        const assigns = getTable('assignments');
        const bizList = getTable('businesses');
        const countNeeded = Number(args.p_n) || 15;

               const isMatchCity = b => {
          const bKey = String(b.city_key || b.city || '').toLowerCase();
          return b.source === '2gis' && Number(b.filter_version || 0) >= 2 && (bKey === cityKey || bKey.includes(cityKey) || cityKey.includes(bKey));
        };

        const isUnassigned = b => !assigns.some(a =>
          Number(a.business_id) === Number(b.id) &&
          ((a.user_id === args.p_user && (a.status !== 'assigned' || a.day >= args.p_day)) ||
            (a.user_id !== args.p_user &&
              (['in_work', 'submitted', 'approved'].includes(a.status) || (a.status === 'assigned' && a.day >= args.p_day))))
        );

        let avail = bizList.filter(b => isMatchCity(b) && isUnassigned(b));

        if (avail.length < countNeeded) {
          try {
            const { refillCity } = require('./places');
            await refillCity(rawCity || 'Казань', countNeeded + 20);
          } catch (e) {
            console.warn('[DB] Replenish error:', e.message);
          }
          avail = bizList.filter(b => isMatchCity(b) && isUnassigned(b));
        }

        const selected = avail.slice(0, countNeeded);
        const created = selected.map(b => {
          const stale = assigns.find(a =>
            Number(a.business_id) === Number(b.id) &&
            a.user_id === args.p_user &&
            a.status === 'assigned' &&
            a.day < args.p_day
          );
          if (stale) {
            Object.assign(stale, {
              day: args.p_day,
              status: 'assigned',
              proof_text: null,
              proof_path: null,
              reviewer_note: null,
              coins_awarded: 0,
              taken_at: null,
              submitted_at: null,
              reviewed_at: null,
            });
            return stale;
          }
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
const bustSettings = () => { cache.t = 0; cache.v = {}; };

class Http extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function parseLessonRow(row) {
  if (!row) return row;
  const raw = String(row.body || '');
  const m = /^<!--audience:(all|seller|promoter)-->\n?/i.exec(raw);
  const audience = row.audience || (m ? m[1].toLowerCase() : 'all');
  const body = m ? raw.slice(m[0].length) : raw;
  return { ...row, audience, body };
}

async function resolveLessonBody(rawBody) {
  let body = String(rawBody || '').replace(/^<!--audience:(?:all|seller|promoter)-->\n?/i, '');
  const matches = [...body.matchAll(/storage:([a-zA-Z0-9_./-]+)/g)];
  for (const m of matches) {
    const path = m[1];
    const { data } = await db.storage.from('proofs').createSignedUrl(path, 86400);
    if (data?.signedUrl) body = body.split(m[0]).join(data.signedUrl);
  }
  return body;
}

module.exports = { db, kb, setting, bustSettings, Http, parseLessonRow, resolveLessonBody };
