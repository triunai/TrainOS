# Prompt — write API docs for this UI

Paste everything below the line into the other chat, after the UI/screens exist there. It produces two files: a short orientation doc and the full contract.

---

Write **two** markdown files documenting the API behind the screens in this project:

- **`API.md`** — the short one. What an engineer reads first, or a stakeholder reads instead.
- **`API_CONTRACT.md`** — the full contract. Everything below describes this one unless stated otherwise.

Write the contract first, then derive `API.md` from it, so the two cannot disagree.

## `API.md` — the short doc

One screen's worth of reading, no more. In this order:

1. **One paragraph** on what the API is and the single mechanism everything routes through (see the centre-of-the-contract section below).
2. **A table of every endpoint** — method, path, roles, and the screen it serves. One line each, no response shapes.
3. **The three or four rules that ripple everywhere** — the conventions a developer will otherwise get wrong on day one (money units, the cross-cutting envelope, what is server-decided rather than client logic).
4. **A pointer to `API_CONTRACT.md` by section number** for anything deeper.

No JSON blocks longer than four lines. If a reader needs a shape, they open the contract.

When the contract is later extended, `API.md` gets a matching short section — never a second source of truth.

---

## `API_CONTRACT.md` — the full contract

Derive it from the screens themselves — every field rendered anywhere must resolve to a documented response field, and every button must map to an endpoint.

Implementation-agnostic: HTTP + JSON. Do not assume a framework, ORM, database or cloud platform. Do not write client code.

## Non-negotiable rules

1. **Every example uses the project's own fixture data** — the same names, IDs, amounts and dates that appear on the screens. The examples then double as seed data. Never `foo`, `example.com`, `John Doe`, or `123`.
2. **Derive from the UI, don't invent.** If a screen shows a badge count, a status chip, a disabled button, a progress bar or an error state, there must be a field that produces it. Server-decided things must come from the server — e.g. a disabled bulk action is a `bulkApprovable: false` field, not client logic.
3. **End with an audit.** A section listing every field rendered on any screen that has *no* source in your contract, with a proposed fix for each. If the audit is empty, say so explicitly and name the screens you checked.
4. **No prose padding.** No "in this section we will", no restating the heading, no summary paragraphs. Tables and JSON blocks carry the weight.

## Required structure

### 1 · Conventions
Base path. Resource naming. Then decide and state, with a one-line justification each:

- **Entity envelope** — the fields every resource carries (`id`, human-readable `ref`, `createdAt`, `updatedAt`, `createdBy{id,name,kind}`).
- **Money** — integer minor units, never floats. Show the shape and one worked example in the project's currency.
- **Dates** — ISO-8601 with offset; state the timezone convention.
- **Enums** — `UPPER_SNAKE` strings; full catalogue later.
- **List conventions** — one worked query string showing the filter operator grammar, sort, cursor pagination and saved views, then the response shape including which filters were actually applied.
- **Idempotency** — which methods accept a key, what a replay returns, what a replay with a different body returns, retention.
- **Errors** — the error envelope, then a table of every domain error code with its HTTP status and what `details` carries. Include the domain-specific ones, not just 404 and 422.
- **Roles** — the full list, including any non-human service principals.

If the product has a cross-cutting concern that touches many responses (provenance, tenancy, versioning, localisation), define its envelope here, once, and reference it throughout rather than repeating it.

### 2 · Shell and session
The endpoints every screen needs: current user, navigation (with badge counts, role-filtered, server-driven), global search, audit trail, saved views, and any config the UI must not hardcode.

### 3 · The centre of the contract
Most products have one mechanism that everything else routes through — an action envelope, a workflow engine, a policy gate, a state machine. **Find it and document it first, in its own section**, before the CRUD. State its inputs, the exact order they are evaluated in, and every response variant. If the product genuinely has no such centre, say so and move on.

### 4–N · Domain sections, one per module
For each: a method/path/roles table, then the full response shape for the screen's primary read, then the writes. Under each endpoint state **which screen it serves**, whether it is idempotent, what events it emits, and whether it is gated by anything.

### Realtime and webhooks
A table of channels with payload shapes and which screens consume them. State what polls instead. For inbound webhooks: source, idempotency key, and the event emitted.

### Enum catalogue
One table, every enum, all values. No exceptions — this is what stops the client inventing strings.

### Screen → endpoint matrix
One row per screen, every endpoint it calls. This is the table engineers actually work from.

### Event catalogue
Every domain event, what emits it, its payload. State the delivery guarantee.

### Fields with no source
The audit from rule 3.

### Open questions
Numbered, specific, each one a real decision someone must make — not "what about security?" but the actual ambiguities you hit while writing this. Ten or so. Include the boring ones that bite: rounding, staleness, expiry, ownership, retention.

## Style

- Tables for anything enumerable; prose only where a decision needs a reason.
- Every JSON block is complete and valid — no `...` standing in for required fields, and no invented fields you would not implement.
- Comment sparingly inside JSON, only to mark a worked calculation.
- Where the contract deliberately refuses to do something the reader might expect, say so in bold and give the reason. Those lines prevent the most expensive mistakes.
- Cross-reference by section number, not by page or link.

## Before you write

Read every screen in the project first. List the modules you found and the fixture entities you will use throughout, then write `API_CONTRACT.md` in one pass, and `API.md` from it afterwards. If a screen implies a rule you cannot see (a threshold, a cadence, a validation), state it as an assumption in the relevant section rather than silently choosing.
