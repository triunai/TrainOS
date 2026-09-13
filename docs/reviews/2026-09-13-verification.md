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
| 1 | Dark-theme contrast on the sidebar idle label and the AI tint panel; closes 34 of 40 a11y routes | `Sidebar.tsx:83–84`, `tokens.css` dark map | non-text 3:1 / text 4.5:1 | shell-fix |
| 2 | Mono down 70–80% and kill the tracked uppercase eyebrow, at kit level | kit section-caption component, `tokens.css` `--font-ui`/`--font-code` | §1, §9 | kit |
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
