# Hot State

> What is actively being worked on right now. Newest session block first.
> Historical detail moves to `CHANGELOG.md` once a chunk ships.
>
> The three headings `Focus`, `Next Active Task` and `Blockers` are an implicit
> contract — a PR-body extractor keys on those literal strings. Renaming one
> silently degrades that section to a placeholder.

## SESSION 2026-09-13 — HEADLESS BLAST, API PHASE + UI CARRY-OVER

> **BLAST 13 Sep 19:25 +08** — orchestrator launched four lanes on top of the
> 19:05 recovery, each in its own worktree under `~/Repos/personal-work/trainos-wt/`
> opening a PR to main: `lane/rpc-018` (worktree `rpc-018`, 018 RPC pack, user
> go-ahead), `ui/tokens` (worktree `ui-tokens`, kit contrast tokens +
> mono-uppercase reduction), `ui/lists` (worktree `ui-lists`, HRD Corp +
> Invoices list leaves, Collections §10b, zebra on two hand-rolled tables),
> `ui/states` (worktree `ui-states`, nine empty states, ten tone ternaries,
> Drawer primary scope, ListToolbar on agent registry). `cloud/migrations`
> (014–017) and `cloud/web-swap` continue from the 19:05 entry, no PRs yet.
> Start from `ai/resume-brief.md` BLAST 19:25 entry.

> **BLAST 13 Sep 19:4x +08** — PR #5 (`cloud/web-swap`) and PR #6
> (`cloud/migrations`) open. PR #5's CI is NOT green except Gitleaks —
> verified directly (`gh pr checks 5`): four checks fail (Gitleaks license,
> Prettier drift, npm audit high+ with 2 critical/1 high, Vite
> artifact-upload storage quota). `ci-gitleaks` (worktree `ci-gitleaks`,
> branch `ci/gitleaks`) is fixing the license one. PR #5 also surfaced ten
> missing RPC functions, now `lane/rpc-018`'s scope. New lanes: `seeds`
> (worktree `seeds`, branch `lane/seeds`, shim :5434, fixture-world seed
> data) and `codex-review-011-013` (worktree `codex-011-013`, branch
> `review/codex-011-013`, D-012 review of packs 011–013). GitHub repo is
> `PARALLELPARADIGMS/alex-project`, not "trainos". See
> `ai/workstreams.md` API-PHASE, SEEDS, SUPABASE SCHEMA and CI AND BRANCH
> PROTECTION threads for detail.

> **BLAST 13 Sep 19:5x +08** — root cause found: main has been red since
> `9fdcb4d` on the same four checks (Gitleaks, Prettier, npm audit, Vite
> artifact-upload), so PR #5, #6 and #7 all inherit them regardless of their
> own diffs. PR #6 (`cloud/migrations`) and PR #7 (`ci/gitleaks`) are open;
> PR #7's Gitleaks check now passes but its other three main-red failures do
> not. PR #6 also fails Grant Hygiene (a test file defines its own
> `SECURITY DEFINER` function) and is gated on `codex-review-014-017`'s
> MERGE/MERGE-WITH-FIXES/BLOCK verdict before it can land. A fix lane is
> meant to be repairing main's CI on branch `fix/main-ci`, but the actual
> worktree on disk is on branch `fix/pr5` with a web-swap feature commit, not
> a CI fix — flagged, not yet resolved. R-F confirmed live: probing the
> hosted project's REST endpoint directly returned `PGRST106`, `core` is not
> exposed. See `ai/workstreams.md` for full detail.

> **BLAST 13 Sep 20:0x +08** — PR #7 (`ci/gitleaks`) merged at `0910b9d`,
> confirmed on main; Gitleaks now passes on main's own CI, though Prettier
> drift, Vite artifact-quota and npm audit still fail there. `fix-pr5` (still
> on branch `fix/pr5`, not the reported `fix/main-ci`) has three real fix
> commits now — Prettier, timezone, artifact quota — resolving the earlier
> "flagged, not yet resolved" concern about that lane's progress, though the
> branch-name gap itself is unexplained. The `codex-014-017` detached-HEAD
> worktree is confirmed legitimate: it is `codex-review-014-017`'s own
> checkout of PR #6's tip for review, not a stray lane. PR #8 (`ui/states`,
> "fix(screens): empty states, tone ternaries, drawer primary and the
> registry toolbar") opened, under review by `review-pr8`; three deviations
> from the verification doc confirmed and logged in `ai/workstreams.md`
> UI-CARRYOVER, plus carryover items handed to `cloud/web-swap` and
> `ui/lists`.

> **BLAST 13 Sep 20:1x +08** — PR #9 (`ui/tokens`) is already MERGED
> (`ed3c337`), not "open" as reported — verified `gh pr view 9` directly.
> Every substantive claim about it checked out exactly against
> `docs/reviews/2026-09-13-verification.md`: rows 1b/1c closed (6.54:1
> light / 4.82:1 dark), contrast suite 33→49, mono-caps counts exact on all
> four routes, the participants "x275" confirmed a false violation (record
> references the brief keeps in mono), and both unfixed defects (destructive
> alias 2.22:1 dark, dead `ui/button.tsx`) confirmed real. PR #10
> (`ui/lists`) confirmed open, 5 commits/17 files exact, 1009 tests
> confirmed in its own body; all six deviations confirmed against the diff.
> One kit follow-up item queued off PR #10 turned out to already be done:
> `Money.tsx`'s `font-mono` was fixed by PR #9 itself, not left open — drop
> it from the list rather than reassign it. Full detail in
> `ai/workstreams.md` UI-CARRYOVER.

