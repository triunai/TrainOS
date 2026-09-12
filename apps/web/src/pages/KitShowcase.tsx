import { useState, type ReactNode } from "react";
import type {
  ApprovalRequest,
  AutomationRun,
  ComplianceCheck,
  DiffLine,
  LifecycleStep,
  Money,
  PipelineStage,
  Provenance,
  RequiredDocument,
  RunStateCard,
  TraceNode,
} from "@trainos/contract";
import {
  AgingStrip,
  AIChip,
  AgentRunCard,
  AllowedHoursStrip,
  ApprovalBanner,
  AutonomyChip,
  AUTONOMY_LADDER,
  Avatar,
  Breadcrumb,
  BudgetBar,
  BulkActionBar,
  ChecklistRow,
  CitationChip,
  CommandPalette,
  CompletenessBar,
  ConfirmDialog,
  ContentCard,
  CondensedRecordHeader,
  DangerButton,
  DataTable,
  DateText,
  DensityToggle,
  DiffBlock,
  DocumentChecklistRow,
  Drawer,
  EmptyState,
  ErrorState,
  EscalationLadder,
  ExceptionBanner,
  ExternalMinimalShell,
  Fab,
  FilterBar,
  GhostButton,
  IconButton,
  JuryChip,
  KeyboardShortcut,
  LanguageToggle,
  LifecycleStepper,
  LoadingState,
  MetricStrip,
  MiniBar,
  MoneyInput,
  MoneyText,
  NotificationBell,
  PillTabGroup,
  PrimaryButton,
  ProposedActionCard,
  ProvenanceBlock,
  RecordHeader,
  RefChip,
  RelationPicker,
  RuleCheckRow,
  RunStepRow,
  SearchTrigger,
  SecondaryButton,
  setSinglePrimaryCheck,
  Skeleton,
  SkeletonMetrics,
  SkeletonTable,
  SkeletonText,
  StateCardPanel,
  StatusChip,
  TierChip,
  TokenBudgetBar,
  TraceTree,
  WhatsAppCostStrip,
  type Column,
  type Density,
} from "@/shared/components/kit";

/**
 * /dev/kit — every kit component, every variant the design pack names, in one
 * scrollable page.
 *
 * This is the kit's proof and its contract with the twelve screen-building
 * agents: if a pattern is not on this page, it is not in the kit, and inventing
 * it on a screen is the divergence CLAUDE.md calls a defect.
 *
 * Layout: each entry renders twice, side by side, with the LEFT column pinned
 * to `data-theme="light"` and the RIGHT to `data-theme="dark"`. The comparison
 * therefore holds whichever theme the app itself is in.
 *
 * That only became possible once `tokens.css` grew a `[data-theme="light"]`
 * selector carrying the same values as bare `:root`. Before it, a light island
 * inside a dark page had no rule to re-assert the light palette and rendered
 * dark, so this page could only compare the two themes while the app was in
 * light mode.
 *
 * The sample values below are literals local to this file. They are not
 * fixtures and nothing else may import them — a kit that ships data has stopped
 * being a kit.
 */

/* The showcase renders every variant of every component at once, including
   several primary buttons. It is a catalogue, not a view, so the
   one-solid-primary check is switched off here and nowhere else — leaving it on
   would fill the console with warnings that are correct about this page and
   thereby teach everyone to ignore the ones that are correct about a screen. */
setSinglePrimaryCheck(false);

const money = (amount: number): Money => ({ amount, currency: "MYR" });

const PIPELINE: PipelineStage[] = [
  { key: "ENQUIRY", label: "Enquiry", order: 1 },
  { key: "TNA", label: "TNA", order: 2 },
  { key: "PROPOSAL", label: "Proposal", order: 3 },
  { key: "DELIVERY", label: "Delivery", order: 4 },
  { key: "HRDC_CLAIM", label: "HRDC claim", order: 5 },
  { key: "INVOICE", label: "Invoice", order: 6 },
];

const CHAIN_DONE: LifecycleStep[] = [
  { key: "ENQUIRY", state: "DONE", at: "2026-09-12" },
  { key: "TNA", state: "DONE", at: "2026-09-28" },
  { key: "PROPOSAL", state: "CURRENT", at: "2026-10-14" },
  { key: "DELIVERY", state: "PENDING" },
  { key: "HRDC_CLAIM", state: "PENDING" },
  { key: "INVOICE", state: "PENDING" },
];

const CHAIN_BLOCKED: LifecycleStep[] = [
  { key: "ENQUIRY", state: "DONE", at: "2026-09-12" },
  { key: "TNA", state: "SKIPPED", note: "not required" },
  { key: "PROPOSAL", state: "DONE", at: "2026-10-14" },
  { key: "DELIVERY", state: "DONE", at: "2026-11-12" },
  { key: "HRDC_CLAIM", state: "BLOCKED", note: "2 documents missing" },
  { key: "INVOICE", state: "PENDING" },
];

