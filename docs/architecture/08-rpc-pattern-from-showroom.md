# The Wishes RPC pattern, and how TrainOS should adopt it

Read-only scout of `/Users/khumeren/Repos/personal-work/showroom` (reference, "Wishes2Vows")
and `/Users/khumeren/Repos/personal-work/trainos` (target). Nothing was written to either repo.

---

## 1 · showroom — how the browser talks to Supabase

### 1.1 The client

`/Users/khumeren/Repos/personal-work/showroom/src/lib/supabase.ts`

One module-cache singleton, `createClient(VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY)`.
Exactly three auth options are set, each with a written reason: `flowType: "pkce"` (the
auth-js default is `implicit`, which returns the token in the URL fragment),
`detectSessionInUrl: true` (the only thing that exchanges `?code=` for a session), and
`persistSession: true` (PKCE writes the `code_verifier` to storage before the redirect).
`storageKey` is deliberately left defaulted — overriding it renames the localStorage entry
and signs out every existing operator on deploy. A second GoTrueClient on the same storage
key is treated as undefined behaviour, so nothing else may call `createClient`.

There are **no generated types**. No `supabase gen types`, no contract package, no codegen
step in `package.json`.

### 1.2 The two RPC wrappers

`/Users/khumeren/Repos/personal-work/showroom/src/lib/rpc.ts` (256 lines) is the only
place `supabase.rpc()` is called. Two entry points:

- `rpc(name, args)` — standard RPCs.
- `rpcEnvelope(name, args)` — keyset-paginated RPCs; lifts `hasMore` and `nextCursor`
  to the result level so callers do not dig through the envelope. Terminal pages omit
  `nextCursor` in SQL, so the wrapper normalises `undefined → null`.

Both return a **tuple, never a throw**: `{ data, error }`. The decision is documented as
matching the existing caller idiom and preserving domain error codes.

Errors split two ways:

| kind | source | shape |
|---|---|---|
| `domain` | `{ success: false, error: {...} }` from the RPC body | `{ kind, code, message, field?, details? }` |
| `transport` | network, PostgrestError, `RAISE EXCEPTION` | `{ kind, postgrestError }` |

`toDomainError` projects `code` / `message` / `field` onto named fields and **collects
everything else into `details`**, so a new diagnostic key reaches its caller without a
second edit to the wrapper.

`isMissingRpcFunction(error)` matches `PGRST202` and `42883` on **code, never message
text** — a missing function is a deployment fact that must degrade a feature to
"unsupported", not to a generic failure.

### 1.3 The unwrap rule (the load-bearing detail)

Four response shapes collapse to one behaviour:

```
Shape 1    { success: true, data: T }                  → unwrap to T
Shape 1+E  { success: true, data: T, extra1, extra2 }  → pass through { data, extra1, extra2 }
Shape 2    { success: true }                           → pass through {}
Shape 3    { success: true, count, items }             → pass through { count, items }
raw        text[] / scalar, no envelope                → pass through as T
```

**Rule: strip `success`; if exactly one key `data` remains, unwrap it; otherwise pass the
rest through.** This is the whole incident class — adding a sibling key beside `data`
silently flips every caller from auto-unwrap to pass-through. See
`docs/postmortems/2026-04-28-get-ticket-envelope.md` in showroom.

### 1.4 Types and runtime contract checking

- `src/lib/rpc.types.ts` — a hand-maintained `RpcMap` interface, 2010 lines, one entry
  per RPC with `args` and `response`.
- `src/lib/rpc.contract.ts` — `finalize(name, value)` is declared **the only legal
  `as RpcMap[...]` cast site**. It is guard-only: validates against a registered zod
  schema, reports a mismatch, and always returns the original value.
- Two schema tiers. `SPINE_RESPONSE_SCHEMAS` (the five public RPCs a guest page cannot
  render without) are checked **unconditionally, including production**;
  `DEV_RESPONSE_SCHEMAS` sit inside an `import.meta.env.PROD` guard so Vite dead-codes
  them and the modules stay tree-shakeable.
- The dev/prod asymmetry is deliberate: dev **throws**, production **logs and passes the
  value through**, because the failure being defended against is a render-path crash on a
  live wedding day. The prod logger uses `globalThis.console?.error?.` because
  `vite.config.ts` sets esbuild `drop: ["console"]`, which only matches the bare
  `console` identifier.
