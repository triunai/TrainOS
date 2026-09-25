import Link from "next/link";
import type { ReactNode } from "react";
import { Breadcrumb, type Crumb } from "@/components/kit/Breadcrumb";
import { cn } from "@/lib/cn";
import { pendingCount } from "@/server/decisions/service";

/**
 * The top bar + content card, rendered by each page so the breadcrumb is
 * server-rendered with the page (no flash). Geometry is TrainOS's AppShell:
 * 56px bar on the shell ground, `pl-1 pr-5`; the card flush to the rail and
 * the bar, 14px gutters right and bottom; `main` owns the scroll.
 *
 * Left slot: the breadcrumb (the path — never the record's identity). Right
 * slot: search and the decisions bell. No solid primary button lives here.
 */
export async function Frame({
  crumbs,
  breadcrumb,
  children,
  className,
  fill,
}: {
  crumbs?: Crumb[];
  /** A client breadcrumb (e.g. one that reads the selected layout segment). */
  breadcrumb?: ReactNode;
  children: ReactNode;
  className?: string;
  fill?: boolean;
}) {
  const pending = await pendingCount().catch(() => 0);
  return (
    <>
      <header className="flex h-topbar shrink-0 items-center gap-3 bg-sidebar pl-1 pr-5">
        <div className="min-w-0 flex-1">
          {breadcrumb ?? <Breadcrumb items={[{ label: "Home", href: "/" }, ...(crumbs ?? [])]} />}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <form action="/search" className="relative">
            <span aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-ink-muted">
              ⌕
            </span>
            <input
              name="q"
              placeholder="Search packages, leads, clients"
              aria-label="Search"
              className="h-8 w-[260px] rounded-control border border-border bg-card pl-7 pr-12 text-[13px] text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
            <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-[4px] border border-border px-1 font-mono text-[10px] text-ink-muted">↵</kbd>
          </form>
          <Link
            href="/decisions"
            aria-label={`${pending} pending decisions`}
            title={`${pending} pending decisions`}
            className="relative inline-flex h-8 w-8 items-center justify-center rounded-control text-ink-secondary hover:bg-surface-hover"
          >
            <span aria-hidden="true">◔</span>
            {pending > 0 ? (
              <span className="absolute -right-1 -top-1 inline-flex min-w-[18px] items-center justify-center rounded-pill border border-danger-border bg-danger-fill px-1 font-mono text-[10px] leading-[16px] text-danger">
                {pending}
              </span>
            ) : null}
          </Link>
        </div>
      </header>
      <main className={cn("mb-inset mr-inset flex min-h-0 flex-1 flex-col overflow-y-auto rounded-card-lg border border-border bg-card shadow-card", fill && "overflow-hidden", className)}>
        {children}
      </main>
    </>
  );
}
