# Что изменено

Файлы кладите поверх проекта с сохранением путей.

- `public/app.js` — скрепка и до 4 фото в чате HustlifyAI, картинки в разделах (`md()`), `aiImages` в состоянии и при выходе.
- `public/style.css` — стили картинок в разделах, кнопки-скрепки и превью фото.
- `supabase/migrations/001_lessons_audience.sql` — колонка `audience` в `lessons` (выполнить в SQL Editor).

Также в Vercel: `QWEN_MODEL=qwen-plus` (или `qwen3-max`), `QWEN_PRACTICE_MODEL=qwen-plus-character`. После этого передеплой.
