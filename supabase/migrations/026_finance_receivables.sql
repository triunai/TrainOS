-- ═══════════════════════════════════════════════════════════════════════════
-- 026 · Finance receivables — the client RPC surface over 010
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 001–021 ARE NOT EDITED. This is new SQL in `core`, on top of 010's tables
-- (invoices, invoice_lines, invoice_sync_entries, payments, aging_buckets,
-- collection_rules, collections_cases) and 011's action envelope, which
-- already implements PAYMENT_RECORD end to end (money_moving, AAL2, FIN-06
-- conditional approval, `app.execute_in_database_action` inserting into
-- `core.payments`). This migration does NOT add a `record_payment` RPC — see
-- "HELD" below.
--
-- ── SCOPE, stated once rather than per function ────────────────────────────
--
-- The lane brief (matrix §b2) asks this migration to "serve every first-load
-- call of Finance screens", not to bring finance lists to feature parity with
-- 018/021's keyset-paginated list engine. `core.list_invoices` and
-- `core.list_commissions` therefore accept `p_filter`/`p_sort`/`p_page` for
-- interface parity with the rest of the app, support a SMALL, explicit set of
-- filter/sort fields, fail closed (VALIDATION_FAILED) on anything else — never
-- silently ignored, which is the 018 defect 021's header names — and return a
-- SINGLE page: `page.next` is always `null`. `core.get_collections_queue` is
-- the same shape for the same reason. A caller with more rows than `page.size`
-- sees only the first page, ordered as documented on each function. This is
-- reported in the PR as a scope decision, not silently shipped.
--
-- ── HELD: recordPayment ─────────────────────────────────────────────────────
--
-- `PaymentRecordRequest`/`Invoice` and the checked-in hook
-- `apps/web/src/features/finance/api.ts` call a dedicated resource write
-- (`api.recordPayment`), not `api.performAction`, and the hook's own comment
-- says recording a payment is "not policy-gated ... goes straight to the
-- resource". But 011 already defines `PAYMENT_RECORD` as `money_moving = true`
-- (011:905), AAL2-gated for HUMAN/CLIENT (011:2364), with policy FIN-06
-- (011:987) queuing `QUEUED_FOR_APPROVAL` whenever the recorded amount does not
-- exactly match the invoice's outstanding balance (write-off or overpayment).
-- A new `core.record_payment` RPC must not weaken either, which means it must
-- call `app.perform_action('PAYMENT_RECORD', …)` rather than INSERT into
-- `core.payments` directly — and it is not settled anywhere in the contract,
-- the fixtures, or `docs/` what such an RPC should hand back to the client on
-- the QUEUED_FOR_APPROVAL branch, when the client's own type says the endpoint
-- always returns `Invoice`. Escalated to main (NEEDS OPUS) with the full
-- evidence trail; this migration ships the six read paths and holds the write.
--
-- ── TWO GAPS THIS MIGRATION CLOSES, evidenced by grep rather than assumed ──
--
--  1. `core.aging_buckets` and `core.collection_rules` are CONFIGURATION
--     (doc 04 §7), and 010's own header says both are "seeded per tenant in
--     016" (010:1017-1020, 010:1087-1088). No migration through 021 ever
--     inserts a row into either table — `grep -n "aging_buckets\|
--     collection_rules" supabase/migrations/*.sql` outside 010/018/020/021's
--     own definitions/reads returns nothing. So `core.receivables_aging()`
--     and `core.collection_stage_for()` resolve to nothing for every existing
--     tenant today, and `core.v_collection_rules` (020, already granted to
--     `authenticated`) has always returned an empty list. §1 below seeds the
--     7/30/45/60/75 ladder (doc 04 §7, `CollectionRule` comment 010:1076) for
--     every tenant that exists today, `ON CONFLICT DO NOTHING`.
--  2. `core.outbound_messages.invoice_id` carries the comment "FK added by
--     010" (008:550) and `om_invoice_idx` (008:595) already indexes it, but
--     `grep -n outbound_messages supabase/migrations/010*.sql` finds nothing —
--     the FK was never added. §2 adds it (additive, on a column and index
--     that already exist; touches no 001-021 file).
--
-- Both are reported in the PR body as confirmed gaps this migration closes,
-- not as new product behaviour.
--
-- ── ALSO OBSERVED, NOT ACTED ON ─────────────────────────────────────────────
--
-- `core.quotations.invoice_id` carries the same "FK added by 010" comment
-- (007:625) and is equally never written by any 001-021 code path — 011's
-- `INVOICE_CREATE` apply (011:1862) inserts `core.invoices` and never touches
-- `core.quotations.invoice_id`. `core.list_commissions` (§5) therefore links
-- an invoice to a deal through `core.invoices.engagement_id` (which
-- `INVOICE_CREATE`'s payload DOES set, 011:1863) rather than through
-- `quotations.invoice_id`. Quotations is 007/023's file, not touched here;
-- reported for the orchestrator's awareness.
--
-- ── PATTERNS COPIED FROM 018/020/021, unchanged ─────────────────────────────
--
-- SECURITY DEFINER, `SET search_path = ''`, `SET statement_timeout = '10s'`,
-- `app.require_tenant_id()`, `app.has_permission(...)` as the FIRST statement
-- of every read (021's rule), `app.ok`/`app.err` envelopes, `app._money`,
-- `app._actor`, `app._provenance`, REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE
-- TO authenticated only. No new permission: `invoice:read`, `receivable:read`,
-- `collection:read`, `quotation:read` are all already seeded for FINANCE, MD
-- and ADMIN (002 §11) and cover every read in this file.
--
-- ── THE 7-POINT RPC CONTRACT CHECK, WORKED ─────────────────────────────────
--
--  1 ENVELOPE. Every return is `app.ok`/`app.err`. No new top-level key.
--  2 UNWRAP. `data` only, or a flat object — same rule as everywhere else.
--  3 RpcMap. New functions, one definition each ($verify$ V1); no existing
--    signature is touched.
--  4 CALL SITES. `apps/web/src/features/finance/api.ts` (useInvoice,
--    useInvoices, useCollectionsQueue, useReceivablesAging,
--    useCollectionDraft) and `apps/web/src/features/finance/reporting.api.ts`
--    (commissions). Web adapters land in the same PR (client.ts, rpcClient.ts,
--    apiClient.ts).
--  5 CASTS. `FixtureCommission` has no contract type (matrix §b2, noted at the
--    fixture's own definition, packages/fixtures/src/data/commissions.ts:68);
--    imported from `@trainos/fixtures` rather than invented client-side.
--  6 RELOAD. All reads.
--  7 PUBLIC ROUTES. Nothing granted to anon.
--
-- ── DEPLOY ORDER ─────────────────────────────────────────────────────────
--
-- Depends only on 001-021. Additive: no existing function, view or grant is
-- touched. Apply before `hosted_demo_finance.sql`.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL client_min_messages = warning;

-- ═══ 1 · The collections ladder and aging buckets, per existing tenant ═════

INSERT INTO core.aging_buckets (tenant_id, code, label, days, sort)
SELECT t.id, b.code, b.label, b.days, b.sort
  FROM public.tenants AS t
  CROSS JOIN (VALUES
    ('current',  'Current',    int4range(NULL, 1),  1::smallint),
    ('d1_30',    '1-30 days',  int4range(1, 31),     2::smallint),
    ('d31_60',   '31-60 days', int4range(31, 61),    3::smallint),
    ('d60_plus', '60+ days',   int4range(61, NULL),  4::smallint)
  ) AS b(code, label, days, sort)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- Doc 04 §7 / `CollectionRule` (010:1076): 7 / 30 / 45 days, a human call at
-- 60, a trading hold at 75 with MD approval. PHONE carries no template
-- (Ruling R15, contract hrdc-finance.ts `ReminderSendPayload` header) and is
-- reused for TRADING_HOLD, which is an account action rather than a message
-- and still needs a non-null channel column.
INSERT INTO core.collection_rules
  (tenant_id, stage, trigger_days_overdue, channel, requires_role, autonomy)
SELECT t.id, r.stage, r.trigger_days_overdue, r.channel, r.requires_role, r.autonomy
  FROM public.tenants AS t
  CROSS JOIN (VALUES
    ('REMINDER_1'::core.collection_stage,   7,  'WHATSAPP'::core.enquiry_channel,
     NULL::app.app_role,      'ACT_WITH_APPROVAL'::core.autonomy_level),
    ('REMINDER_2'::core.collection_stage,   30, 'EMAIL'::core.enquiry_channel,
     NULL::app.app_role,      'ACT_WITH_APPROVAL'::core.autonomy_level),
    ('REMINDER_3'::core.collection_stage,   45, 'EMAIL'::core.enquiry_channel,
     'MD'::app.app_role,      'ACT_WITH_APPROVAL'::core.autonomy_level),
    ('HUMAN_CALL'::core.collection_stage,   60, 'PHONE'::core.enquiry_channel,
     'FINANCE'::app.app_role, 'SUGGEST'::core.autonomy_level),
    ('TRADING_HOLD'::core.collection_stage, 75, 'PHONE'::core.enquiry_channel,
     'MD'::app.app_role,      'SUGGEST'::core.autonomy_level)
  ) AS r(stage, trigger_days_overdue, channel, requires_role, autonomy)
ON CONFLICT (tenant_id, stage) DO NOTHING;

-- ═══ 2 · The FK 008 documented and 010 never added ═════════════════════════

DO $$ BEGIN
  ALTER TABLE core.outbound_messages
    ADD CONSTRAINT om_invoice_fk FOREIGN KEY (tenant_id, invoice_id)
    REFERENCES core.invoices (tenant_id, id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ═══ 3 · Internal helper — aging, shaped for the wire ══════════════════════
--
-- `app` because it is a helper for definer functions in `core`, not a client
-- entry point (018 §1 convention). NOT granted to authenticated or anon.
--
-- `dsoDays` is NOT the DSO 010's own comment says needs a window agreed with
-- Finance before it means anything (010:1057). It is a plain,
-- outstanding-weighted average age of open receivables — `sum(outstanding ×
-- daysOverdue) / sum(outstanding)`, zero when nothing is outstanding — which
-- is an honest number rather than an invented "DSO". Reported in the PR as a
-- decision to confirm, the same posture 021 took on `get_rate_card`'s
-- permission (021 header, "fail closed; reported in the PR as a decision to
-- confirm").

CREATE OR REPLACE FUNCTION app._receivables_aging_json(p_tenant uuid, p_as_of date DEFAULT current_date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $fn$
DECLARE
  v_buckets     jsonb := '{}'::jsonb;
  v_row         record;
  v_weighted    numeric := 0;
  v_outstanding numeric := 0;
  v_dso         integer := 0;
BEGIN
  FOR v_row IN SELECT * FROM core.receivables_aging(p_tenant, p_as_of) LOOP
    v_buckets := v_buckets
      || pg_catalog.jsonb_build_object(v_row.code, app._money(v_row.outstanding_sen, 'MYR'));
  END LOOP;

  SELECT COALESCE(pg_catalog.sum(i.outstanding_sen * GREATEST(0, p_as_of - i.due_at)), 0),
         COALESCE(pg_catalog.sum(i.outstanding_sen), 0)
    INTO v_weighted, v_outstanding
    FROM core.invoices AS i
   WHERE i.tenant_id = p_tenant AND i.outstanding_sen > 0
     AND i.status IN ('SENT', 'PARTIALLY_PAID', 'OVERDUE') AND i.due_at IS NOT NULL;

  IF v_outstanding > 0 THEN
    v_dso := pg_catalog.round(v_weighted / v_outstanding);
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'current',   COALESCE(v_buckets -> 'current',   app._money(0, 'MYR')),
    'd1_30',     COALESCE(v_buckets -> 'd1_30',     app._money(0, 'MYR')),
    'd31_60',    COALESCE(v_buckets -> 'd31_60',    app._money(0, 'MYR')),
    'd60_plus',  COALESCE(v_buckets -> 'd60_plus',  app._money(0, 'MYR')),
    'dsoDays',   v_dso);
END;
$fn$;

REVOKE ALL ON FUNCTION app._receivables_aging_json(uuid, date) FROM PUBLIC, anon, authenticated;

-- ═══ 4 · Invoices — M13-S02 ═════════════════════════════════════════════════
--
-- One row projection, reused by `list_invoices` and `get_invoice` so the two
-- can never disagree on what an Invoice looks like.

CREATE OR REPLACE FUNCTION app._invoice_json(p_tenant uuid, p_invoice core.invoices)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $fn$
DECLARE
  v_org_ref  text;
  v_eng_ref  text;
  v_lines    jsonb;
  v_synclog  jsonb;
  v_payments jsonb;
BEGIN
  SELECT org.ref INTO v_org_ref FROM core.organisations AS org
   WHERE org.tenant_id = p_tenant AND org.id = p_invoice.organisation_id;
  SELECT eng.ref INTO v_eng_ref FROM core.engagements AS eng
   WHERE eng.tenant_id = p_tenant AND eng.id = p_invoice.engagement_id;

  SELECT COALESCE(pg_catalog.jsonb_agg(item.row ORDER BY item.n), '[]'::jsonb) INTO v_lines
    FROM (
      SELECT line.n,
             pg_catalog.jsonb_build_object(
               'description', line.description,
               'qty',         line.qty,
               'unit',        app._money(line.unit_price_sen, line.currency::text),
               'amount',      app._money(line.amount_sen, line.currency::text))
             || CASE WHEN line.detail IS NULL THEN '{}'::jsonb
                     ELSE pg_catalog.jsonb_build_object('detail', line.detail) END AS row
        FROM core.invoice_lines AS line
       WHERE line.tenant_id = p_tenant AND line.invoice_id = p_invoice.id
    ) AS item;

  SELECT COALESCE(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object('at', entry.at, 'state', entry.state::text)
           || CASE WHEN entry.detail IS NULL THEN '{}'::jsonb
                   ELSE pg_catalog.jsonb_build_object('detail', entry.detail) END
           || CASE WHEN entry.provider_code IS NULL THEN '{}'::jsonb
                   ELSE pg_catalog.jsonb_build_object('providerCode', entry.provider_code) END
           || CASE WHEN entry.resolution IS NULL THEN '{}'::jsonb
                   ELSE pg_catalog.jsonb_build_object('resolution', entry.resolution) END
           ORDER BY entry.at), '[]'::jsonb) INTO v_synclog
    FROM core.invoice_sync_entries AS entry
   WHERE entry.tenant_id = p_tenant AND entry.invoice_id = p_invoice.id;

  -- Reversal rows stay off the wire: `Payment` has no field for one (contract
  -- hrdc-finance.ts), and `outstanding`/`status` already carry their net
  -- effect (010's `core.payment_apply`). Listing them would double-count what
  -- the header already reports.
  SELECT COALESCE(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'id', pay.id::text, 'at', pay.received_at,
             'amount', app._money(pay.amount_sen, pay.currency::text))
           || CASE WHEN pay.method IS NULL THEN '{}'::jsonb
                   ELSE pg_catalog.jsonb_build_object('method', pay.method) END
           || CASE WHEN pay.external_reference IS NULL THEN '{}'::jsonb
                   ELSE pg_catalog.jsonb_build_object('reference', pay.external_reference) END
           ORDER BY pay.received_at), '[]'::jsonb) INTO v_payments
    FROM core.payments AS pay
   WHERE pay.tenant_id = p_tenant AND pay.invoice_id = p_invoice.id AND NOT pay.is_reversal;

  RETURN pg_catalog.jsonb_build_object(
    'id',            p_invoice.id::text,
    'ref',           p_invoice.ref,
    'createdAt',     p_invoice.created_at,
    'updatedAt',     p_invoice.updated_at,
    'createdBy',     app._actor(p_invoice.created_by_kind::text, p_invoice.created_by_id,
                                 p_invoice.created_by_name),
    'organisationRef', v_org_ref,
    -- ⚠ `engagementRef` is non-optional in the contract (`Invoice.engagementRef:
    -- Ref`) but `core.invoices.engagement_id` is nullable (010). Every seeded
    -- invoice carries one; a future write path that creates an invoice with no
    -- engagement would violate the contract's own promise. Reported as "could
    -- not verify" rather than papered over with an invented ref.
    'engagementRef', v_eng_ref,
    'status',        p_invoice.status::text,
    'issuedAt',      p_invoice.issued_at,
    'dueAt',         p_invoice.due_at,
    'termsDays',     p_invoice.terms_days,
    'lines',         v_lines,
    'subtotal',      app._money(p_invoice.subtotal_sen, p_invoice.currency::text),
    'sst',           app._money(p_invoice.sst_sen, p_invoice.currency::text),
    'sstReason',     p_invoice.sst_reason,
    'total',         app._money(p_invoice.total_sen, p_invoice.currency::text),
    'outstanding',   app._money(p_invoice.outstanding_sen, p_invoice.currency::text),
    'sync', pg_catalog.jsonb_build_object(
      'state',        p_invoice.sync_state::text,
      -- TrainOS pushes to exactly one accounting package (010 header, "does
      -- NOT e-invoice"); the column is null until the first push attempt.
      'provider',     COALESCE(p_invoice.sync_provider, 'ACCOUNTING'),
      'uin',          p_invoice.sync_uin,
      'lastAttemptAt', p_invoice.sync_last_attempt_at),
    'syncLog',       v_synclog,
    'payments',      v_payments);
END;
$fn$;

REVOKE ALL ON FUNCTION app._invoice_json(uuid, core.invoices) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION core.list_invoices(
  p_filter jsonb DEFAULT '[]'::jsonb,
  p_sort   text  DEFAULT NULL,
  p_page   jsonb DEFAULT '{"size":50}'::jsonb,
  p_view   text  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant  uuid := app.require_tenant_id();
  v_size    integer;
  v_status  text;
  v_clause  jsonb;
  v_desc    boolean := true;
  v_sort    text := 'createdAt';
  v_rows    jsonb;
  v_total   integer;
  v_row     core.invoices%ROWTYPE;
BEGIN
  -- AUTHZ FIRST (021's rule): decided before any read or validation, so the
  -- refusal is identical for every argument.
  IF NOT app.has_permission('invoice:read') THEN
    RETURN app.err('FORBIDDEN', pg_catalog.jsonb_build_object('requiredPermission', 'invoice:read'));
  END IF;

  -- `core.saved_view_object` (003) has exactly LEAD, ENQUIRY, APPROVAL — no
  -- INVOICE value — so a `p_view` here can never resolve. Refused explicitly
  -- rather than silently dropped (018 §1's "an ignored VIEW is an ignored
  -- filter" defect, which 021 exists to fix).
  IF NULLIF(p_view, '') IS NOT NULL THEN
    RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
      'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field', 'view', 'reason', 'UNSUPPORTED_VIEW_OBJECT'))));
  END IF;

  BEGIN
    v_size := app._page_size(p_page);
  EXCEPTION WHEN invalid_parameter_value THEN
    RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
      'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field', 'page.size', 'reason', SQLERRM))));
  END;

  FOR v_clause IN SELECT value FROM pg_catalog.jsonb_array_elements(COALESCE(p_filter, '[]'::jsonb))
  LOOP
    IF v_clause ->> 'field' = 'status' AND v_clause ->> 'op' = 'eq' THEN
      v_status := v_clause -> 'value' #>> '{}';
    ELSE
      RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
        'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'field', COALESCE(v_clause ->> 'field', '(null)'), 'reason', 'UNKNOWN_FILTER_FIELD'))));
    END IF;
  END LOOP;

  IF NULLIF(p_sort, '') IS NOT NULL THEN
    v_desc := pg_catalog.left(p_sort, 1) = '-';
    v_sort := CASE WHEN v_desc THEN pg_catalog.substr(p_sort, 2) ELSE p_sort END;
    IF v_sort <> 'createdAt' THEN
      RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
        'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'field', 'sort', 'reason', 'UNKNOWN_SORT_FIELD'))));
    END IF;
  END IF;

  SELECT pg_catalog.count(*) INTO v_total FROM core.invoices AS i
   WHERE i.tenant_id = v_tenant AND (v_status IS NULL OR i.status::text = v_status);

  v_rows := '[]'::jsonb;
  FOR v_row IN
    SELECT i.* FROM core.invoices AS i
     WHERE i.tenant_id = v_tenant AND (v_status IS NULL OR i.status::text = v_status)
     ORDER BY CASE WHEN v_desc THEN i.created_at END DESC,
              CASE WHEN NOT v_desc THEN i.created_at END ASC,
              i.id
     LIMIT v_size
  LOOP
    v_rows := v_rows || pg_catalog.jsonb_build_array(app._invoice_json(v_tenant, v_row));
  END LOOP;

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'data', v_rows,
    'page', pg_catalog.jsonb_build_object('next', NULL, 'total', v_total),
    'appliedFilters', '[]'::jsonb));
