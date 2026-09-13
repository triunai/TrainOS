# 015/016/017 re-review, Opus thermonuclear + security; Codex slot owed

**Reviewed:** one fix commit, `bdd49aa`, on `origin/cloud/migrations` (PR #6, PARALLELPARADIGMS/alex-project),
bringing migrations 015/016/017 from the previously-reviewed `21ec975` (015 MERGE-WITH-FIXES, 016
BLOCK, 017 BLOCK — full findings in `docs/reviews/2026-09-13-codex-retrofit-015-017.md` on `main`) to
current tip. Migration 014 is untouched by this commit (confirmed: `git diff --stat 21ec975..bdd49aa`
touches no `014` file) — the three items from the 014 re-review (the `run:read` seven-table gap, the
T11a tautology, the pin's 001-014-vs-001-017 header mismatch) **have not landed and are noted as
pending below**, per instruction.
**Reviewers:** a genuine thermonuclear pass and an independent `oh-my-claudecode:security-reviewer`
pass. **Codex `gpt-5.6-sol` remains hard quota-blocked** and its slot is recorded as OWED, not
substituted. G6 was executed in full, comparing `21ec975` and `bdd49aa` against the same pins, plus
targeted direct-SQL probes beyond what any pin currently tests.

## VERDICT — one line per pack

| Pack | Verdict | Why |
|---|---|---|
| **015** | **MERGE-WITH-FIXES** | The `DROP FUNCTION` guard genuinely works and was proven by execution to close the overload hazard. But the migration's own new verify-block assertion is **dead code** — it can never fire, because an earlier check in the same block already aborts first with a misleading message, exactly like before the fix. The file's own comment also tells a future editor to do the one thing (move the DROP to match a new signature) that would silently reopen the hazard. |
| **016** | **MERGE-WITH-FIXES** | The rollback-scope BLOCK is genuinely closed — proven by execution to destroy an operator's format on the old rollback and preserve it on the new one, with the disclosed residue (a byte-identical hand-made row still gets deleted) confirmed real and confirmed to be exactly as narrow as claimed. The 017-applied preflight refusal works. Residual: the disclosed residue's own stated criterion (`dated`) isn't actually checked, and the new `app.tenant_seed_checks` registry table has no RLS, unlike every sibling table like it in the repo. |
| **017** | **BLOCK** | The CRITICAL SST-defaulting-to-zero-tax defect is genuinely fixed and was proven by execution: the exact zero-tax-no-policy-trace row is produced by the old code and cannot be produced by the new code. But **G6 found a new defect the fix pack introduced**: migration 017 cannot be applied to any database that already holds a quotation row — it fails with `SQLSTATE 55006` because the new SST backfill's `UPDATE` queues two pre-existing `DEFERRABLE` constraint triggers from migration 007, and the file's own new `SET NOT NULL` statement then refuses to run while those triggers are pending, inside the same one-transaction file. This is not cosmetic: it means 017 cannot be applied to the "retrofit" case its own header claims to support. |

**None of these verdicts reopens the original CRIT-1/CRIT-2 style findings from an earlier pack —
they are new or residual findings specific to this fix.**

---

## The two premise corrections the fix commit claims — both CONFIRMED

1. **015's original trap ("fails invisibly with a green-looking cron table") was overstated.**
   Confirmed independently, at the PostgreSQL source level and by direct execution: the pre-fix
   verify block already aborted when a second overload existed, via `to_regproc()` returning NULL
   for an ambiguous bare function name (not erroring, per `regprocin`'s soft-error path) — but with
   a misleading message ("does not resolve to a function") rather than naming the real cause. G6
   reproduced this exactly against the OLD code. The real exposure the fix commit identifies — a
   *later* migration adding the overload, long after 015's own one-time verify last ran — is real,
   and (see 015's findings below) the mechanism that actually covers it is the new pin's T6, not the
   migration's own new assertion, which is unreachable.
2. **017's policy-count check should be `228→234→228`, not the original review's suggested `<>222`.**
   Confirmed by direct execution: a clean 001-017 apply measures exactly 234 policies on `core`;
   rolling 017 back alone returns exactly 228. The original review's arithmetic was inverted (it
   subtracted from the wrong end). The fix's derived-not-literal check is correct.

---

## Part 1 — 015: the guard works, the new assertion doesn't

Both reviewers and G6 independently confirmed the `DROP FUNCTION IF EXISTS
app.reap_jobs_all_tenants(integer)` immediately before the `CREATE OR REPLACE`, and confirmed by
direct signature-change simulation that this line is what actually prevents `PGRST203`-style
overload ambiguity on a future edit (G6 tested it both ways: with the DROP correctly pinned to the
old signature, a simulated signature change is caught; with the DROP naively "kept in sync" with the
new signature per the file's own comment, the hazard reopens).

**But the new exact-overload-count verify assertion never fires.** G6 proved this directly: with a
second overload staged, the migration's verify block raises at an *earlier* check (the same
`to_regproc`-based one that predates this fix) with the same misleading "does not resolve to a
function" message every time — with zero overloads OR two, the block dies at the same line before
reaching the new assertion. The new check is placed after a check that already catches everything
it would catch, and always catches it first. **The fix's own comment claims this new assertion "earns
its place... it names the real cause" — that claim is false as written**, confirmed by execution, not
just by reading. Additionally, the fix's own comment tells a future editor to move the `DROP`
statement's signature in step with any future parameter-list change — G6 tested this exact
instruction and found it reopens the ambiguity hazard (both arms then fail identically). The
instruction is backwards: the DROP must keep naming the OLD signature to work.

The mechanism that genuinely covers the real exposure (a later migration reintroducing the hazard)
is the new pin's **T6**, which stages the hazard behaviorally and runs against the full applied set
after every later migration — not the migration's own one-time verify.

**Fix:** reorder the two verify checks so the new exact-count assertion runs first (or delete the
old `to_regproc` check now that the new one supersedes it), and correct the DROP-signature
instruction in the comment.

Neither reviewer nor G6 found this to be security-relevant — 015 was already the cleanest pack and
remains MERGE-WITH-FIXES on the strength of the pin (T6) and the working DROP, not the new assertion.

---

## Part 2 — 016: the rollback-scope BLOCK is genuinely closed

G6 proved the full before/after story by direct execution, not by reading the diff:

- **Against the OLD rollback**: a fixture with a tenant, an allocated real format, and an
  operator-configured `ZZQ` format was rolled back. Result: **the operator's ZZQ row was destroyed**,
  and the rollback reported OK — the original BLOCK, reproduced exactly.
- **Against the NEW rollback**, same fixture plus a byte-identical hand-made row matching a real
  derived format exactly (prefix, entity, width): the ZZQ row **survives**, the allocated row
  **survives**, and the byte-identical hand-made row **is deleted** — precisely the disclosed
  residue the fix commit states, no more and no less.
- **The 017-applied preflight**: confirmed to refuse with a message naming the exact mechanism
  (new tenants would get check keys and action policies but no ref formats), and confirmed by G6
  that running the OLD rollback (no preflight) while 017 was applied silently produced exactly that
  broken state — a new tenant with 22 action policies, 3 check keys, and zero ref formats, unable to
  allocate an `ENQ` reference at all.

**Residual findings, neither blocking but both real:**

- **N-5 (security pass, MED).** The rollback's own disclosure of what survives claims a hand-made row
  is indistinguishable from a seeded one when it matches "prefix, entity, **and dated**" — but the
  actual `WHERE` clause the DELETE and the post-condition use does **not** check `dated`, only
  prefix/entity/width. This means the disclosed residue is narrower than reality: an operator row
  with the right prefix/entity/width but a deliberately different `dated` flag is deleted anyway,
  contrary to what the file tells the reader would survive it. The honesty this fix is credited for
  is itself slightly inaccurate.
- **N-6 (security pass, MED) / thermonuclear finding.** The new `app.tenant_seed_checks` registry
  table — a real, positive design improvement (see below) — is the only table of its kind in the
  repo with no `ENABLE`/`FORCE ROW LEVEL SECURITY`. Every comparable global `app` reference table
  (`app.role_permissions`, `app.action_types`) has both. Not exploitable today (schema-wide grants
  already block client access), but it's the one place the standard backstop was skipped.
- **Thermonuclear, structural.** `app.tenant_seed_checks` is a genuinely better abstraction than the
  hardcoded two-relation check it replaces, but it only relocates the discipline problem rather than
  eliminating it: nothing enforces that a future migration adding a fourth tenant-provisioning
  trigger actually registers it in the table — the registry can still silently miss an entry the same
  way the original hardcoded check could. The completeness guard itself is still `IF v_seeded = 0`
  (a presence check), not an exact expected count, so a partially-seeded tenant still passes — the
  original 016 finding #3, generalized rather than fixed.

**Positive, independently confirmed by both reviewers and G6**: the registry genuinely contains all
three tenant-provisioning triggers' expectations (011's action-policy seed, 016's own ref-format
seed, 017's check-key seed), `app.provision_tenant`'s guard genuinely loops over it rather than
hardcoding relation names, and the new pin genuinely disables 017's specific trigger (verified: not
016's) and confirms `provision_tenant` refuses with a real `RAISE` naming the exact gap.

---

## Part 3 — 017: the CRITICAL is fixed; a new, different, equally serious defect was found by running it

### The CRITICAL SST defect: VERIFIED-FIXED, by direct execution against both arms

G6 inserted a quotation touching no SST column against the OLD code and got exactly the original
defect: `sst_rate=0, sst_reason='STANDARD_RATED', sst_policy_id=NULL, gross_price_sen=sell_price_sen`
— a taxable service billed at zero tax with no policy trace, silently. Against the NEW code, the
identical insert resolves through `app.resolve_tax_policy()` and produces a real rate, reason, and
policy reference. The trigger's "018 compatibility" claim (an explicit resolution from another
migration's write path is not overridden) was verified as a genuine internal branch — `IF
NEW.sst_reason IS NOT NULL AND NEW.sst_rate IS NOT NULL THEN RETURN NEW`, the first statement of the
trigger body, not prose — and confirmed by execution: an explicit UPDATE and a fresh explicit INSERT
both survive untouched, and a half-supplied position (only one of the two columns) is refused with a
named error. The backfill guard was confirmed to genuinely RAISE, not default or guess, for a
quotation older than the earliest applicable tax policy, and the unguarded-VALIDATE fix (count and
max value named before the ALTER) was independently confirmed to work correctly on the exact same
fixture that broke the OLD code silently.

### NEW BLOCKER, found only by execution: 017 cannot be applied to a database with an existing quotation

This is the most consequential finding in this pass. `017:846`'s `ALTER TABLE core.quotations ALTER
COLUMN sst_rate SET NOT NULL` — added by this very fix, to enforce the corrected SST invariant — runs
inside the same one-transaction file as the new SST backfill `UPDATE`. Migration 007 already put two
`DEFERRABLE INITIALLY DEFERRED` constraint triggers on `core.quotations`
(`trg_quotation_floor`, `trg_quotation_reconciled`). The backfill's `UPDATE` queues both; they stay
pending until `COMMIT`; and `ALTER TABLE ... SET NOT NULL` refuses to run while any trigger event is
pending on that table, failing with `SQLSTATE 55006` ("cannot ALTER TABLE because it has pending
trigger events"). G6 confirmed this is not transient (identical failure on repeated attempts, since
the whole file is one transaction and a retry starts from the same state) and confirmed the identical
fixture applies cleanly under the OLD 017 — this defect did not exist before this fix, it was
introduced by it. Re-running 017 on an already-017 database works fine (the backfill matches zero
rows, nothing queues) — the break is specifically the retrofit/non-empty-database case the file's own
header argues it must support.

**Fix, as identified by G6**: either add `SET CONSTRAINTS ALL IMMEDIATE;` after the backfill (which
would then also run 007's floor/reconciliation checks against the backfilled rows — worth deciding
whether that's wanted), or replace the two `SET NOT NULL` statements with a `NOT VALID` CHECK
constraint the same way several other invariants in this same file are already handled.

**A second, unrelated, pre-existing wall sits behind the first one** and was also found only by
trying to actually run the migration against real data: `017:226`'s guard
`pg_catalog.scale(margin_rate) > 4` is checking a column that is `GENERATED ALWAYS AS` a division of
two numerics, and PostgreSQL numeric division always produces scale 20 regardless of the actual
values — so this guard fires on **every** non-null quotation, unconditionally, regardless of whether
rounding would actually change anything. This predates this fix commit (present unchanged since
`21ec975`) and is not this fix's responsibility to close, but it means 017 was already inapplicable
to any database with a live quotation for an unrelated reason, and the new SST blocker is a second,
independent wall behind the first. Both should be fixed together since they block the same scenario.

### Other new/residual findings

| # | Sev | Finding |
|---|---|---|
| N-1 | **HIGH** (security pass) | The PDPA rollback guard's sentinel for quotations is "any row where `sst_reason IS NOT NULL`" — and this same fix pack makes `sst_reason` NOT NULL on every row. Combined with 016's and 014's own applied-migration preflights, **015/016/017 now have no rollback path at all on any database holding a single quotation**, without first deleting every quotation — confirmed by G6's direct execution of the guard, which correctly reports all four PDPA conditions together but was seeded with, and correctly refused on, exactly one quotation row. The guard's own comment ("on an empty database, which is where a rollback is actually exercised, this costs nothing") does not hold for this one sentinel the way it does for the other three. |
| N-2 | **HIGH** (security pass) | Several inventory/count claims in the migration headers and the catalog are now false, in the exact category that hid the original CRIT-1: 016's header still says "no table" (it now creates `app.tenant_seed_checks`); 017's header still says "two new functions" and names no trigger (it now has at least five functions and two triggers); the catalog still cites a stale assertion count for `test_017`. |
| N-3 | MED | The backfill guard (confirmed to genuinely raise, see above) approximates the real four-dimension resolver with a simpler global earliest-date check; a quotation that would fail the *real* resolver for other reasons (a different tenant's override window, a wrong `known` value) could pass the simplified guard and then abort the backfill `UPDATE` itself on an arbitrary row — a narrower version of the same "abort without naming which row" problem the guard exists to prevent. |
| N-4 | MED | The trigger's explicit-passthrough branch (needed for 018 compatibility, confirmed genuine above) means `sst_reason='STANDARD_RATED', sst_rate=0` — the exact original CRITICAL's state — is still fully legal if supplied explicitly rather than defaulted, and nothing cross-checks a supplied pair against the resolver or requires `sst_policy_id` to be non-null and consistent. Confirmed by execution: an explicit write can set a rate that contradicts the very policy `sst_policy_id` points at, and the pin currently asserts this inconsistent state as acceptable. Not currently exploitable (the client role has no INSERT/UPDATE grant on `core.quotations`), so this is the CRIT's defect class surviving on a path nothing can reach today rather than a live hole — worth closing before an RPC opens that path. |
| N-7/N-8 (LOW) | Two test-pin quality issues: a fixture ordering issue in `test_017` where an earlier test overwrites a later test's own fixture row before the later test reads it (the later assertions still pass for other, valid reasons, but not for the reason they claim to); and `test_015` creates a real, non-temp function in the `app` schema as part of its overload-hazard staging, contained only by the pin reaching its final `ROLLBACK` — the same class of hazard as an already-known open finding on `test_004`. |

**Thermonuclear, structural (017 verdict from this lens alone: BLOCK):** the file grew from 1340 to
1597 lines in this fix pass alone, with comment share increasing (35.4%→36.4%); the file's own newly
-strengthened NOT VALID/VALIDATE rule is immediately violated by seven of the eleven constraint-adds
in the same file, three of them newly added by this very fix; and the SST resolution logic is
duplicated (the same rate/reason mapping written once in the trigger and once in the backfill),
creating exactly the kind of "three paths to one concept" this skill flags. None of these are new
correctness bugs beyond what's captured above, but they corroborate, from an independent angle, that
017 has now accumulated enough unrelated concerns in one transaction that the maintainability
argument for splitting it (recorded as "owed" in this fix's own commit message) is no longer
optional.

---

## Part 4 — the 014 re-review items: PENDING, not yet folded in

Per the last instruction, this pass checked whether the three items assigned to `fix-014`'s next push
(the `run:read` seven-table gap, T11a's tautological assertion, and the pin header's 001-014 vs.
001-017 mismatch) had landed by the time this review ran. **They have not** — confirmed by `git diff
--stat 21ec975..bdd49aa` touching zero files under any `014` name. These remain open and unaddressed
as of this commit; note for whoever picks up the next 014 push.

---

## Execution log (G6), summary

**Harness:** fresh scratch PostgreSQL 17.11, port 5448 (distinct from concurrent shims in this shared
repo), reusing the already-present local stub `pg_cron`/`pg_net` extension files from a prior pass.
Confirmed first that every file under `supabase/migrations`, `supabase/rollbacks`, `supabase/tests`
for 001-014 (plus the 014-rollback pin) is byte-identical between `21ec975` and `bdd49aa`, so a single
shared base template (001-014 applied once) was valid for both arms.

**Phase 1 (OLD 015/016/017 against the NEW pins):** the NEW pin's dedicated regression tests for 015
(T6) and 016 (T7) **both pass against the OLD, pre-fix code** — they assert correct invariants but do
not actually discriminate old from new, so they are not regression tests for the findings they cite;
this review confirmed the real pre-fix defects directly instead (staged the actual attack/scenario
outside the pin) and reproduced every one exactly: the ambiguous-overload abort with the misleading
message, the operator's ZZQ row destroyed by the unscoped rollback, the missing preflight silently
producing an unwritable tenant, the zero-tax quotation with no policy trace, the anonymous VALIDATE
abort, the T3b/T5b fixtures never executing, and a populated PDPA breach register destroyed by the
old rollback with no refusal. Migration 017's own pin (T11, the SST behavioral test) is the one
pin in this fix pack confirmed to be a genuine, discriminating regression test — it fails cleanly
against OLD 017 and passes against NEW 017.

**Phase 2 (NEW 015/016/017 against the NEW pins):** every pin from 001 through 017 passes (counts:
001:13, 002:13, 003:7, 004:9, 005:9, 006:7, 007:13, 008:10, 009:10, 010:18, 011:14, 012:14, 013:13,
014:16, 015:6, 016:7, 017:13). Direct-SQL verification beyond the pins confirmed: the 015 overload
guard's DROP-vs-verify-assertion split described above; the 016 rollback's exact residue boundary; the
017-applied preflight's refusal and the harm it prevents when bypassed; the SST trigger's explicit-
passthrough, half-position-refusal, and backfill-guard behaviors; the VALIDATE guard's before/after
ordering; the PDPA rollback guard's all-four-at-once refusal; a genuine raw-table cross-tenant read of
`core.data_breach_register` returning zero rows with no error; the `tenant_seed_checks` registry's
three entries and its refusal when a seed trigger is disabled; and the exact 234→228 policy-count
transition. **The NEW BLOCKER (SQLSTATE 55006) was found only in this phase**, when G6 tested the
migration against a database seeded with a pre-existing quotation row rather than an empty one — a
scenario neither the original nor the fix commit's own pin exercises.

**Rollback chain and re-apply**: 017→016→015 rolled back in order (each refusing/succeeding
correctly per the findings above), re-applied forward, all pins re-run — all pass, counts unchanged.
`check:grants`: clean. `lint:sql`: 52/52.

## Could not verify

- Migrations 003, 005, 006, 008, 009, 010, 012 were not independently re-audited beyond what 015/016/017
  touch — same open gap as prior passes.
- 018 (`put_quotation`, referenced by 017's "explicit resolution" compatibility claim) does not exist
  in this repository yet; the trigger's compatibility branch was verified as a real code path, not
  against its actual future consumer.
- Whether the migration-applying role holds `BYPASSRLS` on the hosted target remains unmeasured
  against a real Supabase project, as in every prior pass.
- The `55006` blocker and the `margin_rate` scale-guard issue were found by constructing a
  representative fixture (one pre-existing quotation); a database with many quotations across a wider
  range of ages/states was not exhaustively tested, though the failure mechanism (any pending
  deferred-trigger event on the table at the point of `ALTER ... SET NOT NULL`) generalizes to any
  non-empty `core.quotations` table, not just this specific fixture.
- Codex's consumer-trace lens has still never run against any of 014, 015, 016, or 017's fix commits.

---

**PR:** review/codex-015-017-rereview → main, PARALLELPARADIGMS/alex-project.
