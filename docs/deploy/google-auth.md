# Google sign-in — setup

What a person has to click, in order, to sign in to TrainOS with Google against
the hosted project `balzmmsmrawzmefkavte`. The app side is in `apps/web`
(`/sign-in`, `/auth/callback`, `shared/auth`); none of this is automated.

Line references are to `supabase/migrations` at `66ad184` (PR #11, 018+019
on top of PR #6). Prerequisites: migrations 001–019 applied, and `core` ticked
under **Project Settings → Data API → Exposed schemas** (the app calls
`core.me()`).

`<render>` below is the Render site's origin, e.g. `https://trainos.onrender.com`,
with no trailing slash.

## 1 · Google Cloud Console

**APIs & Services → Credentials → Create credentials → OAuth client ID**

| Field                         | Value                                                     |
| ----------------------------- | --------------------------------------------------------- |
| Application type              | Web application                                           |
| Authorized JavaScript origins | `<render>` and `http://localhost:5180`                    |
| Authorized redirect URIs      | `https://balzmmsmrawzmefkavte.supabase.co/auth/v1/callback` |

Google redirects to **Supabase**, never to the app. If the OAuth consent screen
is not configured yet, Google asks for it first (External, app name, support
email); while it is in "Testing", add each tester's Google address under
**Test users**. Keep the client ID and client secret for step 2.

## 2 · Supabase Dashboard

1. **Authentication → Sign In / Providers → Google**: enable, paste the client
   ID and client secret, save.
2. **Authentication → URL Configuration**:
   - Site URL: `<render>`
   - Redirect URLs: `<render>/auth/callback` and
     `http://localhost:5180/auth/callback`
3. **Authentication → Hooks → Customize Access Token (JWT) Claims** → add hook
   → type Postgres → schema `app`, function `custom_access_token_hook` → enable.

Step 3 is not optional. The tenant and role are JWT claims written by that hook
(`002_tenancy_identity_and_permissions.sql:576`; its own comment at `:589`
names this setting). Without it every token has no `tenant_id`, `core.me()`
refuses (`app.require_tenant_id()`, `002:399`), and every account — linked or
not — sees "Your account isn't linked to a workspace yet". 002 already grants
`supabase_auth_admin` what the hook reads (`002:649-667`).

## 3 · Render (static site)

Environment variables — Vite inlines them at BUILD time, so change them and
then **redeploy**:

| Variable                        | Value                                        |
| ------------------------------- | -------------------------------------------- |
| `VITE_API_MODE`                 | `supabase`                                   |
| `VITE_SUPABASE_URL`             | `https://balzmmsmrawzmefkavte.supabase.co`   |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | the project's `sb_publishable_…` key         |
| `VITE_SITE_URL`                 | `<render>` (share links; not used for OAuth) |

**Redirects/Rewrites**: Source `/*` → Destination `/index.html` → Action
`Rewrite`. Without it, Google's return to `/auth/callback` is a 404 from the
static host before the app loads.

The OAuth return address is always the origin the sign-in started on
(`shared/auth/returnPath.ts` `callbackUrl`), because the PKCE verifier lives in
that origin's storage. That is why both origins are listed in steps 1 and 2.

## 4 · Linking the first user to a workspace

Nothing in 001–019 lets a signed-in user attach themselves to a tenant, on
purpose: `app.provision_tenant` is revoked from every client role
(`016_seed_and_tenant_provisioning.sql:325`), and a membership write needs an
existing ADMIN at `aal2` (`memberships_write_admin`, `002:750`). The first
link is an operator act in the **SQL Editor**.

1. Sign in to the app once with Google. That creates the `auth.users` row the
   membership points at; the app shows the not-linked screen.
2. In the SQL Editor, confirm the editor's role bypasses RLS —
   `public.memberships` is `FORCE ROW LEVEL SECURITY` (`002:690`), so a role
   without it cannot insert:

   ```sql
   select current_user, rolbypassrls from pg_roles where rolname = current_user;
   ```

   It must return `true`. If it does not, stop and raise it; do not disable RLS.

3. Run, with the placeholders replaced (valid roles: `SALES`, `SALES_MANAGER`,
   `OPS`, `FINANCE`, `MD`, `ADMIN`, `CLIENT` — `002:102`; `TRAINER` also needs a
   `trainer_id`):

   ```sql
   begin;

   -- A new tenant. Skip this line if the tenant already exists.
   -- Seeds ref formats, action policies and the default pipeline via triggers
   -- (016:254, 011, 019) and refuses to return a half-provisioned tenant.
   select app.provision_tenant('<tenant-slug>', '<Tenant name>', 'Asia/Kuala_Lumpur');

   insert into public.memberships (tenant_id, user_id, role, client_scope, team_scope)
   select t.id, u.id, '<ROLE>'::app.app_role, 'ALL'::app.data_scope, 'ALL'::app.data_scope
     from public.tenants t, auth.users u
    where t.slug = '<tenant-slug>' and u.email = '<you@example.com>';

   -- Display name for the shell. Without it core.me() shows the user id as the name.
   insert into public.user_profiles (tenant_id, user_id, display_name, email)
   select t.id, u.id, '<Display Name>', u.email
     from public.tenants t, auth.users u
    where t.slug = '<tenant-slug>' and u.email = '<you@example.com>';

   commit;
   ```

   `<tenant-slug>` must match `^[a-z0-9][a-z0-9-]{1,62}$` (`002:118`). Each
   `insert` should report `INSERT 0 1`; `INSERT 0 0` means the email or slug
   did not match.

4. Back in the app, click **Check again**. It refreshes the access token first,
   so the hook writes the new tenant claim, then asks `core.me()` again.

## Signing out

The profile modal's **Sign out** ends this browser's session only
(`signOut({ scope: "local" })`); other devices stay signed in.
