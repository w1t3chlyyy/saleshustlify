const { tg } = require('../lib/telegram');

const WELCOME = 'Добро пожаловать в Hustlify 👋\n\nЭто рабочее пространство отдела продаж: обучение, практика с клиентом, база бизнесов, коины и выплаты — всё в одном приложении.\n\nНажмите кнопку ниже, чтобы войти.';

module.exports = async (req, res) => {
  if (process.env.WEBHOOK_SECRET && req.headers['x-telegram-bot-api-secret-token'] !== process.env.WEBHOOK_SECRET)
    return res.status(401).end();
  try {
    const m = req.body?.message;
    if (m?.chat?.type === 'private') {
      await tg('sendMessage', {
        chat_id: m.chat.id,
        text: WELCOME,
        reply_markup: { inline_keyboard: [[{ text: 'Открыть Hustlify', web_app: { url: process.env.APP_URL } }]] },
      });
    }
  } catch (e) { console.error(e); }
  res.status(200).json({ ok: true });
};
