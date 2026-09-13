-- ═══════════════════════════════════════════════════════════════════════════
-- 018 · The golden-path RPC pack
-- ═══════════════════════════════════════════════════════════════════════════
--
-- DEFECT. `apps/web/src/shared/api/client.ts` declares 41 methods and
-- `rpcClient.ts` names 24 database functions in `RPC_NAMES`. NONE of them
-- exists. Every feature in the web app therefore degrades to a transport
-- failure (`PGRST202` / `42883`) and the product runs on fixtures. This is the
-- pack that makes the golden path real.
--
-- CHANGE. 23 `SECURITY DEFINER` functions in `core`, plus one
-- `security_invoker` view, plus seven internal `app._*` helpers. No existing
-- table, function, view, policy or grant is modified. Nothing in 001–013 is
-- touched. The three gate wrappers call 011 and add nothing.
--
-- WHAT THIS PACK IS NOT. It does not add RLS policies — those are 014's, and
-- §"THE 014 ORDERING HAZARD" below is the load-bearing note about that. It
-- does not add Edge Functions (ruling R-A) and calls no `pg_net` (ruling R-B).
-- It creates no table and no enum value.
--
-- ── THE 014 ORDERING HAZARD ────────────────────────────────────────────────
--
-- MEASURED, not reasoned, on a PostgreSQL 17.11 shim with 001–013 applied:
-- every table in `core` is `ENABLE ROW LEVEL SECURITY` **and**
-- `FORCE ROW LEVEL SECURITY` with **zero policies**. FORCE removes the owner's
-- exemption. On a project where the definer's owner is not `BYPASSRLS`, every
-- read in this pack therefore returns ZERO ROWS until 014 creates the policies
-- — and it does so silently, as an empty list rather than an error.
--
-- The local shim's `postgres` IS a superuser, so the pin in
-- `supabase/tests/test_018_golden_path_rpcs.sql` passes here and would pass on
-- a project that has the same attribute. That is exactly the false green
-- `supabase/migrations/migration-catalog.md` warns about under "How this set
-- was validated". **018 must not be applied to a hosted project before 014.**
-- T0 of the pin asserts the ordering out loud rather than leaving it to a
-- reader.
--
-- ── POSTURE, once, and every function in this file obeys it ────────────────
--
--   schema        `core`. `config.toml:18` exposes ["public","core",
--                 "graphql_public"]; `app` is deliberately absent, which is
--                 what keeps the gate internals unreachable from a browser.
--   security      SECURITY DEFINER. The bodies read `app.require_tenant_id()`,
--                 `app.current_actor()`, `app.ok()` and `app.err()`, all of
--                 which are REVOKEd from `authenticated` by 001 §6 and
--                 002:614-619. The definer owner keeps EXECUTE; the caller
--                 never gets it. Granting those to `authenticated` to make a
--                 function work is the failure this split exists to prevent.
--   search_path   `SET search_path = ''`. The EXACT stored `proconfig` element
--                 is then `search_path=""`, which is what the pin asserts and
--                 what `supabase/CLAUDE.md` rule 1 requires. NOTE: doc 09 §0's
--                 own pin example asserts `ARRAY['search_path=']`, which is
--                 the wrong string and would fail against every function in
--                 001–013 as well as this pack. Reported, not copied.
--   timeout       `SET statement_timeout = '10s'` per doc 09 §0.
--   envelope      Every return is `app.ok(...)` or `app.err(...)`. No body
--                 builds `jsonb_build_object('success', ...)` by hand —
--                 `check:rpc` E1 is BROKEN on that, because a third top-level
--                 key beside `data` flips every client in the app from
--                 auto-unwrap to pass-through at once.
--   tenant        `app.require_tenant_id()`. No function takes a tenant
--                 argument; a `p_tenant_id` is a cross-tenant read waiting for
--                 a caller to pass the wrong value.
--   grants        REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE TO authenticated.
--                 `authenticated` is necessary, never sufficient — the body
--                 re-derives tenant and role.
--
-- ── HOW A REFUSAL TRAVELS ──────────────────────────────────────────────────
--
-- Two mechanisms, and doc 09 §0 is explicit that they are not interchangeable:
-- `app.err(code, details)` COMMITS and is seen by `check:rpc` E1;
-- `RAISE ... USING ERRCODE = 'TRNOS'` ROLLS BACK and is not. The rule applied
-- throughout this file:
--
--   * READ functions refuse with `app.err`. They have written nothing, so
--     there is nothing to roll back, and the envelope is the better wire shape.
--   * WRITE functions refuse with RAISE TRNOS, so a refusal never leaves a
--     partial write behind. SIX FUNCTIONS WRITE, not the two this note used to
--     name: `create_proposal`, `put_quotation`, `patch_enquiry_extraction`,
--     `add_proposal_section`, `put_proposal_section` and
--     `regenerate_proposal_section`. The last of those used `app.err` on all
--     four of its refusals; its refusals happened to precede its first write,
--     which is exactly the property this rule exists so that nobody has to
--     re-verify by hand for each new branch. It is on RAISE with the other
--     five now, and it needs to be: it enqueues a job.
--   * The three 011 wrappers pass 011's own RAISE straight through.
--
-- ── THE 014/018 GRANT NOTE ─────────────────────────────────────────────────
--
-- 014 is being authored on `cloud/migrations` and is not merged. Where this
-- pack needs a grant to `authenticated` it makes it here (the 23 functions and
-- the one view). If 014 also grants any of them the statements are idempotent
-- and the later one wins with the same result. **The merge must check the
-- ordering**; see the PR body.
--
-- ── THE 7-POINT RPC CONTRACT CHECK, WORKED ─────────────────────────────────
--
--  1 ENVELOPE. Success `{success,data}` from `app.ok`; failure
--    `{success,error}` from `app.err`, or a `TRNOS` detail bag the client's
--    `classifyTransportFailure()` parses. Zero hand-built envelopes: the only
--    `jsonb_build_object('success'` in `supabase/migrations` remains 001's own,
--    where `app.ok`/`app.err` are DEFINED. Verified by `npm run check:rpc` E1.
--  2 UNWRAP. `app.ok` guarantees `data` is the sole non-`success` key, so the
--    client auto-unwraps. Every new field in this pack goes INSIDE `data`.
--    `list_approvals` puts `groups` beside `data` **one level down**, inside
--    the `data` object, which doc 09 §11 states is fine and is what the
--    contract's `ApprovalListResponse` declares.
--  3 RpcMap. `RPC_NAMES` in `rpcClient.ts` and `TrainOsClient` in `client.ts`
--    already name these functions and their argument names, and are unchanged
--    by this migration. The SQL was written to those names, not the reverse:
--    every `p_*` argument spelling in this file was read off `rpcClient.ts`.
--  4 CALL SITES. All 23 are called from `rpcClient.ts`. `me_profile` is the
--    24th name and is NOT created here — see "NOT IMPLEMENTED" below. Zero
--    dead functions.
--  5 CASTS. No `as unknown as` is added; this migration touches no TypeScript.
--    `check:rpc` E2 stays clean.
--  6 RELOAD / RESTORE. `me`, `navigation` and `badge_counts` are the shell
--    bootstrap and run on every reload and session restore. All three are
--    reads with no idempotency surface, so the restore path and the fresh path
--    are the same path.
--  7 PUBLIC ROUTES. Nothing here is reachable by `anon`: every function is
--    REVOKEd from PUBLIC and anon and granted only to `authenticated`. The
--    portal's public surface is not 018's.
--
-- ── NOT IMPLEMENTED, and why, stated here rather than discovered later ─────
--
-- `core.me_profile()` — the 24th name in `RPC_NAMES`. Ruled R14 requires
-- eleven fields (`location`, `jobTitle`, `department`, `staffNumber`,
-- `moduleCount`, `tenant.code`, and the five-field `session` block) that NO
-- table in 001–013 carries: `public.user_profiles` holds only
-- `display_name, email, locale, timezone, theme, avatar_url`. Every one of
-- those fields is REQUIRED by `MeProfile`. A function that returned a
-- fabricated staff number and an invented two-factor state would be worse than
-- one that does not exist, because the client already degrades an absent
-- function to a readable "not deployed" (doc 09 §12 makes exactly this
-- argument about stubs). It needs an HR/profile table first. Reported, not
-- stubbed.
--
-- ── RULING R-C, verified ───────────────────────────────────────────────────
--
-- Neither `core.tax_policies` nor `app.resolve_tax_policy()` exists in 001–013
-- (probed on the shim; the only tax object is `core.tenant_tax_profiles`,
-- which carries an SST REGISTRATION NUMBER and no rate). 018 does not invent
-- either. It also does not need them: the contract's `Quotation`
-- (`packages/contract/src/domain/proposals.ts`) carries NO tax field at all —
-- SST lives on `core.invoices.sst_rate`, which is 010's and not this pack's.
-- The pin emits an explicit NOTICE for the skipped assertion.
--
-- ── THE MONEY RULE IS 007'S, AND STAYS 007'S ───────────────────────────────
--
-- doc 09 §10 asks 018 to implement §18 money. 007 ALREADY DID, in the schema:
-- `core.quotation_lines.total_sen` is GENERATED as
-- `app.round_half_up_sen(unit_price_sen * qty)`; `core.quotations`
-- `margin_sen`, `margin_rate`, `margin_floor_price_sen`, `floor_price_sen`,
-- `binding_floor_basis`, `below_floor`, `commission_sen` and
-- `display_per_pax_sen` are all GENERATED; `core.quotation_recalc()` sums the
-- ROUNDED lines onto the header; and two DEFERRABLE constraint triggers
-- (`trg_quotation_reconciled`, `trg_quotation_floor`) refuse a header that
-- does not equal its lines and a below-floor price with no `DISCOUNT_APPROVE`
-- behind it.
--
-- So `core.put_quotation` writes LINES and lets the database do the
-- arithmetic. It computes no total of its own. A second money implementation
-- here is precisely the drift doc 09 §10 warns about, and the pin asserts the
-- body contains no float cast and no arithmetic that bypasses
-- `app.round_half_up_sen`. The one thing the function does add is
-- `SET CONSTRAINTS ... IMMEDIATE`, so the two DEFERRED assertions fire INSIDE
-- the call and can be translated into the contract's error codes instead of
-- surfacing at COMMIT as an untranslatable integrity violation.
--
-- Spine untouched: the action envelope is reached only through
-- `core.perform_action`, which is a one-expression wrapper over
-- `app.perform_action`. No branch is bolted into the gate. Pipeline stage
-- names and order render from `core.pipelines` / `core.pipeline_steps` in both
-- `core.navigation` and `core.get_pipeline_config`; no stage list is inlined.
-- ═══════════════════════════════════════════════════════════════════════════

SET client_min_messages = warning;

-- ═══ 1 · Internal projection helpers ═══════════════════════════════════════
--
-- These live in `app`, not `core`, because `app` is not an exposed schema and
-- nothing here should ever be reachable from a browser. They are
-- SECURITY INVOKER on purpose: each is only ever called from inside a
-- `SECURITY DEFINER` function in `core`, where `current_user` is already the
-- definer's owner, so an invoker helper inherits exactly the privileges its
-- caller has and adds none of its own. Leading underscore + REVOKE ALL is
-- `supabase/CLAUDE.md` rule 7.

