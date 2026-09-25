-- Stock in / purchase entry; last purchase cost on products.
create table if not exists purchases (
  id uuid primary key, no text default '', status text not null default 'final',
  supplier_id uuid references parties(id), supplier_name text default '', supplier_bill text default '',
  loc_id uuid references locations(id), items jsonb not null default '[]'::jsonb,
  total_qty integer default 0, total_cost bigint default 0, note text default '', photo_id text, photo_url text,
  device text default '', by_staff text default '', at timestamptz default now(),
  deleted smallint default 0, updated_at timestamptz not null default now()
);
create index if not exists purchases_updated_idx on purchases(updated_at);
create index if not exists purchases_supplier_idx on purchases(supplier_id);
drop trigger if exists purchases_touch on purchases;
create trigger purchases_touch before insert or update on purchases for each row execute function touch_updated_at();
alter table purchases enable row level security;
drop policy if exists shop_all on purchases;
create policy shop_all on purchases for all to authenticated using (true) with check (true);
alter table products add column if not exists cost bigint default 0;
