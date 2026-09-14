/**
 * §2 · Session and shell.
 *
 * The chrome every screen shares: who is looking, the nav tree, ⌘K search,
 * the audit drawer, saved views, templates.
 */

import type {
  AnyActor,
  Badge,
  Ref,
  Timestamp,
} from '../envelope';
import type { FilterClause } from '../envelope';
import type {
  EvidenceType,
  Role,
  SavedViewObject,
  TemplateType,
  Theme,
  MessageCategory,
} from '../enums';
import type { UiActionType, ActionType } from '../actions';
import type { Money } from '../envelope';

/* ------------------------------------------------------------------ *
 * §2 · GET /v1/me
 * ------------------------------------------------------------------ */

/**
 * §2 what the signed-in principal may see and do.
 *
 * Permissions come from here, and every gated action also returns `403` with
 * `details.requiredRole`, so the UI can explain rather than just disable.
 */
export interface Me {
  id: string;
  name: string;
  role: Role;
  /** Colon-scoped grants, e.g. `proposal:submit`. */
  permissions: string[];
  dataScope: DataScope;
  /** BCP-47, e.g. `en-MY`. */
  locale: string;
  /** IANA zone, e.g. `Asia/Kuala_Lumpur`. */
  timezone: string;
  theme: Theme;
}

/* ------------------------------------------------------------------ *
 * §2 · GET /v1/me/profile — ruled R14
 * ------------------------------------------------------------------ */

/**
 * §2 ruled R14 · the signed-in principal's own record, for the profile modal.
 *
 * Kit.dc.html §07 "Profile modal · 960" draws eleven fields `Me` does not
 * carry. They are published here rather than added to `Me`, and the reason is
 * in §2's own description of that endpoint: `GET /v1/me` is "who is looking ·
 * all roles · **every screen**". It is the shell bootstrap — nav filtering and
 * permission checks read it on every page.
 *
 * Widening it would put a personal mobile number, a staff number, a last
 * sign-in and the account's two-factor state into every screen's query cache,
 * on every page load, to serve a modal most sessions never open. A field that
 * is only ever read on demand should be fetched on demand, and the narrower
 * payload is also the one a `403` can refuse without breaking the shell.
 *
 * The fields are three different records wearing one panel, which is the
 * second reason they are not `Me`: the tenant is not the user, the HR record
 * is not the session, and the session security block changes on a cadence
 * neither of the others does.
 *
 * Display formatting is NOT in here. The artboard prints "Chrome · Shah Alam,
 * GMT+8" and "11-09-2026 08:04:22 AM"; those are one sentence and one locale
 * decision assembled by the screen, and a contract that shipped them
 * pre-joined would have put the app's date format on the server.
 *
 * `apps/web/src/shared/config/profileDetails.ts` is what this deletes; it is
 * gap 14 in the fixtures README.
 */
export interface MeProfile {
  /** Matches `Me.id`. The endpoint is always the caller's own record. */
  id: string;
  /** The employing tenant, as the modal's identity line names it. */
  tenant: TenantIdentity;
  /**
   * Where the holder works, e.g. `Klang Valley`. Not the session's place.
   *
   * Optional: no table in the schema stores a principal's work location —
   * `public.user_profiles` carries only `display_name`, `email`, `locale`,
   * `timezone`, `theme` and `avatar_url` (`location`, like `jobTitle`,
   * `department` and `staffNumber` below, exists on `core.contacts`, a
   * different entity). `null` on the wire until something stores it.
   */
  location?: string;
  jobTitle?: string;
  department?: string;
  email: string;
  /** E.164 with the pack's spacing, e.g. `+60 12-448 9021`. */
  mobile?: string;
  staffNumber?: string;
  /** Modules the principal is entitled to — the modal's first chip. */
  moduleCount: number;
  /**
   * Optional, and coarser than its own fields' optionality: `core.me_profile()`
   * answers `session: null` as a WHOLE when it has nothing to report, not an
   * object with every field null. A reader that unwrapped `session` first and
   * only then checked its fields would throw on that shape; the block is
   * gated on `session` itself before anything inside it is read.
   */
  session?: ProfileSession;
}

/** §2 ruled R14 · the tenant as the profile panel names it. */
export interface TenantIdentity {
  /** Trading name, e.g. `Akademi Perdana`. Not the registered name. */
  name: string;
  /** The tenant's short code, e.g. `APSB`. */
  code: string;
}

/**
 * §2 ruled R14 · the security half of the panel.
 *
 * `browser` and `place` are separate because the artboard's "Chrome · Shah
 * Alam, GMT+8" is a sentence the screen builds, and because a place is the
 * thing a person scans for when checking whether a session is theirs.
 *
 * All four fields below `lastSignInAt` are optional. Nothing in the schema
 * stores a user-agent string or a geo-located place, so `browser` and `place`
 * have no source and are optional for that reason alone. `activeSessions` and
 * `twoFactorEnabled` are optional too, provisionally: Supabase's `auth.sessions`
 * and `auth.mfa_factors` could in principle derive them, but until the SQL
 * lane building `core.me_profile()` (022) confirms it actually populates them,
 * treating them as certain would be a claim this file cannot back up.
 * `lastSignInAt` stays required — `auth.users.last_sign_in_at` is a stored
 * column, not a derivation.
 */
export interface ProfileSession {
  lastSignInAt: Timestamp;
  /** e.g. `Chrome`. */
  browser?: string;
  /** e.g. `Shah Alam`. */
  place?: string;
  /** Sessions open right now, this one included. */
  activeSessions?: number;
  twoFactorEnabled?: boolean;
}

