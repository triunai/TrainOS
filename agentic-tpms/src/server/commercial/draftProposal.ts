import { eq, sql } from "drizzle-orm";
import { toSen, type Sen } from "@/lib/money";
import { finishAgentRun, startAgentRun, type Provenance } from "@/server/ai";
import { type Actor, db, one, rows, schema, withTx } from "../db/client";
import type { Lead, TrainingPackage } from "../db/schema";
import { DomainError } from "../domain/errors";
import type { DeliveryMode } from "../domain/stages";
import { getCourse, isSeniority, searchCourses, specialtyTagsFor, type Course, type Seniority } from "@/server/knowledge";
import { packageFacts, priceQuotation, resolveQuoteInputs, type CostInputs } from "@/server/pricing";
import { buildOutline, tnaHighlights } from "./outline";
import { SOURCING_AGENT, insertQuotationVersion, lockPackage, raiseGate1Decision } from "./quotations";

/**
 * Task `commercial.draft_proposal` — the sourcing agent.
 *
 * Picks the course, a trainer and a venue, prices the package with both
 * engines, writes the Form HRD-L&D outline, stores quotation version n+1 as
 * AWAITING_APPROVAL and raises the Gate 1 decision.
 *
 * WHY it never touches the package row: agents propose, humans dispose. The
 * course, trainer rate and price reach the package only through the QUOTED
 * transition an operator triggers at Gate 1 (`approveAndDispatch`).
 */
export const AGENT_ACTOR: Actor = { type: "AGENT", id: SOURCING_AGENT };

/**
 * Cost assumptions the agent starts from when it has no better data. They
 * are editable cells on the quotation canvas, not policy. ILLUSTRATIVE
 * defaults: materials RM 50/pax (RM 20 for e-materials on ROT); other direct
 * costs cover trainer travel/logistics or the ROT platform and producer.
 */
export const DEFAULT_COST_ASSUMPTIONS: {
  materialsPerPax: Record<DeliveryMode, Sen>;
  otherDirectCosts: Record<DeliveryMode, Sen>;
  placeholderTrainerDayRate: Sen;
} = {
  materialsPerPax: { IN_HOUSE: 5_000, PUBLIC_PHYSICAL: 5_000, ROT_VIRTUAL: 2_000 },
  otherDirectCosts: { IN_HOUSE: 30_000, PUBLIC_PHYSICAL: 20_000, ROT_VIRTUAL: 25_000 },
  placeholderTrainerDayRate: 250_000,
};

export type ProposalWarning = "NO_TRAINER_MATCH" | "NO_VENUE_MATCH" | "DATES_MISSING" | "COURSE_FROM_SEARCH";

export interface DraftProposalResult {
  quotationId: string;
  version: number;
  decisionId: string | null;
  runId: string;
  courseId: string;
  trainerId: string | null;
  venueId: string | null;
  quotedAmount: string;
  allowableCap: string;
  marginPct: string;
  warnings: string[];
  reused: boolean;
}

interface TrainerPick {
  id: string;
  full_name: string;
  standard_day_rate: string;
  ttt_cert_number: string;
  specialties: string[];
}

interface VenuePick {
  id: string;
  name: string;
  city: string | null;
  capacity: number;
  ddr_per_pax: string;
}

