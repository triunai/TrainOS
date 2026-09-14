-- Removes exactly the rows supabase/seeds/hosted_demo_akademi_perdana.sql added
-- to tenant `akademi-perdana`, and nothing else.
--
-- Run:
--   psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/seeds/hosted_demo_wipe.sql
--
-- Seed rows are recognised by their id range (de30da7a-5eed-4xxx-8xxx-…, see the
-- seed's pg_temp.demo_id) inside this tenant. Before deleting anything the wipe
-- refuses if any NON-seed row references a seed row through a foreign key — for
-- example a section someone added to a demo proposal, or an approval decision
-- recorded against a demo approval — because ON DELETE CASCADE would silently
-- take that real row with it. Handle those rows first, then re-run.
--
-- Not reverted, by design: core.ref_sequences. Allocated refs are never reused
-- (004: refs are not gapless), so after a wipe the next enquiry is numbered after
-- the demo ones rather than colliding with anything already shown or shared.

DROP TABLE IF EXISTS pg_temp.demo_wipe_ctx;
CREATE TEMP TABLE demo_wipe_ctx ON COMMIT DROP AS
SELECT tenant.id AS t, 'de30da7a-5eed-4%'::text AS marker
  FROM public.tenants AS tenant
 WHERE tenant.slug = 'akademi-perdana';

DO $guard$
DECLARE
  v_t        uuid;
  v_marker   text;
  fk         record;
  v_join     text;
  v_n        bigint;
  v_blockers text[] := ARRAY[]::text[];
BEGIN
  IF (SELECT count(*) FROM demo_wipe_ctx) <> 1 THEN
    RAISE EXCEPTION 'hosted demo wipe: tenant akademi-perdana not found';
  END IF;
  SELECT t, marker INTO v_t, v_marker FROM demo_wipe_ctx;

  -- Every FK that points at a table the seed writes, from a row the seed did not write.
  FOR fk IN
    SELECT con.conname,
           con.conrelid::regclass  AS child,
           con.confrelid::regclass AS parent,
           con.conkey, con.confkey
      FROM pg_catalog.pg_constraint con
     WHERE con.contype = 'f'
       AND con.confrelid IN (
         'core.templates'::regclass, 'core.programmes'::regclass, 'core.programme_pricing_tiers'::regclass,
         'core.rate_cards'::regclass, 'core.organisations'::regclass, 'core.contacts'::regclass,
         'core.contact_consents'::regclass, 'core.enquiries'::regclass, 'core.enquiry_extraction_fields'::regclass,
         'core.opportunities'::regclass, 'core.tnas'::regclass, 'core.tna_gaps'::regclass,
         'core.tna_constraints'::regclass, 'core.tna_evidence'::regclass, 'core.tna_recommendations'::regclass,
         'core.proposals'::regclass, 'core.proposal_sections'::regclass, 'core.quotations'::regclass,
         'core.quotation_lines'::regclass, 'core.follow_ups'::regclass, 'core.outbound_messages'::regclass,
         'core.action_requests'::regclass, 'core.approval_requests'::regclass)
  LOOP
    SELECT string_agg(format('ch.%I = p.%I', ca.attname, pa.attname), ' AND ')
      INTO v_join
      FROM unnest(fk.conkey, fk.confkey) AS k(c, pcol)
      JOIN pg_catalog.pg_attribute ca ON ca.attrelid = fk.child  AND ca.attnum = k.c
      JOIN pg_catalog.pg_attribute pa ON pa.attrelid = fk.parent AND pa.attnum = k.pcol;

    EXECUTE format(
      'SELECT count(*) FROM %s ch JOIN %s p ON %s
        WHERE p.tenant_id = $1 AND p.id::text LIKE $2 %s',
      fk.child, fk.parent, v_join,
      CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                         WHERE a.attrelid = fk.child AND a.attname = 'id' AND NOT a.attisdropped)
           THEN 'AND ch.id::text NOT LIKE $2' ELSE '' END)
      INTO v_n USING v_t, v_marker;

    IF v_n > 0 THEN
      v_blockers := v_blockers || format('%s -> %s (%s): %s row(s)', fk.child, fk.parent, fk.conname, v_n);
    END IF;
  END LOOP;

  IF cardinality(v_blockers) > 0 THEN
    RAISE EXCEPTION 'hosted demo wipe refused: non-seed rows reference demo rows: %',
      array_to_string(v_blockers, '; ');
  END IF;
END
$guard$;

UPDATE core.action_requests r SET approval_request_id = NULL
  FROM demo_wipe_ctx c
 WHERE r.tenant_id = c.t AND r.id::text LIKE c.marker AND r.approval_request_id IS NOT NULL;

