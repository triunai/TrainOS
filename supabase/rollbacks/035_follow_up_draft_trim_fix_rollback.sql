-- ═══════════════════════════════════════════════════════════════════════════
-- 035 ROLLBACK · core.get_follow_up_draft trim fix
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Restores 021's original body verbatim, including the `pg_catalog.trim(
-- text)` call this migration's header documents as calling a function that
-- does not exist. Same signature, no data touched (a read).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL client_min_messages = warning;

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
    IF COALESCE(v_draft.rate_per_message_exact, v_rate.rate_exact) IS NOT NULL THEN
      v_out := v_out || pg_catalog.jsonb_build_object('ratePerMessageExact',
        pg_catalog.trim(pg_catalog.to_char(
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

DO $verify$
DECLARE v_body text;
BEGIN
  v_body := app._body_sql('core.get_follow_up_draft(text,text)'::regprocedure);
  IF pg_catalog.strpos(v_body, 'pg_catalog.btrim(') > 0 THEN
    RAISE EXCEPTION '035 rollback verify: get_follow_up_draft still calls pg_catalog.btrim(text)';
  END IF;
END
$verify$;

COMMIT;
