"use client";

import { cn } from "@/lib/cn";
import { useOnAccent } from "./onAccent";

/** FORKED FROM TrainOS kit/Bar.tsx — a bar's fill is a single mark that encodes a state. */
export type BarState = "neutral" | "primary" | "warning" | "danger" | "success";

const FILL: Record<BarState, string> = {
  neutral: "bg-ink",
  primary: "bg-primary",
  warning: "bg-warning-accent",
  danger: "bg-danger",
  success: "bg-success",
};

export function MiniBar({
  value,
  state = "neutral",
  width,
  label,
  className,
}: {
  value: number;
  state?: BarState;
  width?: string;
  label: string;
  className?: string;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  const onAccent = useOnAccent();
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      style={width ? { width } : undefined}
      className={cn("h-1.5 overflow-hidden rounded-pill", onAccent ? "bg-[rgb(var(--on-accent)/0.25)]" : "bg-divider", width ? "shrink-0" : "w-full", className)}
    >
      <div className={cn("h-full rounded-pill", onAccent ? "bg-[rgb(var(--on-accent))]" : FILL[state])} style={{ width: `${pct}%` }} />
    </div>
  );
}
