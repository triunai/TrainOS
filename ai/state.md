# State

> Backlog, decisions and session log in one file until it outgrows this shape.
>
> Split triggers, stated once so nobody re-derives them under pressure:
> backlog + decisions + log tangled past readability → split into
> `state-backlog.md` and `decisions.md`. More than ~5 threads in flight →
> add a `workstreams.md` parkable board. More than ~5 living docs to route
> between → promote the routing table out of `CLAUDE.md`. A review sweep
> producing more than a couple of findings → open a
> `docs/reviews/YYYY-MM-DD-{slug}/` lane folder.

## Backlog

**OPEN (2026-09-12, scaffold) — BRANCH PROTECTION IS NOT ON.** The CI pipeline
hard-fails correctly, including on `skipped`, but nothing requires it. Until a
person marks the blocking checks required on `main` in the host's settings, a
green run is a badge and not custody. No file in this repo can close this.

**OPEN (2026-09-12, scaffold) — THE `compliance` NAV ROLE IS UNREACHABLE.** The
design pack's ROLE map has six keys; the contract's `Role` union has nine
values, and none of them maps to `compliance`. The key is kept verbatim in
`navTree.ts` because it is source. Either the contract needs a compliance role
or the pack's key is dead — somebody who knows the org has to say which.

**OPEN (2026-09-12, scaffold) — SIX DARK TOKENS ARE DERIVED, NOT SOURCED.** The
pack's dark map gives only the text colour for warning and danger, so their dark
chip fills and four chip borders were derived at the same lightness step as
their sourced neighbours. Marked DERIVED in `tokens.css`. A designer should
confirm or replace them before the first dark screenshot is treated as
canonical.

**OPEN (2026-09-12, scaffold) — 8 npm ADVISORIES, 2 CRITICAL, ALL IN DEV TOOLING.**
`npm audit` reports critical findings against `vitest` and `@vitest/coverage-v8`
and high findings against `vite`, plus moderate ones against `react-router`.
Every one is a dev-server or test-runner exposure, not a shipped-bundle
vulnerability: the paths are the Vite dev server's file handling, the Vitest UI
server, and a `@vitest/mocker` redirect. None of that code reaches production.
Clearing them means Vite 8 and Vitest 5, two major versions past the house stack
this repo was told to mirror, so the `deps-audit` CI job is advisory on purpose.
Closing this is a stack-upgrade decision for the whole house, not a TrainOS one.
Until then: do not expose the dev server or the Vitest UI on an untrusted
network.

**OPEN (2026-09-12, scaffold) — NO COVERAGE FLOOR YET.** Deliberate: a
threshold set before there is anything to measure kills test culture before it
forms. Set the first floor once roughly 5 to 10 tests have landed, then ratchet.

**OPEN (2026-09-12, scaffold) — ROUTE-LEVEL ROLE GUARDS ARE NOT WIRED.** The nav
is role-filtered but every route mounts for anyone who types the URL. That is
correct today — there is no session and no data — and must not stay true once
the HTTP client lands. Guards wrap the element, not the path.

## Decisions

<!-- Latest first. SUPERSEDE, never delete. -->

## D-101 · The dev server owns port 5180, not the house default 8080 · ACTIVE

**Context (2026-09-12).** A sibling house app was already listening on 8080 on
the developer machine. The bundle-budget check probes that port for a live Vite
server, because building while one is running corrupts `node_modules/.vite` and
produces duplicate module instances, which surface as "must be used within a
Provider" white screens. The probe correctly saw a Vite server and refused to
build — it just was not ours.

**Decision.** TrainOS binds 5180. `vite.config.ts`, the bundle check's
`DEV_PORT` and `.env.example` all say 5180, and the check reads
`TRAINOS_DEV_PORT` if a machine needs to move it again.

**Why sharpening the probe does not fit.** Distinguishing our dev server from
another project's means matching on served HTML, which is fragile and would fail
open on exactly the case the probe exists to catch.

**Consequence to accept honestly.** TrainOS now differs from the house default,
so anyone carrying muscle memory from the sibling repo will type the wrong port
once. It is written in the README, the gotchas list and `.env.example`.

**Refs.** `apps/web/vite.config.ts`, `scripts/bundle-budget-check.mjs`.

## D-100 · One token file, and the kit's three supplements were folded into it · ACTIVE

**Context (2026-09-12).** The kit work needed three colours the pack's §1.1
token table does not name — an AI popover surface, a low-confidence amber dot
and an allowed-hours peak band. They were parked in a second file,
`styles/kit-tokens.css`, because `tokens.css` belonged to the scaffold.

**Decision.** All three moved into `tokens.css` with their sources and their
reasoning intact, light and dark. `styles/kit-tokens.css` and the `kit.css` that
imports it are now redundant and should be deleted.

**Why leaving them split does not fit.** CLAUDE.md's consolidation rule is
explicit: never a second mechanism for a problem the first already solves. Two
token files is the divergence that rule names as a defect, and the second one
would have been the place every future unnamed colour landed.

**Consequence to accept honestly.** The scaffold now owns three tokens the
design pack does not name, and their dark values are derived. They are marked as
such.

**Refs.** `apps/web/src/styles/tokens.css`, `apps/web/src/shared/components/kit/tokens.ts`.

## Session Log

<!-- Latest first, append-only. -->

## 2026-09-12 — repo scaffold

- Laid the whole floor: workspaces, build config, tokens, theme, shell, data
  boundary, state kit, hooks, CI, guardrails, doc spine, design pack copy.

**Four things worth telling future-me:**

1. The reference stack's `arch:graph` script could not have worked as written.
   `dependency-cruiser` 16 renamed `--validate` to `--config`, and running it
   from the repo root made TypeScript resolve the app tsconfig's
   `include: ["src"]` against a directory that does not exist. Both only showed
   up because the command was actually run instead of being assumed good.
2. A boundary rule that passes on an empty tree proves nothing. Both
   dependency-cruiser rules were probed with deliberate violations, confirmed to
   fire, and the probes removed. Do that for every new rule.
3. The first nav test failed on ordering and the test was wrong, not the code:
   the sidebar renders in TREE order, while the pack's ROLE map lists parents in
   a different order. The ROLE map controls visibility, never sequence.
4. The design pack's role vocabulary and the API contract's role vocabulary are
   different sets, and nothing in either document says so. Reconciling them
   needed two judgement calls that are now written down in
   `shared/config/roles.ts` rather than buried in a filter expression.
