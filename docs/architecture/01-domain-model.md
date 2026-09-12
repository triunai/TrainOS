# TrainOS — domain model and ERD

Owner lane: **sb-erd** (domain model + ERD).
Adjacent lanes referenced but **not** designed here: **sb-tenancy** (tenant, users, membership, RLS),
**sb-actions** (action envelope, policy gate, approvals, idempotency), **sb-money** (rate cards,
money semantics, rule/version pinning, provenance), **sb-events** (domain events, outbox, realtime,
audit, inbound webhook receipts).

Sources: `API_CONTRACT.md` §1–§18, `REPORT.md` "Recurring entities", `DECISIONS.md` 1–7.
`packages/contract/src` did not exist when this work started, so the contract markdown was the canonical
field list. The package appeared while this document was being written, and a reconciliation pass was run
against its `enums.ts` and `domain/*.ts` before commit: every enum below whose values the package fixes now
matches the package, and the four divergences that remain are listed under "Deviations from contract".
Field-level optionality has **not** been reconciled — see "What I could NOT verify".

---

## Phase 1 — entities found, and the supersedes applied

### Entities found in the contract

Eighty-nine tables across six bounded contexts, plus twenty referenced from adjacent lanes. Grouped by the contract section that introduces them.

| Contract section | Entities |
|---|---|
| §1 conventions | `provenance`*, `idempotency_keys`*, `ref_sequences`, `ref_formats` |
| §2 shell | `saved_views`, `templates`, `template_sections`, `pipelines`, `pipeline_steps`, `policies`*, `audit_entries`* |
| §3 actions | `action_requests`*, `action_effects`*, `action_drafts`*, `action_evidence`* |
| §4 enquiries | `enquiries`, `enquiry_extraction_fields`, `follow_ups`, `outbound_messages`, `message_rates`, `contact_consents` |
| §5 orgs | `organisations`, `organisation_health_snapshots`, `contacts`, `opportunities`, `organisation_suggestions` |
| §6 TNA/catalogue | `tnas`, `tna_constraints`, `tna_gaps`, `tna_evidence`, `tna_recommendations`, `programmes`, `programme_modules`, `programme_pricing_tiers`, `programme_materials`, `programme_trainers`, `trainers`, `trainer_availability`, `trainer_bookings`, `proposals`, `proposal_sections`, `quotations`, `quotation_lines` |
| §7 approvals | `approval_requests`*, `approval_decisions`*, `approval_evidence`*, `approval_diff_entries`* |
| §8 delivery | `engagements`, `engagement_step_states`, `engagement_checklist_items`, `sessions`, `engagement_trainers`, `participants`, `attendance_days`, `attendance_entries`, `certificates`, `evaluation_responses`, `signatures`, `attachments` |
| §9 compliance + finance | `hrdc_packets`, `hrdc_packet_documents`, `hrdc_levy_statements`, `invoices`, `invoice_lines`, `invoice_sync_entries`, `payments`, `collections_cases`, `collection_rules` |
| §10 AI-ops | `agents`, `agent_autonomy`, `runs`, `run_steps`, `run_guardrails`, `eval_sets`, `eval_runs`, `metric_definitions`, `hours_saved_baseline_tables`, `hours_saved_baselines` |
| §11 portal | `public_share_tokens`, `portal_comments`, `portal_acceptances`, `webhook_receipts`* |
| §17 AI ops update | `ai_tiers`, `ai_routing_entries`, `ai_provider_keys`, `ai_provider_key_tiers`, `ai_usage_entries`, `ai_budgets`, `run_nodes`, `run_events`, `run_state_cards`, `run_checkpoints`, `jury_votes`, `compliance_rules`, `rule_set_versions`, `rule_change_sets`, `rule_changes`, `rule_change_affected_engagements`, `compliance_check_results`, `compliance_version_drifts`, `knowledge_sources`, `knowledge_chunks` |

`*` = named by another lane, listed for completeness and referenced by FK only. Not designed here.

### Supersedes applied (§18 and DECISIONS.md)

| # | Superseded text | What the schema does instead |
|---|---|---|
| S1 | §17 "checks resolve rules **as at the training date**" | Grant-side rules resolve at **grant submission**, claim-side at **claim submission** (DECISIONS §6). `engagements.grant_rule_set_version_id` is pinned at grant submission; `hrdc_packets.claim_rule_set_version_id` at claim submission. `compliance_check_results` stores the version it applied; `compliance_version_drifts` records a warning citing both versions rather than switching silently. Checks re-evaluate at every stage transition. |
| S2 | §17 `jury: { enabled: true, quorum, of, tiers }` (boolean-shaped) | `ai_routing_entries.jury` is an object: `mode ∈ GATE·SAMPLE·ESCALATE`, `quorum`, `of`, `tiers[]`, `sampleRate`, `triggers{minConfidence,maxValue,firstOfKind}` (§18, DECISIONS §2). `jury_votes` rows carry `blocking bool` so `SAMPLE` votes are recorded for drift without being decision inputs. |
| S3 | §16.10 "does the line unit derive from the total, or the total from the lines?" | **Total-from-lines**, integer sen, each line rounded half-up before summing, SST on the summed net (§18, DECISIONS §7). A package price is one line at `qty = 1`. Per-pax is display-only and has **no column** on `invoice_lines` or `quotation_lines`. A reconciliation trigger rejects a total that is not the sum of rounded lines. |
| S4 | §6 `costing.rateCardYear: 2026` (a year) | A year is not a version (§18, DECISIONS §5). The quotation snapshots the card it was priced against. **sb-money C-3 makes this `rate_card_id uuid` referencing their frozen-label `rate_card`**, with the API's `rateCardVersion` string and its `v0-placeholder` value rendered by join. |
| S5 | §10 `ADMIN_HOURS_SAVED` as a bare number | `hours_saved_baseline_tables` (versioned, per tenant) + `hours_saved_baselines` (per action type). Reports carry `basis ∈ MEASURED·ILLUSTRATIVE` and `haircut` (0.7 for the first quarter). The tile may not render a bare number (§18, DECISIONS §4). |
| S6 | DECISIONS §3: the demo's **five-working-day claim window** | Deleted. Claim window is `claim_submitted ≤ training_completion + 6 months`. All HRD Corp offsets are **calendar days**. The "apply before Friday 5 PM" heuristic is not a rule — it is a `WARN` check with no `compliance_rules` row. Seeded rules load as `PROPOSED` until Finance verifies them against the circular. |
| S7 | §12 `AutonomyLevel` as a free grant | `agent_autonomy` carries both `level` and `ceiling` with `ceiling_reason`. DECISIONS §1 launch defaults seed the table; anything money-moving, client-committing or HRDC-touching has `ceiling = ACT_WITH_APPROVAL`, enforced by a check constraint, not by application code. |

---

## Conventions

### Schema and naming

Three schemas, per the lead's ruling, migration `001` and `config.toml`:

| Schema | Holds | Exposed by PostgREST |
|---|---|---|
| `core` | All 89 domain tables in this document | yes |
| `public` | Identity and tenancy only: `tenants`, `memberships`, `profiles`, and `saved_views` | yes |
| `app` | Unexposed internals: the gate ledger, the outbox, helper functions, the transition registry | no |

**Every table in this document is in `core`** and is named in the **plural**. The one exception is
`saved_views`, which sits in `public` because `02-tenancy-auth-rls.md` is committed with its policies
written against `public.saved_views`. Table names below are unqualified for readability; read them all as
`core.<name>` unless the text says otherwise.

There is no `users` table: the user is `auth.users`, and `public.memberships` carries the tenant-scoped
role. Every `owner_id` below references `auth.users(id)`.

### Every table carries this and it is not repeated below

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `tenant_id` | `uuid` | no | — | FK → `tenant(id)` `ON DELETE RESTRICT`. Owned by **sb-tenancy** |
| `ref` | `text` | no | allocated | Human reference, see below. Omitted on line/child/log/config tables (noted per table) |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | Maintained by a shared `set_updated_at()` `BEFORE UPDATE` trigger |
| `created_by_kind` | `actor_kind` | no | — | `HUMAN·AGENT·SYSTEM·CLIENT` |
| `created_by_id` | `text` | no | — | `u_amirah`, `agent_proposal`, `ingest_email`. Text, not a FK: agents and system principals are not rows in `auth.users` |
| `created_by_name` | `text` | yes | — | Denormalised display name, frozen at write time |

Plus, on every table: `UNIQUE (tenant_id, id)` and `UNIQUE (tenant_id, ref)` where `ref` exists.

**Composite tenant-safe foreign keys.** Every FK in this model is composite:
`FOREIGN KEY (tenant_id, parent_id) REFERENCES parent (tenant_id, id)`. A cross-tenant reference is then
unrepresentable at the storage layer, independently of whatever RLS **sb-tenancy** writes. The ERD shows
the logical FK column only; read every one as carrying `tenant_id` alongside it.

**Provenance.** No table in this model carries a `provenance_id` column. `provenance` is **sb-money**'s
table and it points **at** the subject, keyed `(subject_table, subject_id, field)`. A row is human-authored
when no provenance row exists for it, which preserves §1's "absent means human-authored" exactly. The
absence simply lives in the other table.

This reverses what this document originally assumed, and the reason is decisive. A subject-to-provenance
foreign key cannot be traversed backwards, so "all AI-generated fields awaiting review" and "everything
from run_4821" would each need a nine-way union with no shared sort column, which cannot be paginated by
cursor. See `04-money-versioning-provenance.md` C-1. The cost is real: referential integrity is replaced by
a subject allow-list, per-table `AFTER DELETE` triggers and a sweep. It is sb-money's cost to carry.

What survives from this side is the field-level shape. Where a record needs provenance on more than one
field, the field is a row. `proposal_sections`, `tna_gaps` and `enquiry_extraction_fields` are already
normalised that way, so `(subject_table, subject_id, field)` resolves against them without a second column
anywhere. **The two directions must not both exist.** A `provenance_id` kept for convenient joins alongside
the polymorphic key is two sources of truth for one edge.

`provenance.sources` is a **jsonb** column with a GIN index, not a child table (C-2).

### The monetary value of an action

sb-actions reads the value of an action from the target record, never from the request body, so an agent
cannot understate a proposal to duck the APV-01 threshold. Each gated target therefore has exactly one
stable money column, and these are the four:

| Target | Column | Currency |
|---|---|---|
| `proposals` | `value_sen` | `currency` |
| `quotations` | `sell_price_sen` | `currency` |
| `invoices` | `total_sen` | `currency` |
| `hrdc_packets` | `claim_value_sen` | `currency` |

None of the four is nullable once the record reaches a gateable state, and all four are frozen by the
immutability rules in §4 at the point the gate reads them.

### Money

Two columns per amount: `<name>_sen bigint` and one `currency char(3) NOT NULL DEFAULT 'MYR'` per table.
No composite type and no `numeric`. Rationale: composite types round-trip badly through PostgREST and
produce unusable generated TypeScript; integer sen is the §1 and §18 requirement; a per-table currency
column is honest for a single-currency launch and can be promoted to per-column later without a rewrite.
`CHECK (<name>_sen >= 0)` wherever the contract admits no negative.

### Rates

`numeric(6,4)` for margin, commission and tax rates (`0.4100`). `numeric(4,3)` for confidence, fit scores,
eval scores and cache-hit rates, with `CHECK (x >= 0 AND x <= 1)`. Never `float`.

### Enums — native Postgres enum types, with one deliberate exception

**Decision: closed catalogues in §12 and §17 become native Postgres `CREATE TYPE ... AS ENUM`.
Open, config-driven sets become `text` with a FK to a reference table. Nothing uses `text + CHECK`.**

Why native enums for the closed sets: they are frozen by the API contract, so the cost of `ALTER TYPE`
never arrives; they generate real union types in Supabase's TypeScript output, which is the whole point of
having a contract package; and they are four bytes on disk in a model with a lot of status columns.

Why a reference table, not a `CHECK`, for the open sets: the project rule is that *stage names and order
render from pipeline configuration, never hardcoded*. A `CHECK` constraint is code; a reference table is
data, editable by an admin screen, joinable for labels and ordering, and enforceable by FK. The open sets
are: `action_type` (§3, grows with every new capability), `lifecycle step key` (pipeline config),
`compliance check key` (`CHK_LEAD_TIME`, grows with the rule registry), `hrdc_document_type`
(HRD Corp changes it), `metric key` (§10 self-describing cells), `tier key` (§17 tiers are rows already),
`template type`, and `constraint code` on TNA.

Native enum types created: `actor_kind`, `app_role`, `provenance_origin`, `autonomy_level`,
`enquiry_channel`, `enquiry_status`, `opportunity_stage`, `tna_status`, `gap_priority`, `proposal_status`,
`approval_decisions`, `approval_status`, `urgency_group`, `risk_level`, `lifecycle_state`,
`engagement_status`, `attendance_status`, `capture_method`, `absence_reason`, `hrdc_scheme`,
`packet_status`, `invoice_status`, `sync_state`, `collection_stage`, `message_category`, `agent_status`,
`run_status`, `run_step_status`, `action_status`, `diff_op`, `tier_status`, `routing_strategy`,
`cache_strategy`, `provider_key_status`, `billing_owner`, `budget_state`, `rule_status`, `rule_change_op`,
`check_state`, `monitor_status`, `embedding_status`, `trace_node_kind`, `run_event_type`, `jury_mode`,
`severity`, `view_visibility`, `hours_saved_basis`, `attendance_half`, `booking_state`.

`severity` is `INFO·WARN·DANGER·ALERT`, matching the contract package's `SEVERITIES`. It consolidates
§4 `related[].severity`, §6 `constraints[].severity`, §9 `deadlineSeverity` and §18 `versionDrift[].severity`,
which are one concept with four spellings in the markdown. §2's `badge.severity` (`DEFAULT·ALERT`) stays a
separate presentation enum, `badge_severity`, because the package keeps it separate and because no badge
count is ever stored.

Confirmed against the contract package and added as native enums: `organisation_status`,
`organisation_match_reason`, `follow_up_status`, `document_presence`, `evidence_type`, `template_type`,
`saved_view_object`, `knowledge_source_type`, `retrieval_scope`, `trainer_band`, `venue_mode`,
`travel_region`, `ai_provider`, `hrdc_packet_panel_state`, `rule_resolution_basis`, `budget_scope`,
`usage_group_by`, `delta_direction`, `badge_severity`, `theme`, `filter_op`.

### Ref generation

Two formats in the contract:

- **Dated**: `ENQ-2026-0912`, `PRO-2026-0184`, `QUO-2026-0184`, `APV-2026-0771`, `INV-2026-0311`,
  `GRT-2026-77412`, `CLM-2026-118834` — `PREFIX-YYYY-NNNN`, sequence restarts each calendar year.
- **Undated**: `ORG-0114`, `CON-0233`, `OPP-0512`, `TNA-0042`, `PRG-0031`, `TRN-0007`, `ENG-0231`,
  `SES-0461`, `PAR-1182`, `FUP-0311` — `PREFIX-NNNN`, sequence never restarts.

Strategy: a `ref_formats` table (prefix, `dated bool`, `width`) and a `ref_sequences` counter table keyed
`(tenant_id, prefix, period)` where `period` is the four-digit year for dated prefixes and `'-'` otherwise.
Allocation is a `SECURITY DEFINER` function `next_ref(prefix text)` doing a single
`INSERT … ON CONFLICT (tenant_id, prefix, period) DO UPDATE SET next_value = ref_sequences.next_value + 1 RETURNING`.
That serialises per prefix per tenant, not globally, and holds the row lock for microseconds.

Refs are **not gapless**: a rolled-back transaction burns a number. That is fine for every prefix except
`INV-`, where Malaysian tax-invoice numbering is conventionally expected to be sequential and unexplained
gaps are an audit question. Open question Q12 below.

Refs are allocated by a `BEFORE INSERT` trigger, are immutable after insert (`enforce_immutable_columns`),
and are never a primary key — `id` is. The API exposes both because §1 does.

**Prefix ownership.** `HRD-` belongs to the compliance **rules** registry (`compliance_rules.rule_key`:
HRD-014, HRD-015, HRD-022 in §17) and is not available for anything else. sb-actions reserves `CMP-` for
compliance **policy** ids, which are a different thing in a different table. `ref_formats` is the registry
that keeps the two apart, and a prefix collision is a unique-constraint violation rather than a
conversation.

### Timestamps and dates

`timestamptz` everywhere, stored UTC, rendered `+08:00`. Date-only contract fields (`dueAt: "2026-12-14"`,
`dates: ["2026-11-12","2026-11-13"]`, `effectiveFrom`) are `date`. The `dates[]` array on an engagement is
**not** an array column — it is derived from `sessions.date`, because the sessions exist anyway and two
sources of truth for delivery dates is exactly the divergence the project rules forbid.

### JSONB, and where it is allowed

Per ruling R-JSONB, **every jsonb column carries a CHECK asserting the keys it must contain**, so an
open-ended shape never means an unchecked one. `compliance_rules.expression` must hold `field` and `op`;
`ai_routing_entries.jury` must hold `mode`, `quorum` and `of`; `agents.resume_condition` must hold
`metric`, `op` and `value`; `saved_views.filters` must be an array of objects carrying `field` and `op`;
`run_state_cards.plan` must be an array of objects carrying `n` and `status`;
`compliance_check_results.computed` and `run_steps.args`/`result` are free-form by nature and assert only
that the value is an object. Written as `CHECK (col ?& array['field','op'])` for objects and a
`jsonb_array_elements` predicate for arrays.

JSONB is allowed only where the contract's own shape is open-ended and never filtered on in SQL:
`compliance_rules.expression`, `compliance_check_results.computed`, `run_steps.args/result`,
`run_events.detail`, `ai_routing_entries.jury`, `saved_views.filters`, `agents.resume_condition`,
`hrdc_packet_documents.meta`. Everything a screen filters, sorts or groups by is a column.

---

## 1 · Bounded contexts

Six contexts. A table lives in exactly one. Cross-context references are always by `id` FK, never by
duplicated data, with two declared exceptions (`created_by_name` and `organisation_name` on the client
portal projection) where the value must be frozen at write time.

### Sales
Owns the path from an inbound message to a signed proposal.

`organisations` · `organisation_health_snapshots` · `contacts` · `contact_consents` · `enquiries` ·
`enquiry_extraction_fields` · `opportunities` · `organisation_suggestions` · `follow_ups` · `tnas` ·
`tna_constraints` · `tna_gaps` · `tna_evidence` · `tna_recommendations` · `proposals` ·
`proposal_sections` · `public_share_tokens` · `portal_comments` · `portal_acceptances` · `quotations` ·
`quotation_lines`

### Delivery
Owns the catalogue and everything that happens between a won deal and a closed engagement.

`programmes` · `programme_modules` · `programme_pricing_tiers` · `programme_materials` · `programme_trainers` ·
`trainers` · `trainer_availability` · `trainer_bookings` · `engagements` · `engagement_step_states` ·
`engagement_checklist_items` · `sessions` · `participants` · `attendance_days` · `attendance_entries` ·
`certificates` · `evaluation_responses` · `engagement_trainers` · `outbound_messages` · `message_rates`

The catalogue sits in Delivery, not Sales, because `PUT /v1/programmes/{id}` is ADMIN + L&D and returns
`FORBIDDEN` to SALES (§6). Sales reads it; Delivery owns it.

### Compliance
Owns HRD Corp state, the rule registry and the knowledge corpus the rules are extracted from.

`hrdc_packets` · `hrdc_packet_documents` · `hrdc_levy_statements` · `compliance_rules` · `rule_set_versions` ·
`rule_change_sets` · `rule_changes` · `rule_change_affected_engagements` · `compliance_check_results` ·
`compliance_version_drifts` · `knowledge_sources` · `knowledge_chunks`

### Finance
Owns receivables and the accounting-package boundary. TrainOS does not e-invoice; MyInvois validation is
mirrored in, never originated (§9).

`invoices` · `invoice_lines` · `invoice_sync_entries` · `payments` · `collections_cases` · `collection_rules`

Rate cards, floor prices as policy, commission schedules and the rounding rules are **sb-money**'s.
`quotations` and `invoices` live here structurally but their money columns obey sb-money's semantics.

### AI-ops
Owns agents, runs, model routing, spend and evaluation.

`agents` · `agent_autonomy` · `runs` · `run_steps` · `run_nodes` · `run_events` ·
`run_state_cards` · `run_guardrails` · `run_checkpoints` · `jury_votes` · `eval_sets` ·
`eval_runs` · `ai_tiers` · `ai_routing_entries` · `ai_provider_keys` · `ai_provider_key_tiers` ·
`ai_usage_entries` · `ai_budgets`

