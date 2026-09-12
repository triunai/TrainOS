# Spike: Minting JWTs for a non-human AGENT principal on Supabase (2026-09-12)

## Verdict: SUPPORTED WITH CAVEATS

An Edge Function (or any backend) **can** mint its own short-lived JWTs, signed with an
asymmetric (ES256) key that the project trusts, carrying custom claims
(`tenant_id`, `agent_id`, `actor_kind`), such that PostgREST/RLS accept them and
`auth.uid()` resolves to a real `auth.users` row — **without calling GoTrue sign-in**.

This is an officially documented Supabase Auth workflow ("How to create (mint) JWTs
if access to the private key or shared secret is not possible?"), not an unsupported
hack. The caveat is that it requires **bringing your own key** into the project's
signing-key rotation system — Supabase never hands out its own private key or a
signing endpoint — and the resulting key has project-wide impersonation power, not
an agent-scoped one.

Source: [JWT Signing Keys](https://supabase.com/docs/guides/auth/signing-keys)
(fetched via Supabase MCP `search_docs`, 2026-09-12).

---

## Sub-question answers

### (a) Does Supabase expose the private signing key or a signing endpoint to Edge Functions, or only the public JWKS?

**Only the public JWKS**, once a project has migrated to the new "JWT signing keys"
system. From the docs, FAQ "Why is it not possible to extract the private key or
shared secret from Supabase?":

> "You can only extract the legacy JWT secret. Once you've moved to using the JWT
> signing keys feature extracting of the private key or shared secret from Supabase
> is not possible. This ensures that no one in your organization is able to
> impersonate your users or gain privileged access to your project's data."

Public keys are discoverable at `GET https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`.
There is no API or Edge Function binding that returns a private key or offers a
"sign this payload for me" endpoint.

Source: [JWT Signing Keys](https://supabase.com/docs/guides/auth/signing-keys), FAQ section (fetched 2026-09-12).

### (b) With the new JWT signing keys feature, can a project register additional trusted keys?

**Yes — this is the mechanism the whole pattern relies on.** The docs describe the
exact procedure, presented as the answer to "How to create (mint) JWTs if access to
the private key ... is not possible":

1. Generate a private key yourself, outside Supabase: `supabase gen signing-key --algorithm ES256`.
2. Import it as a **new standby key** from the dashboard (`/dashboard/project/_/settings/jwt`),
   pasting the generated JWK (including the private `d` component) into the UI.
3. Click **Rotate key** to activate it.

> "Once imported, click **Rotate key** to activate your new signing key. Any JWT
> signed by your old key will continue to be usable until your old signing key is
> manually revoked."

Important architectural implication: **there is one active signing key per
project**, shared by GoTrue-issued end-user sessions and any custom-minted tokens.
Rotating in a TrainOS-controlled key means that key becomes the key GoTrue itself
uses to sign real human user sessions too — it is not a separate "agent-only" key.
Anyone holding that private key can mint a valid token for **any** `sub`/`role`,
not just agent principals. This reintroduces the same "leak = impersonate anyone"
risk profile that the signing-keys system was built to move away from from the
legacy shared JWT secret, so the private key must be stored with equivalent care
(e.g., Supabase Vault or an Edge Function secret, never bundled client-side, ideally
mediated by a small minting service rather than distributed to every caller).

Also note a 5-minute throttle on signing-key state changes and up to a ~20-minute
verifier cache window platform-wide:

> "Changing a JWT signing key's state sets off many changes inside the Supabase
> platform. To ensure a consistent setup, most actions that change the state of a
> JWT signing key are throttled for approximately 5 minutes."
> "this multi-level cache is cleared every 20 minutes... Supabase products (Auth,
> Data API, Storage, Realtime) do not rely on this cache and revocation is
> instantaneous."

Source: [JWT Signing Keys](https://supabase.com/docs/guides/auth/signing-keys) (fetched 2026-09-12).

**What I could not verify:** whether a *standby* (imported, not-yet-rotated) key's
public half is already served in the JWKS and thus already trusted for
*verification* by PostgREST before you click "Rotate", which would let you mint
against a standby key without ever promoting it to be GoTrue's active session-signing
key. The docs' own walk-through includes the Rotate step as part of the minting
procedure and doesn't call out a verify-only-while-standby option explicitly, so
until tested against a real project this should be treated as unconfirmed — verify
empirically before relying on "standby-only, never rotated" as a way to keep a
separate key from GoTrue's session signing.

### (c) If self-minting is not supported, what is the officially supported way to obtain a JWT for a non-human principal?

Self-minting *is* the officially documented path (see above), via the bring-your-own
asymmetric-key + rotate flow. The docs give the exact minting recipe:

Required header:
```json
{ "alg": "ES256", "kid": "<your-imported-key-id>", "typ": "JWT" }
```
Required payload claims:
```json
{
  "sub": "ef0493c9-3582-425f-a362-aef909588df7",
  "role": "authenticated",
  "exp": 1757749466
}
```
> "`sub` is an optional UUID that uniquely identifies a user you want to impersonate
> in `auth.users` table."
> "`role` must be set to an existing Postgres role in your database, such as `anon`,
> `authenticated`, or `service_role`."

A CLI convenience command exists for testing: `supabase gen bearer-jwt --role authenticated --sub <uuid>`.
Minted tokens are sent like any other: `Authorization: Bearer <jwt>` plus the usual
`apikey` header (publishable/secret key) — the custom JWT cannot go in the `apikey`
header itself:

> "A separate `apikey` header is required to access your project's APIs... Using
> your minted JWT is not possible in this header."

Two alternative, more conventional non-human-principal paths also exist and are
documented, if the team prefers not to touch project-wide signing keys:

- **Dedicated service user + password/OTP sign-in**: create one `auth.users` row
  per agent (or per tenant) via `supabase.auth.admin.createUser()`, then have the
  Edge Function authenticate as that user via `signInWithPassword` (or
  `admin.generateLink`/magic link exchange) to obtain a normal GoTrue session JWT.
  This goes through GoTrue and does not carry arbitrary custom claims unless paired
  with a Custom Access Token Auth Hook (see below) — it does not meet the "without
  GoTrue sign-in" requirement, but it is the lowest-novelty officially supported
  option for a non-human principal.
- **Custom Access Token Auth Hook**: a Postgres function
  (`public.custom_access_token_hook(event jsonb)`) registered under
  Authentication > Hooks, which runs *inside* GoTrue's token-issuance path and can
  inject arbitrary claims (e.g. `tenant_id`, `agent_id`, `actor_kind`) into the
  token GoTrue issues. This is Supabase's documented, first-class mechanism for
  custom claims — but it still requires a GoTrue sign-in to fire, so it does not
  satisfy "without going through GoTrue sign-in" either.

  Source: [Custom Claims & Role-based Access Control (RBAC)](https://supabase.com/docs/guides/api/custom-claims-and-role-based-access-control-rbac) (fetched 2026-09-12).

- **Third-party auth (external OIDC issuer)**: register an external, asymmetrically
  signed OIDC issuer (with its own discoverable JWKS and `kid`-tagged keys) as a
  trusted third-party auth provider; the Data API will then trust JWTs from that
  issuer "similar to how it trusts JWTs issued by Supabase Auth." This is
  effectively a second, parallel way to get a self-controlled signer trusted by
  PostgREST, orthogonal to the project's own signing-key rotation, and worth
  evaluating as an alternative if the team wants agent-token signing fully
  decoupled from the project's human-user signing key. I was not able to fetch the
  full third-party-auth overview page in this session (fetch returned a truncated
  summary) — the required claim shape and whether `auth.uid()` (vs `auth.jwt()->>'sub'`)
  resolves correctly for third-party tokens needs a follow-up read of
  `https://supabase.com/docs/guides/auth/third-party/overview` before adopting this
  path.

  Source: [Third-party auth overview](https://supabase.com/docs/guides/auth/third-party/overview) (partially fetched 2026-09-12).

### (d) Can a SECURITY DEFINER function or PostgREST pre-request hook set claims from an API-key lookup instead?

Not needed for the self-minting path above — since TrainOS would control the JWT
payload directly, there is no need to inject claims post-hoc via
`set_config('request.jwt.claims', …)`. That pattern (a `SECURITY DEFINER` function
or PostgREST pre-request hook rewriting `request.jwt.claims` from an API-key
lookup) is a real PostgREST feature (`pre-request` config option calls a function
before every request that can call `set_config`), but I found no Supabase-specific
documentation page endorsing it as a recommended pattern for Supabase-hosted
projects, and Supabase's hosted Data API config surface for a custom
`pre-request` function was not something I could confirm is exposed to hosted
(non-self-hosted) projects in this session. Treat this sub-question as **open** —
if the team wants to pursue it, it needs a dedicated follow-up against
self-hosting/PostgREST config docs rather than the Supabase Auth docs consulted
here.

---

## Recommended pattern for TrainOS's per-agent-per-tenant AGENT principal

1. Pre-provision one `auth.users` row per AGENT principal (or one shared
   system row per tenant, per TrainOS's tenancy design) via
   `supabase.auth.admin.createUser()`, with `app_metadata.actor_kind = 'agent'`
   and any other authorization-relevant flags in `app_metadata` (never
   `user_metadata`, which is user-editable — see the Supabase security checklist).
2. Generate one project-level ES256 signing key with
   `supabase gen signing-key --algorithm ES256`, import it as a new standby key via
   the dashboard, and rotate it in. Store the private key material only as an Edge
   Function / server secret (e.g. Supabase Vault), never in client-reachable code.
3. In the Edge Function (or a small dedicated "mint" service other functions call
   into, rather than distributing the key to every function), use a JWT library
   (e.g. `jose`) to sign a short-lived (minutes, not hours) token with:
   - header: `{ alg: "ES256", kid: "<imported-key-id>", typ: "JWT" }`
   - payload: `{ sub: "<agent's auth.users id>", role: "authenticated", exp: <short>, tenant_id, agent_id, actor_kind: "agent" }`
4. Call the Data API with `Authorization: Bearer <minted JWT>` and the normal
   `apikey` header. `auth.uid()` will resolve to the agent's real `auth.users.id`;
   RLS policies read `tenant_id`/`agent_id`/`actor_kind` via `auth.jwt() ->> 'tenant_id'`
   etc., the same mechanism already documented for the custom-claims RBAC pattern.
5. Do **not** rely on `supabase.auth.getClaims()` to verify these tokens anywhere;
   the docs explicitly warn it is for GoTrue-issued JWTs only and "verification may
   fail" for self-minted ones — verify with a standard JWT library against the
   project's JWKS if verification is ever needed outside PostgREST.

## Fallback

If the team decides the shared-signing-key blast radius (item (b) above) is
unacceptable, fall back to the **Custom Access Token Auth Hook** + a dedicated
service-user sign-in: create one `auth.users` row per agent, sign in via
`signInWithPassword` (password stored as an Edge Function secret) or
`admin.generateLink`, and let the hook inject `tenant_id`/`agent_id`/`actor_kind`
into the GoTrue-issued token. This goes through GoTrue (violates the "without
sign-in" requirement) but keeps the project's core signing key exclusively
Supabase-managed and avoids ever handling raw key material.

The **third-party auth / external OIDC issuer** route (see (c) above) is a second,
unverified-in-this-session fallback that could fully decouple agent-token signing
from the human-session signing key — flagged for follow-up, not yet a confirmed
recommendation.

## What I could NOT verify

- Whether an imported **standby** (not-yet-rotated) signing key is already trusted
  for PostgREST/Data API *verification* before "Rotate key" is clicked, which would
  let TrainOS keep a signing key that's never promoted to GoTrue's active
  session-signing slot.
- The full mechanics, required claim shape, and `auth.uid()` behavior for
  **third-party auth** (external OIDC issuer) JWTs — the docs page fetch was
  truncated/summarized rather than fully read in this session.
- Whether a hosted (non-self-hosted) Supabase project exposes any `pre-request`-style
  hook for PostgREST that would support the `set_config('request.jwt.claims', …)`
  pattern from a `SECURITY DEFINER` function — not found in the Supabase Auth docs
  consulted; this is more likely a self-hosting/PostgREST-config question that
  wasn't directly answered by the sources searched here.
- Exact current-year/version dates of first publication for the JWT Signing Keys
  and Third-Party Auth docs pages — the docs site does not surface a "last updated"
  date; all citations below reflect content as fetched on 2026-09-12.

## Sources

- [JWT Signing Keys](https://supabase.com/docs/guides/auth/signing-keys) — Supabase docs, fetched via MCP `search_docs` 2026-09-12.
- [Generate a JWT signing key (CLI reference)](https://supabase.com/docs/reference/cli/supabase-gen-signing-key) — fetched 2026-09-12.
- [Custom Claims & Role-based Access Control (RBAC)](https://supabase.com/docs/guides/api/custom-claims-and-role-based-access-control-rbac) — fetched 2026-09-12.
- [Third-party auth overview](https://supabase.com/docs/guides/auth/third-party/overview) — fetched (partial/summarized) 2026-09-12.
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) — fetched 2026-09-12.
- [JWT Claims Reference](https://supabase.com/docs/guides/auth/jwt-fields) — fetched 2026-09-12.
- [JSON Web Token (JWT)](https://supabase.com/docs/guides/auth/jwts) — fetched 2026-09-12 (for the "using custom or third-party JWTs" section).
- WebSearch results, 2026-09-12: GitHub issues #42244, #42810, #41691 (supabase/supabase) on ES256 verification edge cases in Edge Functions gateway — referenced for context on real-world ES256 rollout friction, not relied on as authoritative.
