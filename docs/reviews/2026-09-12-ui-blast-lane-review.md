# 2026-09-12 — UI blast, lane review

Read-only audit of the 12 September build. Branch `main`, shared worktree, no remote. No database:
migrations 001 to 009 were executed by their authoring lane against a local PostgreSQL 17.11 shim and
nothing in this review re-ran them. Sources read before any claim: the full commit log with bodies
for 12 and 13 September, `supabase/migrations/migration-catalog.md`,
`docs/architecture/06-critic-review.md` Parts 1 and 2, `supabase/HANDOFF.md`, `CLAUDE.md`,
`AGENTS.md`, and the working tree at `9145048`.

**Eleven lanes reviewed. 0 findings raised here that are not already in `ai/findings-log.md` — this
document is a record of what each lane shipped, deviated from, left open, and could not verify, not
a defect hunt.** The defects are in the findings log; five of them are still unpinned.

**What this review is not.** Nothing was executed. No test was run, no build was made, no query was
issued. Every "green" below is a claim made by the lane that authored it, in its own commit message,
and the single most important fact in this document is that **no lane has been verified by anyone
but itself**. The verifier pass was deferred. Treat every count as reported, not measured.

---

## Premises I was handed — corrections

| Brief claim                                          | Verdict                                       |
| ---------------------------------------------------- | --------------------------------------------- |
| Roughly 80 commits since 2026-09-12                  | CORRECTED — 130 dated 12 Sep, 9 more on 13 Sep |
| 27 screens across 14 features                        | PARTLY — 14 feature folders confirmed by count |
| Five architecture docs plus a critic review          | CONFIRMED — 6 files, plus a spike             |
| Migrations 001 to 009                                | CONFIRMED — 9 SQL files                        |
| Research pack of nine documents                      | CONFIRMED — 9 files                            |
| Supabase paused at 009, critic Part 2 open           | CONFIRMED — 7 critical and 29 high             |
| D-100 and D-101 already exist                        | CONFIRMED                                      |
| FEATURE_ROUTES before nav placeholders                | CONFIRMED — `routes.tsx:56` and `:81`          |
| useApi consolidation in progress today               | CONFIRMED — 7 markers plus 2 client files      |
| ActionOutcome had five divergent copies              | CORRECTED — five copies, three had diverged    |
| Contract R4 and R5 deferred                          | CORRECTED — R4 to R8 landed today in `e148a34` |
| Kit duplicate sweep deferred                         | CONFIRMED — two stand-in fields survive        |
| No green on bars                                     | CONFIRMED — refused by type, not by comment    |
| Dev server on port 5180                              | CONFIRMED — already recorded as D-101          |
| sonner, not the shadcn toaster                       | CONFIRMED — the trio is unmounted on purpose   |
| CI never executed, no remote                         | CONFIRMED — `git remote -v` is empty           |
| An index sweep was among the defects found           | COULD NOT LOCATE — see the supabase lane       |
| An amend rewrote a sibling commit                    | UNVERIFIABLE by nature — see the process lane  |
| R9 and R11 exist in CLAUDE.md                        | CONFIRMED — R1 to R11 are present              |

Two of these matter beyond bookkeeping. **The commit count was understated by a factor of 1.6**,
which changes how much of this day is reviewable at all in one pass. And **the contract lane's
deferred work was not deferred** — it landed between the brief being written and this review being
written, in the same worktree, which is the staleness hazard this whole document set exists to
manage and which caught it once already today.

---

## L1 — Supabase schema

**What shipped.** Migrations 001 to 009: foundation schemas and five shared helpers; tenancy,
identity and 399 permission grants over 109 permissions; 69 enum types with 271 labels; the shell,
`app.finalise_table()` and per-tenant reference allocation; the sales path; the catalogue; money;
delivery and attendance; the bitemporal compliance registry. Each carries an executable pin and each
pin is reported green. Five architecture documents, a two-part critic review and a JWT spike.

**Deviations.** Three are recorded loudly by the lane itself, which is the right handling.
`public.user_profiles` is an author addition — doc 02 assigns it to another lane and names two
required columns, doc 01 never defines it, and the login hook needs it. `organisations.proposal_count`
and `first_proposal_sent_at` are denormalised for a record header while doc 03 requires the same
answer computed live, and both columns carry a COMMENT saying the policy gate must not read them.
Four forward-reference columns exist without their foreign keys, added later by 006, 007 and 010.

