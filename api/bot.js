const { tg } = require('../lib/telegram');
const { db, setting, bustSettings } = require('../lib/db');

const DEFAULT_WELCOME = 'Добро пожаловать в Hustlify 👋\n\nЭто рабочее пространство отдела продаж: обучение, практика с клиентом, база бизнесов, коины и выплаты — всё в одном приложении.\n\nНажмите кнопку ниже, чтобы войти.';

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Telegram entities (UTF-16 offsets) -> HTML, включая премиум-эмодзи
function toHtml(text, entities = []) {
  const SIMPLE = {
    bold: ['<b>', '</b>'], italic: ['<i>', '</i>'], underline: ['<u>', '</u>'],
    strikethrough: ['<s>', '</s>'], spoiler: ['<tg-spoiler>', '</tg-spoiler>'],
    code: ['<code>', '</code>'], pre: ['<pre>', '</pre>'], blockquote: ['<blockquote>', '</blockquote>'],
  };
  const opens = {}, closes = {};
  entities.forEach((e, i) => {
    let o, c;
    if (e.type === 'custom_emoji') { o = `<tg-emoji emoji-id="${e.custom_emoji_id}">`; c = '</tg-emoji>'; }
    else if (e.type === 'text_link') { o = `<a href="${esc(e.url).replace(/"/g, '&quot;')}">`; c = '</a>'; }
    else if (SIMPLE[e.type]) [o, c] = SIMPLE[e.type];
    else return;
    (opens[e.offset] ||= []).push({ o, len: e.length, i });
    (closes[e.offset + e.length] ||= []).push({ c, len: e.length, i });
  });
  let out = '';
  for (let p = 0; p <= text.length; p++) {
    (closes[p] || []).sort((a, b) => a.len - b.len || b.i - a.i).forEach(x => out += x.c);
    (opens[p] || []).sort((a, b) => b.len - a.len || a.i - b.i).forEach(x => out += x.o);
    if (p < text.length) out += esc(text[p]);
  }
  return out;
}

async function isAdmin(id) {
  if ((process.env.ADMIN_TG_IDS || '').split(',').map(s => s.trim()).includes(String(id))) return true;
  const { data } = await db.from('users').select('id').eq('tg_id', id).eq('role', 'admin').maybeSingle();
  return !!data;
}

const save = async (key, value) => { await db.from('settings').upsert({ key, value }); bustSettings(); };
const drop = async keys => { await db.from('settings').delete().in('key', keys); bustSettings(); };

async function sendWelcome(chat_id) {
  const text = await setting('welcome_text', DEFAULT_WELCOME);
  const photo = await setting('welcome_photo', null);
  const reply_markup = { inline_keyboard: [[{ text: 'Открыть Hustlify', web_app: { url: process.env.APP_URL } }]] };
  const base = { chat_id, parse_mode: 'HTML' };
  let r;
  if (photo && text.length <= 1024) r = await tg('sendPhoto', { ...base, photo, caption: text, reply_markup });
  else if (photo) { await tg('sendPhoto', { chat_id, photo }); r = await tg('sendMessage', { ...base, text, reply_markup }); }
  else r = await tg('sendMessage', { ...base, text, reply_markup });
  if (!r?.ok) {
    console.error('welcome failed', r);
    await tg('sendMessage', { chat_id, text: DEFAULT_WELCOME, reply_markup });
  }
}

async function adminCommand(m) {
  const chat_id = m.chat.id;
  const raw = m.text ?? m.caption ?? '';
  const say = text => tg('sendMessage', { chat_id, text });

  if (/^\/welcome_clear\b/.test(raw)) { await drop(['welcome_text', 'welcome_photo']); await say('Приветствие сброшено на стандартное.'); return true; }
  if (/^\/welcome_nophoto\b/.test(raw)) { await drop(['welcome_photo']); await say('Фото убрано.'); return true; }
  if (/^\/welcome_preview\b/.test(raw)) { await sendWelcome(chat_id); return true; }

  const head = /^\/welcome(?:@\w+)?(?:\s+|$)/.exec(raw);
  if (!head) return false;
  const shift = head[0].length;
  const body = raw.slice(shift);
  const ents = (m.entities || m.caption_entities || []).filter(e => e.offset >= shift).map(e => ({ ...e, offset: e.offset - shift }));
  const photo = m.photo?.[m.photo.length - 1]?.file_id;

  if (!body.trim() && !photo) {
    await say('Как менять приветствие:\n\n/welcome текст — новый текст (можно с премиум-эмодзи и форматированием)\nФото с подписью /welcome текст — фото и текст\nФото с подписью /welcome — только фото\n/welcome_nophoto — убрать фото\n/welcome_clear — сбросить всё\n/welcome_preview — посмотреть');
    return true;
  }
  if (body.trim()) await save('welcome_text', toHtml(body, ents));
  if (photo) await save('welcome_photo', photo);
  await say('Сохранено. Вот результат:');
  await sendWelcome(chat_id);
  return true;
}

module.exports = async (req, res) => {
  if (process.env.WEBHOOK_SECRET && req.headers['x-telegram-bot-api-secret-token'] !== process.env.WEBHOOK_SECRET)
    return res.status(401).end();
  try {
    const m = req.body?.message;
    if (m?.chat?.type === 'private') {
      const handled = m.from && /^\/welcome/.test(m.text ?? m.caption ?? '') && await isAdmin(m.from.id) && await adminCommand(m);
      if (!handled) await sendWelcome(m.chat.id);
    }
  } catch (e) { console.error(e); }
  res.status(200).json({ ok: true });
};
