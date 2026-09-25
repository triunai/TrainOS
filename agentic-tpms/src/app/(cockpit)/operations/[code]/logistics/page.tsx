import { Banner, Body, DefinitionList, Section, StatusChip, type StatusTone } from "@/components/kit";
import { ActionButton } from "@/components/actions/ActionButton";
import { ViabilityDesk } from "@/components/operations/ViabilityDesk";
import { addDays, formatDate } from "@/lib/dates";
import { formatRM, fromSen } from "@/lib/money";
import { db, schema } from "@/server/db/client";
import { eq } from "drizzle-orm";
import { assessViability } from "@/server/operations/viability";
import { loadPackageRecord } from "@/server/packages/record";
import { confirmRescheduleAction, lockOperationsAction, resolveViabilityAction, runT14NowAction } from "../actions";
import { LogisticsActions } from "./LogisticsActions";

export const dynamic = "force-dynamic";

const COMMITMENT_TONE: Record<string, StatusTone> = { PROVISIONAL: "warning", BEO_SIGNED: "success", DO_RECEIVED: "success", CANCELLED: "neutral" };
const HOLD_TONE: Record<string, StatusTone> = { TENTATIVE_HOLD: "warning", CONFIRMED: "success", RELEASED: "neutral" };

export default async function LogisticsPage({ params }: { params: { code: string } }) {
  const { snapshot: s, pendingDecisions } = await loadPackageRecord(params.code);
  const p = s.pkg;
  const assessment = await assessViability(p.id);
  const gate2 = pendingDecisions.find((d) => d.gate === "GATE2_VIABILITY");
  const engagements = await db().select({ e: schema.trainerEngagements, t: schema.trainers }).from(schema.trainerEngagements).innerJoin(schema.trainers, eq(schema.trainers.id, schema.trainerEngagements.trainerId)).where(eq(schema.trainerEngagements.packageId, p.id));
  const vendorRows = await db().select({ c: schema.vendorCommitments, v: schema.vendors }).from(schema.vendorCommitments).leftJoin(schema.vendors, eq(schema.vendors.id, schema.vendorCommitments.vendorId)).where(eq(schema.vendorCommitments.packageId, p.id));
  const inGateWindow = ["GRANT_APPROVED", "OPERATIONS_LOCKED"].includes(p.operationalStage);
  const rm = (sen: number) => formatRM(fromSen(sen));

  return (
    <Body>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Section
            eyebrow="HITL Gate 2"
            title="T-14 viability & contingency"
            actions={inGateWindow && !gate2 ? <ActionButton action={runT14NowAction} args={[p.packageCode]} label="Run check now" kind="ghost" /> : null}
          >
            <div className="flex flex-col gap-3">
              <DefinitionList
                items={[
                  ["Registered cohort", `${assessment.activeParticipants} (minimum viable ${assessment.minParticipants})`],
                  ["Days to start", assessment.daysToStart === null ? "—" : `${assessment.daysToStart}${assessment.windowOpen ? " · T-14 window open" : ""}`],
                  ["Venue & catering committed", rm(assessment.venueExposure.committedSen)],
                  ["Exposure if postponed / cancelled", `${rm(assessment.venueExposure.postponeSen)} / ${rm(assessment.venueExposure.cancelSen)}`],
                  ["ROT cap at this cohort", assessment.rot.capSen === null ? "no ROT policy" : `${rm(assessment.rot.capSen)}${assessment.rot.amendmentNeeded ? " — below approved grant" : ""}`],
                ]}
              />
              {gate2 ? (
                <ViabilityDesk
                  code={p.packageCode}
                  options={assessment.options as never}
                  defaultStart={p.startDate ? addDays(p.startDate, 28) : ""}
                  defaultEnd={p.endDate ? addDays(p.endDate, 28) : ""}
                  halted={p.vendorAutoconfirmHalted}
                  resolve={resolveViabilityAction}
                />
              ) : p.operationalStage === "POSTPONED" ? (
                <Banner
                  tone="warning"
                  title={`Postponed from ${formatDate(p.postponedFromStart)} to ${formatDate(p.startDate)}`}
                  actions={<ActionButton action={confirmRescheduleAction} args={[p.packageCode]} label="Confirm new dates" kind="primary" />}
                >
                  Confirming returns the package to Grant approved; vendors re-lock and the T-14 check is re-armed for the new start date. Remind client HR to amend the e-TRiS dates.
                </Banner>
              ) : (
                <p className="text-[13px] text-ink-secondary">
                  {assessment.viable
                    ? "The cohort is at or above the minimum. At T-14 the package advances to Ready for event automatically."
                    : inGateWindow
                      ? "Below the minimum today. The leased T-14 task will halt vendor confirmations and raise this gate if it is still short."
                      : "The viability gate applies between grant approval and the event."}
                </p>
              )}
            </div>
          </Section>

          <Section eyebrow="Operational variable" title="Trainer" flush>
            {engagements.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-ink-muted">No trainer held. Gate 1 approval places a tentative hold on the proposed trainer.</p>
            ) : (
              <ul>
                {engagements.map(({ e, t }) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-3 border-b border-divider px-4 py-3 last:border-b-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-ink">{t.fullName}</p>
                      <p className="text-[12px] text-ink-secondary">
                        {formatRM(e.dayRate)}/day · TTT {t.tttCertNumber} {t.tttVerified ? "verified" : "unverified"} · hold to {formatDate(e.holdExpiryDate)} · {e.payWhenPaid ? "pay-when-paid" : "standard terms"}
                      </p>
                    </div>
                    <StatusChip tone={HOLD_TONE[e.status] ?? "neutral"}>{e.status.toLowerCase().replace("_", " ")}</StatusChip>
                    <LogisticsActions kind="trainer" id={e.id} status={e.status} />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section eyebrow="Operational variable" title="Venue, catering & printing" flush>
            {vendorRows.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-ink-muted">{p.deliveryMode === "ROT_VIRTUAL" ? "Remote online training — no venue." : p.venueByClient ? "Delivered at the client's premises." : "No vendor commitments yet."}</p>
            ) : (
              <ul>
                {vendorRows.map(({ c, v }) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-3 border-b border-divider px-4 py-3 last:border-b-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-ink">
                        {v?.name ?? c.vendorType} <span className="text-[12px] font-normal text-ink-muted">· {c.vendorType.toLowerCase()}</span>
                      </p>
                      <p className="text-[12px] text-ink-secondary">
                        {formatRM(c.cost)} · free postponement to {formatDate(c.postponementDeadline)} · cancel by {formatDate(c.cancellationDeadline)}
                        {c.referenceNumber ? ` · ref ${c.referenceNumber}` : ""}
                        {Number(c.cancellationPenalty) > 0 ? ` · penalty exposure ${formatRM(c.cancellationPenalty)}` : ""}
                      </p>
                    </div>
                    <StatusChip tone={COMMITMENT_TONE[c.status] ?? "neutral"}>{c.status.toLowerCase().replace("_", " ")}</StatusChip>
                    <LogisticsActions kind="vendor" id={c.id} status={c.status} vendorType={c.vendorType} />
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Section eyebrow="Operations lock" title="Readiness to lock">
            <div className="flex flex-col gap-3 text-[13px] text-ink-secondary">
              <p>Locking requires a confirmed trainer with a verified HRD Corp TTT certificate and a signed venue BEO (or a client-provided venue / ROT).</p>
              {p.operationalStage === "GRANT_APPROVED" ? <ActionButton action={lockOperationsAction} args={[p.packageCode]} label="Lock operations" /> : <p className="text-ink-muted">Current stage: {p.operationalStage.toLowerCase().replace(/_/g, " ")}</p>}
            </div>
          </Section>
          <Section eyebrow="Contingency playbooks" title="Mismatch SOPs">
            <ul className="flex flex-col gap-2 text-[12px] text-ink-secondary">
              <li><span className="font-medium text-ink">Venue locked, no trainer/pax:</span> postpone inside T-14→T-7 to roll the deposit into a credit; SOS the trainer registry if pax exist but the trainer drops.</li>
              <li><span className="font-medium text-ink">Trainer locked, no venue/pax:</span> the agreement is non-binding until PO or e-TRiS approval; at T-14 postpone, pivot to ROT or release penalty-free.</li>
              <li><span className="font-medium text-ink">Pax & topic locked, no trainer/venue:</span> host at the client, pull the standard outline from the catalogue, recruit an accredited SME at standard rate.</li>
            </ul>
          </Section>
        </div>
      </div>
    </Body>
  );
}
