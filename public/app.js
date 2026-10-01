(() => {
'use strict';
const tg = window.Telegram?.WebApp;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CUR = '₽';
const money = n => Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ' + CUR;
const haptic = () => { try { tg?.HapticFeedback?.impactOccurred('light'); } catch {} };

let token = localStorage.getItem('h_token') || '';
const S = { user: null, me: null, tab: 'home', wseg: 'today', tseg: 'coins', aseg: 'stats', authMode: 'login', adminChat: [], assign: {}, leads: {} };

// ───────── icons
const ic = (p, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const I = {
  home: ic('<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'),
  work: ic('<rect x="3" y="7" width="18" height="13" rx="3"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>'),
  top: ic('<path d="M6 20V11M12 20V4M18 20v-6"/>'),
  shop: ic('<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>'),
  me: ic('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>'),
  chev: ic('<path d="M9 6l6 6-6 6"/>', 'chev'),
  check: ic('<path d="M5 12.5l4.5 4.5L19 7"/>'),
  lock: ic('<rect x="5" y="11" width="14" height="10" rx="3"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  send: ic('<path d="M12 19V5M5 12l7-7 7 7"/>'),
  book: ic('<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/>'),
  chat: ic('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>'),
  shield: ic('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>'),
  out: ic('<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h10"/>'),
  back: ic('<path d="M15 6l-6 6 6 6"/>', 'chev'),
};

// ───────── core
function applyTheme() {
  const dark = (tg?.colorScheme || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light')) === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  try { tg?.setHeaderColor(dark ? '#000000' : '#ffffff'); tg?.setBackgroundColor(dark ? '#000000' : '#ffffff'); } catch {}
}

async function api(action, data = {}) {
  let r, j;
  try {
    r = await fetch('/api/app', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-init-data': tg?.initData || '', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: JSON.stringify({ action, ...data }),
    });
    j = await r.json();
  } catch { throw new Error('Нет связи с сервером. Проверьте интернет'); }
  if (!r.ok) {
    if (r.status === 401 && !action.startsWith('auth.') && token) { logout(true); }
    throw new Error(j.error || 'Ошибка');
  }
  return j;
}

let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2800);
}

function view(html, { tabbar = false } = {}) {
  closeSheet();
  $('#app').innerHTML = html;
  $('#tabbar').style.display = tabbar ? 'flex' : 'none';
  window.scrollTo(0, 0);
}
const loading = msg => view(`<div class="screen no-tab"><div class="spin"></div>${msg ? `<p class="mut small" style="text-align:center">${esc(msg)}</p>` : ''}</div>`);
const errBlock = e => `<div class="empty"><b>Не получилось</b>${esc(e.message)}</div>`;

function sheet(html) {
  closeSheet();
  const el = document.createElement('div');
  el.className = 'overlay';
  el.innerHTML = `<div class="sheet"><div class="grab"></div>${html}</div>`;
  el.addEventListener('click', e => { if (e.target === el) el.remove(); });
  document.body.appendChild(el);
}
const closeSheet = () => document.querySelector('.overlay')?.remove();

function logout(silent) {
  try { localStorage.removeItem('h_token'); } catch {}
  token = '';
  Object.assign(S, { user: null, me: null, adminChat: [], assign: {}, leads: {}, tab: 'home', authMode: 'login', quiz: null, p: null });
  renderAuth();
  if (silent) toast('Войдите снова');
}
function md(src) {
  let s = esc(src)
    .replace(/^### (.*)$/gm, '<h4>$1</h4>').replace(/^## (.*)$/gm, '<h3>$1</h3>').replace(/^# (.*)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/^(?:- |\* )(.*)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m.replace(/\n/g, '')}</ul>`)
    .replace(/\n{2,}/g, '</p><p>');
  return `<p>${s}</p>`.replace(/<p>(<(?:h[234]|ul)>)/g, '$1').replace(/(<\/(?:h[234]|ul)>)<\/p>/g, '$1');
}

function countUp() {
  const el = $('#coinnum'); if (!el) return;
  const v = Number(el.dataset.v);
  if (!v || matchMedia('(prefers-reduced-motion:reduce)').matches) { el.textContent = v; return; }
  const t0 = performance.now(), D = 900;
  const step = t => { const k = Math.min(1, (t - t0) / D); el.textContent = Math.round(v * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

function compress(file, max = 1400, q = 0.72) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', q));
    };
    img.onerror = () => rej(new Error('Не удалось прочитать фото'));
    img.src = url;
  });
}

const val = id => ($('#' + id)?.value ?? '').trim();
const STATUS = { assigned: 'В работе', submitted: 'На проверке', approved: 'Принято', rejected: 'Доработать' };

// ───────── auth
function renderAuth() {
  const reg = S.authMode === 'register';
  view(`<div class="screen no-tab">
    <div class="brand">Hustlify</div>
    <p class="sub">Рабочее пространство отдела продаж</p>
    <div class="seg">
      <button data-act="authMode" data-k="login" class="${!reg ? 'on' : ''}">Вход</button>
      <button data-act="authMode" data-k="register" class="${reg ? 'on' : ''}">Регистрация</button>
    </div>
    ${reg ? `<label class="field"><span>Имя и фамилия</span><input id="a_name" autocomplete="name" placeholder="Анна Иванова"></label>` : ''}
    <label class="field"><span>Логин</span><input id="a_login" autocapitalize="none" autocomplete="username" placeholder="anna_ivanova"></label>
    <label class="field"><span>Пароль</span><input id="a_pass" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" placeholder="Минимум 8 символов" data-enter="authSubmit"></label>
    <button class="btn" style="margin-top:8px" data-act="authSubmit">${reg ? 'Создать аккаунт' : 'Войти'}</button>
  </div>`);
}

async function enter() {
  const m = await api('me'); S.me = m; S.user = m.user;
  if (!S.user.training_done && S.user.role !== 'admin') return learnHome();
  S.tab = 'home'; renderTabbar(); return pages.home();
}

// ───────── tabs
const TABS = [['home', 'Кабинет', I.home], ['work', 'Работа', I.work], ['top', 'Топ', I.top], ['shop', 'Магазин', I.shop], ['me', 'Профиль', I.me]];
function renderTabbar() {
  $('#tabbar').innerHTML = TABS.map(([k, l, i]) => `<button data-act="tab" data-k="${k}" class="${S.tab === k ? 'on' : ''}" aria-label="${l}">${i}<span>${l}</span></button>`).join('');
}
async function go(tab) { S.tab = tab; renderTabbar(); try { await pages[tab](); } catch (e) { view(`<div class="screen">${errBlock(e)}</div>`, { tabbar: true }); } }

// ───────── learning
async function learnHome() {
  loading();
  const d = await api('learn.lessons');
  const trained = S.user.training_done;
  const done = d.items.filter(i => i.passed).length, total = d.items.length;
  const rows = d.items.map(l => `
    <button class="row" data-act="lesson" data-id="${l.id}" ${l.unlocked ? '' : 'disabled'} style="${l.unlocked ? '' : 'opacity:.4'}">
      ${l.passed ? I.check : l.unlocked ? I.book : I.lock}
      <div class="grow"><div class="t">${esc(l.title)}</div><div class="d">${l.passed ? `Тест сдан на ${l.best_score}%` : l.unlocked ? 'Материал и тест' : 'Откроется после предыдущего'}</div></div>
      ${I.chev}
    </button>`).join('');
  view(`<div class="screen ${trained ? '' : 'no-tab'}">
    <h1 class="title">Обучение</h1>
    <p class="sub">${total ? `Пройдено ${done} из ${total}. После каждого раздела — тест, который Qwen составляет лично для вас.` : 'Материалы появятся здесь совсем скоро.'}</p>
    <div class="bar" style="margin:0 0 22px"><i style="width:${total ? done / total * 100 : 0}%"></i></div>
    ${total ? `<div class="list">${rows}</div>` : ''}
    <h2 class="h2">Финал</h2>
    <div class="list"><button class="row" data-act="practiceIntro" ${d.all_passed || trained ? '' : 'disabled'} style="${d.all_passed || trained ? '' : 'opacity:.4'}">
      ${I.chat}<div class="grow"><div class="t">Практика с клиентом</div><div class="d">${d.all_passed || trained ? 'Убедите вредного клиента купить' : 'Откроется после всех разделов'}</div></div>${I.chev}
    </button></div>
    ${trained ? '' : `<button class="btn ghost" style="margin-top:26px" data-act="logout">Выйти</button>`}
  </div>`, { tabbar: trained });
}

async function openLesson(id) {
  loading();
  const d = await api('learn.lesson', { id });
  S.lessonId = d.lesson.id;
  view(`<div class="screen no-tab">
    <button class="back" data-act="learnHome">${I.back}Разделы</button>
    <h1 class="title">${esc(d.lesson.title)}</h1>
    <div class="prose" style="margin-top:22px">${md(d.lesson.body)}</div>
    ${S.user.training_done ? '' : `<button class="btn" style="margin-top:26px" data-act="quizStart" data-id="${d.lesson.id}">${d.passed ? 'Пересдать тест' : 'Пройти тест'}</button>`}
  </div>`, { tabbar: false });
}

async function quizStart(id) {
  loading('Qwen составляет вопросы для вас…');
  try {
    const d = await api('quiz.start', { lesson_id: id });
    S.quiz = { id: d.quiz_id, qs: d.questions, i: 0, ans: [], lesson: id };
    quizRender();
  } catch (e) { toast(e.message); learnHome(); }
}
function quizRender() {
  const { qs, i, ans } = S.quiz, q = qs[i];
  view(`<div class="screen no-tab">
    <p class="mut small">Вопрос ${i + 1} из ${qs.length}</p>
    <div class="bar" style="margin:0 0 24px"><i style="width:${i / qs.length * 100}%"></i></div>
    <h1 class="title" style="font-size:21px;line-height:1.3">${esc(q.q)}</h1>
    <div style="margin-top:22px">${q.options.map((o, k) => `<button class="opt ${ans[i] === k ? 'on' : ''}" data-act="pick" data-k="${k}">${esc(o)}</button>`).join('')}</div>
    <button class="btn" style="margin-top:24px" data-act="quizNext" ${ans[i] === undefined ? 'disabled' : ''}>${i + 1 === qs.length ? 'Завершить тест' : 'Дальше'}</button>
  </div>`);
}
async function quizFinish() {
  loading('Проверяем ответы…');
  try {
    const r = await api('quiz.submit', { quiz_id: S.quiz.id, answers: S.quiz.ans });
    const review = r.review.map(x => `
      <div class="card" style="margin-bottom:12px">
        <b>${esc(x.q)}</b>
        <div style="margin-top:12px">${x.options.map((o, k) => `<div class="opt ${k === x.correct ? 'ok' : k === x.picked ? 'bad' : ''}" style="cursor:default">${esc(o)}</div>`).join('')}</div>
        ${x.explain ? `<p class="mut small" style="margin:12px 0 0">${esc(x.explain)}</p>` : ''}
      </div>`).join('');
    view(`<div class="screen no-tab">
      <div class="hero"><div class="num">${r.score}%</div><div class="cap">${r.passed ? 'Тест сдан' : 'Нужно ещё раз'}</div></div>
      ${review}
      ${r.passed ? `<button class="btn" data-act="learnHome">К разделам</button>`
        : `<button class="btn" data-act="quizStart" data-id="${S.quiz.lesson}">Пересдать с новыми вопросами</button><button class="btn ghost" style="margin-top:10px" data-act="lesson" data-id="${S.quiz.lesson}">Перечитать материал</button>`}
    </div>`);
  } catch (e) { toast(e.message); learnHome(); }
}

// ───────── practice
function practiceIntro() {
  view(`<div class="screen no-tab">
    <button class="back" data-act="learnHome">${I.back}Назад</button>
    <h1 class="title">Практика с клиентом</h1>
    <p class="sub">Перед вами вредный клиент с характером. Он возражает, торгуется и проверяет, знаете ли вы продукт. Ваша задача — выявить потребность и довести его до покупки.</p>
    <div class="list">
      <div class="row"><div class="grow"><div class="t">Говорите как с живым человеком</div><div class="d">Задавайте вопросы и отвечайте на возражения по сути</div></div></div>
      <div class="row"><div class="grow"><div class="t">Опирайтесь на факты</div><div class="d">Клиент знает каталог и кейсы и поймает на неточности</div></div></div>
      <div class="row"><div class="grow"><div class="t">Завершите сделку сами</div><div class="d">Нажмите «Завершить», когда договорились или поняли, что всё</div></div></div>
    </div>
    <button class="btn" style="margin-top:24px" data-act="practiceStart">Начать диалог</button>
  </div>`);
}
async function practiceStart() {
  loading('Клиент готовится к разговору…');
  try {
    const d = await api('practice.start');
    S.p = { id: d.session_id, msgs: d.messages, left: d.turns_left, busy: false };
    chatRender();
  } catch (e) { toast(e.message); learnHome(); }
}
function bubbles(list) { return list.map(m => `<div class="bub ${m.role === 'user' ? 'u' : 'c'}">${esc(m.content)}</div>`).join(''); }
function chatRender() {
  const p = S.p;
  view(`<div class="screen no-tab"><h1 class="title" style="font-size:20px">Клиент</h1><p class="sub small">Убедите его купить Hustlify</p>
    <div class="chat" id="chat">${bubbles(p.msgs)}</div></div>
    <div class="composer"><div class="top"><span id="left">Реплик осталось: ${p.left}</span><button class="link" data-act="practiceFinish">Завершить сделку</button></div>
    <div class="in"><input id="say" placeholder="Ваш ответ клиенту" data-enter="practiceSay" autocomplete="off"><button class="send" data-act="practiceSay" aria-label="Отправить">${I.send}</button></div></div>`);
  window.scrollTo(0, document.body.scrollHeight);
}
async function practiceSay() {
  const p = S.p, text = val('say');
  if (!text || p.busy) return;
  p.busy = true; p.msgs.push({ role: 'user', content: text });
  $('#say').value = '';
  $('#chat').innerHTML = bubbles(p.msgs) + `<div class="bub c typing">печатает…</div>`;
  window.scrollTo(0, document.body.scrollHeight);
  try {
    const r = await api('practice.say', { session_id: p.id, text });
    p.msgs.push({ role: 'assistant', content: r.reply }); p.left = r.turns_left;
  } catch (e) { toast(e.message); p.msgs.pop(); $('#say').value = text; }
  p.busy = false;
  $('#chat').innerHTML = bubbles(p.msgs); $('#left').textContent = 'Реплик осталось: ' + p.left;
  window.scrollTo(0, document.body.scrollHeight);
}
async function practiceFinish() {
  if (S.p.msgs.filter(m => m.role === 'user').length < 3) return toast('Проведите хотя бы 3 реплики');
  loading('Руководитель оценивает диалог…');
  try {
    const r = await api('practice.finish', { session_id: S.p.id });
    const list = (t, a) => a?.length ? `<h2 class="h2">${t}</h2><div class="list">${a.map(x => `<div class="row"><div class="grow">${esc(x)}</div></div>`).join('')}</div>` : '';
    view(`<div class="screen no-tab">
      <div class="hero"><div class="num">${r.passed && r.reward ? '+' + r.reward : r.score}</div>
      <div class="cap">${r.passed ? (r.reward ? 'HustlifyCoin начислены' : 'Сделка закрыта') : 'Клиент не купил'}</div></div>
      <p>${esc(r.summary)}</p>
      ${list('Получилось', r.strengths)}${list('Что улучшить', r.improvements)}
      <button class="btn" style="margin-top:26px" data-act="${r.passed ? 'toCabinet' : 'practiceStart'}">${r.passed ? 'В личный кабинет' : 'Попробовать снова'}</button>
    </div>`);
  } catch (e) { toast(e.message); chatRender(); }
}

// ───────── home
const pages = {};
pages.home = async () => {
  const m = await api('me'); S.me = m; S.user = m.user;
  const u = m.user, first = u.full_name.split(' ')[0];
  const pct = m.today_total ? m.today_done / m.today_total * 100 : 0;
  view(`<div class="screen">
    <p class="sub" style="margin-bottom:0">Привет, ${esc(first)}</p>
    <div class="hero"><div class="num" id="coinnum" data-v="${u.coins}">0</div><div class="cap">HustlifyCoin</div></div>
    <div class="grid2">
      <div class="card stat"><b>${money(u.balance)}</b><span>Баланс</span></div>
      <div class="card stat"><b>${m.percent}%</b><span>Ваш процент с продаж</span></div>
    </div>
    <div class="card" style="margin-bottom:12px">
      <b>Сегодня</b>
      <p class="mut small" style="margin:4px 0 0">${m.today_total ? `Отправлено на проверку: ${m.today_done} из ${m.today_total}` : 'Подборка на сегодня ещё не получена'}</p>
      <div class="bar"><i style="width:${pct}%"></i></div>
      ${m.next ? `<p class="mut small" style="margin:12px 0 0">До ставки ${m.next[1]}% осталось закрыть ${m.next[0] - m.approved30} бизнес(а) за 30 дней</p>` : ''}
    </div>
    <div class="list">
      <button class="row" data-act="tab" data-k="work">${I.work}<div class="grow"><div class="t">Взять подборку</div><div class="d">Бизнесы без сайта в вашем городе</div></div>${I.chev}</button>
      <button class="row" data-act="learnHome">${I.book}<div class="grow"><div class="t">Методичка</div><div class="d">Все материалы обучения</div></div>${I.chev}</button>
      <button class="row" data-act="practiceIntro">${I.chat}<div class="grow"><div class="t">Тренировка с клиентом</div><div class="d">Отработайте возражения</div></div>${I.chev}</button>
    </div>
  </div>`, { tabbar: true });
  countUp();
};

// ───────── work
const segHtml = (act, cur, items) => `<div class="seg">${items.map(([k, l]) => `<button data-act="${act}" data-k="${k}" class="${cur === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;

pages.work = async () => {
  view(`<div class="screen"><h1 class="title">Работа</h1><p class="sub">Ищите клиентов сами или работайте по базе</p>
    ${segHtml('wseg', S.wseg, [['today', 'Сегодня'], ['history', 'История'], ['leads', 'Клиенты']])}
    <div id="wbody"><div class="spin"></div></div></div>`, { tabbar: true });
  try { $('#wbody').innerHTML = await ({ today: wToday, history: wHistory, leads: wLeads })[S.wseg](); }
  catch (e) { $('#wbody').innerHTML = errBlock(e); }
};

function bizCard(a) {
  const b = a.business || {};
  S.assign[a.id] = a;
  return `<div class="biz">
    <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><h3>${esc(b.name)}</h3><span class="pill ${a.status === 'approved' ? 'solid' : ''}">${STATUS[a.status]}</span></div>
    ${b.category ? `<div class="meta">${esc(b.category)}</div>` : ''}
    ${b.address ? `<div class="meta">${esc(b.address)}</div>` : ''}
    ${b.info ? `<div class="meta" style="margin-top:6px">${esc(b.info)}</div>` : ''}
    ${b.phone ? `<a class="phone" href="tel:${esc(b.phone.replace(/[^+\d]/g, ''))}">${esc(b.phone)}</a>` : ''}
    ${a.status === 'rejected' && a.reviewer_note ? `<div class="note">Комментарий проверяющего: ${esc(a.reviewer_note)}</div>` : ''}
    ${['assigned', 'rejected'].includes(a.status) ? `<div class="foot"><span class="mut small">Свяжитесь и отправьте результат</span><button class="btn sm" data-act="proofSheet" data-id="${a.id}">Отправить</button></div>` : ''}
  </div>`;
}

async function wToday() {
  const d = await api('base.today');
  if (!d.items.length) return `<div class="card">
    <b style="font-family:var(--fd)">Выберите город</b>
    <p class="mut small" style="margin:6px 0 14px">Получите ${d.limit} бизнесов без сайта: название, адрес, телефон и краткая информация. Новая подборка — раз в сутки.</p>
    <label class="field"><input id="city" placeholder="Например, Казань" value="${esc(d.city)}" data-enter="getBase"></label>
    <button class="btn" data-act="getBase">Получить подборку</button></div>`;
  const sent = d.items.filter(a => ['submitted', 'approved'].includes(a.status)).length;
  return `<p class="mut small" style="margin:0 0 14px">Город: ${esc(d.city)}. Отправлено ${sent} из ${d.items.length}.</p>` + d.items.map(bizCard).join('');
}
async function wHistory() {
  const d = await api('base.history');
  return d.items.length ? d.items.map(bizCard).join('') : `<div class="empty"><b>Пока пусто</b>Здесь появятся работы, отправленные на проверку.</div>`;
}
async function wLeads() {
  const d = await api('leads.list');
  S.leads = Object.fromEntries(d.items.map(l => [l.id, l]));
  const LS = { new: 'Новый', contacted: 'Связался', interested: 'Интересуется', won: 'Купил', lost: 'Отказ' };
  return `<button class="btn" style="margin-bottom:16px" data-act="leadSheet">Добавить клиента</button>` +
    (d.items.length ? `<div class="list">${d.items.map(l => `<button class="row" data-act="leadSheet" data-id="${l.id}"><div class="grow"><div class="t">${esc(l.name)}</div><div class="d">${esc([l.niche, l.contact].filter(Boolean).join(', ') || 'Без контактов')}</div></div><span class="pill">${LS[l.status]}</span></button>`).join('')}</div>`
      : `<div class="empty"><b>Клиентов пока нет</b>Найдите первого, пообщайтесь и запишите данные сюда.</div>`);
}

// ───────── top
pages.top = async () => {
  view(`<div class="screen"><h1 class="title">Топ</h1><p class="sub">Лучшие сотрудники отдела</p>
    ${segHtml('tseg', S.tseg, [['coins', 'По коинам'], ['earned', 'По заработку']])}<div id="tbody"><div class="spin"></div></div></div>`, { tabbar: true });
  try {
    const d = await api('top', { kind: S.tseg });
    const fmt = v => S.tseg === 'coins' ? v : money(v);
    const inTop = d.rows.some(r => r.me);
    $('#tbody').innerHTML = d.rows.length ? `<div class="list">${d.rows.map(r => `
      <div class="row ${r.me ? 'me' : ''}"><span class="rank">${r.rank}</span><div class="grow"><div class="t">${esc(r.name)}</div><div class="d">${esc(r.position)}</div></div><span class="val">${fmt(r.value)}</span></div>`).join('')}</div>
      ${inTop ? '' : `<div class="list" style="margin-top:12px"><div class="row me"><span class="rank">${d.my_rank}</span><div class="grow"><div class="t">Вы</div></div><span class="val">${fmt(d.my_value)}</span></div></div>`}`
      : `<div class="empty"><b>Рейтинг пуст</b>Он заполнится, когда сотрудники пройдут обучение.</div>`;
  } catch (e) { $('#tbody').innerHTML = errBlock(e); }
};

// ───────── shop
pages.shop = async () => {
  const d = await api('shop.list');
  S.user.coins = d.coins;
  const res = r => r.code ? `Промокод ${r.code}` : r.until ? 'Буст активен' : 'Заявка отправлена';
  view(`<div class="screen"><h1 class="title">Магазин</h1><p class="sub">У вас ${d.coins} HustlifyCoin</p>
    <div class="list">${d.items.map(i => `<div class="row"><div class="grow"><div class="t">${esc(i.title)}</div><div class="d">${esc(i.description || '')}</div></div>
      <div style="text-align:right"><div class="price" style="margin-bottom:6px">${i.price}</div><button class="btn sm" data-act="buy" data-id="${i.id}" data-t="${esc(i.title)}" data-p="${i.price}" ${d.coins < i.price ? 'disabled' : ''}>Купить</button></div></div>`).join('') || '<div class="empty"><b>Витрина пуста</b></div>'}</div>
    ${d.purchases.length ? `<h2 class="h2">Мои покупки</h2><div class="list">${d.purchases.map(p => `<div class="row"><div class="grow"><div class="t">${esc(p.title)}</div><div class="d">${esc(res(p.result))}</div></div><span class="price">${p.price}</span></div>`).join('')}</div>` : ''}
  </div>`, { tabbar: true });
};

// ───────── profile
pages.me = async () => {
  const m = await api('me'); S.me = m; S.user = m.user;
  const u = m.user, ini = u.full_name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  view(`<div class="screen">
    <div class="avatar">${esc(ini)}</div>
    <h1 class="title">${esc(u.full_name)}</h1><p class="sub">@${esc(u.login)}</p>
    <div class="list">
      <div class="row"><div class="grow mut">Должность</div><b>${esc(u.position)}</b></div>
      <div class="row"><div class="grow mut">Баланс</div><b>${money(u.balance)}</b></div>
      <div class="row"><div class="grow mut">Заработано всего</div><b>${money(u.earned_total)}</b></div>
      <div class="row"><div class="grow mut">HustlifyCoin</div><b>${u.coins}</b></div>
      <div class="row"><div class="grow mut">Процент с продаж</div><b>${m.percent}%${m.boost ? ` (с бустом +${m.boost})` : ''}</b></div>
      <div class="row"><div class="grow mut">Принято работ</div><b>${m.approved_total}</b></div>
    </div>
    <div class="list" style="margin-top:16px">
      ${u.role === 'admin' ? `<button class="row" data-act="adminOpen">${I.shield}<div class="grow t">Панель администратора</div>${I.chev}</button>` : ''}
      <button class="row" data-act="logout">${I.out}<div class="grow t">Выйти</div></button>
    </div></div>`, { tabbar: true });
};

// ───────── admin
async function adminView() {
  view(`<div class="screen no-tab"><button class="back" data-act="tab" data-k="me">${I.back}Профиль</button>
    <h1 class="title">Администратор</h1><p class="sub">Управление платформой</p>
    ${segHtml('aseg', S.aseg, [['stats', 'Обзор'], ['queue', 'Проверка'], ['ai', 'Qwen']])}<div id="abody"><div class="spin"></div></div></div>`);
  try { await ({ stats: aStats, queue: aQueue, ai: aAi })[S.aseg](); } catch (e) { $('#abody').innerHTML = errBlock(e); }
}
async function aStats() {
  const s = await api('admin.stats');
  $('#abody').innerHTML = `<div class="grid2">
    <div class="card stat"><b>${s.users}</b><span>Сотрудников</span></div><div class="card stat"><b>${s.trained}</b><span>Прошли обучение</span></div>
    <div class="card stat"><b>${s.pending_reviews}</b><span>Ждут проверки</span></div><div class="card stat"><b>${s.approved_businesses}</b><span>Принято работ</span></div>
    <div class="card stat"><b>${money(s.sales_amount)}</b><span>Продажи</span></div><div class="card stat"><b>${money(s.payouts_total)}</b><span>Выплаты</span></div>
    <div class="card stat"><b>${s.kb_products} / ${s.kb_cases}</b><span>Товаров / кейсов видит Qwen</span></div>
    <div class="card stat"><b>${s.kb_sent} из ${s.kb_full}</b><span>Символов каталога передаётся</span></div></div></div>
    <h2 class="h2">Записать продажу</h2>
    <label class="field"><span>Логин сотрудника</span><input id="s_login" autocapitalize="none"></label>
    <label class="field"><span>ID бизнеса (вместо логина)</span><input id="s_biz" inputmode="numeric"></label>
    <label class="field"><span>Сумма покупки, ${CUR}</span><input id="s_sum" inputmode="decimal"></label>
    <button class="btn" data-act="saleSubmit">Начислить процент</button>`;
}
async function aQueue() {
  const d = await api('admin.queue');
  $('#abody').innerHTML = d.items.length ? d.items.map(a => `<div class="biz"><h3>${esc(a.business?.name)}</h3>
    <div class="meta">${esc(a.user?.full_name)}, @${esc(a.user?.login)}</div>
    <div class="note">${esc(a.proof_text)}</div>${a.proof_url ? `<img class="proof" src="${esc(a.proof_url)}" alt="Доказательство">` : ''}
    <div class="foot"><button class="btn ghost sm" data-act="reject" data-id="${a.id}">Отклонить</button><button class="btn sm" data-act="approve" data-id="${a.id}">Принять</button></div></div>`).join('')
    : `<div class="empty"><b>Очередь пуста</b>Новые работы появятся здесь.</div>`;
}
function aAi() {
  const ch = S.adminChat;
  $('#abody').innerHTML = `<div class="chat" id="chat">${ch.length ? aiBubbles() : `<div class="list">${['Покажи статистику по платформе', 'Кто ждёт проверки и сколько', 'Добавь в магазин промокод на 15% за 50 коинов'].map(t => `<button class="row" data-act="aiSend" data-t="${esc(t)}"><div class="grow">${esc(t)}</div>${I.chev}</button>`).join('')}</div>`}</div>
    <div class="composer"><div class="in"><input id="ai" placeholder="Задача для Qwen" data-enter="aiSend" autocomplete="off"><button class="send" data-act="aiSend" aria-label="Отправить">${I.send}</button></div></div>`;
}
const aiBubbles = () => S.adminChat.map(m => m.role === 'user' ? `<div class="bub u">${esc(m.content)}</div>` : `<div class="bub c prose">${md(m.content)}${m.actions?.length ? `<p class="mut small" style="margin:8px 0 0">Действия: ${esc(m.actions.map(a => a.tool + (a.ok ? '' : ' (ошибка)')).join(', '))}</p>` : ''}</div>`).join('');
async function aiSend(text) {
  text = text || val('ai'); if (!text || S.aiBusy) return;
  S.aiBusy = true; S.adminChat.push({ role: 'user', content: text });
  $('#abody').querySelector('.chat').innerHTML = aiBubbles() + `<div class="bub c typing">думает…</div>`;
  $('#ai').value = ''; window.scrollTo(0, document.body.scrollHeight);
  try {
    const r = await api('admin.chat', { messages: S.adminChat.map(({ role, content }) => ({ role, content })) });
    S.adminChat.push({ role: 'assistant', content: r.reply || 'Готово', actions: r.actions });
  } catch (e) { toast(e.message); S.adminChat.pop(); }
  S.aiBusy = false; aAi(); window.scrollTo(0, document.body.scrollHeight);
}

// ───────── actions
const A = {
  tab: d => go(d.k),
  logout: () => logout(),
  authMode: d => { S.authMode = d.k; renderAuth(); },
  async authSubmit() {
    const reg = S.authMode === 'register';
    const r = await api(reg ? 'auth.register' : 'auth.login', { login: val('a_login'), password: $('#a_pass').value, full_name: reg ? val('a_name') : undefined });
    token = r.token; localStorage.setItem('h_token', token); S.user = r.user;
    loading();
    try { await enter(); } catch (e) { renderAuth(); throw e; }
  },
  learnHome: () => learnHome(),
  lesson: d => openLesson(d.id),
  quizStart: d => quizStart(d.id),
  pick: d => { S.quiz.ans[S.quiz.i] = Number(d.k); quizRender(); },
  quizNext() { const q = S.quiz; if (q.i + 1 < q.qs.length) { q.i++; quizRender(); } else quizFinish(); },
  practiceIntro, practiceStart, practiceSay, practiceFinish,
  async toCabinet() { loading(); await enter(); },
  wseg: d => { S.wseg = d.k; pages.work(); },
  tseg: d => { S.tseg = d.k; pages.top(); },
  aseg: d => { S.aseg = d.k; adminView(); },
  adminOpen: () => adminView(),
  async getBase() {
    const city = val('city'); if (!city) return toast('Укажите город');
    $('#wbody').innerHTML = `<div class="spin"></div><p class="mut small" style="text-align:center">Ищем бизнесы без сайта…</p>`;
    try { await api('base.today', { city }); } catch (e) { toast(e.message); }
    pages.work();
  },
  proofSheet(d) {
    const a = S.assign[d.id];
    sheet(`<h3>${esc(a.business?.name || 'Бизнес')}</h3>
      <label class="field"><span>Что сделали и чем закончилось</span><textarea id="p_text" placeholder="Позвонил, поговорил с владельцем, договорились о встрече во вторник"></textarea></label>
      <label class="field"><span>Фото или скриншот переписки (по желанию)</span><input id="p_file" type="file" accept="image/*"></label>
      <button class="btn" data-act="proofSend" data-id="${d.id}">Отправить на проверку</button>`);
  },
  async proofSend(d, el) {
    const text = val('p_text'); if (text.length < 20) return toast('Опишите результат подробнее (от 20 символов)');
    el.disabled = true;
    try {
      const f = $('#p_file').files[0];
      const image = f ? await compress(f) : undefined;
      await api('base.submit', { assignment_id: Number(d.id), text, image });
      toast('Отправлено на проверку'); closeSheet(); pages.work();
    } catch (e) { toast(e.message); el.disabled = false; }
  },
  leadSheet(d) {
    const l = S.leads[d.id] || {};
    const opts = [['new', 'Новый'], ['contacted', 'Связался'], ['interested', 'Интересуется'], ['won', 'Купил'], ['lost', 'Отказ']];
    sheet(`<h3>${l.id ? 'Клиент' : 'Новый клиент'}</h3>
      <label class="field"><span>Название или имя</span><input id="l_name" value="${esc(l.name)}"></label>
      <label class="field"><span>Контакт</span><input id="l_contact" value="${esc(l.contact)}" placeholder="Телефон или @username"></label>
      <label class="field"><span>Сфера</span><input id="l_niche" value="${esc(l.niche)}"></label>
      <label class="field"><span>Статус</span><select id="l_status">${opts.map(([k, t]) => `<option value="${k}" ${l.status === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="field"><span>Заметки</span><textarea id="l_notes">${esc(l.notes)}</textarea></label>
      <button class="btn" data-act="leadSave" data-id="${l.id || ''}">Сохранить</button>`);
  },
  async leadSave(d) {
    await api('leads.save', { id: d.id ? Number(d.id) : undefined, name: val('l_name'), contact: val('l_contact'), niche: val('l_niche'), status: $('#l_status').value, notes: val('l_notes') });
    toast('Сохранено'); closeSheet(); pages.work();
  },
  async buy(d) {
    const ok = tg?.showConfirm ? await new Promise(r => tg.showConfirm(`Купить «${d.t}» за ${d.p} коинов?`, r)) : confirm(`Купить «${d.t}» за ${d.p} коинов?`);
    if (!ok) return;
    const r = await api('shop.buy', { item_id: Number(d.id) });
    sheet(`<h3>Готово</h3>${r.result.code ? `<p>Ваш промокод${r.result.discount_percent ? ` на скидку ${r.result.discount_percent}%` : ''}:</p><div class="card" style="font-family:var(--fd);font-weight:600;font-size:20px;text-align:center;margin-bottom:16px">${esc(r.result.code)}</div><button class="btn" data-act="copy" data-t="${esc(r.result.code)}">Скопировать</button>`
      : r.result.until ? `<p>Повышенная ставка уже действует.</p><button class="btn" data-act="closeSheet">Отлично</button>` : `<p>Заявка отправлена руководителю, с вами свяжутся.</p><button class="btn" data-act="closeSheet">Понятно</button>`}`);
    pages.shop();
  },
  async copy(d) { try { await navigator.clipboard.writeText(d.t); toast('Скопировано'); } catch { toast(d.t); } },
  closeSheet,
  async approve(d) { await api('admin.review', { id: Number(d.id), approve: true }); toast('Принято, коины начислены'); aQueue(); },
  reject(d) {
    sheet(`<h3>Что доработать</h3><label class="field"><textarea id="r_note" placeholder="Например: нет подтверждения разговора"></textarea></label><button class="btn" data-act="rejectSend" data-id="${d.id}">Отклонить</button>`);
  },
  async rejectSend(d) { await api('admin.review', { id: Number(d.id), approve: false, note: val('r_note') }); closeSheet(); toast('Отклонено'); aQueue(); },
  async saleSubmit() {
    const r = await api('admin.sale', { login: val('s_login') || undefined, business_id: val('s_biz') ? Number(val('s_biz')) : undefined, amount: val('s_sum') });
    toast(`${r.worker}: +${money(r.payout)} (${r.percent}%)`); aStats();
  },
  aiSend: d => aiSend(d.t),
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = A[el.dataset.act]; if (!fn) return;
  haptic();
  Promise.resolve(fn(el.dataset, el)).catch(err => toast(err.message));
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !e.target.dataset?.enter) return;
  e.preventDefault(); Promise.resolve(A[e.target.dataset.enter]({}, e.target)).catch(err => toast(err.message));
});

// ───────── boot
(async function boot() {
  try { tg?.ready(); tg?.expand(); tg?.disableVerticalSwipes?.(); } catch {}
  applyTheme(); tg?.onEvent?.('themeChanged', applyTheme);
  if (!tg?.initData) {
    view(`<div class="screen no-tab"><div class="brand">Hustlify</div><div class="empty"><b>Откройте в Telegram</b>Приложение работает только внутри бота.</div></div>`);
    return;
  }
  if (!token) return renderAuth();
  loading();
  try { await enter(); } catch { logout(); }
})();
})();
