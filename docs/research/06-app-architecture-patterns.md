# App Architecture Patterns — vern-vault & showroom → TrainOS

Source repos: `vern-vault` (small SPA, ~50-vehicle inventory admin) and `showroom`
(large SPA, wedding-ops platform with a multi-tenant admin console). Obsidian
notes under `Projects/Vern/Patterns Applied/` were checked against the live
vern-vault code; drift is called out inline. `showroom` has no equivalent
Obsidian case studies, so it is analyzed directly from source plus
`docs/design/*.md`.

Two apps, two maturity levels of the same idea: vern-vault is the pattern in
its infancy (single admin page, one role tier that matters, Effect-wrapped
Supabase calls); showroom is the same idea after ~80 migrations and a real
multi-role, multi-tenant admin console. **For TrainOS's 9-role, approval-heavy
admin, showroom is the closer architectural cousin** — vern-vault is most
useful for the data-slice and lead-alert patterns.

---

## 1. Auth & role resolution

### 1.1 vern-vault — client-resolved role, Zod-mirrored enum

**Problem:** turn a Supabase session into a role the UI can branch on, without
letting a malformed/renamed role silently pass as valid.

**Implementation:**
- `src/lib/supabase.ts:19` — one `createClient()` call in the whole app; env-validated at import time; components/hooks never import `@supabase/supabase-js` directly.
- `src/features/auth/AuthProvider.tsx:23` — **one** `onAuthStateChange` subscription shared via React context. `active`-flag guard on the initial `getSession()`. On `SIGNED_OUT`, calls `queryClient.removeQueries({ queryKey: profileKeys.all })` so a prior user's cached role can't leak to the next signed-in user.
- `src/features/auth/schemas/profile.schema.ts:7` — `appRoleSchema = z.enum(['superadmin','main_admin','admin','analyst','viewer'])`, hand-mirroring the Postgres enum `public.app_role`.
- `src/features/auth/services/authService.ts:56` — `getMyProfile()` does `myProfileSchema.parse(data)` — **parse, not cast** — so a schema drift throws instead of typing bad data as valid.
- `src/features/auth/hooks/useRole.ts:11` — role query keyed by `profileKeys.me(user.id)`, `staleTime: Infinity` (manual invalidation only), `role = profile.is_active ? profile.role : null`. Exposes **positive, tiered** capability flags (`isAdmin`, `canPublish`, `isSuperadmin`), never `role !== X` negatives.

```ts
// src/features/auth/hooks/useRole.ts
export function useRole() {
  const { user, loading: authLoading } = useAuth();
  const query = useQuery({
    queryKey: profileKeys.me(user?.id ?? 'anonymous'),
    enabled: !!user,
    queryFn: () => Effect.runPromise(getMyProfile(user!.id)),
    staleTime: Infinity,
  });
  const profile = query.data ?? null;
  const role: AppRole | null = profile?.is_active ? profile.role : null;
  return {
    role, profile,
    isAdmin: role === 'admin' || role === 'main_admin' || role === 'superadmin',
    canPublish: role === 'main_admin' || role === 'superadmin',
    isSuperadmin: role === 'superadmin',
    loading: authLoading || (!!user && query.isLoading),
  };
}
```

**Flow:** session (AuthProvider context) → `profiles` table read (authService, Zod-parsed) → `useRole()` capability flags → `RequireRole` route guard → nav/UI conditionals.

**Verified vs. Obsidian note** (`Auth & Role Resolution (Vern).md`): matches exactly, including the documented "single subscription replaced a real flicker" war story and the Effect.ts-is-ceremony admission in the note's own Caveats section. No drift found.

**TrainOS adaptation:** the parse-don't-cast + positive-tiered-flags + single-subscription-context shape is exactly right for TrainOS's 9 roles. Do **not** copy the "resolve role by reading a client-cached `profiles` row" mechanism wholesale — see §1.2, showroom's server-resolved model is the better fit once approvals and per-tenant/per-branch scoping matter (see [[#3-admin-authz-shell]]).

### 1.2 showroom — server-resolved role + tenant scope, via RPC (recommended base for TrainOS)

**Problem:** showroom's admin console is multi-tenant (each "wedding" is a tenant) and multi-role (`platform_admin`, `admin`, `coordinator` — `src/lib/rpc.schemas.wedding.ts:71`). A client-side role read is not enough: the UI also needs to know *which tenant* the session is approved for, and that answer must come from the server on every mount, not from a client cache that can go stale after account/tenant switches.

