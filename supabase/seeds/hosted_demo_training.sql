-- TrainOS hosted demo data — training delivery, for the EXISTING tenant `akademi-perdana`.
--
-- Run AFTER hosted_demo_akademi_perdana.sql (needs its organisations and programmes) and
-- AFTER migration 024 (needs `core.get_engagement` etc. to exist, though this file writes
-- tables directly and calls no RPC):
--   psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/seeds/hosted_demo_akademi_perdana.sql
--   psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/seeds/hosted_demo_training.sql
--
-- Remove exactly what it added:
--   psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/seeds/hosted_demo_training_wipe.sql
--
-- Pin (ends in ROLLBACK): supabase/seeds/test_hosted_demo_training.sql
--
-- Hosted-safe by construction, same rules as hosted_demo_akademi_perdana.sql:
--   * never provisions the tenant, never writes auth.users, memberships or user_profiles;
--     every owner/trainer-linked user reference is one of the three real MD ids;
--   * refs are left NULL so core.assign_ref allocates them from the tenant's own
--     sequences, same as the app would;
--   * idempotent by insert-if-absent (NOT EXISTS on a deterministic id), not upsert —
--     a re-run writes nothing and burns no refs.
--
-- ── ONE DELIBERATE DEPARTURE FROM hosted_demo_akademi_perdana.sql'S "no gated edge"
-- RULE, AND WHY. That seed never crosses a GOV-07 (011) gated edge at all. This one
-- does, exactly once per locked day: attendance_days.status OPEN -> LOCKED is gated
-- (`ATTENDANCE_APPROVE`), and the whole reason this migration's seed exists is to show
-- a LOCKED day — the one property M10-S06 is built around. The lock is walked with the
-- same `pg_temp.gate()` helper test_008/test_024 use: an EXECUTING action_request of
-- the gating type is inserted and `app.effect_applier` is set to it for the one
-- statement that locks the day, then cleared. Every OTHER status is reached over
-- 008's ungated edges (PROPOSED -> CONFIRMED -> SCHEDULED -> IN_DELIVERY -> DELIVERED
-- are all ungated per `core.state_transitions`; only DELIVERED -> CLOSED is gated, and
-- this seed does not reach CLOSED for the same reason the sales seed avoids every
-- gated status — nothing here needs an executed 011 action behind it except the lock).
--
-- Six engagements across five statuses (skipping CLOSED, which needs ENGAGEMENT_CLOSE_OUT):
-- one DELIVERED with two attendance days (day 1 LOCKED, day 2 open) and three
-- certificates, one IN_DELIVERY with one OPEN attendance day captured but not
-- approved, one SCHEDULED with sessions and a registered roster but no attendance day
-- yet, one CONFIRMED with no sessions yet, one PROPOSED, one CANCELLED. Five trainers,
-- ~34 participants total (dozens, not hundreds), trainer_bookings CONFIRMED for the
-- delivered/in-delivery engagements so `v_trainers.bookedDates`/`lastDeliveredAt` (020)
-- and `get_engagement`'s `finance.trainerPayable` (024) both have real data to show.

