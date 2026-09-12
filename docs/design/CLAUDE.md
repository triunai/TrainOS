# TrainOS — working principles

## Consolidation over repetition
Any pattern that appears on more than two screens with the same behaviour must be
standardised as a named component before it is used again. If a screen needs
something the kit does not have, add it to the kit first, then use it. Never
invent a second visual language for a problem the kit already solves.

Applies to: RecordHeader, MetricStrip, LifecycleStepper, pill tab group, data
table, filter bar, status/AI/autonomy chips, approval banner, proposed-action
card, agent-run card, empty/loading/error states, drawers.

When two variants of one pattern exist, the newer one wins and the older is
migrated in the same pass — divergence is a defect, not a style.

## Standing rules
- One design system, one component library, one file per module.
- Three colours: ink neutrals, electric blue #1F5BFF, charcoal #181A1F.
  Status colour lives on chips only. Blue budget 5–15% per screen.
- AI is the primary hue at 6% tint plus the ✦ glyph and a text label, never a
  solid fill and never a fourth accent. Solid blue means a human triggered it.
- One solid primary button per view.
- Record identity appears once per page: RecordHeader owns it, the breadcrumb
  owns the path. Never duplicate either.
- Hierarchy comes from typography, alignment, spacing and separators before
  borders. If removing a border does not make a relationship ambiguous, remove it.
- Muted text #69717C or darker; non-text UI affordances at 3:1 or better.
- Stage names and order render from pipeline configuration, never hardcoded.
