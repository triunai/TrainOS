import { and, eq, sql } from "drizzle-orm";
import { formatDate, formatRange } from "@/lib/dates";
import { type Actor, type Executor, db, one, rows, schema, withTx } from "../db/client";
import { DomainError } from "../domain/errors";
import { DELIVERY_MODE_LABEL, type DeliveryMode } from "../domain/stages";
import { PDF_MIME, PdfBuilder } from "../documents/pdf";
import { sha256Hex } from "../lib/crypto";
import { storeDocument } from "../storage/vault";
import { ASSESSMENT_ACTOR, round2 } from "./service";

/**
 * Kirkpatrick Level 2 (learning) for one delivered cohort.
 *
 * Averages per sitting are over everyone who sat it; the learning gain is
 * over MATCHED PAIRS only (participants with both a PRE and a POST). Mixing
 * the two — post average of 20 minus pre average of 15 — reports a gain that
 * is partly just a different set of people.
 */
export const SCORE_BANDS = [
  { band: "0–19", min: 0, max: 20 },
  { band: "20–39", min: 20, max: 40 },
  { band: "40–59", min: 40, max: 60 },
  { band: "60–79", min: 60, max: 80 },
  { band: "80–100", min: 80, max: 100.0001 },
] as const;

export interface CohortParticipantRow {
  participantId: string;
  name: string;
  nricMasked: string;
  pre: number | null;
  post: number | null;
  delta: number | null;
}

export interface CohortReport {
  packageId: string;
  packageCode: string;
  programmeTitle: string;
  clientName: string;
  deliveryMode: string;
  startDate: string | null;
  endDate: string | null;
  /** Active (non-withdrawn) participants. */
  n: number;
  nPre: number;
  nPost: number;
  /** Participants with both sittings — the base for the delta. */
  nPaired: number;
  preAvg: number | null;
  postAvg: number | null;
  paired: { preAvg: number | null; postAvg: number | null };
  /** Mean of (post − pre) over matched pairs, in percentage points. */
  deltaAvg: number | null;
  /** Relative gain over matched pairs: (postAvg − preAvg) / preAvg × 100. Null when the paired pre average is 0. */
  deltaPct: number | null;
  improvedCount: number;
  distribution: Array<{ band: string; pre: number; post: number }>;
  perParticipant: CohortParticipantRow[];
  /** Level 1 (reaction), captured as an optional 1–5 rating with the POST sitting. */
  reaction: { n: number; avg: number | null };
  quiz: { questionCount: number | null; generator: string | null; mode: string | null };
  /** Latest submission time; the report is a function of the data up to here. */
  dataAsAt: string | null;
}

const avg = (values: number[]) => (values.length ? round2(values.reduce((a, b) => a + b, 0) / values.length) : null);

interface Row {
  id: string;
  full_name: string;
  nric_masked: string;
  pre: string | null;
  post: string | null;
  reaction: number | null;
  last_at: Date | null;
}