DELETE FROM core.approval_requests x USING demo_wipe_ctx c WHERE x.tenant_id = c.t AND x.id::text LIKE c.marker;
DELETE FROM core.action_requests   x USING demo_wipe_ctx c WHERE x.tenant_id = c.t AND x.id::text LIKE c.marker;

DELETE FROM core.outbound_messages x USING demo_wipe_ctx c WHERE x.tenant_id = c.t AND x.id::text LIKE c.marker;
DELETE FROM core.follow_ups        x USING demo_wipe_ctx c WHERE x.tenant_id = c.t AND x.id::text LIKE c.marker;

DELETE FROM core.quotation_lines   x USING demo_wipe_ctx c WHERE x.tenant_id = c.t AND x.id::text LIKE c.marker;
DELETE FROM core.quotations        x USING demo_wipe_ctx c WHERE x.tenant_id = c.t AND x.id::text LIKE c.marker;
DELETE FROM core.proposal_sections x USING demo_wipe_ctx c WHERE x.tenant_id = c.t AND x.id::text LIKE c.marker;
DELETE FROM core.proposals         x USING demo_wipe_ctx c WHERE x.tenant_id = c.t AND x.id::text LIKE c.marker;

DELETE FROM core.tna_recommendations x USING demo_wipe_ctx c WHERE x.tenant_id = c.t AND x.id::text LIKE c.marker;
DELETE FROM core.tna_evidence        x USING demo_wipe_ctx c WHERE x.tenant_id = c.t AND x.id::text LIKE c.marker;
DELETE FROM core.tna_constraints     x USING demo_wipe_ctx c WHERE x.tenant_id = c.t AND x.id::text LIKE c.marker;
DELETE FROM core.tna_gaps            x USING demo_wipe_ctx c WHERE x.tenant_id = c.t AND x.id::text LIKE c.marker;
DELETE FROM core.tnas                x USING demo_wipe_ctx c WHERE x.tenant_id = c.t AND x.id::text LIKE c.marker;

DELETE FROM core.opportunities             x USING demo_wipe_ctx c WHERE x.tenant_id = c.t AND x.id::text LIKE c.marker;
DELETE FROM core.enquiry_extraction_fields x USING demo_wipe_ctx c WHERE x.tenant_id = c.t AND x.id::text LIKE c.marker;
DELETE FROM core.enquiries                 x USING demo_wipe_ctx c WHERE x.tenant_id = c.t AND x.id::text LIKE c.marker;

DELETE FROM core.contact_consents x USING demo_wipe_ctx c WHERE x.tenant_id = c.t AND x.id::text LIKE c.marker;
DELETE FROM core.contacts         x USING demo_wipe_ctx c WHERE x.tenant_id = c.t AND x.id::text LIKE c.marker;
DELETE FROM core.organisations    x USING demo_wipe_ctx c WHERE x.tenant_id = c.t AND x.id::text LIKE c.marker;

DELETE FROM core.rate_card_discount_authorities x USING demo_wipe_ctx c WHERE x.tenant_id = c.t AND x.id::text LIKE c.marker;
DELETE FROM core.rate_card_margin_floors        x USING demo_wipe_ctx c WHERE x.tenant_id = c.t AND x.id::text LIKE c.marker;
DELETE FROM core.rate_card_travel               x USING demo_wipe_ctx c WHERE x.tenant_id = c.t AND x.id::text LIKE c.marker;
DELETE FROM core.rate_card_venues               x USING demo_wipe_ctx c WHERE x.tenant_id = c.t AND x.id::text LIKE c.marker;
DELETE FROM core.rate_card_materials            x USING demo_wipe_ctx c WHERE x.tenant_id = c.t AND x.id::text LIKE c.marker;
DELETE FROM core.rate_card_trainer_days         x USING demo_wipe_ctx c WHERE x.tenant_id = c.t AND x.id::text LIKE c.marker;
DELETE FROM core.rate_cards                     x USING demo_wipe_ctx c WHERE x.tenant_id = c.t AND x.id::text LIKE c.marker;

DELETE FROM core.programme_pricing_tiers x USING demo_wipe_ctx c WHERE x.tenant_id = c.t AND x.id::text LIKE c.marker;
DELETE FROM core.programmes              x USING demo_wipe_ctx c WHERE x.tenant_id = c.t AND x.id::text LIKE c.marker;
DELETE FROM core.templates               x USING demo_wipe_ctx c WHERE x.tenant_id = c.t AND x.id::text LIKE c.marker;

SET CONSTRAINTS core.trg_quotation_reconciled, core.trg_quotation_floor IMMEDIATE;
SET CONSTRAINTS core.trg_quotation_reconciled, core.trg_quotation_floor DEFERRED;
