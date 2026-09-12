# Supabase repository conventions — showroom (primary) + vern-vault (secondary)

Source repos (read-only, this document is the only file written):
- `/Users/khumeren/Repos/personal-work/showroom/supabase` — "wishes" repo, the primary
  convention source. 119 migrations as of 2026-09-11, RPC-only / deny-all RLS posture.
- `/Users/khumeren/Repos/personal-work/vern-vault/supabase` — secondary source. Small
  migration count (2 live files + rollbacks), but its `tables.md` / `triggers.md` / `rpcs.md`
  / `config.toml` document a *different* valid pattern: real `CREATE POLICY` RLS instead of
  RPC-only deny-all. Cited where showroom has no equivalent.
- `/Users/khumeren/.claude/skills/migration-retrofit-qa/SKILL.md` — the QA gate skill,
  summarised in full near the end.

All citations are `file:line` against the paths above unless stated otherwise.

---

## 1. `supabase/CLAUDE.md` in full (showroom)

File: `showroom/supabase/CLAUDE.md`, 83 lines. Reproduced rule-by-rule (not the migration
table, which is superseded — see §1.1).

- **Title / scope** (`CLAUDE.md:1-3`): "Database schema, RPCs, and security model.
  Security-critical — read before touching any migration."
- **Migration table is a historical snapshot, not the source of truth** (`CLAUDE.md:5-11`):
  > "The table below is a historical snapshot of 001–043. The **canonical, complete list is
  > `supabase/migrations/migration-catalog.md`** (auto-maintained, one Detail section per
  > migration) — consult it for 044+ and before any migration work."
  Verified: the catalog file (`migration-catalog.md`) is 7,901 lines and covers through
  migration 119, confirming the CLAUDE.md table (which stops at 043) is stale by design, not
  by neglect.
- **Security Rules (MANDATORY)** (`CLAUDE.md:59-66`), verbatim:
  1. Every RPC is `SECURITY DEFINER` with `SET search_path = public, extensions`
  2. Admin RPCs check: `SELECT 1 FROM admin_users WHERE user_id = auth.uid()`
  3. `GRANT EXECUTE` to `authenticated` only (never `anon` for admin RPCs)
  4. RLS enabled on all tables: `REVOKE ALL FROM PUBLIC, anon, authenticated`
  5. Never allow direct table access from client — RPC-only pattern
  **Drift note:** rule 1's `search_path` string in CLAUDE.md (`public, extensions`) is stale
  against what migrations actually write. Migration 093's five functions all declare
  `SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'`
  (`093_bespoke_requests.sql:197,346,558,634,708`) — pg_catalog first, pg_temp last, per the
  retrofit skill's G3 trap list (`migration-retrofit-qa/SKILL.md:116-119`). CLAUDE.md's rule 1
  is the *intent*, not the literal clause; treat the skill's four-schema form as canonical.
- **Migration Compatibility Rule** (`CLAUDE.md:67-71`):
  - Read `docs/ai/backlog/backlog-implementation-reference.md` before backlog/migration work.
  - Any migration touching client-visible RPCs must list client compatibility in its header:
    affected RPCs, `RpcMap` entries, frontend callers, reload/edit paths, deploy coupling.
  - Run `npm run check:rpc` whenever SQL RPC envelopes/signatures, `src/lib/rpc.types.ts`, or
    RPC consumers change. (Script: `showroom/package.json:15` →
    `node scripts/rpc-contract-check.js`; sibling `check:grants` at `package.json:16` →
    `node scripts/check-grants.mjs`; `lint:sql` at `package.json:21` → `node tools/sql-lint.mjs`,
    a **blocking CI job** per the catalog fold-2 entry.)
- **Testing** (`CLAUDE.md:73-77`): names two example pins, `tests/test_rsvp_system.sql` and
  `tests/test_008_009_validation.sql` — a stale, non-exhaustive pointer; the real inventory is
  the 70+ files in `tests/` (§2).
- **Gotchas** (`CLAUDE.md:78-83`), verbatim:
  - Phone identity uses E.164 format (`+60123456789`) — `phone_e164` column is UNIQUE
  - Edit tokens are SHA-256 hashed (`edit_token_hash`) — never store raw tokens
  - Wish hearts use `digest(client_token, 'sha256')` for idempotent dedup
  - The `tags` column on `rsvps` is `text[]` — use `admin_update_guest_tags` RPC, not direct
    UPDATE

### 1.1 A rule not in CLAUDE.md but load-bearing repo-wide: the spine

`AGENTS.md:117-119` states the rule CLAUDE.md assumes: **never touch the config-backed spine**
(`submit_rsvp`, `get_ticket`, `weddings.config_json`) — new capability ships as a sidecar table
plus a wrapper RPC that *calls* the unmodified spine, plus a config gate. The retrofit skill
calls this the retrofit-vs-bolt-on question and makes it G1 of its gate
(`migration-retrofit-qa/SKILL.md:55-73`). Every migration detail entry in the catalog closes
with a "Spine untouched (D-001)" line (e.g. `migration-catalog.md` migration-093 detail,
quoted in §5).

### 1.2 Migration catalog discipline (also not in CLAUDE.md, in AGENTS.md)

`AGENTS.md:122-123`: "any touch to `supabase/migrations/` updates
`supabase/migrations/migration-catalog.md` in the SAME commit." The retrofit skill repeats
this as a hard rule: "The catalog is a **same-commit hard rule** (root `CLAUDE.md`). A
migration whose catalog entry lands in a follow-up commit fails this gate."
(`migration-retrofit-qa/SKILL.md:47-49`) — note the skill attributes this rule to root
`CLAUDE.md` even though the literal text lives in `AGENTS.md`; treat the two files as one
combined ruleset for this purpose.

---

## 2. Folder layout

```
supabase/
  migrations/               forward SQL, numbered
    NNN_<slug>.sql
    migration-catalog.md    the canonical migration record (§3)
  rollbacks/                one rollback per forward migration
    NNN_<slug>_rollback.sql
  tests/                    one SQL pin per forward migration
    test_NNN_<slug>.sql
  tables/                   point-in-time cumulative schema reference (NOT executable)
    README.md               audit metadata: date, source, method
    <table>.sql
  seeds/                    idempotent fixture/demo data, run manually
  functions/                Edge Functions (Deno)
    _shared/                cross-function helpers (CORS, gates)
    <function-name>/index.ts
```

### 2.1 Naming

- **Migrations:** `NNN_<slug>.sql`, zero-padded 3-digit sequence, e.g.
  `093_bespoke_requests.sql`. Slug is a short snake_case description, not a verb-object pair
  necessarily — mixes both (`wishes_system`, `drop_cleanup_test_data`).
  Two documented naming exceptions:
  - **Same-number forks**, disambiguated by a suffix when a slot is contested or split:
    `073_admin_access_context.sql`, `073_admin_access_context_breakglass.sql`,
    `073_admin_access_context_restore.sql` (all present in
    `showroom/supabase/migrations/`).
  - **Renumber-in-place with the old name kept as a note**: catalog migration-107's entry
    records "was 095 — RENAMED fold-6; unapplied and amended in place, so a numerically-ordered
    replay would have run it before 104" (`migration-catalog.md:263`). The file on disk is
    `107_bespoke_replace_request.sql`; the rename is documented, not silent.
  - A `.bak` suffix marks an abandoned/superseded draft that is kept for history but excluded
    from the sequence: `042_submit_rsvp_guest_sync_fixes.sql.bak` sits alongside the real
    `042_lane_b_plus.sql`.
  - Dated, non-numbered migrations exist for one-off tenant/content fixes, e.g.
    `2026-09-09_deeva_annesha_cards_rollback.sql` in `rollbacks/` — these pair with dated seed
    files of the same stem in `seeds/` (see §2.3), not with a numbered migration.
- **Rollbacks:** `NNN_<slug>_rollback.sql` — exact same slug as the forward file, suffix
  `_rollback`. 1:1 file-name correspondence is the norm (confirmed for all of 050–119).
  Migrations before ~050 largely predate the rollback discipline and have no rollback file —
  this is a known historical gap, not a rule violation for new work.
- **Tests (SQL pins):** `test_NNN_<slug>.sql` — same slug again, `test_` prefix instead of a
  suffix. Multiple migrations can share one pin file when they're reviewed as a unit, e.g.
  `test_098_100_101_rollback_later_gate_preflight.sql`.
- **Tables reference:** `<table_name>.sql`, lowercase snake_case matching the live table name,
  e.g. `weddings.sql`, `rsvp_checkins.sql`.
