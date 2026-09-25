import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db, one, rows } from "@/server/db/client";
import type { Task } from "@/server/db/schema";
import { DomainError } from "@/server/domain/errors";
import { convertLeadToPackage, createClient, createPackageDirect } from "@/server/ingestion/convert";
import { type IngestResult, ingestLead, ingestWebhook } from "@/server/ingestion/ingest";
import { handleWhatsAppReply, microTnaTemplate, sendMicroTna } from "@/server/ingestion/microTna";
import { getLead, getLeadDetail } from "@/server/ingestion/queries";
import { handlers } from "@/server/ingestion/tasks";
import { resolveTriage, triageLead } from "@/server/ingestion/triage";
import { setGraphFetchForTests } from "@/server/messaging/graph";
import { fixture } from "../fixtures/payloads/load";
import { releaseTestDatabase, useTestDatabase } from "../helpers/db";
import { ALEX, makeOperator } from "../helpers/factory";

beforeAll(async () => {
  await useTestDatabase();
  await makeOperator();
});
afterAll(releaseTestDatabase);
afterEach(() => {
  setGraphFetchForTests(undefined);
  delete process.env.META_PAGE_ACCESS_TOKEN;
});

let seq = 0;
/** A unique company per call, so one test's dedupe never sees another's leads. */
function unique() {
  seq += 1;
  const n = `${Date.now() % 1_000_000}${seq}`.slice(-7).padStart(7, "0");
  return { domain: `co${n}.com.my`, phone: `+60129${n}`, localPhone: `0129${n.slice(0, 3)} ${n.slice(3)}`, n };
}

function corporateForm(overrides: Record<string, unknown> = {}) {
  const u = unique();
  return {
    u,
    payload: {
      name: "Nurul Hassan",
      email: `nurul@${u.domain}`,
      phone: u.localPhone,
      company: `Syarikat ${u.n} Sdn Bhd`,
      message: "We need in-house leadership training for 30 pax, HRDC claimable. Please send a proposal.",
      ...overrides,
    },
  };
}

async function tasks(type: string, leadOrPackage?: string): Promise<Array<Pick<Task, "id" | "payload">>> {
  return rows<Pick<Task, "id" | "payload">>(
    db(),
    sql`select id, payload from tpms.task_queue where task_type = ${type}
          and (${leadOrPackage ?? null}::text is null or payload->>'leadId' = ${leadOrPackage ?? null}::text
               or payload->>'packageId' = ${leadOrPackage ?? null}::text)`,
  );
}

function leadIdOf(result: IngestResult): string {
  if (!result.leadId) throw new Error(`expected a lead, got ${JSON.stringify(result)}`);
  return result.leadId;
}

