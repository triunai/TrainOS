# 04 · Money, rate cards, rule versioning and provenance

Lane: `sb-money`. Scope: the numeric, versioned and AI-provenance parts of the
TrainOS schema. The governing principle is that these invariants live in the
database as constraints, generated columns and triggers, not in clients.

Sources: `API_CONTRACT.md` §1, §6, §9, §12, §16, §17, §18 and `DECISIONS.md` §3–§7.

Cross-lane reconciliation with `01-domain-model.md` (sb-erd) and
`02-tenancy-auth-rls.md` (sb-tenancy) is in **Conflicts with 01** and
**Agreements with 02** below. Read those before implementing anything that
crosses a lane boundary.

Every SQL fragment in this document was executed against PostgreSQL 17.11
before publication. Where a result contradicted the contract, the contradiction
is recorded rather than smoothed over. Nothing here is a migration; `sb-migrations`
owns that translation.

---

## Phase 1 · Decisions

Fourteen decisions, each with the reason it went that way.

| # | Decision | Reason |
|---|---|---|
| D1 | Money is two columns, `<name>_sen bigint` plus one `currency` per document, not a composite type | Composite types lose per-attribute `NOT NULL`, need expression indexes, and serialise awkwardly through PostgREST. The only thing they buy is preventing amount-without-currency, which a `CHECK` gives free. |
| D2 | `app.round_half_up_sen` rounds ties **away from zero**, not toward positive infinity | Makes a credit note the exact arithmetic negative of the line it reverses. Deviates from the literal words of DECISIONS §7; see Deviations. |
| D3 | Money never touches `double precision` | Verified: `round(2.5::float8)` is 2 and `round(0.5::float8)` is 0. Float rounds ties to even. `numeric` rounds away from zero. |
| D4 | Line `total_sen` is a stored generated column; header `subtotal`/`sst` are trigger-maintained; header `total_sen` is generated from them | Generated columns cannot reference other generated columns, so the chain has to break exactly once. Breaking it at the cross-row boundary keeps the final addition engine-guaranteed. |
| D5 | `TOTAL_NOT_RECONCILED` is enforced twice: a deferred constraint trigger at commit, and a comparison in the write RPC against the client's asserted total | The constraint protects the data; the RPC produces the 422 the contract specifies. |
| D6 | A quotation carries **two** floors and the binding floor is the higher | The contract fixture's own numbers prove these are different concepts. See Deviations. |
| D7 | Below-floor pricing is a `CHECK` requiring an attached approval id, not a prohibition | `DISCOUNT_APPROVE` must be able to succeed. The database states the real rule: never below floor *without an approval*. |
| D8 | Rate card components are eight typed child tables, not one EAV table | Each has different key dimensions and value types. Row counts are tiny; clarity wins over generality. |
| D9 | Compliance rules are **bitemporal**: an effective range and a registry-knowledge range, with rule ids stable across registry snapshots | Copying rules per snapshot makes every unchanged rule look changed. Verified: the naive model emitted ten drift warnings where one was correct. |
| D10 | Provenance is a side table keyed by `(subject_table, subject_id, field)`, not a per-row jsonb column, and **not** a `provenance_id` FK on the subject | Both required query patterns are cross-table. jsonb answers neither without a union over every table; a subject-to-provenance FK cannot be traversed backwards, so it cannot label or paginate the results. Reverses sb-erd's assumption, see Conflicts with 01. |
| D11 | Scalar provenance fields (`tier`, `model`, `confidence`, `cache_hit_rate`) are typed columns; only `sources` and `jury` are jsonb | The scalars are filtered and sorted on. jsonb is for genuinely variable shapes. |
| D12 | Derived states are **views**, never stored columns: tier status, budget state, invoice overdue | Each has multiple independent causes living in different rows. A stored copy drifts. |
| D13 | AI cost is stored in **micro-MYR**, with sen derived | A single token costs far less than one sen. Rounding per event loses real money at volume. |
| D14 | `allowed_hours` is `bit(24)`, one bit per MYT hour, with round-trip functions to the contract's `[start,end)` pairs | The strip and the pairs are one fact. Verified to round-trip both directions. |

---

## 1 · Money

### 1.1 Representation

```sql
create domain app.currency_code as char(3) check (value ~ '^[A-Z]{3}$');
create domain app.rate          as numeric(6,5) check (value between 0 and 1);
```

The convention is a `_sen` suffix on every money column and exactly one
`currency` column per **document**, not per line. Lines inherit the document's
currency through a composite foreign key, which makes a mixed-currency invoice
unrepresentable rather than merely discouraged:

```sql
-- on app.invoice
unique (id, currency),
-- on app.invoice_line
foreign key (invoice_id, currency) references app.invoice (id, currency) on delete cascade
```

**Why not a composite type.** `CREATE TYPE app.money AS (amount_sen bigint,
currency char(3))` reads better at the call site and is worse everywhere else.
A composite column cannot express "amount is NOT NULL but the row may be
absent"; `col IS NOT NULL` is false for a row with any null attribute, which is
a trap. Every index becomes an expression index. Aggregation needs a custom
aggregate rather than `sum()`. PostgREST serialisation of composites is a
moving target. The single benefit — amount and currency cannot be separated —
is recovered with one check constraint, so the composite earns nothing.

The `_sen` suffix does the real work: it makes a unit error visible at every
call site, which is where unit errors are actually made.

### 1.2 Rounding

```sql
create or replace function app.round_half_up_sen(p_value numeric)
returns bigint language sql immutable parallel safe strict as
$$ select round(p_value)::bigint $$;
```

`round(numeric)` already rounds ties away from zero. Verified on PostgreSQL 17.11:

| input | `round_half_up_sen` | ties-toward-`+inf` | `round(v::float8)` |
|---|---|---|---|
| 0.5 | 1 | 1 | **0** |
| 1.5 | 2 | 2 | 2 |
| 2.5 | 3 | 3 | **2** |
| −0.5 | **−1** | **0** | 0 |
| −1.5 | **−2** | **−1** | −2 |
| 61666.6667 | 61667 | 61667 | 61667 |

Two things follow. The float column is why money must never be stored or
computed in `double precision`; ties-to-even silently loses sen in both
directions. The negative-tie column is the only place the two half-up readings
diverge, and it only arises on credit notes. Away-from-zero is chosen so that
reversing a line produces the exact negative of that line, which is what
reconciliation against the accounting package needs.

The function is `IMMUTABLE`, which is what lets it appear in a generated column.
Note the consequence: `CREATE OR REPLACE` on this function does **not**
recompute stored generated columns. Changing the rounding rule is a backfill,
not a function swap, and must be treated as a data migration.

### 1.3 Lines, totals and reconciliation

```sql
create table app.invoice_line (
  id             uuid primary key default gen_random_uuid(),
  invoice_id     uuid not null,
  currency       app.currency_code not null,
  seq            int not null,
  description    text not null,
  basis          app.pricing_basis not null,   -- PACKAGE | PER_PAX | PER_DAY | PER_UNIT
  qty            numeric(12,3) not null check (qty >= 0),
  unit_price_sen bigint not null,
  total_sen      bigint generated always as
                   (app.round_half_up_sen(unit_price_sen::numeric * qty)) stored,
  foreign key (invoice_id, currency) references app.invoice (id, currency) on delete cascade,
  unique (invoice_id, seq),
  -- DECISIONS §7: a package price is one line at qty 1
  check (basis <> 'PACKAGE' or qty = 1)
);
```

The header cannot be a single generated chain, because a generated column may
not reference another generated column. The chain breaks once, at the cross-row
boundary:

```sql
-- on app.invoice
subtotal_sen bigint not null default 0,        -- trigger-maintained
sst_sen      bigint not null default 0,        -- trigger-maintained
total_sen    bigint generated always as (subtotal_sen + sst_sen) stored,
paid_sen     bigint not null default 0 check (paid_sen >= 0),
outstanding_sen bigint generated always as (subtotal_sen + sst_sen - paid_sen) stored
```

`subtotal` and `sst` are written only by `app.invoice_recalc()`, which fires on
every line change and computes SST on the **summed net**, per DECISIONS §7:

```sql
update app.invoice i
   set subtotal_sen = c.subtotal,
       sst_sen      = app.round_half_up_sen(c.subtotal::numeric * i.sst_rate)
  from (select coalesce(sum(l.total_sen), 0) as subtotal
          from app.invoice_line l where l.invoice_id = v_invoice) c
 where i.id = v_invoice;
```

Reconciliation is guarded at commit by a deferred constraint trigger, so a
multi-statement transaction can pass through intermediate states:

```sql
create constraint trigger invoice_reconciled
after insert or update on app.invoice
deferrable initially deferred
for each row execute function app.invoice_assert_reconciled();
```

Verified: a direct `UPDATE app.invoice SET subtotal_sen = 1500000` is accepted
inside the transaction and rejected at `COMMIT` with

```
ERROR:  Invoice total does not equal the sum of its rounded lines
DETAIL: {"reason":"TOTAL_NOT_RECONCILED","subtotal":1500000,"lineSum":1850000,...}
```

### 1.4 The 422 mapping

Errors carry SQLSTATE `PT422`, `PT409`, `PT403`, `PT404`. PostgREST maps a
SQLSTATE of the form `PTnnn` to HTTP status `nnn` and surfaces `MESSAGE`,
`DETAIL` and `HINT` in the error body, so `TOTAL_NOT_RECONCILED` reaches the
client as the contract's `422 VALIDATION_FAILED` with
`details.reason` without any application-layer translation table. See
"What I could not verify" on the version dependency.

### 1.5 The RM 616.67 × 30 case

DECISIONS §7 calls this a modelling error rather than a rounding error. The
schema makes that concrete. All four cases below were executed.

| Case | Model | Result |
|---|---|---|
| Package price | one line, `PACKAGE`, qty 1, unit RM 18,500.00 | total 1 850 000 sen ✓ |
| Demo payload | one line, `PER_PAX`, qty 30, unit RM 616.67 | total 1 850 010 sen, client's asserted 1 850 000 rejected |
| Honest per-pax | one line, `PER_PAX`, qty 30, unit RM 617.00 | total 1 851 000 sen ✓ |
| Package with qty 30 | `PACKAGE`, qty 30 | refused by `CHECK` |

The per-pax figure the UI shows is a display column, never a line:

```sql
display_per_pax_sen bigint generated always as
  (app.round_half_up_sen(sell_price_sen::numeric / pax)) stored
```

For the fixture this yields 61 667 sen, which is the RM 616.67 the screen
shows. Because it is generated from the total rather than multiplied into it,
it cannot corrupt the invoice. This also resolves `API_CONTRACT` §15 item 3,
which asked where `perParticipant` comes from.

The write RPC compares the client's asserted total against the computed one:

```sql
if v_claimed is not null and v_claimed <> v_inv.total_sen then
  raise exception 'Invoice total does not equal the sum of its rounded lines'
    using errcode = 'PT422',
          detail = json_build_object('reason','TOTAL_NOT_RECONCILED',
                     'claimedTotal', v_claimed, 'computedTotal', v_inv.total_sen)::text;
end if;
```

Verified output for the demo payload:
`{"reason":"TOTAL_NOT_RECONCILED","claimedTotal":1850000,"computedTotal":1850010}`.

### 1.6 SST

`sst_rate` is a rate on the document, `sst_reason` an enum, and the pairing is
constrained so an exempt invoice cannot carry a rate:

