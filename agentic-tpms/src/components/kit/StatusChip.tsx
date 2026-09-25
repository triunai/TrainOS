"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useOnAccent } from "./onAccent";

/**
 * FORKED FROM TrainOS kit/StatusChip.tsx — the only status chip. Status colour
 * lives here: emerald (success) for verified/approved, amber (warning) for
 * pending/tentative, rose (danger) for flagged/queried, info for in-flight,
 * neutral for everything that is not an event.
 */
export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

const TONE: Record<StatusTone, string> = {
  neutral: "bg-surface text-ink-secondary border-border",
  info: "bg-info-fill text-info border-info-border",
  success: "bg-success-fill text-success border-success-border",
  warning: "bg-warning-fill text-warning border-warning-border",
  danger: "bg-danger-fill text-danger border-danger-border",
};

const ACCENT_TONE =
  "border-[rgb(var(--on-accent)/0.45)] bg-[rgb(var(--on-accent)/0.14)] text-[rgb(var(--on-accent))]";

const SHAPE = { pill: "rounded-pill", square: "rounded-[6px]" } as const;

export interface StatusChipProps {
  children: ReactNode;
  tone?: StatusTone;
  shape?: keyof typeof SHAPE;
  glyph?: ReactNode;
  live?: boolean;
  title?: string;
  className?: string;
}

export function StatusChip({ children, tone = "neutral", shape = "pill", glyph, live, title, className }: StatusChipProps) {
  const onAccent = useOnAccent();
  return (
    <span
      role={live ? "status" : undefined}
      data-tone={tone}
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border px-2.5 py-[3px] text-[12px] font-medium",
        onAccent ? ACCENT_TONE : TONE[tone],
        SHAPE[shape],
        className,
      )}
    >
      {glyph ? <span aria-hidden="true">{glyph}</span> : null}
      {children}
    </span>
  );
}
