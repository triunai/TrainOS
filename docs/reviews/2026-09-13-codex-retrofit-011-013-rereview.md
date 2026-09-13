# 011–013 re-review — fixes at cloud/migrations@0d9e00c

**Reviewed:** the fix commits `2bac9bf` and `0d9e00c` on `cloud/migrations` ("fix(supabase): 011-013
remaining — replay ledger, 42501 refusals, service_role"), amending `supabase/migrations/011_action_envelope_and_policy_gate.sql`,
`012_events_outbox_and_jobs.sql`, `013_ai_ops_agents_keys_runs_and_budgets.sql`, their test pins, and
`migration-catalog.md` in place (001–013 are applied nowhere, so the originals were edited rather than
superseded by a new migration). Pre-fix baseline: `b9bca03` on `main` (the merged prior review).
Reviewed in `~/Repos/personal-work/trainos-wt/fix-011-013-src` (detached at `0d9e00c`). This report is
written from a fresh branch cut off `origin/main`.

**Reviewers:** the same substitute pair as the first pass (Codex is still hard quota-blocked past
2026-09-14 00:29 as of this writing) — an Opus thermonuclear-methodology pass and an Opus
`security-reviewer` pass, run independently with no coordination between them. Both were told the
prior review's nine claimed-fixed findings and asked to verify each against the code, not the commit
message. The orchestrator (this agent) additionally executed the full G6 gate on a fresh instance of
the same port-5439 shim, and live-reproduced four of the disputed points below.

---

## VERDICT, per pack, up front

**Pack 011 — PARTIAL FIX. Do not treat as closed.**
T2/O2 (dead effect pipeline) and T8 (GUC residue) are cleanly fixed. T3 (no permission check) is
fixed correctly, including the payload-schema-leak ordering bug from an earlier draft — but it
**introduced a live regression**: `CLIENT`-kind actors now have zero permission rows anywhere in the
seeded catalogue, so every CLIENT-initiated action is unconditionally refused. **T5 (the diff-hash
guard hashes an `IMMUTABLE` function, so an approver can never be shown that the underlying record
changed) was deferred and remains open** — both reviewers independently conclude this deferral is not
acceptable; the security pass calls it "the most serious defect in the pack." The 011 rollback was not
updated to drop the new `required_permission` column, and `test_011`'s own header/dependency claims are
now false in a new way (see S7-adjacent finding below).

**Pack 012 — NOT ACTUALLY FIXED on the finding that mattered.** T1's claimed fix ("replay reopens the
effect") only touches `app.action_effects`. **`core.action_requests` is never reopened, so a
successfully-replayed effect leaves the parent action permanently `PARTIALLY_FAILED` forever** — this
is live-reproduced below, not reasoned about. This was the exact incident the finding described
("TrainOS says it failed, forever") and it still happens. No pin was added for it; the existing T13 pin
does not read `core.action_requests` after the replay, so it passes identically before and after this
"fix."

**Pack 013 — PARTIAL FIX, with a live-confirmed audit bypass.** The reveal-audit trigger fix and the
`key_fingerprint`/`key_ref` pairing fix genuinely make `set → reveal → rotate` succeed (confirmed live:
`test_013` T14 passes, and the orchestrator ran the same sequence directly). **But the pairing is
one-directional**: `key_ref` can be changed alone, with no fingerprint change, with no audit trigger
firing at all — live-reproduced below. The function/trigger count drift this round's own T14 fix was
supposed to close in 011 was simultaneously reintroduced in 013 (catalog still says 29 functions; the
file now has 30), and the new pairing trigger sits outside every existing verification sweep.

---

## Postscript — `cloud/migrations` has already moved past `0d9e00c`, read before acting on this report

While this review was in progress, `cloud/migrations` advanced two more commits (`eff8084`,
`a20e6d8`, commit-message-summarized as "T5 end to end" and "T1/T5 and the residuals") — **neither is
merged to `origin/main` yet**, and the `ai/`-spine doc commits that reference them on `main`
("record a20e6d8 as the new frozen tip") are progress notes about work on that branch, not evidence
the fix itself landed on `main`. Checked directly against both commits, not inferred from their
messages:

- **T5 is genuinely fixed on `cloud/migrations` as of `a20e6d8`.** The diff-hash's queue-time and
  decide-time computations both now fold in `app.action_value(...)` (which reads the live record)
  alongside `app.plan_effects(...)` (which does not), closing exactly the tautology this report
  and both reviewers flagged. This supersedes the "not acceptable to defer" judgment above **for
  whichever branch state actually ships** — but it is not yet on `main`, so the pack this report was
  asked to verify (`0d9e00c`) still has it open, and the verdict above is accurate for that commit.
- **T1 is NOT fixed by `eff8084`, despite the commit naming it "T1 (CRIT)."** The commit's own diff
  touches only `supabase/tests/test_012_events_outbox_and_jobs.sql` (a new T15 pin) — it does not
  touch `supabase/migrations/012_events_outbox_and_jobs.sql` at all, and the new pin asserts only that
  `app.action_effects` reaches `SETTLED` after a replay, which was already true at `0d9e00c` (this
  report confirmed that much live in §3). **It does not assert anything about
  `core.action_requests.status`**, so it cannot and does not catch the residual this report
  live-reproduced (the action staying `PARTIALLY_FAILED` forever). The commit message's framing of T1
  as addressed is not supported by its own diff.

**Recommendation:** before closing T1 or T5 as resolved anywhere, re-run this report's exact §3
live reproduction (claim-and-complete the replayed job, then read `core.action_requests.status`)
against whatever commit is actually about to merge — a passing `test_012` T15 will not tell you
whether it is fixed.

---

## 1 · Verdict table for the nine originally-claimed fixes

| # | Finding | Claimed | Actual verdict | Evidence |
|---|---|---|---|---|
| T2/O2 | Effects never enqueued (CRIT) | FIXED | **FIXED, clean** | `011:1987-1998`: existence check raises loud (does not silently skip) if `app.enqueue_effect_jobs` is missing; enqueue call correctly placed before the `EXECUTING` write; args match `012`'s signature. `test_011` T16 walks perform → decide → `app.claim_jobs` end to end. Both reviewers and the orchestrator's live pin run agree. |
| S1(a) | Reveal-audit trigger blocks all rotation (CRIT) | FIXED | **FIXED, clean** | `013:2205-2209` exemption requires `last_revealed_at IS NULL` AND both `key_ref` and `key_fingerprint` distinct — narrow, cannot be used to reset the 24h ceiling. Live-confirmed: `set → reveal → rotate` now succeeds (see §3). |
| S1(b) | `key_fingerprint` frozen, so rotation never worked at all (CRIT, found mid-fix) | FIXED | **PARTIALLY FIXED — live-confirmed bypass** | The frozen-column defect is genuinely fixed. But the new pairing trigger (`013:1463-1499`) only fires when `key_fingerprint` changes. **`key_ref` can be changed alone with no trigger firing and no audit row**, live-confirmed in §3. Both reviewers found this independently by reading; the orchestrator reproduced it. |
| T1 | Successful replay recorded as permanent failure (CRIT) | FIXED | **NOT ACTUALLY FIXED — live-confirmed** | `012:2159-2164` reopens the *effect*. `core.action_requests` is never reopened; the reconciliation at `011:3547-3552` is still gated `AND status='EXECUTING'`, which the request has left. Live-reproduced in §3: after a full claim→complete cycle on the replayed job, the effect reaches `SETTLED` but the action request stays `PARTIALLY_FAILED`. No pin exercises this. |
| T3 | No permission check on HUMAN path (HIGH) | FIXED | **FIXED, correctly ordered — but introduces a new HIGH regression** | Check at `011:2292-2310` sits between action-type lookup and payload validation, closing the payload-schema-leak bug an earlier draft had (pinned at `test_011` T17c3). Live-confirmed: `app.role_permissions` and `app.app_role` both exist; **`CLIENT` is a valid role with zero permission rows** — every CLIENT-kind `perform_action` call is now unconditionally `FORBIDDEN`. Neither the migration's verify block nor any pin exercises a CLIENT actor, so this shipped unnoticed. Also: SALES's three "scope-narrowed" permissions (`organisation:write`, `enquiry:archive`, `tna:recommendation:accept`) are checked at role level only — 002's own annotation says these need row-ownership narrowing that `app.has_permission` does not apply, so a SALES rep can act on any organisation in the tenant, not just their own (net improvement over "no check at all," but the weakest plausible mapping for a credit-control action). |
| S5 | 013 uses 42501 instead of `TRNOS` (HIGH) | FIXED, "13 sites, 2 deliberate exceptions" | **PARTIALLY FIXED — the commit's own count is wrong, and one of the two "unreachable" exceptions is reachable** | Only **11** sites converted to `TRNOS`, not 13 (verified by counting `+TRNOS`/`-insufficient_privilege` in the diff and by grep on the resulting file: 11 `TRNOS`, 2 `insufficient_privilege`). The two survivors (`013:2231` `REVEAL_AUDIT_REQUIRED`, `013:2247` `REVEAL_AUDIT_MISMATCH`) are justified in-file as "trigger integrity guards on a direct table write that no RPC path can reach." **That justification is wrong for `REVEAL_AUDIT_MISMATCH`**: `public.ai_provider_key_reveal` (`013:2606-2691`) is a `SECURITY DEFINER` RPC that performs the very `UPDATE core.ai_provider_keys SET last_revealed_at = ...` that fires this trigger, with no exception handler around it. On a hosted platform where the migration owner lacks `BYPASSRLS` (the exact condition the file's own comment three lines above names as a real degradation), `app.record_key_access`'s internal read can silently miss under the documented FORCE-RLS-with-no-policy residue, the trigger's `NOT EXISTS` check fails, and `REVEAL_AUDIT_MISMATCH` (42501) propagates straight out to a real `authenticated` PostgREST caller — reproducing exactly the "session expired" mistranslation this fix set out to close. This is a genuine disagreement between the two independent reviewers (the security pass concluded neither raise was reachable); the orchestrator resolved it by reading `ai_provider_key_reveal`'s body directly (§3) and finds the thermonuclear pass's reading correct. |
| S3 | `service_role` not revoked on 5 BYOK functions (HIGH) | FIXED, unconfirmable locally | **FIXED, syntax verified correct** | `013:3086`: the revoke loop resolves each function by exact `oid::regprocedure` signature (not a guessed argument list), so it cannot silently revoke nothing. Both reviewers agree. Confirmation against a real Supabase project's default-privilege bootstrap is still owed, as the fix itself discloses. |
| T8 | `effect_applier` GUC never cleared (MED) | FIXED | **FIXED, clean, including exception paths** | Cleared at `011:2015`. Both call sites (`decide_approval`, `bulk_decide`'s loop) have no exception handler around the clear, so a failure aborts the whole transaction rather than leaving residue — a stronger guarantee than "cleared on the happy path only." |
| T14 | Catalog said 27 functions, actually 28 (MED) | FIXED | **PARTIALLY FIXED, and the same defect class was reintroduced elsewhere in the same commit** | Corrected at `migration-catalog.md:147` and `:222` (verified: 011 genuinely has 28). **Still wrong at `migration-catalog.md:1277`** ("11 tables, 27 functions"), in the pin-results section. **And 013 now has the identical problem the commit was fixing**: 013 grew a 30th function (`app.enforce_key_material_pairing`, added by this same commit) and a 5th trigger, but the catalog still says "twenty-nine functions, four triggers" in two places (`migration-catalog.md:97,220`), confirmed live via `grep -c` against the actual file. |
| S7 | Catalog/pins didn't disclose the 012/013-pins-need-014 dependency (MED) | FIXED | **PARTIALLY FIXED, and a new instance of the same class was created in 011** | `test_012` and `test_013` headers corrected; `migration-catalog.md:1077` (013's pin section) corrected. **`migration-catalog.md:1182`** (012's pin section) still says the pins ran "against the FULL applied set 001–012" — contradicting the commit's own claim that "012's header says the same [014 dependency]." **New instance**: `test_011`'s header (line 5) still reads "Run against the complete 001-011 set," but the new T16 (added by *this* fix, to close T2/O2) calls `app.enqueue_effect_jobs` and `app.claim_jobs`, both 012 objects — so `test_011` now silently depends on 012 as well, undocumented, the exact defect class S7 was raised to close, reintroduced by the fix that closed it elsewhere. |

## 2 · Judgment on the four deferred items

| Item | Deferred because | Judgment |
|---|---|---|
| **T4/F4** — `bulk_decide` response shape vs. the TS contract | "Needs SQL + TS changed together" | **Acceptable to defer.** Genuinely cross-lane (web); `bulk_decide` has no per-item exception handling, so the shape mismatch cannot cause a refusal to render as an approval. Not security-relevant, correctly scoped out. |
| **T5** — diff-hash guard hashes an `IMMUTABLE` function; `DIFF_CHANGED` can never fire | "Wants its own pass," being routed separately | **NOT acceptable to defer, per both reviewers independently.** This is a TOCTOU authorization gap on money-moving approvals: an approver consents to a specific record state, the record changes before the decision executes, and the approval is recorded as valid against a hash that is mathematically incapable of detecting the change (`app.plan_effects` is declared `IMMUTABLE` and reads only frozen columns of the request itself — verified by both reviewers independently). The security pass explicitly ranks this above several items that were treated as blockers in the original review and recommends treating it as a standing block on any live use of the approval UI, not a backlog item. The orchestrator concurs: this sits ~10 lines from code this very commit edited (`011:2982`), so "it wants its own pass" is not a reason it couldn't have been named as a still-open BLOCK condition in the commit's own language — it was framed as closed-adjacent when it is not. |
| **S4/T16** — worker heartbeat lease-shortening race | "`apps/worker` scope" | **Acceptable to defer.** No SQL in 011–013 closes it, and the security pass notes the residual double-send risk is bounded by the replay path's stable provider idempotency key (`012:2185`), which most providers will dedupe on. Liveness risk, not an authorization one. |
| **T11** — 013 has zero TypeScript consumers | "Product ruling, not a migration fix" | **Acceptable to defer**, and arguably safer now: with S3 fixed, none of the five BYOK RPCs are reachable from any granted role at all. Unreachable surface is not exposure. The standing condition: whoever wires the first real consumer must re-confirm the `service_role` revoke against a real Supabase project first, since S3 is unconfirmable on this harness. |

## 3 · Live reproductions (orchestrator execution)

All three run against a fresh instance of the same isolated shim used in the first review (port 5439,
own data directory), with 001–010 unchanged, 011–013 at `0d9e00c`, and 014 (also amended on this
branch) applied to satisfy the pins' own stated dependency.

**G6, full:** forward apply 001–014 (all 14 clean), all three pins re-run and genuinely pass —
`test_011` 16/16 (up from 14; T16/T17 are new), `test_012` 14/14, `test_013` 14/14 (up from 13; T14 is
new). This directly answers both reviewers' shared caveat that they "did not execute the pins" — they
do pass as claimed. That is not the same as the underlying defects being closed; see below.

**T1 residual — reproduced.** Reused `test_012`'s own T13 fixture (dead-letters a job, replays it),
then extended it: claimed and completed the replacement job exactly as the worker would.

```
REPRO RESULT: action_request status before replay-completion = PARTIALLY_FAILED,
              after = PARTIALLY_FAILED; effect status after = SETTLED
```

The effect genuinely settled — the invoice really was pushed on replay — and the action request never
recovered. This is the unfixed half of T1, confirmed by execution, not by reading.

**S1(b) residual — reproduced.** Set a key, revealed it (establishing `last_revealed_at` and
`key_ref`), then attempted to change `key_ref` alone with `key_fingerprint` untouched and no
`app.key_reveal_audit` GUC set:

```
KEY_REF-ALONE UPDATE SUCCEEDED (bypass confirmed)
```

No trigger fired; no audit row was written. A follow-up reveal attempt was correctly still blocked by
the unrelated 24-hour ceiling (`last_revealed_at` was untouched by the `key_ref`-only write), so the
practical exploit window is bounded by that ceiling, not immediate — worth stating precisely rather
than overstating: **the swap itself is silent and unaudited today; whether it is immediately
exploitable depends on when the key was last legitimately revealed.** Once the ceiling clears (or on a
never-revealed key), a subsequent legitimate-looking reveal would hand out the substituted locator with
no audit trail distinguishing it from the original.

**S5 disagreement — resolved.** Read `public.ai_provider_key_reveal` in full (`013:2606-2691`): it is
`SECURITY DEFINER`, performs the `UPDATE core.ai_provider_keys SET last_revealed_at = now() ...` itself
(the exact write that fires `require_reveal_audit`), with no exception handler around that statement.
The trigger's `REVEAL_AUDIT_MISMATCH` raise is therefore not confined to "a direct table write no RPC
path can reach" — it is reachable through this RPC's own body under the RLS-residue degradation the
file documents three lines above the "no RPC path can reach it" comment. **The thermonuclear pass's
finding is correct; the security pass's contrary reading does not survive reading the RPC body.**

**Function-count drift — reproduced.** `grep -c '^CREATE OR REPLACE FUNCTION' 013_*.sql` = 30.
`migration-catalog.md` still says "twenty-nine functions" at both its occurrences for 013.

---

## 4 · New defects, not in the original review (both reviewers, cross-checked by the orchestrator)

- **`CLIENT`-role permission gap (HIGH)** — see T3 row above. Live-confirmed: `app.app_role` includes
  `CLIENT`; `app.role_permissions` has rows only for `SALES, SALES_MANAGER, OPS, FINANCE, MD, ADMIN,
  TRAINER`. Whether this is a regression or an undocumented product decision needs an answer before
  merge — it categorically blocks every client-portal-initiated action.
- **Both packs' rollbacks are now out of sync with their forward migrations.** 011's rollback does not
  drop the new `required_permission` column (its verify block checks row count and policy, not
  columns, so it passes while leaving 004's table carrying an 011-owned column). 013's rollback drops
  `core.ai_provider_keys CASCADE` (which takes the new trigger with it) but never explicitly drops
  `app.enforce_key_material_pairing()`, and that function is absent from the rollback's own
  surviving-function sweep — an orphan the rollback's own verify block cannot see.
- **The new 013 pairing trigger function sits outside every existing invariant sweep** — absent from
  `v_app_fns` in both the migration's own verify block and `test_013`'s array, so its `search_path`,
  grant posture and existence are all unpinned (though manually confirmed clean by both reviewers).
- **Test-file hygiene in `test_011`**: the pre-existing grant-closure test block's assertion labels
  were renamed to `T16a`/`T16b` in what looks like an unintended find/replace collision with the
  genuinely new `T16` (enqueue) test, which independently uses the same label. A failure reading
  "T16a FAIL" is now ambiguous between two unrelated checks. Cosmetic but worth a follow-up commit
  before it causes a real triage delay.

---

## 5 · What could not be verified

- **S3 and the `key_ref`/`key_fingerprint` pairing's real-world exploitability against a hosted
  Supabase project.** This harness's `postgres` is superuser/`BYPASSRLS`; the documented RLS-residue
  degradation that makes `REVEAL_AUDIT_MISMATCH` reachable (§3) cannot itself be triggered here, only
  reasoned about from the trigger's own logic and the RPC's call structure. Both remain **owed**
  against a real project, as the fix's own commentary discloses for S3.
  - **Whether the `key_ref`-alone bypass is exploitable in practice depends on who can `UPDATE
    core.ai_provider_keys` directly** on a hosted project — this repo grants no client role that
    privilege, so the realistic threat model is an elevated role or a future consumer (013 currently
    has none — see T11). Not dismissible, but not `authenticated`-reachable today.
- **Whether `CLIENT` actors exist at runtime.** No TypeScript in this repo sets `actor_kind: "CLIENT"`,
  so this repo alone cannot confirm whether the finding is a live product outage or dead code today —
  it becomes live the moment a client-portal write path is wired to `perform_action`.
- **015/016/017**, also present on `cloud/migrations`, were not read as part of this scope. Nothing in
  this report should be read as clearing them.

---

**PR:** to be opened from `rereview/codex-011-013` → `main`.
