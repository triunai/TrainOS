# TrainOS — AI-Enabled Operating System for [CLIENT]
## Proposal content pack v3 (market · approach · technical · commercial · objections)

> **Changelog — v3, 13 Sep 2026.** Rewritten against the six `docs/research/2026-09-13-*.md` research docs, `docs/architecture/07` and `08`, `packages/agent-runtime/src/routing/config.ts` (post-routing-alignment), `apps/worker/README.md`, and the Opus pass over the eight AI-exploration docs (`docs/bd/ai-explorations/2026-09-13-opus-pass.md`). Ten changes that matter most: (1) The stack is Supabase + SQL RPCs + one Node worker on Railway — no Edge Functions, no .NET, no Microsoft Agent Framework — and n8n is now optional, pending [CLIENT]. (2) §4.1's model tiers now match the shipped routing config: a three-vendor STRONG jury (Anthropic, Google, OpenAI), a compliance-driven host allow-list keeping DeepSeek/Qwen off China-hosted infrastructure, and all 24 governed action types routed, not 9. (3) §4.2's AI cost baseline is now shown as two figures, not one confident number — a top-down placeholder and a far lower bottom-up sum from the exploration docs' own token math — because neither alone is precise enough to quote on its own. (4) WhatsApp's 1 Oct 2026 change raises cost, not lowers it: utility-in-window and service messages become billable again. (5) HRD-TDF trainer accreditation is Circular 6/2024 (1 Jan 2025), not Circular 2/2026 — separated out, with its 3-year renewal cycle added. (6) The single-query-round rule now states its 5-calendar-day response deadline, missing which silently expires the whole application. (7) PDPA obligations (DPO, breach notification, cross-border self-assessment) are stated as already in force since 2025, not upcoming. (8) MyInvois Phase 4 (up to RM 5m turnover) is already in force from 1 Jan 2026, and a new SST policy table at §3.2 states that TrainOS's own training/coaching services are themselves SST-taxable at 8% — absent from v2 entirely. (9) Malaysia hosting is stated plainly as self-hosting the open-source stack on AWS `ap-southeast-5` — Supabase has no managed region there. (10) The priority ranking in §2.4/§2.5 changed: the claim-integrity guard now ships first (zero-token, fully seedable), and the levy radar's headline 15% rule is gated on claim-history coverage and does not ship until "utilisation" — a term HRD Corp never formally defines — is confirmed with [CLIENT]. Prices in §7 are carried over unchanged from v2; see the note at §7.3.
>
> Saved 13 Sep 2026 from the user's drafting session. Placeholders: [CLIENT] = Alex's company · [VENDOR] = your company · [DATE] · [ALEX]. Prices in RM unless stated. FX assumption RM 4.5/USD — adjust before sending. Facts marked † are sourced in Appendix H; figures marked ‡ are arithmetic on published data and are labelled as such wherever they appear. Re-verify † items on the day. Companion: `2026-09-13-value-chain-and-numbers.md`. Iterate here; do not fork copies.

---

## 0. Executive summary (one page)

**What you asked for.** An interconnected agentic AI ecosystem that automates [CLIENT]'s operation end-to-end — enquiry to renewal — with human approval where it matters, so the business scales without a matching increase in administrative headcount.

**What we propose.** TrainOS: one system of record for the whole training lifecycle, with specialised AI agents that do the work *through* it and a policy engine that decides what runs automatically, what is drafted for a person, and what waits for approval. Built for Malaysia: HRD Corp rules enforced by construction, invoices routed through your MyInvois-capable accounting package, WhatsApp as a first-class channel, participant data handled under the amended PDPA, and your own model keys.

**Why now.** HRD Corp Employer's Circular No. 2/2026 (effective 15 June 2026) made scheduling a compliance problem: in-house training only 14 days after grant approval, start within 90 days, claims within six months, no amendments.† Every deal now carries a claim deadline. The provider who can mobilise inside that corridor without a rejected claim wins the account.

**The market you are in.** HRD Corp approved RM 2.62 billion of training assistance in 2025 (+32% on 2024) across 2.8 million training places, for ~90,000 registered employers, fulfilled by 7,975 registered providers and roughly 3,000 accredited trainers.† Roughly 29% of levy goes unutilised and employers now lose 15% of large unused balances†‡ — demand is forced by policy and gated by a clock. TrainOS is built to capture that flow: **claim-window fulfilment, levy-utilisation intelligence, and trainer-network leverage.**

**How it lands.** Five phases over ~10 months. Phase 1 puts the sales golden path — enquiry → TNA → proposal → costing → approval → send → follow-up — live on your real inbox within 12 weeks. Each later phase is quoted firm only after the previous one runs.

**What it costs.** Build RM 150,000 across five phases (founding-client terms available), managed service RM 5,000/month from first go-live, and platform/AI/WhatsApp costs passed through at roughly RM 1,000–1,300/month at today's volume. Government co-funding (MDEC digital acceleration and SME digitalisation grants) may offset a material share of the build.†

**What you get in year one.** Enquiry response in minutes, proposals in hours, zero claims lost to the June rules, a live ledger of administrative hours saved, a levy radar that tells sales who to call before the 15% deduction hits, and agents that earn more autonomy every month on evidence.

---

## 1. The market and where [CLIENT] sits

### 1.1 The value chain
```
LAYER 0  POLICY & FUNDING   KESUMA · HRD Corp (levy, schemes, ACM, eTRIS) · AG/PAC oversight · MDEC/MIDA/SME Corp grants
LAYER 1  DEMAND             ~90,000 registered employers; manufacturing largest (795k training places, 2025)
LAYER 2  INTERMEDIARIES     Directories/marketplaces, HR consultancies, HRMS vendors bundling training, brokers
LAYER 3  PROVIDERS ◄ CLIENT 7,975 registered training providers; programme IP owners above delivery providers
LAYER 4  TRAINERS           ~3,000 accredited trainers, mostly freelance; HRD-TDF accreditation gate
LAYER 5  DELIVERY INPUTS    Venues, catering, materials, LMS, assessment and certification bodies
LAYER 6  COMPLIANCE & MONEY eTRIS grant → training → claim; HRD Corp 4% service fee; accounting/MyInvois; SST
LAYER 7  TOOLING            CRM, HRMS, WhatsApp, LMS, e-attendance ◄ where TrainOS lives
```

