// Запускается Vercel Cron (раз в сутки) или внешним CronJob: GET /api/cron?key=CRON_SECRET
const { db } = require('../lib/db');
const { refillCity } = require('../lib/places');

module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const ok = secret && (req.headers.authorization === 'Bearer ' + secret || req.query?.key === secret);
  if (!ok) return res.status(401).json({ error: 'unauthorized' });

  const report = { refilled: {}, boosts_cleared: 0 };

  // 1. Пополняем базу бизнесов в городах, где сотрудники работали за последнюю неделю
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const { data } = await db.from('users').select('city').not('city', 'is', null).gte('last_seen', since);
  const cities = [...new Set((data || []).map(r => r.city))].slice(0, 5);
  for (const city of cities) {
    try {
      const { count } = await db.from('businesses').select('*', { count: 'exact', head: true }).eq('city_key', city.trim().toLowerCase());
      if ((count || 0) < 80) report.refilled[city] = await refillCity(city);
    } catch (e) { report.refilled[city] = 'error: ' + e.message; }
  }

  // 2. Сбрасываем истёкшие бусты процентной ставки
  const { data: cleared } = await db.from('users')
    .update({ percent_boost: 0, boost_until: null })
    .lt('boost_until', new Date().toISOString()).select('id');
  report.boosts_cleared = cleared?.length || 0;

  res.json({ ok: true, ...report });
};
