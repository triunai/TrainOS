# Web best-practices review — `apps/web` + `packages/fixtures/src/client`

Date: 2026-09-13 · Branch: `main` · Read-only review, no source files changed.

Scope: all 14 feature folders under `apps/web/src/features/**` (27 screens),
`apps/web/src/shared/**`, `apps/web/src/routes/**`, and
`packages/fixtures/src/client/**`. Every finding below was verified by reading
the code; each carries a `file:line` and a quote. Nothing here is speculative.

## How to read this

Findings are grouped by category and numbered `W-NN`. Each has a severity, a
verified location, the problem in one sentence, the quoted code, and a concrete
fix. A follow-up agent should be able to work from this file alone.

**Line numbers are a snapshot.** A concurrent agent (`finisher`) is editing
`features/{enquiries,tna,finance,hrdc,programmes}` while this was written.
`enquiries/api.ts` shrank 178 → 151 lines and `tna/api.ts` 128 → 103 during the
review. Line numbers in those files were re-verified at the end of the pass, but
re-grep the quoted string rather than trusting the number.

## Excluded as in-progress, not findings

Two consolidations are already owned by the `finisher` agent and are
deliberately **not** reported below, even though the review surfaced them
repeatedly:

- **`useApi()` / `useAction()` duplication.** Twelve copies of `useApi()` across
  feature `api.ts` and `client.ts` files, each with a `TEMPORARY SHAPE` marker
  pointing at `shared/api`. In flight.
- **`ActionOutcome` duplication.** The per-feature copies under
  `features/finance/` and `features/hrdc/` are already deleted on disk; the kit
  copy at `shared/components/kit/ActionOutcome.tsx` is the survivor.

Where a finding sits next to one of those (for example `apiErrorFromThrown` in
`features/{dashboard,approvals}/client.ts`, which is a *different* function in
the same file), it is reported, because deleting `useApi` alone does not remove
it.

## Severity summary

| Severity | Count |
| -------- | ----- |
| CRITICAL | 3     |
| HIGH     | 24    |
| MEDIUM   | 61    |
| LOW      | 24    |
| **Total**| **112** |

The three CRITICALs are each a violation of a rule the constitution names by
number (R3, R2, and the governed-write contract), and each is systematic rather
than local — which is why they outrank the individually louder design defects.

---

# 1 · CRITICAL

## W-01 · A denied write is silent across most of the app (R3)

**CRITICAL** · app-wide · `apps/web/src/shared/api/queryClient.ts:15`

`queryClient.ts` states the rule as an asymmetry and calls the flag mandatory:

```
 *   mutate(...) fired from a button, nothing awaits it
 *       -> meta: { toastOnError: true } is MANDATORY.
```

The centralised `MutationCache` is the only thing that surfaces a failed
fire-and-forget write, and it opts in per mutation:

`apps/web/src/shared/api/queryClient.ts:40`
```ts
if (mutation.options.meta?.toastOnError !== true) return;
```

There are **40 bare `.mutate(` call sites** in feature screens (none of them
`mutateAsync`), and exactly **four mutations in the whole app** carry the flag:
`features/approvals/api.ts:137` and `features/hrdc/api.ts:108,119,143`.

Every other fire-and-forget write renders nothing on refusal. Verified silent
cases, where the screen also renders no `isError` branch for that mutation:

| Mutation | Definition | Fired from |
| -------- | ---------- | ---------- |
| `useDeadLetterRun` | `features/agents/api.ts:122` | `features/agents/RunTraceScreen.tsx:318` |
| `useReingestSource` | `features/knowledge/api.ts:62` | `features/knowledge/KnowledgeSourcesScreen.tsx:197` |
| `useExportAttendance` | `features/engagements/api.ts:200` | `AttendanceCapturePage.tsx:139` and `:283` |
| `useReopenTna` | `features/tna/api.ts` (`reopen`) | `features/tna/TnaDetailPage.tsx:183` |
| `useRecordPayment` | `features/finance/api.ts:91` | `InvoiceDetailScreen.tsx:371` |
| `useRepushInvoice` | `features/finance/api.ts:114` | `InvoiceDetailScreen.tsx:132` |
| `useSendReminder` | `features/finance/api.ts:188` | `CollectionsQueueScreen.tsx:204` |

`features/tna/TnaDetailPage.tsx:183` is the cleanest example — no flag, no
`onError`, and `reopen.error` is rendered nowhere in the file:

```tsx
<SecondaryButton onClick={() => reopen.mutate()} disabled={reopen.isPending}>
```

**Fix.** Add `meta: { toastOnError: true }` to every `useMutation` whose call
sites use bare `mutate()`. Leave it off only where a call site awaits
`mutateAsync` in a try/catch that renders inline — `approvals/api.ts:149`
documents that exemption correctly and is the model. Then add the CI assertion
R11 demands: a test (or a lint rule over `features/*/api.ts`) asserting that
every exported `useMutation` either carries the flag or is only ever called as
`mutateAsync`.

## W-02 · Idempotency keys are unique per attempt, defeating deduplication

**CRITICAL** · four features

Four governed-write hooks build the idempotency key from `Date.now()`, so a
retry of the same user intent produces a *different* key and the server cannot
recognise it as a repeat. The key is guaranteed unique per attempt, which is the
exact inverse of its purpose.

- `apps/web/src/features/enquiries/api.ts:144`
- `apps/web/src/features/tna/api.ts:96`
- `apps/web/src/features/organisations/api.ts:82`
- `apps/web/src/features/engagements/api.ts:211`

All four are the same line:

```ts
idempotencyKey: `${request.type}:${request.targetRef}:${Date.now()}`,
```

This matters most on `usePerformAction`, which is the envelope every governed
write in those features passes through, including money and approval-gated
actions. A double-click or a user-initiated retry after a transport failure
creates two distinct governed actions.

The same file tree already contains the correct pattern — finance and hrdc build
stable keys from the request's own identity:

`apps/web/src/features/finance/api.ts:84`
```ts
idempotencyKey: `payment-${invoiceRef}-${body.reference ?? body.at}`,
```
`apps/web/src/features/hrdc/api.ts:93`
```ts
api.performAction(request, { idempotencyKey: `hrdc-submit-${engagementRef}` }),
```

**Fix.** Generate one key per user intent, not per attempt: capture
`crypto.randomUUID()` in a `useRef` when the button is first clicked and reuse it
across retries, or derive the key from the request's stable fields as finance and
hrdc already do. `features/approvals/api.ts:56` has a helper named
`idempotencyKey()` — check whether it is stable and, if so, promote it to
`shared/api` and use it at all four sites.

## W-03 · `ErrorState`'s domain/transport split is bypassed at 14 sites (R2)

**CRITICAL** · five features

`ErrorState` implements R2 correctly. It suppresses the retry button on a domain
refusal, but only when it is given the `error` object:

`apps/web/src/shared/components/states/ErrorState.tsx`
```tsx
const message = description ?? (error ? readableMessage(error) : undefined);
const refused = error !== undefined && isDomainError(error);
...
{onRetry && !refused ? (
```

When a caller passes only `description`, `error` is `undefined`, `refused` is
`false`, and **"Try again" renders over a policy decision** — the precise
failure R2 exists to prevent. 42 call sites pass `error=`; 14 pass
`description={errorMessageOf(...)}` instead and defeat the check:

| File | Lines |
| ---- | ----- |
| `features/tna/TnaDetailPage.tsx` | 92, 280 |
| `features/organisations/Organisation360Page.tsx` | 100, 167 |
| `features/programmes/ProgrammesListPage.tsx` | 241 |
| `features/programmes/ProgrammeDetailPage.tsx` | 111, 360 |
| `features/enquiries/EnquiryInboxPage.tsx` | 202, 237 |
| `features/enquiries/FollowUpQueuePage.tsx` | 183, 241 |
| `features/enquiries/EnquiryDetailPage.tsx` | 108 |

`features/enquiries/EnquiryDetailPage.tsx:106-108` offers the retry explicitly:

```tsx
<ErrorState title="The enquiry did not load"
  description={errorMessageOf(enquiry.error)}
  onRetry={() => void enquiry.refetch()} />
```

The root cause is a helper that flattens the union before the component can see
it. `errorMessageOf` is copy-pasted into five feature data layers and collapses a
dropped connection and a `FLOOR_PRICE_BREACH` into the same bare string:

`apps/web/src/features/enquiries/api.ts` (and `proposals/api.ts:79`,
`tna/api.ts:52`, `organisations/api.ts:48`, `programmes/api.ts:62`)
```ts
if (isContractError(error)) return error.message;
if (error instanceof Error) return error.message;
```

**Fix.** Delete `errorMessageOf`/`errorCodeOf` from all five feature api modules
and pass `error={toApiError(...)}` to `ErrorState` at all 14 sites. The finance
screens already do exactly this (`InvoiceDetailScreen.tsx:98`,
`CollectionsQueueScreen.tsx:225,251,304`). Add a CI assertion (R11): fail if
`ErrorState` is given `onRetry` without `error`.

---

# 2 · Design-rule violations (CLAUDE.md Part 1)

## W-04 · The one-primary guard has a hole four screens fall through

**HIGH** · `apps/web/src/shared/components/kit/useSinglePrimary.ts:64`

The runtime guard compares **labels**, and deliberately ignores a repeated
label:

```ts
/* A DIFFERENT label is the violation. The same label twice is the same
   action rendered in two places at once — a RecordHeader's primary and the
   copy its condensed scroll bar keeps reachable — ... */
const clashes = [...mounted.values()].filter((other) => other !== label);
```

