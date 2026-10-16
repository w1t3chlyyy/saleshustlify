-- 004_payout_requests.sql
-- Создание таблицы заявок на вывод средств для сотрудников (от 1000 ₽)

create table if not exists payout_requests (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  amount numeric(12,2) not null check (amount >= 1000),
  bank text not null,
  requisites text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists payout_requests_user_id_idx on payout_requests(user_id);
create index if not exists payout_requests_status_idx on payout_requests(status);

alter table payout_requests enable row level security;
