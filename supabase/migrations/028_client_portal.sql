-- ============================================================================
-- Migration 028: the client portal — the three token-authorised RPCs behind
-- `/p/:token` (M07-S07), and the only functions in the database `anon` may call.
-- ============================================================================
--
-- FEATURE. `apps/web/src/features/portal/api.ts` calls getPortalProposal,
-- addPortalComment and acceptPortalProposal. On Supabase all three rejected
-- NOT_DEPLOYED: 007 built the tables (public_share_tokens, portal_comments,
-- portal_acceptances) and no function ever read them. Since PR #35 the route
-- sits OUTSIDE the session guard, so the caller is `anon` (no session) or
-- `authenticated` (a signed-in person who is not necessarily a member of the
-- tenant that sent the link). Neither role's JWT says anything about the
-- proposal. The token in the URL is the ONLY credential.
--
-- DEPENDS ON 001–021 ONLY.
--
-- ── WHAT IS HERE ─────────────────────────────────────────────────────────
--
--   core.get_portal_proposal(p_token text)                  -> PortalProposal
--   core.add_portal_comment(p_token text, p_body jsonb)     -> PortalProposal
--   core.accept_portal_proposal(p_token text, p_body jsonb) -> PortalAcceptResponse
--
--   app.portal_token_hash(text)             the ONE definition of the stored hash
--   app.issue_portal_token(uuid,uuid,interval) mints a token, returns it once
--   app._resolve_portal_token(text)         the ONE credential check
--   app._portal_proposal(uuid,uuid)         the ONE client-safe projection
--   app._portal_text(jsonb,text,int,bool)   body-field validation
--
-- ── THE CREDENTIAL ───────────────────────────────────────────────────────
--
--   FORMAT. `tk_pt_` + base64url(extensions.gen_random_bytes(32)): 49
--   characters, 256 bits from the platform CSPRNG. The same generator and the
--   same rendering 013's app.mint_agent_key uses (013:1115), with a prefix of
--   the same shape so a secret scanner can recognise a leaked link.
--
--   STORAGE. Only `sha256(token)` is written, into 007's
--   public_share_tokens.token_hash, which carries a GLOBAL unique index. The raw
--   token is a RETURN VALUE of app.issue_portal_token, never a parameter of
--   anything that stores it, so it lands in no table, no statement log and no
--   pg_stat_activity row. A database dump hands nobody a live link.
--   Unsalted SHA-256 is sufficient at 256 bits of entropy: there is no
--   dictionary to precompute (013 makes the same argument for agent keys).
--
--   COMPARISON. Hash-then-lookup: the caller's token is hashed and the hash is
--   an indexed equality. The attacker controls the input to SHA-256, not the
--   bytes being compared, so the index walk's timing reveals nothing about any
--   stored token. There is no byte-wise compare of secret material anywhere.
--
--   BRUTE FORCE. Not rate-limited in the database, deliberately. Guessing a
--   live token is a 2^256 search; a per-attempt counter would turn every
--   anonymous wrong guess into a WRITE, which is a cheaper denial of service
--   than the guessing it claims to prevent. The input is rejected by shape
--   (`^tk_pt_[A-Za-z0-9_-]{43}$`) before it is hashed, so an oversized or
--   malformed value costs one regex. Edge rate limiting is PostgREST's/the
--   gateway's to add; nothing here depends on it.
--
--   VALIDITY. A token resolves only if ALL hold, checked in one place
--   (app._resolve_portal_token) and re-read by every RPC:
--     target_kind = 'PROPOSAL'        (a TNA token opens nothing here)
--     revoked_at IS NULL
--     expires_at > now()              (007 defaults 30 days)
--     tenant.status = 'ACTIVE'        (a suspended provider's links go dark)
--     proposal.status IN (SENT, VIEWED, ACCEPTED)
--   DRAFT and AWAITING_APPROVAL are unapproved text and never client-visible,
--   even with a valid token. LOST is withdrawn. One token names exactly one
--   proposal (007's pst_exactly_one_target), and the tenant is RESOLVED FROM
--   THE TOKEN, never read from the JWT: a caller signed in to tenant B holding
--   a tenant-A link sees tenant A's one proposal and nothing else, and a JWT
--   tenant claim cannot steer the lookup anywhere.
--
--   NON-ENUMERABLE. Every failure above — no such token, wrong shape, expired,
--   revoked, TNA token, suspended tenant, proposal not client-visible — is the
--   SAME answer: the read returns `app.err('NOT_FOUND')` with no details; the
--   two writes raise TRNOS `{"code":"NOT_FOUND"}` with the same fixed message.
--   Nothing echoes the token back. Body validation runs AFTER the token check,
--   so a caller without a valid link cannot learn what the writes accept
--   (011's guard c2 ordering, for the same reason).
--
-- ── THE PROJECTION: CLIENT-VISIBLE FIELDS ONLY ───────────────────────────
--
--   app._portal_proposal builds the contract's PortalProposal and reads nothing
--   else. Never selected: quotations and their lines (cost, margin, floor,
--   commission), proposals.margin_rate, provenance/run ids, needs_review,
--   merge_fields_used, approval or action rows, internal ids, other proposals.
--   investment.total is proposals.value_sen — the figure that was approved and
--   sent. `levyAvailable` is OMITTED (it is optional): it is the client's HRD
--   Corp levy statement as the provider pulled it, and a link can be forwarded.
--   vendorContact is the opportunity owner's profile name and email with their
--   role label (the web's ROLE_LABEL wording); phone is '' because no column
--   holds a staff phone number. Comments are the portal thread only (CLIENT and
--   HUMAN authors), as plain text.
--
-- ── WRITES ───────────────────────────────────────────────────────────────
--
--   COMMENT. author 1–120 chars, body 1–4000 chars after trimming; control
--   characters other than tab/newline/CR are refused (none in author). HTML is
--   NOT stripped or escaped: it is stored and returned as the literal text the
--   client typed, and the page renders text nodes only (React escapes; nothing
--   in features/portal uses dangerouslySetInnerHTML). Escaping at write time
--   would corrupt the legal record 007's author_name comment describes. A
--   proposal holds at most 200 comments; the 201st is VALIDATION_FAILED
--   `COMMENT_LIMIT_REACHED`, which bounds what an anonymous link-holder can
--   write. Allowed on an ACCEPTED proposal (the fixture's "the one write a
--   client may make on a locked proposal").
--
--   ACCEPT. name and role 1–120 chars. Under a FOR UPDATE lock on the proposal
--   (parent before child, 010:788's order): if a portal_acceptances row exists,
--   return IT — the original engagementRef, acceptedAt, signatureRef — whatever
--   name the replay sends (§11 "idempotent by token"). Otherwise, from SENT or
--   VIEWED: a CLICKWRAP core.signatures row, a PROPOSED core.engagements row
--   (programme, owner = opportunity owner, the tenant's default ENGAGEMENT
--   pipeline, value = proposal value), the portal_acceptances row, the proposal
--   to ACCEPTED, and one `ProposalAccepted` event. 007's UNIQUE (tenant_id,
--   proposal_id) backs the lock at the storage layer. Refused after expiry or
--   revocation like everything else (NOT_FOUND).
--
-- ── WHY ACCEPT DOES NOT GO THROUGH app.perform_action ────────────────────
--
--   A deliberate choice against 021, stated so it can be checked:
--
--   1. The envelope's authority is a JWT principal. app.perform_action takes
--      the tenant from app.require_tenant_id() and the actor and role from
--      app.current_actor(). An anonymous token-holder has none of them. The two
--      ways to force it through both WEAKEN what 011/021 decided:
--        (a) forge request.jwt.claims for a CLIENT principal inside a definer —
--            manufacturing a principal, which is exactly what 011 guard a
--            refuses and a pattern every later definer could copy; or
--        (b) seed a CLIENT permission (e.g. `portal:proposal:accept`) in
--            app.role_permissions. 011:2303 made CLIENT fail closed BECAUSE a
--            tenant ADMIN can mint a `memberships.actor_kind = 'CLIENT'` row;
--            that member could then accept ANY proposal in the tenant through
--            core.perform_action with no token at all.
--      So 028 seeds NO permission, adds NO action type, and leaves CLIENT
--      exactly as fail-closed as 021 left it. `$verify$` asserts CLIENT still
--      holds zero role_permissions rows.
--   2. Nothing is bypassed. 011's registry makes SENT→ACCEPTED, VIEWED→ACCEPTED
--      and NULL→PROPOSED (engagements) UNGATED edges (gated_by NULL). The
--      UPDATE and INSERT below still fire proposals_state_gate and
--      engagements_state_gate, so an illegal edge (a DRAFT, a LOST) is refused
--      by 011's own trigger even if this function's checks were wrong.
--   3. Idempotency is stronger here than the envelope's: 011 keys replay by
--      (tenant, actor_id, key) and an anonymous caller has no stable actor_id;
--      the acceptance is keyed by the proposal itself.
--   4. Accountability is the event: `ProposalAccepted` through app.emit_event
--      (the only write path into core.events), actor
--      `{kind: CLIENT, id: 'portal:<share token id>', name}`, idempotency key
--      `portal-accept:<proposal id>`.
--   5. AAL2 (011 H-05) governs a tenant principal committing the tenant's
--      money. The acceptor is the tenant's CUSTOMER and commits nothing of the
--      tenant's; there is no GoTrue session to be aal2 about.
--
--   WHY IT CANNOT BE REUSED. The three RPCs take a token and a body, nothing
--   else: no tenant, no proposal id, no status, no actor. The tenant and the
--   proposal come only from app._resolve_portal_token, so the reach of a call is
--   exactly one proposal that a staff member has already sent and minted a link
--   for. The only state change is that proposal to ACCEPTED plus the three rows
--   that record it. app.issue_portal_token, app._resolve_portal_token and
--   app._portal_proposal are granted to nobody.
--
-- ── AUTHORIZATION ────────────────────────────────────────────────────────
--
--   anon, authenticated: EXECUTE on the three core RPCs, by full signature.
--   anon: USAGE on schema `core`. 014:941 revoked it because anon then held no
--   object in `core` ("a door into an empty room"). PostgREST resolves
--   `core.get_portal_proposal` as the request's role and needs schema USAGE to
--   do it, so the portal is unreachable without it. The room is no longer
--   empty, and `$verify$` measures what is in it instead of trusting the
--   revoke: anon may EXECUTE exactly these three functions in `core` and NONE
--   in `app` or `public`, and holds no table, view, sequence or column
--   privilege in any of the three schemas. The rollback restores 014's revoke.
--   No permission is added to app.role_permissions: the token is the
--   authority, and a role check would be answered by whatever JWT the browser
--   happens to hold.
--   `scripts/check-grants.mjs` ANON_EXECUTE_ALLOWLIST names the same three.
--
--   search_path = '' (supabase/CLAUDE.md rule 1, test_001 T3). With the empty
--   path pg_catalog is still searched first for every name and pg_temp is never
--   searched for functions or operators; every relation and type here is
--   schema-qualified, which is what makes the empty path safe.
--   statement_timeout 10s on the three RPCs, the pack's one client-callable
--   timeout (test_018 T20e holds every client-callable core definer to it).
--
-- ── THE 7-POINT RPC CONTRACT CHECK, worked ───────────────────────────────
--   1. Envelope: every RPC returns app.ok(...) or app.err(...); writes raise
--      TRNOS for refusals (011's channel), which rpcClient.ts classify() maps.
--   2. Unwrap: app.ok's single `data` key; PortalProposal / PortalAcceptResponse
--      are the whole `data`.
--   3. RpcMap: client.ts getPortalProposal / addPortalComment /
--      acceptPortalProposal, return types from @trainos/contract.
--   4. Call sites: features/portal/api.ts, through apiClient.ts adapters.
--   5. Casts: none on the wire; money is integer sen, `hrdcClaimableUpTo` a
--      number, timestamps timestamptz → ISO strings, issuedAt a DateOnly in the
--      tenant's timezone.
--   6. Reload/restore: GET is a pure read of the token plus bookkeeping
--      (last_accessed_at, access_count), so a reload re-renders the same page.
--   7. Public routes: `/p/:token` — this migration IS the public route's server.
--
-- SPINE: the action envelope is untouched (no action type, no dispatch arm,
-- no permission). Pipeline configuration is read, never hardcoded: the
-- engagement goes on the tenant's `is_default` ENGAGEMENT pipeline.
--
-- Rollback: rollbacks/028_client_portal_rollback.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ═══ 1 · The hash and the mint ═════════════════════════════════════════════

CREATE OR REPLACE FUNCTION app.portal_token_hash(p_token text)
RETURNS bytea
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $fn$
  SELECT pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8'));
$fn$;

COMMENT ON FUNCTION app.portal_token_hash(text) IS
  '028. The ONE definition of what core.public_share_tokens.token_hash stores for a '
  'PROPOSAL token: SHA-256 of the UTF-8 token text. Minting and resolving both call '
  'this, so the two cannot disagree about the hash. Granted to nobody.';

CREATE OR REPLACE FUNCTION app.issue_portal_token(
  p_tenant_id   uuid,
  p_proposal_id uuid,
  p_ttl         interval DEFAULT interval '30 days'
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_status core.proposal_status;
  v_token  text;
BEGIN
  IF p_tenant_id IS NULL OR p_proposal_id IS NULL
     OR p_ttl IS NULL OR p_ttl <= interval '0' OR p_ttl > interval '90 days' THEN
    RAISE EXCEPTION 'issue_portal_token: tenant, proposal and a TTL in (0, 90 days] are required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT proposal.status INTO v_status
    FROM core.proposals AS proposal
   WHERE proposal.tenant_id = p_tenant_id AND proposal.id = p_proposal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'issue_portal_token: proposal % is not in tenant %', p_proposal_id, p_tenant_id
      USING ERRCODE = 'no_data_found';
  END IF;
  -- A link to unapproved text is a leak with a URL. Only what has been sent.
  IF v_status NOT IN ('SENT','VIEWED','ACCEPTED') THEN
    RAISE EXCEPTION 'issue_portal_token: a % proposal is not client-visible; send it first', v_status
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','VALIDATION_FAILED','reason','PROPOSAL_NOT_SENT',
              'status', v_status)::text;
  END IF;

  -- 32 bytes base64url: 43 characters, 256 bits. translate() maps + and / and
  -- DELETES the padding, as 013's app.mint_agent_key does.
  v_token := 'tk_pt_' || pg_catalog.translate(
               pg_catalog.replace(
                 pg_catalog.encode(extensions.gen_random_bytes(32), 'base64'),
                 pg_catalog.chr(10), ''),
               '+/=', '-_');

  INSERT INTO core.public_share_tokens
    (tenant_id, target_kind, proposal_id, token_hash, expires_at,
     created_by_kind, created_by_id, created_by_name)
  VALUES
    (p_tenant_id, 'PROPOSAL', p_proposal_id, app.portal_token_hash(v_token),
     pg_catalog.now() + p_ttl, 'SYSTEM', 'portal_token_issue', NULL);

  -- The ONLY time the raw token exists. Not stored, not recoverable: a lost
  -- link is revoked and re-issued.
  RETURN v_token;
END;
$fn$;

COMMENT ON FUNCTION app.issue_portal_token(uuid, uuid, interval) IS
  '028. Mints a client portal link for one SENT/VIEWED/ACCEPTED proposal: '
  'tk_pt_ + base64url(gen_random_bytes(32)), stores only app.portal_token_hash, and '
  'RETURNS the raw token once. Granted to nobody: a staff issue RPC gated on '
  'portal:token:issue is the future caller; today the seed is.';

-- ═══ 2 · The credential check ═══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION app._resolve_portal_token(p_token text)
RETURNS TABLE (token_id uuid, tenant_id uuid, proposal_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  -- Shape first: a wrong-shaped value costs one regex and is never hashed.
  IF p_token IS NULL OR p_token !~ '^tk_pt_[A-Za-z0-9_-]{43}$' THEN
    RETURN;
  END IF;

  -- One indexed equality on public_share_tokens_token_hash_key, then the
  -- validity predicates on the single row it returns. Every way to fail is
  -- the same empty result.
  RETURN QUERY
  SELECT share.id, share.tenant_id, share.proposal_id
    FROM core.public_share_tokens AS share
    JOIN public.tenants AS tenant ON tenant.id = share.tenant_id
    JOIN core.proposals AS proposal
      ON proposal.tenant_id = share.tenant_id AND proposal.id = share.proposal_id
   WHERE share.token_hash = app.portal_token_hash(p_token)
     AND share.target_kind = 'PROPOSAL'
     AND share.revoked_at IS NULL
     AND share.expires_at > pg_catalog.now()
     AND tenant.status = 'ACTIVE'
     AND proposal.status IN ('SENT','VIEWED','ACCEPTED');
END;
$fn$;

COMMENT ON FUNCTION app._resolve_portal_token(text) IS
  '028. The ONE credential check for the client portal. Returns the token, tenant '
  'and proposal for a well-formed, unrevoked, unexpired PROPOSAL token of an ACTIVE '
  'tenant whose proposal is SENT, VIEWED or ACCEPTED — and no row for every other '
  'case, deliberately indistinguishable. Never reads the JWT. Granted to nobody.';

-- ═══ 3 · The projection ═════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION app._portal_proposal(p_tenant_id uuid, p_proposal_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
    'ref',              proposal.ref,
    'title',            COALESCE(programme.name || ' — ' || organisation.name, organisation.name),
    'organisationName', organisation.name,
    'issuedAt',         pg_catalog.to_char(
                          (COALESCE(proposal.sent_at, proposal.created_at) AT TIME ZONE tenant.timezone)::date,
                          'YYYY-MM-DD'),
    'sections',         COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'n', section.n, 'title', section.title, 'body', COALESCE(section.body, ''))
             ORDER BY section.n)
        FROM core.proposal_sections AS section
       WHERE section.tenant_id = proposal.tenant_id AND section.proposal_id = proposal.id
    ), '[]'::jsonb),
    'investment',       pg_catalog.jsonb_build_object(
      'total',             app._money(COALESCE(proposal.value_sen, 0), proposal.currency::text),
      -- programmes_claimable_needs_scheme (006:100) guarantees a scheme when
      -- claimable. A proposal with no programme, or an unclaimable one, reads
      -- SBL at 0%: the levy scheme every employer has, claimable up to nothing.
      'hrdcScheme',        COALESCE(programme.hrdc_scheme::text, 'SBL'),
      'hrdcClaimableUpTo', CASE WHEN COALESCE(programme.hrdc_claimable, false) THEN 1 ELSE 0 END),
    'status',           proposal.status,
    'acceptance',       (
      SELECT pg_catalog.jsonb_build_object(
               'acceptedBy',   acceptance.accepted_by_name,
               'role',         COALESCE(acceptance.accepted_by_role, ''),
               'acceptedAt',   acceptance.accepted_at,
               'signatureRef', COALESCE(signature.ref, ''))
        FROM core.portal_acceptances AS acceptance
        LEFT JOIN core.signatures AS signature
          ON signature.tenant_id = acceptance.tenant_id AND signature.id = acceptance.signature_id
       WHERE acceptance.tenant_id = proposal.tenant_id AND acceptance.proposal_id = proposal.id),
    'comments',         COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'author', comment.author_name, 'authorKind', comment.author_kind,
               'at', comment.posted_at, 'body', comment.body)
             ORDER BY comment.posted_at, comment.created_at, comment.id)
        FROM core.portal_comments AS comment
       WHERE comment.tenant_id = proposal.tenant_id AND comment.proposal_id = proposal.id
         AND comment.author_kind IN ('CLIENT','HUMAN')
    ), '[]'::jsonb),
    'vendorContact',    pg_catalog.jsonb_build_object(
      'name',  COALESCE(profile.display_name, tenant.name),
      -- The web's ROLE_LABEL wording (apps/web/src/shared/config/roles.ts).
      'role',  CASE membership.role::text
                 WHEN 'SALES'         THEN 'Sales Consultant'
                 WHEN 'SALES_MANAGER' THEN 'Sales Manager'
                 WHEN 'OPS'           THEN 'Operations Coordinator'
                 WHEN 'FINANCE'       THEN 'Finance Executive'
                 WHEN 'MD'            THEN 'Managing Director'
                 WHEN 'ADMIN'         THEN 'Administrator'
                 WHEN 'TRAINER'       THEN 'Trainer'
                 ELSE ''
               END,
      'email', COALESCE(profile.email::text, ''),
      'phone', '')
  )
    FROM core.proposals AS proposal
    JOIN public.tenants AS tenant ON tenant.id = proposal.tenant_id
    JOIN core.organisations AS organisation
      ON organisation.tenant_id = proposal.tenant_id AND organisation.id = proposal.organisation_id
    JOIN core.opportunities AS opportunity
      ON opportunity.tenant_id = proposal.tenant_id AND opportunity.id = proposal.opportunity_id
    LEFT JOIN core.programmes AS programme
      ON programme.tenant_id = proposal.tenant_id AND programme.id = proposal.programme_id
    LEFT JOIN public.user_profiles AS profile
      ON profile.tenant_id = proposal.tenant_id AND profile.user_id = opportunity.owner_id
    LEFT JOIN public.memberships AS membership
      ON membership.tenant_id = proposal.tenant_id AND membership.user_id = opportunity.owner_id
   WHERE proposal.tenant_id = p_tenant_id AND proposal.id = p_proposal_id;
