-- Rollback for 0001_foundation.sql. The audit ledger refuses TRUNCATE/DELETE by
-- design; dropping the table is the only way out, and it is an owner-only act.
set local search_path = tpms, extensions, public;

drop function if exists claim_due(text, int, int, text[]);
drop table if exists task_queue;
drop table if exists domain_events;
drop function if exists domain_events_notify();
drop function if exists audit_record(text, uuid, text, text, jsonb, text, text, text);
drop function if exists audit_verify_chain();
drop table if exists audit_ledger;
drop function if exists audit_refuse_mutation();
drop function if exists audit_chain_before_insert();
drop function if exists audit_canonical(uuid, bigint, text, uuid, text, text, text, text, text, text, text, jsonb, timestamptz);
drop table if exists audit_chain_head;
drop function if exists touch_updated_at();
drop table if exists operators;
-- The tpms schema itself stays: it holds the runner's schema_migrations table.
