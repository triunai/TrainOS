import { useMemo } from "react";
import { NavLink } from "react-router-dom";
import type { Role } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";
import { Collapse } from "@/shared/components/kit";
import { FOCUS_RING } from "@/shared/components/kit/tokens";
import { getNavGroups } from "@/shared/config/nav";
import { NavBadge } from "./NavBadge";
import { SidebarFooter } from "./SidebarFooter";
import { useNavSelection } from "./useNavSelection";
import { useSidebarState } from "./useSidebarState";

/**
 * The sidebar. 240px expanded, a 64px icon rail collapsed, on the same surface
 * as the top bar — there is no border and no colour step between them, because
 * in the pack the rail, the bar and the band around the content card are one
 * ground and the card is the only other plane.
 *
 * It renders whatever `getNavGroups(role)` returns and knows nothing about
 * roles itself — there is exactly one filtering pass and it is not here.
 *
 * TWO hierarchy mechanisms, deliberately, and no more: INDENT says a row is a
 * child, and ONE selected treatment says where you are. The pack draws four
 * (a tinted parent row, a connector line, a bullet per child, and a raised
 * card on the selected child); stacked on a 240px rail they compete, and the
 * connector plus the dots read as decoration rather than as structure. The
 * selected treatment is the pack's own — the row lifts onto the card surface —
 * so nothing here spends accent budget on navigation. A parent no longer
 * carries a background when one of its CHILDREN is selected: two lit rows for
 * one location is exactly the ambiguity the single-key selection removes.
 *
 * Scrolling belongs to the list between the brand and the footer, not to the
 * rail: the footer has to stay pinned, and the rail's right edge is where the
 * content card begins, so a scrollbar track there would draw the seam the
 * shared surface exists to remove.
 */

const ROW_BASE =
  "flex w-full items-center gap-2 rounded-control px-2 text-left text-[13px] transition-colors";
const ROW_IDLE = "text-ink-secondary hover:bg-surface-hover";
/** The one selected indicator: the row lifts onto the card surface. */
const ROW_SELECTED = "bg-card font-medium text-ink shadow-card";

export function Sidebar({ role }: { role: Role }) {
  const groups = useMemo(() => getNavGroups(role), [role]);
  const selection = useNavSelection(groups);
  const { isOpen, toggle, collapsed, setCollapsed } = useSidebarState(selection.parentKey);

  return (
    <nav
      aria-label="Main"
      className={cn(
        "flex h-full shrink-0 flex-col bg-sidebar py-4",
        collapsed ? "w-rail px-2" : "w-sidebar px-3",
      )}
    >
      <div
        className={cn(
          "pb-4 font-mono text-[13px] font-medium tracking-[0.08em] text-ink",
          collapsed ? "text-center" : "px-2",
        )}
      >
        {collapsed ? "T" : "TRAINOS"}
      </div>

      {/* The scroll container. `-mx-1 px-1` keeps a focus ring from being
          clipped by the very overflow that makes this element scroll. */}
      <div className="scrollbar-none -mx-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1">
        {groups.map((group) => (
          <div key={group.caption} className="flex flex-col gap-0.5">
            {collapsed ? null : (
              <div className="px-2 pb-1 font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">
                {group.caption}
              </div>
            )}

            {group.parents.map((parent) => {
              const leaf = parent.children.length === 0;
              const open = !leaf && isOpen(parent.key);
              const parentSelected = selection.parentKey === parent.key;
              /* A leaf parent IS the destination, so it can be selected. A
                 parent with children is only ever a disclosure — EXCEPT in the
                 collapsed rail, where its children are not drawn at all and the
                 parent is the only row that can carry the selection. Still one
                 selected row either way; in the rail it is the visible
                 ancestor of the one that would be selected. */
              const selected = collapsed
                ? parentSelected
                : leaf && parentSelected && selection.childKey === null;
              const panelId = `nav-${parent.key.replace(/\W+/g, "-")}`;

              return (
                <div key={parent.key} className="flex flex-col">
                  {leaf ? (
                    <NavLink
                      to={parent.path as string}
                      title={collapsed ? parent.label : undefined}
                      className={cn(
                        ROW_BASE,
                        "h-8",
                        collapsed && "justify-center px-0",
                        selected ? ROW_SELECTED : ROW_IDLE,
                        FOCUS_RING,
                      )}
                    >
                      <span aria-hidden="true" className="w-4 shrink-0 text-center">
                        {parent.icon}
                      </span>
                      {collapsed ? (
                        <span className="sr-only">{parent.label}</span>
                      ) : (
                        <>
                          <span className="truncate">{parent.label}</span>
                          {parent.badge ? (
                            <NavBadge count={parent.badge} alert={parent.badgeIsAlert} />
                          ) : null}
                        </>
                      )}
                    </NavLink>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        /* From the rail, opening a group has to widen the rail
                           first — there is nowhere for the children to go. */
                        if (collapsed) setCollapsed(false);
                        if (!collapsed || !open) toggle(parent.key);
                      }}
                      aria-expanded={open}
                      aria-controls={panelId}
                      title={collapsed ? parent.label : undefined}
                      className={cn(
                        ROW_BASE,
                        "h-8",
                        collapsed && "justify-center px-0",
                        selected ? ROW_SELECTED : ROW_IDLE,
                        FOCUS_RING,
                      )}
                    >
                      <span aria-hidden="true" className="w-4 shrink-0 text-center">
                        {parent.icon}
                      </span>
                      {collapsed ? (
                        <span className="sr-only">{parent.label}</span>
                      ) : (
                        <>
                          <span className="truncate">{parent.label}</span>
                          {parent.badge ? (
                            <NavBadge count={parent.badge} alert={parent.badgeIsAlert} />
                          ) : null}
                          <span
                            aria-hidden="true"
                            className={cn(
                              "shrink-0 text-ink-muted",
                              parent.badge ? "ml-1" : "ml-auto",
                            )}
                          >
                            {open ? "–" : "+"}
                          </span>
                        </>
                      )}
                    </button>
                  )}

                  {leaf || collapsed ? null : (
                    <Collapse open={open} id={panelId}>
                      {/* Every scrap of spacing sits on the list, inside the
                          clipped row, so a closed group is exactly 0px. */}
                      <ul className="flex flex-col gap-0.5 pt-0.5">
                        {parent.children.map((child) => {
                          const childSelected = selection.childKey === `${parent.key}/${child.key}`;

                          return (
                            <li key={child.key}>
                              <NavLink
                                to={child.path}
                                tabIndex={open ? undefined : -1}
                                className={cn(
                                  ROW_BASE,
                                  "h-7 pl-8",
                                  childSelected ? ROW_SELECTED : ROW_IDLE,
                                  FOCUS_RING,
                                )}
                              >
                                <span className="truncate">{child.label}</span>
                                {child.badge ? <NavBadge count={child.badge} /> : null}
                              </NavLink>
                            </li>
                          );
                        })}
                      </ul>
                    </Collapse>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <SidebarFooter collapsed={collapsed} onToggleCollapsed={() => setCollapsed(!collapsed)} />
    </nav>
  );
}
