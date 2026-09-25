import { addDays, formatDate, formatRange, todayMY } from "@/lib/dates";
import { formatRM, fromSen, toSen } from "@/lib/money";
import { PdfBuilder } from "../documents/pdf";
import type { Client, Quotation, TrainingPackage, Trainer } from "../db/schema";
import { DELIVERY_MODE_LABEL, type DeliveryMode } from "../domain/stages";
import type { StoredLineItem } from "@/server/pricing";
import type { CourseOutline } from "./outline";

/**
 * The three Gate-1 artefacts, all built with the shared PdfBuilder:
 *
 *   - the client QUOTATION: shows the fee only. Trainer rates, venue cost and
 *     margin are internal and never printed on a client document.
 *   - Form HRD-L&D, the course outline HRD Corp evaluates the grant against.
 *   - the TRAINER AGREEMENT, whose tentative-booking and pay-when-paid clauses
 *     are what let the provider hold a trainer before any money is committed.
 */
const modeLabel = (mode: string): string => DELIVERY_MODE_LABEL[mode as DeliveryMode] ?? mode;

export function quotationReference(pkg: Pick<TrainingPackage, "packageCode">, version: number): string {
  return `QT-${pkg.packageCode}-v${version}`;
}

export interface QuotationPdfInput {
  pkg: TrainingPackage;
  client: Client;
  quotation: Quotation;
  outline?: CourseOutline | null;
  venueLabel?: string;
  issuedOn?: string;
}

export async function renderQuotationPdf(input: QuotationPdfInput): Promise<Uint8Array> {
  const { pkg, client, quotation } = input;
  const issued = input.issuedOn ?? todayMY();
  const reference = quotationReference(pkg, quotation.version);
  const pdf = await PdfBuilder.create({ title: "Quotation", reference });
  pdf.letterhead(pkg.title);

  pdf.keyValues([
    ["Prepared for", client.companyName],
    ["Attention", `${client.primaryPicName} · ${client.primaryPicEmail}`],
    ["Quotation date", formatDate(issued)],
    ["Valid until", formatDate(addDays(issued, 30))],
    ["Reference", reference],
  ]);

  pdf.heading("Programme");
  pdf.keyValues([
    ["Programme", pkg.title],
    ["Course", input.outline ? `${input.outline.courseTitle} (${input.outline.courseCode})` : "As per the attached course outline"],
    ["Delivery mode", modeLabel(pkg.deliveryMode)],
    ["Training dates", formatRange(pkg.startDate, pkg.endDate)],
    ["Duration", `${pkg.durationDays ?? "—"} day(s), 09:00–17:00`],
    ["Participants", `${pkg.paxEstimate} pax`],
    ["Venue", input.venueLabel ?? input.outline?.venue ?? "To be confirmed"],
  ]);

  const items = (quotation.lineItems as StoredLineItem[]).filter((l) => l.kind === "FEE");
  pdf.heading("Fees");
  pdf.table(
    [
      { label: "Description", width: 5 },
      { label: "Qty", width: 1, align: "right" },
      { label: "Unit", width: 1.4 },
      { label: "Unit price (RM)", width: 2, align: "right" },
      { label: "Amount (RM)", width: 2, align: "right" },
    ],
    [
      ...items.map((l) => [l.label, String(l.qty), l.unit, formatRM(l.unitCost).replace("RM ", ""), formatRM(l.amount).replace("RM ", "")]),
      ["Total", "", "", "", formatRM(quotation.quotedAmount).replace("RM ", "")],
    ],
    { boldLastRow: true },
  );

  pdf.caption(
    `Allowable Cost Matrix ${quotation.costPolicyVersion}: the cap for this programme is ${formatRM(quotation.allowableCap)}. ` +
      `The quoted fee of ${formatRM(quotation.quotedAmount)} is within the cap.`,
  );

  pdf.heading("Included");
  const inclusions = [
    "HRD Corp TTT-certified trainer for the full programme",
    "Course materials and participant workbook",
    pkg.deliveryMode === "ROT_VIRTUAL"
      ? "Live online delivery platform with session attendance capture"
      : pkg.venueByClient
        ? "Delivery at the client's premises (venue and meals provided by the client)"
        : "Training venue, two tea breaks and lunch per day",
    "Pre- and post-assessment and a certificate of attendance for participants with at least 80% attendance",
    "All HRD Corp claim documentation (attendance, evidence and invoice)",
  ];
  inclusions.forEach((line) => pdf.text(`- ${line}`, { size: 9.5 }));

  pdf.heading("Terms");
  [
    "1. Funding: this programme is intended to be claimed under the HRD Corp SBL-Khas scheme. The employer submits the grant application in e-TRiS using the attached Form HRD-L&D outline before the first training day.",
    "2. Booking: trainer and venue are held on a tentative basis and are confirmed on receipt of the e-TRiS grant approval or the employer's purchase order.",
    "3. Changes to dates or headcount after grant approval may require an amendment in e-TRiS; the fee is re-computed against the Allowable Cost Matrix.",
    "4. Any amount HRD Corp does not approve will be discussed with the employer in writing before delivery.",
  ].forEach((line) => pdf.text(line, { size: 9 }));

  pdf.spacer(18);
  pdf.text("Prepared by", { size: 8.5, color: "muted" });
  pdf.text("Commercial team", { size: 10, font: "bold" });
  return pdf.save({ footer: `Quotation v${quotation.version}` });
}

