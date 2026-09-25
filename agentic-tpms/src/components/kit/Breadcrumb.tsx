"use client";

import Link from "next/link";
import { Fragment } from "react";
import { cn } from "@/lib/cn";

/**
 * FORKED FROM TrainOS kit/Breadcrumb.tsx. The breadcrumb owns the path and
 * only the path — `Home / Operations / PKG-2026-0012 / Commercials`. Record
 * identity (chips, actions) belongs to RecordHeader.
 */
export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumb({ items, className }: { items: Crumb[]; className?: string }) {
  const linkClass = "rounded-[4px] text-ink-secondary hover:text-ink hover:underline underline-offset-2";
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
                  <span aria-current={last ? "page" : undefined} className={cn("truncate", last ? "font-semibold text-ink" : "text-ink-secondary")}>
                    {crumb.label}
                  </span>
                ) : (
                  <Link href={crumb.href} className={linkClass}>
                    {crumb.label}
                  </Link>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
