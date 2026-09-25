/**
 * Strokes (CSS-pixel points) -> absolute SVG path data, the format
 * `attendance/signature.ts` validates: `M x y L x y …`, one `M` per stroke.
 * Server-safe (no "use client"), so it can be tested and shared.
 */
export type Point = [number, number];

export function toSvgPath(strokes: Point[][], minStep = 1.5): string {
  const parts: string[] = [];
  const r = (n: number) => (Math.round(n * 10) / 10).toString();
  for (const stroke of strokes) {
    if (stroke.length === 0) continue;
    const kept: Point[] = [stroke[0]];
    for (const p of stroke.slice(1)) {
      const last = kept[kept.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= minStep) kept.push(p);
    }
    const end = stroke[stroke.length - 1];
    if (kept.length === 1 || kept[kept.length - 1] !== end) kept.push(end);
    parts.push(`M ${r(kept[0][0])} ${r(kept[0][1])}${kept.slice(1).map((p) => ` L ${r(p[0])} ${r(p[1])}`).join("")}`);
  }
  return parts.join(" ");
}
