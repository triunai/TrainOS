-- Rollback for 0007_certificates.sql
set local search_path = tpms, extensions, public;

alter table quiz_banks drop column if exists provenance;

drop trigger if exists trg_assessments_final on participant_assessments;
drop function if exists assessments_refuse_update();
alter table participant_assessments drop constraint if exists assessment_reaction_range;
alter table participant_assessments drop column if exists reaction_rating;

drop trigger if exists trg_certificates_guard on certificates;
drop function if exists certificates_guard();
drop index if exists idx_certificates_package;
alter table certificates drop constraint if exists cert_revocation_named;
alter table certificates drop constraint if exists cert_payload_present;
alter table certificates
  drop column if exists revoked_by,
  drop column if exists revoked_reason,
  drop column if exists revoked_at,
  drop column if exists payload;
