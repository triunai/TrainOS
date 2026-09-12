# TrainOS — decisions with proposed defaults

Seven items the wireframes assume but do not own. Each has a defensible default so discovery **confirms** rather than invents. Expect two or three to change; the rest move from our risk register to the client's sign-off.

Status: proposed · owner named per item · target: signed off before module build starts.

---

## 1 · Autonomy matrix — launch defaults
**Owner: Managing Director**

| Action type | Launch level | Promotion condition | Ceiling |
|---|---|---|---|
| Enquiry: classify / extract / match org | Autonomous | — (read-only, reversible) | Autonomous |
| Task creation, timeline logging | Autonomous | — | Autonomous |
| Follow-up draft (email / WhatsApp) | Suggest | 4 weeks at ≥ 90% sent-without-edit → Autonomous, Utility category only | Autonomous (Utility) · Suggest (Marketing) |
| TNA analysis, programme recommendation | Suggest | never auto-acts; output feeds a human step | Suggest |
| Proposal draft | Autonomous | — (drafting is harmless) | Autonomous |
| Proposal send | Act w/ approval | ≥ 95% approved-as-drafted over 30 sends AND value < RM 15k AND repeat client → Autonomous for that band | Act w/ approval above threshold, always |
| Discount below floor | Act w/ approval | never | Act w/ approval |
| Trainer soft-hold (72h) | Autonomous | — | Autonomous |
| Trainer booking / rate confirmation | Act w/ approval | never at launch; revisit after Phase 2 | Act w/ approval |
| Participant comms (joining instructions, reminders) | Suggest | 2 weeks clean → Autonomous | Autonomous |
| Attendance lock | Act w/ approval | never (HRD Corp rule) | Act w/ approval |
| HRDC packet assemble | Autonomous | — | Autonomous |
| HRDC mark-submitted | Act w/ approval | never | Act w/ approval |
| Invoice create / push | Act w/ approval | never at launch | Act w/ approval |
| Collections reminder 1–2 | Suggest → Act w/ approval | 30 days clean → Autonomous for reminder 1 only | Reminder 3 always human |
| Rule change from a new circular | Act w/ approval | never | Act w/ approval |

**Rule of thumb for the MD:** anything that moves money, makes a commitment to a client, or touches HRDC state never starts above Act-with-approval. Everything else starts wherever it is reversible.

Screens affected: M18-S01 registry, M18-S03 ladder config, every policy gate in §3 of the API contract.

---

## 2 · Jury economics — gate, not step
**Owner: System Admin + MD (cost)**

The jury is a **gate**, not a per-action step. Three uses, in cost order:

1. **Promotion time** — 3 STRONG models against the golden set (50–100 items) when an action type is proposed for promotion. One-off, roughly USD 2–5 per promotion.
2. **Sampling** — 5% of live gated actions get a second and third opinion **asynchronously, after the human has decided**, for drift monitoring. Never blocks.
3. **Escalation trigger** — a live blocking jury only when confidence < 0.70, **or** value > RM 50,000, **or** first-of-kind (new client, new programme, new trainer). A handful a month.

**The maths.** A Sonnet 5 proposal draft costs about USD 0.18; a jury makes it about USD 0.54. At 40 proposals a month that is USD 21 instead of USD 7 — affordable, but it buys nothing once the action type is stable. Gate plus sample plus escalate gives roughly 95% of the safety at about 10% of the cost.

Contract change: `jury` on `/ai/routing` becomes `{ mode: "GATE" | "SAMPLE" | "ESCALATE", quorum, of, sampleRate?, triggers?: { minConfidence, maxValue, firstOfKind } }` rather than a boolean.

---

## 3 · HRD Corp rule set — corrected
**Owner: Finance / Compliance**

The five-working-day claim window in the demo is **wrong**. It came from a practitioner note about Friday-evening submissions, not from a circular. Every rule below loads as **Proposed** until compliance verifies it against the circular PDF on hrdcorp.gov.my.

| Rule | Condition | Effective | Source |
|---|---|---|---|
| In-house lead time | `training_start ≥ grant_approval + 14 calendar days` | 15 Jun 2026 → | Circular 2/2026 |
| Public lead time | `training_start ≥ grant_approval + 3 calendar days` | 15 Jun 2026 → 31 Dec 2026 | Circular 2/2026 |
| Public lead time (revised) | `training_start ≥ grant_approval + 14 calendar days` | 1 Jan 2027 → | Circular 2/2026 |
| Commencement window | `training_start ≤ grant_approval + 90 calendar days` | 15 Jun 2026 → | Circular 2/2026 |
| Claim window | `claim_submitted ≤ training_completion + 6 months` | current | HRD Corp |
| No amendment | grant terms immutable after approval | 15 Jun 2026 → | Circular 2/2026 |
| Trainer accreditation | `trainer.hrd_tdf = true` at grant application | current | HRD Corp |
| ACM ceilings | line costs ≤ ACM 2026 category ceiling | Jan 2026 → | Allowable Cost Matrix |
| Attendance immutability | locked after approval | current | eTRIS |

