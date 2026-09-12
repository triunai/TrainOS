import type { TraceNode, TraceNodeKind } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";
import { MoneyText } from "./Money";
import { FOCUS_RING } from "./tokens";
import { formatDuration } from "./AgentRunCard";

/**
 * One node of the orchestrator execution tree. Kit.dc.html §10 "Trace tree
 * node", whose grammar is three rules: depth by indent, status by glyph, cost
 * and tokens right-aligned.
 *
 * A halted node takes the AI tint — verbatim: "policy interception is the thing
 * worth seeing." That is the one background this component paints.
 *
 * The `◆` at depth 0 is the orchestrator; `✓`, `⏸` and the rest are step
 * statuses. Depth 0 is bold and deeper nodes are not, so the tree's shape is
 * readable before any glyph is decoded.
 *
 * Rendered as list items: a tree is a list of lists, and `role="treeitem"` with
 * `aria-level` is what lets a screen reader report the depth this component
 * communicates with indentation.
 */

const KIND_GLYPH: Record<TraceNodeKind, string> = {
  ORCHESTRATOR: "◆",
  SUB_AGENT: "◇",
  TOOL: "·",
};

const STATUS_CLASS = {
  OK: "text-success",
  RETRIED: "text-warning",
  FAILED: "text-danger",
  HALTED: "text-primary-hover",
} as const;

const STATUS_GLYPH = {
  OK: "✓",
  RETRIED: "↻",
  FAILED: "✕",
  HALTED: "⏸",
} as const;

export interface TraceTreeNodeProps {
  node: TraceNode;
  /** 0 for the orchestrator. Drives the indent and `aria-level`. */
  depth?: number;
  /** Undefined when the node has no children to expand. */
  expanded?: boolean;
  onToggle?: () => void;
  className?: string;
}

export function TraceTreeNode({
  node,
  depth = 0,
  expanded,
  onToggle,
  className,
}: TraceTreeNodeProps) {
  const halted = node.status === "HALTED";

  const meta = [
    node.tier ? node.tier.replace(/_/g, "-") : null,
    typeof node.cacheHitRate === "number" ? `cache ${Math.round(node.cacheHitRate * 100)}%` : null,
    node.retries ? `${node.retries} retries` : null,
    node.haltedBy ? `→ ${node.haltedBy.approvalRequestRef}` : null,
  ].filter(Boolean);

  return (
    <li
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={expanded}
      className={cn(
        "flex items-start gap-2.5 border-t border-divider py-2 pr-3",
        halted && "bg-ai-tint",
        className,
      )}
      style={{ paddingLeft: 12 + depth * 22 }}
    >
      {depth > 0 ? (
        <span aria-hidden="true" className="w-3 shrink-0 font-mono text-[11px] text-ink-disabled">
          └
        </span>
      ) : null}

      <span
        aria-hidden="true"
        className={cn(
          "w-3.5 shrink-0 text-center font-mono text-[13px]",
          STATUS_CLASS[node.status],
        )}
      >
        {depth === 0 ? KIND_GLYPH[node.kind] : STATUS_GLYPH[node.status]}
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-[13px] text-ink",
            depth === 0 ? "font-semibold" : "font-normal",
          )}
        >
          {node.name}
        </span>
        {meta.length > 0 ? (
          <span className="block truncate pt-0.5 text-[12px] text-ink-muted">
            {meta.join(" · ")}
          </span>
        ) : null}
      </span>

      <span className="shrink-0 whitespace-nowrap text-right font-mono text-[11px] text-ink-muted">
        {typeof node.durationMs === "number" ? formatDuration(node.durationMs) : "—"}
        {node.cost ? (
          <>
            {" · "}
            <MoneyText value={node.cost} />
          </>
        ) : null}
      </span>

      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label={expanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
          className={cn(
            "shrink-0 rounded-[4px] px-0.5 text-[12px] text-ink-disabled hover:text-ink",
            FOCUS_RING,
          )}
        >
          <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
        </button>
      ) : null}
    </li>
  );
}

export interface TraceTreeProps {
  /** Flat nodes with `parentId`, exactly as the contract returns them. */
  nodes: TraceNode[];
  label?: string;
  className?: string;
}

/**
 * The whole tree, assembled from the flat `TraceNode[]` the contract sends.
 *
 * Depth is derived by walking `parentId` rather than being sent, so a node
 * cannot claim a depth its parent contradicts.
 */
export function TraceTree({ nodes, label = "Execution trace", className }: TraceTreeProps) {
  const depthOf = (node: TraceNode): number => {
    let depth = 0;
    let current = node;
    /* Bounded by the node count, so a malformed cycle cannot hang the render. */
    for (let guard = 0; guard < nodes.length && current.parentId; guard += 1) {
      const parent = nodes.find((candidate) => candidate.id === current.parentId);
      if (!parent) break;
      current = parent;
      depth += 1;
    }
    return depth;
  };

  return (
    <ul
      role="tree"
      aria-label={label}
      className={cn("overflow-hidden rounded-card border border-border bg-card", className)}
    >
      {nodes.map((node) => (
        <TraceTreeNode key={node.id} node={node} depth={depthOf(node)} />
      ))}
    </ul>
  );
}
