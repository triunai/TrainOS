"use client";

import { useCallback, useState, useTransition } from "react";
import { Banner, PrimaryButton, StatusChip, type StatusTone } from "@/components/kit";
import { dayMY } from "@/lib/dates";
import { type PublicResult, explain, timeOfDayMY, whenMY } from "./publicCopy";
import { SignaturePad } from "./SignaturePad";

/**
 * The participant's check-in, on their own phone. Shows the programme, the
 * session open right now (or when the next one opens), whether it is signed
 * already, and a signature pad. Submitting records one Track A signature for
 * that day and session; a second submit is answered "already signed", never a
 * duplicate. Every refusal is explained in plain language (publicCopy).
 */
export interface CheckInSessionView {
  session: "AM" | "PM";
  opensAt: string;
  closesAt: string;
  open: boolean;
  signed: boolean;
}

export interface CheckInContextView {
  participantName: string;
  packageTitle: string;
  packageCode: string;
  expiresAt: string;
  boundTo: { dayIndex: number; session: "AM" | "PM" } | null;
  current: { dayIndex: number; session: "AM" | "PM" } | null;
  days: Array<{ dayIndex: number; date: string; sessions: CheckInSessionView[] }>;
}

export interface CheckInDone {
  participantName: string;
  dayIndex: number;
  session: "AM" | "PM";
  alreadySigned: boolean;
  signedAt: string;
}

const SESSION_NAME = { AM: "Morning session", PM: "Afternoon session" } as const;

function slotState(s: CheckInSessionView, now: number): { label: string; tone: StatusTone } {
  if (s.signed) return { label: "signed", tone: "success" };
  if (s.open) return { label: "open now", tone: "info" };
  if (new Date(s.closesAt).getTime() <= now) return { label: "no e-signature", tone: "neutral" };
  return { label: `opens ${timeOfDayMY(s.opensAt)}`, tone: "neutral" };
}

