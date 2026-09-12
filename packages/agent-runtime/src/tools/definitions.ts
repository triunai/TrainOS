/**
 * Tool schemas.
 *
 * Every tool is declared once, as a zod schema, and the JSON Schema the model
 * sees is derived from it. One declaration means the validation the adapter
 * runs and the contract the model was shown cannot disagree — which is the
 * failure mode worth designing against, because a model that hallucinates an
 * argument name should get a typed error back, not a silent `undefined`
 * halfway down a fixture lookup.
 *
 * The JSON Schema is written by hand alongside each zod schema rather than
 * generated, because the descriptions are prompt engineering: they are the
 * only place the model learns that `ref` means `ENQ-2026-0912` and not a UUID.
 */

import { z } from 'zod';
import type { LLMToolDef } from '../providers/types';
import { WIRE_NAMES, type ToolOperation } from './adapter';

/* ------------------------------------------------------------------ *
 * Argument schemas
 * ------------------------------------------------------------------ */

export const enquiriesGetArgs = z.object({
  ref: z.string().describe('Business reference, e.g. ENQ-2026-0912'),
});

export const organisationsSearchArgs = z.object({
  query: z.string().describe('Company name, or an email domain such as auroramfg.com.my'),
});

export const programmesSearchArgs = z.object({
  query: z.string().describe('What the client asked for, in their words'),
  tags: z.array(z.string()).optional().describe('Optional topic filters, e.g. ["leadership"]'),
});

export const trainersAvailabilityArgs = z.object({
  programmeRef: z.string().describe('Programme reference, e.g. PRG-0031'),
  from: z.string().describe('Window start, YYYY-MM-DD'),
  to: z.string().describe('Window end, YYYY-MM-DD'),
});

export const quotationsComputeArgs = z.object({
  programmeRef: z.string().describe('Programme reference, e.g. PRG-0031'),
  pax: z.number().int().positive().describe('Number of participants'),
  days: z.number().int().positive().optional().describe("Defaults to the programme's own duration"),
  discountRate: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Decimal fraction, e.g. 0.05 for 5%. Omit for list price.'),
});

export const proposalsDraftArgs = z.object({
  organisationRef: z.string().describe('Organisation reference, e.g. ORG-0114'),
  programmeRef: z.string().describe('Programme reference, e.g. PRG-0031'),
  quotationRef: z.string().describe('Quotation reference from quotations_compute'),
  sections: z
    .array(
      z.object({
        key: z.string(),
        heading: z.string(),
        body: z.string(),
      }),
    )
    .optional()
    .describe('Your drafted sections. Omit to use the template defaults.'),
});

