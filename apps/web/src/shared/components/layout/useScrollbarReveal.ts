import { useEffect } from "react";

/**
 * Shows a scrollbar only while its container is being scrolled.
 *
 * ONE listener for the whole application. `scroll` does not bubble, but a
 * CAPTURE-phase listener on the document still sees every one of them on the
 * way down, so a new scroll container anywhere — a drawer, a table's pane, a
 * code block a screen adds next month — is covered without being wired up.
 * Per-component wiring is what makes a rule like this decay.
 *
 * The class goes on the element that scrolled and comes off 800ms after its
 * last scroll event. The fade itself is CSS (`.is-scrolling` in `index.css`);
 * this only says when.
 *
 * Passive, because the listener never calls `preventDefault` and a non-passive
 * scroll listener blocks the compositor on every frame of every scroll.
 *
 * One timer per scrolling element, keyed by the element, so two panes
 * scrolling at once do not cancel each other's fade. Every timer is cleared and
 * every class removed on unmount — including for an element that was scrolling
 * at the moment the tree came down.
 */

export const SCROLLING_CLASS = "is-scrolling";

/** Long enough to cover a pause mid-gesture, short enough not to linger. */
export const HIDE_AFTER_MS = 800;

export function useScrollbarReveal(): void {
  useEffect(() => {
    const timers = new Map<Element, number>();

    const onScroll = (event: Event) => {
      const { target } = event;
      /* A scroll of the page itself is targeted at the document. */
      const element =
        target instanceof Document
          ? target.documentElement
          : target instanceof Element
            ? target
            : null;
      if (!element) return;

      element.classList.add(SCROLLING_CLASS);

      const pending = timers.get(element);
      if (pending !== undefined) window.clearTimeout(pending);

      timers.set(
        element,
        window.setTimeout(() => {
          element.classList.remove(SCROLLING_CLASS);
          timers.delete(element);
        }, HIDE_AFTER_MS),
      );
    };

    document.addEventListener("scroll", onScroll, { capture: true, passive: true });

    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      for (const [element, id] of timers) {
        window.clearTimeout(id);
        element.classList.remove(SCROLLING_CLASS);
      }
      timers.clear();
    };
  }, []);
}
