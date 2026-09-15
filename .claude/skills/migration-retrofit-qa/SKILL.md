---
name: migration-retrofit-qa
description: Use before applying ANY Supabase migration to any database, and whenever a migration is authored, amended, or reviewed. Runs the retrofit QA gate — forward SQL, rollback, runnable SQL pin, catalog, the E1/E2/E3 RPC contract check — then the dual adversarial review (thermonuclear + Codex gpt-5.6-sol tracing every consumer), then EXECUTES the test before anything is applied. Triggers - "check this migration", "review migration NNN", "is this ready to apply", "retrofit check", "before we apply", "migration QA".
---

# Migration Retrofit QA

## Why this exists

Real incidents from this repo's own history, in `ai/project-log.md` and
`docs/reviews/`:

- **001** shipped `COMMENT ON SCHEMA cron IS …`. On hosted, the migrating role
  does not own the `cron` schema, so it fails with `must be owner of schema
  cron` — a statement that was never tested against the actual hosted ACL
  shape, only against the local shim where the role happens to own everything.
  Fixed by dropping the statement (`f819984`, `pr6-final.md`).
- **Hosted default privileges** grant `anon`/`authenticated`/`service_role`
  full rights on every new `public` object unless a migration explicitly
  revokes them. 002's five tables briefly carried `arwdDxtm` for all three
  roles on hosted before migration 004 remediated it at the head — idempotent,
  fail-closed, with a preflight assert. The local shim does not reproduce this
  by default; it has to be recreated deliberately to prove anything about it
  (see "Running things locally" below).
- **030** fixed a null-session crash in `core.me_profile()` — the 24th
  `RPC_NAMES` entry, confirmed missing only once someone actually called it
  with no session context, not from reading the function body.
- **031** closed a CRITICAL Codex finding: an ADMIN could flip a *different*
  member's `actor_kind` to `SYSTEM` via the ordinary membership-update policy,
  and `perform_action` treats `SYSTEM` as exempt from approval on every action
  type, money-moving included. The hole was live and unexploited (`SELECT
  count(*) FROM memberships WHERE actor_kind = 'SYSTEM'` was 0) — found by
  review, not by an incident.
- **035**: `core.get_follow_up_draft` called `pg_catalog.trim(text)` — a
  one-argument form that does not exist in PostgreSQL — and 500'd the live
  Follow-ups draft pane on every request where the rate lookup actually
  succeeded (the everyday path, not an edge case). One token fix
  (`btrim`), reproduced on the shim by rolling back and re-running.

None of those was a bad idea. Each was a change that was never traced against
what already existed, or never proven against the ACL shape the target
database actually has. That tracing is what this skill is.

**The governing question, asked out loud and answered with evidence:**

> Is this a RETROFIT — additive, composing with the existing action-envelope /
> pipeline-configuration spine — or is it a BOLT-ON that changes something
> every tenant already depends on?

## The gate

Work these in order. Do not skip ahead because a stage "looks obviously fine" —
every incident above did too.

### G0 · The four artifacts

A migration is not reviewable until all four exist (`supabase/CLAUDE.md`).
Report which are missing rather than reviewing a partial set.

| Artifact    | Path                                          | Must contain                                                          |
| ----------- | ---------------------------------------------- | ---------------------------------------------------------------------- |
| Forward SQL | `supabase/migrations/NNN_<slug>.sql`           | A header stating the DEFECT/FEATURE, the CHANGE, and the worked contract check |
| Rollback    | `supabase/rollbacks/NNN_<slug>_rollback.sql`   | The prior definition **reproduced in full**, not referenced, drop order stated |
| SQL pin     | `supabase/tests/test_NNN_<slug>.sql`           | Fixtures, assertions, ends in `ROLLBACK`                              |
| Catalog     | `supabase/migrations/migration-catalog.md`     | Header counts, a dated narrative entry, what was checked and what was deliberately left alone |

The catalog update is a **same-commit hard rule**: "any touch to
`supabase/migrations/` updates the catalog in the SAME commit. A catalog entry
that lands in a follow-up commit fails the gate" (`supabase/CLAUDE.md`).

**Rollback rule:** reproduce the prior function/table definition IN THE FILE.
A rollback that says "see migration 021" depends on another file being
readable at the moment you need it, which is not a rollback. State the
rollback's DROP ORDER too — normally the reverse of the forward order.

### G1 · Retrofit or bolt-on

Answer with `git diff`, not with intent.

