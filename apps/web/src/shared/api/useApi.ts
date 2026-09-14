import { createContext, createElement, useContext, useEffect, useRef, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type { ActionRequest, ActionResponse, Actor, Role } from "@trainos/contract";
import {
  TRAINER_FARAH,
  USER_AMIRAH,
  USER_JASON,
  USER_KELVIN,
  USER_KHAIRUL,
  USER_SITI,
} from "@trainos/contract";
import { fixtureClient } from "@trainos/fixtures";
import { useMe } from "@/shared/hooks/useMe";
import { navPath } from "@/shared/config/nav";
/* Imported by their own leaf modules, not the kit barrel: the barrel also
   re-exports components such as `PartialDataBanner` that import FROM
   `shared/api`, and `useApi.ts` importing the barrel back would be a real
   import cycle, not a theoretical one. `toast.ts` and `actionToast.ts` are
   themselves leaves — no component, no import of anything in this folder. */
import { defaultActionSubject, describeActionToast } from "@/shared/components/kit/actionToast";
import { toast } from "@/shared/components/kit/toast";
import { describeActionError } from "@/shared/components/kit/adapters";
import { createRpcApiClient, type ApiClient } from "./apiClient";
import { readableMessage, toApiError, type ApiError } from "./errors";
import { stableIdempotencyKey } from "./idempotency";
import { apiMode } from "./supabase";

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
 * Which client this build talks to, decided ONCE at module load.
 *
 * `VITE_API_MODE=supabase` mounts the RPC client; anything else, including the
 * variable being absent, mounts the fixture client. The default is deliberately
 * the safe one — a build that forgets the variable serves the demo dataset
 * rather than pointing a half-configured app at a real tenant\'s data.
 *
 * Decided once rather than per render because the choice is a property of the
 * BUILD. Re-deciding per render would let a hot reload swap the client under a
 * populated React Query cache, which is one principal\'s data answering another
 * principal\'s questions.
 */
export const defaultClient: ApiClient =
  apiMode() === "supabase" ? createRpcApiClient() : fixtureClient;

/**
 * The default is the singleton rather than `null`.
 *
 * A missing provider therefore behaves exactly as production does instead of
 * throwing, which is what lets the feature test harnesses render a screen in
 * isolation and drive the client directly. `ApiProvider` still owns the role
 * sync, so the behaviour a provider adds is identity tracking, not data access.
 */
const ApiContext = createContext<ApiClient>(defaultClient);

export interface ApiProviderProps {
  children: ReactNode;
  /** Injectable so a test can supply a client with `latencyMs: 0`. */
  client?: ApiClient;
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
export function ApiProvider({ children, client = defaultClient }: ApiProviderProps) {
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
export function useApi(): ApiClient {
  return useContext(ApiContext);
}

/**
 * The signed-in principal, in the shape the §3 action envelope wants.
 *
 * Over fixtures the id follows the role toggle through `ACTOR_FOR_ROLE`. Over
 * Supabase it is `me.id`, which `core.me()` returns as the caller's own
 * `auth.uid()` — a fixture user id there would name somebody who does not exist
 * in the database.
 */
export function useActor(): Actor {
  const { me } = useMe();
  const id = apiMode() === "supabase" ? me.id : ACTOR_FOR_ROLE[me.role];
  return { id, name: me.name, kind: "HUMAN" };
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
 * Idempotency-key derivation moved to `./idempotency` and is re-exported here.
 *
 * The RPC adapter needs the SAME derivation: `putQuotation` has no options bag,
 * so it builds the key itself, and a second implementation beside this one is
 * the divergence CLAUDE.md calls a defect. Re-exported rather than relocated in
 * the barrel so no call site outside this folder changed.
 */
export { derivedIdempotencyKey, newIdempotencyKey, stableIdempotencyKey } from "./idempotency";

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
  /**
   * Feedback for every outcome — EXECUTED, QUEUED_FOR_APPROVAL, SUGGESTED and
   * the refusal — shown as a toast so it survives the reader looking away,
   * the screen navigating on success, or the surrounding data the caller
   * conditioned an inline banner on going stale. On by default: "the button
   * did something and nothing told me" was the report this hook exists to
   * close, for every governed write, not the ones somebody remembered to wire.
   *
   * Pass `false` only where an `ActionOutcome` (or equivalent) renders
   * UNCONDITIONALLY next to the button that triggered it — conditioned on the
   * mutation's own state or on local state the trigger sets, never on
   * server data the action itself can invalidate. That second shape is the
   * exact bug this option exists to backstop; see `EnquiryDetailPage`'s fix.
   */
  toast?: boolean;
  /**
   * What was asked for, in the reader's words — "Convert ENQ-2026-0013". Pass
   * the same string given to the screen's `ActionOutcome`, so the toast and
   * the banner never disagree. Defaults to `humanise(request.type)` plus the
   * target ref, which is honest but generic.
   */
  subject?: string;
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
  const navigate = useNavigate();
  const showToast = options?.toast !== false;

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
    onSuccess: (result, request) => {
      if (showToast) fireActionToast(result, request, options?.subject, navigate);
      options?.onSettled?.(result);
    },
  });
}

/**
 * Renders one `ActionResult` as a toast. Copy comes from `describeActionToast`
 * — the same function `ActionOutcome`'s banner draws from — so this file adds
 * only the two things that are genuinely about being a TOAST: which `sonner`
 * variant to ring, and the "View the approval" hop a banner reaches by simply
 * living on the same page.
 *
 * The approval link is derived from `navPath`, the one function every route
 * in the app already derives its URL from (`shared/config/nav.ts`), rather
 * than imported from `features/approvals/paths.ts` — `shared/api` importing a
 * feature would run the dependency the other way round from every other file
 * in this folder. `features/approvals/paths.ts#approvalPath` derives the same
 * way, from the same tree, so the two cannot silently disagree.
 */
function fireActionToast(
  result: ActionResult,
  request: ActionRequest,
  subjectOverride: string | undefined,
  navigate: ReturnType<typeof useNavigate>,
): void {
  const subject = subjectOverride ?? defaultActionSubject(request);
  const message = describeActionToast(
    subject,
    result.kind === "error"
      ? { error: describeActionError(result.error, readableMessage(result.error)) }
      : { response: result.response },
  );
  const options =
    message.description !== undefined ? { description: message.description } : undefined;

  if (result.kind === "QUEUED_FOR_APPROVAL") {
    const ref = result.response.approvalRequest.ref;
    const path = `${navPath("Home", "Approvals")}/${encodeURIComponent(ref)}`;
    toast.info(message.title, {
      ...options,
      action: { label: "View approval", onClick: () => navigate(path) },
    });
    return;
  }

  if (message.variant === "error") toast.error(message.title, options);
  else if (message.variant === "info") toast.info(message.title, options);
  else toast.success(message.title, options);
}
