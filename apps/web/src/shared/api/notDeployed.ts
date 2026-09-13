import { isTransportError, toApiError } from "./errors";

/**
 * "This is not deployed here yet", as ONE decision and ONE sentence.
 *
 * Nine surfaces across enquiries, proposals and approvals have to answer the
 * same question about the same failure, and CLAUDE.md's consolidation rule says
 * a behaviour that repeats on more than two screens is standardised before it
 * is used again. The standard is here rather than in a component because the
 * decision is a property of the ERROR, which belongs to the data boundary; the
 * kit's `EmptyState` draws it, and `notDeployedState()` hands it the copy so a
 * tenth caller cannot invent a tenth wording.
 *
 * WHY IT IS NOT AN ERROR STATE. `PGRST106` (schema not exposed), `PGRST205`
 * (table not in the schema cache) and `PGRST202` / `42883` (no such function)
 * are facts about THIS environment, not about the request. Drawn as an error
 * with a "Try again" button, they invite a reader to retry something that can
 * never succeed until a migration lands; drawn as an empty state they say what
 * is true. `rpcClient.classifyTransportFailure` already classifies all of them
 * as `NOT_DEPLOYED` on code, never on message text — this module only reads
 * that classification.
 */

/** The copy a "not deployed" surface renders. `EmptyState` takes it as props. */
export interface NotDeployedState {
  title: string;
  description: string;
}

/**
 * Is this failure the environment's, rather than the request's?
 *
 * Takes `unknown` because that is what TanStack Query hands a screen back, and
 * `toApiError` is idempotent — an `ApiError`, an `ApiErrorException` and a
 * thrown `ContractError` all narrow correctly, and anything else is simply not
 * a deployment fact.
 */
export function isNotDeployed(error: unknown): boolean {
  if (error === null || error === undefined) return false;
  const api = toApiError(error);
  return isTransportError(api) && api.code === "NOT_DEPLOYED";
}

/**
 * The state itself.
 *
 * @param subject what the reader was looking at, as a noun phrase that can
 *   start a sentence — "The enquiry queue", "This proposal".
 */
export function notDeployedState(subject: string): NotDeployedState {
  return {
    title: `${subject} is not available here yet`,
    description:
      "This environment does not serve this part of TrainOS yet. Nothing is wrong with " +
      "your request and retrying will not change the answer — the endpoint arrives with " +
      "the next database deployment.",
  };
}
