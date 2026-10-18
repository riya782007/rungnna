-- Dealer state (GST), friendlier phone matching, and catalogue-link privacy.
-- Idempotent: safe to run more than once.
--
-- Why each change
--
--  1. dealers.state — a trade order becomes a bill through lib/trade.partyForDealer. The dealer's
--     state was never captured, so isInterState() compared a blank shop-side code to a blank
--     party-side code, returned false, and a Mumbai dealer without a GSTIN was billed CGST+SGST
--     where the law wants IGST. The state is now asked for at sign-up and required.
--
--  2. dealer_norm_phone — it stripped "+91" but not the leading "0" that retailers type all the
--     time, so "09876543210" and "9876543210" were two different dealers (and a dealer who
--     registered one way could not log in the other way).
--
--  3. catalogue_by_slug — a curated catalogue is a private link sent to ONE buyer, and its title
--     and note can name them ("For Rakesh bhai — 10% extra"). `public_catalogues` was granted to
--     anon, and the anon key is inlined in the public /dealer page, so any dealer could list every
--     collection made for every other buyer. The view is now fetched by slug through a keyed
--     function; only the shop's own login may still list them. Published PRODUCTS stay readable —
--     the /shop pages are meant to be public and indexed.
--
--  4. The public views were writable by anon and authenticated (a blanket grant). Most are not
--     auto-updatable so the writes would have failed anyway, but a read-only view should say so.

alter table dealers add column if not exists state text not null default '';

-- ---------- 2. phone matching ----------
create or replace function dealer_norm_phone(p text) returns text language sql immutable as $fn$
  select case
           when length(d) = 10 then d
           when length(d) = 11 and left(d, 1) = '0'   then right(d, 10)
           when length(d) = 12 and left(d, 2) = '91'  then right(d, 10)
           when length(d) = 13 and left(d, 3) = '091' then right(d, 10)
           else d
         end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x
$fn$;

-- ---------- 1. registration takes a state ----------
create or replace function dealer_register(p_phone text, p_name text, p_shop text, p_city text, p_gstin text, p_pin text, p_state text default '')
returns text language plpgsql security definer set search_path = public, extensions as $fn$
declare ph text := dealer_norm_phone(p_phone); did uuid; st text;
begin
  if length(ph) <> 10 then raise exception 'Enter a 10-digit mobile number'; end if;
  if coalesce(p_pin, '') !~ '^[0-9]{4,6}$' then raise exception 'PIN must be 4 to 6 digits'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Enter your name'; end if;
  if exists (select 1 from dealers where phone = ph and coalesce(deleted, 0) = 0) then raise exception 'This number is already registered - log in instead'; end if;
  st := upper(left(trim(coalesce(p_state, '')), 40));
  if st = '' then raise exception 'Choose your state - it decides the GST on your bills'; end if;
  insert into dealers(phone, name, shop_name, city, gstin, state)
  values (ph, left(trim(p_name), 80), left(trim(coalesce(p_shop, '')), 80), left(trim(coalesce(p_city, '')), 60), upper(left(trim(coalesce(p_gstin, '')), 15)), st)
  returning id into did;
  insert into dealer_secrets(dealer_id, pin_hash) values (did, crypt(p_pin, gen_salt('bf')));
  return 'pending';
end
$fn$;

-- The old 6-argument overload refuses, so a /dealer page served before this deploy cannot create
-- a stateless dealer account. The wording is for the window between this migration and the
-- matching deploy, when refreshing the page will NOT help — so it sends the dealer to the shop
-- rather than into a loop.
create or replace function dealer_register(p_phone text, p_name text, p_shop text, p_city text, p_gstin text, p_pin text)
returns text language plpgsql security definer set search_path = public, extensions as $fn$
begin
  raise exception 'Sign-up is being updated right now - please call or WhatsApp the shop and we will register you';
end
$fn$;

-- ---------- the portal tells the dealer what we hold ----------
create or replace function dealer_portal_info(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $fn$
declare d dealers;
begin
  d := dealer_from_token(p_token);
  return jsonb_build_object(
    'name', d.name, 'shop', d.shop_name, 'phone', d.phone, 'state', d.state, 'gstin', d.gstin,
    'min_order', coalesce((select (c.value->>'min_order')::bigint from config c where c.id = 'trade_portal'), 0),
    'orders', coalesce((select jsonb_agg(jsonb_build_object('no', o.no, 'at', o.at, 'total', o.total, 'total_qty', o.total_qty, 'status', o.status, 'bill_no', o.bill_no) order by o.at desc)
                        from (select * from trade_orders where dealer_id = d.id and coalesce(deleted, 0) = 0 order by at desc limit 30) o), '[]'::jsonb));
end
$fn$;

-- ---------- 3. a catalogue link is fetched, never listed ----------
create or replace function catalogue_by_slug(p_slug text)
returns table (slug text, title text, note text, audience text, product_ids jsonb, updated_at timestamptz)
language sql stable security definer set search_path = public as $fn$
  select substr(c.id, 11) as slug,
         c.value->>'title'  as title,
         c.value->>'note'   as note,
         coalesce(c.value->>'audience', 'retail') as audience,
         coalesce(c.value->'product_ids', '[]'::jsonb) as product_ids,
         c.updated_at
    from config c
   where c.id = 'catalogue:' || coalesce(p_slug, '')
     and coalesce(c.deleted, 0) = 0
     and coalesce((c.value->>'active')::boolean, true)
   limit 1
$fn$;

revoke all on public_catalogues from anon;
grant select on public_catalogues to authenticated;        -- the shop's own Catalogue page lists them
revoke all on function catalogue_by_slug(text) from public;
grant execute on function catalogue_by_slug(text) to anon, authenticated;

-- ---------- 4. the public views are read-only ----------
revoke insert, update, delete, truncate on public_products, public_shop from anon;
revoke insert, update, delete, truncate on public_products, public_catalogues, public_shop from authenticated;

revoke all on function dealer_register(text, text, text, text, text, text, text) from public;
grant execute on function dealer_register(text, text, text, text, text, text, text) to anon, authenticated;
