import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Ref } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";
import { Collapse, DisclosureButton } from "./Collapse";
import { MetricStrip, type MetricCellProps } from "./MetricStrip";
import { useRememberedFlag } from "./useRememberedFlag";
import { CondensedPrimaryEcho } from "./useSinglePrimary";

/**
 * The RecordHeader. Kit.dc.html §09, verbatim: "One component, configured per
 * entity. Row 1 identity + actions · Row 2 metadata · Row 3 metrics. Breadcrumb
 * stays in the top bar; identity is never repeated below."
 *
 * CLAUDE.md restates it as a standing rule: record identity appears once per
 * page, RecordHeader owns it, the breadcrumb owns the path. So this component
 * renders the title and nobody else does — a screen that writes the record name
 * a second time has a defect, not a style.
 *
 * The condensed 48px bar (item 2) is part of THIS component, not a second one.
 * It appears automatically once the full header scrolls past — "no toggle,
 * chevron or accordion triggers it" — and carries exactly three things: the
 * name, the single most important chip, and the primary action. The action
 * availability rule is why: on a 4,000px record the primary must stay one
 * keystroke away at any scroll position.
 *
 * Focus is untouched when the bar activates. An `IntersectionObserver` changes
 * what is painted and nothing else, so a keyboard user notices no jump.
 */

export interface RecordHeaderProps {
  /** The record's name. The one place it appears on the page. */
  title: string;
  /**
   * The record's business reference and the rest of the mono identity line:
   * `ORG-0114 · Manufacturing · Shah Alam · owner Amirah · created 04 Mar 2024`.
   * Pass the parts; this joins them with the separator so no screen invents its own.
   */
  recordRef?: Ref;
  meta?: (string | null | undefined)[];
  /**
   * Status chips. The FIRST is the one the condensed bar keeps, so order by
   * importance rather than by whatever the API returned.
   */
  chips?: ReactNode;
  /** Secondary actions. Rendered before the primary, right-aligned. */
  actions?: ReactNode;
  /**
   * The view's one solid button — a `PrimaryButton`. Also the action the
   * condensed bar keeps reachable. A locked record passes nothing: M07-S07 and
   * M10-S06 have no primary on purpose.
   */
  primaryAction?: ReactNode;
  /**
   * An action too costly to lose on scroll, kept beside the primary in the
   * condensed bar — the artboard's example is "Request changes" next to
   * "Approve & send" on an approval record.
   */
  stickyAction?: ReactNode;
  /** Row 3. Omit on a record with nothing worth measuring. */
  metrics?: MetricCellProps[];
  /**
   * Row 3, as a component rather than as cells. Takes the place of `metrics`
   * when both are given.
   *
   * The slot exists so a screen can hand over a `MetricStrip` in its
   * `accentCard` variant — the full-width gradient band that is itself a
   * dropdown (tightening brief §15) — without this component learning what is
   * inside it. Row 3 is still row 3; only its rendering is delegated.
   */
  metricsCard?: ReactNode;
  /** The lifecycle chain, between the metrics and the tabs. Variant A only. */
  stepper?: ReactNode;
  /** Turn off the condensed bar where the page does not scroll. */
  withoutCondensed?: boolean;
  /**
   * Turns rows 2 and 3 into a disclosure. Collapsed leaves ONE row — title,
   * chips, actions, chevron — so the decision stays reachable while the record
   * gets out of the way; expanded is the header as it has always been.
   *
   * The condensed scroll bar is a different mechanism and both can be on at
   * once: that one reacts to scroll position and this one to a click.
   */
  collapsible?: boolean;
  /**
   * The record TYPE — `"approval"`, `"programme"` — not the record. The
   * collapsed/expanded choice is remembered against it, so the preference
   * survives moving to the next item in a queue. Only read when `collapsible`.
   */
  recordType?: string;
  className?: string;
}

