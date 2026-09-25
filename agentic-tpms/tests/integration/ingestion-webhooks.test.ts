import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db, one, rows } from "@/server/db/client";
import { resetEnvCache } from "@/server/env";
import { getLead } from "@/server/ingestion/queries";
import { sendMicroTna } from "@/server/ingestion/microTna";
import { triageLead } from "@/server/ingestion/triage";
import { GET as leadGET, POST as leadPOST } from "@/app/api/v1/leads/webhook/[channel]/route";
import { POST as mailPOST } from "@/app/api/v1/mail/inbound/route";
import { GET as waGET, POST as waPOST } from "@/app/api/v1/whatsapp/webhook/route";
import { fixture } from "../fixtures/payloads/load";
import { releaseTestDatabase, useTestDatabase } from "../helpers/db";
import { makeOperator } from "../helpers/factory";

const SECRETS = ["META_APP_SECRET", "META_VERIFY_TOKEN", "WHATSAPP_VERIFY_TOKEN", "INBOUND_MAIL_SECRET", "GOOGLE_WEBHOOK_KEY", "LEAD_WEBHOOK_SECRET"];

function setEnv(values: Record<string, string>) {
  Object.assign(process.env, values);
  resetEnvCache();
}

beforeAll(async () => {
  await useTestDatabase();
  await makeOperator();
});
afterAll(releaseTestDatabase);
afterEach(() => {
  for (const key of SECRETS) delete process.env[key];
  resetEnvCache();
});

const sign = (body: string, secret: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

function post(url: string, body: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { method: "POST", body, headers: { "content-type": "application/json", ...headers } });
}

const params = (channel: string) => ({ params: { channel } });

async function leadCount(): Promise<number> {
  const row = await one<{ n: number }>(db(), sql`select count(*)::int as n from tpms.lead_records`);
  return row?.n ?? 0;
}

describe("Meta lead webhook", () => {
  it("answers the subscription handshake only with the right verify token", async () => {
    setEnv({ META_VERIFY_TOKEN: "tpms-verify-123" });
    const ok = await leadGET(
      new Request("http://x/api/v1/leads/webhook/meta?hub.mode=subscribe&hub.verify_token=tpms-verify-123&hub.challenge=1158201444"),
      params("meta"),
    );
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("1158201444");
    const bad = await leadGET(new Request("http://x/api/v1/leads/webhook/meta?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1"), params("meta"));
    expect(bad.status).toBe(403);
  });

  it("accepts a correctly signed body and refuses an invalid or missing signature before storing anything", async () => {
    setEnv({ META_APP_SECRET: "meta-app-secret-for-tests" });
    const body = JSON.stringify(fixture("meta-leadgen-webhook.json"));
    const before = await leadCount();

    const forged = await leadPOST(post("http://x/api/v1/leads/webhook/meta", body, { "x-hub-signature-256": sign(body, "wrong-secret") }), params("meta"));
    expect(forged.status).toBe(401);
    const missing = await leadPOST(post("http://x/api/v1/leads/webhook/meta", body), params("meta"));
    expect(missing.status).toBe(401);
    const tampered = await leadPOST(
      post("http://x/api/v1/leads/webhook/meta", body.replace("1234567890123456", "1234567890123999"), { "x-hub-signature-256": sign(body, "meta-app-secret-for-tests") }),
      params("meta"),
    );
    expect(tampered.status).toBe(401);
    expect(await leadCount()).toBe(before);

    const started = performance.now();
    const ok = await leadPOST(post("http://x/api/v1/leads/webhook/meta", body, { "x-hub-signature-256": sign(body, "meta-app-secret-for-tests") }), params("meta"));
    const elapsed = performance.now() - started;
    expect(ok.status).toBe(200);
    expect(elapsed).toBeLessThan(300);
    const json = (await ok.json()) as { ok: boolean; leadIds: string[] };
    expect(json.ok).toBe(true);
    expect(json.leadIds).toHaveLength(1);
    const audit = await one<{ metadata_diff: { verified: boolean } }>(
      db(),
      sql`select metadata_diff from tpms.audit_ledger where entity_id = ${json.leadIds[0]}::uuid and reason_code = 'SYSTEM_LEAD_INGESTED'`,
    );
    expect(audit?.metadata_diff.verified).toBe(true);

    // Meta retries: the same signed body is acknowledged and returns the same lead.
    const retry = await leadPOST(post("http://x/api/v1/leads/webhook/meta", body, { "x-hub-signature-256": sign(body, "meta-app-secret-for-tests") }), params("meta"));
    const retried = (await retry.json()) as { leadIds: string[]; results: Array<{ reason: string }> };
    expect(retried.leadIds).toEqual(json.leadIds);
    expect(retried.results[0].reason).toBe("REPLAY");
  });

  it("without a configured secret, accepts and records the lead as unverified", async () => {
    const value = { ...fixture("meta-leadgen-with-fields.json"), leadgen_id: "5550001112223334" };
    const response = await leadPOST(post("http://x/api/v1/leads/webhook/meta", JSON.stringify(value)), params("meta"));
    expect(response.status).toBe(200);
    const { leadIds } = (await response.json()) as { leadIds: string[] };
    const lead = await getLead(leadIds[0]);
    expect((lead.tnaProfile as { intake: { verified: boolean } }).intake.verified).toBe(false);
  });

  it("refuses an unknown channel and malformed JSON", async () => {
    expect((await leadPOST(post("http://x/api/v1/leads/webhook/tiktok", "{}"), params("tiktok"))).status).toBe(404);
    expect((await leadPOST(post("http://x/api/v1/leads/webhook/web", "{not json"), params("web"))).status).toBe(400);
  });
});

