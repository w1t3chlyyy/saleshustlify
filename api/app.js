const { db, kb, setting, Http } = require('../lib/db');
const { hashPassword, checkPassword, signToken, readToken, validateInitData } = require('../lib/security');
const { notify } = require('../lib/telegram');
const qwen = require('../lib/qwen');
const { refillCity } = require('../lib/places');
const { chatWithAdminAgent, stats, PRODUCTS, CASES } = require('../lib/admin');

// ───────── helpers
const pub = u => ({
  id: u.id, login: u.login, full_name: u.full_name, role: u.role, position: u.position,
  coins: u.coins, balance: Number(u.balance), earned_total: Number(u.earned_total),
  training_done: u.training_done, city: u.city, tags: u.tags,
});
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: process.env.TZ_NAME || 'Europe/Moscow' });
const need = (cond, code, msg) => { if (!cond) throw new Http(code, msg); };
const requireTrained = u => need(u.training_done || u.role === 'admin', 403, 'Сначала пройдите обучение и практику');

async function percentFor(u) {
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const { count } = await db.from('assignments').select('*', { count: 'exact', head: true })
    .eq('user_id', u.id).eq('status', 'approved').gte('reviewed_at', since);
  const tiers = await setting('percent_tiers', [[0, 5], [8, 7], [20, 10], [40, 12]]);
  let base = tiers[0]?.[1] ?? 5;
  for (const [n, pc] of tiers) if ((count || 0) >= n) base = pc;
  const boost = u.boost_until && new Date(u.boost_until) > new Date() ? Number(u.percent_boost) : 0;
  const next = tiers.find(([n]) => n > (count || 0)) || null;
  return { percent: base + boost, base, boost, approved30: count || 0, next };
}

async function claim(userId, city, day, n) {
  const { data, error } = await db.rpc('claim_businesses', { p_user: userId, p_city: city, p_day: day, p_n: n });
  if (error) throw error;
  return data?.length || 0;
}

const assignmentView = a => ({
  id: a.id, status: a.status, reviewer_note: a.reviewer_note, proof_text: a.proof_text, day: a.day,
  business: a.business ? { name: a.business.name, category: a.business.category, address: a.business.address, phone: a.business.phone, info: a.business.info } : null,
});

async function loadKnowledge() {
    const [p, c] = await Promise.all([
    kb.from(PRODUCTS).select('*').limit(30),
    kb.from(CASES).select('*').limit(30),
  ]);
  if (p.error || c.error) console.error('knowledge base:', p.error?.message || c.error?.message);
  return { products: p.data || [], cases: c.data || [] };
}

async function lessonsFor(user) {
  const { data: lessons } = await db.from('lessons').select('id,position,title').eq('is_published', true).order('position').order('id');
  const { data: prog } = await db.from('lesson_progress').select('*').eq('user_id', user.id);
  const map = Object.fromEntries((prog || []).map(p => [p.lesson_id, p]));
  let prevPassed = true;
  const items = (lessons || []).map(l => {
    const passed = !!map[l.id]?.passed;
    const unlocked = user.training_done || prevPassed;
    prevPassed = passed;
    return { id: l.id, title: l.title, passed, best_score: map[l.id]?.best_score || 0, unlocked };
  });
  return items;
}

