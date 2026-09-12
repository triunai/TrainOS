import { describe, expect, it } from "vitest";
import {
  ALL_NAV_GROUPS,
  ALL_NAV_ROUTES,
  DEFAULT_ROUTE_PATH,
  getNavGroups,
  navPath,
} from "../nav";

const captionsOf = (role: Parameters<typeof getNavGroups>[0]) =>
  getNavGroups(role).map((group) => group.caption);

const parentsIn = (role: Parameters<typeof getNavGroups>[0], caption: string) =>
  getNavGroups(role)
    .find((group) => group.caption === caption)
    ?.parents.map((parent) => parent.label) ?? [];

describe("navPath", () => {
  it("puts the root parent's children at the root", () => {
    expect(navPath("Home", "Approvals")).toBe("/approvals");
  });

  it("nests every other parent's children under the parent slug", () => {
    expect(navPath("Sales", "Enquiries")).toBe("/sales/enquiries");
    expect(navPath("Compliance", "HRD Corp")).toBe("/compliance/hrd-corp");
    expect(navPath("Settings", "AI Models")).toBe("/settings/ai-models");
  });

  it("treats a childless parent as its own leaf", () => {
    expect(navPath("Reports")).toBe("/reports");
  });
});

describe("getNavGroups — role filtering", () => {
  it("gives admin the whole tree", () => {
    expect(getNavGroups("ADMIN")).toEqual(ALL_NAV_GROUPS);
  });

  it("gives sales Home, Sales, Relationships, Training and Knowledge — and no Finance", () => {
    expect(captionsOf("SALES")).toEqual(["MAIN", "OPERATIONS", "KNOWLEDGE"]);
    expect(parentsIn("SALES", "MAIN")).toEqual(["Home", "Sales", "Relationships"]);
    expect(parentsIn("SALES", "OPERATIONS")).toEqual(["Training"]);
    expect(parentsIn("SALES", "OPERATIONS")).not.toContain("Finance");
  });

  it("gives finance Finance and Compliance but not Sales", () => {
    // Render order follows the TREE, not the order the ROLE map lists parents
    // in. The pack's ROLE map says ['Finance','Compliance']; the sidebar shows
    // Compliance first because that is where it sits in the tree.
    expect(parentsIn("FINANCE", "OPERATIONS")).toEqual(["Compliance", "Finance"]);
    expect(parentsIn("FINANCE", "MAIN")).toEqual(["Home"]);
    expect(captionsOf("FINANCE")).not.toContain("SYSTEM");
  });

  it("maps MD onto the exec rail, which is the only non-admin rail with SYSTEM", () => {
    expect(captionsOf("MD")).toContain("SYSTEM");
    expect(parentsIn("MD", "SYSTEM")).toEqual(["Automation", "Reports"]);
    expect(captionsOf("SALES")).not.toContain("SYSTEM");
  });

  it("maps SALES_MANAGER onto the same rail as SALES", () => {
    expect(getNavGroups("SALES_MANAGER")).toEqual(getNavGroups("SALES"));
  });

  it("gives the internal shell to no one who does not belong in it", () => {
    expect(getNavGroups("CLIENT")).toEqual([]);
    expect(getNavGroups("AGENT")).toEqual([]);
  });
});

describe("badges", () => {
  it("sums child badges onto the parent", () => {
    const automation = ALL_NAV_GROUPS.find((group) => group.caption === "SYSTEM")?.parents.find(
      (parent) => parent.label === "Automation",
    );
    expect(automation?.badge).toBe(2);
  });

  it("marks a parent as alerting only when it holds a Failures child", () => {
    const system = ALL_NAV_GROUPS.find((group) => group.caption === "SYSTEM");
    expect(system?.parents.find((parent) => parent.label === "Automation")?.badgeIsAlert).toBe(
      true,
    );

    const main = ALL_NAV_GROUPS.find((group) => group.caption === "MAIN");
    expect(main?.parents.find((parent) => parent.label === "Home")?.badgeIsAlert).toBe(false);
    expect(main?.parents.find((parent) => parent.label === "Home")?.badge).toBe(7);
  });
});

describe("the generated route table", () => {
  it("has a unique path per leaf", () => {
    const paths = ALL_NAV_ROUTES.map((route) => route.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("includes the childless parent as its own route", () => {
    expect(ALL_NAV_ROUTES.map((route) => route.path)).toContain("/reports");
  });

  it("lands the index route on a path the table actually serves", () => {
    expect(ALL_NAV_ROUTES.map((route) => route.path)).toContain(DEFAULT_ROUTE_PATH);
  });
});
