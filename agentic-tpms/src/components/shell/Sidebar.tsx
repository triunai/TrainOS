"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { cn } from "@/lib/cn";
import { NAV, selectNav, type BadgeKey } from "@/lib/nav";
import { FOCUS_RING } from "@/components/kit/tokens";
import { ThemeSwitch } from "./ThemeSwitch";

/**
 * FORKED FROM TrainOS shared/components/layout/Sidebar.tsx — same geometry,
 * measured off the design pack: 240px expanded / 64px rail, profile band as
 * tall as the top bar, caption rows h-6, parent rows 36px (x12→x228), the lit
 * path (tinted parent, x29 tree line, dots, the active child on a raised card),
 * and `[` toggling the rail. It renders NAV and knows nothing about routes.
 */
const PARENT_ROW = "flex h-9 w-full items-center gap-2.5 rounded-control px-2 text-left text-[13px] transition-colors";
const PARENT_LIT = "bg-ai-tint-2 font-medium text-primary-hover";
const PARENT_IDLE = "text-ink-secondary hover:bg-surface-hover";
const CHILD_ROW = "flex h-[34px] w-full items-center gap-[11px] rounded-control pl-[7px] pr-4 text-left text-[13px] transition-colors";
const CHILD_SELECTED = "bg-card font-medium text-ink shadow-card";
const CHILD_IDLE = "text-ink-secondary hover:bg-surface-hover";
const TREE_LINE = "pointer-events-none absolute left-[17px] top-0 bottom-[17px] w-px bg-connector";

const OPEN_KEY = "tpms.sidebar.open";
const COLLAPSED_KEY = "tpms.sidebar.collapsed";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* navigation, not data */
  }
}

function NavBadge({ count, alert }: { count: number; alert?: boolean }) {
  return (
    <span
      className={cn(
        "ml-auto inline-flex min-w-[20px] items-center justify-center rounded-pill border px-1.5 font-mono text-[11px] leading-[18px]",
        alert ? "border-danger-border bg-danger-fill text-danger" : "border-primary-border bg-ai-tint text-primary-hover",
      )}
    >
      {count}
    </span>
  );
}

export interface OperatorView {
  id: string;
  name: string;
  roleLabel: string;
}

