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

## 10. PillTabGroup → bounded segmented control (user reference: Vern "Available | Sold | All")
- One full-width track: 1px hairline border, `--radius-control` (6–8px), surface L2, no pill.
- Equal-width segments (or content-width with min 120px), separated by 1px hairline dividers, label + count inline, count in muted.
- Selected segment: 6% primary tint background + 1px primary border (or primary-border token) + primary text; sits flush inside the track (inset 2px). Hover: L3 surface. Focus ring per kit.
- Corporate tone, no uppercase tracking: sentence case, UI font, 13–14px, 500 weight.
- Keyboard: roving tabindex, arrow keys, `role="tablist"`. Counts stay server-driven (saved views).
- Replace every PillTabGroup usage (saved-view switchers on inbox/list screens, approvals urgency groups if used as tabs); density Comfortable/Compact uses the same control.

## 11. Per-screen fidelity to the artboards (user: "every screen must follow its true design brief")
- Each screen agent re-reads its artboard annotation and the 09 §4 row and lists every rendered element the artboard has that the screen lacks — then builds them. Known misses: **alternating (zebra) table rows** where the artboard draws them; **inline horizontal workflow strips inside table rows** (the small lifecycle/progress components the artboards place in list rows — e.g. engagements, approvals, collections); density and column set per artboard.
- Verifier: per-screen checklist derived from the annotation panel, not by eye alone.

## 12. Shell (in progress in shell-fix, keep as acceptance criteria)
- Seamless sidebar/topbar: one surface, no junction border, both themes.
- Sidebar: only the active group expanded by default; scrollbar hidden on the real scroll container; two hierarchy mechanisms; footer block = avatar + name + role, app version + "API v1 · contract x.y.z", DEV role switcher.
- Topbar: breadcrumb · search ⌘K · bell · theme.

## 13. Primary persona — Alex Selvarajah
- Stakeholder and primary user: **Alex Selvarajah**, super-investor with multiple businesses (notably with Panasonic and Sunway), strong HRMS background. Signals: enterprise-grade polish, versioning visible, no amateur tells.
- Fixtures: the default `/me` user for the MD role becomes Alex Selvarajah; the demo story (M22 index) is narrated to him; his organisations appear in the seed where the pack allows without breaking the Aurora story.

### 12a. Sidebar footer (final spec, 13 Sep 11:32)
Row 1: Help & support (drawer: docs, contact, Report an issue pre-filled with version + route) · Shortcuts (⌘K + list). Row 2: profile dropdown — avatar initials, name, role; menu: Theme radio, DEV role switcher, Sign out. Row 3: "TrainOS 0.1.0 · API v1 · contract 0.1.0" + status dot. Collapse-sidebar toggle at the footer edge (64px icon rail, localStorage). Topbar keeps only breadcrumb · search ⌘K · bell.
Amendment 11:34: role switcher is its own full-width DROP-UP row (not in the profile menu); Help & support is its own full-width item. Footer order: Help & support · Shortcuts · Role (drop-up) · Profile (menu: Theme, Sign out) · version line.

## 14. Scrollbars (site-wide, user rule 11:38)
No scrollbar visible anywhere at rest. Thin overlay scrollbar appears only while scrolling, fades 800ms after. Global CSS + one delegated scroll listener at the shell. (Assigned to shell-fix.)

## 15. RecordHeader upgrade (approval detail as the reference; applies to every record screen)
Reference screenshot: "Send proposal · Aurora Manufacturing Sdn Bhd" header on M02-S02.
- **Collapsible header.** Collapsed = one row: title · status chip · action cluster (Reject / Request changes / Approve) · chevron. Expanded = the collapsed row plus the meta line (refs · policy · SLA) and the metric band. Eased open/close (same leak-free grid-rows transition as the sidebar accordion). Default expanded on first visit; state remembered per record type.
- **Metric band becomes its own card** spanning the full header width: **soft blue gradient** background (from `primary` at 6% tint to ~12% tint, left→right or top→bottom; tokenised as `--surface-accent-gradient`), ink text, no border, `--radius-panel`. Caution: keep within the pack's 5–15% blue budget — soft tint, never saturated; Approve stays the only solid blue.
- **That gradient card is itself a dropdown**: its header row shows the metrics (Value · Agent · Confidence · Margin · Risk); expanding it reveals the record's detail sections beneath ("Why this needs you", recommendation, evidence, deviations, risk, diff) inside the same card, so the metrics act as the summary row of the detail. Chevron on the right; eased.
- **Spread the metrics out:** equal-width grid across the full band (`grid-template-columns: repeat(n, 1fr)`), dividers between cells, not clustered left.
- Kit owns it: extend `RecordHeader` (collapsible, `metricsCard` slot) and `MetricStrip` (`variant="accentCard"`, `expandable` with children). Screens pass the sections as children; no per-screen composition.

