import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

/**
 * The external minimal shell. Kit.dc.html §07 and REPORT.md's kit-additions
 * list; used by exactly one screen, M07-S07, the client-facing proposal.
 *
 * A 56px top bar carrying the logo, the org name, a language toggle and contact
 * details — and no sidebar, because a client has nothing to navigate to. The
 * content card takes a 14px margin on all sides here rather than the internal
 * shell's right-and-bottom only, so the page reads as a document rather than as
 * a panel inside an app.
 *
 * REPORT.md notes this screen intentionally carries NO primary button: it is a
 * locked, read-only state. The shell therefore has no action slot at all, which
 * makes that impossible to get wrong rather than merely discouraged.
 */

export interface ExternalMinimalShellProps {
  children: ReactNode;
  /** The tenant's name, beside the mark. */
  orgName: string;
  /** A short mark — initials or a glyph. The pack uses a 26×26 box. */
  mark?: ReactNode;
  /** `EN | BM`. Rendered as given so the shell holds no locale logic. */
  languageToggle?: ReactNode;
  /** One line: a phone number, an email, or both. */
  contact?: string;
  className?: string;
}

export function ExternalMinimalShell({
  children,
  orgName,
  mark,
  languageToggle,
  contact,
  className,
}: ExternalMinimalShellProps) {
  return (
    <div className={cn("flex min-h-screen flex-col bg-canvas", className)}>
      <header className="flex h-topbar shrink-0 items-center gap-3 px-4">
        <span
          aria-hidden="true"
          className="flex h-[26px] w-[26px] items-center justify-center rounded-[6px] bg-avatar font-mono text-[11px] text-on-primary"
        >
          {mark ?? orgName.slice(0, 1).toUpperCase()}
        </span>
        <span className="text-[14px] font-semibold text-ink">{orgName}</span>

        <div className="ml-auto flex items-center gap-3">
          {contact ? <span className="text-[12px] text-ink-muted">{contact}</span> : null}
          {languageToggle}
        </div>
      </header>

      <main className="m-inset mt-0 min-h-0 flex-1 overflow-auto rounded-card-lg border border-border bg-card shadow-card">
        {children}
      </main>
    </div>
  );
}

export interface LanguageToggleProps {
  value: string;
  options?: string[];
  onChange?: (value: string) => void;
  className?: string;
}

/** The `EN | BM` chip from §07. Used by both shells. */
export function LanguageToggle({
  value,
  options = ["EN", "BM"],
  onChange,
  className,
}: LanguageToggleProps) {
  return (
    <div
      role="group"
      aria-label="Language"
      className={cn(
        "inline-flex items-center rounded-control border border-border bg-card",
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={option === value}
          onClick={() => onChange?.(option)}
          className={cn(
            "px-2 py-1 font-mono text-[11px] first:rounded-l-control last:rounded-r-control",
            option === value
              ? "bg-ai-tint-2 text-primary-hover"
              : "text-ink-muted hover:bg-surface-hover",
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
