-- 0001_foundation.sql
-- Extensions, operators, the append-only SHA-256 hash-chained audit ledger,
-- the domain event log, and the transactional task queue (claimDue leasing).
--
-- Every function pins search_path: an unpinned SECURITY DEFINER function
-- resolves names through whatever the caller set, which is a privilege hole.

-- Everything lives in the `tpms` schema, never `public`. On Supabase the
-- `public` schema is auto-exposed through the Data API (PostgREST) to the anon
-- key; a dedicated schema is not exposed unless someone adds it on purpose.
create schema if not exists tpms;
set local search_path = tpms, extensions, public;

-- Extensions go where the host expects them: Supabase keeps them in the
-- `extensions` schema, a plain Postgres in `public`. Every function below pins
-- `search_path = tpms, extensions, public, pg_temp`, which resolves either way.
do $$
declare
  v_schema text := case when exists (select 1 from pg_namespace where nspname = 'extensions')
                        then 'extensions' else 'public' end;
begin
  if not exists (select 1 from pg_extension where extname = 'pgcrypto') then
    execute format('create extension pgcrypto with schema %I', v_schema);
  end if;
  if not exists (select 1 from pg_extension where extname = 'vector') then
    execute format('create extension vector with schema %I', v_schema);
  end if;
end;
$$;

-- Supabase roles get nothing here; the app connects as its own role.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema tpms from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on schema tpms from authenticated';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Operators (single tenant: the provider's own staff; no tenant column)
-- ---------------------------------------------------------------------------
create table operators (
  id          varchar(64) primary key,
  full_name   varchar(255) not null,
  role        varchar(16) not null check (role in ('MD', 'OPS', 'FINANCE', 'SALES')),
  email       varchar(255),
  created_at  timestamptz not null default now()
);

create or replace function touch_updated_at() returns trigger
language plpgsql
set search_path = tpms, extensions, public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Append-only audit ledger with a SHA-256 hash chain
-- ---------------------------------------------------------------------------
-- Each row's checkpoint = sha256(prev_checkpoint || '|' || canonical(row)).
-- The chain head lives in a single-row table and is taken FOR UPDATE, so two
-- concurrent writers serialise on it instead of forking the chain. Under
-- REPEATABLE READ a concurrent head update raises a serialization failure
-- rather than silently reading a stale head.
create table audit_chain_head (
  id               int primary key check (id = 1),
  last_seq         bigint not null,
  last_checkpoint  varchar(64) not null
);
insert into audit_chain_head (id, last_seq, last_checkpoint)
values (1, 0, repeat('0', 64));

create table audit_ledger (
  log_id            uuid primary key default gen_random_uuid(),
  seq               bigint not null unique,
  entity_type       varchar(64) not null,
  entity_id         uuid not null,
  machine           varchar(32) check (machine in ('OPERATIONAL', 'FINANCIAL')),
  from_stage        varchar(32),
  to_stage          varchar(32),
  actor_type        varchar(32) not null check (actor_type in ('SYSTEM', 'AGENT', 'USER')),
  actor_id          varchar(64) not null,
  reason_code       varchar(64) not null,
  reason_details    text not null default '',
  metadata_diff     jsonb not null default '{}'::jsonb,
  prev_checkpoint   varchar(64) not null,
  sha256_checkpoint varchar(64) not null check (sha256_checkpoint ~ '^[0-9a-f]{64}$'),
  created_at        timestamptz not null
);
create index idx_audit_trace on audit_ledger (entity_type, entity_id, seq);