> **BLAST 13 Sep 20:2x +08** — PR #8 also confirmed MERGED, at `a4ea833`,
> after `review-pr8`'s MERGE verdict (typecheck clean, 1004 tests in an
> isolated worktree pinned to `6dfd281` — a different count from the lane's
> own 1389, not reconciled). Two of three UI carry-over PRs are on main now;
> only PR #10 is still under review. **Main-red was five failures, not
> four** — Vitest (unit) was also failing on `9fdcb4d` (five wall-clock/
> timezone test failures), missed in the earlier pass. All three fixes
> (`fix-pr5`'s work) are confirmed now IN PR #5's own commit history on
> `cloud/web-swap`, not a separate branch: Gitleaks/Prettier/Vite build pass
> on PR #5's own CI as of this check. The npm audit plan (`--omit=dev` +
> GHSA-id comment + a separate toolchain PR) is only partly live: what's
> actually on `cloud/web-swap` is `continue-on-error: true` on the unchanged
> command, and no toolchain PR exists on GitHub yet. **Correction to this
> session's own 20:1x entry:** the MoneyText follow-up is only half closed —
> the kit component is fixed, but `InvoiceDetailScreen.tsx` (closes via PR
> #10) and `ExecutiveDashboard.tsx` (stays open, a screen-level item) both
> carry their own independent `font-mono` wrappers PR #9 never touched.
> Full detail in `ai/workstreams.md`.

> **BLAST 13 Sep 20:3x +08** — 014–017 all landed: PR #6 confirmed at 4
> commits (`gh pr view 6`), 51/13/15/39 assertions, 17/17 pins pass from a
> clean shim including a full reverse rollback. Real defects found and
> fixed: `app.require_tenant_id` was ungranted (confirmed in the diff),
> plus a missing tenant index, an ungrantable view pair deferred to 018,
> and a `SET LOCAL` refusal. `pg_cron`/`pg_net` are shim stubs, so 015's
> job registration is pinned but firing is unverified until hosted. 018 is
> now PR #11, confirmed open (3 commits, 4955 additions): 23 of 24
> `RPC_NAMES` implemented, `me_profile` confirmed NOT implemented (needs an
> HR table), `core.tax_policies`/`app.resolve_tax_policy` confirmed absent
> from 001–013 by grep (R-C resolved), a real keyset-cursor paging bug
> found and fixed, and `DEAL_CHAIN` confirmed to be a genuine contract/004
> divergence left unpapered-over on purpose. **Hard rule confirmed baked
> into 018's own test as a runtime assertion**: every `core` table is
> FORCE RLS with zero policies until 014 lands, so on any non-BYPASSRLS
> owner every 018 read returns zero rows silently — the test raises "018
> MUST NOT be applied to a hosted project before 014" if it ever detects
> this. Full detail in `ai/workstreams.md` SUPABASE SCHEMA.

> **BLAST 13 Sep 20:4x +08** — **Correction to this session's own 20:3x
> entry: "014–017 landed" was premature.** PR #12 (D-012 review of PR #6)
> merged with **VERDICT BLOCK**: at review time PR #6 contained ONLY
> migration 014 — 015/016/017 did not exist in the repo at all, confirmed
> by the review's own `git log --all` search. They exist in PR #6's diff
> now but have never been reviewed by anyone. 014 itself has two CRITICAL
> findings, both confirmed directly in the SQL: a DELETE grant on
> `public.memberships` reopens a role-escalation path 002 closed, and 014's
> rollback strips 002's original `public.*` grants instead of restoring
> them. G6 execution passed but the review states this explicitly does not
> clear the BLOCK. Separately: PR #5 confirmed MERGED (found while
> verifying, not separately reported) — enquiries/proposals/approvals and
> all the CI fixes are on main. PR #10 confirmed MERGED after a rebase
> (1061 tests); all three UI carry-over PRs are on main now. New findings:
> a real DANGER/ALERT tone bug fixed in the claim packet, Collections'
> invented thresholds replaced with the configured ladder, and a new
> follow-up (g) — `StatusChip.tsx:118` ignores `tone` on an accent card, so
> the claim-window severity chip has never been visible on screen, even
> after today's fix. Full detail in `ai/workstreams.md`.

> **BLAST 13 Sep 20:5x +08** — **Third correction in this migration line,
> this time to a claim this session made itself:** "015-017 do not exist"
> was wrong. Confirmed by timestamp: 015/016/017 were committed to
> `cloud/migrations` at 19:35/19:42/19:59, all before the D-012 review doc
> was even written at 20:08. The review's checkout was detached and never
> fetched, so it saw a stale tree and reported non-existence — a tooling
> artifact, not a fact. This session had already seen all three files in
> `gh pr diff 6` and should have caught the contradiction instead of
> repeating the review's claim. 014's two CRITICAL findings remain accurate
> and confirmed. Two new active lanes: `fix-014` fixing 014's CRIT/HIGH
> findings directly, and `codex-review-014-017`'s continuation (fetched
> correctly this time) reviewing 015-017 plus the earlier nineteen pin
> edits. PR #5 confirmed 17/18 checks green at merge (only npm audit red,
> non-blocking); PR #14 (`ci/audit-scope`) and PR #15 (`chore/vite7-vitest3`
> draft) both confirmed real and matching their descriptions exactly,
> including the three named GHSA ids. Merge order: PR #6 needs both the 014
> fix AND the 015-017 review clean; PR #11 (018) needs its own review
> separately. Full detail in `ai/workstreams.md`.

