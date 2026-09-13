import { useBreadcrumbTrail } from "@/shared/components/layout";

/**
 * Exposes the trail a screen DECLARES, for `renderScreen` to mount.
 *
 * The labels go in a `data-trail` ATTRIBUTE and the node is `hidden`, so the
 * probe adds no text to the document. A probe that rendered the trail as text
 * would put a second "Approvals" on every approvals screen and break the
 * `getByText` queries in the suites this harness already serves.
 *
 *   expect(screen.getByTestId("breadcrumb-trail")).toHaveAttribute(
 *     "data-trail", "Home › Approvals",
 *   );
 *
 * Its own file because `renderScreen.tsx` exports helpers rather than
 * components, and mixing the two trips `react-refresh/only-export-components`.
 */
export function BreadcrumbTrailProbe() {
  const trail = useBreadcrumbTrail()
    .map((crumb) => crumb.label)
    .join(" › ");

  return <div data-testid="breadcrumb-trail" data-trail={trail} hidden />;
}
