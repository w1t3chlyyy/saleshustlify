const { db, kb, setting, Http } = require('../lib/db');
const { hashPassword, checkPassword, signToken, readToken, validateInitData } = require('../lib/security');
const { notify } = require('../lib/telegram');
const qwen = require('../lib/qwen');
const { refillCity } = require('../lib/places');
const { chatWithAdminAgent, stats, PRODUCTS } = require('../lib/admin');

// ───────── helpers
const pub = u => ({
  id: u.id, login: u.login, full_name: u.full_name, role: u.role, position: u.position,
  coins: u.coins, balance: Number(u.balance), earned_total: Number(u.earned_total),
  training_done: u.training_done, city: u.city, tags: u.tags, track: u.track, plan: u.plan,
});
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: process.env.TZ_NAME || 'Europe/Moscow' });
const need = (cond, code, msg) => { if (!cond) throw new Http(code, msg); };
// Юзернейм наставника: только допустимые символы Telegram, без @
const mentorUsername = v => { const u = String(v || '').trim().replace(/^@/, '').replace(/^https?:\/\/t\.me\//, ''); return /^[A-Za-z0-9_]{4,32}$/.test(u) ? u : ''; };
const requireTrained = u => need(u.training_done || u.role === 'admin', 403, 'Сначала пройдите обучение и практику');
const requireSeller = u => need(u.track === 'seller' || u.role === 'admin', 403, 'Раздел для продающих');
const requirePromoter = u => need(u.track === 'promoter' || u.role === 'admin', 403, 'Раздел для продвигающих');

async function notifyAdmins(text) {
  const { data } = await db.from('users').select('tg_id').eq('role', 'admin').not('tg_id', 'is', null);
  for (const a of data || []) await notify(a.tg_id, text);
}

// Ссылки на карты: по координатам, а если их нет, поиском по названию и городу
const mapLinks = b => {
  const q = encodeURIComponent([b.name, b.city].filter(Boolean).join(' '));
  const has = b.lat != null && b.lon != null;
  return {
    yandex: has ? `https://yandex.ru/maps/?ll=${b.lon},${b.lat}&z=17&pt=${b.lon},${b.lat},pm2rdm` : `https://yandex.ru/maps/?text=${q}`,
    gis: has ? `https://2gis.ru/search/${encodeURIComponent(b.name)}?m=${b.lon},${b.lat}/17` : `https://2gis.ru/search/${q}`,
  };
};

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
  id: a.id, status: a.status, reviewer_note: a.reviewer_note, proof_text: a.proof_text, day: a.day, taken_at: a.taken_at,
  business: a.business ? {
    name: a.business.name, category: a.business.category, address: a.business.address, phone: a.business.phone,
    info: a.business.info, contacts: a.business.contacts || {}, maps: mapLinks(a.business),
  } : null,
});

// Множители Pro и оплата за видео-задание
async function multipliers(user) {
  if (user.plan !== 'pro') return { m: 1, c: 1 };
  return {
    m: Number(await setting('pro_money_multiplier', 1.5)) || 1,
    c: Number(await setting('pro_coins_multiplier', 2)) || 1,
  };
}
const rewardOf = (t, k) => ({ money: Math.round(Number(t.reward_money) * k.m * 100) / 100, coins: Math.round(t.reward_coins * k.c) });

const PRACTICE_COOLDOWN_MS = 12 * 3600 * 1000;
const VALID_ORDER_LINK_RE = /(?:https?:\/\/)?(?:www\.)?hustlify\.site\b|(?:@|https?:\/\/t\.me\/|t\.me\/)?hustlifybot\b/i;

async function practiceRetryAt(user) {
  if (user.role === 'admin') return null;
  const { data } = await db.from('practice_sessions')
    .select('status,finished_at')
    .eq('user_id', user.id)
    .not('finished_at', 'is', null)
    .order('finished_at', { ascending: false })
    .limit(1);
  const last = data?.[0];
  if (last?.status === 'failed' && last.finished_at) {
    const until = new Date(last.finished_at).getTime() + PRACTICE_COOLDOWN_MS;
    if (until > Date.now()) return new Date(until).toISOString();
  }
  return null;
}

