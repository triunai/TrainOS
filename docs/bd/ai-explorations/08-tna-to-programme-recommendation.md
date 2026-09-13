# AI integration 8 — TNA extraction to programme recommendation

> Pre-hard breadth pass, 2026-09-13. Companion: brainstorm item 8. An Opus lane goes deeper on this file — see §10.

## 1 · The job and the number

Turn a needs analysis into mapped competency gaps and a ranked programme with a fit score and citations, so the proposal starts from evidence rather than a guess. Stays at Suggest; `HUMAN_STEP_REQUIRED` is the ceiling — the client validates the gaps, Sales picks from the ranking.

The brainstorm's number: **~RM 15,000/month**, a 5% lift on engagement value, explicitly flagged as "the least defensible estimate here." Recomputed: 5% × 25 engagements × RM 12,000 = RM 15,000/month — the arithmetic holds, the *lift assumption* is not sourced to anything. It is value from deal shape (the right programme, the right days, matched to the actual gap) rather than deal count, harder to attribute than "faster reply." What would firm it up: a before/after comparison of engagement value once TNA-driven recommendations go live, needing the 12–24 months of history brainstorm question 8 asks Alex for — without it this stays a plausible story, not a measured effect.

## 2 · Data it needs

**Contract types:** the full TNA shape already exists — `Tna` (`proposals.ts:75`), `TnaAudience` (`:38`), `TnaConstraint` (`:51`), `TnaGap` (`:58`, `name/description/priority/evidenceRefs/provenance`), `TnaEvidence` (`:68`), `TnaRecommendation` (`:97`, `fitScore/rationale/priceIndication/trainerAvailability`), `ScoringModel` (`:107`, a `Record<string, Rate>` of weights) and `TnaRecommendationAcceptPayload` (`:495`).

**Endpoints:** `GET /v1/tnas/{id}` and `.../recommendations` (API_CONTRACT.md §6, lines 367-397), `POST /v1/actions type: TNA_RECOMMENDATION_ACCEPT` (§3, line 197), `POST /tnas/{id}/reopen` (§13 M05-S02, line 821). Critically, **TNA input today is a client-completed web questionnaire** via `POST /public/tnas/{token}/submit`, firing `TNACompleted` (§14, line 851) — a structured form, not a free-text upload. No endpoint ingests a discovery-call transcript or PDF; "discovery form or call notes" describes a second, unbuilt channel.

**Tables (001–011):** `core.tnas` (005:449) has `audience_headcount/level/sites/language`, `budget_sen` (nullable on purpose — "the client declining to state one," comment 005:479), and a `CHECK` that `COMPLETE` requires `completed_at`. `core.tna_gaps` (005:511) is `name/description/priority/evidence_refs[]` — **evidence_refs are questionnaire question ids ("Q4","Q7"), not entity references** (005:527), so a gap can't be traced to a document span. `core.tna_recommendations` (005:558) stores `fit_score`, `rationale`, `scoring_model_version` (`NOT NULL` so a score can be re-explained later, 005:579) and `scoring_weights jsonb`. `core.tna_evidence` (005:534) is flagged a **consolidation candidate**: the same evidence triple exists independently in sb-money and sb-actions, unresolved. **No competency taxonomy table exists anywhere in 001–011** (confirmed by grep) — a gap's `name` is free text matched against `core.programmes.category` (006:76) and `outcomes text[]`, not a skills graph. Matching is string/embedding similarity dressed as "competency mapping," not a join.

## 3 · Deterministic core vs model calls

Three steps, unevenly deterministic. **Extraction** (answers → `TnaGap[]`): mostly CODE, since the questionnaire is structured; MODEL only where free text needs summarising into `name`/`description`. **Mapping to competencies**: MODEL, since no competency table exists to join against (§2) — the weakest link, doing semantic work a taxonomy should do. **Recommendation**: a hybrid — `ScoringModel.weights` (`gapCoverage 0.5, audienceFit 0.2, windowFit 0.2, trainerAvailability 0.1`, fixture `fixtures/src/data/proposals.ts:163`) is a CODE-computable weighted sum once coverage is scored, but *producing* that coverage score is currently a MODEL judgment. Tier: proposal-content-pack-v2.md:190 puts "TNA extraction, matching" at `MID`; `DEEP THINK` covers ambiguous cases near the escalation threshold (`escalateBelow: 0.7-0.75` in `agents/lead-to-proposal.ts`). Estimate: extraction ~70% CODE, mapping ~20%, recommendation scoring ~60%. No dedicated sub-agent exists for this chain — `lead-to-proposal.ts` only covers enquiry-to-proposal.

