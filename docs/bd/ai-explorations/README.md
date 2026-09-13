# AI integration explorations — breadth pass, 13 Sep 2026

Eight Sonnet lanes each took one integration from the ranked list in
`../2026-09-13-ai-integration-brainstorm.md` and wrote a pre-hard breadth search
with some depth: the job and the number it moves, the data that exists versus
what is missing (with file and migration citations), CODE versus MODEL steps,
policy and autonomy, screens, evals, risks, monthly token cost, the smallest
viable slice, and a closing **For the Opus pass** list.

| # | File | Number it moves | Sharpest finding |
|---|---|---|---|
| 1 | `01-speed-to-claimable-date-reply.md` | RM 60k/month at a 10pp enquiry→proposal lift | No `claimableDate` exists anywhere; the 14-day arithmetic only runs post-hoc as a check |
| 2 | `02-levy-radar.md` | RM 30k/month at 8% on a RM 4.5m at-risk pool | "Utilisation" is undefined in schema and contract; claim history is a lower bound because employers claim through several providers |
| 3 | `03-claim-integrity-guard.md` | RM 9k/month protected, zero tokens by schema CHECK | 90-day commencement and 6-month claim window have no seeded check key in 009 |
| 4 | `04-proposal-drafting-and-costing.md` | RM 1.75k/month directly; value folded into #1 | Two of three jurors bound to one vendor; `PROPOSAL_DRAFT` missing from the contract enum; no ACM-ceiling flagging in code |
| 5 | `05-trainer-matching-and-hold.md` | RM 8k/month protected | HRD-TDF accreditation has no expiry field; a 72h soft hold exists in 006 with no releasing job and no `TRAINER_BOOK` payload |
| 6 | `06-collections-escalation.md` | RM 150k working capital once (does not reproduce from its own DSO formula) | The human-call rung is HUMAN_CALL at day 60, fourth of five, not third; ladder seed deferred to 016 |
| 7 | `07-rule-change-watcher.md` | RM 48k exposure per missed circular | No ingestion pipeline exists in code; global rules are service-role-only writes, so "Finance approves" may not be able to write the row |
| 8 | `08-tna-to-programme-recommendation.md` | RM 15k/month, weakest estimate | No competency taxonomy table exists; "map to competencies" is text similarity against programme category |

## For the Opus pass (next session, after the UI is closed)

Do not redo the breadth. For each file, start at its **For the Opus pass**
section and go harder on exactly those threads. Cross-cutting items that
several files raise and that should be settled once, not eight times:

1. **Claimable-date projection** as a first-class contract field and RPC,
   computed from grant-approval rules in the rules registry (file 1, 3, 4).
2. **Jury vendor independence**: rebind the three STRONG jurors to three
   vendors in `packages/agent-runtime/src/routing/config.ts` (file 4).
3. **Contract enum and routing gaps**: `PROPOSAL_DRAFT` in the action-type enum,
   `TRAINER_BOOK` payload type, `TNA_RECOMMENDATION_ACCEPT` routing and jury
   entry (files 4, 5, 8).
4. **Utilisation** defined once (numerator, denominator, window) in the contract
   before the levy radar is built (file 2).
5. **Compliance check keys** for the 90-day and 6-month rules (file 3), owned by
   the migrations lane.
6. **Competency taxonomy**: decide whether it is a table, a controlled
   vocabulary in config, or deliberately absent (file 8).
7. **Ingestion pipeline** for the corpus monitor: fetch, hash, diff, PDF-to-text,
   rule-diff proposal, human approval, effective-dated versioning; and who can
   write a global rule (file 7).
8. Recompute the collections working-capital figure with a stated formula
   (file 6).

Ordering for the demo, from the brainstorm doc: speed-to-claimable-date first,
then the levy radar, then the claim-integrity guard.
