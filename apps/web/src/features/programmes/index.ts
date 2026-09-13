/**
 * The programmes feature's public surface.
 *
 * Anything another feature or the route table needs comes from here. The
 * dependency-cruiser rule `no-cross-feature-internals` makes that a build
 * error rather than a convention.
 */

export { ProgrammesListPage } from "./ProgrammesListPage";
export { ProgrammeDetailPage } from "./ProgrammeDetailPage";
export { PROGRAMMES_LIST_PATH, PROGRAMME_DETAIL_PATH, PROGRAMME_DETAIL_PATTERN } from "./paths";
export {
  canEditCatalogue,
  /**
   * The catalogue read itself. Exported 13 Sep so the trainer record and the
   * assessments register can join against programmes without growing a third
   * and fourth copy of a four-line `useQuery` — CLAUDE.md's consolidation rule
   * applied to a data hook rather than to a component.
   */
  useProgramme,
  useProgrammes,
} from "./api";
export { dayRange, nearestWindow, poolRows, type PoolRow, type PoolStatus } from "./availability";
