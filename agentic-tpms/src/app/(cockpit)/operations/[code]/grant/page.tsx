import { AIChip, Banner, Body, DefinitionList, Field, MoneyInput, Section, StatusChip, TextInput } from "@/components/kit";
import { ActionButton } from "@/components/actions/ActionButton";
import { FormDrawer } from "@/components/forms/FormDrawer";
import { formatDate } from "@/lib/dates";
import { formatRM, fromSen, toSen } from "@/lib/money";
import { loadPackageRecord } from "@/server/packages/record";
import { compileDossierAction, confirmGrantAction, flagLetterAction, uploadLetterAction, upfrontClaimAction } from "./actions";

export const dynamic = "force-dynamic";

interface Extracted {
  grantId?: string | null;
  approvedPax?: number | null;
  approvedAmount?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  employerName?: string | null;
  confidence?: number;
  engine?: string;
}

export default async function GrantPage({ params }: { params: { code: string } }) {
  const { snapshot: s, pendingDecisions } = await loadPackageRecord(params.code);
  const p = s.pkg;
  const dossier = s.vault.find((d) => d.documentType === "ETRIS_DOSSIER");
  const letters = s.vault.filter((d) => d.documentType === "ETRIS_APPROVAL");
  const letter = letters[0];
  const verification = pendingDecisions.find((d) => d.gate === "GRANT_VERIFICATION");
  const extracted = ((verification?.payload as Record<string, unknown> | undefined)?.extraction ?? (letter?.extractedMetadata as Record<string, unknown>)?.extraction ?? letter?.extractedMetadata ?? {}) as Extracted;
  const canConfirm = p.operationalStage === "GRANT_PENDING" && Boolean(letter) && letter?.verificationStatus !== "FLAGGED";
  const upfrontSen = Math.round(toSen(p.grantApprovedAmount) * 0.3);

  return (
    <Body>
      {verification ? (
        <Banner tone="warning" title="Verify the extracted e-TRiS approval">
          {verification.summary}
        </Banner>
      ) : null}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Section
            eyebrow="Stage 3 · for the client's HR to file"
            title="e-TRiS grant support dossier"
            actions={["GRANT_PENDING", "GRANT_APPROVED", "QUOTED"].includes(p.operationalStage) ? <ActionButton action={compileDossierAction} args={[p.packageCode]} label={dossier ? "Recompile" : "Compile dossier"} kind="ghost" /> : null}
          >
            {dossier ? (
              <p className="text-[13px] text-ink-secondary">
                <a href={`/api/v1/vault/${dossier.id}`} className="text-primary-hover hover:underline">{dossier.fileName}</a> — Form HRD-L&D outline, signed quotation, trainer CV, verified TTT certificate, a cover checklist and a manifest of SHA-256 hashes. Compiled {formatDate(dossier.createdAt ?? null, true)}.
              </p>
            ) : (
              <p className="text-[13px] text-ink-muted">Compiled automatically when the client accepts the quotation.</p>
            )}
          </Section>

          <Section
            eyebrow="L2 extraction → human verification"
            title="Approval letter"
            actions={
              p.operationalStage === "GRANT_PENDING" ? (
                <FormDrawer trigger={letter ? "Upload another letter" : "Upload approval letter"} title="Upload e-TRiS approval letter" subtitle="The extraction service reads the grant ID, pax, amount and dates" action={uploadLetterAction} submitLabel="Upload & extract">
                  <input type="hidden" name="code" value={p.packageCode} />
                  <Field label="Letter (PDF or photo)"><input name="letter" type="file" accept="application/pdf,image/png,image/jpeg" required className="text-[13px]" /></Field>
                </FormDrawer>
              ) : null
            }
          >
            {letter ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <a href={`/api/v1/vault/${letter.id}`} target="_blank" rel="noreferrer" className="text-primary-hover hover:underline">{letter.fileName}</a>
                  <StatusChip tone={letter.verificationStatus === "VERIFIED" ? "success" : letter.verificationStatus === "FLAGGED" ? "danger" : "warning"}>{letter.verificationStatus.toLowerCase()}</StatusChip>
                  {extracted.engine ? <AIChip provenance={{ tier: "L2", agent: "grant.letter_extractor", mode: "EXTRACTION", model: extracted.engine, confidence: extracted.confidence }} /> : null}
                </div>
                <DefinitionList
                  items={[
                    ["Grant reference", extracted.grantId ?? "not read"],
                    ["Approved pax", extracted.approvedPax != null ? String(extracted.approvedPax) : "not read"],
                    ["Approved amount", extracted.approvedAmount ? formatRM(extracted.approvedAmount) : "not read"],
                    ["Dates", extracted.startDate ? `${formatDate(extracted.startDate)} – ${formatDate(extracted.endDate ?? null)}` : "not read"],
                    ["Employer", extracted.employerName ?? "not read"],
                  ]}
                />
                {canConfirm ? (
                  <div className="flex flex-wrap gap-2">
                    <FormDrawer trigger="Verify & lock grant" title="Verify the grant against the letter" subtitle="GRANT_PENDING → GRANT_APPROVED · reason GRANT_CONFIRMED_LOCKED" action={confirmGrantAction} submitLabel="Confirm grant">
                      <input type="hidden" name="code" value={p.packageCode} />
                      <p className="text-[13px] text-ink-secondary">Check each value against the letter. Where you correct the extraction, both values are kept in the audit trail.</p>
                      <Field label="e-TRiS grant reference"><TextInput name="grantId" required defaultValue={extracted.grantId ?? ""} /></Field>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Approved amount" hint={`Quoted ${formatRM(p.quotedAmount)}`}><MoneyInput name="approvedAmount" required defaultValue={extracted.approvedAmount ?? p.quotedAmount} /></Field>
                        <Field label="Approved pax"><TextInput name="approvedPax" type="number" min={1} required defaultValue={extracted.approvedPax ?? p.paxEstimate} /></Field>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Start date"><TextInput name="startDate" type="date" defaultValue={extracted.startDate ?? p.startDate ?? ""} /></Field>
                        <Field label="End date"><TextInput name="endDate" type="date" defaultValue={extracted.endDate ?? p.endDate ?? ""} /></Field>
                      </div>
                    </FormDrawer>
                    <ActionButton action={flagLetterAction} args={[p.packageCode, letter.id]} label="Flag letter" kind="ghost" reason={{ label: "What is wrong with the letter?", minLength: 5 }} />
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-[13px] text-ink-muted">{p.operationalStage === "GRANT_PENDING" ? "Waiting for the client's HR to share the e-TRiS approval letter." : "No approval letter on file."}</p>
            )}
          </Section>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Section eyebrow="Financial FSM" title="Grant value">
            <DefinitionList
              items={[
                ["Grant reference", p.etrisGrantId ?? "—"],
                ["Approved amount", formatRM(p.grantApprovedAmount)],
                ["Approved pax", p.grantApprovedPax ? String(p.grantApprovedPax) : "—"],
                ["Approved on", formatDate(p.grantApprovedAt ?? null)],
                ["Upfront 30%", p.upfront30pctClaimed ? `${formatRM(p.upfrontAmount)} filed` : "not filed"],
              ]}
            />
          </Section>
          {p.financialStage === "GRANT_RESERVED" && p.etrisGrantId ? (
            <Section eyebrow="Working capital" title="Optional 30% upfront claim">
              <div className="flex flex-col gap-2 text-[13px] text-ink-secondary">
                <p>Claim {formatRM(fromSen(upfrontSen))} now against the approved grant; the balance is claimed after delivery. Remittance plus the advance must equal HRD Corp&apos;s approved amount.</p>
                <ActionButton action={upfrontClaimAction} args={[p.packageCode]} label="File upfront claim" confirm={{ title: "File the 30% upfront claim?", body: `GRANT_RESERVED → UPFRONT_CLAIM_SUBMITTED for ${formatRM(fromSen(upfrontSen))}. File it on e-TRiS as well.` }} />
              </div>
            </Section>
          ) : null}
        </div>
      </div>
    </Body>
  );
}