## 16. Enquiry inbox rows and detail (M03-S01/S02) — "exception gets the component, normal data becomes typography"
Row = exactly three layers:
```
Lim Wei Sheng · Kenanga Retail Group                         09:12
✉ Email · 13 Nov
Sales excellence programme for 48 store managers in Q1 2027…
Sales excellence                                        RM 67,200
```
- Sender · company is the strongest line (15/550); channel is muted text with a tiny glyph (✉ ◉ ☎ ◌), **no capsule**; date/time right-aligned muted; money is a fixed right column in tabular numerals, **not a badge**.
- AI classification shows plain text when confidence ≥ business threshold ("Sales excellence"); the ✦/confidence treatment appears **only** below threshold ("Needs review · 61%") or on unmatched/spam ("⚠ Needs classification", "Not an enquiry"). Confidence is an exception metric, not primary UI.
- Three distinct states: hover → subtle surface; selected → surface + left indicator (keep); attention → status indicator. Never the same treatment for all three.
- Detail pane: keep the sequence (Enquiry → Original message → Extracted → Suggested action → Decision) but remove agent theatre: "EXTRACTED ✦ Lead Agent · 92%" → heading "Enquiry details" with a tiny "AI extracted" tag; "SUGGESTED ACTION ✦ Lead Agent · 88% · Act with approval" → "Recommended next step" + "Requires approval" subline, then the sentence. Provenance stays available in the AIChip popover, not repeated inline.
- **Header rows align:** the list pane's filter/summary row ("Channel: WhatsApp · 3 of 3 shown") and the detail pane's header block ("Quotation request" + refs + actions) must be the same height and share the same baseline hairline, so the split reads as one composition.
- Same principles apply to every list/master-detail screen (collections, invoices, engagements): money and dates as data columns, provenance/confidence only on exceptions.

### 10a. Tab group — revised reference (11:45)
Use the kit's own saved-view switcher form (Kit.dc.html "My open leads 48 · Unassigned 12 · Overdue follow-up 7 · +": a contained track with the selected segment as a filled surface inside it) but with the rounding pulled back hard: track radius ≈ `--radius-panel` (10px), selected segment ≈ `--radius-control` (6–8px) — **not** fully round. Keep counts inline, "+" to add a view, corporate sentence case. (User said "20–40px of rounding" — interpret as a fraction of the current full-round, i.e. modest radius; confirm on the first render.) **Amended 13 Sep:** the 120px segment minimum is withdrawn — segments size to their content (label plus count) with 12px horizontal padding over a 64px floor, because at 120px an eight-segment status track measured 973px and left the §10b filter group 155px at 1440, which overlapped it; at content width the same track measures 776px, which recovers the overlap and puts five of the eight ListToolbar screens on one row. Measured at 1440: proposals (7 segments, 617px) now holds one row; engagements (8, 776px) misses by 8px and participants (8, 806px) by 38px, and both stack cleanly with the filters right-aligned rather than being forced.

### 10b. Tab row and filter row are ONE row (12:05, user ruling from screenshots)
On every list screen the filter row — search, selects and the "N of M shown" counter — must NOT sit on its own row beneath the segmented tab group. It sits on the SAME row, right-aligned, with the table directly beneath; reference composition `features/finance/CollectionsQueueScreen.tsx`. Stacked, the two bands put two horizontal rules between the heading and the first row of data while each band leaves half its width empty — the tabs say which subset and the filters say which slice of it, so they are one control surface. The kit component is `ListToolbar` (tabs left, filters and count right, actions after the filters, stacking to two rows only when the two halves do not both fit — decided by content, not by a breakpoint, since a pinned row cannot wrap and instead squeezes the filters until they overlap the tabs); it strips `FilterBar`'s own row padding, so a screen passes `FilterBar` unmodified and puts the page gutter on the toolbar. An action that opens a record rather than narrowing the list belongs in the page header, not in this row.

### 12b. Sidebar amendments (11:45)
- No « collapse chevron; keep the hairline above the footer. No rail-collapse for now.
- Profile row (avatar · name · role) moves to the TOP of the sidebar under the wordmark, with a light/dark **toggle switch** beside it (theme is one click; not in a menu).
- Clicking the profile opens the kit **Profile modal** exactly as drawn in Kit.dc.html ("PROFILE MODAL · 960").
- Footer: Help & support · Shortcuts · Role drop-up (DEV) · version line.

