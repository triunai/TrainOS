-- ═══════════════════════════════════════════════════════════════════════════
-- 023 · The sales directory: organisation search, the opportunity and TNA
--       lists, cross-sell suggestions, and reopening a completed TNA
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 001–021 ARE NOT EDITED. Every object here is NEW — no existing function is
-- replaced, so the rollback is five plain DROPs.
--
-- ── THE GAP ─────────────────────────────────────────────────────────────────
--
-- `apps/web/src/shared/api/apiClient.ts` `adapters()` sends only the methods
-- it lists to `SupabaseRpcClient`; everything else rejects client-side as
-- "not implemented by the Supabase client yet", before any request is made.
-- Five methods behind thirteen-plus screens had no adapter AND no SQL:
--
--   * `searchOrganisations`   — the org picker on 13 screens (contacts,
--     opportunities, TNAs, proposals, quotations, relationships, …)
--   * `listOpportunities`     — `/sales/leads`, `/sales/pipeline`, and the
--     org column on `/sales/proposals`
--   * `getOrganisationSuggestions` — the cross-sell panel on
--     `/sales/organisations/:id` and `/relationships/renewals|cross-sell`
--   * `listTnas`              — `/sales/tna`. §13 never published this
--     collection (a TNA is normally reached from its opportunity); the nav
--     tree has a `Sales › TNA` leaf regardless, and the fixture oracle
--     implements it and reports the gap the same way `addProposalSection`
--     does. This migration serves what the client already calls.
--   * `reopenTna`             — the "Reopen questionnaire" button on
--     `TnaDetailPage`
--
-- Each is now a `core` RPC: SECURITY DEFINER, `search_path=''`, a 002
-- permission gate as the FIRST statement, `app.ok`/`app.err` for reads,
-- `RAISE … USING ERRCODE = 'TRNOS'` for the one write, REVOKEd from PUBLIC
-- and anon, GRANTed to authenticated only.
--
-- ── REUSE OVER A SECOND PROJECTION ──────────────────────────────────────────
--
-- `search_organisations` projects each row through `core.get_organisation`
-- (021) rather than re-deriving the §5 metric strip; `list_opportunities` and
-- `list_tnas` project through `core.get_opportunity` / `core.get_tna` (021),
-- exactly as `core.list_proposals` (021) projects through `core.get_proposal`.
-- One shape, in one place, is what keeps a search result and a detail read
-- from ever drifting apart. The two lists otherwise copy `list_proposals`'
-- filter/sort/keyset-pagination engine byte-for-byte, substituting the table,
-- the filter whitelist and the projection function.
--
-- ── `core.saved_view_object` HAS NO OPPORTUNITY OR TNA VALUE ────────────────
--
-- Same situation `list_proposals` (021) already lives with for PROPOSAL:
-- `app._view_filters` no-ops whenever `p_view` is NULL (the only way either
-- list is called today — see `apps/web/src/features/pipeline/api.ts:61` and
-- `tna/api.ts:32`) and refuses off the live enum the day a caller actually
-- asks for a saved view neither object can have yet. The parameter stays in
-- the signature so PostgREST's named-argument resolution is not broken for a
-- client that sends it.
--
-- ── `getOrganisationSuggestions`: A TABLE ALREADY EXISTS ────────────────────
--
-- `core.organisation_suggestions` (005, FK closed by 006) has everything the
-- contract's `OrganisationSuggestion` needs except `actions`, which is not
-- data: the contract's `SuggestionType` has exactly one value (`CROSS_SELL`)
-- and the fixture oracle (`packages/fixtures/src/data/organisations.ts`)
-- offers the same two actions — `OPPORTUNITY_CREATE`, `SUGGESTION_DISMISS` —
-- on every suggestion it carries. Inventing a column for a fact `UI_ACTION_
-- TYPES` (contract `actions.ts:110`) already fixes would be a second, driftable
-- copy of it, so the CASE that derives `actions` gets a second arm the day the
-- contract adds a second `SuggestionType`, not a new column. Provenance comes
-- from `app._provenance` (018), the same reader `get_tna`'s gaps use; the
-- contract types `provenance` as REQUIRED (unlike `TnaGap.provenance?`), so a
-- suggestion with no provenance row still emits `{origin:"SYSTEM"}` rather
-- than omitting the key — the same fallback `get_tna_recommendations` (021)
-- uses when nothing has run yet. Only `status = 'OPEN'` rows render: one
-- already ACTED or DISMISSED is a decision made, not a card to show again,
-- and `os_open_idx` (005) exists for exactly this predicate.
--
-- ── `reopenTna`: THE SCHEMA ALREADY DECIDED THE TRANSITION ──────────────────
--
-- `core.tnas.reopened_at` (005) exists and is unused before this migration —
-- built for precisely this moment. `002` §11 already grants a dedicated
-- `tna:reopen` permission to SALES, SALES_MANAGER, MD and ADMIN (a strict
-- subset of `tna:read`'s holders, asserted in `$verify$` V3 below), and
-- `TnaDetailPage.tsx`'s own comment names the action "reopen a **completed**
-- TNA". `core.tna_status` (003) has exactly DRAFT, SENT, COMPLETE, REOPENED,
-- so COMPLETE → REOPENED is the only transition the schema, the permission
-- name and the UI copy agree on: DRAFT/SENT have nothing to reopen and refuse
-- `VALIDATION_FAILED`; an already-REOPENED row is left alone and returned as
-- a no-op success rather than refused, so a double-click or a dropped-connection
-- retry is never told its second attempt did something wrong. No idempotency
-- key: this is a `patch_enquiry_extraction`-shaped detail edit, not a doc 09
-- §9 "governed write" — a status flip guarded by the transition check above,
-- not a document whose replay must be byte-identical.
--
-- ⚠ FOUND BY EXECUTING, NOT BY READING: `list_proposals` (021) offers `value`
-- as a sort field over the same `app._keyset_scope`/`app._next_cursor` (018)
-- engine `list_opportunities` §2 copies. That engine's page-boundary pair is
-- fixed `timestamptz`, and a sort column typed `bigint` breaks it on the
-- first non-empty page (`date/time field value out of range`, PL/pgSQL's
-- dynamic-`INTO` text coercion) — see §2's inline note for the exact
-- reproduction. `list_opportunities` does not repeat the mistake: `value`
-- stays filterable and is left off ITS sort whitelist. 021 is not touched.
--
-- ⚠ NOT ROUTED THROUGH THE 011 ACTION ENVELOPE. `app.action_types` has no
-- `TNA_REOPEN` entry and `packages/fixtures` never calls `perform_action` for
-- this write — its fixture body (`FixtureClient.ts:694`) is a plain
-- `#write()`, the same shape `patchOpportunity` and the proposal-section
-- writes use, not `performAction`. Direct-RPC writes with their own
-- permission gate and their own legal-transition check are an established
-- 018/021 pattern (`patch_enquiry_extraction`, `add_proposal_section`,
-- `put_proposal_section`, `put_quotation`); the envelope is for writes that
-- need its policy-approval routing, its diff hash or its idempotency ledger,
-- none of which this one does. Flagged in the PR for confirmation rather than
-- assumed silently.
--
-- ⚠ DATA SCOPE (○ in 002 §11) IS NOT APPLIED, same standing gap as 021: SALES
-- holds every permission here "scope-narrowed", which 014's `app.can_see_
-- owner` is meant to express, and these SECURITY DEFINER reads bypass RLS
-- like every other 018/020/021 RPC. Not this migration's to close.

-- ── §1 · core.search_organisations ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION core.search_organisations(p_query text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
  v_needle text := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_query, '')));
  v_ids    uuid[];
  v_rows   jsonb;
BEGIN
  -- 023 · AUTHZ FIRST: decided before any read, so the refusal is identical
  -- for every argument.
  IF NOT app.has_permission('organisation:read') THEN
    RETURN app.err('FORBIDDEN', pg_catalog.jsonb_build_object(
      'requiredPermission','organisation:read'));
  END IF;

  -- Best match first: an exact ref match outranks a name-fragment match at
  -- an earlier position, then alphabetical. Capped at 50 — this backs a
  -- type-ahead picker, not a report, and the contract types the reply as a
  -- bare array with no page envelope to say "there were more".
  SELECT COALESCE(pg_catalog.array_agg(ranked.id ORDER BY ranked.rn), ARRAY[]::uuid[])
    INTO v_ids
    FROM (
      SELECT org.id,
             pg_catalog.row_number() OVER (
               ORDER BY (pg_catalog.lower(org.ref) = v_needle) DESC,
                        pg_catalog.strpos(pg_catalog.lower(org.name), v_needle),
                        org.name) AS rn
        FROM core.organisations AS org
       WHERE org.tenant_id = v_tenant
         AND (v_needle = ''
              OR pg_catalog.strpos(pg_catalog.lower(org.name), v_needle) > 0
              OR pg_catalog.lower(org.ref) = v_needle)
    ) AS ranked
   WHERE ranked.rn <= 50;

  -- ONE PROJECTION: each row comes back through `core.get_organisation`
  -- (021), the same §5 metric-strip shape the record page reads, so a search
  -- result and a detail read can never show two different numbers for the
  -- same organisation.
  SELECT COALESCE(pg_catalog.jsonb_agg(core.get_organisation(element.id::text) -> 'data'
                                       ORDER BY element.ord), '[]'::jsonb)
    INTO v_rows
    FROM pg_catalog.unnest(v_ids) WITH ORDINALITY AS element(id, ord);

  RETURN app.ok(v_rows);
END;
$fn$;

-- ── §2 · core.list_opportunities ────────────────────────────────────────────
--
-- `list_proposals`' (021) filter/sort/keyset engine, unchanged in shape, over
-- `core.opportunities` and projected through `core.get_opportunity` (021).

CREATE OR REPLACE FUNCTION core.list_opportunities(
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
  v_cur_at  timestamptz;
  v_cur_id  uuid;
  v_clauses text[] := ARRAY[]::text[];
  v_errors  jsonb  := '[]'::jsonb;
  v_applied jsonb  := '[]'::jsonb;
  v_clause  jsonb;
  v_field   text;
  v_op      text;
  v_column  text;
  v_kind    text;
  v_desc    boolean := true;
  v_sort_col text := 'created_at';
  v_sort_fld text;
  v_where   text;
  v_ids     uuid[];
  v_rows    jsonb;
  v_total   integer;
  v_count   integer;
  v_next    text;
  v_last_at timestamptz;
  v_last_id uuid;
  v_cursor  text;
  v_keyed   text;
  v_merged  jsonb  := '[]'::jsonb;
BEGIN
  -- 023 · AUTHZ FIRST: decided before any read or validation, so the refusal
  -- is identical for every argument.
  IF NOT app.has_permission('opportunity:read') THEN
    RETURN app.err('FORBIDDEN', pg_catalog.jsonb_build_object(
      'requiredPermission','opportunity:read'));
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

  -- SAVED VIEW. `core.saved_view_object` (003) has no OPPORTUNITY value, so a
  -- saved view for this list cannot exist yet — same situation
  -- `list_proposals` (021) already lives with for PROPOSAL. `app._view_
  -- filters` no-ops when `p_view` is NULL and refuses off the live enum the
  -- day one is actually asked for.
  BEGIN
    v_merged := app._view_filters(v_tenant, p_view, 'OPPORTUNITY', p_filter);
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
      FROM (VALUES ('organisation','organisation_id','uuid'),('stage','stage','text'),
                   ('owner','owner_id','uuid'),('value','value_sen','number'),
                   ('createdAt','created_at','ts'),('updatedAt','updated_at','ts'))
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
    -- `value` (value_sen, bigint) is deliberately NOT sortable, unlike
    -- `list_proposals`' (021) own whitelist, which offers it. Measured, not
    -- assumed: `app._keyset_scope`/`app._next_cursor` (018) carry the page
    -- boundary through a fixed `timestamptz` pair (`p_cur_at`/`p_last_at`),
    -- and `p_date_sort` only disambiguates DATE from TIMESTAMPTZ — there is
    -- no numeric keyset path. Reproduced directly against the shim:
    -- `EXECUTE 'SELECT 3000000::bigint, ...' INTO v_last_at, v_last_id`
    -- (`v_last_at timestamptz`) raises `date/time field value out of range`,
    -- because PL/pgSQL's dynamic-SQL `INTO` coerces through TEXT when the
    -- source and target types differ. `value` stays filterable — filtering
    -- never touches `v_last_at` — and is left off the sort list here rather
    -- than silently offering a sort that breaks on its first non-empty page.
    -- 018/021 are not this migration's to fix; flagged in the PR.
    SELECT allowed.column_name INTO v_sort_col
      FROM (VALUES ('createdAt','created_at'),('updatedAt','updated_at'))
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

  SELECT scope.o_total, scope.o_where INTO v_total, v_keyed
    FROM app._keyset_scope('core.opportunities'::regclass, v_tenant, v_where,
                           v_sort_col, v_desc, v_cur_at, v_cur_id) AS scope;

  -- THE PAGE IS SELECTED HERE AND EACH ROW IS PROJECTED BY
  -- `core.get_opportunity`, exactly as `list_proposals` projects through
  -- `get_proposal`. One projection, called per row on a bounded page.
  EXECUTE pg_catalog.format($q$
    SELECT COALESCE(pg_catalog.array_agg(p.id ORDER BY p.%I %s, p.id %s), ARRAY[]::uuid[])
      FROM (SELECT id, %I FROM core.opportunities
             WHERE tenant_id = $1 AND %s
             ORDER BY %I %s, id %s
             LIMIT $2) AS p$q$,
    v_sort_col, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END,
    v_sort_col, v_keyed,
    v_sort_col, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END)
    INTO v_ids USING v_tenant, v_size;

  SELECT COALESCE(pg_catalog.jsonb_agg(core.get_opportunity(element.id::text) -> 'data'
                                       ORDER BY element.ord), '[]'::jsonb),
         pg_catalog.count(*)::integer
    INTO v_rows, v_count
    FROM pg_catalog.unnest(v_ids) WITH ORDINALITY AS element(id, ord);

  IF pg_catalog.array_length(v_ids, 1) IS NOT NULL THEN
    EXECUTE pg_catalog.format('SELECT %I, id FROM core.opportunities WHERE tenant_id = $1 AND id = $2', v_sort_col)
      INTO v_last_at, v_last_id USING v_tenant, v_ids[pg_catalog.array_length(v_ids,1)];
  END IF;
  v_next := app._next_cursor('core.opportunities'::regclass, v_tenant, v_where,
                             v_sort_col, v_desc, v_count, v_size, v_last_at, v_last_id);

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'data', v_rows,
    'page', pg_catalog.jsonb_build_object('next', v_next, 'total', v_total),
    'appliedFilters', v_applied));
END;
$fn$;

-- ── §3 · core.get_organisation_suggestions ──────────────────────────────────

CREATE OR REPLACE FUNCTION core.get_organisation_suggestions(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
  v_org    core.organisations%ROWTYPE;
  v_rows   jsonb;
BEGIN
  -- 023 · AUTHZ FIRST: `organisation:suggestions:read` (002 §11) is held by
  -- SALES, SALES_MANAGER, MD, ADMIN — not OPS or FINANCE.
  IF NOT app.has_permission('organisation:suggestions:read') THEN
    RETURN app.err('FORBIDDEN', pg_catalog.jsonb_build_object(
      'requiredPermission','organisation:suggestions:read'));
  END IF;

  SELECT org.* INTO v_org FROM core.organisations AS org
   WHERE org.tenant_id = v_tenant
     AND (org.id::text = p_id OR org.ref = p_id);
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('id', p_id));
  END IF;

  -- Only OPEN suggestions render (`os_open_idx`, 005): one already ACTED on
  -- or DISMISSED is a decision made, not a card to show again. `actions` is
  -- derived, not stored — every CROSS_SELL suggestion offers the same two
  -- (fixture oracle `organisationSuggestions`, `UI_ACTION_TYPES` actions.ts) —
  -- so the CASE gets a second arm the day the contract's `SuggestionType`
  -- gets a second value, not a new column.
  SELECT COALESCE(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'type',        suggestion.suggestion_type,
             'programmeId', suggestion.programme_id::text,
             'title',       suggestion.title,
             'rationale',   suggestion.rationale,
             -- `provenance` is REQUIRED on this wire shape (unlike
             -- `TnaGap.provenance?`), so a suggestion with no provenance row
             -- still emits the honest floor rather than omitting the key —
             -- the same fallback `get_tna_recommendations` (021) uses.
             'provenance',  COALESCE(app._provenance('organisation_suggestions', suggestion.id, NULL),
                                      pg_catalog.jsonb_build_object('origin','SYSTEM')),
             'actions', CASE suggestion.suggestion_type
                          WHEN 'CROSS_SELL' THEN pg_catalog.jsonb_build_array(
                            pg_catalog.jsonb_build_object('type','OPPORTUNITY_CREATE','label','Create opportunity'),
                            pg_catalog.jsonb_build_object('type','SUGGESTION_DISMISS','label','Dismiss'))
                          ELSE '[]'::jsonb
                        END)
           ORDER BY suggestion.created_at DESC), '[]'::jsonb)
    INTO v_rows
    FROM core.organisation_suggestions AS suggestion
   WHERE suggestion.tenant_id = v_tenant
     AND suggestion.organisation_id = v_org.id
     AND suggestion.status = 'OPEN';

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'data', v_rows,
    'page', pg_catalog.jsonb_build_object('next', NULL, 'total', pg_catalog.jsonb_array_length(v_rows))));
END;
$fn$;

-- ── §4 · core.list_tnas ──────────────────────────────────────────────────────
--
-- §13 never published a TNA collection (a TNA is normally reached from its
-- opportunity); the nav tree has a `Sales › TNA` leaf regardless and the
-- fixture oracle implements the list and reports the gap
-- (`FixtureClient.ts:667-678`). Same engine as `list_opportunities` §2, over
-- `core.tnas` and projected through `core.get_tna` (021).

CREATE OR REPLACE FUNCTION core.list_tnas(
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
  v_cur_at  timestamptz;
  v_cur_id  uuid;
  v_clauses text[] := ARRAY[]::text[];
  v_errors  jsonb  := '[]'::jsonb;
  v_applied jsonb  := '[]'::jsonb;
  v_clause  jsonb;
  v_field   text;
  v_op      text;
  v_column  text;
  v_kind    text;
  v_desc    boolean := true;
  v_sort_col text := 'created_at';
  v_sort_fld text;
  v_where   text;
  v_ids     uuid[];
  v_rows    jsonb;
  v_total   integer;
  v_count   integer;
  v_next    text;
  v_last_at timestamptz;
  v_last_id uuid;
  v_cursor  text;
  v_keyed   text;
  v_merged  jsonb  := '[]'::jsonb;
BEGIN
  -- 023 · AUTHZ FIRST: decided before any read or validation, so the refusal
  -- is identical for every argument.
  IF NOT app.has_permission('tna:read') THEN
    RETURN app.err('FORBIDDEN', pg_catalog.jsonb_build_object(
      'requiredPermission','tna:read'));
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

  -- SAVED VIEW. `core.saved_view_object` (003) has no TNA value either — see
  -- §2's note, identical here.
  BEGIN
    v_merged := app._view_filters(v_tenant, p_view, 'TNA', p_filter);
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
      FROM (VALUES ('opportunity','opportunity_id','uuid'),('status','status','text'),
                   ('createdAt','created_at','ts'),('updatedAt','updated_at','ts'))
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
      FROM (VALUES ('createdAt','created_at'),('updatedAt','updated_at'))
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

  SELECT scope.o_total, scope.o_where INTO v_total, v_keyed
    FROM app._keyset_scope('core.tnas'::regclass, v_tenant, v_where,
                           v_sort_col, v_desc, v_cur_at, v_cur_id) AS scope;

  EXECUTE pg_catalog.format($q$
    SELECT COALESCE(pg_catalog.array_agg(p.id ORDER BY p.%I %s, p.id %s), ARRAY[]::uuid[])
      FROM (SELECT id, %I FROM core.tnas
             WHERE tenant_id = $1 AND %s
             ORDER BY %I %s, id %s
             LIMIT $2) AS p$q$,
    v_sort_col, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END,
    v_sort_col, v_keyed,
    v_sort_col, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END)
    INTO v_ids USING v_tenant, v_size;

  SELECT COALESCE(pg_catalog.jsonb_agg(core.get_tna(element.id::text) -> 'data'
                                       ORDER BY element.ord), '[]'::jsonb),
         pg_catalog.count(*)::integer
    INTO v_rows, v_count
    FROM pg_catalog.unnest(v_ids) WITH ORDINALITY AS element(id, ord);

  IF pg_catalog.array_length(v_ids, 1) IS NOT NULL THEN
    EXECUTE pg_catalog.format('SELECT %I, id FROM core.tnas WHERE tenant_id = $1 AND id = $2', v_sort_col)
      INTO v_last_at, v_last_id USING v_tenant, v_ids[pg_catalog.array_length(v_ids,1)];
  END IF;
  v_next := app._next_cursor('core.tnas'::regclass, v_tenant, v_where,
                             v_sort_col, v_desc, v_count, v_size, v_last_at, v_last_id);

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'data', v_rows,
    'page', pg_catalog.jsonb_build_object('next', v_next, 'total', v_total),
    'appliedFilters', v_applied));
END;
$fn$;

-- ── §5 · core.reopen_tna ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION core.reopen_tna(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
  v_row    core.tnas%ROWTYPE;
BEGIN
  -- 023 · AUTHZ FIRST, decided before any read or write so the refusal is
  -- byte-identical for every argument. A WRITE, so the refusal is a RAISE,
  -- not an `app.err`: it must not leave a partial write behind.
  IF NOT app.has_permission('tna:reopen') THEN
    RAISE EXCEPTION 'requester lacks %', 'tna:reopen'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
                       'code','FORBIDDEN','requiredPermission','tna:reopen')::text;
  END IF;

  SELECT tna.* INTO v_row FROM core.tnas AS tna
   WHERE tna.tenant_id = v_tenant
     AND (tna.id::text = p_id OR tna.ref = p_id)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such tna'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','NOT_FOUND')::text;
  END IF;

  -- LEGAL TRANSITION: COMPLETE -> REOPENED only, per the header note above. A
  -- TNA that was never completed has nothing to reopen; an already-REOPENED
  -- row is a no-op success, not a refusal, so a retried request is never told
  -- its second attempt did something wrong.
  IF v_row.status = 'DRAFT' OR v_row.status = 'SENT' THEN
    RAISE EXCEPTION 'tna has not been completed'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','VALIDATION_FAILED','fields', pg_catalog.jsonb_build_array(
                pg_catalog.jsonb_build_object(
                  'field','status','reason','NOT_COMPLETE','code', v_row.status::text)))::text;
  END IF;

  IF v_row.status = 'COMPLETE' THEN
    UPDATE core.tnas AS tna
       SET status = 'REOPENED', reopened_at = pg_catalog.now(), updated_at = pg_catalog.now()
     WHERE tna.tenant_id = v_tenant AND tna.id = v_row.id;
  END IF;

  -- The whole Tna comes back, not a bare status flag: the detail page
  -- re-renders from one payload and cannot drift from the record.
  RETURN core.get_tna(v_row.id::text);
END;
$fn$;

-- ═══ Grants ═══════════════════════════════════════════════════════════════

DO $grants$
DECLARE v_fn regprocedure;
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure FROM pg_catalog.pg_proc AS p
     WHERE p.pronamespace = 'core'::regnamespace
       AND p.proname IN ('search_organisations','list_opportunities',
         'get_organisation_suggestions','list_tnas','reopen_tna')
  LOOP
    EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_fn);
    EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_fn);
  END LOOP;
END
$grants$;

-- ═══ $verify$ ═══════════════════════════════════════════════════════════════

DO $verify_023$
DECLARE
  v_bad  text[];
  v_body text;
BEGIN
  -- V1 · one definition each, and the 018/020/021 posture: SECURITY DEFINER,
  -- search_path='', a 10s statement timeout, granted to authenticated only.
  SELECT pg_catalog.array_agg(g.name ORDER BY g.name) INTO v_bad
    FROM pg_catalog.unnest(ARRAY['search_organisations','list_opportunities',
         'get_organisation_suggestions','list_tnas','reopen_tna']) AS g(name)
   WHERE (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
           WHERE p.pronamespace = 'core'::regnamespace AND p.proname = g.name) <> 1
      OR NOT EXISTS (
           SELECT 1 FROM pg_catalog.pg_proc AS p
            WHERE p.pronamespace = 'core'::regnamespace AND p.proname = g.name
              AND p.prosecdef
              AND p.proconfig @> ARRAY['search_path=""']
              AND p.proconfig @> ARRAY['statement_timeout=10s']
              AND pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
              AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '023 verify V1: overload count or posture wrong on %', v_bad;
  END IF;

  -- V2 · the permission gate is the FIRST statement of every one of the five
  -- functions (the four reads plus the one write), checked the same way
  -- 021's V2 checks it: no `FROM core.`/`FROM app.` read precedes
  -- `app.has_permission(`.
  v_bad := NULL;
  DECLARE
    v_gate record;
    v_pos  integer;
  BEGIN
    FOR v_gate IN
      SELECT p.oid, p.proname FROM pg_catalog.pg_proc AS p
       WHERE p.pronamespace = 'core'::regnamespace
         AND p.proname IN ('search_organisations','list_opportunities',
           'get_organisation_suggestions','list_tnas','reopen_tna')
    LOOP
      v_body := app._body_sql(v_gate.oid::regprocedure);
      v_pos  := pg_catalog.strpos(v_body, 'app.has_permission(');
      IF v_pos = 0
         OR (pg_catalog.strpos(v_body, 'FROM core.') > 0 AND pg_catalog.strpos(v_body, 'FROM core.') < v_pos)
         OR (pg_catalog.strpos(v_body, 'FROM app.') > 0 AND pg_catalog.strpos(v_body, 'FROM app.') < v_pos) THEN
        v_bad := pg_catalog.array_append(v_bad, v_gate.proname::text);
      END IF;
    END LOOP;
  END;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '023 verify V2: no permission gate, or a read before it, in %', v_bad;
  END IF;

  -- V3 · WRITERS RETURN THROUGH READERS: every role holding `tna:reopen`
  -- holds `tna:read` (021's V3 pattern), and every holder of
  -- `organisation:suggestions:read` holds `organisation:read`.
  SELECT pg_catalog.array_agg(pg_catalog.format('%s holds %s but not %s', w.role, pair.w, pair.r)) INTO v_bad
    FROM (VALUES ('tna:reopen','tna:read'), ('organisation:suggestions:read','organisation:read'))
         AS pair(w, r)
    JOIN app.role_permissions AS w ON w.permission = pair.w
   WHERE NOT EXISTS (SELECT 1 FROM app.role_permissions AS r
                      WHERE r.role = w.role AND r.permission = pair.r);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '023 verify V3: a writer/reader would be refused by its own dependency: %', v_bad;
  END IF;

  -- V4 · `core.reopen_tna` names the schema's own `reopened_at` column and
  -- the CASE branches it depends on, so a future edit that removes either is
  -- caught here rather than by a screen going quiet in review.
  v_body := app._body_sql('core.reopen_tna(text)'::regprocedure);
  IF pg_catalog.strpos(v_body, 'reopened_at') = 0 THEN
    RAISE EXCEPTION '023 verify V4: core.reopen_tna does not set reopened_at';
  END IF;
END
$verify_023$;
