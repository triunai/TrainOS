import Link from "next/link";
import { Body, DefinitionList, LINK_BUTTON, Section, StatusChip, TrafficLights } from "@/components/kit";
import { ActionButton } from "@/components/actions/ActionButton";
import { AuditTimeline } from "@/components/packages/AuditTimeline";
import { VaultTable } from "@/components/packages/VaultTable";
import { finLabel, opsLabel } from "@/components/packages/stageTone";
import { formatDate, formatRange } from "@/lib/dates";
import { formatRM } from "@/lib/money";
import { listPackageAudit } from "@/server/audit/ledger";
import { GATE_LABEL } from "@/server/decisions/service";
import { loadPackageRecord, type NextMove } from "@/server/packages/record";
import { readinessLights } from "@/server/packages/readiness";
import { cancelPackageAction, completeDeliveryAction, lockOperationsAction, startDeliveryAction } from "./actions";

export const dynamic = "force-dynamic";

/** Where each move is performed: in place here, or on its section page. */
const MOVE_HOME: Record<string, string> = {
  COMMERCIAL_TERMS_APPROVED: "commercials",
  QUOTATION_REVISION_REQUESTED: "commercials",
  CLIENT_ACCEPTED_QUOTATION: "commercials",
  GRANT_CONFIRMED_LOCKED: "grant",
  UPFRONT_CLAIM_FILED: "grant",
  T14_VIABILITY_PASSED: "logistics",
  VIABILITY_PIVOT_ROT: "logistics",
  VIABILITY_OVERRIDE_PROCEED: "logistics",
  VIABILITY_POSTPONED: "logistics",
  VIABILITY_CANCELLED: "logistics",
  RESCHEDULE_CONFIRMED: "logistics",
  CLAIM_EVIDENCE_VERIFIED: "claims",
  CLAIM_EVIDENCE_REOPENED: "claims",
  CLAIM_PACK_APPROVED: "claims",
  CLAIM_QUERIED_BY_HRDC: "claims",
  QUERY_RESPONSE_RESUBMITTED: "claims",
  CLAIM_APPROVED_BY_HRDC: "claims",
  REMITTANCE_RECEIVED: "claims",
  AP_DISBURSEMENT_CONFIRMED: "claims",
  TRAINING_COMPLETED: "attendance",
};

