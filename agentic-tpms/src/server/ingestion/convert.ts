import { sql } from "drizzle-orm";
import { z } from "zod";
import { type Actor, type Tx, one, schema, withTx } from "@/server/db/client";
import type { Client, Lead, TrainingPackage } from "@/server/db/schema";
import { recordAudit } from "@/server/audit/ledger";
import { DELIVERY_MODES } from "@/server/domain/stages";
import { DomainError } from "@/server/domain/errors";
import { draftProposalKey } from "@/server/queue/keys";
import { enqueue } from "@/server/queue/queue";
import { normaliseMalaysianPhone } from "./phone";
import { lockLead } from "./queries";
import { cleanEmail, corporateDomainOf, isFreeMailDomain, registrableDomain } from "./text";

/**
 * Stage 1 -> Stage 2: a lead becomes a corporate client and a DRAFT training
 * package. The package row is inserted inside `withTx` with reason
 * PACKAGE_CREATED, so the database trigger assigns PKG-YYYY-NNNN and writes
 * the hash-chained creation entry itself; the proposal draft is enqueued in
 * the same transaction, so a package never exists without its follow-up work.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = z
  .string()
  .regex(ISO_DATE, "Dates are YYYY-MM-DD")
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), "Not a calendar date");

const packageFields = z
  .object({
    title: z.string().trim().min(3, "A package needs a title").max(255),
    deliveryMode: z.enum(DELIVERY_MODES),
    startDate: isoDate.nullish(),
    endDate: isoDate.nullish(),
    pax: z.number().int().min(1).max(5000),
    courseId: z.string().uuid().nullish(),
    minParticipants: z.number().int().min(1).max(5000).optional(),
    venueByClient: z.boolean().optional(),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, { message: "The end date is before the start date", path: ["endDate"] })
  .refine((v) => !v.endDate || !!v.startDate, { message: "An end date needs a start date", path: ["startDate"] });

export type PackageFields = z.input<typeof packageFields>;

function parseOrRefuse<T>(parser: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown, code: string): T {
  const parsed = parser.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`);
    throw new DomainError(code, issues.join("; "), { issues });
  }
  return parsed.data;
}

function requireOperator(actor: Actor): void {
  if (actor.type !== "USER") throw new DomainError("OPERATOR_REQUIRED", "Only an operator can create clients and packages");
}

const CONVERTIBLE = new Set(["LEAD_QUALIFIED_TNA", "TRIAGE_REVIEW", "PRIVATE_CASH", "LEAD_INGESTED"]);

export interface ConversionResult {
  package: TrainingPackage;
  client: Client;
  clientCreated: boolean;
  proposalTaskId: string | null;
}

export async function convertLeadToPackage(leadId: string, input: PackageFields, actor: Actor): Promise<ConversionResult> {
  requireOperator(actor);
  const fields = parseOrRefuse(packageFields, input, "PACKAGE_INPUT_INVALID");
  return withTx(actor, { reasonCode: "PACKAGE_CREATED", reasonDetails: `from lead ${leadId}`, metadata: { lead_id: leadId } }, async (tx) => {
    const lead = await lockLead(tx, leadId);
    if (lead.status === "CONVERTED") {
      throw new DomainError("LEAD_ALREADY_CONVERTED", "This lead is already a training package", { packageId: lead.convertedPackageId });
    }
    if (!CONVERTIBLE.has(lead.status)) {
      throw new DomainError("LEAD_NOT_CONVERTIBLE", `A ${lead.status.toLowerCase().replace(/_/g, " ")} lead cannot become a package`, {
        status: lead.status,
        duplicateOf: lead.duplicateOf,
      });
    }
    const { client, created } = await upsertClientFromLead(tx, lead, actor);
    const pkg = await insertPackage(tx, client.id, fields, actor, leadId);

    await tx.execute(sql`update tpms.lead_records
         set status = 'CONVERTED', converted_package_id = ${pkg.id}::uuid, client_id = ${client.id}::uuid,
             qualified_at = coalesce(qualified_at, now())
       where id = ${leadId}::uuid`);
    await recordAudit(tx, {
      entityType: "LEAD",
      entityId: leadId,
      reasonCode: "LEAD_CONVERTED",
      details: `Converted to ${pkg.packageCode}`,
      metadata: { package_id: pkg.id, package_code: pkg.packageCode, client_id: client.id, client_created: created, from: lead.status },
    });
    const proposalTaskId = await enqueueProposal(tx, pkg);
    return { package: pkg, client, clientCreated: created, proposalTaskId };
  });
}

/**
 * Finds the lead's company by (in order) the linked client, the corporate
 * domain, then the SSM number; creates it when none match. An existing
 * client's contact details are left alone — the lead may be a second PIC —
 * but a "yes" to the micro-TNA levy question marks it levy-registered.
 */
