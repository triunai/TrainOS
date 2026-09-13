# API phase plan — 13 Sep 2026 15:00 (+08)

Executable by a headless session, local or cloud. Each lane below is a dispatch brief: copy the **Prompt** block into an agent, set the model, respect the **Runs where** column. Rules that apply to every lane are in `ai/resume-brief.md` § "Shared-worktree rules" (pathspec-only commits, numstat check on shared files, `check:barrels`, never bare `vitest` at root).

## Rulings in force

| #   | Ruling                                                                                                                                                                                                         | Source                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| R-A | API layer = Supabase + SQL RPCs only. No Edge Functions. Pattern = showroom (`docs/architecture/08-rpc-pattern-from-showroom.md`).                                                                             | user, 14:27               |
| R-B | Background work = one Node worker (packages/agent-runtime host) polling `app.claim_jobs` (012). pg_cron only for `reap_jobs` and cron-history retention. No pg_net nudges.                                     | user + showroom precedent |
| R-C | SST is an effective-dated, tenant-scoped `core.tax_policies` table resolved by `app.resolve_tax_policy()`; both taxable (Group G 8%) and Education Act exempt policies seeded; never a column default.         | user, 14:30               |
| R-D | Nothing applies to the hosted project (`balzmmsmrawzmefkavte`, empty) until 014 is reviewed and the user says go; then one pack per round in a lane that does nothing else, rollback proven on the shim first. | user                      |
| R-E | 018 = the golden-path RPC pack from `docs/architecture/09-golden-path-rpc-specs.md`. Starts only on the user's go.                                                                                             | user                      |
| R-F | Hosted project must expose `core` (Dashboard → Project Settings → API → Exposed schemas). `app` stays hidden. User action.                                                                                     | api-client finding        |
| R-G | Proposal pack §3.3 (.NET, Agent Framework, n8n) is rewritten to the Supabase-RPC + Node-worker stack before it is sent.                                                                                        | consequence of R-A        |

## State (HEAD 5ac70c4)

- Packs 001–012 committed with tests and rollbacks, executed on the local PostgreSQL 17 shim. 013–017 in progress in the `migrations` lane (Claude drafts, Codex gpt-5.6-sol reviews after 17:10 quota). Research findings routed into 013/014/015/017 are listed in `ai/resume-brief.md` § "Research blast E".
- Typed RPC client at `apps/web/src/shared/api/client.ts` (41 methods), seam `VITE_API_MODE=fixtures|supabase`, conformance suite, `check:rpc` 4/0. None of the 24 RPCs it names exist in SQL yet; specs in `docs/architecture/09-golden-path-rpc-specs.md`.
- Hosted project linked in `supabase/config.toml`; `.env.local` (gitignored) carries URL and publishable key; `.env.example` has the names.

## Lanes

| Lane                                      | Model  | Runs where                                                         | Depends on                                                         | Owns                                                                                   |
| ----------------------------------------- | ------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| L1 migrations 013–017                     | Opus   | LOCAL (needs the shim)                                             | —                                                                  | `supabase/**`                                                                          |
| L2 rpc-pack 018                           | Opus   | LOCAL (shim)                                                       | user go (R-E); 011, 014 shapes                                     | `supabase/migrations/018*`, `supabase/tests/test_018*`, `supabase/rollbacks/018*` only |
| L3 apply-hosted                           | Opus   | LOCAL or CLOUD (needs DB password/service key via env, never chat) | R-D go; L1 014 reviewed; R-F done                                  | nothing in repo except `supabase/HANDOFF.md` apply log                                 |
| L4 web-swap enquiries→proposals→approvals | Opus   | CLOUD ok                                                           | L2 + L3 for real data; can start against the conformance suite now | `apps/web/src/features/{enquiries,proposals,approvals}/**`, `shared/api/**`            |
| L5 worker                                 | Opus   | CLOUD ok                                                           | 012 (landed)                                                       | new `apps/worker/**`                                                                   |
| L6 proposal-pack rewrite                  | Sonnet | CLOUD ok                                                           | research docs (landed)                                             | `docs/bd/proposal-content-pack-v2.md` only                                             |
| L7 routing-config alignment               | Sonnet | CLOUD ok                                                           | pricing research (landed)                                          | `packages/agent-runtime/src/routing/config.ts` + tests                                 |
| L8 Opus pass (BD)                         | Opus   | CLOUD (running as `cloud/opus-pass`)                               | —                                                                  | `docs/bd/ai-explorations/2026-09-13-opus-pass.md`                                      |

