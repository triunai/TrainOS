import { LifecycleStepper, type Step } from "@/components/kit";
import { FIN_LABEL, FIN_SPINE, OPS_LABEL, OPS_SPINE, type FinStage, type OpsStage } from "@/server/domain/stages";

/**
 * Both state machines, one above the other. Stage names and order come from
 * the FSM vocabulary (CLAUDE.md: never hardcoded in a screen). An exit state
 * (Postponed, Cancelled, Voided, Queried) is shown as a blocked/failed step at
 * the position the package left the spine.
 */
function steps<S extends string>(spine: readonly S[], labels: Record<S, string>, current: string, exits: Record<string, "BLOCKED" | "FAILED">): Step[] {
  const index = spine.indexOf(current as S);
  if (index >= 0) {
    return spine.map((s, i) => ({ key: s, label: labels[s], state: i < index ? "DONE" : i === index ? (i === spine.length - 1 ? "DONE" : "CURRENT") : "PENDING" }));
  }
  const exit = exits[current] ?? "BLOCKED";
  return [...spine.map((s) => ({ key: s, label: labels[s], state: "PENDING" as const })), { key: current, label: labels[current as S] ?? current, state: exit }];
}

export function DualStepper({ ops, fin }: { ops: string; fin: string }) {
  const opsSteps = steps<OpsStage>(OPS_SPINE, OPS_LABEL, ops, { POSTPONED: "BLOCKED", CANCELLED: "FAILED" });
  const finSpine = fin === "UPFRONT_CLAIM_SUBMITTED" ? (["ESTIMATE", "GRANT_RESERVED", "UPFRONT_CLAIM_SUBMITTED", ...FIN_SPINE.slice(2)] as FinStage[]) : FIN_SPINE;
  const finSteps = fin === "QUERIED"
    ? finSpine.map((s) => ({ key: s, label: FIN_LABEL[s], state: (finSpine.indexOf(s) < finSpine.indexOf("CLAIM_SUBMITTED") ? "DONE" : s === "CLAIM_SUBMITTED" ? "BLOCKED" : "PENDING") as Step["state"], caption: s === "CLAIM_SUBMITTED" ? "Queried by HRD Corp" : undefined }))
    : steps<FinStage>(finSpine, FIN_LABEL, fin, { VOIDED: "FAILED" });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span className="w-[76px] shrink-0 pt-[1px] text-[11px] font-medium text-[rgb(var(--on-accent))]">Operational</span>
        <LifecycleStepper steps={opsSteps} />
      </div>
      <div className="flex items-start gap-3">
        <span className="w-[76px] shrink-0 pt-[1px] text-[11px] font-medium text-[rgb(var(--on-accent))]">Financial</span>
        <LifecycleStepper steps={finSteps} />
      </div>
    </div>
  );
}