export async function cohortReport(packageId: string, executor: Executor = db()): Promise<CohortReport> {
  const pkg = await one<{
    id: string; package_code: string; title: string; delivery_mode: string; start_date: string | null; end_date: string | null;
    company_name: string; course_id: string | null;
  }>(
    executor,
    sql`select p.id, p.package_code, p.title, p.delivery_mode, p.start_date, p.end_date, p.course_id, c.company_name
          from tpms.training_packages p join tpms.corporate_clients c on c.id = p.client_id
         where p.id = ${packageId}::uuid`,
  );
  if (!pkg) throw new DomainError("PACKAGE_NOT_FOUND", `Package ${packageId} not found`);

  // Scores come from participant_assessments (the immutable record), not the
  // denormalised kirkpatrick_*_score columns on the participant.
  const list = await rows<Row>(
    executor,
    sql`select p.id, p.full_name, p.nric_masked,
               pre.score as pre, post.score as post, post.reaction_rating as reaction,
               greatest(pre.submitted_at, post.submitted_at) as last_at
          from tpms.package_participants p
          left join tpms.participant_assessments pre on pre.participant_id = p.id and pre.kind = 'PRE'
          left join tpms.participant_assessments post on post.participant_id = p.id and post.kind = 'POST'
         where p.package_id = ${packageId}::uuid and p.registration_status <> 'WITHDRAWN'
         order by p.full_name, p.id`,
  );

  const perParticipant: CohortParticipantRow[] = list.map((r) => {
    const pre = r.pre === null ? null : Number(r.pre);
    const post = r.post === null ? null : Number(r.post);
    return {
      participantId: r.id,
      name: r.full_name,
      nricMasked: r.nric_masked,
      pre,
      post,
      delta: pre !== null && post !== null ? round2(post - pre) : null,
    };
  });
  const pres = perParticipant.flatMap((p) => (p.pre === null ? [] : [p.pre]));
  const posts = perParticipant.flatMap((p) => (p.post === null ? [] : [p.post]));
  const pairs = perParticipant.filter((p) => p.delta !== null);
  const pairedPre = avg(pairs.map((p) => p.pre as number));
  const pairedPost = avg(pairs.map((p) => p.post as number));
  const deltaAvg = avg(pairs.map((p) => p.delta as number));
  const reactions = list.flatMap((r) => (r.reaction === null ? [] : [Number(r.reaction)]));
  const lastAt = list.reduce<Date | null>((acc, r) => (r.last_at && (!acc || new Date(r.last_at) > acc) ? new Date(r.last_at) : acc), null);

  const bank = pkg.course_id
    ? await one<{ n: number; generator: string | null; mode: string | null }>(
        executor,
        sql`select jsonb_array_length(questions) as n, provenance->>'generator' as generator, provenance->>'mode' as mode
              from tpms.quiz_banks where course_id = ${pkg.course_id}::uuid`,
      )
    : undefined;

  const inBand = (score: number, b: (typeof SCORE_BANDS)[number]) => score >= b.min && score < b.max;
  return {
    packageId,
    packageCode: pkg.package_code,
    programmeTitle: pkg.title,
    clientName: pkg.company_name,
    deliveryMode: pkg.delivery_mode,
    startDate: pkg.start_date,
    endDate: pkg.end_date,
    n: perParticipant.length,
    nPre: pres.length,
    nPost: posts.length,
    nPaired: pairs.length,
    preAvg: avg(pres),
    postAvg: avg(posts),
    paired: { preAvg: pairedPre, postAvg: pairedPost },
    deltaAvg,
    deltaPct: pairedPre !== null && pairedPost !== null && pairedPre > 0 ? round2(((pairedPost - pairedPre) / pairedPre) * 100) : null,
    improvedCount: pairs.filter((p) => (p.delta as number) > 0).length,
    distribution: SCORE_BANDS.map((b) => ({
      band: b.band,
      pre: pres.filter((s) => inBand(s, b)).length,
      post: posts.filter((s) => inBand(s, b)).length,
    })),
    perParticipant,
    reaction: { n: reactions.length, avg: avg(reactions) },
    quiz: { questionCount: bank ? Number(bank.n) : null, generator: bank?.generator ?? null, mode: bank?.mode ?? null },
    dataAsAt: lastAt ? lastAt.toISOString() : null,
  };
}

// --------------------------------------------------------------------- PDF

