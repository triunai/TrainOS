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
Use the kit's own saved-view switcher form (Kit.dc.html "My open leads 48 · Unassigned 12 · Overdue follow-up 7 · +": a contained track with the selected segment as a filled surface inside it) but with the rounding pulled back hard: track radius ≈ `--radius-panel` (10px), selected segment ≈ `--radius-control` (6–8px) — **not** fully round. Keep counts inline, "+" to add a view, corporate sentence case. (User said "20–40px of rounding" — interpret as a fraction of the current full-round, i.e. modest radius; confirm on the first render.)

### 12b. Sidebar amendments (11:45)
- No « collapse chevron; keep the hairline above the footer. No rail-collapse for now.
- Profile row (avatar · name · role) moves to the TOP of the sidebar under the wordmark, with a light/dark **toggle switch** beside it (theme is one click; not in a menu).
- Clicking the profile opens the kit **Profile modal** exactly as drawn in Kit.dc.html ("PROFILE MODAL · 960").
- Footer: Help & support · Shortcuts · Role drop-up (DEV) · version line.

### 11a. Inline lifecycle steppers in tables (11:46, reference M04-S02 engagements table)
Rows the artboards draw with the dot-progress stepper (done ●, current ◯ blue ring, blocked ● amber, lost ● red with red segment) render the kit `LifecycleStepper` inline variant from server steps; never text. Enumerate by grepping the artboards, not by memory. Cells: name + mono `ref · status` subline, dates, money right-aligned tabular. (Assigned to applier-2 as an immediate item; the fidelity pass re-checks.)

## 17. Localisation (11:47)
The pack's topbar has an EN | BM switch; the app has no i18n. Now (shell-fix): the switch, an I18nProvider (locale from /me, persisted, `<html lang>`), and shell strings in EN + BM. Next pass: a real catalogue (react-i18next or a typed dictionary), every screen's UI strings keyed, BM translations reviewed by a native speaker, date/number formatting via Intl for `ms-MY`, and the portal page localised (client-facing). Contract already carries `locale` on /me.
