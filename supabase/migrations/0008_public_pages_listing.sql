-- Public product pages, trade portal and shareable catalogues.
--
-- Run BEFORE deploying the matching app version: the app syncs every product
-- column, so a missing column would stop product sync.
-- Idempotent — safe to run more than once. No data is rewritten.
--
-- What the public (anon) web pages may read, and nothing more:
--   public_products    published products only, customer-safe columns only
--                      (never cost, cost_code, vendor, trade rate, notes)
--   public_catalogues  shared collections (config rows 'catalogue:<slug>')
--   public_shop        shop name + contact for page headers / WhatsApp buttons
--   trade_prices()     trade (wholesale) rates, returned ONLY for a valid key

-- ---------- columns (also re-asserts 0006/0007 in case one was skipped) ----------
alter table products
  add column if not exists model text,
  add column if not exists vendor_id uuid,
  add column if not exists vendor_name text,
  add column if not exists cost_code text,
  add column if not exists price_locked smallint default 0,
  add column if not exists embedding jsonb,
  add column if not exists embedding_dim integer,
  add column if not exists size text,
  add column if not exists pro_photo_id text,
  add column if not exists pro_photo_url text,
  add column if not exists catalogue smallint default 0,
  add column if not exists slug text,          -- URL of the public page: /p/<slug>
  add column if not exists content jsonb;      -- AI-written page: title, description, seo, trade, faq…

create unique index if not exists products_slug_uq on products(slug) where slug is not null and slug <> '';

-- ---------- published products (customer-safe columns only) ----------
drop view if exists public_products;
create view public_products as
select p.id, p.code, p.slug, p.item, p.type, p.style, p.color, p.size, p.category, p.pack, p.mrp,
       coalesce(nullif(p.pro_photo_url, ''), nullif(p.photo_url, '')) as image_url,
       p.content, p.updated_at,
       coalesce((
         select sum(x.d) from (
           select m.qty as d from movements m join locations l on l.id = m.to_loc
            where m.product_id = p.id and coalesce(m.deleted, 0) = 0 and l.kind <> 'bucket'
           union all
           select -m.qty from movements m join locations l on l.id = m.from_loc
            where m.product_id = p.id and coalesce(m.deleted, 0) = 0 and l.kind <> 'bucket'
         ) x), 0)::int as available
from products p
where p.catalogue = 1 and coalesce(p.deleted, 0) = 0 and coalesce(p.slug, '') <> '';

-- ---------- shared catalogues (collections the owner sends to buyers) ----------
drop view if exists public_catalogues;
create view public_catalogues as
select substr(c.id, 11) as slug,
       c.value->>'title' as title,
       c.value->>'note' as note,
       coalesce(c.value->>'audience', 'retail') as audience,
       coalesce(c.value->'product_ids', '[]'::jsonb) as product_ids,
       c.updated_at
from config c
where c.id like 'catalogue:%' and coalesce(c.deleted, 0) = 0
  and coalesce((c.value->>'active')::boolean, true);

-- ---------- shop header info ----------
drop view if exists public_shop;
create view public_shop as
select c.value->>'name' as name, c.value->>'tagline' as tagline, c.value->>'phone' as phone,
       c.value->>'whatsapp' as whatsapp, c.value->>'address' as address, c.value->>'state' as state
from config c where c.id = 'shop';

-- ---------- trade rates: only with the right key ----------
-- p_slug null  → portal-wide key (config 'trade_portal'.value.token) → all published designs
-- p_slug given → that catalogue's own key (config 'catalogue:<slug>'.value.key)
--                → ONLY the designs in that catalogue, and only while it is an active trade catalogue
create or replace function trade_prices(p_key text, p_slug text default null)
returns table (id uuid, rate bigint, pack integer)
language plpgsql stable security definer set search_path = public as $$
declare
  expected text;
  ids jsonb;
begin
  if coalesce(p_key, '') = '' or length(p_key) < 12 then return; end if;
  if p_slug is null then
    select c.value->>'token' into expected from config c
     where c.id = 'trade_portal' and coalesce(c.deleted, 0) = 0
       and coalesce((c.value->>'enabled')::boolean, true);
    if expected is null or expected <> p_key then return; end if;
    return query
      select p.id, p.rate, p.pack from products p
       where p.catalogue = 1 and coalesce(p.deleted, 0) = 0 and coalesce(p.slug, '') <> '';
  else
    select c.value->>'key', coalesce(c.value->'product_ids', '[]'::jsonb) into expected, ids from config c
     where c.id = 'catalogue:' || p_slug and coalesce(c.deleted, 0) = 0
       and coalesce((c.value->>'active')::boolean, true)
       and coalesce(c.value->>'audience', 'retail') = 'trade';
    if expected is null or expected <> p_key then return; end if;
    return query
      select p.id, p.rate, p.pack from products p
       where p.catalogue = 1 and coalesce(p.deleted, 0) = 0 and coalesce(p.slug, '') <> ''
         and ids ? p.id::text;
  end if;
end $$;

revoke all on function trade_prices(text, text) from public;
grant select on public_products, public_catalogues, public_shop to anon, authenticated;
grant execute on function trade_prices(text, text) to anon, authenticated;
