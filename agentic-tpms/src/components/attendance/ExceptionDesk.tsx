"use client";

import { useMemo, useState } from "react";
import { GhostButton, KitButton, Modal, SELECTED_TINT, StatusChip, TextArea } from "@/components/kit";
import { useActionRunner } from "@/components/actions/ActionButton";
import { cn } from "@/lib/cn";
import type { ActionResult } from "@/server/domain/errors";
import { exceptionReason } from "./labels";

/**
 * The exception list beside the Univer grid. Each open slot shows why it needs
 * a human (the extractor's reason and its OCR confidence) and resolves to a
 * MANUAL_OVERRIDE: present or absent, with a required note that goes verbatim
 * into the audit ledger. A reviewed slot resolves its open records together
 * (resolveAttendanceException); a slot with no record at all is recorded by
 * hand (setManualAttendance). Several slots can be settled in one decision.
 */
export interface ExceptionItem {
  key: string;
  participantId: string;
  participantName: string;
  nricMasked: string;
  dayIndex: number;
  session: "AM" | "PM";
  dateLabel: string;
  cell: string | null;
  reasons: string[];
  recordIds: string[];
  confidence: number | null;
  readings: Array<{ track: "A" | "B" | "M"; present: boolean }>;
}

/** A session whose check-in window has not closed yet: its empty slots are not exceptions (yet). */
export interface UpcomingDay {
  key: string;
  label: string;
  detail: string;
}

type Selection = { recordIds: string[]; manual: Array<{ participantId: string; dayIndex: number; session: string }> };

