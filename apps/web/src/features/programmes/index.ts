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
export { canEditCatalogue } from "./api";
export { dayRange, nearestWindow, poolRows, type PoolRow, type PoolStatus } from "./availability";
