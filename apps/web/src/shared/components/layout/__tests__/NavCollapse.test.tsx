/**
 * The expand/collapse region, and specifically what it must NOT leave behind.
 *
 * A collapsing panel is the classic place a React tree leaks: a `transitionend`
 * listener registered to flip `visibility` after the animation, a `setTimeout`
 * fallback for when that event never fires, and then an unmount mid-animation
 * that runs neither cleanup. Multiply by the number of groups in the rail and a
 * long session accumulates both.
 *
 * `NavCollapse` sidesteps the whole category by letting CSS do the sequencing
 * (see `.nav-collapse` in index.css). These tests pin that: no listener, no
 * timer, and a closed panel that is genuinely unreachable rather than merely
 * invisible.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NavCollapse } from "../NavCollapse";

/* Every `addEventListener` on any element, with the element it landed on.
   React 18 registers its whole delegated event set — `transitionend` included —
   on the render container, so a bare type count would blame this component for
   the test harness. The assertions below look only at the collapse region. */
type Registration = { type: string; element: Element };

let added: Registration[] = [];
let removed: Registration[] = [];
const originalAdd = Element.prototype.addEventListener;
const originalRemove = Element.prototype.removeEventListener;

beforeEach(() => {
  added = [];
  removed = [];
  Element.prototype.addEventListener = function patched(this: Element, ...args) {
    added.push({ type: String(args[0]), element: this });
    return originalAdd.apply(this, args);
  };
  Element.prototype.removeEventListener = function patched(this: Element, ...args) {
    removed.push({ type: String(args[0]), element: this });
    return originalRemove.apply(this, args);
  };
});

afterEach(() => {
  Element.prototype.addEventListener = originalAdd;
  Element.prototype.removeEventListener = originalRemove;
  vi.useRealTimers();
});

const withinRegion = (log: Registration[], region: Element, type: string) =>
  log.filter((entry) => entry.type === type && region.contains(entry.element));

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        Training
      </button>
      <NavCollapse open={open} id="panel">
        <ul>
          <li>
            <a href="/training/programmes">Programmes</a>
          </li>
        </ul>
      </NavCollapse>
    </>
  );
}

describe("NavCollapse", () => {
  it("opens and closes — the toggle is not one-way", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Training" });

    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("marks the region open or closed for CSS to size and hide", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    const region = container.querySelector(".nav-collapse") as HTMLElement;

    expect(region).toHaveAttribute("data-open", "false");
    await user.click(screen.getByRole("button", { name: "Training" }));
    expect(region).toHaveAttribute("data-open", "true");
  });

  it("makes a closed panel inert, and a reopened one reachable again", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const panel = document.getElementById("panel") as HTMLElement;
    const trigger = screen.getByRole("button", { name: "Training" });

    expect(panel).toHaveAttribute("inert");

    await user.click(trigger);
    expect(panel).not.toHaveAttribute("inert");

    await user.click(trigger);
    expect(panel).toHaveAttribute("inert");
  });

  it("carries no spacing of its own, so a closed group leaves no residual band", () => {
    const { container } = render(<Harness />);
    const region = container.querySelector(".nav-collapse") as HTMLElement;
    const panel = document.getElementById("panel") as HTMLElement;

    for (const element of [region, panel]) {
      const style = getComputedStyle(element);
      expect(style.padding).toBe("");
      expect(style.margin).toBe("");
      expect(style.borderWidth).toBe("");
    }
    expect(region.className).toBe("nav-collapse");
  });

  it("mount, open, close, unmount leaves no transitionend listener and no timer", () => {
    vi.useFakeTimers();

    /* `fireEvent`, not `userEvent`: userEvent schedules its own timers for the
       pointer sequence, and counting those would say nothing about this
       component. The clicks here are the component's whole lifecycle. */
    const { container, unmount } = render(<Harness />);
    const region = container.querySelector(".nav-collapse") as HTMLElement;
    const trigger = screen.getByRole("button", { name: "Training" });

    fireEvent.click(trigger);
    fireEvent.click(trigger);
    unmount();

    /* Not "added equals removed" — that would pass a leak that happens to clean
       up. Nothing in the region registers one in the first place, so there is
       nothing to forget on an unmount that lands mid-animation. */
    expect(withinRegion(added, region, "transitionend")).toEqual([]);
    expect(withinRegion(removed, region, "transitionend")).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
