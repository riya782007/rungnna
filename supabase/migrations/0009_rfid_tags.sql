-- RFID (UHF, USB keyboard mode). Tags live in products.barcodes like any other scan code.
-- sold_tags: tag → bill no. it left on (set when a bill is saved, cleared on void / stock-in).
alter table products add column if not exists sold_tags jsonb not null default '{}'::jsonb;
-- tags read onto a bill / stock-in; each tag counts once
alter table bills add column if not exists rfid_tags text[] not null default '{}';
alter table purchases add column if not exists rfid_tags text[] not null default '{}';
