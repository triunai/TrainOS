# Vector storage decision: pgvector on Supabase vs. Pinecone

> Research pass, 13 Sep 2026. Read against `docs/bd/proposal-content-pack-v2.md` §3.3/§4/§5, `docs/bd/ai-explorations/07-rule-change-watcher.md`, `08-tna-to-programme-recommendation.md`, `supabase/migrations/009_compliance_rules_checks_hrdc.sql`, `packages/contract/src/domain/knowledge.ts`. All external prices carry a source URL and were checked 2026-09-13; re-verify before quoting to the client, since two of these (Pinecone, OpenAI) are usage-based lists that move.

## 1. What's already decided in the repo

Migration 009 already commits to pgvector: `core.knowledge_chunks.embedding` is `extensions.vector(1536)` with an HNSW index on `vector_cosine_ops`, comment-flagged "1536 dimensions … assumed against text-embedding-3-small" (`supabase/migrations/009_compliance_rules_checks_hrdc.sql:197-206`). §3.3 puts pgvector on Supabase Pro in the stack table already. This research checks whether that decision holds as the corpus and tenant count grow, not whether to make it.

## 2. Corpus size model

Four tiers per §5. A/B/C are national/platform sources — one copy serves every tenant (`compliance_rules.tenant_id NULL = global`, migration 009 header). D is client-internal, so it scales per tenant. Assumptions below are stated because no source counts these documents yet.

**Tier A — Regulatory** (weekly diff): ~80 HRD Corp circulars (avg 5pp) + ACM (30pp) + ~20 eTRIS guides (10pp) + ~15 HRD-TDF/exemption docs (8pp) + ~10 LHDN/SST guides (15pp) + ~8 PDPA guidelines (10pp) + ~3 AI-governance docs (20pp) ≈ **~1,040 pages**.

**Tier B — Commercial** (monthly): claimable-course directory (~500pp equivalent) + 50 competitor catalogues (10pp) + 5 Bursa docs (20pp) + 10 skills-framework docs (15pp) + ~30 grant pages (3pp) + Budget (50pp) ≈ **~1,390 pages**.

**Tier C — Platform** (weekly): pricing/policy pages for WhatsApp, ~10 model providers, OpenRouter, hosting ≈ **~35 pages**.

Global total (A+B+C, not multiplied by tenant count): **~2,465 pages**.

**Tier D — Client-internal** (continuous), per tenant, assuming 12 months of trailing operational history at launch and §4.2's baseline volumes (40 proposals/mo, 25 engagements/mo, 80 enquiries/mo): catalogue (100 programmes × 2pp = 200pp) + trainer profiles/certs (30 × 3pp = 90pp) + 12mo proposals (480 × 5pp = 2,400pp) + 12mo TNAs (480 × 3pp = 1,440pp) + 12mo evaluation forms (300 × 2pp = 600pp) + SOPs/templates (100pp) + 12mo enquiries (960 × 1pp = 960pp) ≈ **~5,790 pages/tenant**. Attendance is treated as structured data, not embedded prose.

**Chunking**: assume ~750 tokens/page (500–600 words, mixed English/Bahasa). At 512-token chunks → 1.46 chunks/page; at 1,024-token chunks → 0.73 chunks/page.

| Scope | Pages | Chunks @512 (≈vectors) | Chunks @1,024 |
|---|---|---|---|
| Global (A+B+C, fixed) | 2,465 | 3,600 | 1,800 |
| Per tenant (D) | 5,790 | 8,450 | 4,225 |
| **Baseline (1 tenant)** | 8,255 | **~12,050** | **~6,025** |
| **3 tenants** | 19,835 | **~28,950** | **~14,475** |
| **10 tenants** | 60,365 | **~88,100** | **~44,050** |

These are five-figure vector counts even at 10 tenants — small by vector-database standards.

## 3. pgvector on Supabase: memory, dims, latency

Supabase's pgvector guide caps **indexable** dimensions for the `vector` type at 2,000 for HNSW/ivfflat; beyond that you must cast to `halfvec`, indexable to 4,000 dims ([Supabase pgvector docs](https://supabase.com/docs/guides/database/extensions/pgvector), accessed 2026-09-13). That makes the migration's 1,536-dim choice directly indexable as-is. A future move to a 3,072-dim model (text-embedding-3-large class) is **not** optional on HNSW — it forces `halfvec`, which happens to roughly cancel the size increase: `halfvec(3072)` stores 6 KB/vector, the same raw footprint as `vector(1536)` at float32.

