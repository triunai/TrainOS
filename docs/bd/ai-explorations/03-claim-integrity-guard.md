# AI integration 3 · Claim-integrity guard

> Breadth pass, 13 Sep 2026. Sources: brainstorm item 3; proposal pack §1.5, §2.3, §4.1, Appendix B; `API_CONTRACT.md` §9, §13, §17–18; `packages/contract/src/domain/hrdc-finance.ts`, `engagements.ts`; `packages/agent-runtime/src`; migrations 007–009; `apps/web/src/features/hrdc`, `engagements`. Pre-hard — see §10 for what an Opus pass must confirm.

## 1 · Job and number

Recompute five checks — lead time, commencement window, ACM meal ceiling, accreditation, document completeness — against the rule set in force when the grant was submitted, render `PASS/WARN/FAIL` with a deadline countdown, and set `HRDC_CLAIM` to `BLOCKED` on any `FAIL`. It never submits, drafts, or negotiates.

Brainstorm's number: RM 3.6m/year claimable, 3% lost to date rules/documents/window → RM 108,000/year = **RM 9,000/month protected**. Recomputed: RM 3.6m/12 = RM 300,000/month, matching §0's baseline (25 × RM 12,000); 3% of that is RM 9,000. Arithmetic holds, but it's a percentage-of-baseline assumption, not an observed rejection rate (brainstorm's §5 Q3 asks for the real figure and doesn't have it).

**Zero tokens?** Mostly. The five checks are pure date/number comparisons; migration 009's `compliance_check_results` table CHECKs (`ccr_deterministic_has_no_model`) that a `DETERMINISTIC` row cannot carry model usage. The only token spend nearby is one layer back — turning circular PDFs into rule-registry entries (item 7's job). **Verdict: zero tokens by schema-enforced construction; it consumes item 7's spend, not its own.**

## 2 · Data

**Contract types:** `ComplianceRule`, `ComplianceCheck`, `ComplianceChecksResponse` (with `ruleResolution`, `versionDrift[]`), `ClaimPacket`, `RequiredDocument` — all in `hrdc-finance.ts`.

**Endpoints:** `GET /v1/compliance/checks?engagementRef=` (M12-S02, M09-S02); `GET /v1/hrdc/packets/{engagementRef}`; `POST /v1/actions type: HRDC_PACKET_MARK_SUBMITTED` (`422` while `completeness < 1`, no submit-to-eTRIS endpoint exists anywhere); `GET /v1/hrdc/deadlines?filter[status][eq]=AT_RISK`.

**Migrations:** 009 — `core.compliance_rules` (bitemporal, EXCLUDE constraint across `validity`+`known`, `cr_active_needs_verification` forces a human verifier before `ACTIVE`), `core.compliance_check_results`, `core.compliance_version_drifts`, `core.hrdc_packets`. Migration 007 — `core.rate_card_meals`, `rcme_within_acm_ceiling` CHECK (pricing-time ceiling, separate from claim-time `CHK_MEAL_CEILING`). Migration 008 — `core.attendance_days`, trigger `enforce_attendance_day_lock()`.

**Missing:** only three of five Appendix B rules have a confirmed fixture check key (`HRD-014` lead time, `HRD-011` docs, `HRD-020` meal ceiling); no seed row found for the 90-day commencement window or 6-month claim window. No registered runtime agent exists — the fixture packet attributes `PACKET_ASSEMBLED` to "Compliance Agent" as a label, not a registered id.

## 3 · Deterministic vs model

All five Appendix B checks are CODE where they exist. Confirmed in 009: lead time (`HRD-014`, demonstrated), meal ceiling (`HRD-020`, claim-time and pricing-time both). Attendance immutability is a write-layer trigger, not a check row. Not confirmed as seeded: commencement window, claim window. Accreditation appears in the packet only as a document (`TRAINER_TTT_CERT`), not a `compliance_check_results` row — possibly item 5's territory by design (see §10 Q2). No model call happens inside the check endpoint; the only MODEL step nearby is the circular-to-rule-diff extraction feeding the registry (item 7), gated at confidence ≥ 0.80 with a named human verifier before `ACTIVE`.

## 4 · Policy and autonomy

Launch level: Autonomous — it computes and blocks, no external side effect to reverse. No action envelope type covers the checks themselves (`GET`, not `POST /v1/actions`); the nearby action types are `HRDC_PACKET_MARK_SUBMITTED` (human-only, validated) and `ATTENDANCE_APPROVE`/`ATTENDANCE_UNLOCK`. The policy engine's five-step evaluation (type, value, context flags, confidence, approver role) never runs for this feature — there's no `requestedBy: AGENT` action to gate. Jury (§18) doesn't apply to deterministic checks (no trigger conditions fire); it applies upstream, to rule-change extraction. Nothing here is promoted between autonomy levels — the only promotion in this area is a rule moving `PROPOSED → ACTIVE`, which is Finance's sign-off, not an autonomy change.

