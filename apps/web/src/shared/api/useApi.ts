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
 * How long the fixture client should pretend a round trip takes, in ms.
 *
 * The client's own default is 120ms, and the app was paying it on EVERY read.
 * Measured on the rail: a nav click to Engagements cost 158ms and flashed
 * `LoadingState` before the screen appeared; with the simulation off the same
 * click costs 26ms and never shows the fallback. Twelve reads on one screen
 * pay it twelve times. That is the whole of the "clicking between nav items
 * feels laggy" report.
 *
 * The simulation is NOT deleted, because it is how the loading and error
 * surfaces stay reachable by hand — `?latency=120` restores the client's own
 * default, and any other number is honoured as given. It is simply not the
 * price of every navigation any more.
 *
 * Read from the URL rather than held in state, the same way the record card
 * reads `?gradient=alt`: there is nothing to subscribe to and nothing to leak,
 * and a reload is the toggle.
 */
export function simulatedLatencyMs(): number {
  if (typeof window === "undefined") return 0;
  const raw = new URLSearchParams(window.location.search).get("latency");
  if (raw === null) return 0;
  if (raw === "") return 120;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 120;
}

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
  const latencyMs = simulatedLatencyMs();

  if (client.actorId !== actorId) client.signInAs(actorId);
  /* In RENDER for the same reason the sign-in is: an effect runs after this
     provider's children have mounted, and a child's `queryFn` fires from its
     own mount effect, which is BEFORE a parent effect. Set from an effect, the
     first screen of every session would still pay the simulated round trip. */
  if (client.latencyMs !== latencyMs) client.setLatency(latencyMs);

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

export interface UseActionOptions {
  /**
   * Override the derived key. The default is `stableIdempotencyKey(request)`,
   * which is what a governed write wants; pass this only where the subject
   * supplies a better identity than the request body does.
   */
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
 * here, and it is derived from the request rather than the attempt — see
 * `stableIdempotencyKey`. Four features were building it from `Date.now()`,
 * which is a key guaranteed unique per try and therefore guaranteed useless.
 */
export function useAction(options?: UseActionOptions) {
  const client = useApi();

  return useMutation<ActionResult, never, ActionRequest>({
    mutationFn: async (request) => {
      try {
        const response = await client.performAction(request, {
          idempotencyKey: options?.idempotencyKey ?? stableIdempotencyKey(request),
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
