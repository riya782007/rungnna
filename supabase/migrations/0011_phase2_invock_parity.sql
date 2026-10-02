-- Phase 2: Invock parity, supplier ledger, vouchers, reports support and FY locks.
-- Client rows remain offline-created UUIDs and sync with updated_at.

alter table products add column if not exists vendor_design_code text default '';
alter table products add column if not exists collection text default '';
alter table products add column if not exists material text default '';
alter table products add column if not exists wholesale_rate bigint default 0;
alter table products add column if not exists retail_rate bigint default 0;
alter table products add column if not exists model text default '';
alter table products add column if not exists vendor_id uuid;
alter table products add column if not exists vendor_name text default '';
alter table products add column if not exists size text default '';
alter table products add column if not exists cost bigint default 0;

alter table parties add column if not exists opening_balance bigint default 0;
alter table bills add column if not exists price_level text default 'wholesale';

create table if not exists vouchers (
  id uuid primary key,
  no text not null,
  series text not null default '',
  type text not null check (type in ('payment','receipt','expense','journal')),
  at timestamptz not null default now(),
  mode text not null default 'cash',
  amount bigint not null default 0,
  party_id uuid references parties(id),
  party_name text default '',
  party_kind text default '',
  category text default '',
  note text default '',
  debit_account text default '',
  credit_account text default '',
  device text default '',
  by_staff text default '',
  deleted smallint default 0,
  updated_at timestamptz not null default now()
);

create table if not exists purchase_returns (
  id uuid primary key,
  no text not null,
  series text not null default '',
  supplier_id uuid references parties(id),
  supplier_name text default '',
  purchase_id uuid,
  purchase_no text default '',
  items jsonb not null default '[]'::jsonb,
  total_qty integer not null default 0,
  total_cost bigint not null default 0,
  note text default '',
  device text default '',
  by_staff text default '',
  at timestamptz not null default now(),
  deleted smallint default 0,
  updated_at timestamptz not null default now()
);

create table if not exists fiscal_year_closes (
  id uuid primary key,
  fy text not null,
  closed_upto date not null,
  customer_balances jsonb not null default '{}'::jsonb,
  supplier_balances jsonb not null default '{}'::jsonb,
  device text default '',
  by_staff text default '',
  at timestamptz not null default now(),
  deleted smallint default 0,
  updated_at timestamptz not null default now()
);

create index if not exists products_vendor_design_idx on products(vendor_design_code);
create index if not exists products_collection_idx on products(collection);
create index if not exists products_material_idx on products(material);
create index if not exists products_hsn_idx on products(hsn);
create index if not exists vouchers_at_idx on vouchers(at);
create index if not exists vouchers_party_idx on vouchers(party_id);
create index if not exists vouchers_updated_idx on vouchers(updated_at);
create index if not exists purchase_returns_supplier_idx on purchase_returns(supplier_id);
create index if not exists purchase_returns_purchase_idx on purchase_returns(purchase_id);
create index if not exists purchase_returns_updated_idx on purchase_returns(updated_at);
create index if not exists fiscal_year_closes_updated_idx on fiscal_year_closes(updated_at);

do $$ declare t text; begin
  foreach t in array array['vouchers','purchase_returns','fiscal_year_closes'] loop
    execute format('drop trigger if exists %I_touch on %I', t, t);
    execute format('create trigger %I_touch before insert or update on %I for each row execute function touch_updated_at()', t, t);
  end loop;
end $$;

do $$ declare t text; begin
  foreach t in array array['vouchers','purchase_returns','fiscal_year_closes'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists shop_all on %I', t);
    execute format('create policy shop_all on %I for all to authenticated using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on table %I to authenticated', t);
  end loop;
end $$;

grant select, insert, update, delete on table products to authenticated;
grant select, insert, update, delete on table parties to authenticated;
grant select, insert, update, delete on table bills to authenticated;

