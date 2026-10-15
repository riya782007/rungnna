-- Role passcodes (Roles & Permissions, in the style of the reference console).
-- A role's passcode signs in as a dedicated staff row marked login = 'role'. That row is not a
-- person: it never appears in the person list and cannot carry a PIN. The passcodes themselves
-- live in the synced config row 'roles', next to the permissions they unlock.
alter table staff add column if not exists login text default '';
