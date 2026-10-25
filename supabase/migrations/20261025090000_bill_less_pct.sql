-- Owner, 25 Oct (voice): "after the discount we cut 2% or 3% more for good customers — cut on what is left, not
-- typed as 53%; and some items must never get that cut". The second cut, applied after the discount.
alter table public.bills add column if not exists less_pct numeric not null default 0;
