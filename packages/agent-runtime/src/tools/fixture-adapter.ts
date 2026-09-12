/**
 * The one file that changes when `@trainos/fixtures` ships.
 *
 * It binds the seven tool operations to a {@link ToolContext}. Today that
 * context is `LocalFixtureClient`; when the fixtures package exports
 * `createFixtureClient`, the only edit is the import and the default in
 * {@link createFixtureToolAdapter} — everything above this file, the whole
 * orchestrator included, is untouched.
 *
 * Nothing here calls a network. That is the point: a demo agent making real
 * model calls against real-looking data must not be able to email a client.
 */

import { ZodError } from 'zod';
import type { ActionRequest, GovernedActionType } from '@trainos/contract';
import { createLocalFixtureClient } from '../fixtures/local-client';
import {
  type ToolAdapter,
  type ToolContext,
  type ToolOperation,
  type ToolResult,
  TOOL_OPERATIONS,
} from './adapter';
import {
  actionsPerformArgs,
  enquiriesGetArgs,
  organisationsSearchArgs,
  programmesSearchArgs,
  proposalsDraftArgs,
  quotationsComputeArgs,
  trainersAvailabilityArgs,
} from './definitions';

/**
 * The argument shapes, taken from `ToolContext` so they cannot drift from the
 * methods they are passed to.
 *
 * These exist because zod's inferred output type is only trustworthy under
 * `strictNullChecks`. A consumer compiling with `strict: false` — `apps/web`
 * does — makes `undefined` assignable to everything, zod's inference marks
 * every key optional, and passing a parsed object into a method with required
 * parameters stops compiling. The package's own tsconfig is strict, so this
 * never showed up here; it showed up in somebody else's build.
 *
 * The assertion is honest rather than a silencer: `.parse()` throws unless the
 * data matches the schema, so by the time one of these is applied the shape is
 * a runtime fact. What is being restored is the compile-time knowledge the
 * consumer's configuration threw away.
 */
type ComputeQuotationArgs = Parameters<ToolContext['computeQuotation']>[0];
type DraftProposalArgs = Parameters<ToolContext['draftProposal']>[0];
type SearchProgrammesArgs = Parameters<ToolContext['searchProgrammes']>;
type TrainerAvailabilityArgs = Parameters<ToolContext['trainerAvailability']>;

/**
 * How many characters of a tool result a node may read before the adapter
 * trims it and emits a `TRUNCATION`.
 *
 * Generous, because the fixture payloads are small; the mechanism is what
 * matters, since a production `organisations.search` over a real tenant will
 * hit it constantly.
 */
export const DEFAULT_TRUNCATION_LIMIT = 8_000;

export interface FixtureToolAdapterOptions {
  context?: ToolContext;
  /** Who the agent acts as. Appears on every `ActionRequest.requestedBy`. */
  agentId: string;
  truncationLimit?: number;
}

export class FixtureToolAdapter implements ToolAdapter {
  readonly context: ToolContext;

  private readonly agentId: string;
  private readonly truncationLimit: number;

  constructor(opts: FixtureToolAdapterOptions) {
    this.context = opts.context ?? createLocalFixtureClient();
    this.agentId = opts.agentId;
    this.truncationLimit = opts.truncationLimit ?? DEFAULT_TRUNCATION_LIMIT;
  }

  supports(op: ToolOperation): boolean {
    return (TOOL_OPERATIONS as readonly string[]).includes(op);
  }

