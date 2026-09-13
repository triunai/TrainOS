# Workstreams

> The parkable board. Every initiative is a first-class thread that can be
> parked and picked up, not a single "current work" snapshot that loses one
> thread while advancing another.
>
> Status: 🟢 ACTIVE · ⏸ PARKED · ⛔ BLOCKED · ✅ DONE
>
> Parking a thread is two edits: flip the marker and rewrite `Resume:`. Picking
> one up is the reverse. A thread that has gone cold moves to
> `ai/project-log.md` and leaves this file.
>
> `Resume:` is the contract this file makes. It must be cold-startable — a
> session with no memory of this one should be able to begin from that line
> alone. If it needs context that is not in the line or its refs, the line is
> not finished.

---

## ⛔ SUPABASE SCHEMA — 014's fixes pushed, second reviewer OWED (quota); 015–017 still BLOCK; 018 at 6 blockers (2026-09-13)

✅ **The second D-012 pass is now confirmed formally landed as PR #18**
(merged `4162a4d`, one file, cut from `main` per the new review-branch
rule — see below). What follows was first confirmed directly against the
branch-only commit `5a5655c` before the PR existed; the verdict is
unchanged now that it's merged. Verdict, confirmed exactly against the
actual diff:
**014 BLOCK (unchanged)**, **015 MERGE-WITH-FIXES**, **016 BLOCK**, **017
BLOCK**. "None of the four packs may merge as currently written. 015 is
the closest to ready," quoted directly from the review.

- **015**: no CRIT/HIGH. Central safety claim verified true — exactly two
  `cron.schedule()` calls (`trainos_reap_jobs` every 30s,
  `trainos_reap_cron_history` daily) and zero `net.http_post`/`net.http_get`
  calls anywhere in the file. One real gap: `app.reap_jobs_all_tenants`
  has no overload-count guard in its verify block — the same G3 trap
  class the skill exists to catch — so a later migration adding a
  defaulted parameter would silently create an ambiguous overload.
- **016**: forward migration confirmed sound (the `pg_trigger`-derived
  seeding mechanism is real). BLOCKED on its rollback: an unqualified
  `DELETE FROM core.ref_formats WHERE NOT EXISTS (allocated)` deletes
  every unallocated ref_format row in the database, not only the ones 016
  itself seeded — confirmed the exact same class of defect that blocked
  014's rollback.
- **017**: highest blast-radius pack in the PR, four serious findings all
  confirmed directly against the diff. (1) CRITICAL: SST is meant to be
  resolved from policy per ruling R-C, but every quotation is stamped
  `sst_rate=0, sst_reason='STANDARD_RATED'` with no trigger or write-path
  call to `app.resolve_tax_policy()` — silently under-taxing every
  quotation at zero. (2) The file is one transaction start to finish, so
  its claimed `NOT VALID`/`VALIDATE` lock-safety property does not
  actually exist — `VALIDATE` inside the same transaction still holds the
  lock to commit, operationally identical to a plain `ADD CONSTRAINT`.
  (3) An unguarded `VALIDATE` on `evaluation_responses_overall_score_range`
  has no pre-flight row-count guard, and the file's own header concedes a
  legacy 4.5-point Likert score is accepted today — this aborts on any
  database carrying one. (4) The rollback's header claims only
  non-customer data is lost, but it actually drops
  `core.data_breach_register` (a statutory PDPA register),
  `data_retention_policies`, consent-evidence columns, and the SST columns
  on already-issued quotations — confirmed false as stated. Also
  confirmed: catalog pin `T3b` never executes, because its fixture selects
  from an empty `core.engagements` table in that pin, so `IF FOUND` is
  false and the assertion it claims to prove silently never runs — "the
  same false-catalog-claim mechanism that hid 014's defect, reproduced
  here," quoted directly.
- **Pin-edit audit confirmed: 14 hunks across 10 files, all legitimate**
  adaptations to 016's provisioning trigger and 017's new tables — none a
  weakened assertion, two recomputed counts independently re-verified
  correct by execution.
- **`check:grants` ruling confirmed: the `pg_temp` SECURITY DEFINER flag
  on `test_014:513` is a false positive.** `pg_temp` objects cannot
  persist an escalation past their own transaction; the fix is a
  `check:grants` exemption, not a test change.
- G6 confirmed run on all 17 migrations: forward, all pins, rollback
  017→015, re-apply all clean — proves internal consistency only, exactly
  as the first pass's own framing already established; none of these
  findings are pin-detectable, several because the claimed property (the
  lock-safety one) doesn't exist regardless of what any pin could show.
- **Everything routed to `fix-014`, which now covers all of 014–017, not
  just 014.** Hosted apply stays gated on the eventual clean verdict.

✅ **This second pass is now confirmed formally landed: PR #18 merged at
`4162a4d`** (`gh pr view 18`: mergedAt 2026-09-13T12:53:11Z, base `main`,
merge parent `62097b1` — this session's own earlier push), adding
**exactly one file**, `docs/reviews/2026-09-13-codex-retrofit-015-017.md`
— confirmed the new review-branch rule held this time: cut from `main`,
one doc file, no PR-branch dependency to go stale. Verdicts confirmed
unchanged from the branch-only version this thread already recorded: 015
MERGE-WITH-FIXES, 016 BLOCK, 017 BLOCK. **`564dd64` (the `provision_tenant`
`p_id` amendment) confirmed reviewed separately and sound** — the report
states directly: "the forward migration and the `564dd64` amendment are
both sound and independently verified," with 016's BLOCK resting entirely
on its rollback, unaffected by the amendment.

⚠ **New finding #19, from a genuine thermonuclear pass (the skill became
available mid-session) — confirmed exactly against the review doc.** 017
adds a third tenant-provisioning trigger, `app.seed_compliance_check_keys`,
mirroring 016's `seed_ref_formats` pattern almost line-for-line — but
`app.provision_tenant`'s completeness guard is never updated to also
verify check-keys were seeded. The exact failure mode that guard exists
to catch (a tenant that looks provisioned but is missing something a
later table needs) is now unguarded for check_keys, found by comparing
the two files' structure rather than by running anything. Routed to
`fix-014` with a request for a registerable per-pack check, since 018
adds a fourth such trigger (the pipeline-stage one confirmed in the
SUPABASE SCHEMA thread above) and three independently-copied seed-trigger
patterns (011, 016, 017) is already one too many. Also from the same
pass, confirmed present: **017's 1,340-line single transaction is
flagged as a maintainability/decomposition problem independent of its
already-found defects** — deferred, with a catalog note requested rather
than fixed inline.

✅ **The "nineteen" pin-edit figure is confirmed wrong — recounted three
times against three different bases, same result each time: 14 hunks
over 10 files, all legitimate.** The report states the likely
explanation directly: `main` already carries 014's content by the time
of this recount, so there is nothing further to find there beyond what
crossing from 014's own tip already identified. `codex-review-014-017`
(the original lane/worktree, still alive per its own worktree)
stays alive for the re-review once `fix-014` pushes its fix for all four
packs.

⚠ **Negative result for the log, and a real pattern, not a coincidence:
two packs in one PR (014 and 016) shipped rollbacks that destroy state
they never created and assert the broken result as correct.** Recorded as
a new line for the migration-authoring checklist: "a rollback restores
PRIOR state, not empty state" — the same failure mode twice in one day is
worth a standing check, not just two separate findings.

⚠ **Second correction, this time to the "015–017 do not exist" claim this
thread repeated from the review two updates ago — that claim was itself
wrong, and I should have caught it against evidence I already had.** The
review's own body said "`git log --all` finds no `015_`, `016_`, or `017_`
file ever committed, on any branch," and I recorded that as established
fact. It was not: 015, 016 and 017 were committed to `cloud/migrations` at
19:35:49, 19:42:56 and 19:59:54 on 13 Sep — confirmed directly by `git log
--format="%ai" -1 <sha>` on each of `5e7c4bc`, `5d0f31c`, `52caf6b` — all
**before** the review doc itself was committed at 20:08:39 (`eb5b43e`). I
had already run `gh pr diff 6` in an earlier pass and seen these three
files in the diff; I did not cross-check that against the review's
contradicting claim before repeating it. The actual cause, confirmed:
the reviewer's own checkout was detached at `826bb52` (014's commit,
19:30:03) and never fetched, so its local view of the repository was
genuinely stale — a tooling artifact, not a fact about the repository. 015,
016 and 017 have existed the whole time; what's true is that **the D-012
review never actually looked at them**, for a different reason than
"they don't exist."