const CHAIN_LOST: LifecycleStep[] = [
  { key: "ENQUIRY", state: "DONE", at: "2026-09-12" },
  { key: "TNA", state: "DONE", at: "2026-09-28" },
  { key: "PROPOSAL", state: "FAILED", note: "Lost to incumbent" },
];

const AI_PROVENANCE: Provenance = {
  origin: "AI_GENERATED",
  confidence: 0.82,
  agentId: "TNA Agent",
  runId: "#4821",
  sources: [
    { type: "EMAIL", ref: "ENQ-2026-0912" },
    { type: "PROGRAMME", ref: "PRG-0044" },
  ],
  model: "DeepSeek V4 Flash",
  provider: "DEEPSEEK",
  cacheHitRate: 0.92,
  tier: "FAST",
  generatedAt: "2026-10-14T09:41:00+08:00",
};

const LOW_CONFIDENCE: Provenance = { ...AI_PROVENANCE, confidence: 0.41 };

const DETERMINISTIC: Provenance = { origin: "SYSTEM", method: "DETERMINISTIC" };

const DIFF: DiffLine[] = [
  {
    op: "ADD",
    entity: "Proposal",
    ref: "PRO-2026-0188",
    description: "Proposal PRO-2026-0188 is sent to Aurora Manufacturing",
  },
  {
    op: "UPDATE",
    entity: "Opportunity",
    ref: "OPP-0512",
    description: "Opportunity stage moves to Proposal sent",
  },
  { op: "REMOVE", entity: "FollowUp", description: "The 14 Oct follow-up reminder is cancelled" },
];

const APPROVAL: ApprovalRequest = {
  id: "apv-1",
  ref: "APV-2026-0771",
  policyId: "APV-01",
  actionType: "PROPOSAL_SEND",
  subject: "Send proposal · Aurora Manufacturing Sdn Bhd",
  targetRef: "PRO-2026-0188",
  value: money(1850000),
  requestedBy: { kind: "AGENT", id: "proposal-agent", name: "Proposal Agent", runId: "#4821" },
  confidence: 0.82,
  autonomy: "ACT_WITH_APPROVAL",
  slaDueAt: "2026-10-14T17:00:00+08:00",
  slaRemainingMinutes: 96,
  slaBreached: false,
  status: "PENDING",
  bulkApprovable: false,
  urgencyGroup: "TODAY",
};

const RUN: AutomationRun = {
  id: "run-1",
  ref: "RUN-4821",
  agentId: "proposal-agent",
  trigger: { type: "TNA_COMPLETED", ref: "TNA-0231" },
  model: "Claude Sonnet 5",
  startedAt: "2026-10-14T09:40:00+08:00",
  durationMs: 8400,
  cost: money(18),
  tokens: { in: 38412, out: 4120 },
  status: "SUCCEEDED",
  guardrails: ["floor-price", "money-ceiling"],
  tiersUsed: ["STRONG_1"],
  steps: [
    {
      seq: 1,
      tool: "read_tna",
      status: "OK",
      durationMs: 900,
      cost: money(2),
      args: { ref: "TNA-0231" },
    },
    {
      seq: 2,
      tool: "match_programme",
      status: "RETRIED",
      retries: 1,
      durationMs: 2100,
      cost: money(6),
    },
    {
      seq: 3,
      tool: "send_proposal",
      status: "HALTED",
      durationMs: 0,
      haltedBy: {
        policyId: "APV-01",
        approvalRequestRef: "APV-2026-0771",
        reason: "Money-moving action needs approval",
      },
    },
  ],
};

const FAILED_RUN: AutomationRun = {
  ...RUN,
  id: "run-2",
  ref: "RUN-4822",
  status: "FAILED",
  steps: undefined,
  failure: {
    code: "PROVIDER_5XX",
    message: "DeepSeek returned 503 three times",
    attempts: 3,
    retryable: true,
    deadLettered: false,
  },
};

const TRACE: TraceNode[] = [
  {
    id: "n1",
    parentId: null,
    kind: "ORCHESTRATOR",
    name: "Orchestrator",
    tier: "MID",
    cacheHitRate: 0.44,
    cost: money(6),
    durationMs: 2100,
    status: "OK",
  },
  {
    id: "n2",
    parentId: "n1",
    kind: "SUB_AGENT",
    name: "Reader · read_tna",
    tier: "FAST",
    cacheHitRate: 0.92,
    cost: money(2),
    durationMs: 900,
    status: "OK",
  },
  {
    id: "n3",
    parentId: "n1",
    kind: "TOOL",
    name: "send_proposal · halted by APV-01",
    cost: money(0),
    status: "HALTED",
    haltedBy: {
      policyId: "APV-01",
      approvalRequestRef: "APV-2026-0771",
      reason: "Approval required",
    },
  },
];

