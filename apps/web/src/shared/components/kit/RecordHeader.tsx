import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Collapse, DisclosureButton } from "./Collapse";
import type { Ref } from "@trainos/contract";
import { cn } from "@/shared/lib/utils";
import { MetricStrip, type MetricCellProps } from "./MetricStrip";
import { OnAccentProvider } from "./onAccent";
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
   * dropdown (tightening brief §15a) — without this component learning what is
   * inside it. Row 3 is still row 3; only its rendering is delegated.
   */
  metricsCard?: ReactNode;
  /**
   * The lifecycle chain, between the metrics and the tabs.
   *
   * On an `accent` header it renders BELOW the card, on the page surface, at
   * the card's own width — never inside the blue. The stepper's whole grammar
   * is colour and shape per stage (done solid, current ringed, blocked amber,
   * failed slashed red, the ✦ on an AI-advanced stage), and on a saturated
   * ground every one of those collapses to the same white. A stepper that
   * cannot tell its stages apart is not a stepper, so it keeps its own surface.
   */
  stepper?: ReactNode;
  /** Turn off the condensed bar where the page does not scroll. */
  withoutCondensed?: boolean;
  /**
   * The RECORD variant (tightening brief §15a): the whole header becomes one
   * blue gradient card — title row, meta line, hairline, metric strip, stepper.
   * Kit.dc.html §11-13, "same component, three entity configs", and M04-S02
   * captions it "the record-page pattern every entity in the chain inherits".
   *
   * Off by default, and that is not timidity: `RecordHeader` also serves every
   * LIST page (no `recordRef`, `withoutCondensed`, count line via `meta`), and
   * a list has no record to announce. Record pages opt in; lists never do.
   *
   * Everything inside is re-inked for the blue automatically — buttons, chips
   * and the strip read `useOnAccent` rather than taking a prop — so a screen's
   * header markup is identical either way.
   */
  accent?: boolean;
  /**
   * Adds the round chevron left of the action cluster. It collapses the
   * hairline, the metric strip and the stepper; the title row and the meta line
   * never collapse. §15a: "the card shrinks to the title row plus meta line".
   */
  collapsible?: boolean;
  /**
   * The record TYPE — `"approval"`, `"organisation"` — not the record. The
   * collapsed choice is remembered against it, so the preference survives
   * moving to the next item in a queue. Only read when `collapsible`.
   */
  recordType?: string;
  /**
   * Drop back to the plain page surface when collapsed, instead of keeping the
   * shorter blue card. The user's own reference for the collapsed state shows
   * the plain treatment; the artboard's "one component, three configs" argues
   * for keeping the blue. Both are built because the two sources disagree.
   */
  plainWhenCollapsed?: boolean;
  className?: string;
}

/**
 * Which gradient candidate the card should paint. A dev affordance with a
 * deliberate shelf life: §15a asks for two candidates rendered on the real
 * screen so the user can choose, and a URL flag is the cheapest way to show
 * both without a second route, a second component or a stored preference.
 *
 * A plain function, not a hook: it reads the URL on every render and holds no
 * state, so there is nothing to subscribe to and nothing to clean up.
 */
