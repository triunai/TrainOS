import { beforeAll, describe, expect, it } from "vitest";
import { loadDotEnv } from "@/server/env";
import { canonicalJson, redactSecrets } from "@/server/ingestion/ingest";
import {
  detectMailMode,
  normaliseGoogleLeadForm,
  normaliseInboundMail,
  normaliseLinkedInSync,
  normaliseMetaLeadgen,
  normaliseWebForm,
  normaliseWhatsAppInbound,
  splitWebhook,
} from "@/server/ingestion/normalise";
import { findPhoneNumbers, isWhatsAppCapable, normaliseMalaysianPhone } from "@/server/ingestion/phone";
import {
  corporateDomainOf,
  extractCompanyName,
  extractPax,
  extractTopic,
  isFreeMailDomain,
  registrableDomain,
} from "@/server/ingestion/text";
import { fixture } from "../fixtures/payloads/load";

beforeAll(() => {
  // The mail normaliser reads MAIL_FROM through the typed env.
  loadDotEnv();
});

describe("Malaysian phone normalisation", () => {
  it.each([
    ["012-345 6789", "+60123456789"],
    ["0123456789", "+60123456789"],
    ["60123456789", "+60123456789"],
    ["+60123456789", "+60123456789"],
    ["+60 12-345 6789", "+60123456789"],
    ["+60 012-345 6789", "+60123456789"],
    ["0060123456789", "+60123456789"],
    ["12-345 6789", "+60123456789"],
    ["011-2345 6789", "+601123456789"],
    ["016 220 3344", "+60162203344"],
    ["03-2711 1234", "+60327111234"],
    ["(03) 2711 1234", "+60327111234"],
    ["04-261 1234", "+6042611234"],
    ["088-123 456", "+6088123456"],
    ["+65 9123 4567", "+6591234567"],
    ["03-2711 1234 ext 21", "+60327111234"],
  ])("%s -> %s", (raw, expected) => {
    expect(normaliseMalaysianPhone(raw)).toBe(expected);
  });

  it.each(["", "abc", "123", "0123", "+60 99", "999999999999999999"])("refuses %j", (raw) => {
    expect(normaliseMalaysianPhone(raw)).toBeNull();
  });

  it("knows a landline cannot receive WhatsApp", () => {
    expect(isWhatsAppCapable("+60123456789")).toBe(true);
    expect(isWhatsAppCapable("+60327111234")).toBe(false);
    expect(isWhatsAppCapable("")).toBe(false);
  });

  it("finds numbers in a signature without merging lines", () => {
    expect(findPhoneNumbers("Tel: 03-7960 1234 | Mobile: 016-220 3344\n012-999 8888")).toEqual([
      "+60379601234",
      "+60162203344",
      "+60129998888",
    ]);
  });
});

describe("domains", () => {
  it.each(["gmail.com", "yahoo.com.my", "hotmail.com", "outlook.com", "live.com.my", "icloud.com", "ymail.com", "proton.me", "yahoo.co.uk", "streamyx.com"])(
    "%s is free mail",
    (domain) => expect(isFreeMailDomain(domain)).toBe(true),
  );

  it.each(["kenangaretail.com.my", "mail.acme.com.my", "liveworks.com.my", "outlookgroup.com"])("%s is not free mail", (domain) => {
    expect(isFreeMailDomain(domain)).toBe(false);
  });

  it("reduces a subdomain to the registrable company domain", () => {
    expect(registrableDomain("hr.petronas.com.my")).toBe("petronas.com.my");
    expect(registrableDomain("mail.example.com")).toBe("example.com");
    expect(corporateDomainOf("Nurul@HR.Kenangaretail.com.my")).toBe("kenangaretail.com.my");
    expect(corporateDomainOf("someone@gmail.com")).toBeNull();
  });
});