END;
$fn$;

CREATE OR REPLACE FUNCTION core.get_invoice(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
  v_row    core.invoices%ROWTYPE;
BEGIN
  IF NOT app.has_permission('invoice:read') THEN
    RETURN app.err('FORBIDDEN', pg_catalog.jsonb_build_object('requiredPermission', 'invoice:read'));
  END IF;

  SELECT invoice.* INTO v_row FROM core.invoices AS invoice
   WHERE invoice.tenant_id = v_tenant AND (invoice.id::text = p_id OR invoice.ref = p_id);
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('id', p_id));
  END IF;

  RETURN app.ok(app._invoice_json(v_tenant, v_row));
END;
$fn$;

-- ═══ 5 · Receivables and collections — M13-S05 ══════════════════════════════

CREATE OR REPLACE FUNCTION core.get_receivables_aging()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE v_tenant uuid := app.require_tenant_id();
BEGIN
  IF NOT app.has_permission('receivable:read') THEN
    RETURN app.err('FORBIDDEN', pg_catalog.jsonb_build_object('requiredPermission', 'receivable:read'));
  END IF;
  RETURN app.ok(app._receivables_aging_json(v_tenant));
END;
$fn$;

CREATE OR REPLACE FUNCTION core.get_collections_queue(p_page jsonb DEFAULT '{"size":50}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
  v_size   integer;
  v_rows   jsonb;
  v_total  integer;
BEGIN
  IF NOT app.has_permission('collection:read') THEN
    RETURN app.err('FORBIDDEN', pg_catalog.jsonb_build_object('requiredPermission', 'collection:read'));
  END IF;

  BEGIN
    v_size := app._page_size(p_page);
  EXCEPTION WHEN invalid_parameter_value THEN
    RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
      'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field', 'page.size', 'reason', SQLERRM))));
  END;

  SELECT pg_catalog.count(*) INTO v_total FROM core.collections_cases AS cc
   WHERE cc.tenant_id = v_tenant AND cc.closed_at IS NULL;

  SELECT COALESCE(pg_catalog.jsonb_agg(row.item ORDER BY row.days_overdue DESC), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT GREATEST(current_date - i.due_at, 0) AS days_overdue,
             pg_catalog.jsonb_build_object(
               'invoiceRef',  i.ref,
               'organisation', pg_catalog.jsonb_build_object('ref', org.ref, 'name', org.name),
               'daysOverdue', GREATEST(current_date - i.due_at, 0),
               'amount',      app._money(i.outstanding_sen, i.currency::text),
               'stage',       cc.stage::text,
               'nextAction',  pg_catalog.jsonb_build_object(
                 'type',      COALESCE(cc.next_action_type, 'REMINDER_SEND'),
                 'status',    COALESCE(cc.next_action_status, 'SCHEDULED'),
                 'autonomy',  cc.autonomy::text))
             || CASE WHEN cc.next_action_at IS NULL THEN '{}'::jsonb
                     ELSE pg_catalog.jsonb_build_object('nextActionAt', cc.next_action_at) END AS item
        FROM core.collections_cases AS cc
        JOIN core.invoices AS i ON i.tenant_id = cc.tenant_id AND i.id = cc.invoice_id
        JOIN core.organisations AS org ON org.tenant_id = cc.tenant_id AND org.id = cc.organisation_id
       WHERE cc.tenant_id = v_tenant AND cc.closed_at IS NULL
       ORDER BY GREATEST(current_date - i.due_at, 0) DESC
       LIMIT v_size
    ) AS row;

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'data',  v_rows,
    'aging', app._receivables_aging_json(v_tenant),
    'page',  pg_catalog.jsonb_build_object('next', NULL, 'total', v_total)));
