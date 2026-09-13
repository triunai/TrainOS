import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type {
  ActionResponse,
  EnquiryDetail,
  EnquiryExtraction,
  Money,
  Provenance,
  RelatedRecord,
} from "@trainos/contract";
import {
  ActionOutcome,
  AIChip,
  CitationChip,
  DateText,
  ErrorState,
  ExceptionBanner,
  Fab,
  GhostButton,
  LoadingState,
  MoneyText,
  formatDate,
  formatTime,
  PrimaryButton,
  RecordHeader,
  RefChip,
  SecondaryButton,
  StatusChip,
  describeActionError,
  ENQUIRY_TONE,
  humanise,
  type ActionError,
  PartialDataBanner,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { readableMessage, toApiError, useActor } from "@/shared/api";
import { useEnquiryAction, useEnquiry, useOrganisation, usePatchExtraction } from "./api";

/**
 * M03-S02 · Enquiry detail (`M03 Leads.dc.html`).
 *
 * One inbound message becomes a qualified opportunity without anyone retyping
 * what the agent already extracted. Every extracted value carries its own
 * provenance, so "where did this come from" is answerable at the field, and any
 * of them can be corrected before use — the correction flips that field's
 * provenance to AI_SUGGESTED with `editedBy`, which the chip then shows.
 *
 * The primary is "Accept & convert". Conversion is not policy-gated — nothing
 * leaves the system and no money moves — but the screen still renders all three
 * action outcomes, because which one comes back is the server's decision.
 */

type FieldKey = keyof EnquiryExtraction;

const FIELD_LABEL: Record<FieldKey, string> = {
  topic: "Topic",
  audience: "Audience",
  timing: "Timing",
  budget: "Budget",
};

export function EnquiryDetailPage() {
  const { enquiryId } = useParams<{ enquiryId: string }>();
  const navigate = useNavigate();

  /* Ends at the list. RecordHeader carries `recordRef`, so a third crumb was
     the record naming itself twice on one page. */
  useBreadcrumb([{ label: "Sales" }, { label: "Enquiries", href: "/sales/enquiries" }]);

  const enquiry = useEnquiry(enquiryId);
  const organisation = useOrganisation(enquiry.data?.matchedOrganisation?.ref);
  const patch = usePatchExtraction(enquiryId);
  const action = useEnquiryAction();
  const actor = useActor();

  const [response, setResponse] = useState<ActionResponse | undefined>(undefined);
  const [failure, setFailure] = useState<ActionError | undefined>(undefined);
  const [editing, setEditing] = useState<FieldKey | null>(null);
  const [primed, setPrimed] = useState(false);

  /* The pack draws this screen with the timing field mid-edit, captioned
     "Edit before use". The field it draws open is the one a human has already
     corrected — its provenance carries `editedBy` — so rather than hardcode
     "timing", open whichever field is in play. Once the reader closes it, it
     stays closed: `primed` makes this a first-render decision only. */
  useEffect(() => {
    if (primed || !enquiry.data) return;
    const inPlay = (Object.keys(FIELD_LABEL) as FieldKey[]).find(
      (key) => enquiry.data?.extraction[key].provenance?.editedBy !== undefined,
    );
    setEditing(inPlay ?? null);
    setPrimed(true);
  }, [enquiry.data, primed]);

  if (enquiry.isPending) return <LoadingState rows={8} label="Loading the enquiry" />;

  if (enquiry.isError || !enquiry.data) {
    return (
      <ErrorState
        title="The enquiry did not load"
        error={toApiError(enquiry.error)}
        onRetry={() => void enquiry.refetch()}
      />
    );
  }

  const detail: EnquiryDetail = enquiry.data;
  const suggestion = detail.suggestedAction;
  const exception = detail.related.find((record) => record.severity === "ALERT");
  const levy = organisation.data?.metrics.hrdcLevyAvailable;

  const convert = () => {
    setResponse(undefined);
    setFailure(undefined);
    action.mutate(
      {
        type: "OPPORTUNITY_CONVERT",
        targetRef: detail.ref,
        /* Spelled out, not passed through — see the note in the inbox. */
        payload: suggestion?.payload
          ? {
              value: suggestion.payload.value,
              questionnaireTemplateId: suggestion.payload.questionnaireTemplateId,
              programmeId: suggestion.payload.programmeId,
            }
          : undefined,
        requestedBy: actor,
      },
      {
        /* Every §3 outcome arrives here as a value, the refusal included: a
           queued approval is a success and rendering it through an error path
           is how an approval queue becomes invisible. */
        onSuccess: (result) => {
          if (result.kind === "error") {
            setFailure(describeActionError(result.error, readableMessage(result.error)));
            return;
          }
          setResponse(result.response);
        },
      },
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RecordHeader
        accent
        collapsible
        recordType="enquiry"
        title={detail.subject}
        recordRef={detail.ref}
        meta={[
          `received ${formatDate(detail.receivedAt)}, ${formatTime(detail.receivedAt)}`,
          `from ${detail.from.name}`,
          detail.assignedTo ? `owner ${detail.assignedTo.name}` : "unassigned",
        ]}
        chips={
          <>
            <StatusChip tone={ENQUIRY_TONE[detail.status]} live>
              {humanise(detail.status)}
            </StatusChip>
            <StatusChip>{humanise(detail.channel)}</StatusChip>
          </>
        }
        actions={
          <>
            <SecondaryButton>Assign to me</SecondaryButton>
            <SecondaryButton>Archive</SecondaryButton>
          </>
        }
        primaryAction={
          <PrimaryButton onClick={convert} disabled={action.isPending}>
            Accept &amp; convert
          </PrimaryButton>
        }
        metrics={[
          {
            label: "Estimated value",
            value: detail.estimatedValue ?? <span className="text-ink-muted">not stated</span>,
          },
          {
            label: "Classification",
            value: `${humanise(detail.classification.label)} · ${Math.round(
              (detail.classification.provenance.confidence ?? 0) * 100,
            )}%`,
          },
          {
            label: "Organisation",
            value: detail.matchedOrganisation?.name ?? "unmatched",
            sub: detail.matchedOrganisation
              ? humanise(detail.matchedOrganisation.matchReason).toLowerCase()
              : undefined,
            onDrill: detail.matchedOrganisation
              ? () => navigate(`/sales/organisations/${detail.matchedOrganisation?.ref ?? ""}`)
              : undefined,
          },
          {
            label: "Levy available",
            value: levy ? (levy.value as Money) : <span className="text-ink-muted">—</span>,
            sub: levy?.secondary,
          },
        ]}
      />

      {/* The levy is the number that decides whether an enquiry is worth
          working, and it comes from a second read of the matched organisation.
          A failed read printed the same em dash as an organisation that simply
          has no levy — one is "we could not ask", the other is "the answer is
          nothing". */}
      <PartialDataBanner
        className="mx-5 mb-3"
        reads={[
          {
            label: "The matched organisation's HRD Corp levy",
            error: organisation.isError ? toApiError(organisation.error) : null,
            retry: () => void organisation.refetch(),
          },
        ]}
      />

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col gap-6 border-r border-divider px-5 py-4">
          <section className="flex flex-col gap-2.5">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
              Original enquiry
            </h2>
            <p className="max-w-[70ch] text-[14px] leading-[1.65] text-ink">{detail.body}</p>
            <p className="pt-1 text-[12px] text-ink-muted">
              {detail.from.email ?? detail.from.phone} ·{" "}
              <DateText value={detail.receivedAt} withTime /> · original message retained for audit
            </p>
          </section>

          <section className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-baseline gap-2.5">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
                Extracted
              </h2>
              <AIChip
                className="ml-auto"
                provenance={detail.classification.provenance}
                label="Lead Agent"
              />
            </div>

            <dl className="grid grid-cols-4 gap-4">
              {(Object.keys(FIELD_LABEL) as FieldKey[]).map((key) => (
                <ExtractedField
                  /* The value is part of the key so a saved correction resets
                     the input's draft rather than leaving the old text behind. */
                  key={`${key}:${String(detail.extraction[key].value)}`}
                  fieldKey={key}
                  detail={detail}
                  editing={editing === key}
                  onEdit={() => setEditing(key)}
                  onCancel={() => setEditing(null)}
                  onSave={(value) => {
                    patch.mutate({ field: key, value }, { onSuccess: () => setEditing(null) });
                  }}
                  saving={patch.isPending}
                />
              ))}
            </dl>

            <Citations provenance={detail.extraction.topic.provenance} />
          </section>

          {suggestion ? (
            <section className="flex flex-col gap-2.5">
              <div className="flex flex-wrap items-baseline gap-2.5">
                <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
                  Suggested action
                </h2>
                <AIChip className="ml-auto" provenance={suggestion.provenance} label="Lead Agent" />
                <span className="text-[12px] text-ink-muted">{humanise(suggestion.autonomy)}</span>
              </div>
              <p className="max-w-[70ch] text-[14px] leading-[1.6] text-ink">
                {suggestion.summary}
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <SecondaryButton onClick={convert} disabled={action.isPending}>
                  Accept &amp; convert
                </SecondaryButton>
                <SecondaryButton onClick={() => setEditing("timing")}>Edit first</SecondaryButton>
                <GhostButton>Dismiss</GhostButton>
              </div>
              <ActionOutcome
                response={response}
                error={failure}
                subject={`Convert ${detail.ref}`}
                onDismiss={() => {
                  setResponse(undefined);
                  setFailure(undefined);
                }}
              />
            </section>
          ) : null}
        </div>

        <aside className="flex w-[340px] shrink-0 flex-col gap-4 px-5 py-4">
          <section className="flex flex-col gap-2.5">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
              Related · the chain
            </h2>
            <ul className="flex flex-col gap-2 text-[13px]">
              {detail.related.map((record) => (
                <RelatedRow key={record.ref} record={record} onOpen={navigate} />
              ))}
            </ul>
          </section>

          {exception ? (
            <ExceptionBanner
              severity="DANGER"
              title={`Overdue invoice on this account`}
              subtitle={`${exception.ref} · ${exception.label}. Finance has a reminder drafted.`}
            />
          ) : null}

          <section className="flex flex-col gap-2.5">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
              Channel timeline
            </h2>
            <ol className="flex flex-col gap-2 text-[12px] text-ink-secondary">
              <li>
                <b className="text-ink">
                  <DateText value={detail.receivedAt} withTime />
                </b>{" "}
                · {humanise(detail.channel)} received, thread opened
              </li>
              {detail.classification.provenance.generatedAt ? (
                <li>
                  <b className="text-ink">
                    <DateText value={detail.classification.provenance.generatedAt} withTime />
                  </b>{" "}
                  · Lead Agent classified {humanise(detail.classification.label)} ✦
                </li>
              ) : null}
              {detail.extraction.timing.provenance?.editedBy ? (
                <li>
                  <b className="text-ink">
                    <DateText value={detail.extraction.timing.provenance.editedBy.at} withTime />
                  </b>{" "}
                  · {detail.extraction.timing.provenance.editedBy.name} corrected Timing
                </li>
              ) : null}
              <li>
                <b className="text-ink">
                  <DateText value={detail.updatedAt} withTime />
                </b>{" "}
                · {detail.status === "CONVERTED" ? "Converted" : "Awaiting consultant decision"}
              </li>
            </ol>
          </section>
        </aside>
      </div>

      <Fab />
    </div>
  );
}

function RelatedRow({ record, onOpen }: { record: RelatedRecord; onOpen: (path: string) => void }) {
  const route =
    record.type === "ORGANISATION"
      ? `/sales/organisations/${record.ref}`
      : record.type === "TNA"
        ? `/sales/tna/${record.ref}`
        : null;

  return (
    <li className="flex items-center gap-2.5">
      <RefChip type={record.type} />
      {route ? (
        <button
          type="button"
          onClick={() => onOpen(route)}
          className="truncate font-medium text-primary-hover underline-offset-2 hover:underline"
        >
          {record.ref}
        </button>
      ) : (
        <span className="truncate text-ink">{record.ref}</span>
      )}
      {/* An ALERT is a status and takes a chip; everything else is a caption. */}
      {record.severity === "ALERT" ? (
        <StatusChip tone="danger" className="ml-auto">
          {record.label}
        </StatusChip>
      ) : (
        <span className="ml-auto shrink-0 text-[11px] text-ink-muted">{record.label}</span>
      )}
    </li>
  );
}

function Citations({ provenance }: { provenance: Provenance | undefined }) {
  const sources = provenance?.sources ?? [];
  if (sources.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 pt-2">
      {sources.map((source, index) => (
        <span key={`${source.ref}-${index}`} className="inline-flex items-center gap-1.5">
          <CitationChip variant="inline" label={`Source ${index + 1}: ${source.ref}`}>
            {index + 1}
          </CitationChip>
          <span className="text-[12px] text-ink-secondary">{source.ref}</span>
        </span>
      ))}
    </div>
  );
}

function readable(key: FieldKey, detail: EnquiryDetail): ReactNode {
  if (key === "budget") {
    const money = detail.extraction.budget.value;
    return money ? <MoneyText value={money} compact /> : null;
  }
  return detail.extraction[key].value;
}

function ExtractedField({
  fieldKey,
  detail,
  editing,
  onEdit,
  onCancel,
  onSave,
  saving,
}: {
  fieldKey: FieldKey;
  detail: EnquiryDetail;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (value: string) => void;
  saving: boolean;
}) {
  const field = detail.extraction[fieldKey];
  const [draft, setDraft] = useState(String(field.value ?? ""));
  const label = FIELD_LABEL[fieldKey];
  const value = readable(fieldKey, detail);

  if (editing) {
    return (
      <div>
        <dt className="text-[12px] text-ink-muted">{label}</dt>
        <dd className="flex flex-col gap-1">
          <input
            aria-label={`${label} value`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="w-full rounded-[6px] border border-primary bg-card px-2 py-1 text-[13px] text-ink"
          />
          <div className="flex items-center gap-1.5">
            <SecondaryButton onClick={() => onSave(draft)} disabled={saving}>
              Save
            </SecondaryButton>
            <GhostButton onClick={onCancel}>Cancel</GhostButton>
          </div>
          <span className="text-[11px] text-primary-hover">
            editing · original “{String(field.value ?? "not stated")}”
          </span>
        </dd>
      </div>
    );
  }

  return (
    <div>
      <dt className="text-[12px] text-ink-muted">{label}</dt>
      <dd className="flex flex-col items-start gap-1">
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${label}`}
          className={
            value
              ? "rounded-[4px] text-left text-[14px] font-medium text-ink hover:underline"
              : "rounded-[4px] text-left text-[14px] text-ink-muted hover:underline"
          }
        >
          {value ?? "not stated"}
        </button>
        <AIChip provenance={field.provenance} label={label} />
      </dd>
    </div>
  );
}