async function upsertClientFromLead(tx: Tx, lead: Lead, actor: Actor): Promise<{ client: Client; created: boolean }> {
  const levyActive = (lead.tnaProfile as { levyActive?: boolean | null }).levyActive;
  const existing = await one<{ id: string }>(
    tx,
    sql`select id from tpms.corporate_clients
         where id = ${lead.clientId}::uuid
            or (${lead.companyDomain}::text is not null and lower(company_domain) = lower(${lead.companyDomain}::text))
            or (${lead.ssmRegistrationNumber}::text is not null and ssm_registration = ${lead.ssmRegistrationNumber}::text)
         order by (id = ${lead.clientId}::uuid) desc nulls last,
                  (lower(company_domain) = lower(${lead.companyDomain}::text)) desc nulls last
         limit 1
         for update`,
  );
  if (existing) {
    if (levyActive === true) {
      await tx.execute(sql`update tpms.corporate_clients set levy_registered = true, account_type = 'SBL_KHAS_LEVY'
                           where id = ${existing.id}::uuid and not levy_registered`);
    }
    const [client] = await tx.select().from(schema.corporateClients).where(sql`id = ${existing.id}::uuid`);
    return { client, created: false };
  }
  const accountType = levyActive === false ? "PRIVATE_CASH" : lead.accountType;
  const [client] = await tx
    .insert(schema.corporateClients)
    .values({
      companyName: lead.companyName,
      companyDomain: lead.companyDomain,
      ssmRegistration: lead.ssmRegistrationNumber,
      levyRegistered: levyActive === true,
      accountType,
      primaryPicName: lead.picFullName || "(not given)",
      primaryPicEmail: lead.picEmail,
      primaryPicPhone: lead.picPhoneE164,
    })
    .returning();
  await recordAudit(tx, {
    entityType: "CLIENT",
    entityId: client.id,
    reasonCode: "CLIENT_CREATED",
    details: `${client.companyName} (from lead)`,
    metadata: { lead_id: lead.id, company_domain: client.companyDomain, account_type: accountType, levy_registered: client.levyRegistered, by: actor.id },
  });
  return { client, created: true };
}

async function insertPackage(
  tx: Tx,
  clientId: string,
  fields: z.output<typeof packageFields>,
  actor: Actor,
  leadId: string | null,
): Promise<TrainingPackage> {
  const [pkg] = await tx
    .insert(schema.trainingPackages)
    .values({
      packageCode: "",
      clientId,
      leadId,
      courseId: fields.courseId ?? null,
      title: fields.title,
      deliveryMode: fields.deliveryMode,
      venueByClient: fields.venueByClient ?? false,
      startDate: fields.startDate ?? null,
      endDate: fields.endDate ?? null,
      paxEstimate: fields.pax,
      minParticipants: fields.minParticipants ?? 5,
      createdBy: actor.id,
    })
    .returning();
  return pkg;
}

async function enqueueProposal(tx: Tx, pkg: TrainingPackage): Promise<string | null> {
  return enqueue(tx, { type: "commercial.draft_proposal", payload: { packageId: pkg.id }, idempotencyKey: draftProposalKey(pkg.id, pkg.version) });
}

// ---------------------------------------------------------------- manual creation

const directPackage = z.object({ clientId: z.string().uuid(), draftProposal: z.boolean().optional() });

