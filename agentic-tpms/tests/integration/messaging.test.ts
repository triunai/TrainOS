import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db, one } from "@/server/db/client";
import { resetEnvCache } from "@/server/env";
import { sha256Hex } from "@/server/lib/crypto";
import { listOutboundMessages, sendMail, sendWhatsAppText, setGraphFetchForTests } from "@/server/messaging";
import { expectRefusal, releaseTestDatabase, useTestDatabase } from "../helpers/db";
import { makePackage } from "../helpers/factory";

const KEYS = ["SMTP_URL", "MAIL_FROM", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"];

beforeAll(useTestDatabase);
afterAll(releaseTestDatabase);
afterEach(() => {
  for (const key of KEYS) delete process.env[key];
  resetEnvCache();
  setGraphFetchForTests(undefined);
});

function setEnv(values: Record<string, string>) {
  Object.assign(process.env, values);
  resetEnvCache();
}

describe("sendMail", () => {
  it("without SMTP it LOGS the message, recording attachments by name and hash only", async () => {
    const pkg = await makePackage();
    const pdf = new TextEncoder().encode("%PDF-1.4 quotation");
    const result = await sendMail({
      to: "nurul@kenangaretail.com.my",
      subject: "Your quotation",
      text: "Please find the quotation attached.",
      html: "<p>Please find the quotation attached.</p>",
      attachments: [{ filename: "quotation.pdf", content: pdf, contentType: "application/pdf" }],
      packageId: pkg.id,
      kind: "QUOTATION",
    });
    expect(result.status).toBe("LOGGED");
    const row = await one<{ channel: string; status: string; package_id: string; attachments: unknown; body: string }>(
      db(),
      sql`select channel, status, package_id, attachments, body from tpms.outbound_messages where id = ${result.id}::uuid`,
    );
    expect(row).toMatchObject({ channel: "EMAIL", status: "LOGGED", package_id: pkg.id, body: "Please find the quotation attached." });
    expect(row?.attachments).toEqual([{ filename: "quotation.pdf", contentType: "application/pdf", sizeBytes: pdf.byteLength, sha256: sha256Hex(pdf) }]);
    const listed = await listOutboundMessages({ packageId: pkg.id });
    expect(listed.map((m) => m.id)).toEqual([result.id]);
  });

  it("refuses a bad recipient or kind before logging anything", async () => {
    await expect(sendMail({ to: "not-an-address", subject: "x", text: "y", kind: "TEST" })).rejects.toMatchObject({ code: "MAIL_INVALID_RECIPIENT" });
    await expect(sendMail({ to: "a@b.com.my", subject: "x", text: "y", kind: "lower case" })).rejects.toThrow(/UPPER_SNAKE_CASE/);
  });

  it("with SMTP configured, a transport failure is logged FAILED and rethrown without the SMTP password", async () => {
    setEnv({ SMTP_URL: "smtp://mailer:hunter2-secret@127.0.0.1:1", MAIL_FROM: "Alex Training <no-reply@alextraining.my>" });
    const error = await sendMail({ to: "ops@alextraining.my", subject: "Test", text: "Hello", kind: "TEST" }).then(
      () => new Error("expected the send to fail"),
      (e: unknown) => e as Error,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/^SMTP send failed/);
    expect(error.message).not.toContain("hunter2-secret");
    const row = await one<{ status: string; error: string }>(db(), sql`select status, error from tpms.outbound_messages where kind = 'TEST' and status = 'FAILED'`);
    expect(row?.status).toBe("FAILED");
    expect(row?.error).not.toContain("hunter2-secret");
  });

  it("SMTP without MAIL_FROM is a configuration refusal", async () => {
    setEnv({ SMTP_URL: "smtp://127.0.0.1:1" });
    await expect(sendMail({ to: "ops@alextraining.my", subject: "Test", text: "Hello", kind: "TEST" })).rejects.toMatchObject({ code: "MAIL_NOT_CONFIGURED" });
  });
});

describe("sendWhatsAppText", () => {
  it("without a token it LOGS", async () => {
    const result = await sendWhatsAppText({ toE164: "+60123456789", body: "Hello from the provider", kind: "MICRO_TNA" });
    expect(result).toMatchObject({ status: "LOGGED", providerMessageId: null });
  });

  it("with a token it calls the Cloud API with the bearer token, and records Meta's message id", async () => {
    setEnv({ WHATSAPP_ACCESS_TOKEN: "EAAG-test-token", WHATSAPP_PHONE_NUMBER_ID: "106540352242922" });
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    setGraphFetchForTests(async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ messaging_product: "whatsapp", contacts: [{ wa_id: "60123456789" }], messages: [{ id: "wamid.SENT123" }] }), {
        status: 200,
      });
    });
    const result = await sendWhatsAppText({ toE164: "+60123456789", body: "Is your company an active HRD Corp levy contributor?", kind: "MICRO_TNA" });
    expect(result).toMatchObject({ status: "SENT", providerMessageId: "wamid.SENT123" });
    expect(calls[0].url).toBe("https://graph.facebook.com/v20.0/106540352242922/messages");
    expect((calls[0].init?.headers as Record<string, string>).authorization).toBe("Bearer EAAG-test-token");
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ messaging_product: "whatsapp", to: "60123456789", type: "text" });
  });

  it("a Cloud API refusal is logged FAILED with Meta's reason and never echoes the token", async () => {
    setEnv({ WHATSAPP_ACCESS_TOKEN: "EAAG-test-token", WHATSAPP_PHONE_NUMBER_ID: "106540352242922" });
    setGraphFetchForTests(async () =>
      new Response(JSON.stringify({ error: { message: "(#131047) Re-engagement message: more than 24 hours since EAAG-test-token", code: 131047 } }), { status: 400 }),
    );
    await expect(sendWhatsAppText({ toE164: "+60123456789", body: "Hello again", kind: "MICRO_TNA" })).rejects.toThrow(/131047/);
    const row = await one<{ error: string }>(db(), sql`select error from tpms.outbound_messages where status = 'FAILED' and channel = 'WHATSAPP'`);
    expect(row?.error).toMatch(/Re-engagement/);
    expect(row?.error).not.toContain("EAAG-test-token");
  });

  it("refuses a number that is not E.164", async () => {
    await expect(sendWhatsAppText({ toE164: "0123456789", body: "x", kind: "MICRO_TNA" })).rejects.toMatchObject({ code: "WHATSAPP_INVALID_RECIPIENT" });
  });
});

describe("the message log is append-only", () => {
  it("refuses UPDATE and DELETE", async () => {
    const { id } = await sendMail({ to: "a@b.com.my", subject: "x", text: "y", kind: "TEST" });
    await expectRefusal(db().execute(sql`update tpms.outbound_messages set body = 'rewritten' where id = ${id}::uuid`), /OUTBOUND_LOG_APPEND_ONLY/);
    await expectRefusal(db().execute(sql`delete from tpms.outbound_messages where id = ${id}::uuid`), /OUTBOUND_LOG_APPEND_ONLY/);
  });

  it("a FAILED row must carry an error and a SENT row a provider id", async () => {
    await expectRefusal(
      db().execute(sql`insert into tpms.outbound_messages (channel, kind, to_address, body, status) values ('EMAIL', 'TEST', 'a@b.my', 'x', 'FAILED')`),
      /outbound_failed_has_error/,
    );
    await expectRefusal(
      db().execute(sql`insert into tpms.outbound_messages (channel, kind, to_address, body, status) values ('EMAIL', 'TEST', 'a@b.my', 'x', 'SENT')`),
      /outbound_sent_has_provider_id/,
    );
  });
});
