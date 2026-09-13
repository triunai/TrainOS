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

## 2026-09-13 21:3x — PR #17 merged, PR #11 rebased with five confirmed findings, an SST fix reported but not found in the diff

**PR #17 confirmed MERGED at `e20e1ba`.** Line references checked, not
taken on trust: `011:2598` (rpc argument), `011:2784` (`DIFF_CHANGED`
detail keys), `011:2775` (APPROVE-only guard) are all real lines in the
migration. Both lanes (`fix-approval-hash` and its reviewer) confirmed
genuinely shut down — worktrees gone from disk, not just reported.

**A caveat worth carrying forward rather than letting the green suite
speak for itself:** the conformance test's "rpc" side runs through an
oracle transport into the fixture client, not a real Postgres connection.
No test anywhere in this repository executes migration 011's actual
`RAISE` path for `DIFF_CHANGED`. A green conformance suite here proves the
two client shapes agree with each other; it does not prove the database
guard fires. That proof is what the first hosted-mode run after 014
applies is for.

**PR #11 (018) confirmed rebased onto `cloud/migrations`**, not `main` —
checked via `gh pr view 11 --json baseRefName` directly. Now 30 RPCs, 3
views (`v_budgets`, `v_model_tiers`, plus `v_organisation_relations`), 11
helpers, 228 assertions, per the report, not independently re-run (needs
the shim). Merges after PR #6; reviewed separately by `codex-review-018`
(its own shim, port 5437). `lane/rpc-018`'s worktree confirmed shut down.

**Five findings from the rebase, each confirmed directly against the
diff:**

1. 014 and 018 both created the three action-envelope gate wrappers
   (`perform_action`, `decide_approval`, `bulk_decide_approvals`) with
   different arity. `CREATE OR REPLACE FUNCTION` matches on the argument
   list, so the two did not replace one another — they became overloads
   differing by a defaulted trailing argument, and every short call
   became ambiguous. Confirmed via the migration's own comment, which
   quotes the exact verify-time error it caught: "core.decide_approval
   has 2 definitions, expected exactly 1." 014 keeps its five-argument
   version (the one exposing `p_expected_diff_hash`); 018 drops its own
   four-argument one, confirmed via an explicit `DROP FUNCTION IF EXISTS`
   in the diff.
2. Migration 017 left SST half-wired: `core.quotations.sst_rate` and
   `sst_reason` are plain columns defaulting to 0 and `'STANDARD_RATED'`
   with no trigger behind them, confirmed in the diff. 018's
   `put_quotation` now resolves the real rate via
   `app.resolve_tax_policy` on the write path. The table-level fix (a
   trigger, so paths other than this one RPC are covered too) is routed
   to `fix-014` in PR #6 rather than fixed here.
3. `core.provenance.origin` is immutable at the schema level, confirmed;
   the contract's origin flip is derived in the read projection instead
   of being written.
4. **A premise correction, confirmed by reading the script itself rather
   than trusting the claim:** `npm run check:rpc` does not detect a
   missing RPC. `scripts/check-rpc-contract.mjs`'s own header states its
   three checks are envelope shape, forbidden casts, and type source — it
   never reads `RPC_NAMES` and has no notion of function existence. A
   missing function surfaces only as `PGRST202` at runtime. Recorded as a
   genuine gap: "check:rpc existence gate" added to the backlog.
5. The pipeline stage seed for new tenants is blocked on a real
   architecture decision, not busywork: doc 01 §9 Q10's `DEAL_CHAIN`
   ambiguity is unresolved, `core.pipeline_steps` has no `outcome` column
   for R16's terminal WON/LOST states (needing an `ALTER` on 004), and a
   provisioning trigger would break two existing tests plus hit an
   alphabetical AFTER-trigger ordering trap. Consistent with what the
   SEEDS thread already records: 018 ships no per-tenant pipeline seed,
   and the fixture world owns its own pipeline rows instead.

**PR #16 now at 9 commits, not the reported `900995a` — but the gap is
inert, confirmed.** The two commits on top of `900995a` are the id-formula
commit itself and a docs-only follow-up whose own message states plainly:
"Only the comments change. Every id, every row and every assertion is
byte for byte what 900995a emitted, which is what --check reports." So
the report's head was accurate at the time and nothing behavioral changed
since.

**The pipeline-stage-id rule was corrected by measurement, and both the
wrong version and the right one are worth keeping — this is exactly the
kind of negative result this log exists for.** The originally proposed
rule ("UUIDv5 if `uuid-ossp` is installed, else md5") would have produced
different ids on the shim versus a hosted project if the extension's
availability ever differed between them — a determinism rule that isn't
actually deterministic across environments is worse than no rule. A plain
`'pipeline:' || stage_key` key also collides, because `WON` is a step
name shared by more than one pipeline; the real uniqueness is on
`(tenant, pipeline, step_key)`, not `step_key` alone. Both defects were
caught before shipping. Final rule, confirmed exactly in the current
diff: `md5(tenant_id::text || 'pipeline:' || object)::uuid` for the
pipeline row, and the same expression with `|| ':' || step_key` appended
for each step. `uuid-ossp` is confirmed not installed anywhere in
001–017, so the abandoned fallback path was never actually available to
begin with. Two new pins, `T2k` and `T2l`, confirmed present and matching
exactly, including `T2l`'s failure message spelling out the full
expression.

**Confirmed exactly three trainers are accredited, not four.** `TRN-0024`
Noora Idris carries `FALSE`/`NULL` across `ttt_certified`, `ttt_ref`,
`ttt_valid_to`, `hrd_tdf`, `hrd_tdf_valid_to` in the current row —
confirmed directly in the SQL values, consistent with (and slightly more
precise than) what was already on record.

⚠ **The SST ruling reported as corrected is NOT yet reflected in the
committed diff — checked directly, not assumed resolved because it was
reported.** Searched `quotationsSql` at the current head (`e1dca98`)
directly: it still writes no `sst_rate` or `sst_reason` field at all,
relying on 017's column defaults — the exact state the report says was
fixed to `SST-G-TRAINING-8` at 8%. Two explanations are equally possible
— the implementing commit hasn't been pushed yet, or it landed somewhere
this search didn't cover — and neither is assumed; this is recorded as an
open discrepancy for the next check to resolve, not silently corrected in
either direction. The narrower remaining USER DECISION, as reported,
survives regardless: whether tenant `akademi-perdana` is Education-Act
exempt is a policy-row decision, not a seed-code change.

**One thing worth telling future-me:** a report that says "corrected" is
a claim about intent, not a claim this log should accept without opening
the diff. Every other claim in this same message checked out precisely;
the SST one is the one exception, and finding it required actually
grepping the seed file rather than trusting the pattern that everything
else in the message was accurate.

---

## 2026-09-13 21:2x — trainer TDF entry re-corrected (a later commit superseded the last correction), PR #15 confirmed blocked, PR #17 confirmed