**Resume:** Read PR #6's own body section "Review fixes — migration 014"
first — it is now the most current state for 014. **014's original two
CRITICAL findings are fixed and pushed** (tip `21ec975`), with pins that
exercise each fix, but **the second required reviewer (Codex) is
quota-blocked until 14 Sep 00:29, so no MERGE verdict exists yet** — see
the confirmed detail below. A second, independent (Opus thermonuclear)
pass already ran against the fixes and found five NEW defects, all fixed
in the same push; that pass's own findings are confirmed above alongside
the original ones. **015–017 are a separate, still-fully-BLOCKED
question** (see PR #18's confirmed verdicts above) — their own fix work
remains on `fix-014`, not yet pushed as of this check. `lane/rpc-018`
(worktree `~/Repos/personal-work/trainos-wt/rpc-018`, branch
`lane/rpc-018`, PR #11) continues in parallel but must not reach a hosted
project before 014 lands — see 018's own hard rule below, now itself at 6
confirmed Blockers per PR #21. Merge order: PR #6 merges only after BOTH
014's Codex re-review lands a clean verdict AND 015–017 get a real fix
and pass their own review; PR #11 (018) merges only after its own review
clears its 6 Blockers, separately. Hosted apply (L3) stays gated on PR
#6's eventual MERGE verdict AND R-F, whichever lands last. **014's SQL file staying on `main`
via PR #12 is intentional, not a leak to clean up**: nothing applies to
hosted without the user's hand regardless, and PR #6's eventual merge
supersedes the copy already on `main` (same file, same content, no drift
risk). **New rule for review lanes, told to `codex-review-014-017` already:
a review-report branch is cut from `main` and carries exactly one doc
file — never from the PR under review.** That is precisely what caused the
stale-checkout error corrected above: a review branch cut from the PR's own
tip goes stale the moment the PR gets another push, because the review
worktree has no reason to fetch a branch it isn't tracking.

**Confirmed directly 19:5x: `core` is still not exposed on the hosted
project.** Probed the live REST endpoint myself (`curl .../rest/v1/<table>`
with `Accept-Profile: core`, using the publishable key from the Supabase MCP)
and got back exactly `PGRST106`: `"Only the following schemas are exposed:
public, graphql_public"`. R-F (expose `core` in the dashboard) is a real,
still-open user action — not resolved by anything a lane can do — and
nothing else currently blocks the hosted apply once 014 passes review.

**Scope:** Everything under `supabase/`. Migrations, rollbacks, the executable
pins, the catalog, and the architecture documents they implement.

**State:** 001–013 authored, EXECUTED against a local PostgreSQL 17.11 shim,
and committed to main (013 in `bc15b17`). PR #6 now has 4 commits and touches
014–017's files (confirmed via `gh pr diff 6`), but **only 014 has been
reviewed, and it is BLOCKED.** Assertions per pack as reported: 014×51,
015×13, 016×15, 017×39; 17/17 pins pass from a clean shim including a full
reverse rollback to zero relations — this proves the SQL is internally
consistent with its own test plan, **not** that the test plan covers the
authorization defects the review found (the review's own words). **018 is
now PR #11** (`feat(supabase): 018 golden-path RPC pack`, branch
`lane/rpc-018`, confirmed open, 3 commits, 3 files — migration + rollback +
test, matching this repo's per-pack convention — 4955 additions total).
Nothing has been applied to any hosted database.

⛔ **D-012 review of migration 014 (PR #12, merged `02240e6`): VERDICT
BLOCK.** Read in full at `docs/reviews/2026-09-13-codex-retrofit-014-017.md`.
Two CRITICAL findings, both confirmed directly in the migration files by
this session, not just quoted from the report:

1. **`014:625` grants DELETE on `public.memberships`**, which 002 never
   granted and which reopens a role-escalation path: an aal2 ADMIN can
   `DELETE` their own membership row and `INSERT` a new one with a higher
   role, because the UPDATE-only self-edit guard (`002:763`) never sees a
   DELETE+INSERT pair. Also destroys 002's required soft-delete audit trail.
2. **The 014 rollback (`014_..._rollback.sql:75`) runs `REVOKE ALL ON ALL
TABLES IN SCHEMA public FROM authenticated, anon, PUBLIC`**, which strips
   migration 002's ORIGINAL grants rather than restoring pre-014 state — and
   the rollback's own post-condition asserts zero client privilege as
   correct, so it cannot fail loudly. Running this rollback breaks
   login/profile/team reads against a database the header claims is
   "restored to the state 013 left."

Five more HIGH/MED findings (blanket tenant-scoped SELECT on all 114 `core`
tables with no role/permission check beyond tenant membership — exposing
`ai_provider_keys`, `public_share_tokens`, and `run_node_io` to any
authenticated principal; a client omission that makes the approval
optimistic-concurrency hash check a silent no-op; wrong policy/relation
counts in the header and catalog vs. the actual DDL) are in the full doc.
G6 (full execute-before-apply) passed — 14/14 migrations, 14/14 pins,
rollback, re-apply, re-pin all clean — **and the review states explicitly
that this does not clear the BLOCK**, because none of the existing pins
exercise the DELETE-then-INSERT escalation, the rollback's `public.*`
damage, or the missing role checks. The earlier Grant Hygiene failure this
thread already recorded (`test_014...sql:513` defining a `SECURITY DEFINER`
function) is addressed in the review as a likely false positive: the
function lives in `pg_temp`, session-local, dropped on transaction
rollback, so it cannot escalate anything outside the test — flagged for a
`check:grants` allowlist exception rather than dismissed outright. The
review also notes the mandated "thermonuclear" reviewer skill
(`.claude/skills/thermo-nuclear-code-quality-review/SKILL.md`) does not
exist anywhere in this environment; a substitute adversarial pass was run
in its place and independently converged on both CRITICAL findings.

✅ **`fix-014`'s work is now confirmed complete and pushed to
`origin/cloud/migrations`, tip `21ec975`** (six commits: `d9834b7`,
`260ee64`, `7f18c68`, `d8778be`, `ab6a8f7`, `e3a871c`, rebased onto
`564dd64`), documented in PR #6's own body under "Review fixes —
migration 014." Confirmed every fix has a pin that exercises it (fails
against the pre-fix SQL, passes against the fix) — verified several
directly, not just the summary table:

- **CRIT-1 fixed** (`test_014` T11): the DELETE-on-`public.memberships`
  escalation is closed by a new `RESTRICTIVE FOR DELETE` policy,
  `memberships_no_client_delete USING (false)`, confirmed present in the
  commit exactly under that name; the grant block restates 002's three
  privileges verbatim rather than widening them.
- **CRIT-2 fixed**, new pin file `test_014_rollback_restores_002_grants.sql`
  with assertions `R1`–`R4`, confirmed present, checking the rollback
  restores 002's original grants rather than certifying a broken zero-
  privilege state as correct.
- **HIGH-1 fixed for exactly three named tables** — `ai_provider_keys`,
  `run_node_io`, `public_share_tokens` — via `test_014` T12, confirmed
  with four sub-cases `T12a`–`T12d` in the diff (the "four-way" check),
  each covering anon/wrong-role/tenant-role/aal2-ADMIN. Deliberately not
  fixed for the other 110 tables — a stated posture, not an oversight.
- **HIGH-2 fixed** (T13, the nullable-tenant WITH CHECK laxity),
  **HIGH-3 fixed** (a false header claim about pre-014 grants, corrected
  against a measured baseline), **HIGH-4 deferred DB-side** (T15 pins the
  SQL half and is written to fail once the client is fixed — the client
  half already merged via PR #17). All MED findings and the
  `check:grants` `pg_temp` exemption (now in `scripts/check-grants.mjs`,
  confirmed) are fixed.
- **Three execution-only findings, found by running the fix rather than
  reading it, confirmed exactly against PR #6's own body:**
  1. Rolling 014 back while 017 was still applied destroyed three things
     at once — 017's grants, an unstamped-policy gap, and a manifest
     count mismatch (measured: 228 stamped vs. 234 derived) — now refused
     outright, with the rollback aborting and naming the required order.
  2. `app.apply_tenant_policies` could silently erase an existing role
     gate via a bare two-argument call; now refuses that call and offers
     a literal `'UNGATE'` escape instead, exercised by six branches in a
     new `T16`.
  3. `001:232` was found to independently grant `USAGE ON SCHEMA core` to
     `anon`, `authenticated` and `service_role` — 014's header and
     rollback had both been wrong about this a third time in the same
     class as CRIT-2, now pinned by `R3`.
- **Validation counts, confirmed exactly against PR #6's own table**: 18/18
  forward apply, 17/17 pins pass (the post-rollback pin correctly
  _refuses_ while 014 is applied, which counts as a pass), rollback
  017→014 4/4 dropping 228 stamped policies, `R1`–`R4` pass, re-apply 4/4,
  `check:grants` 0 findings, `lint:sql` 52/52, `check:rpc` 4 pass/0 broken.

⛔ **BLOCKER, confirmed exactly: the second required reviewer slot is
OWED, not filled, and PR #6 says so itself.** Codex `gpt-5.6-sol` was
dispatched alongside the Opus thermonuclear pass and came back hard
quota-blocked — the literal message, confirmed: "usage limit … try again
at Sep 14th, 2026 12:29 AM." No verdict has been substituted; PR #6's own
body states the consumer-trace check (every caller across `apps/**` and
`packages/**`) is specifically what a structural pass can't cover, and
asks for a re-run once quota resets, before merging. **Fallback in effect
per the user's ruling, Kimi unavailable**: all remaining reviews on this
line run as Opus thermonuclear plus a security pass, with the Codex slot
recorded as owed rather than silently dropped — 014's re-review
(`codex-review-014-017`), 018 (`codex-review-018`, finalizing from its own
inspection), and 011–013 (`codex-review-011-013`). 015–017's own fix
slices are confirmed still open on `fix-014`.

**Active fix/review lanes, confirmed via `git worktree list`:**
`codex-review-014-017`'s continuation (worktree
`~/Repos/personal-work/trainos-wt/codex-pass2`, detached HEAD at `52caf6b`
— 017's own tip, confirming this checkout DID fetch correctly this time)
reviews 015–017 plus the pin edits from the first pass — reported at the
time as "nineteen," since corrected by three independent recounts to 14
hunks over 10 files, all legitimate; see below. `fix-approval-hash`
(Sonnet, worktree `~/Repos/personal-work/trainos-wt/fix-approval-hash`,
branch `fix/approval-diff-hash`) merged as PR #17, confirmed — the client
half of finding #6 above.

**Two CI fixes landed as separate PRs.** PR #14 (`fix(ci): make the npm
audit gate block on what ships`, branch `ci/audit-scope`) **confirmed
MERGED** — changed from "open" in an earlier report, found by re-checking
live state. Confirmed the fix actually works: `npm audit (high+)` now
passes genuinely (not just via `continue-on-error`) on main's latest CI run
(`gh run view` on the run right after the merge), with the `--omit=dev
--audit-level=high` command and the three dev-only advisories named in a
comment exactly as reported (`GHSA-fx2h-pf6j-xcff` vite,
`GHSA-5xrq-8626-4rwp` vitest, `GHSA-82fw-gwwq-j7x9`
`@vitest/mocker`/`@vitest/coverage-v8`), plus a note that production scope
is clean at high+ except two moderate react-router advisories needing
their own major-version work. **Main is now red on exactly one job, Grant
Hygiene, confirmed directly on the live run**: `test_014_..._sql:513`'s
`SECURITY DEFINER` function landed on `main` via PR #12 (see the addendum
below on 014's file living on `main`), and `check:grants` fails on it
there the same way it always did in PR #6. The fix arrives with `fix-014`.
PR #15 (`chore(toolchain): vite 7 + vitest 3 (dev-only audit advisories)`,
branch `chore/vite7-vitest3`, **DRAFT, confirmed — not for merge**) is the
toolchain upgrade that actually clears those three advisories; its latest
commit (`test(web): state the timeout three Radix-menu tests have always
needed`)
confirms the previously-reported timeout fix is in progress — and the
diagnosis is now confirmed precise, not a guess. `fix-pr5` measured the
three slow tests (`RowActionMenu`, `pipeline`, `knowledge`, 6–9s each) and
found none of it is Radix or the UI: the menu item is in the DOM 13ms
after the keypress and a synchronous `getByRole` against it costs 1ms —
the seconds are spent inside `findBy*`'s `asyncAct` wrapper while
floating-ui keeps scheduling position work for the open menu. Swapping
those three `findBy*` awaits for a settle plus `getByRole` is the real fix
(would return ~21s to the suite) but touches three files outside this
branch's scope, so it's left for its own change. The 15s guess was
confirmed to have failed on the runner; `testTimeout` was raised to
`30_000` as a ceiling for a hung test, not a budget.

⛔ **PR #15 stays DRAFT and is now confirmed BLOCKED, not just
in-progress — checked directly against its own CI, not taken on the
report.** Even at 30s, the `knowledge` and `pipeline` Radix-menu tests
time out on the runner while passing in well under 10s locally —
confirmed on live run `34757075746`: `knowledge.test.tsx`'s "keeps Check
and Re-ingest out of every row" failed at exactly `Test timed out in
30000ms`, and `pipeline.test.tsx`'s "offers every other stage in the
card's menu" failed identically. (`RowActionMenu`, the third test named
in the original diagnosis, was not among the failures on this run —
recorded as observed, not explained further.) The refined diagnosis: a
CPU-bound spin inside `findBy*`'s `asyncAct` wrapper while floating-ui
schedules position work, so the fix is a raw poll plus a synchronous
`getByRole`, not any timeout value — confirmed as the stated reasoning,
matching the mechanism already recorded above. The fixer refused to write
that fix without first reproducing it, which is the right call rather
than guessing at a rewrite under time pressure. **Negative result for the
log: "raise the timeout" is a dead lever, tried twice** — 15s failed, 30s
also failed, and both attempts are now on record so nobody tries a third
timeout bump before writing the poll-based rewrite. `npm audit (high+)`
was separately confirmed passing on this same run, so the toolchain
upgrade's audit-clearing purpose does work; only the test-timeout question
blocks the merge. `fix-pr5`'s lane is reported shut down; the worktree
itself (`~/Repos/personal-work/trainos-wt/fix-pr5`, still on branch
`chore/vite7-vitest3`) is still present on disk as of this check — noted,
not disputed, since "lane shut down" and "worktree not yet cleaned up" are
different claims.

🟢 **PR #17 (`fix(web): decideApproval sends the expected diff hash`,
branch `fix/approval-diff-hash`) confirmed MERGED at `e20e1ba`** (`gh pr
view 17`: mergedAt 2026-09-13T12:37:17Z), after `review-pr17`'s MERGE
verdict — matches at `011:2598` (rpc argument), `011:2784` (`DIFF_CHANGED`
detail keys) and `011:2775` (APPROVE-only guard) all confirmed as real
line references in the migration, not invented. Closes the client half of
014's HIGH finding #6. Confirmed in the diff: `ApprovalRequest.diffHash`
and a required `ApprovalDecideRequest.diffHash` added to the contract; a
new `DIFF_CHANGED` error code, confirmed mapped to HTTP `409` in
`ERROR_STATUS`; `rpcClient.decideApproval` now sends
`p_expected_diff_hash`; the fixture client enforces the same guard on
`APPROVE` only, matching 011's own scope; a new conformance test proving
both clients refuse a stale hash identically and accept a fresh one
identically. **1504 tests confirmed exactly** — the PR's own test plan
states "1118 + 189 + 107 + 90 tests, all passing," which sums to 1504.
`fix-approval-hash`'s worktree confirmed gone from disk — lane genuinely
shut down, not just reported as such.

⚠ **Caveat on what the conformance test actually proves, worth recording
plainly:** the "rpc" side of the conformance suite runs through an oracle
transport into the fixture client, not against a real Postgres — so no
test anywhere in this repository actually executes 011's real `RAISE`
path for `DIFF_CHANGED`. That is precisely what the first hosted-mode run
after 014 is applied is for; a green conformance suite here is necessary
but not sufficient evidence the database-side guard fires correctly.

**014–017 author-reported execution findings** (separate from the D-012
security review above — these are the authoring lane's own notes, negative
results for the log, partially spot-checked):

- `app.require_tenant_id` was ungranted, so RLS policies errored instead of
  denying — confirmed directly in the PR #6 diff: "no policy in 001-013 used
  it — 014 is the first to grant it."
- `rule_set_versions` lacked its tenant index.
- `budget_status`/`model_tier_status` views were found ungrantable and
  deferred to 018.
- `SET LOCAL` was refused inside a non-volatile function.
- The `ADD CONSTRAINT IF NOT EXISTS` trap (a known Postgres footgun this
  spine has hit before) was hit a third time.
- Shim caveat: `pg_cron` and `pg_net` are stubs in the local shim, so 015's
  job _registration_ is pinned but _firing_ is unverified until hosted.
- Deferred: the pipeline seed moves to 018; tax/HRD rows are PROPOSED
  pending a Finance verifier; four retention reapers await approved policy
  rows; four AI-ops columns await a runtime vocabulary that doesn't exist
  yet. Codex second pass requested on 015–017 and on the earlier
  (001–013) pin edits — reported at the time as "nineteen," corrected
  below.

⚠ **PR #11 was rebased and grew substantially — confirmed via `gh pr
view 11 --json baseRefName`: base is now `cloud/migrations`, not `main`.**
Current figures, per the report: 30 RPCs, 3 views (`v_budgets`,
`v_model_tiers` under the names the client reads via `.from()`, confirmed
present in the diff, plus `v_organisation_relations` named alongside them
in a comment), 11 helpers, 228 assertions, forward/test/rollback/forward
clean on 001–017. Not independently re-run (needs the shim). Merges after
PR #6. Under review by `codex-review-018` (worktree
`~/Repos/personal-work/trainos-wt/review-018`, branch `review/codex-018`,
its own shim on port 5437) — `lane/rpc-018`'s own worktree is confirmed
shut down (gone from disk), with a separate detached-HEAD worktree
(`codex-018`) pinned to the same tip for the reviewer.

**018 (PR #11) findings, confirmed directly against the diff:**

- 23 of 24 `RPC_NAMES` implemented; `me_profile` (the 24th) is NOT
  implemented — confirmed in the migration's own comment: "the 24th name in
  `RPC_NAMES`... needs an HR table for eleven required fields." `check:rpc`
  0 BROKEN, `check:grants` OK, `lint:sql` 42/42 reported (not
  independently re-run). Shim rebuilt from `initdb` on port 5433 with a
  hand-written platform shim (four Supabase roles, `auth.*`, a storage
  stub, a realtime publication).
- **R-C resolved by verification, confirmed by grep**: `core.tax_policies`
  and `app.resolve_tax_policy` genuinely do not exist anywhere in 001–013,
  and 018 does not need them because `Quotation` carries no tax field.
- A real keyset-cursor bug was found by the pack's own pin, confirmed in the
  diff's comment: a `DESCENDING` sort took the array's `max` sort key for
  the next cursor, which under DESC is the wrong end of the page, so page
  two repeated page one's tail. Fixed and pinned.
- `SET CONSTRAINTS IMMEDIATE` fires nothing inside a PL/pgSQL
  subtransaction — replaced with an explicit read-back.
- `DEAL_CHAIN` is a contract pipeline object that 004's own CHECK constraint
  disallows (004 allows `ENGAGEMENT | OPPORTUNITY | PACKET`; the contract's
  `PIPELINE_OBJECTS` is `ENGAGEMENT | DEAL_CHAIN | OPPORTUNITY`) — confirmed
  directly, and the migration deliberately does NOT paper over it: "inventing
  an alias would hide a schema/contract disagreement that has to be settled
  in 003/004, not here," with a pin that fails loudly if the divergence is
  ever silently resolved.
- Doc 09's `search_path` pin was found to assert a string PostgreSQL never
  actually stores — this is exactly [[postgres-search-path-footgun]] from
  memory, the quoted-list form being a silent no-op.

**Five more findings from the rebase, confirmed against the diff:**

1. **014 and 018 both created the three action-envelope gate wrappers with
   different arity, confirmed exactly as described.** 014's signature is
   `(uuid, text, text, text, text)` (exposes `p_expected_diff_hash`); 018's
   original was `(uuid, text, text, text)`. `CREATE OR REPLACE FUNCTION`
   matches on the argument list, so the two did not replace one another —
   they became overloads differing by a defaulted trailing argument, which
   made every short call ambiguous (`PGRST203`), confirmed via the
   migration's own comment quoting the exact verify-time error: "core.
   decide_approval has 2 definitions, expected exactly 1." 014 keeps its
   five-argument version; 018 drops its own four-argument one
   (`DROP FUNCTION IF EXISTS core.decide_approval(uuid, text, text,
text)`), confirmed in the diff.
2. **017 left SST half-wired, confirmed exactly.** `core.quotations`
   gained `sst_rate` (defaults 0) and `sst_reason` (defaults
   `'STANDARD_RATED'`) as plain columns with no trigger behind them — 017
   itself flags this: "A missing policy must not silently become a zero
   rate: that is an invoice filed with no SST and no reason." 018's
   `put_quotation` now resolves the rate via `app.resolve_tax_policy` on
   write. The table-level fix (a trigger, so paths other than this one RPC
   are also covered) is routed to `fix-014` in PR #6, not done here.
3. `core.provenance.origin` is immutable at the schema level, confirmed;
   the contract's origin flip is therefore derived in the read projection
   rather than written to the row.
4. **Premise correction, confirmed by reading the script itself:**
   `npm run check:rpc` does NOT detect a missing RPC. Read directly:
   `scripts/check-rpc-contract.mjs`'s own header states its three checks
   are envelope shape (E1), forbidden casts (E2) and type source (E3) — it
   never reads `RPC_NAMES` and has no notion of "does this function
   exist." A missing function surfaces only as `PGRST202` at runtime.
   Recorded as a real gap: "check:rpc existence gate" added to the
   backlog.
5. ⚠ **Correction: the pipeline stage seed itself was NOT blocked — only
   `DEAL_CHAIN` specifically stays blocked, and finding 5 above
   overstated the scope.** Verified directly at PR #11's new head
   `fc9550c`: the seed shipped as a fourth AFTER INSERT trigger on
   `public.tenants`, `trg_tenants_z_seed_pipelines`, confirmed present in
   the diff and deliberately named to sort after 016's ref-format trigger
   alphabetically — resolving the ordering trap this thread previously
   flagged as a blocker rather than working around it. Ships with a
   backfill (36 rows over two tenants, 0 on re-run, per the report) and a
   new `T30` pin. Ids use the md5 expression this thread already recorded
   (the abandoned v5-if-uuid-ossp branch is confirmed dropped; `uuid-ossp`
   is confirmed never created anywhere in 001–017). **What remains
   genuinely blocked, confirmed narrowly**: only the `DEAL_CHAIN` pipeline
   object itself, because 004's own CHECK constraint still cannot store
   it — divergence 14.2 in the updated `docs/architecture/09` pins that it
   still cannot be inserted, confirmed present at that exact section
   number.

**PR #11 now confirmed at 7 files** (`docs/architecture/09`, the 018
migration, its rollback, `test_008`, `test_009`, `test_014`, `test_018`
— confirmed exact via `gh pr diff 11`), head `fc9550c`. Three of those
seven confirmed as real fixes, not incidental diffs: `test_008`/`test_009`
now seed `is_default = false` (018 seeds every tenant a real default
pipeline now, so a test-local one no longer needs the flag);
`test_009`'s engagement-creation query is confirmed to have carried an
**unconstrained cross join over `core.pipelines`** — with 018's seed a
tenant now owns three pipelines instead of one, so without a predicate
the insert wrote three engagements and `RETURNING ... INTO` kept
whichever came last, meaning every downstream assertion measured an
arbitrary row; now fixed with the missing predicate, confirmed in the
diff's own comment describing exactly this mechanism. `test_014`'s exact
grant count moved `121 → 124`, confirmed via the diff's own comment
calling out the exact old and new numbers. `docs/architecture/09` gained
a full §14 section enumerating ten divergences between the RPC spec and
what 018 actually built, confirmed present, including 14.2 (`DEAL_CHAIN`,
above) and 14.10 (`core.me_profile()`, still unbuildable for lack of an
HR table, already tracked). The rollback drops the seed trigger and
deliberately keeps already-seeded rows, confirmed. `lane/rpc-018`'s
worktree confirmed shut down; both 018 reviewers (`codex-review-018` and
its detached-HEAD counterpart) re-pinned to `fc9550c`.

⛔ **PR #20 confirmed MERGED at `c7efb8a`** (`gh pr view 20`: mergedAt
2026-09-13T13:08:53Z, base `main`, one file —
`docs/reviews/2026-09-13-thermo-018.md`, review-branch rule held again).
**VERDICT: BLOCK on 018 at `fc9550c`**, confirmed verbatim. Severity
counts confirmed exactly: **5 Blocker, 5 High, 8 Medium, 6 Low.**

⚠ **Correction: the report's list of "5 blockers" mixed severities —
only two of the five items named are actually the doc's own Blockers; two
real Blockers went unmentioned entirely.** Read the doc's own B1–B5
headings directly rather than trusting the paraphrase, since this is a
safety-relevant migration review and severity level determines what
merges before what:

- **B1 (real Blocker), confirmed**: one 4,857-line migration holds five
  near-identical copies of one list engine
  (`list_enquiries`/`list_approvals`/`list_follow_ups`/`list_proposals`/`list_quotations`),
  confirmed via a diffed 25-line block where only two lines differ between
  copies. B1's own text explicitly says the duplication "has already cost
  correctness twice, in opposite directions — see H2 and H3" — i.e. the
  pagination bugs are cross-referenced FROM B1, not folded into it.
- **B2 (real Blocker), confirmed** — this is the "no catalog row for 018"
  item, correctly not labelled a blocker in the report's own "Pin honesty"
  framing but IS one in the doc: `migration-catalog.md` has no entry for
  018 at all, and `supabase/CLAUDE.md`'s own same-commit hard rule states
  a catalog entry landing later "fails the gate."
- **B3 (real Blocker), confirmed** — this is "`p_view` declared and never
  read," exactly as reported: `list_follow_ups`/`list_proposals`/
  `list_quotations` all silently discard a saved-view filter, confirmed
  via a concrete failing call (`list_proposals(p_view => 'SV-MINE')`
  returns every proposal in the tenant) and the file's own forbidden-case
  language at `018:869-872` about never ignoring a filter clause.
- **"Opposite pagination bugs" are NOT part of B1 — they are two separate
  HIGH findings, H2 and H3, confirmed by heading.** H2:
  `list_enquiries` counts after the cursor clause, so `page.total`
  shrinks per page. H3: the other four hand back a cursor past the end on
  an exact-multiple page. Real, confirmed, correctly described in
  substance — just misfiled as blocker-severity in the report.
- **"`regenerate_proposal_section` enqueues nothing" is H1, HIGH, not a
  Blocker, confirmed by heading**: "enqueues nothing, and says it does."
- **"`core.provenance` read without `tenant_id`" is M1, MEDIUM, not a
  Blocker, confirmed by heading and text** — and confirmed NOT reachable
  today: `subject_id` is always tenant-scoped upstream, per the doc's own
  words, which the report's framing didn't convey.
- **"pipeline backfill swallows an FK violation into a WARNING" is M5,
  MEDIUM, not a Blocker, confirmed by heading.**
- **Two real Blockers went unmentioned in the report entirely, and B4 in
  particular is safety-relevant to this whole migration line:**
  - **B4**: 018 edits 014's own pin, moving its exact grant-count
    assertion from `v_grants = 121` to `124` because 018 adds three view
    grants. Confirmed directly: applying 001–014 alone and running
    `test_014` now **fails** with `"expected 124 ... Found 121"` — 014's
    pin only passes once a LATER migration (018) has also been applied.
    This is a real regression this thread needs to track: once `fix-014`
    lands its own fix for 014's CRITICAL findings, that fix must not
    reintroduce or depend on this ordering problem.
  - **B5**: 018 has no transaction wrapper (`BEGIN`/`COMMIT`) on either
    the forward migration or its rollback — confirmed via `grep`, and
    confirmed every other migration in 014–017 does wrap. Matters because
    018 is not pure DDL: its tenant backfill loop can fail partway through,
    leaving helpers created, some RPCs created, some tenants seeded and
    others not, with no atomicity to fall back on.

✅ **Confirmed clean, verbatim from the doc's own "What is right" section
— these hold up and should not be lost if 018 gets rewritten:** tenant
scoping is disciplined (every join tenant-correlated, every read filtered
through `app.require_tenant_id()`, M1 the sole non-reachable exception);
no error is swallowed into `app.ok` (all 18 exception handlers traced,
the one swallow is M5 and lives in a `DO` block, not an RPC); the
rollback is inventory-correct (all 47 created objects dropped, nothing
from 001–017 destroyed, the one non-018 drop is signature-qualified and
confirmed cannot touch 014's five-argument function); yielding the three
gate wrappers to 014 rather than shipping a second copy is exactly the
divergence discipline CLAUDE.md asks for.

⚠ **Pin-honesty findings (H5), confirmed exactly, not just the summary
numbers:** 239 labelled assertions (not 228, which the doc notes is
actually 014's RLS policy count, mistakenly cited elsewhere); four
provably unfalsifiable (`T23g` compares a value to itself via a
GENERATED-column identity; `T30d` compares two distinct primary keys for
equality, which can never happen; `T14e` checks a code a prior line
already excluded; `T13i` filters against a fixture pattern matching zero
rows unconditionally); roughly thirty more pass vacuously because they
extract `-> 'data'` without first asserting `success`, so a refused call
(`NULL` downstream) takes the same branch as a passing assertion;
`get_proposal`/`get_quotation` confirmed never invoked by the pin at all.
**Negative result for the log: a pin's assertion count is not evidence of
coverage** — 4 of 239 could not fail under any input, and roughly 30 more
could not fail specifically on an error response, and the count alone
would never have surfaced either.

**Lane `fix-018`** (Opus, worktree
`~/Repos/personal-work/trainos-wt/fix-018`, branch `fix/018-review`, its
own shim — port reported as 5438, not independently verified) confirmed
active on `lane/rpc-018`, tip `fc9550c`. The Codex 018 report folds in
when it lands.

⛔ **PR #21 confirmed MERGED at `3fb8ea8`** (`gh pr view 21`: mergedAt
2026-09-13T13:11:43Z, 35 additions/2 deletions, one file — a follow-up
appended to the same thermo-018 review doc). **018's verdict is now 6
Blocker, 5 High, 8 Medium, 6 Low** — confirmed exactly in the doc's own
updated severity table. **New Blocker B6, confirmed word-for-word against
the doc**: the 018 pipeline seed is not rollback-reversible. The rollback
deliberately keeps the seeded `core.pipelines`/`core.pipeline_steps` rows
because `core.engagement_step_states` carries composite foreign keys onto
them and the seeds lane's fixtures share the derived ids — a good reason,
confirmed — but the consequence is that rolling back 018 does not and
cannot restore the prior state: `pipelines_one_default_uq` still rejects
a default `ENGAGEMENT` pipeline for every tenant afterward, and the
original 008/009 fixtures this PR had to edit stay broken in their
original form with no supported way back. **Pin `R4` claims to assert
exactly this and doesn't**: its own comments say "what stays is the DATA,
and R4 asserts exactly that," but R4's actual body only queries
`pg_trigger` for 016's trigger and never reads `core.pipelines` or
`core.pipeline_steps` at all — confirmed directly, the same
overclaiming-comment pattern as H1 and H5. Ruling, confirmed routed to
`fix-018`: record the seeded ids and make the rollback delete exactly
those rows when unreferenced, refuse loudly otherwise; make R4 assert the
real rows rather than a proxy trigger check.

⚠ **Process note, recorded as reported — a fleet-operations incident, not
independently verifiable from git history.** A reviewer's worktree was
removed while it was still amending; it recovered because the branch had
already been pushed, so no work was lost, but the near-miss is worth a
standing rule: **never prune a worktree before its lane has confirmed
shutdown**, regardless of how idle it appears.

⛔ **PR #22 confirmed MERGED at `279edc3`**, one file —
`docs/reviews/2026-09-13-codex-retrofit-018.md` — an independent review
plus the actual G6 execution the static thermonuclear pass never ran.
Reviewed at the same tip, `fc9550c`. **VERDICT: BLOCK, agreeing with the
thermo report, and all 6 Blockers independently confirmed** with fresh
`fc9550c` citations rather than trusted from the earlier report — headings
confirmed present for all of B1–B6, each marked "CONFIRMED."

✅ **G6 confirmed run for real this time**: 18/18 pins pass on a full
reset-and-apply, and pass again through a rollback→reapply→pin cycle,
twice. **Confirmed explicitly, and worth repeating verbatim: this does
NOT clear B1, B3, H2, H3 or H4** — the doc's own words: "the pin suite's
fixtures are too narrow to have ever caught B1/B3/H2/H3/H4 on their own."
Execution passing is not the same claim as the code being correct.

⚠ **Two genuine nuances found by executing rather than just reading,
both confirmed exactly and both important not to over-simplify:**

- **On B4**: reproducing the claimed standalone `test_014` failure found
  it actually fails ONE ASSERTION EARLIER than the original report cited
  — at `T1a` (`v_pairs = 116`), not at the grant-count assertion. Tracing
  that number directly against `origin/cloud/migrations` at 018's own
  base commit (before 018 touches anything) found **the "116" figure
  already there — this specific failure predates 018 by one full pack**,
  introduced by 017's own amendment pass, and recorded in that pack's own
  catalog history. **This lowers the "018 introduced a new defect"
  framing but does NOT clear B4**: `test_014` genuinely still isn't a
  self-contained pin after either 017 or 018, and 018 additionally pushed
  the grant-count assertion further (121→124, the original citation) into
  a file it doesn't own, when it had the option of asserting its own
  three-grant delta inside `test_018` instead. Both things are true at
  once: an older, unrelated defect exists, and 018 made the same class of
  problem worse rather than fixing it.
- **On B6**: the reviewer independently ran the actual scenario rather
  than only reading it — inserted a real tenant, confirmed the trigger
  seeds 2 pipelines/16 steps, ran the rollback, confirmed the rows
  survive while the trigger and functions are dropped, confirmed a
  post-rollback tenant correctly gets zero pipelines. **The
  data-preservation design itself is empirically correct and is
  confirmed NOT a design defect** — keeping FK-referenced rows on
  rollback is the right call. The defect B6 names stands regardless: R4
  checks the wrong trigger (016's ref-format trigger, unrelated to the
  pipeline seed) and would not fire if a future edit broke the
  row-preservation behavior it claims to guard. Today's behavior is
  correct; the safety net for tomorrow is checking the wrong object.

**Codex slot confirmed still owed until 14 Sep 00:29, with named
priorities for the re-run, confirmed exactly**: the pipeline-seed
trigger/backfill/id-collision safety, and the ten client-derived RPCs
against `apps/web/src/shared/api/rpcClient.ts` — the doc states plainly
neither of the two static passes attempted either. `codex-review-018`'s
worktree confirmed shut down (gone from disk).

⛔ **PR #23 confirmed MERGED at `db0ec94`**, one file —
`docs/reviews/2026-09-13-codex-retrofit-014-rereview.md` — an Opus
thermonuclear + security re-review of 014's own fix commits (`d9834b7`
through `21ec975`), G6 executed comparing the OLD (`826bb52`) and NEW
(`21ec975`) SQL directly. **VERDICT: MERGE-WITH-FIXES.** Both original
CRITICALs confirmed genuinely closed by execution (G6 ran the actual
DELETE attack against both databases: succeeds on OLD, refused `42501` on
NEW; the rollback reproduces 002's five-table grant set verbatim,
confirmed by a full round trip including a 017-applied refusal). Codex
`gpt-5.6-sol` still hard quota-blocked until 00:29, recorded as OWED, not
substituted — matches the gate's own rule.

- **New HIGH (N-1), confirmed exactly against the doc: `run:read` governs
  seven `core` tables in 013** (`runs, run_nodes, run_node_io, run_events,
run_state_cards, run_checkpoints, run_snapshots`), and this fix pack
  gates only one. `run_state_cards` is confirmed worse than the gated
  table — its own 013 header concedes it skips the 30-day redaction
  sweep `run_node_io` gets. **Not a regression** — the gap existed at
  `826bb52` too, and the original review only named the one table it
  happened to check — but the catalog's "deliberate posture" framing
  (confirmed present: `110 of 113 core tables keep blanket tenant-scoped
SELECT; run_snapshots, run_state_cards and run_events are the same data
class as run_node_io and are NOT gated`) is a provenance argument, not a
  security one. Routed to `fix-014`.
- **Two defects found only by running the pin, not reading it, confirmed
  directly:** (1) **T11a is a tautology** — it `REVOKE`s DELETE at line
  975 then asserts the absence of that same privilege one statement
  later, so it still passes against the original, defective `826bb52`
  database; only T11b (the behavioral delete attempt) actually catches
  CRIT-1, meaning the pin has one working detector, not the two it
  believes it has. (2) **The pin's own header contradicts its own
  assertions**: line 5 says "run against the complete 001-014 set," but
  lines 235/258 assert counts (116 policy pairs, 121 SELECT grants) that
  only a 001-017 database produces — confirmed by G6 running the pin
  against a clean 001-014-only stack exactly as instructed and getting an
  immediate `T1a FAIL: ... found 113`. Not this review's error — the
  file's own, still open.
- **Corroboration across independent lenses, confirmed present, not
  claimed:** a separate thermonuclear-lens pass (structural/maintainability,
  its own BLOCK verdict on structural grounds only) landed on some of the
  same coupling from a different angle — F5 independently found the same
  `polqual`-only gate-detection gap N-11 (security pass) already named;
  F1 and F8 are new structural findings (policy-comment stamping
  ownership split between 014 and 017; the 017-applied rollback refusal
  hardcodes one table name rather than a generic later-migration check).
- **Could not verify, confirmed stated in the doc's own words, worth
  keeping on record rather than silently dropped:** migrations 003, 005,
  006, 008, 009, 010, 012 were not re-verified line-by-line beyond what
  014 touches, so whether other `run:read`-style permission/table
  mismatches exist elsewhere in the pack is still open; frontend/worker
  consumers of the changed grant/policy shapes were not traced (Codex's
  specific brief, still not run).

✅ **`fix-014` pushed 015–017's fixes to `origin/cloud/migrations`, tip
`bdd49aa`** — confirmed present on the remote, NOT yet a PR/merge to
main. Closes the assigned findings from
`docs/reviews/2026-09-13-codex-retrofit-015-017.md` (PR #18's review).
**015 MERGE-WITH-FIXES, 016 and 017 BLOCK, closed**, confirmed against
the commit body:

- **015**: explicit `DROP FUNCTION` before `CREATE`, an exact overload
  assertion, a `to_regprocedure` check on the signature the cron command
  actually calls (T6). **Premise corrected, confirmed word-for-word**:
  the finding said the trap "fails invisibly with a green-looking cron
  table" — measured instead that 015's existing command check ALREADY
  aborts (`to_regproc` returns NULL for an ambiguous bare name), just
  with a misleading error pointing at the wrong cause; the real exposure
  is a LATER migration adding the overload.
- **016**: the rollback's unqualified `DELETE FROM core.ref_formats WHERE
NOT EXISTS (allocated)` is now scoped to rows matching 016's own
  `pg_trigger` derivation (prefix, entity, width); confirmed
  end-to-end that a hand-configured format survives a real rollback that
  removes all 32 seeded rows. A preflight now refuses rolling 016 back
  while 017 is applied, same reasoning as 014's. T7 pins it.
- **017**: (a) **CRITICAL SST fixed** — the NOT NULL DEFAULT
  `sst_rate=0`/`sst_reason='STANDARD_RATED'` pair is gone, replaced by a
  BEFORE INSERT OR UPDATE trigger resolving from policy plus a guarded
  backfill that refuses rather than guesses for quotations older than the
  earliest policy; T11 pins six behaviors. (b) The NOT VALID/VALIDATE
  lock-safety claim was false (one transaction, ACCESS EXCLUSIVE held to
  COMMIT) — corrected to an honest statement of the real lock window;
  **not split, recorded as owed** (a change to the pack's shape). (c) The
  unguarded `VALIDATE` on `evaluation_responses_overall_score_range` now
  counts and refuses first, naming the count and highest value, rather
  than aborting mid-flight. (d) The rollback's false "none is customer
  data" claim is corrected — a guard now counts and refuses if
  `core.data_breach_register` (a statutory PDPA s.12B register),
  retention policies, consent purpose, or the SST columns are non-empty.
  (e) T3b/T5b, confirmed previously never executing (empty fixture table,
  `IF FOUND` silently false) now run against a named nine-row fixture
  chain and assert the actual arithmetic, not just non-nullity.
- **Finding #19 closed via a registry, confirmed**: `app.tenant_seed_checks`
  (new in 016), seeded with 011's and 016's expectations and consulted by
  `app.provision_tenant`'s completeness guard; 017 registers its own
  check-key seed beside its trigger; 018 will add a row, not an edit. T12
  pins it by disabling 017's trigger and proving provisioning is refused.
- **Finding #5 closed**: the three new tables (confirmed: RLS assertions
  added via T13, reading `core.data_breach_register` directly as
  `authenticated` with another tenant's claims, requiring zero rows) —
  the prior cross-tenant probe went through a definer function as owner,
  proving that function's filter, not the policy.
- **Second premise correction, confirmed word-for-word**: the review's
  post-rollback policy count claim (`< 220`, "228 minus six should leave
  222," recommending `<> 222`) is wrong in both directions — 014 leaves
  228, 017 takes it to 234, rolling 017 back returns to 228. Now derived
  from the catalog so it tracks later packs automatically.
- **Deliberately not done, confirmed as an open item, not silently
  dropped**: 017's single 1,340-line transaction was not split (a
  pack-shape change, recorded as owed). **The original review's finding
  #2 — 016's hardcoded `dated` flag list for entities that can't derive it
  conflicts with `docs/architecture/01-domain-model.md` on several
  prefixes (`OPP`, `FUP`, `ENG`, `SES`), and refs are immutable once
  allocated, so a wrong value is permanent per tenant from day one — was
  explicitly left for a HUMAN ruling, not fixed.** The original review
  itself flagged this as "not independently confirmed by the security
  pass" and worth a manual re-check given the severity of getting it
  wrong; added to the user's pending decisions below rather than resolved
  by this thread.
- **Validation counts, confirmed exactly against the commit's own
  numbers**: 18/18 forward apply from a dropped database, 17/17 pins pass
  (the post-rollback pin correctly refusing while 017 is applied still
  counts as a pass), rollback 017→014 clean, post-rollback pin R1-R4
  pass, re-apply clean, 17/17 pins pass again, `lint:sql` 52/52,
  `check:grants` 0. `test_014`'s own grant-count assertion confirmed
  unchanged at 121, matching PR #23's own G6 citations above. The
  `check:grants` `pg_temp` exemption (from `fix-014`'s earlier 014 work)
  confirmed still present on this tip.

**Re-review of 015–017 against `bdd49aa` reported dispatched** — not yet
independently confirmed by this thread; a report to verify.

⚠ **New pending decision for the user, not resolved here**: 016's
hardcoded `dated` prefix flags (`OPP`, `FUP`, `ENG`, `SES` and others)
conflict with the domain model on whether those entity types can derive
a date; refs are immutable once allocated, so getting this wrong ships a
permanent per-tenant defect from day one. Needs a human ruling against
`docs/architecture/01-domain-model.md`, not a lane decision.

⛔ **PR #24 confirmed MERGED at `b9bca03`**, one file —
`docs/reviews/2026-09-13-codex-retrofit-011-013.md` — an Opus
thermonuclear + security review of migrations 011–013, at commit
`e20e1ba` on `origin/main`. **011–013 confirmed already on `main`**
(their migration files exist there directly, not gated behind a PR like
014–018) — the SQL itself is live on the default branch today, even
though nothing has been applied to any hosted project. **VERDICT: BLOCK.**
Codex `gpt-5.6-sol` did not land (killed ~1 minute in on the first
attempt, no retrievable output on the second) and is recorded as owed
until 14 Sep 00:29, not substituted; the two Opus passes ran
independently and were disjoint on 30 of 32 raw findings, confirmed
exactly against the doc's own count.

- **Severity count correction, confirmed directly against the findings
  table rather than the doc's own headline framing: the table holds
  3 CRIT, 7 HIGH, 13 MED and 5 LOW (28 rows total), not the "2 CRIT, 4
  HIGH, 9 MED, 5 LOW" first reported.** The verdict's own prose
  headlines only two CRITs as "confirmed by live execution," which is
  accurate on its own terms, but a third row (**T1**) is independently
  CRIT-severity in the same table and was left out of the summary
  entirely: `app.replay_dead_letter` copies `effect_id` onto a
  replacement job after the original dead-lettering already marked the
  effect `DEAD_LETTERED`, so `report_effect_result` on a _successful_
  replay hits a silent no-op guard and the invoice stays recorded as
  permanently failed in the ledger with no way to correct it later —
  static-only (thermo pass, not independently executed), but genuinely
  CRIT and genuinely a live-production risk, not a lesser one just
  because execution didn't confirm it this pass.
- **The two CRITs independently reproduced live, confirmed exactly**: (1)
  nothing anywhere outside the test pin calls `app.enqueue_effect_jobs`
  — every external effect (email, invoice push, reminder, broadcast) is
  written `DISPATCHED` and never enqueued, confirmed by a repo-wide grep
  across `apps/`, `packages/`, all migrations and rollbacks. (2) BYOK key
  rotation is permanently blocked on exactly the key that was just
  revealed — reproduced live (set → reveal → rotate on the same
  `provider_ref` raises `42501 REVEAL_AUDIT_REQUIRED` forever), because
  the reveal-audit trigger's short-circuit doesn't recognize a rotate
  (timestamp → NULL) as distinct from a bare reveal. Neither is exercised
  by the existing pins, which is why "all pins pass" does not contradict
  either finding.
- **HIGH-1, confirmed exactly**: `app.has_permission` is called exactly
  once in all of 011 (inside `decide_approval`); on the HUMAN path, if no
  `core.action_policies` row matches, dispatch falls through to bare
  `EXECUTING` with no permission check at all — reachable today for
  several action types with no policy row (`ENQUIRY_ARCHIVE`,
  `OPPORTUNITY_CONVERT`, `TNA_RECOMMENDATION_ACCEPT`), and 014's wrapper
  does no re-validation on top.
- **Six more HIGH findings not in the original summary, confirmed
  present in the table**: a worker heartbeat that shortens rather than
  extends the effective lease, risking a double-send under load; a
  `bulk_decide` response shape the web contract can't actually parse
  (`results` silently `undefined`); an approval diff-hash guard that
  hashes only immutable columns, so `DIFF_CHANGED` can mathematically
  never fire; `service_role` execute-grant exposure on the BYOK
  functions that can't be confirmed or ruled out on this local harness
  (Supabase's platform bootstrap isn't modeled); every 013 authorization
  refusal raising the wrong error code class, rendering as a session
  expiry instead of a permission refusal to the web client; and an
  idempotency hash omitting the AI confidence/reasoning/evidence fields,
  so a downgraded-confidence retry silently inherits the original
  high-autonomy execution.
- **Catalog/pin-honesty findings, confirmed live rather than trusted**:
  the 012/013 pins genuinely require 014's grants applied, contrary to
  the catalog's "001–013" claim — confirmed by the orchestrator running
  `test_012`/`test_013` against 001–013 alone first (both failed for
  exactly this reason) before passing cleanly once 014 was applied,
  matching this thread's own earlier finding of the same pattern in
  014's own pin. The catalog's "twenty-seven functions" claim for 011 is
  also wrong; 28 is confirmed correct three independent ways (header,
  revoke list, and 011's own `$verify$`).
- **Explicitly checked and confirmed clean, worth keeping on record**:
  the 011/014 envelope seam (011's raw jsonb, wrapped by 014's `app.ok()`
  calls) is a genuine, intentional, correctly-implemented design, not a
  defect the catalog undersells; 013's BYOK secrecy mechanism (no raw key
  material ever returned, the 24-hour reveal ceiling is a real UPDATE
  predicate, not check-then-act); all `search_path=''` pins hold exactly
  (011 28/28, 012 31/31, 013 29/29); anon/authenticated EXECUTE grants
  confirmed live via `has_function_privilege` on both the gated and
  ungated sides.
- **Could not verify, stated in the doc's own words**: the FORCE-RLS/
  definer degradation direction is unmeasurable in any local harness (the
  local superuser bypasses RLS, so no execution can confirm which of
  roughly 80 definer functions would degrade open vs. closed on a real
  Supabase project); `app.aal2_verified`'s behavior against a real
  GoTrue-managed `auth.sessions` could not be confirmed against the
  harness's hand-built stub.
- **Fixes reported routed to `fix-014` as in-place amendments on
  `cloud/migrations`, then re-review** — not independently confirmed by
  this thread yet, consistent with how 014–017's own fixes have been
  handled all session. **001–013 confirmed applied to no hosted
  project**, consistent with every prior check this session; hosted
  apply for this whole migration line stays gated on PR #6's eventual
  clean verdict.

✅ **`fix-014` pushed two commits addressing PR #24's 011–013 findings to
`origin/cloud/migrations`, tip `0d9e00c`** (via `2bac9bf`) — confirmed
present, not yet a PR. Every fix reproduced live first, each with a pin
confirmed to fail against the pre-fix SQL:

- **CRIT-1 (T2/O2) fixed, confirmed exactly**: `app.apply_effects` now
  calls `app.enqueue_effect_jobs`, with an explicit existence check so
  an 011-without-012 database gets a stated error rather than "function
  does not exist." T16 confirmed to walk the whole seam — perform,
  approve, then CLAIM the job as the worker actually would, on the
  reasoning that a row the worker can't take is the same outage one
  indirection down.
- **CRIT-2 (S1) fixed, and confirmed WORSE than the original review
  found — a genuine severity escalation, not a restatement.** Fixing the
  reveal-audit trigger's short-circuit exposed a second, independent
  blocker the review never found: `key_fingerprint` sat in the table's
  own frozen-column set, so rotation's `key_fingerprint = p_fingerprint`
  raised `IMMUTABLE_COLUMN` for **every** key, revealed or not — BYOK
  rotation had never succeeded once, for any key, not merely on
  previously-revealed ones as the review believed. Confirmed as an
  internally-inconsistent frozen list too: `key_ref`, the other half of
  "the material changed," was never frozen. Now the fingerprint may
  change only when `key_ref` changes in the same statement, pinned by
  T14.
- **T1 fixed (third CRIT, confirmed, on top of the two already
  known)**: `app.replay_dead_letter` copies `effect_id` onto the
  replacement job after the original dead-lettering already moved that
  effect to `DEAD_LETTERED`, and `app.report_effect_result` returns
  early, silently, on `SETTLED`/`DEAD_LETTERED` — so a genuinely
  successful replay was recorded as a permanent failure, uncorrectable
  later since `PARTIALLY_FAILED` reconciliation is guarded
  `AND status='EXECUTING'`, a state the action had already left. The
  replay now reopens the effect to `DISPATCHED` and clears `last_error`
  first.
- **HIGH-1 (T3) fixed, confirmed exactly, with a real negative result
  worth keeping precise.** Measured directly: 19 of 22 action types have
  a policy row; three (`ENQUIRY_ARCHIVE`, `OPPORTUNITY_CONVERT`,
  `TNA_RECOMMENDATION_ACCEPT`) had none, so the no-policy fall-through
  was their only path. `app.action_types` gains `required_permission`
  for all 22, checked for HUMAN/CLIENT actors (agents are governed by
  the autonomy grant instead) immediately after the action type is
  known. **The first version of this check ran AFTER payload
  validation, and the pin itself caught the leak**: an unauthorized
  `SALES` probe of `PAYMENT_RECORD` came back with the action's own
  payload schema (`{"field":"amount","reason":"REQUIRED"}`) — a
  refusal that handed the caller information about an action they had
  no right to attempt. `T17c3` now pins that the refusal leaks nothing.
- **S5 fixed, confirmed exactly**: all thirteen of 013's `42501`
  authorization refusals now raise `TRNOS` instead, closing the
  session-expiry misrender the original finding named — confirmed two
  raises deliberately keep `42501`, with the file stating why: those two
  guard against a direct table write, not a caller, and no RPC path
  reaches them.
- **S3 fixed, with the confirmation gap stated rather than
  claimed.** `service_role` is now in the revoke list for the five BYOK
  functions. Confirmed directly in the commit's own words: this cannot
  be proven on the local shim (no Supabase `ALTER DEFAULT PRIVILEGES`
  bootstrap, so `service_role` holds no EXECUTE either way, pin
  identical before and after) — the fix is correct regardless, but
  hosted confirmation is recorded as owed, not claimed as verified.
- **S7 fixed, confirmed exactly**: both pin headers now state the
  001–014 dependency as a dependency **of the pin**, not of the
  migration — 012 and 013 themselves apply and verify cleanly with
  nothing after them, confirmed as the precise distinction the catalog
  needed.
- **T8 folded in**: `app.effect_applier` is now cleared at the end of
  `apply_effects`, closing a real residue risk inside `bulk_decide`'s
  loop. Catalog corrections folded: 011's function count corrected to
  28 (confirmed three ways already by PR #24's own review), catalog rows
  for 011/012/013 carry an amendment note.
- **Deliberately deferred rather than silently dropped, confirmed by
  absence from both commits' diffs (neither touches `apps/**` or
  `packages/**`)**: `bulk_decide`'s response-shape mismatch (T4/F4,
  needs a web+SQL change together), the worker heartbeat lease bug (S4,
  lives in `apps/worker`), and whether 013 stays without consumers (T11,
  a product ruling, not a migration fix) — routed to the backlog. **T5's
  diff-hash guard (`DIFF_CHANGED` can never fire) is routed to
  `fix-014` now**, confirmed as an active item rather than deferred.
- **Validation counts confirmed exactly**: 18/18 forward apply from a
  dropped database, 17/17 pins pass (post-rollback pin correctly
  refusing counts as a pass), rollback 017→014 clean, R1–R4 pass,
  re-apply clean, 17/17 pins again, `lint:sql` 52/52, `check:grants` 0,
  `check:rpc` 4 pass/0 broken.
- **Re-review reported dispatched** — not yet independently confirmed by
  this thread.

✅ **`fix-014` pushed a fold-in of PR #23's re-review items to
`origin/cloud/migrations`, tip `ff01f2b`** — confirmed present, not yet
a PR. Closes N-1, N-8, N-9, F1, F3, F5, T11a's tautology, the pin header
range mismatch, and HIGH-4, confirmed against the commit body:

- **N-1 closed in full, confirmed against the diff's own `VALUES`
  list**: all seven `run:read`-governed tables (`runs`, `run_nodes`,
  `run_node_io`, `run_events`, `run_state_cards`, `run_checkpoints`,
  `run_snapshots`) are now gated, not just `run_node_io` — confirmed
  directly in the migration's own gate-registration block. Together with
  the two tables HIGH-1's earlier fix already gated under their own
  permissions, **nine tables across three permissions are now gated
  total**, matching the commit's own count. The catalog no longer calls
  the remaining blanket-SELECT tables a "deliberate posture"; it now
  states plainly, confirmed word-for-word: "the rest is a gap, not a
  posture."
- **T11a's tautology closed, confirmed exactly**: the assertion now
  reads the shipped privilege set into a variable _before_ any
  GRANT/REVOKE in the file runs, rather than checking privilege state
  after the pin's own probe already mutated it — confirmed this closes
  precisely the failure mode PR #23 found (the assertion passing even
  against the unpatched database).
- **Pin header range corrected**: now states explicitly why the
  migration header's own 001–014 figures and the pin's 001–017 figures
  are both correct, rather than one silently contradicting the other.
- **Structural fixes, confirmed against the diff**: policy-comment
  stamping now takes `p_migration` as a required argument rather than
  caller-supplied prose (closes F1's split-ownership finding — 017 now
  passes `'017'` explicitly). `'UNGATE'` the magic string is replaced by
  a named function, `app.ungate_tenant_policy()` (closes F3), with gate
  detection now reading both `polqual` and `polwithcheck` (closes F5).
  T16 now exercises six branches, confirmed via the diff's own updated
  pin text.
- **Negative result for the log, confirmed word-for-word from the
  commit body, worth keeping verbatim: "two dead escapes on one control
  in one night."** `app.ungate_tenant_policy()`'s first version had the
  same class of bug as the `'UNGATE'` string it replaced — it called
  back into the very refusal it exists to bypass, so it was dead on
  arrival too, found only by running it. Fixed by dropping the gated
  policy first rather than routing through the refusal path.
- **HIGH-4 closed on both sides, confirmed exactly**: PR #17 (already
  merged to main) made the client always send `p_expected_diff_hash`;
  `core.decide_approval` now refuses an APPROVE that carries no hash at
  all (`T15c` flipped from asserting the old defect to asserting the
  refusal), and `T15d` confirms a REJECT without a hash still works, so
  the fix didn't overcorrect into "no decision without a hash ever."
- **N-9 closed**: `apply_tenant_policies` now refuses a permission every
  role holds (would have let `dashboard:read` be accepted as a no-op
  gate) rather than only checking the permission exists.
- **N-8 narrowed rather than fixed, confirmed stated as such**: the
  share-token gate restores only the role half of 002's intent; adding
  the scope half needs an owner column `007` never gave the table
  (`created_by_id` is text, not a user id) — a schema change, stated in
  the file and catalog with an owner rather than silently left as a
  loose end.
- **Correction, confirmed and worth recording rather than silently
  reconciling**: an earlier report characterized 015–017's fix slices as
  "still open" — this thread had already independently confirmed those
  slices landed in `bdd49aa` two updates ago, so this was a crossed
  message on the reporting side, not new information requiring a spine
  correction.
- **Validation counts, confirmed exactly**: 18/18 forward apply, 17/17
  pins pass (post-rollback pin correctly refusing counts as a pass),
  rollback 017→014 clean, R1–R4 pass, re-apply clean, 17/17 pins again,
  nine gated tables measured, `lint:sql` 52/52, `check:grants` 0,
  `check:rpc` 4 pass/0 broken. `test_014`'s grant-count assertion
  confirmed unchanged at 121.
- **Next on `fix-014`, reported: the 011–013 amendments** (PR #24's
  findings) — not yet independently confirmed by this thread.

✅ **`fix-018` pushed a fix pass to `origin/lane/rpc-018`, tip `5612e65`**
(PR #11's own body, section "Review fixes — thermonuclear BLOCK
cleared") — confirmed against seven commits on top of `fc9550c`, closing
every finding from PR #20's thermo review with a pin that is confirmed
to fail against the pre-fix SQL before it passes:

- **B1/H2/H3 fixed (T31, `9530e5b`)**: the five list RPCs' opposite
  pagination bugs are closed by two extracted shared helpers
  (`app._keyset_scope`, `app._next_cursor`) all five now call, confirmed
  via the quoted pre-fix failure text (`page.total shrank across pages:
4 then 2`). **A second, real defect found only by the pin, not the
  review**: `list_follow_ups` used bare column names against a
  three-way join where two joined tables both carry `id`/`status`/
  `created_at`, so any paged or status-filtered call raised `column
reference "id" is ambiguous` — a 500, latent only because nothing had
  ever paged that list before.
- **B3 fixed (T32, `efe87d4`)**: confirmed via the quoted pre-fix probe
  (`list_proposals(p_view=>...)` returning every tenant row, silently,
  with nothing in `appliedFilters` to say the view was ignored — exactly
  the failure the file's own §5 forbids). `list_enquiries` and
  `list_approvals` gained the object gate too, confirmed they lacked it
  before (an `ENQUIRY` view resolved against `list_approvals` and
  applied enquiry filters to approval columns).
- **H1 fixed (T33, `67ace2d`)**: confirmed via the quoted pre-fix
  failure — `regenerate_proposal_section` wrote a `RUNNING` run and
  enqueued nothing, forever. Routed through 012's event path
  (`app.emit_event` → a new `app.event_subscriptions` row) rather than
  011's action envelope, confirmed as a deliberate scope call: 011's
  planner has no action type for this and 018 may not add one without
  editing 001–017. `REGENERATE_NOT_ROUTED` now refuses if the enqueue
  didn't land, so a disabled routing row can't silently return 200 on
  nothing again.
- **M1 fixed (T34, `fdc937b`)**: confirmed via the quoted pre-fix
  cross-tenant read. **New finding, filed for the pack that owns §17,
  not 018's to close**: `core.provenance.subject_table`'s FK'd allowlist
  does not contain `approval_requests`, so `get_approval`'s
  `modelAgreement` jury badge can match no row on any database as
  shipped — the §17 badge is unreachable, not merely unpinned.
- **M5 fixed (T35, `5f02f5a`)**: confirmed via the quoted pre-fix log —
  a tenant the backfill couldn't seed was left with zero pipeline
  configuration while the migration printed `018 completed` as if
  nothing were wrong. Now a function (not an inline `DO` block, since an
  assertion about a `DO` block's own behavior can't be written) that
  visits every tenant before raising once, naming every tenant it
  couldn't seed.
- **B2 and B5 fixed (`5612e65`)**: the same-commit catalog rule and a
  transaction wrapper on both forward and rollback, confirmed present.
- **H5/M8 fixed (`3abf572`)**: four provably-unfalsifiable assertions
  replaced with the assertion each was reaching for, confirmed via the
  diff's own before/after table; the vacuous-pass class closed
  structurally by routing all extraction sites through one helper that
  raises on a non-success envelope.
- **H4 fixed then superseded, confirmed exactly**: `put_quotation`'s tax
  rewrite is fixed to run only when needed, but `cloud/migrations`'
  017 has since grown its own `trg_quotations_resolve_sst` trigger — the
  better half of the same fix — so 018's check is now "does the trigger
  exist," not a version check, confirmed as deliberate given the branch
  is unrebased against two different 017s.
- **M2, M7 explicitly deferred rather than silently dropped**: M2 needs
  a 002 change outside this pack's non-goals, filed against that lane;
  M7 is a refactor of a 311-line writer's whole validation loop, not a
  defect fix.

⚠ **M4 measured with a number attached, confirmed exactly against the
PR body's own table — the blast radius is larger than the original
review could see, because `origin/cloud/migrations` moved past this
branch's base.** Applying 018 on top of `cloud/migrations`' current
014–017 turns **four** currently-green pins red, not the two this
branch already amends: `test_008` and `test_009` (already amended here,
against their older versions — will need re-checking against the
current ones), plus **`test_016` and `test_017`, newly affected and
outside this branch's stated scope**, both failing on
`pipelines_one_default_uq`. **RULING, recorded here as a decision being
made now, not yet implemented in code — no `019_*` file exists anywhere
in the repo as of this check**: the per-tenant pipeline seed leaves 018
and becomes its own pack, `019_pipeline_provisioning` (trigger,
backfill, registry row, B6's rollback contract, and the four fixture
amendments), to be built in the same PR #11 lane going forward.

⚠ **B4 ruling, also recorded as a decision, not yet implemented**: 018's
current fix moves `test_014`'s own SELECT-grant count from 121 to 124,
confirmed explicitly flagged in the PR body itself as a rebase-conflict
risk against `fix-014`'s already-rewritten `test_014` (which still
expects 121, per this thread's own PR #23/`ff01f2b` entries above). The
ruling: **018 is not to edit `test_014` at all; `test_018` asserts its
own three-grant delta instead** — the same "don't edit a file you don't
own" principle `fix-014` already applied to 015–017's own amendments.

⚠ **Open discrepancy, confirmed present in the PR body's own validation
log, not resolved here — a question for `fix-014`, not an error to
correct on this side.** `fix-018`'s own run against `origin/cloud/
migrations`' current 001–017 (no 018 applied at all) reports
`PASS=16 FAIL=2`, naming `test_014` and `test_014_rollback` as **already
red** on that branch — timestamped after `ff01f2b`, this thread's own
most recent confirmation of `fix-014`'s "17/17 pins pass." Both claims
were independently true readings of what each lane checked; not yet
reconciled which pin, if either, is stale. `fix-018` has asked for the
exact failing text.

⛔ **PR #25 confirmed MERGED at `15eed1b`**, one file —
`docs/reviews/2026-09-13-codex-retrofit-015-017-rereview.md` — an Opus
thermonuclear + security re-review of the fix commit `bdd49aa`,
confirmed reviewed at that tip specifically, **not `ff01f2b`** — the doc
itself states plainly `git diff --stat 21ec975..bdd49aa` touches no
`014` file, so the three items from 014's own re-review (the `run:read`
gap, T11a's tautology, the pin header mismatch) are explicitly out of
scope here and marked pending, consistent with this thread's own record
that those landed separately in `ff01f2b`.

- **015 MERGE-WITH-FIXES, confirmed exactly**: the `DROP FUNCTION`
  guard genuinely works, proven by execution both ways (correctly
  pinned to the old signature, it catches a simulated future change;
  "kept in sync" per the file's own comment, it reopens the hazard).
  **But the new exact-overload-count verify assertion is dead code,
  confirmed directly**: an earlier `to_regproc`-based check in the same
  block always aborts first, with the same misleading message, whether
  zero or two overloads exist — the new assertion never runs. The file's
  own comment claiming it "earns its place... names the real cause" is
  confirmed false by execution, not just by reading. The mechanism that
  actually covers the real exposure is the new pin's T6, not this
  assertion.
- **016 MERGE-WITH-FIXES, confirmed exactly by execution on both
  arms**: the OLD rollback destroys an operator's hand-configured format
  and reports OK; the NEW rollback preserves it, preserves the allocated
  row, and deletes only the disclosed residue (a byte-identical
  hand-made row) — no more, no less. **Residual finding, confirmed
  present**: the rollback's own disclosure says the residue criterion is
  "prefix, entity, and dated," but the actual `WHERE` clause never
  checks `dated` — the disclosed residue is narrower than reality, and
  an operator row differing only in `dated` gets deleted contrary to
  what the file tells the reader. Also confirmed: the new
  `app.tenant_seed_checks` registry table has no RLS at all, unlike
  every comparable global `app` reference table in the repo — not
  exploitable today (schema-wide grants already block client access),
  but the one place this repo's own standard backstop was skipped.
- **017 BLOCK — NEW, caused by the SST fix itself, confirmed as the most
  consequential finding in this pass.** The CRITICAL SST defect is
  genuinely fixed (confirmed both arms: OLD code produces the
  zero-tax-no-policy-trace row, NEW code resolves a real rate/reason/
  policy reference on the identical insert). **But 017 cannot be applied
  to any database already holding a quotation row**: the new SST
  backfill's `UPDATE` queues two `DEFERRABLE` constraint triggers from
  migration 007, and the file's own new `SET NOT NULL` then refuses with
  `SQLSTATE 55006` while those triggers are pending, inside the same
  one-transaction file — reproduced twice, not transient. This breaks
  exactly the "retrofit onto a non-empty database" case 017's own header
  claims to support; re-applying onto an already-017 database works fine
  because the backfill matches zero rows.
- **A second, pre-existing wall found the same way, confirmed present
  since `21ec975`, not this fix's fault but blocking the same
  scenario**: `017:226`'s `pg_catalog.scale(margin_rate) > 4` guard
  checks a `GENERATED ALWAYS AS` numeric-division column, and Postgres
  numeric division always produces scale 20 regardless of actual values
  — so this guard fires on every non-null quotation, unconditionally.
  Confirmed both walls should be fixed together since they block the
  same scenario.
- **N-1 (HIGH), confirmed exactly**: the PDPA rollback guard's
  quotation sentinel is "any row where `sst_reason IS NOT NULL`," and
  this same fix pack makes `sst_reason` NOT NULL on every row —
  confirmed by direct execution that 015/016/017 now have **no rollback
  path at all** on any database holding a single quotation, without
  first deleting every quotation first.
- **N-2 (HIGH), confirmed exactly — the same false-header-claim class
  that hid the original CRIT-1, recurring a third time**: 016's header
  still claims "no table" despite creating `app.tenant_seed_checks`;
  017's header still says "two new functions" and names no trigger
  despite now having at least five functions and two triggers; the
  catalog still cites a stale `test_017` assertion count.
- **Both premise corrections re-confirmed by direct execution, not just
  re-quoted**: 015's original "fails invisibly" framing was overstated
  (the pre-fix verify block already aborted, just with a misleading
  message); 017's policy count is genuinely 234→228, not the original
  review's `<>222`.
- **Negative result for the log, this thread's own framing of the
  017 finding, not a verbatim quote — but the substance is confirmed
  directly in the doc's own words** ("this defect did not exist before
  this fix, it was introduced by it... the break is specifically the
  retrofit/non-empty-database case the file's own header argues it must
  support"): **a fix that passes clean on an empty shim can still fail
  on retrofit-onto-existing-data, and this is now true of two separate
  defects in the same file for the same reason.** Worth a standing rule:
  every pack that backfills existing rows needs its own pin that applies
  over a database already holding the rows it's backfilling, not only
  over an empty one.
- **Confirmed and worth keeping on record**: the new pin's T6 (015) and
  T7 (016) are confirmed to pass against BOTH the old and new code —
  they assert correct invariants but don't actually discriminate old
  from new, so they are not regression tests for the findings they cite,
  even though they're not wrong to have. 017's own T11 (the SST
  behavioral test) is confirmed the one genuinely discriminating
  regression test in this whole fix pack.
- **Routed to `fix-014`, confirmed as stated**; Codex still owed, not
  substituted.

⚠ **Operational note, reported and consistent with what this thread has
already independently confirmed about the `core` schema**: the user is
currently on the hosted project's Data API settings page. `core` cannot
be exposed there until migration 001 actually creates it — confirmed
directly, `CREATE SCHEMA IF NOT EXISTS core` is at `001:171` — and
nothing has been applied to any hosted project yet, per every check this
session. Advised: disable "Automatically expose new tables" before
anything is applied, since that setting would conflict with 014's own
explicit, narrower grants once 014 lands.

⚠ **Hard rule, confirmed baked directly into 018's own test file as a
runtime assertion, not just stated in a report:** every `core` table is
`ENABLE ROW LEVEL SECURITY` **and** `FORCE ROW LEVEL SECURITY` with **zero
policies** until 014's policies exist. FORCE removes the owner's RLS
exemption, so on any project whose definer-function owner is not
`BYPASSRLS`, every read in 018 returns ZERO ROWS **silently, as an empty
list, not an error** — until 014 is applied. The local shim's `postgres`
role IS a superuser, which is why 018's own pins all pass there regardless.
The migration's test file literally asserts this as its first check and
raises the notice **"018 MUST NOT be applied to a hosted project before
014"** if it ever detects a FORCE-RLS table with no policy. **This is the
single most important ordering constraint on the whole hosted-apply path.**
Follow-up slice requested for `lane/rpc-018`: PR #5's ten new RPC names,
rebase on `cloud/migrations`, and the pipeline stage seed.

⚠ **Found while double-checking this commit, not reported by any lane:
migration 014's actual SQL files are now sitting in the repo tree on
`main`, landed via PR #12 (the review), separate from and despite PR #6
being unmerged and BLOCKED.** `git show 02240e6 --stat` (PR #12's merge
commit) confirms it added `supabase/migrations/014_....sql` (949 lines),
`supabase/rollbacks/014_..._rollback.sql` (208 lines), and edited SIX
earlier test files (004, 009, 010, 011, 012, 013) — these were guessed at
the time to be the "nineteen edits to earlier pins" then reported; the
edit count itself has since been recounted three times to 14 hunks over
10 files (see the second D-012 pass below), so "nineteen" never was the
right number regardless of which six files these are. This is reasonable
as review evidence — the review needed the actual file
to run G6 against — but it means **014's file now exists on `main` even
though it is BLOCKED and PR #6 has not merged.** Nobody should read the
file's presence in `supabase/migrations/` as approval to apply it; the
BLOCK verdict above is what governs, not the file's location.

**Sub-item: seed schema gaps, tracked at PR #16 (see the SEEDS thread).**
The fixture-world seed lane found 22 schema gaps in 001–013 while writing
seed data against them — the clearest is a realised-margin column that
does not exist anywhere, needed for one below-floor fixture case. Full
list is in PR #16's own body; this is a pointer, not a duplicate.

**`cloud/migrations` resumed at the seeds lane's request, pushed `564dd64`
to add `p_id` to `app.provision_tenant`.** Confirmed directly against the
commit: `app.provision_tenant(p_slug, p_name, p_timezone DEFAULT
'Asia/Kuala_Lumpur', p_id uuid DEFAULT NULL)`, with an explicit `DROP
FUNCTION IF EXISTS app.provision_tenant(text,text,text)` in front of the
new `CREATE OR REPLACE`. **Negative result, confirmed word-for-word in the
migration's own comment:** the `DROP` is mandatory, not tidiness — a bare
`CREATE OR REPLACE` with a changed parameter list creates a second
overload rather than replacing the function, and both overloads would
then carry defaults covering a two- and three-argument call, so every
existing caller — including this pack's own test — fails with `function
app.provision_tenant(unknown, unknown) is not unique`. The migration's
comment states this was "measured on the shim before writing this line,
not assumed." A rollback also drops both the pre- and post-amendment
signatures, so a database rolled back and forward around the amendment
can't strand either overload. 4 new assertions in `test_016`: returned id
and stored row both carry the supplied value; supplying an id does not
bypass provisioning; explicit `NULL` still generates; a duplicate id is
refused by the primary key.

**018 scope grew 19:35+:** PR #5 (`cloud/web-swap`) found ten feature calls
with no `TrainOsClient` method and added them to `RPC_NAMES` in
`apps/web/src/shared/api/rpcClient.ts` without SQL behind them —
`patch_enquiry_extraction`, `list_follow_ups`, `get_follow_up_draft`,
`list_proposals`, `add_proposal_section`, `put_proposal_section`,
`regenerate_proposal_section`, `list_quotations`, `get_rate_card`,
`get_audit` (confirmed by diffing PR #5). `lane/rpc-018` has been told to
implement all ten in 018, marking each "spec derived from client" where
`docs/architecture/09` has no spec for it.

**Adversarial review running in parallel:** `codex-review-011-013` (Codex
gpt-5.6-sol xhigh via `codex-rescue`, worktree
`~/Repos/personal-work/trainos-wt/codex-011-013`, branch
`review/codex-011-013`) is doing the D-012 adversarial review of packs
011–013, writing to `docs/reviews/2026-09-13-codex-retrofit-011-013.md`.
Fallback order if Codex is unavailable: Kimi (not installed locally, so
effectively skipped), then a second Opus reviewer. Codex quota was reported
back as of a 19:29 probe (not independently verified here).

**`codex-review-014-017`'s review landed as PR #12, merged `02240e6` — see
the BLOCK verdict above.** The detached-HEAD worktree noted here two
updates ago was indeed that reviewer's own checkout, confirmed correct.

⚠ **Carried from the paused state, not re-verified this session.** Critic Part
2 (7 CRITICAL, 29 HIGH against 001–009 as of 2026-09-12) — whether 010–013
closed any of it is unconfirmed; recheck before 014 lands. `N-01`
(`pg_cron`/`pg_net`/`vector` extension enablement) and `knowledge_chunks.embedding`
(pgvector unavailable in the authoring environment, created conditionally with
a loud NOTICE on skip) were both still open as of the same date.

**Refs:** `supabase/HANDOFF.md`, `supabase/migrations/migration-catalog.md`,
`docs/architecture/01`–`06`, `apps/web/src/shared/api/rpcClient.ts`,
`docs/reviews/2026-09-13-codex-retrofit-014-017.md`, `D-102`, `D-111`,
`D-112`, `D-113`.

---

## 🟢 API-PHASE — PR #5 MERGED; hosted apply still gated on 014's D-012 review (2026-09-13)

⛔ **BLOCKER, confirmed directly, not taken on the report: GitHub Actions
has been unavailable on every branch, `main` included, since roughly
20:36–20:40 on 13 Sep.** Confirmed via the exact call given:
`gh api repos/PARALLELPARADIGMS/alex-project/check-runs/103725755232/annotations`
returns the literal message: "The job was not started because recent
account payments have failed or your spending limit needs to be
increased. Please check the 'Billing & plans' section in your settings."
Confirmed independently on the most recent push to `main`: every job
completes in 0–3 seconds carrying that same annotation, most never
starting at all (`0s`). `gh run list --branch main` shows the pattern
starting exactly around this window. Org billing endpoints need
`admin:org`, which the available token lacks — **this needs the user, in
GitHub's Billing & plans for `PARALLELPARADIGMS`.** Likely proximate
cause, worth noting rather than confirming: `Vitest (unit)` alone has been
running ~14 minutes per push across roughly twenty pushes tonight.

**Policy in effect until this is fixed, as instructed:** remaining merges
(#6, #11, #16, and any report PRs) proceed on the lane's own local gate
output plus an independent review verdict, each merge recorded with "CI
unavailable, billing" in the log rather than a CI check reference. PR #15
stays draft regardless — its own blocker (the Radix-menu test timeout) is
unrelated to CI availability and unaffected by this.

**PR #5 (`cloud/web-swap`) confirmed MERGED** at `3faa627` (`gh pr view 5`:
mergedAt 2026-09-13T12:10:20Z), found while verifying an unrelated report —
not announced separately by any lane. Enquiries → proposals → approvals are
now on main through the `TrainOsClient` seam, along with all the CI fixes
this thread tracked earlier (Prettier, timezone pin, artifact-quota
`continue-on-error`) and the ten new `RPC_NAMES` entries `lane/rpc-018` is
implementing. **Confirmed at merge time: 17 of 18 checks green** (`gh pr
checks 5`); the one red was npm audit (high+), and `CI Summary` itself
passed, confirming npm audit's `continue-on-error` genuinely kept it from
blocking. `Vitest (unit)` took 14m21s on the runner — confirmed exactly,
worth a follow-up on its own regardless of the audit question. The
`--omit=dev` scoping and the vite-7/vitest-3 draft PR mentioned earlier are
now real, separate PRs (see SUPABASE SCHEMA thread above for confirmation
of both).

**Resume:** Read `ai/resume-brief.md` BLAST 19:25 entry, then
`ai/briefs/2026-09-13-api-phase-plan.md` (rulings R-A..R-G). Two cloud lanes,
neither with a PR yet as of 19:25: `cloud/web-swap` (enquiries → proposals →
approvals swapped from `@trainos/fixtures` onto the `TrainOsClient` seam) and
`cloud/migrations` (014–017, tracked under SUPABASE SCHEMA above — do not
duplicate that thread here). The first hosted apply (L3) runs only after 014
passes `migration-retrofit-qa`, via the Supabase MCP's `apply_migration`
against `balzmmsmrawzmefkavte` (ap-southeast-1). Two known negatives to check
before assuming either lane's environment is ready: the `.env.local` the
api-phase plan references does not exist at repo root, and `pg_isready` on
`/tmp:5432` reports no shim running, so a migrations lane must start one per
`supabase/HANDOFF.md`.

**Scope:** The API contract layer and the web app's swap from fixtures to a
real client: `packages/contract`, the `TrainOsClient` seam in `apps/web`, and
the hosted Supabase apply path.

**State:** `cloud/web-swap` opened PR #5 (`refactor(web): enquiries, proposals
and approvals through the TrainOsClient seam`); `cloud/migrations` opened PR
#6 (`feat(supabase): migrations 014–017`); `ci/gitleaks` opened PR #7 (`ci:
run gitleaks binary directly, no license needed`). Hosted project
`balzmmsmrawzmefkavte` is ACTIVE_HEALTHY with zero migrations applied. Still
open for the user: `core` exposed in the dashboard (R-F, confirmed live —
see SUPABASE SCHEMA above), n8n in the proposal.

⚠ **PR #5's CI is not "green except Gitleaks,"** and the root cause is
upstream of PR #5 entirely — **five checks fail on main, not four.** Checked
directly against run 34753909066 (`9fdcb4d`) job-by-job: Gitleaks (license),
Prettier (drift check), Vite build (artifact-upload step only — the build
itself passes), npm audit (high+, 8 vulnerabilities: 5 moderate, 1 high, 2
critical), **and Vitest (unit)** — missed in the first pass through this run
and confirmed only now: five wall-clock/timezone-dependent test failures
(`DateText.test.tsx`, `ClientProposalPage.test.tsx`, `knowledge.test.tsx`,
`AttendanceCapturePage.test.tsx` ×2), all assertions written against a
Malaysian wall clock with the runner's timezone unpinned. None of the five
came from PR #5's own diff. PR #5 and PR #6 both inherit all five from main.

**Fix lane's naming mismatch resolved, and its work is now IN PR #5's own
history, not a separate branch.** The `fix-pr5` worktree (branch `fix/pr5`,
never `fix/main-ci` as first reported) committed three fixes that are now
part of `cloud/web-swap`'s own commit list, confirmed via `gh pr view 5
--json commits`: `fix(web): format check-barrels.mjs so the Prettier drift
gate passes`, `fix(web): pin the suite timezone so wall-clock assertions
stop depending on the runner` (confirmed: `apps/web/vitest.config.ts` now
sets `TZ: "Asia/Kuala_Lumpur"`, with a comment citing the same tenant
default used elsewhere in the schema), and `ci: stop a shared
artifact-storage quota from failing the build and test gates` (confirmed:
`.github/workflows/ci.yml` sets `continue-on-error: true` on the
`upload-artifact` step, with a comment noting the quota is account-level and
"must not be able to report a green build as a red one"). Confirmed on
`origin/cloud/web-swap`: Gitleaks, Prettier and Vite build now pass on PR
#5's own CI run (34755634781); Vitest was still running at last check.

**npm audit ruling only partly implemented so far.** The plan as reported:
scope the CI step to `npm audit --omit=dev --audit-level=high` with the
three advisory ids (`GHSA-fx2h-pf6j-xcff` vite, `GHSA-5xrq-8626-4rwp`
vitest, plus `@vitest/coverage-v8`) in a comment, since all three are
dev-only; and land the vite 7 + vitest 3 upgrade as a separate draft PR
"chore(toolchain): vite 7 + vitest 3." **What's actually live on
`cloud/web-swap` right now is coarser than that plan**: the `deps-audit` job
just gained `continue-on-error: true` on the unchanged `npm audit
--audit-level=high` command — no `--omit=dev`, no comment with the GHSA ids.
No `chore(toolchain)` PR exists yet on GitHub as of this check (`gh pr list
--state all` shows none). Advisory content itself not independently
re-verified (which packages are dev-only) — recorded as reported, distinct
from what's confirmed live.

**PR #7 (`ci/gitleaks`) merged at `0910b9d`**, confirmed on main, fixing
Gitleaks repo-wide. Merge order: PR #5 → PR #6 (after `codex-review-014-017`'s
verdict) — PR #5 is now explicitly the vehicle that turns main green, per
the report and consistent with everything confirmed above.

**Refs:** `ai/briefs/2026-09-13-api-phase-plan.md`, `ai/resume-brief.md`,
`docs/architecture/07-api-layer-decision.md`,
`apps/web/src/shared/api/rpcClient.ts`, `apps/web/vitest.config.ts`,
`.github/workflows/ci.yml`.

---

## 🟢 SEEDS — PR #16 final at f8d00fc (10 commits), SST resolved via the tax-policy registry, lane shut down (2026-09-13)

✅ **Confirmed final: PR #16 at head `f8d00fc`, 10 commits, lane shut
down.** The SST fix flagged as "queued, not yet in the diff" two updates
ago has now landed — confirmed directly: `quotationsSql` resolves SST via
`app.resolve_tax_policy()` rather than a literal (the report's own
reasoning holds up: tax-policy ids are `gen_random_uuid()` per database,
so a hardcoded literal could never match one). Resolves to
`SST-G-TRAINING-8`, 800 bps, `STANDARD_RATED` today — confirmed exactly
in the diff's own comments. Three new pins confirmed present and matching
their descriptions: `T7d` (stored rate matches the resolver's), `T7e`
(cited tax policy id matches what the resolver returns), `T7f` (an exempt
override would fail `quotations_exempt_needs_reason` by name rather than
storing a lie — the seed refuses to fabricate a reason for an exemption
it can't justify). Spot-checked `QUO-2026-0184`: `sell_price_sen`
confirmed `1850000` in the raw INSERT; the SST rate and gross are
resolved/generated rather than literals, but the arithmetic is
consistent (1,850,000 × 8% = 148,000 SST, 1,998,000 gross), matching the
report's figures. Merges right after PR #6, per the report. **Two USER
DECISIONs remain open in the PR body, both already tracked in this
thread**: the realised 29% margin has no column (T5 pins the absence
deliberately), and the fixture action-policy ids collide with two of
provisioning's 22 under a frozen `action_type`.

**Resume:** Read PR #16's own body first — 22 schema gaps are enumerated
there in full; this thread only summarizes. Then `ai/resume-brief.md`
BLAST 19:25/19:4x entries and `supabase/seeds/README.md`. Built against a
shim on port 5434 (separate from the other lanes' shims). Under review by
`review-pr16` (Opus). Merges right after PR #6, per the report — not
independently timed here since PR #6 itself is still blocked.

**Scope:** `supabase/seeds/` — the fixture-world seed data, a wipe script,
and an executable pin — plus `packages/fixtures/scripts/` for the
generator that emits the SQL.

**State:** PR #16 confirmed open, now 9 commits at head `e1dca98` (the
report's `900995a` is two commits behind current head; the two commits on
top — `900995a` itself and `e1dca98` — are the pipeline-id derivation and
a docs-only follow-up whose own message states "every id, every row and
every assertion is byte for byte what 900995a emitted," confirmed, so
nothing behavioral changed after the report). 17 files, 9920+ additions
(base figures: 4560 in `supabase/seeds/*.sql`, the rest in `emit-seed.ts`
and its slices — the exact "3,848 lines" figure reported earlier was
never reproduced precisely by this count and is not disputed further).
Targets 001–017. Four SQL parts, a wipe script and a pin confirmed
matching by filename. Generated by the committed `emit-seed.ts` generator
with a `--check` flag CI can use to prove the generator and its output
agree, confirmed in the diff. On the shim: T0–T10 all pass at `564dd64`
on 001–017, per the report, not independently re-run (needs the shim).

⚠ **The pipeline-stage-id ruling was corrected by measurement, and both
the wrong and the right version are worth recording — this is exactly
the kind of negative result the log exists for.** The original proposed
rule ("v5 if `uuid-ossp` else md5") would have split ids between the
shim and a hosted project if the extension's availability differed, and
a plain `'pipeline:'||stage_key` key collides because `WON` is a step
name shared by more than one pipeline (the actual unique constraint is on
`(tenant, pipeline, step_key)`, not `step_key` alone). Both defects were
found before shipping, not after. **Final rule, confirmed exactly in the
current diff:** `md5(tenant_id::text || 'pipeline:' || object)::uuid`
for the pipeline row, and `md5(tenant_id::text || 'pipeline:' || object
|| ':' || step_key)::uuid` for each step — `uuid-ossp` is confirmed NOT
installed anywhere in 001–017, so the fallback path was never optional to
begin with. Two new pins confirmed present and matching exactly: `T2k`
(every pipeline carries the derived id) and `T2l` (every step carries the
derived id, spelled out in the failure message with the full expression).
018 ships no per-tenant pipeline seed itself (blocked on the architecture
decision recorded in the SUPABASE SCHEMA thread above); the fixture world
owns its pipeline rows, and a later provisioning seed converges onto the
same rows by computing the identical formula, not by a shared writer.

⚠ **T10, the new RLS-visibility pin, confirmed exactly against the actual
test file.** After provisioning through 016 the seed now impersonates
Alex Selvarajah (`authenticated` role, his JWT claims) and counts landmark
rows back through 014's live policies rather than as the superuser
loader: `{"organisations":6,"engagements":10,"participants":136,
"certificates":78,"invoices":10,"approval_requests":7,"pipeline_steps":16}`
— every figure confirmed verbatim in the pin's own `v_want` literal. The
same query as a fabricated other-tenant member (`tenant_id`
`...000000ff`) must read 0 organisations and 0 participants — also
confirmed verbatim (`T10c`). This is explicitly the only assertion in the
whole pin that measures what the product will actually be served, since
every other check (T0–T9) runs as the superuser loader, which sees past
RLS.

**Rulings, recorded as decisions rather than left implicit:**

1. No single-file runner exists on purpose — `lint:sql` rejects `\i`
   includes, so the run order lives in the part headers and the seeds
   README instead. Accepted as the right trade-off given the guard.
2. The fixture world's one below-floor case (a realised margin of 29% on
   ENG-0198 against a 35% floor) has no column anywhere in 001–013 to hold
   it — logged as a schema gap for the migrations backlog rather than
   invented. The pin deliberately asserts the column is STILL MISSING, so
   it fails loudly the day a migrations lane adds one and the seed has
   somewhere to put `0.29` — a pin designed to break on purpose when its
   premise changes.
3. The fixture world's own 13 action policies (its own naming scheme)
   collide with tenant provisioning's 22 policies under a frozen
   `action_type` enum value. Provisioning's rows are left intact; the seed
   does not insert `core.action_policies` at all (confirmed via the PR's
   own commit message: "inserting the tenant already fires
   `app.seed_action_policies_on_tenant()`... the fixture world's policy
   ids are a different naming scheme"). Reconciling the two lists is a
   migrations-lane item, and needs the user's word on which scheme wins —
   not resolved here, flagged rather than guessed at.
4. **Seed calls `provision_tenant` with `p_id`, which required a schema
   change (see the migrations addendum below).**
5. ⚠ **Re-correction: the trainer accreditation entry above was itself
   superseded by a later commit — re-checked directly at head `f5aa04a`,
   not taken on either report's word.** Two updates ago this thread
   recorded (correctly, for the commit it read) that all four trainers got
   `hrd_tdf = false`. That was accurate for the commit at the time. A
   further commit, `f5aa04a` itself ("call provision_tenant with p_id,
   keep TDF accreditation true"), changed this: the three genuinely
   TDF-accredited trainers now carry `hrd_tdf = true` with
   `hrd_tdf_valid_to` set to that trainer's own TTT certificate expiry —
   confirmed directly in the diff (`hrd_tdf: trainer.hrdTdf`,
   `hrd_tdf_valid_to: trainer.hrdTdf ? trainer.tttValidTo : null`) — and
   `hrd_tdf_ref` stays NULL, confirmed. This is NOT a fabricated date: the
   file's own comment states the same three trainers hold both
   accreditations, so the seed reuses the TTT expiry as a stated
   convention rather than inventing a second one, and pins the convention
   with three new assertions, all confirmed present and matching exactly:
   `T2h` (3 trainers carry `hrd_tdf`), `T2i` (none lapsed at the fixture
   clock, 2026-11-14), `T2j` ("good news" framing — fails the day a real,
   independent TDF expiry arrives and the reuse convention should be
   dropped). Both this entry and the one it supersedes were accurate for
   the commit each one read; the lesson is to check PR head freshness
   before restating a finding, not that either check was sloppy.
   **Confirmed exactly three trainers are accredited, not four**: `TRN-0024`
   Noora Idris carries `FALSE`/`NULL` across `ttt_certified`, `ttt_ref`,
   `ttt_valid_to`, `hrd_tdf`, `hrd_tdf_valid_to` in the current row —
   confirmed directly in the SQL values.
6. **Superseded — see the pipeline-stage-id ruling in this thread's State
   section above, now confirmed with the corrected formula and its own
   pins (`T2k`, `T2l`).** The formula recorded here two updates ago
   (`uuidFor(childKey(...))`, unconfirmed against 018) has since been
   replaced by a measured, corrected rule shared between both lanes.

✅ **The SST discrepancy flagged two updates ago is now fully closed: the
fix landed at `f8d00fc`** (see the confirmed final state above) — resolved
by measurement each step of the way: "not found" → confirmed "queued" →
now confirmed "landed," each check against the actual diff rather than
either report on its own.

⚠ **Scratchpad collision incident, recorded as reported — this is about
the fleet's shared filesystem, not the git repo, so not independently
re-verifiable here.** The session scratchpad is shared across lanes;
`lane/seeds` and `lane/rpc-018` both wrote a `pr-body.md` at its root, and
PR #16 briefly carried PR #11's description before the collision was
caught and fixed. **New fleet convention, worth carrying into every
future multi-lane blast this spine records:** lane-specific scratch files
go under `<scratchpad>/<lane-name>/`, not the scratchpad root.

⚠ **Twenty-two schema gaps enumerated in the PR body** — the margin-floor
column is one of them; the rest are listed in full there rather than
duplicated here. Two more open items, not yet resolved: the seed's check
keys overwrite two provisioning-created positions (mechanism not
independently traced here), and the action-policy scheme collision in
ruling 3 above. Also tracked as a **SUPABASE SCHEMA sub-item, pointing at
PR #16** — see that thread.

**Refs:** `ai/resume-brief.md`, `supabase/HANDOFF.md`, PR #16 body,
`packages/fixtures/scripts/emit-seed.ts`, `supabase/seeds/README.md`.

---

## 🟢 UI-CARRYOVER — three worktree lanes closing verifier-pass debt (2026-09-13)

**PR #13 (`ui: the blind-spot tone map stops shadowing the kit's
SEVERITY_TONE`, branch `ui/knowledge-tone-rename`) confirmed MERGED** at
`47d56e1` (`gh pr view 13`: mergedAt 2026-09-13T12:27:55Z). Note: its own
CI run still shows `CI Summary` and both Grant Hygiene and npm audit as
`fail` (checked directly) — it merged carrying the same two inherited
main-red failures this thread already tracked, not because they resolved
first. Not a defect in PR #13's diff either way.

**Resume:** Read `ai/resume-brief.md` §"Verifier carry-over" for the full
ranked list, then each lane's own commits on its branch. Each lane below runs
in its own worktree under `~/Repos/personal-work/trainos-wt/` and opens a PR
to main. `ui/tokens` (worktree `ui-tokens`): kit contrast tokens plus the
mono-uppercase reduction, closing the dark-sidebar contrast item that gates 34
of 40 failing routes. `ui/lists` (worktree `ui-lists`): HRD Corp and Invoices
list leaves (both nav leaves currently mount a detail and have no list),
Collections brought into §10b conformance, zebra striping on the two
hand-rolled tables. `ui/states` (worktree `ui-states`): the nine missing empty
states, the ten tone ternaries, the Drawer opening a primary scope, and
`ListToolbar` on the agent registry. None had a PR as of 19:25.

**Scope:** `apps/web/src/shared/components/kit/**` and the feature screens
each lane touches; no kit additions beyond what `ui/tokens` lands.

**State:** `ui/states` opened PR #8 ("fix(screens): empty states, tone
ternaries, drawer primary and the registry toolbar") at ~19:49, closing four
verifier-carry-over items. **MERGED at `a4ea833`** (confirmed: `gh pr view 8`
shows `state: MERGED`, `mergedAt` 2026-09-13T11:55:41Z), after `review-pr8`'s
MERGE verdict. The reviewer ran its own gates in an isolated worktree pinned
to `6dfd281` (the lane's actual tip, confirmed matching the earlier-recorded
`git worktree list` output) and reported typecheck clean and 1004 tests —
a different figure from the lane's own self-reported 1389 (28 new); not
reconciled here, recorded as two different counts from two different
checks rather than assumed to agree. The reviewer also recounted the tone
ternaries at 8 replaced, not 10, with the other two attributed to `ui/lists`
— consistent with what this thread already recorded independently below.
`ui-states` lane worktree is shut down (confirmed gone from disk).

**Three deviations from the verification doc, each confirmed against the
actual files:**

1. Verification doc §6 claimed `statusTone.ts` already had maps for all ten
   tone-ternary vocabularies. False — confirmed only one of the six new names
   used (`HRDC_PACKET_PANEL_TONE`) pre-existed anywhere in the kit; four new
   maps were appended to `apps/web/src/shared/components/kit/statusTone.ts`
   on `ui/states` (`AGENT_TONE`, `SEVERITY_TONE`, `MESSAGE_CATEGORY_TONE`,
   `HOURS_SAVED_TONE`), and a fifth, `PARTICIPANT_ATTENDANCE_TONE`, lives
   feature-local in `apps/web/src/features/engagements/attendanceModel.ts`.
   Approved as reported.
2. §6's kit-level "give `Drawer` a primary scope of its own" was deferred;
   `KnowledgeSourcesScreen.tsx` instead migrated to the `ProviderKeysScreen`
   pattern (a SECONDARY-labelled action standing in for a solid primary the
   kit's one-primary rule won't let it declare) — confirmed via the file's
   own comment explaining exactly this trade-off.
3. A real defect was fixed in `TnaDetailPage.tsx`: confirmed via the file's
   own comment that the old ternary "painted a DANGER constraint" as
   neutral; it now reads `SEVERITY_TONE[constraint.severity]`.

**Carried to other lanes, not dropped — listed at the bottom of PR #8:**
`EnquiryDetailPage`, `CostingWorksheetPage`, `QuotationsListPage` and three
M03 `ListToolbar` screens go to `cloud/web-swap` as follow-up;
`ClaimPacketScreen` and `CollectionsQueueScreen` go to `ui/lists`.

**PR #9 (`ui/tokens`) — MERGED at `ed3c337`, after `review-pr9`'s MERGE
verdict** (confirmed: `gh pr view 9` shows `state: MERGED`, `mergedAt`
2026-09-13T11:54:52Z). `ui-tokens` lane worktree is shut down (confirmed gone
from disk). 3 commits confirmed; file count is 35, not 33 as reported (a
small discrepancy, not disputed further — every substantive claim checked
out). No feature screen touched, confirmed (all 35 files are under
`kit/`, `styles/`, `tailwind.config.ts`, and one `docs/reviews/` doc).
Verified word-for-word against `docs/reviews/2026-09-13-verification.md` at
`ed3c337`:

- Rows 1b/1c closed exactly as reported — 1b: muted text on a selected row is
  now 6.54:1 light / 6.69:1 dark (was 4.36:1), via a `SELECTED_TINT` rebind of
  `--ink-muted` to `--ink-secondary` for that subtree; 1c: `--on-primary` on
  solid primary is now 4.82:1 dark (was 3.24:1), via a new `--primary-solid`
  / `--primary-solid-hover` token pair carrying the brand hex `#1F5BFF` in
  both themes, used only where the accent paints a fill under text.
- Contrast suite: confirmed exactly "49 cases, was 33" in the test file.
- Mono-caps counts confirmed exactly: `/dashboard` 29→11, `/sales/enquiries`
  34→21, `/compliance/hrd-corp` 22→12, `/finance/invoices` 36→22.
- The `/training/participants` "x275" figure is real (it's in the route
  table) but confirmed a false violation, exactly as reported: 350 of 354
  counted runs are `PAR-…`/`CERT-…` record references that §1 of the brief
  keeps in mono deliberately: there is no kit lever on them and none should
  exist.
- Two defects confirmed recorded, not fixed, because the owning files are
  outside this lane's scope: `--on-primary` on `--danger` is 2.22:1 in dark
  (the alias lives in `tailwind.config.ts`, which this lane owns, but the
  call site is `shared/components/ui/toast.tsx`, a shadcn primitive outside
  it); and `apps/web/src/shared/components/ui/button.tsx` has zero importers
  anywhere in the app (confirmed via `git grep`) — a dead second button
  vocabulary beside kit `Button`, the exact divergence CLAUDE.md names.

**PR #10 (`ui/lists`) confirmed MERGED** at `47298f4` (`gh pr view 10`:
mergedAt 2026-09-13T12:09:39Z), head `92679c4` after a rebase onto main —
1061 web tests at merge time (up from the pre-rebase 1009, consistent with
picking up main's own test growth in between). `ui-lists` worktree confirmed
shut down. **All three UI carry-over PRs (#8, #9, #10) are now on main.**
Original deviations (5 commits, 17 files pre-rebase) confirmed against the
actual diff:

- Invoice totals moved to a `<dl>` under the table rather than table rows,
  because kit `DataTable` has no footer and a summary is not a line item —
  confirmed via the file's own comment citing "DECISIONS §7."
- The AI tier-assignment matrix lost its sticky first column and its staged-
  row `bg-ai-tint` on conversion to `DataTable`, because the kit has no
  sticky-column prop and no staged-row tint prop — confirmed via the diff's
  own "TWO THINGS THE CONVERSION COSTS" comment, which also notes
  `bg-ai-tint` specifically was AI-hue territory CLAUDE.md reserves, so it
  couldn't be improvised back in.
- `apps/web/tsconfig.strict.json` gained exactly three new paths (confirmed
  in the diff): `compliance/registers.ts`, `ClaimPacketsScreen.tsx`,
  `InvoicesListScreen.tsx`.
- Collections' `ListToolbar` sits above the DETAIL pane, not the table,
  because it spans the full width of a master/detail grid and constraining
  it to the table column would stack two bands — exactly what §10b forbids.
  Kept as-is; confirmed via the PR body's own explanation.
- `HRDC_RULE_CHANGES_PATH` confirmed to still carry the same "leaf opens the
  record" shape of defect that `HRDC_PACKET_PATH` had before this lane fixed
  it — confirmed via the file's own updated comment, which says so directly
  and marks it "NOT this pass's."

**Three more findings surfaced at rebase time (post pre-merge rebase onto
main), each confirmed directly:**

1. The claim-packet severity ternary hid a real defect, not just a style
   issue: it read `deadlineSeverity === "INFO" ? "neutral" : "warning"`, a
   two-branch ternary over a FOUR-member `Severity`, so `DANGER` and `ALERT`
   both rendered as "warning" — confirmed via the file's own comment. Fixed
   to read the kit's `SEVERITY_TONE`.
2. Collections' 60/30-day overdue thresholds were invented in the screen
   (`daysOverdue >= 60 ? danger : >= 30 ? warning : neutral`) for a cadence
   the business actually configures in Settings, which this screen already
   reads via `GET /v1/collections/rules` — confirmed in the diff: a rung
   change (e.g. chase at 20/45 days) would have left the chips silently
   answering for the old 30/60. Replaced with `overdueTone()`, which grades
   off the two signals a rung actually carries (`requiresApprovalFromRole` →
   danger, `autonomy === "OBSERVE"` → warning), confirmed directly in the
   current source.
3. `apps/web/src/features/hrdc/tone.ts` was deleted after the rebase —
   confirmed absent from the tree — in favour of the kit's `SEVERITY_TONE`
   that PR #8 had just landed; concept duplication avoided at merge time
   rather than shipped and cleaned up later.

⚠ **New follow-up (g), confirmed directly, and it explains why the fix
above has no visible effect yet:** `StatusChip` on an accent `RecordHeader`
card renders `ACCENT_TONE` and ignores the `tone` prop entirely — confirmed
at `apps/web/src/shared/components/kit/StatusChip.tsx:118`:
`onAccent ? ACCENT_TONE : TONE[tone]`. The claim-packet header is `accent`
and never passes `plainWhenCollapsed`, so `RecordHeader`'s card stays
permanently shown, and the claim-window severity chip — the one the fix
above just made correct in the data layer — has never actually been visible
on screen; an urgent and a routine claim window render identical pixels
today. `ui-lists` deliberately wrote no DOM test for this rather than write
one that would pass for the wrong reason — confirmed directly in
`apps/web/src/features/hrdc/__tests__/hrdc.test.tsx`'s own comment: "A DOM
assertion here would therefore pass against the ternary, against the map,
and against a tone of 'success' — which is a test that proves nothing,"
raised as a ruling request instead (either give the severity somewhere it
can be seen, or stop the chip carrying a tone at all).

⚠ **Also note: PR #10's own screenshots predate PR #9's token changes** (PR
#10 opened 11:52, PR #9 merged 11:54) — its light/dark captures do not
reflect the `--primary-solid` split or the `SELECTED_TINT` rebind PR #9
landed. Not re-verified visually here; flagged so nobody treats those
screenshots as showing current tokens.

⚠ **Correction to this thread's own prior entry: follow-up (a) is not fully
resolved, only its kit half is.** The earlier record here said "drop (a)
rather than redo it" — too broad. What's true, confirmed by reading the
files directly: `MoneyText` itself has no `font-mono` (fixed by PR #9's
`5f01e57`, "labels take the UI font, numbers take tabular figures";
`Money.tsx` on main uses `tabular-nums` at both lines, ancestor of `ed3c337`).
But two SCREENS carry their own independent `font-mono` wrappers around
money/numeric columns that were never routed through `MoneyText` in the
first place, so PR #9's kit fix never touched them: `InvoiceDetailScreen.tsx`
hardcodes `font-mono` at ten call sites in its hand-rolled table (confirmed
at `a4ea833`) — this one closes as a side effect once PR #10's `DataTable`
conversion merges, since that table is exactly the one PR #10 replaces.
`ExecutiveDashboard.tsx` hardcodes `font-mono` at three call sites (confirmed
directly, lines 91, 349, 385) and has no lane currently touching it — this
one **stays open as a screen-level item**, tracked as verification doc §5
item 5 / §7 row 9, not a kit follow-up. Revised follow-up list: (a) DROP —
the kit half is done, the two screen instances are tracked separately, one
closing via PR #10 and one still open per above; (b) `DataTable`
`stickyFirstColumn` prop; (c) a master/detail variant of `ListToolbar`; (d)
`HRDC_RULE_CHANGES_PATH`'s leaf-opens-a-record defect, untested, unassigned;
(e) the kit-level `Drawer` primary scope PR #8 deferred; (f) the destructive
alias at 2.22:1 dark and the dead `ui/button.tsx`, both from PR #9; **(g)
`StatusChip` on an accent `RecordHeader` card ignores `tone` and always
renders `ACCENT_TONE` (`StatusChip.tsx:118`), confirmed above — the
claim-window severity chip has never been visible.** Unverified by the
`ui/lists` lane itself, per its own report: artboard fidelity for its four
screens, an axe pass, and the blue-budget rule.

**Refs:** `ai/resume-brief.md` (verifier carry-over section),
`docs/reviews/2026-09-13-verification.md`,
`apps/web/src/shared/components/kit/statusTone.ts`,
`apps/web/src/shared/components/kit/Money.tsx`,
`apps/web/src/shared/components/kit/tokens.ts`,
`apps/web/src/styles/tokens.css`.

---

## 🟢 CONTRACT BATCH — R1 to R8 landed; the reported gaps are the remainder (2026-09-12)

**Resume:** Work the contract gaps that R4 to R8 did not cover. Four of the
twelve reported are now closed by `e148a34`; the rest are listed in
`packages/fixtures/README.md`, together with the five places the contract's own
verbatim JSON examples contradict themselves. Take them as one batch, the way
R4 to R8 were taken, rather than one at a time as each screen trips over them.

⚠ **Corrected 2026-09-13, same day, concurrent lane.** This thread was written
while R4 and R5 were open and `e148a34` landed them a few minutes later — along
with R6, R7 and R8. R5's shape question is answered: `RunStatus` was widened
with a `RESUMABLE` member rather than the runtime's wrapper being blessed, so
the runtime can now stop reporting a yielded run as `RUNNING` with the real
disposition outside the contract. The agent runtime has not yet been changed to
use it; that is the first thing to do here.

**Scope:** `packages/contract` — the typed surface both the fixture client and
the Supabase schema code against. Types only; the sole runtime values are the
enum arrays, the endpoint table and the fixture ids.

**State:** R1 (`CREATE` normalises to `ADD`), R2 (`quotations`, not `costings`)
and R3 (`ACCOUNT_TRADING_HOLD`) landed on 12 September; R4 (`OPENROUTER` and
`OTHER` providers), R5 (`RESUMABLE` run status), R6 (both quotation floors plus
`bindingFloorBasis`), R7 (`Engagement.finance` optional,
`CollectionNextAction.type` widened) and R8 landed on 13 September in
`e148a34`. `packages/contract/src/enums.ts` generates 62 of the 69 database enum
types, so a change there is a migration — R4's two new provider members and R5's
new run status are therefore schema changes the paused Supabase lane inherits.

⚠ **Twelve contract gaps were reported rather than patched** across the fixtures
and screen lanes. Four are now closed by R6, R7 and R8: `Quotation` carries both
floors and `bindingFloorBasis`, `Engagement.finance` is optional so the OPS
projection types as an `Engagement`, and `CollectionNextAction.type` is widened
to `AnyActionType` so the collections ladder's final rung can name the action it
actually performs. The rest are listed in `packages/fixtures/README.md` and are
owed a batch of their own. Each of the four had a local decorator or `Omit<>`
standing in for it, and those come out with the ruling.

**Refs:** `packages/contract/**`, `packages/contract/README.md`, `57ef512`,
`273a12f`, `3d6e484`, `e148a34`, `D-108`, `D-109`, `D-110`.

---

## 🟢 VERIFIER PASS — never run, and now the only thing in front (2026-09-13)

**Resume:** Run a verifier over the whole tree with no premise taken from this
session's commit messages. The specific thing to check is not that the tests
pass — they do, locally — but that each lane's claims match its files, because
this session produced at least one commit whose message described an edit the
file did not receive (`B-007`). Start with the five claims in
`docs/reviews/2026-09-12-ui-blast-lane-review.md` marked "could not verify".

**Scope:** Independent verification of every lane. Deliberately a separate pass
in a separate context: CLAUDE.md's execution protocol forbids self-approval in
the same context that authored the work.

**State:** Deferred at the user's direction when the UI work took priority.
Nothing has verified any lane against any other lane's output. Picked up from
PARKED on 2026-09-13 once `d4ae83d` closed the consolidation: this is now the
work that gates everything else, including the Supabase resume.

⚠ **Every "green" claimed before 2026-09-13 19:40 was a local run only.**
CI now runs on every PR (see CI AND BRANCH PROTECTION below) and most jobs
pass there too, but that does not retroactively verify anything merged
earlier under a local-only claim.

**Refs:** `docs/reviews/2026-09-12-ui-blast-lane-review.md`,
`ai/findings-log.md`, `CLAUDE.md` execution protocols.

---

## ⏸ KIT DUPLICATE SWEEP — parked (2026-09-12)

**Resume:** Down to two files as of `d4ae83d`. Delete the two
`StandInField.tsx` stand-ins once the kit ships `TextField` and `DateField`,
then grep `apps/web/src/features/**` once more for anything else the kit now
exports — the screens' primaries capture typed
references and there is no kit input for them, which is why the stand-ins exist
at all. The showcase at `/dev/kit` is the inventory: a pattern not on that page
is not in the kit, and inventing it on a screen is the divergence CLAUDE.md
calls a defect.

**Scope:** `apps/web/src/shared/components/kit/**` and everything under
`features/` that duplicates it.

**State:** Was parked behind CONSOLIDATION, which was the same sweep on the data
layer and the more urgent half. That closed on 2026-09-13; this is now waiting
only on the two kit components, which is a real dependency rather than a
priority call.

**Refs:** `apps/web/src/features/finance/StandInField.tsx`,
`apps/web/src/features/hrdc/StandInField.tsx`, `/dev/kit`, `D-116`, `D-117`.

---

## ⛔ CI AND BRANCH PROTECTION — CI runs on every PR now; required checks still cannot be set (2026-09-13)

**Corrected 2026-09-13 ~19:40.** This thread's heading was stale: the pipeline
is no longer untested. The repo is `PARALLELPARADIGMS/alex-project` on
GitHub (not "trainos" — that name is only the local directory and the
`@trainos/*` package scope; searching GitHub for "trainos" finds nothing).
Confirmed directly against PR #5 (`gh pr checks 5`, run 34754549631, 19:40):
seventeen jobs run on every PR, most passing. See API-PHASE above for PR #5's
four real failures (Gitleaks license, Prettier drift, npm audit high+, Vite
artifact-upload quota).

**Resume:** Branch protection is still not achievable as things stand — a
person confirmed this 19:40: `gh api repos/.../branches/main/protection`
returns 403 "Upgrade to GitHub Pro or make this repository public to enable
this feature." So required-checks-on-`main` needs either a plan upgrade or
making the repo public, a decision for the user, before it can be set at all.
`VITE_SITE_URL` and `VITE_API_BASE_URL` as CI secrets is unconfirmed either
way — recheck before assuming they are set.

**Scope:** `.github/workflows/ci.yml`, branch protection, CI secrets.

**State:** Seventeen jobs are written and now run on every PR to main (PR #5,
#6, #7 confirmed). The three Supabase-coupled checks passed on PR #5. What
remains open: (1) branch protection is blocked on a plan/visibility decision,
not implementation; (2) **main itself has been red since `9fdcb4d`** (run
34753909066, confirmed 19:5x) on the same four checks PR #5 fails, so every
open PR inherits them regardless of its own diff — see API-PHASE for the fix
lane and the branch-name discrepancy found while verifying it.

⚠ **This is the one blocker that makes every other green claim provisional.**
The pipeline is decoration until the checks are required, and it is untested
until it has run once. A workflow file that has never executed is a hypothesis.

**Refs:** `.github/workflows/ci.yml`, `ai/state-backlog.md`, `CLAUDE.md` R10.
