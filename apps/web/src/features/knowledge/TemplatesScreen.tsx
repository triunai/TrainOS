import { useMemo, useState, type ReactNode } from "react";
import type { Template, TemplateType } from "@trainos/contract";
import {
  DataTable,
  DensityToggle,
  Drawer,
  EmptyState,
  ErrorState,
  ExceptionBanner,
  FilterBar,
  FilterSearch,
  FilterSelect,
  ListToolbar,
  LoadingState,
  MESSAGE_CATEGORY_TONE,
  MoneyText,
  PillTabGroup,
  RecordHeader,
  StatusChip,
  humanise,
  type Column,
  type Density,
  type FilterChipModel,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { useTemplates } from "./corpus.api";

/**
 * Knowledge › Templates.
 *
 * §2 `GET /v1/templates`, read-only for the demo and read-only here: the
 * contract declares no write, so the screen offers no primary button rather
 * than a control that looks like one and is not.
 *
 * The page answers two questions, in the order the tightening brief §18 puts
 * them. WHICH document does each template produce — that is the table. And
 * WHAT does the model get to write in it — that is the drawer, because the
 * answer is per section and a column cannot hold it.
 *
 * The standard proposal is the one to read. Four of its five sections are
 * model-written and section 4, Investment, is not: the money page comes from
 * the quotation, and a template that let a model compose it would be a
 * generated number in a document a client signs. That single flag is the most
 * important fact on this screen, so the drawer states it in words rather than
 * leaving a reader to notice an unticked box.
 */

type TabId = "all" | "documents" | "messages";

/** Documents are produced and signed; messages are sent. Different lifecycles. */
const MESSAGE_TYPES: ReadonlySet<TemplateType> = new Set(["EMAIL", "WHATSAPP"]);

const TYPE_LABEL: Record<TemplateType, string> = {
  PROPOSAL: "Proposal",
  QUOTATION: "Quotation",
  CERTIFICATE: "Certificate",
  EMAIL: "Email",
  WHATSAPP: "WhatsApp",
  INVOICE: "Invoice",
  TNA_QUESTIONNAIRE: "Needs analysis",
  EVALUATION: "Evaluation",
  HRDC_PACKET: "HRD Corp packet",
};

function groupOf(template: Template): Exclude<TabId, "all"> {
  return MESSAGE_TYPES.has(template.type) ? "messages" : "documents";
}

export function TemplatesScreen() {
  useBreadcrumb([{ label: "Knowledge" }, { label: "Templates" }]);

  const templates = useTemplates();

  const [tab, setTab] = useState<TabId>("all");
  const [query, setQuery] = useState("");
  const [type, setType] = useState("ALL");
  const [density, setDensity] = useState<Density>("comfortable");
  const [open, setOpen] = useState<Template | null>(null);

  const all = useMemo(() => templates.data?.data ?? [], [templates.data]);

  const types = useMemo(() => [...new Set(all.map((template) => template.type))].sort(), [all]);

  const narrowed = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return all.filter((template) => {
      if (type !== "ALL" && template.type !== type) return false;
      if (needle === "") return true;
      return (
        template.label.toLowerCase().includes(needle) ||
        template.id.toLowerCase().includes(needle) ||
        template.mergeFields.some((field) => field.toLowerCase().includes(needle))
      );
    });
  }, [all, type, query]);

  const countOf = (id: TabId) =>
    id === "all" ? narrowed.length : narrowed.filter((t) => groupOf(t) === id).length;

  const rows = useMemo(
    () => (tab === "all" ? narrowed : narrowed.filter((template) => groupOf(template) === tab)),
    [narrowed, tab],
  );

  const withRates = all.filter((template) => template.ratePerMessage);
  const aiWritten = all
    .flatMap((template) => template.sections ?? [])
    .filter((section) => section.aiEnabled).length;
  const humanOnly = all
    .flatMap((template) => template.sections ?? [])
    .filter((section) => !section.aiEnabled).length;

  const chips: FilterChipModel[] = [];
  if (query.trim().length > 0) chips.push({ id: "query", label: "Search", value: query.trim() });
  if (type !== "ALL") {
    chips.push({ id: "type", label: "Type", value: TYPE_LABEL[type as TemplateType] });
  }

  const columns: Column<Template>[] = [
    {
      key: "label",
      label: "Template",
      accessor: (template) => (
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium text-ink">{template.label}</p>
          <p className="truncate text-[12px] text-ink-muted">
            {TYPE_LABEL[template.type]}
            {" · "}
            <span className="font-mono">{`v${template.version}`}</span>
          </p>
        </div>
      ),
    },
    {
      key: "id",
      label: "Reference",
      width: "230px",
      /* A template id is the thing a draft cites, so it is machine text and
         gets the mono face — the tightening brief §1's only allowance. */
      accessor: (template) => (
        <span className="font-mono text-[12px] text-ink-secondary">{template.id}</span>
      ),
    },
    {
      key: "composition",
      label: "Composition",
      width: "220px",
      accessor: (template) => {
        const sections = template.sections ?? [];
        if (sections.length === 0) {
          return (
            <span className="text-[12px] text-ink-muted">
              {`${template.mergeFields.length} merge fields`}
            </span>
          );
        }
        const human = sections.filter((section) => !section.aiEnabled).length;
        return (
          <span className="text-[12px] text-ink-secondary">
            {`${sections.length} sections · ${template.mergeFields.length} merge fields`}
            {human > 0 ? (
              <span className="block text-[11px] text-ink-muted">
                {`${human} written by a human only`}
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      key: "category",
      label: "Send category",
      width: "180px",
      /* WhatsApp is the only channel with a per-message price, and §7 makes the
         category the thing that sets it. Money as typography, not a badge. */
      accessor: (template) =>
        template.category ? (
          <div className="flex flex-col items-start gap-1">
            <StatusChip tone={MESSAGE_CATEGORY_TONE[template.category]}>
              {humanise(template.category)}
            </StatusChip>
            {template.ratePerMessage ? (
              <span className="text-[11px] text-ink-muted">
                <MoneyText value={template.ratePerMessage} className="tabular-nums" /> per message
              </span>
            ) : null}
          </div>
        ) : (
          <span className="text-[13px] text-ink-muted">—</span>
        ),
    },
  ];

  return (
    <div className="flex flex-col">
      <RecordHeader
        title="Templates"
        withoutCondensed
        meta={[
          `${all.length} templates`,
          `${types.length} kinds of document`,
          `${aiWritten} model-written sections`,
          humanOnly > 0 ? `${humanOnly} human-only` : null,
        ]}
        actions={<DensityToggle value={density} onChange={setDensity} />}
      />

      {withRates.length > 0 ? (
        <div className="px-5 pb-1">
          <ExceptionBanner
            severity="INFO"
            title={`${withRates.length} WhatsApp templates carry a per-message rate`}
            subtitle="A marketing template costs several times a utility one, and the category is what sets the price rather than the length of the message. The send screens price a batch from these figures, so changing a template's category changes what a campaign costs."
          />
        </div>
      ) : null}

      <ListToolbar
        tabs={
          <PillTabGroup
            label="Template group"
            activeId={tab}
            onSelect={(id) => setTab(id as TabId)}
            tabs={[
              { id: "all", label: "All", count: countOf("all") },
              { id: "documents", label: "Documents", count: countOf("documents") },
              { id: "messages", label: "Messages", count: countOf("messages") },
            ]}
          />
        }
        filters={
          <FilterBar
            filters={chips}
            shown={rows.length}
            total={all.length}
            onRemove={(id) => {
              if (id === "query") setQuery("");
              if (id === "type") setType("ALL");
            }}
            onClearAll={() => {
              setQuery("");
              setType("ALL");
            }}
          >
            <FilterSearch
              label="Search templates"
              labelHidden
              value={query}
              onChange={setQuery}
              placeholder="Name, id or merge field"
            />
            <FilterSelect
              label="Type"
              value={type}
              onChange={setType}
              options={[
                { value: "ALL", label: "Any type" },
                ...types.map((value) => ({ value, label: TYPE_LABEL[value] })),
              ]}
            />
          </FilterBar>
        }
      />

      {templates.isPending ? <LoadingState rows={8} label="Loading the templates" /> : null}

      {templates.isError ? (
        <ErrorState
          title="The templates could not be loaded"
          error={templates.error}
          onRetry={() => void templates.refetch()}
        />
      ) : null}

      {!templates.isPending && !templates.isError ? (
        <DataTable
          label="Templates"
          columns={columns}
          rows={rows}
          rowKey={(template) => template.id}
          density={density}
          onRowClick={(template) => setOpen(template)}
          empty={
            <EmptyState
              title="No template matches"
              description="Nothing in this group matches the current type and search. Widen the filter or choose another tab."
            />
          }
        />
      ) : null}

      <TemplateDrawer template={open} onClose={() => setOpen(null)} />
    </div>
  );
}

/** What the model may write, and what the template will fill in. */
function TemplateDrawer({ template, onClose }: { template: Template | null; onClose: () => void }) {
  if (!template) return null;

  const sections = template.sections ?? [];
  const humanOnly = sections.filter((section) => !section.aiEnabled);

  return (
    <Drawer
      open
      onClose={onClose}
      title={template.label}
      subtitle={`${TYPE_LABEL[template.type]} · v${template.version} · ${template.id}`}
      width="460px"
    >
      <div className="flex flex-col gap-5">
        {sections.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-[13px] font-medium text-ink">Sections</h3>
            <ol className="flex flex-col gap-1.5">
              {sections.map((section) => (
                <li
                  key={section.n}
                  className="flex items-baseline justify-between gap-4 text-[13px]"
                >
                  <span className="text-ink">
                    <span className="font-mono text-[12px] text-ink-muted">{`${section.n}. `}</span>
                    {section.title}
                  </span>
                  <span
                    className={
                      section.aiEnabled ? "text-[12px] text-ink-muted" : "text-[12px] text-ink"
                    }
                  >
                    {section.aiEnabled ? "model drafts" : "human only"}
                  </span>
                </li>
              ))}
            </ol>
            {humanOnly.length > 0 ? (
              <p className="text-[12px] leading-relaxed text-ink-secondary">
                {`${humanOnly.map((section) => section.title).join(", ")} ${
                  humanOnly.length === 1 ? "is" : "are"
                } written by a person. The figures come from the quotation, and a
                 model-composed price in a document a client signs is a number nobody
                 quoted.`}
              </p>
            ) : null}
          </section>
        ) : null}

        <section className="flex flex-col gap-2">
          <h3 className="text-[13px] font-medium text-ink">Merge fields</h3>
          <ul className="flex flex-wrap gap-1.5">
            {template.mergeFields.map((field) => (
              <li
                key={field}
                className="rounded-control border border-border px-2 py-0.5 font-mono text-[11px] text-ink-secondary"
              >
                {field}
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-ink-muted">
            Filled from the record the document is generated against. A field with nothing behind it
            blocks the draft rather than rendering empty.
          </p>
        </section>

        {template.category ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-[13px] font-medium text-ink">Sending</h3>
            <dl className="flex flex-col gap-1.5 text-[13px]">
              <Line term="Category" value={humanise(template.category)} />
              {template.ratePerMessage ? (
                <Line term="Rate" value={<MoneyText value={template.ratePerMessage} />} />
              ) : null}
            </dl>
          </section>
        ) : null}
      </div>
    </Drawer>
  );
}

function Line({ term, value }: { term: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-ink-muted">{term}</dt>
      <dd className="text-right text-ink">{value}</dd>
    </div>
  );
}

export default TemplatesScreen;
