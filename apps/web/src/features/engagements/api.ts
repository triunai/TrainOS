import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import type {
  Actor,
  ActionRequest,
  ActionResponse,
  AttendanceCaptureRequest,
  AttendanceExport,
  AttendanceSheet,
  ComplianceChecksResponse,
  ListResponse,
  Organisation,
  Participant,
  PipelineConfig,
} from "@trainos/contract";
import { type EngagementProjection } from "@trainos/fixtures";
import { stableIdempotencyKey, useActor, useApi, type ApiError } from "@/shared/api";

/**
 * The engagements data boundary — M09-S02 and M10-S06.
 *
 * The client and the principal both come from `shared/api`. The principal
 * matters here beyond authorisation: these query keys carry the actor, because
 * the OPS projection of an engagement DROPS the `finance` block rather than
 * zeroing it, and caching two roles' projections under one key would serve a
 * SALES reader's finance figures to an OPS reader.
 *
 * Two things this file refuses to do, both on purpose:
 *
 *  - It never computes a lifecycle state. `getEngagement` returns
 *    `LifecycleStep[]` with `HRDC_CLAIM` already `BLOCKED`, set server-side
 *    from a failing compliance check. A screen that re-derived it from a
 *    document count would disagree with the server the first time a rule
 *    changed.
 *  - It never assumes `finance` exists. The OPS projection DROPS the block
 *    rather than zeroing it, so the type is optional and the screen renders the
 *    panel only when the projection carries one.
 */

