-- Merge / split, delivery challans (bill_type 'challan', CH/ series), sales returns (bill_type 'return', CN/ series).
-- bill_type and status are plain text, so the new values need no change; these are the links between documents.
alter table bills add column if not exists merged_into uuid;
alter table bills add column if not exists merged_into_no text default '';
alter table bills add column if not exists merged_from jsonb default '[]'::jsonb;
alter table bills add column if not exists return_of uuid;
alter table bills add column if not exists return_of_no text default '';
alter table bills add column if not exists src_type text default '';
create index if not exists bills_return_of_idx on bills(return_of);
create index if not exists bills_merged_into_idx on bills(merged_into);
