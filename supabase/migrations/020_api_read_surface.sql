-- ═══════════════════════════════════════════════════════════════════════════
-- 020 · The API read surface: approvals that can be decided, and views a
--       browser can actually read
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 001–019 ARE APPLIED TO HOSTED AND ARE NOT EDITED. Everything here is a
-- CREATE OR REPLACE of an 018 object or a new object. Where an 018 function
-- is replaced, its body is 018's byte for byte except for the blocks marked
-- `-- 020 ·`; the rollback reproduces the 018 body in full.
--
-- ── DEFECT 1 · NOBODY CAN APPROVE ANYTHING ─────────────────────────────────
--
-- `core.decide_approval` (014) refuses an APPROVE that carries no diff hash,
-- and `app.decide_approval` (011:3020) refuses one whose hash is stale. Both
-- are right. But `core.list_approvals` and `core.get_approval` (018) never
-- emitted `diffHash`, so the client had no hash to echo back. Every APPROVE,
-- single or bulk, was refused with VALIDATION_FAILED `diffHash REQUIRED`. The
-- contract (`packages/contract/src/actions.ts`, `ApprovalRequest.diffHash`,
-- origin/main) requires the field on both the list row and the detail.
-- `core.v_approval_requests` already selects `diff_hash` (011:573, NOT NULL).
-- The change is one key in each projection.
--
-- decide_approval keeps its 014 signature `(p_approval_id uuid, …)`. It does
-- NOT accept a ref. The web passes `ApprovalDetail.id`. Widening the argument
-- to text would bring back the overload hazard test_018 T16c pins against, and
-- the contract's `POST /v1/approvals/{id}/decide` names an id.
--
-- ── DEFECT 2 · THE AUDIT DRAWER IS ALWAYS EMPTY ────────────────────────────
--
-- The client addresses a trail `approvals::{ref}`, keyed on the URL resource
-- segment (fixture `packages/fixtures/src/data/shell.ts` `auditEntries`).
-- `core.event_subjects.subject_type` is CHECKed `^[A-Z][A-Z0-9_]*$`
-- (012:598) and holds the UPPER_SNAKE aggregate type, so `approvals` matched
-- nothing, ever. `core.get_audit` now maps the contract's resource segments
-- onto the aggregate type 012 writes (`upper(action_types.target_entity)`),
-- and still accepts the UPPER_SNAKE spelling unchanged. For `approvals` it
-- also returns the events CORRELATED with the approval's action request.
-- 012:1393 sets `correlation_id` to the action request id for every event
-- descending from one action. No event names an approval as its subject.
--
-- ── DEFECT 3 · THREE 018 VIEWS RAISE 42501 FOR EVERY CLIENT ────────────────
--
-- See §4. A view's function calls are checked against the INVOKER, and 018's
-- views call `app._money`, `app._budget_rows` and `app._model_tier_rows`, all
-- REVOKEd from `authenticated`. test_018 only checked `has_table_privilege`.
-- Measured on the hosted-like shim: `SELECT count(*) FROM core.v_budgets` as
-- `authenticated` gives `permission denied for function _budget_rows`.
--
-- ── AUTHORIZATION ON WHAT THIS FILE REPLACES ───────────────────────────────
--
-- The three approval/audit reads get the permission check 018's
-- `core.list_quotations` already carries (018:4502), decided BEFORE any read,
-- so the refusal is the same whatever id was asked for: `approval:read` and
-- `audit:read`. Both are held by all six staff roles (002 §11); TRAINER holds
-- `audit:read` only, CLIENT and AGENT hold neither. The other 24 unchecked 018
-- RPCs are 021's.
--
-- ⚠ STANDING POSTURE, NOT CHANGED HERE: 014 §4 grants `authenticated` SELECT
-- on every `core` table under a tenant-only policy, and says so in as many
-- words ("any authenticated principal of a tenant may read every row of every
-- table of that tenant"). An RPC permission check is therefore the contract's
-- FORBIDDEN answer, not a data boundary. The data boundary is 014's.
--
-- ── POSTURE ────────────────────────────────────────────────────────────────
--
-- 018's, unchanged: SECURITY DEFINER, `SET search_path = ''` (supabase/CLAUDE.md
-- rule 1 and test_001 T3 require the empty path exactly), statement_timeout
-- 10s, `app.ok`/`app.err` envelopes, tenant from `app.require_tenant_id()`,
-- REVOKE ALL FROM PUBLIC, anon, GRANT EXECUTE TO authenticated. Views are
-- `security_invoker = true` (014 §4's sweep) and call no `app` function.
--
-- ── THE 7-POINT RPC CONTRACT CHECK, WORKED ─────────────────────────────────
--
--  1 ENVELOPE. Unchanged. Every return is `app.ok` / `app.err`. The new key
--    `diffHash` sits inside each row, and the FORBIDDEN refusal is `app.err`.
--  2 UNWRAP. No top-level key is added beside `data`.
--  3 RpcMap. Signatures byte-identical to 018 (`$verify$` V1 asserts the
--    identity arguments and an overload count of 1). `ApprovalRequest.diffHash`
--    is already in the contract on origin/main.
--  4 CALL SITES. `list_approvals`: approvals/api.ts, tasks/api.ts,
--    agents/api.ts. `get_approval`: approvals/api.ts, proposals/api.ts.
--    `get_audit`: approvals/api.ts (`"approvals"`). Views: VIEW_READS in
--    rpcClient.ts.
--  5 CASTS. No TypeScript in this migration.
--  6 RELOAD. All reads. No idempotency surface.
--  7 PUBLIC ROUTES. Nothing is granted to anon.
--
-- ── DEPLOY ORDER ───────────────────────────────────────────────────────────
--
-- Additive for the client: a client that ignores `diffHash` is unaffected, and
-- `get_audit` still accepts every string it accepted before. Apply before the
-- web change that sends `detail.id` + `detail.diffHash`. Needs no hosted
-- privilege beyond what 018 needed: every statement is CREATE OR REPLACE on
-- objects the migration role owns, or a new object in `core`.
--
-- Spine untouched: no action type, no handler, no branch in the envelope.
-- `core.decide_approval` and `core.bulk_decide_approvals` are 014's and are
-- not redefined.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL client_min_messages = warning;

-- ═══ 1 · Approvals carry the diff hash they are decided against ════════════
--
-- Replaces 018 §9 `core.list_approvals` and `core.get_approval`. The two
-- changes in each body are marked `-- 020 ·`.

CREATE OR REPLACE FUNCTION core.list_approvals(
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
  v_tenant   uuid := app.require_tenant_id();
  v_size     integer;
  v_cursor   text;
  v_cur_at   timestamptz;
  v_cur_id   uuid;
  v_clauses  text[] := ARRAY[]::text[];
  v_errors   jsonb  := '[]'::jsonb;
  v_merged   jsonb  := '[]'::jsonb;
  v_clause   jsonb;
  v_field    text;
  v_op       text;
  v_column   text;
  v_kind     text;
  v_desc     boolean := false;
  v_sort_col text := 'sla_due_at';
  v_sort_fld text;
  v_where    text;
  v_rows     jsonb;
  v_groups   jsonb;
  v_total    integer;
  v_count    integer;
  v_next     text;
  v_last_at  timestamptz;
  v_last_id  uuid;
  v_median   integer;
  v_keyed    text;
BEGIN
  -- 020 · AUTHZ FIRST, before any read, so the refusal does not vary with id.
  IF NOT app.has_permission('approval:read') THEN
    RETURN app.err('FORBIDDEN', pg_catalog.jsonb_build_object(
      'requiredPermission','approval:read'));
  END IF;

  BEGIN
    v_size := app._page_size(p_page);
  EXCEPTION WHEN invalid_parameter_value THEN
    RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
      'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field','page.size','reason', SQLERRM))));
  END;

  v_cursor := NULLIF(p_page ->> 'cursor', '');
  IF v_cursor IS NOT NULL THEN
    BEGIN
      SELECT decoded.at, decoded.id INTO v_cur_at, v_cur_id
        FROM app._cursor_decode(v_cursor) AS decoded;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
        'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'field','page.cursor','reason','MALFORMED_CURSOR'))));
    END;
  END IF;

  -- SAVED VIEW. One resolution path for all five lists (§1
  -- `app._view_filters`): it gates on `core.saved_view_object`, refuses a view
  -- that does not resolve in THIS tenant, and tags what it contributes
  -- `source: VIEW`. A list whose object has no enum value refuses rather than
  -- dropping the parameter.
  BEGIN
    v_merged := app._view_filters(v_tenant, p_view, 'APPROVAL', p_filter);
  EXCEPTION WHEN invalid_parameter_value THEN
    RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
      'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field','view','reason', SQLERRM))));
  END;

  SELECT v_merged || COALESCE(pg_catalog.jsonb_agg(element.value), '[]'::jsonb) INTO v_merged
    FROM pg_catalog.jsonb_array_elements(COALESCE(p_filter, '[]'::jsonb)) AS element(value);

  FOR v_clause IN SELECT element.value FROM pg_catalog.jsonb_array_elements(v_merged) AS element(value)
  LOOP
    v_field := v_clause ->> 'field';
    v_op    := v_clause ->> 'op';
    SELECT allowed.column_name, allowed.kind INTO v_column, v_kind
      FROM (VALUES
              ('status',       'status',        'text'),
              ('actionType',   'action_type',   'text'),
              ('urgencyGroup', 'urgency_group', 'text'),
              ('approverRole', 'approver_role', 'text'),
              ('assignedTo',   'assigned_to_id','text'),
              ('slaBreached',  'sla_breached',  'bool'),
              ('slaDueAt',     'sla_due_at',    'ts'),
              ('policyId',     'policy_id',     'text'),
              ('targetRef',    'target_ref',    'text')
            ) AS allowed(field, column_name, kind)
     WHERE allowed.field = v_field;
    IF v_column IS NULL THEN
      v_errors := v_errors || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field', COALESCE(v_field,'(null)'), 'reason','UNKNOWN_FILTER_FIELD'));
      CONTINUE;
    END IF;
    BEGIN
      v_clauses := v_clauses || app._predicate(v_column, v_kind, v_op, v_clause -> 'value');
    EXCEPTION WHEN invalid_parameter_value THEN
      v_errors := v_errors || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field', v_field, 'reason', SQLERRM, 'code', COALESCE(v_op,'(null)')));
    END;
    v_column := NULL; v_kind := NULL;
  END LOOP;

  IF pg_catalog.jsonb_array_length(v_errors) > 0 THEN
    RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object('fields', v_errors));
  END IF;

  IF NULLIF(p_sort, '') IS NOT NULL THEN
    v_desc := pg_catalog.left(p_sort, 1) = '-';
    v_sort_fld := CASE WHEN v_desc THEN pg_catalog.substr(p_sort, 2) ELSE p_sort END;
    SELECT allowed.column_name INTO v_sort_col
      FROM (VALUES ('slaDueAt','sla_due_at'), ('createdAt','created_at'),
                   ('updatedAt','updated_at'), ('value','value_sen'))
           AS allowed(field, column_name)
     WHERE allowed.field = v_sort_fld;
    IF v_sort_col IS NULL THEN
      RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
        'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'field','sort','reason','UNKNOWN_SORT_FIELD','code', v_sort_fld))));
    END IF;
  END IF;

  v_where := CASE WHEN pg_catalog.array_length(v_clauses, 1) IS NULL THEN 'true'
                  ELSE pg_catalog.array_to_string(v_clauses, ' AND ') END;

  -- COUNT BEFORE KEYSET, CURSOR FROM A REAL LOOKAHEAD — both orderings now
  -- live in `app._keyset_scope` / `app._next_cursor` (§1), so no copy of this
  -- engine can get either one wrong on its own. See the helpers' header for
  -- the two defects this pair replaces.
  SELECT scope.o_total, scope.o_where INTO v_total, v_keyed
    FROM app._keyset_scope('core.v_approval_requests'::regclass, v_tenant, v_where,
                           v_sort_col, v_desc, v_cur_at, v_cur_id) AS scope;

  -- `groups` is computed over the WHOLE filtered set, not the page. A bucket
  -- header that counted only the visible rows would say "3 breaching" on a
  -- page that happens to hold three of eleven.
  EXECUTE pg_catalog.format($q$
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'key', bucket.urgency_group, 'count', bucket.n)
           ORDER BY pg_catalog.array_position(
             ARRAY['BREACHING','TODAY','THIS_WEEK','LATER'], bucket.urgency_group)), '[]'::jsonb)
      FROM (SELECT urgency_group, pg_catalog.count(*)::integer AS n
              FROM core.v_approval_requests
             WHERE tenant_id = $1 AND %s
             GROUP BY urgency_group) AS bucket$q$, v_where)
    INTO v_groups USING v_tenant;

  EXECUTE pg_catalog.format($q$
    SELECT COALESCE(pg_catalog.jsonb_agg(row.item ORDER BY row.ord), '[]'::jsonb),
           pg_catalog.count(*)::integer,
           -- THE CURSOR IS THE LAST ROW IN DISPLAY ORDER, not the maximum sort
           -- key. Under a DESCENDING sort those are opposite ends of the page,
           -- and taking the max hands back a cursor pointing at the row the
           -- reader has already seen — page two then repeats page one's tail.
           -- Caught by T4e, which counted the rows on page two.
           (pg_catalog.array_agg(row.sort_at ORDER BY row.ord DESC))[1],
           (pg_catalog.array_agg(row.id      ORDER BY row.ord DESC))[1]
      FROM (
        SELECT pg_catalog.row_number() OVER (ORDER BY a.%I %s, a.id %s) AS ord,
               a.id, a.%I AS sort_at,
               pg_catalog.jsonb_build_object(
                 'id',         a.id::text,
                 'ref',        a.ref,
                 'policyId',   a.policy_id,
                 'actionType', a.action_type,
                 'subject',    a.subject,
                 'targetRef',  a.target_ref,
                 'requestedBy', pg_catalog.jsonb_build_object(
                    'kind', a.requested_by_kind,
                    'id',   COALESCE(a.requested_by_id, 'unknown'),
                    'name', COALESCE(a.requested_by_name, a.requested_by_id, 'unknown'))
                    || CASE WHEN a.agent_run_id IS NULL THEN '{}'::jsonb
                            ELSE pg_catalog.jsonb_build_object('runId', a.agent_run_id) END,
                 'slaDueAt',   a.sla_due_at,
                 -- `slaBreached` NEVER BLOCKS. It is the §1 table's
                 -- "SLA_BREACHED is a 200 plus a flag" row, and the client
                 -- explicitly keeps it out of the error branch.
                 'slaBreached', COALESCE(a.sla_breached, false),
                 'status',      a.status,
                 -- 020 · the hash the approver must echo back to decide.
                 'diffHash',    a.diff_hash,
                 -- `bulkApprovable` is SERVER-DECIDED and is false for any
                 -- action carrying a monetary value. 011 stores that decision;
                 -- the value column is re-checked here so a stored true can
                 -- never widen a money decision into a bulk one.
                 'bulkApprovable', (COALESCE(a.bulk_approvable, false) AND a.value_sen IS NULL),
                 'urgencyGroup',   a.urgency_group)
               || CASE WHEN a.value_sen IS NULL THEN '{}'::jsonb
                       ELSE pg_catalog.jsonb_build_object('value',
                              app._money(a.value_sen, a.currency)) END
               || CASE WHEN a.confidence IS NULL THEN '{}'::jsonb
                       ELSE pg_catalog.jsonb_build_object('confidence', a.confidence) END
               || CASE WHEN a.autonomy IS NULL THEN '{}'::jsonb
                       ELSE pg_catalog.jsonb_build_object('autonomy', a.autonomy) END
               || CASE WHEN a.sla_remaining_minutes IS NULL THEN '{}'::jsonb
                       ELSE pg_catalog.jsonb_build_object('slaRemainingMinutes',
                              a.sla_remaining_minutes) END AS item
          FROM core.v_approval_requests AS a
         WHERE a.tenant_id = $1 AND %s
         ORDER BY a.%I %s, a.id %s
         LIMIT $2
      ) AS row$q$,
    v_sort_col, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END,
    v_sort_col, v_keyed,
    v_sort_col, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END)
    INTO v_rows, v_count, v_last_at, v_last_id USING v_tenant, v_size;

  v_next := app._next_cursor('core.v_approval_requests'::regclass, v_tenant, v_where,
                             v_sort_col, v_desc, v_count, v_size, v_last_at, v_last_id);

  SELECT pg_catalog.percentile_cont(0.5) WITHIN GROUP (
           ORDER BY pg_catalog.date_part('epoch', decided.decided_at - decided.created_at))::integer
    INTO v_median
    FROM core.approval_requests AS decided
   WHERE decided.tenant_id = v_tenant AND decided.decided_at IS NOT NULL;

  RETURN app.ok(
    -- `groups` sits BESIDE `data` INSIDE the `data` object — one level down
    -- from the envelope, which doc 09 §11 states is fine. One level UP it
    -- would be a live incident: a third top-level key beside `data` flips
    -- every caller in the app from auto-unwrap to pass-through at once.
    pg_catalog.jsonb_build_object(
      'data',   v_rows,
      'page',   pg_catalog.jsonb_build_object('next', v_next, 'total', v_total),
      'groups', v_groups)
    || CASE WHEN v_median IS NULL THEN '{}'::jsonb
            ELSE pg_catalog.jsonb_build_object('summary',
                   pg_catalog.jsonb_build_object('medianDecisionSeconds', v_median)) END);
