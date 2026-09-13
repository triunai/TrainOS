import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

/**
 * The account shell: the frame around every screen a person sees BEFORE the
 * app knows who they are. Sign-in, the OAuth callback and "your account is not
 * linked to a workspace" all draw it, which is three screens and therefore a
 * kit component rather than three hand-built centred cards.
 *
 * No sidebar, no top bar, no breadcrumb: there is no record and no path yet,
 * and a rail full of destinations nobody can open is a promise the screen
 * cannot keep. The TrainOS mark and name are the only identity on the page,
 * drawn once, above the card.
 *
 * Hierarchy is type and spacing. The card is the one plane on the canvas, so
 * nothing inside it carries a border of its own; `note` sits under a divider
 * because it is a different KIND of line — a statement about what is not
 * offered, not a step in the flow.
 *
 * The shell holds no action. The screen passes its one primary as a child, so
 * the one-solid-primary rule stays where `useSinglePrimary` can see it.
 */

export interface AuthShellProps {
  /** One short sentence: what this screen is for. Rendered as the page's h1. */
  title: string;
  /** One or two lines under the title. */
  description?: ReactNode;
  /** The screen's controls, or its state. */
  children?: ReactNode;
  /**
   * A muted, non-interactive line under a divider. For what is NOT available
   * here — "Email sign-in — coming soon" — which must read as information and
   * never as a disabled control somebody tries to click.
   */
  note?: ReactNode;
  className?: string;
}

export function AuthShell({ title, description, children, note, className }: AuthShellProps) {
  return (
    <div
      className={cn(
        "flex min-h-dvh w-full flex-col items-center justify-center gap-6 bg-canvas px-4 py-10",
        className,
      )}
    >
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex h-[26px] w-[26px] items-center justify-center rounded-[6px] bg-avatar text-[12px] font-semibold text-on-primary"
        >
          T
        </span>
        <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink">TrainOS</span>
      </div>

      <main className="flex w-full max-w-[400px] flex-col gap-5 rounded-card-lg border border-border bg-card px-7 py-8 shadow-card">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[20px] font-semibold leading-7 text-ink">{title}</h1>
          {description ? (
            <div className="text-[13px] leading-5 text-ink-muted">{description}</div>
          ) : null}
        </div>

        {children}

        {note ? (
          <p className="border-t border-divider pt-4 text-center text-[12px] text-ink-muted">
            {note}
          </p>
        ) : null}
      </main>
    </div>
  );
}

/**
 * Google's "G", in one ink.
 *
 * Not the four-colour logo: CLAUDE.md allows three colours and puts status
 * colour on chips only, and a button that is mostly Google's palette is a
 * fourth and fifth accent on the one screen every user sees first. The glyph
 * takes `currentColor`, so on the solid primary it reads in the button's own
 * label colour in both themes.
 */
export function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      className={cn("shrink-0", className)}
      fill="currentColor"
    >
      <path d="M21.35 11.1H12v2.98h5.35c-.23 1.4-1.64 4.1-5.35 4.1-3.22 0-5.85-2.67-5.85-5.96S8.78 6.26 12 6.26c1.83 0 3.06.78 3.76 1.45l2.57-2.47C16.68 3.7 14.55 2.75 12 2.75 6.9 2.75 2.75 6.9 2.75 12S6.9 21.25 12 21.25c6.93 0 9.5-4.86 9.5-7.4 0-.5-.05-.88-.15-1.27z" />
    </svg>
  );
}