// ---------------------------------------------------------------- Form HRD-L&D
export interface OutlinePdfInput {
  pkg: TrainingPackage;
  client: Client;
  outline: CourseOutline;
}

export async function renderOutlinePdf(input: OutlinePdfInput): Promise<Uint8Array> {
  const { pkg, client, outline } = input;
  const pdf = await PdfBuilder.create({ title: "Course Outline (Form HRD-L&D)", reference: `LD-${pkg.packageCode}` });
  pdf.letterhead(outline.programmeTitle);

  pdf.heading("A. Programme information");
  pdf.keyValues([
    ["Programme title", outline.programmeTitle],
    ["Course", `${outline.courseTitle} (${outline.courseCode})`],
    ["Employer", client.companyName],
    ["Focus area", outline.focusArea],
    ["Competency reference", outline.nossReference ? `${outline.nossReference} (illustrative reference, to be confirmed)` : "—"],
    ["Target group", `${outline.targetAudience} · ${outline.pax} pax`],
    ["Delivery mode", modeLabel(outline.deliveryMode)],
    ["Dates", formatRange(outline.startDate, outline.endDate)],
    ["Duration", `${outline.durationDays} day(s) · ${outline.totalHours} contact hours`],
    ["Venue", outline.venue],
    ["Trainer", outline.trainer ? `${outline.trainer.name} (TTT ${outline.trainer.tttCertNumber})` : "To be assigned (HRD Corp TTT-certified)"],
  ]);

  pdf.heading("B. Learning outcomes");
  pdf.caption("At the end of the programme, participants will be able to:");
  outline.learningOutcomes.forEach((o, i) => pdf.text(`${i + 1}. ${o.outcome}  [Bloom level ${o.bloomLevel}]`, { size: 9.5 }));

  pdf.heading("C. Programme schedule");
  for (const day of outline.days) {
    pdf.caption(`Day ${day.day}${day.date ? ` · ${formatDate(day.date)}` : ""} · ${day.theme}`);
    pdf.table(
      [
        { label: "Time", width: 1.4 },
        { label: "Session", width: 3.2 },
        { label: "Content and activities", width: 5.4 },
      ],
      day.slots.map((s) => [`${s.start}–${s.end}`, s.title, s.topics.join("; ")]),
      { size: 8.5, zebra: true },
    );
  }

  pdf.heading("D. Training methodology");
  outline.methodology.forEach((m) => pdf.text(`- ${m}`, { size: 9.5 }));

  pdf.heading("E. Assessment and evaluation");
  pdf.text(outline.assessment.kirkpatrickL1, { size: 9.5 });
  pdf.text(outline.assessment.kirkpatrickL2, { size: 9.5 });
  pdf.caption(`Instruments: ${outline.assessment.instruments.join(", ")}`);

  pdf.heading("F. Workplace productivity justification");
  pdf.text(outline.productivityJustification, { size: 9.5 });
  if (outline.tnaHighlights.length > 0) {
    pdf.caption("Training needs analysis highlights");
    outline.tnaHighlights.forEach((h) => pdf.text(`- ${h}`, { size: 9 }));
  }
  return pdf.save({ footer: `Form HRD-L&D · ${outline.courseCode}` });
}