- Violation reports are **structure only, never values** — `issue.message` is excluded
  because zod interpolates the received value into enum and literal messages.

### 1.5 Idempotency

No `Idempotency-Key` header, no generic mechanism. It is per-RPC and lives in SQL:
`wish_hearts` dedups on `digest(client_token, 'sha256')`; edit tokens are stored as
`edit_token_hash` (SHA-256), never raw. Ten migrations reference `client_token`.

---

## 2 · showroom — the SQL side

### 2.1 Where functions live and how they are secured

All RPCs live in `public`, named `verb_noun` (`submit_rsvp`, `get_wishes`) or
`admin_verb_noun` (`admin_get_rsvp_list`). There is **no `app` schema** and no envelope
builder function: 265 hand-written `jsonb_build_object('success', ...)` sites across the
migration set.

`/Users/khumeren/Repos/personal-work/showroom/supabase/CLAUDE.md` states five mandatory rules:

1. Every RPC is `SECURITY DEFINER` with `SET search_path = public, extensions`.
   Measured: **410 `SECURITY DEFINER` against 4 `SECURITY INVOKER`.**
2. Admin RPCs check `SELECT 1 FROM admin_users WHERE user_id = auth.uid()`.
3. `GRANT EXECUTE` to `authenticated` only — never `anon` for admin RPCs. The two
   guest-facing writes (`submit_rsvp`, `submit_wish`) are the deliberate
   `anon, authenticated` exceptions.
4. RLS on every table, with `REVOKE ALL FROM PUBLIC, anon, authenticated`.
5. **Never allow direct table access from the client — RPC-only.**

Tenant and identity come from `auth.uid()` plus a `_is_wedding_admin(p_wedding_id)`
helper introduced in migration 036; 465 references to `auth.uid()` / `auth.jwt()` /
`request.jwt.claims` across the set. Admin RPC arg types make `p_wedding_id: string`
**required** in TypeScript so a missing tenant is a compile error.

### 2.2 Migration, test and rollback conventions

- Sequential `NNN_snake_name.sql`, 119 files, currently at 124 with gaps (108, 111–116,
  122–123 were authored but never landed).
- Every migration opens with a long prose header: the defect, the measured production
  blast radius, what it does and explicitly what it does **not** do, why this mechanism
  and not the house alternative, and two trailing pointers — `ROLLBACK:` and `PIN:`.
- `BEGIN; SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '60s';`
- Paired `supabase/rollbacks/NNN_*_rollback.sql` and `supabase/tests/test_NNN_*.sql`.
- An auto-maintained `supabase/migrations/migration-catalog.md` with one Detail section
  per migration, including `### Envelope`, `### Client compat`, `### Auth / security`
  and `### Deploy coupling` subsections.
- Compatibility rule: any migration touching a client-visible RPC must list affected
  RPCs, `RpcMap` entries, frontend callers, reload/edit paths and deploy coupling in its
  header, and run `npm run check:rpc`.

---

## 3 · showroom — background and scheduled work

**Showroom does use Edge Functions.** Six of them, in
`/Users/khumeren/Repos/personal-work/showroom/supabase/functions`: `stripe-webhook`,
`create-studio-checkout`, `finalize-studio-checkout`, `whatsapp-send`, `whatsapp-webhook`,
`wa-topup-checkout`, plus `_shared`.

**There is no applied pg_cron.** The only in-repo references are in docs and in one
function header. Migrations 111–116, which would have created the WhatsApp queue tables
and the `whatsapp_send_schedule` cron job, were authored but never landed — the migration
directory jumps 110 → 117.

The intended worker shape is documented in the header of
`/Users/khumeren/Repos/personal-work/showroom/supabase/functions/whatsapp-send/index.ts`,
and it is the part worth copying wholesale:

- Three **server-side-only** helper RPCs that are explicitly *not* part of the client
  contract and never `RpcMap`-declared.
- `whatsapp_claim_batch(p_limit)` — `FOR UPDATE SKIP LOCKED`, flips rows to `sending` and
  increments `attempts` in one transaction. Concurrent worker invocations are safe
  because the claim RPC owns SKIP LOCKED.
