"use client";

import { useRef, useState } from "react";
import { KitButton, SecondaryButton, StatusChip } from "@/components/kit";
import { useActionRunner } from "@/components/actions/ActionButton";
import { UniverSheet, type UniverSheetHandle } from "@/components/univer/UniverSheet";
import { formatRM } from "@/lib/money";
import type { ActionResult } from "@/server/domain/errors";

interface PreviewView {
  quotedFee: number;
  allowableCap: number;
  totalDirectCost: number;
  grossMargin: number;
  marginPct: number;
  warnings: string[];
  snapshot: Record<string, unknown>;
}

/**
 * HITL Gate 1 — the quotation canvas. The operator edits the tinted input
 * cells (trainer day rate, venue DDR, materials, other costs, fee override);
 * "Recalculate" sends ONLY those inputs to the server, where the headless
 * Univer engine and the independent L0 model both recompute and must agree to
 * the sen. The browser's own formula results are never trusted. "Approve &
 * dispatch" is the view's one solid button and exists only for a version that
 * is awaiting approval.
 */
export function QuoteDesk({
  code,
  snapshot,
  editable,
  quotationId,
  awaitingApproval,
  recompute,
  saveRevision,
  approve,
}: {
  code: string;
  snapshot: Record<string, unknown> | null;
  editable: Array<{ name: string; cell: string }>;
  quotationId: string | null;
  awaitingApproval: boolean;
  recompute: (code: string, edits: Record<string, unknown>) => Promise<ActionResult<PreviewView>>;
  saveRevision: (code: string, edits: Record<string, unknown>) => Promise<ActionResult<unknown>>;
  approve: (code: string, quotationId: string) => Promise<ActionResult<unknown>>;
}) {
  const sheet = useRef<UniverSheetHandle>(null);
  const [current, setCurrent] = useState(snapshot);
  const [preview, setPreview] = useState<PreviewView | null>(null);
  const [dirty, setDirty] = useState(false);
  const { pending, runAction } = useActionRunner();

  const edits = () => {
    const values = sheet.current?.read(editable.map((e) => e.cell)) ?? {};
    return Object.fromEntries(editable.map((e) => [e.name, values[e.cell]]).filter(([, v]) => v !== null && v !== ""));
  };

  return (
    <div className="flex flex-col gap-3">
      <UniverSheet ref={sheet} snapshot={current} inputCells={editable.map((e) => e.cell)} height={470} />
      {preview ? (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-panel border border-primary-border bg-ai-tint px-3.5 py-2.5 text-[13px]">
          <span className="font-medium text-ink">Server recompute</span>
          <span>Fee {formatRM(preview.quotedFee)}</span>
          <span>Cap {formatRM(preview.allowableCap)}</span>
          <span>Direct cost {formatRM(preview.totalDirectCost)}</span>
          <span>Margin {formatRM(preview.grossMargin)} · {preview.marginPct.toFixed(2)}%</span>
          {preview.warnings.map((w) => (
            <StatusChip key={w} tone={w === "NEGATIVE_MARGIN" ? "danger" : "warning"} shape="square" className="text-[11px]">
              {w}
            </StatusChip>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <SecondaryButton
          busy={pending}
          disabled={!current}
          onClick={() =>
            runAction("Recalculate", () => recompute(code, edits()), (result) => {
              if (result.ok && result.data) {
                setPreview(result.data as PreviewView);
                setCurrent((result.data as PreviewView).snapshot);
                setDirty(true);
              }
            })
          }
        >
          Recalculate on server
        </SecondaryButton>
        <SecondaryButton busy={pending} disabled={!dirty} onClick={() => runAction("Save revision", () => saveRevision(code, edits()), (r) => r.ok && setDirty(false))}>
          Save as new version
        </SecondaryButton>
        <span className="text-[12px] text-ink-muted">{dirty ? "Unsaved edits — save them as a version before approving." : "Tinted cells are editable inputs; everything else is formula."}</span>
        <div className="ml-auto">
          <KitButton kind="primary" busy={pending} disabled={!awaitingApproval || dirty || !quotationId} onClick={() => quotationId && runAction("Approve & dispatch", () => approve(code, quotationId))}>
            Approve &amp; dispatch
          </KitButton>
        </div>
      </div>
    </div>
  );
}
