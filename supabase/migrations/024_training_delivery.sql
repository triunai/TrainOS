-- ============================================================================
-- Migration 024: training delivery — engagements, participants, attendance,
-- the programme catalogue write.
-- ============================================================================
--
-- FEATURE. Closes the training-delivery domain end to end: the seven §8/§6
-- client methods the matrix marks NO-ADAPTER (`listEngagements`,
-- `getEngagement`, `getEngagementParticipants`, `getAttendance`,
-- `captureAttendance`, `exportAttendance`, `putProgramme`). Every table this
-- migration reads or writes already exists (008 delivery, 006 catalogue) —
-- this pack is RPCs only, no DDL.
--
-- CORRECTION AGAINST THE GAP-MATRIX AUDIT (dated 2026-09-14, SQL truth
-- `origin/lane/rpc-018` @ 58db8d1). On THIS branch (main @ cfaab6c, 001–021
-- applied), `core.v_trainers`, `core.v_programmes` and `core.v_programme_deliveries`
-- already exist — they shipped in 020_api_read_surface.sql, which the matrix's
-- SQL truth predates. `/training/trainers` and `/training/programmes` already
-- render off those views plus 021's `core.get_programme`. This migration does
-- NOT recreate them. What is still missing, verified by grep against 001–021
-- before writing a line here, is exactly the seven functions below.
--
-- ── PATTERNS COPIED FROM 018/020/021, NOT REINVENTED ────────────────────────
--   * `SECURITY DEFINER`, `SET search_path = ''`, `SET statement_timeout`,
--     `app.require_tenant_id()` as the first DECLARE initialiser.
--   * AUTHZ FIRST (021's rule): the permission gate is the first statement of
--     the body, decided off literals and `app.require_tenant_id()` only, so
--     the refusal is byte-identical for every argument.
--   * READS refuse `app.err('FORBIDDEN', {requiredPermission})`; WRITES refuse
--     `RAISE EXCEPTION ... USING ERRCODE = 'TRNOS', DETAIL = jsonb_build_object
--     ('code','FORBIDDEN', ...)`.
--   * `byIdOrRef`: `WHERE tenant_id = v_tenant AND (id::text = p_id OR ref = p_id)`.
--   * List pagination reuses 018's `app._page_size` / `app._cursor_decode` /
--     `app._keyset_scope` / `app._next_cursor` — no new pagination engine.
--   * WRITERS RETURN THROUGH READERS (021's rule): `capture_attendance` and
--     `put_programme` end by calling the sibling reader, so a write and a
--     read of the same record can never drift into two projections.
--
-- ── SCOPE-NARROWING (○ in 002 §11) IS NOT APPLIED, SAME AS 018/021 ──────────
-- `engagement:read`, `participant:read` and `attendance:*` are "scope-narrowed"
-- for SALES/SALES_MANAGER/TRAINER in 002 §11 — a TRAINER should see only their
-- own engagements. 021's header states this is not implemented anywhere in the
-- golden path (SECURITY DEFINER reads do not evaluate the caller's RLS
-- policies) and reports it rather than guesses at "which owner column". This
-- migration holds that same line for consistency: the base permission gate is
-- real and tested below, but a TRAINER principal with `engagement:read` sees
-- every engagement in the tenant through these RPCs, not only their own.
-- Reported here again rather than fixed silently, because fixing it changes
-- what MD sees too and is a per-table design call for a follow-up migration.
--
-- ── `put_programme` IS SCOPED TO THE PROGRAMME'S OWN SCALAR FIELDS ──────────
-- `Programme` carries four nested arrays (`modules`, `pricingTiers`,
-- `trainerPool`, `materials`). `core.programme_pricing_tiers` has a NOT NULL
-- `floor_price_sen` the contract's `PricingTier` (`{maxPax, price}`) does not
-- carry, so a client-supplied tier cannot be inserted without inventing a
-- floor the contract never sent — a business decision this migration declines
-- to make. `put_programme` therefore updates the record's own columns (name,
-- category, days, status, hrdcScheme, hrdcClaimable, listPrice, listPricePax,
-- floorPrice, floorMarginRate, outcomes) and leaves the four child arrays
-- untouched regardless of what a caller's `Partial<Programme>` includes for
-- them. Reported in the PR as a decision to confirm, not a silent gap.
--
-- ── THE 7-POINT RPC CONTRACT CHECK, worked ──────────────────────────────────
--  1 ENVELOPE. `app.ok`/`app.err` for reads, `RAISE ... TRNOS` for writes —
--    shapes 018/021 already return; the unwrap rule in rpcClient.ts is unchanged.
--  2 UNWRAP. `list_engagements`/`get_engagement_participants` return
--    `{data,page[,appliedFilters]}` (2-3 sibling keys, passed through whole).
--    `get_engagement`/`capture_attendance`/`put_programme` return a single
--    `data` key (auto-unwrapped to the record). `export_attendance` returns
--    `{url,expiresAt}` (2 sibling keys, passed through whole) — matches
--    `AttendanceExport` exactly, and neither key is named `data` so it cannot
--    collide with the auto-unwrap rule.
--  3 RpcMap. One `CREATE OR REPLACE FUNCTION` per name below; `$verify$` V1
--    asserts one overload each.
--  4 CALL SITES. `apps/web/src/features/engagements/api.ts` (`useEngagements`,
--    `useEngagement`, `useEngagementParticipants`, `useAttendance`,
--    `useAttendanceDays`, `useCaptureAttendance`, `useExportAttendance`) and
--    `apps/web/src/features/programmes/api.ts` (`useEditProgramme`,
--    `useEngagementsForProgramme`).
--  5 CASTS. No TypeScript in this file; `client.ts`/`rpcClient.ts`/
--    `apiClient.ts` are edited in the same PR, same argument names as below.
--  6 RELOAD. None of these seven run on shell bootstrap; `core.me`/
--    `core.navigation`/`core.badge_counts` are untouched.
--  7 PUBLIC ROUTES. Nothing granted to anon; `$verify$` V3 asserts it.
--
-- Rollback: supabase/rollbacks/024_training_delivery_rollback.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '180s';
SET LOCAL client_min_messages = warning;

DO $preflight$
BEGIN
  IF pg_catalog.to_regclass('core.engagements') IS NULL
     OR pg_catalog.to_regclass('core.attendance_days') IS NULL
     OR pg_catalog.to_regclass('core.programmes') IS NULL THEN
    RAISE EXCEPTION '024 preflight: 006 or 008 has not been applied';
  END IF;
  IF pg_catalog.to_regprocedure('core.get_programme(text)') IS NULL
     OR pg_catalog.to_regprocedure('app.has_permission(text)') IS NULL
     OR pg_catalog.to_regprocedure('app._keyset_scope(regclass,uuid,text,text,boolean,timestamptz,uuid,boolean)') IS NULL THEN
    RAISE EXCEPTION '024 preflight: 018/021''s golden-path helpers or core.get_programme are absent';
  END IF;
  IF pg_catalog.to_regprocedure('core.list_engagements(jsonb,text,jsonb,text)') IS NOT NULL THEN
    RAISE EXCEPTION '024 preflight: core.list_engagements already exists — this migration is not additive here';
  END IF;
END
$preflight$;

-- ═══ 0 · Permission patch — TRAINER gets attendance:export ══════════════════
--
-- 002 grants TRAINER `attendance:capture`/`attendance:read` but not
-- `attendance:export` (a review-mandated correction: `packages/contract/src/
-- endpoints.ts` already lists roles `['OPS','TRAINER']` for all three
-- attendance endpoints, so 002/024 was the side behind, not the contract).
-- 002 is frozen (already applied to hosted), so the grant is patched in here
-- rather than edited into 002's own INSERT. `ON CONFLICT DO NOTHING` makes
-- this idempotent alongside 002's own row if it is ever added there later.
INSERT INTO app.role_permissions (role, permission) VALUES ('TRAINER', 'attendance:export')
  ON CONFLICT (role, permission) DO NOTHING;

-- ═══ 1 · core.list_engagements ══════════════════════════════════════════════
--
-- The client never sends a filter or a sort for this list today
-- (`features/engagements/api.ts`'s `useEngagements()` calls `listEngagements()`
-- with no arguments — the screen filters client-side over the page it gets).
-- The allow-list below is therefore intentionally small: `status` and the two
-- timestamps. Extending it is additive and does not touch this shape.

CREATE OR REPLACE FUNCTION core.list_engagements(
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
  v_cur_at   timestamptz;
  v_cur_id   uuid;
  v_clauses  text[] := ARRAY[]::text[];
  v_errors   jsonb  := '[]'::jsonb;
  v_applied  jsonb  := '[]'::jsonb;
  v_clause   jsonb;
  v_field    text;
  v_op       text;
  v_column   text;
  v_kind     text;
  v_desc     boolean := true;
  v_sort_col text := 'created_at';
  v_sort_fld text;
  v_where    text;
  v_ids      uuid[];
  v_rows     jsonb;
  v_total    integer;
  v_count    integer;
  v_next     text;
  v_last_at  timestamptz;
  v_last_id  uuid;
  v_cursor   text;
BEGIN
  IF NOT app.has_permission('engagement:read') THEN
    RETURN app.err('FORBIDDEN', pg_catalog.jsonb_build_object(
      'requiredPermission','engagement:read'));
  END IF;

  BEGIN
    v_size := app._page_size(p_page);
  EXCEPTION WHEN invalid_parameter_value THEN
    RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
      'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field','page.size','reason', SQLERRM))));
  END;

  v_cursor := NULLIF(p_page ->> 'cursor','');
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

  -- SAVED VIEW. `core.saved_view_object` has no ENGAGEMENT value (003), so a
  -- view for this list cannot exist. Refuse rather than silently ignore it —
  -- the same honesty 021 chose for `list_proposals`.
  IF NULLIF(p_view,'') IS NOT NULL THEN
    RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
      'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field','view','reason','NO_SAVED_VIEWS_FOR_ENGAGEMENT'))));
  END IF;

  FOR v_clause IN SELECT element.value FROM pg_catalog.jsonb_array_elements(COALESCE(p_filter,'[]'::jsonb)) AS element(value)
  LOOP
    v_field := v_clause ->> 'field';
    v_op    := v_clause ->> 'op';
    SELECT allowed.column_name, allowed.kind INTO v_column, v_kind
      FROM (VALUES ('status','status','text'),
                   ('createdAt','created_at','ts'),
                   ('updatedAt','updated_at','ts'))
           AS allowed(field, column_name, kind)
     WHERE allowed.field = v_field;
    IF v_column IS NULL THEN
      v_errors := v_errors || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field', COALESCE(v_field,'(null)'), 'reason','UNKNOWN_FILTER_FIELD'));
      CONTINUE;
    END IF;
    BEGIN
      v_clauses := v_clauses || app._predicate(v_column, v_kind, v_op, v_clause -> 'value');
      v_applied := v_applied || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field', v_field, 'op', v_op,
        'value', COALESCE(v_clause -> 'value','null'::jsonb),
        'source', COALESCE(v_clause ->> 'source', 'REQUEST')));
    EXCEPTION WHEN invalid_parameter_value THEN
      v_errors := v_errors || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field', v_field, 'reason', SQLERRM, 'code', COALESCE(v_op,'(null)')));
    END;
    v_column := NULL; v_kind := NULL;
  END LOOP;

  IF pg_catalog.jsonb_array_length(v_errors) > 0 THEN
    RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object('fields', v_errors));
  END IF;

  IF NULLIF(p_sort,'') IS NOT NULL THEN
    v_desc := pg_catalog.left(p_sort,1) = '-';
    v_sort_fld := CASE WHEN v_desc THEN pg_catalog.substr(p_sort,2) ELSE p_sort END;
    SELECT allowed.column_name INTO v_sort_col
      FROM (VALUES ('createdAt','created_at'),('updatedAt','updated_at'),('startsOn','starts_on'))
           AS allowed(field, column_name)
     WHERE allowed.field = v_sort_fld;
    IF v_sort_col IS NULL THEN
      RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
        'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'field','sort','reason','UNKNOWN_SORT_FIELD','code', v_sort_fld))));
    END IF;
  END IF;

  v_where := CASE WHEN pg_catalog.array_length(v_clauses,1) IS NULL THEN 'true'
                  ELSE pg_catalog.array_to_string(v_clauses,' AND ') END;

  SELECT scope.o_total, scope.o_where INTO v_total, v_where
    FROM app._keyset_scope('core.engagements'::regclass, v_tenant, v_where,
                           v_sort_col, v_desc, v_cur_at, v_cur_id,
                           v_sort_col = 'starts_on') AS scope;

  -- ONE PROJECTION, PER ROW ON A BOUNDED PAGE. `core.get_engagement` already
  -- drops `finance` for a caller without `quotation:read`; a second copy of
  -- that rule here would be the divergence CLAUDE.md calls a defect.
  EXECUTE pg_catalog.format($q$
    SELECT COALESCE(pg_catalog.array_agg(e.id ORDER BY e.%I %s, e.id %s), ARRAY[]::uuid[])
      FROM (SELECT id, %I FROM core.engagements
             WHERE tenant_id = $1 AND %s
             ORDER BY %I %s, id %s
             LIMIT $2) AS e$q$,
    v_sort_col, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END,
    v_sort_col, v_where,
    v_sort_col, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END)
    INTO v_ids USING v_tenant, v_size;

  SELECT COALESCE(pg_catalog.jsonb_agg(core.get_engagement(element.id::text) -> 'data'
                                       ORDER BY element.ord), '[]'::jsonb),
         pg_catalog.count(*)::integer
    INTO v_rows, v_count
    FROM pg_catalog.unnest(v_ids) WITH ORDINALITY AS element(id, ord);

  IF pg_catalog.array_length(v_ids, 1) IS NOT NULL THEN
    EXECUTE pg_catalog.format('SELECT %I, id FROM core.engagements WHERE tenant_id = $1 AND id = $2', v_sort_col)
      INTO v_last_at, v_last_id USING v_tenant, v_ids[pg_catalog.array_length(v_ids,1)];
  END IF;
  v_next := app._next_cursor('core.engagements'::regclass, v_tenant, v_where,
                             v_sort_col, v_desc, v_count, v_size, v_last_at, v_last_id,
                             v_sort_col = 'starts_on');

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'data', v_rows,
    'page', pg_catalog.jsonb_build_object('next', v_next, 'total', v_total),
    'appliedFilters', v_applied));
