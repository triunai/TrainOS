/**
 * The fold that turns a pipeline's configuration and its records into lanes.
 *
 * Beside `KanbanBoard` rather than inside it, the way `calendar.ts` sits beside
 * `CalendarGrid`: a pure helper exported from a component file costs that file
 * its fast refresh, and the kit has kept those apart since it shipped.
 */

/**
 * Group `items` into one bucket per stage, ordered by the stage's own `order`.
 *
 * Three properties every board depends on and none should re-derive:
 *
 *  - the order is the SERVER's. Sorting here rather than trusting the array's
 *    arrival order is what makes "stage names and order render from pipeline
 *    configuration" structural instead of stated.
 *  - a stage holding nothing still gets a bucket. The empty stage is the one a
 *    sales manager most wants to see, and a board that drops it draws a
 *    pipeline healthier than the one that exists.
 *  - an item whose stage the configuration does not name lands in NO bucket,
 *    silently. That is deliberate and it is only half the answer: the caller
 *    must count the difference and surface it, because dropping such a record
 *    without saying so would make a board's total disagree with its own count
 *    and nobody would know which record went missing (R14).
 */
export function lanesFrom<S extends { key: string; label: string; order: number }, T>(
  stages: S[],
  items: T[],
  stageOf: (item: T) => string,
): { stage: S; items: T[] }[] {
  const ordered = [...stages].sort((left, right) => left.order - right.order);
  const byStage = new Map<string, T[]>(ordered.map((stage) => [stage.key, []]));
  for (const item of items) byStage.get(stageOf(item))?.push(item);
  return ordered.map((stage) => ({ stage, items: byStage.get(stage.key) ?? [] }));
}
