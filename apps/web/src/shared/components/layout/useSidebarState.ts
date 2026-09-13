import { useCallback, useEffect, useState } from "react";

/**
 * What the reader has decided about the rail, kept across reloads.
 *
 * Two pieces of state and one rule that ties them to the router:
 *
 *  - `openKeys` — which parents are expanded. The DEFAULT is all closed. With
 *    every group open the rail is taller than the viewport, which is what put
 *    a scrollbar down its edge; closed-by-default plus "open the one you are
 *    in" keeps it short without hiding where the reader is.
 *  - `collapsed` — the 64px icon rail.
 *
 * The rule: navigating into a parent opens it, and the reader can still close
 * it afterwards. That is why `openParent` runs from an effect keyed on the
 * ACTIVE parent rather than on every render — it fires once, when the active
 * parent changes, so a close that follows it sticks instead of being reopened
 * on the next paint.
 *
 * Storage is best-effort in both directions. A private window that throws on
 * `localStorage` gets a working sidebar with no memory, which is the correct
 * trade: the rail is navigation, not data.
 */

const OPEN_KEY = "trainos.sidebar.open";
const COLLAPSED_KEY = "trainos.sidebar.collapsed";

type OpenMap = Readonly<Record<string, boolean>>;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* A full or blocked store is not worth a broken rail. */
  }
}

export interface SidebarState {
  isOpen: (key: string) => boolean;
  toggle: (key: string) => void;
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
}

export function useSidebarState(activeParentKey: string | null): SidebarState {
  const [openKeys, setOpenKeys] = useState<OpenMap>(() => read<OpenMap>(OPEN_KEY, {}));
  const [collapsed, setCollapsedState] = useState<boolean>(() => read(COLLAPSED_KEY, false));

  /* Opens the parent the reader just navigated into. Keyed on the parent, not
     on `openKeys`, so it cannot fight a deliberate collapse. */
  useEffect(() => {
    if (!activeParentKey) return;
    setOpenKeys((previous) => {
      if (previous[activeParentKey]) return previous;
      const next = { ...previous, [activeParentKey]: true };
      write(OPEN_KEY, next);
      return next;
    });
  }, [activeParentKey]);

  const toggle = useCallback((key: string) => {
    setOpenKeys((previous) => {
      const next = { ...previous, [key]: !previous[key] };
      write(OPEN_KEY, next);
      return next;
    });
  }, []);

  const isOpen = useCallback((key: string) => openKeys[key] === true, [openKeys]);

  const setCollapsed = useCallback((value: boolean) => {
    setCollapsedState(value);
    write(COLLAPSED_KEY, value);
  }, []);

  return { isOpen, toggle, collapsed, setCollapsed };
}
