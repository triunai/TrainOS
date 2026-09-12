import { useMemo, useState, type ReactNode } from "react";
import type { Role } from "@trainos/contract";
import { FIXTURE_ME, MeContext, type MeContextValue } from "./useMe";

/**
 * Holds the fixture principal and the development role switch.
 *
 * Deliberately NOT a query: there is no `/v1/me` call yet, and a fixture
 * pretending to be a fetch would hide the fact that the session is not wired.
 */
export function MeProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role>(FIXTURE_ME.role);

  const value = useMemo<MeContextValue>(() => ({ me: { ...FIXTURE_ME, role }, setRole }), [role]);

  return <MeContext.Provider value={value}>{children}</MeContext.Provider>;
}