- **Seeds:** free-form descriptive slugs, either date-stamped
  (`2026-09-09_deeva_annesha_cards.sql`, matching a same-stem rollback) or purpose-stamped
  (`qa-rick-unity-seed.sql`, `qa-rick-unity-wipe.sql`, `qa-rick-unity-guests-01-...` through
  `-10-...` for a themed QA fixture's guest batch).

### 2.2 The pairing rule (migration ↔ rollback ↔ test ↔ catalog)

This is G0 of the retrofit-qa skill, stated as a table
(`migration-retrofit-qa/SKILL.md:40-45`):

| Artifact    | Path                                          | Must contain                                                          |
| ----------- | ---------------------------------------------- | ---------------------------------------------------------------------- |
| Forward SQL | `supabase/migrations/NNN_<slug>.sql`          | A header stating the DEFECT, the CHANGE, and the worked 7-point check |
| Rollback    | `supabase/migrations/NNN_<slug>_rollback.sql` | The prior definition **reproduced in full**, not referenced           |
| SQL pin     | `supabase/tests/test_NNN_<slug>.sql`          | Fixtures, assertions, `ROLLBACK` at the end                           |
| Catalog     | `supabase/migrations/migration-catalog.md`    | Header counts, Migration Order row, RPC entry, Migration Detail       |

(Note: the skill's own path column says `supabase/migrations/NNN_<slug>_rollback.sql`, but the
actual repo convention — confirmed on disk — puts rollbacks in a **separate top-level
`rollbacks/` directory**, not inside `migrations/`: `showroom/supabase/rollbacks/093_...`. Trust
the repo layout over the skill's path string; the skill's *content* requirement — full
reproduction, not a pointer — is what matters.)

A migration is "not reviewable until all four exist"
(`migration-retrofit-qa/SKILL.md:36-38`). Report which are missing rather than reviewing a
partial set.

**Rollback fidelity rule** (`migration-retrofit-qa/SKILL.md:50-53`): "reproduce the prior
function body IN THE FILE. A rollback that says 'see migration 042' depends on another file
being readable at the moment you need it, which is not a rollback." State the rollback's ORDER
too (usually the reverse of forward order). Confirmed in practice: the 093 rollback
(`093_bespoke_requests_rollback.sql:42-54`) drops all five RPCs then the table, and separately
guards against dropping a table with resolved audit history — see §5.

**Rollback can legitimately refuse to run.** Two documented patterns:
- A **pre-flight ABORT guard** when running the rollback would destroy audit history it isn't
  entitled to destroy — `093_bespoke_requests_rollback.sql:8-40` aborts if any request reached
  `completed`/`shipped` status, because "the table is the audit trail of how a couple's
  paid-for revisions were spent; silently erasing fulfilled orders is not a rollback."
- A **documented no-op** when faithful restoration is impossible — migration 119's rollback
  restores two of three dropped functions and explicitly declines to recreate the third because
  "that body was never committed anywhere, and a plausible-but-wrong body under a real name is
  worse than restoring nothing" (`migration-catalog.md`, migration-119 tail section, "Rollback —
  partially faithful, on purpose"). The stated precedent for this pattern is
  `065_grant_hygiene_revoke_anon_rollback.sql` (D-030).
- A rollback can also be **gated behind an explicit override flag** when it would strip a later
  migration's security gate if left unconditional, e.g. `app.allow_105_rollback`,
  `app.allow_106_rollback` (`migration-catalog.md`, fold-6/fold-4 entries) — "an override belongs
  to the gate a file *owns* and removes on purpose, never to a later migration's gate it would
  strip as a side effect."

### 2.3 Dated / tenant-specific migrations, rollbacks and seeds

For one-off content or per-tenant fixes that aren't schema migrations in the numbered sequence,
the repo uses `YYYY-MM-DD[suffix]_<tenant>_<slug>` stems shared across `rollbacks/` and
`seeds/`, e.g. `2026-09-11b_deeva_annesha_banner_faq_fix_rollback.sql` and
`2026-09-11c_deeva_annesha_reception_portrait_rollback.sql` (letter suffixes for same-day
multiple changes). These still pair a seed (the forward content write) with a rollback SQL
file; they do not get a numbered catalog entry or a `test_` pin the way schema migrations do —
they are content operations, not schema changes.

### 2.4 `tables/` is a point-in-time audit snapshot, not live schema

`tables/README.md` states its own scope explicitly (`tables/README.md:1-31`):
- Audit date, source ("24 migrations (001–024) + migration-catalog.md" at time of writing),
  method ("Manual extraction by replaying all CREATE TABLE + ALTER TABLE statements
  sequentially").
- Each `.sql` file is "the current cumulative state of the table (not incremental changes)" —
  i.e. it's a *reconstructed* final-shape reference, never itself executed.
- Explicit non-executability warning: "These are reference files — NOT executable migrations.
  Do not run them against the database."
- Carries drift notes inline, e.g. "`chk_event_values` on `rsvps` was DROPPED in migration
  018. Event validation now lives in RPCs" and "Migration 012 is written but NOT DEPLOYED in
  production" (later corrected live in migration 012's catalog row, `migration-catalog.md:178`
  — a case of `tables/README.md` going stale and the catalog being the fresher source).
- Per-table file format (`tables/weddings.sql:1-30`): a header comment block (table name,
  audit date, which migration created it, which modified it), the `CREATE TABLE`, then
  `-- Indexes`, then `-- RLS` (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY` +
  `REVOKE ALL ... FROM PUBLIC, anon, authenticated`), then free-form `-- NOTE:` comments for
  anything non-obvious (e.g. the sentinel wedding row and its fixed UUID).

This is a snapshot/reference convention, not a source of truth — the live catalog and the
migrations directory are canonical; `tables/` exists so a reader doesn't have to replay 100+
migrations to see a table's current shape.

---

## 3. The migration catalog

File: `showroom/supabase/migrations/migration-catalog.md`, 7,901 lines. Found by:
`grep -rniE "catalog" supabase --include="*.md" -l` → three hits, this file plus
`CLAUDE.md` and `tables/README.md` referencing it.

### 3.1 Structure (top to bottom)

1. **Title + subtitle** (`migration-catalog.md:1-2`): `# Migration Catalog`, then
   `> Auto-generated catalog of all Supabase migrations`.
2. **A running stack of dated "Last updated" narrative entries** immediately under the title
   (`migration-catalog.md:5` onward) — each is a full prose paragraph (sometimes 500+ words)
   documenting one apply, one review fold, or one triage wave, in **reverse chronological
   order, newest first, prepended**. These are not migration-detail sections; they are a
   living incident/decision log at the top of the file. Every one names the migration number,
   the concrete change, the evidence checked, and what was deliberately left alone.
3. **`## Migration Order`** (`migration-catalog.md:163`): one markdown table,
   `| # | File | Summary |`, one row per migration in numeric order — the flat index.
4. **`## Tables`** (`migration-catalog.md:283`): one `###` subsection per table with its full
   current-state schema (columns, purpose) — this is the *live* equivalent of the `tables/`
   snapshot directory, kept inside the catalog itself.
5. **`## Indexes`** (`migration-catalog.md:859`): grouped by table.
6. **`## RPCs (Functions)`** (`migration-catalog.md:938`): split into
   `### Helper Functions` (internal, not client-callable) and `### Public RPCs`
   (client-callable), one `####` subsection per function with signature and behaviour.
7. **`## Migration Detail — NNN (`NNN_slug.sql`)`** sections, one per migration, in numeric
   order, running for most of the rest of the file (first one found at
   `migration-catalog.md:6846` for migration 093). This is the per-migration deep-dive: status,
   what it does, the 7-point RPC check worked, the pin's coverage, the rollback's shape.
8. **`## End of Catalog`** sentinel line at the very end.

### 3.2 One catalog entry, reproduced

**Migration Order row** (`migration-catalog.md:260`):

```
| 093 | `093_bespoke_requests.sql` | **The per-section bespoke-request ledger + the superadmin pending-orders queue (owner 2026-08-13).** New server-owned sidecar `bespoke_requests` (D-052/090 posture: RLS deny-all + REVOKE ALL, RPC-only) keyed by exactly one of wedding_id/draft_id, section-scoped to the editor registry minus `rsvp` (owner-ratified exclusion), capped by the package revision allowance (core 1 / deluxe 3 / grand 5 — the 2026-08-09 tier-matrix spec). Five RPCs: `get_bespoke_revision_state` (couple-or-staff READ — the header's tier/cap/used), `submit_bespoke_request` (couple-only WRITE, enforces cap + one-open-per-section via a partial unique index), `cancel_bespoke_request` (couple pending-cancel refunds the slot), `admin_list_bespoke_orders` (staff-only queue), `admin_set_bespoke_status` (staff-only resolve; completed/in_review permanently spend the slot). AUDIT-BY-DESIGN: rows are append-only — text/section/slot immutable, only status transitions, `revision_slot` monotonic per tenant so the ledger never re-issues a number. Spine untouched (D-001). |
```

**Migration Detail section** (`migration-catalog.md:6846-6913`, condensed — full text is
reproduced in §5 alongside the other three artifacts):

```
## Migration Detail — 093 (`093_bespoke_requests.sql`)

**Status: AUTHORED + APPLIED 2026-08-13** (owner's DB protocol: migration → test
pre-apply → apply → rollback → catalog). Plan:
`docs/superpowers/plans/2026-08-13-bespoke-request-per-section.md`.

### What it does
...
### The 7-point RPC contract check (D-002), worked
1. Envelope: ...
2. Unwrap: ...
...
### Pin — `supabase/tests/test_093_bespoke_requests.sql`
T1 grants ... T20 envelope exactly {success,data}.
Executed PRE-apply ... and POST-apply (**ALL PASS, 50 assertions across T1–T20**).

### Rollback — `supabase/rollbacks/093_bespoke_requests_rollback.sql`
Pre-flight ABORT if any `completed` request exists ... → five RPCs dropped in
dependency order → table dropped.
```

### 3.3 Rule for when the catalog is updated

- **Same commit, always.** "The catalog is a same-commit hard rule (root CLAUDE.md). A
  migration whose catalog entry lands in a follow-up commit fails this gate."
  (`migration-retrofit-qa/SKILL.md:47-49`); restated in `AGENTS.md:122-123`.
- **Applies to every layer of the catalog**, not just the Detail section: G0 lists "catalog"
  as covering "Header counts, Migration Order row, RPC entry, Migration Detail" — all four
  update together (`migration-retrofit-qa/SKILL.md:45`).
- **Corrections are appended forward, not rewritten in place**, when a later fold discovers an
  earlier catalog claim was wrong. Example: the 2026-08-14 fold-9 entry explicitly says a prior
  claim about `RAISE` unwinding a cascade was "READ, NOT RUN" and needed live re-tracing before
  anyone could rely on it (`migration-catalog.md`, fold-9 paragraph) — the correction is a new
  dated paragraph, the old one is left standing with the correction pointing at it.
- **A migration authored-but-not-applied still gets a catalog entry**, explicitly marked
  `AUTHORED, NOT APPLIED` (e.g. migration 102's entry, `migration-catalog.md`, "Last updated:
  2026-08-15" paragraph) — the catalog tracks authorship state, not just applied state.
- **Apply-time corrections are folded into the *same* migration's catalog section**, not
  hidden — the 2026-08-16 batch-apply paragraph lists five separate "first-execution
  corrections" (wrong `pg_get_function_identity_arguments` usage, fixture ordering bugs, a
  literal SQL syntax error) discovered only by actually running the pins, each with the fix
  described inline.

---

## 4. The migration changelog

File: `showroom/CHANGELOG.md` (repo root, not under `supabase/`). Found by
`grep -rniE "changelog" --include="*.md"` → top-level hit plus a `changelog/` directory of
point-in-time studies (`changelog_study_20260726.md`) that are historical snapshots, not the
live file.

### 4.1 Header and convention (`CHANGELOG.md:1-11`)

```
# Changelog

Tracks notable changes across migrations, RPC contracts, frontend types, and project documentation. Append new entries at the top with the date in ISO-8601 format.

> **ADR links (convention started 2026-08-17).** An entry that reflects a real architectural
> decision cites it as `(ADR-NNN)`. The ADR lives in the Obsidian vault
> (`wiki/adr/`) and mirrors the canonical `D-NNN` in `docs/ai/state/decisions.md`; the ADR
> carries a `Changelog:` line pointing back here. The point is to make a shipped behaviour
> traceable to the reasoning behind it without archaeology — a pseudo-postmortem you can read
> forward. **Forward-only: older entries are not backfilled**; link them if you happen to touch
> them.
```

### 4.2 Entry shape

- One `## YYYY-MM-DD — <short summary>` heading per day/batch, newest at the top of the file.
- Sub-sections by category: `### Added`, `### Changed`, `### Fixed`, `### Security`,
  `### Note` — not all present on every entry; used as needed.
- Each bullet: **bold lead phrase** stating the user-visible or system-visible change, then
  plain-prose detail, then a short-hash citation in parens, e.g. `(`6b873e24`)`,
  and/or an ADR tag, e.g. `(ADR-028, `2e0b6a6c`)`.
- A changelog entry can explicitly split feature-facing prose from a security-facing one for
  the *same underlying migration* — migration 119 gets a `### Security` bullet in the
  2026-09-09 entry (`CHANGELOG.md`, "Three anon-executable functions removed..." paragraph)
  that is a compressed, reader-facing version of the much longer catalog narrative.
- A `### Note` sub-section is used to point at a *sibling* changelog entry rather than
  duplicate it, when two entries land the same day from the same merge — see the 093 entry
  cross-reference example below.

### 4.3 One changelog entry, reproduced (`CHANGELOG.md:965-990`, feature-facing half)

```
## 2026-08-13 — bespoke requests: edit/remove, reference images, confirm-lock + the share-invite message editor

### Added

- **Edit and remove a bespoke request.** A pending request's section now shows a tappable
  "Pending review — tap to edit or remove" badge. **Edit** cancels the pending request (your
  revision is refunded — the team hasn't started) and reopens the composer prefilled; **Confirm
  & submit changes** creates the new request, and the audit keeps both. **Remove** cancels it
  outright. After Confirm the request is locked (immutable by design).
- **Reference images on bespoke requests.** Add a PNG/JPEG/WebP/GIF screenshot or mockup so the
  team can see what you mean — uploaded with your card, shown in the superadmin's pending queue.
- **"Share invitation message" editor** under the footer's WhatsApp messages: edit the text
  guests see when they tap Share, with the current wedding message as the default and
  `{bride}` / `{groom}` / `{date}` / `{inviteUrl}` / `{deadline}` tokens that fill in from your
  card automatically. Clear it to use the default again.

### Changed
...
- **Bespoke requests carry a reference image** via migration 094 (`bespoke_requests.
  reference_image_url`; `submit_bespoke_request` re-created with `p_reference_image_url` —
  the old signature was dropped first to avoid the PGRST203 overload trap).
```

Cross-reference pattern from the same day's sibling entry (`CHANGELOG.md:946-963`):

```
## 2026-08-13 — losh-weds-nithi: couple's share message, ...
...
### Note
- The branch also carried the `integ/bespoke-fixes` merge (migrations 093–096, bespoke
  request edit/remove + reference images, the share-message editor, superadmin orders
  queue) — covered by its own changelog entry.
```

### 4.4 Rule for when the changelog is updated

The changelog is folded into the same **end-of-session wrap ritual** as the catalog, not
committed independently per migration: `AGENTS.md:130-134` names the `wrap-session` skill,
which "executes the `hygiene.md` routing: refresh `hot-state.md`, prepend `project-log.md`,
fold `state-backlog.md`, and **conditionally update CHANGELOG / migration-catalog / memory**."
An advisory pre-push script, `scripts/hygiene-check.mjs`, nudges when `hot-state.md` has gone
stale versus recent commits — it is advisory, not blocking, unlike `check:rpc`/`check:grants`.
In practice every migration batch in the catalog that reaches "APPLIED" status has a same-day
changelog entry; the changelog entry is the human/product-facing summary while the catalog
Detail section is the engineering/security-facing record of the same event.

---

## 5. Anatomy of one representative migration batch — migration 093

Migration 093 (`bespoke_requests`, 2026-08-13) was chosen because all four artifacts exist,
are internally consistent, and the batch is non-trivial (a new table, five RPCs, three
authorization tiers, an append-only audit design) without the multi-fold rescue-narrative
complexity of later migrations like 093–107's studio lane. Quoted side by side below.

### 5.1 Forward SQL — header, security posture, grants

Header (`093_bespoke_requests.sql:1-76`, condensed to the load-bearing parts):

```sql
-- ============================================================================
-- Migration 093: bespoke requests per section — the revision ledger + the
-- superadmin pending-orders queue.
-- ============================================================================
--
-- The owner's bespoke-request feature (2026-08-13): ...
--
-- SPINE (D-001 / D-052): nothing here touches `submit_rsvp`, `get_ticket`, or
-- `weddings.config_json`. This is a NEW server-owned sidecar table with
-- wrapper RPCs — the D-052 / 090 precedent, never a config key the customer
-- can edit.
--
-- AUDIT-BY-DESIGN (owner ratification #2, 2026-08-13): a bespoke request row
-- is APPEND-ONLY. ...
--
-- ── AUTHORIZATION ─────────────────────────────────────────────────────────
--   READ (get_bespoke_revision_state): ...
--   SUBMIT (submit_bespoke_request): couple-only WRITE. ...
--   CANCEL (cancel_bespoke_request): ...
--   ADMIN LIST (admin_list_bespoke_orders): staff-only (admin_users).
--   ADMIN STATUS (admin_set_bespoke_status): staff-only (admin_users).
--
-- ── THE 7-POINT RPC CONTRACT (D-002), worked ─────────────────────────────
--   1. Envelope: every RPC returns `{success, data}` or `{success, error}`. ...
--   2. Unwrap: see above; Shape 1 (auto-unwrap) holds for all five RPCs.
--   3. RpcMap: five entries added in src/lib/rpc.types.ts (args + response) ...
--   4. Call sites: get_bespoke_revision_state (editor header + badges), ...
--   5. Casts: none around these RPCs; the Zod-validated schemas ... are the cast boundary.
--   6. Reload/restore: the editor's bespoke state hook invalidates on mutation; ...
--   7. Public routes: nothing here renders on /w/:slug ...
--   Then: `npm run check:rpc` must show 0 BROKEN, `npm run check:grants` clean.
--
-- Rollback: 093_bespoke_requests_rollback.sql
-- ============================================================================
```

Table + RLS (`093_bespoke_requests.sql:87-168`, condensed):

```sql
CREATE TABLE public.bespoke_requests (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  wedding_id     uuid        REFERENCES public.weddings(id) ON DELETE CASCADE,
  draft_id       uuid        REFERENCES public.studio_saved_drafts(id) ON DELETE CASCADE,
  section_id     text        NOT NULL CHECK (section_id IN (
                               '__opening', 'hero', 'importantInfo', 'story',
                               'schedule', 'gallery', 'wishes', 'footer'
                             )),
  request_text   text        NOT NULL CHECK (length(btrim(request_text)) BETWEEN 1 AND 2000),
  status         text        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','in_review','completed','cancelled')),
  revision_slot  integer     NOT NULL,
  ...
);
...
ALTER TABLE public.bespoke_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bespoke_requests FROM PUBLIC, anon, authenticated;
```

No table-level `CREATE POLICY` is added — RLS is enabled purely to force `REVOKE ALL` to be
absolute (deny-all with zero policies means literally nobody reads/writes the table directly).
All five RPCs run `SECURITY DEFINER`, e.g.
(`093_bespoke_requests.sql:188-197`):

```sql
CREATE OR REPLACE FUNCTION public.get_bespoke_revision_state(
  ...
)
...
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
```

Grants, at the end of the file (`093_bespoke_requests.sql:776-789`):

```sql
-- ============================================================================
-- 8. Grants — authenticated-only (the 080 pattern), deny anon/PUBLIC
-- ============================================================================
REVOKE ALL ON FUNCTION public.get_bespoke_revision_state(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_bespoke_revision_state(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.submit_bespoke_request(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_bespoke_request(uuid, uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.cancel_bespoke_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_bespoke_request(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_list_bespoke_orders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_bespoke_orders() TO authenticated;

REVOKE ALL ON FUNCTION public.admin_set_bespoke_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_bespoke_status(uuid, text, text) TO authenticated;
```

**`BEGIN`/`COMMIT` usage:** this migration has **no top-level transaction wrapper** — every
`BEGIN` in the file (`093_bespoke_requests.sql:206,355,563,639,712`) is a plpgsql function-body
`BEGIN`, not a SQL transaction `BEGIN`. This is typical for showroom DDL migrations (CREATE
TABLE / CREATE FUNCTION are each individually transactional in Postgres and the whole `.sql`
file is normally applied as one implicit transaction by the migration runner). Contrast with
migration 119, which explicitly calls out "**One transaction.** A partial apply cannot leave a
half-dropped schema" as a deliberate safety property for a multi-statement DROP migration
(`migration-catalog.md`, migration-119 "Safety shape of the file" section) — an explicit
`BEGIN...COMMIT` is reached for when a migration does several independent destructive
statements that must all-or-nothing together, not for ordinary additive DDL.

### 5.2 Rollback (`093_bespoke_requests_rollback.sql`, full file, 54 lines)

```sql
-- Rollback for migration 093: bespoke requests per section.
--
-- Drops the five RPCs and the sidecar table, in dependency order (the RPCs
-- are the only writers; the table has no inbound FKs — nothing references
-- bespoke_requests). Forward file:
-- supabase/migrations/093_bespoke_requests.sql
--
-- ⛔ PRE-FLIGHT (the 090-rollback pattern): ABORT if any request ever reached
-- a RESOLVED terminal state — `completed` OR `shipped`.
--
-- ⚠ `shipped` was added to this abort set 2026-08-15 (fold-2 H15). ...
-- A terminal state added later must be added here too. ...
--   SELECT count(*) FROM public.bespoke_requests
--   WHERE status IN ('completed', 'shipped');
-- If that returns > 0, STOP — the rollback cannot run. ...

DO $$
DECLARE
  v_completed int;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relname = 'bespoke_requests') THEN
    SELECT count(*) INTO v_completed FROM public.bespoke_requests
    WHERE status IN ('completed', 'shipped');
    IF v_completed > 0 THEN
      RAISE EXCEPTION 'rollback 093 ABORTED: % resolved request(s) exist (completed or shipped) — the ledger is the audit trail of spent revisions and cannot be dropped', v_completed;
    END IF;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.admin_set_bespoke_status(uuid, text, text);
DROP FUNCTION IF EXISTS public.admin_list_bespoke_orders();
DROP FUNCTION IF EXISTS public.cancel_bespoke_request(uuid);
-- BOTH overloads (fold-3). 093 created the 4-arg submit; 094 replaced it with
-- a 5-arg one carrying `p_reference_image_url` ...
DROP FUNCTION IF EXISTS public.submit_bespoke_request(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.submit_bespoke_request(uuid, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.get_bespoke_revision_state(uuid, uuid);
DROP TABLE IF EXISTS public.bespoke_requests;
```

Two conventions worth naming: **(a)** the pre-flight guard is a live existence-and-count check
against the target database, not an assumption — it queries `pg_catalog.pg_class` before
querying the table itself, so it degrades gracefully if the table never existed; **(b)** the
`DROP FUNCTION` list is kept current across *later* migrations that changed the function's
signature (the comment explicitly documents that migration 096 re-created the 5-arg overload
that 094 introduced, so the rollback lists both the 4-arg and 5-arg signatures — a rollback
written once at 093-time and *maintained* as later migrations touch the same function).

### 5.3 Test / SQL pin (`test_093_bespoke_requests.sql`, 944 lines — structure, not full text)

Header block states the runbook (`test_093_bespoke_requests.sql:1-14`):

```sql
-- Migration 093 pin: the bespoke-request ledger + the superadmin queue
--
-- Run only AFTER 093 has been applied to the target database.
-- Every fixture write is rolled back; this file writes nothing durable.
--
-- HOW TO RUN
--   psql "$DATABASE_URL" -f supabase/tests/test_093_bespoke_requests.sql
--   (or paste into the SQL editor / MCP execute_sql — it is one transaction)
-- A silent run to the final NOTICE is a PASS; any failed ASSERT or RAISE
-- EXCEPTION is a FAIL and aborts the transaction, so nothing survives either way.
```

Then a "WHAT THIS ACTUALLY PROVES" section maps every RPC × authority tier to its covering
test IDs (T1–T20), followed by a "RUNNABILITY NOTES" section (`:29-73`) that is itself a
convention worth lifting verbatim — it states, as file-local documentation, the four traps the
retrofit skill's G4 gate checks structurally:

1. It inserts into `auth.users` (every identity the RPCs see must exist as a real FK-valid row).
2. It never switches `session_replication_role` to `replica` (fixtures must FK-validate).
3. RPC calls run under `SET LOCAL ROLE authenticated` with `request.jwt.claim.sub` set; table
   assertions run after `RESET ROLE` (every RLS-enabled zero-policy table 42501s a bare SELECT
   inside a role-swapped block). Results cross the boundary via transaction-local GUCs
   (`set_config`/`current_setting`), not variables.
4. Impersonation probes are one statement each (a `STABLE` function's repeated identical-arg
   calls can be planner-folded, hiding a role-swap side effect).
5. Fixture ids are namespaced with the migration number (`093093093...`) so a partial run
   can't collide with production or with another test's fixtures.
6. It ends in `ROLLBACK`.

Skeleton, in execution order (`test_093_bespoke_requests.sql:69-140` for the first three
stages, pattern repeats for the rest of the file):

```sql
BEGIN;

-- ⚠ PIN THE ASSERT MACHINERY ITSELF (test_084 idiom): with
-- `plpgsql.check_asserts = off` every ASSERT becomes a no-op.
SET LOCAL plpgsql.check_asserts = on;

DO $$
BEGIN
  BEGIN
    ASSERT false, 'canary';
    RAISE EXCEPTION 'test_093 SETUP FAILURE: ASSERT did not raise — plpgsql.check_asserts is OFF and every assertion in this file is a no-op.';
  EXCEPTION WHEN assert_failure THEN
    NULL;  -- expected: the machinery works
  END;
END $$;

-- Pre-flight — 093 must actually be applied
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'submit_bespoke_request'
  ) THEN
    RAISE EXCEPTION 'test_093 SETUP FAILURE: submit_bespoke_request missing; 093 is partially applied.';
  END IF;
END $$;

-- Fixtures
INSERT INTO auth.users (id, email) VALUES (...);
INSERT INTO admin_users (user_id, email) VALUES (...);
INSERT INTO weddings (id, slug, template_id, config_json, status) VALUES (...);
INSERT INTO wedding_entitlements (wedding_id, package_tier, payment_state, source) VALUES (...);

-- === T1 etc: role-swap probe, one statement each ===
SELECT set_config('request.jwt.claim.sub', '<uuid>', true);
SET LOCAL ROLE authenticated;
DO $$ ... PERFORM set_config('test093.tN', v_result::text, true); END $$;
RESET ROLE;
DO $$
DECLARE v_result jsonb := current_setting('test093.tN')::jsonb;
BEGIN
  ASSERT v_result #>> '{...}' = '...', format('TN FAIL: ...');
  RAISE NOTICE 'TN PASS — ...';
END $$;

...

DO $$ BEGIN RAISE NOTICE 'test_093 ALL PASS (rolled back — nothing durable written)'; END $$;

ROLLBACK;
```

The final assertion in the file (T20, `test_093_bespoke_requests.sql:900-930`) is the "037
tripwire" — it asserts the success envelope's key set is exactly `ARRAY['data', 'success']`,
i.e. no sibling key was accidentally added that would flip the client's auto-unwrap logic.
This is the RPC contract's point 1/2 (§6) enforced as an executable assertion, not just a
migration-header claim.

### 5.4 Catalog entry — full Migration Detail section

Reproduced in full (`migration-catalog.md:6846-6952`):

```
## Migration Detail — 093 (`093_bespoke_requests.sql`)

**Status: AUTHORED + APPLIED 2026-08-13** (owner's DB protocol: migration → test
pre-apply → apply → rollback → catalog). Plan:
`docs/superpowers/plans/2026-08-13-bespoke-request-per-section.md`.

### What it does

The per-section bespoke-request ledger + the superadmin pending-orders queue
(owner 2026-08-13). Server-owned sidecar, the D-052/090 posture:

- **`bespoke_requests` table** — keyed by EXACTLY one of `wedding_id` (post-
  purchase) / `draft_id` (pre-purchase), enforced by a CHECK. `section_id`
  mirrors the editor registry minus `rsvp` (owner-ratified exclusion — the RSVP
  form never takes bespoke). `status` = pending → in_review → completed, or
  cancelled. **AUDIT-BY-DESIGN:** the row is append-only — text/section/slot
  immutable, only status transitions, `revision_slot` MONOTONIC per tenant
  (max+1, never re-issued — a refunded spend keeps its number).
- **Partial unique index** `uq_bespoke_requests_open_per_section`: one OPEN
  (pending/in_review) request per (tenant, section). Queue index on
  (status, created_at DESC).
- **RLS deny-all + REVOKE ALL**, RPC-only (079/090 posture).
- **Five RPCs** (SECURITY DEFINER, pinned search_path, schema-qualified):
  - `get_bespoke_revision_state(p_wedding_id, p_draft_id)` — READ, couple-or-
    staff. Returns `{tier, cap, used, requests}`. ...
  - `submit_bespoke_request(...)` — couple-only WRITE (staff may NOT submit on
    the couple's behalf). Enforces section eligibility (INVALID_SECTION), the
    cap (`REVISION_LIMIT` when used >= cap), one-open-per-section (traps 23505
    → SECTION_ALREADY_REQUESTED — only that code, so deadlock is never
    laundered), monotonic next slot.
  - `cancel_bespoke_request(p_request_id)` — couple-only, pending-only. ...
  - `admin_list_bespoke_orders()` — staff-only queue READ ...
  - `admin_set_bespoke_status(p_request_id, p_status, p_reviewer_note?)` —
    staff-only. `in_review`/`completed`/`cancelled`; completed/in_review
    PERMANENTLY spend the slot (slot_refunded stays false); ...
- **Grants:** authenticated-only (080 pattern); anon/PUBLIC revoked on all five.
- **Spine untouched** (D-001): no `submit_rsvp`/`get_ticket`/`config_json`
  object is named by a byte of this migration.

### The 7-point RPC contract check (D-002), worked

1. Envelope: every success is exactly `{success, data}` — data the SOLE non-
   `success` key (no 037 sibling-key trap; T20 of the pin asserts the key set).
2. Unwrap: Shape 1 (auto-unwrap) holds for all five (verified per RPC above).
3. RpcMap: five entries added in `src/lib/rpc.types.ts` (args + response) in
   the same commit as the client wiring (plan Slice ②).
4. Call sites: `get_bespoke_revision_state` (editor header + badges),
   submit/cancel (BespokeRequestDialog), admin_list/set_status
   (PendingOrdersSection). Zero pre-existing call sites.
5. Casts: none — Zod response schemas are the cast boundary.
6. Reload/restore: bespoke state hook invalidates on mutation; cold editor
   load re-reads the ledger; dashboard queue invalidates on Mark-complete.
7. Public routes: no guest-route surface; editor + dashboard sit inside their
   existing error boundaries. `npm run check:rpc` 0 BROKEN · check:grants clean.

### Pin — `supabase/tests/test_093_bespoke_requests.sql`

T1 grants (authenticated-only, anon/PUBLIC denied) · T2 RLS on + owner-only
relacl · T3 read signed-out AUTH_REQUIRED · ... · T20 envelope exactly {success,data}.
Executed PRE-apply (harness machinery proven live — canary + pre-flight
detects the un-applied state) and POST-apply (**ALL PASS, 50 assertions across T1–T20**).
auth.users fixtures + role swap + request.jwt.claim.sub per test_090 idiom.

### Rollback — `supabase/rollbacks/093_bespoke_requests_rollback.sql`

Pre-flight ABORT if any `completed` request exists (the ledger is the audit
trail of spent revisions — never silently erased) → five RPCs dropped in
dependency order → table dropped.
```

### 5.5 Changelog entry

Already reproduced in full in §4.3 — the 2026-08-13 "bespoke requests: edit/remove, reference
images, confirm-lock..." entry. Note it is written at the *feature* level (what a couple
sees) rather than the schema level; the catalog entry above is the schema-level twin of the
same shipped change.

---

## 6. RPC contract conventions

### 6.1 The 7-point check (showroom; D-002)

Defined inline in migration headers (e.g. `093_bespoke_requests.sql:50-73`) and repeated as
G2 of the retrofit skill (`migration-retrofit-qa/SKILL.md:80-99`), worked rather than merely
asserted:

1. **SQL envelope shape.** Success `{success, data}`; failure `{success, error}`.
2. **`src/lib/rpc.ts` unwrap.** `data` auto-unwraps only while it is the SOLE non-`success`
   key. Any new top-level sibling key flips the client to pass-through mode — "the 037
   mechanism," named for the incident where migration 037 added a sibling `warnings` key and
   broke every returning-guest client. New fields go **inside** `data` or **inside** `error`,
   never as a new top-level sibling.
3. **`rpc.types.ts` `RpcMap`** — both `args` and `response`, updated in the *same commit* as
   the SQL. New optional args must stay optional while the migration is unapplied (so an
   ahead-of-schema client degrades cleanly).
4. **Every call site.** `grep -rn "<rpc_name>" src/` and enumerate them — zero hits is itself a
   finding (dead RPC), more than expected is also a finding.
5. **Every `as unknown as` cast** around that RPC — named explicitly, or stated there are none.
   This is the compiler-bypass smoking gun for a drifted contract.
6. **Reload / edit / session-restore paths**, not just fresh-submit — migration 037's white
   screen "only surfaced on `restore()`."
7. **Public-route error-boundary coverage** for any new throw point — an unbounded render crash
   on a guest-facing route (`/w/:slug`) is a customer-visible outage.
   Then: `npm run check:rpc` must show **0 BROKEN**, `npm run check:grants` must be clean.

A documented limitation of point 2's tooling: `check:rpc` "walks `{success, error}` envelopes...
an RPC that raises has no envelope to compare, so this path is invisible to the guard" —
recorded as a real gap in `migration-catalog.md` (fold-9 paragraph), not hidden.

### 6.2 Function naming

- **`admin_*`** prefix for staff/admin-only RPCs (`admin_list_bespoke_orders`,
  `admin_set_bespoke_status`, `admin_get_guests`, `admin_upsert_guest`).
- **`submit_*` / `get_*` / `cancel_*`** for the couple-facing verbs
  (`submit_rsvp`, `submit_wish`, `get_ticket`, `get_wishes`, `cancel_bespoke_request`).
- **Leading underscore `_*`** marks an internal helper never meant to be client-callable
  (`_is_wedding_admin`, `_recompute_rsvp_guest_count`, `_archive_and_delete_rsvp`,
  `_normalize_rsvp_archive_snapshot`) — these are `SECURITY DEFINER` helpers used by other
  RPCs, typically with EXECUTE revoked from anon/authenticated entirely since only other
  functions call them (vern's equivalent: `handle_new_user`, `media_assets_after_change`,
  `rebuild_vehicle_media_cache`, `log_admin_action` all have EXECUTE revoked from
  public/anon/authenticated — `vern-vault/supabase/rpcs.md` opening paragraph).
- **`_probe_fn_*`** names in the catalog mark accidentally hand-applied, unauthorized functions
  discovered during a security sweep — a naming pattern to *recognize* as a red flag, not to
  imitate (`migration-catalog.md`, migration-119 detail).

### 6.3 Return shapes

Every public RPC returns exactly one of:
```json
{"success": true,  "data": { ... }}
{"success": false, "error": {"code": "SOME_CODE", ...}}
```
with `data`/`error` as the sole non-`success` key (point 1 of the 7-point check). Error codes
are short SCREAMING_SNAKE strings carried at `error.code`
(`AUTH_REQUIRED`, `ACCESS_NOT_APPROVED`, `REVISION_LIMIT`, `INVALID_SECTION`,
`SECTION_ALREADY_REQUESTED`, `MISSING_REVISION`, `STALE_WRITE`, `DRAFT_NOT_FOUND`,
`ACCESS_REVOKED`). The **no-existence-oracle rule**: an authorization refusal and a
not-found refusal must be byte-identical to an unauthorized caller — tested explicitly (093's
T4: "outsider ACCESS_NOT_APPROVED + no existence oracle (real vs fake id byte-identical)").

### 6.4 Error raising

- Prefer returning `{success:false, error:{code:...}}` from RPCs whenever the caller needs a
  discriminated, catchable failure (the great majority of cases).
- `RAISE EXCEPTION` is reserved for genuine abort conditions inside a write cascade where a
  `RETURN` would let an earlier statement's write commit anyway (plpgsql `RETURN` is not
  rollback) — the catalog's fold-8 entry documents exactly this bug class: a save cascade
  that said "refusing here rolls the whole function back" when a `RETURN` does not roll
  anything back, only `RAISE` does.
