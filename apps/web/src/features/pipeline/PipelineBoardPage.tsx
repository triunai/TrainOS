import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { Money, Opportunity, PipelineStage, Tna } from "@trainos/contract";
import {
  ActionOutcome,
  EmptyState,
  ErrorState,
  KanbanBoard,
  LoadingState,
  RecordHeader,
  RowActionMenu,
  SecondaryButton,
  formatMoney,
  humanise,
  lanesFrom,
  plural,
  type KanbanLane,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { toApiError, useOrganisationDirectory } from "@/shared/api";
import { cn } from "@/shared/lib/utils";
import { useMoveDealStage, useOpportunities, usePipelineStages, useTnas } from "./api";

/**
 * Sales › Pipeline.
 *
 * Brief §19, the user's ruling of 13 Sep, which withdrew most of what the first
 * build did. Four things changed and each was a defect rather than a taste:
 *
 * THE BOARD NO LONGER FITS. Seven stages were being squeezed into 1440px at
 * 240px a column, and every company name on the screen was truncated. The
 * company name is the first thing a sales manager reads, so the lanes are 300px
 * and the board scrolls sideways instead.
 *
 * THE ENCLOSING CARD IS GONE. The board IS the workspace: breadcrumb, header,
 * one summary line, then the lanes on the page surface. A card around the board
 * drew a border around the entire viewport and bought nothing.
 *
 * THE CARDS ARE SALES CARDS. Company, then what the work is, then the money
 * large, then who owns it, then when it closes and how likely. `OPP-0498` is
 * the last line in muted mono — it is how the system names the deal, not how a
 * person does, and it was previously the second thing on the card.
 *
 * A LANE IS A PLACE TO PUT SOMETHING. The lane surface runs to the bottom of the
 * viewport because it is the drop target, and the empty lane says "No deals" and
 * "Drop a deal here" rather than one muted line of apology.
 *
 * WHAT DID NOT CHANGE: the lanes are still configuration. CLAUDE.md's standing
 * rule, verbatim — "Stage names and order render from pipeline configuration,
 * never hardcoded" — so the lanes come from `GET /v1/config/pipelines`, sorted
 * by the `order` the server sends, and there is no stage list in this file.
 * `terminal` and `outcome` now arrive with them (ruling R16), so the board can
 * say which stages END the pipeline instead of inferring it from `order` and
 * putting Lost after Won rather than beside it.
 */

/** The fold used for a lane's total, for the board's, and for the weighting. */
function sum(rows: Opportunity[], weight: (row: Opportunity) => number = () => 1): Money | null {
  return rows.reduce<Money | null>((total, row) => {
    const amount = Math.round(row.value.amount * weight(row));
    return total
      ? { amount: total.amount + amount, currency: total.currency }
      : { amount, currency: row.value.currency };
  }, null);
}

/**
 * What the deal is FOR, in one line.
 *
 * There is no programme on an `Opportunity` and no topic either — §5 gives it a
 * client, a stage, a value, an owner and a date. The nearest true answer is the
 * TNA's highest-priority gap, which is the sentence the client themselves gave
 * for why they are buying; failing that, the audience the TNA describes. A deal
 * with neither gets NO second line rather than a composed one. Two of the five
 * seeded deals are in that position and they render short, which is the honest
 * outcome — inventing "Training programme" for them would make the card look
 * complete while telling the reader nothing.
 */
function topicOf(opportunity: Opportunity, tnas: Tna[]): string | null {
  const tna = tnas.find((row) => row.opportunityRef === opportunity.ref);
  if (!tna) return null;

  const ranked = ["HIGH", "MEDIUM", "LOW"];
  const gap = [...tna.gaps].sort(
    (left, right) => ranked.indexOf(left.priority) - ranked.indexOf(right.priority),
  )[0];
  if (gap) return gap.name;

  const { headcount, level } = tna.audience;
  return level ? `${headcount} ${humanise(level).toLowerCase()}s` : null;
}

export function PipelineBoardPage() {
  useBreadcrumb([{ label: "Sales" }, { label: "Pipeline" }]);

  const navigate = useNavigate();
  const stages = usePipelineStages();
  const opportunities = useOpportunities();
  const tnas = useTnas();
  const directory = useOrganisationDirectory();
  const stageChange = useMoveDealStage();

  const rows = useMemo(() => opportunities.data?.data ?? [], [opportunities.data]);
  const tnaRows = useMemo(() => tnas.data?.data ?? [], [tnas.data]);

  const ordered = useMemo(
    () => [...(stages.data?.stages ?? [])].sort((left, right) => left.order - right.order),
    [stages.data],
  );

  const grouped = useMemo(() => lanesFrom(ordered, rows, (row) => row.stage), [ordered, rows]);

  const byKey = useMemo(() => new Map(ordered.map((stage) => [stage.key, stage])), [ordered]);

  /* The summary line. Every number is a fold over the SAME array, so they
     cannot disagree with each other or with the lanes. */
  const summary = useMemo(() => {
    if (!stages.data || !opportunities.data) return null;

    const open = rows.filter((row) => !byKey.get(row.stage)?.terminal);
    const outcome = (which: string) =>
      rows.filter((row) => byKey.get(row.stage)?.outcome === which).length;

    const total = sum(rows);
    /* Probability-weighted, over every deal on the board. A deal with no
       probability counts at its full value rather than at zero — the field is
       optional in §5, and reading "absent" as "0%" would quietly shrink the
       forecast by however many deals nobody had scored yet. */
    const weighted = sum(rows, (row) => row.probability ?? 1);

    return [
      plural(opportunities.data.page.total, "deal"),
      total ? `${formatMoney(total, true)} pipeline` : null,
      weighted ? `${formatMoney(weighted, true)} weighted` : null,
      `${open.length} active`,
      outcome("WON") > 0 ? `${outcome("WON")} won` : null,
      outcome("LOST") > 0 ? `${outcome("LOST")} lost` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }, [stages.data, opportunities.data, rows, byKey]);

  /* A deal whose stage the configuration does not name. It must be visible:
     silently dropping it would make the board's total disagree with the count
     in its own header, and nobody would know which deal went missing. R14. */
  const unplaced = useMemo(() => {
    if (!stages.data) return [];
    return rows.filter((row) => !byKey.has(row.stage));
  }, [stages.data, rows, byKey]);

  const moveTo = useCallback(
    (ref: string, toStageKey: string) => {
      const opportunity = rows.find((row) => row.ref === ref);
      const to = byKey.get(toStageKey);
      if (!opportunity || !to) return;
      stageChange.move({ opportunity, to });
    },
    [rows, byKey, stageChange],
  );

  const lanes: KanbanLane<Opportunity>[] = grouped.map(({ stage, items }) => ({
    id: stage.key,
    label: stage.label,
    summary: `${plural(items.length, "deal")} · ${sum(items) ? formatMoney(sum(items) as Money, true) : "—"}`,
    items,
    /* Only a stage that ENDS the pipeline may fold away, and only when it holds
       nothing worth the 300px. `terminal` is configuration; the board never
       decides for itself that Won and Lost are the last two. */
    collapsible: stage.terminal,
    defaultCollapsed: stage.terminal && items.length === 0,
  }));

  const pending = stages.isPending || opportunities.isPending;
  const ready = Boolean(stages.data && opportunities.data);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RecordHeader
        withoutCondensed
        title="Pipeline"
        actions={
          <SecondaryButton onClick={() => navigate("/sales/leads")}>List view</SecondaryButton>
        }
      />

      {/* The summary line, in UI type. Not a metric strip and not "7 configured
          stages": the number of lanes is visible by counting them, and a board
          that reports its own configuration size is reporting on itself. */}
      {summary ? (
        <p className="px-5 pb-3 text-[13px] tabular-nums text-ink-secondary">{summary}</p>
      ) : null}

      {stageChange.subject ? (
        <div className="px-5 pb-3">
          <ActionOutcome
            subject={stageChange.subject}
            {...(stageChange.response ? { response: stageChange.response } : {})}
            {...(stageChange.error ? { error: stageChange.error } : {})}
            onDismiss={stageChange.dismiss}
          />
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 pb-5">
        {pending ? <LoadingState rows={6} label="Loading the pipeline" /> : null}

        {stages.isError ? (
          <ErrorState
            title="The stage configuration did not load"
            description="The board's lanes are pipeline configuration. Without it there is no board to draw, and guessing the stages would draw a pipeline this tenant does not have."
            error={toApiError(stages.error)}
            onRetry={() => void stages.refetch()}
          />
        ) : null}

        {opportunities.isError ? (
          <ErrorState
            title="The opportunities did not load"
            error={toApiError(opportunities.error)}
            onRetry={() => void opportunities.refetch()}
          />
        ) : null}

        {ready && ordered.length === 0 ? (
          <EmptyState
            title="No stages are configured"
            description="This tenant's opportunity pipeline has no stages, so there is no board to draw. Configure the pipeline in Settings."
          />
        ) : null}

        {ready && ordered.length > 0 ? (
          <KanbanBoard<Opportunity>
            label="Pipeline stages"
            lanes={lanes}
            itemKey={(deal) => deal.ref}
            emptyLabel="No deals"
            emptyHint="Drop a deal here"
            onMove={(ref, _from, to) => moveTo(ref, to)}
            renderItem={(deal, lane) => (
              <DealCard
                deal={deal}
                organisationName={directory.nameOf(deal.organisationRef)}
                topic={topicOf(deal, tnaRows)}
                stages={ordered}
                currentStageKey={lane.id}
                onOpen={() => navigate(`/sales/organisations/${deal.organisationRef}`)}
                onMove={(toStageKey) => moveTo(deal.ref, toStageKey)}
              />
            )}
          />
        ) : null}

        {unplaced.length > 0 ? (
          <ErrorState
            title="Some deals sit at a stage the configuration does not name"
            description={`${unplaced.map((row) => row.ref).join(", ")} — the board cannot place them, and dropping them would make its total disagree with its own count.`}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * One deal, read the way a sales manager reads one.
 *
 * The order is the ruling's order and it is an argument about what matters:
 * WHO, then WHAT FOR, then HOW MUCH, then WHOSE, then WHEN and HOW LIKELY, then
 * the reference. The company name wraps to two lines rather than truncating,
 * which is the whole reason the lane is 300px.
 *
 * No status chip. The lane the card sits in IS its stage, and a chip repeating
 * it would spend accent on a fact the layout already states — which is also
 * what keeps this screen inside the 5–15% blue budget.
 *
 * THE MENU IS NOT A CONVENIENCE. A pointer drag is unreachable by keyboard and
 * by most assistive technology, so the same move has to exist somewhere a Tab
 * and an Enter can find it. That is what the stage list in the row menu is for,
 * and it is built from the same configuration the lanes are.
 */
function DealCard({
  deal,
  organisationName,
  topic,
  stages,
  currentStageKey,
  onOpen,
  onMove,
}: {
  deal: Opportunity;
  organisationName: string;
  topic: string | null;
  stages: PipelineStage[];
  currentStageKey: string;
  onOpen: () => void;
  onMove: (toStageKey: string) => void;
}) {
  return (
    <div
      className={cn(
        "relative rounded-panel bg-card px-3 py-3",
        /* One border, because a card on a tinted lane surface with no edge
           reads as a paragraph of the lane rather than an object you can pick
           up — which is precisely the ambiguity CLAUDE.md keeps a border for. */
        "border border-border hover:bg-surface-hover",
      )}
    >
      <div className="flex items-start gap-1">
        <button
          type="button"
          onClick={onOpen}
          /* The whole card is the target; the menu sits above it in the stack.
             `text-left` because a button centres its label by default and this
             one is a paragraph. */
          className="min-w-0 flex-1 text-left after:absolute after:inset-0 after:content-['']"
        >
          <span className="block text-[14px] font-semibold leading-snug text-ink">
            {organisationName}
          </span>
        </button>

        <div className="relative z-10 shrink-0">
          <RowActionMenu
            label={organisationName}
            /* `RowActionMenu` hides itself until its `tr` is hovered, and this
               card is not a table row — so without this the one keyboard route
               to a stage change would be permanently invisible. On a card there
               is room to show it, and showing it is what tells a reader the
               move exists at all. */
            className="opacity-100"
            actions={stages
              .filter((stage) => stage.key !== currentStageKey)
              .map((stage) => ({
                label: `Move to ${stage.label}`,
                onSelect: () => onMove(stage.key),
              }))}
          />
        </div>
      </div>

      {topic ? (
        <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-ink-secondary">{topic}</p>
      ) : null}

      {/* The money is the largest thing after the name, in tabular numerals and
          in the UI font. Not a badge and not mono: §1 puts numbers in Inter with
          `tabular-nums`, and a badge would spend a chip on a value that is not
          a status. */}
      <p className="mt-2 text-[17px] font-semibold tabular-nums leading-none text-ink">
        {formatMoney(deal.value, true)}
      </p>

      <p className="mt-2 truncate text-[12px] text-ink-secondary">{deal.owner.name}</p>

      <div className="mt-1 flex items-baseline justify-between gap-2 text-[12px] tabular-nums text-ink-muted">
        <span className="truncate">
          {deal.expectedCloseDate ? formatCloseDate(deal.expectedCloseDate) : "No close date"}
        </span>
        {typeof deal.probability === "number" ? (
          <span className="shrink-0">{`${Math.round(deal.probability * 100)}%`}</span>
        ) : null}
      </div>

      {/* Demoted, per the ruling. The reference is how the SYSTEM names the
          deal; it belongs where a person looks only when they need to quote it
          to somebody else. */}
      <p className="mt-2 font-mono text-[11px] text-ink-muted">{deal.ref}</p>
    </div>
  );
}

/**
 * "Closes 19 Dec 2026".
 *
 * `DateText` renders the date alone, and a bare date on a card with an owner
 * above it and a percentage beside it is four characters of context short — the
 * reader has to work out which of a deal's several dates this one is.
 */
function formatCloseDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return `Closes ${parsed.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })}`;
}