## 5 · Screens

- `apps/web/src/features/hrdc/ClaimPacketScreen.tsx` (M12-S02) — uses `RecordHeader`/`StatusChip` already. Change: surface per-check state, `ruleId`, and `versionDrift` warnings inline, not just completeness.
- `apps/web/src/features/engagements/EngagementDetailPage.tsx` (M09-S02) — renders `LifecycleStepper`, finds the `BLOCKED` step already. Change: attach the failing check's `display` sentence to that step's tooltip.
- `apps/web/src/features/engagements/AttendanceCapturePage.tsx` (M10-S06) — locked-state UI exists. Change: show `unlock_count` when non-zero as a review signal.

## 6 · Evals

Golden set: ~150 engagements from the last 24 months, replayed against the rule set in force then. Three concrete cases: (1) `ENG-0231` — one packet exercising all three states (PASS/WARN/FAIL) in the fixture; (2) `ENG-0198`, named in fixtures as the already-blocked engagement — the natural negative case; (3) the §18 version-drift sample (`HRD-015` 3-day rule vs its `HRD-022` 14-day replacement) — the case that tests whether a historical assessment gets silently re-decided, which is the specific failure the bitemporal design exists to prevent. Shadow-exit thresholds, per brainstorm: recall = 1.00 on historical rejections/queries, false positives ≤ 0.05, and a `versionDrift` warning on every engagement where the rule set changed between grant and claim stages.

## 7 · Risks

- **Regulator:** no submit endpoint exists in contract or schema — structurally cannot submit to eTRIS. No further mitigation needed.
- **PII:** packet documents reference attachments, not embedded content; unverified whether any interpreted-check path would need contents. Mitigation: keep all five checks presence/date-based.
- **Prompt injection:** N/A to the guard's own checks (no free text parsed); relevant only to item 7's diffing. Tracked there.
- **Cost:** near zero by design; real risk is registry staleness letting a check pass against a stale rule. Mitigation: eval recall bar (§6) plus closing §2's seed-row gap first.

## 8 · Monthly token cost

At 25 engagements/month with ~3 check evaluations each (grant, claim, one re-check) = 75 check-runs/month, all `DETERMINISTIC`, schema-forbidden from carrying model spend. **USD 0 / RM 0 at baseline** — proven by the `ccr_deterministic_has_no_model` constraint, not assumed. Registry-maintenance cost (item 7) is shared infrastructure, not counted against this item.

## 9 · Smallest viable slice — one week, fixtures only

1. Seed the two unconfirmed Appendix B rules (commencement window, claim window) alongside the three fixture-referenced ones.
2. Run `core.resolve_rules()` and the checks endpoint against `ENG-0231` and `ENG-0198`; confirm known states reproduce exactly.
3. Force a version-drift case (second `rule_set_versions` row over `HRD-015`) and confirm both version ids land in `compliance_version_drifts` with a two-sided message.
4. Wire the `EngagementDetailPage` blocked-step tooltip to the failing check's `display` string — read-only, no new endpoint.
5. Leave attendance lock, `HRDC_PACKET_MARK_SUBMITTED`, and rule-change review UI untouched — already correct or item 7's job.

## 10 · For the Opus pass

**Open questions:**
1. Are the 90-day and 6-month rules actually seeded under check keys this pass missed, or genuinely absent?
2. Is accreditation deliberately a *document* check (via `TRAINER_TTT_CERT`) rather than a `compliance_check_results` row, making it item 5's territory by design — or a real gap?
3. Do the pricing-time (`rate_card_meals`) and claim-time (`CHK_MEAL_CEILING`) ACM ceilings share one source of truth, or can a rate card be priced against a ceiling that a later rule change invalidates without `versionDrift` catching it?

**Wrong assumptions to check:** the 3%-loss figure is unvalidated against Alex's real claim history — present as a placeholder, not a measurement. "Zero tokens" holds only while `CHK_DOCS_COMPLETE` stays presence-based; if document quality forces content-reading (verifying signature counts on scans), it becomes `INTERPRETED` and §8's cost model changes.

**Three places to go harder:** (1) audit migration 016's actual seed data row-by-row against all ten Appendix B rules instead of relying on fixture-file mentions; (2) read `RulesRegistryScreen.tsx`/`RuleChangeReviewScreen.tsx` in full to confirm human-verification has real UI, not just a database CHECK with nothing satisfying it; (3) trace the new, uncommitted `011_action_envelope_and_policy_gate.sql` against `AttendanceUnlockPayload`'s TODO (contract §16 Q5) — is "unlock voids the packet" implemented or still unresolved.
