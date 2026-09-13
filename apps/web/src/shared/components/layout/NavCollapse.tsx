import { useEffect, useRef, type ReactNode } from "react";

/**
 * The sidebar's animated expand/collapse region.
 *
 * The animation is CSS only — see `.nav-collapse` in `index.css` for why, and
 * for how the closed region leaves the tab order without a `transitionend`
 * listener. This component adds exactly one thing on top: it sets and clears
 * the `inert` attribute.
 *
 * `inert` is set through the DOM rather than as a JSX prop because React 18
 * does not know the attribute and would warn on a boolean. `toggleAttribute`
 * is idempotent and leaves nothing behind, so there is no cleanup to forget:
 * the element is removed with the component and the attribute goes with it.
 */
export function NavCollapse({
  open,
  id,
  children,
}: {
  open: boolean;
  id: string;
  children: ReactNode;
}) {
  const inner = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inner.current?.toggleAttribute("inert", !open);
  }, [open]);

  return (
    <div className="nav-collapse" data-open={open ? "true" : "false"}>
      <div ref={inner} id={id}>
        {children}
      </div>
    </div>
  );
}
