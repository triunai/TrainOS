/**
 * The navigation TREE and ROLE map, transcribed verbatim from the design
 * pack's `build/kit.js` (docs/research/09-design-pack-inventory.md §2.1, §2.2).
 *
 * Nothing here is invented. The literal arrays keep the same order, the same
 * labels, the same icon glyphs and the same badge counts as the source, so a
 * diff against the pack is a straight read. Route paths are NOT in the source —
 * they are derived by one rule in `nav.ts`, stated there.
 */

/** A group caption in the sidebar, e.g. `MAIN`. */
export type NavGroupCaption = "MAIN" | "OPERATIONS" | "KNOWLEDGE" | "SYSTEM";

/** `[label]` or `[label, badgeCount]` — the source's own child shape. */
export type RawChild = readonly [label: string] | readonly [label: string, badge: number];

/** `[label, icon, children | null]` — the source's own parent shape. */
export type RawParent = readonly [label: string, icon: string, children: readonly RawChild[] | null];

/** `[caption, parents]` — the source's own group shape. */
export type RawGroup = readonly [caption: NavGroupCaption, parents: readonly RawParent[]];

/** Verbatim `TREE` from `build/kit.js`. Static badge counts included. */
export const TREE: readonly RawGroup[] = [
  [
    "MAIN",
    [
      ["Home", "⌂", [["Dashboard"], ["Approvals", 7], ["My tasks"]]],
      [
        "Sales",
        "⚑",
        [
          ["Enquiries"],
          ["Leads"],
          ["Organisations"],
          ["Contacts"],
          ["Pipeline"],
          ["TNA"],
          ["Proposals"],
        ],
      ],
      ["Relationships", "⇄", [["Renewals"], ["Cross-sell"], ["Marketing"]]],
    ],
  ],
  [
    "OPERATIONS",
    [
      [
        "Training",
        "▧",
        [
          ["Programmes"],
          ["Engagements"],
          ["Calendar"],
          ["Trainers"],
          ["Participants"],
          ["Assessments"],
          ["Certificates"],
        ],
      ],
      [
        "Compliance",
        "⚖",
        [["HRD Corp", 3], ["Rules"], ["Rule changes", 3], ["Documents"], ["Deadlines"]],
      ],
      [
        "Finance",
        "▬",
        [["Quotations"], ["Invoices"], ["Collections"], ["Commissions"], ["Profitability"]],
      ],
    ],
  ],
  [
    "KNOWLEDGE",
    [["Knowledge", "▢", [["Library"], ["Sources", 1], ["Templates"], ["Knowledge base"]]]],
  ],
  [
    "SYSTEM",
    [
      ["Automation", "⌬", [["Agents"], ["Runs"], ["Failures", 2], ["Policies"]]],
      ["Reports", "◫", null],
      [
        "Settings",
        "⚙",
        [
          ["Organisation"],
          ["AI Models"],
          ["Providers"],
          ["Usage"],
          ["Templates"],
          ["Policies"],
        ],
      ],
    ],
  ],
] as const;

/**
 * Verbatim `ROLE` from `build/kit.js`: which groups and parents each nav-role
 * key sees. `null` (admin) means every group and every parent.
 */
export const ROLE: Readonly<
  Record<string, Partial<Record<NavGroupCaption, readonly string[]>> | null>
> = {
  sales: {
    MAIN: ["Home", "Sales", "Relationships"],
    OPERATIONS: ["Training"],
    KNOWLEDGE: ["Knowledge"],
  },
  ops: { MAIN: ["Home"], OPERATIONS: ["Training", "Compliance"], KNOWLEDGE: ["Knowledge"] },
  finance: { MAIN: ["Home"], OPERATIONS: ["Finance", "Compliance"], KNOWLEDGE: ["Knowledge"] },
  exec: {
    MAIN: ["Home", "Sales", "Relationships"],
    OPERATIONS: ["Finance"],
    SYSTEM: ["Automation", "Reports"],
  },
  admin: null,
  compliance: { MAIN: ["Home"], OPERATIONS: ["Compliance", "Finance"], KNOWLEDGE: ["Knowledge"] },
};

/**
 * The parent whose children live at the root of the URL space rather than under
 * a parent segment. `Approvals` is `/approvals`, not `/home/approvals`.
 */
export const ROOT_PARENT_LABEL = "Home";

/**
 * A parent badge renders in the alert colour when the parent's children include
 * one named `Failures`. Straight from `K.sidebar`:
 * `badge(sum, kids.some(k => k[0] === 'Failures'))`.
 */
export const ALERT_CHILD_LABEL = "Failures";