describe("ingestLead — the webhook request path", () => {
  it("stores the raw payload, the lead, one audit row and a triage task in one go", async () => {
    const result = await ingestLead("META_LEADGEN", fixture("meta-leadgen-with-fields.json"), { verified: true });
    expect(result).toMatchObject({ status: "INGESTED", reason: "NEW", duplicateOf: null });
    const lead = await getLead(leadIdOf(result));
    expect(lead).toMatchObject({
      status: "LEAD_INGESTED",
      channelSource: "META_LEADGEN",
      companyName: "Kenanga Retail Group Berhad",
      companyDomain: "kenangaretail.com.my",
      picPhoneE164: "+60123456789",
      estimatedPax: 30,
      deliveryPreference: "IN_HOUSE",
      adId: "120210987654321002",
      campaignId: "120210987654300001",
    });
    const raw = await one<{ status: string; sha256_hash: string; ad_click_identifiers: Record<string, string> }>(
      db(),
      sql`select status, sha256_hash, ad_click_identifiers from tpms.raw_lead_payloads where id = ${result.rawPayloadId}::uuid`,
    );
    expect(raw?.sha256_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(raw?.ad_click_identifiers).toMatchObject({ leadgen_id: "1234567890123457", form_id: "845123987654321" });
    const audit = await rows<{ reason_code: string; actor_id: string; metadata_diff: Record<string, unknown> }>(
      db(),
      sql`select reason_code, actor_id, metadata_diff from tpms.audit_ledger where entity_type = 'LEAD' and entity_id = ${lead.id}::uuid`,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ reason_code: "SYSTEM_LEAD_INGESTED", actor_id: "sys_ingestion" });
    expect(audit[0].metadata_diff).toMatchObject({ channel: "META_LEADGEN", verified: true });
    // PDPA: the append-only ledger carries no contact details.
    expect(JSON.stringify(audit[0])).not.toMatch(/nurul|\+6012/i);
    expect(await tasks("lead.triage", lead.id)).toHaveLength(1);
  });

  it("a replayed webhook creates no second lead", async () => {
    const body = fixture("meta-leadgen-webhook.json");
    const [first] = await ingestWebhook("META_LEADGEN", body, { verified: false });
    const [second] = await ingestWebhook("META_LEADGEN", fixture("meta-leadgen-webhook.json"), { verified: false });
    expect(first.status).toBe("INGESTED");
    expect(second).toMatchObject({ status: "DUPLICATE", reason: "REPLAY", leadId: first.leadId, rawPayloadId: first.rawPayloadId });
    const count = await one<{ n: number }>(db(), sql`select count(*)::int as n from tpms.lead_records where raw_payload_id = ${first.rawPayloadId}::uuid`);
    expect(count?.n).toBe(1);
    expect(await tasks("lead.triage", leadIdOf(first))).toHaveLength(1);
  });

  it("never stores the Google webhook key", async () => {
    const result = await ingestLead("GOOGLE_WEBHOOK", fixture("google-lead-form.json"), { verified: true });
    const raw = await one<{ raw: string }>(db(), sql`select raw_payload::text as raw from tpms.raw_lead_payloads where id = ${result.rawPayloadId}::uuid`);
    expect(raw?.raw).not.toContain("gk_live_s3cr3t_value");
    expect(raw?.raw).toContain("[redacted]");
  });

  it("stores an unreadable payload as REJECTED instead of failing the webhook", async () => {
    const result = await ingestLead("WEB_FORM", { name: "No contact", message: "hi" }, { verified: false });
    expect(result).toMatchObject({ status: "REJECTED", code: "LEAD_NO_CONTACT", leadId: null });
    const raw = await one<{ status: string }>(db(), sql`select status from tpms.raw_lead_payloads where id = ${result.rawPayloadId}::uuid`);
    expect(raw?.status).toBe("REJECTED");
  });

  it("links the lead to an existing client with the same domain", async () => {
    const u = unique();
    const client = await createClient(
      { companyName: `Linked ${u.n} Berhad`, companyDomain: `https://www.${u.domain}/about`, primaryPicName: "Aida", primaryPicEmail: `aida@${u.domain}`, primaryPicPhone: "012-111 2222" },
      ALEX,
    );
    expect(client.companyDomain).toBe(u.domain);
    const result = await ingestLead("WEB_FORM", { name: "Someone", email: `someone@${u.domain}`, message: "training please" }, { verified: false });
    expect((await getLead(leadIdOf(result))).clientId).toBe(client.id);
  });

  it("acknowledges fast: ingestLead p95 under 300 ms over 20 runs", async () => {
    const timings: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const { payload } = corporateForm();
      const started = performance.now();
      const result = await ingestLead("WEB_FORM", payload, { verified: true });
      timings.push(performance.now() - started);
      expect(result.status).toBe("INGESTED");
    }
    timings.sort((a, b) => a - b);
    const p95 = timings[Math.ceil(0.95 * timings.length) - 1];
    expect(p95).toBeLessThan(300);
  });
});

