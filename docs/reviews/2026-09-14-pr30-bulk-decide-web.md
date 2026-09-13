PR #30 MERGE-WITH-FIXES

# PR #30 — `fix(web): bulk decide sends per-item diff hash (p_items)`

Independent review. CI is down (org billing), so this verdict plus the lane gates
below are what stands in for it.

## Scope reviewed

| What | Sha / ref |
| --- | --- |
| PR head | `2b885b2` (`origin/fix/bulk-decide-items`) |
| Merge base | `4e4dbde` (`origin/main`) |
| SQL contract | `origin/cloud/migrations` tip `2edab79`, security fix `062e5e2` |
| Review branch | `review/pr30-bulk-decide-web`, cut from `origin/main` |

Files reviewed: `packages/contract/src/domain/approvals.ts`,
`apps/web/src/shared/api/rpcClient.ts`, `apps/web/src/shared/api/apiClient.ts`,
`apps/web/src/features/approvals/ApprovalInbox.tsx`,
`packages/fixtures/src/client/FixtureClient.ts`, and both test files.
The PR branch was never checked out in the review worktree; its code was read via
`gh pr diff 30` and `git show origin/fix/bulk-decide-items:<path>`. Execution
happened in a throwaway detached worktree, since removed.

## The SQL the client has to match

`core.bulk_decide_approvals(jsonb,text,text,text)` (014:1328-1344) is a one-line
wrapper over `app.bulk_decide(p_items, p_decision, p_note, p_idempotency_key)`
(011:3407-3580). The element shape is
`{"approvalId": <uuid>, "expectedDiffHash": <text>}` (011:3399-3401), the response
is `{results:[{id,ref,status,effects}]}` (011:3560-3576), and the refusal order is:

| # | Refusal | Code | Line |
| --- | --- | --- | --- |
| 1 | items null, not an array, or empty | `VALIDATION_FAILED` / `INVALID_APPROVAL_IDS` | 011:3436-3441 |
| 2 | duplicate or non-uuid `approvalId` | `VALIDATION_FAILED` / `INVALID_APPROVAL_IDS` | 011:3451-3456 |
| 3 | APPROVE item with a missing or blank hash | `VALIDATION_FAILED`, `fields:[{expectedDiffHash,REQUIRED}]`, `missingFor` | 011:3470-3484 |
| 4 | same key, different batch | `IDEMPOTENT_REPLAY` | 011:3510-3515 |
| 5 | any id not in this tenant | `NOT_FOUND` | 011:3523-3529 |
| 6 | any row not `bulk_approvable` | `BULK_NOT_PERMITTED`, `notBulkApprovable:[{id,ref,reason}]` | 011:3531-3544 |
| 7 | stale hash, per item, inside the apply loop | `DIFF_CHANGED`, `{diffChanged,diff,diffHash}` | 011:3000-3006 via 011:3552 |

The author's claim that all refusals land "before any item applies" is true in
effect but not by construction: #7 fires inside the `FOR v_item IN ...` loop at
011:3546-3567, after earlier items have already been written. It is the
transaction rollback, not the ordering, that makes the batch atomic. The
`FixtureClient` pre-scans instead, which is the only way to get the same
behaviour without a transaction, so the mirror is right even though the stated
reason is not.

## What is correct

**The central change is right.** `p_items` replaces `p_ids`, each element is
`{approvalId, expectedDiffHash}`, and the mapping from the contract's `diffHash`
to the SQL's `expectedDiffHash` happens once, in `rpcClient.ts:638-641`. The
contract's `ApprovalBulkDecideResponse` (`approvals.ts:152-160`) matches
011:3560-3576 field for field, including `effects` being optional and `[]` for a
non-APPROVE. Status strings (`VALIDATION_FAILED`, `DIFF_CHANGED`) and the
`DIFF_CHANGED` details bag (`diffChanged`, `diff`, `diffHash`) match 011:3001-3006
exactly, and the fixture mirrors the second of the two `DIFF_CHANGED` raises — the
client-stale one — which is the correct one for this path.

**No second hash helper (brief item 2).** Neither path computes a hash on the
client. `ApprovalDetail.tsx:170` echoes `detail.diffHash` off the detail read;
`ApprovalInbox.tsx:281` echoes `row.diffHash` off the row. `hashDiff` appears once
in the whole tree, at `FixtureClient.ts:2682`, as the fixture store's own
generator. There is nothing to duplicate and nothing was duplicated.

