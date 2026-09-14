-- ═══════════════════════════════════════════════════════════════════════════
-- 035 · core.get_follow_up_draft: pg_catalog.trim(text) does not exist
-- ═══════════════════════════════════════════════════════════════════════════
--
-- THE BUG, reported by api-026 and confirmed on the shim. 021's `core.
-- get_follow_up_draft` calls `pg_catalog.trim(pg_catalog.to_char(...))` with
-- ONE argument, to strip the padding `to_char`'s `FM9990.000000` mask leaves.
-- PostgreSQL has no one-argument `trim(text)` function: the SQL-standard form
-- is `trim([leading|trailing|both] [characters] FROM string)`, which the
-- parser rewrites to a call with a DIFFERENT signature depending on how many
-- of the optional parts are given, and the plain two-argument form is
-- `trim(string, characters)`; there is no overload that takes the STRING
-- ALONE. `btrim(string)` is the one-argument form that exists — it is what
-- the zero-argument `trim(string)` spelling is sometimes mistaken for.
--
-- Confirmed directly: `SELECT pg_catalog.trim(' hello ');` raises
-- `ERROR: function pg_catalog.trim(unknown) does not exist`, while
-- `SELECT pg_catalog.btrim(' hello ');` returns `hello`.
--
-- WHEN IT FIRES. Only inside the `IF v_source <> 'UNAVAILABLE'` branch, and
-- only when `COALESCE(v_draft.rate_per_message_exact, v_rate.rate_exact)
-- IS NOT NULL` — i.e. exactly when there IS a real, priced rate to show the
-- unrounded value of. A follow-up draft whose rate lookup failed
-- (`v_source = 'UNAVAILABLE'`) or whose exact rate was never stored never
-- reaches the call and never raises; every draft that HAS a real per-message
-- rate does, which is the live Follow-ups draft pane's own everyday case,
-- reported as a 500.
--
-- THE FIX. One token: `pg_catalog.trim(` → `pg_catalog.btrim(`. Nothing else
-- in the function changes — same permission gate, same channel validation,
-- same NOT_FOUND shape, same rateSource derivation, same money fields, same
-- provenance block.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL client_min_messages = warning;

DO $preflight$
BEGIN
  IF pg_catalog.to_regprocedure('core.get_follow_up_draft(text,text)') IS NULL THEN
    RAISE EXCEPTION '035 preflight: core.get_follow_up_draft(text,text) is absent; 021 has not been applied';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION core.get_follow_up_draft(p_id text, p_channel text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_tenant  uuid := app.require_tenant_id();
  v_follow  core.follow_ups%ROWTYPE;
  v_draft   core.outbound_messages%ROWTYPE;
  v_rate    core.message_rates%ROWTYPE;
  v_consent core.contact_consents%ROWTYPE;
  v_source  text;
  v_out     jsonb;
BEGIN
  -- 021 · AUTHZ FIRST: decided before any read or validation, so the refusal
  -- is identical for every argument.
  IF NOT app.has_permission('followup:read') THEN
    RETURN app.err('FORBIDDEN', pg_catalog.jsonb_build_object(
      'requiredPermission','followup:read'));
  END IF;

  IF p_channel IS NULL OR p_channel NOT IN ('EMAIL','WHATSAPP') THEN
    RETURN app.err('VALIDATION_FAILED', pg_catalog.jsonb_build_object(
      'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'field','channel','reason','UNSUPPORTED_CHANNEL'))));
  END IF;

  SELECT follow_up.* INTO v_follow FROM core.follow_ups AS follow_up
   WHERE follow_up.tenant_id = v_tenant
     AND (follow_up.id::text = p_id OR follow_up.ref = p_id);
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object('id', p_id));
  END IF;

  -- A DRAFT IS PER CHANNEL. The fixtures oracle keys its store
  -- `<followUpRef>::<CHANNEL>` and 404s per channel rather than handing back an
  -- empty draft, because an empty draft renders as a composer with nothing in
  -- it and reads as "the agent wrote nothing" instead of "nothing was drafted
  -- for this channel".
  SELECT message.* INTO v_draft FROM core.outbound_messages AS message
   WHERE message.tenant_id = v_tenant
     AND message.follow_up_id = v_follow.id
     AND message.channel::text = p_channel
   ORDER BY message.created_at DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND', pg_catalog.jsonb_build_object(
      'id', v_follow.ref, 'channel', p_channel));
  END IF;

  SELECT rate.* INTO v_rate FROM core.message_rates AS rate
   WHERE rate.tenant_id = v_tenant AND rate.id = v_draft.message_rate_id;

  SELECT consent.* INTO v_consent FROM core.contact_consents AS consent
   WHERE consent.tenant_id = v_tenant
     AND consent.contact_id = v_follow.contact_id
     AND consent.channel::text = p_channel
     AND consent.withdrawn_at IS NULL
   ORDER BY consent.recorded_at DESC
   LIMIT 1;

  -- §16 Q4 / RULING R11 — THE FAILURE IS A VALUE, NOT A ZERO.
  -- `rateSource` is REQUIRED and the two money fields are OPTIONAL precisely so
  -- that a failed rate lookup has an honest answer. A server whose lookup
  -- failed has no number to send, and sending a stale rate or a zero and
  -- rendering it to four decimal places is the most convincing way to be wrong
  -- about money. UNAVAILABLE when there is no rate row; CACHED when the row has
  -- gone past `stale_after`; LIVE otherwise.
  v_source := CASE
                WHEN v_rate.id IS NULL OR v_draft.rate_per_message_sen IS NULL THEN 'UNAVAILABLE'
                WHEN v_rate.stale_after IS NOT NULL AND v_rate.stale_after < pg_catalog.now() THEN 'CACHED'
                ELSE 'LIVE'
              END;

  v_out := pg_catalog.jsonb_build_object(
    'channel',    v_draft.channel::text,
    'templateId', v_draft.template_id::text,
    'category',   COALESCE(v_draft.category::text, 'UTILITY'),
    'body',       COALESCE(v_draft.body, ''),
    'recipients', 1,
    'rateSource', v_source,
    'consent', pg_catalog.jsonb_build_object(
      'channel',    p_channel,
      'granted',    COALESCE(v_consent.granted, false),
      'recordedAt', v_consent.recorded_at));

  IF v_source <> 'UNAVAILABLE' THEN
    v_out := v_out
      || pg_catalog.jsonb_build_object('ratePerMessage',
           app._money(v_draft.rate_per_message_sen, v_draft.currency::text))
      || pg_catalog.jsonb_build_object('estimatedCost',
           app._money(COALESCE(v_draft.estimated_cost_sen, v_draft.rate_per_message_sen),
                      v_draft.currency::text));
    -- The UNROUNDED rate as a string, because §4's marketing rate is RM 0.3467
    -- and the utility rate RM 0.0564: rounded to the sen the strip would print
    -- RM 0.35 beside RM 0.06 and the six-fold difference it exists to show
    -- would be read off two different precisions.
    -- ⚠ 035: pg_catalog.trim(text) — one argument — does not exist as a
    -- PostgreSQL function (SQL-standard TRIM(FROM ...) and the two-argument
    -- trim(string, characters) both exist; the one-argument form does not).
    -- pg_catalog.btrim(text) is the one-argument form that does. This is the
    -- single line 035 changes.
    IF COALESCE(v_draft.rate_per_message_exact, v_rate.rate_exact) IS NOT NULL THEN
      v_out := v_out || pg_catalog.jsonb_build_object('ratePerMessageExact',
        pg_catalog.btrim(pg_catalog.to_char(
          COALESCE(v_draft.rate_per_message_exact, v_rate.rate_exact), 'FM9990.000000')));
    END IF;
  END IF;

  IF v_source = 'CACHED' AND v_rate.fetched_at IS NOT NULL THEN
    v_out := v_out || pg_catalog.jsonb_build_object('rateFetchedAt', v_rate.fetched_at);
  END IF;

  IF app._provenance('outbound_messages', v_draft.id, NULL) IS NOT NULL THEN
    v_out := v_out || pg_catalog.jsonb_build_object('provenance',
      app._provenance('outbound_messages', v_draft.id, NULL));
  END IF;

  RETURN app.ok(v_out);
END;
$fn$;

-- Grants unchanged: 021 already grants this to authenticated (it is gated on
-- followup:read internally, the same posture as every other 018/021 read
-- RPC), and CREATE OR REPLACE on an unchanged signature does not reset them.
-- check:grants M2: reasserted here anyway so this migration is self-contained.
REVOKE ALL ON FUNCTION core.get_follow_up_draft(text,text) FROM PUBLIC, anon;

DO $verify$
DECLARE v_body text;
BEGIN
  v_body := app._body_sql('core.get_follow_up_draft(text,text)'::regprocedure);
  IF pg_catalog.strpos(v_body, 'pg_catalog.trim(') > 0 THEN
    RAISE EXCEPTION '035 verify: get_follow_up_draft still calls the nonexistent pg_catalog.trim(text)';
  END IF;
  IF pg_catalog.strpos(v_body, 'pg_catalog.btrim(') = 0 THEN
    RAISE EXCEPTION '035 verify: get_follow_up_draft does not call pg_catalog.btrim(text)';
  END IF;
END
$verify$;

COMMIT;