/** A package for an existing client with no lead behind it (repeat business, a phone order). */
export async function createPackageDirect(
  input: PackageFields & { clientId: string; draftProposal?: boolean },
  actor: Actor,
): Promise<{ package: TrainingPackage; proposalTaskId: string | null }> {
  requireOperator(actor);
  const { clientId, draftProposal } = parseOrRefuse(directPackage, input, "PACKAGE_INPUT_INVALID");
  const fields = parseOrRefuse(packageFields, input, "PACKAGE_INPUT_INVALID");
  return withTx(actor, { reasonCode: "PACKAGE_CREATED", reasonDetails: "created directly by an operator" }, async (tx) => {
    const client = await one<{ id: string }>(tx, sql`select id from tpms.corporate_clients where id = ${clientId}::uuid`);
    if (!client) throw new DomainError("CLIENT_NOT_FOUND", `Client ${clientId} not found`);
    const pkg = await insertPackage(tx, clientId, fields, actor, null);
    const proposalTaskId = draftProposal === false ? null : await enqueueProposal(tx, pkg);
    return { package: pkg, proposalTaskId };
  });
}

const clientInput = z.object({
  companyName: z.string().trim().min(2).max(255),
  companyDomain: z.string().trim().max(100).nullish(),
  ssmRegistration: z.string().trim().max(50).nullish(),
  hrdcorpMycoid: z.string().trim().max(50).nullish(),
  industrySector: z.string().trim().max(100).nullish(),
  malaysianHeadcount: z.number().int().min(0).nullish(),
  levyRegistered: z.boolean().default(false),
  fiscalYearEndMonth: z.number().int().min(1).max(12).nullish(),
  accountType: z.enum(["SBL_KHAS_LEVY", "PRIVATE_CASH"]).optional(),
  primaryPicName: z.string().trim().min(2).max(255),
  primaryPicEmail: z.string().trim().max(255),
  primaryPicPhone: z.string().trim().max(30),
});
export type ClientInput = z.input<typeof clientInput>;

/**
 * Manual client creation. The domain is reduced to its registrable form and
 * a free-mail domain is refused as a company domain (it would make every
 * gmail.com lead "this client"). An existing domain or SSM number is a
 * refusal naming the existing client, never a second row.
 */
export async function createClient(input: ClientInput, actor: Actor): Promise<Client> {
  requireOperator(actor);
  const data = parseOrRefuse(clientInput, input, "CLIENT_INPUT_INVALID");
  const email = cleanEmail(data.primaryPicEmail);
  if (!email) throw new DomainError("CLIENT_INPUT_INVALID", "primaryPicEmail: not a valid email address");
  const phone = normaliseMalaysianPhone(data.primaryPicPhone);
  if (!phone) throw new DomainError("CLIENT_INPUT_INVALID", "primaryPicPhone: not a valid phone number");
  const rawDomain = data.companyDomain?.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase() || null;
  if (rawDomain && isFreeMailDomain(rawDomain)) {
    throw new DomainError("CLIENT_DOMAIN_IS_FREE_MAIL", `${rawDomain} is a public mailbox provider, not a company domain`);
  }
  const domain = rawDomain ? registrableDomain(rawDomain) : corporateDomainOf(email);
  const ssm = data.ssmRegistration?.toUpperCase() || null;

  return withTx(actor, { reasonCode: "CLIENT_CREATED" }, async (tx) => {
    const clash = await one<{ id: string; company_name: string }>(
      tx,
      sql`select id, company_name from tpms.corporate_clients
           where (${domain}::text is not null and lower(company_domain) = lower(${domain}::text))
              or (${ssm}::text is not null and ssm_registration = ${ssm}::text)
           limit 1`,
    );
    if (clash) {
      throw new DomainError("CLIENT_EXISTS", `${clash.company_name} already exists with this domain or SSM number`, { clientId: clash.id });
    }
    const [client] = await tx
      .insert(schema.corporateClients)
      .values({
        companyName: data.companyName,
        companyDomain: domain,
        ssmRegistration: ssm,
        hrdcorpMycoid: data.hrdcorpMycoid ?? null,
        industrySector: data.industrySector ?? null,
        malaysianHeadcount: data.malaysianHeadcount ?? null,
        levyRegistered: data.levyRegistered,
        fiscalYearEndMonth: data.fiscalYearEndMonth ?? null,
        accountType: data.accountType ?? "SBL_KHAS_LEVY",
        primaryPicName: data.primaryPicName,
        primaryPicEmail: email,
        primaryPicPhone: phone,
      })
      .returning();
    await recordAudit(tx, {
      entityType: "CLIENT",
      entityId: client.id,
      reasonCode: "CLIENT_CREATED",
      details: client.companyName,
      metadata: { company_domain: domain, ssm_registration: ssm, levy_registered: client.levyRegistered, account_type: client.accountType },
    });
    return client;
  });
}
