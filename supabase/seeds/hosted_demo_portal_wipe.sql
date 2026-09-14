-- Removes what supabase/seeds/hosted_demo_portal.sql added to tenant
-- `akademi-perdana`, and what the envelope and the portal wrote because of it.
--
-- Run BEFORE hosted_demo_wipe.sql (its guard refuses while these rows reference
-- the demo organisation, template, programme and rate card):
--   psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/seeds/hosted_demo_portal_wipe.sql
--
-- What is removed, all keyed to the one portal demo proposal
-- (pg_temp.portal_id('pro:auroratl'), in the d0280a11-5eed-4… range):
--   * what a client did on the link: portal_acceptances, the CLICKWRAP
--     signatures they point at, the engagement the accept created,
--     portal_comments, public_share_tokens;
--   * what the send wrote through 011: the PROPOSAL_SEND action request, its
--     effects, outbox jobs and their provider-attempt counter, approval request
--     and decision, and the two `hosted-demo-portal:` idempotency keys;
--   * the seed's own rows: quotation lines, quotation, proposal (its sections
--     by cascade), opportunity, consent, contact.
--
-- Not removed, by design:
--   * core.events. 012 makes the event log append-only (events_append_only
--     rejects DELETE), so a `ProposalAccepted` event written by a real accept on
--     the link stays as history. Events carry no foreign key to the proposal.
--   * core.ref_sequences. Refs are never reused (004).
--
-- Refused, with nothing changed, when the accept's engagement has grown rows a
-- person added (sessions, bookings, packets, invoices…): those are real work,
-- and deleting the engagement would take them with it or fail half way.

DROP TABLE IF EXISTS pg_temp.portal_wipe_ctx;
CREATE TEMP TABLE portal_wipe_ctx ON COMMIT DROP AS
SELECT tenant.id AS t,
       ('d0280a11-5eed-4' || substr(h, 1, 3) || '-8' || substr(h, 4, 3) || '-' || substr(h, 7, 12))::uuid AS pro
  FROM public.tenants AS tenant,
       (SELECT md5('akademi-perdana:hosted-demo-portal:pro:auroratl') AS h) AS k
 WHERE tenant.slug = 'akademi-perdana';

DO $wipe$
DECLARE
  v_t         uuid;
  v_pro       uuid;
  v_actions   uuid[];
  v_approvals uuid[];
  v_eng       uuid[];
  v_sigs      uuid[];
  fk          record;
  v_n         bigint;
  v_blockers  text[] := ARRAY[]::text[];
