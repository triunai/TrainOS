# 06 · Critic review of the Supabase design

Adversarial review of `01`–`05` plus `supabase/migrations/001`–`002`, for the migrations
author to act on. Every claim below was verified against the document text and is quoted.
Designers' own summaries of their work were not trusted; where a doc claims a property,
the claim was checked mechanically and the result is stated either way.

## How to read this, and the snapshot it is against

Four of the five documents were **being rewritten while this review ran**. `01`, `03` and
`05` changed under two separate verification passes; `03` flipped its domain schema from
`core.*` to `public.*` and back inside one hour. Line numbers in a churning file are
worthless, so this review is pinned to a frozen copy. Re-grep before acting on any
citation; the finding will still be there, the line number may have moved.

| File | MD5 at review time |
|---|---|
| `docs/architecture/01-domain-model.md` | `535aef741265e63dbba0b5f232eb6360` |
| `docs/architecture/02-tenancy-auth-rls.md` | `9cafc9a256e69f0ead7c40854a6a5b33` |
| `docs/architecture/03-action-envelope-and-policy-gate.md` | `b348b4a38e7958c0ce6e79fc23556e9a` |
| `docs/architecture/04-money-versioning-provenance.md` | `fdcd825a6b631167d1476904295e3bc9` |
| `docs/architecture/05-events-outbox-realtime-audit.md` | `620a98c6e1f8ea537b931c020ab8a0f7` |
| `supabase/migrations/001_foundation_schemas_and_helpers.sql` | `91cf828720227b38a453859b56467bf0` |
| `supabase/migrations/002_tenancy_identity_and_permissions.sql` | `26cac83f43627d8ef2165b4dffe8f242` |

Citations are `file:line` against that snapshot. `docs/architecture/spikes/` is empty: the
agent JWT minting spike does not exist, which matters for `H-14`.

## Verdict

The individual lanes are strong. The policy gate's evaluation order is faithful to §3, the
money model is faithful to §18 and DECISIONS §7, the two-axis compliance rule versioning is
the best-engineered thing in the pack, and policy *hygiene* in doc 02 is genuinely
excellent — 56 of 56 policies are role-qualified and 0 have an InitPlan violation, both
checked mechanically rather than taken on the doc's word.

The pack fails at the seams. Five lanes each built a coherent world and the worlds do not
share names, schemas, column suffixes, or a rounding function. The two defects that will
cost the most are not subtle: **the policy gate reads four money columns that no document
defines**, and **not one table in the `core` schema has row-level security enabled while
six of them are `SELECT`-granted to every logged-in user**.

**Do not apply migrations 003 onward until `C-01` through `C-05` are settled.** They are
naming and schema decisions; fixing them after tables exist is a data migration, and three
of the divergent columns are `STORED GENERATED`, which `CREATE OR REPLACE` will not
recompute (`04:103-106`).

---

## 0 · The lead's rulings, checked for consistent application

Not relitigated. Checked only for whether the pack applied them.

| Ruling | Applied? | Evidence |
|---|---|---|
| Tenant helper is `app.tenant_id()` | **No — applied nowhere** | `app.current_tenant_id()` appears 61× in `02`, 7× in `05`, 4× in `03`, and is the name migration 002 actually defines (`002:284`). `app.tenant_id()` appears twice in the whole pack, both times in `02:81` *as the name being rejected*. See `H-01`. |
| Outbox is `app.outbox` with `job_type` / `idempotency_key` / `run_after` | Yes | `05:499` creates it; all three columns present. |
| `app.emit_event` 12-arg + 3-arg overload | Yes, but unrevocable | Both exist (`05:162`, `05:254`). The `REVOKE` at `05:238` omits the argument list and will error `function name app.emit_event is not unique`. See `M-09`. |
| `app.settle_effect` exists | **No** | Referenced 5× in `05` (first `05:644`); never defined in any doc. `05:804` calls the write-back `app.record_effect_result` instead. Two names, neither created. See `C-02`. |
| Schemas `core` / `app` / `public` as in 001 | **Partially, and `03` argues against it in prose** | `01:59-68` now says core. `02:87` accepts core but its §4 catalogue still carries 66 `public.*` references. `03:165-177` still states *"The domain schema is **public**"* while its own DDL uses `core.*` 162 times and `public.*` zero times. See `C-01`. |
| `Effect.op` = `DiffLine.op` = `ADD\|UPDATE\|REMOVE`, `CREATE` → `ADD` | Yes | Consistent across `03` and the contract package (`actions.ts:137`). |
| Two independent price floors, higher binds | Yes | `04:243` `greatest(programme_floor_price_sen, ceil(direct_cost_sen / (1 - floor_margin_rate)))` with `binding_floor` recording which. |
| Agent principal = hashed API key → short-lived JWT, inert `auth.users` row, self-minting UNVERIFIED | Ruling applied; **spike absent and `02` closed the question against it** | `02:88` states *"**Nobody mints tokens. Ever.** All tokens are GoTrue-issued"*. `docs/architecture/spikes/` is empty. See `H-14`. |
| `sb_publishable` / ES256 key model | Yes | `02` §7.3, §11. |
| Portal tokens 30 days, read-only after acceptance | Stated, **not implemented** | `02:1809-1816` describes it in prose; the RPCs that would enforce it are not written, and `portal_get_proposal` is declared `stable`, which forbids the writes its own text promises. See `H-11`. |
| Saved views shared + personal | Yes | `visibility view_visibility NOT NULL DEFAULT 'PRIVATE'`. |
| Approval `EXPIRED` at 24h, MD escalation at 6h | Yes | `03:328` `expire_after_minutes … default 1440`; `03:327` `escalate_after_minutes default 360`. |
| Diff staleness via sha256 → 409 | Yes | `03:2260-2278`. |
| `firstProposalToOrg` computed live | Yes | `03:1278`. |
| Provenance shape is 04's call over 01's | Yes | `04:643` `create table app.provenance`. But `04` puts it in the unexposed `app` schema — see `C-03`. |

---

## 1 · Cross-doc name and shape mismatches

The migrations author needs one name per thing. Today there are two or three. This is the
table to settle before writing 003.

### 1.1 Blocking mismatches

| # | Concept | Doc 01 (sb-erd) | Doc 02 (sb-tenancy) | Doc 03 (sb-actions) | Doc 04 (sb-money) | Doc 05 (sb-events) | Migration | Verdict |
|---|---|---|---|---|---|---|---|---|
| N1 | Money column suffix | `_sen` (91×, `01:132`) | — | **`_minor` (37×, 0 `_sen`)** | `_sen` (91×) | `cost_minor` (4×) | — | **`_sen`** wins 3 lanes to 2. `03` must be rewritten. |
| N2 | Rounding function | `round_half_up` (`01`, 2×) | — | — | `app.round_half_up_sen` (9×, incl. 3 stored generated columns) | — | `app.round_half_up_minor` (`001:71`) | Pick one **now**. `001:9-12` exists to prevent exactly this. |
| N3 | Tenant helper | — | `app.current_tenant_id` | `app.current_tenant_id` | — | `app.current_tenant_id` | `app.current_tenant_id` (`002:284`) | Lead ruled `app.tenant_id()`; nothing uses it. Ratify `current_tenant_id` or change 74 sites. |
| N4 | Autonomy table | `agent_autonomy` (`01:1852`) | `core.agent_autonomy` (`02:1615`) | **`core.autonomy_grants`** (`03:248`) | — | — | — | One name. `02:1640` calls its policy on the *non-existent* table *"the single most important line in this document"*. |
| N5 | Invoice header | `invoices` (plural, `core`) | — | `core.invoices` | **`app.invoice`** — referenced 9×, **never created** | — | — | `app.invoice` is a dangling FK target at `04:117`. |
| N6 | Quotation | `quotations` | — | `core.quotations` | `app.quotation` (4×, never created) | — | — | Same defect. |
| N7 | Compliance rules | `compliance_rules` (`01:1616`) | `core.compliance_rule` (`02:1183`) | `core.compliance_rules` | `app.compliance_rule` (`04:396`) | — | — | Three spellings, two schemas, singular vs plural. |
| N8 | Rule set | `rule_set_versions` | — | — | `app.rule_set` (`04:387`) | — | — | |
| N9 | Model tiers | `ai_tiers`, status **stored** | — | — | `app.model_tier`, status **derived as a view** | — | — | Contradictory designs, not just names. |
| N10 | Routing | `ai_routing_entries` + `applies_from` | — | — | `app.routing_matrix_version` + `tstzrange` | — | — | Row-versioning vs version-table. |
| N11 | Hours-saved baseline | `hours_saved_baseline_tables` + `hours_saved_baselines` | — | — | `app.baseline_minutes_version` | — | — | |
| N12 | Evals | `eval_sets` + `eval_runs` | — | — | — | `core.evals` (one table) | — | Different cardinality. |
| N13 | Run execution tree | `run_steps` **and** `run_nodes` | — | — | — | `core.run_nodes` only | — | Contract returns `steps[]` (`agents.ts:293`). `05` drops it. |
| N14 | Guardrails | `run_guardrails` table | — | — | — | `core.runs.guardrails text[]` | — | |
| N15 | Run state card | `run_state_cards` with `agent_run_id` **unique** | — | — | — | `primary key (run_id, version)` — **versioned** | — | `core.run_checkpoints.state_card_version` cannot FK against 01's shape. |
| N16 | `runs.agent_id` | `uuid` FK → `agents` | — | — | — | **`text`** | — | |
| N17 | Effect settlement | — | — | — | — | `app.settle_effect` (5×) **and** `app.record_effect_result` (`05:804`) | — | Neither is defined. Lead ruled `settle_effect`. |
| N18 | Rate domain | `numeric(6,4)` (`01`) | — | — | `create domain app.rate as numeric(6,5)` (`04:45`) | — | — | Different precision for the same rates. |
| N19 | `search_path` spelling | — | 4-part, pinned by `001:396` | **6-part** `pg_catalog, app, core, public, extensions, pg_temp` (`03:2488`) | none on `round_half_up_sen` | **`''`** (every function) | 4-part | `002:269-275` records that `test_001` and `test_014` *"rely on a single spelling"*. Three exist. |

### 1.2 Enum and type names used but never declared

`04` references roughly twenty-five `app.*` enum types in column definitions and declares
**none** of them. `grep -n 'create type' docs/architecture/*.md` returns four hits, all in
`02` (`02:113`, `116`, `118`, `1581`). Missing, non-exhaustively: `app.hrdc_scheme`,
`app.delivery_mode`, `app.rule_side`, `app.rule_kind`, `app.check_state`, `app.rule_op`,
`app.rule_reference_kind`, `app.rule_offset_unit`, `app.rule_status`, `app.pricing_basis`,
`app.sst_reason`, `app.provenance_origin`, `app.provenance_subject`, `app.tier_key`,
`app.ai_provider`, `app.cache_strategy`, `app.routing_strategy`, `app.admin_state`,
`app.tier_health`, `app.budget_state`, `app.hours_basis`, `app.rate_card_status`.

Doc 01 lists 71 enum type names it intends to create (`01:96` onward) — **unqualified**,
so they would land in `core`, not `app`. `04`'s columns would not resolve against them.
**This is a straight blocker: 04's DDL does not compile.** `MEDIUM` only because the fix is
mechanical, but it must happen before 007/010.

---

## 2 · Findings, rated

### CRITICAL

**C-01 · Doc 03 §1 still declares the domain schema is `public`, contradicting its own DDL and every other doc.**
`03:165-167`: *"The domain schema is **`public`**. `01-domain-model.md` §'Schema and naming' is committed and states that all tables live in `public` in the plural"*, and `03:177` tabulates ten gate tables as living in `public`. Doc 01 no longer says that — `01:59-68` now reads *"Three schemas, per the lead's ruling… **Every table in this document is in `core`**"*. Doc 03's own SQL uses `core.*` 162 times and `public.*` zero times.
**Failure:** the prose that a migration author reads for intent says `public`; the DDL underneath says `core`. `03:168` even admits *"The disagreement with migration 001 is live"*. Whoever implements §1 from the prose builds the wrong schema.
**Fix:** delete `03:165-177` and replace with the `001:24-35` ruling. The DDL is already right.

