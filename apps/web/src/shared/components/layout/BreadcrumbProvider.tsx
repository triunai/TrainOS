import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Crumb } from "@/shared/components/kit";

/**
 * The breadcrumb slot, and the hook a screen uses to fill it.
 *
 * CLAUDE.md: "Record identity appears once per page: RecordHeader owns it, the
 * breadcrumb owns the path. Never duplicate either." The artboards draw the
 * breadcrumb in the 56px top bar, which means it cannot live inside a screen —
 * a screen rendering its own trail inside the content card puts the path in the
 * wrong place AND gives every screen its own copy of the same pattern, which is
 * the divergence the consolidation rule exists to prevent.
 *
 * So the trail is state, lifted to the shell. A screen DECLARES its path and
 * the top bar RENDERS it:
 *
 *   useBreadcrumb([{ label: "Home", href: "/" }, { label: "Approvals" }]);
 *
 * The last crumb is the current page and carries no `href` — `Breadcrumb`
 * renders it as plain text rather than a link to where the reader already is.
 */

export interface BreadcrumbContextValue {
  items: Crumb[];
  setItems: (items: Crumb[]) => void;
}

export const BreadcrumbContext = createContext<BreadcrumbContextValue | null>(null);

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Crumb[]>([]);
  const value = useMemo(() => ({ items, setItems }), [items]);

  return <BreadcrumbContext.Provider value={value}>{children}</BreadcrumbContext.Provider>;
}

/** What the top bar renders. Empty until a screen declares a trail. */
export function useBreadcrumbTrail(): Crumb[] {
  return useContext(BreadcrumbContext)?.items ?? [];
}

/**
 * Declare this screen's path. Call it once, near the top of a page component.
 *
 * The trail is cleared on unmount, so a route that declares nothing shows
 * nothing rather than inheriting the previous screen's path — a stale crumb is
 * worse than no crumb, because it is confidently wrong.
 *
 * `items` is compared by VALUE, not by identity. Every caller builds the array
 * inline, so an identity comparison would re-set state on every render and
 * spin. Callers therefore do not need `useMemo`, which is the whole point: a
 * hook that only behaves if every caller remembers to memoise is a hook that
 * will eventually be called wrong.
 *
 * Safe to call outside the provider — in a test that renders a screen bare, or
 * on the public portal page, which has no shell — where it simply does nothing.
 */
export function useBreadcrumb(items: Crumb[]): void {
  const setItems = useContext(BreadcrumbContext)?.setItems;
  const serialised = JSON.stringify(items);

  useEffect(() => {
    if (!setItems) return;
    setItems(JSON.parse(serialised) as Crumb[]);
    return () => setItems([]);
  }, [serialised, setItems]);
}
