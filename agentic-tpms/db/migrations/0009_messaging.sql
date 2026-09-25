set local search_path = tpms, extensions, public;

-- 0009_messaging.sql
-- The outbound message log (every email and WhatsApp message the system sends
-- or would have sent) and the outbound suppression list (STOP replies).
--
-- outbound_messages is a record of what left the building, so it is written
-- once and never edited: a later delivery receipt is a new fact, not a rewrite
-- of the send. Attachments are recorded by name, type, size and SHA-256 only —
-- the bytes live in the compliance vault, never in a log table.

create table outbound_messages (
  id                  uuid primary key default gen_random_uuid(),
  channel             varchar(16) not null check (channel in ('EMAIL', 'WHATSAPP')),
  kind                varchar(48) not null check (kind ~ '^[A-Z0-9_]{2,48}$'),
  to_address          varchar(255) not null check (length(trim(to_address)) > 0),
  subject             varchar(255),
  body                text not null,
  attachments         jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  package_id          uuid references training_packages(id),
  lead_id             uuid references lead_records(id),
  status              varchar(16) not null check (status in ('SENT', 'LOGGED', 'FAILED')),
  provider_message_id varchar(255),
  error               text,
  created_at          timestamptz not null default now(),
  -- A failure without a reason is a log line nobody can act on.
  constraint outbound_failed_has_error check (status <> 'FAILED' or error is not null),
  -- SENT means a provider accepted it, which always yields a provider id.
  constraint outbound_sent_has_provider_id check (status <> 'SENT' or provider_message_id is not null)
);
create index idx_outbound_messages_recent on outbound_messages (created_at desc);
create index idx_outbound_messages_package on outbound_messages (package_id, created_at desc)
  where package_id is not null;
create index idx_outbound_messages_lead on outbound_messages (lead_id, created_at desc)
  where lead_id is not null;

create or replace function outbound_messages_refuse_mutation() returns trigger
language plpgsql
set search_path = tpms, extensions, public, pg_temp
as $$
begin
  raise exception 'OUTBOUND_LOG_APPEND_ONLY: outbound_messages rows cannot be %', lower(tg_op)
    using errcode = 'P0001';
end;
$$;

create trigger trg_outbound_messages_append_only
before update or delete on outbound_messages
for each row execute function outbound_messages_refuse_mutation();

-- Addresses that must never receive outbound cold email again. The key is the
-- lower-cased address, so `Alice@X.my` and `alice@x.my` are one suppression.
create table outbound_suppressions (
  email_lower varchar(255) primary key check (email_lower = lower(email_lower) and email_lower like '%@%'),
  reason      varchar(32) not null check (reason in ('STOP_REPLY', 'BOUNCED', 'MANUAL')),
  source      text not null default '',
  created_by  varchar(64) not null,
  created_at  timestamptz not null default now()
);
