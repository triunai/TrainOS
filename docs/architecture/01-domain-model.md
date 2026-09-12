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
| §1 conventions | `provenance`*, `provenance_source`*, `idempotency_key`*, `ref_sequence`, `ref_format` |
| §2 shell | `saved_view`, `template`, `template_section`, `pipeline`, `pipeline_step`, `policy`*, `audit_entry`* |
| §3 actions | `action_request`*, `action_effect`*, `action_draft`*, `action_evidence`* |
| §4 enquiries | `enquiry`, `enquiry_extraction_field`, `follow_up`, `outbound_message`, `message_rate`, `contact_consent` |
| §5 orgs | `organisation`, `organisation_health_snapshot`, `contact`, `opportunity`, `organisation_suggestion` |
| §6 TNA/catalogue | `tna`, `tna_constraint`, `tna_gap`, `tna_evidence`, `tna_recommendation`, `programme`, `programme_module`, `programme_pricing_tier`, `programme_material`, `programme_trainer`, `trainer`, `trainer_availability`, `trainer_booking`, `proposal`, `proposal_section`, `quotation`, `quotation_line` |
| §7 approvals | `approval_request`*, `approval_decision`*, `approval_evidence`*, `approval_diff_entry`* |
| §8 delivery | `engagement`, `engagement_step_state`, `engagement_checklist_item`, `session`, `participant`, `attendance_sheet`, `attendance_record`, `certificate`, `evaluation_response`, `signature`, `attachment` |
| §9 compliance + finance | `hrdc_packet`, `hrdc_packet_document`, `hrdc_levy_statement`, `invoice`, `invoice_line`, `invoice_sync_log`, `payment`, `collections_case`, `collection_rule` |
| §10 AI-ops | `agent`, `autonomy_grant`, `agent_run`, `agent_run_step`, `agent_run_guardrail`, `eval_set`, `eval_run`, `metric_definition`, `hours_saved_baseline_table`, `hours_saved_baseline` |
| §11 portal | `proposal_share_token`, `proposal_comment`, `proposal_acceptance`, `tna_share_token`, `webhook_receipt`* |
| §17 AI ops update | `ai_tier`, `ai_routing_entry`, `ai_provider_key`, `ai_provider_key_tier`, `ai_usage_ledger`, `ai_budget`, `agent_run_node`, `agent_run_event`, `agent_run_state_card`, `agent_checkpoint`, `jury_vote`, `compliance_rule`, `rule_set_version`, `rule_change_set`, `rule_change`, `rule_change_affected_engagement`, `compliance_check_result`, `compliance_version_drift`, `knowledge_source`, `knowledge_chunk` |

`*` = named by another lane, listed for completeness and referenced by FK only. Not designed here.

### Supersedes applied (§18 and DECISIONS.md)

| # | Superseded text | What the schema does instead |
|---|---|---|
| S1 | §17 "checks resolve rules **as at the training date**" | Grant-side rules resolve at **grant submission**, claim-side at **claim submission** (DECISIONS §6). `engagement.grant_rule_set_version_id` is pinned at grant submission; `hrdc_packet.claim_rule_set_version_id` at claim submission. `compliance_check_result` stores the version it applied; `compliance_version_drift` records a warning citing both versions rather than switching silently. Checks re-evaluate at every stage transition. |
| S2 | §17 `jury: { enabled: true, quorum, of, tiers }` (boolean-shaped) | `ai_routing_entry.jury` is an object: `mode ∈ GATE·SAMPLE·ESCALATE`, `quorum`, `of`, `tiers[]`, `sampleRate`, `triggers{minConfidence,maxValue,firstOfKind}` (§18, DECISIONS §2). `jury_vote` rows carry `blocking bool` so `SAMPLE` votes are recorded for drift without being decision inputs. |
| S3 | §16.10 "does the line unit derive from the total, or the total from the lines?" | **Total-from-lines**, integer sen, each line rounded half-up before summing, SST on the summed net (§18, DECISIONS §7). A package price is one line at `qty = 1`. Per-pax is display-only and has **no column** on `invoice_line` or `quotation_line`. A reconciliation trigger rejects a total that is not the sum of rounded lines. |
| S4 | §6 `costing.rateCardYear: 2026` (a year) | `quotation.rate_card_version text not null default 'v0-placeholder'` (§18, DECISIONS §5). Year is not a version. Rate card tables themselves belong to **sb-money**. |
| S5 | §10 `ADMIN_HOURS_SAVED` as a bare number | `hours_saved_baseline_table` (versioned, per tenant) + `hours_saved_baseline` (per action type). Reports carry `basis ∈ MEASURED·ILLUSTRATIVE` and `haircut` (0.7 for the first quarter). The tile may not render a bare number (§18, DECISIONS §4). |
| S6 | DECISIONS §3: the demo's **five-working-day claim window** | Deleted. Claim window is `claim_submitted ≤ training_completion + 6 months`. All HRD Corp offsets are **calendar days**. The "apply before Friday 5 PM" heuristic is not a rule — it is a `WARN` check with no `compliance_rule` row. Seeded rules load as `PROPOSED` until Finance verifies them against the circular. |
| S7 | §12 `AutonomyLevel` as a free grant | `autonomy_grant` carries both `level` and `ceiling` with `ceiling_reason`. DECISIONS §1 launch defaults seed the table; anything money-moving, client-committing or HRDC-touching has `ceiling = ACT_WITH_APPROVAL`, enforced by a check constraint, not by application code. |

---

## Conventions

### Every table carries this and it is not repeated below

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `tenant_id` | `uuid` | no | — | FK → `tenant(id)` `ON DELETE RESTRICT`. Owned by **sb-tenancy** |
| `ref` | `text` | no | allocated | Human reference, see below. Omitted on line/child/log/config tables (noted per table) |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | Maintained by a shared `set_updated_at()` `BEFORE UPDATE` trigger |
| `created_by_kind` | `actor_kind` | no | — | `HUMAN·AGENT·SYSTEM·CLIENT` |
| `created_by_id` | `text` | no | — | `u_amirah`, `agent_proposal`, `ingest_email`. Text, not a FK: agents and system principals are not rows in `app_user` |
| `created_by_name` | `text` | yes | — | Denormalised display name, frozen at write time |

Plus, on every table: `UNIQUE (tenant_id, id)` and `UNIQUE (tenant_id, ref)` where `ref` exists.

**Composite tenant-safe foreign keys.** Every FK in this model is composite:
`FOREIGN KEY (tenant_id, parent_id) REFERENCES parent (tenant_id, id)`. A cross-tenant reference is then
unrepresentable at the storage layer, independently of whatever RLS **sb-tenancy** writes. The ERD shows
the logical FK column only; read every one as carrying `tenant_id` alongside it.

**Provenance.** Any AI-touched field or record carries `provenance_id uuid NULL REFERENCES provenance(id)`.
`NULL` means human-authored, which matches §1 ("absent means human-authored"). The `provenance` and
`provenance_source` tables are **sb-money**'s. Where a single row needs provenance on more than one field
(the enquiry extraction, the proposal section), the field is split into its own row rather than given a
second provenance column.

### Money

Two columns per amount: `<name>_minor bigint` and one `currency char(3) NOT NULL DEFAULT 'MYR'` per table.
No composite type and no `numeric`. Rationale: composite types round-trip badly through PostgREST and
produce unusable generated TypeScript; integer sen is the §1 and §18 requirement; a per-table currency
column is honest for a single-currency launch and can be promoted to per-column later without a rewrite.
`CHECK (<name>_minor >= 0)` wherever the contract admits no negative.

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
`approval_decision`, `approval_status`, `urgency_group`, `risk_level`, `lifecycle_state`,
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

Strategy: a `ref_format` table (prefix, `dated bool`, `width`) and a `ref_sequence` counter table keyed
`(tenant_id, prefix, period)` where `period` is the four-digit year for dated prefixes and `'-'` otherwise.
Allocation is a `SECURITY DEFINER` function `next_ref(prefix text)` doing a single
`INSERT … ON CONFLICT (tenant_id, prefix, period) DO UPDATE SET next_value = ref_sequence.next_value + 1 RETURNING`.
That serialises per prefix per tenant, not globally, and holds the row lock for microseconds.

Refs are **not gapless**: a rolled-back transaction burns a number. That is fine for every prefix except
`INV-`, where Malaysian tax-invoice numbering is conventionally expected to be sequential and unexplained
gaps are an audit question. Open question Q12 below.

Refs are allocated by a `BEFORE INSERT` trigger, are immutable after insert (`enforce_immutable_columns`),
and are never a primary key — `id` is. The API exposes both because §1 does.

### Timestamps and dates

`timestamptz` everywhere, stored UTC, rendered `+08:00`. Date-only contract fields (`dueAt: "2026-12-14"`,
`dates: ["2026-11-12","2026-11-13"]`, `effectiveFrom`) are `date`. The `dates[]` array on an engagement is
**not** an array column — it is derived from `session.date`, because the sessions exist anyway and two
sources of truth for delivery dates is exactly the divergence the project rules forbid.

### JSONB, and where it is allowed

JSONB is allowed only where the contract's own shape is open-ended and never filtered on in SQL:
`compliance_rule.expression`, `compliance_check_result.computed`, `agent_run_step.args/result`,
`agent_run_event.detail`, `ai_routing_entry.jury`, `saved_view.filters`, `agent.resume_condition`,
`hrdc_packet_document.meta`. Everything a screen filters, sorts or groups by is a column.

---

## 1 · Bounded contexts

Six contexts. A table lives in exactly one. Cross-context references are always by `id` FK, never by
duplicated data, with two declared exceptions (`created_by_name` and `organisation_name` on the client
portal projection) where the value must be frozen at write time.

### Sales
Owns the path from an inbound message to a signed proposal.

`organisation` · `organisation_health_snapshot` · `contact` · `contact_consent` · `enquiry` ·
`enquiry_extraction_field` · `opportunity` · `organisation_suggestion` · `follow_up` · `tna` ·
`tna_constraint` · `tna_gap` · `tna_evidence` · `tna_recommendation` · `tna_share_token` · `proposal` ·
`proposal_section` · `proposal_share_token` · `proposal_comment` · `proposal_acceptance` · `quotation` ·
`quotation_line`

### Delivery
Owns the catalogue and everything that happens between a won deal and a closed engagement.

`programme` · `programme_module` · `programme_pricing_tier` · `programme_material` · `programme_trainer` ·
`trainer` · `trainer_availability` · `trainer_booking` · `engagement` · `engagement_step_state` ·
`engagement_checklist_item` · `session` · `participant` · `attendance_sheet` · `attendance_record` ·
`certificate` · `evaluation_response` · `outbound_message` · `message_rate`

The catalogue sits in Delivery, not Sales, because `PUT /v1/programmes/{id}` is ADMIN + L&D and returns
`FORBIDDEN` to SALES (§6). Sales reads it; Delivery owns it.

### Compliance
Owns HRD Corp state, the rule registry and the knowledge corpus the rules are extracted from.

`hrdc_packet` · `hrdc_packet_document` · `hrdc_levy_statement` · `compliance_rule` · `rule_set_version` ·
`rule_change_set` · `rule_change` · `rule_change_affected_engagement` · `compliance_check_result` ·
`compliance_version_drift` · `knowledge_source` · `knowledge_chunk`

### Finance
Owns receivables and the accounting-package boundary. TrainOS does not e-invoice; MyInvois validation is
mirrored in, never originated (§9).

`invoice` · `invoice_line` · `invoice_sync_log` · `payment` · `collections_case` · `collection_rule`

Rate cards, floor prices as policy, commission schedules and the rounding rules are **sb-money**'s.
`quotation` and `invoice` live here structurally but their money columns obey sb-money's semantics.

### AI-ops
Owns agents, runs, model routing, spend and evaluation.

`agent` · `autonomy_grant` · `agent_run` · `agent_run_step` · `agent_run_node` · `agent_run_event` ·
`agent_run_state_card` · `agent_run_guardrail` · `agent_checkpoint` · `jury_vote` · `eval_set` ·
`eval_run` · `ai_tier` · `ai_routing_entry` · `ai_provider_key` · `ai_provider_key_tier` ·
`ai_usage_ledger` · `ai_budget`

`autonomy_grant` lives here because it is the agent registry screen's data (M18-S01), but it is an **input
to sb-actions' policy gate**. sb-actions reads it; AI-ops writes it. The `policy` table itself is sb-actions'.

### Shell / Platform
Cross-cutting, tenant-scoped configuration and shared primitives.

`saved_view` · `template` · `template_section` · `pipeline` · `pipeline_step` · `metric_definition` ·
`hours_saved_baseline_table` · `hours_saved_baseline` · `attachment` · `signature` · `ref_format` ·
`ref_sequence`

Referenced, owned elsewhere: `tenant`, `app_user`, `membership` (sb-tenancy); `policy`, `action_request`,
`action_effect`, `action_evidence`, `action_draft`, `approval_request`, `approval_decision`,
`approval_evidence`, `approval_diff_entry`, `idempotency_key` (sb-actions); `provenance`,
`provenance_source`, `rate_card*` (sb-money); `domain_event`, `outbox`, `audit_entry`, `webhook_receipt`
(sb-events).

---

## 2 · ERD

`tenant_id` is on every table and every FK is composite `(tenant_id, parent_id)`. Edges to `tenant` are
omitted from the diagram — eighty-nine of them would render the rest unreadable — and the composite-FK
convention above is what the migration author implements. Tables owned by other lanes appear with their
name suffixed `__ext` so the migration author does not create them.