describe("dedupe", () => {
  it("a second enquiry from the same corporate domain is stored as DUPLICATE of the first, and not triaged", async () => {
    const u = unique();
    const first = await ingestLead("WEB_FORM", { name: "A", email: `a@${u.domain}`, message: "training" }, { verified: false });
    const second = await ingestLead("WEB_FORM", { name: "B", email: `b@${u.domain}`, message: "training too" }, { verified: false });
    expect(second).toMatchObject({ status: "DUPLICATE", reason: "DEDUPE_DOMAIN", duplicateOf: first.leadId });
    const dup = await getLead(leadIdOf(second));
    expect(dup).toMatchObject({ status: "DUPLICATE", duplicateOf: first.leadId });
    expect(await tasks("lead.triage", dup.id)).toHaveLength(0);
    const raw = await one<{ status: string }>(db(), sql`select status from tpms.raw_lead_payloads where id = ${second.rawPayloadId}::uuid`);
    expect(raw?.status).toBe("DUPLICATE");
  });

  it("the same phone number dedupes even across free-mail addresses", async () => {
    const u = unique();
    const first = await ingestLead("WEB_FORM", { name: "A", email: `a${u.n}@gmail.com`, phone: u.localPhone }, { verified: false });
    const second = await ingestLead("WHATSAPP_INBOUND", { contact: { wa_id: u.phone.slice(1) }, message: { from: u.phone.slice(1), id: `wamid.${u.n}`, type: "text", text: { body: "hello" } } }, { verified: false });
    expect(second).toMatchObject({ status: "DUPLICATE", reason: "DEDUPE_PHONE", duplicateOf: first.leadId });
  });

  it("free-mail domains are never a dedupe key", async () => {
    const a = unique();
    const b = unique();
    const first = await ingestLead("WEB_FORM", { name: "A", email: `alpha${a.n}@gmail.com`, phone: a.localPhone }, { verified: false });
    const second = await ingestLead("WEB_FORM", { name: "B", email: `beta${b.n}@gmail.com`, phone: b.localPhone }, { verified: false });
    expect(first.status).toBe("INGESTED");
    expect(second.status).toBe("INGESTED");
    expect((await getLead(leadIdOf(second))).companyDomain).toBeNull();
  });

  it("only looks back 90 days", async () => {
    const u = unique();
    await ingestLead("WEB_FORM", { name: "Old", email: `old@${u.domain}` }, { verified: false, receivedAt: new Date(Date.now() - 100 * 86_400_000) });
    const fresh = await ingestLead("WEB_FORM", { name: "New", email: `new@${u.domain}` }, { verified: false });
    expect(fresh.status).toBe("INGESTED");
  });

  it("an archived lead does not swallow a new enquiry", async () => {
    const u = unique();
    const first = await ingestLead("WEB_FORM", { name: "A", email: `a@${u.domain}` }, { verified: false });
    await resolveTriage(leadIdOf(first), { route: "ARCHIVE" }, ALEX);
    const second = await ingestLead("WEB_FORM", { name: "B", email: `b@${u.domain}` }, { verified: false });
    expect(second.status).toBe("INGESTED");
  });
});

