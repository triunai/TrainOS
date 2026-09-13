# AI integration 6 · Collections escalation

> Breadth pass, 13 Sep 2026. Sources: brainstorm item 6; proposal pack §1.5/2.3/4.1; API contract §9/§13; `hrdc-finance.ts`, `enums.ts`, `enquiries.ts`; migration 010; `CollectionsQueueScreen.tsx`, `InvoiceDetailScreen.tsx`. Pre-hard — §10 flags what Opus must confirm.

## 1 · Job and number

Draft the stage-appropriate chase for each overdue invoice, escalate up a fixed ladder as days-overdue crosses thresholds, and hand Finance the human call once the ladder reaches that rung. Act-with-approval throughout — the agent drafts, a human sends.

Brainstorm's number: on two months of receivables (RM 600,000), cutting DSO 45→30 days releases **RM 150,000 of working capital once** — correctly framed as cash flow, not P&L. But the arithmetic doesn't reproduce cleanly: RM 600,000 × (1 − 30/45) = RM 200,000, not RM 150,000, if DSO scales linearly with balance. RM 150,000 is exactly one month's baseline revenue (§0), suggesting the figure may be "one month less outstanding" rather than a derived function of the 45→30 change. Flagging the mismatch rather than silently fixing it.

## 2 · Data it needs

**Contract types** (`hrdc-finance.ts`): `Receivable`, `CollectionsQueueResponse`, `CollectionRule`, `CollectionNextAction` (+ status `DRAFT_READY | AWAITING_MD | HUMAN_REQUIRED | BLOCKED_ON_SYNC`), `ReceivablesAging`, `ReminderSendPayload`, `AccountTradingHoldPayload`. `MessageDraft` (`enquiries.ts`) carries drafted text plus `ChannelConsent`, `rateSource` (with an explicit `UNAVAILABLE` state), and an `AlternativeCategoryRate` for the marketing-vs-utility comparison.

**Endpoints:** `GET /v1/collections/queue`, `/receivables/aging`, `/collections/{invoiceRef}/draft`, `/collections/rules`; `POST /v1/actions type: REMINDER_SEND` (FIN-03); `type: ACCOUNT_TRADING_HOLD` (`approverRole: MD`).

**Tables/CHECKs in 010:** `core.aging_buckets` (GiST-exclusion, no double-counting), `core.receivables_aging()` (tenant-scoped RPC), `core.collection_rules` — the 7/30/45/60/75 ladder **as data**, with two hard CHECKs: late stages (`REMINDER_3`, `HUMAN_CALL`, `TRADING_HOLD`) can never be `AUTONOMOUS`, and `TRADING_HOLD` requires `requires_role = 'MD'`. `core.collection_stage_for()` resolves a stage from days-overdue — verified in comments against the fixture (34 days → `REMINDER_2`, 80 → `TRADING_HOLD`). `core.collections_cases` — one open case per overdue invoice; a trading-hold row is impossible without a stamped approval id.

**Missing:** ladder seed data is deferred to "migration 016," absent from 001–011 — the design is real but this tenant's values aren't seeded. No collections agent identity exists in `packages/agent-runtime` — same gap as item 3.

## 3 · Deterministic core vs model calls

CODE: aging-bucket assignment, `collection_stage_for()`, the ladder's autonomy/role CHECKs, WhatsApp cost arithmetic, consent-gate lookup. MODEL: the chase message's prose only — `MessageDraft` carries no confidence/reasoning field the way a `POST /v1/actions` payload does, suggesting this draft path skips the jury/routing machinery `PROPOSAL_SEND` uses (§10 Q1).

**Ladder, five rungs, with the human call's actual position:** `REMINDER_1` (day 7, drafted) → `REMINDER_2` (day 30, drafted — `INV-2026-0288` sits here at 34 days) → `REMINDER_3` (day 45, drafted but CHECK-forced off `AUTONOMOUS`; the screen's own comment says the agent "STOPS and offers no draft" here, stricter than the CHECK requires — likely a demo-fixture choice, see §10) → `HUMAN_CALL` (day 60, `channel: PHONE`, carries no template at all — the true "hand Finance the call" rung) → `TRADING_HOLD` (day 75, MD approval). **The brainstorm's "step 3" doesn't match the schema's step 3** (`REMINDER_3`, still drafted) — the real human-call rung is step 4 of five. Flagged, not silently corrected.

## 4 · Policy and autonomy

Launch level: Act-with-approval, matching `REMINDER_SEND`'s policy FIN-03 — every reminder routes to a human before sending (screen copy: "Approving here queues the send for approval; it does not send it"). Action types: `REMINDER_SEND` (drafted rungs) and `ACCOUNT_TRADING_HOLD` (`QUEUED_FOR_APPROVAL`, `approverRole: MD`, never `EXECUTED`). Policy engine: the full five-step evaluation applies — autonomy per rung, invoice value, `overdueBalanceOnAccount` flag, confidence, approver role — with the two CHECKs making late rungs structurally incapable of `AUTONOMOUS`. Jury: not observed wired to `REMINDER_SEND` — drafts carry no confidence field, likely outside jury scope. Promotion: unspecified for collections; the brainstorm treats Act-with-approval as the ceiling, unlike item 1's Suggest→Autonomous path.