CREATE OR REPLACE FUNCTION app._money(p_amount bigint, p_currency text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn$
  -- §1 Money: integer minor units and a currency, or nothing at all. A null
  -- amount is `null` on the wire, never `{amount: 0}` — a zero is a price and
  -- an absence is not.
  SELECT CASE
           WHEN p_amount IS NULL THEN NULL
           ELSE pg_catalog.jsonb_build_object(
                  'amount', p_amount,
                  'currency', COALESCE(pg_catalog.rtrim(p_currency), 'MYR'))
         END;
$fn$;

CREATE OR REPLACE FUNCTION app._actor(p_kind text, p_id text, p_name text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn$
  -- §1 Actor. `name` is omitted rather than nulled when unknown, because the
  -- contract types it optional and a null name renders as the word "null".
  SELECT CASE
           WHEN p_id IS NULL THEN NULL
           ELSE pg_catalog.jsonb_build_object('id', p_id, 'kind', COALESCE(p_kind,'SYSTEM'))
                || CASE WHEN p_name IS NULL THEN '{}'::jsonb
                        ELSE pg_catalog.jsonb_build_object('name', p_name) END
         END;
$fn$;

CREATE OR REPLACE FUNCTION app._provenance(
  p_subject_table text, p_subject_id uuid, p_field text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $fn$
DECLARE v_row core.provenance%ROWTYPE; v_out jsonb;
BEGIN
  -- ABSENT MEANS HUMAN-AUTHORED. This returns NULL when no row matches, and
  -- every caller then omits the `provenance` KEY entirely rather than emitting
  -- a null one — the AI badge renders on presence, so a null would badge every
  -- hand-typed field in the product.
  --
  -- THE TENANT PREDICATE IS NOT OPTIONAL, and it is derived here rather than
  -- taken as an argument — a `p_tenant_id` parameter is a cross-tenant read
  -- waiting for one caller to pass the wrong value, and adding one would also
  -- create a SECOND OVERLOAD of this function (the PGRST203 trap the $verify$
  -- block guards against for `core`). This read previously filtered on
  -- `subject_table` and `subject_id` alone. Not reachable as a leak today —
  -- `subject_id` is always a uuid from a row the caller's tenant owns, and 014
  -- grants `authenticated` no write anywhere in `core`, so nobody can plant a
  -- provenance row with a chosen subject_id — but it broke the posture this
  -- file states at §"tenant", and 014's verify check 10 requires `tenant_id` to
  -- LEAD an index on every core table, so a lookup without it cannot use one.
  -- On what becomes the largest table in the system that is a sequential scan
  -- per projected field.
  SELECT prov.* INTO v_row
    FROM core.provenance AS prov
   WHERE prov.tenant_id      = app.require_tenant_id()
     AND prov.subject_table = p_subject_table
     AND prov.subject_id    = p_subject_id
     AND prov.field IS NOT DISTINCT FROM p_field
   ORDER BY prov.updated_at DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- §1: "`editedBy` … set when a human edited an AI value; FLIPS ORIGIN TO
  -- AI_SUGGESTED." The flip is DERIVED HERE rather than written, and the reason
  -- is a measurement: `core.provenance.origin` is in 005's immutable-column
  -- list, so `UPDATE … SET origin` raises
  -- `IMMUTABLE_COLUMN: core.provenance.origin cannot be changed once set`.
  -- Found by running the pin, not by reading the schema.
  --
  -- The immutability is RIGHT and the contract is RIGHT, and they are talking
  -- about different things. What the column records is where the value CAME
  -- FROM, which a later edit does not change — a model really did generate it,
  -- and rewriting that erases the audit trail the column exists to keep. What
  -- the contract describes is what the BADGE should say now, which is
  -- "AI, edited". So the stored fact stays `AI_GENERATED`, `edited_by` records
  -- the human, and the WIRE value is derived from the pair. One projection,
  -- here, so no screen has to compose that rule itself.
  v_out := pg_catalog.jsonb_build_object('origin',
    CASE WHEN v_row.edited_by IS NOT NULL
          AND v_row.origin::text IN ('AI_GENERATED','AI_EXECUTED')
         THEN 'AI_SUGGESTED'
         ELSE v_row.origin::text END);

  IF v_row.confidence    IS NOT NULL THEN v_out := v_out || pg_catalog.jsonb_build_object('confidence', v_row.confidence); END IF;
  IF v_row.agent_id      IS NOT NULL THEN v_out := v_out || pg_catalog.jsonb_build_object('agentId', v_row.agent_id); END IF;
  IF v_row.run_id        IS NOT NULL THEN v_out := v_out || pg_catalog.jsonb_build_object('runId', v_row.run_id::text); END IF;
  IF v_row.generated_at  IS NOT NULL THEN v_out := v_out || pg_catalog.jsonb_build_object('generatedAt', v_row.generated_at); END IF;
  IF v_row.tier          IS NOT NULL THEN v_out := v_out || pg_catalog.jsonb_build_object('tier', v_row.tier); END IF;
  IF v_row.model         IS NOT NULL THEN v_out := v_out || pg_catalog.jsonb_build_object('model', v_row.model); END IF;
  IF v_row.provider      IS NOT NULL THEN v_out := v_out || pg_catalog.jsonb_build_object('provider', v_row.provider::text); END IF;
  IF v_row.cache_hit_rate IS NOT NULL THEN v_out := v_out || pg_catalog.jsonb_build_object('cacheHitRate', v_row.cache_hit_rate); END IF;
  IF v_row.jury          IS NOT NULL THEN v_out := v_out || pg_catalog.jsonb_build_object('jury', v_row.jury); END IF;

  -- §1: `editedBy` is set when a human edited an AI value. All three parts or
  -- none — a half-populated `editedBy` is worse than an absent one.
  IF v_row.edited_by IS NOT NULL AND v_row.edited_at IS NOT NULL THEN
    v_out := v_out || pg_catalog.jsonb_build_object('editedBy',
      pg_catalog.jsonb_build_object(
        'id',   v_row.edited_by::text,
        'name', COALESCE(v_row.edited_by_name, v_row.edited_by::text),
        'at',   v_row.edited_at));
  END IF;

  -- `sources` is NOT NULL DEFAULT '[]' in 005, so emit the key only when there
  -- is actually a citation behind the value.
  IF pg_catalog.jsonb_typeof(v_row.sources) = 'array'
     AND pg_catalog.jsonb_array_length(v_row.sources) > 0 THEN
    v_out := v_out || pg_catalog.jsonb_build_object('sources', v_row.sources);
  END IF;

  RETURN v_out;
END;
$fn$;

CREATE OR REPLACE FUNCTION app._provenanced(p_value jsonb, p_provenance jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn$
  -- §4 ProvenancedValue. `value` is ALWAYS present and may legitimately be
  -- JSON null — the contract's own example is a budget the model is confident
  -- is absent. So this builds the object explicitly instead of stripping
  -- nulls, which would delete the very case the shape exists to carry.
  SELECT pg_catalog.jsonb_build_object('value', COALESCE(p_value, 'null'::jsonb))
         || CASE WHEN p_provenance IS NULL THEN '{}'::jsonb
                 ELSE pg_catalog.jsonb_build_object('provenance', p_provenance) END;
$fn$;

CREATE OR REPLACE FUNCTION app._cursor_encode(p_at timestamptz, p_id uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn$
  -- KEYSET, not offset (doc 09 §5). The cursor is the sort key plus the tie
  -- breaker, base64'd so it reads as opaque and nobody builds one by hand.
  SELECT pg_catalog.encode(pg_catalog.convert_to(
           pg_catalog.to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')
           || '|' || p_id::text, 'UTF8'), 'base64');
$fn$;

CREATE OR REPLACE FUNCTION app._cursor_decode(p_cursor text)
RETURNS TABLE (at timestamptz, id uuid)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $fn$
DECLARE v_plain text; v_parts text[];
BEGIN
  -- A malformed cursor is VALIDATION_FAILED at the caller, never a silently
  -- ignored filter that shows the reader page one again.
  BEGIN
    v_plain := pg_catalog.convert_from(pg_catalog.decode(p_cursor, 'base64'), 'UTF8');
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'MALFORMED_CURSOR' USING ERRCODE = 'invalid_text_representation';
  END;
  v_parts := pg_catalog.string_to_array(v_plain, '|');
  IF pg_catalog.array_length(v_parts, 1) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'MALFORMED_CURSOR' USING ERRCODE = 'invalid_text_representation';
  END IF;
  BEGIN
    at := (v_parts[1] || '+00')::timestamptz;
    id := v_parts[2]::uuid;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'MALFORMED_CURSOR' USING ERRCODE = 'invalid_text_representation';
  END;
  RETURN NEXT;
END;
$fn$;

CREATE OR REPLACE FUNCTION app._page_size(p_page jsonb)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $fn$
DECLARE v_size integer;
BEGIN
  IF p_page IS NULL OR NOT (p_page ? 'size') OR p_page -> 'size' = 'null'::jsonb THEN
    RETURN 50;
  END IF;
  IF pg_catalog.jsonb_typeof(p_page -> 'size') <> 'number' THEN
    RAISE EXCEPTION 'PAGE_SIZE_NOT_A_NUMBER' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_size := (p_page ->> 'size')::integer;
  IF v_size < 1 OR v_size > 200 THEN
    RAISE EXCEPTION 'PAGE_SIZE_OUT_OF_RANGE' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN v_size;
END;
$fn$;

CREATE OR REPLACE FUNCTION app._predicate(
  p_column text, p_kind text, p_op text, p_value jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $fn$
DECLARE v_cast text; v_col text; v_items text[];
BEGIN
  -- Builds ONE §1 filter clause as SQL text. The COLUMN NAME always arrives
  -- from a caller-side whitelist and is emitted through `%I`; the VALUE always
  -- goes through `%L`. Neither can carry an injection. An unsupported op
  -- RAISEs rather than being dropped — doc 09 §5: fail closed, because an
  -- ignored filter shows rows the reader asked to exclude.
  v_cast := CASE p_kind
              WHEN 'number' THEN 'numeric'
              WHEN 'bool'   THEN 'boolean'
              WHEN 'uuid'   THEN 'uuid'
              WHEN 'ts'     THEN 'timestamptz'
              ELSE 'text'
            END;
  -- An enum column compared as text needs the cast on the COLUMN, so an enum
  -- and a plain text column filter identically from the caller's side.
  v_col := CASE WHEN v_cast = 'text' THEN pg_catalog.format('(%I)::text', p_column)
                ELSE pg_catalog.format('%I', p_column) END;

  IF p_op IN ('in', 'between') THEN
    IF pg_catalog.jsonb_typeof(p_value) <> 'array' THEN
      RAISE EXCEPTION 'OP_NEEDS_ARRAY' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    SELECT pg_catalog.array_agg(element.value) INTO v_items
      FROM pg_catalog.jsonb_array_elements_text(p_value) AS element(value);
  END IF;

  CASE p_op
    WHEN 'eq' THEN
      IF p_value = 'null'::jsonb THEN
        RETURN pg_catalog.format('%s IS NULL', v_col);
      END IF;
      RETURN pg_catalog.format('%s = %L::%s', v_col, p_value #>> '{}', v_cast);
    WHEN 'in' THEN
      IF v_items IS NULL OR pg_catalog.array_length(v_items, 1) IS NULL THEN
        RETURN 'false';   -- `in []` matches nothing, which is what was asked.
      END IF;
      RETURN pg_catalog.format('%s = ANY (%L::%s[])', v_col, v_items, v_cast);
    WHEN 'gte' THEN
      RETURN pg_catalog.format('%s >= %L::%s', v_col, p_value #>> '{}', v_cast);
    WHEN 'lte' THEN
      RETURN pg_catalog.format('%s <= %L::%s', v_col, p_value #>> '{}', v_cast);
    WHEN 'contains' THEN
      IF v_cast <> 'text' THEN
        RAISE EXCEPTION 'CONTAINS_ON_NON_TEXT' USING ERRCODE = 'invalid_parameter_value';
      END IF;
      RETURN pg_catalog.format('%s ILIKE %L', v_col, '%' || (p_value #>> '{}') || '%');
    WHEN 'between' THEN
      IF pg_catalog.array_length(v_items, 1) IS DISTINCT FROM 2 THEN
        RAISE EXCEPTION 'BETWEEN_NEEDS_TWO' USING ERRCODE = 'invalid_parameter_value';
      END IF;
      RETURN pg_catalog.format('(%s >= %L::%s AND %s <= %L::%s)',
               v_col, v_items[1], v_cast, v_col, v_items[2], v_cast);
    ELSE
      RAISE EXCEPTION 'UNSUPPORTED_OP' USING ERRCODE = 'invalid_parameter_value';
  END CASE;
END;
$fn$;

-- ── Saved-view resolution, extracted ────────────────────────────────────────
--
-- `core.list_follow_ups`, `core.list_proposals` and `core.list_quotations` all
-- DECLARED `p_view text DEFAULT NULL` and never read the variable. A reader who
-- saved a view restricting them to their own proposals and asked for it got
-- EVERY proposal in the tenant, with `appliedFilters: []`, `success: true`, and
-- no error. That is the exact failure §5 of this file forbids in its own words:
-- "FAIL CLOSED … never an ignored clause: ignoring a filter shows rows the
-- reader explicitly asked to exclude." An ignored VIEW is an ignored filter.
--
-- THE OBJECT IS THE GATE, AND IT IS READ OFF THE ENUM RATHER THAN HARDCODED.
-- `core.saved_view_object` (003:352) has exactly three values — LEAD, ENQUIRY,
-- APPROVAL. There is no FOLLOW_UP, PROPOSAL or QUOTATION, so a saved view for
-- those three lists CANNOT EXIST, and 018 creates no enum value (its own header
-- says so). Those lists therefore REFUSE a `p_view` with a spec'd code rather
-- than silently dropping it. The parameter stays in the signature: PostgREST
-- resolves by named arguments, so removing it would 404 every client call that
-- sends `p_view` against a migrated database (the PGRST202 trap).
--
-- The check is `p_object = ANY (enum_range)`, so on the day the contract adds
-- PROPOSAL to `core.saved_view_object`, these three start resolving views with
-- no further edit — the refusal is derived from the schema, not asserted about
-- it.
--
-- Raises `invalid_parameter_value`; every caller translates that into
-- VALIDATION_FAILED with `details.fields[0]`, which is the shape §5 already
-- uses for an unknown filter field.

CREATE OR REPLACE FUNCTION app._view_filters(
  p_tenant  uuid,
  p_view    text,
  p_object  text,
  p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $fn$
DECLARE v_view core.saved_views%ROWTYPE; v_out jsonb;
BEGIN
  IF NULLIF(p_view, '') IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  IF p_object IS NULL
     OR NOT (p_object = ANY (
       SELECT pg_catalog.unnest(pg_catalog.enum_range(NULL::core.saved_view_object))::text)) THEN
    RAISE EXCEPTION 'UNSUPPORTED_VIEW_OBJECT' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT saved.* INTO v_view FROM core.saved_views AS saved
   WHERE saved.tenant_id = p_tenant
     AND saved.deleted_at IS NULL
     AND saved.object = p_object::core.saved_view_object
     AND (saved.id::text = p_view OR saved.ref = p_view);
  IF NOT FOUND THEN
    -- Cross-tenant and absent are the SAME answer, as everywhere else in this
    -- file: a view id that resolves in another tenant must not be an existence
    -- oracle.
    RAISE EXCEPTION 'UNKNOWN_VIEW' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- REQUEST FILTERS WIN on the same field, and `source` on each applied filter
  -- is what lets the UI show a reader WHY rows are missing.
  SELECT COALESCE(pg_catalog.jsonb_agg(
           element.value || pg_catalog.jsonb_build_object('source','VIEW')), '[]'::jsonb)
    INTO v_out
    FROM pg_catalog.jsonb_array_elements(COALESCE(v_view.filters, '[]'::jsonb)) AS element(value)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_catalog.jsonb_array_elements(COALESCE(p_request,'[]'::jsonb)) AS req(value)
      WHERE req.value ->> 'field' = element.value ->> 'field');
  RETURN v_out;
END;
$fn$;

-- ── The keyset engine, extracted ────────────────────────────────────────────
--
-- WHY THESE TWO FUNCTIONS EXIST. Five list RPCs in this file page the same way,
-- and before this pair each of them owned its own copy of the ordering. Two
-- copies got it wrong, in OPPOSITE directions:
--
--   * `core.list_enquiries` appended the keyset clause to `v_where` and THEN
--     counted, so `page.total` was the rows remaining AFTER the cursor. With
--     120 matches at size 50 the list header read 120, then 70, then 20 — the
--     total counted down as the reader paged.
--   * The other four counted first (right) but decided `next` from
--     `v_count = v_size AND v_count < v_total` (wrong). With exactly 100
--     matches at size 50, page two returns 50 rows and 50 < 100 holds, so a
--     non-null cursor points PAST the last row; the client fetches page three
--     and renders an empty list. Every exact multiple of the page size.
--
-- The fix is not "correct both copies". It is to make the ORDER OF OPERATIONS
-- unavailable to a caller. `app._keyset_scope` counts off the filter-only
-- predicate and returns the keyset-extended one, so counting after the keyset
-- is not an expressible mistake; `app._next_cursor` asks the table whether a
-- row exists beyond the last row of the page, so "is there a next page" is
-- answered by the data rather than by arithmetic over two counts.
--
-- NOT SECURITY DEFINER, like every other helper in §1: both are only ever
-- reached from a definer function in `core`, and EXECUTE is revoked below.

CREATE OR REPLACE FUNCTION app._keyset_scope(
  p_relation regclass,
  p_tenant   uuid,
  p_where    text,
  p_sort_col text,
  p_desc     boolean,
  p_cur_at   timestamptz,
  p_cur_id   uuid,
  p_date_sort boolean DEFAULT false,
  OUT o_total integer,
  OUT o_where text)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $fn$
BEGIN
  IF p_tenant IS NULL THEN
    RAISE EXCEPTION '_keyset_scope: an explicit tenant is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- THE COUNT HAPPENS FIRST AND OFF `p_where`, which is the FILTER-ONLY
  -- predicate. The keyset clause is built afterwards and returned separately,
  -- so a caller cannot count the post-cursor remainder by accident.
  EXECUTE pg_catalog.format(
    'SELECT pg_catalog.count(*)::integer FROM %s WHERE tenant_id = $1 AND %s',
    p_relation::text, p_where) INTO o_total USING p_tenant;

  o_where := p_where;
  IF p_cur_at IS NOT NULL THEN
    -- The tie-breaker is the id, so a page boundary landing inside a group of
    -- equal sort keys neither drops nor repeats a row. `p_date_sort` casts a
    -- DATE sort column to timestamptz so it compares against the cursor's own
    -- type; it is a boolean rather than a cast string because a cast string
    -- would be one more piece of caller-supplied SQL in a format().
    o_where := o_where || pg_catalog.format(
      ' AND (%I%s, id) %s (%L::timestamptz, %L::uuid)',
      p_sort_col, CASE WHEN p_date_sort THEN '::timestamptz' ELSE '' END,
      CASE WHEN p_desc THEN '<' ELSE '>' END, p_cur_at, p_cur_id);
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION app._next_cursor(
  p_relation  regclass,
  p_tenant    uuid,
  p_where     text,
  p_sort_col  text,
  p_desc      boolean,
  p_count     integer,
  p_size      integer,
  p_last_at   timestamptz,
  p_last_id   uuid,
  p_date_sort boolean DEFAULT false)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $fn$
DECLARE v_more boolean;
BEGIN
  -- A SHORT PAGE IS THE LAST PAGE, and needs no lookahead.
  IF p_count IS NULL OR p_size IS NULL OR p_count < p_size OR p_count = 0
     OR p_last_at IS NULL OR p_last_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- A FULL PAGE IS NOT EVIDENCE OF A NEXT ONE. `count = size AND count < total`
  -- says yes on every exact-multiple last page; an EXISTS past the last row of
  -- the page says no, and says it from the table rather than from arithmetic.
  -- `p_where` may be the filter-only predicate or the keyset-extended one:
  -- rows after the LAST ROW OF THIS PAGE are a subset of rows after the
  -- cursor, so the answer is the same either way.
  EXECUTE pg_catalog.format(
    'SELECT pg_catalog.count(*) > 0 FROM (SELECT 1 FROM %s '
    'WHERE tenant_id = $1 AND %s AND (%I%s, id) %s ($2, $3) LIMIT 1) AS lookahead',
    p_relation::text, p_where, p_sort_col,
    CASE WHEN p_date_sort THEN '::timestamptz' ELSE '' END,
    CASE WHEN p_desc THEN '<' ELSE '>' END)
    INTO v_more USING p_tenant, p_last_at, p_last_id;

  IF NOT v_more THEN
    RETURN NULL;
  END IF;
  RETURN app._cursor_encode(p_last_at, p_last_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION app._body_sql(p_fn regprocedure)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$
  -- `pg_get_functiondef` returns the body INCLUDING its comments, so a body
  -- check that greps the raw text fails on a comment that merely NAMES the
  -- thing it forbids. Measured, not theorised: the first run of 018's V9 pin
  -- tripped on its own explanatory comment about `net.http_post`. This strips
  -- line comments and block comments so a pin tests CODE, not prose.
  SELECT pg_catalog.regexp_replace(
           pg_catalog.regexp_replace(
             pg_catalog.pg_get_functiondef(p_fn), '/\*.*?\*/', ' ', 'gs'),
           '--[^\n]*', ' ', 'g');
$fn$;

REVOKE ALL ON FUNCTION app._body_sql(regprocedure) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION app._money(bigint, text)                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app._actor(text, text, text)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app._provenance(text, uuid, text)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app._provenanced(jsonb, jsonb)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app._cursor_encode(timestamptz, uuid)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app._cursor_decode(text)                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app._page_size(jsonb)                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app._predicate(text, text, text, jsonb)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app._view_filters(uuid, text, text, jsonb)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app._keyset_scope(regclass, uuid, text, text, boolean, timestamptz, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app._next_cursor(regclass, uuid, text, text, boolean, integer, integer, timestamptz, uuid, boolean)
  FROM PUBLIC, anon, authenticated;

-- ═══ 2 · The three gate wrappers are 014's, NOT 018's ══════════════════════
--
-- 018 ORIGINALLY SHIPPED THESE AND NO LONGER DOES. `014_rls_policies_and_
-- client_grants.sql` §5 (014:646-712) creates `core.perform_action`,
-- `core.decide_approval` and `core.bulk_decide_approvals`, grants them to
-- `authenticated`, comments them and pins their arity in `test_014`. Two
-- implementations of one wrapper is the divergence root `CLAUDE.md` calls a
-- defect, so the newer pack yields rather than adding a second.
--
-- THIS WAS NOT A STYLE CALL. It was a live PGRST203 ambiguity, caught by 018's
-- own V1 overload pin the first time the pack was applied on top of 014:
--
--     018 verify V1: core.decide_approval has 2 definitions, expected exactly 1
--
-- 014's signature is `(uuid, text, text, text, text)` — it exposes
-- `p_expected_diff_hash` to the caller. 018's was `(uuid, text, text, text)`,
-- matching what `rpcClient.ts` sends today and passing `NULL` for the hash.
-- `CREATE OR REPLACE FUNCTION` matches on the ARGUMENT LIST, so the two did not
-- replace one another: they became overloads differing only by a defaulted
-- trailing argument, which makes every short call ambiguous.
--
-- 014'S IS THE BETTER ONE AND IS THE ONE THAT SURVIVES. Doc 09 §11 asks for a
-- wrapper that "passes all five arguments"; 018's passed five to
-- `app.decide_approval` but let a caller supply only four, so the §7 diff
-- guarantee could never be wired without a signature change and a redeploy.
-- 014's exposes the hash today, so the day the approval detail screen can carry
-- the hash it rendered, that is a client change alone. The client sending four
-- named arguments resolves against 014's five-argument function because
-- PostgREST binds by NAME and the fifth carries a DEFAULT.
--
-- What 018 keeps is the ASSERTION. §12's V5/V6 pins now check 014's functions
-- rather than its own: single overload, definer posture, granted to
-- `authenticated`, `app.*` still not granted, and the five-argument call into
-- `app.decide_approval` intact. A pin that outlives the code it was written for
-- is the point of writing it structurally.

-- ── Cleaning up 018's OWN former object ────────────────────────────────────
--
-- An earlier revision of 018 created `core.decide_approval(uuid,text,text,text)`
-- — four arguments, no diff hash. Any database that ran that revision still
-- carries it, and it does not go away by itself: 014's five-argument version
-- is a DIFFERENT signature, so `CREATE OR REPLACE` adds rather than replaces
-- and the two sit side by side as overloads. PostgREST then cannot resolve a
-- four-named-argument call and answers PGRST203 for every decision in the
-- product.
--
-- This drops 018's own former function and nothing else. It is signature-
-- qualified, so 014's five-argument function is untouched, and it is a no-op
-- on a database that never ran the earlier revision.
DROP FUNCTION IF EXISTS core.decide_approval(uuid, text, text, text);

-- ═══ 3 · Identity and shell ════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION core.me()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant      uuid := app.require_tenant_id();
  v_actor       record;
  v_member      public.memberships%ROWTYPE;
  v_profile     public.user_profiles%ROWTYPE;
  v_tenant_row  public.tenants%ROWTYPE;
  v_permissions jsonb;
  v_user_id     uuid;
BEGIN
  SELECT actor.* INTO v_actor FROM app.current_actor() AS actor;

  -- NEVER A PARTIAL `me`. A shell that renders with a null role renders every
  -- gate open, so no role is FORBIDDEN — the same condition 011:107 raises on.
  IF v_actor.role IS NULL OR v_actor.actor_id IS NULL THEN
    RETURN app.err('FORBIDDEN',
      pg_catalog.jsonb_build_object('reason', 'NO_APP_ROLE'));
  END IF;

  SELECT tenant.* INTO v_tenant_row FROM public.tenants AS tenant
   WHERE tenant.id = v_tenant;

  -- A HUMAN actor id is an `auth.uid()`; an AGENT actor id is the agent's own
  -- string and is deliberately not a uuid (002: `created_by_id` is text
  -- because agents are not rows in a user table). Cast defensively rather than
  -- letting an agent principal die on `invalid_text_representation`.
  IF v_actor.actor_kind = 'HUMAN' THEN
    BEGIN
      v_user_id := v_actor.actor_id::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_user_id := NULL;
    END;
  END IF;

  IF v_user_id IS NOT NULL THEN
    SELECT profile.* INTO v_profile FROM public.user_profiles AS profile
     WHERE profile.tenant_id = v_tenant AND profile.user_id = v_user_id;
    SELECT membership.* INTO v_member FROM public.memberships AS membership
     WHERE membership.tenant_id = v_tenant AND membership.user_id = v_user_id;
  ELSE
    SELECT membership.* INTO v_member FROM public.memberships AS membership
     WHERE membership.tenant_id = v_tenant AND membership.agent_id = v_actor.actor_id;
  END IF;

  IF v_member.tenant_id IS NULL THEN
    RETURN app.err('FORBIDDEN',
      pg_catalog.jsonb_build_object('reason', 'NO_MEMBERSHIP'));
  END IF;

  -- §2: permissions travel as a LIST so the client can disable an affordance
  -- without guessing at the role table, which is what makes a 403
  -- non-decorative. Read from `app.role_permissions`, never inlined.
  SELECT COALESCE(pg_catalog.jsonb_agg(rp.permission ORDER BY rp.permission), '[]'::jsonb)
    INTO v_permissions
    FROM app.role_permissions AS rp
   WHERE rp.role = v_member.role;

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'id',          v_actor.actor_id,
    'name',        COALESCE(v_profile.display_name, v_actor.actor_id),
    'role',        v_member.role::text,
    'permissions', v_permissions,
    'dataScope',   pg_catalog.jsonb_build_object(
                     'clients', v_member.client_scope::text,
                     'teams',   v_member.team_scope::text),
    'locale',      COALESCE(v_profile.locale,   v_tenant_row.locale,   'en-MY'),
    'timezone',    COALESCE(v_profile.timezone, v_tenant_row.timezone, 'Asia/Kuala_Lumpur'),
    'theme',       COALESCE(pg_catalog.upper(v_profile.theme), 'SYSTEM')
  ));
END;
$fn$;

CREATE OR REPLACE FUNCTION core.navigation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant    uuid := app.require_tenant_id();
  v_actor     record;
  v_member    public.memberships%ROWTYPE;
  v_held      text[];
  v_approvals integer;
  v_main      jsonb;
  v_pipelines jsonb;
  v_groups    jsonb;
  v_user_id   uuid;
BEGIN
  SELECT actor.* INTO v_actor FROM app.current_actor() AS actor;
  IF v_actor.role IS NULL THEN
    RETURN app.err('FORBIDDEN', pg_catalog.jsonb_build_object('reason','NO_APP_ROLE'));
  END IF;

  BEGIN v_user_id := v_actor.actor_id::uuid; EXCEPTION WHEN invalid_text_representation THEN v_user_id := NULL; END;
  IF v_user_id IS NOT NULL THEN
    SELECT membership.* INTO v_member FROM public.memberships AS membership
     WHERE membership.tenant_id = v_tenant AND membership.user_id = v_user_id;
  ELSE
    SELECT membership.* INTO v_member FROM public.memberships AS membership
     WHERE membership.tenant_id = v_tenant AND membership.agent_id = v_actor.actor_id;
  END IF;
  IF v_member.tenant_id IS NULL THEN
    RETURN app.err('FORBIDDEN', pg_catalog.jsonb_build_object('reason','NO_MEMBERSHIP'));
  END IF;

  SELECT COALESCE(pg_catalog.array_agg(rp.permission), ARRAY[]::text[])
    INTO v_held
    FROM app.role_permissions AS rp
   WHERE rp.role = v_member.role;

  v_approvals := COALESCE(app.open_approval_count(v_actor.actor_id), 0);

  -- WHAT IS DATA AND WHAT IS NOT, stated rather than left to inference.
  --
  -- The nav is ROLE-FILTERED FROM `app.role_permissions`: a parent appears
  -- only when the role actually holds the read permission behind it. That is
  -- the part that must not be hardcoded, and it is not.
  --
  -- The `path` and the `label` beside each key ARE literals here, and that is
  -- deliberate. They are the web app's own ROUTES — `/enquiries` is a fact
  -- about `apps/web`, not a fact about the database — and no table in 001–013
  -- owns them. `CLAUDE.md`'s standing rule is specific: STAGE NAMES AND ORDER
  -- render from pipeline configuration. Stage names are below, and they come
  -- from `core.pipeline_steps`. A route is not a stage.
  SELECT COALESCE(pg_catalog.jsonb_agg(entry.item ORDER BY entry.ord), '[]'::jsonb)
    INTO v_main
    FROM (
      SELECT nav.ord,
             pg_catalog.jsonb_build_object(
               'key',   nav.key,
               'label', nav.label,
               'path',  nav.path)
             || CASE WHEN nav.key = 'approvals' AND v_approvals > 0
                     THEN pg_catalog.jsonb_build_object('badge',
                            pg_catalog.jsonb_build_object(
                              'count', v_approvals,
                              'severity', CASE WHEN v_approvals > 0 THEN 'ALERT' ELSE 'DEFAULT' END))
                     ELSE '{}'::jsonb END AS item
        FROM (VALUES
                (1,  'dashboard',    'Dashboard',     '/',              'dashboard:read'),
                (2,  'approvals',    'Approvals',     '/approvals',     'approval:read'),
                (3,  'enquiries',    'Enquiries',     '/enquiries',     'enquiry:read'),
                (4,  'organisations','Organisations', '/organisations', 'organisation:read'),
                (5,  'opportunities','Opportunities', '/opportunities', 'opportunity:read'),
                (6,  'tnas',         'TNAs',          '/tnas',          'tna:read'),
                (7,  'proposals',    'Proposals',     '/proposals',     'proposal:read'),
                (8,  'programmes',   'Programmes',    '/programmes',    'programme:read'),
                (9,  'engagements',  'Engagements',   '/engagements',   'engagement:read'),
                (10, 'hrdc',         'HRD Corp',      '/hrdc',          'hrdc:read'),
                (11, 'invoices',     'Invoices',      '/invoices',      'invoice:read'),
                (12, 'collections',  'Collections',   '/collections',   'collection:read'),
                (13, 'agents',       'Agents',        '/agents',        'agent:read'),
                (14, 'compliance',   'Compliance',    '/compliance',    'compliance:read')
              ) AS nav(ord, key, label, path, permission)
       WHERE nav.permission = ANY (v_held)
    ) AS entry;

  -- STAGE NAMES AND ORDER FROM CONFIGURATION. `core.pipelines` and
  -- `core.pipeline_steps` are read here, ordered by `position`, and the label
  -- rendered is the one the row carries. This is the standing rule's actual
  -- subject, and the §8 pin asserts this function still reads
  -- `core.pipeline_steps` so a later edit cannot inline a stage list.
  SELECT COALESCE(pg_catalog.jsonb_agg(parent.item ORDER BY parent.object), '[]'::jsonb)
    INTO v_pipelines
    FROM (
      SELECT pipeline.object,
             pg_catalog.jsonb_build_object(
               'key',   'pipeline:' || pipeline.object,
               'label', pipeline.name,
               'children', COALESCE((
                 SELECT pg_catalog.jsonb_agg(
                          pg_catalog.jsonb_build_object(
                            'key',   step.step_key,
                            'label', step.label,
                            'path',  '/pipelines/' || pg_catalog.lower(pipeline.object)
                                     || '?stage=' || step.step_key)
                          ORDER BY step.position)
                   FROM core.pipeline_steps AS step
                  WHERE step.tenant_id = v_tenant
                    AND step.pipeline_id = pipeline.id), '[]'::jsonb)) AS item
        FROM core.pipelines AS pipeline
       WHERE pipeline.tenant_id = v_tenant
         AND pipeline.is_default
         AND pipeline.status = 'ACTIVE'
         AND 'pipeline:read' = ANY (v_held)
    ) AS parent;

  v_groups := '[]'::jsonb;
  IF pg_catalog.jsonb_array_length(v_main) > 0 THEN
    v_groups := v_groups || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('caption','MAIN','parents', v_main));
  END IF;
  IF pg_catalog.jsonb_array_length(v_pipelines) > 0 THEN
    v_groups := v_groups || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('caption','PIPELINES','parents', v_pipelines));
  END IF;

  -- doc 09 §4: "an empty tree is a bug, not an empty state". A role with a
  -- membership always holds at least `navigation:read`, so an empty tree means
  -- the permission table did not load — say so instead of drawing a blank rail.
  IF pg_catalog.jsonb_array_length(v_groups) = 0 THEN
    RETURN app.err('FORBIDDEN',
      pg_catalog.jsonb_build_object('reason','NO_NAVIGABLE_PERMISSIONS',
                                    'role', v_member.role::text));
  END IF;

  RETURN app.ok(pg_catalog.jsonb_build_object('groups', v_groups));
END;
$fn$;

CREATE OR REPLACE FUNCTION core.badge_counts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant    uuid := app.require_tenant_id();
  v_actor     record;
  v_approvals integer;
  v_hrdc      integer;
  v_failures  integer;
BEGIN
  SELECT actor.* INTO v_actor FROM app.current_actor() AS actor;
  IF v_actor.role IS NULL THEN
    RETURN app.err('FORBIDDEN', pg_catalog.jsonb_build_object('reason','NO_APP_ROLE'));
  END IF;

  -- The approvals badge is 011's own count, not a second query over the same
  -- rows. A second copy of the "which approvals are mine and open" predicate
  -- would drift from the first.
  v_approvals := COALESCE(app.open_approval_count(v_actor.actor_id), 0);

  SELECT pg_catalog.count(*)::integer INTO v_hrdc
    FROM core.hrdc_packets AS packet
   WHERE packet.tenant_id = v_tenant
     AND packet.voided_at IS NULL
     AND packet.panel_state IN ('DEADLINE_AT_RISK','BLOCKED');

  SELECT pg_catalog.count(*)::integer INTO v_failures
    FROM core.runs AS run
   WHERE run.tenant_id = v_tenant
     AND run.status IN ('FAILED','HALTED')
     AND run.acknowledged_at IS NULL;

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'approvals',     v_approvals,
    'hrdcDeadlines', COALESCE(v_hrdc, 0),
    'agentFailures', COALESCE(v_failures, 0)));
END;
$fn$;

-- ═══ 4 · Enquiries — and the pagination convention thirty endpoints copy ════

CREATE OR REPLACE FUNCTION core.list_enquiries(
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
  v_applied  jsonb  := '[]'::jsonb;
  v_errors   jsonb  := '[]'::jsonb;
  v_merged   jsonb  := '[]'::jsonb;
  v_clause   jsonb;
  v_field    text;
  v_op       text;
  v_column   text;
  v_kind     text;
  v_desc     boolean := true;
  v_sort_col text := 'received_at';
  v_sort_fld text := 'receivedAt';
  v_where    text;
  v_sql      text;
  v_rows     jsonb;
  v_total    integer;
  v_next     text;
  v_last_at  timestamptz;
  v_last_id  uuid;
  v_count    integer;
  v_keyed    text;
BEGIN
  -- ── page ────────────────────────────────────────────────────────────────
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
    v_merged := app._view_filters(v_tenant, p_view, 'ENQUIRY', p_filter);
  EXCEPTION WHEN invalid_parameter_value THEN
    RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
      'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field','view','reason', SQLERRM))));
  END;

  SELECT v_merged || COALESCE(pg_catalog.jsonb_agg(element.value || pg_catalog.jsonb_build_object('source','REQUEST')), '[]'::jsonb)
    INTO v_merged
    FROM pg_catalog.jsonb_array_elements(COALESCE(p_filter, '[]'::jsonb)) AS element(value);

  -- ── filters ─────────────────────────────────────────────────────────────
  -- FAIL CLOSED. An unrecognised field or op is VALIDATION_FAILED with
  -- `details.fields[]`, never an ignored clause: ignoring a filter shows rows
  -- the reader explicitly asked to exclude, which reads as a data error rather
  -- than as a refusal.
  FOR v_clause IN SELECT element.value FROM pg_catalog.jsonb_array_elements(v_merged) AS element(value)
  LOOP
    v_field := v_clause ->> 'field';
    v_op    := v_clause ->> 'op';

    SELECT allowed.column_name, allowed.kind INTO v_column, v_kind
      FROM (VALUES
              ('status',             'status',                  'text'),
              ('channel',            'channel',                 'text'),
              ('needsHumanReview',   'needs_human_review',      'bool'),
              ('receivedAt',         'received_at',             'ts'),
              ('assignedTo',         'assigned_to_user_id',     'uuid'),
              ('matchedOrganisation','matched_organisation_id', 'uuid'),
              ('subject',            'subject',                 'text'),
              ('estimatedValue',     'estimated_value_sen',     'number'),
              ('classification',     'classification_label',    'text')
            ) AS allowed(field, column_name, kind)
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
        'value', COALESCE(v_clause -> 'value', 'null'::jsonb),
        'source', COALESCE(v_clause ->> 'source', 'REQUEST')));
    EXCEPTION WHEN invalid_parameter_value THEN
      v_errors := v_errors || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field', v_field, 'reason', SQLERRM, 'code', COALESCE(v_op,'(null)')));
    END;
    v_column := NULL; v_kind := NULL;
  END LOOP;

  IF pg_catalog.jsonb_array_length(v_errors) > 0 THEN
    RETURN app.err('VALIDATION_FAILED',
      pg_catalog.jsonb_build_object('fields', v_errors));
  END IF;

  -- ── sort ────────────────────────────────────────────────────────────────
  -- A malformed sort must read as a malformed sort, which is why the four
  -- query parts arrive as four arguments rather than one bag.
  IF NULLIF(p_sort, '') IS NOT NULL THEN
    v_desc := pg_catalog.left(p_sort, 1) = '-';
    v_sort_fld := CASE WHEN v_desc THEN pg_catalog.substr(p_sort, 2) ELSE p_sort END;
    SELECT allowed.column_name INTO v_sort_col
      FROM (VALUES
              ('receivedAt','received_at'),
              ('createdAt','created_at'),
              ('updatedAt','updated_at'),
              ('estimatedValue','estimated_value_sen'),
              ('subject','subject'),
              ('status','status')
            ) AS allowed(field, column_name)
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
    FROM app._keyset_scope('core.enquiries'::regclass, v_tenant, v_where,
                           v_sort_col, v_desc, v_cur_at, v_cur_id) AS scope;

  v_sql := pg_catalog.format($q$
    WITH page AS (
      SELECT * FROM core.enquiries
       WHERE tenant_id = $1 AND %s
       ORDER BY %I %s, id %s
       LIMIT $2
    )
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
        SELECT pg_catalog.row_number() OVER (ORDER BY e.%I %s, e.id %s) AS ord,
               e.id, e.%I AS sort_at,
               pg_catalog.jsonb_build_object(
                 'id',         e.id::text,
                 'ref',        e.ref,
                 'createdAt',  e.created_at,
                 'updatedAt',  e.updated_at,
                 'createdBy',  app._actor(e.created_by_kind::text, e.created_by_id, e.created_by_name),
                 'channel',    e.channel::text,
                 'status',     e.status::text,
                 'receivedAt', e.received_at,
                 'from', pg_catalog.jsonb_build_object(
                            'name',  e.from_name,
                            'email', e.from_email::text,
                            'phone', e.from_phone),
                 'subject', COALESCE(e.subject, ''),
                 'preview', COALESCE(e.preview, ''),
                 'classification',
                   pg_catalog.jsonb_build_object(
                     'label', COALESCE(e.classification_label, 'UNCLASSIFIED'),
                     'provenance', COALESCE(
                        app._provenance('enquiries', e.id, 'classification_label'),
                        pg_catalog.jsonb_build_object('origin','HUMAN')))
                   || CASE WHEN e.needs_human_review
                           THEN pg_catalog.jsonb_build_object('needsHumanReview', true)
                           ELSE '{}'::jsonb END,
                 'estimatedValue', app._money(e.estimated_value_sen, e.currency),
                 'matchedOrganisation',
                   CASE WHEN org.id IS NULL THEN NULL
                        ELSE pg_catalog.jsonb_build_object(
                               'id',   org.id::text,
                               'ref',  org.ref,
                               'name', org.name,
                               'matchReason', COALESCE(e.match_reason::text, 'MANUAL'))
                   END,
                 'assignedTo',
                   CASE WHEN e.assigned_to_user_id IS NULL THEN NULL
                        ELSE app._actor('HUMAN', e.assigned_to_user_id::text, assignee.display_name)
                   END
               ) AS item
          FROM page AS e
          LEFT JOIN core.organisations AS org
                 ON org.tenant_id = e.tenant_id AND org.id = e.matched_organisation_id
          LEFT JOIN public.user_profiles AS assignee
                 ON assignee.tenant_id = e.tenant_id AND assignee.user_id = e.assigned_to_user_id
      ) AS row$q$,
    v_keyed,
    v_sort_col, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END,
    v_sort_col, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END,
    v_sort_col);

  EXECUTE v_sql INTO v_rows, v_count, v_last_at, v_last_id USING v_tenant, v_size;

  -- `next` IS NULL ON THE LAST PAGE, NEVER ABSENT. The client's unwrap rule is
  -- sensitive to key sets and an omitted key changes the shape — this is the
  -- one doc 09 §5 says a test catches and a reviewer does not, so the pin
  -- asserts present-and-null explicitly.
  v_next := app._next_cursor('core.enquiries'::regclass, v_tenant, v_where,
                             v_sort_col, v_desc, v_count, v_size, v_last_at, v_last_id);

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'data', v_rows,
    'page', pg_catalog.jsonb_build_object('next', v_next, 'total', v_total),
    'appliedFilters', v_applied));
