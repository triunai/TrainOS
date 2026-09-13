# Supabase current documented behaviour — 13 Sep 2026

Lane `rs-supabase`. Sources: Supabase MCP `search_docs`, Context7 `/websites/postgrest_en_v14`,
WebFetch on supabase.com. Read against `docs/architecture/01–05`, `supabase/HANDOFF.md`,
migrations 001/004/009/011 and `packages/agent-runtime/README.md`.

---

## 1 · Edge Functions

Current platform limits ([functions/limits](https://supabase.com/docs/guides/functions/limits)):

| Limit | Value |
|---|---|
| Wall clock (worker lifetime) | 150s Free, **400s paid** |
| **CPU time** | **2s per request** |
| Memory · idle timeout | 256 MB · 150s |
| Function size / count | 20 MB bundled · 500 per project on Pro |
| Secrets | 100 per project, 48 KiB each, no `SUPABASE_` prefix |

**The 400s wall clock still holds, so the 300s slice in doc 05 D13 is still correct.** What our
docs never mention is the second, independent budget: **CPU time is capped at 2s per request**,
measured separately from wall clock, and "a function can run out of CPU time long before wall clock
is exhausted"
([cpu-limits](https://supabase.com/docs/guides/troubleshooting/edge-function-cpu-limits),
[worker-timeouts](https://supabase.com/docs/guides/troubleshooting/edge-functions-worker-timeouts-and-websocket-drops)).
A slice mostly `await`ing a model provider is safe; PII redaction, snapshot hashing and large-jsonb
assembly in the same isolate are not. Exceeding it yields a `546` and a `CPUTime` shutdown.

**`EdgeRuntime.waitUntil` does not extend the wall clock**, as the runtime README says
([background-tasks](https://supabase.com/docs/guides/functions/background-tasks)). The new hazard
is the opposite: **`EarlyDrop`** retires a worker *before* any limit once the HTTP response has
returned and every `waitUntil` promise has resolved. A `job-worker` that acks the cron tick with a
200 and keeps working is killed mid-slice unless the rest is inside `EdgeRuntime.waitUntil`.

Shutdown reasons are now enumerated and logged — `EventLoopCompleted`, `WallClockTime`,
`CPUTime`, `Memory`, `EarlyDrop`, `TerminationRequested` — each with `cpu_time_used` and
`execution_id`
([shutdown-reasons](https://supabase.com/docs/guides/troubleshooting/edge-function-shutdown-reasons-explained)).
`SB_EXECUTION_ID` is the documented idempotency handle for retries, useful for `app.outbox` job
claims; `beforeunload` is where to flush a checkpoint. Function-to-function `fetch` is capped at
~5,000 requests/minute per request chain
([recursive-functions](https://supabase.com/docs/guides/functions/recursive-functions)); external
and inbound calls are not counted.

No cold-start number is published; documented causes are large dependency trees and top-level
`await`. Regional deploy is the `x-region` header or `FunctionRegion`, with `forceFunctionRegion`
for CORS and webhooks; `ap-southeast-1` is supported, a pinned region is **not** re-routed during
an outage ([regional-invocation](https://supabase.com/docs/guides/functions/regional-invocation)).
Local background-task testing needs `[edge_runtime] policy = "per_worker"`.

---

## 2 · PostgREST, RLS and the hidden `app` schema

Everything doc 02 relies on is still current
([rls-performance](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv),
[row-level-security](https://supabase.com/docs/guides/database/postgres/row-level-security)):
wrap every policy function in `(select …)` to force an InitPlan (`auth.uid()` 179ms → 9ms, a
`SECURITY DEFINER` helper 178,000ms → 12ms, and an array helper needs `= any(array(select fn()))`);
index every policy column (171ms → <0.1ms); put `TO authenticated` on every policy (170ms → <0.1ms
for an `anon` caller); push the join into the target table, never `auth.uid() in (join)`
(9,000ms → 20ms, and re-measure past ~1,000 items in the `IN` list); and keep `SECURITY DEFINER`
helpers out of any exposed schema. One item we do not cover: **an `UPDATE` policy needs a matching
`SELECT` policy or the update silently misbehaves** — worth a test_014 sweep.

**Views.** Postgres creates views `security definer` by default, so a view over an RLS table
bypasses RLS; Postgres 15+ needs `with (security_invoker = true)`. Migration 011's
security-invoker view is correct, and the rule should be pinned for 014/015.

**Forced RLS.** Nothing current contradicts `FORCE ROW LEVEL SECURITY`; the escape hatches remain
the secret key and any `BYPASSRLS` role. HANDOFF open ruling 2 stands.

**The hidden-schema pattern is documented behaviour.** PostgREST exposes only the schemas in
`db-schemas` and rejects others with `PGRST106`; a `SECURITY DEFINER` function in an exposed schema
is the sanctioned door into a private one (Context7 `/websites/postgrest_en_v14`,
`references/api/schemas`, `explanations/db_authz`). `NOTIFY pgrst, 'reload schema'` after DDL. So
`app.key_access_audit` behind an RPC is right and must not be "fixed".

---

## 3 · pgvector

- HNSW is recommended over IVFFlat for performance and tolerance of changing data, and can be
  built on an empty table where IVFFlat cannot
  ([vector-indexes](https://supabase.com/docs/guides/ai/vector-indexes),
  [hnsw-indexes](https://supabase.com/docs/guides/ai/vector-indexes/hnsw-indexes)).
- **Index dimension ceilings (pgvector ≥ 0.7.0): `vector` 2,000 · `halfvec` 4,000 · `bit` 64,000.**
  Our `extensions.vector(1536)` with `vector_cosine_ops` (009:198–202) is inside the ceiling. Above
  2,000 dims the documented form is an expression index,
  `USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops)`.
- Build params: `m` 12–48 (default 16), `ef_construction` ≥ 2·`m` (64), `ef_search` 40
  ([going-to-prod](https://supabase.com/docs/guides/ai/going-to-prod)).
- **Tenant filtering is the live risk.** A `WHERE` clause does not bypass an HNSW index, but from
  pgvector 0.8.0 the recovery mechanism is *iterative index scans*, and `hnsw.iterative_scan`
  **defaults to `off`**. With RLS adding a `tenant_id` predicate on top of an HNSW ANN scan, a
  top-k retrieval will silently return fewer than k rows for any tenant that is a small share of
  the table. Set `hnsw.iterative_scan = 'relaxed_order'` (or `strict_order`) in the retrieval RPC;
  `hnsw.max_scan_tuples` defaults to 20,000.
- Compute sizing at 1536 dims
  ([choosing-compute-addon](https://supabase.com/docs/guides/ai/choosing-compute-addon)):
  Micro 1 GB ≈ 15k vectors · Small 2 GB ≈ 50k · Medium 4 GB ≈ 100k · Large 8 GB ≈ 224k ·
  XL 16 GB ≈ 500k · 2XL 32 GB ≈ 1M. Pro ships Micro, so a compliance corpus past ~15k chunks is a
  paid compute step. No current doc states a `maintenance_work_mem` figure for HNSW builds.

---

## 4 · pg_cron and pg_net

**pg_cron** ([cron/quickstart](https://supabase.com/docs/guides/cron/quickstart)): sub-minute
schedules are native on Postgres 15.1.1.61+ using `'30 seconds'` syntax, so doc 05's 10-second tick
is one job, not a staggered set. Job names are case-sensitive and immutable, and re-running
`cron.schedule` with the same name upserts. **`cron.job_run_details` is never purged automatically
and is not cleared when a job is unscheduled** — at a 10s tick, ~3.15M rows/year of pure disk
growth, so it needs its own retention job. No published cap on job count.

**pg_net** ([extensions/pg_net](https://supabase.com/docs/guides/database/extensions/pg_net)) is
still **beta, signatures may change**. Supabase's own guide documents exactly our pattern,
`cron.schedule` → `net.http_post` → Edge Function with the URL and key read from Vault
([schedule-functions](https://supabase.com/docs/guides/functions/schedule-functions)), and confirms
requests do not start until the transaction commits — which is what makes doc 05 D5's nudge safe.
Binding limits: **~200 requests/second**, `timeout_milliseconds` **defaults to 2000**, JSON POST
bodies only, no PATCH/PUT, and both `net.http_request_queue` and `net._http_response` are
**unlogged** with a 6-hour response TTL. Bound the per-row `priority = 1` nudge against 200 rps and
pass an explicit timeout, or a slow worker boot registers as a failure. Supabase Queues (`pgmq`)
remains the documented alternative; nothing invalidates doc 05 D3.

---

## 5 · Vault

API unchanged and still what doc 02 §9 assumes
([database/vault](https://supabase.com/docs/guides/database/vault)):
`vault.create_secret(secret [, unique_name, description])` returns a UUID,
`vault.update_secret(id, secret, name, description)`, read through `vault.decrypted_secrets`.
libsodium AEAD, key held outside the database. Docs are explicit that **anyone with access to
`vault.decrypted_secrets` has the plaintext**, so grants on that view are the whole control — which
fits BYOK. Vault is still **`public alpha`**
([getting-started/features](https://supabase.com/docs/guides/getting-started/features)).

---

## 6 · Branching, preview databases, migration workflow

Recommended shape: develop locally with the CLI, push to GitHub, deploy from `main` via the GitHub
integration. Branching is the optional Pro-plan preview-environment layer and is still **beta**
([deployment](https://supabase.com/docs/guides/deployment)). What deploys is the migrations in
`supabase/` plus Edge Functions and storage buckets declared in `config.toml`; other local config is
ignored. Migration files stay the unit of truth — `db push`/`db reset` are the local loop, not the
deploy mechanism. Preview branches reseed from `./supabase/seed.sql`, rollback is delete-and-reopen,
branches auto-pause so the first request after a pause can time out, and rebases must keep migration
timestamps monotonic
([branching/troubleshooting](https://supabase.com/docs/guides/deployment/branching/troubleshooting)).

---

## 7 · Realtime

Doc 05 D6/D7 holds
([realtime/architecture](https://supabase.com/docs/guides/realtime/architecture)):
broadcast-from-database publishes off `realtime.messages`, **partitioned daily and retained 3
days**, while `postgres_changes` acquires a logical replication slot and replays RLS per subscriber
per row. Status matters: **Broadcast from Database, Broadcast Authorization and Presence
Authorization are all `public beta`**, not GA.

Authorization ([realtime/authorization](https://supabase.com/docs/guides/realtime/authorization)):
RLS on `realtime.messages` is already enabled and the `realtime` schema is locked, so policies are
the only lever. Use `(select realtime.topic())` and filter on `extension in ('broadcast')`.
**Policies are cached for the life of the connection**, recomputed only on connect or on a new
`access_token` message, so a revoked permission does not bite a live socket. Clients must set
`{ config: { private: true } }` and "Allow public access" should be off.

`realtime.send(payload jsonb, event text, topic text, private boolean)` and
`realtime.broadcast_changes(topic, event, operation, table, schema, NEW, OLD)` are the trigger-side
calls ([realtime/broadcast](https://supabase.com/docs/guides/realtime/broadcast)). Realtime connects
as an admin role, so server-side sends are **not** blocked by the RLS insert policy — which is why
doc 05 D15's restrictive `INSERT` deny stops browsers without stopping our triggers. The `private`
flag must match the client, or a public broadcast never reaches a private channel.

Quotas ([realtime/quotas](https://supabase.com/docs/guides/realtime/quotas)): Pro with spend cap
**500 concurrent connections, 500 messages/sec, 500 channel joins/sec, 256 KB payload**, rising to
10,000 / 2,500 / 2,500 / 3,000 KB without the cap. 100 channels per connection on every plan.
Per-user badge channels (D14) multiply channels, not connections, so 100 is the ceiling to watch.

---

## 8 · Pricing today ([supabase.com/pricing](https://supabase.com/pricing))

Pro **$25/month** per organisation including **$10/month compute credits**, covering one Micro.
Compute add-ons: Micro $10 (1 GB) · Small $15 (2 GB) · Medium $60 (4 GB) · Large $110 (8 GB) ·
XL $210 (16 GB) · 2XL $410 (32 GB) · 4XL $960 (64 GB). Egress **250 GB then $0.09/GB**; disk **8 GB
then $0.125/GB**; auth **100k MAU then $0.00325/MAU**; branching **$0.01344 per branch-hour**.
Singapore `ap-southeast-1` is available as a general and a specific region, but general regions are
not yet supported for read replicas or Management API provisioning
([platform/regions](https://supabase.com/docs/guides/platform/regions)).

---

## 9 · Assumption → current reality → action

| Assumption in our docs | Current reality | Action |
|---|---|---|
| 05 D13 / runtime README: 400s wall clock, slice at 300s | Still 400s paid. **CPU time is a separate 2s-per-request budget**, memory 256 MB | **Runtime change** — add a CPU guard to the slice budget; keep per-slice heavy work (redaction, hashing, snapshot assembly) off the isolate |
| Worker runs until the wall clock | **`EarlyDrop`**: an isolate is retired once the response has returned and no `waitUntil` promise is pending | **Runtime change** — `job-worker` must hold the slice in `EdgeRuntime.waitUntil`, and checkpoint from `beforeunload` |
| 009: HNSW over `extensions.vector(1536)`, tenant-filtered | Within the 2,000-dim ceiling, but **`hnsw.iterative_scan` defaults to `off`**, so a tenant predicate silently short-returns top-k | **Migration change** — set `hnsw.iterative_scan = 'relaxed_order'` in the retrieval RPC (009/013) and assert it in a test |
| 05 D5: `pg_cron` 10s tick → `pg_net` → worker, plus a per-row nudge | Supported and documented. But pg_net is **beta**, ~**200 rps**, default timeout **2000 ms**, unlogged queue, 6h response TTL | **Migration change (015)** — bound the priority nudge, pass an explicit `timeout_milliseconds`, treat the queue as lossy |
| cron jobs are self-maintaining | **`cron.job_run_details` is never purged**, not even on unschedule | **Migration change (015)** — add a retention job |
| 02 §9: Vault for BYOK | API unchanged; `vault.decrypted_secrets` grants are the entire control. Vault is still `public alpha` | None; record the alpha status as a risk |
| 05 D6/D7/D15: broadcast from triggers, restrictive insert deny | Correct. `realtime.send` runs as admin, so triggers are unaffected by the deny. But the feature is `public beta` | Doc update — add the `private` boolean to every `realtime.send` call and note the beta status |
| 02 §1.4: revocation bites immediately | True for PostgREST; **Realtime caches policies for the connection lifetime** | Doc update — plus a test_014 sweep for `UPDATE` policies with no matching `SELECT` policy |
| 3.3: Pro (Singapore), pgvector, pg_cron, Vault | All available. Pro's included Micro (1 GB) holds ~15k vectors at 1536 dims | Doc update — the proposal's compute line understates the vector budget |
