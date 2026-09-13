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
--   * WRITE functions (`create_proposal`, `put_quotation`) refuse with RAISE
--     TRNOS, so a refusal never leaves a partial write behind.
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
  SELECT prov.* INTO v_row
    FROM core.provenance AS prov
   WHERE prov.subject_table = p_subject_table
     AND prov.subject_id    = p_subject_id
     AND prov.field IS NOT DISTINCT FROM p_field
   ORDER BY prov.updated_at DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_out := pg_catalog.jsonb_build_object('origin', v_row.origin::text);

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

-- ═══ 2 · The three gate wrappers ═══════════════════════════════════════════
--
-- 011 grants `app.perform_action`, `app.decide_approval` and `app.bulk_decide`
-- to `service_role` ONLY (011:3408-3415). These wrappers are what makes them
-- reachable from a browser, and the underlying grants are NOT changed: `app`
-- is unexposed, so a `core` definer is the only door.
--
-- Three facts from 011 that shape them, all verified against the file:
--
--  * `app.perform_action` does NOT return an envelope. Its last statement is
--    `RETURN v_result`, a bare `{status, result|approvalRequest|draft}`, and
--    012's worker path returns the same value and does not want an envelope.
--    So `app.ok()` goes HERE and never in `app`.
--  * `POLICY_APPROVAL_REQUIRED` is already a SUCCESS.
--    `{"status":"QUEUED_FOR_APPROVAL","approvalRequest":{…}}` is the §1 table's
--    "202, not an error" row honoured in SQL. The wrapper must not reclassify
--    it, and does not look at it.
--  * 011 refuses by RAISE with `ERRCODE='TRNOS'`. The wrapper does not catch
--    it: the client's `classifyTransportFailure()` parses the detail bag, and
--    swallowing it here would turn a rollback into a commit.
--
-- Each body is ONE expression. The pins in §8 assert exactly that, so a later
-- edit cannot quietly inline a second policy evaluation beside the gate.