**Implementation:**
- `src/pages/RuntimeAdminPage.tsx:50` — the **route-level security boundary** for every `/w/:slug/admin` child route. A `useQuery` keyed by `["admin-access-context", requestedSlug, user?.id]` (user id in the key so switching Google accounts can't reuse a stale approval) calls a single RPC, `admin_get_access_context(p_slug)`, which is a `SECURITY DEFINER` Postgres function — **the database itself decides and returns the role + approval status**, not a client-readable table.
- The response is validated with a runtime Zod schema (`adminAccessContextDataSchema`) even though the generic RPC wrapper already type-checks in dev — "Admission is a production authorization boundary" (`RuntimeAdminPage.tsx:67-74`), so it re-validates unconditionally.
- Tenant-scope confirmation: after the RPC returns, the code re-checks `normalizeWeddingSlug(data.slug) !== requestedSlug` before minting an "approved scope" — defense against a race where the URL slug changes but the query hasn't refetched.
- Query `retry` is domain-aware: it does **not** retry `ACCESS_NOT_APPROVED` or `AUTH_REQUIRED` (those are facts, not flakiness), but does retry once for transport errors (`RuntimeAdminPage.tsx:85-87`).
- Four explicit UI states, not a boolean: `AdminAccessLoadingState`, `AdminSignedOutState`, `AdminAccessBlockedState` (signed in but not approved — shows a WhatsApp-based "request approval" flow, `AdminAccessStates.tsx:6-17`), `AdminAccessTechnicalErrorState` (retry button). Only after all four are cleared does `AdminAccessProvider` mint scope and render `<Outlet/>`.
- The resulting scope (`role`, `weddingId`, `slug`, `status`) is threaded through React context (`AdminAccessContext.tsx:30`) as **the single source of tenant+role truth** for the whole admin subtree — every child reads `useAdminAccess()`, nothing re-derives role from a separately-fetched table.

```ts
// src/pages/RuntimeAdminPage.tsx (core of the boundary)
const accessQuery = useQuery<AdminAccessData, AdminAccessError>({
  queryKey: ["admin-access-context", requestedSlug, user?.id],
  queryFn: async () => {
    const { data, error } = await rpc("admin_get_access_context", { p_slug: requestedSlug });
    if (error) throw accessErrorFromRpc(error);
    const parsed = adminAccessContextDataSchema.safeParse(data);
    if (!parsed.success) throw new AdminAccessError("MALFORMED_ACCESS", "Invalid access context");
    if (normalizeWeddingSlug(data.slug) !== requestedSlug)
      throw new AdminAccessError("TENANT_SCOPE_MISMATCH", "…");
    return data;
  },
  enabled: Boolean(session && user && requestedSlug),
  retry: (n, error) =>
    error.code !== "ACCESS_NOT_APPROVED" && error.code !== "AUTH_REQUIRED" && n < 1,
});
```

**TrainOS adaptation — this is the recommended shape for TrainOS's role/scope resolution:**
TrainOS has 9 roles (SALES, SALES_MANAGER, OPS, FINANCE, MD, ADMIN, TRAINER, CLIENT, AGENT) and — per the project's approval-workflow requirement — almost certainly needs record-level scoping (a SALES rep sees their own deals; a SALES_MANAGER sees their team's; FINANCE/MD see cross-org). That is much closer to showroom's "role + tenant scope, resolved server-side, re-validated on the client" model than to vern-vault's "read one `profiles.role` column." Concretely:
- One RPC (e.g. `get_access_context()`) returning `{ role, scopes: [...], status }`, called once per session/route-tree mount, `SECURITY DEFINER`.
- Re-validate the response with Zod even in production — cheap insurance against a migration renaming a role/status value the client isn't ready for.
- Four explicit states (loading / signed-out / not-approved / technical-error), never a single `isLoading` boolean — the "not approved yet" state is a first-class product surface (TrainOS's equivalent might route to "request access" rather than WhatsApp).
- Put the resolved `{ role, scopes }` in one context, read everywhere from there — never re-derive role in a child component.

---

## 2. Data slice pattern

### 2.1 vern-vault inventory — Zod-boundary slice, two facades over one base table

Reference slice for how Vern talks to Supabase — Obsidian: `Inventory Data Slice (Vern).md`.

**Problem:** two audiences (public site, admin) read the same `vehicles` entity through different projections; the RLS migration revoked base-table `SELECT` from `authenticated` entirely, so **every read must go through a facade view**.

**Implementation:**
- `src/features/inventory/schemas/vehicle.schema.ts` — `publicVehicleRowSchema` (3 statuses) and `adminVehicleRowSchema` (5 statuses + admin columns) are separate Zod schemas over the `public_vehicles` / `admin_vehicles` security-definer views, plus `vehicleFormSchema` for the add/edit form and a `toVehicle()` camelCase adapter.
- `src/features/inventory/services/vehicleService.ts` (public reads, explicit `PUBLIC_COLUMNS` list — never `select('*')`, so a facade column added later isn't silently exposed to anonymous clients) and `vehicleAdminService.ts` (admin reads/writes).
- `src/features/inventory/hooks/useVehicles.ts:10` — `useVehicles()` (suspense) sharing a query key with `useVehiclesQuery()` (non-suspense, for surfaces that must paint before the whole route suspends).
- `src/features/inventory/hooks/useAdminVehicles.ts:37` — `useVehicleMutations()` returns `{ create, update, setStatus, remove }`, each `onSuccess → invalidateQueries(vehicleKeys.all)` so admin list and public site refetch together.
- `src/lib/queryKeys.ts:7` — hierarchical key factory (`vehicleKeys.all → .lists()/.list(filters) → .details()/.detail(id)`), the single place query keys are defined; hooks never hardcode key arrays.

**The asymmetric mutation-error contract (a real war story, verified in code and note):**
`setStatus`/`remove` are fired with fire-and-forget `mutate(...)` from `AdminListings`, so they declare `onError → toast.error(...)`. `create`/`update` are `mutateAsync`'d inside a `try/catch` in the form component (which shows inline errors), so they **intentionally have no `onError`** — adding one would double-toast. This asymmetry is commented at the call site (`useAdminVehicles.ts:53-57`) specifically because omitting `onError` on the fire-and-forget calls once produced a Postgres `42501` (RLS-denied write) that looked like "the publish button does nothing" — no toast, no visible failure.

```ts
// src/features/inventory/hooks/useAdminVehicles.ts
const setStatus = useMutation({
  mutationFn: (args: { id: string; status: AdminVehicle['status'] }) =>
    runWrite(setVehicleStatus(args.id, args.status)),
  onSuccess: invalidate,
  onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not update listing'),
});
```

**Verified vs. Obsidian note:** matches; the note additionally flags (and code confirms) that `Effect.tryPromise` + a `runWrite()` helper exist solely to unwrap Effect's `FiberFailure` back into a plain `Error` for TanStack — see §7 below, this is real drift-worth-avoiding.

**TrainOS adaptation:**
- Copy the **hierarchical query-key factory** (one `lib/queryKeys.ts`), the **facade/base-table split for reads vs writes**, and the **asymmetric fire-and-forget-needs-onError / awaited-needs-no-onError rule** verbatim — these generalize to any Supabase-backed CRUD slice, and TrainOS's approval actions (approve/reject buttons) are exactly the fire-and-forget shape that needs `onError → toast`.
- Do not copy per-mutation `onError` toasts as the primary error-reporting mechanism — showroom's centralized `MutationCache` (§6.2) is strictly better and avoids re-declaring the same toast in every hook.
- Do not copy Effect.ts (§7) — plain `async/await` + typed return, matching showroom's `rpc()` wrapper, is the better fit.

### 2.2 showroom — typed RPC layer as the entire data boundary

**Problem at showroom's scale:** with ~80 migrations and business rules that must be enforced identically for every caller (web, print views, future clients), putting query/mutation logic in scattered `.from(table).select()` calls invites drift. showroom's answer: **almost no direct table reads from the client** — nearly everything is a Postgres RPC with a typed envelope.

**Implementation:**
- `src/lib/rpc.ts` — one wrapper (`rpc(name, args)` / `rpcEnvelope(name, args)` for paginated calls) that all RPC calls go through. Returns `{ data, error }` tuples, never throws, so callers keep their existing `if (error)` idiom.
- `src/lib/rpc.types.ts` — a single `RpcMap` interface mapping RPC name → `{ args, response }` types. Every call site's types are derived from this map (`RpcMap["admin_get_access_context"]["response"]`), so a signature change is a one-file edit that ripples out as compile errors everywhere, not a silent shape mismatch.
- Domain errors vs transport errors are distinguished: RPCs return `{ success: false, error: { code, message, field, ...extra } }` envelopes; `rpc.ts` normalizes unknown extra fields into an untyped `details` bag rather than dropping them (`rpc.ts:60-73`) — a new diagnostic field an RPC starts returning reaches the caller without a second edit to the parser.
- `isMissingRpcFunction()` (`rpc.ts:~100`) specifically detects "RPC doesn't exist yet" (PostgREST `PGRST202` / Postgres `42883`) matched **on error code, never message text**, so a not-yet-deployed migration degrades to a feature's "unsupported" state instead of a generic error.
- Runtime Zod validation of RPC responses is layered on top at trust boundaries that matter (e.g. `adminAccessContextDataSchema` in `rpc.schemas.wedding.ts`), while the generic wrapper only type-checks in development — i.e. **validate unconditionally only where the RPC crosses an authorization boundary**, not on every call (cost/benefit call made explicitly in code comments).

```ts
// src/lib/rpc.ts — domain vs transport error shape
interface FailureEnvelope {
  success: false;
  error: { code?: string; message?: string; field?: string; [key: string]: unknown };
}
function toDomainError(envelope: FailureEnvelope): RpcError {
  const details: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(envelope.error ?? {})) {
    if (!PROJECTED_ERROR_KEYS.includes(key)) details[key] = value;
  }
  return { kind: "domain", code: envelope.error?.code ?? "UNKNOWN",
    message: envelope.error?.message ?? "Unknown error", field: envelope.error?.field,
    ...(Object.keys(details).length > 0 ? { details } : {}) };
}
```

**TrainOS adaptation:** **strongly recommended** as the data-layer backbone. TrainOS's approval workflows (proposed-action cards, approval banners per the design-system spec) are exactly the domain where "which error code caused this rejection" needs to reach the UI precisely (e.g. `INSUFFICIENT_ROLE` vs `ALREADY_APPROVED` vs `STALE_WRITE` should render differently on an approval-banner). A single `RpcMap` + `rpc()` wrapper gives TrainOS:
- one place to add a new approval action's types,
- a codified way to distinguish "not deployed yet" from "denied" from "stale,"
- no per-feature reinvention of error normalization (which is what happened organically across vern-vault's Effect-wrapped services — 16 files, each hand-rolling a `Data.TaggedError`).

This is a bigger upfront investment than vern-vault's direct `.from()` calls, but TrainOS's role/approval complexity (9 roles vs vern's 3-that-matter) makes the investment pay off much sooner than it did for either source app.

---

## 3. Admin authz shell {#3-admin-authz-shell}

### 3.1 vern-vault — three-layer shell, minimal nav (no real sidebar)

Obsidian: `Admin Authz Shell (Vern).md`, pattern `Three-Layer Authz Shell (RLS is the Guard)`.

**Layers, as documented and verified in code:**
1. **Route guard** — `src/features/auth/components/RequireRole.tsx:8`: `<RequireRole allow={[...]}>` redirects signed-out → `/login`, disallowed role → `/`. Loading state renders a spinner (loading ⇒ treated as not-allowed).
2. **Capability flags** — from `useRole()` (§1.1): `canPublish`, `isSuperadmin` passed as **booleans** into `AdminListings`, never role strings in JSX.
3. **RLS** — the real boundary; a denied write raises Postgres `42501`, which the UI must be wired to toast (§2.1's war story).

```tsx
// src/features/auth/components/RequireRole.tsx
export function RequireRole({ allow, children }: { allow: AppRole[]; children: ReactNode }) {
  const { session, loading: authLoading } = useAuth();
  const { role, loading: roleLoading } = useRole();
  if (authLoading || roleLoading) return <Spinner />;
  if (!session) return <Navigate to="/login" replace />;
  if (!role || !allow.includes(role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}
```

**Important limitation for TrainOS's purposes:** vern-vault's admin surface is a **single page** (`pages/Admin.tsx`) with pill-tab navigation (`?tab=dashboard|listings` in the URL) inside a generic `PortalLayout` — there is no sidebar, no per-section nav config, and no route-filtered navigation model. This is because vern-vault only has one meaningfully-gated capability tier (admin vs. main_admin+ vs. superadmin) on one resource. **This does not generalize to TrainOS's 9 roles across many resources** — for that, showroom's shell (§3.2) is the real reference.

**Verified vs. Obsidian note:** matches, including the documented debt ("UI gates are cosmetic," "flags can drift from policies," "status→capability logic smeared in JSX"). No drift found; the note is honest about vern-vault's own weaknesses.

### 3.2 showroom — role/section-filtered sidebar shell (recommended base for TrainOS nav)

**Problem:** a real admin console with 7+ sections (Guests, Day-of, Wishes, Vendors, Table Planner, Planned, Import, Settings, Dashboard), rendered identically as a bottom-nav (mobile) and a collapsible icon-rail sidebar (desktop), where sections must be individually hideable per-tenant without the two nav surfaces ever disagreeing about which items show.

**Implementation:**
- `src/features/admin/layouts/adminNavItems.ts:74` — **one function**, `getAdminNavItems(basePath, hiddenSections)`, is the single source of truth for both nav surfaces. Each item declares `placement: "bottom-nav" | "sidebar" | "both"`, an optional `badgeKey` (typed against a closed union, `AdminNavBadgeKey`, so a renderer can index a count map directly with no cast), and an optional `sectionId` — items with no `sectionId` (Dashboard, Settings) are always-on chrome, never filtered.
- `getBottomNavItems()` / `getSidebarNavItems()` both call `getAdminNavItems()` and just filter on `placement` — **there is exactly one filtering pass** (`.filter(item => item.sectionId === undefined || !hiddenSections?.has(item.sectionId))`), so mobile and desktop cannot drift on which sections are visible.
- `src/shared/ops/useOpsSectionVisibility.ts` (consumed at `AdminSidebar.tsx:69`) resolves `hiddenSections` per-tenant from a config table; **unresolved/not-yet-deployed reads as all-visible** — the code explicitly documents "never hide on a guess."
- `src/features/admin/layouts/AdminLayout.tsx:353` is the shell root: it composes `AdminDataProvider` (badge-count data), reads the resolved `{ role, scope }` from `useAdminAccess()` (§1.2), and renders `DesktopSidebar`/`MobileSidebar` + `Outlet`. Layout constants (bar heights, container widths, z-index) live in one file, `opsChrome.ts`, specifically to prevent the four-different-bar-heights bug the file's own header comment documents as having happened once.
- Badge counts (`checkedInCount`, `pendingVendorCount`) are computed once in `AdminDataProvider` and passed down as a plain `{ [badgeKey]: number }` map — **this is the closest existing analog to TrainOS's "approvals badge."**

```ts
// src/features/admin/layouts/adminNavItems.ts
export interface AdminNavItem {
  label: string; path: string; icon: LucideIcon;
  placement: "bottom-nav" | "sidebar" | "both";
  badgeKey?: AdminNavBadgeKey;
  sectionId?: OpsSectionId;      // omitted = always-on chrome, never filtered
  getPath?: (ctx: NavResolveContext) => string;
}
export function getAdminNavItems(basePath = "/admin", hiddenSections?: ReadonlySet<string>) {
  const items: AdminNavItem[] = [ /* … one array, both surfaces read it … */ ];
  return items.filter(
    (item) => item.sectionId === undefined || !(hiddenSections?.has(item.sectionId) ?? false),
  );
}
```

- **Retired-route handling:** `src/shared/config/admin-routes.ts` centralizes tenant-less legacy admin URL patterns (`/admin/*`, `/admin-lite/*`, …) that must **fail closed** — any tenantless admin URL redirects out (`RetiredAdminRedirect`) rather than mounting an admin reader/writer speculatively. Comment at `App.tsx:353`: "operators must enter through `/w/:slug/admin` so every read and write has real scope."
- **403 / not-approved handling:** covered in §1.2 — `AdminAccessBlockedState` is a distinct, designed UI state (not a generic error page), with a copy-pasteable request-access message.

**TrainOS adaptation — recommended shell shape:**
- One `getAdminNavItems(role, hiddenSections)`-style function as the single source of truth for TrainOS's role-filtered nav (CLAUDE.md: "Stage names and order render from pipeline configuration, never hardcoded" — the same principle showroom applies to nav sections applies directly to TrainOS's stage/role nav). Filter once, consume from both a desktop rail and a mobile sheet/bottom-nav.
- Extend `sectionId`-based filtering to **role**-based filtering: an item can declare `allowedRoles?: TrainOSRole[]` alongside (or instead of) `sectionId`, filtered in the same single pass.
- Badge counts (approvals pending, by role) computed once in a data provider analogous to `AdminDataProvider`, passed down as a typed count map — this is the direct ancestor of TrainOS's "approvals badge."
- Centralize chrome constants (bar heights, container widths, z-index) in one file per CLAUDE.md's "one component library" rule — showroom's `opsChrome.ts` is proof this specifically prevents a real class of bug (inconsistent bar heights) that will recur if left ad hoc.
- Fail-closed on tenant/scope-less admin URLs, with a centralized retired-route list, if TrainOS ever has legacy or ambiguous admin URLs to guard against.

---

## 4. Realtime subscriptions

**vern-vault has exactly one realtime subscription in the codebase** (`app_config` table) — `src/features/config/services/appConfigService.ts:39`. Pattern: **realtime → cache invalidation only, never direct state mutation.**

```ts
// src/features/config/services/appConfigService.ts
export const subscribeConfig = (onChange: () => void): (() => void) => {
  const topic = `app_config_changes_${(channelSeq += 1)}`;
  const channel = supabase
    .channel(topic)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'app_config' }, onChange)
    .subscribe();
  return () => { void supabase.removeChannel(channel); };
};
```

Consumed in `src/features/config/hooks/useAppConfig.ts:30`: `useEffect(() => subscribeConfig(() => qc.invalidateQueries({ queryKey: appConfigKeys.all })), [qc])`. The query itself uses `staleTime: Infinity` — it only ever refetches because realtime told it to, never on a timer. Channel names are deduplicated with a module-level counter to avoid topic collisions if the hook mounts more than once (the code comments this as a workaround, recommending hoisting to a single provider instead).

**showroom has no `supabase.channel()` / `postgres_changes` usage anywhere in `src/`.** At showroom's scale, "live" data is refetched via TanStack Query's normal invalidation-on-mutation (§2.2) rather than a database push channel — badges, stats, and lists refresh when a mutation's `onSuccess` invalidates the relevant query key, not via a subscription.

**TrainOS adaptation:** for an approvals badge specifically (multiple roles need to see a pending-count change without a page reload, potentially from another user's action), vern-vault's pattern is directly applicable and proven simple: one realtime channel on the approval-relevant table(s), whose only job is to call `invalidateQueries` — never touch component state directly from the channel callback. Do this from a single shared provider (as vern-vault's own code comments recommend) rather than per-component subscriptions, to avoid vern's documented duplicate-topic risk. If TrainOS's approval volume is low, showroom's simpler "invalidate on mutation success, no realtime" approach may be sufficient and is less to operate.

---

## 5. Lead alert pipeline (relevant to TrainOS's approvals badge / notification path)

Obsidian: `Lead Alert Pipeline (Vern).md`. This is a **transactional-outbox email pattern**, not a UI pattern, but it's the closest existing analog to "something happened → someone must be notified" in either codebase, which is the same shape as TrainOS's approvals badge/notification.

**What shipped (verified against the note; DB/edge-function code was not independently re-read — out of scope per non-goals — but the note's own description is internally consistent and reads as a finished, shipped feature, not a draft):**
- An **outbox table** + a Postgres trigger (`enqueue_market_lead_alert()`) on the source table, gated on a `source = 'web_form'` condition so internal/manual entries don't self-notify.
- The enqueue insert is **exception-swallowed** — a failed alert enqueue can never roll back the user-facing action that triggered it (submitting a lead). This is the load-bearing decision: notification failure must never block or roll back the primary write.
- A separate Edge Function claims outbox rows atomically, sends via a third-party provider with an idempotency key derived from the outbox row id, and tracks `sent/failed/dead` status with backoff.
- A real failure mode is documented: swapping the notification recipient while the sender was still in "sandbox" mode caused **silent** delivery failure (provider 403, not in the retryable-status set, straight to `dead`, no alert to anyone) — the lesson logged is "verify the destination is production-ready before swapping it," and more generally, a notification pipeline needs its own dead-letter visibility, not just the primary feature's error handling.

**TrainOS adaptation:** TrainOS's approvals badge is almost certainly an in-app count (not email), so the outbox/Resend machinery itself is not directly reusable. What **is** reusable:
- **Never let a notification-path failure roll back or block the underlying business action** (an approval request must succeed even if the badge-refresh or any push notification fails).
- **Notification enqueue should be exception-swallowed at the trigger level**, with its own status tracking, separate from the primary write's success/failure.
- If TrainOS ever adds email/SMS/WhatsApp escalation for stuck approvals, the outbox-with-idempotency-key-and-backoff shape from `send-lead-alert` is a solid, already-proven template.

---

## 6. Toast / error / empty / loading state conventions

**Neither app has a shared `EmptyState` / `LoadingState` / `ErrorState` component library.** This is a real gap in both source apps, not something to copy — TrainOS's own CLAUDE.md already calls for "empty/loading/error states" as a named, standardized kit component, which neither source app has actually built. Treat this section as "here is what exists to migrate away from," not a pattern to replicate structurally — only the error-classification and mutation-error-routing ideas below are worth keeping.

### 6.1 vern-vault — inline ad hoc states, per-mutation toast

- Loading/error/empty are hand-written per page (e.g. `pages/Admin.tsx:44-49`: `isLoading ? <Spinner/> : isError ? <p>Failed…</p> : <Content/>`), not a shared component.
- Toasts: `sonner`, invoked per-mutation `onError` (§2.1). No central place decides which mutations toast; each hook opts in individually.
- Shadcn's `use-toast.ts` hook also exists (`src/hooks/use-toast.ts`) as a second toast primitive alongside `sonner`'s `<Toaster/>` — the app runs **two toast systems side by side** (`<Toaster/>` and `<Sonner/>` are both mounted in `App.tsx:109-110`). Worth flagging as debt, not a pattern to copy: pick one toast library for TrainOS.

### 6.2 showroom — centralized mutation-error toast via MutationCache (worth copying)

`src/lib/queryClient.ts` routes **all** mutation errors through one place, opt-in per mutation via `meta`:

```ts
export const queryClient = new QueryClient({
  defaultOptions: { mutations: { retry: 0 }, queries: { retry: 1, staleTime: 30_000 } },
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      if (mutation.options.meta?.toastOnError !== true) return;
      toast.error(error instanceof Error ? error.message : "Something went wrong.");
    },
  }),
});
```

This is strictly better than vern-vault's per-hook `onError: () => toast.error(...)` repetition: a mutation opts in with `{ meta: { toastOnError: true } }` and gets consistent toast copy/behavior for free, and a mutation that wants custom handling just omits the flag. **Recommended for TrainOS** — pair with the RPC layer's typed `RpcError` (§2.2) so the toast can render `error.message` from a normalized domain error rather than a raw exception string.

Access-denied / not-approved states in showroom **are** a designed, non-generic surface (`AdminAccessStates.tsx`, §1.2/§3.2) — eyebrow/title/description shell + an explanation of how to get access + an FAQ. This is the one place showroom does build a real "state" component worth studying, even though it's specific to the access-gate use case rather than a generic empty/error state.

**TrainOS adaptation:** build the actual shared empty/loading/error/approval-banner components CLAUDE.md calls for (neither source app has them generically); adopt showroom's centralized `MutationCache` + `meta.toastOnError` opt-in for mutation error toasts; standardize on one toast library (skip vern-vault's two-system duplication).

---

## 7. Effect (`effect` ^3, `@niklaserik/effect-mcp`) — present in vern-vault, absent from showroom, not load-bearing

**vern-vault** wraps essentially every Supabase call in `Effect.tryPromise` + a `Data.TaggedError`, run back to a Promise via `Effect.runPromise` (sometimes `Effect.either` to avoid throwing). 16 files import from `'effect'`. Concretely:
- `authService.ts` — `AuthError extends Data.TaggedError('AuthError')`.
- `vehicleService.ts`/`vehicleAdminService.ts` — `VehicleQueryError`/`VehicleWriteError`.
- `useAdminVehicles.ts:17` needs a bespoke `runWrite()` helper whose entire job is to unwrap Effect's `FiberFailure` back into a plain `Error` so TanStack's `onError` gets a clean string.

**Both source Obsidian notes independently flag this as pure overhead**, in near-identical language:
> "Effect.ts is pure ceremony here… the typed-error channel buys nothing for one-step queries here. Effect stays a Vern-local tax, not part of the pattern." (`Inventory Data Slice (Vern).md`)
> "For a `select().maybeSingle()` this is ceremony… the value-add (typed error channel) doesn't pay for the import cost here." (`Auth & Role Resolution (Vern).md`)

**showroom, the later and larger codebase, has zero `effect` usage** (`grep` for `"effect"` in `package.json` and for `from 'effect'` in `src/` both return nothing) — it solves the same "typed error channel" problem with plain `{ data, error }` tuples and a discriminated `RpcError` type (§2.2), no runtime-effects library required.

**TrainOS adaptation: do not adopt Effect.** Both source apps' own authors independently concluded it isn't earning its cost for one-step Supabase/RPC calls, and the codebase that evolved further (showroom) simply doesn't use it. Use showroom's plain `async/await` + `{ data, error }` tuple + discriminated union error type instead — it gets the same "can't forget to handle the error case" benefit TypeScript's discriminated unions already provide, with none of the `Effect.runPromise`/`FiberFailure`-unwrapping ceremony vern-vault had to build a helper function just to undo.

---

## 8. Theme provider

**vern-vault has no `next-themes` and no `ThemeProvider`.** The only "theme" reference in the codebase is inside a vendored shadcn `sonner.tsx` component that isn't wired to anything — the app is hardcoded dark (`bg-black text-white` inline throughout, e.g. `PortalLayout.tsx:13`). There is no dark-mode toggle and nothing to adapt here.

**showroom uses `next-themes` (^0.3.0)** as a dependency, but its admin console specifically **opts out of theme switching**: `AdminLayoutContext.isDark: true` is a fixed literal (`AdminLayout.tsx:355`, `const isDark = true as const`), and `VendorForm.tsx`'s own header comment states it directly: "the Console is dark-only by contract… so this file styles one appearance with `--ops-*` tokens instead of branching on it." Theme tokens live in `src/shared/theme/` (`luxe-moody.ts` + `luxe-moody.css`, re-exported from `theme/index.ts`) and a separate `ops-console.css` for the admin console's own token set — i.e. **the public-facing site and the admin console deliberately use different, non-interchangeable token sets**, and the admin console's is fixed-dark rather than theme-switchable.

**TrainOS adaptation:** neither source app demonstrates a working light/dark toggle for an admin surface — showroom explicitly rejected doing so for its console. Given TrainOS's CLAUDE.md specifies a fixed three-colour system (ink neutrals, electric blue, charcoal) with no mention of a dark-mode requirement, following showroom's "admin console is one fixed appearance, styled with CSS custom-property tokens defined once" approach is the more proven and lower-risk choice than introducing `next-themes` switching that neither reference app actually exercises in an admin context.

---

## 9. Form pattern (react-hook-form + zod)

Both apps use the same stack — `react-hook-form` + `@hookform/resolvers/zod` — but showroom demonstrates the more mature, consolidation-respecting version.

**vern-vault** (`features/admin/components/VehicleForm.tsx`): one large form component owns `useForm({ resolver: zodResolver(vehicleFormSchema) })`, plus bespoke localStorage-based autosave-draft logic (`readDraft`/`clearVehicleDraft`, TTL-expired drafts binned) scoped to the "add" flow only (edits are intentionally not autosaved, to avoid masking fresher DB data on reopen).

**showroom** (`features/admin/components/vendors/VendorForm.tsx`): same `useForm` + `zodResolver` core, but field-level UI (`OpsDateField`, `OpsTimeField`, `OpsSelectField`, `OpsTextField` in `components/fields/`) is extracted into shared components specifically because — per the file's own header comment — three hand-duplicated dark-calendar blocks and five selects each re-implementing the same focus styling had drifted. The form component's job shrinks to composing fields + calling the mutation; it "stopped being able to get any of them wrong in only two of three places."

**TrainOS adaptation:** this is a direct, low-risk win and matches CLAUDE.md's own "consolidation over repetition" rule almost verbatim. Build a small `fields/` kit (text/select/date/time at minimum) once, before the second form needs one of them, rather than letting per-form field styling drift the way showroom's own comment says it once did. The autosave-draft pattern (vern-vault) is worth keeping for any TrainOS form that's long enough to lose to an accidental tab close — scope it to "new record" flows only, per vern-vault's stated reasoning about not masking fresher data on an edit form.

---

## 10. Routing

**vern-vault** (`src/App.tsx`): all routes are hardcoded path strings directly in one `<Routes>` tree, no route-constants file, no `React.lazy()` for page-level code splitting (the app's only `lazy()` call is a 3D asset overlay component, not a route). Route-level authz uses `<RequireRole allow={[...]}>` wrapping the element inline (§3.1).

**showroom** (`src/App.tsx` + `src/shared/config/admin-routes.ts`): every admin page is `React.lazy()`-loaded (`const GuestsPage = lazy(() => import("@/features/admin/pages/GuestsPage"))`, 12 lazy imports total), and retired/legacy route patterns are centralized in one exported constant, `RETIRED_ADMIN_ROUTE_PATTERNS`, consumed both by the route table (to render a `RetiredAdminRedirect`) and — per its own comment — by "the routing regression test," i.e. the same list is the single source of truth for both runtime behavior and test coverage.

```ts
// src/shared/config/admin-routes.ts
export const RETIRED_ADMIN_ROUTE_PATTERNS = [
  "/admin/*", "/admin-lite/*", "/demo/admin/*", "/demo/admin-lite/*",
] as const;
```

**TrainOS adaptation:** with 9 roles and (presumably) a dozen-plus admin screens, lazy-loading every admin route is worth doing from day one (it's free — same `import()` syntax, no new dependency) rather than retrofitting it once the bundle is large, which is the position vern-vault is now in. A route-constants file isn't strictly necessary at vern-vault's single-page-admin scale, but TrainOS's scale is closer to showroom's, so the same "one exported list, consumed by both the route table and its own test" habit is worth adopting immediately for whatever equivalent of "retired/redirect" routes TrainOS accumulates (e.g. a stage/status that gets renamed).

---

## 11. Business-rules doc format (showroom `docs/design/business-rules-*.md`)

Non-goal per task scope beyond format capture, so this is deliberately brief.

Format observed across `business-rules-wishes-v1.md`, `business-rules-rsvp-v1.1.md`, `business-rules-runtime-config-onboarding-v1.md`:
- **Header block**: title, `Version`, `Created`, `Status` (with an explicit correction trail when status changed — e.g. "Ready for Implementation" struck through and replaced with "ACTIVE — shipped" plus the date and the migration that shipped it), `Related` links to sibling business-rules docs.
- **§1 Product Intent** — prose description, then explicit `Goals` / `Non-Goals (MVP)` bullet lists.
- **§2 Invariants** — a numbered table (`# | Invariant`) of rules that "must never be violated," phrased as testable assertions (e.g. "No RSVP existence leakage — Never confirm whether a phone number has an RSVP").
- **§3 Actors & Trust Model** — a table of actors with their permissions, plus a separate "Trust Rules" table (rule → rationale).
- Subsequent numbered sections cover the specific admin-access-control rules (e.g. "Admin RPC Access Control" with a fenced-code "✅ Rule:" callout) and any RLS/SQL-adjacent detail — out of scope to reproduce here per this task's non-goals.

**TrainOS adaptation:** the `Invariants` table and `Actors & Trust Model` table are directly reusable for TrainOS's approval workflows — e.g. an invariant like "a SALES role can never approve their own deal" reads naturally in this format, and the Status-with-correction-trail habit (never silently rewrite a stale status) is worth adopting for any TrainOS business-rules docs from the start.

---

## Recommended for TrainOS

1. **Role/scope resolution**: showroom's server-resolved-via-RPC model (§1.2), not vern-vault's client-read-a-table model — TrainOS's 9 roles and likely record-level scoping need the tenant/scope confirmation and four-state (loading/signed-out/not-approved/error) UI showroom already built.
2. **Data layer**: a typed RPC map + wrapper (§2.2, showroom's `rpc.ts`/`rpc.types.ts`), not direct `.from()` calls — the domain-vs-transport error split is exactly what an approval-banner needs to render correctly.
3. **Admin shell/nav**: one nav-item-config function feeding both desktop and mobile surfaces, filtered by role (extending showroom's `sectionId` filter, §3.2), with badge counts computed once in a data provider — this is the direct template for TrainOS's approvals badge.
4. **Mutation error handling**: showroom's centralized `MutationCache` + `meta.toastOnError` (§6.2), paired with the RPC layer's typed errors — copy this exact shape, retire vern-vault's per-hook repetition and its two-toast-library duplication.
5. **Fire-and-forget vs. awaited mutation asymmetry** (§2.1): keep this rule — TrainOS's approve/reject buttons are fire-and-forget and must declare `onError`, or a denied approval will silently look like nothing happened, which is the exact bug vern-vault's own test suite now guards against.
6. **No Effect.ts** (§7): both source apps' own authors, independently, concluded it isn't worth it; the more mature app (showroom) doesn't use it at all.
7. **Forms**: react-hook-form + zod with an extracted shared field kit from the start (§9) — matches CLAUDE.md's consolidation rule directly.
8. **Routing**: lazy-load every admin route from day one; keep a single exported list for any retired/redirect route patterns, consumed by both the route table and its test (§10).
9. **Realtime**: only where an approval-count genuinely needs push updates across users; invalidate-only, from one shared provider, never mutate component state directly from a channel callback (§4).
10. **Business-rules docs**: adopt the Invariants-table + Actors/Trust-Model-table format for TrainOS's approval-workflow rules (§11).
11. **Build, don't borrow**: a real shared EmptyState/LoadingState/ErrorState/ApprovalBanner component kit — neither source app has one generically, and TrainOS's own CLAUDE.md already calls for exactly this.

## What I could NOT verify

- **Lead Alert Pipeline's actual SQL/Edge Function code** (`supabase/functions/send-lead-alert/`, the outbox migration) was not independently read — this is explicitly non-goal territory (Supabase SQL, out of scope per task instructions), so §5 is reported as-described-in-the-Obsidian-note only, not code-verified. The note itself reads as internally consistent and describes a shipped, production-cutover-attempted feature, but "verified against code" does not apply to that section the way it does to §1.1, §2.1, and §3.1.
- **CI Pipeline (Vern)** and **PR Auto-Sync from Hot-State (Vern)** Obsidian notes were opened and confirmed to be devops/CI-only content (GitHub Actions, a bash PR-sync script) — explicitly out of scope per this task's non-goals, so they were not analyzed or verified further.
- **showroom's full RLS/migration history** (referenced throughout the RPC layer's comments, e.g. "migration 073," "migration 090") was not independently confirmed against actual SQL migration files — the frontend code's own comments were treated as the source of truth for what each migration changed, consistent with this task's non-goal of excluding Supabase SQL review.
- **showroom's `shared/tier/` (feature-flag-like tier gating)** was located (`src/shared/tier/`, referenced as `OpsSectionId` import source in `adminNavItems.ts:18`) but not read in depth — it appears to gate which ops sections a wedding's *plan tier* (not role) can see, which is a related but distinct axis from role-based nav filtering. Worth a follow-up read if TrainOS ever needs plan/tier-based (as opposed to role-based) feature gating.
- No dedicated "feature flags" system beyond vern-vault's `useAppConfig()`/`app_config` table (§1's sibling, config-as-data pattern) and showroom's tier system was found in either app; neither was confirmed to be a general-purpose feature-flag service (e.g. LaunchDarkly-style) — both are homegrown, DB-backed config reads.
