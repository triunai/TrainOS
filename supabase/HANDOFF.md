# Supabase lane — PAUSED 12 Sep 2026 17:52 +08 (user directive: UI focus, quota)

## Committed
- Design docs: docs/architecture/01–05 (closed at 01 5da2fff+, 02 8178da9, 03 5eed654, 04 4762dea, 05 cc3a330), 06-critic-review.md (b4dfc07, reviewed a snapshot; delta pass NOT done), spikes/2026-09-12-agent-jwt-minting.md.
- Migrations: 001 foundation, 002 tenancy/identity/permissions, 004 shell config + ref allocation (see catalog/changelog).
- Uncommitted on disk: supabase/migrations/005_sales_organisations_enquiries_tna.sql + rollback + test (unfinished, unverified).

## Open rulings not yet applied to migrations
1. 001: enable pg_cron + pg_net; fix header comment citing an early draft of doc 03 (real reason: config.toml exposes core, three lanes wrote against it).
2. FORCE ROW LEVEL SECURITY on all tenant tables; access-token hook as SECURITY INVOKER under supabase_auth_admin with grant + policy; prove locally (02 §4.1 settling query on BYPASSRLS).
3. Every function `set search_path = ''`; CI test asserts proconfig CONTAINS exactly `search_path=""` (not "not null"; not positional).
4. One shared enum app.effect_status at the outbox seam; report_effect_result(effect_id,…) raises on unknown value (05 §2.7 table).
5. Critic CRITICAL: no core table has RLS enabled in the pack; app.action_value column names must be *_sen and read generated below_floor.
6. Transition registry gated_by action_type[]; seed all 121 edges from 01 §5.3; ACCOUNT_TRADING_HOLD (22nd type) everywhere.
7. Rulings file (session scratchpad) is summarised in docs/architecture/06 + this list.

## Resume
Spawn a migrations author with docs/research/04-supabase-conventions.md + this file; start by finishing 005, then the items above, then batches 006–016 per the original plan. Do not apply to any remote project.

## Critic Part 2 (b01d241)
7 critical / 29 high still open at pause. Top: 001 unchanged (no pg_cron/pg_net/vector); ~25 migration functions use the four-part search_path list and fail 02 §8.7 exact-string sweep; 05 jsonb columns have no shape constraints; 01 rule snapshot model vs 04 bitemporal; circular 2/2026 vs 04/2026 (D-44). Full list in docs/architecture/06-critic-review.md Part 2.

## Update 18:20 — stopped mid-run
Migrations 001–009 authored, EXECUTED on a local PG 17.11 shim (no Supabase CLI/Docker), committed. Not started: 010 finance, 011 action envelope, 012 events/outbox, 013 ai-ops, 014 RLS, 015 realtime+cron, 016 seed. Six doc defects found by execution are recorded in the catalog. Note: packages/contract/src/enums.ts generates the 69 DB enum types — a change there is a migration. public.user_profiles is an author addition.

## Update 13 Sep 11:20 — stopped by user after 010
Resumed 13 Sep morning: amendment pass A applied open rulings to 001–005 (see 06-critic-review.md Part 3 applied marks, 01d9da0); 010 finance committed (cfef7c1, marks a549e8c). Not started: 011 action envelope, 012 events/outbox, 013 ai-ops, 014 RLS, 015 realtime+cron, 016 seed. Resume with the same brief from 011.

## Contract changes pending migration

Appended by the contract lane, 13 Sep 2026. Every entry below is a change to
`packages/contract/src/enums.ts`, which generates the 69 DB enum types in
`003_enum_types.sql`. Each needs a `CREATE TYPE core.<name>` in the 003
amendment pass plus the column change in the pack named on the row.

| Enum | Values | Carried by |
|---|---|---|
| `core.quotation_status` | `DRAFT · PENDING_DISCOUNT_APPROVAL · APPLIED · SUPERSEDED` | 003 (type) + 007 money/proposals/quotations — new `status` column on the quotation table, `Quotation.status` is required in the contract |
| `core.programme_status` | `DRAFT · ACTIVE · RETIRED` | 003 (type) + 006 catalogue/programmes — `core.programmes.status` is already `text NOT NULL DEFAULT 'DRAFT'` with a CHECK over exactly these three values (006:78). The contract now agrees with it; the only change is text + CHECK becoming the enum type |
| `core.engagement_stage_key` | `WON · TRAINER_CONFIRMED · SCHEDULED · REGISTERED · DELIVERED · ATTENDANCE_LOCKED · HRDC_CLAIM · INVOICED · PAID` | 003 (type) + 009 compliance — `core.compliance_checks.stage_key` at 009:537 is bare `text`. Also the 121-edge transition registry in 011 (`core.state_transitions`) if its engagement edges use these keys |
| `core.deal_chain_stage_key` | `ENQUIRY · TNA · PROPOSAL · APPROVAL · SENT · DELIVERY` | 003 (type) + wherever the §5 relations-panel chain is stored. Distinct from the engagement lifecycle: six keys, not nine |
| `core.pipeline_object` | `ENGAGEMENT · DEAL_CHAIN · OPPORTUNITY` | 003 (type) + 004 shell config, which serves `GET /v1/config/pipelines?object=` |