**Gaps.** 010 to 016 are unwritten — finance, the action envelope, events and outbox, AI-ops, the
whole RLS policy layer, realtime and cron, and the seed. Seven rulings were never applied to the
migrations that do exist. `knowledge_chunks.embedding` was never created because pgvector was
unavailable; it is the one object in the set not executed in its intended form. Critic Part 2 stands
at 7 critical and 29 high, the worst being that migration 001 never gained `pg_cron`, `pg_net` or
`vector`, so nine scheduled jobs have no scheduler and nothing in the outbox is ever claimed.

**Could not verify.** Everything, in the sense that matters: nothing has run against a real Supabase
stack. There was no CLI and no Docker. The `FORCE RLS` question turns on whether Supabase's
`postgres` role carries `BYPASSRLS`, and that needs one query against a real project which nobody
has run. The "index sweep" named in the brief matched no artefact under that name; the closest thing
in the tree is the replacement of denormalised counters with the `proposals_org_sent` and
`invoices_overdue` partial indexes, recorded as `B-008`. If a different sweep was meant, it is
unrecorded.

---

## L2 — Architecture documents

**What shipped.** Domain model and ERD, tenancy/auth/RLS, the action envelope and policy gate,
money/versioning/provenance, events/outbox/realtime/audit. Written by five lanes in parallel and
reconciled against each other afterwards through roughly forty correction commits.

**Deviations.** The reconciliation is the interesting part and is honest about itself. The domain
schema moved from `public` to `core` and one document flipped and flipped back before settling. The
applier key, the write-back signature and the worker status vocabulary each moved three or four times
before being pinned. Two lanes each conceded to the other on the write-back signature and briefly
swapped positions. Several conclusions were reversed with the winning argument recorded rather than
silently applied.

**Gaps.** Doc 05 has sixteen CHECK constraints, every one on a scalar column, and no key-presence
operator anywhere — so ruling R-JSONB is applied in 03 and 04 and absent in 05, on fourteen
structured columns. Doc 01 still carries the snapshot rule-versioning model that doc 04 tested and
rejected, and the drift-warning multiplication that rejected it was measured rather than argued.
`app.quotation` survives six times in doc 04 against `core.quotations` everywhere else.

**Could not verify.** The critic's own Part 1 says it plainly and it applies to this review too:
nothing was executed, no external specification was consulted, and the documents changed underneath
the review while it ran. Findings are pinned to file checksums; a line number is more likely to be
wrong than the finding.

---

## L3 — Contract package

**What shipped.** `@trainos/contract`, derived from the API contract §1 to §18, types only, with the
three §18 supersedes applied. Rulings R1 to R3 on 12 September; R4 to R8 on 13 September. The enum
module generates 62 of the 69 database enum types.

**Deviations.** None found. The lane's discipline of reporting rather than widening unilaterally is
the reason the gaps below exist as a list rather than as twelve unilateral type changes.

**Gaps.** Eight of the twelve reported contract gaps remain, with five places where the contract's
own verbatim JSON examples contradict themselves. Because the enum module generates database types,
R4's two new provider members and R5's new run status are schema changes the paused Supabase lane
inherits and does not yet know about.

**Could not verify.** `e148a34` has no commit body. Its README diff was read instead and it carries
the reasoning in full, which is why this lane is reviewable at all — but the message itself asserts
nothing, and a lane whose commit messages are empty is a lane that is only reviewable by diff.

---

## L4 — Scaffold

**What shipped.** npm workspaces, four tsconfigs including a strict ratchet with an empty allowlist,
design tokens as RGB triplets, next-themes, the role-filtered shell with the route table generated
from the nav tree, the typed client boundary with a `{ data, error }` Result and a
domain-versus-transport error split, the state kit, two hook tiers, a seventeen-job CI whose summary
job fails on `skipped`, dependency-cruiser with both boundary rules probed by deliberate violation
and the probes removed, a bundle baseline, the safety hook and the doc spine.

**Deviations.** The dev port moved from the house default 8080 to 5180 because a sibling app already
owned 8080. `docs/superpowers/` and `docs/reviews/` were seeded empty although the research document
says to wait for the trigger — noted by the lane rather than silently reconciled, which is correct.

