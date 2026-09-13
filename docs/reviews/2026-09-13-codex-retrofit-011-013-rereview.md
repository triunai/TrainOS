# 011–013 re-review — fixes at cloud/migrations@0d9e00c, updated through eff8084

**Reviewed:** the fix commits `2bac9bf` and `0d9e00c` on `cloud/migrations` ("fix(supabase): 011-013
remaining — replay ledger, 42501 refusals, service_role"), amending `supabase/migrations/011_action_envelope_and_policy_gate.sql`,
`012_events_outbox_and_jobs.sql`, `013_ai_ops_agents_keys_runs_and_budgets.sql`, their test pins, and
`migration-catalog.md` in place (001–013 are applied nowhere, so the originals were edited rather than
superseded by a new migration). Pre-fix baseline: `b9bca03` on `main` (the merged prior review).
**Updated in place after the initial pass**: `cloud/migrations` moved to `eff8084` (frozen tip as of
this update), which the team lead flagged as landing `test_012` T15 (the T1 replay pin) and
`test_011` T18 (the T5 diff-hash pin). Both are now included below with full live re-execution against
`eff8084` specifically, not just the earlier `0d9e00c` snapshot — see "§0 · eff8084 update" for what
changed and what did not. Reviewed in `~/Repos/personal-work/trainos-wt/fix-011-013-src` (checked out
at `0d9e00c` for the first pass, then moved to `eff8084` for this update). This report is written from
a fresh branch cut off `origin/main`.

**Reviewers:** the same substitute pair as the first pass (Codex is still hard quota-blocked past
2026-09-14 00:29 as of this writing) — an Opus thermonuclear-methodology pass and an Opus
`security-reviewer` pass, run independently with no coordination between them. Both were told the
prior review's nine claimed-fixed findings and asked to verify each against the code, not the commit
message. The orchestrator (this agent) additionally executed the full G6 gate on a fresh instance of
the same port-5439 shim, and live-reproduced four of the disputed points below.

---

## VERDICT, per pack, up front

**Pack 011 — PARTIAL FIX, upgraded from the first pass. T5 is now genuinely closed; do not treat the
rest as closed.** T2/O2 (dead effect pipeline), T8 (GUC residue), and **T5 as of `eff8084`** are all
cleanly fixed and live-confirmed (`test_011` T18 passes: editing the underlying quotation moves the
hash, live-reproduced in §0). T3 (no permission check) is fixed correctly, including the
payload-schema-leak ordering bug from an earlier draft — but it **introduced a live regression**:
`CLIENT`-kind actors now have zero permission rows anywhere in the seeded catalogue, so every
CLIENT-initiated action is unconditionally refused. The 011 rollback was not updated to drop the new
`required_permission` column, and `test_011`'s own header/dependency claims are false in more than one
new way (it now silently requires 012's objects for T16, **and as of `eff8084` it also silently
requires 016's tenant-provisioning trigger** for its own new quotation fixture — see §0).

**Pack 012 — STILL NOT ACTUALLY FIXED on the finding that mattered, confirmed against `eff8084`
directly, not just `0d9e00c`.** `eff8084` adds `test_012` T15, explicitly written to pin this exact
finding — but T15 only asserts `app.action_effects.status = 'SETTLED'` after a full claim → fail →
replay → claim → complete round trip. **It never reads `core.action_requests` at all.** The orchestrator
extended T15's own fixture (§0) to check the parent action request immediately after T15 itself passes:
the effect is `SETTLED`, exactly as T15 requires, and `core.action_requests.status` is still
`PARTIALLY_FAILED`. This is the exact incident the finding described ("TrainOS says it failed,
forever") and it still happens, on the commit the team lead pointed at as having fixed it.

**Pack 013 — PARTIAL FIX, with a live-confirmed audit bypass.** The reveal-audit trigger fix and the
`key_fingerprint`/`key_ref` pairing fix genuinely make `set → reveal → rotate` succeed (confirmed live:
`test_013` T14 passes, and the orchestrator ran the same sequence directly). **But the pairing is
one-directional**: `key_ref` can be changed alone, with no fingerprint change, with no audit trigger
firing at all — live-reproduced below. The function/trigger count drift this round's own T14 fix was
supposed to close in 011 was simultaneously reintroduced in 013 (catalog still says 29 functions; the
file now has 30), and the new pairing trigger sits outside every existing verification sweep.

---

## §0 · eff8084 update — both items checked directly, not by commit message

`cloud/migrations` moved to `eff8084` (frozen tip) — **not yet merged to `origin/main`**; the `ai/`-spine
doc commits on `main` that reference it are progress notes about work on that branch, not evidence the
merge happened. The team lead asked for both `test_012` T15 (T1) and `test_011` T18 (T5) to be reviewed
and included. Both were re-verified with a full G6 re-execution at `eff8084` (not inferred from the
diff this time) — this required also applying 015, 016 and 017, because `eff8084`'s new `test_011`
quotation fixture (added so T18 has a real record to edit) needs a `core.ref_formats` row for prefix
`QUO` that only 016's tenant-provisioning trigger supplies; `test_011` did not need 015–017 before this
commit. That is itself a new instance of the S7 dependency-drift class, on top of the one already
noted for T16 in the paragraph above.

**T5 — genuinely fixed, live-confirmed at `eff8084`.** Applied 001–017 clean, ran `test_011` in full:
17/17 checks pass, including the new T18 —

```
T18 PASS - plan_effects is IMMUTABLE and reads no row, so the hash now also covers
app.action_value: editing the underlying record moves it, and two different effect
plans still hash differently.
```

The queue-time and decide-time hash computations both now fold `app.action_value(...)` (which reads
the live record) alongside `app.plan_effects(...)` (which does not) — confirmed by reading `a20e6d8`'s
diff and by this pin genuinely exercising an edited quotation rather than skipping, closing exactly the
tautology this report and both reviewers flagged. **This supersedes the "not acceptable to defer"
judgment for T5** — it is no longer deferred, it is closed, on this branch. Still not on `main`.

**T1 — NOT fixed, live-reproduced at `eff8084` directly, using T15's own fixture.** `eff8084`'s new
`test_012` T15 is explicitly written to pin this exact finding, and it passes:

```
T15 PASS - a dead-lettered effect is reopened to DISPATCHED by the replay and reaches
SETTLED when the replacement job completes, so the ledger agrees with what actually happened.
```

But T15's own assertions (`test_012_events_outbox_and_jobs.sql:1789-1813`) read only
`app.action_effects.status` — never `core.action_requests`. The orchestrator inserted one additional
check immediately after T15's own `DO` block, in the same transaction, using T15's own effect/job:

```sql
SELECT e.id, e.action_request_id, e.status::text
  INTO v_effect, v_request_id, v_effect_status
  FROM app.action_effects AS e
 WHERE e.status = 'SETTLED'
 ORDER BY e.id DESC LIMIT 1;
SELECT status INTO v_req_status FROM core.action_requests WHERE id = v_request_id;
```

Result:

```
REPRO RESULT (eff8084): effect 14 status = SETTLED, parent action_request
00000012-aaaa-aaaa-aaaa-aaaaaaaaaaa2 status = PARTIALLY_FAILED
```

**The action request is still permanently `PARTIALLY_FAILED` after a fully successful replay, on the
exact commit reported as having fixed T1.** T15 is a real, well-constructed pin — it correctly proves
the effect-ledger half is fixed — but it does not, and structurally cannot, catch the half of the
finding that was actually named "TrainOS says it failed, forever." No code in `eff8084` touches
`supabase/migrations/012_events_outbox_and_jobs.sql` or the `PARTIALLY_FAILED` reconciliation at
`011:3547-3552`; the diff is entirely a new test file.

**Recommendation, unchanged:** before closing T1 as resolved anywhere, re-run the exact repro above
(claim-and-complete the replayed job, then read `core.action_requests.status`) against whatever commit
is actually about to merge. A passing `test_012` T15 does not mean this is fixed — it means the half
of it that was already fixed at `0d9e00c` is now also pinned.

---

## 1 · Verdict table for the nine originally-claimed fixes

| # | Finding | Claimed | Actual verdict | Evidence |
|---|---|---|---|---|
| T2/O2 | Effects never enqueued (CRIT) | FIXED | **FIXED, clean** | `011:1987-1998`: existence check raises loud (does not silently skip) if `app.enqueue_effect_jobs` is missing; enqueue call correctly placed before the `EXECUTING` write; args match `012`'s signature. `test_011` T16 walks perform → decide → `app.claim_jobs` end to end. Both reviewers and the orchestrator's live pin run agree. |
| S1(a) | Reveal-audit trigger blocks all rotation (CRIT) | FIXED | **FIXED, clean** | `013:2205-2209` exemption requires `last_revealed_at IS NULL` AND both `key_ref` and `key_fingerprint` distinct — narrow, cannot be used to reset the 24h ceiling. Live-confirmed: `set → reveal → rotate` now succeeds (see §3). |
| S1(b) | `key_fingerprint` frozen, so rotation never worked at all (CRIT, found mid-fix) | FIXED | **PARTIALLY FIXED — live-confirmed bypass** | The frozen-column defect is genuinely fixed. But the new pairing trigger (`013:1463-1499`) only fires when `key_fingerprint` changes. **`key_ref` can be changed alone with no trigger firing and no audit row**, live-confirmed in §3. Both reviewers found this independently by reading; the orchestrator reproduced it. |
| T1 | Successful replay recorded as permanent failure (CRIT) | FIXED (0d9e00c); "T1 (CRIT)" pin added at eff8084 | **STILL NOT ACTUALLY FIXED — live-confirmed at both commits** | `012:2159-2164` reopens the *effect*. `core.action_requests` is never reopened; the reconciliation at `011:3547-3552` is still gated `AND status='EXECUTING'`, which the request has left. Live-reproduced twice: at `0d9e00c` in §3 (full claim→complete cycle on the replayed job leaves the effect `SETTLED` but the action `PARTIALLY_FAILED`), and again at `eff8084` in §0 using `test_012`'s own new T15 fixture — same result, `effect 14 = SETTLED`, `action_request = PARTIALLY_FAILED`. T15 passes because it only reads `app.action_effects`, never `core.action_requests`. |
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
| **T5** — diff-hash guard hashes an `IMMUTABLE` function; `DIFF_CHANGED` can never fire | "Wants its own pass," being routed separately at `0d9e00c` | **SUPERSEDED — fixed at `eff8084`/`a20e6d8`, live-confirmed.** At `0d9e00c` this was correctly judged unacceptable to defer by both reviewers, on the grounds that it is a TOCTOU authorization gap on money-moving approvals (`app.plan_effects` is `IMMUTABLE` and reads only frozen columns of the request, verified independently by both reviewers). It has since been fixed: the hash now folds in `app.action_value(...)`, which reads the live record, and `test_011` T18 (added in the same fix) passes live against a real edited quotation — see §0. Not yet on `main`. |
| **S4/T16** — worker heartbeat lease-shortening race | "`apps/worker` scope" | **Acceptable to defer.** No SQL in 011–013 closes it, and the security pass notes the residual double-send risk is bounded by the replay path's stable provider idempotency key (`012:2185`), which most providers will dedupe on. Liveness risk, not an authorization one. |
| **T11** — 013 has zero TypeScript consumers | "Product ruling, not a migration fix" | **Acceptable to defer**, and arguably safer now: with S3 fixed, none of the five BYOK RPCs are reachable from any granted role at all. Unreachable surface is not exposure. The standing condition: whoever wires the first real consumer must re-confirm the `service_role` revoke against a real Supabase project first, since S3 is unconfirmable on this harness. |

## 3 · Live reproductions (orchestrator execution)

All three run against a fresh instance of the same isolated shim used in the first review (port 5439,
own data directory), with 001–010 unchanged, 011–013 at `0d9e00c`, and 014 (also amended on this
branch) applied to satisfy the pins' own stated dependency.

**G6, full, at `0d9e00c`:** forward apply 001–014 (all 14 clean), all three pins re-run and genuinely
pass — `test_011` 16/16 (up from 14; T16/T17 are new), `test_012` 14/14, `test_013` 14/14 (up from 13;
T14 is new). This directly answers both reviewers' shared caveat that they "did not execute the pins" —
they do pass as claimed. That is not the same as the underlying defects being closed; see below.

**G6, extended to `eff8084` (§0):** same shim, wiped and rebuilt, forward apply 001–017 (015–017
required this time — see §0 for why). `test_011` 17/17 (T18 is new and genuinely exercises the fix),
`test_012` 15/15 (T15 is new), `test_013` 14/14 unchanged (`eff8084` does not touch 013).

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
