# App architecture patterns

The seven patterns that shape a role-gated, approval-heavy app. Each is stated with the
failure it prevents, because the failure is what makes the pattern worth the code.

---

## 1. Auth and role resolution — one RPC, server-resolved

**Do not resolve a role by reading a profile row from the client.** That works for a
single-tier admin surface and stops working the moment scope matters. A client-side read
answers "what role does this user have" but not "which records is this session approved
for", and a cached answer can go stale after an account or scope switch.

### The shape

One `SECURITY DEFINER` RPC returns `{ role, scopes, status }`. **The database decides**, not
a client-readable table. Called once per session or route-tree mount.

```ts
// src/features/auth/hooks/useAccessContext.ts
const accessQuery = useQuery<AccessData, AccessError>({
  // The user id is IN THE KEY: switching accounts must not reuse a stale approval.
  queryKey: ["access-context", requestedScope, user?.id],
  queryFn: async () => {
    const { data, error } = await rpc("get_access_context", { p_scope: requestedScope });
    if (error) throw accessErrorFromRpc(error);

    // Re-validate unconditionally, even though the wrapper type-checks in dev.
    // Admission is a production authorization boundary — cheap insurance
    // against a migration renaming a role or status the client is not ready for.
    const parsed = accessContextSchema.safeParse(data);
    if (!parsed.success) throw new AccessError("MALFORMED_ACCESS", "Invalid access context");

    // Scope confirmation: defends against a race where the URL scope changed
    // but the query has not refetched yet.
    if (normalizeScope(parsed.data.scope) !== requestedScope) {
      throw new AccessError("SCOPE_MISMATCH", "Scope changed mid-flight");
    }
    return parsed.data;
  },
  enabled: Boolean(session && user && requestedScope),
  // Domain-aware retry: a refusal is a FACT, not flakiness. Only transport
  // errors get a retry.
  retry: (n, error) =>
    error.code !== "ACCESS_NOT_APPROVED" && error.code !== "AUTH_REQUIRED" && n < 1,
});
```

### Four explicit states, never one boolean

`isLoading` collapses four genuinely different situations into one spinner. Render each:

| State | Surface |
|---|---|
| loading | skeleton, not a spinner over an empty page |
| signed out | the sign-in path |
| signed in but not approved | **a first-class product surface**: what this is, how to request access, who to ask. Not a generic error page |
| technical error | an explanation plus a retry button |

Only after all four clear does the provider mint scope and render the outlet.

### Then put it in exactly one context

```tsx
// The resolved { role, scopes, status } is the SINGLE source of role and scope
// truth for the whole gated subtree. Every child reads useAccessContext().
// Nothing re-derives a role from a separately fetched table.
<AccessProvider value={scope}>
  <Outlet />
</AccessProvider>
```

### Capability flags, positive and tiered

Expose named capabilities, never `role !== 'X'` negatives. A negative check silently grants
access to every role added later.

```ts
return {
  role,
  scopes,
  canApprove: role === "MANAGER" || role === "DIRECTOR" || role === "ADMIN",
  canPublish: role === "DIRECTOR" || role === "ADMIN",
  isAdmin: role === "ADMIN",
  loading: authLoading || (!!user && query.isLoading),
};
```

### Two supporting rules

- **One `onAuthStateChange` subscription** for the whole app, shared through context. More
  than one produces a real, visible auth flicker.
- **On sign-out, remove the cached profile queries**
  (`queryClient.removeQueries({ queryKey: profileKeys.all })`), or a prior user's role leaks
  to the next person who signs in on that device.
- **Parse, do not cast.** `schema.parse(data)`, never `data as Profile`. A schema drift
  should throw, not type bad data as valid.

### Route guard

```tsx
export function RequireRole({ allow, children }: { allow: Role[]; children: ReactNode }) {
  const { session, loading: authLoading } = useAuth();
  const { role, loading: roleLoading } = useAccessContext();
  // Loading is treated as NOT allowed — fail closed while resolving.
  if (authLoading || roleLoading) return <RouteLoadingState />;
  if (!session) return <Navigate to="/login" replace />;
  if (!role || !allow.includes(role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}
```