$fn$;

COMMENT ON FUNCTION app._portal_proposal(uuid, uuid) IS
  '028. The contract''s PortalProposal and nothing else: no quotation, cost, margin, '
  'floor, commission, provenance, review flag, internal id or levy balance. The one '
  'projection both the read and the comment write return. Granted to nobody.';

-- ═══ 4 · Body validation ════════════════════════════════════════════════════

-- The text of p_body->p_field, trimmed of spaces, tabs and line breaks, when it
-- is a string of 1..p_max characters after trimming with no control character
-- (tab, newline and CR allowed only when p_multiline), else NULL. One rule for
-- all four portal body fields.
CREATE OR REPLACE FUNCTION app._portal_text(p_body jsonb, p_field text, p_max integer,
                                            p_multiline boolean DEFAULT false)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn$
  SELECT CASE
           WHEN pg_catalog.jsonb_typeof(p_body) IS DISTINCT FROM 'object'
             OR pg_catalog.jsonb_typeof(p_body -> p_field) IS DISTINCT FROM 'string' THEN NULL
           WHEN pg_catalog.char_length(pg_catalog.btrim(p_body ->> p_field, E' \t\n\r')) NOT BETWEEN 1 AND p_max THEN NULL
           WHEN p_multiline AND (p_body ->> p_field) ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]' THEN NULL
           WHEN NOT p_multiline AND (p_body ->> p_field) ~ '[\x01-\x1F\x7F]' THEN NULL
           ELSE pg_catalog.btrim(p_body ->> p_field, E' \t\n\r')
         END;
