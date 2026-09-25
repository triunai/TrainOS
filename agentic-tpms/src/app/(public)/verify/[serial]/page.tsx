import { Banner, DefinitionList, StatusChip } from "@/components/kit";
import { formatDate } from "@/lib/dates";
import { verifyCertificate } from "@/server/certificates";

export const dynamic = "force-dynamic";
export const metadata = { title: "Certificate verification", robots: { index: false } };

/**
 * The page a certificate's QR code opens. It recomputes three independent
 * checks — the stored PDF against its SHA-256, the payload rebuilt from the
 * database against its hash, and the issuance entry in the audit ledger — and
 * shows only what an employer needs: holder, masked NRIC, programme, dates.
 */
export default async function VerifyPage({ params }: { params: { serial: string } }) {
  const result = await verifyCertificate(decodeURIComponent(params.serial));
  if (result.status === "NOT_FOUND") {
    return (
      <div className="mt-6 flex flex-col gap-3">
        <h1 className="text-[22px] font-semibold">Certificate not found</h1>
        <Banner tone="danger" title={`No certificate with serial ${result.serial}`}>
          Check the serial printed on the certificate. A certificate that cannot be found here was not issued by this provider.
        </Banner>
      </div>
    );
  }
  const tone = result.status === "VALID" ? "success" : "danger";
  const headline =
    result.status === "VALID" ? "This certificate is genuine" : result.status === "REVOKED" ? "This certificate has been revoked" : "This certificate failed verification";
  return (
    <div className="mt-6 flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <h1 className="text-[22px] font-semibold">{headline}</h1>
        <StatusChip tone={tone} live>
          {result.status.toLowerCase()}
        </StatusChip>
      </div>
      <section className="flex flex-col gap-3 rounded-card border border-border bg-card p-5 shadow-card">
        <p className="font-mono text-[12px] text-ink-muted">{result.serial}</p>
        <p className="text-[20px] font-semibold text-ink">{result.holderName}</p>
        <DefinitionList
          items={[
            ["NRIC", result.nricMasked],
            ["Programme", result.courseTitle],
            ["Dates", `${formatDate(result.startDate)} – ${formatDate(result.endDate)}`],
            ["Hours", String(result.hours)],
            ["Provider", `${result.providerName} (${result.providerHrdcId})`],
            ["Issued", formatDate(result.issuedAt, true)],
            ...(result.revokedAt ? ([["Revoked", formatDate(result.revokedAt, true)]] as Array<[string, string]>) : []),
          ]}
        />
      </section>
      <section className="flex flex-col gap-2 rounded-card border border-border bg-card p-5">
        <p className="text-[12px] font-medium text-ink-muted">Integrity checks</p>
        <ul className="flex flex-col gap-1.5 text-[13px]">
          {[
            ["Certificate file matches its SHA-256", result.checks.file],
            ["Certified details match the issued record", result.checks.payload],
            ["Issuance recorded in the tamper-evident ledger", result.checks.ledger],
          ].map(([label, ok]) => (
            <li key={String(label)} className="flex items-center gap-2">
              <span aria-hidden="true" className={ok ? "text-success" : "text-danger"}>
                {ok ? "✓" : "✕"}
              </span>
              {label}
            </li>
          ))}
        </ul>
        <p className="break-all font-mono text-[11px] text-ink-muted">payload sha256 {result.payloadSha256}</p>
        <p className="break-all font-mono text-[11px] text-ink-muted">file sha256 {result.fileSha256}</p>
        {result.status !== "REVOKED" && result.fileIntact ? (
          <a href={`/api/v1/public/certificates/${encodeURIComponent(result.serial)}`} className="text-[13px] text-primary-hover hover:underline">
            Download the certificate (PDF)
          </a>
        ) : null}
      </section>
    </div>
  );
}
