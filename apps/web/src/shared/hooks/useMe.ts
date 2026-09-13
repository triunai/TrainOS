import { createContext, useContext } from "react";
import type { Me, Role } from "@trainos/contract";

/**
 * `useMe()` is the single source of identity and role for the whole shell.
 * Nothing re-derives a role from anywhere else.
 *
 * Fixtures mode serves `FIXTURE_ME`. Supabase mode serves `core.me()` for the
 * signed-in session (`MeProvider`), and every consumer stays as it is — that
 * is the whole reason the shell reads a hook rather than a constant.
 *
 * The role is switchable at runtime ONLY as a development affordance (the
 * sidebar role toggle), and only over fixtures. A client-side role is a
 * rendering convenience, never an authorization boundary: the API decides, and
 * a denied call still has to be handled visibly.
 */

export interface MeContextValue {
  me: Me;
  /**
   * Development affordance, fixtures mode only. ABSENT in supabase mode, where
   * the role is a JWT claim and a toggle would paint a role the database then
   * refuses — so a consumer that draws the toggle has to check for it.
   */
  setRole?: (role: Role) => void;
}

export const MeContext = createContext<MeContextValue | null>(null);

/** The fixture principal. Amirah Yusof is the pack's primary sales user (§6.2). */
export const FIXTURE_ME: Me = {
  id: "USR-0001",
  name: "Amirah Yusof",
  role: "SALES",
  permissions: [],
  dataScope: { clients: "MY_ACCOUNTS", teams: "MY_TEAM" },
  locale: "en-MY",
  timezone: "Asia/Kuala_Lumpur",
  theme: "SYSTEM",
};

export function useMe(): MeContextValue {
  const value = useContext(MeContext);
  if (value === null) {
    throw new Error("useMe() must be used inside <MeProvider>.");
  }
  return value;
}

/** Initials for the avatar chip. "Amirah Yusof" -> "AY". */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
