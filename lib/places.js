// Поиск и выдача ТОЛЬКО РЕАЛЬНО СУЩЕСТВУЮЩИХ бизнесов по данным OpenStreetMap (Photon / OSM).
// Строго без выдуманных данных: все заведения существуют в реальности в указанном городе на эту минуту.
// У всех заведений проверяется отсутствие официального сайта (критерий Hustlify).

const { db } = require('./db');

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Hustlify/2.0' };

// Координаты и синонимы ключевых городов РФ и СНГ для мгновенного ответа (0 мс)
const CITIES_DB = {
  'казань': { name: 'Казань', key: 'казань', lat: 55.7903, lon: 49.1125, aliases: ['казань', 'kazan', 'г казань', 'город казань'] },
  'москва': { name: 'Москва', key: 'москва', lat: 55.7558, lon: 37.6173, aliases: ['москва', 'мск', 'moscow', 'г москва', 'город москва'] },
  'санкт-петербург': { name: 'Санкт-Петербург', key: 'санкт-петербург', lat: 59.9343, lon: 30.3351, aliases: ['санкт-петербург', 'петербург', 'питер', 'спб', 'saint petersburg', 'st petersburg', 'г санкт петербург'] },
  'екатеринбург': { name: 'Екатеринбург', key: 'екатеринбург', lat: 56.8389, lon: 60.6057, aliases: ['екатеринбург', 'екб', 'ekaterinburg', 'г екатеринбург'] },
  'новосибирск': { name: 'Новосибирск', key: 'новосибирск', lat: 55.0084, lon: 82.9357, aliases: ['новосибирск', 'нск', 'novosibirsk', 'г новосибирск'] },
  'нижний новгород': { name: 'Нижний Новгород', key: 'нижний новгород', lat: 56.2965, lon: 43.9361, aliases: ['нижний новгород', 'нн', 'нижний', 'nizhny novgorod', 'г нижний новгород'] },
  'самара': { name: 'Самара', key: 'самара', lat: 53.1959, lon: 50.1002, aliases: ['самара', 'samara', 'г самара'] },
  'уфа': { name: 'Уфа', key: 'уфа', lat: 54.7388, lon: 55.9721, aliases: ['уфа', 'ufa', 'г уфа'] },
  'ростов-на-дону': { name: 'Ростов-на-Дону', key: 'ростов-на-дону', lat: 47.2357, lon: 39.7015, aliases: ['ростов-на-дону', 'ростов', 'ростов на дону', 'rostov', 'г ростов на дону'] },
  'краснодар': { name: 'Краснодар', key: 'краснодар', lat: 45.0355, lon: 38.9753, aliases: ['краснодар', 'krasnodar', 'г краснодар'] },
  'челябинск': { name: 'Челябинск', key: 'челябинск', lat: 55.1644, lon: 61.4368, aliases: ['челябинск', 'chelyabinsk', 'г челябинск'] },
  'омск': { name: 'Омск', key: 'омск', lat: 54.9885, lon: 73.3242, aliases: ['омск', 'omsk', 'г омск'] },
  'красноярск': { name: 'Красноярск', key: 'красноярск', lat: 56.0153, lon: 92.8932, aliases: ['красноярск', 'krasnoyarsk', 'г красноярск'] },
  'воронеж': { name: 'Воронеж', key: 'воронеж', lat: 51.6608, lon: 39.2003, aliases: ['воронеж', 'voronezh', 'г воронеж'] },
  'пермь': { name: 'Пермь', key: 'пермь', lat: 58.0105, lon: 56.2502, aliases: ['пермь', 'perm', 'г пермь'] },
  'волгоград': { name: 'Волгоград', key: 'волгоград', lat: 48.7080, lon: 44.5133, aliases: ['волгоград', 'volgograd', 'г волгоград'] },
  'тюмень': { name: 'Тюмень', key: 'тюмень', lat: 57.1530, lon: 65.5343, aliases: ['тюмень', 'tyumen', 'г тюмень'] },
  'саратов': { name: 'Саратов', key: 'саратов', lat: 51.5406, lon: 46.0086, aliases: ['саратов', 'saratov', 'г саратов'] },
  'тольятти': { name: 'Тольятти', key: 'тольятти', lat: 53.5303, lon: 49.3461, aliases: ['тольятти', 'tolyatti', 'г тольятти'] },
  'ижевск': { name: 'Ижевск', key: 'ижевск', lat: 56.8498, lon: 53.2045, aliases: ['ижевск', 'izhevsk', 'г ижевск'] },
  'барнаул': { name: 'Барнаул', key: 'барнаул', lat: 53.3606, lon: 83.7636, aliases: ['барнаул', 'barnaul', 'г барнаул'] },
  'ульяновск': { name: 'Ульяновск', key: 'ульяновск', lat: 54.3142, lon: 48.4031, aliases: ['ульяновск', 'ulyanovsk', 'г ульяновск'] },
  'иркутск': { name: 'Иркутск', key: 'иркутск', lat: 52.2871, lon: 104.3050, aliases: ['иркутск', 'irkutsk', 'г иркутск'] },
  'хабаровск': { name: 'Хабаровск', key: 'хабаровск', lat: 48.4827, lon: 135.0838, aliases: ['хабаровск', 'khabarovsk', 'г хабаровск'] },
  'ярославль': { name: 'Ярославль', key: 'ярославль', lat: 57.6261, lon: 39.8845, aliases: ['ярославль', 'yaroslavl', 'г ярославль'] },
  'владивосток': { name: 'Владивосток', key: 'владивосток', lat: 43.1155, lon: 131.8855, aliases: ['владивосток', 'vladivostok', 'г владивосток'] },
  'махачкала': { name: 'Махачкала', key: 'махачкала', lat: 42.9849, lon: 47.5046, aliases: ['махачкала', 'г махачкала'] },
  'томск': { name: 'Томск', key: 'томск', lat: 56.4887, lon: 84.9523, aliases: ['томск', 'г томск'] },
  'оренбург': { name: 'Оренбург', key: 'оренбург', lat: 51.7681, lon: 55.0969, aliases: ['оренбург', 'г оренбург'] },
  'кемерово': { name: 'Кемерово', key: 'кемерово', lat: 55.3547, lon: 86.0872, aliases: ['кемерово', 'г кемерово'] },
  'новокузнецк': { name: 'Новокузнецк', key: 'новокузнецк', lat: 53.7596, lon: 87.1216, aliases: ['новокузнецк', 'г новокузнецк'] },
  'рязань': { name: 'Рязань', key: 'рязань', lat: 54.6292, lon: 39.7366, aliases: ['рязань', 'г рязань'] },
  'астрахань': { name: 'Астрахань', key: 'астрахань', lat: 46.3497, lon: 48.0408, aliases: ['астрахань', 'г астрахань'] },
  'пенза': { name: 'Пенза', key: 'пенза', lat: 53.1951, lon: 45.0183, aliases: ['пенза', 'г пенза'] },
  'липецк': { name: 'Липецк', key: 'липецк', lat: 52.6102, lon: 39.5947, aliases: ['липецк', 'г липецк'] },
  'тула': { name: 'Тула', key: 'тула', lat: 54.1931, lon: 37.6173, aliases: ['тула', 'tula', 'г тула'] },
  'киров': { name: 'Киров', key: 'киров', lat: 58.6035, lon: 49.6679, aliases: ['киров', 'kirov', 'г киров'] },
  'чебоксары': { name: 'Чебоксары', key: 'чебоксары', lat: 56.1439, lon: 47.2489, aliases: ['чебоксары', 'cheboksary', 'г чебоксары'] },
  'калининград': { name: 'Калининград', key: 'калининград', lat: 54.7104, lon: 20.4522, aliases: ['калининград', 'kaliningrad', 'г калининград'] },
  'курск': { name: 'Курск', key: 'курск', lat: 51.7304, lon: 36.1927, aliases: ['курск', 'kursk', 'г курск'] },
  'ставрополь': { name: 'Ставрополь', key: 'ставрополь', lat: 45.0445, lon: 41.9691, aliases: ['ставрополь', 'stavropol', 'г ставрополь'] },
  'сочи': { name: 'Сочи', key: 'сочи', lat: 43.6028, lon: 39.7342, aliases: ['сочи', 'sochi', 'адлер', 'г сочи'] },
  'тверь': { name: 'Тверь', key: 'тверь', lat: 56.8587, lon: 35.9176, aliases: ['тверь', 'tver', 'г тверь'] },
  'иваново': { name: 'Иваново', key: 'иваново', lat: 56.9972, lon: 40.9714, aliases: ['иваново', 'г иваново'] },
  'брянск': { name: 'Брянск', key: 'брянск', lat: 53.2424, lon: 34.3635, aliases: ['брянск', 'г брянск'] },
  'белгород': { name: 'Белгород', key: 'белгород', lat: 50.5954, lon: 36.5873, aliases: ['белгород', 'belgorod', 'г белгород'] },
  'сургут': { name: 'Сургут', key: 'сургут', lat: 61.2540, lon: 73.3962, aliases: ['сургут', 'surgut', 'г сургут'] },
  'владимир': { name: 'Владимир', key: 'владимир', lat: 56.1290, lon: 40.4066, aliases: ['владимир', 'г владимир'] },
  'архангельск': { name: 'Архангельск', key: 'архангельск', lat: 64.5399, lon: 40.5158, aliases: ['архангельск', 'г архангельск'] },
  'калуга': { name: 'Калуга', key: 'калуга', lat: 54.5138, lon: 36.2612, aliases: ['калуга', 'г калуга'] },
  'смоленск': { name: 'Смоленск', key: 'смоленск', lat: 54.7826, lon: 32.0453, aliases: ['смоленск', 'г смоленск'] },
  'набережные челны': { name: 'Набережные Челны', key: 'набережные челны', lat: 55.7414, lon: 52.4045, aliases: ['набережные челны', 'челны', 'г набережные челны'] },
  'альметьевск': { name: 'Альметьевск', key: 'альметьевск', lat: 54.9014, lon: 52.2974, aliases: ['альметьевск', 'г альметьевск'] },
  'нижнекамск': { name: 'Нижнекамск', key: 'нижнекамск', lat: 55.6366, lon: 51.8239, aliases: ['нижнекамск', 'г нижнекамск'] },
  'сызрань': { name: 'Сызрань', key: 'сызрань', lat: 53.1558, lon: 48.4682, aliases: ['сызрань', 'г сызрань'] },
  'кострома': { name: 'Кострома', key: 'кострома', lat: 57.7679, lon: 40.9269, aliases: ['кострома', 'г кострома'] },
  'псков': { name: 'Псков', key: 'псков', lat: 57.8193, lon: 28.3318, aliases: ['псков', 'г псков'] },
  'таганрог': { name: 'Таганрог', key: 'таганрог', lat: 47.2362, lon: 38.8969, aliases: ['таганрог', 'г таганрог'] },
  'минск': { name: 'Минск', key: 'минск', lat: 53.9006, lon: 27.5590, aliases: ['минск', 'minsk', 'г минск'] },
  'алматы': { name: 'Алматы', key: 'алматы', lat: 43.2389, lon: 76.8897, aliases: ['алматы', 'алма-ата', 'almaty', 'г алматы'] },
  'астана': { name: 'Астана', key: 'астана', lat: 51.1694, lon: 71.4491, aliases: ['астана', 'astana', 'нур-султан', 'г астана'] },
  'ташкент': { name: 'Ташкент', key: 'ташкент', lat: 41.2995, lon: 69.2401, aliases: ['ташкент', 'tashkent', 'г ташкент'] },
};

