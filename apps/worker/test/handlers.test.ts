import { describe, expect, it } from "vitest";
import { buildHandlers, dispatch, JOB_TYPES, UNIMPLEMENTED_012_JOB_TYPES } from "../src/handlers";
import {
  classify,
  createSendEmailHandler,
  providerIdempotencyKey,
  type EmailMessage,
} from "../src/handlers/send-email";
import {
  classifyMetaError,
  createWhatsAppSendHandler,
  RETRYABLE_META_CODES,
} from "../src/handlers/whatsapp-send";
import { createOutboxPublishHandler, readEvent } from "../src/handlers/outbox-publish";
import { createLogger } from "../src/logging";
import type { JobContext, OutboxJob } from "../src/jobs/types";
import { fakeJob } from "./fake-transport";

function ctxFor(job: OutboxJob, keys: Record<string, string> = {}): JobContext {
  return {
    job,
    workerId: "worker-handlers",
    heartbeat: async () => {},
    keys: {
      get: async (provider) => keys[provider],
      list: async () => Object.keys(keys),
    },
    log: createLogger({ level: "error", sink: () => {} }),
    signal: new AbortController().signal,
  };
}

describe("SEND_EMAIL", () => {
  it("sends and reports the provider message id with an event", async () => {
    const seen: EmailMessage[] = [];
    const send = async (message: EmailMessage) => {
      seen.push(message);
      return { providerMessageId: "msg_1" };
    };
    const handler = createSendEmailHandler({ sender: { send }, defaultFrom: "ops@trainos.test" });
    const outcome = await handler(
      ctxFor(
        fakeJob({ payload: { to: "alex@example.test", subject: "Proposal", html: "<p>hi</p>" } }),
      ),
    );

    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome).toMatchObject({ result: { providerMessageId: "msg_1" } });
    expect(seen[0]).toMatchObject({ from: "ops@trainos.test", to: ["alex@example.test"] });
  });

  it("presents 012's <subject>#<attempt> as the provider idempotency key", async () => {
    const seen: EmailMessage[] = [];
    const send = async (message: EmailMessage) => {
      seen.push(message);
      return { providerMessageId: "msg_2" };
    };
    const handler = createSendEmailHandler({ sender: { send }, defaultFrom: "ops@trainos.test" });
    const job = fakeJob({
      payload: { to: ["a@example.test"], subject: "s" },
      idempotency_subject: "proposal:PRO-0114",
      submission_attempt: 2,
    });

    await handler(ctxFor(job));
    expect(seen[0]?.idempotencyKey).toBe("proposal:PRO-0114#2");
    expect(providerIdempotencyKey(ctxFor(job))).toBe("proposal:PRO-0114#2");
  });

  it("has no idempotency key when 012 put neither column on the row", () => {
    expect(providerIdempotencyKey(ctxFor(fakeJob()))).toBeNull();
  });

  it("dies immediately on a malformed payload rather than burning five attempts", async () => {
    const handler = createSendEmailHandler({
      sender: { send: async () => ({ providerMessageId: "x" }) },
      defaultFrom: null,
    });
    const outcome = await handler(ctxFor(fakeJob({ payload: { subject: "s" } })));
    expect(outcome).toMatchObject({
      status: "FAILED",
      error: { code: "INVALID_EMAIL_PAYLOAD", retryable: false },
    });
    expect((outcome as { error: { message: string } }).error.message).toContain("to");
  });

  it("refuses, not retryably, when no provider is configured", async () => {
    const handler = createSendEmailHandler({ sender: null, defaultFrom: "ops@trainos.test" });
    const outcome = await handler(ctxFor(fakeJob({ payload: { to: "a@b.test", subject: "s" } })));
    expect(outcome).toMatchObject({
      status: "FAILED",
      error: { code: "EMAIL_PROVIDER_NOT_CONFIGURED", retryable: false },
    });
  });

  it("classifies 429 and 5xx as transient and 4xx as terminal", () => {
    expect(classify(Object.assign(new Error("rate"), { status: 429 })).retryable).toBe(true);
    expect(classify(Object.assign(new Error("boom"), { status: 503 })).retryable).toBe(true);
    expect(classify(Object.assign(new Error("bad"), { status: 422 })).retryable).toBe(false);
    expect(classify(new Error("ECONNRESET"))).toMatchObject({
      code: "EMAIL_TRANSPORT_ERROR",
      retryable: true,
    });
  });
});

