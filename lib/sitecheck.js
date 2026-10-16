// Проверка: есть ли у бизнеса свой сайт или он закрыт. Один поисковый запрос на кандидата, результат кэшируется.
// Ошибка или сомнение = бизнес не выдаём.
const { db } = require('./db');
const KEY = process.env.SERPER_API_KEY;
const CACHE_DAYS = 60;

const AGG = [
  '2gis.ru', '2gis.com', 'yandex.ru', 'yandex.com', 'ya.ru', 'google.com', 'google.ru', 'zoon.ru', 'flamp.ru',
  'tripadvisor.ru', 'tripadvisor.com', 'yell.ru', 'orgpage.ru', 'spr.ru', 'vk.com', 'ok.ru', 'instagram.com',
  'facebook.com', 't.me', 'youtube.com', 'tiktok.com', 'avito.ru', 'hh.ru', 'restoclub.ru', 'afisha.ru',
  'wikipedia.org', 'cataloxy.ru', 'blizko.ru', 'rusprofile.ru', 'list-org.com', 'sbis.ru', 'pulse.mail.ru',
  'profi.ru', 'yclients.com', 'dikidi.net', 'booksy.com', 'ru.foursquare.com', 'foursquare.com', 'dzen.ru',
  'rutube.ru', 'otzovik.com', 'irecommend.ru', 'pagesjaunes.ru', 'yandex.net', 'maps.me', 'rosfirm.ru',
  'checko.ru', 'zachestnyibiznes.ru', 'kontur.ru', 'e-ecolog.ru', 'orgzoom.ru', 'moscow-spr.ru', 'allbiz.ru',
  'cylex.ru', 'pulscen.ru', 'tiu.ru', 'prodoctorov.ru', 'docdoc.ru', 'sberhealth.ru', 'napopravku.ru',
  'wa.me', 'whatsapp.com', 'linktr.ee', 'taplink.cc', 'booking.com', 'ostrovok.ru', 'sutochno.ru',
];
const STOP = new Set([
  'кафе', 'ресторан', 'бар', 'паб', 'салон', 'студия', 'магазин', 'центр', 'клиника', 'ооо', 'ип', 'автосервис',
  'автомойка', 'сервис', 'мастерская', 'ателье', 'пекарня', 'парикмахерская', 'барбершоп', 'фитнес', 'клуб',
  'стоматология', 'ветклиника', 'салоны', 'красоты', 'для', 'при', 'про',
]);
const CLOSED_RE = /закрыто навсегда|навсегда закрыт|permanently closed|прекратил[а-я]* работу|больше не работает/i;

const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[«»"'`().,!?|:;/\\]/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = s => norm(s).split(' ').filter(t => t.length >= 3 && !STOP.has(t));
const hostOf = u => { try { return new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const isAgg = h => AGG.some(d => h === d || h.endsWith('.' + d));

const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ы: 'y', э: 'e', ю: 'yu', я: 'ya' };
const translit = s => [...norm(s)].map(c => TR[c] ?? c).join('').replace(/[^a-z0-9]/g, '');

async function serper(q) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, gl: 'ru', hl: 'ru', num: 10 }),
      signal: ctl.signal,
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(timer); }
}