Parallel-safe sets: {L1} ∥ {L2} (disjoint files; L2 never edits catalog/HANDOFF, L1 appends its row) ∥ {L4, L5, L6, L7} in the cloud on branches, merged by PR.

### L2 · rpc-pack 018 — Prompt

> Repo trainos. You own only `supabase/migrations/018_golden_path_rpcs.sql`, `supabase/tests/test_018_golden_path_rpcs.sql`, `supabase/rollbacks/018_golden_path_rpcs_rollback.sql`. Read `supabase/CLAUDE.md`, `docs/architecture/08-rpc-pattern-from-showroom.md` §2 and §9, `docs/architecture/09-golden-path-rpc-specs.md` (the 24 function specs: name, args, envelope keys, tables, `app.require_tenant_id()`, idempotency, error codes, pins), 001 (`app.ok/app.err`), 011 (`app.perform_action`, `app.decide_approval`, `app.bulk_decide`, `core.v_approval_requests`), and the 014 draft if present (grants). Write every function in `core` as SECURITY DEFINER with `SET search_path = ''`, envelope through `app.ok/app.err` only, `GRANT EXECUTE TO authenticated`, `REVOKE FROM PUBLIC, anon`; the three gate wrappers call the 011 functions and never widen identity. Execute forward, test, rollback, forward on the local shim using the commands in `supabase/HANDOFF.md`; every spec's pin becomes an assertion; do not weaken 011's transition gate. Commit by pathspec (`git add -- <3 files> && git commit -m ... -- <3 files>`); message the `migrations` lane your commit so it appends the catalog row. Report: function count, assertion count, any spec that could not be implemented as specified and why.

### L3 · apply-hosted — Prompt

> Repo trainos. Preconditions you must verify before any statement runs: user's explicit go recorded in `supabase/HANDOFF.md`; `core` exposed on the hosted project (R-F); `SUPABASE_DB_URL` (or `PGPASSWORD` + host) present in the environment; `supabase/config.toml` project_id = balzmmsmrawzmefkavte. Procedure, one pack per round, in order 001…N: (1) run the pack's rollback+forward round trip on the local shim and record it; (2) `psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/NNN_*.sql`; (3) run `supabase/tests/test_NNN_*.sql` against hosted; (4) append an apply-log row (pack, hash of the file, timestamp, assertion count) to HANDOFF and commit it by pathspec; (5) stop on the first failure and report; never run a rollback on hosted without the user's word. Do nothing else in the repo.

### L4 · web-swap — Prompt

> Repo trainos. Own `apps/web/src/features/{enquiries,proposals,approvals}/**` and `apps/web/src/shared/api/**`. Read `docs/architecture/08` §9, `apps/web/src/shared/api/{client,rpcClient,apiClient,useApi}.ts`, the conformance suite, and `docs/architecture/09`. For each feature in order enquiries → proposals → approvals: make every read and action go through the `TrainOsClient` interface (no `@trainos/fixtures` import left in the feature; the fixtures client stays as the oracle behind the seam), keep every render test green in `VITE_API_MODE=fixtures`, add a per-feature conformance case that runs the feature's calls against both clients with transport mocked, and make `PGRST106/PGRST205` render the "not deployed" state rather than an error. When a hosted database with 001–018 applied exists, run the feature once against it in `VITE_API_MODE=supabase` and record what differed. Commit by pathspec per feature; branch `cloud/web-swap` if in the cloud, PR to main.

