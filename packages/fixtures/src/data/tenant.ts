/**
 * Tenant, people and pipeline configuration.
 *
 * §2 `GET /v1/me`, §5 / §8 `GET /v1/config/pipelines?object=`.
 *
 * The tenant is Akademi Perdana, the training provider. Aurora Manufacturing
 * is its client, not a tenant — §1 keeps the tenant implicit from auth, so it
 * never appears in a path or a body and exists here only to stamp events.
 */

import type { Actor, AnyActor, Me, MeProfile, PipelineConfig, Role } from "@trainos/contract";
import { QUOTATION_PERMISSIONS } from "@trainos/contract";
import {
  CLIENT_NURUL,
  TRAINER_FARAH,
  USER_AMIRAH,
  USER_JASON,
  USER_KELVIN,
  USER_KHAIRUL,
  USER_SITI,
} from "@trainos/contract";
import { TENANT_ID } from "./_helpers";

/**
 * The MD. Named "Dato' Lim" in the original design pack; no canonical id in
 * §0, so this one — kept as-is (renaming it would touch every fixture file
 * that could one day reference it by id, for no behavioural gain) even though
 * the person behind it changed.
 *
 * Design-tightening brief §13 (13 Sep 2026, `docs/design/2026-09-13-design-tightening-brief.md`)
 * retargets the MD persona to **Alex Selvarajah** — a super-investor with
 * multiple businesses (notably with Panasonic and Sunway) and a strong HRMS
 * background — as the primary stakeholder the demo is narrated to. `Me` (§2,
 * `packages/contract/src/domain/shell.ts`) carries only id/name/role/
 * permissions/dataScope/locale/timezone/theme, so name and role are the only
 * fields this fixture can change; "org" for `/me` stays the tenant
 * (Akademi Perdana Sdn Bhd) below, since Alex is that company's MD, not a
 * separate tenant. His outside businesses are backstory, not additional
 * `organisations` rows: the pack does not model an MD's personal portfolio
 * distinct from the tenant's own client list, and inventing "Panasonic" /
 * "Sunway" as fictitious Akademi Perdana clients would misrepresent them as
 * clients of the training provider rather than businesses he holds, so they
 * are not seeded here — see the fixtures-persona report for the flagged seam.
 * Initials ("AS") are computed from `name` wherever the UI derives them
 * (`Avatar`), so nothing to seed there either. Email has the same gap: `Me`
 * has no email field, so if `/v1/me` grows one, its shape should follow the
 * tenant's own pattern, e.g. `alex.selvarajah@akademiperdana.my` (see the
 * `farah.aziz@akademiperdana.my` style trainer emails in `programmes.ts`).
 */
export const USER_LIM = "u_lim";

/** The tenant record. Not a contract type — §1 keeps tenancy out of the API surface. */
export interface FixtureTenant {
  id: string;
  name: string;
  locale: string;
  timezone: string;
  currency: "MYR";
}

export const tenant: FixtureTenant = {
  id: TENANT_ID,
  name: "Akademi Perdana Sdn Bhd",
  locale: "en-MY",
  timezone: "Asia/Kuala_Lumpur",
  currency: "MYR",
};

