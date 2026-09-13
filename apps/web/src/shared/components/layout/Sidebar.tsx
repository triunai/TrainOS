import { useMemo } from "react";
import { NavLink } from "react-router-dom";
import type { Role } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";
import { Collapse } from "@/shared/components/kit";
import { FOCUS_RING } from "@/shared/components/kit/tokens";
import { getNavGroups } from "@/shared/config/nav";
import { useT, type MessageKey } from "@/shared/i18n";
import { NavBadge } from "./NavBadge";
import { SidebarFooter } from "./SidebarFooter";
import { SidebarProfile } from "./SidebarProfile";
import { useNavSelection } from "./useNavSelection";
import { useSidebarState } from "./useSidebarState";

/**
 * The sidebar. 240px expanded, a 64px icon rail collapsed, on the same surface
 * as the top bar — there is no border and no colour step between them, because
 * in the pack the rail, the bar and the band around the content card are one
 * ground and the card is the only other plane.
 *
 * Top to bottom: a WHO YOU ARE band exactly as tall as the top bar, then the
 * navigation, then the application's own affordances in the footer. Identity
 * moved up here from the footer because it is the first thing a reader checks
 * and was in the last place they would look. There is no wordmark (24a765f).
 *
 * ── THE RAIL CLOSES AGAIN ────────────────────────────────────────────────
 *
 * 63888e5 built a rail that collapsed from a chevron at the FOOTER's edge;
 * 0abe2ad removed the whole thing. It is back, and the control is at the top
 * right of the profile band instead — the corner a reader reaches for, and the
 * corner they are already looking at when they close it. The footer chevron
 * does not come back with it: a control at the bottom of a 900px column, for a
 * thing that happens at the top of it, is why the first one went unused.
 *
 * Collapsed, the rail is `--shell-rail-width`: icons only, the label in a
 * tooltip, a count reduced to a dot on the glyph, the branch you are in still
 * tinted, the avatar alone, and the footer down to its glyphs. Nothing moves
 * except the width, which is what keeps the content beside it to a single
 * reflow — `main` is the flex sibling, so it takes back the 176px as the rail
 * gives it up and never reflows twice for one toggle.
 *
 * A parent with children cannot open inside 64px, so clicking one from the
 * rail widens the rail first and then opens the group — one click, the thing
 * the reader asked for, rather than a group that expands where it cannot be
 * seen.
 *
 * It renders whatever `getNavGroups(role)` returns and knows nothing about
 * roles itself — there is exactly one filtering pass and it is not here.
 *
 * ── THE SELECTED PATH LIGHTS UP ──────────────────────────────────────────
 *
 * An earlier pass here reduced the pack to "indent plus one selected row" on
 * the argument that four devices compete at 240px. Wrong, and the user said
 * so: stripped of the tint, the line and the dots the rail reads as an
 * undifferentiated black column and nothing says which BRANCH you are in.
 * The four devices are not four hierarchy mechanisms, they are one — a lit
 * path from the parent down to the row you are on. The parent tints, the
 * connector runs, the dots mark the rungs, and the row you are on rides a
 * raised card. Remove any one and the path breaks.
 *
 * Every number below is measured off the pack's own GEOMETRY PROOF (sidebar
 * width 240) and is asserted in `__tests__/Sidebar.test.tsx`, because a
 * geometry that is only in CSS drifts on the next person to touch the file:
 *
 *   x12 → x228   parent row, 36px, radius 8, `--ai-tint-2` when it holds the
 *                active child; the label and the glyph take `--primary-hover`
 *                with it, which is the kit's pairing for text on that tint
 *   x20 → x38    icon box, 18px glyph, centre x29
 *   x29          the tree line, 1px `--connector`, from the parent row's
 *                bottom to the CENTRE of the last child's dot, continuous
 *   x42 → x228   the active child's card, radius 8, `--shadow-card`; it starts
 *                13px right of the line, so the line stays visible beside it
 *   x52          child dot centre, 6px solid — primary when active
 *   x66          child label, 18px right of the parent label at x48
 *   x212         badge right edge, inside the card
 *
 * The rail's own `px-3` IS x12 → x228, so the parent row is the full content
 * box and every child offset is measured from it. `--ai-tint-2` rather than
 * the 6% `--ai-tint`: the pack's tinted row samples #EBF1FE, which is that
 * token to the digit, and the token's own note already calls it "selected
 * row, active nav, active pill". Both themes come out of tokens, so the dark
 * rail is the same geometry on `--card` / `--connector`'s dark values.
 *
 * Scrolling belongs to the list between the profile and the footer, not to the
 * rail, so the footer stays pinned. The bar itself is invisible until the
 * reader scrolls — that is `useScrollbarReveal` and the base rules in
 * `index.css`, applied site-wide rather than opted into here.
 */

