import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { SECTION_LABEL } from "./tokens";

/**
 * FORKED FROM TrainOS kit/ContentCard.tsx. A panel inside the page card:
 * caption + title + optional actions, then content. Hierarchy from type and a
 * hairline, not heavier borders.
 */
export function Section({
  eyebrow,
  title,
  actions,
  children,
  className,
  bodyClassName,
  flush,
}: {
  eyebrow?: string;
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  flush?: boolean;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-card border border-border bg-card", className)}>
      {eyebrow || title || actions ? (
        <div className="flex items-start gap-3 border-b border-divider px-4 py-3">
          <div className="min-w-0 flex-1">
            {eyebrow ? <p className={SECTION_LABEL}>{eyebrow}</p> : null}
            {title ? <h2 className="text-[15px] font-semibold tracking-[-0.005em] text-ink">{title}</h2> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={cn(flush ? "" : "px-4 py-3.5", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Key/value rows for record detail. */
export function DefinitionList({ items, className }: { items: Array<[string, ReactNode]>; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[minmax(120px,40%)_1fr] gap-x-4 gap-y-2 text-[13px]", className)}>
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-muted">{k}</dt>
          <dd className="min-w-0 break-words text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Body({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-4 px-5 pb-6", className)}>{children}</div>;
}
