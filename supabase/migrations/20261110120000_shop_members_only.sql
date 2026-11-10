-- 10 Nov: anonymous sign-ins are switched on, so "Connect this computer" works with one tap. Until now any signed-in
-- user could read the shop: every table allowed all "authenticated" users (shop_all), and a device that had never
-- passed an entry code was given the main company. With anonymous sign-ins on (and "Confirm email" off), anyone who
-- opened the website could have made such a user with the public key.
--
-- Now the cloud itself decides who is the shop:
--   * full access: an email login the shop already has (listed in shop_logins below), a login whose app_metadata
--     role is "owner", or a device that typed the master code;
--   * one company: a device whose entry code the cloud checked (join_company);
--   * anyone else: nothing at all.
-- Dealers are not affected (they never sign in; they use the anon key through the portal functions).
-- Run after all earlier migrations. Safe to run again.
begin;

create table if not exists public.shop_logins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.shop_logins enable row level security;
revoke all on public.shop_logins from anon, authenticated;

-- every email login that exists today was made by the shop
insert into public.shop_logins(user_id)
  select id from auth.users where coalesce(is_anonymous, false) = false
  on conflict do nothing;

create or replace function public.rj_full() returns boolean language sql stable security definer
set search_path = '' as $$
  select (coalesce((auth.jwt()->>'is_anonymous')::boolean, false) = false
          and (coalesce(auth.jwt()->'app_metadata'->>'role', '') = 'owner'
               or (coalesce(auth.jwt()->'app_metadata'->>'role', '') = ''
                   and exists (select 1 from public.shop_logins l where l.user_id = auth.uid()))))
      or coalesce((select d.master from public.company_devices d where d.user_id = auth.uid()), false)
$$;

create or replace function public.rj_member() returns boolean language sql stable security definer
set search_path = '' as $$
  select public.rj_full()
      or exists (select 1 from public.company_devices d where d.user_id = auth.uid() and d.store_id is not null)
$$;
revoke all on function public.rj_full(), public.rj_member() from public, anon;
grant execute on function public.rj_full(), public.rj_member() to authenticated;

-- one restrictive rule on every shop table: whatever else a policy allows, a signed-in user must be the shop
do $$
declare t text;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
       and c.relname not in ('company_devices', 'shop_logins')
  loop
    execute format('drop policy if exists shop_member on public.%I', t);
    execute format('create policy shop_member on public.%I as restrictive for all to authenticated using ((select public.rj_member())) with check ((select public.rj_member()))', t);
  end loop;
end $$;

commit;

-- Check afterwards (should list no table): shop tables that have no row security at all, so the rule above can't cover them.
-- select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
--  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
