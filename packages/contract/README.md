# @trainos/contract

The shared type surface for TrainOS. Every type here traces to a section of
`API_CONTRACT.md`, with `§18 Supersedes` and `DECISIONS.md` applied over the
earlier text. The React fixture client and the Supabase schema both code
against this package, so the two never drift on a field name, a casing, or an
enum value.

Types only. No runtime logic, no validation, no zod schemas — those are a later
pass. The three exceptions are value tables that both teams need at runtime:
the enum arrays in `src/enums.ts`, the endpoint table in `src/endpoints.ts`,
and the fixture ids in `src/fixtures-ids.ts`.

```bash
npx tsc -p tsconfig.json   # strict, noEmit, zero errors
```

## Section map

| Contract section | File |
|---|---|
| §1 Conventions — envelope, money, provenance, lists, errors | `src/envelope.ts` |
| §12 enum catalogue, §17 new enums, §1 roles | `src/enums.ts` |
| §2 Session and shell | `src/domain/shell.ts` |
| §3 The action envelope, policy evaluation, §7 `ApprovalRequest` | `src/actions.ts` |
| §4 Enquiries, leads and follow-ups | `src/domain/enquiries.ts` |
| §5 Organisations, contacts, opportunities | `src/domain/organisations.ts` |
| §6 TNA, programmes, proposals, quotations, §18 rate card | `src/domain/proposals.ts` |
| §7 Approvals | `src/domain/approvals.ts` |
| §8 Engagements, participants, attendance | `src/domain/engagements.ts` |
| §9 HRD Corp and finance, §17 compliance rules, §18 rule resolution | `src/domain/hrdc-finance.ts` |
| §10 Agents, runs, dashboards, §17 orchestrator trace | `src/domain/agents.ts` |
| §11 Client portal, webhooks | `src/domain/client-portal.ts` |
| §13 Screen → endpoint matrix, §17 new rows | `src/endpoints.ts` |
| §14 Event catalogue, §17 new events, §11 realtime channels | `src/events.ts` |
| §17 Model tiers, routing, provider keys, usage, budgets | `src/domain/ai-ops.ts` |
| §17 Knowledge sources | `src/domain/knowledge.ts` |
| Demo fixtures named across §2–§18 | `src/fixtures-ids.ts` |

Every exported type carries a `/** §N */` comment naming the section it came
from. JSON examples in the contract are the truth for field names and casing,
so every field is camelCase and every enum value is `UPPER_SNAKE`.

## The three supersedes applied, and the rulings

`§18 Supersedes (decisions pass)` overrides §17 and §12 in three places, plus
two shapes that only exist in §18. All five are implemented as written; the
earlier forms are not exported.

**1. Rule resolution date.** §17 said checks resolve `asOf = training_start`.
§18 and `DECISIONS.md` §6 replace that: grant-side rules resolve as at grant
application submission, claim-side rules as at claim submission, because HRD
Corp evaluates against the rules in force when they receive the thing.
`ComplianceChecksResponse` therefore carries a two-sided `RuleResolution` and a
`versionDrift[]` array. Checks re-evaluate at every stage transition, and a
version change between stages raises a warning citing both versions rather than
silently switching. The engagement stores its `ruleSetVersion` at grant
submission. The §17 `rulesAsOf` field is kept optional and marked as the
superseded form; `asOf` survives only as a query parameter on the rules
registry, where it is a lookup, not a resolution rule.

**2. Jury is an object, not a boolean.** §17 modelled `jury` on `/v1/ai/routing`
as `{ enabled: true, quorum, of, tiers }`. §18 and `DECISIONS.md` §2 replace it
with `JuryPolicy`, carrying `mode: GATE | SAMPLE | ESCALATE`, `sampleRate` and
`triggers { minConfidence, maxValue: Money, firstOfKind }`. The jury is a gate,
not a per-action step: `GATE` runs at promotion time against the golden set,
`SAMPLE` runs asynchronously after the human decides and never blocks, and
`ESCALATE` blocks only when a trigger fires. `JuryPolicy` is the only exported
form, and `Agent.jury` uses the same type so the registry column and the routing
matrix cannot diverge.

**3. Money is total-from-lines.** §18 and `DECISIONS.md` §7 fix the rounding
rule: integer sen, each line `unitPrice × qty` rounded half-up before summing,
totals sum the rounded lines, SST computed on the summed net. A package price is
one line at `qty: 1`; a per-pax figure that does not multiply cleanly is
`display.perPax` and never a line. The rule lives as a doc comment on `Invoice`
and on `CostingLine`, and `ErrorDetails.reason` carries the
`TOTAL_NOT_RECONCILED` value `POST /v1/invoices` returns when a payload's total
does not reconcile. `Money` is always `{ amount, currency }` — there is no
number-without-currency anywhere in the package.

