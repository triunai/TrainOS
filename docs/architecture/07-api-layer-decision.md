# API layer decision — TrainOS

Lane: api-arch (read-only architecture). Repo: `/Users/khumeren/Repos/personal-work/trainos`, `main` ahead 3.
Question: resume-brief §C. Goal: contracts up and the sales golden path runnable this month, one engineer plus agents.

---

## Recommendation

**Option 1 — PostgREST + SQL RPCs + a small function tier — with the function tier written in
TypeScript on Hono so it runs as a Supabase Edge Function or on Node without a rewrite.**

That is option 1 as the transport with option 3 as the escape hatch. Option 2 is not recoverable
inside this month.

Three findings decide it.

**The repo has already committed to this seam.** `scripts/check-rpc-contract.mjs:14-32` is a
blocking CI gate. It compares database functions to a client at
`apps/web/src/shared/api/client.ts`, requires every jsonb-returning function to build its result
through `app.ok()` / `app.err()` (`supabase/migrations/001_foundation_schemas_and_helpers.sql:392`
and `:408`), and requires every method on `TrainOsClient` to be typed `Promise<Result<T>>` with `T`
from `@trainos/contract`. Run today it reports:

```
BROKEN E3  apps/web/src/shared/api/client.ts
           the client interface is missing.
check:rpc: 3 pass/watch, 1 broken.
```

That gate was written for a Supabase-RPC client. Its own header (line 28-31) says so: "any endpoint
served by the REST API rather than by a database function — until the HTTP client exists, E3 is the
only thing standing between the client interface and the contract." Choosing .NET means deleting a
gate rather than satisfying it.

**The toolchain that exists is Node and psql.** On this machine `docker`, `supabase`, `deno` and
`dotnet` are all absent; `psql 17.11` and `node 24.16` are present. `supabase/CLAUDE.md:165-168`
states it directly: "There is no Supabase CLI or Docker in the authoring environment. Migrations are
executed against a scratch Postgres cluster with a platform shim." Option 2 begins by installing a
runtime nobody on this project has used. Option 3's runtime is already the test runner
(`package.json` `test` script, vitest across three workspaces).

**The write spine is already SQL.** Migration 011 creates `app.perform_action` (line 1978),
`app.decide_approval` (2594) and `app.bulk_decide` (3178). Its header states the property the whole
product rests on: "Every action is evaluated once, logged once, and dispatched to exactly one of
EXECUTED, QUEUED_FOR_APPROVAL or SUGGESTED. The policy input is derived from stored rows, never
trusted from the payload." Idempotency is `app.idempotency_keys` (011:664) inside that function, and
an identical replay returns the original body with status 200 (011 header, M-21). A .NET or Node API
would call these same functions over the same connection. It adds a hop, not a capability.

### The one constraint that applies to all three

`app` is deliberately absent from PostgREST's exposed schemas — `supabase/config.toml:15-17`: "`app`
is deliberately ABSENT: it holds the tenant resolver, the permission lookup and the action gate, none
of which a client may call directly." And 011:3408-3416 grants EXECUTE on the four gate functions to
`service_role` only, after a REVOKE loop strips PUBLIC, anon and authenticated (011:3395-3405).

So `POST /v1/actions` cannot reach the gate from a browser today, under any of the three options.

The cheapest fix, and the one I recommend landing in 014: a thin `core.perform_action` wrapper
granted to `authenticated`. `app.perform_action` is `SECURITY DEFINER SET search_path = ''` and reads
tenant from the caller's own claims via `app.require_tenant_id()` (011:1994), so a wrapper preserves
the caller's identity and widens nothing — `authenticated` remains necessary and never sufficient,
per `supabase/CLAUDE.md` security rule 6, because the body re-checks role and tenant. The same
applies to `decide_approval` and `bulk_decide`.

Without that wrapper, option 1 needs a service-key function in front of every write, and most of its
advantage disappears. This is the single highest-leverage line item in the whole decision.

---

## Comparison