**The PR silently fixes a live bug.** The old call was
`bulkDecide.mutateAsync({ ids: [...selected], ... })`, and `selected` is keyed by
`row.ref` (`ApprovalInbox.tsx:438`, `rowKey={(row) => row.ref}`). So the old code
fed refs such as `APV-2026-0773` into `p_ids uuid[]`. It only ever passed because
`FixtureClient` resolves through `byIdOrRef`. Resolving to `row.id` is a real
correctness fix that the PR description does not claim.

**No lockfile churn (brief item 6).** `git diff --stat origin/main...origin/fix/bulk-decide-items`:

```
 apps/web/src/features/approvals/ApprovalInbox.tsx  |  9 ++-
 .../api/__tests__/conformance.approvals.test.ts    | 75 +++++++++++++++++++-
 apps/web/src/shared/api/apiClient.ts               |  6 +-
 apps/web/src/shared/api/rpcClient.ts               |  8 ++-
 packages/contract/src/domain/approvals.ts          | 11 ++-
 packages/fixtures/src/client/FixtureClient.ts      | 51 +++++++++---
 .../fixtures/src/tests/approvals-and-lists.test.ts | 79 ++++++++++++++++++--
 7 files changed, 219 insertions(+), 20 deletions(-)
```

No `package.json`, no `package-lock.json`, no `pnpm-*`. `git status --short` in the
exec worktree after a root `npm install` printed nothing.

**Both shas carry the same function (brief item 7).** The PR names `062e5e2` while
the branch tip is `2edab79`:

```
$ diff <(git show 062e5e2:supabase/migrations/011_...sql) <(git show 2edab79:supabase/migrations/011_...sql)
IDENTICAL 062e5e2 vs 2edab79
$ diff <(git show 062e5e2:supabase/migrations/014_...sql) <(git show 2edab79:supabase/migrations/014_...sql)
IDENTICAL 062e5e2 vs 2edab79
```

`2edab79` touched only `supabase/tests/test_014`, `test_016` and `test_017`. The
citation is stale but not wrong.

## Findings

### H1 · Selected approvals are silently dropped from the batch — `ApprovalInbox.tsx:279-281`

```ts
const items = rows
  .filter((row) => selected.has(row.ref))
  .map((row) => ({ approvalId: row.id, diffHash: row.diffHash }));
```

`selected` is a `ReadonlySet<string>` of refs that survives anything that changes
`rows`. Switching saved view clears it (`ApprovalInbox.tsx:375-378`); the value
filter does not (`ApprovalInbox.tsx:386`, `setHighValueOnly((on) => !on)` with no
`setSelected`). `rows` is only the current page (`ApprovalInbox.tsx:136`).

Repro: select five rows, press "Value ≥ RM 5,000" so three of them fall out of
`rows`, press "Bulk approve". `BulkActionBar count={selected.size}`
(`ApprovalInbox.tsx:424`) still reads 5, two are approved, and
`setSelected(new Set())` runs on success. The approver is told nothing.

This is the failure mode both the SQL comment (011:3466-3468) and the PR's own
fixture comment name as the reason the guard exists: "a partial bulk decide is
worse than a refused one, because the approver cannot tell which half went
through." The batch is atomic once it reaches the database; the loss happens
before it gets there.

Fix: resolve every selected ref, and refuse the whole batch if any cannot be
resolved, rather than filtering. Or clear the selection whenever `rows` changes
identity, the way the view switch already does.

### H2 · An unresolvable selection produces a false success — `FixtureClient.ts:1090` + H1

When H1 drops every selected row, `items` is `[]`. Probed directly against the
fixture:

```
EMPTY -> RESOLVED {"results":[]}
```

011:3436-3441 raises `VALIDATION_FAILED` / `INVALID_APPROVAL_IDS` for an empty
array. So the dev environment reports a successful bulk approve of nothing and
clears the selection, while the real database would refuse. The fixture is the
oracle the whole conformance suite is anchored to, so nothing in the test tree can
catch this.

Fix: add the empty-array refusal to `FixtureClient.bulkDecideApprovals` before the
missing-hash check.

### M1 · Duplicate `approvalId` applies twice in the fixture, refuses in SQL — `FixtureClient.ts:1110-1114`

```
DUPLICATE -> RESOLVED results=2
```

