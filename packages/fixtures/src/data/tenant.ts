/**
 * Tenant, people and pipeline configuration.
 *
 * §2 `GET /v1/me`, §5 / §8 `GET /v1/config/pipelines?object=`.
 *
 * The tenant is Akademi Perdana, the training provider. Aurora Manufacturing
 * is its client, not a tenant — §1 keeps the tenant implicit from auth, so it
 * never appears in a path or a body and exists here only to stamp events.
 */

import type { Actor, AnyActor, Me, PipelineConfig, Role } from "@trainos/contract";
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

/** The MD. Named "Dato' Lim" across the pack; no canonical id in §0, so this one. */
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
    name: "Dato' Lim Chee Keong",
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