```sql
sst_rate   app.rate not null default 0,
sst_reason app.sst_reason not null default 'TRAINING_EXEMPT',
check (sst_reason <> 'TRAINING_EXEMPT' or sst_rate = 0)
```

SST is computed on the summed net, not per line, which is the whole reason
`sst_sen` is trigger-maintained rather than a per-line generated column.

### 1.7 Margin, floor price and commission

```sql
margin_sen  bigint  generated always as (sell_price_sen - direct_cost_sen) stored,
margin_rate numeric generated always as
              ((sell_price_sen - direct_cost_sen)::numeric / nullif(sell_price_sen,0)) stored,

programme_floor_price_sen bigint not null default 0,        -- absolute, from the programme tier
margin_floor_price_sen    bigint generated always as
  (ceil(direct_cost_sen::numeric / nullif(1 - floor_margin_rate, 0))::bigint) stored,
floor_price_sen bigint generated always as
  (greatest(programme_floor_price_sen,
            ceil(direct_cost_sen::numeric / nullif(1 - floor_margin_rate,0))::bigint)) stored,
below_floor boolean generated always as
  (sell_price_sen < greatest(programme_floor_price_sen,
            ceil(direct_cost_sen::numeric / nullif(1 - floor_margin_rate,0))::bigint)) stored,

constraint floor_price_needs_approval check (
  sell_price_sen >= greatest(programme_floor_price_sen,
            ceil(direct_cost_sen::numeric / nullif(1 - floor_margin_rate,0))::bigint)
  or discount_approval_id is not null)
```

`ceil`, not `round`: rounding the floor down would let a price one sen under the
floor pass as compliant.

`floor_margin_rate` and `commission_rate` are **stamped onto the quotation** at
pricing time rather than read through to the rate card. A quotation must
reprice identically years later, after the card it was priced from has been
retired.

The `floor_price_needs_approval` check is the important line in this document.
It states the real business rule — a below-floor price may exist only with an
approval attached — so `DISCOUNT_APPROVE` works and an unapproved breach is
impossible at the storage layer. Verified: setting `sell_price_sen` to
1 240 000 fails; the same write with a `discount_approval_id` succeeds.

**Commission on collection.** The amount is generated; the *payable* portion
tracks cash received:

```sql
commission_sen bigint generated always as
  (app.round_half_up_sen(sell_price_sen::numeric * commission_rate)) stored
```

```sql
-- app.quotation carries invoice_id uuid references app.invoice
create view app.commission_ledger as
select q.id, q.ref, q.commission_sen,
       app.round_half_up_sen(q.commission_sen::numeric
         * least(1, i.paid_sen::numeric / nullif(i.total_sen,0))) as payable_sen,
       i.paid_sen, i.total_sen
  from app.quotation q join app.invoice i on i.id = q.invoice_id;
```

Pro-rata on partial payment, and payable reaches the full commission only when
the invoice is fully collected. This is `commissionPayableOn: "COLLECTION"` from
the contract, expressed as arithmetic rather than a status flag. Verified on the
fixture: commission RM 1,480 yields payable 0 uncollected, RM 740.00 at half
collection and RM 1,480 at full collection.

---

## 2 · Rate card

Shape follows `API_CONTRACT` §18 and DECISIONS §5. The parent is versioned with
a half-open date range and an exclusion constraint:

```sql
create table app.rate_card (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null,
  version        text not null,
  currency       app.currency_code not null default 'MYR',
  status         app.rate_card_status not null default 'DRAFT',  -- PLACEHOLDER|DRAFT|ACTIVE|RETIRED
  effective_from date not null,
  effective_to   date,
  validity       daterange generated always as
                   (daterange(effective_from, effective_to, '[)')) stored,
  is_placeholder boolean generated always as (status = 'PLACEHOLDER') stored,
  unique (tenant_id, version),
  check (effective_to is null or effective_to > effective_from),
  exclude using gist (tenant_id with =, validity with &&)
    where (status in ('PLACEHOLDER','ACTIVE'))
);
```

Requires `btree_gist` for the `uuid` equality operator alongside the range
overlap operator. The partial `WHERE` lets drafts overlap freely while
guaranteeing at most one card in force per tenant at any instant. Verified: a
second overlapping ACTIVE card is refused, and succeeds once the placeholder's
`effective_to` is closed.

Eight typed component tables hang off it, matching the §18 field list:

| Table | Keys | Value |
|---|---|---|
| `rate_card_trainer_day` | band A/B/C, nullable `trainer_id` override | `day_rate_sen` |
| `rate_card_materials` | programme type | `per_pax_sen` |
| `rate_card_venue` | mode | `day_rate_sen`, null = quote per engagement |
| `rate_card_travel` | region | `per_trip_sen` |
| `rate_card_meals` | programme type | `per_pax_sen`, `acm_ceiling_sen` |
| `rate_card_commission` | role, deal band as `int8range` | `pct` |
| `rate_card_margin_floor` | programme type | `floor_pct` |
| `rate_card_discount_authority` | role | `max_pct` |

Three constraints carry real rules. Client-site venue is pinned to zero
(`check (mode <> 'CLIENT_SITE' or day_rate_sen = 0)`). Meals may not exceed
their own ACM ceiling. Commission bands cannot overlap within a role
(`exclude using gist (rate_card_id with =, role with =, band with &&)`). A
partial unique index gives each band exactly one default rate, because a
`NULL` `trainer_id` is not deduplicated by the primary key:

```sql
create unique index on app.rate_card_trainer_day (rate_card_id, band)
  where trainer_id is null;
```

**Stamping.** `app.quotation.rate_card_id` is a plain foreign key. The contract's
`rateCardVersion` string is rendered by joining, so there is one source of truth
for the label.

**The v0 placeholder.** One row, `version = 'v0-placeholder'`, `status =
'PLACEHOLDER'`, component tables empty. The API surfaces `is_placeholder` and
clients render "rate card v0 · placeholder". The rule that nobody quotes from it
is enforced, not documented:

```sql
create trigger quotation_placeholder_guard
before insert or update on app.quotation
for each row execute function app.quotation_block_placeholder();
```

A draft may be priced against the placeholder; moving that quotation to
`APPLIED` raises `PT422` with `details.reason: "RATE_CARD_PLACEHOLDER"`.
Verified.

---

## 3 · Compliance rule versioning

### 3.1 Two time axes, not one

This is the part the naive design gets wrong, and it was caught by executing it.

A rule has an **effective** range — when it binds in the world — and a
**registry** range — when TrainOS knew about it. They are independent. Circular
09/2026, published 8 November 2026 and approved into the registry on 20
November, introduces a rule effective 1 January 2027. An engagement submitted in
October 2026 must not see that rule at all; one submitted in December 2026 sees
it exists but is not yet governed by it.

The first attempt modelled `rule_set` as a snapshot *containing copies* of every
rule. Executing the drift scenario produced ten warnings where one was correct:
every unchanged rule appeared to have changed, because copying gave it a new id.
Rule identity must be stable across snapshots. `rule_set` therefore became a
**label for a registry instant**, and rules carry both ranges:

```sql
create table app.rule_set (
  id            text primary key,            -- 'rs_2026_06_15'
  tenant_id     uuid,                        -- null = platform-global
  registry_asof timestamptz not null unique,
  note          text
);
```

```sql
create table app.compliance_rule (
  id              text primary key,          -- 'HRD-014', stable across snapshots
  family_key      text not null,             -- the axis ranges may not overlap on
  check_key       text not null,             -- 'CHK_LEAD_TIME'
  scheme          app.hrdc_scheme not null default 'ANY',
  delivery_mode   app.delivery_mode not null default 'ANY',
  side            app.rule_side not null,    -- GRANT | CLAIM
  kind            app.rule_kind not null default 'BINDING',  -- BINDING | ADVISORY
  subject         text not null,
  fail_state      app.check_state not null default 'FAIL' check (fail_state in ('FAIL','WARN')),

  -- declarative grammar: subject_field OP (reference [+ offset])
  subject_field   text not null,
  op              app.rule_op not null,           -- GTE LTE GT LT EQ NEQ COMPLETE
  reference_kind  app.rule_reference_kind not null,
  reference       text not null,
  offset_amount   int not null default 0,
  offset_unit     app.rule_offset_unit not null default 'DAY',   -- DAY | MONTH
  applies_when    jsonb not null default '{}'::jsonb,

  effective_from  date not null,
  effective_to    date,
  validity        daterange generated always as
                    (daterange(effective_from, effective_to, '[)')) stored,

  registry_from   timestamptz not null,
  registry_to     timestamptz,
  known           tstzrange generated always as
                    (tstzrange(registry_from, registry_to, '[)')) stored,

  status          app.rule_status not null default 'PROPOSED',  -- PROPOSED|ACTIVE|SUPERSEDED
  supersedes_id   text references app.compliance_rule,
  superseded_by_id text references app.compliance_rule,

  source_document_id text, source_title text, source_section text,
  source_page int, source_excerpt text, source_span int4range,

  verified_by uuid, verified_at timestamptz,

  check (status <> 'ACTIVE' or (verified_by is not null and verified_at is not null)),
  exclude using gist (family_key with =, delivery_mode with =, scheme with =,
                      validity with &&, known with &&)
    where (status in ('ACTIVE','SUPERSEDED'))
);
```

Two constraints deserve attention.

The `status <> 'ACTIVE' or verified_by is not null` check encodes DECISIONS §3:
every rule loads as `PROPOSED` and cannot become `ACTIVE` until compliance has
verified it against the circular. Verified: an ACTIVE insert without a verifier
is refused.

The exclusion constraint spans **both** ranges. Two rules in the same family may
overlap on one axis as long as they are disjoint on the other, which is exactly
what a superseding circular needs. Verified: a conflicting seven-day public lead
time overlapping HRD-015 on both axes is refused.

### 3.2 How "3 days until 31 Dec 2026, then 14" is represented

Two rows, same family, adjacent half-open effective ranges, different registry
ranges:

| id | mode | offset | effective | registry_from | supersedes |
|---|---|---|---|---|---|
| `HRD-015` | PUBLIC | 3 days | `[2026-06-15, 2027-01-01)` | 2026-06-20 | — |
| `HRD-022` | PUBLIC | 14 days | `[2027-01-01, ∞)` | 2026-11-20 | `HRD-015` |

`HRD-014` (in-house, 14 days) sits in the same family with
`delivery_mode = 'IN_HOUSE'`, so it never collides with either.

Because the ranges are `[)` and adjacent, there is no date on which both apply
and no date on which neither does. The exclusion constraint makes the gap and
the overlap equally impossible.

Approving Circular 09/2026 does two things in one transaction: closes
`HRD-015.effective_to` at 2027-01-01 and inserts `HRD-022` with
`registry_from = 2026-11-20`. Per §17, the rule is written with the **circular's**
effective date, not the approval timestamp.

### 3.3 The nine rules of DECISIONS §3

All nine, plus the documents-complete rule the checks fixture needs and the
Friday-evening advisory, are expressed in the grammar without a single
SQL escape hatch:

