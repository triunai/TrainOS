# AI integration 2 · The levy radar

> Breadth pass, 13 Sep 2026. Sources: `docs/bd/2026-09-13-ai-integration-brainstorm.md` §1 item 2 and §3, `docs/bd/2026-09-13-value-chain-and-numbers.md`, `docs/bd/proposal-content-pack-v2.md` §2.4, §5, Appendix B, `docs/design/API_CONTRACT.md` §5, §13, `packages/contract/src/domain/organisations.ts`, `supabase/migrations/005,009,011`, `apps/web/src/features/relationships`, `apps/web/src/features/organisations`.

## 1. The job and the number

Project each client's year-end levy position, flag balance > RM 50,000 with utilisation < 50% (a 15% deduction on the excess since March 2025), and flag balances nearing the 24-month forfeiture clock, then raise a cross-sell with the rationale written out. Sales decides; it stays at Suggest permanently — a pitch is a client commitment (brainstorm item 2).

The number: at 120 clients averaging RM 60,000 available, that's RM 7,200,000 in the book (120 × 60,000, checks out), of which the brainstorm estimates RM 4,500,000 at risk. An 8% annual conversion on that pool is RM 360,000/year = **RM 30,000/month** (4,500,000 × 0.08 ÷ 12). Client-side hook: a RM 120,000 balance avoids 15% × (120,000 − 50,000) = **RM 10,500** of loss — correct, and the sentence that opens the call.

## 2. Data: what exists, what's missing

**Contract types that exist:** `OrganisationMetrics.hrdcLevyAvailable` (`organisations.ts:36-40`) is a single point-in-time `MetricValue<Money>` on the record header. `RelatedHrdc` (`organisations.ts:127-131`) carries `employerCode`, `levyAvailable`, and a packet list — again one balance, no trend. `OrganisationSuggestion` (`organisations.ts:155-162`) is exactly the shape the radar populates: `type: 'CROSS_SELL'`, `programmeId`, `title`, `rationale`, `provenance`, `actions`. The endpoint `GET /v1/organisations/{id}/suggestions` (API_CONTRACT.md:353-359) already specs the `HRDC_STATEMENT` provenance source.

**Tables that exist:** `core.organisation_suggestions` (`005_...sql:381-404`) is the write target — `suggestion_type`, `programme_id`, `title`, `rationale`, `status` OPEN/ACTED/DISMISSED, `created_by_id` defaulting to `'agent_knowledge'`. `core.hrdc_levy_statements` (`009_...sql:680-696`) is a snapshot table — `organisation_id`, `employer_code`, `as_of` date, `levy_available_sen`, unique per (tenant, org, as_of). This is the time-series the projection needs.

**The gap:** `hrdc_levy_statements` has zero references outside migration 009 — no contract type, endpoint, fixture, or web consumer (repo-wide grep confirms it). It's scaffolded but unread. Worse, no `utilisation` or `contribution_rate` concept exists anywhere in schema or contract (zero hits repo-wide). The 15% rule needs utilisation (claimed ÷ credited this year), not a balance, and neither figure nor a claim-history table exists. `core.hrdc_packets.claim_value_sen` is the only claim history in the system, and it's a lower bound: brokers send employers to 3–5 providers at once (value-chain doc), so a client claiming elsewhere reads as under-utilised here when they aren't. This is the feature's central data risk, not a UI gap.

## 3. Deterministic core vs. model calls