/** §2 the signed-in principal, one per role the demo needs. */
export const users: Me[] = [
  {
    id: USER_AMIRAH,
    name: "Amirah Yusof",
    role: "SALES",
    permissions: [
      "enquiry:read",
      "enquiry:convert",
      "proposal:write",
      "proposal:submit",
      "followup:send",
      ...QUOTATION_PERMISSIONS,
    ],
    dataScope: { clients: "MY_ACCOUNTS", teams: "MY_TEAM" },
    locale: "en-MY",
    timezone: "Asia/Kuala_Lumpur",
    theme: "LIGHT",
  },
  {
    id: USER_KELVIN,
    name: "Kelvin Tan",
    role: "SALES_MANAGER",
    permissions: ["enquiry:read", "proposal:read", "approval:read", "approval:decide", "quotation:read"],
    dataScope: { clients: "MY_TEAM", teams: "MY_TEAM" },
    locale: "en-MY",
    timezone: "Asia/Kuala_Lumpur",
    theme: "LIGHT",
  },
  {
    id: USER_SITI,
    name: "Siti Nordin",
    role: "OPS",
    /**
     * No `quotation:read`: the tenancy design withholds commercial pricing
     * from OPS, which is also why the OPS projection of an engagement drops
     * the finance block.
     */
    permissions: [
      "engagement:read",
      "engagement:write",
      "attendance:capture",
      "attendance:approve",
      "hrdc:read",
    ],
    dataScope: { clients: "ALL", teams: "MY_TEAM" },
    locale: "en-MY",
    timezone: "Asia/Kuala_Lumpur",
    theme: "LIGHT",
  },
  {
    id: USER_JASON,
    name: "Jason Lee",
    role: "FINANCE",
    permissions: [
      "invoice:read",
      "invoice:write",
      "payment:record",
      "hrdc:read",
      "hrdc:submit",
      "collections:send",
      "compliance:verify",
      "quotation:read",
      "quotation:write",
    ],
    dataScope: { clients: "ALL", teams: "ALL" },
    locale: "en-MY",
    timezone: "Asia/Kuala_Lumpur",
    theme: "LIGHT",
  },
  {
    id: USER_LIM,
    name: "Alex Selvarajah",
    role: "MD",
    permissions: [
      "dashboard:read",
      "approval:decide",
      "agent:autonomy",
      "budget:raise",
      "report:read",
      "quotation:read",
    ],
    dataScope: { clients: "ALL", teams: "ALL" },
    locale: "en-MY",
    timezone: "Asia/Kuala_Lumpur",
    theme: "DARK",
  },
  {
    id: USER_KHAIRUL,
    name: "Khairul Anwar",
    role: "ADMIN",
    permissions: [
      "agent:read",
      "agent:pause",
      "run:read",
      "run:retry",
      "ai:tiers",
      "ai:providers",
      "ai:budgets",
      "knowledge:write",
    ],
    dataScope: { clients: "ALL", teams: "ALL" },
    locale: "en-MY",
    timezone: "Asia/Kuala_Lumpur",
    theme: "DARK",
  },
  {
    id: TRAINER_FARAH,
    name: "Farah Aziz",
    role: "TRAINER",
    permissions: ["engagement:read", "attendance:capture", "attendance:approve"],
    dataScope: { clients: "MY_ACCOUNTS", teams: "MY_TEAM" },
    locale: "en-MY",
    timezone: "Asia/Kuala_Lumpur",
    theme: "LIGHT",
  },
];

/** §2 the default principal the demo signs in as. */
export const currentUserId = USER_AMIRAH;

/** §12 the client-side contact who completes the TNA and accepts the proposal. */
export const clientActor: AnyActor = { id: CLIENT_NURUL, name: "Nurul Hassan", kind: "CLIENT" };

/** Lookup used everywhere an `Actor` is embedded in a record. */
export const actorFor = (id: string): Actor => {
  const user = users.find((candidate) => candidate.id === id);
  return { id, name: user?.name ?? id, kind: "HUMAN" };
};

/** Lookup used by `requestedBy` / `assignedTo` resolution in the policy gate. */
export const roleFor = (id: string): Role | undefined =>
  users.find((candidate) => candidate.id === id)?.role;

/** Every user holding a given role — the approval assignment pool (§3 step 5). */
export const usersWithRole = (role: Role): Me[] => users.filter((user) => user.role === role);

