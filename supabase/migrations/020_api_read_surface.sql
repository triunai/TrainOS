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
-- The change is one key in each projection. The list also accepts the
-- contract's `value.amount` filter (the inbox's high-value toggle sends it, in
-- sen), which 018's whitelist refused as VALIDATION_FAILED.
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
-- See §3. A view's function calls are checked against the INVOKER, and 018's
-- views call `app._money`, `app._budget_rows` and `app._model_tier_rows`, all
-- REVOKEd from `authenticated`. test_018 only checked `has_table_privilege`.
-- Measured on the hosted-like shim: `SELECT count(*) FROM core.v_budgets` as
-- `authenticated` gives `permission denied for function _budget_rows`.
--
-- ── DEFECT 4 · FOURTEEN VIEW_READS NAME VIEWS THAT DO NOT EXIST ────────────
--
-- See §4. `rpcClient.ts` `VIEW_READS` names eighteen `core.v_*` reads, and 018
-- built three. Every other one answered PGRST205. §4 builds the fourteen the
-- web calls. `v_pipeline_configs` has no caller and is not built. The web's
-- consent read moves to `v_contact_channel_consents`, because 005's view is
-- snake_case and is not renamed under its other readers.
--
-- NOT BUILT, and reported rather than stubbed: `core.me_profile` (018's own
-- reasoning stands — `MeProfile` requires location, jobTitle, department,
-- staffNumber and a session block that no table carries) and the three
-- dashboard RPCs (no metric definition or hours-saved baseline exists to
-- compute them from).
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
--    rpcClient.ts, one read method each. `core.ai_budget_rows` and
--    `core.ai_model_tier_rows` have no direct call site; each is read only
--    through its view.
--  5 CASTS. No TypeScript in this migration.
--  6 RELOAD. All reads. No idempotency surface.
--  7 PUBLIC ROUTES. Nothing is granted to anon.
--
-- ── DEPLOY ORDER ───────────────────────────────────────────────────────────
--
-- Additive for the client: a client that ignores `diffHash` is unaffected, and
-- `get_audit` still accepts every string it accepted before. Apply before the
-- web change that sends `detail.id` + `detail.diffHash`. The two view shape
-- changes (`v_model_tiers.allowedHours`, `degradation.activeFallback`) are
-- breaking only in principle: before 020 no client could read that view at all.
-- Needs no hosted privilege beyond what 018 needed: every statement is CREATE
-- OR REPLACE or DROP VIEW on an object the migration role owns (018's), or a
-- new object in `core`. Nothing is created in `public`, so Supabase's
-- `public` default ACLs do not apply.
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
              ('targetRef',    'target_ref',    'text'),
              -- 020 · the contract's high-value toggle (ApprovalInbox) filters on
              -- the Money amount, in sen.
              ('value.amount', 'value_sen',     'number')
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

-- ═══ 3 · The three 018 views a client could not read ═══════════════════════
--
-- THE MECHANISM. Under `security_invoker = true` every function a view calls is
-- checked against the QUERYING role. 018's three views call `app._money`
-- (all three), `app._budget_rows` and `app._model_tier_rows`, and 018 REVOKEd
-- all of them from `authenticated`. So a browser read raised 42501, which the
-- client maps to UNAUTHENTICATED: a signed-in user looked signed out.
-- `v_budgets` and `v_model_tiers` failed on every read, and
-- `v_organisation_relations` failed as soon as one organisation row was visible.
--
-- THE FIX KEEPS `app` CLOSED. Nothing in `app` is granted to `authenticated`:
--   * `app._money` is inlined as `jsonb_build_object('amount', …, 'currency', …)`.
--     Every call site already COALESCEs the amount, so the null branch of
--     `_money` was unreachable in these bodies.
--   * The two definer row sources move to `core.ai_budget_rows()` and
--     `core.ai_model_tier_rows()`. Each one derives the tenant itself and returns
--     no rows to a caller without the permission (`ai:budget:read`,
--     `ai:tier:read`). Only these are granted to `authenticated`. 018's
--     `app._budget_rows` / `app._model_tier_rows` are left in place and still
--     revoked (test_018 T21b counts them by name).
--
-- SHAPE FIXES ON THE WAY THROUGH, each against `packages/contract`:
--   * `v_model_tiers."allowedHours"` was the raw `bit(24)` column, which reaches
--     the wire as a 24-character string. The contract's `AllowedHourWindow[]` is
--     `[start, end]` pairs. It is now derived from the bits as half-open runs of
--     set hours. A type change is not expressible through CREATE OR REPLACE
--     VIEW, so this view is dropped and re-created, and its grant restated.
--   * `degradation.activeFallbackTier` becomes `activeFallback`
--     (`TierDegradation.activeFallback`).
--   * `spend` is added (`ModelTier.spend`), read from the tier's TIER budget.
--   * `v_organisation_relations` gains `organisation_ref` as its LAST column
--     (CREATE OR REPLACE VIEW may only append), so the client can match on the
--     ref its route carries. It also gains the `organisation:read` predicate.
--
-- ═══ 4 · The VIEW_READS the client names and 001–019 never built ═══════════
--
-- `apps/web/src/shared/api/rpcClient.ts` `VIEW_READS` reads each of these as
-- `.from(name).select("*")`, so a column name IS the contract key: camelCase,
-- quoted. Match keys the client passes to `.match()` stay snake_case. Every view:
--   * is `security_invoker = true`, so 014's tenant policies apply to the caller
--     (014 §4 re-asserts this for every `core` view);
--   * calls no `app` function except `app.has_permission`, which 002 grants to
--     `authenticated` precisely so predicates can evaluate it;
--   * returns NO ROWS to a caller without the 002 read permission. A view has
--     no FORBIDDEN channel. Empty is the answer RLS would give, and it is the
--     same answer for every id.
--
-- A contract field marked optional (`?`) is a column that is NULL when absent.
-- A view cannot omit a key per row.
--
-- Two views reuse an 018 projection rather than re-writing it:
-- `v_programmes` over `core.get_programme` and `v_compliance_rules` over
-- `core.get_compliance_rule`. A second copy of a projection drifts from the
-- first. Each row calls the RPC as the invoker, and rows the RPC refuses are
-- dropped.
--
-- `v_pipeline_configs` is NOT built: nothing in the web calls it
-- (`get_pipeline_config` is the RPC every screen uses).

CREATE OR REPLACE VIEW core.v_organisation_relations
WITH (security_invoker = true) AS
SELECT
  org.tenant_id,
  org.id AS organisation_id,
  COALESCE((
    SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'ref',   engagement.ref,
             'title', engagement.title,
             'dates', COALESCE(engagement.starts_on::text, '') ||
                      CASE WHEN engagement.ends_on IS NULL THEN ''
                           ELSE '/' || engagement.ends_on::text END,
             'value', pg_catalog.jsonb_build_object('amount', COALESCE(engagement.value_sen, 0),
                        'currency', COALESCE(pg_catalog.rtrim(engagement.currency::text), 'MYR')),
             -- STAGE NAMES AND ORDER FROM `core.pipeline_steps`, never a
             -- hardcoded list: the lifecycle strip renders whatever the
             -- engagement's own pipeline configures, in `position` order.
             'lifecycle', COALESCE((
               SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                        'key',   step.step_key,
                        'label', step.label,
                        'state', COALESCE(state.state::text, 'PENDING'))
                      || CASE WHEN state.at IS NULL THEN '{}'::jsonb
                              ELSE pg_catalog.jsonb_build_object('at', state.at) END
                      || CASE WHEN state.note IS NULL THEN '{}'::jsonb
                              ELSE pg_catalog.jsonb_build_object('note', state.note) END
                      || CASE WHEN state.target_ref IS NULL THEN '{}'::jsonb
                              ELSE pg_catalog.jsonb_build_object('ref', state.target_ref) END
                      ORDER BY step.position)
                 FROM core.pipeline_steps AS step
                 LEFT JOIN core.engagement_step_states AS state
                        ON state.tenant_id = engagement.tenant_id
                       AND state.engagement_id = engagement.id
                       AND state.pipeline_step_id = step.id
                WHERE step.tenant_id = engagement.tenant_id
                  AND step.pipeline_id = engagement.pipeline_id), '[]'::jsonb))
           ORDER BY engagement.created_at DESC)
      FROM core.engagements AS engagement
     WHERE engagement.tenant_id = org.tenant_id
       AND engagement.organisation_id = org.id), '[]'::jsonb) AS engagements,
  COALESCE((
    SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'ref',  contact.ref,
             'name', contact.name,
             'role', COALESCE(contact.job_title, ''),
             'primary', contact.is_primary,
             'consent', pg_catalog.jsonb_build_object(
               'email', COALESCE((SELECT pg_catalog.bool_or(c.granted) FROM core.contact_consents AS c
                                   WHERE c.tenant_id = contact.tenant_id AND c.contact_id = contact.id
                                     AND c.channel = 'EMAIL' AND c.withdrawn_at IS NULL), false),
               'whatsapp', COALESCE((SELECT pg_catalog.bool_or(c.granted) FROM core.contact_consents AS c
                                   WHERE c.tenant_id = contact.tenant_id AND c.contact_id = contact.id
                                     AND c.channel = 'WHATSAPP' AND c.withdrawn_at IS NULL), false)))
           || CASE WHEN contact.pdpa_flag IS NULL THEN '{}'::jsonb
                   ELSE pg_catalog.jsonb_build_object('pdpaFlag', contact.pdpa_flag) END
           ORDER BY contact.is_primary DESC, contact.name)
      FROM core.contacts AS contact
     WHERE contact.tenant_id = org.tenant_id
       AND contact.organisation_id = org.id
       AND contact.redacted_at IS NULL), '[]'::jsonb) AS contacts,
  COALESCE((
    SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'ref',    invoice.ref,
             'status', invoice.status::text,
             'amount', pg_catalog.jsonb_build_object('amount', COALESCE(invoice.total_sen, 0),
                        'currency', COALESCE(pg_catalog.rtrim(invoice.currency::text), 'MYR')))
           || CASE WHEN invoice.due_at IS NULL OR invoice.due_at >= CURRENT_DATE
                   THEN '{}'::jsonb
                   ELSE pg_catalog.jsonb_build_object('daysOverdue',
                          (CURRENT_DATE - invoice.due_at)) END
           ORDER BY invoice.issued_at DESC NULLS LAST)
      FROM core.invoices AS invoice
     WHERE invoice.tenant_id = org.tenant_id
       AND invoice.organisation_id = org.id
       AND invoice.voided_at IS NULL), '[]'::jsonb) AS invoices,
  CASE WHEN org.hrdc_employer_code IS NULL THEN NULL ELSE
    pg_catalog.jsonb_build_object(
      'employerCode',  org.hrdc_employer_code,
      'levyAvailable', pg_catalog.jsonb_build_object('currency', 'MYR', 'amount', COALESCE((
          SELECT statement.levy_available_sen FROM core.hrdc_levy_statements AS statement
           WHERE statement.tenant_id = org.tenant_id AND statement.organisation_id = org.id
           ORDER BY statement.as_of DESC LIMIT 1), 0)),
      'packets', COALESCE((
          SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                   'ref',   packet.ref,
                   'state', packet.panel_state::text)
                 || CASE WHEN packet.deadline_at IS NULL THEN '{}'::jsonb
                         ELSE pg_catalog.jsonb_build_object('daysRemaining',
                                (packet.deadline_at::date - CURRENT_DATE)) END
                 ORDER BY packet.deadline_at NULLS LAST)
            FROM core.hrdc_packets AS packet
           WHERE packet.tenant_id = org.tenant_id
             AND packet.organisation_id = org.id
             AND packet.voided_at IS NULL), '[]'::jsonb))
  END AS hrdc,
  -- 020 · appended (CREATE OR REPLACE VIEW may only add columns at the end).
  org.ref AS organisation_ref
