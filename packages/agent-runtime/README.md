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

## Entry points

```ts
import { runAgent, createRuntime } from '@trainos/agent-runtime';        // anywhere
import { loadEnvLocal } from '@trainos/agent-runtime/node';              // Node only
```

The default entry runs in a browser. Nothing reachable from it imports a Node
builtin or touches `process` unguarded, because the web app imports it to run
the mock agent on M18-S04 and a `node:fs` import at module scope fails a Vite
build — at build time, in a file that did not cause it. The `.env.local` reader
is the only Node-only module and lives behind the `/node` subpath.

`test/browser-safety.test.ts` walks the default entry's module graph and fails
if a Node builtin, the dotenv loader or the CLI creeps back in, and runs
`createRuntime` with `globalThis.process` deleted. A convention would not have
held; this is a test.

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

## Slicing: a run outlives one worker

Architecture doc 05 D13 is binding here. An Edge Function worker is killed at
the wall clock, 400s on paid plans, and `EdgeRuntime.waitUntil` does not buy a
longer budget because a background task shares the request's clock. There is no
fifteen-minute job on this runtime, so **a run that cannot checkpoint cannot
exceed 400s, full stop.**

So `runAgent` runs a *slice*, not a run:

```ts
const first = await runAgent({ agent, router, tools, checkpoints: store });

if (first.disposition === 'RESUMABLE') {
  // re-enqueue; the next worker calls:
  const next = await runAgent({ agent, router, tools, checkpoints: store,
                                resumeFrom: first.resumeFrom });
}
```

`runAgentToCompletion(opts)` drives that loop in-process, which is what the
tests and the CLI use.

| Budget | Scope | Default |
|---|---|---|
| `slice.wallClockMs` | per slice — a new worker gets a new clock | 300,000 (doc 05 D13) |
| `slice.tokens` | per slice — a ration on one worker, not the run | unbounded |
| `tokenLimit` | the run's envelope, reported on the state card | 60,000 |

Both slice budgets are **per slice** on purpose. A cumulative budget cannot be
satisfied by starting a new worker, which is the one thing a yield is able to
do, so a resumed slice would start over the limit and yield forever — a
livelock that looks like a healthy queue. For the same reason a slice always
gets at least one model call, however small its budget: one call per slice is
the slowest progress that is still progress.

**A resumed run is the same run.** The checkpoint carries the whole run so far,
serialised, so the next worker continues rather than starting a second one:

- same `id` and `ref` — doc 05 §8.5 requires the re-enqueued job to carry the
  same `run_id`, and a `runId` passed to a resuming call is ignored;
- contiguous node numbering, `n0…nN`, with one root — the resumed slice does
  not plan again;
- `steps[]` still sequential from 1 across the boundary;
- `durationMs` spans every slice;
- a stage that had already finished is inherited, not re-run.

A stage caught mid-flight is the interesting case. Its conversation — messages,
tool results, turns spent, the tier it had escalated to — travels in the
checkpoint, so the next slice picks it up rather than redoing it. A sliced run
makes exactly the same tool calls as an unsliced one, which is asserted. The
partial node is left in the trace as `RETRIED` and the slice that finishes the
stage opens a new node, so the seam is visible rather than hidden.

The 60% context handoff writes the same record with reason `CONTEXT_HANDOFF`
and is resumable like any other. Both are the same move: throw away the
conversation, keep the state card, continue.

A yielded run reports `status: RUNNING` and `outcome: RESUMABLE` on the
`AutomationRun`, because the contract's `RunStatus` has four members and
`RESUMABLE` is not one of them. `RUNNING` is true — it is still running, just
not in this worker — and the disposition rides on the result wrapper, the same
arrangement `haltedBy` uses.

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
5. **A slice yields before its budget is spent, never after.** A budget found
   to be spent after the call that spent it cannot stop the worker being killed
   mid-call.

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