/* The tree's captions are source data from the pack (`navTree.ts`), so they are
   mapped to keys here rather than translated in place — the source stays
   verbatim and the catalogue stays the only place a string lives twice. */
const CAPTION_KEY: Readonly<Record<string, MessageKey>> = {
  MAIN: "nav.group.main",
  OPERATIONS: "nav.group.operations",
  KNOWLEDGE: "nav.group.knowledge",
  SYSTEM: "nav.group.admin",
};

/** x12 → x228, 36px, radius 8. `px-2` puts the icon box at x20 and `gap-2.5`
    puts the label at x48. */
const PARENT_ROW =
  "flex h-9 w-full items-center gap-2.5 rounded-control px-2 text-left text-[13px] transition-colors";
/** The parent that holds the active child — or a leaf parent that IS it.
 *
 * `text-primary-hover`, not `text-primary`. Every other component that puts
 * text on this tint — PillTabGroup, FilterBar, CommandPalette,
 * LifecycleStepper, RelationPicker — already pairs it with `--primary-hover`,
 * and this row was the one call site reading `--primary` there instead. On the
 * dark map that outlier measured 4.05:1 and was the dark-theme contrast
 * failure the route sweep blamed on the rail's idle label; the kit's own
 * pairing measures 7.48:1 dark and 6.26:1 light. The pair is asserted in
 * `styles/__tests__/tokens.contrast.test.ts`. */
const PARENT_LIT = "bg-ai-tint-2 font-medium text-primary-hover";
const PARENT_IDLE = "text-ink-secondary hover:bg-surface-hover";

/** x42 → x228 — the `li` carries the 30px offset so the row itself can stay
    `w-full`. 34px tall. `pl-[7px]` puts the 6px dot's centre on x52,
    `gap-[11px]` puts the label on x66, `pr-4` puts the badge's right edge on
    x212. */
const CHILD_ROW =
  "flex h-[34px] w-full items-center gap-[11px] rounded-control pl-[7px] pr-4 text-left text-[13px] transition-colors";
/** The one raised row: the card surface, lifted, beside the line rather than
    over it. */
const CHILD_SELECTED = "bg-card font-medium text-ink shadow-card";
const CHILD_IDLE = "text-ink-secondary hover:bg-surface-hover";

/**
 * The tree line: x29, from the parent row's bottom to the centre of the last
 * dot. `bottom-[17px]` is that centre for ANY number of children — a 34px row
 * with its dot centred leaves exactly half a row below the last one — so the
 * line never needs the child count and cannot fall out of step with it.
 */
const TREE_LINE = "pointer-events-none absolute left-[17px] top-0 bottom-[17px] w-px bg-connector";

/** The rail collapsed: icon centred in the 48px the 64px rail's `px-2` leaves. */
const PARENT_RAIL = "justify-center px-0";

/** `aria-controls` for the collapse toggle: the rail is what it opens and shuts. */
const NAV_ID = "sidebar-rail";

