/**
 * §2 · Session and shell — navigation, badges, saved views, audit, templates,
 * search, and the notification list the top-bar bell renders.
 *
 * The nav tree and the role map are the design pack's `build/kit.js` TREE and
 * ROLE verbatim, turned into the §2 `NavigationTree` shape. Badge counts are
 * inlined so the sidebar makes one call, and a badge is ALERT only when
 * something in that queue has breached an SLA or a deadline.
 *
 * `GET /v1/navigation` is a contract endpoint; the notification list is not —
 * the bell is drawn on every screen but no type covers it, so
 * `FixtureNotification` lives here and is reported as a gap.
 */

import type {
  AuditEntry,
  Badge,
  BadgeCounts,
  NavigationGroup,
  NavigationTree,
  Role,
  SavedView,
  SearchResult,
  Template,
  Timestamp,
} from "@trainos/contract";
import {
  AGENT_PROPOSAL,
  APPROVAL_AURORA,
  ENGAGEMENT_AURORA,
  ENQUIRY_AURORA,
  INVOICE_AURORA,
  ORG_AURORA,
  PROPOSAL_AURORA,
  RUN_PROPOSAL,
  TEMPLATE_EMAIL_PROPOSAL,
  TEMPLATE_FOLLOWUP_WHATSAPP,
  TEMPLATE_PROPOSAL,
  TEMPLATE_TNA,
  TNA_AURORA,
  USER_AMIRAH,
  USER_JASON,
  USER_KELVIN,
} from "@trainos/contract";
import { myr } from "./_helpers";

/** §11 the `badges` channel payload, and what `GET /v1/navigation` inlines. */
export const badgeCounts: BadgeCounts = { approvals: 7, hrdcDeadlines: 3, agentFailures: 2 };

const badge = (count: number, severity: Badge["severity"] = "DEFAULT"): Badge => ({ count, severity });

/**
 * The nav tree, before role filtering. Groups, parents and children follow
 * `build/kit.js`; `Reports` is a leaf with no children, exactly as there.
 */
const fullTree: NavigationGroup[] = [
  {
    caption: "MAIN",
    parents: [
      {
        key: "home",
        label: "Home",
        icon: "⌂",
        children: [
          { key: "dashboard", label: "Dashboard", path: "/dashboards/executive" },
          { key: "approvals", label: "Approvals", path: "/approvals", badge: badge(7) },
          { key: "my-tasks", label: "My tasks", path: "/tasks" },
        ],
      },
      {
        key: "sales",
        label: "Sales",
        icon: "⚑",
        children: [
          { key: "enquiries", label: "Enquiries", path: "/enquiries" },
          { key: "leads", label: "Leads", path: "/leads" },
          { key: "organisations", label: "Organisations", path: "/organisations" },
          { key: "contacts", label: "Contacts", path: "/contacts" },
          { key: "pipeline", label: "Pipeline", path: "/opportunities" },
          { key: "tna", label: "TNA", path: "/tnas" },
          { key: "proposals", label: "Proposals", path: "/proposals" },
        ],
      },
      {
        key: "relationships",
        label: "Relationships",
        icon: "⇄",
        children: [
          { key: "renewals", label: "Renewals", path: "/renewals" },
          { key: "cross-sell", label: "Cross-sell", path: "/cross-sell" },
          { key: "marketing", label: "Marketing", path: "/marketing" },
        ],
      },
    ],
  },
  {
    caption: "OPERATIONS",
    parents: [
      {
        key: "training",
        label: "Training",
        icon: "▧",
        children: [
          { key: "programmes", label: "Programmes", path: "/programmes" },
          { key: "engagements", label: "Engagements", path: "/engagements" },
          { key: "calendar", label: "Calendar", path: "/calendar" },
          { key: "trainers", label: "Trainers", path: "/trainers" },
          { key: "participants", label: "Participants", path: "/participants" },
          { key: "assessments", label: "Assessments", path: "/assessments" },
          { key: "certificates", label: "Certificates", path: "/certificates" },
        ],
      },
      {
        key: "compliance",
        label: "Compliance",
        icon: "⚖",
        /** ALERT: one claim window closes in three days. */
        badge: badge(6, "ALERT"),
        children: [
          { key: "hrd-corp", label: "HRD Corp", path: "/hrdc/packets", badge: badge(3, "ALERT") },
          { key: "rules", label: "Rules", path: "/compliance/rules" },
          { key: "rule-changes", label: "Rule changes", path: "/compliance/rule-changes", badge: badge(3) },
          { key: "documents", label: "Documents", path: "/compliance/documents" },
          { key: "deadlines", label: "Deadlines", path: "/hrdc/deadlines" },
        ],
      },
      {
        key: "finance",
        label: "Finance",
        icon: "▬",
        children: [
          { key: "quotations", label: "Quotations", path: "/quotations" },
          { key: "invoices", label: "Invoices", path: "/invoices" },
          { key: "collections", label: "Collections", path: "/collections/queue" },
          { key: "commissions", label: "Commissions", path: "/commissions" },
          { key: "profitability", label: "Profitability", path: "/reports/profitability" },
        ],
      },
    ],
  },
  {
    caption: "KNOWLEDGE",
    parents: [
      {
        key: "knowledge",
        label: "Knowledge",
        icon: "▢",
        badge: badge(1),
        children: [
          { key: "library", label: "Library", path: "/knowledge/library" },
          { key: "sources", label: "Sources", path: "/knowledge/sources", badge: badge(1) },
          { key: "templates", label: "Templates", path: "/templates" },
          { key: "knowledge-base", label: "Knowledge base", path: "/knowledge/base" },
        ],
      },
    ],
  },
  {
    caption: "SYSTEM",
    parents: [
      {
        key: "automation",
        label: "Automation",
        icon: "⌬",
        /** ALERT because the total includes a Failures queue with items in it. */
        badge: badge(2, "ALERT"),
        children: [
          { key: "agents", label: "Agents", path: "/agents" },
          { key: "runs", label: "Runs", path: "/runs" },
          { key: "failures", label: "Failures", path: "/runs?filter[status][eq]=FAILED", badge: badge(2, "ALERT") },
          { key: "policies", label: "Policies", path: "/policies" },
        ],
      },
      { key: "reports", label: "Reports", icon: "◫", path: "/reports" },
      {
        key: "settings",
        label: "Settings",
        icon: "⚙",
        children: [
          { key: "organisation", label: "Organisation", path: "/settings/organisation" },
          { key: "ai-models", label: "AI Models", path: "/settings/ai/tiers" },
          { key: "providers", label: "Providers", path: "/settings/ai/providers" },
          { key: "usage", label: "Usage", path: "/settings/ai/usage" },
          { key: "settings-templates", label: "Templates", path: "/settings/templates" },
          { key: "settings-policies", label: "Policies", path: "/settings/policies" },
        ],
      },
    ],
  },
];

