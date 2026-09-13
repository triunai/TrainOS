import type { ActionRequest } from "@trainos/contract";

/**
 * Idempotency-key derivation, in one place.
 *
 * Lifted out of `useApi.ts` unchanged. It moved because the RPC adapter needs
 * the SAME derivation as the hooks — `putQuotation` takes no options bag, so
 * the adapter has to build the key itself, and a second implementation beside
 * this one is the divergence CLAUDE.md calls a defect. `useApi` re-exports
 * every name, so nothing outside this folder changed.
 */

/**
 * A fresh key, unique per call. Rarely what a governed write wants.
 *
 * This exists for the caller whose write genuinely is a new intent every time
 * it fires. It is NOT the default, because a key that changes per attempt
 * cannot deduplicate anything: §3 recognises a repeat by the key, so a
 * double-click or a user retry after a dropped connection arrives as two
 * unrelated governed actions. That is the exact inverse of what the key is for.
 */
export function newIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Key order does not change a value's identity, so it must not change the key.
 *
 * `JSON.stringify` preserves insertion order, and two callers building the same
 * payload from different branches routinely produce the same fields in a
 * different order. Sorting is what makes "the same intent" mean the same thing
 * twice.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, member]) => member !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, member]) => `${JSON.stringify(key)}:${stableStringify(member)}`);

  return `{${entries.join(",")}}`;
}

/** A short, stable digest. FNV-1a — not a hash for secrets, a hash for keys. */
function digest(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * The key a governed write should carry: derived from the INTENT, not the try.
 *
 * §3 replays the original response for the same key with the same body, and
 * refuses the same key with a DIFFERENT body as `409 IDEMPOTENT_REPLAY`. Both
 * halves matter here. Deriving the key from the request's own identity — its
 * type, its target and its payload — means a double-clicked button and a retry
 * after a transport failure resolve to one governed action and one approval,
 * while a genuinely different request gets a different key and is never
 * mistaken for a replay. A key built from `Date.now()` or `randomUUID()` fails
 * the first half; a key built from type and target alone would fail the second,
 * turning a corrected amount into a 409.
 *
 * `requestedBy` is deliberately included: the same write proposed by two
 * principals is two governed actions with two audit trails, not a replay.
 */
export function stableIdempotencyKey(request: ActionRequest): string {
  const { type, targetRef, payload, requestedBy } = request;
  return derivedIdempotencyKey(type, targetRef, {
    payload: payload ?? null,
    requestedBy: requestedBy?.id ?? null,
  });
}

/**
 * The same derivation for a write that is not a §3 action.
 *
 * `POST /v1/approvals/{id}/decide` and the finance resource writes take a key
 * too, and they need it for the same reason: an approval decided twice by one
 * double-click is two audit entries for one human judgement.
 *
 * @param scope what kind of write this is, e.g. `approval-decide`
 * @param subject the record it acts on
 * @param body everything else that distinguishes one intent from another
 */
export function derivedIdempotencyKey(scope: string, subject: string, body: unknown): string {
  return `${scope}:${subject}:${digest(stableStringify(body))}`;
}

/**
 * The bulk-decide key, derived from the selection as a SET.
 *
 * ⚠ SELECTION ORDER IS NOT INTENT. Ticking A then B and ticking B then A are the
 * same decision over the same two approvals, so they must resolve to the same
 * key. `stableStringify` sorts object KEYS and deliberately leaves array order
 * alone — array order usually IS meaning — so deriving straight from
 * `body.items` gave the two orderings two different keys. Two keys are two
 * idempotency rows, and the retry a person makes after a dropped connection ran
 * the batch a SECOND time instead of replaying the first. That is the exact
 * inverse of what the key is for, on the one write in the app with money behind
 * it, and unlike the single-decide path it lands N approvals at once.
 *
 * `app.bulk_decide` already reads it this way: its request hash is taken over
 * `array_agg(x ORDER BY x)` (011:3447), sorted, with the comment "the client
 * hashes its selection in click order, so the same two approvals picked in the
 * other order produced a different key and a spurious refusal on the retry".
 * Sorting server-side settles the hash COMPARISON for one key; it cannot make
 * the client mint one key. This is the client half of that fix.
 *
 * Sorted by `approvalId` and not merely `join(",")`-ed, because the per-item
 * `diffHash` is part of the intent too: the same two approvals REPRICED are a
 * different decision and must not replay the stale one.
 *
 * This is derivation only. The array on the wire keeps selection order, because
 * `app.bulk_decide` iterates `p_items` in the order given to build `results`
 * (011:3506) and the inbox reads that order back.
 */
export function bulkDecideIdempotencyKey(body: {
  items: readonly { approvalId: string; diffHash: string }[];
  decision: string;
  note?: string | null;
}): string {
  const items = [...body.items].sort((a, b) => (a.approvalId < b.approvalId ? -1 : 1));
  return derivedIdempotencyKey(
    "approval-bulk-decide",
    items.map((item) => item.approvalId).join(","),
    { decision: body.decision, items, note: body.note ?? null },
  );
}
