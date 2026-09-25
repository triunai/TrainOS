-- Rollback for 0003_finance_ai.sql
set local search_path = tpms, extensions, public;

drop table if exists llm_usage;
drop table if exists agent_runs;
drop table if exists tier_config;
drop table if exists provider_keys;
drop table if exists renewal_schedules;
drop table if exists job_financial_ledgers;
drop trigger if exists trg_pv_audit on payment_vouchers;
drop trigger if exists trg_pv_guard on payment_vouchers;
drop table if exists payment_vouchers;
drop function if exists pv_audit();
drop function if exists pv_guard();
drop table if exists tax_invoices;
drop sequence if exists pv_number_seq;
drop sequence if exists invoice_number_seq;