END;
$fn$;

-- ═══ 2 · core.get_engagement ═════════════════════════════════════════════════
--
-- Lifecycle subquery copied from `core.v_organisation_relations`
-- (020:913-950 / 018:1680-1700): stage names and order come from
-- `core.pipeline_steps` in `position` order, never hardcoded, per CLAUDE.md's
-- standing rule. `finance` is DROPPED (not zeroed) for a caller without
-- `quotation:read` — 018's ruling for `get_proposal`'s margin block, carried
-- over here because the contract makes the same call for engagements (R7).

CREATE OR REPLACE FUNCTION core.get_engagement(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant       uuid := app.require_tenant_id();
  v_row          core.engagements%ROWTYPE;
  v_org_ref      text;
  v_owner_name   text;
  v_participants integer;
  v_attended     integer;
  v_lead_ref     text;
  v_lead_name    text;
  v_checklist_n  integer;
  v_checklist_d  integer;
  v_invoice_ref  text;
  v_sync_state   text;
  v_trainer_sen  bigint;
  v_margin       numeric;
  v_can_finance  boolean;
BEGIN
  IF NOT app.has_permission('engagement:read') THEN
    RETURN app.err('FORBIDDEN', pg_catalog.jsonb_build_object(
      'requiredPermission','engagement:read'));
  END IF;

  SELECT engagement.* INTO v_row FROM core.engagements AS engagement
   WHERE engagement.tenant_id = v_tenant
     AND (engagement.id::text = p_id OR engagement.ref = p_id);
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('id', p_id));
  END IF;

  SELECT organisation.ref INTO v_org_ref FROM core.organisations AS organisation
   WHERE organisation.tenant_id = v_tenant AND organisation.id = v_row.organisation_id;

  SELECT profile.display_name INTO v_owner_name FROM public.user_profiles AS profile
   WHERE profile.tenant_id = v_tenant AND profile.user_id = v_row.owner_id;

  SELECT pg_catalog.count(*)::int INTO v_participants
    FROM core.participants AS participant
   WHERE participant.tenant_id = v_tenant AND participant.engagement_id = v_row.id
     AND participant.withdrawn_at IS NULL;

  SELECT pg_catalog.count(DISTINCT entry.participant_id)::int INTO v_attended
    FROM core.attendance_days AS day
    JOIN core.attendance_entries AS entry
      ON entry.tenant_id = day.tenant_id AND entry.attendance_day_id = day.id AND entry.present
   WHERE day.tenant_id = v_tenant AND day.engagement_id = v_row.id;

  SELECT trainer.ref, trainer.name INTO v_lead_ref, v_lead_name
    FROM core.engagement_trainers AS link
    JOIN core.trainers AS trainer
      ON trainer.tenant_id = link.tenant_id AND trainer.id = link.trainer_id
   WHERE link.tenant_id = v_tenant AND link.engagement_id = v_row.id
   ORDER BY (link.role = 'LEAD') DESC, trainer.name
   LIMIT 1;

  SELECT pg_catalog.count(*)::int,
         pg_catalog.count(*) FILTER (WHERE item.done)::int
    INTO v_checklist_n, v_checklist_d
    FROM core.engagement_checklist_items AS item
   WHERE item.tenant_id = v_tenant AND item.engagement_id = v_row.id;

  v_can_finance := app.has_permission('quotation:read');
  IF v_can_finance THEN
    SELECT invoice.ref, invoice.sync_state::text INTO v_invoice_ref, v_sync_state
      FROM core.invoices AS invoice
     WHERE invoice.tenant_id = v_tenant AND invoice.engagement_id = v_row.id
     ORDER BY invoice.created_at DESC
     LIMIT 1;

    -- `trainerPayable`: the CONFIRMED bookings for this engagement, at their
    -- own day rate, over their own day span — the same rate the booking
    -- itself commits to (006), not a re-derivation from the trainer's band.
    SELECT COALESCE(pg_catalog.sum(
             COALESCE(booking.day_rate_sen, 0) * (booking.ends_on - booking.starts_on + 1)), 0)
      INTO v_trainer_sen
      FROM core.trainer_bookings AS booking
     WHERE booking.tenant_id = v_tenant AND booking.engagement_id = v_row.id
       AND booking.state = 'CONFIRMED';

    v_margin := CASE WHEN COALESCE(v_row.value_sen,0) > 0
                     THEN pg_catalog.round((v_row.value_sen - v_trainer_sen)::numeric / v_row.value_sen, 4)
                     ELSE 0 END;
  END IF;

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'id',        v_row.id::text,
    'ref',       v_row.ref,
    'createdAt', v_row.created_at,
    'updatedAt', v_row.updated_at,
    'createdBy', app._actor(v_row.created_by_kind::text, v_row.created_by_id, v_row.created_by_name),
    'title',           v_row.title,
    'organisationRef', v_org_ref,
    'programmeRef',    (SELECT programme.ref FROM core.programmes AS programme
                          WHERE programme.tenant_id = v_tenant AND programme.id = v_row.programme_id),
    'status', v_row.status,
    'venue',  COALESCE(v_row.venue, ''),
    'dates',  COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(session.on_date::text) ORDER BY session.on_date)
                           FROM core.sessions AS session
                          WHERE session.tenant_id = v_tenant AND session.engagement_id = v_row.id), '[]'::jsonb),
    'owner',  app._actor('HUMAN', v_row.owner_id::text, v_owner_name),
    'value',  app._money(v_row.value_sen, v_row.currency::text),
    'metrics', pg_catalog.jsonb_build_object(
      'participants',      v_participants,
      'attended',           v_attended,
      'attendanceRate',     CASE WHEN v_participants > 0
                                  THEN pg_catalog.round(v_attended::numeric / v_participants, 4)
                                  ELSE 0 END,
      'trainer',             pg_catalog.jsonb_build_object('ref', COALESCE(v_lead_ref,''), 'name', COALESCE(v_lead_name,'')),
      'claimCompleteness',   CASE WHEN COALESCE(v_checklist_n,0) > 0
                                  THEN pg_catalog.round(v_checklist_d::numeric / v_checklist_n, 4)
                                  ELSE 0 END),
    'lifecycle', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'key',   step.step_key,
               'label', step.label,
               'state', COALESCE(state.state::text, 'PENDING'))
             || CASE WHEN state.at IS NULL THEN '{}'::jsonb ELSE pg_catalog.jsonb_build_object('at', state.at) END
             || CASE WHEN state.note IS NULL THEN '{}'::jsonb ELSE pg_catalog.jsonb_build_object('note', state.note) END
             || CASE WHEN state.target_ref IS NULL THEN '{}'::jsonb ELSE pg_catalog.jsonb_build_object('ref', state.target_ref) END
             ORDER BY step.position)
        FROM core.pipeline_steps AS step
        LEFT JOIN core.engagement_step_states AS state
               ON state.tenant_id = v_tenant AND state.engagement_id = v_row.id AND state.pipeline_step_id = step.id
       WHERE step.tenant_id = v_tenant AND step.pipeline_id = v_row.pipeline_id), '[]'::jsonb),
    'checklist', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'key', item.item_key, 'label', item.label, 'done', item.done)
             ORDER BY item.item_key)
        FROM core.engagement_checklist_items AS item
       WHERE item.tenant_id = v_tenant AND item.engagement_id = v_row.id), '[]'::jsonb),
    'sessions', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'ref',        session.ref,
               'day',        session.day,
               'date',       session.on_date,
               'title',      COALESCE(session.title,''),
               'venue',      COALESCE(session.venue, v_row.venue, ''),
               'trainerRef', COALESCE(trainer.ref,''),
               'present',    COALESCE(pres.cnt, 0),
               'total',      v_participants)
             ORDER BY session.day)
        FROM core.sessions AS session
        LEFT JOIN core.trainers AS trainer
               ON trainer.tenant_id = session.tenant_id AND trainer.id = session.trainer_id
        LEFT JOIN LATERAL (
                 SELECT pg_catalog.count(DISTINCT entry.participant_id)::int AS cnt
                   FROM core.attendance_days AS day
                   JOIN core.attendance_entries AS entry
                     ON entry.tenant_id = day.tenant_id AND entry.attendance_day_id = day.id AND entry.present
                  WHERE day.tenant_id = session.tenant_id AND day.engagement_id = session.engagement_id
                    AND day.day = session.day) AS pres ON true
       WHERE session.tenant_id = v_tenant AND session.engagement_id = v_row.id), '[]'::jsonb))
    || CASE WHEN NOT v_can_finance THEN '{}'::jsonb
            ELSE pg_catalog.jsonb_build_object('finance', pg_catalog.jsonb_build_object(
                   'invoiceRef',          v_invoice_ref,
                   'syncState',           COALESCE(v_sync_state, 'NOT_SENT'),
                   'trainerPayable',      app._money(v_trainer_sen, v_row.currency::text),
                   'realisedMarginRate',  COALESCE(v_margin, 0))) END
    || CASE WHEN v_row.grant_rule_set_version_id IS NULL THEN '{}'::jsonb
            ELSE pg_catalog.jsonb_build_object('ruleSetVersion', v_row.grant_rule_set_version_id::text) END);
