# Supabase conventions

Two things live here: the repository conventions proven in production (folder layout,
naming, the four-artifact batch, RPC contract, RLS style), and the current-guidance
defaults for a new project started in late 2026 (§10).

Where those two disagree, the disagreement is called out rather than silently resolved.

---

## 1. Folder layout

```
supabase/
  CLAUDE.md                 # security model + rules, read before touching any migration
  config.toml               # minimal; every non-default key carries a WHY comment
  migrations/
    NNN_<slug>.sql
    migration-catalog.md    # the canonical migration record
    .applied-state.json     # committed snapshot of the applied-migrations ledger
  rollbacks/
    NNN_<slug>_rollback.sql
  tests/
    test_NNN_<slug>.sql
  tables/                   # point-in-time cumulative schema reference, NOT executable
    README.md
    <table>.sql
  seeds/                    # idempotent fixture data, run manually, never by the runner
  functions/                # Edge Functions (Deno)
    .deployed-state.json
    _shared/
    <function-name>/
      index.ts              # thin serve() wrapper
      lib.ts                # pure logic, importable and testable
      lib.test.ts
      CONTRACT.md           # the authoritative request/response contract
      .env.example
```

**Ruling on rollback location**: `supabase/rollbacks/`, a separate top-level directory.
The migration-QA skill's own path string puts rollbacks inside `migrations/`; the real repo
layout puts them in their own directory and wins. What matters from that skill is the
*content* requirement — a rollback reproduces the prior definition in full, never by
reference.

---

## 2. Naming

| Artifact | Pattern | Example |
|---|---|---|
| Migration | `NNN_<slug>.sql`, zero-padded 3-digit | `012_approval_ledger.sql` |
| Rollback | `NNN_<slug>_rollback.sql`, same slug | `012_approval_ledger_rollback.sql` |
| SQL test pin | `test_NNN_<slug>.sql`, same slug | `test_012_approval_ledger.sql` |
| Table reference | `<table_name>.sql`, snake_case | `approvals.sql` |
| Seed | `{purpose}-seed.sql` + `{purpose}-wipe.sql`, or `YYYY-MM-DD_<tenant>_<slug>.sql` | `qa-baseline-seed.sql` |

Documented naming exceptions, so they are recognised rather than rediscovered:

- **Same-number forks**, when a slot is contested or a change splits:
  `073_<slug>.sql`, `073_<slug>_breakglass.sql`, `073_<slug>_restore.sql`.
