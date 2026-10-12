-- Vendor list: each supplier carries its short code (rate number) and its usual terms.
alter table parties add column if not exists vendor_code  text;
alter table parties add column if not exists less_pct     numeric(5,2) default 0;   -- "5% less"
alter table parties add column if not exists rate_divisor numeric(6,3) default 1;   -- "rate number divide 1.2"
create index if not exists parties_vendor_code_idx on parties(vendor_code) where vendor_code is not null;
