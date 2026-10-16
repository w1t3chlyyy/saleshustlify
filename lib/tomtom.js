// Источник кандидатов: TomTom Search API (POI). Бесплатно 2 500 запросов в сутки, не более 5 запросов в секунду.
// Из каталога берём только заведения с телефоном, у которых в карточке нет своего сайта и которые не похожи на сети.
// Остаток проверяется веб-поиском (sitecheck.js), а ошибки ловит кнопка «У бизнеса есть сайт» в приложении.

// Историческое имя источника в таблице businesses: на нём завязаны SQL-функция выдачи и фильтры в app.js,
// поэтому оставляем '2gis', а происхождение записи видно по префиксу ext_id ('tt/').
const POOL_SOURCE = '2gis';

const CATEGORIES = [
  'кафе', 'ресторан', 'бар', 'парикмахерская', 'салон красоты', 'барбершоп', 'маникюр', 'автосервис',
  'шиномонтаж', 'автомойка', 'стоматология', 'ветеринарная клиника', 'магазин одежды', 'цветы', 'пекарня',
  'ателье', 'ремонт обуви', 'ремонт телефонов', 'фитнес', 'массаж', 'студия танцев', 'фотостудия',
  'химчистка', 'детский центр', 'зоомагазин', 'мебель',
];

const SOCIAL = [
  ['vk.com', 'vk'], ['vk.ru', 'vk'], ['instagram.com', 'instagram'], ['facebook.com', 'facebook'],
  ['fb.com', 'facebook'], ['t.me', 'telegram'], ['telegram.me', 'telegram'],
];
// Страницы каталогов, мессенджеров и «визиток»: своим сайтом не считаются и в карточку не попадают
const NOT_OWN = [
  'ok.ru', 'youtube.com', 'youtu.be', 'tiktok.com', 'linktr.ee', 'taplink.cc', 'wa.me', '2gis.ru', '2gis.com',
  'yandex.ru', 'yandex.com', 'zoon.ru', 'flamp.ru', 'avito.ru', 'google.com', 'goo.gl',
];
const GENERIC = new Set([
  'кафе', 'столовая', 'бар', 'ресторан', 'пекарня', 'мини', 'бистро', 'закусочная', 'гриль', 'шашлычная',
  'салон', 'красоты', 'парикмахерская', 'магазин', 'цветы', 'автосервис', 'шиномонтаж', 'автомойка', 'ателье',
]);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();
const hostMatch = (h, d) => h === d || h.endsWith('.' + d);
const isGenericName = name => { const w = norm(name).split(' ').filter(Boolean); return !w.length || w.every(x => GENERIC.has(x) || x.length < 3); };

function classifyUrl(raw) {
  const u = String(raw || '').trim();
  if (!u) return { kind: 'none' };
  let host = '';
  try { host = new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return { kind: 'none' }; }
  const href = /^https?:\/\//i.test(u) ? u : 'https://' + u;
  const soc = SOCIAL.find(([d]) => hostMatch(host, d));
  if (soc) return { kind: 'social', key: soc[1], href };
  if (NOT_OWN.some(d => hostMatch(host, d))) return { kind: 'none' };
  return { kind: 'site' };
}

async function poiSearch(query, lat, lon, radius, ofs = 0, attempt = 0) {
  const url = new URL('https://api.tomtom.com/search/2/poiSearch/' + encodeURIComponent(query) + '.json');
  const p = url.searchParams;
  p.set('key', process.env.TOMTOM_API_KEY);
  p.set('lat', lat.toFixed(5));
  p.set('lon', lon.toFixed(5));
  p.set('radius', String(Math.round(radius)));
  p.set('limit', '100');
  p.set('ofs', String(ofs));
  p.set('language', 'ru-RU');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url.toString(), { signal: ctl.signal });
    if (r.status === 403 || r.status === 429) {
      // 403 приходит и при превышении 5 запросов в секунду, и при исчерпании суточного лимита
      if (attempt < 1) { await sleep(1200); return poiSearch(query, lat, lon, radius, ofs, attempt + 1); }
      throw new Error(`TomTom: ключ не принят или суточный лимит исчерпан (HTTP ${r.status})`);
    }
    if (!r.ok) throw new Error('TomTom: HTTP ' + r.status);
    return (await r.json()).results || [];
  } finally { clearTimeout(timer); }
}

async function searchAll(query, lat, lon, radius) {
  const out = [];
  for (let page = 0; page < 2; page++) {
    const res = await poiSearch(query, lat, lon, radius, page * 100);
    out.push(...res);
    if (res.length < 100) break;
  }
  return out;
}