`agent_autonomy` lives here because it is the agent registry screen's data (M18-S01), but it is an **input
to sb-actions' policy gate**. sb-actions reads it; AI-ops writes it. The `policies` table itself is sb-actions'.

### Shell / Platform
Cross-cutting, tenant-scoped configuration and shared primitives.

`saved_views` · `templates` · `template_sections` · `pipelines` · `pipeline_steps` · `metric_definitions` ·
`hours_saved_baseline_tables` · `hours_saved_baselines` · `attachments` · `signatures` · `ref_formats` ·
`ref_sequences`

Referenced, owned elsewhere: `tenants`, `auth.users`, `memberships` (sb-tenancy); `policies`, `action_requests`,
`action_effects`, `action_evidence`, `action_drafts`, `approval_requests`, `approval_decisions`,
`approval_evidence`, `approval_diff_entries`, `idempotency_keys` (sb-actions); `provenance`,
`rate_card` (sb-money); `domain_events`, `outbox`, `audit_entries`, `webhook_receipts`
(sb-events).

---

## 2 · ERD

`tenant_id` is on every table and every FK is composite `(tenant_id, parent_id)`. Edges to `tenants` are
omitted from the diagram — eighty-nine of them would render the rest unreadable — and the composite-FK
convention above is what the migration author implements. Tables owned by other lanes appear with their
name suffixed `__ext` so the migration author does not create them.

```mermaid
erDiagram
    %% ---------- Shell / Platform ----------
    tenants__ext {
        uuid id PK
    }
    saved_views {
        uuid id PK
        uuid tenant_id FK
        uuid owner_id FK
        text object
    }
    templates {
        uuid id PK
        uuid tenant_id FK
        text type
        int version
    }
    template_sections {
        uuid id PK
        uuid template_id FK
        int n
    }
    pipelines {
        uuid id PK
        text object
    }
    pipeline_steps {
        uuid id PK
        uuid pipeline_id FK
        text step_key
        int position
    }
    metric_definitions {
        uuid id PK
        text metric_key
    }
    hours_saved_baseline_tables {
        uuid id PK
        text version
    }
    hours_saved_baselines {
        uuid id PK
        uuid baseline_table_id FK
        text action_type FK
    }
    attachments {
        uuid id PK
        text storage_path
    }
    signatures {
        uuid id PK
        uuid attachment_id FK
    }
    ref_formats {
        uuid id PK
        text prefix UK
    }
    ref_sequences {
        uuid id PK
        text prefix FK
        text period
    }
    action_types {
        uuid id PK
        text action_type UK
    }

    %% ---------- Other lanes ----------
    provenance__ext {
        uuid id PK
        uuid run_id FK
    }
    policies__ext {
        uuid id PK
        text policy_key UK
    }
    action_requests__ext {
        uuid id PK
        text action_type FK
        uuid policy_id FK
    }
    approval_requests__ext {
        uuid id PK
        uuid action_request_id FK
        uuid policy_id FK
    }
    audit_entries__ext {
        uuid id PK
    }

    %% ---------- Sales ----------
    organisations {
        uuid id PK
        uuid owner_id FK
    }
    organisation_health_snapshots {
        uuid id PK
        uuid organisation_id FK
    }
    contacts {
        uuid id PK
        uuid organisation_id FK
    }
    contact_consents {
        uuid id PK
        uuid contact_id FK
    }
    enquiries {
        uuid id PK
        uuid matched_organisation_id FK
        uuid matched_contact_id FK
        uuid assigned_to_user_id FK
    }
    enquiry_extraction_fields {
        uuid id PK
        uuid enquiry_id FK
    }
    opportunities {
        uuid id PK
        uuid organisation_id FK
        uuid primary_contact_id FK
        uuid source_enquiry_id FK
        uuid owner_id FK
    }
    organisation_suggestions {
        uuid id PK
        uuid organisation_id FK
        uuid programme_id FK
    }
    follow_ups {
        uuid id PK
        uuid organisation_id FK
        uuid contact_id FK
        uuid proposal_id FK
        uuid invoice_id FK
    }
    tnas {
        uuid id PK
        uuid opportunity_id FK
        uuid questionnaire_template_id FK
    }
    tna_constraints {
        uuid id PK
        uuid tna_id FK
    }
    tna_gaps {
        uuid id PK
        uuid tna_id FK
    }
    tna_evidence {
        uuid id PK
        uuid tna_id FK
    }
    tna_recommendations {
        uuid id PK
        uuid tna_id FK
        uuid programme_id FK
    }
    proposals {
        uuid id PK
        uuid opportunity_id FK
        uuid template_id FK
        uuid programme_id FK
        uuid run_id FK
    }
    proposal_sections {
        uuid id PK
        uuid proposal_id FK
    }
    public_share_tokens {
        uuid id PK
        uuid proposal_id FK
        uuid tna_id FK
    }
    portal_comments {
        uuid id PK
        uuid proposal_id FK
        uuid contact_id FK
    }
    portal_acceptances {
        uuid id PK
        uuid proposal_id FK
        uuid signature_id FK
        uuid engagement_id FK
    }
    quotations {
        uuid id PK
        uuid proposal_id FK
        uuid supersedes_quotation_id FK
        uuid rate_card_id FK
        uuid invoice_id FK
    }
    quotation_lines {
        uuid id PK
    }

    %% ---------- Delivery ----------
    programmes {
        uuid id PK
    }
    programme_modules {
        uuid id PK
        uuid programme_id FK
    }
    programme_pricing_tiers {
        uuid id PK
        uuid programme_id FK
    }
    programme_materials {
        uuid id PK
        uuid programme_id FK
    }
    trainers {
        uuid id PK
    }
    programme_trainers {
        uuid id PK
        uuid programme_id FK
        uuid trainer_id FK
    }
    trainer_availability {
        uuid id PK
        uuid trainer_id FK
    }
    trainer_bookings {
        uuid id PK
        uuid trainer_id FK
        uuid engagement_id FK
    }
    engagements {
        uuid id PK
        uuid organisation_id FK
        uuid opportunity_id FK
        uuid programme_id FK
        uuid proposal_id FK
        uuid owner_id FK
        uuid pipeline_id FK
        uuid grant_rule_set_version_id FK
    }
    engagement_step_states {
        uuid id PK
        uuid engagement_id FK
        uuid pipeline_step_id FK
    }
    engagement_checklist_items {
        uuid id PK
        uuid engagement_id FK
    }
    sessions {
        uuid id PK
        uuid engagement_id FK
        uuid trainer_id FK
    }
    engagement_trainers {
        uuid id PK
        uuid engagement_id FK
        uuid trainer_id FK
    }
    participants {
        uuid id PK
        uuid engagement_id FK
        uuid contact_id FK
    }
    attendance_days {
        uuid id PK
        uuid engagement_id FK
        uuid approved_by_user_id FK
    }
    attendance_entries {
        uuid id PK
        uuid attendance_sheet_id FK
        uuid participant_id FK
        uuid signature_id FK
    }
    certificates {
        uuid id PK
        uuid participant_id FK
        uuid engagement_id FK
        uuid attachment_id FK
    }
    evaluation_responses {
        uuid id PK
        uuid engagement_id FK
        uuid participant_id FK
    }
    outbound_messages {
        uuid id PK
        uuid contact_id FK
        uuid template_id FK
        uuid follow_up_id FK
        uuid invoice_id FK
    }
    message_rates {
        uuid id PK
    }

    %% ---------- Compliance ----------
    hrdc_packets {
        uuid id PK
        uuid engagement_id FK
        uuid organisation_id FK
        uuid claim_rule_set_version_id FK
    }
    hrdc_packet_documents {
        uuid id PK
        uuid hrdc_packet_id FK
        uuid attachment_id FK
        text document_type FK
    }
    hrdc_levy_statements {
        uuid id PK
        uuid organisation_id FK
        uuid attachment_id FK
    }
    rule_set_versions {
        uuid id PK
    }
    compliance_rules {
        uuid id PK
        uuid rule_set_version_id FK
        uuid supersedes_rule_id FK
        uuid superseded_by_rule_id FK
        uuid knowledge_source_id FK
    }
    rule_change_sets {
        uuid id PK
        uuid knowledge_source_id FK
        uuid run_id FK
    }
    rule_changes {
        uuid id PK
        uuid rule_change_set_id FK
        uuid target_rule_id FK
        uuid new_rule_id FK
    }
    rule_change_affected_engagements {
        uuid id PK
        uuid rule_change_id FK
        uuid engagement_id FK
    }
    compliance_check_results {
        uuid id PK
        uuid engagement_id FK
        uuid compliance_rule_id FK
        uuid rule_set_version_id FK
        text check_key FK
    }
    compliance_version_drifts {
        uuid id PK
        uuid compliance_check_result_id FK
        uuid applied_version_id FK
        uuid current_version_id FK
    }
    knowledge_sources {
        uuid id PK
        uuid attachment_id FK
    }
    knowledge_chunks {
        uuid id PK
        uuid knowledge_source_id FK
    }
    check_keys {
        uuid id PK
        text check_key UK
    }
    hrdc_document_types {
        uuid id PK
        text document_type UK
    }

    %% ---------- Finance ----------
    invoices {
        uuid id PK
        uuid organisation_id FK
        uuid engagement_id FK
    }
    invoice_lines {
        uuid id PK
        uuid invoice_id FK
    }
    invoice_sync_entries {
        uuid id PK
        uuid invoice_id FK
    }
    payments {
        uuid id PK
        uuid invoice_id FK
    }
    collections_cases {
        uuid id PK
        uuid invoice_id FK
        uuid organisation_id FK
    }
    collection_rules {
        uuid id PK
        uuid template_id FK
    }

    %% ---------- AI-ops ----------
    agents {
        uuid id PK
        text agent_key
        text default_tier_key FK
    }
    agent_autonomy {
        uuid id PK
        uuid agent_id FK
        text action_type FK
    }
    runs {
        uuid id PK
        uuid agent_id FK
        uuid parent_run_id FK
        text tier_key FK
    }
    run_steps {
        uuid id PK
        uuid agent_run_id FK
        uuid approval_request_id FK
    }
    run_nodes {
        uuid id PK
        uuid agent_run_id FK
        uuid parent_node_id FK
        text tier_key FK
    }
    run_events {
        uuid id PK
        uuid agent_run_id FK
        uuid agent_run_node_id FK
    }
    run_state_cards {
        uuid id PK
        uuid agent_run_id FK
    }
    run_guardrails {
        uuid id PK
        uuid agent_run_id FK
    }
    run_checkpoints {
        uuid id PK
        uuid agent_run_id FK
    }
    jury_votes {
        uuid id PK
        uuid agent_run_event_id FK
        text tier_key FK
    }
    eval_sets {
        uuid id PK
    }
    eval_runs {
        uuid id PK
        uuid agent_id FK
        uuid eval_set_id FK
        text action_type FK
    }
    ai_tiers {
        uuid id PK
        text tier_key UK
    }
    ai_routing_entries {
        uuid id PK
        text action_type FK
        text tier_key FK
    }
    ai_provider_keys {
        uuid id PK
    }
    ai_provider_key_tiers {
        uuid id PK
        uuid ai_provider_key_id FK
        text tier_key FK
    }
    ai_usage_entries {
        uuid id PK
        uuid agent_run_id FK
        text tier_key FK
        uuid agent_id FK
        text action_type FK
    }
    ai_budgets {
        uuid id PK
        uuid raised_by_action_id FK
    }

    %% ---------- Sales relationships ----------
    organisations ||--o{ contacts : "employs"
    organisations ||--o{ opportunities : "sources"
    organisations ||--o{ organisation_health_snapshots : "scored by"
    organisations ||--o{ organisation_suggestions : "offered"
    organisations ||--o{ follow_ups : "subject of"
    organisations ||--o{ engagements : "buys"
    organisations ||--o{ invoices : "billed"
    organisations ||--o{ hrdc_levy_statements : "declares"
    organisations ||--o{ collections_cases : "owes"
    organisations |o--o{ enquiries : "matched to"
    contacts ||--o{ contact_consents : "grants"
    contacts |o--o{ enquiries : "sent"
    contacts |o--o{ opportunities : "primary for"
    contacts ||--o{ follow_ups : "chased"
    contacts ||--o{ portal_comments : "writes"
    contacts ||--o{ outbound_messages : "receives"
    contacts |o--o{ participants : "attends as"
    enquiries ||--o{ enquiry_extraction_fields : "extracted into"
    enquiries |o--o| opportunities : "converts to"
    opportunities |o--o| tnas : "qualified by"
    opportunities ||--o{ proposals : "priced by"
    opportunities |o--o| engagements : "won as"
    tnas ||--o{ tna_constraints : "limited by"
    tnas ||--o{ tna_gaps : "identifies"
    tnas ||--o{ tna_evidence : "cites"
    tnas ||--o{ tna_recommendations : "ranks"
    tnas |o--o| public_share_tokens : "shared by"
    proposals ||--o{ proposal_sections : "composed of"
    proposals ||--o{ public_share_tokens : "shared by"
    proposals ||--o{ portal_comments : "discussed in"
    proposals |o--o| portal_acceptances : "accepted by"
    proposals ||--o{ quotations : "costed by"
    proposals ||--o{ follow_ups : "prompts"
    quotations ||--o{ quotation_lines : "itemised by"
    quotations |o--o| quotations : "supersedes"
    portal_acceptances |o--|| signatures : "signed with"
    portal_acceptances |o--o| engagements : "creates"

    %% ---------- Delivery relationships ----------
    programmes ||--o{ programme_modules : "taught as"
    programmes ||--o{ programme_pricing_tiers : "priced by"
    programmes ||--o{ programme_materials : "supported by"
    programmes ||--o{ programme_trainers : "delivered by"
    programmes ||--o{ tna_recommendations : "recommended in"
    programmes ||--o{ proposals : "proposed in"
    programmes ||--o{ engagements : "delivered as"
    programmes ||--o{ organisation_suggestions : "cross-sold as"
    trainers ||--o{ programme_trainers : "certified for"
    trainers ||--o{ trainer_availability : "declares"
    trainers ||--o{ trainer_bookings : "held by"
    trainers ||--o{ sessions : "facilitates"
    engagements ||--o{ trainer_bookings : "reserves"
    engagements ||--o{ engagement_step_states : "progresses through"
    engagements ||--o{ engagement_checklist_items : "gated by"
    engagements ||--o{ sessions : "scheduled as"
    engagements ||--o{ engagement_trainers : "staffed by"
    trainers ||--o{ engagement_trainers : "assigned to"
    engagements ||--o{ participants : "registers"
    engagements ||--o{ attendance_days : "records"
    engagements ||--o{ certificates : "issues"
    engagements ||--o{ evaluation_responses : "evaluated by"
    engagements ||--o{ invoices : "billed as"
    engagements |o--o| hrdc_packets : "claimed via"
    engagements ||--o{ compliance_check_results : "checked by"
    engagements ||--o{ rule_change_affected_engagements : "impacted by"
    pipelines ||--o{ pipeline_steps : "ordered as"
    pipelines ||--o{ engagements : "configures"
    pipeline_steps ||--o{ engagement_step_states : "instantiated as"
    attendance_days ||--o{ attendance_entries : "lists"
    participants ||--o{ attendance_entries : "marked in"
    participants ||--o{ evaluation_responses : "submits"
    participants |o--o| certificates : "awarded"
    attendance_entries |o--o| signatures : "signed with"
    templates ||--o{ template_sections : "structured as"
    templates ||--o{ proposals : "rendered from"
    templates ||--o{ tnas : "questionnaire for"
    templates ||--o{ outbound_messages : "rendered from"
    templates ||--o{ collection_rules : "renders"
    templates ||--o{ certificates : "renders"
    message_rates ||--o{ outbound_messages : "prices"
    follow_ups ||--o{ outbound_messages : "sends"

    %% ---------- Compliance relationships ----------
    hrdc_packets ||--o{ hrdc_packet_documents : "requires"
    hrdc_document_types ||--o{ hrdc_packet_documents : "types"
    attachments ||--o{ hrdc_packet_documents : "stores"
    attachments ||--o{ certificates : "stores"
    attachments ||--o{ knowledge_sources : "stores"
    attachments ||--o{ hrdc_levy_statements : "stores"
    attachments ||--o| signatures : "stores"
    rule_set_versions ||--o{ compliance_rules : "versions"
    rule_set_versions ||--o{ engagements : "pinned at grant"
    rule_set_versions ||--o{ hrdc_packets : "pinned at claim"
    rule_set_versions ||--o{ compliance_check_results : "applied by"
    compliance_rules |o--o| compliance_rules : "supersedes"
    compliance_rules ||--o{ compliance_check_results : "evaluated by"
    compliance_rules ||--o{ rule_changes : "targeted by"
    check_keys ||--o{ compliance_check_results : "keys"
    compliance_check_results ||--o{ compliance_version_drifts : "warns via"
    knowledge_sources ||--o{ knowledge_chunks : "chunked into"
    knowledge_sources ||--o{ compliance_rules : "cited by"
    knowledge_sources |o--o| rule_change_sets : "proposes"
    rule_change_sets ||--o{ rule_changes : "contains"
    rule_changes ||--o{ rule_change_affected_engagements : "affects"

    %% ---------- Finance relationships ----------
    invoices ||--o{ invoice_lines : "itemised by"
    invoices ||--o{ invoice_sync_entries : "synced via"
    invoices ||--o{ payments : "settled by"
    invoices |o--o| collections_cases : "chased by"
    invoices ||--o{ follow_ups : "prompts"
    invoices ||--o{ outbound_messages : "reminded by"
    quotations |o--o| invoices : "billed as"

    %% ---------- AI-ops relationships ----------
    agents ||--o{ agent_autonomy : "granted"
    agents ||--o{ runs : "executes"
    agents ||--o{ eval_runs : "scored by"
    eval_sets ||--o{ eval_runs : "measured against"
    runs ||--o{ run_steps : "traced as"
    runs ||--o{ run_nodes : "traced as"
    runs ||--o{ run_events : "emits"
    runs ||--o{ run_guardrails : "bound by"
    runs ||--o{ run_checkpoints : "resumable at"
    runs |o--o| run_state_cards : "summarised by"
    runs |o--o{ runs : "replays"
    runs ||--o{ ai_usage_entries : "bills"
    runs ||--o{ provenance__ext : "justifies"
    runs ||--o{ proposals : "drafts"
    runs |o--o{ rule_change_sets : "extracts"
    run_nodes |o--o{ run_nodes : "parents"
    run_events ||--o{ jury_votes : "records"
    run_steps |o--o| approval_requests__ext : "halted by"
    ai_tiers ||--o{ ai_routing_entries : "routes"
    ai_tiers ||--o{ run_nodes : "serves"
    ai_tiers ||--o{ runs : "serves"
    ai_tiers ||--o{ ai_provider_key_tiers : "keyed by"
    ai_tiers ||--o{ jury_votes : "votes as"
    ai_tiers ||--o{ ai_usage_entries : "bills"
    ai_tiers ||--o| agents : "defaults for"
    ai_provider_keys ||--o{ ai_provider_key_tiers : "scoped to"

    %% ---------- Cross-cutting ----------
    action_types ||--o{ agent_autonomy : "keys"
    action_types ||--o{ ai_routing_entries : "keys"
    action_types ||--o{ action_requests__ext : "keys"
    action_types ||--o{ hours_saved_baselines : "keys"
    action_types ||--o{ eval_runs : "keys"
    action_types ||--o{ ai_usage_entries : "keys"
    hours_saved_baseline_tables ||--o{ hours_saved_baselines : "versions"
    policies__ext ||--o{ action_requests__ext : "gates"
    policies__ext ||--o{ approval_requests__ext : "raises"
    action_requests__ext |o--o{ ai_budgets : "raises cap for"
    action_requests__ext |o--o{ quotations : "approves discount on"
    action_requests__ext |o--o| approval_requests__ext : "queues"
    ref_formats ||--o{ ref_sequences : "formats"
    %% provenance is keyed (subject_table, subject_id, field) and points AT the
    %% subject, so it carries no drawable FK to any of the nine tables it attests.
    %% See 04-money-versioning-provenance.md C-1.
    tenants__ext ||--o{ organisations : "scopes everything"
```

Five tables appear with no edges, which is correct rather than an omission: `saved_views` and
`metric_definitions` reference only `auth.users` and nothing else; `audit_entries__ext` belongs to sb-events and
references every record polymorphically, so drawing it would connect it to every table in the model.

---

## 3 · Tables

The eight universal columns from "Conventions" are omitted from every table below. `→` means
`REFERENCES`. On-delete behaviour is stated per FK; the default across this model is `RESTRICT`, because
the contract has no entity whose disappearance should silently remove another, and because HRD Corp and
tax retention make cascading deletes an audit liability.

### 3.1 Sales

