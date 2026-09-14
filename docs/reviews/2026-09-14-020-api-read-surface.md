020 NEEDS FORWARD FIX

# Review · migration 020 `api_read_surface` (post-merge, post-apply)

- **Target:** `supabase/migrations/020_api_read_surface.sql`, its rollback, `supabase/tests/test_020_api_read_surface.sql`, the catalog entry. PR #37 (head `756bbbc`, merge `eed6aff`). Already applied to hosted.
- **Reviewer:** review-020 lane, 2026-09-14. Independent of the author lane (api-020). Read-only worktree at `origin/main` `eed6aff`.
- **Verdict:** no CRIT, and no security HIGH. **One functional HIGH (F1):** the audit-drawer fix, the migration's DEFECT 2, does not reach the web client that shipped, so the drawer is still empty in production. It needs a forward fix. The smallest safe one is a one-row alias in 021. A web-side alternative is listed under F1.

## How this was executed

Everything below was run, not just read. The shim was PostgreSQL 17.11 on `:5436`. Before every batch the script asserted `data_directory = …/trainos-wt/.shim-fix014/data`. Every database used the `rv20_` prefix.

| Step | Result |
| --- | --- |
| Build 001–020 as `hc_mig` (NOSUPERUSER, BYPASSRLS). Setup was shim, then `hosted-compat/hostlike_pre.sql`, then the 27 hosted default-ACL rows from `fix-004/hosted_full_pre.sql` re-targeted at `hc_mig`. | 20/20 OK, 0 ERROR |
| `test_020` as `hc_mig` | **10/10 PASS**, exit 0 |
| `test_018` and `test_019` on the same database (regression) | 38 PASS / 3 PASS, exit 0 |
| Reviewer probes RV1–RV7, appended to `test_020` before its `ROLLBACK` (so they reuse its fixtures) | see below |
| Rollback on a copy of the 020 database, then `pg_dump -s -n core -n app -n public`, diffed against a fresh 001–019 build | **identical** (the only diff lines are pg_dump's random `\restrict` tokens). ACLs, comments and function bodies all match. |
| Re-apply 020 on top of the rolled-back database | OK, exit 0 |
| Teeth checks: mutate one thing, re-run pin plus probes | see "Teeth" |

## Findings

### F1 · HIGH (functional) · the audit-drawer fix misses the spelling the web actually sends

The migration header (§2 and 7-point item 4) says the call site sends `"approvals"`. The feature code does: `features/approvals/api.ts:128` calls `api.getAudit("approvals", id)`. But that goes through `apiClient.ts:176`, then `rpc.audit()`, then `rpcClient.ts:748`, which sends `p_resource_type: aggregateTypeOf(resourceType)`. `aggregateTypeOf("approvals")` returns **`"APPROVAL"`** (`rpcClient.ts:249-252`).

In 020's `get_audit`, `'APPROVAL'` is not in the segment map. It falls through as-is, so `v_subject = 'APPROVAL'`. The correlation branch (`v_subject = 'APPROVAL_REQUEST'`) never runs, and no emitter writes subject type `APPROVAL`.

Measured (RV1: SALES_MANAGER, the approval from test_020 T5, which has one correlated event):

| `p_resource_type` | rows |
| --- | --- |
| `'APPROVAL'` (what the web sends) | **0** |
| `'approvals'` (what T5 tests) | 1 |
| `'APPROVAL_REQUEST'` | 1 |

The pin passes because T5 tests a spelling the web never sends.

The same client transform means the web cannot reach 020's segment map for plural-irregular segments either. `enquiries` becomes `ENQUIRIE` and `opportunities` becomes `OPPORTUNITIE`. Today those drawers match nothing.

**Fix (pick one, main's call):**
- **(a) Recommended: forward migration 021.** Add `('APPROVAL','APPROVAL_REQUEST')` to the `get_audit` segment map. Optionally also add `ENQUIRIE → ENQUIRY` and `OPPORTUNITIE → OPPORTUNITY`, or better, fix those on the web. Add a pin row that calls `get_audit(aggregateTypeOf('approvals'), ref)` with the literal `'APPROVAL'`. This is safe: the distinct `upper(app.action_types.target_entity)` values are AGENT, AI_BUDGET, ATTENDANCE_DAY, AUTONOMY_GRANT, BROADCAST, COLLECTIONS_CASE, ENGAGEMENT, ENQUIRY, FOLLOW_UP, HRDC_PACKET, INVOICE, PROPOSAL, QUOTATION, RULE_CHANGE, TNA, TRAINER_BOOKING, and no literal emitter uses `APPROVAL`. It works whatever the web sends.
- **(b) Web.** Have `rpcClient.audit()` send the raw segment, now that 020 accepts both segments and UPPER_SNAKE. This is also the right fix for the `-IE` plurals. It ships with the web, but leaves the database unable to handle an older client.

### F2 · MEDIUM (authz consistency, inside the 014 posture) · `audit:read` opens the approval trail without `approval:read`

TRAINER holds `audit:read` but not `approval:read`. RV2: `get_approval(ref)` returns FORBIDDEN, but `get_audit('approvals', ref)` succeeds with 1 row. So the drawer shows a trail for an approval its detail refuses. It stays inside one tenant and matches the author's stated caveat: RV2 also shows TRAINER can `SELECT count(*) FROM core.approval_requests` directly (2 rows) under 014. So this is an inconsistent FORBIDDEN answer, not a new data path. The fix, if wanted, is to also require `approval:read` in the `APPROVAL_REQUEST` branch. It is not a blocker.

### F3 · MEDIUM (web contract, not SQL) · two VIEW_READS still use the wrong key or view

- `getContactConsent` still reads `v_contact_consent_current`, whose columns are snake_case and whose `granted` is the raw flag, not the effective one. The contract's `ChannelConsent` is `{channel, granted, recordedAt}`. 020 built `v_contact_channel_consents` for this. The web switch has not landed.
- `getProgrammeDeliveries(programmeRef)` (`ProgrammeDetailPage.tsx:92`) calls `.match({ programme_id: <ref> })` against a `uuid` column. PostgREST will answer 22P02 / 400. 020 appended `programme_ref` for exactly this. The web must match on `programme_ref`.

Every other VIEW_READS name matches a 020 view. Contract keys, checked against `packages/contract/src`, match for all 17. Small nuance: `ProgrammeDelivery.evaluation` is `number`, but the view gives NULL when there are no responses (documented in the view comment).

### F4 · LOW (pin teeth) · T9's cross-tenant check is blind for 5 of 17 views

For each view in turn, I set `security_invoker = false` (the view owner is BYPASSRLS, so the view then reads across tenants) and re-ran the pin:

| Views | T9 catches it? | RV4 (generic id/ref sweep) catches it? | Actually leaks? |
| --- | --- | --- | --- |
| org_relations, templates, saved_views, trainers, contacts, programme_deliveries, rule_change_sets, agent_evals, knowledge_sources | yes | yes | yes |
| `v_hrdc_deadlines` | **no** | yes | yes (tenant B saw `ENG-2026-0001`) |
| `v_policies`, `v_collection_rules` | **no** | **no** | **yes**: measured separately, tenant B saw tenant A's collection rule and all 42 policies |
| `v_contact_channel_consents` | no (vacuous) | no (vacuous) | not reached: the T9 principal is MD, and MD lacks `contact:consent:read` (002 grants it to SALES, SALES_MANAGER and OPS only) |
| `v_budgets`, `v_model_tiers`, `v_programmes`, `v_compliance_rules` | no | no | **no**: their definer row sources filter on the claim tenant themselves, so they are safe even with the flag off |

The live posture is correct. §7 V5 asserts `security_invoker=true` structurally, and so does 014's sweep. So this is a regression-guard gap in the pin, not a live leak. A future pin should probe with a principal that holds every read permission, and assert per-view row counts against a per-tenant expected count, not string marks.

### F5 · LOW (availability) · per-row RPC fan-out inside views

- `v_saved_views.count` runs the full `core.list_approvals` / `core.list_enquiries` engine **once per saved view per read**. Each run includes a count, the groups, the page, a lookahead and a tenant-wide median.
- `v_programmes` and `v_compliance_rules` call a definer RPC per row.
- `v_trainers."bookedDates"` runs `generate_series` over each booking's range, and `trainer_bookings` has no upper bound on `ends_on - starts_on`.

All of this is tenant-local, and bookings are only written through actions. Worth a cap or a precomputed count before tenants grow.

### F6 · LOW (information, within tenant) · `v_saved_views.count` for ENQUIRY views uses an unchecked list RPC

`core.list_enquiries` is one of the 24 018 RPCs without a permission check (the header assigns them to 021). So any `view:read` holder gets a count for enquiry views even without `enquiry:read`. This goes away when 021 adds that gate.

## Security lenses: what was checked and held

- **Cross-tenant through views (RV4, generic).** I collected every `id`/`ref` of tenant A and tenant B from every `core` base table that has `tenant_id` (128 and 56 marks; marks shared by both tenants or shorter than 6 characters were dropped). Then I took each tenant's MD snapshot of all 17 views. Result: tenant A sees 14 of its own marks (the check is not vacuous), tenant B sees 0 of A's, and A sees 0 of B's. Every join in all 17 views is tenant-qualified (`x.tenant_id = y.tenant_id AND …`). All tables read are `relrowsecurity` and `relforcerowsecurity`. Every `core` view in the database is `security_invoker=true` (0 exceptions).
- **Fail closed (RV3).** Claims with no `tenant_id`: all 17 views raise 42501 (`require_tenant_id`), and `core.ai_budget_rows()` raises 42501. Empty claims: the permission InitPlan is false, so views return 0 rows, and `v_budgets`/`v_model_tiers` raise 42501.
- **Definer row sources.** `core.ai_budget_rows()` and `core.ai_model_tier_rows()` are `SECURITY DEFINER` with `search_path=""` and `statement_timeout=10s`, owned by the migration role. The tenant comes only from `app.require_tenant_id()`; they take no arguments. They are revoked from PUBLIC and anon, and `app.has_permission` runs inside. RV6: SALES gets `[0,0]` rows and MD gets `[1,1]`. `app._money`, `app._budget_rows` and `app._model_tier_rows` are still not executable by `authenticated` (V7b).
  - On search_path: the brief asked for `pg_catalog` first and `pg_temp` last. The repo rule is `search_path = ''` (supabase/CLAUDE.md rule 1, test_001 T3). With an empty path, `pg_temp` is implicitly searched first for relation and type names. Every relation in 020 is schema-qualified. Unqualified *type* names (`jsonb`, `text`, `uuid`) could only be shadowed by a caller able to run DDL in its own session, and PostgREST offers no such path. This is a standing repo-wide posture, not a 020 finding.
- **Non-enumerable errors (RV5).** Tenant B calling `get_approval(<tenant A approval uuid>)` gets exactly the same response as for a random uuid, apart from the echoed `id`. `get_audit('approvals', …)` returns byte-identical results for both. The CLIENT FORBIDDEN response is identical for real and fake ids (pin T3). The permission gate comes before any read in all three functions (V3c checks `get_approval`; I checked `list_approvals` and `get_audit` by reading).
- **get_audit correlation.** Both the approval lookup and the audit read filter on `tenant_id = v_tenant`, and `correlation_id` is a uuid. That is two independent guards against pulling in another tenant's events. Within a tenant it returns the action's `SUBJECT`-role events, which is the design.
- **diffHash.** It is emitted from the stored `approval_requests.diff_hash` (NOT NULL). `app.decide_approval` recomputes the hash from fresh effects and compares it to the stored value (011:3013 → DIFF_CHANGED). Then it compares the client's echo to the stored value (011:3020 → stale). The 014 wrapper refuses a missing hash. A client can only *echo* the hash; it cannot choose it (pin T2: stale hash → DIFF_CHANGED, no hash → VALIDATION_FAILED).
- **Overloads and ACL (RV7).** Exactly one definition each of `list_approvals`, `get_approval`, `get_audit`, `ai_budget_rows`, `ai_model_tier_rows` and `decide_approval` across `core` and `public`. No PUBLIC EXECUTE and no anon EXECUTE. `decide_approval` keeps 014's `(uuid,text,text,text,text)`. So there is no PGRST203 exposure.
- **Grants on views.** All 17 are granted SELECT to `authenticated` and not to anon (pin T10: anon gets 42501 on all 17).

## Teeth (does the pin fail when it should?)

| Mutation (on a copy of the 020 database) | Result |
| --- | --- |
| M1 · remove `has_permission('ai:budget:read')` from `core.ai_budget_rows()` | pin **fails** at T8b (SALES reads `v_budgets`) |
| M2 · remove the `approval:read` gate from `core.get_approval` | pin **fails** at T3b (CLIENT reads the full detail) |
| M3 · `v_hrdc_deadlines` with `security_invoker=false` | T9 **passes** (gap, F4). RV3 and RV4 **fail** (they catch it). |
| Per-view `security_invoker=false` sweep | see the F4 table |

## Gate notes (migration-retrofit-qa G2–G4)

- **G0.** All four artifacts are present. The catalog was not re-audited line by line; it is in scope for main's catalog lint.
- **G1.** A retrofit: CREATE OR REPLACE with byte-identical signatures, new views, and no spine objects touched. V1, V4 and V7 enforce the claims about signatures and overloads.
- **G2.** Items 1–3 and 5–7 hold. **Item 4 is wrong for `get_audit`** (F1): the header lists the feature call site but not the adapter transform between it and the RPC. That missing hop is how F1 shipped.
- **G3.** Overloads, deploy order, posture, authz order and non-enumerability all hold. No locks or `WHEN OTHERS` blocks are added.
- **G4.** The pin is runnable (real `auth.users` rows; one statement per impersonation probe; results parked in GUCs; ends with `ROLLBACK`). Measured: 10/10 PASS. Gaps: F1 (spelling) and F4 (T9 teeth). T8's notice says "six" views but checks seven.

## Appendix · maintainability (thermonuclear lens; none of these block)

1. **Two audit vocabularies.** The web's `aggregateTypeOf` regex and 020's `VALUES` map each translate resource segments, differently, and F1 is where they disagree. One owner is needed. Simplest: the web sends the raw segment and the database map is the single translation, with every `endpoints.ts` resource segment covered by a pin row.
2. **File size.** 1,389 lines is a new file over 1k. It is organised into numbered sections with a worked header, but §4's 14 views would read better as their own migration from the one repairing the approval RPCs.
3. **Copy-paste bodies.** `list_approvals` and `get_approval` are full re-copies of 018 to change one key each (the rollback then reproduces them again). This is the standing repo rule and is kept, but each replacement adds about 350 lines of drift surface. `app._approval_projection(row)` shared by list and detail would make the next change a one-line diff.
4. **View-over-RPC reuse** (`v_programmes`, `v_compliance_rules`) avoids a second projection, which is the right call for drift, but at the per-row cost noted in F5. If lists grow, invert it: a set-returning projection that both the RPC and the view read.
5. **V3c** checks gate-before-read only for `get_approval`. Extend it to `list_approvals` and `get_audit`, or better, pin it behaviourally as T3 does.
6. **T9** relies on hand-picked marks. Replace it with the generic sweep plus per-view expected counts (F4).

## What I could NOT verify, and what would settle it

- **Hosted behaviour.** I had no hosted access. The shim reproduces hosted's owner attributes and default ACLs, not PostgREST itself. To settle it: one real browser session per role on hosted, hitting `GET /rest/v1/v_budgets` and `/rpc/get_audit` with `p_resource_type=APPROVAL`. The latter should return an empty list today, confirming F1 in production.
- **PostgREST 22P02 for F3's `programme_id=<ref>`.** Inferred from the column type, not observed. To settle it: one hosted REST call.
- **Real emitter coverage for the approval trail.** 001–020 emit no in-database event on decide, so T5 uses a synthetic `emit_event`. To settle it: approve one item on hosted after F1 is fixed and read the drawer.
- **Codex D-012 trace pass.** Not run in this lane, so it is still owed if main wants the dual review.