function parse(r, label) {
  if (r.type && r.type !== 'POI') return null;
  const p = r.poi || {}, a = r.address || {}, pos = r.position || {};
  const name = String(p.name || '').trim();
  if (name.length < 2 || name.length > 120 || !r.id) return null;
  const lat = Number(pos.lat), lon = Number(pos.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const phone = String(p.phone || '').trim();
  const digits = phone.replace(/\D/g, '');
  const u = classifyUrl(p.url);
  return {
    id: r.id, extId: 'tt/' + r.id, name, nameKey: norm(name), generic: isGenericName(name),
    phone: digits.length >= 10 ? phone : '', digits: digits.length >= 10 ? digits : '',
    kind: u.kind, social: u.kind === 'social' ? u : null,
    address: String(a.freeformAddress || '').trim(), lat, lon,
    category: label[0].toUpperCase() + label.slice(1),
  };
}

function toRow(c, cityObj) {
  return {
    source: POOL_SOURCE,
    ext_id: c.extId,
    name: c.name,
    category: c.category,
    address: c.address || cityObj.name,
    phone: c.phone,
    contacts: c.social ? { [c.social.key]: c.social.href } : {},
    info: c.social ? 'Данные TomTom. Своего сайта в каталоге нет, есть страница в соцсети.' : 'Данные TomTom. Сайт в каталоге не указан.',
    lat: c.lat,
    lon: c.lon,
    city: cityObj.name,
    city_key: cityObj.key,
    filter_version: 4,
  };
}

// Убираем сети (один и тот же телефон у нескольких точек или то же название с сайтом у соседней точки), заведения с сайтом и без телефона
function finalize(all, cityObj) {
  const items = [...all.values()];
  const siteNames = new Set(), phoneCount = new Map();
  for (const c of items) {
    if (c.kind === 'site' && !c.generic) siteNames.add(c.nameKey);
    if (c.digits) phoneCount.set(c.digits, (phoneCount.get(c.digits) || 0) + 1);
  }
  const rows = [], excluded = new Set(), seen = new Set();
  for (const c of items) {
    const chain = (!c.generic && siteNames.has(c.nameKey)) || (c.digits && phoneCount.get(c.digits) > 1);
    if (c.kind === 'site' || chain) { excluded.add(c.extId); continue; }
    if (!c.phone) continue;
    const dk = c.nameKey + '|' + norm(c.address);
    if (seen.has(dk)) continue;
    seen.add(dk);
    rows.push(toRow(c, cityObj));
  }
  return { rows, excludedExtIds: excluded };
}

// Перебираем категории вокруг центра города, при нехватке кандидатов добавляем смещённые точки.
async function fetchTomTomBusinesses(cityObj, geo, want = 150, deadline = Date.now() + 22000) {
  if (!process.env.TOMTOM_API_KEY) throw new Error('TOMTOM_API_KEY не задан в настройках сервера');
  const radius = Math.min(Math.max(geo.radius || 12000, 8000), 20000);
  const d = 0.1; // примерно 11 км по широте
  const kLon = Math.cos(geo.lat * Math.PI / 180) || 1;
  const points = [[geo.lat, geo.lon], [geo.lat + d, geo.lon], [geo.lat - d, geo.lon], [geo.lat, geo.lon + d / kLon], [geo.lat, geo.lon - d / kLon]];
  const all = new Map();
  const errors = [];
  let requests = 0, result = finalize(all, cityObj);

  outer:
  for (const [lat, lon] of points) {
    for (let i = 0; i < CATEGORIES.length; i += 4) {
      if (Date.now() > deadline) break outer;
      const t0 = Date.now();
      const batch = CATEGORIES.slice(i, i + 4);
      const res = await Promise.all(batch.map(label =>
        searchAll(label, lat, lon, radius).then(list => ({ label, list })).catch(e => { errors.push(e.message); return { label, list: [] }; })));
      for (const { label, list } of res) {
        requests++;
        for (const r of list) {
          const c = parse(r, label);
          if (c && !all.has(c.id)) all.set(c.id, c);
        }
      }
      result = finalize(all, cityObj);
      if (result.rows.length >= want) break outer;
      const spent = Date.now() - t0;
      if (spent < 1000) await sleep(1000 - spent); // не больше 5 запросов в секунду
    }
  }
  if (!all.size && errors.length) throw new Error(errors[0]);
  console.log(`[TomTom] ${cityObj.name}: запросов ${requests}, найдено мест ${all.size}, кандидатов без сайта ${result.rows.length}, ошибок ${errors.length}`);
  return result;
}

module.exports = { fetchTomTomBusinesses, finalize, parse, classifyUrl };