END;
$fn$;

CREATE OR REPLACE FUNCTION core.get_approval(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
  v_row    record;
BEGIN
  -- 020 · AUTHZ FIRST, before any read, so the refusal does not vary with id.
  IF NOT app.has_permission('approval:read') THEN
    RETURN app.err('FORBIDDEN', pg_catalog.jsonb_build_object(
      'requiredPermission','approval:read'));
  END IF;

  SELECT a.* INTO v_row FROM core.v_approval_requests AS a
   WHERE a.tenant_id = v_tenant
     AND (a.id::text = p_id OR a.ref = p_id);
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('id', p_id));
  END IF;

  RETURN app.ok(
    pg_catalog.jsonb_build_object(
      'id',         v_row.id::text,
      'ref',        v_row.ref,
      'policyId',   v_row.policy_id,
      'actionType', v_row.action_type,
      'subject',    v_row.subject,
      'targetRef',  v_row.target_ref,
      'requestedBy', pg_catalog.jsonb_build_object(
        'kind', v_row.requested_by_kind,
        'id',   COALESCE(v_row.requested_by_id, 'unknown'),
        'name', COALESCE(v_row.requested_by_name, v_row.requested_by_id, 'unknown'))
        || CASE WHEN v_row.agent_run_id IS NULL THEN '{}'::jsonb
                ELSE pg_catalog.jsonb_build_object('runId', v_row.agent_run_id) END,
      'slaDueAt',    v_row.sla_due_at,
      'slaBreached', COALESCE(v_row.sla_breached, false),
      'status',      v_row.status,
      -- 020 · the hash the approver must echo back to decide.
      'diffHash',    v_row.diff_hash,
      -- §7: the screen answers four questions in order — why this needs you,
      -- what the agent recommends, what it is standing on, and what happens if
      -- you approve. `diff` is the last of those and is the contract that
      -- matters most: `effects[]` from `decide` must equal it, field for field.
      'reason',         v_row.reason,
      'recommendation', COALESCE(v_row.recommendation,
                          pg_catalog.jsonb_build_object('verdict','NONE','rationale','')),
      'evidence',       COALESCE(v_row.evidence,   '[]'::jsonb),
      'deviations',     COALESCE(v_row.deviations, '[]'::jsonb),
      'risk',           COALESCE(v_row.risk,
                          pg_catalog.jsonb_build_object('level','LOW','note','')),
      'diff',           COALESCE(v_row.diff, '[]'::jsonb))
    || CASE WHEN v_row.value_sen IS NULL THEN '{}'::jsonb
            ELSE pg_catalog.jsonb_build_object('value', app._money(v_row.value_sen, v_row.currency)) END
    || CASE WHEN v_row.margin_rate IS NULL THEN '{}'::jsonb
            ELSE pg_catalog.jsonb_build_object('marginRate', v_row.margin_rate) END
    || CASE WHEN v_row.confidence IS NULL THEN '{}'::jsonb
            ELSE pg_catalog.jsonb_build_object('confidence', v_row.confidence) END
    || CASE WHEN v_row.autonomy IS NULL THEN '{}'::jsonb
            ELSE pg_catalog.jsonb_build_object('autonomy', v_row.autonomy) END
    || CASE WHEN v_row.sla_remaining_minutes IS NULL THEN '{}'::jsonb
            ELSE pg_catalog.jsonb_build_object('slaRemainingMinutes', v_row.sla_remaining_minutes) END
    || CASE WHEN v_row.preview_url IS NULL THEN '{}'::jsonb
            ELSE pg_catalog.jsonb_build_object('previewUrl', v_row.preview_url) END
    || pg_catalog.jsonb_build_object(
         'bulkApprovable', (COALESCE(v_row.bulk_approvable, false) AND v_row.value_sen IS NULL),
         'urgencyGroup',   v_row.urgency_group)
    -- §17 `modelAgreement` renders under the evidence list ONLY when a jury
    -- actually ran. An empty agreement block would imply one did.
    -- TENANT-CORRELATED AND DETERMINISTIC. This read carried neither: no
    -- `tenant_id` predicate (the same defect as `app._provenance`, and the same
    -- lost index), and `LIMIT 1` with NO `ORDER BY` — so which jury became
    -- `modelAgreement` when an approval had more than one provenance row was
    -- whatever the planner happened to return, and could change between two
    -- reads of the same approval. `app._provenance` already orders by
    -- `updated_at DESC`; this is the same rule, said the same way.
    || COALESCE((
         SELECT CASE WHEN verdict.jury IS NULL THEN '{}'::jsonb
                     ELSE pg_catalog.jsonb_build_object('modelAgreement', verdict.jury) END
           FROM core.provenance AS verdict
          WHERE verdict.tenant_id     = v_tenant
            AND verdict.subject_table = 'approval_requests'
            AND verdict.subject_id    = v_row.id
          ORDER BY verdict.updated_at DESC, verdict.id DESC
          LIMIT 1), '{}'::jsonb));