| Axis | 1 · PostgREST + RPC + functions | 2 · ASP.NET 9 + Dapper on Railway | 3 · Hono/Fastify on Node |
|---|---|---|---|
| Endpoint mapping (115 in the spec file) | 59 PostgREST views/tables, 36 RPC, 20 functions | 115 hand-written handlers | 115 handlers, 59 of them trivial proxies |
| Policy gate call site | `core.perform_action` wrapper; browser calls it directly with its own JWT | .NET calls `app.perform_action` as `service_role` | same as 2 |
| Idempotency keys | `app.idempotency_keys` (011:664), already inside the function | reimplement, or call through and inherit | call through |
| Outbox events | migration 012, unwritten — identical work under all three | same | same |
| Agent runtime host | `packages/agent-runtime` unchanged; its 300s slice already matches the Edge limit (`orchestrator/checkpoint.ts:7-9`: "A long handler runs to roughly 300s, writes a checkpoint, re-enqueues itself and returns") | discard the package, adopt Microsoft Agent Framework (.NET) | package reused in-process |
| Auth and RLS | native: the JWT *is* the tenant; `custom_access_token_hook` (002) already mints it | `SET LOCAL request.jwt.claims` per request, or bypass RLS and rewrite tenancy in C# | same as 2 |
| Local dev loop | needs Supabase CLI + Docker, both absent | needs .NET 9 SDK, absent | `npm run dev`, works today |
| Test strategy | SQL pins in `supabase/tests/test_0NN_*.sql` stay the source of truth; vitest drives the typed client against the same fixtures oracle | new xUnit suite; SQL pins become indirect evidence | SQL pins plus the existing vitest suites |
| Migration path out | the contract is the boundary; swap the client's base URL and transport | to 1 or 3 by re-pointing the client | to 1 or 2 the same way |
| Weeks to golden path (1 engineer + agents) | 3–5 | 9–14 | 4–6 |
| Monthly run cost | ~USD 45 (Supabase Pro 25 + transactional email 20) | ~USD 90–135 (adds Railway Pro + usage 45–60, proposal §4.3) | ~USD 70–85 on Railway; ~USD 45 if deployed as Edge Functions |

**Count discrepancy worth reconciling.** `packages/contract/src/endpoints.ts` holds 115 `ENDPOINTS`
rows, not 116: 71 GET, 30 POST, 8 PUT, 3 PATCH, 2 DELETE, 1 SSE. Five are `gated: true` —
`POST /v1/actions`, `POST /v1/invoices`, `PUT /v1/ai/budgets/{scope}/{key}`,
`POST /v1/compliance/rules`, `PUT /v1/compliance/rules/{id}`. Someone should reconcile the number
against API_CONTRACT §13 before it is quoted to a client.

---

## Why not option 2, stated fairly

The proposal's §3.2 reasoning for a modular monolith is sound and none of it is discarded here. The
module boundaries it names (`crm.*`, `training.*`, `compliance.*`, `finance.*`, `automation.*`,
`core.*`) already exist as the schema layout in migrations 001–011. The action envelope, approvals,
audit, outbox and tenancy that §3.2 calls "Core" are 011 and 012. What .NET adds on top is a second
place to express the same rules, in a second language, with a second type system that would have to
mirror `packages/contract/src/enums.ts` (29,144 bytes, generating 69 database enum types per
`supabase/HANDOFF.md:24`) by hand or by generator.

The honest case for option 2 is hiring and longevity: .NET is easier to staff in Malaysia than a
bespoke PostgREST-plus-RPC layer, and Dapper over an RLS-forced Postgres is a well-trodden path. That
case is real. It is a Phase 2 case, not a this-month case.

---

## Endpoints that do not fit PostgREST cleanly

### Need an HTTP function — 20

```
SSE   /v1/events
GET   /v1/follow-ups/{id}/draft
POST  /v1/proposals/{id}/sections/{n}/regenerate
GET   /v1/proposals/{id}/preview
GET   /v1/engagements/{id}/attendance/export
POST  /v1/hrdc/packets/{id}/documents
GET   /v1/hrdc/packets/{id}/export
GET   /v1/collections/{invoiceRef}/draft
POST  /v1/runs/{id}/retry
POST  /v1/runs/{id}/replay
POST  /v1/webhooks/email
POST  /v1/webhooks/whatsapp
POST  /v1/webhooks/proposal-accepted
POST  /v1/webhooks/accounting
POST  /v1/ai/providers
POST  /v1/ai/providers/{id}/test
POST  /v1/ai/providers/{id}/rotate
POST  /v1/ai/providers/{id}/reveal
POST  /v1/knowledge/sources/{id}/check
POST  /v1/knowledge/sources/{id}/reingest
```

