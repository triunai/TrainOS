# Changelog

Tracks notable changes across migrations, RPC contracts, frontend types, and project
documentation. Append new entries at the top with the date in ISO-8601 format.

> An entry that reflects a real architectural decision cites the doc that carries the
> reasoning — `docs/architecture/NN`, or a decision id where one exists. The point is to make a
> shipped behaviour traceable to the reasoning behind it without archaeology. **Forward-only:
> older entries are not backfilled**; link them if you happen to touch them.

Where the catalog (`supabase/migrations/migration-catalog.md`) is the engineering and security
record of a migration, an entry here is the human-facing summary of the same event.


## 2026-09-12 — the database floor: three schemas, five shared helpers, and two baseline lines that do not work

### Added

- **The foundation migration (001).** Schemas `app` (helpers and the action gate, not reachable
  from the API), `core` (the domain, reachable) and `extensions`; four extensions, each with the
  downstream consumer that needs it named rather than installed speculatively; and five shared
  helpers. The rounding rule from DECISIONS §7 now has exactly one definition in the database
  (`app.round_half_up_minor`) instead of being a sentence every money migration re-implements.
- **The RPC envelope is a function, not a convention.** `app.ok()` and `app.err()` build the
  `{success, data}` / `{success, error}` shapes rather than asking each author to reproduce them.
  A top-level sibling key is the failure that silently flips every client from auto-unwrap to
  pass-through; it is now something a later author cannot add by accident, only by deleting the
  call.
- **One immutability trigger instead of N.** `app.enforce_immutable_columns` takes the frozen
  column names as trigger arguments, so `ref`, a sent proposal's body and an applied quotation all
  freeze through the same implementation. It refuses erasure as well as change, and it raises
  loudly when attached to a column that does not exist — the quiet version of that bug would leave
  `ref` writable across the whole model with every migration still looking correct.

### Changed

- **The domain lives in schema `core`, not `public`.** `docs/architecture/03` names it and uses it
  throughout its own executable SQL; `docs/architecture/02` writes the same tables as `public.*`.
  03 outranks 02, so the domain is `core` and doc 02's policy catalogue is re-targeted onto it.
  `core` is added to PostgREST's exposed schemas in `supabase/config.toml`; without that the entire
  domain is invisible to the API and nothing says why.

### Security

- **Two lines of the documented schema baseline do not do what they say, and are no longer relied
  on.** `alter default privileges … revoke all on tables from public` is vacuous, because Postgres
  grants PUBLIC no default table privilege to revoke. The functions equivalent is not vacuous and
  still fails: measured on PostgreSQL 17.11 it records no row in `pg_default_acl`, and a function
  created afterwards remains executable by PUBLIC and by `anon`. The same statement in GRANT form
  records correctly. Both lines are kept as the documented baseline and are explicitly not the
  guard: every migration revokes EXECUTE per function at creation, and the pin sweeps every
  function in `app`, `core` and `public` for a PUBLIC or `anon` grant outside the portal allowlist.
  Found by a pin assertion that failed, not by review.