FROM core.organisations AS org
-- 020 · the 002 read permission; empty for a caller without it.
WHERE (SELECT app.has_permission('organisation:read'));

-- ── 3b · The AI budget and tier row sources, in core ──────────────────────
--
-- Same body as 018's `app._budget_rows` / `app._model_tier_rows`, plus the
-- permission predicate. SECURITY DEFINER only to cross into `app.usage_rollup`
-- (read by `core.budget_status`). The tenant is derived here and is never an
-- argument. Reachable as an RPC because it sits in `core`, and that is harmless:
-- it returns exactly what the view shows the same caller.

CREATE OR REPLACE FUNCTION core.ai_budget_rows()
RETURNS TABLE (scope text, key text, cap_sen bigint, currency text,
               spend_sen bigint, state text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
  SELECT b.scope::text, b.key, b.cap_sen, b.currency::text, b.spend_sen, b.state::text
    FROM core.budget_status AS b
   WHERE b.tenant_id = app.require_tenant_id()
     AND app.has_permission('ai:budget:read');
$fn$;

CREATE OR REPLACE FUNCTION core.ai_model_tier_rows()
RETURNS TABLE (tier_key text, model text, provider text, routing text,
               fallback_chain text[], cache_strategy text, max_output_tokens integer,
               allowed_hours bit(24), monthly_cap_sen bigint, currency text,
               status text, degraded_since timestamptz, degraded_reason text,
               active_fallback_tier text, spend_sen bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
  SELECT t.tier_key, t.model, t.provider::text, t.routing::text, t.fallback_chain,
         t.cache_strategy::text, t.max_output_tokens, t.allowed_hours,
         t.monthly_cap_sen, t.currency::text, t.status::text,
         t.degraded_since, t.degraded_reason, t.active_fallback_tier,
         budget.spend_sen
    FROM core.model_tier_status AS t
    LEFT JOIN core.budget_status AS budget
           ON budget.tenant_id = t.tenant_id
          AND budget.scope = 'TIER'
          AND budget.key = t.tier_key
   WHERE t.tenant_id = app.require_tenant_id()
     AND app.has_permission('ai:tier:read');
$fn$;

REVOKE ALL ON FUNCTION core.ai_budget_rows()     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.ai_model_tier_rows() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION core.ai_budget_rows()     TO authenticated;
GRANT EXECUTE ON FUNCTION core.ai_model_tier_rows() TO authenticated;

CREATE OR REPLACE VIEW core.v_budgets
WITH (security_invoker = true) AS
SELECT rows.scope,
       rows.key,
       pg_catalog.jsonb_build_object('amount', rows.cap_sen,
         'currency', COALESCE(pg_catalog.rtrim(rows.currency), 'MYR')) AS cap,
       pg_catalog.jsonb_build_object('amount', rows.spend_sen,
         'currency', COALESCE(pg_catalog.rtrim(rows.currency), 'MYR')) AS spend,
       rows.state
  FROM core.ai_budget_rows() AS rows;

DROP VIEW core.v_model_tiers;

CREATE VIEW core.v_model_tiers
WITH (security_invoker = true) AS
SELECT tier.tier_key                              AS key,
       tier.model,
       tier.provider,
       tier.routing,
       tier.fallback_chain                        AS "fallbackChain",
       tier.cache_strategy                        AS "cacheStrategy",
       tier.max_output_tokens                     AS "maxOutputTokens",
       -- `AllowedHourWindow` is `[start, end]`: each maximal run of set bits,
       -- half-open, bit n being MYT hour n (013:1254). All 24 set is [[0,24]].
       (SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(run.start_hour, run.end_hour)
                                             ORDER BY run.start_hour), '[]'::jsonb)
          FROM (SELECT pg_catalog.min(hours.h) AS start_hour, pg_catalog.max(hours.h) + 1 AS end_hour
                  FROM (SELECT h, h - pg_catalog.row_number() OVER (ORDER BY h) AS island
                          FROM pg_catalog.generate_series(0, 23) AS h
                         WHERE pg_catalog.get_bit(tier.allowed_hours, h) = 1) AS hours
                 GROUP BY hours.island) AS run)  AS "allowedHours",
       CASE WHEN tier.monthly_cap_sen IS NULL THEN NULL
            ELSE pg_catalog.jsonb_build_object('amount', tier.monthly_cap_sen,
                   'currency', COALESCE(pg_catalog.rtrim(tier.currency), 'MYR')) END AS "monthlyCap",
       CASE WHEN tier.spend_sen IS NULL THEN NULL
            ELSE pg_catalog.jsonb_build_object('amount', tier.spend_sen,
                   'currency', COALESCE(pg_catalog.rtrim(tier.currency), 'MYR')) END AS spend,
       tier.status,
       CASE WHEN tier.degraded_since IS NULL THEN NULL
            ELSE pg_catalog.jsonb_build_object(
                   'since',          tier.degraded_since,
                   'reason',         tier.degraded_reason,
                   'activeFallback', tier.active_fallback_tier)
       END                                        AS degradation
  FROM core.ai_model_tier_rows() AS tier;

