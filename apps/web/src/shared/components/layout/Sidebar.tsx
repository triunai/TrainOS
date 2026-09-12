import { useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import type { Role } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";
import { getNavGroups, type NavParent } from "@/shared/config/nav";
import { NavBadge } from "./NavBadge";

/**
 * The sidebar. 240px, one surface step off the canvas.
 *
 * It renders whatever `getNavGroups(role)` returns and knows nothing about
 * roles itself — there is exactly one filtering pass and it is not here.
 */
export function Sidebar({ role }: { role: Role }) {
  const groups = useMemo(() => getNavGroups(role), [role]);
  const { pathname } = useLocation();

  /** A parent is open when it holds the current route, or the reader opened it. */
  const activeParentKey = useMemo(() => {
    for (const group of groups) {
      for (const parent of group.parents) {
        if (parent.path === pathname) return parent.key;
        if (parent.children.some((child) => child.path === pathname)) return parent.key;
      }
    }
    return null;
  }, [groups, pathname]);

  const [openKeys, setOpenKeys] = useState<ReadonlySet<string>>(new Set());

  const isOpen = (parent: NavParent) =>
    parent.key === activeParentKey || openKeys.has(parent.key);

  const toggle = (key: string) =>
    setOpenKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <nav
      aria-label="Main"
      className="flex h-full w-sidebar shrink-0 flex-col gap-5 overflow-y-auto bg-sidebar px-3 py-4"
    >
      <div className="px-2 font-mono text-[13px] font-medium tracking-[0.08em] text-ink">
        TRAINOS
      </div>

      {groups.map((group) => (
        <div key={group.caption} className="flex flex-col gap-0.5">
          <div className="px-2 pb-1 font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">
            {group.caption}
          </div>

          {group.parents.map((parent) => {
            const leaf = parent.children.length === 0;
            const open = !leaf && isOpen(parent);

            return (
              <div key={parent.key}>
                {leaf ? (
                  <NavLink
                    to={parent.path as string}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-2 rounded-control px-2 py-1.5 text-[13px]",
                        isActive
                          ? "bg-ai-tint-2 font-medium text-primary-hover"
                          : "text-ink-secondary hover:bg-surface-hover",
                      )
                    }
                  >
                    <span aria-hidden="true" className="w-4 text-center">
                      {parent.icon}
                    </span>
                    <span>{parent.label}</span>
                    {parent.badge ? (
                      <NavBadge count={parent.badge} alert={parent.badgeIsAlert} />
                    ) : null}
                  </NavLink>
                ) : (
                  <button
                    type="button"
                    onClick={() => toggle(parent.key)}
                    aria-expanded={open}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-[13px]",
                      open
                        ? "bg-ai-tint-2 font-medium text-primary-hover"
                        : "text-ink-secondary hover:bg-surface-hover",
                    )}
                  >
                    <span aria-hidden="true" className="w-4 text-center">
                      {parent.icon}
                    </span>
                    <span>{parent.label}</span>
                    {parent.badge ? (
                      <NavBadge count={parent.badge} alert={parent.badgeIsAlert} />
                    ) : null}
                    <span aria-hidden="true" className="ml-1 text-ink-muted">
                      {open ? "–" : "+"}
                    </span>
                  </button>
                )}

                {open ? (
                  <ul className="relative ml-[18px] mt-0.5 flex flex-col gap-0.5 border-l border-connector pl-3">
                    {parent.children.map((child) => (
                      <li key={child.key}>
                        <NavLink
                          to={child.path}
                          className={({ isActive }) =>
                            cn(
                              "flex items-center gap-2 rounded-control px-2 py-1.5 text-[13px]",
                              isActive
                                ? "bg-card font-medium text-ink shadow-raised"
                                : "text-ink-secondary hover:bg-surface-hover",
                            )
                          }
                        >
                          {({ isActive }) => (
                            <>
                              <span
                                aria-hidden="true"
                                className={cn(
                                  "h-1.5 w-1.5 shrink-0 rounded-pill",
                                  isActive ? "bg-primary" : "bg-ink-disabled",
                                )}
                              />
                              <span>{child.label}</span>
                              {child.badge ? <NavBadge count={child.badge} /> : null}
                            </>
                          )}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
