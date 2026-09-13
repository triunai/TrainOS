-- ═══════════════════════════════════════════════════════════════════════════
-- 020 ROLLBACK · The API read surface
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Restores the database to exactly what 019 left. Every 018 object 020
-- replaced is re-created here from 018's text, IN FULL, not by reference.
--
-- ORDER, the reverse of the forward file:
--   1. drop the fourteen views 020 created, and the two 018 views whose shape it changed
--   2. re-create the 018 functions and views 020 replaced, then drop its two row sources
--   3. restate 018's grants and comments on them
--   4. verify: no `diffHash` projection, no 020-only object left
--
-- Wrapped in one transaction: a rollback that fails half way leaves a state
-- neither file describes.
--
-- WHAT A ROLLBACK BRINGS BACK, said out loud: the approval list and detail stop
-- emitting `diffHash`, so every APPROVE from the web is refused again, and the
-- three 018 views raise 42501 for `authenticated` again. No data is touched.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL client_min_messages = warning;

-- ═══ 1 · Drop what 020 created ═════════════════════════════════════════════
--
-- The fourteen VIEW_READS views first (nothing depends on them), then the two
-- 018 views whose shape 020 changed. `v_organisation_relations` gained a column
-- and `v_model_tiers` changed a column's type; CREATE OR REPLACE VIEW can do
-- neither in reverse, so both are dropped and re-created from 018's text in §2.
-- `v_budgets` is re-pointed at 018's `app._budget_rows()` in §2 BEFORE the
-- `core.ai_*_rows()` functions it currently reads are dropped in §2b.

DROP VIEW IF EXISTS core.v_templates;
DROP VIEW IF EXISTS core.v_policies;
DROP VIEW IF EXISTS core.v_saved_views;
DROP VIEW IF EXISTS core.v_trainers;
DROP VIEW IF EXISTS core.v_contacts;
DROP VIEW IF EXISTS core.v_contact_channel_consents;
DROP VIEW IF EXISTS core.v_programmes;
DROP VIEW IF EXISTS core.v_programme_deliveries;
DROP VIEW IF EXISTS core.v_hrdc_deadlines;
DROP VIEW IF EXISTS core.v_collection_rules;
DROP VIEW IF EXISTS core.v_compliance_rules;
DROP VIEW IF EXISTS core.v_rule_change_sets;
DROP VIEW IF EXISTS core.v_agent_evals;
DROP VIEW IF EXISTS core.v_knowledge_sources;
DROP VIEW IF EXISTS core.v_model_tiers;
DROP VIEW IF EXISTS core.v_organisation_relations;

-- ═══ 2 · The 018 definitions, reproduced in full ═════════════════════════

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

CREATE OR REPLACE FUNCTION core.get_audit(p_resource_type text, p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
  v_rows   jsonb;
BEGIN
  -- `p_resource_type` is a PLAIN STRING, not a closed union: the audit drawer
  -- is drawn on every record screen and the trail is addressed
  -- `approvals::{ref}`, `proposals::{ref}`. Closing the vocabulary here would
  -- make the drawer refuse every record type nobody had thought of yet.
  --
  -- A RESOURCE WITH NO TRAIL RETURNS AN EMPTY LIST, NOT A 404. An audit drawer
  -- on a record that has not been touched is empty, and that is a true
  -- statement about the record; a 404 would say the record does not exist.
  SELECT COALESCE(pg_catalog.jsonb_agg(entry.item ORDER BY entry.at DESC), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT audit.at,
             pg_catalog.jsonb_build_object(
               'at',      audit.at,
               'actor',   audit.actor,
               'event',   audit.event,
               'summary', COALESCE(audit.summary, audit.event))
             || CASE WHEN audit.run_id IS NULL THEN '{}'::jsonb
                     ELSE pg_catalog.jsonb_build_object('runId', audit.run_id) END AS item
        FROM core.audit_entries AS audit
       WHERE audit.tenant_id = v_tenant
         AND audit.subject_type = p_resource_type
         AND (audit.subject_id::text = p_id OR audit.aggregate_ref = p_id)
    ) AS entry;

  -- Newest first, and the caller cannot choose otherwise: the client sends no
  -- page arguments for this endpoint, so the order is the server's to fix.
  RETURN app.ok(pg_catalog.jsonb_build_object(
    'data', v_rows,
    'page', pg_catalog.jsonb_build_object(
      'next', NULL, 'total', pg_catalog.jsonb_array_length(v_rows))));
END;
$fn$;

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
             'value', app._money(COALESCE(engagement.value_sen, 0), engagement.currency::text),
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
             'amount', app._money(COALESCE(invoice.total_sen, 0), invoice.currency::text))
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
      'levyAvailable', app._money(COALESCE((
          SELECT statement.levy_available_sen FROM core.hrdc_levy_statements AS statement
           WHERE statement.tenant_id = org.tenant_id AND statement.organisation_id = org.id
           ORDER BY statement.as_of DESC LIMIT 1), 0), 'MYR'),
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
  END AS hrdc