## 5 · Screens

`apps/web/src/features/finance/CollectionsQueueScreen.tsx` (M13-S05) is already substantially built: `EscalationLadder` marks the selected invoice's rung `current`/`done`/`pending`; `WhatsAppCostStrip` shows category, rate, and the marketing-vs-utility comparison; consent renders inline; a `DraftPanel` explains *why* there's no draft rather than showing a bare empty state. One change: its copy claims `REMINDER_3` (day 45) is where "the agent STOPS," a rung ahead of the schema's actual no-template stage (`HUMAN_CALL`, day 60) — reconcile the copy with the ladder data, or confirm the fixture intentionally sets `REMINDER_3` to `OBSERVE`. `InvoiceDetailScreen.tsx` needs no change for this item.

## 6 · Evals

Golden set: historical invoices with days-overdue-at-each-stage, chase channel/category used, and whether payment followed within N days. Three cases: (1) `INV-2026-0288` — 34 days overdue, resolves `REMINDER_2`, the queue's default `DRAFT_READY` example; (2) a `REMINDER_3`/day-45 case testing the drafted-vs-stopped behaviour flagged in §5; (3) a consent-negative case using `CONTACT_RAVI` confirming the panel shows "NOT on record" rather than silently sending. Shadow-exit thresholds aren't stated in numbers anywhere in the brainstorm (only items 1–3 get bars) — a real gap. Proposed: recall on "should have escalated" ≥ 0.98, 0% tolerance for a reminder sent on a no-consent contact, enforced as a block not an eval target.

## 7 · Risks

- **Regulator:** N/A — collections doesn't touch eTRIS.
- **PII:** names, phone numbers, overdue amounts in every draft. Mitigation: nothing sends without a human, per FIN-03.
- **Prompt injection:** low surface — structured inputs (invoice, days overdue, template), not free client text. Mitigation: keep the prompt template-bound.
- **Cost:** bounded, see §8. Mitigation: per-action-type budget caps, already a platform mechanism.
- **WhatsApp category/consent:** reminders should stay UTILITY category (≈RM 0.056/msg), never MARKETING (≈RM 0.35/msg, 6× cost) — confirm `category` is hardcoded, not inferred. `ChannelConsent.granted` must gate the actual *send*, not just the display — unconfirmed in this pass.

## 8 · Monthly token cost

Brainstorm's own baseline: 120 collection touches/month (§4.2). Drafting is a FAST-tier prose task, comparable to a follow-up draft. At FAST tier (0.22/0.66 USD per 1M tokens off-peak), 500 tokens in + 300 out per draft: 120 × (500×0.22 + 300×0.66)/1,000,000 ≈ **USD 0.033/month** — negligible against the platform's stated USD 25–40/month baseline (§4.2).

## 9 · Smallest viable slice — one week, fixtures only

1. Seed `core.collection_rules` with the 7/30/45/60/75 ladder; confirm `collection_stage_for()` reproduces 34→`REMINDER_2`, 80→`TRADING_HOLD`.
2. Run `GET /v1/collections/queue` and `/draft` against `INV-2026-0288`; confirm `DRAFT_READY`/consent/cost-strip fields populate.
3. Add a `CONTACT_RAVI`-equivalent no-consent invoice; confirm the panel shows "NOT on record" and, ideally, the send is blocked server-side.
4. Reconcile the `REMINDER_3` vs `HUMAN_CALL` "agent stops" copy against seeded autonomy (§5) — a copy fix unless the seed data is wrong.
5. Leave `ACCOUNT_TRADING_HOLD` untouched — it depends on the new, uncommitted `011_action_envelope_and_policy_gate.sql`, needing its own verification first.

## 10 · For the Opus pass

**Open questions:** (1) Does `REMINDER_SEND` route through jury/confidence at all, or is it deliberately simpler than `PROPOSAL_SEND` — `MessageDraft` carries no confidence field. (2) Is `REMINDER_3`'s no-draft behavior a demo-fixture choice or hard tenant policy — the CHECK only forbids `AUTONOMOUS`, not `SUGGEST`, at that rung. (3) Does the DSO arithmetic in §1 need a real formula from Finance — the two plausible readings differ by 33%.

**Wrong assumptions to check:** the brainstorm's "step 3" phrase for the human call sits one rung earlier than the schema's `HUMAN_CALL` (day 60, the fourth of five) — confirm with Alex whether he actually wants a human at the *third* touch, which would mean re-numbering the ladder, not just correcting prose.

**Three places to go harder:** (1) write the missing seed migration for `collection_rules`/`aging_buckets` so the ladder is testable against real data, not just the two dates cited in comments; (2) trace whether `REMINDER_SEND` checks `ChannelConsent.granted` server-side, or only the UI displays it; (3) get Alex's real DSO and receivables numbers to replace the RM 600,000/RM 150,000 estimate.
