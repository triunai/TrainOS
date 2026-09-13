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

## Hosted demo data — `hosted_demo_akademi_perdana.sql`

Demo data for the **already-provisioned** hosted tenant `akademi-perdana`, safe to run
against the live project. It deliberately breaks two rules above, and says why in its header:

- **Refs and state are the app's, not constants.** Refs are allocated by `core.assign_ref`
  (so the app's next ENQ/PRO/QUO follows the demo ones instead of colliding), and no trigger
  is disabled: rows are inserted in their initial state and walked over ungated transitions.
- **Idempotent by insert-if-absent, not upsert.** Ids are deterministic
  (`de30da7a-5eed-4…`, derived from a stable key); a re-run writes nothing and burns no refs.

It never provisions a tenant, never writes `auth.users`, memberships or profiles, and points
every user reference at the tenant's three MD users.

```
psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/seeds/hosted_demo_akademi_perdana.sql   # seed
psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/seeds/hosted_demo_wipe.sql              # remove
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seeds/test_hosted_demo.sql                 # pin, ROLLBACK
```

The wipe removes only the seed's id range and refuses if a real row references demo data.
It leaves `core.ref_sequences` advanced: refs are never reused.