**Gaps.** The most consequential in the whole day: **the data boundary this lane built is not in the
path.** Every screen imports `@trainos/fixtures` through a local hook rather than through
`shared/api`, so the boundary's central claim — that nothing in the app moves when the client
changes — has never been exercised. Route-level role guards are still unwired while twenty-seven
screens now mount for anyone who types a URL, and one of them already renders a role-gated refusal
in its own body, so the application now has two role mechanisms and only one is at the route.

**Could not verify.** The seventeen-job pipeline has never executed. There is no remote and no
branch protection. A workflow file that has never run is a hypothesis, and both the summary job's
`skipped` handling and the three Supabase-coupled checks are untested in the environment they were
written for.

---

## L5 — Component kit

**What shipped.** Forty-four component files and a `/dev/kit` showcase rendering every component and
variant twice, light and dark, inside the real application shell. 213 tests reported, asserting the
design rules rather than the render.

**Deviations.** `Drawer` is built on the Radix dialog primitive directly rather than on the
generated `ui/sheet.tsx`, whose overlay and geometry are off-palette for this pack — correctly
handled as "that file belongs to another lane" rather than edited. `setSinglePrimaryCheck` exists
for exactly one caller, the showcase, because a catalogue legitimately renders every variant at once
and leaving the check on there would fill the console with warnings that are correct about that page
and thereby teach everyone to ignore the ones that are correct about a screen.

**Gaps.** No `TextField` and no `DateField`, which is why two features carry a `StandInField.tsx`
each. The duplicate sweep has not run, so nothing confirms the features hold no other copy of
something the kit now exports.

**Could not verify.** The 213 tests are a reported figure. The screenshots are reported as taken at
1440x900 in both themes and were not opened. The claim that the showcase is the kit's complete
inventory — the basis for "a pattern not on that page is not in the kit" — was not checked against
the component list.

---

## L6 — Fixtures package

**What shipped.** A seed dataset covering every screen the design-pack inventory names and the
states those screens render, an in-memory client mirroring the §13 endpoint table as typed methods,
a policy gate running the §3 evaluation order over a real policy table, and five test suites
reported at 116 tests including a foreign-key integrity walk over every reference-shaped field.

**Deviations.** Reads hand back live store references rather than snapshots, which differs from an
HTTP client. Found while writing a test, pinned with a test, and documented — the right order. A
screen test comparing a before and an after read would otherwise compare an object with itself.

**Gaps.** Twelve contract gaps and five internal inconsistencies in the contract's own examples were
reported rather than patched; eight of the twelve remain. Some local decorators existed purely to
work around those and are only now coming out.

**Could not verify.** Every count. Whether the dataset genuinely covers every named screen was not
checked against the inventory.

---

## L7 — Agent runtime

**What shipped.** A BYOK provider layer with Anthropic, OpenAI-compatible and mock adapters; §17
routing with tiers, fallback chains and budget caps; an orchestrator with an execution tree,
context handoff, a jury and a policy halt; run slicing against the 400-second worker; a
lead-to-proposal demo agent that reaches the approval gate and halts. 101 tests reported, plus one
opt-in live round trip per provider.

**Deviations.** A yielded run reports `RUNNING` on the contract object with the real disposition on
the runtime's own wrapper, because the contract's `RunStatus` had no member for it. That deviation
is now closable — R5 added `RESUMABLE` — and until the runtime is changed it is a deviation that no
longer has a reason.

**Gaps.** The tool-argument boundary needed asserting against types derived from the call site
because the consuming app compiles this package's sources under `strict: false`, which collapses
zod's inferred output to all-optional. The package's own tsconfig is strict, so its own typecheck was
green throughout and the defect was only ever visible from the consumer.

**Could not verify.** The live round trips are opt-in and were not run here. Whether the demo agent's
trace is stable across slice boundaries rests on the lane's own slicing tests.

---

## L8 — Screens

**What shipped.** Twenty-seven screens across fourteen features, built by six parallel lanes, each
reading only the fixture client and building only from the kit, with render tests and light and dark
captures at 1440x900.