REVOKE ALL ON core.v_budgets     FROM PUBLIC, anon;
REVOKE ALL ON core.v_model_tiers FROM PUBLIC, anon;
GRANT SELECT ON core.v_budgets     TO authenticated;
GRANT SELECT ON core.v_model_tiers TO authenticated;

COMMENT ON VIEW core.v_budgets IS
  'VIEW_READS.aiBudgets (contract Budget). security_invoker; rows come from '
  'core.ai_budget_rows(), a definer that derives the tenant and requires '
  'ai:budget:read. 018, repaired by 020 so authenticated can read it.';
COMMENT ON VIEW core.v_model_tiers IS
  'VIEW_READS.aiTiers (contract ModelTier). security_invoker; rows come from '
  'core.ai_model_tier_rows(), a definer that derives the tenant and requires '
  'ai:tier:read. allowedHours is [start,end) windows derived from the bit(24). 020.';

-- ── 4a · Templates, policies, saved views ──────────────────────────────────

CREATE VIEW core.v_templates
WITH (security_invoker = true) AS
SELECT template.id::text                     AS id,
       template.template_type::text          AS type,
       template.version,
       template.label,
       COALESCE(template.merge_fields, ARRAY[]::text[]) AS "mergeFields",
       (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                 'n', section.n, 'title', section.title, 'aiEnabled', section.ai_enabled)
               ORDER BY section.n)
          FROM core.template_sections AS section
         WHERE section.tenant_id = template.tenant_id
           AND section.template_id = template.id) AS sections,
       template.category::text               AS category,
       CASE WHEN template.rate_per_message_sen IS NULL THEN NULL
            ELSE pg_catalog.jsonb_build_object('amount', template.rate_per_message_sen,
                                               'currency', 'MYR') END AS "ratePerMessage"
  FROM core.templates AS template
 WHERE template.status <> 'RETIRED'
   AND (SELECT app.has_permission('template:read'))
 ORDER BY template.template_type, template.label, template.version DESC;

