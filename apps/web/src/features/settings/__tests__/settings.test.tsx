import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OrganisationSettingsScreen } from "../OrganisationSettingsScreen";
import { PoliciesSettingsScreen } from "../PoliciesSettingsScreen";
import { TemplatesSettingsScreen } from "../TemplatesSettingsScreen";
import { renderScreen } from "@/test/renderScreen";

/**
 * The three non-AI Settings screens, against the real fixture client.
 *
 * None has an artboard. What these assert is the shape all three were built to:
 * every endpoint behind them is a READ, so no screen renders a write it cannot
 * perform — not even a disabled one — and each says who would have to make the
 * change instead.
 */

describe("/settings/organisation", () => {
  it("renders the tenant the console is configured for", async () => {
    renderScreen(<OrganisationSettingsScreen />, {
      path: "/settings/organisation",
      route: "/settings/organisation",
    });
    expect(await screen.findAllByText("Akademi Perdana Sdn Bhd")).not.toHaveLength(0);
    expect(screen.getByText("Asia/Kuala_Lumpur")).toBeInTheDocument();
    expect(screen.getByText("MYR")).toBeInTheDocument();
  });

  it("reads every pipeline's stage names from the configuration", async () => {
    renderScreen(<OrganisationSettingsScreen />, {
      path: "/settings/organisation",
      route: "/settings/organisation",
    });
    /* CLAUDE.md: stage names and order render from pipeline configuration,
       never hardcoded. All three configured objects are drawn. */
    expect(await screen.findByText("Attendance locked")).toBeInTheDocument();
    expect(screen.getByText("Trainer confirmed")).toBeInTheDocument();
    expect(screen.getAllByText(/stages$/).length).toBe(3);
  });

  it("separates what the server believes from what the role switcher paints", async () => {
    renderScreen(<OrganisationSettingsScreen />, {
      path: "/settings/organisation",
      route: "/settings/organisation",
      /* The shell paints MD while the client stays signed in as Amirah, who
         is SALES. Passing `actorId` is what creates that disagreement: it
         drops the provider that would otherwise keep the two in step, which
         is the only way to exercise the case this screen is about. */
      role: "MD",
      actorId: "u_amirah",
    });
    expect(await screen.findByText("Amirah Yusof")).toBeInTheDocument();
    expect(screen.getByText(/the server wins and a denied write says so/)).toBeInTheDocument();
  });

  it("offers no write, not even a disabled one", async () => {
    renderScreen(<OrganisationSettingsScreen />, {
      path: "/settings/organisation",
      route: "/settings/organisation",
    });
    await screen.findByText("Profile");
    /* There is no organisation endpoint at all. A greyed-out Save would imply
       the write exists and the reader merely lacks the rights. */
    expect(screen.queryByRole("button", { name: /Save|Edit/ })).not.toBeInTheDocument();
    expect(screen.getAllByText(/Changed by an administrator/).length).toBe(3);
  });
});

describe("/settings/templates", () => {
  it("lists every template with its version and kind", async () => {
    renderScreen(<TemplatesSettingsScreen />, {
      path: "/settings/templates",
      route: "/settings/templates",
    });
    const table = await screen.findByRole("table", { name: "Templates" });
    expect(within(table).getByText("Standard proposal")).toBeInTheDocument();
    expect(within(table).getByText("v7")).toBeInTheDocument();
  });

  it("prices the WhatsApp templates and dashes the ones that have no rate", async () => {
    renderScreen(<TemplatesSettingsScreen />, {
      path: "/settings/templates",
      route: "/settings/templates",
    });
    await screen.findByRole("table", { name: "Templates" });
    await userEvent.click(screen.getByRole("tab", { name: /Whatsapp/i }));

    const table = screen.getByRole("table", { name: "Templates" });
    /* UTILITY at RM 0.06 against MARKETING at RM 0.35 is the gap the column
       exists to show before somebody chooses a template, not after the bill. */
    expect(within(table).getByText("Proposal follow-up")).toBeInTheDocument();
    expect(within(table).getAllByText(/RM 0\./).length).toBeGreaterThan(0);
    expect(within(table).getAllByText("Marketing").length).toBeGreaterThan(0);
  });

  it("builds its tabs from the kinds present, not from the contract's enum", async () => {
    renderScreen(<TemplatesSettingsScreen />, {
      path: "/settings/templates",
      route: "/settings/templates",
    });
    await screen.findByRole("table", { name: "Templates" });
    /* A tab for a kind the tenant has no template of can only ever show an
       empty state. */
    const tabs = screen.getAllByRole("tab");
    expect(tabs.length).toBeGreaterThan(1);
    for (const tab of tabs) {
      expect(tab.textContent).not.toMatch(/\b0$/);
    }
  });

  it("marks the AI-drafted sections with the tint and a word, never a fill", async () => {
    renderScreen(<TemplatesSettingsScreen />, {
      path: "/settings/templates",
      route: "/settings/templates",
    });
    await screen.findByRole("table", { name: "Templates" });
    /* The pack's AI rule: 6% tint plus the ✦ glyph plus a text label. The
       label is what this asserts; the tint is a token class. */
    expect(screen.getAllByText(/✦ AI drafted/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("written by hand").length).toBeGreaterThan(0);
  });
});

describe("/settings/policies", () => {
  it("prints a condition as the server sent it, and formats only the money", async () => {
    renderScreen(<PoliciesSettingsScreen />, {
      path: "/settings/policies",
      route: "/settings/policies",
    });
    await screen.findByRole("table", { name: "Approval policies" });

    /* The path and the operator are the server's vocabulary and are printed
       verbatim; 1500000 sen is formatted, because printing the integer would
       be wrong by four orders of magnitude. */
    expect(screen.getByText("payload.value.amount")).toBeInTheDocument();
    expect(screen.getByText("gte")).toBeInTheDocument();
    expect(screen.getByText("RM 15,000.00")).toBeInTheDocument();
  });

  it("says every time rather than leaving an unconditional gate blank", async () => {
    renderScreen(<PoliciesSettingsScreen />, {
      path: "/settings/policies",
      route: "/settings/policies",
    });
    const table = await screen.findByRole("table", { name: "Approval policies" });
    /* No conditions means ALWAYS, and an empty cell reads as never. */
    expect(within(table).getAllByText("Every time").length).toBeGreaterThan(0);
  });

  it("names the escalation, or says there is none", async () => {
    renderScreen(<PoliciesSettingsScreen />, {
      path: "/settings/policies",
      route: "/settings/policies",
    });
    const table = await screen.findByRole("table", { name: "Approval policies" });
    expect(within(table).getAllByText(/Md · 360 min/).length).toBeGreaterThan(0);
    expect(within(table).getAllByText("No escalation").length).toBeGreaterThan(0);
  });

  it("offers no write on a read-only endpoint and points at the live view", async () => {
    renderScreen(<PoliciesSettingsScreen />, {
      path: "/settings/policies",
      route: "/settings/policies",
    });
    await screen.findByRole("table", { name: "Approval policies" });
    expect(screen.queryByRole("button", { name: /Save|New policy|Edit/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Automation › Policies/ })).toHaveAttribute(
      "href",
      "/automation/policies",
    );
  });
});
