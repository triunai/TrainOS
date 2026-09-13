import { useState } from "react";
import { useParams } from "react-router-dom";
import { tenant } from "@trainos/fixtures";
import {
  ErrorState,
  ExceptionBanner,
  ExternalMinimalShell,
  LanguageToggle,
  LoadingState,
  PROPOSAL_TONE,
  RecordHeader,
  SecondaryButton,
  StatusChip,
  formatDate,
  formatTime,
  humanise,
  toast,
} from "@/shared/components/kit";
import { toApiError } from "@/shared/api";
import { AcceptancePanel } from "./AcceptancePanel";
import { CommentThread } from "./CommentThread";
import { InvestmentPanel, ProposalSections } from "./ProposalSections";
import { useAcceptPortalProposal, useAddPortalComment, usePortalProposal } from "./api";

/**
 * M07-S07 · the client-facing proposal page, at the public route `/p/:token`.
 *
 * This is the only screen in TrainOS that is NOT behind tenant auth and NOT
 * inside the app shell: a client has nothing to navigate to, so there is no
 * sidebar, no search, no notification bell, and the route is mounted as a
 * sibling of the shell rather than inside it.
 *
 * The state shown is ACCEPTED AND LOCKED, which is the design pack's deliberate
 * choice — the editable state is the common one, so the pack draws the one that
 * is easy to get wrong. In that state the page carries ZERO solid primary
 * buttons: REPORT.md names M07-S07 and M10-S06 as the two documented exceptions
 * to the one-primary rule, because nothing may be written any more. The single
 * `PrimaryButton` in this feature lives inside `AcceptancePanel`'s not-yet-
 * accepted branch and cannot render beside the locked panel.
 *
 * Nothing AI-authored surfaces here. §11's projection is client-safe by
 * construction: no margin, no cost lines, no provenance, so there is no
 * `AIChip` on this page and that absence is the design, not an omission.
 */
export function ClientProposalPage() {
  const { token = "" } = useParams<{ token: string }>();
  const [language, setLanguage] = useState("EN");

  const proposal = usePortalProposal(token);
  const comment = useAddPortalComment(token);
  const accept = useAcceptPortalProposal(token);

  const data = proposal.data;
  /**
   * §11 carries no vendor contact block, so the most recent reply from the
   * provider's side is the only real name available. Requested from `fixtures`
   * as a `vendorContact` field; this collapses to reading it when it lands.
   */
  const vendorContact = [...(data?.comments ?? [])]
    .reverse()
    .find((entry) => entry.authorKind === "HUMAN");

  return (
    <ExternalMinimalShell
      orgName={tenant.name}
      mark={tenant.name.slice(0, 1)}
      contact={data?.organisationName}
      languageToggle={<LanguageToggle value={language} onChange={setLanguage} />}
    >
      {proposal.isPending ? (
        <LoadingState rows={6} label="Loading your proposal" />
      ) : proposal.isError || !data ? (
        <ErrorState
          title="This proposal link cannot be opened"
          error={toApiError(proposal.error)}
          description="The link may have expired or been withdrawn. Contact the person who sent it to you for a new one."
        />
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          <div className="border-b border-divider">
            <RecordHeader
              withoutCondensed
              title={`Proposal for ${data.organisationName}`}
              recordRef={data.ref}
              meta={[`issued ${formatDate(data.issuedAt)}`]}
              chips={
                <StatusChip live tone={PROPOSAL_TONE[data.status]}>
                  {data.acceptance
                    ? `Accepted ${formatDate(data.acceptance.acceptedAt)}`
                    : humanise(data.status)}
                </StatusChip>
              }
              actions={
                <SecondaryButton
                  onClick={() =>
                    toast.info("Preparing your PDF", {
                      description: `${data.ref} will download when it is ready.`,
                    })
                  }
                >
                  Download PDF
                </SecondaryButton>
              }
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            <div className="flex min-w-0 flex-1 flex-col gap-5 border-divider px-7 py-5 lg:border-r">
              {data.acceptance ? (
                <ExceptionBanner
                  severity="INFO"
                  title={`This proposal was accepted on ${formatDate(
                    data.acceptance.acceptedAt,
                  )} at ${formatTime(data.acceptance.acceptedAt)}`}
                  subtitle={`Accepted by ${data.acceptance.acceptedBy} · ${data.acceptance.role}. The document is locked and ${tenant.name} has been notified.`}
                />
              ) : null}

              <ProposalSections sections={data.sections} />
              <InvestmentPanel investment={data.investment} />
            </div>

            <aside className="flex w-full shrink-0 flex-col gap-4 bg-surface px-6 py-5 lg:w-[380px]">
              <AcceptancePanel
                acceptance={data.acceptance}
                busy={accept.isPending}
                {...(accept.error ? { error: toApiError(accept.error) } : {})}
                onAccept={(body) =>
                  accept.mutate(body, {
                    onSuccess: (result) =>
                      toast.success("Proposal accepted", {
                        description: `Signature ${result.signatureRef} recorded. ${result.engagementRef} has been created.`,
                      }),
                  })
                }
                onDownload={() =>
                  toast.info("Preparing your signed copy", {
                    description: `${data.ref} will download when it is ready.`,
                  })
                }
              />

              <CommentThread
                comments={data.comments}
                defaultAuthor={data.acceptance?.acceptedBy ?? ""}
                busy={comment.isPending}
                {...(comment.error ? { error: toApiError(comment.error) } : {})}
                onPost={(body) => comment.mutate(body)}
              />

              {vendorContact ? (
                <section className="flex flex-col gap-1.5">
                  <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
                    Contact
                  </h2>
                  <p className="text-[13px] leading-[1.6] text-ink-secondary">
                    {vendorContact.author} · {tenant.name}
                  </p>
                </section>
              ) : null}
            </aside>
          </div>
        </div>
      )}
    </ExternalMinimalShell>
  );
}

export default ClientProposalPage;
