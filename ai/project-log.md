# Project Log

> The journal. Latest first, append-only, one block per day with an entry per
> lane. Never edited once written — a day that turns out to have been wrong
> gets a correction in a later block, not a rewrite of the old one.
>
> The numbered **"things worth telling future-me"** list at the end of each
> block is the most valuable habit in this file, and it is deliberately a list
> of negative results: a wrong assumption that got refuted, a hypothesis that
> was measured and failed, a process lesson. Outcomes survive in `git log`; the
> reasoning that turned out to be wrong does not, unless it is written here.
>
> `ai/state.md` also carries a Session Log. That one is the short form for a
> reader already inside `state.md`; this is the full per-lane record.

---

## 2026-09-13 19:5x — main CI red since 9fdcb4d, PR #6/#7 open, fix-lane name mismatch, R-F confirmed live

**Main is red, not just PR #5.** Checked `gh run view` on run 34753909066
(triggered by `9fdcb4d`, "docs(state): pack v3 merged") directly: it fails
Gitleaks, Prettier (drift check), Vite build and npm audit (high+) — the same
four PR #5 fails. Every PR opened since inherits all four regardless of its
own diff. A lane (Opus) was redirected to fix main's CI first, then merge
main into `cloud/web-swap`, reportedly on branch `fix/main-ci`.

**Naming mismatch found while verifying.** The actual worktree is
`~/Repos/personal-work/trainos-wt/fix-pr5`, on branch `fix/pr5` (tracking
`cloud/web-swap`), not `fix/main-ci`. Its tip commit as of this check is
`refactor(web): route the approval screens through the seam` — web-swap
feature work, not a CI fix. Recorded as-is rather than assuming either the
report or the branch is wrong; whoever resumes this should check that
worktree's log before assuming CI repair has started there.

**PR #6 (`cloud/migrations`, "feat(supabase): migrations 014–017") is open**
and gated on `codex-review-014-017` (Codex gpt-5.6-sol xhigh, its own shim on
port 5435) reporting MERGE / MERGE-WITH-FIXES / BLOCK to
`docs/reviews/2026-09-13-codex-retrofit-014-017.md`; it does not merge before
that verdict. It also fails Grant Hygiene — confirmed the exact finding:
`supabase/tests/test_014_rls_policies_and_client_grants.sql:513` defines a
`SECURITY DEFINER` function, which `check:grants` flags because a test must
not be able to create the privilege escalation it is meant to check for. The
review must explain or fix this.

**PR #7 (`ci/gitleaks`, "ci: run gitleaks binary directly, no license
needed") is open.** Gitleaks itself now passes on it — the fix works — but
`gh pr checks 7` (run 34754819325) shows the same three main-red failures
(Prettier, Vite build, npm audit) still present. The report that PR #7's
"checks [are] green so far" is wrong by the same margin as PR #5's report
was; fixing one gate does not clear the other three, which are repo-wide, not
lane-specific.

**R-F confirmed by direct probe, not just reported.** Got the hosted
project's URL and publishable key from the Supabase MCP
(`get_project_url`, `get_publishable_keys` for `balzmmsmrawzmefkavte`) and
called its REST endpoint myself with `Accept-Profile: core`. Response was
exactly `PGRST106`: `"Only the following schemas are exposed: public,
graphql_public."` This matches the report precisely — `core` is genuinely
not exposed, and it is the one thing actually blocking the first hosted
apply once 014 clears review.

**Two things worth telling future-me:**

1. A status report and the underlying evidence can each be individually true
   and still add up to a wrong overall claim. "PR #5 is green except
   Gitleaks" and "PR #7's checks are green so far" were both probably true at
   the instant Gitleaks was the freshest signal someone looked at — but
   `gh pr checks` for both PRs had three more failures sitting in the same
   output the whole time. Read the full check list, not the most recent job.
2. A lane's reported branch name is not guaranteed to match what is on disk.
   `fix/main-ci` does not exist; `fix/pr5` does, tracking a different intent
   (web-swap fixes) than what was reported (main CI fixes). Worth a `git
worktree list` / `git log` check before trusting a branch name in a status
   report, the same way a commit hash or a CI claim gets checked.

---