/**
 * §2 ruled R14 · `GET /v1/me/profile`, keyed by principal.
 *
 * Kit.dc.html §07 draws this panel with Amirah's values, and those are kept
 * verbatim so the artboard and the built modal can still be compared side by
 * side. Alex Selvarajah is the MD the demo is narrated to, so his record is
 * seeded too and the role switch shows the right person rather than Amirah's
 * mobile number under someone else's name.
 *
 * The two differ in the ways the panel is meant to show: an MD's data scope is
 * the whole book, so he carries every module rather than seven, and the
 * commercial floor and the executive floor are different departments and
 * different places. Both have two-factor on, because DECISIONS §1 puts every
 * money-moving approval through the MD and a demo that showed it off on the
 * account that signs them would be teaching the wrong thing.
 *
 * All seven principals carry one, not just the two the demo narrates. The role
 * switch offers every one of them, and a profile keyed by principal that only
 * answers for two turns the modal into a 404 for five of them — worse than the
 * single hardcoded record it replaces. `every-principal-has-a-profile` in the
 * tenant test keeps that true when a user is added.
 *
 * INVENTED, all of it, except two addresses: the persona note above already
 * settled `alex.selvarajah@akademiperdana.my`, and `farah.aziz@` follows the
 * trainer addresses in `programmes.ts`. The contract publishes the shape; no
 * endpoint has ever returned these values. Marked here the same way every
 * other unsourced fixture is.
 */
export const profiles: Record<string, MeProfile> = {
  [USER_AMIRAH]: {
    id: USER_AMIRAH,
    tenant: { name: "Akademi Perdana", code: "APSB" },
    location: "Klang Valley",
    jobTitle: "Senior Sales Consultant",
    department: "Commercial",
    email: "amirah.yusof@akademiperdana.my",
    mobile: "+60 12-448 9021",
    staffNumber: "APSB-0142",
    moduleCount: 7,
    session: {
      lastSignInAt: "2026-09-11T08:04:22+08:00",
      browser: "Chrome",
      place: "Shah Alam",
      activeSessions: 2,
      twoFactorEnabled: true,
    },
  },
  [USER_LIM]: {
    id: USER_LIM,
    tenant: { name: "Akademi Perdana", code: "APSB" },
    location: "Kuala Lumpur",
    jobTitle: "Managing Director",
    department: "Executive",
    email: "alex.selvarajah@akademiperdana.my",
    mobile: "+60 12-301 7755",
    staffNumber: "APSB-0001",
    /* Every module. An MD whose data scope is ALL and who is the approver of
       last resort for discounts, trading holds and budget caps cannot be
       entitled to a subset of the product. */
    moduleCount: 12,
    session: {
      lastSignInAt: "2026-09-13T07:41:09+08:00",
      browser: "Safari",
      place: "Kuala Lumpur",
      activeSessions: 1,
      twoFactorEnabled: true,
    },
  },
  [USER_KELVIN]: {
    id: USER_KELVIN,
    tenant: { name: "Akademi Perdana", code: "APSB" },
    location: "Klang Valley",
    jobTitle: "Sales Manager",
    department: "Commercial",
    email: "kelvin.tan@akademiperdana.my",
    mobile: "+60 12-778 3140",
    staffNumber: "APSB-0088",
    moduleCount: 9,
    session: {
      lastSignInAt: "2026-09-11T11:19:44+08:00",
      browser: "Chrome",
      place: "Petaling Jaya",
      activeSessions: 1,
      twoFactorEnabled: true,
    },
  },
  [USER_SITI]: {
    id: USER_SITI,
    tenant: { name: "Akademi Perdana", code: "APSB" },
    location: "Klang Valley",
    jobTitle: "Operations Executive",
    department: "Delivery",
    email: "siti.nordin@akademiperdana.my",
    mobile: "+60 13-204 6612",
    staffNumber: "APSB-0211",
    /* Tenancy CD-1 withholds quotation:read from OPS, so the margin modules
       are not hers and the count says so. */
    moduleCount: 6,
    session: {
      lastSignInAt: "2026-09-12T08:52:03+08:00",
      browser: "Edge",
      place: "Shah Alam",
      activeSessions: 2,
      twoFactorEnabled: false,
    },
  },
  [USER_JASON]: {
    id: USER_JASON,
    tenant: { name: "Akademi Perdana", code: "APSB" },
    location: "Klang Valley",
    jobTitle: "Finance Executive",
    department: "Finance",
    email: "jason.lee@akademiperdana.my",
    mobile: "+60 16-559 0287",
    staffNumber: "APSB-0134",
    moduleCount: 8,
    session: {
      lastSignInAt: "2026-09-12T16:30:51+08:00",
      browser: "Chrome",
      place: "Kuala Lumpur",
      activeSessions: 1,
      twoFactorEnabled: true,
    },
  },
  [USER_KHAIRUL]: {
    id: USER_KHAIRUL,
    tenant: { name: "Akademi Perdana", code: "APSB" },
    location: "Klang Valley",
    jobTitle: "Systems Administrator",
    department: "Technology",
    email: "khairul.anwar@akademiperdana.my",
    mobile: "+60 11-2380 4419",
    staffNumber: "APSB-0007",
    moduleCount: 12,
    session: {
      lastSignInAt: "2026-09-13T06:58:17+08:00",
      browser: "Firefox",
      place: "Cyberjaya",
      /* The one account with a session open somewhere it should be checked —
         the panel's active-session count is there to be read, not decoration. */
      activeSessions: 3,
      twoFactorEnabled: true,
    },
  },
  [TRAINER_FARAH]: {
    id: TRAINER_FARAH,
    tenant: { name: "Akademi Perdana", code: "APSB" },
    location: "Klang Valley",
    jobTitle: "Lead Trainer",
    department: "Delivery",
    /* The style programmes.ts already uses for trainer addresses. */
    email: "farah.aziz@akademiperdana.my",
    mobile: "+60 19-662 5508",
    staffNumber: "APSB-0163",
    /* A trainer reaches engagements and attendance and nothing else. */
    moduleCount: 3,
    session: {
      lastSignInAt: "2026-09-13T07:12:35+08:00",
      browser: "Safari",
      place: "Shah Alam",
      activeSessions: 1,
      twoFactorEnabled: false,
    },
  },
};