const fmt = (n: number | null, suffix = "") => (n === null ? "—" : `${n.toFixed(1)}${suffix}`);
const signed = (n: number | null, suffix = "") => (n === null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(1)}${suffix}`);

export async function buildKirkpatrickPdf(report: CohortReport): Promise<Uint8Array> {
  const b = await PdfBuilder.create({ title: "Training Effectiveness Report", reference: report.packageCode });
  b.letterhead("Kirkpatrick Level 2 — Learning evaluation");

  const mode = (report.deliveryMode in DELIVERY_MODE_LABEL ? DELIVERY_MODE_LABEL[report.deliveryMode as DeliveryMode] : report.deliveryMode);
  b.keyValues([
    ["Programme", report.programmeTitle],
    ["Client", report.clientName],
    ["Package", report.packageCode],
    ["Dates", formatRange(report.startDate, report.endDate)],
    ["Delivery mode", mode],
    ["Participants", `${report.n} active · ${report.nPre} pre-assessed · ${report.nPost} post-assessed · ${report.nPaired} matched pairs`],
    ["Assessment data as at", report.dataAsAt ? formatDate(report.dataAsAt, true) : "—"],
  ]);

  b.heading("Method");
  const q = report.quiz.questionCount ?? 10;
  const source =
    report.quiz.mode === "LLM"
      ? "The question bank was drafted by the L3 assessment agent from the programme's learning outcomes and outline."
      : "The question bank was generated deterministically from the programme's learning outcomes and outline.";
  b.text(
    `Level 2 (learning) is measured with a ${q}-question multiple-choice assessment taken before the first session ` +
      "(pre-assessment) and after the last session (post-assessment). Both sittings use the same question bank. " +
      "Question order and option order are shuffled per participant and per sitting, and no answer feedback is given " +
      "after the pre-assessment, so the post-assessment cannot be answered from memory of the pre-assessment key. " +
      "A score is the percentage of all questions answered correctly; unanswered questions count as incorrect.",
    { size: 9.5, color: "secondary" },
  );
  b.spacer(4);
  b.text(
    `${source} Averages per sitting include everyone who sat it. Learning gain is computed over matched pairs only ` +
      "(participants with both sittings): the average gain in percentage points, and the relative gain against the matched pre-assessment average.",
    { size: 9.5, color: "secondary" },
  );

  b.heading("Results");
  b.table(
    [
      { label: "Measure", width: 3 },
      { label: "Value", width: 1.4, align: "right" },
      { label: "Base", width: 1.6, align: "right" },
    ],
    [
      ["Pre-assessment average", fmt(report.preAvg, "%"), `${report.nPre} participants`],
      ["Post-assessment average", fmt(report.postAvg, "%"), `${report.nPost} participants`],
      ["Matched pre average", fmt(report.paired.preAvg, "%"), `${report.nPaired} pairs`],
      ["Matched post average", fmt(report.paired.postAvg, "%"), `${report.nPaired} pairs`],
      ["Average gain (points)", signed(report.deltaAvg), `${report.nPaired} pairs`],
      ["Relative gain", signed(report.deltaPct, "%"), `${report.nPaired} pairs`],
      ["Participants who improved", `${report.improvedCount}`, `of ${report.nPaired} pairs`],
    ],
  );

  b.heading("Score distribution");
  b.table(
    [
      { label: "Score band", width: 2 },
      { label: "Pre-assessment", width: 1.5, align: "right" },
      { label: "Post-assessment", width: 1.5, align: "right" },
    ],
    report.distribution.map((d) => [`${d.band}%`, String(d.pre), String(d.post)]),
  );

  // Keep the participant table whole when it fits on one page, rather than
  // stranding its header and first row at the foot of this one.
  const tableHeight = (report.perParticipant.length + 1) * 19 + 34;
  if (tableHeight < b.pageHeight - 160) b.ensure(tableHeight);
  b.heading("Participant results");
  b.table(
    [
      { label: "Participant", width: 3 },
      { label: "NRIC", width: 1.8 },
      { label: "Pre", width: 0.9, align: "right" },
      { label: "Post", width: 0.9, align: "right" },
      { label: "Change", width: 1, align: "right" },
    ],
    report.perParticipant.map((p) => [p.name, p.nricMasked, fmt(p.pre), fmt(p.post), signed(p.delta)]),
    { zebra: true },
  );

  b.heading("Level 1 — Reaction");
  b.text(
    report.reaction.n > 0
      ? `Average satisfaction rating ${report.reaction.avg?.toFixed(2)} / 5 from ${report.reaction.n} post-assessment responses.`
      : "Level 1 (reaction) was not captured for this cohort: no participant gave a rating with the post-assessment.",
    { size: 9.5 },
  );
  b.spacer(6);
  b.text("Levels 3 (behaviour) and 4 (results) are outside the scope of this report.", { size: 8.5, color: "muted" });

  return b.save({ footer: "Kirkpatrick Level 2 learning evaluation" });
}

export interface KirkpatrickReportResult {
  vaultId: string;
  sha256: string;
  fileName: string;
  /** False when an identical report was already in the vault and was returned instead. */
  created: boolean;
  report: CohortReport;
}

/**
 * Render and file the report in the vault (KIRKPATRICK_REPORT). The PDF is a
 * pure function of the data, so re-rendering unchanged data returns the
 * existing vault row instead of stacking identical evidence.
 */
export async function renderKirkpatrickReportPdf(packageId: string, opts: { actor?: Actor } = {}): Promise<KirkpatrickReportResult> {
  const report = await cohortReport(packageId);
  if (report.nPre + report.nPost === 0) {
    throw new DomainError("NO_ASSESSMENTS", "No participant has sat an assessment yet; there is nothing to report");
  }
  const bytes = await buildKirkpatrickPdf(report);
  const hash = sha256Hex(bytes);
  const fileName = `${report.packageCode}-kirkpatrick-L2.pdf`;
  const [existing] = await db()
    .select({ id: schema.complianceVault.id })
    .from(schema.complianceVault)
    .where(
      and(
        eq(schema.complianceVault.packageId, packageId),
        eq(schema.complianceVault.documentType, "KIRKPATRICK_REPORT"),
        eq(schema.complianceVault.fileHashSha256, hash),
      ),
    );
  if (existing) return { vaultId: existing.id, sha256: hash, fileName, created: false, report };

  const actor = opts.actor ?? ASSESSMENT_ACTOR;
  const by = actor.id;
  const doc = await withTx(actor, { reasonCode: "KIRKPATRICK_REPORT_FILED" }, (tx) => storeDocument(tx, {
    packageId,
    documentType: "KIRKPATRICK_REPORT",
    fileName,
    mimeType: PDF_MIME,
    bytes,
    uploadedBy: by,
    verificationStatus: "VERIFIED",
    verifiedBy: by,
    verificationNotes: "Generated from submitted assessments",
    extractedMetadata: {
      n: report.n,
      n_paired: report.nPaired,
      pre_avg: report.preAvg,
      post_avg: report.postAvg,
      delta_avg: report.deltaAvg,
      delta_pct: report.deltaPct,
      data_as_at: report.dataAsAt,
    },
  }));
  return { vaultId: doc.id, sha256: doc.fileHashSha256, fileName, created: true, report };
}
