import { cn } from "@/lib/cn";

/**
 * TPMS addition to the kit (CLAUDE.md: add it to the kit first, then use it).
 * The three volatile variables of a training package — Trainer, Venue, e-TRiS
 * grant — as one row of state dots with words. A dot that encodes a state is
 * one of the sanctioned non-chip shapes for status colour; the word beside it
 * carries the meaning for anyone who cannot see the colour.
 */
export type Light = "green" | "amber" | "red" | "off";

const DOT: Record<Light, string> = {
  green: "bg-success",
  amber: "bg-warning-accent",
  red: "bg-danger",
  off: "border border-border-strong bg-card",
};

const WORD: Record<Light, string> = { green: "ready", amber: "pending", red: "at risk", off: "n/a" };

export interface TrafficLight {
  key: string;
  label: string;
  light: Light;
  detail?: string;
}

export function TrafficLights({ lights, className }: { lights: TrafficLight[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", className)} aria-label="Readiness">
      {lights.map((l) => (
        <li key={l.key} title={l.detail ? `${l.label}: ${l.detail}` : `${l.label}: ${WORD[l.light]}`} className="inline-flex items-center gap-1.5 text-[12px] text-ink-secondary">
          <span aria-hidden="true" className={cn("h-2 w-2 rounded-pill", DOT[l.light])} />
          {l.label}
          <span className="sr-only">{WORD[l.light]}</span>
        </li>
      ))}
    </ul>
  );
}