> **BLAST 13 Sep 21:0x +08** — PR #14 confirmed MERGED (was "open" in an
> earlier report); `npm audit` genuinely passes on main now, but main is
> red on exactly one job, Grant Hygiene — confirmed live — because 014's
> test file (which lives on `main` via PR #12, deliberately kept there)
> still has the `SECURITY DEFINER` finding; `fix-014` carries the fix. New
> lane `fix-approval-hash` (branch `fix/approval-diff-hash`, not yet
> pushed) does the client half of 014's HIGH-4. `fix-014` hit a real port
> collision on its shim and now asserts `data_directory` before every run
> — logged as a thing worth telling future-me. New rule for review lanes:
> a review branch is cut from `main` with one doc file, never from the PR
> under review — exactly what caused the earlier stale-checkout error. PR
> #16 (`lane/seeds`) confirmed open: fixture world for tenant
> akademi-perdana, 5 commits/17 files/9920 additions (4560 of them SQL),
> idempotence proven via `pg_stat_xact_all_tables` (0/0/0 across 98
> tables), 22 schema gaps enumerated in the PR body. PR #13
> (`ui/knowledge-tone-rename`) confirmed open but failing Grant Hygiene and
> npm audit — both inherited main-red, not its own defects. PR #15 stays
> DRAFT, not for merge. Full detail in `ai/workstreams.md`.

> **BLAST 13 Sep 21:1x +08** — PR #13 confirmed MERGED (`47d56e1`) —
> carrying the same two inherited main-red failures, not because they
> resolved first, confirmed on its own CI run. PR #16 (seeds) now retargets
> 001–017 (6th commit) and its new T10 pin checks RLS visibility as Alex
> Selvarajah — exact counts confirmed verbatim in the pin (6 orgs, 10
> engagements, 136 participants, 78 certs, 10 invoices, 7 approvals, 16
> pipeline steps; another tenant reads 0). `cloud/migrations` pushed
> `564dd64` adding `p_id` to `app.provision_tenant`, with a mandatory `DROP
FUNCTION` confirmed load-bearing (a bare `CREATE OR REPLACE` with a
> changed param list creates an overload, breaking every existing caller).
> **Correction to a ruling as reported: the seed does NOT invent an HRD-TDF
> expiry for accredited trainers — confirmed the opposite in the file**:
> all four get `hrd_tdf = false` on purpose, because inventing a
> compliance-sensitive expiry date would be worse than a known-wrong
> boolean. New USER DECISION queued: SST treatment of three fixture
> quotations (0% now; Malaysian training is often exempt). `fix-pr5`'s
> Radix-test diagnosis confirmed precise: the slowness is `asyncAct` +
> floating-ui scheduling, not Radix; `testTimeout` now `30_000`, a ceiling
> not a budget. Full detail in `ai/workstreams.md`.

> **BLAST 13 Sep 21:2x +08** — **Re-correction: the trainer HRD-TDF entry
> corrected last round was itself superseded by PR #16's next commit
> (`f5aa04a`).** Re-checked at the current head, not either report's word:
> the three genuinely accredited trainers now DO carry `hrd_tdf = true`
> with `hrd_tdf_valid_to` reusing their own TTT certificate expiry (a
> stated convention, not a fabricated date) — confirmed in the diff and
> pinned by three new assertions, T2h/T2i/T2j, all confirmed present and
> matching exactly. Both the earlier "false" entry and this "true" entry
> were accurate for the commit each one read. PR #15 confirmed BLOCKED,
> not just draft: even at 30s, two Radix-menu tests still time out on the
> runner — confirmed on a live failing run, exact test names and timeout
> matching. "Raise the timeout" is now a confirmed-dead lever, tried at
> both 15s and 30s. `fix-pr5`'s worktree is still on disk despite being
> reported shut down — noted, not disputed. PR #17 confirmed open and
> matching its description exactly, including 1504 tests (1118+189+107+90)
> and `DIFF_CHANGED` mapped to HTTP 409. Stage-id formula stays explicitly
> unconfirmed per instruction — a ruling, not yet code on either lane.
> Full detail in `ai/workstreams.md`.

> **BLAST 13 Sep 21:3x +08** — PR #17 confirmed MERGED (`e20e1ba`), both
> lanes genuinely shut down (worktrees gone). Caveat recorded: the
> conformance suite's "rpc" side runs through an oracle into the fixture
> client, so no test anywhere executes 011's real RAISE path — the first
> hosted run after 014 applies is what actually proves it. PR #11 (018)
> rebased onto `cloud/migrations`, now 30 RPCs/3 views/11 helpers/228
> assertions, confirmed. Five findings confirmed: a 014/018 arity overload
> caused PGRST203 (018 drops its variant, 014 keeps its five-arg one); 017
> left SST half-wired (018's `put_quotation` resolves it, table-level fix
> routed to `fix-014`); `check:rpc` genuinely does not detect a missing RPC
> (confirmed by reading the script itself — added to backlog); pipeline
> stage seeding is blocked on a real doc 01 §9 Q10 decision plus a trigger
> ordering trap. PR #16 now 9 commits (report's `900995a` is 2 behind, the
> extra commit is docs-only, confirmed byte-identical). Pipeline-id formula
> corrected by measurement after two real defects were caught before
> shipping (extension-dependent, and a step-name collision) — final rule
> `md5(tenant_id::text || 'pipeline:' || object [|| ':' || step_key])::uuid`,
> confirmed exactly, pinned by new `T2k`/`T2l`. Confirmed exactly 3
> trainers accredited (Noora Idris is not). **SST ruling reported as fixed
> is NOT yet in the diff** — checked directly, quotations still default to
> 0%/STANDARD_RATED; recorded as an open discrepancy. Full detail in
> `ai/workstreams.md`.

> **BLAST 13 Sep 21:4x +08** — **Second D-012 pass confirmed via `git
show` on branch `review/codex-014-017` (commit `5a5655c`) — NOT yet on
> main, no PR open.** All four of 014–017 now BLOCK or worse: 014 BLOCK
> (unchanged), 015 MERGE-WITH-FIXES (one real gap: `reap_jobs_all_tenants`
> missing an overload guard; its "2 cron jobs, 0 outbound HTTP" safety
> claim verified true), 016 BLOCK (rollback deletes every unallocated
> `ref_formats` row, not only its own — same defect class as 014), 017
> BLOCK (four findings, all confirmed: SST silently defaults every
> quotation to zero tax with no write-path call to the resolver; the
> claimed lock-safety property is false inside a single transaction; an
> unguarded VALIDATE will abort on an existing legacy 4.5-point score; the
> rollback drops a statutory PDPA breach register while claiming no
> customer data is lost; catalog pin T3b never executes against an empty
> table). Pin-edit audit (14 hunks/10 files) and the `check:grants`
> `pg_temp` false-positive ruling both confirmed. Everything routed to
> `fix-014`, now covering all four packs. **Negative result: two packs in
> one PR shipped rollbacks that destroy state they never created — added
> "rollback restores PRIOR state, not empty state" to the checklist.**
> The earlier SST discrepancy is resolved: confirmed it's queued, not a
> false report — the seeds lane applies it next. Scratchpad collision
> between `lane/seeds` and `lane/rpc-018` recorded; new convention:
> lane files go under `<scratchpad>/<lane-name>/`. Full detail in
> `ai/workstreams.md`.

> **BLAST 13 Sep 21:5x +08** — ⛔ **GitHub Actions is unavailable on every
> branch since ~20:36, confirmed directly**: `gh api
.../check-runs/103725755232/annotations` returns the literal billing
> message, and the most recent push to `main` shows every job failing in
> 0-3s with the same annotation. Needs the user in GitHub Billing &
> plans. Policy until fixed: merges proceed on local gate output plus an
> independent review verdict, logged as "CI unavailable, billing." PR #16
> confirmed final at `f8d00fc` (10 commits): the SST fix flagged unlanded
> last round has now landed, resolved via `app.resolve_tax_policy()`
> rather than a literal (policy ids are `gen_random_uuid()` per database,
> so a literal could never match) — resolves to `SST-G-TRAINING-8`, 800
> bps; three new pins (`T7d`/`T7e`/`T7f`) confirmed present and matching.
> Seeds lane shut down; merges right after PR #6. **Correction to this
> session's own prior finding: the pipeline stage seed was NOT blocked —
> only `DEAL_CHAIN` itself stays blocked.** Confirmed at PR #11's new head
> `fc9550c`: the seed shipped as a fourth tenant trigger, named to sort
> after 016's alphabetically, resolving the ordering trap this thread
> previously called a blocker. PR #11 now 7 files, confirmed exact,
> including a real cross-join defect fix in `test_009` (an unconstrained
> join over `core.pipelines` was silently measuring an arbitrary
> engagement) and `test_014`'s grant count moving 121→124. Full detail in
> `ai/workstreams.md`.

