-- Owner, 26 Oct (voice): the customer's goods go into carry bags, and the bag tags must say how many carry bags
-- were made ("1 of 2, 2 of 2") — not how many boxes the lines were scanned into.
alter table public.bills add column if not exists carry_bags integer not null default 0;