The route guard and the capability flags are **cosmetic convenience**. The database is the
real boundary. A denied write must still be visibly handled in the UI — see §4.

---

## 2. Typed RPC map — the whole data boundary

Nearly nothing reads tables directly. Business rules must be enforced identically for every
caller, and scattered table queries invite drift.

### src/lib/rpc.ts

One wrapper everything goes through. It returns `{ data, error }` tuples and never throws,
so callers keep an ordinary `if (error)` idiom.

```ts
interface FailureEnvelope {
  success: false;
  error: { code?: string; message?: string; field?: string; [key: string]: unknown };
}

// Unknown extra fields are normalized into an untyped `details` bag rather than
// dropped: a new diagnostic field an RPC starts returning reaches the caller
// without a second edit here.
function toDomainError(envelope: FailureEnvelope): RpcError {
  const details: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(envelope.error ?? {})) {
    if (!PROJECTED_ERROR_KEYS.includes(key)) details[key] = value;
  }
  return {
    kind: "domain",
    code: envelope.error?.code ?? "UNKNOWN",
    message: envelope.error?.message ?? "Unknown error",
    field: envelope.error?.field,
    ...(Object.keys(details).length > 0 ? { details } : {}),
  };
}
```

Two behaviours worth building in from the start:

- **Domain errors versus transport errors are distinguished.** A refusal from the database
  is not a network failure and must not be retried or rendered the same way.
- **"The RPC does not exist yet" is its own case**, detected on the **error code**
  (PostgREST `PGRST202`, Postgres `42883`), never on message text. A not-yet-deployed
  migration then degrades to a feature's "unsupported" state rather than a generic error.

### src/lib/rpc.types.ts

```ts
// One interface mapping RPC name -> { args, response }. Every call site derives
// its types from here, so a signature change is a ONE-FILE edit that ripples
// out as compile errors everywhere instead of a silent shape mismatch.
export interface RpcMap {
  get_access_context: {
    args: { p_scope: string };
    response: { role: Role; scopes: string[]; status: AccessStatus };
  };
  // ...
}
```

Updated in the **same commit** as the SQL. See the seven-point contract in
`references/supabase.md` §5.

### Where to validate at runtime

The generic wrapper type-checks in development only. Add unconditional Zod validation at
the boundaries that matter: anywhere the RPC crosses an **authorization** boundary, and
anywhere a malformed response would render as if it were valid. Not on every call — that is
a real cost with no matching benefit for a read that is already displayed as data.

### Query keys

One `src/lib/queryKeys.ts` holding a hierarchical factory. Hooks never hardcode key arrays.

```ts
export const recordKeys = {
  all: ["records"] as const,
  lists: () => [...recordKeys.all, "list"] as const,
  list: (filters: Filters) => [...recordKeys.lists(), filters] as const,
  details: () => [...recordKeys.all, "detail"] as const,
  detail: (id: string) => [...recordKeys.details(), id] as const,
};
```

Feature-local key files are fine as the project grows; a single central file is the better
starting point and is easy to split along feature lines later.

---

## 3. Role-filtered navigation — one config, both surfaces

**One function is the single source of truth for every nav surface.** Desktop rail and
mobile sheet both call it and filter only on placement, so the two can never disagree about
what is visible.

```ts
export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  placement: "bottom-nav" | "sidebar" | "both";
  badgeKey?: NavBadgeKey;     // closed union, so a renderer can index a count map with no cast
  sectionId?: SectionId;      // omitted = always-on chrome, never filtered
  allowedRoles?: Role[];      // omitted = visible to every role that reached this shell
}

export function getNavItems(
  role: Role,
  hiddenSections?: ReadonlySet<string>,
): NavItem[] {
  const items: NavItem[] = [ /* one array, every surface reads it */ ];
  // EXACTLY ONE filtering pass. Both surfaces consume the result.
  return items.filter(
    (item) =>
      (item.sectionId === undefined || !(hiddenSections?.has(item.sectionId) ?? false)) &&
      (item.allowedRoles === undefined || item.allowedRoles.includes(role)),
  );
}

export const getSidebarNavItems = (role: Role, hidden?: ReadonlySet<string>) =>
  getNavItems(role, hidden).filter((i) => i.placement !== "bottom-nav");
export const getBottomNavItems = (role: Role, hidden?: ReadonlySet<string>) =>
  getNavItems(role, hidden).filter((i) => i.placement !== "sidebar");
```