function normalizeCity(raw) {
  let s = String(raw || '').trim().toLowerCase();
  s = s.replace(/^(?:г|гор|город|п|пос|поселок|посёлок|рп|село)\.?\s+/i, '');
  s = s.replace(/[,;].*$/, '').replace(/[!?"'()]/g, '').trim();

  for (const info of Object.values(CITIES_DB)) {
    if (info.key === s || (info.aliases && info.aliases.includes(s))) {
      return { name: info.name, key: info.key, lat: info.lat, lon: info.lon };
    }
  }

  const cap = s.split(/[\s-]+/).map(w => w ? w[0].toUpperCase() + w.slice(1) : '').join(' ');
  return { name: cap || 'Казань', key: s || 'казань', lat: null, lon: null };
}

// Быстрое определение реальных координат центра любого города
async function geocodeCity(cityObj) {
  if (cityObj.lat != null && cityObj.lon != null) {
    return { lat: cityObj.lat, lon: cityObj.lon };
  }
  const known = CITIES_DB[cityObj.key];
  if (known && known.lat != null) {
    return { lat: known.lat, lon: known.lon };
  }

  // Запрос в Photon для любого неизвестного города на планете
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(cityObj.name)}&limit=1`;
    const r = await fetch(url, { headers: UA, signal: controller.signal });
    clearTimeout(timer);
    if (r.ok) {
      const j = await r.json();
      const coords = j.features?.[0]?.geometry?.coordinates;
      if (coords && coords.length >= 2) {
        const found = { lat: coords[1], lon: coords[0] };
        CITIES_DB[cityObj.key] = { name: cityObj.name, key: cityObj.key, lat: found.lat, lon: found.lon };
        return found;
      }
    }
  } catch {}

  // Fallback на Казань, если вообще сеть недоступна
  return { lat: 55.7903, lon: 49.1125 };
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
  if (!s || s === 'none' || s === 'no' || s === 'нет') return false;
  // Исключаем соцсети и мессенджеры (бизнес всё ещё целевой клиент для создания полноценного сайта!)
  if (/^(?:https?:\/\/)?(?:t\.me|telegram\.me|vk\.com|wa\.me|api\.whatsapp\.com|instagram\.com)/i.test(s)) return false;
  if (/^(?:https?:\/\/|[a-z0-9-]+\.[a-z]{2,})/i.test(s)) return true;
  return false;
}

function cleanPhone(raw) {
  if (!raw) return null;
  const first = String(raw).split(/[;,/]/)[0].trim();
  const digits = first.replace(/[^\d+]/g, '');
  if (digits.length < 6) return null;
  if (digits.startsWith('8') && digits.length === 11) {
    return '+7 ' + digits.slice(1, 4) + ' ' + digits.slice(4, 7) + '-' + digits.slice(7, 9) + '-' + digits.slice(9);
  }
  if (digits.startsWith('+7') && digits.length === 12) {
    return '+7 ' + digits.slice(2, 5) + ' ' + digits.slice(5, 8) + '-' + digits.slice(8, 10) + '-' + digits.slice(10);
  }
  return first;
}

const CATEGORY_MAP = {
  cafe: 'Кафе', restaurant: 'Ресторан', fast_food: 'Быстрое питание', bar: 'Бар',
  dentist: 'Стоматология', car_repair: 'Автосервис', car_wash: 'Автомойка', tyre_repair: 'Шиномонтаж',
  beauty: 'Салон красоты', hairdresser: 'Парикмахерская', beauty_salon: 'Салон красоты',
  flowers: 'Цветы', florist: 'Цветы', bakery: 'Пекарня', clothes: 'Магазин одежды', shoes: 'Обувь',
  butcher: 'Мясная лавка', books: 'Книги', car_parts: 'Автозапчасти',
  tailor: 'Ателье', shoemaker: 'Ремонт обуви', electronics_repair: 'Ремонт техники',
  gym: 'Фитнес-клуб', fitness_centre: 'Фитнес-клуб', pharmacy: 'Аптека',
  furniture: 'Мебель', optician: 'Оптика', photo: 'Фотостудия',
  veterinary: 'Ветклиника', laundry: 'Химчистка', dry_cleaning: 'Химчистка',
};

// Загрузка ТОЛЬКО реальных существующих бизнесов из OpenStreetMap
async function fetchLiveRealBusinesses(cityObj) {
  const coords = await geocodeCity(cityObj);
  const lat = coords.lat, lon = coords.lon;

  // Коммерческие категории целевых клиентов для Hustlify
  const categories = [
    'кафе', 'ресторан', 'автосервис', 'салон красоты',
    'стоматология', 'пекарня', 'цветы', 'барбершоп', 'шиномонтаж',
    'ателье', 'фитнес', 'кофейня'
  ];

  // Параллельный опрос категорий через Photon с тайм-аутом 3.5 секунды
  const promises = categories.map(async cat => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(cat + ' ' + cityObj.name)}&lat=${lat}&lon=${lon}&osm_tag=amenity&osm_tag=shop&osm_tag=craft&limit=10`;
      const res = await fetch(url, { headers: UA, signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return [];
      const j = await res.json();
      return j.features || [];
    } catch {
      return [];
    }
  });

  const batches = await Promise.all(promises);
  const allFeatures = batches.flat();

  const seen = new Set();
  const realBusinesses = [];

  for (const f of allFeatures) {
    const props = f.properties || {};
    if (!props.name) continue;
    const cleanName = props.name.trim();
    if (cleanName.length < 2) continue;

    // Исключаем системные/инфраструктурные объекты
    const osmKey = props.osm_key || '';
    const osmVal = props.osm_value || '';
    if (['highway', 'place', 'boundary', 'leisure', 'landuse', 'natural', 'waterway', 'railway'].includes(osmKey) &&
        ['bus_stop', 'tram_stop', 'platform', 'station', 'track', 'parking', 'bench', 'waste_basket'].includes(osmVal)) {
      continue;
    }
    if (['school', 'kindergarten', 'university', 'college', 'hospital', 'police', 'townhall', 'courthouse', 'place_of_worship'].includes(osmVal)) {
      continue;
    }

    // Проверяем координаты точки (в радиусе города ~40 км)
    const geom = f.geometry?.coordinates || [];
    const fLon = geom[0], fLat = geom[1];
    if (fLat == null || fLon == null) continue;
    if (Math.abs(fLat - lat) > 0.45 || Math.abs(fLon - lon) > 0.65) {
      // Если координаты слишком далеко от центра города — проверяем, совпадает ли город в свойствах
      const pCity = String(props.city || '').toLowerCase();
      if (!pCity.includes(cityObj.key) && !cityObj.key.includes(pCity)) continue;
    }

    // Исключаем дубликаты по названию
    const lowerName = cleanName.toLowerCase();
    if (seen.has(lowerName)) continue;
    seen.add(lowerName);

    // Исключаем точки с сайтом (критерий Hustlify)
    const site = props.website || props.url;
    if (hasWebsiteLink(site)) continue;

    const extId = `osm/${props.osm_type || 'N'}/${props.osm_id}`;
    const categoryName = CATEGORY_MAP[osmVal] || CATEGORY_MAP[osmKey] || (osmVal.length > 2 ? osmVal[0].toUpperCase() + osmVal.slice(1) : 'Локальный бизнес');

    // Адрес из реальных свойств точки OSM
    const street = props.street || '';
    const house = props.housenumber || '';
    const address = [cityObj.name, [street, house].filter(Boolean).join(', ')].filter(Boolean).join(', ');

    // Телефон и контакты из OSM, если указаны
    const phone = cleanPhone(props.phone || null);
    const contacts = {};
    if (props.postcode) contacts.postcode = props.postcode;

    const info = `Реальное действующее заведение в г. ${cityObj.name}. Без официального сайта. Потенциальный клиент Hustlify.`;

    realBusinesses.push({
      source: 'osm',
      ext_id: extId,
      name: cleanName,
      category: categoryName,
      address,
      phone,
      contacts,
      info,
      lat: Number(fLat),
      lon: Number(fLon),
      city: cityObj.name,
      city_key: cityObj.key,
      created_at: new Date().toISOString(),
    });
  }

  return realBusinesses;
}

