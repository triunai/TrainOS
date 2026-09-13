import { useMemo, useState } from "react";
import type { Template, TemplateType } from "@trainos/contract";
import {
  ContentCard,
  DataTable,
  EmptyState,
  ErrorState,
  FilterBar,
  ListToolbar,
  LoadingState,
  MoneyText,
  PillTabGroup,
  RecordHeader,
  StatusChip,
  humanise,
  type Column,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { useTemplates } from "./api";

/**
 * `/settings/templates` — every template the console resolves against.
 *
 * No artboard. The composition is §18's: the human summary first — how many
 * templates, of what kinds, and which ones cost money to send — then the
 * inventory, then one template's machinery in the detail panel.
 *
 * THE WHATSAPP ROWS ARE THE ONES THAT MATTER. A proposal template is a
 * document; a WhatsApp template is a document with a PRICE and a category the
 * provider enforces, and the gap between UTILITY and MARKETING is roughly six
 * times per message. The rate column exists so the person choosing a template
 * can see that before they choose, rather than after the bill. Templates with
 * no rate render a dash rather than RM 0.00 — free and unpriced are different
 * facts, and `dashWhenZero` is the kit's way of saying so.
 *
 * The tabs are built from the types PRESENT in the response, not from the
 * contract's nine-value enum. A tab for a type the tenant has no template of is
 * a tab that can only ever show an empty state.
 */

/** Types whose templates cost money to send. */
const PRICED: TemplateType[] = ["WHATSAPP"];

export function TemplatesSettingsScreen() {
  useBreadcrumb([{ label: "Settings" }, { label: "Templates" }]);

  const templates = useTemplates();
  const [type, setType] = useState<"all" | TemplateType>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rows = useMemo(() => templates.data?.data ?? [], [templates.data]);

  /* Present types, in the order the server returned them. Sorting alphabetically
     would put CERTIFICATE before PROPOSAL, which is not the order anyone thinks
     about these in. */
  const types = useMemo(() => {
    const seen: TemplateType[] = [];
    for (const template of rows) {
      if (!seen.includes(template.type)) seen.push(template.type);
    }
    return seen;
  }, [rows]);

  const visible = useMemo(
    () => (type === "all" ? rows : rows.filter((template) => template.type === type)),
    [rows, type],
  );

  const selected = useMemo(
    () => visible.find((template) => template.id === selectedId) ?? visible[0] ?? null,
    [visible, selectedId],
  );

  const priced = rows.filter((template) => Boolean(template.ratePerMessage)).length;

  const columns: Column<Template>[] = [
    {
      key: "label",
      label: "Template",
      accessor: (template) => (
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium text-ink">{template.label}</p>
          <p className="truncate text-[12px] text-ink-muted">
            {/* The id is machine-ish, so it is mono; the type is a word, so it
                is not. Brief rule 1. */}
            <span className="font-mono text-[11px]">{template.id}</span>
          </p>
        </div>
      ),
    },
    {
      key: "type",
      label: "Kind",
      width: "148px",
      accessor: (template) => <StatusChip tone="neutral">{humanise(template.type)}</StatusChip>,
    },
    {
      key: "version",
      label: "Version",
      width: "88px",
      align: "right",
      accessor: (template) => (
        /* A version is a machine value, so mono — brief rule 1 names versions
           explicitly alongside refs. */
        <span className="font-mono text-[12px] text-ink-secondary">{`v${template.version}`}</span>
      ),
    },
    {
      key: "category",
      label: "Category",
      width: "116px",
      accessor: (template) =>
        template.category ? (
          <StatusChip tone={template.category === "MARKETING" ? "warning" : "neutral"}>
            {humanise(template.category)}
          </StatusChip>
        ) : (
          <span className="text-ink-muted">—</span>
        ),
    },
    {
      key: "rate",
      label: "Per message",
      width: "116px",
      align: "right",
      accessor: (template) =>
        template.ratePerMessage ? (
          <MoneyText value={template.ratePerMessage} className="whitespace-nowrap" />
        ) : (
          /* Not RM 0.00. A document template has no per-message rate at all,
             and printing a zero would claim it is free to send. */
          <span className="text-ink-muted">—</span>
        ),
    },
    {
      key: "fields",
      label: "Merge fields",
      width: "108px",
      align: "right",
      accessor: (template) => (
        <span className="tabular-nums text-ink-secondary">{template.mergeFields.length}</span>
      ),
    },
  ];

  if (templates.isPending) return <LoadingState rows={8} label="Loading the templates" />;
  if (templates.isError) {
    return (
      <ErrorState
        title="The templates could not be loaded"
        error={templates.error}
        onRetry={() => void templates.refetch()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-10">
      <RecordHeader
        withoutCondensed
        title="Templates"
        meta={[
          `${rows.length} templates`,
          `${types.length} kinds`,
          priced > 0 ? `${priced} priced per message` : null,
          "read-only",
        ]}
      />

      <div className="px-5">
        <ListToolbar
          tabs={
            <PillTabGroup
              label="Template kinds"
              activeId={type}
              onSelect={(id) => {
                setType(id as "all" | TemplateType);
                setSelectedId(null);
              }}
              tabs={[
                { id: "all", label: "All", count: rows.length },
                ...types.map((entry) => ({
                  id: entry,
                  label: humanise(entry),
                  count: rows.filter((template) => template.type === entry).length,
                })),
              ]}
            />
          }
          filters={<FilterBar filters={[]} shown={visible.length} total={rows.length} />}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 px-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <DataTable
          label="Templates"
          columns={columns}
          rows={visible}
          rowKey={(template) => template.id}
          onRowClick={(template) => setSelectedId(template.id)}
          empty={
            <EmptyState
              title="No template of this kind"
              description="Nothing is configured for this kind yet. Templates are resolved server-side, so one added there appears here without a release."
            />
          }
        />

        {selected ? (
          <ContentCard
            title={selected.label}
            actions={
              <span className="font-mono text-[12px] text-ink-muted">{`v${selected.version}`}</span>
            }
          >
            <div className="flex flex-col gap-4">
              {selected.sections && selected.sections.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  <p className="text-[12px] font-medium text-ink">Sections</p>
                  {selected.sections.map((section) => (
                    <div key={section.n} className="flex items-baseline gap-2">
                      <span className="w-5 shrink-0 text-right font-mono text-[11px] text-ink-muted">
                        {section.n}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                        {section.title}
                      </span>
                      {/* AI is a 6% tint, a ✦ and a word — never a solid fill
                          and never a fourth accent. */}
                      {section.aiEnabled ? (
                        <span className="whitespace-nowrap rounded-control bg-ai-tint px-1.5 py-0.5 text-[11px] text-primary">
                          ✦ AI drafted
                        </span>
                      ) : (
                        <span className="whitespace-nowrap text-[11px] text-ink-muted">
                          written by hand
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="flex flex-col gap-1.5 border-t border-divider pt-3">
                <p className="text-[12px] font-medium text-ink">Merge fields</p>
                {selected.mergeFields.length === 0 ? (
                  <p className="text-[12px] text-ink-muted">
                    This template merges nothing — it is the same text every time it is sent.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {selected.mergeFields.map((field) => (
                      <span
                        key={field}
                        className="rounded-control border border-border px-1.5 py-0.5 font-mono text-[11px] text-ink-secondary"
                      >
                        {field}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {selected.ratePerMessage && selected.category ? (
                <p className="border-t border-divider pt-3 text-[12px] leading-relaxed text-ink-secondary">
                  {`Sending this costs `}
                  <MoneyText value={selected.ratePerMessage} />
                  {` per recipient at the ${humanise(selected.category).toLowerCase()} rate. The
                  category is the provider's, not ours, and it decides the price — a template
                  registered as marketing cannot be sent at the utility rate by calling it
                  something else here.`}
                </p>
              ) : null}

              <p className="border-t border-divider pt-3 text-[12px] leading-relaxed text-ink-muted">
                Templates are resolved server-side and versioned there. Changing one is an
                administrator&rsquo;s job, and a sent document keeps the version it was sent with.
              </p>
            </div>
          </ContentCard>
        ) : null}
      </div>
    </div>
  );
}
