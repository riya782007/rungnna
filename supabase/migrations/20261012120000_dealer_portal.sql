-- Dealer (trade) portal: retailers register with their phone number + a PIN, the shop approves them,
-- they browse published designs at trade rates and place orders that reach the shop app.
--
-- Security model
--   * Dealers never get a Supabase login (an "authenticated" user can read the whole shop).
--     Everything a dealer does goes through the SECURITY DEFINER functions below, called with the
--     public anon key and the dealer's own session token.
--   * PINs are stored only as bcrypt hashes in dealer_secrets, which no API role can read.
--   * Session tokens are random; only their SHA-256 hash is stored. They expire after 30 days.
--   * Prices and stock in an order are recomputed on the server; whatever the browser sends is ignored.
--   * 5 wrong PINs lock the account for 15 minutes.
-- Idempotent: safe to run more than once.

create extension if not exists pgcrypto with schema extensions;

create table if not exists dealers (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  name text not null default '', shop_name text not null default '', city text not null default '', gstin text not null default '',
  status text not null default 'pending',      -- pending | approved | blocked
  party_id uuid,                                -- the customer account in the shop app, once linked
  note text not null default '',
  created_at timestamptz not null default now(),
  deleted smallint default 0, updated_at timestamptz not null default now()
);
create unique index if not exists dealers_phone_uq on dealers(phone) where coalesce(deleted, 0) = 0;

create table if not exists dealer_secrets (
  dealer_id uuid primary key references dealers(id) on delete cascade,
  pin_hash text not null, failed smallint not null default 0, locked_until timestamptz
);
create table if not exists dealer_sessions (
  token_hash text primary key, dealer_id uuid not null references dealers(id) on delete cascade,
  created_at timestamptz not null default now(), expires_at timestamptz not null
);
create sequence if not exists trade_order_seq;
create table if not exists trade_orders (
  id uuid primary key default gen_random_uuid(),
  no text not null default '',
  dealer_id uuid references dealers(id),
  dealer_name text not null default '', dealer_phone text not null default '', dealer_shop text not null default '',
  items jsonb not null default '[]'::jsonb,     -- [{product_id, code, title, color, size, pack, qty, rate, amount}] — server-priced
  total_qty integer not null default 0, total bigint not null default 0,
  note text not null default '',
  status text not null default 'new',           -- new | accepted | billed | cancelled
  bill_id uuid, bill_no text not null default '',
  at timestamptz not null default now(),
  deleted smallint default 0, updated_at timestamptz not null default now()
);
create index if not exists trade_orders_updated_idx on trade_orders(updated_at);
create index if not exists dealers_updated_idx on dealers(updated_at);

alter table dealers enable row level security;
alter table dealer_secrets enable row level security;
alter table dealer_sessions enable row level security;
alter table trade_orders enable row level security;
-- the shop's own login (authenticated) manages dealers and orders like every other shop table; secrets/sessions: nobody
drop policy if exists shop_all on dealers;      create policy shop_all on dealers      for all to authenticated using (true) with check (true);
drop policy if exists shop_all on trade_orders; create policy shop_all on trade_orders for all to authenticated using (true) with check (true);
revoke all on dealer_secrets, dealer_sessions from anon, authenticated;

-- ---------- helpers ----------
create or replace function dealer_norm_phone(p text) returns text language sql immutable as $$
  select case when length(d) = 12 and left(d, 2) = '91' then right(d, 10) else d end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x $$;

create or replace function dealer_from_token(p_token text) returns dealers
language plpgsql stable security definer set search_path = public, extensions as $$
declare d dealers;
begin
  if coalesce(p_token, '') = '' then raise exception 'Please log in again'; end if;
  select x.* into d from dealer_sessions s join dealers x on x.id = s.dealer_id
   where s.token_hash = encode(digest(p_token, 'sha256'), 'hex') and s.expires_at > now() and coalesce(x.deleted, 0) = 0;
  if d.id is null then raise exception 'Please log in again'; end if;
  if d.status <> 'approved' then raise exception 'Your account is not approved yet'; end if;
  return d;