Three rules around it:

- **Unresolved section visibility reads as all-visible.** Never hide on a guess: a config
  read that has not returned yet, or a config row that does not exist, must not make a
  section disappear.
- **Badge counts are computed once** in a data provider above the shell and passed down as a
  typed `{ [badgeKey]: number }` map. Not fetched per nav item.
- **Chrome constants live in one file** — bar heights, container widths, z-index. This
  specifically prevents a real recurring bug: four different bar heights across four
  surfaces that are supposed to line up.

### Fail closed on scope-less URLs

If there are legacy or ambiguous gated URLs, centralize them in one exported list and
redirect them out rather than mounting a reader or writer speculatively. Operators must
enter through a path that carries real scope, so every read and write is scoped.

```ts
export const RETIRED_ROUTE_PATTERNS = ["/admin/*", "/admin-lite/*"] as const;
```

Export that list from one file and have **both** the route table and its regression test
consume it, so runtime behaviour and test coverage cannot drift.

---

## 4. Mutation errors — centralized, opt-in

**One place decides what a mutation error looks like.** Per-hook `onError: () => toast(...)`
repetition drifts in copy and in coverage.

```ts
// src/lib/queryClient.ts
import { QueryClient, MutationCache } from "@tanstack/react-query";
import { toast } from "sonner";

export const queryClient = new QueryClient({
  defaultOptions: {
    mutations: { retry: 0 },
    queries: { retry: 1, staleTime: 30_000 },
  },
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      if (mutation.options.meta?.toastOnError !== true) return;
      const message = error instanceof Error ? error.message : "Something went wrong.";
      toast.error(message);
    },
  }),
});
```

A mutation opts in with `{ meta: { toastOnError: true } }` and gets consistent behaviour for
free. One that wants custom handling omits the flag. Add a typed `meta` augmentation so the
flag autocompletes:

```ts
declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: { toastOnError?: boolean };
  }
}
```

### The asymmetry rule — keep this one

**A fire-and-forget mutation MUST surface its error. An awaited one must not double-report.**

| Call style | Error handling |
|---|---|
| `mutate(...)` from a button, nothing awaits it | `meta: { toastOnError: true }` — mandatory |
| `await mutateAsync(...)` inside a try/catch that renders an inline error | no toast flag — a flag here double-reports |

This is not stylistic. Omitting it on the fire-and-forget path produced a real bug: a
permission-denied write from the database showed nothing at all, and "the publish button
does nothing" was the only symptom. Approve and reject buttons are exactly this shape.

**One toast library.** Mounting two toast systems side by side is debt, not a pattern.

---

## 5. The shared state kit — build it, do not borrow it

Neither source repo has a generic empty / loading / error component kit, and both paid for
it in per-page ad hoc markup that drifted. This is the one section where there is nothing to
copy and everything to build. Build it before the second screen needs it.

```
src/components/states/
  EmptyState.tsx        # icon/illustration, title, one-line description, one primary action
  LoadingState.tsx      # skeleton shaped like the content, not a centered spinner
  ErrorState.tsx        # what failed, what the reader can do, a retry affordance
  AccessBlockedState.tsx # signed in, not approved: what this is, how to request access
  index.ts
```

`AccessBlockedState` is the one "state" component the source repos did build well, because
it is genuinely a product surface rather than a fallback: an eyebrow, a title, a
description, an explanation of how to get access, and a short FAQ.

Each state component takes its copy as props. Never hardcode a domain sentence inside the
kit.

---

## 6. Forms

`react-hook-form` + `@hookform/resolvers/zod`, with a **shared field kit extracted before the
second form needs one**.

