# Migration Catalog

> The canonical record of every Supabase migration in TrainOS. One Migration Order row and one
> Migration Detail section per migration, updated in the SAME commit as the migration itself.

**Migrations:** 24 (numbered up to 030; 024 is this lane's, 023 and 025–029 are sibling lanes not on this branch) · **Applied (hosted):** 001–019, 021, 022 · **Authored, not applied:** 020, 024, 030
**Last snapshot of `tables/`:** never
**Amendment passes:** 2 (2026-09-13 rulings R-EXT / search_path / FORCE RLS; 2026-09-13 pack 014 — six earlier pins amended from "before 014" to the post-014 state, each marked ⚠ AMENDED BY 014 in place; 2026-09-13 pack 016 — ten pins' ref_formats fixtures made upserts, because 016 now provisions what they were faking; 2026-09-13 pack 017 — test_006's trainer fixture and test_014's two counts updated for the constraints and tables 017 adds; 2026-09-13 pack 014 review pass — 014's forward, rollback and pin revised against docs/reviews/2026-09-13-codex-retrofit-014-017.md, a new post-rollback pin added at supabase/tests/test_014_rollback_restores_002_grants.sql, and scripts/check-grants.mjs given a pg_temp exception; no file in 001-013, 015 or 016 was touched; 2026-09-13 pack 016 — `app.provision_tenant` gained `p_id`, requested by the seeds lane; 2026-09-13 pack 018 — **018 does not edit `test_014` at all**: its three `core` view grants are asserted in `test_018` T38 by name. ⚠ `test_014` counts LIVE grants and therefore reads 124 once 018 is applied; scoping that assertion to 014-time objects is owed to the 014 lane, and the exact assertion is in PR #11's body. 2026-09-13 pack 019 — test_008's and test_009's pipeline fixtures amended, because a default `ENGAGEMENT` pipeline per tenant is now a repo-wide fact and `pipelines_one_default_uq` is a partial unique index on `(tenant_id, object) WHERE is_default`; ⚠ `test_016` and `test_017` on `cloud/migrations` need the same amendment and their newer versions are not on this branch, so both are owed at rebase with the exact edit recorded in 019's detail section)

---

<!-- Dated narrative entries go here, newest first, prepended. Each names the migration
     number, the concrete change, the evidence checked, and what was deliberately left
     alone. A correction to an earlier entry is a NEW dated entry pointing at the old one;
     the old one is left standing. -->

**Last updated:** 2026-09-14 — **024 authored and EXECUTED: training delivery — the seven §8/§6 client methods the gap matrix marks NO-ADAPTER (`listEngagements`, `getEngagement`, `getEngagementParticipants`, `getAttendance`, `captureAttendance`, `exportAttendance`, `putProgramme`).**
Seven new `core` RPCs, no DDL — every table they read or write already exists (008 delivery, 006 catalogue). **The gap-matrix audit was stale for this domain**: its SQL truth predates 020, which already shipped `core.v_trainers`, `core.v_programmes` and `core.v_programme_deliveries`, so `/training/trainers` and `/training/programmes` already had SQL; verified by grep against 001–021 before writing a line, and confirmed by leaving all three untouched here. **A second, pre-existing bug found on the way**: `rpcClient.ts`'s `getProgrammeDeliveries` matched PostgREST's `.match({programme_id: id})` against `v_programme_deliveries.programme_id`, a UUID column, while the caller always holds the route's REF (`:programmeRef`) — fixed the same way `getOrganisationRelations` already does, by resolving through `get_programme`'s own id-or-ref lookup before the view read; not a 024 SQL change, an adapter fix in the same commit because it blocks the same screens. **Every function follows 018/021's pattern exactly**: `SECURITY DEFINER`, `SET search_path = ''`, the permission gate as the first statement (021's rule), reads refuse `app.err('FORBIDDEN', {requiredPermission})`, writes raise `TRNOS`, list/get pairs reuse 018's keyset-pagination helpers rather than a new engine, and writers return through their sibling reader (`capture_attendance` → `get_attendance`, `put_programme` → `get_programme`). **`get_engagement` drops `finance`, not zeroes it**, for a caller without `quotation:read` — the same R7 ruling 018 made for `get_proposal`'s margin block. **`capture_attendance` reconciles a schema/fixture mismatch**: `core.attendance_entries`' `ae_absent_needs_reason` CHECK (008) requires a reason whenever `present = false`, but the fixture client leaves it optional; an absence with no caller-supplied reason now defaults to `OTHER` rather than violating the constraint the fixture never had to satisfy. **`put_programme` is scoped to the record's own scalar fields, not its four child arrays**: `core.programme_pricing_tiers.floor_price_sen` is NOT NULL and the contract's `PricingTier` (`{maxPax, price}`) carries no floor, so a client-supplied tier cannot be inserted without inventing a business number the contract never sent — flagged as a decision to confirm, not built silently. **Scope-narrowing (○ in 002 §11) is not applied**, same posture 018/021 already state for the rest of the golden path: a TRAINER with `engagement:read` sees every engagement in the tenant through these RPCs, not only their own; reported again here rather than fixed as a side effect of an unrelated lane. Pin `test_024`: ADMIN reads real data with `finance`; OPS reads the same record without it; CLIENT is FORBIDDEN on all seven, byte-identical for a real id and an invented one; `anon` gets 42501 from the grant itself; a tenant-B ADMIN reading tenant A's engagement ref gets non-enumerable NOT_FOUND; an OPEN day accepts a present and a defaulted-reason absent mark, a LOCKED day refuses with the contract's exact `AttendanceLockedDetails` shape; ADMIN's `put_programme` write reads back through `get_programme`, OPS is FORBIDDEN naming `requiredRole: 'ADMIN'`. Executed against the hosted-like PostgreSQL 17 shim as a NOSUPERUSER BYPASSRLS role; `test_021` re-run on a fresh 001–021 build to confirm no regression; `lint:sql`, `check:grants`, `check:rpc`, `typecheck`, `typecheck:strict`, `lint`, the full `npm test -- --run` (128 files / 1223 tests plus fixtures/agent-runtime/worker), `npm run build` and the `VITE_API_MODE=supabase` build all pass.

**Last updated:** 2026-09-14 — **030: `core.me_profile()`'s `session` block never leaks a null required field, closing a defect 022 shipped and hosted's own run of `test_022` caught.**
One `CREATE OR REPLACE FUNCTION core.me_profile()`, nothing else — no table, no type, no policy, no other function touched. **The defect, found by running 022's own pin against hosted rather than by reading:** 022's header promises `session` answers `null` AS A WHOLE whenever `lastSignInAt` cannot be derived, and 022's `v_has_session` variable exists to keep that promise — but it only flips to `false` inside `EXCEPTION WHEN undefined_column`, the COLUMN-ABSENT case. When `auth.users.last_sign_in_at` EXISTS (true on hosted) but a particular row's VALUE is `NULL` — true for `test_022`'s own INSERT-not-signed-in fixture users, and equally true for any real hosted account GoTrue has not yet stamped a sign-in for — the read succeeds with no exception, `v_has_session` stays at its default `true`, and the function emits exactly the shape its own header forbids: a populated `session` object with `lastSignInAt: null`. `test_022`'s `T1j` (PR #48, commit `05e7360`) asserted the branch the column's PRESENCE implies and failed on hosted — not because the assertion was wrong, but because the function did not keep its own promise. **The fix is one `IF` statement**, immediately after the existing exception handler: `v_has_session` is now also set `false` when the read succeeds but `v_last_sign_in IS NULL`, subsuming the exception path (a harmless no-op re-confirmation there, since `v_last_sign_in` is already `NULL` by its declared default whenever the exception fires) and closing the gap it did not cover. Every other line — permission gates, `moduleCount`, `activeSessions`, `twoFactorEnabled`, the two dashboard RPCs (untouched, not redefined) — is 022's, unchanged. **Nothing changes for a caller who has actually signed in**: GoTrue stamps `last_sign_in_at` on every real sign-in, so a real session continues to get a populated `session` with a real `lastSignInAt`, confirmed against hosted directly before this migration was authored. This migration only changes the answer for a principal GoTrue has not yet stamped one for, closing a leak rather than opening a gap. **`packages/contract/src/domain/shell.ts` and the web reader (`SidebarProfile.tsx`) already document and expect this exact corrected shape** (PRs #49/#50, landed on `origin/main` ahead of this migration) — this migration is what makes the database true of the contract the web lane already built against, not the reverse. Pin `test_030`: three cases, branched STRUCTURALLY on whether `auth.users.last_sign_in_at` exists rather than assuming one environment — column absent (this local shim): `session` null as a whole, unchanged from 022; column present, value null (the closed defect): `session` null as a whole; column present, value set: a full object with exactly the 5 `ProfileSession` keys and a real, non-null `lastSignInAt`. Verified against both the unmodified local shim (only the absent-column case fires) and a locally-extended copy with `auth.users.last_sign_in_at` and `auth.mfa_factors` added (not checked in; both hosted-shaped cases fire and pass). `test_022`'s own `T1j` fixture gained a small addition in the same commit: its T1 principal now gets a real `last_sign_in_at` WHEN the column exists (a no-op `UPDATE` guarded the same structural way, otherwise absent), so `test_022` exercises the "real value" branch it always intended rather than accidentally tripping over 030's own defect — the never-signed-in/null-value case is deliberately left to `test_030` alone rather than duplicated. Rollback restores 022's original (defective) body verbatim. `test_001`–`test_022` all still pass unmodified on a clean 001–030 build (021, 023–029 excluded — the latter are sibling lanes not on this branch). `npm run lint:sql` 74/74, `npm run check:grants`/`npm run check:rpc` clean. Spine untouched: no action type, no handler, no branch in the envelope.

**Last updated:** 2026-09-14 — **022: `core.me_profile` and the two executive-dashboard RPCs 020 reported NOT BUILT, built from real tenant data with `null` where nothing real exists.**
Three new `core` functions (`me_profile()`, `get_executive_dashboard(text)`, `get_proposals_vs_won(integer)`), no table, no type, no policy, nothing replaced. `core.get_hours_saved` is deliberately NOT built and `ADMIN_HOURS_SAVED` deliberately does not appear in the metrics array — no baseline-minutes table exists anywhere in 001–020, and DECISIONS §4 calls the figure ILLUSTRATIVE in its own words. **The ruling, applied rather than argued around:** `MeProfile.location`/`jobTitle`/`department`/`staffNumber` are emitted `null` — no table in 001–020 carries a work location, a job title, a department or a staff number — with the web/contract lane widening those fields to optional in the same window. `session` (`ProfileSession`) is neither a blanket `null` nor a blanket object: a second, later ruling (raised by `web-022`, answered by the coordinator, then tightened once `packages/contract/src/domain/shell.ts` landed on origin/main making `lastSignInAt` a REQUIRED field and `session` itself optional and nullable AS A WHOLE) makes the ENTIRE block answer `null` whenever `lastSignInAt` cannot be derived — never a populated object with a null required field — and a FULL object otherwise: `browser`/`place` stay `null` inside it (no user-agent/geoip storage anywhere in this schema); `activeSessions` is a real `COUNT(auth.sessions)` for the caller (confirmed definer-readable); `twoFactorEnabled` reads `auth.mfa_factors`, guarded on `to_regclass` and `null` where the relation is absent. `lastSignInAt` itself reads `auth.users.last_sign_in_at` guarded on a caught `undefined_column` — both are standard GoTrue objects on hosted Supabase that this lane has no hosted access to confirm, absent (as here) from the local shim. Verified ad hoc against a locally-extended copy of the shim's `auth` schema (not checked in) that both the whole-block-null path and the full-object real-derivation path produce the contract's exact shape, matching the merged web reader (`apps/web/src/shared/components/layout/SidebarProfile.tsx`), which gates on `details.session` before reading anything inside it. **Every other field is real.** `moduleCount` reuses (duplicated, the cost named) the same 14-row nav-permission match `core.navigation()` (018) filters its `MAIN` group by, counted rather than rendered — MD reads 13, because MD holds the three scoped `compliance:*` permissions but not the bare `compliance:read` the nav list actually checks. `email` comes from `auth.users`, not the nullable `user_profiles.email`. **The four dashboard metrics are each one real aggregate**, formulas worked in the migration header: `OPEN_PIPELINE` sums `core.opportunities.value_sen` over the three stages the fixture's own drillTo names (QUALIFYING/PROPOSAL_SENT/NEGOTIATION — not all five non-terminal stages); `AR_OVERDUE` sums `core.invoices.outstanding_sen` where `status='OVERDUE' AND voided_at IS NULL`; `PROPOSALS_SENT` counts `core.proposals` whose frozen `sent_at` falls in the quarter `p_period`'s month sits in, regardless of a later status change; `CLAIM_VALUE_AT_RISK` sums `core.hrdc_packets.claim_value_sen` where `panel_state IN ('DEADLINE_AT_RISK','BLOCKED')` — the DB spelling of the contract's `HrdcDeadlineStatus='AT_RISK'`, a divergence `packages/contract/src/enums.ts` documents and says not to unify. `approvalsPending` reuses `core.v_approval_requests` (011/020) unchanged rather than re-deriving urgency. `agentActivity`/`autonomyMix` derive per-run autonomy from `core.action_requests.granted_level` (defaulting `OBSERVE` for an ungoverned run), `costMonth` from `core.runs.cost_sen`, `evalScore` from `percentile_cont(0.5)` over `core.evals` (013's own comment calls this "a rolling median"), rounded to 3 decimals to kill a `0.8500000000000001` double-precision artifact found by running the pin. `agentSpend` sums `core.budget_status` at `scope='AGENT'` — `core.budget_scope` has no TENANT value, so per-agent budgets are the tenant-wide figure at the same granularity as `agentActivity`. **No `delta` is emitted anywhere**: no table in 001–020 snapshots a prior period, and `DashboardMetric.delta`/`MetricResponse.delta` are optional — inventing a "vs last period" figure would be exactly the fabrication the ruling forbids. `TenantIdentity.code` is `null` (`public.tenants` has no short-code column); `mobile` stays absent (already optional, no table carries one). Both dashboard RPCs gate on `dashboard:executive:read` — narrower than the generic `dashboard:read` six roles hold, already seeded for SALES_MANAGER/FINANCE/MD/ADMIN, and the closer match to the contract's `roles:['MD']` on all three `/v1/dashboards`, `/v1/reports/*` endpoints; `me_profile` gates on membership only, matching `core.me()` (018). **Found by executing, not by reading:** `jsonb_agg` cannot wrap a window-function call directly ("aggregate function calls cannot contain window function calls"), so `autonomyMix`'s rate is materialised in its own CTE first; `app._money(bigint,text)` refuses a bare `SUM(bigint)` result because Postgres's `sum(bigint)→numeric` has no implicit cast to `bigint` in function-argument position, closed with explicit `::bigint` casts at both call sites that pass a live aggregate rather than a declared `bigint` variable. Pin `test_022`: built and run against a hosted-like PostgreSQL 17 shim (a NOSUPERUSER BYPASSRLS role standing in for hosted `postgres`, akademi-perdana-shaped fixtures), 50/50 assertions pass — MD's exact 9 `MeProfile` keys, the 4 unstorable top-level fields, and `session` answering `null` AS A WHOLE (this shim has no `auth.users.last_sign_in_at` column, so the REQUIRED `ProfileSession.lastSignInAt` cannot be derived); all four dashboard metrics equal hand-computed sums against seeded opportunities/invoices/hrdc_packets/proposals (walked through `core.state_transitions`' registered edges — `opportunities.stage`, `proposals.status` and `invoices.status` are all gated columns, and a direct `INSERT ... VALUES ('QUALIFYING', ...)` is refused as an illegal `NULL -> QUALIFYING` transition; the PROPOSAL_SEND/INVOICE_CREATE/INVOICE_PUSH-gated hops are crossed with test_005's `app.effect_applier` fixture pattern, not gone around); agentActivity/autonomyMix/agentSpend equal seeded runs/evals/usage-rollup/budget rows; OPS (holds `dashboard:read`, not `dashboard:executive:read`) is FORBIDDEN naming the missing permission; anon is refused 42501 on both RPCs; a malformed and a NULL `period` are `VALIDATION_FAILED`; tenant B's MD sees zero on every metric and an empty agent/approval list; `get_proposals_vs_won` hand-verifies the current month and the month 4 months back, and a 0/NULL `months` is `VALIDATION_FAILED`. **Re-verified after merging `origin/main`** (which had landed 021 and the web PR in the meantime): rebuilt as 001–021+022, `test_021` (10/10) and `test_022` (50/50) both pass individually; `app.provision_tenant`'d `akademi-perdana` with its three real MD users and loaded `supabase/seeds/hosted_demo_akademi_perdana.sql`, then `supabase/seeds/test_hosted_demo.sql` (the seed's own pin) — ALL PASS. A clean 001–021+022 build (no demo seed) re-runs every `test_00N` pin unmodified, all still green (the same two pre-existing special-purpose scripts, `test_014_rollback_restores_002_grants.sql` and `test_017_applies_over_existing_quotations.sql`, fail standalone as they always have — unrelated to 021 or 022). Running the full pin suite AFTER the demo seed (rather than each in isolation) makes `test_014` and `test_019` fail on seed-state collisions (a duplicate tenant slug, a seeded-approvals count) — expected, since neither pin is written to coexist with persisted demo data in the same database, and not evidence of a regression. `npm run lint:sql` 71/71 (PR #45 fixed the psql-meta-commands gap that previously excluded one seed file), `npm run check:grants` clean, `npm run check:rpc` 0 broken. **Confirmed no collision with 021**: 021 replaces `badge_counts` plus 23 other 018 RPCs, three 011 dispatch functions and 019's seed function — none of `me_profile`, `get_executive_dashboard` or `get_proposals_vs_won`, and 021 does not touch `app.role_permissions` or `core.navigation()`'s permission list, so MD's `moduleCount` = 13 is unaffected. **Owed, not run here:** the skill's G5 dual adversarial review (thermonuclear + Codex trace) — a Codex review was dispatched in parallel by the coordinator instead. Spine untouched: no action type, no handler, no branch in the envelope.

**Last updated:** 2026-09-13 — **017: the amendment pass. Nine PUBLIC grants nobody intended, seven unconstrained jsonb columns, two wrong numeric precisions, and the regulatory shape the September research says the baseline is missing.**
Three tables, four functions, two views, nine REVOKEs, seven CHECKs, two type changes, eight new columns, one unique constraint and the HRD Corp registry rows. **Applied nowhere.** This is the most dangerous migration in the pack: every statement runs against a table that may already hold rows, and two of them change a column's TYPE.

**The nine PUBLIC grants, and why 014 is what made them urgent.** 001 measured that doc 02 §4.1's `ALTER DEFAULT PRIVILEGES … REVOKE ALL ON FUNCTIONS FROM PUBLIC` **does not take** — it records no `pg_default_acl` row and a function created afterwards is still executable by PUBLIC — kept the line as documented baseline, and named the real guard as per-object REVOKE plus a sweep. Nine `core` functions from 007 and 009 slipped through it. Eight are trigger functions, where the grant is harmless because the executor invokes them regardless. **`core.apply_rule_offset` is not**: it takes a date, an integer and an offset unit, returns a date, and is the arithmetic behind every HRD Corp deadline in the registry — the one of the nine PostgREST will actually call, because the other eight take no arguments and return `trigger`. Before 014 none of it was reachable, since `authenticated` had no `USAGE ON SCHEMA core`; **014 granted that USAGE and turned a latent defect into a live one**, which is why the revoke lands immediately after it rather than being filed. T1 sweeps the catalogue for PUBLIC-executable functions rather than checking the nine by name, and separately proves `apply_rule_offset` is refused to an impersonated caller with `42501`.

**R-JSONB on the last seven columns, TYPE HALF ONLY, said out loud.** 012's sweep re-derived against the full set leaves exactly seven. All seven get `jsonb_typeof` and none gets a key assertion, and the file states why rather than letting a reader assume: **none of the seven has a consumer that declares any keys** — no SQL reads them, no comment names a shape, no contract entry fixes one. Inventing required keys would freeze a shape nobody agreed on a table that may hold rows. 013 set the same precedent. The type half is not nothing: `jsonb` accepts `"hello"`, `42` and `true` as valid scalars, every one survives an `IS NOT NULL` guard, and every one breaks the first `->>` a consumer writes — T2 feeds `"hello"` to `saved_views.filters` and watches it refused. `filters` gets `'array'` rather than `'object'` because it defaults to `'[]'`; flattening all seven to `object` would have made that table unwritable at its own default.

**Two precisions, and one of them could have moved money.** `core.quotations.margin_rate` was bare `numeric` while its two neighbours on the same row, `floor_margin_rate` and `commission_rate`, were already `numeric(6,4)` — so the binding floor was stored at four decimals and the margin compared against it was not, and that comparison is the below-floor decision 007 derives. `evaluation_responses.overall_score` was `numeric(3,2)` where the rule says three decimals and gained the 0..1 bound it never had. **Both directions are widening, which is what makes the change safe**, and the forward guard refuses rather than rounding: a margin silently rounded from 0.28571 to 0.2857 can cross the floor that decided whether a quotation needed an approval, and a migration is not the place to make that call. T3 proves the conversion by STORING 0.867 and reading it back, because a catalogue check alone passes against a column that was never really converted.

**SST is a table, never a column default (ruling R-C).** `core.tax_policies` is tenant-scoped with a national fallback and **bitemporal like 009** — validity and known, with a GiST exclusion so "which policy applied on this date as known on that date" has exactly one answer. The research is unambiguous about the position: corporate training is taxable under **Group G (Professionals) at 8% since 1 March 2024**, and the education exemption "applies only to institutions **registered under the Education Act 1996**… a private, HRD Corp-accredited corporate training provider is not that". Both policies are seeded because the exempt one is genuinely selectable. **Rates are basis points, deliberately against root CLAUDE.md's `numeric(6,4)` for tax rates**, and the file argues it: that rule governs the rate stored ON A DOCUMENT; this is a configuration value that is compared, ordered and versioned, where an integer has one representation per value. The invoice keeps 010's numeric and gains `sst_policy_id`, so "why was this taxed at 8%" finally has an answer that survives a later policy change. **The resolver RAISES when nothing resolves** rather than returning zero — a missing policy silently becoming a zero rate is an invoice filed with no SST and no reason — and T4 walks national default, tenant override, cross-tenant non-leakage, unknown category, pre-effective date and the known axis.

**Quotations get SST at last.** 010 gave the invoice `sst_rate`/`sst_reason`/generated `sst_sen`; the QUOTATION — the document the customer actually accepts — had none, so a quotation quoted net and the invoice added 8%. The columns mirror 010's names exactly rather than inventing a parallel vocabulary, `sst_sen` and `gross_price_sen` are GENERATED on the summed net, and `quotations_exempt_needs_reason` makes the exemption cost something: claiming TRAINING_EXEMPT without writing down why is refused.

**PDPA, with the numbers the research gives and without the ones it does not.** `contact_consents.purpose` and `notice_version` — consent is purpose-bound, and `UNSPECIFIED_PRE_017` marks legacy rows and is **forbidden for anything recorded after this migration**, so a pre-017 gap stays visible instead of becoming a silent opt-in. `core.data_retention_policies` rows are `QUEUED_FOR_APPROVAL` and delete nothing, which is why 015 leaves the four retention reapers unscheduled. `core.data_breach_register` carries the two statutory clocks as **GENERATED** columns — 72 hours to the Commissioner, 7 days from that to affected subjects — so they cannot be edited away, and a CHECK makes "subjects notified before the Commissioner" unrepresentable. ⚠ **`retained_until` is deliberately left unset**: the 2-year minimum some guidance suggests is flagged UNCONFIRMED in the research, and a number invented here would be indistinguishable from a researched one in six months.

**Three HRD Corp deadlines, all PROPOSED.** 5 calendar days to respond to a query (**the application EXPIRES**, so a missed query is a lost grant rather than a late one — and it is a recommended ADDITION, absent from the proposal pack's Appendix B entirely), 90 days to commence, 6 months to claim. The claim window is marked unconfirmed in the research because the circular PDF was unreachable; it is seeded anyway and flagged, because an unseeded rule is invisible while a PROPOSED one is a question somebody can answer. **Nothing is inserted ACTIVE from a document alone**, per the research's explicit instruction and 009's own `cr_active_needs_verification`. T8 asserts each offset WITH its unit, because "5" with the wrong unit is five months to answer a query that expires in five days.

**HRD-TDF gets an expiry date and a corrected citation.** 006's boolean says a trainer was accredited once; `hrd_tdf_valid_to` says whether they can take a claimable class next month. 3-year validity, 360 hours to renew, apply ≥3 months before expiry — and the mandate is **Circular 6/2024 effective 1 January 2025**, not the Circular 2/2026 the proposal pack cited. `core.v_trainer_accreditation` derives expired and expiring-soon rather than storing a flag that needs a job to keep it true.

**And the finding the pack exists to carry: `hnsw.iterative_scan`.** ⚠ There was no retrieval RPC in 001–016 — 013 created `knowledge_chunks.embedding` and 001 the HNSW index, and nothing read either — so 017 creates `core.retrieve_knowledge`, because the finding is a property OF that function and has nowhere else to live. **The setting defaults to `off`, and under RLS that silently under-returns**: an HNSW scan returns ~`ef_search` candidates and the tenant predicate is applied ON TOP of them, so a tenant holding 2% of the table asks for k=10 and gets one row — not an error, not a warning, just a short answer that looks like "there wasn't much relevant", with every RAG answer built on it quietly under-grounded. `SET LOCAL … = relaxed_order`, local so a pooled connection cannot carry it into somebody else's query. **T10 measures it** with Beta holding 2,000 chunks and Alpha 40, and asserts both halves: k rows come back, and every one is the caller's own.

**Four defects found by executing rather than reading**, and three of them by re-running the file: `timestamptz + interval` is STABLE not IMMUTABLE so the breach clocks needed a UTC pivot; `SET LOCAL` is refused inside a non-volatile function, raised at CALL time rather than CREATE time so it survived the migration and was caught by the pin; the check keys were seeded with `CROSS JOIN public.tenants`, which is correct SQL that seeds NOTHING on an empty database and nothing for every tenant created afterwards — they now go through 016's provisioning shape, making three seeds on `public.tenants` (011 policies, 016 ref formats, 017 check keys), which is the pattern working rather than three copies of it; and **`ADD CONSTRAINT` has no `IF NOT EXISTS` for the third time in this pack** (004 hit it, 006 hit it, 017 hit it), alongside two seeds that duplicated on re-run because neither had anything to conflict against.

**Spine untouched.** No action type, no handler, no branch in the envelope.

**Last updated:** 2026-09-13 — **016: tenant provisioning, and the hole in the middle of the database that every pin since 011 has been stepping around.**
Two functions and one trigger. No table, no view, no type, no policy, no column. **Applied nowhere.**

**The hole.** `core.next_ref()` raises `no ref_format for prefix % in this tenant` when a tenant has no `core.ref_formats` row for the prefix being allocated. Thirty-two `core` tables carry a `core.assign_ref` trigger, so for a tenant with no formats, thirty-two tables are unwritable. **No migration seeded them.** 013's catalog entry carries it as a standing condition and test_013's header says it outright — "016 provisions those, so this pin seeds its own AGT and RUN rows". Ten pins seed their own. Every one of those fixtures was standing in for a provisioning step that did not exist, which means **no pin in this pack had ever exercised the path a real customer takes.** T2 is that path: one `INSERT INTO public.tenants`, no fixture, and a real `ORG-0001` allocated through the trigger.

**The rows are DERIVED from `pg_trigger`, and the reason is a measurement rather than a preference.** The obvious 016 is thirty-two `INSERT … VALUES` lines. Building that list by reading the migrations for `finalise_table(…,'PREFIX')` yields **twenty-seven**. The real number is **thirty-two**. The five a line-based read misses — `ATT`, `PIP`, `SIG`, `SVW`, `TPL` — are missed because their `finalise_table` calls wrap across lines and the regex stops at the newline. That list would have shipped, looked complete, and left attachments, pipelines, signatures, saved views and templates unwritable for every customer, discovered the first time somebody saved a view, in production, as a raw `foreign_key_violation` from inside a trigger. Every `assign_ref` trigger declares its prefix as `TG_ARGV[0]`, which is the same string `next_ref` is handed at run time, so the seed and its consumer are the same list **by construction** — 003's argument for generating sixty-nine enum types from the contract package, applied to provisioning. A thirty-third ref'd table added by 018 is provisioned on the day its trigger is created. T1 asserts all five of the missed prefixes individually.

**Provisioning is a trigger, matching 011 rather than inventing a shape.** `trg_tenants_seed_ref_formats` fires `AFTER INSERT ON public.tenants`, exactly as 011's `trg_tenants_seed_action_policies` does. A provisioning SCRIPT is something a human remembers to run, and `public.tenants` is written by the onboarding path, by a seed, by a test fixture and by whatever lands next; the trigger is the only thing covering all four. `app.provision_tenant()` exists for the explicit case and **does not duplicate the seeding logic** — it inserts and lets the triggers work, then refuses to RETURN a tenant that has no ref_formats or no action_policies. T3 disables the trigger and proves the refusal fires: a tenant that looks provisioned and cannot write a ref'd row should fail there, not at the customer's first enquiry.

**Idempotence, in the direction that matters.** Re-seeding LEAVES AN EXISTING ROW ALONE rather than overwriting it. `ref` is immutable after insert, so flipping `dated` under a tenant that has already allocated `ENQ-2026-0912` would leave every ref issued so far in the old shape and every future one in the new, with no way to correct either. T4 corrupts a format deliberately, re-seeds, and asserts it was **not** repaired — because the repair is the dangerous direction.

**Ten pins were amended**, each fixture given `ON CONFLICT (tenant_id, prefix) DO UPDATE`, so the pin's own explicitly chosen shape still wins inside its own rolled-back transaction while the collision with real provisioning disappears. ⚠ Two of those edits were made by a script that split statements on the first `;` and landed inside a comment containing one; both were caught by the suite, reverted from git and redone by hand. Recorded because it is the kind of mechanical edit that looks safe across ten files and is not.

**⚠ What 016 does NOT seed, with the reason for each.** `pipelines` / `pipeline_steps` — the second spine. Seeding them means writing fifteen stage names into a migration, which is precisely the defect both CLAUDE.md files name ("a hardcoded stage list anywhere in SQL is a defect"), and doing it in a file about ref formats. **Owner: 018 or a dedicated seed pack; until then a new tenant renders no pipeline.** The HRD Corp rule registry — national (`tenant_id NULL`), so not provisioning at all, and the research attaches an explicit condition: all rows load `status = 'PROPOSED'` until a named Finance verifier confirms each against the circular text. 017 owns those. Rate cards and templates — customer data, not schema.

**Spine untouched**, and the pipeline spine deliberately untouched too, which is the stronger statement.

**Last updated:** 2026-09-13 — **015: the scheduler, and the seven jobs it deliberately does not schedule.**
001's header promised that "nine scheduled behaviours in the design… are scheduled with cron.schedule in 015". 015 schedules **two**, and the other seven are the content of the migration. One function, two cron jobs, no table, no view, no type, no trigger, no policy. **Applied nowhere.**

**Ruling R-B is the reason and it is stated with its counter-evidence.** Background work is one Node worker (`apps/worker`, merged on main) polling `app.claim_jobs`; pg_cron is for `reap_jobs` and cron-history retention only; there are no pg_net nudges. ⚠ **This contradicts current Supabase documentation and the header says so outright**: `docs/research/2026-09-13-supabase-current-docs.md` §4 records that Supabase's own guide documents `cron.schedule` → `net.http_post` → Edge Function as supported and confirms requests do not start until the transaction commits. That research is right and is not overruled on technical grounds — it is overruled by **R-A, which says this product has no Edge Functions at all**, so the far end of the nudge does not exist. A supported pattern pointing at nothing is still pointing at nothing. Recorded in full because the next author will read the same Supabase page and wonder why this file ignores it. The payoff is that nothing in this database makes an outbound HTTP request, and pg_net's beta caveats — "signatures may change", ~200 req/s, a 2000 ms default timeout, an UNLOGGED queue with a 6-hour response TTL — become a list of things the product does not have to reason about.

**`trainos_reap_jobs` runs every 30 seconds as ONE job.** Sub-minute schedules are native on 15.1.1.61+, so doc 05's tick is one job rather than the six-jobs-each-sleeping-a-different-offset trick that burns six connections and drifts. 30 rather than 10 seconds because the worker's poll loop is the latency path and the reaper is the recovery path. Recovery is what makes `C-08` real: a handler that OOMs mid-job leaves the row CLAIMED forever, and a worker that has died cannot recover itself.

**The command is `app.reap_jobs_all_tenants(200)`, not `app.reap_jobs(NULL, 1000)`, and that is the one genuinely new object.** 012's `H-16` made the CLAIM fair per tenant with `row_number() OVER (PARTITION BY tenant_id)`; the REAPER's four statements each take a flat LIMIT across all tenants ordered by time. One tenant whose provider is down fills that limit every tick and every other tenant's expired leases are never recovered — the same starvation, arriving through the recovery path. The wrapper gives each tenant its own budget and is driven from the tenants that actually have reapable work rather than from `public.tenants`. **T3 measures it**: Alpha holds 50 expired leases, Beta holds 1, the budget is 10 per tenant, and Beta's job comes back in the same tick — plus a control proving a single-tenant reap really does leave the other tenant alone, so the wrapper is not decoration.

**`trainos_reap_cron_history` runs daily at 03:17 UTC.** `cron.job_run_details` is never purged automatically **and is not cleared when a job is unscheduled** — the second half is the one that surprises people. At a 30-second tick the reaper alone writes ~1.05M history rows a year on a table nothing reads after a few days. ⚠ **The 7-day window is unsourced and the header says so**: no research doc and no design doc gives a number, and 7 days is already compiled into 012's `app.reap_cron_history`, inherited here rather than re-litigated, stated as judgement so nobody later cites this file as its authority. T4 proves the boundary by probing at 6 days and 8 days rather than reading it out of the function.

**The seven unscheduled jobs each carry their reason.** The outbox drain and the webhook dispatcher are R-B. The four retention sweeps over business-visible rows (`reap_outbox`, `reap_dead_letters`, `reap_webhook_bodies`, `reap_webhook_deliveries`) exist as functions and are **not** scheduled because each needs a retention PERIOD agreed with the customer first — 017 creates `core.data_retention_policies` for exactly that, and scheduling them now would be deleting on a window nobody signed off. The levy staleness sweep and the embedding refresh have no function to schedule at all. **Scheduling a job whose function does not exist is worse than not scheduling it**: pg_cron records the failure in `job_run_details` and raises nothing, so it is a broken behaviour with a green-looking cron table — which is why both the verify block and T1 resolve every scheduled command's function through `to_regproc`, and T5 goes further and EXECUTES both commands as registered, because a cron command is a string nothing type-checks.

**⚠ Nothing is done to Realtime, and that is not the same as forgetting it.** The research (§7) is unambiguous that RLS on `realtime.messages` is already enabled and the schema is locked — policies are the only lever, `realtime.send` runs as the admin role and bypasses an INSERT deny, and `{ config: { private: true } }` is client configuration. The two things a migration could add are a policy over `(select realtime.topic())` and a publication membership, and both are blocked on a fact this lane does not have: **which topics this product broadcasts.** Nothing publishes a realtime message today. Inventing the topic vocabulary inside a cron migration is the same defect as a hardcoded stage list. One security property is carried forward explicitly: **policies are cached for the life of the connection and recomputed only on connect or on a new `access_token`, so revoking a permission does not close a live socket** — the design will have to disconnect explicitly, and that now lives in the migration history rather than only in a research doc.

**⚠ The harness's pg_cron is a STUB that runs nothing**, so T1 and T2 test what was REGISTERED and T3–T5 test the functions by calling them directly. What this pin does not prove is that the real background worker fires a '30 seconds' schedule — that is the extension's behaviour, not this migration's, and it is named rather than covered by a test that would pass on a stub either way.

**Spine untouched.** No action type, no branch in the envelope; the reaper operates on `app.outbox`, which is the envelope's external-effect queue and not the envelope.

**Last updated:** 2026-09-13 — **014 amended: the retrofit review's BLOCK is cleared, both CRITs and three of four HIGHs closed with pins that fail against the pre-fix SQL, and a third destroyed grant (001:232's `USAGE ON SCHEMA core`) found by executing the rollback.**
014 lands 228 policies over 115 `core` relations, SELECT-only client grants on 114 tables and two views, the `public.*` grants that put 002's twelve `authenticated` policies into service for the first time, and the three `core` wrappers that make the 011 envelope reachable from a browser. One function, no table, no type, no trigger. **Applied nowhere.**

**The shape of the pack is one function, not 114 blocks.** `app.apply_tenant_policies()` stamps two policies per table — a PERMISSIVE `FOR SELECT TO authenticated` and a RESTRICTIVE `FOR ALL` isolation policy carrying the same predicate in USING *and* WITH CHECK — and the §2 loop is driven from `pg_class`, not from a list of names. This is 004's `finalise_table` argument applied to the policy layer, and it is stronger here: a policy typo does not fail to apply, it applies and admits the wrong rows. The pin follows 004's precedent too and exercises the FUNCTION on throwaway tables rather than the 114 it happened to be run over, because testing those 114 proves nothing about the 115th.

**`authenticated` receives SELECT and nothing else, on any core table.** Not INSERT, not UPDATE, not DELETE. That is the spine rule moved down to the privilege layer: a browser holding UPDATE on `core.proposals` can move a proposal with no `action_request`, no policy evaluation, no `action_effect` and no audit row, which is the one thing the envelope exists to prevent. T9 proves the refusal is `42501` from the privilege layer rather than a policy matching zero rows — the distinction matters because a DELETE refused only by a policy reports success on zero rows and the caller cannot tell.

**Three defects, each found by executing this migration and none findable by reading it.**
(1) **`app.require_tenant_id()` was not executable by `authenticated`**, so the first probe of the finished policy layer did not return zero rows, it returned `ERROR: permission denied for function require_tenant_id`. A policy predicate is evaluated AS THE QUERYING ROLE; a function named in one must be executable by that role or the policy does not deny, it errors — and deny and error look equally secure in a smoke test. 002 had already granted the other four claim readers (`current_tenant_id`, `role`, `has_permission`, `is_agent`) for exactly this reason and missed the fifth, correctly, because no policy used it until now. This is **not** the grant doc 09 §0 rule 3 forbids: that rule is about `app.ok` and `app.perform_action`, which read past the caller's RLS. `require_tenant_id` reads one claim out of the caller's own token.
(2) **`core.rule_set_versions` has no tenant index.** 009 hand-rolled that table instead of passing it through `app.finalise_table` — 009's own T1 comment says the two nullable-tenant tables "skip finalise_table" — and the copy preserved the RLS enable, the FORCE, the revoke and both triggers while dropping the tenant index and the composite `UNIQUE (tenant_id, id)`. 014's verify check (10) was written as a *regression test on 004* and fired on the first run, on exactly one relation out of 114. The index is added here because 014 creates the policy that needs it; the missing composite unique is a shape change to a table with rows and is left for 017.
(3) **`core.budget_status` and `core.model_tier_status` cannot be granted at all.** Both are `security_invoker=true` and `budget_status` reads `app.usage_rollup`; an invoker view runs as the caller, and no client role holds SELECT anywhere in `app` by design. An earlier draft granted them, test_013's amended T11b2 then failed with `authenticated` *still* unable to read them, and the grant turned out to be useless rather than missing. 014 revokes both and says why: a grant that looks like access and delivers a permission error is worse than none, because the screen breaks identically either way and the grant hides the cause. **The AI budget and model-tier screens have no data path until 018 reads them from a definer RPC or the rollup moves into `core`.** Carried, not closed.

**⚠ `core.v_approval_requests` is deliberately NOT granted, against the letter of the task brief.** The brief asked for a pin that "the approval view is readable"; doc 09 §12 says of this exact relation, "Do not grant the view to `authenticated` to shortcut" the approval RPCs. 014 honours the mechanism and pins the property: T7 proves the view IS readable through a `SECURITY DEFINER` path for the caller's own tenant, AND that a direct `authenticated` SELECT is refused. For a security-invoker view that is what "readable" has to mean.

**Six earlier pins were amended, and the amendment is the honest half of this pack.** test_004, test_009, test_010, test_011, test_012 and test_013 each asserted the pre-014 deny-all state — several in so many words ("before 014 grants it", "Grants and policies land together in 014", "The tenant PREDICATE arrives in 014"). 014 is that arrival, so those assertions were inverted rather than deleted, each marked `⚠ AMENDED BY 014` in place with the reason, and each converted from "nothing is granted" to a property that can still be false: every permissive and restrictive policy in `core` is one 014 stamped **by name**; `anon` still holds nothing; no client role can write the envelope's ledger, the event log, the finance tables or a run trace; and the only client grant in the catalogue is SELECT to `authenticated` on a `core` relation. One amendment was a genuine regression in 014 and was reverted rather than accommodated: an earlier draft revoked `anon`'s USAGE on schema `app` as obvious hardening, and test_011 T13b caught it — 011's `M-04` records that USAGE as load-bearing. Schema USAGE conveys no object access on its own, and `anon` holds SELECT and EXECUTE on nothing in `app`, which this pack's own T4 measures by impersonation.

**Spine untouched**, in the strongest sense the pack allows: 014 adds no action type, no handler and no branch to the envelope, and it is the migration that makes bypassing the envelope impossible rather than merely discouraged. No stage name appears in the file.

**Last updated:** 2026-09-13 — **013: AI operations, and the `run_id` divergence settled by reconciliation rather than by picking a side.**
013 lands the agent roster and its credentials, BYOK provider keys, model tiers and routing, budgets and usage, the run trace tree, and evals. Nineteen tables, two security-invoker views, twenty-nine functions, four triggers, **zero policies and zero new types**. **Applied nowhere.**

**The `run_id` divergence is closed without retyping anything.** 012 left two representations of one concept in the schema: `text` on `core.events`, `app.outbox` and 011's `agent_run_id`, because the design pack's demo run id `run_4821` is not a uuid; `uuid` on `core.proposals`, `core.provenance` and `core.rule_change_sets` from 007 and 009. 013 gives `core.runs` a `uuid` id **and** a `ref`, so a text run id is now the run's `ref` and `app.finalise_table`'s `UNIQUE (tenant_id, ref)` resolves text to uuid in one index lookup inside the tenant. Neither side is altered. The uuid side cost nothing and was invited — 007 and 009 both wrote `-- FK added by 013` — so `proposals_run_fk`, `provenance_run_fk` and `rule_change_sets_run_fk` land composite and `ON DELETE SET NULL`, the only thing 013 does to a table it does not own, dropped by name in the rollback. **The cost on the text side is stated and NOT closed:** those columns get no foreign key, so a typo'd `runId` still writes an event whose trace cannot be followed and nothing says so. It is not closeable here — an FK would require every already-written row to name an existing run, which is the data the reconciliation exists to preserve. On a live database the migration is one INSERT into `core.runs` per historical distinct run id with `ref` set to that string, and no UPDATE at all. Whether the API should stop accepting a caller-supplied `runId` and look the run up by ref is a contract change, registered as **D-59, owner the API contract**, blocking before the first real agent run.

**Secrets, done properly rather than asserted.** `M-10` named four defects in doc 02's provider-key handling and all four are closed: no RPC takes the raw key at all; reveal checks `app.aal2_verified()` rather than the forgeable claim; the once-per-24-hours ceiling is **the predicate of the UPDATE**, so two concurrent reveals cannot both pass; and the audit row is written first, with a trigger that re-derives from the catalogue that it was written, so a reveal whose audit fails takes the transaction with it. `M-11`: the agent key is minted **in the database** from `gen_random_bytes(32)`, returned once as a result value and never as a parameter, and its salted digest lives in `app.agent_api_key_secrets` — `app` is not an exposed schema, so PostgREST cannot reach the digest through `select=*` or an embed. That is a mechanism; omitting a column from a grant is not, which is what `H-09` was about.

**Fail-closed under the carried RLS residue, deliberately.** Every migration since 004 forces RLS with no policy, and the measured consequence is that a `SECURITY DEFINER` function reading its own forced table returns zero rows silently where the owner lacks `BYPASSRLS`. 013's security paths are shaped so that residue makes them REFUSE rather than permit: the reveal ceiling is an UPDATE predicate (no visible row means no reveal) and the audit is an INSERT (a refused `WITH CHECK` aborts the transaction). A `SELECT count(*) … IF < 1 THEN allow` ceiling would have degraded to "always allow" under exactly the same condition.

**Six defects found by EXECUTION.** Four are new classes:

1. **`to_regproc('app.emit_event')` returns NULL for an AMBIGUOUS name, not only an absent one.** The rollback's "012 must survive" guard therefore reported 012's event path as dropped on a database where both overloads were present, and aborted the whole rollback. This is `M-09`'s defect in a third spelling. Fixed to an `EXISTS` over `pg_proc`.
2. **`aclexplode(COALESCE(x, '{}'::aclitem[]))` raises "ACL arrays must be one-dimensional"** — an empty aclitem literal is zero-dimensional. `CROSS JOIN LATERAL aclexplode(relacl)` is both correct and right for a NULL acl.
3. **`app.finalise_table`'s immutability trigger fires BEFORE CHECK constraints.** Testing a frozen column's constraint with an UPDATE raises `IMMUTABLE_COLUMN` and proves nothing about the constraint. Two of fourteen jsonb cases were passing for the wrong reason until they were rewritten as INSERTs.
4. **`now()` is `transaction_timestamp()`.** A test that bumps `last_revealed_at = now()` inside the same transaction as the reveal writes the SAME value, an `IS NOT DISTINCT FROM` short-circuit lets it through, and the audit-trigger test passes vacuously. The real attack is moving that column BACKWARDS to reset the ceiling, and that is what the pin now does.

**A claim in 001's own header is false, checked against the applied set.** 001 states that every RPC in 011 and 016 returns through `app.ok`/`app.err`. **011 calls neither.** 013 is the first migration that actually calls `app.ok`, and only on success — errors RAISE, because an exception is what rolls the transaction back. Recorded rather than corrected in 001.

**What is still enforced only in the worker, named rather than implied.** Run I/O masking catches five patterns and nothing else: `Alex Selvarajah` passes straight through, and the pin asserts that it SURVIVES, so if that ever changes the pin says the header is now wrong. Addresses, job titles and company-identifying text are unmasked because no pattern can find them. `core.run_state_cards`' goal, decisions, constraints and open questions carry client text verbatim by doc 05's own admission and are kept indefinitely; the table comment records that as an assumption, not a safety claim. `core.run_node_io.subject_type`/`subject_id` are written by the worker, so `M-25`'s index exists but an unpopulated subject is still an erasure that cannot find its rows. And the BYOK decrypt itself happens in the Edge Function: `ai_provider_key_reveal` is the gate and the ledger, and a caller holding the platform secret store's own credentials bypasses both.

**Executed:** 13/13 migrations apply, 13/13 pins pass (150 assertions), full round trip forward → rollback → forward green with zero relations left in `app` and `core`, convention sweep clean. Nothing applied to any hosted database.

---

**Last updated:** 2026-09-13 — **012: the events, the outbox, and seven more defects that only execution could find.**
012 lands domain events, the audit index, the outbox and its job lifecycle, dead letters, inbound webhook routing and the retention reapers doc 05 §5.5 had promised and never written. Ten tables, one security-invoker view, thirty function names (thirty-one `pg_proc` rows — `app.emit_event` is overloaded), one policy, and the eighteen-row job-type map. **Applied nowhere.**

**The seam with 011 is one enum and one raising function, not a shared vocabulary.** `app.effect_status` is 011's and is reused by oid rather than redeclared. The outbox's own `state` is deliberately a DIFFERENT vocabulary — a job is QUEUED/CLAIMED/SUCCEEDED/FAILED/DEAD/CANCELLED, an effect is PLANNED/APPLIED/DISPATCHED/SUCCEEDED/FAILED/SETTLED/DEAD_LETTERED — and `app.effect_status_for_job_state` is the single translation between them. It RAISES on anything but `SUCCEEDED` and `DEAD`: root `CLAUDE.md` R14, whose worked example is a wrong constant recording every delivered email as dead-lettered. Verified by calling it with a junk value and reading the refusal.

**Seven defects found by EXECUTION.** Three are new classes worth naming:

1. **`pg_catalog.extract(epoch FROM x)` is a SYNTAX error, not a missing function.** `EXTRACT` is a grammar production tied to the unqualified keyword, exactly like `POSITION(x IN y)` — so the list of things that cannot be schema-qualified under `search_path = ''` is longer than 011's pass established. Use `pg_catalog.date_part('epoch', x)`. This killed the migration on its first apply.
2. **A ROW trigger does not fire for TRUNCATE.** `core.events` was append-only by a row-level trigger and by revoke, and one `TRUNCATE` erased the business record without touching either. Found while testing the rollback's own guard, whose first draft told an operator to clear the table — the only spelling that worked was the one that broke the guarantee. A statement-level `BEFORE TRUNCATE` trigger now closes it, and the refusal was executed rather than reasoned.
3. **`%L` is not a `RAISE` placeholder.** PL/pgSQL `RAISE` understands `%` only; `%L` renders the value followed by a literal `L`, visible in an error as `worker t012-wL`. Seven sites. 011 carries the same latent issue in its own messages and was left alone rather than edited from inside this pack.

The others: a `jobs-health` idempotency key with no tenant in it, so two tenants stalling in the same window would collide and only one alarm would ever be written; `app.is_service_role()` does not exist, despite the brief asserting it did, and nothing was built on it; a fixture that reused a job in `FAILED` with future backoff, where the control was right and the fixture was wrong; and three PASS notices containing the word "FAILED", which the pin runner greps for — a pass line that looks like a failure is how a real failure gets scrolled past.

**Where doc 05 contradicts the schema, the schema wins.** Ten places, of which four matter to another lane:

- **`core.runs` does not exist** (013 owns it), and the doc types `run_id` as `uuid` while 011's `core.action_requests.agent_run_id` is `text` and the demo run id is `run_4821`, which is not a uuid. `run_id` is therefore `text` on `core.events` and `app.outbox`. ⚠ **This now diverges inside the schema itself**: `core.proposals.run_id`, `core.provenance.run_id` and `core.rule_change_sets.run_id` are all `uuid` from 007 and 009. Two representations of one concept. **013 must reconcile, not retype** — every event already written would lose its trace.
- **`app.enqueue_effect_jobs` is described as live and "landed in 85cb624".** It does not exist; 011's `apply_effects` calls nothing. 012 creates it rather than editing 011, because the wiring belongs to the migration that owns the gate and a fix made silently in the wrong file is a fix nobody can find.
- **The job-type map's entity values do not match their only producer.** The doc uses `EMAIL`/`WHATSAPP`/`PDF`/`JURY`; 011's `plan_effects` emits `Email`, `Notification`, `EvaluationLink`, `AccountingPackage`, `Message`, `ComplianceRecheck`. A map keyed on the doc's spellings matches nothing and fails closed on every real effect — while looking exactly like a correct guard.
- **`app.event_subscriptions`' plain `UNIQUE (event_type, job_type, tenant_id)` does not constrain the global rows at all.** NULLs never conflict, so two identical every-tenant subscriptions both insert and every matching event is enqueued twice. Written `UNIQUE NULLS NOT DISTINCT`.

**One risk is CARRIED, not closed, and it is stated in the migration header.** The nine tenant-scoped tables here are RLS-enabled and forced with no policy, matching every migration since 004. On a platform whose migration owner lacks `BYPASSRLS`, a `SECURITY DEFINER` function reading its own forced table returns zero rows silently — `supabase/CLAUDE.md` §2 records that this was measured, not reasoned. 014 must admit those reads. Adding a `USING (true)` policy here instead would be a cross-tenant read grant landing before the grant layer exists.

**Executed:** 12/12 migrations apply, 12/12 pins pass (137 assertions), full round trip forward → rollback → forward green, convention sweep clean — 012 adds no new violation to any of the thirteen checks. Nothing applied to any hosted database.

---

**Last updated:** 2026-09-13 — **011: the write spine, and the six pins it correctly invalidated.**
011 lands the action envelope, the policy gate, approvals, idempotency, the effect ledger, the jury seam and the GOV-07 transition registry. Eleven tables, one security-invoker view, one shared `app.effect_status` enum, twenty-eight functions, the 22 action types, the 22-per-tenant policy catalogue materialised by a trigger on tenant creation, and the transition registry. Authored by Codex `gpt-5.6-sol` at xhigh, reviewed and executed here. **Applied nowhere.**

**Nine defects were found by RUNNING it, and not one of them would have been caught by reading it.** They are listed because the ratio is the point: a pack this size reads clean and does not run.

1. `pg_catalog.nullif(...)` (9 sites) and `pg_catalog.greatest(...)` (1). `NULLIF`, `COALESCE` and `GREATEST` are SQL *constructs*, not functions in `pg_catalog`, and cannot be schema-qualified. Under `search_path = ''` the instinct to qualify everything is right and these are the exceptions.
2. `pg_catalog.position(x IN y)` (7 sites). Same class, worse: `POSITION(x IN y)` is a grammar production tied to the unqualified keyword, so qualifying it is a syntax error rather than a missing function. Rewritten to `pg_catalog.strpos(y, x)` — note the reversed argument order.
3. A literal `+` left on a section-heading line by a diff-style edit.
4. An unbalanced parenthesis in `app.bulk_decide`: `jsonb_agg(jsonb_build_object(…)` closed once.
5. `pg_enum.enumlabel` is `name`, not `text`; compared to a `text[]` literal without a cast, the verify block could not run at all.
6. **The policy catalogue seed omitted `expire_after_minutes`.** `CMP-05` set `escalate_after_minutes = 2880` and took the column default of `1440`, violating the table's own `escalate_after_minutes < expire_after_minutes` CHECK — an escalation scheduled for a full day after the approval it escalates had already expired. This is `H-13`'s failure shape arriving through the seed instead of through the sweep. Every row now states both numbers so the relationship is visible at the row.
7. The `H-07` and `N-03` verify tripwires searched `pg_get_functiondef` for text that did not match the body's own whitespace, and failed on their own formatting rather than on their subject. Both sides are now whitespace-normalised. A text assertion that can fail for a reason unrelated to its subject is worse than none, because the next author deletes it.
8. An extra `)` made one of the rollback's five pre-flight guards unparseable.
9. **`H-07`'s tenant predicate made the national compliance registry unwritable.** The critic's fix is `v_request.tenant_id IS DISTINCT FROM NEW.tenant_id`, and `core.action_requests.tenant_id` is `NOT NULL` while `core.compliance_rules.tenant_id` is `NULL` for every national rule (009). `IS DISTINCT FROM` is therefore always true there, and `PROPOSED → ACTIVE` on a national rule was unreachable by every caller. Doc 03's original `<>` returned NULL for the same rows and let all of them through silently; neither shape is right, because "which tenant owns this row" has no answer for a national rule. The predicate is now guarded on `NEW.tenant_id IS NOT NULL`, which is what makes `H-07` applicable rather than a softening of it. Found by test_009 against the full applied set.

**Three transition edges were ADDED to doc 01 §5.3, flagged not smuggled.** 010 makes a payment correction a reversal row, and `core.payment_apply` recomputes the invoice status from the payments that remain — so a reversal drives `PARTIALLY_PAID → SENT`, and `PAID → PARTIALLY_PAID` / `PAID → SENT`. §5.3 enumerates only the forward direction, so with the registry exactly as written every reversal in the product raises `ILLEGAL_STATE_TRANSITION` and the money cannot be put back. All three are gated by `PAYMENT_RECORD`, marked in place with their evidence, and registered against §5.3 as an enumeration gap for the domain owner to ratify. The registry is therefore **124 rows: 121 from §5.3 plus these three.**

**Six committed pins failed and were repaired, not weakened.** Pins are executed against the FULL applied set, so 011's gate reached fixtures written when nothing enforced it: `test_005`, `006`, `008`, `009` and `010` each typed a status straight into a column, and `test_007` assigned `gen_random_uuid()` to `quotations.discount_approval_id`, which 011 now constrains with a real foreign key. Each fixture now crosses the edge the way the product does — for an ungated edge by walking it, for a gated one through a `pg_temp.gate()` helper that creates the `EXECUTING` action request and publishes it as `app.effect_applier`, because 011 checks the request's type, status, target and tenant and a fixture that sets only the GUC is still refused. No trigger was disabled, no `session_replication_role` was set, and no edge was invented to make a fixture pass.

`test_004`'s T1b was NARROWED rather than repaired: it asserted that no `core` table carries any policy before 014, and 011 lands exactly one on purpose — the `AS RESTRICTIVE FOR ALL` guard carrying `NOT app.is_agent()` on `core.autonomy_grants`, which is critic finding `H-02`, "the agent grants itself autonomy". A restrictive policy can only ever subtract, so it cannot be what opens a table early. T1b now refuses any PERMISSIVE policy and pins the single restrictive exception by name and by table, as an exact value.

**One product defect was found and is NOT fixed here.** `core.sync_programme_deliveries` (008) decrements `programmes.deliveries_count` on any move away from `DELIVERED`, and the only legal exit is `DELIVERED → CLOSED`. Closing out an engagement therefore un-counts the delivery that actually happened, and closing out is the normal end of every engagement — so in the product every delivered programme eventually reads zero "times run". `test_008` T9b pins what the code DOES, with the reasoning at the assertion and instructions to restore the intended form when 008's trigger is fixed. It is 008's to fix; editing another migration's trigger from inside this pass is how a fix gets lost.

**Executed:** 11/11 migrations apply, 11/11 pins pass (123 assertions), full round trip forward → rollback → forward green, nothing applied to any hosted database.

---

**Last updated:** 2026-09-13 — **Amendment pass A: the four open rulings applied to 001–009, and three defects the pins had never been in a position to catch.**
Nothing in this set is applied anywhere, so these are amendments to the files, not new migrations. Four rulings landed and each one paid for itself.

**R-EXT — `001` now enables `pg_cron`, `pg_net` and `vector`.** This was the last CRITICAL in the pack (critic `N-01`/`C-06`): nine scheduled behaviours in the design had no scheduler, sixteen `net.http_post` calls had no HTTP, and `knowledge_chunks.embedding` had no type. The schema each one installs into is not a preference and is now asserted, not assumed: `pg_cron` is non-relocatable with `schema = pg_catalog` pinned in its control file, so `WITH SCHEMA pg_catalog` plus Supabase's two documented `cron` grants is the only spelling that works; `pg_net` and `vector` go to `extensions`. The verify block asserts the **callable surface** — `cron.job`, `cron.job_run_details`, `net.http_post`, `extensions.vector` — rather than a row in `pg_extension`, because a present-but-unusable extension is what reaches production. **Consequence in 009:** the `knowledge_chunks.embedding` column was wrapped in `IF EXISTS (extname = 'vector')` with an `ELSE` that raised a NOTICE and continued. That is a migration which applies cleanly and then fails at query time with "column embedding does not exist", and the catalog was carrying it as the one object never executed in its intended form. The guard is gone; the column and its HNSW index are unconditional and written `extensions.vector(1536)` / `extensions.vector_cosine_ops`, because a bare `vector(1536)` resolves only while `extensions` is on the session search path — true in psql, false inside any function pinned to `search_path = ''`.

**Deviation D1 is CLOSED: one spelling, `search_path = ''`, on all forty functions.** The four-part form stored `proconfig` as `search_path=pg_catalog, public, extensions, pg_temp`, and doc 02 §8.7's sweep asserts the exact string `search_path=""`. Every function in the pack failed it (critic `N-05`) — a guard that fails on every object it governs is noise, and noise gets switched off. **This was safe because the bodies were already fully qualified, and that was verified rather than believed:** all forty bodies were read out of `pg_proc` and swept for bare references to any relation, function or type in `app`, `core`, `public` or `extensions`. Two hits, both the column `trainer_id` colliding with the function name `app.trainer_id()`, both false. The static sweep is the load-bearing check here, not the clean apply: plpgsql does not resolve a relation name until the statement first executes, so a migration can apply perfectly and still be full of names that will not resolve.

**FORCE RLS is now universal — and obeying that rule naively would have broken the product.** Three tables had neither RLS nor FORCE: `app.role_permissions`, `app.action_types` and `core.provenance_subjects` (the last one in `core`, which `config.toml` exposes to PostgREST, so it was reachable from a browser). All three are now enabled and forced. The first two also carry one permissive `SELECT` policy, and that policy is a **measured** necessity rather than a shortcut. `app.has_permission()` is `SECURITY DEFINER` and reads `role_permissions`; `FORCE` removes the owner's exemption. This cluster's `postgres` is a superuser with `BYPASSRLS` and so cannot answer the hosted question by being asked, so the probe reassigned the table and its reader to a role created `NOSUPERUSER NOBYPASSRLS` and measured the mechanism: RLS off → `true`; enabled but not forced → `true`; **forced with no policy → `false`**; forced with one `SELECT` policy → `true`. Forced-with-no-policy means every permission check in the product returns false and every MD silently loses every right. The policy leaks nothing and that is checkable rather than asserted: `anon` and `authenticated` hold no `SELECT` on either table (measured, both false) and `app` is absent from `config.toml`'s exposed schemas, so no client can reach the table to have a policy evaluated for them at all. `core.provenance_subjects` correctly gets NO policy: its only SQL consumer is a foreign key, and PostgreSQL performs referential integrity checks with row security bypassed by design.

**The access-token hook is `SECURITY INVOKER`, and that turned dead code into working code.** Doc 02 §4.1 flagged that 002 had *both* a `SECURITY DEFINER` hook *and* `supabase_auth_admin` grants *and* `supabase_auth_admin` policies — "which means one of the two is dead code and nobody knows which". Under `DEFINER` the body ran as its owner and the grants and policies were inert. Both `app.custom_access_token_hook` and `app.principal_claims` are now `INVOKER` — they must change together, because the hook is a two-line wrapper and leaving `principal_claims` as `DEFINER` would move the body straight back to the owner's context. **This immediately surfaced a real gap:** `test_002` T9 began failing with `permission denied for schema public`. 001 revokes the Postgres default `GRANT USAGE ON SCHEMA public TO PUBLIC` and grants it back to exactly `anon`, `authenticated` and `service_role`; `supabase_auth_admin` was never on that list. Under `DEFINER` nothing noticed. T9 had been passing vacuously and only tested what its name claimed once the mode changed. `002` now grants it.

**Two pin defects, both caused by pins being run at the point in the sequence that flattered them.** The harness now executes every pin against the FULL applied set rather than immediately after its own migration, and that alone found both. `test_003` T2 reported seven "unexpected" enums in `core` — `rate_card_status`, `rule_side`, `rule_kind`, `rule_op`, `rule_reference_kind`, `rule_offset_unit`, `delivery_mode` — every one a legitimate type created by 007 or 009. The allowance added is an EXPLICIT list with the owning migration named against each, never a predicate like "created after 003", because noticing a type nobody declared is this pin's entire job. `test_003` T5 then reported the same seven as having no provenance comment, which was true and is a real gap: 007 and 009 now `COMMENT ON TYPE` each one, recording that they are declared by the migration and deliberately NOT generated from `packages/contract/src/enums.ts`. `test_004` T1a reported `core.provenance_subjects` unforced, which was the genuine defect fixed above.

**Also closed: critic `N-03`, the gate's payload guard failing open on a typo.** `app.action_types.payload_schema` was `jsonb NOT NULL DEFAULT '{}'` with no constraint on its own shape, and 011's validator reads it as `jsonb_array_elements_text(coalesce(payload_schema->'required','[]'))`. A seed row spelling the key `requires`, or `required_keys`, or nesting it one level deeper yields NULL, the `coalesce` substitutes an empty array, the loop runs zero times, and every payload for that action type validates — the single guard on the gate's input, failing open, invisibly. Per ruling R-JSONB the column now carries `CHECK (payload_schema ? 'required' AND jsonb_typeof(payload_schema -> 'required') = 'array')`, and the default moves to `'{"required": []}'` in the same change, because the constraint and the default are one decision. The `jsonb_typeof` half is not belt-and-braces: `{"required": "ref"}` satisfies key presence and still makes `jsonb_array_elements_text` raise at runtime instead of at insert.

**Evidence.** All 9 migrations apply in order; all 9 pins pass against the fully-applied database (91 assertions); the full round trip — 9 forward, then all 9 rollbacks in reverse order — leaves zero relations in `app` and `core` and no leftover `cron`, `net`, or extension. Rollback 001 gained a fourth pre-flight guard, `G4`, which refuses if `cron.job` holds any row: `DROP EXTENSION pg_cron` deletes every scheduled job, and that must not be something this file discovers.

**Deliberately NOT done in this pass.** `001`'s header citation was corrected (it justified the `core` schema by quoting an early draft of doc 03 §1 that later said the opposite — critic `C-01`); the real grounding is now `config.toml`, which was READ this time, closing the critic's Part 2 §2.8 note that nobody had. The remaining CRITICALs — `C-07` retention, `C-08` poison-pill retry, `C-09` PDPA vs the append-only event log, `C-10` levy staleness, `C-11` MyInvois — are owned by migrations 010–015 and are not amendments to 001–009.

---

**2026-09-12** — **009 authored and EXECUTED: the rule registry is BITEMPORAL, and T3 proves why that is not decoration.** Two independent axes: `validity` is when a rule is IN FORCE, `known` is when WE KNEW it. Conflating them produces wrong answers that look right. T3 runs DECISIONS §3's actual situation — a 3-day public lead time in force from 15 Jun 2026, superseded by a 14-day rule effective 1 Jan 2027 that was only KNOWN from 8 November — and asserts three answers: a check run on 28 October for a 12 November training date resolves 3 days (the 14-day rule did not exist yet); a DECEMBER re-check of the same November date still resolves 3 days (knowing about a January rule does not make it apply in November); and a January training date resolves 14. With one time axis, the October answer comes out wrong and the audit trail calls the original assessment a mistake when it was not. **The EXCLUDE constraint is what makes the registry answerable** — for one family, mode and scheme, no two in-force rules may overlap on BOTH axes — and T4 checks the harder half too: it must PERMIT a different family, a non-overlapping validity, and a tenant override, because a constraint that refused those would make the registry unusable and is the easier mistake to make. **Defect found by running it:** the exclusion constraint could not contain `coalesce(scheme::text, '*')` — casting an enum to text is STABLE, not IMMUTABLE, and Postgres refuses it in an index expression outright. A maintained `scheme_key` column with a CHECK proving the trigger is doing its job replaces it, so a dropped trigger surfaces as a constraint violation rather than as a silently weakened exclusion constraint. Doc 04 avoids the problem with an `ANY` enum member, which would mean adding a value the API contract's own enum does not have. **Conflict C6:** doc 04 keys the rule on `HRD-014` with no `tenant_id`; doc 02 §4.2 Template E models these as national with `tenant_id NULL` plus optional overrides. Implemented as doc 02 describes, because the estate must share a corrected circular — copying a national rule per tenant means a correction is applied N times and the Nth is missed. ⚠ **`knowledge_chunks.embedding` was NOT created**: pgvector is not available in the authoring environment, so the column and its HNSW index are created conditionally and a loud NOTICE records the skip. This is the ONE object in the set not executed in its intended form.

**Last updated:** 2026-09-12 — **008 authored and EXECUTED: delivery, and the attendance lock the product cannot bend.** Contract §8 says approved attendance returns `409 ATTENDANCE_LOCKED` and the lock is one-way; DECISIONS §3 lists attendance immutability as an eTRIS rule. **The lock is enforced on BOTH the day and its entries, and that is the whole design.** A trigger on the parent alone freezes the approval columns and leaves every mark on a locked day freely editable — which looks correct in every diff and protects nothing HRD Corp cares about. T3 exercises insert, update AND delete of a mark on a locked day; the migration's own verify block refuses to commit unless both triggers exist. **Locking closes capture without being asked**: `capture_qr`, `capture_signature` and `capture_manual` are forced false, so the contract's "captureModes are all false while locked" is a property of the row and the UI has nothing to get wrong. **Unlocking is an action, not an update**: it requires a reason, clears the old approval so the day does not still look approved, reopens capture, and increments `unlock_count` ITSELF — T6g proves the caller cannot reset it, because the one hand that unlocks must not be able to erase the evidence that it did. **What this migration deliberately does not claim**: it does not stop a superuser disabling the trigger. That is a platform-access question, not a schema one, and the header says so rather than implying a guarantee it cannot make. Two projections with one writer each: `engagement_trainers` is maintained from sessions in BOTH directions (T7b covers the removal half, without which the trainer policy keeps showing an engagement they left), and `programmes.deliveries_count` moves both ways. **A SENT message must cite the consent row it relied on, by id** — PDPA asks which permission a message went out under, and a foreign key is the only answer that cannot be reconstructed favourably afterwards.

**Last updated:** 2026-09-12 — **007 authored and EXECUTED: money. Three defects in doc 04's specification found by running it, all folded in.** (1) **`floor_price_needs_approval` cannot be a table CHECK.** Doc 04 §1.7 writes it as one. Executed, it makes a quotation impossible to CREATE: in a total-from-lines model the header starts at `sell_price_sen = 0` and is filled by the line trigger, so an immediate CHECK fires against a zero sell price and a non-zero programme floor before a single line can be written. The very first attempt to insert the contract's own fixture failed on it. The rule is real and is now a DEFERRABLE CONSTRAINT TRIGGER, judged at COMMIT — the only instant at which the lines, and therefore the price, exist. Same rule, correct instant. (2) **A deferred constraint trigger's `NEW` predates the line trigger's update of the header**, so both the reconciliation and floor assertions compared the lines against a header from before they were written and failed a correct transaction, reporting a header of 0 sen against lines that summed correctly. Both now RE-READ the current row. (3) **The pin's own T4c was backwards** and had to be corrected: the contract's fixture is COMPLIANT — RM 18,500 against a binding floor of RM 17,538.47 is a 0.38 margin over a 0.35 floor — so asserting `below_floor = true` pinned a fiction. A separate T4b now exercises a genuine breach on the contract's own RM 12,400 example and proves an approval is what permits it. **The arithmetic is pinned on the contract's real numbers**, not round figures that would hide a rounding bug: trainer RM 4,800 × 2, venue 0, materials RM 40 × 30, travel RM 300 × 2 = RM 11,400 against an RM 18,500 sell. **`ceil`, not `round`, on the margin floor** — T3 pins 1,753,847 exactly, because `round` gives 1,753,846 and a price one sen under the floor would then pass as compliant, which is precisely the shape a deliberate underprice takes. **The jsonb NULL-check trap is pinned on the exact payload the naive constraint lets past**: a jury object with no `mode` key at all, where `->>` yields NULL, `NULL IN (...)` yields NULL, and a CHECK evaluating to NULL PASSES. **A catalogue query that cannot rot** asserts no column in `core` ending `_sen`, `_rate` or `_pct` is `float4` or `float8`.

**Last updated:** 2026-09-12 — **006 authored and EXECUTED: the catalogue, and the constraint that stops a trainer being in two places.** `tb_no_double_booking` is an EXCLUSION constraint over `daterange(starts_on, ends_on, '[]')` with `btree_gist` so `trainer_id` can be compared with `=` in the same constraint. It is not a validation rule to be caught in a service layer: two confirmed bookings over overlapping dates is a trainer standing in the wrong city, a client without a facilitator, and an HRD Corp claim that cannot be filed. **T3 exercises the whole matrix** — identical span refused, PARTIAL overlap refused (the case a naive unique index on `(trainer, starts_on)` lets straight through), adjacent-but-not-overlapping ALLOWED (an inclusive bound written exclusive breaks exactly this and looks right either way), a different trainer allowed, another tenant allowed, and **two SOFT_HOLDs over the same dates deliberately allowed**, because holding two options for a client while they decide is the point of a soft hold and a constraint that forbade it would quietly break the sales motion. **`trainer_availability` is written by a trigger, never by hand**, and T4 tests the half that gets forgotten: MOVING a booking must RELEASE the days it no longer covers, or the trainer looks busy on dates nobody booked and the recommender stops offering them. **`floor_price_sen` is an ABSOLUTE floor, not a margin** — doc 01 works the arithmetic and the column carries it as a COMMENT, because deriving the floor would put a different number on the approval screen from the one the salesperson was quoted. **Two defects found by running it:** the rollback's generic dependency guard fired on the three foreign keys 006 itself adds to 002's and 005's tables (the generator now takes an owned-constraint exclusion list), and 006 was not re-runnable because `ADD CONSTRAINT` has no `IF NOT EXISTS` — the same trap 004 hit, now guarded here too. Rate cards are NOT here: `trainers.band` is a JOIN KEY into sb-money's rate card, not a rate.

**Last updated:** 2026-09-12 — **005 authored and EXECUTED: the sales path, fourteen tables, applied cleanly on the first run.** The assertions that earn their place in the pin are not the columns. **T2 proves a cross-tenant foreign key is UNREPRESENTABLE** — a contact in tenant Beta attached to an organisation in tenant Alpha is rejected by the storage engine, with RLS irrelevant to the outcome. That is a stronger guarantee than a policy test: RLS can be misconfigured in a migration nobody reviews, a composite foreign key cannot. Every FK into a `core` parent is composite and the migration's own verify block sweeps for a single-column one. **T3 turns a sentence into a property of the data**: the contract says low-confidence enquiries "are never auto-archived", which is a claim about a background job; the constraint makes it true regardless of what tries, and clearing the review flag is the only path. **T5 stops a double-clicked Convert button overstating the pipeline** by the value of a deal. **T7 proves consent survives withdrawal** — the ledger is append-only because PDPA asks what was true on a date, not what is true now, and the historical row itself is frozen. ⚠ **DEVIATION D2, recorded loudly:** `organisations.proposal_count` and `first_proposal_sent_at` are denormalised for the record header, and doc 03 decision 7 says `firstProposalToOrg` is computed LIVE from a partial index. Both columns carry a COMMENT saying the policy gate must not read them, because a column that looks authoritative and is not is exactly what a later author trusts. ⚠ **Four forward-reference columns exist without their FK constraints** (`organisation_suggestions.programme_id`, `follow_ups.proposal_id`, `follow_ups.invoice_id`, `tna_recommendations.programme_id`); the constraints are added by 006, 007 and 010. The gap is real while it lasts, so T8 asserts the columns and test_014 will assert the constraints — tracked, not hoped about.

**Last updated:** 2026-09-12 — **004 authored and EXECUTED. The important object in it is not a table: it is `app.finalise_table()`.** Doc 01's Conventions say every table carries the same eight columns, the same `UNIQUE (tenant_id, id)` and `(tenant_id, ref)`, the same `updated_at` trigger and a frozen `ref`; doc 02 §4.1 says every one is RLS-enabled AND FORCED with a tenant index. That is eight facts across roughly eighty tables. Written per table it is six hundred lines of copy-paste in which exactly one table ends up missing FORCE and nothing notices until that table is the one that leaks. Written once, a single pin proves it for all of them — and the pin tests the FUNCTION on a throwaway table rather than the fourteen tables it happened to be applied to, because otherwise it would not prove the fifteenth table gets the same treatment. This is the project's own consolidation rule applied to SQL. **`finalise_table` refuses a table with no `tenant_id`**, which is the check that matters: a table reaching 014 without one gets no tenant predicate, and a policy that cannot filter by tenant does not isolate. **Two defects found by running it.** (1) The composite FKs failed on first apply — `(tenant_id, attachment_id) → attachments (tenant_id, id)` needs the parent's composite unique to exist first, so the finaliser calls had to be interleaved with the CREATEs in dependency order rather than batched at the end. (2) Re-running 004 failed with `relation "ref_formats_tenant_id_key" already exists`: Postgres has no `ADD CONSTRAINT IF NOT EXISTS`, which the Supabase schema guidance names explicitly as a migration trap. The finaliser now guards each ADD CONSTRAINT with a `pg_constraint` lookup and 004 is re-runnable. **Ref allocation is per tenant and T4 exists to keep it that way**: two tenants creating their first template must BOTH get `TPL-0001`. A global counter would let every customer read every other customer's record volume off a ref, and no access-control test would ever catch it because no row is exposed. **Conflict C4 resolved:** doc 01 wants `action_types` tenant-scoped in `core`; doc 03 §1.1 defines `app.action_types` as global, "the product's vocabulary... Tenants customise policies and grants, never the catalogue". 03 outranks 01 and is right — an action type is a capability the software has, not a per-customer setting.

**Last updated:** 2026-09-12 — **003 authored and EXECUTED: 69 enum types, 271 labels, GENERATED from `packages/contract/src/enums.ts` rather than transcribed.** Sixty-two of the sixty-nine are emitted by reading the contract package's `as const` arrays, one `CREATE TYPE` per array, so the database and the TypeScript contract are the same list by construction rather than by review. Each carries a COMMENT naming the constant it came from, so provenance survives into `\dT+`. The reason is that a misspelt enum label is perfectly valid SQL: `ACT_WITH_APROVAL` creates cleanly, matches nothing at run time, and first shows up as a row that will not insert in staging weeks later. The pin is generated from the migration and asserts every label **in declaration order**, because ORDER is semantic for a Postgres enum — comparisons and ORDER BY use declaration order, so a type recreated alphabetically would pass every membership test and silently sort BREACHING approvals last. T4 demonstrates that rather than asserting it abstractly. **Seven types are NOT in the contract package** and are listed separately with the doc section each came from; `travel_region` is the weakest of them — doc 01 names the type but gives no values, so `KLANG_VALLEY · PENINSULAR · EAST_MALAYSIA` are taken from DECISIONS §5's rate-card travel bands and are flagged. **Conflict C3 recorded, not resolved by precedence:** doc 03 §1 states "check constraints in place of enum types" for its own `app.*` gate tables and doc 01 chooses native enums for the domain, with reasons. These are not in conflict — each document describes the tables it owns — so the gate uses `text` + CHECK and the domain uses enums, and the asymmetry is recorded so nobody "unifies" it in one direction and breaks the other lane's design. **The rollback refuses rather than cascading:** `DROP TYPE ... CASCADE` does not fail on a dependent column, it DROPS THE COLUMN, which on `engagements.status` is silent irreversible data loss dressed as a successful rollback. The guard names every dependent column in one message instead of failing sixty-nine times.

**Last updated:** 2026-09-12 — **002 authored and EXECUTED; three defects found by running the docs' own SQL rather than reading it.** (1) **Doc 02 §4.1's `app.can_see_owner` does not compile.** It writes `p_owner = any ((select app.my_team_user_ids()))`; `ANY ((SELECT ...))` is parsed as the SUBQUERY form of ANY, which wants a set, while the function returns one `uuid[]` value, so Postgres reports `operator does not exist: uuid = uuid[]`. Corrected to `= ANY ((SELECT app.my_team_user_ids())::uuid[])`, which compiles AND keeps the property the doc wanted — `EXPLAIN` shows the whole expression hoisted to `(InitPlan 1).col1`, so the team lookup runs once per statement, not once per row. Calling the function bare also compiles but gives up that guarantee. (2) **Doc 02 §2.2 says "Ninety-four strings"; its own catalogue and its own §2.3 matrix each hold 109.** The seed was built by PARSING the markdown table rather than transcribing it — 74 rows, 109 distinct permissions, 399 (role, permission) pairs — because a hand transcription of a 74×7 grid is a typo generator and a missing tick is a silent authorisation hole no test for a different permission would catch. The prose count is stale; the data is self-consistent; the seed follows the data. (3) **The rollback crashed when re-run.** `'public.tenants'::regclass` RAISES on a missing relation, so a second run produced a bare cast error from inside a guard instead of "nothing to roll back"; and a plpgsql `RETURN` exits its block, not the script, so an early short-circuit did not stop the REVOKE below it. Both fixed with `to_regclass()` and per-statement existence guards; the rollback now round-trips and is safe to re-run. **The three pre-flight guards were tested by making each condition true** and confirming the refusal, not by reading them. **`public.user_profiles` is an AUTHOR ADDITION** — doc 02 §1.2 assigns it to sb-erd and names the two columns it requires, doc 01 never defines it, and the hook and every display-name policy need it to exist. Flagged rather than folded in silently.

**Last updated:** 2026-09-12 — **001 authored and EXECUTED; nothing applied to any hosted database.** The foundation lands: schemas `app`, `core` and `extensions`, four extensions, and five shared helpers. Two things were found by running it rather than by reading it, and both changed the migration. **(1) The rollback's first execution aborted on `cannot drop extension pgcrypto because other objects depend on it`.** That was correct behaviour exposing an incorrect design: Supabase installs pgcrypto on every project, so 001's `CREATE EXTENSION IF NOT EXISTS pgcrypto` is a no-op on the real target and 001 does not own it. Dropping it would not restore the prior state, it would destroy a piece of it. The rollback now drops only the three extensions 001 genuinely creates (citext, btree_gist, pg_trgm) and says why pgcrypto is absent from the list. **(2) Doc 02 §4.1's baseline line `alter default privileges in schema public revoke all on tables from public` does not do what it says, and neither does the functions equivalent.** Measured on PostgreSQL 17.11: for tables it is vacuous, because PUBLIC holds no default table privilege to revoke; for functions it is not vacuous and still does not take — the statement records no row in `pg_default_acl` and a function created afterwards is still executable by PUBLIC and by `anon`. The same statement in GRANT form records correctly, so the mechanism is live and it is the revoke-from-PUBLIC direction that fails. Both lines are kept as the documented baseline and are explicitly **not** the guard; the guard is per-object `REVOKE` at creation in every migration plus test_014's schema-wide sweep. The pin was rewritten to stop asserting the fiction — it had originally asserted a `pg_default_acl` row and failed, which is how this was found. **Conflict C1 resolved and applied here:** the domain lives in schema `core`, not `public`. Doc 03 §1 states it outright and then uses `core.proposals`, `core.quotations`, `core.invoices`, `core.engagements` and `core.hrdc_packets` across twenty places of its own executable SQL including index DDL it prescribes; doc 02 writes the same tables as `public.*` throughout its RLS catalogue. 03 outranks 02. `core` is therefore added to PostgREST's exposed schemas in `config.toml` — without that line the whole domain is invisible to the API with no error to explain it.

## Migration Order

| # | File | Summary |
|---|------|---------|
| 024 | `024_training_delivery.sql` | **Training delivery: the seven §8/§6 client methods the gap matrix marks NO-ADAPTER — `listEngagements`, `getEngagement`, `getEngagementParticipants`, `getAttendance`, `captureAttendance`, `exportAttendance`, `putProgramme` (2026-09-14).** Seven new `core` RPCs, no DDL. Depends only on 001–021. Every function copies 018/021's pattern: `SECURITY DEFINER`, `SET search_path = ''`, the permission gate first, reads through `app.err`/writes through `RAISE TRNOS`, list/get pairs on 018's keyset helpers, writers returning through their sibling reader. `list_engagements`/`get_engagement_participants` gate on `engagement:read`/`participant:read`; `get_attendance` on `attendance:read`; `capture_attendance` on `attendance:capture`; `export_attendance` on `attendance:export`; `put_programme` on `programme:write` (ADMIN only per 002 §11). **`v_trainers`/`v_programmes`/`v_programme_deliveries` already existed** (020) — the gap-matrix audit predates that migration; verified by grep before writing, left untouched. **`getProgrammeDeliveries` fixed in the same commit**: its `rpcClient.ts` adapter matched a route REF against the view's uuid `programme_id` column; now resolves through `get_programme`'s id-or-ref lookup first, the same fix `getOrganisationRelations` already carries. `get_engagement` drops (not zeroes) `finance` for a caller without `quotation:read` (018's R7 ruling for `get_proposal`, carried over). `capture_attendance` defaults an unreasoned absence to `OTHER` to satisfy 008's `ae_absent_needs_reason` CHECK, which the fixture client does not enforce. `put_programme` writes the record's own scalar fields only — `programme_pricing_tiers.floor_price_sen` is NOT NULL and the contract's `PricingTier` carries no floor, so the four child arrays are left untouched and flagged as a decision to confirm. Scope-narrowing (○ in 002 §11) is not applied, same posture as 018/021. |
| 030 | `030_me_profile_session_null.sql` | **`core.me_profile()`'s `session` block never leaks a null required field (2026-09-14).** `CREATE OR REPLACE` of 022's function only — one `IF` added: `v_has_session` now also goes `false` when `auth.users.last_sign_in_at` exists but its VALUE is null (022 only guarded the column-ABSENT case, via `EXCEPTION WHEN undefined_column`), closing a defect where a populated `session` object could carry `lastSignInAt: null` — found by running `test_022`'s own `T1j` against hosted, where it failed. A real, signed-in caller is unaffected (GoTrue always stamps `last_sign_in_at` on a real sign-in). Pin `test_030`: three cases branched structurally on the column's presence — absent (null as a whole, unchanged), present+null (null as a whole, the fix), present+set (full object, exact 5 keys, real value) — verified against both the unmodified shim and a locally-extended hosted-shaped copy. `test_022`'s own fixture gained a matching `UPDATE` so its T1 principal exercises the real-value branch instead of tripping the defect this migration closes. Rollback restores 022's original body verbatim. `test_001`–`test_022` unmodified and still green. `lint:sql` 74/74, `check:grants`/`check:rpc` clean. |
| 022 | `022_profile_and_dashboard.sql` | **`core.me_profile` and the two executive-dashboard RPCs 020 reported NOT BUILT, built from real data (2026-09-14).** Three new `core` functions, nothing replaced, nothing in the spine touched. `core.get_hours_saved` and `ADMIN_HOURS_SAVED` are deliberately not built — no baseline-minutes table exists. `MeProfile.location`/`jobTitle`/`department`/`staffNumber` are `null` (no table carries them); `session` answers `null` AS A WHOLE whenever the REQUIRED `lastSignInAt` (`auth.users.last_sign_in_at`) cannot be derived, never a populated object with a null required field; otherwise a full object with `browser`/`place` null (no user-agent/geoip storage), `activeSessions` real off `auth.sessions`, `twoFactorEnabled` real off `auth.mfa_factors` where present. Every other field, including `moduleCount` (the same nav-permission match `core.navigation()` uses, MD reads 13 of 14) and `email` (from `auth.users`), is real. The four dashboard metrics are each one worked aggregate over `core.opportunities`/`invoices`/`proposals`/`hrdc_packets`, formulas in the migration header; `agentActivity`/`autonomyMix` derive per-run autonomy from `core.action_requests.granted_level`; `agentSpend` sums `core.budget_status` at `scope='AGENT'` (no TENANT scope exists). No `delta` anywhere — no snapshot table exists to compute one honestly. Both dashboard RPCs gate on the already-seeded `dashboard:executive:read` (SALES_MANAGER/FINANCE/MD/ADMIN), narrower than `dashboard:read` and the closer match to the contract's `roles:['MD']`; `me_profile` gates on membership only. Pin `test_022`: 50/50 assertions against a hosted-like shim, hand-computed sums against seeded fixtures walked through `core.state_transitions`' gated edges (not gone around), tenant isolation, permission refusal, anon 42501, and validation on both RPCs. Re-verified against 001–021+022 after merging `origin/main`: `test_021` (10/10), `test_022` (50/50) and the hosted demo seed's own pin (`test_hosted_demo.sql`, ALL PASS) each individually green; a clean 001–021+022 build re-runs every prior pin unmodified, still green. `lint:sql` 71/71, `check:grants`/`check:rpc` clean. **Owed:** the skill's G5 dual adversarial review — a Codex review was dispatched in parallel by the coordinator instead. **No collision with 021**: 021 touches `badge_counts` and 23 other 018 RPCs plus 011's dispatch functions and 019's seed function; none of the three names this migration creates, and 021 does not touch `app.role_permissions` or `core.navigation()`'s permission list. |
| 021 | `021_golden_path_authz.sql` | **Role authorization on the golden-path RPCs, `OPPORTUNITY_STAGE_CHANGE`, and the 019 seed fix (2026-09-14).** 24 018 functions are replaced (`badge_counts` plus 23 gated), along with three 011 dispatch functions and 019's `app.seed_pipelines`. Each body is its prior text apart from blocks marked `-- 021 ·`. Also adds one action type, one move-check function, one tenant trigger with its seed function and backfill, and one policy. No table, no enum value. **Any principal with a tenant claim could call every read and write**: only `list_quotations` checked a permission. The 23 now check their 002 permission as the first statement, reads through `app.err('FORBIDDEN')` and writes through a TRNOS raise, identically for every argument. `badge_counts` zeroes the HRDC and run counts a role may not read. **The approval audit tab was still empty**: the shipped client sends `get_audit('APPROVAL', ref)` and 020 mapped only `approvals`, so 020's `get_audit` is replaced to map what `aggregateTypeOf` sends (`APPROVAL`, and the misspelt `ENQUIRIE`/`OPPORTUNITIE`). `get_rate_card` has no 002 permission and is gated on `quotation:read` (flagged). **The pipeline board could not move a deal**: 011 never catalogued R18's type. It is now an action type needing `opportunity:stage`, with arms in 011's three per-type dispatch functions. The move is refused if `fromStage` is stale (`STAGE_MOVED`), if the stage is not a step of the tenant's pipeline, or if a terminal step has no reason. It is checked when the target resolves and again under the executor's lock. `OPP-01` routes WON/LOST moves to SALES_MANAGER approval, seeded per tenant and backfilled. **019's seed aborted on a tenant with its own default pipeline** (`pipelines_one_default_uq`), and now steps aside. `app.seeded_pipelines` is FORCED with an owner-only policy. ⚠ **Amends three prior pins** in place: test_011 T1b/T1c and test_012 T1p (22→23 action types), and test_018 T19g/T36 (compliance-rule reads as SALES). |
| 020 | `020_api_read_surface.sql` | **The API read surface: approvals that can be decided, and views a browser can read (2026-09-14).** It replaces three 018 functions (`core.list_approvals`, `core.get_approval`, `core.get_audit`) whose bodies stay 018's apart from blocks marked `-- 020 ·`. It repairs three 018 views, adds fourteen `security_invoker` views and adds two `core` definer row sources. No table, enum value or policy. **Nobody could approve anything**: 014's `core.decide_approval` requires the diff hash and 011 compares it, but 018's list and detail never sent `diffHash`, so every APPROVE was refused. Both now carry it (contract `ApprovalRequest.diffHash`). The list also accepts the contract's `value.amount` filter. **The audit drawer was always empty**: the client sends the URL segment (`approvals`) and 012 stores UPPER_SNAKE. `get_audit` maps the unambiguous segments and returns an approval's trail by action-request correlation. **Every client view raised or 404'd**: 018's three views called `app` helpers REVOKEd from `authenticated` (42501, shown to the user as signed out), and fourteen `VIEW_READS` names had no view. Money is now inlined, the budget and tier rows come from `core.ai_*_rows()`, and each view's columns are the contract keys, with no rows for a caller who lacks the 002 read permission. `$verify$` V6 asserts off `pg_depend` that no client-readable `core` view calls a function `authenticated` cannot execute. The three reads get the `approval:read` / `audit:read` gate. `decide_approval` keeps 014's uuid signature. **Not built:** `me_profile` (no table carries its required fields) and the dashboard RPCs (nothing to compute them from). Pin `test_020`: every probe runs as `authenticated`, and the build ran as a NOSUPERUSER BYPASSRLS role. |
| 019 | `019_pipeline_provisioning.sql` | **Per-tenant pipeline provisioning: the dedicated seed pack 016 asked for, split out of 018 (2026-09-13).** One table (`app.seeded_pipelines`), four `app` functions, one trigger on `public.tenants`, two rows in 016's `app.tenant_seed_checks`, and a backfill. No enum value; no existing function, view, policy or grant modified. **A tenant had no lifecycle**: `core.pipelines` and `core.pipeline_steps` exist from 004 and nothing in 001–018 put a row in either, so `core.navigation` and `core.get_pipeline_config` returned an empty stage list for every tenant. 016 named the owner — *"it belongs in a pack that can cite `docs/architecture/01` §5.3 per row. **Owner: 018 or a dedicated seed pack.**"* — 018 took it and should not have. **The trigger name is load-bearing**: per-row AFTER INSERT triggers fire in ALPHABETICAL ORDER, and `core.pipelines` carries `trg_pipelines_ref` → `core.assign_ref('PIP')`, which raises without 016's ref format, so `trg_tenants_z_seed_pipelines` must sort after `trg_tenants_seed_ref_formats`; the `z` is not decoration and V1b asserts it. **The backfill RAISES naming every tenant it could not seed** rather than warning — it used to swallow a foreign-key violation and finish green, leaving a tenant whose shell opened on an empty stage list that read as configuration. **And the seed is REVERSIBLE**, which is the whole reason it is a pack of its own: `app.seeded_pipelines` records every row the seed actually inserted (a row that already existed under the same derived id was never inserted and is never recorded), `app.unseed_pipelines()` deletes exactly those and refuses with a count and the blocking constraint names when live data references any of them, and the rollback calls it before dropping the mechanism. Without that, rolling back left `pipelines_one_default_uq` rejecting a default `ENGAGEMENT` pipeline for every tenant permanently. Registered in `app.tenant_seed_checks` so `app.provision_tenant` refuses a tenant whose lifecycle did not land. ⚠ **Forces a fixture amendment in every pin that inserted its own default `ENGAGEMENT` pipeline** — test_008 and test_009 are amended in this pack's commit; test_016 and test_017 on `cloud/migrations` are owed at rebase. |
| 018 | `018_golden_path_rpcs.sql` | **The golden-path RPC pack: 30 `SECURITY DEFINER` read/write RPCs in `core`, three `security_invoker` views, fourteen internal `app._*` helpers, and the per-tenant pipeline seed (2026-09-13).** No table, no enum value, no policy; no existing function, view or grant modified. **The envelope is the contract**: every body returns through `app.ok`/`app.err` or refuses through a `TRNOS` raise, `data` stays the sole non-`success` key so the client's auto-unwrap does not flip to pass-through, and `list_approvals` puts `groups` BESIDE `data` one level down rather than beside the envelope. **Reads refuse with `app.err`, writes with `RAISE … TRNOS`** — six functions write, and a committed refusal after a write is the defect that rule exists to prevent. **One keyset engine, not five**: `app._keyset_scope` counts off the filter-only predicate and returns the keyset-extended one, `app._next_cursor` asks the table whether a row exists past the page, and the five list RPCs call both — which is what makes "count before keyset" and "null at the end" unavailable to a caller rather than repeated correctly in five places. **One saved-view resolver**: `app._view_filters` gates on `core.saved_view_object`, so the three lists whose object has no enum value REFUSE `p_view` with `UNSUPPORTED_VIEW_OBJECT` instead of dropping it. **`regenerate_proposal_section` enqueues through 012**: `app.emit_event` carries the run id into `app.outbox` via one global `app.event_subscriptions` row (routing is data, 012's own rule), and the RPC refuses `REGENERATE_NOT_ROUTED` rather than returning 200 with nothing queued. **The pipeline seed** is a ⚠ **The per-tenant pipeline seed is NOT in this pack** — it was, and the review was right that it did not belong. A trigger on `public.tenants` plus a cross-tenant backfill is a repo-wide semantic change, and shipping it as a subsection of a file whose stated subject is read and write RPCs put its irreversibility in a footnote instead of under review; the cost was measurable, four earlier packs' pins. It is now **019**. What remains here is the DEPENDENCY: `core.navigation` and `core.get_pipeline_config` render stages FROM `core.pipeline_steps` and inline no stage list, so without 019 both return an empty stage list and `test_018` is run against 001–019. **014 yields three wrappers to 018 and 018 yields them back**: `perform_action`, `decide_approval` and `bulk_decide_approvals` are 014's, asserted here and not redefined. Stage names and order render from `core.pipelines`/`core.pipeline_steps` in both `navigation` and `get_pipeline_config`; no stage list is inlined. ⚠ **Adds three `core` view grants.** They are asserted by `test_018` T38, and `test_014`'s exact count stays at **121** by excluding 018's three views by name — 014's pin must pass at 014, and a count a later pack bumps is a running total of the schema rather than 014's own pin. That condition is three migrations old rather than 018's invention: the same file's T1a already read "116 tables, 113 from 014 + 3 from 017" before this pack existed. 018 stops extending the pattern. |
| 017 | `017_baseline_amendment.sql` | **The amendment pass: nine PUBLIC grants nobody intended, seven unconstrained jsonb columns, two wrong numeric precisions, and the regulatory shape the September research says the baseline is missing (2026-09-13).** Three tables, four functions, two views, nine REVOKEs, seven CHECKs, two type changes, eight columns. The most dangerous migration in the pack — every statement runs against a table that may hold rows and two change a column's TYPE. **The nine PUBLIC EXECUTE grants**: 001 measured that `ALTER DEFAULT PRIVILEGES … REVOKE … FROM PUBLIC` does not take and named per-object REVOKE as the real guard; nine 007/009 functions slipped through. Eight are triggers (harmless), **`core.apply_rule_offset` is not** — it is the date arithmetic behind every HRD Corp deadline and the only one PostgREST will call. **014 is what made it urgent**, by granting `USAGE ON SCHEMA core`. **R-JSONB on the last seven columns, TYPE HALF ONLY and said so**: none has a consumer declaring keys, and inventing them would freeze a shape nobody agreed; the type half still refuses `"hello"`, which survives every not-null guard and breaks the first `->>`. **`quotations.margin_rate` bare `numeric` → `numeric(6,4)`** to match the two neighbours it is compared against in the below-floor decision, with a guard that REFUSES rather than rounds, because a rounded margin can cross the floor that decided whether an approval was needed. **SST is `core.tax_policies`** — bitemporal like 009, tenant-scoped with a national fallback, rates in basis points (argued against root CLAUDE.md's numeric, which governs the rate on a DOCUMENT), Group G 8% taxable as the default and Education Act exempt selectable, both seeded PROPOSED, and `app.resolve_tax_policy` RAISES rather than returning a zero rate. Quotations finally get SST, GENERATED on the summed net, with the exemption unusable without a written reason. **PDPA**: consent `purpose` + `notice_version` with the legacy marker forbidden for new rows; retention policies that approve rather than delete (which is why 015 leaves four reapers unscheduled); a breach register whose 72-hour and 7-day clocks are GENERATED so they cannot be edited, ⚠ with `retained_until` left unset because the research flags the 2-year figure UNCONFIRMED. **Three HRD Corp deadlines, all PROPOSED** — 5-day query (the application EXPIRES; a recommended addition absent from Appendix B), 90-day commencement, 6-month claim (unconfirmed, seeded and flagged). **HRD-TDF gains an expiry date** and the corrected citation, Circular 6/2024 not 2/2026. **And `core.retrieve_knowledge` with `SET LOCAL hnsw.iterative_scan = relaxed_order`** — there was no retrieval RPC at all, the setting defaults to `off`, and under a tenant filter an HNSW scan then returns FEWER THAN k rows with no error; T10 measures k=10 for a tenant holding ~2% of the corpus. Four defects found by executing: `timestamptz + interval` is STABLE so the clocks needed a UTC pivot; `SET LOCAL` is refused in a non-volatile function at CALL time; the check keys needed 016's provisioning shape rather than a `CROSS JOIN public.tenants` that seeds nothing; and `ADD CONSTRAINT` has no `IF NOT EXISTS` for the third time in this pack. Spine untouched. |
| 016 | `016_seed_and_tenant_provisioning.sql` | **Tenant provisioning: the `core.ref_formats` rows every pin since 011 has been faking, derived from the triggers that consume them (2026-09-13).** Two functions, one trigger, no table, no type, no policy. `core.next_ref()` raises when a tenant has no format for a prefix, 32 `core` tables carry an `assign_ref` trigger, and **no migration seeded any of it** — 013's catalog carries it as a standing condition and ten pins hand-seed around it, which means no pin had ever exercised the path a real customer takes. T2 is that path: one INSERT into `public.tenants`, no fixture, a real `ORG-0001` out of the trigger. **The seed is DERIVED from `pg_trigger`, not transcribed**, and the reason is measured: reading the migrations for `finalise_table(…,'PREFIX')` yields 27 prefixes, the truth is 32, and the five missed (`ATT`, `PIP`, `SIG`, `SVW`, `TPL`) are missed because their calls wrap across lines — a hand list would have shipped complete-looking and left attachments, pipelines, signatures, saved views and templates unwritable until somebody saved a view in production. Every trigger's `TG_ARGV[0]` is the same string `next_ref` receives, so seed and consumer are one list by construction; T1 asserts all five missed prefixes by name. **Provisioning is an AFTER INSERT trigger on `public.tenants`, matching 011's `trg_tenants_seed_action_policies`** rather than inventing a second shape — a script only covers the path somebody remembered to run it on. `app.provision_tenant()` adds no second implementation and REFUSES to return a tenant whose seeding did not fire; T3 proves it by disabling the trigger. **Idempotence leaves existing rows alone rather than overwriting**, because `ref` is immutable and flipping `dated` would split a customer's numbering in half; T4 corrupts a format, re-seeds, and asserts it was not "repaired". Ten pins amended to `ON CONFLICT … DO UPDATE` so each keeps its own fixture shape. ⚠ **Not seeded, deliberately:** `pipelines`/`pipeline_steps` (seeding them means hardcoding fifteen stage names, the exact defect both CLAUDE.md files forbid — **owner 018; a new tenant renders no pipeline until then**), the HRD Corp registry (national rows, and the research requires `status = 'PROPOSED'` pending a named Finance verifier — 017's), and rate cards/templates (customer data). Spine untouched, pipeline spine deliberately untouched. |
| 015 | `015_realtime_and_cron_schedules.sql` | **The scheduler: two pg_cron jobs, and the seven the design listed that are deliberately not here (2026-09-13).** One function, two jobs, no table, no type, no trigger, no policy. Ruling R-B — background work is the Node worker at `apps/worker` polling `app.claim_jobs`; pg_cron covers `reap_jobs` and cron-history retention only; **no pg_net nudges**. ⚠ This contradicts current Supabase docs, which document `cron.schedule` → `net.http_post` → Edge Function as supported; the header records that in full and overrules it on R-A (this product has no Edge Functions, so the far end of the nudge does not exist) rather than on technical grounds. Net effect: nothing in this database makes an outbound HTTP request, and pg_net's beta caveats stop being the product's problem. **`trainos_reap_jobs` is ONE job at `'30 seconds'`** — sub-minute is native, so doc 05's tick is not six staggered jobs each sleeping an offset. Its command is the pack's only new object, `app.reap_jobs_all_tenants()`: 012's `H-16` made the CLAIM tenant-fair, but the REAPER takes a flat LIMIT across all tenants ordered by time, so one tenant with a dead provider starves every other tenant's expired leases — the same defect through the recovery path. T3 measures the fix with Alpha at 50 leases, Beta at 1 and a budget of 10 each, plus a control proving a single-tenant reap really is single-tenant. **`trainos_reap_cron_history` daily at 03:17** because `cron.job_run_details` is never purged automatically **and is not cleared when a job is unscheduled**; ⚠ the 7-day window is 012's unsourced judgement, stated as such, and T4 proves it at 6 and 8 days. The seven unscheduled jobs each carry a reason — four retention sweeps wait on 017's `data_retention_policies` because deleting on an unapproved window is worse than not deleting, and two have no function to schedule at all. Scheduling a missing function is worse than not scheduling it (pg_cron logs and never raises), so verify and T1 resolve every command through `to_regproc` and T5 EXECUTES both. ⚠ **Realtime is deliberately untouched**: RLS on `realtime.messages` is already on and the schema locked, and the only migration-shaped additions need the topic vocabulary, which nothing in the product has yet. Carried forward: Realtime caches policies for the life of a connection, so a revoked permission does not close a live socket. ⚠ The harness's pg_cron is a stub that runs nothing; registration is pinned, firing is not. Spine untouched. |
| 014 | `014_rls_policies_and_client_grants.sql` | **The database stops being deny-all: 228 RLS policies, the client grant layer, and the three `core` wrappers over the 011 envelope (2026-09-13).** One function, 115 policied relations, zero tables, zero types, zero triggers. **The pack is `app.apply_tenant_policies()` plus a catalogue-driven loop**, not 114 hand-written blocks — 004's `finalise_table` argument applied to the policy layer, where it is stronger, because a policy typo applies successfully and admits the wrong rows. Two policies per table: a PERMISSIVE `FOR SELECT TO authenticated` and a RESTRICTIVE `FOR ALL` isolation policy with the predicate in USING *and* WITH CHECK, so tenant isolation cannot be widened by adding a policy beside it and is already correct on the day somebody grants a write. **`authenticated` gets SELECT and nothing else on `core`** — the spine rule enforced at the privilege layer, since a browser with UPDATE on `core.proposals` can move it with no action_request, no policy evaluation and no audit row; T9 proves the refusal is `42501` and not a policy matching zero rows, which would report success. **The global-row fallback is DERIVED from `attnotnull`, never listed**, so 009's national rules stay visible to every tenant and a NOT NULL table cannot accidentally get the permissive form. **Three defects found by granting rather than by reading:** `app.require_tenant_id` was not executable by `authenticated`, so every finished policy ERRORED instead of denying (a policy predicate runs as the querying role; 002 had granted the other four claim readers and missed this one because nothing used it yet); `core.rule_set_versions` has no tenant index because 009 hand-rolled it past `finalise_table`, caught by a check written as a regression test on 004 and fired on 1 relation in 114; and `core.budget_status`/`core.model_tier_status` are security-invoker views over `app.usage_rollup` and therefore **cannot be granted at all** — both are revoked with the reason, and the AI budget screens have no data path until 018. `core.v_approval_requests` stays ungranted per doc 09 §12 and T7 pins that it is readable through a definer and refused directly. Six earlier pins amended in place from "before 014" to the post-014 state, each marked ⚠ AMENDED BY 014; one draft change (revoking `anon`'s `app` USAGE) was caught by test_011 T13b as a regression against 011's M-04 and reverted. Spine untouched — and this is the migration that makes bypassing the spine impossible rather than discouraged. **⚠ AMENDED 2026-09-13 after the retrofit review returned BLOCK** (`docs/reviews/2026-09-13-codex-retrofit-014-017.md`, 2 CRIT / 4 HIGH / 5 MED, every premise re-verified against the branch and none wrong). Both CRITs and three of the four HIGHs are closed, each with a pin that fails against the pre-fix SQL; the fourth HIGH is carried because its fix is in `apps/web` and `packages/contract`. Corrections that change what this row said: the DELETE on `public.memberships` is gone (002 withheld it and its escalation stop is FOR UPDATE only, so the grant was a role-escalation path); the restrictive policy's predicate is NO LONGER the same string in USING and WITH CHECK — the global-row fallback is a READ concession only, because sharing it with WITH CHECK would have let any caller write a row attributed to no tenant and therefore visible to every tenant; the counts are 228 policies over 115 relations and 2 views granted, not 235/115/4; three tables (`ai_provider_keys`, `run_node_io`, `public_share_tokens`) carry a permission term in their restrictive half because tenant membership is not authorization there, and the other 110 deliberately do not; every grant assertion now uses `has_table_privilege` rather than `information_schema.table_privileges`, which is blind to a privilege held through PUBLIC; and the rollback both restores 002's five `public.*` grant sets and stops revoking 001:232's `USAGE ON SCHEMA core`, a third destroyed grant found by executing the rollback rather than by either reviewer. Full findings table in the Migration Detail section. |
| 013 | `013_ai_ops_agents_keys_runs_and_budgets.sql` | **AI operations: the agent roster and its credentials, BYOK provider keys, model tiers and routing, budgets and usage, the run trace tree and evals (2026-09-13).** Nineteen tables, two security-invoker views, twenty-nine functions, zero policies, zero new types. **`core.runs` settles the `run_id` divergence by reconciliation rather than by retyping**: the run has a `uuid` id AND a `ref`, so 012's text run ids resolve through `UNIQUE (tenant_id, ref)` and 007/009's uuid columns finally get the foreign keys their own comments said 013 would add. Neither side is altered and no row is rewritten. **Secrets are handled by mechanism, not by assertion**: no RPC takes a raw BYOK key at all, so it never reaches a request body, `log_min_duration_statement` or `pg_stat_activity`; the once-per-24-hours reveal ceiling is the PREDICATE of an UPDATE so two concurrent reveals cannot both pass; the audit row is written first and a trigger re-derives that it exists, so a reveal whose audit fails takes the transaction with it. The agent key is minted in the database from `gen_random_bytes(32)`, returned once as a result value and never as a parameter, and its salted digest lives in `app.agent_api_key_secrets` — `app` is not an exposed schema, so PostgREST cannot reach it through `select=*` or an embed, which is what `H-09` asked for and is stronger than omitting a column from a grant. Every security path is shaped to FAIL CLOSED under the carried FORCE-with-no-policy residue: a `SELECT count(*) … IF < 1 THEN allow` ceiling would have degraded to "always allow" where a definer function reads zero rows, and these degrade to "always refuse". Run I/O masking is honest about its limits — the pin asserts that a person's NAME survives it, so the day masking improves, the pin says the header is out of date. Spine untouched.  **⚠ AMENDED 13 Sep 2026** after the same review returned BLOCK. BYOK rotation had never worked: `app.require_reveal_audit` treated rotations clearing of `last_revealed_at` as an unaudited reveal, and `key_fingerprint` was in the frozen-column set so rotations own UPDATE was refused outright. Both fixed; the fingerprint is now paired to `key_ref` by a dedicated trigger instead of frozen. New pin T14 walks set → reveal → rotate. |
| 012 | `012_events_outbox_and_jobs.sql` | **Domain events, the audit index, the outbox and its job lifecycle, dead letters, inbound webhooks and the retention reapers doc 05 promised and never wrote (2026-09-13).** Ten tables, one security-invoker view, thirty functions. `core.events` is the business record and is append-only by revoke, by a row trigger AND by a statement-level `BEFORE TRUNCATE` trigger — a row trigger does not fire for `TRUNCATE`, so before that the guarantee was defeated by one statement. `C-09` is answered by exactly one narrow exemption: `app.redact_event_actor` writes its own audit row and the append-only trigger re-derives from the row that the change was a redaction and nothing else, so PDPA erasure has a path and only that path. `C-08`, the poison pill, is closed on both lanes — `claim_jobs` will not hand out a job at `max_attempts` and `reap_jobs` dead-letters it instead of returning the lease — which is what stops a handler that OOMs the isolate re-pushing the same invoice to the accounting package forever. `H-12` and `M-14`: `fail_job` and `heartbeat_job` now check tenant, state AND owner, so worker A cannot dead-letter or extend a job worker B is running; the race is pinned end to end, not asserted. `H-16` gives the claim per-tenant fairness by `row_number() OVER (PARTITION BY tenant_id)`, proved by flooding fifty jobs from one tenant and watching the other's single interactive job still come back. `M-20`: a provider idempotency key is `<subject>#<attempt>` from a stored counter, never the job id, so replaying a dead-lettered push cannot submit the same invoice twice. **The seam with 011 is one enum and one raising function**: `app.effect_status` is reused by oid, the outbox's own state vocabulary is deliberately different, and `app.effect_status_for_job_state` raises on anything but SUCCEEDED and DEAD (R14). Spine untouched — 012 wires the envelope's external effects to a queue without changing the envelope.  **⚠ AMENDED 13 Sep 2026** — no change to 012 itself; 011 now calls its `app.enqueue_effect_jobs`, which had no production caller. See the 011 row. |
| 011 | `011_action_envelope_and_policy_gate.sql` | **The write spine: the action envelope, the policy gate, approvals, idempotency, the effect ledger, the jury seam and the GOV-07 transition registry (2026-09-13).** Eleven tables, one security-invoker view, one shared `app.effect_status` enum, twenty-eight functions. Every primary button and every agent proposal in the product passes through `app.perform_action`, which is evaluated once, logged once, and dispatched to exactly one of EXECUTED, QUEUED_FOR_APPROVAL or SUGGESTED; the policy input is derived from stored rows and never trusted from the payload. New capability ships as a new action *type* plus a handler registered in data, never as a branch inside the envelope. **Second spine, and the one this migration makes real: `core.state_transitions`.** A status is no longer something a caller types into a column — 124 registry rows say which edges exist and which action authorises each, and `app.enforce_state_transition` is attached to every gated column that exists. That is what invalidated six committed pins, and repairing them is what found a defect in 008 and three missing edges in doc 01 §5.3. Seven critic findings are closed with an assertion each: `H-02` the agent cannot grant itself autonomy (the one RLS policy deliberately landing before 014, `AS RESTRICTIVE FOR ALL` in both clauses so INSERT and DELETE are covered); `H-03` self-approval, including the NULL requester, because `NULL IS DISTINCT FROM <uuid>` is TRUE and that is the fraud; `H-04` a NULL role raises before the authorisation disjunction instead of falling through it; `H-05` money-moving actions check `app.aal2_verified()`, grounded in an `auth.sessions` row GoTrue wrote rather than a claim the caller presents; `H-07` all three holes; `M-12` a NULL ceiling raises instead of permitting; `M-21` an idempotent replay returns the original body with 200. Nothing is granted to `anon` or `authenticated` — the `C-04` grant-sequencing residue is carried to 014, where policies and grants land together. Spine: this IS the spine, and it is pinned hardest.  **⚠ AMENDED 13 Sep 2026** after docs/reviews/2026-09-13-codex-retrofit-011-013.md returned BLOCK. Three changes: `app.apply_effects` now CALLS `app.enqueue_effect_jobs`, which nothing outside a test pin had ever called — every external effect was written DISPATCHED and never sent; `app.perform_action` now requires the actor to hold `app.action_types.required_permission` before dispatch, closing a HUMAN path that had no permission check at all when no policy row matched; and `app.effect_applier` is cleared at the end of `apply_effects`. New pins T16 and T17. |
| 010 | `010_finance_invoices_payments_collections.sql` | **Invoices, payments, credit notes, the e-invoice mirror, receivables aging and the collections ladder (2026-09-13).** Ten tables. Total-from-lines reuses 007's pattern rather than inventing a second one — the line amount is GENERATED, an AFTER trigger recomputes the header, a DEFERRABLE constraint trigger asserts at COMMIT — and extends it: `sst_sen` and `total_sen` are GENERATED too, so a wrong total is unrepresentable rather than merely rejected. **SST is computed on the summed net**, and the pin proves that is not pedantry: three lines at RM 333.33 at 8% give 8,001 sen per-line and 8,000 sen on the summed net. **Payments are append-only**, enforced by a trigger that refuses UPDATE and DELETE; a correction is a reversal row with a reason, because a signed amount column would let a correction be entered as an ordinary payment and vanish into the total. **Critic C-11 is answered**: the e-invoice mirror separates the document UUID from the submission UID, carries the QR long id, a status vocabulary that can express SUBMITTED_PENDING_VALIDATION and CANCELLED, structured per-field validation errors with a key-presence CHECK, per-line classification and UoM codes, self-billed and consolidated flags, a supplier tax profile and buyer identifiers — and enforces the **statutory 72-hour cancellation window**, proved at 71 and 73 hours. Credit notes are the legal exit from a mistake on a filed invoice and cannot exceed it. Aging buckets and the 7/30/45/60/75 ladder are DATA with a GiST exclusion and two CHECK constraints that make "reminder 3 is always human" and "a trading hold needs MD" unrepresentable. Spine untouched. |
| 009 | `009_compliance_rules_checks_hrdc.sql` | **The bitemporal HRD Corp rule registry, rule-change review, checks with version drift, claim packets, knowledge corpus (2026-09-12).** Twelve tables. Rules carry two time ranges — in force, and known — so re-running a check on an old engagement resolves what the registry said THEN rather than silently re-deciding it against today. A GiST exclusion constraint over both axes makes "which rule applied on this date as known on that date" have exactly one answer. Rules are national by default (`tenant_id NULL`) with optional tenant overrides that win locally and nowhere else; there is deliberately no platform-admin role, so writing a national rule is a provisioning act. A rule cannot go ACTIVE without a named verifier, per DECISIONS §3. A packet cannot be marked SUBMITTED while incomplete — contract §9's 422 expressed where an application cannot route around it — and a required document marked PRESENT must have something behind it. A changed knowledge source is quarantined by constraint. Spine untouched. |
| 008 | `008_delivery_engagements_sessions_attendance.sql` | **Delivery, and the one-way attendance lock (2026-09-12).** Engagements with a configuration-driven lifecycle, sessions, participants, attendance, certificates, evaluations, message rates and outbound messages. The attendance lock is enforced on the day AND its entries, because the rule is about the day and the writes happen to the entries. Locking forces all three capture modes false so the response cannot contradict the rule. Unlocking requires a reason, clears the approval, reopens capture and increments a counter the caller cannot set. `engagement_step_states` stores no step key and no position — both come from `pipeline_steps`. Participants' identity numbers are stored as a hash plus last four, never the number. A sent message cites the consent row it relied on by foreign key. Closes the two FKs 006 and 007 left open. Spine untouched: `ATTENDANCE_APPROVE` and `ATTENDANCE_UNLOCK` are action types 011 will dispatch; this is what makes the lock real when it does. |
| 007 | `007_money_proposals_quotations_portal.sql` | **Money: rate cards, provenance, proposals, quotations and the client portal (2026-09-12).** Eighteen tables. Total-from-lines is enforced, not trusted: `quotation_lines.total_sen` is a GENERATED column so a caller cannot supply a total that disagrees with its own unit price and quantity, a trigger recomputes the header from the lines, and a DEFERRABLE constraint trigger refuses to commit a header that disagrees. Deferred because a multi-line edit legitimately passes through states where they do not match. **Two floors, both generated**: an absolute programme floor stamped at pricing time and a margin floor derived with `ceil` (never `round`), with the binding one and `below_floor` derived from the row so the costing screen and the approval screen cannot compute them differently. `floor_margin_rate` and `commission_rate` are STAMPED onto the quotation, so a rate-card edit cannot silently reprice a proposal already sent, and the floor stays reproducible after the card is retired. Portal tokens store only a SHA-256 hash, and `UNIQUE (tenant_id, proposal_id)` on acceptances makes a double-clicked Accept unable to create a second binding acceptance whatever the handler does. Spine untouched. |
| 006 | `006_catalogue_programmes_and_trainers.sql` | **What the business sells and who delivers it (2026-09-12).** Programmes with modules, pricing tiers and materials; trainers with pool membership, a declared availability calendar and bookings. The catalogue sits in Delivery, not Sales, because `PUT /programmes/{id}` is ADMIN + L&D and returns FORBIDDEN to SALES. Three things it gets right that are easy to get wrong: the tier floor price is an **absolute** commercial-policy figure rather than a derived margin; a trainer **cannot** hold two overlapping CONFIRMED bookings, enforced by an EXCLUSION constraint rather than by application code, while two SOFT_HOLDs may overlap on purpose; and the availability calendar is written by a trigger on bookings so the two can never disagree. Closes the three foreign keys 002 and 005 left open (`memberships.trainer_id`, `organisation_suggestions.programme_id`, `tna_recommendations.programme_id`). Spine untouched. |
| 005 | `005_sales_organisations_enquiries_tna.sql` | **The sales path: organisations, contacts and consent, enquiries and extraction, opportunities, follow-ups, needs analysis (2026-09-12).** Fourteen tables, all through `app.finalise_table`, all deny-all until 014. Four non-obvious modelling decisions, each with the reason in the file: `contact_consents` is an append-only PDPA ledger rather than a flag, because "did this person consent on 4 March 2024" must stay answerable after they withdraw; `enquiry_extraction_fields` is one row per field because each carries its OWN provenance and edit history, and four columns could hold four values but not four independent provenances; `organisations.proposal_count` is a header CACHE that the policy gate must not read (deviation D2); and the "never auto-archived" rule for low-confidence enquiries is a CHECK constraint rather than a property of a background job. Every FK into a `core` parent is composite `(tenant_id, parent_id)`, so a cross-tenant reference is rejected by the storage engine independently of RLS. Spine untouched. |
| 004 | `004_shell_config_and_ref_allocation.sql` | **The shell: `app.finalise_table()`, ref allocation, and 14 configuration and reference tables (2026-09-12).** One procedure gives a tenant-scoped table its whole standard posture — composite `(tenant_id, id)` and `(tenant_id, ref)` uniques, tenant index, `updated_at` trigger, frozen `tenant_id`/`ref` plus any extra columns, ref allocation, and **RLS enabled AND FORCED with zero policies**, so no table in this set is ever open, not even for the duration of one migration. Ref allocation is one `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` per `(tenant, prefix, period)`, serialising per prefix per tenant rather than globally; the year comes from the TENANT's timezone, because a record created at 08:00 MYT on 1 January is a January record and UTC would call it December. `pipeline_steps` is the point of the migration: the contract shows two different lifecycles for the same object (six steps on the relations panel, nine on the engagement detail) and those are two `pipelines` rows, not two hardcoded arrays. `templates` are versioned and never edited, so a five-year-old proposal still renders as sent. `app.action_types` created here as the global catalogue (conflict C4); seeded in 011. Spine: `finalise_table` IS a new spine object and is pinned hardest. |
| 003 | `003_enum_types.sql` | **69 native enum types in `core`, 271 labels, generated from the contract package (2026-09-12).** Closed catalogues frozen by contract §12/§17 become native enums — four bytes on disk across a model full of status columns, and real union types in the generated TypeScript. Open, config-driven sets (`action_type`, lifecycle step key, compliance check key, `hrdc_document_type`, metric key, tier key, template type, TNA constraint code) deliberately do NOT appear here: they arrive in 004 as reference tables, because the project rule is that stage names and order render from configuration, and a CHECK constraint is code while a reference table is data. 62 types generated from `packages/contract/src/enums.ts`; 7 named by doc 01 alone and listed separately. `app_role` and `actor_kind` are NOT duplicated into `core` — doc 02 owns both and creates them in `app` (conflict C2). Spine untouched: types only, no table, no function, no policy. |
| 002 | `002_tenancy_identity_and_permissions.sql` | **Multi-tenancy from row zero: five identity tables, 109 permissions as data, and the access-token hook (2026-09-12).** `public.tenants`, `teams`, `team_members`, `memberships` and `user_profiles` (author addition), all RLS-enabled AND **forced** — forced removes the table owner's exemption, so a function running as `postgres` no longer silently sees every tenant. Three enum types in `app` (`app_role`, `actor_kind`, `data_scope`) per doc 02 §1.2. Eighteen claim readers and predicates: `app.current_tenant_id` (the spelling three lanes converged on — `app.tenant_id()` does not exist and must not be created), `app.has_permission`, `app.can_see_owner`, `app.my_team_user_ids`, `app.aal`, and `app.principal_claims` as the SINGLE claim-building body shared by the GoTrue hook and the agent-token minter, because §3.1 notes the hook does not run for a self-minted token and two bodies would drift. `app.role_permissions` seeded with 399 (role, permission) pairs over 109 permissions, parsed from doc 02 §2.3 rather than transcribed. **The escalation stop is a RESTRICTIVE policy**: `memberships_no_self_edit` — without it an ADMIN can UPDATE their own row to any role, scope or tenant, and `memberships_write_admin` permits it because they ARE an admin of that tenant while they do it. ADMIN writes additionally require `aal2`. Spine untouched — the action envelope does not exist yet; 002 is the authorization the spine will rest on. |
| 001 | `001_foundation_schemas_and_helpers.sql` | **The floor: three schemas, seven extensions, five shared helpers (2026-09-12; amended 2026-09-13).** Creates `app` (helpers + the action gate, NOT exposed to PostgREST), `core` (the 86-table domain, exposed), and `extensions`. Installs citext (case-insensitive email, so `EXACT_DOMAIN` contact matching does not silently miss on case), btree_gist (the EXCLUDE constraint that stops a trainer being double-booked, 008), pg_trgm (⌘K search), pgcrypto (share-token hashing — platform-provided on Supabase, so 001 does not own it and the rollback leaves it), and, under ruling R-EXT, **pg_cron** (`WITH SCHEMA pg_catalog`, the only spelling its control file permits — without it the design's nine scheduled behaviours are dead code no error reports), **pg_net** (async HTTP for the outbox; the synchronous `http` extension would block a writing transaction on a third party's latency) and **vector** (`knowledge_chunks.embedding vector(1536)` and its HNSW index). Five helpers: `app.set_updated_at`, `app.enforce_immutable_columns` (generic, column names as trigger arguments — one implementation, N attachments, instead of N triggers that drift), `app.round_half_up_sen` (the single definition of DECISIONS §7's rounding rule), and `app.ok`/`app.err`. **The envelope is a FUNCTION, not a convention:** point 2 of the contract check is structural rather than review-dependent because `app.ok(jsonb)` BUILDS the object, so a top-level sibling key is not something a later author can add by accident. Applies doc 02 §4.1's schema baseline to `public` and `core` — and records that two of its four lines do not work. No spine yet; this creates the primitives the spine is built from. |

---

## Tables

### `public.tenants` — 002
`id uuid PK`, `slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$')`, `name text NOT NULL`, `status text NOT NULL DEFAULT 'ACTIVE' CHECK IN (ACTIVE, SUSPENDED, CLOSED)`, `timezone text NOT NULL DEFAULT 'Asia/Kuala_Lumpur'`, `locale text NOT NULL DEFAULT 'en-MY'`, `created_at`, `updated_at`. RLS enabled + forced. SELECT own row only; UPDATE by tenant ADMIN; **no INSERT and no DELETE policy** — creating and closing a tenant is `service_role` provisioning, not a button.

### `public.teams` — 002
`id uuid PK`, `tenant_id → tenants ON DELETE CASCADE`, `name`, `manager_user_id → auth.users ON DELETE SET NULL`, timestamps. `UNIQUE (tenant_id, name)`. RLS enabled + forced; tenant-wide SELECT, ADMIN write.

### `public.team_members` — 002
`tenant_id`, `team_id → teams CASCADE`, `user_id → auth.users CASCADE`, `PRIMARY KEY (team_id, user_id)`. Read by `app.my_team_user_ids()` (SECURITY DEFINER, so the table's own policy cannot recurse into it).

### `public.memberships` — 002
`PRIMARY KEY (tenant_id, user_id)` — a human CAN hold memberships in more than one tenant; nothing at launch uses that, and the hook pins the single `is_default` row. Columns: `role app.app_role`, `actor_kind app.actor_kind DEFAULT 'HUMAN'`, `agent_id text`, `primary_team_id`, `trainer_id uuid` (FK deferred to 006, when `core.trainers` exists), `client_scope`/`team_scope app.data_scope`, `mfa_required bool`, `status CHECK IN (ACTIVE, SUSPENDED, REMOVED)`, `is_default bool`. Three check constraints tie agent identity together: `(actor_kind='AGENT') = (agent_id IS NOT NULL)`, an AGENT must hold role `AGENT`, a TRAINER must carry a `trainer_id`. Partial unique indexes: one default membership per user, one agent id per tenant. `tenant_id` and `user_id` are frozen by `app.enforce_immutable_columns` — allowing either to move would silently transplant a role into another tenant. **No DELETE policy**: removal is `status = 'REMOVED'`, so "who had access in November" stays answerable.

### `public.user_profiles` — 002 ⚠ AUTHOR ADDITION
`PRIMARY KEY (tenant_id, user_id)`, `display_name`, `email citext`, `locale`, `timezone`, `theme CHECK IN (LIGHT, DARK)`, `avatar_url`. Doc 02 §1.2 assigns it to sb-erd and names only the two columns it requires; doc 01 never defines it. Created here so the identity layer is complete rather than split across a lane boundary; the remaining columns come from the `GET /v1/me` shape in contract §2.

### `app.role_permissions` — 002
`(role app.app_role, permission text) PRIMARY KEY`, permission shape enforced by `CHECK (permission ~ '^[a-z][a-z0-9_]*(:[a-z][a-z0-9_]*)+$')`. 399 rows over 109 permissions. **No RLS and no grants**: `app` is not exposed to PostgREST and no role holds SELECT; it is reached only through `app.has_permission()`, which is SECURITY DEFINER for exactly that reason.

---

## Indexes

### public.teams — 002
`teams_tenant_id_idx (tenant_id)` · `teams_manager_user_id_idx (manager_user_id)`

### public.team_members — 002
`team_members_tenant_user_idx (tenant_id, user_id)` · `team_members_user_idx (user_id)`

### public.memberships — 002
`memberships_user_id_idx (user_id)` — the hook searches by user ACROSS tenants, so the `(tenant_id, user_id)` PK does not serve it ·
`memberships_one_default_per_user UNIQUE (user_id) WHERE is_default AND status='ACTIVE'` ·
`memberships_agent_unique UNIQUE (tenant_id, agent_id) WHERE agent_id IS NOT NULL`

### public.user_profiles — 002
`user_profiles_user_id_idx (user_id)`

---

## RPCs (Functions)

### Helper Functions

Internal, never client-callable. Every one below is `REVOKE ALL ... FROM PUBLIC, anon, authenticated`.

> **Every function in `app`, `core` and `public` is `SET search_path = ''`** — one spelling across the
> whole pack, amended 2026-09-13, deviation D1 closed. Every body is fully schema-qualified, which is
> what makes the empty path safe; `test_001` T3 asserts the exact stored string `search_path=""` as
> one element of `proconfig`, covering all three schemas and skipping extension-owned functions.
> `app.custom_access_token_hook` and `app.principal_claims` are `SECURITY INVOKER`; every other
> function's mode is stated in its own entry.

#### `app.set_updated_at()` → trigger — 001
`BEFORE UPDATE FOR EACH ROW`. Stamps `NEW.updated_at := now()`. Attached by every table migration.

#### `app.enforce_immutable_columns()` → trigger — 001
`BEFORE UPDATE FOR EACH ROW`, frozen column names passed as trigger arguments. A column freezes once it holds a value: `NULL → value` is allowed (several columns in this model are stamped after insert — `ref` by a BEFORE INSERT trigger, `accepted_at` once), `value → other` and `value → NULL` both raise `IMMUTABLE_COLUMN`. A no-op re-save of the same value is not a violation. A column named in the trigger that does not exist on the row raises `undefined_column` rather than silently protecting nothing — that failure mode would leave `ref` freely writable across the whole model with every migration still looking correct, and it is pinned by T9.

#### `app.round_half_up_sen(numeric)` → bigint — 001
`IMMUTABLE STRICT PARALLEL SAFE`. The single definition of DECISIONS §7: half-up, away from zero, to whole minor units. `STRICT`, so a NULL amount yields NULL and never a silent zero. Pinned against banker's rounding at 2.5 → 3.

#### `app.ok(jsonb DEFAULT '{}')` → jsonb — 001
Builds exactly `{success: true, data}`. `data` is the sole non-`success` key, which is the precondition the client's auto-unwrap depends on.

#### `app.err(text, jsonb DEFAULT NULL)` → jsonb — 001
Builds exactly `{success: false, error: {code[, details]}}`. Details nest INSIDE `error`; a top-level sibling is the failure mode this function exists to make unreachable.

#### Claim readers — 002
All `STABLE`, all reading nothing but `request.jwt.claims`, none `SECURITY DEFINER` because there is nothing to define away — they tell the caller about the caller. `app.jwt() → jsonb` · `app.current_tenant_id() → uuid` · `app.role() → app.app_role` · `app.actor_kind() → app.actor_kind` · `app.client_scope()` / `app.team_scope() → app.data_scope` · `app.aal() → text` · `app.is_agent() → boolean` · `app.agent_id() → text` · `app.trainer_id() → uuid`. **Every one defaults to the LEAST privilege when the claim is absent** — no tenant, no role, `MY_ACCOUNTS`, `aal1` — pinned by T4.

#### `app.has_permission(text)` → boolean — 002
`STABLE SECURITY DEFINER`. Purely so no login role needs SELECT on `app.role_permissions`. Takes no identity argument and reads only the caller's own claim, so there is no privilege to escalate — the self-check the Supabase guidance requires is structural here rather than written out. EXECUTE to `authenticated`.

#### `app.my_team_user_ids()` → uuid[] — 002
`STABLE SECURITY DEFINER`. Reads `team_members` without that table's policy recursing into it. Resolves the caller from `auth.uid()` internally, so it cannot be pointed at someone else's team. Returns an array the policies test with `= ANY(...)` — the flattening the Supabase RLS-performance guidance prescribes, done once instead of per policy.

#### `app.can_see_owner(uuid)` → boolean — 002
`STABLE`. `ALL` → true; `MY_TEAM` → owner is in `my_team_user_ids()`; otherwise owner is the caller. See the dated entry above for the compile error in the doc's version of this body and why the `::uuid[]` cast matters for the InitPlan.

#### `app.require_tenant_id()` → uuid — 002
`STABLE`, raises `NO_TENANT` when the claim is absent. **For gate functions only. A POLICY MUST NOT CALL THIS** — a predicate that raises turns an empty result set into a 500, which is both a worse experience and an existence oracle.

#### `app.has_role(text)` → boolean — 002
Exists because sb-actions asked for it. Prefer `app.has_permission()` wherever a permission string fits: the matrix is data, so an MD can move a permission between roles without a migration, while a role check hard-codes today's matrix into the caller.

#### `app.current_actor()` → table(actor_id text, actor_kind text, role text) — 002
sb-actions' actor record. `actor_kind` has four values: portal RPCs write `CLIENT`.

#### `app.principal_claims(uuid)` → jsonb — 002
`STABLE SECURITY DEFINER`. The SINGLE claim-building body. Resolves the caller's default ACTIVE membership in an ACTIVE tenant and returns the nine identity claims. A user with no active membership gets `{tenant_id: null, app_role: null, actor_kind: 'HUMAN'}` — claims that satisfy no policy anywhere, which is the correct failure direction.

#### `app.custom_access_token_hook(jsonb)` → jsonb — 002
GoTrue hook; merges `app.principal_claims()` into the event's claims. EXECUTE to `supabase_auth_admin` ONLY. That role is neither superuser nor `BYPASSRLS`, so it needs the SELECT grants AND the two `*_auth_admin_read` policies — without them the hook returns no row, every token issues with `tenant_id: null`, and the only symptom is that nobody can see anything.

### Public RPCs

*None yet. The first client-callable surface arrives in 011 (the action envelope) and 014 (the portal).*

---

## Migration Detail — 001 (`001_foundation_schemas_and_helpers.sql`)

**Status: AUTHORED + EXECUTED 2026-09-12, NOT APPLIED to any hosted database.** Executed against a
scratch PostgreSQL 17.11 cluster with a platform shim (see "How this set was validated" below).
Source docs: `docs/architecture/01` (conventions, `set_updated_at`, `enforce_immutable_columns`),
`docs/architecture/02` §1.2 and §4.1 (the `app` schema, the schema baseline),
`docs/architecture/03` §1 (the `core` schema), `DECISIONS.md` §7 (rounding).
**AMENDED 2026-09-13 (pass A), re-executed, still NOT APPLIED.** Three changes. (1) Ruling R-EXT: `pg_cron` `WITH SCHEMA pg_catalog` plus Supabase's two documented `cron` grants, `pg_net` and `vector` into `extensions` — seven extensions now, not four, and the verify block asserts each one's schema AND its callable surface (`cron.job`, `cron.job_run_details`, `net.http_post`, `extensions.vector`). (2) All five helpers moved to `SET search_path = ''`; the verify block asserts the exact string `search_path=""` as one element of `proconfig`, not `proconfig IS NOT NULL`, which passes all three spellings including the broken single-quoted-comma form. (3) The header's justification for the `core` schema no longer quotes doc 03 §1 — an early draft that the committed document later contradicted (critic `C-01`) — and rests on `config.toml`'s `schemas = ["public", "core", "graphql_public"]`, read on 2026-09-13, plus the ~250 `core.*` references three lanes have since written against it. Rollback gained guard `G4`: it refuses if `cron.job` holds any row, because `DROP EXTENSION pg_cron` deletes every scheduled job.

### What it does

- **Schemas `app`, `core`, `extensions`.** `app` is not exposed to PostgREST; `core` is, and
  `config.toml` carries that with the reason. `public` keeps only identity and tenancy.
- **Extensions** pgcrypto, citext, btree_gist, pg_trgm — each installed into `extensions`, never
  into `public`, and each with the specific downstream consumer named in the header.
- **`app.set_updated_at()`**, **`app.enforce_immutable_columns()`**, **`app.round_half_up_sen()`**,
  **`app.ok()`**, **`app.err()`** — see the RPC section above.
- **Grants:** `USAGE` on `app` to anon + authenticated (an RLS predicate is evaluated in the
  CALLER's context and must be able to resolve `app.<fn>`), `EXECUTE` on nothing.
- **Spine untouched:** there is no spine yet. 001 creates the primitives the action envelope (011)
  is built from.

### The 7-point RPC contract check, worked

1. **Envelope** — no RPC added. `app.ok`/`app.err` are the constructors that make the envelope
   structurally correct for every RPC from 011 onward; their own shape is asserted by test_001 T5
   with an exact key-set comparison, not a "contains" check.
2. **Unwrap** — `app.ok` emits exactly `{success, data}`; `app.err` exactly `{success, error}`,
   with `details` nested inside `error`. A sibling key fails T5f.
3. **RpcMap** — no entries. `packages/contract/src` does not exist yet and 001 adds no
   client-callable surface to describe.
4. **Call sites** — none; new objects with no consumers. Expected, not a dead-RPC finding.
5. **Casts** — none.
6. **Reload/restore** — no client-visible behaviour.
7. **Public routes** — none. Nothing in 001 is reachable from an unauthenticated request; the
   portal's public surface arrives in 014.

The repo has no `check:rpc` / `check:grants` script yet (those are `docs/research/03`'s port list,
owned by another lane). The equivalent invariants are asserted structurally by test_001 T3 and T4.

### Pin — `tests/test_001_foundation_schemas_and_helpers.sql`

Eleven checks, all executed, all PASS.
T1 schemas exist, USAGE yes and CREATE no on `app` ·
T2 four extensions, in `extensions` rather than `public` ·
T3 every helper pins `search_path` (pg_catalog first, pg_temp last) ·
T4 zero anon/authenticated EXECUTE grants in `app` ·
T4b PUBLIC holds neither CREATE nor USAGE on app/core/public ·
T5 both envelopes carry exactly two keys and `details` nests inside `error` ·
T6 rounding is half-up and not banker's (2.5 → 3), away from zero, STRICT on NULL ·
T7 `set_updated_at` actually advances the column ·
T8 immutability freezes on first value, refuses change AND erasure, allows a no-op re-save ·
T9 a trigger naming a column that does not exist RAISES instead of silently protecting nothing ·
T10 `anon` is genuinely refused `app.ok` — asserted by becoming anon, not only by reading
`has_function_privilege`.

**RLS four-way: not applicable.** 001 creates no table and therefore no policy. The
owner/peer/other-tenant/anon matrix begins in `test_014_rls_policies`, against tables that exist.

T4b is where a real defect was caught: it originally asserted a `pg_default_acl` row and FAILED,
which is what exposed the ALTER DEFAULT PRIVILEGES finding recorded in the dated entry above. The
assertion was corrected to pin what is true rather than what was expected.

### Rollback — `rollbacks/001_foundation_schemas_and_helpers_rollback.sql`

Three pre-flight guards, none with an override: **G1** any function in `app` that 001 did not create
means a later migration put it there; **G2** any trigger still bound to the shared trigger functions
means a table still depends on them; **G3** any relation in `public` or `core` means business tables
exist. Then, in reverse of the forward order: grants, `public`'s default privileges restored to the
way Postgres ships them, five functions, three extensions (no CASCADE), `app` and `core` dropped
`RESTRICT`. `pgcrypto` and the `extensions` and `public` schemas are deliberately left standing —
all three are platform-provided and none is 001's to drop. Round-tripped: applied → rolled back →
re-applied, verify green each time.

---

## Migration Detail — 024 (`024_training_delivery.sql`)

**Status: AUTHORED + EXECUTED 2026-09-14 against the hosted-like PostgreSQL 17 shim (every
migration and pin run as a NOSUPERUSER BYPASSRLS role), NOT APPLIED to any hosted database.**

### What it does

| Function | Args | Permission | Returns through |
|---|---|---|---|
| `core.list_engagements` | `p_filter jsonb, p_sort text, p_page jsonb, p_view text` | `engagement:read` | `app.ok({data,page,appliedFilters})`, each row `core.get_engagement` |
| `core.get_engagement` | `p_id text` | `engagement:read` | `app.ok(Engagement)`, `finance` dropped without `quotation:read` |
| `core.get_engagement_participants` | `p_id text, p_page jsonb` | `participant:read` | `app.ok({data,page})` |
| `core.get_attendance` | `p_id text, p_day integer` | `attendance:read` | `app.ok(AttendanceSheet)` |
| `core.capture_attendance` | `p_id text, p_day integer, p_body jsonb` | `attendance:capture` | `core.get_attendance(p_id,p_day)` |
| `core.export_attendance` | `p_id text, p_format text` | `attendance:export` | `app.ok({url,expiresAt})` |
| `core.put_programme` | `p_id text, p_body jsonb` | `programme:write` (ADMIN only, 002 §11) | `core.get_programme(p_id)` |

**Privilege table for hosted apply.** All seven: `REVOKE ALL FROM PUBLIC, anon, authenticated` then
`GRANT EXECUTE TO authenticated` only, per-object (001's finding: the default-privileges REVOKE does
not take for a function created later, so every new function needs its own REVOKE+GRANT). No table,
view, enum value or grant on an existing object is touched.

**List/get pagination reuses 018's engine.** `list_engagements` and `get_engagement_participants`
call `app._page_size` / `app._cursor_decode` / `app._keyset_scope` / `app._next_cursor` rather than a
new one. `list_engagements`' filter allow-list is deliberately small (`status`, `createdAt`,
`updatedAt`) — the shipped client never sends a filter for this list today
(`features/engagements/api.ts`'s `useEngagements()` calls `listEngagements()` with no arguments).

**`capture_attendance` answers the lock in the contract's own shape.** The one-way lock is 008's
trigger, unconditionally; this function pre-checks `attendance_days.status = 'LOCKED'` and raises
`TRNOS` with `{code:'ATTENDANCE_LOCKED', approvedAt, unlockPath:'/v1/actions',
unlockActionType:'ATTENDANCE_UNLOCK'}` — the contract's `AttendanceLockedDetails` — rather than
surfacing the trigger's generic exception text. `008`'s `ae_absent_needs_reason` CHECK requires a
reason whenever `present = false`; the fixture client leaves it optional, so an absence with no
caller-supplied reason is written as `OTHER` — the schema's stricter rule, applied rather than
routed around.

**`put_programme` writes scalar fields only.** `name`, `category`, `days`, `status`, `hrdcScheme`,
`hrdcClaimable`, `listPrice`, `listPricePax`, `floorPrice`, `floorMarginRate`, `outcomes`. The four
nested arrays (`modules`, `pricingTiers`, `trainerPool`, `materials`) are left untouched regardless
of what a caller's `Partial<Programme>` carries for them: `core.programme_pricing_tiers.floor_price_sen`
is `NOT NULL`, and the contract's `PricingTier` (`{maxPax, price}`) does not carry a floor, so a
client-supplied tier cannot be inserted without inventing a business number the contract never sent.
Flagged as a decision to confirm rather than guessed at.

**`getProgrammeDeliveries` fixed in the same commit, web-side only.** `apps/web/src/shared/api/rpcClient.ts`
matched `v_programme_deliveries.programme_id` (a uuid column, 020) against whatever the caller holds
— which is always the route's REF (`:programmeRef`), never a uuid — so the panel silently returned
zero rows. Now resolves through `get_programme`'s own id-or-ref lookup first, the same fix
`getOrganisationRelations` already carries for the same reason. Not a 024 SQL change; reported here
because it blocks the same screens this migration exists to serve, and because `check:rpc` would
otherwise have nothing to say about a view read that "succeeds" with an empty array.

**Scope-narrowing (○ in 002 §11) is not applied**, holding the same line 018/021 already state for
the rest of the golden path: a TRAINER with `engagement:read` sees every engagement in the tenant
through these RPCs, not only their own — a SECURITY DEFINER read does not evaluate the caller's RLS
policies. Reported again rather than fixed as a side effect of an unrelated lane; narrowing by owner
is a per-table design call for a follow-up migration.

`$verify$`: V1 all seven exist, exactly one overload, granted to `authenticated` only, not to `anon`.
V2 the permission gate is the first statement and no `FROM core.`/`FROM app.` read precedes it. V3
every role holding `attendance:capture` or `programme:write` also holds the paired read, read from
`app.role_permissions` in this database. V4 `programme:write` is held by ADMIN alone.

### The 7-point RPC contract check, worked

1 Envelope: `app.ok`/`app.err` for reads, `RAISE … TRNOS` for writes — shapes 018/021 already return.
2 Unwrap: list/participants return `{data,page[,appliedFilters]}` (2–3 sibling keys, passed through);
get/capture/put return a single `data` key (auto-unwrapped); `export_attendance` returns
`{url,expiresAt}` (2 sibling keys, neither named `data`, so no auto-unwrap collision).
3 RpcMap: one definition each, `$verify$` V1.
4 Call sites: `features/engagements/api.ts` (`useEngagements`, `useEngagement`,
`useEngagementParticipants`, `useAttendance`, `useAttendanceDays`, `useCaptureAttendance`,
`useExportAttendance`) and `features/programmes/api.ts` (`useEditProgramme`,
`useEngagementsForProgramme`).
5 Casts: `client.ts`/`rpcClient.ts`/`apiClient.ts` edited in the same commit, argument names match.
6 Reload: none of the seven run on shell bootstrap.
7 Public routes: nothing granted to `anon`; V1 asserts it.

### Pin — `tests/test_024_training_delivery.sql`

T1 ADMIN reads `list_engagements`/`get_engagement`/`get_engagement_participants` and gets the
contract's keys back, `finance` and the lifecycle (from `pipeline_steps`, `position` order) included.
T2 OPS reads the same engagement without `finance` — R7, dropped not zeroed. T3 CLIENT is FORBIDDEN
on all seven, `requiredPermission`/`requiredRole` named, byte-identical for a real id and an invented
one. T4 `anon` cannot execute any of the seven — 42501 from the grant itself. T5 a tenant-B ADMIN
reading tenant A's engagement ref gets non-enumerable NOT_FOUND. T6 an OPEN day accepts a present
mark and a defaulted-reason (`OTHER`) absent mark; a LOCKED day (walked through 011's GOV-07 gate,
`pg_temp.gate('ATTENDANCE_APPROVE', …)`, same rig as `test_008`'s T3) refuses capture with the
contract's exact `AttendanceLockedDetails` shape. T7 ADMIN's `put_programme` write lands and reads
back through `core.get_programme`; OPS is FORBIDDEN naming `requiredRole: 'ADMIN'`.

Executed as a NOSUPERUSER BYPASSRLS role against the hosted-like shim; `test_021` re-run on a fresh
001–021 build to confirm no regression from 024 (024 edits no prior file). `lint:sql`, `check:grants`,
`check:rpc`, `typecheck`, `typecheck:strict`, `lint`, the full `npm test -- --run` (128 web test
files / 1223 tests, plus fixtures / agent-runtime / worker packages), `npm run build` and the
`VITE_API_MODE=supabase` build all pass.

### Rollback — `rollbacks/024_training_delivery_rollback.sql`

Purely additive migration, so the rollback is seven `DROP FUNCTION IF EXISTS`, verified absent
afterward. Re-applying 024 after the rollback on the same database is exercised as part of this
lane's proof and succeeds cleanly.
## Migration Detail — 030 (`030_me_profile_session_null.sql`)

**Status: AUTHORED + EXECUTED 2026-09-14 against a hosted-like PostgreSQL 17 shim, NOT APPLIED
to any hosted database at authoring time** (the coordinator applies after review). `CREATE OR
REPLACE` of `core.me_profile()` only — no table, no type, no policy, no other function touched.

### The defect, found by running 022's own pin against hosted

022's header states the contract in as many words: "`session` ... answers `null` AS A WHOLE when
it has nothing to report, not an object with every field null" — and 022's `v_has_session`
variable exists to keep that promise. But the guard only flips `v_has_session` to `false` inside
`EXCEPTION WHEN undefined_column`, the case where `auth.users.last_sign_in_at` does not exist as
a column at all. When the column EXISTS (true on hosted) but a particular row's VALUE is `NULL` —
true for `test_022`'s own fixture users, who are `INSERT`ed directly rather than signed in through
GoTrue, and equally true for any real hosted account GoTrue has not yet stamped a sign-in for —
the read succeeds with no exception, `v_has_session` stays at its default `true`, and the function
emits exactly the shape its own header forbids: a populated `session` object with
`lastSignInAt: null`.

`test_022`'s `T1j` (PR #48, commit `05e7360`) asserts the branch the column's PRESENCE implies,
and team-lead ran it directly against hosted: it FAILED, not because the assertion was wrong but
because the function did not keep its own promise. Reproduced locally against a copy of the
shim's `auth` schema with the column added and left at its column default (no row-level value
set): `core.me_profile()` returned
`"session": {"lastSignInAt": null, "browser": null, "place": null, "activeSessions": 0,
"twoFactorEnabled": false}` — not `"session": null`.

### The fix

One `IF` statement, immediately after the existing `BEGIN … EXCEPTION` block:

```sql
IF v_last_sign_in IS NULL THEN
  v_has_session := false;
END IF;
```

This subsumes the exception path (a harmless no-op re-confirmation there, since `v_last_sign_in`
is already at its declared `NULL` default whenever the exception fires) and closes the gap it did
not cover. Every other line of the function — permission gates, `moduleCount`, `activeSessions`,
`twoFactorEnabled` — is 022's, byte for byte. The two dashboard RPCs are not redefined here.

### What this does to a caller who has actually signed in

Nothing: GoTrue stamps `last_sign_in_at` on every real sign-in, so every authenticated caller
with a real session continues to get a populated `session` with a real `lastSignInAt` —
team-lead confirmed this directly against hosted before this migration was authored ("on hosted,
me_profile returns a REAL session (lastSignInAt, activeSessions 1, twoFactorEnabled false)"). This
migration only changes the answer for a principal GoTrue has not yet stamped a sign-in for, which
used to leak a null-valued required field and now correctly withholds the block.

### Already-merged consumers this migration makes true

`packages/contract/src/domain/shell.ts` and `apps/web/src/shared/components/layout/
SidebarProfile.tsx` (PRs #49/#50, merged on `origin/main` ahead of this migration) already
document and are built against `core.me_profile()`'s corrected shape — `session` optional and
nullable AS A WHOLE, `lastSignInAt` REQUIRED within a present one. This migration is what makes
the deployed function true of the contract and web reader the app already ships, not the reverse.

### Pin — `tests/test_030_me_profile_session_null.sql`

Three cases, branched STRUCTURALLY on whether `auth.users.last_sign_in_at` exists (via
`pg_catalog.pg_attribute`) rather than assuming one environment:
- **column absent** (this local shim): `session` is `null` as a whole — 022's original, correct
  behaviour for this case, unchanged by 030.
- **column present, value `NULL`** (the closed defect): `session` is `null` as a whole, not a
  populated object with a null `lastSignInAt` — the exact case `test_022`'s `T1j` caught failing
  on hosted.
- **column present, value set**: a full object with exactly the 5 `ProfileSession` keys
  (`activeSessions`, `browser`, `lastSignInAt`, `place`, `twoFactorEnabled`) and a real, non-null
  `lastSignInAt`.

FORBIDDEN (no membership) and anon (42501) paths are reasserted briefly so this pin does not
depend on `test_022` alone for that coverage. Verified against both the unmodified local shim
(only the absent-column case fires; the other two are marked `SKIP` with the reason) and a
locally-extended copy of the shim with `auth.users.last_sign_in_at` and `auth.mfa_factors` added
(not checked in — adding hosted-only GoTrue objects to the shared shim is not this pin's fixture
to make; both hosted-shaped cases fire and pass).

**`test_022`'s own fixture was amended in the same commit**, not left to accidentally exercise the
defect: its T1 principal now gets a real `last_sign_in_at` via a structurally-guarded `UPDATE`
(a no-op when the column is absent) BEFORE calling `me_profile`, so `test_022` exercises the
"populated session, real value" branch it always intended, and the never-signed-in / null-value
case is deliberately left to `test_030` alone rather than duplicated.

**Regression check:** `test_001`–`test_022` re-run against a clean 001–030 build (021 included;
023–029 excluded as sibling lanes not on this branch), unmodified, all still green — the same two
pre-existing special-purpose scripts (`test_014_rollback_restores_002_grants.sql`,
`test_017_applies_over_existing_quotations.sql`) fail standalone as they always have, unrelated to
030. `npm run lint:sql` 74/74, `npm run check:grants` clean, `npm run check:rpc` 0 broken.

### Rollback — `rollbacks/030_me_profile_session_null_rollback.sql`

Restores 022's `core.me_profile()` body EXACTLY — the null-value gate is removed, restoring the
defect this migration's header documents. Same signature, no data touched (a read). Round-tripped:
applied → rolled back (verified `app._body_sql` no longer contains the added `IF`) → re-applied
(verified it does again), `$verify$` green each time.

### ⚠ Carried risk and standing conditions

- **The column-absent case (this local shim) was never exercised against a real GoTrue schema.**
  Confirmed correct by construction (022's original behaviour, unchanged) and by hosted's own
  report of a populated `session` for a real user, but the "no column at all" branch itself has
  no hosted counterpart to test against — hosted always has the column.
- **No hosted access from this lane.** Everything above is measured against the local shim and a
  locally-extended, not-checked-in copy of it; `main` applies and re-runs `test_022`'s `T1j` and
  `test_030` against the real thing.

---

## Migration Detail — 022 (`022_profile_and_dashboard.sql`)

**Status: AUTHORED + EXECUTED 2026-09-14 against a hosted-like PostgreSQL 17 shim, NOT APPLIED
to any hosted database.** First executed as 001–020 + 022 while 021 was a sibling lane not yet on
this branch; re-executed as 001–021 + 022 (plus the hosted demo seed) after merging `origin/main`,
which had landed 021 in the meantime — see the merge note in the pin section below.

### What it does

| Object | Change | Why |
|---|---|---|
| `core.me_profile()` | new | `GET /v1/me/profile`, ruled R14. 018/020 both reported this NOT BUILT — "MeProfile requires location, jobTitle, department, staffNumber and a session block that no table carries." `location`/`jobTitle`/`department`/`staffNumber` stay `null` (no source); `session` is NOT a blanket null — `activeSessions`/`lastSignInAt`/`twoFactorEnabled` derive from `auth.sessions`/`auth.users.last_sign_in_at`/`auth.mfa_factors` per a second ruling, guarded to degrade to `null` where the hosted-only GoTrue object is absent (as on this shim). |
| `core.get_executive_dashboard(p_period text)` | new | `GET /v1/dashboards/executive?period=`. 020 reported this NOT BUILT — "nothing to compute them from." Four of the five contract metrics DO have a real source; the fifth (`ADMIN_HOURS_SAVED`) still does not and is not emitted. |
| `core.get_proposals_vs_won(p_months integer DEFAULT 6)` | new | `GET /v1/reports/proposals-vs-won?months=`. Same reasoning; `sent`/`won` are independent monthly counts over `core.proposals`. |
| `core.get_hours_saved()` | **not built** | `GET /v1/reports/hours-saved`. No baseline-minutes table exists anywhere in 001-020, and DECISIONS §4 calls the figure ILLUSTRATIVE in its own words — building this RPC would mean fabricating a number the product itself says is not measured yet. The web shows "not available." |

### Metric definitions (worked)

- **`session` (`ProfileSession`)** — answers `null` AS A WHOLE, never a populated object with a null required field, whenever `lastSignInAt` cannot be derived: the contract makes `session` optional-and-nullable at the top level but `lastSignInAt` itself REQUIRED inside it (`auth.users.last_sign_in_at` "is a stored column, not a derivation"), and the merged web reader (`SidebarProfile.tsx`) is gated on `details.session` before reading anything inside it. `lastSignInAt` = `auth.users.last_sign_in_at`, read defensively (a caught `undefined_column` means "nothing to report") since this migration has no hosted access to confirm the column exists — it is a standard GoTrue column on every real Supabase project. WHEN `session` is populated: `browser`/`place` are always `null` (no user-agent or geoip storage anywhere in this schema); `activeSessions` = `COUNT(auth.sessions)` for the caller, confirmed definer-readable; `twoFactorEnabled` = `EXISTS(auth.mfa_factors WHERE user_id = caller AND status = 'verified')`, guarded on `pg_catalog.to_regclass('auth.mfa_factors')` and `null` when the relation is absent — present on hosted Supabase, absent from this local shim, so the guard is the only way to prove the function does not hard-fail in either environment. Second ruling, prompted by `web-022`'s question about which `ProfileSession` fields are actually derivable, tightened once the contract itself landed with `lastSignInAt` required and `session` nullable as a whole.
- **`OPEN_PIPELINE`** — `SUM(core.opportunities.value_sen)` where `stage IN ('QUALIFYING','PROPOSAL_SENT','NEGOTIATION')`, matching the fixture's own drillTo filter exactly (not all five non-terminal stages — `NEW` and `TNA_SENT` are pre-qualification).
- **`AR_OVERDUE`** — `SUM(core.invoices.outstanding_sen)` where `status='OVERDUE' AND voided_at IS NULL`.
- **`PROPOSALS_SENT`** — `COUNT(core.proposals)` where the frozen `sent_at` falls in the calendar quarter containing `p_period`'s month. A proposal that later moved to VIEWED/ACCEPTED/LOST still counts — this is "how many went out," not "how many are still sitting at SENT."
- **`CLAIM_VALUE_AT_RISK`** — `SUM(core.hrdc_packets.claim_value_sen)` where `panel_state IN ('DEADLINE_AT_RISK','BLOCKED') AND voided_at IS NULL`. `DEADLINE_AT_RISK` is the DB spelling of the contract's `HrdcDeadlineStatus = 'AT_RISK'` — `packages/contract/src/enums.ts` documents the divergence and says not to unify it.
- **`approvalsPending`** — the 5 `PENDING` rows from `core.v_approval_requests` (011/020) in the same urgency order `core.list_approvals` groups by.
- **`agentActivity`** — one row per `core.agents` row with `status='ACTIVE'`. `actionsToday` = `COUNT(core.runs)` today (UTC calendar day — the contract defines no tenant-local "today"). `autonomy` = the MODE of `COALESCE(core.action_requests.granted_level, 'OBSERVE')` across today's runs (joined on `action_request_id`), defaulting `OBSERVE` for a run with no governed action. `costMonth` = `SUM(core.runs.cost_sen)` this UTC calendar month. `evalScore` = `percentile_cont(0.5)` over `core.evals.score` where `kind IN ('GOLDEN_SET','JURY_GATE')` — 013's own comment calls this "a rolling median" — `null` when the agent has no such eval, rounded to 3 decimals to remove a `0.8500000000000001` double-precision artifact found by running the pin.
- **`autonomyMix`** — the same per-run autonomy resolution, distributed over every run today tenant-wide; `[]` when nothing ran today.
- **`agentSpend`** — `spent`/`budget` = `SUM(core.budget_status.spend_sen)`/`SUM(cap_sen)` at `scope='AGENT'`. `core.budget_scope` has no `TENANT` value (`TIER | AGENT | ACTION_TYPE`); AGENT-scope is the axis that matches `agentActivity`'s granularity.
- **`get_proposals_vs_won`** series — for each of the trailing `p_months` calendar months, `sent` = proposals whose `sent_at` falls in that month, `won` = proposals `status='ACCEPTED'` whose `accepted_at` falls in that month. Independent monthly counts, not a cohort conversion rate — a proposal sent in month M and accepted in M+2 contributes to `sent` in M and `won` in M+2.
- **Deliberately not computed:** no `delta` on any cell (no table in 001-020 snapshots a prior period, and `delta` is optional on both contract types — fabricating a "vs last period" figure is exactly what the ruling forbids); `TenantIdentity.code` is `null` (`public.tenants` has no short-code column); `mobile` stays absent (already optional, no table carries one).

### Permission

Both dashboard RPCs gate on `dashboard:executive:read` — already seeded in 002 for `SALES_MANAGER`,
`FINANCE`, `MD`, `ADMIN` (narrower than the six-role `dashboard:read`, which gates the plain nav item)
and the closer match to `packages/contract/src/endpoints.ts`'s `roles: ['MD']` on all three
`/v1/dashboards/executive`, `/v1/reports/proposals-vs-won`, `/v1/reports/hours-saved` entries.
`core.me_profile` gates on membership only, matching `core.me()` (018) — the profile modal is the
caller's own record.

### The 7-point RPC contract check, worked

Worked in the forward file's header. In short: `app.ok`/`app.err`, no sibling top-level key, three
new RpcMap entries the contract's `endpoints.ts` already names, no existing call site (M01-S01 is
not wired to these RPCs on this branch — `web-022` is the consuming lane, so a dead RPC is expected
here rather than a finding), no TypeScript in this migration, all three are reads, nothing granted
to anon.

### Pin — `tests/test_022_profile_and_dashboard.sql`

50/50 assertions pass. T1: MD's `me_profile` carries exactly the 9 `MeProfile` keys (no `mobile`),
the 4 unstorable top-level fields are JSON `null`, `tenant.code` is `null`, `moduleCount` = 13 (MD
holds 13 of the 14 nav permissions `core.navigation()` filters on — it lacks the bare
`compliance:read`, only the three scoped `compliance:*` strings). `session` is `null` AS A WHOLE in
this shim specifically because it has no `last_sign_in_at` column on `auth.users` (a REQUIRED
`ProfileSession` field per the contract, so the whole block has nothing to report rather than a
half-populated object) — the full-object real-derivation path (`browser`/`place` null,
`activeSessions` a real count, `twoFactorEnabled` real where `auth.mfa_factors` exists) was verified
ad hoc against a locally-extended copy of the shim's `auth` schema, not checked into this pin. T2: an
AGENT principal is `FORBIDDEN`; anon is refused
42501. T3: MD's four dashboard metrics equal hand-computed sums/counts over seeded
opportunities/invoices/hrdc_packets/proposals; `approvalsPending` carries the one seeded `PENDING`
row; `agentActivity`/`autonomyMix`/`agentSpend` equal the seeded runs/evals/usage-rollup/budget
rows exactly (3 actions today, mode `ACT_WITH_APPROVAL` 2-of-3, 1000 sen this month, evalScore
median(0.9,0.8)=0.85, mix 0.667/0.333, spend 1000/100000). T4: OPS (`dashboard:read` only) is
`FORBIDDEN`, naming the missing permission; anon is refused 42501. T5: a malformed and a `NULL`
`period` are `VALIDATION_FAILED`. T6: tenant B's MD sees zero on every metric, an empty
approvals/agent list, zero agent spend — nothing of tenant A's leaks across the boundary. T7:
`get_proposals_vs_won` hand-verifies the current month (sent=2, won=1) and the month 4 months back
(sent=1), a 6-month series length, and `VALIDATION_FAILED` on `months=0`/`months=NULL`. T8:
`core.get_hours_saved` does not exist.

**The fixture had to walk `core.state_transitions`' registered edges rather than insert a target
status directly** — `opportunities.stage`, `proposals.status` and `invoices.status` are all gated
columns (011), and a direct `INSERT ... ('QUALIFYING', ...)` is refused as an illegal
`NULL -> QUALIFYING` transition. `QUALIFYING -> PROPOSAL_SENT` and `proposals.DRAFT -> SENT` are
additionally gated behind `PROPOSAL_SEND`, `invoices.NULL -> DRAFT` behind `INVOICE_CREATE`,
`DRAFT -> SENT` behind `INVOICE_PUSH` — each crossed with test_005's `pg_temp.gate()`/`ungate()`
fixture pattern (a real `action_request` published as `app.effect_applier`), not gone around.

**Regression check:** `test_001`-`test_020` re-run against a 001-020+022 build, unmodified,
all still green (no `FAIL` notice in any log; the naive `grep NOTICE.*FAIL` false-positives on
notice text like `VALIDATION_FAILED` were checked by hand). **Re-run again after merging
`origin/main`** (which had landed 021, PR #45's `lint:sql` fix, and the web PR in the meantime):
rebuilt clean as 001-021+022 (no demo seed), the full `test_00N` suite re-run unmodified — all
still green, including `test_021` (10/10) itself. `app.provision_tenant`'d `akademi-perdana` with
its three real MD users (the same shape `scratchpad/seed-hosted`'s provisioning scripts use),
loaded `supabase/seeds/hosted_demo_akademi_perdana.sql`, then ran the seed's own pin
`supabase/seeds/test_hosted_demo.sql` — T0 through T5, `ALL PASS`. Running the full `test_00N`
suite a SECOND time, now AFTER the demo seed is loaded into the same database, surfaces two
failures (`test_014` T7a2, an approvals-count collision; `test_019`, a duplicate tenant slug) —
both are the seed's persisted data colliding with a pin's own fresh fixture, not a regression;
neither pin is written to coexist with demo data in the same database, and both pass individually
and on the clean (no-seed) rebuild. `npm run lint:sql` 71/71 (PR #45 fixed the psql-meta-commands
gap that previously excluded `test_hosted_demo.sql`). `npm run check:grants` clean.
`npm run check:rpc` 4 pass/watch, 0 broken.

### Rollback — `rollbacks/022_profile_and_dashboard_rollback.sql`

022 created three new functions and replaced nothing, so the rollback is a straight `DROP FUNCTION`
of all three plus a verify that none remains — no prior body to reproduce, no data touched (all
three are reads). Round-tripped: applied → rolled back (confirmed all three `to_regprocedure` calls
return `NULL`) → re-applied clean, `$verify$` green each time.

### ⚠ Carried risk and standing conditions

- **`get_hours_saved` remains unbuilt** and `ADMIN_HOURS_SAVED` remains absent from the metrics
  array. Both need a measured baseline-minutes table this migration does not invent.
- **No `delta` on any metric.** A snapshot table (period-over-period sums for the four metrics) is
  a clean, scoped follow-up if the product wants trend arrows on M01-S01; this migration does not
  add one to fill an optional field.
- **`moduleCount`'s nav list is duplicated** from `core.navigation()` (018) rather than shared — a
  future edit to that function's 14-row `VALUES` list will not automatically update this count.
  Named rather than hidden; not closed here.
- **`session.lastSignInAt` and `session.twoFactorEnabled` were never proven against a real GoTrue
  schema, only against an ad hoc local extension of the shim's `auth.users`/`auth.mfa_factors`
  that is not checked in.** The guards (`undefined_column`, `to_regclass`) make the function fail
  soft rather than hard if the assumption about hosted's schema is wrong in some way this lane could
  not observe; they do not prove hosted's actual shape. First hosted apply should read the real
  values back and confirm.
- **G5 (the skill's dual adversarial review — thermonuclear + Codex trace) was not run by this
  lane.** The lane brief's own Proof section (lint:sql / check:grants / check:rpc / the pin,
  executed) did not ask for it. A Codex review was dispatched in parallel by the coordinator ahead
  of hosted apply instead.
- **No hosted access from this lane.** Everything above is measured against the local shim; `main`
  applies.

---

## Migration Detail — 021 (`021_golden_path_authz.sql`)

**Status: AUTHORED + EXECUTED 2026-09-14 against the hosted-like PostgreSQL 17 shim (every
migration and pin run as a NOSUPERUSER BYPASSRLS role), NOT APPLIED to any hosted database.**

### What it does

| § | Object | Change |
|---|---|---|
| 1 | 23 `core` RPCs | `app.has_permission('<002 permission>')` as the first statement. Reads refuse `app.err('FORBIDDEN', {requiredPermission})`, writes raise TRNOS `{code: FORBIDDEN, requiredPermission}` |
| 1b | `core.get_audit` (020) | maps what `aggregateTypeOf` in rpcClient.ts sends: `APPROVAL`→the approval branch (correlated trail), `ENQUIRIE`→`ENQUIRY`, `OPPORTUNITIE`→`OPPORTUNITY`; the approvals branch also requires `approval:read` (review-020 F2) |
| 1 | `core.badge_counts` | HRDC count requires `hrdc:read`, agent-failure count requires `run:read`, otherwise 0 |
| 2 | `app.action_types` | `OPPORTUNITY_STAGE_CHANGE`: `required_permission` `opportunity:stage`, payload requires `stage`, `fromStage` |
| 2 | `app.resolve_action_target_id`, `app.plan_effects`, `app.execute_in_database_action` | one `OPPORTUNITY_STAGE_CHANGE` arm each (011's bodies otherwise) |
| 2 | `app.check_opportunity_stage_move` | stale `fromStage` → `STAGE_MOVED` + `currentStage`; stage not in the tenant's OPPORTUNITY `pipeline_steps` → `UNKNOWN_STAGE`; `terminal` step without `reason` → `REQUIRED` |
| 2 | `OPP-01` + `trg_tenants_seed_opportunity_stage_policy` | `payload.stage in [WON, LOST]` → SALES_MANAGER, SLA 240 / MD at 360 / expiry 1440; seeded per new tenant, backfilled |
| 3 | `app.seed_pipelines` (019) | skips an object whose tenant already has a default under another id; steps only under an existing derived pipeline |
| 4 | `app.seeded_pipelines` | owner-only `FOR ALL` policy, then `FORCE ROW LEVEL SECURITY` |

Permission per RPC: `list_enquiries`/`get_enquiry` enquiry:read · `patch_enquiry_extraction`
enquiry:edit_extraction · `list_follow_ups`/`get_follow_up_draft` followup:read · `get_organisation`
organisation:read · `get_opportunity` opportunity:read · `get_contact` contact:read ·
`get_tna`/`get_tna_recommendations` tna:read · `create_proposal`/`add_proposal_section`/`put_proposal_section`
proposal:write · `regenerate_proposal_section` proposal:regenerate · `list_proposals`/`get_proposal`
proposal:read · `get_quotation` quotation:read · `put_quotation` quotation:write · `get_rate_card`
quotation:read (no 002 permission exists; flagged) · `get_policy` policy:read · `get_pipeline_config`
pipeline:read · `get_programme` programme:read · `get_compliance_rule` compliance:rule:read.

`$verify$`: V1 one definition and the 018 posture each. V2b `get_audit` maps `APPROVAL`. V2: every gated body has its gate before
any `FROM core.`/`FROM app.` read, checked for all 27 including 018's `list_quotations` and 020's
three. V3: every holder of a write permission holds the read its writer returns through, read from
`app.role_permissions`. V4: R18 is catalogued, permissioned and planned, every tenant has OPP-01,
and no overloads. V5: `seeded_pipelines` is forced with one policy.

### The 7-point RPC contract check, worked

In the forward header. The only new refusal shapes are ones 018 already returns. No new top-level
key, no signature change, no TypeScript. R18's caller is `apps/web/src/features/pipeline/api.ts`
through `perform_action`.

### Pin — `tests/test_021_golden_path_authz.sql`

T1: a CLIENT principal is FORBIDDEN on all 23, naming the permission, on the right channel, with
byte-identical answers for real, invented and malformed arguments. T2: an OPS/SALES/FINANCE matrix
of 18 cells, each against 002. T3: `badge_counts` answers SALES with an HRDC count of 0 and OPS with
≥1. T3b: `get_audit` called exactly as rpcClient.ts calls it: `APPROVAL` returns the approval's correlated trail (the same rows as `approvals`), FORBIDDEN for TRAINER (no `approval:read`), and `ENQUIRIE`/`OPPORTUNITIE` return their records' trails. T4: R18 end to end: a legal move EXECUTES; stale, unknown, reasonless, illegal-edge and
unpermitted moves are refused with their codes; WON/LOST queues under OPP-01 and the manager's
APPROVE moves the deal; a deal that moved while queued is refused at decide and again by the
executor itself. T4b: in a tenant with only MD users (akademi-perdana's shape), OPP-01 routes to the other MD, the requester is refused GOV-03, and the other MD approves. T5: `seed_pipelines`/`seed_pipelines_all` complete over a tenant's own default.
T6: `seeded_pipelines` is forced with an owner-only policy; a CLIENT at aal1 gets `AAL2_REQUIRED`
on a money-moving decision and at aal2 does not; the reveal audit guard raises SQLSTATE TRNOS with
`REVEAL_AUDIT_REQUIRED`/`_MISMATCH`. **Mutation-tested**, each red when its guard is reverted:
CLIENT removed from 011's AAL2 check (T6c), the reveal guard back to 42501 (T6e), the executor
re-check removed (T4k), one RPC gate removed (T1a), 020's `get_audit` restored (T3b), and 019's original `seed_pipelines` (T5a).

### ⚠ Prior pins amended

| Pin | Change | Why |
|---|---|---|
| `test_011` T1b/T1c | 22 → 23 action types and fixture-tenant policies | R18 adds one type and OPP-01 |
| `test_012` T1p | 22 → 23 action types | same; the 18/16 job-map counts are unchanged (R18 is in-database) |
| `test_018` T19g, T36s–w | T19g also accepts FORBIDDEN; T36's compliance-rule reads run as the MD | SALES lacks `compliance:rule:read` in 002 §11 |

With these, every pin passes on 001–021 (two situational pins still refuse by design at SETUP, as
on the baseline).

### Rollback — `rollbacks/021_golden_path_authz_rollback.sql`

It un-forces `seeded_pipelines` and drops its policy. It then **refuses** if any request, approval,
grant, draft, routing entry, jury config, baseline or eval references `OPPORTUNITY_STAGE_CHANGE`;
otherwise it drops the trigger and seed functions, deletes every OPP-01 row and the type, and
restores 011's three functions, 019's `seed_pipelines`, 020's `get_audit` and the 24 018 bodies in full, with their
grants. Measured: the catalog snapshot is identical to 001–020. With a pre-existing tenant, the
backfill wrote OPP-01 and the rollback removed it. With an `OPPORTUNITY_STAGE_CHANGE` request
present, the rollback refused and changed nothing.

### ⚠ Carried risk and standing conditions

- **Data scope (○) is not applied.** A SALES caller with `client_scope` MINE still reads every row
  through these definer RPCs, as before 021. Narrowing is a per-table owner-column decision.
- **An RPC gate is not a data boundary.** 014 §4's tenant-only SELECT grants on `core` tables stand.
- **OPP-01's condition names two stages in a data row.** A config-driven `context.terminalStage`
  would mean replacing 011's `perform_action`. The move check itself reads `terminal` from
  configuration.
- `regenerate_proposal_section` still refuses with `SERVER_ERROR` (018:4434), which is not a
  contract `ErrorCode`. It is unreachable while 018's routing row exists, and not changed here.
- The worker has no `AI_DRAFT_PROPOSAL_SECTION` handler (`apps/worker/src/handlers/index.ts`), so
  a regenerate enqueues a job nothing claims. Not SQL.

---

## Migration Detail — 020 (`020_api_read_surface.sql`)

**Status: AUTHORED + EXECUTED 2026-09-14 against a hosted-like PostgreSQL 17 shim, NOT APPLIED
to any hosted database.** The shim ran 001–020 as a `NOSUPERUSER CREATEROLE CREATEDB BYPASSRLS`
role standing in for hosted `postgres`, with Supabase's 27 default-ACL rows, and ran every pin as
that role.

### What it does

| Object | Change | Why |
|---|---|---|
| `core.list_approvals` | `'diffHash', a.diff_hash` in each row; `value.amount` filter; `approval:read` gate first | 014 refuses an APPROVE with no hash, and 018 never sent one |
| `core.get_approval` | `'diffHash', v_row.diff_hash`; `approval:read` gate before the lookup | same, for the detail screen's decide |
| `core.get_audit` | resource-segment map (`approvals`→`APPROVAL_REQUEST`, `proposals`→`PROPOSAL`, …); approvals return events correlated to their action request; `audit:read` gate | the client addresses `approvals::{ref}`, and `event_subjects.subject_type` is UPPER_SNAKE |
| `core.v_organisation_relations` | `app._money` inlined; `organisation_ref` appended; `organisation:read` predicate | 42501 for `authenticated` once any organisation was visible |
| `core.v_budgets` | reads `core.ai_budget_rows()`; money inlined | 42501 on every read |
| `core.v_model_tiers` | dropped and re-created: reads `core.ai_model_tier_rows()`, `allowedHours` as `[start,end)` windows, `spend` added, `activeFallback` | 42501 on every read, plus three contract shape drifts |
| `core.ai_budget_rows()`, `core.ai_model_tier_rows()` | new SECURITY DEFINER row sources that derive the tenant and require `ai:budget:read` / `ai:tier:read` | cross into `app.usage_rollup` without granting `app` |
| 14 new views | `v_templates`, `v_policies`, `v_saved_views`, `v_trainers`, `v_contacts`, `v_contact_channel_consents`, `v_programmes`, `v_programme_deliveries`, `v_hrdc_deadlines`, `v_collection_rules`, `v_compliance_rules`, `v_rule_change_sets`, `v_agent_evals`, `v_knowledge_sources` | named in `VIEW_READS`, PGRST205 before |

Every view is `security_invoker`, calls no `app` function except `app.has_permission` /
`app.my_team_user_ids`, and returns no rows to a caller without the 002 read permission.
`v_programmes` and `v_compliance_rules` reuse 018's `get_programme` / `get_compliance_rule`
projections rather than copying them. `v_saved_views.count` is the list RPC's own `page.total`
(NULL for `LEAD`, which has no list RPC).

Contract points a view cannot express exactly, stated: an optional key (`provenance`,
`degradation`, `pdpaFlag`, …) is a NULL column, not an absent key. `v_programme_deliveries.evaluation`
is `avg(overall_score) × 5`, on the 5-point scale of `programmes.average_evaluation` and the fixture.
That scale conversion is an inference, since 017 bounds `overall_score` to 0..1.

### The 7-point RPC contract check, worked

Worked in the forward file's header. In short: no envelope change, no new top-level key, the
signatures are unchanged, the call sites are `approvals/api.ts`, `tasks/api.ts`, `agents/api.ts`
and `proposals/api.ts`, no TypeScript is touched, all functions are reads, nothing is granted to
anon. `check:rpc` 0 broken, `check:grants` clean, `lint:sql` 62/62.

### Pin — `tests/test_020_api_read_surface.sql`

T1: a SALES `PROPOSAL_SEND` queues. The SALES_MANAGER's list row and detail carry `diffHash`
equal to the stored hash, and `value.amount` filters. T2: APPROVE with the uuid and the listed hash
succeeds and the proposal is SENT. A stale hash is refused `DIFF_CHANGED`, and no hash is refused
`VALIDATION_FAILED`. T3: CLIENT is FORBIDDEN on list, detail and audit, identically for real and
invented refs. T4: another tenant sees nothing. T5: `approvals::{ref}` returns the correlated
event, and `proposals::{ref}` and UPPER_SNAKE both answer. T6: anon gets 42501. T7: all 17 views
read as `authenticated` MD, with the exact contract column set per view and the repaired values.
T8: SALES is filtered out of the six views it lacks permission for. T9: no tenant-A value reaches
another tenant's MD. T10: anon gets 42501 on every view. Every probe runs as `authenticated` or
`anon` and is one statement. The pin fails red on 001–019 without 020 (T1c) and on 020's P1-only
revision (T7a: `permission denied for function _budget_rows`).

### Rollback — `rollbacks/020_api_read_surface_rollback.sql`

Drops the fourteen views, then drops and re-creates `v_organisation_relations` and
`v_model_tiers` from 018's text (a column added and a column type changed cannot be reversed by
CREATE OR REPLACE). Re-points `v_budgets` at `app._budget_rows()` before dropping the two row
sources. Re-creates the three 018 functions in full and restates 018's grants and comments, all
in one transaction. Measured: a catalog snapshot of functions, views, columns, ACLs, comments,
policies, triggers, constraints and seed-row counts is identical for 001–019 and for
001–019 + 020 + rollback.

### ⚠ Carried risk and standing conditions

- **No in-database emitter writes an event for an approval or a decision.** The drawer now finds
  what exists. For an approval that is nothing until a worker completion or another emitter writes
  an event correlated to the action request.
- **`me_profile` and the three dashboard RPCs are not built.** `MeProfile` requires fields no
  table carries, and `ExecutiveDashboard` / `HoursSavedReport` need metric definitions and
  hours-saved baselines that no migration seeds. Building either would mean inventing values.
- **An RPC permission gate is not a data boundary.** 014 §4 grants `authenticated` SELECT on every
  `core` table under a tenant-only policy. That posture is 014's and is not changed here.

Spine untouched: no action type, no handler, no branch in the envelope.

## Migration Detail — 019 (`019_pipeline_provisioning.sql`)

**Status: AUTHORED + EXECUTED 2026-09-13 against a PostgreSQL 17.11 shim, NOT APPLIED to any
hosted database.**
**Split out of 018 after the thermonuclear review's M4.** Everything here was inside
`018_golden_path_rpcs.sql`; nothing in it is new work, and the split is the fix.

### Why it is its own pack

A provisioning trigger plus a cross-tenant backfill is a repo-wide semantic change. Shipping it
as a subsection of a file whose stated subject is read and write RPCs put its irreversibility in
a footnote instead of under review, and the cost was measurable rather than theoretical: a
default `ENGAGEMENT` pipeline per tenant collides with `pipelines_one_default_uq` in four earlier
packs' fixtures. 016 had already named the owner and 018 took it anyway.

### What it does

- **§1** `app.seeded_pipelines` — the ledger. `row_kind`, `tenant_id`, `row_id`, keyed
  `(row_kind, row_id)`. RLS enabled, **not forced**, no client grant: `app` is not exposed and
  the guard is the grant layer, while FORCE would remove the owner's exemption and a definer
  whose owner lacks `BYPASSRLS` would silently record nothing. 012 measured that same mechanism
  on `app.job_type_map`.
- **§1** `app.seed_pipelines(uuid)` — two pipelines, sixteen steps, every stage name carrying its
  citation, ids derived as `md5(tenant || 'pipeline:' || object[ || ':' || step_key])`, and each
  inserted row recorded in the ledger by a data-modifying CTE so `RETURNING` yields only what was
  actually written.
- **§1** `app.unseed_pipelines()` — the reversal. See below.
- **§1** `app.seed_pipelines_all()` — the backfill loop, a FUNCTION rather than an inline `DO`
  block precisely so the pin can call it.
- **§1** `app.seed_pipelines_on_tenant()` + `trg_tenants_z_seed_pipelines` on `public.tenants`.
- **§1** Two rows in `app.tenant_seed_checks`, guarded on that registry's existence.
- **§2** `$verify$` — trigger present and correctly ordered, every tenant carrying a lifecycle,
  ledger consistent, four definer functions unreachable from a client role, and the readers still
  rendering from rows.

### Reversibility, which is the subject of this pack

The first version of this seed kept the rows on rollback. Afterwards the mechanism was gone, so
there was **no supported way to undo the seed at all**, and `pipelines_one_default_uq` went on
rejecting a default `ENGAGEMENT` pipeline for every tenant permanently. A rollback that leaves a
repo-wide constraint change in place is not a rollback.

`app.unseed_pipelines()` deletes exactly the rows the seed recorded inserting, **steps before
pipelines** (`pipeline_steps_pipeline_fk` is `ON DELETE CASCADE`, so the other order would take a
tenant's own steps with it), and refuses with the **count and the blocking constraint names**
when live data references any of them — deleting nothing when it refuses. It also refuses a
seeded pipeline carrying a step 019 did not seed.

Measured end to end:

```
tenant inserted   pipelines/steps 2/16, ledger 18 rows
rollback          "019 rollback: 18 seeded pipeline/step row(s) removed"
after             pipelines/steps 0/0, ledger and mechanism gone
and               INSERT of a default ENGAGEMENT pipeline -> INSERT 0 1
re-apply          backfill re-seeds the surviving tenant, verify green
```

⚠ **R1 replaces a check that watched the wrong object.** Its predecessor, R4 in 018's rollback,
queried `pg_trigger` for **016's** `trg_tenants_seed_ref_formats` and never read a pipeline table
at all, while two comments and a closing `RAISE NOTICE` both announced that it verified pipeline
rows. R1 re-derives 019's ids and counts surviving rows in both tables — re-deriving rather than
reading the ledger, because that asks the question from outside the bookkeeping meant to answer
it.

### Pin — `tests/test_019_pipeline_provisioning.sql`

T1 a tenant insert provisions a lifecycle; T2 the backfill raises and names every tenant it could
not seed; T3 the seed is reversible, exactly. Self-contained fixtures — its own tenant,
organisation, programme and engagement — so it does not depend on another pack's fixture
surviving a reordering. Ends in `ROLLBACK`.

### ⚠ The fixture amendments this pack forces

A default `ENGAGEMENT` pipeline per tenant is a repo-wide fact, so every pin that inserted its own
default one now hits `pipelines_one_default_uq`. Two are amended in this pack's commit and two are
owed:

- **`test_008`** — `is_default` on its `'Standard delivery'` pipeline flipped `true` → `false`.
  The pin does not assert `is_default` and only needs a pipeline to hang an engagement off.
- **`test_009`** — the same flip, plus `AND pl.name = 'std'` on an `INSERT … SELECT` that was an
  **unconstrained cross join** over `core.pipelines`. With three pipelines it wrote three
  engagements and `RETURNING … INTO` kept an arbitrary one. That cross join is a pre-existing
  defect 019 merely made reachable, and is worth its own ticket against 009.
- ⚠ **`test_017` on `cloud/migrations`, OWED.** Same edit as 008: line 87,
  `'ENGAGEMENT','Standard delivery', true,'ACTIVE'` → `false`. Its newer version is not on this
  branch.
- ⚠ **`test_016` on `cloud/migrations`, OWED, and it is not the same edit.** T7b computes its
  delete set as ref_formats with **no `core.ref_sequences` row**. 019's seed inserts a pipeline,
  `trg_pipelines_ref` calls `core.assign_ref('PIP')`, and that allocates a `PIP` sequence — so
  `PIP` drops out of the set and 32 becomes 31. The mechanism is recorded here rather than a fix
  guessed at: whether `v_matched` should drop the `NOT EXISTS (ref_sequences)` clause or
  `v_seeded` should be computed the same way is 016's author's call.

### Deliberately NOT built

- **No enum value, no table in `core`.** `core.pipelines` and `core.pipeline_steps` are 004's.
- **No stage list on the read side.** 019 writes the rows; `core.navigation` and
  `core.get_pipeline_config` still render from them, and V5 asserts it here as well as in 018
  because this is the pack that could tempt someone to hardcode the list to "match the seed".

### ⚠ Carried risk

- **Deploy order: after 016, always.** The trigger name carries the dependency and V1b asserts
  it.
- **018's behaviour depends on this pack**, so `test_018` is run against 001–019.
- **A tenant that has edited its seeded stages loses those edits to a rollback**, because the
  ledger records the row and the rollback deletes it. The refusal path only covers rows something
  else *references*, not rows somebody *renamed*. Stated rather than discovered.

## Migration Detail — 018 (`018_golden_path_rpcs.sql`)

**Status: AUTHORED + EXECUTED 2026-09-13 against a PostgreSQL 17.11 shim with 001–018 applied,
NOT APPLIED to any hosted database.**
**⚠ Thermonuclear review 2026-09-13 returned BLOCK (`docs/reviews/2026-09-13-thermo-018.md`,
5 blockers / 5 high / 8 medium / 6 low, against `fc9550c`). All five blockers are fixed and
each carries a pin proven to fail against the pre-fix SQL; the HIGH/MEDIUM/LOW disposition is
below and in PR #11's body.**

### What it does

- **§1** Fourteen internal `app._*` helpers: projection (`_money`, `_actor`, `_provenance`,
  `_provenanced`), paging (`_cursor_encode`, `_cursor_decode`, `_page_size`), filtering
  (`_predicate`), saved views (`_view_filters`), the keyset engine (`_keyset_scope`,
  `_next_cursor`), introspection (`_body_sql`) and the two view bodies (`_budget_rows`,
  `_model_tier_rows`). All `SECURITY INVOKER`, all `REVOKE ALL FROM PUBLIC, anon, authenticated`.
- **§2** The three 011 gate wrappers are asserted, NOT redefined: 014 owns them.
- **§3–§10** 30 RPCs in `core` — identity and shell (`me`, `navigation`, `badge_counts`),
  sales (`list_enquiries`, `get_enquiry`, `patch_enquiry_extraction`, `list_follow_ups`,
  `get_follow_up_draft`, `get_organisation`, `get_opportunity`, `get_contact`, `get_tna`,
  `get_tna_recommendations`), money (`create_proposal`, `list_proposals`, `get_proposal`,
  `add_proposal_section`, `put_proposal_section`, `regenerate_proposal_section`,
  `list_quotations`, `get_quotation`, `put_quotation`, `get_rate_card`), approvals
  (`list_approvals`, `get_approval`, `get_audit`) and configuration (`get_policy`,
  `get_pipeline_config`, `get_programme`, `get_compliance_rule`).
- **§9b** `core.v_organisation_relations`, `security_invoker = true`.
- **§10c** `core.v_budgets` and `core.v_model_tiers` — 014's carried defect, taken with a
  different shape than 014 prescribed and the reason measured rather than preferred: 014
  proposed an RPC, but `RPC_NAMES` in `rpcClient.ts` contains no name for either on any
  branch and the client reads both through `VIEW_READS`, so an RPC would have been a function
  with zero call sites while the screen stayed broken. A view wearing the name the client
  already asks for, whose body goes through a `SECURITY DEFINER` function, is 014's mechanism
  with the caller's own spelling.
- **§10d** One global `app.event_subscriptions` row routing
  `PROPOSAL_SECTION_REGENERATE_REQUESTED` → `AI_DRAFT_PROPOSAL_SECTION`.
- **§10e MOVED TO 019.** The ledger, the four seed functions, the trigger, the
  backfill and the registry rows are all `019_pipeline_provisioning.sql` now.
  018 creates no table.
- **§10f** `regenerate_proposal_section` reaches the worker through **012's
  event path, not 011's envelope**, and the choice is measured rather than
  preferred. `app.perform_action` gates on `app.action_types` and plans effects
  through `app.plan_effects`; there is no action type for regenerating a
  proposal section, and 018 may not add one to 011's global catalogue or teach
  011's planner a branch — so `perform_action` would refuse and
  `enqueue_effect_jobs` would enqueue zero. `app.emit_event` writes the event,
  its subject rows and one job per enabled subscription in the caller's
  transaction and carries `p_run_id`, which is what `app.outbox.run_id` and
  `outbox_run_idx` exist for. Routing is data (012's own words on
  `app.event_subscriptions`), so §10d's single global row is an INSERT rather
  than an edit to 012, and the RPC refuses `REGENERATE_NOT_ROUTED` rather than
  returning 200 with nothing queued. Ruling R-B is satisfied: no model call and
  no `pg_net` in the request.
- **§11** Grants. `authenticated` gets EXECUTE on the 30 and SELECT on the three views.
  Deliberately NOT granted: `app.perform_action`, `app.decide_approval`, `app.bulk_decide`,
  `app.ok`, `app.err`, `app.require_tenant_id`, `app.current_actor`, and
  `core.v_approval_requests` (011:1428 — it carries every approval's diff and evidence
  regardless of approver role).
- **§12** `$verify$` — existence, overload count, posture off `proconfig`, grants off
  `has_function_privilege`, and the doc 09 pins as executed assertions.
- **Spine untouched.** The envelope is reached only through `core.perform_action`, a
  one-expression wrapper over `app.perform_action`. No branch is bolted into the gate.

### The 7-point RPC contract check, worked

1. **Envelope.** Success `{success,data}` from `app.ok`; failure `{success,error}` from
   `app.err`, or a `TRNOS` detail bag `classifyTransportFailure()` parses. Zero hand-built
   envelopes — `test_018` T20d asserts that off the stored bodies, not off the DDL text.
2. **Unwrap.** `data` is the sole non-`success` key. `list_approvals`'s `groups` and
   `summary` sit INSIDE `data`. One level up would flip every caller in the app from
   auto-unwrap to pass-through at once — the 037 mechanism.
3. **`RpcMap`.** 30 names and every `p_*` spelling match `RPC_NAMES`; ⚠ taken on the file's
   word, see "could not verify".
4. **Call sites.** Every RPC has at least one; `v_budgets`/`v_model_tiers` are read as views
   because that is what the client actually does.
5. **`as unknown as` casts.** None introduced by this pack.
6. **Reload / restore paths.** The list envelopes are shape-stable across pages: `page.next`
   is PRESENT AND NULL on the last page rather than absent, because an omitted key changes
   the key set and the unwrap rule is sensitive to it.
7. **Error-boundary coverage.** No new unbounded throw point on a public route.

`npm run check:rpc` 0 BROKEN · `npm run check:grants` clean · `npm run lint:sql` clean.

### Pin — `tests/test_018_golden_path_rpcs.sql`

T0–T36. Executed against the shim, its output read, before commit; ends in `ROLLBACK` and
writes nothing durable. Every envelope goes through `pg_temp.data(label, envelope)`, which
raises if the RPC refused — `-> 'data'` on a refusal is NULL, and `IF NULL` takes the FALSE
branch, so an unchecked extraction makes every assertion below it report pass. T31–T36 are
the review-fix pins: the keyset engine, `p_view`, the regenerate enqueue, provenance tenancy,
the backfill's refusal, and `get_proposal`/`get_quotation`, which the file had never invoked.

⚠ **It does not prove behaviour under 014's RLS policies from a client role**, and T0
measures that and says so out loud rather than leaving it implied.

### Rollback — `rollbacks/018_golden_path_rpcs_rollback.sql`

Inventory-complete: every object 018 creates is dropped, signature-qualified, in exact reverse
dependency order, with no `CASCADE`. The views go before the helpers their bodies call. The one
drop of a non-018 object — `core.decide_approval(uuid,text,text,text)` — is signature-qualified
and cannot touch 014's five-argument function. 018's single routing row is deleted by its exact
`(event_type, job_type)` pair, so a later pack's own handler for the same event survives.

**018 writes durable rows and the rollback REVERSES them.** An earlier version dropped the
mechanism and kept the rows, reasoning that a tenant's pipeline configuration is theirs by the
time anyone rolls back and that `core.engagement_step_states` carries composite foreign keys
onto them. Both halves were true; the outcome was not. After that rollback the mechanism was
gone, so there was **no supported way to undo the seed at all**, and `pipelines_one_default_uq`
went on rejecting a default `ENGAGEMENT` pipeline for every tenant permanently — a rollback that
leaves a repo-wide constraint change in place is not a rollback.

`app.unseed_pipelines()` now deletes exactly the rows `app.seed_pipelines` recorded having
inserted. A row that already existed under the same derived id — the seeds lane's fixtures — was
never recorded and is never touched, which is the case the keep-everything design was protecting,
now protected by construction. When live data references a seeded row it **refuses with the count
and the blocking constraint names and deletes nothing**, which aborts the whole file. It also
refuses to delete a seeded pipeline that carries a step 018 did not seed, because
`pipeline_steps_pipeline_fk` is `ON DELETE CASCADE` and that step would go with it.

⚠ **R4 used to check the wrong object.** Its body queried `pg_trigger` for 016's
`trg_tenants_seed_ref_formats` — a ref-format trigger with no relationship to the pipeline seed
— while two comments and the closing `RAISE NOTICE` all announced a pipeline-row check that was
never written. R4 now re-derives 018's ids and counts the surviving rows, asserts the ledger
table is gone, and keeps the 016-trigger check as the separate assertion it always was.

### Deliberately NOT built

- **`core.me_profile()`**, which doc 09 names. Eleven `MeProfile` fields have no source in
  001–017; a stub returning nulls is worse than an absent endpoint.
- **A second money projection.** `put_quotation` writes lines and reads back 007's GENERATED
  columns. No money is computed in the RPC layer.
- **A model call.** Ruling R-A puts every LLM call behind the worker and R-B forbids `pg_net`;
  `$verify$` V9c sweeps the whole pack for `net.http_%`.

### ⚠ Carried risk and standing conditions

- **Deploy order: 014 BEFORE 018.** 018's grants are idempotent and the later one wins with
  the same result, but the merge has to check the ordering.
- **test_014 is red between 014 and 018.** 018 adds three view grants and moves test_014's
  exact count 121 → 124. Applying 001–014 alone and running `test_014` fails with
  `expected 124 … Found 121`. Recorded here rather than softened to `>= 121`, because the
  exactness is the property that catches an unintended grant; the window is real and named.
- ⚠ **OWED TO THE §17 PACK: `core.provenance_subjects` has no `approval_requests` row.**
  That table is a nine-row allowlist and `core.provenance.subject_table` is FK'd to it, so
  `core.get_approval`'s §17 `modelAgreement` badge can match no row on any database as shipped —
  the jury badge is unreachable, not merely unpinned. 018 fixed the query (tenant-correlated and
  ordered) and `test_018` T34 adds the allowlist row as a fixture and raises a NOTICE if it ever
  becomes real, so the day the seed lands this is visible rather than silently already-passing.
  Seeding the row belongs to the pack that owns §17.
- ⚠ **OWED: the pipeline seed belongs in a provisioning migration of its own** (M4). See the
  Migration Order row for the measured cost — four earlier packs' pins — and the reason it
  landed here.
- ⚠ **OWED WHERE 016's REGISTRY IS ABSENT:** on a base without `app.tenant_seed_checks`, 018
  raises a NOTICE and does not register its seed, so `app.provision_tenant` would return a
  tenant with no lifecycle and call it provisioned. `test_018` T39 asserts the registration
  where the registry exists and records the obligation where it does not.
- **The `core` schema is not exposed on the hosted project** (doc 09 §0a), so none of these
  RPCs is reachable from PostgREST until it is.
- **False green under RLS.** Whether these definers return rows on a hosted project depends
  on the definer owner carrying `BYPASSRLS`. T0b notices and reports it; both of its branches
  pass, deliberately, because it is a measurement and not an assertion.

## Migration Detail — 017 (`017_baseline_amendment.sql`)

**Status: AUTHORED + EXECUTED 2026-09-13, NOT APPLIED to any hosted database.**
**⚠ Codex (gpt-5.6-sol xhigh) review PENDING — and this is the pack that most needs it.** 017
changes columns 005–013 already created, including two type changes and eight added columns on
live-shaped tables. Sources are cited per section in the file itself rather than listed here,
because a regulatory number without a citation at the line that uses it is a number nobody can
re-check; the six 2026-09-13 research documents are the origin of every one.

### What it does

- **§1** Nine `REVOKE ALL … FROM PUBLIC, anon, authenticated`, `core.apply_rule_offset` first.
- **§2** Seven `jsonb_typeof` CHECKs, guarded and `NOT VALID` + `VALIDATE`.
- **§3** `quotations.margin_rate` → `numeric(6,4)`, `evaluation_responses.overall_score` →
  `numeric(4,3)` with its 0..1 bound. **§3b** the composite unique 014 deferred.
- **§4** `core.tax_policies` + `app.resolve_tax_policy` + two seeded national policies +
  `core.v_tax_policy_unverified`.
- **§5** Quotation SST, mirroring 010's vocabulary; `invoices.sst_policy_id`.
- **§6** `contact_consents.purpose` + `notice_version`.
- **§7** `core.data_retention_policies`, `core.data_breach_register`.
- **§8** Three HRD Corp rules, and the check keys through a provisioning trigger.
- **§9** `trainers.hrd_tdf_valid_to` + `core.v_trainer_accreditation`.
- **§10** `core.retrieve_knowledge` with `SET LOCAL hnsw.iterative_scan = relaxed_order`.
- **§11** 014's policy posture applied to the three new tables by CALLING
  `app.apply_tenant_policies`, not by hand.
- **Spine untouched.**

### The 7-point RPC contract check, worked

1. **Envelope** — `core.retrieve_knowledge` is the one client-callable function and it returns
   a TABLE rather than an `app.ok` envelope. Stated rather than glossed: it is a retrieval
   primitive consumed by the agent runtime, not one of doc 09's 24 RPCs, and doc 09 §0's
   envelope rule governs those. If 018 exposes retrieval to the browser it wraps this, the way
   014's three wrappers wrap 011.
2. **Unwrap** — not applicable; no envelope.
3. **RpcMap** — the contract has no retrieval entry. 017 adds no shape it carries.
4. **Call sites** — `packages/agent-runtime`, when it is wired. `app.resolve_tax_policy` is
   called by the money path and has no client grant.
5. **Casts** — `p_embedding` is `extensions.vector`; the operator is spelled
   `OPERATOR(extensions.<=>)` because `search_path` is empty and an unqualified operator would
   not resolve.
6. **Reload/restore** — `NOTIFY pgrst, 'reload schema'` closes the file.
7. **Public routes** — none. `anon` receives nothing; the retrieval RPC is `authenticated` only.

### Pin — `tests/test_017_baseline_amendment.sql`

Ten checks, 39 assertions, all executed, all PASS against the full applied set 001–017. The ones
that earn their place: **T1b**, which proves `apply_rule_offset` is refused by IMPERSONATION and
not by reading `has_function_privilege`, because it is the only one of the nine a client could
really call. **T3b**, which proves the precision change by STORING 0.867 and reading it back —
a catalogue check passes against a column that was never converted. **T4g**, which sets the
override's `registry_from` an hour ahead so the known axis can be exercised at all: `now()` is
`transaction_timestamp()`, so every row the pin inserts shares one identical lower bound and the
obvious version of this test passes vacuously — the same trap test_013 records. **T5c**, which
reads the constraint DEFINITION rather than inserting a row, because a `core.quotations` insert
fails on `rate_card_id` long before it reaches the SST rule and a probe refused for the wrong
reason tests nothing. **T7b**, which proves the statutory clock cannot be edited. **T8b**, which
asserts each offset WITH its unit. **T10**, described above.

### Rollback — `rollbacks/017_baseline_amendment_rollback.sql`

Round-tripped, plus a clean full-set reverse round trip (`before=0 after=0`). The hardest
rollback in the pack, and it states two places where "restore the prior state" is genuinely
lossy instead of rounding quietly. **The precisions**: backward is NARROWING, so the rollback
REFUSES if any row would lose a decimal — a rollback that changes a stored eval score, or a
margin that decides whether a quotation needed an approval, is data loss dressed as a restore.
**The nine PUBLIC grants**: they are RESTORED, with a NOTICE saying exactly what has been
re-opened, because a rollback that keeps the improvements it happens to agree with makes "we
rolled back" false and gives the next applier a different result from the first. Deletes are by
`policy_code` / `rule_code` / `check_key`, never by range, so a row added beside them survives;
the check-key trigger comes down before the rows it would otherwise re-seed. Asserts that 010's
own invoice SST columns and 014's policy count survive.

### Deliberately NOT built

Key-presence assertions on the seven jsonb columns (no consumer declares any). A retention
window on `data_breach_register` (the research flags 2 years UNCONFIRMED). Any rule at `ACTIVE`
(needs a named Finance verifier). The routing host allow-list, `zero_retention_enabled`,
`dpa_on_file`, `pii_class` and `redaction_map_ref` — all four are 013-table changes the research
routes to the AI-ops surface, and each needs the runtime's agreement on the vocabulary before a
column freezes it; none is a compliance deadline and none blocks 018.

### ⚠ Carried risk and standing conditions

- **Every tax policy and every HRD Corp rule is `PROPOSED`.** `core.v_tax_policy_unverified` is
  non-empty by design and is a standing action item on a live database: those rates will bill a
  customer without anyone having signed them off. **Owner: a named Finance verifier.**
- **The 6-month claim window is unconfirmed against primary text.** The circular PDF was
  unreachable on 2026-09-13.
- **`core.retrieve_knowledge` is VOLATILE**, which it does not deserve, because `SET LOCAL` is
  refused in a non-volatile function. The planner will not fold repeated calls in one query.
- **Four AI-ops columns the research routed here are not built** (see above).
- **The pack is unreviewed**, and it is the one that changes existing columns.

---

## Migration Detail — 016 (`016_seed_and_tenant_provisioning.sql`)

**Status: AUTHORED + EXECUTED 2026-09-13, NOT APPLIED to any hosted database.**
**⚠ Codex (gpt-5.6-sol xhigh) review PENDING.** Sources: 004 (`app.finalise_table`,
`core.ref_formats`, `core.next_ref`, `core.assign_ref`); 011
(`app.seed_action_policies_on_tenant`, the trigger shape this mirrors); 013's catalog entry and
test_013's header, both of which name 016 as the owner of this gap;
`docs/research/2026-09-13-hrdcorp-compliance-refresh.md` §c (the registry rows 016 deliberately
does not seed).

### What it does

- **`app.seed_ref_formats(tenant)`** — one row per `core.assign_ref` trigger, derived from
  `pg_trigger`. Returns the number of rows added. Idempotent, leaving existing rows alone.
- **`app.seed_ref_formats_on_tenant()` + `trg_tenants_seed_ref_formats`** — `AFTER INSERT ON
  public.tenants`, the same shape as 011's policy seed.
- **`app.provision_tenant(slug, name, timezone, id)`** — the explicit path, over the same
  mechanism, with a post-condition that refuses a half-provisioned tenant.

### ⚠ Amended 2026-09-13: `p_id`, at a consumer's request

The seeds lane (PR #16) reported that it could not use this function at all. Its fixture world is
keyed on fixed, memorable tenant ids — `supabase/seeds/README.md` requires them and the RPC tests
and screenshots quote them literally — so roughly 5,000 seeded rows carry `tenant_id` as a
constant, and a generated id cannot be retrofitted: `core.ref_formats`, `core.action_policies` and
`core.check_keys` are already referencing the tenant by the time the function returns, and **none
of those foreign keys is `ON UPDATE CASCADE`**. The lane's fallback was to insert the tenant row
directly and re-implement half of provisioning inline, which would have rotted the day 018
provisions a fourth table — the exact drift this migration exists to prevent.

`p_id uuid DEFAULT NULL` with `COALESCE(p_id, gen_random_uuid())`. Every pre-amendment caller is
byte-identical, and the parameter is independently right for a restore or a tenant migration,
where the id is given rather than chosen. This follows the same rule that settled
`bulk_decide_approvals` in 014: **the signature follows the consumer.**

⚠ **The `DROP FUNCTION` in front of it is mandatory, and that was measured rather than assumed.**
A bare `CREATE OR REPLACE` does not replace a function when the parameter LIST changes — it
creates an OVERLOAD beside it. Both would then carry defaults covering a two- and three-argument
call, and every existing caller, including this pack's own T3, would fail with
`function app.provision_tenant(unknown, unknown) is not unique`. Reproduced on the shim before the
line was written.

T3 gained four assertions: the returned id AND the stored row carry the supplied value (a function
that inserted one id and returned another would be worse than one that ignored the parameter);
supplying an id does **not** bypass provisioning, which is the entire reason a seed calls this
rather than inserting the row; explicit `NULL` still generates; and a duplicate id is refused by
the primary key rather than silently attaching a new customer to another customer's rows.
- **A backfill loop** for tenants that already exist, since a trigger only fires on rows
  inserted after it.
- **Spine untouched.**

### The one thing it cannot derive, stated

`dated` and `width`. A trigger declares its prefix and nothing else. `width` takes
`core.ref_formats`' own default of 4 throughout. `dated` is an explicit eighteen-prefix list in
§1 — `ENQ OPP PRO QUO ENG INV CRN PAY HPK ACT APV DRF RUN MSG COL FUP SES TBK` — because
`ENQ-2026-0912` versus `ENQ-0912` is a visible difference on every screen and a silent one in
the catalogue. T5 asserts both shapes against a real allocation rather than against the table.

### The 7-point RPC contract check, worked

**016 exposes no RPC**, and that is stated rather than skipped. All three functions are
`REVOKE ALL … FROM PUBLIC, anon, authenticated`: provisioning is an operator act, not something
a browser initiates. (1) No envelope — `seed_ref_formats` returns `integer` and
`provision_tenant` returns `uuid`, both to an operator or a trigger. (2)–(5) No client surface,
no contract entry, no call site in `apps/web`, no casts. (6) The trigger is catalogue state and
survives a reload. (7) No public route.

### Pin — `tests/test_016_seed_and_tenant_provisioning.sql`

Six checks, 15 assertions, all executed, all PASS against the full applied set 001–016. The ones
that earn their place: **T1b**, which asserts the five prefixes a hand-built list misses
individually by name rather than asserting a count of 32 — a count passes just as happily with
the wrong five. **T2**, which contains no `core.ref_formats` fixture at all, because the absence
IS the assertion. **T3d**, which disables the seeding trigger and requires `provision_tenant` to
raise, since the scenario being guarded against is a later migration dropping a trigger it did
not know mattered. **T4b**, which asserts a deliberately corrupted format was **not** repaired by
re-seeding — the only test in the pack that asserts something was left broken, and the reason is
that the repair direction is the destructive one. **T6**, which re-proves 004's per-tenant
numbering property through the real provisioning path: a seed that accidentally made counters
global would let every customer read every other customer's record volume off a ref, and no
access-control test would catch it because no row is exposed.

### Rollback — `rollbacks/016_seed_and_tenant_provisioning_rollback.sql`

Round-tripped twice, plus a clean full-set reverse round trip (`before=0 after=0`). **This is
the only rollback in the pack that deletes business-shaped data**, and it argues the case rather
than assuming it: a `ref_formats` row is a FORMAT, not an allocation; the allocations live in
`core.ref_sequences`, which 016 never touches and the rollback never deletes, so re-applying 016
hands every prefix back its existing counter and **no ref is ever reissued** — T4c is what makes
that claim checkable. ⚠ **The exception is enforced**: a format the tenant has already allocated
against is NOT deleted, because that would leave a live counter with no format describing it and
the next `next_ref` would raise on a prefix the customer is visibly already using. Asserts that
011's seed trigger survives.

### Deliberately NOT built

`pipelines` and `pipeline_steps` — fifteen stage names in a migration is the defect both
CLAUDE.md files name, and this is a file about ref formats. **Owner: 018 or a dedicated seed
pack.** The HRD Corp rule registry — national rows, not provisioning, and the research attaches
a hard condition (`status = 'PROPOSED'` until a named Finance verifier confirms each against the
circular text); 017 owns them. Rate cards and templates — a tenant's first rate card is an
onboarding conversation.

### ⚠ Carried risk and standing conditions

- **A newly provisioned tenant renders no pipeline.** `pipeline_steps` is empty, and every
  screen that renders stages from configuration has nothing to render. **Owner: 018.**
- **`dated` and `width` are the only hand-maintained values in the pack**, and nothing derives
  them. A new dated prefix added in 017 or 018 must be added to §1's array by hand or it
  allocates undated refs silently.
- **The backfill is one-shot.** It runs at apply time over the tenants that exist then. A tenant
  inserted while 016 is only half-applied is not covered by either half.

---

## Migration Detail — 015 (`015_realtime_and_cron_schedules.sql`)

**Status: AUTHORED + EXECUTED 2026-09-13, NOT APPLIED to any hosted database.**
**⚠ Codex (gpt-5.6-sol xhigh) review PENDING.** Sources: rulings R-A and R-B
(`ai/briefs/2026-09-13-api-phase-plan.md`); `docs/research/2026-09-13-supabase-current-docs.md`
§4 (pg_cron sub-minute schedules, `job_run_details` growth, pg_net limits) and §7 (Realtime RLS
and connection-lifetime policy caching); 001's header (ruling R-EXT, "scheduled with
cron.schedule in 015"); 012's `app.reap_jobs`, `app.reap_cron_history` and finding `H-16`.

### What it does

- **`app.reap_jobs_all_tenants(p_limit_per_tenant)`** — the cron entry point, and the only new
  object. Calls `app.reap_jobs` once per tenant that has `CLAIMED` or `FAILED` work.
- **`trainos_reap_jobs`**, every 30 seconds, native sub-minute, one job.
- **`trainos_reap_cron_history`**, daily at 03:17 UTC, calling 012's sweep at its 7-day window.
- **Spine untouched.**

### Why the fanout exists, in full

`app.reap_jobs(p_tenant_id, p_limit)` already treats `NULL` as "every tenant", so
`SELECT app.reap_jobs(NULL, 1000)` is the obvious schedule and is not the one used. 012's `H-16`
gave the CLAIM per-tenant fairness through `row_number() OVER (PARTITION BY tenant_id)`, proved
by flooding fifty jobs from one tenant and watching the other's single interactive job still
come back. The REAPER never got the same treatment: its four statements each take a flat
`LIMIT p_limit` ordered by `visible_after` or `run_after`. A tenant whose provider is down fills
that limit on every tick, and every other tenant's expired leases are never recovered — `H-16`'s
starvation, arriving through the recovery path rather than the claim path. The wrapper is a
FUNCTION rather than SQL inlined into the cron command because a cron command is a string
nothing type-checks: a typo is discovered in `job_run_details` days later, while a function is
resolved at CREATE time.

### The 7-point RPC contract check, worked

Not applicable in the usual sense, and stated rather than skipped: **015 exposes no RPC.** It
creates one function, `app.reap_jobs_all_tenants`, which is `REVOKE ALL … FROM PUBLIC, anon,
authenticated` and is called by exactly one caller, the cron job. (1) No envelope, because it
returns `integer` to pg_cron and not to a client. (2)–(5) No client surface, no contract entry,
no call site in `apps/web`, no casts. (6) Schedules are rows in `cron.job` and survive a reload
by construction. (7) No public route; `anon` receives nothing.

### Pin — `tests/test_015_realtime_and_cron_schedules.sql`

Five checks, 13 assertions, all executed, all PASS against the full applied set 001–015. The
ones that earn their place: **T3**, which does not merely assert the wrapper runs but reproduces
the starvation condition — 50 expired leases in one tenant, 1 in another, a budget of 10 per
tenant — and then adds a control proving a single-tenant reap leaves the other tenant untouched,
so a wrapper that had quietly become a flat reap would fail rather than pass. **T4**, which
probes the retention boundary at 6 days and 8 days instead of reading the interval out of the
function body. **T5**, which EXECUTES both scheduled commands exactly as they are registered in
`cron.job`, because "scheduled" and "works" are different claims and only one of them is
normally tested. **T2**, which pins ruling R-B as an assertion — no `cron.job` command may
contain `net.http` — precisely because the pattern it forbids is the one Supabase's own
documentation recommends, so the next author will have a good reason to add it back.

### Rollback — `rollbacks/015_realtime_and_cron_schedules_rollback.sql`

Round-tripped twice. Unschedules before dropping the function they call, or there is a window in
which an active job points at a function that no longer exists. **`cron.job_run_details` rows
are deliberately NOT deleted**: unscheduling a job does not clear its history, those rows are
the evidence of what ran and when, and a rollback that swept them would destroy the audit trail
of the jobs it is removing at the moment somebody most wants it. Asserts that 012's two reapers
survive — 015 owns the schedules, never the functions.

### Deliberately NOT built

The outbox drain and webhook dispatcher (R-B). The four retention sweeps over business-visible
rows — the functions exist and are callable by hand, but each needs a retention period agreed
with the customer, which is what 017's `core.data_retention_policies` is for; **scheduling them
first would be deleting on a window nobody signed off.** The levy staleness sweep and the
embedding refresh, neither of which has a function to schedule. Any Realtime policy or
publication membership, which would require inventing the topic vocabulary inside a cron
migration.

### ⚠ Carried risk and standing conditions

- **The harness's pg_cron is a local stub that executes nothing.** Registration is pinned;
  firing is not, and firing is the extension's behaviour rather than this migration's.
- **The 7-day retention window has no source.** Inherited from 012. If a customer or a
  regulator ever names a number for operational logs, this is one of the places it lands.
- **Four retention sweeps are unscheduled and their tables grow unbounded until 017's policy
  rows exist and are approved.** `app.outbox`, `app.dead_letters` and the two webhook tables.
  **Owner: after 017.**
- **Realtime has no database-side configuration at all.** When it lands, the connection-lifetime
  policy cache means revoking access does not close an open socket.

---

## Migration Detail — 014 (`014_rls_policies_and_client_grants.sql`)

**Status: AUTHORED + EXECUTED 2026-09-13, REVIEWED, REVISED 2026-09-13, NOT APPLIED to any
hosted database.**

**⚠ REVIEW LANDED AND ITS BLOCK IS CLEARED.** `docs/reviews/2026-09-13-codex-retrofit-014-017.md`
(Codex `gpt-5.6-sol` xhigh plus a structural/security pass, converging independently) returned
**BLOCK** on 014 with 2 CRITICAL, 4 HIGH and 5 MEDIUM findings. Every premise was re-verified
against the branch before being acted on; none was wrong. Current state, finding by finding:

| # | Sev | What it was | State | Pin that exercises it |
|---|-----|-------------|-------|-----------------------|
| 1 | CRIT | `014:625` granted DELETE on `public.memberships`, which 002 withheld. `memberships_write_admin` is FOR ALL and `memberships_no_self_edit` is FOR UPDATE only, so an aal2 ADMIN could delete-and-reinsert their own row at a higher role. | **FIXED** — grant restored to 002's three privileges, an explicit REVOKE beside it, and a new RESTRICTIVE `memberships_no_client_delete` so the policy layer agrees with the grant layer. | `test_014` **T11**, incl. T11f which re-grants DELETE inside the pin and shows the policy still deletes zero rows |
| 2 | CRIT | The rollback's blanket `REVOKE ALL … IN SCHEMA public` destroyed 002:696-701, and its post-condition asserted that broken state as correct. | **FIXED** — 002's six grant statements reproduced in full in the rollback, post-condition split by schema and re-derived with `has_table_privilege` in both directions. | `test_014_rollback_restores_002_grants.sql` **R1-R4**, run after the rollback and before re-applying |
| 3 | HIGH | The header's baseline claim ("001-013 granted no privilege to anon or authenticated") was false and is why the DELETE read as a restatement. | **FIXED** — header states the measured 001-013 ACL baseline and the real diff line by line. | measurement recorded in the header; `test_002` continues to pin 002's side |
| 4 | HIGH | One predicate string served USING and WITH CHECK, so `tenant_id IS NULL` was admitted on writes. | **FIXED** — read and write predicates separated; the fallback is in USING only. | `test_014` **T13**, which stages a real INSERT grant inside the pin |
| 5 | HIGH | All 113 tenant tables got tenant-only SELECT, so a SALES principal could read `ai_provider_keys`, `run_node_io` and `public_share_tokens`. | **FIXED for those three** (see the posture note below) — a permission term is folded into each one's restrictive isolation policy. | `test_014` **T12**, four ways per table |
| 6 | HIGH | `decideApproval` never sends `p_expected_diff_hash`, so 011's optimistic-concurrency check is unarmed on every call. | **CARRIED** — the fix is in `apps/web` and `packages/contract`, outside this change's mandate; the DB-side alternative breaks every approve immediately. | `test_014` **T15**, which pins the SQL half and fails the day the client half is fixed |
| 7 | MED | Header and catalog counts (235 policies / 115 relations / 4 views) were wrong. | **FIXED** — read back off a clean apply: 228 policies over 115 relations, 2 views. | `test_014` **T1** |
| 8 | MED | Grant checks filtered `information_schema.table_privileges` by grantee and were blind to PUBLIC. | **FIXED** — `has_table_privilege` throughout, migration and pin. | `test_014` **T14**, which creates the PUBLIC grant and measures both spellings |
| — | MED | `test_014` T7 seeded no rows, so the definer read proved nothing. | **FIXED** — one approval per tenant seeded; T7a1 requires exactly one back. | `test_014` **T7** |
| — | MED | The rollback selected policies to drop by naming convention, which would take a later migration's policies. | **FIXED** — 014 stamps every policy it creates with `migration:014` in the policy COMMENT, written by the caller and not inside the shared function, and the rollback drops by that stamp against a count derived from the catalogue. | the rollback's own manifest assertion; `test_014` **T12l** |
| — | MED | `test_013`'s `run_node_io` isolation pin deletes its only row before asserting a read returns zero. | **STILL OPEN.** 001-013 came into scope later and `test_013` gained a new pin (T14, the rotation path), but this assertion was not rewritten: it would still pass under `USING (true)`. Narrower than it was — `run_node_io` is now role-gated as well as tenant-scoped, so a hole there is caught by test_014 T12 from the other side. **Owner: whoever next touches 013.** | `test_014` T12 covers the same table from the policy side |
| — | MED | 018 may define a four-argument `core.decide_approval` against 014's five. | **OUT OF SCOPE** — not a defect in this PR. **Owner: 018.** | `014` verify (6) asserts one overload today |
| — | LOW | `check:grants` T1 fired on `test_014`'s `pg_temp` definer helper. | **FIXED** — `scripts/check-grants.mjs` excepts `pg_temp` only, with the reasoning in the file. A `public.` definer in a test still fires, verified both ways. | the guard itself; `npm run check:grants` is 0 findings |

**A SECOND ADVERSARIAL PASS RAN AGAINST THE FIXES THEMSELVES** — the thermonuclear methodology
the first review recorded as OWED, now that `.claude/skills/thermo-nuclear-code-quality-review`
exists in this environment. It returned BLOCK on the first revision and found five defects the
first review could not have seen because they were introduced by the fix:

- **Rolling 014 back while 017 is still applied was three separate failures.** `REVOKE ALL ON ALL
  TABLES IN SCHEMA core` took 017:1187-1191's five grants with nothing to restore them, and the
  post-condition certified zero client privilege in `core` as correct — CRIT-2 verbatim, one
  schema over. 017's six tenant policies carry no `migration:014` stamp, so they survived the
  manifest loop on tables whose policy function had just been dropped. And the derived manifest
  count included 017's three tables while the stamped set did not, disagreeing by exactly six.
  **Fixed by refusing:** the rollback now aborts if `core.tax_policies` exists, naming the order
  its own header already states. 014's rollback does not learn 017's grant list — a rollback that
  knows about later migrations needs editing every time one lands.
- **The role gate was erasable by any later two-argument call.** `SELECT
  app.apply_tenant_policies('core','run_node_io','014')` — one line, identical in shape to the three
  017 already ships — would have silently replaced the gated isolation policy with an ungated one
  and handed every principal of the tenant the raw agent prompt text back. **Fixed:** the
  function refuses a two-argument call against a table that already carries a gate, naming the
  predicate and telling the caller to pass the permission again or the literal `'UNGATE'` on
  purpose. The gated set is now declared once, in §2's LEFT JOIN, so a gated table is created
  gated on the first pass rather than re-created a moment later.
- **A stale header paragraph claimed four `core` views are granted.** Two are; `budget_status`
  and `model_tier_status` are revoked twelve lines further down in the same file. Deleted — it
  was the one comment in the file that the pack's own argument should have caught.
- **The `pg_temp` exception in `check:grants` tested the wrong function.** It asked whether some
  preceding semicolon-free `CREATE FUNCTION` was in `pg_temp`, so a `pg_temp` helper whose body
  `EXECUTE`s `CREATE FUNCTION core.x … SECURITY DEFINER` was excepted, while an ordinary
  `CREATE FUNCTION pg_temp.f() … AS $$ SELECT 1; $$ … SECURITY DEFINER` was flagged. **Fixed:**
  each `security definer` is paired positionally with the nearest preceding `CREATE FUNCTION
  <schema>.`; six spellings tested, the two that should fire do and the four that should not
  do not.
- **T11f had no counterfactual.** "Deleted zero rows" is also what an unrelated predicate change
  produces. The same DELETE now runs twice, once with the restrictive policy standing and once
  with it dropped, and the second must delete exactly one row.

**AND ONE DEFECT THE FIX FOR (2) INTRODUCED, found by probing the branch rather than reading it.**
The `'UNGATE'` escape hatch — the documented way to remove a gate on purpose — was dead code. Its
literal was excluded from the branch that sets the gate but not from the one that refuses, so every
`UNGATE` call raised instead of ungating. A documented escape that does not work is worse than
none: the next person removes the guard rather than the gate. Fixed, and **T16 now exercises all
six branches of that control** — three-argument gates, two-argument against a gated table refuses,
re-passing keeps, a different permission replaces, `UNGATE` removes, an unknown permission is
refused — on a throwaway table per 004's precedent. An untested branch in a security control is the
defect, not the feature.

Plus: `information_schema.table_privileges` survived in two of the three sites the pack claimed
to have rewritten (the rollback's post-condition and the rollback pin's R3a) — both now use
`has_table_privilege`; five line citations were off by one to two lines; two references pointed
at a `§7` that does not exist. All corrected.

**THE HARNESS, AND A COLLISION WORTH NOT REPEATING.** Every result in this section was produced on
a PostgreSQL 17.11 shim on port 5436 with its own data directory under
`~/Repos/personal-work/trainos-wt/.shim-fix014` (real pgvector, stub `pg_cron`/`pg_net`). ⚠ A
FOREIGN POSTMASTER HELD PORT 5436 at the start of that lane: `pg_ctl start` failed to bind while
`psql` still connected, so one throwaway pass of "apply 001-017 and run the pins" went into another
cluster entirely and was neither noticed nor attributable until afterwards. Every run since asserts
`current_setting('data_directory')` matches the shim before it does anything, and that assertion is
the reason the numbers here can be trusted. **Lanes should pin their port in `postgresql.conf`
rather than on the command line**, and any harness script should check the data directory, not the
port: a port is a promise about who answers, not about which database.

**⚠ THE SECOND REVIEWER SLOT IS OWED, NOT FILLED.** The gate's D-012 rule is that BOTH reviewers
land. Only one did against the fixes. Codex `gpt-5.6-sol` was dispatched at the same time as the
thermonuclear pass and came back hard quota-blocked: *"usage limit … try again at Sep 14th, 2026
12:29 AM."* No verdict was substituted for it. What is specifically unreviewed is the thing Codex
is best at and the structural pass is worst at: the CONSUMER TRACE — every caller of everything the
diff touches, across `apps/**` and `packages/**` as well as `supabase/**`. `npm run check:rpc`
reports 4 pass / 0 broken and no file outside `supabase/` and `scripts/` is modified, which bounds
the risk but does not discharge the trace. **Owner: re-run after the quota resets.**

**FOUND BY EXECUTING THE ROLLBACK, not by either reviewer.** A third destroyed grant of the same
class as CRIT-2: `001:232` grants `USAGE ON SCHEMA core` to `anon`, `authenticated` **and**
`service_role`. 014's header claimed `anon` "never had USAGE on `core` to begin with" and the
rollback revoked it from `authenticated` as though 014 had granted it. Measured `core` nspacl on a
001-013 database: `postgres=UC/postgres anon=U/postgres authenticated=U/postgres
service_role=U/postgres`. 014 now declares the `anon` revoke as the one privilege it takes away
rather than restates, and the rollback restores it instead of revoking a 001 grant. Pinned by R3.

**⚠ AND ONE CORRECTION OWED TO 017'S OWN CATALOG ENTRY**, recorded here rather than edited there:
the §017 note above states that before 014 the nine PUBLIC-executable `core` functions "none of it
was reachable, since `authenticated` had no `USAGE ON SCHEMA core`". By the same measurement, that
is false — 001:232 granted it. 017's REVOKEs are correct and unaffected; only the reachability
framing is wrong, and it understates when the exposure began. **Owner: whoever next amends 017.**

**FINDING #5, RE-OPENED BY THE RE-REVIEW AND NOW CLOSED PROPERLY.** The first fix gated three
tables and called the rest a deliberate posture on the grounds that "the review did not name them".
The 014 re-review (`docs/reviews/2026-09-13-codex-retrofit-014-rereview.md`, N-1, HIGH) took that
apart correctly: `run:read` governs **seven** `core` tables in 013, not one, and `run_state_cards`
is worse than the table that got gated — 013's own header concedes it escapes the 30-day redaction
sweep `run_node_io` gets, and it carries goal, plan and open questions as free text, while
`run_snapshots.response` is every tool call's raw output for the tenant. Provenance is not a
security argument. **All nine tables the three permissions govern are now gated**, the full extent
of each permission rather than the subset a review happened to check:

| Permission | Roles | Tables gated |
|---|---|---|
| `ai:provider:read` | ADMIN | `ai_provider_keys` |
| `run:read` | MD, ADMIN | `runs`, `run_nodes`, `run_node_io`, `run_events`, `run_state_cards`, `run_checkpoints`, `run_snapshots` — all seven |
| `portal:token:issue` | SALES, SALES_MANAGER, MD, ADMIN | `public_share_tokens` |

`runs`, `run_nodes` and `run_events` are included rather than kept as a metadata-only exception:
carving them out would mean deciding that agent id, model, token counts, cost and event detail are
not part of "reading a run", which is a product decision nobody has made and which a grants
migration is the wrong place to make silently.

**⚠ AND THE REST IS A GAP, NOT A POSTURE.** Every other `core` table keeps the blanket tenant-scoped
SELECT to `authenticated`. This catalog previously called that a deliberate posture. It is not one:
it is the state 014 found, narrowed where 002 had already written a permission that says otherwise,
and left alone everywhere else **because within-tenant read authorization has not been designed**.
Doc 09 puts it at the RPC layer. Until that exists, any principal of a tenant can read any other row
of it. **Owner: 018, with the run-trace and AI-ops RPCs.**

**One further residue, named because the re-review was right that the header overclaimed.**
`public_share_tokens`'s gate restores the ROLE half of 002's decision and not the SCOPE half: 002
annotates SALES's and SALES_MANAGER's `portal:token:issue` as `-- scope-narrowed`, meaning it was
meant to compose with `app.client_scope()` / `app.team_scope()`. A SALES principal therefore still
reads every share-token row in the tenant rather than only their own clients'. Adding the scope term
needs an owner column the table does not have — 007 gave it `created_by_id text`, not a user id — so
it is a schema change rather than a predicate change. **Owner: whoever next touches 007's portal
tables.** The pin concedes the same thing by probing this table with `OPS` rather than `SALES`.

Sources: `docs/architecture/09-golden-path-rpc-specs.md` §0, §1, §2 and §12 (the
wrapper posture, the envelope, and the approval-view prohibition); `docs/architecture/02` §4.1
(the RLS baseline and the claim readers); `supabase/CLAUDE.md` security rules 1–7;
`docs/research/2026-09-13-supabase-current-docs.md` §2 (RLS performance: InitPlan wrapping,
policy-column indexing, `TO authenticated`, and the UPDATE-without-SELECT trap); the `C-04`
residue carried by 010, 011, 012 and 013.

### What it does

- **`app.apply_tenant_policies(schema, table, migration, permission DEFAULT NULL)`** — one function, N
  attachments. ⚠ **`migration` is the THIRD argument and is required**: the three-digit pack that
  owns the policy, `'014'` or `'017'`. It is validated against `^[0-9]{3}$` and NULL, `''` and a
  permission string are all refused — because there is no three-argument overload to resolve to, so
  the old spelling `apply_tenant_policies('core','x','run:read')` binds the PERMISSION into the
  MIGRATION slot and produces an **ungated policy with a stamp no rollback can find**. Reproduced on
  a live database before the check existed. Dropping the old signature does not help, because the
  old signature is not what that call resolves to; only typing the slot does. Earlier signatures are
  dropped explicitly all the same, for a database carrying one. Verify (13b) asserts exactly one
  overload. Stamps a
  PERMISSIVE `<table>_tenant_select` (`FOR SELECT TO authenticated`) and a RESTRICTIVE
  `<table>_tenant_isolation` (`FOR ALL`, predicate in USING **and** WITH CHECK). Refuses a
  table with no `tenant_id` and a table that is not RLS-forced. Idempotent by DROP-then-CREATE,
  because a presence check would leave a WRONG predicate standing, which is the failure that
  matters.
- **228 policies over 115 `core` relations** — 113 tenant-scoped tables × 2, plus
  `provenance_subjects_read` (the one core table with no tenant dimension, granted by name with
  its reason), plus 011's `autonomy_grants_agents_cannot_write`, untouched.
- **The client grant layer.** `REVOKE ALL … FROM PUBLIC, anon` across `core`, `app` and
  `public` first; then `GRANT SELECT` — and only SELECT — on 114 `core` tables and two views.
  `GRANT USAGE ON SCHEMA core TO authenticated`.
- **`public.*` grants**, which put 002's twelve `authenticated` policies into service. Measured
  before this migration: `relacl` on all five identity tables was `{postgres=arwdDxtm/postgres}`
  and nothing else, so those policies had never once been consulted. Here the write grants are
  real, because 002's `_write_admin` policies are ADMIN- and aal2-gated inside the predicate —
  the envelope does not own team membership, 002 does.
- **`core.perform_action`, `core.decide_approval`, `core.bulk_decide_approvals`** —
  `SECURITY DEFINER`, `SET search_path = ''`, `SET statement_timeout = '10s'`, one line each.
- **Spine untouched.** No action type, no handler, no branch in the envelope.

### The naming decision on the third wrapper, settled against the consumer

The task brief calls it `core.bulk_decide`. Doc 09 §1 and §12 call it
`core.bulk_decide_approvals`, and so does the only thing that will ever call it:
`apps/web/src/shared/api/rpcClient.ts:335` declares
`wraps011: ["perform_action", "decide_approval", "bulk_decide_approvals"]` and line 533 issues
`this.call("bulk_decide_approvals", …)`. A wrapper named something no client calls is dead code
with a live-looking grant. The spelling follows the consumer and the document; the `app`
function keeps its own name, `app.bulk_decide`, which is why the brief's shorthand is
understandable and is recorded rather than silently overridden.

### `current_tenant_id()` above the claim, `require_tenant_id()` below it

Two spellings survive this migration on purpose, and the rule is one line. `public.tenants`,
`teams`, `team_members`, `memberships` and `user_profiles` are read DURING principal assembly —
`app.principal_claims()` and the GoTrue hook run as `supabase_auth_admin` at a moment when there
is no tenant claim yet, because the claim is what that read is computing. A predicate that
raised there would break login. Empty is the right answer to "which tenant is this" asked before
the answer exists, and 002's `current_tenant_id()` gives it. Every `core` table is business data
reached only by an assembled principal, where a missing tenant is a forged or broken token, and
answering it with an empty list dressed as success is how a tenant-isolation defect hides for a
month. It raises.

### The 7-point RPC contract check, worked

1. **Envelope** — all three wrappers return `app.ok(app.<fn>(…))` and nothing else. T10 asserts
   the composition on the whitespace-stripped `pg_get_functiondef`, which is doc 09 §2's own
   pin: a later edit that inlined a second policy evaluation would still return an envelope and
   would pass every other check in the file.
2. **Unwrap** — T2d counts the top-level keys and requires exactly two. `app.ok` guarantees
   `data` is the sole non-`success` key, and a third key flips every caller in the app from
   auto-unwrap to pass-through at once.
3. **RpcMap** — the three names are already in `rpcClient.ts`'s `wraps011`. 014 adds no shape
   the contract does not carry.
4. **Call sites** — every primary button in the product, through `useAction`.
5. **Casts** — none. The argument list is `app.perform_action`'s verbatim and in order, so a
   rename on either side is a break a reader can see.
6. **Reload/restore** — `NOTIFY pgrst, 'reload schema'` closes the file. New functions and
   grants are invisible to PostgREST until it reloads, and the symptom is `PGRST202` against a
   database where the function plainly exists.
7. **Public routes** — none. `anon` receives no grant, and T4 measures four separate refusals by
   impersonation.

### Pin — `tests/test_014_rls_policies_and_client_grants.sql`

Ten checks, 51 assertions, all executed, all PASS against the full applied set 001–014. The ones
that earn their place: **T2 runs as `authenticated` itself**, not as `service_role` wearing its
claims — 011, 012 and 013 all had to use the service_role probe because before 014
`authenticated` held no EXECUTE, and a 014 pin that kept that shape would be testing 011 again
and asserting nothing about 014. **T3 tests both directions of cross-tenant refusal and requires
them to differ**: the write must RAISE, and the read must return zero rows rather than error,
because a caller who can tell "refused" from "not there" can enumerate another tenant's refs one
request at a time. **T5 compares row SETS, not counts**, since two tenants owning one row each
have the same count under a policy that is true for everybody. **T8 exercises the function on
four throwaway tables** — NOT NULL, nullable, no-tenant and unforced — and the last of its
assertions deliberately installs a `USING (true)` policy under the right name and re-runs, to
prove the function REPLACES a wrong predicate rather than skipping a name that already exists.
**T9 requires sqlstate `42501`**, because a write refused only by a policy reports success on
zero rows.

### Rollback — `rollbacks/014_rls_policies_and_client_grants_rollback.sql`

Round-tripped four times, plus a full-set reverse round trip: `relations in app+core: before=0
after=0`. Drop order is wrappers → grants → policies → index and function, and **grants come
down before policies on purpose**: the other order leaves a window in which `authenticated`
holds SELECT on 114 tables with no predicate. It would be a window inside one transaction and
therefore invisible, and it would still be wrong, because a rollback that is only safe because
it commits atomically stops being safe the first time somebody runs half of it by hand.
Nothing uses a wildcard `DROP POLICY`: 011's `H-02` kill switch, 002's fourteen `public.*`
policies and the three `app.*` definer-read policies are all asserted present at the end, and
the core count is asserted back to exactly 1.

### Deliberately NOT built

Write grants of any kind on `core` — the write path is the envelope and 014 is the migration
that makes that structural. `core.list_approvals` / `core.get_approval` and the other 21 doc 09
functions — 018's, gated on the user's go. A grant on `app.usage_rollup` to rescue
`budget_status` — that would trade a broken screen for a hole in the `app` boundary that
013's `H-09` answer rests on. Re-writing 011's fifteen gated-column revokes to look thorough:
they are vacuous (a column-level UPDATE revoke does nothing when no role holds UPDATE on the
table, and `pg_attribute.attacl` is NULL for all fifteen), and 014 asserts the stronger property
— no client role holds UPDATE anywhere in `core` — instead of restating them.

### ⚠ Carried risk and standing conditions

- **`core.budget_status` and `core.model_tier_status` have no client data path.** Security-invoker
  views over `app.usage_rollup`, which no client role can read by design. Both are explicitly
  revoked and test_013 T11b3 asserts they stay that way. The AI budget and model-tier screens
  are blocked until 018 reads them from a definer RPC in `core`, or the rollup moves into
  `core`. **Owner: 018.** This is a product gap, not a test exclusion.
- **`core.rule_set_versions` still has no composite `UNIQUE (tenant_id, id)`.** 014 added the
  missing tenant index because it created the policy that needed it; the unique is a shape
  change to a table that may hold rows. **Owner: 017.**
- **~~The pack is unreviewed.~~ SUPERSEDED 2026-09-13.** Both reviewers landed and the
  BLOCK is cleared; see the findings table at the head of this section. What remains unreviewed
  is the REVISION — the fixes above have been executed, pinned and round-tripped, and have not
  themselves been through a second adversarial pass.
- **`p_expected_diff_hash` is unarmed in the product.** `core.decide_approval` accepts it and
  011 compares it, but `decideApproval` never sends it and the contract type has no field for
  it, so the optimistic-concurrency check is a no-op on every real call. `test_014` T15 pins
  exactly this and is written to FAIL when the client is fixed. **Owner: the web lane.**
- **110 of 113 tenant-scoped `core` tables are readable by any principal of the tenant.**
  Deliberate, stated above, deferred to the RPC layer. **Owner: 018.**
- **`test_013`'s `run_node_io` isolation pin does not prove isolation** — it deletes its only
  row before asserting the read returns zero, so it would pass under `USING (true)`. Outside
  this change's mandate. **Owner: whoever next touches 013.**
- **The shim's `postgres` role is SUPERUSER and BYPASSRLS.** Every policy here was therefore
  proved by IMPERSONATION (`SET LOCAL ROLE authenticated` / `anon`) rather than by running as
  the migration role, which is the only way these results mean anything on this harness. On
  hosted Supabase `postgres` is `NOSUPERUSER` with `BYPASSRLS`; the definer wrappers rely on
  that bypass to read past the caller's RLS, and if a future hardening pass removes it, every
  `SECURITY DEFINER` function in the pack needs a definer-read policy on each table it touches.
  Named here because `supabase/CLAUDE.md` rule 2 records the measurement that motivates it.

---

## Migration Detail — 013 (`013_ai_ops_agents_keys_runs_and_budgets.sql`)

**Status: AUTHORED + EXECUTED 2026-09-13, NOT APPLIED to any hosted database.** Sources:
`docs/architecture/05` §5.4 and §6 (run traces, run I/O, state cards, checkpoints, replay, PII
redaction, evals); `docs/architecture/04` §5 (model tiers, the routing matrix, budget status);
`docs/architecture/02` §3.1 (agent API keys), §6 (BYOK provider keys) and §7.2a
(`app.aal2_verified`); `docs/architecture/06` findings `C-03`, `C-04` residue, `H-08`, `H-09`,
`M-03`, `M-10`, `M-11`, `M-16`, `M-25`, `N-02`, `N-09`.

### What it does

- **The agent roster and its credentials.** `core.agents`, `public.agent_api_keys` (enabled AND
  forced — `H-09`'s inert-policy finding), and `app.agent_api_key_secrets` holding the salted
  digest in a schema PostgREST cannot reach.
- **BYOK provider keys.** `core.ai_provider_keys` holds a masked prefix and a locator; the
  material lives in the platform secret store. Five RPCs — set, test, rotate, delete, reveal —
  and none of them takes the raw key as a parameter.
- **Model tiers, routing and budgets.** `core.tier_keys`, `core.model_tiers`,
  `core.routing_matrix_versions`, `core.routing_entries`, `core.ai_budgets`,
  `app.usage_rollup` and `app.roll_up_usage`, with `core.budget_status` and
  `core.model_tier_status` as the two security-invoker views. `M-03`'s phantom relation is
  defined in both directions — the table exists AND something fills it. The `WITHIN` / `NEAR` /
  `PAUSED` transition is defined ONCE, in the view, with `near_threshold` as per-budget DATA
  rather than a constant in SQL.
- **The run trace tree.** `core.runs`, `run_nodes`, `run_node_io`, `run_events`,
  `run_state_cards`, `run_checkpoints`, `run_snapshots`, and `core.evals`.
- **`app.key_access_audit`** — doc 05 §5.4's rule #1, made structural rather than procedural.
- **Spine untouched.** 013 adds no action type and no branch to the envelope.

### The `run_id` reconciliation, in full

| Column | Type | From | What 013 does |
|---|---|---|---|
| `core.action_requests.agent_run_id` | `text` | 011 | unchanged, no FK |
| `core.events.run_id` | `text` | 012 | unchanged, no FK |
| `app.outbox.run_id` | `text` | 012 | unchanged, no FK |
| `core.proposals.run_id` | `uuid` | 007 | `proposals_run_fk` added |
| `core.provenance.run_id` | `uuid` | 007 | `provenance_run_fk` added |
| `core.rule_change_sets.run_id` | `uuid` | 009 | `rule_change_sets_run_fk` added |

`core.runs` carries BOTH: a `uuid` primary key and a `ref` with `UNIQUE (tenant_id, ref)` from
`app.finalise_table`, allocated `RUN-YYYY-NNNN` by `core.assign_ref`. A text run id is the
run's ref. Nothing is retyped, no row is rewritten, and the three FKs are the ones 007 and 009
wrote `-- FK added by 013` against. **The open half is stated, not hidden:** the three text
columns get no foreign key, so a typo'd `runId` still writes an event whose trace cannot be
followed. Closing it would require every already-written row to name an existing run, which is
the data this reconciliation exists to preserve. On a live database the fix-up is one INSERT
into `core.runs` per historical distinct run id, `ref` set to that string, and no UPDATE.

### The 7-point RPC contract check, worked

1. **Envelope** — `public.ai_provider_key_set/test/rotate/delete/reveal`. 013 is the FIRST
   migration that actually calls `app.ok` (001's header claims 011 does; it does not). Success
   returns through `app.ok`; errors RAISE, because an exception is what rolls back and a
   returned error object next to a committed side effect is the failure mode.
2. **Unwrap** — `data` remains the sole non-`success` key on every one.
3. **RpcMap** — the contract's AI surface already describes these. 013 adds no shape it does
   not carry. `ModelTier.model` is a string in the contract, which is why there is no
   `core.ai_models` table: it would be a table nothing reads.
4. **Call sites** — the provider screen and the usage screen. `app.verify_agent_key` and
   `app.record_key_access` are the only two functions `service_role` may execute.
5. **Casts** — none.
6. **Reload/restore** — the reveal ceiling is per key per 24 hours and survives a reload,
   because it is a stored timestamp rather than session state.
7. **Public routes** — none. Nothing reaches `anon`.

### Pin — `tests/test_013_ai_ops_agents_keys_runs_and_budgets.sql`

Thirteen checks, all executed, all PASS, against the FULL applied set **001–014, not 001–013**. ⚠ Corrected 13 Sep 2026: this pin's T11b2 requires 014's client grants to be present, so it cannot pass at 001–013 — confirmed by executing it there, where it fails, and again with 014 applied, where it passes. `test_012` has the same dependency and both pin headers now say so. The ones that
earn their place: the reveal ceiling proved by moving `last_revealed_at` BACKWARDS rather than
forwards, because `now()` is `transaction_timestamp()` and a forward bump inside the same
transaction writes the same value and passes vacuously; the audit-first ordering proved by
refusing the audit and watching the reveal go with it; fourteen jsonb shapes refused, including
doc 04 §735's legacy boolean jury; the budget transition walked at 799, 800, 999 and 1000
against a cap of 1000; twenty-one relations and eleven functions refused to `anon` and
`authenticated` by IMPERSONATION rather than by reading `has_table_privilege`; and **T9j, which
asserts that a person's name SURVIVES the masker** — so the day masking improves, the pin fails
and says the header is out of date.

### Rollback — `rollbacks/013_ai_ops_agents_keys_runs_and_budgets_rollback.sql`

Pre-flight guards with no override, including one that 012 must still be intact — which is
where `to_regproc` returning NULL for an AMBIGUOUS name was found, reporting 012's overloaded
`app.emit_event` as dropped and aborting the whole rollback on a database where it was present.
The three foreign keys onto 007's and 009's tables are dropped by name, and the rollback asserts
that those columns and 007's `provenance_run_idx` survive. Round-tripped: applied → rolled back
→ re-applied, `relations in app+core: before=0 after=0`.

### Deliberately NOT built

`app.usage_event` (doc 04 §5.5's partitioned micro-MYR ledger) — out of scope, and the rollup
aggregates `core.runs`/`core.run_nodes` where cost and tokens actually live. The peak/off-peak
daily series — it needs a tenant-level `peak_hours bit(24)` that does not exist on
`public.tenants`, and hardcoding a peak window in SQL is the same defect as a hardcoded stage
list. `core.ai_models` — the contract has no model entity. Event names for set/test/rotate and
delete — doc 05 §5.4 says only REVEAL emits, and inventing four names would put unsigned-off
§1.7 catalogue additions into the database; the pin asserts they are ABSENT. An FK from
`core.autonomy_grants.agent_id` to `core.agents` — 011 owns that column, and a grant that
cannot exist before a roster row would make the kill switch depend on provisioning order.
`scope_tiers`/`fallback_chain` element validation — an array element cannot carry an FK, and a
validating trigger would read `core.tier_keys` under FORCE-with-no-policy and refuse every
write; named for 014, not solved here.

### ⚠ Carried risk and standing conditions

- **The FORCE-with-no-policy residue**, as 011 and 012 carry it. 013's response is to shape
  every security path to fail CLOSED under it rather than to add a `USING (true)` policy that
  would be a cross-tenant read grant landing before the grant layer. **014 owns the close.**
- **`core.runs` is unwritable per tenant until 016** seeds the `RUN` row in
  `core.ref_formats`, which is the standing condition of every ref'd table since 004.
- **`core.rate` (007) is `numeric(6,5)`** while root `CLAUDE.md` prescribes `numeric(6,4)` for
  rates. 013 uses the explicit types the rule names rather than the domain. Not 013's to settle.

---

## Migration Detail — 012 (`012_events_outbox_and_jobs.sql`)

**Status: AUTHORED + EXECUTED 2026-09-13, NOT APPLIED to any hosted database.** Sources:
`docs/architecture/05` §1 (events and the audit index), §2 (outbox, job types, the claim /
heartbeat / complete / fail / reap lifecycle, dead letters), §4 (inbound webhooks), §5.2 and
§5.5 (the drawer and retention); `docs/architecture/06` findings `C-07` to `C-09`, `H-08`,
`H-12`, `H-15` to `H-18`, `H-26`, `N-02`, `N-09`, `M-07`, `M-09`, `M-14` to `M-17`, `M-20`,
`M-24`, `M-26`; root `CLAUDE.md` R14; `packages/contract/src/events.ts` and `endpoints.ts`.

### What it does

- **`core.events`** is the business record: append-only by REVOKE, by a row trigger, and by a
  statement-level `BEFORE TRUNCATE` trigger. `core.event_subjects` is the audit drawer's index,
  with `occurred_at` denormalised onto it and indexed
  `(tenant_id, subject_type, subject_id, occurred_at DESC, event_id DESC)` so the keyset
  pagination the drawer was designed around actually has an index to walk (`H-26`).
  `app.emit_event` is the only write path, in two overloads, both revoked from PUBLIC by full
  signature (`M-09` — the doc's argument-less revoke errors, and PUBLIC holds EXECUTE on new
  functions by default, which 001 measured).
- **One narrow, audited exemption for PDPA erasure** (`C-09`). `app.redact_event_actor` writes
  an `app.event_redactions` row in the same transaction, and the append-only trigger admits the
  UPDATE only after re-deriving FROM THE TWO ROW VERSIONS that nothing but the actor's
  identifying fields changed. The exemption is therefore not "a flag was set" but "the change
  is provably a redaction". A narrow audited exemption is defensible; no path at all is not.
- **The outbox and its lifecycle.** `app.outbox`, `app.job_type_map` (18 rows over 16 action
  types; the other 6 of 004's 22 are absent by design and the arithmetic is asserted),
  `app.claim_jobs` / `heartbeat_job` / `complete_job` / `fail_job` / `reap_jobs`,
  `app.dead_letters`, `app.cancel_jobs`.
- **Inbound webhooks** — `app.webhook_deliveries`, `app.webhook_routes`, paths taken from the
  CONTRACT rather than from doc 05 (`M-26`), with the disagreement recorded and the contract
  not edited.
- **The retention reapers doc 05 §5.5 tabulated and never wrote** (`C-07`): webhook bodies at
  30 days, webhook rows at 1 year, SUCCEEDED outbox rows at 90 days, dead letters, and
  `cron.job_run_details` at 7 days — which the doc itself flags as growing without bound
  because Postgres does not clean it up. Each is batched with `SKIP LOCKED` and a `LIMIT`, and
  each RETURNS the number of rows it deleted so 015 can alarm on a reaper that stops reaping.
- **Spine untouched.** 012 wires the envelope's external effects to a queue. It does not change
  `app.perform_action`, the policy gate, or the effect ledger's shape.

### The 7-point RPC contract check, worked

1. **Envelope** — no client-callable RPC added. Every function here is reached by the migration
   role, by `service_role` on the worker path, or by another function.
2. **Unwrap** — nothing in 012 crosses the PostgREST boundary, so there is no envelope to
   break. The one shape that DOES cross a seam is `app.report_effect_result`'s, and 012 is its
   caller rather than its author.
3. **RpcMap** — no entries. `packages/contract/src/events.ts` describes the event catalogue the
   client reads; 012 adds no callable surface to describe. **One proposed addition is flagged
   for the contract lane**: `JobStalled` (`H-17`) is not in `DOMAIN_EVENT_TYPES`.
4. **Call sites** — `app.enqueue_effect_jobs` is called by nothing yet, because 011's
   `apply_effects` does not call it. That is a wiring gap in 011, recorded rather than fixed
   from inside this pack.
5. **Casts** — none.
6. **Reload/restore** — no client-visible behaviour.
7. **Public routes** — none. Nothing in 012 is granted to `anon` or `authenticated`.

### Pin — `tests/test_012_events_outbox_and_jobs.sql`

Fourteen checks, all executed, all PASS, against the FULL applied set 001–012. The ones that
earn their place: the full `fail_job` race (A's lease expires, the reaper requeues, B claims,
A is REFUSED), the poison pill on both lanes (a job at `max_attempts` is neither claimable nor
returned to the queue), per-tenant fairness measured by flooding fifty jobs from one tenant and
confirming the other's single interactive job still comes back, the TRUNCATE refusal executed
rather than reasoned, both `emit_event` overloads proved not PUBLIC-executable, and every jsonb
CHECK rejecting a plausible WRONG SHAPE rather than merely a non-object — doc 04 §735's worked
trap, where a legacy boolean jury `{"enabled":true,...}` was accepted by a constraint that
looked careful.

### Rollback — `rollbacks/012_events_outbox_and_jobs_rollback.sql`

Pre-flight guards with no override, refusing on a later migration's objects, on in-flight work
in the outbox, and on a non-empty `core.events` — it is the business record, and a rollback
that quietly erases it is not a rollback. Reverse of the forward order, stated in a comment.
Round-tripped: applied → rolled back → re-applied, `relations in app+core: before=0 after=0`.

### ⚠ Carried risk, stated rather than closed

The nine tenant-scoped tables here are RLS-enabled and FORCED with no policy, which is the
posture every migration since 004 has taken. `supabase/CLAUDE.md` §2 records the measured
consequence: FORCE removes the owner's exemption, so on a platform whose migration owner lacks
`BYPASSRLS` a `SECURITY DEFINER` function reading its own forced table returns **zero rows,
silently**. Every definer function in 012 that reads an 012 table is exposed to this until 014
admits the read. The alternative — a `USING (true)` policy landing here — would be a
cross-tenant read grant arriving before the grant layer that is supposed to contain it. **014
owns this and it is the first thing that migration must enumerate.**

### What 013 needs to know

`run_id` is **`text`** on `core.events` and `app.outbox`, because 011's
`core.action_requests.agent_run_id` is `text` and the demo run id `run_4821` is not a uuid.
It is **`uuid`** on `core.proposals`, `core.provenance` and `core.rule_change_sets` (007, 009).
Two representations of one concept now exist in the schema. 013 creates `core.runs` and must
**reconcile** the two rather than picking one and retyping — every event already written
against the text form would lose its trace.

---

## Migration Detail — 011 (`011_action_envelope_and_policy_gate.sql`)

**Status: AUTHORED + EXECUTED 2026-09-13, NOT APPLIED to any hosted database.** Sources:
`docs/architecture/03` §1 (the gate tables), §2 (`app.perform_action`, the evaluation
algorithm), §2.9 (gated state transitions), §3 (effect executors), §4 (approval decisions)
and §5 (jury); `docs/architecture/01` §5 (column grants, the `gated_by text[]` fix, and the
legal-transition set); `docs/architecture/06` findings `C-04` residue, `N-03`, `H-02` to
`H-05`, `H-07`, `H-10`, `H-13`, `M-02`, `M-04`, `M-12`, `M-13`, `M-21`; root `CLAUDE.md` R14.

### What it does

- **The envelope.** `core.action_requests` logs every action; `app.action_effects` is the
  execution ledger; `app.idempotency_keys` makes a double-clicked button deterministic rather
  than a race, by taking the advisory lock BEFORE the insert. `app.perform_action` runs the
  guards in §2.0's order — each is cheaper than the next and each would be wrong later.
- **The policy gate.** `core.action_policies` is the rule set, 22 rows per tenant, materialised
  by a trigger on tenant creation rather than by a migration, because the table is
  tenant-scoped and a tenant that arrives after this migration must still get a catalogue.
  `core.autonomy_grants` is agent × action type × level.
- **Approvals.** `core.approval_requests` and `core.approval_decisions`, `app.decide_approval`,
  `app.bulk_decide`, and the bounded sweeps 015 will schedule.
- **`core.state_transitions`.** 124 rows. The registry is keyed
  `(entity, column_name, from_status, to_status)` with `gated_by text[]`, because one edge is
  authorised by three different action types — `outbound_messages DRAFT → QUEUED` is gated by
  `FOLLOWUP_SEND`, `REMINDER_SEND` or `BROADCAST_SEND` depending on why the message exists, and
  with a single gate two of the three sends fail at send time on whichever flow is tested
  second (doc 01 §5.2). A SQL PRIMARY KEY cannot contain the NULL `from_status` an INSERT edge
  needs, so the key is a `UNIQUE NULLS NOT DISTINCT` index over the four columns.
- **One shared enum at the outbox seam.** `app.effect_status` is created here and 012 REUSES
  it. `app.report_effect_result` raises on any member outside `SUCCEEDED`/`FAILED`, and a value
  outside the enum raises at the typed boundary — root `CLAUDE.md` R14, whose worked example is
  a wrong constant recording every delivered email as dead-lettered.
- **Spine:** this IS the spine. It is pinned hardest, and every finding it closes is closed
  with an assertion rather than with a comment.

### The 7-point RPC contract check, worked

1. **Envelope** — `app.perform_action`, `app.decide_approval` and `app.bulk_decide` all return
   through `app.ok`/`app.err` (001), which BUILD the object rather than describing it, so a
   top-level sibling key is not something a later author can add by accident.
2. **Unwrap** — `data` remains the sole non-`success` key. `Idempotent-Replay` is set as a
   RESPONSE HEADER through `set_config`, deliberately not as a second top-level key.
3. **RpcMap** — `packages/contract/src/actions.ts` already declares the request and every
   response variant. 011 adds no shape the contract does not carry. **Contract lane: see the
   disagreements listed below.**
4. **Call sites** — none yet in `apps/web`; the envelope is reached through the Edge Function
   adapter that 012's seam describes. New objects with no consumers, expected.
5. **Casts** — none.
6. **Reload/restore** — an idempotent replay returns the ORIGINAL body with status 200, not the
   stored 202 (`M-21`), which is the path a reload actually takes.
7. **Public routes** — none. Nothing in 011 is reachable from an unauthenticated request, and
   nothing is granted to `anon` or `authenticated` at all.

### Pin — `tests/test_011_action_envelope_and_policy_gate.sql`

Fourteen checks, all executed, all PASS, against the FULL applied set 001–011.
T1 the exact inventory — 11 tables, 27 functions, 22 policies per tenant, 124 edges, as exact
values not counts · T2 HUMAN outcomes and their status codes · T3 all four AGENT outcomes ·
T4 SYSTEM executes and its identity is logged · T5 replay is byte-identical at 200 ·
T6 self-approval AND the NULL requester both refused (`H-03`) · T7 a NULL role refused before
authorisation (`H-04`) · T8 a forged `aal2` claim passes neither money boundary (`H-05`) ·
T9 both `H-07` holes — a `QUEUED_FOR_APPROVAL` request and a sibling-row target · T10 the
agent cannot grant itself autonomy, proved by adding a permissive policy beside the
restrictive one and showing the restrictive one still wins (`H-02`, and root `CLAUDE.md` R11's
"a restrictive deny still denies") · T11 an unknown worker status raises at the single enum
seam (R14) · T12 a malformed `payload_schema` fails closed (`N-03`) · T13 invoker view, `app`
USAGE intact, timezone math, bounded sweeps · T14 zero client SELECT and EXECUTE on every
object 011 creates.

### Rollback — `rollbacks/011_action_envelope_and_policy_gate_rollback.sql`

Five pre-flight guards, none with an override: **G1** a known 012–015 relation, a later policy,
grant or trigger attachment; **G2** any operational row in a gate table, because action
payloads, decisions, grants, effects and jury records are business data; **G3** seed drift —
exactly 22 action types, 22 policies per tenant and 124 registry edges must still be present
before they are removed (this guard fired during review, on the author's own change, which is
what a guard is for); **G4** any 004 hours-saved baseline referencing an 011 action type;
**G5** any relation or FK outside 011 depending on an 011 table. Then, in reverse of the
forward order. `app.action_types` SURVIVES and is restored to the empty global catalogue 004
created; its full prior definition is reproduced in the rollback's header rather than
referenced. Round-tripped: applied → rolled back → re-applied, green each time.

### Where the schema disagrees with the documents — the schema wins

Recorded because the prose is a claim and the migration is the fact (R13):

- 004 already owns **global** `app.action_types`; doc 03's surviving `core.action_types`
  references are not followed.
- 004's `value_source` CHECK has no `PROPOSAL` member, so `PROPOSAL_SEND` is seeded `NONE` and
  `app.action_value` resolves it explicitly from `core.proposals.value_sen`.
- `app.current_actor()` returns `(actor_id, actor_kind, role)`, not doc 03's `(id, kind, role)`.
- `core.hrdc_packets` carries `claim_reference` / `claim_submitted_at`, not the prose's
  `submission_reference` / `submitted_at`; `core.engagements` has `closed_out_at`, not
  `closed_at`.
- `core.outbound_messages` cannot store `DELIVERED` or `READ`, and `core.rule_changes` cannot
  store `WITHHELD` (it has a separate `withheld` boolean). The registry is seeded in full
  regardless; those edges are documented facts until the owning table's migration widens its
  vocabulary.
- `app.aal2_verified()` does **not** exist in 002, contrary to the brief 011 was given. It is
  created here against `auth.sessions`, and doc 02 §7.2a's own `[assumed]` marker on the `aal`
  column name still stands — see "What I could NOT verify".

### Deliberately NOT built

No cron schedule (015 owns schedules), no event or outbox table (012), no `core.agents` and no
`app.ai_budgets` (013 — creating truncated impostors here would collide with that migration,
so two future trigger attachments are honestly absent rather than fabricated), and no client
policy or grant (014). External effects stop at typed `DISPATCHED` rows; 012 enqueues them and
calls `app.report_effect_result`. Jury rows stop at `PENDING`. That is doc 03's transaction
boundary held without a forward reference that would make 011 unrunnable.

### What the contract lane needs to know

The schema now disagrees with `packages/contract` in two places, both of which belong to that
lane and neither of which 011 touched:

1. **`ALL_ACTION_TYPES` is 22 and the schema agrees**, but `GOVERNED_ACTION_TYPES` adds
   `PROPOSAL_DRAFT`, which carries an autonomy grant and a routing entry while never being a
   `POST /v1/actions` call. `app.action_types` holds the 22; `core.autonomy_grants.action_type`
   references it, so an autonomy grant for `PROPOSAL_DRAFT` is currently unrepresentable.
2. **Three invoice status edges exist in the database that no contract type describes** —
   `PARTIALLY_PAID → SENT`, `PAID → PARTIALLY_PAID` and `PAID → SENT`, all reachable through a
   payment reversal. Any client-side transition map derived from doc 01 §5.3 will be missing
   them.

---

## Migration Detail — 010 (`010_finance_invoices_payments_collections.sql`)

**Status: AUTHORED + EXECUTED 2026-09-13, NOT APPLIED to any hosted database.** Sources:
`docs/architecture/01` §3.4 (invoices, lines, payments, collections),
`docs/architecture/04` §1.3 and §1.6 (lines, totals, reconciliation, SST on the summed net) and
§7 (aging buckets, the collections ladder), `DECISIONS.md` §1 (autonomy ceilings) and §7
(rounding), and `docs/architecture/06` `C-11` (the e-invoice gap).

### What it does

- **Ten tables**: `tenant_tax_profiles`, `invoices`, `invoice_lines`, `invoice_sync_entries`,
  `payments`, `credit_notes`, `credit_note_lines`, `aging_buckets`, `collection_rules`,
  `collections_cases`. All through `app.finalise_table`, all RLS enabled AND FORCED with zero
  policies — deny-all until 014.
- **Ten functions**, every one at `search_path = ''` and REVOKEd from every client role.
- **One ALTER**, on `core.organisations`, adding the buyer's tax identifiers and a structured
  address. The rollback reproduces that table's prior shape in full.

### The decisions worth defending

- **`sst_sen` and `total_sen` are GENERATED, where doc 01 has CHECK constraints.** A CHECK
  rejects a wrong total; a generated column makes one unrepresentable, which is the argument doc
  04 §1.3 makes for the line amount and which applies identically here. PostgreSQL forbids one
  generated column referencing another, so the SST term is recomputed inside `total_sen` rather
  than referenced — the duplication is the language's, not a second definition of the rule.
- **`outstanding_sen` is NOT generated, and cannot be.** A generation expression may not read
  another table. It is trigger-maintained from `core.payments` and then asserted at COMMIT by the
  same deferred trigger that guards the header totals, so a direct UPDATE on the header — which
  bypasses the maintaining trigger entirely — still cannot leave it wrong.
- **`einvoice_cancel_deadline_at` is derived by trigger, and that is a downgrade forced by
  PostgreSQL rather than a choice.** It was written `GENERATED ALWAYS AS (einvoice_validated_at +
  interval '72 hours') STORED` and refused: *generation expression is not immutable*.
  `timestamptz + interval` is STABLE, not IMMUTABLE, because interval arithmetic depends on the
  session TimeZone. Found by running it. The guarantee is bought back by a BEFORE trigger that
  overwrites the column unconditionally, and `test_010` T8 earns it by writing a deliberately
  extended deadline and checking the row afterwards.
- **Payments are append-only and the trigger is named `trg_a_payments_immutable`.** Triggers fire
  in NAME order and `app.set_updated_at` is also a BEFORE UPDATE trigger; the `a_` prefix is what
  makes the refusal win regardless of what a later migration attaches.
- **`core.payment_apply()` locks the invoice and re-reads the payment sum INSIDE the lock.** A
  read before the lock is the stale read the lock exists to prevent. Parent-before-child is also
  007's portal-acceptance lock order, so the two cannot deadlock against each other under load.
- **`collections_cases` is UNIQUE per OPEN case, not per invoice.** An invoice that was chased,
  settled, and went overdue again is a second case; collapsing them would lose the first chase.

### Defects found by running it

1. **The self-referential foreign key could not be declared inline.**
   `payments_reverses_fk (tenant_id, reverses_payment_id) → core.payments (tenant_id, id)` needs
   `UNIQUE (tenant_id, id)` on the table being created, and that unique constraint is one of the
   things `app.finalise_table` adds afterwards. Inline it fails with *there is no unique
   constraint matching given keys for referenced table*, which is accurate and reads like a
   missing parent table. Added after `finalise_table` with the reason in the file.
2. **`invoices_void_needs_reason` was wrong, and `test_010` T7a caught it.** It read
   `(voided_at IS NULL) = (void_reason IS NULL)`, conflating two different events that both need a
   reason: TrainOS voiding its own invoice, and the DOCUMENT being cancelled downstream inside the
   72-hour window. The second sets `void_reason` without `voided_at`, so the CHECK refused it —
   making the statutory cancellation path this migration exists to support unwalkable. Worth
   recording rather than quietly fixing: the wrong version was the more restrictive of the two and
   looked more careful, which is how a wrong constraint survives review.

### The 7-point RPC contract check, worked

1. **Envelope** — no client-callable RPC added. `core.receivables_aging` returns a SETOF and
   `core.collection_stage_for` a scalar; both are internal. When 014 exposes a finance RPC it
   returns through `app.ok`/`app.err` like every other.
2. **Unwrap** — not applicable; nothing here returns the envelope, and no top-level sibling key is
   introduced anywhere, so the 037 mechanism cannot fire.
3. **RpcMap** — no entries. No client-callable surface is added.
4. **Call sites** — `grep -rn "receivables_aging\|collection_stage_for"` over `apps/` and
   `packages/` returns ZERO today. Stated rather than left to look like a dead-RPC finding: they
   exist for 013's agent tooling and the collections queue, both later. **If they still have zero
   call sites after 016, that IS a finding.**
5. **Casts** — none. No `as unknown as` near this surface.
6. **Reload/restore** — no client-visible behaviour yet.
7. **Public routes** — none. The portal's public surface is 007's share tokens, untouched;
   nothing here is reachable by `anon`, and `test_010` T15 asserts it per object.

### Authorization

No grants to any client role, on any table or either function. `core.receivables_aging` takes the
tenant as an ARGUMENT, so granting EXECUTE before 014 gives the tables policies would publish a
cross-tenant reader; 014 grants it and the body re-checks the caller's tenant.

### Spine

**Spine untouched.** `app.perform_action` does not exist yet. Every action type these tables are
the target of — `INVOICE_CREATE`, `INVOICE_PUSH`, `PAYMENT_RECORD`, `CREDIT_NOTE_ISSUE`,
`ACCOUNT_TRADING_HOLD` — is registered as DATA in 011's `app.action_types` seed, never as a branch
here. `collections_cases.trading_hold_action_id` is deliberately left without a foreign key: 011
adds it rather than 010 guessing the shape of a table that does not exist.

### Carried forward

- **C-11 is NOT fully closed by this migration and does not claim to be.** Its first sentence asks
  for written confirmation that the accounting package is the submitter of record and round-trips
  these fields. That is a client answer, not a schema change. Registered as **D-45**.
- **The C-04 sequencing residue** is flagged in 010's header for 011 as the critic asked, not
  re-derived: doc 03's `grant select … to authenticated` must not land before the gate tables have
  policies.

---

## Migration Detail — 009 (`009_compliance_rules_checks_hrdc.sql`)

**Status: AUTHORED + EXECUTED 2026-09-12, NOT APPLIED.** Sources: `docs/architecture/04` §3 (the
bitemporal registry, the rule grammar, `resolve_rules`), `docs/architecture/01` §3.3,
`docs/architecture/02` §4.2 Template E, DECISIONS §3 and §6, contract §17 and §18.
**AMENDED 2026-09-13 (pass A), re-executed, still NOT APPLIED.** `core.knowledge_chunks.embedding` is no longer conditional. It was wrapped in `IF EXISTS (extname = 'vector')` with an `ELSE` that raised a NOTICE and carried on, which produces a migration that applies cleanly and then fails at query time with "column embedding does not exist" — the failure arriving far from its cause — and this catalog was carrying it as the one object never executed in its intended form. Ruling R-EXT put `vector` in 001 and 001 asserts the type resolves, so the `ELSE` branch is unreachable by construction and is gone. The column and its HNSW index are written `extensions.vector(1536)` and `extensions.vector_cosine_ops`: a bare `vector(1536)` resolves only while `extensions` is on the session search path, which is true in psql and false inside any function pinned to `search_path = ''`. **This is now genuinely executed** against real pgvector 0.8.6. The six rule-grammar enums gained the provenance comments `test_003` T5 requires. Three functions moved to `search_path = ''`.

### The 7-point RPC contract check, worked

1/2. No client-callable RPC, no envelope. `core.resolve_rules` is an internal `STABLE` function with
EXECUTE revoked from `anon`. 3. RpcMap: none. 4. Call sites: 011 gates `RULE_CHANGE_APPROVE` and
`HRDC_PACKET_MARK_SUBMITTED` against these. 5. Casts: one, and it is the finding — see the dated
entry on `scheme_key`. 6. Reload/restore: none. 7. Public routes: none.

### Pin — `tests/test_009_compliance_rules_checks_hrdc.sql`

Nine checks, all executed, all PASS. T1 both nullable-tenant tables are RLS-forced despite skipping
`finalise_table` · T2 ACTIVE needs a named verifier · **T3 the bitemporal question, three answers** ·
**T4 ambiguity refused AND the three non-ambiguous pairs permitted** · T5 a tenant override wins
locally and does not leak across the estate · T6 an incomplete packet cannot be submitted and a
PRESENT document needs evidence · T7 a changed source is quarantined · T8 a change below 0.80
confidence is withheld from the diff · T9 a drift must cite two different versions.

### Rollback — `rollbacks/009_compliance_rules_checks_hrdc_rollback.sql`

Guards on filed claims, ACTIVE verified rules and the assessment history, each with why it is not
reconstructible — re-extracting rules from circulars produces PROPOSED rows, not verified ones.
Round-tripped and idempotent.

---

## Migration Detail — 008 (`008_delivery_engagements_sessions_attendance.sql`)

**Status: AUTHORED + EXECUTED 2026-09-12, NOT APPLIED.** Sources: `docs/architecture/01` §3.2,
contract §8, DECISIONS §3 and §6. Applied cleanly on the first run.

### The 7-point RPC contract check, worked

1/2. No RPC, no envelope. 3. RpcMap: none. 4. Call sites: 009 claims from these, 010 invoices from
them, 011 gates them. 5. Casts: none. 6. Reload/restore: none. 7. Public routes: none.

### Pin — `tests/test_008_delivery_engagements_sessions_attendance.sql`

Nine checks, all executed, all PASS. T1 a presence needs a capture method, an absence needs a reason ·
T2 locking stamps the approval and closes all three capture modes · **T3 the check a parent-only lock
fails: no insert, update OR delete of a mark on a locked day** · T4 the locked day's own columns are
frozen · T5 locking requires a named approver · **T6 unlocking needs a reason, clears the approval,
reopens capture, and counts itself even when the caller supplies a zero** · T7 the trainer projection
follows sessions in both directions · T8 a sent message cites its consent row · T9 the delivery count
moves both ways.

### Rollback — `rollbacks/008_delivery_engagements_sessions_attendance_rollback.sql`

**Refuses while any locked attendance day exists.** 008's whole point is that locked attendance
cannot be modified, and dropping the table is the one way around that. Also guards issued
certificates and sent messages. Reopens two foreign keys on 006's and 007's tables, stated as
correct. Round-tripped and idempotent.

---

## Migration Detail — 007 (`007_money_proposals_quotations_portal.sql`)

**Status: AUTHORED + EXECUTED 2026-09-12, NOT APPLIED.** Sources: `docs/architecture/04` (every
money column and rule), `docs/architecture/01` §3.1, DECISIONS §5 and §7, contract §6 and §11.
**AMENDED 2026-09-13 (pass A), re-executed, still NOT APPLIED.** `core.provenance_subjects` gained RLS enabled AND forced. It was the last table in the pack with neither, and it is in `core`, which `config.toml` exposes to PostgREST — so it was reachable from a browser, not merely untidy. It gets NO policy and that is correct rather than a gap for 014: its only SQL consumer is the foreign key on `core.provenance.subject_table`, and PostgreSQL performs referential integrity checks with row security bypassed by design. `core.rate_card_status` gained the provenance comment `test_003` T5 requires. Six functions moved to `search_path = ''`.

### Conflicts recorded here

- **C1 (schema).** Doc 04 qualifies every object `app.` and makes no schema statement. Doc 03 — which
  outranks it — uses `core.quotations` and `core.invoices` in its own executable SQL, and doc 05
  resolved the same question to `core` against migration 001. These are `core` tables with `app`
  helpers, and doc 04's `app.quotation` is what doc 01 calls it: "a verification harness, not a
  competing table".
- **C5 (plural).** Doc 04 is singular throughout; doc 05 resolved to plural, doc 03 and doc 01 use
  plural. Pluralised.

### The 7-point RPC contract check, worked

1/2. No client-callable RPC, no envelope. 3. RpcMap: none. 4. Call sites: 010 invoices from these,
011 gates them, 016 seeds. 5. **Casts: the generated columns cast `bigint` to `numeric` before
dividing** — deliberate, and the only place integer division would silently truncate.
6. Reload/restore: none. 7. Public routes: the portal's read path reaches `public_share_tokens` in
014 through a SECURITY DEFINER RPC, never through a policy on the table.

### Pin — `tests/test_007_money_proposals_quotations_portal.sql`

Twelve checks, all executed, all PASS. T1 no floating money in `core` · T2 total-from-lines on the
contract's real costing · T3 `ceil` not `round` · T4 which floor binds, and T4b a genuine breach
refused then permitted by an approval · T5 a header that disagrees with its lines cannot commit ·
T6 a package price is one line at qty 1 · T7 the jsonb NULL-check trap plus an unattributed AI row ·
T8 drafting on the placeholder card is allowed, applying is not · T9 one acceptance per proposal and
no column that could hold a raw token · T10 a sent proposal's sections are frozen · T11 rate-card
integrity: one active card at a time, client site free, meals within their ACM ceiling.

### Rollback — `rollbacks/007_money_proposals_quotations_portal_rollback.sql`

Guards on sent proposals, portal acceptances and applied quotations, each with the reason it cannot
be reconstructed. Reopens `follow_ups.proposal_id`, stated as correct rather than damage.
Round-tripped and idempotent.

---

## Migration Detail — 006 (`006_catalogue_programmes_and_trainers.sql`)

**Status: AUTHORED + EXECUTED 2026-09-12, NOT APPLIED.** Source: `docs/architecture/01` §3.2,
DECISIONS §1 and §5.

### The 7-point RPC contract check, worked

1/2. No RPC, no envelope. 3. RpcMap: none; Data API tables. 4. Call sites: 007 prices from these,
008 schedules from them, 016 seeds them. 5. Casts: none. 6. Reload/restore: none.
7. Public routes: none.

### Pin — `tests/test_006_catalogue_programmes_and_trainers.sql`

Six checks, all executed, all PASS. T1 floor ≤ list and claimable implies a scheme · T2 a certified
trainer must carry the certificate reference the HRD Corp packet asks for · **T3 the full
double-booking matrix, seven cases** · **T4 the availability calendar follows confirm, MOVE and
cancel** · T5 the rule is tenant-scoped · T6 the three deferred foreign keys are closed and a
cross-tenant programme reference is now impossible.

**RLS four-way: in test_014.** Deny-all until then.

### Rollback — `rollbacks/006_catalogue_programmes_and_trainers_rollback.sql`

States plainly that it reopens three foreign keys on tables it does not own, returning those columns
to the unconstrained state 002 and 005 left them in — correct for this rollback, and written down so
it is not read as damage. Guards on CONFIRMED bookings and on live programmes. Round-tripped and
idempotent; 006 itself is now re-runnable.

---

## Migration Detail — 005 (`005_sales_organisations_enquiries_tna.sql`)

**Status: AUTHORED + EXECUTED 2026-09-12, NOT APPLIED.** Source: `docs/architecture/01` §3.1.
Applied cleanly on the first run; no defect found in the doc's own specification of these tables.

### What it does

Fourteen tables (see the Migration Order row) plus `core.v_contact_consent_current`, a
`security_invoker` view so the caller's RLS on the ledger applies — a view that bypassed it would be
a cross-tenant read of exactly the data PDPA cares most about.

### The 7-point RPC contract check, worked

1. **Envelope** / 2. **Unwrap** — no RPC. 3. **RpcMap** — none; Data API tables.
4. **Call sites** — none yet; 014 grants, 016 seeds. 5. **Casts** — none.
6. **Reload/restore** — no client behaviour. 7. **Public routes** — none; the portal reaches
   proposals in 007, never these.

### Pin — `tests/test_005_sales_organisations_enquiries_tna.sql`

Eight checks, all executed, all PASS. T1 refs · **T2 cross-tenant FK unrepresentable, twice** ·
T3 low-confidence enquiry cannot be archived, and CAN be after review · T4 a match with no reason is
refused · T5 one enquiry, one opportunity · T6 LOST needs a reason, a follow-up has at most one
target · T7 consent survives withdrawal and the recorded fact is frozen · T8 the four deferred
forward-reference columns exist.

**RLS four-way: deliberately in test_014.** Every table here is RLS-forced with no policy, so an
impersonated read returns nothing and would prove nothing. T2 is the stronger property anyway — it
holds with RLS out of the picture entirely.

### Rollback — `rollbacks/005_sales_organisations_enquiries_tna_rollback.sql`

Guards: G0 already rolled back; a generic sweep naming any table OUTSIDE 005 that still references
one of 005's (so a later migration is named rather than discovered as a cascade failure halfway
through the drops); a guard on `contact_consents` rows, because that ledger is the only record of
what a person agreed to and when; and a guard on live `organisations`. Header carries the export
commands. Guard firing was tested by inserting a live organisation and confirming the refusal.
Round-tripped, idempotent.

---

## Migration Detail — 004 (`004_shell_config_and_ref_allocation.sql`)

**Status: AUTHORED + EXECUTED 2026-09-12, NOT APPLIED.** Sources: `docs/architecture/01` §3.6 and
Conventions, `docs/architecture/02` §4.1, `docs/architecture/03` §1.1, DECISIONS §4.
**AMENDED 2026-09-13 (pass A), re-executed, still NOT APPLIED.** `app.action_types` gained RLS enabled AND forced plus one permissive `SELECT` policy, for the same measured reason as `app.role_permissions` — the policy gate reads this catalogue from a `SECURITY DEFINER` function, and forced-with-no-policy makes that read return zero rows, so every action type resolves as unknown and every primary button in the product stops. It also gained the critic's `N-03` fix: `payload_schema` now carries `CHECK (payload_schema ? 'required' AND jsonb_typeof(payload_schema -> 'required') = 'array')` with the default moved to `'{"required": []}'` in the same change. Without it the gate's only payload guard fails OPEN on a misspelled key — `requires`, `required_keys`, or one level of nesting — and every payload for that action type validates. Three functions moved to `search_path = ''`.

### What it does

Fourteen `core` tables plus global `app.action_types`, `app.finalise_table()`, `core.next_ref()` and
`core.assign_ref()`. See the Tables and RPC sections. Three design points carry the weight:

- **The finaliser is a spine object.** Every table migration from 005 on goes through it, so a
  defect is a defect in eighty tables at once and will not look like one.
- **It refuses an untenanted table.** `RAISE ... undefined_column` rather than silently finalising
  something no policy can isolate.
- **It is migration-role only.** It runs `EXECUTE format(...)` on its arguments. Every identifier is
  quoted with `%I` AND `EXECUTE` is revoked from every client role, because either alone would be
  insufficient — a client-reachable function of this shape is an arbitrary-DDL primitive.

### The 7-point RPC contract check, worked

1. **Envelope** — no client-callable RPC. 2. **Unwrap** — no envelope crosses the boundary.
3. **RpcMap** — none; these are tables the Data API reads directly once 014 grants them.
4. **Call sites** — `finalise_table` is called by 005–013; `assign_ref` fires on every table with a
   `ref`. 5. **Casts** — none. 6. **Reload/restore** — no client behaviour yet.
7. **Public routes** — none; `anon` receives nothing.

### Pin — `tests/test_004_shell_config_and_ref_allocation.sql`

Eight checks, all executed, all PASS. T1 every `core` table RLS-forced with **zero** policies ·
T2 undated and dated refs match the contract's `TPL-0001` / `ENQ-2026-0001` shapes · T3 an explicit
ref is honoured then frozen, and a row cannot be transplanted between tenants · **T4 counters are
per tenant** (a global counter leaks record volume across customers and no access-control test would
catch it) · **T5 the FINALISER itself**, on a throwaway table, all eight properties asserted
including behaviour: allocation, `updated_at` override, and the extra frozen column · T6 it refuses
an untenanted table and a missing one · T7 neither `finalise_table` nor `next_ref` is client-callable
· T8 the two constraints that encode a business rule — a non-WhatsApp template may not carry a
per-message rate, and a `MEASURED` hours-saved basis may not exist without a sign-off, because that
is how an illustrative number becomes a published ROI claim.

**RLS four-way: deliberately deferred to test_014.** These tables have RLS forced and no policies, so
every impersonated read returns nothing and would prove nothing.

### Rollback — `rollbacks/004_shell_config_and_ref_allocation_rollback.sql`

Header carries the export commands and states what is not derivable: pipelines and steps are the only
definition of stage names and order; templates are the only copy a sent proposal renders from.
**`attachments` and `signatures` get their own guard**: dropping `attachments` destroys the index
into object storage while the objects survive unreferenced and unfindable, and a `signatures` row IS
the evidence — signer, timestamp, IP, method — with no copy in the bucket. Four guards (G0 already
rolled back, G1 a `core` table 004 did not create, G2 any attachment or signature row, G3 any
`app.action_types` row). CASCADE is used here and explicitly justified as safe only because G1 has
already proved nothing outside 004 exists in `core` — with a pointer to rollback 003's header for
the case where CASCADE would have silently dropped a column. Round-tripped, idempotent.

---

## Migration Detail — 003 (`003_enum_types.sql`)

**Status: AUTHORED + EXECUTED 2026-09-12, NOT APPLIED.** Source: `docs/architecture/01` Conventions
(the enum-versus-reference-table split and the type list), `packages/contract/src/enums.ts` (the
values), contract §12 and §17.

### What it does

69 `CREATE TYPE ... AS ENUM` in `core`, each idempotent behind a `duplicate_object` handler and each
carrying a `COMMENT` recording its source. No table, no function, no policy, no grant — a type is
not a privileged object and there is nothing sensitive in a label.

### The 7-point RPC contract check, worked

1. **Envelope** / 2. **Unwrap** — no RPC, no jsonb across the boundary.
3. **RpcMap** — no entries, but this is the one migration where the SQL and
   `packages/contract/src/enums.ts` MUST stay in lockstep, and it is generated from that file
   precisely so they do.
4. **Call sites** — every domain table in 004–013 types a column with one of these. Zero today is
   expected.
5. **Casts** — none. 6. **Reload/restore** — no behaviour. 7. **Public routes** — none.

### Pin — `tests/test_003_enum_types.sql`

Six checks, all executed, all PASS. The expected list is generated from the migration, so pin and
migration are the same list by construction and a disagreement means one was hand-edited.
T1 all 69 types exist · T2 no UNEXPECTED type crept in (one nobody generated is one somebody typed) ·
T3 every label matches **in declaration order** · T4 ordering is semantic, demonstrated:
`BREACHING < TODAY` and `OBSERVE < AUTONOMOUS`, so a ceiling comparison written `level <= ceiling`
keeps meaning what it says · T5 every type carries its provenance comment · T6 `actor_kind` and
`app_role` exist in `app` and NOT in `core`.

**RLS four-way: not applicable** — 003 creates no table.

### Rollback — `rollbacks/003_enum_types_rollback.sql`

One guard that answers the real question in one message: which columns are still declared with a
`core` enum, so the operator knows which migration to roll back first, rather than sixty-nine
separate refusals. Drops are alphabetical because enum types do not depend on one another, and
pretending there is a dependency order would imply one exists. **CASCADE is deliberately absent and
must not be added** — it drops the dependent column rather than refusing. Round-tripped: applied →
rolled back → re-applied, verify green each time.

---

## Migration Detail — 002 (`002_tenancy_identity_and_permissions.sql`)

**Status: AUTHORED + EXECUTED 2026-09-12, NOT APPLIED to any hosted database.** Sources:
`docs/architecture/02` §1.2, §1.3, §2.2, §2.3, §2.4, §3.1, §4.1, §4.3.
**AMENDED 2026-09-13 (pass A), re-executed, still NOT APPLIED.** `app.custom_access_token_hook` and `app.principal_claims` are now `SECURITY INVOKER`, resolving doc 02 §4.1's open question in the direction it recommended: under `DEFINER` the `supabase_auth_admin` grants and policies 002 creates were inert, and §4.1 said so — "one of the two is dead code and nobody knows which". They must change together; the hook is a two-line wrapper and leaving `principal_claims` as `DEFINER` would put the body back in the owner's context. This immediately exposed a real gap that `DEFINER` had been hiding: `supabase_auth_admin` held no `USAGE` on schema `public` (001 revokes the Postgres default and grants it back to exactly anon/authenticated/service_role), so the hook died on `permission denied for schema public`. `test_002` T9 had been passing vacuously and only tested what its name claimed once the mode changed. `app.role_permissions` gained RLS enabled AND forced plus one permissive `SELECT` policy — required, measured, see the dated entry. All eighteen functions moved to `search_path = ''`; deviation D1 is closed in favour of the empty path.

### What it does

See the Tables and RPC sections above. Three things are worth restating because they are the
reasons this migration is dangerous:

- **RLS is FORCED, not merely enabled.** Forcing removes the table owner's exemption, so a function
  running as `postgres` no longer silently sees every tenant. It does not affect `service_role`,
  which holds `BYPASSRLS` and bypasses regardless — intended, and the reason `service_role` must
  never reach a browser.
- **`memberships_no_self_edit` is RESTRICTIVE.** A permissive policy of the same name reads
  identically in a diff and does the opposite: permissive is an OR branch that grants, restrictive
  is the AND that denies. T6c asserts `permissive = 'RESTRICTIVE'` off `pg_policies` for exactly
  that reason.
- **Grants are the floor under RLS, not a substitute.** `anon` holds no table grant at all, so it is
  refused before a policy is ever consulted. T5e2 asserts that distinction rather than accepting an
  empty result: a future migration that hands `anon` a SELECT grant would still return 0 rows under
  RLS and would look identical to a pin that only counted.

### The 7-point RPC contract check, worked

1. **Envelope** — no RPC added; nothing here returns an envelope. `app.principal_claims` returns
   jsonb, but it is a GoTrue-internal shape and `app` is not an exposed schema.
2. **Unwrap** — not applicable; no jsonb envelope crosses the API boundary.
3. **RpcMap** — no entries. `packages/contract/src` describes HTTP endpoints; none of these
   functions is one.
4. **Call sites** — `app.current_tenant_id`, `app.has_permission`, `app.can_see_owner`, `app.aal`
   and `app.role` are consumed by every policy in 014 and by the gate in 011. Zero consumers today
   is expected, not a dead-RPC finding: the consumers are later migrations in this same set.
5. **Casts** — one, and it is load-bearing: `(SELECT app.my_team_user_ids())::uuid[]`. It is not a
   compiler bypass, it is what selects the array form of `ANY` over the subquery form. See the dated
   entry.
6. **Reload/restore** — ⚠ **a role or scope change does NOT take effect until the access token
   refreshes**, because those are claims rather than a lookup. Doc 02 §7.4 requires forcing
   `refreshSession()` after any privilege change. That is a client obligation this migration cannot
   enforce; it is recorded here so it is not later discovered as a bug.
7. **Public routes** — none. `anon` holds EXECUTE on nothing and SELECT on nothing (T11).

### Pin — `tests/test_002_tenancy_identity_and_permissions.sql`

Twelve checks, all executed, all PASS.
T1 five tables RLS enabled + forced ·
T2 no policy left at the implicit PUBLIC (which would also match `anon`) ·
T3 399 grants / 109 permissions and all three of doc 02's deliberate asymmetries, plus that a
scope-narrowed `○` was stored as a GRANT and not a denial ·
T4 claim readers read the claim, and absent claims default to least privilege ·
**T5 THE FOUR-WAY MATRIX** on one membership row — owner 1, same-tenant peer 0, other tenant 0
(and other tenant sees exactly 1 tenant row, its own), `anon` DENIED_BY_GRANT, and a **positive
control**: the tenant's ADMIN sees 1. Without the positive control, "everything is denied" passes
as a security property ·
T6 an ADMIN cannot edit their OWN membership but CAN edit someone else's, and the policy is
RESTRICTIVE ·
T7 an ADMIN write at `aal1` is refused — MFA lives in the policy, not in a front-end route guard ·
T8 `can_see_owner` across all three scopes, including that `MY_TEAM` does NOT see the other team ·
T9 the hook resolves tenant, role, scope and team **as `supabase_auth_admin`**, and T9b that an
unknown user receives claims satisfying nothing ·
T10 a membership cannot be transplanted into another tenant ·
T11 `anon` holds no EXECUTE in `app` and no SELECT anywhere.

Fixtures: two tenants, five `auth.users`, two teams. The second tenant exists for exactly one
purpose — to be invisible.

### Rollback — `rollbacks/002_tenancy_identity_and_permissions_rollback.sql`

Header carries the export commands for the three tables that cannot be reconstructed
(`tenants`, `memberships`, `team_members`) and states plainly that dropping `memberships` destroys
the only record of who had access to which tenant in which role.

Five guards, none with an override: **G0** already rolled back → say so and stop; **G1** any table
in `core`; **G2** any `app` function neither 001 nor 002 created; **G3** any foreign key into
`public.tenants` from outside 002 (using `to_regclass`, never a bare `::regclass` cast, which
raises on a missing relation); **G4** `app.role_permissions` no longer holds exactly the 399 seeded
rows, which means an operator edited the live matrix and re-applying 002 would NOT restore it —
`ON CONFLICT DO NOTHING` re-adds the seed but cannot resurrect a deleted row.

**G1, G2 and G4 were tested by making each condition true** and confirming the refusal and its
message, not by reading them. Drop order is the reverse of forward, with the enum types last
because `memberships` columns depend on them. Round-tripped: applied → rolled back → rolled back
AGAIN (idempotent, says "nothing to do") → re-applied → pin green.

---

## How this set was validated

There is **no Supabase CLI and no Docker** in the authoring environment, so `supabase start` and
`supabase db reset` were not available and were not run. Nothing in this set has been applied to any
hosted Supabase project, and no Supabase MCP apply/execute tool was used.

What WAS run: a scratch **PostgreSQL 17.11** cluster (Homebrew, started on `127.0.0.1:55432` inside
the session scratch directory, `wal_level = logical`), seeded with a platform shim that supplies the
parts of a Supabase database a migration is entitled to assume — the `anon` / `authenticated` /
`service_role` / `authenticator` roles, the `auth` schema with `auth.users`, `auth.uid()`,
`auth.jwt()` and `auth.role()` reading `request.jwt.claims`, the `supabase_realtime` publication and
a `storage.buckets` stub. Every migration in this set was applied to that cluster in numeric order,
every rollback was executed, and every pin was executed and its output read.

**Changed 2026-09-13, and the change found three defects.** Two things about the harness were
weaker than they read:

1. **The shim no longer provides `cron`.** Ruling R-EXT means `001` itself runs
   `CREATE EXTENSION pg_cron`, so a shim that pre-created the `cron` schema would make that
   statement fail. `pg_cron` and `pg_net` are now installed as **local stub extensions** — real
   control files and scripts in the cluster's extension directory, generated by
   `harness/install_stub_extensions.sh`, which record what would have been scheduled or requested
   and do nothing else. **`vector` is the REAL extension** (`brew install pgvector`, 0.8.6), so
   `extensions.vector(1536)` and the HNSW index with `vector_cosine_ops` are genuinely created and
   genuinely exercised rather than skipped.
2. **Pins are executed against the FULL applied set**, not immediately after their own migration.
   Running `test_003` right after `003` is a weaker claim than it looks, and the difference is not
   theoretical: run against all nine, `test_003` T2 and T5 and `test_004` T1a all failed, and all
   three failures were real (two pin defects and one genuine missing `FORCE`). A pin that has only
   ever been run at the moment that flatters it has not been run.

There is also a **third, deliberate** harness capability: a probe that emulates the hosted
`BYPASSRLS` condition. This cluster's `postgres` is a superuser with `BYPASSRLS`, so it cannot
answer doc 02 §4.1's question by being asked. The probe reassigns a table and its `SECURITY DEFINER`
reader to a role created `NOSUPERUSER NOBYPASSRLS` and measures the mechanism instead. The mechanism
generalises; one cluster's role attribute does not.

**What that does and does not prove.** It proves the SQL parses, executes, that the constraints and
triggers behave as claimed, that RLS policies admit and refuse the right callers under impersonation,
that every function's body resolves under `search_path = ''`, and that each rollback restores the
prior state. It does **not** prove behaviour against Supabase's real `auth` schema, GoTrue's
custom-access-token hook, **real `pg_cron` scheduling or real `pg_net` HTTP delivery — both are
stubs here, so what is proved is that the call sites compile, resolve and record, not that a job
ever fires or a request is ever sent** — real logical-replication delivery to Realtime subscribers,
or Supabase's own role grants and platform extensions. Nor does it settle whether Supabase's
`postgres` role carries `BYPASSRLS`: Supabase's RLS guide states that a function created by
`postgres` "will have bypassrls privileges", which implies it does, but that is an inference from
prose about a role attribute nobody here can read, and doc 02 §4.1 says plainly that doc-reading
cannot settle it. **The pack is therefore built to be correct either way** — the access-token hook
is `SECURITY INVOKER`, and every table a `SECURITY DEFINER` function must read carries a policy
admitting that read — so the answer does not change any behaviour. Those items are listed under
"What I could NOT verify" in the authoring report and must be re-verified on a real project before
apply.

---

## End of Catalog
