# Resume manifest — 13 Sep 2026

Scout output for dispatching parallel agents without re-reading the tree.
Read `ai/resume-brief.md` for the in-flight lanes first; this file is the
launch surface for what is NOT yet started.

---

## 1 · NAV vs SCREENS

### How the route table works (no second list to keep in sync)

`apps/web/src/shared/config/navTree.ts` carries `TREE` verbatim from the design
pack. `apps/web/src/shared/config/nav.ts` derives every path by ONE rule
(`navPath`): a child of `Home` lives at the root (`/approvals`), any other child
under its parent slug (`/sales/enquiries`), a childless parent is itself a leaf
(`/reports`). `ALL_NAV_ROUTES` flattens that to **45 leaves**.

`apps/web/src/routes/routes.tsx` spreads `FEATURE_ROUTES` **before**
`ALL_NAV_ROUTES.map(... PlaceholderPage ...)`. React Router scores identical
paths equally and breaks ties on declaration order, so a real screen mounted
first wins and the generated placeholder is dead for that path.

**Consequence for dispatch: building a screen requires NO nav edit.** Add the
feature's route array, and the placeholder stops rendering. `navTree.ts` and
`nav.ts` are off-limits to screen agents.

`apps/web/src/pages/PlaceholderPage.tsx` renders the nav caption/section, the
label, and a kit `EmptyState` reading "<label> is not built yet".

### Built: 15 of 45 nav leaves

| Nav leaf                  | Path                       | Screen                                          |
| ------------------------- | -------------------------- | ----------------------------------------------- |
| Home › Dashboard          | `/dashboard`               | `features/dashboard/ExecutiveDashboard.tsx`     |
| Home › Approvals          | `/approvals`               | `features/approvals/ApprovalInbox.tsx`          |
| Sales › Enquiries         | `/sales/enquiries`         | `features/enquiries/EnquiryInboxPage.tsx`       |
| Training › Programmes     | `/training/programmes`     | `features/programmes/ProgrammesListPage.tsx`    |
| Compliance › HRD Corp     | `/compliance/hrd-corp`     | `features/hrdc/ClaimPacketScreen.tsx`           |
| Compliance › Rules        | `/compliance/rules`        | `features/hrdc/RulesRegistryScreen.tsx`         |
| Compliance › Rule changes | `/compliance/rule-changes` | `features/hrdc/RuleChangeReviewScreen.tsx`      |
| Finance › Invoices        | `/finance/invoices`        | `features/finance/InvoiceDetailScreen.tsx`      |
| Finance › Collections     | `/finance/collections`     | `features/finance/CollectionsQueueScreen.tsx`   |
| Knowledge › Sources       | `/knowledge/sources`       | `features/knowledge/KnowledgeSourcesScreen.tsx` |
| Automation › Agents       | `/automation/agents`       | `features/agents/AgentRegistryScreen.tsx`       |
| Automation › Runs         | `/automation/runs`         | `features/agents/RunTraceScreen.tsx`            |
| Settings › AI Models      | `/settings/ai-models`      | `features/settings-ai/AiModelsScreen.tsx`       |
| Settings › Providers      | `/settings/providers`      | `features/settings-ai/ProviderKeysScreen.tsx`   |
| Settings › Usage          | `/settings/usage`          | `features/settings-ai/UsageBudgetsScreen.tsx`   |

Twelve further routes are mounted that are NOT nav leaves (detail patterns and
one public route): `/approvals/:ref`, `/automation/runs/:runRef`,
`/sales/enquiries/follow-ups`, `/sales/enquiries/:enquiryId`,
`/sales/organisations/:organisationId`, `/sales/tna/:tnaId`,
`/sales/proposals/:proposalRef`, `/finance/quotations/:quotationRef`,
`/finance/invoices/:invoiceRef`, `/training/programmes/:programmeRef`,
`/training/engagements/:id`, `/training/participants/:id/attendance`,
`/compliance/hrd-corp/:engagementRef`, `/compliance/rule-changes/:documentId`,
`/p/:token` (public, sibling of the shell), plus dev-only `/dev/demo`,
`/dev/kit`.

### Unbuilt: 30 nav leaves, all rendering PlaceholderPage

