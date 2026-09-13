# Verification pass — every route, both themes, both viewports (13 Sep 2026)

Lane D of `ai/resume-brief.md`. Owner: verifier.

## 0 · What was measured, and against what

**Pinned commit: `091e3e0`.** Five lanes were committing to the shared worktree
throughout, so every gate and every capture below was run in a detached
worktree at that commit, never in the live tree.

**The first attempt was contaminated and is not reported.** `node_modules/@trainos/*`
symlinks to `packages/*` in the LIVE tree, so a worktree pinned to a commit
still imports whatever another lane has half-written. The first sweep crashed on
eight routes with `USER_AMIRAH is not defined` — a live-tree transient, not a
defect at `091e3e0`. The worktree now carries its own `node_modules/@trainos`
pointing at its own packages, and everything below was re-measured through it.
**Anyone verifying in a worktree here must do the same or they are measuring the
live tree.**

A second self-inflicted contamination is also excluded: edits made while
developing fixes hot-reloaded into the running dev server mid-sweep and broke
the agents barrel on six routes. Those routes were re-captured from a restored
worktree; the numbers below are from the clean run.

**Blue budget method.** No script existed in the repo to inherit, and §15a's
figures were produced by an unpublished method, so absolute comparison against
them is unsafe. The number here is: per pixel `blueness = max(0, (B − max(R,G)) / 255)`,
meaned over every pixel of the viewport frame, ×100. Solid `#1F5BFF` scores
64.3%; white and the ink neutrals score ~0%. Both themes and both viewports were
measured; the table reports the higher of the two viewports per theme.

**Tooling.** Own browser context, own Chromium (`playwright-core` driving the
cached `chromium-1234` binary), never the shared Playwright session. 63 routes ×
2 themes × 2 viewports = **252 captures**, every one over 20 KB, zero hard
errors. axe-core 4.x run per capture over `wcag2a`, `wcag2aa`, `wcag21a`,
`wcag21aa` and `best-practice`.

## 1 · Root gates at `091e3e0`

| Gate | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass — 0 errors, 8 `react-refresh/only-export-components` warnings |
| `npm test -- --run` | pass — 1095 tests (834 web, 160 fixtures, 101 agent-runtime) |
| `npm run arch:graph` | pass — no violations, 328 modules / 1114 dependencies |
| `npm run build` (apps/web) | pass — 52 chunks, 1.3 MB total |

The one skipped test is `packages/agent-runtime/test/live.test.ts`, an
`it.skipIf(available.length === 0)` that runs only with a real provider key
present. It is a conditional skip, not a stub.

**`typecheck:strict` was a gate that could not say no.** `tsconfig.strict.json`
had **no graduates at all** — its `include` held only `src/vite-env.d.ts`. R6
describes a ratchet and R10 says a gate that cannot fail is not a gate; the
strict gate in `verify:deploy` was certifying nothing. Fixed below.

## 2 · Bundle: the agent runtime is genuinely absent from production

Claimed by `RunNowPanel.tsx`'s dynamic `import("@trainos/agent-runtime")` behind
`import.meta.env.DEV`. **Proven from `dist`, not from the claim.** Seven
runtime-only fingerprints were searched across all 52 emitted chunks:

| Fingerprint | Chunks containing it |
|---|---|
| `createLocalFixtureClient` | none |
| `LEAD_TO_PROPOSAL_INPUT` | none |
| `demoResponder` | none |
| `agent-runtime` | none |
| `keystore` | none |
| `ToolAdapter` | none |
| `OpenRouter` | one — and it is UI copy |

The single `OpenRouter` hit is the Provider keys screen's hint string ("Any
OpenAI-compatible endpoint also works — OpenRouter, Cerebras, Groq…"), not
runtime code. `RunNowPanel`'s own label `"Run now (mock)"` is also absent, so the
panel is tree-shaken with it and no chunk is emitted at the dynamic import.
**The exclusion holds.**

## 3 · Per-route results

63 routes: the 45 nav leaves from `navTree.ts`, 15 detail routes reached with
real fixture ids, the public portal page, and the two dev routes. **Every route
passes in both themes at both viewports with zero console errors.**