/** `details.blockers[]` off a refusal, or an empty list when it carries none. */
export function blockersOf(error: ApiError): string[] {
  if (error.kind !== "domain") return [];
  const blockers = (error.details as { blockers?: unknown } | undefined)?.blockers;
  return Array.isArray(blockers)
    ? blockers.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/**
 * Keys carry the ACTOR. Two roles get two different projections of the same
 * engagement, so caching them under one key would serve a SALES reader's
 * finance block to an OPS reader who is not permitted to see it.
 */
export const engagementKeys = {
  all: ["engagements"] as const,
  detail: (actor: string, id: string) => ["engagements", actor, "detail", id] as const,
  participants: (actor: string, id: string) =>
    ["engagements", actor, "detail", id, "participants"] as const,
  attendance: (actor: string, id: string, day: number) =>
    ["engagements", actor, "detail", id, "attendance", day] as const,
  checks: (actor: string, ref: string) => ["compliance", actor, "checks", ref] as const,
  organisation: (actor: string, ref: string) => ["organisations", actor, "detail", ref] as const,
  pipeline: (object: string) => ["config", "pipelines", object] as const,
};

/** Stage labels and order. Never hardcoded — CLAUDE.md's standing rule. */
export function usePipelineConfig(object: string): UseQueryResult<PipelineConfig> {
  const api = useApi();
  return useQuery({
    queryKey: engagementKeys.pipeline(object),
    queryFn: () => api.getPipelineConfig(object),
    staleTime: Infinity,
  });
}

export function useEngagement(id: string): UseQueryResult<EngagementProjection> {
  const api = useApi();
  const actorId = useActor().id;
  return useQuery({
    queryKey: engagementKeys.detail(actorId, id),
    queryFn: () => api.getEngagement(id),
    enabled: id.length > 0,
  });
}

export function useComplianceChecks(
  engagementRef: string,
): UseQueryResult<ComplianceChecksResponse> {
  const api = useApi();
  const actorId = useActor().id;
  return useQuery({
    queryKey: engagementKeys.checks(actorId, engagementRef),
    queryFn: () => api.getComplianceChecks(engagementRef),
    enabled: engagementRef.length > 0,
  });
}

export function useEngagementParticipants(id: string): UseQueryResult<ListResponse<Participant>> {
  const api = useApi();
  const actorId = useActor().id;
  return useQuery({
    queryKey: engagementKeys.participants(actorId, id),
    queryFn: () => api.getEngagementParticipants(id),
    enabled: id.length > 0,
  });
}

export function useAttendance(id: string, day: number): UseQueryResult<AttendanceSheet> {
  const api = useApi();
  const actorId = useActor().id;
  return useQuery({
    queryKey: engagementKeys.attendance(actorId, id, day),
    queryFn: () => api.getAttendance(id, day),
    enabled: id.length > 0,
  });
}

/**
 * Every delivery day at once, so the participants table on M09-S02 can show a
 * per-day column. `Participant` carries no attendance of its own — the sheet
 * does — so the join happens in `attendanceModel`, not in a component.
 */
export function useAttendanceDays(id: string, days: number[]) {
  const api = useApi();
  const actorId = useActor().id;
  return useQueries({
    queries: days.map((day) => ({
      queryKey: engagementKeys.attendance(actorId, id, day),
      queryFn: () => api.getAttendance(id, day),
      enabled: id.length > 0,
    })),
  });
}

/**
 * The client organisation's name. The engagement carries only its ref, and the
 * record header reads "<programme> · <organisation>", so the name is fetched
 * rather than invented.
 */
export function useOrganisation(ref: string | undefined): UseQueryResult<Organisation> {
  const api = useApi();
  const actorId = useActor().id;
  return useQuery({
    queryKey: engagementKeys.organisation(actorId, ref ?? ""),
    queryFn: () => api.getOrganisation(ref as string),
    enabled: Boolean(ref),
  });
}

/**
 * Capture on an approved day throws `409 ATTENDANCE_LOCKED`. Nothing is caught
 * here: the screen renders the refusal, because the lock IS the story M10-S06
 * exists to tell and a swallowed 409 would look like a control that does
 * nothing.
 */
export function useCaptureAttendance(id: string, day: number) {
  const api = useApi();
  const actorId = useActor().id;
  const queryClient = useQueryClient();
  return useMutation<AttendanceSheet, unknown, AttendanceCaptureRequest>({
    mutationFn: (body) => api.captureAttendance(id, day, body),
    onSuccess: (sheet) => {
      queryClient.setQueryData(engagementKeys.attendance(actorId, id, day), sheet);
      /* `metrics.attendanceRate` is computed from the sheets and rendered on
         both screens. Writing the sheet into cache without this left the rate
         reading the value from before the capture. */
      void queryClient.invalidateQueries({ queryKey: engagementKeys.all });
    },
  });
}

export function useExportAttendance(id: string) {
  const api = useApi();
  return useMutation<AttendanceExport, unknown, string | undefined>({
    mutationFn: (format) => api.exportAttendance(id, format ?? "HRDC"),
    /* Fire-and-forget from a button: nothing awaits this call and no screen
       renders its `error`, so without the flag a refusal is invisible. R3. */
    meta: { toastOnError: true },
  });
}

/**
 * The §3 action envelope. Every governed write on these two screens goes
 * through it, and every caller must handle all three outcomes — EXECUTED,
 * QUEUED_FOR_APPROVAL and SUGGESTED — because an approval is a success.
 *
 * `requestedBy` comes from `useActor()`, so it is the SAME principal the client
 * is signed in as. It used to be built from `me.id`, which is the shell's
 * display identity and not a principal the fixture roster contains — a request
 * stamped with an id the server has never heard of.
 */
export function usePerformAction() {
  const api = useApi();
  const queryClient = useQueryClient();
  const requestedBy: Actor = useActor();

  return useMutation<ActionResponse, unknown, Omit<ActionRequest, "requestedBy">>({
    mutationFn: (request) => {
      /* The key is derived from the INTENT, not the attempt. It used to end in
         `Date.now()`, which made it unique per try and therefore incapable of
         deduplicating anything: §3 recognises a repeat by the key, so a
         double-click or a retry after a dropped connection arrived as two
         unrelated governed actions on a screen whose writes lock attendance. */
      const governed: ActionRequest = { ...request, requestedBy };
      return api.performAction(governed, { idempotencyKey: stableIdempotencyKey(governed) });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: engagementKeys.all });
    },
  });
}