> **BLAST 13 Sep 22:0x +08** — PR #18 confirmed MERGED (`4162a4d`), one
> file, cut from `main` per the new review-branch rule — the second D-012
> pass is now formally landed, not just branch-confirmed. Verdicts
> unchanged: 015 MERGE-WITH-FIXES, 016 BLOCK, 017 BLOCK. `564dd64`
> (`provision_tenant` `p_id`) confirmed reviewed separately and sound.
> New finding #19, confirmed exactly: 017's `app.seed_compliance_check_keys`
> trigger is never checked by `provision_tenant`'s completeness guard, the
> same failure class the guard exists to catch, now unguarded for
> check_keys — routed to `fix-014` with a request for one registry-driven
> check since 018 adds a fourth such trigger. Also confirmed: 017's
> 1,340-line single transaction flagged as a decomposition problem,
> deferred. **The "nineteen" pin-edit figure is confirmed wrong** —
> recounted three times against three bases, always 14 hunks over 10
> files; corrected in place everywhere this spine had repeated "nineteen."
> `codex-review-014-017` stays alive for the re-review after `fix-014`
> pushes. Full detail in `ai/workstreams.md`.

> **BLAST 13 Sep 22:1x +08** — PR #20 confirmed MERGED (`c7efb8a`), one
> file, thermonuclear review of 018 at `fc9550c`. **VERDICT: BLOCK**,
> confirmed, 5 Blocker/5 High/8 Medium/6 Low. **Correction: the report's
> "5 blockers" list mixed severities — only B1 (five copies of one list
> engine) and B3 (`p_view` silently discarded) are actually Blockers.**
> The "opposite pagination bugs" are H2/H3 (High, cross-referenced FROM
> B1, not part of it); `regenerate_proposal_section` enqueuing nothing is
> H1 (High); the provenance-without-tenant_id and backfill-swallows-FK
> items are M1/M5 (Medium, and M1 confirmed not reachable today). **Two
> real Blockers went unmentioned: B4 — 018 edits 014's own pin
> (121→124 grants), so 014's pin now only passes once 018 is ALSO
> applied, confirmed by reproducing the exact failure; B5 — 018 has no
> transaction wrapper on a migration that also writes data via a
> tenant backfill loop.** Confirmed clean, verbatim from the doc: no
> reachable cross-tenant read, no error swallowed into `app.ok`, rollback
> drops exactly its 47 objects. Pin-honesty confirmed: 239 assertions, 4
> provably unfalsifiable, ~30 pass vacuously on a refusal,
> `get_proposal`/`get_quotation` never invoked. `fix-018` lane confirmed
> active on `lane/rpc-018` at `fc9550c`. Full detail in
> `ai/workstreams.md`.

> **BLAST 13 Sep 22:2x +08** — PR #21 confirmed MERGED (`3fb8ea8`), 018's
> verdict now 6 Blocker/5 High/8 Medium/6 Low, confirmed exactly. New
> Blocker B6, confirmed: the 018 pipeline seed's rollback deliberately
> keeps seeded rows (FK-forced) but that means rollback cannot restore
> prior state — `pipelines_one_default_uq` stays broken for every tenant
> after rollback with no supported undo — and pin R4 claims to assert the
> rows survive while its body only checks a `pg_trigger` proxy. Routed to
> `fix-018`. **Separately, `fix-014`'s work is confirmed complete and
> pushed** (`cloud/migrations` tip `21ec975`): both original CRITICAL
> findings fixed with exercising pins, HIGH-1 fixed for 3 named tables
> (4-way check T12a-d), 3 more execution-only defects found and fixed
> (rollback-while-017-applied, an erasable role gate, a third destroyed
> `USAGE ON SCHEMA core` grant). Counts confirmed exactly: 18/18 forward,
> 17/17 pins, rollback 4/4 (228 policies), re-apply 4/4, check:grants 0,
> lint:sql 52/52. **BLOCKER: Codex is quota-blocked until 14 Sep 00:29
> ("usage limit"), confirmed verbatim — no MERGE verdict exists for 014
> yet.** Fallback per the user: remaining reviews run as Opus
> thermonuclear + security pass, Codex slot recorded as owed. Full detail
> in `ai/workstreams.md`.