$fn$;

-- ═══ 5 · The three RPCs ═════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION core.get_portal_proposal(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_link record;
BEGIN
  SELECT resolved.* INTO v_link FROM app._resolve_portal_token(p_token) AS resolved;
  IF NOT FOUND THEN
    RETURN app.err('NOT_FOUND');
  END IF;

  -- Bookkeeping on the token only: when a link was last opened and how often,
  -- which is how a forwarded or leaked link is noticed. The proposal is not
  -- touched by a read.
  UPDATE core.public_share_tokens AS share
     SET last_accessed_at = pg_catalog.now(),
         access_count     = share.access_count + 1
   WHERE share.tenant_id = v_link.tenant_id AND share.id = v_link.token_id;

  RETURN app.ok(app._portal_proposal(v_link.tenant_id, v_link.proposal_id));
END;
$fn$;

CREATE OR REPLACE FUNCTION core.add_portal_comment(p_token text, p_body jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_link   record;
  v_author text;
  v_text   text;
  v_fields jsonb := '[]'::jsonb;
  v_count  integer;
BEGIN
  SELECT resolved.* INTO v_link FROM app._resolve_portal_token(p_token) AS resolved;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'portal link not found'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','NOT_FOUND')::text;
  END IF;

  v_author := app._portal_text(p_body, 'author', 120);
  v_text   := app._portal_text(p_body, 'body', 4000, true);
  IF v_author IS NULL THEN
    v_fields := v_fields || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('field','author','reason','INVALID'));
  END IF;
  IF v_text IS NULL THEN
    v_fields := v_fields || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('field','body','reason','INVALID'));
  END IF;
  IF pg_catalog.jsonb_array_length(v_fields) > 0 THEN
    RAISE EXCEPTION 'comment validation failed'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','VALIDATION_FAILED','fields',v_fields)::text;
  END IF;

  -- Parent first, then count under the lock, so two concurrent posts cannot
  -- both read 199.
  PERFORM 1 FROM core.proposals AS proposal
    WHERE proposal.tenant_id = v_link.tenant_id AND proposal.id = v_link.proposal_id
    FOR UPDATE;
  SELECT pg_catalog.count(*)::integer INTO v_count
    FROM core.portal_comments AS comment
   WHERE comment.tenant_id = v_link.tenant_id AND comment.proposal_id = v_link.proposal_id;
  IF v_count >= 200 THEN
    RAISE EXCEPTION 'this proposal has reached its comment limit'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','VALIDATION_FAILED','reason','COMMENT_LIMIT_REACHED','limit',200)::text;
  END IF;

  INSERT INTO core.portal_comments
    (tenant_id, proposal_id, author_name, author_kind, body,
     created_by_kind, created_by_id, created_by_name)
  VALUES
    (v_link.tenant_id, v_link.proposal_id, v_author, 'CLIENT', v_text,
     'CLIENT', 'portal:' || v_link.token_id::text, v_author);

  RETURN app.ok(app._portal_proposal(v_link.tenant_id, v_link.proposal_id));