**Artboard reality — read this before assigning.** The design pack draws
**26 screens** and every one of them is already built. Grepping the fifteen
`docs/design/M*.dc.html` files plus `Kit.dc.html` for screen ids returns only
M01-S01, M02-S01/S02, M03-S01/S02/S06, M04-S02, M05-S02, M06-S02,
M07-S02/S03/S07, M09-S02, M10-S06, M12-S02/S07/S08, M13-S02/S05, M16-S05,
M18-S01/S04, M20-S16/S20/S21, M22-S04. **None of the 30 unbuilt nav leaves has
an artboard.** `docs/research/09-design-pack-inventory.md` §8 item 6 confirms
it: M04, M08, M02-S03, M18-S02, M18-S05 and M20-S07 are referenced only as
wiring targets from other screens' "Wired to" fields, never drawn.

So every agent below is **inventing composition under constraint**, not
transcribing an artboard. The binding references are:

- `CLAUDE.md` (repo root) — the standing rules.
- `docs/design/2026-09-13-design-tightening-brief.md` — §1–§9 kit rules, §18 for
  every "control panel" screen (human summary first, machinery in detail).
- **The light Collections page (M13-S05) composition is the stated target look**
  for every screen: title → overview → tabs → master/detail. Artboard
  `docs/design/M13 Finance.dc.html`, dark twin `Dark M13 Finance.dc.html`,
  built screen `features/finance/CollectionsQueueScreen.tsx`.
- `docs/research/09-design-pack-inventory.md` §5 for the eight page templates,
  §7 for the rules a component must enforce.

Nearest-neighbour references are given per lane below.

---

### Dispatch: 5 lanes, zero feature-folder overlap

**ONE shared file, and it must be serialised: `apps/web/src/routes/routes.tsx`.**
Every lane that creates a NEW feature folder needs one import line and one
spread line in `FEATURE_ROUTES`. Recommended: the lead pre-adds all twelve
imports and spreads in a single commit BEFORE dispatch (pointing at route files
the agents then create), or the lead applies each lane's one-line patch on the
agent's behalf. Do not let five agents edit this file. No other file is shared.

`apps/web/src/shared/config/nav.ts` and `navTree.ts` are read-only for all lanes.

> **Collision warning against the in-flight lanes.** `git status` at scout time
> shows uncommitted work in `features/agents`, `features/approvals`,
> `features/engagements`, `features/knowledge`, `features/programmes`,
> `features/settings-ai` and `shared/components/kit`. Lanes A, D and E touch
> three of those folders. Do not launch A, D or E until applier-2, proto-header
> and scr-d/scr-f have committed.

#### Lane A — list screens whose detail already exists (6 screens, cheapest)

Each of these is a nav leaf whose `:id` detail is already mounted; the list is
the missing half, and the detail screen supplies the columns and the fixture
methods.

| Path                     | Feature folder            | Detail already built        | Reference                  |
| ------------------------ | ------------------------- | --------------------------- | -------------------------- |
| `/sales/organisations`   | `features/organisations/` | `Organisation360Page.tsx`   | M04-S02 in `Kit.dc.html`   |
| `/sales/tna`             | `features/tna/`           | `TnaDetailPage.tsx`         | `M05 TNA.dc.html`          |
| `/sales/proposals`       | `features/proposals/`     | `ProposalBuilderPage.tsx`   | `M07 Proposals.dc.html`    |
| `/finance/quotations`    | `features/proposals/`     | `CostingWorksheetPage.tsx`  | `M07 Proposals.dc.html`    |
| `/training/engagements`  | `features/engagements/`   | `EngagementDetailPage.tsx`  | `M09 Operations.dc.html`   |
| `/training/participants` | `features/engagements/`   | `AttendanceCapturePage.tsx` | `M10 Participants.dc.html` |

Path constants already exist and are unused for four of them:
`organisations/paths.ts:10 ORGANISATIONS_LIST_PATH`, `tna/paths.ts:6
TNA_LIST_PATH`, `proposals/paths.ts:12 PROPOSALS_LIST_PATH`,
`proposals/paths.ts:17 QUOTATIONS_LIST_PATH`. Engagements and participants have
no list constant yet.
Routes files: `organisations.routes.tsx`, `tna.routes.tsx`,
`proposals.routes.tsx`, `engagements.routes.tsx` (all exist).
**Blocked on:** `features/engagements` is dirty at scout time.

#### Lane B — Sales and Relationships, new features (6 screens)

`/sales/leads`, `/sales/contacts`, `/sales/pipeline`,
`/relationships/renewals`, `/relationships/cross-sell`,
`/relationships/marketing`.

