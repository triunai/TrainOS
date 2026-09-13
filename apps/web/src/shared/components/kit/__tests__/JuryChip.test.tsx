import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { JuryPolicy, ProvenanceJury } from "@trainos/contract";
import { JuryChip } from "@/shared/components/kit/JuryChip";
import { describeJuryPolicy } from "@/shared/components/kit/adapters";

const RESULT: ProvenanceJury = {
  quorum: 2,
  of: 3,
  agreed: ["Claude Sonnet 5", "GPT-5"],
  dissented: [{ model: "Gemini 3", note: "Price below the usual floor" }],
};

const policy = (mode: JuryPolicy["mode"], extra: Partial<JuryPolicy> = {}): JuryPolicy => ({
  mode,
  quorum: 2,
  of: 3,
  tiers: ["STRONG_1"],
  ...extra,
});

describe("JuryChip", () => {
  it("renders a neutral chip when there is neither a result nor a policy", () => {
    render(<JuryChip />);
    expect(screen.getByText("No jury")).toBeInTheDocument();
  });

  it("renders a jury that voted, with its dissent in the tooltip", () => {
    render(<JuryChip jury={RESULT} />);
    const chip = screen.getByText(/Jury 2 of 3/);
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveAttribute("title", expect.stringContaining("Gemini 3"));
    expect(chip.className).toContain("bg-ai-tint");
  });

  /*
   * The tint rule, and it follows the contract rather than the mode's name.
   * §18: GATE runs at promotion time against the golden set only, and SAMPLE
   * runs after the human decides and never blocks. Only ESCALATE can stand
   * between a user and the action in front of them, so only ESCALATE is tinted.
   */
  it("tints an ESCALATE policy, which can block a live action", () => {
    render(
      <JuryChip
        policy={policy("ESCALATE", {
          triggers: {
            minConfidence: 0.7,
            maxValue: { amount: 5000000, currency: "MYR" },
            firstOfKind: true,
          },
        })}
      />,
    );

    const chip = screen.getByText(/Jury 2 of 3/);
    expect(chip.className).toContain("bg-ai-tint");
    expect(chip).toHaveAttribute("title", expect.stringContaining("Escalate"));
    expect(chip).toHaveAttribute("title", expect.stringContaining("RM 50,000"));
  });

  it("leaves a GATE policy neutral and says where it does run", () => {
    render(<JuryChip policy={policy("GATE")} />);

    const chip = screen.getByText("Jury at promotion");
    expect(chip.className).not.toContain("bg-ai-tint");
    expect(chip).toHaveAttribute("title", expect.stringContaining("Never blocks a live action"));
  });

  it("leaves a SAMPLE policy neutral and states its rate", () => {
    render(<JuryChip policy={policy("SAMPLE", { sampleRate: 0.05 })} />);

    const chip = screen.getByText("Jury sampled");
    expect(chip.className).not.toContain("bg-ai-tint");
    expect(chip).toHaveAttribute("title", expect.stringContaining("5%"));
  });

  /* A configured jury is not an absent one. "No jury" on a GATE row would be a
     different and wrong claim: there is one, it just is not in this path. */
  it("never says 'No jury' when a policy exists", () => {
    for (const mode of ["GATE", "SAMPLE", "ESCALATE"] as const) {
      const { unmount } = render(<JuryChip policy={policy(mode)} />);
      expect(screen.queryByText("No jury")).not.toBeInTheDocument();
      unmount();
    }
  });

  it("prefers a result over a policy when both are given", () => {
    render(<JuryChip jury={RESULT} policy={policy("GATE")} />);
    expect(screen.queryByText("Jury at promotion")).not.toBeInTheDocument();
    expect(screen.getByText(/Jury 2 of 3/)).toBeInTheDocument();
  });
});

describe("describeJuryPolicy", () => {
  it("names the conditions an ESCALATE jury blocks on", () => {
    const text = describeJuryPolicy(
      policy("ESCALATE", {
        triggers: {
          minConfidence: 0.7,
          maxValue: { amount: 5000000, currency: "MYR" },
          firstOfKind: true,
        },
      }),
    );

    expect(text).toContain("below confidence 0.7");
    expect(text).toContain("above RM 50,000");
    expect(text).toContain("first-of-kind");
  });

  it("survives an ESCALATE policy with no triggers", () => {
    expect(describeJuryPolicy(policy("ESCALATE"))).toContain("when a trigger fires");
  });
});