/** The kit's ROLE map: which parents each role sees. `null` means everything. */
const roleVisibility: Record<Role, Record<string, string[]> | null> = {
  SALES: { MAIN: ["home", "sales", "relationships"], OPERATIONS: ["training"], KNOWLEDGE: ["knowledge"] },
  SALES_MANAGER: {
    MAIN: ["home", "sales", "relationships"],
    OPERATIONS: ["training"],
    KNOWLEDGE: ["knowledge"],
  },
  OPS: { MAIN: ["home"], OPERATIONS: ["training", "compliance"], KNOWLEDGE: ["knowledge"] },
  FINANCE: { MAIN: ["home"], OPERATIONS: ["finance", "compliance"], KNOWLEDGE: ["knowledge"] },
  MD: {
    MAIN: ["home", "sales", "relationships"],
    OPERATIONS: ["finance"],
    SYSTEM: ["automation", "reports"],
  },
  ADMIN: null,
  TRAINER: { MAIN: ["home"], OPERATIONS: ["training"] },
  CLIENT: {},
  AGENT: {},
};

/** §2 `GET /v1/navigation` — role-filtered, badge counts inlined. */
export const navigationFor = (role: Role): NavigationTree => {
  const visibility = roleVisibility[role];
  if (visibility === null) return { groups: fullTree };
  const groups = fullTree
    .map((group) => {
      const allowed = visibility[group.caption] ?? [];
      return { caption: group.caption, parents: group.parents.filter((p) => allowed.includes(p.key)) };
    })
    .filter((group) => group.parents.length > 0);
  return { groups };
};