```bash
# The spine. Changes here need strong explicit justification, stated in the
# migration header — never a silent side effect of an unrelated migration.
grep -nE 'app\.submit_action|app\.action_policies|action_request|action_effect|pipeline_step' \
  supabase/migrations/NNN_*.sql

# Does the migration touch role_permissions (002) or endpoints.ts role lists?
# 002's app.role_permissions is the authoritative source for RPC gates —
# endpoints.ts is reconciled TO it, never the reverse (ruling, 2026-09-14,
# correcting 034's M1).
```

TrainOS's two spines (`supabase/CLAUDE.md`, root `CLAUDE.md`):

1. **The action envelope** — `app.submit_action()`, the policy gate it calls,
   and `action_request`/`action_effect`. Every primary button and every agent
   proposal passes through it. New capability ships as a new action *type*
   plus its own handler, registered in data — never a branch bolted into the
   envelope itself.
2. **Pipeline configuration** — stage names and order render from
   `pipeline_step` rows. A hardcoded stage list anywhere in SQL is a defect.

If the migration RE-CREATES an existing function (`CREATE OR REPLACE`, as 034
and 035 both did), the claim "signature and envelope byte-unchanged except for
the stated fix" is a **review-time assertion that must become an enforced
invariant** — a `$verify$`-style assert or a SQL pin, not a comment. 035 proved
this the honest way: rolled back to reproduce the exact original error, then
re-applied and confirmed the fix, rather than asserting from the diff alone.

### G2 · The RPC contract check, worked

Not asserted — _worked_, with the evidence inline in the migration header. This
maps directly onto what `npm run check:rpc` (`scripts/check-rpc-contract.mjs`)
checks statically — E1/E2/E3 below — plus the parts it explicitly cannot see.

1. **E1 · Envelope.** Every jsonb-returning function builds its result through
   `app.ok()` / `app.err()`. A hand-rolled `jsonb_build_object('success', ...)`
   is exactly how a sibling key ends up next to `data` unnoticed — the
   documented incident class `check-rpc-contract.mjs` exists to catch. New
   fields go INSIDE `data` or INSIDE `error`, never as a new top-level sibling.
2. **E2 · Casts.** No `as unknown as` inside `apps/web/src/shared/api/`. That
   double cast bypasses the type-checker at exactly the layer where the
   server-to-client shape is most fragile.
3. **E3 · Type source.** Every method on the client (`apiClient.ts` /
   `rpcClient.ts`) is typed `Promise<Result<T>>` where `T` comes from
   `@trainos/contract` (`packages/contract`). A method typed against a
   locally-invented shape is drift that has already happened.
4. **Documented blind spot** (state this explicitly, don't just trust a green
   `check:rpc`): E1 walks `{success, error}` envelopes only. A function that
   `RAISE`s instead of returning an envelope is invisible to the static
   checker — trace those by hand.
5. **Every call site.** `grep -rn "<rpc_name>" apps/web/src packages/` and list
   them. Zero is a finding (dead RPC); more than expected is a finding.
6. **Reload / edit / restore paths**, not just the fresh-submit path — TrainOS
   has no logged incident here yet, but 037-class bugs in the sibling repo
   surfaced only on session-restore, so treat it as a standing blind spot.
7. **Error-boundary coverage** for any new throw point on a route a `CLIENT`
   or unauthenticated portal visitor can reach (`/p/:token`).

Then: `npm run check:rpc` must show **0 BROKEN**, and `npm run check:grants`
must be clean (see G3 for what it actually checks).

### G3 · The traps that have actually bitten this repo

Check each explicitly. These are not hypothetical.

- **`search_path` — the EMPTY path, one spelling.** Every function is `SET
  search_path = ''`, and every reference in every body is schema-qualified.
  `test_001` T3 asserts the exact stored string `search_path=""`. **Never**
  accept `proconfig IS NOT NULL` as a proxy — it passes the broken quoted-list
  form (`SET search_path = 'a, b'`, one string naming one schema, not a path)
  too. This rule was itself corrected in this repo (`supabase/CLAUDE.md`,
  "Changed 2026-09-13"): the old four-part `pg_catalog, public, extensions,
  pg_temp` form is equally *safe* but was never equally *checkable*, since it
  stores a different `proconfig` string than the empty-path sweep asserts.
