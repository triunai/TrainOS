import { Fragment, type ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

/**
 * The breadcrumb. Kit.dc.html §07 top bar: parent links in secondary ink, the
 * current crumb bold in ink, `›` separators muted.
 *
 * CLAUDE.md: "the breadcrumb owns the path" — and only the path. It never
 * carries the record's identity chips or actions; those belong to RecordHeader,
 * which is the one place identity appears.
 *
 * The last crumb is not a link. It is where you already are, and marking it
 * `aria-current="page"` is what tells a screen reader so.
 */

export interface Crumb {
  label: string;
  /** Absent on the last crumb, and on any ancestor with no page of its own. */
  href?: string;
}

export interface BreadcrumbProps {
  items: Crumb[];
  /**
   * How a crumb navigates. The kit does not import a router — a component that
   * knows about `react-router` cannot be used inside a drawer, a modal preview
   * or a test without one. Pass `linkAs` to wire it up.
   */
  linkAs?: (props: { href: string; children: ReactNode; className: string }) => ReactNode;
  className?: string;
}

export function Breadcrumb({ items, linkAs, className }: BreadcrumbProps) {
  const linkClass =
    "rounded-[4px] text-ink-secondary hover:text-ink hover:underline underline-offset-2";

  return (
    <nav aria-label="Breadcrumb" className={cn("flex min-w-0 items-center", className)}>
      <ol className="flex min-w-0 items-center gap-1.5 text-[13px]">
        {items.map((crumb, index) => {
          const last = index === items.length - 1;

          return (
            <Fragment key={`${crumb.label}-${index}`}>
              {index > 0 ? (
                <li aria-hidden="true" className="text-ink-muted">
                  ›
                </li>
              ) : null}
              <li className="min-w-0">
                {last || !crumb.href ? (
                  <span
                    aria-current={last ? "page" : undefined}
                    className={cn(
                      "truncate",
                      last ? "font-semibold text-ink" : "text-ink-secondary",
                    )}
                  >
                    {crumb.label}
                  </span>
                ) : linkAs ? (
                  linkAs({ href: crumb.href, children: crumb.label, className: linkClass })
                ) : (
                  <a href={crumb.href} className={linkClass}>
                    {crumb.label}
                  </a>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
