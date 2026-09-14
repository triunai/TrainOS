-- ═══════════════════════════════════════════════════════════════════════════
-- 031 ROLLBACK · Membership actor_kind lock
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Drops the trigger and its function, and restores 002's original
-- `app.principal_claims(uuid)` body verbatim — reopening C1 exactly as it
-- was before 031: an ADMIN can UPDATE another member's actor_kind to SYSTEM
-- or AGENT, and the hook copies it straight into the next session's claims.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL client_min_messages = warning;

DROP TRIGGER IF EXISTS memberships_actor_kind_lock ON public.memberships;
DROP FUNCTION IF EXISTS app.enforce_membership_actor_kind_lock();

CREATE OR REPLACE FUNCTION app.principal_claims(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE m record;
BEGIN
  SELECT mb.tenant_id, mb.role, mb.actor_kind, mb.agent_id,
         mb.primary_team_id, mb.trainer_id, mb.client_scope, mb.team_scope,
         mb.mfa_required
    INTO m
  FROM public.memberships mb
  JOIN public.tenants t ON t.id = mb.tenant_id
  WHERE mb.user_id = p_user_id
    AND mb.status  = 'ACTIVE'
    AND t.status   = 'ACTIVE'
  ORDER BY mb.is_default DESC, mb.created_at ASC
  LIMIT 1;

  IF m.tenant_id IS NULL THEN
    RETURN jsonb_build_object('tenant_id', NULL, 'app_role', NULL, 'actor_kind', 'HUMAN');
  END IF;

  RETURN jsonb_build_object(
    'tenant_id',    m.tenant_id,
    'app_role',     m.role,
    'actor_kind',   m.actor_kind,
    'agent_id',     m.agent_id,
    'team_id',      m.primary_team_id,
    'trainer_id',   m.trainer_id,
    'client_scope', m.client_scope,
    'team_scope',   m.team_scope,
    'mfa_required', m.mfa_required
  );
END;
$fn$;

-- 002 never put a COMMENT ON app.principal_claims itself (the comment quoted
-- at 002:589 belongs to app.custom_access_token_hook, untouched by 031 and
-- not touched here). 031's forward migration adds one; restoring "no comment"
-- is part of restoring 002's exact prior state.
COMMENT ON FUNCTION app.principal_claims(uuid) IS NULL;

DO $verify$
DECLARE v_body text;
BEGIN
  IF pg_catalog.to_regprocedure('app.enforce_membership_actor_kind_lock()') IS NOT NULL THEN
    RAISE EXCEPTION '031 rollback verify: enforce_membership_actor_kind_lock still exists';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
     WHERE t.tgrelid = 'public.memberships'::regclass
       AND t.tgname = 'memberships_actor_kind_lock')
  THEN
    RAISE EXCEPTION '031 rollback verify: memberships_actor_kind_lock trigger still exists';
  END IF;
  v_body := app._body_sql('app.principal_claims(uuid)'::regprocedure);
  IF pg_catalog.strpos(v_body, 'SYSTEM'' THEN ''HUMAN''') > 0 THEN
    RAISE EXCEPTION '031 rollback verify: principal_claims still carries 031''s fail-close';
  END IF;
END
$verify$;

COMMIT;
