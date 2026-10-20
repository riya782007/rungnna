-- Who packed and who rechecked the bill (counter request 21/10/2026). Safe to run again.
alter table public.bills add column if not exists packed_by text default '';
alter table public.bills add column if not exists checked_by text default '';
notify pgrst, 'reload schema';
