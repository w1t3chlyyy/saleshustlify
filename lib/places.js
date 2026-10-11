// Поиск бизнесов БЕЗ сайта и проверка каждого кандидата во внешних справочниках.
// Кандидаты: OpenStreetMap (по умолчанию) или 2GIS (PLACES_PROVIDER=2gis + GIS_API_KEY).
// Проверка: Яндекс Геопоиск (YANDEX_API_KEY) и/или 2GIS (GIS_API_KEY).
// Выдаётся сотрудникам только то, что check_status = 'ok' (см. claim_businesses в миграции 002).
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
const http = (url, opts = {}, ms = 15000) => fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
const cityKey = c => String(c || '').trim().toLowerCase();

// ───────── Источник 1: OpenStreetMap
async function geocode(city) {
  const r = await http(`https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=ru&q=${encodeURIComponent(city)}`, { headers: UA });
  const j = await r.json();
  return j[0] || null;
}

const CLOSED_RE = /(постоянно|навсегда|временно)\s+закрыт|permanently closed|не работает/i;
const isDead = t => t.disused === 'yes' || t.abandoned === 'yes' || t.opening_hours === 'off'
  || CLOSED_RE.test([t.note, t.description, t.name].filter(Boolean).join(' '));

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
    parts.push(`nwr["name"][!"disused"][!"abandoned"]["${k}"]["${c}"][!"website"][!"contact:website"][!"url"][!"contact:url"]${tail};`);
  const q = `[out:json][timeout:25];${scope}(${parts.join('')});out center 400;`;
  const r = await http('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(q),
  }, 30000);
  const j = await r.json();
  return (j.elements || []).filter(e => !isDead(e.tags || {})).map(e => {
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

// ───────── Источник 2: 2GIS
const GIS_TYPES = { email: 'email', telegram: 'telegram', whatsapp: 'whatsapp', vkontakte: 'vk', instagram: 'instagram', facebook: 'facebook' };

async function gis(city) {
  const key = process.env.GIS_API_KEY;
  if (!key) throw new Error('GIS_API_KEY не задан');
  const cats = ['кафе', 'салон красоты', 'автосервис', 'барбершоп', 'стоматология', 'фитнес', 'магазин одежды', 'цветы'];
  const out = new Map();
  for (const c of cats) {
    const url = `https://catalog.api.2gis.com/3.0/items?q=${encodeURIComponent(c + ' ' + city)}&type=branch&page_size=50&fields=items.point,items.address_name,items.contact_groups,items.rubrics&key=${key}`;
    const j = await (await http(url)).json();
    for (const it of j.result?.items || []) {
      const all = (it.contact_groups || []).flatMap(g => g.contacts || []);
      if (all.some(x => x.type === 'website')) continue;
      const phone = all.find(x => x.type === 'phone')?.text || null;
      const contacts = {};
      for (const x of all) { const k = GIS_TYPES[x.type]; if (k && !contacts[k]) contacts[k] = x.value || x.text; }
      if (!phone && !Object.keys(contacts).length) continue;
      const ext_id = String(it.id);
      if (out.has(ext_id)) continue; // один бизнес мог попасть в несколько категорий
      out.set(ext_id, {
        source: '2gis', ext_id, name: it.name,
        category: it.rubrics?.[0]?.name || c, address: it.address_name || null,
        phone, contacts, info: null, lat: it.point?.lat ?? null, lon: it.point?.lon ?? null,
      });
    }
  }
  return [...out.values()];
}

// ───────── Проверка кандидата
const LEGAL = new Set(['ооо', 'ип', 'зао', 'оао', 'ао', 'пао', 'llc', 'ltd']);
const tok = s => String(s || '').toLowerCase().replace(/ё/g, 'е').split(/[^a-zа-я0-9]+/).filter(w => w.length > 1 && !LEGAL.has(w));
const sameName = (a, b) => {
  const A = tok(a), B = tok(b);
  if (!A.length || !B.length) return false;
  const set = new Set(B);
  return A.filter(w => set.has(w)).length / Math.min(A.length, B.length) >= 0.5;
};
const digits = s => { const d = String(s || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };
const meters = (lat1, lon1, lat2, lon2) => {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};
// Та же организация: совпал телефон, либо похожее название рядом (до 300 м)
const isMatch = (b, name, phones, lat, lon) => {
  const mine = digits(b.phone);
  if (mine && phones.some(p => digits(p) === mine)) return true;
  if (!sameName(b.name, name)) return false;
  if (b.lat == null || lat == null || lon == null) return true;
  return meters(b.lat, b.lon, lat, lon) <= 300;
};

// Яндекс Геопоиск по организациям: https://yandex.ru/dev/geosearch/
async function checkYandex(b) {
  const key = process.env.YANDEX_API_KEY;
  if (!key) return null;
  const p = new URLSearchParams({ apikey: key, lang: 'ru_RU', type: 'biz', results: '5' });
  if (b.lat != null && b.lon != null) {
    p.set('text', b.name); p.set('ll', `${b.lon},${b.lat}`); p.set('spn', '0.006,0.004'); p.set('rspn', '1');
  } else p.set('text', `${b.name}, ${b.city}`);
  const r = await http(`https://search-maps.yandex.ru/v1/?${p}`);
  if (r.status === 403 || r.status === 429) return { error: 'yandex quota' };
  if (!r.ok) return { error: 'yandex http ' + r.status };
  const j = await r.json();
  for (const f of j.features || []) {
    const m = f.properties?.CompanyMetaData;
    if (!m) continue;
    const [lon, lat] = f.geometry?.coordinates || [];
    if (isMatch(b, m.name, (m.Phones || []).map(x => x.formatted), lat, lon)) return { found: true, oid: m.id, website: m.url || null };
  }
  return { found: false };
}

async function checkGis(b) {
  const key = process.env.GIS_API_KEY;
  if (!key) return null;
  const p = new URLSearchParams({ type: 'branch', page_size: '5', fields: 'items.point,items.contact_groups', key });
  if (b.lat != null && b.lon != null) { p.set('q', b.name); p.set('point', `${b.lon},${b.lat}`); p.set('radius', '300'); }
  else p.set('q', `${b.name} ${b.city}`);
  const r = await http(`https://catalog.api.2gis.com/3.0/items?${p}`);
  const j = await r.json().catch(() => ({}));
  const code = j.meta?.code ?? r.status;
  if (code === 404) return { found: false };
  if (code !== 200) return { error: '2gis ' + code };
  for (const it of j.result?.items || []) {
    const all = (it.contact_groups || []).flatMap(g => g.contacts || []);
    const phones = all.filter(x => x.type === 'phone').map(x => x.text);
    if (isMatch(b, it.name, phones, it.point?.lat, it.point?.lon)) {
      const site = all.find(x => x.type === 'website');
      return { found: true, id: String(it.id).split('_')[0], website: site ? (site.value || site.text) : null };
    }
  }
  return { found: false };
}

// Итог: ok | rejected | unknown (ошибки API, повторим позже)
async function verify(b) {
  const gisKnown = b.source === '2gis';
  const [y, g] = await Promise.all([
    checkYandex(b),
    gisKnown ? { found: true, id: String(b.ext_id).split('_')[0], website: null } : checkGis(b),
  ]);
  const ids = { yandex_oid: y?.oid || null, gis_id: g?.id || null };
  const site = y?.website || g?.website;
  if (site) return { status: 'rejected', reason: 'У бизнеса есть сайт: ' + site, ...ids };
  // Ни одного ключа проверки: работаем как раньше, только по тегам OSM
  if (!process.env.YANDEX_API_KEY && !process.env.GIS_API_KEY) return { status: 'ok', by: 'osm', ...ids };
  const confirmed = [y?.found && 'yandex', g?.found && '2gis'].filter(Boolean);
  if (confirmed.length) return { status: 'ok', by: confirmed.join('+'), ...ids };
  const failed = [y, g].filter(x => x?.error);
  if (failed.length) return { status: 'unknown', reason: failed.map(f => f.error).join(', ') };
  return { status: 'rejected', reason: 'Не найден в Яндекс/2ГИС: вероятно, закрыт', ...ids };
}

const patchOf = res => ({
  check_status: res.status,
  verified_at: new Date().toISOString(),
  verified_by: res.status === 'ok' ? res.by : null,
  reject_reason: res.status === 'ok' ? null : res.reason,
  yandex_oid: res.yandex_oid || null,
  gis_id: res.gis_id || null,
});

async function runPool(items, n, deadline, stop, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length && Date.now() < deadline && !stop()) await fn(items[i++]);
  }));
}