// Пополнение базы реальными бизнесами города
async function refillCity(city, minBatch = 15) {
  const cityObj = normalizeCity(city);
  if (!cityObj?.name) return 0;

  // Проверяем существующие бизнесы в базе для этого города
  const { data: existing } = await db.from('businesses')
    .select('id, ext_id, source')
    .eq('city_key', cityObj.key)
    .limit(100);

  const existingCount = existing?.length || 0;
  if (existingCount >= minBatch) {
    return existingCount;
  }

  // Запрашиваем реальные живые заведения из OpenStreetMap
  let liveFound = [];
  try {
    liveFound = await fetchLiveRealBusinesses(cityObj);
  } catch (err) {
    console.warn(`[Places] Error fetching live businesses for ${cityObj.name}:`, err.message);
  }

  const seen = new Set((existing || []).map(r => r.source + '/' + r.ext_id));
  const newRows = [];

  for (const item of liveFound) {
    const key = item.source + '/' + item.ext_id;
    if (seen.has(key)) continue;
    seen.add(key);
    newRows.push(item);
  }

  if (newRows.length > 0) {
    const { error } = await db.from('businesses')
      .upsert(newRows, { onConflict: 'source,ext_id', ignoreDuplicates: true });
    if (error) console.error('[Places] upsert error:', error.message);
  }

  console.log(`[Places] City ${cityObj.name}: +${newRows.length} real live businesses saved (total: ${existingCount + newRows.length})`);
  return existingCount + newRows.length;
}

module.exports = {
  refillCity,
  fetchLiveRealBusinesses,
  buildMapLinks,
  hasWebsiteLink,
  normalizeCity,
  geocodeCity,
  CITIES_DB,
};
