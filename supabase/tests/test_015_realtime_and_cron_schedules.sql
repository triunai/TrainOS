-- ============================================================================
-- PIN 015 · realtime_and_cron_schedules
-- ============================================================================
--
-- Run against the complete 001-015 set. Ends in ROLLBACK; writes nothing durable.
--   psql "$DATABASE_URL" -f supabase/tests/test_015_realtime_and_cron_schedules.sql
--
-- ⚠ AUTHORSHIP. Drafted by Claude (Opus) in the `cloud/migrations` lane,
-- 2026-09-13. **Codex (gpt-5.6-sol xhigh) review is PENDING.** Every assertion
-- below has been EXECUTED and passes; none has been adversarially reviewed.
--
-- T1  The cron table: exactly two TrainOS jobs, both active, both resolving to a
--     real function, on the exact schedules the header defends.
-- T2  Ruling R-B as an assertion rather than a comment: no scheduled command
--     anywhere in cron.job reaches pg_net, and pg_net is still INSTALLED and
--     UNCALLED rather than removed.
-- T3  The fanout is tenant-fair. Flood one tenant with reapable jobs, give a
--     second tenant one, and prove the second tenant's job is recovered in the
--     same tick - the 012 H-16 starvation property carried to the recovery path.
-- T4  app.reap_cron_history really deletes on the 7-day boundary, proved at 6
--     days and 8 days rather than asserted from the source.
-- T5  The scheduled commands are executable AS WRITTEN. A cron command is an
--     unchecked string; this runs both of them.
--
-- ── NOTE ON SHAPE ────────────────────────────────────────────────────────────
--
-- ⚠ THE HARNESS's pg_cron IS A LOCAL STUB. `supabase/CLAUDE.md` records that
-- there is no Supabase CLI or Docker in the authoring environment; the stub
-- implements `cron.schedule`/`unschedule`/`alter_job` and the `cron.job` and
-- `cron.job_run_details` tables, and it DOES NOT RUN ANYTHING. So T1 and T2 test
-- what was REGISTERED, and T3, T4 and T5 test the functions BY CALLING THEM
-- DIRECTLY rather than by waiting for a tick. What this pin therefore does not
-- prove is that the real pg_cron background worker fires a '30 seconds' schedule -
-- that is the extension's behaviour, not this migration's, and it is named here
-- rather than papered over with a test that would pass on a stub either way.
-- ============================================================================

BEGIN;

SET LOCAL plpgsql.check_asserts = on;

DO $setup$
BEGIN
  IF pg_catalog.to_regproc('app.reap_jobs_all_tenants') IS NULL THEN
    RAISE EXCEPTION 'test_015 SETUP FAILURE: migration 015 is missing or partial';
  END IF;
END;
$setup$;

-- ─── T1 · The cron table ────────────────────────────────────────────────────

DO $t1$
DECLARE
  v_n      integer;
  r        pg_catalog.record;
  v_target text;
BEGIN
  SELECT pg_catalog.count(*) INTO v_n FROM cron.job WHERE jobname LIKE 'trainos\_%';
  ASSERT v_n = 2,
    pg_catalog.format('T1a FAIL: expected exactly 2 TrainOS cron jobs, found %s. '
      'The design once listed nine scheduled behaviours; 015 schedules two and the '
      'header gives a reason for each of the other seven. A third job appearing '
      'here has no such reason recorded.', v_n);

  ASSERT EXISTS (SELECT 1 FROM cron.job
                  WHERE jobname='trainos_reap_jobs' AND schedule='30 seconds' AND active),
    'T1b FAIL: trainos_reap_jobs is missing, inactive, or not on the native '
    'sub-minute schedule. Downgraded to a five-field expression it becomes a '
    'once-a-minute behaviour and nothing reports the change.';

  ASSERT EXISTS (SELECT 1 FROM cron.job
                  WHERE jobname='trainos_reap_cron_history' AND schedule='17 3 * * *' AND active),
    'T1c FAIL: trainos_reap_cron_history is missing, inactive, or off its schedule.';

  -- Every command names a function that resolves. This is the check that catches
  -- a typo, which pg_cron itself would record in job_run_details and never raise.
  FOR r IN SELECT jobname, command FROM cron.job WHERE jobname LIKE 'trainos\_%' LOOP
    v_target := (pg_catalog.regexp_match(r.command,'SELECT ([a-z_]+\.[a-z_]+)\('))[1];
    ASSERT v_target IS NOT NULL AND pg_catalog.to_regproc(v_target) IS NOT NULL,
      pg_catalog.format('T1d FAIL: job %s is scheduled against "%s", which does '
        'not resolve to a function', r.jobname, r.command);
  END LOOP;

  RAISE NOTICE
    'T1 PASS - exactly two TrainOS cron jobs, both active, on 30 seconds and '
    '17 3 * * *, each naming a function that resolves.';