#### `organisations` — §5, M04-S02

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `name` | `text` | no | — | |
| `industry` | `text` | yes | — | Open set (`MANUFACTURING`); not in §12. Reference table deferred, see Q14 |
| `location` | `text` | yes | — | |
| `owner_id` | `uuid` | no | — | → `auth.users` `ON DELETE RESTRICT` |
| `status` | `organisation_status` | no | `'PROSPECT'` | `PROSPECT·ACTIVE_CLIENT·DORMANT` — absent from §12, defined by the contract package |
| `hrdc_registered` | `boolean` | no | `false` | |
| `hrdc_employer_code` | `text` | yes | — | `HRDC-2201-8834` |
| `health_score` | `smallint` | yes | — | Latest value from `organisation_health_snapshots`, denormalised for the header |
| `archived_at` | `timestamptz` | yes | — | Soft archive, see §5 |

- **Unique:** `(tenant_id, hrdc_employer_code) WHERE hrdc_employer_code IS NOT NULL`.
- **Indexes:** `(tenant_id, owner_id)`; `(tenant_id, status)`; GIN trigram on `(tenant_id, name)` for ⌘K search (§2).
- **Checks:** `health_score BETWEEN 0 AND 100`; `hrdc_registered = false OR hrdc_employer_code IS NOT NULL`.
- **Not stored:** `metrics.lifetimeValue`, `openPipeline`, `arOverdue`, `hrdcLevyAvailable` and every `drillTo`. They are a view (`v_organisation_metrics`) plus `metric_definitions` rows. Storing them would give the header a second source of truth against the invoice and opportunity tables.

#### `organisation_health_snapshots` — §5 `GET /organisations/{id}/health`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `organisation_id` | `uuid` | no | — | → `organisations` `ON DELETE CASCADE` |
| `score` | `smallint` | no | — | 0–100 |
| `components` | `jsonb` | no | `'{}'` | Contributing factors, shape owned by the scoring model |
| `computed_at` | `timestamptz` | no | `now()` | |
| `model_version` | `text` | no | — | |

No `ref`. **Index:** `(tenant_id, organisation_id, computed_at DESC)`. Append-only.

#### `contacts` — §5

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `organisation_id` | `uuid` | no | — | → `organisations` `ON DELETE RESTRICT` |
| `name` | `text` | no | — | |
| `job_title` | `text` | yes | — | `role` in the contract; renamed to avoid colliding with `app_role` |
| `email` | `citext` | yes | — | |
| `phone` | `text` | yes | — | E.164 |
| `is_primary` | `boolean` | no | `false` | |
| `pdpa_flag` | `text` | yes | — | `NO_CONSENT`; derived from `contact_consents`, cached for the relations panel |
| `redacted_at` | `timestamptz` | yes | — | PDPA erasure, see §5 |

- **Unique:** one primary per organisation — `(tenant_id, organisation_id) WHERE is_primary` as a partial unique index; `(tenant_id, organisation_id, lower(email)) WHERE email IS NOT NULL AND redacted_at IS NULL`.
- **Indexes:** `(tenant_id, organisation_id)`; GIN trigram on `name`.
- **Checks:** `email IS NOT NULL OR phone IS NOT NULL`.

#### `contact_consents` — §4, §5, `GET /contacts/{id}/consent`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `contact_id` | `uuid` | no | — | → `contacts` `ON DELETE CASCADE` |
| `channel` | `enquiry_channel` | no | — | Reuses the channel enum: `EMAIL·WHATSAPP·WEB_FORM·PHONE` |
| `granted` | `boolean` | no | — | |
| `recorded_at` | `timestamptz` | no | — | |
| `source` | `text` | yes | — | How consent was captured |
| `withdrawn_at` | `timestamptz` | yes | — | |

No `ref`. **Unique:** `(tenant_id, contact_id, channel, recorded_at)` — the table is an append-only consent ledger, not a mutable flag, because PDPA requires the history. Current state is a view (`v_contact_consent_current`).

#### `enquiries` — §4, M03-S01/S02

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `channel` | `enquiry_channel` | no | — | |
| `status` | `enquiry_status` | no | `'OPEN'` | `OPEN·ASSIGNED·CONVERTED·ARCHIVED·NOT_AN_ENQUIRY` |
| `received_at` | `timestamptz` | no | — | |
| `from_name` | `text` | yes | — | Unstructured on arrival; not a FK until matched |
| `from_email` | `citext` | yes | — | |
| `from_phone` | `text` | yes | — | |
| `subject` | `text` | yes | — | |
| `preview` | `text` | yes | — | First 160 chars, stored so the inbox does not read `body` |
| `body` | `text` | yes | — | |
| `classification_label` | `text` | yes | — | `LEADERSHIP`; open set |
| `classification_confidence` | `numeric(4,3)` | yes | — | |
| `needs_human_review` | `boolean` | no | `false` | True below threshold; blocks auto-archive (§4) |
| `estimated_value_sen` | `bigint` | yes | — | |
| `currency` | `char(3)` | no | `'MYR'` | |
| `matched_organisation_id` | `uuid` | yes | — | → `organisations` `ON DELETE SET NULL` |
| `matched_contact_id` | `uuid` | yes | — | → `contacts` `ON DELETE SET NULL` |
| `match_reason` | `organisation_match_reason` | yes | — | `EXACT_DOMAIN·FUZZY_NAME·MANUAL` |
| `assigned_to_user_id` | `uuid` | yes | — | → `auth.users` `ON DELETE SET NULL` |
| `external_message_id` | `text` | yes | — | `Message-ID` / WhatsApp `messages[0].id`, §11 dedupe |

- **Unique:** `(tenant_id, channel, external_message_id) WHERE external_message_id IS NOT NULL`. This is the storage-level half of webhook idempotency; **sb-events** owns `webhook_receipts`.
- **Indexes:** `(tenant_id, status, received_at DESC)`; `(tenant_id, channel)`; `(tenant_id, matched_organisation_id)`; `(tenant_id, assigned_to_user_id) WHERE status <> 'CONVERTED'`; GIN trigram on `subject`.
- **Checks:** `needs_human_review = false OR status <> 'ARCHIVED'` — the contract says low-confidence items are never auto-archived; the schema says they are never archived while the flag stands.

#### `enquiry_extraction_fields` — §4 `PATCH /enquiries/{id}/extraction`

One row per extracted field, because each carries its own provenance and its own edit history.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `enquiry_id` | `uuid` | no | — | → `enquiries` `ON DELETE CASCADE` |
| `field_key` | `text` | no | — | `topic·audience·timing·budget`; open set |
| `value` | `text` | yes | — | Null is meaningful (`budget: null` at 0.97 confidence) |

No `ref`. **Unique:** `(tenant_id, enquiry_id, field_key)`. A `PATCH` flips the row's provenance to
`AI_SUGGESTED` with `editedBy` — that is a new `provenance` row, not an update, so the original extraction
survives for the audit drawer.

#### `opportunities` — §5

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `organisation_id` | `uuid` | no | — | → `organisations` `ON DELETE RESTRICT` |
| `primary_contact_id` | `uuid` | yes | — | → `contacts` `ON DELETE SET NULL` |
| `source_enquiry_id` | `uuid` | yes | — | → `enquiries` `ON DELETE SET NULL` |
| `owner_id` | `uuid` | no | — | → `auth.users` |
| `stage` | `opportunity_stage` | no | `'NEW'` | `NEW·QUALIFYING·TNA_SENT·PROPOSAL_SENT·NEGOTIATION·WON·LOST` |
| `value_sen` | `bigint` | yes | — | |
| `currency` | `char(3)` | no | `'MYR'` | |
| `probability` | `numeric(4,3)` | yes | — | REPORT.md `probability` |
| `stage_changed_at` | `timestamptz` | no | `now()` | |
| `lost_reason` | `text` | yes | — | |

- **Unique:** `(tenant_id, source_enquiry_id) WHERE source_enquiry_id IS NOT NULL` — one enquiry converts once.
- **Indexes:** `(tenant_id, stage, updated_at DESC)`; `(tenant_id, organisation_id)`; `(tenant_id, owner_id, stage)`.
- **Checks:** `stage <> 'LOST' OR lost_reason IS NOT NULL`.

#### `organisation_suggestions` — §5 cross-sell panel

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `organisation_id` | `uuid` | no | — | → `organisations` `ON DELETE CASCADE` |
| `suggestion_type` | `text` | no | — | `CROSS_SELL`; open set |
| `programme_id` | `uuid` | yes | — | → `programmes` `ON DELETE CASCADE` |
| `title` | `text` | no | — | |
| `rationale` | `text` | no | — | |
| `status` | `text` | no | `'OPEN'` | `OPEN·ACTED·DISMISSED` |
| `dismissed_at` | `timestamptz` | yes | — | |
| `dismissed_by_user_id` | `uuid` | yes | — | |

No `ref`. **Index:** `(tenant_id, organisation_id) WHERE status = 'OPEN'`.

#### `follow_ups` — §4, M03-S06

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `organisation_id` | `uuid` | no | — | → `organisations` `ON DELETE CASCADE` |
| `contact_id` | `uuid` | no | — | → `contacts` `ON DELETE RESTRICT` |
| `proposal_id` | `uuid` | yes | — | → `proposals` `ON DELETE CASCADE` |
| `invoice_id` | `uuid` | yes | — | → `invoices` `ON DELETE CASCADE` — collections reuse the same queue shape |
| `reason` | `text` | no | — | |
| `due_date` | `date` | no | — | |
| `status` | `follow_up_status` | no | `'DUE'` | `DUE·OVERDUE·SENT·DISMISSED` |
| `autonomy` | `autonomy_level` | no | `'SUGGEST'` | Snapshot of the grant at creation, so the queue explains itself |
| `owner_id` | `uuid` | no | — | |

- **Indexes:** `(tenant_id, owner_id, due_date) WHERE status = 'DUE'`; `(tenant_id, proposal_id)`.
- **Checks:** exactly one target — `num_nonnulls(proposal_id, invoice_id) <= 1`.

#### `tnas` — §6, M05-S02

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `opportunity_id` | `uuid` | no | — | → `opportunities` `ON DELETE CASCADE` |
| `questionnaire_template_id` | `uuid` | yes | — | → `templates` `ON DELETE RESTRICT` |
| `status` | `tna_status` | no | `'DRAFT'` | `DRAFT·SENT·COMPLETE·REOPENED` |
| `sent_at` | `timestamptz` | yes | — | |
| `completed_at` | `timestamptz` | yes | — | |
| `completed_by_kind` | `actor_kind` | yes | — | `CLIENT` in the demo |
| `completed_by_id` | `text` | yes | — | |
| `completed_by_name` | `text` | yes | — | |
| `audience_headcount` | `integer` | yes | — | |
| `audience_level` | `text` | yes | — | `LINE_MANAGER`; open set |
| `audience_sites` | `text[]` | yes | — | Display-only list, never filtered on |
| `audience_language` | `char(2)` | yes | — | |
| `budget_sen` | `bigint` | yes | — | Null is meaningful |
| `currency` | `char(3)` | no | `'MYR'` | |
| `reopened_at` | `timestamptz` | yes | — | `POST /tnas/{id}/reopen` |

- **Unique:** `(tenant_id, opportunity_id)` — one TNA per opportunity in the contract's flow.
- **Checks:** `status <> 'COMPLETE' OR completed_at IS NOT NULL`.

#### `tna_constraints`, `tna_gaps`, `tna_evidence`, `tna_recommendations` — §6

All four: `tna_id uuid NOT NULL → tna ON DELETE CASCADE`, no `ref`.

`tna_constraints`: `code text` (open set: `DELIVERY_WINDOW·MAX_DAYS_OFF_FLOOR·HRDC_CLAIMABLE_REQUIRED`),
`label text`, `severity severity NULL`. **Unique** `(tenant_id, tna_id, code)`.

`tna_gaps`: `name text`, `description text`, `priority gap_priority` (`HIGH·MEDIUM·LOW`),
`evidence_refs text[]` (`["Q4","Q7"]` — questionnaire question ids, not entity refs),
**Index** `(tenant_id, tna_id, priority)`.

`tna_evidence`: `source_type evidence_type`, `source_ref text`, `excerpt text`. The contract package
already unifies this: one `EvidenceType` enum and one `EvidenceRef` shape serve `provenance.sources[]`,
action `evidence[]` and TNA evidence alike. So `evidence_type` is a single native enum here, and the
open question is only which lane owns the table — see Deviation 11.

`tna_recommendations`: `programme_id uuid → programme ON DELETE CASCADE`, `fit_score numeric(4,3)`,
`rationale text`, `price_indication_sen bigint`, `currency char(3)`, `rank smallint`,
`scoring_model_version text` (`fit-v3`), `scoring_weights jsonb`,
`accepted_at timestamptz`. **Unique** `(tenant_id, tna_id, programme_id)`.
**Index** `(tenant_id, tna_id, fit_score DESC)`.

#### `proposals` — §6, M07-S02

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `opportunity_id` | `uuid` | no | — | → `opportunities` `ON DELETE RESTRICT` |
| `organisation_id` | `uuid` | no | — | → `organisations` `ON DELETE RESTRICT`. Denormalised from the opportunity so sb-actions' `firstProposalToOrg` probe is one index hit and not a join |
| `template_id` | `uuid` | no | — | → `templates` `ON DELETE RESTRICT` |
| `programme_id` | `uuid` | yes | — | → `programmes` `ON DELETE RESTRICT` |
| `run_id` | `uuid` | yes | — | → `runs` `ON DELETE SET NULL` |
| `status` | `proposal_status` | no | `'DRAFT'` | `DRAFT·AWAITING_APPROVAL·SENT·VIEWED·ACCEPTED·LOST` |
| `value_sen` | `bigint` | yes | — | Mirrors the accepted quotation's sell price |
| `currency` | `char(3)` | no | `'MYR'` | |
| `margin_rate` | `numeric(6,4)` | yes | — | |
| `sent_at` | `timestamptz` | yes | — | |
| `first_viewed_at` | `timestamptz` | yes | — | Drives the follow-up reason "not opened since 13 Sep" |
| `accepted_at` | `timestamptz` | yes | — | |
| `lost_at` | `timestamptz` | yes | — | |

- **Indexes:** `(tenant_id, opportunity_id)`; `(tenant_id, status, updated_at DESC)`; and for the policy gate, `proposals_org_sent` on `(tenant_id, organisation_id) WHERE status IN ('SENT','VIEWED','ACCEPTED','LOST')`.
- **Checks:** `status <> 'SENT' OR sent_at IS NOT NULL`.
- **Immutability:** once `status = 'SENT'`, `template_id`, `value_sen` and every `proposal_sections.body` freeze. See §4.

#### `proposal_sections` — §6

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `proposal_id` | `uuid` | no | — | → `proposals` `ON DELETE CASCADE` |
| `n` | `smallint` | no | — | Section number from the template |
| `title` | `text` | no | — | |
| `body` | `text` | yes | — | |
| `merge_fields_used` | `text[]` | yes | — | |
| `needs_review` | `boolean` | no | `false` | |

No `ref`. **Unique:** `(tenant_id, proposal_id, n)`.
`warnings[]` in the response is **not a table** — `LOW_CONFIDENCE_SECTION` is a view over
`provenance.confidence < threshold`, so a warning can never disagree with the confidence that produced it.

#### `public_share_tokens` — §11, M07-S07

One table for both the client proposal page and the TNA questionnaire link, matching the name
sb-tenancy's RLS already targets.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `target_kind` | `text` | no | — | `PROPOSAL·TNA` |
| `proposal_id` | `uuid` | yes | — | → `proposals` `ON DELETE CASCADE` |
| `tna_id` | `uuid` | yes | — | → `tnas` `ON DELETE CASCADE` |
| `token_hash` | `bytea` | no | — | SHA-256 of the token. The token itself is **never stored** |
| `issued_at` | `timestamptz` | no | `now()` | |
| `expires_at` | `timestamptz` | no | — | Default `issued_at + interval '30 days'` (§16.6, assumed) |
| `revoked_at` | `timestamptz` | yes | — | |
| `last_accessed_at` | `timestamptz` | yes | — | |
| `access_count` | `integer` | no | `0` | |

No `ref`. **Unique:** `(token_hash)` globally, not per tenant — the token is the only thing the
unauthenticated caller presents, so it must resolve the tenant, not assume it.
**Index:** `(tenant_id, proposal_id) WHERE revoked_at IS NULL`.
**Check:** `num_nonnulls(proposal_id, tna_id) = 1` and the non-null one agrees with `target_kind`.

#### `portal_comments`, `portal_acceptances` — §11

`portal_comments`: `proposal_id`, `contact_id uuid NULL`, `author_name text NOT NULL`,
`author_kind actor_kind NOT NULL`, `body text NOT NULL`, `posted_at timestamptz NOT NULL`.
`author_name` is frozen at write time even when `contact_id` is set, because the client page is a legal
record of what the client saw. No `ref`.

`portal_acceptances`: `proposal_id` **unique** per tenant, `accepted_by_name text`, `accepted_by_role text`,
`accepted_at timestamptz`, `signature_id uuid → signature`, `engagement_id uuid → engagement ON DELETE SET NULL`,
`share_token_id uuid → public_share_tokens`. One row per proposal enforces §11's "a second accept returns
the original acceptance" at the storage layer, not in application code.

#### `quotations` — §6, M07-S03

This lane owns the table; **sb-money owns every money column on it**, and the list below is theirs
verbatim from `04-money-versioning-provenance.md` C-4. The `app.quotation` DDL in that document is a
verification harness, not a competing table.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `proposal_id` | `uuid` | no | — | → `proposals` `ON DELETE RESTRICT` |
| `supersedes_quotation_id` | `uuid` | yes | — | → `quotations` `ON DELETE SET NULL` |
| `version` | `smallint` | no | `1` | |
| `rate_card_id` | `uuid` | no | — | → `rate_card(id)`. **sb-money, C-3.** The API's `rateCardVersion` string is a join, and `rate_card.version` is frozen by a `PT409` trigger so the label cannot drift under a priced quotation |
| `sell_price_sen` | `bigint` | no | — | Sum of rounded `quotation_lines.total_sen` |
| `direct_cost_sen` | `bigint` | no | — | |
| `currency` | `char(3)` | no | `'MYR'` | |
| `floor_margin_rate` | `numeric(6,4)` | yes | — | The margin floor applied, from the rate card |
| `commission_rate` | `numeric(6,4)` | yes | — | |
| `commission_payable_on` | `text` | yes | — | `COLLECTION·INVOICE` |
| `discount_approval_id` | `uuid` | yes | — | → `action_requests` (sb-actions); set by `DISCOUNT_APPROVE` |
| `invoice_id` | `uuid` | yes | — | → `invoices` `ON DELETE SET NULL`. **sb-money puts the edge on this side**, so `invoices.quotation_id` is removed |
| `status` | `text` | no | `'DRAFT'` | `DRAFT·APPLIED·SUPERSEDED` |

Generated columns, all sb-money's: `margin_sen`, `margin_rate`, `programme_floor_price_sen`,
`margin_floor_price_sen`, `floor_price_sen`, `binding_floor_basis`, `below_floor`, `commission_sen`,
`display_per_pax_sen`. Plus their `floor_price_needs_approval` constraint and
`CHECK (currency = 'MYR')`.

`binding_floor_basis` is restored per ruling R-PROV, and as a **generated** column rather than an enum this
lane maintains. That is the better answer to what the lead asked for: deriving it in the database means the
costing screen and the approval screen cannot compute it differently. There is no stored `floor_price_sen`
either; both floors and the binding one are generated, which is safe because `floor_margin_rate` and
`programme_floor_price_sen` are stamped onto the quotation at pricing time, so the floor is reproducible
from the row alone after the rate card is retired.

- **Unique:** `(tenant_id, proposal_id, version)`; `(tenant_id, proposal_id) WHERE status = 'APPLIED'`.
- **Two independent floors.** `programme_floor_price_sen` is the absolute floor snapshotted from the
  pricing tier, commercial policy and not derivable from cost. `margin_floor_price_sen` is computed from
  actual cost. `floor_price_sen` is the greater of the two and is what binds. sb-actions compares
  `sell_price_sen` against `floor_price_sen` and computes nothing.
- **Immutability:** an `APPLIED` quotation is frozen entirely; a change writes a new `version` row and sets
  the old one `SUPERSEDED`. See §4. This is what makes `rate_card_id` safe to keep as a live FK: the row
  that points at the card cannot be repriced after the fact.
- `perParticipant` (§15.3) is a **generated display column**, `display_per_pax_sen`, and never a line
  (§18/S3). sb-money's generated column replaces the bare prohibition this document carried before.