- `WHEN OTHERS` handlers must **re-raise** `deadlock_detected` (40P01) rather than swallow it
  into a generic error — "a door under contention will hit it, and laundering it into a
  generic `SERVER_ERROR` turns a retryable conflict into a permanent-looking failure"
  (`migration-retrofit-qa/SKILL.md:130-144`). The skill also carries a **correction**: two other
  error codes previously named alongside `deadlock_detected` were wrong (`query_canceled` is
  never matched by `OTHERS` at all; `serialization_failure` isn't reachable under PostgREST's
  default READ COMMITTED) — the corrected text is left in the skill with the wrong claim struck
  through and explained, a model for how this repo handles its own past mistakes in
  documentation.

---

## 7. RLS policy authoring style

Showroom and vern-vault embody **two different, both-valid RLS postures**; trainos should pick
one deliberately rather than mixing them per-table.

### 7.1 Showroom: RLS-as-lockout, RPC-only (no policies at all)

Every table: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` followed by
`REVOKE ALL ON TABLE ... FROM PUBLIC, anon, authenticated;` and **zero `CREATE POLICY`
statements** (confirmed: `grep -rn "CREATE POLICY" showroom/supabase` returns 0 hits). RLS is
enabled purely so REVOKE ALL is airtight against any future GRANT, not to write row-visibility
predicates. All authorization logic instead lives inside `SECURITY DEFINER` RPCs, gated by
inline checks against `admin_users`/`wedding_admin_users`/entitlement tables. This is
CLAUDE.md's rule 5, "Never allow direct table access from client — RPC-only pattern"
(`CLAUDE.md:65`).

### 7.2 vern-vault: real per-operation RLS policies + helper functions

vern's tables (`profiles`, `vehicles`, `market_listings`, storage buckets) carry actual
`CREATE POLICY` statements, one policy per **operation**, not one combined policy per table.
Confirmed pattern from `tables.md` and the live storage migration:

- **Naming:** a lowercase, space-separated quoted string,
  `"<table/bucket> <audience> <verb/purpose>"`, e.g.
  `"profiles self read"`, `"profiles admin read all"`, `"profiles self update non role"`,
  `"profiles superadmin all"`, `"vehicles public read"`, `"vehicles admin draft write"`,
  `"vehicles superadmin delete"`, `"storage models bucket public read"`,
  `"storage models bucket admin upload"`, `"storage models bucket main_admin delete"`.
- **One policy per operation** is the norm (SELECT/INSERT/UPDATE/DELETE each get their own
  named policy), with an occasional combined `ALL` policy for a superadmin escape hatch
  (`"profiles superadmin all"`).
- **Helper functions gate every policy predicate** — never inline `profiles.role` reads inside
  a policy, because that re-triggers RLS on `profiles` and infinite-recurses
  (`vern-vault/supabase/rpcs.md`, "Authorization helpers" section). The five helpers:
  `current_user_role()`, `is_admin()`, `is_main_admin_or_higher()`, `is_superadmin()`,
  `can_view_analytics()` — all `SECURITY DEFINER`, `STABLE`, `SET search_path = public, pg_temp`,
  and **EXECUTE-granted to both anon and authenticated** ("required so RLS can call them").
  `current_user_role()` reads `profiles.role` once with
  `coalesce((select role from profiles where id = auth.uid() and is_active = true), 'viewer')`
  — inactive or missing profile silently resolves to the lowest role rather than erroring.
- **WITH CHECK vs USING split** for self-service updates that must not allow privilege
  escalation: `"profiles self update non role"` uses `USING (auth.uid() = id)` but
  `WITH CHECK (auth.uid() = id AND role = current_user_role())` — the check pins `role` to its
  value *at read time*, so a self-UPDATE statement cannot smuggle a role change through even
  though the row is otherwise writable.
- **Column-level GRANTs as a second gate below RLS**, not a substitute for it: `authenticated`
  gets table-level SELECT on `profiles` but only *column-level* UPDATE on
  `(display_name, phone_number)` — "a user physically cannot write `role`, `is_active`, `id`,
  or timestamps — the column grant blocks it before RLS" (`tables.md`, profiles section).
- **`anon` habitually keeps default Postgres grants but is blocked entirely by having no
  anon-facing policy** — noted explicitly as an accepted "Hardening TODO" rather than fixed,
  i.e. relying on RLS-with-no-matching-policy as the anon block is a known-acceptable but
  non-ideal state, not a silent gap.
- **Read/write split via facade views**: `vern-vault/supabase/tables.md` states the repo's
  single biggest structural rule up front — "Reads go through VIEWS. Writes go through BASE
  TABLES." `anon`/`authenticated` have **no SELECT** on the raw `vehicles`/`market_listings`
  tables at all; all reads go through `public_vehicles`/`admin_vehicles`/
  `public_market_listings`/`admin_market_listings`, which are owner-rights (effectively
  `SECURITY DEFINER`) views with their own `WHERE` filter baked into the view body, and which
  intentionally trip the `security_definer_view` advisor ERROR — a *documented accepted
  finding*, not an oversight (`tables.md`, Advisor Dispositions section: "INTENTIONAL /
  accepted... switching them to `security_invoker` would make anon reads hit the revoked
  base-table SELECT and break all public reads"). Writes still hit the base table, gated by
  its own RLS policies, and the views themselves had their write grants (INSERT/UPDATE/DELETE)
  explicitly revoked after an audit finding that they were auto-updatable and bypassed RLS
  (`facade_view_write_revoke` migration, `tables.md` Applied Migrations table).
- **Storage policies follow the same one-policy-per-operation, helper-gated shape** on
  `storage.objects`, scoped by `bucket_id = '<bucket>'` in every predicate — full example in
  §11 (models bucket migration + rollback).

### 7.3 Service-role, anon, authenticated handling

- **service_role** is used sparingly and explicitly documented when it is the sole legitimate
  writer, e.g. vern's `lead_alert_outbox` table grants `service_role` explicit access and its
  webhook-invoking trigger authenticates outward with a shared secret, never a Supabase JWT
  (`vern-vault/supabase/config.toml:6-12` disables `verify_jwt` for exactly this reason,
  because the platform's default JWT check would 401 the webhook before the function's own
  secret check runs).
- **anon** is treated as hostile-by-default in both repos: showroom revokes it from every
  table outright; vern minimizes it to an enumerated allowlist (`SELECT(app_config + 4 views)`
  + `INSERT(analytics_events, market_leads)`, per the `anon_grant_minimisation` migration in
  `tables.md`'s Applied Migrations table) and separately tracks, in the migration catalog
  (showroom) or the RPC doc (vern), the **complete set of anon-executable function names** as
  a pinned invariant checked by both a SQL test (`test_065_grant_hygiene.sql`) and a JS script
  (`scripts/check-grants.mjs`) that must agree with each other and with the migration's own
  allowlist — a three-way "allowlist must match everywhere" rule.
- **authenticated** is the default grantee for RPCs (`GRANT EXECUTE ... TO authenticated`), but
  authorization *within* authenticated is still enforced per-RPC by an inline auth check
  (`admin_users` lookup, ownership check, entitlement check) — being `authenticated` is
  necessary but never sufficient.

---

## 8. `tables/` documentation format (showroom) vs `tables.md`/`triggers.md` (vern)

Showroom's `tables/` directory format is covered in §2.4. vern's single-file equivalents:

### 8.1 `tables.md` (46,698 bytes, one file for the whole schema)

- **Header states its own authority and freshness**: "Source of truth is the LIVE database
  (project `gfomtcbyoueoofesztjr`), reconciled against it on 2026-05-21... where it disagrees
  with the live DB, the live DB wins (divergences are flagged inline)" (`tables.md:1`).
- **Status key convention**: `[design]` not yet in Supabase · `[active]` live in prod ·
  `[deprecated]` pending removal — applied as a bracketed tag after every table/trigger/RPC
  heading.
- **One `##` section per table**, each with: a one-line purpose sentence, a markdown column
  table (`Column | Type | Constraints | Notes`), a prose list of "Other CHECK constraints
  (live)" separate from the column table for constraints that don't map to one column, a
  "Current data" snapshot (row counts, breakdown by status/kind, as of the reconciliation
  date), an "Indexes (live names)" line, and a **"RLS policies (live)"** bullet list plus a
  **"GRANT / read-write contract"** prose paragraph that states plainly what each role can and
  cannot do, including known gaps ("anon: holds full table grants... but every operation is
  blocked by RLS... Hardening TODO #1").
- **A dedicated "⚠️ Read/Write Contract (Facade Model) — READ THIS FIRST" section at the very
  top** (`tables.md:11-21`) states the repo's #1 cross-cutting rule before any per-table detail,
  including a named consequence: "never request `return=representation` on a write to
  vehicles / market_listings" (because those tables have no SELECT grant, a `.select()` chained
  onto a write 403s).
