import type { ReactNode } from "react";
import type { PortalInvestment, PortalSection } from "@trainos/contract";
import { MoneyText } from "@/shared/components/kit";

/**
 * The document body of M07-S07.
 *
 * Sections render in server order with a mono eyebrow and a 74ch measure, which
 * is what makes the page read as a document rather than as an app panel. No
 * provenance, no AI chip, no confidence: §11's projection is client-safe and
 * the pack is explicit that provenance stays internal, so there is deliberately
 * nothing here for an `AIChip` to attach to.
 */

export function ProposalSections({ sections }: { sections: PortalSection[] }) {
  return (
    <div className="flex max-w-[74ch] flex-col gap-4">
      {sections.map((section) => (
        <section key={section.n} className="flex flex-col gap-1.5">
          <h3 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
            {section.n} · {section.title}
          </h3>
          <p className="text-[14px] leading-[1.7] text-ink">{section.body}</p>
        </section>
      ))}
    </div>
  );
}

/**
 * The commercial summary, built from `investment` rather than from the
 * investment section's prose — the number a client acts on must come from the
 * field, not from a sentence somebody wrote.
 */
export function InvestmentPanel({
  investment,
  participants,
}: {
  investment: PortalInvestment;
  participants?: string;
}) {
  const claimable = `up to ${Math.round(investment.hrdcClaimableUpTo * 100)}%`;

  return (
    <div className="max-w-[74ch] overflow-hidden rounded-card border border-border">
      <dl className="flex flex-col">
        <Row
          term={participants ?? "Programme fee"}
          value={<MoneyText value={investment.total} className="font-semibold" />}
          emphasis
        />
        <Row
          term={`HRD Corp claimable · ${investment.hrdcScheme.replace(/_/g, "-")}`}
          value={claimable}
        />
        {investment.levyAvailable ? (
          <Row
            term="Your available levy"
            value={<MoneyText value={investment.levyAvailable} compact />}
          />
        ) : null}
      </dl>
    </div>
  );
}

function Row({ term, value, emphasis }: { term: string; value: ReactNode; emphasis?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-divider px-3.5 py-2.5 first:border-t-0">
      <dt className={emphasis ? "text-[14px] text-ink" : "text-[13px] text-ink-secondary"}>
        {term}
      </dt>
      <dd
        className={
          emphasis ? "font-mono text-[14px] text-ink" : "font-mono text-[13px] text-ink-secondary"
        }
      >
        {value}
      </dd>
    </div>
  );
}