**C-02 · The policy gate reads four money columns that do not exist.**
`03:1216-1237`, `app.action_value`, selects `p.value_minor`, `q.sell_price_minor`, `i.total_minor` and `h.claim_value_minor`. Doc 01 and doc 04 define those columns as `value_sen`, `sell_price_sen`, `total_sen` and `claim_value_sen` (`01:132` *"Two columns per amount: `<name>_sen bigint`"*; `01` invoices table carries `subtotal_sen`, `sst_sen`, `total_sen`).
**Failure:** `app.action_value` does not compile. Every money-moving action type — `INVOICE_CREATE`, `INVOICE_PUSH`, `PAYMENT_RECORD`, `DISCOUNT_APPROVE`, `PROPOSAL_SEND`, `HRDC_PACKET_MARK_SUBMITTED` — cannot be evaluated, so §3 step 2 never runs. This is the function whose entire purpose (`01:127`) is *"so an agent cannot understate a proposal to duck the APV-01 threshold"*.
**Fix:** rewrite all 37 `_minor` references in `03` to `_sen`. Related: `app.settle_effect` / `app.record_effect_result` (N17) and `app.round_half_up_minor` / `_sen` (N2) are the same class and must be settled in the same pass.

**C-03 · Doc 04 puts the entire money and compliance domain in `app`, which is not on the Data API.**
`04` creates `app.invoice_line` (`04:111`), `app.rate_card` (`04:302`), `app.rule_set` (`04:392`), `app.compliance_rule` (`04:401`), `app.provenance` (`04:648`), `app.model_tier` (`04:800`), `app.routing_matrix_version` (`04:865`), `app.baseline_minutes_version` (`04:971`), `app.aging_bucket` (`04:1027`). `001:18` states *"`app` … NOT exposed to PostgREST"*, and `02:87` warns in the cross-lane conventions table: *"A table in `app` is unreachable by the Data API, with no error to explain it… **This has now bitten two lanes.**"*
**Failure:** the invoice list and detail, receivables aging, rate-card screen, compliance rules registry (`GET /v1/compliance/rules`) and the provenance review queue all read a closed schema and return nothing, with no error to diagnose.
**Fix:** retarget every client-readable doc-04 table onto `core` with doc 01's plural names. Doc 03 already took this correction for itself (`03:3152-3158`); doc 04 never received it.

**C-04 · No `core` table has RLS enabled, and six are `SELECT`-granted to every logged-in user.**
`grep -in 'row level security'` across the whole snapshot returns exactly six DDL statements: five identity tables (`002:582-591`) and `app.outbox` (`05:568`). Zero `core.*` tables. Meanwhile `03:1812-1816`:
```sql
grant select on core.v_approval_requests, core.action_types, core.action_policies,
                core.autonomy_grants, core.action_requests, core.suggested_drafts,
                core.jury_configs, core.jury_verdicts to authenticated;
```
Five of those carry `tenant_id` and none has a policy. `core` is exposed (`001:33-35`).
**Failure:** a logged-in user of tenant A issues `GET /rest/v1/action_requests?select=*` and reads every tenant's action payloads, monetary values, approval routing and, via `suggested_drafts.body`, other tenants' draft client correspondence verbatim. Doc 03 knows: `03:1836` says *"The `core` tables need RLS enabled regardless"*. No statement does it.
**Fix:** `enable` + `force` per `core` table in the migration that creates it, plus the Template A policy. Change the §8.7 regression guard, which filters `nspname = 'public'` only (`02:2402`), to `in ('public','core')` — the 86-table `core` schema is currently outside every automated check that would have caught this.

**C-05 · `app.role_permissions` is created, revoked, and never seeded.**
`002:248` creates it; `002:261` revokes everything on it; `grep -i 'insert into' 002` returns **nothing**. Doc 02 specifies the seed at `02:515-518` and `002:13-14` cites *"§2.2/§2.3 (94 permissions, 7 role columns)"* as its source.
**Failure:** `app.has_permission()` (`002:386`) returns false for every permission for every role. Every permission-gated policy denies. The product is a 403 machine on first boot, and the symptom is identical to the hook-grant failure `002:41-46` warns about, so it will be misdiagnosed as an auth bug.
**Fix:** seed the 94 rows in 002 and add a verify assertion that the table is non-empty.

**C-06 · `pg_cron`, `pg_net` and `vector` are not enabled; every scheduled job in the design has no scheduler.**
`001:195-198` installs `pgcrypto`, `citext`, `btree_gist`, `pg_trgm` and `001:377-387` verifies exactly that list — so the migration's own verify block passes while the design is unrunnable. Nine jobs are scheduled across `03:2419-2473` and `05:900-912`, `05:1837`. `01:1748-1751` declares `embedding vector(1536)` with an HNSW index.
**Failure:** no approval escalates, no SLA breach fires, no approval expires, no idempotency cleanup, no worker tick, no lease reaping, no retention. The outbox fills and nothing drains it. The knowledge-source migration will not parse at all.
**Fix:** add `pg_cron` (schema `cron`), `pg_net` (schema `net`), `vector` and `supabase_vault` to 001 and extend the `001:379` verify array. `05:2205` and `03:3219` both flag this as *"the single largest blocker on this design"* — they are right.

