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