### 1.2 The numbers that matter
| Metric | Figure | Basis |
|---|---|---|
| Levy collected | RM 475m (2020) → RM 848m (2021) → RM 1.81b (2022) → RM 2.13b (2023) | HRD Corp† |
| Levy utilisation | 63% (2020) → 71% (2023) | HRD Corp† |
| Financial assistance approved | RM 2.62b (2025), +32% vs 2024 → ≈ RM 1.98b (2024)‡ | HRD Corp† |
| Training places | 2.30m (2023) → 2.8m (2025); manufacturing 795k (2025) | HRD Corp† |
| Registered employers | 89,912 (2023); "over 90,000" (2025) | HRD Corp† |
| Registered training providers | 7,975 (eTRIS listing); ~3,700 verified in directories | eTRIS/directories† |
| Accredited trainers | 3,027 (2023 KPI actual) | HRD Corp AR 2023† |
| Assets under management | RM 4.16b (2025) | HRD Corp† |
| ACM fee ceiling | up to RM 1,500/hour for premium programmes | HRD Corp† |
| Unused-levy rules | Forfeiture after 24 months above RM 10,000; 15% deduction where balance > RM 50,000 and utilisation < 50% (from March 2025) | HRD Corp circulars/support centre† |
| Employers claiming | 47% of registered employers claimed in 2025 (secondary source citing the annual report) | Provider blog† — treat as indicative |
| Unclaimed levy | order of RM 600m+/year‡ | ~29% unutilised on ~RM 2.1b+ collected; not a published figure |

What is *not* published and we do not estimate: the total corporate-training market beyond levy funding (unregistered employers, non-claimable premium programmes, vendor certifications). The levy-funded core is the defensible number.

### 1.3 What [CLIENT] is actually capturing
Not "training revenue" but a larger share of a ~RM 2.6b annual flow whose spending is **forced by policy, gated by a clock, and fulfilled by a scarce trainer pool**:
1. **Throughput inside the window.** Enquiry → approved grant → delivered training inside the 14–90-day corridor, with no rejected claim.
2. **The "use-it-or-lose-it" cohort.** Employers above RM 50,000 with low utilisation are advised to contact several providers at once and pick whoever can start within 1–2 weeks.† Speed is the pitch.
3. **The trainer network as a moat.** ~3,000 accredited trainers for ~8,000 providers; the provider with the best matching, availability and accreditation data books the good ones first.

Average assistance per provider is ~RM 330k/year by arithmetic‡ and heavily skewed toward a few vendor-certified shops. The route from the long tail to the professionalised middle is fulfilment capacity, not marketing spend.

### 1.4 The policy climate
The 2024 Auditor-General and PAC reports criticised HRD Corp's use of levy funds; HRD Corp responded with governance reforms.† Circular 2/2026 is a product of that scrutiny, and further tightening is likely. A rules registry that updates when circulars change is a hedge against the regulator, not an optional feature. Note also that the Education industry received a full-year levy exemption for 2026† — demand in this chain moves with policy.

### 1.5 The Malaysian operating constraints TrainOS is designed around
- **Levy economics:** 1% of monthly wages for employers with 10+ Malaysian employees; under SBL-Khas the employer pays nothing upfront — fees are debited from the levy.† Claim reliability is cash flow.
- **Circular 2/2026:** 14-day rule (in-house), 3-day for public until 31 Dec 2026 then 14 days from 1 Jan 2027, 90-day commencement, 6-month claim window, no amendments, single query round with a **5-calendar-day deadline to respond or the application expires**.† (An undocumented postponement path is reportedly negotiable directly with HRD Corp; not built as a system behaviour without confirmation.)
- **HRD-TDF trainer accreditation is mandatory under a separate, earlier circular — 6/2024, effective 1 Jan 2025** — not part of 2/2026; it carries a **3-year validity with a 360-active-training-hour renewal** (or an assessment route), applied for at least 3 months before expiry.†
- **ACM course-fee ceilings** (up to RM 1,500/hour, capped RM 10,500/day in-house per group; RM 1,750/pax/day public) were **set 1 Nov 2024 and restated in the Jan 2026 guidebook** — a standing rate, not a new 2026 tightening.† The meal-allowance ceiling (RM 15–25/pax) has one conflicting secondary source (RM 100/pax/day) unresolved pending a primary-PDF read.
- **eTRIS has no API**; attendance cannot be modified once approved.†
- **e-Invoicing (MyInvois)** is mandatory for turnover up to RM 5m as of **1 Jan 2026 (Phase 4, already in force)**, not merely "above RM 1m" — issuers under RM 1m turnover remain exempt entirely; a penalty-free relaxation on consolidated e-invoices runs to 31 Dec 2027 with full enforcement from 1 Jan 2028 (re-verify these two dates directly before quoting).†
- **Training and coaching services are themselves SST-taxable** — Group G (Professionals), standard-rated at **8%** since 1 Mar 2024, registration threshold RM 500,000 turnover; the "education services" SST exemption applies only to institutions registered under the Education Act 1996, which a corporate training provider is not.† See the SST policy table at §3.2.
- **PDPA (amended) — already in force, not pending:** DPO appointment and breach notification (72-hour Commissioner notice, 7-day data-subject notice) since **1 Jun 2025**; the cross-border transfer regime (self-assessed adequacy, no more Minister-approved whitelist) since **1 Apr 2025**; fines up to **RM 1,000,000 and/or 3 years** (up from RM 300,000/2 years), with data processors — including [VENDOR] — now directly liable on the Security Principle.†
- **WhatsApp** billed per message in MYR (Marketing ≈ RM 0.35–0.42, Utility ≈ RM 0.05–0.07, service replies free within 24h) — **the 1 Oct 2026 change raises cost, not lowers it**: utility-template messages sent inside the 24-hour service window (free since 1 Jul 2025) become billable again, and service messages become billable beyond a new 1,000-free-per-number-per-month allowance. Re-verify against Meta's own rate card before the pack goes out.†

---

## 2. Recommended approach

### 2.1 Three principles
1. **One system of record; agents as operators; humans as approvers.** Agents never bypass the permissions, audit or approvals a person faces.
2. **Compliance by construction.** Circular 2/2026 rules are scheduling constraints. The earliest claimable date is known before the proposal is drafted; the grant and claim deadlines sit on the engagement from day one; attendance locks on approval.
3. **Integrate, don't replace.** Mailbox, calendar, WhatsApp number and accounting package stay.

### 2.2 The autonomy ladder
| Level | Behaviour | Launch examples |
|---|---|---|
| Observe | Logs what it would do (shadow mode) | Everything, first 2–4 weeks |
| Suggest | Drafts; a human sends | Follow-ups, reminders |
| Act with approval | Executes after sign-off | Proposal send, invoice creation, trainer booking, HRDC "mark submitted" |
| Autonomous | Acts, notifies after | Enquiry classification, org matching, task creation |
A policy engine evaluates every action (type, value, first-time flags, confidence, role, current autonomy level). Thresholds are [CLIENT]'s. Promotion requires evals on [CLIENT]'s own history, a 2-of-3 strong-model jury, and a human decision record that agrees.

