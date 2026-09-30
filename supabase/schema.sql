-- Hustlify: схема базы. Выполнить целиком в Supabase → SQL Editor.
-- Таблицы products и cases уже есть у тебя — здесь они не создаются.

create extension if not exists pgcrypto;

-- ───────── Пользователи
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  tg_id bigint unique,
  tg_username text,
  login text unique not null,
  pass_hash text not null,
  full_name text not null,
  role text not null default 'intern' check (role in ('intern','manager','admin')),
  position text not null default 'Стажёр',
  coins integer not null default 0 check (coins >= 0),
  balance numeric(12,2) not null default 0,
  earned_total numeric(12,2) not null default 0,
  tags text[] not null default '{}',
  training_done boolean not null default false,
  city text,
  percent_boost numeric(4,2) not null default 0,
  boost_until timestamptz,
  is_blocked boolean not null default false,
  fail_count int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  last_seen timestamptz
);

-- ───────── Обучение
create table if not exists lessons (
  id bigserial primary key,
  position int not null default 0,
  title text not null,
  body text not null default '',
  is_published boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists lesson_progress (
  user_id uuid references users(id) on delete cascade,
  lesson_id bigint references lessons(id) on delete cascade,
  passed boolean not null default false,
  best_score int not null default 0,
  primary key (user_id, lesson_id)
);

create table if not exists quizzes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  lesson_id bigint not null references lessons(id) on delete cascade,
  questions jsonb not null,
  answers jsonb,
  score int,
  passed boolean,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists practice_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  persona jsonb not null,
  messages jsonb not null default '[]',
  status text not null default 'active' check (status in ('active','passed','failed')),
  score int,
  feedback jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

-- ───────── Работа
create table if not exists leads (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  contact text,
  niche text,
  notes text,
  status text not null default 'new' check (status in ('new','contacted','interested','won','lost')),
  created_at timestamptz not null default now()
);

create table if not exists businesses (
  id bigserial primary key,
  city text not null,
  city_key text not null,
  name text not null,
  category text,
  address text,
  phone text,
  info text,
  lat double precision,
  lon double precision,
  source text not null,
  ext_id text not null,
  created_at timestamptz not null default now(),
  unique (source, ext_id)
);
create index if not exists businesses_city_idx on businesses(city_key);

create table if not exists assignments (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  business_id bigint not null references businesses(id) on delete cascade,
  day date not null,
  status text not null default 'assigned' check (status in ('assigned','submitted','approved','rejected')),
  proof_text text,
  proof_path text,
  reviewer_note text,
  coins_awarded int not null default 0,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  unique (user_id, business_id)
);
create index if not exists assignments_user_day_idx on assignments(user_id, day);
create index if not exists assignments_status_idx on assignments(status);

create table if not exists sales (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  business_id bigint references businesses(id) on delete set null,
  lead_id bigint references leads(id) on delete set null,
  amount numeric(12,2) not null,
  percent numeric(5,2) not null,
  payout numeric(12,2) not null,
  note text,
  created_at timestamptz not null default now()
);

-- ───────── Коины и магазин
create table if not exists coin_ledger (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  delta int not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create table if not exists shop_items (
  id bigserial primary key,
  title text not null,
  description text,
  price int not null check (price > 0),
  kind text not null default 'custom' check (kind in ('promo','boost','custom')),
  payload jsonb not null default '{}',
  stock int,
  is_active boolean not null default true,
  position int not null default 0
);

create table if not exists purchases (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  item_id bigint references shop_items(id) on delete set null,
  title text not null,
  price int not null,
  result jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- ───────── Админка
create table if not exists settings (key text primary key, value jsonb not null);
create table if not exists broadcasts (
  id bigserial primary key, text text not null, audience jsonb,
  sent int not null default 0, failed int not null default 0, created_at timestamptz not null default now()
);
create table if not exists audit_log (
  id bigserial primary key, admin_id uuid, action text not null, payload jsonb, created_at timestamptz not null default now()
);

-- ───────── Атомарные операции
create or replace function add_coins(p_user uuid, p_delta int, p_reason text)
returns int language plpgsql security definer as $$
declare v int;
begin
  update users set coins = coins + p_delta where id = p_user and coins + p_delta >= 0 returning coins into v;
  if v is null then raise exception 'insufficient_coins'; end if;
  insert into coin_ledger(user_id, delta, reason) values (p_user, p_delta, p_reason);
  return v;
end $$;

create or replace function add_money(p_user uuid, p_amount numeric)
returns void language sql security definer as $$
  update users set balance = balance + p_amount, earned_total = earned_total + greatest(p_amount, 0) where id = p_user;
$$;

-- Выдаёт пользователю p_n бизнесов из города, которые не заняты другими
create or replace function claim_businesses(p_user uuid, p_city text, p_day date, p_n int)
returns setof assignments language plpgsql security definer as $$
begin
  return query
  with pick as (
    select b.id from businesses b
    where b.city_key = lower(trim(p_city))
      and not exists (
        select 1 from assignments a
        where a.business_id = b.id
          and (a.user_id = p_user
               or a.status in ('submitted','approved')
               or (a.status = 'assigned' and a.day >= p_day))
      )
    order by random() limit p_n
    for update skip locked
  )
  insert into assignments(user_id, business_id, day)
  select p_user, id, p_day from pick
  returning *;
end $$;

-- ───────── Безопасность: всё закрыто, доступ только через сервер (service key)
alter table users enable row level security;
alter table lessons enable row level security;
alter table lesson_progress enable row level security;
alter table quizzes enable row level security;
alter table practice_sessions enable row level security;
alter table leads enable row level security;
alter table businesses enable row level security;
alter table assignments enable row level security;
alter table sales enable row level security;
alter table coin_ledger enable row level security;
alter table shop_items enable row level security;
alter table purchases enable row level security;
alter table settings enable row level security;
alter table broadcasts enable row level security;
alter table audit_log enable row level security;

-- ───────── Хранилище для доказательств работы (приватное)
insert into storage.buckets (id, name, public) values ('proofs', 'proofs', false) on conflict (id) do nothing;

-- ───────── Настройки по умолчанию
insert into settings(key, value) values
  ('training_reward_coins', '20'),
  ('business_reward_coins', '10'),
  ('daily_batch', '15'),
  ('quiz_pass_percent', '70'),
  ('practice_max_turns', '14'),
  ('percent_tiers', '[[0,5],[8,7],[20,10],[40,12]]')
on conflict (key) do nothing;

-- ───────── Демо-урок (заменить своими) и магазин
insert into lessons(position, title, body) values
  (1, 'О компании и продукте', E'# Hustlify\n\nЗдесь будет вводная часть. Замени этот текст своей методичкой.\n\n## Что важно запомнить\n- Мы продаём результат, а не функции\n- Всегда начинай с вопроса о бизнесе клиента\n- Честность важнее скидки')
on conflict do nothing;

insert into shop_items(title, description, price, kind, payload, position) values
  ('Промокод на скидку 10%', 'Скидка 10% на сервис Hustlify для твоего клиента', 30, 'promo', '{"discount_percent":10}', 1),
  ('Промокод на скидку 20%', 'Скидка 20% на сервис Hustlify для твоего клиента', 70, 'promo', '{"discount_percent":20}', 2),
  ('+2% к ставке на 14 дней', 'Твой процент с продаж растёт на 2 п.п.', 120, 'boost', '{"percent":2,"days":14}', 3),
  ('+5% к ставке на 7 дней', 'Максимальный буст на неделю', 200, 'boost', '{"percent":5,"days":7}', 4),
  ('Личная сессия с руководителем', 'Разбор твоих сделок 1 на 1', 150, 'custom', '{}', 5)
on conflict do nothing;