// ---------------------------------------------------------------- trainer agreement
export interface TrainerAgreementInput {
  pkg: TrainingPackage;
  client: Client;
  trainer: Pick<Trainer, "fullName" | "email" | "phone" | "nricMasked" | "tttCertNumber" | "tttCertExpiryDate">;
  dayRate: string;
  days: number;
  outline?: CourseOutline | null;
  issuedOn?: string;
}

export async function renderTrainerAgreementPdf(input: TrainerAgreementInput): Promise<Uint8Array> {
  const { pkg, client, trainer } = input;
  const issued = input.issuedOn ?? todayMY();
  const total = fromSen(toSen(input.dayRate) * input.days);
  const pdf = await PdfBuilder.create({ title: "Trainer Engagement Agreement", reference: `TA-${pkg.packageCode}` });
  pdf.letterhead(pkg.title);

  pdf.keyValues([
    ["Date", formatDate(issued)],
    ["Trainer", `${trainer.fullName} (NRIC ${trainer.nricMasked})`],
    ["Contact", `${trainer.email} · ${trainer.phone}`],
    ["TTT certificate", `${trainer.tttCertNumber}${trainer.tttCertExpiryDate ? ` · valid until ${formatDate(trainer.tttCertExpiryDate)}` : ""}`],
    ["Client", client.companyName],
    ["Programme", input.outline ? `${pkg.title} — ${input.outline.courseTitle} (${input.outline.courseCode})` : pkg.title],
    ["Dates", formatRange(pkg.startDate, pkg.endDate)],
    ["Delivery mode", modeLabel(pkg.deliveryMode)],
    ["Day rate", formatRM(input.dayRate)],
    ["Total fee", `${formatRM(total)} (${input.days} day(s) x ${formatRM(input.dayRate)})`],
  ]);

  pdf.heading("Terms of engagement");
  const clauses: Array<[string, string]> = [
    [
      "1. Tentative booking",
      "This agreement records a TENTATIVE booking of the trainer for the dates above. It is NOT binding on either party until the provider confirms it in writing after receiving (a) the client's purchase order or (b) the HRD Corp e-TRiS grant approval for this programme, whichever comes first. Until then either party may release the dates without penalty by written notice.",
    ],
    [
      "2. Fee and day rate",
      `The trainer's fee is ${formatRM(input.dayRate)} per training day, inclusive of preparation and delivery. No other fee, allowance or claim is payable unless agreed in writing before delivery.`,
    ],
    [
      "3. Payment: pay-when-paid",
      "The fee is payable within 14 days after HRD Corp remits the grant for this programme to the provider. The trainer acknowledges that remittance depends on complete claim evidence, and agrees to supply signed attendance, session photos and assessment records on the day they are produced.",
    ],
    [
      "4. Syllabus adherence",
      "The trainer will deliver the programme strictly in accordance with the approved Form HRD-L&D course outline, including its learning outcomes, schedule, breaks and assessments. HRD Corp approves the grant against that outline; any deviation requires the provider's prior written approval.",
    ],
    [
      "5. Certification and conduct",
      "The trainer warrants that the HRD Corp Train-the-Trainer certificate above is valid on every training day, and will conduct the programme professionally and in compliance with the Personal Data Protection Act 2010 for all participant information.",
    ],
    [
      "6. Cancellation and postponement",
      "If the programme is cancelled or postponed after written confirmation, the provider will give as much notice as practicable. Compensation, if any, is limited to amounts the provider is itself compensated for by the client.",
    ],
  ];
  for (const [title, body] of clauses) {
    pdf.text(title, { size: 10, font: "bold" });
    pdf.text(body, { size: 9.5 });
    pdf.spacer(4);
  }

  pdf.spacer(24);
  pdf.keyValues([
    ["For the provider", "______________________________   Date: __________"],
    ["Trainer", "______________________________   Date: __________"],
  ]);
  return pdf.save({ footer: "Tentative until confirmed in writing" });
}

// ---------------------------------------------------------------- BEO filename helper
export function beoFileName(packageCode: string, original: string): string {
  const safe = original.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "beo.pdf";
  return `${packageCode}-BEO-${safe}`;
}