```mermaid
erDiagram
    %% ---------- Shell / Platform ----------
    tenant__ext {
        uuid id PK
    }
    saved_view {
        uuid id PK
        uuid tenant_id FK
        uuid owner_user_id FK
        text object
    }
    template {
        uuid id PK
        uuid tenant_id FK
        text type
        int version
    }
    template_section {
        uuid id PK
        uuid template_id FK
        int n
    }
    pipeline {
        uuid id PK
        text object
    }
    pipeline_step {
        uuid id PK
        uuid pipeline_id FK
        text step_key
        int position
    }
    metric_definition {
        uuid id PK
        text metric_key
    }
    hours_saved_baseline_table {
        uuid id PK
        text version
    }
    hours_saved_baseline {
        uuid id PK
        uuid baseline_table_id FK
        text action_type FK
    }
    attachment {
        uuid id PK
        text storage_path
    }
    signature {
        uuid id PK
        uuid attachment_id FK
    }
    ref_format {
        uuid id PK
        text prefix UK
    }
    ref_sequence {
        uuid id PK
        text prefix FK
        text period
    }
    action_type__ref {
        uuid id PK
        text action_type UK
    }

    %% ---------- Other lanes ----------
    provenance__ext {
        uuid id PK
        uuid run_id FK
    }
    policy__ext {
        uuid id PK
        text policy_key UK
    }
    action_request__ext {
        uuid id PK
        text action_type FK
        uuid policy_id FK
    }
    approval_request__ext {
        uuid id PK
        uuid action_request_id FK
        uuid policy_id FK
    }
    audit_entry__ext {
        uuid id PK
    }

    %% ---------- Sales ----------
    organisation {
        uuid id PK
        uuid owner_user_id FK
    }
    organisation_health_snapshot {
        uuid id PK
        uuid organisation_id FK
    }
    contact {
        uuid id PK
        uuid organisation_id FK
    }
    contact_consent {
        uuid id PK
        uuid contact_id FK
    }
    enquiry {
        uuid id PK
        uuid matched_organisation_id FK
        uuid matched_contact_id FK
        uuid assigned_to_user_id FK
        uuid provenance_id FK
    }
    enquiry_extraction_field {
        uuid id PK
        uuid enquiry_id FK
        uuid provenance_id FK
    }
    opportunity {
        uuid id PK
        uuid organisation_id FK
        uuid primary_contact_id FK
        uuid source_enquiry_id FK
        uuid owner_user_id FK
    }
    organisation_suggestion {
        uuid id PK
        uuid organisation_id FK
        uuid programme_id FK
        uuid provenance_id FK
    }
    follow_up {
        uuid id PK
        uuid organisation_id FK
        uuid contact_id FK
        uuid proposal_id FK
        uuid invoice_id FK
    }
    tna {
        uuid id PK
        uuid opportunity_id FK
        uuid questionnaire_template_id FK
    }
    tna_share_token {
        uuid id PK
        uuid tna_id FK
    }
    tna_constraint {
        uuid id PK
        uuid tna_id FK
    }
    tna_gap {
        uuid id PK
        uuid tna_id FK
        uuid provenance_id FK
    }
    tna_evidence {
        uuid id PK
        uuid tna_id FK
    }
    tna_recommendation {
        uuid id PK
        uuid tna_id FK
        uuid programme_id FK
        uuid provenance_id FK
    }
    proposal {
        uuid id PK
        uuid opportunity_id FK
        uuid template_id FK
        uuid programme_id FK
        uuid run_id FK
    }
    proposal_section {
        uuid id PK
        uuid proposal_id FK
        uuid provenance_id FK
    }
    proposal_share_token {
        uuid id PK
        uuid proposal_id FK
    }
    proposal_comment {
        uuid id PK
        uuid proposal_id FK
        uuid contact_id FK
    }
    proposal_acceptance {
        uuid id PK
        uuid proposal_id FK
        uuid signature_id FK
        uuid engagement_id FK
    }
    quotation {
        uuid id PK
        uuid proposal_id FK
        uuid supersedes_quotation_id FK
    }
    quotation_line {
        uuid id PK
        uuid quotation_id FK
    }

    %% ---------- Delivery ----------
    programme {
        uuid id PK
    }
    programme_module {
        uuid id PK
        uuid programme_id FK
    }
    programme_pricing_tier {
        uuid id PK
        uuid programme_id FK
    }
    programme_material {
        uuid id PK
        uuid programme_id FK
    }
    trainer {
        uuid id PK
    }
    programme_trainer {
        uuid id PK
        uuid programme_id FK
        uuid trainer_id FK
    }
    trainer_availability {
        uuid id PK
        uuid trainer_id FK
    }
    trainer_booking {
        uuid id PK
        uuid trainer_id FK
        uuid engagement_id FK
    }
    engagement {
        uuid id PK
        uuid organisation_id FK
        uuid opportunity_id FK
        uuid programme_id FK
        uuid proposal_id FK
        uuid owner_user_id FK
        uuid pipeline_id FK
        uuid grant_rule_set_version_id FK
    }
    engagement_step_state {
        uuid id PK
        uuid engagement_id FK
        uuid pipeline_step_id FK
    }
    engagement_checklist_item {
        uuid id PK
        uuid engagement_id FK
    }
    session {
        uuid id PK
        uuid engagement_id FK
        uuid trainer_id FK
    }
    participant {
        uuid id PK
        uuid engagement_id FK
        uuid contact_id FK
    }
    attendance_sheet {
        uuid id PK
        uuid engagement_id FK
        uuid approved_by_user_id FK
    }
    attendance_record {
        uuid id PK
        uuid attendance_sheet_id FK
        uuid participant_id FK
        uuid signature_id FK
    }
    certificate {
        uuid id PK
        uuid participant_id FK
        uuid engagement_id FK
        uuid attachment_id FK
    }
    evaluation_response {
        uuid id PK
        uuid engagement_id FK
        uuid participant_id FK
    }
    outbound_message {
        uuid id PK
        uuid contact_id FK
        uuid template_id FK
        uuid follow_up_id FK
        uuid invoice_id FK
        uuid provenance_id FK
    }
    message_rate {
        uuid id PK
    }

    %% ---------- Compliance ----------
    hrdc_packet {
        uuid id PK
        uuid engagement_id FK
        uuid organisation_id FK
        uuid claim_rule_set_version_id FK
    }
    hrdc_packet_document {
        uuid id PK
        uuid hrdc_packet_id FK
        uuid attachment_id FK
        text document_type FK
    }
    hrdc_levy_statement {
        uuid id PK
        uuid organisation_id FK
        uuid attachment_id FK
    }
    rule_set_version {
        uuid id PK
    }
    compliance_rule {
        uuid id PK
        uuid rule_set_version_id FK
        uuid supersedes_rule_id FK
        uuid superseded_by_rule_id FK
        uuid knowledge_source_id FK
        uuid provenance_id FK
    }
    rule_change_set {
        uuid id PK
        uuid knowledge_source_id FK
        uuid run_id FK
    }
    rule_change {
        uuid id PK
        uuid rule_change_set_id FK
        uuid target_rule_id FK
        uuid new_rule_id FK
    }
    rule_change_affected_engagement {
        uuid id PK
        uuid rule_change_id FK
        uuid engagement_id FK
    }
    compliance_check_result {
        uuid id PK
        uuid engagement_id FK
        uuid compliance_rule_id FK
        uuid rule_set_version_id FK
        text check_key FK
        uuid provenance_id FK
    }
    compliance_version_drift {
        uuid id PK
        uuid compliance_check_result_id FK
        uuid applied_version_id FK
        uuid current_version_id FK
    }
    knowledge_source {
        uuid id PK
        uuid attachment_id FK
    }
    knowledge_chunk {
        uuid id PK
        uuid knowledge_source_id FK
    }
    check_key__ref {
        uuid id PK
        text check_key UK
    }
    hrdc_document_type__ref {
        uuid id PK
        text document_type UK
    }

    %% ---------- Finance ----------
    invoice {
        uuid id PK
        uuid organisation_id FK
        uuid engagement_id FK
        uuid quotation_id FK
    }
    invoice_line {
        uuid id PK
        uuid invoice_id FK
    }
    invoice_sync_log {
        uuid id PK
        uuid invoice_id FK
    }
    payment {
        uuid id PK
        uuid invoice_id FK
    }
    collections_case {
        uuid id PK
        uuid invoice_id FK
        uuid organisation_id FK
    }
    collection_rule {
        uuid id PK
        uuid template_id FK
    }

    %% ---------- AI-ops ----------
    agent {
        uuid id PK
        text agent_key
        text default_tier_key FK
    }
    autonomy_grant {
        uuid id PK
        uuid agent_id FK
        text action_type FK
    }
    agent_run {
        uuid id PK
        uuid agent_id FK
        uuid parent_run_id FK
        text tier_key FK
    }
    agent_run_step {
        uuid id PK
        uuid agent_run_id FK
        uuid approval_request_id FK
    }
    agent_run_node {
        uuid id PK
        uuid agent_run_id FK
        uuid parent_node_id FK
        text tier_key FK
    }
    agent_run_event {
        uuid id PK
        uuid agent_run_id FK
        uuid agent_run_node_id FK
    }
    agent_run_state_card {
        uuid id PK
        uuid agent_run_id FK
    }
    agent_run_guardrail {
        uuid id PK
        uuid agent_run_id FK
    }
    agent_checkpoint {
        uuid id PK
        uuid agent_run_id FK
    }
    jury_vote {
        uuid id PK
        uuid agent_run_event_id FK
        text tier_key FK
    }
    eval_set {
        uuid id PK
    }
    eval_run {
        uuid id PK
        uuid agent_id FK
        uuid eval_set_id FK
        text action_type FK
    }
    ai_tier {
        uuid id PK
        text tier_key UK
    }
    ai_routing_entry {
        uuid id PK
        text action_type FK
        text tier_key FK
    }
    ai_provider_key {
        uuid id PK
    }
    ai_provider_key_tier {
        uuid id PK
        uuid ai_provider_key_id FK
        text tier_key FK
    }
    ai_usage_ledger {
        uuid id PK
        uuid agent_run_id FK
        text tier_key FK
        uuid agent_id FK
        text action_type FK
    }
    ai_budget {
        uuid id PK
        uuid raised_by_action_id FK
    }

    %% ---------- Sales relationships ----------
    organisation ||--o{ contact : "employs"
    organisation ||--o{ opportunity : "sources"
    organisation ||--o{ organisation_health_snapshot : "scored by"
    organisation ||--o{ organisation_suggestion : "offered"
    organisation ||--o{ follow_up : "subject of"
    organisation ||--o{ engagement : "buys"
    organisation ||--o{ invoice : "billed"
    organisation ||--o{ hrdc_levy_statement : "declares"
    organisation ||--o{ collections_case : "owes"
    organisation |o--o{ enquiry : "matched to"
    contact ||--o{ contact_consent : "grants"
    contact |o--o{ enquiry : "sent"
    contact |o--o{ opportunity : "primary for"
    contact ||--o{ follow_up : "chased"
    contact ||--o{ proposal_comment : "writes"
    contact ||--o{ outbound_message : "receives"
    contact |o--o{ participant : "attends as"
    enquiry ||--o{ enquiry_extraction_field : "extracted into"
    enquiry |o--o| opportunity : "converts to"
    opportunity |o--o| tna : "qualified by"
    opportunity ||--o{ proposal : "priced by"
    opportunity |o--o| engagement : "won as"
    tna ||--o{ tna_constraint : "limited by"
    tna ||--o{ tna_gap : "identifies"
    tna ||--o{ tna_evidence : "cites"
    tna ||--o{ tna_recommendation : "ranks"
    tna |o--o| tna_share_token : "shared by"
    proposal ||--o{ proposal_section : "composed of"
    proposal ||--o{ proposal_share_token : "shared by"
    proposal ||--o{ proposal_comment : "discussed in"
    proposal |o--o| proposal_acceptance : "accepted by"
    proposal ||--o{ quotation : "costed by"
    proposal ||--o{ follow_up : "prompts"
    quotation ||--o{ quotation_line : "itemised by"
    quotation |o--o| quotation : "supersedes"
    proposal_acceptance |o--|| signature : "signed with"
    proposal_acceptance |o--o| engagement : "creates"

    %% ---------- Delivery relationships ----------
    programme ||--o{ programme_module : "taught as"
    programme ||--o{ programme_pricing_tier : "priced by"
    programme ||--o{ programme_material : "supported by"
    programme ||--o{ programme_trainer : "delivered by"
    programme ||--o{ tna_recommendation : "recommended in"
    programme ||--o{ proposal : "proposed in"
    programme ||--o{ engagement : "delivered as"
    programme ||--o{ organisation_suggestion : "cross-sold as"
    trainer ||--o{ programme_trainer : "certified for"
    trainer ||--o{ trainer_availability : "declares"
    trainer ||--o{ trainer_booking : "held by"
    trainer ||--o{ session : "facilitates"
    engagement ||--o{ trainer_booking : "reserves"
    engagement ||--o{ engagement_step_state : "progresses through"
    engagement ||--o{ engagement_checklist_item : "gated by"
    engagement ||--o{ session : "scheduled as"
    engagement ||--o{ participant : "registers"
    engagement ||--o{ attendance_sheet : "records"
    engagement ||--o{ certificate : "issues"
    engagement ||--o{ evaluation_response : "evaluated by"
    engagement ||--o{ invoice : "billed as"
    engagement |o--o| hrdc_packet : "claimed via"
    engagement ||--o{ compliance_check_result : "checked by"
    engagement ||--o{ rule_change_affected_engagement : "impacted by"
    pipeline ||--o{ pipeline_step : "ordered as"
    pipeline ||--o{ engagement : "configures"
    pipeline_step ||--o{ engagement_step_state : "instantiated as"
    attendance_sheet ||--o{ attendance_record : "lists"
    participant ||--o{ attendance_record : "marked in"
    participant ||--o{ evaluation_response : "submits"
    participant |o--o| certificate : "awarded"
    attendance_record |o--o| signature : "signed with"
    template ||--o{ template_section : "structured as"
    template ||--o{ proposal : "rendered from"
    template ||--o{ tna : "questionnaire for"
    template ||--o{ outbound_message : "rendered from"
    template ||--o{ collection_rule : "renders"
    template ||--o{ certificate : "renders"
    message_rate ||--o{ outbound_message : "prices"
    follow_up ||--o{ outbound_message : "sends"

    %% ---------- Compliance relationships ----------
    hrdc_packet ||--o{ hrdc_packet_document : "requires"
    hrdc_document_type__ref ||--o{ hrdc_packet_document : "types"
    attachment ||--o{ hrdc_packet_document : "stores"
    attachment ||--o{ certificate : "stores"
    attachment ||--o{ knowledge_source : "stores"
    attachment ||--o{ hrdc_levy_statement : "stores"
    attachment ||--o| signature : "stores"
    rule_set_version ||--o{ compliance_rule : "versions"
    rule_set_version ||--o{ engagement : "pinned at grant"
    rule_set_version ||--o{ hrdc_packet : "pinned at claim"
    rule_set_version ||--o{ compliance_check_result : "applied by"
    compliance_rule |o--o| compliance_rule : "supersedes"
    compliance_rule ||--o{ compliance_check_result : "evaluated by"
    compliance_rule ||--o{ rule_change : "targeted by"
    check_key__ref ||--o{ compliance_check_result : "keys"
    compliance_check_result ||--o{ compliance_version_drift : "warns via"
    knowledge_source ||--o{ knowledge_chunk : "chunked into"
    knowledge_source ||--o{ compliance_rule : "cited by"
    knowledge_source |o--o| rule_change_set : "proposes"
    rule_change_set ||--o{ rule_change : "contains"
    rule_change ||--o{ rule_change_affected_engagement : "affects"

    %% ---------- Finance relationships ----------
    invoice ||--o{ invoice_line : "itemised by"
    invoice ||--o{ invoice_sync_log : "synced via"
    invoice ||--o{ payment : "settled by"
    invoice |o--o| collections_case : "chased by"
    invoice ||--o{ follow_up : "prompts"
    invoice ||--o{ outbound_message : "reminded by"
    quotation |o--o{ invoice : "billed from"

    %% ---------- AI-ops relationships ----------
    agent ||--o{ autonomy_grant : "granted"
    agent ||--o{ agent_run : "executes"
    agent ||--o{ eval_run : "scored by"
    eval_set ||--o{ eval_run : "measured against"
    agent_run ||--o{ agent_run_step : "traced as"
    agent_run ||--o{ agent_run_node : "traced as"
    agent_run ||--o{ agent_run_event : "emits"
    agent_run ||--o{ agent_run_guardrail : "bound by"
    agent_run ||--o{ agent_checkpoint : "resumable at"
    agent_run |o--o| agent_run_state_card : "summarised by"
    agent_run |o--o{ agent_run : "replays"
    agent_run ||--o{ ai_usage_ledger : "bills"
    agent_run ||--o{ provenance__ext : "justifies"
    agent_run ||--o{ proposal : "drafts"
    agent_run |o--o{ rule_change_set : "extracts"
    agent_run_node |o--o{ agent_run_node : "parents"
    agent_run_event ||--o{ jury_vote : "records"
    agent_run_step |o--o| approval_request__ext : "halted by"
    ai_tier ||--o{ ai_routing_entry : "routes"
    ai_tier ||--o{ agent_run_node : "serves"
    ai_tier ||--o{ agent_run : "serves"
    ai_tier ||--o{ ai_provider_key_tier : "keyed by"
    ai_tier ||--o{ jury_vote : "votes as"
    ai_tier ||--o{ ai_usage_ledger : "bills"
    ai_tier ||--o| agent : "defaults for"
    ai_provider_key ||--o{ ai_provider_key_tier : "scoped to"

    %% ---------- Cross-cutting ----------
    action_type__ref ||--o{ autonomy_grant : "keys"
    action_type__ref ||--o{ ai_routing_entry : "keys"
    action_type__ref ||--o{ action_request__ext : "keys"
    action_type__ref ||--o{ hours_saved_baseline : "keys"
    action_type__ref ||--o{ eval_run : "keys"
    action_type__ref ||--o{ ai_usage_ledger : "keys"
    hours_saved_baseline_table ||--o{ hours_saved_baseline : "versions"
    policy__ext ||--o{ action_request__ext : "gates"
    policy__ext ||--o{ approval_request__ext : "raises"
    action_request__ext |o--o{ ai_budget : "raises cap for"
    action_request__ext |o--o{ quotation : "approves discount on"
    action_request__ext |o--o| approval_request__ext : "queues"
    ref_format ||--o{ ref_sequence : "formats"
    provenance__ext ||--o{ enquiry : "attests"
    provenance__ext ||--o{ enquiry_extraction_field : "attests"
    provenance__ext ||--o{ tna_gap : "attests"
    provenance__ext ||--o{ tna_recommendation : "attests"
    provenance__ext ||--o{ proposal_section : "attests"
    provenance__ext ||--o{ organisation_suggestion : "attests"
    provenance__ext ||--o{ compliance_rule : "attests"
    provenance__ext ||--o{ compliance_check_result : "attests"
    provenance__ext ||--o{ outbound_message : "attests"
    tenant__ext ||--o{ organisation : "scopes everything"
```

