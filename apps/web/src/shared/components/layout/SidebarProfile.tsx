import { useState } from "react";
import { cn } from "@/shared/lib/utils";
import { Avatar, ProfileModal, toast } from "@/shared/components/kit";
import { FOCUS_RING } from "@/shared/components/kit/tokens";
import { ROLE_LABEL, scopeLabels } from "@/shared/config/roles";
import { useAuth } from "@/shared/auth";
import { useMe } from "@/shared/hooks/useMe";
import { useMeProfile } from "./useMeProfile";
import { ThemeSwitch } from "./ThemeSwitch";
import { VERSION_LINE } from "./version";

/**
 * Who you are, at the TOP of the rail, with the theme switch beside you.
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
 * ── THE SWITCH IS BACK, AND THE COLLAPSE CONTROL IS WHAT LEFT ────────────
 *
 * 64d464d put a 24px collapse control in this band's top right and paid for it
 * by moving the theme switch into the profile modal. That was the wrong half
 * to spend: the theme is the preference people change most and the rail is a
 * thing they set once. Measured at 1440, the band's content box is 216px, and
 * the avatar (26), the button's own padding (16) and gap (8), the switch (61)
 * and one 6px row gap leave 99px of text — enough for every role label and for
 * "Alex Selvarajah", the product's own primary user, at 13/500. Add the
 * control and its second gap back and the text drops to 69px, which truncated
 * both lines. So the control moved out of the band entirely and onto the MAIN
 * caption row, where 216px of otherwise-empty row was already being drawn
 * (`Sidebar.tsx`).
 *
 * Changing the theme is one click from the row it describes, and it is not
 * inside a menu — which is what it was before, and what the pack draws.
 *
 * Collapsed, the rail is 64px and holds neither: the band is the avatar alone,
 * and one click anywhere on the rail opens it back up.
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
}

export function SidebarProfile({ collapsed }: SidebarProfileProps) {
  const { me } = useMe();
  /* `null` over fixtures, where there is no session to end and the modal's
     sign-out stays drawn-but-inert exactly as before. */
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  /* Not fetched until the modal is opened — see `useMeProfile`. */
  const profile = useMeProfile(open);
  const details = profile.data;

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
        details === undefined
          ? placeholder
          : `${details.tenant.name}${details.location ? ` · ${details.location}` : ""}`
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
      onSignOut={
        auth === null
          ? undefined
          : () => {
              setOpen(false);
              /* supabase-js keeps the session when a local sign-out fails (a
                 dropped connection, a 5xx). The modal has already closed, so
                 the reader is no longer looking at the button: say so where
                 they are, without the raw error, and offer the retry. */
              const signOut = (): void => {
                void auth.signOut().then(({ error }) => {
                  if (error === null) return;
                  toast.error("You're still signed in", {
                    description: "We couldn't sign you out. Check your connection and try again.",
                    action: { label: "Try again", onClick: signOut },
                  });
                });
              };
              signOut();
            }
      }
    />
  );

  if (collapsed) {
    return (
      <div className="flex h-topbar shrink-0 items-center justify-center">
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={me.name}
          className={cn("shrink-0 rounded-pill", FOCUS_RING)}
        >
          <Avatar name={me.name} size={26} />
          <span className="sr-only">{me.name}</span>
        </button>

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

      <ThemeSwitch />
      {modal}
    </div>
  );
}