const practiceMaxTurns = async () => Math.min(Number(await setting('practice_max_turns', 7)) || 7, 7);

// Каталог и кейсы лежат в одной таблице, различаются колонкой section ('catalog' | 'case')
async function loadKnowledge() {
  const { data, error } = await kb.from(PRODUCTS).select('*').limit(300);
  if (error) console.error('knowledge base:', error.message);
  const rows = data || [];
  return {
    products: rows.filter(r => r.section !== 'case'),
    cases: rows.filter(r => r.section === 'case'),
  };
}

async function lessonsFor(user) {
  const track = user.track || 'seller';
  const { data: lessons } = await db.from('lessons').select('id,position,title')
    .eq('is_published', true).in('audience', ['all', track]).order('position').order('id');
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
      mentor: mentorUsername(await setting('mentor_username', process.env.MENTOR_USERNAME || '')),
      practice_retry_at: await practiceRetryAt(user),
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
    need(user.track || user.role === 'admin', 409, 'Сначала выберите роль');
    const items = await lessonsFor(user);
    const allPassed = user.track === 'promoter' ? items.every(i => i.passed) : items.length > 0 && items.every(i => i.passed);
    return {
      items,
      all_passed: allPassed,
      training_done: user.training_done,
      lesson_reward: Number(await setting('lesson_reward_coins', 3)) || 0,
      practice_retry_at: await practiceRetryAt(user),
    };
  },

  async 'learn.lesson'({ user }, { id }) {
    const items = await lessonsFor(user);
    const it = items.find(i => i.id === Number(id));
    need(it, 404, 'Урок не найден');
    need(it.unlocked, 403, 'Сначала пройдите предыдущий раздел');
    const { data } = await db.from('lessons').select('id,title,body').eq('id', id).single();
    return { lesson: data, passed: it.passed };
  },

  async 'quiz.start'({ user }, { lesson_id, can_edit }) {
    const items = await lessonsFor(user);
    const it = items.find(i => i.id === Number(lesson_id));
    need(it && it.unlocked, 403, 'Раздел недоступен');
    const isPromoter = user.track === 'promoter';
    let { data: open } = await db.from('quizzes').select('*').eq('user_id', user.id).eq('lesson_id', lesson_id).is('finished_at', null).order('created_at', { ascending: false }).limit(1);
    let quiz = open?.[0];
    // Для продвигающих пересоздаём незавершённый тест, если выбор «умею/не умею монтировать» изменился
    if (quiz && isPromoter && can_edit !== undefined) {
      await db.from('quizzes').delete().eq('id', quiz.id);
      quiz = null;
    }
    if (!quiz) {
      const { data: lesson } = await db.from('lessons').select('*').eq('id', lesson_id).single();
      const { data: prev } = await db.from('quizzes').select('questions,answers').eq('user_id', user.id).eq('lesson_id', lesson_id).not('finished_at', 'is', null).order('created_at', { ascending: false }).limit(3);
      let questions;
      if (isPromoter) {
        const canEdit = !!can_edit;
        const intro = [
          {
            q: 'Сколько вам полных лет?',
            options: ['Меньше 16 лет', '16–17 лет', '18–24 года', '25 лет и старше'],
            correct: 1,
            any: true,
            explain: 'Участие в команде доступно с 16 лет.',
          },
          {
            q: 'Умеете ли вы монтировать видео?',
            options: ['Да, умею монтировать', 'Нет, пока не умею'],
            correct: 0,
            any: true,
            explain: 'Здесь нет неверных ответов — вопрос помогает подобрать подходящие вопросы.',
          },
        ];
        const editSurvey = canEdit ? [
          {
            q: 'В каких программах вы монтируете видео?',
            options: ['CapCut / VN', 'Adobe Premiere Pro / After Effects', 'DaVinci Resolve / Final Cut Pro', 'Другие видеоредакторы'],
            correct: 0,
            any: true,
            explain: 'Ответ сохранён в вашей анкете.',
          },
          {
            q: 'Какой у вас опыт в монтаже коротких роликов (Reels, Shorts, TikTok)?',
            options: ['Меньше 6 месяцев', 'От 6 месяцев до 1 года', 'От 1 до 2 лет', 'Более 2 лет'],
            correct: 0,
            any: true,
            explain: 'Ответ сохранён в вашей анкете.',
          },
        ] : [];
        const gen = await qwen.genQuiz(lesson, prev || [], {}, { track: 'promoter', canEdit });
        questions = [...intro, ...editSurvey, ...gen];
      } else {
        questions = await qwen.genQuiz(lesson, prev || [], await loadKnowledge(), { track: user.track || 'seller' });
      }
      const ins = await db.from('quizzes').insert({ user_id: user.id, lesson_id, questions }).select().single();
      if (ins.error) throw ins.error;
      quiz = ins.data;
    }
    return { quiz_id: quiz.id, questions: quiz.questions.map(({ q, options, any }) => ({ q, options, any: !!any })) };
  },

  async 'quiz.submit'({ user }, { quiz_id, answers }) {
    const { data: quiz } = await db.from('quizzes').select('*').eq('id', quiz_id).eq('user_id', user.id).maybeSingle();
    need(quiz && !quiz.finished_at, 404, 'Тест не найден или уже завершён');
    need(Array.isArray(answers) && answers.length === quiz.questions.length, 400, 'Ответьте на все вопросы');
    // Если в первом вопросе о возрасте выбран вариант «Меньше 16 лет»
    if (user.track === 'promoter' && quiz.questions[0]?.any && answers[0] === 0) {
      throw new Http(403, 'К сожалению, мы не можем принять вас: участие доступно только с 16 лет');
    }
    const graded = quiz.questions.filter(q => !q.any);
    const right = quiz.questions.filter((q, i) => !q.any && answers[i] === q.correct).length;
    const score = graded.length ? Math.round((right / graded.length) * 100) : 100;
    const passed = score >= await setting('quiz_pass_percent', 70);
    await db.from('quizzes').update({ answers, score, passed, finished_at: new Date().toISOString() }).eq('id', quiz.id);
    if (user.track === 'promoter' && quiz.questions[1]?.any) {
      const canEdit = answers[1] === 0;
      const tags = new Set((user.tags || []).filter(t => !/^(монтаж:|программа:|опыт:)/.test(t)));
      tags.add(canEdit ? 'монтаж: умеет' : 'монтаж: без опыта');
      if (canEdit && quiz.questions[2]?.any && quiz.questions[2].options[answers[2]]) {
        tags.add('программа: ' + quiz.questions[2].options[answers[2]]);
      }
      if (canEdit && quiz.questions[3]?.any && quiz.questions[3].options[answers[3]]) {
        tags.add('опыт: ' + quiz.questions[3].options[answers[3]]);
      }
      await db.from('users').update({ tags: [...tags] }).eq('id', user.id);
    }
    let reward = 0;
    if (passed) {
      const { data: old } = await db.from('lesson_progress').select('best_score,passed').eq('user_id', user.id).eq('lesson_id', quiz.lesson_id).maybeSingle();
      await db.from('lesson_progress').upsert({ user_id: user.id, lesson_id: quiz.lesson_id, passed: true, best_score: Math.max(score, old?.best_score || 0) });
      // Коины даём только за первое прохождение раздела, пересдача награду не повторяет
      if (!old?.passed) {
        reward = Number(await setting('lesson_reward_coins', 3)) || 0;
        if (reward > 0) await db.rpc('add_coins', { p_user: user.id, p_delta: reward, p_reason: 'Раздел обучения пройден (id ' + quiz.lesson_id + ')' });
      }
    }
    return {
      score, passed, reward,
      review: quiz.questions.map((q, i) => ({
        q: q.q,
        options: q.options,
        correct: q.any ? answers[i] : q.correct,
        picked: answers[i],
        explain: q.explain,
      })),
    };
  },

  // ── практика с клиентом
  async 'practice.start'({ user }) {
    need(user.track === 'seller' || user.role === 'admin', 403, 'Практика с клиентом только для продающих');
    const items = await lessonsFor(user);
    need(user.training_done || (items.length && items.every(i => i.passed)), 403, 'Сначала пройдите все разделы');
    const retryAt = await practiceRetryAt(user);
    need(!retryAt, 429, 'Следующая попытка будет доступна через 12 часов после провала');
    const max = await practiceMaxTurns();
    const k = await loadKnowledge();
    const persona = qwen.buildPersona(k.products, k.cases);
    const first = await qwen.clientReply(persona, [], max);
    const messages = [{ role: 'assistant', content: first.reply }];
    const { data, error } = await db.from('practice_sessions').insert({ user_id: user.id, persona, messages }).select().single();
    if (error) throw error;
    return { session_id: data.id, messages, turns_left: max };
  },

  async 'practice.say'({ user }, { session_id, text }) {
    const { data: s } = await db.from('practice_sessions').select('*').eq('id', session_id).eq('user_id', user.id).maybeSingle();
    need(s && s.status === 'active', 404, 'Сессия завершена');
    const msg = String(text || '').trim().slice(0, 1500);
    need(msg, 400, 'Введите сообщение');
    const max = await practiceMaxTurns();
    const used = s.messages.filter(m => m.role === 'user').length;
    need(used < max, 409, 'Лимит реплик исчерпан. Завершите сделку');
    const turnsLeft = max - used - 1;
    const messages = [...s.messages, { role: 'user', content: msg }];
    const hasValidLink = VALID_ORDER_LINK_RE.test(msg);

    let step;
    if (hasValidLink && (s.persona?.awaiting_link || used >= 1)) {
      // Клиент получил верный сайт (hustlify.site) или бота (@hustlifybot) — сразу оплачивает и закрывает сделку без лишнего расхода токенов
      step = {
        reply: 'Отлично, перешёл по вашей ссылке, всё оформил и уже оплатил заказ! Спасибо за чёткую консультацию, работаем.',
        outcome: 'passed',
        awaiting_link: false,
      };
    } else if (s.persona?.awaiting_link && !hasValidLink && /(?:https?:\/\/|t\.me\/|@[a-z0-9_]+|[a-z0-9-]+\.(?:ru|com|site|org|net|io|me)\b)/i.test(msg)) {
      step = {
        reply: 'Подождите, это какая-то не та ссылка. Пришлите ваш официальный сайт (hustlify.site) или официального бота (@hustlifybot), чтобы я оплатил заказ.',
        outcome: null,
        awaiting_link: true,
      };
    } else {
      step = await qwen.clientReply(s.persona || {}, messages, turnsLeft);
      if (step.outcome === 'passed' && !hasValidLink) {
        step.outcome = null;
        step.awaiting_link = true;
      }
    }

    if (!step.outcome && turnsLeft <= 0) {
      step.outcome = 'failed';
      step.reply = step.reply + ' Ладно, мне пора бежать, мы так и не оформили заказ. Всего доброго.';
    }

    messages.push({ role: 'assistant', content: step.reply });
    const persona = { ...(s.persona || {}), awaiting_link: !!step.awaiting_link };

    if (step.outcome === 'passed' || step.outcome === 'failed') {
      const passed = step.outcome === 'passed';
      const nowIso = new Date().toISOString();
      const feedback = passed
        ? {
            success: true,
            score: 95,
            strengths: ['Быстро расположили клиента к покупке', 'Отправили верный сайт / бота для оплаты заказа'],
            improvements: [],
            summary: 'Клиент перешёл по ссылке, оплатил заказ и сам успешно закрыл сделку!',
          }
        : {
            success: false,
            score: 25,
            strengths: [],
            improvements: [
              'Общайтесь вежливо и по делу, чтобы клиент не закрыл диалог',
              'Когда клиент готов к заказу, отправляйте hustlify.site или @hustlifybot',
            ],
            summary: 'Клиент прекратил разговор, сделка не состоялась. Следующая попытка будет доступна через 12 часов.',
          };
      await db.from('practice_sessions').update({
        persona,
        messages,
        status: passed ? 'passed' : 'failed',
        score: feedback.score,
        feedback,
        finished_at: nowIso,
      }).eq('id', s.id);

      let reward = 0;
      if (passed && !user.training_done) {
        reward = await setting('training_reward_coins', 20);
        await db.rpc('add_coins', { p_user: user.id, p_delta: reward, p_reason: 'Обучение и практика пройдены' });
        await db.from('users').update({ training_done: true }).eq('id', user.id);
      }
      const retry_at = passed ? null : new Date(Date.now() + PRACTICE_COOLDOWN_MS).toISOString();
      return { reply: step.reply, turns_left: turnsLeft, finished: true, result: { passed, reward, retry_at, ...feedback } };
    }

    await db.from('practice_sessions').update({ persona, messages }).eq('id', s.id);
    return { reply: step.reply, turns_left: turnsLeft, awaiting_link: persona.awaiting_link };
  },

  async 'practice.finish'({ user }, { session_id }) {
    const { data: s } = await db.from('practice_sessions').select('*').eq('id', session_id).eq('user_id', user.id).maybeSingle();
    need(s && s.status === 'active', 404, 'Сессия уже завершена');
    need(s.messages.filter(m => m.role === 'user').length >= 2, 400, 'Проведите хотя бы 2 реплики');
    const sentValidLink = s.messages.some(m => m.role === 'user' && VALID_ORDER_LINK_RE.test(m.content));
    const r = await qwen.judge(s.persona, s.messages);
    const passed = sentValidLink && r.success && r.score >= 60;
    if (!sentValidLink && r.improvements) {
      r.improvements = ['Для успешной оплаты нужно отправить клиенту официальный сайт hustlify.site или бота @hustlifybot', ...r.improvements].slice(0, 4);
      if (!passed) r.summary = 'Заказ не был оплачен через официальный сайт (hustlify.site) или бота (@hustlifybot). Следующая попытка через 12 часов.';
    }
    const nowIso = new Date().toISOString();
    await db.from('practice_sessions').update({ status: passed ? 'passed' : 'failed', score: r.score, feedback: r, finished_at: nowIso }).eq('id', s.id);
    let reward = 0;
    if (passed && !user.training_done) {
      reward = await setting('training_reward_coins', 20);
      await db.rpc('add_coins', { p_user: user.id, p_delta: reward, p_reason: 'Обучение и практика пройдены' });
      await db.from('users').update({ training_done: true }).eq('id', user.id);
    }
    const retry_at = passed ? null : new Date(Date.now() + PRACTICE_COOLDOWN_MS).toISOString();
    return { passed, reward, retry_at, ...r };
  },

  // ── работа по базе
  async 'base.today'({ user }, { city }) {
    requireSeller(user);
    requireTrained(user);
    const day = today();
    const limit = await setting('daily_batch', 15);
    // Сегодняшняя подборка + всё, что взято в работу в любой день
    const load = async () => (await db.from('assignments').select('*, business:businesses(*)')
      .eq('user_id', user.id).or(`day.eq.${day},status.eq.in_work`).order('id')).data || [];
    let list = await load();
    const c = String(city || '').trim().slice(0, 60);
    if (!list.some(a => a.day === day) && c) {
      let got = await claim(user.id, c, day, limit);
      if (got < limit) {
        try { await refillCity(c); } catch (e) { console.error('refill', e.message); }
        got += await claim(user.id, c, day, limit - got);
      }
      await db.from('users').update({ city: c }).eq('id', user.id);
      list = await load();
      need(list.some(a => a.day === day), 404, 'В этом городе пока нет подходящих бизнесов без сайта. Попробуйте другой город');
    }
    return { items: list.map(assignmentView), limit, city: user.city || '', has_today: list.some(a => a.day === day) };
  },

  async 'base.take'({ user }, { assignment_id }) {
    requireSeller(user);
    const { data: a } = await db.from('assignments').select('id,status').eq('id', assignment_id).eq('user_id', user.id).maybeSingle();
    need(a, 404, 'Задание не найдено');
    need(a.status === 'assigned', 409, 'Уже взято в работу');
    const max = await setting('max_in_work', 30);
    const { count } = await db.from('assignments').select('*', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'in_work');
    need((count || 0) < max, 409, `В работе одновременно не больше ${max} бизнесов. Сначала отправьте результаты по текущим`);
    await db.from('assignments').update({ status: 'in_work', taken_at: new Date().toISOString() }).eq('id', a.id).eq('status', 'assigned');
    return { ok: true };
  },

  async 'base.history'({ user }) {
    requireSeller(user);
    requireTrained(user);
    const { data } = await db.from('assignments').select('*, business:businesses(*)').eq('user_id', user.id)
      .in('status', ['submitted', 'approved', 'rejected']).order('id', { ascending: false }).limit(40);
    return { items: (data || []).map(assignmentView) };
  },

  async 'base.submit'({ user }, { assignment_id, text, image }) {
    requireSeller(user);
    requireTrained(user);
    const { data: a } = await db.from('assignments').select('*').eq('id', assignment_id).eq('user_id', user.id).maybeSingle();
    need(a, 404, 'Задание не найдено');
    need(['in_work', 'rejected'].includes(a.status), 409, a.status === 'assigned' ? 'Сначала возьмите бизнес в работу' : 'Уже отправлено на проверку');
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
    requireSeller(user);
    requireTrained(user);
    const { data } = await db.from('leads').select('*').eq('user_id', user.id).order('id', { ascending: false }).limit(100);
    return { items: data || [] };
  },

  async 'leads.save'({ user }, p) {
    requireSeller(user);
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
    const { data: free } = await db.from('promo_codes').select('item_id').eq('is_used', false).limit(5000);
    const left = {};
    (free || []).forEach(r => { left[r.item_id] = (left[r.item_id] || 0) + 1; });
    const visible = (items || []).filter(i => i.kind === 'promo' ? (left[i.id] || 0) > 0 : (i.stock === null || i.stock > 0));
    return { items: visible, purchases: mine || [], coins: user.coins };
  },

  async 'shop.buy'({ user }, { item_id }) {
    requireTrained(user);
    const { data: item } = await db.from('shop_items').select('*').eq('id', item_id).eq('is_active', true).maybeSingle();
    need(item, 404, 'Товар не найден');
    need(item.kind === 'promo' || item.stock === null || item.stock > 0, 409, 'Товар закончился');
    need(user.coins >= item.price, 402, 'Не хватает коинов');
    // Промокод берём из загруженных админом кодов; если не получилось списать коины, код возвращаем
    let promo = null;
    if (item.kind === 'promo') {
      const c = await db.rpc('claim_promo', { p_item: item.id, p_user: user.id });
      if (c.error) throw c.error;
      need(c.data, 409, 'Промокоды закончились');
      promo = c.data;
    }
    const spend = await db.rpc('add_coins', { p_user: user.id, p_delta: -item.price, p_reason: 'Магазин: ' + item.title });
    if (spend.error) {
      if (promo) await db.from('promo_codes').update({ is_used: false, used_by: null, used_at: null }).eq('item_id', item.id).eq('code', promo);
      throw new Http(402, 'Не хватает коинов');
    }
    if (item.kind !== 'promo' && item.stock !== null) {
      const up = await db.from('shop_items').update({ stock: item.stock - 1 }).eq('id', item.id).eq('stock', item.stock).select();
      if (!up.data?.length) {
        await db.rpc('add_coins', { p_user: user.id, p_delta: item.price, p_reason: 'Возврат: товар закончился' });
        throw new Http(409, 'Товар закончился');
      }
    }
    let result = {};
    if (item.kind === 'promo') {
      result = { code: promo, discount_percent: item.payload?.discount_percent };
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

  // ── роль и тариф
  async 'role.set'({ user }, { track }) {
    need(['seller', 'promoter'].includes(track), 400, 'Выберите роль');
    need(!user.track, 409, 'Роль уже выбрана. Изменить её может администратор');
    await db.from('users').update({ track, position: track === 'promoter' ? 'Промоутер' : 'Стажёр' }).eq('id', user.id);
    return { ok: true, track };
  },

  async 'plan.request'({ user }, { url, note }) {
    need(user.track === 'promoter', 403, 'Только для продвигающих');
    requireTrained(user);
    need(user.plan !== 'pro', 409, 'У вас уже тариф Pro');
    const link = String(url || '').trim();
    need(/^https?:\/\/\S{4,500}$/i.test(link), 400, 'Вставьте ссылку на пример вашего монтажа (https://…)');
    const { data: pend } = await db.from('plan_requests').select('id').eq('user_id', user.id).eq('status', 'pending').limit(1);
    need(!pend?.length, 409, 'Заявка уже на рассмотрении');
    await db.from('plan_requests').insert({ user_id: user.id, portfolio_url: link, note: String(note || '').slice(0, 1000) || null });
    await notifyAdmins(`Заявка на Pro: ${user.full_name} (@${user.login})`);
    return { ok: true };
  },

  // ── продвигающие: видео
  async 'promo.test'({ user }) {
    requirePromoter(user);
    const items = await lessonsFor(user);
    need(user.training_done || items.every(i => i.passed), 403, 'Сначала пройдите все разделы');
    const { data: task } = await db.from('video_tasks').select('*').eq('kind', 'test').eq('is_active', true).order('id').limit(1).maybeSingle();
    need(task, 404, 'Тестовое задание пока не опубликовано');
    const { data: sub } = await db.from('video_submissions').select('status,reviewer_note,video_url').eq('task_id', task.id).eq('user_id', user.id).maybeSingle();
    return { task: { id: task.id, title: task.title, brief: task.brief, deadline: task.deadline }, submission: sub || null, training_done: user.training_done };
  },

  async 'promo.tasks'({ user }) {
    requirePromoter(user);
    requireTrained(user);
    const [{ data: tasks }, { data: subs }, { data: pend }, k] = await Promise.all([
      db.from('video_tasks').select('*').eq('kind', 'work').eq('is_active', true).order('id', { ascending: false }).limit(50),
      db.from('video_submissions').select('task_id,status,reviewer_note,video_url').eq('user_id', user.id),
      db.from('plan_requests').select('id').eq('user_id', user.id).eq('status', 'pending').limit(1),
      multipliers(user),
    ]);
    const mine = Object.fromEntries((subs || []).map(s => [s.task_id, s]));
    return {
      plan: user.plan, plan_pending: !!pend?.length,
      items: (tasks || []).map(t => {
        const r = rewardOf(t, k);
        return {
          id: t.id, title: t.title, brief: t.brief, deadline: t.deadline, min_plan: t.min_plan,
          locked: t.min_plan === 'pro' && user.plan !== 'pro',
          reward_money: r.money, reward_coins: r.coins, sub: mine[t.id] || null,
        };
      }),
    };
  },

  async 'promo.submit'({ user }, { task_id, url, note }) {
    requirePromoter(user);
    const { data: task } = await db.from('video_tasks').select('*').eq('id', task_id).eq('is_active', true).maybeSingle();
    need(task, 404, 'Задание не найдено');
    if (task.kind !== 'test') {
      requireTrained(user);
      need(task.min_plan === 'worker' || user.plan === 'pro', 403, 'Это задание только для тарифа Pro');
    }
    need(!task.deadline || new Date(task.deadline) > new Date(), 409, 'Срок задания истёк');
    const link = String(url || '').trim();
    need(/^https?:\/\/\S{4,500}$/i.test(link), 400, 'Вставьте ссылку на видео (https://…)');
    const { data: old } = await db.from('video_submissions').select('status').eq('task_id', task.id).eq('user_id', user.id).maybeSingle();
    need(!old || old.status === 'rejected', 409, old?.status === 'approved' ? 'Задание уже принято' : 'Уже отправлено на проверку');
    const { error } = await db.from('video_submissions').upsert({
      task_id: task.id, user_id: user.id, video_url: link, note: String(note || '').slice(0, 1000) || null,
      status: 'submitted', reviewer_note: null, reviewed_at: null, created_at: new Date().toISOString(),
    }, { onConflict: 'task_id,user_id' });
    if (error) throw error;
    await notifyAdmins(`Новое видео на проверке: ${user.full_name} (@${user.login}), «${task.title}»`);
    return { ok: true };
  },

  // ── админка
  async 'admin.stats'() {
    const k = await loadKnowledge();
    const sent = qwen.compact(k.products, 5000).length + qwen.compact(k.cases, 3000).length;
    const full = qwen.compact(k.products, 1e9).length + qwen.compact(k.cases, 1e9).length;
    return { ...(await stats()), kb_products: k.products.length, kb_cases: k.cases.length, kb_sent: sent, kb_full: full };
  },

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

  async 'admin.vqueue'() {
    const { data } = await db.from('video_submissions').select('*, task:video_tasks(title,kind), user:users(full_name,login)')
      .eq('status', 'submitted').order('created_at').limit(30);
    return { items: data || [] };
  },

  async 'admin.vreview'({ user: admin }, { id, approve, note }) {
    const { data: s } = await db.from('video_submissions').select('*, task:video_tasks(*), user:users(*)').eq('id', id).eq('status', 'submitted').maybeSingle();
    need(s, 404, 'Видео не найдено или уже проверено');
    let money = 0, coins = 0, isFirstTest = false;
    if (approve) {
      const r = rewardOf(s.task, await multipliers(s.user));
      money = r.money; coins = r.coins;
      if (s.task.kind === 'test' && !s.user.training_done) {
        isFirstTest = true;
        coins += Number(await setting('training_reward_coins', 20)) || 0;
      }
    }
    // Сначала «занимаем» заявку, чтобы выплата не прошла дважды
    const upd = await db.from('video_submissions').update({
      status: approve ? 'approved' : 'rejected', reviewer_note: String(note || '').slice(0, 500) || null,
      money_awarded: money, coins_awarded: coins, reviewed_at: new Date().toISOString(),
    }).eq('id', id).eq('status', 'submitted').select();
    need(upd.data?.length, 409, 'Уже проверено');
    if (approve) {
      if (money > 0) await db.rpc('add_money', { p_user: s.user_id, p_amount: money });
      if (coins > 0) await db.rpc('add_coins', { p_user: s.user_id, p_delta: coins, p_reason: 'Видео принято: ' + s.task.title });
      if (isFirstTest) await db.from('users').update({ training_done: true }).eq('id', s.user_id);
    }
    await db.from('audit_log').insert({ admin_id: admin.id, action: 'video_review', payload: { id, approve, money, coins } });
    await notify(s.user.tg_id, approve
      ? `Видео «${s.task.title}» принято${money ? `: +${money} ₽` : ''}${coins ? `, +${coins} HustlifyCoin` : ''}`
      : `Видео «${s.task.title}» нужно доработать${note ? ': ' + note : ''}`);
    return { ok: true };
  },

  async 'admin.plans'() {
    const { data } = await db.from('plan_requests').select('*, user:users(full_name,login)').eq('status', 'pending').order('id').limit(30);
    return { items: data || [] };
  },

  async 'admin.plan_decide'({ user: admin }, { id, approve, note }) {
    const { data: r } = await db.from('plan_requests').select('*, user:users(id,tg_id)').eq('id', id).eq('status', 'pending').maybeSingle();
    need(r, 404, 'Заявка не найдена или уже рассмотрена');
    await db.from('plan_requests').update({ status: approve ? 'approved' : 'rejected', admin_note: String(note || '').slice(0, 500) || null, decided_at: new Date().toISOString() }).eq('id', id);
    if (approve) await db.from('users').update({ plan: 'pro', position: 'Промоутер Pro' }).eq('id', r.user_id);
    await db.from('audit_log').insert({ admin_id: admin.id, action: 'plan_decide', payload: { id, approve } });
    await notify(r.user.tg_id, approve ? 'Вы переведены на тариф Pro. Теперь доступны Pro-задания и повышенная оплата' : `Заявка на Pro отклонена${note ? ': ' + note : ''}`);
    return { ok: true };
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
      // Без пройденного обучения доступны только профиль, обучение, тесты и практика
      if (!/^(me$|role\.|learn\.|quiz\.|practice\.|promo\.test$|promo\.submit$)/.test(action)) requireTrained(user);
      ctx.user = user;
    }
    res.json(await handler(ctx, p));
  } catch (e) {
    console.error(e);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Внутренняя ошибка. Попробуйте ещё раз' });
  }
};
