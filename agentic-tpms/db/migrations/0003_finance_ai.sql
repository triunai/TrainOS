-- 0003_finance_ai.sql
-- Tax invoices, payment vouchers (pay-when-paid enforced in the database),
-- unit economics, retention cadences, and the BYOK agent/cost ledger.

set local search_path = tpms, extensions, public;

create sequence invoice_number_seq start 1;
create sequence pv_number_seq start 1;

create table tax_invoices (
  id                uuid primary key default gen_random_uuid(),
  package_id        uuid not null unique references training_packages(id),
  invoice_number    varchar(40) unique not null,
  billed_to         varchar(255) not null default 'Pembangunan Sumber Manusia Berhad (HRD Corp)',
  employer_name     varchar(255) not null,
  employer_mycoid   varchar(50),
  grant_reference   varchar(64) not null,
  subtotal          numeric(10,2) not null check (subtotal >= 0),
  tax_rate          numeric(5,4) not null default 0,
  tax_amount        numeric(10,2) not null default 0,
  total             numeric(10,2) not null,
  line_items        jsonb not null,
  vault_id          uuid references compliance_vault(id),
  issued_at         timestamptz not null default now(),
  constraint invoice_total_consistent check (total = subtotal + tax_amount)
);

create table payment_vouchers (
  id               uuid primary key default gen_random_uuid(),
  package_id       uuid not null references training_packages(id),
  pv_number        varchar(40) unique not null,
  payee_type       varchar(20) not null check (payee_type in ('TRAINER', 'VENUE', 'CATERING', 'PRINTING', 'COMMISSION')),
  payee_name       varchar(255) not null,
  engagement_id    uuid references trainer_engagements(id),
  commitment_id    uuid references vendor_commitments(id),
  agreed_amount    numeric(10,2) not null check (agreed_amount >= 0),
  adjustments      jsonb not null default '[]'::jsonb,
  final_amount     numeric(10,2) not null check (final_amount >= 0),
  status           varchar(20) not null default 'DRAFT' check (status in ('DRAFT', 'APPROVED', 'PAID', 'CANCELLED')),
  bank_reference   varchar(100),
  receipt_vault_id uuid references compliance_vault(id),
  vault_id         uuid references compliance_vault(id),
  approved_by      varchar(64),
  paid_by          varchar(64),
  paid_at          timestamptz,
  created_at       timestamptz not null default now(),
  constraint pv_paid_requires_evidence check (
    status <> 'PAID' or (bank_reference is not null and length(trim(bank_reference)) >= 4
                         and receipt_vault_id is not null and paid_by is not null and paid_at is not null))
);
create index idx_pv_package on payment_vouchers (package_id, status);

-- Pay-when-paid, as a database rule: nothing is disbursed for a package until
-- HRD Corp has remitted. A trainer or venue fee paid before remittance is the
-- working-capital failure the whole finance FSM exists to prevent.
create or replace function pv_guard() returns trigger
language plpgsql
set search_path = tpms, extensions, public, pg_temp
as $$
declare
  v_stage text;
begin
  if new.status = 'PAID' and (tg_op = 'INSERT' or old.status is distinct from 'PAID') then
    select financial_stage into v_stage from training_packages where id = new.package_id;
    if v_stage not in ('REMITTED', 'SETTLED_CLOSED') then
      raise exception 'PAY_WHEN_PAID: package financial stage is %, disbursement requires REMITTED', v_stage
        using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.status = 'PAID' and new.status <> 'PAID' then
    raise exception 'PV_PAID_IS_FINAL' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger trg_pv_guard before insert or update on payment_vouchers
  for each row execute function pv_guard();

create or replace function pv_audit() returns trigger
language plpgsql
set search_path = tpms, extensions, public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    perform audit_record('PAYMENT_VOUCHER', new.id, 'PV_DRAFTED', new.pv_number || ' ' || new.payee_name,
      jsonb_build_object('package_id', new.package_id, 'payee_type', new.payee_type,
                         'agreed_amount', new.agreed_amount));
  elsif new.status is distinct from old.status or new.final_amount is distinct from old.final_amount then
    perform audit_record('PAYMENT_VOUCHER', new.id, 'PV_' || new.status, new.pv_number,
      jsonb_row_diff(to_jsonb(old), to_jsonb(new), array['created_at']));
  end if;
  return new;
end;
$$;
create trigger trg_pv_audit after insert or update on payment_vouchers
  for each row execute function pv_audit();

