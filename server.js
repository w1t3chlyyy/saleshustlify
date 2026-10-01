const path = require('path');
const express = require('express');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '10mb' }));

app.all('/api/app', (req, res) => require('./api/app')(req, res));
app.all('/api/bot', (req, res) => require('./api/bot')(req, res));
app.all('/api/cron', (req, res) => require('./api/cron')(req, res));

app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Hustlify server listening on http://0.0.0.0:${PORT}`);
});
