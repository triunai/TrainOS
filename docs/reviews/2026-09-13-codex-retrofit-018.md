# 018 review, independent + G6; Codex slot owed until 00:29

**VERDICT: BLOCK**

This is the migration-retrofit-qa gate for PR #11 "feat(supabase): 018 golden-path RPC
pack" (base `cloud/migrations`, reviewed at `fc9550ca40d1f45ec4260da0430ccb740d91fd77`,
the current tip of `lane/rpc-018`). It runs alongside, and cross-references,
`docs/reviews/2026-09-13-thermo-018.md` (PR #20 + its B6 follow-up PR #21), which is a
**purely static** review — its own "What I could not verify" section states plainly
that nothing in it was executed. This review's contribution is the missing half: G6
execution (apply, all 18 pins, rollback, reapply, re-run, structural verify, `npm run
check:rpc`/`check:grants`/`lint:sql`) plus independent confirmation or dispute of each
of the six blockers, with fresh file:line citations taken directly from `fc9550c`
rather than trusted from the earlier report.

**Codex gpt-5.6-sol/xhigh could not run.** Two dispatch attempts hit a hard quota
("usage limit") independently confirmed by another lane. This verdict rests on direct
SQL execution plus my own static reading — not on a second adversarial trace. **The
Codex pass is owed and should be re-run after 2026-09-14 00:29** before this PR merges,
specifically against the pipeline-seed addition (trigger ordering, backfill safety,
deterministic-id collision risk) and the ten client-derived RPC signatures against
`apps/web/src/shared/api/rpcClient.ts`, neither of which either thermonuclear pass
attempted.

---

## G6 · Execution (new — the static review did not run anything)

Shim: fresh PostgreSQL 17.11 cluster, own data directory
`~/Repos/personal-work/trainos-wt/.shim-review-018`, port 5437 pinned in
`postgresql.conf` and asserted via `current_setting('data_directory')`/`('port')`
before every run (no collision with the platform shim on 5433).

| Step | Result |
|---|---|
| Platform shim → 001-017 → 018 (fc9550c) | Applied clean, in order, no errors |
| All 18 pins, first run | **17/18 pass.** `test_014` fails T1c: expected 121, found 124 (pre-018 code state — see B4 below; this is the *un-amended* file, not a new failure) |
| 018 rollback | Clean; own `$verify$` passes; empirically confirmed data-vs-mechanism split (see B6) |
| 018 reapply | Clean, idempotent |
| All 18 pins, second run (with 018's actual `test_014` edit in place) | **18/18 pass**, including the amended `test_014` (124) and the expanded `test_018` (T0-T30, 238 assertions, 31 sections) |
| Full reset + apply 001-018 in one pass, then 18 pins | **18/18 pass**, deterministic repeat of the above |
| Rollback → reapply → 18 pins, repeat cycle | **18/18 pass** both times |
| Structural verify off `pg_proc`/`information_schema` | 0 duplicate signatures in `core` (no overload trap); 124 `SELECT` grants to `authenticated` in `core` (matches the amended `test_014`); 0 `anon`/`PUBLIC` `EXECUTE` on any `core` function |
| `npm run check:rpc` | `4 pass/watch, 0 broken` |
| `npm run check:grants` | 1 finding — `test_014:542`, a `pg_temp` `SECURITY DEFINER` test helper. **Pre-existing false positive**, already recorded in `docs/reviews/2026-09-13-codex-retrofit-014-017.md` line 73-79 before 018 existed. Not a regression. |
| `npm run lint:sql` | `54/54 files parsed` |
| Real-tenant probe (not a pin — a live insert against the shim) | Inserting a tenant fires `trg_tenants_z_seed_pipelines` and seeds exactly 2 pipelines / 16 steps. Running the rollback afterward: trigger and both seed functions are dropped, **the tenant's seeded rows survive unchanged**, and a *new* tenant inserted post-rollback correctly gets **zero** pipelines (mechanism is gone, as intended). Reapplying 018 with one bare and one fully-seeded tenant present backfills exactly 18 rows (the bare one) and 0 for the already-configured one; a third apply backfills 0 for both — idempotent and correctly targeted. |

**What this does and does not settle.** It proves the SQL as written parses, applies,
rolls back and reapplies cleanly against a real Postgres 17 instance, that the pipeline
seed's trigger-ordering and backfill idempotency claims are true in practice, and that
the rollback's data-preservation behavior is exactly as documented. **It does not
clear the correctness bugs below** — the pin's own fixtures are too narrow to exercise
them (see the note under B1/H2/H3). Eighteen zero-`rc` pins is not evidence those bugs
don't exist; it is evidence the fixtures don't reach them.

---

## The six blockers — independently confirmed or disputed

### B1 · Five near-identical `list_*` RPCs — **CONFIRMED**

`core.list_enquiries:781`, `core.list_approvals:2362`, `core.list_follow_ups:3055`,
`core.list_proposals:3332`, `core.list_quotations:3968` — line numbers re-verified
directly against `fc9550c`, unchanged from the thermo report's citations. Read all
five bodies myself; the ~110-130 line preamble (page-size parse, cursor decode,
filter loop, sort resolution, keyset append, count, page query, envelope) is
copy-pasted five times with only the table name, filter/sort whitelists, and
projection genuinely varying. A separate general-purpose thermonuclear pass I ran
earlier (against the pre-pipeline-seed commit, but this section of the file is
byte-identical across both commits) reached the same conclusion independently and
proposed the same fix shape: one `app._list(...)` helper taking the whitelists as
`jsonb` arguments. Two independent reviews, same finding, same fix. **B1's severity
call (blocker, not high) is the right one** — this is where B3, H2 and H3 all live,
and a single extraction makes all three structurally impossible rather than
individually patched.

### B2 · No migration-catalog entry — **CONFIRMED**

`supabase/migrations/migration-catalog.md` has zero occurrences of `018` anywhere —
confirmed by direct grep before I ever read the thermo report. Its header still
reads `Migrations: 17 · Applied: 0 · Authored, not applied: 17`, and its "Last
updated" entry is still 017's. This is a same-commit hard rule in
`supabase/CLAUDE.md`; it is not a follow-up-commit violation, it is a total
omission. Confirmed independently, no dispute.

### B3 · `p_view` accepted and silently dropped in three list RPCs — **CONFIRMED**

Verified directly: `p_view text DEFAULT NULL` is declared at `018:3059` (list_follow_ups),
`:3336` (list_proposals), `:3972` (list_quotations), and grep for `p_view` across
the whole file shows it is read (via `IF NULLIF(p_view, '') IS NOT NULL THEN ... AND
(saved.id::text = p_view OR saved.ref = p_view)`) only inside `list_enquiries:846`
and `list_approvals:2422`. The other three never reference the parameter again after
declaring it. This silently ignores a saved-view filter instead of failing closed,
which is the exact failure mode the file's own header forbids in its own words. No
dispute.

### B4 · 018's edit leaves `test_014` unable to pass standalone — **CONFIRMED, with a load-bearing nuance the static report didn't have room to run down**

Empirically reproduced: applied 001-014 only (018 absent) against the shim, ran
`test_014_rls_policies_and_client_grants.sql` from `fc9550c`, and it fails —
**but not at the assertion thermo cited.** It fails one assertion earlier, at T1a
(`test_014:234-236`): `ASSERT v_pairs = 116 ... (113 from 014 + 3 from 017)`. I
checked whether that number predates 018 by reading the file directly off
`origin/cloud/migrations` (018's own base commit, before this PR touches anything):
**the "116 / 113 from 014 + 3 from 017" language is already there.** `test_014` has
been unable to pass standalone-after-014 since 017's amendment pass, which is
recorded in the catalog's own amendment history ("pack 017 — test_006's trainer
fixture and test_014's two counts updated for the constraints and tables 017
adds"). 018 continues an existing convention rather than inventing a new failure
class. This repo's own documented testing philosophy (catalog: "Pins are executed
against the FULL applied set, not immediately after their own migration... a pin
that has only ever been run at the moment that flatters it has not been run")
means nobody here treats `test_014` as a standalone-after-014 gate in the first
place — G6's own procedure never runs it that way either.

That context lowers the "018 introduced a new defect" framing but does not clear
the underlying complaint: `test_014` is still, today, not a self-contained pin for
migration 014, and 018 had the option of confining its three-grant delta to an
018-owned assertion instead of pushing the count further into a file it doesn't
own. **Recommend fixing it the way thermo suggests** (018's three grants asserted
in `test_018`, `test_014`'s own count left alone or expressed as `>= 121`) — the
fix is still correct even though the underlying pattern is now three migrations
old, not one.

### B5 · No `BEGIN`/`COMMIT` wrapper — **CONFIRMED**

`grep -nE '^\s*(BEGIN|COMMIT)\s*;'` against both
`supabase/migrations/018_golden_path_rpcs.sql` and
`supabase/rollbacks/018_golden_path_rpcs_rollback.sql` returns nothing from either
file. The same grep against `017_baseline_amendment.sql` returns `36:BEGIN;` and
`1340:COMMIT;`. 018 and its rollback are the only files in the 014-018 band missing
the wrapper. Confirmed exactly as reported, and G6 sharpens why it matters: the
backfill DO block writes real rows across every existing tenant with per-tenant
exception handling (see M5) — a mid-migration failure after the backfill has run
would leave a partially-applied migration with no transaction to roll back
automatically.

### B6 · Rollback keeps seeded rows correctly, but its own R4 check verifies the wrong trigger — **CONFIRMED, with an empirical addition the static report couldn't make**

I independently ran the actual scenario rather than only reading it: inserted a
real tenant, confirmed the trigger seeds 2 pipelines / 16 steps, ran the rollback,
and confirmed the rows survive while the trigger and both functions are dropped,
and that a tenant created *after* rollback correctly gets zero pipelines. **The
data-preservation design itself is sound and behaves exactly as documented** —
this is not a design defect, and I'd stop short of calling the keep-the-data
decision wrong; deleting rows with FK dependents (`core.engagement_step_states`)
on rollback would be strictly worse.

The defect thermo found stands on its own regardless: read
`supabase/rollbacks/018_golden_path_rpcs_rollback.sql:383-393` (R4) directly. Its
surrounding comments and the closing `RAISE NOTICE` at `:395-397` both assert that
seeded pipeline rows are checked to survive. The actual `IF NOT EXISTS` query in
R4's body only checks `pg_trigger` for `trg_tenants_seed_ref_formats` — **016's
ref-format trigger, an object with no relationship to the pipeline seed at all** —
and never touches `core.pipelines` or `core.pipeline_steps`. So today's behavior is
correct (I proved that by running it), but the safety net that's supposed to catch
a future regression of that same behavior is checking the wrong object entirely,
and would not fire if a later edit broke the row-preservation contract. Recommend
adding the actual row-count assertion to R4 rather than trusting the comment.

---

## What the static review missed (additions from direct execution and reading)

- **The pipeline-seed trigger-ordering dependency (`018:4415-4429`) is
  self-documented, self-asserted, and empirically correct.** The trigger name
  (`trg_tenants_z_seed_pipelines`) is deliberately chosen to sort alphabetically
  after `trg_tenants_seed_ref_formats` because `core.pipelines` inherits 016's
  `PIP` ref-format assignment trigger, and `app.seed_pipelines` raises a named,
  specific error if that dependency isn't met yet. This is exactly the kind of
  ordering hazard this repo has been burned by before (014's own ordering hazard,
  which `test_018` T0 explicitly re-checks), and 018 handled it correctly and
  loudly rather than leaving it as an unstated assumption.
- **The seeding logic is not duplicated between the trigger path and the backfill
  path** — both call the same `app.seed_pipelines(uuid)`, which is the right
  abstraction and stands in useful contrast to B1's list-RPC duplication.
- **M5's backfill exception-swallow is real but scoped correctly**: I did not
  reproduce the exact "tenant predates 016" scenario, but confirmed the happy path
  (idempotent, correctly-targeted backfill) empirically across three consecutive
  applies. M5's complaint about a silent `WARNING` rather than a failed migration
  is a legitimate design question, not a correctness bug I can confirm broke
  anything today.
- **check:grants' one finding is pre-existing, not new** — worth stating plainly
  since a reader of just this PR's CI output could mistake it for something 018
  introduced. It was flagged as a LOW/likely-false-positive in the 014-017 review
  before 018 was written.
- **The green G6 run does not vouch for B1/B3/H2/H3/H4.** All 238 assertions in
  `test_018` pass, but T4's fixture (3 enquiries) is too small to trigger H2's
  post-cursor total shrink or H3's exact-multiple extra-page bug, and nothing in
  the pin calls `list_follow_ups`, `list_proposals`, or `list_quotations` with a
  `p_view` set to catch B3. Anyone reading "238/238 green" alongside this report
  should not treat that as clearing those findings — it's the reason the thermo
  pass exists at all.
- **`npm run lint:sql` (54/54) and `check:rpc` (0 broken) are clean** — worth
  recording since the static review explicitly said it did not run either.

## Could not verify

- **The Codex trace.** Both attempts hit a hard quota; owed after 2026-09-14
  00:29. Priority for that pass: the ten client-derived RPCs against
  `apps/web/src/shared/api/rpcClient.ts` (arg names, envelope keys, return shapes),
  and the pipeline-seed's deterministic-id collision safety and its interaction
  with `pipelines_one_default_uq`, neither of which either thermonuclear pass
  covered.
- **H1-H5 and M1-M8** from the existing thermo report were read and spot-checked
  (H2 confirmed directly at `018:944-952`, matching the static report's citation
  exactly), but not exhaustively re-verified line-by-line the way the six
  blockers were, given the time available before this handoff.
- **Hosted-project behavior** (real `auth`/GoTrue, real `pg_cron`/`pg_net`, real
  `BYPASSRLS` posture) remains unverified by any pass so far, as both reviews and
  this shim run are explicit about.

---

## Verdict

**BLOCK**, agreeing with `docs/reviews/2026-09-13-thermo-018.md`. All six of its
blockers are independently confirmed against `fc9550c` with fresh citations (B4
carries a nuance worth preserving: it is a three-migration-old pattern, not a new
one, though the fix recommendation stands). G6 execution is fully green and
deterministic and does not change the verdict — it demonstrates the pipeline-seed
mechanism and rollback contract work as designed, while confirming the pin
suite's fixtures are too narrow to have ever caught B1/B3/H2/H3/H4 on their own.
Fix B1-B6 (B1's `app._list` extraction resolves B3, H2 and H3 as a side effect),
add the missing catalog entry, wrap 018 and its rollback in a transaction, correct
R4's assertion, and re-run the Codex pass after 00:29 before merge.
