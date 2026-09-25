"use client";

import { type PointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { GhostButton } from "@/components/kit";
import { type Point, toSvgPath } from "./signaturePath";

/**
 * Finger/stylus signature capture for the public check-in page. Pointer
 * events on a canvas (touch, pen and mouse alike), strokes kept in CSS-pixel
 * coordinates and serialised as absolute SVG path data — `M x y L x y …`, one
 * `M` per stroke — which is exactly what `attendance/signature.ts` validates
 * and what the digital Form T3 renders into its cell. Points closer than
 * ~1.5 px are dropped and coordinates rounded to 0.1 px, so a long signature
 * stays far below the 20 KB limit; if it still would not, the path is
 * re-thinned before it is handed up. The server decides whether it is a real
 * signature; this component only reports what was drawn.
 */
const MAX_BYTES = 20 * 1024;

export function SignaturePad({ onChange, disabled, label = "Signature pad — sign with your finger" }: { onChange: (path: string | null) => void; disabled?: boolean; label?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Point[][]>([]);
  const drawing = useRef<number | null>(null);
  const [count, setCount] = useState(0);

  const ink = () => {
    const css = getComputedStyle(document.documentElement);
    // Token colours are CSS variables; the canvas needs a literal, so read the token.
    return `rgb(${css.getPropertyValue("--ink").trim().split(/\s+/).join(",")})`;
  };

  const redraw = useCallback(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.strokeStyle = ink();
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const stroke of strokes.current) {
      if (stroke.length === 0) continue;
      ctx.beginPath();
      ctx.moveTo(stroke[0][0], stroke[0][1]);
      if (stroke.length === 1) ctx.lineTo(stroke[0][0] + 0.1, stroke[0][1] + 0.1);
      for (const [x, y] of stroke.slice(1)) ctx.lineTo(x, y);
      ctx.stroke();
    }
  }, []);

  const emit = useCallback(() => {
    setCount(strokes.current.length);
    if (strokes.current.length === 0) return onChange(null);
    let step = 1.5;
    let path = toSvgPath(strokes.current, step);
    while (new TextEncoder().encode(path).length > MAX_BYTES && step < 24) {
      step *= 1.6;
      path = toSvgPath(strokes.current, step);
    }
    onChange(path);
  }, [onChange]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const fit = () => {
      const ratio = window.devicePixelRatio || 1;
      const rect = el.getBoundingClientRect();
      el.width = Math.round(rect.width * ratio);
      el.height = Math.round(rect.height * ratio);
      redraw();
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [redraw]);

  const at = (e: PointerEvent<HTMLCanvasElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="relative rounded-panel border border-border-strong bg-card">
        <canvas
          ref={canvas}
          role="img"
          aria-label={label}
          className="block h-[180px] w-full touch-none select-none"
          style={{ cursor: disabled ? "not-allowed" : "crosshair" }}
          onPointerDown={(e) => {
            if (disabled || drawing.current !== null) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            drawing.current = e.pointerId;
            strokes.current = [...strokes.current, [at(e)]];
            redraw();
          }}
          onPointerMove={(e) => {
            if (drawing.current !== e.pointerId) return;
            const events = typeof e.nativeEvent.getCoalescedEvents === "function" ? e.nativeEvent.getCoalescedEvents() : [];
            const rect = e.currentTarget.getBoundingClientRect();
            const points: Point[] = events.length ? events.map((c) => [c.clientX - rect.left, c.clientY - rect.top]) : [at(e)];
            strokes.current[strokes.current.length - 1].push(...points);
            redraw();
          }}
          onPointerUp={(e) => {
            if (drawing.current !== e.pointerId) return;
            drawing.current = null;
            emit();
          }}
          onPointerCancel={(e) => {
            if (drawing.current !== e.pointerId) return;
            drawing.current = null;
            emit();
          }}
        />
        {count === 0 ? (
          <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[13px] text-ink-muted">
            Sign here with your finger
          </span>
        ) : null}
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-6 bottom-9 border-b border-dashed border-border-strong" />
      </div>
      <div className="flex items-center gap-1">
        <GhostButton
          disabled={disabled || count === 0}
          onClick={() => {
            strokes.current = strokes.current.slice(0, -1);
            redraw();
            emit();
          }}
        >
          Undo stroke
        </GhostButton>
        <GhostButton
          disabled={disabled || count === 0}
          onClick={() => {
            strokes.current = [];
            redraw();
            emit();
          }}
        >
          Clear
        </GhostButton>
      </div>
    </div>
  );
}