/** §2 `GET /v1/views?object=` — saved views drive the pill tab group. */
export const savedViews: SavedView[] = [
  {
    id: "view_my_open_leads",
    label: "My open leads",
    object: "LEAD",
    count: 48,
    isDefault: true,
    filters: [{ field: "owner.id", op: "eq", value: USER_AMIRAH }],
    columns: ["contact", "organisation", "stage", "owner", "value", "createdAt", "score"],
  },
  {
    id: "view_unassigned",
    label: "Unassigned",
    object: "ENQUIRY",
    count: 9,
    isDefault: true,
    filters: [{ field: "status", op: "eq", value: "OPEN" }],
    columns: ["channel", "from.name", "subject", "classification.label", "estimatedValue", "receivedAt"],
  },
  {
    id: "view_needs_review",
    label: "Needs human review",
    object: "ENQUIRY",
    count: 1,
    isDefault: false,
    filters: [{ field: "classification.needsHumanReview", op: "eq", value: true }],
    columns: ["channel", "from.name", "subject", "classification.label", "receivedAt"],
  },
  {
    id: "view_whatsapp",
    label: "WhatsApp",
    object: "ENQUIRY",
    count: 3,
    isDefault: false,
    filters: [{ field: "channel", op: "eq", value: "WHATSAPP" }],
    columns: ["from.name", "subject", "classification.label", "receivedAt"],
  },
  {
    id: "view_awaiting_me",
    label: "Awaiting me",
    object: "APPROVAL",
    count: 7,
    isDefault: true,
    filters: [{ field: "status", op: "eq", value: "PENDING" }],
    columns: ["subject", "actionType", "value", "requestedBy.name", "slaDueAt", "urgencyGroup"],
  },
  {
    id: "view_money_moving",
    label: "Money-moving",
    object: "APPROVAL",
    count: 4,
    isDefault: false,
    filters: [{ field: "bulkApprovable", op: "eq", value: false }],
    columns: ["subject", "actionType", "value", "slaDueAt"],
  },
];

/** §2 `GET /v1/templates?type=` — nothing is hardcoded in the frontend. */
export const templates: Template[] = [
  {
    id: TEMPLATE_PROPOSAL,
    type: "PROPOSAL",
    version: 7,
    label: "Standard proposal",
    mergeFields: [
      "client.name",
      "contact.name",
      "programme.title",
      "engagement.dates",
      "investment.total",
    ],
    sections: [
      { n: 1, title: "Understanding your needs", aiEnabled: true },
      { n: 2, title: "Recommended programme", aiEnabled: true },
      { n: 3, title: "Delivery plan", aiEnabled: true },
      { n: 4, title: "Investment", aiEnabled: false },
      { n: 5, title: "HRDC claim guidance", aiEnabled: true },
    ],
  },
  {
    id: TEMPLATE_EMAIL_PROPOSAL,
    type: "EMAIL",
    version: 3,
    label: "Proposal covering email",
    mergeFields: ["contact.name", "proposal.ref", "investment.total"],
  },
  {
    id: TEMPLATE_FOLLOWUP_WHATSAPP,
    type: "WHATSAPP",
    version: 2,
    label: "Proposal follow-up",
    mergeFields: ["contact.name", "proposal.sentAt"],
    category: "UTILITY",
    ratePerMessage: myr(6),
  },
  {
    id: "tpl_followup_marketing_v1",
    type: "WHATSAPP",
    version: 1,
    label: "Programme announcement",
    mergeFields: ["contact.name", "programme.title"],
    category: "MARKETING",
    ratePerMessage: myr(35),
  },
  {
    id: TEMPLATE_TNA,
    type: "TNA_QUESTIONNAIRE",
    version: 3,
    label: "Standard needs analysis",
    mergeFields: ["client.name", "contact.name"],
  },
  {
    id: "tpl_quotation_std_v4",
    type: "QUOTATION",
    version: 4,
    label: "Standard quotation",
    mergeFields: ["client.name", "programme.title", "investment.total", "rateCard.version"],
  },
  {
    id: "tpl_invoice_std_v2",
    type: "INVOICE",
    version: 2,
    label: "Tax invoice",
    mergeFields: ["client.name", "engagement.dates", "invoice.total"],
  },
  {
    id: "tpl_certificate_std_v5",
    type: "CERTIFICATE",
    version: 5,
    label: "Certificate of attendance",
    mergeFields: ["participant.name", "programme.title", "engagement.dates", "trainer.name"],
  },
  {
    id: "tpl_evaluation_std_v3",
    type: "EVALUATION",
    version: 3,
    label: "Post-programme evaluation",
    mergeFields: ["programme.title", "trainer.name"],
  },
  {
    id: "tpl_hrdc_packet_v2",
    type: "HRDC_PACKET",
    version: 2,
    label: "eTRIS claim bundle",
    mergeFields: ["employerCode", "grant.reference", "engagement.dates"],
  },
  {
    id: "tpl_email_followup_v4",
    type: "EMAIL",
    version: 4,
    label: "Follow-up email",
    mergeFields: ["contact.name", "proposal.ref"],
  },
  {
    id: "tpl_collections_reminder1_v2",
    type: "EMAIL",
    version: 2,
    label: "Collections reminder 1",
    mergeFields: ["contact.name", "invoice.ref", "invoice.outstanding", "invoice.dueAt"],
  },
  {
    id: "tpl_collections_reminder2_v2",
    type: "EMAIL",
    version: 2,
    label: "Collections reminder 2",
    mergeFields: ["contact.name", "invoice.ref", "invoice.outstanding", "invoice.daysOverdue"],
  },
  {
    id: "tpl_collections_reminder3_v1",
    type: "WHATSAPP",
    version: 1,
    label: "Collections reminder 3",
    mergeFields: ["contact.name", "invoice.ref"],
    category: "UTILITY",
    ratePerMessage: myr(6),
  },
];

