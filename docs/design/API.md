# TrainOS — API surface for the demo-pack screens

First-pass contract for the 20 screens in the demo pack. REST over JSON, `/api/v1`, cursor pagination, ISO-8601 UTC timestamps, money as integer **sen** plus a formatted string, dates rendered `dd MMM yyyy` client-side.

Conventions used throughout:

```
GET  collections → { data: [...], page: { cursor, nextCursor, total } }
POST /commands   → { id, status, effects: [...] }        // anything that changes state
error            → { error: { code, message, field?, ref } }
money            → { amountSen: 1850000, currency: "MYR", display: "RM 18,500.00" }
```

Two cross-cutting rules the API has to enforce, not just the UI:

- **Policy gate.** Any command that moves money, sends to a client, or touches compliance returns `202 { status: "pending_approval", approvalId }` instead of executing, whenever a policy matches. The frontend renders the approval state from that response — it never decides.
- **Provenance.** Any field an agent produced carries a `provenance` object. If it is absent, the UI renders the value as human-authored.

```ts
Provenance {
  origin: "human" | "system" | "ai_suggested" | "ai_executed"
  agentId?: string
  agentName?: string
  model?: string
  runId?: string
  confidence?: number          // 0–1
  sources?: { id, label, href }[]
  generatedAt?: string
  decidedBy?: { userId, name, role }
  decidedAt?: string
  decision?: "approved" | "rejected" | "changes_requested"
  failure?: { code, message, retryable: boolean, attempts: number }
}
```

---

## Shell — every screen

| Method | Path | Notes |
|---|---|---|
| `GET` | `/me` | user, role, permissions[], dataScope, locale, theme |
| `GET` | `/navigation` | role-filtered tree: groups → parents → children, with badge counts |
| `GET` | `/badges` | poll or SSE: `{ approvals, hrdcDeadlines, agentFailures }` |
| `GET` | `/search?q=&types=` | command palette: records + actions, grouped |
| `GET` | `/records/{type}/{id}/audit` | audit drawer, paginated, includes agent actions |
| `GET` | `/notifications` | bell |
| `POST` | `/assistant/messages` | context-aware drawer: `{ context: {type,id}, message }` → streamed reply + proposedActions[] |

`GET /navigation` returns badge counts inline so the sidebar never makes N calls:

```json
{ "groups": [ { "caption": "MAIN", "parents": [
  { "key": "home", "label": "Home", "icon": "home", "children": [
    { "key": "approvals", "label": "Approvals", "badge": { "count": 7, "severity": "default" } } ] } ] } ] }
```

---

## M01-S01 · Executive dashboard

| Method | Path | Returns |
|---|---|---|
| `GET` | `/dashboards/executive?period=2026-11` | `{ metrics: Metric[], approvalsPending: ApprovalSummary[], agentActivity: AgentDaily[], autonomyMix, agentSpend }` |
| `GET` | `/reports/proposals-vs-won?months=6` | series for the bar chart |
| `GET` | `/metrics/{key}/drill?period=` | the filtered list behind a metric cell |

```ts
Metric { key, label, value, display, delta?: { pct, direction, severity }, drillTo: string }
AgentDaily { agentId, agentName, actionsToday, autonomy, costMonth: Money, evalScore }
```

Each metric ships its own `drillTo` path so the UI does not hardcode routes.

---

## M03 · Enquiries

| Method | Path | Notes |
|---|---|---|
| `GET` | `/enquiries?view=&channel=&cursor=` | inbox; `view` = saved view id |
| `GET` | `/enquiries/{id}` | detail incl. `extraction` with provenance |
| `PATCH` | `/enquiries/{id}/extraction` | "edit before use" — body `{ field, value }`, flips origin to `ai_suggested` + `editedBy` |
| `POST` | `/enquiries/{id}/convert` | → `{ opportunityId, tnaId }`; idempotency key required |
| `POST` | `/enquiries/{id}/archive` | reason required when confidence < 0.9 |
| `GET` | `/follow-ups?due=today\|overdue` | queue |
| `GET` | `/follow-ups/{id}/draft?channel=email\|whatsapp` | draft + `costEstimate` |
| `POST` | `/follow-ups/{id}/send` | policy-gated when the channel is billable |

