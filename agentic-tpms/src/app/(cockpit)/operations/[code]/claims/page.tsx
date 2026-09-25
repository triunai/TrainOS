import { Banner, Body, Checkbox, DefinitionList, Field, MoneyInput, Section, Select, StatusChip, TextArea, TextInput, type StatusTone } from "@/components/kit";
import { ActionButton } from "@/components/actions/ActionButton";
import { FormDrawer } from "@/components/forms/FormDrawer";
import { DOCUMENT_LABEL } from "@/components/packages/VaultTable";
import { formatDate } from "@/lib/dates";
import { formatRM, fromSen } from "@/lib/money";
import { plain } from "@/server/actions";
import { claimChecklist } from "@/server/claims";
import { listVouchers } from "@/server/finance";
import { claimableSen } from "@/server/fsm/guards";
import { loadPackageRecord } from "@/server/packages/record";
import {
  adjustVoucherAction,
  approveClaimPackAction,
  collateAction,
  markPaidAction,
  recordApprovalAction,
  recordQueryAction,
  recordRemittanceAction,
  redraftInvoiceAction,
  resubmitAction,
  settleAction,
  uploadEvidenceAction,
  verifyEvidenceAction,
} from "./actions";

export const dynamic = "force-dynamic";

const DOC_TONE: Record<string, StatusTone> = { PENDING: "warning", VERIFIED: "success", FLAGGED: "danger" };
const PV_TONE: Record<string, StatusTone> = { DRAFT: "warning", APPROVED: "info", PAID: "success", CANCELLED: "neutral" };
const CLAIM_STAGES = new Set(["CLAIM_NOT_READY", "CLAIM_READY", "CLAIM_SUBMITTED", "QUERIED", "APPROVED", "REMITTED", "SETTLED_CLOSED"]);

