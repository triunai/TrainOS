import { useCallback, useEffect, useState } from "react";

/**
 * What the reader has decided about the rail, kept across reloads.
 *
 * Two pieces of state and two rules that tie them to the rest of the shell:
 *
 *  - `openKeys` — which parents are expanded. The DEFAULT is all closed: with
 *    every group open the rail is taller than the viewport, and closed-by-
 *    default plus "open the one you are in" keeps it short without hiding
 *    where the reader is.
 *  - `collapsed` — the 64px icon rail. Restored here after a pass removed it
 *    entirely; it is the same key 63888e5 wrote, so a reader who collapsed the
 *    rail before that removal finds it collapsed again.
 *
 * Rule one: navigating into a parent opens it, and the reader can still close
 * it afterwards. That is why the auto-open runs from an effect keyed on the
 * ACTIVE parent rather than on every render — it fires once, when the active
 * parent changes, so a close that follows it sticks instead of being reopened
 * on the next paint.
 *
 * Rule two: `[` toggles the rail from anywhere. It is a bare key, so it has to
 * yield to anything that is legitimately taking characters — a field, a
 * `contenteditable`, a chorded shortcut, or an open dialog, whose own focus
 * trap owns the keyboard while it is up. Without those guards the rail would
 * snap shut every time someone typed a bracket into search.
 *
 * Storage is best-effort in both directions. A private window that throws on
 * `localStorage` gets a working sidebar with no memory, which is the correct
 * trade: the rail is navigation, not data.
 */

const OPEN_KEY = "trainos.sidebar.open";
const COLLAPSED_KEY = "trainos.sidebar.collapsed";

/** The bare key that toggles the rail. */
export const COLLAPSE_KEY = "[";

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

/**
 * Is the keyboard someone else's right now? A bare-key shortcut that fires
 * inside a text field is a bug, not a feature.
 */
function keyboardIsBusy(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return true;

  const target = event.target;
  if (target instanceof HTMLElement) {
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  }

  /* A modal traps focus and owns every key while it is open — the profile
     modal, a drawer, the command palette. */
  return document.querySelector('[role="dialog"]') !== null;
}

export interface SidebarState {
  isOpen: (key: string) => boolean;
  toggle: (key: string) => void;
  /** The 64px icon rail. */
  collapsed: boolean;
  toggleCollapsed: () => void;
}

export function useSidebarState(activeParentKey: string | null): SidebarState {
  const [openKeys, setOpenKeys] = useState<OpenMap>(() => read<OpenMap>(OPEN_KEY, {}));
  const [collapsed, setCollapsed] = useState<boolean>(() => read(COLLAPSED_KEY, false));

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

  const toggleCollapsed = useCallback(() => {
    setCollapsed((previous) => {
      write(COLLAPSED_KEY, !previous);
      return !previous;
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== COLLAPSE_KEY) return;
      if (keyboardIsBusy(event)) return;
      event.preventDefault();
      toggleCollapsed();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleCollapsed]);

  return { isOpen, toggle, collapsed, toggleCollapsed };
}
