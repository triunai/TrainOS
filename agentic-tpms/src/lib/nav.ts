/**
 * The navigation tree — one config, rendered by the sidebar and used by
 * breadcrumbs. Paths are written once here; screens link with these.
 * (TrainOS R7: nav and routes come from one config.)
 */
export interface NavChild {
  key: string;
  label: string;
  path: string;
}

export interface NavParent {
  key: string;
  label: string;
  icon: string;
  path?: string;
  badgeKey?: BadgeKey;
  children: NavChild[];
}

export interface NavGroup {
  caption: string;
  parents: NavParent[];
}

export type BadgeKey = "decisions" | "triage" | "exceptions" | "outbox" | "claims";

export const NAV: NavGroup[] = [
  {
    caption: "Main",
    parents: [
      { key: "home", label: "Home", icon: "⌂", path: "/", children: [] },
      { key: "decisions", label: "Decisions desk", icon: "◆", path: "/decisions", badgeKey: "decisions", children: [] },
    ],
  },
  {
    caption: "Demand",
    parents: [
      {
        key: "pipeline",
        label: "Pipeline",
        icon: "⚑",
        badgeKey: "triage",
        children: [
          { key: "leads", label: "Leads", path: "/leads" },
          { key: "outbox", label: "Outbound outbox", path: "/outbox" },
          { key: "clients", label: "Clients", path: "/clients" },
        ],
      },
    ],
  },
  {
    caption: "Operations",
    parents: [
      {
        key: "operations",
        label: "Operations",
        icon: "▧",
        children: [
          { key: "board", label: "Package board", path: "/operations" },
          { key: "list", label: "All packages", path: "/operations/list" },
          { key: "new", label: "New package", path: "/operations/new" },
        ],
      },
      {
        key: "delivery",
        label: "Delivery",
        icon: "◷",
        badgeKey: "exceptions",
        children: [
          { key: "attendance", label: "Attendance desk", path: "/delivery/attendance" },
          { key: "certificates", label: "Certificates", path: "/delivery/certificates" },
        ],
      },
      {
        key: "resources",
        label: "Resources",
        icon: "◎",
        children: [
          { key: "trainers", label: "Trainers", path: "/resources/trainers" },
          { key: "vendors", label: "Venues & vendors", path: "/resources/vendors" },
        ],
      },
    ],
  },
  {
    caption: "Finance",
    parents: [
      {
        key: "finance",
        label: "Claims & AP",
        icon: "▬",
        badgeKey: "claims",
        children: [
          { key: "claims", label: "Claims", path: "/finance/claims" },
          { key: "payables", label: "Payables", path: "/finance/payables" },
          { key: "retention", label: "Retention", path: "/finance/retention" },
        ],
      },
    ],
  },
  {
    caption: "Knowledge",
    parents: [
      {
        key: "knowledge",
        label: "Knowledge",
        icon: "☐",
        children: [
          { key: "catalog", label: "Course catalog", path: "/knowledge/catalog" },
          { key: "cost-matrix", label: "Cost matrix", path: "/knowledge/cost-matrix" },
        ],
      },
    ],
  },
  {
    caption: "System",
    parents: [
      {
        key: "automation",
        label: "Automation",
        icon: "⚙",
        children: [
          { key: "agents", label: "Agent pool", path: "/system/agents" },
          { key: "queue", label: "Task queue", path: "/system/queue" },
          { key: "audit", label: "Audit ledger", path: "/system/audit" },
        ],
      },
      {
        key: "settings",
        label: "Settings",
        icon: "▥",
        children: [
          { key: "keys", label: "AI providers", path: "/settings/ai/keys" },
          { key: "usage", label: "Usage & cost", path: "/settings/ai/usage" },
        ],
      },
    ],
  },
];

/** Longest-prefix match of the current path onto the tree. */
export function selectNav(pathname: string): { parentKey: string | null; childKey: string | null } {
  let best: { parentKey: string; childKey: string | null; length: number } | null = null;
  for (const group of NAV) {
    for (const parent of group.parents) {
      const candidates: Array<{ path: string; childKey: string | null }> = [
        ...(parent.path ? [{ path: parent.path, childKey: null }] : []),
        ...parent.children.map((c) => ({ path: c.path, childKey: `${parent.key}/${c.key}` })),
      ];
      for (const c of candidates) {
        const matches = c.path === "/" ? pathname === "/" : pathname === c.path || pathname.startsWith(`${c.path}/`);
        if (matches && (!best || c.path.length > best.length)) best = { parentKey: parent.key, childKey: c.childKey, length: c.path.length };
      }
    }
  }
  // Package records live under /operations/<code>; they belong to the board.
  if (best?.childKey === "operations/board" && pathname.startsWith("/operations/") && pathname !== "/operations") {
    return { parentKey: "operations", childKey: "operations/board" };
  }
  return best ? { parentKey: best.parentKey, childKey: best.childKey } : { parentKey: null, childKey: null };
}