```
src/components/fields/
  TextField.tsx
  SelectField.tsx
  DateField.tsx
  TimeField.tsx
  index.ts
```

The failure this prevents, in the source repo's own words: three hand-duplicated date-picker
blocks and five selects each re-implementing the same focus styling had drifted. After
extraction the form component's job shrank to composing fields and calling the mutation, and
it "stopped being able to get any of them wrong in only two of three places".

The form component then looks like:

```tsx
const form = useForm({ resolver: zodResolver(recordFormSchema) });
// fields compose; submit calls the mutation; inline errors come from the resolver
```

**Autosave drafts**: worth it for any form long enough to lose to an accidental tab close.
Scope it to **new-record flows only**. Do not autosave an edit form — restoring a stale
local draft over fresher server data on reopen is worse than losing the draft.

---

## 7. Theme and routing

### Theme

Neither reference app demonstrates a working light/dark toggle on a gated admin surface; the
more mature one explicitly opted out and fixed its console to one appearance. Unless a
toggle is a stated requirement, follow that: **one fixed appearance, styled with CSS custom
properties defined once**, rather than introducing a theme-switching library neither
reference app exercises in this context.

Keep the public surface's token set and the gated surface's token set separate and
non-interchangeable if they genuinely have different design languages. Both are defined
once, in CSS custom properties, and consumed through the Tailwind config
(`references/stack.md` §5).

### Routing

- **Lazy-load every gated route from day one.** It is free — the same `import()` syntax, no
  new dependency — and retrofitting it once the bundle is large is a project.

  ```ts
  const RecordsPage = lazy(() => import("@/features/records/pages/RecordsPage"));
  ```

- **One exported list for retired or redirected route patterns**, consumed by the route
  table and its test (§3).
- Route-level authorization wraps the element with `RequireRole` (§1).

---

## 8. Realtime — only where it earns its place

Default to **invalidate on mutation success**. A mutation's `onSuccess` invalidating the
relevant query key covers almost everything, and it is much less to operate.

Add a realtime channel only where a count genuinely needs to update across users from
someone else's action — a pending-approvals badge is the canonical case.

```ts
// Realtime -> cache invalidation ONLY. Never mutate component state directly
// from a channel callback.
export const subscribeApprovals = (onChange: () => void): (() => void) => {
  const channel = supabase
    .channel("approvals-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "approvals" }, onChange)
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
};
```

Consume it from **one shared provider**, not per-component. Per-component subscriptions
collide on channel topic and the workaround (a module-level counter appended to the topic
name) is a symptom, not a fix. The backing query uses `staleTime: Infinity` — it refetches
only because realtime said so, never on a timer.

At scale, prefer database-triggered Broadcast over the raw change feed; see
`references/supabase.md` §11 for the threshold and the reason.

---

## 9. Notifications — one rule

**A notification-path failure must never roll back or block the business action it
describes.** An approval request must succeed even if the badge refresh, the email, or the
push fails.

Concretely: enqueue the notification in a trigger whose exception is swallowed, with its own
status tracking separate from the primary write's success or failure. Give the pipeline its
own dead-letter visibility — the primary feature's error handling will not cover it.

The incident behind this: swapping a notification recipient while the sender was still in
sandbox mode produced a silent delivery failure. The provider returned a status outside the
retryable set, the message went straight to dead, and nobody was alerted. Verify a
destination is production-ready before swapping it, and make sure something is watching the
dead letters.

---

## 10. Business-rules docs

For approval workflows specifically, two table formats are directly reusable:

**Invariants** — a numbered table of rules that must never be violated, each phrased as a
testable assertion. "A sales role can never approve their own deal" reads naturally here and
converts straight into a SQL test.

**Actors and trust model** — a table of actors with their permissions, plus a separate
trust-rules table of rule → rationale.

One habit worth adopting from the start: **never silently rewrite a stale status header.**
Strike the old status through, put the new one beside it with the date and what shipped it.
A reader who half-remembers the old status needs to see the correction, not silence.
