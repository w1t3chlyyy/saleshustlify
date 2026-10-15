// Проверка: есть ли у бизнеса свой сайт, через веб-поиск. Ошибка или сомнение = бизнес не выдаём.
const KEY = process.env.SERPER_API_KEY;

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

const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[«»"'`().,!?|:;/\\]/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = s => norm(s).split(' ').filter(t => t.length >= 3 && !STOP.has(t));
const hostOf = u => { try { return new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const isAgg = h => AGG.some(d => h === d || h.endsWith('.' + d));

const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ы: 'y', э: 'e', ю: 'yu', я: 'ya' };
const translit = s => [...norm(s)].map(c => TR[c] ?? c).join('').replace(/[^a-z0-9]/g, '');

async function serper(endpoint, q) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch('https://google.serper.dev/' + endpoint, {
      method: 'POST',
      headers: { 'X-API-KEY': KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, gl: 'ru', hl: 'ru', num: 10 }),
      signal: ctl.signal,
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(timer); }
}

// true = сайт есть, false = не найден, null = проверить не удалось
async function hasOwnSite(biz) {
  const toks = tokens(biz.name);
  if (!toks.length) return null; // слишком общее название, судить нельзя
  const full = norm(biz.name), city = norm(biz.city);
  const need = Math.max(1, Math.ceil(toks.length * 0.6));
  const nameHit = text => {
    const hay = norm(text);
    return hay.includes(full) || toks.filter(t => hay.includes(t)).length >= need;
  };
  const q = `${biz.name} ${biz.city}`;

  // Линия 1: обычная выдача + панель знаний
  const web = await serper('search', q);
  const kg = web.knowledgeGraph;
  if (kg?.website && !isAgg(hostOf(kg.website)) && nameHit(kg.title || '')) return true;

  const inOrganic = organic => {
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
  };
  if (inOrganic(web.organic || [])) return true;

  // Линия 2: карточка Google Maps, там часто указан сайт, которого нет в обычной выдаче
  let maps = null;
  try { maps = await serper('places', q); } catch { /* второй линии нет, решаем по первой */ }
  for (const p of maps?.places || []) {
    if (!p.website || isAgg(hostOf(p.website))) continue;
    if (nameHit(p.title || '') && norm(p.address || '').includes(city)) return true;
  }

  // Линия 3: другая формулировка запроса, тоже только для тех, кто прошёл первые две
  try {
    const web2 = await serper('search', `${biz.name} ${biz.city} официальный сайт`);
    if (inOrganic(web2.organic || [])) return true;
  } catch { /* решаем по предыдущим линиям */ }
  return false;
}

// Проверяет кандидатов пачками, пока не наберёт want чистых. Возвращает { clean, withSite, unknown }.
async function verifyNoSite(rows, want, conc = 6) {
  if (!KEY) throw new Error('SERPER_API_KEY не задан: без проверки сайтов выдача невозможна. Добавьте ключ в Vercel Environment Variables.');
  const clean = [], withSite = [], unknown = [];
  let errors = 0, checked = 0, lastErr = '';
  for (let i = 0; i < rows.length && clean.length < want; i += conc) {
    const batch = rows.slice(i, i + conc);
    const res = await Promise.all(batch.map(async b => {
      try { return await hasOwnSite(b); } catch (e) { errors++; lastErr = e.message; return null; }
    }));
    batch.forEach((b, k) => {
      checked++;
      if (res[k] === true) withSite.push(b);
      else if (res[k] === false) clean.push(b);
      else unknown.push(b);
    });
    if (errors >= conc && errors === checked) throw new Error('Поиск для проверки сайтов недоступен: ' + lastErr);
  }
  const out = clean.slice(0, want);
  console.log('[Places] без сайта (для ручной выборочной проверки): ' + out.map(b => b.name).join(' | '));
  return { clean: out, withSite, unknown };
}

module.exports = { verifyNoSite, hasOwnSite };