- **A "Safe Read Facades" section** documenting the four SECURITY DEFINER views as the public
  read API, with a table of `View | Audience | WHERE filter | Columns`.
- **An "Applied Migrations & Data Ops (live)" section** — effectively vern's mini version of
  showroom's migration catalog, but folded into the tables doc rather than kept separately,
  with one row per applied migration version + name + "what it did (verified present)", plus a
  separate bulleted list for **data operations applied outside the migration system**
  (`execute_sql` calls not tracked by `list_migrations`) — explicitly flagged so a reader
  doesn't assume `list_migrations` is a complete history.
- **An "Advisor Dispositions (decided — do not re-litigate)" section** — every
  `get_advisors()` finding is recorded with an explicit disposition (accepted / deferred /
  fixed) and the reasoning, so a future session doesn't re-raise a already-adjudicated warning.

### 8.2 `triggers.md` (9,341 bytes)

Same status-key convention and live-reconciliation header. One `##` section per trigger (named
by its live trigger name, not a generic label), each with a `Field | Value` table:
`Live trigger name(s)`, `Table`, `Event / level`, `Function` (with its security mode inline),
`Purpose` — plus free prose below the table for anything non-obvious (e.g. the
`media_assets_cache_rebuild` section notes it handles `vehicle_id` reassignment by refreshing
*both* the old and new vehicle's caches, and states which functions have EXECUTE revoked and
why).

