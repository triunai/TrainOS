-- 0002_domain.sql
-- Intake, knowledge (pgvector), resources, the TrainingPackage aggregate with
-- its two DB-enforced state machines, delivery evidence, and the HITL queue.

set local search_path = tpms, extensions, public;

-- ---------------------------------------------------------------------------
-- Corporate clients
-- ---------------------------------------------------------------------------
create table corporate_clients (
  id                    uuid primary key default gen_random_uuid(),
  company_name          varchar(255) not null,
  company_domain        varchar(100),
  ssm_registration      varchar(50) unique,
  hrdcorp_mycoid        varchar(50),
  industry_sector       varchar(100),
  malaysian_headcount   int check (malaysian_headcount >= 0),
  levy_registered       boolean not null default false,
  levy_balance_estimate numeric(12,2),
  fiscal_year_end_month int check (fiscal_year_end_month between 1 and 12),
  account_type          varchar(30) not null default 'SBL_KHAS_LEVY'
                        check (account_type in ('SBL_KHAS_LEVY', 'PRIVATE_CASH')),
  primary_pic_name      varchar(255) not null,
  primary_pic_email     varchar(255) not null,
  primary_pic_phone     varchar(30) not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index uq_client_domain on corporate_clients (lower(company_domain))
  where company_domain is not null;
create trigger trg_clients_touch before update on corporate_clients
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- Stage 1: raw payloads, lead records, outbound outbox
-- ---------------------------------------------------------------------------
create table raw_lead_payloads (
  id                   uuid primary key default gen_random_uuid(),
  source_channel       varchar(50) not null check (source_channel in (
                         'META_LEADGEN', 'GOOGLE_WEBHOOK', 'LINKEDIN_SYNC', 'WHATSAPP_INBOUND',
                         'INBOUND_MAIL', 'SMART_BCC', 'WEB_FORM', 'MANUAL')),
  raw_payload          jsonb not null,
  sha256_hash          char(64) not null,
  ad_click_identifiers jsonb,
  status               varchar(30) not null default 'INGESTED'
                       check (status in ('INGESTED', 'DUPLICATE', 'REJECTED', 'PROCESSED')),
  created_at           timestamptz not null default now()
);
create unique index uq_raw_payload_hash on raw_lead_payloads (sha256_hash);

create table lead_records (
  id                      uuid primary key default gen_random_uuid(),
  raw_payload_id          uuid references raw_lead_payloads(id),
  client_id               uuid references corporate_clients(id),
  duplicate_of            uuid references lead_records(id),
  company_name            varchar(255) not null,
  company_domain          varchar(100),
  ssm_registration_number varchar(50),
  pic_full_name           varchar(150) not null,
  pic_email               varchar(150) not null,
  pic_phone_e164          varchar(30) not null default '',
  training_topic          varchar(255),
  message                 text,
  triage_intent           varchar(50),
  p_levy_liable           numeric(4,3) check (p_levy_liable between 0 and 1),
  urgency_score           int check (urgency_score between 1 and 5),
  classifier_model        varchar(100),
  classifier_latency_ms   int,
  channel_source          varchar(50) not null,
  campaign_id             varchar(100),
  ad_id                   varchar(100),
  has_whatsapp_opt_in     boolean not null default false,
  account_type            varchar(30) not null default 'SBL_KHAS_LEVY'
                          check (account_type in ('SBL_KHAS_LEVY', 'PRIVATE_CASH')),
  estimated_pax           int,
  delivery_preference     varchar(30) check (delivery_preference in ('IN_HOUSE', 'PUBLIC_PHYSICAL', 'ROT_VIRTUAL')),
  tna_profile             jsonb not null default '{}'::jsonb,
  status                  varchar(50) not null default 'LEAD_INGESTED'
                          check (status in ('LEAD_INGESTED', 'LEAD_QUALIFIED_TNA', 'TRIAGE_REVIEW',
                                            'PRIVATE_CASH', 'ARCHIVED', 'DUPLICATE', 'CONVERTED')),
  converted_package_id    uuid,
  qualified_at            timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index idx_leads_status on lead_records (status, created_at desc);
create index idx_leads_domain on lead_records (lower(company_domain));
create index idx_leads_phone on lead_records (pic_phone_e164);
create trigger trg_leads_touch before update on lead_records
  for each row execute function touch_updated_at();

create table outbound_campaign_outbox (
  id                   uuid primary key default gen_random_uuid(),
  batch_id             uuid not null,
  sequence_step        int not null default 1 check (sequence_step between 1 and 3),
  target_company       varchar(255) not null,
  target_pic_email     varchar(150) not null,
  ssm_number           varchar(50),
  hiring_signal_notes  text,
  subject_line         varchar(255) not null,
  email_body_text      text not null,
  word_count           int not null,
  has_opt_out_link     boolean not null default true,
  is_approved_by_human boolean not null default false,
  approved_by_user_id  varchar(64) references operators(id),
  approved_at          timestamptz,
  sent_at              timestamptz,
  provenance           jsonb not null default '{}'::jsonb,
  status               varchar(30) not null default 'WAITING_APPROVAL'
                       check (status in ('WAITING_APPROVAL', 'APPROVED', 'REJECTED', 'DISPATCHED', 'BOUNCED', 'REPLIED')),
  created_at           timestamptz not null default now(),
  -- The HITL gate as a constraint: nothing leaves without a named human.
  constraint outbox_dispatch_requires_human check (
    status not in ('APPROVED', 'DISPATCHED', 'BOUNCED', 'REPLIED')
    or (is_approved_by_human and approved_by_user_id is not null and approved_at is not null)
  ),
  constraint outbox_word_budget check (word_count <= 120)
);
create index idx_outbox_status on outbound_campaign_outbox (status, batch_id);

-- ---------------------------------------------------------------------------
-- Stage 2 knowledge base: course catalog + JPK/NOSS + HRD focus areas (pgvector)
-- ---------------------------------------------------------------------------
create table course_catalog (
  id                      uuid primary key default gen_random_uuid(),
  course_code             varchar(50) unique not null,
  title                   varchar(255) not null,
  hrd_focus_area          varchar(100) not null,
  matched_noss_code       varchar(50),
  target_seniority        varchar(50) not null check (target_seniority in ('EXECUTIVE', 'SUPERVISORY', 'OPERATIONAL')),
  level                   int not null default 1 check (level between 1 and 5),
  next_course_code        varchar(50),
  duration_days           int not null default 2 check (duration_days between 1 and 10),
  learning_outcomes       jsonb not null,
  master_outline_markdown text not null,
  hrdc_programme_id       varchar(50),
  syllabus_embedding      vector(1536),
  embedding_model         varchar(100),
  created_at              timestamptz not null default now()
);
create index idx_course_embedding on course_catalog
  using hnsw (syllabus_embedding vector_cosine_ops);

create table knowledge_chunks (
  id              uuid primary key default gen_random_uuid(),
  source_type     varchar(32) not null check (source_type in ('NOSS', 'FOCUS_AREA', 'COURSE_MODULE', 'POLICY')),
  source_ref      varchar(100) not null,
  title           varchar(255) not null,
  body            text not null,
  embedding       vector(1536),
  embedding_model varchar(100),
  created_at      timestamptz not null default now(),
  unique (source_type, source_ref)
);
create index idx_knowledge_embedding on knowledge_chunks
  using hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- Resources: trainers and vendors
-- ---------------------------------------------------------------------------
create table trainers (
  id                   uuid primary key default gen_random_uuid(),
  full_name            varchar(255) not null,
  nric_hash            varchar(64) not null unique,
  nric_encrypted       bytea not null,
  nric_masked          varchar(20) not null,
  email                varchar(255) not null,
  phone                varchar(50) not null,
  ttt_cert_number      varchar(100) not null,
  ttt_cert_expiry_date date,
  ttt_verified         boolean not null default false,
  standard_day_rate    numeric(10,2) not null check (standard_day_rate >= 0),
  specialties          text[] not null default '{}',
  unavailable_dates    date[] not null default '{}',
  bio_summary          text,
  created_at           timestamptz not null default now()
);

create table vendors (
  id                       uuid primary key default gen_random_uuid(),
  vendor_type              varchar(32) not null check (vendor_type in ('VENUE', 'CATERING', 'PRINTING')),
  name                     varchar(255) not null,
  city                     varchar(100),
  latitude                 numeric(9,6),
  longitude                numeric(9,6),
  capacity                 int,
  ddr_per_pax              numeric(10,2),
  unit_cost                numeric(10,2),
  free_postponement_days   int not null default 7,
  cancellation_notice_days int not null default 14,
  contact_email            varchar(255),
  contact_phone            varchar(50),
  created_at               timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Cost policy (the Allowable Cost Matrix, versioned). Values are policy data,
-- not code: an operator edits them when HRD Corp issues a new circular.
-- ---------------------------------------------------------------------------
create table cost_matrix_policies (
  id             uuid primary key default gen_random_uuid(),
  version        varchar(32) not null,
  delivery_mode  varchar(32) not null check (delivery_mode in ('IN_HOUSE', 'PUBLIC_PHYSICAL', 'ROT_VIRTUAL')),
  basis          varchar(20) not null check (basis in ('PER_GROUP_DAY', 'PER_PAX_DAY')),
  bands          jsonb not null,
  effective_from date not null,
  active         boolean not null default true,
  source_note    text not null,
  created_at     timestamptz not null default now(),
  unique (version, delivery_mode)
);

-- ---------------------------------------------------------------------------
-- The aggregate root: TrainingPackage (Curriculum x Trainer x Venue x Pax)
-- ---------------------------------------------------------------------------
create sequence package_code_seq start 1;

create table training_packages (
  id                       uuid primary key default gen_random_uuid(),
  package_code             varchar(32) unique not null,
  client_id                uuid not null references corporate_clients(id),
  lead_id                  uuid references lead_records(id),
  course_id                uuid references course_catalog(id),
  title                    varchar(255) not null,
  operational_stage        varchar(32) not null default 'DRAFT' check (operational_stage in (
                             'DRAFT', 'QUOTED', 'GRANT_PENDING', 'GRANT_APPROVED', 'OPERATIONS_LOCKED',
                             'READY_FOR_EVENT', 'DELIVERY_IN_PROGRESS', 'DELIVERY_COMPLETED',
                             'CANCELLED', 'POSTPONED')),
  financial_stage          varchar(32) not null default 'ESTIMATE' check (financial_stage in (
                             'ESTIMATE', 'GRANT_RESERVED', 'UPFRONT_CLAIM_SUBMITTED', 'CLAIM_NOT_READY',
                             'CLAIM_READY', 'CLAIM_SUBMITTED', 'QUERIED', 'APPROVED', 'REMITTED',
                             'SETTLED_CLOSED', 'VOIDED')),
  delivery_mode            varchar(32) not null check (delivery_mode in ('IN_HOUSE', 'PUBLIC_PHYSICAL', 'ROT_VIRTUAL')),
  venue_by_client          boolean not null default false,
  start_date               date,
  end_date                 date,
  duration_days            int generated always as ((end_date - start_date) + 1) stored,
  pax_estimate             int not null default 0 check (pax_estimate >= 0),
  min_participants         int not null default 5 check (min_participants >= 1),
  etris_grant_id           varchar(64),
  grant_approved_amount    numeric(10,2),
  grant_approved_pax       int,
  grant_approved_at        timestamptz,
  quoted_amount            numeric(10,2) not null default 0,
  allowable_cost_cap       numeric(10,2),
  trainer_day_rate         numeric(10,2),
  cost_policy_version      varchar(32),
  upfront_30pct_claimed    boolean not null default false,
  upfront_amount           numeric(10,2) not null default 0,
  claim_submission_ref     varchar(100),
  hrdc_approved_amount     numeric(10,2),
  remittance_amount        numeric(10,2),
  remittance_reference     varchar(100),
  remitted_at              timestamptz,
  vendor_autoconfirm_halted boolean not null default false,
  cancellation_reason      text,
  postponed_from_start     date,
  created_by               varchar(64),
  version                  int not null default 1,
  created_at               timestamptz default current_timestamp,
  updated_at               timestamptz default current_timestamp,
  constraint pkg_dates_ordered check (end_date is null or start_date is null or end_date >= start_date),
  constraint pkg_grant_within_quote check (
    grant_approved_amount is null or grant_approved_amount <= quoted_amount),
  constraint pkg_quote_within_cap check (
    allowable_cost_cap is null or quoted_amount <= allowable_cost_cap)
);
create index idx_packages_ops_stage on training_packages (operational_stage);
create index idx_packages_fin_stage on training_packages (financial_stage);
create index idx_packages_start on training_packages (start_date);

-- The transition table IS the state machine. The TypeScript FSM carries the
-- identical table (src/server/fsm/transitions.ts) and a test asserts the two
-- are equal row for row, so neither side can drift silently.
create table fsm_transitions (
  machine             varchar(16) not null check (machine in ('OPERATIONAL', 'FINANCIAL')),
  from_stage          varchar(32) not null,
  to_stage            varchar(32) not null,
  reason_code         varchar(64) not null,
  allowed_actor_types text[] not null check (allowed_actor_types <@ array['USER', 'SYSTEM']::text[]
                                             and cardinality(allowed_actor_types) > 0),
  description         text not null,
  primary key (machine, from_stage, to_stage, reason_code)
);

insert into fsm_transitions (machine, from_stage, to_stage, reason_code, allowed_actor_types, description) values
  ('OPERATIONAL', 'DRAFT', 'QUOTED', 'COMMERCIAL_TERMS_APPROVED', '{USER}', 'Gate 1: operator approves the priced quotation and dispatches it'),
  ('OPERATIONAL', 'QUOTED', 'DRAFT', 'QUOTATION_REVISION_REQUESTED', '{USER}', 'Client asked for a revised quotation'),
  ('OPERATIONAL', 'QUOTED', 'GRANT_PENDING', 'CLIENT_ACCEPTED_QUOTATION', '{USER}', 'Client accepted; HR files the e-TRiS grant application'),
  ('OPERATIONAL', 'GRANT_PENDING', 'GRANT_APPROVED', 'GRANT_CONFIRMED_LOCKED', '{USER}', 'Operator verified the extracted e-TRiS approval letter'),
  ('OPERATIONAL', 'GRANT_APPROVED', 'OPERATIONS_LOCKED', 'OPERATIONS_READINESS_LOCKED', '{USER,SYSTEM}', 'Trainer confirmed with TTT, venue BEO signed (or not required)'),
  ('OPERATIONAL', 'GRANT_APPROVED', 'POSTPONED', 'VIABILITY_POSTPONED', '{USER}', 'Gate 2: postpone inside the free venue window'),
  ('OPERATIONAL', 'GRANT_APPROVED', 'CANCELLED', 'VIABILITY_CANCELLED', '{USER}', 'Gate 2: cancel and release tentative holds'),
  ('OPERATIONAL', 'OPERATIONS_LOCKED', 'READY_FOR_EVENT', 'T14_VIABILITY_PASSED', '{SYSTEM,USER}', 'T-14 cohort check passed'),
  ('OPERATIONAL', 'OPERATIONS_LOCKED', 'READY_FOR_EVENT', 'VIABILITY_PIVOT_ROT', '{USER}', 'Gate 2: pivot to Remote Online Training, venue released'),
  ('OPERATIONAL', 'OPERATIONS_LOCKED', 'READY_FOR_EVENT', 'VIABILITY_OVERRIDE_PROCEED', '{USER}', 'Gate 2: operator proceeds below minimum cohort'),
  ('OPERATIONAL', 'OPERATIONS_LOCKED', 'POSTPONED', 'VIABILITY_POSTPONED', '{USER}', 'Gate 2: postpone inside the free venue window'),
  ('OPERATIONAL', 'OPERATIONS_LOCKED', 'CANCELLED', 'VIABILITY_CANCELLED', '{USER}', 'Gate 2: cancel and release tentative holds'),
  ('OPERATIONAL', 'POSTPONED', 'GRANT_APPROVED', 'RESCHEDULE_CONFIRMED', '{USER}', 'New dates confirmed; vendors must re-lock'),
  ('OPERATIONAL', 'READY_FOR_EVENT', 'DELIVERY_IN_PROGRESS', 'DELIVERY_STARTED', '{SYSTEM,USER}', 'Day 1 of delivery'),
  ('OPERATIONAL', 'DELIVERY_IN_PROGRESS', 'DELIVERY_COMPLETED', 'DELIVERY_VERIFIED_SUCCESS', '{SYSTEM,USER}', 'Attendance verified, evidence captured'),
  ('OPERATIONAL', 'DRAFT', 'CANCELLED', 'PACKAGE_CANCELLED', '{USER}', 'Cancelled before quotation'),
  ('OPERATIONAL', 'QUOTED', 'CANCELLED', 'PACKAGE_CANCELLED', '{USER}', 'Client declined'),
  ('OPERATIONAL', 'GRANT_PENDING', 'CANCELLED', 'PACKAGE_CANCELLED', '{USER}', 'Grant refused or withdrawn'),
  ('OPERATIONAL', 'GRANT_APPROVED', 'CANCELLED', 'PACKAGE_CANCELLED', '{USER}', 'Cancelled after grant approval'),
  ('OPERATIONAL', 'OPERATIONS_LOCKED', 'CANCELLED', 'PACKAGE_CANCELLED', '{USER}', 'Cancelled after lock'),
  ('OPERATIONAL', 'READY_FOR_EVENT', 'CANCELLED', 'PACKAGE_CANCELLED', '{USER}', 'Cancelled before delivery'),
  ('OPERATIONAL', 'POSTPONED', 'CANCELLED', 'PACKAGE_CANCELLED', '{USER}', 'Postponed package cancelled'),
  ('FINANCIAL', 'ESTIMATE', 'GRANT_RESERVED', 'CLIENT_ACCEPTED_QUOTATION', '{USER,SYSTEM}', 'Quotation accepted; grant value reserved'),
  ('FINANCIAL', 'GRANT_RESERVED', 'UPFRONT_CLAIM_SUBMITTED', 'UPFRONT_CLAIM_FILED', '{USER}', 'Optional 30% upfront grant claim filed'),
  ('FINANCIAL', 'GRANT_RESERVED', 'CLAIM_NOT_READY', 'TRAINING_COMPLETED', '{SYSTEM,USER}', 'Delivery completed; evidence collation begins'),
  ('FINANCIAL', 'UPFRONT_CLAIM_SUBMITTED', 'CLAIM_NOT_READY', 'TRAINING_COMPLETED', '{SYSTEM,USER}', 'Delivery completed; balance claim collation begins'),
  ('FINANCIAL', 'CLAIM_NOT_READY', 'CLAIM_READY', 'CLAIM_EVIDENCE_VERIFIED', '{SYSTEM,USER}', 'T3, JD/14, photos verified and invoice drafted'),
  ('FINANCIAL', 'CLAIM_READY', 'CLAIM_NOT_READY', 'CLAIM_EVIDENCE_REOPENED', '{SYSTEM,USER}', 'A claim document was flagged after verification'),
  ('FINANCIAL', 'CLAIM_READY', 'CLAIM_SUBMITTED', 'CLAIM_PACK_APPROVED', '{USER}', 'Gate 3: operator approved the claim pack for e-TRiS submission'),
  ('FINANCIAL', 'CLAIM_SUBMITTED', 'QUERIED', 'CLAIM_QUERIED_BY_HRDC', '{USER}', 'HRD Corp raised a query'),
  ('FINANCIAL', 'QUERIED', 'CLAIM_SUBMITTED', 'QUERY_RESPONSE_RESUBMITTED', '{USER}', 'Query answered and resubmitted'),
  ('FINANCIAL', 'CLAIM_SUBMITTED', 'APPROVED', 'CLAIM_APPROVED_BY_HRDC', '{USER}', 'HRD Corp approved the claim'),
  ('FINANCIAL', 'APPROVED', 'REMITTED', 'REMITTANCE_RECEIVED', '{USER}', 'Remittance advice received and banked'),
  ('FINANCIAL', 'REMITTED', 'SETTLED_CLOSED', 'AP_DISBURSEMENT_CONFIRMED', '{USER}', 'Gate 3: every payment voucher paid with bank reference and receipt'),
  ('FINANCIAL', 'ESTIMATE', 'VOIDED', 'PACKAGE_CANCELLED', '{USER,SYSTEM}', 'Package cancelled before acceptance'),
  ('FINANCIAL', 'GRANT_RESERVED', 'VOIDED', 'PACKAGE_CANCELLED', '{USER,SYSTEM}', 'Package cancelled; reservation released'),
  ('FINANCIAL', 'UPFRONT_CLAIM_SUBMITTED', 'VOIDED', 'PACKAGE_CANCELLED', '{USER,SYSTEM}', 'Package cancelled; upfront claim must be refunded');

-- R14: an unknown transition, reason or actor is an error, never an else-branch.
create or replace function fsm_check(
  p_machine text, p_from text, p_to text, p_actor text, p_reason text
) returns void
language plpgsql
set search_path = tpms, extensions, public, pg_temp
as $$
declare
  v_allowed text[];
begin
  if p_actor is null or p_reason is null then
    raise exception 'STAGE_CHANGE_WITHOUT_CONTEXT: % % -> % needs tpms.actor_type and tpms.reason_code',
      p_machine, p_from, p_to using errcode = 'P0001';
  end if;
  if p_actor not in ('USER', 'SYSTEM', 'AGENT') then
    raise exception 'UNKNOWN_ACTOR_TYPE: %', p_actor using errcode = 'P0001';
  end if;

  select allowed_actor_types into v_allowed
    from fsm_transitions
   where machine = p_machine and from_stage = p_from and to_stage = p_to and reason_code = p_reason;

  if v_allowed is null then
    if exists (select 1 from fsm_transitions
                where machine = p_machine and from_stage = p_from and to_stage = p_to) then
      raise exception 'TRANSITION_REASON_REJECTED: % % -> % does not accept reason %',
        p_machine, p_from, p_to, p_reason using errcode = 'P0001';
    end if;
    raise exception 'ILLEGAL_TRANSITION: % % -> %', p_machine, p_from, p_to using errcode = 'P0001';
  end if;

  if not (p_actor = any (v_allowed)) then
    raise exception 'TRANSITION_ACTOR_REJECTED: % % -> % (%) requires % but actor is %',
      p_machine, p_from, p_to, p_reason, array_to_string(v_allowed, '/'), p_actor using errcode = 'P0001';
  end if;
end;
$$;

create or replace function packages_before_insert() returns trigger
language plpgsql
set search_path = tpms, extensions, public, pg_temp
as $$
begin
  if new.operational_stage <> 'DRAFT' or new.financial_stage <> 'ESTIMATE' then
    raise exception 'PACKAGE_MUST_START_AT_INITIAL_STAGES: got %/%',
      new.operational_stage, new.financial_stage using errcode = 'P0001';
  end if;
  if new.package_code is null or new.package_code = '' then
    new.package_code := 'PKG-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('package_code_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;
create trigger trg_packages_before_insert before insert on training_packages
  for each row execute function packages_before_insert();

-- Every UPDATE of the aggregate must carry actor + reason context, and every
-- stage change must match a row of fsm_transitions. This is what makes the
-- audit trail non-bypassable: a raw UPDATE without context is refused.
create or replace function packages_before_update() returns trigger
language plpgsql
set search_path = tpms, extensions, public, pg_temp
as $$
declare
  v_actor  text := nullif(current_setting('tpms.actor_type', true), '');
  v_reason text := nullif(current_setting('tpms.reason_code', true), '');
begin
  if v_actor is null or v_reason is null then
    raise exception 'PACKAGE_UPDATE_WITHOUT_CONTEXT: set tpms.actor_type and tpms.reason_code (use the transition service)'
      using errcode = 'P0001';
  end if;
  if new.id <> old.id or new.package_code <> old.package_code then
    raise exception 'PACKAGE_IDENTITY_IMMUTABLE' using errcode = 'P0001';
  end if;
  if new.operational_stage is distinct from old.operational_stage then
    perform fsm_check('OPERATIONAL', old.operational_stage, new.operational_stage, v_actor, v_reason);
  end if;
  if new.financial_stage is distinct from old.financial_stage then
    perform fsm_check('FINANCIAL', old.financial_stage, new.financial_stage, v_actor, v_reason);
  end if;
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end;
$$;
create trigger trg_packages_before_update before update on training_packages
  for each row execute function packages_before_update();

create or replace function packages_refuse_delete() returns trigger
language plpgsql
set search_path = tpms, extensions, public, pg_temp
as $$
begin
  raise exception 'PACKAGE_DELETE_FORBIDDEN: cancel the package instead' using errcode = 'P0001';
end;
$$;
create trigger trg_packages_no_delete before delete on training_packages
  for each row execute function packages_refuse_delete();

create or replace function jsonb_row_diff(p_old jsonb, p_new jsonb, p_ignore text[])
returns jsonb
language sql immutable
set search_path = tpms, extensions, public, pg_temp
as $$
  select coalesce(jsonb_object_agg(n.key, jsonb_build_object('old', o.value, 'new', n.value)), '{}'::jsonb)
    from jsonb_each(p_new) n
    join jsonb_each(p_old) o using (key)
   where n.value is distinct from o.value
     and not (n.key = any (p_ignore));
$$;

create or replace function packages_after_write() returns trigger
language plpgsql
set search_path = tpms, extensions, public, pg_temp
as $$
declare
  v_reason  text := coalesce(nullif(current_setting('tpms.reason_code', true), ''), 'PACKAGE_CREATED');
  v_details text := coalesce(current_setting('tpms.reason_details', true), '');
  v_context jsonb := coalesce(nullif(current_setting('tpms.metadata', true), '')::jsonb, '{}'::jsonb);
  v_diff    jsonb;
begin
  if tg_op = 'INSERT' then
    perform audit_record('TRAINING_PACKAGE', new.id, v_reason, v_details,
      jsonb_build_object('created', jsonb_build_object(
        'package_code', new.package_code, 'title', new.title, 'delivery_mode', new.delivery_mode,
        'client_id', new.client_id, 'start_date', new.start_date, 'end_date', new.end_date))
      || case when v_context = '{}'::jsonb then '{}'::jsonb else jsonb_build_object('context', v_context) end,
      null, null, new.operational_stage);
    return new;
  end if;

  v_diff := jsonb_row_diff(to_jsonb(old), to_jsonb(new), array['updated_at', 'version']);
  if v_context <> '{}'::jsonb then
    v_diff := v_diff || jsonb_build_object('context', v_context);
  end if;

  if new.operational_stage is distinct from old.operational_stage then
    perform audit_record('TRAINING_PACKAGE', new.id, v_reason, v_details, v_diff,
                         'OPERATIONAL', old.operational_stage, new.operational_stage);
    insert into domain_events (event_type, entity_type, entity_id, payload)
    values ('OPS_STAGE_CHANGED', 'TRAINING_PACKAGE', new.id,
            jsonb_build_object('from', old.operational_stage, 'to', new.operational_stage, 'reason', v_reason));
  end if;
  if new.financial_stage is distinct from old.financial_stage then
    perform audit_record('TRAINING_PACKAGE', new.id, v_reason, v_details, v_diff,
                         'FINANCIAL', old.financial_stage, new.financial_stage);
    insert into domain_events (event_type, entity_type, entity_id, payload)
    values ('FIN_STAGE_CHANGED', 'TRAINING_PACKAGE', new.id,
            jsonb_build_object('from', old.financial_stage, 'to', new.financial_stage, 'reason', v_reason));
  end if;
  if new.operational_stage is not distinct from old.operational_stage
     and new.financial_stage is not distinct from old.financial_stage
     and v_diff <> '{}'::jsonb then
    perform audit_record('TRAINING_PACKAGE', new.id, v_reason, v_details, v_diff);
  end if;
  return new;
end;
$$;
create trigger trg_packages_after_write after insert or update on training_packages
  for each row execute function packages_after_write();

-- ---------------------------------------------------------------------------
-- Operational variables: trainer holds and vendor commitments
-- ---------------------------------------------------------------------------
create table trainer_engagements (
  id                 uuid primary key default gen_random_uuid(),
  package_id         uuid not null references training_packages(id) on delete cascade,
  trainer_id         uuid not null references trainers(id),
  status             varchar(32) not null default 'TENTATIVE_HOLD'
                     check (status in ('TENTATIVE_HOLD', 'CONFIRMED', 'RELEASED')),
  day_rate           numeric(10,2) not null check (day_rate >= 0),
  ttt_cert_verified  boolean not null default false,
  hold_expiry_date   date not null,
  pay_when_paid      boolean not null default true,
  released_at        timestamptz,
  release_reason     varchar(64),
  release_penalty    numeric(10,2) not null default 0,
  created_at         timestamptz not null default current_timestamp
);
create unique index uq_active_trainer_per_package on trainer_engagements (package_id)
  where status <> 'RELEASED';

create table vendor_commitments (
  id                    uuid primary key default gen_random_uuid(),
  package_id            uuid not null references training_packages(id) on delete cascade,
  vendor_id             uuid references vendors(id),
  vendor_type           varchar(32) not null check (vendor_type in ('VENUE', 'CATERING', 'PRINTING')),
  status                varchar(32) not null default 'PROVISIONAL'
                        check (status in ('PROVISIONAL', 'BEO_SIGNED', 'DO_RECEIVED', 'CANCELLED')),
  cost                  numeric(10,2) not null check (cost >= 0),
  cancellation_deadline date not null,
  postponement_deadline date,
  reference_number      varchar(64),
  cancellation_penalty  numeric(10,2) not null default 0,
  created_at            timestamptz not null default current_timestamp
);

-- ---------------------------------------------------------------------------
-- Participants and attendance (PII: NRIC encrypted, hashed, masked)
-- ---------------------------------------------------------------------------
create table package_participants (
  id                     uuid primary key default gen_random_uuid(),
  package_id             uuid not null references training_packages(id) on delete cascade,
  full_name              varchar(255) not null,
  nric_passport_hash     varchar(64) not null,
  nric_encrypted         bytea not null,
  nric_masked            varchar(20) not null,
  work_email             varchar(255),
  phone                  varchar(30),
  dietary_preference     varchar(100) not null default 'STANDARD_HALAL',
  registration_status    varchar(20) not null default 'REGISTERED'
                         check (registration_status in ('REGISTERED', 'CONFIRMED', 'WITHDRAWN')),
  attendance_rate        numeric(5,2) not null default 0.00 check (attendance_rate between 0 and 100),
  hrd_claim_eligible     boolean generated always as (attendance_rate >= 80.00) stored,
  kirkpatrick_pre_score  numeric(5,2),
  kirkpatrick_post_score numeric(5,2),
  cert_serial_number     varchar(64) unique,
  cert_issued_at         timestamptz,
  created_at             timestamptz default current_timestamp,
  unique (package_id, nric_passport_hash)
);

create table attendance_records (
  id              uuid primary key default gen_random_uuid(),
  package_id      uuid not null references training_packages(id) on delete cascade,
  participant_id  uuid not null references package_participants(id) on delete cascade,
  day_index       int not null check (day_index >= 1),
  session         varchar(2) not null check (session in ('AM', 'PM')),
  track           varchar(20) not null check (track in ('A_DIGITAL', 'B_OCR', 'MANUAL_OVERRIDE')),
  present         boolean not null,
  signed_at       timestamptz,
  signature_data  text,
  user_agent      text,
  ip_hash         varchar(64),
  ocr_confidence  numeric(4,3),
  source_vault_id uuid,
  needs_review    boolean not null default false,
  review_reason   varchar(100),
  resolved_by     varchar(64),
  resolved_at     timestamptz,
  created_at      timestamptz not null default now(),
  unique (participant_id, day_index, session, track)
);
create index idx_attendance_pkg on attendance_records (package_id, day_index, session);

-- Effective attendance: an operator override beats OCR, OCR beats digital.
create view v_attendance_effective as
select distinct on (participant_id, day_index, session)
       package_id, participant_id, day_index, session, track, present, needs_review
  from attendance_records
 order by participant_id, day_index, session,
          case track when 'MANUAL_OVERRIDE' then 0 when 'B_OCR' then 1 else 2 end;

create table participant_assessments (
  id             uuid primary key default gen_random_uuid(),
  package_id     uuid not null references training_packages(id) on delete cascade,
  participant_id uuid not null references package_participants(id) on delete cascade,
  kind           varchar(4) not null check (kind in ('PRE', 'POST')),
  score          numeric(5,2) not null check (score between 0 and 100),
  answers        jsonb not null default '[]'::jsonb,
  submitted_at   timestamptz not null default now(),
  unique (participant_id, kind)
);

create table quiz_banks (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null unique references course_catalog(id),
  questions  jsonb not null,
  created_at timestamptz not null default now()
);

-- Zero-auth magic links. The JWT carries the jti; the row is what makes a
-- link revocable and single-use per session.
create table magic_link_tokens (
  jti            uuid primary key,
  package_id     uuid not null references training_packages(id) on delete cascade,
  participant_id uuid references package_participants(id) on delete cascade,
  purpose        varchar(20) not null check (purpose in ('CHECKIN', 'QUIZ_PRE', 'QUIZ_POST', 'SESSION_QR')),
  day_index      int,
  session        varchar(2) check (session in ('AM', 'PM')),
  expires_at     timestamptz not null,
  used_at        timestamptz,
  revoked        boolean not null default false,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Compliance evidence vault (content-addressed, immutable once written)
-- ---------------------------------------------------------------------------
create table compliance_vault (
  id                  uuid primary key default gen_random_uuid(),
  package_id          uuid references training_packages(id) on delete cascade,
  trainer_id          uuid references trainers(id),
  participant_id      uuid references package_participants(id),
  document_type       varchar(32) not null check (document_type in (
                        'FORM_HRD_LD', 'QUOTATION', 'ETRIS_DOSSIER', 'ETRIS_APPROVAL', 'TRAINER_CV',
                        'TTT_CERT', 'TRAINER_AGREEMENT', 'FORM_T3', 'FORM_T3_TEMPLATE', 'FORM_JD14',
                        'BEO', 'DO', 'PHOTO_EVIDENCE', 'TAX_INVOICE', 'PV', 'PAYMENT_RECEIPT',
                        'REMITTANCE_ADVICE', 'CERTIFICATE', 'CLAIM_PACK', 'KIRKPATRICK_REPORT',
                        'EXEC_PACK', 'OTHER')),
  file_name           varchar(255) not null,
  mime_type           varchar(100) not null,
  size_bytes          bigint not null check (size_bytes >= 0),
  file_path           text not null,
  file_hash_sha256    varchar(64) not null check (file_hash_sha256 ~ '^[0-9a-f]{64}$'),
  verification_status varchar(32) not null default 'PENDING'
                      check (verification_status in ('PENDING', 'VERIFIED', 'FLAGGED')),
  extracted_metadata  jsonb not null default '{}'::jsonb,
  verification_notes  text,
  verified_by         varchar(64),
  verified_at         timestamptz,
  uploaded_by         varchar(64) not null default 'sys_daemon',
  created_at          timestamptz default current_timestamp
);
create index idx_vault_package on compliance_vault (package_id, document_type);

create or replace function vault_guard() returns trigger
language plpgsql
set search_path = tpms, extensions, public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'VAULT_IMMUTABLE: evidence cannot be deleted' using errcode = 'P0001';
  end if;
  if new.file_hash_sha256 <> old.file_hash_sha256 or new.file_path <> old.file_path
     or new.document_type <> old.document_type
     or new.package_id is distinct from old.package_id then
    raise exception 'VAULT_IMMUTABLE: only verification fields may change' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger trg_vault_guard before update or delete on compliance_vault
  for each row execute function vault_guard();

create or replace function vault_audit() returns trigger
language plpgsql
set search_path = tpms, extensions, public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    perform audit_record('COMPLIANCE_VAULT', new.id, 'VAULT_DOCUMENT_ADDED',
      new.document_type || ' ' || new.file_name,
      jsonb_build_object('package_id', new.package_id, 'document_type', new.document_type,
                         'sha256', new.file_hash_sha256, 'size_bytes', new.size_bytes));
  elsif new.verification_status is distinct from old.verification_status then
    perform audit_record('COMPLIANCE_VAULT', new.id, 'VAULT_DOCUMENT_' || new.verification_status,
      coalesce(new.verification_notes, ''),
      jsonb_build_object('package_id', new.package_id, 'document_type', new.document_type,
                         'from', old.verification_status, 'to', new.verification_status));
  end if;
  return new;
end;
$$;
create trigger trg_vault_audit after insert or update on compliance_vault
  for each row execute function vault_audit();

create table certificates (
  id                      uuid primary key default gen_random_uuid(),
  package_id              uuid not null references training_packages(id),
  participant_id          uuid not null unique references package_participants(id),
  certificate_serial      varchar(100) unique not null,
  document_vault_id       uuid not null references compliance_vault(id),
  payload_sha256          char(64) not null,
  sha256_hash             char(64) not null,
  public_verification_url text not null,
  revoked                 boolean not null default false,
  issued_at               timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Quotations (Gate 1 worktree drafts) and the HITL decision queue
-- ---------------------------------------------------------------------------
create table quotations (
  id                uuid primary key default gen_random_uuid(),
  package_id        uuid not null references training_packages(id) on delete cascade,
  version           int not null,
  status            varchar(24) not null default 'DRAFT'
                    check (status in ('DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'SUPERSEDED', 'REJECTED')),
  inputs            jsonb not null,
  line_items        jsonb not null,
  computed          jsonb not null,
  allowable_cap     numeric(10,2) not null,
  quoted_amount     numeric(10,2) not null,
  total_direct_cost numeric(10,2) not null,
  gross_margin      numeric(10,2) not null,
  margin_pct        numeric(6,2) not null,
  cost_policy_version varchar(32) not null,
  course_outline    jsonb not null default '{}'::jsonb,
  sheet_snapshot    jsonb,
  generated_by      varchar(16) not null check (generated_by in ('AGENT', 'USER', 'SYSTEM')),
  provenance        jsonb not null default '{}'::jsonb,
  approved_by       varchar(64),
  approved_at       timestamptz,
  created_at        timestamptz not null default now(),
  unique (package_id, version),
  constraint quote_within_cap check (quoted_amount <= allowable_cap),
  constraint quote_approval_named check (status <> 'APPROVED' or (approved_by is not null and approved_at is not null))
);

create table decisions (
  id              uuid primary key default gen_random_uuid(),
  gate            varchar(40) not null check (gate in (
                    'GATE1_COMMERCIAL', 'GRANT_VERIFICATION', 'GATE2_VIABILITY',
                    'ATTENDANCE_EXCEPTION', 'GATE3_CLAIM_REVIEW', 'GATE3_AP_DISBURSEMENT',
                    'OUTBOX_BATCH', 'LEAD_TRIAGE', 'RETENTION_PROPOSAL')),
  package_id      uuid references training_packages(id) on delete cascade,
  subject_ref     varchar(100) not null,
  title           varchar(255) not null,
  summary         text not null,
  payload         jsonb not null default '{}'::jsonb,
  options         jsonb not null default '[]'::jsonb,
  status          varchar(20) not null default 'PENDING'
                  check (status in ('PENDING', 'APPROVED', 'REJECTED', 'RESOLVED', 'EXPIRED')),
  chosen_option   varchar(40),
  raised_by       varchar(64) not null,
  raised_by_tier  varchar(4) check (raised_by_tier in ('L0', 'L1', 'L2', 'L3', 'L4')),
  resolved_by     varchar(64),
  resolved_at     timestamptz,
  resolution_note text,
  sla_due_at      timestamptz,
  created_at      timestamptz not null default now(),
  constraint decision_resolution_named check (
    status = 'PENDING' or status = 'EXPIRED' or (resolved_by is not null and resolved_at is not null))
);
create unique index uq_pending_decision on decisions (gate, subject_ref) where status = 'PENDING';
create index idx_decisions_status on decisions (status, created_at);

create or replace function decisions_audit() returns trigger
language plpgsql
set search_path = tpms, extensions, public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    perform audit_record('DECISION', new.id, 'DECISION_RAISED', new.gate || ': ' || new.title,
      jsonb_build_object('gate', new.gate, 'package_id', new.package_id, 'subject_ref', new.subject_ref,
                         'raised_by', new.raised_by, 'tier', new.raised_by_tier));
  elsif new.status is distinct from old.status then
    perform audit_record('DECISION', new.id, 'DECISION_' || new.status, coalesce(new.resolution_note, ''),
      jsonb_build_object('gate', new.gate, 'package_id', new.package_id, 'chosen_option', new.chosen_option,
                         'resolved_by', new.resolved_by));
  end if;
  return new;
end;
$$;
create trigger trg_decisions_audit after insert or update on decisions
  for each row execute function decisions_audit();