- **FORCE RLS removes the owner's exemption.** RLS is enabled AND FORCED on
  every table in `public`, `app` and `core`, no exceptions — config and
  reference tables included. A `SECURITY DEFINER` function that reads a forced
  table needs a policy admitting that read, or it silently returns zero rows.
  Where the policy is `USING (true)`, the guard is the GRANT layer (no client
  role holds `SELECT`, the schema isn't exposed) — say so at the DDL.
- **Tenant resolution.** Every policy predicate resolves the caller's tenant
  through `app.current_tenant_id()`, never by reading a membership table
  inline — an inline read re-triggers RLS on that table and recurses.
- **`auth.uid()` in a policy is always wrapped**: `(SELECT auth.uid())`.
  Unwrapped, it is re-evaluated per row.
- **`anon` is hostile by default.** It holds EXECUTE on exactly the
  public-token allowlist — today that's the three client-portal RPCs 028
  granted (`get_portal_proposal`, `add_portal_comment`,
  `accept_portal_proposal`) — and nothing else. Any other `GRANT ... TO anon`
  is a review blocker. `test_zz_anon_surface.sql` T1/T1b assert this directly
  against the catalog (`has_function_privilege`), independent of
  `check-grants.mjs`'s static regex read — both exist because the static
  check has blind spots (a dynamic `EXECUTE format('REVOKE ...')` loop, a
  REVOKE in an earlier migration than the `CREATE OR REPLACE` that re-touches
  the function) that only a live catalog query closes.
- **`authenticated` is necessary, never sufficient** — every RPC re-checks
  role and tenant inside the body. 002's `app.role_permissions` is
  authoritative for which role gates which RPC.
- **Leading-underscore functions are internal.** `REVOKE ALL` from anon and
  authenticated; only other functions call them.
- **`check-grants.mjs` M2**: every `CREATE [OR REPLACE] FUNCTION` in
  `core`/`app`/`public` carries an explicit `REVOKE ALL ... FROM PUBLIC` (and
  `anon`) in the **same file** — PUBLIC holds EXECUTE on a new function by
  default and `ALTER DEFAULT PRIVILEGES` does not close it.
- **Deploy order.** PostgREST resolves by named arguments. A client sending a
  new argument against an un-migrated database matches no function and every
  call 404s. Migration first, frontend second — hold the client change back
  until the apply window, and say so in both the migration header and the
  consuming hook.
- **Overload creation.** Adding a parameter to `CREATE OR REPLACE FUNCTION` —
  even a defaulted one — creates a second overload; two overloads differing
  only by a trailing default make short calls ambiguous (`PGRST203`). DROP the
  old signature first if the intent is replacement, not addition.
- **Secrets are never stored in plaintext.** `ai_provider_key` (029) holds a
  masked prefix and a hash only — the material lives in Supabase Vault, never
  a plaintext column.
- **Money.** Integer minor units (`sen`), `bigint`, `_minor` column suffix,
  one `currency char(3)` per table. Total-from-lines always: each line is
  `unit_minor × qty` rounded half-up, totals sum the rounded lines, tax is
  computed on the summed net. Never `numeric`, `float`, or a composite type
  (composites round-trip badly through PostgREST).
- **`ref` is immutable after insert and not gapless** — a human reference
  (`ENQ-2026-0912`), never the primary key, enforced by a trigger. A
  rolled-back transaction burns a number; that's accepted, not a bug to fix.
- **Attendance is immutable once locked** — a one-way trigger, not application
  logic. Unlocking is its own approval-gated action type.

### G4 · The SQL pin must be RUNNABLE

Verify by reading, then by running.

- **`auth.users` FK.** Several tables FK to `auth.users(id)` —
  `attachments.uploaded_by_user_id`, `enquiries.owner_id`,
  `engagements.owner_id`, and others across 004/005/008 — `ON DELETE
  RESTRICT`/`CASCADE`/`SET NULL`. Any RPC or fixture that writes one of these
  needs a real `auth.users` row to satisfy the FK, not a bare UUID.
- **Role-swap discipline.** RPC probes run `SET LOCAL ROLE authenticated` (or
  `anon`, or `supabase_auth_admin` for the two `SECURITY INVOKER` functions);
  table assertions run after `RESET ROLE`. Park results in transaction-local
  GUCs between the two — see `test_029_byok_provider_keys_vault.sql` for the
  house pattern (`SET LOCAL ROLE` / `RESET ROLE` pairs around each probe).
- **Impersonation probes are ONE STATEMENT EACH.** A `STABLE` function's
  repeated identical-argument calls can be folded by the planner, and
  `set_config` role-swap side effects are invisible to it — a batched probe
  matrix can return a silently-wrong all-denied result.
- **It ends in `ROLLBACK`.** No fixture may survive. `test_zz_anon_surface.sql`
  goes further: every assertion in it is a read against the catalog, so it
  writes nothing at all, by design, because it runs last against the fully
  applied set.

### G5 · The dual adversarial review

**Both must LAND.** Converge, triage, fix CRIT/HIGH before apply. Never trust
an exit code — Codex exits 0 even when it crashed, and a degraded run emits a
placeholder verdict. **READ the captured output.** See [[dual-gate-review]]
for the full dispatch protocol; the summary for a migration specifically:

1. **Thermonuclear** — a subagent instructed to read
   `.claude/skills/thermo-nuclear-code-quality-review/SKILL.md` (that skill is
   `disable-model-invocation`, so it cannot be Skill-invoked directly by the
   reviewer) and apply it to the migration, its rollback, its pin, and its
   `apps/web/src/shared/api` wiring.
2. **Codex `gpt-5.6-sol` / xhigh** — via `codex:codex-rescue` (told to run the
   Codex CLI itself), never a hand-rolled `codex exec`. Brief it to TRACE:
   every consumer of the touched RPC (`grep -rn` across `apps/web/src` and
   `packages/`), every prior definition of the function, the rollback's
   fidelity to the prior body, and whether the change is additive against the
   live surface. This is the standing routing for "hard SQL reviews" — no
   Opus lanes, Sonnet for the orchestrating lane.

Historical evidence for running both from this repo's own reviews (e.g.
`docs/reviews/2026-09-13-codex-retrofit-018.md`, the 011–013 and 014–017
retrofit passes): the two reviewers reliably surface disjoint findings, and at
least one dual-review round has caught a CRIT (031's actor_kind hole) that a
single pass would have missed the second half of.

**A review is evidence, not a verdict.** Verify each finding against source
before folding it.

If Codex is quota-blocked (a hard "usage limit, retry at <time>" — this has
happened repeatedly in this repo's own history, see `ai/project-log.md`), say
so plainly, run thermo alone, and record the Codex pass as **OWED** with its
reset time — do not substitute a failed or dummy verdict.

### G6 · RUN THE TEST BEFORE APPLYING

Non-negotiable, and the stage most often skipped because the apply feels like
the milestone.

```
1. Verify the target project FIRST. `list_projects` (or `get_project`) must
   show TrainOS, ref `balzmmsmrawzmefkavte`, region ap-southeast-1 — never any
   other project — before any DB call.
2. Execute supabase/tests/test_NNN_*.sql against the target with psql,
   -v ON_ERROR_STOP=1. It ends in ROLLBACK, so it writes nothing durable.
   (There is no Supabase CLI or Docker in the authoring environment —
   migrations are proved on a scratch PostgreSQL 17 cluster with a platform
   shim supplying the `auth` schema, the API roles, and `auth.uid()`, as a
   NOSUPERUSER BYPASSRLS owner with Supabase's default ACLs recreated. See
   supabase/CLAUDE.md "Running things locally" for the exact harness.)
3. Read the RESULT. A pin that errored on its fixtures has not tested
   anything.
4. Only then apply the migration — one file at a time with psql, recorded
   into supabase_migrations.schema_migrations, matching how 001–035 were
   actually applied to hosted.
5. Re-run the pin post-apply and read it again.
6. Structural verify off pg_proc / has_function_privilege: overload count,
   prosecdef, the exact `search_path=""` string, and anon/PUBLIC/authenticated
   EXECUTE — run test_zz_anon_surface.sql, don't just trust check-grants.mjs.
```

**Migrations applied to hosted are immutable — forward fixes only** (035 fixed
021's bug with a new migration, it did not edit 021). **Applying is a
user-authorized action.** Confirm before the first write unless the user has
explicitly said to apply.

## Report format

```
MIGRATION NNN — <slug>
G0 artifacts      forward ✓  rollback ✓  pin ✓  catalog ✓ (same commit)
G1 retrofit       RETROFIT | BOLT-ON — <the git evidence>
G2 contract       E1/E2/E3 worked · check:rpc 0 BROKEN · check:grants clean
G3 traps          <each named, or the one that fired>
G4 pin runnable   <auth.users FK ✓ · role-swap discipline ✓ · one-statement probes ✓>
G5 dual review    thermo <verdict> · codex <verdict> — <disjoint findings>
G6 executed       <NOT RUN | run against balzmmsmrawzmefkavte — result>
VERDICT           READY TO APPLY | BLOCKED — <what has to change>
```

Never report READY while any artifact is missing, any CRIT/HIGH is unfolded,
or the pin has not been executed and read.