function isAltGradient(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("gradient") === "alt";
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
  accent,
  collapsible,
  recordType,
  plainWhenCollapsed,
  className,
}: RecordHeaderProps) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [condensed, setCondensed] = useState(false);

  const bodyId = useId();
  /* Default expanded: a record a user has never met should show its facts. The
     preference only exists once they have said otherwise. */
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

  /* The part that collapses. The title row and the meta line never do. */
  const body =
    metricsCard || (metrics && metrics.length > 0) ? (
      <div className={cn("flex flex-col", accent ? "gap-3.5 pt-3.5" : "gap-3.5")}>
        {/* One hairline, then the strip. On the card it is white at 15%: a
            `--divider` grey over saturated blue reads as a seam between two
            surfaces rather than a division within one. */}
        {accent ? (
          <div aria-hidden="true" className="h-px bg-[rgb(var(--on-accent)/0.18)]" />
        ) : null}

        {metricsCard ??
          (metrics && metrics.length > 0 ? (
            <MetricStrip cells={metrics} variant={accent ? "accent" : "default"} bare={accent} />
          ) : null)}
      </div>
    ) : null;

  /* A chevron only exists if there is something under it. Nine of the eleven
     record pages pass chips and a ref but no metrics, so `collapsible` on those
     would otherwise draw a control that opens nothing. */
  const disclosable = Boolean(collapsible && body);

  /* Collapsed, the card keeps the title row and the meta line and loses its
     bottom padding, so it shrinks rather than leaving a blue band of nothing. */
  /* `Boolean(...)`, not `accent && ...`: the latter is `boolean | undefined`,
     which the context provider types reject and which blocks the strict
     allowlist for every file that imports this one. */
  const showCard = Boolean(accent && (expanded || !disclosable || !plainWhenCollapsed));

  const header = (
    <header
      className={cn(
        "flex flex-col gap-3.5",
        showCard
          ? "rounded-panel bg-[image:var(--surface-accent-gradient)] px-6 pb-5 pt-5"
          : "px-5 pb-4 pt-5",
        /* Candidate B, for the on-screen comparison §15a asks for. `?gradient=alt`
           swaps the token at the element; nothing else in the card changes, so
           the two are compared under identical type, spacing and ink. Reads the
           URL, not state — a refresh is the toggle and there is nothing to
           leak. Delete this line and `--surface-accent-gradient-alt` once the
           user has picked. */
        showCard && isAltGradient() && "bg-[image:var(--surface-accent-gradient-alt)]",
        showCard && !expanded && "pb-4",
        /* The card is a card: it needs air on all four sides, and the content
           below it must not butt against its bottom edge. */
        accent && "mx-5 mb-5 mt-2.5",
        className,
      )}
    >
      <div className="flex min-h-9 flex-wrap items-center gap-2.5">
        <h1
          className={cn(
            "whitespace-nowrap text-[22px] font-semibold tracking-[-0.015em]",
            showCard && "text-[rgb(var(--on-accent))]",
          )}
        >
          {title}
        </h1>
        {chips}
        {actions || primaryAction || disclosable ? (
          <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
            {actions}
            {primaryAction}
            {/* The card's far RIGHT edge, after the primary. It is chrome, not a
                fourth action, and putting it past the cluster says so — inside
                the cluster it read as a button competing with Reject / Request
                changes / Approve for the same row. */}
            {disclosable ? (
              <DisclosureButton
                open={expanded}
                onToggle={() => setExpanded(!expanded)}
                controls={bodyId}
                label="the record detail"
                tone={showCard ? "onAccent" : "ink"}
                /* 36px, the height of the buttons beside it. At the kit's
                   default 28px it read as decoration rather than a control and
                   was easy to miss with a real pointer — which is exactly how
                   it was reported: "the click does not open it". */
                className={cn(
                  "ml-1 h-9 w-9 rounded-pill border",
                  showCard
                    ? "border-[rgb(var(--on-accent)/0.45)]"
                    : "border-border text-ink-secondary",
                )}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      {metaLine ? (
        /* On a white card the artboard draws this at #7B828C, lighter than the
           #69717C floor CLAUDE.md sets for text a user must read; the rule wins
           and it is ink-muted. On the blue card it is full white for the same
           reason the captions are — a translucent white fails AA at 11px. */
        <p
          className={cn(
            "-mt-1.5 font-mono text-[11px] tracking-[0.01em]",
            showCard ? "text-[rgb(var(--on-accent))]" : "text-ink-muted",
          )}
        >
          {metaLine}
        </p>
      ) : null}

      {body ? (
        disclosable ? (
          <Collapse open={expanded} id={bodyId}>
            {body}
          </Collapse>
        ) : (
          body
        )
      ) : null}

      {/* Unchanged for a plain header: the chain sits under the metrics, inside
          the header, exactly where it always did. Only the accent card sends it
          out, and only because the blue erases its stage colours. */}
      {!accent && stepper ? <div className="border-t border-divider pt-3.5">{stepper}</div> : null}
    </header>
  );

  return (
    <>
      {accent ? <OnAccentProvider value={showCard}>{header}</OnAccentProvider> : header}

      {/* Outside the provider on purpose: the stepper reads `useOnAccent` like
          everything else, and the answer here has to be "no". */}
      {accent && stepper ? <div className="mx-5 mb-5 -mt-1">{stepper}</div> : null}

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