/** A Postgres text[] literal; tags may contain spaces and quotes. */
function pgTextArray(values: string[]): string {
  return `{${values.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
}

/**
 * Cheapest TTT-verified trainer whose specialties overlap the course, whose
 * certificate outlives the programme, who has not blocked any training day,
 * and who is not already held on an overlapping package.
 */
export async function proposeTrainer(pkg: TrainingPackage, tags: string[]): Promise<TrainerPick | undefined> {
  if (tags.length === 0) return undefined;
  const start = pkg.startDate;
  const end = pkg.endDate ?? pkg.startDate;
  return one<TrainerPick>(
    db(),
    sql`select t.id, t.full_name, t.standard_day_rate, t.ttt_cert_number, t.specialties
          from tpms.trainers t
         where t.ttt_verified
           and exists (select 1 from unnest(t.specialties) s where lower(s) = any (${pgTextArray(tags)}::text[]))
           and (t.ttt_cert_expiry_date is null or ${end}::date is null or t.ttt_cert_expiry_date >= ${end}::date)
           and (${start}::date is null or not exists (
                 select 1 from unnest(t.unavailable_dates) d where d between ${start}::date and ${end}::date))
           and (${start}::date is null or not exists (
                 select 1 from tpms.trainer_engagements e
                   join tpms.training_packages p on p.id = e.package_id
                  where e.trainer_id = t.id and e.status <> 'RELEASED' and p.id <> ${pkg.id}::uuid
                    and p.operational_stage <> 'CANCELLED'
                    and p.start_date <= ${end}::date and p.end_date >= ${start}::date))
         order by t.standard_day_rate asc, t.full_name asc
         limit 1`,
  );
}

/** Cheapest venue (by DDR) that seats the cohort. Not called for ROT or a client-provided venue. */
export async function proposeVenue(pax: number): Promise<VenuePick | undefined> {
  return one<VenuePick>(
    db(),
    sql`select id, name, city, capacity, ddr_per_pax from tpms.vendors
         where vendor_type = 'VENUE' and capacity >= ${pax} and ddr_per_pax is not null
         order by ddr_per_pax asc, capacity asc, name asc
         limit 1`,
  );
}

function seniorityFrom(tna: Record<string, unknown>): Seniority | undefined {
  for (const key of ["seniority", "targetSeniority", "target_seniority"]) {
    const value = tna[key];
    if (typeof value === "string" && isSeniority(value.toUpperCase())) return value.toUpperCase() as Seniority;
  }
  return undefined;
}

async function chooseCourse(pkg: TrainingPackage, lead: Lead | undefined): Promise<{ course: Course; method: "PACKAGE" | "SEARCH"; score: number | null; query: string }> {
  if (pkg.courseId) {
    const course = await getCourse(pkg.courseId);
    if (!course) throw new DomainError("COURSE_NOT_FOUND", `Package course ${pkg.courseId} is not in the catalog`);
    return { course, method: "PACKAGE", score: null, query: "" };
  }
  const tna = lead?.tnaProfile ?? {};
  const query = [pkg.title, lead?.trainingTopic, lead?.message?.slice(0, 300), ...tnaHighlights(tna)].filter(Boolean).join(". ");
  const seniority = seniorityFrom(tna);
  let hits = await searchCourses(query, { limit: 1, seniority });
  if (hits.length === 0 && seniority) hits = await searchCourses(query, { limit: 1 });
  if (hits.length === 0) throw new DomainError("NO_COURSE_MATCH", "The catalog has no course for this package; pick one on the Commercial desk");
  const course = await getCourse(hits[0].id);
  if (!course) throw new Error(`Search returned course ${hits[0].id} that no longer exists`);
  return { course, method: "SEARCH", score: hits[0].score, query };
}

export async function draftProposal(
  packageId: string,
  opts: { taskId?: string | null; revisionNote?: string | null } = {},
): Promise<DraftProposalResult> {
  const runId = await startAgentRun(db(), {
    agent: SOURCING_AGENT,
    tier: "L3",
    packageId,
    taskId: opts.taskId ?? null,
    inputSummary: `Draft commercial proposal for package ${packageId}${opts.revisionNote ? ` (revision: ${opts.revisionNote})` : ""}`,
  });
  try {
    const [pkg] = await db().select().from(schema.trainingPackages).where(eq(schema.trainingPackages.id, packageId));
    if (!pkg) throw new DomainError("PACKAGE_NOT_FOUND", `Package ${packageId} not found`);
    if (pkg.operationalStage !== "DRAFT") {
      throw new DomainError("PACKAGE_NOT_DRAFT", `Proposals are drafted for DRAFT packages; ${pkg.packageCode} is ${pkg.operationalStage}`);
    }

    // Idempotent on the task: a worker that died after commit must not create a second version.
    if (opts.taskId) {
      const existing = await one<{ id: string; version: number; quoted_amount: string; allowable_cap: string; margin_pct: string; inputs: Record<string, unknown> }>(
        db(),
        sql`select id, version, quoted_amount, allowable_cap, margin_pct, inputs from tpms.quotations
             where package_id = ${packageId}::uuid and provenance->>'taskId' = ${opts.taskId}`,
      );
      if (existing) {
        const result: DraftProposalResult = {
          quotationId: existing.id,
          version: existing.version,
          decisionId: null,
          runId,
          courseId: String(existing.inputs.courseId ?? ""),
          trainerId: (existing.inputs.trainerId as string | null) ?? null,
          venueId: (existing.inputs.venueId as string | null) ?? null,
          quotedAmount: existing.quoted_amount,
          allowableCap: existing.allowable_cap,
          marginPct: existing.margin_pct,
          warnings: [],
          reused: true,
        };
        await finishAgentRun(db(), runId, { status: "SUCCEEDED", output: { ...result } });
        return result;
      }
    }

    const [client] = await db().select().from(schema.corporateClients).where(eq(schema.corporateClients.id, pkg.clientId));
    const [lead] = pkg.leadId ? await db().select().from(schema.leadRecords).where(eq(schema.leadRecords.id, pkg.leadId)) : [];
    const tna = lead?.tnaProfile ?? {};
    const warnings: string[] = [];

    const choice = await chooseCourse(pkg, lead);
    if (choice.method === "SEARCH") warnings.push("COURSE_FROM_SEARCH");
    const facts = packageFacts(pkg, choice.course.durationDays);
    if (!pkg.startDate) warnings.push("DATES_MISSING");

    const tags = specialtyTagsFor(choice.course);
    const trainer = await proposeTrainer(pkg, tags);
    if (!trainer) warnings.push("NO_TRAINER_MATCH");

    const needsVenue = pkg.deliveryMode !== "ROT_VIRTUAL" && !pkg.venueByClient;
    const venue = needsVenue ? await proposeVenue(facts.pax) : undefined;
    if (needsVenue && !venue) warnings.push("NO_VENUE_MATCH");

    const costs: CostInputs = {
      trainerDayRate: trainer ? toSen(trainer.standard_day_rate) : DEFAULT_COST_ASSUMPTIONS.placeholderTrainerDayRate,
      venueDdrPerPax: venue ? toSen(venue.ddr_per_pax) : 0,
      materialsPerPax: DEFAULT_COST_ASSUMPTIONS.materialsPerPax[facts.deliveryMode],
      otherDirectCosts: DEFAULT_COST_ASSUMPTIONS.otherDirectCosts[facts.deliveryMode],
      quotedFeeOverride: null,
    };
    const inputs = await resolveQuoteInputs(db(), facts, costs);
    const priced = await priceQuotation(inputs);

    const { outline, provenance: outlineProvenance } = await buildOutline({
      packageId: pkg.id,
      packageCode: pkg.packageCode,
      programmeTitle: pkg.title,
      course: choice.course,
      client: { companyName: client.companyName, industrySector: client.industrySector },
      deliveryMode: facts.deliveryMode,
      days: facts.days,
      startDate: pkg.startDate,
      pax: facts.pax,
      tna,
      trainer: trainer ? { fullName: trainer.full_name, tttCertNumber: trainer.ttt_cert_number } : null,
      venue: venue ? { name: venue.name, city: venue.city } : null,
      venueByClient: pkg.venueByClient,
    }, { runId });

    const allWarnings = [...warnings, ...priced.result.warnings];
    const provenance: Record<string, unknown> = {
      agent: SOURCING_AGENT,
      tier: "L3",
      runId,
      taskId: opts.taskId ?? null,
      revisionNote: opts.revisionNote ?? null,
      pricing: { tier: "L0", mode: "RULE", engines: priced.engines },
      outline: outlineProvenance,
      course: { method: choice.method, score: choice.score, query: choice.query, courseCode: choice.course.courseCode },
      trainer: trainer
        ? { rule: "TTT-verified, specialty overlap, available, lowest standard day rate", tags, name: trainer.full_name }
        : { rule: "no match", tags, placeholderRate: DEFAULT_COST_ASSUMPTIONS.placeholderTrainerDayRate },
      venue: venue ? { rule: "capacity >= pax, lowest DDR", name: venue.name, capacity: venue.capacity } : { rule: needsVenue ? "no match" : "not required" },
    };

    const { quotation, decisionId } = await withTx(AGENT_ACTOR, { reasonCode: "QUOTATION_DRAFTED" }, async (tx) => {
      const locked = await lockPackage(tx, pkg.id);
      if (locked.operationalStage !== "DRAFT") {
        throw new DomainError("PACKAGE_NOT_DRAFT", `${locked.packageCode} moved to ${locked.operationalStage} while the proposal was drafted`);
      }
      const q = await insertQuotationVersion(tx, {
        pkg: locked,
        priced,
        refs: { courseId: choice.course.id, trainerId: trainer?.id ?? null, venueId: venue?.id ?? null },
        outline,
        generatedBy: "AGENT",
        provenance,
        extraComputed: { proposalWarnings: warnings },
      });
      const decision = await raiseGate1Decision(tx, {
        pkg: locked,
        quotation: q,
        warnings: allWarnings,
        raisedBy: SOURCING_AGENT,
        tier: "L3",
        note: opts.revisionNote ?? undefined,
      });
      return { quotation: q, decisionId: decision.id };
    });

    const result: DraftProposalResult = {
      quotationId: quotation.id,
      version: quotation.version,
      decisionId,
      runId,
      courseId: choice.course.id,
      trainerId: trainer?.id ?? null,
      venueId: venue?.id ?? null,
      quotedAmount: quotation.quotedAmount,
      allowableCap: quotation.allowableCap,
      marginPct: quotation.marginPct,
      warnings: allWarnings,
      reused: false,
    };
    await finishAgentRun(db(), runId, {
      status: outlineProvenance.mode === "TEMPLATE" ? "FALLBACK" : "SUCCEEDED",
      output: { ...result },
      provenance: { ...(outlineProvenance as Provenance), runId },
      costMyr: outlineProvenance.costMyr,
    });
    return result;
  } catch (error) {
    await finishAgentRun(db(), runId, { status: "FAILED", error: error instanceof Error ? error.message : String(error) }).catch(() => undefined);
    throw error;
  }
}

/** Packages currently waiting on a proposal (used by the Commercial desk's "draft now" affordance). */
export async function draftablePackages(limit = 50): Promise<Array<{ id: string; package_code: string; title: string }>> {
  return rows(
    db(),
    sql`select p.id, p.package_code, p.title from tpms.training_packages p
         where p.operational_stage = 'DRAFT'
           and not exists (select 1 from tpms.quotations q where q.package_id = p.id and q.status = 'AWAITING_APPROVAL')
         order by p.created_at desc
         limit ${limit}`,
  );
}
