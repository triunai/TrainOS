-- ============================================================================
-- PIN 007 · money_proposals_quotations_portal
-- ============================================================================
--
-- Run only AFTER 007. Ends in ROLLBACK.
--   psql "$DATABASE_URL" -f supabase/tests/test_007_money_proposals_quotations_portal.sql
--
-- WHAT THIS PIN IS FOR. This is the migration where a mistake becomes an
-- invoice a customer disputes, so the arithmetic is proved with the contract's
-- own worked numbers rather than with round figures that would hide a rounding
-- bug.
--
--   T2  TOTAL-FROM-LINES on the contract's actual costing: trainer RM 4,800 x 2,
--       venue 0, materials RM 40 x 30, travel RM 300 x 2 = RM 11,400 direct cost
--       against an RM 18,500 sell price, margin 0.41. If the header and the
--       lines can disagree, every downstream number is wrong.
--   T3  THE FLOOR IS `ceil`, NOT `round`. A sell price one sen under the floor
--       must breach. With `round` it passes, and "one sen under" is exactly the
--       shape a deliberate underprice takes.
--   T4  Which floor BINDS. The contract's fixture has a programme floor of
--       RM 13,900 and a margin floor of RM 17,538 on the same row — the margin
--       floor is higher, so it binds, and a costing screen that showed
--       RM 13,900 as the limit would be wrong by RM 3,638.
--   T7  THE JSONB NULL-CHECK TRAP, on the exact payload the naive constraint
--       lets past: a jury object with no `mode` key at all.
--   T9  A double-clicked Accept cannot create two acceptances.
--
-- RUNNABILITY NOTES
-- 1. Runs as the migration role; RLS is forced with no policies until 014.
-- 2. The reconciliation trigger is DEFERRABLE INITIALLY DEFERRED, so a
--    deliberate mismatch raises at COMMIT, not at the statement. T5 therefore
--    forces it with SET CONSTRAINTS ... IMMEDIATE inside a savepoint rather
--    than trying to catch it at the end of the whole pin.
-- 3. Fixture ids namespaced `00000007-`.
-- 4. It ends in ROLLBACK.
-- ============================================================================

BEGIN;

SET LOCAL plpgsql.check_asserts = on;

DO $canary$
BEGIN
  BEGIN
    ASSERT false, 'canary';
    RAISE EXCEPTION 'test_007 SETUP FAILURE: check_asserts is OFF.';
  EXCEPTION WHEN assert_failure THEN NULL;
  END;
END;
$canary$;

DO $setup$
BEGIN
  IF to_regclass('core.quotation_lines') IS NULL THEN
    RAISE EXCEPTION 'test_007 SETUP FAILURE: 007 is missing or partial.';
  END IF;
END;
$setup$;

INSERT INTO auth.users (id, email) VALUES
  ('00000007-0000-0000-0000-0000000000a1','t007-amirah@example.invalid');
INSERT INTO public.tenants (id, slug, name) VALUES
  ('00000007-1111-1111-1111-111111111111','t007-alpha','Alpha');
INSERT INTO core.ref_formats (tenant_id, prefix, entity, dated, width) VALUES
  ('00000007-1111-1111-1111-111111111111','ORG','organisations',false,4),
  ('00000007-1111-1111-1111-111111111111','OPP','opportunities',false,4),
  ('00000007-1111-1111-1111-111111111111','TPL','templates',false,4),
  ('00000007-1111-1111-1111-111111111111','PRG','programmes',false,4),
  ('00000007-1111-1111-1111-111111111111','PRO','proposals',true,4),
  ('00000007-1111-1111-1111-111111111111','QUO','quotations',true,4);

INSERT INTO core.organisations (id, tenant_id, name, owner_id)
VALUES ('00000007-aaaa-aaaa-aaaa-aaaaaaaaaaa1','00000007-1111-1111-1111-111111111111',
        'Aurora Manufacturing Sdn Bhd','00000007-0000-0000-0000-0000000000a1');
INSERT INTO core.opportunities (id, tenant_id, organisation_id, owner_id, value_sen)
VALUES ('00000007-0bbb-0bbb-0bbb-0bbbbbbbbbb1','00000007-1111-1111-1111-111111111111',
        '00000007-aaaa-aaaa-aaaa-aaaaaaaaaaa1','00000007-0000-0000-0000-0000000000a1',1850000);