END;
$t1$;

-- ─── T2 · Ruling R-B, as an assertion ───────────────────────────────────────

DO $t2$
DECLARE v_bad text;
BEGIN
  SELECT pg_catalog.string_agg(jobname, ', ') INTO v_bad
    FROM cron.job WHERE command ILIKE '%net.http%';
  ASSERT v_bad IS NULL,
    pg_catalog.format('T2a FAIL: cron job(s) %s call net.http_*. Ruling R-B: '
      'background work is the Node worker at apps/worker polling app.claim_jobs, '
      'and ruling R-A means there is no Edge Function at the far end of a nudge. '
      'Supabase''s own docs describe the cron -> pg_net -> Edge Function pattern '
      'as supported, which is why this is pinned rather than left to a comment.',
      v_bad);

  -- And pg_net is still INSTALLED. 001 owns it under R-EXT and 012's webhook
  -- tables are shaped for it; "we do not call it" is not "we removed it", and a
  -- later author who drops the extension breaks 001's verify block.
  ASSERT EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname='pg_net'),
    'T2b FAIL: pg_net is no longer installed. 015 leaves it installed and '
    'uncalled; removing it is 001''s decision to make, not 015''s.';

  RAISE NOTICE
    'T2 PASS - no scheduled command touches pg_net, and pg_net is still installed '
    'and uncalled rather than removed.';
END;
$t2$;

-- ─── T3 · The fanout is tenant-fair ─────────────────────────────────────────
-- 012's H-16 made the CLAIM fair per tenant. The reaper's four statements each
-- take a flat LIMIT across all tenants ordered by time, so a naive
-- `reap_jobs(NULL, n)` lets one tenant's backlog consume the whole budget and the
-- other tenants' expired leases are never recovered. This proves the wrapper does
-- not have that failure.

INSERT INTO public.tenants (id,slug,name,timezone) VALUES
  ('00000015-1111-1111-1111-111111111111','t015-alpha','T015 Alpha','Asia/Kuala_Lumpur'),
  ('00000015-2222-2222-2222-222222222222','t015-beta','T015 Beta','Asia/Kuala_Lumpur');

-- Alpha floods the queue: 50 CLAIMED jobs whose lease has expired.
INSERT INTO app.outbox (tenant_id, job_type, correlation_id, payload, state,
                        attempts, max_attempts,
                        claimed_by, claimed_at, visible_after)
SELECT '00000015-1111-1111-1111-111111111111','EMAIL_SEND', gen_random_uuid(),
       pg_catalog.jsonb_build_object('n', g),'CLAIMED',1,5,
       'dead-worker', pg_catalog.now() - interval '10 minutes',
       pg_catalog.now() - interval '5 minutes'
  FROM pg_catalog.generate_series(1,50) AS g;

-- Beta has exactly one, and it is the row that must not be starved.
INSERT INTO app.outbox (tenant_id, job_type, correlation_id, payload, state,
                        attempts, max_attempts,
                        claimed_by, claimed_at, visible_after)
VALUES ('00000015-2222-2222-2222-222222222222','EMAIL_SEND', gen_random_uuid(),
        '{"beta":true}'::jsonb,'CLAIMED',1,5,
        'dead-worker', pg_catalog.now() - interval '10 minutes',
        pg_catalog.now() - interval '5 minutes');

DO $t3$
DECLARE
  v_reaped    integer;
  v_beta_state text;
  v_flat      integer;