export default async function ClaimsPage({ params }: { params: { code: string } }) {
  const { snapshot: s, pendingDecisions } = await loadPackageRecord(params.code);
  const p = s.pkg;
  const fin = p.financialStage;
  const inClaim = CLAIM_STAGES.has(fin);
  const [checklist, vouchers] = await Promise.all([inClaim ? claimChecklist(p.id) : Promise.resolve(null), listVouchers({ packageId: p.id }).then(plain)]);
  const claimPack = s.vault.find((d) => d.documentType === "CLAIM_PACK");
  const invoiceDoc = s.invoice?.vaultId ? s.vault.find((d) => d.id === s.invoice?.vaultId) : undefined;
  const evidence = s.vault.filter((d) => ["FORM_T3", "FORM_JD14", "PHOTO_EVIDENCE", "BEO", "DO"].includes(d.documentType));
  const livePvs = vouchers.filter((v) => v.status !== "CANCELLED");
  const allPaid = livePvs.length > 0 && livePvs.every((v) => v.status === "PAID");
  const gate3 = pendingDecisions.filter((d) => d.gate === "GATE3_CLAIM_REVIEW" || d.gate === "GATE3_AP_DISBURSEMENT");

  if (!inClaim) {
    return (
      <Body>
        <Section eyebrow="HITL Gate 3" title="Claims & accounts payable">
          <p className="text-[13px] text-ink-secondary">
            The claim opens when delivery is verified complete: the financial machine moves to <span className="font-medium">Claim not ready</span> and the collator starts assembling the SBL-Khas claim pack. Current financial stage: {fin.toLowerCase().replace(/_/g, " ")}.
          </p>
        </Section>
      </Body>
    );
  }

  return (
    <Body>
      {gate3.map((d) => (
        <Banner key={d.id} tone="warning" title={d.title}>
          {d.summary}
        </Banner>
      ))}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          {checklist ? (
            <Section
              eyebrow="L3 claims collator · L0 checklist"
              title={checklist.ready ? "Claim evidence complete" : `${checklist.missing.length} item${checklist.missing.length === 1 ? "" : "s"} blocking the claim`}
              actions={fin === "CLAIM_NOT_READY" || fin === "CLAIM_READY" ? <ActionButton action={collateAction} args={[p.packageCode]} label="Run collation" kind="ghost" /> : null}
              bodyClassName="py-1"
            >
              <ul>
                {checklist.items.map((item) => (
                  <li key={item.code} className="flex items-start gap-3 border-b border-divider py-2.5 last:border-b-0">
                    <span aria-hidden="true" className={item.ok ? "text-success" : item.required ? "text-danger" : "text-ink-muted"}>
                      {item.ok ? "✓" : item.required ? "✕" : "○"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-ink">
                        {item.label} {!item.required ? <span className="text-[12px] font-normal text-ink-muted">· optional</span> : null}
                      </p>
                      <p className="text-[12px] text-ink-secondary">{item.detail}</p>
                    </div>
                    <span className="font-mono text-[11px] text-ink-muted">{item.code}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          <Section
            eyebrow="Evidence"
            title="Verify what goes into the pack"
            actions={
              <FormDrawer trigger="Upload evidence" title="Upload evidence" subtitle="Form JD/14, BEO, DO — stored content-addressed, pending verification" action={uploadEvidenceAction} submitLabel="Upload">
                <input type="hidden" name="code" value={p.packageCode} />
                <Field label="Document">
                  <Select name="documentType" defaultValue="FORM_JD14">
                    <option value="FORM_JD14">Form JD/14 — employer verification (signed + stamped)</option>
                    <option value="BEO">Banquet event order</option>
                    <option value="DO">Delivery order (workbooks)</option>
                    <option value="OTHER">Other</option>
                  </Select>
                </Field>
                <Field label="File"><input name="file" type="file" accept="application/pdf,image/*" required className="text-[13px]" /></Field>
                <p className="text-[12px] text-ink-muted">Form T3 scans and session photos are uploaded on the Attendance tab, where OCR and EXIF checks run.</p>
              </FormDrawer>
            }
            flush
          >
            {evidence.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-ink-muted">No evidence yet.</p>
            ) : (
              <ul>
                {evidence.map((d) => {
                  const meta = d.extractedMetadata as Record<string, unknown>;
                  return (
                    <li key={d.id} className="flex flex-wrap items-center gap-3 border-b border-divider px-4 py-2.5 last:border-b-0">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] text-ink">
                          {DOCUMENT_LABEL[d.documentType] ?? d.documentType} ·{" "}
                          <a href={`/api/v1/vault/${d.id}`} target="_blank" rel="noreferrer" className="text-primary-hover hover:underline">{d.fileName}</a>
                        </p>
                        <p className="truncate text-[12px] text-ink-muted">
                          {d.verificationNotes ?? (Array.isArray(meta?.reasons) ? (meta.reasons as string[]).join(", ") : "")} {d.verifiedBy ? `· ${d.verifiedBy}` : ""}
                        </p>
                      </div>
                      <StatusChip tone={DOC_TONE[d.verificationStatus] ?? "neutral"}>{d.verificationStatus.toLowerCase()}</StatusChip>
                      <FormDrawer trigger="Review" triggerKind="ghost" title={`Review · ${DOCUMENT_LABEL[d.documentType] ?? d.documentType}`} subtitle={d.fileHashSha256} action={verifyEvidenceAction} submitLabel="Record verdict">
                        <input type="hidden" name="vaultId" value={d.id} />
                        <p className="text-[13px] text-ink-secondary">
                          Open the file, check it against the programme, then record your verdict. Your name goes into the audit ledger.{" "}
                          <a href={`/api/v1/vault/${d.id}`} target="_blank" rel="noreferrer" className="text-primary-hover hover:underline">Open file</a>
                        </p>
                        <Field label="Verdict">
                          <Select name="status" defaultValue="VERIFIED">
                            <option value="VERIFIED">Verified</option>
                            <option value="FLAGGED">Flagged — must be replaced</option>
                          </Select>
                        </Field>
                        {d.documentType === "FORM_JD14" ? (
                          <div className="flex flex-col gap-2">
                            <Checkbox name="managerialSignature" label="Signed by a manager or above" />
                            <Checkbox name="companyStamp" label="Company rubber stamp present" />
                          </div>
                        ) : null}
                        <Field label="Notes"><TextArea name="notes" /></Field>
                      </FormDrawer>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section eyebrow="Gate 3 · Step 1" title="Claim submission">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                {invoiceDoc ? (
                  <a href={`/api/v1/vault/${invoiceDoc.id}`} target="_blank" rel="noreferrer" className="text-primary-hover hover:underline">
                    Tax invoice {s.invoice?.invoiceNumber} · {formatRM(s.invoice?.total)}
                  </a>
                ) : (
                  <span className="text-ink-muted">No tax invoice yet</span>
                )}
                <span className="text-ink-muted">·</span>
                {claimPack ? (
                  <a href={`/api/v1/vault/${claimPack.id}`} className="text-primary-hover hover:underline">SBL-Khas claim pack (ZIP · {claimPack.fileHashSha256.slice(0, 12)}…)</a>
                ) : (
                  <span className="text-ink-muted">Claim pack not compiled</span>
                )}
                {fin === "CLAIM_NOT_READY" || fin === "CLAIM_READY" ? <ActionButton action={redraftInvoiceAction} args={[p.packageCode]} label="Re-draft invoice" kind="ghost" /> : null}
              </div>
              {fin === "CLAIM_READY" ? (
                <FormDrawer trigger="Approve claim pack" title="Approve claim pack for e-TRiS" subtitle="Gate 3 · CLAIM_READY → CLAIM_SUBMITTED" action={approveClaimPackAction} submitLabel="Approve & record submission">
                  <input type="hidden" name="code" value={p.packageCode} />
                  <p className="text-[13px] text-ink-secondary">Submit the pack on the HRD Corp e-TRiS portal, then record the claim reference it gives you. Approval is refused if the pack no longer matches the current invoice.</p>
                  <Field label="e-TRiS claim reference"><TextInput name="submissionRef" required placeholder="CLM-2026-…" /></Field>
                  <Field label="Note"><TextArea name="note" /></Field>
                </FormDrawer>
              ) : null}
              {fin === "CLAIM_SUBMITTED" ? (
                <div className="flex flex-wrap gap-2">
                  <FormDrawer trigger="Record HRD Corp approval" title="HRD Corp approved the claim" action={recordApprovalAction} submitLabel="Record approval">
                    <input type="hidden" name="code" value={p.packageCode} />
                    <Field label="Approved amount" hint={`Invoice total ${formatRM(s.invoice?.total)}`}><MoneyInput name="amount" required defaultValue={s.invoice?.total ?? ""} /></Field>
                  </FormDrawer>
                  <ActionButton action={recordQueryAction} args={[p.packageCode]} label="Record query" kind="ghost" reason={{ label: "What did HRD Corp query?", minLength: 5 }} />
                </div>
              ) : null}
              {fin === "QUERIED" ? <ActionButton action={resubmitAction} args={[p.packageCode]} label="Resubmit after query" reason={{ label: "How was the query answered?", minLength: 5 }} /> : null}
              {fin === "APPROVED" ? (
                <FormDrawer trigger="Record remittance" title="HRD Corp remittance received" subtitle="APPROVED → REMITTED · unlocks payment vouchers (pay-when-paid)" action={recordRemittanceAction} submitLabel="Record remittance">
                  <input type="hidden" name="code" value={p.packageCode} />
                  <Field label="Amount remitted" hint={p.upfrontAmount && Number(p.upfrontAmount) > 0 ? `Remittance + upfront ${formatRM(p.upfrontAmount)} should equal the approved ${formatRM(p.hrdcApprovedAmount)}` : undefined}><MoneyInput name="amount" required /></Field>
                  <Field label="Remittance reference"><TextInput name="reference" required /></Field>
                  <Field label="Remittance advice"><input name="advice" type="file" accept="application/pdf,image/*" required className="text-[13px]" /></Field>
                </FormDrawer>
              ) : null}
            </div>
          </Section>

          <Section eyebrow="Gate 3 · Step 2 · pay-when-paid" title="Accounts payable" flush>
            {vouchers.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-ink-muted">Payment vouchers are drafted when HRD Corp remits. The database refuses a PAID voucher before that.</p>
            ) : (
              <ul>
                {vouchers.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center gap-3 border-b border-divider px-4 py-3 last:border-b-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-ink">
                        {v.payeeName} <span className="font-normal text-ink-muted">· {v.payeeType.toLowerCase()}</span>
                      </p>
                      <p className="text-[12px] text-ink-secondary">
                        <span className="font-mono">{v.pvNumber}</span> · agreed {formatRM(v.agreedAmount)} · final {formatRM(v.finalAmount)}
                        {v.bankReference ? ` · ref ${v.bankReference}` : ""}
                        {v.paidAt ? ` · paid ${formatDate(v.paidAt)}` : ""}
                      </p>
                    </div>
                    <StatusChip tone={PV_TONE[v.status] ?? "neutral"}>{v.status.toLowerCase()}</StatusChip>
                    {v.status === "DRAFT" ? (
                      <FormDrawer trigger="Adjust & approve" triggerKind="ghost" title={`Approve ${v.pvNumber}`} subtitle={v.payeeName} action={adjustVoucherAction} submitLabel="Approve voucher">
                        <input type="hidden" name="pvId" value={v.id} />
                        <p className="text-[13px] text-ink-secondary">Agreed {formatRM(v.agreedAmount)}. Enter verified adjustments; leave blank to approve as agreed.</p>
                        <Field label="Mileage (add)"><MoneyInput name="mileage" /></Field>
                        <Field label="Travel allowance (add)"><MoneyInput name="allowance" /></Field>
                        <Field label="Withholding tax (deduct)"><MoneyInput name="wht" /></Field>
                      </FormDrawer>
                    ) : null}
                    {v.status === "APPROVED" ? (
                      <FormDrawer trigger="Record payment" triggerKind="ghost" title={`Pay ${v.pvNumber}`} subtitle={`${v.payeeName} · ${formatRM(v.finalAmount)}`} action={markPaidAction} submitLabel="Record payment">
                        <input type="hidden" name="pvId" value={v.id} />
                        <p className="text-[13px] text-ink-secondary">Make the transfer in your bank, then record its reference and attach the receipt. Both are mandatory.</p>
                        <Field label="Bank transfer reference"><TextInput name="bankReference" required /></Field>
                        <Field label="Transfer receipt"><input name="receipt" type="file" accept="application/pdf,image/*" required className="text-[13px]" /></Field>
                      </FormDrawer>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {fin === "REMITTED" ? (
              <div className="flex items-center justify-between gap-3 border-t border-divider px-4 py-3">
                <p className="text-[12px] text-ink-secondary">{allPaid ? "Every voucher is paid with a bank reference and a receipt." : "Settle once every voucher is paid."}</p>
                <ActionButton action={settleAction} args={[p.packageCode]} label="Confirm disbursement & settle" kind="primary" disabled={!allPaid && livePvs.length > 0} confirm={{ title: "Settle and close this package?", body: "REMITTED → SETTLED_CLOSED under AP_DISBURSEMENT_CONFIRMED, attributed to you. The unit-economics ledger is reconciled with actual payments." }} />
              </div>
            ) : null}
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Section eyebrow="Claim value" title="Figures">
            <DefinitionList
              items={[
                ["Grant approved", formatRM(p.grantApprovedAmount)],
                ["Claimable now", formatRM(fromSen(claimableSen(s)))],
                ["Eligible (≥ 80%)", `${s.participants.eligible} of ${s.participants.active}`],
                ["Upfront 30% received", p.upfront30pctClaimed ? formatRM(p.upfrontAmount) : "—"],
                ["Invoice", s.invoice ? `${s.invoice.invoiceNumber} · ${formatRM(s.invoice.total)}` : "—"],
                ["e-TRiS claim ref", p.claimSubmissionRef ?? "—"],
                ["HRD Corp approved", formatRM(p.hrdcApprovedAmount)],
                ["Remitted", p.remittanceReference ? `${formatRM(p.remittanceAmount)} · ${p.remittanceReference}` : "—"],
              ]}
            />
          </Section>
          <Section eyebrow="Rules the database enforces" title="Why these buttons refuse">
            <ul className="flex flex-col gap-1.5 text-[12px] text-ink-secondary">
              <li>Invoice total must equal the claimable grant (per-pax programmes pro-rate to eligible participants).</li>
              <li>A voucher cannot be PAID before HRD Corp remits (pay-when-paid trigger).</li>
              <li>PAID requires a bank reference and a receipt in the vault (check constraint).</li>
              <li>Settlement is a named USER act with reason AP_DISBURSEMENT_CONFIRMED.</li>
            </ul>
          </Section>
        </div>
      </div>
    </Body>
  );
}