INSERT INTO core.templates (id, tenant_id, template_type, label, status)
VALUES ('00000007-0ccc-0ccc-0ccc-0ccccccccce1','00000007-1111-1111-1111-111111111111',
        'PROPOSAL','Standard proposal','ACTIVE');
INSERT INTO core.programmes (id, tenant_id, name, category, days, list_price_sen,
                             list_price_pax, floor_price_sen, floor_margin_rate, status)
VALUES ('00000007-0ddd-0ddd-0ddd-0ddddddddde1','00000007-1111-1111-1111-111111111111',
        'Leading Through Change','LEADERSHIP',2,1850000,30,1390000,0.3500,'ACTIVE');

INSERT INTO core.rate_cards (id, tenant_id, version, status, effective_from)
VALUES ('00000007-0eee-0eee-0eee-0eeeeeeeeee1','00000007-1111-1111-1111-111111111111',
        'v0-placeholder','PLACEHOLDER','2026-01-01'),
       ('00000007-0eee-0eee-0eee-0eeeeeeeeee2','00000007-1111-1111-1111-111111111111',
        'v1-2026','DRAFT','2026-01-01');

INSERT INTO core.proposals (id, tenant_id, opportunity_id, organisation_id, template_id,
                            programme_id, value_sen, margin_rate)
VALUES ('00000007-0fff-0fff-0fff-0fffffffffe1','00000007-1111-1111-1111-111111111111',
        '00000007-0bbb-0bbb-0bbb-0bbbbbbbbbb1','00000007-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
        '00000007-0ccc-0ccc-0ccc-0ccccccccce1','00000007-0ddd-0ddd-0ddd-0ddddddddde1',
        1850000, 0.4100);

-- === T1 · no floating-point money anywhere in core ==========================
DO $t1$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(format('%s.%s (%s)', c.relname, a.attname, t.typname), ', ') INTO v_bad
  FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_class c     ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_type t      ON t.oid = a.atttypid
  WHERE n.nspname = 'core' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
    AND (a.attname LIKE '%\_sen' OR a.attname LIKE '%\_rate' OR a.attname LIKE '%\_pct')
    AND t.typname IN ('float4','float8');
  ASSERT v_bad IS NULL,
    format('T1 FAIL: floating-point money or rate column(s): %s. float8 cannot '
           'represent 0.1 and a drifting sen is a dispute the database caused.', v_bad);
  RAISE NOTICE 'T1 PASS - every money and rate column is exact.';
END;
$t1$;

-- === T2 · TOTAL-FROM-LINES, on the contract's own costing ===================
DO $t2$
DECLARE v_q uuid; v_sell bigint; v_cost bigint; v_margin numeric;
BEGIN
  INSERT INTO core.quotations (id, tenant_id, proposal_id, rate_card_id, pax,
                               programme_floor_price_sen, floor_margin_rate,
                               commission_rate, commission_payable_on)
  VALUES (gen_random_uuid(),'00000007-1111-1111-1111-111111111111',
          '00000007-0fff-0fff-0fff-0fffffffffe1','00000007-0eee-0eee-0eee-0eeeeeeeeee2',
          30, 1390000, 0.3500, 0.0800, 'COLLECTION')
  RETURNING id INTO v_q;

  -- the contract's four cost lines, then the sell line
  INSERT INTO core.quotation_lines (tenant_id, quotation_id, n, item, detail, basis, qty, unit,
                                    unit_price_sen, is_cost) VALUES
    ('00000007-1111-1111-1111-111111111111', v_q, 1,'TRAINER_FEE','Farah Aziz · TTT certified',
     'PER_DAY', 2,'DAY', 480000, true),
    ('00000007-1111-1111-1111-111111111111', v_q, 2,'VENUE','Client site · Aurora HQ Shah Alam',
     'PER_UNIT', 0, NULL, 0, true),
    ('00000007-1111-1111-1111-111111111111', v_q, 3,'MATERIALS', NULL,
     'PER_PAX', 30,'PAX', 4000, true),
    ('00000007-1111-1111-1111-111111111111', v_q, 4,'TRAVEL', NULL,
     'PER_UNIT', 2,'TRIP', 30000, true),
    ('00000007-1111-1111-1111-111111111111', v_q, 5,'PROGRAMME','Leading Through Change · 2 days',
     'PACKAGE', 1, NULL, 1850000, false);

  SELECT sell_price_sen, direct_cost_sen, margin_rate
    INTO v_sell, v_cost, v_margin
  FROM core.quotations WHERE id = v_q;

  ASSERT v_cost = 1140000,
    format('T2a FAIL: direct cost is %s sen, expected 1140000 (RM 11,400 = 960000 + 0 + 120000 + 60000)', v_cost);
  ASSERT v_sell = 1850000,
    format('T2b FAIL: sell price is %s sen, expected 1850000', v_sell);
  ASSERT round(v_margin, 4) = 0.3838,
    format('T2c FAIL: margin rate is %s; (1850000-1140000)/1850000 = 0.38378...', v_margin);
  RAISE NOTICE 'T2 PASS - RM 11,400 cost and RM 18,500 sell summed from the lines.';