describe("Google, LinkedIn and web-form webhooks", () => {
  it("checks google_key when GOOGLE_WEBHOOK_KEY is set", async () => {
    setEnv({ GOOGLE_WEBHOOK_KEY: "gk_live_s3cr3t_value" });
    const payload = fixture<Record<string, unknown>>("google-lead-form.json");
    const wrong = await leadPOST(post("http://x/api/v1/leads/webhook/google", JSON.stringify({ ...payload, google_key: "guess" })), params("google"));
    expect(wrong.status).toBe(401);
    const right = await leadPOST(post("http://x/api/v1/leads/webhook/google", JSON.stringify(payload)), params("google"));
    expect(right.status).toBe(200);
    const { leadIds } = (await right.json()) as { leadIds: string[] };
    expect((await getLead(leadIds[0])).companyName).toBe("Petrosains Logistics Sdn Bhd");
  });

  it("checks the shared secret header for LinkedIn sync when LEAD_WEBHOOK_SECRET is set", async () => {
    setEnv({ LEAD_WEBHOOK_SECRET: "linkedin-sync-secret" });
    const body = JSON.stringify({ leads: [fixture("linkedin-sync.json")] });
    expect((await leadPOST(post("http://x/api/v1/leads/webhook/linkedin", body), params("linkedin"))).status).toBe(401);
    const ok = await leadPOST(post("http://x/api/v1/leads/webhook/linkedin", body, { "x-tpms-webhook-secret": "linkedin-sync-secret" }), params("linkedin"));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { leadIds: string[] }).leadIds).toHaveLength(1);
  });

  it("accepts an HTML form post, and tells our own site when a submission is unusable", async () => {
    const form = new URLSearchParams({ name: "Mei", email: "mei@lotus-apparel.com.my", message: "Sewing supervisors training, 12 pax" });
    const ok = await leadPOST(
      new Request("http://x/api/v1/leads/webhook/web", { method: "POST", body: form.toString(), headers: { "content-type": "application/x-www-form-urlencoded" } }),
      params("web"),
    );
    expect(ok.status).toBe(200);
    const bad = await leadPOST(post("http://x/api/v1/leads/webhook/web", JSON.stringify({ name: "Nobody" })), params("web"));
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { results: Array<{ code: string }> }).results[0].code).toBe("LEAD_NO_CONTACT");
  });
});