END;
$fn$;

CREATE OR REPLACE FUNCTION core.get_enquiry(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant     uuid := app.require_tenant_id();
  v_row        core.enquiries%ROWTYPE;
  v_org        core.organisations%ROWTYPE;
  v_assignee   text;
  v_extraction jsonb := '{}'::jsonb;
  v_related    jsonb;
  v_suggested  jsonb;
  v_key        text;
  v_value      text;
  v_field_id   uuid;
BEGIN
  -- `p_id` accepts EITHER the uuid or the `ref` (`ENQ-2026-0912`): the app
  -- routes on refs, and this matches the fixture client's `byIdOrRef`. The
  -- comparison is `id::text = p_id`, never `p_id::uuid`, so a ref never dies
  -- on `invalid_text_representation` before the ref branch is reached.
  SELECT enquiry.* INTO v_row FROM core.enquiries AS enquiry
   WHERE enquiry.tenant_id = v_tenant
     AND (enquiry.id::text = p_id OR enquiry.ref = p_id);

  -- NOT_FOUND does NOT distinguish "exists in another tenant" from "does not
  -- exist". Any difference between the two is a cross-tenant existence oracle,
  -- and it leaks by timing as readily as by message, so there is one branch.
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('id', p_id));
  END IF;

  SELECT org.* INTO v_org FROM core.organisations AS org
   WHERE org.tenant_id = v_tenant AND org.id = v_row.matched_organisation_id;

  SELECT profile.display_name INTO v_assignee FROM public.user_profiles AS profile
   WHERE profile.tenant_id = v_tenant AND profile.user_id = v_row.assigned_to_user_id;

  -- §4 extraction: the four fields, each carrying its OWN provenance, and
  -- ABSENT PROVENANCE MEANS HUMAN-AUTHORED — `app._provenance` returns NULL
  -- when no row matches and `app._provenanced` then omits the KEY. A null
  -- provenance would badge every hand-typed field as AI.
  FOR v_key IN SELECT unnest FROM pg_catalog.unnest(ARRAY['topic','audience','timing','budget'])
  LOOP
    SELECT field.id, field.value INTO v_field_id, v_value
      FROM core.enquiry_extraction_fields AS field
     WHERE field.tenant_id = v_tenant
       AND field.enquiry_id = v_row.id
       AND field.field_key = v_key;

    v_extraction := v_extraction || pg_catalog.jsonb_build_object(
      v_key,
      app._provenanced(
        CASE
          WHEN v_field_id IS NULL OR v_value IS NULL THEN NULL
          -- §4 types `budget` as `Money | null`, not as a string. The stored
          -- value is the integer sen; a non-numeric stored value is data the
          -- worker got wrong and is surfaced as null rather than as a crash.
          WHEN v_key = 'budget' THEN
            CASE WHEN v_value ~ '^-?[0-9]+$'
                 THEN app._money(v_value::bigint, v_row.currency)
                 ELSE NULL END
          ELSE pg_catalog.to_jsonb(v_value)
        END,
        CASE WHEN v_field_id IS NULL THEN NULL
             ELSE app._provenance('enquiry_extraction_fields', v_field_id, v_key) END));
    v_field_id := NULL; v_value := NULL;
  END LOOP;

  -- §4 related chips: the records this enquiry actually points at. Built from
  -- real rows, so an enquiry with no organisation match shows no chip rather
  -- than an empty one.
  SELECT COALESCE(pg_catalog.jsonb_agg(related.item ORDER BY related.ord), '[]'::jsonb)
    INTO v_related
    FROM (
      SELECT 1 AS ord, pg_catalog.jsonb_build_object(
               'type','ORGANISATION','ref', v_org.ref, 'label', v_org.name) AS item
       WHERE v_org.id IS NOT NULL
      UNION ALL
      SELECT 2, pg_catalog.jsonb_build_object(
               'type','CONTACT','ref', contact.ref, 'label', contact.name)
        FROM core.contacts AS contact
       WHERE contact.tenant_id = v_tenant AND contact.id = v_row.matched_contact_id
      UNION ALL
      SELECT 3, pg_catalog.jsonb_build_object(
               'type','ACTION','ref', opportunity.ref,
               'label', 'Opportunity ' || opportunity.stage::text)
        FROM core.opportunities AS opportunity
       WHERE opportunity.tenant_id = v_tenant AND opportunity.source_enquiry_id = v_row.id
    ) AS related;

  -- §4 `suggestedAction` is OPTIONAL and is omitted when no draft is open.
  -- An empty object here would render an empty suggestion card.
  SELECT pg_catalog.jsonb_build_object(
           'type',     draft.action_type,
           'autonomy', COALESCE(request.granted_level, request.autonomy_level, 'SUGGEST'),
           'summary',  COALESCE(draft.body, draft.action_type),
           'payload',  draft.payload)
         || CASE WHEN pg_catalog.jsonb_typeof(draft.planned_effects) = 'array'
                  AND pg_catalog.jsonb_array_length(draft.planned_effects) > 0
                 THEN pg_catalog.jsonb_build_object('diff', draft.planned_effects)
                 ELSE '{}'::jsonb END
         || CASE WHEN draft.provenance = '{}'::jsonb THEN '{}'::jsonb
                 ELSE pg_catalog.jsonb_build_object('provenance', draft.provenance) END
    INTO v_suggested
    FROM core.suggested_drafts AS draft
    JOIN core.action_requests AS request
      ON request.tenant_id = draft.tenant_id AND request.id = draft.action_request_id
   WHERE draft.tenant_id = v_tenant
     AND draft.target_ref = v_row.ref
     AND draft.status = 'PENDING'
     AND draft.expires_at > pg_catalog.now()
   ORDER BY draft.created_at DESC
   LIMIT 1;

  RETURN app.ok(
    pg_catalog.jsonb_build_object(
      'id',         v_row.id::text,
      'ref',        v_row.ref,
      'createdAt',  v_row.created_at,
      'updatedAt',  v_row.updated_at,
      'createdBy',  app._actor(v_row.created_by_kind::text, v_row.created_by_id, v_row.created_by_name),
      'channel',    v_row.channel::text,
      'status',     v_row.status::text,
      'receivedAt', v_row.received_at,
      'from', pg_catalog.jsonb_build_object(
                'name',  v_row.from_name,
                'email', v_row.from_email::text,
                'phone', v_row.from_phone),
      'subject', COALESCE(v_row.subject, ''),
      'preview', COALESCE(v_row.preview, ''),
      'body',    COALESCE(v_row.body, ''),
      'classification',
        pg_catalog.jsonb_build_object(
          'label', COALESCE(v_row.classification_label, 'UNCLASSIFIED'),
          'provenance', COALESCE(
             app._provenance('enquiries', v_row.id, 'classification_label'),
             pg_catalog.jsonb_build_object('origin','HUMAN')))
        || CASE WHEN v_row.needs_human_review
                THEN pg_catalog.jsonb_build_object('needsHumanReview', true)
                ELSE '{}'::jsonb END,
      'estimatedValue', app._money(v_row.estimated_value_sen, v_row.currency),
      'matchedOrganisation',
        CASE WHEN v_org.id IS NULL THEN NULL
             ELSE pg_catalog.jsonb_build_object(
                    'id', v_org.id::text, 'ref', v_org.ref, 'name', v_org.name,
                    'matchReason', COALESCE(v_row.match_reason::text, 'MANUAL'))
        END,
      'assignedTo',
        CASE WHEN v_row.assigned_to_user_id IS NULL THEN NULL
             ELSE app._actor('HUMAN', v_row.assigned_to_user_id::text, v_assignee) END,
      'extraction', v_extraction,
      'related',    v_related)
    || CASE WHEN v_suggested IS NULL THEN '{}'::jsonb
            ELSE pg_catalog.jsonb_build_object('suggestedAction', v_suggested) END);
END;
$fn$;

-- ═══ 5 · Organisation 360, contacts, opportunities ═════════════════════════

CREATE OR REPLACE FUNCTION core.get_organisation(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant    uuid := app.require_tenant_id();
  v_row       core.organisations%ROWTYPE;
  v_owner     text;
  v_lifetime  bigint;
  v_pipeline  bigint;
  v_overdue   bigint;
  v_levy      bigint;
  v_health    smallint;
BEGIN
  SELECT org.* INTO v_row FROM core.organisations AS org
   WHERE org.tenant_id = v_tenant
     AND (org.id::text = p_id OR org.ref = p_id);
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('id', p_id));
  END IF;

  SELECT profile.display_name INTO v_owner FROM public.user_profiles AS profile
   WHERE profile.tenant_id = v_tenant AND profile.user_id = v_row.owner_id;

  -- The §5 metric strip. Each figure is a sum over real rows, in integer sen,
  -- and each carries its own `drillTo` so no screen hardcodes a drill route.
  SELECT COALESCE(pg_catalog.sum(invoice.total_sen), 0) INTO v_lifetime
    FROM core.invoices AS invoice
   WHERE invoice.tenant_id = v_tenant
     AND invoice.organisation_id = v_row.id
     AND invoice.voided_at IS NULL;

  SELECT COALESCE(pg_catalog.sum(opportunity.value_sen), 0) INTO v_pipeline
    FROM core.opportunities AS opportunity
   WHERE opportunity.tenant_id = v_tenant
     AND opportunity.organisation_id = v_row.id
     AND opportunity.stage NOT IN ('WON','LOST');

  SELECT COALESCE(pg_catalog.sum(invoice.outstanding_sen), 0) INTO v_overdue
    FROM core.invoices AS invoice
   WHERE invoice.tenant_id = v_tenant
     AND invoice.organisation_id = v_row.id
     AND invoice.voided_at IS NULL
     AND invoice.outstanding_sen > 0
     AND invoice.due_at < CURRENT_DATE;

  -- The most recent statement, not a sum: levy available is a balance and
  -- adding two statements together would double it.
  SELECT statement.levy_available_sen INTO v_levy
    FROM core.hrdc_levy_statements AS statement
   WHERE statement.tenant_id = v_tenant
     AND statement.organisation_id = v_row.id
   ORDER BY statement.as_of DESC
   LIMIT 1;

  SELECT snapshot.score INTO v_health
    FROM core.organisation_health_snapshots AS snapshot
   WHERE snapshot.tenant_id = v_tenant
     AND snapshot.organisation_id = v_row.id
   ORDER BY snapshot.computed_at DESC
   LIMIT 1;

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'id',        v_row.id::text,
    'ref',       v_row.ref,
    'name',      v_row.name,
    'industry',  COALESCE(v_row.industry, ''),
    'location',  COALESCE(v_row.location, ''),
    'owner',     app._actor('HUMAN', v_row.owner_id::text, v_owner),
    'status',    v_row.status::text,
    'hrdcRegistered',   v_row.hrdc_registered,
    'hrdcEmployerCode', v_row.hrdc_employer_code,
    'metrics', pg_catalog.jsonb_build_object(
      'lifetimeValue', pg_catalog.jsonb_build_object(
        'value', app._money(v_lifetime, 'MYR'),
        'drillTo', '/organisations/' || v_row.ref || '/invoices'),
      'openPipeline', pg_catalog.jsonb_build_object(
        'value', app._money(v_pipeline, 'MYR'),
        'drillTo', '/organisations/' || v_row.ref || '/opportunities'),
      'arOverdue', pg_catalog.jsonb_build_object(
        'value', app._money(v_overdue, 'MYR'),
        'drillTo', '/organisations/' || v_row.ref || '/receivables'),
      'hrdcLevyAvailable', pg_catalog.jsonb_build_object(
        'value', app._money(COALESCE(v_levy, 0), 'MYR'),
        'drillTo', '/organisations/' || v_row.ref || '/hrdc'),
      -- §5: healthScore is a 0–100 composite, NOT a rate and NOT Money, so it
      -- is the one metric whose `value` is a bare number.
      'healthScore', pg_catalog.jsonb_build_object(
        'value', COALESCE(v_health, v_row.health_score, 0),
        'drillTo', '/organisations/' || v_row.ref)),
    'createdAt', v_row.created_at,
    'updatedAt', v_row.updated_at));
END;
$fn$;

CREATE OR REPLACE FUNCTION core.get_opportunity(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant  uuid := app.require_tenant_id();
  v_row     core.opportunities%ROWTYPE;
  v_org_ref text;
  v_enq_ref text;
  v_owner   text;
BEGIN
  SELECT opportunity.* INTO v_row FROM core.opportunities AS opportunity
   WHERE opportunity.tenant_id = v_tenant
     AND (opportunity.id::text = p_id OR opportunity.ref = p_id);
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('id', p_id));
  END IF;

  SELECT org.ref INTO v_org_ref FROM core.organisations AS org
   WHERE org.tenant_id = v_tenant AND org.id = v_row.organisation_id;
  SELECT enquiry.ref INTO v_enq_ref FROM core.enquiries AS enquiry
   WHERE enquiry.tenant_id = v_tenant AND enquiry.id = v_row.source_enquiry_id;
  SELECT profile.display_name INTO v_owner FROM public.user_profiles AS profile
   WHERE profile.tenant_id = v_tenant AND profile.user_id = v_row.owner_id;

  RETURN app.ok(
    pg_catalog.jsonb_build_object(
      'id',        v_row.id::text,
      'ref',       v_row.ref,
      'createdAt', v_row.created_at,
      'updatedAt', v_row.updated_at,
      'createdBy', app._actor(v_row.created_by_kind::text, v_row.created_by_id, v_row.created_by_name),
      'organisationRef', v_org_ref,
      'stage',  v_row.stage::text,
      'value',  app._money(COALESCE(v_row.value_sen, 0), v_row.currency),
      'owner',  app._actor('HUMAN', v_row.owner_id::text, v_owner))
    -- Optional keys are OMITTED, not nulled. `probability` absent means the
    -- deal has not been scored, which is different from a score of zero.
    || CASE WHEN v_row.probability IS NULL THEN '{}'::jsonb
            ELSE pg_catalog.jsonb_build_object('probability', v_row.probability) END
    || CASE WHEN v_enq_ref IS NULL THEN '{}'::jsonb
            ELSE pg_catalog.jsonb_build_object('sourceEnquiryRef', v_enq_ref) END);
END;
$fn$;

CREATE OR REPLACE FUNCTION core.get_contact(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant   uuid := app.require_tenant_id();
  v_row      core.contacts%ROWTYPE;
  v_org_ref  text;
  v_email    boolean := false;
  v_whatsapp boolean := false;
BEGIN
  SELECT contact.* INTO v_row FROM core.contacts AS contact
   WHERE contact.tenant_id = v_tenant
     AND (contact.id::text = p_id OR contact.ref = p_id);
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('id', p_id));
  END IF;

  SELECT org.ref INTO v_org_ref FROM core.organisations AS org
   WHERE org.tenant_id = v_tenant AND org.id = v_row.organisation_id;

  -- CURRENT consent per channel: the latest non-withdrawn grant. A withdrawn
  -- row must read as `false`, not as the absence of a row, or a withdrawal
  -- silently reverts to whatever was recorded before it.
  SELECT COALESCE(pg_catalog.bool_or(consent.granted) FILTER (WHERE consent.channel = 'EMAIL'), false),
         COALESCE(pg_catalog.bool_or(consent.granted) FILTER (WHERE consent.channel = 'WHATSAPP'), false)
    INTO v_email, v_whatsapp
    FROM core.contact_consents AS consent
   WHERE consent.tenant_id = v_tenant
     AND consent.contact_id = v_row.id
     AND consent.withdrawn_at IS NULL;

  RETURN app.ok(
    pg_catalog.jsonb_build_object(
      'id',        v_row.id::text,
      'ref',       v_row.ref,
      'createdAt', v_row.created_at,
      'updatedAt', v_row.updated_at,
      'createdBy', app._actor(v_row.created_by_kind::text, v_row.created_by_id, v_row.created_by_name),
      'organisationRef', v_org_ref,
      'name',    v_row.name,
      'role',    COALESCE(v_row.job_title, ''),
      'email',   v_row.email::text,
      'phone',   v_row.phone,
      'primary', v_row.is_primary,
      'consent', pg_catalog.jsonb_build_object('email', v_email, 'whatsapp', v_whatsapp))
    || CASE WHEN v_row.pdpa_flag IS NULL THEN '{}'::jsonb
            ELSE pg_catalog.jsonb_build_object('pdpaFlag', v_row.pdpa_flag) END);
END;
$fn$;

-- ── The one endpoint in this set that is a VIEW, not an RPC (doc 09 §7) ─────
--
-- `rpcClient.ts` reads it with
-- `.from("v_organisation_relations").select("*").match({organisation_id})` and
-- treats an empty result as NOT_FOUND, because the contract types
-- `OrganisationRelations` as a record rather than a collection. One row per
-- organisation, keyed `organisation_id`.
--
-- `security_invoker = true` IS NOT OPTIONAL. A view without it runs as its
-- OWNER and returns EVERY TENANT'S ROWS to whoever can select from it —
-- a product-ending defect, not a bug. 011:1408 and 012:2640 both set it and
-- this matches them; the §8 pin asserts `reloptions` carries it.
--
-- NOTE ON THE OTHER FIFTEEN §8 VIEWS. `VIEW_READS` in `rpcClient.ts` names
-- sixteen `core.v_*` reads. This pack creates ONE of them — the one doc 09 §7
-- specifies and pins as part of the golden path. The other fifteen
-- (`v_templates`, `v_policies`, `v_pipeline_configs`, `v_saved_views`,
-- `v_trainers`, `v_contacts`, `v_programmes`, `v_programme_deliveries`,
-- `v_hrdc_deadlines`, `v_collection_rules`, `v_compliance_rules`,
-- `v_rule_change_sets`, `v_agent_evals`, `v_knowledge_sources`,
-- `v_model_tiers`, `v_budgets`) are the §8 bucket and belong to a view pack,
-- not to the RPC pack. Shipping one of sixteen is deliberate and stated;
-- shipping it silently would not be.
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

-- ═══ 6 · TNA — a read of worker-produced rows, and nothing more ════════════

CREATE OR REPLACE FUNCTION core.get_tna(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant  uuid := app.require_tenant_id();
  v_row     core.tnas%ROWTYPE;
  v_opp_ref text;
  v_gaps    jsonb;
  v_cons    jsonb;
  v_evid    jsonb;
BEGIN
  SELECT tna.* INTO v_row FROM core.tnas AS tna
   WHERE tna.tenant_id = v_tenant
     AND (tna.id::text = p_id OR tna.ref = p_id);
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('id', p_id));
  END IF;

  SELECT opportunity.ref INTO v_opp_ref FROM core.opportunities AS opportunity
   WHERE opportunity.tenant_id = v_tenant AND opportunity.id = v_row.opportunity_id;

  SELECT COALESCE(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'name',         gap.name,
             'description',  COALESCE(gap.description, ''),
             'priority',     gap.priority::text,
             'evidenceRefs', pg_catalog.to_jsonb(gap.evidence_refs))
           || CASE WHEN app._provenance('tna_gaps', gap.id, NULL) IS NULL THEN '{}'::jsonb
                   ELSE pg_catalog.jsonb_build_object(
                          'provenance', app._provenance('tna_gaps', gap.id, NULL)) END
           ORDER BY gap.priority, gap.name), '[]'::jsonb)
    INTO v_gaps
    FROM core.tna_gaps AS gap
   WHERE gap.tenant_id = v_tenant AND gap.tna_id = v_row.id;

  SELECT COALESCE(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object('code', constraint_row.code, 'label', constraint_row.label)
           -- §6: `severity` is present ONLY when the constraint is at risk.
           -- Emitting it always would paint every constraint as a warning.
           || CASE WHEN constraint_row.severity IS NULL THEN '{}'::jsonb
                   ELSE pg_catalog.jsonb_build_object('severity', constraint_row.severity::text) END
           ORDER BY constraint_row.code), '[]'::jsonb)
    INTO v_cons
    FROM core.tna_constraints AS constraint_row
   WHERE constraint_row.tenant_id = v_tenant AND constraint_row.tna_id = v_row.id;

  SELECT COALESCE(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object('type', evidence.source_type::text, 'ref', evidence.source_ref)
           || CASE WHEN evidence.excerpt IS NULL THEN '{}'::jsonb
                   ELSE pg_catalog.jsonb_build_object('excerpt', evidence.excerpt) END
           ORDER BY evidence.created_at), '[]'::jsonb)
    INTO v_evid
    FROM core.tna_evidence AS evidence
   WHERE evidence.tenant_id = v_tenant AND evidence.tna_id = v_row.id;

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'id',        v_row.id::text,
    'ref',       v_row.ref,
    'createdAt', v_row.created_at,
    'updatedAt', v_row.updated_at,
    'createdBy', app._actor(v_row.created_by_kind::text, v_row.created_by_id, v_row.created_by_name),
    'opportunityRef', v_opp_ref,
    'status',      v_row.status::text,
    -- §12 widens `completedBy` to `AnyActor`, which includes CLIENT: a TNA
    -- questionnaire is normally completed by the client, not by staff.
    'completedBy', app._actor(v_row.completed_by_kind::text, v_row.completed_by_id, v_row.completed_by_name),
    'completedAt', v_row.completed_at,
    'audience', pg_catalog.jsonb_build_object(
      'headcount', COALESCE(v_row.audience_headcount, 0),
      'level',     COALESCE(v_row.audience_level, ''),
      'sites',     pg_catalog.to_jsonb(COALESCE(v_row.audience_sites, ARRAY[]::text[])),
      'language',  COALESCE(pg_catalog.rtrim(v_row.audience_language), 'EN')),
    'constraints', v_cons,
    'budget',      app._money(v_row.budget_sen, v_row.currency),
    'gaps',        v_gaps,
    'evidence',    v_evid));
END;
$fn$;

CREATE OR REPLACE FUNCTION core.get_tna_recommendations(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant  uuid := app.require_tenant_id();
  v_tna     core.tnas%ROWTYPE;
  v_rows    jsonb;
  v_version text;
  v_weights jsonb;
  v_prov    jsonb;
  v_first   uuid;
BEGIN
  -- THIS NEVER GENERATES ON DEMAND. `core.tna_recommendations` holds rows a
  -- WORKER produced; this endpoint reads them. An LLM call inside a request is
  -- the thing the §10 worker split exists to prevent, and it would blow the
  -- 10s statement timeout under load. The §8 pin asserts this body contains no
  -- `net.http_post` and no reference to `core.runs`, so "generate on read"
  -- cannot be added later without tripping it.
  SELECT tna.* INTO v_tna FROM core.tnas AS tna
   WHERE tna.tenant_id = v_tenant
     AND (tna.id::text = p_id OR tna.ref = p_id);
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('id', p_id));
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(item.row ORDER BY item.rank, item.fit DESC), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT COALESCE(recommendation.rank, 32767::smallint) AS rank,
             recommendation.fit_score AS fit,
             pg_catalog.jsonb_build_object(
               'programmeId', recommendation.programme_id::text,
               'name',        programme.name,
               'fitScore',    recommendation.fit_score,
               'rationale',   COALESCE(recommendation.rationale, ''))
             || CASE WHEN recommendation.price_indication_sen IS NULL THEN '{}'::jsonb
                     ELSE pg_catalog.jsonb_build_object('priceIndication',
                            app._money(recommendation.price_indication_sen, recommendation.currency)) END
             -- Trainer availability is read from the roster the scheduler
             -- keeps, never recomputed: two answers to "is this trainer free"
             -- is one answer too many.
             || CASE WHEN NOT EXISTS (
                       SELECT 1 FROM core.programme_trainers AS link
                        WHERE link.tenant_id = v_tenant
                          AND link.programme_id = recommendation.programme_id)
                     THEN '{}'::jsonb
                     ELSE pg_catalog.jsonb_build_object('trainerAvailability', COALESCE((
                       SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                'trainerRef', trainer.ref,
                                'name',       trainer.name,
                                'available',  NOT EXISTS (
                                   SELECT 1 FROM core.trainer_availability AS slot
                                    WHERE slot.tenant_id = v_tenant
                                      AND slot.trainer_id = trainer.id
                                      AND slot.state <> 'AVAILABLE'
                                      AND slot.on_date >= CURRENT_DATE))
                              ORDER BY trainer.name)
                         FROM core.programme_trainers AS link
                         JOIN core.trainers AS trainer
                           ON trainer.tenant_id = link.tenant_id AND trainer.id = link.trainer_id
                        WHERE link.tenant_id = v_tenant
                          AND link.programme_id = recommendation.programme_id), '[]'::jsonb)) END AS row
        FROM core.tna_recommendations AS recommendation
        JOIN core.programmes AS programme
          ON programme.tenant_id = recommendation.tenant_id
         AND programme.id = recommendation.programme_id
       WHERE recommendation.tenant_id = v_tenant
         AND recommendation.tna_id = v_tna.id
    ) AS item;

  SELECT recommendation.scoring_model_version, recommendation.scoring_weights, recommendation.id
    INTO v_version, v_weights, v_first
    FROM core.tna_recommendations AS recommendation
   WHERE recommendation.tenant_id = v_tenant AND recommendation.tna_id = v_tna.id
   ORDER BY recommendation.rank NULLS LAST
   LIMIT 1;

  -- AN EMPTY `data` IS A LEGITIMATE ANSWER — the worker has not run yet — and
  -- must NOT be a 404. doc 09 §8 is explicit about this, and it is the
  -- difference between "no fit found" and "this TNA does not exist".
  IF v_first IS NOT NULL THEN
    v_prov := app._provenance('tna_recommendations', v_first, NULL);
  END IF;

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'data', v_rows,
    -- `provenance` is REQUIRED on this response. With no provenance row the
    -- honest answer is `SYSTEM`: the ranking exists and a machine produced it,
    -- but nothing recorded a model behind it.
    'provenance', COALESCE(v_prov, pg_catalog.jsonb_build_object('origin','SYSTEM')),
    'scoringModel', pg_catalog.jsonb_build_object(
      'version', COALESCE(v_version, 'v0-unscored'),
      'weights', COALESCE(v_weights, '{}'::jsonb))));
