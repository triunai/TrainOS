# @trainos/fixtures

The demo dataset and an in-memory client that implements the TrainOS API
contract against it. Every screen in the design pack has a read here that
returns real-looking data, and every primary button has a `POST /v1/actions`
call that returns one of the three §3 outcomes with the diff, the effects and
the errors the contract prescribes.

```ts
import { createFixtureClient } from "@trainos/fixtures";

const api = createFixtureClient({ latencyMs: 0 });
const inbox = await api.listApprovals({ page: { size: 10 } });
```

```bash
npx tsc -p tsconfig.json   # strict, noEmit, zero errors
npx vitest run             # 101 tests
```

The complete method list, one-line signatures grouped by contract section, is
in [API.md](./API.md).

## What is in the box

| Layer | Path | What it holds |
|---|---|---|
| Seed data | `src/data/*.ts` | One file per domain, typed against `@trainos/contract` |
| Client | `src/client/FixtureClient.ts` | The §13 endpoint surface as typed methods |
| Policy gate | `src/client/policy.ts` | The §3 evaluation order over a fixture policy table |
| Price floors | `src/client/pricing.ts` | Two floors, the higher binding, plus §18 reconciliation |
| List grammar | `src/client/query.ts` | `eq · in · gte · lte · contains · between`, sort, cursor, views |
| Events | `src/client/events.ts` | The §14 outbox and the five §11 realtime channels |

The client is not a mock. Errors are `ContractError`s carrying the §1 code and
the `details` bag that code prescribes; lists return the §1 envelope with
`appliedFilters[]`; every state change writes its catalogued event and pushes
the channel frame that goes with it; and `effects[]` is built from the same
`diff[]` the approval detail rendered, so the two can be compared field for
field.

## Decisions applied over the earlier text

`DECISIONS.md` supersedes both `API_CONTRACT.md` and `REPORT.md` in four places,
and this package implements the later text.

1. **The claim window is six months from completion**, not five working days —
   that number came from a practitioner note, not a circular. ENG-0231's packet
   therefore carries a May 2027 deadline at `INFO` severity while two documents
   are still missing. The pack's three-day danger state still exists, on
   ENG-0189, whose six-month window genuinely closes on 17 November.
2. **Hours saved is `ILLUSTRATIVE`**, carries the 0.7 haircut, and the tile
   renders `basis` rather than a bare number.
3. **The rate card is `v0-placeholder`** until Finance supplies the numbers.
4. **Two independent price floors.** A quotation clears the programme's
   absolute tier floor *and* the margin floor derived from direct cost; the
   higher binds. `FLOOR_PRICE_BREACH` reports the binding floor in
   `details.floorPrice` and names both, so the costing screen can show which
   constraint is doing the work.

The three rulings the contract package made — `CREATE` normalises to `ADD`,
"costing" is a `Quotation`, and `ACCOUNT_TRADING_HOLD` closes the collections
ladder — are followed here too.

## Roles decide what comes back

Permissions come from `/me`, and the client enforces them rather than trusting
the screen. The tenancy design withholds `quotation:read` from OPS, so two
things follow:

- `getQuotation` and `putQuotation` return `403 FORBIDDEN` with both
  `requiredRole` and `requiredPermission`, so the UI can explain rather than
  just disable.
- The OPS projection of an engagement **drops** the `finance` block. A missing
  field is honest; a zeroed one would be a lie about margin.

`SALES` holds all three quotation grants, `FINANCE` reads and writes because it
owns the rate card, `SALES_MANAGER` and `MD` read, and `OPS` and `TRAINER` hold
none.

## Two rules the policy gate will not bend

**The gated value comes from the record, never the request body.** An agent
that understates a proposal in its payload still gets measured against the
stored `proposal.value`, so nothing slips under the APV-01 threshold by lying
about itself. The payload is consulted only where it *is* the value being
proposed — a new sell price, a new budget cap.

**An identical pending approval is the same request, not a second one.**
Re-proposing `PROPOSAL_SEND` on PRO-2026-0184 returns the standing
APV-2026-0771 rather than queueing a duplicate behind it.

## Reads the agent runtime codes against

`searchOrganisations`, `searchProgrammes`, `listTrainerAvailability`,
`computeQuotation`, `getEnquiry`, `createProposal` and `performAction` are
derivations over the same store the endpoint methods use, so an agent and a
screen can never see different numbers. `computeQuotation` returns
`proposalValue` separate from `total`: the gate compares the ex-SST figure, and
folding tax in would push an RM 14,900 proposal over an RM 15,000 gate on tax
alone.

## Deviations from the verbatim JSON examples

The §0 preamble says the examples double as seed data, so they are reused
literally wherever they are internally consistent. Five places where they are
not:

1. **The invoice line.** §9 shows `qty: 30 × RM 616.67 = RM 18,500`, which is
   RM 18,500.10. §18 calls that a modelling error, so INV-2026-0311 is one line
   at `qty: 1` with the per-pax figure in `display.perPax`. The broken payload
   survives as the fixture that proves `POST /v1/invoices` rejects it.
