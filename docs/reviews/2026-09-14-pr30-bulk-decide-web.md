PR #30 MERGE

# PR #30 — `fix(web): bulk decide sends per-item diff hash (p_items)`

Independent review. CI is down (org billing), so this verdict plus the lane gates
below are what stands in for it.

## Re-review at c73c683 (2026-09-14)

The first line is this section's verdict. Everything from "Original review at
2b885b2" down is the earlier review, left as written.

| What | Sha / ref |
| --- | --- |
| PR head | `c73c683` (`origin/fix/bulk-decide-items`), 7 commits since `2b885b2` |
| `origin/main` | `afaf9cb`. It moved past the PR base `4e4dbde` by two `docs(state)` commits (`ai/resume-brief.md` only). `git merge-tree` merges clean, GitHub says MERGEABLE |
| SQL contract | `origin/cloud/migrations` tip is `53be84d`, not `f819984`. `53be84d` touches only 001. `git diff --quiet 11508ed origin/cloud/migrations` is clean for both 011 and 014, so every line number below is valid at `11508ed` and at the tip |
| Code read and run in | throwaway detached worktree `trainos-wt/read-pr30-c73c683`, `npm ci` from the PR's lockfile |

### Verdict per finding

| Finding | Commit | Verdict |
| --- | --- | --- |
| H1 selected refs silently dropped | `05b7239` | **Fixed** |
| H2 fixture accepts empty items | `b2249da` | **Fixed** |
| M1 fixture applies duplicate approvalIds | `9692d39` | **Fixed**, comment and citation corrected |
| M2 `BULK_NOT_PERMITTED` not in `ErrorCode` | `46e81ea` | **Fixed** |
| M3 idempotency key order-sensitive | `c2b2cbf` + `e310a15` | **Fixed**, with L4 below |
| L1 bulk REJECT needs no note in fixture | not touched | Still open, still unreachable from the UI |
| L2 bulk `DIFF_CHANGED` names no row | not touched | Still open, still a contract gap and not a PR #30 defect |
| Single decide hashless APPROVE | `c73c683` | **Fixed**, an extra fix beyond the review |

**H1.** Both halves are closed.

- `narrowByValue` (`ApprovalInbox.tsx:284-287`) now clears the selection the way
  the view switch already did.
- `runBulkApprove` (`ApprovalInbox.tsx:299-313`) resolves every selected ref
  against `rows`. If any ref is missing it sends nothing, names the missing refs
  in a WARN banner, and trims the selection to what is still on screen.

Nothing is filtered away without a word any more. The `rows.filter` at
`ApprovalInbox.tsx:320-322` now only runs once every ref has resolved. The two
old banner states (`bulkBlockers`, `bulkError`) became one `BulkRefusal`, drawn
by one `ExceptionBanner` (`:458`). That is the kit component and it is the only
banner on the page. WARN is already used the same way in `features/engagements`.
Dismiss is a `SecondaryButton`, so the one-solid-primary rule holds.

**H2 / M1.** The empty check (`FixtureClient.ts:1118`) and the duplicate check
(`:1123`) come first and second, ahead of the missing-hash check. That matches
011:3462-3468 and 011:3474-3483. Codes and `reason: INVALID_APPROVAL_IDS` match
too. I checked every line range in the rewritten order comment (`:1104-1117`)
against `11508ed`: empty 3462-3468, duplicate 3474-3483, missing hash 3497-3511,
idempotency 3514-3548, not found 3550-3556, blocked 3558-3571, loop from 3573.
All correct. The comment also names the one ordering the fixture cannot copy:
`#write` runs the idempotency check before any validation.

**M2.** Here is what the PR now does:

- It adds `BULK_NOT_PERMITTED` to `ErrorCode` (`envelope.ts:259`) and to
  `ERROR_STATUS` as 409 (`:280`).
- It adds a typed `NotBulkApprovable {id, ref, reason}`.
- The fixture now raises the SQL shape. Message, code and details match
  011:3558-3571.
- The inbox reads `details.notBulkApprovable[].ref`, but only when
  `code === "BULK_NOT_PERMITTED"` (`ApprovalInbox.tsx:332`).

`isErrorCode` is `hasOwnProperty(ERROR_STATUS, …)` (`rpcClient.ts:129-130`), so
the classification half is fixed by the `ERROR_STATUS` entry. The new
`messageForCode` case (`rpcClient.ts:162`) was needed, not cosmetic. The switch
ends in a `default` that returns the IDEMPOTENT_REPLAY sentence, so without the
case, an envelope-path `BULK_NOT_PERMITTED` with no message would have told the
approver "That key was already used with a different request". On the PostgREST
path, `classifyTransportFailure` keeps the server's own message, so the case is
only the fallback there. The new `classifyTransportFailure` test feeds it a
jsonb-spaced DETAIL string with the fixture out of the loop. It is the only
assertion in the suite that does not answer from `FixtureClient`.