// ───────── handlers
const H = {
  // ── авторизация
  async 'auth.register'({ tgUser }, p) {
    need(tgUser, 401, 'Откройте приложение через Telegram');
    const login = String(p.login || '').trim().toLowerCase();
    const name = String(p.full_name || '').trim();
    const pw = String(p.password || '');
    need(/^[a-z0-9_.]{3,24}$/.test(login), 400, 'Логин: 3–24 символа, латиница, цифры, _ или точка');
    need(name.length >= 2 && name.length <= 60, 400, 'Введите имя и фамилию');
    need(pw.length >= 8 && pw.length <= 100, 400, 'Пароль: минимум 8 символов');
    const admins = (process.env.ADMIN_TG_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    const { data, error } = await db.from('users').insert({
      tg_id: tgUser.id, tg_username: tgUser.username || null, login, pass_hash: hashPassword(pw),
      full_name: name, role: admins.includes(String(tgUser.id)) ? 'admin' : 'intern',
      position: admins.includes(String(tgUser.id)) ? 'Администратор' : 'Стажёр',
      last_seen: new Date().toISOString(),
    }).select().single();
    if (error) {
      if (error.code === '23505') throw new Http(409, /login/.test(error.message) ? 'Этот логин уже занят' : 'Для этого Telegram уже есть аккаунт. Войдите');
      throw error;
    }
    return { token: signToken({ uid: data.id }), user: pub(data) };
  },

  async 'auth.login'({ tgUser }, p) {
    need(tgUser, 401, 'Откройте приложение через Telegram');
    const login = String(p.login || '').trim().toLowerCase();
    const { data: u } = await db.from('users').select('*').eq('login', login).maybeSingle();
    need(u, 401, 'Неверный логин или пароль');
    need(!(u.locked_until && new Date(u.locked_until) > new Date()), 429, 'Слишком много попыток. Повторите через 10 минут');
    if (!checkPassword(String(p.password || ''), u.pass_hash)) {
      const f = (u.fail_count || 0) + 1;
      await db.from('users').update(f >= 5
        ? { fail_count: 0, locked_until: new Date(Date.now() + 10 * 60e3).toISOString() }
        : { fail_count: f }).eq('id', u.id);
      throw new Http(401, 'Неверный логин или пароль');
    }
    need(!u.is_blocked, 403, 'Аккаунт заблокирован');
    need(!u.tg_id || Number(u.tg_id) === tgUser.id, 403, 'Аккаунт привязан к другому Telegram');
    await db.from('users').update({ fail_count: 0, locked_until: null, tg_id: u.tg_id || tgUser.id, tg_username: tgUser.username || u.tg_username, last_seen: new Date().toISOString() }).eq('id', u.id);
    return { token: signToken({ uid: u.id }), user: pub(u) };
  },

  // ── профиль
  async me({ user }) {
    await db.from('users').update({ last_seen: new Date().toISOString() }).eq('id', user.id);
    const pct = await percentFor(user);
    const day = today();
    const { data: todays } = await db.from('assignments').select('status').eq('user_id', user.id).eq('day', day);
    const { count: leads } = await db.from('leads').select('*', { count: 'exact', head: true }).eq('user_id', user.id);
    const { count: won } = await db.from('assignments').select('*', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'approved');
    return {
      user: pub(user), ...pct,
      today_total: todays?.length || 0,
      today_done: (todays || []).filter(a => ['submitted', 'approved'].includes(a.status)).length,
      leads: leads || 0, approved_total: won || 0,
    };
  },

  async top({ user }, { kind }) {
    const col = kind === 'earned' ? 'earned_total' : 'coins';
    const { data } = await db.from('users').select('id,full_name,position,coins,earned_total')
      .eq('is_blocked', false).eq('training_done', true).order(col, { ascending: false }).limit(30);
    const mine = Number(user[col]);
    const { count } = await db.from('users').select('*', { count: 'exact', head: true }).eq('is_blocked', false).eq('training_done', true).gt(col, mine);
    return {
      rows: (data || []).map((r, i) => ({ rank: i + 1, name: r.full_name, position: r.position, value: Number(r[col]), me: r.id === user.id })),
      my_rank: (count || 0) + 1, my_value: mine,
    };
  },

  // ── обучение
  async 'learn.lessons'({ user }) {
    const items = await lessonsFor(user);
    return { items, all_passed: items.length > 0 && items.every(i => i.passed), training_done: user.training_done };
  },

  async 'learn.lesson'({ user }, { id }) {
    const items = await lessonsFor(user);
    const it = items.find(i => i.id === Number(id));
    need(it, 404, 'Урок не найден');
    need(it.unlocked, 403, 'Сначала пройдите предыдущий раздел');
    const { data } = await db.from('lessons').select('id,title,body').eq('id', id).single();
    return { lesson: data, passed: it.passed };
  },

  async 'quiz.start'({ user }, { lesson_id }) {
    const items = await lessonsFor(user);
    const it = items.find(i => i.id === Number(lesson_id));
    need(it && it.unlocked, 403, 'Раздел недоступен');
    let { data: open } = await db.from('quizzes').select('*').eq('user_id', user.id).eq('lesson_id', lesson_id).is('finished_at', null).order('created_at', { ascending: false }).limit(1);
    let quiz = open?.[0];
    if (!quiz) {
      const { data: lesson } = await db.from('lessons').select('*').eq('id', lesson_id).single();
      const { data: prev } = await db.from('quizzes').select('questions,answers').eq('user_id', user.id).eq('lesson_id', lesson_id).not('finished_at', 'is', null).order('created_at', { ascending: false }).limit(3);
      const questions = await qwen.genQuiz(lesson, prev || []);
      const ins = await db.from('quizzes').insert({ user_id: user.id, lesson_id, questions }).select().single();
      if (ins.error) throw ins.error;
      quiz = ins.data;
    }
    return { quiz_id: quiz.id, questions: quiz.questions.map(({ q, options }) => ({ q, options })) };
  },

  async 'quiz.submit'({ user }, { quiz_id, answers }) {
    const { data: quiz } = await db.from('quizzes').select('*').eq('id', quiz_id).eq('user_id', user.id).maybeSingle();
    need(quiz && !quiz.finished_at, 404, 'Тест не найден или уже завершён');
    need(Array.isArray(answers) && answers.length === quiz.questions.length, 400, 'Ответьте на все вопросы');
    const right = quiz.questions.filter((q, i) => answers[i] === q.correct).length;
    const score = Math.round((right / quiz.questions.length) * 100);
    const passed = score >= await setting('quiz_pass_percent', 70);
    await db.from('quizzes').update({ answers, score, passed, finished_at: new Date().toISOString() }).eq('id', quiz.id);
    if (passed) {
      const { data: old } = await db.from('lesson_progress').select('best_score').eq('user_id', user.id).eq('lesson_id', quiz.lesson_id).maybeSingle();
      await db.from('lesson_progress').upsert({ user_id: user.id, lesson_id: quiz.lesson_id, passed: true, best_score: Math.max(score, old?.best_score || 0) });
    }
    return {
      score, passed,
      review: quiz.questions.map((q, i) => ({ q: q.q, options: q.options, correct: q.correct, picked: answers[i], explain: q.explain })),
    };
  },

  // ── практика с «вредным клиентом»
  async 'practice.start'({ user }) {
    const items = await lessonsFor(user);
    need(user.training_done || (items.length && items.every(i => i.passed)), 403, 'Сначала пройдите все разделы');
    const k = await loadKnowledge();
    const persona = qwen.buildPersona(k.products, k.cases);
    const first = await qwen.clientReply(persona, []);
    const messages = [{ role: 'assistant', content: first }];
    const { data, error } = await db.from('practice_sessions').insert({ user_id: user.id, persona, messages }).select().single();
    if (error) throw error;
    return { session_id: data.id, messages, turns_left: await setting('practice_max_turns', 14) };
  },

  async 'practice.say'({ user }, { session_id, text }) {
    const { data: s } = await db.from('practice_sessions').select('*').eq('id', session_id).eq('user_id', user.id).maybeSingle();
    need(s && s.status === 'active', 404, 'Сессия завершена');
    const msg = String(text || '').trim().slice(0, 1500);
    need(msg, 400, 'Введите сообщение');
    const max = await setting('practice_max_turns', 14);
    const used = s.messages.filter(m => m.role === 'user').length;
    need(used < max, 409, 'Лимит реплик исчерпан. Завершите сделку');
    const messages = [...s.messages, { role: 'user', content: msg }];
    const reply = await qwen.clientReply(s.persona, messages);
    messages.push({ role: 'assistant', content: reply });
    await db.from('practice_sessions').update({ messages }).eq('id', s.id);
    return { reply, turns_left: max - used - 1 };
  },

  async 'practice.finish'({ user }, { session_id }) {
    const { data: s } = await db.from('practice_sessions').select('*').eq('id', session_id).eq('user_id', user.id).maybeSingle();
    need(s && s.status === 'active', 404, 'Сессия уже завершена');
    need(s.messages.filter(m => m.role === 'user').length >= 3, 400, 'Проведите хотя бы 3 реплики');
    const r = await qwen.judge(s.persona, s.messages);
    const passed = r.success && r.score >= 60;
    await db.from('practice_sessions').update({ status: passed ? 'passed' : 'failed', score: r.score, feedback: r, finished_at: new Date().toISOString() }).eq('id', s.id);
    let reward = 0;
    if (passed && !user.training_done) {
      reward = await setting('training_reward_coins', 20);
      await db.rpc('add_coins', { p_user: user.id, p_delta: reward, p_reason: 'Обучение и практика пройдены' });
      await db.from('users').update({ training_done: true }).eq('id', user.id);
    }
    return { passed, reward, ...r };
  },

  // ── работа по базе
  async 'base.today'({ user }, { city }) {
    requireTrained(user);
    const day = today();
    const limit = await setting('daily_batch', 15);
    const load = async () => (await db.from('assignments').select('*, business:businesses(*)').eq('user_id', user.id).eq('day', day).order('id')).data || [];
    let list = await load();
    const c = String(city || '').trim().slice(0, 60);
    if (!list.length && c) {
      let got = await claim(user.id, c, day, limit);
      if (got < limit) {
        try { await refillCity(c); } catch (e) { console.error('refill', e.message); }
        got += await claim(user.id, c, day, limit - got);
      }
      await db.from('users').update({ city: c }).eq('id', user.id);
      list = await load();
      need(list.length, 404, 'В этом городе пока нет подходящих бизнесов без сайта. Попробуйте другой город');
    }
    return { items: list.map(assignmentView), limit, city: user.city || '' };
  },

  async 'base.history'({ user }) {
    requireTrained(user);
    const { data } = await db.from('assignments').select('*, business:businesses(*)').eq('user_id', user.id)
      .in('status', ['submitted', 'approved', 'rejected']).order('id', { ascending: false }).limit(40);
    return { items: (data || []).map(assignmentView) };
  },

  async 'base.submit'({ user }, { assignment_id, text, image }) {
    requireTrained(user);
    const { data: a } = await db.from('assignments').select('*').eq('id', assignment_id).eq('user_id', user.id).maybeSingle();
    need(a, 404, 'Задание не найдено');
    need(['assigned', 'rejected'].includes(a.status), 409, 'Уже отправлено на проверку');
    const t = String(text || '').trim();
    need(t.length >= 20, 400, 'Опишите результат подробнее (от 20 символов)');
    let path = a.proof_path;
    if (image) {
      const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(image);
      need(m, 400, 'Неверный формат изображения');
      const buf = Buffer.from(m[2], 'base64');
      need(buf.length < 3.5e6, 413, 'Изображение слишком большое');
      path = `${user.id}/${a.id}-${Date.now()}.${m[1].split('/')[1]}`;
      const up = await db.storage.from('proofs').upload(path, buf, { contentType: m[1], upsert: true });
      if (up.error) throw up.error;
    }
    await db.from('assignments').update({ status: 'submitted', proof_text: t.slice(0, 2000), proof_path: path, submitted_at: new Date().toISOString() }).eq('id', a.id);
    return { ok: true };
  },

  // ── свои клиенты
  async 'leads.list'({ user }) {
    requireTrained(user);
    const { data } = await db.from('leads').select('*').eq('user_id', user.id).order('id', { ascending: false }).limit(100);
    return { items: data || [] };
  },

  async 'leads.save'({ user }, p) {
    requireTrained(user);
    const name = String(p.name || '').trim();
    need(name, 400, 'Укажите название или имя клиента');
    const row = {
      name: name.slice(0, 120), contact: String(p.contact || '').slice(0, 120), niche: String(p.niche || '').slice(0, 120),
      notes: String(p.notes || '').slice(0, 1500),
      status: ['new', 'contacted', 'interested', 'won', 'lost'].includes(p.status) ? p.status : 'new',
    };
    if (p.id) {
      const { error } = await db.from('leads').update(row).eq('id', p.id).eq('user_id', user.id);
      if (error) throw error;
    } else {
      const { error } = await db.from('leads').insert({ ...row, user_id: user.id });
      if (error) throw error;
    }
    return { ok: true };
  },

  // ── магазин коинов
  async 'shop.list'({ user }) {
    const { data: items } = await db.from('shop_items').select('id,title,description,price,kind,stock').eq('is_active', true).order('position');
    const { data: mine } = await db.from('purchases').select('id,title,price,result,created_at').eq('user_id', user.id).order('id', { ascending: false }).limit(20);
    return { items: (items || []).filter(i => i.stock === null || i.stock > 0), purchases: mine || [], coins: user.coins };
  },

  async 'shop.buy'({ user }, { item_id }) {
    requireTrained(user);
    const { data: item } = await db.from('shop_items').select('*').eq('id', item_id).eq('is_active', true).maybeSingle();
    need(item, 404, 'Товар не найден');
    need(item.stock === null || item.stock > 0, 409, 'Товар закончился');
    need(user.coins >= item.price, 402, 'Не хватает коинов');
    const spend = await db.rpc('add_coins', { p_user: user.id, p_delta: -item.price, p_reason: 'Магазин: ' + item.title });
    if (spend.error) throw new Http(402, 'Не хватает коинов');
    if (item.stock !== null) {
      const up = await db.from('shop_items').update({ stock: item.stock - 1 }).eq('id', item.id).eq('stock', item.stock).select();
      if (!up.data?.length) {
        await db.rpc('add_coins', { p_user: user.id, p_delta: item.price, p_reason: 'Возврат: товар закончился' });
        throw new Http(409, 'Товар закончился');
      }
    }
    let result = {};
    if (item.kind === 'promo') {
      result = { code: 'HUSTLE-' + Math.random().toString(36).slice(2, 8).toUpperCase(), discount_percent: item.payload?.discount_percent };
    } else if (item.kind === 'boost') {
      const until = new Date(Date.now() + (item.payload?.days || 7) * 864e5).toISOString();
      await db.from('users').update({ percent_boost: item.payload?.percent || 0, boost_until: until }).eq('id', user.id);
      result = { percent: item.payload?.percent, until };
    } else {
      result = { status: 'pending' };
      const { data: admins } = await db.from('users').select('tg_id').eq('role', 'admin').not('tg_id', 'is', null);
      for (const a of admins || []) await notify(a.tg_id, `Покупка в магазине: ${user.full_name} (@${user.login}) — «${item.title}»`);
    }
    await db.from('purchases').insert({ user_id: user.id, item_id: item.id, title: item.title, price: item.price, result });
    return { ok: true, result, coins: spend.data };
  },

  // ── админка
  async 'admin.stats'() { return stats(); },

  async 'admin.queue'() {
    const { data } = await db.from('assignments').select('*, business:businesses(*), user:users(full_name,login)')
      .eq('status', 'submitted').order('submitted_at').limit(30);
    const items = [];
    for (const a of data || []) {
      let url = null;
      if (a.proof_path) url = (await db.storage.from('proofs').createSignedUrl(a.proof_path, 3600)).data?.signedUrl || null;
      items.push({ ...assignmentView(a), user: a.user, proof_url: url });
    }
    return { items };
  },

  async 'admin.review'({ user: admin }, { id, approve, note }) {
    const { data: a } = await db.from('assignments').select('*, user:users(id,tg_id,full_name), business:businesses(name)').eq('id', id).eq('status', 'submitted').maybeSingle();
    need(a, 404, 'Заявка не найдена или уже проверена');
    const reward = approve ? await setting('business_reward_coins', 10) : 0;
    if (approve) await db.rpc('add_coins', { p_user: a.user_id, p_delta: reward, p_reason: 'Закрыт бизнес: ' + a.business.name });
    await db.from('assignments').update({
      status: approve ? 'approved' : 'rejected', reviewer_note: String(note || '').slice(0, 500) || null,
      coins_awarded: reward, reviewed_at: new Date().toISOString(),
    }).eq('id', id);
    await db.from('audit_log').insert({ admin_id: admin.id, action: 'review', payload: { id, approve, note } });
    await notify(a.user.tg_id, approve
      ? `Работа по «${a.business.name}» принята: +${reward} HustlifyCoin`
      : `Работа по «${a.business.name}» нужно доработать${note ? ': ' + note : ''}`);
    return { ok: true };
  },

  async 'admin.sale'({ user: admin }, { business_id, login, amount, note }) {
    const sum = Number(amount);
    need(sum > 0, 400, 'Укажите сумму покупки');
    let worker;
    if (business_id) {
      const { data: a } = await db.from('assignments').select('user_id').eq('business_id', business_id).in('status', ['approved', 'submitted']).order('id', { ascending: false }).limit(1).maybeSingle();
      need(a, 404, 'По этому бизнесу нет принятой работы сотрудника');
      worker = (await db.from('users').select('*').eq('id', a.user_id).single()).data;
    } else {
      worker = (await db.from('users').select('*').eq('login', String(login || '').toLowerCase()).maybeSingle()).data;
    }
    need(worker, 404, 'Сотрудник не найден');
    const { percent } = await percentFor(worker);
    const payout = Math.round(sum * percent) / 100;
    await db.from('sales').insert({ user_id: worker.id, business_id: business_id || null, amount: sum, percent, payout, note: note || null });
    await db.rpc('add_money', { p_user: worker.id, p_amount: payout });
    await db.from('audit_log').insert({ admin_id: admin.id, action: 'sale', payload: { worker: worker.login, sum, percent, payout } });
    await notify(worker.tg_id, `Продажа! Вам начислено ${payout} ₽ (${percent}% от ${sum} ₽)`);
    return { ok: true, worker: worker.full_name, percent, payout };
  },

  async 'admin.chat'({ user: admin }, { messages }) {
    return chatWithAdminAgent(admin, messages);
  },
};

// ───────── вход
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { action, ...p } = req.body || {};
    const handler = H[action];
    need(handler, 404, 'Неизвестное действие');

    const tgUser = validateInitData(req.headers['x-init-data'], process.env.BOT_TOKEN);
    const ctx = { tgUser };

    if (!action.startsWith('auth.')) {
      need(tgUser, 401, 'Откройте приложение через Telegram');
      const t = readToken((req.headers.authorization || '').replace(/^Bearer /, ''));
      need(t, 401, 'Нужно войти');
      const { data: user } = await db.from('users').select('*').eq('id', t.uid).maybeSingle();
      need(user && !user.is_blocked, 401, 'Нужно войти');
      need(Number(user.tg_id) === tgUser.id, 401, 'Нужно войти');
      need(!action.startsWith('admin.') || user.role === 'admin', 403, 'Нет доступа');
      ctx.user = user;
    }
    res.json(await handler(ctx, p));
  } catch (e) {
    console.error(e);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Внутренняя ошибка. Попробуйте ещё раз' });
  }
};
