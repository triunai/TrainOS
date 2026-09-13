# TrainOS — which AI integrations actually earn their keep

> Saved 13 Sep 2026. Ranks AI integrations for Alex Selvarajah's business by money moved, deterministic share, time to ship, and regulator exposure. Companions: `2026-09-13-value-chain-and-numbers.md`, `proposal-content-pack-v2.md`. Iterate here; do not fork copies.

## 0 · The baseline every number is anchored to

The content pack's volume assumption (§4.2), restated so discovery can replace it: **80 enquiries, 40 proposals, 25 engagements per month** (enquiry→proposal 50%, proposal→won 62.5%), average claimable engagement **RM 12,000** — RM 11,520 net of the 4% fee — so **25 × 12,000 = RM 300,000 booked per month**. If Alex's real volume is half this, items 5–8 stay out of Phase 1.

---

## 1 · The ranked eight

**1 · Speed-to-claimable-date reply.** An enquiry lands by mail or WhatsApp; it is classified, matched to an organisation, checked against trainer availability, and answered with *a date the client can actually train on* — grant approval + 14 days, inside the 90-day window — before a human has read it. Sales sends. Suggest for the reply, Autonomous for classification and matching, already the Lead Agent's grant. Deterministic: the date arithmetic, the availability join, the consent check. Model: intent extraction and prose. Ships on `GET /v1/enquiries`, `PATCH /enquiries/{id}/extraction`, `/follow-ups/{id}/draft`, `OPPORTUNITY_CONVERT`, M03-S01/S02/S06 — all built. **This beats the levy radar.** Brokers send each employer to three to five providers at once and the employer picks whoever starts soonest. A 10pp lift on enquiry→proposal (50%→60%) is 8 more proposals, 5 more engagements, **RM 60,000/month**; a conservative 5pp is RM 30,000 and ties the radar. It recurs on every enquiry every month; the radar harvests a finite stock.

**2 · The levy radar.** Project each client's year-end levy position, flag balance > RM 50,000 with utilisation < 50% (15% of the excess lost) and balances nearing the 24-month forfeiture clock, and raise a cross-sell with the rationale written out. Sales decides; it stays at Suggest permanently, because a pitch is a client commitment. Deterministic: the projection, both thresholds, the countdown. Model: reading the statement, one sentence of rationale. Ships on `GET /v1/organisations/{id}/suggestions` — the `CROSS_SELL` shape with `HRDC_STATEMENT` provenance is already specified — plus `hrdcLevyAvailable`, M04-S02. At 120 clients averaging RM 60,000 available, RM 7.2m sits in the book and perhaps RM 4.5m at risk; 8% annual conversion is RM 360,000, **RM 30,000/month**. Client side, a RM 120,000 balance avoids 15% × (120,000 − 50,000) = RM 10,500 of loss. That is the sentence that opens the call.

**3 · Claim-integrity guard.** Lead-time, commencement-window, ACM-ceiling, accreditation and document-completeness checks on every engagement, resolved against the rule version in force at grant submission, with a deadline countdown and attendance lock. Ops and Finance act; the system never submits. Launches Autonomous, because it only computes and blocks. Almost wholly deterministic (zero tokens); the only model surface is the registry feeding it. Ships on `GET /v1/compliance/checks`, `/hrdc/packets/{engagementRef}`, the HRDC attendance export, M12-S02, M09-S02, M10-S06. On RM 3.6m/year of claimable work, losing 3% to date rules, missing documents or a lapsed six-month window is RM 108,000/year, **RM 9,000/month protected** — and it is insurance against the regulator rather than exposure to it.

**4 · Proposal drafting and costing to the margin floor.** Draft from template, cost against the rate card, flag ACM ceilings, route by value through APV-01. Sales Manager approves. Money stays deterministic per DECISIONS: total-from-lines, integer sen, margin floor, discount authority. Model: prose only. Ships on `GET /v1/proposals/{id}`, `/costings/{id}`, `PROPOSAL_SEND`, M07-S02/S03, M02-S02; the `lead-to-proposal` agent already runs the chain. Admin saving alone is thin, 40 proposals × 90 minutes ≈ RM 1,750/month, and the win-rate value is counted in item 1. Its real job is making item 1 possible: a same-day reply is worthless if the proposal takes three days.

**5 · Trainer matching and hold.** Rank accredited trainers by competency, HRD-TDF status, availability and rate; hold a slot; warn on accreditation expiring before the training date. Ops confirms. Deterministic: the availability join, the expiry check, the rate band. Ships on `GET /v1/trainers?filter[programmeId][eq]=` and the runtime's `trainers_availability` tool. With ~3,000 accredited trainers for ~8,000 providers this is the chain's structural scarcity. Two engagements a quarter lost to availability is **RM 8,000/month protected**; an expired accreditation found after delivery is a rejected claim.

**6 · Collections escalation.** Draft the stage-appropriate chase, escalate by rule, hand Finance the call at step 3. Act-with-approval, where the Collections Agent fixture sits. Deterministic: aging buckets, escalation ladder, template cost. Ships on `GET /collections/queue`, `/receivables/aging`, `/collections/{invoiceRef}/draft`, `REMINDER_SEND`, M13-S05. On two months of receivables (RM 600,000), cutting DSO 45→30 days releases **RM 150,000 of working capital once** — cash flow, not P&L. Say so rather than dressing it up as profit.

**7 · Rule-change watcher.** Diff the corpus weekly, propose effective-dated rule changes with the source span highlighted and affected engagements listed. Finance approves; never autonomous. The one item where a STRONG tier earns its cost: PDF to structured diff is hard, and anything under 0.80 confidence is withheld for manual transcription. Ships on `GET /knowledge/sources`, `/compliance/rule-changes/{documentId}`, `RULE_CHANGE_APPROVE`, M12-S07/S08, M16-S05. The fixture circular touches four open engagements — **RM 48,000 exposure per missed circular**.