### 2.3 The fourteen areas
| RFP area | Agent does | Human keeps |
|---|---|---|
| Lead gen, enquiries, follow-ups | Classify, extract intent, match organisation, draft replies/nudges (EN/BM), schedule follow-ups | Send (until proven), relationship |
| CRM | Timeline, dedupe, health score, next-action suggestions, **levy radar** | Ownership |
| TNA | Extract gaps, map to competencies and programmes | Validate with client |
| Proposal, quotation, programme development | Draft from template, cost with margin rules, flag ACM ceilings and claimability, compute earliest claimable date | Approve above threshold |
| Trainer sourcing, scheduling | Match by competency, HRD-TDF status, availability, rate; hold slots | Confirm booking |
| Training operations | Checklists, logistics, run sheets, grant-window guard | Deliver |
| Participants, comms, attendance | Registration, joining instructions, Utility-template reminders, capture, lock | Approve attendance |
| Assessments, evaluation, certification | Generate, score, issue, verify | Sign off |
| HRD Corp / compliance | Assemble grant and claim packets, completeness score, deadline countdown, rule checks with citations | Submit on eTRIS |
| Finance | Push invoice to accounting, chase overdue by escalation rule, commissions, margin | Approve invoice/discount; call at step 3 |
| Renewals, cross-sell | Flag expiring/at-risk levy, unattended cohorts, adjacent programmes | Decide to pursue |
| Reporting, BI | Drill-through dashboards, hours-saved ledger, forecasts | Decide |
| Knowledge, documents | Ingest, cite, answer | Curate |
| Marketing, admin | Templates, broadcasts with cost preview, consent | Approve broadcast |

### 2.4 The levy radar — real, but gated on one thing to confirm
Employer balances are not public, but for each client [CLIENT] serves, the contribution rate, claim history and balance may be known — with a caveat that changes what ships first. **HRD Corp publishes no formula for "utilisation"**; every source states only the trigger condition ("less than 50% of the employer's contribution between 1 Jan and 31 Dec"), never a named calculation. TrainOS's working definition — **utilisation = claims approved in the calendar year ÷ that year's levy contribution, not the accumulated balance** — is an inferred assumption, not a published fact, and is **flagged to confirm with [CLIENT], ideally against a real eTRIS utilisation display, before it appears in front of a client.**

The bigger constraint: [CLIENT] typically sees only its own share of an employer's claim history, and brokers routinely place an employer with three to five providers at once — so TrainOS-only claim history reads systematically *low*, which would invert the pitch into a false "you're at risk" call. **The 15% deduction flag ships only where claim-history coverage is confirmed complete (a client statement or a declared figure) — never on TrainOS-only data alone.** Two rules need no such coverage and ship regardless: the 24-month forfeiture clock above RM 10,000 (Circular 7/2019) and the raw balance-above-RM-50,000 flag — both zero-inference and defensible from day one. That is still a cross-sell engine no directory or broker can replicate on the data it has access to, and it is [CLIENT]'s own data driving it.

### 2.5 The golden path we will demonstrate
Enquiry email → classified (Leadership 94%) and matched to an organisation with prior engagements, unused levy and an overdue invoice → convert → TNA gaps with sources → programme recommended with fit score, trainer matched by accreditation and availability → proposal drafted, costed (margin vs floor), earliest claimable date computed → policy routes to Sales Manager (> RM 15,000 and first proposal) → approval screen shows evidence, what differs from normal, risk, and the exact diff → approved, sent, tracked → follow-up scheduled → client accepts on a portal page → engagement created with grant window and claim deadline already on it.

**Two corrections behind that narrative.** First, the earliest-claimable-date step returns a **clean-path date and a contingency date**, never a bare one — the single query round's 5-calendar-day response window (§1.5) means a date quoted without the contingency is wrong by weeks the moment a query lands. Second, the demo's narrative order (money in, found, controlled, kept) is unchanged, but **the build order is not**: the claim-integrity guard (§2.3, HRD Corp / compliance row) now ships before the levy radar, because the claimable-date read depends on the compliance rules registry being seeded first — and seeding that registry is a zero-token, already-scoped piece of work, while the radar's headline number still needs the coverage question at §2.4 answered. One demo change follows directly: minutes 1:30–3:00 lead with the levy **balance and forfeiture countdown**, not the 15% deduction flag, until claim-history coverage clears the TrainOS-only caveat.

---

## 3. Solution architecture

### 3.1 Logical view
```
Employees (approve / review)             Clients · Participants · Trainers (portals)
        │                                               │
        ▼                                               ▼
┌────────────────────────────────────────────────────────────────┐
│ Supabase Postgres — PostgREST + SQL RPCs                        │
│  Schemas: crm · training · compliance · finance · automation ·  │
│           core (tenant resolver, permission lookup, action gate)│
│  Policy engine, approvals, audit, outbox and tenancy (RLS) are  │
│  all SQL — no separate application server                       │
│  + pgvector + rules graph + pg_cron + Vault                      │
└───────────────┬─────────────────────────┬───────────────────────┘
                │                         │
        ┌───────▼────────┐       ┌────────▼──────────┐
        │ Web app         │       │ One Node worker      │
        │ (React/Next.js),│       │ on Railway            │
        │ calls RPCs      │       │ claims `app.outbox`   │
        │ directly via    │       │ jobs (FOR UPDATE SKIP │
        │ PostgREST       │       │ LOCKED), runs the     │
        └────────────────┘       │ agent runtime, sends  │
                                 │ email/WhatsApp,        │
                                 │ publishes events.      │
                                 │ No Edge Functions —    │
                                 │ the 2s CPU-time budget │
                                 │ and EarlyDrop worker   │
                                 │ retirement rule them   │
                                 │ out for this workload  │
                                 └────────┬────────────┘
                                          │
                    ┌─────────────────────▼──────────────────────┐
                    │ Integrations (adapters; n8n optional,       │
                    │ pending [CLIENT] — see below)                │
                    │ Email · Calendar · WhatsApp Cloud API ·     │
                    │ Accounting (MyInvois-capable) · Storage ·   │
                    │ eTRIS packet generation (no API)            │
                    └─────────────────────────────────────────────┘
```

No .NET, no separate application server, and no Microsoft Agent Framework: the write spine (`app.perform_action`, `app.decide_approval`, `app.bulk_decide`) is SQL, `SECURITY DEFINER` with `SET search_path = ''`, called by the browser directly through a thin `authenticated`-granted wrapper — one fewer hop and one fewer place to duplicate the policy logic. **n8n is optional** — kept for ingestion/glue only if [CLIENT] still wants it after Phase 0; it is not committed in this pack.

