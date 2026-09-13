import { createContext, createElement, useContext, useEffect, useRef, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ActionRequest, ActionResponse, Actor, Role } from "@trainos/contract";
import {
  TRAINER_FARAH,
  USER_AMIRAH,
  USER_JASON,
  USER_KELVIN,
  USER_KHAIRUL,
  USER_SITI,
} from "@trainos/contract";
import { fixtureClient, type FixtureClient } from "@trainos/fixtures";
import { useMe } from "@/shared/hooks/useMe";
import { toApiError, type ApiError } from "./errors";

/**
 * The data seam. ONE of these for the whole app.
 *
 * Thirteen modules had grown their own copy of this hook, in four mutually
 * incompatible shapes: seven with a private `ACTOR_FOR_ROLE` table, three that
 * ignored the role toggle entirely, one returning `{ api, actorId }` instead of
 * a client, and three that skipped the hook and imported the singleton. That is
 * the divergence CLAUDE.md calls a defect, and it had already produced one:
 * the copies mutated the client's identity DURING render and never invalidated
 * anything, so switching role left the previous principal's cached projections
 * on screen until `staleTime` happened to expire.
 *
 * Swapping the fixture client for an HTTP one is now a change to this file.
 */

/**
 * Shell role -> the fixture principal holding that role's permissions.
 *
 * The fixture client enforces permissions for real, so the signed-in actor has
 * to track the shell's role toggle. Without it every call answers as Amirah and
 * a role-gated refusal is never reachable from the UI — the 403 surfaces stay
 * decorative, and nobody finds out until a real API says no.
 */
export const ACTOR_FOR_ROLE: Readonly<Record<Role, string>> = {
  SALES: USER_AMIRAH,
  SALES_MANAGER: USER_KELVIN,
  OPS: USER_SITI,
  FINANCE: USER_JASON,
  MD: "u_lim",
  ADMIN: USER_KHAIRUL,
  TRAINER: TRAINER_FARAH,
  CLIENT: USER_AMIRAH,
  AGENT: USER_AMIRAH,
};

/**
 * The default is the singleton rather than `null`.
 *
 * A missing provider therefore behaves exactly as production does instead of
 * throwing, which is what lets the feature test harnesses render a screen in
 * isolation and drive the client directly. `ApiProvider` still owns the role
 * sync, so the behaviour a provider adds is identity tracking, not data access.
 */
const ApiContext = createContext<FixtureClient>(fixtureClient);

export interface ApiProviderProps {
  children: ReactNode;
  /** Injectable so a test can supply a client with `latencyMs: 0`. */
  client?: FixtureClient;
}

/**
 * Mounts the client and keeps its principal in step with the role toggle.
 *
 * The sign-in happens in RENDER, not in an effect, and the guard is what makes
 * that safe: it runs once per actual change and is a no-op otherwise. An effect
 * would run after this provider's children have already rendered, so their
 * first `queryFn` would ask as the OUTGOING principal and the screen would show
 * one principal's data before correcting itself — which on this app means
 * briefly showing a finance block to a reader who is not allowed one.
 *
 * The invalidation is the half that does belong in an effect. It is skipped on
 * mount, because nothing is cached yet, and runs on every later change, because
 * the cache is keyed by query and not by principal: without it a role switch
 * keeps serving the previous principal's answers until `staleTime` expires.
 */
export function ApiProvider({ children, client = fixtureClient }: ApiProviderProps) {
  const { me } = useMe();
  const queryClient = useQueryClient();
  const actorId = ACTOR_FOR_ROLE[me.role];

  if (client.actorId !== actorId) client.signInAs(actorId);

  const previous = useRef(actorId);
  useEffect(() => {
    if (previous.current === actorId) return;
    previous.current = actorId;
    void queryClient.invalidateQueries();
  }, [actorId, queryClient]);

  return createElement(ApiContext.Provider, { value: client }, children);
}

/** The client this app reads and writes through. */
export function useApi(): FixtureClient {
  return useContext(ApiContext);
}

/** The signed-in principal, in the shape the §3 action envelope wants. */
export function useActor(): Actor {
  const { me } = useMe();
  return { id: ACTOR_FOR_ROLE[me.role], name: me.name, kind: "HUMAN" };
}

/* ---- The §3 action envelope ----------------------------------------- */

/**
 * A §3 response, plus the refusal, as ONE value a caller must destructure.
 *
 * `QUEUED_FOR_APPROVAL` is a SUCCESS — the write was intercepted by policy, not
 * rejected — and `SUGGESTED` means it was never attempted. A caller that treats
 * the envelope as "worked or threw" renders an approval queue as a failure, so
 * the three outcomes and the refusal are all values here and none of them is an
 * exception.
 */
export type ActionResult =
  | { kind: "EXECUTED"; response: Extract<ActionResponse, { status: "EXECUTED" }> }
  | {
      kind: "QUEUED_FOR_APPROVAL";
      response: Extract<ActionResponse, { status: "QUEUED_FOR_APPROVAL" }>;
    }
  | { kind: "SUGGESTED"; response: Extract<ActionResponse, { status: "SUGGESTED" }> }
  | { kind: "error"; error: ApiError };

/**
 * A fresh idempotency key.
 *
 * §3 replays the original response for the same key and the same body, and
 * throws `IDEMPOTENT_REPLAY` for the same key with a different one. A key that
 * is per-ATTEMPT is therefore the safe default: it makes a double-click on a
 * governed write a duplicate the server can see, rather than two independent
 * side effects. A caller that wants a double-click to collapse into one write
 * passes a key derived from the subject instead.
 */
export function newIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface UseActionOptions {
  /** A stable key, when a retry should replay rather than write again. */
  idempotencyKey?: string;
  /**
   * Runs after every attempt, refusal included. Check `kind` before acting:
   * a refusal changed nothing, so invalidating on one costs a round trip and
   * tells the reader their failed write might have landed.
   */
  onSettled?: (result: ActionResult) => void;
}

/**
 * `POST /v1/actions`, with a key attached and nothing thrown.
 *
 * Two of the app's governed writes were sending no idempotency key at all,
 * which is how a double-click becomes two proposals. The key is not optional
 * here.
 */
export function useAction(options?: UseActionOptions) {
  const client = useApi();

  return useMutation<ActionResult, never, ActionRequest>({
    mutationFn: async (request) => {
      try {
        const response = await client.performAction(request, {
          idempotencyKey: options?.idempotencyKey ?? newIdempotencyKey(),
        });

        /* `status` is already the discriminant §3 gives the envelope; this
           widens it to carry the refusal in the same union. */
        switch (response.status) {
          case "QUEUED_FOR_APPROVAL":
            return { kind: "QUEUED_FOR_APPROVAL", response };
          case "SUGGESTED":
            return { kind: "SUGGESTED", response };
          default:
            return { kind: "EXECUTED", response };
        }
      } catch (thrown) {
        return { kind: "error", error: toApiError(thrown) };
      }
    },
    /* Every outcome arrives here, because the refusal is a value and not a
       rejection; `onError` would only ever see a bug in this hook. */
    onSuccess: (result) => options?.onSettled?.(result),
  });
}