// Проверяет строки businesses и пишет результат в базу. Останавливается, когда набрано need «ok» или вышло время
async function verifyBatch(rows, { need = Infinity, deadline = Date.now() + 30000 } = {}) {
  const stat = { ok: 0, rejected: 0, unknown: 0 };
  await runPool(rows, 4, deadline, () => stat.ok >= need, async b => {
    let res;
    try { res = await verify(b); } catch (e) { res = { status: 'unknown', reason: e.message }; }
    if (res.status === 'unknown') { stat.unknown++; return; }
    await db.from('businesses').update(patchOf(res)).eq('id', b.id);
    stat[res.status]++;
  });
  return stat;
}

async function verifyPending(key, need, deadline) {
  const { data } = await db.from('businesses').select('*').eq('city_key', key).eq('check_status', 'pending').order('id').limit(120);
  return verifyBatch(data || [], { need, deadline });
}

// Новые кандидаты попадают в базу со статусом pending (проверка статуса не затрагивается: контакты обновляются)
async function fetchCandidates(city) {
  const raw = (process.env.PLACES_PROVIDER || 'osm') === '2gis' ? await gis(city) : await osm(city);
  const rows = raw
    .filter(r => r.name && (r.phone || Object.keys(r.contacts || {}).length))
    .map(r => ({ ...r, city, city_key: cityKey(city) }));
  if (!rows.length) return 0;
  const { error } = await db.from('businesses').upsert(rows, { onConflict: 'source,ext_id', ignoreDuplicates: false });
  if (error) throw error;
  return rows.length;
}

// Пополнение города: сначала проверяем то, что уже лежит в базе, при нехватке подтягиваем новых кандидатов
async function refillCity(city, { need = 15, budgetMs = 40000 } = {}) {
  const deadline = Date.now() + budgetMs, key = cityKey(city);
  const out = { verified: 0, rejected: 0, fetched: 0, error: null };
  const add = s => { out.verified += s.ok; out.rejected += s.rejected; };
  add(await verifyPending(key, need, deadline));
  if (out.verified < need && deadline - Date.now() > 10000) {
    try { out.fetched = await fetchCandidates(city); } catch (e) { out.error = e.message; }
    if (out.fetched) add(await verifyPending(key, need - out.verified, deadline));
  }
  return out;
}

// Повторная проверка старых записей: появился сайт или бизнес закрылся, запись скрывается из выдачи
async function reverifyStale(limit = 40, deadline = Date.now() + 15000, days = 30) {
  const cutoff = new Date(Date.now() - days * 864e5).toISOString();
  const { data } = await db.from('businesses').select('*').eq('check_status', 'ok').lt('verified_at', cutoff).order('verified_at').limit(limit);
  return verifyBatch(data || [], { deadline });
}

module.exports = { refillCity, reverifyStale, verifyBatch };
