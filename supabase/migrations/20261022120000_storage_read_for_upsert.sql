-- Voice notes and photos are uploaded with upsert, which Storage only allows when the uploader may also
-- read the object. Without a SELECT policy every voice-note upload failed with "new row violates
-- row-level security policy" (22 Oct, the Windows app). Both buckets are already public for reading.
drop policy if exists "shop read voice" on storage.objects;
create policy "shop read voice" on storage.objects for select to authenticated using (bucket_id = 'voice');
drop policy if exists "shop read photos" on storage.objects;
create policy "shop read photos" on storage.objects for select to authenticated using (bucket_id = 'photos');