New folders `features/leads/`, `features/contacts/`, `features/pipeline/`,
`features/relationships/` and four new routes files. Nearest references:
`M03 Leads.dc.html` (leads/contacts share the enquiry-inbox list template),
M04-S02 in `Kit.dc.html` (contacts), template 1 "List + filter bar"
(§5 of the inventory) for all six. Pipeline is the one with no neighbour —
give it the Collections composition with stage columns read from
`GET /v1/config/pipelines` (`PipelineConfig`, `packages/contract/src/domain/engagements.ts:48`).
CLAUDE.md: stage names and order render from pipeline configuration, never
hardcoded.

#### Lane C — Training and Compliance, new features (6 screens)

`/training/calendar`, `/training/trainers`, `/training/assessments`,
`/training/certificates`, `/compliance/documents`, `/compliance/deadlines`.

New folders `features/calendar/`, `features/trainers/`, `features/assessments/`,
`features/certificates/`, `features/compliance/`. Do NOT put documents and
deadlines in `features/hrdc/` — that folder is already three screens and is
dirty. References: `M08-S02` is named as the trainer record target from M06-S02
but is not drawn; `M09 Operations.dc.html` and `M10 Participants.dc.html` are
the nearest built neighbours; `M12 HRD Corp.dc.html` for documents/deadlines.

#### Lane D — Finance and Knowledge (5 screens)

`/finance/commissions`, `/finance/profitability`, `/knowledge/library`,
`/knowledge/templates`, `/knowledge/knowledge-base`.

Folders `features/finance/` (exists, clean) and `features/knowledge/` (exists,
DIRTY). References: `M13 Finance.dc.html` for the two finance screens — these
are the closest thing in the product to the Collections reference and should be
near-literal applications of it. `M16 Knowledge.dc.html` plus tightening brief
**§18** for the three knowledge screens: §18 is written about Sources but says
explicitly the same treatment applies to every control-panel screen.
**Blocked on:** `features/knowledge` is dirty at scout time.

#### Lane E — System: tasks, reports, automation, settings (7 screens)

`/my-tasks`, `/reports`, `/automation/failures`, `/automation/policies`,
`/settings/organisation`, `/settings/templates`, `/settings/policies`.

New folders `features/tasks/`, `features/reports/`, `features/settings/`; the
two automation screens go in `features/agents/` (DIRTY at scout time).
References: `M18-S07` "dead-letter list" is named in `Kit.dc.html` for failures
but not drawn; `M20-S07` is cited by the LifecycleStepper rule for policies but
not drawn; `M18 Agents.dc.html` and `M20 Settings AI.dc.html` are the nearest
neighbours. `/reports` is the only childless parent in the tree, so its path is
`/reports` and its nav entry has no children.
**Blocked on:** `features/agents` is dirty at scout time.

---

## 2 · ERROR / EMPTY / LOADING STATES

Kit state components live at `apps/web/src/shared/components/states/`
(`EmptyState.tsx`, `LoadingState.tsx`, `ErrorState.tsx`, barrel `index.ts`).
`ExceptionBanner` (`shared/components/kit/ExceptionBanner.tsx`) is used as a
supplementary inline banner, not a substitute for `ErrorState`.

**There is no `renderScreen` helper in the repo.** Every screen hand-rolls its
`isPending` / `isError` branches. The web best-practices review lists promoting
`renderScreen` to the kit as an applier-2 queue item; it has not landed. That is
27 copies of the same three-branch shape — a consolidation candidate under
CLAUDE.md's own rule, and the reason the gaps below exist at all.