END;
$fn$;

-- ═══ 7 · Proposals ═════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION core.get_proposal(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant   uuid := app.require_tenant_id();
  v_row      core.proposals%ROWTYPE;
  v_opp_ref  text;
  v_sections jsonb;
BEGIN
  SELECT proposal.* INTO v_row FROM core.proposals AS proposal
   WHERE proposal.tenant_id = v_tenant
     AND (proposal.id::text = p_id OR proposal.ref = p_id);
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('id', p_id));
  END IF;

  SELECT opportunity.ref INTO v_opp_ref FROM core.opportunities AS opportunity
   WHERE opportunity.tenant_id = v_tenant AND opportunity.id = v_row.opportunity_id;

  SELECT COALESCE(pg_catalog.jsonb_agg(item.row ORDER BY item.n), '[]'::jsonb)
    INTO v_sections
    FROM (
      SELECT section.n,
             pg_catalog.jsonb_build_object('n', section.n, 'title', section.title)
             || CASE WHEN section.body IS NULL THEN '{}'::jsonb
                     ELSE pg_catalog.jsonb_build_object('body', section.body) END
             || CASE WHEN section.merge_fields_used IS NULL THEN '{}'::jsonb
                     ELSE pg_catalog.jsonb_build_object('mergeFieldsUsed',
                            pg_catalog.to_jsonb(section.merge_fields_used)) END
             -- `needsReview` is set when a section was generated BELOW the
             -- confidence threshold. Emitted only when true, so the editor
             -- flags the sections that need a human and no others.
             || CASE WHEN section.needs_review
                     THEN pg_catalog.jsonb_build_object('needsReview', true)
                     ELSE '{}'::jsonb END
             || CASE WHEN app._provenance('proposal_sections', section.id, NULL) IS NULL
                     THEN '{}'::jsonb
                     ELSE pg_catalog.jsonb_build_object('provenance',
                            app._provenance('proposal_sections', section.id, NULL)) END AS row
        FROM core.proposal_sections AS section
       WHERE section.tenant_id = v_tenant AND section.proposal_id = v_row.id
    ) AS item;

  RETURN app.ok(
    pg_catalog.jsonb_build_object(
      'id',        v_row.id::text,
      'ref',       v_row.ref,
      'createdAt', v_row.created_at,
      'updatedAt', v_row.updated_at,
      'createdBy', app._actor(v_row.created_by_kind::text, v_row.created_by_id, v_row.created_by_name),
      'opportunityRef', v_opp_ref,
      'templateId', v_row.template_id::text,
      'status',     v_row.status::text,
      'value',      app._money(COALESCE(v_row.value_sen, 0), v_row.currency::text),
      'marginRate', COALESCE(v_row.margin_rate, 0),
      'sections',   v_sections)
    || CASE WHEN v_row.run_id IS NULL THEN '{}'::jsonb
            ELSE pg_catalog.jsonb_build_object('runId', v_row.run_id::text) END);
END;
$fn$;

CREATE OR REPLACE FUNCTION core.create_proposal(
  p_body            jsonb,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant      uuid := app.require_tenant_id();
  v_actor       record;
  v_opportunity core.opportunities%ROWTYPE;
  v_template    core.templates%ROWTYPE;
  v_programme   core.programmes%ROWTYPE;
  v_proposal    core.proposals%ROWTYPE;
  v_hash        text;
  v_key         app.idempotency_keys%ROWTYPE;
  v_missing     jsonb := '[]'::jsonb;
  v_replayed    uuid;
BEGIN
  -- A WRITE, so every refusal is a RAISE and not an `app.err`: a refusal must
  -- not leave a partial proposal or a claimed idempotency key behind.
  SELECT actor.* INTO v_actor FROM app.current_actor() AS actor;
  IF v_actor.role IS NULL THEN
    RAISE EXCEPTION 'requester has no app_role'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','FORBIDDEN')::text;
  END IF;

  p_body := COALESCE(p_body, '{}'::jsonb);
  IF NULLIF(p_body ->> 'opportunityRef','') IS NULL THEN
    v_missing := v_missing || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('field','opportunityRef','reason','REQUIRED'));
  END IF;
  IF NULLIF(p_body ->> 'templateId','') IS NULL THEN
    v_missing := v_missing || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('field','templateId','reason','REQUIRED'));
  END IF;
  IF NULLIF(p_body ->> 'programmeId','') IS NULL THEN
    v_missing := v_missing || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('field','programmeId','reason','REQUIRED'));
  END IF;
  IF pg_catalog.jsonb_array_length(v_missing) > 0 THEN
    RAISE EXCEPTION 'proposal body validation failed'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','VALIDATION_FAILED','fields', v_missing)::text;
  END IF;

  -- IDEMPOTENCY IS REQUIRED, NOT OPTIONAL (doc 09 §9): two governed writes
  -- were already found sending no key at all, which is how a double-click
  -- becomes two proposals.
  IF NULLIF(p_idempotency_key,'') IS NULL THEN
    RAISE EXCEPTION 'an idempotency key is required for this write'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','VALIDATION_FAILED','fields', pg_catalog.jsonb_build_array(
                pg_catalog.jsonb_build_object(
                  'field','idempotencyKey','reason','REQUIRED')))::text;
  END IF;

  -- LOCK BEFORE CLAIM, exactly as 011:2091 does. The advisory lock serialises
  -- two concurrent requests carrying the same key so the second one sees the
  -- first one's row instead of racing it through the unique index.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(v_tenant::text || ':' || v_actor.actor_id || ':' || p_idempotency_key)::bigint);
  v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_body::text, 'UTF8')), 'hex');

  INSERT INTO app.idempotency_keys (tenant_id, actor_id, endpoint, key, request_hash)
  VALUES (v_tenant, v_actor.actor_id, 'POST /v1/proposals', p_idempotency_key, v_hash)
  ON CONFLICT (tenant_id, actor_id, endpoint, key) DO NOTHING
  RETURNING * INTO v_key;

  IF v_key.id IS NULL THEN
    SELECT existing.* INTO v_key FROM app.idempotency_keys AS existing
     WHERE existing.tenant_id = v_tenant AND existing.actor_id = v_actor.actor_id
       AND existing.endpoint = 'POST /v1/proposals' AND existing.key = p_idempotency_key;
    -- A REUSED KEY WITH A DIFFERENT BODY IS `IDEMPOTENT_REPLAY`, not a second
    -- proposal. Same key, same body is a retry and returns the original.
    IF v_key.request_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'idempotency key reused with a different body'
        USING ERRCODE = 'TRNOS',
              DETAIL = pg_catalog.jsonb_build_object('code','IDEMPOTENT_REPLAY')::text;
    END IF;
    v_replayed := NULLIF(v_key.response ->> 'id','')::uuid;
    IF v_replayed IS NOT NULL THEN
      PERFORM pg_catalog.set_config('response.headers','[{"Idempotent-Replay":"true"}]', true);
      RETURN core.get_proposal(v_replayed::text);
    END IF;
    -- The key is claimed but IN_FLIGHT: a concurrent request holds it and has
    -- not finished. Refusing is correct; inventing a second proposal is not.
    RAISE EXCEPTION 'a request with this idempotency key is still in flight'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','IDEMPOTENT_REPLAY')::text;
  END IF;

  SELECT opportunity.* INTO v_opportunity FROM core.opportunities AS opportunity
   WHERE opportunity.tenant_id = v_tenant
     AND (opportunity.ref = (p_body ->> 'opportunityRef')
          OR opportunity.id::text = (p_body ->> 'opportunityRef'));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown opportunityRef'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','NOT_FOUND','reason','UNKNOWN_OPPORTUNITY')::text;
  END IF;

  SELECT template.* INTO v_template FROM core.templates AS template
   WHERE template.tenant_id = v_tenant
     AND (template.id::text = (p_body ->> 'templateId') OR template.ref = (p_body ->> 'templateId'));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown templateId'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','NOT_FOUND','reason','UNKNOWN_TEMPLATE')::text;
  END IF;

  SELECT programme.* INTO v_programme FROM core.programmes AS programme
   WHERE programme.tenant_id = v_tenant
     AND (programme.id::text = (p_body ->> 'programmeId') OR programme.ref = (p_body ->> 'programmeId'));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown programmeId'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','NOT_FOUND','reason','UNKNOWN_PROGRAMME')::text;
  END IF;

  INSERT INTO core.proposals
    (tenant_id, opportunity_id, organisation_id, template_id, programme_id, status,
     value_sen, currency, created_by_kind, created_by_id, created_by_name)
  VALUES
    (v_tenant, v_opportunity.id, v_opportunity.organisation_id, v_template.id, v_programme.id,
     'DRAFT',
     -- The opening value is the opportunity's, or the programme's list price
     -- when the deal has not been valued. NOT a computed price: pricing is
     -- `core.put_quotation`'s and the §18 money rule lives in 007.
     COALESCE(v_opportunity.value_sen, v_programme.list_price_sen),
     'MYR',
     COALESCE(v_actor.actor_kind, 'HUMAN')::app.actor_kind, v_actor.actor_id, NULL)
  RETURNING * INTO v_proposal;

  -- Sections come from the template, in the template's own order. A proposal
  -- that invented its own section list would diverge from the template the
  -- moment either changed.
  INSERT INTO core.proposal_sections
    (tenant_id, proposal_id, n, title, body, needs_review,
     created_by_kind, created_by_id, created_by_name)
  SELECT v_tenant, v_proposal.id, section.n, section.title, section.default_body, false,
         COALESCE(v_actor.actor_kind, 'HUMAN')::app.actor_kind, v_actor.actor_id, NULL
    FROM core.template_sections AS section
   WHERE section.tenant_id = v_tenant AND section.template_id = v_template.id
   ORDER BY section.n;

  -- The key stops being decorative here, and the §8 pin asserts this row.
  -- WHY `response` CARRIES A `status` KEY: 011's own
  -- `idempotency_keys_response_shape` CHECK accepts a response object only
  -- when it has `status`, or `data` + `count`. An `app.ok(...)` envelope has
  -- neither, so what is stored is the REPLAY RECORD — the outcome and the id
  -- of the row that was created — and the replay branch above re-projects the
  -- proposal fresh rather than serving a stale copy. That is also better
  -- behaviour: a retry three minutes later sees the current proposal.
  UPDATE app.idempotency_keys
     SET state = 'COMPLETED',
         response = pg_catalog.jsonb_build_object(
           'status','EXECUTED','entity','proposal','id', v_proposal.id::text),
         status_code = 201,
         completed_at = pg_catalog.now(),
         expires_at = pg_catalog.now() + interval '24 hours'
   WHERE id = v_key.id;

  -- §6: "Status 201 has no meaning over PostgREST; the created record IS the
  -- response."
  RETURN core.get_proposal(v_proposal.id::text);
END;
$fn$;

-- ═══ 8 · Quotations — the money rule, delegated to 007 on purpose ══════════

CREATE OR REPLACE FUNCTION core.get_quotation(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant   uuid := app.require_tenant_id();
  v_row      core.quotations%ROWTYPE;
  v_prop_ref text;
  v_version  text;
  v_year     integer;
  v_lines    jsonb;
BEGIN
  SELECT quotation.* INTO v_row FROM core.quotations AS quotation
   WHERE quotation.tenant_id = v_tenant
     AND (quotation.id::text = p_id OR quotation.ref = p_id);
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('id', p_id));
  END IF;

  SELECT proposal.ref INTO v_prop_ref FROM core.proposals AS proposal
   WHERE proposal.tenant_id = v_tenant AND proposal.id = v_row.proposal_id;

  -- §18 supersede: every quotation stores the rate card version it was priced
  -- against, so a card that changes tomorrow does not silently re-price a
  -- quotation sent yesterday.
  SELECT card.version, pg_catalog.date_part('year', card.effective_from)::integer
    INTO v_version, v_year
    FROM core.rate_cards AS card
   WHERE card.tenant_id = v_tenant AND card.id = v_row.rate_card_id;

  SELECT COALESCE(pg_catalog.jsonb_agg(item.row ORDER BY item.n), '[]'::jsonb)
    INTO v_lines
    FROM (
      SELECT line.n,
             pg_catalog.jsonb_build_object(
               'item',  line.item,
               'qty',   line.qty,
               -- `total` is READ from the GENERATED column, never recomputed
               -- here. 007 defines it as
               -- `app.round_half_up_sen(unit_price_sen * qty)`; a second
               -- expression in this file would be a second money rule.
               'total', app._money(line.total_sen, line.currency::text))
             || CASE WHEN line.detail IS NULL THEN '{}'::jsonb
                     ELSE pg_catalog.jsonb_build_object('detail', line.detail) END
             || CASE WHEN line.unit IS NULL THEN '{}'::jsonb
                     ELSE pg_catalog.jsonb_build_object('unit', line.unit) END
             || pg_catalog.jsonb_build_object('rate',
                  app._money(line.unit_price_sen, line.currency::text)) AS row
        FROM core.quotation_lines AS line
       WHERE line.tenant_id = v_tenant AND line.quotation_id = v_row.id
    ) AS item;

  RETURN app.ok(
    pg_catalog.jsonb_build_object(
      'id',        v_row.id::text,
      'ref',       v_row.ref,
      'createdAt', v_row.created_at,
      'updatedAt', v_row.updated_at,
      'createdBy', app._actor(v_row.created_by_kind::text, v_row.created_by_id, v_row.created_by_name),
      'proposalRef', v_prop_ref,
      'status',      v_row.status,
      'rateCardVersion', COALESCE(v_version, 'v0-placeholder'),
      'lines',        v_lines,
      'sellPrice',    app._money(v_row.sell_price_sen,  v_row.currency::text),
      'directCost',   app._money(v_row.direct_cost_sen, v_row.currency::text),
      'marginRate',   COALESCE(v_row.margin_rate, 0),
      'floorPrice',   app._money(v_row.floor_price_sen, v_row.currency::text),
      'floorMarginRate',    v_row.floor_margin_rate,
      -- RULING R6: both floors made explicit, plus which one binds. Before
      -- R6 nothing recorded WHICH constraint produced `floorPrice`, and the
      -- two are acted on differently — an absolute breach is a conversation
      -- about the tier, a margin breach is a conversation about cost.
      --
      -- 007 stores the basis as 'PROGRAMME' | 'MARGIN' (a GENERATED column);
      -- the contract's `BindingFloorBasis` is 'ABSOLUTE' | 'MARGIN'. They are
      -- the same fact under two names and the mapping happens HERE, once,
      -- rather than in every screen that reads it.
      'absoluteFloorPrice', app._money(v_row.programme_floor_price_sen, v_row.currency::text),
      'marginFloorPrice',   app._money(v_row.margin_floor_price_sen,    v_row.currency::text),
      'bindingFloorBasis',  CASE WHEN v_row.binding_floor_basis = 'PROGRAMME'
                                 THEN 'ABSOLUTE' ELSE v_row.binding_floor_basis END,
      'commissionRate',     COALESCE(v_row.commission_rate, 0),
      'commission',         app._money(COALESCE(v_row.commission_sen, 0), v_row.currency::text),
      'commissionPayableOn', COALESCE(v_row.commission_payable_on, 'COLLECTION'))
    || CASE WHEN v_year IS NULL THEN '{}'::jsonb
            ELSE pg_catalog.jsonb_build_object('rateCardYear', v_year) END
    -- §15 item 3 / §18: a per-pax figure that does not multiply cleanly is
    -- DISPLAY ONLY. It lives under `display`, never as a line, and never in
    -- any sum.
    || CASE WHEN v_row.display_per_pax_sen IS NULL THEN '{}'::jsonb
            ELSE pg_catalog.jsonb_build_object('display',
                   pg_catalog.jsonb_build_object('perPax',
                     app._money(v_row.display_per_pax_sen, v_row.currency::text))) END);
END;
$fn$;

