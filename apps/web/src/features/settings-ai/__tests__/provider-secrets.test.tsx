import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { USER_KHAIRUL } from "@trainos/contract";
import { fixtureClient, resetStore } from "@trainos/fixtures";
import { useCreateProvider, useRevealProvider } from "../api";

/**
 * A provider key in the browser lives exactly as long as the screen showing it.
 *
 * §17: reveal "returns the key once", and the create body carries the key.
 * Both are mutations, and TanStack keeps a finished mutation — its `data` AND
 * its `variables` — in the MutationCache for five minutes after the component
 * unmounts unless `gcTime` says otherwise. So the assertion is on the caches
 * themselves, with a plain `new QueryClient()` whose defaults are exactly the
 * ones that would have kept the key.
 */

let queryClient: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

/** Everything the caches and both web storages hold, as one string. */
function everythingRetained(): string {
  const storage = (store: Storage) =>
    Array.from({ length: store.length }, (_, i) => store.key(i))
      .map((key) => `${key}=${key === null ? "" : store.getItem(key)}`)
      .join("\n");
  return JSON.stringify({
    queries: queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.state),
    mutations: queryClient
      .getMutationCache()
      .getAll()
      .map((mutation) => mutation.state),
    local: storage(window.localStorage),
    session: storage(window.sessionStorage),
  });
}

beforeEach(() => {
  resetStore();
  fixtureClient.setLatency(0);
  fixtureClient.signInAs(USER_KHAIRUL);
  queryClient = new QueryClient();
});

afterEach(() => {
  queryClient.clear();
});

describe("M20-S21 · a key never outlives its screen", () => {
  it("reveal: the key is in no query cache while shown, and in no cache or storage once unmounted", async () => {
    const id = fixtureClient.store.providerKeys[0]?.id ?? "";
    const { result, unmount } = renderHook(() => useRevealProvider(), { wrapper });

    let key = "";
    await act(async () => {
      key = (await result.current.mutateAsync(id)).key;
    });

    expect(key.length).toBeGreaterThan(0);
    await waitFor(() => expect(result.current.data?.key).toBe(key));
    expect(
      JSON.stringify(
        queryClient
          .getQueryCache()
          .getAll()
          .map((q) => q.state),
      ),
    ).not.toContain(key);

    unmount();

    await waitFor(() => expect(queryClient.getMutationCache().getAll()).toHaveLength(0));
    expect(everythingRetained()).not.toContain(key);
  });

  it("create: the request body's key is dropped from the mutation cache when the drawer unmounts", async () => {
    const key = "sk-ant-api03-DRAWERSECRETabcdefghijklmnopqrstuvwxyz";
    const { result, unmount } = renderHook(() => useCreateProvider(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        provider: "ANTHROPIC",
        label: "Drawer test",
        key,
        scopeTiers: ["STRONG_1"],
        billingOwner: "CLIENT_ACCOUNT",
        region: "US",
      });
    });

    unmount();

    await waitFor(() => expect(queryClient.getMutationCache().getAll()).toHaveLength(0));
    expect(everythingRetained()).not.toContain(key);
  });
});