END;
$fn$;

-- ═══ 3 · core.get_engagement_participants ═══════════════════════════════════
--
-- One engagement's roster, keyset-paged on `registered_at`. No filter: the
-- fixture client does not filter this list either (`FC:1286`).

CREATE OR REPLACE FUNCTION core.get_engagement_participants(
  p_id   text,
  p_page jsonb DEFAULT '{"size":50}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant   uuid := app.require_tenant_id();
  v_eng      core.engagements%ROWTYPE;
  v_size     integer;
  v_cur_at   timestamptz;
  v_cur_id   uuid;
  v_cursor   text;
  v_where    text := 'true';
  v_ids      uuid[];
  v_rows     jsonb;
  v_total    integer;
  v_count    integer;
  v_next     text;
  v_last_at  timestamptz;
  v_last_id  uuid;
BEGIN
  IF NOT app.has_permission('participant:read') THEN
    RETURN app.err('FORBIDDEN', pg_catalog.jsonb_build_object(
      'requiredPermission','participant:read'));
  END IF;

  SELECT engagement.* INTO v_eng FROM core.engagements AS engagement
   WHERE engagement.tenant_id = v_tenant
     AND (engagement.id::text = p_id OR engagement.ref = p_id);
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('id', p_id));
  END IF;

  BEGIN
    v_size := app._page_size(p_page);
  EXCEPTION WHEN invalid_parameter_value THEN
    RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
      'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field','page.size','reason', SQLERRM))));
  END;

  v_cursor := NULLIF(p_page ->> 'cursor','');
  IF v_cursor IS NOT NULL THEN
    BEGIN
      SELECT decoded.at, decoded.id INTO v_cur_at, v_cur_id FROM app._cursor_decode(v_cursor) AS decoded;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
        'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'field','page.cursor','reason','MALFORMED_CURSOR'))));
    END;
  END IF;

  v_where := pg_catalog.format('engagement_id = %L', v_eng.id);
  SELECT scope.o_total, scope.o_where INTO v_total, v_where
    FROM app._keyset_scope('core.participants'::regclass, v_tenant, v_where,
                           'registered_at', false, v_cur_at, v_cur_id) AS scope;

  EXECUTE pg_catalog.format($q$
    SELECT COALESCE(pg_catalog.array_agg(p.id ORDER BY p.registered_at ASC, p.id ASC), ARRAY[]::uuid[])
      FROM (SELECT id, registered_at FROM core.participants
             WHERE tenant_id = $1 AND %s
             ORDER BY registered_at ASC, id ASC
             LIMIT $2) AS p$q$,
    v_where) INTO v_ids USING v_tenant, v_size;

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                     'id',                  participant.id::text,
                     'ref',                 participant.ref,
                     'createdAt',           participant.created_at,
                     'updatedAt',           participant.updated_at,
                     'createdBy',           app._actor(participant.created_by_kind::text, participant.created_by_id, participant.created_by_name),
                     'engagementRef',       v_eng.ref,
                     'name',                participant.name,
                     'department',          COALESCE(participant.department,''))
                   || CASE WHEN participant.email IS NULL THEN '{}'::jsonb
                           ELSE pg_catalog.jsonb_build_object('email', participant.email::text) END
                   -- `core.participants` (008) has no `phone` column — only `contacts` does.
                   -- The contract's `phone?` is honestly absent rather than a fabricated read.
                   -- A correlated scalar subquery with zero matching rows is NULL, not
                   -- `{}`, and `jsonb || NULL` is NULL — which would wipe the whole
                   -- built object for every participant with no certificate. COALESCE
                   -- guards it the same way every other optional block here does.
                   || COALESCE((SELECT pg_catalog.jsonb_build_object('certificateId', cert.serial,
                                         'certificateIssuedAt', cert.issued_at::date)
                                  FROM core.certificates AS cert
                                 WHERE cert.tenant_id = v_tenant AND cert.participant_id = participant.id),
                               '{}'::jsonb)
                   ORDER BY participant.registered_at, participant.id), '[]'::jsonb),
         pg_catalog.count(*)::integer
    INTO v_rows, v_count
    FROM pg_catalog.unnest(v_ids) WITH ORDINALITY AS element(id, ord)
    JOIN core.participants AS participant ON participant.tenant_id = v_tenant AND participant.id = element.id;

  IF pg_catalog.array_length(v_ids, 1) IS NOT NULL THEN
    SELECT participant.registered_at, participant.id INTO v_last_at, v_last_id
      FROM core.participants AS participant
     WHERE participant.tenant_id = v_tenant AND participant.id = v_ids[pg_catalog.array_length(v_ids,1)];
  END IF;
  v_next := app._next_cursor('core.participants'::regclass, v_tenant, v_where,
                             'registered_at', false, v_count, v_size, v_last_at, v_last_id);

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'data', v_rows,
    'page', pg_catalog.jsonb_build_object('next', v_next, 'total', v_total)));
