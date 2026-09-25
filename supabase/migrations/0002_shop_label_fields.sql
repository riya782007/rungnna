-- shop's existing sticker: ITEMCODE~RATE~PACK~REF~TK~STYLE~COLOR
alter table products add column if not exists item_code text, add column if not exists ref text, add column if not exists pack integer;
create index if not exists products_item_code_idx on products(item_code);