### 3.2 Key design decisions
- **Postgres-native, not a modular monolith with a separate API tier.** Schemas per module (`crm.*`, `training.*`, `compliance.*`, `finance.*`, `automation.*`, `core.*`) exist today as the schema layout. The browser calls SQL functions directly through PostgREST — `core.perform_action` (a thin, `authenticated`-granted wrapper over the `service_role`-only gate functions) plus one function per read PostgREST cannot express as a plain table or view. No second application layer re-implements the same rules in a second language.
- **Action envelope → policy → outcome.** Every human or agent action is `{type, target, payload, requester, confidence, reasoning, evidence}`; the policy engine — SQL functions, not application code — returns EXECUTED, QUEUED_FOR_APPROVAL or SUGGESTED, evaluated once and logged once per action.
- **Provenance, approvals, audit are first-class.** Every AI element carries origin, confidence, model/provider, sources, approver and time. Audit is append-only at the database.
- **Rules registry ("cheap graph").** Circulars, scheme guides and the ACM are distilled into effective-dated rules with source spans and a `check_key`. Date, cost and tax checks are deterministic (zero tokens). New circulars trigger model-proposed rule diffs that a human approves; nothing is inserted active from a research pass alone.
- **Orchestrator with scoped sub-agents.** Small cached orchestrator context plus a database-backed state card; sub-agents (reader, matcher, drafter, verifier) receive only what they need and return findings. Checkpointed, resumable runs, driven from the worker below rather than an Edge Function's wall clock.
- **Deterministic first.** Costing, commissions, date windows, ACM ceilings and SST are code and configuration, not model output. Models never compute money or tax.
- **Tenancy from day one.** `tenant_id` + row-level security (forced) on every table.

**SST policy table** (training/coaching is Group G taxable — §1.5):

