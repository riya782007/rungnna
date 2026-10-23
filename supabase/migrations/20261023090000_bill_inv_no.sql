-- Owner, 23 Oct: "the estimate format: after the estimate number the invoice number can be written".
alter table public.bills add column if not exists inv_no text;
