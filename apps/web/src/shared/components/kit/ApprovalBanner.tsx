import type { ReactNode } from "react";
import type { ApprovalRequest, Role, Timestamp } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";
import { DateText } from "./DateText";
import { MoneyText } from "./Money";

/**
 * The approval banner. Kit.dc.html §02, two states:
 *   · pending — amber, three actions: Approve / Request changes / Reject
 *   · decided — neutral, one link: "Approved by … · View audit trail"
 *
 * The amber is earned. A pending approval is a queue item with an SLA running
 * against it, which is precisely the case status colour exists for. Once
 * decided, the colour goes away: a settled thing does not need to shout.
 *
 * Contract §7 notes `slaBreached` "never blocks" — it is the 200-with-a-flag row
 * of the error table — so a breach changes the banner's wording and tone, never
 * its actions.
 */

export interface ApprovalBannerProps {
  /** The approval itself. Subject, value and SLA all come from here. */
  approval: Pick<
    ApprovalRequest,
    "subject" | "value" | "slaDueAt" | "slaBreached" | "slaRemainingMinutes" | "status"
  >;
  /** Who has to decide, e.g. "Kelvin" and `SALES_MANAGER`. */
  approverName?: string;
  approverRole?: Role;
  /** The three buttons, in the artboard's order. Omit on a read-only view. */
  actions?: ReactNode;
  /** Set once decided: who, when, and the link to the trail. */
  decidedBy?: string;
  decidedAt?: Timestamp;
  onOpenAudit?: () => void;
  className?: string;
}

const ROLE_LABEL: Partial<Record<Role, string>> = {
  SALES: "Sales",
  SALES_MANAGER: "Sales Manager",
  OPS: "Operations",
  FINANCE: "Finance",
  MD: "Managing Director",
  ADMIN: "Admin",
  TRAINER: "Trainer",
  CLIENT: "Client",
  AGENT: "Agent",
};

export function ApprovalBanner({
  approval,
  approverName,
  approverRole,
  actions,
  decidedBy,
  decidedAt,
  onOpenAudit,
  className,
}: ApprovalBannerProps) {
  const decided = approval.status !== "PENDING";

  if (decided) {
    return (
      <div
        className={cn(
          "flex flex-wrap items-center gap-3.5 rounded-control border border-border bg-surface px-3.5 py-3",
          className,
        )}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-[13px] font-semibold text-ink">
            {approval.status === "APPROVED" ? "Approved" : "Decided"}
            {decidedBy ? ` by ${decidedBy}` : ""}
          </p>
          {decidedAt ? (
            <p className="text-[12px] text-ink-secondary">
              <DateText value={decidedAt} withTime />
            </p>
          ) : null}
        </div>
        {onOpenAudit ? (
          <button
            type="button"
            onClick={onOpenAudit}
            className="shrink-0 text-[12px] text-primary-hover underline-offset-2 hover:underline"
          >
            View audit trail
          </button>
        ) : null}
      </div>
    );
  }

  /* One ordered list of facts, joined by a single separator rule, so the line
     reads the same whichever facts are present. Building it by appending
     conditional "· " prefixes is how a banner ends up starting with a dot. */
  const facts: ReactNode[] = [approval.subject];

  if (approval.value) {
    facts.push(
      <MoneyText key="value" value={approval.value} compact className="text-ink-secondary" />,
    );
  }

  facts.push(
    <span key="due" className="inline-flex items-center gap-1">
      due <DateText value={approval.slaDueAt} withTime />
    </span>,
  );

  /* The SLA is the last fact, because it is the one that decides whether this
     row is read now or later. §7: a breach never blocks — it changes the
     wording and the tone, not the actions. */
  if (approval.slaBreached) {
    facts.push(
      <span key="sla" className="font-medium text-danger">
        SLA breached
      </span>,
    );
  } else if (typeof approval.slaRemainingMinutes === "number") {
    facts.push(`${approval.slaRemainingMinutes} min left`);
  }

  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-3.5 rounded-control border px-3.5 py-3",
        approval.slaBreached
          ? "border-danger-border bg-danger-fill"
          : "border-warning-border bg-warning-fill",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-[13px] font-semibold text-ink">
          Awaiting approval
          {approverName ? ` from ${approverName}` : ""}
          {approverRole ? ` · ${ROLE_LABEL[approverRole] ?? approverRole}` : ""}
        </p>
        <p className="flex flex-wrap items-center gap-x-1.5 text-[12px] text-ink-secondary">
          {facts.map((fact, index) => (
            <span key={index} className="inline-flex items-center gap-1.5">
              {index > 0 ? (
                <span aria-hidden="true" className="text-ink-muted">
                  ·
                </span>
              ) : null}
              {fact}
            </span>
          ))}
        </p>
      </div>

      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