| id | family | subject_field | op | ref kind | reference | offset | side | fail |
|---|---|---|---|---|---|---|---|---|
| HRD-014 | LEAD_TIME (in-house) | `training_start` | GTE | FIELD | `grant_approval` | +14 d | GRANT | FAIL |
| HRD-015 | LEAD_TIME (public) | `training_start` | GTE | FIELD | `grant_approval` | +3 d | GRANT | FAIL |
| HRD-022 | LEAD_TIME (public) | `training_start` | GTE | FIELD | `grant_approval` | +14 d | GRANT | FAIL |
| HRD-016 | COMMENCEMENT | `training_start` | LTE | FIELD | `grant_approval` | +90 d | GRANT | FAIL |
| HRD-017 | CLAIM_WINDOW | `claim_submitted` | LTE | FIELD | `training_completion` | +6 mo | CLAIM | FAIL |
| HRD-018 | NO_AMENDMENT | `grant_amended` | EQ | LITERAL_BOOL | `false` | — | GRANT | FAIL |
| HRD-019 | TRAINER_ACCREDITATION | `trainer_hrd_tdf` | EQ | LITERAL_BOOL | `true` | — | GRANT | FAIL |
| HRD-020 | ACM_CEILING | `meal_cost_per_pax` | LTE | RATE_CARD | `acm_meal_ceiling` | — | GRANT | **WARN** |
| HRD-021 | ATTENDANCE_IMMUTABILITY | `attendance_modified` | EQ | LITERAL_BOOL | `false` | — | CLAIM | FAIL |
| HRD-011 | DOCUMENT_COMPLETENESS | `documents` | COMPLETE | DOCUMENT_SET | `required_document_set` | — | CLAIM | FAIL |
| HRD-ADV-01 | SUBMISSION_TIMING | `grant_submitted` | — | FIELD | — | — | GRANT | WARN, `kind = ADVISORY` |

DECISIONS §3 is explicit that the "apply before Friday 5 PM" note is advice, not
a rule. It is carried as `kind = 'ADVISORY'` and `status = 'PROPOSED'`, so it can
surface as a warning without ever blocking a claim. `offset_unit` exists solely
because the claim window is six *months*, not a day count.

### 3.4 The evaluator

The grammar is declarative over a **closed vocabulary**, not arbitrary
expressions. Field names resolve through small `IMMUTABLE` functions rather than
dynamic SQL, which removes the injection surface entirely and keeps the
evaluator inlineable:

```sql
create or replace function app.rule_date(f app.compliance_facts, p_field text)
returns date language sql immutable as $$
  select case p_field
    when 'grant_submitted'     then f.grant_submitted_at
    when 'grant_approval'      then f.grant_approved_at
    when 'training_start'      then f.training_start
    when 'training_completion' then f.training_completion
    when 'claim_submitted'     then f.claim_submitted_at
  end $$;
```

Sibling resolvers exist for booleans and money. Adding a referenceable field is
a one-line edit in one function; it is deliberately not open-ended.

Calendar arithmetic is explicit, because DECISIONS §3 insists on calendar days
rather than working days:

```sql
create or replace function app.apply_offset(p_base date, p_amount int, p_unit app.rule_offset_unit)
returns date language sql immutable strict as $$
  select case p_unit
    when 'DAY'   then p_base + p_amount
    when 'MONTH' then (p_base + make_interval(months => p_amount))::date
  end $$;
```

`app.evaluate_rule(facts, rule)` branches on `reference_kind` and returns
`(state, computed, display)`. The `computed` jsonb is the contract's `computed`
object verbatim, and `display` is the human string the stepper renders. A
missing fact yields `NOT_APPLICABLE` rather than a false `FAIL`, which is what
keeps an in-flight engagement from showing red for facts that simply have not
happened yet.

Executed against the contract's own `ENG-0231` fixture:

| check | rule | state | display |
|---|---|---|---|
| CHK_LEAD_TIME | HRD-014 | PASS | grant_approval 2026-10-28 → boundary 2026-11-11 → training_start 2026-11-12 |
| CHK_COMMENCEMENT | HRD-016 | PASS | boundary 2027-01-26 |
| CHK_MEAL_CEILING | HRD-020 | WARN | per pax 2600 vs ceiling 2500 |
| CHK_TRAINER_TTT | HRD-019 | PASS | — |
| CHK_NO_AMENDMENT | HRD-018 | PASS | — |
| CHK_ATTENDANCE_IMMUTABLE | HRD-021 | PASS | — |
| CHK_CLAIM_WINDOW | HRD-017 | NOT_APPLICABLE | claim_submitted not yet known |
| CHK_DOCS_COMPLETE | HRD-011 | FAIL | 3 of 5 documents present |

This reproduces `API_CONTRACT` §17's compliance-checks example exactly,
including the RM 26.00-against-RM 25.00 meal warning and the
three-of-five documents failure.

### 3.5 Resolution and drift

Resolution is bitemporal and returns exactly one rule per family:

```sql
create or replace function app.resolve_rules(
  p_registry_asof timestamptz, p_effective_asof date, p_side app.rule_side,
  p_mode app.delivery_mode, p_scheme app.hrdc_scheme)
returns setof app.compliance_rule language sql stable as $$
  select distinct on (r.family_key) r.*
    from app.compliance_rule r
   where r.side = p_side
     and r.status in ('ACTIVE','SUPERSEDED')
     and r.validity @> p_effective_asof
     and r.known    @> p_registry_asof
     and (r.delivery_mode = 'ANY' or r.delivery_mode = p_mode)
     and (r.scheme = 'ANY' or r.scheme = p_scheme)
   order by r.family_key,
            (r.delivery_mode <> 'ANY') desc,   -- a specific rule beats the ANY fallback
            (r.scheme <> 'ANY') desc,
            r.effective_from desc
$$;
```

Per DECISIONS §6, which supersedes §17's `asOf = training_start`:

- **grant side** resolves at `grant_submitted_at`
- **claim side** resolves at `claim_submitted_at`

The engagement stores `rule_set_id` at grant submission and never rewrites it.
That single stamp is what makes a claim defensible three years later.

`app.version_drift(engagement_id, p_now)` distinguishes two failures and takes
an injectable clock, because a function whose output depends on `now()` cannot
otherwise be tested:

**REGISTRY_DRIFT** — the registry changed its mind about the same date.
`resolve(applied_registry, grant_asof)` differs from
`resolve(current_registry, grant_asof)`.

**TEMPORAL_DRIFT** — a later rule in the same family is in force by the
delivery date. `resolve(applied_registry, grant_asof)` differs from
`resolve(current_registry, training_start)`.

The DECISIONS §6 scenario, executed: a public programme with grant submitted
20 December 2026, approved 22 December, training 15 January 2027, stamped
`rs_2026_06_15`, evaluated as at 5 January 2027.

```
check_key     | drift_kind     | applied  | applied_version | current  | current_version
CHK_LEAD_TIME | TEMPORAL_DRIFT | HRD-015  | rs_2026_06_15   | HRD-022  | rs_2027_01_01

message: Applied 3-day public application lead time in force at submission
         (2026-12-20); 14-day rule HRD-022 applies from 2027-01-01.
```

One warning, citing both versions, no silent switch. The check itself still
`PASS`es against HRD-015, which is the rule that actually governed the
submission. The in-house engagement in the same database produces zero drift
rows, which is the property the first design failed.

Checks re-evaluate at every stage transition, and drift is recomputed with them.

---

## 4 · Provenance

### 4.1 Side table, not a jsonb column

The two query patterns in the brief decide this outright.

*"All AI-generated fields awaiting review"* and *"everything from run_4821"* are
both **cross-table**. Provenance attaches to proposal sections, TNA gaps, TNA
recommendations, enquiry extractions, compliance rules, rule changes,
quotations, invoices and follow-up drafts. A per-row jsonb column answers
neither without a `UNION ALL` over every one of those relations, and GIN indexes
on nine separate jsonb columns cannot be combined into one ordered result.

Provenance is also **field-level**, not record-level. The contract's own
proposal example carries different origins on sections 1, 3 and 5 of the same
record. A single jsonb column would have to nest a field map inside itself,
at which point it is a side table with worse ergonomics.

```sql
create table app.provenance (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null,
  subject_table  text not null references app.provenance_subject,
  subject_id     uuid not null,
  field          text,                     -- null = the whole record
  origin         app.provenance_origin not null,
  confidence     numeric(4,3) check (confidence between 0 and 1),

  tier           app.tier_key,
  model          text,
  provider       app.ai_provider,
  cache_hit_rate numeric(4,3) check (cache_hit_rate between 0 and 1),

  agent_id       text,
  run_id         text,
  generated_at   timestamptz,

  edited_by      uuid, edited_by_name text, edited_at timestamptz,
  reviewed_by    uuid, reviewed_at timestamptz,
  needs_review   boolean not null default false,

  sources        jsonb not null default '[]'::jsonb,
  jury           jsonb,

  unique (subject_table, subject_id, field),
  check (origin not in ('AI_GENERATED','AI_EXECUTED')
         or (model is not null and generated_at is not null)),
  check (origin <> 'HUMAN' or (model is null and run_id is null)),
  check (jsonb_typeof(sources) = 'array'),
  check (jury is null or (jury ? 'quorum' and jury ? 'of')),
  check (jury is null or ((jury->>'quorum')::int <= (jury->>'of')::int
                          and (jury->>'quorum')::int > 0))
);
```

The cost of the polymorphic reference is that no real foreign key is possible.
It is contained three ways: `subject_table` references a small
`app.provenance_subject` allow-list, so a typo cannot create an unreachable
row; each provenance-bearing table gets an `AFTER DELETE` trigger to clear its
rows; and a periodic sweep catches anything else.

### 4.2 Which fields are columns and which are jsonb

`tier`, `model`, `provider`, `confidence` and `cache_hit_rate` are typed columns
because they are filtered, sorted and grouped on — the usage screen groups by
tier, the review queue sorts by confidence. Only `sources` and `jury` are jsonb,
because they are genuinely variable in shape and are rendered whole rather than
queried into.

Indexes follow the three real access paths:

```sql
create index provenance_run_idx on app.provenance (run_id) where run_id is not null;

create index provenance_review_queue_idx
  on app.provenance (tenant_id, generated_at desc)
  where origin in ('AI_GENERATED','AI_SUGGESTED','AI_EXECUTED') and reviewed_at is null;

create index provenance_subject_idx on app.provenance (subject_table, subject_id);
create index provenance_sources_idx on app.provenance using gin (sources jsonb_path_ops);
```

Both required queries were confirmed to use their partial index rather than a
sequential scan:

```
Index Scan using provenance_run_idx on provenance
  Index Cond: (run_id = 'run_4821'::text)

Index Scan using provenance_review_queue_idx on provenance
  Index Cond: (tenant_id = '1111...'::uuid)
```

The review-queue index is partial, so it holds only rows actually awaiting
review and shrinks as work is done, rather than growing with the table.

### 4.3 Validation

Three layers. Typed columns and domains carry the scalars. Check constraints
carry the cross-field rules: an AI origin must name its model and generation
time, a human-authored row must carry neither, and a jury quorum may not exceed
its panel size. Where `pg_jsonschema` is available, `json_matches_schema()`
should additionally pin the shape of `sources` and `jury`; the check constraints
above are the floor that works without it.

A warning learned by executing this schema rather than reasoning about it. This
constraint looks correct and is not:

```sql
check (jury is null or jury->>'mode' in ('GATE','SAMPLE','ESCALATE'))
```

When `mode` is absent, `jury->>'mode'` is NULL, `NULL IN (...)` is NULL, and a
CHECK that evaluates to NULL **passes**. A legacy boolean jury
`{"enabled":true,"quorum":2,"of":3}` was accepted by that constraint in testing.
Key presence must be asserted explicitly:

