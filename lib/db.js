const { createClient } = require('@supabase/supabase-js');

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const cache = { t: 0, v: {} };
async function setting(key, def) {
  if (Date.now() - cache.t > 30000) {
    const { data } = await db.from('settings').select('*');
    cache.v = Object.fromEntries((data || []).map(r => [r.key, r.value]));
    cache.t = Date.now();
  }
  return cache.v[key] ?? def;
}
const bustSettings = () => { cache.t = 0; };

class Http extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

module.exports = { db, setting, bustSettings, Http };
