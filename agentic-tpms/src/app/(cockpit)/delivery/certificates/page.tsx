import Link from "next/link";
import { Body, DataTable, PageHeader, StatusChip } from "@/components/kit";
import { ActionButton } from "@/components/actions/ActionButton";
import { Frame } from "@/components/shell/Frame";
import { formatDate } from "@/lib/dates";
import { plain } from "@/server/actions";
import { listCertificates } from "@/server/certificates";
import { revokeCertificateAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Certificates" };

export default async function CertificatesPage() {
  const certs = plain(await listCertificates());
  return (
    <Frame crumbs={[{ label: "Delivery" }, { label: "Certificates" }]}>
      <PageHeader
        title="Certificates"
        summary={`${certs.length} issued · only to participants at ≥ 80% attendance · each carries a masked NRIC, a public QR and two SHA-256 hashes`}
      />
      <Body>
        <DataTable
          label="Certificates"
          rows={certs}
          rowKey={(c) => c.id}
          columns={[
            { key: "serial", label: "Serial", cell: (c) => <Link href={`/verify/${c.serial}`} target="_blank" className="font-mono text-[12px] text-primary-hover hover:underline">{c.serial}</Link> },
            { key: "holder", label: "Holder", cell: (c) => (<div className="flex flex-col"><span className="font-medium">{c.holderName}</span><span className="text-[12px] text-ink-muted">{c.nricMasked}</span></div>) },
            { key: "pkg", label: "Package", cell: (c) => <Link href={`/operations/${c.packageCode}`} className="font-mono text-[12px] text-primary-hover hover:underline">{c.packageCode}</Link> },
            { key: "issued", label: "Issued", cell: (c) => formatDate(c.issuedAt, true) },
            { key: "hash", label: "File SHA-256", cell: (c) => <span className="font-mono text-[11px] text-ink-muted" title={c.fileSha256}>{c.fileSha256.slice(0, 16)}…</span> },
            { key: "status", label: "Status", cell: (c) => <StatusChip tone={c.revoked ? "danger" : "success"}>{c.revoked ? "revoked" : "valid"}</StatusChip> },
            {
              key: "act",
              label: "",
              cell: (c) =>
                c.revoked ? (
                  <span className="text-[12px] text-ink-muted">{c.revokedBy} · {formatDate(c.revokedAt)}</span>
                ) : (
                  <ActionButton
                    action={revokeCertificateAction}
                    args={[c.serial]}
                    label="Revoke"
                    kind="ghost"
                    confirm={{ title: `Revoke ${c.serial}?`, body: "Revocation is final and public: the verification page will show it as revoked.", confirmLabel: "Revoke certificate", danger: true }}
                    reason={{ label: "Reason for revocation", minLength: 3 }}
                  />
                ),
            },
          ]}
        />
      </Body>
    </Frame>
  );
}
