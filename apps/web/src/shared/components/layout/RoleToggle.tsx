import type { Role } from "@trainos/contract";
import { ROLE_LABEL, SHELL_ROLES } from "@/shared/config/roles";
import { useMe } from "@/shared/hooks/useMe";

/**
 * DEVELOPMENT AFFORDANCE.
 *
 * Switches the fixture principal's role so the role-filtered nav can be seen
 * without nine sign-ins. It is not an authorization control and must be removed
 * when the real session lands — the API is the boundary, and a client-side role
 * has never been one.
 */
export function RoleToggle() {
  const { me, setRole } = useMe();

  return (
    <label className="flex items-center gap-2">
      <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">
        Role
      </span>
      <select
        aria-label="Role (development only)"
        value={me.role}
        onChange={(event) => setRole(event.target.value as Role)}
        className="rounded-control border border-border bg-card px-2 py-1 text-[13px] text-ink-secondary"
      >
        {SHELL_ROLES.map((role) => (
          <option key={role} value={role}>
            {ROLE_LABEL[role]}
          </option>
        ))}
      </select>
    </label>
  );
}
