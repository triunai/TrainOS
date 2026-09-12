import { useState } from "react";
import type { AutomationRun } from "@trainos/contract";
import { ExceptionBanner, SecondaryButton, StatusChip } from "@/shared/components/kit";

/**
 * "Run now (mock)" — the dev-only proof that M18-S04 renders a REAL run.
 *
 * The trace viewer's fixture run is a hand-written `AutomationRun`. That is
 * fine for a screenshot and worthless as evidence: a viewer that only renders
 * the one trace somebody typed out has not been shown to render a trace. This
 * button drives `@trainos/agent-runtime`'s actual orchestrator with
 * `MockProvider` — the same routing, the same tool executions against the same
 * fixture data, the same jury, only the language is scripted — and hands the
 * resulting `AutomationRun` back to the screen, which renders it through the
 * identical components.
 *
 * Mock rather than live on purpose. A live provider needs a key, costs money
 * and varies run to run; the mock exercises every branch the viewer draws
 * (escalation, jury, handoff, checkpoint, policy halt) and costs nothing.
 *
 * `import.meta.env.DEV` gates the mount AND the import is dynamic, so the
 * runtime is a separate chunk that a production bundle never fetches.
 */

export interface RunNowPanelProps {
  /** Handed the finished run so the viewer can render it in place of the fixture. */
  onRun: (run: AutomationRun) => void;
  /** True while the viewer is showing a mock run rather than the fetched one. */
  showingMock: boolean;
  onClear: () => void;
}

export function RunNowPanel({ onRun, showingMock, onClear }: RunNowPanelProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slices, setSlices] = useState<number | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const runtimeModule = await import("@trainos/agent-runtime");
      const runtime = runtimeModule.createRuntime({
        agentId: runtimeModule.leadToProposalAgent.id,
        /* Never `auto`: a developer with ANTHROPIC_API_KEY exported would
           otherwise spend real money by clicking a button labelled "mock". */
        provider: "mock",
      });

      const { result, slices: sliceCount } = await runtimeModule.runAgentToCompletion({
        agent: runtimeModule.leadToProposalAgent,
        router: runtime.router,
        tools: runtime.tools,
        input: runtimeModule.LEAD_TO_PROPOSAL_INPUT,
      });

      setSlices(sliceCount);
      onRun(result.run);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "The mock run failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <SecondaryButton onClick={() => void run()} disabled={busy}>
          {busy ? "Running…" : "Run now (mock)"}
        </SecondaryButton>
        {showingMock ? (
          <>
            <StatusChip tone="info" shape="square">
              Live mock run
            </StatusChip>
            <SecondaryButton onClick={onClear}>Back to the stored run</SecondaryButton>
          </>
        ) : null}
      </div>

      {showingMock && slices !== null ? (
        <p className="text-[12px] text-ink-muted">
          Produced by the orchestrator in {slices} slice{slices === 1 ? "" : "s"}. Costs read as
          zero because nothing was spent, and each node names <code>mock-model</code> rather than
          the tier&rsquo;s model — a trace claiming Claude Sonnet 5 on a run that never called
          Anthropic would be worse than useless.
        </p>
      ) : null}

      {error ? (
        <ExceptionBanner severity="DANGER" title="The mock run failed" subtitle={error} />
      ) : null}
    </div>
  );
}
