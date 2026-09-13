import {
  isDomainError,
  isNotDeployed,
  isRetryable,
  readableMessage,
  type ApiError,
} from "@/shared/api";
import { ExceptionBanner } from "./ExceptionBanner";
import { SecondaryButton } from "./Button";

/**
 * What to show when a SUPPORTING read on a record screen fails.
 *
 * `ErrorState` is for the read the screen cannot exist without — the invoice on
 * the invoice screen. It replaces the page. A record screen also makes several
 * reads it CAN exist without: the client's name for the identity line, the
 * pipeline configuration behind the stepper, the rate card's version, the
 * assistant's suggestions. Those failures were being written as
 * `query.data?.name` with no `isError` branch anywhere, so a dropped connection
 * and a 403 both rendered as the value simply not being there — and an errored
 * suggestions list is pixel-identical to an organisation with no suggestions.
 *
 * Thirteen reads across six screens had that shape, which is why this is a
 * named component rather than an inline banner repeated six times.
 *
 * Two rules it inherits rather than re-decides:
 *
 *  - R2. A domain refusal is a fact about the request, so it is never offered a
 *    retry and it is drawn in warning rather than danger — nothing is broken,
 *    the server answered. Only a transport failure gets "Try again", and only
 *    when `isRetryable` says a second attempt could plausibly work.
 *  - `ExceptionBanner`'s own rule: ONE banner per page. This collapses every
 *    failed supporting read on a screen into a single banner rather than
 *    stacking one per read, because three banners is how a page teaches people
 *    to ignore all of them.
 *  - `NOT_DEPLOYED`. A read this environment does not serve yet is not a
 *    failure, so when that is ALL that went wrong the banner is a quiet status
 *    naming what is missing, with no retry. Mixed with a real failure it counts
 *    as neither refusal nor fault and the real failure decides the banner.
 */

export interface PartialRead {
  /** What did not load, in the reader's terms. "The client's name". */
  label: string;
  /**
   * The read's failure. TanStack hands back the thrown value, so pass it
   * through `toApiError` at the call site — testing `kind` on the exception
   * reads every refusal as a transport failure.
   */
  error: ApiError | null | undefined;
  /** Re-run this one read. Ignored when the failure is a refusal. */
  retry?: () => void;
}

export interface PartialDataBannerProps {
  reads: readonly PartialRead[];
  className?: string;
}

/** `label` for one, "a, b and c" for several. The reader wants the nouns. */
function joinLabels(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

export function PartialDataBanner({ reads, className }: PartialDataBannerProps) {
  const failed = reads.flatMap((read) =>
    read.error ? [{ ...read, error: read.error }] : [],
  ) as (PartialRead & { error: ApiError })[];

  if (failed.length === 0) return null;

  if (failed.every((read) => isNotDeployed(read.error))) {
    const missing = joinLabels(failed.map((read) => read.label));
    return (
      <ExceptionBanner
        severity="INFO"
        title="Part of this page is not available here yet"
        subtitle={`${missing.charAt(0).toUpperCase()}${missing.slice(1)}: this environment does not serve that yet, and retrying will not change it.`}
        {...(className === undefined ? {} : { className })}
      />
    );
  }

  const labels = joinLabels(failed.map((read) => read.label));
  const refusedOnly = failed.every(
    (read) => isDomainError(read.error) || isNotDeployed(read.error),
  );
  const retryable = failed.filter((read) => read.retry && isRetryable(read.error));

  /* The first failure's own sentence. A domain message is written for a person
     by the server, so it is worth showing; a transport one gets the plain
     fallback `readableMessage` already supplies. Only the first, because a
     banner that prints four error messages is a log, not a banner. */
  const first = failed[0];
  const detail = first ? readableMessage(first.error) : "";

  return (
    <ExceptionBanner
      severity={refusedOnly ? "WARN" : "DANGER"}
      title={
        failed.length === 1
          ? `${labels} could not be loaded`
          : `Parts of this record could not be loaded`
      }
      subtitle={failed.length === 1 ? detail : `${labels}. ${detail}`}
      {...(retryable.length > 0
        ? {
            action: (
              <SecondaryButton
                type="button"
                onClick={() => {
                  for (const read of retryable) read.retry?.();
                }}
              >
                Try again
              </SecondaryButton>
            ),
          }
        : {})}
      {...(className === undefined ? {} : { className })}
    />
  );
}