## 2026-09-13 19:4x — PR #5/#6 open, RPC gap found, seeds and codex-review lanes, repo-name note

**PR status (verified, not taken on trust).** PR #5 (`cloud/web-swap`) and PR
#6 (`cloud/migrations`) are both open against `PARALLELPARADIGMS/alex-project`.
The team lead reported PR #5's gates as "green except Gitleaks"; checking
`gh pr checks 5` against run 34754549631 directly found that claim wrong —
four checks fail, not one:

1. **Gitleaks** — as reported: `gitleaks-action@v2` errors `missing gitleaks
license` because the repo is an organisation repo and has no
   `GITLEAKS_LICENSE` secret. `ci-gitleaks` (worktree `trainos-wt/ci-gitleaks`,
   branch `ci/gitleaks`) is swapping the action for the pinned binary.
2. **Prettier (drift check)** — real, unrelated drift in
   `apps/web/scripts/check-barrels.mjs`; not mentioned in the report.
3. **npm audit (high+)** — 8 real vulnerabilities (5 moderate, 1 high, 2
   critical) in the `vite`/`vite-node` and `react-router`/`react-router-dom`
   chains; `npm audit fix --force` would force a breaking
   `react-router-dom@7.18.3` and needs a deliberate decision, not an
   autofix; not mentioned in the report.
4. **Vite build** — the build step itself passes; only the
   `actions/upload-artifact@v4` step fails, on "Artifact storage quota has
   been hit," a GitHub Actions account-level limit rather than a code
   defect; not mentioned in the report.

**RPC gap (confirmed).** PR #5 diffs in ten `RPC_NAMES` entries in
`apps/web/src/shared/api/rpcClient.ts` with no SQL behind them:
`patch_enquiry_extraction`, `list_follow_ups`, `get_follow_up_draft`,
`list_proposals`, `add_proposal_section`, `put_proposal_section`,
`regenerate_proposal_section`, `list_quotations`, `get_rate_card`,
`get_audit`. `lane/rpc-018` is now implementing all ten as part of 018,
marking "spec derived from client" wherever `docs/architecture/09` has no
spec for one.

**New lanes.** `seeds` (Opus, worktree `trainos-wt/seeds`, branch
`lane/seeds`, shim port 5434): `supabase/seeds` fixture world, wipe script
and pin, per the user's 19:27 goal "write seeds too for test purposes."
`codex-review-011-013` (Codex gpt-5.6-sol xhigh via `codex-rescue`, worktree
`trainos-wt/codex-011-013`, branch `review/codex-011-013`): D-012
adversarial review of packs 011–013 to
`docs/reviews/2026-09-13-codex-retrofit-011-013.md`; fallback order if Codex
is unavailable is Kimi (not installed locally, effectively skipped) then a
second Opus reviewer. Codex quota reported back at a 19:29 probe — not
independently re-verified here.

**Repo-name correction.** The GitHub repo is `PARALLELPARADIGMS/alex-project`,
confirmed via `git remote -v`. "trainos" is only the local directory name and
the `@trainos/*` npm package scope — nothing in the repo's GitHub identity.
Recorded here and in `ai/workstreams.md`'s CI thread so a future session does
not search GitHub for "trainos" and conclude the repo does not exist.

**Also found, unprompted:** the CI AND BRANCH PROTECTION thread in
`ai/workstreams.md` was itself stale — it said the pipeline "has never
executed," which stopped being true once PR #5 and PR #6 started running
seventeen jobs each. Corrected in place. Separately, branch protection on
`main` cannot be configured at all on the repo's current plan/visibility:
`gh api repos/.../branches/main/protection` returns 403 "Upgrade to GitHub
Pro or make this repository public to enable this feature" — a decision for
the user, not an implementation gap.

**One thing worth telling future-me:** a lane's own status report is not
verification. The team lead's "gates green except Gitleaks" was probably
copied from Gitleaks being the most recently-seen failure rather than a full
check of the run — three other real failures were sitting in the same `gh pr
checks` output the whole time.

---

## 2026-09-13 19:35 — correction: worktree paths for the 19:25 blast

