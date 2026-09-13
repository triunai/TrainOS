import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APPROVAL_AURORA,
  DOCUMENT_CIRCULAR_09,
  ENGAGEMENT_AURORA,
  ENQUIRY_AURORA,
  PROPOSAL_AURORA,
  QUOTATION_AURORA,
  TNA_AURORA,
  type AuditEntry,
  type ListResponse,
} from "@trainos/contract";
import { fixtureClient, forbidden, type FixtureClient } from "@trainos/fixtures";
import {
  AttendanceCapturePage,
  ATTENDANCE_CAPTURE_PATTERN,
  EngagementDetailPage,
} from "@/features/engagements";
import { Organisation360Page } from "@/features/organisations";
import { TnaDetailPage } from "@/features/tna";
import { EnquiryDetailPage } from "@/features/enquiries";
import { ProposalBuilderPage, CostingWorksheetPage } from "@/features/proposals";
import { RuleChangeReviewScreen, RulesRegistryScreen } from "@/features/hrdc";
import { RunTraceScreen } from "@/features/agents";
import { ApprovalDetail } from "@/features/approvals";
import { ClientProposalPage } from "@/features/portal";
import { OrganisationSettingsScreen } from "@/features/settings";
import { AiModelsScreen, UsageBudgetsScreen } from "@/features/settings-ai";
import { renderScreen } from "@/test/renderScreen";

/**
 * The empty and error branches of every screen this pass touched, driven
 * through the fixture client rather than through props a test invented.
 *
 * The point of doing it this way is that these two branches are the ones
 * nobody looks at. A screen's happy path is exercised by every other test in
 * the repo and by anyone who opens it; the branch that only appears when a
 * request fails is written once, never seen again, and is exactly where the
 * thirteen swallowed errors and the four missing empty states were hiding.
 *
 * How the failures are injected: `renderScreen` mounts the shared
 * `fixtureClient` through `ApiProvider`'s default context, so spying on ONE of
 * its methods fails ONE read and leaves the rest of the screen answering
 * normally. That is the shape that matters here — every defect in this pass
 * was a SUPPORTING read failing while the primary succeeded, which is why none
 * of them showed up as a broken screen.
 *
 * `forbidden()` rather than a bare `Error` wherever the branch under test has
 * to tell a refusal from a dropped connection. R2: a refusal is a fact about
 * the request, never retried, and the components read that off the error rather
 * than being told.
 */

/** The client's async methods — everything a screen can read through. */
type ReadMethod = {
  [K in keyof FixtureClient]: FixtureClient[K] extends (...args: never[]) => Promise<unknown>
    ? K
    : never;
}[keyof FixtureClient];

type Answer<K extends ReadMethod> = Awaited<ReturnType<FixtureClient[K]>>;

/**
 * Return the client's REAL answer with one field emptied.
 *
 * Deliberately not a hand-written stub. An empty state has to be reached
 * through a payload the contract actually produces, or the test proves the
 * screen can render a shape the server never sends.
 */
function emptied<K extends ReadMethod>(
  method: K,
  transform: (answer: Answer<K>) => Answer<K>,
): void {
  const original = fixtureClient[method].bind(fixtureClient) as (
    ...args: unknown[]
  ) => Promise<Answer<K>>;

  vi.spyOn(fixtureClient, method as never).mockImplementation((async (...args: unknown[]) =>
    transform(await original(...args))) as never);
}

/** Fail one read, as a domain refusal — the kind that must not offer a retry. */
function refuses(method: ReadMethod, message: string): void {
  vi.spyOn(fixtureClient, method as never).mockRejectedValue(forbidden(message) as never);
}

