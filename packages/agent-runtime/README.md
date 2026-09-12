# @trainos/agent-runtime

A provider-agnostic agent runtime. Bring your own key — Anthropic, OpenRouter,
DeepSeek, or any OpenAI-compatible endpoint — and the same orchestrator runs
against it with no code change. Every tool call goes through a mock adapter
over fixture data, and every run emits an `AutomationRun` in exactly the shape
`GET /v1/runs/{id}` returns, so the M18-S04 trace viewer and the M02 approval
inbox show genuine agent output rather than a fixture of one.

```
npx tsx src/cli.ts run lead-to-proposal --provider auto
npx tsx src/cli.ts providers
```

## BYOK setup

Put one key in `.env.local` at the repo root. Any one of these works; the
runtime picks the first it finds and falls back to a scripted mock when it
finds none.

| Variable | Provider | Base URL |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic direct | `https://api.anthropic.com` |
| `OPENROUTER_API_KEY` | OpenRouter | `https://openrouter.ai/api/v1` (override with `OPENROUTER_BASE_URL`) |
| `DEEPSEEK_API_KEY` | DeepSeek | `https://api.deepseek.com` (override with `DEEPSEEK_BASE_URL`) |
| `OPENAI_COMPATIBLE_API_KEY` + `OPENAI_COMPATIBLE_BASE_URL` | anything speaking `/chat/completions` | yours |

Keys are read only by `EnvKeyStore`, are never logged, never persisted, and
never appear in a trace. `maskKey` renders them as `sk-ant-••••••••••••9a41`,
the §17 `ProviderKey.maskedKey` shape, so the CLI and M20-S21 display the same
string.

`npx tsx src/cli.ts providers` prints what this machine can actually reach.

## The provider matrix

| Adapter | Wire format | Tools | Cost | Cache signal |
|---|---|---|---|---|
| `AnthropicProvider` | `POST /v1/messages`, `x-api-key`, `anthropic-version: 2023-06-01` | `{name, description, input_schema}`; results are `tool_result` blocks in a **user** turn | from the price table | `usage.cache_read_input_tokens` |
| `OpenAICompatibleProvider` | `POST {base}/chat/completions`, `Authorization: Bearer` | `{type:'function', function:{…}}`; `arguments` is a **JSON string** | OpenRouter reports `usage.cost` and it wins; otherwise the table | `prompt_cache_hit_tokens` (DeepSeek) or `prompt_tokens_details.cached_tokens` (OpenRouter) |
| `MockProvider` | none | scripted | zero, honestly | scripted |

Two behaviours worth knowing about:

- **Sampling parameters are dropped for models that reject them.** Claude
  Sonnet 5, Opus 5 and the Fable family return a `400` when `temperature` is
  present. The adapter omits it rather than letting a caller's default break
  every STRONG-tier call.
- **A non-retryable error is not retried against another vendor.** A `400` is
  our bug; repeating it down the fallback chain spends money to get the same
  answer three times and buries the real error.

## How the UI consumes a run

`runAgent()` returns `{ run, haltedBy, approval, provenance, checkpoints, jury }`.
`run` is the `AutomationRun`; everything else is a convenience copy of
something already inside it.

- **M18-S04 trace viewer** reads `run.nodes[]` as a tree via `parentId`, with
  `tier`, `model`, `provider`, `tokens`, `cacheHitRate`, `cost` and
  `durationMs` per node; `run.events[]` for the event rows; `run.stateCard`
  for the state-card panel and the budget bars.
- **`haltedBy` on the halted node** is what proves nothing was sent. It carries
  `{policyId, approvalRequestRef, reason}` and links the trace to M02-S02.
- **M02 approval inbox** reads `approval` — `ref`, `policyId`, `approverRole`,
  `assignedTo`, `slaDueAt`.
- **The AI badge** renders `provenance` exactly: `origin`, `confidence`,
  `tier`, `model`, `provider`, `cacheHitRate`, `jury`, `sources`.

## What the runtime guarantees

Whatever a model does inside a node:

1. **Every write goes through `actions.perform`.** There is no other way for an
   agent to change anything, which is why a policy can stop it at all.
2. **The action's value is read from the record, not from the model.** The
   quotation's `proposalValue` is what the gate compares to a threshold, so an
   agent cannot understate a proposal to slip under APV-01.
3. **Being stopped is success.** `status: HALTED` with a `haltedBy` is the demo
   working. A run that sends a proposal without an approval is the bug.
4. **A node that fills 60% of its context hands off rather than truncating.**
   It rewrites its messages from the state card and restarts, and the trace
   records which nodes were restarted.

## The demo chain

`lead-to-proposal`: ENQ-2026-0912 → Reader → Matcher → Drafter → Verifier →
`PROPOSAL_SEND` → APV-01 → APV-2026-0771, halted.

The fixture data is fixed, so the *shape* is reproducible — four sub-agents, a
jury, a policy halt. What the models say inside each node varies, which is the
point.

`--provider mock` is not a stub. It runs the same orchestrator, the same tool
executions against the same fixture data, the same routing decisions and the
same jury; only the language is scripted. Costs report as zero because nothing
was spent, and each node names `mock-model` rather than the tier's model —
a trace that claimed `claude-sonnet-5` on a run that never called Anthropic
would be worse than useless.

## Routing

`DEFAULT_ROUTING_CONFIG` maps action types to tiers in exactly the shape
`GET /v1/ai/routing` returns, so that endpoint's response drops in unchanged.
Tier *bindings* are this package's addition: the contract names a model for
display, a call needs an id, and the context window drives the handoff
threshold.

A tier that errors or has no key falls down its chain, and the fall is recorded
as an `ESCALATION` — a substitution the trace hid would make the M20-S20
degradation banner a lie. A tripped budget cap throws before the spend, never
after.

## Jury

`GATE` runs at promotion time against the golden set and refuses to run inside
a live run. `SAMPLE` runs after the human decides and never blocks. `ESCALATE`
blocks only when a trigger fires: confidence below 0.70, value above
RM 50,000, or first-of-kind (DECISIONS §2).

Jurors are polled in sequence, and a tier that has already voted under another
name is skipped — two jurors served by the same fallback are one opinion
counted twice. An unparseable verdict counts as **dissent**: a jury that fails
open stops working the day a model changes its formatting.

## Tests

```
npm test -w packages/agent-runtime          # vitest, no network
npm run typecheck -w packages/agent-runtime
```

One live test is opt-in and skips unless a key is present in the environment.
It makes exactly one real call.

## Where the fixtures come from

`src/fixtures/local-client.ts` is a stand-in until `@trainos/fixtures` exports
`createFixtureClient`. Every reference in it is a canonical id from
`@trainos/contract`'s `fixtures-ids`, so the two datasets describe the same
records. `src/tools/fixture-adapter.ts` is the single file that changes when
the real client lands.
