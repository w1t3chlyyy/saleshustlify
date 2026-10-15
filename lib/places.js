// Источник бизнес-карточек — API каталога 2ГИС; OpenStreetMap используется как резерв.
// В выдачу попадают реальные организации без указанного сайта и с контактами.

const { db } = require('./db');

const UA = { 'User-Agent': `Hustlify/2.0 (${process.env.CONTACT_EMAIL || 'contact@hustlify.site'})` };
const OSM_SOURCE = 'overpass';
const GIS_SOURCE = '2gis';
const GIS_API_KEY = process.env.GIS_API_KEY;
const MAX_AGE_DAYS = Number(process.env.PLACES_MAX_AGE_DAYS) || 365 * 6; // старше этого срока без правок: считаем неактуальным
const DEFAULT_RADIUS = 12000;
const OVERPASS_URLS = [process.env.OVERPASS_URL, 'https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'].filter(Boolean);
const GIS_SEARCH_TERMS = [
  'кафе', 'рестораны', 'бары', 'стоматологии', 'ветеринарные клиники',
  'автомойки', 'автосервисы', 'салоны красоты', 'парикмахерские',
  'пекарни', 'цветочные магазины', 'магазины одежды', 'зоомагазины',
  'фитнес-клубы', 'ателье', 'ремонт обуви', 'фотостудии', 'мастерские',
  'магазины электроники', 'мебельные магазины', 'сантехнические работы',
  'танцевальные студии',
];

// ───────── города: [название, lat, lon, ...синонимы]
const RAW_CITIES = [
  ['Казань', 55.7903, 49.1125, 'kazan'], ['Москва', 55.7558, 37.6173, 'мск', 'moscow'],
  ['Санкт-Петербург', 59.9343, 30.3351, 'петербург', 'питер', 'спб', 'санкт петербург', 'saint petersburg', 'st petersburg'],
  ['Екатеринбург', 56.8389, 60.6057, 'екб', 'ekaterinburg'], ['Новосибирск', 55.0084, 82.9357, 'нск', 'novosibirsk'],
  ['Нижний Новгород', 56.2965, 43.9361, 'нн', 'нижний', 'nizhny novgorod'], ['Самара', 53.1959, 50.1002],
  ['Уфа', 54.7388, 55.9721], ['Ростов-на-Дону', 47.2357, 39.7015, 'ростов', 'ростов на дону'],
  ['Краснодар', 45.0355, 38.9753], ['Челябинск', 55.1644, 61.4368], ['Омск', 54.9885, 73.3242],
  ['Красноярск', 56.0153, 92.8932], ['Воронеж', 51.6608, 39.2003], ['Пермь', 58.0105, 56.2502],
  ['Волгоград', 48.7080, 44.5133], ['Тюмень', 57.1530, 65.5343], ['Саратов', 51.5406, 46.0086],
  ['Тольятти', 53.5303, 49.3461], ['Ижевск', 56.8498, 53.2045], ['Барнаул', 53.3606, 83.7636],
  ['Ульяновск', 54.3142, 48.4031], ['Иркутск', 52.2871, 104.3050], ['Хабаровск', 48.4827, 135.0838],
  ['Ярославль', 57.6261, 39.8845], ['Владивосток', 43.1155, 131.8855], ['Махачкала', 42.9849, 47.5046],
  ['Томск', 56.4887, 84.9523], ['Оренбург', 51.7681, 55.0969], ['Кемерово', 55.3547, 86.0872],
  ['Новокузнецк', 53.7596, 87.1216], ['Рязань', 54.6292, 39.7366], ['Астрахань', 46.3497, 48.0408],
  ['Пенза', 53.1951, 45.0183], ['Липецк', 52.6102, 39.5947], ['Тула', 54.1931, 37.6177],
  ['Киров', 58.6035, 49.6679], ['Чебоксары', 56.1439, 47.2489], ['Калининград', 54.7104, 20.4522],
  ['Курск', 51.7304, 36.1927], ['Ставрополь', 45.0445, 41.9691], ['Сочи', 43.6028, 39.7342, 'адлер'],
  ['Тверь', 56.8587, 35.9176], ['Иваново', 56.9972, 40.9714], ['Брянск', 53.2424, 34.3635],
  ['Белгород', 50.5954, 36.5873], ['Сургут', 61.2540, 73.3962], ['Владимир', 56.1290, 40.4066],
  ['Архангельск', 64.5399, 40.5158], ['Калуга', 54.5138, 36.2612], ['Смоленск', 54.7826, 32.0453],
  ['Набережные Челны', 55.7414, 52.4045, 'челны'], ['Альметьевск', 54.9014, 52.2974],
  ['Нижнекамск', 55.6366, 51.8239], ['Сызрань', 53.1558, 48.4682], ['Кострома', 57.7679, 40.9269],
  ['Псков', 57.8193, 28.3318], ['Таганрог', 47.2362, 38.8969], ['Минск', 53.9006, 27.5590],
  ['Алматы', 43.2389, 76.8897, 'алма-ата'], ['Астана', 51.1694, 71.4491, 'нур-султан'], ['Ташкент', 41.2995, 69.2401],
];
const CITIES_DB = {};
for (const [name, lat, lon, ...al] of RAW_CITIES) {
  const key = name.toLowerCase();
  CITIES_DB[key] = { name, key, lat, lon, aliases: [key, key.replace(/-/g, ' '), ...al] };
}