Memory: raw storage is 4 bytes/dimension, so 1,536-dim float32 ≈ 6 KB/vector; HNSW graph overhead runs roughly 2–3× raw size in practice (community benchmarks cite 80–120 GB indexes for 10M 1,536-dim vectors — [dev.to, "Scaling pgvector"](https://dev.to/philip_mcclarence_2ef9475/scaling-pgvector-memory-quantization-and-index-build-strategies-8m2), accessed 2026-09-13). Applying that ratio (~15 KB/vector all-in) to our counts:

- Baseline (12,050 vectors): index ≈ **~180 MB** — trivial against any compute tier.
- 3 tenants (28,950): index ≈ **~430 MB** — still comfortable on the smallest tier.
- 10 tenants (88,100): index ≈ **~1.3 GB** — larger than the Micro instance's 1 GB RAM once the rest of the OLTP workload (the whole TrainOS database, not just vectors) shares that memory.

Query latency: no vendor number exists at this scale, so treat this as an engineering estimate, not a citation — HNSW with an equality filter on `tenant_id` ahead of the `<=>` ORDER BY (the pattern this table's index needs, since `kc_embedding_hnsw` isn't currently a partial/tenant-partitioned index) should stay well under 100ms at tens of thousands of candidate rows on any add-on tier ≥Small. Above roughly a few hundred thousand vectors per tenant, a partial index per tenant or partitioning becomes worth doing; not needed yet.

**Compute add-on** ([Supabase compute add-ons](https://supabase.com/docs/guides/platform/compute-add-ons), accessed 2026-09-13): Micro (1GB, included in the $25/mo Pro base) covers baseline and 3 tenants. At 10 tenants, Small (2GB, **$15/mo**) or Medium (4GB, **$60/mo**) gives headroom for the index plus the rest of the OLTP working set; recommend Small first and step up only if `pg_stat` shows cache pressure.

## 4. pgvectorscale

No source confirms pgvectorscale (Timescale's `StreamingDiskANN`, [GitHub](https://github.com/timescale/pgvectorscale), accessed 2026-09-13) is on Supabase's managed extension list today; Supabase's own extension docs don't mention it. It buys disk-resident ANN indexes for corpora too large to fit in RAM as HNSW graphs — not our problem at 12K–88K vectors. Not actionable now; revisit only if the crossover in §6 is approached and Supabase has added it by then.

## 5. Pinecone serverless

Current published rates ([Pinecone pricing](https://www.pinecone.io/pricing/), accessed 2026-09-13): Standard plan **$50/month minimum**, then usage: reads ≈$16–18/M read units, writes ≈$4–4.5/M write units, storage ≈$0.33/GB/month, 100,000 namespaces/index (one per tenant is trivial). At our vector counts, storage for 88,100 vectors × 6KB ≈ 0.5GB ≈ **$0.17/month**, and RU/WU from baseline query/write volume stay well under a dollar — the **$50/month minimum is the entire bill** at every scale modeled here. That $50/mo (≈RM 225) is itself larger than most of §4.3's entire platform-cost stack, before counting the operational cost Pinecone adds: a second data store to operate and back up, PII (participant names, trainer certs, proposal content) leaving Postgres and crossing to a US-hosted service, and a second PDPA cross-border-transfer clause to write and defend alongside the one §3.4 already covers for model providers.

## 6. Embedding cost

[text-embedding-3-small: $0.02/M tokens; text-embedding-3-large: $0.13/M tokens](https://tokenmix.ai/blog/text-embedding-3-small-developer-guide-2026) (OpenAI's own pricing page returned HTTP 403 to automated fetch; this figure is corroborated across multiple 2026 pricing trackers and matches the well-published $0.02/$0.13 rate — accessed 2026-09-13). Voyage AI's current generation: voyage-4-lite $0.02/M, voyage-4 $0.06/M, voyage-4-large $0.12/M ([Markaicode](https://markaicode.com/pricing/voyage-ai-pricing/), accessed 2026-09-13).

Initial embed (at 750 tokens/page): baseline 8,255pp ≈ 6.2M tokens ≈ **$0.12** (small) / **$0.81** (large, one-time); 10 tenants 60,365pp ≈ 45.3M tokens ≈ **$0.91** / **$5.89**. Monthly re-embed (new Tier D content only, ~460pp/tenant/month per §4.2's cadence + negligible Tier A/C diffs): **~$0.01/tenant/month** (small) scaling to **~$0.07/month** at 10 tenants. This matches the order of magnitude ai-explorations 07 and 08 already found (~$0.05–0.09/month for their specific pipelines) — embedding is a rounding error against the AI baseline of $25–40/month in §4.2, at any tenant count modeled here.

## Cost table

| | pgvector on Pro (Micro, included) | pgvector + compute add-on | Pinecone serverless (usage / billed) | Embedding spend (init → monthly re-embed) |
|---|---|---|---|---|
| Baseline (1 tenant, ~12K vecs) | $25/mo (fits, ~180MB index) | not needed | ~$0.17 usage / **$50 billed (minimum)** | $0.12 → $0.01/mo |
| 3 tenants (~29K vecs) | $25/mo (fits, ~430MB index) | not needed | ~$0.40 usage / **$50 billed (minimum)** | $0.30 → $0.02/mo |
| 10 tenants (~88K vecs) | $25/mo (tight, ~1.3GB index) | **+$15/mo (Small)** recommended | ~$1.20 usage / **$50 billed (minimum)** | $0.91 → $0.07/mo |

## 7. Decision and crossover

Pinecone never wins here: its $50/month floor exceeds pgvector's total marginal cost (at most +$15/month) at every scale modeled, before counting the second-data-store and PDPA cross-border overhead §3.4 would need to extend to it. pgvector on Supabase stays viable up to roughly the point where the HNSW index plus the rest of the OLTP working set stops fitting on a Large instance (8GB, $110/mo) — call that **~300,000–500,000 vectors** at 1,536 dims (≈4.5–7.5GB index at the ~15KB/vector overhead used above), which at today's ~8,450 vectors/tenant/year-one is roughly **35–60 tenants**, or sustained query load above roughly **500–1,000 QPS** on the vector path specifically, whichever arrives first. **Recommendation: stay on pgvector on Supabase Pro through at least 10 tenants, add the Small compute tier ($15/mo) at 10 tenants for headroom, and re-open this decision only if tenant count or vector count approaches the ~35–60 tenant / ~400K vector range** — well beyond anything in the current proposal's phased volumes.