#### `quotation_lines` — §6

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `quotation_id` | `uuid` | no | — | → `quotations` `ON DELETE CASCADE` |
| `n` | `smallint` | no | — | Line order |
| `item` | `text` | no | — | `TRAINER_FEE·VENUE·MATERIALS·TRAVEL·MEALS`; open set, rate-card driven |
| `detail` | `text` | yes | — | |
| `qty` | `numeric(10,2)` | no | — | `0` for a zero-cost venue line |
| `unit` | `text` | yes | — | `DAY·PAX·TRIP` |
| `rate_sen` | `bigint` | yes | — | |
| `total_sen` | `bigint` | no | — | `round_half_up(rate_sen * qty)`, §18/S3 |
| `currency` | `char(3)` | no | `'MYR'` | |
| `is_cost` | `boolean` | no | `true` | Cost line versus sell line |

No `ref`. **Unique:** `(tenant_id, quotation_id, n)`.
**Trigger:** `AFTER INSERT OR UPDATE OR DELETE` recomputes and asserts
`quotations.sell_price_sen = Σ rounded sell lines` and `direct_cost_sen = Σ rounded cost lines`.

### 3.2 Delivery

#### `programmes` — §6, M06-S02

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `name` | `text` | no | — | |
| `category` | `text` | no | — | `LEADERSHIP`; open set |
| `days` | `smallint` | no | — | |
| `version` | `smallint` | no | `1` | |
| `status` | `text` | no | `'DRAFT'` | `DRAFT·ACTIVE·RETIRED` |
| `hrdc_scheme` | `hrdc_scheme` | yes | — | `SBL_KHAS·SBL·HRDC_PLACEMENT` |
| `hrdc_claimable` | `boolean` | no | `false` | |
| `list_price_sen` | `bigint` | no | — | |
| `list_price_pax` | `smallint` | no | — | The pax count the list price is quoted at |
| `floor_price_sen` | `bigint` | no | — | |
| `floor_margin_rate` | `numeric(6,4)` | no | — | |
| `currency` | `char(3)` | no | `'MYR'` | |
| `outcomes` | `text[]` | no | `'{}'` | Ordered prose, never filtered |
| `deliveries_count` | `integer` | no | `0` | `stats.deliveries`, maintained by trigger |
| `average_evaluation` | `numeric(3,2)` | yes | — | `stats.averageEvaluation`, maintained by trigger |
| `archived_at` | `timestamptz` | yes | — | |

- **Indexes:** `(tenant_id, status, category)`; GIN trigram on `name`.
- **Checks:** `floor_price_sen <= list_price_sen`; `days > 0`.
- **Immutability:** none. `PUT /programmes/{id}` is ADMIN + L&D. A price change does **not** reprice existing quotations, because each quotation snapshots `programme_floor_price_sen` and pins `rate_card_id`.

#### `programme_modules`, `programme_pricing_tiers`, `programme_materials` — §6

All: `programme_id uuid NOT NULL → programme ON DELETE CASCADE`, no `ref`.

`programme_modules`: `n smallint`, `title text`, `format text` (`FACILITATED·SELF_PACED·COACHING`),
`duration_minutes integer`. **Unique** `(tenant_id, programme_id, n)`.

`programme_pricing_tiers`: `max_pax smallint`, `price_sen bigint`, `floor_price_sen bigint`,
`currency char(3)`. **Unique** `(tenant_id, programme_id, max_pax)`. **Check** `max_pax > 0` and
`floor_price_sen <= price_sen`.

`floor_price_sen` is an **absolute** floor, set by commercial policy per tier. It is not derivable from
cost and it is not a margin. The §6 fixture's RM 13,900 floor against an RM 18,500 sell price is this
number: a margin floor of 0.35 on RM 11,400 of cost would be RM 17,538, which is not what the screen
shows. sb-money owns the arithmetic; this column is where the absolute figure lives. Tiers are read in ascending
`max_pax`; the first tier whose `max_pax >= headcount` wins, and a headcount above the largest tier is a
quote, not a lookup.

`programme_materials`: `material_type text` (`WORKBOOK·SLIDES·ASSESSMENT`), `version smallint`,
`languages char(2)[]`, `attachment_id uuid → attachment ON DELETE SET NULL`.

#### `trainers` — §6, M06-S02

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `name` | `text` | no | — | |
| `email` | `citext` | yes | — | |
| `phone` | `text` | yes | — | |
| `user_id` | `uuid` | yes | — | → `auth.users` `ON DELETE SET NULL`; set when a trainer logs in (role `TRAINER`) |
| `band` | `trainer_band` | yes | — | `A·B·C` (DECISIONS §5); the rates themselves live in **sb-money**'s rate card |
| `day_rate_override_sen` | `bigint` | yes | — | Per-trainer override; the value, not the schedule, is sb-money's |
| `ttt_certified` | `boolean` | no | `false` | |
| `ttt_ref` | `text` | yes | — | `TTT-2019-4471` |
| `ttt_valid_to` | `date` | yes | — | Drives the packet document "Valid to 30 Jun 2027" |
| `hrd_tdf` | `boolean` | no | `false` | HRD Corp accreditation at grant application (DECISIONS §3) |
| `rating` | `numeric(3,2)` | yes | — | |
| `status` | `text` | no | `'ACTIVE'` | `ACTIVE·INACTIVE` |

- **Checks:** `ttt_certified = false OR ttt_ref IS NOT NULL`.
- **Index:** `(tenant_id, status) WHERE ttt_certified`.

#### `programme_trainers` — §6 trainer pool

`programme_id`, `trainer_id`, both `ON DELETE CASCADE`; `certified_at date`, `rating_override numeric(3,2)`.
No `ref`. **Unique** `(tenant_id, programme_id, trainer_id)`.

#### `trainer_availability` — §6 `trainerAvailability[]`

`trainer_id` `ON DELETE CASCADE`; `on_date date NOT NULL`; `state text NOT NULL` (`AVAILABLE·BLOCKED·BOOKED`);
`note text`. No `ref`. **Unique** `(tenant_id, trainer_id, on_date)`.
**Index** `(tenant_id, on_date, state)`. Availability is a declared calendar; `BOOKED` days are written by
the `trainer_bookings` trigger, so the two never disagree.

#### `trainer_bookings` — DECISIONS §1 (soft-hold 72h, confirmed booking)

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `trainer_id` | `uuid` | no | — | → `trainers` `ON DELETE RESTRICT` |
| `engagement_id` | `uuid` | no | — | → `engagements` `ON DELETE CASCADE` |
| `state` | `booking_state` | no | `'SOFT_HOLD'` | `SOFT_HOLD·CONFIRMED·RELEASED·CANCELLED` |
| `starts_on` | `date` | no | — | |
| `ends_on` | `date` | no | — | |
| `hold_expires_at` | `timestamptz` | yes | — | 72 hours for a soft hold |
| `day_rate_sen` | `bigint` | yes | — | Confirmed rate; frozen once `CONFIRMED` |
| `currency` | `char(3)` | no | `'MYR'` | |

- **Checks:** `ends_on >= starts_on`; `state <> 'SOFT_HOLD' OR hold_expires_at IS NOT NULL`.
- **Exclusion constraint:** `EXCLUDE USING gist (tenant_id WITH =, trainer_id WITH =, daterange(starts_on, ends_on, '[]') WITH &&) WHERE (state IN ('SOFT_HOLD','CONFIRMED'))` — double-booking a trainer is unrepresentable, which is the only honest place to enforce "Farah Aziz available 12–13 Nov".
- Soft-hold autonomy is `AUTONOMOUS`, confirmation is `ACT_WITH_APPROVAL` (DECISIONS §1); the schema does not encode that, `agent_autonomy` does.

#### `engagements` — §8, M09-S02

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `organisation_id` | `uuid` | no | — | → `organisations` `ON DELETE RESTRICT` |
| `opportunity_id` | `uuid` | yes | — | → `opportunities` `ON DELETE SET NULL` |
| `proposal_id` | `uuid` | yes | — | → `proposals` `ON DELETE SET NULL` |
| `programme_id` | `uuid` | no | — | → `programmes` `ON DELETE RESTRICT` |
| `owner_id` | `uuid` | no | — | → `auth.users` |
| `pipeline_id` | `uuid` | no | — | → `pipelines` `ON DELETE RESTRICT` — the stepper's configuration |
| `title` | `text` | no | — | |
| `status` | `engagement_status` | no | `'PROPOSED'` | `PROPOSED·CONFIRMED·SCHEDULED·IN_DELIVERY·DELIVERED·CLOSED·CANCELLED` |
| `venue` | `text` | yes | — | |
| `venue_mode` | `venue_mode` | yes | — | `CLIENT_SITE·OWN_VENUE·EXTERNAL` (DECISIONS §5) |
| `value_sen` | `bigint` | yes | — | |
| `currency` | `char(3)` | no | `'MYR'` | |
| `grant_rule_set_version_id` | `uuid` | yes | — | → `rule_set_versions` `ON DELETE RESTRICT`. **Pinned at grant submission** (§18/S1) |
| `grant_pinned_at` | `timestamptz` | yes | — | |
| `starts_on` | `date` | yes | — | Earliest session date, maintained by trigger, never written by hand |
| `ends_on` | `date` | yes | — | Latest session date, same trigger |
| `closed_out_at` | `timestamptz` | yes | — | |

- **Indexes:** `(tenant_id, status, updated_at DESC)`; `(tenant_id, organisation_id)`; `(tenant_id, programme_id)`; `(tenant_id, owner_id)`.
- **`dates[]` is not an array column.** `starts_on` and `ends_on` are maintained by an `AFTER INSERT OR UPDATE OR DELETE` trigger on `sessions`, so they are a cache with exactly one writer rather than a second source of truth. They exist because sb-actions' `deadlineWithinDays` flag needs an indexable date on the engagement, and a `min()` over sessions on every policy evaluation is the wrong cost. **Index:** `(tenant_id, starts_on)`.
- **Immutability:** once `grant_rule_set_version_id` is set, that column and `grant_pinned_at` are frozen (§4 rule I3). Once `status = 'CLOSED'`, the whole row is frozen except `updated_at`.

#### `engagement_step_states` — §5/§8 lifecycle, driven by `pipeline_steps`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `engagement_id` | `uuid` | no | — | → `engagements` `ON DELETE CASCADE` |
| `pipeline_step_id` | `uuid` | no | — | → `pipeline_steps` `ON DELETE RESTRICT` |
| `state` | `lifecycle_state` | no | `'PENDING'` | `DONE·CURRENT·PENDING·BLOCKED·SKIPPED·FAILED` |
| `occurred_at` | `timestamptz` | yes | — | The `at` the stepper renders |
| `note` | `text` | yes | — | `"2 documents missing"` |
| `target_ref` | `text` | yes | — | `INV-2026-0311` on the INVOICED step |

No `ref`. **Unique:** `(tenant_id, engagement_id, pipeline_step_id)`;
`(tenant_id, engagement_id) WHERE state = 'CURRENT'` — at most one current step.
**The step key and its order are never stored here**; they come from `pipeline_steps`, satisfying the
project rule that stage names and order render from pipeline configuration.
`HRDC_CLAIM.state = 'BLOCKED'` is written by the compliance check evaluator when any check `FAIL`s
(§17) — the stepper renders it, it does not compute it.

#### `engagement_checklist_items` — §8

`engagement_id` `ON DELETE CASCADE`; `item_key text`; `label text`; `done boolean NOT NULL DEFAULT false`;
`done_at timestamptz`; `done_by_user_id uuid`. No `ref`. **Unique** `(tenant_id, engagement_id, item_key)`.

#### `sessions` — §8

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `engagement_id` | `uuid` | no | — | → `engagements` `ON DELETE CASCADE` |
| `trainer_id` | `uuid` | yes | — | → `trainers` `ON DELETE RESTRICT` |
| `day` | `smallint` | no | — | 1-based |
| `on_date` | `date` | no | — | |
| `title` | `text` | yes | — | |
| `venue` | `text` | yes | — | Room, distinct from the engagement venue |
| `starts_at` | `timestamptz` | yes | — | |
| `ends_at` | `timestamptz` | yes | — | |

- **Unique:** `(tenant_id, engagement_id, day, on_date, title)`. A day may hold more than one session.
- **Index:** `(tenant_id, on_date)`; `(tenant_id, trainer_id, on_date)`.

#### `engagement_trainers` — sb-tenancy's RLS target

The join sb-tenancy's trainer-scoped policies read: a trainer sees an engagement if and only if a row here
links them to it. `sessions.trainer_id` and `trainer_bookings` both imply the link, but a policy cannot
afford to union two tables on every row check.

`engagement_id` `ON DELETE CASCADE`, `trainer_id` `ON DELETE RESTRICT`,
`role text` (`LEAD·CO_FACILITATOR·OBSERVER`), `assigned_at timestamptz`. No `ref`.
**Unique** `(tenant_id, engagement_id, trainer_id)`.
**Index** `(tenant_id, trainer_id)` — the direction the policy reads.
Maintained by trigger from `trainer_bookings` reaching `CONFIRMED` and from `sessions.trainer_id`, so it is
a projection with one writer, never hand-maintained.

#### `participants` — §8, M10

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `engagement_id` | `uuid` | no | — | → `engagements` `ON DELETE CASCADE` |
| `contact_id` | `uuid` | yes | — | → `contacts` `ON DELETE SET NULL` — most participants are not contacts |
| `name` | `text` | no | — | |
| `department` | `text` | yes | — | |
| `email` | `citext` | yes | — | |
| `identity_no_hash` | `bytea` | yes | — | HRD Corp needs an identity number; store a hash plus last four, never the number |
| `identity_no_last4` | `char(4)` | yes | — | |
| `registered_at` | `timestamptz` | no | `now()` | `summary.registered` counts these |
| `withdrawn_at` | `timestamptz` | yes | — | |
| `redacted_at` | `timestamptz` | yes | — | PDPA erasure |

- **Unique:** `(tenant_id, engagement_id, lower(email)) WHERE email IS NOT NULL`.
- **Index:** `(tenant_id, engagement_id)`; `(tenant_id, contact_id)`.

#### `attendance_days` — §8, M10-S06

One row per engagement per day. This is the table the immutability rule exists for.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `engagement_id` | `uuid` | no | — | → `engagements` `ON DELETE RESTRICT` |
| `day` | `smallint` | no | — | |
| `on_date` | `date` | no | — | |
| `status` | `attendance_status` | no | `'OPEN'` | `OPEN·PENDING_APPROVAL·LOCKED` |
| `immutable` | `boolean` | no | `false` | Generated: `status = 'LOCKED'`. Kept as a stored column because the API returns it |
| `approved_by_kind` | `actor_kind` | yes | — | |
| `approved_by_id` | `text` | yes | — | |
| `approved_by_name` | `text` | yes | — | |
| `approved_at` | `timestamptz` | yes | — | |
| `capture_qr` | `boolean` | no | `true` | `captureModes.qr`; forced `false` while locked |
| `capture_signature` | `boolean` | no | `true` | |
| `capture_manual` | `boolean` | no | `true` | |
| `unlocked_at` | `timestamptz` | yes | — | Last unlock |
| `unlock_reason` | `text` | yes | — | Required by `ATTENDANCE_UNLOCK` |
| `unlock_count` | `smallint` | no | `0` | |

- **Unique:** `(tenant_id, engagement_id, day)`.
- **Checks:** `status <> 'LOCKED' OR (approved_at IS NOT NULL AND approved_by_id IS NOT NULL)`;
  `status <> 'LOCKED' OR (capture_qr = false AND capture_signature = false AND capture_manual = false)` — "the UI disables from the response" becomes a constraint, so the response cannot lie;
  `unlock_count = 0 OR unlock_reason IS NOT NULL`.
- **Derived, not stored:** `summary.registered`, `presentAm`, `presentPm`, `signatures`. See "Deviations" on `signaturesExpected`.

#### `attendance_entries` — §8

Normalised to one row per participant per half-day, rather than the response's `am` / `pm` object pair.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `attendance_sheet_id` | `uuid` | no | — | → `attendance_days` `ON DELETE RESTRICT` |
| `participant_id` | `uuid` | no | — | → `participants` `ON DELETE RESTRICT` |
| `half` | `attendance_half` | no | — | `AM·PM` |
| `present` | `boolean` | no | — | |
| `marked_at` | `timestamptz` | yes | — | The `at` in the response |
| `method` | `capture_method` | yes | — | `QR·SIGNATURE·MANUAL` |
| `absence_reason` | `absence_reason` | yes | — | `MEDICAL_LEAVE·WORK_CONFLICT·NO_SHOW·OTHER` |
| `signature_id` | `uuid` | yes | — | → `signatures` `ON DELETE RESTRICT` |

No `ref`. **Unique:** `(tenant_id, attendance_sheet_id, participant_id, half)`.
**Checks:** `present = true OR absence_reason IS NOT NULL`; `present = false OR method IS NOT NULL`.
**Index:** `(tenant_id, participant_id)`.

#### `certificates`, `evaluation_responses` — §8, §9

`certificates`: `participant_id → participant ON DELETE RESTRICT`, `engagement_id`,
`issued_at timestamptz`, `template_id uuid → template`, `attachment_id uuid → attachment`,
`serial text`. Has a `ref`. **Unique** `(tenant_id, participant_id, engagement_id)`.

`evaluation_responses`: `engagement_id`, `participant_id uuid NULL` (anonymous responses are allowed),
`submitted_at timestamptz`, `overall_score numeric(3,2)`, `answers jsonb`. No `ref`.
**Unique** `(tenant_id, engagement_id, participant_id) WHERE participant_id IS NOT NULL`.
`EVALUATION_SUMMARY` completeness ("24 of 30 responses collected") is
`count(evaluation_response) / count(participant)`, a view, not a stored number.

#### `outbound_messages` — §4 follow-up drafts, §9 collections reminders, broadcasts

The single table behind `FOLLOWUP_SEND`, `REMINDER_SEND` and `BROADCAST_SEND`. One pattern, one table —
three near-identical message tables would be exactly the divergence the project rules forbid.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `purpose` | `text` | no | — | `FOLLOW_UP·COLLECTION_REMINDER·BROADCAST·JOINING_INSTRUCTIONS`. Added for GOV-07: three different action types gate the same status edge, and the transition registry keys on the entity, not the reason |
| `channel` | `enquiry_channel` | no | — | `EMAIL·WHATSAPP` in practice |
| `template_id` | `uuid` | yes | — | → `templates` `ON DELETE RESTRICT` |
| `category` | `message_category` | yes | — | `MARKETING·UTILITY·SERVICE` — WhatsApp pricing category |
| `contact_id` | `uuid` | yes | — | → `contacts` `ON DELETE SET NULL` |
| `to_address` | `text` | no | — | Frozen at send time |
| `follow_up_id` | `uuid` | yes | — | → `follow_ups` `ON DELETE SET NULL` |
| `invoice_id` | `uuid` | yes | — | → `invoices` `ON DELETE SET NULL` |
| `engagement_id` | `uuid` | yes | — | → `engagements` `ON DELETE SET NULL` — joining instructions |
| `body` | `text` | no | — | |
| `status` | `text` | no | `'DRAFT'` | `DRAFT·QUEUED·SENT·DELIVERED·READ·FAILED` |
| `sent_at` | `timestamptz` | yes | — | |
| `rate_per_message_sen` | `bigint` | yes | — | Rounded to the sen at estimate time |
| `rate_per_message_exact` | `numeric(10,6)` | yes | — | `0.056400` — §4 requires the exact rate for display |
| `estimated_cost_sen` | `bigint` | yes | — | |
| `actual_cost_sen` | `bigint` | yes | — | |
| `currency` | `char(3)` | no | `'MYR'` | |
| `message_rate_id` | `uuid` | yes | — | → `message_rates` — which rate row was applied |
| `consent_id` | `uuid` | yes | — | → `contact_consents` — the consent relied on, frozen |
| `provider_message_id` | `text` | yes | — | |

- **Indexes:** `(tenant_id, status, sent_at DESC)`; `(tenant_id, invoice_id)`; `(tenant_id, contact_id)`.
- **Unique:** `(tenant_id, provider_message_id) WHERE provider_message_id IS NOT NULL`.
- **Checks:** `status <> 'SENT' OR (sent_at IS NOT NULL AND consent_id IS NOT NULL)` — a sent message must
  name the consent it relied on. That is the PDPA evidence, and it belongs in the constraint.

#### `message_rates` — §4 WhatsApp rates, §16.4

`channel enquiry_channel`, `category message_category`, `rate_exact numeric(10,6)`, `currency char(3)`,
`effective_from timestamptz`, `effective_to timestamptz`, `fetched_at timestamptz`,
`source text` (`BSP_API·MANUAL`), `stale_after timestamptz`. No `ref`.
**Unique** `(tenant_id, channel, category, effective_from)`.
A rate row exists because §16.4 asks what TTL applies and what the composer shows when the lookup fails:
the composer reads the newest non-stale row, and shows the last known rate labelled stale when
`now() > stale_after`. The TTL value itself is the client's decision (Q4).