export function RecordHeader({
  title,
  recordRef,
  meta,
  chips,
  actions,
  primaryAction,
  stickyAction,
  metrics,
  metricsCard,
  stepper,
  withoutCondensed,
  collapsible,
  recordType,
  className,
}: RecordHeaderProps) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [condensed, setCondensed] = useState(false);

  const detailsId = useId();
  /* Default expanded: a record a user has never met should show its facts.
     The preference only exists once they have said otherwise. */
  const [expanded, setExpanded] = useRememberedFlag(
    collapsible && recordType ? `record-header:${recordType}` : undefined,
    true,
  );

  useEffect(() => {
    if (withoutCondensed) return;
    const node = sentinel.current;
    /* jsdom and older browsers have no IntersectionObserver. The header still
       renders in full; only the condensed bar is unavailable, which is the
       right way round to degrade. */
    if (!node || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(([entry]) => setCondensed(!entry.isIntersecting), {
      rootMargin: "-56px 0px 0px 0px",
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [withoutCondensed]);

  const metaLine = [recordRef, ...(meta ?? [])].filter(Boolean).join(" · ");

  /* Rows 2 and 3. Rendered in one place and mounted in one of two ways, so a
     collapsible header and a plain one can never drift into two layouts. */
  const details = (
    <>
      {metaLine ? (
        /* The artboard draws this at #7B828C, which is lighter than the
           #69717C floor CLAUDE.md sets for text a user must read. The rule
           wins: ink-muted. Noted as a deliberate deviation. */
        <p className="-mt-1.5 font-mono text-[11px] tracking-[0.01em] text-ink-muted">{metaLine}</p>
      ) : null}

      {metricsCard ?? (metrics && metrics.length > 0 ? <MetricStrip cells={metrics} /> : null)}
      {stepper ? <div className="border-t border-divider pt-3.5">{stepper}</div> : null}
    </>
  );

  return (
    <>
      {/* The row gap moves INSIDE the clipped region when the header is
          collapsible: a `gap` on the header survives the collapse as a residual
          band under the title row, which is the whole reason this pattern is
          usually got wrong. */}
      <header className={cn("flex flex-col px-5 pb-4 pt-5", !collapsible && "gap-3.5", className)}>
        <div className="flex min-h-9 flex-wrap items-center gap-2.5">
          <h1 className="whitespace-nowrap text-[22px] font-semibold tracking-[-0.015em]">
            {title}
          </h1>
          {chips}
          {actions || primaryAction || collapsible ? (
            <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
              {actions}
              {primaryAction}
              {collapsible ? (
                <>
                  {/* A hairline in front of the chevron, so it reads as chrome
                      rather than as a fourth action competing with
                      Reject / Request changes / Approve. */}
                  {actions || primaryAction ? (
                    <div aria-hidden="true" className="mx-0.5 h-5 w-px bg-border" />
                  ) : null}
                  <DisclosureButton
                    open={expanded}
                    onToggle={() => setExpanded(!expanded)}
                    controls={detailsId}
                    label="the record details"
                  />
                </>
              ) : null}
            </div>
          ) : null}
        </div>

        {collapsible ? (
          <Collapse open={expanded} id={detailsId}>
            <div className="flex flex-col gap-3.5 pt-3.5">{details}</div>
          </Collapse>
        ) : (
          details
        )}
      </header>

      <div ref={sentinel} aria-hidden="true" className="h-px" />

      {condensed ? (
        <CondensedRecordHeader
          title={title}
          chips={chips}
          primaryAction={primaryAction}
          stickyAction={stickyAction}
        />
      ) : null}
    </>
  );
}

export interface CondensedRecordHeaderProps {
  title: string;
  /** Only the first chip survives the condense. */
  chips?: ReactNode;
  primaryAction?: ReactNode;
  stickyAction?: ReactNode;
  className?: string;
}

/**
 * The 48px condensed bar. Exported for the showcase and for a screen that
 * manages its own scroll container; `RecordHeader` renders it automatically.
 *
 * `aria-hidden` is wrong here and deliberately not used: the primary action must
 * stay reachable, and hiding the bar from assistive tech would take it away
 * from the users who most need the shortcut. Instead the bar is a plain sticky
 * region — the duplicate title is the price of the action staying in reach.
 */
export function CondensedRecordHeader({
  title,
  chips,
  primaryAction,
  stickyAction,
  className,
}: CondensedRecordHeaderProps) {
  const firstChip = Array.isArray(chips) ? chips[0] : chips;

  return (
    /* The primary in here is the SAME action as the one in the full header,
       rendered a second time so it stays in reach — not a second claim on the
       view's one solid button. Marking the subtree an echo is what lets
       `useSinglePrimary` count instances rather than compare labels, and so
       catch a header primary and a drawer primary that happen to share one. */
    <CondensedPrimaryEcho.Provider value={true}>
      <div
        className={cn(
          "sticky top-0 z-20 flex h-12 items-center gap-2.5 border-b border-border bg-card px-4",
          className,
        )}
      >
        <span className="truncate text-[14px] font-semibold">{title}</span>
        {firstChip}
        {primaryAction || stickyAction ? (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {stickyAction}
            {primaryAction}
          </div>
        ) : null}
      </div>
    </CondensedPrimaryEcho.Provider>
  );
}
