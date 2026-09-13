import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { Role } from "@trainos/contract";
import { readDemoRole, writeDemoRole } from "@/shared/api";
import { FIXTURE_ME, MeContext, type MeContextValue } from "./useMe";

/**
 * Holds the fixture principal and the development role switch.
 *
 * Deliberately NOT a query: there is no `/v1/me` call yet, and a fixture
 * pretending to be a fetch would hide the fact that the session is not wired.
 *
 * On the hosted demo the chosen role is remembered in the browser alongside
 * the demo data; everywhere else `readDemoRole` is `null` and this starts
 * where it always did.
 */
export function MeProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>(() => readDemoRole() ?? FIXTURE_ME.role);

  const setRole = useCallback((next: Role) => {
    setRoleState(next);
    writeDemoRole(next);
  }, []);

  const value = useMemo<MeContextValue>(
    () => ({ me: { ...FIXTURE_ME, role }, setRole }),
    [role, setRole],
  );

  return <MeContext.Provider value={value}>{children}</MeContext.Provider>;
}
