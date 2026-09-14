-- 023 · Sales directory hosted demo data, additive to `hosted_demo_akademi_perdana.sql`.
--
-- Run AFTER the base seed (same tenant, `akademi-perdana`, unmodified):
--   psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/seeds/hosted_demo_akademi_perdana.sql
--   psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/seeds/hosted_demo_sales_directory.sql
--
-- Remove exactly what THIS file added (the base seed is untouched):
--   psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/seeds/hosted_demo_sales_directory_wipe.sql
--
-- Pin (ends in ROLLBACK): supabase/seeds/test_hosted_demo_sales_directory.sql
--
-- ── Why a separate file rather than an edit to the base seed ────────────────
-- Several domain lanes add hosted demo data to the same tenant in parallel
-- (training, compliance, finance, ops, portal). One shared file would be a
-- guaranteed merge conflict on every PR; this one touches only what 023's
-- migration serves and nothing another lane's seed writes.
--
-- ── Why targets are resolved BY NAME, not by the base seed's `pg_temp.demo_id` ──
-- This file runs as its OWN `psql -f` invocation, in its own session. The base
-- seed's `pg_temp.demo_id` is a TEMP function — it does not exist here. Every
-- organisation and programme this file references is looked up by its name
-- inside the tenant, which the base seed's own header documents as stable
-- (`ref` is left NULL for `core.assign_ref` to allocate; `name` is not).
--
-- ── Hosted-safe, same rules as the base seed ─────────────────────────────────
--   * takes the tenant by slug, never provisions one;
--   * never writes auth.users, memberships or user_profiles — every owner is
--     one of the three real MD members, spread across them; the suggestions
--     name the paused knowledge agent in their text actor columns;
--   * never disables a trigger. `core.opportunities.stage` is inserted at its
--     table default (`NEW`), which is `app.enforce_state_transition`'s one
--     UNGATED `NULL -> NEW` edge (011:1048) — no further walk is attempted,
--     because every edge out of NEW into PROPOSAL_SENT or WON is GATED on a
--     real `PROPOSAL_SEND`/`OPPORTUNITY_CONVERT` action (011:1049,1053-1054),
--     which this file will not fabricate;
--   * leaves `ref` NULL so `core.assign_ref` allocates it from the tenant's
--     own sequences, continuing after the base seed's and the app's own;
--   * own id range for a clean, independent wipe: `pg_temp.demo_id` below
--     hashes under a `sales-directory` namespace distinct from the base
--     seed's `hosted-demo` one, so the two wipes can never collide.
--
-- Idempotent: every id is `pg_temp.demo_id(<stable key>)`, guarded by
-- NOT EXISTS (not ON CONFLICT, which would fire the ref-assignment trigger and
-- burn a number on every re-run). A second run writes nothing.
--
-- ── What this closes ──────────────────────────────────────────────────────────
-- The base seed has no `core.organisation_suggestions` row at all — the
-- cross-sell panel on `/sales/organisations/:id` and both
-- `/relationships/renewals` and `/relationships/cross-sell` (both read
-- `getOrganisationSuggestions`) had nothing to show even once 023's RPC
-- existed. Three OPEN suggestions are added, one per existing ACTIVE_CLIENT
-- organisation, each naming a real seeded programme.
--
-- The base seed's five opportunities have already moved OFF the `NEW` stage
-- (four to QUALIFYING/TNA_SENT, one to LOST — see its own comment on why it
-- goes no further), so the pipeline board's NEW column and the fresh end of
-- `/sales/leads` had nothing in them. One opportunity is added for
-- `Aurora Precision Tooling Sdn Bhd`, a PROSPECT organisation the base seed
-- already creates but never gives a deal — left at NEW, which is exactly what
-- a fresh, unqualified lead should look like. Its primary contact is added
-- alongside it, since the base seed does not give this organisation one either.

