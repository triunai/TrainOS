# `seeds/` — fixture and demo data

Seeds are **never part of the numbered migration sequence** and are never applied by a
migration runner. A human runs one deliberately against a named database:

```
psql "$DATABASE_URL" -f supabase/seeds/<file>.sql
```

Rules:

- **Idempotent.** Re-running a seed UPDATEs in place (`INSERT ... ON CONFLICT ... DO UPDATE`).
  Iterating a fixture must never require wiping it first.
- **Fixed, memorable UUIDs.** A fixture's ids are constants written in its header, not
  `gen_random_uuid()`, so tests and screens can reference them.
- **Header block** states: what the fixture is for, which tenant slug it lands in, the fixed
  ids, and the exact run command.
- **A companion wipe file** where the fixture is meant to be reset rather than deleted.
- **Dated seeds** (`YYYY-MM-DD_<tenant>_<slug>.sql`) are one-off content operations for a
  specific live tenant. They pair with a same-stem rollback in `rollbacks/`, and they get
  neither a catalog number nor a `test_` pin — they are content, not schema.

## The fixture world

`fixture_world_01…04` are the web app's fixture dataset (`@trainos/fixtures`)
landed as rows: one tenant, `akademi-perdana`. They are what the 018 RPC tests
read, what the conformance suite runs against with `VITE_API_MODE=supabase`, and
what a reviewer opens the app on. Four parts, in foreign-key order, one
transaction:

```
psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 \
  -f supabase/seeds/fixture_world_01_tenant_and_parties.sql \
  -f supabase/seeds/fixture_world_02_sales_and_money.sql \
  -f supabase/seeds/fixture_world_03_delivery_compliance_finance.sql \
  -f supabase/seeds/fixture_world_04_ai_ops_and_agents.sql
```

There is deliberately **no `fixture_world.sql` runner** that `\i`s the parts:
`npm run lint:sql` parses everything in this directory through the real Postgres
grammar, and a psql meta-command is a syntax error to it. The run order lives in
each part's header instead.

The SQL is **generated**, not hand-written — 136 participants and 78
certificates are derived sets, and a transcription of them drifts:

```
npx tsx packages/fixtures/scripts/emit-seed.ts           # rewrite the four parts + wipe
npx tsx packages/fixtures/scripts/emit-seed.ts --check    # fail if they have drifted
```

`test_fixture_world.sql` is the pin. It is the one file here that is hand-written
with literal expected numbers, because a pin that derives its expectations from
the thing it is checking is not a pin. Its header states the run command: the
seed is re-applied ahead of it in the same transaction, and T0 reads
`pg_stat_xact_all_tables` to prove that second run moved zero rows.