END;
$t2$;

-- === T3 · the margin floor uses ceil, so one sen under still breaches =======
DO $t3$
DECLARE v_floor bigint;
BEGIN
  -- direct cost 1140000, floor margin 0.35 -> 1140000 / 0.65 = 1753846.15...
  -- ceil gives 1753847. round would give 1753846, and a sell of 1753846 would
  -- then pass as compliant while sitting under the true floor.
  SELECT margin_floor_price_sen INTO v_floor FROM core.quotations
  WHERE proposal_id = '00000007-0fff-0fff-0fff-0fffffffffe1';
  ASSERT v_floor = 1753847,
    format('T3a FAIL: margin floor is %s, expected 1753847 (ceil(1140000/0.65)). '
           'If this is 1753846 the floor was ROUNDED, and a price one sen under it '
           'now passes as compliant.', v_floor);
  RAISE NOTICE 'T3 PASS - margin floor is ceil(cost / (1 - floor rate)) = %.', v_floor;
END;
$t3$;

-- === T4 · which floor BINDS, and below_floor follows it ====================
DO $t4$
DECLARE r record;
BEGIN
  SELECT programme_floor_price_sen, margin_floor_price_sen, floor_price_sen,
         binding_floor_basis, below_floor, sell_price_sen
    INTO r
  FROM core.quotations WHERE proposal_id = '00000007-0fff-0fff-0fff-0fffffffffe1';

  ASSERT r.floor_price_sen = greatest(r.programme_floor_price_sen, r.margin_floor_price_sen),
    'T4a FAIL: the binding floor is not the greater of the two';
  ASSERT r.binding_floor_basis = 'MARGIN',
    format('T4b FAIL: basis is %s. The margin floor (%s) exceeds the programme floor '
           '(%s), so MARGIN binds; a screen showing the programme floor as the limit '
           'would be understating it by %s sen.',
           r.binding_floor_basis, r.margin_floor_price_sen, r.programme_floor_price_sen,
           r.margin_floor_price_sen - r.programme_floor_price_sen);
  -- The contract's own fixture is COMPLIANT: RM 18,500 against a binding floor of
  -- RM 17,538.47 is a 0.38 margin over a 0.35 floor. Asserting the other way
  -- round would have pinned a fiction, and did on the first run.
  ASSERT r.below_floor = false,
    format('T4c FAIL: sell %s is ABOVE the binding floor %s, so below_floor must be '
           'false, not %s', r.sell_price_sen, r.floor_price_sen, r.below_floor);
  RAISE NOTICE
    'T4 PASS - programme floor %, margin floor %, binding %, compliant.',
    r.programme_floor_price_sen, r.margin_floor_price_sen, r.binding_floor_basis;
END;
$t4$;