```ts
Enquiry { id, channel, receivedAt, from{name,email,phone}, subject, body, status,
          extraction: { topic, audience, timing, budget|null, confidence, provenance },
          matchedOrganisation?: { id, name, matchReason }, suggestedAction?: SuggestedAction }
SuggestedAction { type, payloadSummary, autonomy, provenance, diff: DiffLine[] }
MessageDraft { channel, templateId, category: "marketing"|"utility"|"service",
               ratePerMessage: Money, recipients: number, estimatedCost: Money,
               body, consent: { channel, granted, recordedAt } }
```

`costEstimate` must come from the server — the WhatsApp category rate is a billing fact, not a display constant.

---

## M05 · TNA

| Method | Path | Notes |
|---|---|---|
| `GET` | `/tna/{id}` | gaps, audience, constraints, evidence |
| `GET` | `/tna/{id}/recommendations` | ranked programmes with fit scores and rationale |
| `POST` | `/tna/{id}/accept-recommendation` | body `{ programmeId }` → `{ proposalId }` |
| `POST` | `/tna/{id}/reopen` | sends the questionnaire back to the client |

```ts
Gap { name, description, evidenceRefs[], priority: "high"|"medium"|"low", provenance }
Recommendation { programmeId, name, fitScore, rationale, trainerAvailability, priceIndication: Money }
```

---

## M06 · Programmes

| Method | Path |
|---|---|
| `GET` | `/programmes?category=&hrdcClaimable=&duration=` |
| `GET` | `/programmes/{id}` — outcomes, modules, pricing tiers, trainer pool, past deliveries |
| `GET` | `/programmes/{id}/deliveries?limit=` |
| `PUT` | `/programmes/{id}` — role-gated to L&D |

`pricingTiers[]` includes `floorPrice` — the costing screen validates against the server value, never a client constant.

---

## M07 · Proposals & quotations

| Method | Path | Notes |
|---|---|---|
| `GET` | `/proposals/{id}` | sections[] each with provenance |
| `POST` | `/proposals` | `{ opportunityId, templateId }` → draft |
| `PUT` | `/proposals/{id}/sections/{n}` | manual edit |
| `POST` | `/proposals/{id}/sections/{n}/regenerate` | → new content + runId |
| `GET` | `/proposals/{id}/preview` | rendered HTML/PDF url |
| `POST` | `/proposals/{id}/submit-for-approval` | **policy-gated** → `202 { approvalId }` |
| `GET` | `/quotations/{id}` | lines, margin, floor |
| `PUT` | `/quotations/{id}` | recalculates margin server-side; returns `validation[]` |
| `POST` | `/quotations/{id}/apply` | writes the price onto the proposal |
| `GET` | `/public/proposals/{token}` | client page, no auth |
| `POST` | `/public/proposals/{token}/comments` | |
| `POST` | `/public/proposals/{token}/accept` | `{ name, role }` → `{ engagementId, acceptedAt, signatureRef }` |

```ts
ProposalSection { n, title, body, mergeFieldsUsed[], provenance }
QuotationLine { item, detail, qty, unit: Money, total: Money }
Validation { field, code: "below_floor_price", severity: "error", message, requiresApproval: "APV-02" }
```

---

## M02 · Approvals

| Method | Path | Notes |
|---|---|---|
| `GET` | `/approvals?group=urgency&filter=` | inbox, grouped: breaching / today / week |
| `GET` | `/approvals/{id}` | the whole decision payload |
| `POST` | `/approvals/{id}/approve` | idempotency key; returns applied `effects[]` |
| `POST` | `/approvals/{id}/reject` | `{ reason }` |
| `POST` | `/approvals/{id}/request-changes` | `{ note }` |
| `POST` | `/approvals/bulk-approve` | rejects `409` if any item is money-moving |
| `GET` | `/approvals/{id}/preview` | the artefact being approved (proposal, invoice, packet) |
| `GET` | `/policies/{id}` | why this needed a human |