- `whatsapp_mark_message_sent` — message → `sent` **and** allowance `consumed += 1` in one
  transaction.
- `whatsapp_mark_message_failed` — terminal failure credits the allowance back in the same
  transaction.
- Explicit warning against letting a "PostgREST two-step" replace these, because the
  allowance math only holds under concurrency inside one transaction.
- Retry classification on Meta error codes plus HTTP 429/5xx; pacing env var tuned under
  the provider rate cap.
- A named deploy-order trap: SQL first, then the function, then the schedule
  ("edge-deploy-skew"), guarded by `npm run check:edge`.

Research in showroom's docs settles the blessed Supabase alternative: pg_cron +
`net.http_post()` + Vault. It also records why that shape constrains the design — pg_net
is **fire-and-forget with a ~5s effective timeout**, so the cron side can never observe
the outcome; the function must be the system of record (respond 202, work inside
`EdgeRuntime.waitUntil()`, persist its own results, self-report failure), and
`cron.job_run_details` only proves the POST fired. A Render worker was the primary plan
for WhatsApp, with pg_cron + Edge Function named as the fallback.

Hosting: Render static site (`render.yaml`), with `frame-ancestors 'self'`,
`X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`,
`X-Content-Type-Options: nosniff`, and SPA rewrites. `buildCommand` runs
`npm run verify:deploy` before `build`.

---

## 4 · showroom — realtime, storage, and the hook layer

- **Realtime: none.** Zero `.channel(`, `postgres_changes` or `removeChannel` in `src`.
- **Storage: direct from the browser.** `storage.from()` in feature code for image, audio,
  opening-media and legal-doc uploads. Migration 117 closed anon storage uploads;
  buckets were added per feature (083 legal docs, 092 card media, 095 card audio).
- **React Query**, one shared client in `src/lib/queryClient.ts`: `queries { retry: 1,
  staleTime: 30_000 }`, `mutations { retry: 0 }`, and a `MutationCache` that toasts only
  when a mutation opts in with `meta.toastOnError`. 43 files use `useQuery`/`useMutation`.
  Hooks are colocated per feature (`src/features/studio/hooks/…`) with a small shared set
  in `src/shared/hooks`. Hooks call `rpc()` / `rpcEnvelope()` directly — there is no
  intermediate typed client object.

---

## 5 · showroom — the CI gate, and how TrainOS's differs

`npm run check:rpc` → `/Users/khumeren/Repos/personal-work/showroom/scripts/rpc-contract-check.js`.

It is **`RpcMap`-driven and knows nothing about a `client.ts`**. Four stages:

1. Parse every `NNN*.sql` migration, extract each function body by dollar-tag, and record
   the *latest* success-envelope key set per function name. A schema qualifier is captured
   and discarded so `public.save_studio_draft` files under `save_studio_draft` — without
   that, qualified definitions filed under the bogus name `public` and the audit silently
   read a stale unqualified definition, a false green.
2. Parse `src/lib/rpc.types.ts` for the `RpcMap` entries and their declared `response`.
3. Scan `src/` for consumer cast sites, skipping `rpc.ts` and `rpc.types.ts`.
4. Classify each entry PASS / WATCH / BROKEN — the key case being "Shape 1+extras envelope
   but `RpcMap.response` is flat", which means the wrapper returns `{data, ...siblings}`
   and the consumer cast produces undefined fields at runtime.

Exit 0 on PASS/WATCH, 1 on any BROKEN, 2 on tool error. Sibling gates:
`check:grants`, `check:applied`, `check:edge`, `lint:sql`, `typecheck:strict`, `sast`.

**TrainOS's `scripts/check-rpc-contract.mjs` is a stricter descendant, not the same gate.**
It drops the `RpcMap` parsing and adds three lettered checks:

- **E1 — envelope.** Any `jsonb_build_object('success'` outside the migration that
  *defines* `app.ok` / `app.err` is BROKEN. Documented limitation: a function that RAISES
  instead of returning an envelope is invisible to E1, as is anything served by PostgREST.