-- === T4b · a genuine breach is refused, and an approval lets it through =====
DO $t4b$
DECLARE v_q uuid;
BEGIN
  INSERT INTO core.quotations (tenant_id, proposal_id, rate_card_id, pax, version,
                               programme_floor_price_sen, floor_margin_rate)
  VALUES ('00000007-1111-1111-1111-111111111111','00000007-0fff-0fff-0fff-0fffffffffe1',
          '00000007-0eee-0eee-0eee-0eeeeeeeeee2', 30, 7, 1390000, 0.3500)
  RETURNING id INTO v_q;

  -- cost RM 11,400, sell RM 12,400 - the contract's own FLOOR_PRICE_BREACH example
  INSERT INTO core.quotation_lines (tenant_id, quotation_id, n, item, basis, qty, unit_price_sen, is_cost)
  VALUES ('00000007-1111-1111-1111-111111111111', v_q, 1,'COST','PER_UNIT',1,1140000,true),
         ('00000007-1111-1111-1111-111111111111', v_q, 2,'SELL','PACKAGE',1,1240000,false);

  BEGIN
    SET CONSTRAINTS core.trg_quotation_floor IMMEDIATE;
    RAISE EXCEPTION
      'T4b FAIL: RM 12,400 against a floor of RM 17,538 was accepted with no '
      'DISCOUNT_APPROVE behind it.';
  EXCEPTION WHEN integrity_constraint_violation THEN NULL;
  END;

  -- with an approval recorded, the same price is permitted
  SET CONSTRAINTS core.trg_quotation_floor DEFERRED;
  UPDATE core.quotations SET discount_approval_id = gen_random_uuid() WHERE id = v_q;
  SET CONSTRAINTS core.trg_quotation_floor IMMEDIATE;
  SET CONSTRAINTS core.trg_quotation_floor DEFERRED;

  ASSERT (SELECT below_floor FROM core.quotations WHERE id = v_q),
    'T4b2 FAIL: the breaching quotation is not flagged below_floor';
  RAISE NOTICE 'T4b PASS - a breach is refused, and an approval is what permits it.';
END;
$t4b$;

-- === T5 · a header that disagrees with its lines cannot commit ==============
DO $t5$
DECLARE v_q uuid;
BEGIN
  SELECT id INTO v_q FROM core.quotations
  WHERE proposal_id = '00000007-0fff-0fff-0fff-0fffffffffe1';

  BEGIN
    -- Bypass the lines entirely and claim a different total.
    UPDATE core.quotations SET sell_price_sen = 9999999 WHERE id = v_q;
    -- Deferred to COMMIT by design, so force it here.
    SET CONSTRAINTS core.trg_quotation_reconciled IMMEDIATE;
    RAISE EXCEPTION
      'T5 FAIL: a quotation header claiming a total its lines do not support was '
      'accepted. Total-from-lines is not enforced.';
  EXCEPTION WHEN integrity_constraint_violation THEN NULL;
  END;
  RAISE NOTICE 'T5 PASS - a header that disagrees with its lines is refused at commit.';
END;
$t5$;

-- === T6 · a package price is one line at qty 1 ==============================
DO $t6$
DECLARE v_q uuid;
BEGIN
  SELECT id INTO v_q FROM core.quotations
  WHERE proposal_id = '00000007-0fff-0fff-0fff-0fffffffffe1';
  BEGIN
    INSERT INTO core.quotation_lines (tenant_id, quotation_id, n, item, basis, qty, unit_price_sen, is_cost)
    VALUES ('00000007-1111-1111-1111-111111111111', v_q, 9,'BAD','PACKAGE', 30, 61667, false);
    RAISE EXCEPTION
      'T6 FAIL: a PACKAGE line was accepted at qty 30. DECISIONS §7: RM 18,500 for '
      '30 pax is ONE line at qty 1, and 30 x 616.67 does not equal 18,500.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'T6 PASS - a package price is one line at qty 1.';
END;
$t6$;

