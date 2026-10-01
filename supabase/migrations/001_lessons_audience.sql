-- Колонка audience для разделов обучения: all | seller | promoter
-- Выполнить в Supabase → SQL Editor (безопасно запускать повторно).
alter table lessons
  add column if not exists audience text not null default 'all'
  check (audience in ('all','seller','promoter'));

-- Если в таблице были разделы с меткой <!--audience:...--> в теле, переносим её в колонку
update lessons
set audience = (regexp_match(body, '^<!--audience:(all|seller|promoter)-->'))[1]
where body ~ '^<!--audience:(all|seller|promoter)-->';
