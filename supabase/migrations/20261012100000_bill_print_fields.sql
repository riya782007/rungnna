-- Fields the app already keeps on a bill that the cloud must accept, or sync stops for the whole shop.
alter table bills add column if not exists party_address text default '';   -- buyer address printed on tax invoices
alter table bills add column if not exists oversold jsonb;                  -- pieces sold beyond recorded rack stock