CREATE OR REPLACE FUNCTION pg_temp.demo_id(p_key text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $fn$
  -- SAME namespace and formula as hosted_demo_akademi_perdana.sql, deliberately: a key
  -- already used there ('org:aurora', 'prg:change', ...) resolves to the SAME id here,
  -- so this file references those rows by key rather than by a re-looked-up uuid or a
  -- second, drifting derivation. New keys below ('trn:farah', 'eng:...', ...) hash to
  -- ids nothing else has claimed.
  SELECT ('de30da7a-5eed-4' || substr(h, 1, 3) || '-8' || substr(h, 4, 3) || '-' || substr(h, 7, 12))::uuid
    FROM (SELECT md5('akademi-perdana:hosted-demo:' || p_key) AS h) AS k;
$fn$;

DROP TABLE IF EXISTS pg_temp.demo_ctx;
CREATE TEMP TABLE demo_ctx ON COMMIT DROP AS
SELECT tenant.id                                  AS t,
       'd1449fad-b732-4ee2-93c9-37f338e01358'::uuid AS u1,
       'ad615910-2d87-42a4-9855-58f52409ec6d'::uuid AS u2,
       '415dad6e-c53f-4a84-ab50-bf8e9e65223f'::uuid AS u3,
       (SELECT p.display_name FROM public.user_profiles p
         WHERE p.tenant_id = tenant.id AND p.user_id = 'd1449fad-b732-4ee2-93c9-37f338e01358') AS u1n,
       (SELECT p.display_name FROM public.user_profiles p
         WHERE p.tenant_id = tenant.id AND p.user_id = 'ad615910-2d87-42a4-9855-58f52409ec6d') AS u2n,
       (SELECT p.display_name FROM public.user_profiles p
         WHERE p.tenant_id = tenant.id AND p.user_id = '415dad6e-c53f-4a84-ab50-bf8e9e65223f') AS u3n,
       (SELECT pipeline.id FROM core.pipelines pipeline
         WHERE pipeline.tenant_id = tenant.id AND pipeline.object = 'ENGAGEMENT' AND pipeline.is_default) AS pipeline_id,
       now()                                      AS at
  FROM public.tenants AS tenant
 WHERE tenant.slug = 'akademi-perdana';

DO $pre$
DECLARE
  v_ctx demo_ctx%ROWTYPE;
BEGIN
  IF (SELECT count(*) FROM demo_ctx) <> 1 THEN
    RAISE EXCEPTION 'hosted training seed: tenant akademi-perdana not found; this seed never provisions';
  END IF;
  SELECT * INTO v_ctx FROM demo_ctx;
  IF v_ctx.u1n IS NULL OR v_ctx.u2n IS NULL OR v_ctx.u3n IS NULL THEN
    RAISE EXCEPTION 'hosted training seed: expected all three MD users with profiles';
  END IF;
  IF v_ctx.pipeline_id IS NULL THEN
    RAISE EXCEPTION 'hosted training seed: tenant has no default ENGAGEMENT pipeline (019)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM core.programmes x WHERE x.id = pg_temp.demo_id('prg:change')) THEN
    RAISE EXCEPTION 'hosted training seed: run hosted_demo_akademi_perdana.sql first (programme prg:change missing)';
  END IF;
END
$pre$;

-- GOV-07 fixture helper, same shape as test_008/test_024's pg_temp.gate/ungate.
-- OR REPLACE: this file's own pin runs it twice in one session to prove the
-- second run is a no-op, and a plain `CREATE FUNCTION` would fail the second
-- time on a `pg_temp` object that already exists in that session.
CREATE OR REPLACE FUNCTION pg_temp.gate(p_tenant uuid, p_type text, p_target uuid)
RETURNS void LANGUAGE plpgsql AS $gate$
DECLARE v_id uuid;
BEGIN
  INSERT INTO core.action_requests
    (tenant_id, action_type, target_id, status, requested_by_kind, requested_by_id)
  VALUES (p_tenant, p_type, p_target, 'EXECUTING', 'SYSTEM', 'hosted-demo-training')
  RETURNING id INTO v_id;
  PERFORM set_config('app.effect_applier', v_id::text, true);
END $gate$;

CREATE OR REPLACE FUNCTION pg_temp.ungate() RETURNS void LANGUAGE plpgsql AS $ungate$
BEGIN
  PERFORM set_config('app.effect_applier', '', true);
END $ungate$;

-- ── Trainers ─────────────────────────────────────────────────────────────────

-- 017 added `hrd_tdf_valid_to` (the HRD Corp Train-the-Trainer accreditation's own
-- expiry, distinct from `ttt_valid_to`) with `trainers_hrd_tdf_needs_expiry`:
-- `hrd_tdf = true` requires a date. 3-year validity per 017's citation.
INSERT INTO core.trainers (id, tenant_id, name, email, band, ttt_certified, ttt_ref, ttt_valid_to,
                           hrd_tdf, hrd_tdf_valid_to, rating, status, created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.demo_id(v.k), c.t, v.name, v.email, v.band::core.trainer_band, v.ttt, v.ref, v.valid,
       v.tdf, v.tdf_valid, v.rating, 'ACTIVE', c.at - interval '600 days', 'HUMAN', c.u1::text, c.u1n
  FROM demo_ctx c, (VALUES
    ('trn:farah',  'Farah Aziz',       'farah.aziz@akademiperdana.com.my',      'A', true,  'TTT-2019-4471', '2028-03-01'::date, true,  '2027-11-01'::date, 4.8),
    ('trn:daniel', 'Daniel Wong',      'daniel.wong@akademiperdana.com.my',     'A', true,  'TTT-2020-1123', '2027-06-15'::date, true,  '2027-11-01'::date, 4.6),
    ('trn:zaidi',  'Zaidi Rahman',     'zaidi.rahman@akademiperdana.com.my',    'B', true,  'TTT-2021-3390', '2029-01-20'::date, false, NULL, 4.4),
    ('trn:mei',    'Mei Ling Tan',     'mei.tan@akademiperdana.com.my',         'B', true,  'TTT-2022-0087', '2026-11-30'::date, false, NULL, 4.5),
    ('trn:hafiz',  'Hafiz Ismail',     'hafiz.ismail@akademiperdana.com.my',    'C', false, NULL, NULL, false, NULL, 4.1)
  ) AS v(k, name, email, band, ttt, ref, valid, tdf, tdf_valid, rating)
 WHERE NOT EXISTS (SELECT 1 FROM core.trainers x WHERE x.id = pg_temp.demo_id(v.k));

INSERT INTO core.programme_trainers (id, tenant_id, programme_id, trainer_id, certified_at, created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.demo_id(v.k), c.t, pg_temp.demo_id(v.prg), pg_temp.demo_id(v.trn), c.at - interval '500 days',
       c.at - interval '500 days', 'HUMAN', c.u1::text, c.u1n
  FROM demo_ctx c, (VALUES
    ('pt:change:farah',   'prg:change',   'trn:farah'),
    ('pt:change:daniel',  'prg:change',   'trn:daniel'),
    ('pt:safety:zaidi',   'prg:safety',   'trn:zaidi'),
    ('pt:safety:hafiz',   'prg:safety',   'trn:hafiz'),
    ('pt:data:mei',       'prg:data',     'trn:mei'),
    ('pt:sales:daniel',   'prg:sales',    'trn:daniel'),
    ('pt:conflict:farah', 'prg:conflict', 'trn:farah')
  ) AS v(k, prg, trn)
 WHERE NOT EXISTS (SELECT 1 FROM core.programme_trainers x WHERE x.id = pg_temp.demo_id(v.k));

-- ── Engagements ──────────────────────────────────────────────────────────────
-- k, programme key, organisation key, owner (1|2|3), title, starts_on, ends_on,
-- value_sen, venue, final status walked over ungated edges.

INSERT INTO core.engagements (id, tenant_id, organisation_id, programme_id, owner_id, pipeline_id,
                              title, venue, venue_mode, value_sen, starts_on, ends_on,
                              created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.demo_id(v.k), c.t, pg_temp.demo_id(v.org), pg_temp.demo_id(v.prg),
       CASE v.u WHEN 1 THEN c.u1 WHEN 2 THEN c.u2 ELSE c.u3 END, c.pipeline_id,
       v.title, v.venue, 'CLIENT_SITE'::core.venue_mode, v.value, v.starts, v.ends,
       c.at - v.age, 'HUMAN',
       CASE v.u WHEN 1 THEN c.u1 WHEN 2 THEN c.u2 ELSE c.u3 END::text,
       CASE v.u WHEN 1 THEN c.u1n WHEN 2 THEN c.u2n ELSE c.u3n END
  FROM demo_ctx c, (VALUES
    ('eng:change-aurora',   'prg:change',   'org:aurora',   1, 'Leading Through Change — Aurora Cohort 1', 'Aurora Plant, Shah Alam',    1850000, '2026-08-24'::date, '2026-08-25'::date, interval '30 days'),
    ('eng:safety-kenanga',  'prg:safety',   'org:kenanga',  2, 'Safety Leadership Essentials — Kenanga',   'Kenanga HQ, Kuala Lumpur',   1620000, '2026-09-14'::date, '2026-09-19'::date, interval '3 days'),
    ('eng:data-meridian',   'prg:data',     'org:meridian', 1, 'Data Literacy for Managers — Meridian',    'Meridian Ops Centre, Port Klang', 1920000, '2026-09-28'::date, '2026-09-29'::date, interval '1 days'),
    ('eng:sales-auroratl',  'prg:sales',    'org:auroratl', 3, 'Sales Excellence — Aurora Precision Tooling', 'TBD',                     2240000, NULL, NULL, interval '5 days'),
    ('eng:conflict-aurora', 'prg:conflict', 'org:aurora',   2, 'Conflict to Collaboration — Aurora Cohort 2', 'TBD',                       980000, NULL, NULL, interval '1 days'),
    ('eng:change-sutera',   'prg:change',   'org:sutera',   3, 'Leading Through Change — Sutera (cancelled)', 'TBD',                     1850000, NULL, NULL, interval '10 days')
  ) AS v(k, prg, org, u, title, venue, value, starts, ends, age)
 WHERE NOT EXISTS (SELECT 1 FROM core.engagements x WHERE x.id = pg_temp.demo_id(v.k));

-- Status walks, each over 008's ungated edges only (see header).
UPDATE core.engagements SET status = 'CONFIRMED' WHERE id = pg_temp.demo_id('eng:change-aurora') AND status = 'PROPOSED';
UPDATE core.engagements SET status = 'SCHEDULED'  WHERE id = pg_temp.demo_id('eng:change-aurora') AND status = 'CONFIRMED';
UPDATE core.engagements SET status = 'IN_DELIVERY' WHERE id = pg_temp.demo_id('eng:change-aurora') AND status = 'SCHEDULED';
UPDATE core.engagements SET status = 'DELIVERED'  WHERE id = pg_temp.demo_id('eng:change-aurora') AND status = 'IN_DELIVERY';

UPDATE core.engagements SET status = 'CONFIRMED'  WHERE id = pg_temp.demo_id('eng:safety-kenanga') AND status = 'PROPOSED';
UPDATE core.engagements SET status = 'SCHEDULED'  WHERE id = pg_temp.demo_id('eng:safety-kenanga') AND status = 'CONFIRMED';
UPDATE core.engagements SET status = 'IN_DELIVERY' WHERE id = pg_temp.demo_id('eng:safety-kenanga') AND status = 'SCHEDULED';

UPDATE core.engagements SET status = 'CONFIRMED'  WHERE id = pg_temp.demo_id('eng:data-meridian') AND status = 'PROPOSED';
UPDATE core.engagements SET status = 'SCHEDULED'  WHERE id = pg_temp.demo_id('eng:data-meridian') AND status = 'CONFIRMED';

UPDATE core.engagements SET status = 'CONFIRMED'  WHERE id = pg_temp.demo_id('eng:sales-auroratl') AND status = 'PROPOSED';

-- 'eng:conflict-aurora' stays PROPOSED (the INSERT default).

UPDATE core.engagements SET status = 'CANCELLED' WHERE id = pg_temp.demo_id('eng:change-sutera') AND status = 'PROPOSED';

-- ── Sessions (drives core.engagement_trainers by trigger; see 008's header) ──

INSERT INTO core.sessions (id, tenant_id, engagement_id, trainer_id, day, on_date, title, venue,
                           created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.demo_id(v.k), c.t, pg_temp.demo_id(v.eng), pg_temp.demo_id(v.trn), v.day, v.on_date,
       v.title, v.venue, c.at - interval '30 days', 'HUMAN', c.u1::text, c.u1n
  FROM demo_ctx c, (VALUES
    ('ses:change-aurora:1',  'eng:change-aurora',  'trn:farah', 1, '2026-08-24'::date, 'Day 1 — Reading the escalation pattern', 'Aurora Plant, Shah Alam'),
    ('ses:change-aurora:2',  'eng:change-aurora',  'trn:farah', 2, '2026-08-25'::date, 'Day 2 — The de-escalation conversation',  'Aurora Plant, Shah Alam'),
    ('ses:safety-kenanga:1', 'eng:safety-kenanga', 'trn:zaidi', 1, '2026-09-14'::date, 'Day 1 — Stop-work without stopping the relationship', 'Kenanga HQ, Kuala Lumpur'),
    ('ses:data-meridian:1',  'eng:data-meridian',  'trn:mei',   1, '2026-09-28'::date, 'Day 1 — Reading the dashboard', 'Meridian Ops Centre, Port Klang'),
    ('ses:data-meridian:2',  'eng:data-meridian',  'trn:mei',   2, '2026-09-29'::date, 'Day 2 — The measure that changes the decision', 'Meridian Ops Centre, Port Klang')
  ) AS v(k, eng, trn, day, on_date, title, venue)
 WHERE NOT EXISTS (SELECT 1 FROM core.sessions x WHERE x.id = pg_temp.demo_id(v.k));

-- ── Trainer bookings (CONFIRMED, feeds v_trainers.bookedDates/lastDeliveredAt
-- and get_engagement's finance.trainerPayable) ───────────────────────────────

-- Inserted at the default SOFT_HOLD (gated `-> CONFIRMED` needs TRAINER_BOOK,
-- 011's `core.state_transitions`), then walked with the same gate helper —
-- these two bookings are the delivered/in-delivery engagements' real ones, not
-- an option someone is still holding, so CONFIRMED is the honest end state.
INSERT INTO core.trainer_bookings (id, tenant_id, trainer_id, engagement_id, starts_on, ends_on,
                                    hold_expires_at, day_rate_sen, created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.demo_id(v.k), c.t, pg_temp.demo_id(v.trn), pg_temp.demo_id(v.eng),
       v.starts, v.ends, c.at + interval '72 hours', v.rate, c.at - interval '35 days', 'HUMAN', c.u1::text, c.u1n
  FROM demo_ctx c, (VALUES
    ('tbk:change-aurora',  'trn:farah', 'eng:change-aurora',  '2026-08-24'::date, '2026-08-25'::date, 480000::bigint),
    ('tbk:safety-kenanga', 'trn:zaidi', 'eng:safety-kenanga', '2026-09-14'::date, '2026-09-14'::date, 360000::bigint)
  ) AS v(k, trn, eng, starts, ends, rate)
 WHERE NOT EXISTS (SELECT 1 FROM core.trainer_bookings x WHERE x.id = pg_temp.demo_id(v.k));

SELECT pg_temp.gate((SELECT t FROM demo_ctx), 'TRAINER_BOOK', pg_temp.demo_id('tbk:change-aurora'));
UPDATE core.trainer_bookings SET state = 'CONFIRMED' WHERE id = pg_temp.demo_id('tbk:change-aurora') AND state = 'SOFT_HOLD';
SELECT pg_temp.ungate();
SELECT pg_temp.gate((SELECT t FROM demo_ctx), 'TRAINER_BOOK', pg_temp.demo_id('tbk:safety-kenanga'));
UPDATE core.trainer_bookings SET state = 'CONFIRMED' WHERE id = pg_temp.demo_id('tbk:safety-kenanga') AND state = 'SOFT_HOLD';
SELECT pg_temp.ungate();

-- ── Participants — a Malaysian roster, ~34 across the four staffed engagements ──

INSERT INTO core.participants (id, tenant_id, engagement_id, name, department, email,
                               registered_at, created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.demo_id(v.k), c.t, pg_temp.demo_id(v.eng), v.name, v.dept, v.email,
       c.at - interval '25 days', c.at - interval '25 days', 'HUMAN', c.u1::text, c.u1n
  FROM demo_ctx c, (VALUES
    ('par:ca:1','eng:change-aurora','Ahmad Firdaus','Production','ahmad.firdaus@auroramfg.com.my'),
    ('par:ca:2','eng:change-aurora','Nur Aisyah','Logistics','nur.aisyah@auroramfg.com.my'),
    ('par:ca:3','eng:change-aurora','Tan Wei Jian','Quality','tan.weijian@auroramfg.com.my'),
    ('par:ca:4','eng:change-aurora','Siti Rohana','Production','siti.rohana@auroramfg.com.my'),
    ('par:ca:5','eng:change-aurora','Kumar Selvam','Maintenance','kumar.selvam@auroramfg.com.my'),
    ('par:ca:6','eng:change-aurora','Farah Diyana','HR','farah.diyana@auroramfg.com.my'),
    ('par:ca:7','eng:change-aurora','Lee Chong Wei','Production','lee.chongwei@auroramfg.com.my'),
    ('par:ca:8','eng:change-aurora','Aina Sofea','Quality','aina.sofea@auroramfg.com.my'),
    ('par:sk:1','eng:safety-kenanga','Ravi Chandran','Store Ops','ravi.chandran@kenangaretail.com.my'),
    ('par:sk:2','eng:safety-kenanga','Wong Li Ying','Store Ops','wong.liying@kenangaretail.com.my'),
    ('par:sk:3','eng:safety-kenanga','Mohd Faiz','Warehouse','mohd.faiz@kenangaretail.com.my'),
    ('par:sk:4','eng:safety-kenanga','Chandra Segaran','Warehouse','chandra.segaran@kenangaretail.com.my'),
    ('par:sk:5','eng:safety-kenanga','Nurul Izzah','Store Ops','nurul.izzah@kenangaretail.com.my'),
    ('par:sk:6','eng:safety-kenanga','Yap Mei Xin','HR','yap.meixin@kenangaretail.com.my'),
    ('par:sk:7','eng:safety-kenanga','Azman Yusof','Warehouse','azman.yusof@kenangaretail.com.my'),
    ('par:sk:8','eng:safety-kenanga','Grace Anak Ubong','Store Ops','grace.ubong@kenangaretail.com.my'),
    ('par:sk:9','eng:safety-kenanga','Hafiz Rosli','Warehouse','hafiz.rosli@kenangaretail.com.my'),
    ('par:sk:10','eng:safety-kenanga','Poh Suan Lee','Store Ops','poh.suanlee@kenangaretail.com.my'),
    ('par:dm:1','eng:data-meridian','Faridah Omar','Ops','faridah.omar@meridianlog.com.my'),
    ('par:dm:2','eng:data-meridian','Rizal Hakim','Fleet','rizal.hakim@meridianlog.com.my'),
    ('par:dm:3','eng:data-meridian','Chin Yee Ling','Finance','chin.yeeling@meridianlog.com.my'),
    ('par:dm:4','eng:data-meridian','Suresh Nair','Ops','suresh.nair@meridianlog.com.my'),
    ('par:dm:5','eng:data-meridian','Aishah Bakar','Fleet','aishah.bakar@meridianlog.com.my'),
    ('par:dm:6','eng:data-meridian','Loh Wei Kang','Finance','loh.weikang@meridianlog.com.my'),
    ('par:st:1','eng:sales-auroratl','Zul Helmi','Sales','zul.helmi@auroraprecision.com.my'),
    ('par:st:2','eng:sales-auroratl','Michelle Goh','Sales','michelle.goh@auroraprecision.com.my'),
    ('par:st:3','eng:sales-auroratl','Rashid Amin','Sales','rashid.amin@auroraprecision.com.my'),
    ('par:st:4','eng:sales-auroratl','Nadia Iskandar','Sales','nadia.iskandar@auroraprecision.com.my'),
    ('par:st:5','eng:sales-auroratl','Benjamin Teoh','Sales','benjamin.teoh@auroraprecision.com.my'),
    ('par:st:6','eng:sales-auroratl','Kavitha Rani','Sales','kavitha.rani@auroraprecision.com.my'),
    ('par:st:7','eng:sales-auroratl','Fadhil Rahim','Sales','fadhil.rahim@auroraprecision.com.my'),
    ('par:st:8','eng:sales-auroratl','Jasmine Ooi','Sales','jasmine.ooi@auroraprecision.com.my'),
    ('par:st:9','eng:sales-auroratl','Hakim Zulkifli','Sales','hakim.zulkifli@auroraprecision.com.my'),
    ('par:st:10','eng:sales-auroratl','Priya Ganesan','Sales','priya.ganesan@auroraprecision.com.my')
  ) AS v(k, eng, name, dept, email)
 WHERE NOT EXISTS (SELECT 1 FROM core.participants x WHERE x.id = pg_temp.demo_id(v.k));

-- ── Attendance — DELIVERED engagement: day 1 LOCKED (gated), day 2 OPEN ──────

INSERT INTO core.attendance_days (id, tenant_id, engagement_id, day, on_date, status,
                                  created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.demo_id(v.k), c.t, pg_temp.demo_id(v.eng), v.day, v.on_date, 'OPEN',
       c.at - interval '20 days', 'HUMAN', c.u1::text, c.u1n
  FROM demo_ctx c, (VALUES
    ('ad:ca:1', 'eng:change-aurora', 1, '2026-08-24'::date),
    ('ad:ca:2', 'eng:change-aurora', 2, '2026-08-25'::date),
    ('ad:sk:1', 'eng:safety-kenanga', 1, '2026-09-14'::date)
  ) AS v(k, eng, day, on_date)
 WHERE NOT EXISTS (SELECT 1 FROM core.attendance_days x WHERE x.id = pg_temp.demo_id(v.k));

-- Marks: everyone present both halves except one medical-leave absence on
-- Aurora day 1, and one still-uncaptured participant on Kenanga day 1 (the
-- OPEN day this seed leaves for a live demo capture).
INSERT INTO core.attendance_entries (id, tenant_id, attendance_day_id, participant_id, half, present,
                                     marked_at, method, absence_reason, created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.demo_id(v.k), c.t, pg_temp.demo_id(v.day), pg_temp.demo_id(v.par), v.half::core.attendance_half,
       v.present, CASE WHEN v.present THEN c.at - interval '20 days' ELSE NULL END,
       CASE WHEN v.present THEN 'QR'::core.capture_method ELSE NULL END,
       CASE WHEN v.present THEN NULL ELSE v.reason::core.absence_reason END,
       c.at - interval '20 days', 'HUMAN', c.u1::text, c.u1n
  FROM demo_ctx c, (VALUES
    ('ae:ca1:1:am','ad:ca:1','par:ca:1','AM',true,NULL),  ('ae:ca1:1:pm','ad:ca:1','par:ca:1','PM',true,NULL),
    ('ae:ca1:2:am','ad:ca:1','par:ca:2','AM',false,'MEDICAL_LEAVE'), ('ae:ca1:2:pm','ad:ca:1','par:ca:2','PM',false,'MEDICAL_LEAVE'),
    ('ae:ca1:3:am','ad:ca:1','par:ca:3','AM',true,NULL),  ('ae:ca1:3:pm','ad:ca:1','par:ca:3','PM',true,NULL),
    ('ae:ca1:4:am','ad:ca:1','par:ca:4','AM',true,NULL),  ('ae:ca1:4:pm','ad:ca:1','par:ca:4','PM',true,NULL),
    ('ae:ca1:5:am','ad:ca:1','par:ca:5','AM',true,NULL),  ('ae:ca1:5:pm','ad:ca:1','par:ca:5','PM',true,NULL),
    ('ae:ca1:6:am','ad:ca:1','par:ca:6','AM',true,NULL),  ('ae:ca1:6:pm','ad:ca:1','par:ca:6','PM',true,NULL),
    ('ae:ca1:7:am','ad:ca:1','par:ca:7','AM',true,NULL),  ('ae:ca1:7:pm','ad:ca:1','par:ca:7','PM',true,NULL),
    ('ae:ca1:8:am','ad:ca:1','par:ca:8','AM',true,NULL),  ('ae:ca1:8:pm','ad:ca:1','par:ca:8','PM',true,NULL),
    ('ae:ca2:1:am','ad:ca:2','par:ca:1','AM',true,NULL),  ('ae:ca2:1:pm','ad:ca:2','par:ca:1','PM',true,NULL),
    ('ae:ca2:2:am','ad:ca:2','par:ca:2','AM',true,NULL),  ('ae:ca2:2:pm','ad:ca:2','par:ca:2','PM',true,NULL),
    ('ae:ca2:3:am','ad:ca:2','par:ca:3','AM',true,NULL),  ('ae:ca2:3:pm','ad:ca:2','par:ca:3','PM',true,NULL),
    ('ae:ca2:4:am','ad:ca:2','par:ca:4','AM',true,NULL),  ('ae:ca2:4:pm','ad:ca:2','par:ca:4','PM',true,NULL),
    ('ae:ca2:5:am','ad:ca:2','par:ca:5','AM',true,NULL),  ('ae:ca2:5:pm','ad:ca:2','par:ca:5','PM',true,NULL),
    ('ae:ca2:6:am','ad:ca:2','par:ca:6','AM',true,NULL),  ('ae:ca2:6:pm','ad:ca:2','par:ca:6','PM',true,NULL),
    ('ae:ca2:7:am','ad:ca:2','par:ca:7','AM',true,NULL),  ('ae:ca2:7:pm','ad:ca:2','par:ca:7','PM',true,NULL),
    ('ae:ca2:8:am','ad:ca:2','par:ca:8','AM',true,NULL),  ('ae:ca2:8:pm','ad:ca:2','par:ca:8','PM',true,NULL),
    ('ae:sk1:1:am','ad:sk:1','par:sk:1','AM',true,NULL),  ('ae:sk1:1:pm','ad:sk:1','par:sk:1','PM',true,NULL),
    ('ae:sk1:2:am','ad:sk:1','par:sk:2','AM',true,NULL),  ('ae:sk1:2:pm','ad:sk:1','par:sk:2','PM',true,NULL),
    ('ae:sk1:3:am','ad:sk:1','par:sk:3','AM',true,NULL),  ('ae:sk1:3:pm','ad:sk:1','par:sk:3','PM',true,NULL)
    -- par:sk:4 through par:sk:10 are left uncaptured on purpose: a live MD demo
    -- of `captureAttendance` on a real, still-OPEN day needs someone left to mark.
  ) AS v(k, day, par, half, present, reason)
 WHERE NOT EXISTS (SELECT 1 FROM core.attendance_entries x WHERE x.id = pg_temp.demo_id(v.k));

-- Lock Aurora's day 1 (GOV-07 gated: see header). Day 2 and Kenanga's day 1 stay OPEN.
SELECT pg_temp.gate((SELECT t FROM demo_ctx), 'ATTENDANCE_APPROVE', pg_temp.demo_id('ad:ca:1'));
UPDATE core.attendance_days
   SET status = 'LOCKED', approved_by_kind = 'HUMAN', approved_by_id = (SELECT u1::text FROM demo_ctx),
       approved_by_name = (SELECT u1n FROM demo_ctx)
 WHERE id = pg_temp.demo_id('ad:ca:1') AND status = 'OPEN';
SELECT pg_temp.ungate();

-- ── Certificates — three of Aurora's eight, issued after the delivered day ──

INSERT INTO core.certificates (id, tenant_id, participant_id, engagement_id, issued_at, serial,
                               created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.demo_id(v.k), c.t, pg_temp.demo_id(v.par), pg_temp.demo_id('eng:change-aurora'),
       c.at - interval '18 days', v.serial, c.at - interval '18 days', 'SYSTEM', 'system', NULL
  FROM demo_ctx c, (VALUES
    ('crt:ca:1', 'par:ca:1', 'CRT-AKP-CA-0001'),
    ('crt:ca:3', 'par:ca:3', 'CRT-AKP-CA-0002'),
    ('crt:ca:4', 'par:ca:4', 'CRT-AKP-CA-0003')
  ) AS v(k, par, serial)
 WHERE NOT EXISTS (SELECT 1 FROM core.certificates x WHERE x.id = pg_temp.demo_id(v.k));

-- ── Engagement checklist — a close-out ladder for the delivered engagement ───

-- `engagement_checklist_items` (008) carries no created_by_* triple, only
-- `done_by_user_id` — checked against the actual columns after the first
-- attempt guessed the standard triple every other 008 table has.
INSERT INTO core.engagement_checklist_items (id, tenant_id, engagement_id, item_key, label, done, done_at,
                                             done_by_user_id, created_at)
SELECT pg_temp.demo_id(v.k), c.t, pg_temp.demo_id('eng:change-aurora'), v.key, v.label, v.done,
       CASE WHEN v.done THEN c.at - interval '15 days' ELSE NULL END,
       CASE WHEN v.done THEN c.u1 ELSE NULL END,
       c.at - interval '20 days'
  FROM demo_ctx c, (VALUES
    ('cl:ca:attendance', 'ATTENDANCE_LOCKED', 'Attendance locked', true),
    ('cl:ca:certs',      'CERTIFICATES_ISSUED', 'Certificates issued', true),
    ('cl:ca:invoice',    'INVOICE_RAISED', 'Invoice raised', false)
  ) AS v(k, key, label, done)
 WHERE NOT EXISTS (SELECT 1 FROM core.engagement_checklist_items x WHERE x.id = pg_temp.demo_id(v.k));