```sql
check (jury is null or (
     jury ? 'mode' and jury ? 'quorum' and jury ? 'of'
 and jury->>'mode' in ('GATE','SAMPLE','ESCALATE')
 and jsonb_typeof(jury->'quorum') = 'number'
 and (jury->>'quorum')::int between 1 and (jury->>'of')::int
 and (jury->>'mode' <> 'SAMPLE'
      or (jury ? 'sampleRate' and (jury->>'sampleRate')::numeric between 0.000001 and 1))
 and (jury->>'mode' <> 'ESCALATE' or jury ? 'triggers')))
```

Every jsonb check constraint in this schema follows that pattern. Verified after
hardening: the boolean form is refused, `SAMPLE` without a rate is refused, a
well-formed `GATE` object is accepted.

### 4.4 How an edit flips origin

```sql
create or replace function app.provenance_on_edit() returns trigger
language plpgsql as $$
begin
  if new.edited_by is not null and old.edited_by is null then
    new.edited_at := coalesce(new.edited_at, now());
    if old.origin = 'AI_GENERATED' then
      new.origin := 'AI_SUGGESTED';
    end if;
  end if;
  if old.origin in ('AI_SUGGESTED','HUMAN') and new.origin = 'AI_GENERATED' then
    raise exception 'provenance origin may not move back to AI_GENERATED'
      using errcode = 'PT422',
            detail = json_build_object('reason','PROVENANCE_ORIGIN_REGRESSION',
                                       'from', old.origin, 'to', new.origin)::text;
  end if;
  return new;
end $$;
```

Setting `edited_by` on an `AI_GENERATED` row demotes it to `AI_SUGGESTED` and
stamps `edited_at`, which is precisely the state of section 3 in the contract's
proposal fixture. The second branch makes the transition one-way: a regenerate
that wants `AI_GENERATED` back must create a new provenance row, not mutate the
edited one. Both behaviours verified.

`app.provenance_envelope(table, id, field)` assembles the contract's nested JSON
including the §17 additions, so every caller renders an identical envelope. Its
output was compared field by field against the §17 example and matches.

---

## 5 · AI-operations configuration

### 5.1 Tiers, and why status is a view

```sql
create table app.model_tier (
  tenant_id        uuid not null,
  key              app.tier_key not null,
  model            text not null,
  provider         app.ai_provider not null,
  routing          app.routing_strategy not null default 'FIXED',
  fallback_chain   app.tier_key[] not null default '{}',
  cache_strategy   app.cache_strategy not null default 'NONE',
  max_output_tokens int check (max_output_tokens > 0),
  allowed_hours    bit(24) not null default b'111111111111111111111111',
  batch_eligible   boolean not null default false,
  admin_state      app.admin_state not null default 'ENABLED',
  health           app.tier_health not null default 'HEALTHY',
  degraded_since   timestamptz, degraded_reason text,
  primary key (tenant_id, key),
  check (not (key = any(fallback_chain))),
  check (health <> 'DEGRADED' or degraded_since is not null)
);
```

The contract's `TierStatus` has four values with three independent causes:
`DISABLED` is an admin act, `DEGRADED` comes from the provider health monitor,
`PAUSED_BY_CAP` comes from the budget table. Storing one column means three
writers racing to keep it true. It is derived instead:

```sql
create view app.model_tier_status as
  select t.*,
         case when t.admin_state = 'DISABLED' then 'DISABLED'
              when bs.state = 'PAUSED'        then 'PAUSED_BY_CAP'
              when t.health = 'DEGRADED'      then 'DEGRADED'
              else 'HEALTHY' end as status
    from app.model_tier t
    left join app.budget_status bs
      on bs.tenant_id = t.tenant_id and bs.scope = 'TIER' and bs.key = t.key::text
     and bs.period = to_char(now(), 'YYYY-MM');
```

Verified against the §17 fixture: `STRONG_1` HEALTHY, `STRONG_2` DEGRADED,
`SPECIAL` PAUSED_BY_CAP purely because its spend reached its cap. Nothing wrote
`PAUSED_BY_CAP` anywhere. Self-referencing fallback chains are refused.

### 5.2 Allowed hours as 24 bits

`allowed_hours bit(24)`, one bit per MYT hour, with round-trip functions to the
contract's `[[start,end)]` pairs. Verified both directions:

| bits | ranges |
|---|---|
| `111111111111111111111111` | `[[0,24]]` |
| `111111110000000000000011` | `[[0,8],[22,24]]` |

An eligibility test is `get_bit(allowed_hours, extract(hour from now() at time zone 'Asia/Kuala_Lumpur')::int) = 1`.
A separate tenant-level `peak_hours bit(24)` supports the `offPeakShare` metric
in §17 without a second representation of the same idea. Per §17, a run
requested outside the window queues when `batch_eligible`, and escalates
otherwise; the column makes that decision data rather than code.

### 5.3 Routing, versioned so it is never retroactive

§17 requires that `PUT /ai/routing` apply to future runs only. That is a
versioning problem, so the matrix is versioned with a non-overlapping validity
range and each run stamps the routing version it used:

```sql
create table app.routing_matrix_version (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  label text not null,
  effective_from timestamptz not null default now(),
  effective_to   timestamptz,
  applies tstzrange generated always as (tstzrange(effective_from, effective_to,'[)')) stored,
  unique (tenant_id, label),
  exclude using gist (tenant_id with =, applies with &&)
);
```

`app.routing_matrix` rows hang off a version and carry `action_type`, `tier`,
`escalation_ladder`, `required_for_autonomous` and the `jury` object. The jury
constraint from §4.3 enforces DECISIONS §2 structurally: `jury` is a mode object,
the boolean form is rejected, `SAMPLE` requires a rate and `ESCALATE` requires
triggers.

### 5.4 Providers (BYOK)

`app.ai_provider_key` holds metadata only: provider, label, status, masked key,
scope tiers, cap, rotation date, billing owner, region, last tested, added by.
No secret material.

One opaque column, `key_ref text`, points at wherever secrets live. **Secret
storage and the audited reveal path are `sb-tenancy`'s call** — Supabase Vault or
an external KMS — and this lane deliberately does not specify it. A defensive
check keeps a real key from being pasted into the display column by mistake:

```sql
check (masked_key is null or masked_key ~ '[•*]{4,}')
```

`billing_owner` distinguishes `CLIENT_ACCOUNT` from `PASS_THROUGH`; the metering
question that raises is open, see §9.

### 5.5 Usage and budgets

Cost is stored in **micro-MYR**. The contract's own per-node cost is RM 0.06, so
sen is already at the granularity floor; a single token costs orders of
magnitude less, and rounding at event level loses real money at volume. USD and
the FX rate are both retained so the conversion is auditable, and MYR is
generated from them so it cannot drift:

```sql
cost_usd_micros bigint not null default 0,
fx_myr_per_usd  numeric(12,6) not null,
cost_myr_micros bigint generated always as
                  (round(cost_usd_micros * fx_myr_per_usd)::bigint) stored
```

Verified: 13 000 µUSD at 4.45 gives 57 850 µMYR, which renders as the RM 0.06
the contract shows for that node.

`usage_event` is range-partitioned by month with a BRIN index on `occurred_at`,
because it is append-only, time-ordered and the highest-volume table in the
system. The usage screen reads `app.usage_rollup`, never the events, so a
monthly dashboard never scans a partition.

Budget state is derived for the same reason tier status is:

```sql
create view app.budget_status as
  select b.*, coalesce(r.spend_sen,0) as spend_sen,
         case when coalesce(r.spend_sen,0) >= b.cap_sen then 'PAUSED'
              when coalesce(r.spend_sen,0) >= b.cap_sen * b.near_threshold then 'NEAR'
              else 'WITHIN' end::app.budget_state as state
    from app.budget b left join app.usage_rollup r on …;
```

`PAUSED` is a fact about spend against cap, computed identically everywhere.
Crossing the threshold emits `BudgetCapTripped` to the outbox owned by
`sb-events`; runs requesting a paused tier get `409 AGENT_PAUSED` with
`details.reason: "BUDGET_CAP"`. Raising a cap is `BUDGET_CAP_RAISE` through
`sb-actions`, MD-gated, and touches only `app.budget.cap_sen`.

### 5.6 Knowledge sources

`app.knowledge_source` carries `content_hash`, `last_checked_at`,
`monitor_status`, `embedding_status`, `chunks`, `retrieval_scopes` and
`rule_change_set_id`. Weekly monitoring is a `pg_cron` job that hashes the
fetched document and appends to `app.knowledge_source_check`, so the hash
history is evidence rather than a single mutable field.

Quarantine is derived, then enforced:

```sql
quarantined boolean generated always as
  (monitor_status = 'CHANGED_REVIEW_PENDING') stored
```

A `BEFORE INSERT` trigger on `app.rule_change` refuses rows whose source is
quarantined, raising `PT409` with `details.reason: "SOURCE_QUARANTINED"`. Per
§17 the source stays searchable while quarantined; only rule extraction stops.

`app.rule_change` carries the §17 confidence rule as a constraint —
`check (confidence >= 0.800 or status = 'WITHHELD')` — so a low-confidence
extraction cannot reach the diff view at all.

---

## 6 · Hours saved

Two tables and a function, implementing DECISIONS §4 exactly.

```sql
create table app.baseline_minutes_version (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  version   text not null,
  basis     app.hours_basis not null default 'ILLUSTRATIVE',   -- MEASURED | ILLUSTRATIVE
  haircut   numeric(3,2) not null default 0.70 check (haircut > 0 and haircut <= 1),
  measured_at date, signed_off_by uuid, signed_off_at timestamptz,
  effective_from date not null, effective_to date,
  validity daterange generated always as (daterange(effective_from, effective_to,'[)')) stored,
  check (basis <> 'MEASURED' or (signed_off_by is not null and measured_at is not null)),
  check (basis <> 'MEASURED' or haircut = 1.00),
  exclude using gist (tenant_id with =, validity with &&)
);
```

Two constraints carry the governance. DECISIONS §4 says the baseline table *is*
the ROI claim, so a `MEASURED` table cannot exist without a named sign-off and a
measurement date. And the 0.7 haircut belongs to the illustrative phase: a
`MEASURED` table must carry `haircut = 1.00`, which makes "remove it after three
months of measured data" a state transition rather than a reminder. Verified: a
`MEASURED` version with a 0.70 haircut is refused.

`app.baseline_minutes` additionally requires `sample_size >= 5` where given,
matching the "5–10 instances per action type" sampling instruction.

`app.hours_saved(tenant, period)` returns `hours`, `basis`, `haircut`,
`baseline_table_version` and the per-action-type array, which is the §18
response shape. The computation is DECISIONS §4 line for line:

```sql
sum(greatest(0, b.minutes - coalesce(a.human_minutes_spent, 0))) as credited_minutes
…
where (a.status = 'EXECUTED' or a.approved)
```

`greatest(0, …)` gives the heavy-edit behaviour for free, and the status filter
gives rejected and abandoned actions zero credit. Verified: an
`HRDC_PACKET_ASSEMBLE` action with 160 human minutes against a 140-minute
baseline credits 0.00 hours; a rejected `PROPOSAL_DRAFT` contributes nothing.

`human_minutes_spent` is measured by the UI as time in review or edit state and
lives on the action row owned by **`sb-actions`**. That column is a dependency,
flagged in §9.

`basis` is returned because the contract forbids rendering a bare number. The
tile must show "measured baseline × 0.7 (conservative)" or the measured figure,
never 41 hours with no qualifier.

---

## 7 · Receivables aging and collections cadence

Both are data, and both are protected by exclusion constraints rather than
validation code.

```sql
create table app.aging_bucket (
  tenant_id uuid not null, code text not null, label text not null,
  days int4range not null, sort int not null,
  primary key (tenant_id, code),
  exclude using gist (tenant_id with =, days with &&)
);
```

