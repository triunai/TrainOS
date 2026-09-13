import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * R11 · the control that can say no to a silent refusal.
 *
 * `queryClient.ts` states the asymmetry and calls the flag mandatory: a write
 * fired from a button with nothing awaiting it MUST carry
 * `meta: { toastOnError: true }`, because the centralised `MutationCache` is
 * the only thing that renders a failed fire-and-forget write. Seven mutations
 * had neither the flag nor a screen that read their `error`, so a denied write
 * showed the user nothing at all and the only symptom was "the button does
 * nothing".
 *
 * A prose rule that four of forty call sites followed is not a control. This
 * test is the control: every `useMutation` in a feature data layer either
 * carries the flag, or names itself here with the surface that renders its
 * refusal instead. A new mutation defaults to needing the flag — the exemption
 * is the thing you have to argue for, which is the right way round.
 */

const FEATURES = path.resolve(__dirname, "../../../features");

/**
 * Mutations that deliberately carry no flag, each with the surface that makes
 * the refusal visible instead. A flag here would double-report.
 *
 * Two shapes qualify, and only two:
 *   - the call site `await`s `mutateAsync` inside a try/catch that renders; or
 *   - a screen reads the hook's `.error`/`.isError` and renders it.
 */
const EXEMPT = new Map<string, string>([
  [
    "useBulkDecideApprovals",
    "ApprovalInbox.tsx:265 awaits mutateAsync and renders the failure inline; queryClient.ts:149 names this the model exemption",
  ],
  [
    "useMarkPacketSubmitted",
    "ClaimPacketScreen.tsx:87 awaits mutateAsync and renders the returned outcome",
  ],
  [
    "useApproveRuleChanges",
    "RuleChangeReviewScreen.tsx:127 awaits mutateAsync and renders the returned outcome",
  ],
  ["useCaptureAttendance", "AttendanceCapturePage.tsx:202 renders capture.error"],
  ["useRecordPayment", "InvoiceDetailScreen.tsx:412 renders recordPayment.error"],
  ["useRepushInvoice", "InvoiceDetailScreen.tsx:168 renders repush.error"],
  ["useSendReminder", "CollectionsQueueScreen.tsx:279 renders send.error through ActionOutcome"],
  ["usePauseAgent", "AgentRegistryScreen.tsx:379 renders pause.error through RefusalBanner"],
  ["useRetryRun", "RunTraceScreen.tsx:333 renders retry.error through RefusalBanner"],
  ["useCheckSource", "KnowledgeSourcesScreen.tsx:293 renders check.error through RefusalBanner"],
  ["usePutAiRouting", "AiModelsScreen.tsx:358 renders apply.isError through RefusalBanner"],
  [
    "useCreateProvider",
    "AddProviderKeyDrawer.tsx:103 renders create.isError through RefusalBanner",
  ],
  ["useTestProvider", "ProviderKeysScreen.tsx:169 renders test.isError through RefusalBanner"],
  ["useRevealProvider", "ProviderKeysScreen.tsx:174 renders reveal.isError through RefusalBanner"],
  ["usePutBudget", "UsageBudgetsScreen.tsx:284 renders raise.isError through RefusalBanner"],
  ["useEditProgramme", "ProgrammeDetailPage.tsx:306 renders edit.isError"],
  ["useEditSection", "ProposalBuilderPage.tsx:216 renders edit.error"],
  ["useAddSection", "ProposalBuilderPage.tsx:197 renders addSection.error"],
  ["useRegenerateSection", "ProposalBuilderPage.tsx:216 renders regenerate.error"],
  ["useSendProposal", "ProposalBuilderPage.tsx:171 renders send.isError"],
  ["useApplyQuotation", "CostingWorksheetPage.tsx:171 renders apply.isError"],
  ["useAttachDocument", "carries the flag; listed for completeness only"],
  ["useAddPortalComment", "ClientProposalPage.tsx:146 renders comment.error"],
  ["useAcceptPortalProposal", "ClientProposalPage.tsx:126 renders accept.error"],
  ["useDecideApproval", "carries the flag; listed for completeness only"],
]);

interface Hook {
  feature: string;
  name: string;
  flagged: boolean;
}

/**
 * Every exported hook in a feature `api.ts` whose body calls `useMutation`.
 *
 * The split is on `export function`, so a hook's body runs to the next export.
 * That is exact for this tree: no feature api module nests an export.
 */
function mutationHooks(): Hook[] {
  const hooks: Hook[] = [];

  for (const feature of readdirSync(FEATURES, { withFileTypes: true })) {
    if (!feature.isDirectory()) continue;
    const file = path.join(FEATURES, feature.name, "api.ts");

    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }

    const blocks = source.split(/(?=^export function )/m);
    for (const block of blocks) {
      const declared = /^export function (use\w+)/.exec(block);
      if (!declared) continue;
      if (!block.includes("useMutation")) continue;
      hooks.push({
        feature: feature.name,
        name: declared[1] as string,
        flagged: block.includes("toastOnError: true"),
      });
    }
  }

  return hooks;
}

describe("R11 · every fire-and-forget write surfaces its refusal", () => {
  const hooks = mutationHooks();

  it("finds the feature mutations, so a broken scan cannot pass vacuously", () => {
    expect(hooks.length).toBeGreaterThanOrEqual(30);
  });

  it("leaves no mutation both unflagged and unaccounted for", () => {
    const silent = hooks
      .filter((hook) => !hook.flagged && !EXEMPT.has(hook.name))
      .map((hook) => `${hook.feature}/api.ts · ${hook.name}`);

    expect(silent).toEqual([]);
  });

  it("keeps the exemption list honest — no entry for a hook that no longer exists", () => {
    const names = new Set(hooks.map((hook) => hook.name));
    const stale = [...EXEMPT.keys()].filter((name) => !names.has(name));

    expect(stale).toEqual([]);
  });
});