**Deviations.** Two screens deliberately carry no solid primary button at all — the accepted-and-
locked client portal and the locked attendance sheet — and both are documented exceptions rather than
oversights. The claim-packet screen deliberately has no submit button because there is no HRD Corp
API; the product assembles and watches the deadline while a person files elsewhere. Each lane
carried local copies of what the kit lacked, marked them TEMPORARY, and reported the gap rather than
blocking — the correct move, and the direct cause of the consolidation work.

**Gaps.** Seven features still declare a private `useApi()`. Two carry a private `toApiError` because
the shared error module misclassifies a thrown `ContractError` as a transport failure, which puts a
retry button on a policy refusal. Two carry a stand-in input field.

**Could not verify.** The 409 reported web tests, the screenshots, and every claim that a screen
renders what its artboard draws. The comparison against the artboards was made by the lanes that
built the screens.

---

## L9 — Design pack

**What shipped.** Thirty artboards, build assets, eighteen screenshots and six written records
copied verbatim, with a provenance note naming where each artefact now lives in the application and
pointing at the two sections a builder must read before trusting a number.

**Deviations.** None. "Copied, not adapted" is the whole discipline of this lane and it held.

**Gaps.** The pack's `compliance` nav-role key has no counterpart in the contract's role union and
nobody has said which side is wrong. Six dark tokens are derived rather than sourced and are marked
as such — and twenty-seven screens have now been captured in dark against them.

**Could not verify.** Nothing was compared against the artboards.

---

## L10 — Research and skill

**What shipped.** Nine research documents and a `stack-bootstrap` skill synthesised from them with
seven reference files, parameterised for a second project.

**Deviations.** None found.

**Gaps.** The skill has not been used to bootstrap anything. Its own doc-spine reference prescribes
the additive-surgery rules that were broken in this repository on the same day they were written —
see the process lane.

**Could not verify.** Whether the skill's literal configs work as written. Two of them already did
not: the reference stack's `arch:graph` script carried a flag `dependency-cruiser` 16 does not have,
and the delegating npm scripts dropped their arguments. Both were found by running the commands.

---

## L11 — Process and the shared worktree

**What shipped.** Rule R9 (pathspec-only commits), rule R10 (a gate that cannot say no is not a
gate), rule R11 (a control a reviewer must remember to check gets a CI assertion, in the same pass
as the control), an always-on `PreToolUse` safety guard blocking eight irreversible command shapes,
and a `.prettierignore` that stops one lane reformatting another's tree.

**Deviations.** Two, both real. A commit message described an edit its file did not receive. And
commit `5549a35` spliced a new changelog entry into the middle of the previous entry's heading,
destroying it — which nothing caught, because `CHANGELOG.md` is in `.prettierignore` so no formatter
ever parsed it and a heading that loses its hashes is still valid markdown. The heading was restored
on 13 September. Rule 1 of additive doc surgery, anchor and insert whole lines, never splice
mid-line, was written into this repository on the same day it was broken.

**Gaps.** R9 stops a lane taking another's *staged* work; nothing stops a lane rewriting another's
*committed* work. `--amend`, `reset` and `rebase` are now forbidden in prose as `D-120`, and a prose
rule is not a pin. By R11's own standard that rule is unenforced until a `pre-push` check or a
`safe-command-guard` shape denies the three commands outright.

**Could not verify.** The reported amend. By its nature an amend replaces the tip, so the evidence
is the thing that was destroyed, and no artefact confirms or refutes it.

---

## What I could NOT verify, consolidated

1. **Every test count, every green claim, every screenshot.** Nothing was executed for this review.
   The 409 web, 213 kit, 116 fixtures and 101 agent-runtime figures are all reported by the lanes
   that wrote them.
2. **That any screen matches its artboard.** The only comparison made was by the lane that built it.
3. **That the migrations behave on Supabase.** They ran on a local PostgreSQL shim. No CLI, no
   Docker, no project, nothing applied.
4. **That CI works.** It has never run. There is no remote.
5. **The reported amend.** Unverifiable in principle.
6. **The "index sweep".** No artefact under that name. Mapped to the closest candidate and flagged.
7. **That the kit showcase is the kit's complete inventory.** Load-bearing for the kit's whole
   contract with the screen lanes, and unchecked.

The single recommendation this review makes: **run the verifier pass before anything else.** Not
because a specific defect is suspected, but because eleven lanes have each certified themselves and
one of them has already been caught asserting something in a message that its file does not contain.