describe("WhatsApp webhook", () => {
  it("verifies the handshake with WHATSAPP_VERIFY_TOKEN", async () => {
    setEnv({ WHATSAPP_VERIFY_TOKEN: "wa-verify" });
    const ok = await waGET(new Request("http://x/api/v1/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wa-verify&hub.challenge=42"));
    expect(await ok.text()).toBe("42");
    expect((await waGET(new Request("http://x/api/v1/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=x&hub.challenge=42"))).status).toBe(403);
  });

  it("ingests a message from an unknown number, then treats that lead's reply as the micro-TNA answer", async () => {
    const body = JSON.stringify(fixture("whatsapp-inbound.json"));
    const first = await waPOST(post("http://x/api/v1/whatsapp/webhook", body));
    expect(first.status).toBe(200);
    const { handled } = (await first.json()) as { handled: Array<{ kind: string; leadId: string; status: string }> };
    expect(handled).toHaveLength(1);
    expect(handled[0]).toMatchObject({ kind: "LEAD", status: "INGESTED" });
    const leadId = handled[0].leadId;

    expect(await triageLead(leadId)).toMatchObject({ route: "LEAD_QUALIFIED_TNA" });
    expect(await sendMicroTna(leadId)).toMatchObject({ status: "LOGGED" });

    const reply = fixture<{ entry: Array<{ changes: Array<{ value: { messages: Array<Record<string, unknown>> } }> }> }>("whatsapp-inbound.json");
    reply.entry[0].changes[0].value.messages = [
      { from: "60137778899", id: "wamid.reply-abc", timestamp: "1758794000", type: "text", text: { body: "Yes we are. 20 pax, early December" } },
    ];
    const answered = await waPOST(post("http://x/api/v1/whatsapp/webhook", JSON.stringify(reply)));
    const result = (await answered.json()) as { handled: Array<{ kind: string; leadId: string; answer: Record<string, unknown> }> };
    expect(result.handled[0]).toMatchObject({ kind: "TNA_REPLY", leadId, answer: { levyActive: true, cohortSize: 20, timeline: "early December" } });
  });

  it("acknowledges status callbacks and enforces the app-secret signature when set", async () => {
    const statuses = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ id: "1", changes: [{ field: "messages", value: { statuses: [{ id: "wamid.x", status: "delivered" }] } }] }],
    });
    const ok = await waPOST(post("http://x/api/v1/whatsapp/webhook", statuses));
    expect(await ok.json()).toEqual({ ok: true, handled: [] });
    setEnv({ META_APP_SECRET: "meta-app-secret-for-tests" });
    expect((await waPOST(post("http://x/api/v1/whatsapp/webhook", statuses))).status).toBe(401);
    expect((await waPOST(post("http://x/api/v1/whatsapp/webhook", statuses, { "x-hub-signature-256": sign(statuses, "meta-app-secret-for-tests") }))).status).toBe(200);
  });
});

describe("inbound mail", () => {
  it("routes the forwarding mailbox and the smart-BCC address, and checks the mail secret", async () => {
    setEnv({ INBOUND_MAIL_SECRET: "mail-secret" });
    const forward = JSON.stringify(fixture("inbound-mail-forward.json"));
    expect((await mailPOST(post("http://x/api/v1/mail/inbound", forward))).status).toBe(401);

    const inbox = await mailPOST(post("http://x/api/v1/mail/inbound", forward, { "x-tpms-mail-secret": "mail-secret" }));
    const inboxJson = (await inbox.json()) as { mode: string; leadIds: string[] };
    expect(inboxJson.mode).toBe("INBOUND_MAIL");
    expect(await getLead(inboxJson.leadIds[0])).toMatchObject({ channelSource: "INBOUND_MAIL", picEmail: "meiling.lim@greenfield-foods.com.my" });

    const bcc = await mailPOST(post("http://x/api/v1/mail/inbound", JSON.stringify(fixture("inbound-mail-smart-bcc.json")), { "x-tpms-mail-secret": "mail-secret" }));
    const bccJson = (await bcc.json()) as { mode: string; leadIds: string[] };
    expect(bccJson.mode).toBe("SMART_BCC");
    const lead = await getLead(bccJson.leadIds[0]);
    expect(lead).toMatchObject({ channelSource: "SMART_BCC", picEmail: "rizal.hamdan@mahsuri-plantations.com.my" });
    expect((lead.tnaProfile as { intake: { owner: { email: string } } }).intake.owner.email).toBe("alex@alextraining.my");
  });

  it("a STOP reply is an opt-out, and mail to neither mailbox is refused", async () => {
    const stop = await mailPOST(
      post("http://x/api/v1/mail/inbound", JSON.stringify({ from: "Boss <boss@noisy-corp.com.my>", to: "inbox-leads@alextraining.my", subject: "Re: your levy", text: "STOP\n\n> previous" })),
    );
    expect(await stop.json()).toEqual({ ok: true, kind: "OPT_OUT", created: true });
    const suppressed = await rows(db(), sql`select email_lower from tpms.outbound_suppressions where email_lower = 'boss@noisy-corp.com.my'`);
    expect(suppressed).toHaveLength(1);

    const stray = await mailPOST(post("http://x/api/v1/mail/inbound", JSON.stringify({ from: "a@b.com.my", to: "sales@alextraining.my", subject: "hi", text: "training please" })));
    expect(stray.status).toBe(422);
    expect(((await stray.json()) as { code: string }).code).toBe("UNKNOWN_MAILBOX");
  });
});
