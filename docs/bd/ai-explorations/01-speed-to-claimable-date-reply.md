# AI integration 1 · Speed-to-claimable-date reply

> Breadth pass, 13 Sep 2026. Sources: `docs/bd/2026-09-13-ai-integration-brainstorm.md` §1 item 1, `docs/bd/proposal-content-pack-v2.md` §2.5, `docs/design/API_CONTRACT.md`, `packages/contract/src/domain/*`, `packages/agent-runtime/src`, `supabase/migrations/005,009,011`, `apps/web/src/features/enquiries`.

## 1. The job and the number

An enquiry lands by email or WhatsApp. It's classified, matched to an organisation, checked against trainer availability, and answered with a date the client can actually train on — grant approval + 14 days, inside the 90-day commencement window — before a human reads it. Sales still sends; classification/matching already run Autonomous under the Lead Agent's grant.

Brainstorm §1 item 1: a 10pp lift on enquiry→proposal (50%→60%) is 8 more proposals/month (80×0.10). At 62.5% win rate that's 5 more engagements (8×0.625), at RM 12,000/engagement **RM 60,000/month**. I recompute it and it holds; a conservative 5pp lift gives 4 proposals → 2.5 engagements → **RM 30,000/month**. Both use gross RM 12,000, not the RM 11,520 net-of-fee figure §0 introduces — an inconsistency worth flagging.

## 2. Data: what exists, what's missing

**Contract types**: `Enquiry`/`EnquiryDetail` (`packages/contract/src/domain/enquiries.ts:65-111`) carry `classification`, `matchedOrganisation`, and `related` chips including overdue invoices. `EnquiryExtraction` (`enquiries.ts:89-95`) holds topic/audience/timing/budget, each independently provenanced. `MessageDraft` (`enquiries.ts:229-248`) carries body, WhatsApp rate, `ChannelConsent`.

**Endpoints**: `GET /v1/enquiries` (API_CONTRACT.md:234), `GET /v1/enquiries/{id}` (252), `PATCH .../extraction` (272), `POST /v1/actions type:OPPORTUNITY_CONVERT` (276), `GET /v1/follow-ups/{id}/draft?channel=` (298) — matches the brainstorm's citation.

**Tables**: migration 005 creates `core.enquiries`, `core.enquiry_extraction_fields` (one row per field — `005_sales_organisations_enquiries_tna.sql:307`), `core.organisations`, `core.follow_ups`, `core.tnas`. Migration 009 codifies HRD-014 (grant_approval + 14 days) and the `CHK_LEAD_TIME` check (API_CONTRACT.md:979-999,1049).

**The load-bearing gap**: no `claimableDate` field exists anywhere — grepped the whole contract, every screen, every migration. Only the rule (HRD-014, the 90-day window) and the post-hoc `CHK_LEAD_TIME` check exist, and that check runs on an **existing engagement with a recorded grant-approval date** (API_CONTRACT.md:1049 — `computed.grantApproval` is a stored fact, not a projection). Stating a claimable date **before a grant application exists** requires projecting off a hypothetical submission date — nothing computes that today.

Second gap: the brainstorm cites `/follow-ups/{id}/draft` as the ship vehicle, but `FollowUp` (`enquiries.ts:157-167`) is modelled as **post-proposal** — its example reason is "PRO-2026-0184 sent 11 Sep, not opened" (API_CONTRACT.md:291-296), and migration 005 defers the `follow_ups.proposal_id` FK to 007 because a follow-up presumes a proposal exists. The first reply to a raw enquiry isn't a follow-up in the domain model.

## 3. Deterministic core vs. model calls

| Step | Type | Tier / source |
|---|---|---|
| Read enquiry body | CODE | `enquiries.get` tool (`tools/definitions.ts:24-26`) |
| Extract topic/audience/timing | MODEL | Reader-pattern, tier `CHEAP` via `ENQUIRY_ARCHIVE` (`routing/config.ts:255-260`) |
| Match organisation | MODEL+CODE | Matcher-pattern, tier `CHEAP` via `OPPORTUNITY_CONVERT` (`routing/config.ts:248-253`) |
| Trainer availability join | CODE | `trainers.availability` tool (`tools/definitions.ts:37-41,153-166`) |
| Grant-date projection + window arithmetic | CODE — **doesn't exist yet** | n/a |
| Draft reply prose | MODEL | tier `MID` via `FOLLOWUP_SEND` (`routing/config.ts:262-267`) |
| Consent check | CODE | `ChannelConsent.granted` (`enquiries.ts:178-182`) |

No sub-agent runs this exact chain yet. `agents/lead-to-proposal.ts` (Reader→Matcher→Drafter→Verifier) is the closest analogue but targets `PROPOSAL_SEND`; item 1 needs a shorter Reader→Matcher→Reply-drafter chain on the same pattern.

