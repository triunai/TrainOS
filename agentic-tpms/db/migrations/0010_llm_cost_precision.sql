-- 0010_llm_cost_precision.sql
-- A 20-token embedding call costs ~USD 0.0000004; at numeric(12,6) it rounded
-- to zero and the Usage screen under-reported spend (found by the AI lane).
-- Widen the cost columns so small calls survive the round trip.
set local search_path = tpms, extensions, public;

alter table llm_usage
  alter column cost_usd type numeric(16,10),
  alter column cost_myr type numeric(16,8);

alter table agent_runs
  alter column cost_myr type numeric(16,8);