- **E2 — casts.** Any `as unknown as` under `apps/web/src/shared/api` is BROKEN.
- **E3 — type source.** Requires `apps/web/src/shared/api/client.ts` to exist. Parses
  `import type { … } from "@trainos/contract"` for the allowed type names, then matches
  methods with `/^ {2}([a-zA-Z0-9_]+)\(([^)]*)\):\s*([^;]+);/gm` and requires each return
  type to match `Promise<Result<…>>` with every capitalised identifier inside either
  imported from the contract or the literal `Result`.

Today E3 is **BROKEN**: `client.ts` does not exist.

---

## 6 · trainos — what already matches the pattern

- **Envelope builders exist.** `app.ok(jsonb)` and `app.err(text, jsonb)` at
  `/Users/khumeren/Repos/personal-work/trainos/supabase/migrations/001_foundation_schemas_and_helpers.sql:392`
  and `:408`, both revoked from `PUBLIC, anon, authenticated`. This is the thing showroom
  never had and the reason E1 can be enforced.
- **Schema split.** `app` (gate, helpers, resolver) and `core` (domain), created at
  `001:170-171`. `app` is deliberately absent from PostgREST's exposed schemas;
  `supabase/config.toml:18` exposes `["public", "core", "graphql_public"]`.
- **Definer discipline, harder than showroom's.** Functions are `SECURITY DEFINER` with
  `SET search_path = ''` (empty, not `public, extensions`) and fully `pg_catalog.`-qualified
  bodies, plus `SET statement_timeout` on the gate.
- **The action gate is written.** `app.perform_action(p_type, p_target_ref, p_payload,
  p_requested_by, p_confidence, p_reasoning, p_evidence, p_idempotency_key) RETURNS jsonb`
  at `011_action_envelope_and_policy_gate.sql:1978`, with `app.plan_effects`,
  `app.apply_effects`, `app.execute_in_database_action`, `app.decide_approval`,
  `app.bulk_decide`, `app.report_effect_result`, idempotency keys, autonomy ceilings and
  state-transition enforcement.
- **Column-level lockdown.** `011:1357-1371` revokes `UPDATE` on every status/stage/
  sync_state column from `anon, authenticated, service_role` — status only moves through
  the gate.
- **The outbox and job queue are already written**, in
  `012_events_outbox_and_jobs.sql`: `core.events`, `core.event_subjects`,
  `app.event_redactions`, `app.event_subscriptions`, `app.outbox`, `app.job_type_map`,
  `app.dead_letters`, `app.submission_counters`, plus `app.emit_event`,
  `app.enqueue_effect_jobs`, `app.claim_jobs(p_worker, …)`, `app.heartbeat_job`,
  `app.complete_job`, `app.fail_job`, `app.reap_jobs`, `app.cancel_jobs`,
  `app.replay_dead_letter`, `app.jobs_health`. `service_role` gets EXECUTE on exactly the
  worker surface and nothing else — not `emit_event`, which the worker reaches through
  `complete_job`.
- **Provider idempotency** is first-class: `app.provider_idempotency_key(…)` and
  `app.next_submission_attempt(tenant, subject)` — stronger than showroom's per-RPC
  client-token dedup.
- **Migration conventions already match** showroom's: numbered files, long prose headers
  with lettered findings (H-17, M-15), a `migration-catalog.md`, and
  `scripts/check-grants.mjs` / `check-sql-parse.mjs` / `guard.mjs`.
- **`packages/agent-runtime` does not need an Edge worker.** Its default entry is
  browser-safe by construction — nothing reachable from `src/index.ts` imports a Node
  builtin or touches `process` unguarded, node-only helpers live behind the
  `./node` subpath export, and a test walks the module graph to keep it that way. The web
  app imports it directly to run the mock agent.

## 7 · trainos — what does not match yet

1. **Nothing is callable from a browser.** `app.perform_action`, `app.decide_approval`,
   `app.bulk_decide` and `app.report_effect_result` are granted to **`service_role` only**
   (`011:3408-3415`), and `app` is not a PostgREST-exposed schema. There is currently no
   path from the client to the gate at all.
