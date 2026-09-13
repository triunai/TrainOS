import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { Avatar } from "./TopbarPieces";
import { FOCUS_RING } from "./tokens";

/**
 * The profile modal. Kit.dc.html §07, "Profile modal · 960".
 *
 * 960 wide, two columns: a recessed identity rail on the left and the tenant's
 * own banner over the employment record on the right. The avatar deliberately
 * OVERHANGS the modal's left edge — the artboard offsets it -72px against a
 * 176px circle — which is why the rail's padding is `28px 28px 28px 0` and the
 * overlay is not clipped.
 *
 * PRESENTATIONAL ONLY, every field a prop. The shell composes it from
 * `useMe()`; the fields the contract's `Me` does not carry are supplied by the
 * caller and marked at their source, so a reader of this file cannot mistake
 * an invented staff number for one the API returned. When `/v1/me` grows these
 * fields, the call site changes and this does not.
 *
 * The tenant banner is the pack's gradient, and it is two stops of the SAME
 * accent with `--primary` in the middle — not a fourth colour. It is the one
 * surface in the application that spends blue at this size, which is the
 * artboard's own judgement: the banner IS the tenant.
 */

export interface ProfileField {
  label: string;
  value: ReactNode;
  /** Renders muted and italic, for a field that is not wired yet. */
  pending?: boolean;
}

export interface ProfileModalProps {
  open: boolean;
  onClose: () => void;

  name: string;
  /** Rendered uppercase in the identity chip. */
  roleLabel: string;
  /** "Akademi Perdana · Klang Valley". */
  orgAndLocation: string;
  /** Already formatted: the pack writes "Last sign in 11-09-2026 08:04:22 AM". */
  lastSignIn: string;
  /** "Chrome · Shah Alam, GMT+8". */
  session: string;
  /** The build stamp, shown under the two account actions. */
  version: string;

  /** Tenant name and short code for the banner. */
  orgName: string;
  orgCode: string;

  /** Six cards, two columns, in the artboard's order. */
  fields: ProfileField[];
  /** "7 modules", "2FA on", "2 active sessions". */
  chips: { label: string; tone?: "accent" | "success" | "neutral" }[];

  /** Read-only until the endpoint exists; rendered as the pack draws them. */
  dataScope: { clients: string; teams: string };

  onChangePassword?: () => void;
  onSignOut?: () => void;
}

const CHIP_TONE = {
  accent: "bg-ai-tint text-primary-hover",
  success: "bg-surface text-success",
  neutral: "bg-surface text-ink-muted",
} as const;

function Card({ field }: { field: ProfileField }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[10px] border border-divider bg-surface px-3.5 py-3">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-muted">
        {field.label}
      </span>
      <span
        className={cn(
          "truncate text-[14px]",
          field.pending ? "italic text-ink-muted" : "font-semibold text-ink",
        )}
      >
        {field.value}
      </span>
    </div>
  );
}

/** A select that is drawn but not wired — the pack shows it disabled too. */
function ScopeSelect({ value, muted }: { value: string; muted?: boolean }) {
  return (
    <span
      className={cn(
        "flex max-w-[200px] flex-1 items-center rounded-[9px] border px-3 py-2 text-[14px]",
        muted ? "border-divider italic text-ink-muted" : "border-border text-ink",
      )}
    >
      {value}
      <span aria-hidden="true" className="ml-auto text-ink-muted">
        ⌄
      </span>
    </span>
  );
}

