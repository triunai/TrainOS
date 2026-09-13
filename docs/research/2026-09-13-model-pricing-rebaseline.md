# Model pricing re-baseline — 2026-09-13

Re-baselines `docs/bd/proposal-content-pack-v2.md` §4 against current provider pricing and the
tier bindings actually shipped in `packages/agent-runtime/src/routing/config.ts`. All prices
accessed 2026-09-13 unless noted; USD/1M tokens unless stated.

## 1. Price table

| Model (tier) | Input | Output | Cache write | Cache hit/read | Batch | Source |
|---|---|---|---|---|---|---|
| Claude Sonnet 5 (`claude-sonnet-5`) | $2.00 | $10.00 | $2.50 (5m) | $0.20 | 50% off | [claude.com/pricing](https://claude.com/pricing) |
| Claude Opus 5 (`claude-opus-5`) | $5.00 | $25.00 | $6.25 (5m) | $0.50 | 50% off | [claude.com/pricing](https://claude.com/pricing) |
| Claude Haiku 4.5 (`claude-haiku-4-5`) | $1.00 | $5.00 | $1.25 (5m) | $0.10 | 50% off | [claude.com/pricing](https://claude.com/pricing) |
| DeepSeek V4.1-Flash (pack's "V4 Flash"; `deepseek-chat` aliases it until retirement) | $0.15 off-peak / $0.30 peak | $0.60 off-peak / $1.20 peak | — | $0.003 off-peak / $0.006 peak | — | [api-docs.deepseek.com/quick_start/pricing](https://api-docs.deepseek.com/quick_start/pricing) |
| DeepSeek V4-Pro (`deepseek-v4-pro`) | $0.66 off-peak / $1.32 peak | $1.98 off-peak / $3.96 peak | — | $0.022 off-peak / $0.044 peak | — | same |
| gpt-oss-120B (Cerebras) | $0.35 | $0.75 | — | — | — | Cerebras/aggregator (see note) |
| gpt-oss-120B (Groq) | $0.15 | $0.60 | — | $0.075 | 50% off | groq.com pricing (via aggregator, see note) |
| Qwen3.7 Flash (DashScope, Intl/Singapore, ≤32K ctx) | $0.03 | $0.13 | — | — | — | Alibaba DashScope pricing (via aggregator, see note); rises to $0.10/$0.40 at 32K–256K, $0.20/$0.80 at 256K–1M; Mainland endpoint 60–70% cheaper |
| Gemini 3.1 Pro (≤200K ctx) | $2.00 | $12.00 | — | $0.20 (90% off) | — | ai.google.dev pricing (via aggregator, see note); ≥200K ctx re-rates whole request to $4.00/$18.00 |
| GPT-5.2 | $1.75 | $14.00 | — | $0.175 | $0.875/$7.00 | [developers.openai.com/api/docs/pricing](https://developers.openai.com/api/docs/pricing) |
| GPT-5.6 Terra | $2.00 | $12.00 | — | $0.20 | $1.00/$6.00 | same |
| GPT-5.6 Sol (promo thru 2026-11-21) | $4.00 | $20.00 | — | $0.40 | $2.00/$10.00 | same |
| GPT-5.6 Luna | $0.20 | $1.20 | — | $0.02 | $0.10/$0.60 | same |

**Note on aggregator sourcing:** Cerebras, Groq, DashScope, and ai.google.dev figures came back through third-party pricing aggregators (pricepertoken, edenai, oflight, devtk/benchlm) rather than a clean primary-page fetch — WebFetch either wasn't attempted directly or the primary page didn't render cleanly in the time available. Directionally consistent across 2–3 independent aggregators each, but **re-verify against cerebras.ai/pricing, groq.com/pricing, dashscope, and ai.google.dev/pricing directly** before quoting in a client-facing document.

**Embeddings:** OpenAI text-embedding-3-small $0.02, text-embedding-3-large $0.13 (batch $0.01/$0.065) — [openai.com/api/pricing](https://openai.com/api/pricing); Voyage voyage-4-lite $0.02, voyage-4 $0.06, voyage-4-large $0.12, 200M tokens free, batch −33% — [docs.voyageai.com/docs/pricing](https://docs.voyageai.com/docs/pricing); Gemini gemini-embedding-001 $0.15 ($0.075 batch), Gemini Embedding 2 $0.20 — ai.google.dev (via aggregator).

**OpenRouter** ([openrouter.ai/docs](https://openrouter.ai/docs)): 5.5% fee on Stripe top-ups ($0.80 min), 5% on crypto; no per-model markup — pass-through of provider rates. BYOK is fee-free up to $25,000/month list-price inference cost (pay-as-you-go tier) or $200,000/month (enterprise); a 5% fee applies above that threshold.

**DeepSeek peak hours:** 01:00–04:00 and 06:00–10:00 UTC, Mon–Fri = **09:00–12:00 and 14:00–18:00 MYT**, Mon–Fri — i.e. squarely inside the Malaysian working day, confirming §4.1's routing rationale. `deepseek-chat`/`deepseek-reasoner` are legacy aliases retiring 2026-07-24 onto V4.1-Flash's modes — DeepSeek's cheaper Flash refresh the pack flagged as a September 2026 rumor **has already shipped and is the current default**, not a pending re-baseline item.

## 2. What's actually bound today vs. what §4.1 names

`routing/config.ts` diverges from the pack on four of eight tiers:

| Tier | Pack (§4.1) names | Code actually binds | Cost effect |
|---|---|---|---|
| FAST | DeepSeek V4 Flash | **Claude Haiku 4.5** | ~7x pricier input, ~8x pricier output |
| FAST-UI | gpt-oss-120B (Cerebras/Groq) | **Claude Haiku 4.5** | ~3–7x pricier |
| CHEAP | Qwen3.7 Flash | **`deepseek-chat`** (→ V4.1-Flash) | ~5x pricier |
| STRONG_3 (juror) | GPT-5.6 Terra | **`openai/gpt-5.2`** via OpenRouter | input cheaper (−12%), output pricier (+17%) |

DEEP_THINK is also coded as Claude Opus 5 alone, not the pack's "DeepSeek V4 Pro (thinking) → Sonnet 5" cascade — no exploration doc sized DEEP_THINK volume, so it isn't in the recompute below, but it's a real §4 discrepancy.

## 3. Recomputed §4.2 monthly cost

Summing the eight exploration docs' own §8 token estimates (all use their stated tier, off-peak, 0% cache) gives total baseline volumes: CHEAP 280K in/64K out, FAST 84K in/48K out, MID 448K in/141K out, STRONG 278.8K in/85.6K out (drafting+verify+jury+rule-diff). Pricing each tier at its **actual code binding**:

| Scenario | Baseline (USD) | 3× | 10× |
|---|---|---|---|
| **As coded today** (Haiku for FAST/FAST-UI, `deepseek-chat` for CHEAP, GPT-5.2 for STRONG_3), 0% cache | **≈ $2.4** (≈ RM 11) | ≈ $7.3 | ≈ $24 |
| Cache-hit 50% (blended input discount; STRONG_3 has `cacheStrategy: NONE`, unaffected) | ≈ $2.0 | ≈ $5.9 | ≈ $20 |
| Cache-hit 80% | ≈ $1.7 | ≈ $5.1 | ≈ $17 |
| **As the pack describes it** (DeepSeek V4.1-Flash for FAST, Qwen3.7 Flash for CHEAP), 0% cache | ≈ $2.3 | ≈ $6.9 | ≈ $23 |

**The headline finding is not the coded-vs-pack gap (it's under 10% at these volumes) — it's that both numbers are roughly 10–15x below §4.2's own stated USD 25–40 baseline.** Every one of the eight exploration docs independently flagged its own §8 estimate as "a rounding error" or "a sliver" against the pack's aggregate, and the bottom-up sum confirms it: at baseline, actual model spend across all nine action types plus assistant chat is closer to **$2–3/month (RM 9–14)**, not $25–40 (RM 110–180). The pack's baseline appears to be a conservative top-down placeholder that was never reconciled against its own supporting docs' token math. 1,000 assistant turns/month and FAST-UI sub-second calls aren't sized in any exploration doc and could close some of the gap, but would need to be ~15x the size of every other action type combined to do it.

## 4. Vendor-independence problem in the STRONG jury

Confirmed, and priced: STRONG_1 (`claude-sonnet-5`) and STRONG_2 (`claude-opus-5`) are both Anthropic today — 2 of 3 jurors on one vendor, against `ESCALATE_JURY`'s 2-of-3 quorum. A jury built to catch one model's hallucination can't do that when two of its three votes share a provider's training data and failure modes. Rebinding STRONG_2 to Gemini 3.1 Pro (as the pack itself specifies) would also cut that juror's cost: $2.00/$12.00 vs Opus 5's $5.00/$25.00 — roughly 2.5x cheaper on input, 2x on output — while fixing the independence gap for free.

## 5. WhatsApp Malaysia and the 1 Oct 2026 change

Meta's own developer pricing page ([developers.facebook.com/documentation/business-messaging/whatsapp/pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)) distributes country rates as downloadable CSVs rather than inline text; a direct fetch today could not confirm Malaysia-specific figures or an Oct 1 2026 change from the primary source text alone. Multiple 2026 secondary sources (Wati, SendPulse, Respond.io, PickyAssist, Qiscus, Raion Tech — all accessed 2026-09-13) converge on: Malaysia currently ≈ RM 0.35–0.42/marketing message, ≈ RM 0.05–0.07/utility-or-authentication message, service messages free. **Direction correction for §4.3/§4.4: the October 1, 2026 change is not "utility becomes free" — it's the reverse.** Utility-template messages sent inside the 24-hour service window, free since 1 July 2025, become billable again from 1 Oct 2026 at the utility rate; service messages also become billable beyond a new 1,000-free-per-phone-number-per-month allowance. This raises, not lowers, the pack's ≈RM 50/month WhatsApp baseline once Alex's real in-window utility and service volumes are known — **flag for re-verification against Meta's actual CSV rate card before the pack goes out**, per its own Appendix H practice.

## 6. Changes to apply to §4

1. §4.1 FAST/FAST-UI/CHEAP rows: either rebind the code to match the named models, or rewrite the pack to say Claude Haiku 4.5 / `deepseek-chat` — current text and code disagree on 3 of 8 tiers.
2. §4.1 STRONG_3: code uses GPT-5.2 (OpenRouter), not GPT-5.6 Terra; either is defensible, but pick one and match code to prose.
3. §4.1 DeepSeek Flash pricing footnote: V4.1-Flash has already shipped (not a pending Sept 2026 rumor) — update the number and drop the "announced" hedge.
4. §4.2: recompute the USD 25–40 baseline bottom-up from the exploration docs' own §8 estimates (≈$2–3), or explain in-pack why the top-down number is ~10x higher (unsized DEEP_THINK/assistant-turn/juror volume, safety margin, etc.).
5. §4.2/§4.3: add a WhatsApp utility-in-window and service-message cost line effective 1 Oct 2026 — currently unbudgeted and moving the wrong direction from what the pack likely assumes.
6. §4.1 STRONG jury: fix the 2-of-3 Anthropic concentration (rebind STRONG_2 to Gemini 3.1 Pro) — cheaper and restores actual vendor independence.
7. §4.1: add cache-hit/miss and peak/off-peak columns for DeepSeek, and a cache-read column for Anthropic tiers — the current table only shows one blended number per model.
