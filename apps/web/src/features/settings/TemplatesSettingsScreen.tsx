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
  MESSAGE_CATEGORY_TONE,
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
 * THE TABS GROUP, THEY DO NOT ENUMERATE. Nine kinds is nine segments, and nine
 * segments overflow the track at 1440 and stop being a control — it was built
 * that way first and the ninth label was clipped mid-word. Messages and
 * documents is the split the page is actually about, and the exact kind stays a
 * column on every row.
 */

/**
 * The two kinds that are SENT as a message. Everything else produces a
 * document.
 *
 * This grouping is the screen's, not the contract's, and it is stated as a
 * constant for that reason. It is safe in a way a policy-to-stage map is not:
 * the third group is computed as the COMPLEMENT, so a template type nobody
 * anticipated lands in "Documents" and stays visible instead of vanishing from
 * every tab. Getting it wrong misfiles a row; it cannot lose one.
 *
 * Why group at all: nine kinds is nine segments, and a segmented control with
 * nine segments overflows its track at 1440 and stops being a control. The
 * exact kind is still a column on every row and is never hidden.
 */
const MESSAGE_TYPES: TemplateType[] = ["EMAIL", "WHATSAPP"];

const GROUPS = {
  all: "All",
  messages: "Messages",
  documents: "Documents",
} as const;

type GroupId = keyof typeof GROUPS;

function groupOf(template: Template): Exclude<GroupId, "all"> {
  return MESSAGE_TYPES.includes(template.type) ? "messages" : "documents";
}

export function TemplatesSettingsScreen() {
  useBreadcrumb([{ label: "Settings" }, { label: "Templates" }]);

  const templates = useTemplates();
  const [group, setGroup] = useState<GroupId>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rows = useMemo(() => templates.data?.data ?? [], [templates.data]);

  /* Present kinds, in the order the server returned them. Counted for the
     header line only — the tabs group them, the Kind column names each one. */
  const kinds = useMemo(() => {
    const seen: TemplateType[] = [];
    for (const template of rows) {
      if (!seen.includes(template.type)) seen.push(template.type);
    }
    return seen;
  }, [rows]);

  const visible = useMemo(
    () => (group === "all" ? rows : rows.filter((template) => groupOf(template) === group)),
    [rows, group],
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
          <StatusChip tone={MESSAGE_CATEGORY_TONE[template.category]}>
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
          `${kinds.length} kinds`,
          priced > 0 ? `${priced} priced per message` : null,
          "read-only",
        ]}
      />

      <div className="px-5">
        <ListToolbar
          tabs={
            <PillTabGroup
              label="Template groups"
              activeId={group}
              onSelect={(id) => {
                setGroup(id as GroupId);
                setSelectedId(null);
              }}
              tabs={(Object.keys(GROUPS) as GroupId[]).map((id) => ({
                id,
                label: GROUPS[id],
                count:
                  id === "all"
                    ? rows.length
                    : rows.filter((template) => groupOf(template) === id).length,
              }))}
            />
          }
          filters={<FilterBar filters={[]} shown={visible.length} total={rows.length} />}
        />
      </div>

      {/* Deliberately NOT the kit's `SplitWorkspace`, and the reason is not
          that this predates it.

          `SplitWorkspace` is the QUEUE-and-RECORD split: a narrow scanning
          pane capped at 40% beside a wider record the reader reads, both
          scrolling independently inside a full-height flex column, with a
          sticky header on the record. The enquiry, follow-up, leads and
          contacts screens are that shape and use it.

          This screen is the other shape: a WIDE TABLE beside a narrow
          reference card, on a page that scrolls as one. Capping the table at
          40% is what put the last two columns off the right edge in the first
          place, and this component has no full-height flex parent for the
          panes to size against, so they would collapse rather than scroll.

          Two shapes, not two variants of one — so this is not the divergence
          CLAUDE.md forbids. If the kit grows a named component for the
          table-and-reference shape, this becomes a migration in that pass.
          Flagged to the lead 13 Sep. */}
      <div className="grid grid-cols-1 gap-5 px-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <DataTable
          label="Templates"
          columns={columns}
          rows={visible}
          rowKey={(template) => template.id}
          onRowClick={(template) => setSelectedId(template.id)}
          empty={
            <EmptyState
              title="No template in this group"
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
