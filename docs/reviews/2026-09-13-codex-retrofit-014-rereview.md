# 014 re-review, Opus thermonuclear + security; Codex slot owed

**Reviewed:** the fix-014 lane's seven commits (`d9834b7`, `260ee64`, `7f18c68`, `d8778be`,
`ab6a8f7`, `e3a871c`, `21ec975`) on `origin/cloud/migrations`, PR #6, PARALLELPARADIGMS/alex-project,
bringing migration 014 from the originally-reviewed `826bb52` (BLOCK) to `21ec975`.
**Reviewers:** a genuine thermonuclear pass (`.claude/skills/thermo-nuclear-code-quality-review/SKILL.md`,
which now exists in this environment) and an independent `oh-my-claudecode:security-reviewer` pass —
**Codex `gpt-5.6-sol` is hard quota-blocked** ("usage limit... retry at Sep 14, 2026 12:29 AM") and
is recorded as OWED, not substituted, per the gate's own rule. G6 was executed in full, comparing
the OLD (`826bb52`) and NEW (`21ec975`) SQL against the same pins directly.

## VERDICT: MERGE-WITH-FIXES

Both original CRITICAL findings are genuinely closed and independently confirmed by execution — not
just by reading the diff. That is the headline result. But this pass found one new **HIGH** (a
security gap the fix pack's own catalog rationalizes rather than closes), several MED documentation
defects that repeat the exact "self-review that told the truth about the wrong thing" pattern CRIT-2
was, and — found only by actually running the pins — **two defects in the pin file itself**, one of
which (a tautological assertion) means one of the two ways CRIT-1 could reappear is currently
unguarded. None of this reopens either CRITICAL. All of it should be fixed in the same pass, before
this is genuinely ready, and **the Codex consumer-trace lens has still never run against this pack**.

---

## Part 1 — the two CRITICALs: VERIFIED-FIXED by execution, not just by reading

**CRIT-1 (DELETE on `public.memberships`, aal2 self-escalation).** Confirmed independently three
ways: the grant now matches migration 002 privilege-for-privilege with DELETE explicitly revoked;
`memberships_no_client_delete` is genuinely `RESTRICTIVE ... USING (false)` (verified it would fail
if it were accidentally PERMISSIVE — traced through `memberships_write_admin`'s own predicate); and
G6 ran the actual attack directly against the OLD 826bb52 database (`DELETE 1; rows_left 0` — i.e.
the delete succeeded) and against the NEW database (refused at `42501`). The T11 counterfactual pair
ab6a8f7 asked for (delete-with-the-restrictive-policy-standing vs. delete-with-it-dropped) is real
and both halves were independently confirmed by direct SQL, not only by the pin.

**CRIT-2 (rollback destroying migration 002's grants).** Confirmed independently: the rollback now
reproduces 002's five-table grant set verbatim (excluding 014's own since-removed DELETE, correctly),
a new pin `test_014_rollback_restores_002_grants.sql` checks all five tables against all seven
privilege types in both directions (missing AND unexpected), and G6 reproduced the exact sixteen-line
failure text from the OLD rollback, then confirmed all four assertions (R1-R4) pass against the NEW
rollback, including a full round trip (rollback → reapply → rollback again inside a 017-applied
context, see below).

Neither finding is reopened by anything below.

---

## Part 2 — HIGH-1/2/3: fixed, with real residual gaps the fix pack did not close

### HIGH-1 (blanket read on `ai_provider_keys`/`run_node_io`/`public_share_tokens`) — PARTIALLY-FIXED

The mechanism itself is correct and was verified independently, not trusted: the three permission-to-
role mappings were re-derived from migration 002 directly and match; the gate is folded into the
existing RESTRICTIVE isolation policy (not a separate policy that could be OR'd away by a later
permissive one); G6 confirmed by direct SQL that the gate structurally applies to both `USING` and
`WITH CHECK`.

**N-1 (HIGH, security pass).** `run:read` — the exact permission this fix pack uses to gate
`core.run_node_io` — governs **seven** `core` tables in migration 013, not one:
`runs, run_nodes, run_node_io, run_events, run_state_cards, run_checkpoints, run_snapshots`. This fix
pack gates one. `run_state_cards` is worse than the table that got gated: its own 013 header
concedes it is **not** subject to the 30-day redaction sweep that `run_node_io` gets and may carry
client text verbatim. `run_snapshots.response` is every tool call's raw output for every run in the
tenant. A `SALES` principal can read both today, on the fix pack as written. The catalog names this
as a deliberate posture ("the review did not name them") — that is a provenance argument, not a
security one, and it is the exact rationalized-gap pattern this gate exists to catch. **This is not a
regression** — it was equally open at `826bb52` and the original review named only the one table it
happened to check — but a fix pack that argues "restore 002's decision" and then restores it for one
of seven tables the same permission governs is not finished. Fix: extend the same `VALUES` list
(already table-driven) to cover at minimum `run_state_cards` and `run_snapshots`; state explicitly,
in the header, whether `runs`/`run_nodes`/`run_events` are a deliberate metadata-only exception or
should also be gated.

**N-8 (MED, security pass).** `public_share_tokens`'s gate uses `has_permission('portal:token:issue')`
alone, but 002 annotates two of the four holding roles (`SALES`, `SALES_MANAGER`) as
`-- scope-narrowed` — meaning the permission was meant to compose with a scope term
(`app.client_scope()`/`app.team_scope()`), not stand alone. The fix pack's own header claims to
restore "the decision 002 already wrote down," but for this table it restores only the role half —
any SALES principal reads every share-token row in the tenant, not just their own clients'. The pin
itself concedes this by testing with `OPS`, not `SALES`, as its low-privilege probe for this
specific table. Fix: either AND in a scope term, or narrow the header's claim.

**N-9 (MED, security pass).** The role-gate function validates that a supplied permission *exists*
in `app.role_permissions`, never that it actually *narrows* anything — `apply_tenant_policies('core',
'run_node_io','dashboard:read')`, a permission every role holds, would be accepted as a gate and
turn it into decoration, silently. Not reachable by any call in this repo today; the pattern is
exactly the shape of the already-fixed dead-`UNGATE`-branch bug (a written control with an
unreachable-until-someone-hits-it failure mode). Fix: refuse a permission that every role holds, the
same check verify(13) already runs internally.

### HIGH-2 (nullable-fallback admitting writes) — VERIFIED-FIXED, one documentation gap

Confirmed structurally: `USING` and `WITH CHECK` are built from two genuinely separate variables
(`v_read`/`v_write`), not one predicate with a runtime branch — `v_write` has exactly one possible
value in the function body, so there is no path back to the old behavior. G6 additionally staged the
exact "day someone grants a write" scenario inside a transaction and confirmed a NULL-tenant write is
refused, matching the pin.

**N-7 (MED, security pass).** The migration's own header and catalog claim a §6 "verify (15)" sweeps
every nullable table generically at apply time. That check does not exist in §6 — the generic sweep
exists only in the pin (T13a/T13b), which means a nullable-fallback regression would fail the test
suite but would **not abort a migration apply** the way the file's own stated philosophy ("every
property is re-derived by §6 so the comment cannot drift from the database without something
failing") claims. Fix: lift the check into §6.

### HIGH-3 (false header premise) — VERIFIED-FIXED

The new "measured baseline" header was independently re-derived, not trusted: 16 table privileges in
`public` (2+4+4+3+3, counted against 002:695-701), EXECUTE on exactly 15 `app` functions (counted
against 002:626-640), USAGE on all three schemas (confirmed against 001:190,231-232). All match.

**N-2 (MED, security pass).** A sibling of the same false-premise class survives elsewhere in the
same file: a comment at `014:798` still claims a block "grants" four views, when that block only
asserts a flag and the real grant (of two views, not four) is 118 lines later. The catalog claims
this exact comment was "deleted" — it was not. This is the same mechanism that let CRIT-1's false
premise stand: a stale claim, unverified by whoever wrote the fix-summary prose, sitting next to the
correct code.

---

## Part 3 — the role-gate / UNGATE mechanism: VERIFIED-FIXED, adversarially, by execution

This was the fix lane's own internal thermonuclear pass's finding (a two-argument call could
silently strip a gate; the documented `'UNGATE'` escape hatch was itself unreachable due to branch
ordering, fixed in a follow-up commit). Both this review's independent security pass and G6's direct
execution retested it from scratch rather than trusting that the internal fix held:

- **G6 ran the actual mechanism directly**, not just the pin: set a gate, confirmed a two-argument
  call refuses with the gate still standing, confirmed `'UNGATE'` genuinely removes it (verified via
  a follow-up query that both policies return to a plain tenant predicate).
- **Both reviews independently ran an adversarial sweep on the third argument** beyond what the pin
  tests: empty string, `NULL`, lowercase `'ungate'`, and `' UNGATE '` with whitespace. **All four fail
  closed** — none silently ungates, none silently no-ops, matching between the two independent
  attempts (source-read prediction from the security pass, direct execution from G6).

No sibling of the original dead-escape-hatch bug was found. This mechanism is now solid.

Two low-severity latent issues, neither reachable today, both worth fixing given the mechanism's
history of exactly this failure mode: **N-10** (a `core` table name ≥ 46 characters would silently
miss the gate-detection lookup due to PostgreSQL's 63-byte identifier truncation — unreachable today,
longest table ~23 chars) and **N-11** (gate detection reads only `polqual`, never `polwithcheck` — not
producible by this function's own code path today, but a hand-written policy could trigger it).

---

## Part 4 — new findings this pass, from three independent angles

### From the security pass (catalog/documentation accuracy — the same class of defect as CRIT-1's false premise)

| # | Sev | Finding |
|---|---|---|
| N-3 | MED | Catalog claims verify(6) "asserts one overload" as the guard against a future 4-arg `core.decide_approval` (from another lane's work-in-progress). Verify(6) checks no such thing — only verify(13b) counts an overload, and it counts `apply_tenant_policies`, not `decide_approval`. A catalog asserting a guard that doesn't exist is worse than an open item. |
| N-4 | MED | The "228 policies" decomposition in the catalog is arithmetically wrong (omits the new `memberships_no_client_delete`, double-counts a policy from migration 011 as 014's own). The file's own verify(14) count is correct; the catalog prose is not. |
| N-5 | MED | Catalog says "ten checks, 51 assertions... against the full applied set 001-014." The pin actually has sixteen checks (T1-T16), roughly 100 assertions, and is explicitly pinned against 001-017 (confirmed independently by G6 — see Part 5). |
| N-6 | MED | Catalog still lists "`rule_set_versions` needs a composite UNIQUE, owner 017" as an OPEN item. 017 already added it. Stale. |

### From the thermonuclear pass (structural/maintainability — a different lens, independently landing on some of the same code)

**Verdict from this lens alone: BLOCK, on structural grounds, not correctness.** Selected findings
(full list has eleven; only the load-bearing ones are reproduced here):

- **F1.** The `migration:014` policy-comment stamping convention (introduced to fix the rollback
  naming-convention MED from the original review) is inconsistently owned: 014 writes the stamp at
  the call site, but 017's three calls to the same shared function stamp nothing — reasoned in prose
  ("017's tables are not 014's to drop") that directly contradicts the rollback's own comment
  conceding a 014-after-017 re-apply *does* claim them. One string, two ownership stories in two
  files. Recommends making the stamp a required function argument instead of caller-supplied prose.
- **F3.** The `'UNGATE'` magic-string design (verified secure by both other lenses, above) is flagged
  here as a maintainability smell independent of its correctness: it fuses "what gate" and "may this
  drop one" into one three-way branch whose safety rests on statement order — the exact shape that
  already produced one dead-code bug. Recommends splitting into a separate, explicitly-named
  `app.ungate_tenant_policy()` function so the escape is visible as a name, not an order-dependent
  string comparison.
- **F5.** Independently corroborates part of N-11 above from a different angle: the gate-detection
  logic and the T16 pin both read only `polqual`, never `polwithcheck`, for the WITH-CHECK half of
  the same predicate the HIGH-2 fix just split into two variables — i.e. the split that fixed HIGH-2
  created an asymmetry the gate-detection code never learned about.
- **F8.** The 017-applied rollback refusal (verified correct and load-bearing by both other lenses)
  is flagged as solving a symptom rather than the structural problem: it hardcodes one future
  migration's one table name (`core.tax_policies`) rather than a generic "is anything later than me
  still applied" check, which will need editing again for 018.

None of the thermonuclear findings are new correctness bugs — they are legitimate maintainability
debt, some of which (F1, F5, F8) point at the exact same underlying coupling the security pass's N-1
through N-9 describe from a security angle. Treat this as corroboration across independent lenses,
which is the concrete case for running more than one.

### From G6 execution — two defects in the pin itself, found only by running it

**This is the most consequential new finding in this pass.**

1. **T11a is a tautology and does not test what it claims to.** The pin's own T11 header claims both
   the grant layer and the policy layer are pinned separately. G6 proved otherwise by direct
   execution: the pin `REVOKE`s DELETE on `public.memberships` at line 975, then T11a immediately
   asserts that `authenticated` does not hold DELETE — asserting the absence of a privilege the pin
   itself just revoked one statement earlier. Run against the **original, defective** `826bb52`
   database (the one CRIT-1 was filed against), T11a **still passes**, because the pin's own REVOKE
   masks the underlying grant regardless of what the migration did. Only T11b (the behavioral delete
   attempt) actually catches CRIT-1. **This means the fix pack's claim that "either layer alone
   catching this was the point" is not true for the grant-layer half as currently written** — if a
   future edit reintroduced the DELETE grant AND removed the RESTRICTIVE policy, T11a would still
   report pass, and only T11b would catch it. That's one working detector instead of the two the pin
   believes it has.
2. **`test_014:953`'s teardown `DROP POLICY` is unguarded.** Running the unmodified NEW pin against
   the OLD (pre-fix) database does not reach the T11b diagnostic at all — it crashes with a raw
   `policy "memberships_no_client_delete" for table "memberships" does not exist` at line 953,
   because that policy never existed on the pre-fix database. The commit message quotes T11b's
   diagnostic text as what a reviewer would see against the old SQL; in practice, an operator running
   this pin against an unpatched database gets an opaque Postgres error, not the intended message.
   One-word fix: `DROP POLICY IF EXISTS`.
3. **The pin's own header contradicts its own assertions.** Line 5 says "Run against the complete
   001-014 set." Lines 235 and 258 assert counts (116 policy pairs, 121 SELECT grants) that only a
   001-**017** database can produce — confirmed by G6: running the pin against a clean 001-014-only
   stack (exactly what the header instructs) fails immediately with
   `T1a FAIL: ... found 113`. Every PASS claimed anywhere in this fix pack's commit messages and in
   this review's own G6 section was necessarily measured against a 001-017 stack, not 001-014 as the
   file's own header says to use. This is not this review's error — it is the file's, and it should
   be corrected (either the header, or the two counts, whichever is meant to be authoritative) before
   the next person runs it exactly as instructed and gets a confusing failure.
4. Cosmetic, same family as a defect flagged in the previous review of 017: the T1 success `NOTICE`
   text still prints pre-fix numbers ("113... 118") three lines below assertions that require 116/121.

---

## Part 5 — G6 execution log (full, both arms)

**Harness:** scratch PostgreSQL 17.11, port 5447 (distinct from concurrently-running shims in this
shared repo), fresh data directory. Confirmed first that migrations/rollbacks 001-013 are
byte-identical between `826bb52` and `21ec975`, so a shared base template was valid for both arms.

**Phase 1 (OLD 826bb52 014, full 001-017 stack — required, per the pin's actual dependency, see Part
4 item 3 above):** T1-T10 pass; **T11b, T12c, T13a fail with text byte-identical to the fix commits'
own quotes**; T14/T15 pass by design (self-contained disagreement demonstrations); T16 fails with a
raw "function does not exist" (the three-argument signature didn't exist pre-fix, as expected). The
new rollback pin's R1 fails, naming exactly the sixteen privileges the CRIT-2 commit message quotes.

**Phase 2 (NEW 21ec975 014, full 001-017 stack):** all 16 T-blocks pass, zero errors. Rollback +
rollback pin: R1-R4 pass. Re-applied 014 twice in a row (idempotency): clean both times, pin still
16/16. With 015/016/017 re-applied on top, attempted the 014 rollback: **refused**, exact message
naming the required order (017→016→015→014), verified state intact afterward. Rolled back in the
correct order: 014's rollback then succeeds, pin R1-R4 pass again.

**UNGATE, direct execution (not just the pin):** gate set → verified via `pg_policy` read. Two-arg
call against the gated table → refused, gate confirmed still standing. `'UNGATE'` → gate genuinely
removed, verified via a follow-up query showing both policies back to a plain tenant predicate.
Adversarial third-argument sweep (`''`, `NULL`, `'ungate'`, `' UNGATE '`) → **all four raise**, none
silently ungates or no-ops.

**`check:grants`:** exit 0, "OK — no public EXECUTE grants outside the allowlist" (the zero-findings
state, printed without the literal words "0 findings").

Repo left untouched throughout (`git status --short --branch` clean at the end); cluster stopped,
data directory retained for inspection.

---

## Codex slot: OWED, not filled

Per the gate's own rule ("if Codex is quota-blocked... run thermo alone, and record the Codex pass as
owed — do not substitute a failed or dummy verdict"), no verdict is substituted for Codex here. The
two reviewers that did run found genuinely disjoint problems from each other (the security pass's
N-1 permission-coverage gap vs. the thermonuclear pass's F1/F3/F5/F8 structural-coupling findings),
which is the concrete argument for why a third, differently-focused lens (Codex's consumer trace
across `apps/**` and `packages/**`) still matters and has not run against this specific fix pack.
**Specifically unverified by either lens that did run:** whether anything in `apps/web` or
`apps/worker` assumes a grant/policy shape this fix pack changed (the security pass traced 017's
three call sites into the shared function and confirmed no behavior change there, but did not trace
frontend/worker consumers the way Codex's brief is specifically built to do).

## Could not verify

- Neither reviewer nor G6 re-verified migrations 003, 005, 006, 008, 009, 010, 012 line-by-line
  beyond what 014 touches or claims about — same gap the original review flagged, still open, and
  directly relevant to N-1's blast radius (are there other permission/table mismatches like
  `run:read` elsewhere in the pack?).
- The catalog's claims about `check:rpc` results and other cross-cutting CI state were not
  independently re-run in this pass beyond `check:grants`, which G6 did run and confirmed clean.
- `docs/reviews/2026-09-13-codex-retrofit-014-017.md` (the original findings this fix pack responds
  to) does not exist in the `cloud/migrations` worktree used for this review — it was read from
  `origin/main`, where it is merged. Anyone reviewing the fix-014 branch in isolation, without access
  to main, cannot check the fix commits' premises against the actual original findings text.

---

**PR:** review/codex-014-rereview → main, PARALLELPARADIGMS/alex-project.