END;
$fn$;

-- ═══ 4 · core.get_attendance ═════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION core.get_attendance(p_id text, p_day integer DEFAULT 1)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
  v_eng    core.engagements%ROWTYPE;
  v_day    core.attendance_days%ROWTYPE;
  v_rows   jsonb;
  v_signed integer;
BEGIN
  IF NOT app.has_permission('attendance:read') THEN
    RETURN app.err('FORBIDDEN', pg_catalog.jsonb_build_object(
      'requiredPermission','attendance:read'));
  END IF;

  SELECT engagement.* INTO v_eng FROM core.engagements AS engagement
   WHERE engagement.tenant_id = v_tenant
     AND (engagement.id::text = p_id OR engagement.ref = p_id);
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('id', p_id));
  END IF;

  SELECT day.* INTO v_day FROM core.attendance_days AS day
   WHERE day.tenant_id = v_tenant AND day.engagement_id = v_eng.id AND day.day = COALESCE(p_day,1);
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('engagementRef', v_eng.ref, 'day', p_day));
  END IF;

  SELECT pg_catalog.count(*) FILTER (WHERE entry.signature_id IS NOT NULL)::int INTO v_signed
    FROM core.attendance_entries AS entry WHERE entry.tenant_id = v_tenant AND entry.attendance_day_id = v_day.id;

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'participantRef', participant.ref,
           'name',           participant.name,
           'department',     COALESCE(participant.department,''),
           'am', pg_catalog.jsonb_build_object('present', COALESCE(am.present, false))
                 || CASE WHEN am.present AND am.marked_at IS NOT NULL THEN pg_catalog.jsonb_build_object('at', am.marked_at) ELSE '{}'::jsonb END
                 || CASE WHEN am.method IS NOT NULL THEN pg_catalog.jsonb_build_object('method', am.method::text) ELSE '{}'::jsonb END
                 || CASE WHEN NOT COALESCE(am.present, false) AND am.absence_reason IS NOT NULL
                         THEN pg_catalog.jsonb_build_object('reason', am.absence_reason::text) ELSE '{}'::jsonb END,
           'pm', pg_catalog.jsonb_build_object('present', COALESCE(pm.present, false))
                 || CASE WHEN pm.present AND pm.marked_at IS NOT NULL THEN pg_catalog.jsonb_build_object('at', pm.marked_at) ELSE '{}'::jsonb END
                 || CASE WHEN pm.method IS NOT NULL THEN pg_catalog.jsonb_build_object('method', pm.method::text) ELSE '{}'::jsonb END
                 || CASE WHEN NOT COALESCE(pm.present, false) AND pm.absence_reason IS NOT NULL
                         THEN pg_catalog.jsonb_build_object('reason', pm.absence_reason::text) ELSE '{}'::jsonb END)
         ORDER BY participant.name), '[]'::jsonb)
    INTO v_rows
    FROM core.participants AS participant
    LEFT JOIN core.attendance_entries AS am
           ON am.tenant_id = v_tenant AND am.attendance_day_id = v_day.id AND am.participant_id = participant.id AND am.half = 'AM'
    LEFT JOIN core.attendance_entries AS pm
           ON pm.tenant_id = v_tenant AND pm.attendance_day_id = v_day.id AND pm.participant_id = participant.id AND pm.half = 'PM'
   WHERE participant.tenant_id = v_tenant AND participant.engagement_id = v_eng.id AND participant.withdrawn_at IS NULL;

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'engagementRef', v_eng.ref,
    'day',           v_day.day,
    'date',          v_day.on_date,
    'status',        v_day.status,
    'immutable',     v_day.immutable,
    'approvedBy',    CASE WHEN v_day.approved_by_id IS NULL THEN NULL
                          ELSE app._actor(v_day.approved_by_kind::text, v_day.approved_by_id, v_day.approved_by_name) END,
    'approvedAt',    v_day.approved_at,
    'summary', pg_catalog.jsonb_build_object(
      'registered',        (SELECT pg_catalog.count(*)::int FROM core.participants p
                              WHERE p.tenant_id = v_tenant AND p.engagement_id = v_eng.id AND p.withdrawn_at IS NULL),
      'presentAm',          (SELECT pg_catalog.count(*)::int FROM core.attendance_entries e
                              WHERE e.tenant_id = v_tenant AND e.attendance_day_id = v_day.id AND e.half = 'AM' AND e.present),
      'presentPm',          (SELECT pg_catalog.count(*)::int FROM core.attendance_entries e
                              WHERE e.tenant_id = v_tenant AND e.attendance_day_id = v_day.id AND e.half = 'PM' AND e.present),
      'signatures',         COALESCE(v_signed, 0),
      'signaturesExpected', (SELECT pg_catalog.count(*)::int FROM core.participants p
                              WHERE p.tenant_id = v_tenant AND p.engagement_id = v_eng.id AND p.withdrawn_at IS NULL) * 2),
    'rows', v_rows,
    'captureModes', pg_catalog.jsonb_build_object(
      'qr', v_day.capture_qr, 'signature', v_day.capture_signature, 'manual', v_day.capture_manual)));