Showroom has no standalone `triggers.md`; trigger definitions live inline inside the relevant
migration file and are described in that migration's catalog Detail section instead.

---

## 9. Seeds: format and execution

Showroom seeds (`showroom/supabase/seeds/`):
- **Idempotent, re-runnable INSERTs**, typically `INSERT ... ON CONFLICT ... DO UPDATE` or
  explicit UPDATE-in-place framing. `qa-rick-unity-seed.sql`'s header states this directly:
  "Idempotent: re-running this file UPDATES the row in place. Safe to iterate the config_json
  without first wiping."
- **Header comment block** states: what the fixture is for, the slug/URL to hit it at, the
  fixed UUID used (chosen for memorability — `c137c137-c137-4c13-8c13-7c137c137c13` for a
  Rick-and-Morty-themed QA wedding), and the exact run command:
  `psql "$DATABASE_URL" -f supabase/seeds/qa-rick-unity-seed.sql`.
- **Companion wipe file** for fixtures meant to be reset without deleting the row entirely:
  `qa-rick-unity-wipe.sql` alongside `qa-rick-unity-seed.sql`.
- **Batch-numbered companion files** for bulk fixture data belonging to one scenario:
  `qa-rick-unity-guests-01-citadel-of-ricks.sql` through `-10-birdperson-avian.sql`, each a
  themed slice of guest rows for the same seeded wedding.