export function Sidebar({
  badges,
  operator,
  operators,
  version,
}: {
  badges: Partial<Record<BadgeKey, { count: number; alert?: boolean }>>;
  operator: OperatorView;
  operators: OperatorView[];
  version: string;
}) {
  const pathname = usePathname();
  const selection = selectNav(pathname);
  const [openKeys, setOpenKeys] = useState<Record<string, boolean>>({});
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setOpenKeys(read(OPEN_KEY, {}));
    setCollapsed(read(COLLAPSED_KEY, false));
  }, []);

  useEffect(() => {
    const key = selection.parentKey;
    if (!key) return;
    setOpenKeys((prev) => {
      if (prev[key]) return prev;
      const next = { ...prev, [key]: true };
      write(OPEN_KEY, next);
      return next;
    });
  }, [selection.parentKey]);

  const toggle = (key: string) =>
    setOpenKeys((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      write(OPEN_KEY, next);
      return next;
    });

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      write(COLLAPSED_KEY, !prev);
      return !prev;
    });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "[" || event.metaKey || event.ctrlKey || event.altKey) return;
      const t = event.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      if (document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      toggleCollapsed();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleCollapsed]);

  const collapseLabel = collapsed ? "Expand sidebar" : "Collapse sidebar";
  const collapseControl = (
    <button
      type="button"
      onClick={toggleCollapsed}
      aria-expanded={!collapsed}
      aria-label={collapseLabel}
      title={`${collapseLabel} ([)`}
      className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-control text-[13px] leading-none text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink", FOCUS_RING)}
    >
      <span aria-hidden="true">{collapsed ? "»" : "«"}</span>
    </button>
  );

  return (
    <nav
      aria-label="Main"
      onClickCapture={
        collapsed
          ? (event) => {
              if ((event.target as HTMLElement).closest("[data-rail-exempt]")) return;
              event.preventDefault();
              event.stopPropagation();
              toggleCollapsed();
            }
          : undefined
      }
      className={cn(
        "flex h-full shrink-0 flex-col bg-sidebar pb-4 transition-[width] duration-200 ease-out motion-reduce:transition-none",
        collapsed ? "w-rail cursor-pointer px-2" : "w-sidebar px-3",
      )}
    >
      <ProfileBand operator={operator} collapsed={collapsed} />

      <div className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden pt-2", collapsed ? "-mx-2" : "-mx-3")}>
        <div className={cn("flex flex-col gap-4", collapsed ? "w-rail px-2" : "w-sidebar px-3")}>
          {NAV.map((group, index) => (
            <div key={group.caption} className="flex flex-col gap-0.5">
              {collapsed ? (
                index === 0 ? <div className="mb-0.5 flex h-6 items-center justify-center">{collapseControl}</div> : null
              ) : (
                <div className="mb-0.5 flex h-6 items-center gap-2 px-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">{group.caption}</span>
                  {index === 0 ? collapseControl : null}
                </div>
              )}

              {group.parents.map((parent) => {
                const leaf = parent.children.length === 0;
                const open = !leaf && Boolean(openKeys[parent.key]);
                const parentSelected = selection.parentKey === parent.key;
                const lit = parentSelected;
                const badge = parent.badgeKey ? badges[parent.badgeKey] : undefined;
                const icon = (
                  <span aria-hidden="true" className="relative inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center text-[15px] leading-none">
                    {parent.icon}
                    {collapsed && badge && badge.count > 0 ? (
                      <span className={cn("absolute -right-1 -top-0.5 h-1.5 w-1.5 rounded-full", badge.alert ? "bg-danger" : "bg-primary")} />
                    ) : null}
                  </span>
                );
                const panelId = `nav-${parent.key}`;
                return (
                  <div key={parent.key} className="flex flex-col">
                    {leaf ? (
                      <Link
                        href={parent.path as string}
                        title={collapsed ? parent.label : undefined}
                        className={cn(PARENT_ROW, collapsed && "justify-center px-0", lit ? PARENT_LIT : PARENT_IDLE, FOCUS_RING)}
                      >
                        {icon}
                        {collapsed ? (
                          <span className="sr-only">{parent.label}</span>
                        ) : (
                          <>
                            <span className="truncate">{parent.label}</span>
                            {badge && badge.count > 0 ? <NavBadge count={badge.count} alert={badge.alert} /> : null}
                          </>
                        )}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggle(parent.key)}
                        aria-expanded={open}
                        aria-controls={panelId}
                        title={collapsed ? parent.label : undefined}
                        className={cn(PARENT_ROW, collapsed && "justify-center px-0", lit ? PARENT_LIT : PARENT_IDLE, FOCUS_RING)}
                      >
                        {icon}
                        {collapsed ? (
                          <span className="sr-only">{parent.label}</span>
                        ) : (
                          <>
                            <span className="truncate">{parent.label}</span>
                            {badge && badge.count > 0 ? <NavBadge count={badge.count} alert={badge.alert} /> : null}
                            <span aria-hidden="true" className={cn("shrink-0", lit ? "text-primary" : "text-ink-muted", badge && badge.count > 0 ? "ml-1" : "ml-auto")}>
                              {open ? "–" : "+"}
                            </span>
                          </>
                        )}
                      </button>
                    )}
                    {leaf || collapsed || !open ? null : (
                      <ul id={panelId} className="relative flex flex-col pt-0.5">
                        <span aria-hidden="true" className={TREE_LINE} />
                        {parent.children.map((child) => {
                          const selected = selection.childKey === `${parent.key}/${child.key}`;
                          return (
                            <li key={child.key} className="pl-[30px]">
                              <Link href={child.path} aria-current={selected ? "page" : undefined} className={cn(CHILD_ROW, selected ? CHILD_SELECTED : CHILD_IDLE, FOCUS_RING)}>
                                <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full", selected ? "bg-primary" : "bg-ink-muted")} />
                                <span className="truncate">{child.label}</span>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <SidebarFooter operator={operator} operators={operators} collapsed={collapsed} version={version} />
    </nav>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function ProfileBand({ operator, collapsed }: { operator: OperatorView; collapsed: boolean }) {
  return (
    <div className={cn("flex h-topbar shrink-0 items-center gap-2.5", collapsed ? "justify-center" : "px-2")}>
      <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-avatar font-mono text-[10px] font-medium text-[rgb(var(--on-accent))]">
        {initials(operator.name)}
      </span>
      {collapsed ? null : (
        <>
          <div className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate text-[14px] font-medium text-ink">{operator.name}</span>
            <span className="truncate text-[12px] text-ink-muted">{operator.roleLabel}</span>
          </div>
          <ThemeSwitch />
        </>
      )}
    </div>
  );
}

function SidebarFooter({ operator, operators, collapsed, version }: { operator: OperatorView; operators: OperatorView[]; collapsed: boolean; version: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const switchOperator = (id: string) => {
    document.cookie = `tpms_operator=${encodeURIComponent(id)}; path=/; max-age=31536000; samesite=lax`;
    startTransition(() => router.refresh());
  };
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1 border-t border-divider pt-3">
        <span aria-hidden="true" className="text-[14px] text-ink-muted">
          ◑
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 border-t border-divider pt-3">
      <Link href="/system/audit" className={cn("flex h-8 items-center gap-2.5 rounded-control px-2 text-[13px] text-ink-secondary hover:bg-surface-hover", FOCUS_RING)}>
        <span aria-hidden="true" className="w-[18px] text-center text-ink-muted">
          ⛓
        </span>
        Audit ledger
      </Link>
      <label className="flex h-8 items-center gap-2.5 rounded-control px-2 text-[13px] text-ink-secondary" data-rail-exempt="">
        <span aria-hidden="true" className="w-[18px] text-center text-ink-muted">
          ◑
        </span>
        <span className="sr-only">Acting as</span>
        <select
          value={operator.id}
          disabled={pending}
          onChange={(e) => switchOperator(e.target.value)}
          className={cn("min-w-0 flex-1 cursor-pointer truncate rounded-control bg-transparent py-1 text-[13px] text-ink-secondary hover:text-ink", FOCUS_RING)}
          title="Acting as — every approval is attributed to this operator in the audit ledger"
        >
          {operators.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} · {o.roleLabel}
            </option>
          ))}
        </select>
      </label>
      <p className="flex items-center gap-1.5 px-2 pt-1 text-[11px] text-ink-muted">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-success" />
        {version}
      </p>
    </div>
  );
}
