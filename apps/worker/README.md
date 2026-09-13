# `@trainos/worker`

The Node job worker. It claims rows from `app.outbox` through migration 012's
RPCs, dispatches them by job type, heartbeats while it works, and reports each
outcome back through the same seam. Nothing in this app writes a `core` table
directly — `app.complete_job` reports the 011 effect result from inside its own
transaction, which is what keeps the write-back atomic.

Doc `docs/architecture/08-rpc-pattern-from-showroom.md` §10 is the decision this
implements; §3 is the showroom worker header it copies its shape from.

## Running it

```bash
cp apps/worker/.env.example apps/worker/.env   # then fill it in
npm ci
npm run typecheck -w apps/worker
npm run test -w apps/worker
node --experimental-strip-types apps/worker/src/index.ts
```

`GET /healthz` returns 200 with the loop counters, and 503 once claims have
failed consecutively — a worker that is alive but cannot reach the database is
not healthy, and reporting 200 for it means it is never replaced.

## Why a direct Postgres connection

012 grants the worker surface to `service_role` on functions in the `app`
schema (`012:2718-2727`), and `supabase/config.toml` exposes `public`, `core`
and `graphql_public`. PostgREST therefore cannot reach `app.claim_jobs` under
any key. The worker connects to Postgres directly and does `SET ROLE
service_role` per pooled connection, so the grants 012 wrote are the grants
actually enforced. **The anon key is never used**, and the config refuses to
start if it finds the anon key inside a connection string.

## The claim loop

Concurrency safety lives in SQL. `app.claim_jobs` ranks candidates per tenant,
takes them `FOR UPDATE SKIP LOCKED`, increments `attempts` at _claim_ time and
stamps `claimed_by` with this worker's id. Two workers claiming at once take
disjoint batches, so nothing on the TypeScript side takes a lock or coordinates
with another instance.

The lease is this app's responsibility. Every in-flight job carries a heartbeat
timer that calls `app.heartbeat_job`, and the timer is cleared in `finally` —
the only place, because a heartbeat that outlives its job extends a lease
nobody is working under and defeats `app.reap_jobs`.

| job type          | handler                       | state                                              |
| ----------------- | ----------------------------- | -------------------------------------------------- |
| `AGENT_RUN_SLICE` | `handlers/agent-run-slice.ts` | runs `@trainos/agent-runtime`, checkpoints, yields |
| `SEND_EMAIL`      | `handlers/send-email.ts`      | live behind `RESEND_API_KEY`                       |
| `WHATSAPP_SEND`   | `handlers/whatsapp-send.ts`   | stub; see below                                    |
| `OUTBOX_PUBLISH`  | `handlers/outbox-publish.ts`  | emits the event through `complete_job`             |

A job type with no handler fails as **not retryable**, so it dead-letters with
its real reason instead of burying it under five attempts of backoff.

## Dropping the Edge wall clock, keeping the checkpoints

`packages/agent-runtime` was written against doc 05 §2.6: an Edge Function is
killed at 400s, so a slice budgets 300s and yields. A Railway worker has no
such lifetime, so `DEFAULT_SLICE_WALL_CLOCK_MS` is not what bounds a slice
here — the lease is. `WORKER_SLICE_WALL_CLOCK_MS` defaults to the lease minus a
30s margin for the yield itself.

Checkpoints stay exactly as they are. They are still keyed on the same
`run_id`, still round-trip through JSON, and are still the only reason a run can
outlive the process that started it.

## What migrations 001–012 do not yet provide

1. **No BYOK key storage.** `core.provider_key_status` exists (`003:302`) and
   nothing else: no tenant provider-key table, no Vault reference, no function
   returning a decrypted secret. `WORKER_BYOK_RPC` names the function the
   resolver calls and defaults to `app.provider_key_for_tenant(uuid, text)`,
   which a later migration must supply. Absent, the resolver reports no keys and
   `AGENT_RUN_SLICE` fails with `NO_TENANT_PROVIDER_KEY` rather than falling
   back to a process-wide key.
2. **No re-enqueue RPC.** `service_role` can claim, heartbeat, complete, fail,
   reap, cancel, replay a dead letter and enqueue _effect-derived_ jobs. Nothing
   puts _this_ row back on the queue for a later slice, so a yielded slice
   reschedules through a retryable `app.fail_job` under the code
   `SLICE_YIELDED`. It works, and it costs an attempt — a multi-slice run needs
   `max_attempts` headroom, because `attempts` increments at claim time.
3. **No checkpoint table.** The store is injected and defaults to the in-process
   one, so a resume only works within a single worker until a durable store
   exists.
4. **No `AGENT_RUN_SLICE`, `WHATSAPP_SEND` or `OUTBOX_PUBLISH` in
   `app.job_type_map`.** 012's map produces `SEND_EMAIL`, `NOTIFY_OWNER`,
   `PUSH_INVOICE`, `HRDC_PACKET_ASSEMBLE`, `COMPLIANCE_CHECK_EVALUATE` and
   `USAGE_ROLLUP`. Three of this worker's four types have no producer yet, and
   five of the map's six have no handler — `UNIMPLEMENTED_012_JOB_TYPES` names
   them, and `WORKER_JOB_TYPES` is how a deployment avoids claiming them.
5. **No WhatsApp allowance ledger.** Showroom's header is explicit that
   mark-sent-and-consume must be one transaction and that a "PostgREST two-step"
   cannot replace it. Without that RPC the handler refuses rather than sending
   without the allowance arithmetic.
6. **The six-minute lease cap is an Edge artefact in SQL.** `app.claim_jobs`
   and `app.heartbeat_job` both raise above `interval '6 minutes'`, citing the
   Edge runtime's wall clock. The cap is harmless for a heartbeating worker, but
   it is the one place the Edge assumption is still load-bearing.
7. **No pg_cron schedule.** Doc 08 §10 puts `reap_jobs` on migration 015. Until
   that lands the worker sweeps on `WORKER_REAP_INTERVAL_MS`.

## Tests

`npm run test -w apps/worker`. The SQL functions are mocked at the transport
(`test/fake-transport.ts`), not at `JobsRpc`, so every test sees the real
statement text and the real bound parameters — which is the part that has to
match 012 exactly.