| Document | Default SST posture | Rate | Basis |
|---|---|---|---|
| Quotation | Standard-rated | 8% | Group G (Professionals), standard-rated since 1 Mar 2024 — a sent quotation should show the client's true payable |
| Invoice (to [CLIENT]'s own clients) | Standard-rated by default; exemption allowed only with an explicit, recorded justification | 8% / 0% | Exemption applies only to Education-Act-1996-registered institutions — not a corporate training provider |
| [VENDOR]'s own fees to [CLIENT] | Per [VENDOR]'s own SST registration status | — | Outside TrainOS's schema; a commercial matter, noted at §7.8 |

Every SST posture change away from standard-rated is logged with who asserted it and on what basis — an auditable decision, not a silent schema default.

### 3.3 Platform stack
| Layer | Choice | Notes |
|---|---|---|
| DB / auth / storage / realtime / API | Supabase Pro (Singapore) | Postgres, RLS, pgvector (HNSW, `hnsw.iterative_scan = relaxed_order` set on every tenant-filtered retrieval RPC), pg_cron, Vault; PostgREST serves reads and RPC-backed writes directly — no separate API server |
| Write spine | SQL RPCs in `core`/`app` schemas | `app.perform_action`, `app.decide_approval`, `app.bulk_decide`, called through a thin `core.perform_action` wrapper granted to `authenticated`; **no Edge Functions** — the platform's 2-second CPU-time budget and `EarlyDrop` worker retirement rule them out for redaction, hashing and longer-running work — and **no .NET, no Agent Framework** |
| Background worker | One Node worker on Railway | Claims `app.outbox` jobs (`FOR UPDATE SKIP LOCKED`), runs the agent runtime, sends email/WhatsApp, publishes events; connects to Postgres directly as `service_role` — the anon key is never used; `/healthz` reports unhealthy after consecutive claim failures |
| Automation edges | n8n — **optional, pending [CLIENT]**; not committed in this pack | Ingestion/glue only if retained; permitted for client-internal use† |
| Compute | Railway (Singapore), one worker process; Supabase hosts the rest | One bill for the worker and any retained n8n instance |
| Internal UI / portals | React / Next.js | Dense ops UI; client, participant, trainer portals; public forms; calls Supabase directly through PostgREST |
| LLM access | OpenRouter + direct BYOK; three-vendor STRONG jury (Anthropic, Google, OpenAI) with a host allow-list keeping DeepSeek/Qwen off China-hosted infrastructure | See §4.1 |
| Observability | OpenTelemetry + Langfuse | LLM traces, cost per run, evals; self-hostable; 90-day auto-purge on raw prompt/response traces (PDPA storage limitation) |
| Messaging | Meta WhatsApp Cloud API (direct); client mailbox via API; Resend transactional | |

### 3.4 Data residency, PDPA and model-provider data handling
Default hosting Singapore (Supabase's nearest managed region — there is no managed Supabase region in Malaysia). **Malaysia hosting means self-hosting the open-source Supabase stack on AWS `ap-southeast-5` directly**, which shifts patching, backup and HA onto [VENDOR]; priced as a distinct option if [CLIENT] requires residency. [VENDOR] as processor; both parties appoint a DPO — under the amended PDPA, [VENDOR] as processor now carries direct statutory liability on the Security Principle regardless of [CLIENT]'s own DPO threshold. Cross-border transfers rely on a self-assessment that the receiving jurisdiction's protection is substantially similar or adequate (amended s.129, in force 1 Apr 2025) — there is no more Minister-approved whitelist to point to. **PII never goes to DeepSeek's own API** (China-hosted) **under any configuration**; DeepSeek and Qwen models are consumed through OpenRouter pinned to named non-China hosts (Baseten, Fireworks, Azure), PII is pseudonymized — a reversible, tenant-scoped token map, not one-way redaction, so extraction agents can still reason over named individuals — before any model call, and sensitive drafting runs on providers with signed data-processing terms.

### 3.5 Security controls
Least-privilege tool scopes per agent; inbound email/WhatsApp treated as untrusted (prompt-injection isolation); per-action kill switches; idempotency keys on every send/create; dead-letter queue with operator retry; secrets in vault; PII masking in traces; backup/restore drills; breach procedure aligned to the PDPA guideline.

---

## 4. AI model strategy and token economics

### 4.1 Tiers
Bound to `packages/agent-runtime/src/routing/config.ts` (the shipped code); this table follows the code, not the reverse — see the v3 changelog.

| Tier | Model (launch) | USD per 1M tokens (in / out)† | Used for |
|---|---|---|---|
| CHEAP | Qwen3.7 Flash via OpenRouter, pinned to a non-China host | 0.03 / 0.13 | Dedupe, routing, language detection, opportunity conversion, enquiry archive |
| FAST | DeepSeek V4.1-Flash via OpenRouter, pinned to a non-China host | 0.15 off-peak / 0.30 peak · 0.60 off-peak / 1.20 peak out | Assistant chat, classification, drafts, summaries |
| FAST-UI | gpt-oss-120B via Groq (zero data retention) | 0.15 / 0.60 | Sub-second UI responses |
| MID | DeepSeek V4 Pro, direct API | 0.66 off-peak / 1.32 peak · 1.98 off-peak / 3.96 peak out | TNA extraction, matching, packet checks, eval grading. **Flagged, not fixed**: this tier reads the same class of PII-bearing inbound content as CHEAP/FAST but remains on DeepSeek's direct API rather than a pinned non-China OpenRouter host — a known compliance gap scheduled as a follow-up, not shipped silently |
| STRONG ×3 (jury, three vendors) | Claude Sonnet 5 (Anthropic) · Gemini 3.1 Pro via OpenRouter (Google) · GPT-5.2 via OpenRouter (OpenAI) | 2.00 / 10.00 · 2.00 / 12.00 · 1.75 / 14.00 | Proposal drafting; long-document verification; third vote. Rebalanced from the prior binding, which put two of three jurors (Sonnet 5, Opus 5) on Anthropic — a 2-of-3 quorum that could not catch an Anthropic-specific failure mode |
| DEEP THINK | Claude Opus 5 | 5.00 / 25.00 | Rule conflicts, ambiguous cases — unchanged; no exploration doc sized this tier's volume |
| SPECIAL | Claude Opus 5 | 5.00 / 25.00 | Capped: rule-change interpretation, top-threshold approvals |

Gemini 3.1 Pro's quoted rate reflects a post-preview GA price roughly double the preview rate — **confirm GA status directly against ai.google.dev before quoting.**† All 24 governed action types now carry an explicit tier and jury policy (was 9 of 24; the other 15 fell silently to a MID default with no jury — closed in this pass). DeepSeek/Qwen calls carry a code-enforced host allow-list (Baseten, Fireworks, Azure), because OpenRouter's default routing does not guarantee a non-China host.

Routing: DeepSeek's peak hours (01–04 and 06–10 UTC weekdays) are Malaysian working hours, so interactive traffic uses third-party hosts without peak pricing and batch runs off-peak at night. Prompts are cache-first. OpenRouter passes through provider rates with a 5.5% fee on Stripe top-ups; BYOK usage is fee-free up to USD 25,000/month list-price inference cost.† DeepSeek's cheaper V4.1-Flash refresh has already shipped — not a pending announcement, so the earlier "announced September 2026" hedge is dropped.

### 4.2 Monthly AI cost at three volumes
Baseline = 80 enquiries, 40 proposals, 25 engagements, 300 follow-ups, 600 participant messages, 120 collection touches, 40 HRDC packets, 1,000 assistant turns/month.

Two estimates, shown together rather than collapsed into one: a **top-down placeholder** (carried since v2) and a **bottom-up sum**‡ of the eight AI-exploration docs' own per-action token estimates, priced at the tiers actually bound in `routing/config.ts` (§4.1). The bottom-up sum comes in well below the placeholder at every volume — every exploration doc independently flagged its own estimate as a rounding error against the placeholder, and summing them confirms it. The likeliest explanation is unsized DEEP-THINK, jury and assistant-turn volume plus a deliberate safety margin in the placeholder, not an error in either figure — both are shown so nothing here reads more precise than the underlying evidence supports.

| Volume | Top-down placeholder (USD / RM) | Bottom-up from exploration-doc token math‡ (USD / RM) | Equivalent |
|---|---|---|---|
| Baseline | 25–40 / ~110–180 | roughly 2–3 / under RM 15, before cache discounts | — |
| 3× | 75–120 / ~340–540 | roughly 6–8 / a few tens of RM | ≈ 0.15 FTE (top-down) |
| 10× | 250–400 / ~1,100–1,800 | roughly 20–25 / under RM 100 | ≈ 0.35 FTE at RM 3.5–5k/month (top-down) |

Treat the top-down row as the conservative planning number until 1,000 assistant turns/month and jury/DEEP-THINK volume are actually sized against [CLIENT]'s real usage; treat the bottom-up row as the floor. Budget caps per agent and per action type are enforced in code regardless of which estimate proves closer.

### 4.3 Recurring platform costs (pass-through, monthly)
Supabase Pro USD 25 (includes PostgREST, RLS, pgvector Micro compute, pg_cron, Vault; add USD 15/month once the knowledge base reaches roughly 10 tenants' worth of vectors — §5) · Railway, one Node worker only (no separate API/portal process) USD 15–25 · transactional email USD 20 · observability/errors USD 0–30 · WhatsApp — **the 1 Oct 2026 change raises this line, not lowers it**: utility-template messages sent inside the 24-hour service window, and service messages beyond a new 1,000-free-per-number-per-month allowance, both become billable again, on top of the existing ≈ RM 50/month broadcast baseline (at ≈ RM 0.35–0.42/marketing message, ≈ RM 0.05–0.07/utility message) — re-verify against Meta's own rate card once [CLIENT]'s real in-window volumes are known, before this line is finalised · accounting connector RM 0–300. **Total at baseline still planned at ≈ RM 1,000–1,300**, pending that WhatsApp re-verification and the smaller Railway footprint from dropping the separate API tier — a number to firm up in Phase 0, not to under-quote now — billed to [CLIENT]'s own accounts (recommended) or passed through with a 15% handling fee; live usage visible in-app.

### 4.4 BYOK
[CLIENT] owns its provider keys (OpenRouter, Anthropic, DeepSeek-via-host, Google, OpenAI, Cerebras/Groq). Keys are scoped to tiers, capped monthly, rotatable, and billed to [CLIENT] directly.

---

## 5. Knowledge corpus and monitoring (what keeps the compliance engine true)
| Tier | Sources | Cadence | Use |
|---|---|---|---|
| A · Regulatory | HRD Corp employer/TP circulars, scheme pages (SBL-Khas, HCC), Allowable Cost Matrix, eTRIS guides/FAQs, HRD-TDF rules, focus areas, exemptions; LHDN e-Invoice guidelines, SST; PDP Commissioner guidelines (DPO, breach, cross-border); national AI governance guidelines | Weekly diff; rule-change review on change | Rules registry; citations in compliance checks |
| B · Commercial | HRD Corp claimable-course directory, top-50 competitor catalogues, Bursa sustainability requirements, national skills frameworks, MDEC/SME Corp/MIDA grant pages, Budget | Monthly | Programme development, cross-sell, grant tracking |
| C · Platform | Meta WhatsApp pricing/policy, model provider price pages, OpenRouter, hosting status/pricing | Weekly | Usage screen, quarterly re-baseline |
| D · Client-internal (with consent) | Catalogue, trainer profiles/certs, past proposals, TNAs, evaluation forms, SOPs, templates, historical enquiries and outcomes, attendance | Continuous | Knowledge base and eval golden set |
Mechanics: scheduled fetch → hash/diff → PDF-to-text → strong-model rule-diff proposal → human approval → effective-dated, versioned, cited. Public pages only; nothing behind the eTRIS login.

---

## 6. Implementation plan

### 6.1 Phases
| Phase | Weeks | Deliverables | Exit criteria |
|---|---|---|---|
| 0 Discovery & blueprint | 1–3 | Process maps (14 areas); systems/data inventory; approval matrix and thresholds; HRDC rules encoded; integration boundary sign-off; golden-path spec; NFRs; grant-eligibility scope; firm Phase 1 quote | Blueprint accepted |
| 1 Sales golden path — live | 4–15 | CRM core; enquiry inbox on the real mailbox/WhatsApp; TNA; catalogue; proposal builder; costing engine with claimable-date computation; approval inbox and policy engine; follow-up queue; client proposal page; agent registry, run traces, usage dashboard; shadow → Suggest | Used daily by Sales; evals ≥ target; ≥ 2 action types at Suggest |
| 2 Operations & compliance engine | 16–27 | Engagements; trainers (accreditation, availability, matching); scheduling with grant-window guard; participants/registration; attendance capture and lock; assessments/certificates; HRDC packet builders; rules registry and rule-change review; corpus monitor; **levy radar** | One engagement end-to-end; zero date-rule violations |
| 3 Finance | 28–35 | Invoice push with sync status; AR aging; collections escalation; commissions; trainer payables; margin reporting | Invoices flow with MyInvois validation visible; collections at Act-with-approval |
| 4 Intelligence | 36–41 | Executive/sales/ops/finance dashboards with drill-through; renewal radar; cross-sell; forecasting; hours-saved ledger | Management uses dashboards weekly |
| 5 Continuous | ongoing | Autonomy promotions, new agents, model/cost tuning, integrations | Monthly review |

### 6.2 Cadence, testing, rollout, team
Weekly 30-minute stand-up; fortnightly demo; phase-end review of evals, autonomy and cost; UAT sign-off by the named process owner. Unit/integration/contract tests; agent evals on [CLIENT]'s historical data; shadow mode before any agent leaves Observe; feature flags and kill switches. [VENDOR]: solution architect/lead engineer, developer, shared QA/eval engineer. [CLIENT]: sponsor ([ALEX]), process owners (Sales, Ops, Finance/Compliance), DPO contact, accounting/IT contact.

### 6.3 Success metrics (baselined in Phase 0)
Enquiry first-response time · proposal turnaround · win rate · claims rejected/lost to date rules · DSO · admin hours per engagement · engagements per admin FTE · agent accuracy and autonomy level per action type · cost per engagement · levy-radar conversions.

---

## 7. Commercial proposal

### 7.1 Implementation
| Phase | RM | Payment |
|---|---|---|
| 0 Discovery & blueprint | 10,000 | On engagement; 50% credited to Phase 1 |
| 1 Sales golden path — live | 40,000 | 40% start · 40% UAT · 20% go-live |
| 2 Operations & compliance engine | 50,000 | same |
| 3 Finance | 30,000 | same |
| 4 Intelligence | 20,000 | same |
| **Build total** | **150,000** | Phases 2–4 indicative; confirmed at each gate |

### 7.2 Managed service
RM 5,000/month from Phase 1 go-live: business-hours monitoring and incident response, agent tuning and prompt versioning, eval runs and drift checks, autonomy reviews, patching, backups, 10 development hours/month, monthly cost and performance report. Additional work at RM 180/hour or scoped change requests. After-hours support is a priced tier.

### 7.3 Recurring third-party costs
Pass-through at cost (≈ RM 1,000–1,300/month at baseline; §4.2–4.3).

> **Note on §7 prices (v3).** The architecture and cost changes in §3–§4 — dropping the separate .NET API tier, the routing-config and AI-cost re-baseline, and the WhatsApp fee change — are **not** reflected in the RM figures in §7.1/§7.2/§7.6 below. Those build and managed-service prices carry over unchanged from v2 pending a Phase 0 re-quote against the actual, simpler implementation effort. Do not read the lower recurring pass-through estimate at §4.3 as already priced into the figures below.

### 7.4 Founding-client terms (optional)
10% off implementation in exchange for reference and case study rights; [VENDOR] retains the reusable core (policy engine, approvals, agent harness, rules registry) and may reuse it; [CLIENT] receives founding-customer pricing on any productised version; [CLIENT] owns all data, configuration, templates and customisations. Exclusivity is available as a priced option (named competitors, 12 months).

### 7.5 Government co-funding (to verify with [CLIENT]'s accountant; not assumed in prices)
- MSME Digital Grant MADANI: 50% matching up to RM 5,000, claimed via an MDEC-registered Technology Solution Provider.†
- Malaysia Digital Acceleration Grant (MDAG): RM 53m in Budget 2026 for companies adopting or building with AI; typically RM 50,000–100,000 per project; requires Malaysia Digital status (pending application acceptable).†
- MDAG-AI: up to 70% of eligible costs, capped at RM 2m, milestone-based; MD status, RM 50,000 paid-up capital, one year operating.†
- 50% additional tax deduction for certified AI/cybersecurity training; Accelerated Capital Allowance on ICT and software.†

### 7.6 Year-one total
| | RM |
|---|---|
| Implementation (Phases 0–4) | 150,000 (135,000 with founding terms) |
| Managed service (≈ 8 months) | 40,000 |
| Third-party pass-through (≈ 8 months) | ≈ 8,000–10,000 |
| **Year one, before grants** | **≈ 183,000–200,000** (≈ 168,000–185,000 with founding terms) |

### 7.7 Market context for the price
Malaysian software houses quote RM 60,000–150,000 for mid-complexity CRMs and RM 150,000–500,000+ for ERP/multi-tenant platforms, plus RM 20,000–80,000 for AI features;† specialist AI agencies quote RM 65,000–130,000 for multi-workflow suites with retainers of RM 8,500–17,000/month;† small automation shops deliver one or two workflows for RM 8,000–15,000 and RM 1,500–2,000/month.† TrainOS sits below the software-house range with vertical, compliance-aware scope none of them carry, at roughly half the specialist retainer.

### 7.8 Assumptions, exclusions, terms
Access to mailbox/calendar tenant, WhatsApp Business account, accounting package and sample documents in Phase 0 · eTRIS submission manual · e-Invoicing by the accounting package · third-party fees excluded · mobile apps excluded (mobile-optimised web included) · migration beyond CSV import scoped in Phase 0 · prices exclude SST. IP: [CLIENT] owns data, configuration, bespoke customisations; [VENDOR] retains the core framework under a perpetual licence to [CLIENT]. DPA aligned to the PDPA 2010 as amended. Per-phase acceptance within 10 working days; 30-day warranty per phase; 30 days' notice on managed service with full export; source code escrow available.

---

## 8. Risks and mitigations
| Risk | Mitigation |
|---|---|
| Agent approves or sends something wrong | Autonomy ladder; thresholds; shadow mode; kill switches; evals on [CLIENT]'s data; evidence and diff before every approval |
| HRD Corp changes rules or the portal | Rules registry with effective dates; weekly monitor; human-approved rule changes; versioned packet templates |
| Client PII to overseas model providers | No PII to DeepSeek direct; PII redaction before model calls; DPAs; Malaysia hosting option |
| Prompt injection via inbound email/WhatsApp | Untrusted-content isolation; read-only classification scopes; policy-gated sends |
| WhatsApp number restrictions | Template category discipline, consent registry, verification, opt-out handling |
| Model price/availability shocks | Multi-provider routing, fallbacks, caps, quarterly re-baseline |
| Data residency objection | Same system on AWS Malaysia |
| Adoption | Role-based navigation; champions; hours-saved ledger; nothing removed until proven |
| Key-person and vendor risk | Standard .NET/Postgres stack; code in [CLIENT]'s repo; documentation; escrow; month-to-month service |
| Scope creep | Phase gates; priced change requests; discovery blueprint as reference |
| Data migration | Discovery samples; import wizard with error reports; separately scoped |
| Policy dependence of the sector | Levy radar and rules registry turn policy change into a sales signal rather than a surprise |

## 9. Why [VENDOR]
Senior .NET/TypeScript engineering with production experience in ERP-style processes and the failure modes of naive automation · design already done (screen inventory, clickable demo, API contract with story fixtures) — hence a 12-week Phase 1 · Malaysia-specific: Circular 2/2026 encoded, MyInvois boundary respected, PDPA processor posture, WhatsApp economics · risk-sharing commercial model · grant-eligible scope.

## 10. Next steps
1. Demo (60 minutes): golden path, approval screen, engagement with grant-window guard, levy radar, cost dashboard.
2. Discovery kick-off within two weeks; blueprint in three; grant-eligibility check in parallel.
3. Phase 1 start on blueprint acceptance; first shadow-mode run on live enquiries by week 8.

---

## Appendix A — Domain model
Organisation → Contact → Enquiry → Lead/Opportunity → TNA → Programme → Proposal/Quotation → Engagement → Trainer → Session → Participant → Attendance → Assessment → Certificate → HRDC Grant/Claim → Invoice → Payment → Renewal. Cross-cutting: ApprovalRequest, AutomationRun (+steps, state card), Policy, Template, Rule (+edges), LevyPosition, AuditEvent, Tenant, User/Role.

## Appendix B — Example compliance rules
| Rule | Scheme | Condition | Effective | Source |
|---|---|---|---|---|
| Grant approval lead time | In-house (levy-based) | training_start ≥ grant_approval + 14 days | 15 Jun 2026 → | Circular 2/2026 |
| Grant approval lead time | Public | training_start ≥ grant_approval + 3 days | 15 Jun 2026 → 31 Dec 2026 | Circular 2/2026 |
| Grant approval lead time | Public | training_start ≥ grant_approval + 14 days | 1 Jan 2027 → | Circular 2/2026 |
| Commencement window | All | training_start ≤ grant_approval + 90 days | 15 Jun 2026 → | Circular 2/2026 |
| Claim window | All | claim_submitted ≤ completion + 6 months | current, unconfirmed against primary circular text | HRD Corp |
| Trainer accreditation | All | trainer.hrd_tdf_accredited = true | **1 Jan 2025, Circular 6/2024** (3-yr validity, 360h active-training renewal) | HRD Corp |
| Query response deadline | All | query_response ≤ query_raised + 5 calendar days, else application expires | 15 Jun 2026 → | Circular 2/2026 |
| Fee ceiling (in-house) | In-house | course_fee ≤ RM 1,500/hour, ≤ RM 10,500/day per group | set 1 Nov 2024, restated Jan 2026 guidebook | ACM |
| Fee ceiling (public) | Public | course_fee ≤ RM 1,750/pax/day | set 1 Nov 2024, restated Jan 2026 guidebook | ACM |
| Meal allowance ceiling | All | meal_cost_per_pax within RM 15–25 (one conflicting source cites RM 100/pax/day, unresolved) | set 1 Nov 2024, restated Jan 2026 guidebook | ACM — pending primary-PDF confirmation |
| Attendance immutability | All | locked after approval | current | eTRIS |
| Unused-levy forfeiture | Employer | balance above RM 10,000 forfeited after 24 months without claim | 1 Jan 2020 → | Circular 7/2019 |
| 15% deduction | Employer | balance > RM 50,000 and utilisation < 50% → 15% of excess | Mar 2025 → | HRD Corp |

**"Utilisation" is not formally defined by HRD Corp.** Every source states only the trigger condition, never a formula. TrainOS's working definition — claims approved in the calendar year ÷ that year's levy contribution, not the accumulated balance — is an inferred assumption, flagged to confirm with [CLIENT] and, where possible, HRD Corp during discovery (§2.4).

## Appendix C — API conventions (summary)
REST/JSON under `/v1`; tenant implicit from auth; money as integer minor units MYR; ISO-8601 +08:00; filters, saved views, cursor paging; provenance envelope on AI-touched records; idempotency keys; `/v1/actions` through the policy engine → EXECUTED / QUEUED_FOR_APPROVAL / SUGGESTED; outbox domain events; realtime channels; inbound webhooks (email, WhatsApp, proposal acceptance, accounting callbacks).

## Appendix D — Screen inventory (summary)
~160 screens across 23 modules designed; 20-screen demo pack built (dashboard, enquiry inbox/detail, TNA, programme, proposal builder, costing, approval inbox/detail, client proposal page, follow-up queue, organisation 360, engagement, attendance-locked, HRDC packet builder, invoice, collections queue, agent registry, run trace, demo script). Settings include AI model tiers, provider keys (BYOK), usage and budgets, rules registry, rule-change review, corpus monitor.

## Appendix E — Objections [CLIENT]'s stakeholders may raise, and the answers
| Objection | Answer |
|---|---|
| RM 150k for a vendor we know personally? | Priced under every software-house quote and half the agency retainer; each phase is paid only after the previous one runs; grants may co-fund a share. |
| AI will get HRD Corp wrong and we lose claims. | The system never submits to eTRIS; it prepares, scores completeness and counts down. A person submits. Today claims are lost without any of that. |
| Why not Zoho/HubSpot/Odoo? | None of them know Circular 2/2026; per-seat forever; we'd still build the HRD Corp logic with a vendor who has never heard of SBL-Khas. |
| This replaces our people. | It replaces the admin between people. Sales still sells, Ops still runs training, Finance still approves. The retyping, chasing and packet assembly go. |
| It's a chatbot / AI hype. | The approval screen shows evidence, what differs from normal, risk, and exactly what changes on approval. Operations system, not chatbot. |
| Our data goes overseas / to China. | Our own keys; PII redacted before any model; sensitive work on providers with data terms; Malaysia hosting available. |
| What if the vendor disappears? | Standard .NET/Postgres, code in our repo, documented, escrow, month-to-month service. |
| Why not wait a year? | The June rules are live now; every month is deals scheduled by hand against a 14-day clock; first movers win the accounts. |
| AI costs will run away. | Hard caps per agent; at 10× volume the model bill is under a third of one admin salary; on our accounts, visible on a screen. |
| Who owns it? | We own data, config, templates, customisations; the vendor keeps the generic engine, which is why the price is what it is. |
| How do we know it works? | Shadow mode on our real enquiries; nothing goes live until scores on our own history are good enough, and we set the bar. |
| HRD Corp will change the rules again. | Rules registry proposes what changed with the paragraph highlighted; our compliance person approves it. |
| Custom software always overruns. | Fixed-price discovery; fixed-price phases quoted after the last one ships; screens and API contract already exist. |

## Appendix F — BD notes for [VENDOR] (internal, remove before sending)
Register as an MDEC TSP; help [CLIENT] apply for MDAG/MDAG-AI in parallel with discovery · identify the economic buyer and the adoption saboteur in Phase 0 · check own employment contract for moonlighting/IP clauses; contract via Sdn Bhd; PI insurance; SST registration at RM 500k · 40% on phase start non-negotiable · never say "guarantee" about AI accuracy · second-client pipeline from month 6 (professionalised providers with a sales team, an ops person and a finance person).

## Appendix G — Glossary
ACM — Allowable Cost Matrix · eTRIS — HRD Corp grant/claim portal · HCC — HRD Corp Claimable Courses · HRD-TDF — trainer accreditation · MDAG — Malaysia Digital Acceleration Grant · MyInvois — LHDN e-invoicing · PDPA — Personal Data Protection Act 2010 (amended 2024) · SBL-Khas — levy-debited scheme · TNA — Training Needs Analysis · TSP — Technology Solution Provider · BYOK — bring your own key.

## Appendix H — Sources to re-verify before sending (†)
- HRD Corp 2025 results: hrdcorp.gov.my (13 Jan 2026 release); nst.com.my (16 Jan 2026)
- Levy series 2020–2023, utilisation, AG/PAC: theedgemalaysia.com (4 Jul 2024)
- HRD Corp Annual Report 2023 KPIs (employers, places, trainers, disbursement): HRD Corp AR 2023 (digital version)
- Circular 2/2026 and claimable-course rules: hrdcorp.gov.my/hrdcorp-claimable-courses; pandahrms.com; biztrak.com; nexustac.com; corporatetrainingmalaysia.com/hrdf-news
- Forfeiture and 15% deduction: supportcentre.hrdcorp.gov.my; otc.com.my; corporatetrainingmalaysia.com/hrd-corp-levy-deduction
- Levy and SBL-Khas mechanics: carrieragroup.com.my; kcgroup.biz; ezlease.my (47% claim figure — secondary)
- Provider counts: etris.my; corporatetrainingmalaysia.com
- ACM ceiling: hrdcorp.gov.my (home)
- eTRIS claim steps and attendance immutability: hrdtraining.mohdibrahim.com
- e-Invoicing: cleartax.com/my; malaysia4u.com/einvoicing-guide; einvoicingmalaysia.com
- PDPA amendments: mayerbrown.com (Jul 2025); oneasia.legal; dlapiperdataprotection.com
- WhatsApp Malaysia rates: whautomate.com; forwardchat.my; qiscus.com
- Model prices and routing: intuitionlabs.ai; morphllm.com/deepseek-v4 and /deepseek-api; cloudzero.com; benchlm.ai; tokendyno.com
- OpenRouter fees: openrouter.ai/pricing (via usagepricing.com, ofox.ai)
- Microsoft Agent Framework GA: devblogs.microsoft.com/agent-framework
- n8n licence: docs.n8n.io/sustainable-use-license
- Grants: gritc.com.my; aitraining2u.com; gotchaa-lab.com (MDAG-AI); marketinglancers.com.my
- Malaysian market pricing: techies.app; gotchaa-lab.com; thecrunch.io; bixtech.co; zenweb.my
- Circular 6/2024 (HRD-TDF mandatory, eff. 1 Jan 2025) and validity/renewal: hrdcorp.gov.my/wp-content/uploads/2025/01/HRD-TDF-FAQ-022024-1.pdf; hrdcorp.gov.my/hrd-tdf
- Circular 1/2026 (education-sector levy exemption): hrdcorp.gov.my/circulars; businesstoday.com.my (14 Jan 2026)
- Circular 2/2026 query-deadline and ACM vintage (PDF URLs 404'd on direct fetch this pass — open in a browser before citing): hrdcorp.gov.my/wp-content/uploads/2026/05/Employer-Circular-22026.pdf; nexustac.com
- SST on training/coaching (Group G, 8% since 1 Mar 2024): mysst.customs.gov.my — Guide on Consultancy, Training or Coaching Services; bdo.my SST rate/scope update
- MyInvois Phase 4 and relaxation dates (re-verify v4.7 dates directly): hasil.gov.my e-Invoice Guideline v4.6; vatupdate.com summary of v4.7
- PDPA amendment dates and penalties: pdp.gov.my; privacymatters.dlapiper.com; mayerbrown.com; lexology.com; sidley.com
- Model pricing, 2026-09-13 re-baseline: claude.com/pricing; api-docs.deepseek.com/quick_start/pricing; openrouter.ai/pricing; ai.google.dev/gemini-api/docs/pricing; developers.openai.com/api/docs/pricing
- WhatsApp 1 Oct 2026 change (primary CSV not directly confirmed; converging secondary sources): developers.facebook.com/documentation/business-messaging/whatsapp/pricing; wati.io; sendpulse.com; respond.io; pickyassist.com; qiscus.com; raiontech.com
- pgvector/Supabase current behaviour: supabase.com/docs (pgvector, RLS, Edge Functions, pg_cron, pg_net, Vault, Realtime, pricing)
