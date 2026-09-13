import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { Money, Opportunity, PipelineStage } from "@trainos/contract";
import {
  DateText,
  EmptyState,
  ErrorState,
  formatMoney,
  LoadingState,
  MoneyText,
  RecordHeader,
  SecondaryButton,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { toApiError, useOrganisationDirectory } from "@/shared/api";
import { cn } from "@/shared/lib/utils";
import { useOpportunities, usePipelineStages } from "./api";

/**
 * Sales › Pipeline. No artboard — the pack draws no board anywhere — so this is
 * the Collections composition turned on its side: title and a real count line,
 * then the work, with hierarchy carried by spacing and one hairline per column
 * rather than by a card per deal.
 *
 * THE COLUMNS ARE CONFIGURATION. CLAUDE.md's standing rule, verbatim: "Stage
 * names and order render from pipeline configuration, never hardcoded." So the
 * columns come from `GET /v1/config/pipelines?object=OPPORTUNITY`, sorted by
 * the `order` the server sends, and there is no stage list in this file. A
 * tenant that renames `TNA_SENT` or inserts a stage between two others gets a
 * different board and no code moves.
 *
 * A stage holding nothing still gets a column. The empty stage is the one a
 * sales manager most wants to see, and a board that drops it draws a pipeline
 * that looks healthier than it is.
 *
 * No status chip on a card: the column the card sits in IS its stage, and a
 * chip repeating it would spend accent on a fact the layout already states.
 * That is also what keeps this screen inside the 5–15% blue budget — the only
 * blue on it is the focus ring and the hover surface.
 *
 * The board and `/sales/leads` are two arrangements of one object, not two
 * visual languages: the stage labels, the money treatment and the organisation
 * resolution are the same on both.
 */

/** The fold used for a column's total and for the board's. One currency. */
function sum(rows: Opportunity[]): Money | null {
  return rows.reduce<Money | null>(
    (total, row) =>
      total ? { amount: total.amount + row.value.amount, currency: total.currency } : row.value,
    null,
  );
}

export function PipelineBoardPage() {
  useBreadcrumb([{ label: "Sales" }, { label: "Pipeline" }]);

  const navigate = useNavigate();
  const stages = usePipelineStages();
  const opportunities = useOpportunities();
  const directory = useOrganisationDirectory();

  const rows = useMemo(() => opportunities.data?.data ?? [], [opportunities.data]);

  const columns: { stage: PipelineStage; rows: Opportunity[] }[] = useMemo(() => {
    const ordered = [...(stages.data?.stages ?? [])].sort(
      (left, right) => left.order - right.order,
    );
    return ordered.map((stage) => ({
      stage,
      rows: rows.filter((row) => row.stage === stage.key),
    }));
  }, [stages.data, rows]);

  const boardTotal = useMemo(() => sum(rows), [rows]);

  /* A deal whose stage the configuration does not name. It must be visible:
     silently dropping it would make the board's total disagree with the count
     in its own header, and nobody would know which deal went missing. R14. */
  const unplaced = useMemo(() => {
    const known = new Set((stages.data?.stages ?? []).map((stage) => stage.key));
    return stages.data ? rows.filter((row) => !known.has(row.stage)) : [];
  }, [stages.data, rows]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border">
        <RecordHeader
          withoutCondensed
          title="Pipeline"
          meta={[
            opportunities.data ? `${opportunities.data.page.total} open` : null,
            boardTotal ? `${formatMoney(boardTotal, true)} in play` : null,
            stages.data ? `${stages.data.stages.length} configured stages` : null,
          ]}
          actions={
            <SecondaryButton onClick={() => navigate("/sales/leads")}>
              Open as a list
            </SecondaryButton>
          }
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-5 py-5">
        {stages.isPending || opportunities.isPending ? (
          <LoadingState rows={6} label="Loading the pipeline" />
        ) : null}

        {stages.isError ? (
          <ErrorState
            title="The stage configuration did not load"
            description="The board's columns are pipeline configuration. Without it there is no board to draw, and guessing the stages would draw a pipeline this tenant does not have."
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

        {stages.data && opportunities.data ? (
          stages.data.stages.length === 0 ? (
            <EmptyState
              title="No stages are configured"
              description="This tenant's opportunity pipeline has no stages, so there is no board to draw. Configure the pipeline in Settings."
            />
          ) : rows.length === 0 ? (
            <EmptyState
              title="Nothing in the pipeline"
              description="No opportunity is open. An accepted enquiry becomes the first card here."
            />
          ) : (
            <>
              <ol aria-label="Pipeline stages" className="flex min-w-full items-start gap-4 pb-2">
                {columns.map(({ stage, rows: cards }) => (
                  <StageColumn
                    key={stage.key}
                    stage={stage}
                    cards={cards}
                    nameOf={directory.nameOf}
                    onOpen={(row) => navigate(`/sales/organisations/${row.organisationRef}`)}
                  />
                ))}
              </ol>

              {unplaced.length > 0 ? (
                <div className="pt-5">
                  <ErrorState
                    title="Some deals sit at a stage the configuration does not name"
                    description={`${unplaced.map((row) => row.ref).join(", ")} — the board cannot place them, and dropping them would make its total disagree with its own count.`}
                  />
                </div>
              ) : null}
            </>
          )
        ) : null}
      </div>
    </div>
  );
}

/**
 * One configured stage.
 *
 * The column header carries the label, the count and the money in the column —
 * the three things a sales manager reads before any card. Sentence case and the
 * UI font per tightening brief §1; the numbers are tabular, not mono.
 */
function StageColumn({
  stage,
  cards,
  nameOf,
  onOpen,
}: {
  stage: PipelineStage;
  cards: Opportunity[];
  nameOf: (ref: string) => string;
  onOpen: (row: Opportunity) => void;
}) {
  const total = sum(cards);

  return (
    <li className="flex w-[264px] shrink-0 flex-col gap-3">
      <div className="flex flex-col gap-1 border-b border-border pb-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[13px] font-semibold text-ink">{stage.label}</h2>
          <span className="text-[12px] tabular-nums text-ink-muted">{cards.length}</span>
        </div>
        <p className="text-[12px] tabular-nums text-ink-muted">
          {total ? formatMoney(total, true) : "—"}
        </p>
      </div>

      {cards.length === 0 ? (
        /* Not an `EmptyState`: that component is the answer for a whole
           collection, and a 264px column would render it as a page-sized void
           beside five columns of content. One muted line says the same thing. */
        <p className="px-1 text-[12px] text-ink-muted">Nothing at this stage</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {cards.map((card) => (
            <li key={card.ref}>
              <DealCard
                card={card}
                organisationName={nameOf(card.organisationRef)}
                onOpen={onOpen}
              />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * One deal. Three layers, like every other row in this product (§16): the
 * client is the strongest line, money is typography in a fixed position rather
 * than a badge, and the machine values are muted and mono.
 */
function DealCard({
  card,
  organisationName,
  onOpen,
}: {
  card: Opportunity;
  organisationName: string;
  onOpen: (row: Opportunity) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(card)}
      className={cn(
        "flex w-full flex-col gap-1.5 rounded-panel border border-border bg-card px-3 py-2.5 text-left",
        "hover:bg-surface-hover",
      )}
    >
      <span className="flex items-baseline gap-2">
        <span className="truncate text-[14px] font-semibold text-ink">{organisationName}</span>
        <MoneyText value={card.value} compact className="ml-auto shrink-0 text-[13px] text-ink" />
      </span>

      <span className="flex items-baseline gap-2 font-mono text-[11px] text-ink-muted">
        <span>{card.ref}</span>
        {card.expectedCloseDate ? (
          <span className="ml-auto shrink-0">
            <DateText value={card.expectedCloseDate} />
          </span>
        ) : null}
      </span>

      <span className="flex items-baseline gap-2 text-[12px] text-ink-secondary">
        <span className="truncate">{card.owner.name}</span>
        {typeof card.probability === "number" ? (
          <span className="ml-auto shrink-0 tabular-nums text-ink-muted">
            {`${Math.round(card.probability * 100)}%`}
          </span>
        ) : null}
      </span>
    </button>
  );
}