create or replace function audit_canonical(
  p_log_id uuid, p_seq bigint, p_entity_type text, p_entity_id uuid, p_machine text,
  p_from text, p_to text, p_actor_type text, p_actor_id text, p_reason_code text,
  p_reason_details text, p_metadata jsonb, p_created_at timestamptz
) returns text
language sql immutable
set search_path = tpms, extensions, public, pg_temp
as $$
  select concat_ws('|',
    p_log_id::text, p_seq::text, p_entity_type, p_entity_id::text,
    coalesce(p_machine, ''), coalesce(p_from, ''), coalesce(p_to, ''),
    p_actor_type, p_actor_id, p_reason_code, p_reason_details,
    p_metadata::text,
    to_char(p_created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
$$;

create or replace function audit_chain_before_insert() returns trigger
language plpgsql
set search_path = tpms, extensions, public, pg_temp
as $$
declare
  v_seq  bigint;
  v_prev varchar(64);
begin
  select last_seq, last_checkpoint into v_seq, v_prev
    from audit_chain_head where id = 1 for update;

  new.seq := v_seq + 1;
  new.prev_checkpoint := v_prev;
  new.created_at := clock_timestamp();
  new.metadata_diff := coalesce(new.metadata_diff, '{}'::jsonb);
  new.reason_details := coalesce(new.reason_details, '');
  new.sha256_checkpoint := encode(digest(
    v_prev || '|' || audit_canonical(
      new.log_id, new.seq, new.entity_type, new.entity_id, new.machine,
      new.from_stage, new.to_stage, new.actor_type, new.actor_id, new.reason_code,
      new.reason_details, new.metadata_diff, new.created_at),
    'sha256'), 'hex');

  update audit_chain_head
     set last_seq = new.seq, last_checkpoint = new.sha256_checkpoint
   where id = 1;
  return new;
end;
$$;

create trigger trg_audit_chain
before insert on audit_ledger
for each row execute function audit_chain_before_insert();

create or replace function audit_refuse_mutation() returns trigger
language plpgsql
set search_path = tpms, extensions, public, pg_temp
as $$
begin
  raise exception 'AUDIT_APPEND_ONLY: audit_ledger rows cannot be %', lower(tg_op)
    using errcode = 'P0001';
end;
$$;

create trigger trg_audit_no_update
before update or delete on audit_ledger
for each row execute function audit_refuse_mutation();

create trigger trg_audit_no_truncate
before truncate on audit_ledger
for each statement execute function audit_refuse_mutation();

-- Recomputes the chain from genesis. Returns one row per ledger row; `ok` is
-- false where the stored checkpoint or back-link does not match.
create or replace function audit_verify_chain()
returns table (seq bigint, log_id uuid, ok boolean, expected varchar, stored varchar)
language plpgsql stable
set search_path = tpms, extensions, public, pg_temp
as $$
declare
  r      audit_ledger%rowtype;
  v_prev varchar(64) := repeat('0', 64);
  v_hash varchar(64);
begin
  for r in select * from audit_ledger order by audit_ledger.seq loop
    v_hash := encode(digest(
      v_prev || '|' || audit_canonical(
        r.log_id, r.seq, r.entity_type, r.entity_id, r.machine, r.from_stage,
        r.to_stage, r.actor_type, r.actor_id, r.reason_code, r.reason_details,
        r.metadata_diff, r.created_at),
      'sha256'), 'hex');
    seq := r.seq;
    log_id := r.log_id;
    expected := v_hash;
    stored := r.sha256_checkpoint;
    ok := (v_hash = r.sha256_checkpoint and r.prev_checkpoint = v_prev);
    return next;
    v_prev := r.sha256_checkpoint;
  end loop;
end;
$$;

-- Helper the service layer and triggers share, so every audit row is written
-- one way. Actor context falls back to the transaction-local settings the
-- application sets (tpms.actor_type / tpms.actor_id / tpms.reason_code).
create or replace function audit_record(
  p_entity_type text, p_entity_id uuid, p_reason_code text,
  p_reason_details text default '', p_metadata jsonb default '{}'::jsonb,
  p_machine text default null, p_from text default null, p_to text default null
) returns uuid
language plpgsql
set search_path = tpms, extensions, public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into audit_ledger (entity_type, entity_id, machine, from_stage, to_stage,
                            actor_type, actor_id, reason_code, reason_details, metadata_diff)
  values (p_entity_type, p_entity_id, p_machine, p_from, p_to,
          coalesce(nullif(current_setting('tpms.actor_type', true), ''), 'SYSTEM'),
          coalesce(nullif(current_setting('tpms.actor_id', true), ''), 'sys_daemon'),
          p_reason_code, coalesce(p_reason_details, ''), coalesce(p_metadata, '{}'::jsonb))
  returning log_id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Domain event log (the event bus). NOTIFY fans out to SSE listeners; the
-- durable reaction is always a task_queue row written in the same transaction.
-- ---------------------------------------------------------------------------
create table domain_events (
  id          bigserial primary key,
  event_type  varchar(64) not null,
  entity_type varchar(64) not null,
  entity_id   uuid,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index idx_domain_events_entity on domain_events (entity_type, entity_id);

create or replace function domain_events_notify() returns trigger
language plpgsql
set search_path = tpms, extensions, public, pg_temp
as $$
begin
  perform pg_notify('tpms_events', json_build_object(
    'id', new.id, 'type', new.event_type, 'entityType', new.entity_type,
    'entityId', new.entity_id)::text);
  return new;
end;
$$;

create trigger trg_domain_events_notify
after insert on domain_events
for each row execute function domain_events_notify();

-- ---------------------------------------------------------------------------
-- Transactional task queue — leased with SELECT ... FOR UPDATE SKIP LOCKED
-- ---------------------------------------------------------------------------
create table task_queue (
  id              uuid primary key default gen_random_uuid(),
  task_type       varchar(64) not null,
  payload         jsonb not null,
  status          varchar(32) not null default 'QUEUED'
                  check (status in ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED')),
  priority        int not null default 0,
  locked_until    timestamptz,
  locked_by       varchar(100),
  attempts        int not null default 0,
  max_attempts    int not null default 5 check (max_attempts > 0),
  claim_due       timestamptz not null default current_timestamp,
  idempotency_key varchar(160) unique,
  last_error      text,
  result          jsonb,
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz not null default current_timestamp
);
create index idx_task_claim on task_queue (claim_due, priority desc) where status = 'QUEUED';
create index idx_task_lease on task_queue (locked_until) where status = 'PROCESSING';

-- claimDue: lease up to p_limit due tasks. A PROCESSING task whose lease has
-- expired (a worker died mid-task) is reclaimable, which is what bounds
-- recovery to the lease length (NFR-2: 5 minutes).
create or replace function claim_due(
  p_worker text, p_limit int, p_lease_seconds int, p_task_types text[] default null
) returns setof task_queue
language sql
set search_path = tpms, extensions, public, pg_temp
as $$
  with next as (
    select q.id
      from task_queue q
     where ((q.status = 'QUEUED' and q.claim_due <= now())
         or (q.status = 'PROCESSING' and q.locked_until < now()))
       and (p_task_types is null or q.task_type = any (p_task_types))
     order by q.priority desc, q.claim_due
     for update skip locked
     limit p_limit
  )
  update task_queue t
     set status = 'PROCESSING',
         locked_until = now() + make_interval(secs => p_lease_seconds),
         locked_by = p_worker,
         attempts = t.attempts + 1,
         started_at = now()
    from next
   where t.id = next.id
  returning t.*;
$$;