describe("L1 triage and routing", () => {
  it("a clear corporate HRDC enquiry is qualified, measured, audited, and queued for the micro-TNA", async () => {
    const { payload } = corporateForm();
    const leadId = leadIdOf(await ingestLead("WEB_FORM", payload, { verified: true }));
    const result = await triageLead(leadId);
    expect(result).toMatchObject({ route: "LEAD_QUALIFIED_TNA", intent: "TRAINING_ENQUIRY", abstained: false, classifierModel: "tpms-l1-logistic-v1" });
    const lead = await getLead(leadId);
    expect(lead.status).toBe("LEAD_QUALIFIED_TNA");
    expect(lead.qualifiedAt).toBeInstanceOf(Date);
    expect(Number(lead.pLevyLiable)).toBeGreaterThanOrEqual(0.85);
    expect(lead.triageIntent).toBe("TRAINING_ENQUIRY");
    expect(lead.urgencyScore).toBeGreaterThanOrEqual(1);
    expect(lead.classifierModel).toBe("tpms-l1-logistic-v1");
    expect(lead.classifierLatencyMs).toBeGreaterThanOrEqual(0);

    const run = await one<{ tier: string; status: string; agent: string }>(
      db(),
      sql`select tier, status, agent from tpms.agent_runs where lead_id = ${leadId}::uuid`,
    );
    expect(run).toEqual({ tier: "L1", status: "FALLBACK", agent: "ingestion.l1_classifier" });
    const routed = await one<{ metadata_diff: { primitives: Array<{ kind: string }>; route: string } }>(
      db(),
      sql`select metadata_diff from tpms.audit_ledger where entity_id = ${leadId}::uuid and reason_code = 'LEAD_ROUTED'`,
    );
    expect(routed?.metadata_diff.route).toBe("LEAD_QUALIFIED_TNA");
    expect(routed?.metadata_diff.primitives.map((p) => p.kind)).toEqual(["Choice", "Score", "Score"]);
    expect(await tasks("lead.whatsapp_micro_tna", leadId)).toHaveLength(1);
  });

  it("a vendor pitch is archived without a decision", async () => {
    const mail = { ...fixture("inbound-mail-forward.json") };
    const u = unique();
    Object.assign(mail, {
      from: `Jason Lee <jason@${u.domain}>`,
      subject: "Partnership opportunity: more training enquiries for your business",
      text: "Hi team, we are a digital marketing agency and we help training providers get 3x more leads. Our services can help you grow your business with SEO and lead generation. Can we book a call this week?",
      headers: {},
    });
    const leadId = leadIdOf(await ingestLead("INBOUND_MAIL", mail, { verified: true }));
    expect(await triageLead(leadId)).toMatchObject({ route: "ARCHIVED", intent: "VENDOR_PITCH" });
    const decisions = await rows(db(), sql`select id from tpms.decisions where subject_ref = ${leadId}`);
    expect(decisions).toHaveLength(0);
  });

  it("an ambiguous lead goes to TRIAGE_REVIEW with a LEAD_TRIAGE decision; the operator's call resolves both", async () => {
    const u = unique();
    // The fixture's number is a Klang Valley landline: no WhatsApp follow-up is possible.
    const form = { ...fixture("web-form.json"), email: `daniel@${u.domain}` };
    const leadId = leadIdOf(await ingestLead("WEB_FORM", form, { verified: false }));
    const result = await triageLead(leadId);
    expect(result.route).toBe("TRIAGE_REVIEW");
    expect(result.pLevy).toBeGreaterThanOrEqual(0.4);
    expect(result.pLevy).toBeLessThan(0.85);
    const decision = await one<{ gate: string; status: string; options: Array<{ id: string }> }>(
      db(),
      sql`select gate, status, options from tpms.decisions where subject_ref = ${leadId}`,
    );
    expect(decision).toMatchObject({ gate: "LEAD_TRIAGE", status: "PENDING" });
    expect(decision?.options.map((o) => o.id)).toEqual(["QUALIFY", "PRIVATE_CASH", "ARCHIVE"]);

    await expect(resolveTriage(leadId, { route: "QUALIFY" }, { type: "AGENT", id: "some_agent" })).rejects.toMatchObject({ code: "TRIAGE_REQUIRES_HUMAN" });
    const resolved = await resolveTriage(leadId, { route: "QUALIFY", note: "Confirmed levy payer on the phone" }, ALEX);
    expect(resolved.lead.status).toBe("LEAD_QUALIFIED_TNA");
    expect(resolved.microTnaTaskId).toBeNull(); // a landline cannot take WhatsApp
    const after = await one<{ status: string; resolved_by: string; chosen_option: string }>(
      db(),
      sql`select status, resolved_by, chosen_option from tpms.decisions where subject_ref = ${leadId}`,
    );
    expect(after).toEqual({ status: "RESOLVED", resolved_by: ALEX.id, chosen_option: "QUALIFY" });
  });

  it("a gmail individual is routed to PRIVATE_CASH", async () => {
    const u = unique();
    const leadId = leadIdOf(
      await ingestLead(
        "WEB_FORM",
        { name: "Ahmad Zaki", email: `ahmad.zaki${u.n}@gmail.com`, phone: u.localPhone, message: "Hi, I would like to join your Excel course for my own career. How much is the fee?" },
        { verified: true },
      ),
    );
    expect(await triageLead(leadId)).toMatchObject({ route: "PRIVATE_CASH" });
    expect(await getLead(leadId)).toMatchObject({ status: "PRIVATE_CASH", accountType: "PRIVATE_CASH" });
  });

  it("a Meta notification without fields abstains (Noul) when no page token is configured", async () => {
    const body = fixture<{ entry: Array<{ changes: Array<{ value: Record<string, unknown> }> }> }>("meta-leadgen-webhook.json");
    body.entry[0].changes[0].value.leadgen_id = `99${unique().n}`;
    const [ingested] = await ingestWebhook("META_LEADGEN", body, { verified: true });
    const result = await triageLead(leadIdOf(ingested));
    expect(result).toMatchObject({ route: "TRIAGE_REVIEW", reason: "ABSTAINED", abstained: true });
  });

  it("with a page token, triage fetches the Meta fields first (Graph), then classifies", async () => {
    const u = unique();
    const body = fixture<{ entry: Array<{ changes: Array<{ value: Record<string, unknown> }> }> }>("meta-leadgen-webhook.json");
    const leadgenId = `77${u.n}`;
    body.entry[0].changes[0].value.leadgen_id = leadgenId;
    const [ingested] = await ingestWebhook("META_LEADGEN", body, { verified: true });

    process.env.META_PAGE_ACCESS_TOKEN = "EAAB-test-page-token";
    const seen: string[] = [];
    setGraphFetchForTests(async (url, init) => {
      seen.push(url);
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer EAAB-test-page-token");
      return new Response(
        JSON.stringify({
          id: leadgenId,
          field_data: [
            { name: "full_name", values: ["Hafiz Rahim"] },
            { name: "email", values: [`hafiz@${u.domain}`] },
            { name: "phone_number", values: [u.phone] },
            { name: "company_name", values: [`Hafiz ${u.n} Sdn Bhd`] },
            { name: "what_training_do_you_need?", values: ["Customer service for 25 frontliners, HRD Corp claimable"] },
          ],
        }),
        { status: 200 },
      );
    });
    const result = await triageLead(leadIdOf(ingested));
    expect(seen[0]).toContain(`/v20.0/${leadgenId}?fields=`);
    expect(seen[0]).not.toContain("EAAB-test-page-token");
    expect(result.route).toBe("LEAD_QUALIFIED_TNA");
    expect(await getLead(leadIdOf(ingested))).toMatchObject({ picEmail: `hafiz@${u.domain}`, companyDomain: u.domain, picPhoneE164: u.phone });
  });

  it("is idempotent, and runs through the task handler map", async () => {
    const { payload } = corporateForm();
    const leadId = leadIdOf(await ingestLead("WEB_FORM", payload, { verified: true }));
    const [task] = await tasks("lead.triage", leadId);
    const handler = handlers["lead.triage"];
    if (!handler) throw new Error("no lead.triage handler");
    const ctx = { workerId: "test", heartbeat: async () => undefined };
    const first = await handler({ ...(task as Task), taskType: "lead.triage" } as Task, ctx);
    expect(first).toMatchObject({ route: "LEAD_QUALIFIED_TNA" });
    const again = await handler({ ...(task as Task), taskType: "lead.triage" } as Task, ctx);
    expect(again).toMatchObject({ skipped: "ALREADY_LEAD_QUALIFIED_TNA" });
    await expect(handler({ id: task.id, taskType: "lead.triage", payload: {} } as unknown as Task, ctx)).rejects.toBeInstanceOf(DomainError);
  });
});