END;
$fn$;

-- Mirrors `core.get_follow_up_draft` (021:1002) exactly: same
-- `core.outbound_messages` / `core.message_rates` / `core.contact_consents`
-- read, same §16 Q4 / Ruling R11 rate-source derivation (a failed lookup is a
-- VALUE, `UNAVAILABLE`, never a stale number or a zero). The only difference
-- is the join key: a collections draft is found by `invoice_id` + `purpose =
-- 'REMINDER'`, not by `follow_up_id` + a channel argument — a collections
-- case carries one channel per stage (010's `collection_rules`), so there is
-- no second draft to disambiguate.
CREATE OR REPLACE FUNCTION core.get_collection_draft(p_invoice_ref text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant  uuid := app.require_tenant_id();
  v_invoice core.invoices%ROWTYPE;
  v_draft   core.outbound_messages%ROWTYPE;
  v_rate    core.message_rates%ROWTYPE;
  v_consent core.contact_consents%ROWTYPE;
  v_source  text;
  v_out     jsonb;
BEGIN
  IF NOT app.has_permission('collection:read') THEN
    RETURN app.err('FORBIDDEN', pg_catalog.jsonb_build_object('requiredPermission', 'collection:read'));
  END IF;

  SELECT invoice.* INTO v_invoice FROM core.invoices AS invoice
   WHERE invoice.tenant_id = v_tenant AND (invoice.id::text = p_invoice_ref OR invoice.ref = p_invoice_ref);
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('id', p_invoice_ref));
  END IF;

  -- Not every overdue invoice has a draft: an item the ladder has escalated
  -- past the agent's autonomy carries none, and a 404 is the right answer
  -- (contract `MessageDraft` header) rather than an empty composer.
  SELECT message.* INTO v_draft FROM core.outbound_messages AS message
   WHERE message.tenant_id = v_tenant AND message.invoice_id = v_invoice.id
     AND message.purpose = 'REMINDER'
   ORDER BY message.created_at DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('id', p_invoice_ref, 'reason', 'NO_DRAFT'));
  END IF;

  SELECT rate.* INTO v_rate FROM core.message_rates AS rate
   WHERE rate.tenant_id = v_tenant AND rate.id = v_draft.message_rate_id;

  SELECT consent.* INTO v_consent FROM core.contact_consents AS consent
   WHERE consent.tenant_id = v_tenant AND consent.contact_id = v_draft.contact_id
     AND consent.channel = v_draft.channel AND consent.withdrawn_at IS NULL
   ORDER BY consent.recorded_at DESC
   LIMIT 1;

  v_source := CASE
                WHEN v_rate.id IS NULL OR v_draft.rate_per_message_sen IS NULL THEN 'UNAVAILABLE'
                WHEN v_rate.stale_after IS NOT NULL AND v_rate.stale_after < pg_catalog.now() THEN 'CACHED'
                ELSE 'LIVE'
              END;

  v_out := pg_catalog.jsonb_build_object(
    'channel',    v_draft.channel::text,
    'templateId', v_draft.template_id::text,
    'category',   COALESCE(v_draft.category::text, 'UTILITY'),
    'body',       COALESCE(v_draft.body, ''),
    'recipients', 1,
    'rateSource', v_source,
    'consent', pg_catalog.jsonb_build_object(
      'channel',    v_draft.channel::text,
      'granted',    COALESCE(v_consent.granted, false),
      'recordedAt', v_consent.recorded_at));

  IF v_source <> 'UNAVAILABLE' THEN
    v_out := v_out
      || pg_catalog.jsonb_build_object('ratePerMessage',
           app._money(v_draft.rate_per_message_sen, v_draft.currency::text))
      || pg_catalog.jsonb_build_object('estimatedCost',
           app._money(COALESCE(v_draft.estimated_cost_sen, v_draft.rate_per_message_sen),
                      v_draft.currency::text));
    IF COALESCE(v_draft.rate_per_message_exact, v_rate.rate_exact) IS NOT NULL THEN
      v_out := v_out || pg_catalog.jsonb_build_object('ratePerMessageExact',
        pg_catalog.btrim(pg_catalog.to_char(
          COALESCE(v_draft.rate_per_message_exact, v_rate.rate_exact), 'FM9990.000000')));
    END IF;
  END IF;

  IF v_source = 'CACHED' AND v_rate.fetched_at IS NOT NULL THEN
    v_out := v_out || pg_catalog.jsonb_build_object('rateFetchedAt', v_rate.fetched_at);
  END IF;

  IF app._provenance('outbound_messages', v_draft.id, NULL) IS NOT NULL THEN
    v_out := v_out || pg_catalog.jsonb_build_object('provenance',
      app._provenance('outbound_messages', v_draft.id, NULL));
  END IF;

  RETURN app.ok(v_out);