// true = сайт есть или заведение закрыто (не выдаём), false = чисто, исключение = проверить не удалось
async function hasOwnSite(biz) {
  const toks = tokens(biz.name);
  if (!toks.length) return false; // слишком общее название: по нему поиск ничего не докажет
  const full = norm(biz.name), city = norm(biz.city);
  const need = Math.max(1, Math.ceil(toks.length * 0.6));
  const nameHit = text => {
    const hay = norm(text);
    return hay.includes(full) || toks.filter(t => hay.includes(t)).length >= need;
  };
  const web = await serper(`${biz.name} ${biz.city}`);

  // закрытые заведения не выдаём
  for (const r of [web.knowledgeGraph, ...(web.organic || []).slice(0, 5)].filter(Boolean)) {
    const text = `${r.title || ''} ${r.description || ''} ${r.snippet || ''} ${JSON.stringify(r.attributes || {})}`;
    if (nameHit(r.title || text) && CLOSED_RE.test(text)) return true;
  }

  const kg = web.knowledgeGraph;
  if (kg?.website && !isAgg(hostOf(kg.website)) && nameHit(kg.title || '')) return true;

  const organic = web.organic || [];
  for (let i = 0; i < organic.length; i++) {
    const r = organic[i];
    const host = hostOf(r.link);
    if (!host || isAgg(host)) continue;
    const hay = `${r.title || ''} ${r.snippet || ''}`;
    if (!nameHit(hay)) continue;
    const cityOk = city && norm(hay).includes(city);
    const hostKey = host.replace(/[^a-z0-9а-я]/g, '');
    const nameInHost = toks.some(t => t.length >= 4 && (hostKey.includes(translit(t)) || hostKey.includes(t)));
    if (cityOk || nameInHost || i < 3) return true;
  }
  return false;
}

async function loadCache(extIds) {
  const map = new Map();
  const since = Date.now() - CACHE_DAYS * 864e5;
  try {
    for (let i = 0; i < extIds.length; i += 200) {
      const { data } = await db.from('site_checks').select('ext_id,has_site,checked_at').in('ext_id', extIds.slice(i, i + 200));
      for (const r of data || []) if (new Date(r.checked_at).getTime() > since) map.set(r.ext_id, !!r.has_site);
    }
  } catch (e) { console.warn('[SiteCheck] кэш недоступен:', e.message); }
  return map;
}
async function saveCache(entries) {
  if (!entries.length) return;
  try {
    const now = new Date().toISOString();
    await db.from('site_checks').upsert(entries.map(([ext_id, has_site]) => ({ ext_id, has_site, checked_at: now })), { onConflict: 'ext_id' });
  } catch (e) { console.warn('[SiteCheck] не удалось сохранить кэш:', e.message); }
}

// Проверяет кандидатов небольшими пачками и останавливается, как только набрано want чистых,
// вышло время или клиент отключился (aborted()). Каждая пачка сразу пишется в кэш.
// status: 'complete' | 'enough' | 'deadline' | 'aborted'
async function verifyNoSite(rows, want, { conc = 5, deadline = Infinity, aborted } = {}) {
  if (!KEY) throw new Error('SERPER_API_KEY не задан: без проверки сайтов выдача невозможна.');
  const cache = await loadCache(rows.map(r => r.ext_id));
  const clean = [], withSite = [], unknown = [], todo = [];
  for (const b of rows) {
    const c = cache.get(b.ext_id);
    if (c === true) withSite.push(b);
    else if (c === false) clean.push(b);
    else todo.push(b);
  }
  let status = 'complete', errors = 0, checked = 0, lastErr = '';
  for (let i = 0; i < todo.length; i += conc) {
    if (clean.length >= want) { status = 'enough'; break; }
    if (aborted?.()) { status = 'aborted'; break; }
    if (Date.now() > deadline) { status = 'deadline'; break; }
    const batch = todo.slice(i, i + conc);
    const res = await Promise.all(batch.map(async b => {
      try { return await hasOwnSite(b); } catch (e) { errors++; lastErr = e.message; return null; }
    }));
    const fresh = [];
    batch.forEach((b, k) => {
      checked++;
      if (res[k] === true) { withSite.push(b); fresh.push([b.ext_id, true]); }
      else if (res[k] === false) { clean.push(b); fresh.push([b.ext_id, false]); }
      else unknown.push(b);
    });
    await saveCache(fresh);
    if (errors >= conc && errors === checked) throw new Error('Поиск для проверки сайтов недоступен: ' + lastErr);
  }
  const out = clean.slice(0, want);
  console.log(`[SiteCheck] из кэша ${rows.length - todo.length}, запросов к поиску ${checked}, статус ${status}, чистых ${out.length}`);
  return { clean: out, withSite, unknown, status };
}

module.exports = { verifyNoSite, hasOwnSite };