describe("WHATSAPP_SEND", () => {
  it("is a stub that names the missing SQL instead of half-sending", async () => {
    const handler = createWhatsAppSendHandler({ enabled: false });
    const outcome = await handler(
      ctxFor(fakeJob({ payload: { to: "+60123", template: "reminder" } })),
    );
    expect(outcome).toMatchObject({
      status: "FAILED",
      error: { code: "WHATSAPP_NOT_IMPLEMENTED", retryable: false },
    });
    expect((outcome as { error: { message: string } }).error.message).toMatch(/allowance ledger/);
  });

  it("still validates the payload before it refuses", async () => {
    const handler = createWhatsAppSendHandler({ enabled: false });
    const outcome = await handler(ctxFor(fakeJob({ payload: {} })));
    expect(outcome).toMatchObject({
      status: "FAILED",
      error: { code: "INVALID_WHATSAPP_PAYLOAD" },
    });
  });

  it("classifies Meta codes ahead of the HTTP status", () => {
    const retryableCode = [...RETRYABLE_META_CODES][0]!;
    expect(classifyMetaError({ code: retryableCode, status: 400 }).retryable).toBe(true);
    expect(classifyMetaError({ code: 131047, status: 400 }).retryable).toBe(false);
    expect(classifyMetaError({ status: 500 })).toMatchObject({
      code: "WHATSAPP_HTTP_500",
      retryable: true,
    });
  });
});

describe("OUTBOX_PUBLISH", () => {
  it("hands the event to complete_job so it is emitted in the same transaction", async () => {
    const handler = createOutboxPublishHandler();
    const outcome = await handler(
      ctxFor(
        fakeJob({
          job_type: "OUTBOX_PUBLISH",
          payload: {
            event: {
              type: "ProposalSent",
              aggregateType: "PROPOSAL",
              aggregateId: "55555555-5555-4555-8555-555555555555",
              summary: "Proposal PRO-0114 sent",
            },
          },
        }),
      ),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome).toMatchObject({ event: { type: "ProposalSent" }, result: { published: true } });
  });

  it("refuses an event missing a key 012 requires", async () => {
    const handler = createOutboxPublishHandler();
    const outcome = await handler(
      ctxFor(fakeJob({ payload: { event: { type: "X", aggregateType: "Y" } } })),
    );
    expect(outcome).toMatchObject({
      status: "FAILED",
      error: { code: "INVALID_OUTBOX_EVENT", retryable: false },
    });
  });

  it("falls back to the job itself as the aggregate so the drawer always has a subject", () => {
    const event = readEvent({ type: "X", aggregateType: "OUTBOX", summary: "s" }, "job-1");
    expect(event?.aggregateId).toBe("job-1");
  });
});

describe("the registry", () => {
  it("serves exactly the four implemented job types", () => {
    const handlers = buildHandlers({
      sliceWallClockMs: 1_000,
      email: { apiKey: null, from: null, endpoint: "https://example.test" },
      whatsapp: { enabled: false },
      emailSender: null,
    });
    expect(Object.keys(handlers).sort()).toEqual(Object.values(JOB_TYPES).sort());
  });

  it("names the 012 job types it does not serve rather than leaving them implicit", () => {
    const handlers = buildHandlers({
      sliceWallClockMs: 1_000,
      email: { apiKey: null, from: null, endpoint: "https://example.test" },
      whatsapp: { enabled: false },
      emailSender: null,
    });
    for (const type of UNIMPLEMENTED_012_JOB_TYPES) {
      expect(handlers[type]).toBeUndefined();
    }
  });

  it("fails an unknown type without retrying it", async () => {
    const outcome = await dispatch({}, ctxFor(fakeJob({ job_type: "USAGE_ROLLUP" })));
    expect(outcome).toMatchObject({
      status: "FAILED",
      error: { code: "UNKNOWN_JOB_TYPE", retryable: false },
    });
  });
});