CREATE OR REPLACE FUNCTION core.perform_action(
  p_type            text,
  p_target_ref      text    DEFAULT NULL,
  p_payload         jsonb   DEFAULT '{}'::jsonb,
  p_requested_by    jsonb   DEFAULT NULL,
  p_confidence      numeric DEFAULT NULL,
  p_reasoning       text    DEFAULT NULL,
  p_evidence        jsonb   DEFAULT '[]'::jsonb,
  p_idempotency_key text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
  -- The argument list is `app.perform_action`'s, verbatim and in order, and
  -- `rpcClient.ts` sends exactly these names. Identical lists mean a rename on
  -- either side is a break a reader can see. No re-validation and no second
  -- tenant check: `app.perform_action` calls `app.require_tenant_id()` itself
  -- at 011:1979 and resolves the actor from `app.current_actor()`.
  SELECT app.ok(app.perform_action(p_type, p_target_ref, p_payload,
                                   p_requested_by, p_confidence, p_reasoning,
                                   p_evidence, p_idempotency_key));
$fn$;

CREATE OR REPLACE FUNCTION core.decide_approval(
  p_approval_id     uuid,
  p_decision        text,
  p_note            text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
  -- ALL FIVE ARGUMENTS. `p_expected_diff_hash` is passed explicitly as NULL
  -- rather than left to the default, because that argument IS the §7
  -- guarantee that `effects[]` matches the `diff[]` the approver actually
  -- read, and a wrapper that silently dropped it would still typecheck.
  -- Spelling it out is what makes wiring it a one-word change when the detail
  -- screen can carry the hash it rendered; until then a `409 diffChanged`
  -- cannot be detected and the §8 pin asserts the argument is still here.
  SELECT app.ok(app.decide_approval(p_approval_id, p_decision, p_note,
                                    NULL::text, p_idempotency_key));
$fn$;

CREATE OR REPLACE FUNCTION core.bulk_decide_approvals(
  p_ids             uuid[],
  p_decision        text,
  p_note            text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
  -- `app.bulk_decide` takes four arguments and has no diff-hash parameter;
  -- checked against 011, not assumed from its sibling.
  SELECT app.ok(app.bulk_decide(p_ids, p_decision, p_note, p_idempotency_key));
$fn$;

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
  v_view     core.saved_views%ROWTYPE;
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

  -- ── saved view ──────────────────────────────────────────────────────────
  -- A view contributes filters; REQUEST FILTERS WIN. `source` on each applied
  -- filter is what lets the UI show a reader WHY rows are missing — without it
  -- a saved view silently subtracts rows nobody asked it to.
  IF NULLIF(p_view, '') IS NOT NULL THEN
    SELECT saved.* INTO v_view FROM core.saved_views AS saved
     WHERE saved.tenant_id = v_tenant
       AND saved.deleted_at IS NULL
       AND (saved.id::text = p_view OR saved.ref = p_view);
    IF NOT FOUND THEN
      RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
        'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'field','view','reason','UNKNOWN_VIEW'))));
    END IF;
    SELECT COALESCE(pg_catalog.jsonb_agg(element.value || pg_catalog.jsonb_build_object('source','VIEW')), '[]'::jsonb)
      INTO v_merged
      FROM pg_catalog.jsonb_array_elements(COALESCE(v_view.filters, '[]'::jsonb)) AS element(value)
     WHERE NOT EXISTS (
       SELECT 1 FROM pg_catalog.jsonb_array_elements(COALESCE(p_filter,'[]'::jsonb)) AS req(value)
        WHERE req.value ->> 'field' = element.value ->> 'field');
  END IF;

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

  -- KEYSET, not offset. The tie-breaker is the id, so a page boundary that
  -- lands inside a group of equal sort keys does not drop or repeat a row.
  IF v_cur_at IS NOT NULL THEN
    v_where := v_where || pg_catalog.format(
      ' AND (%I, id) %s (%L::timestamptz, %L::uuid)',
      v_sort_col, CASE WHEN v_desc THEN '<' ELSE '>' END, v_cur_at, v_cur_id);
  END IF;

  EXECUTE pg_catalog.format(
    'SELECT pg_catalog.count(*)::integer FROM core.enquiries WHERE tenant_id = $1 AND %s',
    v_where) INTO v_total USING v_tenant;

  v_sql := pg_catalog.format($q$
    WITH page AS (
      SELECT * FROM core.enquiries
       WHERE tenant_id = $1 AND %s
       ORDER BY %I %s, id %s
       LIMIT $2
    )
    SELECT COALESCE(pg_catalog.jsonb_agg(row.item ORDER BY row.ord), '[]'::jsonb),
           pg_catalog.count(*)::integer,
           pg_catalog.max(row.sort_at),
           (pg_catalog.array_agg(row.id ORDER BY row.ord DESC))[1]
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
    v_where,
    v_sort_col, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END,
    v_sort_col, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END,
    v_sort_col);

  EXECUTE v_sql INTO v_rows, v_count, v_last_at, v_last_id USING v_tenant, v_size;

  -- `next` IS NULL ON THE LAST PAGE, NEVER ABSENT. The client's unwrap rule is
  -- sensitive to key sets and an omitted key changes the shape — this is the
  -- one doc 09 §5 says a test catches and a reviewer does not, so the pin
  -- asserts present-and-null explicitly.
  v_next := NULL;
  IF v_count = v_size AND v_count < v_total THEN
    v_next := app._cursor_encode(v_last_at, v_last_id);
  END IF;

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
     COALESCE(v_actor.actor_kind, 'HUMAN'), v_actor.actor_id, NULL)
  RETURNING * INTO v_proposal;

  -- Sections come from the template, in the template's own order. A proposal
  -- that invented its own section list would diverge from the template the
  -- moment either changed.
  INSERT INTO core.proposal_sections
    (tenant_id, proposal_id, n, title, body, needs_review,
     created_by_kind, created_by_id, created_by_name)
  SELECT v_tenant, v_proposal.id, section.n, section.title, section.default_body, false,
         COALESCE(v_actor.actor_kind, 'HUMAN'), v_actor.actor_id, NULL
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
  v_after    core.quotations%ROWTYPE;
  v_sell     bigint;
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

  -- 007's two assertions are DEFERRABLE INITIALLY DEFERRED, so without this
  -- they fire at COMMIT — outside this function, where the error can no longer
  -- be translated into a contract error code and reaches the client as a raw
  -- integrity violation. Forcing them IMMEDIATE is what makes
  -- FLOOR_PRICE_BREACH and TOTAL_NOT_RECONCILED catchable here.
  BEGIN
    SET CONSTRAINTS core.trg_quotation_reconciled, core.trg_quotation_floor IMMEDIATE;
  EXCEPTION WHEN integrity_constraint_violation THEN
    SELECT quotation.* INTO v_after FROM core.quotations AS quotation
     WHERE quotation.tenant_id = v_tenant AND quotation.id = v_row.id;

    IF v_after.below_floor AND v_after.discount_approval_id IS NULL THEN
      -- The full RULING R6 bag. `POLICY_APPROVAL_REQUIRED` is NOT raised here:
      -- a discount that needs approval goes through `DISCOUNT_APPROVE` on
      -- `core.perform_action`, which is the one endpoint that gates approvals.
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

    RAISE EXCEPTION 'quotation header does not equal the sum of its rounded lines'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','VALIDATION_FAILED','reason','TOTAL_NOT_RECONCILED')::text;
  END;

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
  v_view     core.saved_views%ROWTYPE;
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

  IF NULLIF(p_view, '') IS NOT NULL THEN
    SELECT saved.* INTO v_view FROM core.saved_views AS saved
     WHERE saved.tenant_id = v_tenant
       AND saved.deleted_at IS NULL
       AND (saved.id::text = p_view OR saved.ref = p_view);
    IF NOT FOUND THEN
      RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
        'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'field','view','reason','UNKNOWN_VIEW'))));
    END IF;
    SELECT COALESCE(pg_catalog.jsonb_agg(element.value), '[]'::jsonb) INTO v_merged
      FROM pg_catalog.jsonb_array_elements(COALESCE(v_view.filters, '[]'::jsonb)) AS element(value)
     WHERE NOT EXISTS (
       SELECT 1 FROM pg_catalog.jsonb_array_elements(COALESCE(p_filter,'[]'::jsonb)) AS req(value)
        WHERE req.value ->> 'field' = element.value ->> 'field');
  END IF;
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

  EXECUTE pg_catalog.format(
    'SELECT pg_catalog.count(*)::integer FROM core.v_approval_requests WHERE tenant_id = $1 AND %s',
    v_where) INTO v_total USING v_tenant;

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

  IF v_cur_at IS NOT NULL THEN
    v_where := v_where || pg_catalog.format(
      ' AND (%I, id) %s (%L::timestamptz, %L::uuid)',
      v_sort_col, CASE WHEN v_desc THEN '<' ELSE '>' END, v_cur_at, v_cur_id);
  END IF;

  EXECUTE pg_catalog.format($q$
    SELECT COALESCE(pg_catalog.jsonb_agg(row.item ORDER BY row.ord), '[]'::jsonb),
           pg_catalog.count(*)::integer,
           pg_catalog.max(row.sort_at),
           (pg_catalog.array_agg(row.id ORDER BY row.ord DESC))[1]
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
    v_sort_col, v_where,
    v_sort_col, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END, CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END)
    INTO v_rows, v_count, v_last_at, v_last_id USING v_tenant, v_size;

  v_next := NULL;
  IF v_count = v_size AND v_count < v_total THEN
    v_next := app._cursor_encode(v_last_at, v_last_id);
  END IF;

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
    || COALESCE((
         SELECT CASE WHEN verdict.jury IS NULL THEN '{}'::jsonb
                     ELSE pg_catalog.jsonb_build_object('modelAgreement', verdict.jury) END
           FROM core.provenance AS verdict
          WHERE verdict.subject_table = 'approval_requests'
            AND verdict.subject_id = v_row.id
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
         'perform_action','decide_approval','bulk_decide_approvals',
         'me','navigation','badge_counts',
         'list_enquiries','get_enquiry',
         'get_organisation','get_opportunity','get_contact',
         'get_tna','get_tna_recommendations',
         'create_proposal','get_proposal',
         'get_quotation','put_quotation',
         'list_approvals','get_approval',
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

COMMENT ON FUNCTION core.perform_action(text,text,jsonb,jsonb,numeric,text,jsonb,text) IS
  'The one endpoint every write in the app goes through. A ONE-EXPRESSION '
  'wrapper over app.perform_action: app.ok() around 011''s bare '
  '{status, result|approvalRequest|draft}. No re-validation and no second '
  'tenant check — 011:1979 calls app.require_tenant_id() itself. '
  'QUEUED_FOR_APPROVAL is a SUCCESS, not an error, and is not reclassified.';

COMMENT ON FUNCTION core.decide_approval(uuid,text,text,text) IS
  'Wraps app.decide_approval with ALL FIVE arguments. p_expected_diff_hash is '
  'passed explicitly as NULL because the detail screen cannot yet carry the '
  'hash it rendered; until it can, a 409 diffChanged cannot be detected. A '
  'wrapper that dropped the argument would still typecheck, so the $verify$ '
  'block asserts it is still there.';

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
  v_expected  text[] := ARRAY[
    'perform_action','decide_approval','bulk_decide_approvals',
    'me','navigation','badge_counts',
    'list_enquiries','get_enquiry',
    'get_organisation','get_opportunity','get_contact',
    'get_tna','get_tna_recommendations',
    'create_proposal','get_proposal',
    'get_quotation','put_quotation',
    'list_approvals','get_approval',
    'get_policy','get_pipeline_config','get_programme','get_compliance_rule'];
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

  -- V5 · doc 09 §2's pin, verbatim in intent: the wrapper CALLS the gate and
  -- does nothing else, so a later edit cannot quietly inline a second policy
  -- evaluation beside it.
  IF pg_catalog.strpos(
       pg_catalog.regexp_replace(
         app._body_sql(
           'core.perform_action(text,text,jsonb,jsonb,numeric,text,jsonb,text)'::regprocedure),
         '\s+','','g'),
       'app.ok(app.perform_action(') = 0 THEN
    RAISE EXCEPTION '018 verify V5: core.perform_action does not wrap app.perform_action';
  END IF;

  -- V6 · doc 09 §11's pin: `core.decide_approval` passes ALL FIVE arguments to
  -- `app.decide_approval`. A wrapper that dropped the hash argument silently
  -- disables the §7 diff guarantee and its signature would still typecheck.
  v_body := pg_catalog.regexp_replace(
    app._body_sql('core.decide_approval(uuid,text,text,text)'::regprocedure),
    '\s+','','g');
  IF pg_catalog.strpos(v_body,
       'app.ok(app.decide_approval(p_approval_id,p_decision,p_note,NULL::text,p_idempotency_key))') = 0 THEN
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
     AND p.proname NOT IN ('perform_action','decide_approval','bulk_decide_approvals')
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

  RAISE NOTICE '018 verify: 23 core RPCs + 1 view + 9 app helpers — all posture, '
               'grant, envelope, money, pipeline and spine pins PASS.';
END
$verify$;
