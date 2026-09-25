import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** FORKED FROM TrainOS shared/components/states — empty, loading and error, one design each. */
export function EmptyState({ title, description, action, glyph, className }: { title: string; description?: string; action?: ReactNode; glyph?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-16 text-center", className)}>
      {glyph ? (
        <div aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-control bg-surface text-ink-muted">
          {glyph}
        </div>
      ) : null}
      <p className="text-[15px] font-medium text-ink">{title}</p>
      {description ? <p className="max-w-prose text-[13px] text-ink-muted">{description}</p> : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" className="flex flex-col gap-3 px-5 py-6">
      <span className="sr-only">{label}</span>
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-4 animate-pulse rounded-control bg-surface" style={{ width: `${80 - i * 18}%` }} />
      ))}
    </div>
  );
}

export function ErrorState({ title = "This view could not load", description, action }: { title?: string; description?: string; action?: ReactNode }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <p className="text-[15px] font-medium text-ink">{title}</p>
      {description ? <p className="max-w-prose font-mono text-[12px] text-ink-muted">{description}</p> : null}
      {action}
    </div>
  );
}
