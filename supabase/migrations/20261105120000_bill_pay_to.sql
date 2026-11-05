-- Owner, 5 Nov (voice): the bill's pay-QR is from the shop's UPI or the karigar's; the bill remembers whose.
alter table public.bills add column if not exists pay_to text;