  async execute(op: ToolOperation, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const data = this.dispatch(op, args);
      return this.trim(data);
    } catch (cause) {
      if (cause instanceof ZodError) {
        return {
          ok: false,
          data: null,
          error: {
            code: 'VALIDATION_FAILED',
            message: cause.issues
              .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
              .join('; '),
          },
        };
      }
      return {
        ok: false,
        data: null,
        error: {
          code: 'TOOL_ERROR',
          message: cause instanceof Error ? cause.message : String(cause),
        },
      };
    }
  }

  private dispatch(op: ToolOperation, args: Record<string, unknown>): unknown {
    switch (op) {
      case 'enquiries.get': {
        const { ref } = enquiriesGetArgs.parse(args) as { ref: string };
        const enquiry = this.context.getEnquiry(ref);
        if (!enquiry) throw new Error(`No enquiry ${ref}`);
        return enquiry;
      }
      case 'organisations.search': {
        const { query } = organisationsSearchArgs.parse(args) as { query: string };
        return { matches: this.context.searchOrganisations(query) };
      }
      case 'programmes.search': {
        const { query, tags } = programmesSearchArgs.parse(args) as {
          query: SearchProgrammesArgs[0];
          tags: SearchProgrammesArgs[1];
        };
        return { matches: this.context.searchProgrammes(query, tags) };
      }
      case 'trainers.availability': {
        const { programmeRef, from, to } = trainersAvailabilityArgs.parse(args) as {
          programmeRef: TrainerAvailabilityArgs[0];
          from: TrainerAvailabilityArgs[1];
          to: TrainerAvailabilityArgs[2];
        };
        return { trainers: this.context.trainerAvailability(programmeRef, from, to) };
      }
      case 'quotations.compute': {
        const parsed = quotationsComputeArgs.parse(args) as ComputeQuotationArgs;
        return this.context.computeQuotation(parsed);
      }
      case 'proposals.draft': {
        const parsed = proposalsDraftArgs.parse(args) as DraftProposalArgs;
        return this.context.draftProposal(parsed);
      }
      case 'actions.perform': {
        const parsed = actionsPerformArgs.parse(args) as {
          type: string;
          targetRef: string;
          payload?: Record<string, unknown>;
          confidence?: number;
          reasoning?: string;
          evidence?: Array<{ type: string; ref: string; excerpt?: string }>;
        };
        const request: ActionRequest = {
          type: parsed.type as ActionRequest['type'],
          targetRef: parsed.targetRef,
          payload: parsed.payload,
          requestedBy: { kind: 'AGENT', id: this.agentId },
          confidence: parsed.confidence,
          reasoning: parsed.reasoning,
          evidence: parsed.evidence?.map((e) => ({
            type: e.type as NonNullable<ActionRequest['evidence']>[number]['type'],
            ref: e.ref,
            excerpt: e.excerpt,
          })),
        };
        return this.context.performAction(request);
      }
    }
  }

  /**
   * Trim an oversized payload and say so.
   *
   * The model is told, in the result it reads, that more exists — otherwise it
   * reasons over a truncated list believing it saw everything, which is worse
   * than a short answer.
   */
  private trim(data: unknown): ToolResult {
    const serialised = JSON.stringify(data);
    if (serialised.length <= this.truncationLimit) return { ok: true, data };

    const storedTokens = Math.ceil(serialised.length / 4);
    return {
      ok: true,
      data: {
        truncated: true,
        note: `Result trimmed to ${this.truncationLimit} characters. Narrow the query to see the rest.`,
        preview: serialised.slice(0, this.truncationLimit),
      },
      truncated: { storedTokens, fetchMoreAvailable: true },
    };
  }
}

/** Build the adapter over the local fixture client. */
export function createFixtureToolAdapter(opts: FixtureToolAdapterOptions): FixtureToolAdapter {
  return new FixtureToolAdapter(opts);
}

/**
 * The action type an operation submits, for budget and routing attribution.
 *
 * Only `actions.perform` carries one, and the type is whatever the agent
 * asked for. A read tool spends against the agent's budget but never against
 * an action type's.
 */
export function actionTypeOf(
  op: ToolOperation,
  args: Record<string, unknown>,
): GovernedActionType | undefined {
  if (op !== 'actions.perform') return undefined;
  const type = args['type'];
  return typeof type === 'string' ? (type as GovernedActionType) : undefined;
}