describe("WhatsApp micro-TNA", () => {
  async function qualifiedLead() {
    const { payload, u } = corporateForm();
    const leadId = leadIdOf(await ingestLead("WEB_FORM", payload, { verified: true }));
    await triageLead(leadId);
    return { leadId, u };
  }

  it("sends the exact template (LOGGED without a token) and never twice", async () => {
    const { leadId, u } = await qualifiedLead();
    const sent = await sendMicroTna(leadId);
    const lead = await getLead(leadId);
    expect(sent.status).toBe("LOGGED");
    expect(sent.body).toBe(
      `Hi Nurul Hassan, received your inquiry regarding Leadership for Syarikat ${u.n} Sdn Bhd. To confirm eligibility for 100% SBL-Khas grant coverage (zero upfront cash outlay): Is Syarikat ${u.n} Sdn Bhd an active HRD Corp levy contributor?`,
    );
    expect(sent.body).toBe(microTnaTemplate(lead));
    const message = await one<{ channel: string; status: string; to_address: string; kind: string }>(
      db(),
      sql`select channel, status, to_address, kind from tpms.outbound_messages where id = ${sent.messageId}::uuid`,
    );
    expect(message).toEqual({ channel: "WHATSAPP", status: "LOGGED", to_address: u.phone, kind: "MICRO_TNA" });
    expect((lead.tnaProfile as { microTna?: { messageId: string } }).microTna?.messageId).toBe(sent.messageId);
    expect(await sendMicroTna(leadId)).toMatchObject({ skipped: "ALREADY_SENT" });
  });

  it("parses a yes into tna_profile and ignores a redelivered message", async () => {
    const { leadId, u } = await qualifiedLead();
    await sendMicroTna(leadId);
    const reply = await handleWhatsAppReply(u.phone, "Yes, about 25 pax in March", { messageId: "wamid.reply-1" });
    expect(reply).toMatchObject({ leadId, status: "LEAD_QUALIFIED_TNA", answer: { levyActive: true, cohortSize: 25, timeline: "March" } });
    const lead = await getLead(leadId);
    expect(lead.tnaProfile).toMatchObject({ levyActive: true, cohortSize: 25, timeline: "March" });
    expect(lead.estimatedPax).toBe(25);
    expect(await handleWhatsAppReply(u.phone, "Yes, about 25 pax in March", { messageId: "wamid.reply-1" })).toMatchObject({ replayed: true });
  });

  it("a no (in Malay) moves the lead to PRIVATE_CASH", async () => {
    const { leadId, u } = await qualifiedLead();
    await sendMicroTna(leadId);
    const reply = await handleWhatsAppReply(u.phone.replace("+60", "0"), "Tidak, syarikat kami belum berdaftar");
    expect(reply?.status).toBe("PRIVATE_CASH");
    expect(await getLead(leadId)).toMatchObject({ status: "PRIVATE_CASH", accountType: "PRIVATE_CASH" });
    // They check with finance and correct themselves: the parser's own move is undone.
    const corrected = await handleWhatsAppReply(u.phone, "Sorry, correction - yes we are registered");
    expect(corrected?.status).toBe("LEAD_QUALIFIED_TNA");
    expect(await getLead(leadId)).toMatchObject({ status: "LEAD_QUALIFIED_TNA", accountType: "SBL_KHAS_LEVY" });
  });

  it("returns null for a number with no micro-TNA outstanding", async () => {
    expect(await handleWhatsAppReply("+60199990000", "yes")).toBeNull();
  });
});