CREATE VIEW core.v_policies
WITH (security_invoker = true) AS
SELECT policy.id,
       policy.action_type                    AS "actionType",
       policy.description,
       policy.conditions,
       policy.combinator,
       policy.approver_role                  AS "approverRole",
       policy.sla_minutes                    AS "slaMinutes",
       policy.escalate_to_role               AS "escalateToRole",
       policy.escalate_after_minutes         AS "escalateAfterMinutes"
  FROM core.action_policies AS policy
 WHERE policy.active
   AND policy.effective_from <= pg_catalog.now()
   AND (policy.effective_to IS NULL OR policy.effective_to > pg_catalog.now())
   AND (SELECT app.has_permission('policy:read'))
 ORDER BY policy.id;

-- `count` is the SAME number the list header shows, because it is the list
-- RPC's own `page.total` for that view: one filter engine, not two. LEAD has no
-- list RPC in 001–020, so its count is NULL rather than a number nobody
-- computed. PRIVATE views are the owner's; TEAM views the owner's team's.
CREATE VIEW core.v_saved_views
WITH (security_invoker = true) AS
SELECT saved.id::text                        AS id,
       saved.label,
       saved.object::text                    AS object,
       CASE saved.object::text
         WHEN 'ENQUIRY'  THEN (core.list_enquiries('[]'::jsonb, NULL, '{"size":1}'::jsonb, saved.id::text)
                               #>> '{data,page,total}')::integer
         WHEN 'APPROVAL' THEN (core.list_approvals('[]'::jsonb, NULL, '{"size":1}'::jsonb, saved.id::text)
                               #>> '{data,page,total}')::integer
       END                                   AS count,
       saved.is_default                      AS "isDefault",
       saved.filters,
       COALESCE(saved.columns, ARRAY[]::text[]) AS columns
  FROM core.saved_views AS saved
 WHERE saved.deleted_at IS NULL
   AND (saved.visibility = 'TENANT'
        OR saved.owner_id = (SELECT auth.uid())
        OR (saved.visibility = 'TEAM'
            AND saved.owner_id = ANY ((SELECT app.my_team_user_ids())::uuid[])))
   AND (SELECT app.has_permission('view:read'))
 ORDER BY saved.object, saved.is_default DESC, saved.label;

-- ── 4b · People: trainers, contacts, consent ───────────────────────────────

CREATE VIEW core.v_trainers
WITH (security_invoker = true) AS
SELECT trainer.id::text                      AS id,
       trainer.ref,
       trainer.name,
       trainer.email::text                   AS email,
       trainer.band::text                    AS bands,
       trainer.ttt_certified                 AS "tttCertified",
       trainer.ttt_ref                       AS "tttRef",
       trainer.ttt_valid_to                  AS "tttValidTo",
       trainer.hrd_tdf                       AS "hrdTdf",
       trainer.rating,
       COALESCE((SELECT pg_catalog.array_agg(programme.ref ORDER BY programme.ref)
                   FROM core.programme_trainers AS pool
                   JOIN core.programmes AS programme
                     ON programme.tenant_id = pool.tenant_id AND programme.id = pool.programme_id
                  WHERE pool.tenant_id = trainer.tenant_id AND pool.trainer_id = trainer.id),
                ARRAY[]::text[])             AS "programmeRefs",
       COALESCE((SELECT pg_catalog.array_agg(DISTINCT day::date::text ORDER BY day::date::text)
                   FROM core.trainer_bookings AS booking
                  CROSS JOIN LATERAL pg_catalog.generate_series(
                          booking.starts_on::timestamp, booking.ends_on::timestamp, interval '1 day') AS day
                  WHERE booking.tenant_id = trainer.tenant_id
                    AND booking.trainer_id = trainer.id
                    AND booking.state IN ('SOFT_HOLD','CONFIRMED')),
                ARRAY[]::text[])             AS "bookedDates",
       (SELECT pg_catalog.max(engagement.ends_on)::timestamptz
          FROM core.trainer_bookings AS booking
          JOIN core.engagements AS engagement
            ON engagement.tenant_id = booking.tenant_id AND engagement.id = booking.engagement_id
         WHERE booking.tenant_id = trainer.tenant_id
           AND booking.trainer_id = trainer.id
           AND booking.state = 'CONFIRMED'
           AND engagement.status IN ('DELIVERED','CLOSED')) AS "lastDeliveredAt"
  FROM core.trainers AS trainer
 WHERE trainer.status <> 'RETIRED'
   AND (SELECT app.has_permission('trainer:read'))
 ORDER BY trainer.name;

CREATE VIEW core.v_contacts
WITH (security_invoker = true) AS
SELECT contact.id::text                      AS id,
       contact.ref,
       contact.created_at                    AS "createdAt",
       contact.updated_at                    AS "updatedAt",
       pg_catalog.jsonb_build_object(
         'kind', contact.created_by_kind::text,
         'id',   contact.created_by_id,
         'name', COALESCE(contact.created_by_name, contact.created_by_id)) AS "createdBy",
       organisation.ref                      AS "organisationRef",
       contact.name,
       COALESCE(contact.job_title, '')       AS role,
       contact.email::text                   AS email,
       contact.phone,
       contact.is_primary                    AS "primary",
       pg_catalog.jsonb_build_object(
         'email',    COALESCE((SELECT consent.effective_granted FROM core.v_contact_consent_current AS consent
                                WHERE consent.tenant_id = contact.tenant_id AND consent.contact_id = contact.id
                                  AND consent.channel = 'EMAIL'), false),
         'whatsapp', COALESCE((SELECT consent.effective_granted FROM core.v_contact_consent_current AS consent
                                WHERE consent.tenant_id = contact.tenant_id AND consent.contact_id = contact.id
                                  AND consent.channel = 'WHATSAPP'), false)) AS consent,
       contact.pdpa_flag                     AS "pdpaFlag"
  FROM core.contacts AS contact
  JOIN core.organisations AS organisation
    ON organisation.tenant_id = contact.tenant_id AND organisation.id = contact.organisation_id
 WHERE contact.redacted_at IS NULL
   AND (SELECT app.has_permission('contact:read'))
 ORDER BY contact.name;

-- 005's `v_contact_consent_current` is the ledger summary other packs read, with
-- snake_case columns and both `granted` and `effective_granted`. It is not
-- renamed. This view is the contract's `ChannelConsent`, where `granted` MEANS
-- effective: a withdrawn consent is not a consent.
CREATE VIEW core.v_contact_channel_consents
WITH (security_invoker = true) AS
SELECT consent.channel::text                 AS channel,
       consent.effective_granted             AS granted,
       consent.recorded_at                   AS "recordedAt",
       consent.contact_id,
       contact.ref                           AS contact_ref
  FROM core.v_contact_consent_current AS consent
  JOIN core.contacts AS contact
    ON contact.tenant_id = consent.tenant_id AND contact.id = consent.contact_id
 WHERE contact.redacted_at IS NULL
   AND (SELECT app.has_permission('contact:consent:read'))
 ORDER BY consent.contact_id, consent.channel;

-- ── 4c · Catalogue: programmes and their deliveries ────────────────────────

CREATE VIEW core.v_programmes
WITH (security_invoker = true) AS
SELECT d ->> 'id'          AS id,
       d ->> 'ref'         AS ref,
       d -> 'createdAt'    AS "createdAt",
       d -> 'updatedAt'    AS "updatedAt",
       d -> 'createdBy'    AS "createdBy",
       d ->> 'name'        AS name,
       d ->> 'category'    AS category,
       d -> 'days'         AS days,
       d -> 'version'      AS version,
       d ->> 'status'      AS status,
       d ->> 'hrdcScheme'  AS "hrdcScheme",
       d -> 'hrdcClaimable' AS "hrdcClaimable",
       d -> 'listPrice'    AS "listPrice",
       d -> 'listPricePax' AS "listPricePax",
       d -> 'floorPrice'   AS "floorPrice",
       d -> 'floorMarginRate' AS "floorMarginRate",
       d -> 'outcomes'     AS outcomes,
       d -> 'modules'      AS modules,
       d -> 'pricingTiers' AS "pricingTiers",
       d -> 'trainerPool'  AS "trainerPool",
       d -> 'materials'    AS materials,
       d -> 'stats'        AS stats
  FROM core.programmes AS programme
 CROSS JOIN LATERAL (SELECT core.get_programme(programme.id::text) AS envelope) AS read
 CROSS JOIN LATERAL (SELECT read.envelope -> 'data' AS d) AS projected
 WHERE programme.archived_at IS NULL
   AND read.envelope -> 'success' = 'true'::jsonb
   AND (SELECT app.has_permission('programme:read'))
 ORDER BY programme.name;

-- A delivery is an engagement of the programme that has been delivered.
-- `evaluation` is on the 5-point scale the programme rollup uses
-- (`programmes.average_evaluation` numeric(3,2); fixture 4.6), converted from
-- `evaluation_responses.overall_score`, which 017 bounds to 0..1. NULL when no
-- response has been submitted.
CREATE VIEW core.v_programme_deliveries
WITH (security_invoker = true) AS
SELECT engagement.programme_id,
       programme.ref                         AS programme_ref,
       engagement.ref                        AS "engagementRef",
       organisation.ref                      AS "organisationRef",
       organisation.name                     AS "organisationName",
       COALESCE(engagement.starts_on::text, '') ||
         CASE WHEN engagement.ends_on IS NULL THEN ''
              ELSE '/' || engagement.ends_on::text END AS dates,
       (SELECT pg_catalog.count(*)::integer FROM core.participants AS participant
         WHERE participant.tenant_id = engagement.tenant_id
           AND participant.engagement_id = engagement.id
           AND participant.withdrawn_at IS NULL) AS pax,
       (SELECT pg_catalog.round(pg_catalog.avg(response.overall_score) * 5, 1)
          FROM core.evaluation_responses AS response
         WHERE response.tenant_id = engagement.tenant_id
           AND response.engagement_id = engagement.id) AS evaluation,
       pg_catalog.jsonb_build_object('amount', COALESCE(engagement.value_sen, 0),
         'currency', COALESCE(pg_catalog.rtrim(engagement.currency::text), 'MYR')) AS value
  FROM core.engagements AS engagement
  JOIN core.programmes AS programme
    ON programme.tenant_id = engagement.tenant_id AND programme.id = engagement.programme_id
  JOIN core.organisations AS organisation
    ON organisation.tenant_id = engagement.tenant_id AND organisation.id = engagement.organisation_id
 WHERE engagement.status IN ('DELIVERED','CLOSED')
   AND (SELECT app.has_permission('programme:read'))
 ORDER BY engagement.starts_on DESC NULLS LAST;

-- ── 4d · HRD Corp, collections, compliance ─────────────────────────────────

-- One row per live packet with a deadline. `status` is the packet's panel
-- state in the contract's spelling (`DEADLINE_AT_RISK` → `AT_RISK`).
CREATE VIEW core.v_hrdc_deadlines
WITH (security_invoker = true) AS
SELECT engagement.ref                        AS "engagementRef",
       organisation.ref                      AS "organisationRef",
       packet.deadline_at                    AS "deadlineAt",
       (packet.deadline_at::date - CURRENT_DATE) AS "daysRemaining",
       CASE packet.panel_state::text
         WHEN 'DEADLINE_AT_RISK' THEN 'AT_RISK'
         ELSE packet.panel_state::text END   AS status,
       COALESCE(packet.deadline_severity::text, 'INFO') AS severity
  FROM core.hrdc_packets AS packet
  JOIN core.engagements AS engagement
    ON engagement.tenant_id = packet.tenant_id AND engagement.id = packet.engagement_id
  JOIN core.organisations AS organisation
    ON organisation.tenant_id = packet.tenant_id AND organisation.id = packet.organisation_id
 WHERE packet.voided_at IS NULL
   AND packet.deadline_at IS NOT NULL
   AND (SELECT app.has_permission('hrdc:read'))
 ORDER BY packet.deadline_at;

CREATE VIEW core.v_collection_rules
WITH (security_invoker = true) AS
SELECT rule.stage::text                      AS stage,
       rule.trigger_days_overdue             AS "afterDays",
       rule.channel::text                    AS channel,
       rule.autonomy::text                   AS autonomy,
       rule.requires_role::text              AS "requiresApprovalFromRole"
  FROM core.collection_rules AS rule
 WHERE (SELECT app.has_permission('collection:read'))
 ORDER BY rule.trigger_days_overdue;

CREATE VIEW core.v_compliance_rules
WITH (security_invoker = true) AS
SELECT d ->> 'id'          AS id,
       d ->> 'scheme'      AS scheme,
       d ->> 'subject'     AS subject,
       d -> 'expression'   AS expression,
       d -> 'effectiveFrom' AS "effectiveFrom",
       d -> 'effectiveTo'  AS "effectiveTo",
       d ->> 'status'      AS status,
       d -> 'source'       AS source,
       d ->> 'supersedesId'   AS "supersedesId",
       d ->> 'supersededById' AS "supersededById",
       d -> 'usedByChecks' AS "usedByChecks",
       d -> 'affectedOpenEngagements' AS "affectedOpenEngagements",
       d -> 'verifiedBy'   AS "verifiedBy",
       d -> 'verifiedAt'   AS "verifiedAt",
       d -> 'provenance'   AS provenance
  FROM core.compliance_rules AS rule
 CROSS JOIN LATERAL (SELECT core.get_compliance_rule(rule.id::text) AS envelope) AS read
 CROSS JOIN LATERAL (SELECT read.envelope -> 'data' AS d) AS projected
 WHERE read.envelope -> 'success' = 'true'::jsonb
   AND (SELECT app.has_permission('compliance:rule:read'))
 ORDER BY rule.scheme_key, rule.rule_code, rule.effective_from;

CREATE VIEW core.v_rule_change_sets
WITH (security_invoker = true) AS
SELECT change_set.document_id                AS "documentId",
       change_set.title,
       change_set.published_at               AS "publishedAt",
       change_set.ingested_at                AS "ingestedAt",
       pg_catalog.jsonb_build_object(
         'model',      change_set.extracted_by_model,
         'confidence', change_set.extraction_confidence,
         'runId',      change_set.run_id::text) AS "extractedBy",
       change_set.effective_from             AS "effectiveFrom",
       COALESCE((
         SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                  'id',           change.id::text,
                  'op',           change.op::text,
                  'targetRuleId', change.target_rule_id::text,
                  'newRuleId',    change.new_rule_id::text,
                  'before',       change.before_text,
                  'after',        change.after_text,
                  'sourceSpan',   pg_catalog.jsonb_build_object(
                                    'page',    change.source_page,
                                    'section', change.source_section,
                                    'excerpt', change.source_excerpt),
                  'confidence',   change.confidence,
                  'affectedEngagements', COALESCE((
                    SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('ref', engagement.ref)
                                                ORDER BY engagement.ref)
                      FROM core.rule_change_affected_engagements AS affected
                      JOIN core.engagements AS engagement
                        ON engagement.tenant_id = affected.tenant_id
                       AND engagement.id = affected.engagement_id
                     WHERE affected.tenant_id = change.tenant_id
                       AND affected.rule_change_id = change.id), '[]'::jsonb),
                  'status',       change.status)
                ORDER BY change.change_key, change.id)
           FROM core.rule_changes AS change
          WHERE change.tenant_id = change_set.tenant_id
            AND change.rule_change_set_id = change_set.id), '[]'::jsonb) AS changes
  FROM core.rule_change_sets AS change_set
 WHERE (SELECT app.has_permission('compliance:rule:read'))
 ORDER BY change_set.ingested_at DESC;