/** §2 permissions come from `/me`, and a gated call also returns the role it needs. */
export const permissionsFor = (id: string): string[] =>
  users.find((user) => user.id === id)?.permissions ?? [];

/**
 * §5 / §8 `GET /v1/config/pipelines?object=`.
 *
 * `ENGAGEMENT` is the §8 delivery lifecycle the engagement detail renders.
 * `DEAL_CHAIN` is the compact strip the §5 relations panel renders on each
 * engagement row — a different set of keys in the same contract, see the
 * README's contract-gaps note.
 */
export const pipelines: PipelineConfig[] = [
  {
    object: "ENGAGEMENT",
    stages: [
      { key: "WON", label: "Won", order: 1 },
      { key: "TRAINER_CONFIRMED", label: "Trainer confirmed", order: 2 },
      { key: "SCHEDULED", label: "Scheduled", order: 3 },
      { key: "REGISTERED", label: "Registered", order: 4 },
      { key: "DELIVERED", label: "Delivered", order: 5 },
      { key: "ATTENDANCE_LOCKED", label: "Attendance locked", order: 6 },
      { key: "HRDC_CLAIM", label: "HRDC claim", order: 7 },
      { key: "INVOICED", label: "Invoiced", order: 8 },
      { key: "PAID", label: "Paid", order: 9 },
    ],
  },
  {
    object: "DEAL_CHAIN",
    stages: [
      { key: "ENQUIRY", label: "Enquiry", order: 1 },
      { key: "TNA", label: "TNA", order: 2 },
      { key: "PROPOSAL", label: "Proposal", order: 3 },
      { key: "APPROVAL", label: "Approval", order: 4 },
      { key: "SENT", label: "Sent", order: 5 },
      { key: "DELIVERY", label: "Delivery", order: 6 },
    ],
  },
  {
    object: "OPPORTUNITY",
    stages: [
      { key: "NEW", label: "New", order: 1 },
      { key: "QUALIFYING", label: "Qualifying", order: 2 },
      { key: "TNA_SENT", label: "TNA sent", order: 3 },
      { key: "PROPOSAL_SENT", label: "Proposal sent", order: 4 },
      { key: "NEGOTIATION", label: "Negotiation", order: 5 },
      { key: "WON", label: "Won", order: 6 },
      { key: "LOST", label: "Lost", order: 7 },
    ],
  },
];