**Re-correction, not a new mistake: the trainer HRD-TDF entry from the
previous block was itself superseded by a later commit, and this block
re-checks it against the current head rather than trusting either
report.** The previous block correctly read the commit it checked and
found `hrd_tdf = false` on all four trainers. A further commit, `f5aa04a`
("call provision_tenant with p_id, keep TDF accreditation true"), changed
this: the three genuinely TDF-accredited trainers now carry `hrd_tdf =
true`, with `hrd_tdf_valid_to` reusing that trainer's own TTT
certification expiry rather than any invented date — confirmed directly
in the diff: `hrd_tdf: trainer.hrdTdf`, `hrd_tdf_valid_to: trainer.hrdTdf
? trainer.tttValidTo : null`, `hrd_tdf_ref: null`. The file's own comment
explains the reuse: the same three trainers hold both accreditations, so
the seed states one real convention (reuse the TTT date) rather than
fabricating a second, independent one. Three new pins confirm this is
enforced, not just commented: `T2h` (exactly 3 trainers carry `hrd_tdf`),
`T2i` (none lapsed at the fixture clock, 2026-11-14), and `T2j`, whose own
"FAIL (good news)" framing is worth quoting — it is designed to fail the
day a real, independent TDF expiry date arrives in the fixture, which is
exactly when the reuse convention should be retired. Both this entry and
the one it supersedes were correct readings of the commit each checked;
neither check was sloppy. The actual lesson is procedural: confirm a PR's
current head before restating a finding that was true of an earlier one,
especially on a fast-moving branch that gained a commit between two
verification passes minutes apart.

**PR #16 confirmed at head `f5aa04a`, 7 commits, still targeting 001–017,
merging right after PR #6.** One more commit is still coming, per the
report: deterministic pipeline stage ids shared between `lane/seeds` and
`lane/rpc-018`. Kept explicitly unconfirmed here, per direct instruction:
it is a ruling agreed between two lanes, not yet code on either side, and
recording it as landed before either lane pushes would be exactly the
same mistake as trusting a stale reviewer checkout.

**PR #15 confirmed BLOCKED, not merely draft-in-progress — checked
directly against a live failing CI run, not taken on the report.** On run
`34757075746`, even with `testTimeout` raised to `30_000`,
`knowledge.test.tsx`'s "keeps Check and Re-ingest out of every row" and
`pipeline.test.tsx`'s "offers every other stage in the card's menu" both
failed with the literal message "Test timed out in 30000ms." (The third
test named in the original diagnosis, `RowActionMenu`, was not among the
failures on this specific run — recorded as observed, not chased
further.) The refined diagnosis matches what this spine already had on
record: a CPU-bound spin inside `findBy*`'s `asyncAct` wrapper while
floating-ui keeps scheduling position work for the open menu, fixable by
a raw poll plus a synchronous `getByRole`, not by any timeout value. The
fixer's refusal to write that rewrite without first reproducing it is the
right call, not foot-dragging. `npm audit (high+)` passes cleanly on this
same run, confirming the toolchain upgrade's audit-clearing purpose works
independently of the test-timeout blocker.

**Negative result, now doubly confirmed: "raise the timeout" is a dead
lever for this specific failure.** 15 seconds failed on the runner; 30
seconds also failed on the runner. Both attempts are now on record so a
future pass does not try a third timeout bump before doing the
poll-based rewrite the diagnosis actually calls for.

**A small discrepancy worth naming rather than silently resolving:**
`fix-pr5`'s lane is reported shut down, but its worktree
(`~/Repos/personal-work/trainos-wt/fix-pr5`, still checked out on branch
`chore/vite7-vitest3`) is still present on disk as of this check. "Lane
shut down" (the orchestration state) and "worktree removed" (the
filesystem state) are different claims, and only the first was made.

**PR #17 (`fix(web): decideApproval sends the expected diff hash`)
confirmed open, 3 commits, matching its description precisely.** Closes
the client half of migration 014's HIGH finding #6. Confirmed in the
diff: `ApprovalRequest.diffHash` and a required
`ApprovalDecideRequest.diffHash` added to the contract; a new
`DIFF_CHANGED` error code, confirmed mapped to HTTP `409` in
`ERROR_STATUS` (alongside `AGENT_PAUSED` and `IDEMPOTENT_REPLAY`, the same
family); `rpcClient.decideApproval` now sends `p_expected_diff_hash`; the
fixture client enforces the identical guard on `APPROVE` only, matching
migration 011's own scope exactly; a new conformance test proves both
clients refuse a stale hash and accept a fresh one identically. **1504
tests confirmed exactly**: the PR's own test plan states "1118 + 189 +
107 + 90 tests, all passing," which sums to 1504. Under review by
`review-pr17`.

---

## 2026-09-13 21:1x — PR #13 merged, seeds now on 001–017 with a real RLS pin, a reported ruling corrected as backwards