```ts
ApprovalRequest {
  id, policyId, type, subject, value?: Money, requestedBy: { kind:"agent"|"user", id, name },
  confidence?, slaDueAt, breached: boolean, autonomy, status,
  reason: string,                    // "why this needs you"
  recommendation: { verdict, rationale, provenance },
  evidence: { n, label, href }[],
  deviations: string[],              // "differs from normal"
  risk: { level: "low"|"medium"|"high", note },
  diff: DiffLine[]                   // "if you approve, this happens"
}
DiffLine { op: "add"|"remove", entity, description }
```

The `diff` is the contract that matters most: the UI promises the user exactly these effects, and `POST /approve` must return the same list as `effects[]`.

---

## M04 / M09 / M10 · Records, engagements, attendance

| Method | Path | Notes |
|---|---|---|
| `GET` | `/organisations/{id}` | header + metrics |
| `GET` | `/organisations/{id}/relations?types=` | engagements, contacts, invoices, HRDC — one call, tabbed client-side |
| `GET` | `/engagements/{id}` | lifecycle, checklist, sessions, finance summary |
| `GET` | `/engagements/{id}/participants?cursor=` | |
| `POST` | `/engagements/{id}/close-out` | 409 if claim incomplete, with `blockers[]` |
| `GET` | `/engagements/{id}/attendance?day=` | rows + lock state |
| `POST` | `/engagements/{id}/attendance/{day}/capture` | `{ participantId, session, method }` — **409 `attendance_locked`** once approved |
| `POST` | `/engagements/{id}/attendance/{day}/approve` | locks immutably |
| `POST` | `/engagements/{id}/attendance/{day}/unlock-request` | destructive; voids the claim packet |
| `GET` | `/engagements/{id}/attendance/export?format=hrdc` | PDF in HRD Corp layout |

```ts
LifecycleStep { key, label, state: "done"|"current"|"pending"|"blocked"|"skipped"|"failed", at?, note? }
AttendanceSheet { day, date, status: "open"|"pending_approval"|"locked", approvedBy?, approvedAt?, immutable: true }
```

Lifecycle steps come from **pipeline configuration**, not from the client — the stepper renders whatever the server sends, in order.

---

## M12 · HRD Corp

| Method | Path | Notes |
|---|---|---|
| `GET` | `/hrdc/packets/{engagementId}` | checklist, completeness, deadline |
| `POST` | `/hrdc/packets/{id}/documents` | attach |
| `GET` | `/hrdc/packets/{id}/export` | zip for the eTRIS upload |
| `POST` | `/hrdc/packets/{id}/mark-submitted` | `{ reference, submittedAt, submittedBy }` — **the only "submit"**; 422 while incomplete |
| `GET` | `/hrdc/deadlines?status=at_risk` | deadline radar |

```ts
ClaimPacket { engagementId, scheme, employerCode, claimValue: Money, completenessPct,
              requiredDocuments: { type, label, status:"present"|"missing", ref?, meta? }[],
              deadlineAt, daysRemaining, submission?: { reference, submittedAt, submittedBy } }
```

There is deliberately **no** `POST /hrdc/submit`. HRD Corp has no API; the packet is assembled here and filed by a human on eTRIS.

---

## M13 · Finance

| Method | Path | Notes |
|---|---|---|
| `GET` | `/invoices?status=&syncState=` | list with sync chips |
| `GET` | `/invoices/{id}` | lines, sync log, payments |
| `POST` | `/invoices` | from engagement; **policy-gated** (FIN-01) |
| `POST` | `/invoices/{id}/push` | re-push to accounting; returns `syncState` |
| `POST` | `/invoices/{id}/payments` | record a payment |
| `GET` | `/receivables/aging` | the aging strip |
| `GET` | `/collections/queue?stage=` | |
| `GET` | `/collections/{invoiceId}/draft` | agent draft + cost estimate |
| `POST` | `/collections/{invoiceId}/send` | **policy-gated** (FIN-03) |

```ts
SyncEvent { at, state: "not_sent"|"sent"|"validated"|"error", detail, errorCode?, uin? }
```

`syncState` is reported, never asserted: TrainOS pushes to the accounting package and mirrors what it hears back about MyInvois validation.

---

## M18 · Agents & automation

