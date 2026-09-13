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