CREATE OR REPLACE FUNCTION core.put_quotation(
  p_id              text,
  p_body            jsonb,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant   uuid := app.require_tenant_id();
  v_actor    record;
  v_row      core.quotations%ROWTYPE;
  v_line     jsonb;
  v_n        smallint := 0;
  v_qty      numeric;
  v_unit     bigint;
  v_claimed  bigint;
  v_computed bigint;
  v_hash     text;
  v_key      app.idempotency_keys%ROWTYPE;
  v_after      core.quotations%ROWTYPE;
  v_sell       bigint;
  v_sum_sell   bigint;
  v_sum_cost   bigint;
  v_line_count integer;
  v_tax        record;
BEGIN
  SELECT actor.* INTO v_actor FROM app.current_actor() AS actor;
  IF v_actor.role IS NULL THEN
    RAISE EXCEPTION 'requester has no app_role'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','FORBIDDEN')::text;
  END IF;

  SELECT quotation.* INTO v_row FROM core.quotations AS quotation
   WHERE quotation.tenant_id = v_tenant
     AND (quotation.id::text = p_id OR quotation.ref = p_id)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such quotation'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','NOT_FOUND')::text;
  END IF;

  IF NULLIF(p_idempotency_key,'') IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext(v_tenant::text || ':' || v_actor.actor_id || ':' || p_idempotency_key)::bigint);
    v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
                pg_catalog.jsonb_build_object('id', p_id, 'body', p_body)::text, 'UTF8')), 'hex');
    INSERT INTO app.idempotency_keys (tenant_id, actor_id, endpoint, key, request_hash)
    VALUES (v_tenant, v_actor.actor_id, 'PUT /v1/quotations', p_idempotency_key, v_hash)
    ON CONFLICT (tenant_id, actor_id, endpoint, key) DO NOTHING
    RETURNING * INTO v_key;
    IF v_key.id IS NULL THEN
      SELECT existing.* INTO v_key FROM app.idempotency_keys AS existing
       WHERE existing.tenant_id = v_tenant AND existing.actor_id = v_actor.actor_id
         AND existing.endpoint = 'PUT /v1/quotations' AND existing.key = p_idempotency_key;
      IF v_key.request_hash IS DISTINCT FROM v_hash THEN
        RAISE EXCEPTION 'idempotency key reused with a different body'
          USING ERRCODE = 'TRNOS',
                DETAIL = pg_catalog.jsonb_build_object('code','IDEMPOTENT_REPLAY')::text;
      END IF;
      -- A PUT is idempotent by definition, so a same-body replay returns the
      -- current record rather than rewriting identical lines.
      PERFORM pg_catalog.set_config('response.headers','[{"Idempotent-Replay":"true"}]', true);
      RETURN core.get_quotation(v_row.id::text);
    END IF;
  END IF;

  p_body := COALESCE(p_body, '{}'::jsonb);

  IF p_body ? 'lines' AND pg_catalog.jsonb_typeof(p_body -> 'lines') = 'array' THEN
    -- LINES ARE TRUTH (§18). The submitted `total` on each line is VALIDATED
    -- against `app.round_half_up_sen(rate × qty)` — 001:372, the one rounding
    -- function in the codebase — and a disagreement is refused rather than
    -- silently corrected. Getting this wrong does not look like a bug: it
    -- looks like an invoice one sen out, which `reconcileInvoice` rejects
    -- later with `details.reason: "TOTAL_NOT_RECONCILED"`.
    --
    -- Nothing here multiplies money in floating point. `qty` is numeric,
    -- `unit_price_sen` is bigint, and the product goes through
    -- `app.round_half_up_sen` before it is compared to anything.
    FOR v_line IN SELECT element.value
                    FROM pg_catalog.jsonb_array_elements(p_body -> 'lines') AS element(value)
    LOOP
      v_n := v_n + 1;
      IF pg_catalog.jsonb_typeof(v_line -> 'qty') <> 'number' THEN
        RAISE EXCEPTION 'line qty must be a number'
          USING ERRCODE = 'TRNOS',
                DETAIL = pg_catalog.jsonb_build_object(
                  'code','VALIDATION_FAILED','fields', pg_catalog.jsonb_build_array(
                    pg_catalog.jsonb_build_object(
                      'field','lines[' || v_n || '].qty','reason','NOT_A_NUMBER')))::text;
      END IF;
      v_qty  := (v_line ->> 'qty')::numeric;
      v_unit := COALESCE(NULLIF(v_line #>> '{rate,amount}','')::bigint, 0);
      v_computed := app.round_half_up_sen(v_unit::numeric * v_qty);
      v_claimed  := NULLIF(v_line #>> '{total,amount}','')::bigint;

      IF v_claimed IS NOT NULL AND v_claimed <> v_computed THEN
        RAISE EXCEPTION 'line % total does not equal rate x qty rounded half-up', v_n
          USING ERRCODE = 'TRNOS',
                DETAIL = pg_catalog.jsonb_build_object(
                  'code','VALIDATION_FAILED',
                  'reason','TOTAL_NOT_RECONCILED',
                  'fields', pg_catalog.jsonb_build_array(
                    pg_catalog.jsonb_build_object(
                      'field','lines[' || v_n || '].total',
                      'reason','TOTAL_NOT_RECONCILED')),
                  'claimed', v_claimed, 'computed', v_computed)::text;
      END IF;
    END LOOP;

    DELETE FROM core.quotation_lines AS line
     WHERE line.tenant_id = v_tenant AND line.quotation_id = v_row.id;

    -- `total_sen` is DELIBERATELY NOT INSERTED: it is a GENERATED column and
    -- the database computes it. `is_cost` decides which side of the margin a
    -- line falls on, and `basis` carries 007's own vocabulary.
    INSERT INTO core.quotation_lines
      (tenant_id, quotation_id, n, item, detail, basis, qty, unit, unit_price_sen, is_cost)
    SELECT v_tenant, v_row.id,
           (pg_catalog.row_number() OVER ())::smallint,
           COALESCE(element.value ->> 'item', 'Line'),
           element.value ->> 'detail',
           COALESCE(element.value ->> 'basis', 'PER_UNIT'),
           (element.value ->> 'qty')::numeric,
           element.value ->> 'unit',
           COALESCE(NULLIF(element.value #>> '{rate,amount}','')::bigint, 0),
           COALESCE((element.value ->> 'isCost')::boolean, false)
      FROM pg_catalog.jsonb_array_elements(p_body -> 'lines') AS element(value);
  END IF;

  -- A submitted `sellPrice` is CHECKED against the lines, never written over
  -- them. 007's `core.quotation_recalc()` has already summed the rounded
  -- non-cost lines onto the header, so a disagreement here is the client
  -- claiming a total its own lines do not produce.
  IF p_body ? 'sellPrice' THEN
    SELECT quotation.sell_price_sen INTO v_sell FROM core.quotations AS quotation
     WHERE quotation.tenant_id = v_tenant AND quotation.id = v_row.id;
    IF NULLIF(p_body #>> '{sellPrice,amount}','')::bigint IS DISTINCT FROM v_sell THEN
      RAISE EXCEPTION 'submitted sellPrice does not equal the sum of the rounded lines'
        USING ERRCODE = 'TRNOS',
              DETAIL = pg_catalog.jsonb_build_object(
                'code','VALIDATION_FAILED',
                'reason','TOTAL_NOT_RECONCILED',
                'claimed', NULLIF(p_body #>> '{sellPrice,amount}','')::bigint,
                'computed', v_sell)::text;
    END IF;
  END IF;

  -- ── RULING R-C · SST COMES FROM core.tax_policies, NEVER FROM A CONSTANT ─
  --
  -- STATUS CHANGED SINCE 018 WAS FIRST WRITTEN, and this is the whole of the
  -- change. When 018 was authored against 001-013, neither `core.tax_policies`
  -- nor `app.resolve_tax_policy()` existed, so the PR recorded R-C as a
  -- dependency and the pin emitted a skip. 017 §SST created both, and 017 also
  -- added six SST columns to `core.quotations`. Two of them —
  -- `sst_sen` and `gross_price_sen` — are GENERATED from
  -- `sell_price_sen * sst_rate`. The other four are PLAIN COLUMNS WITH
  -- DEFAULTS AND NO TRIGGER BEHIND THEM: `sst_rate` defaults to 0 and
  -- `sst_reason` to 'STANDARD_RATED'.
  --
  -- So a quotation written by anything that does not resolve a policy is
  -- standard-rated at zero per cent — a quotation that looks taxed and carries
  -- no tax. 017's own resolver says why that must not happen: "A missing policy
  -- must not silently become a zero rate: that is an invoice filed with no SST
  -- and no reason." Filling those four columns is the RPC's job, and R-C names
  -- this RPC. It is done HERE, once, on the write path.
  --
  -- THE CATEGORY. `app.resolve_tax_policy` selects on `service_category`. 017
  -- seeds two national policies: `CORPORATE_TRAINING` (Group G professionals,
  -- 800 bps, `is_default = true`) and `EDUCATION_ACT_INSTITUTION` (exempt).
  -- A quotation is priced for corporate training, so `CORPORATE_TRAINING` is
  -- the category. Choosing the exempt one requires knowing the BUYER is an
  -- Education Act institution, and no column in 001-017 records that — see the
  -- PR. Hardcoding the default would be the defect R-C exists to prevent;
  -- resolving the default category through the registry is not, because the
  -- rate, the exemption and the policy id all come from the row.
  --
  -- The resolver RAISES `no_data_found` rather than returning nothing. That is
  -- deliberate on 017's side and is translated here rather than swallowed: a
  -- quotation that cannot be taxed is a refusal, not a zero.
  BEGIN
    SELECT resolved.* INTO STRICT v_tax
      FROM app.resolve_tax_policy(v_tenant, 'CORPORATE_TRAINING') AS resolved;
  EXCEPTION WHEN no_data_found THEN
    RAISE EXCEPTION 'no SST policy is registered for corporate training'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','VALIDATION_FAILED',
              'reason','NO_TAX_POLICY',
              'category','CORPORATE_TRAINING')::text;
  END;

  UPDATE core.quotations AS quotation
     SET sst_policy_id = v_tax.policy_id,
         sst_rate      = v_tax.rate,
         -- 017's CHECK pairs these: TRAINING_EXEMPT demands a zero rate AND a
         -- non-blank reason, so the exempt branch supplies both or neither.
         sst_reason    = CASE WHEN v_tax.exempt THEN 'TRAINING_EXEMPT'
                              ELSE 'STANDARD_RATED' END,
         sst_exempt_reason = CASE
           WHEN v_tax.exempt AND v_tax.exempt_reason_required
             THEN 'Resolved from tax policy ' || v_tax.policy_code
                  || ' (' || v_tax.scope || ')'
           ELSE NULL END
   WHERE quotation.tenant_id = v_tenant AND quotation.id = v_row.id;

  -- ── TRANSLATING 007'S TWO ASSERTIONS INTO CONTRACT ERROR CODES ──────────
  --
  -- 007 enforces the money rule with two DEFERRABLE INITIALLY DEFERRED
  -- constraint triggers, which fire at COMMIT — outside this function, where
  -- the error can no longer be turned into a contract error code and reaches
  -- the client as a raw integrity violation with 007's own message.
  --
  -- `SET CONSTRAINTS ... IMMEDIATE` DOES NOT SOLVE THIS, and that was measured
  -- rather than assumed: inside a PL/pgSQL block with an exception handler the
  -- statement succeeds and fires nothing, because the handler opens a
  -- subtransaction and the deferred-event queue is not processed there. The
  -- first version of this function used it and T14 caught 007's raw message
  -- coming through untranslated.
  --
  -- So the check is made HERE, by READING BACK the columns 007 GENERATED.
  -- This computes no money of its own — `sell_price_sen` and
  -- `direct_cost_sen` were written by `core.quotation_recalc()`, and
  -- `below_floor`, `floor_price_sen`, `margin_floor_price_sen`,
  -- `binding_floor_basis` and `margin_rate` are generated columns. 007 remains
  -- the enforcement; its deferred triggers still fire at COMMIT as the
  -- backstop. This is the translation layer, and it refuses FIRST so the
  -- client gets FLOOR_PRICE_BREACH and TOTAL_NOT_RECONCILED rather than 23000.
  SELECT quotation.* INTO v_after FROM core.quotations AS quotation
   WHERE quotation.tenant_id = v_tenant AND quotation.id = v_row.id;

  SELECT COALESCE(pg_catalog.sum(line.total_sen) FILTER (WHERE NOT line.is_cost), 0),
         COALESCE(pg_catalog.sum(line.total_sen) FILTER (WHERE     line.is_cost), 0),
         pg_catalog.count(*)::integer
    INTO v_sum_sell, v_sum_cost, v_line_count
    FROM core.quotation_lines AS line
   WHERE line.tenant_id = v_tenant AND line.quotation_id = v_row.id;

  -- A quotation with NO lines is a draft being started, not a disagreement —
  -- 007 makes the same exemption, and the two must agree or a legal draft is
  -- refused by one and accepted by the other.
  IF v_line_count > 0
     AND (v_after.sell_price_sen <> v_sum_sell OR v_after.direct_cost_sen <> v_sum_cost) THEN
    RAISE EXCEPTION 'quotation header does not equal the sum of its rounded lines'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','VALIDATION_FAILED',
              'reason','TOTAL_NOT_RECONCILED',
              'claimedSell', v_after.sell_price_sen, 'lineSell', v_sum_sell,
              'claimedCost', v_after.direct_cost_sen, 'lineCost', v_sum_cost)::text;
  END IF;

  IF v_line_count > 0 AND v_after.below_floor AND v_after.discount_approval_id IS NULL THEN
    -- The full RULING R6 bag. `floorPrice` alone says a price is too low; it
    -- does not say WHICH constraint made it too low, and the two are acted on
    -- differently — an absolute breach is a conversation about the tier, a
    -- margin breach is a conversation about cost.
    --
    -- `POLICY_APPROVAL_REQUIRED` IS NOT RAISED HERE: a discount that needs
    -- approval goes through `DISCOUNT_APPROVE` on `core.perform_action`, which
    -- is the one endpoint that gates approvals. Raising it here would put a
    -- second approval path beside the spine.
    RAISE EXCEPTION 'quotation is priced below its binding floor'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','FLOOR_PRICE_BREACH',
              'floorPrice',          app._money(v_after.floor_price_sen, v_after.currency::text),
              'resultingMarginRate', COALESCE(v_after.margin_rate, 0),
              'requiresPolicy',      'APV-02',
              'absoluteFloorPrice',  app._money(v_after.programme_floor_price_sen, v_after.currency::text),
              'marginFloorPrice',    app._money(v_after.margin_floor_price_sen, v_after.currency::text),
              'bindingFloorBasis',   CASE WHEN v_after.binding_floor_basis = 'PROGRAMME'
                                          THEN 'ABSOLUTE' ELSE v_after.binding_floor_basis END)::text;
  END IF;

  IF v_key.id IS NOT NULL THEN
    UPDATE app.idempotency_keys
       SET state = 'COMPLETED',
           response = pg_catalog.jsonb_build_object(
             'status','EXECUTED','entity','quotation','id', v_row.id::text),
           status_code = 200,
           completed_at = pg_catalog.now(),
           expires_at = pg_catalog.now() + interval '24 hours'
     WHERE id = v_key.id;
  END IF;

  RETURN core.get_quotation(v_row.id::text);
END;
$fn$;

-- ═══ 9 · Approvals — closing the loop `core.perform_action` opens ══════════
--
-- `core.v_approval_requests` (011:1408) ALREADY COMPUTES THE HARD PARTS —
-- `sla_breached`, `sla_remaining_minutes` and `urgency_group`, in the tenant's
-- own timezone. These read it rather than recomputing: a second copy of the
-- urgency boundaries will drift from the first, and the drift shows up as two
-- screens disagreeing about whether an approval is late.
--
-- The view is `REVOKE ALL … FROM PUBLIC, anon, authenticated` (011:1428), and
-- THAT IS WHY THESE ARE RPCs. A `SECURITY DEFINER` function in `core` can read
-- it; a browser cannot. **Do not grant the view to `authenticated` to shortcut
-- this** — it carries `diff`, `diff_hash`, `recommendation` and `evidence` for
-- every approval in the tenant regardless of approver role, and a `SELECT` on
-- it is a read of every pending decision in the business.

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

-- ═══ 10 · Configuration reads ══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION core.get_policy(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
  v_row    core.action_policies%ROWTYPE;
BEGIN
  -- `core.action_policies.id` is TEXT ('APV-01'), not a uuid — the policy id
  -- is the business identifier and is what the §3 error bag carries back as
  -- `details.policyId`. So there is one lookup here, not an id-or-ref pair.
  SELECT policy.* INTO v_row FROM core.action_policies AS policy
   WHERE policy.tenant_id = v_tenant AND policy.id = p_id;
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('id', p_id));
  END IF;

  RETURN app.ok(
    pg_catalog.jsonb_build_object(
      'id',           v_row.id,
      'actionType',   v_row.action_type,
      'description',  v_row.description,
      'conditions',   v_row.conditions,
      'combinator',   v_row.combinator,
      'approverRole', v_row.approver_role,
      'slaMinutes',   v_row.sla_minutes)
    || CASE WHEN v_row.escalate_to_role IS NULL THEN '{}'::jsonb
            ELSE pg_catalog.jsonb_build_object('escalateToRole', v_row.escalate_to_role) END
    || CASE WHEN v_row.escalate_after_minutes IS NULL THEN '{}'::jsonb
            ELSE pg_catalog.jsonb_build_object('escalateAfterMinutes', v_row.escalate_after_minutes) END);
END;
$fn$;

CREATE OR REPLACE FUNCTION core.get_pipeline_config(p_object text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant   uuid := app.require_tenant_id();
  v_pipeline core.pipelines%ROWTYPE;
  v_stages   jsonb;
BEGIN
  -- THE SECOND SPINE. Stage names and order render from `core.pipeline_steps`
  -- rows, in `position` order, with the label the row carries. A hardcoded
  -- stage list anywhere in SQL is a defect (`supabase/CLAUDE.md`), and this is
  -- the endpoint every LifecycleStepper in the product reads.
  --
  -- KNOWN DIVERGENCE, stated rather than papered over: 004's
  -- `pipelines_object_check` allows ENGAGEMENT | OPPORTUNITY | PACKET, while
  -- the contract's `PIPELINE_OBJECTS` is ENGAGEMENT | DEAL_CHAIN |
  -- OPPORTUNITY. `DEAL_CHAIN` therefore has no rows and answers NOT_FOUND,
  -- and `PACKET` is reachable but is not a contract value. This function does
  -- NOT map one onto the other: inventing an alias would hide a schema/contract
  -- disagreement that has to be settled in 003/004, not here. See the PR.
  IF NULLIF(p_object,'') IS NULL THEN
    RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
      'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field','object','reason','REQUIRED'))));
  END IF;

  SELECT pipeline.* INTO v_pipeline FROM core.pipelines AS pipeline
   WHERE pipeline.tenant_id = v_tenant
     AND pipeline.object = p_object
     AND pipeline.status = 'ACTIVE'
   ORDER BY pipeline.is_default DESC, pipeline.version DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('object', p_object));
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'key',      step.step_key,
             'label',    step.label,
             'order',    step.position,
             -- Ruling R16: `terminal` is stored, not inferred from `order`.
             -- Inferring an ending from the highest order is how a computed
             -- chain puts LOST after WON rather than beside it.
             'terminal', step.terminal)
           ORDER BY step.position), '[]'::jsonb)
    INTO v_stages
    FROM core.pipeline_steps AS step
   WHERE step.tenant_id = v_tenant AND step.pipeline_id = v_pipeline.id;

  -- Ruling R16's `outcome` is NOT emitted: `core.pipeline_steps` has no
  -- outcome column in 001–013 and `core.stage_outcome` is listed in
  -- `supabase/HANDOFF.md` as a pending 003/004 change. The field is optional
  -- in the contract, and omitting it is honest; emitting a guess is not.
  RETURN app.ok(pg_catalog.jsonb_build_object(
    'object', v_pipeline.object,
    'stages', v_stages));
END;
$fn$;

CREATE OR REPLACE FUNCTION core.get_programme(p_id text)
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
  SELECT programme.* INTO v_row FROM core.programmes AS programme
   WHERE programme.tenant_id = v_tenant
     AND (programme.id::text = p_id OR programme.ref = p_id);
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('id', p_id));
  END IF;

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'id',        v_row.id::text,
    'ref',       v_row.ref,
    'createdAt', v_row.created_at,
    'updatedAt', v_row.updated_at,
    'createdBy', app._actor(v_row.created_by_kind::text, v_row.created_by_id, v_row.created_by_name),
    'name',     v_row.name,
    'category', v_row.category,
    'days',     v_row.days,
    'version',  v_row.version,
    'status',   v_row.status,
    'hrdcScheme',    v_row.hrdc_scheme::text,
    'hrdcClaimable', v_row.hrdc_claimable,
    -- `floorPrice` is the SERVER value the costing screen validates against —
    -- never a client constant, which is the whole reason it is on the record.
    'listPrice',    app._money(v_row.list_price_sen,  v_row.currency),
    'listPricePax', v_row.list_price_pax,
    'floorPrice',   app._money(v_row.floor_price_sen, v_row.currency),
    'floorMarginRate', v_row.floor_margin_rate,
    'outcomes',  pg_catalog.to_jsonb(v_row.outcomes),
    'modules', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'n', module.n, 'title', module.title,
               'format', module.format, 'durationMinutes', module.duration_minutes)
             ORDER BY module.n)
        FROM core.programme_modules AS module
       WHERE module.tenant_id = v_tenant AND module.programme_id = v_row.id), '[]'::jsonb),
    'pricingTiers', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'maxPax', tier.max_pax,
               'price',  app._money(tier.price_sen, tier.currency))
             ORDER BY tier.max_pax)
        FROM core.programme_pricing_tiers AS tier
       WHERE tier.tenant_id = v_tenant AND tier.programme_id = v_row.id), '[]'::jsonb),
    'trainerPool', COALESCE((
      SELECT pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'trainerRef',   trainer.ref,
                 'name',         trainer.name,
                 'tttCertified', trainer.ttt_certified)
               || CASE WHEN trainer.ttt_ref IS NULL THEN '{}'::jsonb
                       ELSE pg_catalog.jsonb_build_object('tttRef', trainer.ttt_ref) END
               || CASE WHEN COALESCE(link.rating_override, trainer.rating) IS NULL THEN '{}'::jsonb
                       ELSE pg_catalog.jsonb_build_object('rating',
                              COALESCE(link.rating_override, trainer.rating)) END
             ORDER BY trainer.name)
        FROM core.programme_trainers AS link
        JOIN core.trainers AS trainer
          ON trainer.tenant_id = link.tenant_id AND trainer.id = link.trainer_id
       WHERE link.tenant_id = v_tenant AND link.programme_id = v_row.id), '[]'::jsonb),
    'materials', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'type',      material.material_type,
               'version',   material.version,
               'languages', pg_catalog.to_jsonb(material.languages))
             ORDER BY material.material_type)
        FROM core.programme_materials AS material
       WHERE material.tenant_id = v_tenant AND material.programme_id = v_row.id), '[]'::jsonb),
    'stats', pg_catalog.jsonb_build_object(
      'deliveries',        v_row.deliveries_count,
      'averageEvaluation', COALESCE(v_row.average_evaluation, 0))));
END;
$fn$;

CREATE OR REPLACE FUNCTION core.get_compliance_rule(p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant   uuid := app.require_tenant_id();
  v_row      core.compliance_rules%ROWTYPE;
  v_verifier text;
  v_affected integer;
BEGIN
  -- `core.compliance_rules.tenant_id` is NULLABLE: a rule read from an HRD
  -- Corp circular is the registry's, not a tenant's, and a null tenant means
  -- "applies to everyone". Both are readable here; neither leaks another
  -- tenant's overrides.
  SELECT rule.* INTO v_row FROM core.compliance_rules AS rule
   WHERE (rule.tenant_id = v_tenant OR rule.tenant_id IS NULL)
     AND (rule.id::text = p_id OR rule.rule_code = p_id);
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('id', p_id));
  END IF;

  SELECT profile.display_name INTO v_verifier FROM public.user_profiles AS profile
   WHERE profile.tenant_id = v_tenant AND profile.user_id = v_row.verified_by_user_id;

  SELECT pg_catalog.count(DISTINCT affected.engagement_id)::integer INTO v_affected
    FROM core.rule_change_affected_engagements AS affected
    JOIN core.rule_changes AS change
      ON change.tenant_id = affected.tenant_id AND change.id = affected.rule_change_id
   WHERE affected.tenant_id = v_tenant
     AND (change.target_rule_id = v_row.id OR change.new_rule_id = v_row.id);

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'id',      v_row.id::text,
    'scheme',  COALESCE(v_row.scheme::text, v_row.scheme_key),
    'subject', v_row.subject,
    'expression', pg_catalog.jsonb_build_object(
      'field',     v_row.subject_field,
      'op',        v_row.op::text,
      'reference', v_row.reference)
      || CASE WHEN v_row.offset_amount = 0 THEN '{}'::jsonb
              ELSE pg_catalog.jsonb_build_object('offsetDays', v_row.offset_amount) END
      -- DECISIONS §3: calendar days, not working days, until circular text
      -- says otherwise. The unit is stored, so this reads it rather than
      -- assuming the default it happens to agree with today.
      || CASE WHEN v_row.offset_unit IS NULL THEN '{}'::jsonb
              ELSE pg_catalog.jsonb_build_object('dayBasis',
                     CASE WHEN v_row.offset_unit::text = 'WORKING_DAY' THEN 'WORKING'
                          ELSE 'CALENDAR' END) END,
    'effectiveFrom', v_row.effective_from,
    'effectiveTo',   v_row.effective_to,
    'status',        v_row.status::text,
    'source', pg_catalog.jsonb_build_object(
      'documentId', COALESCE(v_row.source_document_id, ''),
      'title',      COALESCE(v_row.source_title, ''),
      'section',    COALESCE(v_row.source_section, ''),
      'page',       COALESCE(v_row.source_page, 0),
      'excerpt',    COALESCE(v_row.source_excerpt, '')),
    'supersedesId',   v_row.supersedes_rule_id::text,
    'supersededById', v_row.superseded_by_rule_id::text,
    'usedByChecks',   pg_catalog.to_jsonb(v_row.used_by_check_keys),
    'affectedOpenEngagements', COALESCE(v_affected, 0),
    -- DECISIONS §3 loads every rule as PROPOSED until compliance verifies it
    -- against the circular PDF, which is why these two are NULLABLE rather
    -- than absent: an unverified rule has to be visibly unverified.
    'verifiedBy', app._actor('HUMAN', v_row.verified_by_user_id::text, v_verifier),
    'verifiedAt', v_row.verified_at)
    || CASE WHEN app._provenance('compliance_rules', v_row.id, NULL) IS NULL THEN '{}'::jsonb
            ELSE pg_catalog.jsonb_build_object('provenance',
                   app._provenance('compliance_rules', v_row.id, NULL)) END);
END;
$fn$;

-- ═══ 10b · The ten RPCs the web-swap lane added ════════════════════════════
--
-- WHERE THEIR SPECS COME FROM. `docs/architecture/09-golden-path-rpc-specs.md`
-- specifies NONE of these ten: they arrived with the `cloud/web-swap` lane,
-- which added ten `TrainOsClient` methods and ten `RPC_NAMES` entries in the
-- same commit. So each shape below is DERIVED FROM THE CLIENT — the `p_*`
-- argument spellings are read off `rpcClient.ts` verbatim, and every returned
-- field is the contract type the method is declared to return, resolved out of
-- `packages/contract/src`. Each is listed as "spec derived from client" in the
-- PR. Where the fixtures oracle in `packages/fixtures` already implements the
-- endpoint, its behaviour is the tie-breaker, because the conformance suite
-- runs one set of cases against both it and the RPC client.
--
-- ⚠ `npm run check:rpc` DOES NOT AND CANNOT CATCH A MISSING RPC. E1 reads
-- migrations for hand-built envelopes, E2 reads the data layer for double
-- casts, E3 reads `client.ts` for return types. Nothing in that gate opens
-- `RPC_NAMES` or looks for a `CREATE FUNCTION`. A name in `RPC_NAMES` with no
-- SQL behind it is invisible to CI and shows up as `PGRST202` in a browser.
-- That is why these are implemented here rather than left to the gate.

CREATE OR REPLACE FUNCTION core.patch_enquiry_extraction(p_id text, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant  uuid := app.require_tenant_id();
  v_actor   record;
  v_row     core.enquiries%ROWTYPE;
  v_field   text;
  v_value   jsonb;
  v_text    text;
  v_field_id uuid;
  v_name    text;
BEGIN
  SELECT actor.* INTO v_actor FROM app.current_actor() AS actor;
  IF v_actor.role IS NULL THEN
    RAISE EXCEPTION 'requester has no app_role'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','FORBIDDEN')::text;
  END IF;

  v_field := p_patch ->> 'field';
  v_value := p_patch -> 'value';

  -- Only the four §4 extraction fields. An unknown field is VALIDATION_FAILED,
  -- never a silently created row: the fixtures oracle refuses the same way and
  -- the conformance suite compares the two.
  IF v_field IS NULL OR v_field NOT IN ('topic','audience','timing','budget') THEN
    RAISE EXCEPTION 'unknown extraction field'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','VALIDATION_FAILED','fields', pg_catalog.jsonb_build_array(
                pg_catalog.jsonb_build_object(
                  'field','field','reason','UNKNOWN_EXTRACTION_FIELD')))::text;
  END IF;

  SELECT enquiry.* INTO v_row FROM core.enquiries AS enquiry
   WHERE enquiry.tenant_id = v_tenant
     AND (enquiry.id::text = p_id OR enquiry.ref = p_id)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such enquiry'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','NOT_FOUND')::text;
  END IF;

  -- `budget` is Money on the wire and integer sen in the column. Everything
  -- else is a string. A JSON null erases the value rather than storing "null".
  v_text := CASE
              WHEN v_value IS NULL OR v_value = 'null'::jsonb THEN NULL
              WHEN v_field = 'budget' THEN (v_value ->> 'amount')
              ELSE v_value #>> '{}'
            END;

  INSERT INTO core.enquiry_extraction_fields
    (tenant_id, enquiry_id, field_key, value, created_by_kind, created_by_id, created_by_name)
  VALUES (v_tenant, v_row.id, v_field, v_text,
          COALESCE(v_actor.actor_kind,'HUMAN')::app.actor_kind, v_actor.actor_id, NULL)
  ON CONFLICT (tenant_id, enquiry_id, field_key)
    DO UPDATE SET value = EXCLUDED.value
  RETURNING id INTO v_field_id;

  SELECT profile.display_name INTO v_name FROM public.user_profiles AS profile
   WHERE profile.tenant_id = v_tenant AND profile.user_id::text = v_actor.actor_id;

  -- §1: A HUMAN EDIT OF AN AI VALUE FLIPS `origin` TO `AI_SUGGESTED` AND STAMPS
  -- `editedBy`. It does NOT erase the provenance — the lineage is what tells a
  -- later reader the number started as a model's guess, and the editor is what
  -- tells them who took responsibility for it. The fixtures oracle does exactly
  -- this and the conformance suite compares the two.
  --
  -- A field with NO provenance row stays without one: a human editing a
  -- human-authored value has nothing to disclose, and inserting a row here
  -- would badge it as AI-touched for ever after.
  -- ORIGIN IS NOT TOUCHED — it is immutable by 005's trigger, and it should be:
  -- the value's origin is a historical fact. Stamping the editor is what turns
  -- the badge into "AI, edited", and `app._provenance` derives `AI_SUGGESTED`
  -- from the pair on the way out.
  UPDATE core.provenance AS prov
     SET edited_by      = CASE WHEN v_actor.actor_kind = 'HUMAN'
                               THEN v_actor.actor_id::uuid ELSE prov.edited_by END,
         edited_by_name = COALESCE(v_name, v_actor.actor_id),
         edited_at      = pg_catalog.now()
   WHERE prov.tenant_id = v_tenant
     AND prov.subject_table = 'enquiry_extraction_fields'
     AND prov.subject_id = v_field_id
     AND prov.field = v_field;

  UPDATE core.enquiries AS enquiry SET updated_at = pg_catalog.now()
   WHERE enquiry.tenant_id = v_tenant AND enquiry.id = v_row.id;

  -- The whole EnquiryDetail comes back, not just the patched field: the editor
  -- re-renders from one payload and cannot drift from the record.
  RETURN core.get_enquiry(v_row.id::text);
END;
$fn$;