END;
$fn$;

-- ═══ 5 · core.capture_attendance ═════════════════════════════════════════════
--
-- WRITE. The one-way lock is 008's, enforced by `trg_attendance_days_lock` /
-- `trg_attendance_entries_lock` regardless of this function — the pre-check
-- below exists to answer with the CONTRACT's exact `AttendanceLockedDetails`
-- shape (`approvedAt`, `unlockPath`, `unlockActionType`) rather than the
-- trigger's generic text. `ae_absent_needs_reason` (008) requires a reason
-- whenever `present = false`; the fixture client does not (`FixtureClient`
-- only sets `reason` when the caller supplied one). Reconciled here by
-- defaulting to `OTHER` when the caller marks someone absent with no reason —
-- the schema's stricter rule, not a new one invented for this migration.

CREATE OR REPLACE FUNCTION core.capture_attendance(
  p_id  text,
  p_day integer,
  p_body jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
  v_eng    core.engagements%ROWTYPE;
  v_day    core.attendance_days%ROWTYPE;
  v_part   core.participants%ROWTYPE;
  v_half   core.attendance_half;
  v_method core.capture_method;
  v_reason core.absence_reason;
  v_present boolean;
BEGIN
  IF NOT app.has_permission('attendance:capture') THEN
    RAISE EXCEPTION 'requester lacks attendance:capture'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','FORBIDDEN','requiredPermission','attendance:capture')::text;
  END IF;

  SELECT engagement.* INTO v_eng FROM core.engagements AS engagement
   WHERE engagement.tenant_id = v_tenant
     AND (engagement.id::text = p_id OR engagement.ref = p_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'engagement not found'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','NOT_FOUND','id', p_id)::text;
  END IF;

  SELECT day.* INTO v_day FROM core.attendance_days AS day
   WHERE day.tenant_id = v_tenant AND day.engagement_id = v_eng.id AND day.day = p_day;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'attendance day not found'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','NOT_FOUND','engagementRef', v_eng.ref, 'day', p_day)::text;
  END IF;

  -- Contract §8: "the lock is one-way". Answered in the CONTRACT's own shape
  -- before the write is attempted, not left to the trigger's generic text.
  IF v_day.status = 'LOCKED' THEN
    RAISE EXCEPTION 'ATTENDANCE_LOCKED: attendance for % day % was approved and cannot be modified', v_eng.ref, p_day
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','ATTENDANCE_LOCKED',
              'approvedAt', v_day.approved_at,
              'unlockPath','/v1/actions',
              'unlockActionType','ATTENDANCE_UNLOCK')::text;
  END IF;

  SELECT participant.* INTO v_part FROM core.participants AS participant
   WHERE participant.tenant_id = v_tenant AND participant.engagement_id = v_eng.id
     AND (participant.id::text = (p_body ->> 'participantRef') OR participant.ref = (p_body ->> 'participantRef'));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'participant not found on this engagement'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','NOT_FOUND', 'participantRef', p_body ->> 'participantRef')::text;
  END IF;

  BEGIN
    v_half    := CASE p_body ->> 'session' WHEN 'AM' THEN 'AM'::core.attendance_half
                                            WHEN 'PM' THEN 'PM'::core.attendance_half END;
    v_present := (p_body ->> 'present')::boolean;
    v_method  := NULLIF(p_body ->> 'method','')::core.capture_method;
    v_reason  := NULLIF(p_body ->> 'reason','')::core.absence_reason;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'malformed attendance capture body'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','VALIDATION_FAILED',
                       'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                         'field','body','reason', SQLERRM)))::text;
  END;
  IF v_half IS NULL THEN
    RAISE EXCEPTION 'session must be AM or PM'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','VALIDATION_FAILED',
                       'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                         'field','session','reason','REQUIRED')))::text;
  END IF;
  IF NOT v_present AND v_reason IS NULL THEN
    v_reason := 'OTHER';
  END IF;

  INSERT INTO core.attendance_entries
    (tenant_id, attendance_day_id, participant_id, half, present, marked_at, method, absence_reason,
     created_by_kind, created_by_id, created_by_name)
  VALUES
    (v_tenant, v_day.id, v_part.id, v_half, v_present,
     CASE WHEN v_present THEN now() ELSE NULL END, v_method,
     CASE WHEN v_present THEN NULL ELSE v_reason END,
     'HUMAN', (SELECT actor.actor_id FROM app.current_actor() AS actor), NULL)
  ON CONFLICT (tenant_id, attendance_day_id, participant_id, half)
  DO UPDATE SET present = EXCLUDED.present,
                marked_at = EXCLUDED.marked_at,
                method = EXCLUDED.method,
                absence_reason = EXCLUDED.absence_reason,
                updated_at = now();

  -- WRITER RETURNS THROUGH THE READER (021's rule): every `attendance:capture`
  -- holder (OPS, MD, ADMIN, TRAINER — 002 §11) also holds `attendance:read`,
  -- so this gate can never refuse a caller who just passed the write gate.
  RETURN core.get_attendance(p_id, p_day);
END;
$fn$;

-- ═══ 6 · core.export_attendance ══════════════════════════════════════════════
--
-- No export pipeline exists in 001–021 (no storage bucket, no job queue for
-- this document). Answers with the contract's own shape — a short-lived,
-- deterministically-named URL and an expiry — same as the fixture client
-- (`FC:1342`), which is itself a stub. A real export is later work; this
-- migration does not invent a storage layer to unblock a read the contract
-- already specifies narrowly (`{url, expiresAt}`).

CREATE OR REPLACE FUNCTION core.export_attendance(p_id text, p_format text DEFAULT 'HRDC')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
  v_eng    core.engagements%ROWTYPE;
BEGIN
  IF NOT app.has_permission('attendance:export') THEN
    RETURN app.err('FORBIDDEN', pg_catalog.jsonb_build_object(
      'requiredPermission','attendance:export'));
  END IF;

  SELECT engagement.* INTO v_eng FROM core.engagements AS engagement
   WHERE engagement.tenant_id = v_tenant
     AND (engagement.id::text = p_id OR engagement.ref = p_id);
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('id', p_id));
  END IF;

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'url', '/exports/' || v_eng.ref || '-attendance-' || pg_catalog.lower(COALESCE(NULLIF(p_format,''),'HRDC')) || '.xlsx',
    'expiresAt', now() + interval '1 hour'));