export function CheckInFlow({
  token,
  context,
  serverNow,
  checkIn,
}: {
  token: string;
  context: CheckInContextView;
  serverNow: string;
  checkIn: (token: string, dayIndex: number, session: string, signature: string) => Promise<PublicResult<CheckInDone>>;
}) {
  const [path, setPath] = useState<string | null>(null);
  const [done, setDone] = useState<CheckInDone | null>(null);
  const [error, setError] = useState<{ code: string; details?: Record<string, unknown> } | null>(null);
  const [pending, start] = useTransition();
  const now = new Date(serverNow).getTime();
  // A new stroke answers the last refusal; its banner goes.
  const onSignature = useCallback((next: string | null) => {
    setPath(next);
    setError(null);
  }, []);

  const current = context.current;
  const currentDay = current ? context.days.find((d) => d.dayIndex === current.dayIndex) : undefined;
  const currentSlot = current ? currentDay?.sessions.find((s) => s.session === current.session) : undefined;
  const next = context.days
    .flatMap((d) => d.sessions.map((s) => ({ ...s, dayIndex: d.dayIndex })))
    .filter((s) => !s.signed && new Date(s.opensAt).getTime() > now)
    .filter((s) => !context.boundTo || (s.dayIndex === context.boundTo.dayIndex && s.session === context.boundTo.session))[0];

  const submit = () => {
    if (!current || !path) return;
    setError(null);
    start(async () => {
      const result = await checkIn(token, current.dayIndex, current.session, path);
      if (result.ok) setDone(result.data);
      else setError({ code: result.code, details: result.details });
    });
  };

  const problem = error ? explain(error.code, error.details) : null;

  return (
    <div className="mt-2 flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <p className="text-[12px] font-medium text-ink-muted">Attendance check-in</p>
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.015em] text-ink">{context.packageTitle}</h1>
        <p className="text-[14px] text-ink-secondary">{context.participantName}</p>
      </header>

      {done ? (
        <section className="flex flex-col items-start gap-2 rounded-card border border-border bg-card p-5 shadow-card" aria-live="polite">
          <StatusChip tone="success" live glyph="✓">
            {done.alreadySigned ? "Already signed in" : "Signed in"}
          </StatusChip>
          <p className="text-[18px] font-semibold text-ink">
            Day {done.dayIndex} · {SESSION_NAME[done.session]}
          </p>
          <p className="text-[14px] text-ink-secondary">
            {done.alreadySigned ? "You had already signed in for this session at " : "Your attendance was recorded at "}
            <span className="font-medium text-ink">{timeOfDayMY(done.signedAt)}</span> (Malaysia time), {dayMY(done.signedAt)}.
          </p>
          <p className="text-[13px] text-ink-muted">You can close this page. Use the same link for your next session.</p>
        </section>
      ) : current && currentSlot ? (
        <section className="flex flex-col gap-3 rounded-card border border-border bg-card p-4 shadow-card">
          <div className="flex flex-col gap-0.5">
            <p className="text-[12px] font-medium text-ink-muted">Open now</p>
            <p className="text-[18px] font-semibold text-ink">
              Day {current.dayIndex} · {SESSION_NAME[current.session]}
            </p>
            <p className="text-[13px] text-ink-secondary">
              {currentDay ? dayMY(currentSlot.opensAt) : ""} · sign-in open until {timeOfDayMY(currentSlot.closesAt)}
            </p>
          </div>
          {currentSlot.signed ? (
            <Banner tone="success" title="You are already signed in for this session">
              Nothing more to do. Use the same link for your next session.
            </Banner>
          ) : (
            <>
              <SignaturePad onChange={onSignature} disabled={pending} />
              <p className="text-[12px] text-ink-muted">
                By signing you confirm you attended this session. Your signature is placed on the HRD Corp attendance register (Form T3) for this programme.
              </p>
              {problem ? (
                <Banner tone={problem.retry ? "warning" : "danger"} title={problem.title}>
                  {problem.body}
                </Banner>
              ) : null}
              <PrimaryButton className="w-full py-3 text-[15px]" busy={pending} disabled={!path} onClick={submit}>
                {pending ? "Signing in…" : "Sign in for this session"}
              </PrimaryButton>
            </>
          )}
        </section>
      ) : (
        <section className="flex flex-col gap-1.5 rounded-card border border-border bg-card p-4 shadow-card">
          <p className="text-[16px] font-semibold text-ink">No session is open for sign-in right now</p>
          <p className="text-[13px] text-ink-secondary">
            {next
              ? `Next: Day ${next.dayIndex} ${SESSION_NAME[next.session].toLowerCase()} — sign-in opens ${whenMY(next.opensAt)} (Malaysia time).`
              : "There are no more sessions to sign for with this link."}
          </p>
        </section>
      )}

      <section className="flex flex-col rounded-card border border-border bg-card">
        <p className="border-b border-divider px-4 py-2.5 text-[12px] font-medium text-ink-muted">Your sessions</p>
        <ul>
          {context.days.map((d) =>
            d.sessions.map((s) => {
              const signedNow = done && done.dayIndex === d.dayIndex && done.session === s.session;
              const state = signedNow ? { label: "signed", tone: "success" as StatusTone } : slotState(s, now);
              return (
                <li key={`${d.dayIndex}-${s.session}`} className="flex items-center gap-3 border-b border-divider px-4 py-2.5 last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] text-ink">
                      Day {d.dayIndex} · {s.session === "AM" ? "Morning" : "Afternoon"}
                    </p>
                    <p className="text-[12px] text-ink-muted">
                      {dayMY(s.opensAt)} · {timeOfDayMY(s.opensAt)}–{timeOfDayMY(s.closesAt)}
                    </p>
                  </div>
                  <StatusChip tone={state.tone}>{state.label}</StatusChip>
                </li>
              );
            }),
          )}
        </ul>
      </section>

      <p className="text-center text-[12px] text-ink-muted">
        {context.boundTo
          ? `This sign-in is for Day ${context.boundTo.dayIndex} ${context.boundTo.session === "AM" ? "morning" : "afternoon"} only and expires at ${timeOfDayMY(context.expiresAt)}.`
          : `This link is personal to you — please do not forward it. It works until ${whenMY(context.expiresAt)}.`}{" "}
        {context.packageCode}
      </p>
    </div>
  );
}