2. **The quotation margin.** §6 gives QUO-2026-0184 a direct cost of RM 11,400
   and a `marginRate` of 0.41, but those numbers yield 0.38. The lines are kept
   verbatim because the §6 breach example only reconciles against them —
   RM 12,400 against RM 11,400 of cost is the 0.08 the contract states. The
   0.41 is kept where the pack renders it as a story number.
3. **The aging buckets.** §9's `d31_60` predates the 48-day collections row the
   pack asks for. The buckets here sum the seeded receivables, so the aging
   strip and the queue reconcile.
4. **The rule-resolution dates.** §17's check example puts grant approval at
   28 October while §9's packet puts submission at 2 October and approval at
   9 October. The §9 dates win, and the check display string follows them.
5. **The September/November split.** The pack tells a September approval story
   over a November delivery: PRO-2026-0184 is `DRAFT` with APV-2026-0771
   pending, while M07-S07 renders the same proposal accepted on 15 September
   and ENG-0231 delivered in November. Both states are in the design files and
   both are seeded. `slaRemainingMinutes` and `slaBreached` are server facts the
   UI renders rather than recomputing from `slaDueAt`, which is why the
   September timestamp and the "2 hours left" flag sit side by side.

## Contract gaps found while building this

Reported rather than patched — no change was made to `packages/contract`.

1. **No `Trainer` type.** `GET /v1/trainers` is in the §13 matrix and M06-S02
   renders a pool table, but the contract publishes only `TrainerPoolEntry` and
   `TrainerAvailability`. `FixtureTrainer` fills the gap here.
2. **No notification type.** The top-bar bell is drawn on every screen with a
   fixed count of four; §2 publishes no shape for it. `FixtureNotification`
   fills the gap here.
3. **No programme-delivery type.** `GET /v1/programmes/{id}/deliveries` has no
   response type; `ProgrammeDelivery` follows the M06-S02 data-contract line.
4. **`OrganisationMetrics` disagrees with its own example.** The §5 JSON
   flattens money onto the metric (`{ amount, currency, drillTo }`) while the
   type is `MetricValue<Money>` (`{ value: { amount, currency }, drillTo }`).
   The type wins here; one of the two needs correcting.
5. **Two pipelines, one name.** §5 says the relations panel's lifecycle comes
   from `config/pipelines?object=ENGAGEMENT`, but its keys
   (`ENQUIRY · TNA · PROPOSAL · APPROVAL · SENT · DELIVERY`) are not the §8
   engagement keys (`WON · TRAINER_CONFIRMED · …`). Seeded as two objects,
   `ENGAGEMENT` and `DEAL_CHAIN`.
6. **No per-action confidence minimum.** §3 step 4 compares `confidence`
   against "the agent's minimum for that action", which nothing publishes.
   `MINIMUM_CONFIDENCE` in `client/policy.ts` is a fixture table.
7. **No 409 code for a stale diff or a blocked bulk decide.** §7 describes both
   as `409`s, but the §1 error table has no code for either; `AGENT_PAUSED` is
   the only 409 in the table and is reused here with the documented `details`.
8. **Siti's surname.** §8 says Siti Nordin, the design-pack inventory says
   Siti Rahman. The contract wins.
9. **`Quotation` cannot say which floor binds.** It carries `floorPrice` and
   `floorMarginRate`, so both floors are derivable, but nothing records which
   constraint is actually binding. `QuotationWithFloors` adds
   `absoluteFloorPrice`, `marginFloorPrice` and `bindingFloorBasis`.
10. **`Engagement.finance` is required**, so the OPS projection that has to drop
    it cannot be typed as an `Engagement`. Hence `EngagementProjection`.
11. **`CollectionNextAction.type` is `ActionType`**, which is the §3 list only,
    so the ruled `ACCOUNT_TRADING_HOLD` cannot sit on the queue row that needs
    it. Widened locally as `FixtureReceivable`.
12. **No way to add a proposal section.** §13 publishes
    `PUT /sections/{n}` and `POST /sections/{n}/regenerate`, both of which need
    the section to exist, so M07-S02's "Add section" control has no endpoint.
    `addProposalSection` fills the gap here.
13. **No permission vocabulary.** `QUOTATION_PERMISSIONS` is the only published
    set; every other grant in the `/me` fixtures is invented and marked as such.

## What I could not verify

- Whether the September approval and the November delivery are meant to
  coexist, or whether the pack simply never reconciled its own timeline.
- Which of the two `deliveries`-style panels M04-S02 renders for a non-current
  engagement — the inventory describes stepper variants, not payloads.
- The real HRD Corp circular text behind every rule: DECISIONS §3 loads them all
  as `PROPOSED` for exactly this reason, and the two rules with no verifier here
  are seeded that way.
