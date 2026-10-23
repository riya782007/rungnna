-- Owner, 23 Oct: a person is just a name with their own ticked permissions, and may open more than one company.
alter table public.staff add column if not exists perms jsonb;
alter table public.staff add column if not exists stores jsonb;
-- the two companies: "gst" (tax invoices) and "estimate" (estimates), each with its own stock, purchases and reports
alter table public.stores add column if not exists kind text;
