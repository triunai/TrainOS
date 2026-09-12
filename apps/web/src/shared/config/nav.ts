import type { Role } from "@trainos/contract";
import { NAV_ROLE_KEY } from "./roles";
import {
  ALERT_CHILD_LABEL,
  ROLE,
  ROOT_PARENT_LABEL,
  TREE,
  type NavGroupCaption,
  type RawChild,
  type RawParent,
} from "./navTree";

/**
 * ONE function is the single source of truth for every nav surface. The desktop
 * sidebar, a future mobile sheet and the route table all consume
 * `getNavGroups()`, so they cannot disagree about what exists or who sees it.
 *
 * There is exactly ONE filtering pass. Anything that needs a subset filters the
 * RESULT; nothing re-runs the role logic.
 */

export interface NavChild {
  /** Stable key — the source label, which is unique within a parent. */
  key: string;
  label: string;
  path: string;
  /** Static count from the design pack. Live counts replace this later. */
  badge?: number;
}

export interface NavParent {
  key: string;
  label: string;
  /** The glyph the design pack draws. Not a Lucide icon name. */
  icon: string;
  /** Present only for a leaf parent (no children), e.g. Reports. */
  path?: string;
  children: NavChild[];
  /** Sum of the children's badges, absent when the sum is zero. */
  badge?: number;
  /** True when the badge must render in the alert colour rather than the count colour. */
  badgeIsAlert: boolean;
}

export interface NavGroup {
  caption: NavGroupCaption;
  parents: NavParent[];
}

/**
 * Label -> URL segment. Lowercase, spaces to hyphens, anything that is not
 * `a-z0-9-` dropped. "HRD Corp" -> "hrd-corp", "AI Models" -> "ai-models".
 */
export function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * THE PATH RULE, stated once.
 *
 *  - A child of the root parent (`Home`) lives at the root: `/approvals`.
 *  - Any other child lives under its parent's slug: `/sales/enquiries`.
 *  - A parent with no children is itself a leaf: `/reports`.
 *
 * The design pack carries no hrefs — its artboards are static — so this rule is
 * the repository's own, and it is deliberately the only place a path is built.
 */
export function navPath(parentLabel: string, childLabel?: string): string {
  if (childLabel === undefined) return `/${slugify(parentLabel)}`;
  if (parentLabel === ROOT_PARENT_LABEL) return `/${slugify(childLabel)}`;
  return `/${slugify(parentLabel)}/${slugify(childLabel)}`;
}

function buildChild(parentLabel: string, raw: RawChild): NavChild {
  const [label, badge] = raw;
  return {
    key: label,
    label,
    path: navPath(parentLabel, label),
    ...(badge === undefined ? {} : { badge }),
  };
}

function buildParent(raw: RawParent): NavParent {
  const [label, icon, rawChildren] = raw;
  const children = (rawChildren ?? []).map((child) => buildChild(label, child));
  const badgeTotal = children.reduce((sum, child) => sum + (child.badge ?? 0), 0);
  return {
    key: label,
    label,
    icon,
    ...(rawChildren === null ? { path: navPath(label) } : {}),
    children,
    ...(badgeTotal > 0 ? { badge: badgeTotal } : {}),
    badgeIsAlert: children.some((child) => child.label === ALERT_CHILD_LABEL),
  };
}

/** The unfiltered tree — every group, every parent, every child. */
export const ALL_NAV_GROUPS: NavGroup[] = TREE.map(([caption, parents]) => ({
  caption,
  parents: parents.map(buildParent),
}));

/**
 * The nav a role sees.
 *
 * Fail-open on an unmapped role: a role with no entry in the pack's ROLE map
 * reads as "sees everything the map does not restrict" rather than an empty
 * sidebar. Never hide on a guess — an empty rail reads as a broken app, and a
 * hidden item is not a security control. The API is the real boundary.
 */
export function getNavGroups(role: Role): NavGroup[] {
  const roleKey = NAV_ROLE_KEY[role];
  if (roleKey === null) return [];

  const allowed = ROLE[roleKey];
  if (allowed === null || allowed === undefined) return ALL_NAV_GROUPS;

  return ALL_NAV_GROUPS.map((group) => {
    const allowedParents = allowed[group.caption];
    if (allowedParents === undefined) return { ...group, parents: [] };
    return {
      ...group,
      parents: group.parents.filter((parent) => allowedParents.includes(parent.label)),
    };
  }).filter((group) => group.parents.length > 0);
}

/** Every navigable leaf in the tree, flattened. The route table reads this. */
export interface NavRoute {
  path: string;
  label: string;
  /** The parent whose section this route belongs to. */
  section: string;
  caption: NavGroupCaption;
}

export const ALL_NAV_ROUTES: NavRoute[] = ALL_NAV_GROUPS.flatMap((group) =>
  group.parents.flatMap((parent) =>
    parent.children.length > 0
      ? parent.children.map((child) => ({
          path: child.path,
          label: child.label,
          section: parent.label,
          caption: group.caption,
        }))
      : [
          {
            path: parent.path as string,
            label: parent.label,
            section: parent.label,
            caption: group.caption,
          },
        ],
  ),
);

/** Where `/` lands. The first leaf of the root parent. */
export const DEFAULT_ROUTE_PATH = navPath(ROOT_PARENT_LABEL, "Dashboard");
