/**
 * A boolean a disclosure remembers between visits.
 *
 * The key is a RECORD TYPE, never a record. An approver who collapses the
 * header on one approval wants every approval to open that way; keying by
 * `APV-2026-0771` would make the preference evaporate the moment they move to
 * the next item in the queue, which is the one motion this screen is built for.
 *
 * MECHANISM: read once, in the `useState` initialiser. No effect, no listener,
 * no timer, nothing to clean up — mount cost is a single synchronous read and
 * unmount cost is zero. That matters because these live inside a RecordHeader,
 * which mounts on every record navigation.
 *
 * Every access is wrapped: Safari in private mode throws on `localStorage`
 * rather than returning null, and a header that cannot render because storage
 * is unavailable is a worse failure than a forgotten preference. A throw falls
 * back to the caller's default and the component carries on.
 *
 * `key` is read once, on mount. A caller that changes it mid-life keeps the
 * state it had — acceptable because a record type does not change under a
 * mounted header, and re-reading would need an effect this deliberately avoids.
 */

import { useCallback, useState } from "react";

const PREFIX = "trainos:disclosure:";

function read(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : raw === "1";
  } catch {
    return fallback;
  }
}

/**
 * @param key Record-type key, e.g. `record-header:approval`. `undefined` makes
 *            the flag ephemeral — state still works, nothing is persisted.
 * @param fallback What to use on a first visit.
 */
export function useRememberedFlag(
  key: string | undefined,
  fallback: boolean,
): readonly [boolean, (next: boolean) => void] {
  const [value, setValue] = useState(() => (key ? read(key, fallback) : fallback));

  const set = useCallback(
    (next: boolean) => {
      setValue(next);
      if (!key) return;
      try {
        window.localStorage.setItem(PREFIX + key, next ? "1" : "0");
      } catch {
        /* Storage refused. The toggle still works for this session. */
      }
    },
    [key],
  );

  return [value, set] as const;
}