2. **No `client.ts`.** `apps/web/src/shared/api` holds `errors.ts`, `index.ts`,
   `queryClient.ts`, `queryKeys.ts`, `useApi.ts`, `useOpportunityIndex.ts`,
   `useOrganisationDirectory.ts` and `__tests__`. Gate E3 is BROKEN until `client.ts`
   exists.
3. **No `useAction.ts`.** The action seam the contract is built around has no hook.
   The task brief names it as a seam; it is not on disk.
4. **The data seam is still fixtures.** `apps/web/src/shared/api/useApi.ts` mounts a
   `FixtureClient` singleton through `ApiProvider`, maps shell `Role` → fixture principal
   via `ACTOR_FOR_ROLE`, signs in **during render** (deliberately, so the first `queryFn`
   asks as the incoming principal) and invalidates the React Query cache on role change.
   Its own docblock states the intent plainly: *"Swapping the fixture client for an HTTP
   one is now a change to this file."* That is the single seam to cut over.
5. **No RPC layer between the contract and the database.** `packages/contract` describes
   115 HTTP endpoints under `/v1`; `supabase/migrations` describes an `app`/`core`
   database. Nothing maps one onto the other.
6. **The contract's envelopes are richer than a PostgREST row.** `ListResponse<T>` carries
   `data` + `page { next, total }` + `appliedFilters`; every entity carries
   `EntityEnvelope` and optional `Provenance` (origin, confidence, agentId, runId,
   sources, tier, model, provider, cacheHitRate, jury). None of that composes from a flat
   table read.
7. **Idempotency is header-based in the contract** (`Idempotency-Key`,
   `Idempotent-Replay`, 24-hour retention, `IDEMPOTENT_REPLAY` → 409) but
   **parameter-based in SQL** (`p_idempotency_key` on `perform_action`). The client
   wrapper has to bridge the two.
8. **Error taxonomy is richer than showroom's domain/transport split.** Ten codes with
   fixed HTTP statuses, two of which are not failures: `POLICY_APPROVAL_REQUIRED` is a
   202 carrying `approvalRequestId`, `SLA_BREACHED` is a 200 surfaced as a flag. The
   wrapper must not collapse those into an error branch.
9. **`012` assumes a `net.http_post` worker tick** ("the worker tick is a fire-and-forget
   `net.http_post` whose response lands in pg_net's unlogged table that nobody queries",
   `012:2177`), with migration **015** named as the owner of the `jobs-health` and reaper
   schedules. 015 does not exist yet, which means the scheduling decision is still open.
10. **Migrations are authored, not applied.** `config.toml` leaves `project_id` commented
    out on purpose so a stray `supabase db push` cannot find a target.

---

## 8 · (a) The 115 endpoints in three buckets

Bucketing rule used: a read goes to **PostgREST** only when one view row maps 1:1 onto the
contract shape with no `page`/`appliedFilters` envelope and no provenance composition;
everything else that can be answered inside one transaction is an **RPC**; anything that
must call an external service, accept an inbound HTTP request, or run longer than a
request needs a **worker**.

| Bucket | Count |
|---|---|
| PostgREST table/view reads | 22 |
| RPCs | 80 |
| Needs a worker | 13 |
| **Total** | **115** |

### PostgREST view reads — 22

`GET /v1/templates` · `GET /v1/policies` · `GET /v1/policies/{id}` ·
`GET /v1/config/pipelines` · `GET /v1/views` · `GET /v1/trainers` · `GET /v1/contacts` ·
`GET /v1/contacts/{id}` · `GET /v1/contacts/{id}/consent` · `GET /v1/programmes` ·
`GET /v1/programmes/{id}` · `GET /v1/programmes/{id}/deliveries` ·
`GET /v1/organisations/{id}/relations` · `GET /v1/hrdc/deadlines` ·
`GET /v1/collections/rules` · `GET /v1/compliance/rules` ·
`GET /v1/compliance/rules/{id}` · `GET /v1/compliance/rule-changes` · `GET /v1/evals` ·
`GET /v1/knowledge/sources` · `GET /v1/ai/tiers` · `GET /v1/ai/budgets`

Each needs a `core.v_*` view with RLS and a `SELECT` grant to `authenticated`. Note this
is the one place TrainOS deliberately departs from showroom rule 5 ("RPC-only"), and it is
already licensed by `config.toml` exposing `core`.

