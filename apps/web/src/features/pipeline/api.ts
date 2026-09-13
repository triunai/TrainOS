import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ActionResponse,
  AnyActionType,
  Opportunity,
  OpportunityStage,
  OpportunityStageChangePayload,
  PageRequest,
  PipelineStage,
} from "@trainos/contract";
import { describeActionError, type ActionError } from "@/shared/components/kit";
import { queryKeys, useAction, useActor, useApi } from "@/shared/api";

/**
 * The pipeline data layer.
 *
 * Both reads are returned whole. The stage list is not decoration here — it IS
 * the board, so a failure to load it has to reach the screen rather than render
 * as a board with no columns.
 */

/** §5 `GET /v1/config/pipelines?object=OPPORTUNITY`. The lanes, in order. */
export function usePipelineStages() {
  const client = useApi();
  return useQuery({
    queryKey: [...queryKeys.pipelineConfig, "OPPORTUNITY"] as const,
    queryFn: () => client.getPipelineConfig("OPPORTUNITY"),
  });
}

/**
 * §5 `GET /v1/opportunities`. The cards.
 *
 * THE ROWS ARE COPIED, and that is not defensiveness for its own sake. The
 * fixture client answers a read with the store's OWN objects, so the row this
 * query caches is the row `POST /v1/actions` then mutates in place. React Query
 * compares the refetch against the cache to decide whether anything changed,
 * and against a cache that has already been mutated the answer is always no —
 * the deal moves in the data and stays put on the screen, which is exactly what
 * this board did until the copy was added. An HTTP client parsing a fresh body
 * would never have handed the app a live reference; taking one is the bug, and
 * copying at the boundary is where it stops.
 */
export function useOpportunities(page?: PageRequest) {
  const client = useApi();
  return useQuery({
    queryKey: queryKeys.opportunities.list(page),
    queryFn: async () => {
      const response = await client.listOpportunities(page);
      return { ...response, data: response.data.map((row) => ({ ...row })) };
    },
  });
}

/** §6 `GET /v1/tnas`. Read for one string per card — see `topicOf`. */
export function useTnas() {
  const client = useApi();
  return useQuery({
    queryKey: queryKeys.tnas.list(),
    queryFn: () => client.listTnas({ page: { size: 200 } }),
  });
}

/* ------------------------------------------------------------------ *
 * Moving a deal between stages
 * ------------------------------------------------------------------ */

/**
 * The action a drag between lanes sends.
 *
 * It did not exist when this board was rebuilt. §3's `ACTION_TYPES` carried
 * `OPPORTUNITY_CONVERT` — an enquiry BECOMING an opportunity — and nothing that
 * moved an opportunity that already existed, so every write R1 requires had to
 * go through a type that meant something else. Ruling R18 closed that gap and
 * this is the type it added, kept out of `ACTION_TYPES` so the §3 nineteen stay
 * verbatim.
 *
 * Naming it here rather than inline is the point: when the contract renames it,
 * one constant moves and the compiler finds the rest.
 */
export const STAGE_CHANGE_ACTION = "OPPORTUNITY_STAGE_CHANGE" satisfies AnyActionType;

export interface StageMove {
  opportunity: Opportunity;
  to: PipelineStage;
}

/**
 * Propose a stage change and keep the one outcome the board renders.
 *
 * Every §3 outcome is a value: EXECUTED moved it, QUEUED_FOR_APPROVAL means a
 * policy intercepted the write and the deal has NOT moved yet, SUGGESTED means
 * it was never attempted, and a refusal is the server answering. All four reach
 * the same banner, because a board that renders only the first silently loses
 * the other three — and the refusal this one most needs to show is the stale
 * move: `fromStage` is what the board BELIEVED, and the server says so when
 * somebody else has already moved the deal underneath it.
 */
export function useMoveDealStage() {
  const action = useAction();
  const actor = useActor();
  const queryClient = useQueryClient();

  const [subject, setSubject] = useState<string | null>(null);
  const [response, setResponse] = useState<ActionResponse | undefined>(undefined);
  const [error, setError] = useState<ActionError | undefined>(undefined);

  const dismiss = useCallback(() => {
    setSubject(null);
    setResponse(undefined);
    setError(undefined);
  }, []);

  const move = useCallback(
    ({ opportunity, to }: StageMove) => {
      setSubject(`${opportunity.ref} → ${to.label}`);
      setResponse(undefined);
      setError(undefined);

      /* `satisfies`, not an annotation: §3 types `ActionRequest.payload` as an
         open `Record<string, unknown>`, which a named interface is not
         assignable to. This still makes a wrong field a compile error while
         keeping the literal's own inferred type, which is. */
      const payload = {
        stage: to.key as OpportunityStage,
        /* What the BOARD believed. Sending it is what lets the server refuse a
           move computed from a stale read instead of silently applying it over
           somebody else's. */
        fromStage: opportunity.stage,
        /* §5 asks for a reason on a move that ENDS a deal, and `terminal` is
           the configuration that says which those are. The board has no prompt
           to ask through, so it states the provenance it actually has rather
           than inventing a business justification it does not. */
        ...(to.terminal ? { reason: `Moved to ${to.label} on the pipeline board` } : {}),
      } satisfies OpportunityStageChangePayload;

      action.mutate(
        {
          type: STAGE_CHANGE_ACTION,
          targetRef: opportunity.ref,
          payload,
          requestedBy: actor,
        },
        {
          onSuccess: (result) => {
            if (result.kind === "error") {
              setError(describeActionError(result.error, "The deal did not move"));
              return;
            }
            setResponse(result.response);
            /* Only an EXECUTED move changed the board. Invalidating on a queued
               approval would refetch the same rows and tell the reader their
               pending write had landed.

               The board then RE-READS rather than moving the card locally: the
               lanes regroup from the refetch, so the screen can never disagree
               with the server about where a deal is. That works only because
               the rows above are copies — see `useOpportunities`. */
            if (result.kind === "EXECUTED") {
              void queryClient.invalidateQueries({ queryKey: queryKeys.opportunities.all });
            }
          },
        },
      );
    },
    [action, actor, queryClient],
  );

  return { move, dismiss, subject, response, error, isPending: action.isPending };
}