END;
$fn$;

-- ═══ 2 · The audit drawer, addressed the way the client addresses it ═══════
--
-- Replaces 018 `core.get_audit`. The signature, the envelope, the "no trail is
-- an empty list, not a 404" rule and the newest-first order are 018's.
--
-- THE VOCABULARY. The client sends the contract's URL resource segment
-- (`GET /v1/{resourceType}/{id}/audit`, endpoints.ts). The subject type 012
-- stores is `upper(app.action_types.target_entity)` (012:1010) or a literal an
-- emitter passes (`PROPOSAL`, `PROVIDER_KEY`, `OUTBOX`). The map below covers
-- the segments whose aggregate is unambiguous. Any other string, including
-- every UPPER_SNAKE subject type, is used exactly as sent, which is 018's
-- behaviour. `hrdc`, `collections`, `compliance` and `knowledge` are NOT
-- mapped: each of those URL trees addresses more than one aggregate, and a
-- guess would put one record's events in another's drawer.
--
-- APPROVALS. No emitter names an approval as its subject. Every event that
-- descends from the approved action carries the action request id as
-- `correlation_id` (012:1393), so the approval's trail is its action's trail.
-- The approval is resolved in THIS tenant by id or ref. An approval that does
-- not resolve contributes nothing, and the answer is the same empty list a
-- real approval with no events gets. Nothing here tells a caller whether an id
-- exists.
CREATE OR REPLACE FUNCTION core.get_audit(p_resource_type text, p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant  uuid := app.require_tenant_id();
  v_subject text;
  v_request uuid;
  v_rows    jsonb;
BEGIN
  -- 020 · AUTHZ FIRST, before any read, so the refusal does not vary with id.
  IF NOT app.has_permission('audit:read') THEN
    RETURN app.err('FORBIDDEN', pg_catalog.jsonb_build_object(
      'requiredPermission','audit:read'));
  END IF;

  SELECT segment.subject_type INTO v_subject
    FROM (VALUES
            ('approvals',     'APPROVAL_REQUEST'),
            ('proposals',     'PROPOSAL'),
            ('quotations',    'QUOTATION'),
            ('enquiries',     'ENQUIRY'),
            ('organisations', 'ORGANISATION'),
            ('opportunities', 'OPPORTUNITY'),
            ('contacts',      'CONTACT'),
            ('tnas',          'TNA'),
            ('programmes',    'PROGRAMME'),
            ('trainers',      'TRAINER'),
            ('engagements',   'ENGAGEMENT'),
            ('invoices',      'INVOICE'),
            ('follow-ups',    'FOLLOW_UP'),
            ('runs',          'RUN'),
            ('agents',        'AGENT')
         ) AS segment(resource, subject_type)
   WHERE segment.resource = p_resource_type;
  v_subject := COALESCE(v_subject, p_resource_type);

  IF v_subject = 'APPROVAL_REQUEST' THEN
    SELECT approval.action_request_id INTO v_request
      FROM core.approval_requests AS approval
     WHERE approval.tenant_id = v_tenant
       AND (approval.id::text = p_id OR approval.ref = p_id);
  END IF;

  -- ONE ROW PER EVENT. An event reached both as the subject and through the
  -- approval's correlation appears once.
  SELECT COALESCE(pg_catalog.jsonb_agg(entry.item ORDER BY entry.at DESC, entry.id DESC), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT DISTINCT ON (audit.id)
             audit.id,
             audit.at,
             pg_catalog.jsonb_build_object(
               'at',      audit.at,
               'actor',   audit.actor,
               'event',   audit.event,
               'summary', COALESCE(audit.summary, audit.event))
             || CASE WHEN audit.run_id IS NULL THEN '{}'::jsonb
                     ELSE pg_catalog.jsonb_build_object('runId', audit.run_id) END AS item
        FROM core.audit_entries AS audit
       WHERE audit.tenant_id = v_tenant
         AND ((audit.subject_type = v_subject
               AND (audit.subject_id::text = p_id OR audit.aggregate_ref = p_id))
              OR (v_request IS NOT NULL
                  AND audit.correlation_id = v_request
                  AND audit.subject_role = 'SUBJECT'))
       ORDER BY audit.id, audit.at DESC
    ) AS entry;

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'data', v_rows,
    'page', pg_catalog.jsonb_build_object(
      'next', NULL, 'total', pg_catalog.jsonb_array_length(v_rows))));
