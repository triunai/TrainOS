# `tables/` — point-in-time schema snapshot

**These are reference files, NOT executable migrations. Do not run them against a database.**

Each `<table>.sql` here is the *current cumulative shape* of one table — the result of
replaying every `CREATE TABLE` and `ALTER TABLE` that has touched it — so a reader can see
what a table looks like today without replaying the whole migration sequence.

| | |
|---|---|
| **Audit date** | — (no snapshot taken yet) |
| **Source** | `supabase/migrations/` + `supabase/migrations/migration-catalog.md` |
| **Method** | Manual extraction: replay all `CREATE TABLE` / `ALTER TABLE` statements in numeric order |

## Status

Empty by design. The initial migration set (001–016) is authored but has not been applied to
any hosted database, so there is no live schema to snapshot and a file here would be a
transcription of the migrations rather than an audit of reality.

Take the first snapshot at first apply, and record the audit date above. Until then the
canonical current-state description is the catalog's `## Tables` section.

## Per-file format

```sql
-- <table_name>
-- Audited: YYYY-MM-DD
-- Created by: NNN_<slug>.sql
-- Modified by: NNN_<slug>.sql (what changed), ...

CREATE TABLE public.<table_name> ( ... );

-- Indexes
CREATE INDEX ...

-- RLS
ALTER TABLE public.<table_name> ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.<table_name> FORCE ROW LEVEL SECURITY;
CREATE POLICY ...

-- NOTE: anything non-obvious — a sentinel row and its fixed uuid, a constraint
-- that was dropped later, a column whose meaning is not its name.
```

**This directory goes stale.** When it disagrees with `migration-catalog.md`, the catalog is
the fresher source and this file is the bug.
