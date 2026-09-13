/**
 * Which ONE nav row the URL lights up.
 *
 * The bug these pin: `NavLink`'s `isActive` scores each link on its own, so on
 * `/training/programmes` both `Training` and `Programmes` matched and both
 * painted, and on a record route like `/training/engagements/ENG-0231` the
 * child stopped matching entirely and the rail went blank about where you were.
 */

import { describe, expect, it } from "vitest";
import type { NavGroup } from "@/shared/config/nav";
import { selectNav } from "../useNavSelection";

const GROUPS: NavGroup[] = [
  {
    caption: "MAIN",
    parents: [
      {
        key: "Home",
        label: "Home",
        icon: "⌂",
        badgeIsAlert: false,
        children: [
          { key: "Dashboard", label: "Dashboard", path: "/dashboard" },
          { key: "Approvals", label: "Approvals", path: "/approvals" },
        ],
      },
      {
        key: "Reports",
        label: "Reports",
        icon: "▤",
        path: "/reports",
        badgeIsAlert: false,
        children: [],
      },
    ],
  },
  {
    caption: "OPERATIONS",
    parents: [
      {
        key: "Training",
        label: "Training",
        icon: "▧",
        badgeIsAlert: false,
        children: [
          { key: "Programmes", label: "Programmes", path: "/training/programmes" },
          { key: "Engagements", label: "Engagements", path: "/training/engagements" },
        ],
      },
    ],
  },
];

describe("selectNav", () => {
  it("selects the child whose path the location matches exactly", () => {
    expect(selectNav(GROUPS, "/training/programmes")).toEqual({
      childKey: "Training/Programmes",
      parentKey: "Training",
    });
  });

  it("keeps the child selected on a record underneath it", () => {
    expect(selectNav(GROUPS, "/training/engagements/ENG-0231")).toEqual({
      childKey: "Training/Engagements",
      parentKey: "Training",
    });
  });

  it("selects a leaf parent, and reports no child for it", () => {
    expect(selectNav(GROUPS, "/reports")).toEqual({ childKey: null, parentKey: "Reports" });
  });

  it("gives the longest match the selection, never the shorter prefix", () => {
    /* `/training/engagements` starts with nothing else here, but the guard that
       matters is a child under a parent that is itself a path. Length decides. */
    const nested: NavGroup[] = [
      {
        caption: "MAIN",
        parents: [
          {
            key: "Sales",
            label: "Sales",
            icon: "⚑",
            path: "/sales",
            badgeIsAlert: false,
            children: [{ key: "Enquiries", label: "Enquiries", path: "/sales/enquiries" }],
          },
        ],
      },
    ];

    expect(selectNav(nested, "/sales/enquiries")).toEqual({
      childKey: "Sales/Enquiries",
      parentKey: "Sales",
    });
    expect(selectNav(nested, "/sales")).toEqual({ childKey: null, parentKey: "Sales" });
  });

  it("selects nothing for a route the rail does not carry", () => {
    expect(selectNav(GROUPS, "/finance/collections")).toEqual({ childKey: null, parentKey: null });
  });

  it("does not let a sibling prefix match — /dashboards is not /dashboard", () => {
    expect(selectNav(GROUPS, "/dashboards")).toEqual({ childKey: null, parentKey: null });
  });
});