CREATE OR REPLACE FUNCTION core.list_follow_ups(
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
  v_desc    boolean := false;
  v_sort_col text := 'due_date';
  v_sort_fld text;
  v_where   text;
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

  -- SAVED VIEW. This parameter was DECLARED AND NEVER READ: a reader who asked
  -- for a saved view got every row in the tenant with `appliedFilters: []` and
  -- `success: true`. `core.saved_view_object` has no value for this list's
  -- object, so a view for it cannot exist and the only honest answers are
  -- "refuse" or "resolve it once the enum has the value". `app._view_filters`
  -- gives both: it refuses off the enum today and resolves the day the
  -- contract adds the value, with no edit here.
  BEGIN
    v_merged := app._view_filters(v_tenant, p_view, 'FOLLOW_UP', p_filter);
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
      FROM (VALUES ('status','status','text'), ('autonomy','autonomy','text'),
                   ('dueDate','due_date','ts'), ('owner','owner_id','uuid'),
                   ('organisation','organisation_id','uuid'),
                   ('contact','contact_id','uuid'), ('reason','reason','text'))
           AS allowed(field, column_name, kind)
     WHERE allowed.field = v_field;
    IF v_column IS NULL THEN
      v_errors := v_errors || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field', COALESCE(v_field,'(null)'), 'reason','UNKNOWN_FILTER_FIELD'));
      CONTINUE;
    END IF;
    BEGIN
      -- `dueDate` is a DATE column, so the ts predicate casts cleanly; the
      -- whitelist keeps the cast honest.
      v_clauses := v_clauses || app._predicate(v_column,
                     CASE WHEN v_column = 'due_date' THEN 'text' ELSE v_kind END, v_op, v_clause -> 'value');
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
      FROM (VALUES ('dueDate','due_date'),('createdAt','created_at'),('updatedAt','updated_at'))
           AS allowed(field, column_name)
     WHERE allowed.field = v_sort_fld;
    IF v_sort_col IS NULL THEN
      RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
        'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'field','sort','reason','UNKNOWN_SORT_FIELD','code', v_sort_fld))));
    END IF;
  END IF;
  -- The fixtures oracle defaults this list to `dueDate` ASCENDING, and the
  -- client sends `p_sort: null` when the caller does not choose. So the DEFAULT
  -- LIVES HERE or the two answer differently — soonest-due first is the only
  -- order a follow-up queue can sensibly open in.

  v_where := CASE WHEN pg_catalog.array_length(v_clauses,1) IS NULL THEN 'true'
                  ELSE pg_catalog.array_to_string(v_clauses,' AND ') END;

  -- COUNT BEFORE KEYSET, CURSOR FROM A REAL LOOKAHEAD — both orderings now
  -- live in `app._keyset_scope` / `app._next_cursor` (§1), so no copy of this
  -- engine can get either one wrong on its own. See the helpers' header for
  -- the two defects this pair replaces.
  -- `p_date_sort => true`: `due_date` is a DATE column, so the keyset tuple
  -- casts it to timestamptz to compare against the cursor's own type. The two
  -- timestamptz sort columns are unaffected by the cast.
  SELECT scope.o_total, scope.o_where INTO v_total, v_keyed
    FROM app._keyset_scope('core.follow_ups'::regclass, v_tenant, v_where,
                           v_sort_col, v_desc, v_cur_at, v_cur_id, true) AS scope;

  -- THE PAGE IS SELECTED BEFORE THE JOINS, in a CTE, exactly as
  -- `core.list_enquiries` does it — and here that is a correctness rule rather
  -- than a style. `app._predicate` and the keyset tuple both emit BARE column
  -- names, and `core.contacts` and `core.organisations` each carry their own
  -- `id`, `status` and `created_at`. Applied against the three-way join those
  -- names are AMBIGUOUS, and Postgres refuses the whole query with
  -- `column reference "id" is ambiguous` — a 500, not a refusal. It was latent
  -- only because nothing had ever paged this list or filtered it on `status`.
  -- Against one relation there is nothing for a bare name to be ambiguous
  -- with. Pinned by T31d-T31f.
  EXECUTE pg_catalog.format($q$
    WITH page AS (
      SELECT * FROM core.follow_ups
       WHERE tenant_id = $1 AND %s
       ORDER BY %I %s, id %s
       LIMIT $2
    )
    SELECT COALESCE(pg_catalog.jsonb_agg(row.item ORDER BY row.ord), '[]'::jsonb),
           pg_catalog.count(*)::integer,
           (pg_catalog.array_agg(row.sort_at ORDER BY row.ord DESC))[1],
           (pg_catalog.array_agg(row.id      ORDER BY row.ord DESC))[1]
      FROM (
        SELECT pg_catalog.row_number() OVER (ORDER BY f.%I %s, f.id %s) AS ord,
               f.id, f.%I::timestamptz AS sort_at,
               pg_catalog.jsonb_build_object(
                 'id',   f.id::text,
                 'ref',  f.ref,
                 'contact',      pg_catalog.jsonb_build_object('ref', contact.ref, 'name', contact.name),
                 'organisation', pg_catalog.jsonb_build_object('ref', org.ref,     'name', org.name),
                 'reason',   f.reason,
                 'dueDate',  f.due_date,
                 'status',   f.status::text,
                 'autonomy', f.autonomy::text) AS item
          FROM page AS f
          JOIN core.contacts      AS contact ON contact.tenant_id = f.tenant_id AND contact.id = f.contact_id
          JOIN core.organisations AS org     ON org.tenant_id     = f.tenant_id AND org.id     = f.organisation_id
      ) AS row$q$,
    v_keyed,
    v_sort_col, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END,
    v_sort_col, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END,
    v_sort_col)
    INTO v_rows, v_count, v_last_at, v_last_id USING v_tenant, v_size;

  v_next := app._next_cursor('core.follow_ups'::regclass, v_tenant, v_where,
                             v_sort_col, v_desc, v_count, v_size, v_last_at, v_last_id, true);

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'data', v_rows,
    'page', pg_catalog.jsonb_build_object('next', v_next, 'total', v_total),
    'appliedFilters', v_applied));
END;
$fn$;

CREATE OR REPLACE FUNCTION core.get_follow_up_draft(p_id text, p_channel text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant  uuid := app.require_tenant_id();
  v_follow  core.follow_ups%ROWTYPE;
  v_draft   core.outbound_messages%ROWTYPE;
  v_rate    core.message_rates%ROWTYPE;
  v_consent core.contact_consents%ROWTYPE;
  v_source  text;
  v_out     jsonb;
BEGIN
  IF p_channel IS NULL OR p_channel NOT IN ('EMAIL','WHATSAPP') THEN
    RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
      'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field','channel','reason','UNSUPPORTED_CHANNEL'))));
  END IF;

  SELECT follow_up.* INTO v_follow FROM core.follow_ups AS follow_up
   WHERE follow_up.tenant_id = v_tenant
     AND (follow_up.id::text = p_id OR follow_up.ref = p_id);
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('id', p_id));
  END IF;

  -- A DRAFT IS PER CHANNEL. The fixtures oracle keys its store
  -- `<followUpRef>::<CHANNEL>` and 404s per channel rather than handing back an
  -- empty draft, because an empty draft renders as a composer with nothing in
  -- it and reads as "the agent wrote nothing" instead of "nothing was drafted
  -- for this channel".
  SELECT message.* INTO v_draft FROM core.outbound_messages AS message
   WHERE message.tenant_id = v_tenant
     AND message.follow_up_id = v_follow.id
     AND message.channel::text = p_channel
   ORDER BY message.created_at DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object(
      'id', v_follow.ref, 'channel', p_channel));
  END IF;

  SELECT rate.* INTO v_rate FROM core.message_rates AS rate
   WHERE rate.tenant_id = v_tenant AND rate.id = v_draft.message_rate_id;

  SELECT consent.* INTO v_consent FROM core.contact_consents AS consent
   WHERE consent.tenant_id = v_tenant
     AND consent.contact_id = v_follow.contact_id
     AND consent.channel::text = p_channel
     AND consent.withdrawn_at IS NULL
   ORDER BY consent.recorded_at DESC
   LIMIT 1;

  -- §16 Q4 / RULING R11 — THE FAILURE IS A VALUE, NOT A ZERO.
  -- `rateSource` is REQUIRED and the two money fields are OPTIONAL precisely so
  -- that a failed rate lookup has an honest answer. A server whose lookup
  -- failed has no number to send, and sending a stale rate or a zero and
  -- rendering it to four decimal places is the most convincing way to be wrong
  -- about money. UNAVAILABLE when there is no rate row; CACHED when the row has
  -- gone past `stale_after`; LIVE otherwise.
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
      'channel',    p_channel,
      'granted',    COALESCE(v_consent.granted, false),
      'recordedAt', v_consent.recorded_at));

  IF v_source <> 'UNAVAILABLE' THEN
    v_out := v_out
      || pg_catalog.jsonb_build_object('ratePerMessage',
           app._money(v_draft.rate_per_message_sen, v_draft.currency::text))
      || pg_catalog.jsonb_build_object('estimatedCost',
           app._money(COALESCE(v_draft.estimated_cost_sen, v_draft.rate_per_message_sen),
                      v_draft.currency::text));
    -- The UNROUNDED rate as a string, because §4's marketing rate is RM 0.3467
    -- and the utility rate RM 0.0564: rounded to the sen the strip would print
    -- RM 0.35 beside RM 0.06 and the six-fold difference it exists to show
    -- would be read off two different precisions.
    IF COALESCE(v_draft.rate_per_message_exact, v_rate.rate_exact) IS NOT NULL THEN
      v_out := v_out || pg_catalog.jsonb_build_object('ratePerMessageExact',
        pg_catalog.trim(pg_catalog.to_char(
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

CREATE OR REPLACE FUNCTION core.list_proposals(
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

  -- SAVED VIEW. This parameter was DECLARED AND NEVER READ: a reader who asked
  -- for a saved view got every row in the tenant with `appliedFilters: []` and
  -- `success: true`. `core.saved_view_object` has no value for this list's
  -- object, so a view for it cannot exist and the only honest answers are
  -- "refuse" or "resolve it once the enum has the value". `app._view_filters`
  -- gives both: it refuses off the enum today and resolves the day the
  -- contract adds the value, with no edit here.
  BEGIN
    v_merged := app._view_filters(v_tenant, p_view, 'PROPOSAL', p_filter);
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
      FROM (VALUES ('status','status','text'),('opportunity','opportunity_id','uuid'),
                   ('organisation','organisation_id','uuid'),('template','template_id','uuid'),
                   ('value','value_sen','number'),('createdAt','created_at','ts'),
                   ('sentAt','sent_at','ts'))
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
      FROM (VALUES ('createdAt','created_at'),('updatedAt','updated_at'),
                   ('value','value_sen'),('sentAt','sent_at'))
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

  -- COUNT BEFORE KEYSET, CURSOR FROM A REAL LOOKAHEAD — both orderings now
  -- live in `app._keyset_scope` / `app._next_cursor` (§1), so no copy of this
  -- engine can get either one wrong on its own. See the helpers' header for
  -- the two defects this pair replaces.
  SELECT scope.o_total, scope.o_where INTO v_total, v_keyed
    FROM app._keyset_scope('core.proposals'::regclass, v_tenant, v_where,
                           v_sort_col, v_desc, v_cur_at, v_cur_id) AS scope;

  -- THE PAGE IS SELECTED HERE AND EACH ROW IS PROJECTED BY `core.get_proposal`.
  -- A `Proposal` carries its `sections[]`, each with its own provenance, and a
  -- second projection of that shape in this function would be a second place
  -- for it to drift. One projection, called per row on a bounded page.
  EXECUTE pg_catalog.format($q$
    SELECT COALESCE(pg_catalog.array_agg(p.id ORDER BY p.%I %s, p.id %s), ARRAY[]::uuid[])
      FROM (SELECT id, %I FROM core.proposals
             WHERE tenant_id = $1 AND %s
             ORDER BY %I %s, id %s
             LIMIT $2) AS p$q$,
    v_sort_col, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END,
    v_sort_col, v_keyed,
    v_sort_col, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END)
    INTO v_ids USING v_tenant, v_size;

  SELECT COALESCE(pg_catalog.jsonb_agg(core.get_proposal(element.id::text) -> 'data'
                                       ORDER BY element.ord), '[]'::jsonb),
         pg_catalog.count(*)::integer
    INTO v_rows, v_count
    FROM pg_catalog.unnest(v_ids) WITH ORDINALITY AS element(id, ord);

  -- The last row of the page in DISPLAY ORDER is the cursor anchor. It is read
  -- unconditionally now: `app._next_cursor` decides whether a next page exists
  -- by looking past that row, so the anchor has to exist before the question
  -- can be asked.
  IF pg_catalog.array_length(v_ids, 1) IS NOT NULL THEN
    EXECUTE pg_catalog.format('SELECT %I, id FROM core.proposals WHERE tenant_id = $1 AND id = $2', v_sort_col)
      INTO v_last_at, v_last_id USING v_tenant, v_ids[pg_catalog.array_length(v_ids,1)];
  END IF;
  v_next := app._next_cursor('core.proposals'::regclass, v_tenant, v_where,
                             v_sort_col, v_desc, v_count, v_size, v_last_at, v_last_id);

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'data', v_rows,
    'page', pg_catalog.jsonb_build_object('next', v_next, 'total', v_total),
    'appliedFilters', v_applied));
END;
$fn$;

CREATE OR REPLACE FUNCTION core.get_rate_card()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
  v_card   core.rate_cards%ROWTYPE;
BEGIN
  -- The ACTIVE card for today. `validity` is 007's daterange, so "the card in
  -- force" is a containment test rather than an ordering trick — a card that
  -- expired yesterday must not price anything today.
  SELECT card.* INTO v_card FROM core.rate_cards AS card
   WHERE card.tenant_id = v_tenant
     AND card.status = 'ACTIVE'
     AND card.validity @> CURRENT_DATE
   ORDER BY card.effective_from DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('reason','NO_ACTIVE_RATE_CARD'));
  END IF;

  RETURN app.ok(pg_catalog.jsonb_build_object(
    -- §18: until Finance supplies values the API returns `v0-placeholder` and
    -- clients render the placeholder label, so nobody quotes from it. The
    -- version is READ, never defaulted, so a real card can never be mistaken
    -- for a placeholder or the reverse.
    'version',       v_card.version,
    'effectiveFrom', v_card.effective_from,
    'effectiveTo',   v_card.effective_to,
    'currency',      v_card.currency::text,
    'trainerDayRate', COALESCE((
      SELECT pg_catalog.jsonb_agg(band.row ORDER BY band.band)
        FROM (
          SELECT day.band::text AS band,
                 pg_catalog.jsonb_build_object(
                   'band', day.band::text,
                   'rate', app._money(day.day_rate_sen, v_card.currency::text))
                 -- A per-trainer override is OPTIONAL and is emitted only when
                 -- one exists: an empty override array reads as "checked, none"
                 -- which is a different claim from "not overridden".
                 || CASE WHEN EXISTS (
                      SELECT 1 FROM core.rate_card_trainer_days AS ovr
                       WHERE ovr.tenant_id = v_tenant AND ovr.rate_card_id = v_card.id
                         AND ovr.band = day.band AND ovr.trainer_id IS NOT NULL)
                    THEN pg_catalog.jsonb_build_object('override', (
                      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                               'trainerRef', trainer.ref,
                               'rate', app._money(ovr.day_rate_sen, v_card.currency::text))
                             ORDER BY trainer.ref)
                        FROM core.rate_card_trainer_days AS ovr
                        JOIN core.trainers AS trainer
                          ON trainer.tenant_id = ovr.tenant_id AND trainer.id = ovr.trainer_id
                       WHERE ovr.tenant_id = v_tenant AND ovr.rate_card_id = v_card.id
                         AND ovr.band = day.band AND ovr.trainer_id IS NOT NULL))
                    ELSE '{}'::jsonb END AS row
            FROM core.rate_card_trainer_days AS day
           WHERE day.tenant_id = v_tenant AND day.rate_card_id = v_card.id
             AND day.trainer_id IS NULL
        ) AS band), '[]'::jsonb),
    'materialsPerPax', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'programmeType', material.programme_type,
               'rate', app._money(material.per_pax_sen, v_card.currency::text))
             ORDER BY material.programme_type)
        FROM core.rate_card_materials AS material
       WHERE material.tenant_id = v_tenant AND material.rate_card_id = v_card.id), '[]'::jsonb),
    'venue', COALESCE((
      SELECT pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object('mode', venue.mode::text)
               -- EXTERNAL is QUOTED, so it carries no fixed rate. The key is
               -- omitted rather than zeroed: a zero here would read as free.
               || CASE WHEN venue.day_rate_sen IS NULL THEN '{}'::jsonb
                       ELSE pg_catalog.jsonb_build_object('rate',
                              app._money(venue.day_rate_sen, v_card.currency::text)) END
             ORDER BY venue.mode)
        FROM core.rate_card_venues AS venue
       WHERE venue.tenant_id = v_tenant AND venue.rate_card_id = v_card.id), '[]'::jsonb),
    'travel', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'region', travel.region::text,
               'rate', app._money(travel.per_trip_sen, v_card.currency::text))
             ORDER BY travel.region)
        FROM core.rate_card_travel AS travel
       WHERE travel.tenant_id = v_tenant AND travel.rate_card_id = v_card.id), '[]'::jsonb),
    -- `mealsPerPax` is a SINGLE OBJECT in the contract, not an array, even
    -- though the table is keyed by programme type. The first row by programme
    -- type is the card's meal rate; a second would need a contract change.
    'mealsPerPax', COALESCE((
      SELECT pg_catalog.jsonb_build_object(
               'rate',       app._money(meal.per_pax_sen, v_card.currency::text),
               'acmCeiling', app._money(meal.acm_ceiling_sen, v_card.currency::text))
        FROM core.rate_card_meals AS meal
       WHERE meal.tenant_id = v_tenant AND meal.rate_card_id = v_card.id
       ORDER BY meal.programme_type
       LIMIT 1),
      pg_catalog.jsonb_build_object(
        'rate',       app._money(0, v_card.currency::text),
        'acmCeiling', app._money(0, v_card.currency::text))),
    'commissionPct', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'role', commission.role::text,
               -- `band` is an int8range in the column and a string in the
               -- contract. The range's own text form is the honest rendering:
               -- it carries the bounds AND their inclusivity.
               'band', commission.band::text,
               'pct',  commission.pct)
             ORDER BY commission.role, commission.band)
        FROM core.rate_card_commissions AS commission
       WHERE commission.tenant_id = v_tenant AND commission.rate_card_id = v_card.id), '[]'::jsonb),
    'marginFloorPct', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'programmeType', floor_row.programme_type,
               'pct',           floor_row.floor_pct)
             ORDER BY floor_row.programme_type)
        FROM core.rate_card_margin_floors AS floor_row
       WHERE floor_row.tenant_id = v_tenant AND floor_row.rate_card_id = v_card.id), '[]'::jsonb),
    'discountAuthority', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'role',   authority.role::text,
               'maxPct', authority.max_pct)
             ORDER BY authority.role)
        FROM core.rate_card_discount_authorities AS authority
       WHERE authority.tenant_id = v_tenant AND authority.rate_card_id = v_card.id), '[]'::jsonb)));
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

CREATE OR REPLACE FUNCTION core.add_proposal_section(
  p_id              text,
  p_body            jsonb,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant   uuid := app.require_tenant_id();
  v_actor    record;
  v_proposal core.proposals%ROWTYPE;
  v_title    text;
  v_n        smallint;
  v_hash     text;
  v_key      app.idempotency_keys%ROWTYPE;
BEGIN
  SELECT actor.* INTO v_actor FROM app.current_actor() AS actor;
  IF v_actor.role IS NULL THEN
    RAISE EXCEPTION 'requester has no app_role'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','FORBIDDEN')::text;
  END IF;

  p_body  := COALESCE(p_body, '{}'::jsonb);
  v_title := pg_catalog.btrim(COALESCE(p_body ->> 'title',''));
  IF v_title = '' THEN
    RAISE EXCEPTION 'a section needs a title'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','VALIDATION_FAILED','fields', pg_catalog.jsonb_build_array(
                pg_catalog.jsonb_build_object('field','title','reason','REQUIRED')))::text;
  END IF;

  IF NULLIF(p_idempotency_key,'') IS NULL THEN
    RAISE EXCEPTION 'an idempotency key is required for this write'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','VALIDATION_FAILED','fields', pg_catalog.jsonb_build_array(
                pg_catalog.jsonb_build_object(
                  'field','idempotencyKey','reason','REQUIRED')))::text;
  END IF;

  SELECT proposal.* INTO v_proposal FROM core.proposals AS proposal
   WHERE proposal.tenant_id = v_tenant
     AND (proposal.id::text = p_id OR proposal.ref = p_id)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such proposal'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','NOT_FOUND')::text;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(v_tenant::text || ':' || v_actor.actor_id || ':' || p_idempotency_key)::bigint);
  v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
              pg_catalog.jsonb_build_object('id', v_proposal.id::text, 'body', p_body)::text,'UTF8')),'hex');

  INSERT INTO app.idempotency_keys (tenant_id, actor_id, endpoint, key, request_hash)
  VALUES (v_tenant, v_actor.actor_id, 'POST /v1/proposals/sections', p_idempotency_key, v_hash)
  ON CONFLICT (tenant_id, actor_id, endpoint, key) DO NOTHING
  RETURNING * INTO v_key;

  IF v_key.id IS NULL THEN
    SELECT existing.* INTO v_key FROM app.idempotency_keys AS existing
     WHERE existing.tenant_id = v_tenant AND existing.actor_id = v_actor.actor_id
       AND existing.endpoint = 'POST /v1/proposals/sections' AND existing.key = p_idempotency_key;
    IF v_key.request_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'idempotency key reused with a different body'
        USING ERRCODE = 'TRNOS',
              DETAIL = pg_catalog.jsonb_build_object('code','IDEMPOTENT_REPLAY')::text;
    END IF;
    -- Same key, same body: the section was already added. Return the proposal
    -- as it stands rather than adding a second identical section, which is the
    -- double-click this key exists to absorb.
    PERFORM pg_catalog.set_config('response.headers','[{"Idempotent-Replay":"true"}]', true);
    RETURN core.get_proposal(v_proposal.id::text);
  END IF;

  -- `n` IS max(n) + 1, NOT count + 1. A proposal whose section 2 was deleted
  -- has three sections numbered 1, 3, 4; count + 1 would hand the new section
  -- the number 4 and collide with the existing one. The fixtures oracle does
  -- the same, and the unique constraint would have caught it eventually — on
  -- somebody's screen rather than here.
  SELECT COALESCE(pg_catalog.max(section.n), 0)::smallint + 1 INTO v_n
    FROM core.proposal_sections AS section
   WHERE section.tenant_id = v_tenant AND section.proposal_id = v_proposal.id;

  -- NO PROVENANCE ROW IS WRITTEN. A section a human typed is human-authored,
  -- and absence is how that is said — inserting one here would badge every
  -- hand-written section as AI-touched.
  INSERT INTO core.proposal_sections
    (tenant_id, proposal_id, n, title, body, needs_review,
     created_by_kind, created_by_id, created_by_name)
  VALUES (v_tenant, v_proposal.id, v_n, v_title, p_body ->> 'body', false,
          COALESCE(v_actor.actor_kind,'HUMAN')::app.actor_kind, v_actor.actor_id, NULL);

  UPDATE core.proposals AS proposal SET updated_at = pg_catalog.now()
   WHERE proposal.tenant_id = v_tenant AND proposal.id = v_proposal.id;

  UPDATE app.idempotency_keys
     SET state = 'COMPLETED',
         response = pg_catalog.jsonb_build_object(
           'status','EXECUTED','entity','proposal_section',
           'id', v_proposal.id::text, 'n', v_n),
         status_code = 201, completed_at = pg_catalog.now(),
         expires_at = pg_catalog.now() + interval '24 hours'
   WHERE id = v_key.id;

  RETURN core.get_proposal(v_proposal.id::text);
END;
$fn$;

CREATE OR REPLACE FUNCTION core.put_proposal_section(
  p_id              text,
  p_n               integer,
  p_body            jsonb,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant   uuid := app.require_tenant_id();
  v_actor    record;
  v_proposal core.proposals%ROWTYPE;
  v_section  core.proposal_sections%ROWTYPE;
  v_name     text;
BEGIN
  SELECT actor.* INTO v_actor FROM app.current_actor() AS actor;
  IF v_actor.role IS NULL THEN
    RAISE EXCEPTION 'requester has no app_role'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','FORBIDDEN')::text;
  END IF;

  p_body := COALESCE(p_body, '{}'::jsonb);
  -- `body` is REQUIRED and `title` is optional — that is the contract's
  -- `ProposalSectionWrite`, and it is the opposite way round from add.
  IF NOT (p_body ? 'body') THEN
    RAISE EXCEPTION 'a section edit needs a body'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','VALIDATION_FAILED','fields', pg_catalog.jsonb_build_array(
                pg_catalog.jsonb_build_object('field','body','reason','REQUIRED')))::text;
  END IF;

  SELECT proposal.* INTO v_proposal FROM core.proposals AS proposal
   WHERE proposal.tenant_id = v_tenant
     AND (proposal.id::text = p_id OR proposal.ref = p_id)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such proposal'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','NOT_FOUND')::text;
  END IF;

  SELECT section.* INTO v_section FROM core.proposal_sections AS section
   WHERE section.tenant_id = v_tenant
     AND section.proposal_id = v_proposal.id
     AND section.n = p_n::smallint;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such section on this proposal'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','NOT_FOUND','reason','UNKNOWN_SECTION','n', p_n)::text;
  END IF;

  UPDATE core.proposal_sections AS section
     SET body  = p_body ->> 'body',
         -- An EMPTY title is ignored rather than written: a blank heading is
         -- never what an editor meant, and the fixtures oracle agrees.
         title = COALESCE(NULLIF(pg_catalog.btrim(COALESCE(p_body ->> 'title','')),''), section.title)
   WHERE section.tenant_id = v_tenant AND section.id = v_section.id;

  SELECT profile.display_name INTO v_name FROM public.user_profiles AS profile
   WHERE profile.tenant_id = v_tenant AND profile.user_id::text = v_actor.actor_id;

  -- A HUMAN EDIT OF AN AI SECTION KEEPS THE AI LINEAGE AND RECORDS THE EDITOR:
  -- origin flips to AI_SUGGESTED and `editedBy` is stamped. A section with no
  -- provenance row was human-authored to begin with and gains none.
  -- Same rule as the enquiry patch: the editor is stamped, `origin` is left
  -- alone because it is immutable AND because it is a fact about where the
  -- section came from, and the badge value is derived in `app._provenance`.
  UPDATE core.provenance AS prov
     SET edited_by      = CASE WHEN v_actor.actor_kind = 'HUMAN'
                               THEN v_actor.actor_id::uuid ELSE prov.edited_by END,
         edited_by_name = COALESCE(v_name, v_actor.actor_id),
         edited_at      = pg_catalog.now()
   WHERE prov.tenant_id = v_tenant
     AND prov.subject_table = 'proposal_sections'
     AND prov.subject_id = v_section.id;

  UPDATE core.proposals AS proposal SET updated_at = pg_catalog.now()
   WHERE proposal.tenant_id = v_tenant AND proposal.id = v_proposal.id;

  RETURN core.get_proposal(v_proposal.id::text);
END;
$fn$;

