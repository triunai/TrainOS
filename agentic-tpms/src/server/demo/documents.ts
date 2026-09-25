import { formatDate } from "@/lib/dates";
import { formatRM } from "@/lib/money";
import { env } from "../env";
import { PdfBuilder } from "../documents/pdf";

/**
 * Paperwork that, in real life, arrives from outside the system: HRD Corp's
 * e-TRiS approval letter and remittance advice, the venue's signed BEO, the
 * trainer's countersigned agreement, the employer's Form JD/14 and the bank's
 * transfer receipt. The golden path uploads these the way an operator would,
 * through the lanes' own upload functions. All content is fictional.
 *
 * The e-TRiS letter follows the layout of tests/fixtures/letters/etris-approval.txt
 * line for line, because that is the layout the L2 extractor reads.
 */
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export interface LetterInput {
  employerName: string;
  mycoid: string;
  grantId: string;
  ourRef: string;
  letterDate: string;
  programmeTitle: string;
  startDate: string;
  endDate: string;
  trainees: number;
  approvedAmount: string;
}

export async function etrisApprovalLetterPdf(x: LetterInput): Promise<Uint8Array> {
  const lines = [
    "PEMBANGUNAN SUMBER MANUSIA BERHAD (HRD CORP)",
    "Wisma HRD Corp, Jalan Beringin, Damansara Heights, 50490 Kuala Lumpur",
    "",
    `Date: ${dmy(x.letterDate)}`,
    `Our Ref: ${x.ourRef}`,
    "",
    "The Human Resource Manager",
    x.employerName.toUpperCase(),
    "",
    "APPROVAL OF TRAINING GRANT - SKIM BANTUAN LATIHAN KHAS (SBL-KHAS)",
    "",
    "We are pleased to inform you that your application has been approved as follows:",
    "",
    `Employer: ${x.employerName}`,
    `MyCoID: ${x.mycoid}`,
    `Grant ID: ${x.grantId}`,
    `Programme Title: ${x.programmeTitle}`,
    `Training Provider: ${env().TPMS_PROVIDER_NAME} (${env().TPMS_PROVIDER_HRDC_ID})`,
    `Training Date: ${dmy(x.startDate)} to ${dmy(x.endDate)}`,
    `No. of Trainees: ${x.trainees}`,
    `Approved Amount: ${formatRM(x.approvedAmount)}`,
    "",
    "The claim must be submitted within six (6) months after the training ends,",
    "together with Form T3 (attendance), Form JD/14 and the tax invoice.",
    "",
    "This is a computer-generated letter. No signature is required.",
  ];
  const pdf = await PdfBuilder.create({ title: "Grant approval", author: "HRD Corp (demo)" });
  for (const line of lines) pdf.text(line || " ", { size: 10 });
  return pdf.save();
}

export async function venueBeoPdf(x: {
  venueName: string;
  reference: string;
  packageCode: string;
  clientName: string;
  programmeTitle: string;
  startDate: string;
  endDate: string;
  pax: number;
  ddrPerPax: string;
  total: string;
}): Promise<Uint8Array> {
  const pdf = await PdfBuilder.create({ title: "Banquet Event Order", reference: x.reference, author: x.venueName });
  pdf.text(x.venueName, { size: 14, font: "bold" }).text("Banquet Event Order (BEO) — signed confirmation", { size: 10, color: "secondary" }).rule();
  pdf.keyValues([
    ["BEO reference", x.reference],
    ["Organiser", `${env().TPMS_PROVIDER_NAME} (${x.packageCode})`],
    ["End client", x.clientName],
    ["Event", x.programmeTitle],
    ["Dates", `${formatDate(x.startDate)} – ${formatDate(x.endDate)}`],
    ["Room set-up", "Classroom, projector, 2 flipcharts, PA system"],
    ["Guaranteed pax", String(x.pax)],
    ["Day delegate rate", `${formatRM(x.ddrPerPax)} per pax per day (AM/PM tea, buffet lunch)`],
    ["Estimated total", formatRM(x.total)],
  ]);
  pdf.spacer(18).text("Signed for the venue: Events Manager (signature and hotel stamp on file)", { size: 9, color: "muted" });
  pdf.text(`Signed for the organiser: Operations, ${env().TPMS_PROVIDER_NAME}`, { size: 9, color: "muted" });
  return pdf.save();
}

