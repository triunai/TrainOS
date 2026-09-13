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
import { EngagementDetailPage } from "@/features/engagements";
import { Organisation360Page } from "@/features/organisations";
import { TnaDetailPage } from "@/features/tna";
import { EnquiryDetailPage } from "@/features/enquiries";
import { ProposalBuilderPage, CostingWorksheetPage } from "@/features/proposals";
import { RuleChangeReviewScreen, RulesRegistryScreen } from "@/features/hrdc";
import { RunTraceScreen } from "@/features/agents";
import { ApprovalDetail } from "@/features/approvals";
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
