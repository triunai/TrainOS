-- ============================================================================
-- ROLLBACK 015 · realtime_and_cron_schedules
-- ============================================================================
--
-- Restores the state 014 left: no TrainOS cron job, and no fanout wrapper.
--
-- DROP ORDER, reverse of the forward order:
--   1. the two schedules   (unscheduled BEFORE the function they call is dropped,
--                           or there is a window in which an active job points at
--                           a function that no longer exists)
--   2. the fanout function
--
-- ⚠ `cron.job_run_details` ROWS ARE NOT DELETED BY THIS ROLLBACK, and that is a
-- decision. Unscheduling a job does not clear its history — the research records
-- that explicitly, and it is the property that made the retention job necessary in
-- the first place. Those rows are the evidence of what ran and when. A rollback
-- that swept them would destroy the audit trail of the very jobs it is removing,
-- at exactly the moment somebody is most likely to want it. `app.reap_cron_history`
-- (012) will age them out on its own window if the jobs are ever rescheduled, and
-- a one-off `SELECT app.reap_cron_history(…)` clears them by hand otherwise.
--
-- Re-runnable: `cron.unschedule` is called only for a job that is present, so a
-- second run reports nothing rather than raising on a missing job name.
-- ============================================================================

BEGIN;

DO $preflight$
BEGIN
  IF pg_catalog.to_regclass('cron.job') IS NULL THEN
    RAISE EXCEPTION
      'ROLLBACK 015 refused: cron.job is absent. pg_cron has been removed from '
      'under this migration, so there is nothing to unschedule and a "successful" '
      'rollback here would be a report about a database nobody is looking at.';
  END IF;
END;
$preflight$;

-- ── 1 · The two schedules ───────────────────────────────────────────────────
DO $unschedule$
DECLARE
  r       pg_catalog.record;
  v_count integer := 0;
BEGIN
  FOR r IN SELECT jobname FROM cron.job
            WHERE jobname IN ('trainos_reap_jobs','trainos_reap_cron_history')
  LOOP
    PERFORM cron.unschedule(r.jobname);
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'ROLLBACK 015: unscheduled % job(s)', v_count;
END;
$unschedule$;

-- ── 2 · The fanout function ─────────────────────────────────────────────────
DROP FUNCTION IF EXISTS app.reap_jobs_all_tenants(integer);

-- ── POST-CONDITIONS ─────────────────────────────────────────────────────────
DO $verify$
DECLARE v_n integer;
BEGIN
  SELECT pg_catalog.count(*) INTO v_n FROM cron.job WHERE jobname LIKE 'trainos\_%';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'ROLLBACK 015 incomplete: % trainos cron job(s) survive', v_n;
  END IF;

  IF pg_catalog.to_regproc('app.reap_jobs_all_tenants') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK 015 incomplete: app.reap_jobs_all_tenants survives';
  END IF;

  -- 012's reapers are NOT 015's to remove. 015 scheduled them; it did not write
  -- them, and a rollback that took them would leave 012 half-applied.
  IF pg_catalog.to_regprocedure('app.reap_jobs(uuid,integer)') IS NULL
     OR pg_catalog.to_regprocedure('app.reap_cron_history(integer)') IS NULL THEN
    RAISE EXCEPTION
      'ROLLBACK 015 DESTROYED a 012 function. 015 owns the SCHEDULES, never the '
      'reapers they call.';
  END IF;

  RAISE NOTICE 'ROLLBACK 015: OK - no trainos cron job, 012''s reapers intact';
END;
$verify$;

COMMIT;
