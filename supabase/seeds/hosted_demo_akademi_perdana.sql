-- TrainOS hosted demo data for the EXISTING tenant `akademi-perdana`.
--
-- Run (one transaction, stop on the first error; the file refuses to run otherwise):
--   psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/seeds/hosted_demo_akademi_perdana.sql
--
-- Remove exactly what it added:
--   psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/seeds/hosted_demo_wipe.sql
--
-- Pin (ends in ROLLBACK): supabase/seeds/test_hosted_demo.sql
--
-- Hosted-safe by construction. Unlike the fixture world (fixture_world_0*.sql) it:
--   * takes the tenant by slug and never provisions one; the tenant and its
--     019 pipelines, 016 ref formats and 011 action policies are read, never written;
--   * never writes auth.users, memberships or user_profiles. Every user reference
--     (owner_id, assigned_to_user_id, assigned_to_id, created_by) points at one of
--     the two real MD members below, alternating; AI-authored rows name an agent
--     in the text actor columns, which carry no foreign key;
--   * never disables a trigger. Gated statuses (011 core.state_transitions) are
--     reached only over ungated edges, as the table owner would: rows are
--     inserted in the initial state and walked with UPDATE ... WHERE <from state>.
--     Nothing sits in a state that needs an executed action behind it, so every
--     proposal and quotation is DRAFT, no enquiry is CONVERTED or ARCHIVED, and
--     there are no invoices (NULL -> DRAFT is gated by INVOICE_CREATE);
--   * leaves every ref NULL so core.assign_ref allocates it from the tenant's
--     own sequences, as the app does. The app's next ENQ/PRO/QUO continues after
--     these instead of colliding with a hand-picked number.
--
-- Idempotent: every id is pg_temp.demo_id(<stable key>), a uuid in the
-- de30da7a-5eed-4xxx-8xxx-xxxxxxxxxxxx range, and every INSERT is guarded by
-- NOT EXISTS on that id (not ON CONFLICT, which would fire the BEFORE INSERT ref
-- trigger and burn a number on every re-run). Status walks only move rows still
-- in their from-state. A second run writes nothing.
--
-- The wipe keys on that id range, so it removes seed rows and nothing else.

-- ── Context ──────────────────────────────────────────────────────────────────
-- ON COMMIT DROP is the single-transaction guard: without psql -1 the table is
-- gone before the next statement and the run stops before any data is written.