> **BLAST 13 Sep 22:3x +08** — PR #22 confirmed MERGED (`279edc3`), one
> file: an independent review of 018 plus the actual G6 execution the
> static thermo pass never ran. VERDICT BLOCK confirmed, agreeing with
> the thermo report; all 6 Blockers independently re-confirmed with fresh
> `fc9550c` citations. G6 confirmed genuinely run: 18/18 pins clean twice
> through rollback/reapply — **confirmed explicitly this does NOT clear
> B1/B3/H2/H3/H4**, the pin fixtures are too narrow to have ever caught
> them. Two nuances confirmed exactly: **B4** — the standalone
> `test_014` failure actually trips one assertion earlier than first
> cited, at a count (116) traced directly to predate 018 by one pack
> (017's own amendment); B4 still stands because 018 separately pushes
> the grant-count assertion further into a file it doesn't own. **B6** —
> independently re-ran the actual rollback scenario and confirmed the
> data-preservation behavior itself is empirically correct (not a design
> defect); the defect is only that R4's assertion checks the wrong
> trigger and wouldn't catch a future regression. Codex slot confirmed
> still owed until 00:29, named priorities: pipeline-seed
> trigger/backfill/id-collision safety, and the ten client-derived RPCs
> against `rpcClient.ts` — neither static pass attempted either.
> `codex-review-018` lane confirmed shut down. Full detail in
> `ai/workstreams.md`.

> **BLAST 13 Sep 22:4x +08** — PR #23 confirmed MERGED (`db0ec94`), one
> file: an Opus thermonuclear + security re-review of 014's own fix
> commits, with G6 comparing OLD/NEW SQL directly. VERDICT
> MERGE-WITH-FIXES: both original CRITICALs confirmed genuinely closed
> by execution. New HIGH confirmed: `run:read` governs seven `core`
> tables in 013, this fix pack gates only one (`run_state_cards` and
> `run_snapshots` still open, not a regression, a pre-existing gap named
> only for the one table the original review happened to check). Two
> pin-only defects found by running rather than reading it: T11a is a
> tautology (still passes against the pre-fix database), and the pin's
> own header contradicts its own assertion counts (claims 001-014,
> actually needs 001-017). Codex still owed until 00:29. Separately,
> `fix-014` confirmed pushed 015-017's fixes to `cloud/migrations` at
> `bdd49aa` (not yet a PR): 015's overload guard, 016's rollback rescoped
> to its own derivation, 017's SST trigger/backfill/VALIDATE/PDPA guards,
> finding #19 closed via a registry table, RLS added on three new
> tables. Two premise corrections recorded (015's trap aborted for a
> different reason than claimed; the post-rollback policy count is
> 228→234→228, not `<> 222`). 016's hardcoded `dated` ref-prefix conflict
> with the domain model deliberately left unfixed, needs a human ruling
> — added to `ai/state.md`'s Backlog. Full detail in `ai/workstreams.md`.

> **BLAST 13 Sep 22:5x +08** — PR #24 confirmed MERGED (`b9bca03`), one
> file: an Opus thermonuclear + security review of migrations 011-013,
> already on `main` today (not gated behind a PR). VERDICT BLOCK. Severity
> count corrected against the findings table itself: **3 CRIT, 7 HIGH, 13
> MED, 5 LOW (28 rows)**, not the "2 CRIT, 4 HIGH, 9 MED" first reported
> — a third CRIT (T1) was left out of the summary: `app.replay_dead_letter`
> marks a _successfully replayed_ invoice push as permanently failed in
> the ledger via a silent no-op guard, no way to correct it later
> (static-only, not live-reproduced, but genuinely CRIT). The two CRITs
> that were live-reproduced: nothing calls `app.enqueue_effect_jobs`, so
> every external effect (email/invoice/reminder/broadcast) dispatches and
> never sends; BYOK key rotation is permanently blocked on any key ever
> revealed. HIGH-1 confirmed: `perform_action`'s HUMAN path has no
> permission check at all when no policy row matches. Six more HIGH
> findings not in the original summary (worker heartbeat shortening the
> lease, `bulk_decide`'s response shape the web contract can't parse, an
> approval diff-hash that can never fire, etc). Confirmed live: the
> 012/013 pins genuinely require 014 applied, contrary to the catalog —
> same pattern as 014's own pin. Codex owed until 00:29, not substituted;
> two Opus passes disjoint on 30/32 raw findings. Fixes reported routed
> to `fix-014` as in-place amendments, then re-review — not yet
> confirmed. 001-013 confirmed applied to no hosted project. Full detail
> in `ai/workstreams.md`.

> **BLAST 13 Sep 23:0x +08** — `fix-014` pushed `ff01f2b` to
> `cloud/migrations` (not yet a PR), folding in PR #23's re-review items.
> N-1 closed in full: all seven `run:read` tables gated (not just
> `run_node_io`), nine tables total across three permissions — catalog
> now says "the rest is a gap, not a posture." T11a's tautology fixed:
> the shipped privilege set is read before any GRANT/REVOKE runs, closing
> exactly the false-pass PR #23 found. Structural: policy-stamp ownership
> now a required `p_migration` argument; `'UNGATE'` replaced by a named
> `app.ungate_tenant_policy()` function. Negative result worth keeping
> verbatim: "two dead escapes on one control in one night" — the
> replacement function's first version had the same dead-on-arrival bug
> as the string it replaced, found only by running it. HIGH-4 closed both
> sides (APPROVE now refuses with no diff hash, REJECT still works
> without one). N-8 narrowed, not fixed (needs a schema change 007 never
> gave). Correction confirmed as a crossed message, not new information:
> 015-017 were already recorded landed in `bdd49aa` two updates ago.
> Counts unchanged: 18/18, 17 pins, 52/52, `check:grants` 0, `test_014`
> grant count still 121. Next on `fix-014`: the 011-013 amendments. Full
> detail in `ai/workstreams.md`.

> **BLAST 13 Sep 23:1x +08** — `fix-018` pushed `5612e65` to
> `origin/lane/rpc-018` (PR #11's "Review fixes" body), closing PR #20's
> thermo-018 BLOCK with a pin confirmed to fail pre-fix before it passes:
> B1/H2/H3 (shared keyset helpers), B3 (view-filter gate on all five
> lists), H1 (`regenerate_proposal_section` now actually enqueues via
> 012's event path), M1 (tenant-scoped provenance read), M5 (backfill
> raises loudly instead of warning), B2/B5 (catalog row + transaction
> wrapper), H5/M8 (four unfalsifiable assertions fixed). Two new defects
> found only by running the pin: `list_follow_ups` was a latent 500 on
> any paged/filtered call (ambiguous join columns), and the §17 jury
> badge is unreachable because `core.provenance`'s allowlist never
> included `approval_requests` (filed against that pack, not 018's to
> fix). **M4 measured with a number attached: applying 018 on top of
> `cloud/migrations`'s CURRENT 014-017 turns four pins red, not two** —
> `test_016`/`test_017` newly affected, outside this branch's scope.
> **RULING (decision only, no code yet): the pipeline seed becomes its
> own pack, `019_pipeline_provisioning`, same PR #11 lane.** **B4 ruling
> (decision only): 018 must not edit `test_014` at all; `test_018`
> asserts its own three-grant delta instead.** **Open discrepancy, not
> resolved**: `fix-018` reports `test_014`/`test_014_rollback` already
> red on `cloud/migrations`'s current 001-017 alone, contradicting this
> thread's own confirmed "17/17 pins pass" from `fix-014`'s `ff01f2b` —
> `fix-018` has asked for the failing text. Full detail in
> `ai/workstreams.md`.

> **BLAST 13 Sep 23:2x +08** — PR #25 confirmed MERGED (`15eed1b`), one
> file: an Opus thermonuclear + security re-review of fix commit
> `bdd49aa` specifically (NOT `ff01f2b` — 014's own re-review items are
> explicitly out of scope, confirmed pending). **015 and 016
> MERGE-WITH-FIXES, 017 BLOCK (NEW).** 015: the DROP guard genuinely
> works, but its new verify assertion is dead code (an earlier check
> always aborts first) and the file's own comment gives backwards advice
> that would reopen the hazard. 016: rollback-scope fix genuinely closed
> by execution both ways; residual — the disclosed residue criterion
> says `dated` but the WHERE clause never checks it, and the new
> registry table has no RLS. **017: the SST CRITICAL is genuinely fixed,
> but the fix itself introduces a NEW blocker — 017 cannot apply to any
> database already holding a quotation row (SQLSTATE 55006, queued
> deferred triggers vs. a new SET NOT NULL in the same transaction),
> reproduced twice.** A second, pre-existing, unrelated wall sits behind
> it (a numeric-division scale guard that always fires). Both premise
> corrections re-confirmed by direct execution. Negative result worth a
> standing rule: a fix passing clean on an empty shim can still fail on
> retrofit-onto-existing-data — every backfilling pack needs its own pin
> that applies over pre-existing rows, not just an empty database.
> Routed to `fix-014`. Operational note: user is on the Data API
> settings page; `core` can't be exposed until migration 001 creates it
> (nothing applied yet); advised to disable "Automatically expose new
> tables" first. Full detail in `ai/workstreams.md`.

> **BLAST 13 Sep 23:3x +08** — `fix-014` pushed two commits addressing
> PR #24's 011-013 findings to `cloud/migrations`, tip `0d9e00c` (not yet
> a PR): CRIT-1 fixed (`apply_effects` now calls `enqueue_effect_jobs`
> with an existence check; T16 claims the job as the worker would).
> **CRIT-2 fixed and confirmed WORSE than reviewed**: beyond the
> reveal-audit trigger, `key_fingerprint` sat in the frozen-column set,
> so BYOK rotation had never succeeded once for ANY key, not just
> revealed ones — now the fingerprint may change only when `key_ref`
> changes in the same statement. T1 fixed (a third CRIT): a successful
> replay was recorded as a permanent failure via a silent early-return
> guard, now reopens the effect properly. HIGH-1 fixed, with a real
> negative result: the first version of the new permission check ran
> after payload validation, so an unauthorized refusal leaked the
> action's own payload schema — now checked immediately, pinned to leak
> nothing. S5 (13 refusals moved off the wrong error code), S3 (fixed,
> confirmation owed on hosted — can't be proven on the local shim), S7
> (pin headers now correctly scope the 014 dependency to the pin, not
> the migration) all fixed. Deliberately deferred to backlog, confirmed
> by absence from the diff: bulk_decide's response shape, the worker
> heartbeat bug, and 013's no-consumers question. T5's diff-hash guard
> routed to `fix-014` now, not deferred. Counts unchanged: 18/18, 17
> pins, 52/52, check:grants 0. Re-review reported dispatched. Full
> detail in `ai/workstreams.md`.

> **BLAST 13 Sep 23:4x +08** — `fix-018` pushed three more commits to
> `lane/rpc-018`, tip `1f300e9`, closing B4 and B6. **B4**: `test_014`
> stays exactly 121 (not moved to 124), 018's three views excluded by
> name, its own delta asserted in `test_018` T38 (SELECT-only, none for
> `anon`). Confirmed not 018's invention — `test_014` hasn't been
> standalone-runnable since 017's own amendment pass. **B6**: a new
> `app.seeded_pipelines` ledger records exactly what the seed inserted;
> `app.unseed_pipelines()` deletes exactly those rows and refuses with
> counts and constraint names when referenced, deleting nothing on
> refusal — proved by running it (18 ledger rows removed, a default
> ENGAGEMENT pipeline insert then succeeds). R4 rewritten to re-derive
> ids and count survivors instead of checking the wrong trigger. B5's
> transaction wrapper confirmed still in effect from the earlier push,
> not new this round. Every fix ships the fixture that would have caught
> it (full table in PR body). **M4 still NOT fixed, catalog now says so
> honestly**: the trigger stays in 018 for tonight, stated as "a reason,
> not a justification." **The 019 split ruling is confirmed still
> pending, being applied now — no `019_*` file exists yet.** Counts:
> branch base 18/18 through a full rollback/reapply/rollback-again
> cycle; against `cloud/migrations`'s current `0d9e00c`, 16/2 without
> 018 (pre-existing red), 13/6 with 018, identical after reapply. Rebase
> deliberately held until the base is frozen. Full detail in
> `ai/workstreams.md`.

> **BLAST 13 Sep 23:5x +08** — `fix-014` pushed `eff8084`, **reported
> FROZEN as the merge candidate**, confirmed current tip of
> `cloud/migrations`. Fixes 017's own retrofit BLOCK: two walls in
> series — a `margin_rate` scale guard that was unconditionally true
> (GENERATED numeric division always has scale 20), now checks whether
> rounding actually changes the value; then SQLSTATE 55006, fixed with
> `SET CONSTRAINTS ALL IMMEDIATE` after the SST backfill, NOT NULL kept
> rather than downgraded to NOT VALID. New pin refuses unless run over a
> 001-016 DB already holding a quotation. T1 fixed (a replay pin proving
> `SETTLED`, not silent no-op). T5 fixed: `app.plan_effects` measured
> IMMUTABLE, so the diff-hash guard could never fire by construction —
> now covers `{effects, value}`, with a quotation-edit pin requiring the
> hash to move (a purely structural assertion would have passed against
> the broken version). 015's dead assertion moved above the aborting
> loop. 016's two residuals closed, `app.tenant_seed_checks` now RLS
> FORCED. Counts: 18/18 apply, 17 pins + 2 apply-context pins that
> correctly refuse, `lint:sql` 53/53, `check:grants` 0. Open HIGHs
> named: bulk_decide shape stays on backlog; the worker heartbeat bug is
> now an active lane (`fix-worker-heartbeat`, confirmed via worktree,
> branch `fix/worker-heartbeat`, not yet pushed). Final whole-branch
> re-review dispatched to `docs/reviews/2026-09-13-pr6-final.md`
> (confirmed doesn't exist yet). `fix-018` doing the 019 split next,
> then its single final rebase against this frozen base. Full detail in
> `ai/workstreams.md`.

> **BLAST 13 Sep 23:6x +08** — **Frozen-tip correction, benign**:
> `cloud/migrations` now sits at `a20e6d8`, one commit past `eff8084`,
> reported as one crossed push rather than an error in this thread's
> prior recording. `a20e6d8` closes T5 end to end (the mechanism landed
> in `eff8084` already). **No client change needed**: confirmed by
> reading the source, `ApprovalDetail.tsx:170` only echoes
> `detail.diffHash`, never computes one — the only `hashDiff()` anywhere
> is in the mock `FixtureClient.ts`. Canonical form confirmed written
> into 011 and the pin: SHA-256 over `{effects, value}` at queue time,
> stored, exposed on the view, echoed by the client — avoiding two
> implementations of one serialization agreeing forever. What it detects
> is precisely the READ-to-DECIDE gap, not client tampering — new pin
> T19 confirmed to admit an unchanged echo and refuse `DIFF_CHANGED`
> after a reprice, both ways. Staging choice explained: `QUOTATION_APPLY`
> is confirmed the only action type whose value reads the record being
> edited. Fixture note worth keeping for future pin authors: money-path
> pins need real `aal2` `auth.sessions` rows for both parties, confirmed
> in the diff. **Inherent limit for the log, confirmed at 011's own
> line 76**: `PROPOSAL_SEND`'s `value_source = NONE`, so this mechanism
> cannot detect a record change for that action type at all. Counts
> confirmed unchanged from `eff8084` (single test-file diff). Full
> detail in `ai/workstreams.md`.

> **BLAST 13 Sep 23:7x +08** — PR #26 confirmed MERGED (`664a477`), one
> file amended (not a new file, +189/-23) — the 015-017 re-review doc
> grows a "Part A" covering 014's third pass at `ff01f2b`. **014's
> second-pass residuals all genuinely closed by adversarial execution**:
> run:read gate confirmed covering exactly 9 tables, `app.
ungate_tenant_policy()` (already fixed twice) passed a full 7-case
> adversarial sweep with no third failure, T11a proven non-tautological
> by planting a real DELETE grant and confirming the new pin catches it
> while the OLD pin's own assertion still passes. **But 014 is BLOCK on
> a genuinely new, live defect: `core.bulk_decide_approvals` forwards
> with the diff hash hardcoded NULL, bypassing HIGH-4's guard on a path
> granted to `authenticated` and reachable today** — the shipped comment
> claims "closed on both sides," which is confirmed false for this path
> (blast radius bounded by a monetary-type exclusion, but "bounded" ≠
> "closed"). Second finding, confirmed found independently by three
> lenses: `p_migration` validates position not value — NULL/empty string
> silently accepted (ownerless, unremovable policy), and the OLD
> three-argument calling spelling still resolves, silently producing an
> ungated policy with no error. Negative result for the log: "closed on
> both sides" was asserted from the single-decide path without
> enumerating every caller of the underlying function. **Freeze lifted
> for exactly these two fixes on `fix-014`, re-freeze to follow;
> `fix-018` holding its rebase.** Full detail in `ai/workstreams.md`.

> **Last updated:** 2026-09-13 23:7x — PR #26: 014 BLOCK on a live
> bulk_decide diff-hash bypass; freeze lifted for two named fixes.

### Focus

Getting the API phase moving (018 RPC pack, hosted apply once 014 passes
retrofit QA) while three UI carry-over lanes close out contrast, list-leaf and
empty-state debt from the verifier pass, without losing the SUPABASE SCHEMA
thread's state (013 committed; 014–017 in cloud) or any in-flight cloud PR.

### Next Active Task

Record each lane's result in the doc spine as it lands (one commit per
update, by `spine-keeper`), then fold ui/tokens, ui/lists and ui/states back
into the kit per CLAUDE.md's consolidation rule once merged.

### Blockers

**GitHub Actions is down for billing reasons on every branch, confirmed
directly, since ~20:36 on 13 Sep — needs the user in GitHub Billing &
plans for `PARALLELPARADIGMS`.** No CI signal is available anywhere until
this is fixed; merges proceed on local gates plus independent review in
the meantime, logged as "CI unavailable, billing" rather than a CI
reference.

**014's original CRITICAL findings are fixed and pushed, but a MERGE
verdict is blocked on Codex quota until 14 Sep 00:29** — confirmed
verbatim. 015–017 remain fully BLOCKED per PR #18, their own fix not yet
pushed. 018 is at 6 confirmed Blockers per PR #21. None of this line
merges until every pack has a real reviewed-and-clean verdict, ahead of
R-F. **014's SQL file itself is now on `main`
regardless** (landed via PR #12's merge as review evidence, confirmed via
`git show 02240e6 --stat`), separate from PR #6, which is still open and
unmerged — its presence in `supabase/migrations/` is not approval; the
BLOCK verdict governs. Four items still need the user: exposing
`core` in the dashboard (R-F, **confirmed still not exposed** by a direct
`PGRST106` probe at 19:5x), n8n in the proposal, and the four UI rulings
tracked in `ai/resume-brief.md`. Branch protection on `main` cannot be set
at all on the current GitHub plan/visibility (403, confirmed 19:40) — needs
a user decision to upgrade or make the repo public.

## SESSION 2026-09-13 — UI BLAST LANDED, CONSOLIDATION

> **WRAP 13 Sep 19:05 +08** — outage recovered; routing and worker PRs merged; migrations 014–017, web-swap and pack-v3 relaunched in the cloud on `cloud/*` branches. Start from `ai/resume-brief.md` 19:05 entry; check GitHub PRs first.
>
> **WRAP 13 Sep 13:55 +08** — UI paused by user decision; all 45 nav leaves built; API phase next. Start from `ai/resume-brief.md` (research blast E, migrations A, API-layer decision C). Previous wrap note kept below for history.
>
> **WRAP 13 Sep 11:52 +08** — session cleared for context. Start the next session from `ai/resume-brief.md` (agents to relaunch, blast A–E, eyeball list). In-flight at wrap: shell-fix, applier-2, proto-header — check `git log` for their last commits before relaunching.

> **Last updated:** 2026-09-13 — twenty-seven screens across fourteen features are
> mounted and reading fixtures; the kit absorbed the duplicates they were each
> carrying; `useApi`/`useAction` is the consolidation still open.

### Focus

Closing the divergence the parallel screen build left behind. Fourteen feature
lanes wrote screens at once against `@trainos/fixtures`, and each lane carried a
private copy of whatever the kit did not have yet — an outcome banner, a tone
map, a date-range formatter, a breadcrumb, a data hook. The kit now owns all of
those, so this session moves the last local copies out and closes the two shared
hooks five features still declare privately and mark TEMPORARY.

### Shipped

- **Twenty-seven screens across fourteen features**, each built only from the
  kit and reading only the fixture client, with render tests over the fixtures
  and light and dark screenshots at 1440x900.
- **The component kit**: tokens supplement, chips, layout, data table, filter
  bar, pill tabs, AI/approval/agent components, overlays and inputs, plus the
  `/dev/kit` showcase that is its contract with the screen lanes — a pattern not
  on that page is not in the kit.
- **The route table closed.** All fourteen features declare their own array;
  `FEATURE_ROUTES` is spread BEFORE the generated nav placeholders, and
  `PUBLIC_ROUTES` mounts the client portal as a sibling of the shell.
- **The breadcrumb lifted to the shell.** A screen declares a trail through
  `useBreadcrumb` and the 56px top bar renders it. No screen draws its own.
- **`ActionOutcome` consolidated into the kit** after five independently written
  copies, three of which had already diverged.
- **`@trainos/fixtures`**: the seed dataset for the whole demo story, an
  in-memory client over the contract surface, and 116 tests.
- **`@trainos/agent-runtime`**: BYOK provider layer, §17 routing, the
  orchestrator, run slicing for the 400s worker, and a browser-safe default
  entry pinned by a module-graph test.
- **Migrations 001 to 009 authored and EXECUTED** on a local PostgreSQL 17.11
  shim. Nothing applied to any hosted database.
- **Five architecture documents and a two-part critic review**, plus the agent
  JWT-minting spike that settled agent auth.
- **The dev gallery stopped shipping.** A production build was emitting the
  showcase as a 175 kB chunk nothing could fetch; `vite.config.ts` now aliases
  the dev route module to an empty array in production.

### Next Active Task

Finish the `useApi`/`useAction` consolidation. Seven feature `api.ts` files
declare a local `useApi()` marked `TEMPORARY SHAPE`, and `dashboard/client.ts`
and `approvals/client.ts` each carry a private `toApiError` adaptation because
`shared/api/errors.ts` recognises only `ApiErrorException` and therefore reads a
thrown `ContractError` as a transport failure — which puts a retry button on a
policy refusal, the exact R2 collapse CLAUDE.md warns about. Move one `useApi`
and one `useAction` into `src/shared/api`, make `errors.ts` recognise a
`ContractError` structurally rather than by `instanceof`, then delete the nine
local copies and the two `StandInField.tsx` stand-ins once the kit ships
`TextField`/`DateField`. The verifier pass runs after it.

**Superseded 2026-09-13 10:40 by `d4ae83d` — the consolidation is done.** The
task above is complete and is left standing rather than rewritten, because the
shape of what was found is worth more than the instruction. Thirteen modules had
grown their own copy of the hook in four incompatible shapes, not the seven this
block counted. `shared/api/useApi.ts` is now the only one and `ApiProvider` is
mounted at the root. `toApiError` recognises a `ContractError` and carries its
code, status, details and approval reference through, and a test renders a 403
and asserts the retry affordance is absent **even when `onRetry` is passed** —
the component refusing it is what stops a caller reintroducing the defect. The
scaffold's `TrainOsClient` interface and its all-`NOT_IMPLEMENTED` stub are
deleted: nothing imported them, and a second client surface beside the real one
is the divergence CLAUDE.md forbids.

**The new next action is the verifier pass.** It is the only thing left that
gates everything else, and nothing in this repository has been verified by
anyone but the lane that wrote it. After it: the kit duplicate sweep, which is
now down to the two `StandInField.tsx` copies waiting on a kit `TextField` and
`DateField`, and pointing the agent runtime at the contract's new `RESUMABLE`
run status instead of its own wrapper.

**Updated 2026-09-13, earlier the same morning.** Two concurrent lanes landed
while this block was being written. `af92507` finished the `ActionOutcome`
consolidation — finance, hrdc and engagements all import the kit's now — and
moved the last five screens that drew their own `Breadcrumb` onto the shell's
slot, so those are done rather than in the working tree. `e148a34` landed
contract rulings R4 to R8, which closes four of the twelve reported contract
gaps and adds a `RESUMABLE` member to `RunStatus`; the agent runtime still
reports a yielded run as `RUNNING` with the disposition on its own wrapper and
should now be changed to use the contract's member. Neither changes the next
action above: `useApi` and `useAction` are still declared seven times.

### Blockers

- **The Supabase lane is PAUSED at migration 009** with critic Part 2 open — 7
  critical and 29 high. `supabase/HANDOFF.md` carries the resume pointer and the
  seven rulings not yet applied to migrations.
- **CI has never executed.** There is no remote and no branch protection, so the
  17-job pipeline has never run once against this repository. Every "green"
  claim in this session is a local run.
- **CI secrets are unset**: `VITE_SITE_URL` and `VITE_API_BASE_URL`.

### New durable artifacts

`ai/workstreams.md`, `ai/state-backlog.md`, `ai/project-log.md`,
`ai/findings-log.md`, `docs/reviews/2026-09-12-ui-blast-lane-review.md`,
`packages/fixtures/**`, `packages/agent-runtime/**`,
`apps/web/src/shared/components/kit/**`, `apps/web/src/features/**`,
`apps/web/src/routes/**`, `supabase/migrations/001`–`009`,
`docs/architecture/01`–`06`, `docs/architecture/spikes/**`.

---

## SESSION 2026-09-12 — REPO FLOOR LAID

> **Last updated:** 2026-09-12 — the scaffold is in and every gate runs clean.

### Focus

Standing up the TrainOS repository on the house stack so a React team can start
building kit components and screens immediately: workspaces, build config,
design tokens, the app shell, the data boundary, the guardrail stack, CI, and
the doc spine.

### Shipped

- npm workspaces monorepo; `apps/web` depends on `@trainos/contract` by name.
- Four tsconfigs including the strict ratchet, shipped with an empty allowlist.
- `src/styles/tokens.css`: every light token and the full dark map as a straight
  token swap, stored as RGB triplets so Tailwind alpha modifiers work.
- next-themes with `data-theme` and three states; the token swap is the whole
  theme.
- Sidebar + topbar shell at the pack's dimensions, role-filtered from one config
  pass, with the route table generated from the same tree.
- The typed client boundary: one interface by contract section, 41 methods, a
  `{ data, error }` Result, and a domain-versus-transport error split.
- EmptyState, LoadingState, ErrorState.
- Two hook tiers, 17-job CI whose summary fails on `skipped`, dependency-cruiser
  with both boundary rules probed, a bundle baseline, and three Supabase-coupled
  checks running clean against the live migrations.

### Next Active Task

Wire the HTTP client behind `TrainOsClient` and let the fixtures package replace
`fixture-client.ts` method by method. Nothing else in the app moves when that
happens — that is what the boundary is for. The first screen to build is the one
the approvals queue needs, since it exercises the approval envelope, the badge
count and the fire-and-forget mutation rule all at once.

**Correction (2026-09-13) — what actually happened.** The plan above is left
standing because a reader who half-remembers it needs the correction rather than
silence. None of it ran as written. The HTTP client behind `TrainOsClient` was
never wired and no method of `fixture-client.ts` was replaced; instead
`@trainos/fixtures` shipped as a separate workspace package with its own
in-memory client over the whole contract surface, and every screen imports that
package directly through a local `useApi()` rather than through the
`shared/api` boundary the scaffold built. The approvals queue was not first
either — the database, contract, architecture, kit and fixtures lanes all ran
ahead of it, and M02-S01 landed in the middle of a twenty-seven-screen batch
(`e811fd4`). The boundary's claim that nothing in the app moves when the client
changes is therefore still untested: the thing it was meant to protect went
around it. Closing that is the consolidation named in the 2026-09-13 block,
which `d4ae83d` completed the same morning by deleting the boundary rather than
wiring it: the interface described a seam the app had already outgrown.

### Blockers

- **Branch protection is not on.** Nothing in this repo can turn it on. Until
  the blocking checks are required on `main` in the host's settings, the
  pipeline is decoration.
- **CI secrets are unset**: `VITE_SITE_URL` and `VITE_API_BASE_URL`.

### New durable artifacts

`CLAUDE.md`, `AGENTS.md`, `README.md`, `ai/*`, `scripts/*`,
`.github/workflows/ci.yml`, `.dependency-cruiser.cjs`, `.semgrep/rules.yml`,
`apps/web/**`, `docs/design/**`.

---

<!-- Session block template — PREPEND a new one, never overwrite:

## SESSION YYYY-MM-DD — <ALL-CAPS TITLE>

> **Last updated:** YYYY-MM-DD — <one line>

### Focus
<what this session is actually about, one short paragraph>

### Shipped
-

### Next Active Task
<the exact next action, cold-startable — someone with no context can begin here>

### Blockers
<or "none">

### New durable artifacts
<files created that outlive this session>

---
-->