Five tables appear with no edges, which is correct rather than an omission: `saved_view` and
`metric_definition` reference only `app_user` and nothing else; `audit_entry__ext` belongs to sb-events and
references every record polymorphically, so drawing it would connect it to every table in the model.

---

## 3 · Tables

The eight universal columns from "Conventions" are omitted from every table below. `→` means
`REFERENCES`. On-delete behaviour is stated per FK; the default across this model is `RESTRICT`, because
the contract has no entity whose disappearance should silently remove another, and because HRD Corp and
tax retention make cascading deletes an audit liability.

### 3.1 Sales

#### `organisation` — §5, M04-S02

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `name` | `text` | no | — | |
| `industry` | `text` | yes | — | Open set (`MANUFACTURING`); not in §12. Reference table deferred, see Q14 |
| `location` | `text` | yes | — | |
| `owner_user_id` | `uuid` | no | — | → `app_user` `ON DELETE RESTRICT` |
| `status` | `organisation_status` | no | `'PROSPECT'` | `PROSPECT·ACTIVE_CLIENT·DORMANT` — absent from §12, defined by the contract package |
| `hrdc_registered` | `boolean` | no | `false` | |
| `hrdc_employer_code` | `text` | yes | — | `HRDC-2201-8834` |
| `proposal_count` | `integer` | no | `0` | Denormalised, answers §16.3 `firstProposalToOrg` in O(1) |
| `first_proposal_sent_at` | `timestamptz` | yes | — | Set once, on the first `PROPOSAL_SEND` that executes |
| `health_score` | `smallint` | yes | — | Latest value from `organisation_health_snapshot`, denormalised for the header |
| `archived_at` | `timestamptz` | yes | — | Soft archive, see §5 |

- **Unique:** `(tenant_id, hrdc_employer_code) WHERE hrdc_employer_code IS NOT NULL`.
- **Indexes:** `(tenant_id, owner_user_id)`; `(tenant_id, status)`; GIN trigram on `(tenant_id, name)` for ⌘K search (§2).
- **Checks:** `health_score BETWEEN 0 AND 100`; `hrdc_registered = false OR hrdc_employer_code IS NOT NULL`.
- **Not stored:** `metrics.lifetimeValue`, `openPipeline`, `arOverdue`, `hrdcLevyAvailable` and every `drillTo`. They are a view (`v_organisation_metrics`) plus `metric_definition` rows. Storing them would give the header a second source of truth against the invoice and opportunity tables.

#### `organisation_health_snapshot` — §5 `GET /organisations/{id}/health`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `organisation_id` | `uuid` | no | — | → `organisation` `ON DELETE CASCADE` |
| `score` | `smallint` | no | — | 0–100 |
| `components` | `jsonb` | no | `'{}'` | Contributing factors, shape owned by the scoring model |
| `computed_at` | `timestamptz` | no | `now()` | |
| `model_version` | `text` | no | — | |

No `ref`. **Index:** `(tenant_id, organisation_id, computed_at DESC)`. Append-only.

#### `contact` — §5

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `organisation_id` | `uuid` | no | — | → `organisation` `ON DELETE RESTRICT` |
| `name` | `text` | no | — | |
| `job_title` | `text` | yes | — | `role` in the contract; renamed to avoid colliding with `app_role` |
| `email` | `citext` | yes | — | |
| `phone` | `text` | yes | — | E.164 |
| `is_primary` | `boolean` | no | `false` | |
| `pdpa_flag` | `text` | yes | — | `NO_CONSENT`; derived from `contact_consent`, cached for the relations panel |
| `redacted_at` | `timestamptz` | yes | — | PDPA erasure, see §5 |

- **Unique:** one primary per organisation — `(tenant_id, organisation_id) WHERE is_primary` as a partial unique index; `(tenant_id, organisation_id, lower(email)) WHERE email IS NOT NULL AND redacted_at IS NULL`.
- **Indexes:** `(tenant_id, organisation_id)`; GIN trigram on `name`.
- **Checks:** `email IS NOT NULL OR phone IS NOT NULL`.

#### `contact_consent` — §4, §5, `GET /contacts/{id}/consent`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `contact_id` | `uuid` | no | — | → `contact` `ON DELETE CASCADE` |
| `channel` | `enquiry_channel` | no | — | Reuses the channel enum: `EMAIL·WHATSAPP·WEB_FORM·PHONE` |
| `granted` | `boolean` | no | — | |
| `recorded_at` | `timestamptz` | no | — | |
| `source` | `text` | yes | — | How consent was captured |
| `withdrawn_at` | `timestamptz` | yes | — | |

No `ref`. **Unique:** `(tenant_id, contact_id, channel, recorded_at)` — the table is an append-only consent ledger, not a mutable flag, because PDPA requires the history. Current state is a view (`v_contact_consent_current`).

#### `enquiry` — §4, M03-S01/S02

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
| `estimated_value_minor` | `bigint` | yes | — | |
| `currency` | `char(3)` | no | `'MYR'` | |
| `matched_organisation_id` | `uuid` | yes | — | → `organisation` `ON DELETE SET NULL` |
| `matched_contact_id` | `uuid` | yes | — | → `contact` `ON DELETE SET NULL` |
| `match_reason` | `organisation_match_reason` | yes | — | `EXACT_DOMAIN·FUZZY_NAME·MANUAL` |
| `assigned_to_user_id` | `uuid` | yes | — | → `app_user` `ON DELETE SET NULL` |
| `provenance_id` | `uuid` | yes | — | → `provenance` — attests the classification |
| `external_message_id` | `text` | yes | — | `Message-ID` / WhatsApp `messages[0].id`, §11 dedupe |

- **Unique:** `(tenant_id, channel, external_message_id) WHERE external_message_id IS NOT NULL`. This is the storage-level half of webhook idempotency; **sb-events** owns `webhook_receipt`.
- **Indexes:** `(tenant_id, status, received_at DESC)`; `(tenant_id, channel)`; `(tenant_id, matched_organisation_id)`; `(tenant_id, assigned_to_user_id) WHERE status <> 'CONVERTED'`; GIN trigram on `subject`.
- **Checks:** `needs_human_review = false OR status <> 'ARCHIVED'` — the contract says low-confidence items are never auto-archived; the schema says they are never archived while the flag stands.

#### `enquiry_extraction_field` — §4 `PATCH /enquiries/{id}/extraction`

One row per extracted field, because each carries its own provenance and its own edit history.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `enquiry_id` | `uuid` | no | — | → `enquiry` `ON DELETE CASCADE` |
| `field_key` | `text` | no | — | `topic·audience·timing·budget`; open set |
| `value` | `text` | yes | — | Null is meaningful (`budget: null` at 0.97 confidence) |
| `provenance_id` | `uuid` | yes | — | → `provenance` |

No `ref`. **Unique:** `(tenant_id, enquiry_id, field_key)`. A `PATCH` flips the row's provenance to
`AI_SUGGESTED` with `editedBy` — that is a new `provenance` row, not an update, so the original extraction
survives for the audit drawer.

#### `opportunity` — §5

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `organisation_id` | `uuid` | no | — | → `organisation` `ON DELETE RESTRICT` |
| `primary_contact_id` | `uuid` | yes | — | → `contact` `ON DELETE SET NULL` |
| `source_enquiry_id` | `uuid` | yes | — | → `enquiry` `ON DELETE SET NULL` |
| `owner_user_id` | `uuid` | no | — | → `app_user` |
| `stage` | `opportunity_stage` | no | `'NEW'` | `NEW·QUALIFYING·TNA_SENT·PROPOSAL_SENT·NEGOTIATION·WON·LOST` |
| `value_minor` | `bigint` | yes | — | |
| `currency` | `char(3)` | no | `'MYR'` | |
| `probability` | `numeric(4,3)` | yes | — | REPORT.md `probability` |
| `stage_changed_at` | `timestamptz` | no | `now()` | |
| `lost_reason` | `text` | yes | — | |

- **Unique:** `(tenant_id, source_enquiry_id) WHERE source_enquiry_id IS NOT NULL` — one enquiry converts once.
- **Indexes:** `(tenant_id, stage, updated_at DESC)`; `(tenant_id, organisation_id)`; `(tenant_id, owner_user_id, stage)`.
- **Checks:** `stage <> 'LOST' OR lost_reason IS NOT NULL`.

#### `organisation_suggestion` — §5 cross-sell panel

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `organisation_id` | `uuid` | no | — | → `organisation` `ON DELETE CASCADE` |
| `suggestion_type` | `text` | no | — | `CROSS_SELL`; open set |
| `programme_id` | `uuid` | yes | — | → `programme` `ON DELETE CASCADE` |
| `title` | `text` | no | — | |
| `rationale` | `text` | no | — | |
| `status` | `text` | no | `'OPEN'` | `OPEN·ACTED·DISMISSED` |
| `dismissed_at` | `timestamptz` | yes | — | |
| `dismissed_by_user_id` | `uuid` | yes | — | |
| `provenance_id` | `uuid` | yes | — | → `provenance` |

No `ref`. **Index:** `(tenant_id, organisation_id) WHERE status = 'OPEN'`.

#### `follow_up` — §4, M03-S06

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `organisation_id` | `uuid` | no | — | → `organisation` `ON DELETE CASCADE` |
| `contact_id` | `uuid` | no | — | → `contact` `ON DELETE RESTRICT` |
| `proposal_id` | `uuid` | yes | — | → `proposal` `ON DELETE CASCADE` |
| `invoice_id` | `uuid` | yes | — | → `invoice` `ON DELETE CASCADE` — collections reuse the same queue shape |
| `reason` | `text` | no | — | |
| `due_date` | `date` | no | — | |
| `status` | `follow_up_status` | no | `'DUE'` | `DUE·OVERDUE·SENT·DISMISSED` |
| `autonomy` | `autonomy_level` | no | `'SUGGEST'` | Snapshot of the grant at creation, so the queue explains itself |
| `owner_user_id` | `uuid` | no | — | |

- **Indexes:** `(tenant_id, owner_user_id, due_date) WHERE status = 'DUE'`; `(tenant_id, proposal_id)`.
- **Checks:** exactly one target — `num_nonnulls(proposal_id, invoice_id) <= 1`.

#### `tna` — §6, M05-S02

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `opportunity_id` | `uuid` | no | — | → `opportunity` `ON DELETE CASCADE` |
| `questionnaire_template_id` | `uuid` | yes | — | → `template` `ON DELETE RESTRICT` |
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
| `budget_minor` | `bigint` | yes | — | Null is meaningful |
| `currency` | `char(3)` | no | `'MYR'` | |
| `reopened_at` | `timestamptz` | yes | — | `POST /tnas/{id}/reopen` |

- **Unique:** `(tenant_id, opportunity_id)` — one TNA per opportunity in the contract's flow.
- **Checks:** `status <> 'COMPLETE' OR completed_at IS NOT NULL`.

#### `tna_constraint`, `tna_gap`, `tna_evidence`, `tna_recommendation` — §6

All four: `tna_id uuid NOT NULL → tna ON DELETE CASCADE`, no `ref`.

`tna_constraint`: `code text` (open set: `DELIVERY_WINDOW·MAX_DAYS_OFF_FLOOR·HRDC_CLAIMABLE_REQUIRED`),
`label text`, `severity severity NULL`. **Unique** `(tenant_id, tna_id, code)`.

`tna_gap`: `name text`, `description text`, `priority gap_priority` (`HIGH·MEDIUM·LOW`),
`evidence_refs text[]` (`["Q4","Q7"]` — questionnaire question ids, not entity refs),
`provenance_id uuid`. **Index** `(tenant_id, tna_id, priority)`.

`tna_evidence`: `source_type evidence_type`, `source_ref text`, `excerpt text`. The contract package
already unifies this: one `EvidenceType` enum and one `EvidenceRef` shape serve `provenance.sources[]`,
action `evidence[]` and TNA evidence alike. So `evidence_type` is a single native enum here, and the
open question is only which lane owns the table — see Deviation 11.

`tna_recommendation`: `programme_id uuid → programme ON DELETE CASCADE`, `fit_score numeric(4,3)`,
`rationale text`, `price_indication_minor bigint`, `currency char(3)`, `rank smallint`,
`scoring_model_version text` (`fit-v3`), `scoring_weights jsonb`, `provenance_id uuid`,
`accepted_at timestamptz`. **Unique** `(tenant_id, tna_id, programme_id)`.
**Index** `(tenant_id, tna_id, fit_score DESC)`.

#### `proposal` — §6, M07-S02

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `opportunity_id` | `uuid` | no | — | → `opportunity` `ON DELETE RESTRICT` |
| `template_id` | `uuid` | no | — | → `template` `ON DELETE RESTRICT` |
| `programme_id` | `uuid` | yes | — | → `programme` `ON DELETE RESTRICT` |
| `run_id` | `uuid` | yes | — | → `agent_run` `ON DELETE SET NULL` |
| `status` | `proposal_status` | no | `'DRAFT'` | `DRAFT·AWAITING_APPROVAL·SENT·VIEWED·ACCEPTED·LOST` |
| `value_minor` | `bigint` | yes | — | Mirrors the accepted quotation's sell price |
| `currency` | `char(3)` | no | `'MYR'` | |
| `margin_rate` | `numeric(6,4)` | yes | — | |
| `sent_at` | `timestamptz` | yes | — | |
| `first_viewed_at` | `timestamptz` | yes | — | Drives the follow-up reason "not opened since 13 Sep" |
| `accepted_at` | `timestamptz` | yes | — | |
| `lost_at` | `timestamptz` | yes | — | |

- **Indexes:** `(tenant_id, opportunity_id)`; `(tenant_id, status, updated_at DESC)`.
- **Checks:** `status <> 'SENT' OR sent_at IS NOT NULL`.
- **Immutability:** once `status = 'SENT'`, `template_id`, `value_minor` and every `proposal_section.body` freeze. See §4.