-- === T7 · THE JSONB NULL-CHECK TRAP ========================================
--     A jury object with NO `mode` key. The naive constraint
--       CHECK (jury IS NULL OR jury->>'mode' IN ('GATE','SAMPLE','ESCALATE'))
--     lets this through: ->> yields NULL, NULL IN (...) is NULL, and a CHECK
--     that evaluates to NULL PASSES.
DO $t7$
BEGIN
  BEGIN
    INSERT INTO core.provenance (tenant_id, subject_table, subject_id, origin, jury)
    VALUES ('00000007-1111-1111-1111-111111111111','proposal_sections', gen_random_uuid(),
            'HUMAN', '{"quorum": 2, "of": 3}'::jsonb);
    RAISE EXCEPTION
      'T7a FAIL: a jury object with NO mode key was accepted. The constraint is '
      'written the naive way and every malformed jury payload passes.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- quorum greater than the panel is arithmetically impossible
  BEGIN
    INSERT INTO core.provenance (tenant_id, subject_table, subject_id, origin, jury)
    VALUES ('00000007-1111-1111-1111-111111111111','proposal_sections', gen_random_uuid(),
            'HUMAN', '{"mode":"GATE","quorum": 4, "of": 3}'::jsonb);
    RAISE EXCEPTION 'T7b FAIL: a quorum of 4 out of 3 was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- SAMPLE without a sampleRate has no rate to sample at
  BEGIN
    INSERT INTO core.provenance (tenant_id, subject_table, subject_id, origin, jury)
    VALUES ('00000007-1111-1111-1111-111111111111','proposal_sections', gen_random_uuid(),
            'HUMAN', '{"mode":"SAMPLE","quorum": 2, "of": 3}'::jsonb);
    RAISE EXCEPTION 'T7c FAIL: SAMPLE mode was accepted with no sampleRate';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- a well-formed one must be accepted
  INSERT INTO core.provenance (tenant_id, subject_table, subject_id, origin, model, generated_at, jury)
  VALUES ('00000007-1111-1111-1111-111111111111','proposal_sections', gen_random_uuid(),
          'AI_GENERATED','Claude Sonnet 5', now(),
          '{"mode":"ESCALATE","quorum":2,"of":3,"triggers":{"minConfidence":0.70}}'::jsonb);

  -- and an AI origin with no model cannot be explained to the client
  BEGIN
    INSERT INTO core.provenance (tenant_id, subject_table, subject_id, origin)
    VALUES ('00000007-1111-1111-1111-111111111111','tna_gaps', gen_random_uuid(),'AI_GENERATED');
    RAISE EXCEPTION 'T7d FAIL: an AI_GENERATED provenance row was accepted with no model';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'T7 PASS - malformed jury payloads and unattributed AI rows are refused.';
END;
$t7$;

-- === T8 · a quotation cannot be APPLIED against the placeholder rate card ===
DO $t8$
DECLARE v_q uuid;
BEGIN
  -- drafting against the placeholder is allowed
  INSERT INTO core.quotations (tenant_id, proposal_id, rate_card_id, pax, version,
                               programme_floor_price_sen, floor_margin_rate)
  VALUES ('00000007-1111-1111-1111-111111111111','00000007-0fff-0fff-0fff-0fffffffffe1',
          '00000007-0eee-0eee-0eee-0eeeeeeeeee1', 30, 2, 0, 0)
  RETURNING id INTO v_q;

  BEGIN
    UPDATE core.quotations SET status = 'APPLIED' WHERE id = v_q;
    RAISE EXCEPTION
      'T8 FAIL: a quotation was APPLIED against the placeholder rate card. '
      'DECISIONS §5 holds the costing screen at "v0 - placeholder" so nobody quotes '
      'from an empty card.';
  EXCEPTION WHEN integrity_constraint_violation THEN NULL;
  END;
  RAISE NOTICE 'T8 PASS - drafting on the placeholder is allowed; applying is not.';
END;
$t8$;

-- === T9 · one acceptance per proposal, and the token is never stored ========
DO $t9$
DECLARE v_tok uuid;
BEGIN
  INSERT INTO core.public_share_tokens (id, tenant_id, target_kind, proposal_id, token_hash)
  VALUES (gen_random_uuid(),'00000007-1111-1111-1111-111111111111','PROPOSAL',
          '00000007-0fff-0fff-0fff-0fffffffffe1',
          extensions.digest('the-real-token','sha256'))
  RETURNING id INTO v_tok;

  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'core.public_share_tokens'::regclass
      AND attname IN ('token','token_plain','secret') AND attnum > 0 AND NOT attisdropped),
    'T9a FAIL: public_share_tokens has a column that could hold the raw token';

  INSERT INTO core.portal_acceptances (tenant_id, proposal_id, accepted_by_name,
                                       accepted_by_role, share_token_id)
  VALUES ('00000007-1111-1111-1111-111111111111','00000007-0fff-0fff-0fff-0fffffffffe1',
          'Nurul Hassan','HR Manager', v_tok);

  BEGIN
    INSERT INTO core.portal_acceptances (tenant_id, proposal_id, accepted_by_name)
    VALUES ('00000007-1111-1111-1111-111111111111','00000007-0fff-0fff-0fff-0fffffffffe1',
            'Nurul Hassan');
    RAISE EXCEPTION
      'T9b FAIL: a second acceptance was created for one proposal. A double-clicked '
      'Accept button now produces two binding acceptances.';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- a token must point at exactly one target, of the kind it declares
  BEGIN
    INSERT INTO core.public_share_tokens (tenant_id, target_kind, proposal_id, tna_id, token_hash)
    VALUES ('00000007-1111-1111-1111-111111111111','PROPOSAL',
            '00000007-0fff-0fff-0fff-0fffffffffe1', gen_random_uuid(),
            extensions.digest('two-targets','sha256'));
    RAISE EXCEPTION 'T9c FAIL: a share token was accepted with two targets';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'T9 PASS - one acceptance per proposal; tokens are hashed and single-target.';