Reasons, grouped:

- **Signature verification before parsing.** The four webhooks. API_CONTRACT §11 "Inbound webhooks"
  keys them on `Message-ID`, `messages[0].id`, `token + acceptedAt` and
  `provider + documentId + state`. PostgREST parses the body before any code runs, so an HMAC check
  cannot precede it. Proposal §3.5 also requires inbound email and WhatsApp be treated as untrusted.
- **Binary or rendered output.** The two exports, the packet export, the document upload and the
  proposal preview. PostgREST returns JSON.
- **Secret material.** The four `/v1/ai/providers` write endpoints. `supabase/CLAUDE.md` security
  rule 8: "`ai_provider_key` holds a masked prefix and a hash — the material lives in the platform
  secret store." `/test` additionally makes an outbound call to the provider.
- **Model calls.** Follow-up draft, section regenerate, collections draft, knowledge check and
  reingest. These go through `packages/agent-runtime`.
- **Protocol.** `/v1/events` is SSE per API_CONTRACT §11 "Realtime" (channels `badges`, `approvals`,
  `enquiries`, `runs:{runId}`, `invoices`). Supabase Realtime is a WebSocket. Either a function
  bridges it, or the typed client adapts Realtime to the same `EventBus` surface
  `packages/fixtures/src/client/events.ts` already exposes. The client-side adapter is cheaper and I
  would take it.

### Need a SQL RPC rather than a table read — 36

```
GET   /v1/me                              GET   /v1/receivables/aging      (exists: 010:1026)
GET   /v1/me/profile                      GET   /v1/collections/queue
GET   /v1/navigation                      PUT   /v1/agents/{id}/autonomy
GET   /v1/search                          POST  /v1/agents/{id}/pause
GET   /v1/{resourceType}/{id}/audit       POST  /v1/runs/{id}/dead-letter
POST  /v1/actions                         GET   /v1/dashboards/executive
GET   /v1/organisations/{id}/relations    GET   /v1/metrics/{key}
GET   /v1/organisations/{id}/suggestions  GET   /v1/reports/proposals-vs-won
PATCH /v1/opportunities/{id}              GET   /v1/reports/hours-saved
GET   /v1/tnas/{id}/recommendations       GET   /v1/public/proposals/{token}
POST  /v1/tnas/{id}/reopen                POST  /v1/public/proposals/{token}/comments
POST  /v1/proposals                       POST  /v1/public/proposals/{token}/accept
PUT   /v1/quotations/{id}                 POST  /v1/public/tnas/{token}/submit
POST  /v1/approvals/{id}/decide           GET   /v1/ai/usage/forecast
POST  /v1/approvals/bulk-decide           PUT   /v1/ai/budgets/{scope}/{key}
POST  /v1/engagements/{id}/attendance/{day}/capture
POST  /v1/invoices                        POST  /v1/compliance/rules
POST  /v1/invoices/{id}/payments          PUT   /v1/compliance/rules/{id}
                                          GET   /v1/compliance/checks
```

Reasons, grouped:

- **Claims-derived or polymorphic.** `/v1/me`, `/v1/me/profile`, `/v1/navigation` (role-filtered tree
  plus badge counts), `/v1/search` (⌘K across organisations, proposals and actions — PostgREST cannot
  union tables in one request), `/v1/{resourceType}/{id}/audit` (there is no polymorphic route).
- **Anonymous, token-scoped, no tenant claim.** The four `/v1/public/*` endpoints. These must be
  `SECURITY DEFINER` functions on the anon allowlist — `supabase/CLAUDE.md` security rule 5: "`anon`
  is hostile by default. It holds EXECUTE on exactly the functions in the public-token allowlist
  (client portal) and nothing else." §11 also requires the client-safe projection only: no margin, no
  cost lines, no internal provenance. That filtering belongs in the function, not in a view a client
  could re-query.
- **The gate.** Actions, approval decide, bulk decide.
- **Contract error envelopes.** `PUT /v1/quotations/{id}` must return `FLOOR_PRICE_BREACH` 422 with
  `details.floorPrice`, `details.resultingMargin`, `details.requiresPolicy: "APV-02"` (§1 error
  table). The trigger `core.quotation_assert_floor` (007:896) raises; a function is what turns the
  raise into `app.err()`. Same shape for `ATTENDANCE_LOCKED` 409 on attendance capture, where
  `core.enforce_attendance_day_lock` (008:362) is the trigger.
