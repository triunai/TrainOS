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
    appears in the §13 matrix or in any §2–§18 shape, so neither is typed or
    listed in `ENDPOINTS`.

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