END;
$t9$;

-- === T10 · a SENT proposal freezes its sections =============================
DO $t10$
BEGIN
  INSERT INTO core.proposal_sections (tenant_id, proposal_id, n, title, body)
  VALUES ('00000007-1111-1111-1111-111111111111','00000007-0fff-0fff-0fff-0fffffffffe1',
          1,'Understanding your needs','Aurora Manufacturing''s 30 line managers...');

  UPDATE core.proposals SET status = 'SENT', sent_at = now()
   WHERE id = '00000007-0fff-0fff-0fff-0fffffffffe1';

  BEGIN
    UPDATE core.proposal_sections SET body = 'rewritten after sending'
     WHERE proposal_id = '00000007-0fff-0fff-0fff-0fffffffffe1' AND n = 1;
    RAISE EXCEPTION
      'T10 FAIL: a section of a SENT proposal was rewritten. The client has already '
      'seen it; a revision must be a new proposal.';
  EXCEPTION WHEN integrity_constraint_violation THEN NULL;
  END;

  -- and SENT without a timestamp is refused
  BEGIN
    UPDATE core.proposals SET sent_at = NULL
     WHERE id = '00000007-0fff-0fff-0fff-0fffffffffe1';
    RAISE EXCEPTION 'T10b FAIL: a SENT proposal was left with no sent_at';
  EXCEPTION WHEN check_violation OR integrity_constraint_violation THEN NULL;
  END;
  RAISE NOTICE 'T10 PASS - a sent proposal''s sections are frozen.';
END;
$t10$;

-- === T11 · rate-card integrity rules ========================================
DO $t11$
BEGIN
  -- two ACTIVE cards may not overlap in time
  BEGIN
    INSERT INTO core.rate_cards (tenant_id, version, status, effective_from, effective_to)
    VALUES ('00000007-1111-1111-1111-111111111111','v2','ACTIVE','2026-06-01','2026-12-31');
    INSERT INTO core.rate_cards (tenant_id, version, status, effective_from, effective_to)
    VALUES ('00000007-1111-1111-1111-111111111111','v3','ACTIVE','2026-09-01','2027-03-31');
    RAISE EXCEPTION
      'T11a FAIL: two ACTIVE rate cards overlap. "What is the band A day rate on '
      '12 November" now depends on which row is read first.';
  EXCEPTION WHEN exclusion_violation THEN NULL;
  END;

  -- the client's own site cannot be charged for
  BEGIN
    INSERT INTO core.rate_card_venues (tenant_id, rate_card_id, mode, day_rate_sen)
    VALUES ('00000007-1111-1111-1111-111111111111','00000007-0eee-0eee-0eee-0eeeeeeeeee2',
            'CLIENT_SITE', 50000);
    RAISE EXCEPTION 'T11b FAIL: a charge was set for training at the client''s own site';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- meals may not exceed their own ACM ceiling
  BEGIN
    INSERT INTO core.rate_card_meals (tenant_id, rate_card_id, programme_type,
                                      per_pax_sen, acm_ceiling_sen)
    VALUES ('00000007-1111-1111-1111-111111111111','00000007-0eee-0eee-0eee-0eeeeeeeeee2',
            'LEADERSHIP', 2600, 2500);
    RAISE EXCEPTION
      'T11c FAIL: a meal rate above its ACM ceiling was accepted. The claim is '
      'rejected after the training has already been delivered.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'T11 PASS - one active card at a time, client site free, meals within ACM.';
END;
$t11$;

DO $done$
BEGIN
  RAISE NOTICE 'test_007 ALL PASS (T1-T11 incl. T4b, rolled back - nothing durable written)';
END;
$done$;

ROLLBACK;