end $$;

-- ---------- register / log in ----------
create or replace function dealer_register(p_phone text, p_name text, p_shop text, p_city text, p_gstin text, p_pin text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare ph text := dealer_norm_phone(p_phone); did uuid;
begin
  if length(ph) <> 10 then raise exception 'Enter a 10-digit mobile number'; end if;
  if coalesce(p_pin, '') !~ '^\d{4,6}$' then raise exception 'PIN must be 4 to 6 digits'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Enter your name'; end if;
  if exists (select 1 from dealers where phone = ph and coalesce(deleted, 0) = 0) then raise exception 'This number is already registered — log in instead'; end if;
  insert into dealers(phone, name, shop_name, city, gstin)
  values (ph, left(trim(p_name), 80), left(trim(coalesce(p_shop, '')), 80), left(trim(coalesce(p_city, '')), 60), upper(left(trim(coalesce(p_gstin, '')), 15)))
  returning id into did;
  insert into dealer_secrets(dealer_id, pin_hash) values (did, crypt(p_pin, gen_salt('bf')));
  return 'pending';
end $$;

create or replace function dealer_login(p_phone text, p_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
-- returns {token,...} or {error}: a wrong PIN must not raise, or the failed-try count would roll back with it
declare d dealers; s dealer_secrets; tok text;
begin
  select * into d from dealers where phone = dealer_norm_phone(p_phone) and coalesce(deleted, 0) = 0;
  if d.id is null then return jsonb_build_object('error', 'Wrong number or PIN'); end if;
  select * into s from dealer_secrets where dealer_id = d.id for update;
  if s.locked_until is not null and s.locked_until > now() then return jsonb_build_object('error', 'Too many tries — wait 15 minutes'); end if;
  if s.pin_hash is null or s.pin_hash <> crypt(coalesce(p_pin, ''), s.pin_hash) then
    update dealer_secrets set failed = failed + 1, locked_until = case when failed + 1 >= 5 then now() + interval '15 minutes' end where dealer_id = d.id;
    return jsonb_build_object('error', 'Wrong number or PIN');
  end if;
  update dealer_secrets set failed = 0, locked_until = null where dealer_id = d.id;
  if d.status = 'pending' then return jsonb_build_object('error', 'Thank you — the shop has not approved your account yet'); end if;
  if d.status <> 'approved' then return jsonb_build_object('error', 'This account is not active. Please call the shop.'); end if;
  tok := encode(gen_random_bytes(32), 'hex');
  delete from dealer_sessions where dealer_id = d.id and expires_at < now();
  insert into dealer_sessions(token_hash, dealer_id, expires_at) values (encode(digest(tok, 'sha256'), 'hex'), d.id, now() + interval '30 days');
  return jsonb_build_object('token', tok, 'name', d.name, 'shop', d.shop_name);
end $$;

create or replace function dealer_logout(p_token text) returns void language sql security definer set search_path = public, extensions as $$
  delete from dealer_sessions where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') $$;

-- ---------- catalogue at trade rates ----------
create or replace function dealer_catalogue(p_token text)
returns table (id uuid, code text, slug text, item text, type text, style text, color text, size text, category text, pack integer,
               mrp bigint, rate bigint, image_url text, title text, available integer)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform dealer_from_token(p_token);
  return query
    select v.id, v.code, v.slug, v.item, v.type, v.style, v.color, v.size, v.category, v.pack, v.mrp,
           coalesce(nullif(p.wholesale_rate, 0), p.rate)::bigint, v.image_url, coalesce(v.content->>'title', v.item), v.available
      from public_products v join products p on p.id = v.id
     where coalesce(nullif(p.wholesale_rate, 0), p.rate) > 0
     order by v.updated_at desc;
end $$;

create or replace function dealer_portal_info(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare d dealers;
begin
  d := dealer_from_token(p_token);
  return jsonb_build_object(
    'name', d.name, 'shop', d.shop_name, 'phone', d.phone,
    'min_order', coalesce((select (c.value->>'min_order')::bigint from config c where c.id = 'trade_portal'), 0),
    'orders', coalesce((select jsonb_agg(jsonb_build_object('no', o.no, 'at', o.at, 'total', o.total, 'total_qty', o.total_qty, 'status', o.status, 'bill_no', o.bill_no) order by o.at desc)
                        from (select * from trade_orders where dealer_id = d.id and coalesce(deleted, 0) = 0 order by at desc limit 30) o), '[]'::jsonb));
end $$;

-- ---------- place an order (priced here, never by the browser) ----------
create or replace function dealer_place_order(p_token text, p_items jsonb, p_note text default '')
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare d dealers; it jsonb; pr record; q int; lines jsonb := '[]'::jsonb; tq int := 0; tot bigint := 0; mn bigint; ono text; oid uuid; seen uuid[] := '{}';
begin
  d := dealer_from_token(p_token);
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Your cart is empty'; end if;
  if jsonb_array_length(p_items) > 200 then raise exception 'Too many lines in one order — split it'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    begin q := (it->>'qty')::int; exception when others then raise exception 'Check the quantities'; end;
    if q is null or q < 1 or q > 10000 then raise exception 'Check the quantities'; end if;
    select p.id, p.code, coalesce(p.content->>'title', p.item) as title, p.item, p.style, p.color, p.size, coalesce(p.pack, 1) as pack,
           coalesce(nullif(p.wholesale_rate, 0), p.rate)::bigint as rate
      into pr from products p
     where p.id = (it->>'product_id')::uuid and p.catalogue = 1 and coalesce(p.deleted, 0) = 0 and coalesce(p.slug, '') <> '';
    if pr.id is null or pr.rate <= 0 then raise exception 'A design in your cart is no longer available — refresh the page'; end if;
    if pr.id = any(seen) then raise exception 'A design is in the cart twice'; end if;
    seen := seen || pr.id;
    lines := lines || jsonb_build_object('product_id', pr.id, 'code', pr.code, 'title', pr.title, 'item', pr.item, 'style', pr.style,
             'color', pr.color, 'size', pr.size, 'pack', pr.pack, 'qty', q, 'rate', pr.rate, 'amount', pr.rate * q);
    tq := tq + q; tot := tot + pr.rate * q;
  end loop;
  mn := coalesce((select (c.value->>'min_order')::bigint from config c where c.id = 'trade_portal'), 0);
  if tot < mn then raise exception 'Minimum order is ₹%', round(mn / 100.0); end if;
  ono := 'TO-' || to_char(now() at time zone 'Asia/Kolkata', 'YYMMDD') || '-' || lpad(nextval('trade_order_seq')::text, 4, '0');
  insert into trade_orders(no, dealer_id, dealer_name, dealer_phone, dealer_shop, items, total_qty, total, note)
  values (ono, d.id, d.name, d.phone, d.shop_name, lines, tq, tot, left(coalesce(p_note, ''), 500)) returning id into oid;
  return jsonb_build_object('no', ono, 'total', tot, 'total_qty', tq);
end $$;

revoke all on function dealer_from_token(text) from public, anon, authenticated;
revoke all on function dealer_register(text, text, text, text, text, text), dealer_login(text, text), dealer_logout(text),
  dealer_catalogue(text), dealer_portal_info(text), dealer_place_order(text, jsonb, text) from public;
grant execute on function dealer_register(text, text, text, text, text, text), dealer_login(text, text), dealer_logout(text),
  dealer_catalogue(text), dealer_portal_info(text), dealer_place_order(text, jsonb, text) to anon, authenticated;
grant usage, select on sequence trade_order_seq to authenticated;