export async function executedTrainerAgreementPdf(x: {
  packageCode: string;
  trainerName: string;
  tttCertNumber: string | null;
  programmeTitle: string;
  startDate: string;
  endDate: string;
  dayRate: string;
  signedOn: string;
}): Promise<Uint8Array> {
  const pdf = await PdfBuilder.create({ title: "Trainer Services Agreement", reference: `TA-${x.packageCode}-EXECUTED` });
  pdf.letterhead("Executed copy — countersigned by both parties");
  pdf.keyValues([
    ["Trainer", `${x.trainerName}${x.tttCertNumber ? ` (HRD Corp TTT ${x.tttCertNumber})` : ""}`],
    ["Programme", x.programmeTitle],
    ["Dates", `${formatDate(x.startDate)} – ${formatDate(x.endDate)}`],
    ["Day rate", `${formatRM(x.dayRate)} per training day`],
    ["Payment terms", "Pay-when-paid: payable within 14 days of HRD Corp remitting the SBL-Khas claim"],
    ["Mileage", "Claimable at RM 0.60/km against a mileage log, added to the payment voucher"],
    ["Executed on", formatDate(x.signedOn)],
  ]);
  pdf.spacer(18).text(`Signed: ${x.trainerName}`, { size: 9, color: "muted" }).text(`Signed: for ${env().TPMS_PROVIDER_NAME}`, { size: 9, color: "muted" });
  return pdf.save();
}

export async function formJd14Pdf(x: {
  employerName: string;
  grantId: string;
  programmeTitle: string;
  startDate: string;
  endDate: string;
  participants: number;
  signatory: string;
}): Promise<Uint8Array> {
  const pdf = await PdfBuilder.create({ title: "Form JD/14", reference: `JD14-${x.grantId}`, author: x.employerName });
  pdf.text("BORANG JD/14 — PENGESAHAN MAJIKAN (EMPLOYER VERIFICATION)", { size: 11, font: "bold" }).rule();
  pdf.keyValues([
    ["Employer", x.employerName],
    ["Grant ID", x.grantId],
    ["Programme", x.programmeTitle],
    ["Training dates", `${formatDate(x.startDate)} – ${formatDate(x.endDate)}`],
    ["Employees trained", String(x.participants)],
  ]);
  pdf.spacer(10).text("We confirm that the above training was conducted as stated and attended by our employees.", { size: 9.5 });
  pdf.spacer(18).text(`Signed: ${x.signatory}, Human Resource Manager`, { size: 9, color: "muted" });
  pdf.text(`Company stamp: ${x.employerName.toUpperCase()}`, { size: 9, color: "muted" });
  return pdf.save();
}

export async function remittanceAdvicePdf(x: {
  employerName: string;
  grantId: string;
  claimRef: string;
  reference: string;
  amount: string;
  paidOn: string;
}): Promise<Uint8Array> {
  const pdf = await PdfBuilder.create({ title: "Remittance advice", reference: x.reference, author: "HRD Corp (demo)" });
  pdf.text("PEMBANGUNAN SUMBER MANUSIA BERHAD (HRD CORP) — REMITTANCE ADVICE", { size: 11, font: "bold" }).rule();
  pdf.keyValues([
    ["Payee", `${env().TPMS_PROVIDER_NAME} (${env().TPMS_PROVIDER_HRDC_ID})`],
    ["Employer", x.employerName],
    ["Grant ID", x.grantId],
    ["Claim reference", x.claimRef],
    ["Remittance reference", x.reference],
    ["Amount remitted", formatRM(x.amount)],
    ["Value date", formatDate(x.paidOn)],
  ]);
  return pdf.save();
}

export async function bankReceiptPdf(x: { bankReference: string; payee: string; amount: string; pvNumber: string; paidOn: string }): Promise<Uint8Array> {
  const pdf = await PdfBuilder.create({ title: "Transfer receipt", reference: x.bankReference, author: "Demo Bank Berhad" });
  pdf.text("DEMO BANK BERHAD — INSTANT TRANSFER (DuitNow) RECEIPT", { size: 11, font: "bold" }).rule();
  pdf.keyValues([
    ["Reference", x.bankReference],
    ["From", env().TPMS_PROVIDER_NAME],
    ["To", x.payee],
    ["Amount", formatRM(x.amount)],
    ["Recipient reference", x.pvNumber],
    ["Date", formatDate(x.paidOn)],
    ["Status", "Successful"],
  ]);
  return pdf.save();
}

export async function tttCertificatePdf(x: { trainerName: string; certNumber: string; expiry: string | null }): Promise<Uint8Array> {
  const pdf = await PdfBuilder.create({ title: "Train the Trainer certificate", reference: x.certNumber, author: "HRD Corp (demo)" });
  pdf.text("PEMBANGUNAN SUMBER MANUSIA BERHAD (HRD CORP)", { size: 11, font: "bold" }).text("Certificate of Achievement — Train the Trainer (TTT)", { size: 10, color: "secondary" }).rule();
  pdf.keyValues([
    ["Awarded to", x.trainerName],
    ["Certificate no.", x.certNumber],
    ["Valid until", x.expiry ? formatDate(x.expiry) : "No expiry stated"],
  ]);
  pdf.spacer(12).text("This certifies that the above has completed the HRD Corp Train the Trainer programme and is eligible to deliver HRD Corp claimable training.", { size: 9.5 });
  return pdf.save();
}
