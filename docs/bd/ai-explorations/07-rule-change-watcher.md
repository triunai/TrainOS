# AI integration 7 · Rule-change watcher

> Breadth pass, 13 Sep 2026. Sources: `docs/bd/2026-09-13-ai-integration-brainstorm.md` §1 item 7, `docs/bd/proposal-content-pack-v2.md` §4.1, §5, `docs/design/API_CONTRACT.md` §17, `packages/contract/src/domain/{knowledge,hrdc-finance}.ts`, `supabase/migrations/009,011`, `apps/web/src/features/{knowledge,hrdc}`.

## 1. The job and the number

Diff the corpus weekly, propose effective-dated rule changes with the source span highlighted and affected engagements listed. Finance approves; never autonomous — the one item where a STRONG tier earns its cost, since PDF-to-structured-diff is hard and anything under 0.80 confidence is withheld for manual transcription (brainstorm item 7).

The number: the fixture circular touches four open engagements at **RM 48,000 exposure per missed circular**. RM 48,000 ÷ 4 = RM 12,000/engagement, exactly the pack's baseline average claimable engagement value (§0) — internally consistent, not freshly invented.

## 2. Data: what exists, what's missing

**Endpoints that exist:** `GET /v1/knowledge/sources`, `POST .../check`, `POST .../reingest` (M16-S05, API_CONTRACT.md:1026-27); `GET /v1/compliance/rule-changes?status=PROPOSED`, `GET .../{documentId}`, `POST /v1/actions type:RULE_CHANGE_APPROVE` (M12-S08, :1006-08).

**Contract types that exist:** `KnowledgeSource` (`knowledge.ts:17-31`) — `contentHash`, `monitorStatus` (WATCHING/CHANGED_REVIEW_PENDING/FAILED/MANUAL), `embeddingStatus`, `ruleChangeSetId` linking a source to its extracted changes. `RuleChangeSet`/`RuleChange`/`RuleChangeSourceSpan` (`hrdc-finance.ts:192-231`) — `documentId`, `publishedAt`, `ingestedAt`, `extractedBy: {model, confidence, runId}`, `effectiveFrom`, per-change `op/targetRuleId/before/after/sourceSpan/confidence/affectedEngagements`. `RULE_CHANGE_MIN_CONFIDENCE = 0.8` is a shared constant already consumed by the review screen.

**Tables that exist (migration 009):** `core.knowledge_sources` (127), `core.knowledge_chunks` (162 — the `embedding` column needs pgvector, flagged in the header as unavailable when authored, the one object not verified in its intended form), `core.compliance_rules` (239, bitemporal: `validity` and `known` axes, EXCLUDE constraint so no two ACTIVE/SUPERSEDED rules overlap on both per family/mode/scheme), `core.rule_change_sets` (441), `core.rule_changes` (467), `core.rule_change_affected_engagements` (502). `compliance_rules.tenant_id` nullable = a global, national rule, written by `service_role` only, never a tenant ADMIN, per the header.

**What's missing:** no ingestion pipeline exists in code. `packages/agent-runtime/src/agents/` holds only `lead-to-proposal.ts` and `demo-script.ts` — nothing for fetch, hash, diff, or PDF-to-text, and no cron/queue infrastructure anywhere. The pack's mechanics (§5: fetch → hash/diff → PDF-to-text → strong-model rule-diff → human approval → effective-dated, versioned, cited) are prose, not architecture. `RuleChangeSet.extractedBy` is a single `{model, confidence, runId}` — no jury field, despite §4.1 naming three STRONG models for "third vote."

## 3. Deterministic core vs. model calls

| Step | Type | Tier / notes |
|---|---|---|
| Fetch Tier A sources | CODE | zero tokens; no fetcher yet |
| Hash | CODE | compares `KnowledgeSource.contentHash`; flips `monitorStatus` to `CHANGED_REVIEW_PENDING`, emits `SourceChanged` |
| Diff | CODE | isolates the changed span before any model sees it |
| PDF-to-text | MODEL | MID (DeepSeek V4 Pro), the brainstorm's "hard" step |
| Rule-diff proposal | MODEL | STRONG — §4.1's "long-document verification" bucket; contract supports one model, not a jury (§10.2) |
| Confidence gate (<0.80 withheld) | CODE | zero tokens, `RULE_CHANGE_MIN_CONFIDENCE` |
| Human approval | HUMAN, CODE-gated | `RULE_CHANGE_APPROVE`, Act-with-approval, no autonomous path in the catalogue |
| Effective-dated versioning | CODE | writes the circular's `effectiveFrom`, not the approval timestamp; exercises the bitemporal EXCLUDE constraint, zero tokens |

No sub-agent is implemented. "Knowledge Agent" (`agent_knowledge`) appears only in Agent Registry / Run Trace UI copy and fixtures.

## 4. Policy and autonomy