END;
$fn$;

-- ═══ 6 · Commissions — Finance › Commissions (no contract type) ═════════════
--
-- Mirrors `FixtureCommission`'s own derivation (packages/fixtures/src/data/
-- commissions.ts header) exactly: one row per engagement that reached a sell
-- price; the rate is the quotation's own `commission_rate` where the deal has
-- one, else `core.rate_card_commissions` for the owner's role and the deal's
-- band; the gate is `commissionPayableOn`; `AT_RISK` is the collections
-- ladder's `TRADING_HOLD` rung, not a number invented here.
--
-- The invoice link is `core.invoices.engagement_id`, not
-- `core.quotations.invoice_id` — see the migration header for why.

CREATE OR REPLACE FUNCTION core.list_commissions(
  p_filter jsonb DEFAULT '[]'::jsonb,
  p_sort   text  DEFAULT NULL,
  p_page   jsonb DEFAULT '{"size":50}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
  v_size   integer;
  v_rows   jsonb;
  v_total  integer;
  -- `-amount` (or an absent sort, the pre-existing default) sorts descending;
  -- `amount` sorts ascending. Mirrors the `v_desc` idiom `core.list_invoices`
  -- (§6, ~line 375) uses for the same `-field`/`field` convention.
  v_desc   boolean;
BEGIN
  -- Mirrors `FixtureClient.listCommissions`'s own gate exactly
  -- (packages/fixtures/src/client/FixtureClient.ts:1543): a commission row
  -- restates a quotation's sell price and rate, so it is gated the same as
  -- reading the quotation, not a bespoke `commission:read`.
  IF NOT app.has_permission('quotation:read') THEN
    RETURN app.err('FORBIDDEN', pg_catalog.jsonb_build_object('requiredPermission', 'quotation:read'));
  END IF;

  BEGIN
    v_size := app._page_size(p_page);
  EXCEPTION WHEN invalid_parameter_value THEN
    RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
      'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field', 'page.size', 'reason', SQLERRM))));
  END;

  IF NULLIF(p_sort, '') IS NOT NULL AND p_sort NOT IN ('amount', '-amount') THEN
    RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
      'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field', 'sort', 'reason', 'UNKNOWN_SORT_FIELD'))));
  END IF;
  -- Absent sort keeps the pre-existing default (highest commission first).
  v_desc := COALESCE(p_sort, '-amount') <> 'amount';
  IF pg_catalog.jsonb_array_length(COALESCE(p_filter, '[]'::jsonb)) > 0 THEN
    RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
      'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field', COALESCE(p_filter -> 0 ->> 'field', '(null)'), 'reason', 'UNKNOWN_FILTER_FIELD'))));
  END IF;

  WITH deals AS (
    SELECT
      e.id AS engagement_id, e.ref AS engagement_ref, e.owner_id,
      p.ref AS proposal_ref,
      org.ref AS org_ref, org.name AS org_name,
      COALESCE(mem.role, 'SALES'::app.app_role) AS owner_role,
      q.ref AS quotation_ref,
      COALESCE(q.sell_price_sen, e.value_sen, 0) AS deal_value_sen,
      q.commission_rate, q.commission_payable_on, q.rate_card_id
    FROM core.engagements AS e
    JOIN core.organisations AS org ON org.tenant_id = e.tenant_id AND org.id = e.organisation_id
    LEFT JOIN core.proposals AS p ON p.tenant_id = e.tenant_id AND p.id = e.proposal_id
    LEFT JOIN core.quotations AS q
      ON q.tenant_id = e.tenant_id AND q.proposal_id = p.id AND q.status = 'APPLIED'
    LEFT JOIN public.memberships AS mem
      ON mem.tenant_id = e.tenant_id AND mem.user_id = e.owner_id AND mem.is_default
    WHERE e.tenant_id = v_tenant AND (q.id IS NOT NULL OR e.value_sen IS NOT NULL)
  ),
  rated AS (
    SELECT d.*,
           COALESCE(d.commission_rate, rcc.pct, 0) AS rate,
           CASE WHEN d.commission_rate IS NOT NULL THEN 'QUOTATION' ELSE 'RATE_CARD' END AS rate_basis,
           COALESCE(rc.version, 'v0-placeholder') AS rate_card_version
      FROM deals AS d
      LEFT JOIN core.rate_card_commissions AS rcc
        ON rcc.tenant_id = v_tenant AND rcc.rate_card_id = d.rate_card_id
       AND rcc.role = d.owner_role AND rcc.band @> d.deal_value_sen
      LEFT JOIN core.rate_cards AS rc ON rc.tenant_id = v_tenant AND rc.id = d.rate_card_id
  ),
  priced AS (
    SELECT r.*,
           app.round_half_up_sen(r.deal_value_sen::numeric * r.rate) AS commission_sen,
           inv.id AS invoice_id, inv.ref AS invoice_ref, inv.status AS invoice_status,
           inv.outstanding_sen, inv.due_at,
           cc.stage AS collection_stage
      FROM rated AS r
      LEFT JOIN LATERAL (
        SELECT * FROM core.invoices AS i
         WHERE i.tenant_id = v_tenant AND i.engagement_id = r.engagement_id AND i.voided_at IS NULL
         ORDER BY i.created_at DESC LIMIT 1
      ) AS inv ON true
      LEFT JOIN core.collections_cases AS cc
        ON cc.tenant_id = v_tenant AND cc.invoice_id = inv.id AND cc.closed_at IS NULL
  ),
  -- `page.total` is the unbounded count of every matching row in `priced`,
  -- before `v_size`/`ORDER BY` are applied in `paged` below — matching
  -- `core.list_invoices`'s (§6, ~line 384) separate-count convention, since
  -- the row query itself LIMITs to the page size and cannot also report the
  -- full match count. Kept in the same WITH as `priced` (rather than a
  -- second statement) because CTEs do not survive past the statement that
  -- defines them.
  counted AS (
    SELECT pg_catalog.count(*) AS total FROM priced
  ),
  paged AS (
    SELECT p.commission_sen AS amount_sen,
           pg_catalog.jsonb_build_object(
             'id',              'com_' || p.engagement_id::text,
             'engagementRef',   p.engagement_ref,
             'quotationRef',    p.quotation_ref,
             'proposalRef',     p.proposal_ref,
             'organisation',    pg_catalog.jsonb_build_object('ref', p.org_ref, 'name', p.org_name),
             'owner',           app._actor('HUMAN', p.owner_id::text, NULL),
             'ownerRole',       p.owner_role::text,
             'dealValue',       app._money(p.deal_value_sen, 'MYR'),
             'rate',            p.rate,
             'rateBasis',       p.rate_basis,
             'rateCardVersion', p.rate_card_version,
             'amount',          app._money(p.commission_sen, 'MYR'),
             'payableOn',       COALESCE(p.commission_payable_on, 'COLLECTION'),
             'status', CASE
                         WHEN p.collection_stage = 'TRADING_HOLD' THEN 'AT_RISK'
                         WHEN p.invoice_status = 'PAID'           THEN 'PAYABLE'
                         WHEN p.invoice_id IS NOT NULL            THEN 'ACCRUED'
                         ELSE 'FORECAST'
                       END,
             'invoiceRef',      p.invoice_ref,
             'invoiceStatus',   p.invoice_status,
             'outstanding',     app._money(p.outstanding_sen, 'MYR'),
             'daysOverdue',     CASE WHEN p.due_at IS NULL THEN NULL
                                     ELSE GREATEST(current_date - p.due_at, 0) END,
             'collectedAt', (SELECT pg_catalog.max(pay.received_at) FROM core.payments AS pay
                               WHERE pay.tenant_id = v_tenant AND pay.invoice_id = p.invoice_id
                                 AND NOT pay.is_reversal AND p.invoice_status = 'PAID')
           ) AS row
      FROM priced AS p
     -- `-amount` (default) sorts highest commission first; `amount` sorts
     -- ascending. The ORDER BY here (not just on the outer jsonb_agg below)
     -- is what picks *which* v_size rows survive the LIMIT.
     ORDER BY CASE WHEN v_desc THEN p.commission_sen END DESC,
              CASE WHEN NOT v_desc THEN p.commission_sen END ASC
     LIMIT v_size
  )
  SELECT (SELECT total FROM counted),
         COALESCE((SELECT pg_catalog.jsonb_agg(paged.row ORDER BY
                     CASE WHEN v_desc THEN paged.amount_sen END DESC,
                     CASE WHEN NOT v_desc THEN paged.amount_sen END ASC)
                     FROM paged), '[]'::jsonb)
    INTO v_total, v_rows;

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'data', COALESCE(v_rows, '[]'::jsonb),
    'page', pg_catalog.jsonb_build_object('next', NULL, 'total', COALESCE(v_total, 0))));