-- ── 4e · Agents and knowledge ──────────────────────────────────────────────

-- `AgentEval` is a dashboard ROW per agent, not an evaluation record: the mean
-- score and sample size over the trailing 30 days, labelled `30d` as the
-- fixture labels it.
CREATE VIEW core.v_agent_evals
WITH (security_invoker = true) AS
SELECT eval.agent_id                         AS "agentId",
       '30d'::text                           AS "window",
       pg_catalog.round(pg_catalog.avg(eval.score), 3) AS score,
       pg_catalog.count(*)::integer          AS "sampleSize",
       NULL::jsonb                           AS provenance
  FROM core.evals AS eval
 WHERE eval.evaluated_at >= pg_catalog.now() - interval '30 days'
   AND eval.score IS NOT NULL
   AND (SELECT app.has_permission('eval:read'))
 GROUP BY eval.agent_id
 ORDER BY eval.agent_id;

CREATE VIEW core.v_knowledge_sources
WITH (security_invoker = true) AS
SELECT source.id::text                       AS id,
       source.name,
       source.source_type::text              AS type,
       source.version,
       source.ingested_at                    AS "ingestedAt",
       source.chunk_count                    AS chunks,
       source.embedding_status::text         AS "embeddingStatus",
       source.last_checked_at                AS "lastCheckedAt",
       source.monitor_status::text           AS "monitorStatus",
       source.content_hash                   AS "contentHash",
       COALESCE(source.retrieval_scopes::text[], ARRAY[]::text[]) AS "retrievalScopes",
       (SELECT change_set.id::text FROM core.rule_change_sets AS change_set
         WHERE change_set.tenant_id = source.tenant_id
           AND change_set.knowledge_source_id = source.id
         ORDER BY change_set.ingested_at DESC, change_set.id DESC
         LIMIT 1)                            AS "ruleChangeSetId"
  FROM core.knowledge_sources AS source
 WHERE source.archived_at IS NULL
   AND (SELECT app.has_permission('knowledge:source:read'))
 ORDER BY source.name;

