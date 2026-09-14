-- Removes exactly the rows `hosted_demo_sales_directory.sql` added to tenant
-- `akademi-perdana`, and nothing else. The base seed (`hosted_demo_akademi_
-- perdana.sql`) and its own wipe are untouched by this file in either
-- direction.
--
-- Run:
--   psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/seeds/hosted_demo_sales_directory_wipe.sql
--
-- Rows are addressed by the SAME `pg_temp.demo_id` keys the seed used (its own
-- `sales-directory` namespace, disjoint from the base seed's `hosted-demo`
-- one), deleted in FK-safe order: the suggestion before nothing (it has no
-- dependent), the opportunity before the contact, the contact before nothing
-- else references it. `core.assign_ref` never ran for these (`ref` left NULL
-- throughout), so there is no ref sequence to reconcile.
--
-- No explicit transaction control here, matching `hosted_demo_wipe.sql`: run
-- standalone under `psql -1` (one transaction, the whole file or nothing), or
-- `\ir`'d from inside a pin that already has one open — an explicit BEGIN/
-- COMMIT in that second case would either warn on the nested BEGIN or, worse,
-- COMMIT the pin's own transaction early and defeat "ends in ROLLBACK".

CREATE OR REPLACE FUNCTION pg_temp.demo_id(p_key text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT ('de30da7a-5eed-4' || substr(h, 1, 3) || '-8' || substr(h, 4, 3) || '-' || substr(h, 7, 12))::uuid
    FROM (SELECT md5('akademi-perdana:hosted-demo:sales-directory:' || p_key) AS h) AS k;
$fn$;

DELETE FROM core.organisation_suggestions
 WHERE id IN (pg_temp.demo_id('sug:aurora'), pg_temp.demo_id('sug:kenanga'), pg_temp.demo_id('sug:meridian'));

DELETE FROM core.opportunities WHERE id = pg_temp.demo_id('opp:auroratl');

DELETE FROM core.contacts WHERE id = pg_temp.demo_id('con:auroratl');
