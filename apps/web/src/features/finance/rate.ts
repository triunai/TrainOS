/**
 * A contract `Rate` as a percentage.
 *
 * The kit has `formatMoney` and `formatDate` and no equivalent for `Rate`, so
 * eleven components currently write `Math.round(x * 100)` inline — a real
 * consolidation candidate under CLAUDE.md, and one that belongs in
 * `shared/components/kit/format.ts` rather than here. It is NOT there yet
 * because `kit/index.ts` is being edited by another lane as this lands, and R9
 * makes taking someone else's in-flight barrel edit under this commit the
 * specific thing to avoid. Raised for the kit lane; moved when the barrel is
 * quiet.
 *
 * One decimal, not zero: a margin of 40.5% and one of 41.4% are different
 * answers to "are we above the floor", and rounding both to 41% hides which.
 */
export function formatRate(rate: number, digits = 1): string {
  return `${(rate * 100).toFixed(digits)}%`;
}
