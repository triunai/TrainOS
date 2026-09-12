-- ============================================================================
-- ROLLBACK 007 · money_proposals_quotations_portal
-- ============================================================================
--
-- Forward file: migrations/007_money_proposals_quotations_portal.sql
--
-- PRIOR STATE THIS RESTORES. After 006 and before 007: `core` holds the shell, sales and catalogue tables, and no money, proposal, quotation or portal table. `core.follow_ups.proposal_id` is a column with NO foreign key, which is how 005 left it.
-- Every object below was created from nothing by 007, so there is no prior
-- definition to reproduce.
--
-- ⚠ READ FIRST: THIS DESTROYS SIGNED ACCEPTANCES AND EVERY PRICE EVER QUOTED.
--
-- `core.portal_acceptances` is a client accepting a commercial proposal - the
-- signer's name, their role, the timestamp and the signature reference. There is
-- no copy anywhere. `core.proposal_sections` holds the words the client actually
-- read, frozen at send precisely so that record survives. `core.quotations`
-- carries the STAMPED floor margin and commission rate that make a historic
-- price reproducible after its rate card has been retired; the rate card alone
-- cannot reconstruct them.
--
-- `core.provenance` is the answer to "where did this number come from". Dropping
-- it does not delete any AI-authored value - it deletes the ability to explain
-- one.
--
-- BEFORE RUNNING THIS, EXPORT:
--     COPY (SELECT * FROM core.proposals) TO STDOUT WITH CSV HEADER;
--     COPY (SELECT * FROM core.proposal_sections) TO STDOUT WITH CSV HEADER;
--     COPY (SELECT * FROM core.quotations) TO STDOUT WITH CSV HEADER;
--     COPY (SELECT * FROM core.quotation_lines) TO STDOUT WITH CSV HEADER;
--     COPY (SELECT * FROM core.rate_cards) TO STDOUT WITH CSV HEADER;
--     COPY (SELECT * FROM core.portal_acceptances) TO STDOUT WITH CSV HEADER;
--     COPY (SELECT * FROM core.provenance) TO STDOUT WITH CSV HEADER;
--
-- ⛔ PRE-FLIGHT GUARDS, none with an override. G0 short-circuits when 007 is
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
  IF to_regclass('core.provenance_subjects') IS NULL THEN
    RAISE NOTICE 'rollback 007: nothing to do - 007 is already rolled back.';
    RETURN;
  END IF;

  -- Any table that references one of 007's tables and is not itself 007's
  -- belongs to a later migration. Named here rather than discovered as a
  -- cascade failure halfway through the drops.
  SELECT string_agg(DISTINCT format('%I.%I', n.nspname, c.relname), ', ') INTO v_extra
  FROM pg_catalog.pg_constraint k
  JOIN pg_catalog.pg_class c     ON c.oid = k.conrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_class pc    ON pc.oid = k.confrelid
  JOIN pg_catalog.pg_namespace pn ON pn.oid = pc.relnamespace
  WHERE k.contype = 'f'
    AND pn.nspname = 'core' AND pc.relname IN ('quotation_lines', 'quotations', 'portal_acceptances', 'portal_comments', 'public_share_tokens', 'proposal_sections', 'proposals', 'rate_card_discount_authorities', 'rate_card_margin_floors', 'rate_card_commissions', 'rate_card_meals', 'rate_card_travel', 'rate_card_venues', 'rate_card_materials', 'rate_card_trainer_days', 'rate_cards', 'provenance', 'provenance_subjects')
    AND NOT (n.nspname = 'core' AND c.relname IN ('quotation_lines', 'quotations', 'portal_acceptances', 'portal_comments', 'public_share_tokens', 'proposal_sections', 'proposals', 'rate_card_discount_authorities', 'rate_card_margin_floors', 'rate_card_commissions', 'rate_card_meals', 'rate_card_travel', 'rate_card_venues', 'rate_card_materials', 'rate_card_trainer_days', 'rate_cards', 'provenance', 'provenance_subjects'))
    AND k.conname NOT IN ('follow_ups_proposal_fk');
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION
      'rollback 007 ABORTED: table(s) outside 007 still reference its tables: %. '
      'Roll those migrations back first.', v_extra
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  SELECT (SELECT count(*) FROM core.proposals WHERE status IN ('SENT','VIEWED','ACCEPTED')) INTO v_n;
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'rollback 007 ABORTED: core.proposals holds proposals a CLIENT HAS ALREADY SEEN. The section bodies are the only record of what was sent, and they are frozen precisely so that record survives (% row(s))', v_n
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  SELECT (SELECT count(*) FROM core.portal_acceptances) INTO v_n;
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'rollback 007 ABORTED: core.portal_acceptances records a client accepting a commercial proposal, with the signer''s name and the signature. That is the contract; there is no copy (% row(s))', v_n
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  SELECT (SELECT count(*) FROM core.quotations WHERE status = 'APPLIED') INTO v_n;
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'rollback 007 ABORTED: core.quotations holds APPLIED quotations. Each is the priced basis of a proposal that has gone out, and its stamped floor and rate are what make the price reproducible after the rate card is retired (% row(s))', v_n
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  RAISE NOTICE 'rollback 007 pre-flight: clear.';
END;
$preflight$;