END;
$fn$;

CREATE OR REPLACE FUNCTION core.accept_portal_proposal(p_token text, p_body jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$
DECLARE
  v_link        record;
  v_name        text;
  v_role        text;
  v_fields      jsonb := '[]'::jsonb;
  v_proposal    core.proposals%ROWTYPE;
  v_acceptance  core.portal_acceptances%ROWTYPE;
  v_programme   core.programmes%ROWTYPE;
  v_owner       uuid;
  v_org_name    text;
  v_pipeline    uuid;
  v_signature   core.signatures%ROWTYPE;
  v_engagement  core.engagements%ROWTYPE;
  v_headers     jsonb;
  v_ip          inet;
  v_agent       text;
BEGIN
  SELECT resolved.* INTO v_link FROM app._resolve_portal_token(p_token) AS resolved;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'portal link not found'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object('code','NOT_FOUND')::text;
  END IF;

  v_name := app._portal_text(p_body, 'name', 120);
  v_role := app._portal_text(p_body, 'role', 120);
  IF v_name IS NULL THEN
    v_fields := v_fields || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('field','name','reason','INVALID'));
  END IF;
  IF v_role IS NULL THEN
    v_fields := v_fields || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('field','role','reason','INVALID'));
  END IF;
  IF pg_catalog.jsonb_array_length(v_fields) > 0 THEN
    RAISE EXCEPTION 'acceptance validation failed'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','VALIDATION_FAILED','fields',v_fields)::text;
  END IF;

  -- THE LOCK, then every read that decides anything. A second accept waits
  -- here and then finds the first one's acceptance.
  SELECT proposal.* INTO v_proposal
    FROM core.proposals AS proposal
   WHERE proposal.tenant_id = v_link.tenant_id AND proposal.id = v_link.proposal_id
   FOR UPDATE;

  SELECT acceptance.* INTO v_acceptance
    FROM core.portal_acceptances AS acceptance
   WHERE acceptance.tenant_id = v_link.tenant_id AND acceptance.proposal_id = v_link.proposal_id;
  IF FOUND THEN
    RETURN app.ok(pg_catalog.jsonb_build_object(
      'engagementRef', (SELECT engagement.ref FROM core.engagements AS engagement
                         WHERE engagement.tenant_id = v_acceptance.tenant_id
                           AND engagement.id = v_acceptance.engagement_id),
      'acceptedAt',    v_acceptance.accepted_at,
      'signatureRef',  (SELECT signature.ref FROM core.signatures AS signature
                         WHERE signature.tenant_id = v_acceptance.tenant_id
                           AND signature.id = v_acceptance.signature_id)));
  END IF;

  IF v_proposal.status NOT IN ('SENT','VIEWED') THEN
    -- ACCEPTED with no portal acceptance behind it was accepted some other way;
    -- there is no original acceptance to return, and a second signature would
    -- be a second binding record.
    RAISE EXCEPTION 'this proposal cannot be accepted from the portal'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','VALIDATION_FAILED','reason','NOT_ACCEPTABLE')::text;
  END IF;

  SELECT programme.* INTO v_programme
    FROM core.programmes AS programme
   WHERE programme.tenant_id = v_proposal.tenant_id AND programme.id = v_proposal.programme_id;
  SELECT opportunity.owner_id INTO v_owner
    FROM core.opportunities AS opportunity
   WHERE opportunity.tenant_id = v_proposal.tenant_id AND opportunity.id = v_proposal.opportunity_id;
  SELECT organisation.name INTO v_org_name
    FROM core.organisations AS organisation
   WHERE organisation.tenant_id = v_proposal.tenant_id AND organisation.id = v_proposal.organisation_id;
  SELECT pipeline.id INTO v_pipeline
    FROM core.pipelines AS pipeline
   WHERE pipeline.tenant_id = v_proposal.tenant_id
     AND pipeline.object = 'ENGAGEMENT' AND pipeline.is_default;
  IF v_programme.id IS NULL OR v_owner IS NULL OR v_pipeline IS NULL THEN
    -- The engagement cannot be created, so nothing is. A configuration fact
    -- about the provider, said as one; the client's page stays unaccepted.
    RAISE EXCEPTION 'this proposal cannot be accepted until the provider completes it'
      USING ERRCODE = 'TRNOS',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','VALIDATION_FAILED',
              'reason', CASE WHEN v_programme.id IS NULL THEN 'PROPOSAL_HAS_NO_PROGRAMME'
                             WHEN v_owner IS NULL THEN 'OPPORTUNITY_HAS_NO_OWNER'
                             ELSE 'NO_ENGAGEMENT_PIPELINE' END)::text;
  END IF;

  -- Clickwrap evidence from PostgREST's request headers when present. Both are
  -- client-supplied and recorded as what the request said, never as identity;
  -- an unparsable address is recorded as absent rather than failing the accept.
  BEGIN
    v_headers := NULLIF(pg_catalog.current_setting('request.headers', true), '')::jsonb;
    v_agent := pg_catalog."left"(v_headers ->> 'user-agent', 512);
    v_ip := pg_catalog.btrim(pg_catalog.split_part(v_headers ->> 'x-forwarded-for', ',', 1))::inet;
  EXCEPTION WHEN OTHERS THEN
    v_ip := NULL;
  END;

  INSERT INTO core.signatures
    (tenant_id, signer_name, signer_role, method, ip_address, user_agent,
     created_by_kind, created_by_id, created_by_name)
  VALUES
    (v_proposal.tenant_id, v_name, v_role, 'CLICKWRAP', v_ip, v_agent,
     'CLIENT', 'portal:' || v_link.token_id::text, v_name)
  RETURNING * INTO v_signature;

  INSERT INTO core.engagements
    (tenant_id, organisation_id, opportunity_id, proposal_id, programme_id, owner_id,
     pipeline_id, title, value_sen, currency, created_by_kind, created_by_id, created_by_name)
  VALUES
    (v_proposal.tenant_id, v_proposal.organisation_id, v_proposal.opportunity_id, v_proposal.id,
     v_programme.id, v_owner, v_pipeline, v_programme.name || ' — ' || v_org_name,
     v_proposal.value_sen, v_proposal.currency,
     'CLIENT', 'portal:' || v_link.token_id::text, v_name)
  RETURNING * INTO v_engagement;

  INSERT INTO core.portal_acceptances
    (tenant_id, proposal_id, accepted_by_name, accepted_by_role, signature_id,
     engagement_id, share_token_id, created_by_kind, created_by_id, created_by_name)
  VALUES
    (v_proposal.tenant_id, v_proposal.id, v_name, v_role, v_signature.id,
     v_engagement.id, v_link.token_id, 'CLIENT', 'portal:' || v_link.token_id::text, v_name)
  RETURNING * INTO v_acceptance;

  -- 011's proposals_state_gate judges this edge; SENT/VIEWED -> ACCEPTED is
  -- registered ungated, and anything else is refused by the trigger itself.
  UPDATE core.proposals AS proposal
     SET status = 'ACCEPTED', accepted_at = v_acceptance.accepted_at
   WHERE proposal.tenant_id = v_proposal.tenant_id AND proposal.id = v_proposal.id;

  PERFORM app.emit_event(
    p_tenant_id       => v_proposal.tenant_id,
    p_type            => 'ProposalAccepted',
    p_aggregate_type  => 'PROPOSAL',
    p_aggregate_id    => v_proposal.id,
    p_aggregate_ref   => v_proposal.ref,
    p_payload         => pg_catalog.jsonb_build_object(
                           'proposalRef',   v_proposal.ref,
                           'acceptedBy',    v_name,
                           'acceptedAt',    v_acceptance.accepted_at,
                           'engagementRef', v_engagement.ref),
    p_summary         => pg_catalog.format('%s accepted %s from the client portal',
                                           v_name, v_proposal.ref),
    p_actor           => pg_catalog.jsonb_build_object(
                           'kind', 'CLIENT',
                           'id',   'portal:' || v_link.token_id::text,
                           'name', v_name),
    p_idempotency_key => 'portal-accept:' || v_proposal.id::text,
    p_related         => pg_catalog.jsonb_build_array(
                           pg_catalog.jsonb_build_object('type','ENGAGEMENT','id',v_engagement.id)));

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'engagementRef', v_engagement.ref,
    'acceptedAt',    v_acceptance.accepted_at,
    'signatureRef',  v_signature.ref));
