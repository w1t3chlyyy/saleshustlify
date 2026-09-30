async function tg(method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return r.json();
}
const notify = (chat_id, text) => (chat_id ? tg('sendMessage', { chat_id, text }).catch(() => null) : null);
module.exports = { tg, notify };