Two further §18 shapes are implemented as given: `RateCard` (schema now, numbers
from Finance, `version: "v0-placeholder"` until then) and the `hours-saved`
report, whose `basis` field is required because the tile may not render a bare
number.

### R1: `CREATE` is `ADD`

§12 catalogues `DiffOp` as `ADD · UPDATE · REMOVE`, but the §4
`OPPORTUNITY_CONVERT` example emits `{ "op": "CREATE" }`. Ruling: the two are
the same op, and `CREATE` normalises to `ADD`, because §7 requires `effects[]`
to equal the `diff[]` rendered on the approval detail, and two vocabularies
cannot be compared field for field. `DiffLine.op` and `Effect.op` share one
union, `DIFF_OPS`. Servers emit `ADD`; clients never see `CREATE`.

`Effect.description` is required, matching `DiffLine.description`. The policy
gate always produces a sentence for every effect, so comparing the two lists
never has to handle a null.

### R2: costings are quotations

§6 calls the M07-S03 record a "costing" in prose and serves it at
`/v1/costings/{id}`. Everything else calls it a quotation: the ref prefix is
`QUO-`, §18 says "every `Quotation` stores `rateCardVersion`", API.md serves
`/quotations/{id}` with a `QuotationLine`, and the REPORT recurring-entities
block lists `Quotation{...}`. Ruling: quotation wins. The path is
`/v1/quotations/{id}`, and the types are `Quotation`, `QuotationLine` and
`QuotationWrite`. No `Costing` alias is kept — two names for one record is the
divergence this repo treats as a defect, and nothing consumed the old names.

Permission strings for the object are `quotation:read`, `quotation:write` and
`quotation:apply`, published as `QUOTATION_PERMISSIONS`. These are ruled, not
derived: the contract never catalogues its permission vocabulary, and the `/me`
example shows only enquiry and proposal grants. `Me.permissions` stays
`string[]` rather than a union that would be mostly invented.

### R3: `ACCOUNT_TRADING_HOLD`

§9 ends the collections ladder with a "trading hold at 75 with MD approval",
and §12 catalogues `TRADING_HOLD` as a `CollectionStage`. No action type in the
§3 list applies one, so the single step on that ladder that most needs an
approval had no way through the endpoint that gates approvals. Ruling: add
`ACCOUNT_TRADING_HOLD`, with `AccountTradingHoldPayload` and the
`AccountTradingHoldApplied` event the §14 table also lacks.

It lives in `RULED_ACTION_TYPES`, not in `ACTION_TYPES`. `ACTION_TYPES` is
documented as the §3 list and stays exactly those nineteen, `AI_OPS_ACTION_TYPES`
is the §17 pair, and `ALL_ACTION_TYPES` is the union of all three — twenty-two
types, which is what `ActionRequest.type` accepts. Keeping the ruled type in its
own group is what lets every other entry still trace to a section.

Source note: this rule is API_CONTRACT §9, in the `GET /v1/collections/rules`
sentence, not DECISIONS §7 — DECISIONS §7 is the rounding decision. The
substance is unchanged.

### R4: `AiProvider` gains `OPENROUTER` and `OTHER`

BYOK (bring your own key) is a selling point of the agent runtime — it accepts
an Anthropic key, an OpenRouter key, a DeepSeek key, or any OpenAI-compatible
endpoint, and runs the same orchestrator against whichever it finds. `§17`'s
`AiProvider` union names only `ANTHROPIC`, `GOOGLE`, `OPENAI` and `DEEPSEEK`,
so the runtime had to map an OpenRouter call onto `OPENAI` to fit the type.
That lies on the provenance badge: the badge would say a call was served by
OpenAI when it was actually served, at OpenRouter's discretion, by whichever
underlying model OpenRouter routed to. Ruling: add `OPENROUTER`, and `OTHER`
for the generic OpenAI-compatible case that names no vendor at all. `enums.ts`
carries the reasoning inline.

### R5: `RunStatus` gains `RESUMABLE`

