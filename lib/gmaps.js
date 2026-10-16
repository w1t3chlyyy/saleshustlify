// Источник кандидатов: Google Maps через Serper /places (1 страница, случайные категории, максимум 15 запросов).
// Отбор: есть телефон, >= MIN_REVIEWS отзывов, не госорганизация, не явное ООО/АО, не сеть.
// Затем проверка сайта и «закрыто» (lib/sitecheck.js) только до набора нужного числа.

const { verifyNoSite } = require('./sitecheck');

const POOL_SOURCE = '2gis'; // историческое имя: на нём завязаны SQL-функция выдачи и app.js. Происхождение видно по ext_id 'gm/…'
const MIN_REVIEWS = Number(process.env.MIN_REVIEWS) || 5;
const MAX_CALLS = 15;

const TERMS = [
  'кафе', 'ресторан', 'барбершоп', 'салон красоты', 'парикмахерская', 'маникюр', 'автосервис', 'шиномонтаж',
  'автомойка', 'стоматология', 'ветеринарная клиника', 'цветочный магазин', 'пекарня', 'ателье', 'ремонт обуви',
  'ремонт телефонов', 'массаж', 'студия танцев', 'фотостудия', 'химчистка', 'детский центр', 'зоомагазин',
];
const SOCIAL = ['vk.com', 'vk.ru', 'instagram.com', 'facebook.com', 't.me', 'telegram.me', 'wa.me', 'ok.ru', 'youtube.com', 'tiktok.com', 'linktr.ee', 'taplink.cc'];
const AGG = ['2gis.ru', '2gis.com', 'yandex.ru', 'yandex.com', 'google.com', 'goo.gl', 'zoon.ru', 'flamp.ru', 'avito.ru', 'yell.ru', 'orgpage.ru', 'yclients.com', 'dikidi.net', 'profi.ru', 'booksy.com', 'tripadvisor.ru', 'tripadvisor.com'];

// Госструктуры, бюджетные учреждения и явные юрлица (ООО/АО/ПАО…): нужны только частные предприниматели
const NOT_IP_RE = /(?:^|[^a-zа-яё0-9])(?:гбу\w*|гку\w*|гбоу\w*|гапоу|гбпоу|фгбу\w*|фгку|мбу\w*|мбоу|мбдоу|мдоу|моу|мау|муп|гуп|фгуп|мкп|гкп|мфц|загс|мвд|мчс|гибдд|гаи|пфр|фнс|суд|ооо|оао|зао|пао|ао|нко|тсж|жэк)(?=$|[^a-zа-яё0-9])|муниципальн|государственн|гос(?:учрежден|предприяти|организац|услуг)|бюджетн|казенн|казённ|федеральн|администрац|министерств|департамент|прокуратур|поликлиник|больниц|госпитал|диспансер|многофункциональн|полици|налогов|пенсионн|росреестр|роспотребнадзор|судебн|мировой судья|военкомат|военн\w* комиссариат|почта россии|почтов\w* отделени|отделени\w* связи|центр занятости|соцзащит|социальн\w* защит|скорой помощи|центр гигиены|общеобразовательн|(?:школа|гимназия|лицей|колледж|техникум)\s*(?:№|n)|детский сад|университет|библиотек|музей|театр|дом культуры|дворец культуры|церковь|храм|мечеть|собор|кладбищ|управляющая компания/iu;

const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();
const hostMatch = (h, d) => h === d || h.endsWith('.' + d);
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function classify(raw) {
  const u = String(raw || '').trim();
  if (!u) return { kind: 'none' };
  const href = /^https?:\/\//i.test(u) ? u : 'https://' + u;
  let host = '';
  try { host = new URL(href).hostname.replace(/^www\./, '').toLowerCase(); } catch { return { kind: 'none' }; }
  const soc = SOCIAL.find(d => hostMatch(host, d));
  if (soc) return { kind: 'social', key: soc === 't.me' || soc === 'telegram.me' ? 'telegram' : soc.split('.')[0], href };
  if (AGG.some(d => hostMatch(host, d))) return { kind: 'none' };
  return { kind: 'site' };
}

function cleanPhone(raw) {
  const first = String(raw || '').split(/[;,]/)[0].trim();
  const d = first.replace(/\D/g, '');
  if (d.length === 11 && (d[0] === '7' || d[0] === '8')) return `+7 ${d.slice(1, 4)} ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}`;
  if (d.length === 10) return `+7 ${d.slice(0, 3)} ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8)}`;
  return '';
}

async function serperPlaces(q) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 9000);
  try {
    const r = await fetch('https://google.serper.dev/places', {
      method: 'POST',
      headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, gl: 'ru', hl: 'ru' }),
      signal: ctl.signal,
    });
    if (!r.ok) throw new Error('Serper HTTP ' + r.status);
    return (await r.json()).places || [];
  } finally { clearTimeout(timer); }
}

