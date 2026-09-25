/**
 * Money is carried in integer sen wherever arithmetic happens, and as the
 * database's NUMERIC string at the edges. A float never holds a ringgit value
 * for longer than one parse.
 */
export type Sen = number;

export function toSen(value: string | number | null | undefined): Sen {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) throw new Error(`Not a money value: ${String(value)}`);
  return Math.round(n * 100);
}

export function fromSen(sen: Sen): string {
  const sign = sen < 0 ? "-" : "";
  const abs = Math.abs(Math.round(sen));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function toNumber(value: string | number | null | undefined): number {
  return toSen(value) / 100;
}

export function formatRM(value: string | number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  if (opts.compact) {
    return `RM ${n.toLocaleString("en-MY", { maximumFractionDigits: 0 })}`;
  }
  return `RM ${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function pct(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}
