import type { StepRecord } from "./goldenPath";
import type { TaskTotals } from "./tasks";

/**
 * Plain-text rendering of a golden-path run for the terminal: one row per
 * step (stages before -> after on each machine), then the step's notes,
 * fast-forwards and tasks indented under it. No colour codes, so the output
 * pastes cleanly into a report.
 */
const short = (stage: string | null) => stage ?? "—";

function move(from: string | null, to: string | null): string {
  if (from === to) return to ? `${short(to)}` : "—";
  return `${short(from)} → ${short(to)}`;
}

function pad(text: string, width: number): string {
  return text.length >= width ? `${text.slice(0, width - 1)}…` : text + " ".repeat(width - text.length);
}

export function formatStepRow(r: StepRecord): string[] {
  const head = [
    String(r.index).padStart(2),
    pad(r.step, 18),
    pad(r.operational.to === null && r.lead ? `lead ${move(r.lead.from, r.lead.to)}` : move(r.operational.from, r.operational.to), 44),
    pad(move(r.financial.from, r.financial.to), 34),
    `${(r.ms / 1000).toFixed(1)}s`.padStart(6),
  ].join("  ");
  const lines = [head];
  const indent = "      ";
  for (const f of r.fastForwards) lines.push(`${indent}${f}`);
  for (const n of r.notes) lines.push(`${indent}· ${n}`);
  for (const t of r.tasks) lines.push(`${indent}⚙ ${t}`);
  const ids = Object.entries(r.ids).map(([k, v]) => `${k}=${v.length > 13 && /^[0-9a-f-]{36}$/.test(v) ? v.slice(0, 8) : v}`);
  if (ids.length) lines.push(`${indent}ids: ${ids.join("  ")}`);
  return lines;
}

export function formatStepTable(steps: StepRecord[]): string {
  const header = ["#".padStart(2), pad("step", 18), pad("operational", 44), pad("financial", 34), "time".padStart(6)].join("  ");
  const rule = "─".repeat(header.length);
  return [header, rule, ...steps.flatMap((s) => [...formatStepRow(s), ""])].join("\n");
}

export function formatTaskTotals(label: string, totals: TaskTotals): string[] {
  const status = Object.entries(totals.byStatus)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
  const future = Object.entries(totals.future).map(([k, v]) => `${k} x${v}`).join(", ");
  return [
    `${label}: ${status || "no tasks"}`,
    `  dead-lettered (FAILED): ${totals.deadLettered.length}${totals.deadLettered.length ? ` — ${totals.deadLettered.map((d) => `${d.taskType}: ${d.lastError}`).join("; ")}` : ""}`,
    `  waiting on a retry: ${totals.retrying.length}${totals.retrying.length ? ` — ${totals.retrying.map((d) => `${d.taskType}: ${d.lastError}`).join("; ")}` : ""}`,
    `  queued for a future date: ${future || "none"}`,
  ];
}