/**
 * §2 permission strings for the quotation object (ruling R2).
 *
 * The contract never catalogues the permission vocabulary — the `/me` example
 * shows only `enquiry:read`, `enquiry:convert`, `proposal:write` and
 * `proposal:submit`. These three are ruled, not derived, and are published as
 * constants so the fixture client and the Supabase policies spell them the
 * same way. `Me.permissions` stays `string[]`; a closed union would be an
 * invention.
 * TODO(contract §2): catalogue the full permission vocabulary.
 */
export const QUOTATION_PERMISSIONS = [
  'quotation:read',
  'quotation:write',
  'quotation:apply',
] as const;
export type QuotationPermission = (typeof QUOTATION_PERMISSIONS)[number];

/**
 * §2 row-level scope.
 *
 * Only `MY_ACCOUNTS` and `MY_TEAM` appear in the example and §12 catalogues
 * neither, so the values stay open.
 * TODO(contract §16): catalogue the data-scope vocabulary.
 */
export interface DataScope {
  clients: string;
  teams: string;
}

/* ------------------------------------------------------------------ *
 * §2 · GET /v1/navigation
 * ------------------------------------------------------------------ */

/** §2 role-filtered nav tree with badge counts inlined, so the sidebar makes one call. */
export interface NavigationTree {
  groups: NavigationGroup[];
}

/** §2 a captioned block of the sidebar, e.g. `MAIN`. */
export interface NavigationGroup {
  caption: string;
  parents: NavigationParent[];
}

/** §2 a collapsible parent item. */
export interface NavigationParent {
  key: string;
  label: string;
  icon?: string;
  path?: string;
  badge?: Badge;
  children?: NavigationChild[];
}

/** §2 a leaf nav item. */
export interface NavigationChild {
  key: string;
  label: string;
  path: string;
  badge?: Badge;
}

/* ------------------------------------------------------------------ *
 * §11 · Badge counts (SSE `badges` channel)
 * ------------------------------------------------------------------ */

/** §11 the `badges` channel payload; also the shape API.md polls at `/badges`. */
export interface BadgeCounts {
  approvals: number;
  hrdcDeadlines: number;
  agentFailures: number;
}

/* ------------------------------------------------------------------ *
 * §2 · GET /v1/search
 * ------------------------------------------------------------------ */

/** §2 ⌘K result set: records to open, actions to start. */
export interface SearchResult {
  records: SearchRecord[];
  actions: SearchAction[];
}

/** §2 a matched record. */
export interface SearchRecord {
  type: EvidenceType;
  ref: Ref;
  title: string;
  subtitle?: string;
  path: string;
}

/**
 * §2 an action the palette can start.
 *
 * `PROPOSAL_CREATE` in the example is a UI intent, not a §3 action type — see
 * `UI_ACTION_TYPES` in actions.ts.
 */
export interface SearchAction {
  type: ActionType | UiActionType;
  label: string;
  targetRef: Ref;
}

/* ------------------------------------------------------------------ *
 * §2 · GET /v1/{resourceType}/{id}/audit
 * ------------------------------------------------------------------ */

/** §2 one row of the audit drawer. Present on every record screen. */
export interface AuditEntry {
  at: Timestamp;
  actor: AnyActor;
  /** Domain event name, e.g. `ProposalDrafted` (§14). */
  event: string;
  summary: string;
  runId?: string;
}

/* ------------------------------------------------------------------ *
 * §2 · GET /v1/views — saved views drive the pill tab group
 * ------------------------------------------------------------------ */

/**
 * §2 a saved view. Server-side so pill tabs and their counts stay consistent
 * across devices.
 * TODO(contract §16 Q9): shared or personal? The demo shows counts that imply
 * shared team views.
 */
export interface SavedView {
  id: string;
  label: string;
  object: SavedViewObject;
  count: number;
  isDefault: boolean;
  filters: FilterClause[];
  columns: string[];
}

/** §2 `POST /v1/views` and `PATCH /v1/views/{id}` body. */
export interface SavedViewWrite {
  label: string;
  object: SavedViewObject;
  filters: FilterClause[];
  columns: string[];
  isDefault?: boolean;
}

/* ------------------------------------------------------------------ *
 * §2 · GET /v1/templates
 * ------------------------------------------------------------------ */

/** §2 a template. Nothing is hardcoded in the frontend; everything resolves here. */
export interface Template {
  id: string;
  type: TemplateType;
  version: number;
  label: string;
  mergeFields: string[];
  sections?: TemplateSection[];
  /** §2, §4 — WhatsApp templates only. */
  category?: MessageCategory;
  ratePerMessage?: Money;
}

/** §2 one section of a document template. */
export interface TemplateSection {
  n: number;
  title: string;
  aiEnabled: boolean;
}

/* ------------------------------------------------------------------ *
 * §none · Notifications — ruled R8
 * ------------------------------------------------------------------ */

/**
 * §none — ruled R8. The top-bar bell is drawn on every screen with a fixed
 * count of four, but §2 publishes no shape for it. Shape lifted verbatim from
 * the fixture package's `FixtureNotification`, which had filled the gap
 * locally.
 */
export interface Notification {
  id: string;
  at: Timestamp;
  severity: 'INFO' | 'WARN' | 'DANGER';
  title: string;
  body: string;
  path: string;
  read: boolean;
}
