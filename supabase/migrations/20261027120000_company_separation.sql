-- Owner, 27 Oct: companies under a master owner (docs/companies.md), now kept apart by the cloud as well.
--
-- A counter connected as an unnamed shop device (anonymous sign-in) is tied to ONE company: the one whose entry
-- code it last typed, checked here by join_company(). The cloud then gives that device only that company's
-- people, racks, stock movements, bills, payments, purchases, returns, vouchers and bill details, and refuses
-- writes into another company. The design list (products) and customers/suppliers stay shared.
--
-- Full access ("rj_full"): the owner's email login (not anonymous, no restricting app_metadata role), or a
-- device that typed the master code. A device that has never typed a code sees the main company only.
-- Run after all earlier migrations. Safe to run again.
begin;

create table if not exists public.company_devices (
  user_id uuid primary key,
  store_id uuid,
  master boolean not null default false,
  fails integer not null default 0,
  fail_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.company_devices enable row level security;
revoke all on public.company_devices from public, anon, authenticated;   -- only the functions below touch it

create or replace function public.rj_full() returns boolean language sql stable security definer
set search_path = '' as $$
  select (coalesce((auth.jwt()->>'is_anonymous')::boolean, false) = false
          and coalesce(auth.jwt()->'app_metadata'->>'role', '') in ('', 'owner'))
      or coalesce((select d.master from public.company_devices d where d.user_id = auth.uid()), false)
$$;
create or replace function public.rj_company() returns uuid language sql stable security definer
set search_path = '' as $$
  select coalesce((select d.store_id from public.company_devices d where d.user_id = auth.uid()),
                  '00000000-0000-4000-8000-00000000b001'::uuid)
$$;
revoke all on function public.rj_full(), public.rj_company() from public, anon;
grant execute on function public.rj_full(), public.rj_company() to authenticated;

-- The same rule as the app (lib/openCode, lib/companies): capitals and spaces do not count;
-- company and master codes are sha256(salt || code) in hex, as written by the app.
create or replace function public.join_company(code text) returns jsonb language plpgsql security definer
set search_path = '' as $$
declare
  me uuid := auth.uid();
  b text := regexp_replace(lower(coalesce(code, '')), '\s', '', 'g');
  main uuid := '00000000-0000-4000-8000-00000000b001';
  hit uuid; is_master boolean := false; d public.company_devices;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into d from public.company_devices where user_id = me;
  if coalesce(d.fails, 0) >= 10 and d.fail_at > now() - interval '10 minutes' then
    raise exception 'too many wrong entry codes, try again in a few minutes';
  end if;
  if b = '' then return null; end if;

  if exists (select 1 from public.config c where c.id = 'master_code' and coalesce(c.deleted, 0) = 0
             and c.value->>'hash' = encode(sha256(convert_to(coalesce(c.value->>'salt', '') || b, 'UTF8')), 'hex')) then
    hit := main; is_master := true;
  end if;
  if hit is null then
    select s.id into hit from public.stores s join public.config c on c.id = 'company_' || s.id::text
     where coalesce(s.deleted, 0) = 0 and s.active = 1 and coalesce(s.kind, '') <> 'estimate' and s.id <> main
       and c.value->>'hash' = encode(sha256(convert_to(coalesce(c.value->>'salt', '') || b, 'UTF8')), 'hex')
     limit 1;
  end if;
  -- the main company keeps the shop's common entry code; it never gives full access (that is the master code)
  if hit is null and b = regexp_replace(lower(coalesce(
       (select nullif(trim(c.value->>'code'), '') from public.config c where c.id = 'open_code' and coalesce(c.deleted, 0) = 0),
       'rungnna 2026')), '\s', '', 'g') then
    hit := main;
  end if;

  if hit is null then
    insert into public.company_devices(user_id, fails, fail_at) values (me, 1, now())
      on conflict (user_id) do update set fails = case when public.company_devices.fail_at > now() - interval '10 minutes' then public.company_devices.fails + 1 else 1 end, fail_at = now();
    return null;
  end if;
  insert into public.company_devices(user_id, store_id, master, fails, fail_at, updated_at) values (me, hit, is_master, 0, null, now())
    on conflict (user_id) do update set store_id = excluded.store_id, master = excluded.master, fails = 0, fail_at = null, updated_at = now();
  return jsonb_build_object('store_id', hit, 'master', is_master);
end $$;
revoke all on function public.join_company(text) from public, anon;
grant execute on function public.join_company(text) to authenticated;

-- One company's records, for a device tied to it.
do $$ declare t text; begin
  foreach t in array array['locations','movements','bills','receipts','purchases','purchase_returns','vouchers','bank_lines','import_batches'] loop
    execute format('drop policy if exists company_guard on public.%I', t);
    execute format('create policy company_guard on public.%I as restrictive for all to authenticated using (public.rj_full() or coalesce(store_id, %L::uuid) = public.rj_company()) with check (public.rj_full() or coalesce(store_id, %L::uuid) = public.rj_company())',
      t, '00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000b001');
  end loop;
end $$;
-- People: this company's own, anyone ticked for it, and the owner (who may sign in to every company).
drop policy if exists company_guard on public.staff;
create policy company_guard on public.staff as restrictive for all to authenticated
  using (public.rj_full() or role = 'owner' or coalesce(store_id, '00000000-0000-4000-8000-00000000b001'::uuid) = public.rj_company()
         or coalesce(stores, '[]'::jsonb) ? public.rj_company()::text)
  with check (public.rj_full() or role = 'owner' or coalesce(store_id, '00000000-0000-4000-8000-00000000b001'::uuid) = public.rj_company()
         or coalesce(stores, '[]'::jsonb) ? public.rj_company()::text);

-- Companies: a tied device sees only its own; only full access makes or changes companies.
-- (Before this, a shop login could not save a new store or a transfer at all: those policies needed an
-- app_metadata 'owner' claim that the shop's own login never has.)
drop policy if exists company_read on public.stores;
create policy company_read on public.stores as restrictive for select to authenticated using (public.rj_full() or id = public.rj_company());
drop policy if exists stores_full on public.stores;
create policy stores_full on public.stores for all to authenticated using (public.rj_full()) with check (public.rj_full());
drop policy if exists transfers_full on public.store_transfers;
create policy transfers_full on public.store_transfers for all to authenticated using (public.rj_full()) with check (public.rj_full());
drop policy if exists bank_full on public.bank_lines;
create policy bank_full on public.bank_lines for all to authenticated using (public.rj_full()) with check (public.rj_full());
drop policy if exists import_full on public.import_batches;
create policy import_full on public.import_batches for all to authenticated using (public.rj_full()) with check (public.rj_full());

-- Settings: the master code and other companies' codes, features and bill details are not sent to a tied device.
-- A tied device may save its own company's bill details; codes and features are changed only with full access.
drop policy if exists company_config_read on public.config;
create policy company_config_read on public.config as restrictive for select to authenticated
  using (public.rj_full() or not (id = 'master_code' or id like 'company\_%' or id like 'shop\_%')
         or id in ('company_' || public.rj_company()::text, 'shop_' || public.rj_company()::text));
drop policy if exists company_config_write on public.config;
create policy company_config_write on public.config as restrictive for insert to authenticated
  with check (public.rj_full() or not (id = 'master_code' or id like 'company\_%' or id like 'shop\_%') or id = 'shop_' || public.rj_company()::text);
drop policy if exists company_config_update on public.config;
create policy company_config_update on public.config as restrictive for update to authenticated
  using (public.rj_full() or not (id = 'master_code' or id like 'company\_%' or id like 'shop\_%') or id = 'shop_' || public.rj_company()::text)
  with check (public.rj_full() or not (id = 'master_code' or id like 'company\_%' or id like 'shop\_%') or id = 'shop_' || public.rj_company()::text);
drop policy if exists company_config_delete on public.config;
create policy company_config_delete on public.config as restrictive for delete to authenticated
  using (public.rj_full() or not (id = 'master_code' or id like 'company\_%' or id like 'shop\_%'));

commit;
