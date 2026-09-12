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