### 11a. Inline lifecycle steppers in tables (11:46, reference M04-S02 engagements table)
Rows the artboards draw with the dot-progress stepper (done ●, current ◯ blue ring, blocked ● amber, lost ● red with red segment) render the kit `LifecycleStepper` inline variant from server steps; never text. Enumerate by grepping the artboards, not by memory. Cells: name + mono `ref · status` subline, dates, money right-aligned tabular. (Assigned to applier-2 as an immediate item; the fidelity pass re-checks.)

## 17. Localisation (11:47)
The pack's topbar has an EN | BM switch; the app has no i18n. Now (shell-fix): the switch, an I18nProvider (locale from /me, persisted, `<html lang>`), and shell strings in EN + BM. Next pass: a real catalogue (react-i18next or a typed dictionary), every screen's UI strings keyed, BM translations reviewed by a native speaker, date/number formatting via Intl for `ms-MY`, and the portal page localised (client-facing). Contract already carries `locale` on /me.

### 15a. RecordHeader upgrade — CORRECTED after eyeballing (11:55)
**Superseded twice; this is what is BUILT.** The 11:55 note withdrew the
collapsible title row and the 6–12% tint; the 13:0x ruling from the user's own
screenshots (44/45.png) and the pack's artboard 11-13 (46.png) then made the
whole header one blue card. §15's "spread the metrics evenly, not clustered
left" survives all of it and is the one place the build departs from the
artboards on purpose.

**The card.** `RecordHeader accent` renders the entire header as one blue
gradient card at `--radius-panel`: title row (title · status chips · round
chevron · action cluster), mono meta line, a white-at-18% hairline, then the
metric strip. `collapsible` adds the chevron; collapsed the card shrinks to the
title row plus the meta line — no residual strip, no condensed metric summary.
`plainWhenCollapsed` drops to the page surface instead, built because 45.png and
the artboard's "one component, three configs" disagree.

**Opt-in, not default.** `RecordHeader` also serves every list page (ruling
b0ef662: no PageHeader, a list is this component with no `recordRef`, with
`withoutCondensed`, count via `meta`). Record pages pass `accent`; lists never do.

**Nothing inside is told it is on blue.** `onAccent` is a context the card
provides and `Button`, `StatusChip`, `MetricCell`, `MiniBar` and
`LifecycleStepper` read. A screen's header markup is identical either way, which
is what keeps the remaining record screens one prop from adopting it.

**Three artboard details that do not survive contrast, all measured:**
- Reject keeps no red. No pale red reaches 4.5:1 on this blue — #FFDEDB, already
  almost white, peaks at 3.63:1. The three actions escalate by WEIGHT: ghost,
  white-outlined, solid white.
- Chips lose their hue and keep `data-tone`. A warning fill is built for a
  near-white card and is a bright slab on saturated blue.
- The solid button's label is `--accent-ink` #0F2FA8 (10.54:1 on white), not
  `--primary`, whose dark value is 3.53:1 on white.
- Same reasoning takes the state hues off the mini bar and the stepper dots on
  the card. Shape and fill length carry those states; the chips and banners
  below the card are where they are diagnosed.

**Gradient — CHOSEN.** `--surface-accent-gradient` is "violet edge",
`128deg #0F1FDB → #1F5BFF 48% → #5A3DF0`, mean chroma 0.793, white 5.25:1 at
every point along the ramp. It won on headroom: its far corner is bounded by hue
rather than by lightness, so it spends its contrast margin getting deep instead
of getting bright. `--surface-accent-gradient-alt` is "indigo rise",
`115deg #0413D6 → #1F5BFF 55% → #3568F5`, mean chroma 0.835 but worst point
4.72:1, kept live at `?gradient=alt` for comparison; delete it and the
`isAltGradient` reader once the comparison is over. Both are three stops in one
hue family with electric #1F5BFF as the anchor, identical in both themes, and
both are saturated to the contrast floor rather than muted toward it. No sheen
layer: a white overlay lightens the ramp and spends the margin the white labels
need. For the record, the artboard's own ramp ends at #4E82FF, where white
measures 3.52:1 and every label on this card would have failed.

**Metric spread — SETTLED.** Equal-width grid across the full card,
`repeat(n, minmax(0, 1fr))`. The artboards' left packing is withdrawn.