One cosmetic difference: the fixture picks `reason` by
`approval.value ? MONETARY_VALUE : …` (`FixtureClient.ts:1153`), while SQL uses
`value_sen IS NOT NULL`. They differ only for a value of exactly 0.

**Single decide (`c73c683`).** `FixtureClient.decideApproval` now refuses a blank
or missing hash on APPROVE with `VALIDATION_FAILED`,
`fields:[{field:"diffHash",reason:"REQUIRED"}]`, before the lookup
(`FixtureClient.ts:1015-1019`). That matches 014:1287-1297 in trigger, code,
field name and position: `core.decide_approval` raises before
`app.decide_approval`, so a hashless APPROVE of an unknown id is also a
VALIDATION_FAILED. The test covers both cases. The wire-shape test pins the five
`p_*` names of 014:1274-1280.

### The idempotency key (M3)

`bulkDecideIdempotencyKey` (`idempotency.ts:125-135`) sorts a copy of `items` by
`approvalId`. It then derives
`approval-bulk-decide:<sorted ids>:<digest{decision, items with diffHash, note ?? null}>`.
The hook no longer passes an option (`api.ts:171-183`), so the RPC adapter's
derivation (`apiClient.ts:186`) is the only one.

Here are the brief's questions, each checked against 011:3514-3548:

- **Same selection, same key.** Yes. Sorted ids, per-item hashes, decision and
  normalised note are the whole input.
- **Changed selection, new key.** Yes. The id list is the subject.
- **Order-independent.** Yes. The wire array keeps selection order and only
  the derivation sorts. The comparator never returns 0, but duplicates are
  refused first, so that cannot matter.
- **Can a changed hash change the key?** Yes, by design. SQL's `request_hash`
  covers `{ids, decision, note}` only (011:3521-3523), and the client key covers
  those plus the hashes. So one client key always maps to one SQL request hash,
  and a spurious `IDEMPOTENT_REPLAY` cannot come from the hash half. A repriced
  retry gets a fresh key and meets `DIFF_CHANGED` or applies. It never replays
  the stale answer.
- **Stale replay after a partial failure?** No, on either client.
  - SQL: the `INSERT INTO app.idempotency_keys` (011:3524-3530) and the `UPDATE`
    to COMPLETED (011:3605-3610) share the function's transaction. A
    `DIFF_CHANGED` or not-queued raise in the loop rolls the key row back with
    the applied items, so a retry runs fresh.
  - Fixture: `#write` (`FixtureClient.ts:369-392`) stores the response only
    after `run()` returns, so a thrown refusal is never cached.
  - Only a completed batch replays, and its rows have left the queue.

Mutation checks. Each was applied alone and reverted, with the output under
`scratchpad/rereview-pr30/mut-*.txt`:

- Removing the sort fails
  "derives one idempotency key for one selection, whichever order it was ticked in".
- Dropping the hashes from the digest fails the same test.

### New findings

**L3 · Fixture mode now sends bulk decide with no key at all.** Location:
`api.ts:183` + `useApi.ts:96`.

In `apiMode() !== "supabase"` the context client is `fixtureClient` itself, not
the RPC adapter. So "omitting the option lets `bulkDecideIdempotencyKey` derive
it" (`api.ts:171-182`) is true only in supabase mode. In fixture mode `#write`
sees no key and does no dedupe.

I probed it. Two identical unkeyed `bulkDecideApprovals` calls on
`APV-2026-0773` both resolved `APPROVED`, with effects applied twice. The fixture
bulk path has no PENDING guard, which is L1's neighbour and pre-existing. At
`2b885b2` fixture mode at least carried the (wrong-scope) key.

This is not reachable from the screen, because the button is
`disabled={bulkDecide.isPending}` (`ApprovalInbox.tsx:468`).

Nothing pins the hook either. Re-adding
`{ idempotencyKey: idempotencyKey("bulk", body) }` at `api.ts:183` kept the
ApprovalInbox, conformance and idempotency suites green (37/37), because the
conformance test calls the RPC `ApiClient` directly and never goes through the
hook. So the actual bug `c2b2cbf` removed was never red.

Cheap follow-up: pass `{ idempotencyKey: bulkDecideIdempotencyKey(body) }` from
the hook. It is the same function, so it is not a second derivation. Also add
a hook-level test.

**L4 · Stale and wrong SQL line citations in the new comments.** These are
comments only.

- `011:3447` (sort) and `011:3405` (DROP) are `062e5e2`/`2edab79` numbers. At
  `11508ed`/tip they are 3474 and 3432. Locations: `idempotency.ts:111`,
  `apiClient.ts:172`, `api.ts:181`, `conformance.approvals.test.ts:296,331`.
