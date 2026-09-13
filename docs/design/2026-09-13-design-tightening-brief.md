# Design tightening pass — brief (13 Sep 2026)

Status: **queued for the resumed session**, highest UI priority after shell/dashboard fixes.
Source: user-endorsed critique of the dark Programmes screen vs the light Collections screen.
Source of truth for the target look: **the Collections page (M13-S05) composition** — title → overview → tabs → master/detail. Bring every screen toward it.

## Rules to apply (kit-level, once; screens inherit)

1. **Monospace down 70–80%.** UI font (Inter) for all labels, table headers, section titles, sidebar group captions. Mono only for machine-ish values: refs (`PRG-0031`), versions, `⌘K`. Numbers use `font-variant-numeric: tabular-nums`, not mono. Add `--font-ui` / `--font-code` tokens.
2. **Flatten containers.** Kill the outer rounded content shell and the inner card-per-section. The page is the component: breadcrumb → title + description + context count → toolbar → table, separated by spacing and at most one hairline. Remove the bordered filter box.
3. **Hierarchy forward.** No eyebrow (`CATALOGUE`) above the title; title first, one-line description, a useful count. Sidebar group captions (`MAIN`, `OPERATIONS`) almost disappear.
4. **Sidebar:** 240–256px; two hierarchy mechanisms only (indent + one selected indicator). Remove tree line, bullets, parent background on child select.
5. **Table:** primary/secondary contrast two steps apart (15/550 vs 12/400 muted); lighter row rules; tabular numerals for money, pax, counts.
6. **Radius scale, three levels:** `--radius-control: 6px`, `--radius-panel: 10px`, `--radius-pill: 999px`. Pill = status/tag chips only. Segmented control for density; selects/search/sidebar selection = modest rectangle.
7. **Surface architecture instead of borders**, especially dark: L0 backdrop → L1 navigation/workspace → L2 interactive surface → L3 hover/selected/raised. Draw a border only where a control's independence would otherwise be ambiguous (CLAUDE.md already says this).
8. **Vertical rhythm:** topbar 56–60 · breadcrumb 20–24 · title · 8 · description · 24 · toolbar 36–40 · 16 · table header 36–40 · row 64–68. Compress chrome ~20%, let content breathe.
9. Kill the combination that reads as generated: tracked uppercase mono eyebrows + giant rounded cards + pills everywhere + 1px borders everywhere.

## Execution plan
- One Opus agent on the kit + tokens + shell (typography tokens, radius tokens, surface tokens, ContentCard → page composition, DataTable, FilterBar, RecordHeader, section caption component, chips), verified on /dev/kit and on Programmes + Collections in both themes.
- Then screen agents migrate the 27 screens to the page-as-component composition (mostly deletions).
- Verifier: side-by-side of every screen vs the light Collections reference; blue budget; one primary; a11y.
- Constraints unchanged: tokens only, no hex; status colour on chips only; AI tint rule; one primary per view.