-- The constraint 007 added to 005's table, dropped by name so the reverse order
-- is legible. This returns core.follow_ups.proposal_id to the unconstrained
-- state 005 left it in, which is correct and is not damage.
ALTER TABLE core.follow_ups DROP CONSTRAINT IF EXISTS follow_ups_proposal_fk;



DROP TABLE IF EXISTS core.quotation_lines CASCADE;
DROP TABLE IF EXISTS core.quotations CASCADE;
DROP TABLE IF EXISTS core.portal_acceptances CASCADE;
DROP TABLE IF EXISTS core.portal_comments CASCADE;
DROP TABLE IF EXISTS core.public_share_tokens CASCADE;
DROP TABLE IF EXISTS core.proposal_sections CASCADE;
DROP TABLE IF EXISTS core.proposals CASCADE;
DROP TABLE IF EXISTS core.rate_card_discount_authorities CASCADE;
DROP TABLE IF EXISTS core.rate_card_margin_floors CASCADE;
DROP TABLE IF EXISTS core.rate_card_commissions CASCADE;
DROP TABLE IF EXISTS core.rate_card_meals CASCADE;
DROP TABLE IF EXISTS core.rate_card_travel CASCADE;
DROP TABLE IF EXISTS core.rate_card_venues CASCADE;
DROP TABLE IF EXISTS core.rate_card_materials CASCADE;
DROP TABLE IF EXISTS core.rate_card_trainer_days CASCADE;
DROP TABLE IF EXISTS core.rate_cards CASCADE;
DROP TABLE IF EXISTS core.provenance CASCADE;
DROP TABLE IF EXISTS core.provenance_subjects CASCADE;

DROP FUNCTION IF EXISTS core.quotation_recalc();
DROP FUNCTION IF EXISTS core.quotation_assert_reconciled();
DROP FUNCTION IF EXISTS core.quotation_assert_floor();
DROP FUNCTION IF EXISTS core.freeze_applied_quotation();
DROP FUNCTION IF EXISTS core.quotation_block_placeholder();
DROP FUNCTION IF EXISTS core.freeze_sent_proposal_sections();

DROP TYPE IF EXISTS core.rate_card_status;
DROP DOMAIN IF EXISTS core.rate;
DROP DOMAIN IF EXISTS core.currency_code;

DO $verify$
DECLARE v_left text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO v_left
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relkind = 'r' AND c.relname IN ('quotation_lines', 'quotations', 'portal_acceptances', 'portal_comments', 'public_share_tokens', 'proposal_sections', 'proposals', 'rate_card_discount_authorities', 'rate_card_margin_floors', 'rate_card_commissions', 'rate_card_meals', 'rate_card_travel', 'rate_card_venues', 'rate_card_materials', 'rate_card_trainer_days', 'rate_cards', 'provenance', 'provenance_subjects');
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'rollback 007: table(s) survived: %', v_left;
  END IF;

  -- The layers below must be intact. A rollback that quietly took one with it
  -- leaves a state no migration describes.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                 JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'app' AND p.proname = 'finalise_table') THEN
    RAISE EXCEPTION 'rollback 007: 004''s finaliser is gone - the layer below was damaged';
  END IF;

  RAISE NOTICE 'rollback 007: complete - layers below intact.';
END;
$verify$;

COMMIT;
