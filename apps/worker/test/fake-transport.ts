/**
 * The SQL functions, mocked at the transport.
 *
 * The seam is deliberately at {@link SqlTransport} rather than at
 * {@link JobsRpc}: mocking the RPC class would leave the statements and their
 * bound parameters untested, and those are the part that has to match
 * migration 012 exactly. Here every test sees the real SQL text and the real
 * argument order.
 */

import type { SqlTransport } from "../src/transport";

export interface RecordedCall {
  text: string;
  params: readonly unknown[];
}

type Responder = (params: readonly unknown[]) => unknown[] | Promise<unknown[]>;

export class FakeTransport implements SqlTransport {
  readonly calls: RecordedCall[] = [];
  closed = false;

  private readonly routes: Array<{ match: string; respond: Responder }> = [];

  /** Answer any statement containing `match`. Later registrations win. */
  on(match: string, respond: Responder | unknown[]): this {
    this.routes.unshift({
      match,
      respond: typeof respond === "function" ? (respond as Responder) : () => respond,
    });
    return this;
  }

  async query<Row = Record<string, unknown>>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<Row[]> {
    this.calls.push({ text, params });
    const route = this.routes.find((entry) => text.includes(entry.match));
    if (!route) return [] as Row[];
    return (await route.respond(params)) as Row[];
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  /** Every call whose statement mentions `fragment`, in order. */
  callsTo(fragment: string): RecordedCall[] {
    return this.calls.filter((call) => call.text.includes(fragment));
  }

  paramsFor(fragment: string): readonly unknown[] {
    const call = this.callsTo(fragment)[0];
    if (!call)
      throw new Error(
        `no call matching ${fragment}; saw ${this.calls.map((c) => c.text).join(" | ")}`,
      );
    return call.params;
  }
}

export const TENANT = "11111111-1111-4111-8111-111111111111";

export function fakeJob(overrides: Partial<import("../src/jobs/types").OutboxJob> = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    tenant_id: TENANT,
    job_type: "SEND_EMAIL",
    state: "CLAIMED" as const,
    priority: 1,
    payload: {},
    event_id: null,
    run_id: null,
    action_request_id: null,
    correlation_id: "33333333-3333-4333-8333-333333333333",
    effect_id: null,
    job_key: null,
    idempotency_subject: null,
    submission_attempt: null,
    attempts: 1,
    max_attempts: 5,
    run_after: "2026-09-13T00:00:00.000Z",
    claimed_at: "2026-09-13T00:00:01.000Z",
    claimed_by: "worker-test",
    visible_after: "2026-09-13T00:05:01.000Z",
    ...overrides,
  };
}