The exemption is legitimate for `RecordHeader`'s condensed bar. But four screens
render a header primary **and** a drawer/footer primary that share a label, so
two solid blue buttons are on screen at once and the guard cannot fire:

| Screen | Header primary | Second primary |
| ------ | -------------- | -------------- |
| `features/finance/InvoiceDetailScreen.tsx` | "Record payment" (opens drawer) | `:368` "Record payment" (submits) |
| `features/hrdc/RulesRegistryScreen.tsx:189` | "Add rule" (opens drawer) | `:256` "Add rule" (submits) |
| `features/settings-ai/ProviderKeysScreen.tsx:130` | "Add provider key" | `AddProviderKeyDrawer.tsx:90` "Add provider key" |
| `features/proposals/ProposalBuilderPage.tsx:117` | "Send for approval" at `:161` | same element again at `:562` |

`grep -c "<PrimaryButton"` confirms two declarations in the first three files.

**Fix.** Demote the button that only *opens* the drawer to `SecondaryButton` —
opening a drawer is not the view's action. Then narrow the guard: exempt a
repeated label only when one of the two registrations comes from
`CondensedRecordHeader`, rather than exempting every repeated label. This is an
R11 case: the control as written cannot say no to the thing it was built to
catch.

## W-05 · The test written for that rule was shaped to accept the violation

**HIGH** · `apps/web/src/features/proposals/__tests__/proposals.test.tsx:223`

```ts
expect(screen.getAllByRole("button", { name: "Send for approval" })).toHaveLength(2);
expect(new Set(currentPrimaries())).toEqual(new Set(["Send for approval"]));
```

Wrapping `currentPrimaries()` in a `Set` deduplicates, so the assertion passes
with one primary, two, or twenty sharing a label — it cannot fail on the defect
the line above it documents. Same shape at `:230`.

**Fix.** Compare the array directly: `expect(currentPrimaries()).toEqual([...])`.
The enquiries and tna suites already do. Applying W-04's fix first makes this
assertion pass honestly.

## W-06 · Record identity duplicated between breadcrumb and RecordHeader

**HIGH** · seven screens

CLAUDE.md: "Record identity appears once per page: RecordHeader owns it, the
breadcrumb owns the path. Never duplicate either."
`shared/components/layout/Topbar.tsx` restates it: "nothing here ever renders a
record's name."

| File:line | Duplicate |
| --------- | --------- |
| `features/programmes/ProgrammeDetailPage.tsx:123` | `{ label: programme.name },` — `RecordHeader` at `:129` renders the same string |
| `features/tna/TnaDetailPage.tsx:158` | `<Breadcrumb items={[..., { label: record.ref }]} />` plus `recordRef` on the header |
| `features/proposals/ProposalBuilderPage.tsx:129` | `{ label: proposal.ref },` |
| `features/proposals/CostingWorksheetPage.tsx:119` | `{ label: quotation.ref },` |
| `features/enquiries/EnquiryDetailPage.tsx:74` | `{ label: enquiryId ?? "Enquiry" },` with `recordRef` at `:147` |
| `features/agents/RunTraceScreen.tsx:197` | `{ label: run.ref }` with the ref again in the title at `:207` |
| `features/dashboard/ExecutiveDashboard.tsx:175` | `<h1>{PERIOD_LABEL}</h1>` with the same string in the crumb at `:101` |

**Fix.** End every trail at the list level. One sweep, not seven local patches.

## W-07 · Two screens render their own in-content breadcrumb

**HIGH** · `features/programmes/ProgrammeDetailPage.tsx:119`,
`features/programmes/ProgrammesListPage.tsx:183`

`BreadcrumbProvider.tsx:9-12` was written to prevent exactly this: "a screen
rendering its own trail inside the content card puts the path in the wrong
place." Every other screen calls `useBreadcrumb`. The list page's crumbs carry no
`href` at all, so the path is not even navigable:

```tsx
<Breadcrumb items={[{ label: "Training" }, { label: "Programmes" }]} />
```

**Fix.** Replace both with `useBreadcrumb([...])` so the top bar owns the trail.

## W-08 · Status colour painted on text instead of chips

**HIGH** · eight sites across six features

CLAUDE.md: "Status colour lives on chips only." Verified violations:

| File:line | Quote |
| --------- | ----- |
| `features/approvals/ApprovalInbox.tsx:239` | `row.slaBreached ? "font-semibold text-danger" : ...` |
| `features/approvals/ApprovalDetail.tsx:322` | `row.slaBreached ? "text-danger" : "text-ink-muted"` |
| `features/dashboard/ExecutiveDashboard.tsx:348` | `<span className="font-semibold text-danger">SLA breached</span>` |
| `features/enquiries/FollowUpQueuePage.tsx:117` | `row.status === "OVERDUE" ? "text-danger" : "text-ink-secondary"` |
| `features/enquiries/EnquiryDetailPage.tsx:368` | `? "ml-auto shrink-0 text-[11px] text-danger"` |
| `features/agents/RunEventRow.tsx:23` | `ESCALATION: { mark: "↑", className: "text-warning" }` |
| `features/agents/RunTraceScreen.tsx:145` | `<span className="truncate font-mono text-[11px] text-danger">` |
| `features/settings-ai/ProviderKeysScreen.tsx:300,307,314` | `<p className="text-[12px] text-warning">` |

**Fix.** Move the colour onto a `StatusChip` beside the value and set the text to
`text-ink-secondary`. Note `MetricStrip`'s `DELTA_INK` is the one documented
exception and none of these are it.

## W-09 · A test pins one of those violations in place

**MEDIUM** · `features/approvals/__tests__/ApprovalInbox.test.tsx:45`

```ts
expect(sla.className).toContain("text-danger");
```

The assertion is on the Tailwind class of a non-chip element, so fixing W-08
breaks the test. Re-point it at the chip's accessible text in the same pass.

## W-10 · Status tone derived inline where the kit has a total map

**HIGH** · six sites

`kit/statusTone.ts` exists so "a screen never argues with another screen about
whether `SENT` is green". These screens argue anyway:

| File:line | Quote | Kit map that exists |
| --------- | ----- | ------------------- |
| `features/proposals/ProposalBuilderPage.tsx:144` | `tone={proposal.status === "DRAFT" ? "neutral" : "info"}` | `PROPOSAL_TONE` |
| `features/organisations/Organisation360Page.tsx:224` | `tone={invoice.status === "OVERDUE" ? "danger" : "neutral"}` | `INVOICE_TONE` |
| `features/organisations/Organisation360Page.tsx:448` | `tone={packet.state === "BLOCKED" ? "warning" : atRisk ? "danger" : "neutral"}` | `PACKET_TONE` |

The proposals ternary is not just redundant, it is **wrong**: it colours
`AWAITING_APPROVAL`, `ACCEPTED` and `LOST` all `info`, where `PROPOSAL_TONE`
gives warning / success / danger. The organisations packet rule invents a
`BLOCKED` case that is not a `PacketStatus`.

**Fix.** `tone={PROPOSAL_TONE[proposal.status]}` etc. Three one-line changes.

## W-11 · Local status-tone maps that belong in the kit

**MEDIUM** · nine maps across five features

Where the kit has no map, screens wrote their own instead of adding one — two of
them with a comment admitting it:

| File:line | Map |
| --------- | --- |
| `features/hrdc/RulesRegistryScreen.tsx:42` | `RULE_TONE` |
| `features/hrdc/RuleChangeReviewScreen.tsx:47` | `OP_TONE` |
| `features/knowledge/KnowledgeSourcesScreen.tsx:49` | `MONITOR_TONE`, `EMBEDDING_TONE` |
| `features/settings-ai/ProviderKeysScreen.tsx:47` | `STATUS_TONE`, `STATUS_LABEL` |
| `features/settings-ai/UsageBudgetsScreen.tsx:65` | `BUDGET_TONE`, `BUDGET_LABEL` |
| `features/tna/TnaDetailPage.tsx:175` | inline ternary, no `TNA_TONE` exists |
| `features/proposals/CostingWorksheetPage.tsx:140` and `:281` | the same binding-floor ternary written twice in one file |
| `features/programmes/ProgrammeDetailPage.tsx:140`, `features/organisations/Organisation360Page.tsx:374` | inline `ProgrammeStatus` / org ternaries |

**Fix.** Add `RULE_TONE`, `DIFF_OP_TONE`, `MONITOR_TONE`, `EMBEDDING_TONE`,
`PROVIDER_KEY_TONE`, `BUDGET_TONE`, `TNA_TONE`, `BINDING_FLOOR_TONE` and
`PROGRAMME_TONE` to `kit/statusTone.ts`, export from the barrel, delete the
locals.

## W-12 · AI tint used for a non-AI meaning, and without its glyph

**MEDIUM** · two screens

CLAUDE.md: AI is "the primary hue at 6% tint plus the ✦ glyph and a text label."
Two screens use the tint alone, so the tint stops meaning "AI":

`features/settings-ai/AiModelsScreen.tsx:467` — a staged edit made by the
screen's own `proposeEdits`, not by an agent:
```tsx
<tr key={entry.actionType} className={stagedTier ? "bg-ai-tint" : undefined}>
```

`features/hrdc/RuleChangeReviewScreen.tsx:293` — the tint means "currently
selected span":
```tsx
? "mt-1 rounded-[3px] bg-ai-tint px-1.5 py-1 text-[13px] leading-relaxed text-ink"
```