const STATE_CARD: RunStateCard = {
  goal: "Draft and send a proposal for OPP-0512 within the client's November window.",
  plan: [
    { n: 1, label: "Read TNA", status: "DONE" },
    { n: 2, label: "Match programme", status: "DONE" },
    { n: 3, label: "Draft sections", status: "DONE" },
    { n: 4, label: "Verify pricing", status: "DONE" },
    { n: 5, label: "Send", status: "HALTED" },
  ],
  decisions: ["Chose Leading Through Change over Change Readiness on prior-engagement fit."],
  constraints: ["Floor price RM 12,000", "Client window closes 30 Nov"],
  recordPointers: ["OPP-0512", "TNA-0231", "PRG-0044"],
  openQuestions: ["Section 5 HRDC wording unverified (0.41)."],
  budgets: {
    tokens: { used: 38412, limit: 60000 },
    cost: { used: money(96), limit: money(15000) },
  },
};

const CHECKS: ComplianceCheck[] = [
  {
    key: "lead-time",
    state: "PASS",
    label: "Application lead time · in-house",
    computed: {},
    display: "grant approved 28 Oct → earliest start 11 Nov → training 12 Nov",
    ruleId: "HRD-014",
    provenance: DETERMINISTIC,
  },
  {
    key: "meal-ceiling",
    state: "WARN",
    label: "Meal cost ceiling",
    computed: {},
    display: "RM 26.00 per pax per day · 2026 ceiling RM 15–25",
    ruleId: "HRD-020",
    provenance: DETERMINISTIC,
  },
  {
    key: "documents",
    state: "FAIL",
    label: "Required documents complete",
    computed: {},
    display: "3 of 5 present · window closes 17 Nov",
    ruleId: "HRD-011",
    provenance: { origin: "AI_SUGGESTED", model: "Claude Sonnet 5", confidence: 0.88 },
  },
];

const DOCUMENTS: RequiredDocument[] = [
  { type: "ATTENDANCE_SHEET", status: "PRESENT", meta: "Locked 14 Nov · 28/30 present" },
  { type: "TRAINER_TTT_CERT", status: "PRESENT", meta: "Expires 03 Mar 2028" },
  { type: "TAX_INVOICE", status: "MISSING", meta: "Invoice not yet raised" },
];

interface LeadRow {
  ref: string;
  organisation: string;
  contact: string;
  stage: LifecycleStep[];
  value: Money;
  score: number;
  bulkApprovable: boolean;
}

const LEADS: LeadRow[] = [
  {
    ref: "OPP-0512",
    organisation: "Aurora Manufacturing Sdn Bhd",
    contact: "Nurul Huda · conflict management",
    stage: CHAIN_DONE,
    value: money(1850000),
    score: 0.74,
    bulkApprovable: false,
  },
  {
    ref: "OPP-0513",
    organisation: "Selangor Foods Bhd",
    contact: "Tan Wei Ming · leadership",
    stage: CHAIN_BLOCKED,
    value: money(940000),
    score: 0.52,
    bulkApprovable: true,
  },
  {
    ref: "OPP-0514",
    organisation: "Northport Logistics",
    contact: "Arif Rahman · safety",
    stage: CHAIN_LOST,
    value: money(320000),
    score: 0.31,
    bulkApprovable: true,
  },
];

/* ------------------------------------------------------------------ *
 * Page furniture
 * ------------------------------------------------------------------ */

