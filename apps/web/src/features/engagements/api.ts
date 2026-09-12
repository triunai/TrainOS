import { useMemo } from "react";
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
import {
  fixtureClient,
  isContractError,
  users,
  type EngagementProjection,
  type FixtureClient,
} from "@trainos/fixtures";
import { domainErrorFromEnvelope, transportError, type ApiError } from "@/shared/api";
import { useMe } from "@/shared/hooks/useMe";

/**
 * The engagements data boundary — M09-S02 and M10-S06.
 *
 * `useApi()` is a hook so the shared provider `shared/api` will eventually own
 * is a one-line swap and no screen moves. Today it returns the
 * `@trainos/fixtures` singleton, because `shared/api`'s `TrainOsClient` is the
 * scaffold's `Result<T>` interface with every method `NOT_IMPLEMENTED` and
 * without the §8 attendance and §17 compliance-check endpoints.
 *
 * It also binds the fixture client's PRINCIPAL to the topbar's role toggle.
 * Permissions in the fixtures are enforced against the signed-in actor, not
 * against the request body, so without this the role toggle would change the
 * sidebar and nothing else, and the OPS projection of an engagement — the one
 * that has no `finance` block at all — would be unreachable from the UI. The
 * actor is looked up from the fixture roster by role rather than written down
 * here, so adding a role to the dataset needs no edit in this file.
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
export function useApi(): { api: FixtureClient; actorId: string } {
  const { me } = useMe();
  const actorId = useMemo(
    () => users.find((user) => user.role === me.role)?.id ?? fixtureClient.actorId,
    [me.role],
  );

  if (fixtureClient.actorId !== actorId) fixtureClient.signInAs(actorId);

  return { api: fixtureClient, actorId };
}

/** A thrown fixture error, in the shape `ErrorState` and `readableMessage` read. */
export function asApiError(thrown: unknown): ApiError {
  if (isContractError(thrown)) return domainErrorFromEnvelope(thrown.toEnvelope());
  if (thrown instanceof Error) return transportError("UNKNOWN", thrown.message, { cause: thrown });
  return transportError("UNKNOWN", "Unknown error", { cause: thrown });
}

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
  const { api } = useApi();
  return useQuery({
    queryKey: engagementKeys.pipeline(object),
    queryFn: () => api.getPipelineConfig(object),
    staleTime: Infinity,
  });
}

export function useEngagement(id: string): UseQueryResult<EngagementProjection> {
  const { api, actorId } = useApi();
  return useQuery({
    queryKey: engagementKeys.detail(actorId, id),
    queryFn: () => api.getEngagement(id),
    enabled: id.length > 0,
  });
}

export function useComplianceChecks(
  engagementRef: string,
): UseQueryResult<ComplianceChecksResponse> {
  const { api, actorId } = useApi();
  return useQuery({
    queryKey: engagementKeys.checks(actorId, engagementRef),
    queryFn: () => api.getComplianceChecks(engagementRef),
    enabled: engagementRef.length > 0,
  });
}

export function useEngagementParticipants(id: string): UseQueryResult<ListResponse<Participant>> {
  const { api, actorId } = useApi();
  return useQuery({
    queryKey: engagementKeys.participants(actorId, id),
    queryFn: () => api.getEngagementParticipants(id),
    enabled: id.length > 0,
  });
}

export function useAttendance(id: string, day: number): UseQueryResult<AttendanceSheet> {
  const { api, actorId } = useApi();
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
  const { api, actorId } = useApi();
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
  const { api, actorId } = useApi();
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
  const { api, actorId } = useApi();
  const queryClient = useQueryClient();
  return useMutation<AttendanceSheet, unknown, AttendanceCaptureRequest>({
    mutationFn: (body) => api.captureAttendance(id, day, body),
    onSuccess: (sheet) => {
      queryClient.setQueryData(engagementKeys.attendance(actorId, id, day), sheet);
    },
  });
}

export function useExportAttendance(id: string) {
  const { api } = useApi();
  return useMutation<AttendanceExport, unknown, string | undefined>({
    mutationFn: (format) => api.exportAttendance(id, format ?? "HRDC"),
  });
}

/**
 * The §3 action envelope. Every governed write on these two screens goes
 * through it, and every caller must handle all three outcomes — EXECUTED,
 * QUEUED_FOR_APPROVAL and SUGGESTED — because an approval is a success.
 *
 * `requestedBy` comes from `useMe()`, so the actor is the session's and never a
 * literal in a screen.
 */
export function usePerformAction() {
  const { api } = useApi();
  const queryClient = useQueryClient();
  const { me } = useMe();
  const requestedBy: Actor = { id: me.id, name: me.name, kind: "HUMAN" };

  return useMutation<ActionResponse, unknown, Omit<ActionRequest, "requestedBy">>({
    mutationFn: (request) =>
      api.performAction(
        { ...request, requestedBy },
        { idempotencyKey: `${request.type}:${request.targetRef}:${Date.now()}` },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: engagementKeys.all });
    },
  });
}