**Fix.** Add `AI_GLYPH` plus a text label where the content really is
machine-made; use `bg-surface-hover` or a left rule for selection.

Positive: no solid AI fills and no fourth accent were found anywhere. Every
other AI affordance pairs `bg-ai-tint` with `AIChip` and a label.

## W-13 · Solid primary hue on agent confidence

**MEDIUM** · `features/approvals/ApprovalInbox.tsx:227`

```tsx
<span className="text-primary-hover">{Math.round(row.confidence * 100)}%</span>
```

Solid blue means a human triggered it; this is an agent's confidence. The row
already carries an `AIChip` in the Requested-by column.

**Fix.** Render the percentage in `text-ink` and let the chip carry the hue.

## W-14 · Muted text below the #69717C floor

**MEDIUM** · three sites

`styles/tokens.css:51` marks `--ink-disabled` (#A3A9B2) "disabled controls and
rules ONLY", and CLAUDE.md sets #69717C as the floor for text a user must read.

- `features/dashboard/DemoIndex.tsx:271` — `<span className="font-mono text-[11px] text-ink-disabled">{step.to}</span>`
- `features/proposals/ProposalBuilderPage.tsx:401` — `placeholder:text-ink-disabled` on an enabled control
- `features/finance/StandInField.tsx:58` and `features/hrdc/StandInField.tsx:59` — `"placeholder:text-ink-disabled disabled:bg-surface disabled:text-ink-disabled"`

**Fix.** `text-ink-muted` for readable text; keep `ink-disabled` inside the
`disabled:` variant only.

## W-15 · A pipeline stage key hardcoded in a screen

**HIGH** · `features/engagements/EngagementDetailPage.tsx:169`

CLAUDE.md: "Stage names and order render from pipeline configuration, never
hardcoded." `LifecycleStep.key` is typed `string`, so nothing catches a rename:

```tsx
...(record.lifecycle.find((step) => step.key === "ATTENDANCE_LOCKED")?.at
```

The screen already fetches `pipeline.data` at `:67`.

**Fix.** Resolve the step from `pipeline.data.stages`, or read the locked
timestamp from a server-sent field.

Positive: no other hardcoded stage names were found. The collections ladder
renders from `GET /v1/collections/rules` (`CollectionsQueueScreen.tsx:71`), the
approval buckets key off the contract's `UrgencyGroup`, and the AI tier rows come
from `TIER_KEYS`.

## W-16 · Other hardcoded values presented as data

**MEDIUM** · five sites

| File:line | Quote | Why it is wrong |
| --------- | ----- | --------------- |
| `features/settings-ai/ProviderKeysScreen.tsx:67` | `from = new Date("2026-11-14T10:32:00+08:00")` | every rotation countdown is wrong the day this ships; the test at `settings-ai.test.tsx:131` only passes because of it |
| `features/settings-ai/UsageBudgetsScreen.tsx:46` | `const PERIOD = "2026-11";` | the screen shows November 2026 forever; the breadcrumb at `:194` hardcodes it a second time |
| `features/programmes/ProgrammeDetailPage.tsx:135` | `"owner L&D",` | every programme claims the same owner |
| `features/proposals/ProposalBuilderPage.tsx:239` | `sub: "floor 35%",` | the sibling worksheet reads it from `quotation.floorMarginRate` |
| `features/proposals/ProposalBuilderPage.tsx:255` | `` `Policy APV-01 reviews a proposal of this value...` `` | printed unconditionally, including below the threshold |

**Fix.** Default the clock to `new Date()` and inject a fixed clock in the test;
derive the period; read the owner and the floor off the record; render the policy
note only from the policy the server reports.

## W-17 · Hand-rolled tables where the kit owns the pattern

**MEDIUM** · two screens

- `features/settings-ai/AiModelsScreen.tsx:426` — a 110-line `<table>` re-implementing sticky header, density, column widths and empty state:
  `<table aria-label="Action type to tier assignment" className="w-full min-w-[1120px] border-collapse text-left">`
- `features/finance/InvoiceDetailScreen.tsx:180` — hand-rolled line-items table *in the same file* that renders payments through the kit's `DataTable`:
  `<table className="w-full border-collapse text-[13px]">`

Both exist because `DataTable` lacks something: a radio-cell column kind, and a
footer/summary-row slot.

**Fix.** Add both to `DataTable`, then delete the hand-rolled markup. "Add it to
the kit first, then use it."

## W-18 · A feature reaches past the kit into a raw shadcn primitive

**MEDIUM** · `features/hrdc/RuleChangeReviewScreen.tsx:21`

```ts
import { Checkbox } from "@/shared/components/ui/checkbox";
```

**Fix.** Export a kit-wrapped `Checkbox` from the barrel (`DataTable` already
renders one internally) and import that.

## W-19 · A component that says it belongs in the kit, in a feature

**HIGH** · `features/agents/RunEventRow.tsx:8`

```
 * BELONGS IN THE KIT. §4 names "event rows" as a component of M18-S04 and the
 * kit barrel has no equivalent
```

The kit has `RunStepRow` and `TraceTreeNode` but no event row.

**Fix.** Move to `shared/components/kit/RunEventRow.tsx`, export from the barrel,
delete the feature copy. Its local `tier()` at `:104` is a character-for-character
duplicate of the kit's `tierLabel` and dies with it.

---

# 3 · Data-layer

## W-20 · Missing invalidation after a successful write

**HIGH** · three hooks

| File:line | What goes stale |
| --------- | --------------- |
| `features/hrdc/api.ts:116` | attaching a document invalidates `claimPackets.all` only, so the compliance-checks query at `:73` keeps showing "3 of 5 documents present" |
| `features/engagements/api.ts:194` | capturing attendance writes the sheet into cache but never invalidates the engagement, whose `metrics.attendanceRate` is rendered at `AttendanceCapturePage.tsx:175` and `EngagementDetailPage.tsx:167` |
| `features/tna/api.ts` (`useReopenTna`) | `setQueryData` on the detail only; the TNA list and the `[...tnas.detail(id), "recommendations"]` query keep the pre-reopen status |

**Fix.** Add the sibling `invalidateQueries` call in each `onSuccess`.

## W-21 · Hardcoded query-key arrays outside the factory

**MEDIUM** · four sites

`shared/api/queryKeys.ts:2` states the rule: "Hooks never hardcode a key array."
Hierarchy is what makes invalidation safe.

- `features/enquiries/api.ts` — `queryKey: ["views", "ENQUIRY"] as const,`
- `features/proposals/api.ts:223` — `["rate-card"]`
- `features/programmes/api.ts:99` — `queryKey: ["trainers", "list"] as const,`
- `features/engagements/api.ts:101` — a whole parallel vocabulary rooted at the same string as the shared factory:
  ```ts
  organisation: (actor: string, ref: string) => ["organisations", actor, "detail", ref] as const,
  ```
  so the same organisation is cached under a different key than
  `queryKeys.organisations.detail(ref)` used by `features/organisations`, and one
  invalidation never reaches both readers.

**Fix.** Add `views`, `rateCard` and `trainers` to the factory; derive the
engagements key from `queryKeys.organisations.detail(...)` by appending the actor
segment.

## W-22 · Two caches for one fact

**MEDIUM** · two screens

- `features/settings-ai/UsageBudgetsScreen.tsx:86` — `const budgets = useBudgets();` fetches what `usage.data` already carries; the contract declares `UsageResponse.budgets: Budget[]` (`packages/contract/src/domain/ai-ops.ts:245`). The two can disagree after a cap raise.
- `features/enquiries/FollowUpQueuePage.tsx:72` — `const all = useFollowUps();` is a second unfiltered fetch of the whole queue existing only to compute tab counts, and it counts `data.length` rather than `page.total`, so counts under-report as soon as the endpoint paginates.

**Fix.** Read `usage.data.budgets`; read counts from `queue.data.page.total`.

## W-23 · Two screens read the same list under different keys

**MEDIUM** · `features/approvals/ApprovalDetail.tsx:89`

```ts
const queue = useApprovalInbox({ group: "URGENCY" });
```

The rail claims to share the inbox's read, but the inbox's page carries `view`
and `filter` (`ApprovalInbox.tsx:117-124`), so the two caches can disagree.

**Fix.** Lift the page shape into `api.ts` so both screens hit
`queryKeys.approvals.list(page)` with the same object.

## W-24 · Raw `error.message` rendered instead of the split

**MEDIUM** · three sites

- `features/agents/AgentRegistryScreen.tsx:384` — `subtitle={pause.error.message}`
- `features/agents/RunTraceScreen.tsx:338` — `subtitle={retry.error.message}`
- `features/knowledge/KnowledgeSourcesScreen.tsx:298` — `subtitle={check.error.message}`, always at `severity="DANGER"`, so a `FORBIDDEN` is drawn as a breakage

**Fix.** Use `RefusalBanner` (see W-38), which already downgrades a domain
refusal to `WARN` and names `details.requiredRole`.

## W-25 · A raw `ErrorCode` comparison against a widened helper

**MEDIUM** · `features/programmes/ProgrammeDetailPage.tsx:308`

```tsx
{errorCodeOf(edit.error) === "FORBIDDEN"
```

`errorCodeOf` returns `string | null` (`programmes/api.ts:55`), so a renamed
contract code compiles clean and silently stops matching. Same shape at
`CostingWorksheetPage.tsx:89`.

**Fix.** `isDomainError(err) && err.code === "FORBIDDEN"` against the typed
`DomainError` from `errors.ts`.

Positive: **no optimistic updates on gated commands anywhere.** Every
`performAction` hook waits for the server and invalidates in `onSuccess`. The
contract's prohibition is respected.

---

# 4 · React hygiene

## W-26 · Effects that should be derived state

**MEDIUM** · three screens

- `features/proposals/ProposalBuilderPage.tsx:81` — a no-op effect; line 76 (`sections.find(...) ?? sections[0]`) already does the work:
  ```ts
  useEffect(() => { if (activeN === null && sections.length > 0) setActiveN(sections[0]?.n ?? null); }, [activeN, sections]);
  ```
- `features/enquiries/EnquiryDetailPage.tsx:93` — an effect plus a `primed` boolean emulating "derive once from data".
- `features/settings-ai/AiModelsScreen.tsx:116` — an effect plus a `seeded` latch. This one has a **user-visible consequence**: nothing clears `staged` on a successful apply and the latch stops the effect re-deriving it, so after a successful apply the page still says "N unsaved", keeps the rows AI-tinted, and leaves the primary enabled to re-post the same edits (`:293`).

**Fix.** Derive during render (`useMemo`), merged with a `Map` of user overrides.
For the third, the minimum fix is `{ onSuccess: () => setStaged(new Map()) }`.

## W-27 · Column arrays rebuilt every render; `DataTable` is not memoised

**MEDIUM** · six screens

`shared/components/kit/DataTable.tsx` contains no `memo`. These screens hand it a
freshly-built `columns` array (with fresh accessor closures) on every render, so
every keystroke re-renders every row:

`features/engagements/AttendanceCapturePage.tsx:426` (the 30-row participant
grid, re-rendered by `setReason` at `:322`), `features/enquiries/FollowUpQueuePage.tsx:91`,
`features/tna/TnaDetailPage.tsx:121`, `features/proposals/CostingWorksheetPage.tsx:441`,
`features/finance/CollectionsQueueScreen.tsx:124`, `features/hrdc/RulesRegistryScreen.tsx:103`,
`features/finance/InvoiceDetailScreen.tsx:461`, `features/agents/RunTraceScreen.tsx:455`.

Three more *have* a `useMemo` but depend on a `useMutation` result object, which
is returned fresh every render, so the memo never hits:
`features/agents/AgentRegistryScreen.tsx:275` (`[pause],` — 11 columns),
`features/settings-ai/UsageBudgetsScreen.tsx:161` (`[raise],`),
`features/knowledge/KnowledgeSourcesScreen.tsx:207` (`[busyId, check, reingest],`).

**Fix.** Hoist static column arrays to module scope or `useMemo` them; depend on
`[x.isPending, x.mutate]`, never the result object; and `export default
memo(DataTable)` in the kit.

## W-28 · A two-state switch wired to a one-way action

**MEDIUM** · `features/agents/AgentRegistryScreen.tsx:266`

```tsx
checked={agent.killSwitch || agent.status === "PAUSED"}
onCheckedChange={() => pause.mutate({ id: agent.id, body: { actionType: null } })}
```

Flipping an already-checked switch re-sends the same pause. The switch can never
be turned off, and its visual state lies about what the click will do.

**Fix.** Read `checked` from the callback argument and call resume when it goes
false, or replace it with a `DangerButton` labelled "Pause".

## W-29 · Keyboard handlers that swallow or mislead

**HIGH/MEDIUM** · `features/approvals/`

- `ApprovalInbox.tsx:175` **HIGH** — the window-level Enter handler exempts only INPUT/TEXTAREA/SELECT, so a keyboard user pressing Enter on any focused button has the activation swallowed by `preventDefault()` and is navigated to the cursor row instead:
  ```ts
  if (event.key === "Enter") { const row = queue[focusedIndex];
    if (row) { event.preventDefault(); open(row); }
  ```
- `ApprovalDetail.tsx:339` **HIGH** — the legend advertises `<KeyboardShortcut keys={["A"]} action="approve" />`, but the `a` branch only sets `armed="APPROVE"` and the only consumer of `armed` filters to `NEEDS_NOTE` (`:249`), so A is a documented no-op.
- `ApprovalDetail.tsx:117` **MEDIUM** — no modifier guard, so Cmd+A / Ctrl+A arms a decision and is `preventDefault()`-ed away from the browser.

**Fix.** Bail out when `target.closest("button, a, [role=button]")` matches and
when any modifier key is held; make the `a` branch call `submit("APPROVE")`.

## W-30 · Labels with no accessible name

**HIGH** · `features/settings-ai/AddProviderKeyDrawer.tsx:205`

```tsx
<span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">{label}</span>
```

`Field` renders its label as a bare `<span>` with no `htmlFor`/`id`, and the
children carry no `aria-label` — so Provider, Label, Key, Billing owner and
Rotation date all have **no accessible name**.

**Fix.** Generate an id in `Field`, render a real `<label htmlFor={id}>`, and set
`id` on the control. This is the same component W-35 asks to promote, so fix it
on the way into the kit.

## W-31 · Focus dropped on both edges of inline edit

**MEDIUM** · `features/enquiries/EnquiryDetailPage.tsx:455`

Clicking the edit button unmounts it and mounts the `<input>` at `:431` without
moving focus; saving returns focus to `<body>`.

**Fix.** Focus the input on open via ref, and return focus to the trigger on
save/cancel.

## W-32 · Full page reloads inside the SPA

**MEDIUM** · two sites

- `features/proposals/CostingWorksheetPage.tsx:396` — `globalThis.location.assign(PROPOSAL_BUILDER_PATH(proposalRef));` discards the query cache, the rendered outcome and router state.
- `features/settings-ai/UsageBudgetsScreen.tsx:386` — `<a href={row.drillTo}>` to an in-app path, while the component's own comment at `:374` claims it is "a real button".

**Fix.** `useNavigate()` and `<Link to={...}>`.

## W-33 · Inert controls

**LOW** · ~25 buttons across nine screens

Real, focusable `<button>`s with no `onClick`, so the UI claims an affordance it
does not have. Concentrations: `features/agents/AgentRegistryScreen.tsx:322`
("Autonomy ladder", "Eval dashboard", "Register agent", "Open evals"),
`features/agents/RunTraceScreen.tsx:224-230`,
`features/engagements/AttendanceCapturePage.tsx:394` (the three capture-mode
buttons, which look live when `captureModes` is true),
`features/programmes/ProgrammeDetailPage.tsx:148`,
`features/enquiries/EnquiryInboxPage.tsx:165-167,256,342,376`,
`features/knowledge/KnowledgeSourcesScreen.tsx:248,262,287`,
`features/organisations/Organisation360Page.tsx:313,380`.

`features/engagements/EngagementDetailPage.tsx:141` is the honest version:
`onClick={() => toast.info("Run sheet is not wired yet")}`.

**Fix.** Give them handlers or `disabled` with a title, so a reviewer can tell
"not built" from "broken".

## W-34 · Minor hygiene

**LOW**

- `features/programmes/ProgrammeDetailPage.tsx:93` — `const window = useMemo(` shadows the global inside every nested closure. Rename to `deliveryWindow`.
- `features/agents/RunTraceScreen.tsx:61` — `depthOf` does a linear `find` per ancestor inside the render loop, so drawing the tree is O(n²). Build one `Map` in a `useMemo`.
- `features/knowledge/KnowledgeSourcesScreen.tsx:87` — `busyId` duplicates `check.variables`/`reingest.variables`, is never reset, and is shared between two mutations so a re-ingest re-enables a check still in flight. The sibling `ProviderKeysScreen.tsx:199` already uses the correct pattern.
- `features/finance/InvoiceDetailScreen.tsx:200` — `<tr key={line.description}>`; `InvoiceLine` has no id and two lines may share a description.
- `features/dashboard/ExecutiveDashboard.tsx:244` — the banner is chosen from `delta.severity` but its action label is hardcoded "Open collections", so a WARN on `CLAIM_VALUE_AT_RISK` mislabels the drill.

---

# 5 · Duplication

The single largest category. Every entry lists all known locations.

## W-35 · `TextField` — four implementations, three names

**HIGH**

| Location | Name |
| -------- | ---- |
| `features/finance/StandInField.tsx:29` | `StandInField` |
| `features/hrdc/StandInField.tsx:30` | `StandInField` |
| `features/portal/AcceptancePanel.tsx:127` | `Field` |
| `features/engagements/AttendanceCapturePage.tsx:351` | `ReasonField` |
| `features/settings-ai/AddProviderKeyDrawer.tsx:205` | `Field` |

`diff` on the two `StandInField.tsx` files reports **only a doc-comment
difference** — the component bodies are identical. Both files carry:

```
 * TEMPORARY. Delete this file when the kit ships `TextField` / `DateField`.
```

A sixth variant is a raw `<textarea>` at `features/approvals/ApprovalDetail.tsx:257`.

**Fix.** Ship `TextField` / `DateField` / `TextArea` in the kit (with the
`htmlFor` wiring W-30 needs), then delete all five and replace the textarea.

## W-36 · `renderScreen` test harness — 13 files, 5 byte-identical

**HIGH** · `features/*/__tests__/render-harness.tsx`

`md5` over the 11 `render-harness.tsx` files: five share one hash
(`2cf1caed…` — agents, knowledge and three others), the rest differ by one or two
lines. Plus two `harness.tsx` variants (portal, engagements).

**Fix.** Move one to `apps/web/src/test/renderScreen.tsx` with an optional
`actorId` param and delete the copies. Keep approvals' `harness.tsx` only if its
`pattern` signature is genuinely needed.

## W-37 · `toApiError` — three feature copies that *shadow* the shared one

**HIGH** · `features/agents/api.ts:37`, `features/settings-ai/api.ts:36`,
`features/knowledge/api.ts:30`

Three byte-identical implementations, each shadowing a differently-behaving
`toApiError` that `@/shared/api` already exports from `shared/api/errors.ts`.
The same import site could resolve to either one.

**Fix.** The shared `toApiError` already has the `isContractError` branch
(`errors.ts`, documented at length). Delete all three feature copies.

## W-38 · `RefusalBanner` — the right component, trapped in one feature

**MEDIUM** · `features/settings-ai/RefusalBanner.tsx:24`

```tsx
export function RefusalBanner({ title, error }: RefusalBannerProps) { if (!isDomainError(error)) {
```

This is the only component in the repo that renders the `errors.ts` split
correctly — which is precisely why `agents` and `knowledge` each hand-rolled a
worse version (W-24).

**Fix.** Promote to `shared/components/kit/RefusalBanner.tsx` and use it at all
three sites.

## W-39 · `errorCodeOf` / `errorMessageOf` — five copies

**MEDIUM** · `features/enquiries/api.ts`, `features/proposals/api.ts:75`,
`features/tna/api.ts:48`, `features/organisations/api.ts:48`,
`features/programmes/api.ts:55`

Two near-equivalents exist as well: `asApiError` in `features/engagements/api.ts:73`
and `features/portal/api.ts:32`.

```ts
export function errorCodeOf(error: unknown): string | null { return isContractError(error) ? error.code : null; }
```

Both helpers widen the contract's `ErrorCode` union to `string` and flatten the
domain/transport split — they are the mechanism behind W-03 and W-25.

**Fix.** Delete all five; use `toApiError` + `readableMessage` from
`shared/api/errors.ts`.

## W-40 · `apiErrorFromThrown` — two byte-identical files

**RESOLVED during this review.** The `finisher` agent landed
`apps/web/src/shared/api/useApi.ts` and deleted both `features/dashboard/client.ts`
and `features/approvals/client.ts` after this section was written. Kept for the
record; no action needed. The original finding follows.

**MEDIUM** · `features/dashboard/client.ts:35` and `features/approvals/client.ts:35`

`diff` reports **one line differs** — the comment naming the other copy. Note this
is a *different* function from the `useApi` in the same file, so it survives the
in-flight consolidation unless handled.

**Fix.** Move `apiErrorFromThrown` into `shared/api` and delete both files
alongside the `useApi` work.

## W-41 · `useOrganisation` — three definitions

**MEDIUM** · `features/enquiries/api.ts`, `features/organisations/api.ts:58`,
`features/engagements/api.ts:174`

All three key on `queryKeys.organisations.detail` (except engagements, which uses
its own vocabulary — see W-21).

**Fix.** Export from the organisations barrel; import via `@/features/organisations` (R5).

## W-42 · The label-value pair — seven implementations, five names

**MEDIUM**

| Location | Name |
| -------- | ---- |
| `features/tna/TnaDetailPage.tsx:343` | `Cell` |
| `features/enquiries/EnquiryInboxPage.tsx:397` | `ExtractedCell` |
| `features/proposals/CostingWorksheetPage.tsx:342` | `Row` |
| `features/portal/ProposalSections.tsx:67` | `Row` |
| `features/programmes/ProgrammeDetailPage.tsx` | `KeyValueRow` |
| `features/engagements/EngagementDetailPage.tsx` | `FinanceRow` |
| `features/organisations/Organisation360Page.tsx` | `RailRow` |

The kit already exports `MetricCell`.

**Fix.** Use `MetricCell`, or add a `LabelledValue` primitive and delete all seven.

## W-43 · The agent-draft panel — three hand-rolled copies

**MEDIUM** · `features/enquiries/FollowUpQueuePage.tsx:255`,
`features/tna/TnaDetailPage.tsx:285`, `features/organisations/Organisation360Page.tsx:291`

```tsx
<div className="flex items-center gap-2 border-b border-primary-border bg-ai-tint px-3 py-2">
```

Same tinted header bar, chip, right-aligned caption and bordered body. Three
screens, one behaviour, no named component.

**Fix.** Promote `AgentDraftPanel` to the kit and migrate all three in one pass.

## W-44 · `SectionHeading` — two divergent versions plus four inline copies

**MEDIUM** · `features/dashboard/ExecutiveDashboard.tsx:66` (`Section`),
`features/programmes/ProgrammeDetailPage.tsx:62` (`Section`, differently styled),
`features/organisations/Organisation360Page.tsx:191,214,243,254` (inline markup).

Two variants of one pattern is the divergence CLAUDE.md names a defect.

## W-45 · `humanise` re-implemented twice, divergently

**MEDIUM**

- `features/hrdc/RulesRegistryScreen.tsx:328` — `titleOf` returns the same string as `humanise` for every `RuleStatus`:
  ```ts
  function titleOf(status: RuleStatus): string { return status.charAt(0) + status.slice(1).toLowerCase();
  ```
- `features/enquiries/FollowUpQueuePage.tsx:336` — `TITLE` reproduces `humanise` for all four `FollowUpStatus` values. (`TITLE_CHANNEL` in the same file must stay — `humanise` would give "Whatsapp".)
- `features/enquiries/EnquiryInboxPage.tsx:57` — `CHANNEL_LABEL` renders `WEB_FORM` as `"WEB FORM"` while the sibling detail screen renders the same enum through `humanise` as "Web form" (`EnquiryDetailPage.tsx:158`). **Two visual languages for one value inside one feature.**

## W-46 · The HRDC scheme label — two spellings, one locked in by a test

**MEDIUM** · `features/portal/ProposalSections.tsx:53` vs `features/programmes/labels.ts:19`

```tsx
term={`HRD Corp claimable · ${investment.hrdcScheme.replace(/_/g, "-")}`}
```

The inline version gives `SBL-KHAS` and `HRDC-PLACEMENT`; `labels.ts` gives
`SBL-Khas` and `HRDC Placement`. The portal test at
`__tests__/ClientProposalPage.test.tsx:52` pins the inline spelling, so the
divergence is now protected by a passing test.

**Fix.** Move `hrdcSchemeLabel` into the kit (features may not import each
other), use it at both sites, and update the test.

## W-47 · `scheme.replace("_", "-")` inlined four times

**MEDIUM** · `features/hrdc/RulesRegistryScreen.tsx:116,212,357` and
`features/hrdc/ClaimPacketScreen.tsx:104`

**Fix.** Add `schemeLabel()` to `kit/format.ts` beside `humanise` and `tierLabel`.

## W-48 · `BreadcrumbProbe` — two byte-identical test helpers

**MEDIUM** · `features/portal/__tests__/BreadcrumbProbe.tsx:10` and
`features/engagements/__tests__/BreadcrumbProbe.tsx` (`diff`: no differences).

## W-49 · An inline link style hand-written in four files

**MEDIUM** · `className="text-[12px] text-primary-hover hover:underline"` at
`features/approvals/ApprovalDetail.tsx:294`,
`features/finance/InvoiceDetailScreen.tsx:335`,
`features/hrdc/ClaimPacketScreen.tsx:178`,
`features/hrdc/RulesRegistryScreen.tsx:405,418`.

**Fix.** Add `InlineLink` to the kit.

## W-50 · Cross-feature routes written as string literals (R7)

**MEDIUM** · eight sites

R7: "no second list of paths to drift." Both feature `paths.ts` files export
these and the barrels re-export them for siblings.

- `features/finance/CollectionsQueueScreen.tsx:200,294` — `navigate("/finance/invoices")`
- `features/finance/InvoiceDetailScreen.tsx:335,353`
- `features/hrdc/ClaimPacketScreen.tsx:178`, `features/hrdc/RulesRegistryScreen.tsx:186`
- `features/agents/RunTraceScreen.tsx:426` — `to="/settings/ai-models"` and `to="/settings/usage"`, while `settings-ai` exports `AI_MODELS_PATH` and `USAGE_PATH`
- `features/enquiries/EnquiryDetailPage.tsx:348` — hardcodes the TNA route while `features/tna/paths.ts:10` exports `TNA_DETAIL_PATH`
- `features/engagements/EngagementDetailPage.tsx:175` and `:371` — string-concatenates the attendance URL although `engagements/index.ts:15` exports `attendancePath(ref, day)`
- `features/dashboard/DemoIndex.tsx:124` — `to: "/p/tok_aurora_pro_0184"`, directly contradicting the file's own rule at lines 41-42 ("Every `to` is derived … never typed as a literal") while `portal/index.ts:10` exports `portalProposalPath`

## W-51 · `ACTOR_FOR_ROLE` duplicated verbatim

**LOW** · `features/organisations/api.ts:29` and `features/programmes/api.ts:34`

Nine entries each, and both hardcode one actor as a bare string (`MD: "u_lim",`)
while the other eight use exported contract constants.

---

# 6 · Test quality

## W-52 · Non-emptiness assertions dressed as counts

**MEDIUM** · ~25 assertions across nine suites

`getAllBy*` / `findAllBy*` already throw when nothing matches, so
`.length).toBeGreaterThan(0)` asserts nothing the query did not already assert.

`features/agents/__tests__/agents.test.tsx:40` (also 41, 49, 55-57, 59, 127, 169),
`features/settings-ai/__tests__/settings-ai.test.tsx:45,76,77,78`,
`features/hrdc/__tests__/hrdc.test.tsx:30,44,55,132`,
`features/finance/__tests__/finance.test.tsx:43,50`,
`features/approvals/__tests__/ApprovalDetail.test.tsx:57,58`,
`features/enquiries/__tests__/enquiries.test.tsx:31,113,172`,
`features/proposals/__tests__/proposals.test.tsx:153,158,186`,
`features/programmes/__tests__/programmes.test.tsx:64`,
`features/engagements/__tests__/AttendanceCapturePage.test.tsx:70`.

`hrdc.test.tsx:30` is the clearest — the comment two lines above states the
expected count is two:

```ts
expect(screen.getAllByText("62%").length).toBeGreaterThan(0);
```

**Fix.** Assert the real expected count, or scope the query to one row.

## W-53 · Test names that overstate what is asserted

**HIGH/MEDIUM** · seven tests

| File:line | Name claims | Actually asserts |
| --------- | ----------- | ---------------- |
| `features/finance/__tests__/finance.test.tsx:125` | "queues the send for approval **rather than sending it**" | a subject string that `ActionOutcome` renders for `EXECUTED` too — it passes on the branch the test forbids |
| `features/hrdc/__tests__/hrdc.test.tsx:174` | "queues the approval **rather than activating the rule**" | same |
| `features/finance/__tests__/finance.test.tsx:54` | "**one primary** that records one" | nothing counts primaries; the screen renders two (W-04) |
| `features/agents/__tests__/agents.test.tsx:17` | "offers **exactly one** solid primary" | only that one exists; same at `knowledge.test.tsx:10`, `settings-ai.test.tsx:103` |
| `features/engagements/__tests__/EngagementDetailPage.test.tsx:32` | "renders the record identity **once**" | `getAllByText(...).length).toBeGreaterThan(0)` |
| `features/approvals/__tests__/ApprovalInbox.test.tsx:133` | "the median **the server measured**" | only the static label prefix |
| `features/tna/__tests__/tna.test.tsx:52` | the Budget cell renders an absence | an unscoped "not stated" that the Window metric also renders |

**Fix.** For the two "queued rather than executed" tests, assert the
approval-banner copy `ActionOutcome` renders only for `QUEUED_FOR_APPROVAL`, and
assert the fixture's status did not change. For the primary tests, use
`currentPrimaries()` — the kit exports it as the seam and almost no test calls
it.

## W-54 · A test that asserts a breadcrumb the harness never mounts

**MEDIUM** · `features/organisations/__tests__/organisations.test.tsx:23`

The comment claims the breadcrumb is asserted, but `render-harness.tsx` mounts no
`BreadcrumbProvider`, and `BreadcrumbProvider.tsx:59` documents that
`useBreadcrumb` outside the provider "simply does nothing". Nothing about the
breadcrumb is tested.

**Fix.** Add the provider and `BreadcrumbProbe` as the engagements and portal
harnesses do.

## W-55 · Two ways to check one rule

**LOW** · `features/dashboard/__tests__/ExecutiveDashboard.test.tsx:111`

```ts
.filter((button) => button.className.includes("bg-primary"));
```

Sniffs a Tailwind class rather than using the kit's `currentPrimaries()` registry
that every other feature's tests use. `resetPrimaries()` is already called at
`:42`. Same at `ApprovalDetail.test.tsx:105`.

## W-56 · Fixture reads return live references — a latent snapshot-of-self hazard

**MEDIUM** · `packages/fixtures/src/client/FixtureClient.ts`

`store.ts:69` defines `clone()` and uses it at seed time (30+ call sites). But
`FixtureClient.ts` contains **zero** `clone` calls — `grep -c clone` returns 0
across all 2,852 lines. Reads therefore hand back live store objects.

Any test that captures an object from the client, performs a mutation, then
asserts the captured object changed is asserting nothing. **No such test exists
today** — the three tests that re-read through the client compare to literals and
are correct:

`features/approvals/__tests__/ApprovalDetail.test.tsx:111`
```ts
const after = await fixtureClient.getApproval(APPROVAL_AURORA);
expect(after.status).toBe("APPROVED");
```

**Fix.** This is a trap for the next test author, not a present bug. Either clone
on read in `FixtureClient`, or document the reference semantics prominently in
`packages/fixtures/API.md` (which currently does not mention it).

## W-57 · Minor test issues

**LOW**

- `features/proposals/__tests__/proposals.test.tsx:162` — `const user = userEvent.setup();` is never used; the test drives the field with `fireEvent`.
- `features/programmes/__tests__/programmes.test.tsx:11` — retypes the route pattern instead of importing `PROGRAMME_DETAIL_PATTERN` from `../paths`.
- `features/settings-ai/__tests__/settings-ai.test.tsx:195` — a test named for the forecast banner also asserts an unrelated `MetricCell` caption, so a failure will not say which requirement regressed.
- `features/knowledge/__tests__/knowledge.test.tsx:96` — `/^Re-ingested · \d+ chunks, embedding /` accepts any digits and any word.
- `features/tna/TnaDetailPage.tsx:183` — "Reopen questionnaire", the only mutation with no error surface at all (W-01), has **no test**.

Positive: **no `.skip`, no `.only`, no `xit`/`xdescribe` anywhere** in
`apps/web/src` or `packages/fixtures/src`.

---

# 7 · Dead code, unused exports, markers

## W-58 · Unused exports

**MEDIUM/LOW**

| File:line | Symbol | Evidence |
| --------- | ------ | -------- |
| `features/agents/api.ts:67` | `useAgentEvals` (+ `agentKeys.evals`, `agentKeys.agent`) | no caller in `apps/web/src` |
| `features/knowledge/api.ts:75` | `useCreateSource` | no caller; the "Add source" primary at `KnowledgeSourcesScreen.tsx:262` is inert |
| `features/proposals/api.ts:255` | `directCostOf` | no reference anywhere |
| `features/portal/AcceptancePanel.tsx:155` | `AcceptedChipLabel` | exported "so the chip cannot drift", never imported, and `ClientProposalPage.tsx:88` already formats it differently |
| `features/portal/api.ts:39` | `portalKeys.all` | never read |
| `features/proposals/paths.ts:19` | `COSTING_WORKSHEET_PATH` | barrel-exported, never called |
| `features/enquiries/paths.ts:20` | `ENQUIRY_DETAIL_PATH` | barrel-exported, never called — the inbox hand-builds the same string at `:257,290,372` **without** the helper's `encodeURIComponent` |
| `features/tna/paths.ts:10` | `TNA_DETAIL_PATH` | never called; `EnquiryDetailPage.tsx:348` hardcodes the route instead |
| `features/finance/api.ts:42`, `features/hrdc/api.ts:39` | `call<T>` | exported, used only inside its own file |
| `features/hrdc/RulesRegistryScreen.tsx:2` | `Link` | imported, never used |
| `features/enquiries/FollowUpQueuePage.tsx:87` | the `DISMISSED` count | computed every render; `TABS` at `:41-46` has no Dismissed tab |

## W-59 · Default exports the barrel does not use

**LOW** · `features/proposals/ProposalBuilderPage.tsx:605`,
`features/proposals/CostingWorksheetPage.tsx:494` — two import paths for one
component.

## W-60 · A policy threshold as a screen-local constant

**MEDIUM** · `features/hrdc/RuleChangeReviewScreen.tsx:45`

```ts
const RULE_CHANGE_MIN_CONFIDENCE = 0.8;
```

This gates whether an extracted rule is shown at all; the screen and the
extractor can disagree about the floor.

**Fix.** Export from `@trainos/contract` (or fixtures) and import it.

## W-61 · A statically-imported dev-only module

**LOW** · `features/agents/RunTraceScreen.tsx:30`

```ts
import { RunNowPanel } from "./RunNowPanel";
```

Only ever rendered under `import.meta.env.DEV`, so its module is in the
production bundle and can never execute there.

**Fix.** `const RunNowPanel = lazy(() => import("./RunNowPanel"))`.

## W-62 · TEMPORARY markers

**LOW** · `features/finance/StandInField.tsx:6`, `features/hrdc/StandInField.tsx:6`,
`features/approvals/client.ts:2`, `features/dashboard/client.ts:2`,
`shared/components/layout/useBadgeCounts.ts:20`, plus the five `useApi`
`TEMPORARY SHAPE` markers already owned by the `finisher` agent.

No `TODO`, `FIXME`, `HACK`, `@ts-ignore` or `@ts-expect-error` anywhere in
`apps/web/src`. The one `TODO` in the repo is `packages/contract/src/domain/ai-ops.ts:147`.

---

# 8 · Contract fidelity

## W-63 · A status chip for a record the contract gives no status

**HIGH** · `features/proposals/CostingWorksheetPage.tsx:139`

```tsx
<StatusChip tone="neutral">Draft</StatusChip>
```

`Quotation` (`packages/contract/src/domain/proposals.ts:324`) declares no
`status` field at all, so the chip is a permanent lie.

## W-64 · A screen typed against fixtures instead of the contract (R1)

**HIGH** · `features/proposals/CostingWorksheetPage.tsx:11`

```ts
import type { QuotationWithFloors } from "@trainos/fixtures";
```

R1: "Every response type comes from `@trainos/contract`, so a contract change is
a compile error at each call site." The alias is also stale — the contract's
`Quotation` already declares `absoluteFloorPrice`, `marginFloorPrice` and
`bindingFloorBasis`; the fixtures alias only re-adds them with its own
`BindingFloor` in place of the contract's `BindingFloorBasis`.

Two other features import fixture *types* into screens:
`features/finance/CollectionsQueueScreen.tsx:4` (`FixtureReceivable`) and
`features/programmes/ProgrammeDetailPage.tsx:4`
(`EngagementProjection`, `ProgrammeDelivery`).

## W-65 · A local type re-declaring contract fields that do not exist

**HIGH** · `features/proposals/api.ts:96`

```ts
bindingFloorBasis?: "ABSOLUTE" | "MARGIN";
```

The local `FloorBreach` declares three fields `FloorPriceBreachDetails` does not
(`absoluteFloorPrice`, `marginFloorPrice`, `bindingFloorBasis`); the contract
declares only `floorPrice`, `resultingMarginRate`, `requiresPolicy`.
`CostingWorksheetPage.tsx:419` then reads `breach.bindingFloorBasis` off the cast
at `api.ts:101`.

**Fix.** Add the fields to `FloorPriceBreachDetails` in the contract and import
that type.

## W-66 · Contract fields the screen ignores and reinvents

**MEDIUM** · four sites

| File:line | Ignored contract field | What the screen does instead |
| --------- | ---------------------- | ---------------------------- |
| `features/portal/ClientProposalPage.tsx:58` | `vendorContact: PortalVendorContact` (required, `client-portal.ts:88`) | scans the comment thread for the last HUMAN author, so "Contact" shows whoever replied last and vanishes when nobody has. `vendorContact` appears nowhere in `packages/fixtures/src/data/proposals.ts` |
| `features/portal/ClientProposalPage.tsx:82` | `title: string` (`client-portal.ts:76-79`, added *because* "the page header needs a title and nothing supplied one") | `` title={`Proposal for ${data.organisationName}`} `` |
| `features/proposals/ProposalBuilderPage.tsx:77` | `Proposal.warnings?: ProposalWarning[]` ("a warning rendered above the editor") | invents its own flag list from confidence, so a server warning with no confidence signal never reaches the user |
| `features/settings-ai/AiModelsScreen.tsx:320` | `RoutingResponse.unsavedChanges` (`ai-ops.ts:132`) | computes its own count from `staged.size` |

## W-67 · An exhaustive map over a one-member enum

**MEDIUM** · `features/knowledge/KnowledgeSourcesScreen.tsx:74`

```ts
const TYPE_LABEL: Record<KnowledgeSourceType, string> = { HRDC_CIRCULAR: "HRD Corp circular", };
```

`KNOWLEDGE_SOURCE_TYPES` has exactly one member
(`packages/contract/src/enums.ts:487`), so **every** row is labelled "HRD Corp
circular" — including the internal SOP and the help-centre page that the screen's
own copy and tests name. The retrieval-policy card depends on that claim.

**Fix.** Extend `KNOWLEDGE_SOURCE_TYPES` with the types the fixtures actually use;
the compiler will then force the map to follow.

## W-68 · Payload types widened past the contract's enums

**MEDIUM** · `features/finance/api.ts:191`

```ts
{ channel: "EMAIL" | "WHATSAPP"; templateId: string; stage: string; body: string }
```

`stage` widens `CollectionStage` to bare `string`, and the request is built as
the default `ActionRequest<Record<string, unknown>>` at `:196`, so nothing checks
the payload against `ReminderSendPayload` at all. Same inline unions at
`CollectionsQueueScreen.tsx:71,101,340-341`.

## W-69 · Mislabelled contract fields

**MEDIUM/HIGH**

- `features/approvals/ApprovalDetail.tsx:479` **HIGH** — `Queued <DateText value={detail.slaDueAt} withTime />`. `ApprovalRequest` has `slaDueAt` and no queued-at field, so the approver reads a future deadline as a past event.
- `features/hrdc/RuleChangeReviewScreen.tsx:336` **MEDIUM** — `generatedAt: effectiveFrom,` feeds the rule's *effective date* to the AI provenance chip, so the ✦ popover reports a fabricated "generated at". `changeSet.ingestedAt` is already threaded into the parent at `:153`.
- `features/proposals/CostingWorksheetPage.tsx:131` **MEDIUM** — shows the version of the *current* rate card fetched separately, not `quotation.rateCardVersion`, which the contract stores precisely so a superseded price is legible.

## W-70 · Structurally valid, semantically empty writes

**MEDIUM** · `features/hrdc/RulesRegistryScreen.tsx:264`

```ts
expression: { field: "", op: "EQ", reference: "" },
```

Renders in the table as a bare " = ".

**Fix.** Collect field/op/reference in the drawer and disable the primary until
the expression is complete.

## W-71 · A role gate that contradicts its own refusal message

**MEDIUM** · `features/programmes/api.ts:52`

```ts
export const canEditCatalogue = (role: Role): boolean => role === "ADMIN";
```

The refusal copy this same feature renders (`ProgrammeDetailPage.tsx:309`) and the
doc comment at `:124` both say "ADMIN and L&D" — the button is hidden from a role
the message says may edit.

## W-72 · Section selected by free-text title

**MEDIUM** · `features/proposals/ProposalBuilderPage.tsx:572`

```ts
section.title.toLowerCase().includes("investment"),
```

`ProposalSection` has no such key; a retitled or non-English section silently
disappears from the preview.

**Fix.** Select by `section.n` from the template configuration.

## W-73 · Client-side literals presented as authoritative facts

**LOW** · `features/settings-ai/AddProviderKeyDrawer.tsx:31`

```ts
const RESIDENCY: Record<AiProvider, string> = { ANTHROPIC: "US", GOOGLE: "SG", OPENAI: "US", DEEPSEEK: "CN", };
```

Data residency is a PDPA fact the drawer renders as authoritative at `:191`. The
contract already treats `region` as a returned field (`ai-ops.ts:163`).

## W-74 · No-op casts that suppress future contract errors

**LOW** · `features/tna/TnaDetailPage.tsx:213` (`record.budget as Money`, already
narrowed at `:212`), `features/enquiries/EnquiryDetailPage.tsx:195`
(`levy.value as Money`), `features/engagements/AttendanceCapturePage.tsx:254`
(`method: "MANUAL" as CaptureMethod`).

Each cast defeats R1's "a contract change is a compile error at each call site".

## W-75 · A threshold written three times

**LOW** · `features/approvals/ApprovalInbox.tsx:68` and `:342` — the high-value
threshold exists as sen in the filter clause, as prose in the chip, and as prose
in the button, so two of the three can drift from the query that runs.

**Fix.** Derive both labels from `HIGH_VALUE_FILTER.value` with `formatMoney`.

---

# 9 · Performance and bundle

**Nothing significant to report.** This is the healthiest category.

- **Lazy routes are complete.** Every feature route file wraps its screens in `lazy(() => import(...))` — verified across all 13 `*.routes.tsx` files. `routes.tsx` documents the ordering contract (feature routes before generated placeholders) and mounts dev routes only under `import.meta.env.DEV`.
- **No heavy third-party imports in any feature.** Outside React, react-router, `@tanstack/react-query`, `@trainos/*` and the kit, the feature folders import no third-party module at all. The one genuinely heavy dependency, `@trainos/agent-runtime`, is behind a dynamic `import()` gated on DEV (`features/agents/RunNowPanel.tsx:42`).
- The only bundle finding is W-61, one statically-imported dev-only module.
- The render-cost findings are W-27 (unmemoised tables) and W-34 (the O(n²) trace walk).

---

# 10 · Promote to kit

Ordered by how many features stop duplicating once it lands.

| Component | Features that would use it | Replaces |
| --------- | -------------------------- | -------- |
| **`TextField` / `DateField` / `TextArea`** | finance, hrdc, portal, engagements, settings-ai, approvals | W-35 — five local implementations and a raw `<textarea>`; fix the `htmlFor` gap (W-30) on the way in |
| **`renderScreen` test harness** → `apps/web/src/test/` | all 11 feature test suites | W-36 — 13 files, 5 byte-identical |
| **`RefusalBanner`** (exists at `features/settings-ai/RefusalBanner.tsx`) | agents, knowledge, and the 14 `ErrorState` sites in W-03 | W-24, W-38 — the only correct rendering of the `errors.ts` split |
| **Status-tone maps** in `kit/statusTone.ts` | hrdc, knowledge, settings-ai, tna, proposals, programmes, organisations | W-10, W-11 — nine local maps and six inline ternaries |
| **`LabelledValue`** (or adopt the kit's `MetricCell`) | tna, enquiries, proposals, portal, programmes, engagements, organisations | W-42 — seven implementations, five names |
| **`SectionHeading`** | dashboard, programmes, organisations | W-44 — two divergent versions plus four inline copies |
| **`AgentDraftPanel`** | enquiries, tna, organisations | W-43 |
| **`InlineLink`** | approvals, finance, hrdc | W-49 |
| **`RunEventRow`** (move from `features/agents/`) | agents; any future run-detail surface | W-19 — the file itself says it belongs in the kit |
| **`Checkbox`** (kit-wrapped) | hrdc; approvals already consumes one via `DataTable` | W-18 |
| **`CondensedRecordHeader`** (already in the kit, unused) | enquiries split-pane preview (`EnquiryInboxPage.tsx:249`) | a hand-rolled identity block |
| **`schemeLabel()` and `hrdcSchemeLabel()`** in `kit/format.ts` | hrdc (×4), portal, programmes | W-46, W-47 — two spellings of one label |
| **`DataTable`: radio-cell column kind + footer/summary slot** | settings-ai, finance | W-17 — two hand-rolled tables exist only because of these gaps |
| **`memo(DataTable)`** | every list screen | W-27 |
| **`toApiError` / `apiErrorFromThrown` / `errorCodeOf`** → `shared/api/errors.ts` | all 14 features | W-37, W-39, W-40 |

---

# 11 · Delete list

Safe to remove once the corresponding promotion or fix lands.

**Whole files**

| Path | Why |
| ---- | --- |
| `apps/web/src/features/finance/StandInField.tsx` | self-labelled TEMPORARY; identical body to the hrdc copy (W-35) |
| `apps/web/src/features/hrdc/StandInField.tsx` | same |
| `apps/web/src/features/dashboard/client.ts` | one comment line differs from `features/approvals/client.ts` (W-40) |
| `apps/web/src/features/approvals/client.ts` | self-labelled TEMPORARY stand-in |
| 10 of the 11 `apps/web/src/features/*/__tests__/render-harness.tsx` | five are byte-identical (W-36) |
| one of `features/{portal,engagements}/__tests__/BreadcrumbProbe.tsx` | byte-identical (W-48) |
| `apps/web/src/features/agents/RunEventRow.tsx` | after the kit migration (W-19) |

**Symbols**

| Path:line | Symbol |
| --------- | ------ |
| `features/agents/api.ts:37`, `settings-ai/api.ts:36`, `knowledge/api.ts:30` | `toApiError` — three copies shadowing the shared one |
| `features/{enquiries,proposals,tna,organisations,programmes}/api.ts` | `errorCodeOf`, `errorMessageOf` |
| `features/agents/api.ts:55,67` | `useAgentEvals`, `agentKeys.evals`, `agentKeys.agent` |
| `features/knowledge/api.ts:75` | `useCreateSource` |
| `features/proposals/api.ts:255` | `directCostOf` |
| `features/portal/AcceptancePanel.tsx:155-161` | `AcceptedChipLabel` |
| `features/portal/api.ts:39` | `portalKeys.all` |
| `features/proposals/paths.ts:19` | `COSTING_WORKSHEET_PATH` |
| `features/hrdc/RulesRegistryScreen.tsx:328` | `titleOf` — superseded by `humanise` |
| `features/hrdc/RulesRegistryScreen.tsx:2` | the unused `Link` import |
| `features/enquiries/FollowUpQueuePage.tsx:336-341` | `TITLE` — reimplements `humanise` |
| `features/enquiries/EnquiryInboxPage.tsx:57-62` | `CHANNEL_LABEL` — diverges from `humanise` |
| `features/enquiries/FollowUpQueuePage.tsx:72` | `const all = useFollowUps();` — a second full fetch for tab counts |
| `features/proposals/ProposalBuilderPage.tsx:81-83` | the `activeN` effect — already covered by the `?? sections[0]` fallback |
| `features/proposals/ProposalBuilderPage.tsx:605`, `CostingWorksheetPage.tsx:494` | default exports the barrel does not use |
| `features/knowledge/KnowledgeSourcesScreen.tsx:87` | `busyId` — duplicates `mutation.variables` |
| `features/settings-ai/UsageBudgetsScreen.tsx:86` | `useBudgets()` call — `usage.data.budgets` already has it |

---

# 12 · Suggested order of work

1. **W-01, W-02, W-03** — the three CRITICALs. Each is mechanical, each closes a rule the constitution names by number, and W-03's fix is unblocked by deleting the helpers in W-39.
2. **Kit promotions** — `TextField`, `RefusalBanner`, the tone maps, the shared test harness, the shared error helpers. These delete the most code and unblock W-24, W-30, W-35, W-36, W-37.
3. **W-04 + W-05** — the one-primary hole and the test shaped around it, together, so the fixed test proves the fixed guard.
4. **W-06, W-07, W-08, W-10** — the design sweep. All mechanical, all one pass each.
5. Everything else by severity.

Per R11, three of these should land with a machine assertion in the same pass:
a check that every fire-and-forget `useMutation` carries `toastOnError`; a check
that `ErrorState` is never given `onRetry` without `error`; and a narrowed
`useSinglePrimary` that a test can actually fail.

---

# Applied · 2026-09-13

Every CRITICAL and every HIGH in `apps/web` is closed except the three that need
`packages/contract`, which are listed as deferred below. Root gates —
`npm run typecheck && npm run lint && npm test -- --run && npm run arch:graph` —
were green after each commit.

| Finding | Commit | Status |
| ------- | ------ | ------ |
| W-01 · silent denied writes (R3) | `f45d99f` | Applied, with the R11 control `refusal-surfaces.test.ts` |
| W-02 · idempotency key unique per attempt | `1ebde39` | Applied — `stableIdempotencyKey` is `useAction`'s default |
| W-03 · `ErrorState` bypassed at 14 sites (R2) | `f0fde1f` | Applied, with the R11 scan `error-state-retry.test.tsx` |
| W-04 · one-primary guard compared labels | `9d12d48` | Applied — counts instances; `CondensedRecordHeader` marks its subtree an echo |
| W-05 · the `Set` that deduplicated the assertion | `9d12d48` | Applied — compared as an array |
| W-06 · identity duplicated in the breadcrumb | `d109235` | Applied at all seven, plus the engagement detail |
| W-07 · in-content breadcrumb | `d109235` | Applied for both programmes screens; nine other screens still render one — see below |
| W-08 · status colour on text | `17535f3` | Applied at six of eight; two `ApprovalDetail` sites deferred — see below |
| W-09 · the test that pinned W-08 | `17535f3` | Applied — `StatusChip` carries `data-tone` and the assertion reads it |
| W-10 · tone derived inline | `bce824f` | Applied — two of the three were also colouring the wrong states |
| W-11 · nine local tone maps | `bce824f` | Applied; `PROGRAMME_TONE` deferred — see below |
| W-15 · hardcoded pipeline stage | `c61709a` | Applied — resolved through `pipeline.data.stages`, label rendered from config |
| W-19 · `RunEventRow` in a feature | `c61709a` | Applied — promoted, local `tier()` deleted |
| W-20 · missing invalidation ×3 | `6a0d197` | Applied |
| W-24 · raw `error.message` | `a8996ef`, `607e6f7` | Applied at the three named sites and three more found in the same shape |
| W-25 · untyped `ErrorCode` comparison | `607e6f7` | Applied |
| W-30 · labels with no accessible name | `908bdf1` | Applied — the id is generated inside the kit's `Field` |
| W-35 · `TextField` ×5 | `908bdf1` | Applied — `TextField`/`DateField`/`TextArea`/`Field` shipped, five copies deleted |
| W-36 · `renderScreen` ×10 | `cff6e8a` | Applied — `src/test/renderScreen.tsx`; three differently-shaped harnesses kept |
| W-37 · shadowing `toApiError` ×3 | `607e6f7` | Applied |
| W-38 · `RefusalBanner` trapped in one feature | `a8996ef` | Applied |
| W-39 · `errorCodeOf`/`errorMessageOf` ×5 (+2) | `607e6f7` | Applied |
| W-40 · `apiErrorFromThrown` ×2 | — | Already resolved before this pass |

## Deferred, with the reason

**Needs `packages/contract`, which this pass does not own.**

- **W-63** · a status chip for a record the contract gives no status.
- **W-64** · a screen typed against fixtures instead of the contract (R1).
- **W-65** · a local type re-declaring contract fields that do not exist.
- **`PROGRAMME_TONE`** (part of W-11). `Programme.status` is typed `string`, so
  a tone map could not be total over an enum and would be a lie about its own
  exhaustiveness. The `ProgrammeDetailPage` ternary stays until the enum exists.
- **The `ATTENDANCE_LOCKED` literal** (part of W-15). `LifecycleStep.key` is
  `string`. The stage is now resolved through the pipeline and the printed word
  comes from configuration, but the key itself is still a named constant.

**Blocked by concurrent work.**

- **W-08 at `ApprovalDetail.tsx:322` and `:442`.** The file is being rewritten
  by another agent for the tightening brief §15 prototype. Both are the
  `slaBreached ? "text-danger"` shape already fixed elsewhere in `17535f3`.

**Out of scope for this pass (MEDIUM and LOW), unchanged and still open.**

- W-12, W-13, W-14, W-16, W-17, W-18, W-21, W-22, W-23, W-26, W-27, W-28, W-29,
  W-31, W-32, W-33, W-34, W-41 through W-62, W-66 through W-75.
- **Nine more in-content breadcrumbs**, beyond W-07's two: `settings-ai` ×3,
  `agents` ×2, `knowledge`, `tna`, `proposals` ×2. Same defect as W-07, found
  while applying it.

## Controls added, per R11

Three findings were controls that could not fail on the thing they were built to
catch. Each now can, and each was verified by reintroducing the defect:

| Control | Fails on |
| ------- | -------- |
| `shared/api/__tests__/refusal-surfaces.test.ts` | a feature `useMutation` with neither the flag nor a named refusal surface |
| `test/error-state-retry.test.tsx` | an `ErrorState` given `onRetry` without `error` |
| `test/idempotency.test.tsx` | a key that changes per attempt, and a key blind to the payload |
| `kit/useSinglePrimary.ts` + its suite | two solid primaries, including two that share a label |
| `approvals/__tests__/ApprovalInbox.test.tsx` | status colour on a non-chip, via `StatusChip`'s `data-tone` |