Launch level: Act-with-approval, permanent ceiling — matches migration 011's CMP-05 row: `RULE_CHANGE_APPROVE`, `approver_role FINANCE`, condition `[]`/`ALL` (unconditional), `sla_minutes 1440` (24h), escalates to `ADMIN` at 2880 min, expires at 5760 min, category `COMPLIANCE`. No confidence-based escalation — a 0.94- and a 0.81-confidence change get the identical SLA. Jury (§18): the routing table's generic `jury.quorum: 2 of 3` shape exists in §4.1's AI-ops pass, but `RuleChangeSet.extractedBy` as typed carries only one model — whether a jury runs here is unresolved. Promotion criteria: none, a permanent ceiling.

## 5. Screens

- `apps/web/src/features/knowledge/KnowledgeSourcesScreen.tsx` (440 lines, M16-S05) — lists sources with `monitorStatus`, `contentHash`, `embeddingStatus`. Needs a link from a `CHANGED_REVIEW_PENDING` row to its review — `ruleChangeSetId` exists on the type, so it's a missing affordance, not a data gap.
- `apps/web/src/features/hrdc/RuleChangeReviewScreen.tsx` (384 lines, M12-S08) — fully built: two-pane diff, source-span highlighting, confidence-floor withholding, per-change approve. Demo-ready off fixtures; needs live extraction wired in, not new screen work.
- `apps/web/src/features/hrdc/RulesRegistryScreen.tsx` (M12-S07) — renders `supersedesId`/`supersededById`. Needs the `VersionDrift` warning (`hrdc-finance.ts:~286`) surfaced when a rule changed mid-flight, per §18.

## 6. Evals

Golden set: every ingested circular over the discovery window with its ground-truth diff, mirroring the claim-integrity guard's pattern. Measure change-detection recall and false-change rate.

Synthetic test: a **circular diff** — "the lead time in §3.2 is amended to match §2.1" while §2.1 reads "see §3.2 for the applicable lead time." Extraction must fail to resolve a value and drop confidence below 0.80 (withheld for transcription), not hallucinate a number that becomes a live constraint. Shadow-exit threshold: recall = 1.00 on historical BINDING changes (`core.rule_kind` ENUM `BINDING`/`ADVISORY` already distinguishes these — a missed BINDING change blocks nothing until a claim is rejected months later), false-change rate ≤5%, and the trap resolves to withheld on every run before leaving Observe.

## 7. Risks

- **Regulator:** a wrongly-approved change becomes the constraint every future engagement is checked against. Mitigate: the `known` axis records what was believed and when, never rewritten, plus the unconditional approval gate.
- **PII:** low — circulars are public; `affectedEngagements` resolves to internal refs, never client names.
- **Prompt injection:** explicit in the brainstorm's framing — a fetched circular is untrusted content. Mitigate: hash/diff runs before any model sees content; extraction gets no tool-use.
- **Cost:** negligible (below).

## 8. Monthly cost

Assume ~15 Tier A sources weekly (§5's list) = 60 fetch/hash/diff passes/month, all CODE, free. Assume 1 circular changes/month (matching the fixture): MID PDF-to-text ~8,000 in / 1,500 out × 0.66/1.98 USD/1M ≈ USD 0.0083; STRONG rule-diff ~10,000 in / 2,000 out × 2/10 ≈ USD 0.04. **Total ≈ USD 0.05/month** — rounding error against both the pack's USD 25–40/month baseline and the RM 48,000-per-miss exposure this exists to catch. ROI rests on not missing a circular, not token savings.

## 9. Smallest viable slice (one week, fixtures only)

Skip the live fetch. Seed one fixture `KnowledgeSource` with a before/after version of the RM 48,000/4-engagement circular, hand-write the expected `RuleChangeSet`. Ship the deterministic half: hash comparison flips `monitorStatus`; a stub rule-diff producer returns the fixture instead of calling a model. This proves the pipe — source → `CHANGED_REVIEW_PENDING` → review screen → `RULE_CHANGE_APPROVE` → a `compliance_rules` row with the right `effectiveFrom` — end to end, with zero new code in `RuleChangeReviewScreen.tsx`.

## 10. For the Opus pass

1. No ingestion pipeline exists anywhere. The pack's mechanics are prose, not architecture — where FETCH runs, where PDF-to-text output lands before rule-diff reads it, needs a real design pass before sizing.
2. `RuleChangeSet.extractedBy` is single-model; §4.1 names three STRONG models for this verification. Decide whether rule-diff should be jury-gated like proposal drafting — a hallucinated compliance rule outranks a hallucinated proposal paragraph in stakes, and the contract can't express jury dissent on a rule change.
3. `compliance_rules.tenant_id` NULL-for-global with service-role-only writes means "Finance approves" is imprecise: per the migration's intent, a global change needs a platform-level actor, not CMP-05. Check whether `RULE_CHANGE_APPROVE` as scoped can write a global row, or silently creates a tenant override where a platform-wide fix was meant.
4. Three places to go harder: (a) the fetch/PDF-to-text pipeline, unbuilt; (b) jury-vs-single-model; (c) the global-vs-tenant write path, where a wrong answer sends a correction meant for every tenant to just one.