**C-07 · The retention table is a fiction: five of six stated mechanisms do not exist.**
`05:1515-1526` tabulates retention for `webhook_deliveries.raw_body` (30 days), `webhook_deliveries` rows (1 year), `app.outbox` SUCCEEDED rows (90 days), `app.dead_letters`, and `cron.job_run_details` (7 days, with the doc's own note that *"Postgres does **not** clean this up and it grows without bound"*). The only implementation is `app.redact_run_io()` (`05:1813`), which touches run I/O only. The whole pack contains two `delete from` statements: `03:2461` and `05:1818`.
**Failure:** the outbox never shrinks, raw provider webhook bodies are retained indefinitely (a PDPA liability, not just a disk one), and `cron.job_run_details` grows without bound by the document's own admission.
**Fix:** write the daily reaper the table promises, batched like `03:2461`, and schedule it.

**C-08 · Poison-pill infinite retry; the stated guarantee is false.**
`05:688-690` claims *"`attempts` increments at claim time… so a worker that dies without reporting still burns an attempt and **cannot loop forever**"*. Nothing enforces it. `app.claim_jobs` (`05:673-682`) selects `where state = 'QUEUED' and run_after <= now()` with no `attempts < max_attempts` predicate, and `app.reap_jobs` (`05:796-803`) returns any expired lease to `QUEUED` with no attempts check and no dead-letter branch.
**Failure:** a handler that kills the isolate (256 MB OOM, `05:861`; 400 s wall clock, `05:858`) never reaches `fail_job`, so the job is re-claimed forever — including `SEND_EMAIL` and `PUSH_INVOICE`, which have real external side effects. An invoice is pushed to the accounting package repeatedly, indefinitely.
**Fix:** add `and j.attempts < j.max_attempts` to the claim, and route `attempts >= max_attempts` to `DEAD` + a dead letter in `reap_jobs`.

**C-09 · PDPA erasure cannot reach the audit trail and no mechanism could be added.**
`core.events` is append-only by trigger and by revoke (`05:72-81`), retention *"Indefinite. None. This is the business record."* (`05:1517`). The justification at `05:1533` — *"Events do not need redaction because `events.payload` carries refs and scalars"* — is true of `payload` and false of the two columns the drawer renders: `summary text not null`, *"the audit drawer sentence"* (`05:57`), and `actor jsonb not null` carrying `{kind, id, name}` (`05:58`). The same personal data is denormalised into `core.approval_requests.subject` (`03:582`, example `'Send proposal · Aurora Manufacturing Sdn Bhd'`), `requested_by_name`, `assigned_to_name`, `decided_by_name`.
**Failure:** a PDPA erasure request for a named individual cannot be satisfied by the application, by `service_role`, or by anyone short of a superuser disabling the trigger.
**Fix:** store `summary` as a template key plus ref-only arguments resolved at render, or add one narrow audited `app.redact_event_actor()` that `app.reject_mutation()` explicitly exempts. A narrow audited exemption is defensible; no path at all is not.

**C-10 · The levy balance is a typed-in number with no staleness rule, and it gates a filing.**
`01:1636-1642`: *"`levyAvailable` is rendered on three screens and has no API source — HRD Corp has no API — so it must be a dated snapshot"*. `hrdc_packets.levy_available_sen` is *"frozen at assembly"* (`01:1598`). There is no maximum age on `as_of`, no warning, no job, and no compliance rule reading it.
**Failure:** a claim packet is assembled and submitted against a levy balance with no relationship to the employer's real position; the rejection arrives months later, after the claim window has closed.
**Fix:** a `WARN` compliance check on `as_of` age, `as_of` rendered beside every levy figure, and a hard block on `status → READY` past N days.

**C-11 · The invoice model has nowhere to put a MyInvois document.**
`01:260-261` asserts the way out: *"**TrainOS does not e-invoice; MyInvois validation is mirrored in, never originated (§9).**"* That holds only if another system genuinely submits and genuinely round-trips every field. The e-invoice-shaped columns are, in full, `sync_state` (four values: `NOT_SENT·SENT·VALIDATED·ERROR`), `sync_provider`, `sync_uin`, `sync_document_id`, `sync_last_attempt_at`, `voided_at` (`01:1771-1776`).
Missing, named: document **UUID** (distinct from `submissionUid`), **longId**/QR token, a status vocabulary containing `SUBMITTED_PENDING_VALIDATION` / `CANCELLED` / `REJECTED`, structured per-field validation errors, **cancellation reason** (`hrdc_packets` has `void_reason`; `invoices` does not), the **72-hour** cancellation window and the sweep that enforces it, `validated_at`, supplier **TIN** / **MSIC** / SST registration number (`public.tenants` is `id, slug, name, status, timezone, locale, created_at, updated_at` and that is the whole table, `002:116-126`), buyer **TIN** and **BRN/SSM** with identifier type, structured buyer address (`organisations.location` is free text, `01:972`), per-line **classification code** and **UoM code** (`invoice_lines.tax_code` is unconstrained free text that nothing reads, `01:1789`), e-invoice **type code**, and exchange rate. **Self-billed invoices** (trainer payables — `app.rate_card_trainer_day` exists) and **consolidated invoices** have no representation at all.
**Fix:** either get written confirmation that the accounting package is the submitter of record and round-trips these fields, or add them now. `01:1782` freezes a validated invoice — correct instinct, but with no credit note (`H-19`) and no cancellation record there is no legal exit from a mistake.

### HIGH

**H-01 · The lead's `app.tenant_id()` ruling was applied nowhere; the pack unanimously uses `app.current_tenant_id()`.** `02:81` records the opposite decision explicitly: *"Helper spelling | `app.current_tenant_id()`, **not** `app.tenant_id()` | `sb-actions` and `sb-events` converged on this name independently; mine was renamed to match."* Migration 002 defines `current_tenant_id` (`002:284`). 74 call sites use it; zero use the ruling. **Decision needed from the lead**: ratify `current_tenant_id` (recommended — it is deployed, it is clearer, and it pairs with `require_tenant_id`) or order a 74-site rename before 003.

**H-02 · The agent grants itself autonomy: the guard protects a table that does not exist.** `02:1615` writes `create policy agent_autonomy_update on core.agent_autonomy … with check (… and not (select app.is_agent()))` and `02:1640` calls it *"the single most important line in this document"*. No `create table` for `agent_autonomy` exists anywhere. The table doc 03 creates is `core.autonomy_grants` (`03:248`), which has no RLS, no policy, no `not is_agent()` guard, and is `SELECT`-granted to `authenticated` (`03:1814`). **Failure:** an AGENT principal updates its own grant to `AUTONOMOUS` and becomes unconstrained. **Fix:** settle N4, then port the policy as `as restrictive for all` so INSERT and DELETE are covered, not just UPDATE.

**H-03 · Self-approval is defeated by a NULL.** `02:1455` is the entire INSERT check on `core.approval_requests`: `with check (tenant_id = (select app.current_tenant_id()))`. `approver_role`, `requested_by_user_id` and `status` are all attacker-chosen. The backstop is `and r.requested_by_user_id is distinct from (select auth.uid())` (`02:1466`), and `NULL IS DISTINCT FROM <uuid>` is **true**. **Failure:** a SALES_MANAGER inserts an approval request for their own discount with `requested_by_user_id = NULL`, then inserts their own decision. Both policies pass. `02:1477` calls this *"the one rule where a bug is a fraud"*. **Fix:** revoke INSERT on `core.approval_requests` from `authenticated` entirely — the envelope is `SECURITY DEFINER` and needs no grant — and change the backstop to `is not null and <>`.

**H-04 · `app.decide_approval`'s authorisation check fails open on a NULL role.** `03:2212-2219` raises only `if not (v_actor.role = a.approver_role or … or v_actor.role in ('MD','ADMIN'))`. With a NULL `app_role` claim the disjunction is NULL, `IF NOT NULL` is false, and no exception is raised. §6.3 (`03:2828`) describes the Edge Function adapter as *"Parse the body … Call the RPC"* and never requires the caller's JWT to be forwarded, while EXECUTE is granted to `service_role` only. The self-approval check at `03:2222` fails open identically. Separately `03:1002` promises *"§4.1's authorisation check should read `app.has_permission('approval:decide')`"* — the written function contains no such call. **Fix:** raise on a NULL role before the check, and add the promised permission assertion.

**H-05 · AAL2 on money-moving actions is unenforceable.** `02:1547` requires AAL2 for `invoice:create`, `invoice:push`, `payment:record`, `hrdc:mark_submitted`, `discount:approve`, `attendance:unlock`, `ai:budget:raise` *"via one RESTRICTIVE policy per table"*. The same table's row says *"writes via action envelope only"* (`02:1499`), and the envelope is `SECURITY DEFINER` (`03:951`, `03:2175`), which bypasses RLS. `grep -in 'aal' 03` returns **nothing**. **Failure:** a FINANCE user on a single-factor session approves an invoice push; the control never runs on the only path that writes. Two aggravators in the same policy: `or (select app.is_agent())` exempts the agent from the whole restrictive policy, and `using (true)` on a `for all` restrictive policy leaves DELETE unconstrained. **Fix:** check assurance inside `decide_approval` and `perform_action`, gated on `action_types.money_moving`, using `app.aal2_verified()` (`02:2093`) rather than the forgeable claim.

**H-06 · The kill switch does not stop a killed agent deleting rows.** `02:843-846` is `as restrictive for all … using (true) with check (app.agent_writes_enabled())`. DELETE consults `USING` only. Tables with a permissive `for all` or `for delete` policy — `core.compliance_rule` (`02:1190`), `core.saved_views` (`02:1312`), `public.teams` / `team_members` (`002:623`, `634`) — are deletable by a killed agent holding a still-valid 1800-second token (`02:748`). The same defect voids `attendance_entries_locked_immutable` (`02:1530`), so a LOCKED attendance day's entries are deletable — an HRD Corp immutability rule. **Fix:** a second `as restrictive for delete … using (app.agent_writes_enabled())` on each.

**H-07 · "Agent flips status to SENT" is stopped by one attachment and a check with two holes.** The real control is column privileges (`03:1874-1882`), and it works — but `03:2019` assigns it away (*"**What `sb-erd` needs to do.** Attach the trigger to each gated table and apply the column-privilege grants"*) while `02:873` hands the same job back the other way. No `grant update (` on any table exists in the snapshot. `app.enforce_state_transition` has exactly one attachment, on `core.proposals` (`03:1988`); `invoices`, `attendance_days`, `hrdc_packets`, `quotations`, `engagements`, `autonomy_grants` — all named gated at `03:1884-1887` — have none. The trigger's own durable check (`03:1973-1982`) validates only `action_type` and `tenant_id`: it does **not** check `v_req.status` (a `QUEUED_FOR_APPROVAL` or `REJECTED` request authorises the edge — and `perform_action` writes the request row *before* approval) and does **not** check `v_req.target_id = new.id` (a `PROPOSAL_SEND` for proposal A sends proposal B). **Fix:** add `and v_req.status in ('EXECUTING','EXECUTED')` and the target check, use `is distinct from` for the tenant comparison, attach to all eight tables, and land the column grants in the table's own migration rather than a lane hand-off.

**H-08 · Cross-tenant read of raw LLM prompts is gated only by the absence of a grant.** Nine exposed `core` tables have no RLS, no FORCE and no policy: `core.events` (`05:45`), `core.event_subjects` (`05:140`), `core.runs` (`05:1545`), `run_nodes`, `run_node_io` (`05:1656`, full prompt/completion text for 30 days), `run_events`, `run_state_cards`, `run_checkpoints`, `run_snapshots`, `core.evals`. `001:157-180` documents, with measurement, that `ALTER DEFAULT PRIVILEGES … REVOKE` does not work — so there is no default-deny backstop. One `grant select on all tables in schema core` in a future migration is total disclosure. **Fix:** enable + force on all nine; copy the `app.outbox` posture (`05:568-570`) verbatim for the ones that need no policy at all.

**H-09 · `public.agent_api_keys` and `public.public_share_tokens` have policies but RLS is never enabled.** `02:647` and `02:1719`, both in the exposed `public` schema. `002:582-591` enables RLS on five tables; neither is among them. Their policies are inert. `02:1597` concedes the exposure is unresolved. Today they are closed by omission only; the first `GRANT SELECT` (as `002:595` does for their five siblings) exposes every tenant's agent key hashes and live share-token hashes. **Fix:** enable + force, and move `key_hash` / `token_hash` into `app.*` side tables rather than relying on column omission from a grant.

**H-10 · Day-boundary arithmetic is wrong for eight hours of every day, in the exact place the doc says it fixed it.** `03:1361` computes `(hp.deadline_at at time zone 'Asia/Kuala_Lumpur')::date - current_date`, with the rationale at `03:1377` that *"computing days against UTC would report the wrong number for eight hours of every day"*. Only the left operand was converted; `current_date` resolves in the session timezone, which is UTC on Supabase. Between 00:00 and 08:00 MYT `deadlineWithinDays` is one day too large, so the gate under-reports HRD Corp deadline urgency precisely during the Malaysian early morning. `03:1365` and `03:1369` have the same defect, unconverted. The same class hits the approval queue's urgency grouping (`03:674`), where `now() at time zone 'Asia/Kuala_Lumpur'` yields a bare `timestamp` compared against a `timestamptz`, making local midnight read as 08:00 MYT. **Fix:** `- (now() at time zone 'Asia/Kuala_Lumpur')::date` in all three branches; wrap the `date_trunc` result back with `at time zone`.

**H-11 · Portal read-only-after-acceptance and rate limiting are asserted, not implemented.** `02:1814` claims *"each RPC increments `use_count` … A token exceeding a configurable ceiling (default 500 reads/day) returns `NOT_FOUND`"*, but `portal_get_proposal` is declared `stable` (`02:1758`), which forbids writes. `portal_post_comment` and `portal_accept` have no SQL anywhere — the `mode = 'READ_WRITE'` requirement, the acceptance downgrade and accept idempotency exist only as prose at `02:1809-1812`. Separately `02:1845`'s revoke policy constrains only `tenant_id` in its `WITH CHECK`, so a holder of `portal:token:revoke` can clear `revoked_at`, extend `expires_at`, flip `mode` back to `READ_WRITE`, or **repoint `subject_id` at a different proposal**, silently redirecting a link already in a client's inbox.
*Verified good in the same area, and worth keeping:* the token is compared by hash of a 256-bit random (`02:1768`, `02:1745`), the raw token is never stored, expired/revoked/nonexistent all return an identical `NOT_FOUND` (`02:1854`) so there is no existence oracle, the projection is a build-list, a token reaches exactly one subject row, and **no `anon` policy exists on any base table** anywhere in the pack.

**H-12 · `fail_job` can dead-letter a job another worker is running.** `05:754` is `select * into j from app.outbox where id = p_job_id for update` — no `if not found`, no `state = 'CLAIMED'` check, no `claimed_by` check. `complete_job` (`05:715`) correctly asserts both. **Failure:** worker A's lease expires, the reaper requeues, worker B claims and starts; A finally errors and flips the row to `DEAD`, writes a dead letter, and calls `record_effect_result(…,'FAILED')` while B is still executing and will succeed. A downstream effect is marked FAILED for work that completed. **Fix:** `where id = p_job_id and state = 'CLAIMED' and claimed_by = p_worker`, and raise if not found.

**H-13 · `approvals-escalate` races `approvals-expire` and wins.** `03:2419-2439`: the CTE filters `status = 'PENDING'` and takes `skip locked`, but the outer `UPDATE core.approval_requests a … from due where a.id = due.id` has **no status guard**, under READ COMMITTED. `approvals-breach` (`03:2443`) does carry the guard, which makes the omission clearly accidental. **Failure:** expire flips a row to `EXPIRED`; escalate then stamps `escalated_at` and reassigns it to the MD, producing an escalation and an assignment for a dead approval that the partial queue index (`03:640`) will never show. **Fix:** add `and a.status = 'PENDING'` to the outer UPDATE.

**H-14 · The agent-token decision is closed against the lead's ruling, and the spike that would settle it does not exist.** The lead ruled self-minting UNVERIFIED pending a spike. `02:88` closes it the other way as a standing convention: *"**Nobody mints tokens. Ever.** All tokens are GoTrue-issued… If a lane thinks it needs to mint, bring it to me first."* `02:2438` acknowledges the research doc recommends the opposite and says *"a critic should weigh it"*. `docs/architecture/spikes/` is empty. **Adjudication:** `02` is right on the security merits — a holder of the project signing key can sign `role: service_role` and bypass every policy in the pack — but this is a lead ruling, not a lane's call, and the spike is the agreed instrument. **Fix:** run the spike or have the lead ratify `02`'s position in writing. Do not let it stay implicitly decided.

**H-15 · The stated tenant-isolation choke point on the worker path does not exist.** `05:579-584` claims *"**Every service-role write goes through a named function that takes `p_tenant_id` explicitly and validates it.** … `app.claim_jobs`, `app.complete_job`, `app.fail_job`, `app.heartbeat_job` and `app.reap_jobs` are that set … `sb-tenancy`'s requirement and §8.7 tests it."* None of the five takes a `p_tenant_id` at all (`05:656`, `694`, `703`, `748`, `794`). The invariant §8.7 claims to test is untestable, and the only thing separating tenants on the worker path is handler discipline.

**H-16 · No per-tenant fairness anywhere in the queue or the sweeps.** `05:679` orders the claim `by priority, run_after` globally. One tenant enqueueing 10 000 priority-1 jobs starves every other tenant's interactive work — `05:536` designates priority 1 as *"interactive (the user is watching)"*. The sweeps have the same defect: `expire_approvals(500)` every 5 minutes and escalate's `limit 500` every minute are **global** budgets shared across all tenants.

**H-17 · Nothing notices when a job stops.** `jobs-tick-interactive` (`05:900`) is a fire-and-forget `net.http_post` whose response lands in pg_net's unlogged ~6-hour table that nobody queries. Nothing reads `cron.job_run_details.status = 'failed'`. Rotate the vault secret or let `job-worker` start returning 500 and every job silently stops; `app.outbox` has no index on `(tenant_id, state)` to even ask the question — `outbox_failed_idx` (`05:551`) covers `FAILED`/`DEAD` only. **Fix:** a `jobs-health` cron raising a `job.stalled` event when `max(claimed_at)` falls behind, plus the index.

**H-18 · `reap_jobs` degrades to a growing scan every 60 seconds, unbounded.** `05:800-801` ORs `(state='CLAIMED' and visible_after < now())` with `(state='FAILED' and run_after <= now())`. `outbox_lease_idx` serves the first; nothing serves the second, because `outbox_failed_idx` is keyed on `finished_at desc` and `FAILED` rows have `finished_at` NULL. `DEAD` rows are retained forever by design (`05:1521`), so the index only grows, and with `C-07` the table never shrinks. The statement has **no LIMIT** — a provider outage that fails 50 000 jobs makes one cron tick a 50 000-row UPDATE. **Missing index:** `create index outbox_retry_idx on app.outbox (run_after) where state = 'FAILED';` Split the OR, add limits.

**H-19 · Credit notes do not exist, in a design that reasons about them at length.** `04:99-101` justifies away-from-zero rounding *"so that reversing a line produces the exact negative of that line"*, and `01:2157` states *"None. A correction is a credit note."* There is no credit-note table, no `CN-` ref prefix (`01:186-189`), no `CREDIT_NOTE` in `invoice_status` (`DRAFT·SENT·PARTIALLY_PAID·PAID·OVERDUE·VOID`), and no negative-amount path. Combined with `C-11`'s missing 72-hour window, there is no legal correction mechanism for a validated tax invoice at all. **Missing tables, named:** `credit_notes` + `credit_note_lines` with `original_invoice_id`, reason, their own ref sequence, their own SST columns and their own e-invoice type code.

**H-20 · A mixed exempt/taxable invoice cannot be represented.** `04:230` states *"SST is computed on the summed net, not per line"*, and `sst_rate` / `sst_reason` are single document-level columns (`04:225-226`). `invoice_lines.tax_code` exists (`01:1789`) and nothing reads it. One exempt training line plus one taxable line (materials, catering, venue recharge, a taxable consultancy component) on the same invoice is impossible, and `check (total_sen = subtotal_sen + sst_sen)` with the reconciliation trigger rejects any workaround. This also breaks MyInvois line-level tax reporting, which is the very reconciliation `04:1676` says it is preserving. **Fix:** move `sst_rate` / `sst_reason` / `sst_sen` onto `invoice_lines` and sum to the header.

**H-21 · The SST exemption is baked into the DDL default with no statutory source.** `04:225-227` gives `sst_rate app.rate not null default 0, sst_reason app.sst_reason not null default 'TRAINING_EXEMPT'`, and `04:1668` admits *"**No statutory source** appears anywhere in the pack."* Every invoice is exempt unless overridden, and if the exemption narrows the remedy is a backfill of invoices that `01:1782` has frozen. There is also nowhere to record SST registration: `public.tenants` has no `sst_registration_no`, no effective dates, no taxable-turnover view (`002:116-126`). **Fix:** `sst_reason NOT NULL` with **no default**, forcing an explicit determination per invoice.

**H-22 · A rejected-and-resubmitted HRD Corp grant is unrepresentable.** The grant lifecycle is five nullable columns on `hrdc_packets` (`01:1604-1606`); `packet_status` is claim-side only (`DRAFT·READY·SUBMITTED·PAID·REJECTED`) with no grant status and no resubmission path. `01:2154` freezes every grant column once `grant_approved_at` is set with the remedy *"None in TrainOS. HRD Corp requires a new grant application"* — but `UNIQUE (tenant_id, engagement_id)` (`01:1613`) forbids a second row. **Failure:** the most common HRD Corp event — a grant returned for amendment — has no representation. **Fix:** split `hrdc_grants` out of `hrdc_packets`: one engagement → many grant applications → one approved grant → one claim packet.

**H-23 · The claim-window deadline is derived by nothing and watched by a job that was never scheduled.** `hrdc_packets.deadline_at` (`01:1602`) is nullable with no default and no trigger deriving it from completion plus the resolved rule; `deadline_severity` is *"Derived; stored so the badge and the list agree"* — derived by nothing. `HRDC_DEADLINE_SCAN` (`05:610`) has no `cron.schedule` anywhere. **Failure:** a claim window closes silently and the levy is forfeited.

**H-24 · `INV-` numbering: gaps are permitted and unexplainable.** `01:197` states it plainly: *"Refs are **not gapless**: a rolled-back transaction burns a number. That is fine for every prefix except `INV-`."* `ref_formats.gapless boolean` exists (`01:2129`) and nothing reads it. A gap alone is survivable; the fatal combination is this pack's — gaps permitted, **no credit note** (`H-19`), **no cancellation record** (`C-11`) — so a burnt number is indistinguishable from a deleted invoice. **Fix, in preference order:** allocate `INV-` at *issue* not at draft creation; failing that, allocate gaplessly in a short autonomous transaction; in either case record every burnt number in `voided_refs (prefix, period, value, reason, at)`.

**H-25 · `app.can_see_owner('MY_TEAM')` is unindexable and it is the most-evaluated predicate in the product.** `002:416-425` uses `p_owner = ANY ((SELECT app.my_team_user_ids()))` returning `uuid[]`. `02:927` prescribes a `(tenant_id, owner_id)` index on every table, but `= ANY(array)` inside a `CASE` inside a STABLE function is opaque to the planner, so every `MY_TEAM` read of organisations, opportunities, enquiries, proposals and engagements is a filter-after-scan. **Fix:** expose `app.my_team_user_ids()` as `returns setof uuid` so `owner_id = any (select …)` can drive the index.

**H-26 · The audit-drawer keyset query has no index supporting its ordering.** `05:1441` orders `by at desc, id desc`; `05:1452` claims *"an index-only scan on `event_subjects_lookup_idx`"*. That index is `(tenant_id, subject_type, subject_id, event_id)` (`05:149`) and `event_id` is a random `gen_random_uuid()` (`05:46`), not a time key. Every page-turn fetches the record's entire event history, joins for `occurred_at`, and sorts — exactly the degradation keyset pagination was chosen to avoid. **Fix:** denormalise `occurred_at` onto `core.event_subjects` and index `(tenant_id, subject_type, subject_id, occurred_at desc, event_id desc)`.

### MEDIUM

**M-01 · Doc 04's enum and domain types are never declared.** See §1.2. `04`'s DDL does not compile as written.

**M-02 · `core.v_approval_requests` and `core.audit_entries` are definer-rights views granted to `authenticated`.** `03:667` and `05:1415` have no `with (security_invoker = true)`; Postgres defaults views to the owner's rights and the migration owner carries `BYPASSRLS`. Even once `C-04` is fixed, the views sidestep it. Same on `app.commission_ledger` (`04:280`), `app.model_tier_status` (`04:826`), `app.budget_status` (`04:927`). **Fix:** `alter view … set (security_invoker = true)` on all five.

**M-03 · `app.usage_rollup` is read by three endpoints and never defined.** `04:921` *"The usage screen reads `app.usage_rollup`, never the events"* and `04:932` joins it; no `create table` exists. `create view app.budget_status` therefore depends on a phantom relation, and `GET /v1/ai/usage`, `/usage/forecast` and `PUT /v1/ai/budgets/{scope}/{key}` have no source for budget state or the `NEAR`/`PAUSED` transition.

**M-04 · Two documents give contradictory grants on the `app` schema.** `001:144` `GRANT USAGE ON SCHEMA app TO anon, authenticated, service_role` (with the correct rationale: RLS predicates resolve `app.*` helpers in the caller's context) versus `03:1808` `revoke all on schema app from public; grant usage on schema app to service_role`. If 03's revoke lands after 002, every policy calling `app.current_tenant_id()` raises `permission denied for schema app` and the product stops. **001 is right; delete `03:1808-1809`.**

**M-05 · Three `search_path` spellings, and the pack's own test asserts one.** `002:269-275` records that *"test_001 T3 and test_014 both rely on a single spelling"* and `001:396` pins the 4-part form literally. Doc 05 uses `''` on every function; doc 03 uses a 6-part form (`03:2488`); `app.round_half_up_sen` (`04:74`) has none at all. Every function authored from 03, 04 and 05 fails the test the pack says will guard them.

**M-06 · Agent scope check missing from the UPDATE path.** `02:1104` and `02:1113` both carry `and (select app.agent_in_scope('organisations'))`; `opportunities_update` (`02:1116`) carries it in neither clause and also drops `has_permission('opportunity:write')` from its `WITH CHECK`. An agent scoped to proposals only cannot read or create an opportunity but can `PATCH` one. Template B is copied to ~15 tables, so the gap propagates.

**M-07 · Raw action payloads are copied into the outbox and drained to third-party webhook bodies with no redaction and no retention.** `05:976` and `05:238` pass `payload` through verbatim. `05:1533`'s assurance covers event authorship, not the outbox, and `app.outbox` and `core.events` are append-only forever. **Fix:** an allowlist of payload keys at the boundary.

**M-08 · Cron puts the service-role key into `net.http_request_queue.headers`.** `05:900-916` correctly keeps it out of `cron.job.command`, but `net.http_post` persists the constructed headers — including the bearer token — into pg_net's own queue and response tables every 10 seconds. **Fix:** authenticate the worker endpoint on a dedicated per-component secret, as `05:1652` already prescribes.

**M-09 · `revoke execute on function app.emit_event` is ambiguous and will not apply.** Two overloads exist (`05:162`, `05:254`); the revoke at `05:238` omits the argument list and errors. Since PUBLIC holds EXECUTE on new functions by default (measured at `001:165-168`), both overloads stay PUBLIC-executable, and `001:402-412`'s verify block would fail the migration.

**M-10 · Provider-key handling weaker than the doc claims.** `ai_provider_key_set` takes the raw BYOK key as an RPC parameter (`02:1933`), so it appears in the request body, in `log_min_duration_statement` output and in `pg_stat_activity`. The reveal function (`02:1944`) uses the forgeable `app.aal()` claim rather than `app.aal2_verified()`, implements neither the *"one reveal per key per 24 hours"* ceiling it claims at `02:1995` nor the `app.key_access_audit` write that `05:1491` makes rule #1.

**M-11 · Agent API key: unsalted single-round SHA-256 with unspecified entropy.** `02:651`. Portal tokens state their generator (`gen_random_bytes(32)`, `02:1745`) and are safe under plain SHA-256; agent keys state only a prefix format. Comparison is an indexed equality, so timing is not exploitable. **Fix:** specify the generator, or move to a salted KDF.

**M-12 · `app.enforce_autonomy_ceiling` fails open on a NULL ceiling.** `03:301-320` is SECURITY INVOKER; if `core.action_types` ever gets RLS without a matching policy, `v_ceiling` is NULL and `NULL > NULL` is false, so the ceiling silently does not apply. With `H-02` this is the second and last brake on self-promotion.

**M-13 · Sweeps violate the rule stated two lines below them.** `03:2478` requires `skip locked` and a `limit` on every sweep. `drafts-expire` (`03:2467`) has neither; `idempotency-cleanup` (`03:2460`) has a limit but no `skip locked`. The latter also deletes `limit 10000` once an hour against 24-hour-lived rows, so it cannot keep up above roughly 2.8 gated writes per second across all tenants.

**M-14 · `heartbeat_job` has no owner check.** `05:694` updates any row in `CLAIMED` given only `p_job_id`, so any worker can extend any other worker's lease indefinitely and defeat the reaper. The `setInterval` at `05:837` is cleared only in `finally`, which never runs if the isolate is hard-killed.

**M-15 · The typed claim cannot use the claim index.** `05:678` filters on `job_type` but `outbox_claim_idx` (`05:543`) is `(priority, run_after, id)`. A worker asking for a rare type scans the whole QUEUED index. **Missing index:** `outbox_claim_typed_idx on app.outbox (job_type, priority, run_after, id) where state = 'QUEUED'`.

**M-16 · Unindexed columns that policies and traces depend on.** `core.events.correlation_id` (`05:61`, `not null`, tested by §8.7 and the basis of the `run_4821` trace at `04:635`) has no index. Unindexed FKs: `memberships.primary_team_id` (`ON DELETE SET NULL`, so a team delete seq-scans under an exclusive lock), `memberships.trainer_id` (drives the whole TRAINER data scope), `dead_letters.replayed_job_id`, `webhook_deliveries.event_id`, `evals.run_id`.

**M-17 · The same index is declared twice under two names.** `events_subject_idx` (`05:105`) and `event_subjects_lookup_idx` (`05:149`) are the same table and the same column list. Double write amplification, and a direct hit on the project's own consolidation rule.

**M-18 · `app.role_permissions` has no `tenant_id` and no write path.** `002:256` calls it *"DATA so an MD can move `discount:approve` between roles without a migration"*, but the table is global across tenants and `002:261` revokes all access with no RLS and no policy — so no MD can edit it, and any edit changes every tenant at once. **Decide:** platform-global (drop the MD rationale) or tenant-scoped (add `tenant_id`, RLS, an ADMIN policy).

**M-19 · A MyInvois UIN can be duplicated.** `01:1778`'s unique constraint covers `sync_document_id`, not `sync_uin`. Two invoices can carry the same validated document identifier.

**M-20 · Replaying a dead-lettered push can submit the same invoice twice.** `05:601` and `05:330` use `job.id` as the provider idempotency key, and `05:1087` states *"Replay creates a **new** job"* — new job, new id, new key. **Fix:** derive the key from `invoice_id` plus a stored submission-attempt counter, never from the job row.

**M-21 · Idempotent replay returns the original status, not `200`.** §1 of the contract says *"Replay of a key with an identical body returns the original response with `200`"*; `03` replays `coalesce(v_idem.status_code, 200)`, which is `202` for an executed or queued action. Low impact, but it is a contract deviation that the typed client will see.

**M-22 · `completeness = 1` means "we attached something", not "HRD Corp accepted it".** `hrdc_packet_documents.status` is `PRESENT·MISSING` only (`01:1625`), acknowledged as a gap at `01:2645`, and `completeness` is what the submit constraint checks (`01:1615`). A packet HRD Corp bounces on a defective attendance sheet reads as 100% complete forever.

**M-23 · Rule retroactivity is handled; the money consequence is not.** `hrdc_packets.claim_value_sen` is frozen by I3 once `grant_approved_at` is set. A rule change that reduces the claimable amount mid-engagement raises a `compliance_version_drifts` warning (correct) with no path to revise the figure the packet will claim.

**M-24 · `CANCELLED` is declared and never written.** In the check constraint (`05:505`) and the state machine (`05:637`), justified for `POST /agents/{id}/pause`; no function ever sets it.

**M-25 · Run I/O masking is unverifiable and incomplete.** `05:1796-1806` masks five patterns **in the worker**, outside the database and outside every test in the pack. Names, addresses, job titles and company-identifying text are unmasked, and `05:1846` concedes state cards may carry client text verbatim. There is no `(tenant_id, subject)` index into `core.run_node_io`, so even a manual erasure cannot find the rows.

**M-26 · Webhook paths silently relocated.** `05:1279` routes all four inbound webhooks to `/functions/v1/webhook-*`, contradicting `endpoints.ts:156-159` and `INBOUND_WEBHOOKS[].path`. Nothing in any doc serves `/v1/webhooks/*`. Either the contract changes or an Edge Function router is needed; today the two disagree silently.

### LOW

**L-01 · `app.principal_claims(uuid)` takes the user id as a parameter.** `002:446`. EXECUTE is correctly restricted to `supabase_auth_admin` (`002:563`), but `002:49-52` names a second caller, the unwritten minter Edge Function, which will hold the service role. It is the one SECURITY DEFINER function in the pack taking a freely-chosen identity argument. **Fix when the minter lands:** verify the presented key inside the same function.

**L-02 · `app.autonomy_rank` has no pinned `search_path`** (`03:331`) — the only function in the pack missing the convention. SECURITY INVOKER, so not an escalation, but it breaks the single-spelling assertion `001:396` relies on.

**L-03 · `app.role_permissions` has no `AGENT` row** (`02:424`), so every Template A–D policy's `has_permission()` returns false for agents and they can currently read and write nothing. Fail-closed, so not a leak — but it *masks* `H-06` and `M-06` rather than preventing them, and the obvious remedy would unmask both at once.

**L-04 · `app.emit_event(tenant, type, action_request_id)` does not verify `r.tenant_id = p_tenant_id`** (`05:254`). Service-role only, but a mismatched argument writes an event into the wrong tenant's audit drawer. One line.

**L-05 · No `tenant_id` FKs on the internal tables.** `app.outbox` (`05:501`), `core.events` (`05:47`), `core.event_subjects`, `app.dead_letters`, `app.webhook_routes`, `core.approval_requests` (`03:576`), `app.idempotency_keys` (`03:739`) are bare `uuid not null`. A typo'd tenant produces rows nothing reads and nothing flags.

**L-06 · `public.teams.manager_user_id` is read by nothing** (`02:137`) — not by `my_team_user_ids()`, and the contract has no manager concept beyond the `SALES_MANAGER` role string.

**L-07 · Stale counts and comments.** `001:127` says `core` holds 86 tables; `01:63` says 89. `001:18-22`'s comment on the `app` schema still describes the pre-correction posture that `03:3157` flags for correction.

**L-08 · Departed-employee identity retained indefinitely with no stated basis.** `memberships` has no DELETE by design (`002:667`) and `core.events.actor.id` and `app.key_access_audit` retain `auth.uid()` forever. Defensible under a legal-obligation basis; that basis is nowhere written down, and PDPA notice obligations require it.

---

## 3 · Contract fidelity

99 endpoints walked. **83 fully backed. 5 with no backing, 11 partial.** The pack is more faithful than the seam defects suggest.

### No backing at all

| Endpoint | Missing |
|---|---|
| `GET /v1/dashboards/executive` | No view, table or function. `ExecutiveDashboard` (`agents.ts:357`) needs metrics + approvalsPending + agentActivity + autonomyMix + agentSpend. The only hit for "executive" in the pack is the permission string `dashboard:executive:read` (`02:399`). |
| `GET /v1/reports/proposals-vs-won` | No rollup table or view. `proposals.sent_at` and `opportunities.stage='WON'` exist; nothing aggregates them into `series[{period,sent,won}]`. |
| `POST /v1/public/tnas/{token}/submit` | Token backed (`02:1692`, `share_subject` enum includes `TNA`); **nowhere stores the answers**. `PortalTnaSubmitRequest.responses[{questionId,value}]` has no table — `tna_gaps.evidence_refs` even cites question ids it cannot resolve (`01:1140`: *"`["Q4","Q7"]` — questionnaire question ids, not entity refs"*). |
| `GET /v1/me` | **Circular deferral.** `02:189`: *"`user_profiles` … belongs to `sb-erd`."* Doc 01 defines no such table. Doc 02 then uses it anyway (`02:868`, `02:1212`). `Me.name/.locale/.timezone/.theme` are backed by nothing. Note migration `002:186` creates `public.user_profiles`, so the migrations author has already closed this ahead of the docs. |
| `GET /v1/navigation` | Badges are backed (`app.badge_counts`, `05:1835`); the nav tree is not. `NavigationTree/Group/Parent/Child` (`shell.ts:67-89`) needs role-filtered `caption/key/label/icon/path` rows and no table exists. |

### Partial backing

- **`GET /v1/search`** — `SearchRecord.type` spans 16 `EvidenceType` values; only four trigram indexes exist (organisations, contacts, enquiries, programmes). No invoices, engagements, proposals, trainers or TNAs. `SearchResult.actions[]` has no backing at all.
- **`GET /v1/metrics/{key}`** — `metric_definitions` exists with a `sql_source text` column, but the one named computation artefact, `v_organisation_metrics` (`01:972`), appears once in the pack and has no `create view`. `MetricDelta.comparedTo` has no history table.
- **`GET /v1/evals`** — `AgentEval` needs `window` and `sampleSize`; neither `eval_runs` (`01:1948`) nor `core.evals` (`05:1790`) has either.
- **`GET /v1/ai/usage`, `/usage/forecast`, `PUT /v1/ai/budgets/{scope}/{key}`** — see `M-03`, `app.usage_rollup` undefined.
- **The four `/v1/webhooks/*`** — storage backed; paths relocated (`M-26`).
- **The three export endpoints** (`attendance/export`, `hrdc/packets/{id}/export`, `proposals/{id}/preview`) all return `{url, expiresAt}`; no doc designs artefact generation, a bucket, or signed-URL expiry. `attachments` (`01:2103`) has no `expires_at` and nothing in the pack mentions `createSignedUrl` or `storage.objects`.

### Invented with no contract source

`app.aging_bucket` (`04:1027`) — a configurable-bucket table reproducing four hardcoded JSON keys; the doc admits it at `04:1037`. `app.event_subscriptions` (`05:301`) — zero contract hits for `subscription`/`jobType`. `core.state_transitions` (`03:1897`) — defensible as trigger data, but no contract concept. `core.jury_configs` (`03:876`) — a **second home** for a policy the contract explicitly places on `/v1/ai/routing` (`envelope.ts:127`: *"The mode/quorum policy itself lives on `/v1/ai/routing`"*), giving the field three homes counting `01`'s `ai_routing_entries.jury` and `04`'s `app.routing_matrix.jury`. `core.jury_verdicts` (`03:893`) — the contract's jury record is `ProvenanceJury` plus `RunEvent.votes[]`, and `01` already models it as `jury_votes`. `public.teams.manager_user_id` (`L-06`). `core.runs.acknowledged_at` is self-declared at `05:1528` and defensible.

---

## 4 · Correctness against the contract

**Policy gate order — correct.** §3's five steps (autonomy → monetary value → context flags → confidence → self-approval) map exactly onto `03` §2.1–§2.5, with human requesters skipping to step 3 as §3 requires. The guard order in §2.0 (actor resolution before idempotency claim, advisory lock before insert) is right and the reasoning at `03:1030` — *"the second call blocks on the lock, the first commits, the second then sees a `COMPLETED` row and replays it"* — is sound. Defects are `H-04` (NULL role) and `C-02` (the value function does not compile), not the ordering.

**`effects[] == diff[]` — held correctly.** `03:2304`: *"effects[] is read back from the frozen column the diff was rendered from"*, with `diff_hash_at_decision` (`03:708`) recording what the decider saw, and the §16 Q2 staleness answer implemented as a recompute-then-409 at `03:2257-2278`. This is the strongest part of doc 03.

**Idempotency vs §1 — correct except `M-21`.** 24-hour retention, hash-of-canonical-body comparison, `409 IDEMPOTENT_REPLAY` on a differing body, `Idempotent-Replay: true` header. Scoping the key per actor is a deviation from a bare "key" but is defensible and documented.

**Money vs §18 and DECISIONS §7 — correct.** Integer sen, `round(numeric)` verified on PostgreSQL 17.11 to round ties away from zero (`04:80-99`), lines rounded before summing, SST on the summed net via a trigger because a generated column may not reference another (`04:126-151`), a deferred constraint trigger for reconciliation, and `check (basis <> 'PACKAGE' or qty = 1)` implementing §18's *"A package price is one line at `qty: 1`"*. The RM 616.67 × 30 case is handled exactly as DECISIONS §7 directs. Two deviations to confirm, both flagged by the designer: negative-tie direction on credit notes (`04:92`, away from zero, deviating from the literal words of DECISIONS §7) and the function-name split (`N2`).

**Rule resolution vs §18 — correct, and the best work in the pack.** Two time axes rather than one (`04:374-458`), `rule_set_versions` with a gist exclusion so two versions cannot claim the same day, separate pins at grant submission and claim submission per DECISIONS §6, `compliance_check_results` storing the version applied, and `compliance_version_drifts` that *warns citing both versions rather than switching silently* — exactly what §18 specifies. The one defect is the citation itself (`04:1661`: DECISIONS §3 says *"Circular 2/2026"*, API_CONTRACT §17 says *"Circular 04/2026"* for the same rule — see `D-44`), and a claim defence **is** the citation.

---

## 5 · Client decisions register

Every item the pack says needs a human decision, deduplicated across docs. **94 rows; 30 blocking.** Blocking means a wrong value corrupts stored data or breaks a compliance filing.

Full per-row sourcing was compiled with `file:line` for each; the consolidated table below carries the decision, owner, and the default currently in the schema. Where two lanes disagree the row says so — those need the lead, not the client.

### MD — 20 rows

| ID | Decision | Default taken | Blocking |
|---|---|---|---|
| D-01 | The whole autonomy matrix: launch levels, ceilings, promotion conditions | DECISIONS §1 18-row table seeded, `ceiling = ACT_WITH_APPROVAL` enforced by check constraint | **YES** |
| D-02 | Every threshold, SLA and approver role on **22 unsourced policy rows** | *"4 sourced ids and 22 derived ones… needs the MD's sign-off"* (`03:3153`) | **YES** |
| D-03 | Approver role for `TRAINER_BOOK` and `ENGAGEMENT_CLOSE_OUT` | `OPS`, escalating to `MD` at 12h — *"a placeholder"* | NO |
| D-04 | May a human approver execute their own over-threshold action? | `self_authorise boolean not null default false`; the column itself is invented | **YES** |
| D-05 | Approval expiry behaviour (§16 Q1) | `expire_after_minutes default 1440` → `EXPIRED` | NO |
| D-06 | Default approval SLA | `sla_minutes default 240` | NO |
| D-07 | MD escalation timing | `escalate_after_minutes default 360` | NO |
| D-08 | Jury `ESCALATE` triggers | confidence < 0.70, value > RM 50,000, or first-of-kind | NO |
| D-09 | Jury quorum and panel | `quorum 2 of 3`, tiers `STRONG_1..3` | NO |
| D-10 | Jury async sampling rate | `sample_rate default 0.050` | NO |
| D-11 | Jury `GATE` golden-set size and cost tolerance | 50–100 items, USD 2–5 per promotion | NO |
| D-12 | Minimum agent confidence | `min_confidence default 0.700` | NO |
| D-13 | Action types that may **never** promote | Five: `DISCOUNT_APPROVE`, `TRAINER_BOOK`, `ATTENDANCE_APPROVE`, `HRDC_PACKET_MARK_SUBMITTED`, `RULE_CHANGE_APPROVE` | **YES** |
| D-14 | Baseline minutes per action type — the table that **is** the ROI claim | Tables exist and are empty; `basis default 'ILLUSTRATIVE'` | NO |
| D-15 | First-quarter hours-saved haircut | `haircut default 0.70` | NO |
| D-16 | Monthly AI budget caps per tier and tenant; who may raise | STRONG_1 RM 15,000; SPECIAL RM 20,000; tenant RM 25,000; raise is `FIN-07` MD-gated | NO |
| D-17 | Portal token lifetime and post-acceptance behaviour (§16 Q6) | 30 days, +90 and `READ_ONLY` on acceptance — **but `01` says acceptance does not revoke; two lanes disagree** | NO |
| D-18 | May OPS see costings / realised margin? | `02` says no; `04:1424` objects that the contract documents the endpoint for OPS — **two lanes disagree** | NO |
| D-19 | MFA enrolment grace period for MD/ADMIN | 7 days | NO |
| D-20 | May the hours-saved tile render a bare number? | No — `basis` must render | NO |

### FINANCE — 16 rows

| ID | Decision | Default taken | Blocking |
|---|---|---|---|
| D-21 | **The rate card numbers** — trainer bands, day rates, materials, commission, margin floor, discount authority | `version 'v0-placeholder'`, `status 'PLACEHOLDER'`, component tables empty | **YES** |
| D-22 | **Floor precedence** when absolute and margin floors disagree | Both stored, `greatest(...)` binds, `binding_floor` records which | **YES** |
| D-23 | The fixture's own margin/floor numbers do not reconcile | Treated as a fixture error, not a formula error | **YES** |
| D-24 | Negative-tie rounding on credit notes | Away from zero (`−0.5 → −1`), deviating from the literal DECISIONS §7 words | **YES** |
| D-25 | **SST exemption** — statutory basis and threshold behaviour | `sst_rate default 0`, `sst_reason default 'TRAINING_EXEMPT'`, no source | **YES** |
| D-26 | Collections ladder days | 7 / 30 / 45, human call 60, trading hold 75 | NO |
| D-27 | Aging bucket boundaries | `(null,1) [1,31) [31,61) [61,∞)` | NO |
| D-28 | DSO averaging window | Not stored; *"needs the window agreed with Finance before it means anything"* | NO |
| D-29 | Must `INV-` be gapless? | Not gapless — see `H-24` | **YES** |
| D-30 | Pass-through AI billing: invoice line or report? | Report only, no invoice line | NO |
| D-31 | Credit notes and refunds — lifecycle unspecified | Nothing built — see `H-19` | **YES** |
| D-32 | Commission clawback on a refunded invoice | Self-corrects from `paid_sen`; the payout side is outside TrainOS | NO |
| D-33 | FX source and cadence for BYOK spend | `fx_myr_per_usd` stamped per event; source and cadence unset | NO |
| D-34 | WhatsApp rate cache TTL (§16 Q4) | `04` says 24h, `05` says 6h, `01` says unset — **three lanes disagree** | NO |
| D-35 | MyInvois line-reconciliation requirement | Asserted; *"No MyInvois specification was available"* | **YES** |
| D-36 | Total-from-lines rounding model (§16 Q10) | Confirmed as implemented; needs Finance ratification | **YES** |

### COMPLIANCE — 20 rows

| ID | Decision | Default taken | Blocking |
|---|---|---|---|
| D-37 | Verify all nine HRD Corp rules against the circular PDFs | All load `PROPOSED`; *"nobody has verified anything yet"* | **YES** |
| D-38 | In-house lead time | `HRD-014`: start ≥ approval + 14 days | **YES** |
| D-39 | Public lead time and the 1 Jan 2027 step-up | `HRD-015` +3 d to 31 Dec 2026; `HRD-022` +14 d from 1 Jan 2027 | **YES** |
| D-40 | Commencement window | `HRD-016`: start ≤ approval + 90 days | **YES** |
| D-41 | Claim window (the demo's five-working-day rule was wrong) | `HRD-017`: claim ≤ completion + 6 months | **YES** |
| D-42 | Calendar days vs working days for every offset | Calendar days | **YES** |
| D-43 | "Apply before Friday 5 PM" is advisory | `HRD-ADV-01`, `kind = ADVISORY`, `WARN` | NO |
| D-44 | **HRD Corp circular numbering**: "2/2026" or "04/2026" for the same rules | Seeded as `DOC-0188` / "Circular 2/2026" — *"a citation is the one thing a compliance rule cannot get wrong"* | **YES** |
| D-45 | Rule resolution date — written confirmation from HRD Corp | Grant side at grant submission, claim side at claim submission | **YES** |
| D-46 | **ACM meal ceiling** for 2026 | `HRD-020` at RM 25.00 (`WARN`); the 2026 matrix was never seen | **YES** |
| D-47 | Trainer accreditation and no-amendment rules | `HRD-018`, `HRD-019` | **YES** |
| D-48 | Required-document set for a complete claim packet | `HRD-011` over five document types | **YES** |
| D-49 | Refuse `ATTENDANCE_UNLOCK` once a claim reference exists? (§16 Q5) | `01` leaves it unconstrained; `03` escalates to MD at 120m — **two lanes disagree** | **YES** |
| D-50 | PDPA erasure vs a filed HRD Corp PDF naming the participant | *"Not attempted"* — see `C-09` | **YES** |
| D-51 | Where `levyAvailable` comes from | Manual entry or statement upload with an `as_of` date — see `C-10` | NO |
| D-52 | Minimum extraction confidence for a proposed rule change | `check (confidence >= 0.800 or status = 'WITHHELD')` | **YES** |
| D-53 | Rule status vocabulary — no separate `VERIFIED` state | `PROPOSED · ACTIVE · SUPERSEDED`, verification as a constraint on `ACTIVE` | NO |
| D-54 | May the AGENT read `contacts.phone`? | Column-level revoke proposed; **not implemented** | NO |
| D-55 | Storing participant identity numbers for claim packets | Hash plus last four; the contract never mentions the field | **YES** |
| D-56 | Retention of the event log | Indefinite — *"a compliance decision, not an ops one"* | **YES** |

### ADMIN — 6 rows

| ID | Decision | Default taken | Blocking |
|---|---|---|---|
| D-57 | Confirm gate/sample/escalate as the standing jury policy | `mode ∈ GATE·SAMPLE·ESCALATE` | NO |
| D-58 | Should provider-key reveal exist at all? (§17 Q4) | Reveal exists and is audited — but see `M-10` | NO |
| D-59 | Runs outside `allowedHours`: queue or escalate? (§17 Q3) | Queue when batch-eligible, escalate otherwise | NO |
| D-60 | Model tier definitions, routing and cache strategy, allowed hours | `routing 'FIXED'`, `cache_strategy 'NONE'`, `allowed_hours '{"[0,24)"}'` | NO |
| D-61 | PDPA data-residency call on provider key regions | `region text not null`, returned before a key is saved | NO |
| D-62 | Knowledge-source monitoring cadence and quarantine | `04` says weekly, `05:609` schedules `SOURCE_MONITOR_CHECK` daily — **two lanes disagree, and neither is scheduled** | NO |

### OPS and other — 14 rows

| ID | Decision | Default taken | Blocking |
|---|---|---|---|
| D-63 | Saved views shared or personal? (§16 Q9) | `PRIVATE` default, `TEAM` and `TENANT` supported | NO |
| D-64 | Trainer soft-hold duration | 72 hours | NO |
| D-65 | `signaturesExpected` formula | `registered × 2` (AM/PM); the contract's own formula is flagged wrong | **YES** |
| D-66 | Can a participant not be a contact? | Yes, nullable | NO |
| D-67 | Are industry / audience level / category controlled vocabularies? | Free text now, reference tables later | NO |
| D-68 | How is `organisations.health_score` computed? | Snapshot table exists; formula undefined | NO |
| D-69 | Does the quotation share the proposal's ref sequence? | Assumed shared | NO |
| D-70 | One nine-step engagement pipeline or two rows? | Two rows, one default | NO |
| D-71 | Programme pricing tiers by headcount | maxPax 20/30/40 at RM 14,500 / 18,500 / 22,400 | **YES** |
| D-72 | Does a trainer always have an auth user? | No — contract trainers get `SUSPENDED` and a `trainers` row with no `user_id` | NO |
| D-73 | Is `CLIENT` ever a login? | No at launch, actor kind only | NO |
| D-74 | Multi-tenant humans? | No at launch | NO |
| D-75 | Suggested-draft expiry | `now() + interval '7 days'` | NO |
| D-76 | HRDC deadline badge alert threshold | Within 3 days | NO |

### ENGINEERING — 18 rows

| ID | Decision | Default taken | Blocking |
|---|---|---|---|
| D-77 | Agent principals per agent or per agent per tenant? (§16 Q7) | Per agent per tenant | NO |
| D-78 | Diff staleness: 409 or a soft lock? (§16 Q2) | 409, no lock columns | NO |
| D-79 | `firstProposalToOrg` live or denormalised? (§16 Q3) | Computed live | NO |
| D-80 | Sandbox replay: live reads or a pinned snapshot? (§16 Q8) | Snapshot pinned to the run | NO |
| D-81 | Retention windows for run I/O, webhook bodies, outbox, cron history | 30 d / 30 d / 90 d / 7 d — **none implemented, see `C-07`** | **YES** |
| D-82 | Drop the contract's SSE endpoint for Supabase Realtime | Recommended; *"changes the client, so it needs sign-off"* | NO |
| D-83 | Per-role badge topics instead of §11's flat `badges` channel | `tenant:{t}:role:{r}:badges`; *"needs sign-off"* | NO |
| D-84 | Thirteen action types emit no catalogued event | Proposed event names; *"they need contract sign-off"* | NO |
| D-85 | Session, token and JWT lifetimes | JWT 1800 s, session 12 h, inactivity 2 h, single-session off | NO |
| D-86 | Idempotency-key retention | 24 hours per §1 | NO |
| D-87 | `GOV-07` gated state transitions | Invented; *"not in any source document"*; `state_transitions` seeded with 8 of ~60 edges | **YES** |
| D-88 | 21 action types, not the 19 in §12 | §12's catalogue was never updated for `BUDGET_CAP_RAISE` and `RULE_CHANGE_APPROVE` | NO |
| D-89 | `pgvector` availability and embedding dimension | 1536 assumed; **extension not enabled, see `C-06`** | NO |
| D-90 | `pg_cron` / `pg_net` provisioning | Required everywhere, enabled nowhere — `C-06` | **YES** |
| D-91 | PostgREST `PTnnn` → HTTP status mapping | Unverified; the whole 422/409 contract rests on it | NO |
| D-92 | `human_minutes_spent` granularity | Undefined; belongs on `action_requests` as `human_review_seconds` | NO |
| D-93 | **Agent token minting**: GoTrue sign-in vs self-minted JWT | `02` closes it as *"Nobody mints tokens. Ever."*; the research doc recommends the opposite; **the spike does not exist** — see `H-14` | **YES** |
| D-94 | `auth.sessions` assurance column name (`aal` vs `aal_level`) | `[assumed]`; a wrong name makes step-up raise rather than fail open | NO |

### Cross-lane disagreements the client cannot settle

Five rows above are not client decisions at all — they are two lanes contradicting each other and need the lead: **D-17** (portal token post-acceptance), **D-18** (OPS margin visibility), **D-34** (WhatsApp TTL: 24h vs 6h vs unset), **D-49** (attendance unlock with a claim reference), **D-62** (knowledge-source cadence: weekly vs daily).

---

## 6 · Counts by severity

| Severity | Count |
|---|---|
| CRITICAL | 11 |
| HIGH | 26 |
| MEDIUM | 26 |
| LOW | 8 |
| **Total** | **71** |

Plus 19 cross-doc naming and shape mismatches (§1.1), ~25 undeclared types (§1.2), 16 endpoints with absent or partial backing (§3), and 94 client decisions of which 30 are blocking (§5).

**Fix order for the migrations author.** Settle `C-01`–`C-03` and the §1.1 name table first, because they are rename-before-data decisions and three of the columns are `STORED GENERATED`. Then `C-04`–`C-06`, which are the difference between a working database and an open one. Then the HIGH security set `H-02` through `H-09`, which are all small edits to text that already exists.

---

## 7 · What I could NOT verify

- **Nothing was executed.** No Postgres instance, no Supabase branch, no `pgTAP` run. Every claim about SQL behaviour is from reading. The two measured claims the pack makes — `001:157-180` on `ALTER DEFAULT PRIVILEGES` and `04:85-99` on `round(numeric)` — are consistent with documented Postgres behaviour but I did not re-run them.
- **Migrations 003–016 do not exist.** `C-04`, `H-08` and `H-09` are stated as *"no such statement exists in these seven files"*. If a later migration supplies `ENABLE`/`FORCE`/policies for `core`, those three downgrade sharply. The defects that do **not** depend on unwritten files are `C-01`, `C-02`, `C-03`, `C-05`, `C-06`, `C-07`, `C-08`, `H-02` through `H-07`, `H-10` through `H-13`, `M-06`, `M-12`.
- **The docs changed under the review.** `01`, `03` and `05` were edited by other lanes during both verification passes; `03` flipped its domain schema and flipped back. Findings are pinned to the MD5s at the top. A finding may already be fixed; the line number is more likely to be wrong than the finding.
- **`config.toml` was not read** — it is referenced by `001:33`, `02:87`, `03:164` and `05:2205` as the thing that exposes `core` to PostgREST, and I did not confirm it exists or contains that entry. If it does not, `C-03`'s blast radius widens to the whole domain.
- **`app.perform_action`'s full body** beyond §2.0–§2.6, `portal_accept`, `portal_post_comment`, the agent-token minter Edge Function, and the `job-worker` function are all referenced and absent. `H-11` and `L-01` rest on what is written, not on what those will do.
- **No external specification was consulted.** The MyInvois field list in `C-11`, the SST registration mechanics in `H-21` and the HRD Corp grant lifecycle in `H-22` are from domain knowledge, not from LHDN, RMCD or HRD Corp documents. They should be checked against the real specifications before anyone builds to them — which is the same caveat `04:1661` and `04:1668` raise about the compliance rules themselves.
- **The frontend was not reviewed**, per the brief. Where a finding says a screen breaks, that is inferred from the endpoint and the typed payload, not from the screen.
- **`GET /v1/me` may already be fixed.** `002:186` creates `public.user_profiles`, which doc 01 never defined. I did not audit migration 002 against every other doc-01 gap, so other §3 findings may likewise be closed in migrations I treated as out of scope.

---

# Part 2 · Second pass, against the FINAL rulings

Re-review after the lanes swept. Part 1 above is left as written; this part says
which of its findings are closed, which stand, and what is new. Where Part 1 and
Part 2 disagree, **Part 2 wins** — it is the later evidence.

Baseline: the consolidated rulings file (R-C2, R-WB, R-GOV, R-STATUS, R-TEN,
R-EXT, R-AUTH, R-QUO, R-PROV, R-JSONB, R-COMMIT). Commits and checksums reviewed:

| File | Commit | MD5 |
|---|---|---|
| `01-domain-model.md` | `e532d09` | `0efa2b6f3e2fb7490dfb8782e88b8529` |
| `02-tenancy-auth-rls.md` | `8178da9` | `ea7c7d11685120af647da90b4949008c` |
| `03-action-envelope-and-policy-gate.md` | `5eed654` | `ea528743be5273d32d25252d6bef2090` |
| `04-money-versioning-provenance.md` | `4762dea` | `68bdc82dee0bfeb44d9e9fa4a5e71af2` |
| `05-events-outbox-realtime-audit.md` | `cc3a330` | `aa2b8434c4d0f85b8f523c8f4520823e` |
| `001_foundation_schemas_and_helpers.sql` | `2a24c76` | `91cf828720227b38a453859b56467bf0` |
| `002_tenancy_identity_and_permissions.sql` | `8b8bffd` | `0c64325c29d050d621728c140bb7c76f` |
| `003_enum_types.sql` | `c9ddb30` | `3d9b90ca21abbd08088090f9fc074bb8` |
| `004_shell_config_and_ref_allocation.sql` | `d18de06` | `8b7016e9b258bbe618875e167fc4e2a5` |
| `005_sales_organisations_enquiries_tna.sql` | **uncommitted on disk** | `b47b7ef02c947419ef4501ecd9d2720a` |
| `spikes/2026-09-12-agent-jwt-minting.md` | `f5cc811` | `e57e12c0b7e5a77ffa1ec2603edd4b1d` |

`001`'s MD5 is byte-identical to the one reviewed in Part 1. That matters: see `N-01`.

## 2.1 · Rulings compliance

| Ruling | State | Evidence |
|---|---|---|
| **R-C2** schema | **Applied, clean** | Zero matches for `public.<domain>` across all ten files, searched over 17 domain table names. Part 1's `C-01` is closed. |
| **R-WB** `report_effect_result`, `job_key` | **Applied** | `report_effect_result` 12× in 03, 6× in 05; `record_effect_result` gone; `job_key` 12× / 25×. One stale mention of the withdrawn name — `N-10`. |
| **R-GOV** single `app.effect_applier` | **Applied** | `effect_applier` in 01/02/03; `trainos.unlock_action_id` appears only as explicitly withdrawn (`01:2254`, `01:2794`, `03:36`). |
| **R-TEN** `app.current_tenant_id()`, top-level claims | **Applied** | 66/6/4/24 across 02/03/05/002. Every `app.tenant_id` mention is a note that it does not exist (`02:1172`, `002:292`). Every `app_metadata` mention is a warning against reading it, except the deliberate not-built-at-launch extension point at `02:310`. |
| **R-EXT** 001 enables pg_cron + pg_net | **NOT APPLIED** | `N-01`. |
| **R-AUTH** no self-minting | **Applied** | Spike exists at `spikes/2026-09-12-agent-jwt-minting.md`; `02` carries GoTrue sign-in. Part 1's `H-14` is closed. |
| **R-QUO** `core.quotations` | **Partially applied** | `core.quotations` in 01/02/03/001, but `app.quotation` still 6× in 04 — `N-08`. |
| **R-PROV** provenance keyed `(subject_table, subject_id, field)`, `_sen` | **Applied** | `unique (subject_table, subject_id, field)` at `04:673`. `_sen` now 101/43/110/5 across 01/03/04/05; the surviving `_minor` strings are the rulings themselves (`03:40`, `05:1804`). Part 1's `C-02` is closed. |
| **R-JSONB** every jsonb CHECK asserts key presence | **Applied in 04 and 03; absent in 05** | `N-02`. |
| **R-STATUS**, **R-COMMIT** | Applied | Row lifecycle table present; commits are per-file with explicit pathspec. |

## 2.2 · Part 1 findings now closed

`C-01` schema split · `C-02` money columns · `C-05` `app.role_permissions` is now seeded at `002:742` · `H-01` tenant helper, closed by the ruling reversal · `H-14` the JWT spike now exists.

**`C-04` (no RLS on `core`) is substantially closed by a better mechanism than I asked for.** `app.finalise_table` (`004:220-224`) enables *and* forces RLS and revokes all grants, with the comment *"RLS: enabled AND forced, with no policy. Deny-all until 014. Enabling here rather than in 014 means no table in this set is ever open, not even for the duration of one migration."* All 14 tables in `005` call it. The remaining exposure is sequencing only: `03:1812-1816`'s `grant select … to authenticated` must not land before the gate tables have policies. Flag it in the 011 migration, do not re-derive the finding.

## 2.3 · New findings

**N-01 · CRITICAL · R-EXT was not applied; `001` is byte-identical to the version reviewed in Part 1.**
`001:195-198` still enables `pgcrypto`, `citext`, `btree_gist`, `pg_trgm` and nothing else, and `001:377-387` still verifies exactly that list. `pg_cron` is referenced 3× in 03, 1× in 04, 3× in 05; `pg_net` 4× in 03 and 12× in 05; `vector` 3× in 01. Nine cron jobs still have no scheduler. The ruling names sb-migrations as blocker owner and amends forward, rollback, test, catalog and changelog. **Nothing moved.** This is now the only CRITICAL left in the pack and it blocks every scheduled behaviour in the design.

**N-02 · HIGH · R-JSONB is unimplemented in doc 05.**
Doc 05 has 16 `check (` constraints and **every one is on a scalar `text` or `smallint` column**. It contains no `?` key-presence operator, no `jsonb_typeof`, and no constraint of any kind on any jsonb column. Fourteen structured jsonb columns carry their required shape in a comment and nowhere else, including `core.events.actor jsonb not null` (`05:59`, rendered by the audit drawer), `app.outbox.last_error` (`05:528`), `app.dead_letters.dead_lettered_by jsonb not null` (`05:1283`), `core.runs.trigger jsonb not null` (`05:1761`), `core.runs.halted_by` (`05:1767`), `core.run_state_cards.plan` / `budgets` (`05:1930`, `05:1935`) and `core.run_checkpoints.cursor jsonb not null` (`05:1947`).
Doc 04 is the opposite and is the source of the lesson — `04:735-760` reproduces the trap by execution (*"A legacy boolean jury `{"enabled":true,"quorum":2,"of":3}` was accepted by that constraint in testing"*) and hardens every constraint. Doc 03 is also clean: `app.is_valid_condition_set` (`03:419-432`) opens with `e ? 'field' and e ? 'op'`, and payload validation (`03:1132`) tests `not (p_payload ? k) or p_payload->>k is null`.
**Fix:** apply 04's pattern to the fourteen columns in 05. The ruling says *every* jsonb CHECK asserts key presence; a table with no CHECK at all satisfies the letter and defeats the purpose.

**N-03 · HIGH · The gate's only payload guard fails open on a typo, by the same mechanism.**
`core.action_types.payload_schema jsonb not null default '{}'` (`03:237`) has **no constraint on its own shape**, and the validator reads it as `jsonb_array_elements_text(coalesce(v_type.payload_schema->'required','[]'::jsonb))` (`03:1130`). A seed row spelling the key `requires`, `required_keys`, or nesting it one level deeper yields NULL, the `coalesce` substitutes an empty array, the loop runs zero times, and **every payload for that action type validates**. This is the jsonb trap one level up, sitting on the single guard that produces §1's `details.fields[]`.
**Fix:** constrain `payload_schema` itself — `check (payload_schema ? 'required' and jsonb_typeof(payload_schema->'required') = 'array')` — and drop the `coalesce` so an unreadable schema raises instead of passing.

**N-04 · HIGH · Doc 01 still uses the rule-versioning model doc 04 tested and rejected.**
`04:35` (D9) records the measurement: *"Compliance rules are **bitemporal**… Copying rules per snapshot makes every unchanged rule look changed. Verified: the naive model emitted ten drift warnings where one was correct."* `04:385-388`: *"The first attempt modelled `rule_set` as a snapshot containing copies of every [rule]… Rule identity must be stable across snapshots."* 04's `app.compliance_rule.id text primary key -- 'HRD-014', stable across snapshots` carries two ranges, `validity` (daterange) and `known` (tstzrange), with a gist exclusion over both (`04:421-442`).
Doc 01 has neither axis. Its `compliance_rules` carries `rule_set_version_id uuid NOT NULL → rule_set_versions ON DELETE RESTRICT` with **`UNIQUE (tenant_id, rule_key, rule_set_version_id)`** — one row per rule per snapshot, which is exactly the copy model — and `rule_set_versions` has a single `effective_from`/`effective_to` axis with no registry-knowledge range at all.
Doc 03 is consistent with neither in detail but leans 01's way: `03:2324` has `RULE_CHANGE_APPROVE` performing *"`core.compliance_rules` insert or supersede, dated from the **circular**, not the approval"*, and `03:2314` pins `claim_rule_set_version` on the packet.
**Fix:** 01 adopts 04's bitemporal shape, or the lead rules 01's model authoritative and 04 reverts — but the drift-warning multiplication is measured, not theoretical, so 04 should win. Either way 03's `RULE_CHANGE_APPROVE` effect and the `claim_rule_set_version` pin need re-stating against whichever survives.

**N-05 · HIGH · The single search_path gate both lanes now depend on contradicts the executable migrations.**
Doc 02's §8.7 sweep (`02:1271-1283`) is excellent work — it asserts the exact stored string rather than non-nullness, covers `app`, `public` and `core`, includes procedures, and skips extension-owned functions:
```sql
and (p.proconfig is null or not (p.proconfig @> array['search_path=""']))
```
and `02:1265` states the rule correctly: *"assert the exact stored string, not that `proconfig` is non-null."* Since `4762dea`, doc 04 defers to this single version.
But migrations `001`, `002` and `004` create roughly twenty-five functions with `SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'`, whose `proconfig` stores `search_path=pg_catalog, public, extensions, pg_temp` — not `search_path=""`. **Every one of them fails the sweep.** `002:269` already records this as *"⚠ DEVIATION D1, recorded. Doc 02 writes `set search_path = ''` on these."*
**Fix:** one spelling, then one assertion. Recommend the migrations' 4-part form is changed to `''` with fully-qualified bodies, because that is what three of the five docs already write and what the sweep already asserts; otherwise the sweep must accept both spellings explicitly, which weakens it.
**Not a defect, to save the next reviewer the trip:** the migrations' `SET search_path TO 'a', 'b'` form quotes each element separately and is a correct multi-schema path. The trap is `SET search_path = 'a, b'` — one quoted string containing a comma. Every occurrence of the broken form in the pack (`01:229`, `02:1239`, `03:1969`, `04:1335`, `04:1340`, `04:1350`) is a labelled example of the trap, not live DDL. The retraction the lead asked about is properly in place: `04:1330` retracts the wrong result and `02:1232` replaces it with a measured three-row table.

**N-06 · MEDIUM · The rule grammar is typed in 04 and unconstrained jsonb in 01.**
04 uses typed columns `subject_field`, `op`, `reference_kind`, `reference`, `offset_amount`, `offset_unit` (`04:414-419`). 01 keeps `expression jsonb NOT NULL -- {field, op, reference, offsetDays}` with no constraint — so it is also an `N-02` instance, on the table whose contents defend an HRD Corp claim.

**N-07 · MEDIUM · The circular-number conflict is now a schema-level divergence, not just a source conflict.**
Doc 01's `compliance_rules.source_title` carries the example `"Circular 04/2026"`, following API_CONTRACT §17. Doc 04 seeds `DOC-0188` / `"Circular 2/2026"`, following DECISIONS §3, and says plainly at `04:1661` that *"a citation is the one thing a compliance rule cannot get wrong."* Recorded in the client decisions register as **D-44, owner Compliance, blocking**. Two documents will now seed two different citations for the same nine rules.

**N-08 · MEDIUM · R-QUO not fully swept in doc 04.** `app.quotation` survives 6× in 04 against `core.quotations` elsewhere. Also `/v1/costings` persists in 01 (2×) and 02 (2×) where the ruling applies contract R2's `/v1/quotations`.

**N-09 · LOW · Two actor-kind vocabularies in doc 05.** `core.events.actor` is documented `kind ∈ HUMAN|AGENT|SYSTEM|CLIENT` (`05:59`); `app.key_access_audit.actor` is documented `kind ∈ HUMAN|AGENT|SYSTEM` (`05:1686`). Both are comments with no constraint, so nothing enforces either — an `N-02` instance where the two comments also disagree. `02:83` fixes four kinds as a cross-lane convention.

**N-10 · LOW · Withdrawn name still cited.** `03:2998` explains `job_key` in terms of `settle_effect(job_key, ...)`, a name R-WB withdrew.

## 2.4 · Cross-lane conventions (doc 02 §0), checked lane by lane

Every row of `02:80-90` was checked against the other four documents. **All followed**, with two qualifications already recorded: the `app` schema row (*"A table in `app` is unreachable by the Data API… This has now bitten two lanes"*) is now satisfied everywhere except 04's residual `app.quotation` (`N-08`), and the minting row (*"Nobody mints tokens. Ever."*) is satisfied and backed by the spike.

## 2.5 · Standing rule recommended

Three lanes independently found a silent failure only because a test asserted an exact expected value rather than a shape: the search_path spelling (`02:1265`), the jsonb key-presence trap (`04:735`), and the rule-snapshot drift count (`04:35`). In all three the wrong version *looked more careful than the right one* and passed review.

**Adopt as a project rule: a test asserts the exact expected value, never non-nullness, never "contains", never "is not empty".** Three worked instances to cite when it is questioned:

- `proconfig @> array['search_path=""']`, not `proconfig is not null` — the non-null form passes all three spellings including the broken one.
- `jury ? 'mode' and jury ? 'quorum'`, not `jury->>'mode' in (...)` — a CHECK that evaluates to NULL passes.
- Count the drift warnings the model emits and compare against the number that should be correct — 04 found ten where one was right.

This belongs in the guardrail scripts, not in a doc, or it will be rediscovered a fourth time.

## 2.6 · Contract question answered

`DiffLine.description` required versus `Effect.description` optional: **make both required**, and it is already done. `packages/contract/src/actions.ts` now declares `description: string` on `Effect` with the note *"Required, like `DiffLine.description`: the policy gate always produces a sentence for every effect, so the two lists can be compared field for field without a null case"* (commit `273a12f`). That is the right call — §7 requires `effects[]` to equal `diff[]` field for field, and an optional field on one side of an equality makes the comparison ill-defined.

## 2.7 · Revised counts

| Severity | Part 1 | Closed | New in Part 2 | Standing |
|---|---|---|---|---|
| CRITICAL | 11 | 5 (`C-01`, `C-02`, `C-04` mechanism, `C-05`, plus `H-14`) | 1 (`N-01`) | **7** |
| HIGH | 26 | 1 (`H-01`) | 4 (`N-02`–`N-05`) | **29** |
| MEDIUM | 26 | 0 | 3 (`N-06`–`N-08`) | **29** |
| LOW | 8 | 0 | 2 (`N-09`, `N-10`) | **10** |

The seven standing CRITICALs are `N-01` (extensions), `C-03` (04's tables in `app`, partly swept), `C-06` (same as `N-01`), `C-07` (retention unimplemented), `C-08` (poison-pill retry), `C-09` (PDPA vs the append-only event log), `C-10` (levy staleness) and `C-11` (MyInvois fields). `C-06` and `N-01` are the same defect counted once.

**One thing to fix before anything else:** `N-01`. It is a five-line change to `001`, it is assigned, and until it lands nothing in the design that is supposed to happen on a schedule happens at all.

## 2.8 · What I could NOT verify in Part 2

- Still nothing executed. No database, no `pgTAP` run. The measured claims in 02 and 04 read as sound and I did not re-run them.
- `005_sales_organisations_enquiries_tna.sql` is **uncommitted on disk**. I reviewed the working-tree copy; it may change or never land.
- Migrations `006`–`016` do not exist. `C-04`'s residue, all of 05's event and run tables, and the gate tables in 03 are still governed by migrations nobody has written, so their RLS posture is a promise, not a fact. The `app.finalise_table` mechanism makes that promise much more likely to be kept.
- The JWT spike was confirmed to exist and to support `02`'s position; I did not audit its argument in depth.
- `config.toml` was not read, again. It remains the thing that exposes `core`, and nothing in the repo I looked at proves it does.

---

# Part 3 · Applied marks (append-only)

Written by the migrations author, not the critic. Parts 1 and 2 are left exactly
as reviewed; nothing above this line is edited. Each row names the finding, the
migration or amendment that closes it, and the evidence — because "applied" with
no evidence is the same claim the critic was brought in to check.

Migrations 001–009 are AUTHORED and EXECUTED against a scratch PostgreSQL 17.11
cluster with a platform shim. **Nothing is applied to any hosted project.** A
finding marked closed here is closed in the files, which is the only thing that
can be closed before an apply exists.

## Amendment pass A — 2026-09-13 (commit `93414bb`)

| Finding | Severity | State | Applied in | Evidence |
|---|---|---|---|---|
| `N-01` / `C-06` — R-EXT not applied, no `pg_cron`/`pg_net`/`vector` | CRITICAL | **Closed** | 001 (amended) | `001` §2 installs all three with the schema Supabase documents for each: `pg_cron WITH SCHEMA pg_catalog` (its control file pins `schema = pg_catalog` and is non-relocatable, so no other spelling parses) plus the two documented `cron` grants; `pg_net` and `vector` into `extensions`. The verify block and `test_001` T2/T2b assert the **schema of each extension** and the **callable surface** — `cron.job`, `cron.job_run_details`, `net.http_post`, `extensions.vector` — rather than a row in `pg_extension`. Executed: 9/9 apply, `test_001` 13 PASS. |
| `N-05` — the search_path gate contradicts the executable migrations | HIGH | **Closed** | 001–009 (amended) | One spelling, `SET search_path = ''`, on all forty functions, resolved in the direction the finding recommended. `test_001` T3 now asserts the exact stored string `search_path=""` as one element of `proconfig`, across `app`, `core` AND `public` (the version it replaces looked only at `app` and would have missed all sixteen `core` functions), skipping extension-owned functions. Deviation D1 in `002` is rewritten from a justification into a closure note. Safety was **verified, not assumed**: all forty bodies were read out of `pg_proc` and swept for bare references to any relation, function or type in `app`/`core`/`public`/`extensions`; two hits, both the column `trainer_id` colliding with the function `app.trainer_id()`, both false. The static sweep is load-bearing because plpgsql resolves relation names only at first execution — a clean apply proves nothing here. |
| `N-03` — the gate's payload guard fails open on a typo | HIGH | **Closed** | 004 (amended) | `app.action_types.payload_schema` carries `CONSTRAINT action_types_payload_schema_shape CHECK (payload_schema ? 'required' AND jsonb_typeof(payload_schema -> 'required') = 'array')`, with the default moved to `'{"required": []}'` in the same change because the constraint and the default are one decision. The `jsonb_typeof` half is not redundant: `{"required": "ref"}` satisfies key presence and still makes `jsonb_array_elements_text` raise at runtime instead of at insert. The finding also asked that the `coalesce` be dropped so an unreadable schema raises — that belongs to 011's validator and is **still open**, tracked below. |
| `C-04` residue — sequencing of `grant select … to authenticated` before the gate tables have policies | CRITICAL (residue) | **Carried to 011** | — | Flagged in 011's header as the finding asks, not re-derived. |
| `C-03` — doc 04's money and compliance tables in `app` | CRITICAL | **Closed in the migrations** | 007, 009 | Every client-readable table doc 04 placed in `app` is created in `core` with doc 01's plural names: `core.invoice_lines`, `core.rate_cards`, `core.provenance`, `core.compliance_rules`, `core.rule_set_versions`. `app` holds only the gate, the helpers and the outbox seam. The finding is closed **in the executable pack**; doc 04's own prose still says `app` and is not mine to edit. |
| — | — | **New, found by execution** | 002, 004, 007 | Three tables had neither RLS nor FORCE: `app.role_permissions`, `app.action_types`, `core.provenance_subjects`. The last is in `core`, which `config.toml` exposes to PostgREST, so it was reachable from a browser. All three now enabled and forced. **The naive fix would have broken the product**, and this was measured rather than reasoned: with a table and its `SECURITY DEFINER` reader owned by a role created `NOSUPERUSER NOBYPASSRLS`, `app.has_permission()` returns `false` for every permission under forced-with-no-policy and `true` with one `SELECT` policy. `role_permissions` and `action_types` therefore carry one; the grant layer remains the guard (`anon` and `authenticated` hold no `SELECT` — measured, both false — and `app` is not an exposed schema). `provenance_subjects` correctly gets none: its only SQL consumer is a foreign key, and referential integrity checks bypass row security by design. |
| §2.8 — "`config.toml` was not read, again" | — | **Closed** | 001 (amended) | Read on 2026-09-13. It sets `schemas = ["public", "core", "graphql_public"]`, so `core` is exposed and `app` is not. `001`'s header no longer justifies the `core` schema by quoting doc 03 §1 — an early draft the committed document later contradicted, which is `C-01` — and rests on `config.toml` plus the ~250 `core.*` references three lanes wrote against it. |
| §2.8 — "`006`–`016` do not exist, so their RLS posture is a promise" | — | **Partly closed** | 006–009 | 006–009 exist and are executed. Every table in `app`, `core` and `public` is now RLS-enabled and forced — asserted by query, not by grep, which matters: the original grep for `FORCE ROW LEVEL SECURITY` returned zero because `app.finalise_table` emits it through `format()` with two spaces. 010–016 remain unwritten and their posture remains a promise. |
| §4.1's open question — does Supabase's `postgres` carry `BYPASSRLS`? | — | **Made irrelevant** | 002 (amended) | Not settled, and it is now stated plainly that it is not. Supabase's RLS guide says a function created by `postgres` "will have bypassrls privileges", which implies yes, but that is an inference from prose about a role attribute nobody here can read. Instead the pack is built to be correct **either way**: `app.custom_access_token_hook` and `app.principal_claims` are `SECURITY INVOKER` so they genuinely run as `supabase_auth_admin` (which makes 002's grants and policies load-bearing rather than the dead code §4.1 said one of them must be), and every table a `SECURITY DEFINER` function must read carries a policy admitting that read. Doing so exposed a real gap the DEFINER mode had hidden: `supabase_auth_admin` held no `USAGE` on schema `public`, so the hook failed with `permission denied for schema public`. `test_002` T9 had been passing vacuously and only tested what its name claimed once the mode changed. |
| `N-02`, `N-04`, `N-06`–`N-10`, `C-07`–`C-11` | — | **Still open** | — | Owned by 010–016. `C-07` retention, `C-08` poison-pill retry and `N-02` jsonb shape belong to 012/015; `C-09` PDPA, `C-10` levy staleness and `C-11` MyInvois to 010/012; `N-04`, `N-06` and `N-07` are doc-level disagreements (01 vs 04 on rule versioning, on the rule grammar, and on the circular number, D-44) that a migration cannot settle without a ruling on which document wins. |

**Standing rule §2.5 adopted.** "A test asserts the exact expected value, never
non-nullness, never contains, never is-not-empty." Applied in this pass to
`test_001` T3 (`'search_path=""' = ANY (proconfig)`, not `proconfig IS NOT NULL`,
which passes all three spellings including the broken one), to `test_001` T2
(the extension's schema, not its presence), and to `test_003` T2 (an explicit
allowance list naming each later-migration enum and its owner, never a predicate
like "created after 003" — noticing a type nobody declared is that pin's whole
job).

**One correction to Part 2 §2.8's "still nothing executed".** Everything in
001–009 is now executed, and executing it is what found the defects in this
pass. Three pins failed the first time they were run against the FULL applied
set rather than immediately after their own migration: `test_003` T2, `test_003`
T5 and `test_004` T1a. Two were defects in the pins and one was a genuine
missing `FORCE`. **A pin that has only ever been run at the moment that flatters
it has not been run.**