### RPCs — 80

Everything else. The three drivers are the `ListResponse` envelope, provenance
composition, and the fact that every write goes through the gate. Notably:

- All writes route through **one** endpoint, `POST /v1/actions` → `core.perform_action`.
  The 30-odd `ACTION_TYPES` are payload discriminators, not endpoints.
- The four AI-draft reads — `GET /v1/follow-ups/{id}/draft`,
  `GET /v1/organisations/{id}/suggestions`, `GET /v1/tnas/{id}/recommendations`,
  `GET /v1/collections/{invoiceRef}/draft` — stay RPC **reads of worker-produced rows**.
  They must never generate on demand inside a request.
- `SSE /v1/events` is **Supabase Realtime on `core.events`**, not a worker and not an RPC.
  This is new ground: showroom uses no realtime at all.
- `GET /v1/{resourceType}/{id}/audit` and `GET /v1/search` are RPCs over `core.events`
  and full-text search respectively.

### Needs a worker — 13

| Path | Why |
|---|---|
| `POST /v1/proposals/{id}/sections/{n}/regenerate` | LLM call, longer than a request |
| `GET /v1/proposals/{id}/preview` | PDF render |
| `GET /v1/engagements/{id}/attendance/export` | file generation |
| `GET /v1/hrdc/packets/{id}/export` | packet assembly |
| `POST /v1/webhooks/email` | inbound HTTP, signature verification |
| `POST /v1/webhooks/whatsapp` | inbound HTTP, signature verification |
| `POST /v1/webhooks/proposal-accepted` | inbound HTTP |
| `POST /v1/webhooks/accounting` | inbound HTTP |
| `POST /v1/ai/providers/{id}/test` | outbound call to the provider |
| `POST /v1/ai/providers/{id}/rotate` | secret handling outside the database |
| `POST /v1/ai/providers/{id}/reveal` | decryption with a server-held key |
| `POST /v1/knowledge/sources/{id}/check` | fetches an external URL |
| `POST /v1/knowledge/sources/{id}/reingest` | crawl plus embedding, long-running |

Everything with an *external side effect* that is triggered by a user — `PROPOSAL_SEND`,
`INVOICE_PUSH`, `REMINDER_SEND`, `FOLLOWUP_SEND`, HRDC submission — does **not** appear
here, because it enters through `POST /v1/actions` and lands in `app.outbox`. The worker
drains the queue; the endpoint stays an RPC. That is exactly the split `012` was built for.

---

## 9 · (b) The shape `client.ts` must take

One file at `/Users/khumeren/Repos/personal-work/trainos/apps/web/src/shared/api/client.ts`.
The gate parses it textually, so the formatting below is load-bearing:

- a **single** `import type { … } from "@trainos/contract"` block (E3 reads only the first
  match and treats its names as the entire allowed set);
- a `Result<T>` alias — `Result` is the one capitalised name E3 permits without a contract
  import, so it may be defined locally;
- an interface whose methods are each **one line, two-space indent, ending in `;`**, with
  no multi-line parameter lists and no overloads, since the matcher is
  `/^ {2}([a-zA-Z0-9_]+)\(([^)]*)\):\s*([^;]+);/gm`;
- **every** return type of the form `Promise<Result<T>>`, with every capitalised
  identifier inside `T` present in the import block;
- **no `as unknown as`** anywhere under `apps/web/src/shared/api` (E2).

```ts
import type {
  ActionRequest,
  ActionResponse,
  ApprovalRequest,
  Engagement,
  Enquiry,
  ListResponse,
  Me,
  Opportunity,
  PageRequest,
  Proposal,
  Quotation,
  Tna,
} from "@trainos/contract";

import type { ApiError } from "./errors";

/** The tuple every method returns. Local by design — E3 exempts `Result`. */
export type Result<T> = { data: T; error: null } | { data: null; error: ApiError };

export interface TrainOsClient {
  me(): Promise<Result<Me>>;
  listEnquiries(query: PageRequest): Promise<Result<ListResponse<Enquiry>>>;
  getEnquiry(id: string): Promise<Result<Enquiry>>;
  getOpportunity(id: string): Promise<Result<Opportunity>>;
  getTna(id: string): Promise<Result<Tna>>;
  getProposal(id: string): Promise<Result<Proposal>>;
  getQuotation(id: string): Promise<Result<Quotation>>;
  listApprovals(query: PageRequest): Promise<Result<ListResponse<ApprovalRequest>>>;
  getEngagement(id: string): Promise<Result<Engagement>>;
  performAction(request: ActionRequest): Promise<Result<ActionResponse>>;
}
```