describe("free-text extraction", () => {
  it.each([
    ["We need training for 30 pax", 30],
    ["about 20 participants in total", 20],
    ["for a team of 15 engineers", 15],
    ["20-25 pax, in-house", 25],
    ["a 12-person team", 12],
    ["twenty participants", 20],
    ["no headcount here", null],
  ])("pax in %j is %s", (text, pax) => {
    expect(extractPax(text)).toBe(pax);
  });

  it("maps topics to the canonical catalogue and falls back to a phrase", () => {
    expect(extractTopic("Looking for HACCP refresher")).toBe("Food safety (HACCP / GMP)");
    expect(extractTopic("need a Power BI dashboard class")).toBe("Data analytics & Power BI");
    expect(extractTopic("a workshop on warehouse inventory control for our team")).toBe("Warehouse inventory control");
    expect(extractTopic("hello")).toBeNull();
  });

  it("extracts a company from a sentence or a signature line, never across lines", () => {
    expect(extractCompanyName("Hi, I'm Farid from Sinaran Manufacturing Sdn Bhd. We need")).toBe("Sinaran Manufacturing Sdn Bhd");
    expect(extractCompanyName("Regards\nLim Mei Ling\nGreenfield Foods Sdn Bhd\nTel")).toBe("Greenfield Foods Sdn Bhd");
    expect(extractCompanyName("working at Kenanga Retail Group Berhad.")).toBe("Kenanga Retail Group Berhad");
    expect(extractCompanyName("nothing to see")).toBeNull();
  });
});