#### `proposal_section` — §6

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `proposal_id` | `uuid` | no | — | → `proposal` `ON DELETE CASCADE` |
| `n` | `smallint` | no | — | Section number from the template |
| `title` | `text` | no | — | |
| `body` | `text` | yes | — | |
| `merge_fields_used` | `text[]` | yes | — | |
| `needs_review` | `boolean` | no | `false` | |
| `provenance_id` | `uuid` | yes | — | → `provenance` |

No `ref`. **Unique:** `(tenant_id, proposal_id, n)`.
`warnings[]` in the response is **not a table** — `LOW_CONFIDENCE_SECTION` is a view over
`provenance.confidence < threshold`, so a warning can never disagree with the confidence that produced it.

#### `proposal_share_token`, `tna_share_token` — §11, M07-S07

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `proposal_id` / `tna_id` | `uuid` | no | — | `ON DELETE CASCADE` |
| `token_hash` | `bytea` | no | — | SHA-256 of the token. The token itself is **never stored** |
| `issued_at` | `timestamptz` | no | `now()` | |
| `expires_at` | `timestamptz` | no | — | Default `issued_at + interval '30 days'` (§16.6, assumed) |
| `revoked_at` | `timestamptz` | yes | — | |
| `last_accessed_at` | `timestamptz` | yes | — | |
| `access_count` | `integer` | no | `0` | |

No `ref`. **Unique:** `(token_hash)` globally, not per tenant — the token is the only thing the
unauthenticated caller presents, so it must resolve the tenant, not assume it.
**Index:** `(tenant_id, proposal_id) WHERE revoked_at IS NULL`.

#### `proposal_comment`, `proposal_acceptance` — §11

`proposal_comment`: `proposal_id`, `contact_id uuid NULL`, `author_name text NOT NULL`,
`author_kind actor_kind NOT NULL`, `body text NOT NULL`, `posted_at timestamptz NOT NULL`.
`author_name` is frozen at write time even when `contact_id` is set, because the client page is a legal
record of what the client saw. No `ref`.

`proposal_acceptance`: `proposal_id` **unique** per tenant, `accepted_by_name text`, `accepted_by_role text`,
`accepted_at timestamptz`, `signature_id uuid → signature`, `engagement_id uuid → engagement ON DELETE SET NULL`,
`share_token_id uuid → proposal_share_token`. One row per proposal enforces §11's "a second accept returns
the original acceptance" at the storage layer, not in application code.

#### `quotation` — §6 (`GET /costings/{id}`), M07-S03

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `proposal_id` | `uuid` | no | — | → `proposal` `ON DELETE RESTRICT` |
| `supersedes_quotation_id` | `uuid` | yes | — | → `quotation` `ON DELETE SET NULL` |
| `version` | `smallint` | no | `1` | |
| `rate_card_version` | `text` | no | `'v0-placeholder'` | §18/S4. Value owned by **sb-money** |
| `sell_price_minor` | `bigint` | no | — | Sum of rounded `quotation_line.total_minor` |
| `direct_cost_minor` | `bigint` | no | — | |
| `currency` | `char(3)` | no | `'MYR'` | |
| `margin_rate` | `numeric(6,4)` | no | — | Stored, not computed, so the approval evidence is reproducible |
| `floor_price_minor` | `bigint` | no | — | Snapshot of the programme floor at pricing time |
| `floor_margin_rate` | `numeric(6,4)` | no | — | |
| `commission_rate` | `numeric(6,4)` | yes | — | |
| `commission_minor` | `bigint` | yes | — | |
| `commission_payable_on` | `text` | yes | — | `COLLECTION·INVOICE` |
| `below_floor_approved_by_action_id` | `uuid` | yes | — | → `action_request` (sb-actions); set by `DISCOUNT_APPROVE` |
| `status` | `text` | no | `'DRAFT'` | `DRAFT·APPLIED·SUPERSEDED` |

- **Unique:** `(tenant_id, proposal_id, version)`; `(tenant_id, proposal_id) WHERE status = 'APPLIED'`.
- **Checks:** `sell_price_minor >= floor_price_minor OR below_floor_approved_by_action_id IS NOT NULL` — the `FLOOR_PRICE_BREACH` rule (§6) as a constraint, not a service-layer test.
- **Immutability:** an `APPLIED` quotation is frozen entirely; a change writes a new `version` row and sets the old one `SUPERSEDED`. See §4.
- `perParticipant` (§15.3) is **not a column**. It is `display.perPax` per §18/S3.

#### `quotation_line` — §6

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `quotation_id` | `uuid` | no | — | → `quotation` `ON DELETE CASCADE` |
| `n` | `smallint` | no | — | Line order |
| `item` | `text` | no | — | `TRAINER_FEE·VENUE·MATERIALS·TRAVEL·MEALS`; open set, rate-card driven |
| `detail` | `text` | yes | — | |
| `qty` | `numeric(10,2)` | no | — | `0` for a zero-cost venue line |
| `unit` | `text` | yes | — | `DAY·PAX·TRIP` |
| `rate_minor` | `bigint` | yes | — | |
| `total_minor` | `bigint` | no | — | `round_half_up(rate_minor * qty)`, §18/S3 |
| `currency` | `char(3)` | no | `'MYR'` | |
| `is_cost` | `boolean` | no | `true` | Cost line versus sell line |

No `ref`. **Unique:** `(tenant_id, quotation_id, n)`.
**Trigger:** `AFTER INSERT OR UPDATE OR DELETE` recomputes and asserts
`quotation.sell_price_minor = Σ rounded sell lines` and `direct_cost_minor = Σ rounded cost lines`.

### 3.2 Delivery

#### `programme` — §6, M06-S02

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `name` | `text` | no | — | |
| `category` | `text` | no | — | `LEADERSHIP`; open set |
| `days` | `smallint` | no | — | |
| `version` | `smallint` | no | `1` | |
| `status` | `text` | no | `'DRAFT'` | `DRAFT·ACTIVE·RETIRED` |
| `hrdc_scheme` | `hrdc_scheme` | yes | — | `SBL_KHAS·SBL·HRDC_PLACEMENT` |
| `hrdc_claimable` | `boolean` | no | `false` | |
| `list_price_minor` | `bigint` | no | — | |
| `list_price_pax` | `smallint` | no | — | The pax count the list price is quoted at |
| `floor_price_minor` | `bigint` | no | — | |
| `floor_margin_rate` | `numeric(6,4)` | no | — | |
| `currency` | `char(3)` | no | `'MYR'` | |
| `outcomes` | `text[]` | no | `'{}'` | Ordered prose, never filtered |
| `deliveries_count` | `integer` | no | `0` | `stats.deliveries`, maintained by trigger |
| `average_evaluation` | `numeric(3,2)` | yes | — | `stats.averageEvaluation`, maintained by trigger |
| `archived_at` | `timestamptz` | yes | — | |

- **Indexes:** `(tenant_id, status, category)`; GIN trigram on `name`.
- **Checks:** `floor_price_minor <= list_price_minor`; `days > 0`.
- **Immutability:** none. `PUT /programmes/{id}` is ADMIN + L&D. A price change does **not** reprice existing quotations, because each quotation snapshots `floor_price_minor` and `rate_card_version`.

#### `programme_module`, `programme_pricing_tier`, `programme_material` — §6

All: `programme_id uuid NOT NULL → programme ON DELETE CASCADE`, no `ref`.

`programme_module`: `n smallint`, `title text`, `format text` (`FACILITATED·SELF_PACED·COACHING`),
`duration_minutes integer`. **Unique** `(tenant_id, programme_id, n)`.

`programme_pricing_tier`: `max_pax smallint`, `price_minor bigint`, `currency char(3)`.
**Unique** `(tenant_id, programme_id, max_pax)`. **Check** `max_pax > 0`. Tiers are read in ascending
`max_pax`; the first tier whose `max_pax >= headcount` wins, and a headcount above the largest tier is a
quote, not a lookup.

`programme_material`: `material_type text` (`WORKBOOK·SLIDES·ASSESSMENT`), `version smallint`,
`languages char(2)[]`, `attachment_id uuid → attachment ON DELETE SET NULL`.

#### `trainer` — §6, M06-S02

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `name` | `text` | no | — | |
| `email` | `citext` | yes | — | |
| `phone` | `text` | yes | — | |
| `user_id` | `uuid` | yes | — | → `app_user` `ON DELETE SET NULL`; set when a trainer logs in (role `TRAINER`) |
| `band` | `trainer_band` | yes | — | `A·B·C` (DECISIONS §5); the rates themselves live in **sb-money**'s rate card |
| `day_rate_override_minor` | `bigint` | yes | — | Per-trainer override; the value, not the schedule, is sb-money's |
| `ttt_certified` | `boolean` | no | `false` | |
| `ttt_ref` | `text` | yes | — | `TTT-2019-4471` |
| `ttt_valid_to` | `date` | yes | — | Drives the packet document "Valid to 30 Jun 2027" |
| `hrd_tdf` | `boolean` | no | `false` | HRD Corp accreditation at grant application (DECISIONS §3) |
| `rating` | `numeric(3,2)` | yes | — | |
| `status` | `text` | no | `'ACTIVE'` | `ACTIVE·INACTIVE` |

- **Checks:** `ttt_certified = false OR ttt_ref IS NOT NULL`.
- **Index:** `(tenant_id, status) WHERE ttt_certified`.

#### `programme_trainer` — §6 trainer pool

`programme_id`, `trainer_id`, both `ON DELETE CASCADE`; `certified_at date`, `rating_override numeric(3,2)`.
No `ref`. **Unique** `(tenant_id, programme_id, trainer_id)`.

#### `trainer_availability` — §6 `trainerAvailability[]`

`trainer_id` `ON DELETE CASCADE`; `on_date date NOT NULL`; `state text NOT NULL` (`AVAILABLE·BLOCKED·BOOKED`);
`note text`. No `ref`. **Unique** `(tenant_id, trainer_id, on_date)`.
**Index** `(tenant_id, on_date, state)`. Availability is a declared calendar; `BOOKED` days are written by
the `trainer_booking` trigger, so the two never disagree.

#### `trainer_booking` — DECISIONS §1 (soft-hold 72h, confirmed booking)

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `trainer_id` | `uuid` | no | — | → `trainer` `ON DELETE RESTRICT` |
| `engagement_id` | `uuid` | no | — | → `engagement` `ON DELETE CASCADE` |
| `state` | `booking_state` | no | `'SOFT_HOLD'` | `SOFT_HOLD·CONFIRMED·RELEASED·CANCELLED` |
| `starts_on` | `date` | no | — | |
| `ends_on` | `date` | no | — | |
| `hold_expires_at` | `timestamptz` | yes | — | 72 hours for a soft hold |
| `day_rate_minor` | `bigint` | yes | — | Confirmed rate; frozen once `CONFIRMED` |
| `currency` | `char(3)` | no | `'MYR'` | |

- **Checks:** `ends_on >= starts_on`; `state <> 'SOFT_HOLD' OR hold_expires_at IS NOT NULL`.
- **Exclusion constraint:** `EXCLUDE USING gist (tenant_id WITH =, trainer_id WITH =, daterange(starts_on, ends_on, '[]') WITH &&) WHERE (state IN ('SOFT_HOLD','CONFIRMED'))` — double-booking a trainer is unrepresentable, which is the only honest place to enforce "Farah Aziz available 12–13 Nov".
- Soft-hold autonomy is `AUTONOMOUS`, confirmation is `ACT_WITH_APPROVAL` (DECISIONS §1); the schema does not encode that, `autonomy_grant` does.

#### `engagement` — §8, M09-S02

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `organisation_id` | `uuid` | no | — | → `organisation` `ON DELETE RESTRICT` |
| `opportunity_id` | `uuid` | yes | — | → `opportunity` `ON DELETE SET NULL` |
| `proposal_id` | `uuid` | yes | — | → `proposal` `ON DELETE SET NULL` |
| `programme_id` | `uuid` | no | — | → `programme` `ON DELETE RESTRICT` |
| `owner_user_id` | `uuid` | no | — | → `app_user` |
| `pipeline_id` | `uuid` | no | — | → `pipeline` `ON DELETE RESTRICT` — the stepper's configuration |
| `title` | `text` | no | — | |
| `status` | `engagement_status` | no | `'PROPOSED'` | `PROPOSED·CONFIRMED·SCHEDULED·IN_DELIVERY·DELIVERED·CLOSED·CANCELLED` |
| `venue` | `text` | yes | — | |
| `venue_mode` | `venue_mode` | yes | — | `CLIENT_SITE·OWN_VENUE·EXTERNAL` (DECISIONS §5) |
| `value_minor` | `bigint` | yes | — | |
| `currency` | `char(3)` | no | `'MYR'` | |
| `grant_rule_set_version_id` | `uuid` | yes | — | → `rule_set_version` `ON DELETE RESTRICT`. **Pinned at grant submission** (§18/S1) |
| `grant_pinned_at` | `timestamptz` | yes | — | |
| `closed_out_at` | `timestamptz` | yes | — | |

- **Indexes:** `(tenant_id, status, updated_at DESC)`; `(tenant_id, organisation_id)`; `(tenant_id, programme_id)`; `(tenant_id, owner_user_id)`.
- **`dates[]` is not a column.** Delivery dates are `min(session.date)`/`max(session.date)`, exposed as a generated view column. One source of truth.
- **Immutability:** once `grant_rule_set_version_id` is set, that column and `grant_pinned_at` are frozen (§4 rule I3). Once `status = 'CLOSED'`, the whole row is frozen except `updated_at`.

#### `engagement_step_state` — §5/§8 lifecycle, driven by `pipeline_step`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `engagement_id` | `uuid` | no | — | → `engagement` `ON DELETE CASCADE` |
| `pipeline_step_id` | `uuid` | no | — | → `pipeline_step` `ON DELETE RESTRICT` |
| `state` | `lifecycle_state` | no | `'PENDING'` | `DONE·CURRENT·PENDING·BLOCKED·SKIPPED·FAILED` |
| `occurred_at` | `timestamptz` | yes | — | The `at` the stepper renders |
| `note` | `text` | yes | — | `"2 documents missing"` |
| `target_ref` | `text` | yes | — | `INV-2026-0311` on the INVOICED step |

No `ref`. **Unique:** `(tenant_id, engagement_id, pipeline_step_id)`;
`(tenant_id, engagement_id) WHERE state = 'CURRENT'` — at most one current step.
**The step key and its order are never stored here**; they come from `pipeline_step`, satisfying the
project rule that stage names and order render from pipeline configuration.
`HRDC_CLAIM.state = 'BLOCKED'` is written by the compliance check evaluator when any check `FAIL`s
(§17) — the stepper renders it, it does not compute it.

#### `engagement_checklist_item` — §8

`engagement_id` `ON DELETE CASCADE`; `item_key text`; `label text`; `done boolean NOT NULL DEFAULT false`;
`done_at timestamptz`; `done_by_user_id uuid`. No `ref`. **Unique** `(tenant_id, engagement_id, item_key)`.

#### `session` — §8

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `engagement_id` | `uuid` | no | — | → `engagement` `ON DELETE CASCADE` |
| `trainer_id` | `uuid` | yes | — | → `trainer` `ON DELETE RESTRICT` |
| `day` | `smallint` | no | — | 1-based |
| `on_date` | `date` | no | — | |
| `title` | `text` | yes | — | |
| `venue` | `text` | yes | — | Room, distinct from the engagement venue |
| `starts_at` | `timestamptz` | yes | — | |
| `ends_at` | `timestamptz` | yes | — | |

