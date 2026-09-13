import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import type { NavGroup } from "@/shared/config/nav";

/**
 * Which ONE nav entry the current URL selects.
 *
 * Two rules, and they are the whole thing:
 *
 *  1. A nav path matches the location when the location IS that path or sits
 *     underneath it. `/training/engagements/ENG-0231` is a record inside
 *     Engagements, and a rail that goes blank the moment a reader opens a
 *     record has stopped telling them where they are.
 *  2. The LONGEST match wins. `Home` owns `/` and Training owns `/training`,
 *     so without that rule every route would light up Home as well.
 *
 * The result is a single key, never a set, because "no other item shows
 * selected" is a property of the data and not something each call site should
 * be trusted to re-derive. `NavLink`'s own `isActive` cannot do this: it scores
 * each link in isolation, so a parent and its child both match and both paint.
 */

export interface NavSelection {
  /** `${parent.key}/${child.key}` of the selected child, when a child matched. */
  childKey: string | null;
  /** The selected child's parent, or a leaf parent that matched on its own. */
  parentKey: string | null;
}

const covers = (navPath: string, pathname: string): boolean =>
  navPath === "/" ? pathname === "/" : pathname === navPath || pathname.startsWith(`${navPath}/`);

export function selectNav(groups: readonly NavGroup[], pathname: string): NavSelection {
  let best: (NavSelection & { length: number }) | null = null;

  const consider = (path: string, selection: NavSelection) => {
    if (!covers(path, pathname)) return;
    if (best && best.length >= path.length) return;
    best = { ...selection, length: path.length };
  };

  for (const group of groups) {
    for (const parent of group.parents) {
      if (parent.path) consider(parent.path, { childKey: null, parentKey: parent.key });

      for (const child of parent.children) {
        consider(child.path, {
          childKey: `${parent.key}/${child.key}`,
          parentKey: parent.key,
        });
      }
    }
  }

  return best
    ? { childKey: best.childKey, parentKey: best.parentKey }
    : { childKey: null, parentKey: null };
}

export function useNavSelection(groups: readonly NavGroup[]): NavSelection {
  const { pathname } = useLocation();
  return useMemo(() => selectNav(groups, pathname), [groups, pathname]);
}