**8 · TNA extraction to programme recommendation.** Turn a discovery form or call notes into mapped competency gaps and a ranked programme with a fit score and citations. Stays at Suggest; `HUMAN_STEP_REQUIRED` is the correct ceiling. Ships on `GET /tnas/{id}`, `/recommendations`, `TNA_RECOMMENDATION_ACCEPT`, M05-S02. Its value is deal shape, not deal count. A 5% lift on engagement value is **RM 15,000/month** — the least defensible estimate here, so build it after items 1–3.

---

## 2 · Three to refuse or defer

**Refuse: anything that touches eTRIS.** No API, a login-gated portal, attendance immutable once approved. Automating submission means credential-holding RPA against a government portal in the year after the Auditor-General and PAC criticised that regulator's governance. An error is unrecoverable, and the objection answer it costs us — "the system never submits; a person does" — is worth more than the minutes saved. Build the packet, score completeness, count down, stop.

**Defer: a client-facing chatbot answering HRD Corp eligibility questions.** Text from a client's HR manager is untrusted input and the answer is a quasi-representation about a government scheme. Getting it wrong in front of the buyer is the objection Appendix E already defends against. Revisit once the registry has twelve months of signed-off rules, and then constrained: cite an active rule or refuse.

**Refuse: an LLM anywhere near money.** Costings, margins, commissions, ACM ceilings, the 15% deduction and the forfeiture clock are arithmetic over a rate card and a rule table. DECISIONS forbids it; the point is that nobody re-proposes it later as "smart pricing". A rule engine does all of it for zero tokens, reproducibly under audit. Same logic retires participant-sentiment scoring across 600 messages a month: PII exposure, a token bill, no decision changed.

---

## 3 · First evals for the top three

**Speed-to-claimable-date reply.** Golden set: 200 historical enquiries labelled with the organisation, the programme family actually proposed, and whether they converted; 60 also carrying real grant approval and training start dates. Measure org-match top-1, programme-family top-3, claimable-date exact match, and the confidently-wrong rate (confidence ≥ 0.75 and wrong). Leave shadow at org match ≥ 0.95, family top-3 ≥ 0.90, claimable date exact on 100% — deterministic, so a miss is a bug — confidently-wrong ≤ 1%, and 50 drafts reviewed with ≤ 10% needing more than a light edit.

**Levy radar.** Golden set: 40 organisations × 8 quarters of statements and claim history with the year-end position that occurred — 320 points. The projection is arithmetic, so the eval is extraction and prioritisation. Leave shadow at extraction exact-match ≥ 0.98 with every figure citing a page and line, projection error ≤ 2% of balance, and ≥ 6 of the first quarter's top 10 flagged organisations producing a real conversation. It never leaves Suggest.

**Claim-integrity guard.** Golden set: every engagement of the last 24 months (~150) with grant approval date, start date, document list and outcome — paid, queried, rejected — replayed against the rule set in force then. Measure recall on the ones queried or rejected, false positives on the clean ones. Leave shadow at recall 1.00 on historical rejections (this check may block, so it must catch all), false positives ≤ 5%, and a `versionDrift` warning wherever the rule set changed mid-flight. "Good enough" is a property of the rule table, not a model: every active rule carries a source span a compliance person signed.

---

## 4 · The first five minutes of Alex's demo

| Minutes | Screen | What it proves |
|---|---|---|
| 0:00–1:30 | M03-S01/S02 enquiry inbox | Classified, matched to an organisation showing prior engagements, unused levy and an overdue invoice; reply drafted with an earliest claimable date. Money coming in. |
| 1:30–3:00 | M04-S02 levy radar | RM 61,000 expiring 31 December, 42 supervisors untrained, one click to an opportunity. Money he has and cannot see. |
| 3:00–4:00 | M02-S02 approval detail, APV-2026-0771 | Evidence, what differs from normal, the exact diff, the jury dissent. Money under control. |
| 4:00–5:00 | M09-S02 window guard, M12-S02 packet 3/5 with countdown | A `FAIL` blocking the claim step. Money not lost. |

Money in, money found, money controlled, money kept. Alex is an HRMS expert who has seen every CRM, so lead with the one thing no HRMS does: compute a claimable date before the proposal exists. The approval screen goes third because the question he asks at minute two is what stops it doing something stupid. Never open with the agent registry or run trace: the engineer's favourite screen, the buyer's least interesting. It earns minute twelve.

---

## 5 · Questions only Alex can answer

1. Last twelve months: how many enquiries, proposals and engagements, and the average claimable value each? Section 0 is a guess; halve it and items 5–8 leave Phase 1.
2. Where do enquiries physically arrive — shared mailbox, individual inboxes, WhatsApp, web form, directory — who touches them first, and in what hours?
3. Of claims submitted in the last 24 months, how many were queried or rejected, why, and what did each cost? The only honest way to size item 3.
4. For how many clients does he hold levy balance, contribution rate and claim history, and in what form? The radar turns entirely on this.
5. Who signs off a proposal above what value today, and who would approve an HRD Corp rule change? The policy engine needs his matrix, not a default.
6. How many accredited trainers does he work with, does he hold their HRD-TDF expiry dates, and how often does availability delay or lose an engagement?
7. What error rate on a drafted client-facing reply is unacceptable, and what evidence would move an action from Suggest to Act-with-approval?
8. Will he give Phase 0 access to twelve to twenty-four months of historical enquiries, proposals and claim outcomes? Without it there is no golden set.
