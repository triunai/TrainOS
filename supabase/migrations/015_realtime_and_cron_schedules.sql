-- ============================================================================
-- Migration 015: the scheduler. Two pg_cron jobs, and the eight the design once
-- listed that are deliberately not here.
-- ============================================================================
--
-- FEATURE. 001 installs pg_cron under ruling R-EXT and its header says why: "Nine
-- scheduled behaviours in the design (retention reaper, outbox drain, job reaper,
-- levy staleness sweep, embedding refresh and the rest) are scheduled with
-- cron.schedule in 015. Without this extension every one of them is dead code that
-- no error reports." This is 015, and it schedules **two** of the nine.
--
-- That gap is the whole content of this migration and it is a decision, not an
-- omission. Ruling R-B, from the user and confirmed by the showroom precedent:
--
--   **Background work is one Node worker** (`apps/worker`, merged on main, PR #2)
--   polling `app.claim_jobs`. **pg_cron is for `reap_jobs` and cron-history
--   retention only. There are no pg_net nudges.**
--
-- ⚠ THIS CONTRADICTS THE CURRENT SUPABASE DOCUMENTATION, AND THE CONTRADICTION IS
-- DELIBERATE. `docs/research/2026-09-13-supabase-current-docs.md` §4 records that
-- Supabase's own guide documents the opposite pattern as supported and safe —
-- "`cron.schedule` → `net.http_post` → Edge Function with the URL and key read
-- from Vault… and confirms requests do not start until the transaction commits,
-- which is what makes doc 05 D5's nudge safe." That research is correct and is not
-- being overruled on technical grounds. It is being overruled on a product
-- ruling: **R-A says this product has no Edge Functions at all**, so the far end
-- of that nudge does not exist. A supported pattern pointing at nothing is still
-- pointing at nothing. Recorded here in full because the next author will read the
-- same Supabase page and wonder why this file ignores it.
--
-- What that buys, concretely: nothing in this database makes an outbound HTTP
-- request. `pg_net` stays installed (001 owns it, ruling R-EXT, and 012's
-- webhook tables are shaped for it) and stays uncalled. The research's own list of
-- pg_net limits — beta with "signatures may change", ~200 requests/second, a
-- `timeout_milliseconds` that defaults to 2000, an UNLOGGED queue with a 6-hour
-- response TTL — is a list of things this product now does not have to reason
-- about, and that is the second reason the ruling is a good one.
--
-- OBJECTS. Two cron jobs. No table, no view, no type, no trigger, no policy, and
-- exactly one function — the tenant-fanout wrapper the job reaper needs, because
-- `app.reap_jobs` takes a tenant and a cron tick does not have one.
--
-- ── THE TWO JOBS, AND WHY EACH EXISTS ───────────────────────────────────────
--
--   `trainos_reap_jobs`          every 30 seconds
--
--     Returns jobs whose lease expired to QUEUED, moves FAILED jobs whose backoff
--     has elapsed back to QUEUED, and DEAD-LETTERS anything that has reached
--     max_attempts. That last clause is `C-08`, the poison pill: without the
--     reaper, a handler that OOMs the isolate mid-job leaves the job CLAIMED
--     forever, and the invoice it was pushing is never pushed by anybody. The
--     worker cannot do this for itself — a worker that has died is exactly the
--     condition being recovered from.
--
--     **Sub-minute is native and this is one job, not a staggered set.** The
--     research records it: "sub-minute schedules are native on Postgres 15.1.1.61+
--     using `'30 seconds'` syntax, so doc 05's 10-second tick is one job, not a
--     staggered set." Before that landed, the standard trick was six jobs at
--     `* * * * *` each sleeping a different multiple of ten seconds, which burns
--     six connections to do one job's work and drifts. 30 seconds rather than
--     doc 05's 10: the worker's own poll loop is the latency path, and the reaper
--     is the recovery path. A recovery sweep three times a minute is not slower in
--     any way a user experiences, and it is a third of the wakeups.
--
--   `trainos_reap_cron_history`  daily at 03:17 UTC
--
--     **`cron.job_run_details` is never purged automatically and is not cleared
--     when a job is unscheduled** — the research states both halves, and the
--     second is the one that surprises people: unscheduling the job that made the
--     rows does not remove the rows. At the 30-second tick above, the reaper alone
--     writes ~1.05M history rows a year, of pure disk growth, on a table nothing
--     reads after the first few days.
--
--     **The retention window is 7 days, and it was not chosen here.** It is
--     already compiled into `app.reap_cron_history` (012), which deletes where
--     `COALESCE(end_time, start_time) < now() - interval '7 days'`. ⚠ **No source
--     document gives a number.** The research doc that raised the growth problem
--     prescribes "add a retention job" and no window; doc 05 §5.5 says the table
--     grows without bound and stops there. 7 days is 012's engineering judgement,
--     inherited rather than re-litigated, and it is stated as unsourced here so
--     that nobody later cites this file as the authority for it. It is long enough
--     to debug a failure over a weekend and short enough to bound the table at
--     roughly 20,000 rows.
--
--     03:17 rather than 03:00: a cron table where everything fires on the hour is
--     a thundering herd against whatever else the platform schedules there, and
--     the minute is free.
--
-- ── WHAT IS DELIBERATELY NOT SCHEDULED, WITH THE REASON FOR EACH ─────────────
--
--   the outbox drain          R-B. The Node worker polls `app.claim_jobs`. A cron
--                             drain would be a SECOND consumer racing the worker
--                             for the same rows — survivable, because the claim is
--                             `FOR UPDATE SKIP LOCKED`, but it would make "which
--                             process ran this job" unanswerable from the row.
--   the webhook dispatcher    R-B, and it is the pg_net path specifically.
--   `reap_outbox`,            Retention sweeps over business-visible rows. Each
--   `reap_dead_letters`,      needs a retention PERIOD agreed with the customer
--   `reap_webhook_bodies`,    before it deletes anything — 017 creates
--   `reap_webhook_deliveries` `core.data_retention_policies` for exactly that, and
--                             scheduling them first would be deleting on a window
--                             nobody signed off. The functions exist (012) and are
--                             callable by hand. **Owner: after 017's policy rows
--                             exist and are approved.**
--   the levy staleness sweep  No function exists to schedule. 009 models levy
--                             statements; nothing computes staleness yet.
--   the embedding refresh     No function exists to schedule.
--
-- Scheduling a job whose function does not exist is worse than not scheduling it:
-- pg_cron records the failure in `job_run_details` and nothing raises, so it is a
-- broken behaviour with a green-looking cron table. §3 verifies that both jobs
-- this file creates name a function that actually resolves.
--
-- ── REALTIME ────────────────────────────────────────────────────────────────
--
-- ⚠ NOTHING IS DONE TO REALTIME HERE, AND THAT IS NOT THE SAME AS FORGETTING IT.
-- The pack's title in the plan is "realtime and cron". The research (§7) is
-- unambiguous about what the database half of Realtime looks like on Supabase
-- today: **RLS on `realtime.messages` is already enabled and the schema is locked**
-- — policies are the only lever, `realtime.send` and `realtime.broadcast_changes`
-- run as the admin role and therefore bypass an INSERT deny, and clients must pass
-- `{ config: { private: true } }`.
--
-- Every one of those is either already true or is a CLIENT configuration. The two
-- things a migration could add are a policy on `realtime.messages` and a publication
-- membership, and both are blocked on a fact this lane does not have: **which
-- topics this product broadcasts.** No code publishes a realtime message today —
-- the worker is a poller, and `apps/web` subscribes to nothing. Writing a policy
-- over `(select realtime.topic())` now would mean inventing the topic vocabulary in
-- a cron migration, which is the same defect as a hardcoded stage list: a naming
-- decision smuggled into SQL where nobody will look for it.
--
-- One consequence worth carrying forward, because it is a security property and
-- not a preference: **"Policies are cached for the life of the connection,
-- recomputed only on connect or on a new `access_token` message, so a revoked
-- permission does not bite a live socket."** When Realtime does land, revoking a
-- user's access will NOT close their open subscription, and the design has to
-- disconnect them explicitly. Recorded here so that it is in the migration history
-- rather than only in a research document.
--
-- ── SPINE ───────────────────────────────────────────────────────────────────
--
-- Spine untouched. 015 adds no action type and no branch to the envelope; the job
-- reaper operates on `app.outbox`, which is the envelope's external-effect queue
-- and not the envelope. No stage name appears in this file.
-- ============================================================================

BEGIN;

-- ── PRE-FLIGHT ──────────────────────────────────────────────────────────────

DO $preflight$
BEGIN
  IF pg_catalog.to_regclass('cron.job') IS NULL THEN
    RAISE EXCEPTION
      '015 preflight: cron.job is absent, so pg_cron is not installed. 001 '
      'installs it under ruling R-EXT; scheduling against a missing extension '
      'would succeed at nothing.';
  END IF;
  IF pg_catalog.to_regprocedure('cron.schedule(text,text,text)') IS NULL THEN
    RAISE EXCEPTION
      '015 preflight: cron.schedule(text,text,text) is absent. The two-argument '
      'form exists on some builds and generates a job NAME from a hash, which '
      'this migration cannot then find to make itself re-runnable.';
  END IF;
  IF pg_catalog.to_regprocedure('app.reap_jobs(uuid,integer)') IS NULL THEN
    RAISE EXCEPTION '015 preflight: app.reap_jobs/2 is absent; 012 has not been applied';
  END IF;
  IF pg_catalog.to_regprocedure('app.reap_cron_history(integer)') IS NULL THEN
    RAISE EXCEPTION '015 preflight: app.reap_cron_history/1 is absent; 012 has not been applied';
  END IF;
END;
$preflight$;

-- ============================================================================
-- §1 · The tenant fanout the job reaper needs
-- ============================================================================
-- `app.reap_jobs(p_tenant_id, p_limit)` takes a tenant, and a cron tick does not
-- have one. Passing NULL already means "every tenant" inside 012's body, so the
-- obvious schedule is `SELECT app.reap_jobs(NULL, 1000)`.
--
-- That is not what this schedules, and the reason is 012's own `H-16`: the claim
-- is fair per tenant because it partitions by `tenant_id`, but the REAPER's four
-- statements each take a flat `LIMIT p_limit` across all tenants ordered by time.
-- One tenant whose provider is down can fill that limit every tick, and the other
-- tenants' expired leases are never recovered — the same starvation `H-16` fixed
-- on the claim side, arriving through the recovery path instead.
--
-- The wrapper gives each tenant its own budget. It is a function rather than SQL
-- inlined into the cron command because a cron command is a string that nothing
-- type-checks: a typo there is discovered in `job_run_details` days later, and a
-- function is resolved at CREATE time and asserted by §3.

-- ⚠ DROP THE OLD SIGNATURE BEFORE CREATING THIS ONE, and keep doing it.
-- `CREATE OR REPLACE FUNCTION` matches on the ARGUMENT LIST, so the day somebody
-- adds a second parameter here — even a defaulted one, which is how it always
-- happens — they get a SECOND OVERLOAD rather than a replacement, and two
-- overloads differing only by a defaulted trailing argument make the one-argument
-- call ambiguous. That call is the cron command string
-- `SELECT app.reap_jobs_all_tenants(200)`, which nothing type-checks: pg_cron
-- would record `function app.reap_jobs_all_tenants(integer) is not unique` in
-- job_run_details every thirty seconds while `cron.job` still listed a healthy,
-- active job. Expired leases would stop being recovered and nothing would say so.
--
-- 016 hit exactly this trap on `app.provision_tenant` and fixed it the same way.
-- The DROP is written for the CURRENT signature too, so it stays correct when the
-- signature changes: whoever edits the parameter list edits the line above it.
DROP FUNCTION IF EXISTS app.reap_jobs_all_tenants(integer);

CREATE OR REPLACE FUNCTION app.reap_jobs_all_tenants(p_limit_per_tenant integer DEFAULT 200)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_tenant uuid;
  v_total  integer := 0;
BEGIN
  IF p_limit_per_tenant IS NULL OR p_limit_per_tenant < 1 THEN
    RAISE EXCEPTION 'reap_jobs_all_tenants: p_limit_per_tenant must be >= 1'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Driven from the tenants that actually have reapable work, not from
  -- public.tenants. A deployment with 200 tenants and 3 active ones should do
  -- three tenants' worth of work per tick, not 200 no-op round trips.
  FOR v_tenant IN
    SELECT DISTINCT job.tenant_id
      FROM app.outbox AS job
     WHERE job.state IN ('CLAIMED','FAILED')
  LOOP
    v_total := v_total + app.reap_jobs(v_tenant, p_limit_per_tenant);
  END LOOP;

  RETURN v_total;
END;
$fn$;

REVOKE ALL ON FUNCTION app.reap_jobs_all_tenants(integer) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION app.reap_jobs_all_tenants(integer) IS
  'Cron entry point for the job reaper. Calls app.reap_jobs once per tenant that '
  'has CLAIMED or FAILED work, so one tenant with a failing provider cannot '
  'consume the whole reap budget and starve every other tenant''s expired leases '
  '- the tenant-fairness property 012 H-16 established on the claim side, carried '
  'to the recovery side. 015.';

-- ============================================================================
-- §2 · The two schedules
-- ============================================================================
-- `cron.schedule(name, schedule, command)` UPSERTS on the job name, so this
-- migration is re-runnable as written. Job names are case-sensitive and immutable
-- once created; these two are prefixed `trainos_` so that a shared cluster's cron
-- table says at a glance which jobs are ours.

SELECT cron.schedule(
  'trainos_reap_jobs',
  '30 seconds',
  $cmd$SELECT app.reap_jobs_all_tenants(200)$cmd$);

SELECT cron.schedule(
  'trainos_reap_cron_history',
  '17 3 * * *',
  $cmd$SELECT app.reap_cron_history(5000)$cmd$);

-- ============================================================================
-- §3 · Verify
-- ============================================================================

DO $verify$
DECLARE
  r        pg_catalog.record;
  v_n      integer;
  v_target text;
BEGIN
  SELECT pg_catalog.count(*) INTO v_n
    FROM cron.job WHERE jobname LIKE 'trainos\_%';
  IF v_n <> 2 THEN
    RAISE EXCEPTION '015 verify: expected exactly 2 trainos cron jobs, found %', v_n;
  END IF;

  -- Every scheduled command must name a function that RESOLVES. A cron command is
  -- an unchecked string: schedule a typo and pg_cron records the failure in
  -- job_run_details forever while the cron table looks healthy.
  FOR r IN SELECT jobname, command, schedule, active FROM cron.job WHERE jobname LIKE 'trainos\_%'
  LOOP
    IF NOT r.active THEN
      RAISE EXCEPTION '015 verify: job % was created inactive', r.jobname;
    END IF;

    v_target := (pg_catalog.regexp_match(r.command, 'SELECT ([a-z_]+\.[a-z_]+)\('))[1];
    IF v_target IS NULL THEN
      RAISE EXCEPTION
        '015 verify: cannot identify the function in job % command "%"', r.jobname, r.command;
    END IF;
    IF pg_catalog.to_regproc(v_target) IS NULL THEN
      RAISE EXCEPTION
        '015 verify: job % is scheduled against %, which does not resolve to a '
        'function. pg_cron would record this in job_run_details and raise nothing.',
        r.jobname, v_target;
    END IF;
  END LOOP;

  -- R-B, asserted rather than asserted-in-a-comment: no scheduled command reaches
  -- pg_net. This is the line that would have to change for an Edge Function nudge
  -- to come back, and it should be hard to change by accident.
  IF EXISTS (SELECT 1 FROM cron.job WHERE command ILIKE '%net.http%') THEN
    RAISE EXCEPTION
      '015 verify: a cron job calls net.http_*. Ruling R-B: background work is the '
      'Node worker at apps/worker polling app.claim_jobs, and ruling R-A means '
      'there is no Edge Function at the far end of a nudge.';
  END IF;

  -- The sub-minute schedule is really sub-minute. A silent downgrade to a
  -- five-field cron expression would make the poison-pill recovery a once-a-minute
  -- behaviour and nothing would report it.
  IF NOT EXISTS (SELECT 1 FROM cron.job
                  WHERE jobname = 'trainos_reap_jobs' AND schedule = '30 seconds') THEN
    RAISE EXCEPTION
      '015 verify: trainos_reap_jobs is not on the native sub-minute schedule';
  END IF;

  -- EXACTLY ONE OVERLOAD, asserted directly.
  --
  -- ⚠ MEASURED, BECAUSE THE OBVIOUS CLAIM ABOUT THIS IS WRONG. A review recorded
  -- this pack as having no overload guard and the trap therefore "failing
  -- invisibly with a green-looking cron table". Half true. The command check
  -- above ALREADY aborts on a second overload, by accident of `to_regproc`, which
  -- returns NULL rather than an oid when a bare name is ambiguous — verified by
  -- creating a second, defaulted-trailing-argument overload on a live database
  -- and re-running the pre-fix block, which failed. What it failed WITH was
  -- "does not resolve to a function", which sends the reader looking for a
  -- missing function rather than a duplicated one.
  --
  -- So this check earns its place on two grounds, neither of them the one the
  -- finding stated: it names the real cause, and it is the assertion a LATER
  -- migration's `CREATE OR REPLACE ... (integer, text DEFAULT NULL)` would have
  -- to survive — nothing re-runs 015's verify after 015, and at that point the
  -- cron job really does fail every thirty seconds into a table nobody reads
  -- while `cron.job` still shows it active.
  SELECT pg_catalog.count(*)::integer INTO v_n
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'app' AND p.proname = 'reap_jobs_all_tenants';
  IF v_n <> 1 THEN
    RAISE EXCEPTION
      '015 verify: app.reap_jobs_all_tenants has % overloads, not 1. The cron '
      'command calls it with one argument; two overloads differing only by a '
      'defaulted trailing parameter make that call ambiguous, and pg_cron records '
      'the failure in job_run_details while cron.job still looks healthy.', v_n;
  END IF;

  -- And the command really does resolve to THAT function, not merely to something
  -- with a resolvable name. to_regprocedure with the exact argument list fails on
  -- an arity change that to_regproc would accept.
  IF pg_catalog.to_regprocedure('app.reap_jobs_all_tenants(integer)') IS NULL THEN
    RAISE EXCEPTION
      '015 verify: app.reap_jobs_all_tenants(integer) does not exist with that '
      'exact signature, which is the one the cron command calls.';
  END IF;

  RAISE NOTICE '015 verify: OK - 2 cron jobs, both resolving, neither touching pg_net';
END;
$verify$;

COMMIT;