**Calendar days, not working days**, until circular text says otherwise. The "apply before Friday 5 PM" advice becomes a **warning** — "approval unlikely before Monday" — never a rule.

---

## 4 · Admin-hours-saved formula
**Owner: MD + process owners**

```
hours_saved(month) = Σ over agent actions reaching EXECUTED or APPROVED
                     max(0, baseline_minutes[action_type] − human_minutes_spent[action]) / 60
```

- **baseline_minutes** is *measured in discovery, not assumed*: time-and-motion sampling of 5–10 instances per action type (classify an enquiry, draft a proposal, assemble a claim packet, chase an invoice). Stored per tenant, versioned.
- **human_minutes_spent** is measured by the UI — time in review or edit state on that item. Heavy edits reduce credit automatically.
- Rejected or abandoned actions count zero.
- **First quarter: apply a 0.7 haircut** and label the tile "measured baseline × 0.7 (conservative)". Remove it after three months of measured data.
- The demo's 41 hours is **illustrative** and is now labelled as such on M01-S01.

**Discovery deliverable:** a table of roughly 15 action types × baseline minutes, signed by the process owners. That table *is* the ROI claim.

---

## 5 · Rate card — schema now, numbers from Finance
**Owner: Finance Executive**

```
rate_card(version, effective_from, effective_to, currency = MYR)
  trainer_day_rate      by band (A / B / C) and per-trainer override
  materials_per_pax     by programme type
  venue                 client site = 0 · own venue = fixed · external = quote
  travel                by region (Klang Valley / peninsular / East Malaysia)
  meals_per_pax         capped by ACM (RM 15–25 in 2026)
  commission_pct        by role (consultant / manager) and by deal band
  margin_floor_pct      by programme type
  discount_authority    role → max % without approval
```

Every quotation stores the `rate_card.version` it was priced against.

**Questions for Finance:** the three trainer bands and their day rates, materials cost per pax, commission tiers, the margin floor, and who may discount how much. Until that meeting, the costing screen shows **rate card v0 · placeholder** so nobody quotes from it.

---

## 6 · Rule resolution date
**Owner: Finance / Compliance — confirm in writing with HRD Corp support**

**Grant-side rules resolve as at the grant application submission date; claim-side rules as at the claim submission date.** HRD Corp evaluates against the rules in force when they receive the thing.

- Lead time, commencement, no-amendment, trainer accreditation, ACM ceilings → resolved at grant submission; the rule-set version id is stored on the engagement.
- Claim window, attendance immutability → resolved at claim submission.
- **Re-evaluate at every stage transition.** If the applicable version changed between stages — a public programme applied 20 Dec 2026 but scheduled into January — raise a warning citing **both** versions rather than silently switching.

This supersedes the earlier `asOf = training_start` assumption in API_CONTRACT §17. It is a one-line question to HRD Corp's support centre and the kind they answer in writing.

---

## 7 · Rounding — total-from-lines, always
**Owner: Finance + engineering**

Lines are truth; totals are sums.

- Money as integer sen.
- Each line = `unit_price × qty`, rounded half-up to the sen.
- Totals sum the **rounded** lines; SST computed on the summed net.
- MyInvois validation expects line totals to reconcile to the invoice total, so lines-from-total is not an option.

**The RM 616.67 × 30 problem is a modelling error, not a rounding one.** RM 18,500 for 30 pax is a *package price*: one line, qty 1, with per-pax shown as informational (`18,500 ÷ 30 ≈ 616.67`). If a client insists on per-pax pricing, the quote becomes 30 × RM 617.00 = RM 18,510 or 30 × RM 616.50 = RM 18,495, and the proposal follows the quote. A displayed per-pax figure that does not multiply cleanly must never become a line.

---

## Discovery agenda

Put all seven in front of the client as **decisions with proposed defaults**, in this order:

1. Autonomy matrix — MD, 30 minutes, the longest conversation
2. Rule set verification — Finance with the circular PDFs open
3. Rate card — Finance, needs the numbers in the room
4. Baseline minutes — process owners, schedule the time-and-motion sampling
5. Rule resolution date — one written question to HRD Corp
6. Jury policy — Admin, confirm the gate/sample/escalate split
7. Rounding — Finance, five minutes, mostly confirmation