function MoveRow({ move, code }: { move: NextMove; code: string }) {
  const ready = move.verdict.blocking.length === 0;
  const reason = move.rule.reason;
  const inPlace =
    reason === "OPERATIONS_READINESS_LOCKED" ? (
      <ActionButton action={lockOperationsAction} args={[code]} label="Lock operations" disabled={!ready} />
    ) : reason === "DELIVERY_STARTED" ? (
      <ActionButton action={startDeliveryAction} args={[code]} label="Start delivery" />
    ) : reason === "DELIVERY_VERIFIED_SUCCESS" ? (
      <ActionButton action={completeDeliveryAction} args={[code]} label="Complete delivery" disabled={!ready} />
    ) : reason === "PACKAGE_CANCELLED" ? (
      <ActionButton
        action={cancelPackageAction}
        args={[code]}
        label="Cancel package"
        kind="danger"
        confirm={{ title: "Cancel this package?", body: "Trainer holds are released and vendor commitments cancelled. The financial machine is voided. This cannot be undone.", confirmLabel: "Cancel package", danger: true }}
        reason={{ label: "Why is it cancelled?", placeholder: "Client chose another provider", minLength: 5 }}
      />
    ) : MOVE_HOME[reason] ? (
      <Link href={`/operations/${code}/${MOVE_HOME[reason]}`} className={LINK_BUTTON.ghost}>
        Open {MOVE_HOME[reason]} ›
      </Link>
    ) : null;

  return (
    <li className="flex items-start gap-3 border-b border-divider py-3 last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium text-ink">
            {move.rule.machine === "OPERATIONAL" ? opsLabel(move.rule.to) : finLabel(move.rule.to)}
          </span>
          <span className="font-mono text-[11px] text-ink-muted">{reason}</span>
          <StatusChip tone={ready ? "success" : "neutral"} shape="square" className="px-2 py-[1px] text-[11px]">
            {ready ? "L0 ready" : `${move.verdict.blocking.length} blocking`}
          </StatusChip>
          <span className="text-[11px] text-ink-muted">by {move.rule.actors.join(" / ").toLowerCase()}</span>
        </div>
        <p className="text-[12px] text-ink-secondary">{move.rule.description}</p>
        {move.verdict.blocking.length > 0 ? (
          <ul className="flex flex-col gap-0.5">
            {move.verdict.blocking.map((b) => (
              <li key={b.code} className="flex gap-1.5 text-[12px] text-ink-secondary">
                <span aria-hidden="true" className="text-danger">
                  ✕
                </span>
                {b.message} <span className="font-mono text-[11px] text-ink-muted">{b.code}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {move.verdict.warnings.map((w) => (
          <p key={w.code} className="flex gap-1.5 text-[12px] text-ink-secondary">
            <span aria-hidden="true" className="text-warning">
              !
            </span>
            {w.message}
          </p>
        ))}
      </div>
      <div className="shrink-0">{inPlace}</div>
    </li>
  );
}

export default async function PackageOverviewPage({ params }: { params: { code: string } }) {
  const record = await loadPackageRecord(params.code);
  const { snapshot: s, pendingDecisions } = record;
  const p = s.pkg;
  const lights = readinessLights(
    {
      operationalStage: p.operationalStage,
      deliveryMode: p.deliveryMode,
      venueByClient: p.venueByClient,
      startDate: p.startDate,
      etrisGrantId: p.etrisGrantId,
      grantApprovedAmount: p.grantApprovedAmount,
      trainerStatus: s.engagement?.status ?? null,
      trainerTttVerified: s.engagement ? s.engagement.tttCertVerified && s.engagement.trainer.tttVerified : null,
      trainerHoldExpiry: s.engagement?.holdExpiryDate ?? null,
      trainerName: s.engagement?.trainer.fullName ?? null,
      venueStatus: s.commitments.find((c) => c.vendorType === "VENUE" && c.status !== "CANCELLED")?.status ?? null,
      venuePostponementDeadline: s.commitments.find((c) => c.vendorType === "VENUE")?.postponementDeadline ?? null,
      venueName: s.commitments.find((c) => c.vendorType === "VENUE") ? "Venue" : null,
    },
    s.today,
  );
  const audit = await listPackageAudit(p.id, 10);
  const moves = [...record.nextOps, ...record.nextFin];

  return (
    <Body>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          {pendingDecisions.length > 0 ? (
            <Section eyebrow="Human in the loop" title={`${pendingDecisions.length} decision${pendingDecisions.length === 1 ? "" : "s"} waiting on you`} flush>
              <ul>
                {pendingDecisions.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 border-b border-divider px-4 py-3 last:border-b-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-ink">{d.title}</p>
                      <p className="truncate text-[12px] text-ink-secondary">{d.summary}</p>
                    </div>
                    <StatusChip tone="warning">{GATE_LABEL[d.gate as keyof typeof GATE_LABEL] ?? d.gate}</StatusChip>
                    <Link href={`/decisions/${d.id}`} className={LINK_BUTTON.secondary}>
                      Review
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          <Section eyebrow="Level 0 rule engine" title="Next moves from here" bodyClassName="py-1">
            {moves.length === 0 ? (
              <p className="py-3 text-[13px] text-ink-muted">Both state machines are at a terminal stage.</p>
            ) : (
              <ul>
                {moves.map((m) => (
                  <MoveRow key={`${m.rule.machine}-${m.rule.to}-${m.rule.reason}`} move={m} code={p.packageCode} />
                ))}
              </ul>
            )}
          </Section>

          <Section eyebrow="Compliance evidence" title="Vault" flush actions={<span className="text-[12px] text-ink-muted">SHA-256 re-verified on every download</span>}>
            <VaultTable docs={s.vault} />
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Section eyebrow="Trainer × Venue × Participants" title="Readiness">
            <div className="flex flex-col gap-3">
              <TrafficLights lights={lights} />
              <ul className="flex flex-col gap-1 text-[12px] text-ink-secondary">
                {lights.map((l) => (
                  <li key={l.key}>
                    <span className="text-ink">{l.label}:</span> {l.detail}
                  </li>
                ))}
              </ul>
              <DefinitionList
                items={[
                  ["Registered", `${s.participants.active} (min ${p.minParticipants})`],
                  ["Eligible ≥ 80%", String(s.participants.eligible)],
                  ["Attendance slots missing", String(s.attendance.missingSlots)],
                  ["Open exceptions", String(s.attendance.openReviews)],
                ]}
              />
            </div>
          </Section>

          <Section eyebrow="Record" title="Details">
            <DefinitionList
              items={[
                ["Client", <Link key="c" href={`/clients/${s.client.id}`} className="text-primary-hover hover:underline">{s.client.companyName}</Link>],
                ["PIC", `${s.client.primaryPicName} · ${s.client.primaryPicEmail}`],
                ["Dates", formatRange(p.startDate, p.endDate)],
                ["Duration", p.durationDays ? `${p.durationDays} day(s)` : "—"],
                ["Trainer", s.engagement ? `${s.engagement.trainer.fullName} · ${formatRM(s.engagement.dayRate)}/day · ${s.engagement.status.toLowerCase().replace("_", " ")}` : "—"],
                ["Upfront 30%", p.upfront30pctClaimed ? formatRM(p.upfrontAmount) : "not claimed"],
                ["Claim ref", p.claimSubmissionRef ?? "—"],
                ["Remittance", p.remittanceReference ? `${formatRM(p.remittanceAmount)} · ${p.remittanceReference}` : "—"],
                ["Created", formatDate(p.createdAt ?? null, true)],
              ]}
            />
          </Section>

          <Section eyebrow="Append-only ledger" title="Recent activity" actions={<Link href={`/operations/${p.packageCode}/audit`} className="text-[12px] text-primary-hover hover:underline">Full trail ›</Link>}>
            <AuditTimeline rows={audit} compact />
          </Section>
        </div>
      </div>
    </Body>
  );
}
