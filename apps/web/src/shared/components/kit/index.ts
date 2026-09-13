/**
 * The TrainOS component kit.
 *
 * CLAUDE.md: "One design system, one component library." This is it. A screen
 * imports from `@/shared/components/kit` and from nowhere else for anything
 * visual — if the kit lacks something a screen needs, the kit gains it first and
 * the screen uses it second.
 *

 * Sections below follow the Kit.dc.html catalogue order.
 */

/* ---- Foundations (Kit §01) ------------------------------------------ */
export {
  AI_GLYPH,
  AI_POPOVER_BG,
  FOCUS_RING,
  MONO_LABEL,
  PEAK_BG,
  WARNING_ACCENT_BG,
} from "./tokens";
export {
  useSinglePrimary,
  setSinglePrimaryCheck,
  currentPrimaries,
  resetPrimaries,
} from "./useSinglePrimary";

/* ---- Pure helpers. These moved out of their component files so the kit has
       no import cycles and every component file can hot-reload; the names the
       barrel exports have not changed. ---------------------------------- */
export {
  formatMoney,
  formatDate,
  formatDateRange,
  formatRelativeDate,
  formatTime,
  formatPeriod,
  formatDuration,
  toSen,
  toEditable,
  tierLabel,
  initials,
  channelLabel,
  humanise,
  plural,
  stepLabel,
  describeSteps,
  type MessageChannel,
} from "./format";
export {
  aiVariantOf,
  /**
   * `variantOf` was this function's name when the kit first shipped and a
   * screen already imports it. The barrel's names are additive-only now that
   * screens build against them, so the old name stays as an alias rather than
   * becoming a rename every screen has to chase. Prefer `aiVariantOf`.
   */
  aiVariantOf as variantOf,
  AUTONOMY_LADDER,
  AUTONOMY_RUNGS,
  autonomyCaption,
  chipsFromFilters,
  describeActionError,
  describeJuryPolicy,
  tabsFromViews,
  TYPE_TAG,
  type ActionError,
  type AIChipVariant,
  type FilterChipModel,
  type PillTab,
} from "./adapters";

/* ---- Controls (Kit §03) --------------------------------------------- */
export {
  KitButton,
  PrimaryButton,
  SecondaryButton,
  GhostButton,
  DangerButton,
  IconButton,
  type ButtonKind,
  type ButtonProps,
  type IconButtonProps,
} from "./Button";
export { MoneyText, type MoneyTextProps } from "./Money";
export { DateText, type DateTextProps } from "./DateText";
export { KeyboardShortcut, type KeyboardShortcutProps } from "./KeyboardShortcut";
export { MiniBar, type BarState, type MiniBarProps } from "./Bar";
export {
  PairedBars,
  type PairedBarsPoint,
  type PairedBarsProps,
  type PairedBarsSeries,
  type PairedBarsTone,
} from "./PairedBars";
export {
  Skeleton,
  SkeletonText,
  SkeletonTable,
  SkeletonMetrics,
  type SkeletonProps,
} from "./Skeleton";
export { MoneyInput, type MoneyInputProps } from "./MoneyInput";
export {
  DateField,
  Field,
  TextArea,
  TextField,
  type DateFieldProps,
  type FieldControlProps,
  type FieldProps,
  type TextAreaProps,
  type TextFieldProps,
} from "./Field";
export { RelationPicker, type RelationOption, type RelationPickerProps } from "./RelationPicker";
export { WhatsAppCostStrip, type WhatsAppCostStripProps } from "./WhatsAppCostStrip";
export {
  ChecklistRow,
  CompletenessBar,
  DocumentChecklistRow,
  type ChecklistRowProps,
  type CompletenessBarProps,
  type DocumentChecklistRowProps,
} from "./Checklist";

/* ---- Chips: the only place status colour lives (Kit §02, §10) -------- */
export { StatusChip, type StatusChipProps, type StatusTone } from "./StatusChip";
export {
  APPROVAL_TONE,
  BINDING_FLOOR_TONE,
  BUDGET_TONE,
  CHECK_TONE,
  DIFF_OP_TONE,
  EMBEDDING_TONE,
  ENGAGEMENT_TONE,
  ENQUIRY_TONE,
  FOLLOW_UP_TONE,
  HRDC_PACKET_PANEL_TONE,
  INVOICE_TONE,
  LIFECYCLE_TONE,
  MONITOR_TONE,
  OPPORTUNITY_TONE,
  ORGANISATION_TONE,
  PACKET_TONE,
  PROGRAMME_TONE,
  PROPOSAL_TONE,
  PROVIDER_KEY_TONE,
  QUOTATION_TONE,
  RULE_TONE,
  RUN_TONE,
  SYNC_TONE,
  TIER_STATUS_TONE,
  TNA_TONE,
} from "./statusTone";
export { AIChip, AIBadge, type AIChipProps } from "./AIChip";
export { ProvenanceBlock, ProvenancePanel, type ProvenanceBlockProps } from "./ProvenanceBlock";
export { AutonomyChip, type AutonomyChipProps } from "./AutonomyChip";
export { TierChip, type TierChipProps } from "./TierChip";
export { JuryChip, type JuryChipProps } from "./JuryChip";
export { CitationChip, type CitationChipProps } from "./CitationChip";
export { RefChip, type RefChipProps } from "./RefChip";

/* ---- Workflow steppers (Kit §04) ------------------------------------ */
export {
  LifecycleStepper,
  type LifecycleStepperProps,
  type StepperVariant,
} from "./LifecycleStepper";
export { EscalationLadder, type EscalationLadderProps, type LadderRung } from "./EscalationLadder";

