-- Size / measurement option, polished catalogue image, and a catalogue-published
-- flag on products. Idempotent; no data rewritten.

alter table products
  add column if not exists size          text,
  add column if not exists pro_photo_id  text,
  add column if not exists pro_photo_url  text,
  add column if not exists catalogue      smallint default 0;

-- fast "what's published to the shareable catalogue" lookups
create index if not exists products_catalogue_idx on products(catalogue) where catalogue = 1;