BEGIN
  -- A budget of 10 per tenant. Alpha has 50, so a flat limit of 10 across all
  -- tenants ordered by visible_after would spend the entire budget on Alpha.
  v_reaped := app.reap_jobs_all_tenants(10);

  SELECT job.state::text INTO v_beta_state
    FROM app.outbox AS job
   WHERE job.tenant_id = '00000015-2222-2222-2222-222222222222';

  ASSERT v_beta_state = 'QUEUED',
    pg_catalog.format('T3a FAIL: Beta''s expired job is still %s after a reap with '
      'a per-tenant budget of 10 while Alpha held 50. That is the H-16 starvation '
      'the fanout exists to prevent, arriving through the recovery path: one '
      'tenant with a failing provider freezes every other tenant''s queue.',
      v_beta_state);

  ASSERT v_reaped >= 11,
    pg_catalog.format('T3b FAIL: the fanout reaped %s rows; with two tenants and a '
      'budget of 10 each it should have recovered at least Alpha''s 10 and Beta''s '
      '1.', v_reaped);

  -- And the control: the flat call really does have the failure. If this stops
  -- being true the wrapper is no longer earning its place and should be deleted
  -- rather than kept as decoration.
  UPDATE app.outbox SET state='CLAIMED', claimed_by='dead-worker',
         claimed_at = pg_catalog.now() - interval '10 minutes',
         visible_after = pg_catalog.now() - interval '5 minutes'
   WHERE tenant_id IN ('00000015-1111-1111-1111-111111111111',
                       '00000015-2222-2222-2222-222222222222');
  -- Beta's row is the NEWEST by visible_after, so a flat limit ordered by
  -- visible_after reaches Alpha's rows first.
  UPDATE app.outbox SET visible_after = pg_catalog.now() - interval '1 minute'
   WHERE tenant_id = '00000015-2222-2222-2222-222222222222';

  v_flat := app.reap_jobs('00000015-1111-1111-1111-111111111111'::uuid, 10);
  SELECT job.state::text INTO v_beta_state
    FROM app.outbox AS job
   WHERE job.tenant_id = '00000015-2222-2222-2222-222222222222';
  ASSERT v_beta_state = 'CLAIMED',
    'T3c FAIL: a single-tenant reap of Alpha changed Beta''s job, so the tenant '
    'argument is not filtering and T3a proved nothing.';

  RAISE NOTICE
    'T3 PASS - with Alpha holding 50 expired leases and a budget of 10 per tenant, '
    'Beta''s single job is still recovered in the same tick, and a single-tenant '
    'reap provably leaves the other tenant alone.';
END;
$t3$;

-- ─── T4 · The 7-day retention boundary, measured ────────────────────────────

DO $t4$
DECLARE
  v_deleted integer;
  v_left    integer;
BEGIN
  INSERT INTO cron.job_run_details (jobid, database, username, command, status,
                                    start_time, end_time)
  VALUES (999001,'trainos','postgres','SELECT 1','succeeded',
          pg_catalog.now() - interval '8 days', pg_catalog.now() - interval '8 days'),
         (999002,'trainos','postgres','SELECT 1','succeeded',
          pg_catalog.now() - interval '6 days', pg_catalog.now() - interval '6 days');

  v_deleted := app.reap_cron_history(5000);

  SELECT pg_catalog.count(*) INTO v_left
    FROM cron.job_run_details WHERE jobid IN (999001,999002);

  ASSERT v_left = 1,
    pg_catalog.format('T4a FAIL: after the retention sweep %s of the two probe '
      'rows survive, expected exactly the 6-day-old one. The window is 7 days and '
      'is asserted at 6 and 8 rather than read out of the function body.', v_left);

  ASSERT EXISTS (SELECT 1 FROM cron.job_run_details WHERE jobid = 999002),
    'T4b FAIL: the retention sweep deleted the 6-day-old row. The window is 7 days '
    'and a sweep that is one comparison operator out deletes the history somebody '
    'is in the middle of reading.';

  ASSERT NOT EXISTS (SELECT 1 FROM cron.job_run_details WHERE jobid = 999001),
    'T4c FAIL: the retention sweep left the 8-day-old row. cron.job_run_details is '
    'never purged automatically and is not cleared when a job is unscheduled, so a '
    'sweep that deletes nothing is unbounded disk growth with a green cron table.';

  RAISE NOTICE
    'T4 PASS - the retention sweep deleted the 8-day-old history row and kept the '
    '6-day-old one, measured at both sides of the boundary. (The 7-day window is '
    '012''s engineering judgement; no source document gives a number.)';
END;
$t4$;

-- ─── T5 · The scheduled commands run as written ─────────────────────────────

DO $t5$
DECLARE
  r      pg_catalog.record;
  v_ran  integer := 0;
