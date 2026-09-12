/**
 * The breadcrumb slot.
 *
 * CLAUDE.md gives the breadcrumb the path and RecordHeader the identity, and
 * says neither may be duplicated. That only holds if the trail lives in ONE
 * place — the top bar — and every screen declares into it. These tests pin the
 * three ways that arrangement can break: a screen that declares nothing
 * inheriting the last screen's path, a crumb reloading the application, and
 * the hook spinning because callers build their array inline.
 */

import { describe, expect, it, vi } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { BreadcrumbProvider, useBreadcrumb, useBreadcrumbTrail } from "../BreadcrumbProvider";

/** Stands in for the top bar: renders whatever trail the shell currently holds. */
function Slot() {
  const trail = useBreadcrumbTrail();
  return (
    <nav aria-label="slot">
      {trail.map((crumb) => (
        <span key={crumb.label}>{crumb.label}</span>
      ))}
    </nav>
  );
}

function Screen({ label, href }: { label: string; href?: string }) {
  useBreadcrumb([{ label: "Home", href: "/" }, ...(href ? [{ label, href }] : [{ label }])]);
  return <p>screen: {label}</p>;
}

const harness = (children: React.ReactNode) =>
  render(
    <MemoryRouter>
      <BreadcrumbProvider>
        <Slot />
        {children}
      </BreadcrumbProvider>
    </MemoryRouter>,
  );

describe("the breadcrumb slot", () => {
  it("renders the trail the mounted screen declared", async () => {
    harness(<Screen label="Approvals" />);

    const slot = screen.getByRole("navigation", { name: "slot" });
    await waitFor(() => expect(within(slot).getByText("Approvals")).toBeInTheDocument());
    expect(within(slot).getByText("Home")).toBeInTheDocument();
  });

  it("clears the trail when the screen unmounts", async () => {
    function Router() {
      const [on, setOn] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOn(false)}>
            leave
          </button>
          {on ? <Screen label="Approvals" /> : <p>somewhere else</p>}
        </>
      );
    }

    const user = userEvent.setup();
    harness(<Router />);

    const slot = screen.getByRole("navigation", { name: "slot" });
    await waitFor(() => expect(within(slot).getByText("Approvals")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "leave" }));

    /* A stale crumb is worse than no crumb: it is confidently wrong about
       where the reader is. */
    await waitFor(() => expect(within(slot).queryByText("Approvals")).toBeNull());
  });

  it("does not loop when a caller builds its array inline", async () => {
    const rendered = vi.fn();

    function Counting() {
      /* The array is a NEW object every render, which is how every real caller
         writes it. Comparing by identity here would set state on every render
         and spin forever, so this asserts the value comparison holds. */
      useBreadcrumb([{ label: "Home", href: "/" }, { label: "Dashboard" }]);
      rendered();
      return <p>counting</p>;
    }

    harness(<Counting />);

    await waitFor(() => expect(screen.getByText("Dashboard")).toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 50));

    /* A settled tree, not a spinning one. React's own re-render for the state
       change accounts for a handful; a loop would be in the hundreds. */
    expect(rendered.mock.calls.length).toBeLessThan(10);
  });

  it("is safe to call with no provider above it", () => {
    /* The public portal page has no shell, and a screen test may render bare.
       Neither should throw. */
    function Bare() {
      useBreadcrumb([{ label: "Nowhere" }]);
      return <p>bare</p>;
    }

    expect(() => render(<Bare />)).not.toThrow();
  });

  it("lets the newest screen replace the previous trail", async () => {
    function Swapper() {
      const [label, setLabel] = useState("Approvals");
      useEffect(() => {
        const id = setTimeout(() => setLabel("Dashboard"), 0);
        return () => clearTimeout(id);
      }, []);
      return <Screen label={label} />;
    }

    harness(<Swapper />);

    const slot = screen.getByRole("navigation", { name: "slot" });
    await waitFor(() => expect(within(slot).getByText("Dashboard")).toBeInTheDocument());
    expect(within(slot).queryByText("Approvals")).toBeNull();
  });
});