describe("lead -> package conversion", () => {
  it("creates the client and a DRAFT package with a PKG code, audits it and queues the proposal", async () => {
    const { payload, u } = corporateForm();
    const leadId = leadIdOf(await ingestLead("WEB_FORM", payload, { verified: true }));
    await triageLead(leadId);
    await sendMicroTna(leadId);
    await handleWhatsAppReply(u.phone, "Ya, active. 28 orang");

    const result = await convertLeadToPackage(
      leadId,
      { title: "Leading Through Change", deliveryMode: "IN_HOUSE", startDate: "2026-11-10", endDate: "2026-11-11", pax: 28 },
      ALEX,
    );
    expect(result.package).toMatchObject({ operationalStage: "DRAFT", financialStage: "ESTIMATE", leadId, paxEstimate: 28, createdBy: ALEX.id });
    expect(result.package.packageCode).toMatch(/^PKG-\d{4}-\d{4}$/);
    expect(result.clientCreated).toBe(true);
    expect(result.client).toMatchObject({ companyDomain: u.domain, levyRegistered: true, accountType: "SBL_KHAS_LEVY", primaryPicPhone: u.phone });

    const audit = await rows<{ reason_code: string; actor_id: string; reason_details: string; to_stage: string }>(
      db(),
      sql`select reason_code, actor_id, reason_details, to_stage from tpms.audit_ledger
           where entity_type = 'TRAINING_PACKAGE' and entity_id = ${result.package.id}::uuid`,
    );
    expect(audit).toEqual([{ reason_code: "PACKAGE_CREATED", actor_id: ALEX.id, reason_details: `from lead ${leadId}`, to_stage: "DRAFT" }]);
    expect(await getLead(leadId)).toMatchObject({ status: "CONVERTED", convertedPackageId: result.package.id, clientId: result.client.id });
    const [proposal] = await tasks("commercial.draft_proposal", result.package.id);
    expect(proposal.payload).toEqual({ packageId: result.package.id });
    expect(result.proposalTaskId).toBe(proposal.id);

    await expect(
      convertLeadToPackage(leadId, { title: "Again", deliveryMode: "IN_HOUSE", pax: 10 }, ALEX),
    ).rejects.toMatchObject({ code: "LEAD_ALREADY_CONVERTED" });
    const detail = await getLeadDetail(leadId);
    expect(detail.messages.map((m) => m.kind)).toEqual(["MICRO_TNA"]);
    expect(detail.triage).toMatchObject({ route: "LEAD_QUALIFIED_TNA" });
  });

  it("reuses an existing client, refuses a duplicate lead, an agent actor and bad input", async () => {
    const u = unique();
    const client = await createClient(
      { companyName: `Existing ${u.n} Bhd`, companyDomain: u.domain, primaryPicName: "Aida", primaryPicEmail: `aida@${u.domain}`, primaryPicPhone: "0121112222" },
      ALEX,
    );
    const first = leadIdOf(await ingestLead("WEB_FORM", { name: "One", email: `one@${u.domain}`, message: "training" }, { verified: false }));
    const dup = leadIdOf(await ingestLead("WEB_FORM", { name: "Two", email: `two@${u.domain}`, message: "training" }, { verified: false }));

    const converted = await convertLeadToPackage(first, { title: "Excel for Finance", deliveryMode: "ROT_VIRTUAL", pax: 12 }, ALEX);
    expect(converted.clientCreated).toBe(false);
    expect(converted.client.id).toBe(client.id);

    await expect(convertLeadToPackage(dup, { title: "Dup", deliveryMode: "IN_HOUSE", pax: 5 }, ALEX)).rejects.toMatchObject({ code: "LEAD_NOT_CONVERTIBLE" });
    await expect(
      convertLeadToPackage(first, { title: "Agent", deliveryMode: "IN_HOUSE", pax: 5 }, { type: "AGENT", id: "commercial.agent" }),
    ).rejects.toMatchObject({ code: "OPERATOR_REQUIRED" });
    await expect(
      convertLeadToPackage(first, { title: "Bad dates", deliveryMode: "IN_HOUSE", pax: 5, startDate: "2026-11-12", endDate: "2026-11-10" }, ALEX),
    ).rejects.toMatchObject({ code: "PACKAGE_INPUT_INVALID" });
  });

  it("creates a package directly for a client, and refuses free-mail or duplicate client domains", async () => {
    const u = unique();
    await expect(
      createClient({ companyName: "Gmail Co", companyDomain: "gmail.com", primaryPicName: "X Y", primaryPicEmail: "x@gmail.com", primaryPicPhone: "0123334444" }, ALEX),
    ).rejects.toMatchObject({ code: "CLIENT_DOMAIN_IS_FREE_MAIL" });
    const client = await createClient(
      { companyName: `Direct ${u.n} Sdn Bhd`, primaryPicName: "Ravi Kumar", primaryPicEmail: `ravi@${u.domain}`, primaryPicPhone: "019-222 3333", levyRegistered: true },
      ALEX,
    );
    expect(client).toMatchObject({ companyDomain: u.domain, primaryPicPhone: "+60192223333" });
    await expect(
      createClient({ companyName: "Clash", companyDomain: u.domain, primaryPicName: "Q Q", primaryPicEmail: `q@${u.domain}`, primaryPicPhone: "0123334444" }, ALEX),
    ).rejects.toMatchObject({ code: "CLIENT_EXISTS", details: { clientId: client.id } });

    const direct = await createPackageDirect({ clientId: client.id, title: "Forklift Safety", deliveryMode: "IN_HOUSE", pax: 8, startDate: "2026-12-01" }, ALEX);
    expect(direct.package.packageCode).toMatch(/^PKG-\d{4}-\d{4}$/);
    expect(direct.package.leadId).toBeNull();
    expect(direct.proposalTaskId).not.toBeNull();
    await expect(
      createPackageDirect({ clientId: "00000000-0000-4000-8000-000000000000", title: "Nope", deliveryMode: "IN_HOUSE", pax: 8 }, ALEX),
    ).rejects.toMatchObject({ code: "CLIENT_NOT_FOUND" });
  });
});