export function Sidebar({ role }: { role: Role }) {
  const groups = useMemo(() => getNavGroups(role), [role]);
  const selection = useNavSelection(groups);
  const { isOpen, toggle, collapsed, toggleCollapsed } = useSidebarState(selection.parentKey);
  const t = useT();

  return (
    <nav
      id={NAV_ID}
      aria-label="Main"
      className={cn(
        "flex h-full shrink-0 flex-col bg-sidebar pb-4",
        /* The width is the only thing that animates, and `main` is its flex
           sibling, so the content takes back the difference in the same pass. */
        "transition-[width] duration-200 ease-out motion-reduce:transition-none",
        collapsed ? "w-rail px-2" : "w-sidebar px-3",
      )}
    >
      <SidebarProfile collapsed={collapsed} onToggleCollapsed={toggleCollapsed} navId={NAV_ID} />

      {/* THE SCROLL CONTAINER, AND WHY IT IS TWO ELEMENTS.
          `index.css` reserves the scrollbar's gutter permanently so nothing
          reflows when the bar fades in — which means a scrolling box gives up
          ~11px of CONTENT width to it. Padded directly, the rail's rows ended
          on x217 and the pack's x228 was unreachable. So the scroller runs
          full-bleed to the rail's edges (`-mx-3`) and the padding moves to a
          track pinned at the rail's own 240px: the rows measure x12 -> x228
          and the gutter falls in the rail's right padding, over a track that
          is transparent at rest. `overflow-x-hidden` absorbs the overhang;
          nothing about the site-wide scrollbar rule changes. */}
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden pt-2",
          collapsed ? "-mx-2" : "-mx-3",
        )}
      >
        <div className={cn("flex flex-col gap-4", collapsed ? "w-rail px-2" : "w-sidebar px-3")}>
          {groups.map((group) => (
            <div key={group.caption} className="flex flex-col gap-0.5">
              {/* The caption is the group's only label, and at 64px there is no
                  room for it. The glyphs keep their grouping from the 16px gap
                  between groups, which survives the collapse. */}
              {collapsed ? null : (
                <div className="px-2 pb-1 font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">
                  {CAPTION_KEY[group.caption] ? t(CAPTION_KEY[group.caption]) : group.caption}
                </div>
              )}

              {group.parents.map((parent) => {
                const leaf = parent.children.length === 0;
                const open = !leaf && isOpen(parent.key);
                const parentSelected = selection.parentKey === parent.key;
                /* A leaf parent IS the destination, so it can be selected. A
                 parent with children lights up because it HOLDS the
                 destination — the same tint, for the same reason: this is the
                 branch you are in. */
                const selected = leaf && parentSelected && selection.childKey === null;
                /* Collapsed, the children are not drawn at all, so the parent is
                   the only row that can carry the branch — still exactly one lit
                   row, and it is the visible ancestor of the one that would be. */
                const lit = collapsed ? parentSelected : leaf ? selected : parentSelected;
                const panelId = `nav-${parent.key.replace(/\W+/g, "-")}`;
                const icon = (
                  <span
                    aria-hidden="true"
                    data-icon-box=""
                    className="relative inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center text-[15px] leading-none"
                  >
                    {parent.icon}
                    {/* A count has nowhere to render at 64px, and dropping it
                        would hide the one thing a badge exists to say. It
                        becomes a dot on the glyph, alert-coloured when the
                        count is. */}
                    {collapsed && parent.badge ? (
                      <span
                        data-badge-dot=""
                        className={cn(
                          "absolute -right-1 -top-0.5 h-1.5 w-1.5 rounded-full",
                          parent.badgeIsAlert ? "bg-danger" : "bg-primary",
                        )}
                      />
                    ) : null}
                  </span>
                );

                return (
                  <div key={parent.key} className="flex flex-col">
                    {leaf ? (
                      <NavLink
                        to={parent.path as string}
                        title={collapsed ? parent.label : undefined}
                        data-lit={lit ? "true" : undefined}
                        className={cn(
                          PARENT_ROW,
                          collapsed && PARENT_RAIL,
                          lit ? PARENT_LIT : PARENT_IDLE,
                          FOCUS_RING,
                        )}
                      >
                        {icon}
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
                          /* From the rail there is nowhere for the children to
                             go, so opening a group widens the rail first. */
                          if (collapsed) {
                            toggleCollapsed();
                            if (!open) toggle(parent.key);
                            return;
                          }
                          toggle(parent.key);
                        }}
                        aria-expanded={open}
                        aria-controls={panelId}
                        title={collapsed ? parent.label : undefined}
                        data-lit={lit ? "true" : undefined}
                        className={cn(
                          PARENT_ROW,
                          collapsed && PARENT_RAIL,
                          lit ? PARENT_LIT : PARENT_IDLE,
                          FOCUS_RING,
                        )}
                      >
                        {icon}
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
                                "shrink-0",
                                lit ? "text-primary" : "text-ink-muted",
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
                          clipped row, so a closed group is exactly 0px. The
                          list is the line's positioning context, which is what
                          makes the line start at the parent row's bottom edge
                          with no magic offset. */}
                        <ul className="relative flex flex-col pt-0.5">
                          <span aria-hidden="true" data-tree-line="" className={TREE_LINE} />

                          {parent.children.map((child) => {
                            const childSelected =
                              selection.childKey === `${parent.key}/${child.key}`;

                            return (
                              <li key={child.key} className="pl-[30px]">
                                <NavLink
                                  to={child.path}
                                  tabIndex={open ? undefined : -1}
                                  data-selected={childSelected ? "true" : undefined}
                                  className={cn(
                                    CHILD_ROW,
                                    childSelected ? CHILD_SELECTED : CHILD_IDLE,
                                    FOCUS_RING,
                                  )}
                                >
                                  <span
                                    aria-hidden="true"
                                    data-dot=""
                                    className={cn(
                                      "h-1.5 w-1.5 shrink-0 rounded-full",
                                      childSelected ? "bg-primary" : "bg-ink-muted",
                                    )}
                                  />
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
      </div>

      <SidebarFooter collapsed={collapsed} />
    </nav>
  );
}