- **Renumber in place**, with the old number recorded in the catalog entry
  ("was 095 — renamed; unapplied and amended in place, so a numerically-ordered replay
  would have run it before 104"). The rename is documented, never silent.
- **`.bak` suffix** marks an abandoned draft kept for history and excluded from the
  sequence.
- **Dated, non-numbered files** for one-off tenant or content operations pair a seed with a
  rollback of the same stem. They get no numbered catalog entry and no test pin — they are
  content operations, not schema changes.
- **A leading-underscore function name** (`_helper_name`) marks an internal helper never
  meant to be client-callable, typically with EXECUTE revoked from every role because only
  other functions call it.
- **One test pin can cover several migrations** reviewed as a unit:
  `test_098_100_101_<slug>.sql`.

One pattern to *recognise*, never imitate: a probe-prefixed function name appearing in a
catalog usually marks an accidentally hand-applied, unauthorized function found during a
security sweep. That is a red flag, not a convention.

---

## 3. The four-artifact batch — same commit, always

A migration is **not reviewable** until all four exist. Report which are missing rather
than reviewing a partial set.

| Artifact | Path | Must contain |
|---|---|---|
| Forward SQL | `supabase/migrations/NNN_<slug>.sql` | a header stating the DEFECT, the CHANGE, and the worked 7-point check |
| Rollback | `supabase/rollbacks/NNN_<slug>_rollback.sql` | the prior definition **reproduced in full**, not referenced |
| SQL pin | `supabase/tests/test_NNN_<slug>.sql` | fixtures, assertions, `ROLLBACK` at the end |
| Catalog | `supabase/migrations/migration-catalog.md` | header counts, Migration Order row, RPC entry, Migration Detail |

Plus a `CHANGELOG.md` line, product-facing, in the same commit.

**Catalog is a same-commit hard rule.** A migration whose catalog entry lands in a
follow-up commit fails the gate. All four layers of the catalog update together, not just
the Detail section.

**Rollback fidelity**: reproduce the prior function body *in the file*. A rollback that
says "see migration 042" depends on another file being readable at the moment you need it,
which is not a rollback. State the rollback's ORDER too — usually the reverse of forward
order.

**A rollback may legitimately refuse to run.** Three documented shapes:

- **Pre-flight ABORT** when running it would destroy audit history it is not entitled to
  destroy — e.g. abort if any row reached a resolved terminal state, because the table is
  the record of what was actually spent or approved.
- **Documented no-op** when faithful restoration is impossible. One rollback restores two
  of three dropped functions and explicitly declines the third, because that body was never
  committed anywhere and a plausible-but-wrong body under a real name is worse than
  restoring nothing.
- **Gated behind an explicit override flag** (`app.allow_NNN_rollback`) when running it
  unconditionally would strip a *later* migration's security gate as a side effect. An
  override belongs to the gate a file owns and removes on purpose, never to a later
  migration's gate it would strip incidentally.

**Maintain the rollback as later migrations touch the same function.** If a later migration
adds an overload, the earlier rollback's `DROP FUNCTION` list must name every signature
that has ever existed, not just the one it created.

---

## 4. The migration catalog

`supabase/migrations/migration-catalog.md`. Structure, top to bottom:

1. Title plus a one-line subtitle.
2. **A running stack of dated narrative entries**, newest first, prepended. Each documents
   one apply, one review fold, or one triage wave, naming the migration number, the
   concrete change, the evidence checked, and what was deliberately left alone. This is a
   living incident and decision log at the top of the file, distinct from the per-migration
   sections below.
3. `## Migration Order` — one table, `| # | File | Summary |`, in numeric order.
4. `## Tables` — one `###` per table with its current-state schema.
5. `## Indexes` — grouped by table.
6. `## RPCs (Functions)` — split into `### Helper Functions` (internal) and
   `### Public RPCs` (client-callable), one `####` per function.
7. `## Migration Detail — NNN` sections, one per migration, numeric order.
8. `## End of Catalog`.

Rules that make it trustworthy:

- **Corrections are appended forward, not rewritten in place.** When a later review finds
  an earlier catalog claim wrong, the correction is a new dated paragraph and the old claim
  is left standing with the correction pointing at it.
- **An authored-but-unapplied migration still gets an entry**, marked `AUTHORED, NOT
  APPLIED`. The catalog tracks authorship state, not only applied state.
- **Apply-time corrections fold into that migration's own section**, not somewhere else.
  One batch-apply paragraph lists five separate first-execution corrections discovered only
  by actually running the pins — a wrong catalog-function call, fixture ordering bugs, a
  literal syntax error. Each is described inline with its fix.

### Catalog templates

Migration Order row:

```
| NNN | `NNN_<slug>.sql` | **<One-sentence bold summary of what shipped and why, with the date.>** <What was added, key design decisions, the authority model if any.> Spine untouched (or: touches spine — justification). |
```

Migration Detail section:

```markdown
## Migration Detail — NNN (`NNN_<slug>.sql`)

**Status: AUTHORED + APPLIED YYYY-MM-DD** (or AUTHORED, NOT APPLIED).
Plan: `<path to the design doc, if any>`.

### What it does

- **<object>** — <what it is, key constraints, why>.
- **<rpc_name>(<args>)** — <who may call it, what it enforces, what it returns>.
- **Grants:** <authenticated-only | anon-callable and why>.
- **Spine untouched (<decision ref>):** no <spine object> is named by a byte of
  this migration.

### The 7-point RPC contract check, worked

1. Envelope: ...
2. Unwrap: ...
3. RpcMap: ...
4. Call sites: ...
5. Casts: ...
6. Reload/restore: ...
7. Public routes: ...

### Pin — `supabase/tests/test_NNN_<slug>.sql`

T1 <...> · T2 <...> · ... Executed PRE-apply (<result>) and POST-apply (<result>).

### Rollback — `supabase/rollbacks/NNN_<slug>_rollback.sql`

<Pre-flight guard, if any> -> <drop order>.
```

CHANGELOG entry for the same batch — written at the *feature* level, not the schema level.
The catalog Detail section is the engineering twin of the same event:

```markdown
## YYYY-MM-DD — <short summary of the shipped change, product-facing>

### Added
- **<Bold lead phrase, user-visible>.** <What changed and why it matters to the
  user.> (`<short-hash>`)

### Changed
- **<Bold lead phrase>.** <Detail, including which migration this depended on.> (D-NNN, `<short-hash>`)

### Security
- **<Bold lead phrase>.** <What was tightened or removed and the invariant it
  restores.> Migration NNN. (`<short-hash>`)
```

---

## 5. The RPC seven-point contract

Worked inline in every migration header that touches a client-visible RPC, not merely
asserted.

1. **SQL envelope shape.** Success is `{success, data}`; failure is `{success, error}`.
2. **Wrapper unwrap.** `data` auto-unwraps only while it is the SOLE non-`success` key. Any
   new top-level sibling key flips the client to pass-through mode. **New fields go inside
   `data` or inside `error`, never as a new top-level sibling.** This is not theoretical: a
   migration added a sibling key and broke every returning client.
3. **`RpcMap` entry** updated in the same commit as the SQL — both `args` and `response`. A
   new optional argument must stay optional while the migration is unapplied, so a client
   that is ahead of the schema degrades cleanly.
4. **Every call site.** `grep -rn "<rpc_name>" src/` and enumerate them. Zero hits is itself
   a finding (dead RPC); more than expected is also a finding.
5. **Every unchecked cast** around that RPC — named explicitly, or stated that there are
   none. This is the compiler-bypass smoking gun for a drifted contract.
6. **Reload, edit and session-restore paths**, not just the fresh-submit happy path. The
   envelope incident's white screen only surfaced on restore.
7. **Public-route error-boundary coverage** for any new throw point. An unbounded render
   crash on a public route is a customer-visible outage.

Then: `npm run check:rpc` shows 0 BROKEN and `npm run check:grants` is clean.

**Known gap, worth stating plainly**: the contract checker walks `{success, error}`
envelopes. An RPC that *raises* has no envelope to compare and is invisible to the guard.

### Function naming

| Prefix | Meaning |
|---|---|
| `admin_*` | staff-only RPC |
| `get_*` / `submit_*` / `cancel_*` | end-user-facing verbs |
| `_*` | internal helper, never client-callable, EXECUTE revoked from every role |

### Return shapes and error codes

```json
{"success": true,  "data": { }}
{"success": false, "error": {"code": "SOME_CODE"}}
```

Error codes are short SCREAMING_SNAKE strings at `error.code`: `AUTH_REQUIRED`,
`ACCESS_NOT_APPROVED`, `STALE_WRITE`, `NOT_FOUND`, and domain-specific ones.

**The no-existence-oracle rule**: an authorization refusal and a not-found refusal must be
**byte-identical** to an unauthorized caller. Test it explicitly with a real id and a fake
id in the same test.

### Raising versus returning

- **Prefer returning** `{success:false, error:{code}}` whenever the caller needs a
  discriminated, catchable failure. That is the great majority of cases.
- **`RAISE EXCEPTION` is for genuine abort conditions inside a write cascade** where a
  `RETURN` would let an earlier statement's write commit anyway. plpgsql `RETURN` does not
  roll anything back; only `RAISE` does. A real bug came from a save cascade whose comment
  claimed "refusing here rolls the whole function back" while it used `RETURN`.
- **`WHEN OTHERS` handlers must re-raise `deadlock_detected` (40P01)** rather than swallow
  it. A door under contention will hit it, and laundering it into a generic server error
  turns a retryable conflict into a permanent-looking failure. Note the correction that
  came with this rule: `query_canceled` is never matched by `OTHERS` at all, and
  `serialization_failure` is not reachable under the default READ COMMITTED isolation, so
  neither needs naming here.

---

## 6. RLS authoring style

**Pick one posture per project, never per table.** The ruling in `SKILL.md` defaults to
posture A.

### Posture A — RLS as lockout, RPC-only (default)

Every table:

```sql
ALTER TABLE public.<table_name> ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.<table_name> FROM PUBLIC, anon, authenticated;
```

Zero `CREATE POLICY` statements. RLS is enabled purely so the `REVOKE ALL` is airtight
against any future `GRANT`. All authorization lives inside `SECURITY DEFINER` RPCs, gated
by inline checks against the roles/membership tables. Deny-all with zero policies means
literally nobody reads or writes the table directly.

### Posture B — per-operation policies with helper functions

Choose this only if clients read tables or facade views directly.

- **Naming**: a lowercase, space-separated quoted string,
  `"<table> <audience> <verb/purpose>"` — `"profiles self read"`,
  `"profiles admin read all"`, `"profiles self update non role"`,
  `"vehicles superadmin delete"`.
- **One policy per operation.** SELECT/INSERT/UPDATE/DELETE each get their own named
  policy, with at most an occasional combined `ALL` policy as a superadmin escape hatch.
- **Helper functions gate every predicate.** Never inline a role read from the roles table
  inside a policy on that same table — it re-triggers RLS and infinitely recurses. Helpers
  are `SECURITY DEFINER`, `STABLE`, `search_path` pinned, EXECUTE-granted to both anon and
  authenticated (required so RLS can call them), and resolve a missing or inactive row to
  the *lowest* role rather than erroring.
- **`WITH CHECK` versus `USING` for self-service updates**: `USING (auth.uid() = id)` but
  `WITH CHECK (auth.uid() = id AND role = current_user_role())`. The check pins the
  privileged column to its read-time value, so a self-update cannot smuggle a privilege
  escalation through a row that is otherwise writable.
- **Column-level GRANTs as a second gate below RLS**, not a substitute: grant
  `authenticated` table-level SELECT but only column-level UPDATE on the safe columns. The
  column grant blocks a write to a privileged column *before* RLS is even consulted.
- **Read/write split via facade views**: reads go through views, writes go through base
  tables. Anon and authenticated get no SELECT on the raw tables; reads go through
  owner-rights views with the filter baked into the view body. Two consequences to write
  down: those views trip the `security_definer_view` advisor as an ERROR — record it as an
  accepted, reasoned disposition rather than leaving it to be re-litigated — and their
  write grants (INSERT/UPDATE/DELETE) must be explicitly revoked, because an auto-updatable
  view otherwise bypasses the base table's RLS.

### Role handling in both postures

- **anon is hostile by default.** Either revoke it everywhere (posture A) or minimise it to
  an enumerated allowlist (posture B). Track the complete set of anon-executable function
  names as a pinned invariant checked in **three** places that must agree: the check
  script, the hardening migration, and the SQL test.
- **authenticated is the default grantee for RPCs** (`GRANT EXECUTE … TO authenticated`),
  but authorization *within* authenticated is still enforced per-RPC by an inline check.
  Being authenticated is necessary and never sufficient.
- **The secret/service role is used sparingly** and documented wherever it is the sole
  legitimate writer — for example an outbox table written by a webhook that authenticates
  with its own shared secret rather than a platform JWT.

---

## 7. Templates

### Forward migration

```sql
-- ============================================================================
-- Migration NNN: <slug> — <one-line description of the change>.
-- ============================================================================
--
-- <DEFECT or FEATURE, one paragraph: what is missing or broken and what this
-- adds.>
--
-- SPINE: nothing here touches <name this project's core spine objects — the
-- config-backed tables and the RPCs every other feature calls through>. This is
-- a NEW server-owned sidecar table with wrapper RPCs. OR: this migration
-- modifies the spine — justification: <explicit reason, reviewed>.
--
-- ── AUTHORIZATION ─────────────────────────────────────────────────────────
--   READ  (<rpc_name>): <who may call it, and what an unauthorized caller gets>
--   WRITE (<rpc_name>): <who may call it, and what it enforces>
--
-- ── THE 7-POINT RPC CONTRACT CHECK, worked ───────────────────────────────
--   1. Envelope: every RPC returns {success, data} or {success, error}.
--   2. Unwrap: <state whether any new field could add a top-level sibling key>.
--   3. RpcMap: <N> entries added in src/lib/rpc.types.ts in this commit.
--   4. Call sites: <every grep hit, or "none — new RPC">.
--   5. Casts: <name every unchecked cast, or "none">.
--   6. Reload/restore: <which reload and restore paths were checked>.
--   7. Public routes: <which public routes could hit a new throw point>.
--   Then: npm run check:rpc must show 0 BROKEN; check:grants clean.
--
-- Rollback: rollbacks/NNN_<slug>_rollback.sql
-- ============================================================================

CREATE TABLE public.<table_name> (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ... columns ...
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.<table_name> ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.<table_name> FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.<rpc_name>(<args>)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Authorization check FIRST, before any branch that could leak data through
  -- an error payload.
  -- RETURN jsonb_build_object('success', true, 'data', ...);
  -- or:  RETURN jsonb_build_object('success', false,
  --                                'error', jsonb_build_object('code', '...'));
END;
$$;

-- ============================================================================
-- Grants — authenticated-only, deny anon/PUBLIC
-- ============================================================================
REVOKE ALL ON FUNCTION public.<rpc_name>(<argtypes>) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.<rpc_name>(<argtypes>) TO authenticated;
```

With `SET search_path = ''`, every object reference in the body must be fully
schema-qualified (`public.<table>`, `pg_catalog.<fn>`). The accepted alternative when
extension functions are called unqualified is the explicit four-schema form
`SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'` — pg_catalog first,
pg_temp last. Never leave it unset.

**Transaction wrapper**: ordinary additive DDL needs none — each `CREATE` is individually
transactional and the file is applied as one implicit transaction. Reach for an explicit
`BEGIN`/`COMMIT` when a migration does several independent destructive statements that must
all-or-nothing together, and say so in the header ("One transaction. A partial apply cannot
leave a half-dropped schema.").

### Rollback

```sql
-- Rollback for migration NNN: <slug>.
--
-- Drops <what> in dependency order. Forward file: migrations/NNN_<slug>.sql
--
-- PRE-FLIGHT: ABORT if <the condition that would make this destructive to real
-- data — e.g. any row reached a terminal/resolved state>.
--   SELECT count(*) FROM public.<table_name> WHERE <resolved-state predicate>;
-- If that returns > 0, STOP — the rollback cannot run.
--
-- A terminal state added by a LATER migration must be added to this predicate
-- too, in that migration's commit.

DO $$
DECLARE
  v_blocking int;
BEGIN
  -- Query the catalog first, so this degrades gracefully if the table never
  -- existed rather than erroring on a missing relation.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relname = '<table_name>') THEN
    SELECT count(*) INTO v_blocking FROM public.<table_name> WHERE <resolved-state predicate>;
    IF v_blocking > 0 THEN
      RAISE EXCEPTION 'rollback NNN ABORTED: % blocking row(s) exist', v_blocking;
    END IF;
  END IF;
END $$;

-- List EVERY signature that has ever existed for this function name, not only
-- the one this migration created — later migrations may have added overloads.
DROP FUNCTION IF EXISTS public.<rpc_name>(<argtypes>);
DROP TABLE IF EXISTS public.<table_name>;
```

### SQL test pin

Plain SQL with plpgsql `DO $$` blocks and the built-in `ASSERT`. See §9 for the pgTAP
alternative and when to prefer it.

```sql
-- ============================================================================
-- Migration NNN pin: <slug>
--
-- Run only AFTER NNN has been applied to the target database.
-- Every fixture write is rolled back; this file writes nothing durable.
--
-- HOW TO RUN
--   psql "$DATABASE_URL" -f supabase/tests/test_NNN_<slug>.sql
-- A silent run to the final NOTICE is a PASS; any failed ASSERT or RAISE
-- EXCEPTION is a FAIL and aborts the transaction, so nothing survives either
-- way.
--
-- RUNNABILITY NOTES — the four traps that make an authored pin unrunnable:
-- 1. Inserts real auth.users rows for every identity the RPCs see (FK-required).
--    Never switch session_replication_role to replica; fixtures must FK-validate.
-- 2. RPC calls run under SET LOCAL ROLE authenticated with
--    request.jwt.claim.sub set; table and catalog assertions run after
--    RESET ROLE, because every RLS-enabled zero-policy table raises 42501 on a
--    bare SELECT inside a role-swapped block. Results cross the boundary via
--    transaction-local GUCs (set_config / current_setting), never plpgsql
--    variables held across the role swap.
-- 3. Impersonation probes are ONE STATEMENT EACH — a STABLE function's
--    repeated identical-argument calls can be planner-folded, hiding a
--    role-swap side effect.
-- 4. Fixture ids are namespaced with the migration number so a partial run
--    collides with nothing in production or in another test.
-- 5. It ends in ROLLBACK.
-- ============================================================================

BEGIN;

-- PIN THE ASSERT MACHINERY ITSELF: with plpgsql.check_asserts = off every
-- ASSERT below becomes a silent no-op and the whole file passes vacuously.
SET LOCAL plpgsql.check_asserts = on;
DO $$
BEGIN
  BEGIN
    ASSERT false, 'canary';
    RAISE EXCEPTION 'test_NNN SETUP FAILURE: ASSERT did not raise — plpgsql.check_asserts is OFF and every assertion in this file is a no-op.';
  EXCEPTION WHEN assert_failure THEN
    NULL;  -- expected: the machinery works
  END;
END $$;

-- Pre-flight — NNN must actually be applied.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = '<rpc_name>'
  ) THEN
    RAISE EXCEPTION 'test_NNN SETUP FAILURE: <rpc_name> missing; NNN is partially applied.';
  END IF;
END $$;

-- Fixtures
INSERT INTO auth.users (id, email) VALUES ('<uuid>', 't<NNN>-user@example.invalid');
-- ... domain fixtures ...

-- === T1: <what it proves> ===
SELECT set_config('request.jwt.claim.sub', '<uuid>', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_result jsonb;
BEGIN
  v_result := public.<rpc_name>(<args>);
  PERFORM set_config('testNNN.t1', v_result::text, true);
END $$;
RESET ROLE;
DO $$
DECLARE v_result jsonb := current_setting('testNNN.t1')::jsonb;
BEGIN
  ASSERT v_result #>> '{success}' = 'true', format('T1 FAIL: %s', v_result);
  RAISE NOTICE 'T1 PASS — <what it proved>';
END $$;

-- === final tripwire: the success envelope has EXACTLY {success, data} ===
-- This is contract point 1/2 enforced as an executable assertion rather than a
-- migration-header claim. A sibling key added later flips the client's unwrap.
-- ASSERT (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_result) AS k)
--        = ARRAY['data', 'success'], format('TN FAIL: sibling key present: %s', v_result);

DO $$ BEGIN RAISE NOTICE 'test_NNN ALL PASS (rolled back — nothing durable written)'; END $$;

ROLLBACK;
```

Cover, at minimum: grants (authenticated-only, anon/PUBLIC denied), RLS on with owner-only
access, signed-out behaviour, the outsider case with byte-identical real-versus-fake-id
refusals, every enforcement branch, and the envelope-key tripwire.

---

## 8. Supporting files

### config.toml

Keep it deliberately minimal, and give every non-default key a comment explaining *why*.

```toml
# Supabase CLI config. Minimal on purpose — unspecified keys fall back to CLI
# defaults. Only overrides we actually need live here.
project_id = "<project-ref>"

# <function-name> is invoked by a database webhook that authenticates with our
# own x-webhook-secret header, NOT a Supabase JWT. Edge Functions default to
# verify_jwt = true, which would 401 the webhook BEFORE our handler runs. Turn
# it off here; the function enforces the shared secret itself. Equivalent to
# deploying with --no-verify-jwt.
[functions.<function-name>]
verify_jwt = false
```

Never a blanket `verify_jwt = false`. Each one is tied to a named function's own
authentication model.

### tables/ — a snapshot, not live schema

Per-file format: a header comment block (table name, audit date, which migration created
it, which modified it), the `CREATE TABLE`, then `-- Indexes`, then `-- RLS`, then
free-form `-- NOTE:` comments for anything non-obvious.

`tables/README.md` states its own scope: the audit date, the source (which migrations were
replayed), the method, and an explicit non-executability warning — *these are reference
files, NOT executable migrations; do not run them against the database*. Each file is the
cumulative current state, reconstructed, never itself executed.

This directory goes stale. The catalog is the fresher source when they disagree. Its
purpose is only so a reader does not have to replay a hundred migrations to see a table's
shape.

### seeds/

Idempotent and re-runnable: `INSERT … ON CONFLICT … DO UPDATE`, so re-running updates in
place and you can iterate without wiping first. Header states what the fixture is for, the
fixed UUIDs it uses, and the exact run command. Pair a `-wipe.sql` companion with any
fixture meant to be reset. Seeds are run manually via `psql -f` or the SQL editor, never by
the migration runner, and never numbered.

### Edge Functions

Per function: `index.ts` as a thin `serve()` wrapper, `lib.ts` holding the pure logic so it
is unit-testable without an HTTP server, `lib.test.ts`, `.env.example`, and `CONTRACT.md`.

`CONTRACT.md` is authoritative and both the backend and the UI build against it. It
documents the endpoint URL (production and local), the auth posture and *why*, a
client-side prerequisite snippet, a request-shape table with server-side constraints, a
worked example, and a full response-contract table of status code → shape → meaning. Apply
the no-existence-oracle rule here too: a 401 for "not found" and a 401 for "token mismatch"
must be deliberately uniform and the contract must say so.

Skeleton mechanics that are known-good: pinned exact import versions, an explicit `OPTIONS`
preflight short-circuit returning bare `ok` with CORS headers before any other logic, and a
single outer try/catch returning the same `{success, …}` envelope shape the RPCs use.

**Do not copy verbose step-by-step diagnostic logging into committed functions.** It shows
up in debugging snippets and in none of the real committed functions.

---

## 9. Testing: SQL pins and pgTAP

**Two valid approaches, and they are in tension.** The production repos use hand-written
plain-SQL pins with `ASSERT` (§7). Current Supabase guidance recommends pgTAP
(`create extension pgtap`, `supabase test new <name>`, `supabase test db` in CI), with a
test-helper package adding `tests.create_supabase_user()`, `tests.authenticate_as()` and
`tests.rls_enabled('public')` — directly useful for multi-tenant RLS testing without
hand-rolling JWT claims.

**Recommendation for a new repo**: use pgTAP for schema and RLS unit tests, because the
helpers remove exactly the role-swap boilerplate that makes hand-written pins fragile. Keep
the hand-written pin format for a migration's own contract pin, where the assertions are
about one specific envelope and one specific authorization matrix. Both end in `ROLLBACK`;
neither writes anything durable.

**"An authored pin that was never run is not a pin."** The motivating incidents were all
pins written, recorded as passing, and unrunnable when someone finally executed them.

### Execution protocol — in this order, every time

1. **Verify the target project first.** More than one project may be configured; confirm
   the expected project reference before any database call.
2. **Execute the pin against the target.** It ends in `ROLLBACK`, so nothing durable is
   written.
3. **Read the result.** A pin that errored on its own fixtures has tested nothing.
4. **Only then apply the migration.**
5. **Re-run the pin post-apply and read it again.**
6. **Structural verify off the catalog directly**: overload count, `prosecdef`, the
   `proconfig` search_path, and anon/PUBLIC/authenticated EXECUTE — read from `pg_proc`,
   not from the DDL text you just wrote.

**Applying is a user-authorized action.** Confirm before the first write unless the user
has explicitly said to apply.

---

## 10. Retrofit QA gate — the summary

Run before applying any migration. Report in the fixed format at the end; never report
READY while an artifact is missing, a CRIT or HIGH finding is unfolded, or the pin has not
been executed and read.

| Gate | What it checks |
|---|---|
| **G0 — artifacts** | forward, rollback, pin and catalog all exist; catalog is same-commit; rollback reproduces the prior body in full |
| **G1 — retrofit or bolt-on** | answered with `git diff` evidence, not stated intent. Diff the spine paths against the migration's SQL for spine object names. A retrofit's spine diff must be empty. New capability = sidecar table + wrapper RPC calling the unmodified spine + a config gate, never a column bolted onto the spine. If a migration re-creates an existing function, "byte-unchanged" must become an enforced assertion, not a review comment |
| **G2 — the 7-point contract** | all seven worked with inline evidence, plus the contract and grant check scripts clean |
| **G3 — the traps** | overload creation via `CREATE OR REPLACE` on a changed argument list (drop the old signature first, assert the count is 1); deploy order (migration always before frontend); security posture asserted structurally off the catalog, not read off the DDL; authorization decided before any branch that could leak through an error payload; cross-tenant and not-found errors byte-identical; parent-row lock before child-table lock; a compare-and-set reads the compared value *inside* the lock; `WHEN OTHERS` re-raises `deadlock_detected` |
| **G4 — pin runnable** | the four traps in §7's runnability notes, checked by reading and then by running |
| **G5 — dual adversarial review** | two independent reviewers dispatched concurrently. Both must land. CRIT/HIGH findings triaged and fixed before apply. A review is evidence to verify against source, **not an automatic verdict** — two reviews have contradicted each other and one was wrong. If a reviewer is unavailable, say so plainly and record it as owed rather than substituting a dummy verdict |
| **G6 — executed** | the six-step protocol in §9, in order |

Report format:

```
MIGRATION NNN — <slug>
G0 artifacts      forward ok  rollback ok  pin ok  catalog ok
G1 retrofit       RETROFIT | BOLT-ON — <the git evidence>
G2 contract       7/7 worked · check:rpc 0 BROKEN · check:grants clean
G3 traps          <each named, or the one that fired>
G4 pin runnable   <auth.users ok · role discipline ok · one-statement probes ok>
G5 dual review    <reviewer A verdict> · <reviewer B verdict> — <disjoint findings>
G6 executed       <NOT RUN | run against <project> — result>
VERDICT           READY TO APPLY | BLOCKED — <what has to change>
```

---

## 11. Defaults for a new project (current guidance, late 2026)

| Area | Default | Why |
|---|---|---|
| API keys | `sb_publishable_` / `sb_secret_` | Opaque strings, not JWTs; validated at the gateway. Secret keys reject browser use by User-Agent (401) — a guardrail the legacy key never had. Mint one secret key per backend component so a leak rotates one thing. Legacy JWT keys are deprecated through end of 2026 |
| JWT signing | Asymmetric ES256 | Verify locally against a cached JWKS with no auth-server round trip; revoke by key-state transition without a global sign-out. Decoupled from API-key rotation |
| Multi-tenancy | Shared tables + `tenant_id` column + RLS | The posture every RLS example assumes. Schema-per-tenant is undocumented here and adds migration and pooling overhead; reserve it for a handful of hard data-residency cases |
| Tenant/role in requests | Custom Access Token Hook writes `tenant_id` and `role` into JWT claims | Zero extra round trips in policies vs a per-statement profile lookup. **Claims only refresh when the token does** — force a session refresh after any privilege change that must take effect immediately |
| RLS performance | Wrap `auth.uid()`/`auth.jwt()`/any helper in `(select …)`; index every column a policy filters on including `tenant_id`; `SECURITY DEFINER` helpers in a **non-exposed** schema; `TO authenticated` on every policy; no joins inside policy expressions | The `(select …)` wrapper produces a cached initPlan instead of per-row evaluation. `TO <role>` lets Postgres skip policy evaluation entirely for non-matching roles. A composite primary key does not give a standalone index on a non-leading column |
| Non-human actors | A dedicated `agents` table (tenant-scoped) + a hashed revocable key + a short-lived minted JWT carrying `role`, `tenant_id`, `agent_id` | **No official pattern exists for this** — the recommendation is synthesis. It gives per-agent RLS scoping and clean revocation. Avoid one shared secret key for all agents: that is full RLS bypass with no per-agent accountability. Carry `actor_type`, `actor_id`, `triggered_by_run_id` on every mutation table |
| Policy-gated action envelope | Edge Function orchestrates network/LLM work, then calls **one** `SECURITY DEFINER` RPC that atomically evaluates rules, writes the domain rows, writes the audit row and upserts the idempotency key | PostgREST wraps each RPC in its own transaction — the only real atomicity here. plpgsql cannot make synchronous outbound calls; the async HTTP extension is fire-and-forget. Separate client calls do not share a transaction |
| Idempotency keys | Dedicated table, unique constraint, `INSERT … ON CONFLICT DO NOTHING` returning the cached response, hourly `pg_cron` cleanup at a 24h TTL | Zero rows returned means a prior row exists — select and return it instead of re-executing. Note the cron job-run-details table is not auto-pruned and needs its own cleanup job |
| Outbox | `pgmq`, enqueued **in the same transaction** as the write it describes | Durable, avoids the dual-write problem. Read via the visibility-timeout API, not the popping one. **Conflict to know about**: the overview page says "exactly-once" while the extension's own function docs describe at-least-once via visibility timeout — make consumers idempotent regardless of which is authoritative |
| Client-facing events | Realtime **Broadcast** triggered from the database, with RLS on `realtime.messages` and tenant-scoped channel names | The change-feed mechanism does one RLS check per subscriber per change on a single thread and does not scale past roughly 3,000 concurrent subscribers regardless of compute. Broadcast sends once and fans out. Policies are cached per connection — a permission change needs a reconnect |
| Fire-and-forget external notification | Database Webhooks | No documented retry or delivery guarantee. Fine for eventual consistency, wrong for anything needing outbox durability |
| Money | `bigint` minor units + a `currencies` table for each currency's minor-unit exponent + `GENERATED ALWAYS AS (…) STORED` for computed totals | Faster aggregation than `numeric`, exact by construction, matches processor wire format. **This diverges from the generic "use numeric for money" advice** — that guidance assumes single-currency and does not anticipate varying minor-unit scales. Never `float`. Store FX rates as `numeric`, convert at the boundary, round to the target minor unit, persist only the integer |
| Provenance on AI-touched fields | `jsonb` column on the row for current state, plus a side history table for audit queries, plus a `pg_jsonschema` `CHECK` constraint on the envelope shape | Colocated reads stay cheap; the side table survives updates and answers cross-row questions. The DB-level shape check does not depend on every write path calling the same validator. Index a single hot key with an expression index rather than a full GIN index; use `jsonb_path_ops` when only containment is needed |
| Schema workflow | Declarative schema files + `supabase db diff` + a preview branch per feature + tests in CI + a hand-written, reviewed, tested compensating migration alongside every forward migration | Declarative schemas are the current recommended default for new projects. **Treat every generated diff as a draft**: DML is never captured, and policy renames, materialized views, view ownership and grants, partitions and domains do not diff cleanly. There is no built-in rollback on a preview branch — delete and recreate it |
| BYOK provider keys | Vault, one row per tenant/provider, decrypted only through a single audited `SECURITY DEFINER` function that writes an audit row in the same transaction | Project env secrets are one static value shared by every invocation — they cannot hold per-tenant runtime data. A hash-based API-key pattern is wrong here: you must relay the tenant's *actual* key onward, so you need reversible, audited decryption. **Operational trap**: rotating the project root encryption key makes every existing secret unreadable and they must be manually re-created; there is no automated re-encryption. Put that in the rotation runbook |
| Edge Functions | Pin the function region to the database's region; `waitUntil` for work outliving the response; stream provider responses as server-sent events | Region pinning cuts round-trip latency for the several database calls a typical agent turn makes, at the cost of automatic multi-region failover. Background tasks share the same wall-clock and CPU budget as the request — they are not a longer window. A blocking long LLM call is bounded by the idle timeout |
| Auth in an SPA | PKCE (the default), `getUser()` for authorization-sensitive checks, `getClaims()` once on asymmetric keys, a **restrictive** policy for MFA-gated tables | Never trust the embedded user object from a cached session for authorization. Permissive policies OR together; only a restrictive policy actually blocks. Organisation-level MFA enforcement governs dashboard access, not your app's end users |
| Type generation | `supabase gen types typescript` as a **required check on every PR touching migrations**, diffed against the committed file | The documented pattern is a nightly regeneration that auto-commits on change. Nightly-only detection lets a schema change and its consuming code ship in the same review cycle without ever being validated together. The fail-on-drift gate is this skill's recommendation, not sourced guidance |
| Observability | Run the security and performance advisors after **every** schema or RLS change; treat security-advisor RLS findings as blocking | The advisors catch exactly the mistakes in this table: RLS off on a public table, RLS on with no policies, views over the auth schema leaking data, `SECURITY DEFINER` functions callable without guards, and policies calling auth functions per row instead of once per query |

### Where the sources were not solid

State these when the topic comes up rather than presenting them as settled:

- **Non-human service principals**: no official pattern exists. The `agents`-table design is
  synthesis.
- **The action-envelope shape**: no first-party reference architecture exists for it. The
  hybrid design is assembled from several separately documented behaviours.
- **jsonb column versus side audit table for provenance**: nothing adjudicates the
  trade-off directly.
- **`bigint` minor units versus `numeric`**: generic best-practice guidance and
  domain-specific money literature genuinely diverge. The ruling above picks a side for a
  stated reason.
- **`getClaims()` versus `getUser()`**: the comparison is assembled from the signing-keys
  documentation plus community explanation; no single official page states it cleanly.
- **Queue delivery semantics**: the marketing page and the extension's function docs
  disagree. Build idempotent consumers.
- **The schema-diff engine**: the CLI reference page and the workflows guide name different
  default engines. Review every generated migration by hand regardless.
- **Edge runtime version**: no page pins one. Verify at implementation time; do not hard-code.
- **Schema-per-tenant**: no official comparison exists; the shared-table recommendation is
  reasoned, not cited.