### L5 · worker — Prompt

> Repo trainos. Create `apps/worker/` (Node 24, TypeScript, shares `packages/contract` and `packages/agent-runtime`). Read `supabase/migrations/012_events_outbox_and_jobs.sql` (claim_jobs / heartbeat_job / complete_job / fail_job / reap_jobs / dead_letters), `docs/architecture/08` §3 and §10 (showroom's whatsapp-send worker header is the shape: FOR UPDATE SKIP LOCKED claim, atomic mark-sent, credit-back on terminal failure, pacing), `packages/agent-runtime/src` (run slicing; drop the Edge wall-clock assumption, keep checkpoints). Build: a loop that claims jobs with the service-role key from env, dispatches by job type (agent run slice, outbound email, WhatsApp send stub, outbox publish), heartbeats, completes or fails with reason, honours per-tenant BYOK keys from Vault (read via an RPC, never the anon key), and exposes `/healthz`. Tests with the SQL functions mocked at the transport and one integration test against the local shim if available. Railway `railway.toml` per proposal §3.3. Branch `cloud/worker`, PR to main.

### L6 · proposal-pack rewrite — Prompt

> Repo trainos. Edit only `docs/bd/proposal-content-pack-v2.md`, producing v3 in place (rename header, keep a changelog block at the top). Apply: R-A/R-B stack in §3.1–§3.3 (Supabase + SQL RPCs, one Node worker on Railway, no Edge Functions, no .NET, no Agent Framework; n8n only if the user still wants it, mark as optional); §4.1 tiers to match `packages/agent-runtime/src/routing/config.ts` after L7, jury with three vendors; §4.2 costs from `docs/research/2026-09-13-model-pricing-rebaseline.md` stated conservatively; §4.3 WhatsApp 1 Oct 2026 change raises cost; §1.5 and Appendix B corrections from `docs/research/2026-09-13-hrdcorp-compliance-refresh.md` (Circular 6/2024 for HRD-TDF, 5-day query deadline, 3-year renewal, ACM rate provenance); PDPA and MyInvois "already in force" wording from `docs/research/2026-09-13-myinvois-sst-pdpa-schema-impact.md`; SST policy table (R-C) in §3.2; Malaysia hosting = self-host (no managed region); "utilisation" definition flagged as to-be-confirmed with Alex. Do not change prices in §7 without a note. Branch `cloud/pack-v3`, PR.

### L7 · routing-config alignment — Prompt

> Repo trainos. Edit `packages/agent-runtime/src/routing/config.ts` and its tests only. Read `docs/research/2026-09-13-model-pricing-rebaseline.md` and proposal §4.1. Make the tiers match the pack or the pack match the code, but pick one and say which: the three STRONG jurors must be three vendors (Anthropic, Google, OpenAI); FAST/FAST-UI/CHEAP bound to the cheapest model that the research says passes the job; add a `hostConstraint` allow-list on routing entries (from `docs/research/2026-09-13-ai-storage-and-pdpa-practices.md`) so DeepSeek-via-OpenRouter never routes to China-hosted infra. Tests: vendor independence of the jury, host constraint enforced, every tier has a fallback. Branch `cloud/routing`, PR.

## Needs the user

1. Go for L2 (018 RPC pack).
2. Region confirmation for the hosted project (Singapore).
3. R-F: expose `core` in the dashboard.
4. DB password or service-role key placed in an env file the apply lane can read (never chat), then go for L3.
5. Whether n8n stays in the proposal at all.

## Done when

`VITE_API_MODE=supabase` renders the enquiry inbox, an enquiry detail, ORG-0114, a proposal, its quotation with the floor-price refusal, and the approval inbox with a decision, against the hosted project with 001–018 applied, with the conformance suite green against both clients.