Rows `(null,1)`, `[1,31)`, `[31,61)`, `[61,∞)` reproduce the contract's
`current / d1_30 / d31_60 / d60_plus`. Overlapping buckets are impossible, so
an invoice can never be double-counted. Verified: inserting `[25,40)` is refused.

`app.receivables_aging(tenant, as_of)` left-joins invoices onto buckets via
`b.days @> greatest(0, as_of - i.due_at)`, so the bucket definition is the only
place the boundaries exist.

The 7 / 30 / 45 / 60 / 75 ladder is rows:

| stage | trigger_days | channel | autonomy | requires_role |
|---|---|---|---|---|
| REMINDER_1 | 7 | EMAIL | SUGGEST | — |
| REMINDER_2 | 30 | EMAIL | ACT_WITH_APPROVAL | — |
| REMINDER_3 | 45 | WHATSAPP | ACT_WITH_APPROVAL | — |
| HUMAN_CALL | 60 | PHONE | OBSERVE | FINANCE |
| TRADING_HOLD | 75 | INTERNAL | ACT_WITH_APPROVAL | MD |

Two constraints encode DECISIONS §1's autonomy ceilings directly:

```sql
check (stage not in ('REMINDER_3','HUMAN_CALL','TRADING_HOLD') or autonomy <> 'AUTONOMOUS'),
check (stage <> 'TRADING_HOLD' or requires_role = 'MD')
```

"Reminder 3 always human" and "trading hold needs MD" become unrepresentable
rather than merely policed. Verified: promoting REMINDER_3 to AUTONOMOUS is
refused.

`app.collection_stage_for(tenant, days_overdue)` resolves the stage from the
ladder. Verified: 34 days overdue gives REMINDER_2, matching the contract's
`INV-2026-0288` fixture; 80 days gives TRADING_HOLD.

**DSO** is deliberately not a stored column. Define it as
`outstanding / revenue_over_window × window_days` in one view; the contract's
`dsoDays: 38` needs the window agreed with Finance before it means anything.

---

## 8 · Test plan

pgTAP, run against a branch database. The scenarios below were all executed
during design; this is the suite that keeps them true.