CREATE OR REPLACE FUNCTION pg_temp.demo_id(p_key text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT ('de30da7a-5eed-4' || substr(h, 1, 3) || '-8' || substr(h, 4, 3) || '-' || substr(h, 7, 12))::uuid
    FROM (SELECT md5('akademi-perdana:hosted-demo:sales-directory:' || p_key) AS h) AS k;
$fn$;

DROP TABLE IF EXISTS pg_temp.sd_ctx;
CREATE TEMP TABLE sd_ctx ON COMMIT DROP AS
SELECT tenant.id                                  AS t,
       now()                                       AS at,
       'd1449fad-b732-4ee2-93c9-37f338e01358'::uuid AS u1,
       'ad615910-2d87-42a4-9855-58f52409ec6d'::uuid AS u2,
       '415dad6e-c53f-4a84-ab50-bf8e9e65223f'::uuid AS u3,
       (SELECT p.display_name FROM public.user_profiles p
         WHERE p.tenant_id = tenant.id AND p.user_id = 'd1449fad-b732-4ee2-93c9-37f338e01358') AS u1n,
       (SELECT p.display_name FROM public.user_profiles p
         WHERE p.tenant_id = tenant.id AND p.user_id = 'ad615910-2d87-42a4-9855-58f52409ec6d') AS u2n
  FROM public.tenants AS tenant
 WHERE tenant.slug = 'akademi-perdana';

DO $guard$
BEGIN
  IF (SELECT count(*) FROM sd_ctx) <> 1 THEN
    RAISE EXCEPTION 'hosted demo sales-directory seed: tenant akademi-perdana not found — run the base seed first';
  END IF;
END
$guard$;

-- ── Targets, resolved by name ────────────────────────────────────────────────

DROP TABLE IF EXISTS pg_temp.sd_orgs;
CREATE TEMP TABLE sd_orgs ON COMMIT DROP AS
SELECT org.id, org.name FROM core.organisations AS org, sd_ctx c
 WHERE org.tenant_id = c.t
   AND org.name IN ('Aurora Manufacturing Sdn Bhd', 'Kenanga Retail Group Berhad',
                     'Meridian Logistics Sdn Bhd', 'Aurora Precision Tooling Sdn Bhd');

DO $guard_orgs$
BEGIN
  IF (SELECT count(*) FROM sd_orgs) <> 4 THEN
    RAISE EXCEPTION 'hosted demo sales-directory seed: expected 4 base-seed organisations by name, found %',
      (SELECT array_agg(name) FROM sd_orgs);
  END IF;
END
$guard_orgs$;

DROP TABLE IF EXISTS pg_temp.sd_programmes;
CREATE TEMP TABLE sd_programmes ON COMMIT DROP AS
SELECT prg.id, prg.name FROM core.programmes AS prg, sd_ctx c
 WHERE prg.tenant_id = c.t
   AND prg.name IN ('Conflict to Collaboration', 'Sales Excellence for Store Managers',
                     'Data Literacy for Managers');

DO $guard_prg$
BEGIN
  IF (SELECT count(*) FROM sd_programmes) <> 3 THEN
    RAISE EXCEPTION 'hosted demo sales-directory seed: expected 3 base-seed programmes by name, found %',
      (SELECT array_agg(name) FROM sd_programmes);
  END IF;
END
$guard_prg$;

-- ── A contact and a fresh, unqualified opportunity for the one PROSPECT the ──
-- base seed creates but never gives either ─────────────────────────────────

INSERT INTO core.contacts (id, tenant_id, organisation_id, name, job_title, email, phone, is_primary, created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.demo_id('con:auroratl'), c.t, org.id, 'Chong Yee Ling', 'Operations Manager',
       'yeeling.chong@auroraprecision.com.my', '+60125566778', true,
       c.at - interval '18 hours', 'HUMAN', c.u2::text, c.u2n
  FROM sd_ctx c, sd_orgs org
 WHERE org.name = 'Aurora Precision Tooling Sdn Bhd'
   AND NOT EXISTS (SELECT 1 FROM core.contacts x WHERE x.id = pg_temp.demo_id('con:auroratl'));

-- Inserted at the table default (`NEW`); `NULL -> NEW` is 011's one ungated
-- opportunity edge, so no further walk is needed or attempted.
INSERT INTO core.opportunities (id, tenant_id, organisation_id, primary_contact_id, owner_id, value_sen, probability, created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.demo_id('opp:auroratl'), c.t, org.id, pg_temp.demo_id('con:auroratl'), c.u2, 1580000::bigint, 0.20,
       c.at - interval '9 hours', 'HUMAN', c.u2::text, c.u2n
  FROM sd_ctx c, sd_orgs org
 WHERE org.name = 'Aurora Precision Tooling Sdn Bhd'
   AND NOT EXISTS (SELECT 1 FROM core.opportunities x WHERE x.id = pg_temp.demo_id('opp:auroratl'));

-- ── Cross-sell suggestions: the panel `getOrganisationSuggestions` (023) reads ─
-- One per existing ACTIVE_CLIENT organisation, all OPEN, naming a real
-- programme. `actions` and `provenance`'s floor are both derived in SQL
-- (023 §3), not stored, so neither needs a column here — the same reason the
-- base seed inserts no `core.provenance` row for `tna_gaps` either.

INSERT INTO core.organisation_suggestions (id, tenant_id, organisation_id, suggestion_type, programme_id, title, rationale, status, created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.demo_id(v.k), c.t, org.id, 'CROSS_SELL', prg.id, v.title, v.rationale, 'OPEN',
       c.at - v.age, 'AGENT', 'agent_knowledge', 'Knowledge Agent'
  FROM sd_ctx c,
       (VALUES
         ('sug:aurora',   'Aurora Manufacturing Sdn Bhd', 'Conflict to Collaboration',
          'Conflict to Collaboration',
          'RM 40,000 of Aurora''s HRDC levy is unused and expires this year; the shift-handover gap the last TNA surfaced is exactly what this programme addresses.',
          interval '6 days'),
         ('sug:kenanga',  'Kenanga Retail Group Berhad',  'Sales Excellence for Store Managers',
          'Sales Excellence for Store Managers',
          'Kenanga''s 48 store managers have not attended a sales programme in over a year, and Q1 is their traditional planning window for one.',
          interval '3 days'),
         ('sug:meridian', 'Meridian Logistics Sdn Bhd',   'Data Literacy for Managers',
          'Data Literacy for Managers',
          'Meridian''s planning team completed this programme once already, eighteen months ago; a refresher cohort for the newer planners is overdue.',
          interval '1 day')
       ) AS v(k, org_name, prg_name, title, rationale, age)
  JOIN sd_orgs org ON org.name = v.org_name
  JOIN sd_programmes prg ON prg.name = v.prg_name
 WHERE NOT EXISTS (SELECT 1 FROM core.organisation_suggestions x WHERE x.id = pg_temp.demo_id(v.k));
