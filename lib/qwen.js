// Qwen через OpenAI-совместимый API (DashScope). Меняется через QWEN_BASE_URL / QWEN_MODEL.
const BASE = () => process.env.QWEN_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
const MODEL = () => process.env.QWEN_MODEL || 'qwen-plus';

async function chat(messages, { json = false, temperature = 0.7, tools } = {}) {
  const r = await fetch(BASE() + '/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.QWEN_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL(), messages, temperature,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
      ...(tools ? { tools } : {}),
    }),
  });
  const j = await r.json();
  if (!r.ok || !j.choices?.[0]) throw new Error('Qwen: ' + (j.error?.message || r.status));
  return j.choices[0].message;
}

const parseJson = s => JSON.parse(String(s).replace(/^```json|```$/g, '').trim());
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ───────── Индивидуальный тест по уроку (до 5 вопросов)
async function genQuiz(lesson, previous = []) {
  const weak = [];
  for (const p of previous) (p.questions || []).forEach((q, i) => {
    if (p.answers && p.answers[i] !== q.correct) weak.push(q.q);
  });
  const hint = weak.length
    ? `Сотрудник ранее ошибался в темах: ${weak.slice(0, 6).join(' | ')}. Проверь эти темы по-новому, другими формулировками и ситуациями.`
    : 'Это первая попытка сотрудника.';
  const m = await chat([
    { role: 'system', content: 'Ты методист отдела продаж компании Hustlify. Составляешь тесты по учебному материалу. Отвечай только валидным JSON.' },
    { role: 'user', content: `Урок: ${lesson.title}\n\nМатериал:\n${String(lesson.body).slice(0, 8000)}\n\nСоставь от 3 до 5 вопросов (по объёму материала). 4 варианта ответа, один верный. Проверяй понимание и применение в рабочих ситуациях, а не заучивание. ${hint}\nФормат JSON: {"questions":[{"q":"...","options":["...","...","...","..."],"correct":0,"explain":"почему верно, 1-2 предложения"}]}` },
  ], { json: true, temperature: 0.8 });
  const raw = parseJson(m.content).questions || [];
  const out = raw.filter(q => q?.q && Array.isArray(q.options) && q.options.length === 4 && Number.isInteger(q.correct) && q.correct >= 0 && q.correct < 4)
    .slice(0, 5)
    .map(q => {
      const order = shuffle([0, 1, 2, 3]);
      return { q: q.q, options: order.map(i => q.options[i]), correct: order.indexOf(q.correct), explain: q.explain || '' };
    });
  if (out.length < 3) throw new Error('Qwen вернул некорректный тест');
  return out;
}

// ───────── Практика: вредный клиент
const TRAITS = [
  'Скептик: не верит обещаниям, требует цифры и доказательства.',
  'Жмот: всё упирается в цену, просит скидку и сравнивает с бесплатными вариантами.',
  'Вечно занят: отвечает коротко, торопится, перебивает.',
  'Уже работает с конкурентом и не хочет ничего менять.',
  'Подозрительный: думает, что это развод, спрашивает «а в чём подвох?».',
  'Грубоватый: резкий тон, но уважает конкретику и уверенность.',
];

function buildPersona(products = [], cases = []) {
  const pick = a => (a.length ? a[Math.floor(Math.random() * a.length)] : null);
  return {
    trait: pick(TRAITS),
    product: pick(products),
    catalog: JSON.stringify(products).slice(0, 4500),
    cases: JSON.stringify(cases).slice(0, 4500),
  };
}

function clientSystem(p) {
  return `Ты играешь роль ВРЕДНОГО КЛИЕНТА — владельца небольшого бизнеса в тренировочной сессии для стажёра отдела продаж Hustlify.
Характер: ${p.trait}
Стажёр пытается продать тебе услугу Hustlify. Тебе предлагают: ${p.product ? JSON.stringify(p.product).slice(0, 1200) : 'услуги Hustlify (общий каталог ниже)'}.

Что тебе известно (каталог и кейсы компании) — используй, чтобы ловить стажёра на неточностях:
КАТАЛОГ: ${p.catalog}
КЕЙСЫ: ${p.cases}

Правила:
- Играй реалистично, по-русски, 1–3 коротких предложения за реплику. Не выходи из роли и не подсказывай.
- Начинай недоверчиво. Возражай: цена, «нет времени», «уже есть», «не вижу пользы», «подумаю».
- Смягчайся ТОЛЬКО если стажёр: задаёт вопросы о твоём бизнесе, выявляет потребность, говорит на языке выгоды, опирается на реальные данные из каталога/кейсов, спокойно отрабатывает возражения и предлагает ясный следующий шаг.
- Если стажёр врёт, давит, хамит, путается в фактах — становись жёстче.
- Согласись на покупку только когда действительно убеждён. Тогда скажи это явно.`;
}

async function clientReply(persona, history) {
  const msgs = [
    { role: 'system', content: clientSystem(persona) },
    ...history.map(h => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content })),
  ];
  if (!history.length) msgs.push({ role: 'user', content: '(Стажёр подошёл к тебе. Начни разговор в своём характере, одной-двумя фразами.)' });
  return (await chat(msgs, { temperature: 0.9 })).content.trim();
}

async function judge(persona, history) {
  const transcript = history.map(h => (h.role === 'user' ? 'СТАЖЁР: ' : 'КЛИЕНТ: ') + h.content).join('\n');
  const m = await chat([
    { role: 'system', content: 'Ты строгий, но справедливый руководитель отдела продаж. Оцениваешь тренировочный диалог. Отвечай только валидным JSON.' },
    { role: 'user', content: `Характер клиента: ${persona.trait}\nКаталог: ${persona.catalog}\n\nДиалог:\n${transcript}\n\nОцени работу стажёра. success=true только если клиент реально согласился купить или чётко назначил следующий шаг к покупке, и стажёр не врал.\nФормат JSON: {"success":true|false,"score":0-100,"strengths":["..."],"improvements":["..."],"summary":"1-2 предложения"}` },
  ], { json: true, temperature: 0.2 });
  const r = parseJson(m.content);
  return {
    success: !!r.success,
    score: Math.max(0, Math.min(100, Number(r.score) || 0)),
    strengths: (r.strengths || []).slice(0, 4),
    improvements: (r.improvements || []).slice(0, 4),
    summary: r.summary || '',
  };
}

// ───────── Секретный админ-агент с инструментами
async function adminAgent(system, history, tools, exec, maxSteps = 8) {
  const msgs = [{ role: 'system', content: system }, ...history];
  const actions = [];
  for (let i = 0; i < maxSteps; i++) {
    const m = await chat(msgs, { tools, temperature: 0.2 });
    msgs.push(m);
    if (!m.tool_calls?.length) return { reply: m.content || '', actions };
    for (const tc of m.tool_calls) {
      let out;
      try { out = await exec(tc.function.name, JSON.parse(tc.function.arguments || '{}')); }
      catch (e) { out = { error: e.message }; }
      actions.push({ tool: tc.function.name, ok: !out?.error });
      msgs.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out).slice(0, 12000) });
    }
  }
  return { reply: 'Цепочка действий получилась слишком длинной. Уточните задачу или разбейте её на шаги.', actions };
}

module.exports = { chat, genQuiz, buildPersona, clientReply, judge, adminAgent };
