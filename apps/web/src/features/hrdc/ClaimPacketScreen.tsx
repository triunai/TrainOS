import { useState } from "react";
import { Link } from "react-router-dom";
import type { ActionResponse, ClaimPacket, RequiredDocument } from "@trainos/contract";
import {
  ActionOutcome,
  CitationChip,
  CompletenessBar,
  ContentCard,
  DateField,
  DateText,
  describeActionError,
  DocumentChecklistRow,
  ErrorState,
  ExceptionBanner,
  humanise,
  LoadingState,
  MoneyText,
  PACKET_TONE,
  PrimaryButton,
  RecordHeader,
  RuleCheckRow,
  SecondaryButton,
  StatusChip,
  TextField,
  RefusalBanner,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { toApiError } from "@/shared/api";
import { HRDC_PACKET_PATH } from "./paths";
import {
  useAttachDocument,
  useClaimPacket,
  useComplianceChecks,
  useExportPacket,
  useMarkPacketSubmitted,
} from "./api";

/**
 * M12-S02 · HRD Corp grant and claim packet.
 *
 * The screen's whole argument is in what it does NOT have: there is no
 * "Submit to HRD Corp" button, because there is no HRD Corp API. TrainOS
 * assembles the packet and watches the deadline; a human files it on eTRIS and
 * records the reference here. Drawing a submit button would be a lie the rest
 * of the product then has to keep.
 *
 * DECISIONS §3 is applied over the artboard: the claim window is six months
 * from completion, not five working days, so the deadline banner cites the
 * six-month rule and its severity comes from the packet rather than from the
 * artboard's "3 days".
 */

export function ClaimPacketScreen({ engagementRef }: { engagementRef: string }) {
  /* Ends at the LIST — the header already carries the engagement reference. */
  useBreadcrumb([{ label: "Compliance" }, { label: "HRD Corp", href: HRDC_PACKET_PATH }]);

  const packet = useClaimPacket(engagementRef);
  const checks = useComplianceChecks(engagementRef);
  const attach = useAttachDocument(engagementRef);
  const exportPacket = useExportPacket(engagementRef);
  const markSubmitted = useMarkPacketSubmitted(engagementRef);
  const [outcome, setOutcome] = useState<ActionResponse | undefined>(undefined);
  const [reference, setReference] = useState("");
  const [submittedOn, setSubmittedOn] = useState("");

  if (packet.isPending) {
    return <LoadingState rows={8} label={`Loading the claim packet for ${engagementRef}`} />;
  }

  if (packet.error || !packet.data) {
    return (
      <ErrorState
        title="This claim packet could not be loaded"
        error={toApiError(packet.error)}
        onRetry={() => void packet.refetch()}
      />
    );
  }

  const data = packet.data;
  const present = data.requiredDocuments.filter((document) => document.status === "PRESENT").length;
  const complete = data.completeness >= 1;

  const onSubmit = async () => {
    try {
      const response = await markSubmitted.mutateAsync({
        reference,
        submittedAt: new Date(`${submittedOn}T00:00:00+08:00`).toISOString(),
      });
      setOutcome(response);
    } catch {
      /* The mutation's own error state renders it; see ActionOutcome below. */
    }
  };

  return (
    <div className="flex flex-col">
      <RecordHeader
        accent
        collapsible
        recordType="claim"
        title={`Claim packet · ${data.engagementRef}`}
        recordRef={data.employerCode}
        meta={[
          `scheme ${data.scheme.replace("_", "-")}`,
          data.organisationRef,
          data.grant ? `grant ${data.grant.reference}` : null,
          data.submission ? `claim ${data.submission.reference}` : "claim ref pending",
        ]}
        chips={
          <>
            <StatusChip tone={PACKET_TONE[data.status]} live>
              {humanise(data.status)}
            </StatusChip>
            <StatusChip tone={data.deadlineSeverity === "INFO" ? "neutral" : "warning"}>
              {`Claim window · ${data.daysRemaining} days left`}
            </StatusChip>
          </>
        }
        actions={
          <SecondaryButton onClick={() => exportPacket.mutate()} disabled={exportPacket.isPending}>
            Export packet (.zip)
          </SecondaryButton>
        }
        metrics={[
          { label: "Levy available", value: <MoneyText value={data.levyAvailable} compact /> },
          { label: "Claim value", value: <MoneyText value={data.claimValue} compact /> },
          {
            label: "Completeness",
            value: `${Math.round(data.completeness * 100)}%`,
            bar: data.completeness,
            barState: complete ? "neutral" : "warning",
          },
          {
            label: "Documents",
            value: `${present} / ${data.requiredDocuments.length}`,
            sub:
              present === data.requiredDocuments.length
                ? "all present"
                : `${data.requiredDocuments.length - present} missing`,
          },
          {
            label: "Deadline",
            value: <DateText value={data.deadlineAt} />,
            sub: `${data.daysRemaining} days`,
          },
        ]}
      />

      <div className="grid grid-cols-1 gap-5 px-6 py-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-5">
          <DeadlineBanner packet={data} />

          <ContentCard
            title="Rule checks"
            actions={
              checks.data ? (
                <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">
                  {`${checks.data.summary.pass} pass · ${checks.data.summary.warn} warn · ${checks.data.summary.fail} fail`}
                </span>
              ) : null
            }
          >
            {checks.isPending ? <LoadingState rows={4} label="Evaluating rule checks" /> : null}
            {checks.error ? (
              <ErrorState
                title="Rule checks could not be evaluated"
                error={toApiError(checks.error)}
                onRetry={() => void checks.refetch()}
              />
            ) : null}
            {checks.data
              ? checks.data.checks.map((check) => <RuleCheckRow key={check.key} check={check} />)
              : null}
            {checks.data ? (
              <p className="pt-3 text-[12px] text-ink-muted">
                Evaluated against the rule registry at{" "}
                <DateText value={checks.data.evaluatedAt} withTime />
                {". "}
                <Link to="/compliance/rules" className="text-primary-hover hover:underline">
                  Open rules registry ›
                </Link>
              </p>
            ) : null}
          </ContentCard>

          <ContentCard
            title={`Required documents · ${present} of ${data.requiredDocuments.length}`}
            actions={<CompletenessBar value={data.completeness} className="w-40" />}
          >
            {data.requiredDocuments.map((document) => (
              <DocumentChecklistRow
                key={document.type}
                document={document}
                onAttach={
                  document.status === "MISSING"
                    ? () => attach.mutate({ type: document.type })
                    : undefined
                }
              />
            ))}
            {/* Attach is fire-and-forget from a row, so R3's toast is what the
                reader gets first — but the toast is gone in five seconds and
                the row it refers to is right here. A refused attach names the
                document type and the rule that rejected it, which belongs
                beside the checklist rather than only in a transient. */}
            {attach.isError ? (
              <RefusalBanner
                title="That document was not attached"
                error={toApiError(attach.error)}
              />
            ) : null}
            {data.requiredDocuments.every((document) => document.status === "PRESENT") ? null : (
              <p className="pt-3 text-[12px] text-ink-muted">
                Attaching a document marks it present on the packet. Ops supplies the evidence;
                Finance files the claim.
              </p>
            )}
          </ContentCard>

          <ContentCard title="Submission log">
            {data.submissionLog.length === 0 ? (
              <p className="py-2 text-[13px] text-ink-muted">
                Nothing has happened to this packet yet.
              </p>
            ) : (
              <ol className="flex flex-col">
                {data.submissionLog.map((entry) => (
                  <li
                    key={`${entry.at}-${entry.event}`}
                    className="flex flex-wrap items-baseline gap-x-2 border-t border-divider py-2.5 text-[13px] text-ink-secondary"
                  >
                    <span className="font-mono text-[12px] text-ink-muted">
                      <DateText value={entry.at} withTime />
                    </span>
                    <span className="text-ink">{humanise(entry.event)}</span>
                    <span className="text-ink-muted">
                      {entry.actor.name ?? entry.actor.id}
                      {entry.reference ? ` · ${entry.reference}` : ""}
                      {entry.completeness !== undefined
                        ? ` · ${Math.round(entry.completeness * 100)}% complete`
                        : ""}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </ContentCard>
        </div>

        <div className="flex flex-col gap-5">
          <ExceptionBanner
            severity="INFO"
            title="TrainOS does not submit to HRD Corp"
            subtitle="There is no HRD Corp API. TrainOS assembles the packet and tracks the deadline; a human files it on the eTRIS portal and records the reference here."
          />

          <ContentCard title="Mark as submitted">
            <div className="flex flex-col gap-3 pt-1">
              <TextField
                label="eTRIS reference number"
                value={reference}
                onChange={setReference}
                placeholder="CLM-2026-______"
                mono
                disabled={!complete}
              />
              <DateField
                label="Submitted on"
                value={submittedOn}
                onChange={setSubmittedOn}
                disabled={!complete}
              />
            </div>

            <p className="pt-3 text-[12px] text-ink-secondary">
              Recording the reference moves the claim to Submitted and starts the payment-tracking
              clock. Disabled until the packet is complete.
            </p>

            <div className="pt-3">
              <PrimaryButton
                onClick={() => void onSubmit()}
                disabled={
                  !complete || reference === "" || submittedOn === "" || markSubmitted.isPending
                }
              >
                Mark as submitted on eTRIS
              </PrimaryButton>
            </div>

            {!complete ? (
              <p className="pt-2 text-[12px] text-ink-muted">
                {`${data.requiredDocuments.length - present} documents outstanding · `}
                <CitationChip variant="rule" label="Rule HRD-011">
                  § HRD-011
                </CitationChip>
              </p>
            ) : null}

            <ActionOutcome
              className="mt-3"
              response={outcome}
              error={
                markSubmitted.error
                  ? describeActionError(
                      toApiError(markSubmitted.error),
                      "The claim could not be marked as submitted",
                    )
                  : undefined
              }
              subject={`Claim filing · ${data.engagementRef}`}
            />
          </ContentCard>

          {exportPacket.data ? (
            <ExceptionBanner
              severity="INFO"
              title="Packet exported"
              subtitle={`${exportPacket.data.url} · link expires ${exportPacket.data.expiresAt}`}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The deadline banner, on the SIX-MONTH rule.
 *
 * The artboard drew "window closes in 3 days" against the five-working-day
 * reading DECISIONS §3 overturned. Severity and day count come from the packet
 * so the banner cannot drift from the rule the checks evaluated.
 */
function DeadlineBanner({ packet }: { packet: ClaimPacket }) {
  const missing = packet.requiredDocuments.filter(
    (document: RequiredDocument) => document.status === "MISSING",
  );

  return (
    <ExceptionBanner
      severity={packet.deadlineSeverity}
      title={`Claim window closes in ${packet.daysRemaining} days`}
      subtitle={`Six months from completion under Circular 2/2026 §5.2. ${
        missing.length === 0
          ? "Every required document is attached."
          : `${missing.length} documents are still missing.`
      }`}
      action={
        <CitationChip variant="rule" label="Rule HRD-009 · claim submission window">
          § HRD-009
        </CitationChip>
      }
    />
  );
}