export function ExceptionDesk({
  code,
  items,
  upcoming,
  resolve,
  readOnly,
}: {
  code: string;
  items: ExceptionItem[];
  upcoming: UpcomingDay[];
  resolve: (code: string, selection: Selection, present: boolean, note: string) => Promise<ActionResult<unknown>>;
  readOnly?: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingChoice, setPendingChoice] = useState<{ keys: string[]; present: boolean } | null>(null);
  const [note, setNote] = useState("");
  const { pending, runAction } = useActionRunner();
  const byKey = useMemo(() => new Map(items.map((i) => [i.key, i])), [items]);
  const days = useMemo(() => {
    const groups = new Map<number, ExceptionItem[]>();
    for (const item of items) groups.set(item.dayIndex, [...(groups.get(item.dayIndex) ?? []), item]);
    return [...groups.entries()].sort(([a], [b]) => a - b);
  }, [items]);

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const choose = (keys: string[], present: boolean) => {
    setNote("");
    setPendingChoice({ keys, present });
  };

  const confirm = () => {
    if (!pendingChoice) return;
    const chosen = pendingChoice.keys.map((k) => byKey.get(k)).filter((i): i is ExceptionItem => Boolean(i));
    const selection: Selection = {
      recordIds: chosen.flatMap((i) => i.recordIds),
      manual: chosen.filter((i) => i.recordIds.length === 0).map((i) => ({ participantId: i.participantId, dayIndex: i.dayIndex, session: i.session })),
    };
    runAction(pendingChoice.present ? "Mark present" : "Mark absent", () => resolve(code, selection, pendingChoice.present, note.trim()), (result) => {
      if (result.ok) {
        setPendingChoice(null);
        setSelected(new Set());
      }
    });
  };

  const chosenItems = pendingChoice ? pendingChoice.keys.map((k) => byKey.get(k)).filter((i): i is ExceptionItem => Boolean(i)) : [];
  const noteOk = note.trim().length >= 3;

  return (
    <div className="flex min-w-0 flex-col">
      {items.length > 0 && !readOnly ? (
        <div className="flex min-h-10 items-center gap-2 border-b border-divider px-4 py-1.5">
          <label className="inline-flex items-center gap-2 text-[12px] text-ink-secondary">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-primary"
              checked={selected.size === items.length}
              onChange={(e) => setSelected(e.target.checked ? new Set(items.map((i) => i.key)) : new Set())}
            />
            {selected.size > 0 ? `${selected.size} selected` : "Select all"}
          </label>
          {selected.size > 0 ? (
            <div className="ml-auto flex items-center gap-1">
              <GhostButton className="px-2.5 py-1" onClick={() => choose([...selected], true)}>
                Mark present
              </GhostButton>
              <GhostButton className="px-2.5 py-1" onClick={() => choose([...selected], false)}>
                Mark absent
              </GhostButton>
            </div>
          ) : null}
        </div>
      ) : null}

      {items.length === 0 ? (
        <p className="px-4 py-4 text-[13px] text-ink-muted">No open exceptions — every held session is recorded and settled.</p>
      ) : (
        <ul aria-label="Open attendance exceptions">
          {days.map(([day, list]) => (
            <li key={day}>
              <p className="border-b border-divider bg-surface px-4 py-1.5 text-[12px] font-medium text-ink-muted">
                Day {day} · {list[0].dateLabel} · {list.length} open
              </p>
              <ul>
                {list.map((item) => (
                  <ExceptionRow
                    key={item.key}
                    item={item}
                    selected={selected.has(item.key)}
                    onToggle={() => toggle(item.key)}
                    onChoose={(present) => choose([item.key], present)}
                    readOnly={readOnly}
                  />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {upcoming.length > 0 ? (
        <ul className="border-t border-divider px-4 py-2.5 text-[12px] text-ink-muted">
          {upcoming.map((d) => (
            <li key={d.key}>
              <span className="text-ink-secondary">{d.label}</span> · {d.detail}
            </li>
          ))}
        </ul>
      ) : null}

      <Modal
        open={pendingChoice !== null}
        onClose={() => setPendingChoice(null)}
        title={pendingChoice?.present ? `Mark ${chosenItems.length === 1 ? chosenItems[0].participantName : `${chosenItems.length} slots`} present` : `Mark ${chosenItems.length === 1 ? chosenItems[0].participantName : `${chosenItems.length} slots`} absent`}
        footer={
          <>
            <GhostButton onClick={() => setPendingChoice(null)}>Back</GhostButton>
            <KitButton kind="primary" busy={pending} disabled={!noteOk} onClick={confirm}>
              {pendingChoice?.present ? "Record present" : "Record absent"}
            </KitButton>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
            {chosenItems.map((i) => (
              <li key={i.key} className="text-[13px] text-ink">
                {i.participantName} <span className="text-ink-muted">· Day {i.dayIndex} {i.session}</span>
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-ink-secondary">
            {pendingChoice?.present
              ? "A present override counts toward the 80% HRD Corp eligibility threshold. Only mark present what the trainer or the sheet confirms."
              : "An absent override removes this slot from the participant's attendance rate."}
          </p>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-ink-muted">Why (required)</span>
            <TextArea value={note} onChange={(e) => setNote(e.target.value)} placeholder={pendingChoice?.present ? "Trainer confirmed attendance; signature faint on the scan" : "Participant on medical leave (MC attached)"} />
            <span className="text-[12px] text-ink-muted">Recorded verbatim in the audit ledger as a manual override under your name.</span>
          </label>
        </div>
      </Modal>
    </div>
  );
}

function ExceptionRow({
  item,
  selected,
  onToggle,
  onChoose,
  readOnly,
}: {
  item: ExceptionItem;
  selected: boolean;
  onToggle: () => void;
  onChoose: (present: boolean) => void;
  readOnly?: boolean;
}) {
  const reasons = item.reasons.map(exceptionReason);
  return (
    <li className={cn("flex items-start gap-3 border-b border-divider px-4 py-2.5 last:border-b-0", selected && SELECTED_TINT)}>
      {!readOnly ? (
        <input type="checkbox" aria-label={`Select ${item.participantName} Day ${item.dayIndex} ${item.session}`} className="mt-1 h-3.5 w-3.5 accent-primary" checked={selected} onChange={onToggle} />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[13px] font-medium text-ink">{item.participantName}</span>
          <span className="font-mono text-[11px] text-ink-muted">{item.nricMasked}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] text-ink-secondary">
            {item.session === "AM" ? "Morning" : "Afternoon"}
            {item.cell ? <span className="font-mono text-[11px] text-ink-muted"> · cell {item.cell}</span> : null}
          </span>
          {reasons.map((r) => (
            <StatusChip key={r.label} tone={r.tone} shape="square" className="px-2 py-[1px] text-[11px]">
              {r.label}
            </StatusChip>
          ))}
          {item.confidence !== null ? <span className="text-[11px] tabular-nums text-ink-muted">OCR {Math.round(item.confidence * 100)}%</span> : null}
          {item.readings.length > 0 ? (
            <span className="text-[11px] text-ink-muted">{item.readings.map((r) => `${r.track} ${r.present ? "✓" : "✗"}`).join(" · ")}</span>
          ) : null}
        </div>
        <p className="text-[12px] text-ink-muted">{reasons[0]?.hint}</p>
      </div>
      {!readOnly ? (
        <div className="flex shrink-0 flex-col gap-1">
          <GhostButton className="px-2.5 py-1" onClick={() => onChoose(true)} aria-label={`Mark ${item.participantName} present, Day ${item.dayIndex} ${item.session}`}>
            Present
          </GhostButton>
          <GhostButton className="px-2.5 py-1" onClick={() => onChoose(false)} aria-label={`Mark ${item.participantName} absent, Day ${item.dayIndex} ${item.session}`}>
            Absent
          </GhostButton>
        </div>
      ) : null}
    </li>
  );
}