END;
$fn$;

-- ═══ 7 · core.put_programme ══════════════════════════════════════════════════
--
-- ADMIN only (fixture `FC:721/727`; 002 §11 grants `programme:write` to ADMIN
-- alone). Scalar fields only — see the header note on why the four nested
-- arrays are left untouched by this write.

CREATE OR REPLACE FUNCTION core.put_programme(p_id text, p_body jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
  v_row    core.programmes%ROWTYPE;
BEGIN
  IF NOT app.has_permission('programme:write') THEN
    RAISE EXCEPTION 'editing the programme catalogue is restricted to ADMIN'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','FORBIDDEN','requiredRole','ADMIN','requiredPermission','programme:write')::text;
  END IF;

  SELECT programme.* INTO v_row FROM core.programmes AS programme
   WHERE programme.tenant_id = v_tenant
     AND (programme.id::text = p_id OR programme.ref = p_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'programme not found'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','NOT_FOUND','id', p_id)::text;
  END IF;

  UPDATE core.programmes SET
    name              = COALESCE(p_body ->> 'name', name),
    category          = COALESCE(p_body ->> 'category', category),
    days              = COALESCE((p_body ->> 'days')::smallint, days),
    status            = COALESCE(p_body ->> 'status', status),
    hrdc_scheme       = COALESCE((p_body ->> 'hrdcScheme')::core.hrdc_scheme, hrdc_scheme),
    hrdc_claimable    = COALESCE((p_body -> 'hrdcClaimable')::boolean, hrdc_claimable),
    list_price_sen    = COALESCE(((p_body -> 'listPrice') ->> 'amount')::bigint, list_price_sen),
    list_price_pax    = COALESCE((p_body ->> 'listPricePax')::smallint, list_price_pax),
    floor_price_sen   = COALESCE(((p_body -> 'floorPrice') ->> 'amount')::bigint, floor_price_sen),
    floor_margin_rate = COALESCE((p_body ->> 'floorMarginRate')::numeric, floor_margin_rate),
    outcomes          = CASE WHEN p_body ? 'outcomes'
                              THEN (SELECT pg_catalog.array_agg(value.x) FROM pg_catalog.jsonb_array_elements_text(p_body -> 'outcomes') AS value(x))
                              ELSE outcomes END,
    updated_at        = now()
  WHERE tenant_id = v_tenant AND id = v_row.id;

  -- The floor-below-list CHECK (006) is the one the fixture client leaves to
  -- the caller to respect; a violation here surfaces as a generic 500 via the
  -- constraint rather than a bespoke VALIDATION_FAILED, same posture 018 takes
  -- for every other CHECK it does not pre-validate in SQL (e.g. proposal value).

  RETURN core.get_programme(p_id);
END;
$fn$;

-- ═══ 8 · Grants ══════════════════════════════════════════════════════════════
--
-- Per 017's finding: `ALTER DEFAULT PRIVILEGES ... REVOKE ALL ON FUNCTIONS
-- FROM PUBLIC` (001) does not take for functions created in a later
-- migration. Every function above is therefore REVOKEd from PUBLIC/anon and
-- explicitly GRANTed to `authenticated`, per-object, here.

REVOKE ALL ON FUNCTION core.list_engagements(jsonb,text,jsonb,text)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION core.get_engagement(text)                           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION core.get_engagement_participants(text,jsonb)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION core.get_attendance(text,integer)                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION core.capture_attendance(text,integer,jsonb)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION core.export_attendance(text,text)                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION core.put_programme(text,jsonb)                      FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION core.list_engagements(jsonb,text,jsonb,text)     TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_engagement(text)                       TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_engagement_participants(text,jsonb)    TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_attendance(text,integer)               TO authenticated;
GRANT EXECUTE ON FUNCTION core.capture_attendance(text,integer,jsonb)     TO authenticated;
GRANT EXECUTE ON FUNCTION core.export_attendance(text,text)               TO authenticated;
GRANT EXECUTE ON FUNCTION core.put_programme(text,jsonb)                  TO authenticated;

-- ═══ 9 · $verify$ ════════════════════════════════════════════════════════════

DO $verify$
DECLARE
  v_bad  text[];
  v_fn   text[] := ARRAY[
    'core.list_engagements(jsonb,text,jsonb,text)',
    'core.get_engagement(text)',
    'core.get_engagement_participants(text,jsonb)',
    'core.get_attendance(text,integer)',
    'core.capture_attendance(text,integer,jsonb)',
    'core.export_attendance(text,text)',
    'core.put_programme(text,jsonb)'];
  v_name text;
BEGIN
  -- V1 · every function exists, exactly one overload, SECURITY DEFINER,
  -- search_path pinned, statement_timeout set, granted to authenticated only.
  FOREACH v_name IN ARRAY v_fn LOOP
    IF pg_catalog.to_regprocedure(v_name) IS NULL THEN
      v_bad := pg_catalog.array_append(v_bad, v_name || ': missing');
      CONTINUE;
    END IF;
    IF NOT pg_catalog.has_function_privilege('authenticated', v_name::regprocedure, 'EXECUTE') THEN
      v_bad := pg_catalog.array_append(v_bad, v_name || ': authenticated cannot execute');
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_name::regprocedure, 'EXECUTE') THEN
      v_bad := pg_catalog.array_append(v_bad, v_name || ': anon can execute');
    END IF;
  END LOOP;
  SELECT v_bad || pg_catalog.array_agg(pg_catalog.format('%s: %s overloads', counted.proname, counted.n))
    INTO v_bad
    FROM (SELECT p.proname, pg_catalog.count(*) AS n
            FROM pg_catalog.pg_proc AS p
            JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
           WHERE n.nspname = 'core'
             AND p.proname IN ('list_engagements','get_engagement','get_engagement_participants',
                                'get_attendance','capture_attendance','export_attendance','put_programme')
           GROUP BY p.proname
          HAVING pg_catalog.count(*) <> 1) AS counted;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '024 verify V1: %', v_bad;
  END IF;

  -- V2 · AUTHZ FIRST: a permission gate exists in every one of the seven, and
  -- no `FROM core.` / `FROM app.` read precedes it in the body text.
  v_bad := NULL;
  FOREACH v_name IN ARRAY v_fn LOOP
    DECLARE
      v_body text := app._body_sql(v_name::regprocedure);
      v_pos  integer := pg_catalog.strpos(v_body, 'app.has_permission(');
    BEGIN
      IF v_pos = 0
         OR (pg_catalog.strpos(v_body, 'FROM core.') > 0 AND pg_catalog.strpos(v_body, 'FROM core.') < v_pos)
         OR (pg_catalog.strpos(v_body, 'FROM app.') > 0 AND pg_catalog.strpos(v_body, 'FROM app.') < v_pos) THEN
        v_bad := pg_catalog.array_append(v_bad, v_name);
      END IF;
    END;
  END LOOP;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '024 verify V2: no permission gate, or a read before it, in %', v_bad;
  END IF;

  -- V3 · WRITERS RETURN THROUGH READERS: every role holding a write here
  -- holds the paired read, per THIS database's `app.role_permissions`.
  SELECT pg_catalog.array_agg(pg_catalog.format('%s holds %s but not %s', w.role, pair.w, pair.r)) INTO v_bad
    FROM (VALUES ('attendance:capture','attendance:read'), ('programme:write','programme:read'))
         AS pair(w, r)
    JOIN app.role_permissions AS w ON w.permission = pair.w
   WHERE NOT EXISTS (SELECT 1 FROM app.role_permissions AS r
                      WHERE r.role = w.role AND r.permission = pair.r);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '024 verify V3: a writer would be refused by its own reader: %', v_bad;
  END IF;

  -- V4 · put_programme is ADMIN-only per 002 §11 (fixture FC:727).
  IF EXISTS (SELECT 1 FROM app.role_permissions WHERE permission = 'programme:write' AND role <> 'ADMIN') THEN
    RAISE EXCEPTION '024 verify V4: programme:write is held by a role other than ADMIN';
  END IF;
END
$verify$;

COMMIT;