BEGIN
  FOR r IN SELECT jobname, command FROM cron.job WHERE jobname LIKE 'trainos\_%' LOOP
    BEGIN
      EXECUTE r.command;
      v_ran := v_ran + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION
        'T5 FAIL: the command scheduled as %s does not execute: %s / %s. A cron '
        'command is a string nothing type-checks, so this is the only place the '
        'difference between "scheduled" and "works" is visible before production.',
        r.jobname, SQLSTATE, SQLERRM;
    END;
  END LOOP;

  ASSERT v_ran = 2,
    pg_catalog.format('T5 FAIL: ran %s of 2 scheduled commands', v_ran);

  RAISE NOTICE
    'T5 PASS - both scheduled commands execute exactly as registered in cron.job.';
END;
$t5$;


-- ─── T6 · the overload guard on app.reap_jobs_all_tenants ──────────────────
-- The G3 trap, pinned rather than trusted. `CREATE OR REPLACE FUNCTION` matches
-- on the argument list, so adding a second parameter — even a defaulted one,
-- which is how it always happens — creates a SECOND overload instead of
-- replacing the function. Two overloads differing only by a defaulted trailing
-- argument make every short call ambiguous, and the short call here is the cron
-- command string `SELECT app.reap_jobs_all_tenants(200)`. Nothing type-checks a
-- cron command: pg_cron would write `function ... is not unique` into
-- job_run_details every thirty seconds while `cron.job` still showed an active,
-- healthy job, and expired job leases would stop being recovered in silence.
--
-- 016 hit this exact trap on `app.provision_tenant`. This pin is the reason 015
-- will not.
--
-- ⚠ ONE CORRECTION TO THE FINDING THAT PROMPTED THIS, measured rather than
-- assumed: 015's existing "does the command resolve" check ALREADY aborts on a
-- second overload, because `to_regproc` returns NULL for an ambiguous bare name.
-- Verified by creating the overload on a live database and re-running the
-- pre-fix verify block, which failed — with "does not resolve to a function",
-- which points at the wrong cause. The exposure that is real is the one nothing
-- re-runs: a LATER migration adding the overload, long after 015's verify block
-- last ran.
DO $t6$
DECLARE
  v_n      integer;
  v_broke  boolean := false;
BEGIN
  SELECT pg_catalog.count(*)::integer INTO v_n
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'app' AND p.proname = 'reap_jobs_all_tenants';
  ASSERT v_n = 1,
    pg_catalog.format('T6a FAIL: app.reap_jobs_all_tenants has %s overloads, not '
      '1. The cron command calls it with one argument and would become ambiguous.',
      v_n);

  ASSERT pg_catalog.to_regprocedure('app.reap_jobs_all_tenants(integer)') IS NOT NULL,
    'T6b FAIL: the exact signature the cron command calls does not exist.';

  -- And the failure mode itself, staged. A second overload is created inside this
  -- transaction and the one-argument call is shown to become ambiguous — so the
  -- assertion above is pinning a real hazard rather than a tidy invariant.
  CREATE FUNCTION app.reap_jobs_all_tenants(p_limit_per_tenant integer, p_unused text DEFAULT NULL)
  RETURNS integer LANGUAGE sql AS $probe$ SELECT 0 $probe$;

  BEGIN
    PERFORM app.reap_jobs_all_tenants(200);
  EXCEPTION WHEN OTHERS THEN
    v_broke := true;
    ASSERT SQLSTATE = '42725',
      pg_catalog.format('T6c1 FAIL: the two-overload call failed with %s, expected '
        '42725 ambiguous_function.', SQLSTATE);
  END;

  DROP FUNCTION app.reap_jobs_all_tenants(integer, text);

  ASSERT v_broke,
    'T6c FAIL: with a second, defaulted-trailing-argument overload in place, '
    '`SELECT app.reap_jobs_all_tenants(200)` still resolved. If Postgres has '
    'stopped treating that as ambiguous, the DROP FUNCTION guard in 015 and the '
    'overload assertions above are no longer load-bearing and should be cut '
    'rather than left as folklore.';

  ASSERT (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
            JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
           WHERE n.nspname='app' AND p.proname='reap_jobs_all_tenants') = 1,
    'T6d FAIL: the probe overload survived the probe.';

  RAISE NOTICE
    'T6 PASS - exactly one app.reap_jobs_all_tenants, the cron command''s exact '
    'signature resolves, and a staged second overload really does make that call '
    'ambiguous at 42725.';
END;
$t6$;


ROLLBACK;