- **Unique:** `(tenant_id, engagement_id, day, on_date, title)`. A day may hold more than one session.
- **Index:** `(tenant_id, on_date)`; `(tenant_id, trainer_id, on_date)`.

#### `participant` — §8, M10

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `engagement_id` | `uuid` | no | — | → `engagement` `ON DELETE CASCADE` |
| `contact_id` | `uuid` | yes | — | → `contact` `ON DELETE SET NULL` — most participants are not contacts |
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

#### `attendance_sheet` — §8, M10-S06

One row per engagement per day. This is the table the immutability rule exists for.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `engagement_id` | `uuid` | no | — | → `engagement` `ON DELETE RESTRICT` |
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

#### `attendance_record` — §8

Normalised to one row per participant per half-day, rather than the response's `am` / `pm` object pair.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `attendance_sheet_id` | `uuid` | no | — | → `attendance_sheet` `ON DELETE RESTRICT` |
| `participant_id` | `uuid` | no | — | → `participant` `ON DELETE RESTRICT` |
| `half` | `attendance_half` | no | — | `AM·PM` |
| `present` | `boolean` | no | — | |
| `marked_at` | `timestamptz` | yes | — | The `at` in the response |
| `method` | `capture_method` | yes | — | `QR·SIGNATURE·MANUAL` |
| `absence_reason` | `absence_reason` | yes | — | `MEDICAL_LEAVE·WORK_CONFLICT·NO_SHOW·OTHER` |
| `signature_id` | `uuid` | yes | — | → `signature` `ON DELETE RESTRICT` |

No `ref`. **Unique:** `(tenant_id, attendance_sheet_id, participant_id, half)`.
**Checks:** `present = true OR absence_reason IS NOT NULL`; `present = false OR method IS NOT NULL`.
**Index:** `(tenant_id, participant_id)`.

#### `certificate`, `evaluation_response` — §8, §9

`certificate`: `participant_id → participant ON DELETE RESTRICT`, `engagement_id`,
`issued_at timestamptz`, `template_id uuid → template`, `attachment_id uuid → attachment`,
`serial text`. Has a `ref`. **Unique** `(tenant_id, participant_id, engagement_id)`.

`evaluation_response`: `engagement_id`, `participant_id uuid NULL` (anonymous responses are allowed),
`submitted_at timestamptz`, `overall_score numeric(3,2)`, `answers jsonb`. No `ref`.
**Unique** `(tenant_id, engagement_id, participant_id) WHERE participant_id IS NOT NULL`.
`EVALUATION_SUMMARY` completeness ("24 of 30 responses collected") is
`count(evaluation_response) / count(participant)`, a view, not a stored number.

#### `outbound_message` — §4 follow-up drafts, §9 collections reminders, broadcasts

The single table behind `FOLLOWUP_SEND`, `REMINDER_SEND` and `BROADCAST_SEND`. One pattern, one table —
three near-identical message tables would be exactly the divergence the project rules forbid.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `channel` | `enquiry_channel` | no | — | `EMAIL·WHATSAPP` in practice |
| `template_id` | `uuid` | yes | — | → `template` `ON DELETE RESTRICT` |
| `category` | `message_category` | yes | — | `MARKETING·UTILITY·SERVICE` — WhatsApp pricing category |
| `contact_id` | `uuid` | yes | — | → `contact` `ON DELETE SET NULL` |
| `to_address` | `text` | no | — | Frozen at send time |
| `follow_up_id` | `uuid` | yes | — | → `follow_up` `ON DELETE SET NULL` |
| `invoice_id` | `uuid` | yes | — | → `invoice` `ON DELETE SET NULL` |
| `engagement_id` | `uuid` | yes | — | → `engagement` `ON DELETE SET NULL` — joining instructions |
| `body` | `text` | no | — | |
| `status` | `text` | no | `'DRAFT'` | `DRAFT·QUEUED·SENT·DELIVERED·READ·FAILED` |
| `sent_at` | `timestamptz` | yes | — | |
| `rate_per_message_minor` | `bigint` | yes | — | Rounded to the sen at estimate time |
| `rate_per_message_exact` | `numeric(10,6)` | yes | — | `0.056400` — §4 requires the exact rate for display |
| `estimated_cost_minor` | `bigint` | yes | — | |
| `actual_cost_minor` | `bigint` | yes | — | |
| `currency` | `char(3)` | no | `'MYR'` | |
| `message_rate_id` | `uuid` | yes | — | → `message_rate` — which rate row was applied |
| `consent_id` | `uuid` | yes | — | → `contact_consent` — the consent relied on, frozen |
| `provider_message_id` | `text` | yes | — | |
| `provenance_id` | `uuid` | yes | — | → `provenance` |

- **Indexes:** `(tenant_id, status, sent_at DESC)`; `(tenant_id, invoice_id)`; `(tenant_id, contact_id)`.
- **Unique:** `(tenant_id, provider_message_id) WHERE provider_message_id IS NOT NULL`.
- **Checks:** `status <> 'SENT' OR (sent_at IS NOT NULL AND consent_id IS NOT NULL)` — a sent message must
  name the consent it relied on. That is the PDPA evidence, and it belongs in the constraint.

#### `message_rate` — §4 WhatsApp rates, §16.4

`channel enquiry_channel`, `category message_category`, `rate_exact numeric(10,6)`, `currency char(3)`,
`effective_from timestamptz`, `effective_to timestamptz`, `fetched_at timestamptz`,
`source text` (`BSP_API·MANUAL`), `stale_after timestamptz`. No `ref`.
**Unique** `(tenant_id, channel, category, effective_from)`.
A rate row exists because §16.4 asks what TTL applies and what the composer shows when the lookup fails:
the composer reads the newest non-stale row, and shows the last known rate labelled stale when
`now() > stale_after`. The TTL value itself is the client's decision (Q4).

### 3.3 Compliance

#### `hrdc_packet` — §9, M12-S02

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `engagement_id` | `uuid` | no | — | → `engagement` `ON DELETE RESTRICT` |
| `organisation_id` | `uuid` | no | — | → `organisation` `ON DELETE RESTRICT` |
| `scheme` | `hrdc_scheme` | no | — | |
| `employer_code` | `text` | no | — | Frozen copy; the organisation may re-register later |
| `claim_value_minor` | `bigint` | no | — | |
| `levy_available_minor` | `bigint` | yes | — | From `hrdc_levy_statement`, frozen at assembly |
| `currency` | `char(3)` | no | `'MYR'` | |
| `completeness` | `numeric(4,3)` | no | `0` | Maintained by trigger over `hrdc_packet_document` |
| `status` | `packet_status` | no | `'DRAFT'` | `DRAFT·READY·SUBMITTED·PAID·REJECTED` |
| `deadline_at` | `timestamptz` | yes | — | |
| `deadline_severity` | `severity` | yes | — | Derived; stored so the badge and the list agree |
| `grant_reference` | `text` | yes | — | `GRT-2026-77412` |
| `grant_submitted_at` | `timestamptz` | yes | — | Pins `engagement.grant_rule_set_version_id` (§18/S1) |
| `grant_approved_at` | `timestamptz` | yes | — | After this, grant terms are immutable (DECISIONS §3) |
| `claim_reference` | `text` | yes | — | `CLM-2026-118834`, recorded by a human from eTRIS |
| `claim_submitted_at` | `timestamptz` | yes | — | |
| `claim_rule_set_version_id` | `uuid` | yes | — | → `rule_set_version`. **Pinned at claim submission** (§18/S1) |
| `voided_at` | `timestamptz` | yes | — | Set by `ATTENDANCE_UNLOCK` |
| `void_reason` | `text` | yes | — | |

- **Unique:** `(tenant_id, engagement_id)`; `(tenant_id, claim_reference) WHERE claim_reference IS NOT NULL`.
- **Indexes:** `(tenant_id, status, deadline_at)`; `(tenant_id, organisation_id)`.
- **Checks:** `status <> 'SUBMITTED' OR (completeness = 1 AND claim_reference IS NOT NULL AND claim_submitted_at IS NOT NULL)` — this is the `422 VALIDATION_FAILED` from §9 expressed where it cannot be bypassed; `grant_submitted_at IS NULL OR grant_reference IS NOT NULL`.
- **There is no submit-to-HRDC path.** HRD Corp has no API (§9). `claim_reference` is always human-entered.
- `submissionLog[]` is **not a table.** It is a view over **sb-events**' `audit_entry` filtered to this packet. A second log would drift from the audit drawer.

#### `hrdc_packet_document` — §9 `requiredDocuments[]`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `hrdc_packet_id` | `uuid` | no | — | → `hrdc_packet` `ON DELETE CASCADE` |
| `document_type` | `text` | no | — | → `hrdc_document_type__ref(document_type)` `ON DELETE RESTRICT` |
| `status` | `document_presence` | no | `'MISSING'` | `PRESENT·MISSING`. The package admits no `REJECTED`; see Deviation 14 |
| `attachment_id` | `uuid` | yes | — | → `attachment` `ON DELETE RESTRICT` |
| `source_ref` | `text` | yes | — | `ENG-0231/attendance`, `TTT-2019-4471`, `INV-2026-0311` |
| `meta` | `jsonb` | yes | — | `"Locked 14 Nov · 28/30 present"` and friends |
| `attached_at` | `timestamptz` | yes | — | |

No `ref`. **Unique:** `(tenant_id, hrdc_packet_id, document_type)`.
**Check:** `status <> 'PRESENT' OR (attachment_id IS NOT NULL OR source_ref IS NOT NULL)`.
`hrdc_document_type__ref` is a reference table, not an enum, because HRD Corp changes the required set by
circular and the registry must be editable without a migration.

#### `hrdc_levy_statement` — addition, see "Deviations"

`organisation_id`, `employer_code text`, `levy_available_minor bigint`, `as_of date`,
`source text` (`MANUAL_ENTRY·STATEMENT_UPLOAD`), `attachment_id uuid`. Has a `ref`.
**Unique** `(tenant_id, organisation_id, as_of)`.
`levyAvailable` is rendered on three screens and has no API source — HRD Corp has no API — so it must be a
dated snapshot with a provenance of its own, not a live number.

#### `rule_set_version` — §18/S1

`version_key text NOT NULL` (`rs_2026_06_15`), `effective_from date NOT NULL`, `effective_to date`,
`label text`, `frozen_at timestamptz`. No `ref` (the `version_key` is the ref).
**Unique** `(tenant_id, version_key)`; `EXCLUDE USING gist (tenant_id WITH =, daterange(effective_from, effective_to) WITH &&)`
so two versions can never claim the same day.

#### `compliance_rule` — §17, M12-S07

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `rule_key` | `text` | no | — | `HRD-014` — the id the API returns |
| `rule_set_version_id` | `uuid` | no | — | → `rule_set_version` `ON DELETE RESTRICT` |
| `scheme` | `hrdc_scheme` | yes | — | Null means all schemes |
| `subject` | `text` | no | — | `"In-house application lead time"` |
| `expression` | `jsonb` | no | — | `{field, op, reference, offsetDays}` |
| `side` | `text` | no | — | `GRANT·CLAIM` — decides which `asOf` applies (§18/S1) |
| `effective_from` | `date` | no | — | |
| `effective_to` | `date` | yes | — | |
| `status` | `rule_status` | no | `'PROPOSED'` | `PROPOSED·ACTIVE·SUPERSEDED` |
| `knowledge_source_id` | `uuid` | yes | — | → `knowledge_source` `ON DELETE SET NULL` |
| `source_document_id` | `text` | yes | — | `DOC-0188` |
| `source_title` | `text` | yes | — | `"Circular 04/2026"` |
| `source_section` | `text` | yes | — | `"3.2"` |
| `source_page` | `smallint` | yes | — | |
| `source_excerpt` | `text` | yes | — | Verbatim, frozen |
| `supersedes_rule_id` | `uuid` | yes | — | → `compliance_rule` `ON DELETE SET NULL` |
| `superseded_by_rule_id` | `uuid` | yes | — | → `compliance_rule` `ON DELETE SET NULL` |
| `used_by_check_keys` | `text[]` | no | `'{}'` | `["CHK_LEAD_TIME"]` |
| `verified_by_user_id` | `uuid` | yes | — | |
| `verified_at` | `timestamptz` | yes | — | |
| `provenance_id` | `uuid` | yes | — | → `provenance` — AI extraction, model and confidence |

- **Unique:** `(tenant_id, rule_key)`; `(tenant_id, rule_key, rule_set_version_id)`.
- **Indexes:** `(tenant_id, scheme, status, effective_from)`; `(tenant_id, side)`.
- **Checks:** `status <> 'ACTIVE' OR verified_at IS NOT NULL` — an unverified rule can never be `ACTIVE`, which is DECISIONS §3's "every rule loads as Proposed until compliance verifies it" made structural; `effective_to IS NULL OR effective_to >= effective_from`.
- **Immutability:** an `ACTIVE` row is append-only. A change supersedes it with a new row carrying the **circular's** effective date, never the approval timestamp (§17). See §4 rule I5.
- **Seeded from DECISIONS §3**, all `PROPOSED`: in-house lead time 14 days, public lead time 3 days (to 31 Dec 2026), public lead time 14 days (from 1 Jan 2027), commencement window 90 days, claim window 6 months, no amendment after approval, trainer accreditation at grant application, ACM ceilings, attendance immutability. The demo's five-working-day claim window is **not seeded** (§18/S6). "Apply before Friday 5 PM" is a `WARN` check with no rule row.

#### `rule_change_set`, `rule_change`, `rule_change_affected_engagement` — §17, M12-S08

`rule_change_set`: `document_key text` (`DOC-0219`), `title text`, `published_at date`,
`ingested_at timestamptz`, `knowledge_source_id uuid`, `extracted_by_model text`,
`extracted_confidence numeric(4,3)`, `run_id uuid → agent_run`, `effective_from date`,
`status text` (`PROPOSED·APPROVED·REJECTED`), `approved_by_action_id uuid` (sb-actions).
**Unique** `(tenant_id, document_key)`.

`rule_change`: `rule_change_set_id` `ON DELETE CASCADE`, `change_key text` (`chg_1`),
`op rule_change_op` (`ADD·MODIFY·SUPERSEDE`), `target_rule_id uuid → compliance_rule`,
`new_rule_id uuid → compliance_rule`, `before_text text`, `after_text text`,
`source_page smallint`, `source_section text`, `source_excerpt text`, `confidence numeric(4,3)`,
`status text` (`PROPOSED·APPROVED·REJECTED·WITHHELD`), `withheld_reason text`. No `ref`.
**Check:** `confidence >= 0.80 OR status = 'WITHHELD'` — §17 says changes below 0.80 are withheld from the
diff view and flagged for manual transcription; the constraint makes that impossible to forget.

`rule_change_affected_engagement`: `rule_change_id`, `engagement_id`, both `ON DELETE CASCADE`.
No `ref`. **Unique** `(tenant_id, rule_change_id, engagement_id)`.

#### `compliance_check_result` — §17, §18, M12-S02 and M09-S02

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `engagement_id` | `uuid` | no | — | → `engagement` `ON DELETE CASCADE` |
| `check_key` | `text` | no | — | → `check_key__ref(check_key)` `ON DELETE RESTRICT` |
| `state` | `check_state` | no | — | `PASS·WARN·FAIL·NOT_APPLICABLE` |
| `label` | `text` | no | — | |
| `computed` | `jsonb` | no | — | The named values the screen renders |
| `display` | `text` | yes | — | The pre-rendered sentence |
| `compliance_rule_id` | `uuid` | yes | — | → `compliance_rule` `ON DELETE RESTRICT` |
| `rule_set_version_id` | `uuid` | no | — | → `rule_set_version`. The version actually applied |
| `rule_side` | `text` | no | — | `GRANT·CLAIM` |
| `rules_as_of` | `date` | no | — | Grant submission date or claim submission date, never the training date |
| `basis` | `rule_resolution_basis` | no | — | `GRANT_SUBMITTED·CLAIM_SUBMITTED` |
| `method` | `text` | no | `'DETERMINISTIC'` | `DETERMINISTIC·INTERPRETED` |
| `provenance_id` | `uuid` | yes | — | Null when `DETERMINISTIC` — §17 says a deterministic check carries no model |
| `evaluated_at` | `timestamptz` | no | `now()` | |
| `stage_key` | `text` | yes | — | The transition that triggered re-evaluation |