- **Dated seeds pair with a dated rollback**, not a numbered migration (see §2.3) — these are
  content operations for a specific live tenant, run once and rolled back via their paired
  `rollbacks/YYYY-MM-DD..._rollback.sql` file if reverted.
- **Execution**: manual, via `psql -f` or pasted into the Supabase SQL editor / MCP
  `execute_sql` — seeds are never part of the numbered migration sequence and are not applied
  by a migration runner.

vern seeds (`vern-vault/supabase/seed/vehicles.sql`): a single seed file, referenced in
`tables.md`'s "Data ops" list as producing "19 vehicles (`source_kind='seed_fallback'`...)" —
confirms seeds are tracked in the live-state doc even though they bypass `list_migrations`.

---

## 10. Tests: format, execution, the "SQL pin" concept

- **Format: plain SQL, not pgTAP.** No `pgtap` extension usage found in either repo (no
  `plan(`, no `ok(`, no `results_eq(` calls). Tests are hand-written plpgsql `DO $$ ... END $$`
  blocks using the built-in `ASSERT` statement plus `RAISE NOTICE` for pass messages and
  `RAISE EXCEPTION` for failure/setup-failure messages.
- **The "SQL pin" concept**, as named throughout the catalog and the retrofit skill: a pin is a
  test file that is *executed against a real database* (not just authored and trusted) both
  before and after a migration applies, to prove the defect existed pre-apply (RED) and is
  fixed post-apply (GREEN). "An authored pin that was never run is not a pin"
  (`migration-retrofit-qa/SKILL.md:19`) — the skill's own motivating incidents (test_073,
  test_074, test_075) are all pins that were written but never executed, and turned out to be
  unrunnable when someone finally tried.