- **State transitions through the registry.** `/v1/tnas/{id}/reopen`, `PATCH /v1/opportunities/{id}`
  (the contract added `OPPORTUNITY_STAGE_CHANGE` as action type R18), agent autonomy and pause.
  `app.enforce_state_transition` (011:1245) fires on fifteen gated columns whose UPDATE privilege is
  revoked from anon, authenticated and `service_role` (011 header, H-07), so a direct PostgREST PATCH
  is refused by design.
- **Aggregates and composites.** The four dashboard and report endpoints, `/v1/collections/queue`
  (over `core.collection_stage_for`, 010:1095), `/v1/compliance/checks` (over `core.resolve_rules`,
  009:391), `/v1/ai/usage/forecast`, `/v1/organisations/{id}/relations` (six relation types in one
  response).
- **Already written.** `core.receivables_aging` (010:1026) is a `STABLE SECURITY DEFINER` function in
  the exposed `core` schema. It is callable as `/rest/v1/rpc/receivables_aging` the day 014 lands.
  That is the pattern for the rest.

### The remaining 59

Views or tables behind a typed client that reshapes PostgREST's bare array plus `Content-Range` into
the §1 envelope: `{ data, page: { next, total }, appliedFilters }`. `appliedFilters` is computed from
the request the client just sent, with `source: "REQUEST" | "VIEW"` resolved against the saved view —
`packages/fixtures/src/client/query.ts` already implements `mergeFilters` and `paginate` for the
fixture path, so the logic is written and tested, it only needs a second backing store.

Two shaping notes that will bite if ignored:

- Provenance (§1 "Provenance envelope") is per-field, not per-row. Those endpoints need a view that
  builds the `provenance` jsonb, not a raw table select.
- `supabase/CLAUDE.md` "Money" warns composites "round-trip badly through PostgREST and generate
  unusable TypeScript." Money stays `bigint` sen plus a `currency char(3)`, assembled into
  `{ amount, currency }` by the client.

---

## First ten to build, in order

1. **`core.perform_action` wrapper + migration 014 RLS + `POST /v1/actions`.** Nothing else is
   testable first. `ai/resume-brief.md:11`: "Every table is deny-all until 014 lands." This is one
   work item, not two, because the wrapper's grant is meaningless without policies behind it.
2. **`GET /v1/me`.** The client cannot sign a request or pick a role without it. It also closes the
   verifier carry-over item at `ai/resume-brief.md:55` — the profile modal still reads a constant
   instead of `getMeProfile()`.
3. **`GET /v1/navigation`.** The shell renders nothing without the role-filtered tree and badges.
4. **`GET /v1/enquiries`** — the inbox, M03-S01, and the first list envelope to prove end to end.
5. **`GET /v1/enquiries/{id}`** — the first detail view with a provenance envelope on extracted
   fields.
6. **`GET /v1/organisations/{id}` and `GET /v1/organisations/{id}/relations`** — organisation 360,
   the match step of the golden path. ORG-0114 already has an in-flight deal in the fixtures
   (`ai/resume-brief.md:10`), so the expected output is known.
7. **`GET /v1/tnas/{id}`** — gaps with sources.
8. **`POST /v1/proposals`, then `GET /v1/proposals/{id}`** — the drafting step.
9. **`GET /v1/quotations/{id}` and `PUT /v1/quotations/{id}`** — costing, and the first designed
   refusal. The Safety Leadership fixture sits at 29% margin, below floor
   (`ai/resume-brief.md:10`), so `FLOOR_PRICE_BREACH` is reachable from the UI on day one.
10. **`GET /v1/approvals`, `GET /v1/approvals/{id}`, `POST /v1/approvals/{id}/decide`** — the
    approval inbox and decision. `core.v_approval_requests` already exists as a security-invoker view
    (011:1408), so the two reads are close to free once 014 lands.

That sequence ends exactly where proposal §2.5 says the demo ends: policy routes to Sales Manager,
approval screen shows evidence and the diff, approved. Send, follow-up and portal acceptance are the
next slice and need two of the twenty functions.

