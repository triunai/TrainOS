import { revalidatePath } from "next/cache";
import { type ActionResult, DomainError, fromDatabaseError, isDomainError } from "./domain/errors";

/**
 * Wraps a server-action body into an ActionResult.
 * R2: a DomainError (policy refusal, guard failure) is `kind: "domain"` and the
 * UI renders its message where the operator can act on it; anything else is
 * `kind: "transport"`. R3: the client always surfaces a failed result — an
 * action that fails silently is how "the button does nothing" happens.
 */
export async function act<T>(work: () => Promise<T>, opts: { message?: string; revalidate?: string[] } = {}): Promise<ActionResult<T>> {
  try {
    const data = await work();
    for (const path of opts.revalidate ?? ["/"]) revalidatePath(path, "layout");
    return { ok: true, data, message: opts.message };
  } catch (error) {
    let domain: DomainError | undefined = isDomainError(error) ? error : undefined;
    let current: unknown = error;
    while (!domain && current) {
      domain = fromDatabaseError(current);
      current = (current as { cause?: unknown }).cause;
    }
    if (domain) {
      const failures = (domain.details.failures as Array<{ message: string }> | undefined)?.map((f) => f.message);
      return { ok: false, kind: "domain", code: domain.code, message: failures?.length ? failures.join(" · ") : domain.message, details: domain.details };
    }
    console.error("[action] transport failure", error);
    return { ok: false, kind: "transport", message: error instanceof Error ? error.message : "Unexpected error" };
  }
}

/** Serialisable copy of data for the client (Dates → ISO strings, bigint → number). */
export function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