export const actionsPerformArgs = z.object({
  type: z.string().describe('Action type, e.g. PROPOSAL_SEND'),
  targetRef: z.string().describe('The record the action acts on, e.g. PRO-2026-0184'),
  payload: z.record(z.unknown()).optional().describe('Type-specific payload'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Your confidence in this action, 0-1. Be honest; it gates autonomy.'),
  reasoning: z.string().optional().describe('One or two sentences. Rendered to the approver.'),
  evidence: z
    .array(
      z.object({
        type: z.string(),
        ref: z.string(),
        excerpt: z.string().optional(),
      }),
    )
    .optional()
    .describe('Citations for your recommendation. The approval screen numbers these.'),
});

export const ARG_SCHEMAS: Readonly<Record<ToolOperation, z.ZodTypeAny>> = {
  'enquiries.get': enquiriesGetArgs,
  'organisations.search': organisationsSearchArgs,
  'programmes.search': programmesSearchArgs,
  'trainers.availability': trainersAvailabilityArgs,
  'quotations.compute': quotationsComputeArgs,
  'proposals.draft': proposalsDraftArgs,
  'actions.perform': actionsPerformArgs,
};

/* ------------------------------------------------------------------ *
 * JSON Schema for the wire
 * ------------------------------------------------------------------ */

type JsonSchema = Record<string, unknown>;

const str = (description: string): JsonSchema => ({ type: 'string', description });

const TOOL_SCHEMAS: Readonly<Record<ToolOperation, { description: string; parameters: JsonSchema }>> =
  {
    'enquiries.get': {
      description:
        'Read one enquiry in full: sender, subject, body and received time. Start here — never guess what the client asked for.',
      parameters: {
        type: 'object',
        properties: { ref: str('Business reference, e.g. ENQ-2026-0912') },
        required: ['ref'],
        additionalProperties: false,
      },
    },
    'organisations.search': {
      description:
        'Find the organisation an enquiry came from. Matches on exact email domain first, then fuzzy name. Returns why it matched and how confident that match is.',
      parameters: {
        type: 'object',
        properties: {
          query: str('Company name, or an email domain such as auroramfg.com.my'),
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    'programmes.search': {
      description:
        'Rank catalogue programmes against what the client needs. Returns a fit score, list price, duration and whether the programme is HRD Corp claimable.',
      parameters: {
        type: 'object',
        properties: {
          query: str("What the client asked for, in their own words"),
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional topic filters, e.g. ["leadership"]',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    'trainers.availability': {
      description:
        'Which accredited trainers can deliver a programme in a date window. A trainer without a valid TTT certificate is not an option, regardless of availability.',
      parameters: {
        type: 'object',
        properties: {
          programmeRef: str('Programme reference, e.g. PRG-0031'),
          from: str('Window start, YYYY-MM-DD'),
          to: str('Window end, YYYY-MM-DD'),
        },
        required: ['programmeRef', 'from', 'to'],
        additionalProperties: false,
      },
    },
    'quotations.compute': {
      description:
        'Price a programme for a headcount. Returns lines, net, SST, total, cost, margin rate and the floor it must clear. Lines are truth and totals are their sum — never quote a total you computed yourself.',
      parameters: {
        type: 'object',
        properties: {
          programmeRef: str('Programme reference, e.g. PRG-0031'),
          pax: { type: 'integer', minimum: 1, description: 'Number of participants' },
          days: {
            type: 'integer',
            minimum: 1,
            description: "Defaults to the programme's own duration",
          },
          discountRate: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: 'Decimal fraction, e.g. 0.05 for 5%. Omit for list price.',
          },
        },
        required: ['programmeRef', 'pax'],
        additionalProperties: false,
      },
    },
    'proposals.draft': {
      description:
        'Assemble a proposal from a programme, a quotation and your drafted sections. Creates a DRAFT record; it does not send anything.',
      parameters: {
        type: 'object',
        properties: {
          organisationRef: str('Organisation reference, e.g. ORG-0114'),
          programmeRef: str('Programme reference, e.g. PRG-0031'),
          quotationRef: str('Quotation reference from quotations_compute'),
          sections: {
            type: 'array',
            description: 'Your drafted sections. Omit to use the template defaults.',
            items: {
              type: 'object',
              properties: {
                key: str('Stable section key, e.g. objectives'),
                heading: str('Section heading as the client will read it'),
                body: str('Section body'),
              },
              required: ['key', 'heading', 'body'],
              additionalProperties: false,
            },
          },
        },
        required: ['organisationRef', 'programmeRef', 'quotationRef'],
        additionalProperties: false,
      },
    },
    'actions.perform': {
      description:
        'The only way to change anything. Submits an action to the policy gate, which decides whether it executes, queues for a human approval, or comes back as a suggestion. Expect to be stopped: being queued for approval is a correct outcome, not a failure.',
      parameters: {
        type: 'object',
        properties: {
          type: str('Action type, e.g. PROPOSAL_SEND'),
          targetRef: str('The record the action acts on, e.g. PRO-2026-0184'),
          payload: { type: 'object', description: 'Type-specific payload' },
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: 'Your confidence in this action, 0-1. Be honest; it gates autonomy.',
          },
          reasoning: str('One or two sentences. Rendered to the approver.'),
          evidence: {
            type: 'array',
            description: 'Citations for your recommendation. The approval screen numbers these.',
            items: {
              type: 'object',
              properties: {
                type: str('Evidence type, e.g. TNA, PROGRAMME, QUOTATION'),
                ref: str('The record cited'),
                excerpt: str('The words that matter, if any'),
              },
              required: ['type', 'ref'],
              additionalProperties: false,
            },
          },
        },
        required: ['type', 'targetRef'],
        additionalProperties: false,
      },
    },
  };

/** The tool definition sent to a model, for one operation. */
export function toolDefFor(op: ToolOperation): LLMToolDef {
  const schema = TOOL_SCHEMAS[op];
  return {
    name: WIRE_NAMES[op],
    description: schema.description,
    parameters: schema.parameters,
  };
}

/** Tool definitions for a set of operations, in the order given. */
export function toolDefsFor(ops: readonly ToolOperation[]): LLMToolDef[] {
  return ops.map(toolDefFor);
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

export interface ValidationFailure {
  ok: false;
  message: string;
}

export interface ValidationSuccess<T> {
  ok: true;
  value: T;
}

/**
 * Validate a model's tool arguments.
 *
 * Returns a failure rather than throwing, because the right response to bad
 * arguments is a `tool_result` the model can read and correct — not an
 * exception that kills the run. A model that gets told "ref is required" on
 * turn three usually fixes it on turn four.
 */
export function validateArgs(
  op: ToolOperation,
  args: Record<string, unknown>,
): ValidationSuccess<Record<string, unknown>> | ValidationFailure {
  const schema = ARG_SCHEMAS[op];
  const parsed = schema.safeParse(args);
  if (parsed.success) return { ok: true, value: parsed.data as Record<string, unknown> };
  const detail = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
  return { ok: false, message: `Invalid arguments for ${op} — ${detail}` };
}