011:3447-3456 aggregates `DISTINCT (item ->> 'approvalId')::uuid` and raises
`VALIDATION_FAILED` / `INVALID_APPROVAL_IDS` when
`cardinality(v_ids) <> jsonb_array_length(p_items)`. The fixture applies the same
approval twice and returns two result rows. Against the real database the second
`app.decide_approval` would also hit `approval action is not queued`
(011:3020-3022), which is not even a domain error.

The comment at `FixtureClient.ts:1094-1097` says "011:3455-3479 order, mirrored
exactly". Line 3455 is the `INVALID_APPROVAL_IDS` raise that is not mirrored, and
the missing-hash block the comment describes is 3470-3484. Both the claim and the
citation need correcting.

### M2 · The bulk-approvable refusal diverges in code, status and field name — pre-existing

| | code | HTTP | details |
| --- | --- | --- | --- |
| SQL, 011:3538-3543 | `BULK_NOT_PERMITTED` | — | `notBulkApprovable: [{id, ref, reason}]` |
| Fixture, `FixtureClient.ts:1116-1122` | `AGENT_PAUSED` | 409 | `blockers: [ref]` |

`BULK_NOT_PERMITTED` is not in `ErrorCode` (`envelope.ts:237-253`), so
`isErrorCode` returns false and `classifyTransportFailure`
(`rpcClient.ts:236-239`) degrades it to `VALIDATION_FAILED` / 422. Then
`ApprovalInbox.tsx:289` reads `error.details?.blockers`, which is `undefined`
against the real database, so the named-blockers banner
(`ApprovalInbox.tsx:400-411`) never renders and the generic "That bulk approval
did not go through" banner shows instead.

This predates PR #30 and should not block it. It is listed because it is the one
refusal the PR's changed test — "a bulk decision over a monetary approval refuses
identically" — asserts is identical, and it is not. See the teeth section for why
the test cannot see it.

### M3 · The idempotency key is still order-sensitive — `apiClient.ts:166-173`

```ts
derivedIdempotencyKey(
  "approval-bulk-decide",
  body.items.map((item) => item.approvalId).join(","),
  body,
)
```

`derivedIdempotencyKey` digests `stableStringify(body)`
(`idempotency.ts:37-46`), which sorts object keys but preserves array order, and
the subject is an unsorted join. So the same set of approvals in a different order
yields a different key.

011:3443-3450 sorts `v_ids` for the request hash with an explicit comment: "the
client hashes its selection in click order, so the same two approvals picked in
the other order produced a different key and a spurious refusal on the retry."
That server-side sort is unreachable while the client key itself varies with
order — a reordered retry lands as a brand-new key and re-applies the batch rather
than being recognised as a replay.

Answering the brief directly: no, the key is not stable across orderings, and it
was not before either — `body.ids.join(",")` had the same property. This is not a
regression. It is in fact a partial improvement, because `rows.filter(...)` now
emits row order where `[...selected]` emitted click order. Single-decision keys
(`apiClient.ts:159`) are untouched; the diff changes only the bulk branch, so
there is no regression there.

Fix, one line: sort the ids in the subject and sort `items` by `approvalId` before
they reach the digest.

### L1 · The fixture's bulk path does not require a note for REJECT — `FixtureClient.ts:1090`

```
REJECT-NO-NOTE -> RESOLVED results=1
```

011:2958-2964 raises `VALIDATION_FAILED` / `{field: note, reason: REQUIRED}` for
`REJECT` and `REQUEST_CHANGES` with no note, and `app.bulk_decide` reaches it
through `app.decide_approval`. Pre-existing, and unreachable from the UI today
because `ApprovalInbox` only ever sends `APPROVE`. Noted for whoever adds a bulk
reject.

### L2 · `DIFF_CHANGED` on a bulk names no row — SQL and fixture agree, both unhelpful

011:3003-3006 puts `diff` and `diffHash` in the details bag but no `id` or `ref`,
and `FixtureClient.ts:1126-1130` mirrors that faithfully. So an approver who
bulk-approves twelve rows and hits one stale hash is told "The rendered diff is no
longer current" with no indication which row. The mirror is correct; the contract
is the thing that is thin. Not a PR #30 defect.

## Evidence — gates, run from the exec worktree at `2b885b2`

`npm install` at the repo root, exit 0, then:

