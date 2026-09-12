/**
 * The TrainOS component kit.
 *
 * CLAUDE.md: "One design system, one component library." This is it. A screen
 * imports from `@/shared/components/kit` and from nowhere else for anything
 * visual — if the kit lacks something a screen needs, the kit gains it first and
 * the screen uses it second.
 *
 * Importing this module also pulls in `kit.css`, which supplies the three design
 * tokens the artboards use that the scaffold's `tokens.css` does not define yet.
 *
 * Sections below follow the Kit.dc.html catalogue order.
 */

import "./kit.css";

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
export { MoneyText, formatMoney, type MoneyTextProps } from "./Money";
export { DateText, formatDate, formatTime, type DateTextProps } from "./DateText";
export { KeyboardShortcut, type KeyboardShortcutProps } from "./KeyboardShortcut";
export { MiniBar, type BarState, type MiniBarProps } from "./Bar";
export {
  Skeleton,
  SkeletonText,
  SkeletonTable,
  SkeletonMetrics,
  type SkeletonProps,
} from "./Skeleton";
export { MoneyInput, toSen, toEditable, type MoneyInputProps } from "./MoneyInput";
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
  CHECK_TONE,
  ENGAGEMENT_TONE,
  INVOICE_TONE,
  LIFECYCLE_TONE,
  OPPORTUNITY_TONE,
  PACKET_TONE,
  PROPOSAL_TONE,
  RUN_TONE,
  SYNC_TONE,
  TIER_STATUS_TONE,
  humanise,
} from "./statusTone";
export { AIChip, AIBadge, variantOf, type AIChipProps, type AIChipVariant } from "./AIChip";
export { ProvenanceBlock, ProvenancePanel, type ProvenanceBlockProps } from "./ProvenanceBlock";
export {
  AutonomyChip,
  AUTONOMY_LADDER,
  autonomyCaption,
  type AutonomyChipProps,
} from "./AutonomyChip";
export { TierChip, tierLabel, type TierChipProps } from "./TierChip";
export { JuryChip, type JuryChipProps } from "./JuryChip";
export { CitationChip, type CitationChipProps } from "./CitationChip";
export { RefChip, TYPE_TAG, type RefChipProps } from "./RefChip";

/* ---- Workflow steppers (Kit §04) ------------------------------------ */
export {
  LifecycleStepper,
  describeSteps,
  type LifecycleStepperProps,
  type StepperVariant,
} from "./LifecycleStepper";
export { EscalationLadder, type EscalationLadderProps, type LadderRung } from "./EscalationLadder";

/* ---- System surfaces (Kit §05) -------------------------------------- */
export { ApprovalBanner, type ApprovalBannerProps } from "./ApprovalBanner";
export { ExceptionBanner, type ExceptionBannerProps } from "./ExceptionBanner";
export { DiffBlock, type DiffBlockProps } from "./DiffBlock";
export {
  ProposedActionCard,
  type ProposedActionCardProps,
  type ProposedMetric,
} from "./ProposedActionCard";
export { AgentRunCard, formatDuration, type AgentRunCardProps } from "./AgentRunCard";
export { RunStepRow, type RunStepRowProps } from "./RunStepRow";
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
  initials,
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
  chipsFromFilters,
  type Density,
  type DensityToggleProps,
  type FilterBarProps,
  type FilterChipModel,
} from "./FilterBar";
export { PillTabGroup, tabsFromViews, type PillTab, type PillTabGroupProps } from "./PillTabGroup";

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
  TokenBudgetBar,
  CostBudgetBar,
  type BudgetBarProps,
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