- **Runnability is checked as its own gate (G4)**, not assumed, because of four specific traps
  (detailed in §5.3's "RUNNABILITY NOTES" reproduction): FK dependency on real `auth.users`
  rows, RLS 42501s inside a role-swapped block, planner-folding of repeated STABLE-function
  impersonation probes, and the file must end in `ROLLBACK` so no fixture survives.
- **Execution protocol (G6)**, verbatim order (`migration-retrofit-qa/SKILL.md:200-216`):
  1. Verify the target project first (multiple Supabase accounts exist; check `list_projects`
     shows the expected project ref before any DB call).
  2. Execute the pin against the target — it ends in `ROLLBACK` so nothing durable is written.
  3. Read the result — a pin that errored on its own fixtures has tested nothing.
  4. Only then apply the migration.
  5. Re-run the pin post-apply and read it again.
  6. Structural verify off `pg_proc` directly: overload count, `prosecdef`, `proconfig`
     search_path, and anon/PUBLIC/authenticated EXECUTE — not from reading the DDL text.
  "Applying is a user-authorized action. Confirm before the first write unless the user has
  explicitly said to apply."
- **One test file can cover multiple migrations** reviewed as a batch
  (`test_098_100_101_rollback_later_gate_preflight.sql`).
- **A canary-first pattern** is standard: the very first `DO $$` block in a pin deliberately
  triggers `ASSERT false` inside a nested exception handler to prove `plpgsql.check_asserts`
  is actually `on` in the session before trusting any subsequent assertion
  (`test_093_bespoke_requests.sql:74-82`, called "the test_084 idiom").

---

## 11. Edge functions

### 11.1 showroom (`showroom/supabase/functions/`)

```
functions/
  .deployed-state.json         tracks last-deployed version per function
  _shared/
    cors.ts                    shared CORS header helper
    checkoutGate.ts            shared checkout-authorization helper
  create-studio-checkout/index.ts
  finalize-studio-checkout/index.ts
  stripe-webhook/index.ts
  wa-topup-checkout/index.ts
  whatsapp-send/index.ts
  whatsapp-webhook/index.ts
```

- One directory per function, `index.ts` as the entrypoint — standard Supabase Edge Function
  (Deno) layout.
- `_shared/` holds cross-function code (`cors.ts` for CORS headers used by every function,
  `checkoutGate.ts` for the checkout-authorization logic shared between
  `create-studio-checkout` and `finalize-studio-checkout`).
- `.deployed-state.json` at the `functions/` root is a deploy-tracking file — a lightweight
  local record of what was last pushed, functioning as the repo's deploy check rather than a
  CI-driven one (no CI YAML was examined per the task's stated non-goal).
- No per-function `CONTRACT.md`/`README.md`/`lib.test.ts` split was found in showroom — that
  richer per-function documentation pattern comes from vern (below).

### 11.2 vern-vault (`vern-vault/supabase/functions/`) — richer per-function docs + tests

```
functions/
  lead-photo-doorman/
    .env.example
    CONTRACT.md      <- authoritative request/response contract, treated as the interface
    README.md
    index.ts
    lib.ts           <- pure logic, importable and testable
    lib.test.ts       <- unit tests for lib.ts
  send-lead-alert/
    .env.example
    README.md
    index.ts
    lib.ts
    lib.test.ts
```

- **`CONTRACT.md` per function** (present for `lead-photo-doorman`) is described as
  authoritative: "the UI (F6 'Add photos' on `LeadSuccess`) builds against. Backend and UI
  agents both treat this file as the interface" (`CONTRACT.md:1-4`). It documents: the
  endpoint URL (prod + local), auth posture (`verify_jwt = false` and why — a per-lead upload
  token, not a Supabase JWT), a client-side prerequisite code snippet (how the caller must mint
  IDs before calling), a request-shape table (`FormData` fields, types, required/notes,
  server-side constraints), a worked request example, and a full response contract table
  (status code → shape → meaning) including a 401 that is **deliberately uniform** between "not
  found" and "token mismatch" ("does not reveal which" — the same no-oracle rule as §6.3's RPC
  error codes, applied here to an Edge Function instead of an RPC).
- **`lib.ts` / `lib.test.ts` split**: business logic lives in a plain, framework-free `lib.ts`
  so it can be unit-tested without spinning up Deno's HTTP server; `index.ts` is the thin
  `serve()` wrapper that wires `lib.ts` to the request/response cycle.
- **`.env.example`** per function documents required secrets/env vars without committing real
  values.
- **Deploy check**: `config.toml`'s `[functions.<name>]` blocks are the deploy-time
  configuration surface — see §12. No separate CI deploy-check script was found in the vern
  repo; the `verify_jwt` setting itself functions as the safety check that a function
  authenticating by its own means doesn't accidentally inherit the platform's default JWT gate.

### 11.3 The Obsidian "working edge functions" note

File: `/Users/khumeren/Obsidian/Radiant/Main/Projects/working-edge-functions.md`. This note
does **not** document a wedding/vehicle-inventory function — it is a single fenced code block
containing a full Deno Edge Function for an unrelated finance-tracker app (OCR + AI-parsing of
receipts via Mistral and OpenRouter). Read in full; it is best understood as a generic
"verified-working Edge Function shape" reference kept for its **mechanics**, not its domain
logic:
- `serve()` from `https://deno.land/std@0.168.0/http/server.ts`, imports pinned to exact
  versions via `esm.sh`.
- Explicit `OPTIONS` preflight short-circuit returning a bare `'ok'` with CORS headers before
  any other logic.
- A single outer `try { ... } catch (error) { ... }` wrapping the whole handler, returning a
  `{success:true, ...}` / `{success:false, error, details}` JSON shape on the happy/error paths
  respectively — the same `{success, ...}` envelope convention as the Postgres RPCs (§6.3),
  applied at the Edge Function layer too.
- Heavy inline `console.log`/emoji-prefixed diagnostic logging at every step — useful for this
  note's stated purpose (debugging a flaky OCR/AI pipeline) but **not** the style used in
  showroom's or vern's actual committed functions, which have no such logging. **Do not copy
  the logging verbosity or the emoji-prefixed log style into trainos** — treat this note purely
  as a reference for the `serve()`/CORS/try-catch skeleton, not as a style example.

---

## 12. `config.toml` (vern-vault) — full contents

`vern-vault/supabase/config.toml`, 20 lines, reproduced in full:

```toml
# Supabase CLI config. Minimal on purpose — this project is managed mostly via
# the dashboard/MCP; only the keys we need to override from defaults live here.
# Unspecified keys fall back to the CLI defaults.
project_id = "gfomtcbyoueoofesztjr"

# send-lead-alert is invoked by a Database Webhook that authenticates with our
# own `x-webhook-secret` header, NOT a Supabase JWT. Edge Functions default to
# verify_jwt = true, which would 401 the webhook BEFORE our handler runs. Turn
# it off here (the function enforces the shared secret itself). Equivalent to
# deploying with `--no-verify-jwt`.
[functions.send-lead-alert]
verify_jwt = false

# lead-photo-doorman is called directly from the public marketing site by an
# anonymous seller who has NO Supabase session — it authenticates each request
# against a per-lead upload token (hashed at rest), not a JWT. verify_jwt must be
# OFF or the platform 401s the anonymous caller before our handler runs.
# Equivalent to deploying with `--no-verify-jwt`. See functions/lead-photo-doorman.
[functions.lead-photo-doorman]
verify_jwt = false
```

Convention to lift: **`config.toml` is kept deliberately minimal** ("Unspecified keys fall
back to the CLI defaults") and every non-default key carries a comment explaining *why* the
override exists, tied to a specific function's authentication model — not a blanket
`verify_jwt = false` applied carelessly. Showroom has no equivalent `config.toml` in the
directories examined (not found under `showroom/supabase/`).

---

## 13. The `migration-retrofit-qa` skill — gate steps, in order

Full skill: `/Users/khumeren/.claude/skills/migration-retrofit-qa/SKILL.md` (236 lines).
Summary of the gate, in the order it runs:

1. **G0 — The four artifacts.** Confirm forward SQL, rollback, SQL pin, and catalog entry all
   exist before reviewing anything else; report which are missing rather than reviewing a
   partial set. The catalog update is a same-commit hard rule. The rollback must reproduce the
   prior function body in full, never by reference to another file.
2. **G1 — Retrofit or bolt-on.** Answer with `git diff` evidence, not stated intent: diff the
   "spine" paths (`src/shared/config`, `src/shared/context`, `src/shared/schemas`,
   `src/features/rsvp`, `src/features/wishes`, `src/pages/Runtime*`) against the migration's
   SQL for spine object names (`submit_rsvp`, `get_ticket`, `weddings.config_json`, `rsvps`).
   A retrofit's spine diff must be empty. New per-tenant capability is a sidecar table + a
   wrapper RPC calling the unmodified spine + a config gate — never a column or branch bolted
   onto the spine. If a migration re-creates an existing function, "byte-unchanged" must become
   an enforced `$verify$` assertion or SQL pin, not a review comment.
3. **G2 — The 7-point RPC contract check, worked.** All seven points from §6.1, each with
   inline evidence in the migration header, plus `npm run check:rpc` (0 BROKEN) and
   `npm run check:grants` (clean).
4. **G3 — The traps that have actually bitten this repo**, checked explicitly every time:
   overload creation via `CREATE OR REPLACE` on a changed argument list (PGRST203 — drop the
   old signature first, assert `count(*)=1`); deploy order (PGRST202 — migration always before
   frontend); security posture asserted structurally off `pg_proc`/`has_function_privilege`,
   not read off the DDL text; authorization decided before any branch that could leak data
   through an error payload; cross-tenant and not-found errors byte-identical; parent-row lock
   before child-table lock; any compare-and-set reads the compared value *inside* the lock;
   `WHEN OTHERS` re-raises `deadlock_detected` rather than swallowing it (with the
   corrected/struck-through history of which other codes do *not* need naming, see §6.4);
   `array_length` vs `unnest`/`array_ndims` for multi-dimensional array caps.
5. **G4 — The SQL pin must be runnable.** Checked by reading, then by running: `auth.users` FK
   dependencies satisfied by fixtures; role-swap discipline (`SET LOCAL ROLE authenticated`
   for calls, `RESET ROLE` before table assertions, GUCs to cross the boundary); impersonation
   probes as one statement each (STABLE-function planner folding hazard); the file ends in
   `ROLLBACK`.
6. **G5 — The D-012 dual adversarial review.** Both reviewers dispatched in one message so they
   run concurrently: (a) a "thermonuclear" subagent applying the
   `thermo-nuclear-code-quality-review` skill to the migration, rollback, pin, and TS wiring;
   (b) Codex `gpt-5.6-sol`/xhigh via `/codex:rescue`, briefed to trace every consumer of the
   touched RPC, every prior definition of the function, the rollback's fidelity, and whether
   the change is additive against the live surface. Both must land; CRIT/HIGH findings are
   triaged and fixed before apply; a review is evidence to verify against source, not an
   automatic verdict (two reviews have contradicted each other in this repo, and one was
   wrong). If Codex is quota-blocked, say so plainly, run thermo alone, and record Codex as
   OWED rather than substituting a dummy verdict.
7. **G6 — Run the test before applying.** The six-step protocol reproduced in full in §10:
   verify the target project, execute the pin (it ends in ROLLBACK), read the result, only then
   apply, re-run the pin post-apply and read it again, then a structural verify off `pg_proc`.
   Applying is a user-authorized action requiring explicit confirmation.

**Report format**, verbatim template (`migration-retrofit-qa/SKILL.md:222-233`):

```
MIGRATION NNN — <slug>
G0 artifacts      forward ✓  rollback ✓  pin ✓  catalog ✓
G1 retrofit       RETROFIT | BOLT-ON — <the git evidence>
G2 contract       7/7 worked · check:rpc 0 BROKEN · check:grants clean
G3 traps          <each named, or the one that fired>
G4 pin runnable   <auth.users ✓ · role discipline ✓ · one-statement probes ✓>
G5 dual review    thermo <verdict> · codex <verdict> — <disjoint findings>
G6 executed       <NOT RUN | run against <project> — result>
VERDICT           READY TO APPLY | BLOCKED — <what has to change>
```

Never report READY while any artifact is missing, any CRIT/HIGH is unfolded, or the pin has not
been executed and read.

---

## 14. Template pack for trainos

Copy-ready skeletons. Replace `NNN`, `<slug>`, `<Description>` and table/RPC names. These
follow showroom's RPC-only/deny-all posture (§7.1); if trainos instead adopts vern's
per-operation-RLS posture, swap the "Grants" section for `CREATE POLICY` statements per §7.2's
template further below.

### 14.1 Forward migration header

```sql
-- ============================================================================
-- Migration NNN: <slug> — <one-line description of the change>.
-- ============================================================================
--
-- <DEFECT or FEATURE, one paragraph: what's missing/broken and what this adds.>
--
-- SPINE: nothing here touches <name the config-backed/core spine objects for
-- trainos, e.g. the pipeline-stage engine, the primary record tables>. This is
-- a NEW server-owned sidecar table with wrapper RPCs, OR: this migration
-- modifies the spine — justification: <explicit reason, reviewed>.
--
-- ── AUTHORIZATION ─────────────────────────────────────────────────────────
--   READ  (<rpc_name>): <who may call it, and what an unauthorized caller gets>
--   WRITE (<rpc_name>): <who may call it, and what it enforces>
--
-- ── THE 7-POINT RPC CONTRACT CHECK, worked ───────────────────────────────
--   1. Envelope: every RPC returns {success, data} or {success, error}.
--   2. Unwrap: <state whether any new field could add a sibling key>.
--   3. RpcMap: <N> entries added in <the frontend RPC-types file> in this commit.
--   4. Call sites: <list every grep hit, or "none — new RPC">.
--   5. Casts: <name every `as unknown as`/equivalent cast, or "none">.
--   6. Reload/restore: <which reload/restore paths were checked>.
--   7. Public routes: <which public routes could hit a new throw point>.
--   Then: run the RPC-contract check script; it must show 0 BROKEN.
--
-- Rollback: rollbacks/NNN_<slug>_rollback.sql
-- ============================================================================

CREATE TABLE public.<table_name> (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ... columns ...
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.<table_name> ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.<table_name> FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.<rpc_name>(<args>)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
BEGIN
  -- auth check FIRST, before any branch that could leak data via an error payload
  -- return jsonb_build_object('success', true, 'data', ...);
  -- or:    return jsonb_build_object('success', false, 'error', jsonb_build_object('code', '...'));
END;
$$;

-- ============================================================================
-- Grants — authenticated-only, deny anon/PUBLIC
-- ============================================================================
REVOKE ALL ON FUNCTION public.<rpc_name>(<argtypes>) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.<rpc_name>(<argtypes>) TO authenticated;
```

### 14.2 Rollback header

```sql
-- Rollback for migration NNN: <slug>.
--
-- Drops <what> in dependency order. Forward file:
-- migrations/NNN_<slug>.sql
--
-- ⛔ PRE-FLIGHT: ABORT if <the condition that would make this destructive to
-- real data — e.g. any row reached a terminal/resolved state>.
--   SELECT count(*) FROM public.<table_name> WHERE <resolved-state predicate>;
-- If that returns > 0, STOP.

DO $$
DECLARE
  v_blocking int;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relname = '<table_name>') THEN
    SELECT count(*) INTO v_blocking FROM public.<table_name> WHERE <resolved-state predicate>;
    IF v_blocking > 0 THEN
      RAISE EXCEPTION 'rollback NNN ABORTED: % blocking row(s) exist', v_blocking;
    END IF;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.<rpc_name>(<argtypes>);
-- list EVERY signature that has ever existed for this function name, not just
-- the one this migration created — later migrations may have added overloads.
DROP TABLE IF EXISTS public.<table_name>;
```

### 14.3 Test skeleton

```sql
-- ============================================================================
-- Migration NNN pin: <slug>
--
-- Run only AFTER NNN has been applied to the target database.
-- Every fixture write is rolled back; this file writes nothing durable.
--
-- HOW TO RUN
--   psql "$DATABASE_URL" -f tests/test_NNN_<slug>.sql
-- A silent run to the final NOTICE is a PASS; any failed ASSERT or RAISE
-- EXCEPTION is a FAIL and aborts the transaction, so nothing survives either way.
--
-- RUNNABILITY NOTES
-- 1. Inserts real auth.users rows for every identity the RPCs see (FK-required).
-- 2. RPC calls run under SET LOCAL ROLE authenticated with
--    request.jwt.claim.sub set; table/catalog assertions run after RESET ROLE.
--    Results cross the boundary via transaction-local GUCs (set_config /
--    current_setting), never plpgsql variables held across the role swap.
-- 3. Impersonation probes are ONE STATEMENT EACH — a STABLE function's
--    repeated identical-argument calls can be planner-folded.
-- 4. Fixture ids are namespaced with the migration number so a partial run
--    collides with nothing.
-- 5. It ends in ROLLBACK.
-- ============================================================================

BEGIN;

SET LOCAL plpgsql.check_asserts = on;
DO $$
BEGIN
  BEGIN
    ASSERT false, 'canary';
    RAISE EXCEPTION 'test_NNN SETUP FAILURE: ASSERT did not raise — plpgsql.check_asserts is OFF.';
  EXCEPTION WHEN assert_failure THEN
    NULL;
  END;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = '<rpc_name>'
  ) THEN
    RAISE EXCEPTION 'test_NNN SETUP FAILURE: <rpc_name> missing; NNN is partially applied.';
  END IF;
END $$;

-- Fixtures
INSERT INTO auth.users (id, email) VALUES ('<uuid>', 't<NNN>-user@example.invalid');
-- ... domain fixtures ...

-- === T1: <what it proves> ===
SELECT set_config('request.jwt.claim.sub', '<uuid>', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_result jsonb;
BEGIN
  v_result := public.<rpc_name>(<args>);
  PERFORM set_config('testNNN.t1', v_result::text, true);
END $$;
RESET ROLE;
DO $$
DECLARE v_result jsonb := current_setting('testNNN.t1')::jsonb;
BEGIN
  ASSERT v_result #>> '{success}' = 'true', format('T1 FAIL: %s', v_result);
  RAISE NOTICE 'T1 PASS — <what it proved>';
END $$;

-- === final tripwire: success envelope has exactly {success,data} ===
-- (repeat the set_config/RESET ROLE pattern, then:)
-- ASSERT (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_result) AS k)
--        = ARRAY['data', 'success'], format('TN FAIL: sibling key present: %s', v_result);

DO $$ BEGIN RAISE NOTICE 'test_NNN ALL PASS (rolled back — nothing durable written)'; END $$;

ROLLBACK;
```

### 14.4 Catalog row + Detail section

Migration Order table row:

```
| NNN | `NNN_<slug>.sql` | **<One-sentence bold summary of what shipped and why, with the date.>** <Paragraph: what was added, key design decisions, cap/tier/authority model if any.> Spine untouched (or: touches spine — justification). |
```

Migration Detail section:

```
## Migration Detail — NNN (`NNN_<slug>.sql`)

**Status: AUTHORED + APPLIED YYYY-MM-DD** (or AUTHORED, NOT APPLIED). Plan: `<path to design doc, if any>`.

### What it does

- **<object 1>** — <what it is, key constraints, why>.
- **<RPC 1>(<args>)** — <who may call it, what it enforces, what it returns>.
- **Grants:** <authenticated-only | anon-callable and why>.
- **Spine untouched (<decision ref>):** no <spine object> is named by a byte of this migration.

### The 7-point RPC contract check, worked

1. Envelope: ...
2. Unwrap: ...
3. RpcMap: ...
4. Call sites: ...
5. Casts: ...
6. Reload/restore: ...
7. Public routes: ...

### Pin — `tests/test_NNN_<slug>.sql`

T1 <...> · T2 <...> · ... Executed PRE-apply (<result>) and POST-apply (<result>).

### Rollback — `rollbacks/NNN_<slug>_rollback.sql`

<Pre-flight guard, if any> → <drop order>.
```

### 14.5 Changelog entry

```
## YYYY-MM-DD — <short summary of the shipped change, product-facing>

### Added
- **<Bold lead phrase, user-visible>.** <Plain-prose detail of what changed and why it matters
  to the user.> (`<short-hash>`)

### Changed
- **<Bold lead phrase>.** <Detail, including which migration/RPC this depended on.> (ADR-NNN, `<short-hash>`)

### Security
- **<Bold lead phrase>.** <What was tightened/removed and the invariant it restores.> Migration NNN, applied as `<version>`. (`<short-hash>`)
```

### 14.6 RLS policy (if trainos adopts the vern per-operation style instead of RPC-only)

```sql
-- Helper (SECURITY DEFINER, STABLE, search_path pinned, EXECUTE to anon+authenticated
-- so RLS policies can call it):
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT current_user_role() IN ('admin', 'main_admin', 'superadmin');
$$;

ALTER TABLE public.<table_name> ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "<table_name> self read" ON public.<table_name>;
CREATE POLICY "<table_name> self read"
  ON public.<table_name> FOR SELECT
  USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "<table_name> admin read all" ON public.<table_name>;
CREATE POLICY "<table_name> admin read all"
  ON public.<table_name> FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "<table_name> self update non role" ON public.<table_name>;
CREATE POLICY "<table_name> self update non role"
  ON public.<table_name> FOR UPDATE
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id AND <privileged_column> = <its own current value>);
```

---

## What I could NOT verify

- **Exact live enforcement of `npm run check:rpc` / `check:grants` output** for any migration
  — I read the scripts' names and call sites (`package.json:15-16,21`) but did not execute them;
  all "0 BROKEN"/"clean" claims quoted above are from the catalog's own narrative, not
  independently re-run.
- **Whether `search_path` in `CLAUDE.md:61` (`public, extensions`) is a genuine drift or just
  informal shorthand for the four-schema form used in migrations.** I flagged it as drift in
  §1 because the literal strings differ, but I could not find a commit or note explicitly
  reconciling the two; treat my flag as an observation, not a confirmed inconsistency the repo
  itself has acknowledged.
- **Whether showroom has ever used `CREATE POLICY` anywhere outside what a grep can see** —
  confirmed zero hits repo-wide at the time of this research, but the repo is large (7,900+
  line catalog, 100+ migrations) and I did not open every migration file individually.
- **The full 96 KB+ of migration-catalog.md narrative** — I read the header, table of contents
  structure, the full migration-093 Detail section, and large adjacent excerpts (093–107 batch,
  119's full detail), but did not read all 119 migrations' Detail sections line by line; other
  migrations may show additional conventions (e.g. a different rollback-guard shape) not
  captured here.
- **vern-vault's `migrations/scratchpad.md`, `scratchpad-v3.sql`, and `scratchpad-lead-photo-doorman.sql`** —
  named in `tables.md` as containing draft/sanitised SQL (including a placeholder-secret
  version of a webhook migration deliberately kept out of the real migrations folder), but I
  did not open these files; I cannot confirm their internal format matches the numbered
  migration convention or diverges from it.
- **Whether vern-vault has its own equivalent of showroom's `migration-retrofit-qa` skill or
  relies on the same shared one** — the skill directory examined
  (`~/.claude/skills/migration-retrofit-qa/`) is user-global, not repo-scoped, and its own text
  cites showroom-specific paths (`src/shared/config`, `src/features/rsvp`) exclusively; I found
  no vern-specific equivalent and did not search vern's repo root for a `CLAUDE.md` or
  `.claude/skills/` directory beyond the `supabase/` folder itself (none exists at
  `vern-vault/supabase/CLAUDE.md`, confirmed empty grep result).
- **CI YAML internals and the guardrail script bodies** (`scripts/rpc-contract-check.js`,
  `scripts/check-grants.mjs`, `tools/sql-lint.mjs`) — explicitly out of scope per the task's
  non-goals; I only confirmed their existence and `package.json` invocation, not their logic.
- **The Obsidian note's relationship to any actual trainos or showroom/vern decision** — it
  reads as a personal reference snippet with no visible link to either repo's conventions
  beyond the shared `{success, error}`-style envelope shape; I could not find any commit,
  changelog entry, or CLAUDE.md rule that cites this note by name, so its authority level
  relative to the two repos' actual committed edge functions is unclear beyond what I stated
  in §11.3.
