import { useState } from "react";
import { cn } from "@/shared/lib/utils";
import { Avatar, ProfileModal } from "@/shared/components/kit";
import { FOCUS_RING } from "@/shared/components/kit/tokens";
import { ROLE_LABEL, scopeLabels } from "@/shared/config/roles";
import { useMe } from "@/shared/hooks/useMe";
import { useT } from "@/shared/i18n";
import { ThemeSwitch } from "./ThemeSwitch";
import { useMeProfile } from "./useMeProfile";
import { VERSION_LINE } from "./version";

/**
 * Who you are, at the TOP of the rail — and the control that closes the rail.
 *
 * Identity sat in the footer until a reader pointed out that it is the first
 * thing you check and the last place you look for it.
 *
 * ── THE BAND IS THE TOP BAR'S HEIGHT, EXACTLY ────────────────────────────
 *
 * This row is the rail's counterpart to the breadcrumb: they are the two
 * things at the top of the frame, side by side across the rail-to-bar
 * junction, and the pack draws them on one line. It did not look like one.
 * The rail carried `py-4` and this row carried `pt-2 pb-4`, so the band ran
 * y16 -> y88 while the top bar ends at y56: the name sat 11px low and the role
 * line crossed y56 entirely, landing against the top edge of the content card
 * where it read as clipped (the user's 73.png).
 *
 * So the band is `h-topbar` — the SAME token the bar reads, never a retyped
 * 56 — and its content is centred in it. The name/role stack is 33px on
 * explicit leading, which centres to y11.5 -> y44.5 with 11px of air below the
 * card's top edge, and the stack's centre line is y28: the top bar's centre,
 * which is the line the breadcrumb is centred on too. Two lines of type cannot
 * ALSO put their first baseline on a single line's baseline — a stack centred
 * in 56px has its name baseline at y25 and the breadcrumb's is at y32 — so the
 * shared centre line is the alignment, and nothing overruns the band.
 *
 * ── WHERE THE COLLAPSE CONTROL SITS, AND WHAT LEFT TO MAKE ROOM ──────────
 *
 * Top right of this band, and the theme switch moved into the profile modal to
 * pay for it. Measured at 1440 before choosing: the band's content box is
 * 216px (240 less the rail's `px-3`); the avatar takes 26, the button's own
 * padding 16, its gap 8, the theme switch 61, and two 6px gaps plus a 24px
 * control 36 — which leaves 69px of text for a name that needs 84 and a role
 * that needs 87. Both truncate, and the product's own primary user is "Alex
 * Selvarajah", who needs 100. With the switch in the modal the text gets 136px
 * and nothing truncates. The switch is still one click from the row it
 * described, and it is still not inside a menu.
 *
 * Collapsed, the rail is 64px and has no "right": the band stacks the avatar
 * over the same control, which keeps the control in the one place a reader
 * who just collapsed the rail is already looking.
 *
 * The modal's eleven extra fields come from `GET /v1/me/profile`, fetched only
 * when the modal opens. `shared/config/profileDetails.ts` held them as invented
 * constants until that endpoint landed, and is what this deleted.
 */

/**
 * The two sentences the contract deliberately does NOT pre-join.
 *
 * `MeProfile` publishes `lastSignInAt`, `browser` and `place` separately, and
 * says why: "Chrome · Shah Alam, GMT+8" and "11-09-2026 08:04:22 AM" are one
 * sentence and one locale decision, and a contract that shipped them joined
 * would have put this app's date format on the server.
 *
 * They are local to this file rather than added to the kit's `format.ts`
 * because this modal is their only caller and the format is the pack's own
 * wording for this one panel. `formatDate` renders "11 Sep 2026" and stays the
 * app's date format everywhere else; a second exported date helper that looked
 * general but was really Kit §07's would be the divergence the consolidation
 * rule exists to stop. If a second screen ever wants it, it moves to the kit.
 *
 * Both render in the HOLDER's timezone from `Me`, not the browser's. A last
 * sign-in shown in the reader's local time is the one value on this panel that
 * has to be checkable against what the account holder remembers doing.
 */
