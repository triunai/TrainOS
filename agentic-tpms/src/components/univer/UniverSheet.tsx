"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import "@univerjs/preset-sheets-core/lib/index.css";

/**
 * The embedded Univer spreadsheet canvas (HITL surfaces: the Gate 1 quote
 * worksheet, the attendance exception grid).
 *
 * It renders a workbook SNAPSHOT that the server produced with the headless
 * Univer engine, so the operator sees the exact formulas the price was
 * computed with. Edits are collected from named input cells and sent back;
 * the server re-runs both pricing engines — a formula typed into the browser
 * is never trusted as the result.
 *
 * Univer touches `window` at import time, so it is loaded inside the effect.
 */
export interface UniverSheetHandle {
  /** Current values of the given A1 cells on the first sheet. */
  read: (cells: string[]) => Record<string, string | number | null>;
}

export interface UniverSheetProps {
  snapshot: Record<string, unknown> | null;
  height?: number;
  /** Cells to paint as editable inputs (a light tint); everything else is formula/output. */
  inputCells?: string[];
  /** Cells to flag (e.g. an attendance slot needing review). */
  flaggedCells?: string[];
  readOnly?: boolean;
}

type AnyApi = {
  createWorkbook: (data: Record<string, unknown>) => {
    getActiveSheet: () => {
      getRange: (a1: string) => {
        getValue: () => unknown;
        setBackgroundColor: (c: string) => unknown;
        setFontWeight?: (w: string) => unknown;
      };
    };
  };
  dispose?: () => void;
};

export const UniverSheet = forwardRef<UniverSheetHandle, UniverSheetProps>(function UniverSheet(
  { snapshot, height = 440, inputCells = [], flaggedCells = [], readOnly },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<ReturnType<ReturnType<AnyApi["createWorkbook"]>["getActiveSheet"]> | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    read: (cells) => {
      const out: Record<string, string | number | null> = {};
      for (const cell of cells) {
        const value = sheetRef.current?.getRange(cell).getValue();
        out[cell] = typeof value === "number" || typeof value === "string" ? value : value == null ? null : String(value);
      }
      return out;
    },
  }));

  useEffect(() => {
    if (!snapshot || !host.current) return;
    let disposed = false;
    let univer: { dispose: () => void } | null = null;
    (async () => {
      try {
        const [{ createUniver, LocaleType }, { mergeLocales }, { UniverSheetsCorePreset }, enUS] = await Promise.all([
          import("@univerjs/presets"),
          import("@univerjs/core"),
          import("@univerjs/preset-sheets-core"),
          import("@univerjs/preset-sheets-core/locales/en-US"),
        ]);
        if (disposed || !host.current) return;
        const created = createUniver({
          locale: LocaleType.EN_US,
          locales: { [LocaleType.EN_US]: mergeLocales(enUS.default) },
          presets: [
            UniverSheetsCorePreset({
              container: host.current,
              header: !readOnly,
              toolbar: !readOnly,
              footer: false,
              contextMenu: !readOnly,
            }),
          ],
        });
        univer = created.univer as unknown as { dispose: () => void };
        const api = created.univerAPI as unknown as AnyApi;
        const workbook = api.createWorkbook(snapshot);
        const sheet = workbook.getActiveSheet();
        sheetRef.current = sheet;
        // Token colours are CSS variables; the canvas needs literal values, so
        // read the computed tokens rather than hardcoding a second palette.
        // Univer paints on an always-white canvas, so the host is a light
        // island (tokens.css): read ITS tokens, not the page's, or a dark-mode
        // fill lands on white and the cell text becomes unreadable.
        const css = getComputedStyle(host.current);
        const token = (name: string) => `rgb(${css.getPropertyValue(name).trim().split(/\s+/).join(",")})`;
        for (const cell of inputCells) sheet.getRange(cell).setBackgroundColor(token("--ai-tint-2"));
        for (const cell of flaggedCells) sheet.getRange(cell).setBackgroundColor(token("--warning-fill"));
        setStatus("ready");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      }
    })();
    return () => {
      disposed = true;
      sheetRef.current = null;
      try {
        univer?.dispose();
      } catch {
        /* already torn down */
      }
    };
    // The snapshot identity is the trigger; cell lists are read once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, readOnly]);

  return (
    <div className="relative overflow-hidden rounded-panel border border-border" style={{ height }}>
      <div ref={host} data-theme="light" className="univer-host" style={{ height }} />
      {status !== "ready" ? (
        <div className="absolute inset-0 flex items-center justify-center bg-card text-[13px] text-ink-muted">
          {status === "loading" ? (snapshot ? "Loading the spreadsheet canvas…" : "No worksheet yet") : `Canvas failed to load: ${error}`}
        </div>
      ) : null}
    </div>
  );
});