CREATE OR REPLACE FUNCTION pg_temp.demo_id(p_key text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT ('de30da7a-5eed-4' || substr(h, 1, 3) || '-8' || substr(h, 4, 3) || '-' || substr(h, 7, 12))::uuid
    FROM (SELECT md5('akademi-perdana:hosted-demo:' || p_key) AS h) AS k;
$fn$;

DROP TABLE IF EXISTS pg_temp.demo_ctx;
CREATE TEMP TABLE demo_ctx ON COMMIT DROP AS
SELECT tenant.id                                  AS t,
       'd1449fad-b732-4ee2-93c9-37f338e01358'::uuid AS u1,
       'ad615910-2d87-42a4-9855-58f52409ec6d'::uuid AS u2,
       (SELECT p.display_name FROM public.user_profiles p
         WHERE p.tenant_id = tenant.id AND p.user_id = 'd1449fad-b732-4ee2-93c9-37f338e01358') AS u1n,
       (SELECT p.display_name FROM public.user_profiles p
         WHERE p.tenant_id = tenant.id AND p.user_id = 'ad615910-2d87-42a4-9855-58f52409ec6d') AS u2n,
       now()                                      AS at
  FROM public.tenants AS tenant
 WHERE tenant.slug = 'akademi-perdana';

DO $pre$
DECLARE
  v_ctx demo_ctx%ROWTYPE;
  v_md  integer;
BEGIN
  IF (SELECT count(*) FROM demo_ctx) <> 1 THEN
    RAISE EXCEPTION 'hosted demo seed: tenant akademi-perdana not found; this seed never provisions';
  END IF;
  SELECT * INTO v_ctx FROM demo_ctx;
  SELECT count(*) INTO v_md
    FROM public.memberships m
   WHERE m.tenant_id = v_ctx.t
     AND m.user_id IN (v_ctx.u1, v_ctx.u2)
     AND m.role = 'MD' AND m.actor_kind = 'HUMAN' AND m.status = 'ACTIVE';
  IF v_md <> 2 OR v_ctx.u1n IS NULL OR v_ctx.u2n IS NULL THEN
    RAISE EXCEPTION 'hosted demo seed: expected both MD users as ACTIVE members with profiles, found % membership(s)', v_md;
  END IF;
END
$pre$;

-- ── Catalogue ────────────────────────────────────────────────────────────────

INSERT INTO core.templates (id, tenant_id, template_type, version, label, merge_fields, status, category, rate_per_message_sen, created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.demo_id(v.k), c.t, v.kind::core.template_type, v.ver, v.label, v.fields, 'ACTIVE',
       v.cat::core.message_category, v.rate, c.at - interval '200 days', 'HUMAN', c.u1::text, c.u1n
  FROM demo_ctx c, (VALUES
    ('tpl:proposal', 'PROPOSAL',          7, 'Standard proposal',       ARRAY['client.name','contact.name','programme.title','engagement.dates','investment.total'], NULL, NULL::bigint),
    ('tpl:tna',      'TNA_QUESTIONNAIRE', 3, 'Standard needs analysis', ARRAY['client.name','contact.name'], NULL, NULL),
    ('tpl:fu-email', 'EMAIL',             4, 'Follow-up email',         ARRAY['contact.name','proposal.ref'], NULL, NULL),
    ('tpl:fu-wa',    'WHATSAPP',          2, 'Proposal follow-up',      ARRAY['contact.name','proposal.sentAt'], 'UTILITY', 6)
  ) AS v(k, kind, ver, label, fields, cat, rate)
 WHERE NOT EXISTS (SELECT 1 FROM core.templates x WHERE x.id = pg_temp.demo_id(v.k));

INSERT INTO core.programmes (id, tenant_id, name, category, days, version, status, hrdc_scheme, hrdc_claimable, list_price_sen, list_price_pax, floor_price_sen, floor_margin_rate, outcomes, deliveries_count, average_evaluation, created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.demo_id(v.k), c.t, v.name, v.cat, v.days, v.ver, 'ACTIVE', v.scheme::core.hrdc_scheme, true,
       v.list, v.pax, v.floor, 0.35, v.outcomes, v.deliveries, v.eval, c.at - interval '400 days', 'HUMAN', c.u1::text, c.u1n
  FROM demo_ctx c, (VALUES
    ('prg:change',   'Leading Through Change',              'LEADERSHIP', 2, 4, 'SBL_KHAS', 1850000, 30, 1390000, ARRAY['Name the four escalation patterns that stall cross-team work','Run a structured de-escalation conversation without losing the decision','Agree a shared definition of done between production and quality'], 14, 4.5),
    ('prg:conflict', 'Conflict to Collaboration',           'LEADERSHIP', 1, 3, 'SBL_KHAS',  980000, 20,  735000, ARRAY['Separate the position from the interest in a live dispute','Close a disagreement with a written, shared commitment'], 22, 4.6),
    ('prg:data',     'Data Literacy for Managers',          'ANALYTICS',  2, 2, 'SBL_KHAS', 1920000, 25, 1440000, ARRAY['Read an operational dashboard without being misled by it','Ask for the measure that would change the decision'], 6, 4.3),
    ('prg:safety',   'Safety Leadership Essentials',        'SAFETY',     2, 6, 'SBL',      1620000, 30, 1215000, ARRAY['Stop work without stopping the relationship','Run a five-minute pre-shift safety conversation that lands'], 31, 4.4),
    ('prg:sales',    'Sales Excellence for Store Managers', 'SALES',      2, 3, 'SBL_KHAS', 2240000, 30, 1680000, ARRAY['Coach a floor conversation in under ten minutes','Read the weekly mix without the report'], 9, 4.1)
  ) AS v(k, name, cat, days, ver, scheme, list, pax, floor, outcomes, deliveries, eval)
 WHERE NOT EXISTS (SELECT 1 FROM core.programmes x WHERE x.id = pg_temp.demo_id(v.k));

INSERT INTO core.programme_pricing_tiers (id, tenant_id, programme_id, max_pax, price_sen, floor_price_sen, created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.demo_id(v.k), c.t, pg_temp.demo_id(v.prg), v.pax, v.price, v.floor, c.at - interval '400 days', 'HUMAN', c.u1::text, c.u1n
  FROM demo_ctx c, (VALUES
    ('tier:change:20',   'prg:change',   20, 1450000,  942500),
    ('tier:change:30',   'prg:change',   30, 1850000, 1202500),
    ('tier:change:40',   'prg:change',   40, 2240000, 1456000),
    ('tier:conflict:20', 'prg:conflict', 20,  980000,  637000),
    ('tier:conflict:30', 'prg:conflict', 30, 1320000,  858000),
    ('tier:data:25',     'prg:data',     25, 1920000, 1248000),
    ('tier:data:40',     'prg:data',     40, 2560000, 1664000),
    ('tier:safety:30',   'prg:safety',   30, 1620000, 1053000),
    ('tier:safety:45',   'prg:safety',   45, 2180000, 1417000),
    ('tier:sales:30',    'prg:sales',    30, 2240000, 1456000),
    ('tier:sales:50',    'prg:sales',    50, 3400000, 2210000)
  ) AS v(k, prg, pax, price, floor)
 WHERE NOT EXISTS (SELECT 1 FROM core.programme_pricing_tiers x WHERE x.id = pg_temp.demo_id(v.k));

-- ── Rate card (the costing worksheet needs an ACTIVE card covering today) ───────

INSERT INTO core.rate_cards (id, tenant_id, version, status, effective_from, created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.demo_id('rc:2026'), c.t, '2026.1', 'ACTIVE', make_date(extract(year FROM c.at)::int, 1, 1),
       c.at - interval '30 days', 'HUMAN', c.u1::text, c.u1n
  FROM demo_ctx c
 WHERE NOT EXISTS (SELECT 1 FROM core.rate_cards x WHERE x.id = pg_temp.demo_id('rc:2026'));

INSERT INTO core.rate_card_trainer_days (id, tenant_id, rate_card_id, band, day_rate_sen)
SELECT pg_temp.demo_id(v.k), c.t, pg_temp.demo_id('rc:2026'), v.band::core.trainer_band, v.rate
  FROM demo_ctx c, (VALUES ('rc:day:A','A',480000), ('rc:day:B','B',360000), ('rc:day:C','C',280000)) AS v(k, band, rate)
 WHERE NOT EXISTS (SELECT 1 FROM core.rate_card_trainer_days x WHERE x.id = pg_temp.demo_id(v.k));

INSERT INTO core.rate_card_materials (id, tenant_id, rate_card_id, programme_type, per_pax_sen)
SELECT pg_temp.demo_id(v.k), c.t, pg_temp.demo_id('rc:2026'), v.type, v.sen
  FROM demo_ctx c, (VALUES ('rc:mat:LEADERSHIP','LEADERSHIP',4000), ('rc:mat:ANALYTICS','ANALYTICS',5500),
                           ('rc:mat:SAFETY','SAFETY',3500), ('rc:mat:SALES','SALES',4500)) AS v(k, type, sen)
 WHERE NOT EXISTS (SELECT 1 FROM core.rate_card_materials x WHERE x.id = pg_temp.demo_id(v.k));

INSERT INTO core.rate_card_venues (id, tenant_id, rate_card_id, mode, day_rate_sen)
SELECT pg_temp.demo_id(v.k), c.t, pg_temp.demo_id('rc:2026'), v.mode::core.venue_mode, v.sen
  FROM demo_ctx c, (VALUES ('rc:venue:CLIENT_SITE','CLIENT_SITE',0::bigint), ('rc:venue:OWN_VENUE','OWN_VENUE',90000),
                           ('rc:venue:EXTERNAL','EXTERNAL',NULL)) AS v(k, mode, sen)
 WHERE NOT EXISTS (SELECT 1 FROM core.rate_card_venues x WHERE x.id = pg_temp.demo_id(v.k));

INSERT INTO core.rate_card_travel (id, tenant_id, rate_card_id, region, per_trip_sen)
SELECT pg_temp.demo_id(v.k), c.t, pg_temp.demo_id('rc:2026'), v.region::core.travel_region, v.sen
  FROM demo_ctx c, (VALUES ('rc:travel:KLANG_VALLEY','KLANG_VALLEY',30000), ('rc:travel:PENINSULAR','PENINSULAR',85000),
                           ('rc:travel:EAST_MALAYSIA','EAST_MALAYSIA',190000)) AS v(k, region, sen)
 WHERE NOT EXISTS (SELECT 1 FROM core.rate_card_travel x WHERE x.id = pg_temp.demo_id(v.k));

INSERT INTO core.rate_card_margin_floors (id, tenant_id, rate_card_id, programme_type, floor_pct)
SELECT pg_temp.demo_id(v.k), c.t, pg_temp.demo_id('rc:2026'), v.type, 0.35
  FROM demo_ctx c, (VALUES ('rc:floor:LEADERSHIP','LEADERSHIP'), ('rc:floor:ANALYTICS','ANALYTICS'),
                           ('rc:floor:SAFETY','SAFETY'), ('rc:floor:SALES','SALES')) AS v(k, type)
 WHERE NOT EXISTS (SELECT 1 FROM core.rate_card_margin_floors x WHERE x.id = pg_temp.demo_id(v.k));

INSERT INTO core.rate_card_discount_authorities (id, tenant_id, rate_card_id, role, max_pct)
SELECT pg_temp.demo_id(v.k), c.t, pg_temp.demo_id('rc:2026'), v.role::app.app_role, v.pct
  FROM demo_ctx c, (VALUES ('rc:auth:SALES','SALES',0.05), ('rc:auth:SALES_MANAGER','SALES_MANAGER',0.15),
                           ('rc:auth:MD','MD',0.30)) AS v(k, role, pct)
 WHERE NOT EXISTS (SELECT 1 FROM core.rate_card_discount_authorities x WHERE x.id = pg_temp.demo_id(v.k));

-- ── Parties ──────────────────────────────────────────────────────────────────

INSERT INTO core.organisations (id, tenant_id, name, industry, location, owner_id, status, hrdc_registered, hrdc_employer_code, health_score, city, created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.demo_id(v.k), c.t, v.name, v.industry, v.city, CASE v.u WHEN 1 THEN c.u1 ELSE c.u2 END,
       v.status::core.organisation_status, true, v.hrdc, v.health, v.city, c.at - v.age, 'HUMAN',
       CASE v.u WHEN 1 THEN c.u1 ELSE c.u2 END::text, CASE v.u WHEN 1 THEN c.u1n ELSE c.u2n END
  FROM demo_ctx c, (VALUES
    ('org:aurora',   'Aurora Manufacturing Sdn Bhd', 'MANUFACTURING', 'Shah Alam',    1, 'ACTIVE_CLIENT', 'HRDC-2201-8834', 74, interval '900 days'),
    ('org:kenanga',  'Kenanga Retail Group Berhad',  'RETAIL',        'Kuala Lumpur', 2, 'ACTIVE_CLIENT', 'HRDC-1908-4417', 81, interval '1100 days'),
    ('org:meridian', 'Meridian Logistics Sdn Bhd',   'LOGISTICS',     'Port Klang',   1, 'ACTIVE_CLIENT', 'HRDC-2102-6620', 62, interval '680 days'),
    ('org:sutera',   'Sutera Hospitality Group',     'HOSPITALITY',   'Kuala Lumpur', 2, 'DORMANT',       'HRDC-2007-3312', 38, interval '1580 days'),
    ('org:perdana',  'Perdana Utilities Berhad',     'UTILITIES',     'Cyberjaya',    2, 'PROSPECT',      'HRDC-1806-9021', 55, interval '115 days'),
    ('org:auroratl', 'Aurora Precision Tooling Sdn Bhd', 'MANUFACTURING', 'Klang',    1, 'PROSPECT',      'HRDC-2204-1190', 50, interval '26 days')
  ) AS v(k, name, industry, city, u, status, hrdc, health, age)
 WHERE NOT EXISTS (SELECT 1 FROM core.organisations x WHERE x.id = pg_temp.demo_id(v.k))
 ORDER BY v.age DESC;

INSERT INTO core.contacts (id, tenant_id, organisation_id, name, job_title, email, phone, is_primary, pdpa_flag, created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.demo_id(v.k), c.t, pg_temp.demo_id(v.org), v.name, v.title, v.email, v.phone, v.prim, v.pdpa,
       c.at - interval '300 days', 'HUMAN', c.u1::text, c.u1n
  FROM demo_ctx c, (VALUES
    ('con:nurul',    'org:aurora',   'Nurul Hassan',     'HR Manager',             'nurul.hassan@auroramfg.com.my',        '+60123344551', true,  NULL),
    ('con:ravi',     'org:aurora',   'Ravi Subramaniam', 'Plant Director',         'ravi.s@auroramfg.com.my',              NULL,           false, 'NO_CONSENT'),
    ('con:weisheng', 'org:kenanga',  'Lim Wei Sheng',    'Head of Learning',       'weisheng.lim@kenangaretail.com.my',    '+60129900112', true,  NULL),
    ('con:faridah',  'org:meridian', 'Faridah Omar',     'HR Business Partner',    'faridah.omar@meridianlog.com.my',      '+60127788330', true,  NULL),
    ('con:suresh',   'org:sutera',   'Suresh Kumaran',   'General Manager',        'suresh@suterahospitality.com',         NULL,           true,  NULL),
    ('con:ganesh',   'org:perdana',  'Ganesh Pillai',    'Safety & Training Lead', 'ganesh.pillai@perdanautilities.com.my', '+60133322990', true,  NULL)
  ) AS v(k, org, name, title, email, phone, prim, pdpa)
 WHERE NOT EXISTS (SELECT 1 FROM core.contacts x WHERE x.id = pg_temp.demo_id(v.k));

INSERT INTO core.contact_consents (id, tenant_id, contact_id, channel, granted, recorded_at, purpose, source, created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.demo_id(v.k), c.t, pg_temp.demo_id(v.con), v.channel::core.enquiry_channel, true,
       c.at - interval '60 days', 'ENQUIRY_RESPONSE', 'demo seed', c.at - interval '60 days', 'HUMAN', c.u1::text, c.u1n
  FROM demo_ctx c, (VALUES
    ('cns:nurul:EMAIL','con:nurul','EMAIL'), ('cns:nurul:WHATSAPP','con:nurul','WHATSAPP'),
    ('cns:weisheng:EMAIL','con:weisheng','EMAIL'),
    ('cns:faridah:EMAIL','con:faridah','EMAIL'), ('cns:faridah:WHATSAPP','con:faridah','WHATSAPP'),
    ('cns:suresh:EMAIL','con:suresh','EMAIL'),
    ('cns:ganesh:EMAIL','con:ganesh','EMAIL'), ('cns:ganesh:WHATSAPP','con:ganesh','WHATSAPP')
  ) AS v(k, con, channel)
 WHERE NOT EXISTS (SELECT 1 FROM core.contact_consents x WHERE x.id = pg_temp.demo_id(v.k));

-- Refs are allocated in ORDER BY order, so older records get lower numbers.

-- ── Enquiries: inserted OPEN, assigned ones walked OPEN -> ASSIGNED ─────────────

INSERT INTO core.enquiries (id, tenant_id, channel, received_at, from_name, from_email, from_phone, subject, preview, body, classification_label, classification_confidence, needs_human_review, estimated_value_sen, matched_organisation_id, matched_contact_id, match_reason, assigned_to_user_id, created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.demo_id(v.k), c.t, v.channel::core.enquiry_channel, c.at - v.age, v.from_name, v.from_email, v.from_phone,
       v.subject, left(v.body, 80) || CASE WHEN length(v.body) > 80 THEN '…' ELSE '' END, v.body,
       v.label, v.conf, v.review, v.value,
       CASE WHEN v.org IS NOT NULL THEN pg_temp.demo_id(v.org) END,
       CASE WHEN v.con IS NOT NULL THEN pg_temp.demo_id(v.con) END,
       v.match::core.organisation_match_reason,
       CASE v.u WHEN 1 THEN c.u1 WHEN 2 THEN c.u2 END,
       c.at - v.age, 'SYSTEM', 'ingest_email', 'Email ingest'
  FROM demo_ctx c, (VALUES
    ('enq:aurora',     'EMAIL',    interval '74 hours',  'Nurul Hassan',  'nurul.hassan@auroramfg.com.my', NULL, 'Leadership training for 30 managers', 'Hi, we''re looking for leadership training for approximately 30 managers, preferably in November, focused on conflict management and communication.', 'LEADERSHIP', 0.94, false, 1850000::bigint, 'org:aurora', 'con:nurul', 'EXACT_DOMAIN', 1),
    ('enq:kenanga',    'EMAIL',    interval '20 hours',  'Lim Wei Sheng', 'weisheng.lim@kenangaretail.com.my', NULL, 'Sales excellence programme for store managers', 'We would like to run a sales excellence programme for 48 store managers in Q1 2027, across Klang Valley and Johor.', 'SALES_EXCELLENCE', 0.92, false, 6720000, 'org:kenanga', 'con:weisheng', 'EXACT_DOMAIN', 2),
    ('enq:meridian',   'WEB_FORM', interval '44 hours',  'Faridah Omar',  'faridah.omar@meridianlog.com.my', '+60127788330', 'Data literacy refresher', 'Following last year''s cohort, we want a refresher for the planning team — about 22 people, ideally December.', 'DATA_LITERACY', 0.88, false, 4200000, 'org:meridian', 'con:faridah', 'EXACT_DOMAIN', 1),
    ('enq:perdana',    'PHONE',    interval '30 hours',  'Ganesh Pillai', 'ganesh.pillai@perdanautilities.com.my', '+60133322990', 'Safety leadership — substation teams', 'Called to ask about safety leadership for substation supervisors. Around 35 people, wants HRD Corp claimable.', 'SAFETY', 0.86, false, 2730000, 'org:perdana', 'con:ganesh', 'MANUAL', 2),
    ('enq:sutera',     'EMAIL',    interval '52 hours',  'Suresh Kumaran', 'suresh@suterahospitality.com', NULL, 'Re-opening conversation on service recovery', 'We paused last year but would like to revisit service recovery training for front office, maybe 18 people.', 'SERVICE', 0.79, false, 980000, 'org:sutera', 'con:suresh', 'FUZZY_NAME', NULL),
    ('enq:unclear',    'WHATSAPP', interval '3 hours',   '+60 12-778 3410', NULL, '+60127783410', 'training?', 'hi do you all do the safety one ah', 'UNCLEAR', 0.41, true, NULL, NULL, NULL, NULL, NULL),
    ('enq:conference', 'EMAIL',    interval '62 hours',  'Conference Alerts', 'noreply@conferencealerts.example', NULL, 'Your invitation: ASEAN L&D Summit 2027', 'Register now for early-bird rates on the region''s largest L&D gathering. Group discounts available.', 'NOT_AN_ENQUIRY', 0.96, false, NULL, NULL, NULL, NULL, NULL),
    ('enq:penang',     'WHATSAPP', interval '68 hours',  '+60 19-220 8871', NULL, '+60192208871', 'Quotation request', 'Good morning, can I get a quote for a 1-day communication workshop for 25 staff in Penang?', 'COMMUNICATION', 0.83, false, 890000, NULL, NULL, NULL, NULL),
    ('enq:nusantara',  'EMAIL',    interval '92 hours',  'Procurement — Nusantara Foods', 'procurement@nusantarafoods.example', NULL, 'RFQ: supervisory skills, 2 cohorts', 'Please find attached our RFQ for supervisory skills training, two cohorts of 25, delivery by March 2027.', 'SUPERVISORY', 0.90, false, 3600000, NULL, NULL, NULL, 1),
    ('enq:brightpath', 'WEB_FORM', interval '98 hours',  'Adeline Chong', 'adeline.chong@brightpath.example', NULL, 'Coaching for new team leads', 'We have 12 newly promoted team leads and no structured coaching. What do you recommend?', 'COACHING', 0.81, false, 1200000, NULL, NULL, NULL, NULL),
    ('enq:printworks', 'EMAIL',    interval '112 hours', 'Zul from PrintWorks', 'sales@printworks.example', NULL, 'Corporate gifts and lanyards', 'We supply lanyards, notebooks and corporate gifts at wholesale rates. Can we be your vendor?', 'VENDOR_PITCH', 0.94, false, NULL, NULL, NULL, NULL, NULL),
    ('enq:tenaga',     'EMAIL',    interval '120 hours', 'Hasnah Ibrahim', 'hasnah@tenagaklang.example', NULL, 'Change management for engineering', 'Our engineering division is restructuring and needs change management support for about 40 engineers.', 'LEADERSHIP', 0.87, false, 2450000, NULL, NULL, NULL, NULL),
    ('enq:hrdc',       'WHATSAPP', interval '134 hours', '+60 13-901 5566', NULL, '+60139015566', 'HRDC claimable?', 'Is your leadership programme claimable under SBL-Khas?', 'HRDC_QUERY', 0.89, false, NULL, NULL, NULL, NULL, NULL),
    ('enq:bandar',     'EMAIL',    interval '150 hours', 'Yusof Karim', 'yusof.karim@bandarhealth.example', NULL, 'Conflict management for clinical leads', 'Our clinical leads need conflict management; about 20 people, flexible dates in the first half of 2027.', 'LEADERSHIP', 0.90, false, 1450000, NULL, NULL, NULL, NULL)
  ) AS v(k, channel, age, from_name, from_email, from_phone, subject, body, label, conf, review, value, org, con, match, u)
 WHERE NOT EXISTS (SELECT 1 FROM core.enquiries x WHERE x.id = pg_temp.demo_id(v.k))
 ORDER BY v.age DESC;

UPDATE core.enquiries AS e
   SET status = 'ASSIGNED'
  FROM demo_ctx c
 WHERE e.tenant_id = c.t
   AND e.id IN (pg_temp.demo_id('enq:aurora'), pg_temp.demo_id('enq:kenanga'), pg_temp.demo_id('enq:meridian'),
                pg_temp.demo_id('enq:perdana'), pg_temp.demo_id('enq:nusantara'))
   AND e.status = 'OPEN';

INSERT INTO core.enquiry_extraction_fields (id, tenant_id, enquiry_id, field_key, value, created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.demo_id('xf:' || v.enq || ':' || f.key), c.t, pg_temp.demo_id(v.enq), f.key, f.value,
       e.received_at, 'AGENT', 'agent_lead', 'Lead Agent'
  FROM demo_ctx c,
       (VALUES
         ('enq:aurora',     'Conflict & communication', '30 line managers',  'November',    NULL),
         ('enq:kenanga',    'Sales excellence',         '48 store managers', 'Q1 2027',     '6720000'),
         ('enq:meridian',   'Data literacy',            '22 planners',       'December',    '4200000'),
         ('enq:perdana',    'Safety leadership',        '35 supervisors',    'February 2027', NULL),
         ('enq:sutera',     'Service recovery',         '18 front office',   NULL,          NULL),
         ('enq:penang',     'Communication',            '25 staff',          NULL,          NULL),
         ('enq:nusantara',  'Supervisory skills',       '2 cohorts of 25',   'March 2027',  '3600000'),
         ('enq:brightpath', 'Coaching',                 '12 team leads',     NULL,          NULL),
         ('enq:tenaga',     'Change management',        '40 engineers',      'January 2027', NULL),
         ('enq:bandar',     'Conflict management',      '20 clinical leads', 'H1 2027',     NULL)
       ) AS v(enq, topic, audience, timing, budget)
       CROSS JOIN LATERAL (VALUES ('topic', v.topic), ('audience', v.audience), ('timing', v.timing), ('budget', v.budget)) AS f(key, value)
       JOIN core.enquiries e ON e.id = pg_temp.demo_id(v.enq)
 WHERE NOT EXISTS (SELECT 1 FROM core.enquiry_extraction_fields x WHERE x.id = pg_temp.demo_id('xf:' || v.enq || ':' || f.key));

-- ── Opportunities: inserted NEW, walked over ungated edges ───────────────────────

INSERT INTO core.opportunities (id, tenant_id, organisation_id, primary_contact_id, source_enquiry_id, owner_id, value_sen, probability, lost_reason, created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.demo_id(v.k), c.t, pg_temp.demo_id(v.org), pg_temp.demo_id(v.con),
       CASE WHEN v.enq IS NOT NULL THEN pg_temp.demo_id(v.enq) END,
       CASE v.u WHEN 1 THEN c.u1 ELSE c.u2 END, v.value, v.prob, v.lost, c.at - v.age, 'HUMAN',
       CASE v.u WHEN 1 THEN c.u1 ELSE c.u2 END::text, CASE v.u WHEN 1 THEN c.u1n ELSE c.u2n END
  FROM demo_ctx c, (VALUES
    ('opp:aurora',   'org:aurora',   'con:nurul',    'enq:aurora',   1, 1850000::bigint, 0.70, NULL,                        interval '72 hours'),
    ('opp:kenanga',  'org:kenanga',  'con:weisheng', 'enq:kenanga',  2, 6720000,         0.30, NULL,                        interval '18 hours'),
    ('opp:meridian', 'org:meridian', 'con:faridah',  'enq:meridian', 1, 4200000,         0.60, NULL,                        interval '42 hours'),
    ('opp:perdana',  'org:perdana',  'con:ganesh',   'enq:perdana',  2, 2180000,         0.50, NULL,                        interval '28 hours'),
    ('opp:sutera',   'org:sutera',   'con:suresh',   NULL,           2,  980000,         0.00, 'Lost on price last year',   interval '130 days')
  ) AS v(k, org, con, enq, u, value, prob, lost, age)
 WHERE NOT EXISTS (SELECT 1 FROM core.opportunities x WHERE x.id = pg_temp.demo_id(v.k))
 ORDER BY v.age DESC;

UPDATE core.opportunities AS o SET stage = 'QUALIFYING', stage_changed_at = now()
  FROM demo_ctx c
 WHERE o.tenant_id = c.t AND o.stage = 'NEW'
   AND o.id IN (pg_temp.demo_id('opp:aurora'), pg_temp.demo_id('opp:kenanga'),
                pg_temp.demo_id('opp:meridian'), pg_temp.demo_id('opp:perdana'));

UPDATE core.opportunities AS o SET stage = 'TNA_SENT', stage_changed_at = now()
  FROM demo_ctx c
 WHERE o.tenant_id = c.t AND o.stage = 'QUALIFYING'
   AND o.id IN (pg_temp.demo_id('opp:aurora'), pg_temp.demo_id('opp:meridian'))
   AND NOT EXISTS (SELECT 1 FROM core.tnas t WHERE t.opportunity_id = o.id);

UPDATE core.opportunities AS o SET stage = 'LOST', stage_changed_at = now()
  FROM demo_ctx c
 WHERE o.tenant_id = c.t AND o.stage = 'NEW' AND o.id = pg_temp.demo_id('opp:sutera');

-- ── Needs analyses: inserted DRAFT, walked DRAFT -> SENT -> COMPLETE ─────────────

INSERT INTO core.tnas (id, tenant_id, opportunity_id, questionnaire_template_id, audience_headcount, audience_level, audience_sites, audience_language, budget_sen, created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.demo_id(v.k), c.t, pg_temp.demo_id(v.opp), pg_temp.demo_id('tpl:tna'), v.headcount, v.level, v.sites, 'EN', v.budget,
       c.at - v.age, 'HUMAN', CASE v.u WHEN 1 THEN c.u1 ELSE c.u2 END::text, CASE v.u WHEN 1 THEN c.u1n ELSE c.u2n END
  FROM demo_ctx c, (VALUES
    ('tna:aurora',   'opp:aurora',   30, 'LINE_MANAGER',  ARRAY['Shah Alam','Klang'],     NULL::bigint, 1, interval '70 hours'),
    ('tna:meridian', 'opp:meridian', 22, 'PLANNER',       ARRAY['Port Klang'],            4200000,      1, interval '40 hours'),
    ('tna:kenanga',  'opp:kenanga',  48, 'STORE_MANAGER', ARRAY['Klang Valley','Johor'],  NULL,         2, interval '16 hours')
  ) AS v(k, opp, headcount, level, sites, budget, u, age)
 WHERE NOT EXISTS (SELECT 1 FROM core.tnas x WHERE x.id = pg_temp.demo_id(v.k))
 ORDER BY v.age DESC;

UPDATE core.tnas AS t SET status = 'SENT', sent_at = t.created_at + interval '10 minutes'
  FROM demo_ctx c
 WHERE t.tenant_id = c.t AND t.status = 'DRAFT'
   AND t.id IN (pg_temp.demo_id('tna:aurora'), pg_temp.demo_id('tna:meridian'), pg_temp.demo_id('tna:kenanga'));

UPDATE core.tnas AS t
   SET status = 'COMPLETE', completed_at = t.created_at + interval '20 hours',
       completed_by_kind = 'CLIENT', completed_by_id = 'portal',
       completed_by_name = CASE t.id WHEN pg_temp.demo_id('tna:aurora') THEN 'Nurul Hassan' ELSE 'Faridah Omar' END
  FROM demo_ctx c
 WHERE t.tenant_id = c.t AND t.status = 'SENT'
   AND t.id IN (pg_temp.demo_id('tna:aurora'), pg_temp.demo_id('tna:meridian'));

INSERT INTO core.tna_gaps (id, tenant_id, tna_id, name, description, priority, evidence_refs, created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.demo_id(v.k), c.t, pg_temp.demo_id(v.tna), v.name, v.descr, v.prio::core.gap_priority, v.refs,
       c.at - interval '50 hours', 'AGENT', 'agent_tna', 'TNA Agent'
  FROM demo_ctx c, (VALUES
    ('gap:aurora:conflict', 'tna:aurora',   'Conflict resolution',               'Production vs quality escalations',                     'HIGH',   ARRAY['Q4','Q7']),
    ('gap:aurora:comms',    'tna:aurora',   'Cross-functional communication',    'Shift handover loses the decision, not the data',       'HIGH',   ARRAY['Q4','Q9','Q11']),
    ('gap:aurora:feedback', 'tna:aurora',   'Giving corrective feedback',        'Supervisors escalate rather than address on the floor', 'MEDIUM', ARRAY['Q12']),
    ('gap:meridian:dash',   'tna:meridian', 'Interpreting operational dashboards', 'Planners act on the headline, not the distribution',  'HIGH',   ARRAY['Q2','Q5'])
  ) AS v(k, tna, name, descr, prio, refs)
 WHERE NOT EXISTS (SELECT 1 FROM core.tna_gaps x WHERE x.id = pg_temp.demo_id(v.k));

INSERT INTO core.tna_constraints (id, tenant_id, tna_id, code, label, severity, created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.demo_id(v.k), c.t, pg_temp.demo_id(v.tna), v.code, v.label, v.sev::core.severity,
       c.at - interval '50 hours', 'HUMAN', c.u1::text, c.u1n
  FROM demo_ctx c, (VALUES
    ('tc:aurora:window',   'tna:aurora',   'DELIVERY_WINDOW',         'November 2026',     'WARN'),
    ('tc:aurora:days',     'tna:aurora',   'MAX_DAYS_OFF_FLOOR',      'Max 2 days',        NULL),
    ('tc:aurora:hrdc',     'tna:aurora',   'HRDC_CLAIMABLE_REQUIRED', 'Must be claimable', NULL),
    ('tc:meridian:window', 'tna:meridian', 'DELIVERY_WINDOW',         'December 2026',     NULL),
    ('tc:kenanga:window',  'tna:kenanga',  'DELIVERY_WINDOW',         'Q1 2027',           NULL)
  ) AS v(k, tna, code, label, sev)
 WHERE NOT EXISTS (SELECT 1 FROM core.tna_constraints x WHERE x.id = pg_temp.demo_id(v.k));

INSERT INTO core.tna_evidence (id, tenant_id, tna_id, source_type, source_ref, excerpt, created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.demo_id(v.k), c.t, pg_temp.demo_id(v.tna), v.type::core.evidence_type,
       COALESCE((SELECT e.ref FROM core.enquiries e WHERE e.id = pg_temp.demo_id(v.src)),
                (SELECT o.ref FROM core.organisations o WHERE o.id = pg_temp.demo_id(v.src)), v.src),
       v.excerpt, c.at - interval '50 hours', 'AGENT', 'agent_tna', 'TNA Agent'
  FROM demo_ctx c, (VALUES
    ('te:aurora:email',    'tna:aurora',   'EMAIL',         'enq:aurora',            'Conflict management and communication, ~30 managers, November'),
    ('te:aurora:qn',       'tna:aurora',   'QUESTIONNAIRE', 'Questionnaire responses', NULL),
    ('te:aurora:history',  'tna:aurora',   'HISTORY',       'org:aurora',            'Two cohorts delivered 2024–2025'),
    ('te:meridian:qn',     'tna:meridian', 'QUESTIONNAIRE', 'Questionnaire responses', NULL)
  ) AS v(k, tna, type, src, excerpt)
 WHERE NOT EXISTS (SELECT 1 FROM core.tna_evidence x WHERE x.id = pg_temp.demo_id(v.k));

INSERT INTO core.tna_recommendations (id, tenant_id, tna_id, programme_id, fit_score, rationale, price_indication_sen, rank, scoring_model_version, scoring_weights, created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.demo_id(v.k), c.t, pg_temp.demo_id(v.tna), pg_temp.demo_id(v.prg), v.fit, v.why, v.price, v.rank, 'fit-v3',
       '{"gapCoverage":0.5,"audienceFit":0.2,"windowFit":0.2,"trainerAvailability":0.1}'::jsonb,
       c.at - interval '49 hours', 'AGENT', 'agent_tna', 'TNA Agent'
  FROM demo_ctx c, (VALUES
    ('rec:aurora:change',   'tna:aurora',   'prg:change',   0.91, 'Covers both high-priority gaps; two-day format fits the days-off-floor limit.', 1850000::bigint, 1),
    ('rec:aurora:conflict', 'tna:aurora',   'prg:conflict', 0.78, 'Covers conflict only; no communication module.',                               980000,  2),
    ('rec:aurora:data',     'tna:aurora',   'prg:data',     0.22, 'No gap match; listed for completeness.',                                       NULL,    3),
    ('rec:meridian:data',   'tna:meridian', 'prg:data',     0.94, 'Direct gap match; repeat cohort from last year.',                              1920000, 1)
  ) AS v(k, tna, prg, fit, why, price, rank)
 WHERE NOT EXISTS (SELECT 1 FROM core.tna_recommendations x WHERE x.id = pg_temp.demo_id(v.k));

-- ── Proposals (DRAFT) and sections ───────────────────────────────────────────────

INSERT INTO core.proposals (id, tenant_id, opportunity_id, organisation_id, template_id, programme_id, value_sen, margin_rate, created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.demo_id(v.k), c.t, pg_temp.demo_id(v.opp), pg_temp.demo_id(v.org), pg_temp.demo_id('tpl:proposal'), pg_temp.demo_id(v.prg),
       v.value, v.margin, c.at - v.age, 'AGENT', 'agent_proposal', 'Proposal Agent'
  FROM demo_ctx c, (VALUES
    ('pro:aurora',   'opp:aurora',   'org:aurora',   'prg:change', 1850000::bigint, 0.3838, interval '48 hours'),
    ('pro:meridian', 'opp:meridian', 'org:meridian', 'prg:data',   1920000,         0.4839, interval '20 hours'),
    ('pro:perdana',  'opp:perdana',  'org:perdana',  'prg:safety', 2180000,         0.5860, interval '6 hours')
  ) AS v(k, opp, org, prg, value, margin, age)
 WHERE NOT EXISTS (SELECT 1 FROM core.proposals x WHERE x.id = pg_temp.demo_id(v.k))
 ORDER BY v.age DESC;

INSERT INTO core.proposal_sections (id, tenant_id, proposal_id, n, title, body, merge_fields_used, needs_review, created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.demo_id('sec:' || v.pro || ':' || v.n), c.t, pg_temp.demo_id(v.pro), v.n, v.title, v.body, v.fields, v.review,
       p.created_at, 'AGENT', 'agent_proposal', 'Proposal Agent'
  FROM demo_ctx c, (VALUES
    ('pro:aurora',   1, 'Understanding your needs', 'Aurora Manufacturing''s 30 line managers report friction between production and quality teams. Escalations stall decisions at shift handover, and supervisors escalate issues they could resolve on the floor.', ARRAY['contact.name'], false),
    ('pro:aurora',   2, 'Recommended programme',    'Leading Through Change is a two-day facilitated programme for up to 30 participants, built around live escalation cases from your own plant.', ARRAY['programme.title','engagement.dates'], false),
    ('pro:aurora',   3, 'Delivery plan',            'Two consecutive days on site at Aurora HQ Shah Alam in November, with a 30-day follow-up clinic for the line managers.', NULL, false),
    ('pro:aurora',   4, 'Investment',               'RM 18,500 for up to 30 participants, inclusive of materials and trainer travel.', ARRAY['investment.total'], false),
    ('pro:aurora',   5, 'HRD Corp claim guidance',  'This programme is claimable under SBL-Khas subject to prior grant approval. Apply at least 14 days before the first session.', NULL, true),
    ('pro:meridian', 1, 'Understanding your needs', 'Meridian''s planning team needs to read the distribution, not the headline, when a dashboard moves.', NULL, false),
    ('pro:meridian', 2, 'Recommended programme',    'Data Literacy for Managers, two days, December, for 22 planners at our own venue.', ARRAY['programme.title'], false),
    ('pro:meridian', 3, 'Investment',               'RM 19,200 for up to 25 participants, inclusive of materials.', ARRAY['investment.total'], false),
    ('pro:perdana',  1, 'Understanding your needs', 'Perdana Utilities'' substation supervisors lead crews in high-risk environments and need to stop work without stopping the relationship.', NULL, false),
    ('pro:perdana',  2, 'Recommended programme',    'Safety Leadership Essentials, two days, for 35 supervisors across two cohorts.', ARRAY['programme.title'], false),
    ('pro:perdana',  3, 'Investment',               'RM 21,800 for up to 45 participants. HRD Corp claimable under SBL.', ARRAY['investment.total'], true)
  ) AS v(pro, n, title, body, fields, review)
  JOIN core.proposals p ON p.id = pg_temp.demo_id(v.pro)
 WHERE NOT EXISTS (SELECT 1 FROM core.proposal_sections x WHERE x.id = pg_temp.demo_id('sec:' || v.pro || ':' || v.n));

-- ── Quotations (DRAFT) and lines ─────────────────────────────────────────────────
-- SST is left to core.resolve_quotation_sst. Header sell/cost are recomputed from
-- the lines by trg_quotation_lines_recalc; the deferred floor and reconciliation
-- triggers are flushed at the end of this file.

INSERT INTO core.quotations (id, tenant_id, proposal_id, rate_card_id, pax, sell_price_sen, direct_cost_sen, programme_floor_price_sen, floor_margin_rate, commission_rate, commission_payable_on, created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.demo_id(v.k), c.t, pg_temp.demo_id(v.pro), pg_temp.demo_id('rc:2026'), v.pax, v.sell, v.cost, v.floor, 0.35, 0.08, 'COLLECTION',
       c.at - v.age, 'HUMAN', CASE v.u WHEN 1 THEN c.u1 ELSE c.u2 END::text, CASE v.u WHEN 1 THEN c.u1n ELSE c.u2n END
  FROM demo_ctx c, (VALUES
    ('quo:aurora',   'pro:aurora',   30, 1850000::bigint, 1140000::bigint, 1390000::bigint, 1, interval '47 hours'),
    ('quo:meridian', 'pro:meridian', 22, 1920000,         991000,          1440000,         1, interval '19 hours'),
    ('quo:perdana',  'pro:perdana',  35, 2180000,         902500,          1417000,         2, interval '5 hours')
  ) AS v(k, pro, pax, sell, cost, floor, u, age)
 WHERE NOT EXISTS (SELECT 1 FROM core.quotations x WHERE x.id = pg_temp.demo_id(v.k))
 ORDER BY v.age DESC;

INSERT INTO core.quotation_lines (id, tenant_id, quotation_id, n, item, detail, basis, qty, unit, unit_price_sen, is_cost, created_at)
SELECT pg_temp.demo_id('ql:' || v.quo || ':' || v.n), c.t, pg_temp.demo_id(v.quo), v.n, v.item, v.detail, v.basis, v.qty, v.unit, v.price, v.is_cost, q.created_at
  FROM demo_ctx c, (VALUES
    ('quo:aurora',   1, 'TRAINER_FEE', 'Band A trainer · 2 days',          'PER_DAY',  2::numeric, 'DAY', 480000::bigint, true),
    ('quo:aurora',   2, 'VENUE',       'Client site · Aurora HQ Shah Alam', 'PER_UNIT', 0,          NULL,  0,              true),
    ('quo:aurora',   3, 'MATERIALS',   'Workbooks',                        'PER_PAX',  30,         'PAX', 4000,           true),
    ('quo:aurora',   4, 'TRAVEL',      'Klang Valley',                     'PER_UNIT', 2,          'TRIP', 30000,         true),
    ('quo:aurora',   5, 'SELL_PRICE',  'Quoted price to the client',       'PACKAGE',  1,          NULL,  1850000,        false),
    ('quo:meridian', 1, 'TRAINER_FEE', 'Band B trainer · 2 days',          'PER_DAY',  2,          'DAY', 360000,         true),
    ('quo:meridian', 2, 'VENUE',       'Own venue · Akademi Perdana',      'PER_UNIT', 1,          NULL,  90000,          true),
    ('quo:meridian', 3, 'MATERIALS',   'Workbooks',                        'PER_PAX',  22,         'PAX', 5500,           true),
    ('quo:meridian', 4, 'TRAVEL',      'Klang Valley',                     'PER_UNIT', 2,          'TRIP', 30000,         true),
    ('quo:meridian', 5, 'SELL_PRICE',  'Quoted price to the client',       'PACKAGE',  1,          NULL,  1920000,        false),
    ('quo:perdana',  1, 'TRAINER_FEE', 'Band B trainer · 2 days',          'PER_DAY',  2,          'DAY', 360000,         true),
    ('quo:perdana',  2, 'VENUE',       'Client site · Cyberjaya',          'PER_UNIT', 0,          NULL,  0,              true),
    ('quo:perdana',  3, 'MATERIALS',   'Workbooks',                        'PER_PAX',  35,         'PAX', 3500,           true),
    ('quo:perdana',  4, 'TRAVEL',      'Klang Valley',                     'PER_UNIT', 2,          'TRIP', 30000,         true),
    ('quo:perdana',  5, 'SELL_PRICE',  'Quoted price to the client',       'PACKAGE',  1,          NULL,  2180000,        false)
  ) AS v(quo, n, item, detail, basis, qty, unit, price, is_cost)
  JOIN core.quotations q ON q.id = pg_temp.demo_id(v.quo)
 WHERE NOT EXISTS (SELECT 1 FROM core.quotation_lines x WHERE x.id = pg_temp.demo_id('ql:' || v.quo || ':' || v.n));

-- ── Follow-up queue and drafted messages ─────────────────────────────────────────

INSERT INTO core.follow_ups (id, tenant_id, organisation_id, contact_id, proposal_id, reason, due_date, status, autonomy, owner_id, created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.demo_id(v.k), c.t, pg_temp.demo_id(v.org), pg_temp.demo_id(v.con),
       CASE WHEN v.pro IS NOT NULL THEN pg_temp.demo_id(v.pro) END,
       v.reason, current_date + v.due, v.status::core.follow_up_status, v.autonomy::core.autonomy_level,
       CASE v.u WHEN 1 THEN c.u1 ELSE c.u2 END, c.at - interval '6 hours', 'AGENT', 'agent_followup', 'Follow-up Agent'
  FROM demo_ctx c, (VALUES
    ('fup:aurora',   'org:aurora',   'con:nurul',    'pro:aurora',   'Proposal drafted · confirm November dates before sending',   0,  'DUE',       'SUGGEST', 1),
    ('fup:kenanga',  'org:kenanga',  'con:weisheng', NULL,           'Discovery call requested · no reply to two emails',          -3, 'OVERDUE',   'SUGGEST', 2),
    ('fup:meridian', 'org:meridian', 'con:faridah',  'pro:meridian', 'Needs analysis complete · decision promised this week',      -1, 'OVERDUE',   'SUGGEST', 1),
    ('fup:perdana',  'org:perdana',  'con:ganesh',   NULL,           'Start date still open · last contact two days ago',          1,  'DUE',       'SUGGEST', 2),
    ('fup:sutera',   'org:sutera',   'con:suresh',   NULL,           'Re-opened conversation · send the service catalogue',        2,  'DUE',       'SUGGEST', 2),
    ('fup:ravi',     'org:aurora',   'con:ravi',     NULL,           'Named on the delivery brief · no PDPA consent recorded',     4,  'DUE',       'OBSERVE', 1),
    ('fup:faridah2', 'org:meridian', 'con:faridah',  NULL,           'Last year''s cohort certificates · resend requested',       -6, 'SENT',      'SUGGEST', 1),
    ('fup:ganesh2',  'org:perdana',  'con:ganesh',   NULL,           'Safety brief shared · no response needed yet',               9,  'DISMISSED', 'OBSERVE', 2)
  ) AS v(k, org, con, pro, reason, due, status, autonomy, u)
 WHERE NOT EXISTS (SELECT 1 FROM core.follow_ups x WHERE x.id = pg_temp.demo_id(v.k));

INSERT INTO core.outbound_messages (id, tenant_id, purpose, channel, template_id, category, contact_id, to_address, follow_up_id, body, rate_per_message_sen, estimated_cost_sen, created_at, created_by_kind, created_by_id, created_by_name)
SELECT pg_temp.demo_id('msg:' || v.fup || ':' || v.channel), c.t, 'FOLLOWUP', v.channel::core.enquiry_channel,
       pg_temp.demo_id(CASE v.channel WHEN 'EMAIL' THEN 'tpl:fu-email' ELSE 'tpl:fu-wa' END), 'UTILITY',
       f.contact_id, CASE v.channel WHEN 'EMAIL' THEN k.email::text ELSE k.phone END, f.id, v.body,
       CASE v.channel WHEN 'EMAIL' THEN 0 ELSE 6 END, CASE v.channel WHEN 'EMAIL' THEN 0 ELSE 6 END,
       c.at - interval '2 hours', 'AGENT', 'agent_followup', 'Follow-up Agent'
  FROM demo_ctx c, (VALUES
    ('fup:aurora',   'EMAIL',    E'Dear Puan Nurul,\n\nThank you for completing the needs analysis. Before we send the proposal for Leading Through Change, could you confirm the November dates still work for your line managers?\n\nBest regards'),
    ('fup:aurora',   'WHATSAPP', 'Hi Puan Nurul, quick check before we send the leadership proposal: are the November dates still good for your team?'),
    ('fup:kenanga',  'EMAIL',    E'Dear Wei Sheng,\n\nChecking in on the discovery call for the store-manager programme. Would Thursday or Friday afternoon suit you for 30 minutes?\n\nBest regards'),
    ('fup:kenanga',  'WHATSAPP', 'Hi Wei Sheng, following up on the store-manager programme. Is there a good time this week for a 30-minute call?'),
    ('fup:meridian', 'EMAIL',    E'Dear Puan Faridah,\n\nFollowing up on the data literacy refresher for your planners. Happy to walk through the December plan whenever convenient.\n\nBest regards'),
    ('fup:meridian', 'WHATSAPP', 'Hi Puan Faridah, just following up on the December data literacy cohort. Any questions I can answer?'),
    ('fup:perdana',  'EMAIL',    E'Dear Encik Ganesh,\n\nTo hold trainers for the substation supervisors, could we agree a start week for the first cohort?\n\nBest regards'),
    ('fup:perdana',  'WHATSAPP', 'Hi Encik Ganesh, can we lock in a start week for the safety leadership cohorts?'),
    ('fup:sutera',   'EMAIL',    E'Dear Mr Suresh,\n\nGreat to hear from you again. Attached is our current service recovery catalogue for front office teams.\n\nBest regards')
  ) AS v(fup, channel, body)
  JOIN core.follow_ups f ON f.id = pg_temp.demo_id(v.fup)
  JOIN core.contacts k ON k.id = f.contact_id
 WHERE NOT EXISTS (SELECT 1 FROM core.outbound_messages x WHERE x.id = pg_temp.demo_id('msg:' || v.fup || ':' || v.channel));

-- ── Pending approvals ─────────────────────────────────────────────────────────────
-- Envelope first (QUEUED_FOR_APPROVAL), then the approval, then the link.
-- Assigned to the MDs alternately so badge_counts is non-zero for both; SLAs are
-- relative to the seed run so the inbox shows every urgency group.

CREATE TEMP TABLE demo_approvals ON COMMIT DROP AS
SELECT v.*,
       pg_temp.demo_id('act:' || v.key) AS action_id,
       pg_temp.demo_id('apv:' || v.key) AS approval_id,
       COALESCE((SELECT p.ref FROM core.proposals p WHERE p.id = pg_temp.demo_id(v.target)),
                (SELECT q.ref FROM core.quotations q WHERE q.id = pg_temp.demo_id(v.target)),
                (SELECT f.ref FROM core.follow_ups f WHERE f.id = pg_temp.demo_id(v.target)),
                (SELECT e.ref FROM core.enquiries e WHERE e.id = pg_temp.demo_id(v.target))) AS target_ref
  FROM (VALUES
    ('proposal-send', 'PROPOSAL_SEND',    'APV-01', 'pro:aurora',     'proposal',  'AGENT', 'agent_proposal',  'Proposal Agent',   0.82::numeric, 'ACT_WITH_APPROVAL', 1850000::bigint, 0.3838::numeric, 1, interval '3 hours',  false,
     'Send proposal · Aurora Manufacturing Sdn Bhd',
     'Value above the RM 15,000 threshold in policy APV-01.',
     '{"verdict":"SEND_AS_DRAFTED","rationale":"Both high-priority gaps are covered and the margin is above the 35% floor."}',
     '[{"n":1,"type":"TNA","ref":"tna:aurora","label":"Competency gaps confirmed by Nurul Hassan"},{"n":2,"type":"QUOTATION","ref":"quo:aurora","label":"Margin 38%, above the 35% floor"}]',
     '["Client asked for November specifically."]',
     '{"level":"MEDIUM","note":"The HRD Corp section still needs a human read before it leaves."}',
     '[{"op":"UPDATE","entity":"Proposal","description":"status DRAFT → SENT"},{"op":"ADD","entity":"Email","description":"To nurul.hassan@auroramfg.com.my with PDF attachment"},{"op":"UPDATE","entity":"Opportunity","description":"stage → PROPOSAL_SENT"}]'),
    ('discount',      'DISCOUNT_APPROVE', 'APV-02', 'quo:perdana',    'quotation', 'HUMAN', NULL,              NULL,               NULL,          NULL,                1380000,         0.3460,          2, interval '-1 hours', false,
     'Discount below floor · Perdana Utilities Berhad',
     'RM 13,800 is below the RM 14,170 catalogue floor for 45 pax; policy APV-02 requires a manager decision.',
     '{"verdict":"REQUEST_CHANGES","rationale":"A first engagement with a new utilities account; hold at the floor and offer a second cohort instead."}',
     '[{"n":1,"type":"QUOTATION","ref":"quo:perdana","label":"Margin 34.6% against a 35% floor"},{"n":2,"type":"PROPOSAL","ref":"pro:perdana","label":"Safety leadership, 35 pax, 2 days"}]',
     '["Below the catalogue floor, not only the margin floor."]',
     '{"level":"HIGH","note":"Sets the price anchor for a new account."}',
     '[{"op":"UPDATE","entity":"Quotation","description":"sellPrice RM 21,800 → RM 13,800"},{"op":"UPDATE","entity":"Proposal","description":"value RM 21,800 → RM 13,800"}]'),
    ('followup-send', 'FOLLOWUP_SEND',    'APV-08', 'fup:kenanga',    'follow_up', 'AGENT', 'agent_followup',  'Follow-up Agent',  0.88,          'ACT_WITH_APPROVAL', NULL,            NULL,            2, interval '2 days',   true,
     'Send follow-up · Kenanga Retail Group Berhad',
     'Two unanswered emails; a third touch goes to a human before it leaves.',
     '{"verdict":"SEND_AS_DRAFTED","rationale":"Contact has email consent on record and the tone is neutral."}',
     '[{"n":1,"type":"CONTACT","ref":"con:weisheng","label":"Email consent recorded"}]',
     '[]',
     '{"level":"LOW","note":"Active client with a clean history."}',
     '[{"op":"ADD","entity":"Email","description":"Follow-up to weisheng.lim@kenangaretail.com.my"}]'),
    ('proposal-send-meridian', 'PROPOSAL_SEND', 'APV-01', 'pro:meridian', 'proposal', 'AGENT', 'agent_proposal', 'Proposal Agent', 0.86, 'ACT_WITH_APPROVAL', 1920000, 0.4839, 1, interval '8 days', false,
     'Send proposal · Meridian Logistics Sdn Bhd',
     'Value above the RM 15,000 threshold in policy APV-01.',
     '{"verdict":"SEND_AS_DRAFTED","rationale":"Repeat cohort, direct gap match, margin 48%."}',
     '[{"n":1,"type":"TNA","ref":"tna:meridian","label":"Dashboard interpretation gap, high priority"},{"n":2,"type":"QUOTATION","ref":"quo:meridian","label":"Margin 48%, above the 35% floor"}]',
     '[]',
     '{"level":"LOW","note":"Repeat client; same programme as last year."}',
     '[{"op":"UPDATE","entity":"Proposal","description":"status DRAFT → SENT"},{"op":"ADD","entity":"Email","description":"To faridah.omar@meridianlog.com.my with PDF attachment"}]')
  ) AS v(key, action_type, policy_id, target, entity, kind, agent_id, agent_name, confidence, autonomy, value, margin, u, sla, bulk,
         subject, reason, recommendation, evidence, deviations, risk, diff);

-- Evidence refs are written as seed keys above and resolved to allocated refs here.
UPDATE demo_approvals AS a
   SET evidence = (
     SELECT jsonb_agg(item || jsonb_build_object('ref', COALESCE(
              (SELECT x.ref FROM core.proposals x WHERE x.id = pg_temp.demo_id(item->>'ref')),
              (SELECT x.ref FROM core.quotations x WHERE x.id = pg_temp.demo_id(item->>'ref')),
              (SELECT x.ref FROM core.tnas x WHERE x.id = pg_temp.demo_id(item->>'ref')),
              (SELECT x.ref FROM core.contacts x WHERE x.id = pg_temp.demo_id(item->>'ref')),
              (SELECT x.ref FROM core.enquiries x WHERE x.id = pg_temp.demo_id(item->>'ref')),
              item->>'ref')) ORDER BY ord)
       FROM jsonb_array_elements(a.evidence::jsonb) WITH ORDINALITY AS e(item, ord))::text;

DO $pol$
BEGIN
  IF EXISTS (SELECT 1 FROM demo_approvals a
              WHERE a.target_ref IS NULL
                 OR NOT EXISTS (SELECT 1 FROM core.action_policies p, demo_ctx c
                                 WHERE p.tenant_id = c.t AND p.id = a.policy_id AND p.action_type = a.action_type)) THEN
    RAISE EXCEPTION 'hosted demo seed: an approval names a policy the tenant does not have, or a target that does not exist';
  END IF;
END
$pol$;

INSERT INTO core.action_requests (id, tenant_id, action_type, target_ref, target_entity, target_id, value_sen, currency, requested_by_kind, requested_by_id, requested_by_role, confidence, reasoning, evidence, autonomy_level, matched_policy_id, status, created_at)
SELECT a.action_id, c.t, a.action_type, a.target_ref, a.entity, pg_temp.demo_id(a.target), a.value,
       CASE WHEN a.value IS NOT NULL THEN 'MYR' END,
       a.kind, CASE WHEN a.kind = 'HUMAN' THEN c.u2::text ELSE a.agent_id END,
       CASE WHEN a.kind = 'HUMAN' THEN 'MD' END,
       a.confidence, a.reason, a.evidence::jsonb, a.autonomy, a.policy_id, 'QUEUED_FOR_APPROVAL', c.at - interval '90 minutes'
  FROM demo_ctx c, demo_approvals a
 WHERE a.target_ref IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM core.action_requests x WHERE x.id = a.action_id);

INSERT INTO core.approval_requests (id, tenant_id, action_request_id, policy_id, action_type, subject, target_ref, value_sen, currency, margin_rate, requested_by_kind, requested_by_id, requested_by_name, confidence, autonomy, reason, recommendation, evidence, deviations, risk, diff, diff_hash, approver_role, assigned_to_id, assigned_to_name, sla_due_at, expires_at, bulk_approvable, status, created_at)
SELECT a.approval_id, c.t, a.action_id, a.policy_id, a.action_type, a.subject, a.target_ref, a.value,
       CASE WHEN a.value IS NOT NULL THEN 'MYR' END, a.margin,
       a.kind, CASE WHEN a.kind = 'HUMAN' THEN c.u2::text ELSE a.agent_id END,
       CASE WHEN a.kind = 'HUMAN' THEN c.u2n ELSE a.agent_name END,
       a.confidence, a.autonomy, a.reason, a.recommendation::jsonb, a.evidence::jsonb, a.deviations::jsonb, a.risk::jsonb,
       a.diff::jsonb, encode(sha256(convert_to(a.diff::jsonb::text, 'UTF8')), 'hex'),
       'MD', CASE a.u WHEN 1 THEN c.u1 ELSE c.u2 END::text, CASE a.u WHEN 1 THEN c.u1n ELSE c.u2n END,
       c.at + a.sla, c.at + a.sla + interval '1 day', a.bulk, 'PENDING', c.at - interval '90 minutes'
  FROM demo_ctx c, demo_approvals a
  JOIN core.action_requests r ON r.id = a.action_id
 WHERE NOT EXISTS (SELECT 1 FROM core.approval_requests x WHERE x.id = a.approval_id);

UPDATE core.action_requests AS r
   SET approval_request_id = a.approval_id
  FROM demo_approvals a, demo_ctx c
 WHERE r.tenant_id = c.t AND r.id = a.action_id AND r.approval_request_id IS NULL
   AND EXISTS (SELECT 1 FROM core.approval_requests x WHERE x.id = a.approval_id);

-- ── Flush the deferred money checks inside this file, not at COMMIT ───────────────

SET CONSTRAINTS core.trg_quotation_reconciled, core.trg_quotation_floor IMMEDIATE;
SET CONSTRAINTS core.trg_quotation_reconciled, core.trg_quotation_floor DEFERRED;

DROP TABLE pg_temp.demo_approvals;