function formatSignIn(timestamp: string, timeZone: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return "—";

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).formatToParts(parsed);

  const at = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${at("day")}-${at("month")}-${at("year")} ${at("hour")}:${at("minute")}:${at(
    "second",
  )} ${at("dayPeriod").toUpperCase()}`;
}

/** `Asia/Kuala_Lumpur` -> `GMT+8`. Falls back to the zone's own name. */
function gmtOffset(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date());
    return parts.find((part) => part.type === "timeZoneName")?.value ?? timeZone;
  } catch {
    /* An unknown zone from the server must not take the modal down. */
    return timeZone;
  }
}

export interface SidebarProfileProps {
  /** The 64px icon rail. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** The rail's own element, which this control expands and collapses. */
  navId: string;
}

export function SidebarProfile({ collapsed, onToggleCollapsed, navId }: SidebarProfileProps) {
  const { me } = useMe();
  const t = useT();
  const [open, setOpen] = useState(false);
  /* Not fetched until the modal is opened — see `useMeProfile`. */
  const profile = useMeProfile(open);
  const details = profile.data;

  const label = collapsed ? t("shell.expandSidebar") : t("shell.collapseSidebar");

  const collapseControl = (
    <button
      type="button"
      onClick={onToggleCollapsed}
      aria-expanded={!collapsed}
      aria-controls={navId}
      aria-label={label}
      title={`${label} ([)`}
      data-rail-toggle=""
      className={cn(
        "flex shrink-0 items-center justify-center rounded-control text-[13px] leading-none",
        "text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink",
        collapsed ? "h-[22px] w-8" : "h-6 w-6",
        FOCUS_RING,
      )}
    >
      <span aria-hidden="true">{collapsed ? "»" : "«"}</span>
    </button>
  );

  /* One modal, one set of props, whichever shape the band is in.

     A field reads "Loading…" while the request is in flight and "Unavailable"
     if it was refused, rather than an empty card: a blank value next to a
     staff number reads as "you have no staff number", which is a different
     claim from "we could not ask". The identity line, the role and the data
     scope come from `Me` and are on screen either way. */
  const placeholder = profile.isError ? "Unavailable" : "Loading…";
  const field = (value: string | undefined) =>
    details === undefined ? placeholder : (value ?? "—");

  const modal = (
    <ProfileModal
      open={open}
      onClose={() => setOpen(false)}
      name={me.name}
      roleLabel={ROLE_LABEL[me.role]}
      orgAndLocation={
        details === undefined ? placeholder : `${details.tenant.name} · ${details.location}`
      }
      lastSignIn={
        details === undefined
          ? `Last sign in ${placeholder}`
          : `Last sign in ${formatSignIn(details.session.lastSignInAt, me.timezone)}`
      }
      session={
        details === undefined
          ? placeholder
          : `${details.session.browser} · ${details.session.place}, ${gmtOffset(me.timezone)}`
      }
      version={VERSION_LINE}
      orgName={details?.tenant.name ?? placeholder}
      orgCode={details?.tenant.code ?? ""}
      chips={
        details === undefined
          ? []
          : [
              { label: `${details.moduleCount} modules`, tone: "accent" as const },
              details.session.twoFactorEnabled
                ? { label: "2FA on", tone: "success" as const }
                : { label: "2FA off", tone: "neutral" as const },
              {
                label: `${details.session.activeSessions} active sessions`,
                tone: "neutral" as const,
              },
            ]
      }
      dataScope={scopeLabels(me)}
      headerAction={<ThemeSwitch />}
      fields={[
        { label: "Job title", value: field(details?.jobTitle) },
        { label: "Department", value: field(details?.department) },
        { label: "Email", value: field(details?.email) },
        { label: "Mobile", value: field(details?.mobile) },
        { label: "Staff no.", value: field(details?.staffNumber) },
        /* The pack draws this one as "Coming soon" and so does this: `Me`
           carries a locale and a timezone, but nothing can change them yet,
           and a control that cannot act is worse than an honest label. */
        { label: "Language & timezone", value: "Coming soon", pending: true },
      ]}
    />
  );

  if (collapsed) {
    return (
      <div className="flex h-topbar shrink-0 flex-col items-center justify-center gap-0.5">
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={me.name}
          className={cn("shrink-0 rounded-pill", FOCUS_RING)}
        >
          <Avatar name={me.name} size={26} />
          <span className="sr-only">{me.name}</span>
        </button>

        {collapseControl}
        {modal}
      </div>
    );
  }

  return (
    <div className="flex h-topbar shrink-0 items-center gap-1.5">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 rounded-control px-2 py-1 text-left hover:bg-surface-hover",
          FOCUS_RING,
        )}
      >
        <Avatar name={me.name} size={26} />
        <span className="min-w-0 flex-1">
          {/* Explicit leading on both lines. `text-[13px]` sets a font size and
              nothing else, so the stack's height would otherwise come from the
              body's 1.5 and drift the moment that changes — and this stack has
              to fit a band it does not own. 18 + 15 = 33. */}
          <span className="block truncate text-[13px] font-medium leading-[18px] text-ink">
            {me.name}
          </span>
          <span className="block truncate text-[11px] leading-[15px] text-ink-muted">
            {ROLE_LABEL[me.role]}
          </span>
        </span>
      </button>

      {collapseControl}
      {modal}
    </div>
  );
}
