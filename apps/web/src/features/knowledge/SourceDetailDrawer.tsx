import type { ReactNode } from "react";
import type { KnowledgeSource } from "@trainos/contract";
import {
  DateText,
  Drawer,
  GhostButton,
  SecondaryButton,
  StatusChip,
} from "@/shared/components/kit";
import {
  HEALTH_LABEL,
  HEALTH_TONE,
  PROMOTED_ACTION,
  TYPE_LABEL,
  cadenceOf,
  healthOf,
  usedForLabel,
} from "./health";

/**
 * One source, with its machinery.
 *
 * Tightening brief §18: every number that left the table lives here. The table
 * answers "is this source pulling its weight"; this answers "what exactly is
 * it", and the two are different readings by different people at different
 * times. Chunk counts, an embedding state, a monitor cadence and a sha256 are
 * facts for the person who has already decided something is wrong — putting
 * them in six columns made every reader pay for one reader's question.
 *
 * The row's actions live here too, so the drawer is not a dead end: a reader
 * who opened it to find out why a source is failing can retry it without
 * closing it first.
 */

export interface SourceDetailDrawerProps {
  source: KnowledgeSource | null;
  onClose: () => void;
  /** The state-driven action — "Retry", "Review changes", "View progress". */
  onPromotedAction: (source: KnowledgeSource) => void;
  onCheck: (source: KnowledgeSource) => void;
  onReingest: (source: KnowledgeSource) => void;
  busy?: boolean;
}

export function SourceDetailDrawer({
  source,
  onClose,
  onPromotedAction,
  onCheck,
  onReingest,
  busy,
}: SourceDetailDrawerProps) {
  const health = source ? healthOf(source) : "HEALTHY";
  const promoted = source ? PROMOTED_ACTION[health] : null;

  return (
    <Drawer
      open={source !== null}
      onClose={onClose}
      width="460px"
      title={source?.name ?? "Source"}
      subtitle={source ? `${TYPE_LABEL[source.type]} · ${source.version}` : undefined}
      footer={
        source ? (
          /* No solid primary in here. The page already has one — "Add source"
             — and CLAUDE.md allows a view one; a drawer open over the page is
             not a second view. The three actions escalate by WEIGHT instead:
             ghost, ghost, outlined. */
          <div className="flex items-center justify-end gap-2">
            <GhostButton disabled={busy} onClick={() => onCheck(source)}>
              Check
            </GhostButton>
            <GhostButton disabled={busy} onClick={() => onReingest(source)}>
              Re-ingest
            </GhostButton>
            {promoted ? (
              <SecondaryButton onClick={() => onPromotedAction(source)}>{promoted}</SecondaryButton>
            ) : null}
          </div>
        ) : null
      }
    >
      {source ? (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-2">
            <StatusChip tone={HEALTH_TONE[health]}>{HEALTH_LABEL[health]}</StatusChip>
            {health === "CHANGED" ? (
              <span className="text-[12px] text-ink-muted">
                quarantined from rule extraction · still searchable
              </span>
            ) : null}
          </div>

          <Section title="Retrieval">
            <Fact label="Used for">{usedForLabel(source)}</Fact>
            <Fact label="Permissions">
              {source.retrievalScopes.includes("CLIENT_FACING")
                ? "Compliance answers, rule extraction and client-facing generation."
                : "Compliance answers and rule extraction. Excluded from client-facing generation, so it can inform an internal reply and can never reach a proposal."}
            </Fact>
          </Section>

          <Section title="Indexing">
            <Fact label="Chunks">
              {source.chunks === 0 ? (
                <span className="text-ink-muted">Not vectorised yet</span>
              ) : (
                <span className="tabular-nums">{source.chunks.toLocaleString("en-MY")}</span>
              )}
            </Fact>
            <Fact label="Embedding">
              {source.embeddingStatus === "INDEXED"
                ? "Indexed — retrieval uses the vectors."
                : source.embeddingStatus === "PENDING"
                  ? "Queued — until it finishes, the source answers from keyword matching."
                  : "Failed — the source is searchable only by keyword."}
            </Fact>
            <Fact label="Last ingestion">
              <DateText value={source.ingestedAt} withTime />
            </Fact>
          </Section>

          <Section title="Monitoring">
            <Fact label="Cadence">{cadenceOf(source.monitorStatus)}</Fact>
            <Fact label="Last checked">
              {source.lastCheckedAt ? (
                <DateText value={source.lastCheckedAt} withTime />
              ) : (
                <span className="text-ink-muted">Never checked</span>
              )}
            </Fact>
            <Fact label="Version">
              {/* Mono, because a version is a machine-ish value — brief §1's
                  one allowance, alongside the hash below. */}
              <span className="font-mono">{source.version}</span>
            </Fact>
            <Fact label="Content hash">
              <span className="break-all font-mono text-[11px]">{source.contentHash}</span>
            </Fact>
          </Section>
        </div>
      ) : null}
    </Drawer>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
      <dl className="flex flex-col gap-2">{children}</dl>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[104px_1fr] gap-3">
      <dt className="text-[12px] text-ink-muted">{label}</dt>
      <dd className="text-[12px] leading-relaxed text-ink-secondary">{children}</dd>
    </div>
  );
}

/**
 * "How sources work" — the two explanatory cards that used to sit under the
 * table, moved behind the quiet link beside the title (§18).
 *
 * They are not decoration and were not deleted: without them, "Client answers"
 * in a Used-for column and "Changed" in a Status column are just words. But
 * they are read ONCE, by a new administrator, and they were charging every
 * later visit for that one reading.
 */
export function HowSourcesWorkDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="440px"
      title="How sources work"
      subtitle="What the agents may read, and how you know it is still true."
      footer={
        <div className="flex justify-end">
          <GhostButton onClick={onClose}>Close</GhostButton>
        </div>
      }
    >
      <ul className="flex list-disc flex-col gap-3.5 pl-4 text-[13px] leading-relaxed text-ink-secondary">
        <li>
          <strong className="font-medium text-ink">What may be cited.</strong> Compliance answers
          may cite HRD Corp circulars, scheme guides and the Allowable Cost Matrix. A source marked
          Internal informs staff answers and is excluded from client-facing generation, so an
          internal delivery note can shape an operations reply and can never reach a proposal.
        </li>
        <li>
          <strong className="font-medium text-ink">How freshness is known.</strong> Watched sources
          are fetched weekly and hashed. A changed hash opens a rule-change review rather than
          updating anything — extraction proposes, it never activates.
        </li>
        <li>
          <strong className="font-medium text-ink">What a change does.</strong> A changed source is
          quarantined from rule extraction until its diffs are reviewed, and stays searchable the
          whole time. Pulling it out of search too would take the old, still-correct answers away to
          guard against a change nobody has read — trading a known good for an unknown one.
        </li>
        <li>
          <strong className="font-medium text-ink">Check is not re-ingest.</strong> A check
          re-fetches and compares hashes; it never rewrites the corpus. A re-ingest rebuilds the
          chunks and embeddings, which does change what the agents read. A fetch failure is retried
          three times and then flagged.
        </li>
      </ul>
    </Drawer>
  );
}