Columns: `L`/`D` are light and dark; `Console` counts console errors and page
errors; `a11y` is the worst axe violation count across the four captures;
`Solid` counts solid primary BUTTONS (`role="switch"` toggles and decorative
`bg-primary` bars are excluded — they paint the same token but are not the
view's action); `Blue L%`/`Blue D%` are the method in §0.

| Route | L/1440 | L/1920 | D/1440 | D/1920 | Console | a11y | Solid | Blue L% | Blue D% | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| `/dashboard` | pass | pass | pass | pass | 0 | 2 | 1 | 0.7 | 3.7 | mono-caps x13 |
| `/approvals` | pass | pass | pass | pass | 0 | 2 | 1 | 0.7 | 3.9 | mono-caps x3; TH caps (acronyms): SLA |
| `/my-tasks` | pass | pass | pass | pass | 0 | 2 | 1 | 0.6 | 3.8 | mono-caps x18 |
| `/sales/enquiries` | pass | pass | pass | pass | 0 | 3 | 1 | 0.8 | 3.9 | mono-caps x24 |
| `/sales/leads` | pass | pass | pass | pass | 0 | 2 | 1 | 0.6 | 3.7 | mono-caps x5 |
| `/sales/organisations` | pass | pass | pass | pass | 0 | 1 | 0 | 0.4 | 3.6 | mono-caps x15; no solid primary |
| `/sales/contacts` | pass | pass | pass | pass | 0 | 2 | 1 | 0.7 | 3.8 | mono-caps x5 |
| `/sales/pipeline` | pass | pass | pass | pass | 0 | 1 | 0 | 0.3 | 3.5 | mono-caps x8; no solid primary |
| `/sales/tna` | pass | pass | pass | pass | 0 | 1 | 0 | 0.3 | 3.6 | mono-caps x6; no solid primary |
| `/sales/proposals` | pass | pass | pass | pass | 0 | 1 | 0 | 0.3 | 3.6 | mono-caps x6; no solid primary |
| `/relationships/renewals` | pass | pass | pass | pass | 0 | 1 | 0 | 0.9 | 4.7 | mono-caps x3; no solid primary |
| `/relationships/cross-sell` | pass | pass | pass | pass | 0 | 1 | 0 | 0.6 | 4.0 | mono-caps x3; no solid primary |
| `/relationships/marketing` | pass | pass | pass | pass | 0 | 1 | 0 | 0.3 | 3.6 | mono-caps x4; no solid primary |
| `/training/programmes` | pass | pass | pass | pass | 0 | 1 | 0 | 0.3 | 3.6 | mono-caps x3; TH caps (acronyms): HRDC; no solid primary |
| `/training/engagements` | pass | pass | pass | pass | 0 | 1 | 0 | 0.4 | 3.6 | mono-caps x12; no solid primary |
| `/training/calendar` | pass | pass | pass | pass | 0 | 4 | 0 | 0.3 | 3.6 | mono-caps x3; no solid primary |
| `/training/trainers` | pass | pass | pass | pass | 0 | 1 | 0 | 0.3 | 3.6 | mono-caps x7; no solid primary |
| `/training/participants` | pass | pass | pass | pass | 0 | 1 | 0 | 0.4 | 3.6 | mono-caps x275; no solid primary |
| `/training/assessments` | pass | pass | pass | pass | 0 | 1 | 0 | 0.4 | 3.6 | mono-caps x12; no solid primary |
| `/training/certificates` | pass | pass | pass | pass | 0 | 1 | 0 | 0.3 | 3.6 | mono-caps x4; no solid primary |
| `/compliance/hrd-corp` | pass | pass | pass | pass | 0 | 1 | 0 | 12.9 | 15.3 | mono-caps x17; crumb ends at ref "ENG-0231 packet"; no solid primary |
| `/compliance/rules` | pass | pass | pass | pass | 0 | 0 | 0 | 0.3 | 3.6 | mono-caps x9; no solid primary |
| `/compliance/rule-changes` | pass | pass | pass | pass | 0 | 0 | 0 | 12.7 | 15.2 | mono-caps x16; no solid primary |
| `/compliance/documents` | pass | pass | pass | pass | 0 | 0 | 0 | 0.3 | 3.5 | mono-caps x7; no solid primary |
| `/compliance/deadlines` | pass | pass | pass | pass | 0 | 0 | 0 | 0.3 | 3.5 | mono-caps x5; no solid primary |
| `/finance/quotations` | pass | pass | pass | pass | 0 | 0 | 0 | 0.3 | 3.5 | mono-caps x9; no solid primary |
| `/finance/invoices` | pass | pass | pass | pass | 0 | 0 | 0 | 12.8 | 15.3 | mono-caps x17; crumb ends at ref "INV-2026-0311"; no solid primary |
| `/finance/collections` | pass | pass | pass | pass | 0 | 1 | 1 | 0.7 | 3.8 | mono-caps x15 |
| `/finance/commissions` | pass | pass | pass | pass | 0 | 0 | 0 | 0.3 | 3.4 | mono-caps x12; no solid primary |
| `/finance/profitability` | pass | pass | pass | pass | 0 | 0 | 0 | 0.4 | 3.6 | mono-caps x8; no solid primary |
| `/knowledge/library` | pass | pass | pass | pass | 0 | 1 | 0 | 0.3 | 3.4 | mono-caps x3; no solid primary |
| `/knowledge/sources` | pass | pass | pass | pass | 0 | 2 | 1 | 0.5 | 3.5 | mono-caps x3 |
| `/knowledge/templates` | pass | pass | pass | pass | 0 | 1 | 0 | 0.5 | 3.7 | mono-caps x3; no solid primary |
| `/knowledge/knowledge-base` | pass | pass | pass | pass | 0 | 1 | 0 | 0.3 | 3.4 | mono-caps x3; no solid primary |
| `/automation/agents` | pass | pass | pass | pass | 0 | 1 | 1 | 0.7 | 3.7 | mono-caps x17 |
| `/automation/runs` | pass | pass | pass | pass | 0 | 1 | 1 | 12.3 | 14.7 | mono-caps x33 |
| `/automation/failures` | pass | pass | pass | pass | 0 | 0 | 0 | 0.3 | 3.3 | mono-caps x4; no solid primary |
| `/automation/policies` | pass | pass | pass | pass | 0 | 1 | 0 | 0.3 | 3.6 | mono-caps x4; TH caps (acronyms): SLA; no solid primary |
| `/reports` | pass | pass | pass | pass | 0 | 0 | 0 | 0.3 | 3.5 | mono-caps x6; no solid primary |
| `/settings/organisation` | pass | pass | pass | pass | 0 | 1 | 0 | 0.3 | 3.5 | mono-caps x4; no solid primary |
| `/settings/ai-models` | pass | pass | pass | pass | 0 | 2 | 1 | 0.6 | 3.6 | mono-caps x52; TH caps (acronyms): FAST,FAST UI,MID |
| `/settings/providers` | pass | pass | pass | pass | 0 | 0 | 0 | 0.3 | 3.3 | mono-caps x23; no solid primary |
| `/settings/usage` | pass | pass | pass | pass | 0 | 8 | 1 | 0.6 | 3.5 | mono-caps x14 |
| `/settings/templates` | pass | pass | pass | pass | 0 | 0 | 0 | 0.3 | 3.6 | mono-caps x3; no solid primary |
| `/settings/policies` | pass | pass | pass | pass | 0 | 0 | 0 | 0.3 | 3.6 | mono-caps x4; no solid primary |
| `/approvals/APV-2026-0771` | pass | pass | pass | pass | 0 | 2 | 1 | 11.5 | 14.1 | mono-caps x26; crumb ends at ref "APV-2026-0771" |
| `/automation/runs/run_4788` | pass | pass | pass | pass | 0 | 0 | 0 | 12.8 | 15.3 | mono-caps x17; no solid primary |
| `/sales/enquiries/follow-ups` | pass | pass | pass | pass | 0 | 3 | 1 | 0.9 | 4.2 | mono-caps x8 |
| `/sales/enquiries/ENQ-2026-0901` | pass | pass | pass | pass | 0 | 1 | 1 | 11.4 | 14.0 | mono-caps x11 |
| `/sales/organisations/ORG-0114` | pass | pass | pass | pass | 0 | 1 | 1 | 16.2 | 18.5 | mono-caps x14; crumb ends at ref "ORG-0114" |
| `/sales/tna/TNA-0051` | pass | pass | pass | pass | 0 | 2 | 1 | 13.8 | 16.4 | mono-caps x13 |
| `/sales/proposals/PRO-2026-0166` | pass | pass | pass | pass | 0 | 1 | 1 | 12.7 | 15.3 | mono-caps x6 |
| `/finance/quotations/QUO-2026-0179` | pass | pass | pass | pass | 0 | 0 | 1 | 12.6 | 15.1 | mono-caps x8 |
| `/finance/invoices/INV-2026-0201` | pass | pass | pass | pass | 0 | 0 | 0 | 12.9 | 15.4 | mono-caps x15; crumb ends at ref "INV-2026-0201"; no solid primary |
| `/training/programmes/PRG-0009` | pass | pass | pass | pass | 0 | 1 | 0 | 12.8 | 15.4 | mono-caps x8; no solid primary |
| `/training/engagements/ENG-0231` | pass | pass | pass | pass | 0 | 1 | 1 | 17.2 | 19.4 | mono-caps x14 |
| `/training/participants/ENG-0231/attendance` | pass | pass | pass | pass | 0 | 1 | 0 | 15.4 | 17.9 | mono-caps x9; crumb ends at ref "ENG-0231 attendance"; no solid primary |
| `/training/trainers/TRN-0007` | pass | pass | pass | pass | 0 | 1 | 0 | 12.9 | 15.5 | mono-caps x13; no solid primary |
| `/compliance/hrd-corp/ENG-0231` | pass | pass | pass | pass | 0 | 1 | 0 | 12.9 | 15.3 | mono-caps x17; crumb ends at ref "ENG-0231 packet"; no solid primary |
| `/compliance/rule-changes/DOC-0219` | pass | pass | pass | pass | 0 | 0 | 0 | 12.7 | 15.2 | mono-caps x16; no solid primary |
| `/p/tok_aurora_pro_0184` | pass | pass | pass | pass | 0 | 1 | 0 | 0.3 | 3.6 | mono-caps x8; no solid primary |
| `/dev/demo` | pass | pass | pass | pass | 0 | 7 | 0 | 0.4 | 3.5 | mono-caps x27; no solid primary |
| `/dev/kit` | pass | pass | pass | pass | 0 | 16 | 45 | 1.4 | 3.6 | mono-caps x172 |
### Reading the table

**One solid primary per view: PASSES on all 63 routes.** An early count of two
was my own measurement error — in dark theme every page gains a solid
`--primary` element that is the shell's `aria-label="Dark mode"` switch, and
`/automation/agents` adds an agent kill switch. Both are `role="switch"`.

**42 routes render no solid primary at all.** Correct for reference and
read-only screens; a deviation where the artboard draws one. Confirmed
deviations: `/settings/providers` (artboard makes "Add provider key" the page
primary; it is Secondary at `ProviderKeysScreen.tsx:118`, and the only primary
is inside the drawer) and `/finance/invoices` (no header primary; "Record
payment" lives in the drawer at `InvoiceDetailScreen.tsx:375`).

**Blue budget.** 39 routes sit at 0.3–0.9% light and 3.3–4.0% dark, i.e. under
the 5% floor rather than over the 15% ceiling — the dark figure is almost
entirely the shell's own blue-grey neutrals. The accent `RecordHeader` pages run
12.8–19.4% and are recorded, not failed, per the standing override:

| Route | Blue L% | Blue D% |
|---|---|---|
| `/training/engagements/ENG-0231` | 17.2 | 19.4 |
| `/sales/organisations/ORG-0114` | 16.2 | 18.5 |
| `/training/participants/ENG-0231/attendance` | 15.4 | 17.9 |
| `/sales/tna/TNA-0051` | 13.8 | 16.4 |
| `/training/trainers/TRN-0007` | 12.9 | 15.5 |
| `/finance/invoices/INV-2026-0201` | 12.9 | 15.4 |
| `/training/programmes/PRG-0009` | 12.8 | 15.4 |
| `/compliance/hrd-corp` | 12.9 | 15.3 |

Two exceed the 19% the brief allows for accent pages: the engagement detail at
19.4% dark and the Organisation 360 at 18.5%. Both are the config with the mini
bar and the chain stepper inside the card, so the card is taller than the
approval detail's.

**Uppercase table headers are acronyms, not a violation.** `SLA`, `HRDC`,
`FAST`, `FAST UI`, `MID` are the only all-caps `<th>` strings in the app.

**Mono uppercase beyond one eyebrow per region: the largest single violation.**
Every one of the 63 routes carries more than one mono-uppercase run, and 20
routes carry ten or more. Worst: `/automation/runs` 33, `/dev/demo` 27,
`/approvals/APV-2026-0771` 26, `/sales/enquiries` 24, `/settings/providers` 23,
`/my-tasks` 18. This is §1 and §9 (mono down 70–80%, kill the tracked uppercase
eyebrow) still unapplied at kit level, and it is the single change that would
move the most screens.

> **Correction and follow-up (ui/tokens, same day).** The kit-level half is
> applied and measured in §10. Two things about this row did not survive
> re-measurement. First, the counts here are not all violations: a run is
> counted as mono-uppercase whenever the text carries no lowercase letter, and
> a record reference (`PAR-1182`, `ENQ-2026-0931`) satisfies that while being
> the use §1 explicitly KEEPS in mono. `/training/participants`, the headline
> number in this table, is 350 of 354 record references in a 136-row table and
> was never the violation it looked like. Second, the counts are dominated by
> per-row content, so they scale with fixture size rather than with how many
> distinct mono treatments a screen uses. Both are reasons to read §10's
> per-class breakdown rather than the totals.

**Breadcrumb ends at a record reference on 7 routes** — §CLAUDE.md "the
breadcrumb owns the path", so the trail must stop at the list crumb:

| Route | Last crumb |
|---|---|
| `/approvals/APV-2026-0771` | `APV-2026-0771` |
| `/sales/organisations/ORG-0114` | `ORG-0114` |
| `/finance/invoices/INV-2026-0201` | `INV-2026-0201` |
| `/training/participants/ENG-0231/attendance` | `ENG-0231 attendance` |
| `/compliance/hrd-corp/ENG-0231` | `ENG-0231 packet` |
| `/compliance/hrd-corp` (a LIST route) | `ENG-0231 packet` |
| `/finance/invoices` (a LIST route) | `INV-2026-0311` |

The last two matter most: two nav LEAVES mount a detail screen, so the list half
of HRD Corp and Invoices does not exist and the rail's own leaf lands on one
record.

**Muted text and the #69717C floor PASS.** My per-element probe found zero
light-theme text lighter than `#69717C` and zero text under 4.5:1 on the light
dashboard.

**Scrollbars (§14) verified from CSS, not geometry.** Every element reserves a
10px gutter, which my geometric probe flags on all 63 routes — but that is
deliberate: `index.css` defines `::-webkit-scrollbar` at 10px precisely to opt
Chrome out of macOS overlay bars, and hides the bar by making the thumb
`transparent` at rest, revealing it only under `.is-scrolling`. Nothing is
VISIBLE at rest, which is what §14 asks. A geometric probe cannot falsify this
rule; recorded as verified by rule, not by pixel.

## 4 · Accessibility

Violations by rule, counted as routes affected (worst capture per route):

| Rule | Routes | Max nodes | Note |
|---|---|---|---|
| `color-contrast` | 40 | 7 | **5 light, 40 dark** — a dark-theme token problem |
| `scrollable-region-focusable` | 5 | 1 | scroll container without keyboard access |
| `landmark-unique` | 3 | 8 | |
| `link-in-text-block` | 2 | 1 | |
| `nested-interactive` | 1 | 4 | |
| `dlitem` / `definition-list` | 1 | 6 | |
| `heading-order` | 1 | 1 | |
| `landmark-main-is-top-level` / `landmark-no-duplicate-main` | 1 | 2 | |

**The dark contrast failure is two shell elements, not forty screens:**

| Element | Routes |
|---|---|
| sidebar idle nav parent label — `PARENT_IDLE = "text-ink-secondary"` (`Sidebar.tsx:84`) | 26 |
| AI tint panel text — `text-primary` on `bg-ai-tint-2` (`PARENT_LIT`, `Sidebar.tsx:83`) | 8 |
| bare `.bg-primary` / `.border-primary` elements | 4 |

Fixing the two sidebar tokens in the dark map closes 34 of the 40 routes.
`shell-fix` owns `Sidebar.tsx`, `index.css` and `tokens.css`, so this is routed
rather than applied here.

> **Correction (tokens-fix, same day).** The first row above is a
> misattribution, and the dark token map is not what fails. Resolving each pair
> out of `tokens.css` and measuring it: `--ink-secondary` on the dark rail is
> **8.33:1**, the `--ink-muted` caption **5.67:1**, the idle dot **4.55:1** on
> the tint — all clear. The one failing pair is `PARENT_LIT`, which puts
> `text-primary` on `bg-ai-tint-2` at **4.05:1** where the kit's five other
> consumers of that tint use `text-primary-hover` at **7.48:1**. Fixed as a
> class name in `Sidebar.tsx:104`; no dark token value changed. Two further
> gaps the sweep did not separate are rows 1b and 1c of §7. Every pair is now
> asserted in `apps/web/src/styles/__tests__/tokens.contrast.test.ts`, which
> parses the real stylesheet rather than a copy of its values.

## 5 · Artboard comparison — the 26 screens with a twin

Anatomy deviations only; fixture-value differences ignored. Full per-screen
detail was produced against each artboard's own annotation panel.

### Systemic, worth one fix each

1. **§10b has not reached the enquiries feature at all.** All three M03 screens
   put `PillTabGroup` on its own row with `FilterBar` in the pane below — the
   exact stacked pair §10b outlaws. `EnquiryInboxPage.tsx:185/:203`,
   `FollowUpQueuePage.tsx:183/:206`. `AgentRegistryScreen.tsx:338` is the same
   shape with no `ListToolbar`, no `FilterBar` and no count.
2. **The stated reference composition is itself non-conformant.**
   `CollectionsQueueScreen.tsx` hand-rolls its header (`:190–217`) and puts
   `PillTabGroup` on its own row (`:231–242`) with no `ListToolbar`, no
   `FilterBar` and no "N of M shown". It is not in the `ListToolbar` importer
   list. Judging other screens "against Collections" propagates the defect —
   judge against §10b and ruling b0ef662 instead.
3. **Hand-rolled `<h1>` headers instead of kit `RecordHeader`:**
   `ExecutiveDashboard.tsx:188`, `ApprovalInbox.tsx:291`,
   `RulesRegistryScreen.tsx:173`, `CollectionsQueueScreen.tsx:190`,
   `DemoIndex.tsx:285`.
4. **A reference used as the h1 while `recordRef` is free or holds something
   else** (§15a): `TnaDetailPage.tsx:172`, `ClaimPacketScreen.tsx:105`
   (`recordRef` holds the employer code), `InvoiceDetailScreen.tsx:114`
   (`title={data.ref}`, `recordRef` holds the org ref — inverted).
5. **Hand-rolled `<table>`, so kit zebra and header typography are lost:**
   `InvoiceDetailScreen.tsx:187–200` (4 mono-caps `<th>`),
   `AiModelsScreen.tsx:412–455` (6 mono-caps `<th>`). Zebra is built into kit
   `DataTable.tsx:333`, so these two are the only screens that lose it.
6. **§16 is entirely unapplied on the enquiry inbox** — the biggest
   screen-level gap. Channel renders as a bordered `RefChip` capsule
   (`:468`) where §16 says muted text plus a glyph and no capsule; money renders
   as a `StatusChip` badge (`:493–497`) where §16 says a fixed right column in
   tabular numerals; `AIChip` renders unconditionally (`:485–490`) where
   confidence is an exception-only treatment.
7. **§18's control-panel ruling reached Knowledge Sources and nowhere else.**
   M18-S01 registry (`:308–324`) and M20-S16 usage (`:220–246`) still lead with
   a six-cell metric strip and a machinery table.
8. **Missing sections named in an artboard annotation:** the approval detail's
   whole preview pane (`ApprovalDetail.tsx:503–563` substitutes a summary), the
   claim packet's AI panel, M12-S08's per-change Approve/Edit/Reject and "Reject
   all", M20-S16's peak-vs-off-peak chart and cache-hit list, M04-S02's four
   missing tabs and Activity rail, M09-S02's three missing tabs.
9. **Inline `LifecycleStepper` (§11a) is correctly applied** where the artboards
   draw dot-progress (Organisation 360 engagements table, engagement detail from
   `pipeline.data.stages`). No misses found on that axis.

### Stage names from pipeline configuration

Verified: the engagement detail reads `pipeline.data.stages`
(`EngagementDetailPage.tsx:219–226`) and Collections reads
`GET /collections/rules`. Two hardcoded literals remain:
`ApprovalInbox.tsx:59–64` (urgency bucket captions) and
`ProposalBuilderPage.tsx:278` (`sub: "floor 35%"`, where the sibling costing
screen derives it from `quotation.floorMarginRate`).

### State components

`LoadingState` is present on every screen. Missing `ErrorState` retry:
`AttendanceCapturePage`, `EngagementDetailPage`, `ClientProposalPage`,
`QuotationsListPage`. Missing `EmptyState`: `AttendanceCapturePage`,
`EnquiryDetailPage`, `ClaimPacketScreen`, `ClientProposalPage`,
`CostingWorksheetPage`, `OrganisationSettingsScreen`, `AiModelsScreen`,
`UsageBudgetsScreen`, `TnaDetailPage`.

## 6 · The six known items, checked

| Item | Verdict |
|---|---|
| `renderScreen.tsx` lacks a `BreadcrumbProvider` | **CONFIRMED** — fixed, §8 |
| `useNavSelection.ts` has two `never` narrowings | **CONFIRMED** — not by grep (the word does not appear); proven by compiling the file under `tsconfig.strict.json`, which reports TS2339 twice at `:56`. Fixed, §8 |
| `automationApi.ts` / `automationPaths.ts` should fold | **CONFIRMED** — both carried `TODO(consolidation)` notes saying so. Fixed, §8 |
| Profile modal reads a hardcoded constant | **CONFIRMED and now unblocked.** `SidebarProfile.tsx:11` imports `shared/config/profileDetails`, marked invented in place. The contract lane HAS landed the type: `MeProfile` at `packages/contract/src/domain/shell.ts:82` and `GET /v1/me/profile` at `endpoints.ts:58`. Ready to wire; left for routing, see §9 |
| Four `status: string`-era ternaries left | **UNDERSTATED — there are ten.** See below |
| `/knowledge/sources` add-source primary conflict | **The screen is correct; the DETECTOR is wrong.** See below |

### The knowledge-sources "conflict" is a false positive

`KnowledgeSourcesScreen.tsx:335` renders the page primary and
`AddSourceDrawer.tsx:75` the drawer's submit, and the kit warns. But kit
`Drawer.tsx:47–54` is a Radix `Dialog.Root` with a `fixed inset-0` overlay — it
IS modal, so by the standing rule the drawer is a second VIEW and one primary
each is correct. `useSinglePrimary` counts MOUNTED instances and the page button
stays mounted behind the overlay, so it reports a clash that the reader can
never see. The defect is in the registry, not the screen: `Drawer` should open a
primary scope the way `CondensedPrimaryEcho` already suppresses the condensed
echo. Kit-level, routed.

### Ten two-branch tone ternaries, not four

`shared/components/kit/statusTone.ts` already exports exhaustive
`Record<Union, StatusTone>` maps for twenty vocabularies, which is exactly the
R14 fix. These ten sites still use a two-branch ternary whose `else` silently
swallows any value the other lane adds:

`EngagementDetailPage.tsx:481`, `AgentRegistryScreen.tsx:178`,
`CollectionsQueueScreen.tsx:168`, `ClaimPacketScreen.tsx:118`,
`TnaDetailPage.tsx:287`, `ContactsDirectoryPage.tsx:573`,
`TemplatesSettingsScreen.tsx:140`, `knowledge/TemplatesScreen.tsx:178`,
`MarketingPage.tsx:153`, `ReportsScreen.tsx:279`.

## 7 · Ranked fix list

Ranked by readers affected × rule severity. "Lane" names who owns the file.

| # | Fix | Files | Rule | Lane |
|---|---|---|---|---|
| 1 | ~~Dark-theme contrast on the sidebar idle label and the AI tint panel~~ **DONE, and it was not the token map.** Measured per pair: the dark idle label is 8.33:1, the caption 5.67:1 and the dots 4.55:1, so `PARENT_IDLE` was misattributed. The single failure was `PARENT_LIT` pairing `bg-ai-tint-2` with `text-primary` (4.05:1 dark) where PillTabGroup, FilterBar, CommandPalette, LifecycleStepper and RelationPicker all pair that tint with `text-primary-hover` (7.48:1). One class name, no dark token changed | `Sidebar.tsx:104` | text 4.5:1 | tokens-fix |
| 1b | ~~**NEW, light mode.** `--ai-tint-2` is also the selected DATA ROW, and `--ink-muted` on it measures **4.36:1**~~ **DONE (ui/tokens).** Neither retargeting the cells nor lightening the tint was available — the muted ink lives in the cell renderers a SCREEN passes, which the kit never sees, and a lighter tint lands 0.9 L\* from `--ai-tint`. The selected surface rebinds the token for its own subtree instead: `SELECTED_TINT` carries `bg-ai-tint-2` and `[--ink-muted:var(--ink-secondary)]` together, so every `text-ink-muted` descendant follows and no call site has to know. Read out of the running app, a muted span inside a selected approval row paints rgb(80,86,95) at **6.54:1** light and **6.69:1** dark. `DataTable`'s rows, its bulk bar and both `CalendarGrid` selected surfaces use it | `kit/tokens.ts`, `DataTable.tsx`, `CalendarGrid.tsx` | text 4.5:1 | kit |
| 1c | ~~`--on-primary` on a solid `bg-primary` button measures **3.24:1** in dark.~~ **DONE (ui/tokens).** Split, and the split was cheaper than the row expected: only four call sites paint the accent as a FILL under text, so `--primary-solid` / `--primary-solid-hover` took those and `--primary` kept every text and mark. The fill is #1F5BFF in BOTH themes and is deliberately absent from the dark map — no new colour, the brand hex painted where "solid blue means a human triggered it" applies. Dark: the label goes 3.24:1 → **4.82:1**, the fill holds 3.25:1 / 3.39:1 / 3.01:1 against card, canvas and L1. Confirmed in the app: the dark "Add source" and "Review next" buttons paint rgb(31,91,255) | `tokens.css`, `tailwind.config.ts`, `Button.tsx`, `ProfileModal.tsx` | text 4.5:1 | kit |
| 2 | ~~Mono down 70–80% and kill the tracked uppercase eyebrow, at kit level~~ **DONE at kit level (ui/tokens); the remainder is screen-level.** `MONO_LABEL` → `SECTION_LABEL` (UI font, 12px, sentence case) and `MoneyText` off mono were most of it. `--font-ui`/`--font-code` added and `--font-sans`/`--font-mono` retired. See §10 for measured before/after per route, and for the two owners of what is left | `kit/tokens.ts` + 26 kit files, `tokens.css`, `tailwind.config.ts` | §1, §9 | kit |
| 3 | §16 on the enquiry inbox row: channel loses its capsule, money becomes a right column in tabular numerals, `AIChip` only below threshold | `EnquiryInboxPage.tsx:468, :485–490, :493–497` | §16 | screens |
| 4 | `ListToolbar` on the three M03 screens and the agent registry | `EnquiryInboxPage.tsx:185/:203`, `FollowUpQueuePage.tsx:183/:206`, `AgentRegistryScreen.tsx:338` | §10b | screens |
| 5 | Migrate `CollectionsQueueScreen` to `RecordHeader` + `ListToolbar` — the reference screen must stop teaching the defect | `CollectionsQueueScreen.tsx:190–217, :231–242` | §10b, b0ef662 | screens |
| 6 | Breadcrumb trails stop at the list crumb on 5 record routes | `ApprovalDetail.tsx:118`, `Organisation360Page.tsx:112`, `InvoiceDetailScreen.tsx:62`, `AttendanceCapturePage.tsx:85`, `ClaimPacketScreen.tsx:57` | identity once | screens |
| 7 | Two nav LEAVES mount a detail screen, so HRD Corp and Invoices have no list half | `hrdc.routes`, `finance.routes` | R7 | screens |
| 8 | Reference moves out of the h1 into `recordRef` on three record pages | `TnaDetailPage.tsx:172`, `ClaimPacketScreen.tsx:105`, `InvoiceDetailScreen.tsx:114` | §15a | screens |
| 9 | Two hand-rolled `<table>`s adopt kit `DataTable`, recovering zebra and header typography | `InvoiceDetailScreen.tsx:187–200`, `AiModelsScreen.tsx:412–455` | consolidation | screens |
| 10 | `Drawer` opens a primary scope so `useSinglePrimary` stops reporting a clash the reader cannot see | `Drawer.tsx`, `useSinglePrimary.ts` | R11 | kit |
| 11 | Ten two-branch tone ternaries adopt the existing `statusTone` maps | the ten sites in §6 | R14 | screens |
| 12 | Nine screens gain an `EmptyState`, four gain an `ErrorState` retry | listed in §5 | states | screens |
| 13 | Wire the profile modal to `GET /v1/me/profile`; the `MeProfile` type has landed | `SidebarProfile.tsx`, `shared/config/profileDetails.ts` | one data boundary | shell-fix |
| 14 | Hand-rolled `<h1>` headers adopt `RecordHeader withoutCondensed` | five files in §5 | consolidation | screens |
| 15 | §18 control-panel treatment for the agent registry and usage/budgets | `AgentRegistryScreen.tsx:308–324`, `UsageBudgetsScreen.tsx:220–246` | §18 | screens |
| 16 | Two hardcoded stage/policy literals read configuration | `ApprovalInbox.tsx:59–64`, `ProposalBuilderPage.tsx:278` | stage names from config | screens |
| 17 | Artboard sections still missing: approval preview pane, claim-packet AI panel, M12-S08 per-change actions, M20-S16 charts, M04-S02 tabs and Activity rail, M09-S02 tabs | listed in §5 | §11 fidelity | screens |
| 18 | Page primary restored where the artboard draws one | `ProviderKeysScreen.tsx:118`, `InvoiceDetailScreen.tsx` header | one primary | screens |
| 19 | Two accent pages exceed the 19% allowance (19.4% and 18.5% dark) | engagement detail, Organisation 360 | blue budget | screens |
| 20 | `scrollable-region-focusable` on five routes; `nested-interactive` on one | see §4 | a11y | kit |

## 8 · Applied here

Three fixes, each a pathspec commit against a file no live lane held (`git status`
checked per file first), each verified before commit.

| Commit | What | Evidence |
|---|---|---|
| `7022caa` | `selectNav` graduates to strict; `tsconfig.strict.json` gets its first graduate | the two TS2339s are gone under `tsconfig.strict.json`; 6 existing tests pass; `typecheck:strict` now actually checks a file |
| `34f32d8` | `renderScreen` mounts `BreadcrumbProvider` plus an attribute-only probe, so a declared trail is testable in all 103 suites | 834 web tests pass unchanged; eslint clean |
| `b44ed77` | `automationApi.ts` and `automationPaths.ts` fold into `api.ts` and `paths.ts`, clearing both `TODO(consolidation)` notes | 28 agents tests pass; depcruise 327 modules where it cruised 328 |
| `001a501` | Four breadcrumb trails stop at the list crumb (Organisation 360, invoice detail, attendance capture, claim packet) | 79 tests across the four features pass; the attendance test that PINNED the old shape is updated with it |
| `cb75f9e` | The h1 names the record and `recordRef` carries the reference on the TNA detail, the claim packet and the invoice detail (§15a) | 908 web tests pass; two tests asserting the old concatenated headings are updated |
| `db9a675` | `check:barrels` — a barrel may not export a file nobody committed — as its OWN blocking CI job | both failure modes probed with deliberate violations; clean at HEAD and in the working tree |
| `fab5fe4` | The profile modal reads `GET /v1/me/profile`; `shared/config/profileDetails.ts` deleted | 914 web tests pass; the role switch is asserted to CHANGE the job title and email; verified in a browser, both themes, zero console errors |

Fix list rows 6, 8 and 13 are closed.

**A note on row 13's gate.** `check:barrels` caught its own author: adding
`useMeProfile` to the layout barrel before staging the file failed the check on
the very next run. That is the defect it was written for, reproduced by accident
within the hour.

**Three items added by the lead and checked here:**

| Item | Verdict |
|---|---|
| `useNavSelection.ts:56` two `never` narrowings block strict graduation | Already fixed in `7022caa` before the request arrived |
| `packages/fixtures` typecheck failing on `ActionResponse.result` | **Not reproducible.** Clean at HEAD `b73dfb2` and clean in the live working tree. It was an in-flight transient and is gone |
| A barrel may export an uncommitted file | **Real class, no live instance.** `KanbanBoard.tsx` is tracked now; all 32 barrels are clean. Gated in `db9a675` |

Fix list rows 6 and 8 are therefore closed. The approval detail was dropped from
row 6 because another lane had already fixed it between the snapshot and the
commit — checked in the file, not taken from this report.

`AutomationPoliciesScreen.tsx` was nearly clobbered in the third: the snapshot
copy was 20 lines behind a comment another lane had committed after `091e3e0`.
`git diff --cached` caught it (R13) and the change was reapplied as a one-line
import swap instead of a file copy. **Copying a file from a pinned worktree into
the live tree is not safe here; patch the live file.**

## 9 · What I could not verify

- **Blue-budget numbers are not comparable to §15a's.** Different method; mine
  is stated in §0 so it is at least reproducible.
- **§14 scrollbar behaviour under motion.** Verified from the CSS rule and the
  absence of a visible thumb at rest, not by scrolling and timing the 800 ms
  fade.
- **Anything behind an interaction.** Drawers, modals, the command palette, the
  profile modal, hover and focus states, and the `?gradient=alt` comparison were
  not opened; every capture is the route at rest.
- **Roles other than the default.** Routes carry no role guard, so each screen
  was captured once as the default principal.
- **The five in-flight lanes' work.** `091e3e0` predates the contract lane's
  profile type reaching the app, the migrations, the splitpane work on the
  enquiry inbox, and the proto-header propagation beyond the two proofs.
  Anything those lanes land after `091e3e0` is unverified here.

---

## 10 · Applied by the `ui/tokens` lane (13 Sep, evening)

Three commits on `ui/tokens`, off `main`, in a worktree with its own
`node_modules` — `node_modules/@trainos/*` resolves into this worktree's own
`packages/`, checked with `readlink` before anything was measured, per §0.

### 10.1 · The two open contrast rows are closed

| Row | Was | Is | Proof |
|---|---|---|---|
| 1b · muted cell on a selected row, light | 4.36:1 | **6.54:1** light, **6.69:1** dark | painted colour read back from the running app |
| 1c · `--on-primary` on the solid primary, dark | 3.24:1 | **4.82:1** | painted fill read back as rgb(31,91,255) |

Both are also asserted out of the stylesheet. `tokens.contrast.test.ts` goes
**33 cases to 49**: the two KNOWN-GAP cases that recorded these rows as failing
are gone, replaced by the pairs that now pass plus the mechanisms they rest on —
the dark map must not override either fill token, the fill must equal light
`--primary`, `--primary` must stay AA as text on the dark card, the two AI
tints must stay at least 2 L\* apart, and `tailwind.config.ts` must still be
reading `--font-ui` / `--font-code`.

**1c cost less than the row predicted.** The row said the split "spans Button
and every `text-primary` call site". It does not: of twenty `bg-primary`
occurrences only four are a fill under text, and the rest are marks — sidebar
dots, a switch thumb, bar fills — which are non-text affordances and correctly
keep the lifted dark `--primary`. So `--primary-solid` took `Button`'s primary
and `ProfileModal`'s avatar badge, and nothing else moved.

**The fill does not theme-swap.** It is #1F5BFF in both themes, absent from the
dark map on purpose. No fourth accent, no change to #1F5BFF: the one accent
CLAUDE.md names, painted at the one place the rule "solid blue means a human
triggered it" is about. A promise that changes colour between themes is a
weaker promise.

### 10.2 · Mono-uppercase, measured before and after

Method, stated because §0's counter was never published and this is an
independent measure: a **mono run** is the closest mono-font ancestor of its own
visible text, counted once; a **mono-caps run** is a mono run that is also
uppercase, by `text-transform` or by carrying two or more letters and no
lowercase. Own Chromium, own browser context, 1440×900, both themes, every
screenshot over 20 KB, zero console errors. Light and dark produced identical
counts on every route.

| Route | mono before → after | mono-caps before → after |
|---|---|---|
| `/dashboard` | 54 → 33 | **29 → 11** |
| `/sales/enquiries` | 78 → 64 | **34 → 21** |
| `/training/participants` | 361 → 359 | 354 → 353 |
| `/compliance/hrd-corp` | 50 → 24 | **22 → 12** |
| `/finance/invoices` | 52 → 35 | **36 → 22** |
| `/automation/runs` | 142 → 81 | **53 → 17** |
| `/settings/ai-models` | 84 → 60 | 55 → 45 |
| `/settings/providers` | 50 → 24 | **28 → 12** |
| `/my-tasks` | 31 → 24 | 23 → 18 |
| `/dev/kit` | 466 → 220 | **274 → 103** |

Two constants carried most of it. `MONO_LABEL` was
`font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted`, read by nine
kit components, and is now `SECTION_LABEL` — `DataTable`'s already-migrated
column head verbatim, so the kit has one heading style rather than two.
`MoneyText` dropped `font-mono` and kept `tabular-nums`, which is brief §1's own
rule that a number aligns with tabular figures rather than with a second
typeface.

### 10.3 · What is left, and who owns it

`/training/participants` did NOT move, and the reason is the correction in §3:
272 runs of `PAR-…` and 78 of `CERT-…` are record references in a 136-row
table, which §1 keeps in mono. There is no kit lever on them and there should
not be one. `/settings/ai-models` is mostly `TierChip` (`FAST`, `MID`) and a
hand-rolled `<table>`; the tier label is a machine value and was deliberately
left alone.

Everything still counted on the five reported routes belongs to a file this
lane does not own:

| Source | Runs/route | Lane |
|---|---|---|
| `Sidebar.tsx:272` group caption (`MAIN`, `OPERATIONS`) — mono, uppercase, tracked | 3 on every route | shell-fix |
| `SidebarFooter.tsx` ×4, `states/ErrorState.tsx` ×1 | shell + states | shell-fix, states |
| Hand-rolled `font-mono … uppercase` in feature screens: `ClaimPacketScreen.tsx:159`, `ExecutiveDashboard.tsx`, `InvoiceDetailScreen.tsx` and `AiModelsScreen.tsx` `<th>`s, `Organisation360Page.tsx` ×5, `EnquiryDetailPage.tsx` ×5, `TnaDetailPage.tsx` ×4, `RulesRegistryScreen.tsx` ×4, `DemoIndex.tsx` ×3, and nine more at ×1 | 1–5 each | screens |
| `pages/KitShowcase.tsx` ×5 | dev route | kit showcase |

The two hand-rolled `<table>`s are already §5 item 5 and §7 row 9: adopting kit
`DataTable` closes their mono `<th>`s as a side effect of a fix that is wanted
anyway.

### 10.4 · Two defects found, not fixed, because the files are another lane's

- **`--on-primary` on `--danger` is 2.22:1 in dark.** `tailwind.config.ts` maps
  shadcn's `destructive.foreground` to `--on-primary`, and `ui/toast.tsx` paints
  `bg-destructive text-destructive-foreground`. Light is 5.62:1. The alias is in
  a file this lane owns; the call site is a shadcn primitive in
  `shared/components/ui/`, which is not in this lane's allowed set, so changing
  the alias alone would move the failure rather than close it.
- **`ui/button.tsx` has no importers.** It carries `bg-primary
  text-primary-foreground` and a `destructive` variant, and nothing in the app
  renders it. Dead, and a second button vocabulary beside kit `Button` — the
  divergence CLAUDE.md names. Deleting it is a `shared/components/ui/` change.

### 10.5 · Gates at `5f01e57`

| Gate | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run typecheck:strict` | pass |
| `npm run lint` | pass — 0 errors, 8 pre-existing `react-refresh` warnings, the same 8 as §1 |
| `npm test -- --run` | pass — 996 web, 90 worker, fixtures and agent-runtime clean |
| `npm run build` | pass — 1.93s |
| `npm run check:barrels` | pass — 32 barrels |
| `tokens.contrast.test.ts` | pass — 49 cases, was 33 |

One test changed rather than added: `Money.test.tsx` asserted `font-mono` on
`MoneyText` and now asserts `tabular-nums` and the absence of `font-mono`. It
pinned the shape the brief asked to change, so it moved with it.

### 10.6 · What this lane could not verify

- **The counts are not comparable to the notes column in §3.** That counter was
  never published; §10.2's method is stated so it is at least reproducible, and
  before and after were measured with the same one.
- **Anything behind an interaction.** The selected-row proof drove a real
  checkbox, but hover and focus states, drawers, the command palette and the
  profile modal were not opened. The `--primary-solid-hover` fill is asserted
  from the stylesheet only; its 2.41:1 separation from the dark card is a
  deliberate accepted trade, not a measured screen.
- **The 58 routes this lane did not capture.** Ten routes were measured, chosen
  as the five named in the brief plus the next-worst five from §3. A kit change
  reaches every route, but only these ten have numbers.
- **The other lanes' work.** These commits sit on `main`, not on the live tree,
  so anything shell-fix, ui-lists, ui-states or the cloud web-swap lane lands
  afterwards is unmeasured here.
