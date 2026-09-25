-- Rollback for 0010_llm_cost_precision.sql (narrows again; tiny costs round to zero).
set local search_path = tpms, extensions, public;

alter table llm_usage
  alter column cost_usd type numeric(12,6),
  alter column cost_myr type numeric(12,4);

alter table agent_runs
  alter column cost_myr type numeric(12,4);
