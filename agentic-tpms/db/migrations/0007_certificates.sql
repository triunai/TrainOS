-- 0007_certificates.sql
-- Lane D: Kirkpatrick assessments and verifiable certificates.
--
--   certificates            + payload snapshot, revocation fields, and a guard
--                             that makes an issued certificate immutable except
--                             for a one-way revocation
--   participant_assessments + Level 1 reaction rating (POST only); a submitted
--                             score is final
--   quiz_banks              + provenance (template vs model-drafted), for the
--                             report's Method section
--
-- Additive only: no existing column changes type, nothing is dropped.

set local search_path = tpms, extensions, public;

-- ---------------------------------------------------------------------------
-- certificates
-- ---------------------------------------------------------------------------
-- `payload` is the canonical record the certificate attests to (masked NRIC
-- only). Verification re-derives it from the live participant/package rows and
-- re-hashes it; keeping the issued snapshot means a provider rename in the
-- environment cannot turn every historic certificate into a false TAMPERED.
alter table certificates
  add column payload        jsonb,
  add column revoked_at     timestamptz,
  add column revoked_reason text,
  add column revoked_by     varchar(64);

-- NOT VALID: enforced for every new or updated row without re-checking rows
-- written before this migration (there should be none, but a migration must
-- not fail on a database it did not create).
alter table certificates
  add constraint cert_payload_present check (payload is not null) not valid;

alter table certificates
  add constraint cert_revocation_named check (
    (revoked and revoked_at is not null and revoked_by is not null
         and revoked_reason is not null and length(trim(revoked_reason)) >= 3)
    or (not revoked and revoked_at is null and revoked_by is null and revoked_reason is null));

create index idx_certificates_package on certificates (package_id, issued_at);

-- An issued certificate is evidence: its identity and hashes never change, and
-- revocation is one-way. Without this, an UPDATE of payload_sha256 alongside a
-- regenerated PDF would pass every check the verifier runs.
create or replace function certificates_guard() returns trigger
language plpgsql
set search_path = tpms, extensions, public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'CERTIFICATE_IMMUTABLE: certificates cannot be deleted; revoke instead'
      using errcode = 'P0001';
  end if;
  if new.id <> old.id
     or new.package_id <> old.package_id
     or new.participant_id <> old.participant_id
     or new.certificate_serial <> old.certificate_serial
     or new.document_vault_id <> old.document_vault_id
     or new.payload_sha256 <> old.payload_sha256
     or new.sha256_hash <> old.sha256_hash
     or new.public_verification_url <> old.public_verification_url
     or new.issued_at <> old.issued_at
     or new.payload is distinct from old.payload then
    raise exception 'CERTIFICATE_IMMUTABLE: only the revocation fields may change'
      using errcode = 'P0001';
  end if;
  if old.revoked and (not new.revoked
                      or new.revoked_at is distinct from old.revoked_at
                      or new.revoked_reason is distinct from old.revoked_reason
                      or new.revoked_by is distinct from old.revoked_by) then
    raise exception 'CERTIFICATE_REVOCATION_FINAL: % is revoked', old.certificate_serial
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger trg_certificates_guard
before update or delete on certificates
for each row execute function certificates_guard();

-- ---------------------------------------------------------------------------
-- participant_assessments
-- ---------------------------------------------------------------------------
alter table participant_assessments
  add column reaction_rating smallint;

alter table participant_assessments
  add constraint assessment_reaction_range check (
    reaction_rating is null or (reaction_rating between 1 and 5 and kind = 'POST'));

-- A score feeds the Level 2 report inside the claim pack; editing one after
-- the fact is a changed exam result. Deletion stays possible so the
-- package/participant cascades (and a PDPA erasure) still work.
create or replace function assessments_refuse_update() returns trigger
language plpgsql
set search_path = tpms, extensions, public, pg_temp
as $$
begin
  raise exception 'ASSESSMENT_FINAL: a submitted assessment cannot be changed'
    using errcode = 'P0001';
end;
$$;

create trigger trg_assessments_final
before update on participant_assessments
for each row execute function assessments_refuse_update();

-- ---------------------------------------------------------------------------
-- quiz_banks
-- ---------------------------------------------------------------------------
alter table quiz_banks
  add column provenance jsonb not null default '{}'::jsonb;