DO $view_grants$
DECLARE v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
      'v_templates','v_policies','v_saved_views','v_trainers','v_contacts',
      'v_contact_channel_consents','v_programmes','v_programme_deliveries',
      'v_hrdc_deadlines','v_collection_rules','v_compliance_rules',
      'v_rule_change_sets','v_agent_evals','v_knowledge_sources']
  LOOP
    EXECUTE pg_catalog.format('REVOKE ALL ON core.%I FROM PUBLIC, anon', v_name);
    EXECUTE pg_catalog.format('GRANT SELECT ON core.%I TO authenticated', v_name);
    EXECUTE pg_catalog.format(
      'COMMENT ON VIEW core.%I IS %L', v_name,
      'VIEW_READS in apps/web/src/shared/api/rpcClient.ts; columns are the contract keys. '
      'security_invoker, so 014''s tenant policies apply to the caller, and empty for a '
      'caller without the 002 read permission. 020.');
  END LOOP;
END
$view_grants$;

-- ═══ 5 · Grants ════════════════════════════════════════════════════════════
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

-- ═══ 6 · $verify$ — structural, off the catalogue ══════════════════════════

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

-- ═══ 7 · $verify$ — the views a browser reads ══════════════════════════════

DO $verify_views$
DECLARE
  v_bad text[];