```
$ npm run typecheck
@trainos/web / @trainos/contract / @trainos/fixtures / @trainos/agent-runtime / @trainos/worker
5/5 clean, no diagnostics

$ npm run check:rpc
  PASS   E1  supabase/migrations/001_foundation_schemas_and_helpers.sql:399
  PASS   E1  supabase/migrations/001_foundation_schemas_and_helpers.sql:415
  PASS   E2  apps/web/src/shared/api
  PASS   E3  apps/web/src/shared/api/client.ts
check:rpc: 4 pass/watch, 0 broken.

$ npm run arch:graph
✔ no dependency violations found (340 modules, 1171 dependencies cruised)
```

Tests, run from `apps/web` and `packages/fixtures` rather than the repo root:

```
$ cd apps/web && npm test -- --run
 Test Files  117 passed (117)
      Tests  1119 passed (1119)

$ cd packages/fixtures && npm test -- --run
 Test Files  13 passed (13)
      Tests  191 passed (191)
```

The author's counts reproduce. The exec worktree was removed afterwards.

## Teeth check

Two mutations, each applied alone and then reverted.

**Removed the `DIFF_CHANGED` block from `FixtureClient.bulkDecideApprovals`:**

```
× bulk decisions > refuses a stale diff hash through the bulk door, before applying any item
  Test Files  1 failed | 12 passed (13)
× M02 · the two clients answer the approval screens the same > bulk decide refuses a hashless or stale item identically, and admits a fresh one
  Test Files  1 failed (1)
```

**Removed the missing-hash block:**

```
× bulk decisions > refuses an APPROVE item with no diff hash, before applying any item in the batch
  Test Files  1 failed | 12 passed (13)
× M02 · ... > bulk decide refuses a hashless or stale item identically, and admits a fresh one
  Test Files  1 failed (1)
```

Both new tests have teeth on both sides. The fixture was restored bit-for-bit
before the gates above were re-read.

**The teeth stop at the oracle, though.** In
`conformance.approvals.test.ts:49-58` the `bulk_decide_approvals` RPC handler is

```ts
bulk_decide_approvals: (args, oracle) => oracle.bulkDecideApprovals({ ... })
```

so the "RPC client" side of every conformance assertion is the `FixtureClient`
reached through a fake PostgREST. The suite proves that `rpcClient` builds
`p_items` correctly and decodes the envelope correctly. It cannot prove the
fixture matches the SQL, because the SQL is not in the loop. That is exactly how
M2 survived, and why H2 and M1 are invisible to a green run.

## What I could not verify, and what would settle it

- **The live RPC round-trip.** PR #6 is unmerged and no database was available, so
  every SQL claim here is read off `origin/cloud/migrations` text, not executed.
  Settled by applying 011 and 014 to a branch database and running the
  `supabase/tests/test_014` pgTAP file plus a hand call of
  `core.bulk_decide_approvals` with a hashless item, a duplicate id and an empty
  array.
- **Whether `classifyTransportFailure` parses the real `DETAIL` byte for byte.**
  The parse path (`rpcClient.ts:224-243`) requires `SQLSTATE = TRNOS` and a JSON
  string in `failure.details`. 011 builds the DETAIL with `jsonb_build_object(...)::text`,
  which satisfies that, but supabase-js's mapping of `DETAIL` onto
  `PostgrestError.details` was not exercised. One live refusal would settle it,
  and would also confirm or kill M2.
- **Whether `row.diffHash` is ever undefined at runtime.** It is typed `string`
  (`packages/contract/src/actions.ts:295`) and typecheck is clean, so the compiler
  says no. A list response from a database that has not backfilled `diff_hash`
  would still deliver `undefined` through the `as T` cast, and there is no runtime
  guard. Settled by the same live call.

## Required before merge

1. H1 — stop dropping unresolvable selections in `ApprovalInbox.tsx:279-281`.
2. H2 — refuse an empty `items` array in `FixtureClient.bulkDecideApprovals`,
   matching 011:3436-3441.
3. M1 — refuse duplicate `approvalId`s, matching 011:3451-3456, and fix the
   "mirrored exactly" comment and its line citation.

M2, M3, L1 and L2 are worth their own change and should not hold this one. M2 in
particular wants a decision about whether `BULK_NOT_PERMITTED` joins `ErrorCode`
or the SQL adopts `AGENT_PAUSED`; that belongs with PR #6, not here.