/* ---- System surfaces (Kit §05) -------------------------------------- */
export { ApprovalBanner, type ApprovalBannerProps } from "./ApprovalBanner";
export { ActionOutcome, type ActionOutcomeProps } from "./ActionOutcome";
export { ExceptionBanner, type ExceptionBannerProps } from "./ExceptionBanner";
export {
  PartialDataBanner,
  type PartialDataBannerProps,
  type PartialRead,
} from "./PartialDataBanner";
export { RefusalBanner, type RefusalBannerProps } from "./RefusalBanner";
export { DiffBlock, type DiffBlockProps } from "./DiffBlock";
export {
  ProposedActionCard,
  type ProposedActionCardProps,
  type ProposedMetric,
} from "./ProposedActionCard";
export { AgentRunCard, type AgentRunCardProps } from "./AgentRunCard";
export { RunStepRow, type RunStepRowProps } from "./RunStepRow";
export { RunEventRow, type RunEventRowProps } from "./RunEventRow";
export {
  Collapse,
  DisclosureButton,
  type CollapseProps,
  type DisclosureButtonProps,
} from "./Collapse";

export { ProfileModal, type ProfileModalProps, type ProfileField } from "./ProfileModal";

export { CommandPalette, type CommandPaletteProps } from "./CommandPalette";
export { Drawer, type DrawerProps } from "./Drawer";
export { ConfirmDialog, type ConfirmDialogProps } from "./ConfirmDialog";
export { toast, type ToastAction } from "./toast";

/* ---- Shell (Kit §07) ------------------------------------------------ */
export { Breadcrumb, type BreadcrumbProps, type Crumb } from "./Breadcrumb";
export {
  SearchTrigger,
  NotificationBell,
  Avatar,
  type AvatarProps,
  type NotificationBellProps,
  type SearchTriggerProps,
} from "./TopbarPieces";
export { ContentCard, Fab, type ContentCardProps, type FabProps } from "./ContentCard";
export {
  ExternalMinimalShell,
  LanguageToggle,
  type ExternalMinimalShellProps,
  type LanguageToggleProps,
} from "./ExternalMinimalShell";

/* ---- Data table (Kit §08) ------------------------------------------- */
export {
  DataTable,
  BulkActionBar,
  type BulkActionBarProps,
  type Column,
  type DataTableProps,
  type RowGroup,
} from "./DataTable";
export {
  FilterBar,
  DensityToggle,
  FilterSearch,
  FilterSelect,
  type Density,
  type DensityToggleProps,
  type FilterBarProps,
  type FilterSearchProps,
  type FilterSelectOption,
  type FilterSelectProps,
} from "./FilterBar";
export { PillTabGroup, type PillTabGroupProps } from "./PillTabGroup";
export { RowActionMenu, type RowAction, type RowActionMenuProps } from "./RowActionMenu";
export { ListToolbar, type ListToolbarProps } from "./ListToolbar";
export { SplitWorkspace, type SplitWorkspaceProps } from "./SplitWorkspace";

/* ---- Calendar (added 13 Sep 2026; no artboard draws one) ------------ */
export {
  CalendarGrid,
  CalendarList,
  type CalendarEntry,
  type CalendarGridProps,
  type CalendarListProps,
} from "./CalendarGrid";
export {
  WEEKDAY_LABELS,
  addDays,
  calendarDays,
  dayKeyOf,
  dayOfMonth,
  daysCovered,
  isSameMonth,
  periodLabel,
  shiftPeriod,
  startOfMonth,
  startOfWeek,
  type CalendarView,
} from "./calendar";

/* ---- RecordHeader & MetricStrip (Kit §09) --------------------------- */
export {
  RecordHeader,
  CondensedRecordHeader,
  type CondensedRecordHeaderProps,
  type RecordHeaderProps,
} from "./RecordHeader";
export {
  MetricStrip,
  MetricCell,
  AgingStrip,
  type AgingStripProps,
  type MetricCellProps,
  type MetricStripProps,
} from "./MetricStrip";

/* ---- AI operations (Kit §10) ---------------------------------------- */
export {
  BudgetBar,
  BudgetHeadline,
  TokenBudgetBar,
  CostBudgetBar,
  type BudgetBarProps,
  type BudgetHeadlineProps,
  type CostBudgetBarProps,
  type TokenBudgetBarProps,
} from "./BudgetBar";
export { AllowedHoursStrip, type AllowedHoursStripProps } from "./AllowedHoursStrip";
export { RuleCheckRow, type RuleCheckRowProps } from "./RuleCheckRow";
export {
  TraceTreeNode,
  TraceTree,
  type TraceTreeNodeProps,
  type TraceTreeProps,
} from "./TraceTreeNode";
export { StateCardPanel, type StateCardPanelProps } from "./StateCardPanel";

/* ---- States: the scaffold owns these; re-exported so a screen has ONE
       import for everything visual. Not reimplemented. ----------------- */
export { EmptyState, LoadingState, ErrorState } from "@/shared/components/states";
export type {
  EmptyStateProps,
  LoadingStateProps,
  ErrorStateProps,
} from "@/shared/components/states";

/* ---- Board (added 13 Sep 2026, brief §19; no artboard draws one) ----- */
export {
  KanbanBoard,
  lanesFrom,
  KANBAN_DRAG_TYPE,
  type KanbanBoardProps,
  type KanbanLane,
} from "./KanbanBoard";
