begin;

create table if not exists public.stores (
  id uuid primary key, code text not null unique, name text not null,
  address text not null default '', active smallint not null default 1,
  deleted smallint not null default 0, updated_at timestamptz not null default now()
);
insert into public.stores(id, code, name) values ('00000000-0000-4000-8000-00000000b001', 'MAIN', 'Main store') on conflict do nothing;

do $$ declare t text; begin
  foreach t in array array['staff','locations','movements','bills','receipts','purchases','purchase_returns','vouchers'] loop
    execute format('alter table public.%I add column if not exists store_id uuid default %L references public.stores(id)', t, '00000000-0000-4000-8000-00000000b001');
    execute format('create index if not exists %I on public.%I(store_id, updated_at)', t || '_store_updated_idx', t);
  end loop;
end $$;
alter table public.staff add column if not exists auth_user_id uuid references auth.users(id);
create unique index if not exists staff_auth_user_idx on public.staff(auth_user_id) where auth_user_id is not null;
alter table public.bills add column if not exists compliance jsonb default '{}'::jsonb;
alter table public.vouchers add column if not exists ref text default '';

create table if not exists public.store_transfers (
  id uuid primary key, no text not null, from_store uuid not null references public.stores(id),
  to_store uuid not null references public.stores(id), status text not null check(status in ('in_transit','received')),
  items jsonb not null default '[]', by_staff text not null, received_by text,
  at timestamptz not null, received_at timestamptz, device text not null,
  deleted smallint not null default 0, updated_at timestamptz not null default now(), check(from_store <> to_store)
);
create table if not exists public.bank_lines (
  id uuid primary key, store_id uuid not null default '00000000-0000-4000-8000-00000000b001' references public.stores(id),
  account text not null, fingerprint text not null unique, date date not null, narration text not null,
  debit bigint not null default 0, credit bigint not null default 0, ref text not null default '',
  match_key text, matched_at timestamptz, batch text not null,
  deleted smallint not null default 0, updated_at timestamptz not null default now(),
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
);
create unique index if not exists bank_lines_match_idx on public.bank_lines(store_id, match_key) where match_key is not null and deleted = 0;
create table if not exists public.import_batches (
  id uuid primary key, store_id uuid not null default '00000000-0000-4000-8000-00000000b001' references public.stores(id),
  filename text not null, at timestamptz not null, by_staff text not null,
  undone boolean not null default false, changes jsonb not null default '[]',
  deleted smallint not null default 0, updated_at timestamptz not null default now()
);
create index if not exists store_transfers_updated_idx on public.store_transfers(updated_at);
create index if not exists bank_lines_store_date_idx on public.bank_lines(store_id, date);
create index if not exists import_batches_store_at_idx on public.import_batches(store_id, at);

-- Roles and branch assignments come from administrator-controlled app_metadata.
-- Keep existing shop-account access to legacy tables; enforce scope for accounts
-- explicitly assigned an app_metadata role/store_id. Never use user_metadata.
create or replace function public.phase3_owner() returns boolean language sql stable security invoker
set search_path = '' as $$ select coalesce(auth.jwt()->'app_metadata'->>'role', '') = 'owner' $$;
create or replace function public.phase3_store() returns uuid language sql stable security invoker
set search_path = '' as $$ select nullif(auth.jwt()->'app_metadata'->>'store_id', '')::uuid $$;
revoke all on function public.phase3_owner(), public.phase3_store() from public;
grant execute on function public.phase3_owner(), public.phase3_store() to authenticated;

do $$ declare t text; begin
  foreach t in array array['stores','store_transfers','bank_lines','import_batches'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.touch_updated_at()', t || '_touch', t);
  end loop;
end $$;
create policy stores_read on public.stores for select to authenticated using (true);
create policy stores_owner on public.stores for all to authenticated using (public.phase3_owner()) with check (public.phase3_owner());
create policy transfer_scope on public.store_transfers for all to authenticated
  using (public.phase3_owner() or public.phase3_store() in (from_store, to_store))
  with check (public.phase3_owner() or public.phase3_store() in (from_store, to_store));
create policy bank_owner on public.bank_lines for all to authenticated using (public.phase3_owner()) with check (public.phase3_owner());
create policy import_owner on public.import_batches for all to authenticated using (public.phase3_owner()) with check (public.phase3_owner());
do $$ declare t text; begin
  foreach t in array array['staff','locations','movements','bills','receipts','purchases','purchase_returns','vouchers'] loop
    execute format('create policy phase3_store_guard on public.%I as restrictive for all to authenticated using (public.phase3_owner() or public.phase3_store() = store_id or auth.jwt()->%L->>%L is null) with check (public.phase3_owner() or public.phase3_store() = store_id or auth.jwt()->%L->>%L is null)', t, 'app_metadata', 'role', 'app_metadata', 'role');
  end loop;
end $$;
commit;