### 3.3 Compliance

#### `hrdc_packets` — §9, M12-S02

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `engagement_id` | `uuid` | no | — | → `engagements` `ON DELETE RESTRICT` |
| `organisation_id` | `uuid` | no | — | → `organisations` `ON DELETE RESTRICT` |
| `scheme` | `hrdc_scheme` | no | — | |
| `employer_code` | `text` | no | — | Frozen copy; the organisation may re-register later |
| `claim_value_sen` | `bigint` | no | — | |
| `levy_available_sen` | `bigint` | yes | — | From `hrdc_levy_statements`, frozen at assembly |
| `currency` | `char(3)` | no | `'MYR'` | |
| `completeness` | `numeric(4,3)` | no | `0` | Maintained by trigger over `hrdc_packet_documents` |
| `status` | `packet_status` | no | `'DRAFT'` | `DRAFT·READY·SUBMITTED·PAID·REJECTED` |
| `deadline_at` | `timestamptz` | yes | — | |
| `deadline_severity` | `severity` | yes | — | Derived; stored so the badge and the list agree |
| `grant_reference` | `text` | yes | — | `GRT-2026-77412` |
| `grant_submitted_at` | `timestamptz` | yes | — | Pins `engagements.grant_rule_set_version_id` (§18/S1) |
| `grant_approved_at` | `timestamptz` | yes | — | After this, grant terms are immutable (DECISIONS §3) |
| `claim_reference` | `text` | yes | — | `CLM-2026-118834`, recorded by a human from eTRIS |
| `claim_submitted_at` | `timestamptz` | yes | — | |
| `claim_rule_set_version_id` | `uuid` | yes | — | → `rule_set_versions`. **Pinned at claim submission** (§18/S1) |
| `voided_at` | `timestamptz` | yes | — | Set by `ATTENDANCE_UNLOCK` |
| `void_reason` | `text` | yes | — | |

- **Unique:** `(tenant_id, engagement_id)`; `(tenant_id, claim_reference) WHERE claim_reference IS NOT NULL`.
- **Indexes:** `(tenant_id, status, deadline_at)`; `(tenant_id, organisation_id)`.
- **Checks:** `status <> 'SUBMITTED' OR (completeness = 1 AND claim_reference IS NOT NULL AND claim_submitted_at IS NOT NULL)` — this is the `422 VALIDATION_FAILED` from §9 expressed where it cannot be bypassed; `grant_submitted_at IS NULL OR grant_reference IS NOT NULL`.
- **There is no submit-to-HRDC path.** HRD Corp has no API (§9). `claim_reference` is always human-entered.
- `submissionLog[]` is **not a table.** It is a view over **sb-events**' `audit_entries` filtered to this packet. A second log would drift from the audit drawer.

#### `hrdc_packet_documents` — §9 `requiredDocuments[]`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `hrdc_packet_id` | `uuid` | no | — | → `hrdc_packets` `ON DELETE CASCADE` |
| `document_type` | `text` | no | — | → `hrdc_document_type__ref(document_type)` `ON DELETE RESTRICT` |
| `status` | `document_presence` | no | `'MISSING'` | `PRESENT·MISSING`. The package admits no `REJECTED`; see Deviation 14 |
| `attachment_id` | `uuid` | yes | — | → `attachments` `ON DELETE RESTRICT` |
| `source_ref` | `text` | yes | — | `ENG-0231/attendance`, `TTT-2019-4471`, `INV-2026-0311` |
| `meta` | `jsonb` | yes | — | `"Locked 14 Nov · 28/30 present"` and friends |
| `attached_at` | `timestamptz` | yes | — | |

No `ref`. **Unique:** `(tenant_id, hrdc_packet_id, document_type)`.
**Check:** `status <> 'PRESENT' OR (attachment_id IS NOT NULL OR source_ref IS NOT NULL)`.
`hrdc_document_types` is a reference table, not an enum, because HRD Corp changes the required set by
circular and the registry must be editable without a migration.

#### `hrdc_levy_statements` — addition, see "Deviations"

`organisation_id`, `employer_code text`, `levy_available_sen bigint`, `as_of date`,
`source text` (`MANUAL_ENTRY·STATEMENT_UPLOAD`), `attachment_id uuid`. Has a `ref`.
**Unique** `(tenant_id, organisation_id, as_of)`.
`levyAvailable` is rendered on three screens and has no API source — HRD Corp has no API — so it must be a
dated snapshot with a provenance of its own, not a live number.

#### `rule_set_versions` — §18/S1

`version_key text NOT NULL` (`rs_2026_06_15`), `effective_from date NOT NULL`, `effective_to date`,
`label text`, `frozen_at timestamptz`. No `ref` (the `version_key` is the ref).
**Unique** `(tenant_id, version_key)`; `EXCLUDE USING gist (tenant_id WITH =, daterange(effective_from, effective_to) WITH &&)`
so two versions can never claim the same day.

#### `compliance_rules` — §17, M12-S07

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `rule_key` | `text` | no | — | `HRD-014` — the id the API returns |
| `rule_set_version_id` | `uuid` | no | — | → `rule_set_versions` `ON DELETE RESTRICT` |
| `scheme` | `hrdc_scheme` | yes | — | Null means all schemes |
| `subject` | `text` | no | — | `"In-house application lead time"` |
| `expression` | `jsonb` | no | — | `{field, op, reference, offsetDays}` |
| `side` | `text` | no | — | `GRANT·CLAIM` — decides which `asOf` applies (§18/S1) |
| `effective_from` | `date` | no | — | |
| `effective_to` | `date` | yes | — | |
| `status` | `rule_status` | no | `'PROPOSED'` | `PROPOSED·ACTIVE·SUPERSEDED` |
| `knowledge_source_id` | `uuid` | yes | — | → `knowledge_sources` `ON DELETE SET NULL` |
| `source_document_id` | `text` | yes | — | `DOC-0188` |
| `source_title` | `text` | yes | — | `"Circular 04/2026"` |
| `source_section` | `text` | yes | — | `"3.2"` |
| `source_page` | `smallint` | yes | — | |
| `source_excerpt` | `text` | yes | — | Verbatim, frozen |
| `supersedes_rule_id` | `uuid` | yes | — | → `compliance_rules` `ON DELETE SET NULL` |
| `superseded_by_rule_id` | `uuid` | yes | — | → `compliance_rules` `ON DELETE SET NULL` |
| `used_by_check_keys` | `text[]` | no | `'{}'` | `["CHK_LEAD_TIME"]` |
| `verified_by_user_id` | `uuid` | yes | — | |
| `verified_at` | `timestamptz` | yes | — | |

- **Unique:** `(tenant_id, rule_key)`; `(tenant_id, rule_key, rule_set_version_id)`.
- **Indexes:** `(tenant_id, scheme, status, effective_from)`; `(tenant_id, side)`.
- **Checks:** `status <> 'ACTIVE' OR verified_at IS NOT NULL` — an unverified rule can never be `ACTIVE`, which is DECISIONS §3's "every rule loads as Proposed until compliance verifies it" made structural; `effective_to IS NULL OR effective_to >= effective_from`.
- **Immutability:** an `ACTIVE` row is append-only. A change supersedes it with a new row carrying the **circular's** effective date, never the approval timestamp (§17). See §4 rule I5.
- **Seeded from DECISIONS §3**, all `PROPOSED`: in-house lead time 14 days, public lead time 3 days (to 31 Dec 2026), public lead time 14 days (from 1 Jan 2027), commencement window 90 days, claim window 6 months, no amendment after approval, trainer accreditation at grant application, ACM ceilings, attendance immutability. The demo's five-working-day claim window is **not seeded** (§18/S6). "Apply before Friday 5 PM" is a `WARN` check with no rule row.

#### `rule_change_sets`, `rule_changes`, `rule_change_affected_engagements` — §17, M12-S08

`rule_change_sets`: `document_key text` (`DOC-0219`), `title text`, `published_at date`,
`ingested_at timestamptz`, `knowledge_source_id uuid`, `extracted_by_model text`,
`extracted_confidence numeric(4,3)`, `run_id uuid → agent_run`, `effective_from date`,
`status text` (`PROPOSED·APPROVED·REJECTED`), `approved_by_action_id uuid` (sb-actions).
**Unique** `(tenant_id, document_key)`.

`rule_changes`: `rule_change_set_id` `ON DELETE CASCADE`, `change_key text` (`chg_1`),
`op rule_change_op` (`ADD·MODIFY·SUPERSEDE`), `target_rule_id uuid → compliance_rule`,
`new_rule_id uuid → compliance_rule`, `before_text text`, `after_text text`,
`source_page smallint`, `source_section text`, `source_excerpt text`, `confidence numeric(4,3)`,
`status text` (`PROPOSED·APPROVED·REJECTED·WITHHELD`), `withheld_reason text`. No `ref`.
**Check:** `confidence >= 0.80 OR status = 'WITHHELD'` — §17 says changes below 0.80 are withheld from the
diff view and flagged for manual transcription; the constraint makes that impossible to forget.

`rule_change_affected_engagements`: `rule_change_id`, `engagement_id`, both `ON DELETE CASCADE`.
No `ref`. **Unique** `(tenant_id, rule_change_id, engagement_id)`.

#### `compliance_check_results` — §17, §18, M12-S02 and M09-S02

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `engagement_id` | `uuid` | no | — | → `engagements` `ON DELETE CASCADE` |
| `check_key` | `text` | no | — | → `check_key__ref(check_key)` `ON DELETE RESTRICT` |
| `state` | `check_state` | no | — | `PASS·WARN·FAIL·NOT_APPLICABLE` |
| `label` | `text` | no | — | |
| `computed` | `jsonb` | no | — | The named values the screen renders |
| `display` | `text` | yes | — | The pre-rendered sentence |
| `compliance_rule_id` | `uuid` | yes | — | → `compliance_rules` `ON DELETE RESTRICT` |
| `rule_set_version_id` | `uuid` | no | — | → `rule_set_versions`. The version actually applied |
| `rule_side` | `text` | no | — | `GRANT·CLAIM` |
| `rules_as_of` | `date` | no | — | Grant submission date or claim submission date, never the training date |
| `basis` | `rule_resolution_basis` | no | — | `GRANT_SUBMITTED·CLAIM_SUBMITTED` |
| `method` | `text` | no | `'DETERMINISTIC'` | `DETERMINISTIC·INTERPRETED` |
| `evaluated_at` | `timestamptz` | no | `now()` | |
| `stage_key` | `text` | yes | — | The transition that triggered re-evaluation |

No `ref`. **Unique:** `(tenant_id, engagement_id, check_key, evaluated_at)` — results are append-only, so
the "re-evaluate at every stage transition" rule (DECISIONS §6) leaves a history rather than overwriting.
**Indexes:** `(tenant_id, engagement_id, evaluated_at DESC)`; `(tenant_id, state) WHERE state = 'FAIL'`.
**Two triggers replace one check (sb-money C-5).** §17's rule that a deterministic check carries no model
was a column check here, `method <> 'DETERMINISTIC' OR provenance_id IS NULL`, and the column is gone.
sb-money's trigger on `provenance` refuses a row whose subject is a `DETERMINISTIC` check. That alone is
not enough: nothing would stop an `INTERPRETED` check being flipped to `DETERMINISTIC` after its
provenance row already exists. **The companion trigger belongs on this table and is this lane's to
install** — a `BEFORE UPDATE` on `compliance_check_results` that refuses `method → 'DETERMINISTIC'` while
a provenance row for that subject exists. sb-money wrote and verified both halves in their C-5.
`compliance_check_results` is on their `provenance_subject` allow-list. Recorded as a real cost of C-1: one
column check became two triggers across two lanes.
A `FAIL` writes `engagement_step_states.state = 'BLOCKED'` on the `HRDC_CLAIM` step via trigger.

#### `compliance_version_drifts` — §18/S1

`compliance_check_result_id` `ON DELETE CASCADE`, `applied_version_id uuid → rule_set_version`,
`current_version_id uuid → rule_set_version`, `severity severity`, `message text`. No `ref`.
Exists so a version change between stages produces a warning citing both versions, never a silent switch.

#### `knowledge_sources`, `knowledge_chunks` — §17, M16-S05

`knowledge_sources`: `name text`, `source_type knowledge_source_type` (`HRDC_CIRCULAR` only, per the package), `version text`,
`uri text`, `attachment_id uuid`, `ingested_at timestamptz`, `chunk_count integer`,
`embedding_status embedding_status` (`INDEXED·PENDING·FAILED`), `last_checked_at timestamptz`,
`monitor_status monitor_status` (`WATCHING·CHANGED_REVIEW_PENDING·FAILED·MANUAL`),
`content_hash text`, `retrieval_scopes retrieval_scope[]` (`COMPLIANCE·CLIENT_FACING`),
`rule_change_set_id uuid`, `quarantined boolean NOT NULL DEFAULT false`, `archived_at timestamptz`.
Has a `ref` (`src_0219`). **Unique** `(tenant_id, content_hash)`.
**Check:** `monitor_status <> 'CHANGED_REVIEW_PENDING' OR quarantined` — §17 says a changed source is
quarantined from rule extraction until reviewed but stays searchable, so quarantine is a column the
retriever reads, not a status string it interprets.

`knowledge_chunks`: `knowledge_source_id` `ON DELETE CASCADE`, `seq integer`, `content text`,
`token_count integer`, `embedding vector(1536)`, `metadata jsonb`. No `ref`.
**Unique** `(tenant_id, knowledge_source_id, seq)`.
**Index** HNSW on `embedding` (`vector_cosine_ops`), plus `(tenant_id, knowledge_source_id)`.
Requires the `vector` extension; confirm it is enabled on the Supabase project before the migration runs.

### 3.4 Finance

#### `invoices` — §9, M13-S02

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `organisation_id` | `uuid` | no | — | → `organisations` `ON DELETE RESTRICT` |
| `engagement_id` | `uuid` | yes | — | → `engagements` `ON DELETE RESTRICT` |
| `status` | `invoice_status` | no | `'DRAFT'` | `DRAFT·SENT·PARTIALLY_PAID·PAID·OVERDUE·VOID` |
| `issued_at` | `timestamptz` | yes | — | |
| `due_at` | `date` | yes | — | |
| `terms_days` | `smallint` | no | `30` | |
| `subtotal_sen` | `bigint` | no | `0` | Σ rounded lines (§18/S3) |
| `sst_sen` | `bigint` | no | `0` | Computed on the summed net |
| `sst_reason` | `text` | yes | — | `TRAINING_EXEMPT` |
| `total_sen` | `bigint` | no | `0` | `subtotal + sst` |
| `outstanding_sen` | `bigint` | no | `0` | `total − Σ payments` |
| `currency` | `char(3)` | no | `'MYR'` | |
| `sync_state` | `sync_state` | no | `'NOT_SENT'` | `NOT_SENT·SENT·VALIDATED·ERROR` |
| `sync_provider` | `text` | yes | — | `ACCOUNTING` |
| `sync_uin` | `text` | yes | — | `MY-2026-XXXXXXXX-0311`, mirrored from MyInvois downstream |
| `sync_document_id` | `text` | yes | — | The accounting package's id |
| `sync_last_attempt_at` | `timestamptz` | yes | — | |
| `voided_at` | `timestamptz` | yes | — | |

- **Unique:** `(tenant_id, sync_provider, sync_document_id) WHERE sync_document_id IS NOT NULL`.
- **Indexes:** `(tenant_id, status, due_at)`; `(tenant_id, organisation_id)`; `(tenant_id, engagement_id)`; `(tenant_id, sync_state) WHERE sync_state = 'ERROR'`; and for the policy gate, `invoices_overdue` on `(tenant_id, organisation_id, due_at) WHERE outstanding_sen > 0 AND status IN ('SENT','PARTIALLY_PAID','OVERDUE')`.
- **Checks:** `total_sen = subtotal_sen + sst_sen`; `outstanding_sen >= 0`; `status <> 'SENT' OR issued_at IS NOT NULL`; `currency = 'MYR'` — sb-money's, and it exists because of the `_sen` reservation this document raised. A `_sen` column holding cents is wrong under any suffix; the constraint makes it fail at the point of change and forces the rename as part of whatever work introduces a second currency.
- **Trigger:** `total_sen` must equal the sum of rounded `invoice_lines.amount_sen` plus SST, or the write is rejected with `TOTAL_NOT_RECONCILED` (§18/S3). This is the constraint that makes lines-from-total unrepresentable.
- **Immutability:** once `sync_state = 'VALIDATED'`, every column except `status`, `outstanding_sen`, `sync_*` and `updated_at` is frozen. A validated tax invoice is a filed document.
- `daysOverdue`, `aging` buckets and `dsoDays` are views, never columns.

#### `invoice_lines` — §9, §18/S3

`invoice_id` `ON DELETE CASCADE`, `n smallint`, `description text`, `detail text`,
`qty numeric(10,2)`, `unit_price_sen bigint`, `amount_sen bigint`, `currency char(3)`,
`tax_code text`. No `ref`. **Unique** `(tenant_id, invoice_id, n)`.
**Check:** `amount_sen = round_half_up(unit_price_sen * qty)`.
There is no `per_pax` column: a package price is one line at `qty = 1` and per-pax is display only (§18/S3).

#### `invoice_sync_entries` — §9

`invoice_id` `ON DELETE CASCADE`, `at timestamptz`, `state sync_state`, `provider_code text`
(`CUSTOMER_NOT_MAPPED`), `detail text`, `resolution text`, `webhook_receipt_id uuid` (sb-events).
No `ref`. Append-only. **Index** `(tenant_id, invoice_id, at DESC)`.

#### `payments` — §9 `POST /invoices/{id}/payments`

`invoice_id` `ON DELETE RESTRICT`, `amount_sen bigint`, `currency char(3)`,
`received_at timestamptz`, `method text` (`BANK_TRANSFER·CHEQUE·CARD·HRDC_DISBURSEMENT`),
`external_reference text`, `recorded_by_user_id uuid`. Has a `ref`.
**Unique** `(tenant_id, invoice_id, external_reference) WHERE external_reference IS NOT NULL`.
**Check** `amount_sen > 0`. **Trigger** maintains `invoices.outstanding_sen` and flips `status` to
`PARTIALLY_PAID` / `PAID`. Payments are never updated or deleted; a correction is a negative-amount
reversal row, which is why the check allows only positive amounts on insert and reversals carry
`is_reversal boolean` with their own sign rule.

#### `collections_cases`, `collection_rules` — §9, M13-S05

`collections_cases`: `invoice_id` **unique** per tenant `ON DELETE CASCADE`, `organisation_id`,
`stage collection_stage` (`REMINDER_1·REMINDER_2·REMINDER_3·HUMAN_CALL·TRADING_HOLD`),
`stage_entered_at timestamptz`, `next_action_at timestamptz`, `next_action_type text`,
`next_action_status text` (`DRAFT_READY·SCHEDULED·BLOCKED`), `autonomy autonomy_level`,
`trading_hold_approved_by_action_id uuid`, `closed_at timestamptz`. Has a `ref`.
**Index** `(tenant_id, stage, next_action_at) WHERE closed_at IS NULL`.

`collection_rules`: `stage collection_stage`, `trigger_days_overdue smallint`, `channel enquiry_channel`,
`template_id uuid`, `requires_role app_role`, `autonomy autonomy_level`. No `ref`.
**Unique** `(tenant_id, stage)`. Seeds the 7 / 30 / 45 ladder, human call at 60, trading hold at 75 with
MD approval (§9). The ladder is configuration, not code.

### 3.5 AI-ops

#### `agents` — §10, M18-S01

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `agent_key` | `text` | no | — | `agent_proposal` — the id the API returns and `requestedBy.id` carries |
| `principal_user_id` | `uuid` | yes | — | → `auth.users(id)`. The inert auth row sb-tenancy issues per agent per tenant, so an agent's writes carry a real principal |
| `name` | `text` | no | — | |
| `status` | `agent_status` | no | `'ACTIVE'` | `ACTIVE·PAUSED·RETIRED` |
| `scopes` | `text[]` | no | `'{}'` | `["proposals","quotations"]` |
| `default_tier_key` | `text` | yes | — | → `ai_tier(tier_key)` `ON DELETE RESTRICT` |
| `escalation_ladder` | `text[]` | no | `'{}'` | Tier keys, in order |
| `kill_switch` | `boolean` | no | `false` | |
| `paused_at` | `timestamptz` | yes | — | |
| `paused_reason` | `text` | yes | — | `EVAL_REGRESSION` |
| `resume_condition` | `jsonb` | yes | — | `{metric, op, value}` |
| `eval_score` | `numeric(4,3)` | yes | — | Latest from `eval_runs` |
| `cost_month_sen` | `bigint` | no | `0` | Rolling, from `ai_usage_entries` |
| `cost_per_run_30d_sen` | `bigint` | yes | — | |
| `cache_hit_rate_30d` | `numeric(4,3)` | yes | — | |
| `last_run_at` | `timestamptz` | yes | — | |
| `currency` | `char(3)` | no | `'MYR'` | |

