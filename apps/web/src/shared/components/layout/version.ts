import appPackage from "../../../../package.json";
import contractPackage from "../../../../../../packages/contract/package.json";

/**
 * What the shell puts in its footer version line.
 *
 * Read from the two `package.json` files rather than retyped, because a
 * version line that has to be remembered is a version line that goes stale,
 * and a stale one is worse than none: it is the first thing a reader quotes in
 * a bug report.
 *
 * `API_VERSION` is the one value here that is NOT read from a file. The
 * contract package's semver tracks the SHAPE of the types; the API surface the
 * client speaks to is `v1` and changes on its own schedule, so it is stated
 * once, here, and the two are shown side by side rather than conflated.
 */

export const APP_VERSION: string = appPackage.version;
export const CONTRACT_VERSION: string = contractPackage.version;
export const API_VERSION = "v1";

/** "TrainOS 0.0.0 · API v1 · contract 0.1.0" */
export const VERSION_LINE = `TrainOS ${APP_VERSION} · API ${API_VERSION} · contract ${CONTRACT_VERSION}`;