create table job_financial_ledgers (
  id                          uuid primary key default gen_random_uuid(),
  package_id                  uuid unique not null references training_packages(id),
  approved_grant_amount       numeric(10,2) not null,
  trainer_fee_agreed          numeric(10,2) not null,
  trainer_fee_paid            numeric(10,2) not null default 0.00,
  venue_and_catering_cost     numeric(10,2) not null default 0.00,
  materials_and_printing_cost numeric(10,2) not null default 0.00,
  gross_margin                numeric(10,2) generated always as (
    approved_grant_amount - trainer_fee_agreed - venue_and_catering_cost - materials_and_printing_cost) stored,
  sales_rep_name              varchar(100),
  sales_commission_amount     numeric(10,2) not null default 0.00,
  net_retained_profit         numeric(10,2) generated always as (
    approved_grant_amount - trainer_fee_agreed - venue_and_catering_cost - materials_and_printing_cost
    - sales_commission_amount) stored,
  tax_invoice_number          varchar(100),
  bank_payment_reference      varchar(100),
  payment_receipt_vault_id    uuid references compliance_vault(id),
  claim_submitted_at          timestamptz,
  remitted_at                 timestamptz,
  reconciled_at               timestamptz,
  updated_at                  timestamptz not null default now()
);
create trigger trg_ledger_touch before update on job_financial_ledgers
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- Stage 7: retention cadences
-- ---------------------------------------------------------------------------
create table renewal_schedules (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null references corporate_clients(id),
  source_package_id     uuid not null references training_packages(id),
  cadence_type          varchar(50) not null check (cadence_type in (
                          'EXECUTIVE_PACK_T14', 'SYLLABUS_LADDER_T90', 'LEVY_YEAR_END_T300')),
  scheduled_for         date not null,
  status                varchar(50) not null default 'PENDING'
                        check (status in ('PENDING', 'DRAFTED', 'APPROVED', 'DISPATCHED', 'SKIPPED')),
  recommended_course_id uuid references course_catalog(id),
  draft_subject         varchar(255),
  draft_body            text,
  provenance            jsonb not null default '{}'::jsonb,
  vault_id              uuid references compliance_vault(id),
  dispatched_at         timestamptz,
  response_notes        text,
  created_at            timestamptz not null default now(),
  unique (source_package_id, cadence_type)
);

-- ---------------------------------------------------------------------------
-- BYOK provider keys, tier routing, agent runs, and the LLM cost ledger
-- ---------------------------------------------------------------------------
create table provider_keys (
  id               uuid primary key default gen_random_uuid(),
  provider         varchar(32) not null check (provider in ('anthropic', 'openrouter', 'deepseek', 'gemini', 'openai-compatible')),
  label            varchar(100) not null,
  base_url         text,
  key_ciphertext   text not null,
  masked_key       varchar(64) not null,
  tiers            text[] not null default '{}',
  monthly_cap_myr  numeric(10,2),
  status           varchar(16) not null default 'UNTESTED' check (status in ('UNTESTED', 'VALID', 'INVALID', 'DISABLED')),
  last_tested_at   timestamptz,
  last_test_result text,
  created_by       varchar(64),
  created_at       timestamptz not null default now()
);

create table tier_config (
  tier            varchar(8) primary key check (tier in ('L1', 'L3', 'L4', 'EMBED')),
  label           varchar(100) not null,
  provider        varchar(32) not null,
  model           varchar(100) not null,
  fallback        jsonb not null default '[]'::jsonb,
  monthly_cap_myr numeric(10,2) not null,
  max_tokens      int not null default 2048,
  enabled         boolean not null default true,
  updated_at      timestamptz not null default now()
);

create table agent_runs (
  id            uuid primary key default gen_random_uuid(),
  agent         varchar(64) not null,
  tier          varchar(4) not null check (tier in ('L0', 'L1', 'L2', 'L3', 'L4')),
  package_id    uuid references training_packages(id),
  lead_id       uuid references lead_records(id),
  task_id       uuid references task_queue(id),
  status        varchar(20) not null default 'RUNNING'
                check (status in ('RUNNING', 'SUCCEEDED', 'FAILED', 'FALLBACK')),
  input_summary text not null default '',
  output        jsonb not null default '{}'::jsonb,
  provenance    jsonb not null default '{}'::jsonb,
  cost_myr      numeric(12,4) not null default 0,
  error         text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index idx_agent_runs_recent on agent_runs (started_at desc);

create table llm_usage (
  id                uuid primary key default gen_random_uuid(),
  run_id            uuid references agent_runs(id),
  agent             varchar(64) not null,
  tier              varchar(8) not null,
  provider          varchar(32) not null,
  model             varchar(100) not null,
  key_id            uuid references provider_keys(id),
  package_id        uuid references training_packages(id),
  input_tokens      int not null default 0,
  output_tokens     int not null default 0,
  cache_read_tokens int not null default 0,
  cost_usd          numeric(12,6) not null default 0,
  cost_myr          numeric(12,4) not null default 0,
  cost_estimated    boolean not null default true,
  latency_ms        int not null default 0,
  status            varchar(24) not null check (status in ('OK', 'ERROR', 'FALLBACK_TEMPLATE', 'BUDGET_BLOCKED')),
  error             text,
  created_at        timestamptz not null default now()
);
create index idx_llm_usage_month on llm_usage (created_at, tier);