function Entry({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="flex flex-col gap-3 scroll-mt-4">
      <div className="flex flex-col gap-1 border-b border-border pb-2">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
          {title}
        </h2>
        {note ? (
          <p className="max-w-3xl text-[12px] leading-relaxed text-ink-secondary">{note}</p>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div
          data-theme="light"
          className="min-w-0 rounded-card border border-border bg-card p-4 text-ink"
        >
          {children}
        </div>
        <div
          data-theme="dark"
          className="min-w-0 rounded-card border border-border bg-card p-4 text-ink"
        >
          {children}
        </div>
      </div>
    </section>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

function Stack({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3">{children}</div>;
}

/* ------------------------------------------------------------------ *
 * The page
 * ------------------------------------------------------------------ */

export default function KitShowcase() {
  const [tab, setTab] = useState("mine");
  const [density, setDensity] = useState<Density>("comfortable");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [sortKey, setSortKey] = useState("value");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [query, setQuery] = useState("aurora");
  const [amount, setAmount] = useState<Money | null>(money(1850000));
  const [relationQuery, setRelationQuery] = useState("aur");

  const columns: Column<LeadRow>[] = [
    {
      key: "ref",
      label: "Ref",
      accessor: (row) => <span className="font-mono text-[12px]">{row.ref}</span>,
      width: "110px",
    },
    {
      key: "organisation",
      label: "Organisation",
      accessor: (row) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.organisation}</span>
          <span className="text-[11px] text-ink-muted">{row.contact}</span>
        </div>
      ),
    },
    {
      key: "stage",
      label: "Stage",
      accessor: (row) => <LifecycleStepper steps={row.stage} stages={PIPELINE} variant="table" />,
      width: "140px",
    },
    {
      key: "value",
      label: "Value",
      align: "right",
      sortable: true,
      accessor: (row) => <MoneyText value={row.value} />,
      width: "130px",
    },
    {
      key: "score",
      label: "Score",
      accessor: (row) => (
        <span className="flex items-center gap-2">
          <MiniBar value={row.score} width="44px" label={`Score for ${row.ref}`} />
          <span className="font-mono text-[12px]">{Math.round(row.score * 100)}</span>
        </span>
      ),
      width: "110px",
    },
  ];

  return (
    <div className="flex flex-col gap-8 p-6">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
          TrainOS · component kit · /dev/kit
        </p>
        <h1>Kit showcase</h1>
        <p className="max-w-3xl text-[13px] leading-relaxed text-ink-secondary">
          Every component in the kit, every variant the design pack names. Each pair is the same
          markup twice: the left panel pinned to light, the right pinned to dark. Nothing between
          them changes but the tokens, which is the whole claim dark mode makes here.
        </p>
      </header>

      <Entry
        id="buttons"
        title="Buttons · Kit §03"
        note="One solid primary per view — useSinglePrimary warns in development when a second mounts with a different label. Danger is bordered, never filled; the one red fill in the kit is the confirm dialog's."
      >
        <Stack>
          <Row>
            <PrimaryButton>New opportunity</PrimaryButton>
            <SecondaryButton>Audit trail</SecondaryButton>
            <GhostButton>Clear filters</GhostButton>
            <DangerButton>Request unlock</DangerButton>
          </Row>
          <Row>
            <SecondaryButton disabled>Disabled</SecondaryButton>
            <PrimaryButton disabled>Disabled primary</PrimaryButton>
            <IconButton label="Columns" icon="⋮" />
            <KeyboardShortcut keys={["⌘", "K"]} action="search" />
          </Row>
        </Stack>
      </Entry>

      <Entry
        id="chips-status"
        title="Status, sync and lock chips · Kit §02"
        note="The only place status colour exists in TrainOS. Pill for workflow status and stage, square for a machine fact like sync or a lock."
      >
        <Stack>
          <Row>
            <StatusChip>Draft</StatusChip>
            <StatusChip tone="warning">Awaiting approval</StatusChip>
            <StatusChip>Sent</StatusChip>
            <StatusChip tone="success">Accepted</StatusChip>
            <StatusChip tone="danger">Lost</StatusChip>
          </Row>
          <Row>
            <StatusChip shape="square">Sync · Not sent</StatusChip>
            <StatusChip shape="square" tone="info">
              Sync · Sent
            </StatusChip>
            <StatusChip shape="square" tone="success">
              MyInvois · Validated
            </StatusChip>
            <StatusChip shape="square" tone="danger">
              Sync · Error
            </StatusChip>
          </Row>
          <Row>
            <StatusChip shape="square" glyph="🔒">
              Locked · HRDC approved
            </StatusChip>
            <StatusChip>Stage · Proposal sent</StatusChip>
          </Row>
        </Stack>
      </Entry>

      <Entry
        id="chips-ai"
        title="AI badge · Kit §02 and the seven provenance variants · Kit §05"
        note="Tint plus the glyph plus a text label. There is no solid variant and no prop that produces one. A human-authored value renders no badge at all."
      >
        <Stack>
          <Row>
            <AIChip provenance={AI_PROVENANCE} />
            <AIChip
              variant="suggested"
              label="AI-assisted · edited"
              provenance={{
                ...AI_PROVENANCE,
                editedBy: { id: "u1", name: "Amirah", at: "2026-10-14T10:02:00+08:00" },
              }}
              showConfidence={false}
            />
            <AIChip variant="low-confidence" provenance={LOW_CONFIDENCE} />
          </Row>
          <Row>
            <AIChip variant="system" withoutPopover />
            <AIChip variant="executed" provenance={AI_PROVENANCE} showConfidence={false} />
            <AIChip variant="awaiting" withoutPopover />
            <AIChip variant="failed" withoutPopover />
            <span className="text-[12px] text-ink-muted">Human renders nothing →</span>
            <AIChip variant="human" />
          </Row>
          <div className="max-w-md">
            <ProvenanceBlock
              provenance={AI_PROVENANCE}
              reasoning="Matched “conflict management” and “30 managers” in the enquiry to Leading Through Change. Confidence lowered by unstated budget."
              onOpenSources={() => undefined}
              onOpenTrace={() => undefined}
            />
          </div>
        </Stack>
      </Entry>

      <Entry
        id="chips-autonomy"
        title="Autonomy ladder · Kit §02"
        note="Border weight rises with the rung, so risk reads without a second hue. Money-moving action types are capped at Act w/ approval by server policy."
      >
        <Stack>
          {AUTONOMY_LADDER.map((level) => (
            <AutonomyChip key={level} level={level} withCaption />
          ))}
        </Stack>
      </Entry>

      <Entry
        id="chips-ops"
        title="Tier, jury and reference chips · Kit §10"
        note="A tier is a routing fact, not a status, so it is deliberately neutral. The jury chip takes the AI tint because it describes model behaviour."
      >
        <Stack>
          <Row>
            <TierChip tier="FAST" />
            <TierChip tier="MID" />
            <TierChip tier="STRONG_1" />
            <TierChip tier="DEEP_THINK" />
            <TierChip tier="SPECIAL" />
          </Row>
          <Row>
            <TierChip tier="FAST" model="DeepSeek V4 Flash" />
            <TierChip tier="STRONG_1" model="Claude Sonnet 5" />
          </Row>
          <Row>
            <JuryChip
              jury={{
                quorum: 2,
                of: 3,
                agreed: ["Claude Sonnet 5", "GPT-5"],
                dissented: [{ model: "Gemini 3", note: "Price below the usual floor" }],
              }}
            />
            <JuryChip />
            <CitationChip>§ HRD-014</CitationChip>
            <RefChip type="ORGANISATION" />
            <RefChip type="PROPOSAL" />
            <RefChip refValue="ORG-0114" />
            <span className="text-[13px] text-ink">
              Cited prose<CitationChip variant="inline">1</CitationChip>
            </span>
          </Row>
        </Stack>
      </Entry>

      <Entry
        id="stepper"
        title="LifecycleStepper · Kit §04"
        note="One dot grammar at four densities. Stage names and order render from pipeline configuration — these steps carry bare keys and resolve their labels from PIPELINE."
      >
        <Stack>
          <LifecycleStepper steps={CHAIN_DONE} stages={PIPELINE} />
          <LifecycleStepper steps={CHAIN_BLOCKED} stages={PIPELINE} />
          <LifecycleStepper steps={CHAIN_LOST} stages={PIPELINE} />
          <Row>
            <span className="text-[12px] text-ink-muted">Variant C, in a table cell:</span>
            <LifecycleStepper steps={CHAIN_BLOCKED} stages={PIPELINE} variant="table" />
          </Row>
          <div className="max-w-[300px]">
            <LifecycleStepper steps={CHAIN_DONE} stages={PIPELINE} variant="inline" />
          </div>
        </Stack>
      </Entry>

      <Entry
        id="record-header"
        title="RecordHeader and MetricStrip · Kit §09"
        note="Identity appears once: this component owns it. Actionable cells are buttons with a chevron on hover and on focus; informational cells have no hover at all."
      >
        <Stack>
          <RecordHeader
            title="Aurora Manufacturing Sdn Bhd"
            recordRef="ORG-0114"
            meta={["Manufacturing", "Shah Alam", "owner Amirah", "created 04 Mar 2024"]}
            withoutCondensed
            chips={[
              <StatusChip key="a" tone="success">
                Active client
              </StatusChip>,
              <StatusChip key="b">HRDC registered</StatusChip>,
            ]}
            actions={
              <>
                <SecondaryButton>Log activity</SecondaryButton>
                <SecondaryButton>Audit trail</SecondaryButton>
              </>
            }
            primaryAction={<PrimaryButton>New opportunity</PrimaryButton>}
            metrics={[
              { label: "Lifetime value", value: money(21430000), onDrill: () => undefined },
              {
                label: "Open pipeline",
                value: money(1850000),
                sub: "1 opportunity",
                onDrill: () => undefined,
              },
              {
                label: "AR overdue",
                value: money(1240000),
                sub: "34 days",
                onDrill: () => undefined,
              },
              { label: "HRDC levy", value: money(6100000), sub: "expires 31 Dec" },
              { label: "Health", value: "74", bar: 0.74, onDrill: () => undefined },
            ]}
            stepper={<LifecycleStepper steps={CHAIN_DONE} stages={PIPELINE} />}
          />
          <CondensedRecordHeader
            title="Aurora Manufacturing Sdn Bhd"
            chips={<StatusChip tone="success">Active client</StatusChip>}
            stickyAction={<SecondaryButton>Request changes</SecondaryButton>}
            primaryAction={<PrimaryButton>New opportunity</PrimaryButton>}
          />
          <AgingStrip
            aging={{
              current: money(840000),
              d1_30: money(310000),
              d31_60: money(120000),
              d60_plus: money(48000),
              dsoDays: 41,
            }}
            onDrill={() => undefined}
          />
          <MetricStrip
            bare
            cells={[{ label: "Admin hours saved", value: "112", estimate: true }]}
          />
        </Stack>
      </Entry>

      <Entry
        id="table"
        title="Data table, filter bar and pill tabs · Kit §08"
        note="Every list screen is this component with different columns. The third row cannot be bulk-selected and says why — bulkApprovable is false for anything carrying money."
      >
        <Stack>
          <PillTabGroup
            activeId={tab}
            onSelect={setTab}
            tabs={[
              { id: "mine", label: "My accounts", count: 48 },
              { id: "team", label: "Team", count: 212 },
              { id: "stale", label: "Stale 30d", count: 7 },
            ]}
          />
          <FilterBar
            shown={3}
            total={48}
            onAdd={() => undefined}
            onRemove={() => undefined}
            onClearAll={() => undefined}
            filters={[
              { id: "stage", label: "Stage", value: "Proposal sent" },
              { id: "owner", label: "Owner", value: "Amirah", locked: true },
            ]}
          >
            <DensityToggle value={density} onChange={setDensity} />
          </FilterBar>
          <BulkActionBar count={selected.size} onClear={() => setSelected(new Set())}>
            <SecondaryButton>Assign</SecondaryButton>
            <SecondaryButton>Export</SecondaryButton>
          </BulkActionBar>
          <DataTable
            label="Opportunities"
            columns={columns}
            rowKey={(row) => row.ref}
            density={density}
            selectedKeys={selected}
            onSelectionChange={setSelected}
            selectionDisabledReason={(row) =>
              row.bulkApprovable
                ? undefined
                : "Carries a monetary value — decide this one individually"
            }
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSort={(key) => {
              setSortDirection(key === sortKey && sortDirection === "desc" ? "asc" : "desc");
              setSortKey(key);
            }}
            groups={[
              {
                caption: "Breaching SLA",
                meta: <StatusChip tone="danger">1</StatusChip>,
                rows: LEADS.slice(0, 1),
              },
              { caption: "Today", rows: LEADS.slice(1) },
            ]}
          />
        </Stack>
      </Entry>

      <Entry
        id="approval"
        title="Approval banner and proposed-action card · Kit §02"
        note="The diff is the contract that matters most: effects[] returned by the decide endpoint must match the diff[] rendered here, so it is rendered verbatim from the server."
      >
        <Stack>
          <ApprovalBanner
            approval={APPROVAL}
            approverName="Kelvin"
            approverRole="SALES_MANAGER"
            actions={
              <>
                <GhostButton>Reject</GhostButton>
                <SecondaryButton>Request changes</SecondaryButton>
                <PrimaryButton>Approve &amp; send</PrimaryButton>
              </>
            }
          />
          <ApprovalBanner
            approval={{ ...APPROVAL, slaBreached: true, slaRemainingMinutes: undefined }}
            approverName="Kelvin"
            approverRole="SALES_MANAGER"
          />
          <ApprovalBanner
            approval={{ ...APPROVAL, status: "APPROVED" }}
            decidedBy="Kelvin Tan"
            decidedAt="2026-10-14T14:22:00+08:00"
            onOpenAudit={() => undefined}
          />
          <ProposedActionCard
            agentName="Proposal Agent"
            title="Send proposal to Aurora Manufacturing"
            autonomy="ACT_WITH_APPROVAL"
            provenance={AI_PROVENANCE}
            diff={DIFF}
            metrics={[
              { label: "Value", value: <MoneyText value={money(1850000)} compact /> },
              { label: "Confidence", value: "82%" },
              { label: "Channel", value: "Email" },
            ]}
            actions={
              <>
                <GhostButton>Reject</GhostButton>
                <SecondaryButton>Edit before use</SecondaryButton>
                <PrimaryButton>Approve &amp; send</PrimaryButton>
              </>
            }
          />
          <DiffBlock lines={DIFF} />
        </Stack>
      </Entry>

      <Entry
        id="banners"
        title="Exception and SLA banners · Kit §05"
        note="One per page, outside any internal scroll pane. Stacking three teaches people to ignore all of them."
      >
        <Stack>
          <ExceptionBanner
            severity="DANGER"
            title="HRDC grant window closes in 3 days"
            subtitle="Claim packet ENG-0311 · 2 documents missing"
            action={<SecondaryButton>Open packet</SecondaryButton>}
          />
          <ExceptionBanner
            severity="WARN"
            title="SLA breached · escalated to the Managing Director"
            subtitle="APV-2026-0771 queued 6h ago"
          />
          <ExceptionBanner
            severity="INFO"
            title="Rate card v0 · placeholder"
            subtitle="Costing figures are illustrative until the rate card is signed off."
          />
        </Stack>
      </Entry>

      <Entry
        id="agents"
        title="Agent run card, run steps and trace · Kit §05 and §10"
        note="Depth by indent, status by glyph, cost right-aligned. A halted node takes the AI tint because policy interception is the thing worth seeing."
      >
        <Stack>
          <AgentRunCard
            run={RUN}
            agentName="Proposal Agent"
            actions={<SecondaryButton>Retry</SecondaryButton>}
          />
          <AgentRunCard
            run={FAILED_RUN}
            agentName="Collections Agent"
            withSteps={false}
            actions={
              <>
                <GhostButton>Dismiss</GhostButton>
                <SecondaryButton>Retry</SecondaryButton>
              </>
            }
          />
          <div className="overflow-hidden rounded-card border border-border">
            {RUN.steps?.map((step) => (
              <RunStepRow key={step.seq} step={step} />
            ))}
          </div>
          <TraceTree nodes={TRACE} />
        </Stack>
      </Entry>

      <Entry
        id="ai-ops"
        title="Budget bars, allowed hours and rule checks · Kit §10"
        note="Budget bars stay ink until they near or hit a cap, and the state comes from the server rather than from the ratio. Every check shows its computed values, not just a verdict."
      >
        <Stack>
          <BudgetBar
            label="Proposal Agent"
            budget={{ spend: money(9600), cap: money(15000), state: "WITHIN" }}
          />
          <BudgetBar
            label="STRONG-1 tier"
            budget={{ spend: money(10400), cap: money(12000), state: "NEAR" }}
          />
          <BudgetBar
            label="Collections Agent"
            budget={{ spend: money(20000), cap: money(20000), state: "PAUSED" }}
          />
          <TokenBudgetBar used={38412} limit={60000} />
          <AllowedHoursStrip
            allowed={[[0, 24]]}
            peak={[
              [9, 12],
              [14, 18],
            ]}
          />
          <div>
            {CHECKS.map((check) => (
              <RuleCheckRow key={check.key} check={check} onOpenRule={() => undefined} />
            ))}
          </div>
        </Stack>
      </Entry>

      <Entry
        id="state-card"
        title="State-card panel and escalation ladder · Kit §10"
        note="A long orchestrator run is a working memory that survives restarts. The ladder's dashed rule is where agent autonomy ends and a human takes over."
      >
        <Stack>
          <StateCardPanel stateCard={STATE_CARD} fluid />
          <EscalationLadder
            rungs={[
              {
                when: "Day 7",
                action: "Reminder 1 · email",
                autonomy: "AUTONOMOUS",
                state: "done",
              },
              {
                when: "Day 30",
                action: "Reminder 2 · WhatsApp",
                autonomy: "AUTONOMOUS",
                state: "done",
              },
              {
                when: "Day 45",
                action: "Reminder 3 · email + call note",
                autonomy: "ACT_WITH_APPROVAL",
                state: "current",
              },
              { when: "Day 60", action: "Human call", note: "Assigned to the account owner" },
              { when: "Day 75", action: "Trading hold", note: "Requires MD approval" },
            ]}
          />
        </Stack>
      </Entry>

      <Entry
        id="checklist"
        title="Checklist, completeness and document rows · Kit §03"
        note="A square box with a tick, not a circle: a circle is a radio and means pick one. Done is a fact, so it spends no colour."
      >
        <Stack>
          <div>
            <ChecklistRow label="Attendance locked" done meta="14 Nov · 28 of 30 present" />
            <ChecklistRow label="Trainer TTT certificate attached" done />
            <ChecklistRow
              label="Tax invoice raised"
              done={false}
              meta="Blocked on the HRDC claim"
            />
          </div>
          <CompletenessBar value={0.6} label="Claim completeness" />
          <div>
            {DOCUMENTS.map((document) => (
              <DocumentChecklistRow
                key={document.type}
                document={document}
                onAttach={() => undefined}
                onView={() => undefined}
              />
            ))}
          </div>
        </Stack>
      </Entry>

      <Entry
        id="inputs"
        title="Money input, relation picker and WhatsApp cost · Kit §03"
        note="Money is integer sen in the contract and a string in the field; this component owns both conversions so no screen multiplies a float by a hundred."
      >
        <Stack>
          <MoneyInput
            label="Quotation total"
            value={amount}
            onChange={setAmount}
            hint="Two decimals on entry, separators on display."
          />
          <MoneyInput
            label="Discounted total"
            value={money(980000)}
            onChange={() => undefined}
            errorText="Below the RM 12,000 floor · margin would be 18%"
          />
          <RelationPicker
            label="Organisation"
            query={relationQuery}
            onQueryChange={setRelationQuery}
            selectedRef="ORG-0114"
            onSelect={() => undefined}
            onCreate={() => undefined}
            options={[
              {
                ref: "ORG-0114",
                type: "ORGANISATION",
                label: "Aurora Manufacturing Sdn Bhd",
                meta: "Shah Alam",
              },
              {
                ref: "CON-0301",
                type: "CONTACT",
                label: "Nurul Huda",
                meta: "Aurora · HR Manager",
              },
            ]}
          />
          <WhatsAppCostStrip
            category="UTILITY"
            templateLabel="followup_reminder_v3"
            recipients={30}
            ratePerMessage={money(6)}
            ratePerMessageExact="0.0564"
            estimatedCost={money(169)}
            alternative={{ category: "MARKETING", ratePerMessage: money(35) }}
          />
          <WhatsAppCostStrip
            category="MARKETING"
            templateLabel="proposal_followup_v3"
            recipients={30}
            ratePerMessage={money(35)}
            ratePerMessageExact="0.3467"
            estimatedCost={money(1040)}
            alternative={{ category: "UTILITY", ratePerMessage: money(6) }}
          />
        </Stack>
      </Entry>

      <Entry
        id="shell"
        title="Shell pieces · Kit §07"
        note="The scaffold owns AppShell, Sidebar and Topbar. These are the pieces its top bar does not have yet, plus the external minimal shell M07-S07 uses instead of the app shell."
      >
        <Stack>
          <Breadcrumb
            items={[
              { label: "Organisations", href: "#" },
              { label: "Aurora Manufacturing", href: "#" },
              { label: "OPP-0512" },
            ]}
          />
          <Row>
            <SearchTrigger onOpen={() => setPaletteOpen(true)} />
            <NotificationBell unread={3} />
            <NotificationBell unread={0} />
            <LanguageToggle value="EN" />
            <Avatar name="Amirah Yusof" />
            <Avatar name="Proposal Agent" kind="agent" />
          </Row>
          <ContentCard
            eyebrow="Sessions"
            title="Delivery schedule"
            actions={<SecondaryButton>Export</SecondaryButton>}
          >
            <p className="text-[13px] text-ink-secondary">
              A section card inside the route's own card. Two borders, no third surface.
            </p>
          </ContentCard>
          <div className="h-[220px] overflow-hidden rounded-card border border-border">
            <ExternalMinimalShell
              orgName="Aurora Manufacturing Sdn Bhd"
              contact="+60 3 5566 7788"
              languageToggle={<LanguageToggle value="EN" />}
            >
              <p className="p-4 text-[13px] text-ink-secondary">
                A client-facing proposal. No sidebar and, deliberately, no primary button — this is
                a locked state.
              </p>
            </ExternalMinimalShell>
          </div>
        </Stack>
      </Entry>

      <Entry
        id="states"
        title="Empty, loading, error and skeletons · Kit §05"
        note="The scaffold owns the three states; the kit re-exports them so a screen has one import for everything visual. Skeletons hold the real shape so the page does not jump."
      >
        <Stack>
          <EmptyState
            title="No follow-ups due"
            description="Everything in this queue has been sent or dismissed."
            action={<SecondaryButton>Change rule</SecondaryButton>}
          />
          <LoadingState label="Loading opportunities" />
          <ErrorState
            title="Could not load the queue"
            description="The approvals service did not answer."
          />
          <SkeletonText lines={3} />
          <SkeletonMetrics />
          <div className="overflow-hidden rounded-card border border-border">
            <SkeletonTable rows={3} columns={4} />
          </div>
          <Skeleton className="h-8 w-40" />
        </Stack>
      </Entry>

      <Entry
        id="surfaces"
        title="Drawer, confirm dialog and command palette · Kit §05"
        note="One drawer for audit, assistant and detail: three drawers would be three sets of focus bugs. The confirm dialog focuses Cancel, not the destructive button."
      >
        <Row>
          <SecondaryButton onClick={() => setDrawerOpen(true)}>Open drawer</SecondaryButton>
          <SecondaryButton onClick={() => setConfirmOpen(true)}>Open confirm</SecondaryButton>
          <SecondaryButton onClick={() => setPaletteOpen(true)}>Open palette (⌘K)</SecondaryButton>
        </Row>
      </Entry>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Audit trail"
        subtitle="ORG-0114"
        footer={<SecondaryButton onClick={() => setDrawerOpen(false)}>Close</SecondaryButton>}
      >
        <Stack>
          {[1, 2, 3].map((n) => (
            <div key={n} className="flex flex-col gap-1 border-b border-divider pb-3">
              <p className="text-[13px] text-ink">ProposalDrafted</p>
              <p className="text-[12px] text-ink-muted">
                Proposal Agent · <DateText value="2026-10-14T09:41:00+08:00" withTime />
              </p>
            </div>
          ))}
        </Stack>
      </Drawer>

      <ConfirmDialog
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => setConfirmOpen(false)}
        title="Request unlock for ENG-0311?"
        description="Attendance was locked when HRD Corp approved the claim. Unlocking notifies Finance and reopens the claim packet for review."
        confirmLabel="Request unlock"
      />

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        query={query}
        onQueryChange={setQuery}
        onAsk={() => undefined}
        results={{
          records: [
            {
              type: "ORGANISATION",
              ref: "ORG-0114",
              title: "Aurora Manufacturing Sdn Bhd",
              subtitle: "Shah Alam",
              path: "/organisations/ORG-0114",
            },
            {
              type: "PROPOSAL",
              ref: "PRO-2026-0188",
              title: "Leading Through Change · Aurora",
              subtitle: "Awaiting approval",
              path: "/proposals/PRO-2026-0188",
            },
          ],
          actions: [{ type: "PROPOSAL_SEND", label: "Send proposal", targetRef: "PRO-2026-0188" }],
        }}
      />

      <Fab onClick={() => undefined} />
    </div>
  );
}
