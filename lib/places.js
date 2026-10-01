// Поиск бизнесов БЕЗ сайта. По умолчанию — OpenStreetMap (бесплатно, без ключа).
// Для России охват лучше у 2GIS: PLACES_PROVIDER=2gis + GIS_API_KEY.
const { db } = require('./db');

const UA = { 'User-Agent': 'HustlifyBot/1.0 (' + (process.env.CONTACT_EMAIL || 'admin@hustlify.app') + ')' };
const KEYS = ['shop', 'amenity', 'craft', 'office', 'leisure'];
// Бизнес подходит, если указан хотя бы один из этих контактов
const MUST = ['phone', 'contact:phone', 'email', 'contact:email', 'contact:telegram', 'contact:vk', 'contact:whatsapp', 'contact:instagram', 'contact:facebook'];
const CONTACT_TAGS = {
  email: ['email', 'contact:email'], telegram: ['contact:telegram'], vk: ['contact:vk'],
  whatsapp: ['contact:whatsapp'], instagram: ['contact:instagram'], facebook: ['contact:facebook'],
};
const first = (t, keys) => { for (const k of keys) if (t[k]) return String(t[k]).split(';')[0].trim(); return null; };

async function geocode(city) {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=ru&q=${encodeURIComponent(city)}`, { headers: UA });
  const j = await r.json();
  return j[0] || null;
}

async function osm(city) {
  const g = await geocode(city);
  if (!g) throw new Error('Город не найден');
  let scope = '', tail;
  if (g.osm_type === 'relation') {
    scope = `area(${3600000000 + Number(g.osm_id)})->.a;`;
    tail = '(area.a)';
  } else {
    const [s, n, w, e] = g.boundingbox;
    tail = `(${s},${w},${n},${e})`;
  }
  const parts = [];
  for (const k of KEYS) for (const c of MUST)
    parts.push(`nwr["name"]["${k}"]["${c}"][!"website"][!"contact:website"][!"url"]${tail};`);
  const q = `[out:json][timeout:40];${scope}(${parts.join('')});out center 200;`;
  const r = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(q),
  });
  const j = await r.json();
  return (j.elements || []).map(e => {
    const t = e.tags || {};
    const contacts = {};
    for (const [k, tags] of Object.entries(CONTACT_TAGS)) { const v = first(t, tags); if (v) contacts[k] = v; }
    return {
      source: 'osm',
      ext_id: e.type + '/' + e.id,
      name: t.name,
      category: t.shop || t.amenity || t.craft || t.office || t.leisure || null,
      address: [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(', ') || null,
      phone: first(t, ['phone', 'contact:phone']),
      contacts,
      info: [t.opening_hours && 'Часы работы: ' + t.opening_hours, t.description, t.cuisine && 'Кухня: ' + t.cuisine].filter(Boolean).join('. ') || null,
      lat: e.lat ?? e.center?.lat ?? null,
      lon: e.lon ?? e.center?.lon ?? null,
    };
  });
}

const GIS_TYPES = { email: 'email', telegram: 'telegram', whatsapp: 'whatsapp', vkontakte: 'vk', instagram: 'instagram', facebook: 'facebook' };

async function gis(city) {
  const key = process.env.GIS_API_KEY;
  if (!key) throw new Error('GIS_API_KEY не задан');
  const cats = ['кафе', 'салон красоты', 'автосервис', 'барбершоп', 'стоматология', 'фитнес', 'магазин одежды', 'цветы'];
  const out = [];
  for (const c of cats) {
    const url = `https://catalog.api.2gis.com/3.0/items?q=${encodeURIComponent(c + ' ' + city)}&type=branch&page_size=50&fields=items.point,items.address_name,items.contact_groups,items.rubrics&key=${key}`;
    const j = await (await fetch(url)).json();
    for (const it of j.result?.items || []) {
      const all = (it.contact_groups || []).flatMap(g => g.contacts || []);
      if (all.some(x => x.type === 'website')) continue;
      const phone = all.find(x => x.type === 'phone')?.text || null;
      const contacts = {};
      for (const x of all) { const k = GIS_TYPES[x.type]; if (k && !contacts[k]) contacts[k] = x.value || x.text; }
      if (!phone && !Object.keys(contacts).length) continue;
      out.push({
        source: '2gis', ext_id: String(it.id), name: it.name,
        category: it.rubrics?.[0]?.name || c, address: it.address_name || null,
        phone, contacts, info: null, lat: it.point?.lat ?? null, lon: it.point?.lon ?? null,
      });
    }
  }
  return out;
}

async function refillCity(city) {
  const provider = process.env.PLACES_PROVIDER || 'osm';
  const raw = provider === '2gis' ? await gis(city) : await osm(city);
  const rows = raw
    .filter(r => r.name && (r.phone || Object.keys(r.contacts || {}).length))
    .map(r => ({ ...r, city, city_key: city.trim().toLowerCase() }));
  if (!rows.length) return 0;
  // ignoreDuplicates: false, чтобы у уже сохранённых бизнесов дописались контакты
  const { error } = await db.from('businesses').upsert(rows, { onConflict: 'source,ext_id', ignoreDuplicates: false });
  if (error) throw error;
  return rows.length;
}

module.exports = { refillCity };