CREATE OR REPLACE FUNCTION core.regenerate_proposal_section(p_id text, p_n integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant   uuid := app.require_tenant_id();
  v_proposal core.proposals%ROWTYPE;
  v_section  core.proposal_sections%ROWTYPE;
  v_run      core.runs%ROWTYPE;
  v_event    uuid;
  v_actor    record;
  v_profile_name text;
  v_jobs     integer;
BEGIN
  SELECT actor.* INTO v_actor FROM app.current_actor() AS actor;
  SELECT profile.display_name INTO v_profile_name
    FROM public.user_profiles AS profile
   WHERE profile.tenant_id = v_tenant
     AND profile.user_id::text = v_actor.actor_id;

  -- THIS IS A WRITE FUNCTION, SO IT REFUSES WITH `RAISE ... TRNOS`, NOT
  -- `app.err`. `app.err` COMMITS. Before this change every refusal here
  -- returned an `app.err` envelope, and the header's own rule (§"HOW A REFUSAL
  -- TRAVELS") puts write functions on RAISE precisely so that nobody has to
  -- re-verify by hand, for each new branch, that no write precedes it. That
  -- verification is now load-bearing rather than incidental: this function
  -- enqueues a job, and a refusal after the enqueue that COMMITTED would leave
  -- a worker holding work for a request the server said no to.
  --
  -- NO IDEMPOTENCY KEY, DELIBERATELY. A second press of "Regenerate" must
  -- produce a NEW draft, not replay the one the author just rejected. The
  -- client sends no key for this endpoint for exactly that reason.
  SELECT proposal.* INTO v_proposal FROM core.proposals AS proposal
   WHERE proposal.tenant_id = v_tenant
     AND (proposal.id::text = p_id OR proposal.ref = p_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'proposal not found'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
                       'code','NOT_FOUND', 'id', p_id)::text;
  END IF;

  SELECT section.* INTO v_section FROM core.proposal_sections AS section
   WHERE section.tenant_id = v_tenant
     AND section.proposal_id = v_proposal.id
     AND section.n = p_n::smallint;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'proposal section not found'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
                       'code','NOT_FOUND', 'id', p_id, 'n', p_n)::text;
  END IF;

  -- THE DRAFTING AGENT MUST BE REGISTERED. `core.runs` FKs
  -- `(tenant_id, agent_id)` to `core.agents`, so a tenant that has not
  -- registered `agent_proposal` would get a raw foreign-key violation. A tenant
  -- with no drafting agent is a configuration fact, not a server fault, and it
  -- is said as one.
  IF NOT EXISTS (SELECT 1 FROM core.agents AS agent
                  WHERE agent.tenant_id = v_tenant AND agent.agent_id = 'agent_proposal') THEN
    RAISE EXCEPTION 'no drafting agent registered'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
                       'code','VALIDATION_FAILED',
                       'reason','NO_DRAFTING_AGENT', 'agentId','agent_proposal')::text;
  END IF;

  -- An agent that is paused or killed must not be handed work. 013 owns both
  -- switches; this reads them rather than re-deciding what "paused" means.
  IF EXISTS (SELECT 1 FROM core.agents AS agent
              WHERE agent.tenant_id = v_tenant AND agent.agent_id = 'agent_proposal'
                AND (agent.kill_switch OR agent.paused_at IS NOT NULL
                     OR agent.status <> 'ACTIVE')) THEN
    RAISE EXCEPTION 'drafting agent is paused'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
                       'code','AGENT_PAUSED', 'agentId','agent_proposal')::text;
  END IF;

  -- THIS RPC DOES NOT CALL A MODEL AND MUST NOT. Ruling R-A puts every LLM call
  -- behind the worker, ruling R-B forbids `pg_net`, and a generation inside a
  -- request would blow the 10s statement timeout under load. What it does is
  -- ENQUEUE the work and hand back the run the worker will fill — the same
  -- split `core.get_tna_recommendations` relies on for reading worker-produced
  -- rows.
  --
  -- ⚠ THIS COMMENT USED TO SAY THAT AND THE CODE DID NOT DO IT. The function
  -- inserted a `RUNNING` run, flipped `needs_review`, and returned 200. No
  -- `app.perform_action`, no `app.emit_event`, no `app.enqueue_effect_jobs`, no
  -- outbox row, and no AFTER INSERT trigger on `core.runs` to make one. Nothing
  -- ever completed the run. Press Regenerate five times and the tenant held
  -- five orphan RUNNING runs and five unchanged sections. The enqueue below is
  -- the missing half; T33 asserts a job row exists after the call.
  --
  -- WHY `app.emit_event` AND NOT `app.perform_action`. 011's envelope gates
  -- ACTIONS against `app.action_types` and an autonomy policy, and its effect
  -- planner (`app.plan_effects`) emits effects only for the action types it
  -- knows. There is no action type for regenerating a proposal section and 018
  -- may not add one to 011's catalogue or teach 011's planner a new branch, so
  -- `perform_action` would refuse and `enqueue_effect_jobs` would enqueue zero.
  -- 012's event path is the one that fits and the one 012 designed for this:
  -- `app.emit_event` writes the event, its subject index rows and ONE JOB PER
  -- ENABLED SUBSCRIPTION in the caller's transaction, carries `p_run_id`
  -- (`app.outbox.run_id` and `outbox_run_idx` exist for exactly this), and
  -- 012's own comment on `app.event_subscriptions` says routing "is data, not
  -- code, so adding a side effect to an event is an insert rather than a
  -- deploy". 018 makes that insert in §10d rather than editing 012.
  --
  -- `runId` is REQUIRED on the response, so the run row is created here and the
  -- worker attaches to it. A response with an invented run id would point the
  -- run drawer at nothing.
  INSERT INTO core.runs
    (tenant_id, agent_id, trigger, mode, status, tiers_used, guardrails,
     started_at, correlation_id)
  VALUES (v_tenant, 'agent_proposal',
          -- 013's `runs_trigger_shape` CHECK requires a `type` string and,
          -- when present, a string-or-null `ref`. `mode` is LIVE | SANDBOX,
          -- not a description of the work — read off the constraint rather
          -- than guessed.
          pg_catalog.jsonb_build_object(
            'type','PROPOSAL_SECTION_REGENERATE',
            'ref',  v_proposal.ref,
            'sectionN', p_n),
          'LIVE', 'RUNNING', ARRAY[]::text[], ARRAY[]::text[],
          pg_catalog.now(), pg_catalog.gen_random_uuid())
  RETURNING * INTO v_run;

  -- The section is marked as awaiting the worker rather than rewritten here:
  -- until the run lands, the body on screen is still the one the author read.
  UPDATE core.proposal_sections AS section
     SET needs_review = true
   WHERE section.tenant_id = v_tenant AND section.id = v_section.id;

  SELECT section.* INTO v_section FROM core.proposal_sections AS section
   WHERE section.tenant_id = v_tenant AND section.id = v_section.id;

  -- THE ENQUEUE. Same transaction as the run and the flag: if this rolls back,
  -- neither the event nor its jobs exist, so there is no window in which a
  -- worker is holding work for a regeneration that did not happen.
  v_event := app.emit_event(
    p_tenant_id      => v_tenant,
    p_type           => 'PROPOSAL_SECTION_REGENERATE_REQUESTED',
    -- UPPER_SNAKE: `core.events.aggregate_type` CHECKs `^[A-Z][A-Z0-9_]*$`
    -- (012:490), and `app.aggregate_type_for` writes the same spelling.
    p_aggregate_type => 'PROPOSAL',
    p_aggregate_id   => v_proposal.id,
    p_aggregate_ref  => v_proposal.ref,
    p_payload        => pg_catalog.jsonb_build_object(
                          'proposalId', v_proposal.id::text,
                          'proposalRef', v_proposal.ref,
                          'sectionN',   p_n,
                          'sectionId',  v_section.id::text,
                          'agentId',    'agent_proposal'),
    p_summary        => pg_catalog.format('Section %s of %s queued for regeneration',
                                          p_n, v_proposal.ref),
    -- `app.is_valid_actor` (012:328) requires the `name` KEY to be PRESENT and
    -- string-or-null — absent and null are different bugs and only one is a
    -- shape error — so this is built explicitly rather than through
    -- `app._actor`, which OMITS the key when the name is unknown.
    p_actor          => pg_catalog.jsonb_build_object(
                          'kind', COALESCE(v_actor.actor_kind, 'SYSTEM'),
                          'id',   COALESCE(v_actor.actor_id, 'system'),
                          'name', pg_catalog.to_jsonb(v_profile_name)),
    p_correlation_id => v_run.correlation_id,
    p_run_id         => v_run.id::text,
    p_related        => pg_catalog.jsonb_build_array(
                          pg_catalog.jsonb_build_object(
                            'type','PROPOSAL_SECTION', 'id', v_section.id)));

  -- AND THE JOB MUST ACTUALLY BE THERE. `app.emit_event` enqueues one job per
  -- ENABLED subscription and silently enqueues none when there are none — a
  -- disabled or deleted routing row would put this function straight back into
  -- the state it was just fixed out of, with a green 200 and nothing queued.
  -- Refusing is the honest answer: the run and the `needs_review` flag roll
  -- back with it, so a tenant never accumulates orphan RUNNING runs.
  SELECT pg_catalog.count(*)::integer INTO v_jobs
    FROM app.outbox AS job
   WHERE job.tenant_id = v_tenant AND job.event_id = v_event;
  IF v_jobs < 1 THEN
    RAISE EXCEPTION 'no job was enqueued for run %', v_run.id
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
                       'code','SERVER_ERROR',
                       'reason','REGENERATE_NOT_ROUTED',
                       'eventType','PROPOSAL_SECTION_REGENERATE_REQUESTED')::text;
  END IF;

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'section',
      pg_catalog.jsonb_build_object('n', v_section.n, 'title', v_section.title)
      || CASE WHEN v_section.body IS NULL THEN '{}'::jsonb
              ELSE pg_catalog.jsonb_build_object('body', v_section.body) END
      || CASE WHEN v_section.merge_fields_used IS NULL THEN '{}'::jsonb
              ELSE pg_catalog.jsonb_build_object('mergeFieldsUsed',
                     pg_catalog.to_jsonb(v_section.merge_fields_used)) END
      || pg_catalog.jsonb_build_object('needsReview', v_section.needs_review)
      || CASE WHEN app._provenance('proposal_sections', v_section.id, NULL) IS NULL
              THEN '{}'::jsonb
              ELSE pg_catalog.jsonb_build_object('provenance',
                     app._provenance('proposal_sections', v_section.id, NULL)) END,
    'runId', v_run.id::text));
END;
$fn$;

CREATE OR REPLACE FUNCTION core.list_quotations(
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
  -- THIS IS AN RPC AND NOT A VIEW READ, AND THAT IS THE POINT. Under RLS a
  -- reader without the row would get an EMPTY LIST from a view — indis-
  -- tinguishable from "there are no quotations" — whereas the permission check
  -- below answers FORBIDDEN and says which role is missing. A price list is
  -- exactly the collection where "you may not see this" and "there is nothing
  -- here" must not look the same.
  IF NOT app.has_permission('quotation:read') THEN
    RETURN app.err('FORBIDDEN', pg_catalog.jsonb_build_object(
      'requiredPermission','quotation:read'));
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

  -- SAVED VIEW. This parameter was DECLARED AND NEVER READ: a reader who asked
  -- for a saved view got every row in the tenant with `appliedFilters: []` and
  -- `success: true`. `core.saved_view_object` has no value for this list's
  -- object, so a view for it cannot exist and the only honest answers are
  -- "refuse" or "resolve it once the enum has the value". `app._view_filters`
  -- gives both: it refuses off the enum today and resolves the day the
  -- contract adds the value, with no edit here.
  BEGIN
    v_merged := app._view_filters(v_tenant, p_view, 'QUOTATION', p_filter);
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
      FROM (VALUES ('status','status','text'),('proposal','proposal_id','uuid'),
                   ('sellPrice','sell_price_sen','number'),('belowFloor','below_floor','bool'),
                   ('createdAt','created_at','ts'),('version','version','number'))
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
      FROM (VALUES ('createdAt','created_at'),('updatedAt','updated_at'),
                   ('sellPrice','sell_price_sen'),('version','version'))
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

  -- COUNT BEFORE KEYSET, CURSOR FROM A REAL LOOKAHEAD — both orderings now
  -- live in `app._keyset_scope` / `app._next_cursor` (§1), so no copy of this
  -- engine can get either one wrong on its own. See the helpers' header for
  -- the two defects this pair replaces.
  SELECT scope.o_total, scope.o_where INTO v_total, v_keyed
    FROM app._keyset_scope('core.quotations'::regclass, v_tenant, v_where,
                           v_sort_col, v_desc, v_cur_at, v_cur_id) AS scope;

  -- Each row is projected by `core.get_quotation`, so the R6 floor block and
  -- the PROGRAMME→ABSOLUTE basis mapping exist in ONE place. A list that built
  -- its own money projection would be the second money implementation this
  -- pack exists to avoid.
  EXECUTE pg_catalog.format($q$
    SELECT COALESCE(pg_catalog.array_agg(q.id ORDER BY q.%I %s, q.id %s), ARRAY[]::uuid[])
      FROM (SELECT id, %I FROM core.quotations
             WHERE tenant_id = $1 AND %s
             ORDER BY %I %s, id %s
             LIMIT $2) AS q$q$,
    v_sort_col, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END,
    v_sort_col, v_keyed,
    v_sort_col, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END)
    INTO v_ids USING v_tenant, v_size;

  SELECT COALESCE(pg_catalog.jsonb_agg(core.get_quotation(element.id::text) -> 'data'
                                       ORDER BY element.ord), '[]'::jsonb),
         pg_catalog.count(*)::integer
    INTO v_rows, v_count
    FROM pg_catalog.unnest(v_ids) WITH ORDINALITY AS element(id, ord);

  -- The last row of the page in DISPLAY ORDER is the cursor anchor. It is read
  -- unconditionally now: `app._next_cursor` decides whether a next page exists
  -- by looking past that row, so the anchor has to exist before the question
  -- can be asked.
  IF pg_catalog.array_length(v_ids, 1) IS NOT NULL THEN
    EXECUTE pg_catalog.format('SELECT %I, id FROM core.quotations WHERE tenant_id = $1 AND id = $2', v_sort_col)
      INTO v_last_at, v_last_id USING v_tenant, v_ids[pg_catalog.array_length(v_ids,1)];
  END IF;
  v_next := app._next_cursor('core.quotations'::regclass, v_tenant, v_where,
                             v_sort_col, v_desc, v_count, v_size, v_last_at, v_last_id);

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'data', v_rows,
    'page', pg_catalog.jsonb_build_object('next', v_next, 'total', v_total),
    'appliedFilters', v_applied));
END;
$fn$;

-- ═══ 10c · The two views 014 could not grant ═══════════════════════════════
--
-- 014 §4 registered a CARRIED DEFECT and named this pack as its owner:
--
--   "`core.budget_status` is `security_invoker=true` and reads
--    `app.usage_rollup` … So the view is unreadable by a client no matter what
--    is granted ON THE VIEW, and `core.model_tier_status` inherits the problem
--    because it reads `budget_status`. … read both views from a
--    `SECURITY DEFINER` RPC in `core` … so 018 is where this lands."
--
-- It then REVOKED both rather than leaving "two grants that look like access
-- and deliver a permission error".
--
-- ⚠ 018 TAKES THE DEFECT BUT NOT THE PRESCRIBED SHAPE, and the reason is a
-- measurement rather than a preference. 014 proposed an RPC. There is no RPC
-- NAME for either of these on any branch: `RPC_NAMES` in `rpcClient.ts` does
-- not contain one on `main` or on `cloud/web-swap`, and the client reads both
-- through `VIEW_READS` — `.from("v_budgets")` and `.from("v_model_tiers")`.
-- An RPC would therefore be a function with zero call sites, which is the
-- dead-RPC finding of the §7 contract check, while the screen stayed broken.
--
-- So the fix is a VIEW WITH THE NAME THE CLIENT ACTUALLY READS, whose body
-- goes through a `SECURITY DEFINER` function. That is 014's mechanism — a
-- definer reaches `app.usage_rollup`, the caller never does — wearing the name
-- the caller already asks for. `security_invoker = true` stays ON THE VIEW so
-- the TENANT predicate is still evaluated as the caller; the definer function
-- exists only to cross the `app` schema boundary, and it re-derives the tenant
-- from `app.require_tenant_id()` rather than trusting an argument.
--
-- NOTE FOR THE §8 VIEW PACK: these are the SECOND and THIRD `core.v_*` views
-- 018 ships, after `v_organisation_relations`. The remaining thirteen are
-- still that pack's. Three of sixteen is not a design; it is two specs and a
-- carried defect that each named this migration. Said out loud so the next
-- reader does not have to infer it.

