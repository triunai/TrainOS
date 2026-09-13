import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ComplianceRule, ComplianceRuleExpression, RuleStatus } from "@trainos/contract";
import {
  AIChip,
  DataTable,
  DateText,
  Drawer,
  EmptyState,
  ErrorState,
  FilterBar,
  LoadingState,
  PillTabGroup,
  PrimaryButton,
  SecondaryButton,
  StatusChip,
  type Column,
  type StatusTone,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { toApiError } from "@/shared/api";
import { useComplianceRules, useCreateComplianceRule } from "./api";
import { StandInField } from "./StandInField";

/**
 * M12-S07 · HRD Corp rules registry.
 *
 * Every compliance check on M12-S02 and M09-S02 cites a row of this table, so
 * the table's job is to make a citation openable: the drawer carries the quoted
 * circular text, the lineage that replaced or replaces the rule, and who
 * verified it.
 *
 * DECISIONS §3: a rule loads as PROPOSED and stays there until a human checks
 * it against the circular PDF. An unverified rule is shown as unverified rather
 * than quietly treated as law.
 */

/**
 * Rule status to chip tone. Belongs beside the other status maps in the kit's
 * `statusTone.ts` — asked for it as `RULE_TONE`; local until it lands.
 */
const RULE_TONE: Record<RuleStatus, StatusTone> = {
  ACTIVE: "success",
  PROPOSED: "warning",
  SUPERSEDED: "neutral",
};

const OPERATOR: Record<string, string> = {
  EQ: "=",
  GTE: "≥",
  LTE: "≤",
  GT: ">",
  LT: "<",
  IMMUTABLE_AFTER: "immutable after",
};

/** `training_start ≥ grant_approval + 14 days`. The rule as a reader checks it. */
function expressionText(expression: ComplianceRuleExpression): string {
  const operator = OPERATOR[expression.op] ?? expression.op.toLowerCase();
  const offset =
    expression.offsetDays === undefined
      ? ""
      : ` + ${expression.offsetDays} ${expression.dayBasis === "WORKING" ? "working " : ""}days`;
  return `${expression.field} ${operator} ${expression.reference}${offset}`;
}

const TAB_STATUS: Record<string, RuleStatus | null> = {
  active: "ACTIVE",
  proposed: "PROPOSED",
  superseded: "SUPERSEDED",
  all: null,
};

export function RulesRegistryScreen() {
  useBreadcrumb([{ label: "Compliance" }, { label: "Rules" }, { label: "Registry" }]);

  const navigate = useNavigate();
  const rules = useComplianceRules();
  const create = useCreateComplianceRule();
  const [tab, setTab] = useState("active");
  const [scheme, setScheme] = useState<string | null>("SBL_KHAS");
  const [openRuleId, setOpenRuleId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draftId, setDraftId] = useState("");
  const [draftSubject, setDraftSubject] = useState("");
  const [draftExcerpt, setDraftExcerpt] = useState("");

  const all = useMemo(() => rules.data?.data ?? [], [rules.data]);

  const visible = useMemo(() => {
    const status = TAB_STATUS[tab] ?? null;
    return all.filter(
      (rule) =>
        (status === null || rule.status === status) && (scheme === null || rule.scheme === scheme),
    );
  }, [all, tab, scheme]);

  const countOf = (status: RuleStatus | null) =>
    status === null ? all.length : all.filter((rule) => rule.status === status).length;

  const openRule = all.find((rule) => rule.id === openRuleId) ?? null;

  const columns: Column<ComplianceRule>[] = [
    {
      key: "id",
      label: "Rule",
      width: "88px",
      accessor: (rule) => (
        <span className="whitespace-nowrap font-mono text-[12px] text-ink">{rule.id}</span>
      ),
    },
    {
      key: "scheme",
      label: "Scheme",
      width: "96px",
      accessor: (rule) => <StatusChip>{rule.scheme.replace("_", "-")}</StatusChip>,
    },
    {
      key: "subject",
      label: "Subject & condition",
      accessor: (rule) => (
        <div className="min-w-0">
          <p className="truncate text-[13px] text-ink">{rule.subject}</p>
          <p className="truncate font-mono text-[12px] text-ink-muted">
            {expressionText(rule.expression)}
          </p>
        </div>
      ),
    },
    {
      key: "effective",
      label: "Effective",
      width: "116px",
      accessor: (rule) => (
        <span className="font-mono text-[12px] text-ink-secondary">
          <DateText value={rule.effectiveFrom} />
          <br />
          {rule.effectiveTo ? <DateText value={rule.effectiveTo} /> : "—"}
        </span>
      ),
    },
    {
      key: "source",
      label: "Source",
      width: "168px",
      accessor: (rule) => (
        <span className="text-[12px] text-ink-secondary">
          {rule.source.title} §{rule.source.section}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      width: "112px",
      accessor: (rule) => (
        <div className="flex items-center gap-1.5">
          <StatusChip tone={RULE_TONE[rule.status]}>{titleOf(rule.status)}</StatusChip>
          {rule.provenance ? <AIChip provenance={rule.provenance} withoutPopover /> : null}
        </div>
      ),
    },
    {
      key: "verified",
      label: "Verified by",
      width: "156px",
      accessor: (rule) =>
        rule.verifiedBy && rule.verifiedAt ? (
          <span className="text-[12px] text-ink-secondary">
            {rule.verifiedBy.name ?? rule.verifiedBy.id} · <DateText value={rule.verifiedAt} />
          </span>
        ) : (
          <span className="text-[12px] text-ink-muted">Awaiting verification</span>
        ),
    },
  ];

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-3 px-6 pb-4 pt-3">
        <h1 className="text-[20px] font-semibold text-ink">HRD Corp rules</h1>
        <span className="font-mono text-[12px] text-ink-muted">
          {`${countOf("ACTIVE")} active · ${countOf("PROPOSED")} proposed · ${countOf("SUPERSEDED")} superseded`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <SecondaryButton onClick={() => navigate("/compliance/rule-changes")}>
            Rule changes
          </SecondaryButton>
          <PrimaryButton onClick={() => setAdding(true)}>Add rule</PrimaryButton>
        </div>
      </div>

      <div className="flex flex-col gap-3 px-6">
        <PillTabGroup
          label="Rule status"
          activeId={tab}
          onSelect={setTab}
          tabs={[
            { id: "active", label: "Active", count: countOf("ACTIVE") },
            { id: "proposed", label: "Proposed", count: countOf("PROPOSED") },
            { id: "superseded", label: "Superseded", count: countOf("SUPERSEDED") },
            { id: "all", label: "All", count: all.length },
          ]}
        />
        <FilterBar
          shown={visible.length}
          total={all.length}
          onRemove={() => setScheme(null)}
          filters={
            scheme === null
              ? []
              : [{ id: "scheme:eq", label: "Scheme", value: scheme.replace("_", "-") }]
          }
        />
      </div>

      <div className="px-6 py-4">
        {rules.isPending ? <LoadingState rows={7} label="Loading the rules registry" /> : null}
        {rules.error ? (
          <ErrorState
            title="The rules registry could not be loaded"
            error={toApiError(rules.error)}
            onRetry={() => void rules.refetch()}
          />
        ) : null}
        {rules.data ? (
          <DataTable
            label="HRD Corp rules"
            columns={columns}
            rows={visible}
            rowKey={(rule) => rule.id}
            onRowClick={(rule) => setOpenRuleId(rule.id)}
            empty={
              <EmptyState
                title="No rules match this view"
                description="Every rule is filed under a scheme and a status. Clear the filter or switch tab."
              />
            }
          />
        ) : null}
      </div>

      <RuleDrawer
        rule={openRule}
        rules={all}
        onClose={() => setOpenRuleId(null)}
        onOpenRule={setOpenRuleId}
      />

      <Drawer
        open={adding}
        onClose={() => setAdding(false)}
        title="Add rule"
        subtitle="Loads as Proposed · compliance verifies it against the circular before it applies"
        footer={
          <PrimaryButton
            disabled={draftId === "" || draftSubject === "" || create.isPending}
            onClick={() => {
              create.mutate(
                {
                  id: draftId,
                  scheme: "SBL_KHAS",
                  subject: draftSubject,
                  expression: { field: "", op: "EQ", reference: "" },
                  effectiveFrom: new Date().toISOString().slice(0, 10),
                  effectiveTo: null,
                  source: {
                    documentId: "DOC-MANUAL",
                    title: "Entered by hand",
                    section: "—",
                    page: 0,
                    excerpt: draftExcerpt,
                  },
                  supersedesId: null,
                  supersededById: null,
                  usedByChecks: [],
                  affectedOpenEngagements: 0,
                  verifiedBy: null,
                  verifiedAt: null,
                },
                {
                  onSuccess: () => {
                    setAdding(false);
                    setDraftId("");
                    setDraftSubject("");
                    setDraftExcerpt("");
                    setTab("proposed");
                  },
                },
              );
            }}
          >
            Add rule
          </PrimaryButton>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-ink-secondary">
            A rule added here does not take effect. It is filed as Proposed with the source text
            attached, and a human activates it from the rule-change review once the wording has been
            checked against the circular.
          </p>
          <StandInField
            label="Rule id"
            value={draftId}
            onChange={setDraftId}
            placeholder="HRD-0__"
          />
          <StandInField
            label="Subject"
            value={draftSubject}
            onChange={setDraftSubject}
            placeholder="What the rule governs"
          />
          <StandInField
            label="Source excerpt"
            value={draftExcerpt}
            onChange={setDraftExcerpt}
            placeholder="Quoted circular text"
            hint="Quoted verbatim. A rule without its source cannot be cited."
          />
        </div>
      </Drawer>
    </div>
  );
}

function titleOf(status: RuleStatus): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

/**
 * The rule drawer a citation chip opens.
 *
 * The quoted source span is the point: a compliance decision has to be
 * checkable against the circular, not merely asserted by a row in a table.
 */
function RuleDrawer({
  rule,
  rules,
  onClose,
  onOpenRule,
}: {
  rule: ComplianceRule | null;
  rules: ComplianceRule[];
  onClose: () => void;
  onOpenRule: (id: string) => void;
}) {
  const supersedes = rules.find((other) => other.id === rule?.supersedesId) ?? null;
  const supersededBy = rules.find((other) => other.id === rule?.supersededById) ?? null;

  return (
    <Drawer
      open={rule !== null}
      onClose={onClose}
      title={rule?.id ?? "Rule"}
      subtitle={rule ? `${rule.scheme.replace("_", "-")} · ${titleOf(rule.status)}` : undefined}
      width="480px"
    >
      {rule ? (
        <div className="flex flex-col gap-5">
          <section>
            <h3 className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">
              Rule
            </h3>
            <p className="pt-1.5 text-[13px] text-ink">{rule.subject}</p>
            <p className="pt-1.5 rounded-control bg-surface px-2.5 py-2 font-mono text-[12px] text-ink-secondary">
              {expressionText(rule.expression)}
            </p>
            <p className="pt-1.5 text-[12px] text-ink-muted">
              Effective <DateText value={rule.effectiveFrom} />
              {rule.effectiveTo ? (
                <>
                  {" to "}
                  <DateText value={rule.effectiveTo} />
                </>
              ) : (
                " onwards"
              )}
            </p>
          </section>

          <section>
            <h3 className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">
              Source
            </h3>
            <blockquote className="mt-1.5 border-l-2 border-border-strong pl-3 text-[13px] italic text-ink-secondary">
              “{rule.source.excerpt}”
            </blockquote>
            <p className="pt-1.5 font-mono text-[12px] text-ink-muted">
              {`${rule.source.title} · §${rule.source.section} · page ${rule.source.page} · ${rule.source.documentId}`}
            </p>
          </section>

          <section>
            <h3 className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">
              Lineage
            </h3>
            <dl className="pt-1.5 text-[13px]">
              <LineageRow label="Supersedes">
                {supersedes ? (
                  <button
                    type="button"
                    onClick={() => onOpenRule(supersedes.id)}
                    className="text-primary-hover hover:underline"
                  >
                    {`${supersedes.id} · ${supersedes.subject}`}
                  </button>
                ) : (
                  "—"
                )}
              </LineageRow>
              <LineageRow label="Superseded by">
                {supersededBy ? (
                  <button
                    type="button"
                    onClick={() => onOpenRule(supersededBy.id)}
                    className="text-primary-hover hover:underline"
                  >
                    {`${supersededBy.id} · from `}
                    <DateText value={supersededBy.effectiveFrom} />
                  </button>
                ) : (
                  "—"
                )}
              </LineageRow>
              <LineageRow label="Used by checks">
                {rule.usedByChecks.length === 0 ? "—" : rule.usedByChecks.join(", ")}
              </LineageRow>
              <LineageRow label="Open engagements affected">
                {rule.affectedOpenEngagements}
              </LineageRow>
            </dl>
          </section>

          <section>
            <h3 className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">
              Change history
            </h3>
            <ol className="pt-1.5 text-[13px] text-ink-secondary">
              {rule.provenance ? (
                <li className="flex items-center gap-2 border-t border-divider py-2">
                  <DateText value={rule.provenance.generatedAt} className="font-mono text-[12px]" />
                  <span>Extracted from {rule.source.title}</span>
                  <AIChip provenance={rule.provenance} />
                </li>
              ) : null}
              {rule.verifiedAt ? (
                <li className="flex items-center gap-2 border-t border-divider py-2">
                  <DateText value={rule.verifiedAt} className="font-mono text-[12px]" />
                  <span>
                    Verified and activated by {rule.verifiedBy?.name ?? rule.verifiedBy?.id}
                  </span>
                </li>
              ) : (
                <li className="border-t border-divider py-2 text-ink-muted">
                  Not yet verified against the source document.
                </li>
              )}
              <li className="flex items-center gap-2 border-t border-divider py-2">
                <DateText value={rule.effectiveFrom} className="font-mono text-[12px]" />
                <span>Effective from</span>
              </li>
            </ol>
          </section>
        </div>
      ) : null}
    </Drawer>
  );
}

function LineageRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-divider py-2">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right text-ink">{children}</dd>
    </div>
  );
}
