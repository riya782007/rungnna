alter table public.purchases
  add column if not exists invoice_total bigint;

comment on column public.purchases.invoice_total is
  'Reviewed supplier payable including tax, freight and discounts; null uses total_cost for older purchases.';