| Step | Type | Tier / agent |
|---|---|---|
| Ingest a statement snapshot into `hrdc_levy_statements` | CODE (upsert by org+as_of) | n/a — no ingestion path exists yet |
| Extract balance/employer-code off a statement document | MODEL | MID (DeepSeek V4 Pro — §4.1's "packet checks" bucket fits structured extraction better than STRONG) |
| Year-end projection off the time series | CODE | pure arithmetic, zero tokens |
| RM 50,000 / <50% utilisation threshold check | CODE | zero tokens |
| 24-month forfeiture countdown | CODE | zero tokens |
| One sentence of rationale | MODEL | FAST — composing one sentence over already-computed facts, not long-form drafting |

Sub-agent: `agent_knowledge` (`organisation_suggestions.created_by_id` default; matches `provenance.agentId` in API_CONTRACT.md:357). No implementation file exists for it — `packages/agent-runtime/src/agents/` holds only `lead-to-proposal.ts` and `demo-script.ts`.

## 4. Policy and autonomy

Launch level: Suggest, permanently — no promotion path, none wanted. `SuggestionAction.type: 'OPPORTUNITY_CREATE'` is a UI intent, not a governed action: absent from migration 011's `seed_action_policies` catalogue, and `CrossSellPage.tsx`'s own comment confirms it ("a UI intent... so the buttons navigate and no approval can be queued from here"). Nothing for the policy engine to gate, nothing for the jury (§18) to see — a human clicks through to an ordinary opportunity-create flow governed elsewhere.

## 5. Screens

- `apps/web/src/features/relationships/CrossSellPage.tsx` (329 lines) — fully built: tinted org table, tab filters, a reasoning panel with `AIChip`, rationale, citation chips, action buttons. Needs: the panel shows only the rationale sentence, never the levy trend or countdown behind it.
- `apps/web/src/features/organisations/Organisation360Page.tsx` (576 lines, M04-S02) — the suggestions panel (~360–419) renders the same cards inline; the `hrdcLevyAvailable` tile (~510–511) sits on the record header. Needs: the tile is a single balance with no at-risk styling, though the demo script's minute 1:30–3:00 implies one.

## 6. Evals

Golden set per the brainstorm's own spec: 40 organisations × 8 quarters of statements and claim history, 320 points. Leave-shadow at extraction exact-match ≥0.98 with page/line citation, projection error ≤2% of balance, ≥6 of the first quarter's top-10 flagged orgs producing a real conversation.

Three cases: (a) balance RM 61,000, utilisation 38%, crosses the 24-month clock in December — must flag both rules; (b) balance RM 45,000 below the RM 50,000 floor at 20% utilisation — must *not* flag the 15% rule, a common false-positive shape; (c) TrainOS-only claim history reads 15% utilisation but true multi-provider utilisation is 55% — the §2 gap made concrete, and the real shadow-exit blocker.

## 7. Risks

- **Regulator:** none directly — never touches eTRIS.
- **PII:** levy balance and employer code are sensitive per-client data behind tenant RLS only. Mitigate: restrict reads to SALES/FINANCE/MD, as the org-record endpoint already does.
- **Prompt injection:** lower than the watcher — statements come from the client relationship, not a public fetch — but a forwarded scanned statement could still carry adversarial text. Mitigate: both thresholds are re-verified deterministically, never trusted from model prose.
- **Cost:** negligible (below).

## 8. Monthly cost

§4.2 sets no baseline volume for statement checks. Assuming a monthly check across all 120 clients (upper bound; quarterly is a third of this): MID extraction at ~2,000 in / 500 out tokens × 0.66/1.98 USD per 1M = 120 × 0.00231 ≈ USD 0.28; FAST rationale at ~200 in / 100 out ≈ USD 0.01. **Total ≈ USD 0.29/month (≈ RM 1.3)** — rounding error against the pack's USD 25–40/month baseline.

## 9. Smallest viable slice (one week, fixtures only)

Read `hrdc_levy_statements` fixture rows (schema exists, needs seeding), run the projector and both threshold checks with a templated (non-model) rationale, and write an OPEN `organisation_suggestions` row. Wire it into the two screens above, which already consume this shape — no new screen code needed. Defer MID extraction and FAST prose to week two; thresholds and countdown are zero-token and ship first.

## 10. For the Opus pass

1. Utilisation is undefined in the schema. What is "credited this year," and where does it come from if HRD Corp's portal isn't API-accessible? This is brainstorm question 4 to Alex, and it blocks the 15% rule entirely, not just the polish.
2. If clients claim through other providers too (likely, per "3–5 providers at once"), utilisation from `hrdc_packets` alone will systematically read low — inverting the pitch. Needs a real test against 5–10 of Alex's actual clients before the golden set is trusted.
3. `core.hrdc_levy_statements` has zero consumers. Confirm whether it was scaffolded ahead of this feature or is a stale forward-reference — either way it needs an owning contract type and endpoint.
4. Three places to go harder: (a) the utilisation/contribution-rate data model, a schema question; (b) the false-positive risk from partial claim visibility, tested on real data; (c) ingestion cadence — `UNIQUE(tenant, org, as_of)` implies periodic snapshots, but who uploads a statement and how often is undesigned.