- **Unique:** `(tenant_id, agent_key)`.
- **Checks:** `status <> 'PAUSED' OR paused_at IS NOT NULL`.
- §16.7 asks whether a service principal is one credential per agent or per agent per tenant. This schema answers **per agent per tenant** — `agents` carries `tenant_id`, so `agent_proposal` in tenant A and in tenant B are different rows with different autonomy grants and different spend. Credentials themselves belong to **sb-tenancy**.

#### `agent_autonomy` — §10, DECISIONS §1

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `agent_id` | `uuid` | no | — | → `agents` `ON DELETE CASCADE` |
| `action_type` | `text` | no | — | → `action_types` `ON DELETE RESTRICT` |
| `level` | `autonomy_level` | no | — | `OBSERVE·SUGGEST·ACT_WITH_APPROVAL·AUTONOMOUS` |
| `ceiling` | `autonomy_level` | no | — | The highest level this grant may ever reach |
| `ceiling_reason` | `text` | yes | — | `MONEY_MOVING` |
| `paused` | `boolean` | no | `false` | Per-action-type pause (§10 `POST /agents/{id}/pause`) |
| `min_confidence` | `numeric(4,3)` | yes | — | Policy evaluation input 4 (§3) |
| `value_threshold_sen` | `bigint` | yes | — | Band above which the grant drops to approval |
| `promotion_condition` | `text` | yes | — | DECISIONS §1 promotion conditions, verbatim |
| `promoted_at` | `timestamptz` | yes | — | |

No `ref`. **Unique:** `(tenant_id, agent_id, action_type)`.
**Check:** `level <= ceiling` using an ordering function over `autonomy_level`, so
`PUT /agents/{id}/autonomy` returning `422 MONEY_MOVING_CEILING` is a constraint violation and not a
service-layer opinion. **Read by sb-actions' policy gate; written by the AI-ops screens.**

#### `runs` — §10, §17, M18-S04

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `run_key` | `text` | no | — | `run_4821`; `ref` carries `#4821` |
| `agent_id` | `uuid` | no | — | → `agents` `ON DELETE RESTRICT` |
| `parent_run_id` | `uuid` | yes | — | → `runs` — retry, replay or sandbox parent |
| `mode` | `text` | no | `'LIVE'` | `LIVE·SANDBOX` — a sandbox replay writes no effects (§10) |
| `orchestrator` | `text` | yes | — | `proposal_orchestrator` |
| `trigger_type` | `text` | no | — | `TNA_SIGNED_OFF` |
| `trigger_ref` | `text` | yes | — | `TNA-0042` |
| `action_type` | `text` | yes | — | → `action_types` |
| `tier_key` | `text` | yes | — | → `ai_tiers` |
| `model` | `text` | yes | — | Frozen model name at run time |
| `started_at` | `timestamptz` | no | — | |
| `ended_at` | `timestamptz` | yes | — | |
| `duration_ms` | `integer` | yes | — | |
| `cost_sen` | `bigint` | no | `0` | |
| `currency` | `char(3)` | no | `'MYR'` | |
| `tokens_in` | `integer` | no | `0` | |
| `tokens_out` | `integer` | no | `0` | |
| `cache_hit_rate` | `numeric(4,3)` | yes | — | |
| `tiers_used` | `text[]` | no | `'{}'` | |
| `status` | `run_status` | no | `'RUNNING'` | `RUNNING·SUCCEEDED·FAILED·HALTED` |
| `outcome` | `action_status` | yes | — | `EXECUTED·QUEUED_FOR_APPROVAL·SUGGESTED·REJECTED` |
| `failure_code` | `text` | yes | — | `WA_TEMPLATE_REJECTED` |
| `failure_message` | `text` | yes | — | |
| `attempts` | `smallint` | no | `1` | |
| `retryable` | `boolean` | yes | — | |
| `dead_lettered` | `boolean` | no | `false` | |
| `dead_letter_reason` | `text` | yes | — | |
| `snapshot_at` | `timestamptz` | yes | — | For §16.8: the instant a sandbox replay reads as-of |

- **Unique:** `(tenant_id, run_key)`.
- **Indexes:** `(tenant_id, agent_id, started_at DESC)`; `(tenant_id, status) WHERE status IN ('FAILED','HALTED')`; `(tenant_id, tier_key, started_at)`.
- **Checks:** `status <> 'FAILED' OR failure_code IS NOT NULL`; `mode <> 'SANDBOX' OR parent_run_id IS NOT NULL`.
- **Immutability:** a run and its children are write-once after `ended_at` is set. A trace that can be edited proves nothing, and §10 leans on `haltedBy` as proof the agent never sent anything.

#### `run_steps` — §10

`agent_run_id` `ON DELETE CASCADE`, `seq smallint`, `tool text`, `args jsonb`, `result jsonb`,
`status run_step_status` (`OK·RETRIED·FAILED·HALTED`), `retries smallint`, `duration_ms integer`,
`cost_sen bigint`, `error jsonb`, `halted_by_policy_id text`,
`approval_request_id uuid → approval_request` (sb-actions) `ON DELETE SET NULL`,
`halted_reason text`. No `ref`. **Unique** `(tenant_id, agent_run_id, seq)`.
**Check:** `status <> 'HALTED' OR halted_by_policy_id IS NOT NULL`.

#### `run_nodes` — §17 execution tree

`agent_run_id` `ON DELETE CASCADE`, `node_key text` (`n0`), `parent_node_id uuid → agent_run_node`,
`kind trace_node_kind` (`ORCHESTRATOR·SUB_AGENT·TOOL`), `name text`, `tier_key text → ai_tier`,
`model text`, `provider text`, `tokens_in integer`, `tokens_out integer`,
`cache_hit_rate numeric(4,3)`, `cost_sen bigint`, `duration_ms integer`,
`status run_step_status`, `retries smallint`, `halted_by_policy_id text`,
`approval_request_id uuid`. No `ref`. **Unique** `(tenant_id, agent_run_id, node_key)`.
**Check:** exactly one root — `(tenant_id, agent_run_id) WHERE parent_node_id IS NULL` partial unique index.

#### `run_events`, `jury_votes` — §17, §18/S2

`run_events`: `agent_run_id` `ON DELETE CASCADE`, `event_type run_event_type`
(`ESCALATION·JURY·TRUNCATION·HANDOFF·CHECKPOINT·POLICY_HALT·CACHE_HIT·BUDGET_EXCEEDED`),
`at timestamptz`, `agent_run_node_id uuid`, `detail jsonb`. No `ref`.
**Index** `(tenant_id, agent_run_id, at)`.

`jury_votes`: `agent_run_event_id` `ON DELETE CASCADE`, `tier_key text → ai_tier`, `model text`,
`agrees boolean`, `dissent text`, `blocking boolean NOT NULL`, `jury_mode jury_mode`. No `ref`.
`blocking = false` for `SAMPLE` votes, which run after the human decides and never touch the decision
(§18/S2). The column exists so a sampled dissent can never be mistaken for a gate.

#### `run_state_cards`, `run_guardrails`, `run_checkpoints` — §17

`run_state_cards`: `agent_run_id` **unique** `ON DELETE CASCADE`, `goal text`, `plan jsonb`,
`decisions text[]`, `constraints text[]`, `record_pointers text[]`, `open_questions text[]`,
`tokens_used integer`, `tokens_limit integer`, `cost_used_sen bigint`, `cost_limit_sen bigint`.

`run_guardrails`: `agent_run_id` `ON DELETE CASCADE`, `label text`, `seq smallint`.
The five guardrail strings in §10 are rows, so the trace shows what was in force for that run rather than
what is in force today.

`run_checkpoints`: `agent_run_id` `ON DELETE CASCADE`, `step_seq smallint`, `replayable boolean`,
`state jsonb`, `created_at`. **Unique** `(tenant_id, agent_run_id, step_seq)`.
Backs `POST /runs/{id}/retry?from=checkpoint`.

#### `eval_sets`, `eval_runs` — §10 `GET /evals?agentId=`, DECISIONS §2 gate

`eval_sets`: `name text`, `version text`, `item_count smallint`, `action_type text`, `frozen_at timestamptz`.
Has a `ref`. **Unique** `(tenant_id, name, version)`.

`eval_runs`: `agent_id`, `eval_set_id`, `action_type text`, `score numeric(4,3)`, `ran_at timestamptz`,
`purpose text` (`PROMOTION_GATE·SCHEDULED·AD_HOC`), `passed boolean`,
`jury_agreement numeric(4,3)`, `cost_sen bigint`. Has a `ref`.
**Index** `(tenant_id, agent_id, ran_at DESC)`.
`purpose = 'PROMOTION_GATE'` is the jury's first use in DECISIONS §2 — three STRONG models against the
golden set at promotion time, one-off.

#### `ai_tiers` — §17, M20-S20

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `tier_key` | `text` | no | — | `STRONG_1`. Natural key, **unique** `(tenant_id, tier_key)`, referenced by six tables as a composite FK |
| `model` | `text` | no | — | `Claude Sonnet 5` |
| `provider` | `ai_provider` | no | — | `ANTHROPIC·GOOGLE·OPENAI·DEEPSEEK` |
| `routing` | `routing_strategy` | no | `'FIXED'` | `THROUGHPUT·PRICE·FIXED` |
| `fallback_chain` | `text[]` | no | `'{}'` | Tier keys |
| `cache_strategy` | `cache_strategy` | no | `'NONE'` | `NONE·PROMPT_15M·PROMPT_1H·PROMPT_24H·CONTEXT_1H` |
| `max_output_tokens` | `integer` | yes | — | |
| `allowed_hours` | `int4range[]` | no | `'{"[0,24)"}'` | `[startHour, endHour)` pairs in MYT |
| `batch_eligible` | `boolean` | no | `false` | Decides queue-versus-escalate outside the window (§17 Q3) |
| `monthly_cap_sen` | `bigint` | yes | — | |
| `spend_sen` | `bigint` | no | `0` | |
| `currency` | `char(3)` | no | `'MYR'` | |
| `status` | `tier_status` | no | `'HEALTHY'` | `HEALTHY·DEGRADED·PAUSED_BY_CAP·DISABLED` |
| `degraded_since` | `timestamptz` | yes | — | |
| `degraded_reason` | `text` | yes | — | `PROVIDER_5XX` |
| `active_fallback_tier_key` | `text` | yes | — | |

- **Unique:** `(tenant_id, tier_key)`.
- **Checks:** `status <> 'DEGRADED' OR degraded_since IS NOT NULL`; `status <> 'PAUSED_BY_CAP' OR spend_sen >= monthly_cap_sen`.

#### `ai_routing_entries` — §17, §18/S2

`action_type text → action_type__ref`, `tier_key text → ai_tier`, `escalation_ladder text[]`,
`jury jsonb NOT NULL DEFAULT '{}'`, `required_for_autonomous boolean`, `applies_from timestamptz NOT NULL`.
No `ref`. **Unique** `(tenant_id, action_type, applies_from)`.

`applies_from` exists because §17 says routing changes **apply to future runs only, never retroactively**.
Routing is therefore versioned rows, not an updatable row; a run reads the entry whose `applies_from` is
the latest at or before `runs.started_at`. Updating in place would silently rewrite history, which is
exactly what the endpoint note forbids.

`jury` shape (§18/S2): `{ mode: GATE|SAMPLE|ESCALATE, quorum, of, tiers[], sampleRate?, triggers?: { minConfidence, maxValue, firstOfKind } }`.
JSONB because the shape is the contract's and is never filtered in SQL. A check constraint asserts
`jury->>'mode'` is one of the three.

#### `ai_provider_keys`, `ai_provider_key_tiers` — §17, M20-S21

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `provider` | `ai_provider` | no | — | `ANTHROPIC·GOOGLE·OPENAI·DEEPSEEK` |
| `label` | `text` | no | — | |
| `status` | `provider_key_status` | no | `'NOT_SET'` | `NOT_SET·VALID·INVALID·EXPIRING` |
| `masked_key` | `text` | no | — | `sk-ant-••••••••••••9a41`. Display only |
| `secret_ref` | `text` | no | — | Pointer into Vault. **The key itself is never a column** |
| `spend_month_sen` | `bigint` | no | `0` | |
| `cap_sen` | `bigint` | yes | — | |
| `currency` | `char(3)` | no | `'MYR'` | |
| `rotation_date` | `date` | yes | — | |
| `billing_owner` | `billing_owner` | no | — | `CLIENT_ACCOUNT·PASS_THROUGH` |
| `region` | `text` | no | — | Returned before a key is saved, for the PDPA residency call |
| `last_tested_at` | `timestamptz` | yes | — | |
| `invalid_since` | `timestamptz` | yes | — | |
| `active_fallback_tier_key` | `text` | yes | — | |
| `added_by_user_id` | `uuid` | yes | — | |
| `revealed_count` | `integer` | no | `0` | Every reveal is audited by sb-events |
| `deleted_at` | `timestamptz` | yes | — | Soft delete; `DELETE` returns 409 if a tier is left keyless |

Has a `ref` (`prv_anthropic`). **Unique** `(tenant_id, provider, label) WHERE deleted_at IS NULL`.
**Check:** `masked_key NOT LIKE 'sk-%' OR masked_key LIKE '%•%'` — a crude but real guard against a full
key landing in the display column.

`ai_provider_key_tiers`: `ai_provider_key_id`, `tier_key`, both `ON DELETE CASCADE`. No `ref`.
**Unique** `(tenant_id, ai_provider_key_id, tier_key)`. This is `scopeTiers[]` normalised so the
"409 if a tier has no remaining key" rule is a countable query rather than an array scan.

#### `ai_usage_entries`, `ai_budgets` — §17, M20-S16

`ai_usage_entries`: `period char(7)` (`2026-11`), `agent_run_id uuid`, `agent_id uuid`,
`tier_key text`, `action_type text`, `kind text` (`LLM·WHATSAPP·COMPUTE`),
`cost_sen bigint`, `currency char(3)`, `tokens_in integer`, `tokens_out integer`,
`cache_hit boolean`, `off_peak boolean`, `occurred_at timestamptz`. No `ref`. Append-only.
**Indexes** `(tenant_id, period, tier_key)`; `(tenant_id, period, agent_id)`; `(tenant_id, period, action_type)`
— one per `groupBy` value the endpoint accepts. `cacheHitRate`, `offPeakShare`, `estimatedCacheSaving`
and the forecast are all aggregates over this table.

`ai_budgets`: `scope budget_scope` (`TIER·AGENT·ACTION_TYPE`), `scope_key text`, `cap_sen bigint`,
`spend_sen bigint`, `state budget_state` (`WITHIN·NEAR·PAUSED`), `period char(7)`,
`raised_by_action_id uuid` (sb-actions, `BUDGET_CAP_RAISE`). No `ref`.
**Unique** `(tenant_id, scope, scope_key, period)`.
A tripped cap sets the matching `ai_tiers.status = 'PAUSED_BY_CAP'` by trigger, which is what makes runs
fail with `409 AGENT_PAUSED` and `details.reason: "BUDGET_CAP"`.

### 3.6 Shell / Platform

#### `saved_views` — §2, §16.9