function normalizeCity(raw) {
  let s = String(raw || '').trim().toLowerCase();
  s = s.replace(/^(?:г|гор|город|п|пос|поселок|посёлок|рп|село)\.?\s+/i, '');
  s = s.replace(/[,;].*$/, '').replace(/[!?"'()]/g, '').trim();
  for (const info of Object.values(CITIES_DB)) {
    if (info.key === s || info.aliases.includes(s)) return { name: info.name, key: info.key, lat: info.lat, lon: info.lon };
  }
  const name = s.replace(/(^|[\s-])(\S)/g, (m, a, b) => a + b.toUpperCase());
  return { name: name || 'Казань', key: s || 'казань', lat: null, lon: null };
}

// ───────── геокодинг: если город не найден, возвращаем null (раньше подставлялась Казань — это и давало чужие бизнесы)
async function getJson(url, ms, init = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(timer); }
}

const geoCache = new Map();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

async function geocodeCity(c) {
  if (c.lat != null && c.lon != null) return { lat: c.lat, lon: c.lon, radius: DEFAULT_RADIUS };
  if (geoCache.has(c.key)) return geoCache.get(c.key);
  const countries = process.env.PLACES_COUNTRIES ?? 'ru,by,kz,uz,kg,am,az,ge,md,tj,ua';
  const tries = [[true, countries], [false, countries], [true, '']];
  let found = null;
  try {
    for (const [settlement, cc] of tries) {
      const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=ru&q=' + encodeURIComponent(c.name) +
        (settlement ? '&featuretype=settlement' : '') + (cc ? '&countrycodes=' + cc : '');
      const j = await getJson(url, 5000, { headers: UA });
      const r = j?.[0];
      if (r && ['place', 'boundary'].includes(r.category)) { found = r; break; }
    }
  } catch (e) { console.warn('[Places] Nominatim:', e.message); }

  let g = null;
  if (found) {
    const lat = Number(found.lat), lon = Number(found.lon);
    let radius = DEFAULT_RADIUS;
    const bb = (found.boundingbox || []).map(Number); // [south, north, west, east]
    if (bb.length === 4 && bb.every(Number.isFinite)) {
      const dLat = (bb[1] - bb[0]) / 2 * 111000;
      const dLon = (bb[3] - bb[2]) / 2 * 111000 * Math.cos(lat * Math.PI / 180);
      radius = clamp(Math.hypot(dLat, dLon) * 0.8, 3000, 15000);
    }
    g = { lat, lon, radius };
  } else {
    try { // запасной вариант: Photon
      const j = await getJson('https://photon.komoot.io/api/?limit=1&osm_tag=place&q=' + encodeURIComponent(c.name), 4000, { headers: UA });
      const xy = j.features?.[0]?.geometry?.coordinates;
      if (xy?.length >= 2) g = { lat: xy[1], lon: xy[0], radius: 8000 };
    } catch (e) { console.warn('[Places] Photon:', e.message); }
  }
  if (g) geoCache.set(c.key, g);
  return g;
}

function buildMapLinks(b) {
  const city = String(b.city || '').trim();
  const cleanName = String(b.name || '').replace(/[«»"]/g, ' ').trim();
  const address = String(b.address || '').trim();
  const qStr = [city, cleanName, address].filter(Boolean).join(' ').replace(/\s+/g, ' ');
  const q = encodeURIComponent(qStr);
  const hasCoords = b.lat != null && b.lon != null;
  return {
    yandex: hasCoords
      ? `https://yandex.ru/maps/?text=${q}&ll=${b.lon}%2C${b.lat}&sll=${b.lon}%2C${b.lat}&z=17`
      : `https://yandex.ru/maps/?text=${q}&z=17`,
    gis: hasCoords
      ? `https://2gis.ru/search/${q}?m=${b.lon}%2C${b.lat}%2F17`
      : `https://2gis.ru/search/${q}`,
    google: `https://www.google.com/maps/search/?api=1&query=${q}`,
  };
}

function hasWebsiteLink(val) {
  if (!val) return false;
  const s = String(val).trim().toLowerCase();
  if (!s || ['none', 'no', 'нет', 'n/a', 'unknown', '-'].includes(s)) return false;
  // Соцсети и мессенджеры сайтом не считаются: такому бизнесу всё ещё нужен полноценный сайт
  if (/(?:^|[^a-z0-9-])(?:[a-z0-9-]+\.)*(?:t\.me|telegram\.me|vk\.com|wa\.me|api\.whatsapp\.com|instagram\.com|facebook\.com|ok\.ru|youtube\.com|youtu\.be|tiktok\.com|twitter\.com|x\.com|linkedin\.com|rutube\.ru|dzen\.ru|2gis\.(?:ru|kz|kg|by)|yandex\.(?:ru|kz|by)|maps\.yandex\.(?:ru|kz|by)|google\.com\/maps)(?:[/:?#]|$)/i.test(s)) return false;
  return true;
}

function cleanPhone(raw) {
  if (!raw) return null;
  const first = String(raw).split(/[;,]/)[0].trim();
  const plus = first.startsWith('+');
  const d = first.replace(/\D/g, '');
  const ru = n => `+7 ${n.slice(-10, -7)} ${n.slice(-7, -4)}-${n.slice(-4, -2)}-${n.slice(-2)}`;
  if (d.length === 11 && (d[0] === '7' || d[0] === '8') && (!plus || d[0] === '7')) return ru(d);
  if (d.length === 10 && !plus) return ru(d);
  if (plus && d.length >= 10 && d.length <= 15) return '+' + d;
  return null; // короткие номера без кода города для звонка бесполезны
}

function pickContacts(t) {
  const c = {};
  const email = String(t.email || t['contact:email'] || '').split(';')[0].trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) c.email = email;
  const wa = String(t['contact:whatsapp'] || '').replace(/\D/g, '');
  if (wa.length >= 10 && wa.length <= 15) c.whatsapp = wa;
  for (const k of ['telegram', 'vk', 'instagram', 'facebook']) {
    const v = String(t['contact:' + k] || '').split(';')[0].trim();
    if (v && /^[@\w./:%-]+$/.test(v)) c[k] = v;
  }
  return c;
}

function twoGisContacts(item) {
  const contacts = {};
  const groups = [...(item.contact_groups || []), ...(item.org?.contact_groups || [])];
  for (const group of groups) {
    for (const contact of group.contacts || []) {
      const type = String(contact.type || '').toLowerCase();
      const value = String(contact.value || contact.url || contact.text || contact.print_text || '').trim();
      if (!value) continue;
      if (type.includes('phone') || type === 'tel') contacts.phone = contacts.phone || value;
      else if (type.includes('email')) contacts.email = contacts.email || value;
      else if (type.includes('whatsapp')) contacts.whatsapp = contacts.whatsapp || value;
      else if (type.includes('telegram')) contacts.telegram = contacts.telegram || value;
      else if (type === 'vk' || type.includes('vkontakte')) contacts.vk = contacts.vk || value;
      else if (type.includes('instagram')) contacts.instagram = contacts.instagram || value;
      else if (/website|web[_-]?site|homepage|site|url/.test(type)) {
        contacts.websites = contacts.websites || [];
        contacts.websites.push(value);
      }
    }
  }
  return contacts;
}

const PUBLIC_ORGANIZATION_RE = /(?:^|[^a-zа-яё0-9])(?:гбу(?:з|с|о)?|гку|гкб|гбуз|гбоу|гапоу|гбпоу|фгбу(?:з|о|с)?|фгку|фгбоу|фбуз|мбу(?:з|к|о)?|муп|мбоу|мбдоу|мау|гуп|гкп|мкп)(?=$|[^a-zа-яё0-9])|муниципальн\w*|государственн\w*|гос(?:учрежден|предприяти|организац)\w*|бюджетн\w*|казенн\w*|федеральн\w*|администрац\w*|министерств\w*|департамент\w*|прокуратур\w*|поликлиник\w*|больниц\w*|госпитал\w*|диспансер\w*|hospital\w*|polyclinic\w*|dispensary\w*|municipal\w*|government\w*|state[- ]owned|станци\w+\s+скорой\s+(?:медицинской\s+)?помощи|центр\s+гигиены/iu;

function isPublicOrganization(item) {
  const text = [
    item.name,
    item.full_name,
    item.subtype_name,
    item.type,
    ...(Array.isArray(item.rubrics) ? item.rubrics.map(rubric => rubric.name) : []),
    item.org?.name,
    item.org?.name_ex?.legal_name,
  ].filter(Boolean).join(' ');
  return PUBLIC_ORGANIZATION_RE.test(text);
}

function twoGisItemsToRows(items, cityObj, skipped = null, excludedExtIds = null) {
  const rows = [], seen = new Set();
  const skip = (reason, item) => {
    if (skipped) skipped[reason] = (skipped[reason] || 0) + 1;
    if (excludedExtIds && ['has_website', 'public_organization'].includes(reason) && item?.id) {
      excludedExtIds.add(`2gis/${item.id}`);
    }
  };
  for (const item of items || []) {
    const name = String(item.name || '').trim();
    if (name.length < 2 || name.length > 120 || !item.id) { skip('invalid', item); continue; }
    if (item.flags?.temporary_closed === true || item.flags?.temporary_closed === 'true') { skip('closed', item); continue; }
    if (isPublicOrganization(item)) { skip('public_organization', item); continue; }

    const contacts = twoGisContacts(item);
    const websites = [
      ...(contacts.websites || []),
      item.website,
      item.url,
      item.org?.website,
      item.org?.url,
    ];
    if (websites.some(hasWebsiteLink)) { skip('has_website', item); continue; }

    const phone = cleanPhone(contacts.phone);
    const email = String(contacts.email || '').trim();

    const point = item.point || {};
    const geometryPoint = /^POINT\(([-\d.]+)\s+([-\d.]+)\)$/.exec(item.geometry?.centroid || '');
    const rawLon = point.lon ?? geometryPoint?.[1], rawLat = point.lat ?? geometryPoint?.[2];
    const lon = rawLon == null ? null : Number(rawLon);
    const lat = rawLat == null ? null : Number(rawLat);
    const hasCoordinates = Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
      Number.isFinite(lon) && lon >= -180 && lon <= 180;

    const address = String(item.address_name || item.full_address_name || item.full_name || cityObj.name).trim();
    const dedupe = `${name.toLowerCase()}|${address.toLowerCase()}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    rows.push({
      source: GIS_SOURCE,
      ext_id: `2gis/${item.id}`,
      name,
      category: item.rubrics?.[0]?.name || item.subtype_name || item.type || 'Локальный бизнес',
      address: address.startsWith(cityObj.name) ? address : `${cityObj.name}, ${address}`,
      phone,
      contacts: {
        ...(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { email } : {}),
        ...(contacts.whatsapp ? { whatsapp: String(contacts.whatsapp).replace(/\D/g, '') } : {}),
        ...(contacts.telegram ? { telegram: contacts.telegram } : {}),
        ...(contacts.vk ? { vk: contacts.vk } : {}),
        ...(contacts.instagram ? { instagram: contacts.instagram } : {}),
      },
      info: 'Данные из каталога 2ГИС; сайт в карточке не указан.',
      lat: hasCoordinates ? lat : null,
      lon: hasCoordinates ? lon : null,
      city: cityObj.name,
      city_key: cityObj.key,
    });
  }
  return rows;
}

const CATEGORY = {
  cafe: 'Кафе', restaurant: 'Ресторан', fast_food: 'Фастфуд', bar: 'Бар', pub: 'Паб', dentist: 'Стоматология',
  veterinary: 'Ветклиника', car_wash: 'Автомойка', clinic: 'Клиника', driving_school: 'Автошкола',
  hairdresser: 'Парикмахерская', beauty: 'Салон красоты', car_repair: 'Автосервис', tyres: 'Шиномонтаж',
  bakery: 'Пекарня', florist: 'Цветы', clothes: 'Магазин одежды', shoes: 'Обувь', furniture: 'Мебель',
  optician: 'Оптика', jewelry: 'Ювелирный', pet: 'Зоомагазин', gift: 'Подарки', mobile_phone: 'Мобильные телефоны',
  computer: 'Компьютеры', massage: 'Массаж', car_parts: 'Автозапчасти', cosmetics: 'Косметика',
  confectionery: 'Кондитерская', butcher: 'Мясная лавка', laundry: 'Прачечная', dry_cleaning: 'Химчистка',
  photo: 'Фото', bicycle: 'Велосипеды', interior: 'Интерьер', hardware: 'Хозтовары', electronics: 'Электроника',
  tattoo: 'Тату-салон', tailor: 'Ателье', shoemaker: 'Ремонт обуви', carpenter: 'Столярная мастерская',
  electrician: 'Электромонтаж', photographer: 'Фотограф', jeweller: 'Ювелирная мастерская', plumber: 'Сантехника',
  hvac: 'Климатическое оборудование', fitness_centre: 'Фитнес-клуб', sports_centre: 'Спортивный центр', dance: 'Студия танцев',
};

// ───────── запрос к Overpass
const KINDS = {
  amenity: 'cafe|restaurant|fast_food|bar|pub|dentist|veterinary|car_wash|clinic|driving_school',
  shop: 'hairdresser|beauty|car_repair|tyres|bakery|florist|clothes|shoes|furniture|optician|jewelry|pet|gift|mobile_phone|computer|massage|car_parts|cosmetics|confectionery|butcher|laundry|dry_cleaning|photo|bicycle|interior|hardware|electronics|tailor|tattoo',
  craft: 'tailor|shoemaker|carpenter|electrician|photographer|jeweller|plumber|hvac',
  leisure: 'fitness_centre|sports_centre|dance',
};
const HAS_CONTACT = '[~"^(phone|contact:phone|contact:whatsapp|contact:telegram|email|contact:email)$"~"."]';
const NO_SITE_NO_CHAIN = '[!"website"][!"contact:website"][!"url"][!"contact:url"][!"brand"][!"brand:wikidata"]';

function buildQuery(lat, lon, radius) {
  const around = `(around:${Math.round(radius)},${lat.toFixed(5)},${lon.toFixed(5)})`;
  const parts = Object.entries(KINDS)
    .map(([k, v]) => `  nwr${around}["name"]${HAS_CONTACT}${NO_SITE_NO_CHAIN}["${k}"~"^(${v})$"];`)
    .join('\n');
  return `[out:json][timeout:25];\n(\n${parts}\n);\nout center meta qt 1500;`;
}

async function runOverpass(query) {
  let lastErr = null;
  for (let i = 0; i < OVERPASS_URLS.length; i++) {
    try {
      const j = await getJson(OVERPASS_URLS[i], i === 0 ? 26000 : 18000, {
        method: 'POST',
        headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
      });
      if (!Array.isArray(j?.elements)) throw new Error('Overpass: пустой ответ');
      return j.elements;
    } catch (e) { lastErr = e; console.warn('[Places] Overpass', OVERPASS_URLS[i], e.message); }
  }
  throw lastErr || new Error('Overpass недоступен');
}

const CLOSED_NAME_RE = /закрыт|не работает|closed|снесен|ликвидирован/i;

function lastTouched(el) {
  const ts = el.timestamp ? Date.parse(el.timestamp) : 0;
  const cd = el.tags?.check_date ? Date.parse(el.tags.check_date) : 0;
  return Math.max(ts || 0, cd || 0);
}

function businessDedupeKey(b) {
  return `${String(b.name || '').toLowerCase().trim()}|${String(b.address || '').toLowerCase().trim()}`;
}

// Превращает элементы Overpass в строки таблицы businesses (с жёсткими фильтрами)
function elementsToRows(elements, cityObj) {
  const out = [], seen = new Set(), now = Date.now();
  for (const el of elements || []) {
    const t = el.tags || {};
    const name = String(t.name || '').trim();
    if (name.length < 2 || name.length > 120) continue;
    if (CLOSED_NAME_RE.test(name) || t.disused || t.abandoned || t.opening_hours === 'off') continue;
    if ([t.website, t['contact:website'], t.url, t['contact:url']].some(hasWebsiteLink)) continue;

    const touched = lastTouched(el);
    if (touched && now - touched > MAX_AGE_DAYS * 864e5) continue;

    const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;
    const addrCity = String(t['addr:city'] || '').trim().toLowerCase();
    if (addrCity && !(addrCity.includes(cityObj.key) || cityObj.key.includes(addrCity))) continue;

    const phone = cleanPhone(t.phone || t['contact:phone']);
    const contacts = pickContacts(t);
    if (!phone && !(contacts.email || contacts.whatsapp || contacts.telegram)) continue;

    const street = String(t['addr:street'] || '').trim(), house = String(t['addr:housenumber'] || '').trim();
    const dedupe = name.toLowerCase() + '|' + (street || house ? street + house : Number(lat).toFixed(3) + Number(lon).toFixed(3));
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    const hours = t.opening_hours ? ` Часы работы: ${String(t.opening_hours).slice(0, 120)}.` : '';
    out.push({
      source: OSM_SOURCE,
      ext_id: `osm/${el.type}/${el.id}`,
      name,
      category: CATEGORY[t.amenity] || CATEGORY[t.shop] || CATEGORY[t.craft] || CATEGORY[t.leisure] || 'Локальный бизнес',
      address: [cityObj.name, [street, house].filter(Boolean).join(', ')].filter(Boolean).join(', '),
      phone,
      contacts,
      info: `Данные OpenStreetMap, сайт не указан.${hours}`,
      lat: Number(lat),
      lon: Number(lon),
      city: cityObj.name,
      city_key: cityObj.key,
    });
  }
  return out;
}

async function fetchLiveRealBusinesses(cityObj, attempt = 0) {
  const geo = cityObj.lat != null && cityObj.lon != null
    ? { lat: cityObj.lat, lon: cityObj.lon, radius: DEFAULT_RADIUS }
    : null;
  if (!GIS_API_KEY) {
    throw new Error('GIS_API_KEY не задан в настройках сервера. Добавьте ключ Places API 2ГИС в Vercel Environment Variables.');
  }
  const rows = await fetchTwoGisBusinesses(cityObj, geo, 30);
  console.log(`[Places] 2ГИС ${cityObj.name}: найдено подходящих карточек ${rows.length}`);
  return rows;
}

async function fetchTwoGisBusinesses(cityObj, geo, targetCount = 15) {
  const radius = geo ? Math.min(50000, Math.max(geo.radius, 25000)) : null;
  const fields = [
    'items.point', 'items.geometry.centroid', 'items.contact_groups',
    'items.org', 'items.rubrics', 'items.flags', 'items.address_name',
    'items.full_address_name', 'items.name', 'items.type', 'items.subtype_name',
  ].join(',');
  const results = [];
  const failedTerms = [];
  let successfulTerms = 0;

  const fetchPage = async (term, page) => {
    const url = new URL('https://catalog.api.2gis.com/3.0/items');
    url.searchParams.set('q', geo ? term : `${term} ${cityObj.name}`);
    url.searchParams.set('type', 'branch');
    if (geo) {
      url.searchParams.set('point', `${geo.lon},${geo.lat}`);
      url.searchParams.set('radius', String(radius));
    }
    url.searchParams.set('page_size', '10');
    url.searchParams.set('page', String(page));
    url.searchParams.set('fields', fields);
    url.searchParams.set('key', GIS_API_KEY);
    try {
      let response;
      try {
        response = await getJson(url.toString(), 9000, { headers: UA });
      } catch (err) {
        if (err.name !== 'AbortError') throw err;
        console.warn(`[Places] 2ГИС: тайм-аут запроса «${term}», повтор`);
        response = await getJson(url.toString(), 15000, { headers: UA });
      }
      if (response?.meta?.code && Number(response.meta.code) !== 200) {
        const apiError = response.meta.error;
        const message = typeof apiError === 'string' ? apiError : apiError?.message;
        throw new Error(`код API ${response.meta.code}${message ? `: ${message}` : ''}`);
      }
      if (!Array.isArray(response?.result?.items)) throw new Error('некорректный ответ API');
      successfulTerms++;
      return response.result.items;
    } catch (err) {
      failedTerms.push(`${term} (страница ${page}): ${err.message}`);
      return [];
    }
  };

  for (let i = 0; i < GIS_SEARCH_TERMS.length; i += 5) {
    const batch = GIS_SEARCH_TERMS.slice(i, i + 5);
    const firstPage = (await Promise.all(batch.map(term => fetchPage(term, 1)))).flat();
    results.push(...firstPage);
    if (successfulTerms === 0) {
      throw new Error(`Places API 2ГИС отклонил все запросы: ${failedTerms.slice(0, 2).join('; ')}`);
    }
    if (twoGisItemsToRows(results, cityObj).length < targetCount) {
      const secondPage = (await Promise.all(batch.map(term => fetchPage(term, 2)))).flat();
      results.push(...secondPage);
    }
    if (twoGisItemsToRows(results, cityObj).length >= targetCount) break;
  }

  if (failedTerms.length) {
    console.warn(`[Places] 2ГИС: не выполнено запросов ${failedTerms.length}; ${failedTerms.slice(0, 3).join('; ')}`);
  }
  if (successfulTerms === 0) {
    throw new Error('не удалось выполнить ни одного запроса к Places API');
  }
  const skipped = {};
  const excludedExtIds = new Set();
  const rows = twoGisItemsToRows(results, cityObj, skipped, excludedExtIds);
  rows.excludedExtIds = [...excludedExtIds];
  console.log(`[Places] 2ГИС ${cityObj.name}: в ответах каталога ${results.length}, найдено без сайта ${rows.length}; исключено: ${JSON.stringify(skipped)}`);
  return rows;
}

async function fetchOsmBusinesses(cityObj, geo, attempt) {
  let { lat, lon, radius } = geo;
  // Повторные запросы в большом городе смотрят в случайный район, иначе Overpass вернёт те же заведения
  if (attempt > 0 && radius >= 8000) {
    const ang = Math.random() * 2 * Math.PI, dist = Math.random() * radius * 0.6;
    lat += (Math.sin(ang) * dist) / 111000;
    lon += (Math.cos(ang) * dist) / (111000 * Math.cos(lat * Math.PI / 180));
    radius = Math.max(2500, radius * 0.45);
  }
  return elementsToRows(await runOverpass(buildQuery(lat, lon, radius)), cityObj);
}

// ───────── пополнение базы города
const refillState = new Map(); // city_key -> { t, n }
const countCity = async key => {
  const { count, error } = await db.from('businesses').select('*', { count: 'exact', head: true }).eq('city_key', key);
  if (error) throw error;
  return count || 0;
};

async function removeRejectedUnassigned(cityObj, extIds) {
  if (!extIds.length) return;
  const { data: businesses, error } = await db.from('businesses')
    .select('id,ext_id')
    .eq('source', GIS_SOURCE)
    .eq('city_key', cityObj.key)
    .in('ext_id', extIds);
  if (error) throw error;
  const ids = (businesses || []).map(business => business.id);
  if (!ids.length) return;

  const { data: assignments, error: assignmentsError } = await db.from('assignments')
    .select('business_id,status')
    .in('business_id', ids);
  if (assignmentsError) throw assignmentsError;
  const hasHistory = new Set((assignments || [])
    .filter(assignment => assignment.status !== 'assigned')
    .map(assignment => assignment.business_id));
  const removableIds = ids.filter(id => !hasHistory.has(id));
  if (!removableIds.length) return;

  const { error: deleteAssignmentsError } = await db.from('assignments')
    .delete()
    .in('business_id', removableIds)
    .eq('status', 'assigned');
  if (deleteAssignmentsError) throw deleteAssignmentsError;
  const { error: deleteBusinessesError } = await db.from('businesses')
    .delete()
    .in('id', removableIds);
  if (deleteBusinessesError) throw deleteBusinessesError;
  console.log(`[Places] ${cityObj.name}: удалено ${removableIds.length} ранее выданных бизнесов с сайтом или госорганизаций`);
}

// Всегда подтягивает свежие реальные заведения (дубликаты отсекаются по source+ext_id). Возвращает число бизнесов города в базе.
async function refillCity(city) {
  const cityObj = normalizeCity(city);
  if (!cityObj?.name) return 0;
  const st = refillState.get(cityObj.key) || { t: 0, n: 0 };
  if (Date.now() - st.t < 20000) return countCity(cityObj.key); // защита от шквала одинаковых запросов
  refillState.set(cityObj.key, { t: Date.now(), n: st.n + 1 });

  let rows;
  try {
    rows = await fetchLiveRealBusinesses(cityObj, st.n);
  } catch (err) {
    refillState.set(cityObj.key, { t: 0, n: st.n + 1 });
    console.error(`[Places] ${cityObj.name}: поиск не выполнен:`, err.message);
    throw err;
  }

  await removeRejectedUnassigned(cityObj, rows.excludedExtIds || []);
  if (rows.length) {
    const { data: existing, error } = await db.from('businesses').select('name,address').eq('city_key', cityObj.key);
    if (error) throw error;
    const existingKeys = new Set((existing || []).map(businessDedupeKey));
    rows = rows.filter(row => {
      const key = businessDedupeKey(row);
      if (existingKeys.has(key)) return false;
      existingKeys.add(key);
      return true;
    });
  }

  let added = 0;
  for (let i = 0; i < rows.length; i += 250) {
    const { data, error } = await db.from('businesses')
      .upsert(rows.slice(i, i + 250), { onConflict: 'source,ext_id', ignoreDuplicates: true }).select('id');
    if (error) {
      console.error('[Places] upsert error:', error.message);
      throw error;
    }
    added += data?.length || 0;
  }
  const total = await countCity(cityObj.key);
  console.log(`[Places] ${cityObj.name}: источник 2ГИС, новых ${added}, всего в базе ${total}`);
  return total;
}

module.exports = {
  refillCity, fetchLiveRealBusinesses, fetchTwoGisBusinesses, twoGisItemsToRows,
  elementsToRows, buildQuery, buildMapLinks, hasWebsiteLink, normalizeCity, geocodeCity, CITIES_DB,
};
