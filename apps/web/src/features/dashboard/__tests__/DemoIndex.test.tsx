/**
 * M22-S04 · the demo script as a live index.
 *
 * The one thing that can rot here is a link: a step whose destination is typed
 * rather than derived drifts the moment the nav tree moves. So the assertions
 * are about the links, not about the prose.
 */

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ALL_NAV_ROUTES } from "@/shared/config/nav";
import { DemoIndex } from "../DemoIndex";

const renderIndex = () =>
  render(
    <MemoryRouter>
      <DemoIndex />
    </MemoryRouter>,
  );

describe("M22-S04 demo index", () => {
  it("lists all nineteen steps in the script's order", () => {
    renderIndex();

    const numbers = screen.getAllByText(/^\d{2}$/).map((node) => node.textContent);
    expect(numbers).toHaveLength(19);
    expect(numbers[0]).toBe("01");
    expect(numbers[18]).toBe("19");
  });

  it("labels every step with the design pack's screen id", () => {
    renderIndex();

    /* The index doubles as a coverage map, so the id has to be on the row —
       "which artboard is this" is the question a builder asks of it. */
    for (const id of ["M01-S01", "M02-S01", "M02-S02", "M12-S02", "M18-S04"]) {
      expect(screen.getAllByText(id).length).toBeGreaterThan(0);
    }
  });

  it("points every step at a path the app actually serves", () => {
    renderIndex();

    const known = new Set(ALL_NAV_ROUTES.map((route) => route.path));

    /* Scoped to the ordered step list: the breadcrumb above it is a link too,
       and counting it would make this assertion pass for the wrong reason. */
    const steps = screen.getByRole("list", { name: "Demo steps" });
    const links = within(steps).getAllByRole("link");
    expect(links).toHaveLength(19);

    for (const link of links) {
      const href = link.getAttribute("href") ?? "";

      /* Either a nav leaf, or a record beneath one (`/approvals/APV-…`), or
         the public portal token. Anything else is a typed literal that has
         already drifted. */
      const isLeaf = known.has(href);
      const isRecord = [...known].some((path) => href.startsWith(`${path}/`));
      const isPortal = href.startsWith("/p/");

      expect(isLeaf || isRecord || isPortal, `${href} is not a route the app serves`).toBe(true);
    }
  });

  it("deep-links step 09 to the Aurora approval the story turns on", () => {
    renderIndex();

    const step = screen.getByRole("link", { name: "Approval detail" });
    expect(step).toHaveAttribute("href", "/approvals/APV-2026-0771");
  });

  it("keeps the presenter's four objections and their answers", () => {
    renderIndex();

    expect(screen.getByText("What if the agent approves something wrong?")).toBeInTheDocument();
    expect(screen.getByText(/capped at Act-with-approval/)).toBeInTheDocument();
    expect(screen.getByText("Is this e-invoicing?")).toBeInTheDocument();
    expect(screen.getByText(/handles LHDN MyInvois validation/)).toBeInTheDocument();
  });
});