**PR #13 confirmed MERGED at `47d56e1`.** Its own CI run still shows `CI
Summary`, Grant Hygiene and npm audit as `fail`, checked directly — it
merged carrying the two inherited main-red failures this log already
tracks, not because they resolved first. Not a defect in PR #13's diff.

**PR #16 (seeds) retargets 001–017.** A 6th commit
("feat(supabase): target 001-017, provision through 016, pin RLS
visibility") landed on top of the original five. It adds **T10**, the
pin's only assertion that measures what the product actually serves
rather than what the superuser loader can see: it impersonates Alex
Selvarajah via `authenticated` role and his JWT claims, then counts
landmark rows back through migration 014's live RLS policies. Confirmed
verbatim in the pin's own literal: `{"organisations":6,"engagements":10,
"participants":136,"certificates":78,"invoices":10,"approval_requests":7,
"pipeline_steps":16}`. The same query as a fabricated member of a
different tenant must read 0 organisations and 0 participants — also
confirmed verbatim (`T10c`). Every other assertion (T0–T9) runs as the
migration role, which is a superuser on the shim and sees past RLS
entirely; T10 is the one check standing between "the rows exist" and "the
app can actually read them."

**`cloud/migrations` resumed at the seeds lane's request, pushed
`564dd64`.** `app.provision_tenant` gains `p_id uuid DEFAULT NULL`, with
an explicit `DROP FUNCTION IF EXISTS app.provision_tenant(text,text,text)`
ahead of the new `CREATE OR REPLACE` — confirmed mandatory by reading the
migration's own comment, not assumed from the commit message: a bare
`CREATE OR REPLACE` with a changed parameter list creates a second
overload rather than replacing the function, and with both overloads
carrying defaults that cover a two- and three-argument call, every
existing caller — the pack's own test included — would fail with
`function app.provision_tenant(unknown, unknown) is not unique`. The
comment states this was reproduced on the shim before the line was
written, not assumed. The rollback drops both the pre- and
post-amendment signatures, so a database that was rolled back and forward
around the amendment can't strand either one. Four new assertions land in
`test_016`: the returned id and the stored row both carry the supplied
value; supplying an id does not bypass provisioning; explicit `NULL`
still generates one; a duplicate id is refused by the primary key rather
than silently attaching a new tenant to another tenant's rows.

⚠ **A ruling reported to this log was backwards, and it matters which
direction: confirmed directly against the file, not taken on trust.** The
report said the four accredited trainers "get invented hrd_tdf expiry +
reference (synthetic fixture, 017's CHECK requires it)." The file does the
opposite: all four get `hrd_tdf = false`, `hrd_tdf_valid_to = null`,
`hrd_tdf_ref = null`, even though three of them are TDF-accredited in the
underlying fixture data — specifically BECAUSE 017's
`trainers_hrd_tdf_needs_expiry` CHECK refuses `hrd_tdf = true` without a
valid-to date, and the seed has no genuine one to supply. The file's own
comment: "A wrong boolean that the pin asserts and the PR names beats a
fabricated expiry." The seed chose a known-wrong value over inventing a
compliance-sensitive date an auditor could later act on — the
conservative direction, not the fabricating one. Corrected in
`ai/workstreams.md`'s SEEDS thread with the direction stated explicitly,
since "backwards" is easy to silently re-invert on the next pass if only
the fact ("invents an expiry" vs "doesn't") is corrected without also
recording which way is actually safer and why.

**Pipeline step ids, checked rather than assumed identical to 018's.**
Confirmed deterministic in the generator:
`uuidFor(childKey(\`pipeline:${object}\`, "step", stage.key))`— close to
but not literally the reported`(tenant_id, 'pipeline:'||stage_key)`
formula. The claim that 018 computes an identical formula was not
confirmed and could not be: 018's own pipeline-stage seed is still an
open follow-up per an earlier entry in this log, so there is no 018-side
code yet to compare against. Recorded as unconfirmed rather than assumed
true because it sounded plausible.

**New USER DECISION queued:** SST treatment of the three fixture
quotations, currently `STANDARD_RATED` at 0%, against Malaysian training
often being exempt under the seeded Education Act policy — not resolved
here. Two more open items from PR #16: the seed's check keys overwrite two
provisioning-created positions (mechanism not independently traced), and
the action-policy scheme collision already tracked in an earlier entry.

**`fix-pr5`'s diagnosis of the three slow Radix-menu tests confirmed
precise, not a guess — read directly from the branch's own new code
comment.** Measured: the menu item lands in the DOM 13ms after the
keypress, and a synchronous `getByRole` against it costs 1ms. The 6–9
seconds each test actually takes is spent inside the `findBy*` wrapper's
`asyncAct`, while floating-ui keeps scheduling position work for the open
menu — none of it is Radix, none of it is the UI being slow. The real fix
(swap those `findBy*` awaits for a settle plus a synchronous `getByRole`,
returning roughly 21 seconds to the suite) is left for its own change
because it touches three files outside this branch's remit. The 15-second
timeout was a guess and it failed on the runner; `testTimeout` is now
`30_000`, stated explicitly in the comment as "a ceiling for a hung test,
not a budget."

---

## 2026-09-13 21:0x — PR #14 merged (main red on Grant Hygiene only), PR #16 seeds open, fix-approval-hash lane, new review-branch rule

**014's file staying on `main` via PR #12 is intentional, confirmed by
ruling: nothing applies to any hosted project without the user's own hand
regardless of what sits in `supabase/migrations/`, and PR #6's eventual
merge simply supersedes the copy already there (same content, no drift
risk).** Recorded so the earlier flag on this doesn't linger as an open
question.

**New rule for review lanes, worth carrying forward as a standing
practice, not just a one-time fix:** a review-report branch is cut from
`main` and carries exactly one doc file — never cut from the PR under
review. This is precisely the mechanism behind the "015-017 don't exist"
error corrected in the previous block: a review branch cut from the PR's
own tip has no reason to `git fetch` again once checked out, so a later
push to that PR goes invisible to the review. Cutting from `main` instead
means the review worktree was never tracking the PR branch in the first
place, so there's no stale-fetch failure mode to have. Already told to
`codex-review-014-017` for its continuation.

**PR #14 (`ci/audit-scope`) confirmed MERGED** — was reported "open
awaiting checks" minutes earlier in a prior message; real time passing
between report and check, not a wrong report. Confirmed the fix
genuinely works: `npm audit --omit=dev --audit-level=high` passes on
main's live CI run, checked directly (`gh run view` on the run
immediately following the merge). **Main is now red on exactly one job,
Grant Hygiene, confirmed on that same live run**: `test_014_..._sql:513`
defines the `SECURITY DEFINER` function this spine has tracked since
migration 014 was first reviewed, and since that file lives on `main` via
PR #12 (see above), `check:grants` fails there too, the same way it always
did on PR #6 itself. The fix arrives with `fix-014`.

**New lane `fix-approval-hash`** (Sonnet, worktree
`~/Repos/personal-work/trainos-wt/fix-approval-hash`, branch
`fix/approval-diff-hash`, not yet pushed to origin — confirmed via `git
worktree list`) is doing the client half of 014's review HIGH finding #6:
`decideApproval` now sends `p_expected_diff_hash`, closing the silent
no-op the review found. The DB-side half of that same finding stays with
`fix-014`.

**`fix-014` hit a real operational failure worth recording as a negative
result:** its first shim run collided with a foreign postmaster already
holding port 5436, and that first run silently applied migrations 001–017
into the wrong Postgres cluster before the mistake was caught. The lane
now asserts `data_directory` before every run rather than trusting the
port number alone to mean "this is my shim." Pin shim ports in
`postgresql.conf` and assert the data directory — a port number alone is
not proof of cluster identity when multiple Postgres instances can be
running on a machine.

**PR #16 (`lane/seeds`, `feat(supabase): fixture world seed, wipe and
pin`) confirmed open.** Fixture world for tenant `akademi-perdana`:
confirmed 5 commits, 17 files, 9920 total additions (`gh pr view 16 --json
files`), of which 4560 lines are in the four `supabase/seeds/*.sql` parts
plus the wipe and pin files — the reported "3,848 lines" figure was not
reproduced exactly by this count, most likely a different exclusion set
(comments, blank lines, or a narrower file selection); not disputed
further since every other figure checked out. Confirmed matching by
filename: four parts (tenant/parties, sales/money,
delivery/compliance/finance, AI-ops/agents) plus a wipe script and a pin.
Generated by a committed `emit-seed.ts` generator with a `--check` flag
CI can use to prove the generator and its emitted SQL agree, confirmed in
the diff. On the shim: seed exit 0, pin passes, wipe leaves 0 fixture
rows, re-seed passes, `lint:sql` 45/45 — all as reported, not
independently re-run here (needs the shim). Idempotence proof confirmed
as a genuinely stronger technique than usual: `pg_stat_xact_all_tables`
measured inside the same re-seed transaction reports 0 rows
inserted/updated/deleted across 98 tables, which is a transaction-local
synchronous measurement of this exact run rather than a delayed
collector's estimate.

**Three rulings from PR #16, recorded as decisions:**

1. No single-file runner exists on purpose — `lint:sql` rejects `\i`
   includes, so run order lives in the part headers and the seeds README
   instead.
2. The fixture world's one below-floor case (ENG-0198, realised margin
   29% against a 35% floor) has no column anywhere in 001–013 to hold it.
   Logged as a schema gap for the migrations backlog rather than invented;
   the pin deliberately asserts the column is STILL MISSING, so it fails
   loudly and on purpose the day a migrations lane adds one.
3. The fixture world's own 13 action policies (its own naming scheme)
   collide with tenant provisioning's 22 policies under a frozen
   `action_type` value — confirmed via the PR's own commit message:
   inserting the tenant already fires
   `app.seed_action_policies_on_tenant()`, and the seed deliberately does
   not also insert `core.action_policies`. Reconciling the two lists is a
   migrations-lane item and needs the user's word on which scheme wins;
   flagged rather than guessed at.

Twenty-two schema gaps total are enumerated in PR #16's own body (the
margin-floor column is one). Added as a "seed schema gaps" sub-item to
`ai/workstreams.md`'s SUPABASE SCHEMA thread, pointing at PR #16 rather
than duplicating the list.

**PR #13 (`ui/knowledge-tone-rename`) confirmed open**, but not cleanly
"awaiting checks" — `gh pr checks 13` shows two currently failing, Grant
Hygiene and npm audit (high+), both inherited main-red items from before
PR #14's and `fix-014`'s fixes land, not defects in PR #13's own diff. PR
#15 stays DRAFT, confirmed, explicitly not intended for merge.

---

## 2026-09-13 20:5x — correcting this log's own 20:4x claim: 015–017 were never missing, a reviewer's stale checkout said they were

**"015-017 do not exist" was wrong, and this log repeated it as fact two
updates ago.** The D-012 review's own body said "`git log --all` over the
whole repo finds no `015_`, `016_`, or `017_` file ever committed, on any
branch," and the 20:4x entry above recorded that verbatim as an established
finding. It was not established — it was a reviewer working from a stale
checkout. Confirmed by exact timestamp: `git log --format="%ai" -1 <sha>`
on `5e7c4bc` (015), `5d0f31c` (016) and `52caf6b` (017) gives 19:35:49,
19:42:56 and 19:59:54 on 13 September — all committed to `cloud/migrations`
**before** the review's own findings document was committed at 20:08:39
(`eb5b43e`). The reviewer's worktree was detached at `826bb52` — 014's
commit, from 19:30:03 — and never ran `git fetch` afterward, so by the time
it wrote its findings, three more packs had already been pushed to the
remote branch that its local checkout simply couldn't see. That is a
tooling gap in the review's own process, not a fact about the repository.

**The error compounds a mistake this log already flagged once this
session.** Two updates ago, this log corrected itself for accepting "014-017
all landed" on the strength of commit headlines without checking the
actual diff. This time the diff HAD been checked — `gh pr diff 6` in an
earlier pass genuinely showed all three files present — and the mistake was
different: a second, contradicting claim arrived from what looked like a
more authoritative source (a formal security review, VERDICT BLOCK) and
got recorded without being weighed against evidence already in hand. The
review's authority on the SECURITY findings (which are real and confirmed)
does not transfer to every factual claim inside the same document.

**What remains true and unchanged:** migration 014's two CRITICAL findings
are real, independently confirmed against the SQL in this session, and
still block PR #6. What was wrong is narrower: 015-017 were never absent,
they were simply never reviewed — for a mundane git-fetch reason, not
because they didn't exist.

**Two active lanes now, both confirmed via `git worktree list`:**

- `fix-014` (Opus, worktree `~/Repos/personal-work/trainos-wt/fix-014`,
  branch `fix/014-review`, its own shim on port 5436) is fixing 014's
  CRIT/HIGH findings directly in the migration file, writing pins that
  fail against the pre-fix SQL so the fix is provably load-bearing rather
  than asserted. Confirmed in progress: an uncommitted edit to
  `014_rls_policies_and_client_grants.sql` sitting in the worktree as of
  this check. Codex re-reviews after.
- `codex-review-014-017`'s continuation (worktree
  `~/Repos/personal-work/trainos-wt/codex-pass2`, detached HEAD at
  `52caf6b` — 017's own tip, confirming this checkout fetched correctly)
  now reviews 015-017 plus the nineteen pin edits from the first pass, into
  a separate report.

**PR #5 and two new CI PRs, all confirmed:**

- PR #5 confirmed 17 of 18 checks green at merge time (`gh pr checks 5`):
  the only red was npm audit (high+), and `CI Summary` itself passed,
  confirming `continue-on-error` genuinely kept it from blocking the merge.
  `Vitest (unit)` took 14m21s on the runner, confirmed exactly — worth its
  own follow-up regardless of the audit question.
- PR #14 (`fix(ci): make the npm audit gate block on what ships`, branch
  `ci/audit-scope`, open) confirmed: its diff removes `continue-on-error:
true` and switches the command to `npm audit --omit=dev
--audit-level=high`, with the three dev-only advisories named in a
  comment exactly as reported (`GHSA-fx2h-pf6j-xcff` vite,
  `GHSA-5xrq-8626-4rwp` vitest, `GHSA-82fw-gwwq-j7x9`
  `@vitest/mocker`/`@vitest/coverage-v8`), plus a note that production
  scope is clean at high+ except two moderate react-router advisories that
  need their own major-version work.
- PR #15 (`chore(toolchain): vite 7 + vitest 3 (dev-only audit
advisories)`, branch `chore/vite7-vitest3`, **draft**) confirmed real;
  its latest commit, `test(web): state the timeout three Radix-menu tests
have always needed`, confirms the previously-reported 15-second timeout
  fix is in progress.

**Merge order, confirmed and recorded plainly:** PR #6 merges only after
BOTH the 014 fix and the 015-017 review land clean verdicts. PR #11 (018)
merges only after its own, separate Codex review. Hosted apply stays gated
on PR #6's eventual MERGE verdict and R-F (`core` exposed on the hosted
project), whichever lands last.

**One thing worth telling future-me, and it's about process, not SQL:**
a claim inside an authoritative document is not automatically authoritative
itself. This review's two CRITICAL security findings were independently
re-derived from the SQL in this session and are solid. Its incidental claim
about which files exist was not re-derived — it was trusted because it sat
inside the same document as the solid findings, and it contradicted
something this session had already personally verified minutes earlier.
The fix for next time isn't "trust reviews less" — it's "when a new claim
contradicts your own prior verification, that contradiction is itself a
finding, and it gets checked before either claim gets repeated."

---

## 2026-09-13 20:4x — 014 BLOCKED by D-012 review, 015–017 never reviewed; PR #5 and PR #10 both merged

**Correction to this log's own 20:3x entry above: "014–017 land on PR #6"
was premature, and the error is significant enough to name plainly.** That
entry recorded PR #6 as complete on the strength of 4 commits and a
self-reported pin pass rate, and did not catch that the D-012 security
review had not yet run — or that at review time, PR #6 contained ONLY
migration 014. PR #12 (`docs(reviews): D-012 dual adversarial review — PR
#6, migration 014 (BLOCK)`) merged at `02240e6`, confirmed, with **VERDICT
BLOCK**, and its own body states directly: "`git log --all` over the whole
repo finds no `015_`, `016_`, or `017_` file ever committed, on any branch"
at the time of review. Those three packs exist in PR #6's diff now
(confirmed via `gh pr diff 6`) but were pushed after or during the review
and **have never been reviewed by anyone.**

**Migration 014's two CRITICAL findings, confirmed directly against the SQL,
not just quoted from the review:**

1. `014:625` grants **DELETE** on `public.memberships`. Migration 002
   granted only SELECT/INSERT/UPDATE. 002's self-escalation guard
   (`memberships_no_self_edit`, `002:763`) is UPDATE-only, so an aal2 ADMIN
   can `DELETE` their own membership row and `INSERT` a replacement with a
   higher role — the guard never sees a DELETE+INSERT pair. This also
   destroys 002's required soft-delete audit trail for any membership an
   ADMIN deletes this way.
2. The 014 rollback runs `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM
authenticated, anon, PUBLIC`, which strips migration 002's ORIGINAL
   grants (which 014 never touched) rather than restoring pre-014 state.
   The rollback's own post-condition then asserts zero client privilege on
   `public` as the CORRECT restored state, so a broken rollback cannot fail
   loudly — it silently leaves login/profile/team reads broken against a
   database the header claims is "restored to the state 013 left."

Five more HIGH/MED findings in the full doc
(`docs/reviews/2026-09-13-codex-retrofit-014-017.md`): all 114 `core`
tables get blanket tenant-scoped SELECT with no role/permission check
beyond tenant membership, exposing `core.ai_provider_keys` (ADMIN-only per
002), `core.public_share_tokens`, and `core.run_node_io` (full agent
prompt/completion text) to any authenticated principal in-tenant; the web
client never sends `p_expected_diff_hash` to `core.decide_approval`, making
the approval optimistic-concurrency check a silent no-op on every call
today; and the migration header/catalog both state the wrong policy and
relation counts versus the actual DDL.

**G6 (full execute-before-apply) passed and this does NOT clear the
BLOCK — the review is explicit about why.** All 14 migrations applied
cleanly, all 14 pins passed, the 014 rollback succeeded, re-apply and
re-pin were clean. None of that touches the actual findings: no pin
exercises the DELETE-then-INSERT escalation, none check that the rollback
restores `public.*` grants, none probe whether a low-privilege role can
read a sensitive table. The pin suite proves the SQL matches its own
(incomplete) test plan, not that the test plan covers what the product
actually needs authorized.

**Two housekeeping notes from the review, both worth carrying forward.**
The mandated "thermonuclear" reviewer skill
(`.claude/skills/thermo-nuclear-code-quality-review/SKILL.md`) does not
exist anywhere in this environment or in `~/.claude/skills`; a substitute
adversarial pass (`security-reviewer`, opus) was run in its place and
independently converged on both CRITICALs, so the gate's "both must land"
bar was met in substance if not by the letter. Separately, the Grant
Hygiene failure this spine already recorded against
`test_014_..._sql:513` (a test defining its own `SECURITY DEFINER`
function) is very likely a false positive: the function lives in
`pg_temp`, session-local, dropped when the pin's transaction rolls back,
so it cannot escalate anything outside the test — flagged in the review for
a one-line `check:grants` allowlist exception rather than dismissed.

**Separately, found while verifying — not announced by any lane report —
two more PRs merged:**

- **PR #5 (`cloud/web-swap`) confirmed MERGED** at `3faa627`. Enquiries →
  proposals → approvals through the `TrainOsClient` seam, plus every CI fix
  this spine tracked earlier (Prettier, the timezone pin, the
  artifact-quota `continue-on-error`), plus the ten new `RPC_NAMES` entries
  `lane/rpc-018` is implementing, are all on main now.
- **PR #10 (`ui/lists`) confirmed MERGED** at `47298f4`, head `92679c4`
  after a pre-merge rebase onto main — 1061 web tests at merge time (up
  from the pre-rebase 1009). `ui-lists` worktree confirmed shut down. **All
  three UI carry-over PRs (#8, #9, #10) are on main.**

**Three findings that surfaced during PR #10's rebase, each confirmed
directly against the current source:**

1. The claim-packet's severity ternary hid a real defect: `deadlineSeverity
=== "INFO" ? "neutral" : "warning"` is a two-branch ternary over a
   FOUR-member `Severity`, so `DANGER` and `ALERT` both rendered as
   "warning" — confirmed via the file's own comment. Now reads the kit's
   `SEVERITY_TONE`.
2. Collections' 60/30-day overdue thresholds were invented in the screen
   for a cadence the business actually configures in Settings, which the
   screen already reads via `GET /v1/collections/rules` — a rung change
   (e.g. 20/45 days) would have left the chips silently answering for the
   old numbers. Replaced with an `overdueTone()` helper that grades off the
   rungs' own `requiresApprovalFromRole` and `autonomy` fields, confirmed
   directly in the current source.
3. `apps/web/src/features/hrdc/tone.ts` was deleted after the rebase —
   confirmed absent from the tree — in favour of the kit's `SEVERITY_TONE`
   PR #8 had just landed. Concept duplication avoided at merge time.

**New follow-up (g), confirmed directly, and it explains why finding #1
above has no visible effect yet.** `StatusChip` on an accent `RecordHeader`
card renders `ACCENT_TONE` and ignores the `tone` prop entirely — confirmed
at `apps/web/src/shared/components/kit/StatusChip.tsx:118`:
`onAccent ? ACCENT_TONE : TONE[tone]`. The claim-packet header is `accent`
and never passes `plainWhenCollapsed`, so the card stays permanently shown
and the claim-window severity chip has never actually been visible on
screen — an urgent and a routine claim window render identical pixels
today, even after the ternary fix above corrected the underlying logic.
`ui-lists` deliberately wrote no DOM test for this, and said why directly
in `hrdc.test.tsx`'s own comment: "A DOM assertion here would therefore
pass against the ternary, against the map, and against a tone of 'success'
— which is a test that proves nothing," raised as a ruling request instead
of a fix. Also noted: PR #10's screenshots (opened 11:52) predate PR #9's
token merge (11:54) and do not reflect the `--primary-solid` split or the
`SELECTED_TINT` rebind.

**Three things worth telling future-me:**

1. **"N commits with the right headlines" is not the same evidence as "N
   packs actually exist and were reviewed."** The 20:3x entry trusted `gh
pr view 6 --json commits` — four commit headlines naming 014 through
   017 — without a single `gh pr diff 6 | grep "^diff --git"` to confirm
   the files were actually there, and without checking whether any review
   had run at all. A commit message is a claim the author makes about their
   own commit; it is not verification of the commit's contents, and it is
   nowhere close to verification that a security reviewer looked at it.
2. **"017 was written" and "017 was reviewed" are different facts, and a
   spine that conflates them will tell a hosted-apply lane the wrong thing
   at exactly the moment it matters most.** 015–017 existing in a diff is
   necessary but nowhere near sufficient for the hosted-apply gate this
   thread itself defined.
3. **A lane's own execution proof (pins passing, G6 clean) is not the same
   claim as a security reviewer's approval, even when both are called
   "verification."** This session already knew this in the abstract
   (CLAUDE.md's execution-protocol rule about separate review passes) but
   still let a pin-pass-rate stand in for a review verdict for one full
   spine update before the review actually landed and said otherwise.

---

## 2026-09-13 20:3x — 014–017 land on PR #6 (4/4 packs), 018 becomes PR #11, hosted-apply hard rule confirmed machine-enforced

**PR #6 confirmed complete: 4 commits, 014 through 017.** `gh pr view 6`
lists them in order: 014 RLS policies/client grants/core envelope wrappers,
015 cron schedules, 016 tenant provisioning, 017 baseline amendment.
Assertions per pack as reported: 014×51, 015×13, 016×15, 017×39. 17/17 pins
pass from a clean shim, including a full reverse rollback to zero relations
— not independently re-run here, since that needs the shim running.

**014–017 execution findings — negative results for the log, several
confirmed directly in the diff:**

1. `app.require_tenant_id` was ungranted, so RLS policies errored instead of
   denying — confirmed via the PR's own comment: "no policy in 001-013 used
   it — 014 is the first to grant it." A silent deny-by-error-instead-of-
   empty-result is exactly the class of defect a security review exists to
   catch.
2. `rule_set_versions` lacked its tenant index.
3. `budget_status` and `model_tier_status` views were found ungrantable and
   deferred to 018.
4. `SET LOCAL` was refused inside a non-volatile function.
5. The `ADD CONSTRAINT IF NOT EXISTS` trap — a known Postgres footgun this
   spine has already hit twice before this session — was hit a third time.
6. Shim caveat: `pg_cron` and `pg_net` are stubs in the local shim, so 015's
   job _registration_ is pinned but _firing_ is unverified until hosted.
7. Deferred work, not lost: the pipeline seed moves to 018; tax/HRD rows
   are PROPOSED pending a Finance verifier; four retention reapers await
   approved policy rows; four AI-ops columns await a runtime vocabulary
   that does not exist yet. Codex second pass requested on 015–017 and on
   nineteen edits made retroactively to earlier (001–013) pins.

**018 becomes PR #11** (`feat(supabase): 018 golden-path RPC pack`, branch
`lane/rpc-018`), confirmed open: 3 commits, 3 files (migration + rollback +
test — this repo's standard per-pack shape), 4955 additions total.

**018 findings, confirmed directly against the diff, not just the report:**

1. 23 of 24 `RPC_NAMES` implemented. `me_profile` (the 24th) is confirmed
   NOT implemented — the migration's own comment says so directly: it needs
   an HR table for eleven required fields that don't exist yet. One view,
   nine `app.*` helpers, 160 pin assertions plus 28 in-migration verify
   steps. `check:rpc` 0 BROKEN, `check:grants` OK, `lint:sql` 42/42, all
   reported — not independently re-run. Shim rebuilt from `initdb` on port
   5433 with a hand-written platform shim (four Supabase roles, `auth.*`,
   a storage stub, a realtime publication).
2. **R-C resolved by verification, independently confirmed by `grep`:**
   `core.tax_policies` and `app.resolve_tax_policy` genuinely do not exist
   anywhere across migrations 001–013, and 018 does not need them because
   `Quotation` carries no tax field at all.
3. A real keyset-cursor paging bug was found by the pack's own pin and
   fixed: under a DESCENDING sort, taking the array's `max` sort key for
   the next cursor picks the wrong end of the page, so page two repeated
   page one's tail — confirmed via the migration's own comment naming the
   exact mechanism and the test that caught it.
4. `SET CONSTRAINTS IMMEDIATE` fires nothing inside a PL/pgSQL
   subtransaction; replaced with an explicit read-back.
5. `DEAL_CHAIN` is confirmed a genuine, deliberately unpapered-over
   contract/schema divergence: 004's own CHECK constraint allows
   `ENGAGEMENT | OPPORTUNITY | PACKET`, while the contract's
   `PIPELINE_OBJECTS` wants `ENGAGEMENT | DEAL_CHAIN | OPPORTUNITY`. The
   migration's own comment states the reasoning for not aliasing one onto
   the other: "inventing an alias would hide a schema/contract disagreement
   that has to be settled in 003/004, not here" — and it pins a test that
   fails loudly if the divergence is ever silently resolved rather than
   deliberately reconciled.
6. Doc 09's `search_path` pin asserts a string PostgreSQL never actually
   stores — this is [[postgres-search-path-footgun]] surfacing again, the
   quoted-list form being a silent no-op.

⚠ **Hard rule, and this time confirmed machine-enforced, not just stated.**
Every `core` table is `ENABLE ROW LEVEL SECURITY` **and** `FORCE ROW LEVEL
SECURITY` with zero policies until 014's policies exist. FORCE removes the
table owner's RLS exemption, so on any project whose definer-function owner
is not `BYPASSRLS`, every read in 018 returns **ZERO ROWS, silently, as an
empty list, not an error** — until 014 lands. The local shim's `postgres`
role IS a superuser, which is the only reason 018's own pins all pass there
regardless of 014's state. Confirmed by reading the migration's own test
file directly: it asserts this as its very first check and raises the
literal notice **"018 MUST NOT be applied to a hosted project before 014"**
if it ever detects a FORCE-RLS table with no covering policy. This is now
the single most load-bearing ordering constraint on the whole hosted-apply
path, and it will catch a premature apply on its own rather than depending
on anyone remembering the rule. Follow-up slice requested for
`lane/rpc-018`: implement PR #5's ten new RPC names, rebase on
`cloud/migrations`, and add the pipeline stage seed.

---

## 2026-09-13 20:2x — PR #8 merged, main-red recount (five not four), a correction to this log's own 20:1x entry

**PR #8 confirmed MERGED at `a4ea833`** (`gh pr view 8`: mergedAt
2026-09-13T11:55:41Z), after `review-pr8`'s MERGE verdict. The reviewer ran
its own gates in an isolated worktree pinned to `6dfd281` — confirmed as the
lane's actual tip from the worktree list recorded two updates ago — reporting
typecheck clean and 1004 tests, a different number from the lane's own
self-reported 1389 (28 new); recorded as two separate counts from two
separate checks, not reconciled into one. The reviewer's recount of 8
replaced tone ternaries (not 10, the other two going to `ui/lists`) matches
what this thread already recorded independently. `ui-states` worktree
confirmed shut down. Two of the three UI carry-over PRs (#8, #9) are on main;
only #10 remains under review.

**Main-red was five failing checks on `9fdcb4d`, not four.** Re-checked run
34753909066 job-by-job rather than trusting the earlier pass: Vitest (unit)
also failed, with five wall-clock/timezone-dependent test failures
(`DateText.test.tsx`, `ClientProposalPage.test.tsx`, `knowledge.test.tsx`,
`AttendanceCapturePage.test.tsx` ×2) — every one an assertion written
against a Malaysian wall clock with the runner's timezone left unpinned.
This was missed in the earlier count of main-red items and is corrected
here. None of the five came from PR #5's own diff, confirmed by their
presence on `9fdcb4d` itself.

**`fix-pr5`'s work is confirmed IN PR #5's own commit history, not a
separate branch that merges in later.** `gh pr view 5 --json commits` lists
the three fix commits directly. Confirmed each fix landed as described:
`apps/web/vitest.config.ts` on `origin/cloud/web-swap` sets `TZ:
"Asia/Kuala_Lumpur"` with a comment citing the same tenant default used
elsewhere in the schema; `.github/workflows/ci.yml` sets `continue-on-error:
true` on the `upload-artifact` step with a comment stating the quota is
account-level and "must not be able to report a green build as a red one."
Confirmed on PR #5's own latest CI run (34755634781): Gitleaks, Prettier and
Vite build now pass; Vitest was still running at last check, not yet
resolved either way.

**npm audit ruling: only the coarse half is live.** The reported plan was to
scope the CI step to `npm audit --omit=dev --audit-level=high`, note the
three advisory ids (`GHSA-fx2h-pf6j-xcff` vite, `GHSA-5xrq-8626-4rwp`
vitest, `@vitest/coverage-v8`) in a comment as dev-only, and land the
vite-7-and-vitest-3 upgrade as a separate draft PR. What's actually on
`cloud/web-swap` right now: the `deps-audit` job gained `continue-on-error:
true` on the unchanged `npm audit --audit-level=high` command — no
`--omit=dev`, no id comment. No `chore(toolchain): vite 7 + vitest 3` PR
exists on GitHub yet (`gh pr list --state all` checked directly). Recorded
as a plan not yet fully executed, not a false report — the coarser mitigation
that IS live achieves the same immediate goal (main stays green) by a
blunter means.

**Correction to this log's own 20:1x entry above.** That entry said the
MoneyText kit follow-up should be dropped entirely — too broad, based on
confirming only the kit component itself. The correct picture, per the team
lead and independently confirmed by reading the files: `MoneyText` is fixed
(PR #9's `5f01e57`), but two screens carry their own `font-mono` wrappers
that never routed through it, so the kit fix never reached them.
`InvoiceDetailScreen.tsx` hardcodes `font-mono` at ten call sites (confirmed
at `a4ea833`) — this closes as a side effect of PR #10's `DataTable`
conversion, since that's exactly the table being replaced.
`ExecutiveDashboard.tsx` hardcodes it at three call sites (confirmed
directly at lines 91, 349, 385) with no lane assigned — this stays open as a
screen-level item, tracked as verification doc §5 item 5 / §7 row 9, not a
kit follow-up. `ai/workstreams.md` UI-CARRYOVER corrected in place.

**Two things worth telling future-me:**

1. **A "the kit is fixed" claim needs checking at every call site, not just
   the kit.** `MoneyText` had zero `font-mono` left in it, which is true and
   was verified — but two screens had grown their own parallel `font-mono`
   styling that never went through the shared component at all, so fixing
   the shared component fixed nothing for them. The lesson isn't "verify the
   file the report names" — it's "grep for the actual symptom
   (`font-mono` near a money/numeric value) across the tree, because the
   defect and the component are not the same scope."
2. **A CI run that "fails" can still be job-by-job re-examined for a check
   nobody mentioned.** Vitest (unit) was sitting in the same `gh run view`
   output used to find the other four main-red failures, twice, before it
   was actually read all the way through. The habit that would have caught
   it the first time: read every job row in a failing run, not just the
   ones a report already names.

---

## 2026-09-13 20:1x — PR #9 merged (was reported open), PR #10 confirmed with six deviations

**PR #9 (`ui/tokens`) already merged.** `gh pr view 9` shows `state: MERGED`,
merged at 11:54:52Z as `ed3c337`, now on main. Reported to this thread as
"open... under review by review-pr9"; by the time it was checked it had
landed — the review evidently passed. Confirmed 3 commits (matches); files
35, not 33 as reported (minor, not disputed — every substantive claim was
accurate). Confirmed no feature screen touched: all 35 files are under
`kit/`, `styles/`, `tailwind.config.ts`, or `docs/reviews/`.

**Verified word-for-word against `docs/reviews/2026-09-13-verification.md`
at `ed3c337`:**

- Row 1b: muted text on a selected row now reads 6.54:1 light / 6.69:1 dark
  (was 4.36:1). Mechanism: `SELECTED_TINT` rebinds `--ink-muted` to
  `--ink-secondary` for its own subtree via `[--ink-muted:var(--ink-secondary)]`,
  so every descendant follows without a per-call-site change.
- Row 1c: `--on-primary` on solid primary now reads 4.82:1 dark (was 3.24:1).
  Mechanism: new `--primary-solid` / `--primary-solid-hover` tokens carry
  `#1F5BFF` in both themes, used only at the four call sites that paint the
  accent as a fill under text; `--primary` keeps every text/mark use.
- Contrast suite: confirmed exactly "49 cases, was 33" in
  `tokens.contrast.test.ts`'s own gate table.
- Mono-caps, confirmed exact on all four cited routes: `/dashboard` 29→11,
  `/sales/enquiries` 34→21, `/compliance/hrd-corp` 22→12, `/finance/invoices`
  36→22. Mechanism: `MONO_LABEL` (nine kit components) became `SECTION_LABEL`,
  and `MoneyText` dropped `font-mono`, keeping `tabular-nums`.
- `/training/participants` "x275" confirmed real (it's the literal count in
  the route table) and confirmed a false violation, exactly as reported: the
  doc's own re-measurement finds 350 of 354 counted runs are `PAR-…`/
  `CERT-…` record references, which brief §1 keeps in mono on purpose —
  "there is no kit lever on them and there should not be one."
- Two defects confirmed recorded, not fixed, for the stated reason (owning
  file outside this lane's allowed set): `--on-primary` on `--danger` is
  2.22:1 dark — the alias is in `tailwind.config.ts` (this lane's file), the
  call site is `shared/components/ui/toast.tsx` (a shadcn primitive, not
  this lane's). `shared/components/ui/button.tsx` has zero importers
  anywhere in the app, confirmed independently via `git grep` — a dead
  second button vocabulary beside kit `Button`.

**PR #10 (`ui/lists`) confirmed open**, 5 commits and 17 files, both exact.
"1009 passing, 110 files" confirmed verbatim in the PR's own Validation
section (not independently re-run). Under review by `review-pr10`. All six
deviations confirmed against the actual diff:

1. Invoice totals moved to a `<dl>` under the table rather than table rows —
   confirmed via the file's own "DECISIONS §7" comment: kit `DataTable` has
   no footer, and a summary is not a line item.
2. The AI tier-assignment matrix lost its sticky first column and its
   staged-row `bg-ai-tint` converting to `DataTable` — confirmed via the
   diff's own "TWO THINGS THE CONVERSION COSTS" comment; no kit prop exists
   for either, and the tint specifically is AI-hue territory CLAUDE.md
   reserves, so it couldn't be improvised back.
3. `tsconfig.strict.json` gained exactly three new paths, confirmed in the
   diff: `compliance/registers.ts`, `ClaimPacketsScreen.tsx`,
   `InvoicesListScreen.tsx`.
4. Collections' `ListToolbar` sits above the DETAIL pane, not the table,
   because it spans the full width of a master/detail grid — confirmed via
   the PR body's own reasoning that constraining it to the table column
   would stack two bands, exactly what §10b forbids. Kept as-is.
5. `HRDC_RULE_CHANGES_PATH` still carries the identical "leaf opens the
   record" defect that `HRDC_PACKET_PATH` had before this lane fixed it —
   confirmed via the file's own updated comment, which states this directly
   and marks it "NOT this pass's."

**One queued kit follow-up is already resolved, not open.** Follow-up (a),
"`MoneyText` hardcodes `font-mono` at `Money.tsx:32,43`," was fixed as part
of PR #9 (`5f01e57`, "labels take the UI font, numbers take tabular
figures") — confirmed by reading current `Money.tsx` on main: both lines use
`tabular-nums`, `font-mono` appears nowhere in the file. PR #10's own body
independently corroborates this (it removed eight now-redundant
`tabular-nums` props and explicitly scoped the kit-level fix to "the kit
lane, not this one"). Whoever next works the kit follow-up list should drop
(a) rather than redo it; (b)–(f) remain open as reported.

**One thing worth telling future-me:** a report that a PR is "open under
review" is a snapshot, not a fact — by the time the doc spine gets to verify
it, the state may have already moved on. Always re-check `state`/`mergedAt`
directly rather than assuming the reported lifecycle stage still holds; this
is the second time in one session a PR's actual state (open vs. checks vs.
merged) differed from what was reported, both times because real time had
passed between the report and the check, not because the report was wrong
when written.

---

## 2026-09-13 20:0x — PR #7 merged, PR #8 opened and reviewed, two earlier flags resolved

**PR #7 (`ci/gitleaks`) merged.** Confirmed at `0910b9d` — `git log -1
0910b9d` shows the merge commit and `git merge-base --is-ancestor 0910b9d
main` confirms it. The `ci-gitleaks` worktree is gone, matching "lane shut
down." Confirmed the fix actually works repo-wide: main's next CI run
(34755129255) passes Gitleaks. It still fails Prettier (drift check); Vite
build and npm audit were not independently re-checked on this run but have
no reason to have changed. `fix-pr5` is doing the remaining work — three
commits confirmed via its own `git log`: `0b7221e` (Prettier), `6c84ca0`
(pin suite timezone), `c4b8a78` (stop the shared artifact-storage quota from
failing build/test gates) — no PR from it yet.

**Two earlier flags resolved, one still open.** The `fix/main-ci` vs
`fix/pr5` branch-name mismatch flagged at 19:5x is still unexplained as a
naming question, but the substantive worry — that the lane hadn't actually
started fixing CI — is resolved: it has three real fix commits now. The
`codex-014-017` detached-HEAD worktree flagged as unexplained in an earlier
report is confirmed legitimate: it is `codex-review-014-017`'s own checkout
of PR #6's tip (`826bb52`) for its retrofit review, not an orphaned lane.

**PR #8 (`ui/states`) opened** (`fix(screens): empty states, tone ternaries,
drawer primary and the registry toolbar`, ~19:49), closing four
verifier-carry-over items. Reported 1389 tests (28 new), local gates green —
not independently re-run, but the diff shape is consistent: 23 files changed,
5 of them test files (`gh pr diff 8`). Under independent review by
`review-pr8` (Sonnet `code-reviewer`) before merge; its own CI is still
mostly pending as of this check, with Gitleaks, Install and Detect optional
surfaces passing so far.

**Three deviations confirmed against the actual files, not just the PR
description:**

1. Verification doc §6 claimed `statusTone.ts` already had maps for all ten
   tone-ternary vocabularies — false. Only `HRDC_PACKET_PANEL_TONE` of the
   six names in question pre-existed; `AGENT_TONE`, `SEVERITY_TONE`,
   `MESSAGE_CATEGORY_TONE` and `HOURS_SAVED_TONE` are new in
   `apps/web/src/shared/components/kit/statusTone.ts` on `ui/states`, and a
   fifth, `PARTICIPANT_ATTENDANCE_TONE`, is feature-local in
   `apps/web/src/features/engagements/attendanceModel.ts`. Approved as
   reported.
2. §6's kit-level "give `Drawer` a primary scope of its own" was deferred;
   `KnowledgeSourcesScreen.tsx` migrated to the `ProviderKeysScreen` pattern
   instead (a SECONDARY-labelled action standing in for a primary the kit's
   one-primary rule won't let it declare) — confirmed via the file's own
   comment explaining the trade-off.
3. A real defect was fixed in `TnaDetailPage.tsx`: its own comment confirms
   the old ternary "painted a DANGER constraint" as neutral; it now reads
   `SEVERITY_TONE[constraint.severity]`.

Carried to other lanes rather than dropped, per PR #8's own listing:
`EnquiryDetailPage`, `CostingWorksheetPage`, `QuotationsListPage` and three
M03 `ListToolbar` screens to `cloud/web-swap`; `ClaimPacketScreen` and
`CollectionsQueueScreen` to `ui/lists`.

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
