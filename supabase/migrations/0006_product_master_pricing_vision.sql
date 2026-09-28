-- Product master keying (SKU/Model + Vendor), consistent cost-code pricing,
-- and image-recognition fields for the hybrid matching system.
--
-- Safe to run more than once (every statement is IF NOT EXISTS). No data is
-- rewritten: existing products keep working, the new columns just fill in as
-- items are edited or re-labelled.

-- --- product-master keying & vendor ---
alter table products
  add column if not exists model       text,        -- vendor's model / article number
  add column if not exists vendor_id   uuid,         -- parties.id of the supplier (kind='supplier')
  add column if not exists vendor_name text;         -- denormalised for offline display / labels

-- --- consistent pricing / encrypted cost code ---
alter table products
  add column if not exists cost_code    text,        -- encrypted cost code printed on the label
  add column if not exists price_locked smallint default 0;  -- 1 = set by hand, don't overwrite from the rule

-- --- image recognition (visual feature vector) ---
-- Stored as jsonb (a plain array of numbers) so it syncs with no extra extension.
-- If you enable pgvector later you can migrate this to a `vector` column and add
-- an ANN index; for the shop's catalogue size an in-app cosine scan is plenty.
alter table products
  add column if not exists embedding     jsonb,
  add column if not exists embedding_dim integer;

-- lookups used by findByKey(model/vendor) and vendor-scoped reports
create index if not exists products_model_idx  on products(model);
create index if not exists products_vendor_idx on products(vendor_id);

-- vendor_id points at a supplier party; keep it soft (no FK) so an offline device
-- that hasn't pulled the party row yet can still store the id without a violation.