**Then swap the web app one feature at a time.** `apps/web/src/shared/api/useApi.ts:28` says it
outright: "Swapping the fixture client for an HTTP one is now a change to this file." One `ApiContext`
for the whole app, one `ACTOR_FOR_ROLE` table, `signInAs` in render. 37 files import
`@trainos/fixtures` today. Start with enquiries, then proposals, then approvals, matching the order
above. `packages/fixtures` is not deleted afterwards — it stays as the contract oracle that both
clients are tested against.

---

## Three risks, with mitigations

### 1 · There is no local Supabase stack, so the function tier has no local loop

`docker`, `supabase` and `deno` are all absent, and `supabase/CLAUDE.md:165-168` confirms this is the
authoring environment's steady state, not a temporary gap. Edge Functions cannot be served or
debugged locally. An engineer who can only test by deploying will deploy broken functions.

**Mitigation.** Write every function as a plain Hono handler over the Web `fetch` API, exported from
a module with no Deno import in it, and unit-test it under vitest on Node — the runtime that is
installed and is already the project's test runner. The Deno entry is a four-line adapter
(`Deno.serve(app.fetch)`). This is exactly the split `packages/agent-runtime` already uses between
`src/index.ts` ("This entry runs anywhere... a test walks this module graph and fails if one creeps
back in") and `src/node.ts`. Copy that test. Deploy through the Supabase MCP
(`deploy_edge_function`) rather than the CLI until Docker exists. The same handler runs on Railway
unchanged if Edge limits bite, which is the option-3 escape hatch in practice rather than in theory.

### 2 · §3.3 names ASP.NET, Dapper and Microsoft Agent Framework in the pack the client sees

`docs/bd/proposal-content-pack-v2.md` §3.3 is a stack table inside the client-facing pack. Shipping a
different stack without saying so is the kind of thing that surfaces at the worst moment, and Alex
Selvarajah is an HRMS expert who will read the table.

**Mitigation, three parts.** First, the Agent Framework row already carries a † and is listed in
Appendix H as a source to re-verify before sending — it is flagged as provisional in the client's own
copy. Second, §6.1 makes architecture a Phase 0 deliverable: weeks 1–3, "integration boundary
sign-off" and "NFRs" are named exit criteria and the phase ends with "Blueprint accepted". Re-deciding
the API layer at blueprint is the process working, not a deviation from it. Put the decision in the
blueprint in writing, with this memo's reasoning. Third, lead with the commercial consequence:
dropping Railway removes USD 45–60/month from the §4.3 pass-through the client was quoted, taking the
recurring platform total below the stated RM 1,000–1,300 baseline. A client-favourable change is an
easy conversation. Do not let it be discovered rather than told.

Keep §3.2 intact in the pack. Every design decision it lists — modular boundaries, action envelope,
provenance and audit, rules registry, scoped sub-agents, deterministic-first, tenancy from day one —
is delivered by this architecture. Only the implementation row of §3.3 changes.

### 3 · PostgREST leaks its own shape into 59 endpoints with no compiler in between

A view rename, a changed embedded resource or a dropped column becomes a runtime client failure. This
is the exact incident `check-rpc-contract.mjs:6-11` was written for: "an RPC gained a sibling key
alongside `data` in its return envelope... A live page white-screened — and only on the
session-restore path, not on first submit." And the script's own documented limitation
(lines 27-31) is that it sees RPCs only: "any endpoint served by the REST API rather than by a
database function" is invisible to it.

**Mitigation, three parts.** Extend E3 to cover view-backed client methods, not only RPC-backed ones —
the check already walks `TrainOsClient` method signatures, so the work is teaching it which methods
map to which relation. Generate the row types with `supabase gen types` (available through the MCP
without a local CLI) and have the client's view methods consume the generated types, so a dropped
column fails `npm run typecheck` rather than a page. And keep `packages/fixtures` alive as the
oracle: run one shared contract test suite against both the fixture client and the HTTP client, so a
shape divergence fails in CI rather than in the browser.

---

## Summary

Take option 1. Add `core.perform_action` in 014 — it is the line item everything else depends on.
Write the twenty functions in Hono on Node and deploy them to Edge, keeping Railway available and
unused. Keep `packages/agent-runtime` exactly where it is; its 300s checkpointing was designed for
this host. Build the ten endpoints in the order above and the golden path is runnable in three to
five weeks at roughly USD 45 a month. Re-open .NET at Phase 0 blueprint if staffing argues for it;
the contract is the boundary, so that decision stays cheap.