Modelled on showroom's `rpc()`, the implementation behind this interface should:

- own the only `supabase.rpc()` call sites in the app, as `src/lib/rpc.ts` does;
- return the tuple rather than throw, and split `domain` from `transport` errors;
- apply showroom's unwrap rule to `app.ok` output — strip `success`, unwrap a lone `data`;
- **not** route `POLICY_APPROVAL_REQUIRED` (202 + `approvalRequestId`) or `SLA_BREACHED`
  (200 + flag) into the error branch;
- translate the contract's `Idempotency-Key` header into `p_idempotency_key` on
  `core.perform_action`, and surface a replay as `IDEMPOTENT_REPLAY`;
- match missing functions on code (`PGRST202` / `42883`), never on message text;
- keep a `finalize()`-style guard as the single legal cast site if runtime validation is
  wanted later — but note E2 forbids `as unknown as`, so the guard must be typed as
  `value as T`, not a double cast.

`useApi.ts` is where the swap happens: change `ApiContext`'s default from `fixtureClient`
to the HTTP client and keep the provider's principal-sync and invalidation behaviour.

---

## 10 · (c) Where background work should live

**A Node worker on Render, alongside the web app, running its own loop as `service_role`.**

Reasons, in order of weight:

1. It is **showroom's own primary plan**. The WhatsApp dispatcher was specced as a Render
   worker with pg_cron + Edge Function named only as the fallback. TrainOS rules Edge
   Functions out, so the fallback is unavailable and the primary is the only option left
   standing.
2. It avoids the documented `pg_net` blindness. `012:2177` already records the problem in
   TrainOS's own words: a fire-and-forget `net.http_post` tick lands in an unlogged table
   nobody queries, and nothing reads `cron.job_run_details`. A worker with its own loop
   observes its own outcomes.
3. The database side is **already built for exactly this worker**. `app.claim_jobs`
   takes a `p_worker` instance id and RAISES if a later call does not match it;
   `heartbeat_job` requires `claimed_by = p_worker` plus the tenant; leases are bounded by
   worker lifetime; `service_role` holds EXECUTE on precisely `claim_jobs`,
   `heartbeat_job`, `complete_job`, `fail_job` and nothing more.
4. The four inbound webhooks need a public HTTP origin regardless. They terminate on the
   same Render service, verify signatures there, and write through the gate as
   `service_role` — one deployable instead of two.
5. `packages/agent-runtime` already runs in Node behind its `./node` export, so
   LLM-shaped jobs (section regeneration, knowledge reingest, provider tests) run in the
   same process with no new runtime.

**Keep pg_cron for database-internal sweeps only** — `app.reap_jobs`,
`app.reap_dead_letters`, `app.reap_cron_history`, `app.jobs_health`. These are what
migration 015 should schedule, and none of them makes an outbound call, so pg_net is not
needed at all. Note `app.reap_cron_history` already guards on `to_regclass` and returns 0
where pg_cron is absent, so a retention sweep never fails a tick.

Two conventions to carry over from showroom: worker-only RPCs are **never** part of the
client contract and never appear in `client.ts` (the Edge-function header says this
explicitly), and deploy order is **SQL first, then worker, then schedule** — the
"edge-deploy-skew" trap, which applies identically to a Render worker.

---

## 11 · (d) The first ten RPCs for the golden path, in order

The golden path is enquiry → opportunity → TNA → proposal → quotation → approval →
engagement. Each of these returns `app.ok(...)` / `app.err(...)`, is `SECURITY DEFINER`
with `SET search_path = ''`, lives in `core` (so PostgREST can see it), and is granted to
`authenticated`.

1. **`core.me()`** — session, role, tenant, permissions. Unblocks `ApiProvider` and
   replaces `ACTOR_FOR_ROLE`'s fixture principal with a real one. Nothing else can be
   tested until identity is real.
