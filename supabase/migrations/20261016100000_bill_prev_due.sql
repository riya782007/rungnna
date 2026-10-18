-- The party's balance before a bill, frozen when the bill is first saved and printed on it as
-- "Previous balance" / "Total due" (wholesale bills carry the running account). Paise.
alter table bills add column if not exists prev_due bigint;
