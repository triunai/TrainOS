-- Rollback for 0004_ai.sql
set local search_path = tpms, extensions, public;

drop index if exists idx_llm_usage_key_month;

-- NOT VALID: rows written while the constraints were absent may name a package
-- or run that never committed. Existing rows are not re-checked, so the
-- rollback cannot fail on them; every new row is checked again.
alter table llm_usage add constraint llm_usage_run_id_fkey
  foreign key (run_id) references agent_runs(id) not valid;
alter table llm_usage add constraint llm_usage_package_id_fkey
  foreign key (package_id) references training_packages(id) not valid;
