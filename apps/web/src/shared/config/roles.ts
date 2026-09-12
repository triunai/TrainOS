import { ROLES, type Role } from "@trainos/contract";

/**
 * The design pack's navigation ROLE map is keyed by six lowercase role names
 * (`build/kit.js`, reproduced verbatim in `navTree.ts`). The API contract's
 * `Role` union is a different, nine-value vocabulary. This file is the ONE
 * place the two are reconciled — nothing else may re-derive the mapping.
 *
 * Source: docs/research/09-design-pack-inventory.md §2.2 and
 * packages/contract `ROLES`.
 */

/** The six nav-role keys the design pack's ROLE map is written against. */
export const NAV_ROLE_KEYS = ["sales", "ops", "finance", "exec", "admin", "compliance"] as const;
export type NavRoleKey = (typeof NAV_ROLE_KEYS)[number];

/**
 * Contract role -> nav-role key.
 *
 * `null` means the role does not use the internal shell at all: `CLIENT` enters
 * through the external minimal shell (§5, M07-S07) and `AGENT` is a service
 * principal with no UI session.
 *
 * Two judgements are recorded here rather than hidden:
 *  - `SALES_MANAGER` maps to `sales`; the pack draws no distinct manager rail.
 *  - `TRAINER` maps to `ops`; the pack has no trainer variant, and Operations
 *    is the nearest surface. Revisit when a trainer screen exists.
 *
 * The pack's `compliance` key is currently unreachable from any contract role.
 * It is kept because it is verbatim source, and flagged so the gap is visible.
 */
export const NAV_ROLE_KEY: Readonly<Record<Role, NavRoleKey | null>> = {
  SALES: "sales",
  SALES_MANAGER: "sales",
  OPS: "ops",
  FINANCE: "finance",
  MD: "exec",
  ADMIN: "admin",
  TRAINER: "ops",
  CLIENT: null,
  AGENT: null,
};

/** Roles that can reach the internal shell, in the order a dev toggle lists them. */
export const SHELL_ROLES: readonly Role[] = ROLES.filter((role) => NAV_ROLE_KEY[role] !== null);

/** Human label for a contract role. Display only — never branch on this. */
export const ROLE_LABEL: Readonly<Record<Role, string>> = {
  SALES: "Sales Consultant",
  SALES_MANAGER: "Sales Manager",
  OPS: "Operations Coordinator",
  FINANCE: "Finance Executive",
  MD: "Managing Director",
  ADMIN: "Administrator",
  TRAINER: "Trainer",
  CLIENT: "Client",
  AGENT: "Agent (service principal)",
};
