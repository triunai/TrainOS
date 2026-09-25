-- 0004_ai.sql
-- The LLM cost ledger drops its foreign keys into packages and agent runs.
--
-- tpms.llm_usage is written on its own pool connection, outside the caller's
-- transaction, on purpose: the money was spent whether or not the business
-- write that asked for the model call later commits. A foreign key from that
-- ledger into rows the caller holds or has not yet committed turns the insert
-- into a wait on the caller, while the caller is waiting on the insert:
--
--   * package_id -> training_packages: lockPackage() holds the row FOR UPDATE,
--     which conflicts with the FOR KEY SHARE an FK check takes. Claim
--     collation and PV drafting call runTier() under that lock. The two waits
--     are on different connections, so Postgres cannot see a deadlock; the
--     request simply never returns.
--   * run_id -> agent_runs: a run opened with startAgentRun(tx) inside the
--     caller's transaction is invisible to the ledger's connection, so the
--     insert fails its FK check.
--
-- Both columns stay as plain uuids; attribution is by value. key_id keeps its
-- foreign key: provider keys are committed in their own transaction and only
-- ever updated in non-key columns, which never conflicts with FOR KEY SHARE.
-- Pinned by tests/integration/ai-router.test.ts ("the ledger is written
-- outside the caller's transaction").

set local search_path = tpms, extensions, public;

alter table llm_usage drop constraint llm_usage_package_id_fkey;
alter table llm_usage drop constraint llm_usage_run_id_fkey;

-- Per-key month-to-date spend (the per-key budget gate and the Settings list).
create index idx_llm_usage_key_month on llm_usage (key_id, created_at) where key_id is not null;
