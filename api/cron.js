// Запускается Vercel Cron (раз в сутки) или внешним CronJob: GET /api/cron?key=CRON_SECRET
// Безопасно вызывать чаще (например, раз в час через cron-job.org): работа делится на порции.
const { db } = require('../lib/db');
const { refillCity, reverifyStale } = require('../lib/places');

module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const ok = secret && (req.headers.authorization === 'Bearer ' + secret || req.query?.key === secret);
  if (!ok) return res.status(401).json({ error: 'unauthorized' });

  const deadline = Date.now() + 50000; // maxDuration функции 60 с
  const report = { refilled: {}, reverified: null, boosts_cleared: 0 };

  // 1. Пополняем и проверяем базу в городах, где сотрудники работали за последнюю неделю
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const { data } = await db.from('users').select('city').not('city', 'is', null).gte('last_seen', since);
  const cities = [...new Set((data || []).map(r => r.city))].slice(0, 3);
  const fresh = new Date(Date.now() - 45 * 864e5).toISOString();
  for (const [i, city] of cities.entries()) {
    const budgetMs = Math.floor((deadline - 12000 - Date.now()) / (cities.length - i));
    if (budgetMs < 5000) { report.refilled[city] = 'skipped: нет времени'; continue; }
    try {
      const { count } = await db.from('businesses').select('*', { count: 'exact', head: true })
        .eq('city_key', city.trim().toLowerCase()).eq('check_status', 'ok').gte('verified_at', fresh);
      if ((count || 0) < 80) report.refilled[city] = await refillCity(city, { need: 40, budgetMs });
      else report.refilled[city] = 'enough: ' + count;
    } catch (e) { report.refilled[city] = 'error: ' + e.message; }
  }

  // 2. Перепроверяем записи, которые не проверялись больше 30 дней
  try { report.reverified = await reverifyStale(40, deadline); }
  catch (e) { report.reverified = 'error: ' + e.message; }

  // 3. Сбрасываем истёкшие бусты процентной ставки
  const { data: cleared } = await db.from('users')
    .update({ percent_boost: 0, boost_until: null })
    .lt('boost_until', new Date().toISOString()).select('id');
  report.boosts_cleared = cleared?.length || 0;

  res.json({ ok: true, ...report });
};
