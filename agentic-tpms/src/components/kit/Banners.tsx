import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * FORKED FROM TrainOS kit/ApprovalBanner.tsx + ExceptionBanner.tsx — a banner
 * whose whole row IS the state is one of the three shapes status colour may
 * take outside a chip.
 */
export type BannerTone = "warning" | "danger" | "info" | "success" | "neutral";

const TONE: Record<BannerTone, string> = {
  warning: "border-warning-border bg-warning-fill",
  danger: "border-danger-border bg-danger-fill",
  info: "border-info-border bg-info-fill",
  success: "border-success-border bg-success-fill",
  neutral: "border-border bg-surface",
};

export function Banner({
  tone = "warning",
  title,
  children,
  actions,
  className,
}: {
  tone?: BannerTone;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex flex-wrap items-center gap-3.5 rounded-control border px-3.5 py-3", TONE[tone], className)}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-[13px] font-semibold text-ink">{title}</p>
        {children ? <div className="text-[12px] text-ink-secondary">{children}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
