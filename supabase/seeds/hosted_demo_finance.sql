-- TrainOS hosted demo data for the Finance domain (026), for the EXISTING
-- tenant `akademi-perdana`. Runs AFTER supabase/seeds/hosted_demo_akademi_perdana.sql
-- — it picks up exactly where that file's own header says it stops ("there are
-- no invoices (NULL -> DRAFT is gated by INVOICE_CREATE)") and walks two of its
-- three DRAFT quotations (`quo:aurora`, `quo:meridian`) through to invoices,
-- payments and one collections case.
--
-- Run (one transaction, stop on the first error; the file refuses to run otherwise):
--   psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/seeds/hosted_demo_akademi_perdana.sql
--   psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/seeds/hosted_demo_finance.sql
--
-- Remove exactly what it added:
--   psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/seeds/hosted_demo_finance_wipe.sql
--
-- Pin (ends in ROLLBACK): supabase/seeds/test_hosted_demo_finance.sql
--
-- ── How gated writes are made, without pretending to be PostgREST ───────────
--
-- `core.perform_action` is the client's ONLY path to a gated write, but it also
-- evaluates policy (FIN-01/02/06), computes value/context and enforces
-- idempotency — none of which a seed script establishing rows in an already-
-- legal state needs, and none of which `hosted_demo_akademi_perdana.sql`
-- invokes either (its own "Pending approvals" section inserts
-- `core.action_requests`/`core.approval_requests` directly, by hand). This file
-- follows the SAME convention one level down: `app.enforce_state_transition`
-- (011:1299) authorizes a gated write by reading the `app.effect_applier` GUC
-- against a real `core.action_requests` row — the exact mechanism
-- `app.apply_effects` (011:1938-2022) uses for a REAL approved action, not a
-- shortcut invented for this file. `pg_temp.demo_act`/`pg_temp.demo_act_done`
-- below do precisely what `apply_effects` does: open the request EXECUTING, set
-- the GUC, let the gated write happen, close it EXECUTED with `completed_at`,
-- clear the GUC. supabase/tests/test_010_finance_invoices_payments_collections.sql's
-- `pg_temp.gate`/`pg_temp.ungate` are the same mechanism, written for a pin that
-- rolls back; this version is written for durable rows.
--
-- Every requester is a real MD (`u1`/`u2`/`u3` from the base seed's
-- `demo_ctx`); no FINANCE-role member exists in this tenant today (the brief:
-- "Four founders are signed in as MD"), so an MD is both the legal requester
-- (`invoice:create`/`invoice:push`/`payment:record`/`quotation:apply`, all held
-- by MD, 002 §11) and, for `INVOICE_CREATE`, `INVOICE_PUSH` and `PAYMENT_RECORD`,
-- the self-authoriser 011's own policies would otherwise escalate to (FIN-01/02
-- have no `FINANCE` role holder to assign to, so `app.pick_role_holder`
-- escalates to `MD` — GOV-03-equivalent territory, not invented here). This
-- file does not re-derive that dispatch; it establishes the same LEGAL end
-- state the dispatch would reach.
--
-- Hosted-safe by construction, matching the base seed's own three rules: takes
-- the tenant by slug and never provisions one; never writes auth.users,
-- memberships or user_profiles; never disables a trigger — every gated column
-- is crossed through the mechanism above, never by turning a trigger off.
--
-- Idempotent: every id is `pg_temp.demo_id(<stable key>)`, THE SAME FUNCTION
-- AND SALT the base seed defines (`'akademi-perdana:hosted-demo:' || key`), so
-- `pg_temp.demo_id('org:aurora')` here resolves to the identical uuid the base
-- seed already wrote — this file references its organisations and quotations
-- by key, not by a copy-pasted uuid. Every INSERT is guarded by NOT EXISTS on
-- that id; a second run writes nothing.
--
-- ── Permanent audit trail ────────────────────────────────────────────────────
--
-- (a) Every `core.action_requests` row `pg_temp.demo_act` opens below has its
-- `ref` set to `seed:hosted-demo:<action_type>:<target_ref-or-target_id>`
-- (never left for `core.assign_ref` to fill), so it is unambiguously
-- identifiable as seed data rather than a real decision, for anyone auditing
-- `core.action_requests` later. `supabase/seeds/hosted_demo_finance_wipe.sql`
-- does NOT delete these rows — they are kept permanently as this domain's
-- seeded audit trail, even after a wipe removes the invoices/quotations/etc.
-- they reference via `target_id` (not a hard FK, so the now-dangling
-- reference is fine; see the wipe file's own comment).
-- (b) Aurora's partial payment (`pg_temp.demo_id('pay:aurora:1')`, below) is
-- likewise permanent: the wipe does not delete `core.payments` rows, so this
-- payment survives a wipe/re-seed cycle exactly like the action_requests
-- audit trail above.

DROP TABLE IF EXISTS pg_temp.demo_ctx;
CREATE OR REPLACE FUNCTION pg_temp.demo_id(p_key text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT ('de30da7a-5eed-4' || substr(h, 1, 3) || '-8' || substr(h, 4, 3) || '-' || substr(h, 7, 12))::uuid
    FROM (SELECT md5('akademi-perdana:hosted-demo:' || p_key) AS h) AS k;
$fn$;

CREATE TEMP TABLE demo_ctx ON COMMIT DROP AS
SELECT tenant.id                                  AS t,
       'd1449fad-b732-4ee2-93c9-37f338e01358'::uuid AS u1,
       'ad615910-2d87-42a4-9855-58f52409ec6d'::uuid AS u2,
       '415dad6e-c53f-4a84-ab50-bf8e9e65223f'::uuid AS u3,
       (SELECT p.display_name FROM public.user_profiles p
         WHERE p.tenant_id = tenant.id AND p.user_id = 'd1449fad-b732-4ee2-93c9-37f338e01358') AS u1n,
       (SELECT p.display_name FROM public.user_profiles p
         WHERE p.tenant_id = tenant.id AND p.user_id = 'ad615910-2d87-42a4-9855-58f52409ec6d') AS u2n,
       (SELECT p.display_name FROM public.user_profiles p
         WHERE p.tenant_id = tenant.id AND p.user_id = '415dad6e-c53f-4a84-ab50-bf8e9e65223f') AS u3n,
       now()                                      AS at
  FROM public.tenants AS tenant
 WHERE tenant.slug = 'akademi-perdana';

DO $pre$
DECLARE v_ctx demo_ctx%ROWTYPE; v_md integer;
BEGIN
  IF (SELECT count(*) FROM demo_ctx) <> 1 THEN
    RAISE EXCEPTION 'hosted finance seed: tenant akademi-perdana not found; this seed never provisions';
  END IF;
  SELECT * INTO v_ctx FROM demo_ctx;
  SELECT count(*) INTO v_md
    FROM public.memberships m
   WHERE m.tenant_id = v_ctx.t AND m.user_id IN (v_ctx.u1, v_ctx.u2, v_ctx.u3)
     AND m.role = 'MD' AND m.actor_kind = 'HUMAN' AND m.status = 'ACTIVE';
  IF v_md <> 3 OR v_ctx.u1n IS NULL OR v_ctx.u2n IS NULL OR v_ctx.u3n IS NULL THEN
    RAISE EXCEPTION 'hosted finance seed: expected all three MD users as ACTIVE members with profiles, found % membership(s)', v_md;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM core.quotations WHERE id = pg_temp.demo_id('quo:aurora'))
     OR NOT EXISTS (SELECT 1 FROM core.quotations WHERE id = pg_temp.demo_id('quo:meridian')) THEN
    RAISE EXCEPTION 'hosted finance seed: run hosted_demo_akademi_perdana.sql first — quo:aurora/quo:meridian not found';
  END IF;
  -- 026's own aging/collection backfill is a one-time migration-apply-time
  -- INSERT (per its header), not a trigger, so it already covers this tenant
  -- (it existed before 026 applied) — asserted, not assumed.
  IF (SELECT count(*) FROM core.aging_buckets WHERE tenant_id = v_ctx.t) <> 4
     OR (SELECT count(*) FROM core.collection_rules WHERE tenant_id = v_ctx.t) <> 5 THEN
    RAISE EXCEPTION 'hosted finance seed: 026''s aging/collection seed is missing for this tenant — apply 026 first';
  END IF;
END
$pre$;

-- ── The gate, for durable rows ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION pg_temp.demo_act(
  p_tenant uuid, p_type text, p_target_ref text, p_target_entity text, p_target_id uuid,
  p_requested_by uuid, p_requested_by_name text, p_value_sen bigint DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql AS $fn$
DECLARE v_id uuid; v_ref text;
BEGIN
  -- `ref` is explicitly set (rather than left NULL for `core.assign_ref`'s
  -- BEFORE INSERT trigger to fill, 004:526-528, which only fills a NULL ref)
  -- so every `action_requests` row this seed writes is unambiguously marked
  -- as seed data, not a real decision, for anyone auditing the table later —
  -- see the header comment above for the full rule. `p_type || ':' ||
  -- p_target_id` keeps each row's ref both distinct (action_requests has a
  -- UNIQUE (tenant_id, ref), 004:346-348: two calls here can share a target
  -- entity — INVOICE_PUSH and PAYMENT_RECORD both target the same invoice —
  -- but never share both type AND target together) AND STABLE across a
  -- wipe/reseed cycle. `p_target_id` is always one of this file's own
  -- `pg_temp.demo_id(<key>)` values, deterministic for a given key; the
  -- caller's OWN `p_target_ref` (an entity's `ref` column, e.g. a
  -- collections_case's) is NOT stable the same way — `core.assign_ref`
  -- (004:512) mints a fresh sequential ref for a row `hosted_demo_finance_
  -- wipe.sql` deletes and this file recreates (e.g. Meridian's collections
  -- case), so keying on target_ref would mint a NEW action_requests row,
  -- not update the old one, on every wipe/reseed cycle — verified against
  -- the shim, this exact drift is why target_id is used here instead.
  v_ref := 'seed:hosted-demo:' || p_type || ':' || p_target_id::text;
  -- ON CONFLICT, not a plain INSERT: the row this marks is permanent (never
  -- deleted by the wipe, see the header above), but the ENTITY it gates a
  -- write for is not always permanent — e.g. `hosted_demo_finance_wipe.sql`
  -- fully removes Meridian's collections case, and a reseed recreates it and
  -- re-walks REMINDER_SEND. Without ON CONFLICT that second `demo_act` call
  -- would collide on this same stable `ref` (a plain INSERT raised
  -- `action_requests_tenant_ref_key`, verified against the shim) instead of
  -- reopening the SAME permanent audit row for the new cycle — `ref`,
  -- `action_type` and `requested_by_id` are frozen by 004's immutability
  -- trigger either way (only `status` and the target/value columns move),
  -- so the row's identity and its `seed:hosted-demo:` marker never change.
  INSERT INTO core.action_requests
    (tenant_id, ref, action_type, target_ref, target_entity, target_id, value_sen, currency,
     requested_by_kind, requested_by_id, requested_by_role, status)
  VALUES
    (p_tenant, v_ref, p_type, p_target_ref, p_target_entity, p_target_id, p_value_sen,
     CASE WHEN p_value_sen IS NOT NULL THEN 'MYR' END,
     'HUMAN', p_requested_by::text, 'MD', 'EXECUTING')
  ON CONFLICT ON CONSTRAINT action_requests_tenant_ref_key DO UPDATE SET
    target_ref = EXCLUDED.target_ref, target_entity = EXCLUDED.target_entity,
    target_id = EXCLUDED.target_id, value_sen = EXCLUDED.value_sen, currency = EXCLUDED.currency,
    status = 'EXECUTING', completed_at = NULL
  RETURNING id INTO v_id;
  PERFORM pg_catalog.set_config('app.effect_applier', v_id::text, true);
  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.demo_act_done(p_id uuid) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE core.action_requests SET status = 'EXECUTED', completed_at = pg_catalog.now() WHERE id = p_id;
  PERFORM pg_catalog.set_config('app.effect_applier', '', true);
END;
$fn$;

-- ── Aurora: current, partly paid ─────────────────────────────────────────────
-- QUOTATION_APPLY has no `core.action_policies` row (011 seeds none for it), so
-- a HUMAN holding `quotation:apply` (MD, 002 §11) dispatches straight to
-- EXECUTING — no approval to walk. Still gated (DRAFT -> APPLIED, 011:1081), so
-- still opened/closed through the mechanism above.
DO $aurora_apply$
DECLARE c demo_ctx%ROWTYPE; v_act uuid; v_ref text;
BEGIN
  SELECT * INTO c FROM demo_ctx;
  IF (SELECT status FROM core.quotations WHERE id = pg_temp.demo_id('quo:aurora')) = 'DRAFT' THEN
    SELECT ref INTO v_ref FROM core.quotations WHERE id = pg_temp.demo_id('quo:aurora');
    v_act := pg_temp.demo_act(c.t, 'QUOTATION_APPLY', v_ref, 'quotations', pg_temp.demo_id('quo:aurora'), c.u1, c.u1n);
    UPDATE core.quotations SET status = 'APPLIED' WHERE id = pg_temp.demo_id('quo:aurora');
    PERFORM pg_temp.demo_act_done(v_act);
  END IF;
END;
$aurora_apply$;

INSERT INTO core.engagements (id, tenant_id, organisation_id, opportunity_id, proposal_id, programme_id,
                              owner_id, pipeline_id, title, value_sen, currency, starts_on, ends_on,
                              created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.demo_id('eng:aurora'), c.t, pg_temp.demo_id('org:aurora'), pg_temp.demo_id('opp:aurora'),
       pg_temp.demo_id('pro:aurora'), pg_temp.demo_id('prg:change'), c.u1, pipeline.id,
       'Leading Through Change · Aurora Manufacturing', 1850000, 'MYR',
       (c.at - interval '10 days')::date, (c.at - interval '9 days')::date,
       c.at - interval '10 days', 'HUMAN', c.u1::text, c.u1n
  FROM demo_ctx c
  JOIN core.pipelines pipeline ON pipeline.tenant_id = c.t AND pipeline.object = 'ENGAGEMENT' AND pipeline.is_default
 WHERE NOT EXISTS (SELECT 1 FROM core.engagements x WHERE x.id = pg_temp.demo_id('eng:aurora'));
-- Delivered in the past ten days; not gated (011 has no `engagements`,`status`
-- row for these ungated edges), so the same walk the base seed's opportunities
-- use — insert-then-UPDATE over the born default.
UPDATE core.engagements SET status = 'CONFIRMED'   WHERE id = pg_temp.demo_id('eng:aurora') AND status = 'PROPOSED';
UPDATE core.engagements SET status = 'SCHEDULED'   WHERE id = pg_temp.demo_id('eng:aurora') AND status = 'CONFIRMED';
UPDATE core.engagements SET status = 'IN_DELIVERY' WHERE id = pg_temp.demo_id('eng:aurora') AND status = 'SCHEDULED';
UPDATE core.engagements SET status = 'DELIVERED'   WHERE id = pg_temp.demo_id('eng:aurora') AND status = 'IN_DELIVERY';

DO $aurora_invoice$
DECLARE c demo_ctx%ROWTYPE; v_act uuid; v_inv uuid := pg_temp.demo_id('inv:aurora');
BEGIN
  SELECT * INTO c FROM demo_ctx;
  IF NOT EXISTS (SELECT 1 FROM core.invoices WHERE id = v_inv) THEN
    v_act := pg_temp.demo_act(c.t, 'INVOICE_CREATE', NULL, 'invoices', v_inv, c.u2, c.u2n);
    INSERT INTO core.invoices (id, tenant_id, organisation_id, engagement_id, status,
                               due_at, sst_rate, sst_reason, created_at, created_by_kind, created_by_id, created_by_name)
    VALUES (v_inv, c.t, pg_temp.demo_id('org:aurora'), pg_temp.demo_id('eng:aurora'), 'DRAFT',
            (c.at + interval '20 days')::date, 0, 'TRAINING_EXEMPT', c.at - interval '5 days', 'HUMAN', c.u2::text, c.u2n);
    PERFORM pg_temp.demo_act_done(v_act);

    INSERT INTO core.invoice_lines (tenant_id, invoice_id, n, description, qty, unit_price_sen)
    VALUES (c.t, v_inv, 1, 'Leading Through Change · 2-day programme, 30 pax', 1, 1850000);

    v_act := pg_temp.demo_act(c.t, 'INVOICE_PUSH', (SELECT ref FROM core.invoices WHERE id = v_inv),
                              'invoices', v_inv, c.u2, c.u2n, 1850000);
    UPDATE core.invoices SET status = 'SENT', issued_at = c.at - interval '5 days',
           sync_state = 'SENT', sync_provider = 'ACCOUNTING', sync_last_attempt_at = c.at - interval '5 days'
     WHERE id = v_inv;
    INSERT INTO core.invoice_sync_entries (tenant_id, invoice_id, at, state, provider_code)
    VALUES (c.t, v_inv, c.at - interval '5 days', 'SENT', 'ACCOUNTING');
    PERFORM pg_temp.demo_act_done(v_act);

    -- A partial payment: SENT -> PARTIALLY_PAID, PAYMENT_RECORD.
    v_act := pg_temp.demo_act(c.t, 'PAYMENT_RECORD', (SELECT ref FROM core.invoices WHERE id = v_inv),
                              'invoices', v_inv, c.u3, c.u3n, 900000);
    INSERT INTO core.payments (id, tenant_id, invoice_id, amount_sen, method, received_at,
                               recorded_by_user_id, created_at, created_by_kind, created_by_id, created_by_name)
    VALUES (pg_temp.demo_id('pay:aurora:1'), c.t, v_inv, 900000, 'BANK_TRANSFER', c.at - interval '2 days',
            c.u3, c.at - interval '2 days', 'HUMAN', c.u3::text, c.u3n);
    PERFORM pg_temp.demo_act_done(v_act);
  END IF;
END;
$aurora_invoice$;

-- ── Meridian: 34 days overdue, in collections at REMINDER_2 ──────────────────

DO $meridian_apply$
DECLARE c demo_ctx%ROWTYPE; v_act uuid; v_ref text;
BEGIN
  SELECT * INTO c FROM demo_ctx;
  IF (SELECT status FROM core.quotations WHERE id = pg_temp.demo_id('quo:meridian')) = 'DRAFT' THEN
    SELECT ref INTO v_ref FROM core.quotations WHERE id = pg_temp.demo_id('quo:meridian');
    v_act := pg_temp.demo_act(c.t, 'QUOTATION_APPLY', v_ref, 'quotations', pg_temp.demo_id('quo:meridian'), c.u1, c.u1n);
    UPDATE core.quotations SET status = 'APPLIED' WHERE id = pg_temp.demo_id('quo:meridian');
    PERFORM pg_temp.demo_act_done(v_act);
  END IF;
END;
$meridian_apply$;

INSERT INTO core.engagements (id, tenant_id, organisation_id, opportunity_id, proposal_id, programme_id,
                              owner_id, pipeline_id, title, value_sen, currency, starts_on, ends_on,
                              created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.demo_id('eng:meridian'), c.t, pg_temp.demo_id('org:meridian'), pg_temp.demo_id('opp:meridian'),
       pg_temp.demo_id('pro:meridian'), pg_temp.demo_id('prg:data'), c.u1, pipeline.id,
       'Data Literacy for Managers · Meridian Logistics', 1920000, 'MYR',
       (c.at - interval '65 days')::date, (c.at - interval '64 days')::date,
       c.at - interval '65 days', 'HUMAN', c.u1::text, c.u1n
  FROM demo_ctx c
  JOIN core.pipelines pipeline ON pipeline.tenant_id = c.t AND pipeline.object = 'ENGAGEMENT' AND pipeline.is_default
 WHERE NOT EXISTS (SELECT 1 FROM core.engagements x WHERE x.id = pg_temp.demo_id('eng:meridian'));
UPDATE core.engagements SET status = 'CONFIRMED'   WHERE id = pg_temp.demo_id('eng:meridian') AND status = 'PROPOSED';
UPDATE core.engagements SET status = 'SCHEDULED'   WHERE id = pg_temp.demo_id('eng:meridian') AND status = 'CONFIRMED';
UPDATE core.engagements SET status = 'IN_DELIVERY' WHERE id = pg_temp.demo_id('eng:meridian') AND status = 'SCHEDULED';
UPDATE core.engagements SET status = 'DELIVERED'   WHERE id = pg_temp.demo_id('eng:meridian') AND status = 'IN_DELIVERY';

DO $meridian_invoice$
DECLARE c demo_ctx%ROWTYPE; v_act uuid; v_inv uuid := pg_temp.demo_id('inv:meridian');
BEGIN
  SELECT * INTO c FROM demo_ctx;
  IF NOT EXISTS (SELECT 1 FROM core.invoices WHERE id = v_inv) THEN
    v_act := pg_temp.demo_act(c.t, 'INVOICE_CREATE', NULL, 'invoices', v_inv, c.u1, c.u1n);
    INSERT INTO core.invoices (id, tenant_id, organisation_id, engagement_id, status,
                               due_at, sst_rate, sst_reason, created_at, created_by_kind, created_by_id, created_by_name)
    VALUES (v_inv, c.t, pg_temp.demo_id('org:meridian'), pg_temp.demo_id('eng:meridian'), 'DRAFT',
            (c.at - interval '34 days')::date, 0, 'TRAINING_EXEMPT', c.at - interval '64 days', 'HUMAN', c.u1::text, c.u1n);
    PERFORM pg_temp.demo_act_done(v_act);

    INSERT INTO core.invoice_lines (tenant_id, invoice_id, n, description, qty, unit_price_sen)
    VALUES (c.t, v_inv, 1, 'Data Literacy for Managers · 2-day programme, 22 pax', 1, 1920000);

    -- `outstanding_sen` is trigger-maintained FROM PAYMENTS (010's own column
    -- comment) — nothing recomputes it when lines are added to an invoice with
    -- none yet. Aurora's payment below does this for that invoice; Meridian
    -- never gets one, so it is set explicitly here to what zero payments means:
    -- the whole total outstanding. `total_sen` is already current — the line
    -- trigger that derives `subtotal_sen` (and, generated from it, `total_sen`)
    -- fired synchronously on the INSERT above.
    UPDATE core.invoices SET outstanding_sen = total_sen WHERE id = v_inv;

    v_act := pg_temp.demo_act(c.t, 'INVOICE_PUSH', (SELECT ref FROM core.invoices WHERE id = v_inv),
                              'invoices', v_inv, c.u1, c.u1n, 1920000);
    UPDATE core.invoices SET status = 'SENT', issued_at = c.at - interval '64 days',
           sync_state = 'SENT', sync_provider = 'ACCOUNTING', sync_last_attempt_at = c.at - interval '64 days'
     WHERE id = v_inv;
    INSERT INTO core.invoice_sync_entries (tenant_id, invoice_id, at, state, provider_code)
    VALUES (c.t, v_inv, c.at - interval '64 days', 'SENT', 'ACCOUNTING');
    PERFORM pg_temp.demo_act_done(v_act);

    -- SENT -> OVERDUE is ungated (011:1108) — a function of the due date, not
    -- an action, which is why this UPDATE runs outside the gate above.
    UPDATE core.invoices SET status = 'OVERDUE' WHERE id = v_inv;
  END IF;
END;
$meridian_invoice$;

-- REMINDER_1 is the ungated birth default (011:1144); REMINDER_1 -> REMINDER_2
-- needs REMINDER_SEND.
INSERT INTO core.collections_cases (id, tenant_id, invoice_id, organisation_id,
                                    next_action_at, next_action_type, next_action_status, autonomy,
                                    created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.demo_id('col:meridian'), c.t, pg_temp.demo_id('inv:meridian'), pg_temp.demo_id('org:meridian'),
       c.at + interval '1 day', 'REMINDER_SEND', 'DRAFT_READY', 'ACT_WITH_APPROVAL',
       c.at - interval '4 days', 'AGENT', 'agent_collections', 'Collections Agent'
  FROM demo_ctx c
 WHERE NOT EXISTS (SELECT 1 FROM core.collections_cases x WHERE x.id = pg_temp.demo_id('col:meridian'));

DO $meridian_reminder$
DECLARE c demo_ctx%ROWTYPE; v_act uuid; v_ref text;
BEGIN
  SELECT * INTO c FROM demo_ctx;
  IF (SELECT stage FROM core.collections_cases WHERE id = pg_temp.demo_id('col:meridian')) = 'REMINDER_1' THEN
    SELECT ref INTO v_ref FROM core.collections_cases WHERE id = pg_temp.demo_id('col:meridian');
    v_act := pg_temp.demo_act(c.t, 'REMINDER_SEND', v_ref, 'collections_cases', pg_temp.demo_id('col:meridian'), c.u2, c.u2n);
    UPDATE core.collections_cases SET stage = 'REMINDER_2', stage_entered_at = c.at - interval '4 days'
     WHERE id = pg_temp.demo_id('col:meridian');
    PERFORM pg_temp.demo_act_done(v_act);
  END IF;
END;
$meridian_reminder$;

-- ── The draft the ladder proposes for Meridian's overdue invoice ─────────────
-- One `core.message_rates` row so `core.get_collection_draft` answers LIVE
-- rather than UNAVAILABLE (contract §16 Q4 / Ruling R11).

INSERT INTO core.message_rates (id, tenant_id, channel, category, rate_exact, effective_from,
                                fetched_at, source, stale_after, created_at, updated_at)
SELECT pg_temp.demo_id('rate:whatsapp:utility'), c.t, 'WHATSAPP', 'UTILITY', 0.056400,
       c.at - interval '1 day', c.at - interval '1 hour', 'BSP_API', c.at + interval '23 hours', c.at, c.at
  FROM demo_ctx c
 WHERE NOT EXISTS (SELECT 1 FROM core.message_rates x WHERE x.id = pg_temp.demo_id('rate:whatsapp:utility'));

INSERT INTO core.outbound_messages (id, tenant_id, purpose, channel, category, contact_id, to_address,
                                    invoice_id, body, status, rate_per_message_sen, rate_per_message_exact,
                                    estimated_cost_sen, currency, message_rate_id,
                                    created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.demo_id('msg:col:meridian'), c.t, 'REMINDER', 'WHATSAPP', 'UTILITY',
       pg_temp.demo_id('con:faridah'), k.phone, pg_temp.demo_id('inv:meridian'),
       'Hi Puan Faridah, our records show invoice for Data Literacy for Managers is still outstanding. Could you let us know when payment is expected?',
       'DRAFT', 6, 0.056400, 6, 'MYR', pg_temp.demo_id('rate:whatsapp:utility'),
       c.at - interval '4 days', 'AGENT', 'agent_collections', 'Collections Agent'
  FROM demo_ctx c
  JOIN core.contacts k ON k.id = pg_temp.demo_id('con:faridah')
 WHERE NOT EXISTS (SELECT 1 FROM core.outbound_messages x WHERE x.id = pg_temp.demo_id('msg:col:meridian'));

-- ── Flush the deferred money checks inside this file, not at COMMIT ─────────

SET CONSTRAINTS core.trg_invoice_reconciled IMMEDIATE;
SET CONSTRAINTS core.trg_invoice_reconciled DEFERRED;

DROP FUNCTION pg_temp.demo_act(uuid, text, text, text, uuid, uuid, text, bigint);
DROP FUNCTION pg_temp.demo_act_done(uuid);