export function ProfileModal({
  open,
  onClose,
  name,
  roleLabel,
  orgAndLocation,
  lastSignIn,
  session,
  version,
  orgName,
  orgCode,
  fields,
  chips,
  dataScope,
  onChangePassword,
  onSignOut,
}: ProfileModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/20 backdrop-blur-[1px] data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />

        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex w-[960px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2",
            "rounded-[18px] border border-border bg-card shadow-card outline-none",
            "data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          )}
        >
          {/* Identity rail. `pl-0` and the avatar's negative margin are what
              let the circle break the modal's edge, as the artboard draws it. */}
          <div className="flex w-[320px] shrink-0 flex-col gap-2.5 rounded-l-[18px] border-r border-divider bg-sidebar py-7 pl-0 pr-7">
            <div className="relative -ml-[72px] mb-4 flex h-[176px] w-[176px] shrink-0 items-center justify-center rounded-pill border-8 border-card bg-ai-tint shadow-card">
              <Avatar
                name={name}
                size={160}
                className="h-full w-full bg-transparent text-[52px] font-bold tracking-[-0.02em] text-primary-hover"
              />
              <span
                aria-hidden="true"
                className="absolute bottom-1.5 right-1.5 flex h-10 w-10 items-center justify-center rounded-pill border-[3px] border-surface bg-primary text-[15px] text-on-primary"
              >
                ◎
              </span>
            </div>

            <Dialog.Title className="pl-7 text-[24px] font-bold tracking-[-0.02em] text-ink">
              {name}
            </Dialog.Title>

            <div className="pl-7">
              <span className="inline-block rounded-pill bg-ai-tint px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-primary-hover">
                {roleLabel}
              </span>
            </div>

            <p className="pl-7 text-[14px] font-semibold text-ink">{orgAndLocation}</p>
            <p className="pl-7 text-[13px] text-ink-muted">{lastSignIn}</p>
            <p className="pl-7 text-[13px] italic text-ink-muted">{session}</p>

            <div className="mt-7 flex flex-col items-center gap-3.5 pl-7">
              <button
                type="button"
                onClick={onChangePassword}
                disabled={!onChangePassword}
                className={cn(
                  "flex items-center gap-2.5 rounded-control px-2 py-1 text-[14px] text-ink-muted",
                  onChangePassword ? "hover:text-ink" : "cursor-not-allowed",
                  FOCUS_RING,
                )}
              >
                <span aria-hidden="true">⌂</span> Change password
              </button>

              <button
                type="button"
                onClick={onSignOut}
                disabled={!onSignOut}
                className={cn(
                  "flex items-center gap-2.5 rounded-control px-2 py-1 text-[14px] font-semibold text-ink",
                  onSignOut ? "hover:bg-surface-hover" : "cursor-not-allowed text-ink-muted",
                  FOCUS_RING,
                )}
              >
                <span aria-hidden="true">↪</span> Sign out
              </button>

              <p className="text-[13px] text-ink-muted">{version}</p>
            </div>
          </div>

          {/* Employment record. */}
          <div className="flex min-w-0 flex-1 flex-col p-[18px]">
            {/* `--surface-accent-gradient`, the one accent band in the system,
                NOT a hand-rolled copy of the artboard's stops. The artboard's
                own ramp ends at #4E82FF, where white reads 3.52:1 and white at
                60% reads 2.22:1 — both below AA, and every label on this band
                is white. The token is the same three colours at the same angle
                with the lift stop pushed past the visible end, and it is pinned
                to literals so a theme swap cannot move it: a tenant banner is a
                brand artefact, not a surface that takes its lightness from what
                is behind it. */}
            <div className="flex min-h-[112px] items-start gap-3.5 rounded-card bg-[image:var(--surface-accent-gradient)] px-[22px] py-5">
              <span
                aria-hidden="true"
                className="flex h-11 w-11 items-center justify-center rounded-card bg-[rgb(var(--on-accent)/0.14)] text-[16px] text-[rgb(var(--on-accent))]"
              >
                ⬡
              </span>
              <div className="min-w-0">
                <p className="truncate text-[19px] font-bold tracking-[-0.01em] text-[rgb(var(--on-accent))]">
                  {orgName}
                </p>
                {/* Full white, not 70%: over this band a translucent white
                    reads 3.35:1 at the 11px this uses. The step down is carried
                    by size, weight and tracking instead. */}
                <p className="font-mono text-[11px] tracking-[0.14em] text-[rgb(var(--on-accent))]">
                  {orgCode}
                </p>
              </div>

              <Dialog.Close
                className={cn(
                  "ml-auto flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-pill bg-card text-[14px] text-ink hover:bg-surface-hover",
                  FOCUS_RING,
                )}
              >
                <span aria-hidden="true">✕</span>
                <span className="sr-only">Close</span>
              </Dialog.Close>
            </div>

            <div className="grid grid-cols-1 gap-3 pt-4 sm:grid-cols-2">
              {fields.map((field) => (
                <Card key={field.label} field={field} />
              ))}
            </div>

            <div className="flex flex-wrap gap-2 pt-3.5">
              {chips.map((chip) => (
                <span
                  key={chip.label}
                  className={cn(
                    "rounded-pill px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.06em]",
                    CHIP_TONE[chip.tone ?? "neutral"],
                  )}
                >
                  {chip.label}
                </span>
              ))}
            </div>

            <div className="mt-auto flex flex-wrap items-center gap-3.5 border-t border-divider pt-5">
              <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
                Data scope
              </span>
              <ScopeSelect value={dataScope.clients} />
              <ScopeSelect value={dataScope.teams} muted />
              <button
                type="button"
                disabled
                className="ml-auto cursor-not-allowed rounded-[9px] border border-divider bg-surface px-6 py-2.5 text-[14px] font-semibold text-ink-disabled"
              >
                Save
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
