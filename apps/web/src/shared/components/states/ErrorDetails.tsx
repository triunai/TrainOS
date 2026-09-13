import { useId, useState } from "react";
import { Collapse } from "@/shared/components/kit/Collapse";
import { FOCUS_RING } from "@/shared/components/kit/tokens";
import { cn } from "@/shared/lib/utils";
import { errorDetailsEnabled, formatErrorDetails, type ErrorDetailRow } from "./errorDetailRows";

export interface ErrorDetailsProps {
  rows: readonly ErrorDetailRow[];
  className?: string;
}

/**
 * The "Details" disclosure under a failure: what a tester copies into a report.
 *
 * ONE component, drawn by `ErrorState`, `NotDeployedState` and the crash
 * boundaries, so a screen never builds its own. Renders nothing unless
 * `errorDetailsEnabled()` — the reader of a production build gets the plain
 * sentence and nothing else.
 *
 * Quiet on purpose: a text disclosure, not a button competing with "Try
 * again", and closed by default so the sentence above it stays the message.
 */
export function ErrorDetails({ rows, className }: ErrorDetailsProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const id = useId();

  if (!errorDetailsEnabled() || rows.length === 0) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(formatErrorDetails(rows));
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  };

  const link = cn(
    "rounded-[4px] text-[12px] font-medium text-ink-secondary underline underline-offset-2 hover:text-ink",
    FOCUS_RING,
  );

  return (
    <div className={cn("flex w-full max-w-prose flex-col items-center gap-2", className)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={id}
        className={link}
      >
        Details
      </button>
      <Collapse open={open} id={id} className="w-full">
        <div className="flex flex-col gap-2 rounded-control bg-surface p-3 text-left">
          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 font-mono text-[11px]">
            {rows.map((row) => (
              <div key={row.label} className="contents">
                <dt className="text-ink-muted">{row.label}</dt>
                <dd className="whitespace-pre-wrap break-all text-ink-secondary">{row.value}</dd>
              </div>
            ))}
          </dl>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void copy()} className={link}>
              Copy details
            </button>
            {copied === "idle" ? null : (
              <span role="status" className="text-[12px] text-ink-muted">
                {copied === "copied" ? "Copied" : "Could not copy — select the text instead"}
              </span>
            )}
          </div>
        </div>
      </Collapse>
    </div>
  );
}