No `ref`. **Unique:** `(tenant_id, engagement_id, check_key, evaluated_at)` — results are append-only, so
the "re-evaluate at every stage transition" rule (DECISIONS §6) leaves a history rather than overwriting.
**Indexes:** `(tenant_id, engagement_id, evaluated_at DESC)`; `(tenant_id, state) WHERE state = 'FAIL'`.
**Checks:** `method <> 'DETERMINISTIC' OR provenance_id IS NULL`.
A `FAIL` writes `engagement_step_state.state = 'BLOCKED'` on the `HRDC_CLAIM` step via trigger.

#### `compliance_version_drift` — §18/S1

`compliance_check_result_id` `ON DELETE CASCADE`, `applied_version_id uuid → rule_set_version`,
`current_version_id uuid → rule_set_version`, `severity severity`, `message text`. No `ref`.
Exists so a version change between stages produces a warning citing both versions, never a silent switch.

#### `knowledge_source`, `knowledge_chunk` — §17, M16-S05

`knowledge_source`: `name text`, `source_type knowledge_source_type` (`HRDC_CIRCULAR` only, per the package), `version text`,
`uri text`, `attachment_id uuid`, `ingested_at timestamptz`, `chunk_count integer`,
`embedding_status embedding_status` (`INDEXED·PENDING·FAILED`), `last_checked_at timestamptz`,
`monitor_status monitor_status` (`WATCHING·CHANGED_REVIEW_PENDING·FAILED·MANUAL`),
`content_hash text`, `retrieval_scopes retrieval_scope[]` (`COMPLIANCE·CLIENT_FACING`),
`rule_change_set_id uuid`, `quarantined boolean NOT NULL DEFAULT false`, `archived_at timestamptz`.
Has a `ref` (`src_0219`). **Unique** `(tenant_id, content_hash)`.
**Check:** `monitor_status <> 'CHANGED_REVIEW_PENDING' OR quarantined` — §17 says a changed source is
quarantined from rule extraction until reviewed but stays searchable, so quarantine is a column the
retriever reads, not a status string it interprets.

`knowledge_chunk`: `knowledge_source_id` `ON DELETE CASCADE`, `seq integer`, `content text`,
`token_count integer`, `embedding vector(1536)`, `metadata jsonb`. No `ref`.
**Unique** `(tenant_id, knowledge_source_id, seq)`.
**Index** HNSW on `embedding` (`vector_cosine_ops`), plus `(tenant_id, knowledge_source_id)`.
Requires the `vector` extension; confirm it is enabled on the Supabase project before the migration runs.

### 3.4 Finance

#### `invoice` — §9, M13-S02

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `organisation_id` | `uuid` | no | — | → `organisation` `ON DELETE RESTRICT` |
| `engagement_id` | `uuid` | yes | — | → `engagement` `ON DELETE RESTRICT` |
| `quotation_id` | `uuid` | yes | — | → `quotation` `ON DELETE RESTRICT` — what was billed |
| `status` | `invoice_status` | no | `'DRAFT'` | `DRAFT·SENT·PARTIALLY_PAID·PAID·OVERDUE·VOID` |
| `issued_at` | `timestamptz` | yes | — | |
| `due_at` | `date` | yes | — | |
| `terms_days` | `smallint` | no | `30` | |
| `subtotal_minor` | `bigint` | no | `0` | Σ rounded lines (§18/S3) |
| `sst_minor` | `bigint` | no | `0` | Computed on the summed net |
| `sst_reason` | `text` | yes | — | `TRAINING_EXEMPT` |
| `total_minor` | `bigint` | no | `0` | `subtotal + sst` |
| `outstanding_minor` | `bigint` | no | `0` | `total − Σ payments` |
| `currency` | `char(3)` | no | `'MYR'` | |
| `sync_state` | `sync_state` | no | `'NOT_SENT'` | `NOT_SENT·SENT·VALIDATED·ERROR` |
| `sync_provider` | `text` | yes | — | `ACCOUNTING` |
| `sync_uin` | `text` | yes | — | `MY-2026-XXXXXXXX-0311`, mirrored from MyInvois downstream |
| `sync_document_id` | `text` | yes | — | The accounting package's id |
| `sync_last_attempt_at` | `timestamptz` | yes | — | |
| `voided_at` | `timestamptz` | yes | — | |

- **Unique:** `(tenant_id, sync_provider, sync_document_id) WHERE sync_document_id IS NOT NULL`.
- **Indexes:** `(tenant_id, status, due_at)`; `(tenant_id, organisation_id)`; `(tenant_id, engagement_id)`; `(tenant_id, sync_state) WHERE sync_state = 'ERROR'`.
- **Checks:** `total_minor = subtotal_minor + sst_minor`; `outstanding_minor >= 0`; `status <> 'SENT' OR issued_at IS NOT NULL`.
- **Trigger:** `total_minor` must equal the sum of rounded `invoice_line.amount_minor` plus SST, or the write is rejected with `TOTAL_NOT_RECONCILED` (§18/S3). This is the constraint that makes lines-from-total unrepresentable.
- **Immutability:** once `sync_state = 'VALIDATED'`, every column except `status`, `outstanding_minor`, `sync_*` and `updated_at` is frozen. A validated tax invoice is a filed document.
- `daysOverdue`, `aging` buckets and `dsoDays` are views, never columns.

#### `invoice_line` — §9, §18/S3

`invoice_id` `ON DELETE CASCADE`, `n smallint`, `description text`, `detail text`,
`qty numeric(10,2)`, `unit_price_minor bigint`, `amount_minor bigint`, `currency char(3)`,
`tax_code text`. No `ref`. **Unique** `(tenant_id, invoice_id, n)`.
**Check:** `amount_minor = round_half_up(unit_price_minor * qty)`.
There is no `per_pax` column: a package price is one line at `qty = 1` and per-pax is display only (§18/S3).

#### `invoice_sync_log` — §9

`invoice_id` `ON DELETE CASCADE`, `at timestamptz`, `state sync_state`, `provider_code text`
(`CUSTOMER_NOT_MAPPED`), `detail text`, `resolution text`, `webhook_receipt_id uuid` (sb-events).
No `ref`. Append-only. **Index** `(tenant_id, invoice_id, at DESC)`.

#### `payment` — §9 `POST /invoices/{id}/payments`

`invoice_id` `ON DELETE RESTRICT`, `amount_minor bigint`, `currency char(3)`,
`received_at timestamptz`, `method text` (`BANK_TRANSFER·CHEQUE·CARD·HRDC_DISBURSEMENT`),
`external_reference text`, `recorded_by_user_id uuid`. Has a `ref`.
**Unique** `(tenant_id, invoice_id, external_reference) WHERE external_reference IS NOT NULL`.
**Check** `amount_minor > 0`. **Trigger** maintains `invoice.outstanding_minor` and flips `status` to
`PARTIALLY_PAID` / `PAID`. Payments are never updated or deleted; a correction is a negative-amount
reversal row, which is why the check allows only positive amounts on insert and reversals carry
`is_reversal boolean` with their own sign rule.

#### `collections_case`, `collection_rule` — §9, M13-S05

`collections_case`: `invoice_id` **unique** per tenant `ON DELETE CASCADE`, `organisation_id`,
`stage collection_stage` (`REMINDER_1·REMINDER_2·REMINDER_3·HUMAN_CALL·TRADING_HOLD`),
`stage_entered_at timestamptz`, `next_action_at timestamptz`, `next_action_type text`,
`next_action_status text` (`DRAFT_READY·SCHEDULED·BLOCKED`), `autonomy autonomy_level`,
`trading_hold_approved_by_action_id uuid`, `closed_at timestamptz`. Has a `ref`.
**Index** `(tenant_id, stage, next_action_at) WHERE closed_at IS NULL`.

`collection_rule`: `stage collection_stage`, `trigger_days_overdue smallint`, `channel enquiry_channel`,
`template_id uuid`, `requires_role app_role`, `autonomy autonomy_level`. No `ref`.
**Unique** `(tenant_id, stage)`. Seeds the 7 / 30 / 45 ladder, human call at 60, trading hold at 75 with
MD approval (§9). The ladder is configuration, not code.

### 3.5 AI-ops

#### `agent` — §10, M18-S01

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `agent_key` | `text` | no | — | `agent_proposal` — the id the API returns and `requestedBy.id` carries |
| `name` | `text` | no | — | |
| `status` | `agent_status` | no | `'ACTIVE'` | `ACTIVE·PAUSED·RETIRED` |
| `scopes` | `text[]` | no | `'{}'` | `["proposals","quotations"]` |
| `default_tier_key` | `text` | yes | — | → `ai_tier(tier_key)` `ON DELETE RESTRICT` |
| `escalation_ladder` | `text[]` | no | `'{}'` | Tier keys, in order |
| `kill_switch` | `boolean` | no | `false` | |
| `paused_at` | `timestamptz` | yes | — | |
| `paused_reason` | `text` | yes | — | `EVAL_REGRESSION` |
| `resume_condition` | `jsonb` | yes | — | `{metric, op, value}` |
| `eval_score` | `numeric(4,3)` | yes | — | Latest from `eval_run` |
| `cost_month_minor` | `bigint` | no | `0` | Rolling, from `ai_usage_ledger` |
| `cost_per_run_30d_minor` | `bigint` | yes | — | |
| `cache_hit_rate_30d` | `numeric(4,3)` | yes | — | |
| `last_run_at` | `timestamptz` | yes | — | |
| `currency` | `char(3)` | no | `'MYR'` | |

- **Unique:** `(tenant_id, agent_key)`.
- **Checks:** `status <> 'PAUSED' OR paused_at IS NOT NULL`.
- §16.7 asks whether a service principal is one credential per agent or per agent per tenant. This schema answers **per agent per tenant** — `agent` carries `tenant_id`, so `agent_proposal` in tenant A and in tenant B are different rows with different autonomy grants and different spend. Credentials themselves belong to **sb-tenancy**.

#### `autonomy_grant` — §10, DECISIONS §1

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `agent_id` | `uuid` | no | — | → `agent` `ON DELETE CASCADE` |
| `action_type` | `text` | no | — | → `action_type__ref` `ON DELETE RESTRICT` |
| `level` | `autonomy_level` | no | — | `OBSERVE·SUGGEST·ACT_WITH_APPROVAL·AUTONOMOUS` |
| `ceiling` | `autonomy_level` | no | — | The highest level this grant may ever reach |
| `ceiling_reason` | `text` | yes | — | `MONEY_MOVING` |
| `paused` | `boolean` | no | `false` | Per-action-type pause (§10 `POST /agents/{id}/pause`) |
| `min_confidence` | `numeric(4,3)` | yes | — | Policy evaluation input 4 (§3) |
| `value_threshold_minor` | `bigint` | yes | — | Band above which the grant drops to approval |
| `promotion_condition` | `text` | yes | — | DECISIONS §1 promotion conditions, verbatim |
| `promoted_at` | `timestamptz` | yes | — | |

No `ref`. **Unique:** `(tenant_id, agent_id, action_type)`.
**Check:** `level <= ceiling` using an ordering function over `autonomy_level`, so
`PUT /agents/{id}/autonomy` returning `422 MONEY_MOVING_CEILING` is a constraint violation and not a
service-layer opinion. **Read by sb-actions' policy gate; written by the AI-ops screens.**

#### `agent_run` — §10, §17, M18-S04

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `run_key` | `text` | no | — | `run_4821`; `ref` carries `#4821` |
| `agent_id` | `uuid` | no | — | → `agent` `ON DELETE RESTRICT` |
| `parent_run_id` | `uuid` | yes | — | → `agent_run` — retry, replay or sandbox parent |
| `mode` | `text` | no | `'LIVE'` | `LIVE·SANDBOX` — a sandbox replay writes no effects (§10) |
| `orchestrator` | `text` | yes | — | `proposal_orchestrator` |
| `trigger_type` | `text` | no | — | `TNA_SIGNED_OFF` |
| `trigger_ref` | `text` | yes | — | `TNA-0042` |
| `action_type` | `text` | yes | — | → `action_type__ref` |
| `tier_key` | `text` | yes | — | → `ai_tier` |
| `model` | `text` | yes | — | Frozen model name at run time |
| `started_at` | `timestamptz` | no | — | |
| `ended_at` | `timestamptz` | yes | — | |
| `duration_ms` | `integer` | yes | — | |
| `cost_minor` | `bigint` | no | `0` | |
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

#### `agent_run_step` — §10

`agent_run_id` `ON DELETE CASCADE`, `seq smallint`, `tool text`, `args jsonb`, `result jsonb`,
`status run_step_status` (`OK·RETRIED·FAILED·HALTED`), `retries smallint`, `duration_ms integer`,
`cost_minor bigint`, `error jsonb`, `halted_by_policy_id text`,
`approval_request_id uuid → approval_request` (sb-actions) `ON DELETE SET NULL`,
`halted_reason text`. No `ref`. **Unique** `(tenant_id, agent_run_id, seq)`.
**Check:** `status <> 'HALTED' OR halted_by_policy_id IS NOT NULL`.

#### `agent_run_node` — §17 execution tree

`agent_run_id` `ON DELETE CASCADE`, `node_key text` (`n0`), `parent_node_id uuid → agent_run_node`,
`kind trace_node_kind` (`ORCHESTRATOR·SUB_AGENT·TOOL`), `name text`, `tier_key text → ai_tier`,
`model text`, `provider text`, `tokens_in integer`, `tokens_out integer`,
`cache_hit_rate numeric(4,3)`, `cost_minor bigint`, `duration_ms integer`,
`status run_step_status`, `retries smallint`, `halted_by_policy_id text`,
`approval_request_id uuid`. No `ref`. **Unique** `(tenant_id, agent_run_id, node_key)`.
**Check:** exactly one root — `(tenant_id, agent_run_id) WHERE parent_node_id IS NULL` partial unique index.

#### `agent_run_event`, `jury_vote` — §17, §18/S2

`agent_run_event`: `agent_run_id` `ON DELETE CASCADE`, `event_type run_event_type`
(`ESCALATION·JURY·TRUNCATION·HANDOFF·CHECKPOINT·POLICY_HALT·CACHE_HIT·BUDGET_EXCEEDED`),
`at timestamptz`, `agent_run_node_id uuid`, `detail jsonb`. No `ref`.
**Index** `(tenant_id, agent_run_id, at)`.

`jury_vote`: `agent_run_event_id` `ON DELETE CASCADE`, `tier_key text → ai_tier`, `model text`,
`agrees boolean`, `dissent text`, `blocking boolean NOT NULL`, `jury_mode jury_mode`. No `ref`.
`blocking = false` for `SAMPLE` votes, which run after the human decides and never touch the decision
(§18/S2). The column exists so a sampled dissent can never be mistaken for a gate.

#### `agent_run_state_card`, `agent_run_guardrail`, `agent_checkpoint` — §17

