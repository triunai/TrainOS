# AI integration 4 · Proposal drafting and costing to the margin floor

> Breadth pass, 13 Sep 2026. Sources: `docs/bd/2026-09-13-ai-integration-brainstorm.md` §1 item 4, `docs/bd/proposal-content-pack-v2.md` §2.3/§4/§5/Appendix B, `docs/design/API_CONTRACT.md`, `packages/contract/src/domain/proposals.ts`, `packages/agent-runtime/src`, `supabase/migrations/007,011`, `apps/web/src/features/proposals`.

## 1. The job and the number

Draft the proposal from template, cost against the rate card, flag ACM ceilings, route by value through APV-01. Money stays deterministic (total-from-lines, integer sen, margin floor, discount authority per DECISIONS); the model writes prose only. Brainstorm §1 item 4: admin saving alone is thin, 40 proposals × 90 minutes ≈ RM 1,750/month. Back-solving: 40×1.5h=60h; RM 1,750÷60h ≈ **RM 29.2/hour**, a plausible loaded rate but stated nowhere — confirm with Alex alongside brainstorm question 1. Item 4's real job is enabling item 1 (a fast reply is worthless if the proposal takes three days), so its win-rate value is already counted inside item 1's RM 60,000/month, not double-counted here.

## 2. Data: what exists, what's missing

**Contract types**: `Proposal` (`packages/contract/src/domain/proposals.ts:259-269`) with per-section `provenance`/`needsReview`; `Quotation` (`proposals.ts:328-362`) with **two generated floors** — `absoluteFloorPrice`, `marginFloorPrice`, `bindingFloorBasis` (ruling R6, 346-356); `FloorPriceBreachDetails` (375-393); full `RateCard` including `MealsPerPaxRate{rate, acmCeiling}` (441-445) — the card itself is `v0-placeholder` until Finance supplies numbers (466-471).

**Endpoints**: `POST /v1/proposals` (API_CONTRACT.md:419), `GET /v1/proposals/{id}` (423), section write/regenerate (462), `GET /v1/costings/{id}` (446) — the brainstorm calls this "costings," but ruling R2 (`proposals.ts:317-322`) settles the resource name as **Quotation** (ref prefix `QUO-`); the brainstorm's own citation is stale here. `POST /v1/actions type:PROPOSAL_SEND` is how APV-01 intercepts sending (461-462) — deliberately not a proposal-resource endpoint.

**Tables/RPCs**: migration 007 creates `core.rate_cards` plus nine child tables, `core.proposals`, `core.proposal_sections`, `core.quotations`, `core.quotation_lines` (`007_money_proposals_quotations_portal.sql:219-361,391,440,610,726`). Floor math is DB-enforced, not app-trusted: `quotation_lines.total_sen` is GENERATED, a DEFERRABLE trigger refuses a disagreeing header, margin floor uses `ceil` never `round`. Migration 011 adds `core.action_policies/action_requests/approval_requests/jury_configs/jury_verdicts` (`011_action_envelope_and_policy_gate.sql:384,419,539,733,757`) — the spine `PROPOSAL_SEND` runs through — but it's **uncommitted and uncatalogued** (git status shows it untracked; the catalog still says "10 migrations, 0 applied," no "Detail — 011"). Treat it as in-flight.

**What's missing**: ACM-ceiling flagging is specified in the rate-card type and a `CHK_MEAL_CEILING` check exists (API_CONTRACT.md:1050-1052) — but that check is engagement-scoped, post-proposal, not surfaced at costing time. Neither `GET /v1/costings/{id}` nor `CostingWorksheetPage.tsx` flags an ACM ceiling during drafting, despite the brainstorm naming this as a core deterministic step here.

## 3. Deterministic core vs. model calls

Traced off the working demo chain, `packages/agent-runtime/src/agents/lead-to-proposal.ts`:

| Step | Type | Tier / source |
|---|---|---|
| Price the engagement | CODE | `quotations.compute` tool; Drafter never states a total itself (`lead-to-proposal.ts:129-131`) |
| Draft prose sections | MODEL | Drafter, tier `STRONG_1` via `PROPOSAL_DRAFT` (`routing/config.ts:220-225`) |
| Flag ACM ceilings | CODE — **not wired into this chain** | would read `RateCard.mealsPerPax.acmCeiling`; no tool does this today |
| Verify floor/margin/trainer/consent | MODEL+CODE | Verifier, tier via `PROPOSAL_SEND` = `STRONG_1` (227-232); recomputes rather than trusting the Drafter (186-188) |
| Submit for approval | CODE | `submit()` reads value from the tool result only, never model text (212-274) |

Discrepancy: `PROPOSAL_DRAFT` is a governed action type in `routing/config.ts:220` with a `GATE`-mode jury, but is **absent** from the contract's action-type enum (API_CONTRACT.md:254). Either the enum is stale or the runtime invented a type the API layer doesn't recognise.

## 4. Policy and autonomy

