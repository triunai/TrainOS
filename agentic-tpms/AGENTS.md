# agentic-tpms — working conventions

Single-tenant Training Provider Management System for HRD Corp SBL-Khas
operators. Design language forked from TrainOS (read-only reference at the
repo root); this folder is independent and never edits TrainOS files.

## Stack
Next.js 14 App Router · React 18 · Tailwind 3 (TrainOS tokens) · Drizzle ORM
over node-postgres · PostgreSQL 16 + pgvector + pgcrypto (Supabase-ready) ·
Univer (headless formula engine + browser canvas) · pdf-lib · jose · Vitest ·
Python FastAPI extraction service (services/paddleocr).

## Rules
1. **SQL is the source of truth.** `db/migrations/NNNN_*.sql` + a rollback in
   `db/rollbacks/NNNN_*.down.sql`, applied by `npm run db:migrate`. Never edit
   an applied migration (the runner refuses checksum drift) — add a new one.
   `src/server/db/schema.ts` is the Drizzle mirror; a test asserts parity.
2. **Everything lives in the `tpms` schema.** Raw SQL always writes
   `tpms.table_name` (a Supabase transaction pooler ignores search_path).
3. **Package state moves only through `src/server/fsm/service.ts`.** The DB
   refuses any `training_packages` UPDATE without actor/reason context and
   any stage change not in `fsm_transitions`. Use `withTx(actor, {reasonCode})`.
4. **Agents propose, humans and rules dispose.** No transition accepts an
   `AGENT` actor. LLM output lands in drafts, quotations or decisions.
5. **A refusal is not a failure (R2).** Throw `DomainError(code, message)` for
   policy refusals; server actions return `ActionResult`. Never retry them.
6. **R14 — reject unknown values.** Exhaustive maps, `raise` on unknown enums.
7. **Money** is NUMERIC strings at the edge, integer sen in arithmetic
   (`src/lib/money.ts`). **Dates** are `YYYY-MM-DD` strings (`src/lib/dates.ts`).
8. **PII**: NRIC is HMAC-hashed (`identityHash`), pgcrypto-encrypted
   (`encryptIdentitySql`) and masked `******-**-1234`. Never log or render raw.
9. **Colours** come from `src/styles/tokens.css` via Tailwind token classes.
   No hex, no rgba() in components. Status colour lives on chips only.
10. **Tests hit real Postgres.** `useTestDatabase()` rebuilds the database named
    by `TEST_DATABASE_URL`; parallel lanes each use their own database.
11. **RSC boundaries.** A `"use client"` module exports only components;
    constants and helpers it shares with server code live in a server-safe
    file beside it (`shell/theme.ts`, `kit/buttonStyles.ts`,
    `finance/tones.ts`). Never pass a plain function prop from a server
    component to a client one; server actions are fine. Pass domain results
    through `plain()` first.
12. **Date text is deterministic.** Format dates only with `src/lib/dates.ts`.
    It takes numbers from `Intl` and words from fixed tables, because Node and
    Chromium ICU disagree ("Sept" vs "Sep") and a mismatch breaks hydration.
13. **Shared idempotency keys live in `src/server/queue/keys.ts`.** A key
    that two modules spell differently silently stops deduping.
14. **One pattern, one component.** If a screen needs a variant of a kit
    component, extend the kit (e.g. `PillTabNav`'s `label`) rather than
    growing a second copy. `components/finance/VoucherList` is the one voucher
    list.

## Working in parallel

- Each lane gets its own database (`tpms_ui_N`, `tpms_test_*`), its own
  `TPMS_STORAGE_DIR`, and its own dev server with
  `NEXT_DIST_DIR=.next-<lane> next dev -p <port>`.
- `next dev` appends its dist dir's types to `tsconfig.json` `include`. Never
  commit that line.
- Commit with explicit pathspecs and never rewrite history (the root
  `CLAUDE.md` R9/R12).
- Creating a database from scratch needs the `vector` and `pgcrypto`
  extensions, which a non-superuser role cannot create. Create them once as a
  superuser, or clone an already-migrated database
  (`create database x template tpms`).

## The golden path

`src/server/demo/` drives one package from an inbound lead to SETTLED_CLOSED
using only the domain services and the worker's own handlers.
`npm run golden-path` prints the step table. `npm run db:seed -- --reset`
builds the demo portfolio from the same steps. Tasks due in the future are
fast-forwarded through their handlers, and every fast-forward is logged with
⏩. Change a service's contract and this path breaks first.