## 4. Policy and autonomy

Classification/matching: **Autonomous**, consistent with `OPPORTUNITY_CONVERT`'s `requiredForAutonomous: false` (`routing/config.ts:252`). The reply: **Suggest**. Nearest action-type fit is `FOLLOWUP_SEND` (jury `SAMPLE`, never blocks — `orchestrator/jury.ts:113-115`), but per §2 that's a modelling mismatch; a new `ENQUIRY_REPLY_DRAFT` type is the honest fix. Policy engine gates on confidence and `needsHumanReview`, enforced as a database CHECK constraint (migration 005), not application logic. Promotion criteria per brainstorm §3: org match ≥0.95, family top-3 ≥0.90, claimable-date exact 100%, confidently-wrong ≤1%.

## 5. Screens

- **M03-S01 inbox** — `EnquiryInboxPage.tsx:460-472` renders classification but no date field; add an earliest-claimable-date column.
- **M03-S02 detail** — `EnquiryDetailPage.tsx:182-214` renders Classification and Levy metric cells only; add a claimable-date metric with its own provenance (copy the levy pattern at 198-200).
- **M03-S06 follow-up queue** — built for post-proposal nudges; per §2, either extend `FollowUp` to originate from an enquiry, or give the enquiry detail screen its own reply-draft panel via the existing `suggestedAction` slot (`enquiries.ts:109`).

## 6. Evals

Brainstorm §3: 200 historical enquiries (org, programme family, converted y/n), 60 with real grant/start dates. **Only one enquiry fixture exists** — `ENQUIRY_AURORA` (`packages/agent-runtime/src/fixtures/local-client.ts:59-82`). Three cases the golden set needs beyond it: (1) a `PROGRAMME_CONFLICT` match at fit 0.78 where the top pick should be rejected for a runner-up (`local-client.ts:108-116`); (2) an enquiry where Daniel Wong is the only trainer and `available: false` in-window (`local-client.ts:135-142`), forcing an honest "no date" answer; (3) a WhatsApp enquiry at 0.41 confidence (the number API_CONTRACT.md:250 names explicitly) to exercise `needsHumanReview`. Shadow thresholds: claimable-date exact 100%, confidently-wrong ≤1%, ≤10% of 50 reviewed drafts needing more than a light edit.

## 7. Risks

- **Regulator**: a wrong claimable date sent to a client risks a mistimed HRD Corp submission. Mitigate: always show the HRD-014 citation, hold the 100% eval bar.
- **PII**: enquiry bodies carry names/emails/phones into a CHEAP-tier model. Mitigate: apply the pack's redact-before-model-call rule (§3.4) to this path explicitly.
- **Prompt injection**: inbound email/WhatsApp is untrusted by design; the Reader must stay read-only with no state-writing tool, as `lead-to-proposal.ts` already does.
- **Cost**: negligible — see §8.

## 8. Monthly token cost

CHEAP ≈$0.03/$0.13 per 1M, MID ≈$0.66/$1.98 per 1M off-peak (§4.1); assumed token counts (unmeasured, flag for discovery): Reader 1,500in/400out CHEAP=$0.0001; Matcher 2,000in/400out CHEAP=$0.0001; reply 1,500in/600out MID=$0.0022. Per enquiry ≈$0.0024 → 80/month ≈ **$0.19 (≈RM 0.86)** — a sliver of the pack's RM 110–180 aggregate baseline, consistent with that total being STRONG-tier-dominated elsewhere.

## 9. Smallest viable slice

One week, fixtures only: Reader+Matcher producing the existing `OPPORTUNITY_CONVERT` suggestion (already built), plus a hardcoded +14-day/90-day calculation against `ENQUIRY_AURORA`, rendered as one new metric on `EnquiryDetailPage.tsx`. No new action type or endpoint required.

## 10. For the Opus pass

1. **The claimable-date projection has no owner.** Design the function: submit-today, submit-in-N-days-for-packet-prep, or client-configurable? Nothing answers this.
2. **`/follow-ups/{id}/draft` is the wrong endpoint** (§2, §5) — extend `FollowUp` or add `ENQUIRY_REPLY_DRAFT` as a real action type.
3. Only one enquiry fixture exists; build synthetic cases off the three fixtured programmes/two trainers before assuming real historical data arrives.
4. Is `OPPORTUNITY_CONVERT`'s `requiredForAutonomous: false` + `SAMPLE_JURY` (never blocking) the right posture when a wrong match feeds directly into a date shown to a client with confidence?
5. Go harder on: the date-projection logic itself, the `FollowUp` vs. enquiry-reply modelling conflict, and whether WhatsApp inbound actually reaches this chain or needs its own path — the contract's only worked example is `EMAIL`.