function parse(p, term, cityObj) {
  const name = String(p.title || '').trim();
  if (name.length < 2 || name.length > 120) return null;
  if (/закрыт|не работает|closed|ликвидирован/i.test(name)) return null;
  if (NOT_IP_RE.test(`${name} ${p.category || ''}`)) return null;
  const lat = Number(p.latitude), lon = Number(p.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const address = String(p.address || '').trim();
  if (!norm(address).includes(norm(cityObj.name))) return null;
  if (!(Number(p.ratingCount) >= MIN_REVIEWS)) return null;
  const phone = cleanPhone(p.phoneNumber || p.phone);
  if (!phone) return null;
  const id = String(p.cid || p.placeId || '').trim();
  if (!id) return null;
  const u = classify(p.website);
  return {
    id, name, nameKey: norm(name), phone, digits: phone.replace(/\D/g, ''), address, lat, lon,
    kind: u.kind, social: u.kind === 'social' ? u : null,
    category: String(p.category || term).replace(/^./, c => c.toUpperCase()),
    rating: Number(p.rating) || null, reviews: Number(p.ratingCount) || 0,
  };
}

function finalize(all, cityObj) {
  const items = [...all.values()];
  const phones = new Map(), names = new Map();
  for (const c of items) {
    phones.set(c.digits, (phones.get(c.digits) || 0) + 1);
    names.set(c.nameKey, (names.get(c.nameKey) || 0) + 1);
  }
  const rows = [], excluded = new Set(), seen = new Set();
  for (const c of items) {
    if (c.kind === 'site') { excluded.add('gm/' + c.id); continue; }
    if (phones.get(c.digits) > 1 || names.get(c.nameKey) > 1) continue; // сеть или филиалы
    const dk = c.nameKey + '|' + norm(c.address);
    if (seen.has(dk)) continue;
    seen.add(dk);
    rows.push({
      source: POOL_SOURCE,
      ext_id: 'gm/' + c.id,
      name: c.name,
      category: c.category,
      address: c.address,
      phone: c.phone,
      contacts: { gcid: c.id, ...(c.social ? { [c.social.key]: c.social.href } : {}) },
      info: `Google Карты: ${c.reviews} отзывов${c.rating ? `, рейтинг ${c.rating}` : ''}. ${c.social ? 'Своего сайта в карточке нет, есть страница в соцсети.' : 'Сайт в карточке не указан.'}`,
      lat: c.lat, lon: c.lon,
      city: cityObj.name, city_key: cityObj.key,
      filter_version: 4,
    });
  }
  return { rows, excluded };
}

async function fetchGmapsBusinesses(cityObj, { want = 18, deadline = Date.now() + 14000, aborted } = {}) {
  if (!process.env.SERPER_API_KEY) throw new Error('SERPER_API_KEY не задан в настройках сервера');
  const t0 = Date.now();
  const pool = Math.ceil(want * 1.5);
  const terms = shuffle(TERMS);
  const all = new Map(), errors = [];
  let calls = 0, result = { rows: [], excluded: new Set() };

  for (let i = 0; i < terms.length && calls < MAX_CALLS; i += 3) {
    if (aborted?.() || Date.now() > deadline) break;
    const batch = terms.slice(i, i + 3);
    const res = await Promise.all(batch.map(term =>
      serperPlaces(`${term} ${cityObj.name}`)
        .then(list => ({ term, list }))
        .catch(e => { errors.push(e.message); return { term, list: [] }; })));
    calls += batch.length;
    for (const { term, list } of res) {
      for (const p of list) {
        const c = parse(p, term, cityObj);
        if (c && !all.has(c.id)) all.set(c.id, c);
      }
    }
    result = finalize(all, cityObj);
    if (result.rows.length >= pool) break;
  }
  if (!all.size && errors.length) throw new Error(errors[0]);
  console.log(`[Gmaps] ${cityObj.name}: запросов Places ${calls}, карточек ${all.size}, кандидатов ${result.rows.length}, ошибок ${errors.length}`);

  if (aborted?.()) { const out = []; out.excludedExtIds = []; out.status = 'aborted'; return out; }

  const { clean, withSite, status } = await verifyNoSite(result.rows, want, { deadline: t0 + 38000, aborted });
  const excluded = new Set(result.excluded);
  withSite.forEach(r => excluded.add(r.ext_id));
  clean.excludedExtIds = [...excluded];
  clean.status = status;
  console.log(`[Gmaps] ${cityObj.name}: без сайта ${clean.length}, отсеяно ${withSite.length}, статус ${status}`);
  return clean;
}

module.exports = { fetchGmapsBusinesses };