END;
$fn$;

-- ═══ 9 · Grants ════════════════════════════════════════════════════════════
--
-- CREATE OR REPLACE keeps an existing function's ACL, so these statements
-- change nothing on a database where 018 granted them. They are restated so
-- this file's end state does not depend on 018's loop having run as written.

REVOKE ALL ON FUNCTION core.list_approvals(jsonb, text, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.get_approval(text)                      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.get_audit(text, text)                   FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION core.list_approvals(jsonb, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_approval(text)                      TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_audit(text, text)                   TO authenticated;

-- ═══ 10 · $verify$ — structural, off the catalogue ═════════════════════════

DO $verify$
DECLARE
  v_fn   regprocedure;
  v_n    integer;
  v_bad  text[] := ARRAY[]::text[];
BEGIN
  -- V1 · ONE DEFINITION EACH, with 018's identity arguments. A replaced
  -- function that gained a parameter would be a second overload (PGRST203).
  FOREACH v_fn IN ARRAY ARRAY[
      'core.list_approvals(jsonb,text,jsonb,text)'::regprocedure,
      'core.get_approval(text)'::regprocedure,
      'core.get_audit(text,text)'::regprocedure]
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
    RAISE EXCEPTION '020 verify V1: %', v_bad;
  END IF;

  -- V2 · POSTURE on every function this file creates or replaces.
  SELECT pg_catalog.array_agg(p.oid::regprocedure::text ORDER BY p.proname) INTO v_bad
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'core'
     AND p.proname IN ('list_approvals','get_approval','get_audit')
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
    RAISE EXCEPTION '020 verify V2: posture wrong on %', v_bad;
  END IF;
  v_bad := ARRAY[]::text[];

  -- V3 · THE CHANGE IS IN THE BODY. `diffHash` in both approval projections,
  -- the permission gate in all three, and the gate before the first read.
  IF pg_catalog.strpos(app._body_sql('core.list_approvals(jsonb,text,jsonb,text)'::regprocedure),
                       '''diffHash''') = 0
     OR pg_catalog.strpos(app._body_sql('core.get_approval(text)'::regprocedure),
                          '''diffHash''') = 0 THEN
    RAISE EXCEPTION '020 verify V3a: an approval projection has no diffHash';
  END IF;
  IF pg_catalog.strpos(app._body_sql('core.list_approvals(jsonb,text,jsonb,text)'::regprocedure),
                       'app.has_permission(''approval:read'')') = 0
     OR pg_catalog.strpos(app._body_sql('core.get_approval(text)'::regprocedure),
                          'app.has_permission(''approval:read'')') = 0
     OR pg_catalog.strpos(app._body_sql('core.get_audit(text,text)'::regprocedure),
                          'app.has_permission(''audit:read'')') = 0 THEN
    RAISE EXCEPTION '020 verify V3b: a replaced read has lost its permission gate';
  END IF;
  IF pg_catalog.strpos(app._body_sql('core.get_approval(text)'::regprocedure), 'app.has_permission(')
     > pg_catalog.strpos(app._body_sql('core.get_approval(text)'::regprocedure), 'FROM core.v_approval_requests') THEN
    RAISE EXCEPTION '020 verify V3c: get_approval reads before it authorizes';
  END IF;

  -- V4 · 014's decide wrapper is untouched: one definition, uuid first.
  IF pg_catalog.to_regprocedure('core.decide_approval(uuid,text,text,text,text)') IS NULL
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
           JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
          WHERE n.nspname = 'core' AND p.proname = 'decide_approval') <> 1 THEN
    RAISE EXCEPTION '020 verify V4: core.decide_approval is not 014''s single uuid signature';
  END IF;
END
$verify$;

COMMIT;