2. **`core.navigation()`** — sidebar entries and queue badge counts. Uses
   `app.open_approval_count`, which already exists (`011:1588`).
3. **`core.list_enquiries(p_filter, p_sort, p_page)`** — the first `ListResponse`:
   `data` + `page { next, total }` + `appliedFilters`. Establishes the keyset-pagination
   convention, showroom's `rpcEnvelope` shape, for all 30-odd collection endpoints.
4. **`core.get_enquiry(p_id)`** — the first record read that composes `EntityEnvelope` +
   `Provenance`. Establishes how an AI-extracted field is returned.
5. **`core.perform_action(...)`** — a thin `SECURITY DEFINER` wrapper in `core`, granted to
   `authenticated`, that calls `app.perform_action` and passes the caller's identity. This
   is the one that unblocks every write in the app, and the one that needs the most care:
   it must return 202-shaped `POLICY_APPROVAL_REQUIRED` as a success envelope carrying
   `approvalRequestId`, not as an error.
6. **`core.get_opportunity(p_id)`** — the first record with stage, which is column-revoked
   and therefore only movable through the gate. Proves the revoke actually holds.
7. **`core.get_tna(p_id)`** — TNA detail plus its recommendations, reading rows a worker
   produced rather than generating them.
8. **`core.get_proposal(p_id)`** — sections, provenance per section, and the floor-price
   fields the `FLOOR_PRICE_BREACH` error detail bag references.
9. **`core.get_quotation(p_id)`** — exercises the §18 money rule (integer sen, lines are
   truth, totals sum rounded lines, SST on summed net) and `app.round_half_up_sen`, which
   already exists (`001:372`).
10. **`core.list_approvals(p_filter, p_page)`** paired with **`core.decide_approval(...)`**
    — closes the loop opened by step 5. `app.decide_approval` exists and needs the same
    `core` wrapper and grant treatment as `perform_action`.

After these ten, `POST /v1/actions` carries every remaining write, and the rest of the
build is collection RPCs plus the 22 PostgREST views.

---

## 12 · File reference

**showroom**
- `/Users/khumeren/Repos/personal-work/showroom/src/lib/supabase.ts`
- `/Users/khumeren/Repos/personal-work/showroom/src/lib/rpc.ts`
- `/Users/khumeren/Repos/personal-work/showroom/src/lib/rpc.contract.ts`
- `/Users/khumeren/Repos/personal-work/showroom/src/lib/rpc.types.ts`
- `/Users/khumeren/Repos/personal-work/showroom/src/lib/queryClient.ts`
- `/Users/khumeren/Repos/personal-work/showroom/scripts/rpc-contract-check.js`
- `/Users/khumeren/Repos/personal-work/showroom/supabase/CLAUDE.md`
- `/Users/khumeren/Repos/personal-work/showroom/supabase/functions/whatsapp-send/index.ts`
- `/Users/khumeren/Repos/personal-work/showroom/supabase/migrations/migration-catalog.md`
- `/Users/khumeren/Repos/personal-work/showroom/render.yaml`

**trainos**
- `/Users/khumeren/Repos/personal-work/trainos/scripts/check-rpc-contract.mjs`
- `/Users/khumeren/Repos/personal-work/trainos/packages/contract/src/endpoints.ts`
- `/Users/khumeren/Repos/personal-work/trainos/packages/contract/src/envelope.ts`
- `/Users/khumeren/Repos/personal-work/trainos/packages/contract/src/actions.ts`
- `/Users/khumeren/Repos/personal-work/trainos/apps/web/src/shared/api/useApi.ts`
- `/Users/khumeren/Repos/personal-work/trainos/supabase/config.toml`
- `/Users/khumeren/Repos/personal-work/trainos/supabase/migrations/001_foundation_schemas_and_helpers.sql`
- `/Users/khumeren/Repos/personal-work/trainos/supabase/migrations/011_action_envelope_and_policy_gate.sql`
- `/Users/khumeren/Repos/personal-work/trainos/supabase/migrations/012_events_outbox_and_jobs.sql`
- `/Users/khumeren/Repos/personal-work/trainos/packages/agent-runtime/src/index.ts`