/**
 * §2 `GET /v1/{resourceType}/{id}/audit`, keyed `resourceType::ref`.
 *
 * Each row names the §14 domain event it came from, so the drawer and the
 * outbox tell the same story.
 */
export const auditEntries: Record<string, AuditEntry[]> = {
  [`proposals::${PROPOSAL_AURORA}`]: [
    {
      at: "2026-09-11T09:14:02+08:00",
      actor: { kind: "AGENT", id: AGENT_PROPOSAL, name: "Proposal Agent" },
      event: "ProposalDrafted",
      summary: `Drafted ${PROPOSAL_AURORA} from ${TEMPLATE_PROPOSAL}`,
      runId: RUN_PROPOSAL,
    },
    {
      at: "2026-09-11T09:14:12+08:00",
      actor: { kind: "AGENT", id: AGENT_PROPOSAL, name: "Proposal Agent" },
      event: "ActionRequested",
      summary: "Requested PROPOSAL_SEND at 0.82 confidence",
      runId: RUN_PROPOSAL,
    },
    {
      at: "2026-09-11T09:14:14+08:00",
      actor: { kind: "SYSTEM", id: "sys_policy", name: "Policy engine" },
      event: "ApprovalRequested",
      summary: `APV-01 routed the send to SALES_MANAGER as ${APPROVAL_AURORA}`,
    },
    {
      at: "2026-09-11T09:31:10+08:00",
      actor: { kind: "HUMAN", id: USER_AMIRAH, name: "Amirah Yusof" },
      event: "ProposalDrafted",
      summary: "Edited section 3, Delivery plan",
    },
  ],
  [`organisations::${ORG_AURORA}`]: [
    {
      at: "2026-09-11T08:53:02+08:00",
      actor: { kind: "AGENT", id: "agent_match", name: "Match Agent" },
      event: "EnquiryClassified",
      summary: `Matched ${ENQUIRY_AURORA} to ${ORG_AURORA} on an exact domain match`,
      runId: "run_4788",
    },
    {
      at: "2026-09-11T09:05:31+08:00",
      actor: { kind: "HUMAN", id: USER_AMIRAH, name: "Amirah Yusof" },
      event: "OpportunityCreated",
      summary: `Converted ${ENQUIRY_AURORA} to OPP-0512 at RM 18,500`,
    },
    {
      at: "2026-11-14T10:04:00+08:00",
      actor: { kind: "SYSTEM", id: "sys_webhook", name: "Accounting webhook" },
      event: "InvoiceValidated",
      summary: `${INVOICE_AURORA} validated by MyInvois`,
    },
  ],
  [`engagements::${ENGAGEMENT_AURORA}`]: [
    {
      at: "2026-09-15T10:24:00+08:00",
      actor: { kind: "CLIENT", id: "c_nurul", name: "Nurul Hassan" },
      event: "ProposalAccepted",
      summary: `Accepted ${PROPOSAL_AURORA}; created ${ENGAGEMENT_AURORA}`,
    },
    {
      at: "2026-11-14T10:01:00+08:00",
      actor: { kind: "HUMAN", id: "t_farah", name: "Farah Aziz" },
      event: "AttendanceLocked",
      summary: "Locked day 1 attendance · 29 of 30 present",
    },
    {
      at: "2026-11-14T10:30:00+08:00",
      actor: { kind: "AGENT", id: "agent_compliance", name: "Compliance Agent" },
      event: "ComplianceCheckFailed",
      summary: "CHK_DOCS_COMPLETE failed · 3 of 5 documents present",
      runId: "run_4930",
    },
  ],
  [`approvals::${APPROVAL_AURORA}`]: [
    {
      at: "2026-09-11T09:14:14+08:00",
      actor: { kind: "SYSTEM", id: "sys_policy", name: "Policy engine" },
      event: "ApprovalRequested",
      summary: "Raised under APV-01, assigned to Kelvin Tan",
    },
  ],
  [`invoices::${INVOICE_AURORA}`]: [
    {
      at: "2026-11-14T10:02:00+08:00",
      actor: { kind: "HUMAN", id: USER_JASON, name: "Jason Lee" },
      event: "InvoicePushed",
      summary: "Pushed to the accounting package after mapping the customer",
    },
    {
      at: "2026-11-14T10:04:00+08:00",
      actor: { kind: "SYSTEM", id: "sys_webhook", name: "Accounting webhook" },
      event: "InvoiceValidated",
      summary: "MyInvois validation returned a UIN",
    },
  ],
  [`tnas::${TNA_AURORA}`]: [
    {
      at: "2026-09-11T09:10:00+08:00",
      actor: { kind: "CLIENT", id: "c_nurul", name: "Nurul Hassan" },
      event: "TNACompleted",
      summary: "Completed the needs analysis questionnaire",
    },
  ],
};

