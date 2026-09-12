import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Provenance } from "@trainos/contract";
import { ProvenanceBlock, ProvenancePanel } from "@/shared/components/kit/ProvenanceBlock";

const BASE_PROVENANCE: Provenance = {
  origin: "AI_SUGGESTED",
  agentId: "agent-quote-drafter",
  runId: "run-42",
  sources: [{ type: "QUOTATION", ref: "QUO-0009" }],
  model: "claude-sonnet-5",
  provider: "ANTHROPIC",
  cacheHitRate: 0.75,
  tier: "STRONG_1",
  generatedAt: "2026-11-12T09:00:00+08:00",
};

describe("ProvenanceBlock", () => {
  it("renders the identity line with agent, run and source count", () => {
    render(<ProvenanceBlock provenance={BASE_PROVENANCE} />);
    expect(screen.getByText(/agent-quote-drafter/)).toHaveTextContent(
      "agent-quote-drafter · run run-42 · 1 source",
    );
  });

  it("renders the routing line with model, provider, cache rate and tier", () => {
    render(<ProvenanceBlock provenance={BASE_PROVENANCE} />);
    expect(
      screen.getByText("claude-sonnet-5 · via Anthropic · cache 75% · STRONG-1"),
    ).toBeInTheDocument();
  });

  it("renders 'Computed · no model' for a deterministic check instead of a model line", () => {
    render(<ProvenanceBlock provenance={{ origin: "SYSTEM", method: "DETERMINISTIC" }} />);
    expect(screen.getByText("Computed · no model")).toBeInTheDocument();
  });

  it("renders the decision line for an edited value, not the generated line", () => {
    render(
      <ProvenanceBlock
        provenance={{
          ...BASE_PROVENANCE,
          editedBy: { id: "u1", name: "Jane Tan", at: "2026-11-12T10:00:00+08:00" },
        }}
      />,
    );
    expect(screen.getByText(/Edited by Jane Tan/)).toBeInTheDocument();
    expect(screen.queryByText(/^Generated/)).not.toBeInTheDocument();
  });

  it("falls back to the generated line when no human has edited the value", () => {
    render(<ProvenanceBlock provenance={BASE_PROVENANCE} />);
    expect(screen.getByText(/Generated/)).toBeInTheDocument();
  });

  it("exposes Sources and Trace as accessible buttons that call their handlers", () => {
    const onOpenSources = vi.fn();
    const onOpenTrace = vi.fn();
    render(
      <ProvenanceBlock
        provenance={BASE_PROVENANCE}
        onOpenSources={onOpenSources}
        onOpenTrace={onOpenTrace}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sources" }));
    fireEvent.click(screen.getByRole("button", { name: "Trace" }));
    expect(onOpenSources).toHaveBeenCalledTimes(1);
    expect(onOpenTrace).toHaveBeenCalledTimes(1);
  });

  it("ProvenancePanel wraps the block with a titled section heading", () => {
    render(<ProvenancePanel provenance={BASE_PROVENANCE} />);
    expect(screen.getByRole("heading", { name: "Provenance" })).toBeInTheDocument();
  });
});
