import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtureClient, forbidden } from "@trainos/fixtures";
import { useActor as useFinanceActor } from "@/features/finance/api";
import { useActor as useHrdcActor } from "@/features/hrdc/api";

/**
 * The control for "a data hook must not eat its own error".
 *
 * Thirteen reads across six screens surfaced a failure as absent data. The
 * worst of them was `useActor`, which was written as
 *
 *   const { data } = useQuery({ queryKey: queryKeys.me, ... });
 *   return data ? { kind: "HUMAN", id: data.id, name: data.name } : undefined;
 *
 * — the error was destroyed INSIDE the hook, so no call site could have
 * rendered it however carefully it was written. A `getMe()` that 403s and a
 * `getMe()` still in flight were the same value, and the two governed writes
 * downstream reported both as `new Error("The principal is not loaded yet.")`:
 * a sentence about loading, printed over a refusal.
 *
 * Two tests, because neither is sufficient alone.
 *
 * The SCAN is the reach: it fails on any data hook in the app that destructures
 * a query result, which is the only way to drop the error at the hook. It reads
 * the source rather than the behaviour precisely because the defect is invisible
 * at runtime — the hook returns a plausible value either way.
 *
 * The BEHAVIOUR is the proof the scan is asserting something real: with
 * `getMe()` refused, the hook must hand its caller the refusal rather than
 * `undefined`. Revert either `useActor` to its old body and this one fails
 * before the scan even runs.
 */

const SRC = path.resolve(__dirname, "..");

interface Destructure {
  file: string;
  line: number;
  text: string;
}

/**
 * Every data-layer file. The features' own `api.ts` plus `shared/api`, which is
 * where a hook that other features reach through would hide the same defect.
 */
function dataLayerFiles(): string[] {
  const files: string[] = [];

  const featuresDir = path.join(SRC, "features");
  for (const entry of readdirSync(featuresDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const api = path.join(featuresDir, entry.name, "api.ts");
    try {
      readFileSync(api, "utf8");
      files.push(api);
    } catch {
      /* Not every feature has a data layer of its own. */
    }
  }

  const sharedDir = path.join(SRC, "shared", "api");
  for (const entry of readdirSync(sharedDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    if (entry.name.endsWith(".test.ts")) continue;
    files.push(path.join(sharedDir, entry.name));
  }

  return files;
}

/**
 * `const { … } = useQuery(` / `useQueries(` / `useMutation(`.
 *
 * Destructuring is the tell. A hook that returns the result wholesale cannot
 * lose the error; a hook that pulls fields out of it has chosen which fields
 * survive, and `error` is the one that never did.
 */
const DESTRUCTURED = /(?:const|let)\s*\{[^}]*\}\s*=\s*(useQuery|useQueries|useMutation)\b/g;

/** `useQuery(` etc. anywhere, so a scan that matches nothing cannot pass. */
const ANY_QUERY = /\b(useQuery|useQueries|useMutation)\s*[<(]/g;

describe("R11 · a data hook returns its query, so the error survives the hook", () => {
  const files = dataLayerFiles();

  it("finds the data layer, so a broken scan cannot pass vacuously", () => {
    /* Fourteen feature api.ts files plus shared/api at the time of writing. */
    expect(files.length).toBeGreaterThanOrEqual(14);

    const hooks = files.reduce(
      (total, file) => total + (readFileSync(file, "utf8").match(ANY_QUERY)?.length ?? 0),
      0,
    );
    expect(hooks).toBeGreaterThanOrEqual(60);
  });

  it("leaves no hook that destructures a query result and drops the error", () => {
    const offenders: Destructure[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      let match: RegExpExecArray | null;
      DESTRUCTURED.lastIndex = 0;
      while ((match = DESTRUCTURED.exec(source)) !== null) {
        offenders.push({
          file: path.relative(SRC, file),
          line: source.slice(0, match.index).split("\n").length,
          text: match[0].replace(/\s+/g, " "),
        });
      }
    }

    expect(offenders.map((site) => `${site.file}:${site.line} — ${site.text}`)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * The behaviour the scan is standing in for
 * ------------------------------------------------------------------ */

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useActor · a refused identity reaches the call site", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /* Both features carry their own copy of this hook, and the swallow was in
     both. Asserting one would let the other regress silently. */
  for (const [name, hook] of [
    ["finance", useFinanceActor],
    ["hrdc", useHrdcActor],
  ] as const) {
    it(`surfaces the refusal rather than undefined · ${name}`, async () => {
      vi.spyOn(fixtureClient, "getMe").mockRejectedValue(
        forbidden("You are not signed in as anyone who may act here."),
      );

      const { result } = renderHook(() => hook(), { wrapper });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toBeTruthy();
      expect(result.current.data).toBeUndefined();
    });
  }

  it("still hands back the actor when the identity read succeeds", async () => {
    const { result } = renderHook(() => useFinanceActor(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.kind).toBe("HUMAN");
    expect(result.current.data?.id).toBeTruthy();
  });
});
