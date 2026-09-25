# Agentic TPMS

**Training Provider Management System / Agentic CRM** for an independent Malaysian corporate
training provider operating under the **HRD Corp SBL-Khas** direct-grant framework.

It runs the whole job: inbound lead → TNA → priced quotation → e-TRiS grant → trainer, venue
and cohort → day-of-event attendance → certificates → claim pack → HRD Corp remittance →
trainer and vendor payouts → retention cadences. Two deterministic state machines sit in
the middle, a five-tier agent pool around them, and a named human at every gate that
spends money or commits the provider.

> Single-tenant by design: one provider, one database, no tenant columns.
> The design language is forked from TrainOS (the parent repository, read-only); this folder
> is an independent application and edits nothing outside itself.

---

## Contents

1. [What it does](#what-it-does)
2. [Architecture](#architecture)
3. [Running it](#running-it)
4. [Bring your own key](#bring-your-own-key)
5. [Moving to Supabase](#moving-to-supabase)
6. [The state machines](#the-state-machines)
7. [The three HITL gates](#the-three-hitl-gates)
8. [Compliance: audit ledger, vault, PII](#compliance)
9. [Testing](#testing)
10. [Repository map](#repository-map)
11. [Honest limitations](#honest-limitations)

---

## What it does

| Stage | What the system does | Who decides |
|---|---|---|
| 1 · Demand | Meta Lead Ads, Google Ads lead forms, LinkedIn, WhatsApp Cloud API and inbound e-mail (virtual forwarding mailbox + smart BCC) land on webhooks, are hashed, de-duplicated and classified by the L1 router (P(levy), intent, urgency, abstain). Qualified leads get the 60-second WhatsApp micro-TNA. | Operator triages the ambiguous band; approves every outbound e-mail batch. |
| 2 · TNA & quote | pgvector search over the course catalogue + JPK/NOSS + HRD focus areas, a Form HRD-L&D outline with Bloom's-taxonomy outcomes, and a quotation priced by the **headless Univer formula engine** against the Allowable Cost Matrix, cross-checked to the sen by an independent TypeScript model. | **Gate 1** — operator reviews the worksheet in an embedded Univer canvas and approves & dispatches. |
| 3 · Grant | e-TRiS support dossier (outline, quote, trainer CV, TTT certificate, manifest with SHA-256s), approval-letter extraction (L2), optional 30% upfront claim. | Operator verifies the extracted grant ID, pax and amount. |
| 4 · Operations | Trainer holds (tentative → confirmed, pay-when-paid), venue BEO / printing DO, and the **T-14 viability check** leased from the task queue. | **Gate 2** — below 5 pax, vendor auto-confirmations halt; operator chooses postpone / pivot to ROT / cancel / proceed. |
| 5 · Delivery | Dual-track attendance: zero-auth JWT magic links and session QR (Track A), Form T3 scans through the OpenCV/PaddleOCR microservice (Track B), photo EXIF checks, Kirkpatrick L2 pre/post quizzes, tamper-evident PDF certificates with public QR verification. | Operator resolves attendance exceptions on the exception desk. |
| 6 · Claims & AP | HRD Corp tax invoice, SBL-Khas claim pack (ZIP + manifest of hashes), claim FSM through query/approval/remittance, payment vouchers, bank reference + receipt, unit economics. | **Gate 3** — operator approves the claim pack, then confirms every disbursement. |
| 7 · Retention | T+14 executive delivery pack, T+90 curriculum laddering, T+300 levy-utilisation alert — drafted by L4, dispatched only on approval. | Operator approves each proposal. |

## Architecture

```
┌──────────────────────── Command cockpit (Next.js 14 App Router) ────────────────────────┐
│ TrainOS shell · Package board (Trainer × Venue × e-TRiS lights) · Decisions desk        │
│ Univer canvas (Gate 1 worksheet, attendance grid) · BYOK keys & cost breakdown · SSE    │
└───────────────────────────────▲─────────────────────────────────────────────────────────┘
                                │ Server Actions · REST (/api/v1) · SSE (/api/v1/events)
┌───────────────────────────────▼─────────────────────────────────────────────────────────┐
│ Application runtime                                                                     │
│  • Operational FSM ⟷ Financial FSM — one transition table, enforced in TS AND Postgres  │
│  • L0 guards (src/server/fsm/guards.ts) evaluated before every move                     │
│  • Task leaser: SELECT … FOR UPDATE SKIP LOCKED (tpms.claim_due), 5-minute leases       │
│  • Headless Univer formula engine for the Allowable Cost Matrix                         │
│  • Append-only audit ledger, SHA-256 hash chain, triggers refuse UPDATE/DELETE/TRUNCATE │
└──────────────▲─────────────────────────────────────────────▲────────────────────────────┘
               │ domain_events (NOTIFY) + task_queue          │ drafts, quotations, decisions
┌──────────────┴──────────────┐                ┌──────────────┴──────────────────────────┐
│ Ingestion & event bus       │                │ 5-tier agent pool                       │
│ Meta · Google · LinkedIn ·  │───────────────▶│ L0 rules · L1 classifier · L2 extraction │
│ WhatsApp · e-mail · web     │                │ L3 DeepSeek-class · L4 Claude-class     │
└─────────────────────────────┘                └──────────────┬──────────────────────────┘
                                                               ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ PostgreSQL 16 (schema `tpms`) · pgvector (catalogue, NOSS) · pgcrypto (NRIC) · vault    │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

**Stack:** Next.js 14 (App Router, React 18) · Tailwind 3 on the TrainOS token file · Drizzle ORM
over node-postgres · PostgreSQL 16 + pgvector + pgcrypto · Univer 1.0 (headless formula engine
and browser canvas) · pdf-lib · jose (HS256 magic links) · Vitest against real Postgres ·
Python FastAPI + OpenCV (+ optional PaddleOCR PP-StructureV3) for L2 extraction.

## Running it

Requirements: Node 20+, PostgreSQL 16 with the `vector` and `pgcrypto` extensions, Python 3.11
for the extraction service.

```bash
cd agentic-tpms
cp .env.example .env            # set DATABASE_URL and the three secrets
npm install
npm run db:migrate              # applies db/migrations/*.sql (checksummed)
npm run db:seed                 # fictional demo portfolio across every stage
npm run dev                     # cockpit on http://localhost:3100
npm run worker                  # task worker (T-14 checks, OCR, claims, retention …)
```

The extraction service (Track B attendance, grant letters):

```bash
cd services/paddleocr
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt            # OpenCV grid engine (always on)
pip install -r requirements-paddle.txt     # optional: PaddleOCR PP-StructureV3
uvicorn app.main:app --port 8866
```

Or everything at once: `docker compose up` (Postgres + pgvector, cockpit, worker, OCR service).

## Bring your own key

With **no keys at all** the system is fully functional: every agent runs a deterministic
template and says so in its provenance chip (`✦ Template · L3`). Add keys and the same agents
switch to models on their next call — no code change.

| Tier | Default route | Environment variable |
|---|---|---|
| L1 fast classifier | Gemini 2.5 Flash Lite → OpenRouter | `GEMINI_API_KEY` |
| L3 domain specialists | DeepSeek (`deepseek-chat`) → OpenRouter | `DEEPSEEK_API_KEY` |
| L4 tone specialist | Claude Sonnet 5 → OpenRouter | `ANTHROPIC_API_KEY` |
| Embeddings | any OpenAI-compatible `/embeddings` (1536-d) | `OPENAI_COMPATIBLE_API_KEY` + `_BASE_URL` |
| Any tier | OpenRouter | `OPENROUTER_API_KEY` |

Keys can also be added in **Settings › AI providers**: encrypted with AES-256-GCM under
`TPMS_MASTER_KEY`, shown only masked, scoped to tiers, with optional monthly caps.
**Settings › Usage & cost** shows month-to-date spend by tier, agent, model and package, a
labelled linear forecast, cache-hit ratio, template-fallback share and per-tier budget state.
A tier at its cap pauses to its template rather than overspending.

## Moving to Supabase

Supabase is Postgres, so this is a connection-string change:

1. Enable `vector` and `pgcrypto` (Database › Extensions). They live in the `extensions`
   schema; every function here pins `search_path = tpms, extensions, public, pg_temp`.
2. Run the migrations against the Supabase database (`DATABASE_URL=… npm run db:migrate`), or
   copy `db/migrations/*.sql` into `supabase/migrations/`.
3. Everything lives in the **`tpms` schema**, which Supabase's Data API does not expose; the
   migrations also revoke `anon`/`authenticated` from it. Do not add `tpms` to the exposed
   schemas.
4. Use the **session** connection (port 5432) for the worker and for `/api/v1/events` (they
   need `LISTEN` and advisory/row locks across statements). The cockpit's queries are all
   `tpms.`-qualified and transaction-local, so the transaction pooler works for page loads.
5. The vault stores files on the local filesystem behind one module
   (`src/server/storage/vault.ts`); swap `writeBlob`/`readBlob` for Supabase Storage.

## The state machines

See [`docs/STATE_MACHINES.md`](docs/STATE_MACHINES.md) — generated from the transition table
(`npm run docs:fsm`), with Mermaid diagrams and every reason code.

- **Operational:** `DRAFT → QUOTED → GRANT_PENDING → GRANT_APPROVED → OPERATIONS_LOCKED →
  READY_FOR_EVENT → DELIVERY_IN_PROGRESS → DELIVERY_COMPLETED`, exits `POSTPONED`, `CANCELLED`.
- **Financial:** `ESTIMATE → GRANT_RESERVED → [UPFRONT_CLAIM_SUBMITTED] → CLAIM_NOT_READY →
  CLAIM_READY → CLAIM_SUBMITTED ⇄ QUERIED → APPROVED → REMITTED → SETTLED_CLOSED`, exit `VOIDED`.

The same table exists twice — `src/server/fsm/transitions.ts` and `tpms.fsm_transitions` — and a
test asserts they are identical. The database refuses any `training_packages` UPDATE that does
not carry `tpms.actor_type` + `tpms.reason_code`, and any stage change that is not in the table
for that actor and reason. **No transition accepts an `AGENT` actor.**

## The three HITL gates

- **Gate 1 — Commercial outbox & quotation desk** (`/operations/<code>/commercials`): DRAFT →
  QUOTED requires `actor_type = USER` and `reason_code = COMMERCIAL_TERMS_APPROVED`; the audit
  row carries a field-level diff of line items between the agent's draft and the approved sheet.
- **Gate 2 — T-14 viability & contingency desk** (`/operations/<code>/logistics`): a leased
  task at start − 14 days; below the minimum cohort, vendor auto-confirmations halt and a
  decision offers postpone / pivot to ROT / cancel / proceed, each with its exposure.
- **Gate 3 — Claims audit & AP disbursement desk** (`/operations/<code>/claims`): claim pack
  approval, then every payment voucher needs a bank reference and a receipt; the database
  refuses PAID before HRD Corp has remitted (pay-when-paid) and REMITTED → SETTLED_CLOSED
  needs `AP_DISBURSEMENT_CONFIRMED` from a named user.

All pending gates appear on the **Decisions desk** (`/decisions`).

## Compliance

- **Audit ledger** (`tpms.audit_ledger`): each row's checkpoint is
  `SHA-256(previous checkpoint ‖ canonical row)`; the chain head is a single row taken
  `FOR UPDATE`, so concurrent writers serialise instead of forking the chain. Triggers refuse
  UPDATE, DELETE and TRUNCATE; `tpms.audit_verify_chain()` recomputes from genesis and finds a
  row altered by anyone who bypassed the triggers (`npm run audit:verify`).
- **Evidence vault** (`tpms.compliance_vault`): content-addressed files, immutable rows (only
  verification fields may change), every insert and verdict audited, bytes re-hashed on every
  download — a tampered file is refused with 409, never served.
- **PII (PDPA)**: NRIC/passport numbers are validated (MyKad date check), stored as an HMAC
  under a server pepper (a plain SHA-256 of a 12-digit NRIC is brute-forceable), encrypted with
  pgcrypto AES-256, and shown only as `******-**-1234`, including on certificates.
- **Cost policy**: the Allowable Cost Matrix is versioned policy data, not code
  (`tpms.cost_matrix_policies`, editable in Knowledge › Cost matrix).

## Testing

```bash
npm run typecheck
npm test                      # unit + integration, against TEST_DATABASE_URL (rebuilt per file)
npm run golden-path           # full lifecycle end to end against a scratch database
```

Integration tests run against real Postgres because the guards under test live in triggers.

## Repository map

```
agentic-tpms/
  db/migrations/ + db/rollbacks/   SQL is the source of truth (checksummed runner)
  src/app/(cockpit)/               operator screens      src/app/(public)/   /c /q /verify
  src/app/api/v1/                  webhooks, vault, SSE, public certificate downloads
  src/components/kit/              the TrainOS kit, forked (one design system)
  src/server/fsm/                  transition table, L0 guards, transition service
  src/server/queue/                claimDue leasing, worker, handler registry
  src/server/ai/                   BYOK providers, tier router, budgets, embeddings, usage
  src/server/{ingestion,outbound,messaging}/   Stage 1
  src/server/{pricing,knowledge,commercial,grant}/   Stages 2–3
  src/server/{operations,participants,resources}/    Stage 4
  src/server/{attendance,extraction,assessments,certificates}/   Stage 5
  src/server/{claims,finance,retention}/     Stages 6–7
  services/paddleocr/              L2 extraction microservice (FastAPI)
  worker/                          task worker entry point
  tests/                           unit + integration (real Postgres)
```

## Honest limitations

- **Statutory numbers are configuration.** The seeded Allowable Cost Matrix bands come from the
  project's handoff specification (in-house RM 6,000–14,000/day, public RM 1,300/pax/day); ROT
  values are illustrative. Verify against the current HRD Corp circular before production.
- **Illustrative knowledge.** Seeded JPK/NOSS codes and focus-area texts are illustrative, not
  an official registry extract. All demo companies, people and venues are fictional.
- **Submission to HRD Corp is manual.** The system prepares the e-TRiS dossier and the claim
  pack and records the submission reference; it does not drive the e-TRiS portal.
- **Bank transfers are logged, not executed** (host-to-host banking is out of scope by the
  PRD); the operator records the bank reference and uploads the receipt.
- **No scraping.** Outbound signal enrichment accepts permissioned lists and webhooks only.
- **Identity.** Operators authenticate with HTTP Basic (`TPMS_BASIC_AUTH`) and pick "acting as";
  SSO is deferred.