END;
$fn$;

COMMENT ON FUNCTION core.get_portal_proposal(text) IS
  '028 · GET /v1/public/proposals/{token}. Token-authorised, JWT-blind. The client-safe '
  'PortalProposal, or app.err(NOT_FOUND) for every invalid link alike.';
COMMENT ON FUNCTION core.add_portal_comment(text, jsonb) IS
  '028 · POST /v1/public/proposals/{token}/comments. {author, body} plain text; returns '
  'the PortalProposal. TRNOS NOT_FOUND for every invalid link alike.';
COMMENT ON FUNCTION core.accept_portal_proposal(text, jsonb) IS
  '028 · POST /v1/public/proposals/{token}/accept. {name, role}; idempotent by proposal. '
  'Signature + PROPOSED engagement + acceptance + ACCEPTED + ProposalAccepted in one '
  'transaction. Deliberately not app.perform_action: see the migration header.';

-- ═══ 6 · Grants ═════════════════════════════════════════════════════════════

REVOKE ALL ON FUNCTION app.portal_token_hash(text)                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.issue_portal_token(uuid, uuid, interval)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app._resolve_portal_token(text)                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app._portal_proposal(uuid, uuid)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app._portal_text(jsonb, text, integer, boolean) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION core.get_portal_proposal(text)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION core.add_portal_comment(text, jsonb)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION core.accept_portal_proposal(text, jsonb) FROM PUBLIC, anon, authenticated;