The 19:25 entry below named `lane/rpc-018`, `ui/tokens`, `ui/lists` and
`ui/states` as worktree lanes but did not record the worktree paths, and its
HEAD claim (a "chore: prettier pass" commit on top of `9fdcb4d`) was wrong —
the formatter pass produced nothing to commit and `9fdcb4d` was HEAD.
Correcting per the team lead: all four run under
`~/Repos/personal-work/trainos-wt/{rpc-018,ui-tokens,ui-lists,ui-states}` on
branches `lane/rpc-018`, `ui/tokens`, `ui/lists`, `ui/states` respectively,
each opening a PR to main. `ai/workstreams.md`, `ai/hot-state.md` and
`ai/resume-brief.md` have been updated in place with the paths since none of
them are append-only.

---

## 2026-09-13 19:25 — headless blast (API phase + UI carry-over)

**Recovery context.** A network outage at ~16:00 killed the local migrations
lane mid-014 and the first cloud migrations lane; nothing of 014–017 landed and
no dirty SQL was left. By 19:05, PR #1 (routing) and PR #2 (worker) had merged
to main, and `cloud/opus-pass` (PR #3) and `cloud/pack-v3` (PR #4) had also
merged. This block records the six lanes running as of 19:25, launched by the
orchestrator on top of that recovery.

**Cloud lanes (continuing from 19:05, no PR yet):**

- `cloud/migrations` — migrations 014–017 from a fresh shim. Owner files:
  `supabase/migrations/014*` through `017*`.
- `cloud/web-swap` — enquiries → proposals → approvals swapped from
  `@trainos/fixtures` onto the `TrainOsClient` seam. Owner files:
  `apps/web/src/features/{enquiries,proposals,approvals}/**`.

**Worktree lanes (launched 19:25):**

- `lane/rpc-018` — the 018 RPC pack. Owner files: `supabase/migrations/018*`.
- `ui/tokens` — kit contrast tokens plus mono-uppercase reduction. Owner
  files: `apps/web/src/shared/components/kit/**` (tokens only).
- `ui/lists` — HRD Corp + Invoices list leaves, Collections §10b conformance,
  zebra on two hand-rolled tables. Owner files:
  `apps/web/src/features/{hrdc,invoices,collections}/**`.
- `ui/states` — nine empty states, ten tone ternaries, Drawer primary scope,
  `ListToolbar` on the agent registry. Owner files: feature screens named in
  `ai/resume-brief.md`'s verifier carry-over section.

**User rulings recorded at 19:23:** go for 018; go for the first hosted apply
after migration 014 passes `migration-retrofit-qa`; region Singapore confirmed
by the user and by the hosted project itself (`balzmmsmrawzmefkavte`,
ap-southeast-1, ACTIVE_HEALTHY, zero migrations applied, reachable via the
Supabase MCP so the apply lane uses `apply_migration` rather than psql plus a
DB secret). Still open for the user: exposing `core` in the dashboard (R-F),
n8n in the proposal, and the four UI rulings tracked in `ai/resume-brief.md`.

**Pruned from workstreams (both ✅ DONE, "Resume: Nothing"):**

- **UI SCREENS** — twenty-seven screens across fourteen features (closed
  2026-09-12). All fourteen features declared their own route array in
  `FEATURE_ROUTES`; every screen was built from the kit and read only
  `@trainos/fixtures`, never a real API response. Superseded by CONSOLIDATION.
  Refs: `apps/web/src/features/**`, `apps/web/src/routes/routes.tsx`,
  `docs/research/09-design-pack-inventory.md`, `D-114`, `D-116`.
- **CONSOLIDATION** — one data seam, closed by `d4ae83d` (2026-09-13 10:40).
  Thirteen modules had grown their own copy of the client hook in four
  incompatible shapes; `shared/api/useApi.ts` is now the only one and
  `ApiProvider` is mounted at the root. The load-bearing fix was `toApiError`
  misclassifying a thrown `ContractError` (a policy refusal) as a transport
  `UNKNOWN`, which put a retry button on a 403 — pinned as `B-012`. What
  remained (two `StandInField.tsx` stand-ins) lives on in KIT DUPLICATE SWEEP,
  which stays active in `ai/workstreams.md`. Refs:
  `apps/web/src/shared/api/useApi.ts`, `apps/web/src/shared/api/errors.ts`,
  `d4ae83d`, `af92507`, `D-115`, `B-012`.

**Things worth telling future-me:**

1. The `.env.local` the api-phase plan (`ai/briefs/2026-09-13-api-phase-plan.md`)
   references does not exist at the repo root as of 19:25 — do not assume a
   lane can read it without first checking.
2. `pg_isready` against `/tmp:5432` reports no shim running as of 19:25, so
   whichever migrations lane runs next must start one per
   `supabase/HANDOFF.md` rather than assuming the shim from an earlier session
   is still up.

---

## 2026-09-13 — consolidation, and the doc spine backfilled

**Consolidation (web).** `ActionOutcome` deleted from finance and hrdc, both now
importing the kit's. `programmes/labels.ts` added so the HRD Corp scheme names
stop going through the kit's generic `humanise`, which rendered `SBL_KHAS` as
"Sbl khas" — a proper noun is a table, not a transformation. `useApi` and
`useAction` are the remaining duplicates and are the session's named next action.

**Contract (contract).** Rulings R4 to R8 batched and applied in `e148a34`:
`OPENROUTER` and `OTHER` join the provider vocabulary, so the provenance badge
stops claiming an OpenRouter call was served by OpenAI; `RunStatus` gains
`RESUMABLE`, so a yielded run no longer has to report `RUNNING` with its real
disposition on a wrapper outside the contract; `Quotation` gains both floors and
`bindingFloorBasis`; `Engagement.finance` becomes optional so the OPS projection
types as an `Engagement` rather than as an `Omit<>`; and
`CollectionNextAction.type` widens to `AnyActionType` so the collections
ladder's last rung can name the action it performs. Each ruling removed a local
decorator that had been computing the same thing outside the contract.

**Fixtures (fixtures).** The dataset gains the records the screens' empty and
at-risk states needed — a lost deal, a delivery at risk, a completed engagement
whose claim window closes in three days, and the tax invoice its packet cites —
because a screen reaching for a state the dataset cannot produce is how hardcoded
data gets into a component.

**Data seam (web).** `d4ae83d` closed the consolidation. Thirteen modules had
grown their own copy of the client hook in four incompatible shapes, and the
count in every document written that morning — seven — was wrong. The defect
underneath was live, not cosmetic: a 403 was classified as a transport failure,
so a policy refusal came with a retry button and the server's sentence naming
the missing permission was replaced by "Something went wrong". The scaffold's
`TrainOsClient` interface and its all-`NOT_IMPLEMENTED` stub were deleted rather
than wired.

**Doc spine (docs).** Four living docs added that the spine did not have:
`workstreams.md`, `state-backlog.md`, `project-log.md` and `findings-log.md`.
Twenty-one rulings from 12 September recorded as `D-102` to `D-122`. The
`2026-09-12` hot-state block's Next Active Task corrected — the plan it stated
was not what happened, and the gap is itself the finding. `CHANGELOG.md`
backfilled for the ten chunks that shipped, and a heading that a mid-line splice
had destroyed restored.

**Five things worth telling future-me:**

1. **The spine's own additive-surgery rule was broken by the lane that wrote the
   rule.** Commit `5549a35` spliced a new changelog entry into the middle of the
   previous entry's `##` heading, leaving the file with a stray line reading
   " and a trainer who cannot be in two places" and one fewer heading than
   entries. Nothing caught it: `CHANGELOG.md` is in `.prettierignore`, so no
   formatter ever parsed it, and a markdown heading that loses its `#` is still
   valid markdown. Rule 1 of additive doc surgery — anchor on a neighbour line,
   insert whole lines, never splice mid-line — exists for exactly this and was
   written down in `docs/research/05-doc-spine.md` on the same day it was
   violated. Writing a rule down is not adopting it.
2. **A doc spine that is never read cold has not been tested.** Every file in
   `ai/` was written by an agent that already knew the answers. Backfilling this
   one required reading roughly 80 commit bodies, the migration catalog, the
   handoff and the critic review — which is precisely the archaeology the
   hydration ladder exists to prevent, done by the session that owns the ladder.
   The test of `ai/` is whether the next session can skip that, and it has not
   been run.
3. **A living doc is stale the moment it is written, and the only fix is to
   correct it in the same session.** This lane's files were made stale three
   times in ninety minutes by lanes committing to the same branch: `e148a34`
   landed contract rulings recorded as deferred, `af92507` landed a
   consolidation recorded as in the working tree, and `d4ae83d` closed the whole
   Next Active Task forty minutes after it was written. Each was corrected in
   place rather than left, and each correction is marked with the commit that
   caused it. A doc spine whose value is "the next session does not re-derive
   this" cannot ship stale on the day it is written.
4. **Every count handed over in prose was wrong, and the wrong ones were all
   understatements.** Roughly 80 commits was 130. Seven copies of the data hook
   was thirteen. Five divergent `ActionOutcome` copies was five copies of which
   three had diverged. Twelve open contract gaps was eight by the time it was
   written down. The number in a brief is a memory; the number in the tree is a
   fact, and they diverge in one direction.
5. **"Verified in-session" is not the same as verified.** Several facts handed
   to this lane as settled were checked against the repository and held, but one
   — an "index sweep" — matched no artefact under that name. It is recorded in
   `ai/findings-log.md` under Unlocated, mapped to the closest thing the
   repository does contain (`B-008`) and flagged as possibly a different sweep
   entirely, rather than written up from the brief as though it were verified.
   A fact that exists only in a brief has no file behind it.

---

## 2026-09-12 — the whole floor, in one day

Nine lanes in one shared worktree on `main`, roughly eighty commits between
16:51 and 18:54. Order matters here: the research and contract lanes had to
land before anything could be built against them, and the kit had to land before
the screen lanes could stop inventing.

**Research and skill.** Nine research documents covering the stack, hooks and
CI, guardrails, Supabase conventions, the doc spine, app architecture, agent
tooling, agentic Supabase practice and the design pack — then synthesised into a
reusable `stack-bootstrap` skill with seven reference files, parameterised so it
serves a second project without edits.

**Contract.** `@trainos/contract` derived from API_CONTRACT §1 to §18, types
only, with the three §18 supersedes applied. Ruling R1 lands here: `CREATE`
normalises to `ADD` so `DiffLine.op` and `Effect.op` share one union, because §7
requires `effects[]` to equal `diff[]`. R2 renames costings to quotations, a
contract change and not only a schema one. R3 adds `ACCOUNT_TRADING_HOLD` as the
22nd action type.

**Architecture.** Five design documents — domain model and ERD, tenancy/auth/RLS,
the action envelope and policy gate, money/versioning/provenance, and
events/outbox/realtime/audit — written by five lanes in parallel and then
reconciled against each other through roughly forty cross-lane correction
commits. A two-part critic review and a spike on agent JWT minting. The lanes
disagreed productively: the domain schema flipped from `public` to `core` and
back before settling, and the applier key, the write-back signature and the
worker status vocabulary each moved three times before being pinned as tables
rather than prose.

**Supabase.** Migrations 001 to 009 authored and EXECUTED on a local PostgreSQL
17.11 shim — foundation, tenancy and permissions, 69 enum types, the shell and
`app.finalise_table()`, the sales path, the catalogue, money, delivery, and the
bitemporal compliance registry. Every one carries an executable pin; all green.
Nothing applied to any hosted database. Paused at 009 by user direction.

**Scaffold.** npm workspaces, four tsconfigs including a strict ratchet with an
empty allowlist, design tokens as RGB triplets, next-themes with three states,
the role-filtered app shell with the route table generated from the nav tree,
the typed client boundary with its `{ data, error }` Result and its
domain-versus-transport error split, the state kit, two hook tiers, a
seventeen-job CI whose summary job fails on `skipped`, dependency-cruiser with
both boundary rules probed by deliberate violation, a bundle baseline, and the
doc spine.

**Kit.** Tokens supplement, buttons, money, dates and bars; chips as the only
place status colour lives; layout with `RecordHeader`, `MetricStrip` and
`LifecycleStepper`; the data table, filter bar and pill tabs; AI, approval and
agent components; overlays and inputs on the shadcn/Radix primitives; then the
`/dev/kit` showcase with 213 tests that assert the design rules rather than the
render.

**Fixtures.** A seed dataset covering every screen the design-pack inventory
names and every state those screens render, an in-memory client implementing the
contract surface with the §3 evaluation order and a real policy table, and five
test suites including an FK-integrity walk over every reference-shaped field.

**Agent runtime.** A BYOK provider layer, §17 routing with tiers, fallback
chains and budget caps, the orchestrator with its execution tree, handoff, jury
and policy halt, run slicing so a run survives the Edge Function's 400-second
wall clock, and a lead-to-proposal demo agent that reaches `APV-2026-0771` and
halts.

**Screens.** Twenty-seven screens across fourteen features, built by six lanes
in parallel, each reading only the fixture client and building only from the
kit. The route table was closed last, because a route file that lazy-imports a
feature absent from the same commit is a commit that does not build.

**Design.** The design pack copied into the repository verbatim — thirty
artboards, the build assets, eighteen screenshots and six written records — with
a `PROVENANCE.md` naming where each artefact now lives in the app and pointing
at the two sections a builder must read before trusting a number.

**Seven things worth telling future-me:**

1. **Every defect that mattered was found by execution, not by reading.** Every
   one of the eleven entries now in `ai/findings-log.md` came from running
   something: the migrations against a real Postgres, the app in a real browser,
   the production build's actual output, `git show` on a commit. Not one came
   from a code review. The shared shape is that all of them were _valid_ — the
   SQL compiled, the route was behind a DEV flag, the class name was spelled
   correctly — and simply did not do what their author believed. That is what
   `R11` was written for, mid-session, by the lane that kept finding them.
2. **A rule stated more strongly than it is true is worse than no rule.** The
   `StatusChip` docblock claimed the three status tokens appeared in that file
   and nowhere else in the kit, and offered a grep to prove it. The grep
   disproved it at thirteen files, every one of them legitimate. The first
   person to run that grep stops believing the rest of the file.
3. **A hypothesis about performance has to be measured before it ships.** The
   kit lane suspected a missing `ResizeObserver` stub was making the Radix tests
   slow. An inert stub changed nothing; a stub that actually delivered an entry
   made a popover-heavy file 2.4x _slower_; disabling animation frames looked
   like a 21% win in isolation and did not survive a full-suite run. All three
   were reverted. The real cause is scheduled work draining and being attributed
   to whichever test happens to be running — not a per-test cost and not
   stubbable.
4. **A two-branch `CASE` over another lane's vocabulary fails silently toward
   its else branch.** One wrong constant would have recorded every delivered
   email as dead-lettered, surfacing as `PARTIALLY_FAILED` on actions that fully
   succeeded. The durable fix was not getting the constant right — it was making
   the callback raise on an unrecognised value, and pinning the seam as a table
   rather than prose, because prose reads plausibly whichever way round it is
   written. That pair of constants moved four times across as many messages.
5. **A boundary rule that passes on an empty tree proves nothing.** Both
   dependency-cruiser rules were probed with deliberate violations, confirmed to
   fire, and the probes removed. The same standard caught a test whose name
   overstated what it proved: an `enum_range` case named "returns humans only"
   asserted only non-emptiness, and would have passed with the filter it was
   named for removed.
6. **The parallel build's cost is duplication, and it arrives fast.**
   `ActionOutcome` was written five times in one afternoon and three copies had
   already diverged; two tone maps four times; `formatDateRange` twice; the
   breadcrumb five times. Not one lane was careless — each was correctly
   unwilling to block on another lane's file. The consolidation rule in
   CLAUDE.md is the answer, but it only works if the kit lands _before_ the
   screen lanes, and here it landed alongside them.
7. **`git commit --amend` in a shared worktree rewrites a sibling's commit.**
   Reported by the lane it happened to, and by its nature it leaves nothing
   behind to confirm: an amend replaces the tip, so the evidence is the thing
   that was destroyed. The index is process-wide and so is the branch tip, which
   is why `R9`'s pathspec rule is only half the protection — it stops you taking
   someone else's _staged_ work, and nothing in it stops you rewriting their
   _committed_ work. That gap is now `D-120`. Separately and verifiably, a
   mid-line splice in `5549a35` destroyed the previous entry's `CHANGELOG.md`
   heading; that one is a different failure with the same lesson.
