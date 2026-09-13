FINAL RULINGS (team lead, 17:27 +08) — these override every earlier message on the same topic. Apply, sweep your own file once, commit with explicit pathspec, do not re-open.
R-C2 Schema: `core` = PostgREST-exposed domain schema (all domain tables). `public` = identity/tenancy only (tenants, memberships, profiles, saved_views, agents principal rows). `app` = unexposed internals (gate ledger/action_requests execution log, outbox, dead_letters, webhook_deliveries, replay cache, helpers, key_access_audit). Reason: migration 001 is executable and adjudicated C1; 05 has 80 core.* refs; config.toml exposes core. 01, 02, 03 sweep public.<domain> → core.<domain>.
R-WB Write-back (FINAL): ONE function `app.report_effect_result(effect_id, status, result, error)`, effect_id = app.action_effects.id (sb-actions PK, bigint), not the outbox PK. The earlier names settle_effect and record_effect_result are withdrawn. Outbox dedupe key column is `job_key`. state_transitions lives in app. 03 (d896b07) and 05 (ffa29a6) agree.
R-GOV GOV-07 applier key: single transaction-local key `app.effect_applier` carrying action_request_id, resolved against action_requests for type+tenant. No second key (trainos.unlock_action_id withdrawn). sb-erd attaches trigger + column grants per gated table; sb-migrations derives the FULL legal-transition edge set from packages/contract status enums + 01 lifecycle rules.
R-STATUS Row lifecycle EXECUTING/EXECUTED/PARTIALLY_FAILED/SETTLED is accepted; POST /v1/actions response stays the 3-variant §3 contract via the fold function. Contract deviation recorded.
R-TEN Tenant helper `app.current_tenant_id()`; gate uses raising `app.require_tenant_id()`. Claims top-level in JWT.
R-EXT 001 must enable pg_cron + pg_net (amend 001 forward/rollback/test/catalog/changelog). Blocker owner: sb-migrations.
R-AUTH Agent auth = API key → Edge Function GoTrue sign-in as agent service user → hook injects claims. No self-minting anywhere.
R-QUO Table core.quotations; permissions quotation:*; API path /v1/quotations (contract R2 applied).
R-PROV Provenance table keyed (subject_table, subject_id, field); sources jsonb; rate_card_version FK with frozen label; binding_floor exposed; _sen suffix stays.
R-JSONB Every jsonb CHECK asserts key presence.
R-COMMIT `git commit -- <your file> -m …` only.