afterEach(() => {
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ *
 * Error branches — the supporting read that used to fail in silence
 * ------------------------------------------------------------------ */

describe("M09-S02 · engagement detail", () => {
  const at = {
    path: `/training/engagements/${ENGAGEMENT_AURORA}`,
    route: "/training/engagements/:id",
    role: "OPS" as const,
  };

  it("says the client's name did not load instead of dropping it from the header", async () => {
    refuses("getOrganisation", "You may not read this organisation.");

    renderScreen(<EngagementDetailPage />, at);

    expect(await screen.findByText("The client's name could not be loaded")).toBeInTheDocument();
  });

  it("withholds the retry, because a refusal is not something a second try fixes", async () => {
    refuses("getPipelineConfig", "Pipeline configuration is not yours to read.");

    renderScreen(<EngagementDetailPage />, at);

    await screen.findByText("The pipeline's stage names could not be loaded");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("names both reads in one banner rather than stacking two", async () => {
    refuses("getOrganisation", "No.");
    refuses("getPipelineConfig", "No.");

    renderScreen(<EngagementDetailPage />, at);

    const banner = await screen.findByText("Parts of this record could not be loaded");
    expect(banner).toBeInTheDocument();
    expect(screen.queryByText("The client's name could not be loaded")).toBeNull();
  });

  it("says what would fill the sessions table when the engagement has no days", async () => {
    emptied("getEngagement", (engagement) => ({ ...engagement, sessions: [] }));

    renderScreen(<EngagementDetailPage />, at);

    expect(await screen.findByText("No sessions scheduled yet")).toBeInTheDocument();
    expect(screen.getByText(/Delivery days appear here/)).toBeInTheDocument();
  });
});

describe("M04-S02 · organisation 360", () => {
  const at = {
    path: "/sales/organisations/ORG-0114",
    route: "/sales/organisations/:organisationId",
  };

  it("distinguishes suggestions that failed from an organisation with none", async () => {
    refuses("getOrganisationSuggestions", "Cross-sell is not yours to read.");

    renderScreen(<Organisation360Page />, at);

    expect(await screen.findByText("Suggestions did not load")).toBeInTheDocument();
    expect(screen.queryByText("No suggestions for this organisation")).toBeNull();
  });

  it("says so when the agent genuinely has nothing to suggest", async () => {
    emptied("getOrganisationSuggestions", (answer) => ({ ...answer, data: [] }));

    renderScreen(<Organisation360Page />, at);

    expect(await screen.findByText("No suggestions for this organisation")).toBeInTheDocument();
    expect(screen.queryByText("Suggestions did not load")).toBeNull();
  });

  it("surfaces a failed deal-chain configuration rather than a stepper with no labels", async () => {
    refuses("getPipelineConfig", "Pipeline configuration is not yours to read.");

    renderScreen(<Organisation360Page />, at);

    expect(
      await screen.findByText("The deal chain's stage names could not be loaded"),
    ).toBeInTheDocument();
  });
});

describe("M05-S02 · TNA detail", () => {
  it("says the client did not load rather than falling back to the bare reference", async () => {
    refuses("getOrganisation", "You may not read this organisation.");

    renderScreen(<TnaDetailPage />, {
      path: `/sales/tna/${TNA_AURORA}`,
      route: "/sales/tna/:tnaId",
    });

    expect(
      await screen.findByText("The client this TNA belongs to could not be loaded"),
    ).toBeInTheDocument();
  });
});

describe("M03-S02 · enquiry detail", () => {
  it("tells a levy that could not be fetched from a levy that is genuinely absent", async () => {
    refuses("getOrganisation", "You may not read this organisation.");

    renderScreen(<EnquiryDetailPage />, {
      path: `/sales/enquiries/${ENQUIRY_AURORA}`,
      route: "/sales/enquiries/:enquiryId",
    });

    expect(
      await screen.findByText("The matched organisation's HRD Corp levy could not be loaded"),
    ).toBeInTheDocument();
  });
});

describe("M07-S02 · proposal builder", () => {
  const at = {
    path: `/sales/proposals/${PROPOSAL_AURORA}`,
    route: "/sales/proposals/:proposalRef",
  };

  it("says the client did not load rather than quietly shortening the title", async () => {
    refuses("getOrganisation", "You may not read this organisation.");

    renderScreen(<ProposalBuilderPage />, at);

    expect(
      await screen.findByText("The client this proposal is for could not be loaded"),
    ).toBeInTheDocument();
  });

  it("uses the kit's empty state for a proposal with no sections, not a banner", async () => {
    emptied("getProposal", (proposal) => ({ ...proposal, sections: [] }));

    renderScreen(<ProposalBuilderPage />, at);

    expect(await screen.findByText("This proposal has no sections yet")).toBeInTheDocument();
    /* The ExceptionBanner that used to stand here carried role="status". */
    expect(screen.queryByText("This proposal has no sections yet.")).toBeNull();
  });
});

describe("M07-S03 · costing worksheet", () => {
  it("says the rate card did not load, because DECISIONS §5 makes its version load-bearing", async () => {
    refuses("getRateCard", "The rate card is not yours to read.");

    renderScreen(<CostingWorksheetPage />, {
      path: `/finance/quotations/${QUOTATION_AURORA}`,
      route: "/finance/quotations/:quotationRef",
    });

    expect(
      await screen.findByText("The rate card this costing is priced against could not be loaded"),
    ).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ *
 * Empty branches — the four collections that can genuinely be empty
 * ------------------------------------------------------------------ */

describe("M12-S08 · rule change review", () => {
  it("says the circular contained no rule changes rather than drawing an empty column", async () => {
    emptied("getRuleChangeSet", (set) => ({ ...set, changes: [] }));

    renderScreen(<RuleChangeReviewScreen documentId={DOCUMENT_CIRCULAR_09} />, {
      path: `/compliance/rule-changes/${DOCUMENT_CIRCULAR_09}`,
      route: "/compliance/rule-changes/:documentId",
      role: "ADMIN",
    });

    expect(
      await screen.findByText("No rule changes were read from this document"),
    ).toBeInTheDocument();
    expect(screen.getByText(/found nothing that differs/)).toBeInTheDocument();
  });
});

describe("M18-S04 · run trace", () => {
  it("says a clean run recorded no events, and names what would have been here", async () => {
    emptied("getRun", (run) => ({ ...run, events: [] }));

    renderScreen(<RunTraceScreen />, {
      path: "/automation/runs/run_4821",
      route: "/automation/runs/:runRef",
    });

    expect(await screen.findByText("No events recorded for this run")).toBeInTheDocument();
    expect(screen.getByText(/Escalations, jury votes, truncations/)).toBeInTheDocument();
  });
});

describe("M02-S02 · approval detail", () => {
  const at = {
    path: `/approvals/${APPROVAL_AURORA}`,
    route: "/approvals/:ref",
    role: "MD" as const,
  };

  it("does not print a count of zero over an audit trail that failed to load", async () => {
    refuses("getAudit", "The audit trail is not yours to read.");

    renderScreen(<ApprovalDetail />, at);

    expect(await screen.findByText("The audit trail did not load")).toBeInTheDocument();
    /* The defect, precisely: the heading counted `?? 0`, so a failed read and
       an empty one printed the same words. */
    expect(screen.queryByText("Audit trail · 0")).toBeNull();
    expect(screen.getByText("Audit trail")).toBeInTheDocument();
  });

  it("says nothing has been recorded yet when the trail is genuinely empty", async () => {
    emptied("getAudit", (answer: ListResponse<AuditEntry>) => ({ ...answer, data: [] }));

    renderScreen(<ApprovalDetail />, at);

    expect(await screen.findByText("Nothing recorded yet")).toBeInTheDocument();
    expect(screen.getByText("Audit trail · 0")).toBeInTheDocument();
    expect(screen.queryByText("The audit trail did not load")).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Refused writes — the two mutations whose error nothing rendered
 * ------------------------------------------------------------------ */

describe("M12-S07 · rules registry", () => {
  it("tells the reader the rule was refused instead of leaving the drawer open and silent", async () => {
    refuses("createComplianceRule", "Only compliance may file a rule.");

    renderScreen(<RulesRegistryScreen />, {
      path: "/compliance/rules",
      route: "/compliance/rules",
      role: "ADMIN",
    });

    await userEvent.click(await screen.findByRole("button", { name: /Add rule/ }));

    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/Rule id/i), "HRD-999");
    await userEvent.type(within(dialog).getByLabelText(/Subject/i), "A rule nobody may file");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add rule" }));

    await waitFor(() => expect(screen.getByText("The rule was not added")).toBeInTheDocument());
  });
});

/* ------------------------------------------------------------------ *
 * The carried-over empty branches — §5's nine screens with no EmptyState
 *
 * Same method as above and for the same reason: every one of these is a
 * collection the server can genuinely return empty, on a screen whose happy
 * path everyone has seen and whose empty path nobody has. Three of the nine
 * (`EnquiryDetailPage`, `CostingWorksheetPage`, `ClaimPacketScreen`) belong to
 * other lanes tonight and are deliberately absent here.
 * ------------------------------------------------------------------ */

describe("M10-S06 · attendance capture", () => {
  const at = {
    path: `/training/participants/${ENGAGEMENT_AURORA}/attendance`,
    route: ATTENDANCE_CAPTURE_PATTERN,
    role: "OPS" as const,
  };

  it("says the sheet exists but the roster is empty, rather than drawing a headed table with no rows", async () => {
    emptied("getAttendance", (sheet) => ({ ...sheet, rows: [] }));

    renderScreen(<AttendanceCapturePage />, at);

    expect(await screen.findByText("Nobody is registered for this day")).toBeInTheDocument();
    expect(screen.getByText(/Participants are enrolled on the engagement/)).toBeInTheDocument();
  });

  it("offers the retry the engagement read had no way to reach", async () => {
    vi.spyOn(fixtureClient, "getEngagement").mockRejectedValue(new Error("network"));

    renderScreen(<AttendanceCapturePage />, at);

    await screen.findByText("This engagement could not be opened");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("still withholds the retry when the engagement is refused rather than unreachable", async () => {
    refuses("getEngagement", "This engagement is not yours to read.");

    renderScreen(<AttendanceCapturePage />, at);

    await screen.findByText("This engagement could not be opened");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});

describe("M20-S19 · organisation settings", () => {
  const at = { path: "/settings/organisation", route: "/settings/organisation" };

  it("names an unconfigured pipeline instead of rendering a stepper with no steps", async () => {
    emptied("getPipelineConfig", (config) => ({ ...config, stages: [] }));

    renderScreen(<OrganisationSettingsScreen />, at);

    expect((await screen.findAllByText("No stages configured")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/renders empty/).length).toBeGreaterThan(0);
  });
});

describe("M20-S20 · AI models, tiers and routing", () => {
  const at = { path: "/settings/ai-models", route: "/settings/ai-models" };

  it("says no tier is published rather than showing an empty tier table", async () => {
    emptied("getAiTiers", (answer) => ({ ...answer, data: [] }));

    renderScreen(<AiModelsScreen />, at);

    expect(await screen.findByText("No model tiers published")).toBeInTheDocument();
  });

  it("replaces the assignment matrix with a sentence when nothing is routed", async () => {
    emptied("getAiRouting", (answer) => ({ ...answer, data: [] }));

    renderScreen(<AiModelsScreen />, at);

    expect(await screen.findByText("Nothing is routed yet")).toBeInTheDocument();
    /* The empty state takes the table's place rather than sitting under a
       sticky head over nine tier columns with no rows beneath it. */
    expect(screen.queryByRole("table", { name: "Action type to tier assignment" })).toBeNull();
  });
});

describe("M20-S16 · usage and budgets", () => {
  const at = { path: "/settings/usage", route: "/settings/usage" };

  it("names the grouping the reader is on when that grouping has no spend", async () => {
    emptied("getUsage", (answer) => ({ ...answer, breakdown: [] }));

    renderScreen(<UsageBudgetsScreen />, at);

    expect(await screen.findByText("No spend in this period")).toBeInTheDocument();
  });

  it("says nothing is capped, which is not the same as nothing loading", async () => {
    emptied("getBudgets", (answer) => ({ ...answer, data: [] }));

    renderScreen(<UsageBudgetsScreen />, at);

    expect(await screen.findByText("No caps set")).toBeInTheDocument();
    expect(screen.getByText(/no run will be refused for cost/)).toBeInTheDocument();
  });
});

describe("M05-S02 · TNA detail, empty branches", () => {
  const at = { path: `/sales/tna/${TNA_AURORA}`, route: "/sales/tna/:tnaId" };

  it("says the questionnaire recorded no gaps rather than drawing an empty gaps table", async () => {
    emptied("getTna", (tna) => ({ ...tna, gaps: [] }));

    renderScreen(<TnaDetailPage />, at);

    expect(await screen.findByText("No competency gaps recorded")).toBeInTheDocument();
  });

  it("drops the AI panel's tint when the agent ranked nothing, rather than framing an empty body", async () => {
    emptied("getTnaRecommendations", (answer) => ({ ...answer, data: [] }));

    renderScreen(<TnaDetailPage />, at);

    expect(await screen.findByText("No programme matched")).toBeInTheDocument();
    expect(screen.queryByText("Programme recommendation")).toBeNull();
  });
});

describe("M07-S07 · client proposal portal", () => {
  const at = { path: "/p/tok_aurora_pro_0184", route: "/p/:token" };

  it("says the document has no written sections while keeping the commercial summary", async () => {
    emptied("getPortalProposal", (proposal) => ({ ...proposal, sections: [] }));

    renderScreen(<ClientProposalPage />, at);

    expect(
      await screen.findByText("This proposal has no written sections yet"),
    ).toBeInTheDocument();
    /* The investment panel is built from `investment`, not from the prose, so
       it survives an empty body. */
    expect(screen.getByText(/Ask the person who sent you this link/)).toBeInTheDocument();
  });

  it("offers a retry on the one page whose reader has nowhere else to go", async () => {
    vi.spyOn(fixtureClient, "getPortalProposal").mockRejectedValue(new Error("network"));

    renderScreen(<ClientProposalPage />, at);

    await screen.findByText("This proposal link cannot be opened");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