`agent_run_state_card`: `agent_run_id` **unique** `ON DELETE CASCADE`, `goal text`, `plan jsonb`,
`decisions text[]`, `constraints text[]`, `record_pointers text[]`, `open_questions text[]`,
`tokens_used integer`, `tokens_limit integer`, `cost_used_minor bigint`, `cost_limit_minor bigint`.

`agent_run_guardrail`: `agent_run_id` `ON DELETE CASCADE`, `label text`, `seq smallint`.
The five guardrail strings in §10 are rows, so the trace shows what was in force for that run rather than
what is in force today.

`agent_checkpoint`: `agent_run_id` `ON DELETE CASCADE`, `step_seq smallint`, `replayable boolean`,
`state jsonb`, `created_at`. **Unique** `(tenant_id, agent_run_id, step_seq)`.
Backs `POST /runs/{id}/retry?from=checkpoint`.

#### `eval_set`, `eval_run` — §10 `GET /evals?agentId=`, DECISIONS §2 gate

`eval_set`: `name text`, `version text`, `item_count smallint`, `action_type text`, `frozen_at timestamptz`.
Has a `ref`. **Unique** `(tenant_id, name, version)`.

`eval_run`: `agent_id`, `eval_set_id`, `action_type text`, `score numeric(4,3)`, `ran_at timestamptz`,
`purpose text` (`PROMOTION_GATE·SCHEDULED·AD_HOC`), `passed boolean`,
`jury_agreement numeric(4,3)`, `cost_minor bigint`. Has a `ref`.
**Index** `(tenant_id, agent_id, ran_at DESC)`.
`purpose = 'PROMOTION_GATE'` is the jury's first use in DECISIONS §2 — three STRONG models against the
golden set at promotion time, one-off.

#### `ai_tier` — §17, M20-S20

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
| `monthly_cap_minor` | `bigint` | yes | — | |
| `spend_minor` | `bigint` | no | `0` | |
| `currency` | `char(3)` | no | `'MYR'` | |
| `status` | `tier_status` | no | `'HEALTHY'` | `HEALTHY·DEGRADED·PAUSED_BY_CAP·DISABLED` |
| `degraded_since` | `timestamptz` | yes | — | |
| `degraded_reason` | `text` | yes | — | `PROVIDER_5XX` |
| `active_fallback_tier_key` | `text` | yes | — | |

- **Unique:** `(tenant_id, tier_key)`.
- **Checks:** `status <> 'DEGRADED' OR degraded_since IS NOT NULL`; `status <> 'PAUSED_BY_CAP' OR spend_minor >= monthly_cap_minor`.

#### `ai_routing_entry` — §17, §18/S2

`action_type text → action_type__ref`, `tier_key text → ai_tier`, `escalation_ladder text[]`,
`jury jsonb NOT NULL DEFAULT '{}'`, `required_for_autonomous boolean`, `applies_from timestamptz NOT NULL`.
No `ref`. **Unique** `(tenant_id, action_type, applies_from)`.

`applies_from` exists because §17 says routing changes **apply to future runs only, never retroactively**.
Routing is therefore versioned rows, not an updatable row; a run reads the entry whose `applies_from` is
the latest at or before `agent_run.started_at`. Updating in place would silently rewrite history, which is
exactly what the endpoint note forbids.

`jury` shape (§18/S2): `{ mode: GATE|SAMPLE|ESCALATE, quorum, of, tiers[], sampleRate?, triggers?: { minConfidence, maxValue, firstOfKind } }`.
JSONB because the shape is the contract's and is never filtered in SQL. A check constraint asserts
`jury->>'mode'` is one of the three.

#### `ai_provider_key`, `ai_provider_key_tier` — §17, M20-S21

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `provider` | `ai_provider` | no | — | `ANTHROPIC·GOOGLE·OPENAI·DEEPSEEK` |
| `label` | `text` | no | — | |
| `status` | `provider_key_status` | no | `'NOT_SET'` | `NOT_SET·VALID·INVALID·EXPIRING` |
| `masked_key` | `text` | no | — | `sk-ant-••••••••••••9a41`. Display only |
| `secret_ref` | `text` | no | — | Pointer into Vault. **The key itself is never a column** |
| `spend_month_minor` | `bigint` | no | `0` | |
| `cap_minor` | `bigint` | yes | — | |
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

`ai_provider_key_tier`: `ai_provider_key_id`, `tier_key`, both `ON DELETE CASCADE`. No `ref`.
**Unique** `(tenant_id, ai_provider_key_id, tier_key)`. This is `scopeTiers[]` normalised so the
"409 if a tier has no remaining key" rule is a countable query rather than an array scan.

#### `ai_usage_ledger`, `ai_budget` — §17, M20-S16

`ai_usage_ledger`: `period char(7)` (`2026-11`), `agent_run_id uuid`, `agent_id uuid`,
`tier_key text`, `action_type text`, `kind text` (`LLM·WHATSAPP·COMPUTE`),
`cost_minor bigint`, `currency char(3)`, `tokens_in integer`, `tokens_out integer`,
`cache_hit boolean`, `off_peak boolean`, `occurred_at timestamptz`. No `ref`. Append-only.
**Indexes** `(tenant_id, period, tier_key)`; `(tenant_id, period, agent_id)`; `(tenant_id, period, action_type)`
— one per `groupBy` value the endpoint accepts. `cacheHitRate`, `offPeakShare`, `estimatedCacheSaving`
and the forecast are all aggregates over this table.

`ai_budget`: `scope budget_scope` (`TIER·AGENT·ACTION_TYPE`), `scope_key text`, `cap_minor bigint`,
`spend_minor bigint`, `state budget_state` (`WITHIN·NEAR·PAUSED`), `period char(7)`,
`raised_by_action_id uuid` (sb-actions, `BUDGET_CAP_RAISE`). No `ref`.
**Unique** `(tenant_id, scope, scope_key, period)`.
A tripped cap sets the matching `ai_tier.status = 'PAUSED_BY_CAP'` by trigger, which is what makes runs
fail with `409 AGENT_PAUSED` and `details.reason: "BUDGET_CAP"`.

### 3.6 Shell / Platform

#### `saved_view` — §2, §16.9

`object saved_view_object` (`LEAD·ENQUIRY·APPROVAL`), `label text`, `filters jsonb`, `columns text[]`,
`is_default boolean`, `owner_user_id uuid → app_user ON DELETE CASCADE`,
`visibility view_visibility NOT NULL DEFAULT 'PERSONAL'` (`PERSONAL·TEAM·TENANT`),
`deleted_at timestamptz`. Has a `ref`.
**Unique** `(tenant_id, owner_user_id, object, label) WHERE deleted_at IS NULL`;
partial unique `(tenant_id, owner_user_id, object) WHERE is_default AND deleted_at IS NULL`.
The `visibility` column is the schema's answer to §16.9 — it supports both readings, and the client only
has to pick the default. `count` in the response is computed, never stored.

#### `template`, `template_section` — §2

`template`: `template_type template_type` (`PROPOSAL·QUOTATION·CERTIFICATE·EMAIL·WHATSAPP·INVOICE·TNA_QUESTIONNAIRE·EVALUATION·HRDC_PACKET`),
`version smallint`, `label text`, `merge_fields text[]`, `status text` (`DRAFT·ACTIVE·RETIRED`),
`category message_category` (WhatsApp only), `rate_per_message_minor bigint` (WhatsApp only),
`approved_provider_ref text` (the BSP-approved template id). Has a `ref` (`tpl_proposal_std_v7`).
**Unique** `(tenant_id, template_type, label, version)`.
Templates are **versioned, never edited**: a proposal built from v7 must still render as v7 in five years,
and §10's guardrail "Approved template version" is meaningless otherwise.

`template_section`: `template_id` `ON DELETE CASCADE`, `n smallint`, `title text`,
`ai_enabled boolean`, `default_body text`. No `ref`. **Unique** `(tenant_id, template_id, n)`.

#### `pipeline`, `pipeline_step` — §5 `GET /config/pipelines?object=ENGAGEMENT`

`pipeline`: `object text` (`ENGAGEMENT·OPPORTUNITY·PACKET`), `name text`, `is_default boolean`,
`version smallint`, `status text`. Has a `ref`.
**Unique** `(tenant_id, object, name, version)`; partial unique `(tenant_id, object) WHERE is_default`.

`pipeline_step`: `pipeline_id` `ON DELETE CASCADE`, `step_key text` (`ENQUIRY·TNA·PROPOSAL·APPROVAL·SENT·DELIVERY·WON·TRAINER_CONFIRMED·SCHEDULED·REGISTERED·DELIVERED·ATTENDANCE_LOCKED·HRDC_CLAIM·INVOICED·PAID`),
`label text`, `position smallint`, `terminal boolean`, `blocking_check_keys text[]`. No `ref`.
**Unique** `(tenant_id, pipeline_id, step_key)` and `(tenant_id, pipeline_id, position)`.
This table is the whole reason `engagement_step_state` stores no labels. Two different pipelines in the
contract — the six-step one on the organisation relations panel and the nine-step one on the engagement
detail — are two `pipeline` rows for the same object, not two hardcoded lists.

#### `metric_definition` — §10 `GET /metrics/{key}`

`metric_key text` (`OPEN_PIPELINE·AR_OVERDUE·ADMIN_HOURS_SAVED·…`), `label text`,
`scope text` (`TENANT·ORGANISATION·ENGAGEMENT`), `value_kind text` (`MONEY·COUNT·RATE·DURATION`),
`formula text`, `is_estimate boolean`, `drill_to_template text`, `sql_source text`,
`compare_period text`. No `ref`. **Unique** `(tenant_id, metric_key, scope)`.
Every MetricStrip cell is self-describing because the definition is data, including its `drillTo` — §5 is
explicit that the UI never hardcodes a drill route.

#### `hours_saved_baseline_table`, `hours_saved_baseline` — §18/S5, DECISIONS §4

`hours_saved_baseline_table`: `version text`, `basis hours_saved_basis` (`MEASURED·ILLUSTRATIVE`),
`haircut numeric(3,2) NOT NULL DEFAULT 0.70`, `effective_from date`, `signed_off_by_user_id uuid`,
`signed_off_at timestamptz`. No `ref`. **Unique** `(tenant_id, version)`.

`hours_saved_baseline`: `baseline_table_id` `ON DELETE CASCADE`, `action_type text → action_type__ref`,
`baseline_minutes integer`, `sample_size smallint`, `credited boolean NOT NULL DEFAULT true`.
No `ref`. **Unique** `(tenant_id, baseline_table_id, action_type)`.
`human_minutes_spent` is per action, not per type — it is measured by the UI and belongs on
**sb-actions**' `action_request` as `human_review_seconds`. Flagged to that lane.

#### `attachment`, `signature` — §8, §9, §11

`attachment`: `storage_bucket text`, `storage_path text`, `filename text`, `content_type text`,
`byte_size bigint`, `checksum text`, `uploaded_by_user_id uuid`, `virus_scanned_at timestamptz`.
Has a `ref`. **Unique** `(tenant_id, storage_bucket, storage_path)`.
Referencing tables hold `attachment_id`; `attachment` holds no back-pointer, so there is no polymorphic
owner column and no orphan class to reconcile.

`signature`: `attachment_id uuid → attachment`, `signed_at timestamptz`, `signer_name text`,
`signer_role text`, `method text` (`DRAWN·TYPED·CLICKWRAP`), `ip_address inet`, `user_agent text`.
Has a `ref` (`sig_9f21`). Serves both `attendance_record.signature_id` and
`proposal_acceptance.signature_id` — one signature concept, one table.

#### `ref_format`, `ref_sequence` — ref allocation

`ref_format`: `prefix text` **unique** `(tenant_id, prefix)`, `dated boolean`, `width smallint`,
`entity text`, `gapless boolean NOT NULL DEFAULT false`. No `ref` (it is the ref registry).

`ref_sequence`: `prefix text`, `period text` (`'2026'` or `'-'`), `next_value bigint NOT NULL DEFAULT 1`.
No `ref`. **Unique** `(tenant_id, prefix, period)`.

#### Reference tables — `action_type__ref`, `check_key__ref`, `hrdc_document_type__ref`

Each: `id uuid` PK with a **unique** natural key `(tenant_id, <key>)`, plus `label text`, `description text`, `position smallint`,
`active boolean`, and for `action_type__ref` also `money_moving boolean`, `client_facing boolean`,
`hrdc_touching boolean` — the three properties DECISIONS §1 uses to justify a ceiling. The autonomy
ceiling check reads those columns instead of hardcoding a list of action types.

`action_type__ref` seeds §3's nineteen action types plus `PROPOSAL_DRAFT`, `OPPORTUNITY_CREATE`,
`SUGGESTION_DISMISS`, `BUDGET_CAP_RAISE` and `RULE_CHANGE_APPROVE` from §17.

---

## 4 · Immutability the schema must enforce

### The rules

| # | Rule | Source | Scope of the freeze | Escape |
|---|---|---|---|---|
| I1 | **Attendance sheet lock** | §8, DECISIONS §3 | Once `attendance_sheet.status = 'LOCKED'`: no `UPDATE` or `DELETE` on that sheet's `attendance_record` rows, and on the sheet itself only `status`, `unlocked_at`, `unlock_reason`, `unlock_count` may change | `ATTENDANCE_UNLOCK` action only |
| I2 | **Approved quotation** | §6, §7 | Once `quotation.status = 'APPLIED'`: the whole row and all its `quotation_line` rows | None. A change writes a new `version` and marks the old `SUPERSEDED` |
| I3 | **Grant terms after approval** | DECISIONS §3 "No amendment" | Once `hrdc_packet.grant_approved_at IS NOT NULL`: `scheme`, `employer_code`, `claim_value_minor`, `grant_reference`, `grant_submitted_at`, `grant_approved_at`, and on the engagement `programme_id`, `grant_rule_set_version_id`, `grant_pinned_at` and the session dates | None in TrainOS. HRD Corp requires a new grant application |
| I4 | **Sent proposal** | §6 | Once `proposal.status = 'SENT'`: `template_id`, `value_minor`, `margin_rate`, `sent_at`, and every `proposal_section.body` | None. A revised proposal is a new `proposal` row |
| I5 | **Active compliance rule** | §17, DECISIONS §3 | Once `compliance_rule.status = 'ACTIVE'`: every column except `status`, `superseded_by_rule_id`, `effective_to` | Supersede with a new row carrying the circular's effective date |
| I6 | **Validated invoice** | §9 | Once `invoice.sync_state = 'VALIDATED'`: everything except `status`, `outstanding_minor`, `sync_*` | None. A correction is a credit note |
| I7 | **Finished agent run** | §10 | Once `agent_run.ended_at IS NOT NULL`: the run, its steps, nodes, events, guardrails, checkpoints and state card | None. A retry is a new run with `parent_run_id` |
| I8 | **Provenance, consent, payments, audit** | §1, §4, §9 | Append-only tables: `provenance` (sb-money), `contact_consent`, `payment`, `invoice_sync_log`, `compliance_check_result`, `ai_usage_ledger`, `organisation_health_snapshot` | None |
| I9 | **Refs** | §1 | `ref` on every table, after insert | None |
| I10 | **Pinned rule-set versions** | §18/S1 | `engagement.grant_rule_set_version_id` after it is set, `hrdc_packet.claim_rule_set_version_id` after it is set | None. Drift is reported by `compliance_version_drift`, never resolved by rewriting the pin |

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
be able to tell "an approved unlock is executing" from "someone is writing to a locked sheet". The lock
trigger checks a transaction-local setting:

```
current_setting('trainos.unlock_action_id', true)
```