| Screen file (under `apps/web/src/`)              | Route                                      | Load | Empty                   | Error |
| ------------------------------------------------ | ------------------------------------------ | ---- | ----------------------- | ----- |
| `features/agents/AgentRegistryScreen.tsx`        | `/automation/agents`                       | Y    | Y                       | Y     |
| `features/agents/RunTraceScreen.tsx`             | `/automation/runs`, `/:runRef`             | Y    | **N**                   | Y     |
| `features/approvals/ApprovalInbox.tsx`           | `/approvals`                               | Y    | Y                       | Y     |
| `features/approvals/ApprovalDetail.tsx`          | `/approvals/:ref`                          | Y    | **N**                   | Y     |
| `features/dashboard/ExecutiveDashboard.tsx`      | `/dashboard`                               | Y    | Y                       | Y     |
| `features/dashboard/DemoIndex.tsx`               | `/dev/demo`                                | n/a  | n/a                     | n/a   |
| `features/engagements/EngagementDetailPage.tsx`  | `/training/engagements/:id`                | Y    | inline `empty=` prop    | Y     |
| `features/engagements/AttendanceCapturePage.tsx` | `/training/participants/:id/attendance`    | Y    | n/a                     | Y     |
| `features/enquiries/EnquiryInboxPage.tsx`        | `/sales/enquiries`                         | Y    | Y                       | Y     |
| `features/enquiries/FollowUpQueuePage.tsx`       | `/sales/enquiries/follow-ups`              | Y    | Y                       | Y     |
| `features/enquiries/EnquiryDetailPage.tsx`       | `/sales/enquiries/:enquiryId`              | Y    | n/a                     | Y     |
| `features/finance/InvoiceDetailScreen.tsx`       | `/finance/invoices`, `/:invoiceRef`        | Y    | Y                       | Y     |
| `features/finance/CollectionsQueueScreen.tsx`    | `/finance/collections`                     | Y    | Y                       | Y     |
| `features/hrdc/ClaimPacketScreen.tsx`            | `/compliance/hrd-corp`, `/:engagementRef`  | Y    | n/a                     | Y     |
| `features/hrdc/RulesRegistryScreen.tsx`          | `/compliance/rules`                        | Y    | Y                       | Y     |
| `features/hrdc/RuleChangeReviewScreen.tsx`       | `/compliance/rule-changes`, `/:documentId` | Y    | **N**                   | Y     |
| `features/knowledge/KnowledgeSourcesScreen.tsx`  | `/knowledge/sources`                       | Y    | Y                       | Y     |
| `features/organisations/Organisation360Page.tsx` | `/sales/organisations/:organisationId`     | Y    | **N**                   | Y     |
| `features/portal/ClientProposalPage.tsx`         | `/p/:token`                                | Y    | Y (via `CommentThread`) | Y     |
| `features/programmes/ProgrammesListPage.tsx`     | `/training/programmes`                     | Y    | Y                       | Y     |
| `features/programmes/ProgrammeDetailPage.tsx`    | `/training/programmes/:programmeRef`       | Y    | Y                       | Y     |
| `features/proposals/ProposalBuilderPage.tsx`     | `/sales/proposals/:proposalRef`            | Y    | via `ExceptionBanner`   | Y     |
| `features/proposals/CostingWorksheetPage.tsx`    | `/finance/quotations/:quotationRef`        | Y    | n/a                     | Y     |
| `features/settings-ai/AiModelsScreen.tsx`        | `/settings/ai-models`                      | Y    | n/a                     | Y     |
| `features/settings-ai/ProviderKeysScreen.tsx`    | `/settings/providers`                      | Y    | Y                       | Y     |
| `features/settings-ai/UsageBudgetsScreen.tsx`    | `/settings/usage`                          | Y    | n/a                     | Y     |
| `features/tna/TnaDetailPage.tsx`                 | `/sales/tna/:tnaId`                        | Y    | n/a                     | Y     |

**No screen is missing Loading or Error at the top level.** Four are missing a
real `EmptyState` on a collection that can genuinely be empty:

1. `RunTraceScreen.tsx` — a run with no events.
2. `ApprovalDetail.tsx` — a zero-entry audit trail.
3. `RuleChangeReviewScreen.tsx` — a change set with zero changes.
4. `Organisation360Page.tsx` — suggestions fall back to `?? []`, so empty and
   errored look identical.

Two more render an empty state that is not the kit component:
`EngagementDetailPage.tsx` (inline `empty=` prop) and `ProposalBuilderPage.tsx`
(`ExceptionBanner` "no sections yet"). Under CLAUDE.md's consolidation rule both
are divergence and should migrate to `EmptyState`.

### Fixture client calls whose failure never reaches the user

These are read as `.data?.x` with no `isError` branch, so a transport or policy
failure renders as absent data:

