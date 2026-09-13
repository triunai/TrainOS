import { useMemo, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import type {
  ActionRequest,
  ActionResponse,
  FloorPriceBreachDetails,
  Money,
  Quotation,
  QuotationApplyPayload,
  QuotationLine,
} from "@trainos/contract";
import { RATE_CARD_PLACEHOLDER_VERSION } from "@trainos/contract";
import {
  BINDING_FLOOR_TONE,
  DataTable,
  EmptyState,
  ErrorState,
  ExceptionBanner,
  formatMoney,
  GhostButton,
  humanise,
  LoadingState,
  MiniBar,
  MoneyInput,
  MoneyText,
  PrimaryButton,
  QUOTATION_TONE,
  RecordHeader,
  RefusalBanner,
  SecondaryButton,
  StatusChip,
  type Column,
  type MetricCellProps,
  PartialDataBanner,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { isDomainError, isNotDeployed, notDeployedState, toApiError } from "@/shared/api";
import { useMe } from "@/shared/hooks/useMe";
import {
  type ActionPayload,
  floorBreachOf,
  useApplyQuotation,
  useQuotation,
  useRateCard,
  useSaveQuotation,
} from "./api";
import { PROPOSAL_BUILDER_PATH, QUOTATIONS_LIST_PATH } from "./paths";

/**
 * M07-S03 · Quotation and costing worksheet.
 *
 * Costing is deterministic. No agent sets a price here, so the screen carries
 * no AI surface at all — the Proposal Agent reads this worksheet, it does not
 * write it.
 *
 * The screen's whole job is to make the two floors legible. A quotation is
 * checked against the programme's absolute tier floor AND the margin floor
 * derived from direct cost, and the HIGHER of the two binds; clearing one while
 * breaching the other is still a breach. The worksheet therefore shows both and
 * names which one is doing the work, rather than showing a single number the
 * reader cannot reason about.
 */

const marginOf = (sellPrice: Money, directCost: Money): number =>
  sellPrice.amount === 0 ? 0 : (sellPrice.amount - directCost.amount) / sellPrice.amount;

export function CostingWorksheetPage() {
  /* Declared, not drawn. Ends at the list — RecordHeader owns the identity. */
  useBreadcrumb([{ label: "Finance" }, { label: "Quotations", href: QUOTATIONS_LIST_PATH }]);

  const { quotationRef } = useParams<{ quotationRef: string }>();
  const { me } = useMe();

  const quotationQuery = useQuotation(quotationRef);
  const rateCardQuery = useRateCard();
  const quotation = quotationQuery.data;

  const save = useSaveQuotation(quotation?.ref);
  const apply = useApplyQuotation(quotation?.ref);

  const [proposed, setProposed] = useState<Money | null>(null);
  const [applied, setApplied] = useState<ActionResponse | null>(null);

  const breach = useMemo<FloorPriceBreachDetails | null>(
    () => floorBreachOf(apply.error) ?? floorBreachOf(save.error),
    [apply.error, save.error],
  );

  if (quotationQuery.isPending) return <LoadingState label="Loading the costing worksheet" />;

  if (isNotDeployed(quotationQuery.error)) {
    return <EmptyState {...notDeployedState("This costing worksheet")} />;
  }

  if (quotationQuery.isError || !quotation) {
    /* `ErrorState` withholds "Try again" on a domain refusal itself, now that
       it is handed the error rather than a string flattened out of it. The
       FORBIDDEN branch only has to change the title. */
    const error = toApiError(quotationQuery.error);
    return (
      <ErrorState
        title={
          isDomainError(error) && error.code === "FORBIDDEN"
            ? "Pricing is not yours to see"
            : "Could not load this costing"
        }
        error={error}
        onRetry={() => void quotationQuery.refetch()}
      />
    );
  }

  const candidate = proposed ?? quotation.sellPrice;
  const candidateMargin = marginOf(candidate, quotation.directCost);
  const belowFloor = candidate.amount < quotation.floorPrice.amount;

  const applyRequest = (sellPrice: Money): ActionRequest => ({
    type: "QUOTATION_APPLY",
    targetRef: quotation.ref,
    payload: { sellPrice } satisfies ActionPayload<QuotationApplyPayload>,
    requestedBy: { id: me.id, name: me.name, kind: "HUMAN" },
  });

  const onApply = () => {
    apply.mutate(applyRequest(candidate), {
      onSuccess: (response) => setApplied(response),
    });
  };

  return (
    <div className="flex flex-col">
      {/* No wrapping ContentCard and no inline <Breadcrumb>. The card's border
          landed 1px inside the shell card's, and the trail belongs to the top
          bar — BreadcrumbProvider exists so a screen declares the path rather
          than drawing it. RecordHeader brings the pack's 20px gutter with it,
          which the bare `flex flex-col gap-4` root did not have. Same shape as
          the engagement and invoice detail screens. */}
      <RecordHeader
        /* §15a. The ref moves out of the h1 into `recordRef` — CLAUDE.md gives
           the mono identity line the refs and the title the record's name. */
        accent
        collapsible
        recordType="costing"
        title="Costing worksheet"
        recordRef={quotation.ref}
        meta={[
          quotation.proposalRef,
          `${quotation.lines.length} cost lines`,
          /* DECISIONS §5: until Finance supplies numbers the card is a
               placeholder, and every screen priced against it must say so. */
          rateCardQuery.data?.version === RATE_CARD_PLACEHOLDER_VERSION
            ? "rate card v0 · placeholder"
            : rateCardQuery.data
              ? `rate card ${rateCardQuery.data.version}`
              : null,
        ]}
        chips={
          <>
            <StatusChip tone={QUOTATION_TONE[quotation.status]}>
              {humanise(quotation.status)}
            </StatusChip>
            <StatusChip tone={BINDING_FLOOR_TONE[quotation.bindingFloorBasis]}>
              {quotation.bindingFloorBasis === "MARGIN" ? "Margin floor binds" : "Tier floor binds"}
            </StatusChip>
          </>
        }
        actions={
          <>
            <GhostButton type="button">Rate card</GhostButton>
            <SecondaryButton
              type="button"
              disabled={save.isPending || proposed === null}
              onClick={() => proposed && save.mutate({ sellPrice: proposed })}
            >
              {save.isPending ? "Saving…" : "Save"}
            </SecondaryButton>
          </>
        }
        primaryAction={
          <PrimaryButton type="button" disabled={apply.isPending} onClick={onApply}>
            {apply.isPending ? "Applying…" : "Apply to proposal"}
          </PrimaryButton>
        }
        metrics={metricsFor(quotation, candidate, candidateMargin)}
      />

      {/* DECISIONS §5 makes the rate card's version load-bearing: every screen
          priced against the placeholder card must SAY it is a placeholder. A
          failed read dropped the meta entry entirely, so a worksheet priced
          against an unknown card looked exactly like one priced against a real
          one. */}
      <PartialDataBanner
        className="mx-5 mb-4"
        reads={[
          {
            label: "The rate card this costing is priced against",
            error: rateCardQuery.isError ? toApiError(rateCardQuery.error) : null,
            retry: () => void rateCardQuery.refetch(),
          },
        ]}
      />

      <ApplyOutcome response={applied} proposalRef={quotation.proposalRef} />

      {breach ? <FloorBreachBanner breach={breach} /> : null}

      {apply.isError && !breach ? (
        <div className="px-5 pb-4">
          <RefusalBanner title="The price was not applied" error={toApiError(apply.error)} />
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 border-t border-divider px-5 py-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-2">
            <h2 className="text-[13px] font-semibold text-ink">Cost lines</h2>
            <CostLinesTable quotation={quotation} />
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-[13px] font-semibold text-ink">Discount</h2>
            {/* Both prices side by side on purpose: the error state is only
                  readable next to the price that does not have it. */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <MoneyInput
                label="Proposed price"
                value={candidate}
                onChange={setProposed}
                {...(belowFloor
                  ? {
                      errorText: `Below the ${formatMoney(quotation.floorPrice)} ${
                        quotation.bindingFloorBasis === "MARGIN" ? "margin" : "tier"
                      } floor — margin would fall to ${Math.round(candidateMargin * 100)}%. Applying it needs a discount approval under APV-02.`,
                    }
                  : { hint: `Margin ${Math.round(candidateMargin * 100)}% · above the floor` })}
              />
              <MoneyInput
                label="List price"
                value={quotation.sellPrice}
                onChange={() => undefined}
                disabled
                hint={`Applied to ${quotation.proposalRef}`}
              />
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-2">
            <h2 className="text-[13px] font-semibold text-ink">Margin</h2>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between">
                <span className="text-[18px] font-semibold text-ink">
                  {Math.round(candidateMargin * 100)}%
                </span>
                <span className="text-[11px] text-ink-muted">
                  <MoneyText
                    value={{
                      amount: candidate.amount - quotation.directCost.amount,
                      currency: candidate.currency,
                    }}
                  />{" "}
                  gross
                </span>
              </div>
              {/* The floor is a point on the track, not a caption floating in
                    the middle of it. A label at 50% while the floor is at 35%
                    is the kind of small lie a margin gauge cannot afford. */}
              <div className="relative">
                <MiniBar
                  label="Margin against the floor"
                  value={candidateMargin}
                  state={belowFloor ? "over" : "within"}
                  size="md"
                  valueText={`${Math.round(candidateMargin * 100)} percent, floor ${Math.round(quotation.floorMarginRate * 100)} percent`}
                />
                <span
                  aria-hidden="true"
                  style={{ left: `${quotation.floorMarginRate * 100}%` }}
                  className="absolute top-0 h-1.5 w-px -translate-x-1/2 bg-ink"
                />
              </div>
              <div className="relative h-4 text-[11px] text-ink-muted">
                <span className="absolute left-0">0%</span>
                <span
                  style={{ left: `${quotation.floorMarginRate * 100}%` }}
                  className="absolute -translate-x-1/2 whitespace-nowrap"
                >
                  floor {Math.round(quotation.floorMarginRate * 100)}%
                </span>
                <span className="absolute right-0">100%</span>
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-[13px] font-semibold text-ink">Floors</h2>
            <div>
              <Row
                label="Absolute floor · programme tier"
                value={<MoneyText value={quotation.absoluteFloorPrice} />}
              />
              <Row
                label={`Margin floor · cost ÷ (1 − ${quotation.floorMarginRate})`}
                value={<MoneyText value={quotation.marginFloorPrice} />}
              />
              <Row
                label={<span className="font-medium text-ink">Binding floor</span>}
                value={
                  <span className="flex items-center gap-2">
                    <MoneyText value={quotation.floorPrice} />
                    <StatusChip tone={BINDING_FLOOR_TONE[quotation.bindingFloorBasis]}>
                      {humanise(quotation.bindingFloorBasis)}
                    </StatusChip>
                  </span>
                }
              />
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-[13px] font-semibold text-ink">Commission</h2>
            <div>
              <Row label="Rate" value={`${Math.round(quotation.commissionRate * 100)}% of sell`} />
              <Row label="Amount" value={<MoneyText value={quotation.commission} />} />
              <Row label="Payable" value={humanise(quotation.commissionPayableOn).toLowerCase()} />
              {quotation.display?.perPax ? (
                <Row
                  label="Per participant"
                  value={<MoneyText value={quotation.display.perPax} />}
                />
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function metricsFor(
  quotation: Quotation,
  candidate: Money,
  candidateMargin: number,
): MetricCellProps[] {
  return [
    { label: "Sell price", value: candidate },
    { label: "Direct cost", value: quotation.directCost },
    {
      label: "Margin",
      value: `${Math.round(candidateMargin * 100)}%`,
      sub: `floor ${Math.round(quotation.floorMarginRate * 100)}%`,
    },
    {
      label: "Commission",
      value: quotation.commission,
      sub: `${Math.round(quotation.commissionRate * 100)}% on collection`,
    },
    ...(quotation.display?.perPax
      ? [{ label: "Per participant", value: quotation.display.perPax } as MetricCellProps]
      : []),
  ];
}

function Row({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-divider py-1.5 text-[12px] last:border-b-0">
      <span className="text-ink-secondary">{label}</span>
      <span className="font-medium text-ink">{value}</span>
    </div>
  );
}

/* ---- Outcomes -------------------------------------------------------- */

function ApplyOutcome({
  response,
  proposalRef,
}: {
  response: ActionResponse | null;
  proposalRef: string;
}) {
  if (!response) return null;

  if (response.status === "QUEUED_FOR_APPROVAL") {
    return (
      <div className="px-5 pb-4">
        <ExceptionBanner
          severity="INFO"
          title={`Queued for approval as ${response.approvalRequest.ref}`}
          subtitle={`Policy ${response.approvalRequest.policyId} holds this price until ${response.approvalRequest.approverRole} decides.`}
        />
      </div>
    );
  }

  if (response.status === "SUGGESTED") {
    return (
      <div className="px-5 pb-4">
        <ExceptionBanner
          severity="INFO"
          title="Returned as a draft"
          subtitle={response.draft.body}
        />
      </div>
    );
  }

  return (
    <div className="px-5 pb-4">
      <ExceptionBanner
        severity="INFO"
        title={`Applied to ${proposalRef}`}
        subtitle={response.result.effects.map((effect) => effect.description).join(" · ")}
        action={
          <SecondaryButton
            type="button"
            onClick={() => {
              globalThis.location.assign(PROPOSAL_BUILDER_PATH(proposalRef));
            }}
          >
            Open the proposal
          </SecondaryButton>
        }
      />
    </div>
  );
}

/**
 * The refusal, rendered as the fact it is. `FLOOR_PRICE_BREACH` names the
 * binding floor, the margin the price would yield and the policy that could
 * still let it through, so the banner says all three rather than "invalid".
 */
function FloorBreachBanner({ breach }: { breach: FloorPriceBreachDetails }) {
  /* The refusal names its own binding basis now (§6), so the banner no longer
     needs the quotation at all. It had been falling back to the stored basis,
     which belongs to the price the user has just replaced — the one case where
     the two can disagree is exactly the case the banner is rendered for. */
  const basis = breach.bindingFloorBasis;
  return (
    <div className="px-5 pb-4">
      <ExceptionBanner
        severity="DANGER"
        title={`Below the ${formatMoney(breach.floorPrice)} floor`}
        subtitle={`The ${basis === "MARGIN" ? "margin" : "tier"} floor binds here and the price would yield ${Math.round(breach.resultingMarginRate * 100)}% margin. Policy ${breach.requiresPolicy} can still approve it as a discount.`}
      />
    </div>
  );
}

/* ---- Cost lines ------------------------------------------------------ */

/** `2 days`, `1 trip`, `30`. The unit is a contract enum, so it pluralises here. */
function quantityText(line: QuotationLine): string {
  if (!line.unit) return String(line.qty);
  const unit = humanise(line.unit).toLowerCase();
  return `${line.qty} ${line.qty === 1 ? unit : `${unit}s`}`;
}

function CostLinesTable({ quotation }: { quotation: Quotation }) {
  const columns: Column<QuotationLine>[] = [
    {
      key: "item",
      label: "Item",
      accessor: (line) => (
        <div>
          <div className="text-ink">{humanise(line.item)}</div>
          {line.detail ? <div className="text-[11px] text-ink-muted">{line.detail}</div> : null}
        </div>
      ),
    },
    {
      key: "qty",
      label: "Qty",
      align: "right",
      /* A zero-quantity line is the client-site venue. It stays visible with an
         explicit zero rather than being dropped — the absence of a venue cost
         is a fact the approver needs. */
      accessor: (line) => (line.qty === 0 ? "—" : quantityText(line)),
    },
    {
      key: "rate",
      label: "Rate",
      align: "right",
      accessor: (line) => (line.rate ? <MoneyText value={line.rate} /> : "—"),
    },
    {
      key: "total",
      label: "Total",
      align: "right",
      accessor: (line) => <MoneyText value={line.total} dashWhenZero={false} />,
    },
  ];

  return (
    <div className="flex flex-col">
      <DataTable
        label={`Cost lines of ${quotation.ref}`}
        columns={columns}
        rows={quotation.lines}
        rowKey={(line) => line.item}
        density="compact"
      />
      <div className="flex items-baseline justify-between border-t border-border px-4 py-2 text-[12px]">
        <span className="font-medium text-ink">Direct cost</span>
        <span className="font-semibold text-ink">
          <MoneyText value={quotation.directCost} />
        </span>
      </div>
    </div>
  );
}

export default CostingWorksheetPage;