| Method | Path | Notes |
|---|---|---|
| `GET` | `/agents` | registry with autonomy per action type |
| `GET` | `/agents/{id}` | tools, prompts, evals, incidents |
| `POST` | `/agents/{id}/kill-switch` | `{ enabled }` — immediate, audited |
| `PUT` | `/agents/{id}/autonomy` | `{ actionType, level }` — **MD-gated**; 422 if a money action is set to `autonomous` |
| `GET` | `/runs?agentId=&status=&cursor=` | run list |
| `GET` | `/runs/{id}` | full trace |
| `POST` | `/runs/{id}/retry` | |
| `POST` | `/runs/{id}/dead-letter` | dismiss with reason |
| `POST` | `/runs/{id}/replay?mode=sandbox` | shadow execution, no side effects |
| `GET` | `/evals?agentId=&window=` | eval dashboard |

```ts
AutomationRun { id, agentId, trigger, model, startedAt, durationMs, cost: Money,
                tokens: { in, out }, status: "succeeded"|"failed"|"halted",
                outcome, steps: RunStep[], guardrails: string[] }
RunStep { seq, tool, args, result, status: "ok"|"retried"|"failed"|"halted",
          retries, durationMs, cost: Money, haltedBy?: { policyId, approvalId } }
```

`haltedBy` is what lets the trace viewer say "the agent never sent anything" — it is a first-class field, not an inference from the logs.

---

## Realtime

Server-sent events on `/events` with a per-user filter. The screens that need it:

- `approval.created` / `approval.decided` → sidebar badge, inbox, dashboard
- `run.completed` / `run.failed` → agent registry, failures badge
- `invoice.sync.changed` → sync chips
- `hrdc.deadline.warning` → compliance badge
- `attendance.locked` → engagement lifecycle

Everything else can poll on navigation.

## Notes for the build

1. **Idempotency keys** on every POST that sends, charges or files. Approvals get double-clicked.
2. **Optimistic UI is unsafe for gated commands** — a send may come back `202 pending_approval`. Show the pending state from the response.
3. **Permissions come from `/me`**, and every gated action also returns `403` with `requiredRole` so the UI can explain rather than just disable.
4. **Saved views** are server-side (`/views?object=lead`) so the pill tabs and their counts stay consistent across devices.
5. **Templates** (proposal, email, WhatsApp, certificate, invoice, HRDC packet) all resolve through `/templates/{id}?version=` — nothing is hardcoded in the frontend.
6. **Theme** is a `/me` preference (`light` | `dark` | `system`); the dark palette is a token swap, so no API shape changes.


---

## AI operations (update pass)

Six new screens, summarised here; the full shapes are in **API_CONTRACT.md §17**.

| Method | Path | Screen |
|---|---|---|
| `GET/PUT` | `/ai/tiers`, `/ai/routing` | M20-S20 model tiers and the action→tier matrix. Routing changes apply to future runs only. |
| `GET/POST` | `/ai/providers` (+ `/test`, `/rotate`, `/reveal`) | M20-S21 BYOK keys. Keys are write-only and always masked; reveal is a separate audited call. |
| `GET` | `/ai/usage`, `/ai/usage/forecast`, `/ai/budgets` | M20-S16 cost by tier, agent, action type; caps that pause an action when tripped. |
| `GET/POST` | `/compliance/rules` | M12-S07 rules registry. Checks resolve rules **as at the training date**, via `?asOf=`. |
| `GET` | `/compliance/rule-changes/{documentId}` | M12-S08 proposed diffs from an ingested circular, each with its source span. |
| `GET` | `/compliance/checks?engagementRef=` | Rule checks on M12-S02 and M09-S02. A `FAIL` sets the HRDC lifecycle step to `BLOCKED`. |
| `GET/POST` | `/knowledge/sources` (+ `/check`, `/reingest`) | M16-S05 corpus freshness and monitoring. |

Two contract changes ripple everywhere:

- **`provenance` gains `tier`, `model`, `provider`, `cacheHitRate`** and an optional `jury` block. The AI badge popover renders exactly those fields, so no screen composes that string itself.
- **`GET /runs/{id}` returns `nodes[]`, `events[]` and `stateCard`** instead of a flat step list. `haltedBy` stays first-class; `POST /runs/{id}/retry?from=checkpoint` resumes from the stored state card.
