"use client";

import { useState } from "react";
import { Drawer, Field, GhostButton, IconButton, KitButton, MoneyInput, SecondaryButton, TextInput } from "@/components/kit";
import { useActionRunner } from "@/components/actions/ActionButton";
import { cn } from "@/lib/cn";
import type { ActionResult } from "@/server/domain/errors";

export interface EditableBand {
  minPax: number;
  maxPax: number;
  dailyCap: number;
}

interface Row {
  maxPax: string;
  dailyCap: string;
}

/**
 * Revise one delivery mode's Allowable Cost Matrix bands. Default: publish a
 * NEW version with its own effective date (the old version stays as every
 * quotation priced under it recorded it). Correcting a version in place is
 * offered only while no quotation cites it. Bands are contiguous by
 * construction here — each band starts one above the previous band's top —
 * and the domain re-validates either way.
 */
export function BandEditor({
  policyId,
  version,
  modeLabel,
  basisLabel,
  bands,
  quotations,
  suggestedVersion,
  suggestedEffectiveFrom,
  minEffectiveFrom,
  publish,
  correct,
}: {
  policyId: string;
  version: string;
  modeLabel: string;
  basisLabel: string;
  bands: EditableBand[];
  quotations: number;
  suggestedVersion: string;
  suggestedEffectiveFrom: string;
  minEffectiveFrom: string;
  publish: (fromId: string, input: { version: string; effectiveFrom: string; bands: EditableBand[] }) => Promise<ActionResult<unknown>>;
  correct: (id: string, bands: EditableBand[]) => Promise<ActionResult<unknown>>;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"publish" | "correct">("publish");
  const [label, setLabel] = useState(suggestedVersion);
  const [effectiveFrom, setEffectiveFrom] = useState(suggestedEffectiveFrom);
  const [rows, setRows] = useState<Row[]>(() => bands.map((b) => ({ maxPax: String(b.maxPax), dailyCap: String(b.dailyCap) })));
  const { pending, runAction } = useActionRunner();
  const locked = quotations > 0;

  const minOf = (i: number) => (i === 0 ? 1 : Number(rows[i - 1].maxPax) + 1);
  const toBands = (): EditableBand[] => rows.map((r, i) => ({ minPax: minOf(i), maxPax: Number(r.maxPax), dailyCap: Number(r.dailyCap) }));
  const setRow = (i: number, patch: Partial<Row>) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const submit = () => {
    const next = toBands();
    if (mode === "publish") {
      runAction(`Publish ${label}`, () => publish(policyId, { version: label.trim(), effectiveFrom, bands: next }), (r) => r.ok && setOpen(false));
    } else {
      runAction(`Correct ${version}`, () => correct(policyId, next), (r) => r.ok && setOpen(false));
    }
  };

  return (
    <>
      <SecondaryButton onClick={() => setOpen(true)}>Revise bands</SecondaryButton>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={`Revise ${modeLabel} bands`}
        subtitle={`${version} · ${basisLabel}`}
        width="520px"
        footer={
          <>
            <KitButton kind="primary" busy={pending} onClick={submit}>
              {mode === "publish" ? `Publish ${label.trim() || "version"}` : `Save correction to ${version}`}
            </KitButton>
            <GhostButton onClick={() => setOpen(false)}>Cancel</GhostButton>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="pb-1.5 text-[12px] font-medium text-ink-muted">How should this change land?</legend>
            <label className="flex items-start gap-2 text-[13px] text-ink">
              <input type="radio" name="bandMode" className="mt-1 h-3.5 w-3.5 accent-primary" checked={mode === "publish"} onChange={() => setMode("publish")} />
              <span>
                <span className="font-medium">Publish a new version</span>
                <span className="block text-[12px] text-ink-secondary">
                  {version} stays exactly as it was. The new version prices training that starts on or after its effective date; an unapproved quotation priced under the old caps for such a date is refused at Gate 1 until revised.
                </span>
              </span>
            </label>
            <label className={cn("flex items-start gap-2 text-[13px]", locked ? "text-ink-muted" : "text-ink")}>
              <input type="radio" name="bandMode" className="mt-1 h-3.5 w-3.5 accent-primary" disabled={locked} checked={mode === "correct"} onChange={() => setMode("correct")} />
              <span>
                <span className="font-medium">Correct {version} in place</span>
                <span className="block text-[12px] text-ink-secondary">
                  {locked
                    ? `Not available: ${quotations} quotation${quotations === 1 ? " was" : "s were"} priced under ${version}, so rewriting it would change history.`
                    : "Only for a typo in a version nothing has been priced under yet. Old and new bands go into the audit ledger."}
                </span>
              </span>
            </label>
          </fieldset>

          {mode === "publish" ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="New version label" hint="As the circular names it">
                <TextInput value={label} onChange={(e) => setLabel(e.target.value)} maxLength={32} required />
              </Field>
              <Field label="Effective from" hint={`${minEffectiveFrom} or later`}>
                <TextInput type="date" value={effectiveFrom} min={minEffectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} required />
              </Field>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <p className="text-[12px] font-medium text-ink-muted">Bands · {basisLabel}</p>
            <table className="w-full border-collapse text-[13px]">
              <caption className="sr-only">Headcount bands and daily caps</caption>
              <thead>
                <tr className="border-b border-border text-left text-[12px] text-ink-muted">
                  <th scope="col" className="py-1.5 pr-2 font-medium">From pax</th>
                  <th scope="col" className="py-1.5 pr-2 font-medium">To pax</th>
                  <th scope="col" className="py-1.5 pr-2 font-medium">Daily cap</th>
                  <th scope="col" className="w-8 py-1.5"><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-divider">
                    <td className="py-1.5 pr-2 font-mono text-[12px] tabular-nums text-ink-secondary">{Number.isFinite(minOf(i)) ? minOf(i) : "—"}</td>
                    <td className="py-1.5 pr-2">
                      <TextInput aria-label={`Band ${i + 1} top headcount`} inputMode="numeric" value={r.maxPax} onChange={(e) => setRow(i, { maxPax: e.target.value })} className="w-24" />
                    </td>
                    <td className="py-1.5 pr-2">
                      <MoneyInput aria-label={`Band ${i + 1} daily cap in ringgit`} value={r.dailyCap} onChange={(e) => setRow(i, { dailyCap: e.target.value })} />
                    </td>
                    <td className="py-1.5">
                      <IconButton label={`Remove band ${i + 1}`} icon="✕" disabled={rows.length === 1} onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div>
              <GhostButton
                onClick={() =>
                  setRows((prev) => [...prev, { maxPax: String((Number(prev[prev.length - 1]?.maxPax) || 0) + 10), dailyCap: prev[prev.length - 1]?.dailyCap ?? "" }])
                }
              >
                Add band
              </GhostButton>
            </div>
            <p className="text-[12px] text-ink-muted">Each band starts one above the previous band&apos;s top, so the matrix has no gap and no overlap. Whole ringgit per day, as the circular writes it.</p>
          </div>
        </div>
      </Drawer>
    </>
  );
}