-- The public-token allowlist, spelled exactly as scripts/check-grants.mjs
-- ANON_EXECUTE_ALLOWLIST and test_028 T7b spell it (no space after the comma:
-- the gate compares the signature text).
GRANT EXECUTE ON FUNCTION core.get_portal_proposal(text)          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION core.add_portal_comment(text,jsonb)     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION core.accept_portal_proposal(text,jsonb) TO anon, authenticated;

-- 014:941 revoked this while anon held nothing in core. See the header.
GRANT USAGE ON SCHEMA core TO anon;

-- ═══ 7 · Verify ═════════════════════════════════════════════════════════════

DO $verify$
DECLARE
  v_allow text[] := ARRAY[
    'core.get_portal_proposal(text)',
    'core.add_portal_comment(text,jsonb)',
    'core.accept_portal_proposal(text,jsonb)'];
  v_bad   text;
  v_fn    text;
  v_n     integer;
BEGIN
  -- V1 · anon's whole reachable surface, measured rather than inferred.
  SELECT pg_catalog.string_agg(p.oid::regprocedure::text, ', ') INTO v_bad
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('core','app','public')
     AND pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT (n.nspname = 'core'
              AND pg_catalog.regexp_replace(p.oid::regprocedure::text, '\s', '', 'g') = ANY (v_allow));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '028 verify: anon can EXECUTE functions outside the portal allowlist: %', v_bad;
  END IF;

  SELECT pg_catalog.count(*)::integer INTO v_n
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'core'
     AND pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE');
  IF v_n <> 3 THEN
    RAISE EXCEPTION '028 verify: anon should EXECUTE exactly 3 core functions, found %', v_n;
  END IF;

  SELECT pg_catalog.string_agg(n.nspname || '.' || c.relname, ', ') INTO v_bad
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('core','app','public')
     AND CASE WHEN c.relkind IN ('r','v','m','p','f')
                THEN pg_catalog.has_table_privilege('anon', c.oid,
                       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                  OR pg_catalog.has_any_column_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')
              WHEN c.relkind = 'S'
                THEN pg_catalog.has_sequence_privilege('anon', c.oid, 'USAGE,SELECT,UPDATE')
              ELSE false END;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '028 verify: anon holds a relation privilege: %', v_bad;
  END IF;

  -- V2 · each RPC: one definition, definer, the exact empty path, the timeout,
  -- granted to both client roles, no tenant argument.
  FOREACH v_fn IN ARRAY v_allow LOOP
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
          JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
         WHERE n.nspname = 'core'
           AND p.proname = pg_catalog.split_part(pg_catalog.split_part(v_fn, '(', 1), '.', 2)) <> 1 THEN
      RAISE EXCEPTION '028 verify: % must have exactly one definition', v_fn;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
                    WHERE p.oid = v_fn::regprocedure AND p.prosecdef
                      AND 'search_path=""' = ANY (COALESCE(p.proconfig, ARRAY[]::text[]))
                      AND 'statement_timeout=10s' = ANY (COALESCE(p.proconfig, ARRAY[]::text[]))) THEN
      RAISE EXCEPTION '028 verify: % is not SECURITY DEFINER with search_path="" and statement_timeout=10s', v_fn;
    END IF;
    IF NOT pg_catalog.has_function_privilege('anon', v_fn::regprocedure, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('authenticated', v_fn::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION '028 verify: % is not executable by anon and authenticated', v_fn;
    END IF;
    IF pg_catalog.pg_get_function_identity_arguments(v_fn::regprocedure) ILIKE '%tenant%' THEN
      RAISE EXCEPTION '028 verify: % takes a tenant argument', v_fn;
    END IF;
  END LOOP;

  -- V3 · the internals are granted to nobody and pin the empty path.
  FOREACH v_fn IN ARRAY ARRAY[
    'app.portal_token_hash(text)', 'app.issue_portal_token(uuid,uuid,interval)',
    'app._resolve_portal_token(text)', 'app._portal_proposal(uuid,uuid)',
    'app._portal_text(jsonb,text,integer,boolean)'] LOOP
    IF pg_catalog.has_function_privilege('anon', v_fn::regprocedure, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION '028 verify: internal % is reachable by a client role', v_fn;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
                    WHERE p.oid = v_fn::regprocedure
                      AND 'search_path=""' = ANY (COALESCE(p.proconfig, ARRAY[]::text[]))) THEN
      RAISE EXCEPTION '028 verify: % does not pin search_path=""', v_fn;
    END IF;
  END LOOP;

  -- V4 · 021's CLIENT fail-closed is untouched: no CLIENT permission exists.
  IF EXISTS (SELECT 1 FROM app.role_permissions AS rp WHERE rp.role = 'CLIENT') THEN
    RAISE EXCEPTION '028 verify: CLIENT holds a role permission; 011/021 require it to fail closed';
  END IF;

  -- V5 · the edges accept relies on are still 011's ungated ones.
  SELECT pg_catalog.count(*)::integer INTO v_n
    FROM core.state_transitions AS t
   WHERE ((t.entity = 'proposals' AND t.from_status IN ('SENT','VIEWED') AND t.to_status = 'ACCEPTED')
       OR (t.entity = 'engagements' AND t.from_status IS NULL AND t.to_status = 'PROPOSED'))
     AND (t.gated_by IS NULL OR pg_catalog.cardinality(t.gated_by) = 0);
  IF v_n <> 3 THEN
    RAISE EXCEPTION '028 verify: expected 3 ungated edges (SENT/VIEWED->ACCEPTED, NULL->PROPOSED), found %', v_n;
  END IF;

  -- V6 · the hash lookup is indexed and globally unique (007).
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                  WHERE conrelid = 'core.public_share_tokens'::regclass
                    AND conname = 'public_share_tokens_token_hash_key' AND contype = 'u') THEN
    RAISE EXCEPTION '028 verify: public_share_tokens_token_hash_key is missing';
  END IF;

  RAISE NOTICE '028 verify: OK - anon executes exactly the 3 portal RPCs and holds no '
               'relation privilege; internals ungranted; CLIENT still fail-closed.';
END;
$verify$;

COMMIT;