BEGIN
  -- V5 · EVERY client-readable view is security_invoker and granted.
  SELECT pg_catalog.array_agg(v.name ORDER BY v.name) INTO v_bad
    FROM (VALUES ('v_organisation_relations'),('v_budgets'),('v_model_tiers'),
                 ('v_templates'),('v_policies'),('v_saved_views'),('v_trainers'),
                 ('v_contacts'),('v_contact_channel_consents'),('v_programmes'),
                 ('v_programme_deliveries'),('v_hrdc_deadlines'),('v_collection_rules'),
                 ('v_compliance_rules'),('v_rule_change_sets'),('v_agent_evals'),
                 ('v_knowledge_sources')) AS v(name)
    LEFT JOIN pg_catalog.pg_class AS c
           ON c.relname = v.name AND c.relkind = 'v'
          AND c.relnamespace = 'core'::regnamespace
   WHERE c.oid IS NULL
      OR NOT ('security_invoker=true' = ANY (COALESCE(c.reloptions, ARRAY[]::text[])))
      OR NOT pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT')
      OR pg_catalog.has_table_privilege('anon', c.oid, 'SELECT');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '020 verify V5: view(s) missing, not security_invoker, or wrongly granted: %', v_bad;
  END IF;

  -- V6 · NO client view depends on a function `authenticated` cannot execute.
  -- This is the exact defect §3 repairs, asserted off pg_depend rather than
  -- off the DDL text, so it covers every view in `core`, not only 020's.
  SELECT pg_catalog.array_agg(DISTINCT c.relname || ' -> ' || p.oid::regprocedure::text) INTO v_bad
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_rewrite AS r ON r.ev_class = c.oid
    JOIN pg_catalog.pg_depend AS d ON d.objid = r.oid AND d.classid = 'pg_catalog.pg_rewrite'::regclass
                                  AND d.refclassid = 'pg_catalog.pg_proc'::regclass
    JOIN pg_catalog.pg_proc AS p ON p.oid = d.refobjid
   WHERE c.relnamespace = 'core'::regnamespace
     AND c.relkind = 'v'
     AND pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT')
     AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '020 verify V6: a client-readable view calls a function authenticated cannot execute: %', v_bad;
  END IF;

  -- V7 · The two new definer row sources: posture, and nothing in app granted.
  SELECT pg_catalog.array_agg(p.proname) INTO v_bad
    FROM pg_catalog.pg_proc AS p
   WHERE p.pronamespace = 'core'::regnamespace
     AND p.proname IN ('ai_budget_rows','ai_model_tier_rows')
     AND NOT (p.prosecdef
              AND p.proconfig @> ARRAY['search_path=""']
              AND p.proconfig @> ARRAY['statement_timeout=10s']
              AND pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
              AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'));
  IF v_bad IS NOT NULL OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
                             WHERE p.pronamespace = 'core'::regnamespace
                               AND p.proname IN ('ai_budget_rows','ai_model_tier_rows')) <> 2 THEN
    RAISE EXCEPTION '020 verify V7: core.ai_*_rows posture wrong: %', v_bad;
  END IF;
  IF pg_catalog.has_function_privilege('authenticated', 'app._money(bigint,text)'::regprocedure, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'app._budget_rows()'::regprocedure, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'app._model_tier_rows()'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '020 verify V7b: an app internal was granted to authenticated';
  END IF;
END
$verify_views$;

COMMIT;
