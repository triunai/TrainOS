"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Banner, GhostButton, PrimaryButton, TextInput } from "@/components/kit";
import { cn } from "@/lib/cn";
import { type PublicResult, explain, timeOfDayMY } from "./publicCopy";

/**
 * The page a projected room QR opens. Step 1: tap your name (names only —
 * the roster never carries an IC number to this page). Step 2: type the last
 * four characters of your IC or passport. A match returns a one-time check-in
 * link for this day and session, and the phone goes straight to it.
 */
export interface SessionRosterView {
  packageTitle: string;
  dayIndex: number;
  session: "AM" | "PM";
  dateLabel: string | null;
  expiresAt: string;
  participants: Array<{ id: string; name: string }>;
}

export function SessionQrIdentify({
  token,
  roster,
  identify,
}: {
  token: string;
  roster: SessionRosterView;
  identify: (token: string, participantId: string, nricLast4: string) => Promise<PublicResult<{ path: string }>>;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<{ id: string; name: string } | null>(null);
  const [last4, setLast4] = useState("");
  const [error, setError] = useState<{ code: string; details?: Record<string, unknown> } | null>(null);
  const [pending, start] = useTransition();
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? roster.participants.filter((p) => p.name.toLowerCase().includes(q)) : roster.participants;
  }, [query, roster.participants]);

  const submit = () => {
    if (!chosen || last4.length !== 4) return;
    setError(null);
    start(async () => {
      const result = await identify(token, chosen.id, last4);
      if (result.ok) router.push(result.data.path);
      else setError({ code: result.code, details: result.details });
    });
  };
  const problem = error ? explain(error.code, error.details, "room") : null;
  const sessionName = roster.session === "AM" ? "Morning session" : "Afternoon session";

  return (
    <div className="mt-2 flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <p className="text-[12px] font-medium text-ink-muted">Room check-in</p>
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.015em] text-ink">{roster.packageTitle}</h1>
        <p className="text-[14px] text-ink-secondary">
          Day {roster.dayIndex} · {sessionName}
          {roster.dateLabel ? ` · ${roster.dateLabel}` : ""}
        </p>
      </header>

      {!chosen ? (
        <section className="flex flex-col rounded-card border border-border bg-card shadow-card">
          <div className="flex flex-col gap-2 border-b border-divider p-4">
            <p className="text-[16px] font-semibold text-ink">1 · Tap your name</p>
            <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your name" aria-label="Search your name" className="h-11 text-[15px]" />
          </div>
          <ul aria-label="Participants" className="max-h-[52vh] overflow-y-auto">
            {shown.map((p) => (
              <li key={p.id} className="border-b border-divider last:border-b-0">
                <button type="button" onClick={() => { setChosen(p); setLast4(""); setError(null); }} className="flex w-full items-center justify-between px-4 py-3.5 text-left text-[15px] text-ink hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
                  {p.name}
                  <span aria-hidden="true" className="text-ink-muted">›</span>
                </button>
              </li>
            ))}
            {shown.length === 0 ? <li className="px-4 py-4 text-[14px] text-ink-muted">No name matches. Ask the trainer to check the roster.</li> : null}
          </ul>
        </section>
      ) : (
        <section className="flex flex-col gap-3 rounded-card border border-border bg-card p-4 shadow-card">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 text-[16px] font-semibold text-ink">2 · Confirm it is you</p>
            <GhostButton onClick={() => setChosen(null)}>Not me</GhostButton>
          </div>
          <p className="text-[15px] text-ink">{chosen.name}</p>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] text-ink-secondary">Last 4 digits of your IC (or passport)</span>
            <TextInput
              value={last4}
              onChange={(e) => setLast4(e.target.value.replace(/[^0-9a-z]/gi, "").toUpperCase().slice(0, 4))}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              inputMode="text"
              autoComplete="off"
              autoCapitalize="characters"
              maxLength={4}
              placeholder="e.g. 5561"
              aria-label="Last 4 digits of your IC"
              className={cn("h-12 text-center font-mono text-[22px] tracking-[0.4em]")}
            />
          </label>
          {problem ? (
            <Banner tone={problem.retry ? "warning" : "danger"} title={problem.title}>
              {problem.body}
            </Banner>
          ) : null}
          <PrimaryButton className="w-full py-3 text-[15px]" busy={pending} disabled={last4.length !== 4} onClick={submit}>
            {pending ? "Checking…" : "Continue to sign"}
          </PrimaryButton>
        </section>
      )}
      <p className="text-center text-[12px] text-ink-muted">This room code refreshes every 20 minutes (current one until {timeOfDayMY(roster.expiresAt)}). Your IC number is never shown here.</p>
    </div>
  );
}