`object saved_view_object` (`LEAD·ENQUIRY·APPROVAL`), `label text`, `filters jsonb`, `columns text[]`,
`is_default boolean`, `owner_id uuid → app_user ON DELETE CASCADE`,
`visibility view_visibility NOT NULL DEFAULT 'PRIVATE'` (`PRIVATE·TEAM·TENANT`, the values sb-tenancy's policy checks),
`deleted_at timestamptz`. Has a `ref`.
**Unique** `(tenant_id, owner_id, object, label) WHERE deleted_at IS NULL`;
partial unique `(tenant_id, owner_id, object) WHERE is_default AND deleted_at IS NULL`.
The `visibility` column is the schema's answer to §16.9 — it supports both readings, and the client only
has to pick the default. sb-tenancy's `saved_views` policy reads exactly these three values. `count` in the response is computed, never stored.

#### `templates`, `template_sections` — §2

`templates`: `template_type template_type` (`PROPOSAL·QUOTATION·CERTIFICATE·EMAIL·WHATSAPP·INVOICE·TNA_QUESTIONNAIRE·EVALUATION·HRDC_PACKET`),
`version smallint`, `label text`, `merge_fields text[]`, `status text` (`DRAFT·ACTIVE·RETIRED`),
`category message_category` (WhatsApp only), `rate_per_message_sen bigint` (WhatsApp only),
`approved_provider_ref text` (the BSP-approved template id). Has a `ref` (`tpl_proposal_std_v7`).
**Unique** `(tenant_id, template_type, label, version)`.
Templates are **versioned, never edited**: a proposal built from v7 must still render as v7 in five years,
and §10's guardrail "Approved template version" is meaningless otherwise.

`template_sections`: `template_id` `ON DELETE CASCADE`, `n smallint`, `title text`,
`ai_enabled boolean`, `default_body text`. No `ref`. **Unique** `(tenant_id, template_id, n)`.

#### `pipelines`, `pipeline_steps` — §5 `GET /config/pipelines?object=ENGAGEMENT`

`pipelines`: `object text` (`ENGAGEMENT·OPPORTUNITY·PACKET`), `name text`, `is_default boolean`,
`version smallint`, `status text`. Has a `ref`.
**Unique** `(tenant_id, object, name, version)`; partial unique `(tenant_id, object) WHERE is_default`.

`pipeline_steps`: `pipeline_id` `ON DELETE CASCADE`, `step_key text` (`ENQUIRY·TNA·PROPOSAL·APPROVAL·SENT·DELIVERY·WON·TRAINER_CONFIRMED·SCHEDULED·REGISTERED·DELIVERED·ATTENDANCE_LOCKED·HRDC_CLAIM·INVOICED·PAID`),
`label text`, `position smallint`, `terminal boolean`, `blocking_check_keys text[]`. No `ref`.
**Unique** `(tenant_id, pipeline_id, step_key)` and `(tenant_id, pipeline_id, position)`.
This table is the whole reason `engagement_step_states` stores no labels. Two different pipelines in the
contract — the six-step one on the organisation relations panel and the nine-step one on the engagement
detail — are two `pipelines` rows for the same object, not two hardcoded lists.

#### `metric_definitions` — §10 `GET /metrics/{key}`

`metric_key text` (`OPEN_PIPELINE·AR_OVERDUE·ADMIN_HOURS_SAVED·…`), `label text`,
`scope text` (`TENANT·ORGANISATION·ENGAGEMENT`), `value_kind text` (`MONEY·COUNT·RATE·DURATION`),
`formula text`, `is_estimate boolean`, `drill_to_template text`, `sql_source text`,
`compare_period text`. No `ref`. **Unique** `(tenant_id, metric_key, scope)`.
Every MetricStrip cell is self-describing because the definition is data, including its `drillTo` — §5 is
explicit that the UI never hardcodes a drill route.

#### `hours_saved_baseline_tables`, `hours_saved_baselines` — §18/S5, DECISIONS §4

`hours_saved_baseline_tables`: `version text`, `basis hours_saved_basis` (`MEASURED·ILLUSTRATIVE`),
`haircut numeric(3,2) NOT NULL DEFAULT 0.70`, `effective_from date`, `signed_off_by_user_id uuid`,
`signed_off_at timestamptz`. No `ref`. **Unique** `(tenant_id, version)`.

`hours_saved_baselines`: `baseline_table_id` `ON DELETE CASCADE`, `action_type text → action_type__ref`,
`baseline_minutes integer`, `sample_size smallint`, `credited boolean NOT NULL DEFAULT true`.
No `ref`. **Unique** `(tenant_id, baseline_table_id, action_type)`.
`human_minutes_spent` is per action, not per type — it is measured by the UI and belongs on
**sb-actions**' `action_requests` as `human_review_seconds`. Flagged to that lane.

#### `attachments`, `signatures` — §8, §9, §11

`attachments`: `storage_bucket text`, `storage_path text`, `filename text`, `content_type text`,
`byte_size bigint`, `checksum text`, `uploaded_by_user_id uuid`, `virus_scanned_at timestamptz`.
Has a `ref`. **Unique** `(tenant_id, storage_bucket, storage_path)`.
Referencing tables hold `attachment_id`; `attachments` holds no back-pointer, so there is no polymorphic
owner column and no orphan class to reconcile.

`signatures`: `attachment_id uuid → attachment`, `signed_at timestamptz`, `signer_name text`,
`signer_role text`, `method text` (`DRAWN·TYPED·CLICKWRAP`), `ip_address inet`, `user_agent text`.
Has a `ref` (`sig_9f21`). Serves both `attendance_entries.signature_id` and
`portal_acceptances.signature_id` — one signature concept, one table.

#### `ref_formats`, `ref_sequences` — ref allocation

`ref_formats`: `prefix text` **unique** `(tenant_id, prefix)`, `dated boolean`, `width smallint`,
`entity text`, `gapless boolean NOT NULL DEFAULT false`. No `ref` (it is the ref registry).

`ref_sequences`: `prefix text`, `period text` (`'2026'` or `'-'`), `next_value bigint NOT NULL DEFAULT 1`.
No `ref`. **Unique** `(tenant_id, prefix, period)`.

#### Reference tables — `action_types`, `check_keys`, `hrdc_document_types`

Each: `id uuid` PK with a **unique** natural key `(tenant_id, <key>)`, plus `label text`, `description text`, `position smallint`,
`active boolean`, and for `action_types` also `money_moving boolean`, `client_facing boolean`,
`hrdc_touching boolean` — the three properties DECISIONS §1 uses to justify a ceiling. The autonomy
ceiling check reads those columns instead of hardcoding a list of action types.

`action_types` seeds §3's nineteen action types plus `PROPOSAL_DRAFT`, `OPPORTUNITY_CREATE`,
`SUGGESTION_DISMISS`, `BUDGET_CAP_RAISE` and `RULE_CHANGE_APPROVE` from §17.

---

## 4 · Immutability the schema must enforce

### The rules

| # | Rule | Source | Scope of the freeze | Escape |
|---|---|---|---|---|
| I1 | **Attendance sheet lock** | §8, DECISIONS §3 | Once `attendance_days.status = 'LOCKED'`: no `UPDATE` or `DELETE` on that sheet's `attendance_entries` rows, and on the sheet itself only `status`, `unlocked_at`, `unlock_reason`, `unlock_count` may change | `ATTENDANCE_UNLOCK` action only |
| I2 | **Approved quotation** | §6, §7 | Once `quotations.status = 'APPLIED'`: the whole row and all its `quotation_lines` rows | None. A change writes a new `version` and marks the old `SUPERSEDED` |
| I3 | **Grant terms after approval** | DECISIONS §3 "No amendment" | Once `hrdc_packets.grant_approved_at IS NOT NULL`: `scheme`, `employer_code`, `claim_value_sen`, `grant_reference`, `grant_submitted_at`, `grant_approved_at`, and on the engagement `programme_id`, `grant_rule_set_version_id`, `grant_pinned_at` and the session dates | None in TrainOS. HRD Corp requires a new grant application |
| I4 | **Sent proposal** | §6 | Once `proposals.status = 'SENT'`: `template_id`, `value_sen`, `margin_rate`, `sent_at`, and every `proposal_sections.body` | None. A revised proposal is a new `proposals` row |
| I5 | **Active compliance rule** | §17, DECISIONS §3 | Once `compliance_rules.status = 'ACTIVE'`: every column except `status`, `superseded_by_rule_id`, `effective_to` | Supersede with a new row carrying the circular's effective date |
| I6 | **Validated invoice** | §9 | Once `invoices.sync_state = 'VALIDATED'`: everything except `status`, `outstanding_sen`, `sync_*` | None. A correction is a credit note |
| I7 | **Finished agent run** | §10 | Once `runs.ended_at IS NOT NULL`: the run, its steps, nodes, events, guardrails, checkpoints and state card | None. A retry is a new run with `parent_run_id` |
| I8 | **Provenance, consent, payments, audit** | §1, §4, §9 | Append-only tables: `provenance` (sb-money), `contact_consents`, `payments`, `invoice_sync_entries`, `compliance_check_results`, `ai_usage_entries`, `organisation_health_snapshots` | None |
| I9 | **Refs** | §1 | `ref` on every table, after insert | None |
| I10 | **Pinned rule-set versions** | §18/S1 | `engagements.grant_rule_set_version_id` after it is set, `hrdc_packets.claim_rule_set_version_id` after it is set | None. Drift is reported by `compliance_version_drifts`, never resolved by rewriting the pin |

### Recommendation: trigger **and** RLS, and they do different jobs

**Triggers are the invariant. RLS is the perimeter. Neither substitutes for the other.**

RLS alone cannot carry these rules, for one decisive reason: in Supabase the `service_role` key bypasses
RLS entirely, and every server-side write in this system — the action executor, the agent runner, the
webhook handlers — runs with it. A lock that `service_role` can walk through is not a lock. Triggers fire
for every role, including `service_role` and including `postgres`, so the attendance sheet is immutable
even to the code whose job is to write it.

Triggers alone are not enough either: a `BEFORE UPDATE` trigger that raises is a 500-shaped failure for a
caller who should never have been allowed to try. RLS gives the correct 404/403 shape for the read and
write perimeter, which is **sb-tenancy**'s design, and keeps the trigger as the last line rather than the
first.

**Mechanism.** Three shared functions, written once in the migration:

```
enforce_immutable_columns()      -- TG_ARGV = list of frozen column names
enforce_frozen_row(status_col, locked_values[])   -- freezes everything but an allow-list
enforce_append_only()            -- rejects UPDATE and DELETE outright
```

Each raises with `ERRCODE = 'P0001'` and a JSON `DETAIL` carrying the contract's error code
(`ATTENDANCE_LOCKED`, `TOTAL_NOT_RECONCILED`, `GRANT_TERMS_IMMUTABLE`) so the API layer maps to the right
HTTP status without string-matching a message.

**The one escape hatch**, for I1 only. `ATTENDANCE_UNLOCK` is a policy-gated action, so the trigger must
be able to tell "an approved unlock is executing" from "someone is writing to a locked sheet". Earlier
drafts of this document proposed a dedicated key, `trainos.unlock_action_id`. **That is withdrawn** under
ruling R-GOV. There is one applier key:

```
current_setting('app.effect_applier', true)   -- the action_request id, transaction-scoped
```

set by `app.apply_effects` and by nothing else. sb-actions is right that a second key would be a second
vocabulary for a problem the first already solves, and right that theirs is strictly stronger.

The framing is sb-tenancy's and all three documents now use it: **ground a claim in a row somebody else
wrote, rather than trusting what the caller presents.** A boolean in a session variable is the caller's
assertion. An action request id resolved against a table the caller cannot write is evidence.
`app.enforce_state_transition` resolves the id against `action_requests` and refuses unless that request's
`action_type` is the one gating this specific edge **in this tenant**, so forging the unlock would mean
producing an `ATTENDANCE_UNLOCK` action request, and the only way to produce one is through the policy
gate. sb-tenancy's `app.aal2_verified()` makes the same move for a different reason.

So the lock is enforced twice over, by two mechanisms with different jobs. GOV-07 authorises the
`LOCKED → OPEN` edge on `attendance_days.status` (§5.3). Rule I1's own trigger then refuses any write to
the sheet's `attendance_entries` unless the same `app.effect_applier` names a live `ATTENDANCE_UNLOCK`,
which is what stops a caller unlocking the day and rewriting yesterday's marks in the same transaction.
The unlock trigger also writes `hrdc_packets.voided_at` in the same statement, so §8's "voids the claim
packet" cannot be skipped by a partial implementation.

**sb-actions decides the gating** — which actions are policy-gated, who approves, what the SLA is. This
lane only asserts that the storage layer must refuse the write when the gate has not run.

### One thing the schema deliberately does not enforce

`ATTENDANCE_UNLOCK` after a claim reference exists. §16.5 asks whether the API should refuse outright once
`hrdc_packets.claim_reference IS NOT NULL` rather than allowing the void. The constraint is one line either
way; the answer is the client's. Left as Q5 rather than guessed, because guessing wrong here either blocks
a legitimate correction or permits an unwind of a filed claim.

---

## 5 · Gated state transitions (GOV-07)

`03-action-envelope-and-policy-gate.md` §2.9 registers `GOV-07`: a status column on a gated table may only
be crossed by the effect applier running the action type that gates that specific edge. The trigger and
the registry are sb-actions'. What belongs here is the domain half: **which tables carry the trigger, which
columns are revoked, and every legal edge**. A missing edge fails closed, so this list is a completeness
obligation rather than documentation.

### 5.1 Column grants

The trigger is the second line of defence. The first is a column privilege, which bites where RLS does not:
`service_role` bypasses row-level security but **not** column-level `UPDATE` grants, so revoking the column
stops the direct flip before any trigger runs. That is the case sb-actions tests as "GOV-07 direct flip".

For every status column in 5.3:

```sql
revoke update (<column>) on core.<table> from anon, authenticated, service_role;
-- the applier is SECURITY DEFINER and runs as the owner, so it needs no grant
create trigger <table>_state_gate
  before insert or update of <column> on core.<table>
  for each row execute function app.enforce_state_transition('<column>');
```

`INSERT` needs no column revoke, because the registry carries `from_status = null` rows and an insert
naming a status with no such row is refused by the trigger. That is sb-actions' "insert bypass" test.

### 5.2 One defect in the registry's shape

`state_transitions` is keyed `(entity, column_name, from_status, to_status)` with a single `gated_by`.
One edge in this model is authorised by **three** different action types: `outbound_messages`
`DRAFT → QUEUED` is gated by `FOLLOWUP_SEND`, `REMINDER_SEND` or `BROADCAST_SEND` depending on why the
message exists. That cannot be expressed, and the fail-closed default means the wrong one of the three
would be rejected at send time.

Two ways out, and the second is better: add a discriminator to the key, or make `gated_by` a `text[]` and
require the running action's type to be a member. I have added `outbound_messages.purpose` either way,
since the message needs to know what it is for. **Raised to sb-actions; the registry change is theirs.**

### 5.3 The legal-transition set

`from = (new)` means an `INSERT`. A blank gate means the edge is ungated and the trigger returns early.
Read every entity as `core.<entity>`.

**`enquiries.status`**

| from | to | gated_by |
|---|---|---|
| (new) | `OPEN` | |
| `OPEN` | `ASSIGNED` | |
| `ASSIGNED` | `OPEN` | |
| `OPEN` | `CONVERTED` | `OPPORTUNITY_CONVERT` |
| `ASSIGNED` | `CONVERTED` | `OPPORTUNITY_CONVERT` |
| `OPEN` | `ARCHIVED` | `ENQUIRY_ARCHIVE` |
| `ASSIGNED` | `ARCHIVED` | `ENQUIRY_ARCHIVE` |
| `OPEN` | `NOT_AN_ENQUIRY` | `ENQUIRY_ARCHIVE` |
| `ARCHIVED` | `OPEN` | |

**`opportunities.stage`**

| from | to | gated_by |
|---|---|---|
| (new) | `NEW` | |
| (new) | `QUALIFYING` | `OPPORTUNITY_CONVERT` |
| `NEW` | `QUALIFYING` | |
| `QUALIFYING` | `TNA_SENT` | |
| `TNA_SENT` | `QUALIFYING` | |
| `QUALIFYING` | `PROPOSAL_SENT` | `PROPOSAL_SEND` |
| `TNA_SENT` | `PROPOSAL_SENT` | `PROPOSAL_SEND` |
| `PROPOSAL_SENT` | `NEGOTIATION` | |
| `NEGOTIATION` | `PROPOSAL_SENT` | `PROPOSAL_SEND` |
| `PROPOSAL_SENT` | `WON` | |
| `NEGOTIATION` | `WON` | |
| `NEW` | `LOST` | |
| `QUALIFYING` | `LOST` | |
| `TNA_SENT` | `LOST` | |
| `PROPOSAL_SENT` | `LOST` | |
| `NEGOTIATION` | `LOST` | |

**`tnas.status`**

| from | to | gated_by |
|---|---|---|
| (new) | `DRAFT` | |
| `DRAFT` | `SENT` | |
| `SENT` | `DRAFT` | |
| `SENT` | `COMPLETE` | |
| `COMPLETE` | `REOPENED` | |
| `REOPENED` | `COMPLETE` | |

**`proposals.status`**

| from | to | gated_by |
|---|---|---|
| (new) | `DRAFT` | |
| `DRAFT` | `AWAITING_APPROVAL` | `PROPOSAL_SEND` |
| `AWAITING_APPROVAL` | `DRAFT` | |
| `AWAITING_APPROVAL` | `SENT` | `PROPOSAL_SEND` |
| `DRAFT` | `SENT` | `PROPOSAL_SEND` |
| `SENT` | `VIEWED` | |
| `SENT` | `ACCEPTED` | |
| `VIEWED` | `ACCEPTED` | |
| `SENT` | `LOST` | |
| `VIEWED` | `LOST` | |

`AWAITING_APPROVAL → DRAFT` is ungated on purpose: it is what `REQUEST_CHANGES` leaves behind, and the
approval decision is already gated on its own side.

**`quotations.status`**

| from | to | gated_by |
|---|---|---|
| (new) | `DRAFT` | |
| `DRAFT` | `APPLIED` | `QUOTATION_APPLY` |
| `DRAFT` | `SUPERSEDED` | |
| `APPLIED` | `SUPERSEDED` | `QUOTATION_APPLY` |

A below-floor price is not a status edge. It is the `floor_price_needs_approval` constraint plus
`discount_approval_id`, gated by `DISCOUNT_APPROVE`.

**`engagements.status`**

| from | to | gated_by |
|---|---|---|
| (new) | `PROPOSED` | |
| `PROPOSED` | `CONFIRMED` | |
| `CONFIRMED` | `SCHEDULED` | |
| `SCHEDULED` | `IN_DELIVERY` | |
| `IN_DELIVERY` | `DELIVERED` | |
| `DELIVERED` | `CLOSED` | `ENGAGEMENT_CLOSE_OUT` |
| `PROPOSED` | `CANCELLED` | |
| `CONFIRMED` | `CANCELLED` | |
| `SCHEDULED` | `CANCELLED` | |

**`attendance_days.status`**

| from | to | gated_by |
|---|---|---|
| (new) | `OPEN` | |
| `OPEN` | `PENDING_APPROVAL` | |
| `PENDING_APPROVAL` | `OPEN` | |
| `OPEN` | `LOCKED` | `ATTENDANCE_APPROVE` |
| `PENDING_APPROVAL` | `LOCKED` | `ATTENDANCE_APPROVE` |
| `LOCKED` | `OPEN` | `ATTENDANCE_UNLOCK` |

`LOCKED → OPEN` is the only edge in the model that also has to void a claim packet. GOV-07 authorises the
transition; immutability rule I1 and its unlock trigger do the rest.

**`hrdc_packets.status`**

| from | to | gated_by |
|---|---|---|
| (new) | `DRAFT` | |
| `DRAFT` | `READY` | |
| `READY` | `DRAFT` | |
| `READY` | `SUBMITTED` | `HRDC_PACKET_MARK_SUBMITTED` |
| `SUBMITTED` | `PAID` | |
| `SUBMITTED` | `REJECTED` | |
| `REJECTED` | `DRAFT` | |

**`invoices.status`**

| from | to | gated_by |
|---|---|---|
| (new) | `DRAFT` | `INVOICE_CREATE` |
| `DRAFT` | `SENT` | `INVOICE_PUSH` |
| `SENT` | `PARTIALLY_PAID` | `PAYMENT_RECORD` |
| `SENT` | `PAID` | `PAYMENT_RECORD` |
| `PARTIALLY_PAID` | `PAID` | `PAYMENT_RECORD` |
| `SENT` | `OVERDUE` | |
| `PARTIALLY_PAID` | `OVERDUE` | |
| `OVERDUE` | `PARTIALLY_PAID` | `PAYMENT_RECORD` |
| `OVERDUE` | `PAID` | `PAYMENT_RECORD` |
| `DRAFT` | `VOID` | |
| `SENT` | `VOID` | |
| `OVERDUE` | `VOID` | |

`→ OVERDUE` is ungated because it is time passing, not an act. It is written by a scheduled job.

**`invoices.sync_state`** — a second gated column on the same table, so the trigger is attached twice

| from | to | gated_by |
|---|---|---|
| (new) | `NOT_SENT` | |
| `NOT_SENT` | `SENT` | `INVOICE_PUSH` |
| `NOT_SENT` | `ERROR` | |
| `SENT` | `VALIDATED` | |
| `SENT` | `ERROR` | |
| `ERROR` | `SENT` | `INVOICE_PUSH` |

`SENT → VALIDATED` is ungated: it arrives on the accounting webhook and no TrainOS action causes it.

**`collections_cases.stage`**

| from | to | gated_by |
|---|---|---|
| (new) | `REMINDER_1` | |
| `REMINDER_1` | `REMINDER_2` | `REMINDER_SEND` |
| `REMINDER_2` | `REMINDER_3` | `REMINDER_SEND` |
| `REMINDER_3` | `HUMAN_CALL` | |
| `HUMAN_CALL` | `TRADING_HOLD` | `DISCOUNT_APPROVE` |

`TRADING_HOLD` needs MD approval (§9) and has no action type of its own in §3. Gating it on
`DISCOUNT_APPROVE` is wrong and is a placeholder; the contract needs a `TRADING_HOLD_APPLY` action type.
**Raised as Q24.**

**`trainer_bookings.state`**

| from | to | gated_by |
|---|---|---|
| (new) | `SOFT_HOLD` | |
| `SOFT_HOLD` | `CONFIRMED` | `TRAINER_BOOK` |
| `SOFT_HOLD` | `RELEASED` | |
| `SOFT_HOLD` | `CANCELLED` | |
| `CONFIRMED` | `CANCELLED` | `TRAINER_BOOK` |

**`compliance_rules.status`**

| from | to | gated_by |
|---|---|---|
| (new) | `PROPOSED` | |
| `PROPOSED` | `ACTIVE` | `RULE_CHANGE_APPROVE` |
| `PROPOSED` | `SUPERSEDED` | |
| `ACTIVE` | `SUPERSEDED` | `RULE_CHANGE_APPROVE` |

There is no edge back to `ACTIVE` from `SUPERSEDED`, and none from `ACTIVE` to `PROPOSED`. Rule I5 makes an
active rule append-only, and this registry says the same thing a second way, which is deliberate: one is
the invariant, the other is the authorisation.

**`rule_changes.status`**

| from | to | gated_by |
|---|---|---|
| (new) | `PROPOSED` | |
| (new) | `WITHHELD` | |
| `WITHHELD` | `PROPOSED` | |
| `PROPOSED` | `APPROVED` | `RULE_CHANGE_APPROVE` |
| `PROPOSED` | `REJECTED` | |

**`agents.status`**

| from | to | gated_by |
|---|---|---|
| (new) | `ACTIVE` | |
| `ACTIVE` | `PAUSED` | `AGENT_PAUSE` |
| `PAUSED` | `ACTIVE` | `AGENT_PAUSE` |
| `ACTIVE` | `RETIRED` | |
| `PAUSED` | `RETIRED` | |

**`ai_budgets.state`**

| from | to | gated_by |
|---|---|---|
| (new) | `WITHIN` | |
| `WITHIN` | `NEAR` | |
| `NEAR` | `PAUSED` | |
| `NEAR` | `WITHIN` | |
| `PAUSED` | `WITHIN` | `BUDGET_CAP_RAISE` |

`→ PAUSED` is ungated because a tripped cap is arithmetic. Leaving `PAUSED` is the act, and it is
MD-gated (§17).

**`outbound_messages.status`**

| from | to | gated_by |
|---|---|---|
| (new) | `DRAFT` | |
| `DRAFT` | `QUEUED` | see 5.2 — three action types |
| `QUEUED` | `SENT` | |
| `SENT` | `DELIVERED` | |
| `DELIVERED` | `READ` | |
| `QUEUED` | `FAILED` | |
| `SENT` | `FAILED` | |

### 5.4 Status columns deliberately outside GOV-07

These carry a status but no action type ever crosses it, so they get neither the trigger nor a column
revoke. Listing them is the point: silence would read as an omission.

`follow_ups.status`, `organisation_suggestions.status`, `organisations.status`, `programmes.status`,
`templates.status`, `pipelines.status`, `trainers.status`, `hrdc_packet_documents.status`,
`ai_tiers.status`, `ai_provider_keys.status`, `knowledge_sources.monitor_status` and `embedding_status`,
`runs.status`, `run_steps.status`, `run_nodes.status`, `engagement_step_states.state`,
`compliance_check_results.state`.

Two of those deserve a word. `runs.status` is written only by the run engine and a run is immutable once
ended (rule I7), so a registry entry would add a lookup to every step of every run for no control.
`engagement_step_states.state` is computed from the check evaluator and the pipeline, never set by a user,
and gating it would mean the stepper could not render a `BLOCKED` step without an action.

**Total: 121 edges across 17 gated status columns.** That is roughly twice the sixty the lead estimated,
because §12's enums are larger than the estimate assumed. The number is not negotiable in the way an
estimate is: every edge listed here is one a screen or an endpoint actually performs, and every edge
omitted is a feature that fails closed in production.

---

## 6 · Soft delete and archival

**Default: nothing is deleted.** Almost every entity in this contract already carries a lifecycle status
that says what "gone" means for it — `ENQUIRY.ARCHIVED`, `OPPORTUNITY.LOST`, `INVOICE.VOID`,
`AGENT.RETIRED`, `PROGRAMME.RETIRED`, `RULE.SUPERSEDED`. Adding a parallel `deleted_at` to those tables
would create two ways to say the same thing, and the project rule is that a second way to solve a solved
problem is a defect.

So there are exactly four patterns, and a table uses one:

**1 · Lifecycle status (most tables).** No delete column at all. `enquiries`, `opportunities`, `proposals`,
`quotations`, `engagements`, `invoices`, `hrdc_packets`, `compliance_rules`, `agents`, `attendance_days`,
`collections_cases`, `follow_ups`, `organisation_suggestions`. `DELETE` is revoked from every role but
`postgres`.

**2 · `archived_at` (catalogue and CRM rows with no lifecycle).** `organisations`, `programmes`,
`knowledge_sources`. Archived rows are excluded by the default view, stay visible in search with a badge,
and remain fully referenceable — an archived programme still explains a five-year-old engagement.

**3 · `deleted_at` (rows with a real `DELETE` endpoint).** `saved_views` (§2 `DELETE /views/{id}`) and
`ai_provider_keys` (§17 `DELETE /ai/providers/{id}`, which returns `409` when a tier would be left
keyless — a countable query against `ai_provider_key_tiers`). Both are recoverable for 30 days, then a
scheduled job hard-deletes. These are the only two tables in the model where a user pressing delete should
mean the row goes away.

**4 · `redacted_at` (personal data).** `contacts` and `participants` only. PDPA erasure cannot be a soft
delete, because the obligation is that the data stops existing. The procedure nulls `name`, `email`,
`phone`, `identity_no_hash`, `identity_no_last4` and `department`, writes `redacted_at`, and leaves the
row, its FKs and its attendance records intact so headcounts, claims and invoices still reconcile. A
redacted participant renders as "Redacted participant" and still counts as present.

That last pattern has a live conflict the client must resolve: HRD Corp claim documentation is retained
for years, and an attendance sheet naming participants is part of a filed claim. Erasing a name from a
locked attendance sheet contradicts I1. The schema's position is that `redacted_at` on `participants` is
permitted and the locked `attendance_entries` rows are not touched, because they reference the participant
by `id` and carry no name. Whether the filed PDF must also be redacted is Q9.

**Retention.** Nothing in Sales, Delivery, Compliance or Finance is ever purged. `ai_usage_entries`,
`run_steps`, `run_nodes`, `run_events` and `knowledge_chunks` are the only high-volume
tables; they are candidates for partitioning by month and for a retention window, which is a
**sb-events** and operations decision rather than a domain one.

---

## 7 · Open questions for the client

Mapped to the contract's own numbering where one exists. Each names the column or constraint that changes,
so none of these blocks the migration author — every one has a default in the schema already.

| Q | Question | Maps to | What changes in the schema | Default taken |
|---|---|---|---|---|
| Q1 | Does an approval expire at 24h — expire, auto-reject, or nag forever? | §16.1 | `approval_requests.expires_at` and the `EXPIRED` status (sb-actions). Nothing here | Deferred to sb-actions |
| Q2 | Diff staleness: `409` with a recomputed diff, or a soft lock on the target? | §16.2 | A soft lock needs `locked_by_approval_id` + `locked_until` on `proposals`, `quotations`, `invoices` | `409`, no lock columns |
| Q3 | Who owns `firstProposalToOrg` — computed live or denormalised? | §16.3 | `proposals.organisation_id` plus the `proposals_org_sent` partial index | **Closed by sb-actions: computed live, never denormalised.** The counter columns this model originally carried are removed; the partial index makes the `EXISTS` probe an index-only scan |
| Q4 | WhatsApp rate cache TTL, and what the composer shows when the lookup fails | §16.4 | `message_rates.stale_after` and `source` | Show the last known rate, labelled stale. TTL value unset |
| Q5 | Should unlock be refused outright once a claim reference exists? | §16.5 | One check constraint on `attendance_days` | **Not** constrained. See §4 |
| Q6 | Client portal token: revoke on acceptance, or keep live for re-download? | §16.6 | `public_share_tokens.revoked_at` behaviour | Kept live for 30 days; acceptance does not revoke |
| Q7 | Agent service principals: one per agent, or one per agent per tenant? | §16.7 | `agents` is tenant-scoped | **Per agent per tenant** |
| Q8 | Sandbox replay: live reads or a snapshot pinned to the original run? | §16.8 | `runs.snapshot_at` exists but is unpopulated under a live-read answer | Column present, pinned-snapshot assumed |
| Q9 | Saved views: shared or personal? | §16.9 | `saved_views.visibility` | `PRIVATE` default, `TEAM` and `TENANT` supported |
| Q10 | Money rounding | §16.10 | Resolved by §18 | **Closed.** Total-from-lines |
| Q11 | Rule resolution for the claim window | §17 Q1 | Resolved by §18/S1 and DECISIONS §6 | **Closed.** Grant-side at grant submission, claim-side at claim submission |
| Q12 | Must `INV-` references be gapless? | New | `ref_formats.gapless` and a different allocator for that prefix | Not gapless. Malaysian tax-invoice practice may require otherwise — Finance to confirm |
| Q13 | Is `QUO-2026-0184` deliberately the same number as `PRO-2026-0184`? | New | Either `quotations` shares the proposal's sequence, or it has its own and the demo fixture is a coincidence | Assumed **shared**: the quotation inherits the proposal's allocated number |
| Q14 | Are `industry`, `audience_level`, `programmes.category` and `classification_label` controlled vocabularies? | New | Four reference tables versus four free-text columns | Free text now, reference tables later |
| Q15 | Where does `levyAvailable` come from, given HRD Corp has no API? | New | `hrdc_levy_statements` as a dated manual snapshot | Manual entry or statement upload, with an `as_of` date on the tile |
| Q16 | How is `organisations.health_score` computed, and by what? | New | `organisation_health_snapshots.components` and `model_version` | Snapshot table exists; the formula is undefined |
| Q17 | Can a participant be someone who is not a `contacts`? | New | `participants.contact_id` nullable | **Yes, nullable.** Most participants are never marketed to and PDPA consent differs |
| Q18 | Does a redacted participant's name have to be removed from an already-filed HRD Corp PDF? | New | Nothing in the schema; an operational procedure | Not attempted |
| Q19 | Jury economics: per action type, or only above a value threshold? | §17 Q2 | Resolved by §18/S2 and DECISIONS §2 | **Closed.** Gate, sample at 5%, escalate on trigger |
| Q20 | Batch windows: queue or escalate outside `allowedHours`? | §17 Q3 | `ai_tiers.batch_eligible` | Queue when batch-eligible, escalate otherwise |
| Q21 | Should key reveal exist at all, or only rotate-and-replace? | §17 Q4 | `ai_provider_keys.revealed_count` and the reveal endpoint | Reveal exists and is audited |
| Q22 | Pass-through billing: a TrainOS invoice line, or a report the client reconciles? | §17 Q5 | An `invoice_lines` item code versus a report over `ai_usage_entries` | Report only. No invoice line |
| Q23 | Is `pgvector` available and at what dimension? | New | `knowledge_chunks.embedding vector(1536)` | 1536 assumed |
| Q24 | `TRADING_HOLD` needs MD approval but §3 has no action type for it | New, via GOV-07 | A new `TRADING_HOLD_APPLY` action type, or the edge stays ungated | Gated on `DISCOUNT_APPROVE` as a placeholder, which is wrong and marked so |
| Q25 | Can one status edge be authorised by more than one action type? | New, via GOV-07 §5.2 | `state_transitions.gated_by` becomes `text[]`, or the key gains a discriminator | `outbound_messages.purpose` added here; the registry change is sb-actions' |

---

## 8 · Deviations from contract

Places where this model does not mirror the contract's JSON, and why.

1. **`attendance_entries` is one row per half-day, not an `am`/`pm` object pair.** The response shape
   (`am: {...}, pm: {...}`) is a rendering convenience. As columns it makes "how many present in the
   afternoon" a `UNION`, blocks a third session-half from ever existing, and duplicates every capture
   column. The API projection reassembles the pair.

2. **`engagements.dates[]` is not stored.** It is derived from `sessions.date`. The contract returns both
   `dates[]` and `sessions[]`; storing both guarantees they eventually disagree.

3. **`signaturesExpected` does not match its stated formula.** §15.2 gives
   `registered × sessionsInDay`; the demo renders 60 against 30 registered with **one** session
   (`SES-0461`) on day 1. 60 = 30 × 2 **halves**, not × sessions. This model computes it as
   `registered × 2` (AM and PM) and flags the contract's formula as wrong. If a day can hold three
   sessions with separate sign-in sheets, the formula and the `attendance_half` enum both need revisiting.

4. **`quotations` rather than `costing`, and the endpoint follows.** The contract's path is
   `GET /v1/costings/{id}` but the entity's `ref` is
   `QUO-`, REPORT.md calls it `Quotation`, and §18 calls it `Quotation`. One name wins; it is the ref's.

5. **`organisation_status` is not in §12.** The markdown shows `"status": "ACTIVE_CLIENT"` and the enum
   catalogue has no entry. The contract package defines it as `PROSPECT·ACTIVE_CLIENT·DORMANT`, which this
   model now follows. A lost prospect is therefore `DORMANT`; there is no `LOST` organisation state, only a
   `LOST` opportunity.

6. **`hrdc_levy_statements` is an addition.** `levyAvailable` appears on four screens with no source, and
   HRD Corp has no API (§9). A number that important cannot be a cached integer with no `as_of`.

7. **`trainer_bookings` is an addition.** §3 has `TRAINER_BOOK` and DECISIONS §1 has a 72-hour soft hold,
   but no endpoint returns a booking. Without the table, "Farah Aziz available 12–13 Nov" has nowhere to
   be false.

8. **`outbound_messages` consolidates three flows.** `FOLLOWUP_SEND`, `REMINDER_SEND` and `BROADCAST_SEND`
   return near-identical draft shapes (§4, §9). One table, one set of consent and cost columns.

9. **`warnings[]`, `submissionLog[]`, `aging`, `metrics{}`, `related[]`, `relations{}` and
   `page.total` are views, not tables.** Each is a projection of data that already exists. Storing them
   would create a second source of truth for a number a screen renders beside its source.

10. **`ai_routing_entries` is versioned by `applies_from` rather than updated.** §17 says a routing change
    applies to future runs only. An updatable row cannot honour that.

11. **Three tables share one evidence shape, and the contract already says they should.**
    `tna_evidence`, `provenance_sources` (sb-money) and `action_evidence` (sb-actions) all store
    `{type, ref, excerpt}`, and the contract package serves all three from one `EvidenceType` enum and one
    `EvidenceRef` interface. The enum is unified here. Whether the three become one `evidence` table with a
    discriminator is a **cross-lane decision**, not a unilateral one, because the rows have different
    owners and different immutability rules — but the project's consolidation rule points at one table.

12. **Enums that are reference tables, not Postgres enums.** `action_type`, `check_key`,
    `hrdc_document_type`, lifecycle step keys, `tier_key`, `metric_key`, template types and TNA constraint
    codes appear as `UPPER_SNAKE` strings in §12 and §17 alongside genuinely closed enums. Treating them
    as closed would mean a migration every time HRD Corp publishes a circular or a new action type ships.

13. **`hrdc_packet_documents` has no `REJECTED` state.** The contract package's `DocumentPresence` is
    `PRESENT·MISSING`. A document HRD Corp returns as unacceptable therefore has nowhere to be recorded
    except by flipping back to `MISSING`, which loses the reason. Recommended addition to the contract, not
    taken unilaterally.

14. **`follow_ups` has `OVERDUE`, not `SNOOZED`.** Aligned to the package. There is consequently no way to
    defer a follow-up without editing `due_date`, which is probably right but is a behaviour change worth
    naming.

15. **Tables are plural and live in `public`, not singular.** This document originally used singular
    names. `02-tenancy-auth-rls.md` was committed first with `public.<plural>` and its RLS policies name
    those tables, so this model moved rather than asking two other lanes to. Divergence is a defect, and
    the older name loses.

16. **`attendance_days` and `attendance_entries`, not `attendance_sheet` and `attendance_record`.**
    REPORT.md calls the entity `AttendanceSheet`, but sb-tenancy and sb-actions independently chose
    `attendance_days` and `attendance_entries`. Two lanes against one, and the day is what the API keys on
    (`?day=1`). Renamed here.

17. **`quotations`, not `costings`, and this is now settled.** The contract's endpoint is
    `GET /v1/costings/{id}`, and sb-tenancy's first draft said `public.costings`. The ref prefix is `QUO-`,
    REPORT.md and §18 both say `Quotation`, and sb-actions independently chose `quotations`. Ruling R-QUO
    settles it: the table is `core.quotations`, the permissions are `quotation:*`, and **the API path
    becomes `/v1/quotations`**, which is a change to the contract, not just to the schema.

18. **The §6 costing fixture does not reconcile, and the schema now says why.** Its lines sum to
    RM 11,400 against an RM 18,500 sell price, which is a 0.38 margin and not the 0.41 shown; a 0.35 margin
    floor on that cost would be RM 17,538 and not the RM 13,900 shown. Verified by sb-money. The resolution
    is two independent floors, an absolute one per pricing tier and a margin one computed from cost, with
    the higher binding. The fixture's numbers are still internally inconsistent and the contract should say
    which of them is wrong.

19. **Provenance points at the subject; this document originally had it backwards.** sb-money's C-1
    reverses the direction, and the argument is sound: a foreign key from subject to provenance cannot be
    traversed backwards, so neither of the two required queries can be labelled or cursor-paginated. The
    nine `provenance_id` columns are gone and nothing replaces them. One invariant is lost in the move.
    §17's "a deterministic check carries no model" was a column check on `compliance_check_results` and is
    now unenforceable from this side. Raised to sb-money.

20. **Money columns end `_sen`, not `_minor`.** sb-money's contributed column list uses `_sen`, so all 95
    money columns in this document were renamed to match rather than leave the fleet with two suffixes.
    One reservation, recorded rather than argued: `_sen` names the Malaysian minor unit in the column
    itself, so a second currency would make every such column a misnomer where `_minor` would not. Every
    table here still carries a `currency` column, so the data stays correct either way.

21. **`quotations.invoice_id`, not `invoices.quotation_id`.** sb-money puts the edge on the quotation
    side. Adopted, and the reverse column removed, because keeping both would be two spellings of one
    relationship.

22. **`provenance.sources` is jsonb, not a child table.** sb-money's C-2, and they name it the weakest of
    their three reversals. If sb-events or the knowledge lane ever needs to join a cited source to a real
    record, the child table this document assumed becomes correct again and it should be revisited.

23. **Domain tables are in `core`, not `public`.** The lead's ruling, following migration `001` and
    `config.toml`, which sb-actions had already adopted. `public` keeps identity and tenancy only, `app`
    keeps unexposed internals. `saved_views` stays in `public` because sb-tenancy's committed policies name
    it there, and it is the one exception in this document.

24. **The transition registry cannot express one of this model's edges.** GOV-07 keys `state_transitions`
    on `(entity, column, from, to)` with a single `gated_by`, but `outbound_messages` `DRAFT → QUEUED` is
    authorised by `FOLLOWUP_SEND`, `REMINDER_SEND` or `BROADCAST_SEND` depending on the message's purpose.
    Fail-closed means the wrong two of the three are rejected at send time. Recorded in §5.2 and raised to
    sb-actions.

25. **`trainos.unlock_action_id` is withdrawn.** Earlier revisions of this document proposed a dedicated
    transaction-local key so the attendance-lock trigger could recognise an approved unlock. Ruling R-GOV
    settles on `app.effect_applier` as the only applier key, and sb-actions is right that theirs is
    strictly stronger, because it is resolved against `action_requests` and checked for type and tenant
    rather than merely being set. The lock is still enforced twice, but by GOV-07 and rule I1 reading the
    same key rather than by two keys.

26. **`identity_no` is stored as a hash plus last four, never in full.** HRD Corp claim documentation
    needs an identity number, but this system does not need to be able to read one back. The contract does
    not mention the field at all; it will be needed the first time a real packet is assembled.

---

## 9 · What I could NOT verify

1. **Field-level optionality against the contract package.** The package landed mid-task and was
   reconciled at the **enum** level only: every value set it fixes now matches, and the divergences are in
   "Deviations". Its per-field nullability was **not** checked against the `NULL` column of every table
   here. Specifically at risk: fields the markdown shows populated in every example but the package marks
   optional, and whether `ref` is present on child entities such as `proposal_sections` and `invoice_lines`.
   The package also defines types this model has no table for (`Receivable`, `AutomationRun`,
   `MessageDraft`, `HrdcSubmissionLogEntry`) — all four are views here, which is deliberate, but worth a
   second pair of eyes.

2. **Cross-lane names are reconciled as of this revision, not guaranteed.** Table names now follow
   `02-tenancy-auth-rls.md` (committed) and the columns sb-actions asked for. `quotations` versus
   sb-tenancy's `costings` is the one name still inconsistent across the fleet, and it needs a rename in
   their doc rather than in mine. sb-money's `provenance` and rate-card table names, and sb-events'
   `domain_events` and `audit_entries`, are still this lane's guesses.

3. **Table names in the four adjacent lanes.** `tenants`, `auth.users`, `provenance`, `policies`,
   `action_requests`, `approval_requests`, `audit_entries` and `webhook_receipts` are the names used here.
   sb-tenancy, sb-actions, sb-money and sb-events may choose differently; every FK naming them is a
   placeholder to be reconciled before the migration is written.

4. **sb-actions' doc reads a column name that no longer exists.** Their reconciliation adopted
   "`floor_price_minor` as the binding value". Under R-PROV the suffix is `_sen` and under sb-money's C-4
   there is no stored floor at all: `floor_price_sen` is generated. Their gate reads the right concept from
   the wrong name. Not mine to edit, and flagged to the lead rather than re-opened.

5. **Two contradictions inside sb-money's own document, which I could not resolve from outside it.**
   Their C-3 says to keep `floor_price_minor` as this document had it, while their C-4 contributes a
   generated `floor_price_sen`. I followed C-4, because it is the authoritative column list and is
   internally consistent. Separately, the lead asked for a `binding_floor` indicator on quotations and
   C-4's list has none. Which of the two floors binds is derivable by comparing the generated columns, but
   it is not a column. Both raised to sb-money.

6. **Rate card values.** Trainer bands A/B/C and their day rates, materials per pax, commission tiers,
   margin floors and discount authority are all unknown (DECISIONS §5). `rate_card.version` still reads
   `v0-placeholder` and `quotations` snapshots the floor price rather than reading it live.

7. **Baseline minutes for hours-saved.** Requires time-and-motion sampling that has not happened
   (DECISIONS §4). The tables exist and are empty; `basis` is `ILLUSTRATIVE` until they are filled.

8. **Whether the HRD Corp rules are correct.** DECISIONS §3 states plainly that the demo's rule set was
   wrong once already. Every seeded rule is `PROPOSED` and the schema forbids `ACTIVE` without
   `verified_at`, but nobody has verified anything yet.

9. **Supabase project capabilities.** `pgvector` (for `knowledge_chunks.embedding`), `citext`, `btree_gist`
   (for the `trainer_bookings` exclusion constraint) and `pg_trgm` (for search) are all assumed available.
   `btree_gist` in particular is required for the double-booking constraint and is not enabled by default.

10. **Volume and partitioning.** No figures exist for enquiries per month, runs per day or ledger rows per
   month, so the partitioning suggestion in §5 is a shape, not a recommendation.

11. **Whether two `pipelines` rows or one covers the engagement lifecycle.** §5 shows a six-step lifecycle on
   the organisation relations panel and §8 shows a nine-step one on the engagement detail, both for an
   engagement. This model assumes two `pipelines` rows for the same object with one marked default, but it
   is equally readable as one nine-step pipeline rendered in two densities.

12. **`GET /v1/organisations/{id}/health`.** The endpoint is referenced by a `drillTo` and never specified.
    `organisation_health_snapshots` is a guess at its shape.
