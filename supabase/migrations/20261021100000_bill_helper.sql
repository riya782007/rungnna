-- Helper who worked the bill, beside the salesman (counter request 20/10/2026). Safe to run again.
alter table public.bills add column if not exists helper text default '';
notify pgrst, 'reload schema';