| File                                              | Hook                               | What is swallowed                                                                                                                                |
| ------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `features/engagements/api.ts`                     | `usePipelineConfig`                | lifecycle stages silently vanish                                                                                                                 |
| `features/engagements/api.ts`                     | `useOrganisation`                  | header org name silently blank                                                                                                                   |
| `features/organisations/api.ts`                   | `useOrganisationSuggestions`       | error reads as "no suggestions"                                                                                                                  |
| `features/organisations/api.ts`                   | `useDealChainStages`               | stages silently absent                                                                                                                           |
| `features/proposals/api.ts`                       | `useRateCard`                      | rate-card version silently absent                                                                                                                |
| `features/proposals/api.ts`                       | `useProposalClient`, `useApproval` | header + banner silently absent                                                                                                                  |
| `features/tna/api.ts`                             | `useTnaClient`                     | title silently absent                                                                                                                            |
| `features/enquiries/api.ts`                       | `useOrganisation`                  | HRDC levy figure silently absent                                                                                                                 |
| `features/approvals/api.ts`                       | `useApprovalAudit`                 | renders "Audit trail · 0", same as genuinely empty                                                                                               |
| `features/hrdc/api.ts`                            | `useAttachDocument`                | mutation has no `onError`; `isError` never rendered                                                                                              |
| `features/hrdc/api.ts`                            | `useCreateComplianceRule`          | only `isPending` consumed; `isError` never rendered                                                                                              |
| `features/knowledge/api.ts`                       | `useCreateSource`                  | exported, imported nowhere — dead, no UI at all                                                                                                  |
| `features/finance/api.ts`, `features/hrdc/api.ts` | `useActor`                         | the `getMe()` error is discarded inside the hook (`return data ? {...} : undefined`), so a failed identity fetch is invisible at every call site |

`useActor` is the one to fix first: it is consumed by `EngagementDetailPage`,
`EnquiryDetailPage`, `TnaDetailPage` and `ClaimPacketScreen`, and the hook
itself destroys the error before any screen could render it.

---

## 3 · API DOCS — what exists, what is newest

Every document describing the API surface, with its provenance:

