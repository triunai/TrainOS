import { StatusChip, type StatusTone } from "@/components/kit";
import { formatDate } from "@/lib/dates";
import type { VaultDocument } from "@/server/db/schema";

const STATUS_TONE: Record<string, StatusTone> = { PENDING: "warning", VERIFIED: "success", FLAGGED: "danger" };

export const DOCUMENT_LABEL: Record<string, string> = {
  FORM_HRD_LD: "Form HRD-L&D outline",
  QUOTATION: "Quotation",
  ETRIS_DOSSIER: "e-TRiS support dossier",
  ETRIS_APPROVAL: "e-TRiS approval letter",
  TRAINER_CV: "Trainer CV",
  TTT_CERT: "TTT certificate",
  TRAINER_AGREEMENT: "Trainer agreement",
  FORM_T3: "Form T3 attendance",
  FORM_T3_TEMPLATE: "Form T3 template",
  FORM_JD14: "Form JD/14",
  BEO: "Banquet event order",
  DO: "Delivery order",
  PHOTO_EVIDENCE: "Session photo",
  TAX_INVOICE: "Tax invoice",
  PV: "Payment voucher",
  PAYMENT_RECEIPT: "Payment receipt",
  REMITTANCE_ADVICE: "Remittance advice",
  CERTIFICATE: "Certificate",
  CLAIM_PACK: "SBL-Khas claim pack",
  KIRKPATRICK_REPORT: "Kirkpatrick L2 report",
  EXEC_PACK: "Executive delivery pack",
  OTHER: "Other",
};

/** The evidence vault for one package: every row is content-addressed and verifiable on download. */
export function VaultTable({ docs, emptyText = "No documents in the vault yet." }: { docs: VaultDocument[]; emptyText?: string }) {
  if (docs.length === 0) return <p className="px-4 py-3 text-[13px] text-ink-muted">{emptyText}</p>;
  return (
    <table className="w-full border-collapse text-[13px]">
      <thead className="bg-surface text-left">
        <tr className="border-b border-border">
          {["Document", "File", "SHA-256", "Status", "Added"].map((h) => (
            <th key={h} className="whitespace-nowrap px-3 py-2 text-[12px] font-medium text-ink-muted">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {docs.map((d, i) => (
          <tr key={d.id} className={i % 2 ? "border-b border-divider bg-surface/60" : "border-b border-divider"}>
            <td className="px-3 py-2">{DOCUMENT_LABEL[d.documentType] ?? d.documentType}</td>
            <td className="max-w-[220px] truncate px-3 py-2">
              <a href={`/api/v1/vault/${d.id}`} target="_blank" rel="noreferrer" className="text-primary-hover underline-offset-2 hover:underline">
                {d.fileName}
              </a>
            </td>
            <td className="px-3 py-2 font-mono text-[11px] text-ink-muted" title={d.fileHashSha256}>
              {d.fileHashSha256.slice(0, 16)}…
            </td>
            <td className="px-3 py-2">
              <StatusChip tone={STATUS_TONE[d.verificationStatus] ?? "neutral"}>{d.verificationStatus.toLowerCase()}</StatusChip>
            </td>
            <td className="whitespace-nowrap px-3 py-2 text-ink-secondary">{formatDate(d.createdAt ?? null)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