**Blue chroma**, mean over the 1440×900 frame, against the committed
before-screenshot of the approval detail: light 0.49% → 12.87% expanded / 7.29%
collapsed; dark 5.62% → 17.24% / 12.06%. The dark figures carry ~5.6 points of
the shell's own blue-grey neutrals, so the surface spends about 12 points in
both themes. Over the 5–15% guidance when expanded on dark; the user overrode
the budget for this surface, so it is reported rather than diluted.

**Proofs built:** M02-S02 approval detail, then M04-S02 Organisation 360 (the
config with the mini bar and the chain stepper inside the card).

## 18. Knowledge → Sources (M16-S05) — "hide the machinery until somebody needs it"
Page answers one question: are my sources healthy, and does anything need me? Then the inventory.
- **Header:** title "Knowledge sources" + primary "+ Add source"; one summary line "6 sources · 4 healthy · 1 changed · 1 failed"; segmented control [All 6] [Needs attention 2]; secondary "Check all" · "History". **Remove the six-cell metric strip** (Sources/Chunks/Embedded/Changed/Last full check/Monitor).
- **Banner** (only when a source changed): "Circular 09/2026 has changed — existing answers remain available; new rules won't apply until the changes are reviewed. Review changes →" plus a "Why?" disclosure for the quarantine mechanics. No architecture essay.
- **Table is the hero, four columns:** Source (name + muted "type · vN"), Used for (Client answers / Internal), Status (Healthy / Changed · Review required / Processing / Fetch failed), Checked (relative date). Optional Version.
- **State-driven actions:** no per-row Check/Re-ingest pair. Changed → "Review changes →", Failed → "Retry →", Processing → "View progress →", Healthy → ⋯ on hover. 
- **Source detail** (drawer/row expand) holds chunks, embedding state, monitor cadence, hash, version, retrieval permissions, last ingestion.
- **Delete the two explanatory cards** ("What may be cited", "How freshness is known"); put them behind a "How sources work" help link → drawer with four bullets.
- **Breadcrumb:** Knowledge / Sources; title "Knowledge sources". Drop "Corpus" unless corpora are a real switchable object (then Knowledge / Corpora / <name>).
- Typography per §1: table headings and card headings in the UI font, sentence case; mono only for refs/versions.
- Same treatment applies to the other "control panel" screens: M20-S16 usage/budgets, M18-S01 registry, M20-S20 routing — human summary first, machinery in detail.

### 16b. The two panes of a master/detail screen are INDEPENDENT (13:00, user ruling, reverses §16's alignment clause)
§16 asked the list pane's summary row and the detail pane's identity block to be "the same height and share the same baseline hairline", and the kit answered with `SPLIT_HEADER_HEIGHT` — one 72px grid row both panes pinned a header block to (d5a8a27, beffde9, db2d77f). **That premise is withdrawn and the constant is deleted.** The two panes are not one composition: the list is a queue the user scans and the detail is a record the user reads, and pinning them to a shared row forced a header onto a list pane that had nothing to put in it — then filled it with a count the tab group was already printing. The kit component is `SplitWorkspace`, on `/dev/kit`.

- **The list pane has NO header block.** The list begins immediately under the page's tabs and filters. The "n of n shown" count is deleted from it — the tab already says All 18. Show a count only when a filter narrows the set, and then inside the `ListToolbar`, never in a pane header.
- **The detail pane owns its own header** (title, meta line, actions), `position: sticky` at the top of the detail pane's OWN scroll. The list pane scrolls on its own. Layout: `grid-template-columns: minmax(360px, 40%) 1fr; min-height: 0`, list pane `border-right` hairline and `overflow-y: auto`, detail pane `min-width: 0; overflow-y: auto`.
- **Fewer horizontal rules.** Inside the detail pane, blocks (original message, extracted details, suggested action) are separated by spacing, not borders; a hairline only where removing it makes a relationship ambiguous — under the sticky header, which content passes beneath, and nowhere else (CLAUDE.md).
- **List rows:** title with the money right-aligned on row one; ref · owner on row two; stage chip and date on row three only if the stage matters, else stage folds into row two. **No third row holding a lone chip** — and no money inside a `StatusChip`, which is the one use CLAUDE.md reserves chips against.
- **The outer page container is one surface.** Title and tabs sit above the split workspace; do not box the workspace inside a second rounded card.

**Built:** `SplitWorkspace` + `/dev/kit` entry (43ccc9c); M03-S01 enquiry inbox and M03-S06 follow-up queue migrated (6063b33). A follow-up queue whose `DataTable` had 352px of fixed columns in a 40% pane became rows for the same reason — a four-column table is not a list row. `SPLIT_HEADER_HEIGHT` stays exported only until features/leads and features/contacts are off it (scr-B).
