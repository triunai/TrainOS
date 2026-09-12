-- ============================================================================
-- ROLLBACK 006 · catalogue_programmes_and_trainers
-- ============================================================================
--
-- Forward file: migrations/006_catalogue_programmes_and_trainers.sql
--
-- PRIOR STATE THIS RESTORES. After 005 and before 006: `core` holds the shell and the 14 sales tables, and no catalogue. `public.memberships.trainer_id`, `core.organisation_suggestions.programme_id` and `core.tna_recommendations.programme_id` are columns with NO foreign key, which is exactly how 005 and 002 left them.
-- Every object below was created from nothing by 006, so there is no prior
-- definition to reproduce.
--
-- ⚠ READ FIRST: THIS DESTROYS THE CATALOGUE AND EVERY TRAINER COMMITMENT.
--
-- `core.programme_pricing_tiers` carries the ABSOLUTE floor price per tier -
-- a commercial-policy number that is not derivable from cost and not a margin.
-- It exists nowhere else. `core.trainer_bookings` records who is committed to
-- be where; dropping it also drops the exclusion constraint that is the only
-- thing preventing a double booking.
--
-- ⚠ THIS ROLLBACK ALSO REOPENS THREE FOREIGN KEYS IT DID NOT CREATE THE
-- COLUMNS FOR. 006 closed `memberships_trainer_fk`, `os_programme_fk` and
-- `tna_recs_programme_fk` on tables belonging to 002 and 005. Dropping
-- `core.programmes` and `core.trainers` necessarily removes them, which leaves
-- those three columns unconstrained again - the state 002 and 005 left them in,
-- which is correct for this rollback and is stated so nobody reads it as damage.
--
-- BEFORE RUNNING THIS, EXPORT:
--     COPY (SELECT * FROM core.programmes) TO STDOUT WITH CSV HEADER;
--     COPY (SELECT * FROM core.programme_pricing_tiers) TO STDOUT WITH CSV HEADER;
--     COPY (SELECT * FROM core.trainers) TO STDOUT WITH CSV HEADER;
--     COPY (SELECT * FROM core.trainer_bookings) TO STDOUT WITH CSV HEADER;
--     COPY (SELECT * FROM core.trainer_availability) TO STDOUT WITH CSV HEADER;
--
-- ⛔ PRE-FLIGHT GUARDS, none with an override. G0 short-circuits when 006 is
-- already rolled back, so this file is safe to re-run.
--
-- DROP ORDER: children before parents, views before the tables they read,
-- functions last.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $preflight$
DECLARE v_n bigint; v_extra text;
BEGIN
  IF to_regclass('core.programmes') IS NULL THEN
    RAISE NOTICE 'rollback 006: nothing to do - 006 is already rolled back.';
    RETURN;
  END IF;

  -- Any table that references one of 006's tables and is not itself 006's
  -- belongs to a later migration. Named here rather than discovered as a
  -- cascade failure halfway through the drops.
  SELECT string_agg(DISTINCT format('%I.%I', n.nspname, c.relname), ', ') INTO v_extra
  FROM pg_catalog.pg_constraint k
  JOIN pg_catalog.pg_class c     ON c.oid = k.conrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_class pc    ON pc.oid = k.confrelid
  JOIN pg_catalog.pg_namespace pn ON pn.oid = pc.relnamespace
  WHERE k.contype = 'f'
    AND pn.nspname = 'core' AND pc.relname IN ('trainer_bookings', 'trainer_availability', 'programme_trainers', 'trainers', 'programme_materials', 'programme_pricing_tiers', 'programme_modules', 'programmes')
    AND NOT (n.nspname = 'core' AND c.relname IN ('trainer_bookings', 'trainer_availability', 'programme_trainers', 'trainers', 'programme_materials', 'programme_pricing_tiers', 'programme_modules', 'programmes'))
    AND k.conname NOT IN ('memberships_trainer_fk', 'os_programme_fk', 'tna_recs_programme_fk');
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION
      'rollback 006 ABORTED: table(s) outside 006 still reference its tables: %. '
      'Roll those migrations back first.', v_extra
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  SELECT (SELECT count(*) FROM core.trainer_bookings WHERE state = 'CONFIRMED') INTO v_n;
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'rollback 006 ABORTED: core.trainer_bookings holds CONFIRMED bookings. Each is a commitment to a client on a specific date, and the double-booking exclusion constraint that protects them goes with the table (% row(s))', v_n
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  SELECT (SELECT count(*) FROM core.programmes WHERE archived_at IS NULL) INTO v_n;
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'rollback 006 ABORTED: core.programmes holds the live catalogue. Every quotation, proposal and engagement in the product points at one (% row(s))', v_n
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  RAISE NOTICE 'rollback 006 pre-flight: clear.';
END;
$preflight$;

-- Drop the three constraints 006 added to OTHER migrations' tables, explicitly
-- and by name. They would fall to the CASCADE below anyway; naming them means
-- the reverse order is legible and a partial run does not leave one behind.
ALTER TABLE public.memberships            DROP CONSTRAINT IF EXISTS memberships_trainer_fk;
ALTER TABLE core.organisation_suggestions DROP CONSTRAINT IF EXISTS os_programme_fk;
ALTER TABLE core.tna_recommendations      DROP CONSTRAINT IF EXISTS tna_recs_programme_fk;



DROP TABLE IF EXISTS core.trainer_bookings CASCADE;
DROP TABLE IF EXISTS core.trainer_availability CASCADE;
DROP TABLE IF EXISTS core.programme_trainers CASCADE;
DROP TABLE IF EXISTS core.trainers CASCADE;
DROP TABLE IF EXISTS core.programme_materials CASCADE;
DROP TABLE IF EXISTS core.programme_pricing_tiers CASCADE;
DROP TABLE IF EXISTS core.programme_modules CASCADE;
DROP TABLE IF EXISTS core.programmes CASCADE;

DROP FUNCTION IF EXISTS core.sync_trainer_availability();

DO $verify$
DECLARE v_left text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO v_left
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relkind = 'r' AND c.relname IN ('trainer_bookings', 'trainer_availability', 'programme_trainers', 'trainers', 'programme_materials', 'programme_pricing_tiers', 'programme_modules', 'programmes');
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'rollback 006: table(s) survived: %', v_left;
  END IF;

  -- The layers below must be intact. A rollback that quietly took one with it
  -- leaves a state no migration describes.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                 JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'app' AND p.proname = 'finalise_table') THEN
    RAISE EXCEPTION 'rollback 006: 004''s finaliser is gone - the layer below was damaged';
  END IF;

  RAISE NOTICE 'rollback 006: complete - layers below intact.';
END;
$verify$;

COMMIT;