**Rounding**
1. `round_half_up_sen` on 0.5, 1.5, 2.5, 3.5 → 1, 2, 3, 4 (proves not banker's rounding).
2. Same on −0.5, −1.5 → −1, −2 (pins the away-from-zero decision).
3. Assert no money column anywhere has type `real` or `double precision`; a catalogue query, so it cannot rot.
4. A credit note line is the exact negative of the line it reverses.

**The RM 616.67 case**
5. Package: one `PACKAGE` line, qty 1, unit 1 850 000 → total 1 850 000.
6. Demo payload: `PER_PAX` qty 30 unit 61 667 with asserted total 1 850 000 → `PT422`, `TOTAL_NOT_RECONCILED`, computed 1 850 010.
7. Honest per-pax: qty 30 unit 61 700 → 1 851 000.
8. `PACKAGE` with qty 30 → check violation.
9. `display_per_pax_sen` = 61 667 and never appears as a line.
10. Direct `UPDATE` of `subtotal_sen` → rejected at COMMIT, not at statement time.
11. SST at a non-zero rate is computed on the summed net, not per line.
12. `TRAINING_EXEMPT` with a non-zero rate → refused.

**Floor and margin**
13. Fixture quotation: direct cost 1 140 000, margin 0.3838, margin floor 1 753 847.
14. Sell 1 240 000 with no approval → check violation.
15. Same with `discount_approval_id` → accepted, `below_floor` true.
16. Binding floor is `greatest(programme, margin)`; assert both orderings.
17. Commission payable is pro-rata on partial payment and full only at full collection.

**Rate card**
18. Two overlapping ACTIVE cards → exclusion violation.
19. Closing `effective_to` then inserting → accepted.
20. Overlapping commission bands within a role → exclusion violation.
21. Two band-default trainer rows with null `trainer_id` → unique index violation.
22. `CLIENT_SITE` venue with a non-zero rate → refused.
23. Meals above their own ACM ceiling → refused.
24. Quotation to `APPLIED` on the placeholder card → `PT422 RATE_CARD_PLACEHOLDER`.

**Rule evaluator — one test per rule**
25–33. HRD-014, 015, 016, 017, 018, 019, 020, 021, 011: one passing and one failing fixture each, asserting `state`, `computed` and `ruleId`.
34. Missing fact → `NOT_APPLICABLE`, never `FAIL`.
35. The `ENG-0231` fixture reproduces §17's eight-row check table exactly.
36. `MONTH` offset: completion 2026-11-13, claim 2027-05-13 → PASS; 2027-05-14 → FAIL.
37. In-house engagement resolves HRD-014, public resolves HRD-015/022; neither leaks.
38. `ACTIVE` rule with no `verified_by` → check violation.
39. Overlapping rules on both axes in one family → exclusion violation.
40. Rules overlapping on one axis only → accepted.

**Version drift**
41. Public, submitted 2026-12-20, delivered 2027-01-15, stamped `rs_2026_06_15`, evaluated 2027-01-05 → exactly one `TEMPORAL_DRIFT` row citing HRD-015 and HRD-022 with both version labels.
42. Same engagement: `CHK_LEAD_TIME` still PASSes against HRD-015.
43. In-house engagement, same registry → zero drift rows. **This is the regression test for the copied-rules design that failed.**
44. `REGISTRY_DRIFT` fires when a circular retroactively changes a past date.
45. Drift takes an injected clock; no test may depend on wall time.

**Provenance**
46. Envelope round-trips against the §17 example field for field.
47. Setting `edited_by` on AI_GENERATED → AI_SUGGESTED with `edited_at` stamped.
48. AI_SUGGESTED → AI_GENERATED → `PT422 PROVENANCE_ORIGIN_REGRESSION`.
49. AI origin with no model → check violation.
50. HUMAN origin with a `run_id` → check violation.
51. Jury with quorum > of → check violation.
52. **Legacy boolean jury `{"enabled":true,…}` → rejected.** Guards the NULL-CHECK trap.
53. `SAMPLE` jury with no `sampleRate` → rejected.
54. Both required queries use their partial index; assert on the EXPLAIN plan, so an index drop fails the suite.

**AI ops**
55. `allowed_hours` round-trips bits → ranges → bits for all-day, off-peak and a single hour.
56. Self-referencing fallback chain → check violation.
57. Spend at cap → `budget_status` PAUSED and `model_tier_status` PAUSED_BY_CAP, with nothing written to the tier.
58. `DISABLED` admin state wins over a tripped cap.
59. `cost_myr_micros` tracks USD × FX; 13 000 µUSD at 4.45 → 57 850 µMYR → 6 sen.
60. Rule change from a quarantined source → `PT409 SOURCE_QUARANTINED`.
61. Rule change below 0.80 confidence not `WITHHELD` → check violation.

**Hours saved and receivables**
62. Heavy edit above baseline credits zero.
63. Rejected action credits zero.
64. `MEASURED` version with a haircut below 1.00 → check violation.
65. `MEASURED` version with no sign-off → check violation.
66. Overlapping aging buckets → exclusion violation.
67. 34 days overdue → REMINDER_2; 80 → TRADING_HOLD.
68. REMINDER_3 set to AUTONOMOUS → check violation.
69. TRADING_HOLD without `requires_role = 'MD'` → check violation.

**Cross-lane reconciliation (added after 01 and 02 landed)**
70. `rate_card.version` cannot be updated → `PT409 RATE_CARD_VERSION_IMMUTABLE`. This is what makes the C-3 foreign key safe; if it ever passes, the text-snapshot argument wins and C-3 must be revisited.
71. `rate_card.effective_to` **can** still be updated, so a card can be closed.
72. No table outside `app.provenance` has a `provenance_id` column. A catalogue query, so a reintroduced FK fails CI rather than quietly creating a second source of truth for one edge.
73. `app.mask_key` produces the §17 fixture shape, and the provider write RPC rejects any caller-supplied `masked_key`.
74. `key_fingerprint` is unique per tenant where present, and null-tolerant.
75. Every table in the A-5 allowlist permits a null `tenant_id`; every table outside it does not. Pairs with sb-tenancy's §8.7 guard so the two tests cannot disagree.
76. Deleting a subject row clears its provenance rows, and the periodic sweep finds zero orphans on a clean database. This is the replacement for the foreign key C-1 gives up, so it is tested, not assumed.
77. Provenance on a `DETERMINISTIC` check result → `PT422 DETERMINISTIC_CHECK_HAS_PROVENANCE`. Replaces the row constraint C-1 destroyed.
78. An `INTERPRETED` check result accepts provenance with model and confidence.
79. Flipping an `INTERPRETED` check to `DETERMINISTIC` while provenance exists → refused. **The provenance-side trigger alone does not catch this**; the gap was found by testing and needs both halves.
80. `binding_floor_basis` is `MARGIN` when the margin floor binds and `ABSOLUTE` when the programme floor does, including at equality.
81. An invoice or quotation in any currency but MYR → check violation, so no `_sen` column can hold a non-MYR amount while the convention stands.
82. No column named `*_minor` survives anywhere; a catalogue query, so the two suffixes cannot both come back.

**Schema placement**
83. Every table in the placement table above is in the schema that table names. A catalogue query, because a table in `app` fails silently at the API rather than loudly in CI, which is the whole reason this test exists.
84. `provenance_subject` is the only object of this lane's in `app` that is a table.
85. `search_path` hardening. **The implementation lives in sb-tenancy's §8.7 and is the single version; this lane does not carry a second copy.** It sweeps `app`, `public` and `core`, so both lanes are covered by one test and there is nothing to drift. What belongs here is why it matters on this side, below.

    Its shape, for readers who will not open the other document: it asserts `proconfig @> array['search_path=""']` — containment, not `proconfig[1] = …`. Three revisions were needed to get there and each was found by running it, not by reading it.

    | defect | caught by |
    |---|---|
    | no setting at all | any version |
    | `search_path=app, pg_catalog` — writable schema ahead of the catalogue | any version |
    | `search_path="app, pg_catalog"` — comma inside the quotes, names one schema that does not exist | exact-value or containment only, never a null check |
    | correct setting pinned **second**, after `statement_timeout` | containment only; the index form reports a false failure |

    The false failure is the dangerous revision, not the missed defect. A correctly hardened function that later acquires a `statement_timeout` turns CI red with no defect behind it, and the quickest way to green is to weaken the assertion. sb-tenancy also widened it to `prokind in ('f','p')`, since `prokind = 'f'` silently skips procedures, and excluded extension-owned objects via `pg_depend deptype = 'e'`, which otherwise fail on functions we did not write and cannot alter. Verified all four rows of that table on PostgreSQL 17.11.

    **Load-bearing for this lane specifically.** Thirteen of its functions are plpgsql and most are triggers on the invoice and quotation write paths. plpgsql defers a broken path to the first call, so the deploy passes, every migration that does not exercise the trigger passes, and the failure lands inside someone else's write long after the deploy that caused it. A SQL-bodied function fails at `CREATE FUNCTION` and needs no test. These need this one.
86. A `core` table's generated column calling an `app` helper still computes after a schema rebuild.
87. Each of the client-callable RPCs is reachable in `core` and returns its documented shape.

---

## 9 · Open questions

### Carried from API_CONTRACT §16

**Q10 — money rounding.** Closed by DECISIONS §7 and implemented here.
Total-from-lines, integer sen, each line rounded before summing, SST on the
summed net. The RM 616.67 discrepancy is a modelling error and the schema now
refuses it. No further decision needed.

**Q4 — WhatsApp rate TTL.** Open, and it touches this lane because collection
reminder costs land in `usage_event`. Proposal: cache BSP rates in a
`messaging_rate` table with `fetched_at` and a 24-hour TTL; on lookup failure
the composer shows the last known rate with its age rather than blocking, and
the estimate is marked stale. Needs the BSP's own rate-change cadence to
confirm. Owner: whoever owns the BSP integration, currently unassigned.

### Carried from API_CONTRACT §17

**§17 Q2 — jury cost.** Closed by DECISIONS §2. Gate, sample, escalate. The
`jury` object shape is enforced by constraint.

**§17 Q1 — rule resolution date.** Closed by DECISIONS §6. Implemented as
grant-side and claim-side resolution with drift warnings. Still needs the
written confirmation from HRD Corp support that DECISIONS §6 calls for; the
schema does not depend on the answer, but the claim defence does.

**§17 Q5 — pass-through billing meter.** Open and squarely in this lane. If
`billing_owner = 'PASS_THROUGH'`, is AI spend a TrainOS invoice line or a report
the client reconciles themselves? It changes whether `usage_rollup` needs to
feed `invoice_line`. Recommendation: a report for launch, because an invoice
line drags SST treatment of resold AI compute into scope. **Owner: Finance
Executive, same meeting as DECISIONS §5.**

### Owners named in DECISIONS

| Item | Owner | What this lane needs |
|---|---|---|
| §5 Rate card | Finance Executive | Trainer band rates, materials per pax, commission tiers, margin floor, discount authority. The schema is ready; every component table is empty. |
| §5 Rate card | Finance Executive | **New:** which floor binds when the programme floor and the margin floor disagree. See Deviations. |
| §3 Rule set | Finance / Compliance | Verify all nine rules against the circular PDFs. Until then they sit at `PROPOSED` and cannot go `ACTIVE`. |
| §3 Rule set | Finance / Compliance | **New:** the circular is cited as "2/2026" in DECISIONS §3 and "04/2026" in §17 for the same rules. One is wrong. |
| §6 Resolution date | Finance / Compliance | The written answer from HRD Corp support. |
| §4 Baseline minutes | MD + process owners | Roughly 15 action types × baseline minutes, signed. Until signed, `basis` stays ILLUSTRATIVE and the haircut stays 0.7. |
| §7 Rounding | Finance | Confirm away-from-zero on negative ties for credit notes. Five minutes. |

### New questions this lane raises

1. **SST rate and registration.** Every fixture shows `TRAINING_EXEMPT` at 0%. The schema supports a rate, but nothing in the pack establishes the exemption's statutory basis or what happens if the company crosses a registration threshold. Finance.
2. **Credit notes and refunds.** Not in the contract at all. Negative lines on a linked document is the natural model, and the rounding decision was made to support it, but the lifecycle is unspecified. Affects commission clawback.
3. **Commission clawback.** If a collected invoice is later refunded, commission already paid must reverse. `commission_ledger` computes payable from `paid_sen`, so it self-corrects, but the *paid-out* side is outside TrainOS.
4. ~~**Is `rule_set` global or per tenant?**~~ **Closed.** `sb-tenancy` confirmed the nullable `tenant_id` and supplied the read predicate; national rules stay national, because copying them per tenant means a circular correction is applied N times and the Nth is the one that gets missed. Writes to global rows go through the service-role provisioning path, not a tenant `ADMIN`. See Agreements with 02, A-4 and A-5.
5. **`human_minutes_spent` granularity.** The hours-saved computation depends on a column owned by **`sb-actions`**. Confirm it is per action, monotonic, and excludes idle time in a background tab.
6. **FX rate source for BYOK.** `usage_event.fx_myr_per_usd` is stamped per event. Which source, and daily or per-transaction?
7. **Multi-currency and the `_sen` suffix.** Recorded at team-lead's direction; no rename. `_sen` names the Malaysian minor unit in 95 column names across this lane and sb-erd's, so a second currency makes every one a misnomer, where `_minor` would not. The fleet is consistent on `_sen` and the contract is MYR-only, so it stands. The reservation is sb-erd's and is sound. It is held closed by the `currency = 'MYR'` check constraints in C-6: a second currency fails at the point of change and forces the rename as part of that work, rather than leaving mislabelled columns behind. **Reopen this before any non-MYR work starts, not after.**

---

## Schema placement · correction

**Every `app.` table name in this document is wrong.** They belong in `core`.
sb-tenancy caught it; sb-actions hit the same thing with `approval_requests`.

`supabase/config.toml` exposes `public`, `core` and `graphql_public`. Migration
001 is explicit about the division:

> `core` — 'The domain: the 86 tables of the ERD … Exposed to PostgREST alongside public.'
> `app` — 'Internal helpers: tenant resolution, RLS predicates, trigger functions … NOT exposed to PostgREST. Nothing in here is client-callable.'

A table in `app` is not an error anyone sees. `GET /v1/compliance/rules` simply
returns nothing, with no message explaining why. That is the worst failure mode
available, so the rule is stated once and applied everywhere:

**A table or function the Data API serves goes in `core`. Only helpers, trigger
functions and RLS predicates stay in `app`.**

### Placement for every object in this lane

| Object | Schema | Rendered by |
|---|---|---|
| `invoice`, `invoice_line` | **core** | M13-S02 |
| `quotation`, `quotation_cost_line` | **core** | M07-S03 |
| `rate_card` and its eight component tables | **core** | M07-S03 label, M20 settings |
| `compliance_rule`, `rule_set` | **core** | M12-S07 |
| `rule_change`, `rule_change_set` | **core** | M12-S08 |
| `compliance_check_results` | **core** | M12-S02, M09-S02 |
| `knowledge_source`, `knowledge_source_check` | **core** | M16-S05 |
| `provenance` | **core** | every AI badge popover |
| `model_tier`, `routing_matrix`, `routing_matrix_version` | **core** | M20-S20 |
| `ai_provider_key` | **core** | M20-S21 |
| `usage_rollup`, `budget` | **core** | M20-S16 |
| `usage_event` (+ partitions) | **core** | drill-through from M20-S16 |
| `baseline_minutes_version`, `baseline_minutes` | **core** | `/reports/hours-saved` |
| `aging_bucket`, `collection_cadence` | **core** | M13-S05, `/collections/rules` |
| `provenance_subject` | `app` | nothing renders it; pure allow-list |

Client-callable functions move with their tables: `invoice_create`,
`hours_saved`, `receivables_aging`, `evaluate_engagement`, `version_drift`,
`collection_stage_for`, `provenance_envelope` and `collection_stage_for` are
`core`. Pure helpers stay in `app`: `round_half_up_sen`, `mask_key`,
`apply_offset`, `rule_date`, `rule_bool`, `rule_money`, `hours_to_ranges`,
`ranges_to_hours`, `evaluate_rule`, `resolve_rules`, and every trigger function.

Views follow what they serve: `budget_status`, `model_tier_status`,
`commission_ledger` and `compliance_facts` are `core`.

A `core` table may use an `app` helper in a generated column. Verified: a `core`
table whose `total_sen` calls `app.round_half_up_sen` computes correctly, because
the reference is schema-qualified and resolved at definition time.

### `search_path` was not pinned, and now is

Checking the placement surfaced a second gap. None of this lane's functions
pinned `search_path`, which matters most for the ones reachable from a generated
column or a `SECURITY DEFINER` RPC, where an attacker-controlled schema earlier
in the path could shadow a called function.

**Every function this lane owns pins `search_path = ''`.** An earlier version of
this section pinned `apply_offset` to `'app, pg_catalog'`. sb-tenancy pointed out
that this puts a writable schema ahead of `pg_catalog`, so a future object in
`app` could shadow a catalogue name for that function. They are right that the
ordering is wrong on principle, and the fix costs nothing:

```sql
alter function app.round_half_up_sen(numeric) set search_path = '';
alter function app.mask_key(text)             set search_path = '';
alter function app.apply_offset(date,int,app.rule_offset_unit) set search_path = '';
```

An empty path is viable even for `apply_offset`, whose body calls `make_interval`
and the `date + int` operator, because **`pg_catalog` is implicitly searched
first when it is not named explicitly**. Verified: with an empty path it still
returns 2026-11-11 for a 14-day offset and 2027-05-13 for a 6-month one.
Functions on an empty path must schema-qualify everything outside `pg_catalog`,
which this lane's already do.

**Retraction.** An earlier version of this section reported that no shadowing
exploit could be reproduced against `'app, pg_catalog'`. **That result was an
artifact of a broken test and is withdrawn.** sb-tenancy's warning is correct:
naming `pg_catalog` explicitly does make built-ins shadowable.

The bug was quoting. `set search_path = 'app, pg_catalog'` does not set a
two-schema path. It sets a **one-schema path whose single member is a schema
literally named `"app, pg_catalog"`**, which does not exist:

```
set search_path = 'app, pg_catalog';   show search_path;  -->  "app, pg_catalog"
set search_path =  app, pg_catalog;    show search_path;  -->  app, pg_catalog
```

Every earlier test used the quoted form, so `app` was never on the path and the
shadow never had a chance to win. With the list form, the same probe resolves the
other way:

| function-level setting | stored `proconfig` | `round(2.5)` |
|---|---|---|
| `set search_path = 'app, pg_catalog'` | `search_path="app, pg_catalog"` | 3 |
| `set search_path = app, pg_catalog` | `search_path=app, pg_catalog` | **999999 — shadow wins** |
| `set search_path = ''` + qualified body | `search_path=""` | 3 |

**This is a second, separate footgun and it is the more dangerous one.** The
quoted form is silently broken. It looks more careful than the unquoted form,
passes review, and leaves a path that resolves nothing. A function under it that
only touches built-ins appears to work, because `pg_catalog` is still implicitly
searched, and the accidental protection is indistinguishable from a correct
setting.

**And the failure surfaces at different times depending on language** — found by
sb-tenancy on an independent reproduction, confirmed here:

| body language | broken quoted path | when it fails |
|---|---|---|
| `LANGUAGE sql` | `CREATE FUNCTION` errors immediately | deploy time, loud |
| `LANGUAGE plpgsql` | `CREATE FUNCTION` succeeds | **first call, in production** |

That inverts which lane is most exposed. This one is: thirteen of its functions
are plpgsql and most are trigger functions, including `invoice_recalc`,
`invoice_assert_reconciled`, `quotation_recalc`, `provenance_on_edit`,
`rate_card_version_immutable` and the two halves of the deterministic-check
guard. A plpgsql trigger with a broken path deploys cleanly, passes any migration
that does not exercise it, and then fails inside the first real invoice line
insert — someone else's write, not the deployer's.

This is the concrete reason the CI assertion is not optional here. For a
SQL-bodied function the migration itself is the test; for a plpgsql trigger
nothing catches it before production except an explicit check on the stored
setting.

The empty-path recommendation above is unaffected and was verified independently:
`''` stores `search_path=""`, which is a genuinely empty path, not a schema named
`""`.

`proconfig` is populated for every function afterwards, and the cross-schema
generated column still computes — the pair matters, because pinning `search_path`
is exactly the change that breaks a function relying on an unqualified name. The
migration author should treat a missing `search_path` as a defect.

### Column visibility, checked against sb-tenancy's finding

sb-tenancy's point that **RLS filters rows and cannot hide a column** applies to
this lane too, so each table was rechecked. Only `quotation` mixes
differently-privileged data, holding `sell_price_sen` beside `direct_cost_sen`
and `margin_rate`. No split is needed, because `quotation:read` is withheld from
OPS and TRAINER entirely rather than partially: the roles that may read the row
are the ones that do the costing. The `engagements` case is different only
because OPS must read the rest of that row, which is why it needs the child-table
split and this does not.

---

## Conflicts with 01 (sb-erd)

`01-domain-model.md` (commit `ecaa5be`) names `provenance`, `provenance_sources`
and `rate_card*` as this lane's tables to define. Three of its assumptions about
their shape do not survive. The lead's precedence order puts 04 above 01, so
**the migration author follows this section**. Each reversal has a reason, and
where sb-erd's reasoning was sound that is said plainly.

### C-1. Provenance is a table, but the reference points the other way

**sb-erd assumed:** `provenance_id uuid NULL REFERENCES provenance(id)` on every
AI-touched row, with `NULL` meaning human-authored.

**This lane implements:** `app.provenance (subject_table, subject_id, field)`
pointing *at* the subject. No `provenance_id` column on subject rows.

Agreed first: it is a **table**, not an embedded jsonb column. sb-erd read that
correctly, and §4.1 gives the reasoning independently. The disagreement is only
about direction.

sb-erd's `NULL` mapping to §1's "absent means human-authored" is elegant, and
its field-level answer — normalise fields into rows, as `proposal_sections`,
`tna_gaps` and `enquiry_extraction_fields` already do — genuinely works. My
original argument that the FK cannot express field-level provenance was too
strong and is withdrawn.

The reason for reversing is narrower and decisive. **A subject-to-provenance FK
cannot be traversed backwards.** Given a provenance row, nothing identifies
which table it attests. Both required queries end at that wall:

- *"All AI-generated fields awaiting review"* returns provenance rows the UI
  cannot label, because finding each subject means probing nine tables.
- *"Everything from run_4821"* has the same shape.

Worse, both need one ordered, paginated list. A nine-way `UNION ALL` with no
shared sort column cannot be paginated by cursor without materialising every
branch. Reversing the reference makes both a single indexed scan on one table,
confirmed on the plan in §4.2.

The FK bought referential integrity, and that loss is real. It is replaced by
three mechanisms rather than waved away: `subject_table` references the
`app.provenance_subject` allow-list so a typo cannot create an unreachable row;
each provenance-bearing table carries an `AFTER DELETE` trigger clearing its
rows; and a periodic sweep catches the remainder. That is weaker than a foreign
key and is recorded as a real cost, not a wash.

**What sb-erd must change:** drop `provenance_id` from all nine tables at lines
368, 373, 386, 407, 417, 429, 547, 580 and 604, and the second provenance column
contemplated at line 88. Nothing replaces them on the subject side. A row is
human-authored when no provenance row exists for it, which preserves §1's
"absent means human-authored" exactly as sb-erd intended — the absence just
lives in the other table.

**Do not keep both directions.** A `provenance_id` retained "for convenient
joins" alongside the polymorphic pair is two sources of truth for one edge, and
the project's standing rule is that divergence is a defect.

### C-2. `provenance_sources` stays jsonb

**sb-erd assumed:** a `provenance_sources` child table.

**This lane implements:** `sources jsonb not null default '[]'` with a
`jsonb_path_ops` GIN index.

Sources are written once with their provenance row, rendered whole in the AI
badge popover, and never updated independently. A child table adds a join and a
second write to every AI-touched field for no query this system performs. The
one query that would favour it — "which records cite `TNA-0042`" — is served by
the GIN index.

This is the weakest of the three reversals. If sb-events or the knowledge lane
needs to join sources to real records, a child table becomes correct and this
should be revisited rather than defended.

### C-3. `rate_card_version` is a foreign key, with the text label derived

**sb-erd assumed:** `quotations.rate_card_version text not null default
'v0-placeholder'`.

**This lane implements:** `rate_card_id uuid not null references
app.rate_card(id)`, with the text label rendered by join.

sb-erd's reasoning at line 1271 is right and is preserved: a price change must
not reprice existing quotations, so the quotation snapshots what it was priced
against. Its correction of §6's `rateCardYear: 2026` at S4 — a year is not a
version — is also right.

A bare text column snapshots the label but cannot reach the card's component
rows, so a quotation cannot be re-derived from it, and nothing stops a typo
pointing at a card that never existed. The FK gives both. The objection to an FK
is that the label could change under a quotation, so the label is frozen:

```sql
create or replace function app.rate_card_version_immutable() returns trigger
language plpgsql as $$
begin
  if new.version is distinct from old.version then
    raise exception 'rate_card.version is immutable (% -> %)', old.version, new.version
      using errcode = 'PT409', detail = '{"reason":"RATE_CARD_VERSION_IMMUTABLE"}';
  end if;
  return new;
end $$;
```

Verified: renaming `v1-2026` is refused, while `effective_to` remains editable
so a card can still be closed. With the label immutable, the FK is strictly
stronger than the text copy and the API's `rateCardVersion` string is a join.

sb-erd adds a second reason this is safe, worth having in both documents: an
`APPLIED` quotation is frozen entirely under its immutability rule I2, so the row
holding `rate_card_id` cannot be repriced after the fact even deliberately.

**What sb-erd must change:** `quotations.rate_card_version text` becomes
`quotations.rate_card_id uuid not null references rate_card(id)`. The API field
name and its `v0-placeholder` value are unchanged; only the column is.

**Correction.** An earlier draft of this paragraph said "keep `floor_price_minor`
snapshotted as sb-erd has it", which contradicted the column list in C-4. sb-erd
caught it and followed C-4, which is correct. **C-4 is authoritative: there is no
stored `floor_price_minor`.** The floor is generated.

A stored snapshot would have been the right call if the floor depended on the
rate card at read time, but it does not: `floor_margin_rate` and
`programme_floor_price_sen` are both stamped onto the quotation at pricing time,
so the generated floor is reproducible from the row alone, after the card it was
priced from has been retired. Generating it removes the possibility of a snapshot
disagreeing with its own inputs. No column is both stored and generated.

### C-4. Table ownership: `quotations`

sb-erd owns the `quotations` table; §1.7 and §2 of this document specify the
**money columns on it**, not a competing table. The `app.quotation` DDL here is
the verification harness, not a second table. Columns contributed by this lane:
`rate_card_id`, `sell_price_sen`, `direct_cost_sen`, `floor_margin_rate`,
`commission_rate`, `discount_approval_id`, `invoice_id`, and the generated
`margin_sen`, `margin_rate`, `programme_floor_price_sen`,
`margin_floor_price_sen`, `floor_price_sen`, `below_floor`,
`binding_floor_basis`, `commission_sen`, `display_per_pax_sen`, plus the
`floor_price_needs_approval` constraint.

`binding_floor_basis` was missing from the first version of this list. sb-erd
had it as an `ABSOLUTE`/`MARGIN` enum and dropped it rather than add a column to
this lane unilaterally, which was the right call, but the lead asked for it
explicitly. It is restored as a generated column so it cannot disagree with the
floors it describes:

```sql
binding_floor_basis text generated always as (
  case when programme_floor_price_sen >=
            ceil(direct_cost_sen::numeric / nullif(1 - floor_margin_rate, 0))::bigint
       then 'ABSOLUTE' else 'MARGIN' end) stored
```

Verified on the fixture: `MARGIN` at a programme floor of RM 13,900 against a
margin floor of RM 17,538, flipping to `ABSOLUTE` when the programme floor is
raised above it. It is generated rather than stored precisely because sb-erd is
right that it is derivable; deriving it in the database means the UI and the
approval screen cannot compute it differently.

### C-5. The deterministic-check invariant moves to this lane

Dropping `provenance_id` killed a constraint sb-erd owned, and it is this lane's
to replace. §17 states that a deterministic check carries no model, which sb-erd
enforced as a row constraint:
`method <> 'DETERMINISTIC' OR provenance_id IS NULL`. With the column gone that
is no longer expressible from the subject row.

It needs **both** halves, because each catches a different write. This was found
by testing: the provenance-side trigger alone still allows a check to be flipped
to `DETERMINISTIC` after its provenance row already exists.

```sql
-- half 1, this lane: refuse provenance whose subject is a deterministic check
create or replace function app.provenance_reject_deterministic() returns trigger
language plpgsql as $$
declare v_method text;
begin
  if new.subject_table = 'compliance_check_results' then
    select method into v_method from app.compliance_check_results where id = new.subject_id;
    if v_method = 'DETERMINISTIC' then
      raise exception 'a deterministic check carries no model (§17)'
        using errcode = 'PT422',
              detail = json_build_object('reason','DETERMINISTIC_CHECK_HAS_PROVENANCE',
                                         'subjectId', new.subject_id)::text;
    end if;
  end if;
  return new;
end $$;

-- half 2, sb-erd's table: refuse the after-the-fact flip
create or replace function app.check_result_reject_provenance() returns trigger
language plpgsql as $$
begin
  if new.method = 'DETERMINISTIC' and exists (
       select 1 from app.provenance
        where subject_table = 'compliance_check_results' and subject_id = new.id) then
    raise exception 'check % already carries provenance and cannot become DETERMINISTIC', new.id
      using errcode = 'PT422', detail = '{"reason":"DETERMINISTIC_CHECK_HAS_PROVENANCE"}';
  end if;
  return new;
end $$;
```

Both verified: a deterministic subject is refused provenance, an interpreted one
accepts it with model and confidence, and flipping an interpreted check to
deterministic while provenance exists is refused. `compliance_check_results` is
added to the `app.provenance_subject` allow-list.

This is a real cost of C-1 and belongs next to it: a constraint that was one
column check is now two triggers. It is cheaper than the nine-way union C-1
avoids, but it is not free.

### C-6. `_sen` confirmed, with the reservation made enforceable

sb-erd renamed 95 money columns from `_minor` to `_sen` to match this lane, and
recorded a reservation rather than arguing it: `_sen` names the Malaysian minor
unit in the column name, so a second currency makes every such column a
misnomer, where `_minor` would not.

The reservation is correct and the naming stands, for a reason that is visible
elsewhere in this document. §5.5 already stores AI cost as `cost_usd_micros` and
`cost_myr_micros` side by side. The convention is **name the unit, including its
currency**, and it is what makes that pair unambiguous. A future USD column would
be `_cents` or `_usd_micros`, never a `_sen` column holding cents.

The failure sb-erd is guarding against is someone storing a non-MYR amount in a
`_sen` column. That is equally wrong in a `_minor` column; the difference is that
`_minor` hides it and `_sen` makes it obvious. So the reservation becomes an
enforced invariant rather than a note:

```sql
alter table app.invoice   add constraint invoice_myr_only   check (currency = 'MYR');
alter table app.quotation add constraint quotation_myr_only check (currency = 'MYR');
```

Verified: an invoice in USD is refused. If a second currency is ever needed, this
constraint fails loudly at the point of change and forces the rename as part of
that work, instead of leaving mislabelled columns behind. sb-erd's reservation is
what the constraint is for, and is recorded here so the constraint is not
mistaken for a limitation nobody thought about.

sb-erd's `quotations.invoice_id` with `invoices.quotation_id` removed is adopted;
the edge has one spelling and §1.7's `commission_ledger` joins on it.

---

## Agreements with 02 (sb-tenancy)

`02-tenancy-auth-rls.md` (commit `ac8aff2`). All of sb-tenancy's requirements
are accepted; four change this document.

**A-1. `ai_provider` is this lane's table.** sb-tenancy is deleting its
duplicate `public.ai_provider_keys`. This lane owns the metadata columns,
sb-tenancy owns the secret material, the RLS and the reveal path. `key_ref`
stays on the row, since a vault secret id is a locator and not a capability;
decryption needs `SELECT` on `vault.decrypted_secrets`, which no login role
holds.

**A-2. The mask is computed in the database.** A caller-supplied mask can be
faked, so it is derived at write time inside the `SECURITY DEFINER` RPC and is
never an input:

```sql
create or replace function app.mask_key(p_key text)
returns text language sql immutable strict as $$
  select case when length(p_key) < 8 then repeat('•', 12)
              else left(p_key, 7) || repeat('•', 12) || right(p_key, 4) end
$$;
```

Verified to produce `sk-ant-••••••••••••9a41`, matching the §17 fixture.

**A-3. `key_fingerprint bytea` added** for "this key was already added"
detection: a SHA-256 comparison value, never an authenticator, with a partial
unique index on `(tenant_id, key_fingerprint) where key_fingerprint is not null`.

**A-4. "Platform admin" was wrong and is corrected.** §3.1 previously said
global rule rows are "platform-admin only". sb-tenancy is right that `ADMIN` is
tenant-scoped, and that a tenant's ADMIN editing national rules would let one
training provider change compliance for every other one. Global rows are written
only through the **service-role provisioning path**, which makes it a deploy-time
act under code review. This document adopts sb-tenancy's read predicate verbatim.

**A-5. Global-reference tables for the §8.7 pgTAP allowlist.** These carry a
nullable `tenant_id`, or none at all, by design. Naming them so the
NOT-NULL-tenant guard does not fail CI and nobody "fixes" the column later:

| Table | tenant_id | Why |
|---|---|---|
| `app.rule_set` | nullable | national circular registry snapshots |
| `app.compliance_rule` | nullable | national rules, tenant overrides allowed |
| `app.rule_change_set` | nullable | ingested circular documents |
| `app.rule_change` | nullable | proposed diffs against national rules |
| `app.knowledge_source` | nullable | shared corpora such as circulars |
| `app.provenance_subject` | **no column** | pure lookup, the allow-list of provenance-bearing relations |

Both partial indexes added as advised, since the `OR` predicate does not use a
single plain index well:

```sql
create index compliance_rule_global_idx on app.compliance_rule (family_key, side)
  where tenant_id is null;
create index compliance_rule_tenant_idx on app.compliance_rule (tenant_id, family_key, side)
  where tenant_id is not null;
```

Honest note: `compliance_rule` holds tens of rows, so the planner will prefer a
sequential scan regardless. Confirmed with `enable_seqscan = off` that the
partial index is valid and chosen when costs force it. These indexes are for the
RLS predicate shape and future growth, not for present performance.

**A-6. Root-key rotation warning carried forward.** Rotating the project-wide
pgsodium/Vault root key makes every existing secret unreadable with no automated
re-encryption, and it is a Management API operation rather than SQL. That is a
different act from a tenant rotating its own provider key, and conflating them
destroys BYOK for every tenant at once. sb-tenancy §6.4 holds the runbook; this
lane's `key_ref` design depends on that runbook being followed.

**A-7. OPS and realised margin — closed.** sb-tenancy decided it and wrote it
into its §4.5: keep the control, drop the `finance` block from the OPS
projection. `API_CONTRACT` §8 documents `GET /v1/engagements/{id}` for OPS with
`finance.realisedMarginRate` and `finance.trainerPayable` in the payload, and
that payload now needs a role-dependent projection noted against it, which
belongs to whoever owns the contract.

The part worth carrying here is sb-tenancy's reason, because it generalises:
**RLS filters rows and cannot hide a column**, and column-level `GRANT` does not
help either, since all nine application roles are the same Postgres role
`authenticated`. So the finance block becomes a one-to-one child table gated on
`quotation:read`, because a row is something a policy can gate. Leaving the
columns in place and having the API omit them for OPS would put the control in a
handler, where it fails the moment a second endpoint reads the same table. This
lane rechecked its own tables against that finding in Schema placement above.

**A-8. `costing:*` is now `quotation:*`.** team-lead ruled the table is
`quotations`, not `costings`, and sb-tenancy renamed the permissions with it:
`quotation:read`, `quotation:write`, `quotation:apply`. This document used
`costing:read` and is corrected. The rename was right: a permission naming a
different object than the table it guards is what gets "fixed" wrongly later.
`discount:approve` is unchanged, still SALES_MANAGER, FINANCE and MD and not
ADMIN, which matches the `discount_approval_id` check in §1.7.

---

## Phase 3 · Deviations

**D-1. Negative-tie rounding.** DECISIONS §7 says "rounded half-up". Literal
half-up sends −0.5 to 0. This design sends it to −1, away from zero, because it
makes a credit note the exact negative of the line it reverses. Only credit
notes are affected. Flagged to Finance as a five-minute confirmation.

**D-2. Two floors, not one.** The contract fixture is internally inconsistent
and the arithmetic was executed to confirm it. `QUO-2026-0184` states cost lines
summing to RM 11,400, sell price RM 18,500, `marginRate` 0.41, `floorPrice`
RM 13,900 and `floorMarginRate` 0.35.

| assertion | implied value | stated value |
|---|---|---|
| margin from the stated lines | 0.3838 | 0.41 |
| cost implied by margin 0.41 | RM 10,915 | lines sum to RM 11,400 |
| floor implied by a 0.35 margin floor | RM 17,538 | RM 13,900 |
| margin at the stated floor of RM 13,900 | 0.1799 | breaches the stated 0.35 floor |

These cannot all be true. RM 13,900 is 75.1% of list, which reads as an absolute
per-tier discount floor published on the programme, not a cost-derived number.
So the design carries both floors and takes the higher as binding, storing each
so the UI can say which one bound. `marginRate: 0.41` remains unreconciled with
its own cost lines and is treated as a fixture error, not a formula. Raised with
**team-lead** and **`sb-erd`**, who owns `programme.floorPrice`.

**D-3. Rule status enum.** The brief asked for `PROPOSED / VERIFIED /
SUPERSEDED`. The contract's §17 `RuleStatus` enum is `PROPOSED · ACTIVE ·
SUPERSEDED`, and §17's payload already carries `verifiedBy` and `verifiedAt`.
The contract enum is implemented, with verification expressed as the constraint
that `ACTIVE` requires a verifier. Same semantics, no third state, no divergence
from the published enum.

**D-4. Tier status, budget state and invoice overdue are views, not columns.**
The contract presents them as fields. They serialise identically; only the
storage differs. Each has multiple independent causes and a stored copy would
drift.

**D-5. Currency lives on the document, not the line.** The JSON still renders a
`currency` inside every money object. The composite foreign key makes a
mixed-currency document unrepresentable.

**D-6. AI cost stored in micro-MYR.** The API still returns sen. Sen is too
coarse to be the unit of record for per-token cost.

**D-7. Provenance is a side table.** The contract nests the envelope inside each
entity. `app.provenance_envelope()` reassembles it identically; the join is the
implementation detail.

**D-8. `asOf = training_start` not implemented.** §17 specifies it; DECISIONS §6
and §18 supersede it with grant-side and claim-side resolution. The superseding
text is implemented, as §18 instructs.

**D-9. Rule-set model changed mid-design.** The first attempt copied rules into
each snapshot. Executing the drift scenario produced ten warnings where one was
correct, so rule identity was made stable and the model went bitemporal. The
failure is recorded here because test 43 exists to prevent its return.

**D-11. Three reversals of 01, one correction from 02.** `provenance_id` on
subject rows is removed, `provenance_sources` stays jsonb, and
`quotations.rate_card_version text` becomes a foreign key with the label frozen.
All three are in Conflicts with 01 with reasons, and the field-level argument
originally offered against sb-erd's FK is withdrawn there as too strong. From 02,
"platform admin" was wrong: global compliance rows are service-role writes, since
a tenant-scoped ADMIN editing national rules would change compliance for every
other training provider.

**D-12. Schema placement was wrong throughout.** Every table in this document was
written as `app.*` and belongs in `core`. `app` is not exposed to PostgREST, so
the endpoints would have returned empty with no error. Caught by sb-tenancy after
sb-actions hit the same thing. Corrected in Schema placement, which carries the
per-object table. The `app.` prefixes in the SQL fragments below are left as
executed rather than rewritten, since they were verified in that form; read the
placement table as authoritative for schema and the fragments as authoritative
for everything else.

**D-10. Stub tables.** `app.engagement` and `app.agent_action` appear here as
minimal stubs so the evaluator and the hours-saved function could be executed.
They are owned by `sb-erd` and `sb-actions`. Only the columns this lane reads are
shown, and `app.compliance_facts` is the intended contract between us.

---

## Phase 3 · What I could NOT verify

**PostgREST `PTnnn` → HTTP status mapping.** The 422 and 409 mappings rest on
PostgREST translating SQLSTATE `PTnnn` to HTTP status `nnn`. This is a
documented PostgREST convention and I am confident in it, but no PostgREST
instance was available to exercise it, and the behaviour is version-dependent.
Confirm against the deployed version before relying on it; the fallback is an
application-layer translation table, which changes no schema.

**`pg_jsonschema` availability.** Not present in the local PostgreSQL 17.11 used
for verification, and no Supabase project was connected. It ships with Supabase,
but whether it is enabled on the target project is unconfirmed. Every jsonb rule
in this document is therefore expressed as a check constraint that works without
it; `pg_jsonschema` would be an upgrade, not a dependency.

**`btree_gist` on the target project.** Verified available and installed
locally. Every exclusion constraint here needs it. Standard on Supabase, but
unconfirmed for this project.

**PostgreSQL version on the target.** Everything was executed on 17.11. The
generated-column and exclusion-constraint behaviour used here holds from 15
onward. Supabase's default was not checked.

**Circular numbering.** DECISIONS §3 attributes the lead-time, commencement and
no-amendment rules to "Circular 2/2026". API_CONTRACT §17 attributes HRD-014, the
same rule, to "Circular 04/2026" section 3.2 page 4. Both cannot be right. The
seed uses `DOC-0188` / "Circular 2/2026" following DECISIONS, which is the later
document, but a citation is the one thing a compliance rule cannot get wrong.
Compliance must resolve it against the PDFs.

**SST exemption.** Every fixture asserts `TRAINING_EXEMPT` at 0%. No statutory
source appears anywhere in the pack. The schema supports a rate; the exemption
itself is unverified.

**ACM meal ceiling.** DECISIONS §5 gives a range of RM 15–25 for 2026; §17's
check example uses a RM 25.00 ceiling against RM 26.00 per pax. Consistent with
the top of the range, but the actual 2026 Allowable Cost Matrix was not seen.

**MyInvois line reconciliation.** DECISIONS §7 asserts that MyInvois expects
line totals to reconcile to the invoice total, which is the stated reason
lines-from-total is not an option. No MyInvois specification was available. The
requirement is sound on its own terms; the citation is unverified.

**`GET /collections/rules` ladder values.** §9 gives 7 / 30 / 45 days with a
human call at 60 and trading hold at 75. Seeded as given. Whether these are the
client's current practice or a proposal was not established.

**Cross-lane column names.** `app.compliance_facts` assumes engagement columns
from `sb-erd` and `human_minutes_spent` from `sb-actions`. Both lanes were
running concurrently and neither schema was read. The view is the seam; names
will need reconciling.
