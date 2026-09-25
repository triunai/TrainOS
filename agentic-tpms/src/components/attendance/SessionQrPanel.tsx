"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Field, GhostButton, IconButton, SecondaryButton, Select } from "@/components/kit";
import { useActionRunner } from "@/components/actions/ActionButton";
import type { ActionResult } from "@/server/domain/errors";

/**
 * The room display: a session QR for one day and session, projected on the
 * wall. Participants scan it, pick their name, type the last four characters
 * of their NRIC and sign on their own phone. A QR lives 20 minutes; while it
 * is projected the panel re-issues it a minute before it lapses, so the wall
 * never shows a dead code. The countdown runs from when the browser received
 * the code (not from the laptop's clock), so clock drift cannot expire it early.
 */
export interface SessionQrView {
  url: string;
  qrDataUrl: string;
  expiresAt: string;
  ttlMs: number;
  dayIndex: number;
  session: "AM" | "PM";
  date: string;
}

const SESSION_TEXT = { AM: "Morning session", PM: "Afternoon session" } as const;

function remaining(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function SessionQrPanel({
  code,
  title,
  days,
  defaultDay,
  defaultSession,
  issue,
}: {
  code: string;
  title: string;
  days: Array<{ dayIndex: number; label: string }>;
  defaultDay: number;
  defaultSession: "AM" | "PM";
  issue: (code: string, dayIndex: number, session: string) => Promise<ActionResult<SessionQrView>>;
}) {
  const [day, setDay] = useState(defaultDay);
  const [session, setSession] = useState<"AM" | "PM">(defaultSession);
  const [qr, setQr] = useState<(SessionQrView & { deadline: number }) | null>(null);
  const [presenting, setPresenting] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const { pending, runAction } = useActionRunner();
  const refreshing = useRef(false);

  const generate = useCallback(
    (d: number, s: "AM" | "PM") =>
      runAction("Session QR", () => issue(code, d, s), (result) => {
        if (result.ok) {
          const data = (result as { ok: true; data: SessionQrView }).data;
          setQr({ ...data, deadline: Date.now() + data.ttlMs });
        }
      }),
    [code, issue, runAction],
  );

  useEffect(() => {
    if (!qr) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [qr]);

  // While projected, re-issue a minute before the code lapses — quietly: no toast on the wall.
  const [refreshError, setRefreshError] = useState<string | null>(null);
  useEffect(() => {
    if (!presenting || !qr || refreshing.current) return;
    if (qr.deadline - now < 60_000) {
      refreshing.current = true;
      issue(code, qr.dayIndex, qr.session)
        .then((result) => {
          if (result.ok) {
            setRefreshError(null);
            setQr({ ...result.data, deadline: Date.now() + result.data.ttlMs });
          } else {
            setRefreshError(result.message);
          }
        })
        .catch((e: unknown) => setRefreshError(e instanceof Error ? e.message : String(e)))
        .finally(() => {
          refreshing.current = false;
        });
    }
  }, [presenting, qr, now, code, issue]);

  useEffect(() => {
    if (!presenting) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPresenting(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presenting]);

  const left = qr ? qr.deadline - now : 0;
  const expired = qr !== null && left <= 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Day" className="w-[210px]">
          <Select value={day} onChange={(e) => setDay(Number(e.target.value))}>
            {days.map((d) => (
              <option key={d.dayIndex} value={d.dayIndex}>
                {d.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Session" className="w-[240px]">
          <Select value={session} onChange={(e) => setSession(e.target.value as "AM" | "PM")}>
            <option value="AM">Morning · 07:00–13:00</option>
            <option value="PM">Afternoon · 13:00–18:30</option>
          </Select>
        </Field>
        <SecondaryButton busy={pending} onClick={() => generate(day, session)}>
          {qr ? "New QR" : "Show room QR"}
        </SecondaryButton>
      </div>

      {qr ? (
        <div className="flex flex-wrap items-start gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL PNG from the server */}
          <img src={qr.qrDataUrl} alt={`Session check-in QR code, Day ${qr.dayIndex} ${SESSION_TEXT[qr.session]}`} width={240} height={240} className="rounded-panel border border-border" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-[13px]">
            <p className="font-medium text-ink">
              Day {qr.dayIndex} · {SESSION_TEXT[qr.session]}
            </p>
            <p className="text-ink-secondary">{expired ? "Expired — show a new QR." : `Valid for ${remaining(left)} · refreshes itself while projected`}</p>
            <p className="break-all font-mono text-[11px] text-ink-muted">{qr.url}</p>
            <div className="pt-1">
              <SecondaryButton onClick={() => setPresenting(true)} disabled={expired}>
                Project full screen
              </SecondaryButton>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-[12px] text-ink-muted">One code per day and session. Participants who lost their personal link sign in from the wall.</p>
      )}

      {presenting && qr
        ? createPortal(
            <div role="dialog" aria-modal="true" aria-label="Room check-in QR" className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-card p-8 text-center">
              <div className="absolute right-4 top-4">
                <IconButton label="Close projection" icon="✕" onClick={() => setPresenting(false)} />
              </div>
              <p className="text-[18px] font-medium text-ink-secondary">{title}</p>
              <p className="text-[34px] font-semibold tracking-[-0.02em] text-ink">
                Day {qr.dayIndex} · {SESSION_TEXT[qr.session]} — scan to sign in
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL PNG from the server */}
              <img src={qr.qrDataUrl} alt="Session check-in QR code" className="aspect-square h-[min(62vh,80vw)] rounded-card border border-border" />
              <p className="text-[16px] text-ink-secondary">Pick your name, type the last 4 digits of your IC, then sign with your finger.</p>
              <p className="font-mono text-[13px] text-ink-muted">
                {refreshError ? `could not refresh: ${refreshError}` : left <= 60_000 ? "refreshing…" : `code refreshes in ${remaining(left - 60_000)}`} · {code}
              </p>
              <GhostButton onClick={() => setPresenting(false)}>Close (Esc)</GhostButton>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