which is set with `set_config(..., true)` — transaction-scoped — inside **sb-actions**' `SECURITY DEFINER`
executor and only after the policy gate has approved the unlock. It cannot be set by any client, because
`PostgREST` does not let a caller choose `set_config` keys, and it disappears at commit. The unlock trigger
also writes `hrdc_packet.voided_at` in the same statement, so §8's "voids the claim packet" cannot be
skipped by a partial implementation.

**sb-actions decides the gating** — which actions are policy-gated, who approves, what the SLA is. This
lane only asserts that the storage layer must refuse the write when the gate has not run.

### One thing the schema deliberately does not enforce

`ATTENDANCE_UNLOCK` after a claim reference exists. §16.5 asks whether the API should refuse outright once
`hrdc_packet.claim_reference IS NOT NULL` rather than allowing the void. The constraint is one line either
way; the answer is the client's. Left as Q5 rather than guessed, because guessing wrong here either blocks
a legitimate correction or permits an unwind of a filed claim.

---

## 5 · Soft delete and archival

**Default: nothing is deleted.** Almost every entity in this contract already carries a lifecycle status
that says what "gone" means for it — `ENQUIRY.ARCHIVED`, `OPPORTUNITY.LOST`, `INVOICE.VOID`,
`AGENT.RETIRED`, `PROGRAMME.RETIRED`, `RULE.SUPERSEDED`. Adding a parallel `deleted_at` to those tables
would create two ways to say the same thing, and the project rule is that a second way to solve a solved
problem is a defect.

So there are exactly four patterns, and a table uses one:

**1 · Lifecycle status (most tables).** No delete column at all. `enquiry`, `opportunity`, `proposal`,
`quotation`, `engagement`, `invoice`, `hrdc_packet`, `compliance_rule`, `agent`, `attendance_sheet`,
`collections_case`, `follow_up`, `organisation_suggestion`. `DELETE` is revoked from every role but
`postgres`.

**2 · `archived_at` (catalogue and CRM rows with no lifecycle).** `organisation`, `programme`,
`knowledge_source`. Archived rows are excluded by the default view, stay visible in search with a badge,
and remain fully referenceable — an archived programme still explains a five-year-old engagement.

**3 · `deleted_at` (rows with a real `DELETE` endpoint).** `saved_view` (§2 `DELETE /views/{id}`) and
`ai_provider_key` (§17 `DELETE /ai/providers/{id}`, which returns `409` when a tier would be left
keyless — a countable query against `ai_provider_key_tier`). Both are recoverable for 30 days, then a
scheduled job hard-deletes. These are the only two tables in the model where a user pressing delete should
mean the row goes away.

**4 · `redacted_at` (personal data).** `contact` and `participant` only. PDPA erasure cannot be a soft
delete, because the obligation is that the data stops existing. The procedure nulls `name`, `email`,
`phone`, `identity_no_hash`, `identity_no_last4` and `department`, writes `redacted_at`, and leaves the
row, its FKs and its attendance records intact so headcounts, claims and invoices still reconcile. A
redacted participant renders as "Redacted participant" and still counts as present.

That last pattern has a live conflict the client must resolve: HRD Corp claim documentation is retained
for years, and an attendance sheet naming participants is part of a filed claim. Erasing a name from a
locked attendance sheet contradicts I1. The schema's position is that `redacted_at` on `participant` is
permitted and the locked `attendance_record` rows are not touched, because they reference the participant
by `id` and carry no name. Whether the filed PDF must also be redacted is Q9.

**Retention.** Nothing in Sales, Delivery, Compliance or Finance is ever purged. `ai_usage_ledger`,
`agent_run_step`, `agent_run_node`, `agent_run_event` and `knowledge_chunk` are the only high-volume
tables; they are candidates for partitioning by month and for a retention window, which is a
**sb-events** and operations decision rather than a domain one.

---

## 6 · Open questions for the client

Mapped to the contract's own numbering where one exists. Each names the column or constraint that changes,
so none of these blocks the migration author — every one has a default in the schema already.

| Q | Question | Maps to | What changes in the schema | Default taken |
|---|---|---|---|---|
| Q1 | Does an approval expire at 24h — expire, auto-reject, or nag forever? | §16.1 | `approval_request.expires_at` and the `EXPIRED` status (sb-actions). Nothing here | Deferred to sb-actions |
| Q2 | Diff staleness: `409` with a recomputed diff, or a soft lock on the target? | §16.2 | A soft lock needs `locked_by_approval_id` + `locked_until` on `proposal`, `quotation`, `invoice` | `409`, no lock columns |
| Q3 | Who owns `firstProposalToOrg` — computed live or denormalised? | §16.3 | `organisation.proposal_count` and `first_proposal_sent_at` exist | **Denormalised.** Policy evaluation runs on every action; a `count(*)` over proposals per gate is the wrong cost |
| Q4 | WhatsApp rate cache TTL, and what the composer shows when the lookup fails | §16.4 | `message_rate.stale_after` and `source` | Show the last known rate, labelled stale. TTL value unset |
| Q5 | Should unlock be refused outright once a claim reference exists? | §16.5 | One check constraint on `attendance_sheet` | **Not** constrained. See §4 |
| Q6 | Client portal token: revoke on acceptance, or keep live for re-download? | §16.6 | `proposal_share_token.revoked_at` behaviour | Kept live for 30 days; acceptance does not revoke |
| Q7 | Agent service principals: one per agent, or one per agent per tenant? | §16.7 | `agent` is tenant-scoped | **Per agent per tenant** |
| Q8 | Sandbox replay: live reads or a snapshot pinned to the original run? | §16.8 | `agent_run.snapshot_at` exists but is unpopulated under a live-read answer | Column present, pinned-snapshot assumed |
| Q9 | Saved views: shared or personal? | §16.9 | `saved_view.visibility` | `PERSONAL` default, `TEAM` and `TENANT` supported |
| Q10 | Money rounding | §16.10 | Resolved by §18 | **Closed.** Total-from-lines |
| Q11 | Rule resolution for the claim window | §17 Q1 | Resolved by §18/S1 and DECISIONS §6 | **Closed.** Grant-side at grant submission, claim-side at claim submission |
| Q12 | Must `INV-` references be gapless? | New | `ref_format.gapless` and a different allocator for that prefix | Not gapless. Malaysian tax-invoice practice may require otherwise — Finance to confirm |
| Q13 | Is `QUO-2026-0184` deliberately the same number as `PRO-2026-0184`? | New | Either `quotation` shares the proposal's sequence, or it has its own and the demo fixture is a coincidence | Assumed **shared**: the quotation inherits the proposal's allocated number |
| Q14 | Are `industry`, `audience_level`, `programme.category` and `classification_label` controlled vocabularies? | New | Four reference tables versus four free-text columns | Free text now, reference tables later |
| Q15 | Where does `levyAvailable` come from, given HRD Corp has no API? | New | `hrdc_levy_statement` as a dated manual snapshot | Manual entry or statement upload, with an `as_of` date on the tile |
| Q16 | How is `organisation.health_score` computed, and by what? | New | `organisation_health_snapshot.components` and `model_version` | Snapshot table exists; the formula is undefined |
| Q17 | Can a participant be someone who is not a `contact`? | New | `participant.contact_id` nullable | **Yes, nullable.** Most participants are never marketed to and PDPA consent differs |
| Q18 | Does a redacted participant's name have to be removed from an already-filed HRD Corp PDF? | New | Nothing in the schema; an operational procedure | Not attempted |
| Q19 | Jury economics: per action type, or only above a value threshold? | §17 Q2 | Resolved by §18/S2 and DECISIONS §2 | **Closed.** Gate, sample at 5%, escalate on trigger |
| Q20 | Batch windows: queue or escalate outside `allowedHours`? | §17 Q3 | `ai_tier.batch_eligible` | Queue when batch-eligible, escalate otherwise |
| Q21 | Should key reveal exist at all, or only rotate-and-replace? | §17 Q4 | `ai_provider_key.revealed_count` and the reveal endpoint | Reveal exists and is audited |
| Q22 | Pass-through billing: a TrainOS invoice line, or a report the client reconciles? | §17 Q5 | An `invoice_line` item code versus a report over `ai_usage_ledger` | Report only. No invoice line |
| Q23 | Is `pgvector` available and at what dimension? | New | `knowledge_chunk.embedding vector(1536)` | 1536 assumed |

---

## 7 · Deviations from contract

Places where this model does not mirror the contract's JSON, and why.

1. **`attendance_record` is one row per half-day, not an `am`/`pm` object pair.** The response shape
   (`am: {...}, pm: {...}`) is a rendering convenience. As columns it makes "how many present in the
   afternoon" a `UNION`, blocks a third session-half from ever existing, and duplicates every capture
   column. The API projection reassembles the pair.

2. **`engagement.dates[]` is not stored.** It is derived from `session.date`. The contract returns both
   `dates[]` and `sessions[]`; storing both guarantees they eventually disagree.

3. **`signaturesExpected` does not match its stated formula.** §15.2 gives
   `registered × sessionsInDay`; the demo renders 60 against 30 registered with **one** session
   (`SES-0461`) on day 1. 60 = 30 × 2 **halves**, not × sessions. This model computes it as
   `registered × 2` (AM and PM) and flags the contract's formula as wrong. If a day can hold three
   sessions with separate sign-in sheets, the formula and the `attendance_half` enum both need revisiting.

4. **`quotation` rather than `costing`.** The endpoint is `GET /v1/costings/{id}` but the entity's `ref` is
   `QUO-`, REPORT.md calls it `Quotation`, and §18 calls it `Quotation`. One name wins; it is the ref's.

5. **`organisation_status` is not in §12.** The markdown shows `"status": "ACTIVE_CLIENT"` and the enum
   catalogue has no entry. The contract package defines it as `PROSPECT·ACTIVE_CLIENT·DORMANT`, which this
   model now follows. A lost prospect is therefore `DORMANT`; there is no `LOST` organisation state, only a
   `LOST` opportunity.

6. **`hrdc_levy_statement` is an addition.** `levyAvailable` appears on four screens with no source, and
   HRD Corp has no API (§9). A number that important cannot be a cached integer with no `as_of`.

7. **`trainer_booking` is an addition.** §3 has `TRAINER_BOOK` and DECISIONS §1 has a 72-hour soft hold,
   but no endpoint returns a booking. Without the table, "Farah Aziz available 12–13 Nov" has nowhere to
   be false.

8. **`outbound_message` consolidates three flows.** `FOLLOWUP_SEND`, `REMINDER_SEND` and `BROADCAST_SEND`
   return near-identical draft shapes (§4, §9). One table, one set of consent and cost columns.

9. **`warnings[]`, `submissionLog[]`, `aging`, `metrics{}`, `related[]`, `relations{}` and
   `page.total` are views, not tables.** Each is a projection of data that already exists. Storing them
   would create a second source of truth for a number a screen renders beside its source.

10. **`ai_routing_entry` is versioned by `applies_from` rather than updated.** §17 says a routing change
    applies to future runs only. An updatable row cannot honour that.

11. **Three tables share one evidence shape, and the contract already says they should.**
    `tna_evidence`, `provenance_source` (sb-money) and `action_evidence` (sb-actions) all store
    `{type, ref, excerpt}`, and the contract package serves all three from one `EvidenceType` enum and one
    `EvidenceRef` interface. The enum is unified here. Whether the three become one `evidence` table with a
    discriminator is a **cross-lane decision**, not a unilateral one, because the rows have different
    owners and different immutability rules — but the project's consolidation rule points at one table.

12. **Enums that are reference tables, not Postgres enums.** `action_type`, `check_key`,
    `hrdc_document_type`, lifecycle step keys, `tier_key`, `metric_key`, template types and TNA constraint
    codes appear as `UPPER_SNAKE` strings in §12 and §17 alongside genuinely closed enums. Treating them
    as closed would mean a migration every time HRD Corp publishes a circular or a new action type ships.

13. **`hrdc_packet_document` has no `REJECTED` state.** The contract package's `DocumentPresence` is
    `PRESENT·MISSING`. A document HRD Corp returns as unacceptable therefore has nowhere to be recorded
    except by flipping back to `MISSING`, which loses the reason. Recommended addition to the contract, not
    taken unilaterally.

14. **`follow_up` has `OVERDUE`, not `SNOOZED`.** Aligned to the package. There is consequently no way to
    defer a follow-up without editing `due_date`, which is probably right but is a behaviour change worth
    naming.

15. **`identity_no` is stored as a hash plus last four, never in full.** HRD Corp claim documentation
    needs an identity number, but this system does not need to be able to read one back. The contract does
    not mention the field at all; it will be needed the first time a real packet is assembled.

---

## 8 · What I could NOT verify

1. **Field-level optionality against the contract package.** The package landed mid-task and was
   reconciled at the **enum** level only: every value set it fixes now matches, and the divergences are in
   "Deviations". Its per-field nullability was **not** checked against the `NULL` column of every table
   here. Specifically at risk: fields the markdown shows populated in every example but the package marks
   optional, and whether `ref` is present on child entities such as `proposal_section` and `invoice_line`.
   The package also defines types this model has no table for (`Receivable`, `AutomationRun`,
   `MessageDraft`, `HrdcSubmissionLogEntry`) — all four are views here, which is deliberate, but worth a
   second pair of eyes.

2. **Table names in the four adjacent lanes.** `tenant`, `app_user`, `provenance`, `policy`,
   `action_request`, `approval_request`, `audit_entry` and `webhook_receipt` are the names used here.
   sb-tenancy, sb-actions, sb-money and sb-events may choose differently; every FK naming them is a
   placeholder to be reconciled before the migration is written.

3. **Whether `provenance` is a table at all.** This model assumes a table with a `provenance_id` FK.
   sb-money may choose an embedded `jsonb` column instead. If so, every `provenance_id` here becomes a
   `provenance jsonb` column and the nullability semantics are unchanged.

4. **Rate card values.** Trainer bands A/B/C and their day rates, materials per pax, commission tiers,
   margin floors and discount authority are all unknown (DECISIONS §5). `rate_card_version` defaults to
   `'v0-placeholder'` and `quotation` snapshots the floor price rather than reading it live.

5. **Baseline minutes for hours-saved.** Requires time-and-motion sampling that has not happened
   (DECISIONS §4). The tables exist and are empty; `basis` is `ILLUSTRATIVE` until they are filled.

6. **Whether the HRD Corp rules are correct.** DECISIONS §3 states plainly that the demo's rule set was
   wrong once already. Every seeded rule is `PROPOSED` and the schema forbids `ACTIVE` without
   `verified_at`, but nobody has verified anything yet.

7. **Supabase project capabilities.** `pgvector` (for `knowledge_chunk.embedding`), `citext`, `btree_gist`
   (for the `trainer_booking` exclusion constraint) and `pg_trgm` (for search) are all assumed available.
   `btree_gist` in particular is required for the double-booking constraint and is not enabled by default.

8. **Volume and partitioning.** No figures exist for enquiries per month, runs per day or ledger rows per
   month, so the partitioning suggestion in §5 is a shape, not a recommendation.

9. **Whether two `pipeline` rows or one covers the engagement lifecycle.** §5 shows a six-step lifecycle on
   the organisation relations panel and §8 shows a nine-step one on the engagement detail, both for an
   engagement. This model assumes two `pipeline` rows for the same object with one marked default, but it
   is equally readable as one nine-step pipeline rendered in two densities.

10. **`GET /v1/organisations/{id}/health`.** The endpoint is referenced by a `drillTo` and never specified.
    `organisation_health_snapshot` is a guess at its shape.