/**
 * The top-bar notification. Not a contract type — the bell is drawn on every
 * screen and carries a fixed count of four in the kit, but §2 publishes no
 * shape for it. Reported as a gap.
 */
export interface FixtureNotification {
  id: string;
  at: Timestamp;
  severity: "INFO" | "WARN" | "DANGER";
  title: string;
  body: string;
  path: string;
  read: boolean;
}

export const notifications: FixtureNotification[] = [
  {
    id: "ntf_1",
    at: "2026-11-14T09:12:00+08:00",
    severity: "WARN",
    title: "STRONG_2 tier degraded",
    body: "Gemini 3.1 Pro is returning 5xx; DEEP_THINK is carrying its traffic.",
    path: "/settings/ai/tiers",
    read: false,
  },
  {
    id: "ntf_2",
    at: "2026-11-14T08:40:00+08:00",
    severity: "DANGER",
    title: "Anthropic provider key invalid",
    body: "The key for STRONG_1 stopped authenticating; STRONG_2 is the active fallback.",
    path: "/settings/ai/providers",
    read: false,
  },
  {
    id: "ntf_3",
    at: "2026-11-14T09:45:00+08:00",
    severity: "INFO",
    title: "Circular 09/2026 proposes a rule change",
    body: "One change affects four open engagements and needs a decision.",
    path: "/compliance/rule-changes/DOC-0219",
    read: false,
  },
  {
    id: "ntf_4",
    at: "2026-11-14T07:00:00+08:00",
    severity: "DANGER",
    title: "Claim window closes in 3 days",
    body: "ENG-0189 must be filed on eTRIS by 17 November.",
    path: "/hrdc/packets/ENG-0189",
    read: false,
  },
  {
    id: "ntf_5",
    at: "2026-11-13T13:05:00+08:00",
    severity: "WARN",
    title: "Approval SLA breached",
    body: "APV-2026-0768 passed its deadline on 13 November.",
    path: "/approvals/APV-2026-0768",
    read: true,
  },
];

/** §2 `GET /v1/search?q=` — keyed by the lowercased query. */
export const searchResults: Record<string, SearchResult> = {
  aurora: {
    records: [
      {
        type: "ORGANISATION",
        ref: ORG_AURORA,
        title: "Aurora Manufacturing Sdn Bhd",
        subtitle: "Organisation 360",
        path: `/organisations/${ORG_AURORA}`,
      },
      {
        type: "PROPOSAL",
        ref: PROPOSAL_AURORA,
        title: "Leading Through Change · RM 18,500",
        subtitle: "Draft · awaiting approval",
        path: `/proposals/${PROPOSAL_AURORA}`,
      },
      {
        type: "INVOICE",
        ref: INVOICE_AURORA,
        title: "INV-2026-0311 · RM 18,500",
        subtitle: "Sent · MyInvois validated",
        path: `/invoices/${INVOICE_AURORA}`,
      },
      {
        type: "ORGANISATION",
        ref: "ORG-0115",
        title: "Aurora Precision Tooling Sdn Bhd",
        subtitle: "Prospect · possible duplicate",
        path: "/organisations/ORG-0115",
      },
    ],
    actions: [
      {
        type: "PROPOSAL_CREATE",
        label: "Create proposal for Aurora Manufacturing",
        targetRef: ORG_AURORA,
      },
      { type: "OPPORTUNITY_CREATE", label: "New opportunity for Aurora Manufacturing", targetRef: ORG_AURORA },
    ],
  },
  kelvin: {
    records: [],
    actions: [{ type: "PROPOSAL_CREATE", label: `Assign an approval to ${USER_KELVIN}`, targetRef: ORG_AURORA }],
  },
};