| Document                                                   | Date                                                                                                              | What it is                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/design/API_CONTRACT.md` (76 KB)                      | authored in the design-pack chat, committed `3709419` "copy the design pack into the repo, verbatim", 12 Sep 2026 | **The full contract. Eighteen sections.** Base path `/v1`, entity envelope, money as integer minor units, `UPPER_SNAKE` enums, §12 enum catalogue, §13 screen→endpoint matrix, §14 event catalogue, §17 additions, §18 "Supersedes".                                                                  |
| `docs/design/API.md` (15 KB)                               | same commit                                                                                                       | The short orientation doc derived from the contract. Note it describes itself as covering "the 20 screens in the demo pack" and uses `/api/v1` with `{ amountSen, currency, display }` money — **an earlier draft's conventions**, contradicted by `API_CONTRACT.md` (`/v1`, `{ amount, currency }`). |
| `docs/design/API_CONTRACT_PROMPT.md`                       | same commit                                                                                                       | The prompt that generated the two above. Not a contract.                                                                                                                                                                                                                                              |
| `docs/design/DECISIONS.md`                                 | same commit                                                                                                       | Applied OVER the contract text. Required reading with it.                                                                                                                                                                                                                                             |
| `docs/architecture/01`–`05` + `06-critic-review.md`        | 12 Sep 2026                                                                                                       | Database-side: domain model, tenancy/auth/RLS, the action envelope and policy gate, money/versioning/provenance, events/outbox/realtime/audit. These describe the SQL surface, not HTTP.                                                                                                              |
| `docs/architecture/spikes/2026-09-12-agent-jwt-minting.md` | 12 Sep 2026                                                                                                       | Settles agent auth.                                                                                                                                                                                                                                                                                   |
| `supabase/migrations/migration-catalog.md`                 | live, amended 13 Sep                                                                                              | The canonical DB record; carries the 7-point RPC contract check per migration.                                                                                                                                                                                                                        |
| `packages/contract/README.md` + `src/**`                   | live                                                                                                              | The executable form.                                                                                                                                                                                                                                                                                  |

**Newest / authoritative: `docs/design/API_CONTRACT.md`, read through
`DECISIONS.md` and its own §18 Supersedes.** `API.md` is the stale one — do not
let an agent take money shape or base path from it.

Nothing was written on the night of 12→13 Sep. All three `docs/design/API*.md`
files arrived in one verbatim design-pack copy commit (`3709419`, 12 Sep). If
the user believes API docs were written last night, they are either the
**tightening brief** (`docs/design/2026-09-13-design-tightening-brief.md`, 13
Sep, design not API) or the **web best-practices review**
(`docs/reviews/2026-09-13-web-best-practices-review.md`, 13 Sep), whose W-63
through W-69 findings are contract findings. Both are 13 Sep. There is no
fourth API document anywhere under `docs/`, `packages/contract/`, `supabase/`
or `ai/`.

### Does `packages/contract` match it?

Yes, and deliberately. `packages/contract/README.md` carries a section map from
each contract section to each file, states that §18 Supersedes and
`DECISIONS.md` are applied over the earlier text, and says every exported type
carries a `/** §N */` comment naming its source section. Eighteen source files,
114 endpoint entries in `src/endpoints.ts` derived from §13 plus §17's new rows.
Types only; the three runtime exceptions are the enum arrays, the endpoint table
and the fixture ids.

The divergences are the ones listed in §4 below — fields the screens needed that
the contract never declared, and three enums the contract left as `string`.

---

## 4 · CONTRACT GAPS — the fix list

All five are deferred in `docs/reviews/2026-09-13-web-best-practices-review.md`
under "Deferred, with the reason → Needs `packages/contract`, which this pass
does not own." They are the whole reason a contract lane exists.

| #   | Contract file to change                                                                  | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Unblocks                                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `packages/contract/src/domain/proposals.ts:324` (`Quotation`)                            | Add a `status` field with a real enum. `Quotation` declares no status at all.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **W-63** — `features/proposals/CostingWorksheetPage.tsx:139` hardcodes `<StatusChip tone="neutral">Draft</StatusChip>`, a permanent lie.                                                                                                   |
| 2   | `packages/contract/src/domain/proposals.ts` (`Quotation`, `FloorPriceBreachDetails`)     | `FloorPriceBreachDetails` declares only `floorPrice`, `resultingMarginRate`, `requiresPolicy`. Add `absoluteFloorPrice`, `marginFloorPrice`, `bindingFloorBasis: BindingFloorBasis`.                                                                                                                                                                                                                                                                                                                                                              | **W-65** — `features/proposals/api.ts:96` re-declares all three locally and `CostingWorksheetPage.tsx:419` reads `breach.bindingFloorBasis` off a cast at `api.ts:101`.                                                                    |
| 3   | consumers, not the contract                                                              | Delete the fixture-type imports from screens (R1: every response type comes from `@trainos/contract`). `features/proposals/CostingWorksheetPage.tsx:11` imports `QuotationWithFloors` from `@trainos/fixtures`; `features/finance/CollectionsQueueScreen.tsx:4` imports `FixtureReceivable`; `features/programmes/ProgrammeDetailPage.tsx:4` imports `EngagementProjection` and `ProgrammeDelivery`. The fixtures alias is stale — the contract already declares the floor fields and uses `BindingFloorBasis` where fixtures use `BindingFloor`. | **W-64**                                                                                                                                                                                                                                   |
| 4   | `packages/contract/src/domain/proposals.ts:212` — `Programme.status` is `status: string` | Replace with an enum in `src/enums.ts`. A tone map over a `string` cannot be total, which is why `PROGRAMME_TONE` could not be consolidated with the other nine in W-11 and `ProgrammeDetailPage` still carries a ternary.                                                                                                                                                                                                                                                                                                                        | **W-11 remainder**                                                                                                                                                                                                                         |
| 5   | `packages/contract/src/domain/engagements.ts:39` — `LifecycleStep.key` is `key: string`  | Type the key, or resolve steps only through `PipelineConfig.stages` (`engagements.ts:48`).                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **W-15 remainder** — `features/engagements/EngagementDetailPage.tsx:169` matches `step.key === "ATTENDANCE_LOCKED"`. CLAUDE.md: stage names and order render from pipeline configuration, never hardcoded. Nothing catches a rename today. |
| 6   | `packages/contract/src/domain/enquiries.ts:176` — `AlternativeCategoryRate`              | Add `ratePerMessageExact?: string`. The sibling `MessageDraft` (`enquiries.ts:200`) already carries `ratePerMessageExact` — "the exact rate returned as a string for display" — but the alternative-category comparison beside it carries only `ratePerMessage: Money`, so the comparison rounds where the primary does not. Consumer: `shared/components/kit/WhatsAppCostStrip.tsx:40`.                                                                                                                                                          | display parity in the cost strip                                                                                                                                                                                                           |

Three more `status: string` fields exist and are worth sweeping in the same
pass: `domain/agents.ts:248`, `domain/organisations.ts:107`,
`domain/hrdc-finance.ts:127` and `:413`, plus `enquiries.ts:139`
(`tna.status`). `enquiries.ts` also carries an open
`TODO(contract §16 Q4)` on rate cache TTL and the failed-lookup case.

Also note `packages/contract/src/enums.ts` generates the 69 database enum types.
**A change there is a migration.**

---

## 5 · SUPABASE

### State: PAUSED after 010

`supabase/HANDOFF.md` is the resume document. Migrations **001 through 010 are
authored, executed and committed**; amendment pass A (13 Sep, `01d9da0`) applied
the open rulings to 001–005 and 010 landed at `cfef7c1` with catalog marks
`a549e8c`. **Nothing has been applied to any hosted Supabase project** and no
Supabase MCP apply/execute tool has been used. Stopped by the user after 010 on
13 Sep 11:20 for UI focus and quota.

### What 011 to 016 are meant to contain

| #       | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **011** | **The action envelope** — `app.submit_action()`, the policy gate it calls, `action_request` / `action_effect`, and the `app.action_types` seed (the catalogue table was created in 004, seeded here). All 22 action types register as DATA, including `ACCOUNT_TRADING_HOLD`. 011 gates `RULE_CHANGE_APPROVE`, `ATTENDANCE_APPROVE`, `ATTENDANCE_UNLOCK`, and resolves `collections_cases.trading_hold_action_id`, deliberately left FK-less by 010. The C-04 sequencing residue is flagged in 010's header for 011. |
| **012** | Events, outbox, realtime plumbing. One shared enum `app.effect_status` at the outbox seam; `report_effect_result(effect_id, …)` must RAISE on an unknown value (doc 05 §2.7).                                                                                                                                                                                                                                                                                                                                        |
| **013** | AI-ops tables (agent tooling; some 010 functions have zero call sites until 013 and the collections queue — **if they still have zero after 016, that IS a finding**).                                                                                                                                                                                                                                                                                                                                               |
| **014** | **RLS policies.** Every table from 004–013 is RLS-enabled and FORCED with **zero policies** today, so the whole domain is deny-all until here. 014 also grants, exposes the client portal's public surface, closes the four forward-reference FKs 005 left open, and `test_014` carries the owner/peer/other-tenant/anon four-way matrix plus the schema-wide `REVOKE` sweep.                                                                                                                                        |
| **015** | Realtime + `pg_cron` scheduling.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **016** | Seed data.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Also still open at pause: 7 critical / 29 high from `docs/architecture/06-critic-review.md` Part 2 —
C-07 retention, C-08 poison-pill retry, C-09 PDPA vs the append-only event log,
C-10 levy staleness, C-11 MyInvois are owned by 011–015 and are not amendments
to 001–009.

### Conventions used in 001 to 010

**Four artifacts, or it is not reviewable** (`supabase/CLAUDE.md`):

| Artifact | Path                                                                                    |
| -------- | --------------------------------------------------------------------------------------- |
| Forward  | `supabase/migrations/NNN_<slug>.sql`                                                    |
| Rollback | `supabase/rollbacks/NNN_<slug>_rollback.sql`                                            |
| Pin      | `supabase/tests/test_NNN_<slug>.sql`                                                    |
| Catalog  | `supabase/migrations/migration-catalog.md` — Migration Order row **and** Detail section |

Same-commit hard rule: any touch to `supabase/migrations/` updates the catalog
in the SAME commit. A catalog entry in a follow-up commit fails the gate.

**Rollback:** reproduces the prior definition IN FULL. A rollback that says "see
migration 007" is not a rollback. States the drop ORDER, normally the reverse of
the forward order. 001's rollback drops only the three extensions it genuinely
creates — pgcrypto is excluded because Supabase installs it on every project, so
dropping it would destroy prior state rather than restore it.

**Pin:** ends in `ROLLBACK` and writes nothing durable. Numbered checks
(T1, T2, T3…) each asserting one property. **An authored pin that was never run
is not a pin.** Each Detail section also closes with the **7-point RPC contract
check** worked (envelope / unwrap / RpcMap / call sites / casts /
reload-restore / public routes) and a "Spine untouched" line.

**Security rules that bite.** Every function is `SET search_path = ''` — the
EMPTY path, one spelling across the pack — with every reference schema-qualified.
`test_001` T3 asserts the **exact stored string** `search_path=""` as one element
of `proconfig`. Never `proconfig IS NOT NULL`: that passes all three spellings
including the broken `SET search_path = 'a, b'`, one quoted string containing a
comma, which names a single schema and is not a path at all. This rule CHANGED
on 13 Sep — it used to prescribe the four-part
`'pg_catalog', 'public', 'extensions', 'pg_temp'` form, which stores a different
`proconfig` string, so all forty functions failed their own guard.

RLS is enabled AND FORCED on every table in `public`, `app` and `core`,
including config and reference tables. FORCE removes the owner's exemption, so
every table a `SECURITY DEFINER` function must read carries a policy admitting
that read or it silently returns zero rows. `app.finalise_table()` (004) applies
the whole standard posture — composite uniques, tenant index, `updated_at`
trigger, frozen `tenant_id`/`ref`, ref allocation, RLS enabled and forced with
zero policies — and refuses a table with no `tenant_id`.

### How they are run on the local PostgreSQL shim

There is **no Supabase CLI and no Docker** in the authoring environment.
`supabase start` and `supabase db reset` were never run.

What was run, per the catalog's "How this set was validated" section
(`supabase/migrations/migration-catalog.md`, near line 715):

- A scratch **PostgreSQL 17.11** cluster, Homebrew, started on
  **`127.0.0.1:55432`** inside the session scratch directory, with
  `wal_level = logical`.
- Seeded with a platform shim supplying the `anon` / `authenticated` /
  `service_role` / `authenticator` roles, the `auth` schema with `auth.users`,
  `auth.uid()`, `auth.jwt()` and `auth.role()` reading `request.jwt.claims`, the
  `supabase_realtime` publication, and a `storage.buckets` stub.
- `pg_cron` and `pg_net` are installed as **local stub extensions** — real
  control files and scripts in the cluster's extension directory generated by
  `harness/install_stub_extensions.sh` — which record what would have been
  scheduled or requested and do nothing else. The shim no longer pre-creates the
  `cron` schema, because 001 itself runs `CREATE EXTENSION pg_cron`.
- `vector` is the **real** extension (`brew install pgvector`, 0.8.6), so
  `extensions.vector(1536)` and the HNSW index with `vector_cosine_ops` are
  genuinely created and exercised.
- Every migration applied in numeric order, every rollback executed, every pin
  executed and its output READ.
- **Pins run against the FULL applied set**, not immediately after their own
  migration. This change found three real defects: `test_003` T2 and T5 and
  `test_004` T1a all failed when run against all nine — two pin defects and one
  genuinely missing `FORCE`. A pin that has only ever run at the moment that
  flatters it has not been run.
- A **`BYPASSRLS` probe**: this cluster's `postgres` is a superuser with
  `BYPASSRLS`, so doc 02 §4.1's question cannot be answered by asking it. The
  probe reassigns a table and its `SECURITY DEFINER` reader to a role created
  `NOSUPERUSER NOBYPASSRLS` and measures the mechanism instead.

The house form for running one file is
`psql "$DATABASE_URL" -f supabase/tests/test_NNN_<slug>.sql`
(`docs/research/04-supabase-conventions.md:579`).

> **Gap to flag before relaunching the Supabase lane.** The harness is NOT in
> the repo. There is no `.sh` file anywhere in the tree, so
> `harness/install_stub_extensions.sh`, the cluster bootstrap and the shim SQL
> all lived in a session scratch directory that is gone. Whoever resumes 011
> must either rebuild the harness from the catalog's prose description, or
> commit it this time. `scripts/` carries `check-sql-parse.mjs`,
> `check-rpc-contract.mjs` and `check-grants.mjs` (`npm run lint:sql`,
> `check:rpc`, `check:grants`), which are static checks over the SQL, not an
> execution harness.

### Resume instruction

Per `ai/resume-brief.md`: resume 011–016 with **Codex gpt-5.6 xhigh** via the
codex plugin, one batch per round, Claude reviewing each against
`docs/architecture/06-critic-review.md`. Spawn the migrations author with
`docs/research/04-supabase-conventions.md` plus `supabase/HANDOFF.md`. Do not
apply to any remote project.

---

## Verification notes

- Every path, line number and file name above was read at scout time on
  2026-09-13 against `main`.
- The states table in §2 was produced by a sub-agent sweep of the route files
  and feature folders; the four missing-empty findings and the swallowed-error
  list were not independently re-read line by line.
- No tests, builds or gates were run. `git status` was dirty in seven feature
  folders at scout time; the collision warnings in §1 are based on that
  snapshot and go stale as the in-flight lanes commit.
