import { Body, PageHeader, Section, StatusChip, type StatusTone } from "@/components/kit";
import { BandEditor } from "@/components/demand/BandEditor";
import { Frame } from "@/components/shell/Frame";
import { formatDate, todayMY } from "@/lib/dates";
import { formatRM } from "@/lib/money";
import { plain } from "@/server/actions";
import { DELIVERY_MODES, DELIVERY_MODE_LABEL } from "@/server/domain/stages";
import { COST_BASES, UNIVER_ENGINE_VERSION, listPolicyVersions, type CostBasis, type PolicyVersionRow } from "@/server/pricing";
import { correctBandsAction, publishVersionAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cost matrix" };

const BASIS_LABEL: Record<CostBasis, string> = {
  PER_GROUP_DAY: "RM per group per day",
  PER_PAX_DAY: "RM per participant per day",
};

function basisLabel(basis: string): string {
  if (!(COST_BASES as readonly string[]).includes(basis)) throw new Error(`Unknown cost basis: ${basis}`);
  return BASIS_LABEL[basis as CostBasis];
}

function versionState(p: PolicyVersionRow): { label: string; tone: StatusTone } {
  if (p.inForce) return { label: "In force", tone: "success" };
  if (p.scheduled) return { label: "Scheduled", tone: "info" };
  if (!p.active) return { label: "Inactive", tone: "neutral" };
  return { label: p.supersededBy ? `Superseded by ${p.supersededBy}` : "Not yet in force", tone: "neutral" };
}

/** ACM-2026.1 -> ACM-2026.2, skipping labels the mode already has. */
function nextVersion(version: string, taken: Set<string>): string {
  const m = /^(.*?)(\d+)$/.exec(version);
  let candidate = m ? `${m[1]}${Number(m[2]) + 1}` : `${version}-r2`;
  while (taken.has(candidate.toLowerCase())) {
    const k = /^(.*?)(\d+)$/.exec(candidate);
    candidate = k ? `${k[1]}${Number(k[2]) + 1}` : `${candidate}-r`;
  }
  return candidate;
}

export default async function CostMatrixPage() {
  const today = todayMY();
  const versions = plain(await listPolicyVersions(today));
  const totalQuotes = versions.reduce((a, v) => a + v.quotations, 0);

  return (
    <Frame crumbs={[{ label: "Knowledge" }, { label: "Cost matrix" }]}>
      <PageHeader
        title="Allowable Cost Matrix"
        summary={`Versioned HRD Corp fee caps by delivery mode and headcount · quotes are priced against these caps by the headless Univer engine (${UNIVER_ENGINE_VERSION}) and cross-checked to the sen by an independent TypeScript model · ${totalQuotes} quotation${totalQuotes === 1 ? "" : "s"} priced so far`}
      />
      <Body>
        {DELIVERY_MODES.map((mode) => {
          const rows = versions.filter((v) => v.deliveryMode === mode);
          const current = rows.find((v) => v.inForce) ?? rows[0];
          if (!current) {
            return (
              <Section key={mode} eyebrow={DELIVERY_MODE_LABEL[mode]} title="No policy">
                <p className="text-[13px] text-ink-secondary">No Allowable Cost Matrix policy exists for this delivery mode, so it cannot be priced. The reference-data seed loads ACM-2026.1.</p>
              </Section>
            );
          }
          const taken = new Set(rows.map((r) => r.version.toLowerCase()));
          const latest = [...rows].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0];
          return (
            <Section
              key={mode}
              eyebrow={`${DELIVERY_MODE_LABEL[mode]} · ${basisLabel(current.basis)}`}
              title={current.inForce ? `${current.version} in force since ${formatDate(current.effectiveFrom)}` : "No version in force today"}
              actions={
                <BandEditor
                  key={latest.id}
                  policyId={latest.id}
                  version={latest.version}
                  modeLabel={DELIVERY_MODE_LABEL[mode]}
                  basisLabel={basisLabel(latest.basis)}
                  bands={latest.bands}
                  quotations={latest.quotations}
                  suggestedVersion={nextVersion(latest.version, taken)}
                  suggestedEffectiveFrom={latest.effectiveFrom > today ? latest.effectiveFrom : today}
                  minEffectiveFrom={latest.effectiveFrom}
                  publish={publishVersionAction}
                  correct={correctBandsAction}
                />
              }
              flush
            >
              <ul>
                {rows.map((p) => {
                  const state = versionState(p);
                  return (
                    <li key={p.id} className="grid grid-cols-1 gap-3 border-b border-divider px-4 py-3 last:border-b-0 md:grid-cols-[220px_minmax(0,1fr)]">
                      <div className="flex flex-col items-start gap-1.5">
                        <span className="font-mono text-[13px] font-medium text-ink">{p.version}</span>
                        <StatusChip tone={state.tone}>{state.label}</StatusChip>
                        <span className="text-[12px] text-ink-secondary">effective {formatDate(p.effectiveFrom)}</span>
                        <span className="text-[12px] text-ink-secondary">
                          {p.quotations} quotation{p.quotations === 1 ? "" : "s"} priced under it
                        </span>
                      </div>
                      <div className="flex min-w-0 flex-col gap-2">
                        <table className="w-full max-w-[420px] border-collapse text-[13px]">
                          <caption className="sr-only">{`${p.version} ${DELIVERY_MODE_LABEL[mode]} bands`}</caption>
                          <thead>
                            <tr className="border-b border-border text-left text-[12px] text-ink-muted">
                              <th scope="col" className="py-1.5 pr-3 font-medium">Headcount</th>
                              <th scope="col" className="py-1.5 text-right font-medium">Daily cap</th>
                            </tr>
                          </thead>
                          <tbody>
                            {p.bands.map((b) => (
                              <tr key={`${b.minPax}-${b.maxPax}`} className="border-b border-divider last:border-b-0">
                                <td className="py-1.5 pr-3 tabular-nums">
                                  {b.minPax}–{b.maxPax} pax
                                </td>
                                <td className="py-1.5 text-right tabular-nums">{formatRM(b.dailyCap)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <p className="text-[12px] text-ink-muted">{p.sourceNote}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Section>
          );
        })}
      </Body>
    </Frame>
  );
}