- `011:3506` / `011:3506-3507` ("iterates `p_items`", "reads `approvalId` and
  `expectedDiffHash`") match no sha. At `062e5e2` 3506 is inside the idempotency
  block. The loop is 3573 and the reads are 3574-3575 at `11508ed`. Locations:
  `idempotency.ts:123`, `apiClient.ts:184`,
  `conformance.approvals.test.ts:40,295,361`.

The same comments also overstate the harm. They say an order-varied retry "ran
the batch a SECOND time" (`idempotency.ts:106`, `apiClient.ts:179`, `api.ts:178`,
`conformance.approvals.test.ts:339`). Against SQL it could not. The second run
reaches 011:3036-3042 and raises `approval action is not queued` (SQLSTATE
55000). That rolls back and surfaces as a transport `SERVER` error. The real harm
was a confusing error in place of a replay. Double-apply was only possible on the
fixture. The fix is still right.

**L5 · The bulk hash guards list freshness, not what the approver saw.** This is
pre-existing, and a note rather than a defect of this PR. Location:
`ApprovalInbox.tsx:322`.

`diffHash` is echoed off the latest list read, and the inbox never renders the
diff. A focus refetch that reprices a still-selected row silently upgrades the
hash it sends. H1's check is by ref, so it does not catch that either. Bounded
by `bulkApprovable` excluding money rows.

### Failing-first evidence

The fix lane's red and green files (`scratchpad/fix-pr30/fix{1..5}-red.txt`)
show each new test failing on the pre-fix code for H1 (2 tests), H2, M1, M2
(4 tests across fixtures, conformance and inbox), and the single-decide hash.
`c2b2cbf` (fix) landed 15 seconds before `e310a15` (test), so M3 has no red
record. I ran my own mutations on the fixed code:

| Mutation | Result |
| --- | --- |
| drop the `gone` check | ✗ "refuses a bulk approve whose selection has left the queue" |
| drop the filter reset | ✗ "starts a fresh selection when the value filter narrows the queue" |
| drop empty-items check | ✗ fixtures "refuses an empty batch…" · web suites stay green |
| drop duplicate check | ✗ fixtures "refuses a batch that names one approval twice…" |
| inbox code test → other code | ✗ "names the rows the database refused to bulk-approve" |
| remove `BULK_NOT_PERMITTED: 409` | ✗ conformance "refuses identically" + "keeps … through classification" |
| unsorted key / hashless key | ✗ "derives one idempotency key for one selection…" |
| hook re-passes a key | **survives** (L3) |
| drop hashless single check | ✗ fixtures "refuses a hashless APPROVE…" + conformance "five argument names" |

The read worktree was clean (`git status --short` empty) after every revert.

### Gates at c73c683

Run from the read worktree root after `npm ci` (602 packages, exit 0). Every
command exited 0.

```
npm run typecheck          exit 0  web/contract/fixtures/agent-runtime/worker, no diagnostics
npm run typecheck:strict   exit 0
npm run lint               exit 0  0 errors, 8 warnings (react-refresh/only-export-components, none in changed files)
npm test -- --run          exit 0  web 117 files / 1126 tests · fixtures 13 / 194
                                   agent-runtime 7 passed + 1 skipped / 107 + 1 skipped · worker 9 / 95
npm run build              exit 0  (existing >500 kB chunk warning)
npm run check:rpc          exit 0  4 pass/watch, 0 broken
npm run check:barrels      exit 0  32 barrels resolve
```

Web went from 1119 to 1126 tests (+3 inbox, +4 conformance) and fixtures from 191
to 194. The single skipped test is in `packages/agent-runtime`, which this PR
does not touch. `git diff --stat origin/main...origin/fix/bulk-decide-items` has
11 files, with no `package.json`, lockfile or `pnpm-*`.

### Conformance can still not see fixture-vs-SQL divergence

This is not blocking. Apart from the one `classifyTransportFailure` test, every
conformance assertion answers from `FixtureClient` behind a fake PostgREST. The
suite proves the two web clients agree with each other and that the wire shape
is right. It cannot prove the fixture matches 011/014. Every fixture fix in this
round was found by reading SQL, not by a red test.

### What I could not verify, and what would settle it

- **Any of this against Postgres.** PR #6 is unmerged and I used no database.
  Settled by applying 011/014 to a branch DB and calling
  `core.bulk_decide_approvals` with: empty, duplicate, hashless, blocked and
  stale batches; a retry with the same key after a `DIFF_CHANGED`; and a replay
  after success.
- **supabase-js putting `DETAIL` into `PostgrestError.details` byte for byte.**
  The new test hand-writes that string. One live `BULK_NOT_PERMITTED` refusal
  settles it.
- **The inbox's stale-selection banner in a real browser.** It was verified only
  in jsdom via `focusManager` refetch. A Playwright pass on the fixture build
  would settle it.

## Original review at 2b885b2

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