describe("per-channel normalisers (fixtures)", () => {
  it("Meta leadgen notification without field_data is a minimal lead flagged for enrichment", () => {
    const items = splitWebhook("META_LEADGEN", fixture("meta-leadgen-webhook.json"));
    expect(items).toHaveLength(1);
    const lead = normaliseMetaLeadgen(items[0]);
    expect(lead.needsEnrichment).toBe(true);
    expect(lead.platformIds).toMatchObject({ leadgen_id: "1234567890123456", form_id: "845123987654321", page_id: "104729385612345" });
    expect(lead.adId).toBe("120210987654321001");
    expect(lead.picEmail).toBe("");
  });

  it("Meta leadgen with field_data maps every answer, keeping custom questions for the classifier", () => {
    const lead = normaliseMetaLeadgen(fixture("meta-leadgen-with-fields.json"));
    expect(lead).toMatchObject({
      companyName: "Kenanga Retail Group Berhad",
      companyDomain: "kenangaretail.com.my",
      picName: "Nurul Aisyah binti Hassan",
      picEmail: "nurul.hassan@kenangaretail.com.my",
      picPhoneE164: "+60123456789",
      topic: "Leadership for new supervisors",
      estimatedPax: 30,
      deliveryPreference: "IN_HOUSE",
      campaignId: "120210987654300001",
      needsEnrichment: false,
    });
    expect(lead.message).toContain("Job title: HR Manager");
    expect(lead.message).toMatch(/registered with hrd corp: Yes/i);
  });

  it("Google Ads lead form reads standard columns by id and custom questions by name", () => {
    const lead = normaliseGoogleLeadForm(fixture("google-lead-form.json"));
    expect(lead).toMatchObject({
      companyName: "Petrosains Logistics Sdn Bhd",
      companyDomain: "petrosains-logistics.com.my",
      picName: "Tan Wei Ming",
      picPhoneE164: "+60123456780",
      topic: "Forklift safety and HIRARC",
      estimatedPax: 18,
      adClickIds: { gclid: "EAIaIQobChMI7r2x0-TEST-GCLID" },
      campaignId: "20000000001",
      adId: "50000000001",
      isTest: false,
    });
    expect(JSON.stringify(lead)).not.toContain("gk_live_s3cr3t_value");
  });

  it("LinkedIn sync maps camelCase fields and question/answer pairs", () => {
    const lead = normaliseLinkedInSync(fixture("linkedin-sync.json"));
    expect(lead).toMatchObject({
      companyName: "Axiata Digital Services Sdn Bhd",
      companyDomain: "axiata-digital.com",
      picName: "Siti Rahman",
      picPhoneE164: "+60198765432",
      topic: "Data analytics with Power BI",
      estimatedPax: 15,
      adClickIds: { li_fat_id: "abc123-li-fat" },
    });
    expect(lead.message).toMatch(/HRD Corp claimable/);
  });

  it("WhatsApp inbound reads the sender, the body and the Click-to-WhatsApp referral", () => {
    const [item] = splitWebhook("WHATSAPP_INBOUND", fixture("whatsapp-inbound.json"));
    const lead = normaliseWhatsAppInbound(item);
    expect(lead).toMatchObject({
      companyName: "Sinaran Manufacturing Sdn Bhd",
      companyDomain: "sinaran-mfg.com.my",
      picName: "Farid Ismail",
      picEmail: "farid@sinaran-mfg.com.my",
      picPhoneE164: "+60137778899",
      estimatedPax: 20,
      adId: "120210987654399999",
      whatsappOptIn: true,
    });
    expect(lead.adClickIds.ctwa_clid).toMatch(/^ARAk/);
    expect(lead.topic).toBe("ISO standards & internal audit");
  });

  it("inbound mail to the forwarding mailbox: the sender is the lead, the mobile beats the landline", () => {
    const payload = fixture("inbound-mail-forward.json");
    expect(detectMailMode(payload)).toBe("INBOUND_MAIL");
    const lead = normaliseInboundMail(payload, "INBOUND_MAIL");
    expect(lead).toMatchObject({
      companyName: "Greenfield Foods Sdn Bhd",
      companyDomain: "greenfield-foods.com.my",
      picName: "Lim Mei Ling",
      picEmail: "meiling.lim@greenfield-foods.com.my",
      picPhoneE164: "+60162203344",
      estimatedPax: 22,
      deliveryPreference: "IN_HOUSE",
      topic: "Food safety (HACCP / GMP)",
      owner: null,
    });
  });

  it("smart BCC: the external recipient is the lead, the staff sender its owner, the staff signature ignored", () => {
    const payload = fixture("inbound-mail-smart-bcc.json");
    expect(detectMailMode(payload)).toBe("SMART_BCC");
    const lead = normaliseInboundMail(payload, "SMART_BCC");
    expect(lead).toMatchObject({
      companyName: "Mahsuri Plantations",
      companyDomain: "mahsuri-plantations.com.my",
      picName: "Encik Rizal Hamdan",
      picEmail: "rizal.hamdan@mahsuri-plantations.com.my",
      picPhoneE164: "",
      estimatedPax: 24,
      owner: { email: "alex@alextraining.my", name: "Alex Tan" },
    });
  });

  it("a staff member forwarding by hand: the original sender in the forwarded block is the lead", () => {
    process.env.STAFF_EMAIL_DOMAINS = "alextraining.my";
    try {
      const lead = normaliseInboundMail(
        {
          from: "Alex Tan <alex@alextraining.my>",
          to: "inbox-leads@alextraining.my",
          subject: "Fwd: training enquiry",
          text: "FYI\n\n---------- Forwarded message ---------\nFrom: Priya Nair <priya@orchid-hotels.com.my>\nSubject: training\n\nWe need customer service training for 40 staff.",
        },
        "INBOUND_MAIL",
      );
      expect(lead.picEmail).toBe("priya@orchid-hotels.com.my");
      expect(lead.picName).toBe("Priya Nair");
      expect(lead.owner).toEqual({ email: "alex@alextraining.my", name: "Alex Tan" });
    } finally {
      delete process.env.STAFF_EMAIL_DOMAINS;
    }
  });

  it("web form: free-mail is never a company domain", () => {
    const corporate = normaliseWebForm(fixture("web-form.json"));
    expect(corporate).toMatchObject({ companyDomain: "brightwave.com.my", picPhoneE164: "+60327118899", whatsappOptIn: true });
    expect(corporate.adClickIds).toEqual({ gclid: "Cj0KCQjw-WEBFORM-GCLID" });
    const individual = normaliseWebForm({ name: "Ahmad", email: "ahmad.zaki88@gmail.com", message: "Excel course for myself" });
    expect(individual.companyDomain).toBeNull();
    expect(individual.companyName).toBe("Unknown company");
  });

  it("a form without any contact is refused", () => {
    expect(() => normaliseWebForm({ name: "No Contact", message: "hi" })).toThrow(/neither a valid email nor a phone/);
  });
});

describe("payload hashing", () => {
  it("is independent of key order and never contains a secret", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[1,{"y":2,"z":1}]},"b":1}');
    expect(canonicalJson(redactSecrets({ google_key: "s3cret", nested: { access_token: "t" } }))).not.toMatch(/s3cret|"t"/);
  });
});
