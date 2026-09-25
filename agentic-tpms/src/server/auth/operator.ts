import { cookies } from "next/headers";
import type { Actor } from "../db/client";

/**
 * Single-tenant operator identity. The cockpit is behind HTTP Basic auth
 * (TPMS_BASIC_AUTH) in production; "acting as" selects which named operator an
 * action is attributed to in the audit ledger. SSO is deferred.
 */
export interface Operator {
  id: string;
  name: string;
  role: "MD" | "OPS" | "FINANCE" | "SALES";
  roleLabel: string;
  email: string;
}

export const OPERATORS: Operator[] = [
  { id: "usr_alex_director", name: "Alex Tan", role: "MD", roleLabel: "Managing Director", email: "alex@alextraining.my" },
  { id: "usr_siti_ops", name: "Siti Rahman", role: "OPS", roleLabel: "Operations Coordinator", email: "siti@alextraining.my" },
  { id: "usr_raj_finance", name: "Raj Kumar", role: "FINANCE", roleLabel: "Finance Desk", email: "raj@alextraining.my" },
];

export const OPERATOR_COOKIE = "tpms_operator";

export function currentOperator(): Operator {
  let id: string | undefined;
  try {
    id = cookies().get(OPERATOR_COOKIE)?.value;
  } catch {
    id = undefined;
  }
  return OPERATORS.find((o) => o.id === id) ?? OPERATORS[0];
}

export function currentActor(): Actor {
  return { type: "USER", id: currentOperator().id };
}
