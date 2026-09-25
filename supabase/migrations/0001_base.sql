-- Rungnna Shop OS — base schema.
-- Money in integer paise. Ids are client-generated UUIDs (offline-safe).
-- Every table carries updated_at so devices can pull "what changed since".

create extension if not exists pgcrypto;

create or replace function touch_updated_at() returns trigger language plpgsql set search_path = public as $$
begin
  -- always server time: devices pull "changed since X", so an offline edit pushed late must still look new
  new.updated_at := clock_timestamp();
  return new;
end $$;

-- ---------- people ----------
create table if not exists staff (
  id uuid primary key, name text not null, role text not null default 'salesman',
  phone text default '', pin text default '', active smallint default 1,
  deleted smallint default 0, updated_at timestamptz not null default now()
);

create table if not exists parties (            -- customers, dealers, suppliers
  id uuid primary key, kind text not null default 'customer', -- customer|dealer|supplier
  name text not null, alt_name text default '', phone text default '', gstin text default '',
  address text default '', city text default '', state text default '', pin text default '',
  photo_url text, tier text default 'retail', credit_limit bigint default 0, notes text default '',
  deleted smallint default 0, updated_at timestamptz not null default now()
);

-- ---------- places ----------
create table if not exists locations (
  id uuid primary key, code text not null unique, floor text default '', rack text default '',
  box text default '', name text default '', kind text not null default 'rack',
  deleted smallint default 0, updated_at timestamptz not null default now()
);

-- ---------- catalogue ----------
create table if not exists products (
  id uuid primary key, code text not null, barcodes text[] not null default '{}',
  item text default '', type text default 'PCS', style text default '', color text default '',
  tk text default '', rate bigint default 0, mrp bigint default 0, category text default '',
  notes text default '', photo_id text, photo_url text, raw_scan text,
  hsn text default '7117', gst_rate numeric(5,2) default 3,
  created_by text default '', created_at timestamptz default now(),
  deleted smallint default 0, updated_at timestamptz not null default now()
);
create unique index if not exists products_code_uq on products(code);
create index if not exists products_barcodes_gin on products using gin(barcodes);
create index if not exists products_style_idx on products(style);

-- ---------- the stock ledger: every piece that moves leaves a row ----------
create table if not exists movements (
  id uuid primary key, product_id uuid not null references products(id),
  kind text not null,               -- intake|transfer|sale|return|adjust|damage|missing|found
  qty integer not null check (qty > 0),
  from_loc uuid references locations(id), to_loc uuid references locations(id),
  person_type text default '', person_name text default '', by_staff text default '',
  photo_id text, photo_url text, note text default '', device text default '',
  ref_bill uuid, at timestamptz not null default now(),
  deleted smallint default 0, updated_at timestamptz not null default now()
);
create index if not exists movements_product_idx on movements(product_id, at desc);
create index if not exists movements_updated_idx on movements(updated_at);
create index if not exists movements_from_idx on movements(from_loc);
create index if not exists movements_to_idx on movements(to_loc);

create or replace view stock_by_location with (security_invoker = on) as
select product_id, loc as location_id, sum(delta)::int as qty from (
  select product_id, to_loc as loc, qty as delta from movements where deleted = 0 and to_loc is not null
  union all
  select product_id, from_loc as loc, -qty from movements where deleted = 0 and from_loc is not null
) s group by product_id, loc having sum(delta) <> 0;

-- ---------- billing (phase 2 — created now so the shape is fixed) ----------
create table if not exists invoice_series (       -- each counter owns a block so offline numbers never clash
  id uuid primary key default gen_random_uuid(), series text not null,  -- e.g. RJ/26-27 (GST) or EST/26-27 (non-GST)
  device text not null, block_from integer not null, block_to integer not null, next_no integer not null,
  updated_at timestamptz not null default now()
);
create table if not exists bills (
  id uuid primary key, no text, series text, bill_type text not null default 'gst', -- gst|cash|estimate|packing
  status text not null default 'final',          -- hold|final|void|converted
  party_id uuid references parties(id), party_name text default '', party_phone text default '',
  salesman text default '', box_count integer default 0, total_qty integer default 0,
  gross bigint default 0, discount bigint default 0, discount_pct numeric(6,2) default 0,
  packing bigint default 0, adjust bigint default 0, gst_mode text default 'exclusive',
  gst bigint default 0, net bigint default 0, advance bigint default 0, paid bigint default 0,
  remarks text default '', transport jsonb default '{}'::jsonb, payments jsonb default '[]'::jsonb,
  converted_from uuid, device text default '', by_staff text default '', at timestamptz default now(),
  deleted smallint default 0, updated_at timestamptz not null default now()
);
create index if not exists bills_party_idx on bills(party_id);
create table if not exists bill_items (
  id uuid primary key, bill_id uuid not null references bills(id) on delete cascade,
  product_id uuid references products(id), code text default '', item text default '', type text default '',
  style text default '', color text default '', box_no integer default 1, qty integer not null default 1,
  rate bigint default 0, disc text default '', amount bigint default 0,
  deleted smallint default 0, updated_at timestamptz not null default now()
);

-- ---------- audit ----------
create index if not exists bill_items_bill_idx on bill_items(bill_id);
create index if not exists bill_items_product_idx on bill_items(product_id);

create table if not exists audit_log (
  id bigserial primary key, at timestamptz default now(), actor text, device text,
  action text not null, entity text, entity_id text, detail jsonb
);

-- ---------- triggers ----------
do $$ declare t text; begin
  foreach t in array array['staff','parties','locations','products','movements','bills','bill_items','invoice_series'] loop
    execute format('drop trigger if exists %I_touch on %I', t, t);
    execute format('create trigger %I_touch before insert or update on %I for each row execute function touch_updated_at()', t, t);
  end loop;
end $$;

-- ---------- security: only signed-in shop accounts can read or write ----------
do $$ declare t text; begin
  foreach t in array array['staff','parties','locations','products','movements','bills','bill_items','invoice_series','audit_log'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists shop_all on %I', t);
    execute format('create policy shop_all on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ---------- photo storage (small WebP files, compressed on the phone) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 400000, array['image/webp','image/jpeg','image/png'])
on conflict (id) do nothing;

drop policy if exists "shop upload photos" on storage.objects;
create policy "shop upload photos" on storage.objects for insert to authenticated with check (bucket_id = 'photos');
drop policy if exists "shop update photos" on storage.objects;
create policy "shop update photos" on storage.objects for update to authenticated using (bucket_id = 'photos');