END;
$fn$;

-- ═══ 7 · Grants ═════════════════════════════════════════════════════════════

REVOKE ALL ON FUNCTION core.list_invoices(jsonb, text, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.get_invoice(text)                      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.get_receivables_aging()                FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.get_collections_queue(jsonb)           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.get_collection_draft(text)             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.list_commissions(jsonb, text, jsonb)   FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION core.list_invoices(jsonb, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_invoice(text)                      TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_receivables_aging()                TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_collections_queue(jsonb)           TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_collection_draft(text)             TO authenticated;
GRANT EXECUTE ON FUNCTION core.list_commissions(jsonb, text, jsonb)   TO authenticated;

-- ═══ 8 · $verify$ — structural ══════════════════════════════════════════════

DO $verify$
DECLARE
  v_fn  regprocedure;
  v_n   integer;
  v_bad text[] := ARRAY[]::text[];
BEGIN
  -- V1 · ONE DEFINITION EACH.
  FOREACH v_fn IN ARRAY ARRAY[
      'core.list_invoices(jsonb,text,jsonb,text)'::regprocedure,
      'core.get_invoice(text)'::regprocedure,
      'core.get_receivables_aging()'::regprocedure,
      'core.get_collections_queue(jsonb)'::regprocedure,
      'core.get_collection_draft(text)'::regprocedure,
      'core.list_commissions(jsonb,text,jsonb)'::regprocedure]
  LOOP
    SELECT pg_catalog.count(*) INTO v_n
      FROM pg_catalog.pg_proc AS p
      JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
     WHERE n.nspname = 'core'
       AND p.proname = (SELECT q.proname FROM pg_catalog.pg_proc AS q WHERE q.oid = v_fn);
    IF v_n <> 1 THEN
      v_bad := v_bad || pg_catalog.format('%s has %s definitions', v_fn, v_n);
    END IF;
  END LOOP;
  IF pg_catalog.cardinality(v_bad) > 0 THEN
    RAISE EXCEPTION '026 verify V1: %', v_bad;
  END IF;

  -- V2 · POSTURE on every function this file creates.
  SELECT pg_catalog.array_agg(p.oid::regprocedure::text ORDER BY p.proname) INTO v_bad
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'core'
     AND p.proname IN ('list_invoices', 'get_invoice', 'get_receivables_aging',
                       'get_collections_queue', 'get_collection_draft', 'list_commissions')
     AND NOT (p.prosecdef
              AND p.proconfig @> ARRAY['search_path=""']
              AND p.proconfig @> ARRAY['statement_timeout=10s']
              AND pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
              AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
              AND NOT EXISTS (
                SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl,
                         pg_catalog.acldefault('f', p.proowner))) AS acl
                 WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '026 verify V2: posture wrong on %', v_bad;
  END IF;
  v_bad := ARRAY[]::text[];

  -- V3 · THE GATE IS THE FIRST STATEMENT, and no `app` internal is exposed.
  IF pg_catalog.strpos(app._body_sql('core.list_invoices(jsonb,text,jsonb,text)'::regprocedure),
                       'app.has_permission(''invoice:read'')') = 0
     OR pg_catalog.strpos(app._body_sql('core.get_invoice(text)'::regprocedure),
                          'app.has_permission(''invoice:read'')') = 0
     OR pg_catalog.strpos(app._body_sql('core.get_receivables_aging()'::regprocedure),
                          'app.has_permission(''receivable:read'')') = 0
     OR pg_catalog.strpos(app._body_sql('core.get_collections_queue(jsonb)'::regprocedure),
                          'app.has_permission(''collection:read'')') = 0
     OR pg_catalog.strpos(app._body_sql('core.get_collection_draft(text)'::regprocedure),
                          'app.has_permission(''collection:read'')') = 0
     OR pg_catalog.strpos(app._body_sql('core.list_commissions(jsonb,text,jsonb)'::regprocedure),
                          'app.has_permission(''quotation:read'')') = 0 THEN
    RAISE EXCEPTION '026 verify V3: a read has lost its permission gate';
  END IF;
  IF pg_catalog.has_function_privilege('authenticated', 'app._invoice_json(uuid,core.invoices)'::regprocedure, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'app._receivables_aging_json(uuid,date)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '026 verify V3b: an app internal was granted to authenticated';
  END IF;

  -- V4 · The ladder and the buckets are seeded for every tenant that exists.
  SELECT pg_catalog.array_agg(t.slug) INTO v_bad
    FROM public.tenants AS t
   WHERE (SELECT pg_catalog.count(*) FROM core.aging_buckets AS b WHERE b.tenant_id = t.id) <> 4
      OR (SELECT pg_catalog.count(*) FROM core.collection_rules AS r WHERE r.tenant_id = t.id) <> 5;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '026 verify V4: tenant(s) missing the aging/collection seed: %', v_bad;
  END IF;

  -- V5 · The FK 008 documented now exists.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint AS c
    WHERE c.conname = 'om_invoice_fk' AND c.conrelid = 'core.outbound_messages'::regclass) THEN
    RAISE EXCEPTION '026 verify V5: om_invoice_fk was not created';
  END IF;
END
$verify$;

COMMIT;
