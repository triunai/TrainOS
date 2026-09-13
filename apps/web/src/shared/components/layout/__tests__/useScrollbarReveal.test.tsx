/**
 * One delegated listener, and what it must not leave behind.
 *
 * The rule it serves is site-wide, so the temptation is to wire each scroll
 * container by hand and let the next one be forgotten. These pin the delegation
 * instead: a container that nothing knows about still gets the class, and the
 * whole thing comes down cleanly — including when a pane is mid-scroll at the
 * moment the tree unmounts, which is where a per-element timer leaks.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { HIDE_AFTER_MS, SCROLLING_CLASS, useScrollbarReveal } from "../useScrollbarReveal";

function Harness() {
  useScrollbarReveal();
  return (
    <div>
      <div data-testid="pane-a" />
      <div data-testid="pane-b" />
    </div>
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const scroll = (element: Element) => {
  act(() => {
    element.dispatchEvent(new Event("scroll", { bubbles: false }));
  });
};

describe("useScrollbarReveal", () => {
  it("marks a container while it scrolls and unmarks it after the pause", () => {
    vi.useFakeTimers();
    const { getByTestId } = render(<Harness />);
    const pane = getByTestId("pane-a");

    expect(pane).not.toHaveClass(SCROLLING_CLASS);

    scroll(pane);
    expect(pane).toHaveClass(SCROLLING_CLASS);

    act(() => vi.advanceTimersByTime(HIDE_AFTER_MS - 1));
    expect(pane).toHaveClass(SCROLLING_CLASS);

    act(() => vi.advanceTimersByTime(1));
    expect(pane).not.toHaveClass(SCROLLING_CLASS);
  });

  it("restarts the pause on each scroll rather than fading mid-gesture", () => {
    vi.useFakeTimers();
    const { getByTestId } = render(<Harness />);
    const pane = getByTestId("pane-a");

    scroll(pane);
    act(() => vi.advanceTimersByTime(HIDE_AFTER_MS - 50));
    scroll(pane);
    act(() => vi.advanceTimersByTime(HIDE_AFTER_MS - 50));

    expect(pane).toHaveClass(SCROLLING_CLASS);
  });

  it("keeps two panes independent", () => {
    vi.useFakeTimers();
    const { getByTestId } = render(<Harness />);
    const a = getByTestId("pane-a");
    const b = getByTestId("pane-b");

    scroll(a);
    act(() => vi.advanceTimersByTime(400));
    scroll(b);
    act(() => vi.advanceTimersByTime(HIDE_AFTER_MS - 400));

    expect(a).not.toHaveClass(SCROLLING_CLASS);
    expect(b).toHaveClass(SCROLLING_CLASS);
  });

  it("covers a container it was never told about, because it delegates", () => {
    vi.useFakeTimers();
    render(<Harness />);

    /* Stands in for a drawer, a table pane, a code block — anything mounted
       later by a screen that knows nothing about this hook. */
    const late = document.createElement("div");
    document.body.appendChild(late);

    scroll(late);
    expect(late).toHaveClass(SCROLLING_CLASS);

    late.remove();
  });

  it("listens in the capture phase and passively, since scroll does not bubble", () => {
    const spy = vi.spyOn(document, "addEventListener");
    render(<Harness />);

    const call = spy.mock.calls.find(([type]) => type === "scroll");
    expect(call).toBeDefined();
    expect(call?.[2]).toEqual({ capture: true, passive: true });
  });

  it("removes its listener and every pending timer on unmount", () => {
    vi.useFakeTimers();
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const { getByTestId, unmount } = render(<Harness />);
    const pane = getByTestId("pane-a");

    /* Unmount MID-scroll: the timer is pending and the class is on. */
    scroll(pane);
    expect(pane).toHaveClass(SCROLLING_CLASS);

    unmount();

    expect(removeSpy.mock.calls.some(([type]) => type === "scroll")).toBe(true);
    expect(pane).not.toHaveClass(SCROLLING_CLASS);
    expect(vi.getTimerCount()).toBe(0);
  });
});
