-- Customer khata: opening balances and receipts (money received outside a bill).
alter table parties add column if not exists opening_balance bigint default 0;
create table if not exists receipts (
  id uuid primary key, no text default '', party_id uuid references parties(id), party_name text default '',
  amount bigint not null default 0, mode text default 'cash', note text default '',
  allocations jsonb not null default '[]'::jsonb, opening_part bigint default 0, unallocated bigint default 0,
  device text default '', by_staff text default '', at timestamptz default now(),
  deleted smallint default 0, updated_at timestamptz not null default now()
);
create index if not exists receipts_party_idx on receipts(party_id);
create index if not exists receipts_updated_idx on receipts(updated_at);
drop trigger if exists receipts_touch on receipts;
create trigger receipts_touch before insert or update on receipts for each row execute function touch_updated_at();
alter table receipts enable row level security;
drop policy if exists shop_all on receipts;
create policy shop_all on receipts for all to authenticated using (true) with check (true);
