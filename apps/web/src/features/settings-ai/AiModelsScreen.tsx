import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { TIER_KEYS } from "@trainos/contract";
import type { CacheStrategy, ModelTier, RoutingEntry, TierKey } from "@trainos/contract";
import {
  AllowedHoursStrip,
  BudgetBar,
  ContentCard,
  DataTable,
  EmptyState,
  ErrorState,
  ExceptionBanner,
  formatMoney,
  humanise,
  JuryChip,
  LoadingState,
  PrimaryButton,
  RecordHeader,
  RefusalBanner,
  SecondaryButton,
  StatusChip,
  TIER_STATUS_TONE,
  TierChip,
  tierLabel,
  type Column,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { useAiRouting, useAiTiers, usePutAiRouting } from "./api";
import { PROVIDERS_PATH, USAGE_PATH } from "./paths";

/**
 * M20-S20 · AI models — tiers and routing.
 *
 * Primary user: System Admin. Primary button: "Apply to future runs" — worded
 * that way because §17 is explicit that a routing change is never retroactive.
 * A button called "Save" would imply a run already in flight could be moved,
 * and it cannot: the tier a run is using was resolved when the run started.
 *
 * Two tables and they are not the same kind of thing. The TIER table is
 * infrastructure — nine rows describing what each tier is, what it falls back
 * to, when it is allowed to run and what it has spent. The ASSIGNMENT MATRIX is
 * policy — twelve action types, each pinned to one tier. REPORT.md's own review
 * notes the matrix does not fit 900px, so it gets its own scroll pane and the
 * page banner stays outside it: a warning that scrolls away inside a tall table
 * is a warning nobody reads.
 *
 * Peak bands are drawn on every allowed-hours strip, not just the batch tiers'.
 * A reader comparing two rows needs the same axis under both.
 */

/**
 * `CacheStrategy` → the label the artboards print.
 *
 * `humanise` would give "Context 1h", which reads as a typo. The separator
 * matters here because the two halves are different facts: WHAT is cached
 * (the prompt prefix, or the whole context) and for HOW LONG.
 */
const CACHE_LABEL: Record<CacheStrategy, string> = {
  NONE: "None",
  PROMPT_15M: "Prompt · 15m",
  PROMPT_1H: "Prompt · 1h",
  PROMPT_24H: "Prompt · 24h",
  CONTEXT_1H: "Context · 1h",
};

/** The DeepSeek peak windows the pack assumes: 09–12 and 14–18 MYT. */
const PEAK_WINDOWS: [number, number][] = [
  [9, 12],
  [14, 18],
];

/**
 * The edits the SERVER has staged, read off the rows rather than re-derived.
 *
 * This used to be the screen's one opinion: an action type on a DEGRADED tier
 * should follow that tier's live fallback, one on a tier PAUSED_BY_CAP should
 * follow the head of its fallback chain. The inference was sound and it
 * matched `unsavedChanges` exactly — which is the problem, because it matched
 * by construction. A staged edit that did not come from tier health would have
 * been invisible while the count still said two, and the screen would have
 * been confidently wrong about a change an admin was about to apply.
 *
 * Ruling R12 put `staged` on `RoutingEntry`, so the proposal and the reason
 * for it are both the server's. Nothing is applied: a staged edit reaches a run
 * only through the primary button.
 */
function stagedEdits(entries: RoutingEntry[]): Map<string, TierKey> {
  const staged = new Map<string, TierKey>();
  for (const entry of entries) {
    if (entry.staged) staged.set(entry.actionType, entry.staged.tier);
  }
  return staged;
}

export function AiModelsScreen() {
  const navigate = useNavigate();
  useBreadcrumb([{ label: "Settings" }, { label: "AI Models" }, { label: "Tiers and routing" }]);

  const tiers = useAiTiers();
  const routing = useAiRouting();
  const apply = usePutAiRouting();

  /** Action type → the tier it is staged to move to. Empty once applied. */
  const [staged, setStaged] = useState<Map<string, TierKey>>(new Map());
  const [seeded, setSeeded] = useState(false);

  const tierRows = useMemo(() => tiers.data?.data ?? [], [tiers.data]);
  const routingRows = useMemo(() => routing.data?.data ?? [], [routing.data]);

  useEffect(() => {
    if (seeded || routingRows.length === 0) return;
    setStaged(stagedEdits(routingRows));
    setSeeded(true);
  }, [routingRows, seeded]);

  const degraded = tierRows.find((tier) => tier.status === "DEGRADED");
  const capped = tierRows.find((tier) => tier.status === "PAUSED_BY_CAP");

  const spend = tierRows.reduce((total, tier) => total + (tier.spend?.amount ?? 0), 0);
  const cap = tierRows.reduce((total, tier) => total + (tier.monthlyCap?.amount ?? 0), 0);

  const tierColumns = useMemo<Column<ModelTier>[]>(
    () => [
      {
        key: "tier",
        label: "Tier",
        accessor: (tier) => <TierChip tier={tier.key} model={tier.model} />,
        width: "190px",
      },
      {
        /* Second, not last. The DataTable scrolls horizontally once its columns
           exceed the card, and a reader scanning for "which tier is broken"
           should not have to scroll sideways to find out. */
        key: "status",
        label: "Status",
        accessor: (tier) => (
          <div className="flex flex-col items-start gap-1">
            <StatusChip tone={TIER_STATUS_TONE[tier.status]}>{humanise(tier.status)}</StatusChip>
            {tier.degradation ? (
              <span className="text-[11px] text-ink-muted">
                → {tierLabel(tier.degradation.activeFallback)}
              </span>
            ) : null}
          </div>
        ),
        width: "125px",
      },
      {
        key: "routing",
        label: "Provider routing",
        accessor: (tier) => (
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] text-ink">
              {tier.routing ? humanise(tier.routing) : "—"}
            </span>
            <span className="text-[11px] text-ink-muted">
              {tier.provider ? humanise(tier.provider) : "no provider pinned"}
            </span>
          </div>
        ),
        width: "115px",
      },
      {
        key: "fallback",
        label: "Fallback chain",
        accessor: (tier) =>
          tier.fallbackChain && tier.fallbackChain.length > 0 ? (
            <span className="font-mono text-[11px] text-ink-secondary">
              {tier.fallbackChain.map(tierLabel).join(" → ")}
            </span>
          ) : (
            <span className="text-[12px] text-ink-muted">None</span>
          ),
        width: "125px",
      },
      {
        key: "cache",
        label: "Cache",
        accessor: (tier) => (
          <span className="text-[12px] text-ink-secondary">
            {tier.cacheStrategy ? CACHE_LABEL[tier.cacheStrategy] : "—"}
          </span>
        ),
        width: "95px",
      },
      {
        key: "maxOut",
        label: "Max out",
        align: "right",
        accessor: (tier) => (
          <span className="font-mono tabular-nums">
            {tier.maxOutputTokens?.toLocaleString("en-MY") ?? "—"}
          </span>
        ),
        width: "75px",
      },
      {
        key: "cap",
        label: "Monthly cap",
        accessor: (tier) =>
          tier.monthlyCap && tier.spend ? (
            <BudgetBar
              /* The tier key is already this row's first column; repeating it
                 in the bar label spends sixty pixels saying nothing. */
              label="Spend"
              /* The state is a server fact mapped across, never inferred from
                 the ratio: a tier the server has not paused stays ink however
                 close to its cap it looks. See BudgetBar's own note. */
              budget={{
                spend: tier.spend,
                cap: tier.monthlyCap,
                state: tier.status === "PAUSED_BY_CAP" ? "PAUSED" : "WITHIN",
              }}
            />
          ) : (
            <span className="text-[12px] text-ink-muted">Uncapped</span>
          ),
        width: "145px",
      },
      {
        key: "hours",
        label: "Allowed hours · MYT",
        /* Last on purpose: the strip holds a 220px minimum, so it is the one
           column worth letting scroll off when the viewport is narrow. */
        accessor: (tier) => (
          <AllowedHoursStrip withoutLegend allowed={tier.allowedHours} peak={PEAK_WINDOWS} />
        ),
        width: "240px",
      },
    ],
    [],
  );

  if (tiers.isPending || routing.isPending) {
    return <LoadingState rows={10} label="Loading tiers and routing" />;
  }
  if (tiers.isError) {
    return (
      <ErrorState
        title="The tier table could not be loaded"
        error={tiers.error}
        onRetry={() => void tiers.refetch()}
      />
    );
  }
  if (routing.isError) {
    return (
      <ErrorState
        title="The routing matrix could not be loaded"
        error={routing.error}
        onRetry={() => void routing.refetch()}
      />
    );
  }

  /**
   * The assignment matrix, as kit columns.
   *
   * One column per tier, each holding the radio that routes this action type to
   * it, plus the ladder and the jury. The action type keeps the first column;
   * it is no longer a `<th scope="row">`, because `DataTable` draws data cells
   * and the kit is not this pass's to extend.
   *
   * NO `variant: "code"` anywhere. A tier name and an action type are labels,
   * not machine values — brief §1 keeps mono for refs, versions and hashes.
   */
  const matrixColumns: Column<RoutingEntry>[] = [
    {
      key: "actionType",
      label: "Action type",
      width: "220px",
      accessor: (entry) => {
        const stagedTier = staged.get(entry.actionType);
        return (
          <span className="flex flex-col gap-0.5">
            <span className="text-[13px] text-ink">{humanise(entry.actionType)}</span>
            {stagedTier ? (
              <span className="text-[11px] text-primary-hover">
                staged: {tierLabel(entry.tier)} → {tierLabel(stagedTier)}
              </span>
            ) : null}
          </span>
        );
      },
    },
    ...TIER_KEYS.map((key) => ({
      key,
      label: tierLabel(key),
      width: "72px",
      accessor: (entry: RoutingEntry) => (
        <span className="flex justify-center">
          <input
            type="radio"
            name={`routing-${entry.actionType}`}
            checked={(staged.get(entry.actionType) ?? entry.tier) === key}
            aria-label={`Route ${humanise(entry.actionType)} to ${tierLabel(key)}`}
            onChange={() =>
              setStaged((previous) => {
                const next = new Map(previous);
                if (key === entry.tier) next.delete(entry.actionType);
                else next.set(entry.actionType, key);
                return next;
              })
            }
            className="h-3.5 w-3.5 accent-[rgb(var(--primary))]"
          />
        </span>
      ),
    })),
    {
      key: "escalationLadder",
      label: "Escalation ladder",
      width: "184px",
      accessor: (entry) => (
        <span className="text-[12px] text-ink-secondary">
          {entry.escalationLadder.map(tierLabel).join(" → ")}
        </span>
      ),
    },
    {
      key: "jury",
      label: "Jury",
      width: "148px",
      accessor: (entry) => (
        <div className="flex flex-col items-start gap-1">
          <JuryChip policy={entry.jury} />
          {/* The mode word, because §4 asks this column to render the jury
              OBJECT and not a boolean. The full sentence — quorum, triggers,
              whether it ever blocks — is on the chip's title, from the kit's own
              `describeJuryPolicy`, so the two cannot disagree. */}
          <span className="text-[11px] text-ink-muted">{humanise(entry.jury.mode)}</span>
        </div>
      ),
    },
  ];

  const entriesToApply: RoutingEntry[] = routingRows
    .filter((entry) => staged.has(entry.actionType))
    .map((entry) => ({ ...entry, tier: staged.get(entry.actionType) as TierKey }));
  return (
    <div className="flex flex-col gap-4 pb-10">
      <RecordHeader
        withoutCondensed
        title="AI models"
        meta={[
          `${tierRows.length} tiers`,
          degraded ? "1 degraded" : "none degraded",
          capped ? "1 paused by cap" : "none paused",
        ]}
        actions={
          <>
            <SecondaryButton onClick={() => navigate(PROVIDERS_PATH)}>
              Provider keys
            </SecondaryButton>
            <SecondaryButton onClick={() => navigate(USAGE_PATH)}>Usage</SecondaryButton>
          </>
        }
        primaryAction={
          <PrimaryButton
            disabled={staged.size === 0 || apply.isPending}
            onClick={() => apply.mutate(entriesToApply)}
          >
            Apply to future runs
          </PrimaryButton>
        }
        metrics={[
          {
            label: "Spend this month",
            value: { amount: spend, currency: "MYR" },
            sub: `of ${formatMoney({ amount: cap, currency: "MYR" }, true)} cap`,
            bar: cap === 0 ? 0 : spend / cap,
          },
          {
            label: "Tiers healthy",
            value: `${tierRows.filter((t) => t.status === "HEALTHY").length} of ${tierRows.length}`,
          },
          {
            label: "Action types routed",
            value: routingRows.length,
            sub: "one tier each",
          },
          {
            label: "Live juries",
            value: routingRows.filter((entry) => entry.jury.mode === "ESCALATE").length,
            sub: "escalate mode only",
          },
          {
            label: "Unsaved changes",
            value: staged.size,
            sub: "matrix edits",
          },
        ]}
      />

      {/* One banner. Both facts, because they are one story: the degraded tier
          is why rule extraction moved, and the capped tier is why it cannot
          move back. Outside the matrix's scroll pane, per REPORT.md. */}
      {degraded || capped ? (
        <div className="px-5">
          <ExceptionBanner
            severity="WARN"
            title={
              degraded
                ? `${tierLabel(degraded.key)} degraded · fallback active`
                : `${tierLabel(capped!.key)} paused by cap`
            }
            subtitle={[
              degraded && degraded.degradation
                ? `${degraded.model} is failing with ${degraded.degradation.reason} above threshold; its traffic has run on ${tierLabel(degraded.degradation.activeFallback)} since ${new Date(degraded.degradation.since).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" })}.`
                : null,
              capped
                ? `${tierLabel(capped.key)} has spent its whole monthly cap, so anything routed to it is paused until the cap is raised.`
                : null,
            ]
              .filter(Boolean)
              .join(" ")}
            action={
              <Link className="text-[13px] underline" to={USAGE_PATH}>
                View spend
              </Link>
            }
          />
        </div>
      ) : null}

      {apply.isError ? (
        <div className="px-5">
          <RefusalBanner title="Routing was not applied" error={apply.error} />
        </div>
      ) : null}
      {apply.isSuccess ? (
        <div className="px-5">
          <ExceptionBanner
            severity="INFO"
            title="Applied to future runs"
            subtitle="Runs already in flight keep the tier they resolved when they started. Nothing was re-routed retroactively."
          />
        </div>
      ) : null}

      <div className="px-5">
        <ContentCard
          title="Tiers"
          eyebrow="Infrastructure"
          flush
          actions={
            <span className="text-[12px] text-ink-muted">
              Shaded bands are the provider peak windows, 09–12 and 14–18 MYT. Batch-eligible tiers
              run off-peak only and queue rather than escalate.
            </span>
          }
        >
          <DataTable
            label="Model tiers"
            columns={tierColumns}
            rows={tierRows}
            rowKey={(tier) => tier.key}
            stickyHeader
            /* Tiers are infrastructure the server publishes; this console reads
               them and never creates one, so the empty state carries no action.
               Saying where they come from is the useful half. */
            empty={
              <EmptyState
                title="No model tiers published"
                description="Tiers come from the deployment's own configuration. Until one is published there is nothing for the assignment matrix below to route to."
              />
            }
          />
        </ContentCard>
      </div>

      <div className="px-5">
        <ContentCard
          title="Assignment matrix"
          eyebrow="Policy"
          flush
          actions={
            staged.size > 0 ? (
              <div className="flex items-center gap-2">
                <StatusChip tone="warning" shape="square">
                  {staged.size} unsaved
                </StatusChip>
                <SecondaryButton onClick={() => setStaged(new Map())}>Clear edits</SecondaryButton>
              </div>
            ) : null
          }
        >
          <p className="pb-3 text-[12px] leading-relaxed text-ink-muted">
            One tier per action type. Escalation fires on low confidence and walks the ladder. A
            jury in <strong className="font-medium text-ink-secondary">escalate</strong> mode blocks
            only when a trigger fires — confidence below its floor, value above its ceiling, or a
            first-of-kind action. A <strong className="font-medium text-ink-secondary">gate</strong>{" "}
            jury runs at promotion time against the golden set and never inside a live run, and a{" "}
            <strong className="font-medium text-ink-secondary">sample</strong> jury runs after the
            human has decided and never blocks. That is why nine of these twelve rows show no live
            jury.
          </p>

          {/* The kit's table, not a hand-rolled one. This drew its own `<table>`
              with six mono-caps `<th>`, so it lost the zebra stripe built into
              `DataTable` and put tracked uppercase mono on every heading — half
              of the combination brief §9 names as the thing that reads as
              generated.

              The scroll pane stays: twelve rows by nine tier columns does not
              fit 900px and does not fit the content card either. DataTable's
              own wrapper takes it through `className`.

              The empty state is ui-states', kept through the conversion. It
              moves from a hand-rolled branch around the `<table>` to the kit's
              own `empty` slot, which renders it in the table's place inside the
              same pane — which is exactly what that lane's note said it wanted.

              TWO THINGS THE CONVERSION COSTS, recorded rather than hidden:
              the first column was `position: sticky` and no longer is, because
              the kit has no sticky-column prop and the kit is not this pass's
              to change; and the staged row's `bg-ai-tint` is gone. That tint
              said an AGENT had something to say about the row, and a staged
              edit is a human's — CLAUDE.md reserves the AI hue and the ✦ for
              the agent. The per-row "staged: X → Y" caption and the "N unsaved"
              chip in the card header carry the same fact as a text label, which
              is what the brief asks for anyway. */}
          <DataTable
            label="Action type to tier assignment"
            columns={matrixColumns}
            rows={routingRows}
            rowKey={(entry) => entry.actionType}
            density="compact"
            className="max-h-[440px] overflow-auto rounded-card border border-border"
            empty={
              <EmptyState
                title="Nothing is routed yet"
                description="No action type has been assigned a tier. Until one is, every run falls back to the deployment default rather than to a choice made here."
              />
            }
          />
        </ContentCard>
      </div>
    </div>
  );
}
