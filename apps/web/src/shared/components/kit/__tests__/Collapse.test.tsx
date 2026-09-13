/**
 * The disclosure primitive.
 *
 * The assertions that matter here are the ones about what a CLOSED region is,
 * because every way of getting this pattern wrong looks fine while open:
 * content that is still tabbable, a region that survives as a residual band, a
 * `transitionend` listener or a `setTimeout` that outlives the component.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Collapse, DisclosureButton } from "@/shared/components/kit/Collapse";

/**
 * React DOM registers a window `error` handler of its own for as long as a
 * tree is mounted. It belongs to the test environment, not to the component
 * under test, so it is filtered out here — anything else this spy catches is a
 * listener the component added and did not take back.
 */
function ownListeners(spy: { mock: { calls: unknown[][] } }): unknown[][] {
  return spy.mock.calls.filter((call) => call[0] !== "error");
}

describe("Collapse", () => {
  it("clips the region and marks it inert when closed", () => {
    const { container, rerender } = render(
      <Collapse open={false} id="region">
        <p>hidden detail</p>
      </Collapse>,
    );

    const region = container.querySelector("[data-open]") as HTMLElement;
    const inner = document.getElementById("region") as HTMLElement;

    expect(region.dataset.open).toBe("false");
    expect(region.className).toContain("grid-rows-[0fr]");
    expect(region.className).toContain("invisible");
    /* The close delay is what takes the region out of the tab order when the
       animation ends — with no listener and no timer to do the sequencing.
       Inline, because Tailwind rejects a two-value `delay-[…]` as not a single
       `<time>` and silently falls back to its 150ms default. */
    expect(region.style.transitionDuration).toBe("200ms, 0s");
    expect(region.style.transitionDelay).toBe("0s, 200ms");
    expect(inner.hasAttribute("inert")).toBe(true);

    rerender(
      <Collapse open id="region">
        <p>hidden detail</p>
      </Collapse>,
    );

    expect(region.dataset.open).toBe("true");
    expect(region.className).toContain("grid-rows-[1fr]");
    expect(region.className).toContain("visible");
    expect(region.style.transitionDelay).toBe("0s, 0s");
    expect(inner.hasAttribute("inert")).toBe(false);
  });

  it("keeps every scrap of spacing inside the clipped row", () => {
    /* A padding or a margin on the wrapper survives the collapse as a band of
       empty space under the header. The wrapper carries layout classes only. */
    const { container } = render(
      <Collapse open={false}>
        <p>detail</p>
      </Collapse>,
    );

    const region = container.querySelector("[data-open]") as HTMLElement;
    expect(region.className).not.toMatch(/(^|\s)-?[pm][xytblr]?-/);
  });

  it("leaves no listener or timer behind on unmount", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const timeoutSpy = vi.spyOn(window, "setTimeout");
    const intervalSpy = vi.spyOn(window, "setInterval");

    const { unmount, rerender } = render(
      <Collapse open id="region">
        <p>detail</p>
      </Collapse>,
    );
    rerender(
      <Collapse open={false} id="region">
        <p>detail</p>
      </Collapse>,
    );
    unmount();

    expect(ownListeners(addSpy)).toEqual([]);
    expect(timeoutSpy).not.toHaveBeenCalled();
    expect(intervalSpy).not.toHaveBeenCalled();
    expect(document.getElementById("region")).toBeNull();

    addSpy.mockRestore();
    timeoutSpy.mockRestore();
    intervalSpy.mockRestore();
  });

  it("registers no transitionend listener ON THE REGION ITSELF", () => {
    /* The spy above watches `window`, which is where a listener would land if
       someone reached for one carelessly. A listener on the region element is
       the likelier mistake and `window` never sees it, so this one patches
       `Element.prototype` instead.

       Scoped to the region on purpose: React 18 registers its whole delegated
       event set — `transitionend` included — on the render container, so an
       unscoped count blames this component for the test harness. */
    type Registration = { type: string; element: Element };
    const added: Registration[] = [];
    const removed: Registration[] = [];
    const originalAdd = Element.prototype.addEventListener;
    const originalRemove = Element.prototype.removeEventListener;

    Element.prototype.addEventListener = function patched(this: Element, ...args) {
      added.push({ type: String(args[0]), element: this });
      return originalAdd.apply(this, args);
    };
    Element.prototype.removeEventListener = function patched(this: Element, ...args) {
      removed.push({ type: String(args[0]), element: this });
      return originalRemove.apply(this, args);
    };

    try {
      const { container, rerender, unmount } = render(
        <Collapse open id="region">
          <p>detail</p>
        </Collapse>,
      );
      const region = container.querySelector("[data-open]") as HTMLElement;

      rerender(
        <Collapse open={false} id="region">
          <p>detail</p>
        </Collapse>,
      );
      unmount();

      const inRegion = (log: Registration[]) =>
        log.filter((entry) => entry.type === "transitionend" && region.contains(entry.element));

      /* Not "added equals removed" — that would pass a leak that happens to
         clean up. None is registered, so an unmount mid-animation has nothing
         to forget. */
      expect(inRegion(added)).toEqual([]);
      expect(inRegion(removed)).toEqual([]);
    } finally {
      Element.prototype.addEventListener = originalAdd;
      Element.prototype.removeEventListener = originalRemove;
    }
  });
});

describe("DisclosureButton", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("carries aria-expanded, aria-controls and a name that is not a glyph", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <DisclosureButton open={false} onToggle={onToggle} controls="region" label="the full case" />,
    );

    const button = screen.getByRole("button", { name: "Show the full case" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAttribute("aria-controls", "region");

    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(<DisclosureButton open onToggle={onToggle} controls="region" label="the full case" />);
    expect(screen.getByRole("button", { name: "Hide the full case" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});