FROM core.organisations AS org;

CREATE OR REPLACE VIEW core.v_budgets
WITH (security_invoker = true) AS
SELECT rows.scope,
       rows.key,
       app._money(rows.cap_sen,   rows.currency) AS cap,
       app._money(rows.spend_sen, rows.currency) AS spend,
       rows.state
  FROM app._budget_rows() AS rows;

CREATE OR REPLACE VIEW core.v_model_tiers
WITH (security_invoker = true) AS
SELECT tier.tier_key                              AS key,
       tier.model,
       tier.provider,
       tier.routing,
       tier.fallback_chain                        AS "fallbackChain",
       tier.cache_strategy                        AS "cacheStrategy",
       tier.max_output_tokens                     AS "maxOutputTokens",
       tier.allowed_hours                         AS "allowedHours",
       app._money(tier.monthly_cap_sen, tier.currency::text) AS "monthlyCap",
       tier.status,
       -- `degradation` is OPTIONAL and is emitted only when the tier is
       -- actually degraded: an object full of nulls beside a healthy tier
       -- reads as a fault that is not there.
       CASE WHEN tier.degraded_since IS NULL THEN NULL
            ELSE pg_catalog.jsonb_build_object(
                   'since',  tier.degraded_since,
                   'reason', tier.degraded_reason,
                   'activeFallbackTier', tier.active_fallback_tier)
       END                                        AS degradation
  FROM app._model_tier_rows() AS tier;

-- ═══ 2b · The two row sources 020 added, now that nothing reads them ═══════

DROP FUNCTION IF EXISTS core.ai_budget_rows();
DROP FUNCTION IF EXISTS core.ai_model_tier_rows();

-- ═══ 3 · 018's grants on what was restored ═════════════════════════════════

REVOKE ALL ON FUNCTION core.list_approvals(jsonb, text, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.get_approval(text)                      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.get_audit(text, text)                   FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION core.list_approvals(jsonb, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_approval(text)                      TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_audit(text, text)                   TO authenticated;


-- 018's view grants and comments.
REVOKE ALL ON core.v_budgets      FROM PUBLIC, anon;
REVOKE ALL ON core.v_model_tiers  FROM PUBLIC, anon;
REVOKE ALL ON core.v_organisation_relations FROM PUBLIC, anon;
GRANT SELECT ON core.v_budgets     TO authenticated;
GRANT SELECT ON core.v_model_tiers TO authenticated;
GRANT SELECT ON core.v_organisation_relations TO authenticated;

COMMENT ON VIEW core.v_budgets IS
  'Closes 014 §4''s carried defect. core.budget_status is security_invoker and '
  'reads app.usage_rollup, which authenticated cannot reach, so it is '
  'unreadable no matter what is granted on it. This view carries the name '
  'rpcClient.ts actually reads (VIEW_READS.aiBudgets) and crosses the app '
  'boundary through a definer function that re-derives the tenant itself. 018.';

COMMENT ON VIEW core.v_organisation_relations IS
  'The §5 organisation relations panel, one row per organisation, keyed '
  'organisation_id. security_invoker=true is LOAD-BEARING: without it the view '
  'runs as its owner and returns every tenant''s rows. Read by rpcClient.ts as '
  '.from("v_organisation_relations").select("*").match({organisation_id}); an '
  'empty result is NOT_FOUND because the contract types this as a record.';

-- ═══ 4 · Verify ════════════════════════════════════════════════════════════

DO $verify$
BEGIN
  IF pg_catalog.strpos(app._body_sql('core.list_approvals(jsonb,text,jsonb,text)'::regprocedure), '''diffHash''') > 0
     OR pg_catalog.strpos(app._body_sql('core.get_approval(text)'::regprocedure), '''diffHash''') > 0
     OR pg_catalog.strpos(app._body_sql('core.get_audit(text,text)'::regprocedure), 'APPROVAL_REQUEST') > 0 THEN
    RAISE EXCEPTION '020 rollback verify: a 020 body is still in place';
  END IF;
  IF pg_catalog.to_regclass('core.v_templates') IS NOT NULL
     OR pg_catalog.to_regprocedure('core.ai_budget_rows()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                 WHERE attrelid = 'core.v_organisation_relations'::regclass AND attname = 'organisation_ref') THEN
    RAISE EXCEPTION '020 rollback verify: a 020 view or row source is still in place';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
        JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
       WHERE n.nspname = 'core' AND p.proname IN ('list_approvals','get_approval','get_audit')) <> 3 THEN
    RAISE EXCEPTION '020 rollback verify: expected exactly one definition each';
  END IF;
END
$verify$;

COMMIT;
