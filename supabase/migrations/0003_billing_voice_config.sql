-- Billing v1, customers, voice notes, shared shop settings.

alter table bills add column if not exists party_gstin text default '';
alter table bills add column if not exists party_state text default '';
alter table bills add column if not exists gst_rate numeric(5,2) default 3;
alter table bills add column if not exists cgst bigint default 0;
alter table bills add column if not exists sgst bigint default 0;
alter table bills add column if not exists igst bigint default 0;
alter table bills add column if not exists items jsonb not null default '[]'::jsonb;
alter table bills add column if not exists photo_id text;
alter table bills add column if not exists photo_url text;
alter table bills add column if not exists voice_id text;
alter table bills add column if not exists converted_to uuid;
alter table bills add column if not exists void_reason text default '';
create index if not exists bills_at_idx on bills(at desc);
create index if not exists bills_updated_idx on bills(updated_at);
create unique index if not exists bills_no_uq on bills(no) where no is not null and no <> '';

alter table parties add column if not exists photo_id text;
create index if not exists parties_phone_idx on parties(phone);
create index if not exists parties_updated_idx on parties(updated_at);

-- bill lines live inside the bill (one row = one atomic offline save); this keeps a flat copy for reports
create or replace function bills_explode_items() returns trigger language plpgsql set search_path = public as $$
begin
  delete from bill_items where bill_id = new.id;
  insert into bill_items (id, bill_id, product_id, code, item, type, style, color, box_no, qty, rate, disc, amount)
  select gen_random_uuid(), new.id,
         nullif(x->>'product_id','')::uuid, coalesce(x->>'code',''), coalesce(x->>'item',''), coalesce(x->>'type',''),
         coalesce(x->>'style',''), coalesce(x->>'color',''), coalesce((x->>'box_no')::int,1), coalesce((x->>'qty')::int,0),
         coalesce((x->>'rate')::bigint,0), coalesce(x->>'disc',''), coalesce((x->>'amount')::bigint,0)
  from jsonb_array_elements(coalesce(new.items,'[]'::jsonb)) x
  where exists (select 1 from products p where p.id = nullif(x->>'product_id','')::uuid) or nullif(x->>'product_id','') is null;
  return new;
end $$;
drop trigger if exists bills_explode on bills;
create trigger bills_explode after insert or update of items on bills for each row execute function bills_explode_items();

-- every status change of a bill (hold → final → void / converted) is written to the audit log
create or replace function bills_audit() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status or new.net is distinct from old.net then
    insert into audit_log (actor, device, action, entity, entity_id, detail)
    values (new.by_staff, new.device, 'bill_' || new.status, 'bill', new.id::text,
            jsonb_build_object('no', new.no, 'type', new.bill_type, 'net', new.net, 'old_status', case when tg_op='UPDATE' then old.status end,
                               'old_net', case when tg_op='UPDATE' then old.net end, 'reason', new.void_reason));
  end if;
  return new;
end $$;
drop trigger if exists bills_audit_trg on bills;
create trigger bills_audit_trg after insert or update on bills for each row execute function bills_audit();

create table if not exists voice_notes (
  id uuid primary key, entity text not null default '', entity_id text not null default '',
  seconds integer default 0, transcript text default '', url text, by_staff text default '', at timestamptz default now(),
  deleted smallint default 0, updated_at timestamptz not null default now()
);
create index if not exists voice_entity_idx on voice_notes(entity_id);

create table if not exists config (
  id text primary key, value jsonb not null default '{}'::jsonb,
  deleted smallint default 0, updated_at timestamptz not null default now()
);

do $$ declare t text; begin
  foreach t in array array['voice_notes','config'] loop
    execute format('drop trigger if exists %I_touch on %I', t, t);
    execute format('create trigger %I_touch before insert or update on %I for each row execute function touch_updated_at()', t, t);
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists shop_all on %I', t);
    execute format('create policy shop_all on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('voice', 'voice', true, 3000000, array['audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/aac','audio/wav'])
on conflict (id) do nothing;
drop policy if exists "shop upload voice" on storage.objects;
create policy "shop upload voice" on storage.objects for insert to authenticated with check (bucket_id = 'voice');
drop policy if exists "shop update voice" on storage.objects;
create policy "shop update voice" on storage.objects for update to authenticated using (bucket_id = 'voice');