BEGIN
  IF (SELECT count(*) FROM portal_wipe_ctx) <> 1 THEN
    RAISE EXCEPTION 'portal demo wipe: tenant akademi-perdana not found';
  END IF;
  SELECT t, pro INTO v_t, v_pro FROM portal_wipe_ctx;

  SELECT COALESCE(array_agg(e.id), ARRAY[]::uuid[]) INTO v_eng
    FROM core.engagements e WHERE e.tenant_id = v_t AND e.proposal_id = v_pro;
  SELECT COALESCE(array_agg(a.signature_id) FILTER (WHERE a.signature_id IS NOT NULL), ARRAY[]::uuid[]) INTO v_sigs
    FROM core.portal_acceptances a WHERE a.tenant_id = v_t AND a.proposal_id = v_pro;
  SELECT COALESCE(array_agg(r.id), ARRAY[]::uuid[]) INTO v_actions
    FROM core.action_requests r WHERE r.tenant_id = v_t AND r.target_id = v_pro;
  SELECT COALESCE(array_agg(a.id), ARRAY[]::uuid[]) INTO v_approvals
    FROM core.approval_requests a WHERE a.tenant_id = v_t AND a.action_request_id = ANY (v_actions);

  -- Every FK into the engagement other than the acceptance that created it.
  FOR fk IN
    SELECT con.conrelid::regclass AS child, a.attname AS col, con.conname
      FROM pg_catalog.pg_constraint con
      JOIN pg_catalog.pg_attribute a
        ON a.attrelid = con.conrelid AND a.attnum = con.conkey[2]
     WHERE con.contype = 'f' AND con.confrelid = 'core.engagements'::regclass
       AND con.conrelid <> 'core.portal_acceptances'::regclass
       AND array_length(con.conkey, 1) = 2
  LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE tenant_id = $1 AND %I = ANY ($2)', fk.child, fk.col)
       INTO v_n USING v_t, v_eng;
    IF v_n > 0 THEN
      v_blockers := v_blockers || format('%s (%s): %s row(s)', fk.child, fk.conname, v_n);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM core.attendance_entries x WHERE x.tenant_id = v_t AND x.signature_id = ANY (v_sigs)) THEN
    v_blockers := v_blockers || 'core.attendance_entries (ae_signature_fk)'::text;
  END IF;
  IF cardinality(v_blockers) > 0 THEN
    RAISE EXCEPTION 'portal demo wipe refused: rows a person added reference the portal demo engagement: %',
      array_to_string(v_blockers, '; ');
  END IF;

  -- What the client did on the link.
  DELETE FROM core.portal_acceptances WHERE tenant_id = v_t AND proposal_id = v_pro;
  DELETE FROM core.engagements        WHERE tenant_id = v_t AND id = ANY (v_eng);
  DELETE FROM core.signatures         WHERE tenant_id = v_t AND id = ANY (v_sigs);
  DELETE FROM core.portal_comments    WHERE tenant_id = v_t AND proposal_id = v_pro;
  DELETE FROM core.public_share_tokens WHERE tenant_id = v_t AND proposal_id = v_pro;

  -- What the send wrote through 011. The request and its approval point at
  -- each other, so the request's pointer is cleared first.
  DELETE FROM app.outbox           WHERE tenant_id = v_t AND action_request_id = ANY (v_actions);
  -- The effect's provider-attempt counter is keyed by '<Entity>:<proposal ref>'.
  DELETE FROM app.submission_counters WHERE tenant_id = v_t
     AND subject LIKE '%:' || (SELECT ref FROM core.proposals WHERE tenant_id = v_t AND id = v_pro);
  DELETE FROM app.idempotency_keys WHERE tenant_id = v_t
     AND (action_request_id = ANY (v_actions) OR key LIKE 'hosted-demo-portal:%');
  UPDATE core.action_requests SET approval_request_id = NULL
   WHERE tenant_id = v_t AND id = ANY (v_actions) AND approval_request_id IS NOT NULL;
  DELETE FROM core.approval_decisions WHERE tenant_id = v_t AND approval_request_id = ANY (v_approvals);
  DELETE FROM core.approval_requests  WHERE tenant_id = v_t AND id = ANY (v_approvals);
  DELETE FROM core.action_requests    WHERE tenant_id = v_t AND id = ANY (v_actions);

  -- The seed's own rows. Sections go by the proposal's cascade: 007's freeze
  -- trigger refuses a direct DELETE of a SENT or ACCEPTED proposal's section.
  DELETE FROM core.quotation_lines   WHERE tenant_id = v_t AND id::text LIKE 'd0280a11-5eed-4%';
  DELETE FROM core.quotations        WHERE tenant_id = v_t AND id::text LIKE 'd0280a11-5eed-4%';
  DELETE FROM core.proposals         WHERE tenant_id = v_t AND id::text LIKE 'd0280a11-5eed-4%';
  DELETE FROM core.opportunities     WHERE tenant_id = v_t AND id::text LIKE 'd0280a11-5eed-4%';
  DELETE FROM core.contact_consents  WHERE tenant_id = v_t AND id::text LIKE 'd0280a11-5eed-4%';
  DELETE FROM core.contacts          WHERE tenant_id = v_t AND id::text LIKE 'd0280a11-5eed-4%';

  RAISE NOTICE 'portal demo wipe: removed % engagement(s), % action request(s), % approval(s); core.events kept (append-only)',
    cardinality(v_eng), cardinality(v_actions), cardinality(v_approvals);
END
$wipe$;
