import { useBreadcrumbTrail } from "@/shared/components/layout";

/**
 * Renders the trail a screen DECLARES, as `Home › Training › …`, so a test can
 * assert it.
 *
 * Its own file because the harness exports helpers rather than components, and
 * mixing the two trips `react-refresh/only-export-components`.
 */
export function BreadcrumbProbe() {
  return (
    <div data-testid="breadcrumb-trail">
      {useBreadcrumbTrail()
        .map((crumb) => crumb.label)
        .join(" › ")}
    </div>
  );
}