## 4 · Policy and autonomy

Table 2.3 (`proposal-content-pack-v2.md:100`): agent "extracts gaps, maps to competencies and programmes," human "validates with client." `TNA_RECOMMENDATION_ACCEPT` is a listed action type (API_CONTRACT.md:197) but has **no routing entry in `routing/config.ts`**, falling back to `defaultTier: 'MID'` with no jury at all — a gap, since everything else reaching a screen has an explicit entry. It writes only a recommendation acceptance, not money or a booking, so Suggest is the right ceiling and the brainstorm is explicit it never gets promoted.

## 5 · Screens

- **TNA detail** (`apps/web/src/features/tna/TnaDetailPage.tsx`) already renders gaps with priority chips and AI provenance (`gapColumns`, line 124-154), and a ranked recommendation panel with a "Use recommendation" action (line ~199-202) calling `accept(programmeId)` (line 100). This screen is largely built; the gap is upstream (extraction/mapping quality), not the UI.
- **Programme detail** (`ProgrammeDetailPage.tsx`) shows the trainer pool but nothing about which TNAs cited it. Change: a "recommended for" backlink to open TNAs, so Ops sees demand pressure per programme.
- **TNA list** (`TnaListPage.tsx`) — change: a fit-score or confidence column so a low-confidence recommendation is triageable before it reaches detail.

## 6 · Evals

Golden set: every completed TNA with the programme actually sold and the client's validation edits, replayed against current extraction and scoring. Three cases (`fixtures/src/data/proposals.ts`): (1) `TNA-0042` Aurora — two HIGH gaps, correctly scores PRG-0031 at 0.91 over PRG-0018's 0.78 and PRG-0044's 0.22 — must preserve that ordering. (2) `TNA-0051` Meridian — one HIGH gap; must not over-recommend a programme on unrelated outcomes just because `audienceFit` scores well. (3) `TNA-0054` Kenanga — `gaps: []`; must surface "no gaps identified" rather than force a recommendation, since an invented gap justifying a sale is the worst failure mode here.

Shadow-exit: gap extraction exact-match ≥ 0.85 against client-validated gaps (softer than elsewhere, since this is a language task), top-1 programme match ≥ 0.80, confidently-wrong rate (confidence ≥ 0.75, later rejected) ≤ 5%, zero recommendations on an empty-gap TNA without a `needsReview` flag.

## 7 · Risks

- **Regulator**: citing a non-claimable programme as claimable — read `hrdc_claimable`/`hrdc_scheme` from `core.programmes` in code, never assert claimability in generated text.
- **PII**: participant/organisational detail in TNA answers — same tenancy/consent posture as `contact_consents` (005:190); never send raw audience data outside the tenant's approved routing.
- **Prompt injection**: real once free-text or uploaded documents are in scope (§2) — treat extracted text as data only, and keep the structured questionnaire as default until upload is evaluated separately.
- **Cost**: `DEEP THINK` escalation on every ambiguous TNA is the expensive path — mitigate with the same `escalateBelow` gate used elsewhere.

## 8 · Monthly token cost

At baseline (40 proposals/month per §4.2, one extraction + one recommendation call each, `MID` tier): ~1,500 in / 600 out tokens × 40 = 60,000 in / 24,000 out monthly. At `MID` off-peak USD 0.66/1.98 per 1M: (0.06×0.66)+(0.024×1.98) ≈ **USD 0.09/month**, negligible against §4.2's USD 25–40 baseline — cost is not the constraint here, accuracy is.

## 9 · Smallest viable slice

One week, fixtures only: build the missing TNA sub-agent (extraction + recommendation) against the three fixture TNAs above, wire it to the existing `TnaDetailPage` panel, and add the missing `TNA_RECOMMENDATION_ACCEPT` routing entry. No taxonomy build required for this slice — score against `programmes.category` and `outcomes[]` as today, and flag the taxonomy gap rather than solving it in week one.

## 10 · For the Opus pass

1. No routing entry exists for `TNA_RECOMMENDATION_ACCEPT` — decide its tier and jury before this reaches even Suggest in production.
2. No competency taxonomy exists anywhere. Is building one (`competencies` table + `programme_competencies`/`gap_competencies` joins) in scope, or does "mapping to competencies" stay free-text similarity indefinitely? The biggest gap between the brainstorm's language and the data model.
3. "Discovery form or call notes" implies a second TNA input channel beyond the built questionnaire — push on whether that is Phase 1 scope, since it is the only place here prompt injection is a live risk, not a hypothetical one.