CREATE OR REPLACE FUNCTION app._budget_rows()
RETURNS TABLE (scope text, key text, cap_sen bigint, currency text,
               spend_sen bigint, state text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  -- SECURITY DEFINER for one reason: `core.budget_status` reads
  -- `app.usage_rollup`, and `authenticated` holds nothing in `app`. The tenant
  -- is re-derived here, never passed in, so this cannot be aimed at another
  -- tenant by a caller who finds it.
  SELECT b.scope, b.key, b.cap_sen, b.currency::text, b.spend_sen, b.state
    FROM core.budget_status AS b
   WHERE b.tenant_id = app.require_tenant_id();
$fn$;

CREATE OR REPLACE FUNCTION app._model_tier_rows()
RETURNS SETOF core.model_tier_status
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT t.* FROM core.model_tier_status AS t
   WHERE t.tenant_id = app.require_tenant_id();
$fn$;

REVOKE ALL ON FUNCTION app._budget_rows()     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app._model_tier_rows() FROM PUBLIC, anon, authenticated;

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

REVOKE ALL ON core.v_budgets      FROM PUBLIC, anon;
REVOKE ALL ON core.v_model_tiers  FROM PUBLIC, anon;
GRANT SELECT ON core.v_budgets     TO authenticated;
GRANT SELECT ON core.v_model_tiers TO authenticated;

COMMENT ON VIEW core.v_budgets IS
  'Closes 014 §4''s carried defect. core.budget_status is security_invoker and '
  'reads app.usage_rollup, which authenticated cannot reach, so it is '
  'unreadable no matter what is granted on it. This view carries the name '
  'rpcClient.ts actually reads (VIEW_READS.aiBudgets) and crosses the app '
  'boundary through a definer function that re-derives the tenant itself. 018.';

-- ═══ 10d · Per-tenant pipeline defaults ════════════════════════════════════
--
-- 016 deferred this and named the owner: "Seeding them here means writing
-- fifteen stage names into a migration, which is the exact defect the rule
-- names, and doing it in a file about ref formats. It belongs in a pack that
-- can cite `docs/architecture/01` §5.3 per row. **Owner: 018 or a dedicated
-- seed pack.** ⚠ Until then a new tenant renders no pipeline."
--
-- THE RULE 016 IS PROTECTING IS NOT "NEVER WRITE A STAGE NAME IN SQL" — it is
-- "stage names and order RENDER from `pipeline_steps` rows", and something has
-- to put the rows there. `core.pipelines` / `core.pipeline_steps` IS the
-- configuration; this seeds a tenant's DEFAULT configuration once, and every
-- reader still renders whatever the rows say. `core.navigation` and
-- `core.get_pipeline_config` read them, and T9 proves it by renaming a row and
-- asserting the output changed. A tenant that edits these rows is configuring
-- its pipeline, not fighting a hardcoded list.
--
-- ── THE IDS ARE DERIVED, AND THE EXPRESSION IS AGREED WITH THE SEEDS LANE ───
--
-- `core.engagement_step_states` carries a composite FK onto
-- `(tenant_id, pipeline_step_id)`, and the seeds lane (PR #16) writes 90 of
-- those rows for the fixture tenant. If that seed and this one computed
-- different ids for the same stage, one of the two loads fails on the foreign
-- key. So the ids are DERIVED from the tenant and the stage rather than picked,
-- and both packs compute the same expression:
--
--     pipeline row  md5(tenant_id::text || 'pipeline:' || object)::uuid
--     step row      md5(tenant_id::text || 'pipeline:' || object || ':' || step_key)::uuid
--
-- ⚠ TWO CORRECTIONS TO THE RULE AS HANDED DOWN, both measured on a 001-017
-- shim rather than reasoned about, and both raised first by the seeds lane:
--
--  1. The rule said `uuid_generate_v5(tenant_id, …)` with an md5 fallback
--     "if uuid-ossp is not available". THE TWO FORMS PRODUCE DIFFERENT IDS, so
--     a conditional between them yields one set of ids on a shim and another on
--     the hosted project — the exact failure determinism exists to prevent.
--     Measured: `uuid_generate_v5` gives 77324845-…, `md5(…)::uuid` gives
--     9c3095f8-… for the same input. And uuid-ossp is AVAILABLE BUT NOT CREATED
--     by 001-017 (001 installs pgcrypto, citext, btree_gist, pg_trgm, pg_cron,
--     pg_net and vector — not uuid-ossp), so the v5 branch does not run at all
--     without a new `CREATE EXTENSION` that is 001's to make. md5 is therefore
--     the form, not the fallback.
--
--  2. The rule said `'pipeline:' || stage_key`. THAT COLLIDES. `WON` is a stage
--     of BOTH pipelines — ENGAGEMENT position 1 and OPPORTUNITY position 6 —
--     and `core.pipeline_steps` is unique on `(tenant_id, pipeline_id,
--     step_key)`, not on `step_key` alone, so both rows are legitimate and the
--     shared id is a primary-key violation on whichever insert runs second. The
--     name has to carry the pipeline object, and it does above.
--
-- Bare md5, NOT a v5 UUID: `md5(...)::uuid` sets no version or variant nibble,
-- and both sides have to agree byte for byte, so neither side may "tidy" it.
-- Verified against the seeds lane's 18 published literals: 18 of 18 match.
--
-- ── OWNERSHIP ───────────────────────────────────────────────────────────────
--
-- 018 owns the DEFAULTS FOR A NEW TENANT and inserts `ON CONFLICT (id) DO
-- NOTHING`, so the fixture seed's own rows survive whichever order the two run
-- in. The seeds lane owns the fixture tenant's rows. Because the ids agree,
-- the composite key `engagement_step_states` references is the same either way.
--
-- ── WHAT IS NOT SEEDED, AND WHY ─────────────────────────────────────────────
--
--   DEAL_CHAIN   The contract's third pipeline (ENQUIRY · TNA · PROPOSAL ·
--                APPROVAL · SENT · DELIVERY). `core.pipelines.object` admits
--                only ENGAGEMENT, OPPORTUNITY and PACKET, so NEITHER this pack
--                NOR the seeds lane can store it today. Recorded as a spec
--                defect in `docs/architecture/09` §"Divergences found by 018";
--                004 is not changed here.
--   outcome      Ruling R16's `PipelineStage.outcome` (WON / LOST) has no
--                column on `core.pipeline_steps`. `terminal` is stored and
--                `outcome` is omitted rather than guessed. Same divergence
--                section.
--   PACKET       004 admits it; no contract, document or fixture defines a
--                packet pipeline. Seeding one would be inventing configuration.

CREATE OR REPLACE FUNCTION app.seed_pipelines(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_rows integer := 0; v_steps integer := 0;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'seed_pipelines: p_tenant_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- `core.pipelines` carries `trg_pipelines_ref` -> `core.assign_ref('PIP')`,
  -- which RAISES if the tenant has no `PIP` row in `core.ref_formats`. 016
  -- seeds those from its own AFTER INSERT trigger, and per-row AFTER INSERT
  -- triggers fire in ALPHABETICAL ORDER BY TRIGGER NAME — so this pack's
  -- trigger is named to sort after `trg_tenants_seed_ref_formats`. Asserted
  -- here as well, because a name-ordering dependency that is only a comment is
  -- a dependency waiting to be renamed.
  IF NOT EXISTS (SELECT 1 FROM core.ref_formats AS format
                  WHERE format.tenant_id = p_tenant_id AND format.prefix = 'PIP') THEN
    RAISE EXCEPTION
      'seed_pipelines: tenant % has no PIP ref_format yet. 016 seeds it from '
      'trg_tenants_seed_ref_formats, and AFTER INSERT triggers fire in '
      'alphabetical order by name — this seed must sort after it.', p_tenant_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  INSERT INTO core.pipelines
    (id, tenant_id, object, name, is_default, version, status,
     created_by_kind, created_by_id)
  SELECT pg_catalog.md5(p_tenant_id::text || 'pipeline:' || spec.object)::uuid,
         p_tenant_id, spec.object, spec.name, true, 1, 'ACTIVE', 'SYSTEM', 'migration:018'
    FROM (VALUES
            -- Doc 01 §3.6: two lifecycles, two rows. The nine-step delivery
            -- lifecycle is API_CONTRACT.md's `GET /v1/engagements/{id}`
            -- example and the contract's ENGAGEMENT_STAGE_KEYS.
            ('ENGAGEMENT',  'Delivery lifecycle'),
            -- The seven opportunity stages are doc 01 §5.3's own
            -- `opportunities.stage` edge set and the contract's
            -- OPPORTUNITY_STAGES, in that order.
            ('OPPORTUNITY', 'Deal board')
          ) AS spec(object, name)
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  INSERT INTO core.pipeline_steps
    (id, tenant_id, pipeline_id, step_key, label, position, terminal, blocking_check_keys)
  SELECT pg_catalog.md5(p_tenant_id::text || 'pipeline:' || spec.object || ':' || spec.step_key)::uuid,
         p_tenant_id,
         pg_catalog.md5(p_tenant_id::text || 'pipeline:' || spec.object)::uuid,
         spec.step_key, spec.label, spec.position, spec.terminal,
         -- `blocking_check_keys` stays empty: §17 sets HRDC_CLAIM to BLOCKED
         -- from a FAILING CHECK RESULT, not from a named key list, and 017
         -- seeds the three check keys per tenant. Anything else here would be
         -- configuration with no citation behind it.
         ARRAY[]::text[]
    FROM (VALUES
            -- ENGAGEMENT — API_CONTRACT.md:549-553, contract ENGAGEMENT_STAGE_KEYS,
            -- doc 01 §5.3 per row (engagements.status, trainer_bookings.state,
            -- attendance_days.status, hrdc_packets.status, invoices.status).
            ('ENGAGEMENT','WON',              'Won',               1::smallint, false),
            ('ENGAGEMENT','TRAINER_CONFIRMED','Trainer confirmed', 2::smallint, false),
            ('ENGAGEMENT','SCHEDULED',        'Scheduled',         3::smallint, false),
            ('ENGAGEMENT','REGISTERED',       'Registered',        4::smallint, false),
            ('ENGAGEMENT','DELIVERED',        'Delivered',         5::smallint, false),
            ('ENGAGEMENT','ATTENDANCE_LOCKED','Attendance locked', 6::smallint, false),
            ('ENGAGEMENT','HRDC_CLAIM',       'HRDC claim',        7::smallint, false),
            ('ENGAGEMENT','INVOICED',         'Invoiced',          8::smallint, false),
            ('ENGAGEMENT','PAID',             'Paid',              9::smallint, true),
            -- OPPORTUNITY — doc 01 §5.3 `opportunities.stage`, contract
            -- OPPORTUNITY_STAGES. WON and LOST are terminal and sit BESIDE each
            -- other, which is ruling R16's whole point: a screen that inferred
            -- an ending from the highest position would put LOST after WON.
            ('OPPORTUNITY','NEW',           'New',           1::smallint, false),
            ('OPPORTUNITY','QUALIFYING',    'Qualifying',    2::smallint, false),
            ('OPPORTUNITY','TNA_SENT',      'TNA sent',      3::smallint, false),
            ('OPPORTUNITY','PROPOSAL_SENT', 'Proposal sent', 4::smallint, false),
            ('OPPORTUNITY','NEGOTIATION',   'Negotiation',   5::smallint, false),
            ('OPPORTUNITY','WON',           'Won',           6::smallint, true),
            ('OPPORTUNITY','LOST',          'Lost',          7::smallint, true)
          ) AS spec(object, step_key, label, position, terminal)
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_steps = ROW_COUNT;

  RETURN v_rows + v_steps;
END;
$fn$;

CREATE OR REPLACE FUNCTION app.seed_pipelines_on_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  PERFORM app.seed_pipelines(NEW.id);
  RETURN NEW;
END;
$fn$;

-- NAME IS LOAD-BEARING. Per-row AFTER INSERT triggers fire in ALPHABETICAL
-- ORDER BY TRIGGER NAME, and this one must run after 016's
-- `trg_tenants_seed_ref_formats` or `core.assign_ref('PIP')` raises on every
-- tenant insert. `trg_tenants_z_seed_pipelines` sorts after it; the obvious
-- name, `trg_tenants_seed_pipelines`, sorts BEFORE it ('p' < 'r') and would
-- have failed on the first tenant anyone created. The `z` is not decoration.
--
-- This is the FOURTH provisioning trigger on `public.tenants` — action policies
-- (011), ref formats (016), check keys (017) and now pipelines. 017's header
-- set the precedent explicitly: a later pack adds its own beside the others
-- rather than editing theirs.
DROP TRIGGER IF EXISTS trg_tenants_z_seed_pipelines ON public.tenants;
CREATE TRIGGER trg_tenants_z_seed_pipelines
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION app.seed_pipelines_on_tenant();

REVOKE ALL ON FUNCTION app.seed_pipelines(uuid)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.seed_pipelines_on_tenant() FROM PUBLIC, anon, authenticated;

-- Backfill: every tenant that already exists gets the same defaults, in the
-- same shape 016 and 017 used for theirs. ON CONFLICT (id) DO NOTHING means a
-- tenant that already configured its own pipelines keeps them.
--
-- ⚠ IT USED TO SWALLOW A FOREIGN KEY VIOLATION INTO A `RAISE WARNING` AND
-- REPORT SUCCESS. A tenant predating 016's ref-format backfill was skipped and
-- the migration finished green. Because `core.navigation` and
-- `core.get_pipeline_config` render stages from `core.pipeline_steps`, that
-- tenant's navigation then came back with an EMPTY STAGE LIST — a silent,
-- correct-looking empty rather than an error — and a WARNING in a migration
-- log is not a channel anyone reads afterwards. The whole point of seeding
-- from a migration is that afterwards the invariant holds.
--
-- It now collects the skipped tenants and RAISES ONCE with the list, so the
-- operator fixes the ref formats and re-runs rather than discovering it from a
-- customer. The loop still visits every tenant first: failing on the first one
-- would hide the other nine.
--
-- The loop lives in a FUNCTION rather than inline in the `DO` block so that the
-- pin can call it. An assertion about a `DO` block's behaviour cannot be
-- written; an assertion about `app.seed_pipelines_all()` can, and T35 writes
-- it. Raised to NOTICE here rather than at the verify block, because the
-- backfill's own count is the thing an operator needs to see while applying.
SET client_min_messages = notice;

CREATE OR REPLACE FUNCTION app.seed_pipelines_all()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_tenant  uuid;
  v_total   integer := 0;
  v_skipped uuid[] := ARRAY[]::uuid[];
BEGIN
  FOR v_tenant IN SELECT tenant.id FROM public.tenants AS tenant ORDER BY tenant.created_at
  LOOP
    BEGIN
      v_total := v_total + app.seed_pipelines(v_tenant);
    EXCEPTION WHEN foreign_key_violation THEN
      -- CAUGHT ONLY TO KEEP COUNTING, never to continue as if nothing happened.
      v_skipped := v_skipped || v_tenant;
    END;
  END LOOP;

  IF pg_catalog.array_length(v_skipped, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      'seed_pipelines_all: % tenant(s) have no PIP ref_format and were NOT seeded: %. '
      'Their navigation would render an empty stage list. Seed core.ref_formats '
      'for them (016) and re-run this migration.',
      pg_catalog.array_length(v_skipped, 1),
      pg_catalog.array_to_string(v_skipped, ', ')
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN v_total;
END;
$fn$;

REVOKE ALL ON FUNCTION app.seed_pipelines_all() FROM PUBLIC, anon, authenticated;

DO $backfill$
DECLARE v_total integer;
BEGIN
  v_total := app.seed_pipelines_all();
  RAISE NOTICE '018 backfill: % pipeline and step row(s) seeded across existing tenants.', v_total;
END
$backfill$;

-- ═══ 10d · One routing row, so the regenerate enqueue has somewhere to go ══
--
-- `app.event_subscriptions` (012:672) is 012's routing table and 012 SEEDS NO
-- ROWS on purpose: "seeding a routing table before the events it routes are
-- agreed is how a job type nobody implemented starts being enqueued." That
-- reasoning is what makes this row legitimate rather than an exception to it —
-- the event is emitted by a function in THIS file, and the job type is claimed
-- by the drafting worker `apps/worker` already runs for `core.runs`. Routing is
-- data (012's own words), so this is an INSERT, not an edit to 012.
--
-- `tenant_id IS NULL` means every tenant. `ON CONFLICT DO NOTHING` against
-- `event_subscriptions_key`, which is UNIQUE NULLS NOT DISTINCT precisely so a
-- second global row for the same pair cannot be accepted and enqueue the job
-- twice.
INSERT INTO app.event_subscriptions (event_type, job_type, tenant_id, priority, delay, note)
VALUES ('PROPOSAL_SECTION_REGENERATE_REQUESTED', 'AI_DRAFT_PROPOSAL_SECTION',
        NULL, 5, interval '0',
        'core.regenerate_proposal_section emits the event and app.emit_event '
        'turns this row into the job. Without it that RPC refuses with '
        'REGENERATE_NOT_ROUTED rather than returning 200 on nothing — which is '
        'what it did before this row existed.')
ON CONFLICT ON CONSTRAINT event_subscriptions_key DO NOTHING;

-- ═══ 11 · Grants ═══════════════════════════════════════════════════════════
--
-- REVOKE first, GRANT second, and `anon` named explicitly beside PUBLIC even
-- though `anon` holds no membership in PUBLIC's grants by default — `anon` is
-- HOSTILE BY DEFAULT (`supabase/CLAUDE.md` rule 5) and the file should say so
-- at the DDL rather than rely on a default staying put.
--
-- `authenticated` gets EXECUTE and nothing more. It is NECESSARY, NEVER
-- SUFFICIENT: every body re-derives the tenant from `app.require_tenant_id()`
-- and the role from `app.current_actor()`.
--
-- WHAT IS DELIBERATELY NOT GRANTED, because granting it would undo the split
-- these functions exist to preserve:
--   * `app.perform_action`, `app.decide_approval`, `app.bulk_decide` stay
--     `service_role`-only (011:3408-3415).
--   * `app.ok`, `app.err`, `app.require_tenant_id`, `app.current_actor` stay
--     revoked from `authenticated` (001 §6, 002:614-619).
--   * `core.v_approval_requests` stays revoked from `authenticated`
--     (011:1428). It carries every approval's diff and evidence regardless of
--     approver role.

DO $grants$
DECLARE v_signature text;
BEGIN
  FOR v_signature IN
    SELECT pg_catalog.format('%s(%s)', p.oid::regproc::text, pg_catalog.pg_get_function_identity_arguments(p.oid))
      FROM pg_catalog.pg_proc AS p
      JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
     WHERE n.nspname = 'core'
       AND p.proname IN (
         'me','navigation','badge_counts',
         'list_enquiries','get_enquiry','patch_enquiry_extraction',
         'list_follow_ups','get_follow_up_draft',
         'get_organisation','get_opportunity','get_contact',
         'get_tna','get_tna_recommendations',
         'create_proposal','list_proposals','get_proposal',
         'add_proposal_section','put_proposal_section','regenerate_proposal_section',
         'list_quotations','get_quotation','put_quotation','get_rate_card',
         'list_approvals','get_approval','get_audit',
         'get_policy','get_pipeline_config','get_programme','get_compliance_rule')
  LOOP
    EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_signature);
    EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_signature);
  END LOOP;
END
$grants$;

REVOKE ALL ON core.v_organisation_relations FROM PUBLIC, anon;
GRANT SELECT ON core.v_organisation_relations TO authenticated;

COMMENT ON VIEW core.v_organisation_relations IS
  'The §5 organisation relations panel, one row per organisation, keyed '
  'organisation_id. security_invoker=true is LOAD-BEARING: without it the view '
  'runs as its owner and returns every tenant''s rows. Read by rpcClient.ts as '
  '.from("v_organisation_relations").select("*").match({organisation_id}); an '
  'empty result is NOT_FOUND because the contract types this as a record.';

-- The three wrappers are COMMENTed by 014, which owns them. 018 does not
-- re-comment another pack's functions: a COMMENT is last-writer-wins, and two
-- packs describing one object is the same divergence as two packs defining it.

-- ═══ 12 · $verify$ — every pin doc 09 names, as an executed assertion ══════

-- Raised back to NOTICE so the closing line of this block is VISIBLE to whoever
-- runs the migration. A verify block whose success message nobody sees is a
-- verify block nobody knows ran.
SET client_min_messages = notice;

DO $verify$
DECLARE
  v_name      text;
  v_missing   text[] := ARRAY[]::text[];
  v_body      text;
  v_count     integer;
  -- THE THREE GATE WRAPPERS ARE NOT IN THIS LIST. 014 owns them; see §2.
  v_expected  text[] := ARRAY[
    'me','navigation','badge_counts',
    'list_enquiries','get_enquiry','patch_enquiry_extraction',
    'list_follow_ups','get_follow_up_draft',
    'get_organisation','get_opportunity','get_contact',
    'get_tna','get_tna_recommendations',
    'create_proposal','list_proposals','get_proposal',
    'add_proposal_section','put_proposal_section','regenerate_proposal_section',
    'list_quotations','get_quotation','put_quotation','get_rate_card',
    'list_approvals','get_approval','get_audit',
    'get_policy','get_pipeline_config','get_programme','get_compliance_rule'];
  v_wrappers  text[] := ARRAY['perform_action','decide_approval','bulk_decide_approvals'];
BEGIN
  -- V1 · All 23 functions exist, exactly once each. A SECOND OVERLOAD is the
  -- PGRST203 trap: `CREATE OR REPLACE FUNCTION` matches on the ARGUMENT LIST,
  -- so adding even a defaulted parameter creates a sibling rather than
  -- replacing, and two overloads differing only by a defaulted trailing
  -- argument make every short call ambiguous.
  FOREACH v_name IN ARRAY v_expected LOOP
    SELECT pg_catalog.count(*)::integer INTO v_count
      FROM pg_catalog.pg_proc AS p
      JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
     WHERE n.nspname = 'core' AND p.proname = v_name;
    IF v_count <> 1 THEN
      RAISE EXCEPTION '018 verify V1: core.% has % definitions, expected exactly 1', v_name, v_count;
    END IF;
  END LOOP;

  -- V2 · POSTURE, per function: SECURITY DEFINER and the EXACT stored
  -- search_path string. `search_path=""` is what PostgreSQL stores for
  -- `SET search_path = ''`, measured off pg_proc rather than read off the DDL.
  -- Never `proconfig IS NOT NULL`: that passes the broken single-quoted-comma
  -- form `SET search_path = 'a, b'`, which names ONE schema whose name
  -- contains a comma and is not a path at all.
  SELECT pg_catalog.array_agg(p.proname ORDER BY p.proname) INTO v_missing
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'core' AND p.proname = ANY (v_expected)
     AND NOT (p.prosecdef AND p.proconfig @> ARRAY['search_path=""']);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '018 verify V2: not definer with search_path="": %',
      pg_catalog.array_to_string(v_missing, ', ');
  END IF;

  -- V2b · The 10s statement timeout doc 09 §0 requires, also off proconfig.
  SELECT pg_catalog.array_agg(p.proname ORDER BY p.proname) INTO v_missing
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'core' AND p.proname = ANY (v_expected)
     AND NOT p.proconfig @> ARRAY['statement_timeout=10s'];
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '018 verify V2b: missing statement_timeout=10s: %',
      pg_catalog.array_to_string(v_missing, ', ');
  END IF;

  -- V3 · GRANTS, measured with has_function_privilege rather than read off the
  -- DDL text. `authenticated` yes; `anon` and PUBLIC no.
  SELECT pg_catalog.array_agg(p.proname ORDER BY p.proname) INTO v_missing
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'core' AND p.proname = ANY (v_expected)
     AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE');
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '018 verify V3: authenticated cannot EXECUTE: %',
      pg_catalog.array_to_string(v_missing, ', ');
  END IF;

  SELECT pg_catalog.array_agg(p.proname ORDER BY p.proname) INTO v_missing
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'core' AND p.proname = ANY (v_expected)
     AND pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE');
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '018 verify V3b: anon holds EXECUTE on: %',
      pg_catalog.array_to_string(v_missing, ', ');
  END IF;

  -- V4 · THE SPLIT IS INTACT. Granting these to `authenticated` to make a
  -- function work is the exact failure the core/app split exists to prevent,
  -- so the pin refuses the shortcut rather than trusting a reviewer to spot it.
  IF pg_catalog.has_function_privilege('authenticated',
       'app.perform_action(text,text,jsonb,jsonb,numeric,text,jsonb,text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '018 verify V4: app.perform_action is granted to authenticated';
  END IF;
  IF pg_catalog.has_function_privilege('authenticated',
       'app.decide_approval(uuid,text,text,text,text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '018 verify V4b: app.decide_approval is granted to authenticated';
  END IF;
  IF pg_catalog.has_function_privilege('authenticated', 'app.ok(jsonb)'::regprocedure, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'app.err(text,jsonb)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '018 verify V4c: app.ok/app.err are granted to authenticated';
  END IF;
  IF pg_catalog.has_table_privilege('authenticated', 'core.v_approval_requests', 'SELECT') THEN
    RAISE EXCEPTION '018 verify V4d: core.v_approval_requests is granted to authenticated — '
                    'it carries every approval''s diff and evidence regardless of approver role';
  END IF;

  -- V5 · THE THREE WRAPPERS ARE 014'S, AND THERE IS EXACTLY ONE OF EACH.
  -- This is the pin that caught the collision that made 018 stop shipping them:
  -- `CREATE OR REPLACE FUNCTION` matches on the ARGUMENT LIST, so 014's
  -- five-argument `decide_approval` and 018's four-argument one became
  -- OVERLOADS rather than replacing each other, and two overloads differing
  -- only by a defaulted trailing argument make every short call ambiguous
  -- (PGRST203). Asserting "exactly one" is what turns that from a runtime
  -- surprise into a failed migration.
  FOREACH v_name IN ARRAY v_wrappers LOOP
    SELECT pg_catalog.count(*)::integer INTO v_count
      FROM pg_catalog.pg_proc AS p
      JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
     WHERE n.nspname = 'core' AND p.proname = v_name;
    IF v_count <> 1 THEN
      RAISE EXCEPTION '018 verify V5: core.% has % definitions, expected exactly 1 (014 owns it). '
                      'Two overloads differing only by a defaulted trailing argument make every '
                      'short call ambiguous.', v_name, v_count;
    END IF;
  END LOOP;

  -- V5b · 014's wrappers still carry the posture 018 depends on, and still
  -- reach `authenticated`. 018 stopped creating them; it did not stop caring
  -- whether they work.
  SELECT pg_catalog.array_agg(p.proname ORDER BY p.proname) INTO v_missing
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'core' AND p.proname = ANY (v_wrappers)
     AND NOT (p.prosecdef
              AND p.proconfig @> ARRAY['search_path=""']
              AND pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
              AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'));
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '018 verify V5b: 014''s wrapper(s) lost posture or grant: %',
      pg_catalog.array_to_string(v_missing, ', ');
  END IF;

  -- V6 · doc 09 §11's pin, applied to 014's function: `core.decide_approval`
  -- passes ALL FIVE arguments to `app.decide_approval`. A wrapper that dropped
  -- the hash silently disables the §7 diff guarantee AND STILL TYPECHECKS, so
  -- the assertion has to read the body rather than the signature.
  v_body := pg_catalog.regexp_replace(
    app._body_sql('core.decide_approval(uuid,text,text,text,text)'::regprocedure),
    '\s+','','g');
  IF pg_catalog.strpos(v_body,
       'app.decide_approval(p_approval_id,p_decision,p_note,p_expected_diff_hash,p_idempotency_key)') = 0 THEN
    RAISE EXCEPTION '018 verify V6: core.decide_approval does not pass all five arguments '
                    'to app.decide_approval';
  END IF;

  -- V7 · doc 09 §3's pin: `core.me()` emits a `permissions` key. A client that
  -- gets `me` without it silently falls back to showing everything.
  IF pg_catalog.strpos(app._body_sql('core.me()'::regprocedure),
                       '''permissions''') = 0 THEN
    RAISE EXCEPTION '018 verify V7: core.me does not emit a permissions key';
  END IF;

  -- V8 · doc 09 §4's pin: `core.navigation` reads `core.pipeline_steps`, so a
  -- later edit cannot inline a stage list. Same assertion for
  -- `core.get_pipeline_config`, which is the endpoint every LifecycleStepper
  -- in the product reads.
  IF pg_catalog.strpos(app._body_sql('core.navigation()'::regprocedure),
                       'core.pipeline_steps') = 0 THEN
    RAISE EXCEPTION '018 verify V8: core.navigation does not read core.pipeline_steps';
  END IF;
  IF pg_catalog.strpos(app._body_sql('core.get_pipeline_config(text)'::regprocedure),
                       'core.pipeline_steps') = 0 THEN
    RAISE EXCEPTION '018 verify V8b: core.get_pipeline_config does not read core.pipeline_steps';
  END IF;

  -- V9 · doc 09 §8's pin: the TNA recommendations endpoint NEVER generates on
  -- demand. No `net.http_post` (ruling R-B) and no reference to `core.runs`,
  -- so "generate on read" cannot be added later without tripping this.
  v_body := app._body_sql('core.get_tna_recommendations(text)'::regprocedure);
  IF pg_catalog.strpos(v_body, 'net.http_post') > 0 THEN
    RAISE EXCEPTION '018 verify V9: core.get_tna_recommendations calls net.http_post';
  END IF;
  IF pg_catalog.strpos(v_body, 'core.runs') > 0 THEN
    RAISE EXCEPTION '018 verify V9b: core.get_tna_recommendations reads core.runs — '
                    'that is the generate-on-read path the worker split exists to prevent';
  END IF;

  -- V9c · Ruling R-B across the WHOLE pack, not just the one function named by
  -- the spec: no function in 018 may reach the network.
  SELECT pg_catalog.array_agg(p.proname ORDER BY p.proname) INTO v_missing
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'core' AND p.proname = ANY (v_expected)
     AND app._body_sql(p.oid) LIKE '%net.http_%';
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '018 verify V9c: pg_net is called by: %',
      pg_catalog.array_to_string(v_missing, ', ');
  END IF;

  -- V10 · doc 09 §9's pin: `core.create_proposal` writes an
  -- `app.idempotency_keys` row, so the key can never become decorative.
  v_body := app._body_sql('core.create_proposal(jsonb,text)'::regprocedure);
  IF pg_catalog.strpos(v_body, 'INSERT INTO app.idempotency_keys') = 0 THEN
    RAISE EXCEPTION '018 verify V10: core.create_proposal does not write app.idempotency_keys';
  END IF;

  -- V11 · doc 09 §10's pin: every money projection routes through
  -- `app.round_half_up_sen` or reads a GENERATED column, and NO float cast
  -- appears. `float8`, `float4`, `real` and `double precision` are all named:
  -- a single `::float8` in a money path is how an invoice ends up one sen out,
  -- and `reconcileInvoice` rejects that later with TOTAL_NOT_RECONCILED.
  v_body := app._body_sql('core.put_quotation(text,jsonb,text)'::regprocedure);
  IF pg_catalog.strpos(v_body, 'app.round_half_up_sen') = 0 THEN
    RAISE EXCEPTION '018 verify V11: core.put_quotation does not route through app.round_half_up_sen';
  END IF;
  SELECT pg_catalog.array_agg(p.proname ORDER BY p.proname) INTO v_missing
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'core' AND p.proname = ANY (v_expected)
     AND app._body_sql(p.oid) ~* '(float8|float4|::real\M|double precision)';
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '018 verify V11b: a float cast appears in: %',
      pg_catalog.array_to_string(v_missing, ', ');
  END IF;

  -- V11c · THE FIVE LIST RPCs SHARE ONE KEYSET ENGINE, asserted off the stored
  -- bodies rather than claimed in a comment. Two copies of this engine
  -- disagreed about `page.total` and about `page.next`; the helpers make both
  -- orderings unavailable to a caller, and this check is what stops a sixth
  -- list — or an edit to one of the five — from quietly growing its own copy.
  v_missing := ARRAY[]::text[];
  FOREACH v_name IN ARRAY ARRAY['list_enquiries','list_approvals','list_follow_ups',
                                'list_proposals','list_quotations'] LOOP
    v_body := app._body_sql(
      (pg_catalog.format('core.%s(jsonb,text,jsonb,text)', v_name))::regprocedure);
    IF pg_catalog.strpos(v_body, 'app._keyset_scope') = 0
       OR pg_catalog.strpos(v_body, 'app._next_cursor') = 0 THEN
      v_missing := v_missing || v_name;
    END IF;
    -- The old arithmetic must be GONE, not merely joined by the helper.
    IF pg_catalog.strpos(v_body, 'v_count < v_total') > 0 THEN
      v_missing := v_missing || (v_name || ' (still decides next by count<total)');
    END IF;
  END LOOP;
  IF pg_catalog.array_length(v_missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION '018 verify V11c: list RPC(s) do not share the keyset engine: %',
      pg_catalog.array_to_string(v_missing, ', ');
  END IF;

  -- V12 · doc 09 §7's pin: every `core.v_*` view the client reads carries
  -- `security_invoker=true` and is not populated. Without it the view runs as
  -- its OWNER and returns every tenant's rows.
  SELECT pg_catalog.array_agg(c.relname ORDER BY c.relname) INTO v_missing
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
   WHERE n.nspname = 'core' AND c.relname LIKE 'v\_%' AND c.relkind = 'v'
     AND NOT (COALESCE(c.reloptions, ARRAY[]::text[]) @> ARRAY['security_invoker=true']);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '018 verify V12: core.v_* views without security_invoker=true: %',
      pg_catalog.array_to_string(v_missing, ', ');
  END IF;
  IF (SELECT c.relispopulated FROM pg_catalog.pg_class AS c
       JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'core' AND c.relname = 'v_organisation_relations') IS NOT TRUE THEN
    RAISE EXCEPTION '018 verify V12b: core.v_organisation_relations is not a readable view';
  END IF;
  IF NOT pg_catalog.has_table_privilege('authenticated', 'core.v_organisation_relations', 'SELECT') THEN
    RAISE EXCEPTION '018 verify V12c: authenticated cannot SELECT core.v_organisation_relations';
  END IF;
  IF pg_catalog.has_table_privilege('anon', 'core.v_organisation_relations', 'SELECT') THEN
    RAISE EXCEPTION '018 verify V12d: anon can SELECT core.v_organisation_relations';
  END IF;

  -- V16b · THE PIPELINE SEED TRIGGER EXISTS AND SORTS AFTER 016'S.
  -- Per-row AFTER INSERT triggers fire in ALPHABETICAL ORDER BY TRIGGER NAME.
  -- `core.pipelines` carries `trg_pipelines_ref` -> `core.assign_ref('PIP')`,
  -- which raises if the tenant has no PIP ref_format, and 016 seeds those from
  -- `trg_tenants_seed_ref_formats`. So this seed MUST sort after it. The name
  -- carries that dependency, and a rename would break every tenant insert —
  -- which is exactly the kind of thing a comment does not prevent.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS t
      JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'tenants'
       AND NOT t.tgisinternal AND t.tgname = 'trg_tenants_z_seed_pipelines') THEN
    RAISE EXCEPTION '018 verify V16b: the pipeline seed trigger is missing from public.tenants';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS t
      JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'tenants' AND NOT t.tgisinternal
       AND t.tgname = 'trg_tenants_seed_ref_formats'
       AND t.tgname > 'trg_tenants_z_seed_pipelines') THEN
    RAISE EXCEPTION '018 verify V16c: the pipeline seed trigger sorts BEFORE 016''s ref-format '
                    'seed, so core.assign_ref(''PIP'') will raise on every tenant insert';
  END IF;

  -- V13 · THE ENVELOPE. No function in this pack builds a success envelope by
  -- hand — that is `check:rpc` E1's whole subject, and the incident behind it
  -- was a third top-level key beside `data` flipping every client from
  -- auto-unwrap to pass-through on the session-restore path only.
  SELECT pg_catalog.array_agg(p.proname ORDER BY p.proname) INTO v_missing
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'core' AND p.proname = ANY (v_expected)
     AND app._body_sql(p.oid) ~ 'jsonb_build_object\s*\(\s*''success''';
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '018 verify V13: a hand-built success envelope appears in: %',
      pg_catalog.array_to_string(v_missing, ', ');
  END IF;

  -- V14 · NO TENANT ARGUMENT ANYWHERE. Tenant is implicit from auth; a
  -- `p_tenant_id` is a cross-tenant read waiting for a caller to pass the
  -- wrong value, and it would typecheck.
  SELECT pg_catalog.array_agg(p.proname ORDER BY p.proname) INTO v_missing
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'core' AND p.proname = ANY (v_expected)
     AND pg_catalog.pg_get_function_identity_arguments(p.oid) ILIKE '%tenant%';
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '018 verify V14: a tenant argument appears on: %',
      pg_catalog.array_to_string(v_missing, ', ');
  END IF;

  -- V15 · Every read function derives the tenant from app.require_tenant_id().
  SELECT pg_catalog.array_agg(p.proname ORDER BY p.proname) INTO v_missing
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'core' AND p.proname = ANY (v_expected)
     AND pg_catalog.strpos(app._body_sql(p.oid), 'app.require_tenant_id()') = 0;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '018 verify V15: does not call app.require_tenant_id(): %',
      pg_catalog.array_to_string(v_missing, ', ');
  END IF;

  -- V16 · The internal helpers are unreachable from a browser.
  SELECT pg_catalog.array_agg(p.proname ORDER BY p.proname) INTO v_missing
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'app' AND p.proname LIKE '\_%'
     AND (pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
          OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'));
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '018 verify V16: app._* helpers reachable by a client role: %',
      pg_catalog.array_to_string(v_missing, ', ');
  END IF;

  RAISE NOTICE '018 verify: 30 core RPCs + 3 views + 11 app helpers — all posture, '
               'grant, envelope, money, pipeline and spine pins PASS.';
END
$verify$;