Launch level: **Act with approval**. Action type `PROPOSAL_SEND`, policy `APV-01`: value > RM 15,000 or first proposal to the org queues (API_CONTRACT.md:513-515; the fixture trips at RM 18,500, `firstOfKind: true`). Jury: `PROPOSAL_DRAFT` uses `GATE_JURY` (promotion-time only, never blocks — `orchestrator/jury.ts:110-111`); `PROPOSAL_SEND` uses `ESCALATE_JURY` on confidence <0.70, value >RM 50,000, or first-of-kind (`routing/config.ts:78-84`) — Aurora trips on first-of-kind alone. A below-floor discount routes through `DISCOUNT_APPROVE`, also `ESCALATE_JURY`. Jurors see only the proposition and evidence, nothing else about the run; an unreadable verdict defaults to disagreement, never consent (`orchestrator/jury.ts:178-193`). Brainstorm gives no item-4-specific promotion numbers; it inherits §2.2's general rule.

**Vendor-independence gap**: the pack's STRONG tier is three vendors — Sonnet 5, Gemini 3.1 Pro, GPT-5.6 Terra (§4.1) — so 2-of-3 means three real opinions. But `routing/config.ts:155-187` binds `STRONG_1=claude-sonnet-5`, `STRONG_2=claude-opus-5`, `STRONG_3=openai/gpt-5.2`: two of three jurors are Anthropic. The `STRONG_3` comment says "so the third juror is a genuinely different vendor" (178-179) while `STRONG_2` silently isn't — a 2-of-3 "agree" on an escalated, first-of-kind send could be two Anthropic models, weaker than the pack promises.

## 5. Screens

- **M07-S02 builder** — `ProposalBuilderPage.tsx:271-286` renders a Margin metric whose `sub` is the **hardcoded string `"floor 35%"`**, not `quotation.floorMarginRate` (contrast `CostingWorksheetPage.tsx:299`, which reads it correctly). If Finance changes the floor, this screen silently lies. One-line fix.
- **M07-S03 costing worksheet** — `CostingWorksheetPage.tsx:157-306` renders both floors and a live breach banner correctly, but has zero ACM/meal-ceiling indicator despite `mealsPerPax.acmCeiling` existing on the rate card — needs a warning chip.
- **M02-S02 approval detail** — already renders jury dissent (API_CONTRACT.md:1106-1110); no change needed, but it's where the §4 vendor gap would surface as a false sense of independence.

## 6. Evals

Brainstorm §3 gives no proposal-drafting-specific numbers — a gap itself. Fixture cases: (1) Aurora, margin 0.41/floor 0.35, value RM 18,500, first-of-kind — routes to APV-01 (`local-client.ts:52-53`); (2) pricing `PROGRAMME_DATA_LITERACY` (list RM 14,800) at a floor-breaching discount, exercising `FLOOR_PRICE_BREACH`/`DISCOUNT_APPROVE`; (3) `firstProposalToOrg: false` (`local-client.ts:172-178`) confirming the jury doesn't fire on first-of-kind alone below threshold. No shadow threshold given — borrow item 1's "≤10% of reviewed drafts need more than a light edit," since the Drafter stage is architecturally identical.

## 7. Risks

- **Regulator**: an HRDC-claim section drafted below threshold ships unflagged. Mitigated already — `needsReview: true` plus warning (`proposals.ts:241-243`, exercised at 0.41 in the sample).
- **PII**: sections reference named contacts on a STRONG tier via OpenRouter/direct API. Mitigate: extend the pack's redact-before-model-call rule (§3.4) to proposal drafting explicitly.
- **Prompt injection**: lower surface than item 1, but TNA gaps originate from client questionnaire text — a secondary vector.
- **Cost**: STRONG-tier is the pack's priciest line — see §8.

## 8. Monthly token cost

Sonnet 5 pricing ($2 in/$10 out per 1M, §4.1), assumed unmeasured call sizes: Drafter 4,000in/1,500out=$0.023; Verifier 2,000in/500out=$0.009. Per proposal (no jury)≈$0.032 → 40/month≈**$1.28**. Jury (~30% of proposals, 12/month, 3 STRONG calls ~800in/100out≈$0.009/jury): +$0.11. **Total ≈$1.4/month (≈RM 6.3)** — modest against the RM 110–180 baseline, but the priciest per-unit step examined this pass.

## 9. Smallest viable slice

One week, fixtures only: Drafter+Verifier already run end-to-end against Aurora. Slice: (a) fix the hardcoded `"floor 35%"` at `ProposalBuilderPage.tsx:277`, (b) add an ACM-ceiling warning to `CostingWorksheetPage.tsx` reading the placeholder rate card, (c) confirm APV-01 renders end-to-end. No new endpoints or migrations.

## 10. For the Opus pass

1. **`PROPOSAL_DRAFT` is in the routing table but not the API contract's action-type enum** (§3) — resolve which is stale.
2. **STRONG-tier vendor bindings don't match the pack's three-vendor design** (§4) — `STRONG_1`/`STRONG_2` are both Anthropic, undermining jury independence for the escalated sends it exists to catch.
3. Migration 011 — the policy gate this integration depends on — is uncommitted and uncatalogued; confirm its state before treating §2's citations as final.
4. No ACM-ceiling flagging exists anywhere in code despite being named explicitly in brainstorm §1 item 4 — build the rule-evaluation step; don't assume `CHK_MEAL_CEILING` covers it.
5. Go harder on: the vendor-independence gap, whether "Quotation" vs. "costing" naming has fully propagated out of the brainstorm/pack prose, and what golden-set shape and shadow thresholds this item should actually have.