Architecture doc 05 §8.5: an Edge Function worker is killed at its wall clock
(300s in the runtime's default slice budget), so a run that cannot checkpoint
cannot exceed that budget. A run that yields with a checkpoint is still
running — just not in this worker — but `§12`'s `RunStatus` has only
`RUNNING | SUCCEEDED | FAILED | HALTED`, none of which says "yielded, resume
me." Before this ruling the runtime reported `status: RUNNING, outcome:
RESUMABLE` and carried the real disposition on a wrapper object outside the
contract, purely because the union had no member for it. Ruling: add
`RESUMABLE` to `RunStatus` itself.

### R6: `Quotation` gains its two floors and which one binds

DECISIONS §5 and architecture doc 04: a quotation clears two independent price
floors — the programme's absolute tier floor, and a margin floor derived from
direct cost — and the higher one binds. `Quotation` already carried
`floorPrice` (whichever floor is binding) and `floorMarginRate`, but nothing
recorded which of the two constraints actually produced that number, so a
screen showing "why is this the floor" had nothing to read. Ruling: add
`absoluteFloorPrice`, `marginFloorPrice` and `bindingFloorBasis: 'MARGIN' |
'ABSOLUTE'` (the latter published as `BindingFloorBasis` / `BINDING_FLOOR_BASES`
in `enums.ts`). This replaces the fixture package's local `QuotationWithFloors`
decorator, which computed the same three fields outside the contract.

### R7: `Engagement.finance` becomes optional; `CollectionNextAction.type` widens

Two independent findings, one ruling pass:

- **`Engagement.finance` optional.** Tenancy CD-1 withholds `quotation:read`,
  and margin generally, from the `OPS` role. The fixture client's OPS
  projection of an engagement therefore has to drop the `finance` block
  entirely — a missing field is honest, a zeroed one would lie about margin —
  but `Engagement.finance` was required, so that projection could not be typed
  as an `Engagement` at all. It was typed locally as `Omit<Engagement,
  'finance'> & { finance?: EngagementFinance }`. Ruling: make the field
  optional on `Engagement` itself, with a doc comment recording that the OPS
  projection is the reason and that its absence means "hidden by role," never
  "zero."
- **`CollectionNextAction.type` widens to `AnyActionType`.** The collections
  ladder's final step is `ACCOUNT_TRADING_HOLD` (ruling R3), which lives in
  `RULED_ACTION_TYPES`, not the §3 `ActionType` list `CollectionNextAction.type`
  was typed against. The one row that most needs to name that action type
  could not. It was widened locally as `FixtureReceivable`. Ruling: type the
  field as `AnyActionType` (§3 plus the §17 AI-ops pair plus the ruled types),
  matching how every other `type` field that can carry a ruled action type is
  already typed.

### R8: `Trainer`, `Notification`, `ProgrammeDelivery`, and the portal's vendor contact

Four gaps the fixture package reported rather than patched, closed here by
lifting the shapes it had already worked out:

- **`Trainer`.** `GET /v1/trainers` is in the §13 matrix and M06-S02 renders a
  pool table, but the contract published only `TrainerPoolEntry` (a summary
  embedded on a programme) and `TrainerAvailability` (a recommendation-time
  check), neither of which is the trainer record itself. Added, shape lifted
  verbatim from the fixture package's `FixtureTrainer`.
- **`Notification`.** The top-bar bell renders on every screen with a fixed
  count of four; §2 publishes no shape for it. Added, shape lifted verbatim
  from the fixture package's `FixtureNotification`.
- **`ProgrammeDelivery`.** `GET /v1/programmes/{id}/deliveries` has no response
  type; `ProgrammeStats` is the rollup, not the row list. Added, shape lifted
  verbatim from the fixture package's `ProgrammeDelivery`, which followed the
  M06-S02 data-contract line.
- **`PortalProposal.title` and `vendorContact`.** No source names either. A
  client-facing proposal page needs a title to render in its own header
  (`organisationName` names the client, not the proposal), and a comment
  thread with no visible point of contact is not a page the design pack asks
  for. `title: string` and `vendorContact: PortalVendorContact` (`name, role,
  email, phone`) added, typed conservatively.

None of the four had a prior contract source — each is marked `§none — ruled
R8` in code rather than attributed to a section it did not come from.

## Fields with no source

Copied from §15, then extended with what the contract itself leaves ambiguous.
Each is typed conservatively and marked in code.

### From §15 — rendered on a screen, no first-class source

1. **`medianDecisionTime` (M02-S01).** Computable from the audit log but not
   exposed. The contract proposes `summary.medianDecisionSeconds` on
   `GET /v1/approvals`; typed as optional `ApprovalListSummary` pending
   confirmation.
2. **`signaturesExpected` (M10-S06).** Derived as `registered × sessionsInDay`,
   currently computed client-side. Typed as a required field of
   `AttendanceSummary` so the rule lives server-side, per the contract's own
   proposal.
3. **`perParticipant` (M07-S03).** Derived as `sellPrice ÷ pax`. Typed as
   `Costing.display.perPax`, matching the §18 rule that a per-pax figure is
   display-only.

### Found while deriving these types

4. **`DiffOp` versus the ops on `effects[]`.** Resolved by ruling R1 above:
   `CREATE` normalises to `ADD` and both fields share `DIFF_OPS`. Recorded here
   because the §4 example still reads `CREATE` and will need correcting in the
   contract text.
5. **`ActionStatus.REJECTED` has no response shape.** §12 catalogues it; §3
   documents only `EXECUTED`, `QUEUED_FOR_APPROVAL` and `SUGGESTED`. The
   `ActionResponse` union has three members.
6. **Evidence and source `type` values are not catalogued.** `provenance.sources[].type`,
   action `evidence[].type`, approval `evidence[].type` and `related[].type` draw
   on `EMAIL`, `TNA`, `PROGRAMME`, `TRAINER`, `TRAINER_AVAILABILITY`,
   `QUOTATION`, `QUESTIONNAIRE`, `HISTORY`, `CATALOGUE`, `HRDC_STATEMENT`,
   `PARTICIPANT_QUERY`, `ORGANISATION`, `CONTACT`, `INVOICE`, `PROPOSAL` and
   `ACTION`. `EVIDENCE_TYPES` is the observed set; there is no §12 entry.
7. **`dataScope` values are not catalogued.** `/me` returns
   `{ clients: "MY_ACCOUNTS", teams: "MY_TEAM" }`. Both fields are typed
   `string` rather than a guessed union.
8. **`appliedFilters[].source`.** Only `REQUEST` appears in an example. `VIEW` is
   implied by "saved view; merges its filters, request filters win" and is
   included on that basis.
9. **Severity is three overlapping vocabularies.** Badges use
   `DEFAULT | ALERT`, metric deltas and TNA constraints use `WARN`, deadline
   chips use `DANGER`, and `related[]` uses `ALERT`. `BadgeSeverity` is kept
   separate from `Severity`, which is the union of the rest.
10. **`theme` casing.** §2 returns `"LIGHT"`; API.md documents
    `light | dark | system`. §1's `UPPER_SNAKE` convention wins, so `THEMES` is
    `LIGHT | DARK | SYSTEM`.
11. **Follow-up status is not catalogued.** Only `DUE` appears. `FOLLOW_UP_STATUSES`
    lists `DUE | OVERDUE | SENT | DISMISSED`, which the queue's own filter
    (`filter[due][eq]=TODAY`) and the API.md `due=today|overdue` parameter imply.
12. **`OpportunityStageChanged` and `ActionRequested` are named but not catalogued.**
    §5 and §3 say they are emitted; the §14 table omits both. Payloads are
    inferred from the neighbouring events and marked with a TODO.
13. **Organisation `status`, `matchReason`, HRDC packet panel state, knowledge
    source `type`, and AI `provider` have no enum table.** Each is typed from
    the values that appear in examples: `ACTIVE_CLIENT`; `EXACT_DOMAIN`;
    `BLOCKED` and `DEADLINE_AT_RISK`; `HRDC_CIRCULAR`; `ANTHROPIC`, `GOOGLE`,
    `DEEPSEEK`, plus `OPENAI` for the `GPT-5.6 Terra` juror in §17.
14. **Rate card vocabularies come from prose, not a table.** Trainer bands
    A/B/C, venue modes (client site / own venue / external) and travel regions
    (Klang Valley / peninsular / East Malaysia) are `DECISIONS.md` §5 prose,
    rendered here as `UPPER_SNAKE` unions.
15. **The permission vocabulary is never catalogued.** `/me` returns
    `permissions[]` with four example strings and no table. `Me.permissions`
    is `string[]`; only the quotation grants are published as constants, and
    only because ruling R2 fixed them.
16. **`/notifications` and `/assistant/messages` exist only in API.md.** Neither
    appears in the §13 matrix, so neither is listed in `ENDPOINTS`. Ruling R8
    added the `Notification` shape the first would return; the endpoint row
    itself is still missing from `ENDPOINTS` and is carried as an open item
    below, since adding endpoint rows was outside this ruling's scope.

### Open questions carried into the code

Every §16 and §17 open question that constrains a type is marked in place with
`// TODO(contract §16 Qn)`:

- §16 Q1 approval expiry — `ApprovalStatus.EXPIRED` exists with no documented trigger.
- §16 Q2 diff staleness — `ApprovalDiffChangedDetails` types the 409, the UX is undecided.
- §16 Q4 WhatsApp rate cache TTL and lookup failure — `MessageDraft`.
- §16 Q5 attendance unlock once a claim reference exists — `AttendanceUnlockPayload`.
- §16 Q6 portal token lifetime and revocation — `PortalProposal`.
- §16 Q8 sandbox replay determinism — `RunReplayResponse`.
- §16 Q9 saved views shared or personal — `SavedView`.
- §17 Q3 batch-window queue versus escalate — `AllowedHourWindow`.
- §17 Q4 whether key reveal should exist at all — `ProviderKey`.

§16 Q3 (who owns `firstProposalToOrg`), Q7 (agent service principal scoping) and
§17 Q5 (pass-through billing meter) do not change a type, so they are recorded
here rather than in code. §16 Q10 (money rounding) and §17 Q1 (rule resolution)
are answered by §18 and need no marker.

## Open items from the fixtures and agent-runtime gap reports

Rulings R4–R8 close the type-shape gaps the two downstream packages reported.
The rest of what they reported is not a missing type — a table, an endpoint
row, or a naming inconsistency — so it is catalogued here rather than
answered with an invented type:

1. **`OrganisationMetrics` disagrees with its own §5 example.** The JSON
   flattens money onto the metric (`{ amount, currency, drillTo }`); the type
   is `MetricValue<Money>` (`{ value: { amount, currency }, drillTo }`). The
   type is not wrong — `MetricValue<T>` is used consistently elsewhere — but
   one of the two needs correcting in the contract text, and this package
   cannot decide which without asking the contract owner.
2. **Two pipelines share the name `ENGAGEMENT`.** §5 says the relations
   panel's lifecycle comes from `config/pipelines?object=ENGAGEMENT`, but its
   keys (`ENQUIRY · TNA · PROPOSAL · APPROVAL · SENT · DELIVERY`) are not the
   §8 engagement keys (`WON · TRAINER_CONFIRMED · …`). `LifecycleStep.key` is
   already a bare `string` by design (stage names render from configuration,
   never a client union), so no type changes; the fixture package seeded two
   distinct pipeline objects (`ENGAGEMENT` and `DEAL_CHAIN`) as a workaround.
   The naming collision in §5 itself is still open.
3. **No per-action confidence minimum.** §3 step 4 compares an agent's
   `confidence` against "the agent's minimum for that action," and nothing in
   §2–§18 publishes that table. Adding one would mean inventing every
   threshold; the fixture package's `MINIMUM_CONFIDENCE` stays a fixture-only
   table until the real values exist.
4. **No `409` code for a stale diff or a blocked bulk decide.** §7 describes
   both as `409`s, but the §1 error table has only `AGENT_PAUSED` at that
   status. Adding two more codes without documented `details` shapes would be
   a guess; the fixture package's reuse of `AGENT_PAUSED` for both, with the
   documented `details`, stays a fixture-level stand-in.
5. **No way to add a proposal section.** §13 publishes `PUT
   /sections/{n}` and `POST /sections/{n}/regenerate`, both of which require
   the section to already exist, so M07-S02's "Add section" control has no
   endpoint to call. This is a missing endpoint, not a missing type — nothing
   in `ProposalSection` would need to change — so it is left for whoever owns
   the §13 endpoint matrix rather than added speculatively here.
6. **The permission vocabulary is still uncatalogued beyond `QUOTATION_PERMISSIONS`.**
   Already tracked as item 15 above; repeated here because both downstream
   packages independently hit it (every non-quotation grant in the fixture
   `/me` responses is invented and marked as such).

Not carried forward: Siti Nordin vs. Siti Rahman (§8 vs. the design-pack
inventory) is a data disagreement, not a contract gap — the fixture package
already ruled it in the contract's favour and no type is affected.

## Conventions the package enforces by construction

- **Money is never a bare number.** `Money` is `{ amount: number; currency: 'MYR' }`,
  amount in integer sen. Percentages are decimal fractions typed as `Rate`.
- **Absent provenance means human-authored.** `Provenance` is optional
  everywhere it appears, never defaulted.
- **The client never decides gating.** `ActionResponse` is a discriminated union
  on `status`, so a caller must handle `QUEUED_FOR_APPROVAL` to compile.
- **Lifecycle steps render from configuration.** `LifecycleStep.key` is a
  `string`, not a union, because stage names and order come from
  `GET /v1/config/pipelines`.
- **`effects[]` must match `diff[]`.** `DiffLine` and `Effect` share both their
  shape and their `op` union, so the two can be compared field for field.
