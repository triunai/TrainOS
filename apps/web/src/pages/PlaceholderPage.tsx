import { EmptyState } from "@/shared/components/states";
import type { NavRoute } from "@/shared/config/nav";

/**
 * Every route renders this until its real screen exists.
 *
 * It names the route so the shell, the nav filter and the URL space can be
 * verified end to end before a single screen is built — and so an unbuilt
 * screen is visibly unbuilt rather than looking like a legitimate empty list.
 */
export function PlaceholderPage({ route }: { route: NavRoute }) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-divider px-6 py-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">
          {route.caption} · {route.section}
        </p>
        <h1 className="pt-1">{route.label}</h1>
      </div>
      <EmptyState
        className="flex-1"
        title={`${route.label} is not built yet`}
        description={`This route resolves and the shell is wired. The ${route.label} screen lands when its kit components and data are in place.`}
      />
    </div>
  );
}
