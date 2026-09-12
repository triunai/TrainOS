# TrainOS — API contract

Derived from the twenty demo-pack screens and their handoff notes. Implementation-agnostic: HTTP + JSON, no framework, ORM or platform assumed. Examples use the demo fixtures (Aurora Manufacturing, PRO-2026-0184, APV-2026-0771, ENG-0231, run #4821), so they double as seed data.

---

## 1 · Conventions

Base path `/v1`. Resource nouns, plural. **Tenant is implicit from auth** and never appears in a path or body.

**Entity envelope** — every resource carries:

```json
{
  "id": "0f2a6c14-9f3b-4c58-9a41-6d2b7d0c8e11",
  "ref": "ENQ-2026-0912",
  "createdAt": "2026-09-11T08:52:04+08:00",
  "updatedAt": "2026-09-11T09:05:31+08:00",
  "createdBy": { "id": "sys", "name": "Email ingest", "kind": "SYSTEM" }
}
```

`createdBy.kind` ∈ `HUMAN | AGENT | SYSTEM`.

**Money** — integer minor units, never floats. **Percentages** — decimal fractions.

```json
{ "amount": 1850000, "currency": "MYR" }   // RM 18,500.00
"marginRate": 0.41
```

**Dates** — ISO-8601 with offset: `2026-11-12T09:00:00+08:00`. Date-only fields use `2026-11-12`.

**Enums** — `UPPER_SNAKE` strings. Full catalogue in §12.

**Lists**

```
GET /v1/enquiries
  ?filter[status][eq]=OPEN
  &filter[channel][in]=EMAIL,WHATSAPP
  &filter[estimatedValue][gte]=500000
  &filter[receivedAt][between]=2026-09-04,2026-09-11
  &filter[subject][contains]=leadership
  &sort=-receivedAt
  &page[size]=50&page[cursor]=eyJpZCI6…
  &view=6b1f…                      // saved view; merges its filters, request filters win
```

Operators: `eq · in · gte · lte · contains · between`. Response:

```json
{
  "data": [ … ],
  "page": { "next": "eyJpZCI6…", "total": 18 },
  "appliedFilters": [ { "field": "status", "op": "eq", "value": "OPEN", "source": "REQUEST" } ]
}
```

**Provenance envelope** — present on any AI-touched field or record, absent means human-authored:

```json
"provenance": {
  "origin": "AI_GENERATED",
  "confidence": 0.94,
  "agentId": "agent_lead",
  "runId": "run_4821",
  "sources": [
    { "type": "EMAIL", "ref": "ENQ-2026-0912", "excerpt": "approximately 30 managers, preferably in November" },
    { "type": "TNA", "ref": "TNA-0042", "excerpt": "conflict resolution · cross-functional communication" }
  ],
  "generatedAt": "2026-09-11T08:53:02+08:00",
  "editedBy": { "id": "u_amirah", "name": "Amirah Yusof", "at": "2026-09-11T09:31:10+08:00" }
}
```

`origin` ∈ `HUMAN | SYSTEM | AI_SUGGESTED | AI_GENERATED | AI_EXECUTED`.

**Idempotency** — every state-changing `POST` accepts `Idempotency-Key`. Replay of a key with an identical body returns the original response with `200` and header `Idempotent-Replay: true`. Replay with a different body returns `409 IDEMPOTENT_REPLAY`. Keys are retained 24 hours.

**Errors**

```json
{ "error": { "code": "POLICY_APPROVAL_REQUIRED", "message": "Proposal value exceeds RM 15,000 and this is the first proposal to this organisation.",
  "details": { "policyId": "APV-01", "threshold": { "amount": 1500000, "currency": "MYR" } },
  "approvalRequestId": "0d55…" } }
```

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_FAILED` | 422 | `details.fields[]` with field + reason |
| `NOT_FOUND` | 404 | |
| `FORBIDDEN` | 403 | `details.requiredRole` so the UI can explain, not just disable |
| `POLICY_APPROVAL_REQUIRED` | 202 | Not an error path in practice — carries `approvalRequestId`; see §3 |
| `ATTENDANCE_LOCKED` | 409 | Approved attendance is immutable (HRD Corp rule) |
| `FLOOR_PRICE_BREACH` | 422 | `details.floorPrice`, `details.resultingMargin`, `details.requiresPolicy: "APV-02"` |
| `SYNC_FAILED` | 502 | `details.provider`, `details.providerCode` e.g. `CUSTOMER_NOT_MAPPED` |
| `AGENT_PAUSED` | 409 | Action routed to a paused agent |
| `SLA_BREACHED` | 200 + flag | Never blocks; surfaced as `slaBreached: true` on the approval |
| `IDEMPOTENT_REPLAY` | 409 | Same key, different body |

**Roles** — `SALES · SALES_MANAGER · OPS · FINANCE · MD · ADMIN · TRAINER · CLIENT · AGENT`. `AGENT` is a service principal scoped per agent; its grants are the autonomy matrix in §10.

---

## 2 · Session and shell

### `GET /v1/me` · who is looking · all roles · every screen

```json
{ "id": "u_amirah", "name": "Amirah Yusof", "role": "SALES",
  "permissions": ["enquiry:read","enquiry:convert","proposal:write","proposal:submit"],
  "dataScope": { "clients": "MY_ACCOUNTS", "teams": "MY_TEAM" },
  "locale": "en-MY", "timezone": "Asia/Kuala_Lumpur", "theme": "LIGHT" }
```

### `GET /v1/navigation` · role-filtered nav tree with badge counts · all roles · every screen

```json
{ "groups": [ { "caption": "MAIN", "parents": [
  { "key": "home", "label": "Home", "icon": "home", "children": [
      { "key": "dashboard", "label": "Dashboard", "path": "/dashboards/executive" },
      { "key": "approvals", "label": "Approvals", "path": "/approvals",
        "badge": { "count": 7, "severity": "DEFAULT" } } ] } ] } ] }
```

`badge.severity` ∈ `DEFAULT | ALERT`. `ALERT` only when something in that queue has breached SLA or a deadline.

### `GET /v1/search?q=aurora&types=ORGANISATION,PROPOSAL,ACTION` · ⌘K · all roles

```json
{ "records": [ { "type": "ORGANISATION", "ref": "ORG-0114", "title": "Aurora Manufacturing Sdn Bhd", "subtitle": "Organisation 360", "path": "/organisations/…" } ],
  "actions": [ { "type": "PROPOSAL_CREATE", "label": "Create proposal for Aurora Manufacturing", "targetRef": "ORG-0114" } ] }
```

### `GET /v1/{resourceType}/{id}/audit` · audit drawer · all roles · every record screen

```json
{ "data": [ { "at": "2026-09-11T09:14:02+08:00", "actor": { "kind": "AGENT", "id": "agent_proposal", "name": "Proposal Agent" },
  "event": "ProposalDrafted", "summary": "Drafted PRO-2026-0184 from tpl_proposal_std_v7", "runId": "run_4821" } ],
  "page": { "next": null, "total": 12 } }
```

### `GET /v1/views?object=LEAD` · saved views (pill tabs) · all roles

```json
{ "data": [ { "id": "6b1f…", "label": "My open leads", "object": "LEAD", "count": 48, "isDefault": true,
  "filters": [ { "field": "ownerId", "op": "eq", "value": "u_amirah" } ], "columns": ["contact","organisation","stage","owner","value","createdAt","score"] } ] }
```

`POST /v1/views` · `PATCH /v1/views/{id}` · `DELETE /v1/views/{id}` — same shape.

### `GET /v1/templates?type=PROPOSAL` · read-only for the demo · all roles

```json
{ "data": [ { "id": "tpl_proposal_std_v7", "type": "PROPOSAL", "version": 7, "label": "Standard proposal",
  "mergeFields": ["client.name","contact.name","programme.title","engagement.dates","investment.total"],
  "sections": [ { "n": 1, "title": "Understanding your needs", "aiEnabled": true } ] } ] }
```

Types: `PROPOSAL · QUOTATION · CERTIFICATE · EMAIL · WHATSAPP · INVOICE · TNA_QUESTIONNAIRE · EVALUATION · HRDC_PACKET`. WhatsApp templates additionally carry `category` and `ratePerMessage` — see §7.

### `GET /v1/policies` · read-only for the demo · all roles

```json
{ "data": [ { "id": "APV-01", "actionType": "PROPOSAL_SEND", "description": "Proposal send above RM 15,000 or first proposal to an organisation",
  "conditions": [ { "field": "payload.value.amount", "op": "gte", "value": 1500000 }, { "field": "context.firstProposalToOrg", "op": "eq", "value": true } ],
  "combinator": "ANY", "approverRole": "SALES_MANAGER", "slaMinutes": 240, "escalateToRole": "MD", "escalateAfterMinutes": 360 } ] }
```

---

## 3 · The action envelope

Everything a human can do and an agent can propose goes through one endpoint. This is the centre of the contract: the UI never decides whether something executes.

### `POST /v1/actions` · perform or propose an action · all roles incl. `AGENT` · every screen with a primary button

```json
{
  "type": "PROPOSAL_SEND",
  "targetRef": "PRO-2026-0184",
  "payload": { "channel": "EMAIL", "templateId": "tpl_email_proposal_v3", "to": ["nurul.hassan@auroramfg.com.my"], "cc": ["amirah.yusof@akademiperdana.my"], "attachPdf": true },
  "requestedBy": { "kind": "AGENT", "id": "agent_proposal" },
  "confidence": 0.82,
  "reasoning": "TNA-0042 gaps map to PRG-0031; Farah Aziz available 12–13 Nov; margin 0.41 above floor.",
  "evidence": [
    { "type": "EMAIL", "ref": "ENQ-2026-0912", "excerpt": "30 managers, November, conflict management" },
    { "type": "TNA", "ref": "TNA-0042" },
    { "type": "PROGRAMME", "ref": "PRG-0031" },
    { "type": "TRAINER_AVAILABILITY", "ref": "TRN-0007" },
    { "type": "QUOTATION", "ref": "QUO-2026-0184", "excerpt": "margin 0.41, floor 0.35" }
  ]
}
```

**Action types** — `ENQUIRY_ARCHIVE · OPPORTUNITY_CONVERT · TNA_RECOMMENDATION_ACCEPT · PROPOSAL_SEND · QUOTATION_APPLY · DISCOUNT_APPROVE · TRAINER_BOOK · ENGAGEMENT_CLOSE_OUT · ATTENDANCE_APPROVE · ATTENDANCE_UNLOCK · HRDC_PACKET_MARK_SUBMITTED · INVOICE_CREATE · INVOICE_PUSH · PAYMENT_RECORD · REMINDER_SEND · FOLLOWUP_SEND · BROADCAST_SEND · AGENT_AUTONOMY_CHANGE · AGENT_PAUSE`.

**Policy evaluation inputs** — the endpoint resolves, in order:

1. `type` → the autonomy level granted to `requestedBy` for that action type (§10). Human requesters skip to step 3.
2. `payload` monetary value, compared against policy thresholds.
3. Context flags computed server-side: `firstProposalToOrg`, `belowFloorPrice`, `overdueBalanceOnAccount`, `attendanceLocked`, `deadlineWithinDays`.
4. `confidence` against the agent's minimum for that action.
5. Requester role against the policy's `approverRole` — a user cannot approve their own request.

**Responses**

```json
202 { "status": "EXECUTED", "result": { "proposalId": "…", "sentAt": "2026-09-11T11:20:14+08:00", "effects": [ … ] } }
```

```json
202 {
  "status": "QUEUED_FOR_APPROVAL",
  "approvalRequest": {
    "id": "0d55…", "ref": "APV-2026-0771", "policyId": "APV-01",
    "approverRole": "SALES_MANAGER", "assignedTo": { "id": "u_kelvin", "name": "Kelvin Tan" },
    "slaDueAt": "2026-09-11T13:14:00+08:00", "createdAt": "2026-09-11T09:14:12+08:00"
  }
}
```

```json
200 { "status": "SUGGESTED", "draft": { "id": "drf_88…", "type": "FOLLOWUP_SEND", "body": "…", "expiresAt": "2026-09-18T00:00:00+08:00" } }
```

Idempotent: yes. Emits: `ActionRequested`, then `ApprovalRequested` or the type's own event. Policy-gated: by definition.

---

## 4 · Enquiries, leads and follow-ups

### `GET /v1/enquiries` · inbox · SALES, SALES_MANAGER · M03-S01

```json
{ "data": [ {
  "id": "…", "ref": "ENQ-2026-0912", "channel": "EMAIL", "status": "OPEN",
  "receivedAt": "2026-09-11T08:52:04+08:00",
  "from": { "name": "Nurul Hassan", "email": "nurul.hassan@auroramfg.com.my", "phone": null },
  "subject": "Leadership training for 30 managers",
  "preview": "Hi, we're looking for leadership training for approximately 30 managers…",
  "classification": { "label": "LEADERSHIP", "provenance": { "origin": "AI_GENERATED", "confidence": 0.94, "agentId": "agent_lead", "runId": "run_4788", "generatedAt": "2026-09-11T08:53:02+08:00" } },
  "estimatedValue": { "amount": 1850000, "currency": "MYR" },
  "matchedOrganisation": { "id": "…", "ref": "ORG-0114", "name": "Aurora Manufacturing Sdn Bhd", "matchReason": "EXACT_DOMAIN" },
  "assignedTo": null, "createdAt": "…", "updatedAt": "…", "createdBy": { "kind": "SYSTEM", "id": "ingest_email", "name": "Email ingest" }
} ], "page": { "next": null, "total": 18 }, "appliedFilters": [] }
```

Items below the classification threshold return `classification.needsHumanReview: true` (the 0.41 WhatsApp row) and are never auto-archived.

### `GET /v1/enquiries/{id}` · detail · SALES · M03-S02

Adds:

```json
{ "body": "Hi, we're looking for leadership training for approximately 30 managers, preferably in November, focused on conflict management and communication.",
  "extraction": {
    "topic": { "value": "Conflict & communication", "provenance": { "origin": "AI_GENERATED", "confidence": 0.94, "agentId": "agent_lead", "runId": "run_4788", "sources": [ { "type": "EMAIL", "ref": "ENQ-2026-0912", "excerpt": "conflict management and communication" } ] } },
    "audience": { "value": "30 line managers", "provenance": { "origin": "AI_GENERATED", "confidence": 0.94 } },
    "timing": { "value": "2026-11", "provenance": { "origin": "AI_SUGGESTED", "confidence": 0.88, "editedBy": { "id": "u_amirah", "name": "Amirah Yusof", "at": "2026-09-11T09:03:00+08:00" } } },
    "budget": { "value": null, "provenance": { "origin": "AI_GENERATED", "confidence": 0.97 } }
  },
  "suggestedAction": { "type": "OPPORTUNITY_CONVERT", "autonomy": "ACT_WITH_APPROVAL", "summary": "Convert to OPP-0512 at RM 18,500, attach TNA-0042, shortlist PRG-0031",
    "payload": { "value": { "amount": 1850000, "currency": "MYR" }, "questionnaireTemplateId": "tpl_tna_std_v3", "programmeId": "PRG-0031" },
    "provenance": { "origin": "AI_SUGGESTED", "confidence": 0.91, "agentId": "agent_lead", "runId": "run_4788" } },
  "related": [ { "type": "ORGANISATION", "ref": "ORG-0114", "label": "4 engagements" },
               { "type": "CONTACT", "ref": "CON-0233", "label": "HR Manager · consented" },
               { "type": "INVOICE", "ref": "INV-2026-0288", "label": "overdue 34 days", "severity": "ALERT" } ] }
```

### `PATCH /v1/enquiries/{id}/extraction` · edit before use · SALES · M03-S02

Request `{ "field": "timing", "value": "2026-11" }`. The field's provenance flips to `AI_SUGGESTED` with `editedBy`. Idempotent: no (last write wins). Emits: none.

### `POST /v1/actions` `type: OPPORTUNITY_CONVERT` · SALES · M03-S01, M03-S02

```json
202 { "status": "EXECUTED", "result": {
  "opportunity": { "id": "…", "ref": "OPP-0512", "stage": "QUALIFYING", "value": { "amount": 1850000, "currency": "MYR" } },
  "tna": { "id": "…", "ref": "TNA-0042", "status": "SENT" },
  "effects": [ { "op": "CREATE", "entity": "Opportunity", "ref": "OPP-0512" },
               { "op": "CREATE", "entity": "TNA", "ref": "TNA-0042" },
               { "op": "UPDATE", "entity": "Enquiry", "ref": "ENQ-2026-0912", "description": "status OPEN → CONVERTED" } ] } }
```

Not policy-gated (no money moves, nothing leaves the system). Emits `OpportunityCreated`.

### `GET /v1/follow-ups?filter[due][eq]=TODAY` · queue · SALES · M03-S06

```json
{ "data": [ { "id": "…", "ref": "FUP-0311", "contact": { "ref": "CON-0233", "name": "Nurul Hassan" },
  "organisation": { "ref": "ORG-0114", "name": "Aurora Manufacturing Sdn Bhd" },
  "reason": "PRO-2026-0184 sent 11 Sep · not opened since 13 Sep",
  "dueDate": "2026-09-16", "status": "DUE", "autonomy": "SUGGEST" } ], "page": { "next": null, "total": 9 } }
```

### `GET /v1/follow-ups/{id}/draft?channel=WHATSAPP` · SALES · M03-S06

```json
{ "channel": "WHATSAPP", "templateId": "tpl_followup_proposal_v2", "category": "UTILITY",
  "body": "Hi Puan Nurul, following up on the leadership proposal we sent on 11 September…",
  "recipients": 1,
  "ratePerMessage": { "amount": 6, "currency": "MYR" },
  "estimatedCost": { "amount": 6, "currency": "MYR" },
  "alternativeCategoryRate": { "category": "MARKETING", "ratePerMessage": { "amount": 35, "currency": "MYR" } },
  "consent": { "channel": "WHATSAPP", "granted": true, "recordedAt": "2024-03-04T10:12:00+08:00" },
  "provenance": { "origin": "AI_SUGGESTED", "confidence": 0.82, "agentId": "agent_followup", "runId": "run_4899" } }
```

Rates are server-side facts: `RM 0.0564` utility, `RM 0.3467` marketing, expressed in minor units (rounded to the sen at estimate time; the exact rate is returned as `ratePerMessageExact: "0.0564"` for display).

Send via `POST /v1/actions` `type: FOLLOWUP_SEND`. At `SUGGEST` autonomy an agent caller gets `200 SUGGESTED`; a human caller gets `202 EXECUTED`.

---

## 5 · Organisations, contacts, opportunities

### `GET /v1/organisations/{id}` · record header · SALES, FINANCE, MD · M04-S02

```json
{ "id": "…", "ref": "ORG-0114", "name": "Aurora Manufacturing Sdn Bhd",
  "industry": "MANUFACTURING", "location": "Shah Alam", "owner": { "id": "u_amirah", "name": "Amirah Yusof" },
  "status": "ACTIVE_CLIENT", "hrdcRegistered": true, "hrdcEmployerCode": "HRDC-2201-8834",
  "metrics": {
    "lifetimeValue": { "amount": 21430000, "currency": "MYR", "drillTo": "/v1/invoices?filter[organisationId][eq]=…&filter[status][eq]=PAID" },
    "openPipeline": { "amount": 1850000, "currency": "MYR", "drillTo": "/v1/opportunities?filter[organisationId][eq]=…&filter[stage][in]=QUALIFYING,PROPOSAL_SENT" },
    "arOverdue": { "amount": 1240000, "currency": "MYR", "drillTo": "/v1/receivables?filter[organisationId][eq]=…" },
    "hrdcLevyAvailable": { "amount": 6100000, "currency": "MYR", "drillTo": "/v1/hrdc/packets?filter[organisationId][eq]=…" },
    "healthScore": { "value": 74, "drillTo": "/v1/organisations/…/health" } },
  "createdAt": "2024-03-04T09:00:00+08:00", "updatedAt": "2026-11-14T10:04:00+08:00" }
```

Each metric carries its own `drillTo` — the UI never hardcodes a drill route.

### `GET /v1/organisations/{id}/relations?types=ENGAGEMENT,CONTACT,INVOICE,HRDC` · M04-S02

```json
{ "engagements": [ { "ref": "ENG-0231", "title": "Leading Through Change", "dates": "2026-11-12/2026-11-13",
    "value": { "amount": 1850000, "currency": "MYR" },
    "lifecycle": [ { "key": "ENQUIRY", "state": "DONE" }, { "key": "TNA", "state": "DONE" }, { "key": "PROPOSAL", "state": "DONE" },
                   { "key": "APPROVAL", "state": "CURRENT" }, { "key": "SENT", "state": "PENDING" }, { "key": "DELIVERY", "state": "PENDING" } ] } ],
  "contacts": [ { "ref": "CON-0233", "name": "Nurul Hassan", "role": "HR Manager", "primary": true, "consent": { "email": true, "whatsapp": true } },
                { "ref": "CON-0241", "name": "Ravi Subramaniam", "role": "Plant Director", "consent": { "email": false, "whatsapp": false }, "pdpaFlag": "NO_CONSENT" } ],
  "invoices": [ { "ref": "INV-2026-0288", "status": "OVERDUE", "daysOverdue": 34, "amount": { "amount": 1240000, "currency": "MYR" } } ],
  "hrdc": { "employerCode": "HRDC-2201-8834", "levyAvailable": { "amount": 6100000, "currency": "MYR" },
            "packets": [ { "ref": "ENG-0198", "state": "BLOCKED", "missingDocuments": 2 }, { "ref": "ENG-0231", "state": "DEADLINE_AT_RISK", "daysRemaining": 3 } ] } }
```

Lifecycle steps come from **pipeline configuration** (`GET /v1/config/pipelines?object=ENGAGEMENT`), never from the client.

### `GET /v1/organisations/{id}/suggestions` · cross-sell panel · SALES · M04-S02

```json
{ "data": [ { "type": "CROSS_SELL", "programmeId": "PRG-0018", "title": "Conflict to Collaboration",
  "rationale": "RM 61,000 unused levy expiring 31 Dec; 42 supervisors have not attended any programme; the programme scored 4.6 with their managers.",
  "provenance": { "origin": "AI_SUGGESTED", "confidence": 0.76, "agentId": "agent_knowledge",
    "sources": [ { "type": "HRDC_STATEMENT", "ref": "HRDC-2201-8834" }, { "type": "PARTICIPANT_QUERY", "ref": "ORG-0114/no-attendance" } ] },
  "actions": [ { "type": "OPPORTUNITY_CREATE", "label": "Create opportunity" }, { "type": "SUGGESTION_DISMISS", "label": "Dismiss" } ] } ] }
```

Also: `GET /v1/contacts`, `GET /v1/contacts/{id}`, `GET /v1/opportunities`, `GET /v1/opportunities/{id}`, `PATCH /v1/opportunities/{id}` (stage changes emit `OpportunityStageChanged`).

---

## 6 · TNA, programmes, proposals, costings

### `GET /v1/tnas/{id}` · SALES · M05-S02

```json
{ "id": "…", "ref": "TNA-0042", "opportunityRef": "OPP-0512", "status": "COMPLETE",
  "completedBy": { "id": "c_nurul", "name": "Nurul Hassan", "kind": "CLIENT" }, "completedAt": "2026-09-11T09:10:00+08:00",
  "audience": { "headcount": 30, "level": "LINE_MANAGER", "sites": ["Shah Alam","Klang"], "language": "EN" },
  "constraints": [ { "code": "DELIVERY_WINDOW", "label": "November 2026", "severity": "WARN" },
                   { "code": "MAX_DAYS_OFF_FLOOR", "label": "Max 2 days" },
                   { "code": "HRDC_CLAIMABLE_REQUIRED", "label": "Must be claimable" } ],
  "budget": null,
  "gaps": [ { "name": "Conflict resolution", "description": "Production vs quality escalations", "priority": "HIGH",
    "evidenceRefs": ["Q4","Q7"], "provenance": { "origin": "AI_GENERATED", "confidence": 0.91, "agentId": "agent_tna", "runId": "run_4884" } } ],
  "evidence": [ { "type": "EMAIL", "ref": "ENQ-2026-0912" }, { "type": "QUESTIONNAIRE", "ref": "TNA-0042/responses" },
                { "type": "HISTORY", "ref": "ORG-0114/2024-2025" }, { "type": "CATALOGUE", "ref": "PRG-*/nov-availability" } ] }
```

### `GET /v1/tnas/{id}/recommendations` · SALES · M05-S02

```json
{ "data": [
  { "programmeId": "PRG-0031", "name": "Leading Through Change", "fitScore": 0.91,
    "rationale": "Covers both high-priority gaps; Farah Aziz free 12–13 Nov.",
    "priceIndication": { "amount": 1850000, "currency": "MYR" },
    "trainerAvailability": [ { "trainerRef": "TRN-0007", "name": "Farah Aziz", "available": true, "dates": "2026-11-12/2026-11-13" } ] },
  { "programmeId": "PRG-0018", "name": "Conflict to Collaboration", "fitScore": 0.78, "rationale": "Covers conflict only; no communication module." },
  { "programmeId": "PRG-0044", "name": "Data Literacy for Managers", "fitScore": 0.22, "rationale": "No gap match; listed for completeness." } ],
  "provenance": { "origin": "AI_GENERATED", "confidence": 0.89, "agentId": "agent_tna", "runId": "run_4884",
    "sources": [ { "type": "TNA", "ref": "TNA-0042" }, { "type": "CATALOGUE", "ref": "PRG-*" } ] },
  "scoringModel": { "version": "fit-v3", "weights": { "gapCoverage": 0.5, "audienceFit": 0.2, "windowFit": 0.2, "trainerAvailability": 0.1 } } }
```

### `GET /v1/programmes/{id}` · SALES, OPS · M06-S02

```json
{ "id": "…", "ref": "PRG-0031", "name": "Leading Through Change", "category": "LEADERSHIP", "days": 2, "version": 4,
  "status": "ACTIVE", "hrdcScheme": "SBL_KHAS", "hrdcClaimable": true,
  "listPrice": { "amount": 1850000, "currency": "MYR" }, "listPricePax": 30,
  "floorPrice": { "amount": 1390000, "currency": "MYR" }, "floorMarginRate": 0.35,
  "outcomes": ["Name the four escalation patterns that stall cross-team work", "…"],
  "modules": [ { "n": 1, "title": "Reading the escalation", "format": "FACILITATED", "durationMinutes": 90 } ],
  "pricingTiers": [ { "maxPax": 20, "price": { "amount": 1450000, "currency": "MYR" } },
                    { "maxPax": 30, "price": { "amount": 1850000, "currency": "MYR" } },
                    { "maxPax": 40, "price": { "amount": 2240000, "currency": "MYR" } } ],
  "trainerPool": [ { "trainerRef": "TRN-0007", "name": "Farah Aziz", "tttCertified": true, "tttRef": "TTT-2019-4471", "rating": 4.7 },
                   { "trainerRef": "TRN-0012", "name": "Daniel Wong", "tttCertified": true, "rating": 4.4 } ],
  "materials": [ { "type": "WORKBOOK", "version": 4, "languages": ["EN"] } ],
  "stats": { "deliveries": 14, "averageEvaluation": 4.5 } }
```

`GET /v1/programmes/{id}/deliveries` returns the past-deliveries table. `PUT /v1/programmes/{id}` is `ADMIN` + L&D only (`FORBIDDEN` with `requiredRole` for SALES).

### `POST /v1/proposals` · SALES · M05-S02 → M07-S02

Request `{ "opportunityRef": "OPP-0512", "templateId": "tpl_proposal_std_v7", "programmeId": "PRG-0031" }`. Idempotent: yes. Emits `ProposalDrafted`.

### `GET /v1/proposals/{id}` · SALES, SALES_MANAGER · M07-S02, M02-S02

```json
{ "id": "…", "ref": "PRO-2026-0184", "opportunityRef": "OPP-0512", "templateId": "tpl_proposal_std_v7",
  "status": "DRAFT", "value": { "amount": 1850000, "currency": "MYR" }, "marginRate": 0.41,
  "runId": "run_4821",
  "sections": [
    { "n": 1, "title": "Understanding your needs",
      "body": "Aurora Manufacturing's 30 line managers report friction between production and quality teams…",
      "mergeFieldsUsed": ["contact.name"],
      "provenance": { "origin": "AI_GENERATED", "confidence": 0.88, "agentId": "agent_proposal", "runId": "run_4821",
        "sources": [ { "type": "TNA", "ref": "TNA-0042" } ], "generatedAt": "2026-09-11T09:14:09+08:00" } },
    { "n": 3, "title": "Delivery plan", "provenance": { "origin": "AI_SUGGESTED", "confidence": 0.9,
        "editedBy": { "id": "u_amirah", "name": "Amirah Yusof", "at": "2026-09-11T09:31:10+08:00" } } },
    { "n": 5, "title": "HRDC claim guidance", "needsReview": true,
      "provenance": { "origin": "AI_GENERATED", "confidence": 0.41, "agentId": "agent_proposal", "runId": "run_4821" } } ],
  "warnings": [ { "code": "LOW_CONFIDENCE_SECTION", "sectionN": 5, "message": "Generated at 0.41 confidence; the 2026 SBL-Khas wording could not be verified." } ] }
```

`PUT /v1/proposals/{id}/sections/{n}` (manual edit) · `POST /v1/proposals/{id}/sections/{n}/regenerate` (returns new body + `runId`) · `GET /v1/proposals/{id}/preview?format=HTML|PDF`.

Send is **not** a proposal endpoint — it is `POST /v1/actions` `type: PROPOSAL_SEND`, which is how APV-01 intercepts it.

### `GET /v1/costings/{id}` · SALES, FINANCE · M07-S03

```json
{ "id": "…", "ref": "QUO-2026-0184", "proposalRef": "PRO-2026-0184", "rateCardYear": 2026,
  "lines": [ { "item": "TRAINER_FEE", "detail": "Farah Aziz · TTT certified", "qty": 2, "unit": "DAY",
               "rate": { "amount": 480000, "currency": "MYR" }, "total": { "amount": 960000, "currency": "MYR" } },
             { "item": "VENUE", "detail": "Client site · Aurora HQ Shah Alam", "qty": 0, "total": { "amount": 0, "currency": "MYR" } },
             { "item": "MATERIALS", "qty": 30, "rate": { "amount": 4000, "currency": "MYR" }, "total": { "amount": 120000, "currency": "MYR" } },
             { "item": "TRAVEL", "qty": 2, "rate": { "amount": 30000, "currency": "MYR" }, "total": { "amount": 60000, "currency": "MYR" } } ],
  "sellPrice": { "amount": 1850000, "currency": "MYR" },
  "directCost": { "amount": 1140000, "currency": "MYR" },
  "marginRate": 0.41, "floorPrice": { "amount": 1390000, "currency": "MYR" }, "floorMarginRate": 0.35,
  "commissionRate": 0.08, "commission": { "amount": 148000, "currency": "MYR" }, "commissionPayableOn": "COLLECTION" }
```

`PUT /v1/costings/{id}` recalculates server-side. A sell price below floor returns:

```json
422 { "error": { "code": "FLOOR_PRICE_BREACH", "message": "RM 12,400 is below the RM 13,900 floor for 30 pax.",
  "details": { "floorPrice": { "amount": 1390000, "currency": "MYR" }, "resultingMarginRate": 0.08, "requiresPolicy": "APV-02" } } }
```

The UI renders that as the red field state. Applying the price anyway goes through `POST /v1/actions` `type: DISCOUNT_APPROVE`.

---

## 7 · Approvals

### `GET /v1/approvals?group=URGENCY` · SALES_MANAGER, MD, FINANCE · M02-S01

```json
{ "data": [ {
  "id": "…", "ref": "APV-2026-0771", "policyId": "APV-01", "actionType": "PROPOSAL_SEND",
  "subject": "Send proposal · Aurora Manufacturing Sdn Bhd", "targetRef": "PRO-2026-0184",
  "value": { "amount": 1850000, "currency": "MYR" },
  "requestedBy": { "kind": "AGENT", "id": "agent_proposal", "name": "Proposal Agent" },
  "confidence": 0.82, "autonomy": "ACT_WITH_APPROVAL",
  "slaDueAt": "2026-09-11T13:14:00+08:00", "slaRemainingMinutes": 120, "slaBreached": false,
  "status": "PENDING", "bulkApprovable": false, "urgencyGroup": "TODAY"
} ], "page": { "next": null, "total": 7 },
  "groups": [ { "key": "BREACHING", "count": 1 }, { "key": "TODAY", "count": 4 }, { "key": "THIS_WEEK", "count": 2 } ] }
```

`bulkApprovable` is server-decided: `false` for any action carrying a monetary value.

### `GET /v1/approvals/{id}` · SALES_MANAGER, MD · M02-S02

```json
{ "id": "…", "ref": "APV-2026-0771", "policyId": "APV-01", "actionType": "PROPOSAL_SEND",
  "subject": "Send proposal · Aurora Manufacturing Sdn Bhd", "targetRef": "PRO-2026-0184",
  "value": { "amount": 1850000, "currency": "MYR" }, "marginRate": 0.41,
  "requestedBy": { "kind": "AGENT", "id": "agent_proposal", "name": "Proposal Agent", "runId": "run_4821" },
  "confidence": 0.82, "slaDueAt": "2026-09-11T13:14:00+08:00", "slaBreached": false,
  "reason": "Value above the RM 15,000 threshold in policy APV-01, and this is the first proposal to this organisation.",
  "recommendation": { "verdict": "SEND_AS_DRAFTED", "rationale": "Gap coverage complete, margin above floor, trainer confirmed available." },
  "evidence": [
    { "n": 1, "type": "EMAIL", "ref": "ENQ-2026-0912", "label": "Enquiry email, 11 Sep — 30 managers, November, conflict & communication" },
    { "n": 2, "type": "TNA", "ref": "TNA-0042", "label": "Competency gaps confirmed by Nurul Hassan" },
    { "n": 3, "type": "PROGRAMME", "ref": "PRG-0031", "label": "Leading Through Change — 2 days, RM 18,500 / 30 pax" },
    { "n": 4, "type": "TRAINER", "ref": "TRN-0007", "label": "Farah Aziz available 12–13 Nov" },
    { "n": 5, "type": "QUOTATION", "ref": "QUO-2026-0184", "label": "Margin 41%, above 35% floor" } ],
  "deviations": [ "Client requested November specifically.", "Only one matched trainer is available in that window." ],
  "risk": { "level": "MEDIUM", "note": "Single trainer dependency — if Farah Aziz withdraws, the November window has no second-choice match at this competency level." },
  "diff": [
    { "op": "UPDATE", "entity": "Proposal", "ref": "PRO-2026-0184", "description": "status DRAFT → SENT" },
    { "op": "ADD", "entity": "Email", "description": "To nurul.hassan@auroramfg.com.my with PDF attachment" },
    { "op": "UPDATE", "entity": "Opportunity", "ref": "OPP-0512", "description": "stage → PROPOSAL_SENT" },
    { "op": "ADD", "entity": "Task", "description": "Follow-up for Amirah, due 16 Sep 2026" },
    { "op": "REMOVE", "entity": "Quotation", "ref": "QUO-2026-0184", "description": "Draft lock released" } ],
  "previewUrl": "/v1/proposals/…/preview?format=HTML" }
```

### `POST /v1/approvals/{id}/decide` · SALES_MANAGER, MD · M02-S01, M02-S02

```json
{ "decision": "APPROVE", "note": null }
```

`decision` ∈ `APPROVE | REQUEST_CHANGES | REJECT`. `note` required for the latter two.

```json
200 { "status": "APPROVED", "decidedBy": { "id": "u_kelvin", "name": "Kelvin Tan" }, "decidedAt": "2026-09-11T11:20:14+08:00",
  "effects": [ { "op": "UPDATE", "entity": "Proposal", "ref": "PRO-2026-0184", "description": "status DRAFT → SENT" }, … ] }
```

`effects[]` **must match** the `diff[]` shown on the detail screen. If the world changed since the diff was computed, return `409` with `details.diffChanged: true` and the recomputed diff. Idempotent: yes. Emits `ApprovalDecided`, then the action's own event.

`POST /v1/approvals/bulk-decide` — `409` if any id has `bulkApprovable: false`.

---

## 8 · Engagements, participants, attendance

### `GET /v1/engagements/{id}` · OPS, FINANCE, MD · M09-S02

```json
{ "id": "…", "ref": "ENG-0231", "title": "Leading Through Change", "organisationRef": "ORG-0114",
  "programmeRef": "PRG-0031", "status": "DELIVERED", "venue": "Aurora HQ Shah Alam",
  "dates": ["2026-11-12","2026-11-13"], "owner": { "id": "u_siti", "name": "Siti Nordin" },
  "value": { "amount": 1850000, "currency": "MYR" },
  "metrics": { "participants": 30, "attended": 28, "attendanceRate": 0.93,
               "trainer": { "ref": "TRN-0007", "name": "Farah Aziz" },
               "claimCompleteness": 0.62 },
  "lifecycle": [ { "key": "WON", "state": "DONE", "at": "2026-09-15" }, { "key": "TRAINER_CONFIRMED", "state": "DONE", "at": "2026-09-16" },
                 { "key": "SCHEDULED", "state": "DONE" }, { "key": "REGISTERED", "state": "DONE" }, { "key": "DELIVERED", "state": "DONE", "at": "2026-11-13" },
                 { "key": "ATTENDANCE_LOCKED", "state": "DONE", "at": "2026-11-14" },
                 { "key": "HRDC_CLAIM", "state": "BLOCKED", "note": "2 documents missing" },
                 { "key": "INVOICED", "state": "CURRENT", "ref": "INV-2026-0311" }, { "key": "PAID", "state": "PENDING" } ],
  "checklist": [ { "key": "TRAINER_LETTER", "label": "Trainer engagement letter", "done": true }, … ],
  "sessions": [ { "ref": "SES-0461", "day": 1, "date": "2026-11-12", "title": "Escalation & conflict", "venue": "Training Room A", "trainerRef": "TRN-0007", "present": 29, "total": 30 } ],
  "finance": { "invoiceRef": "INV-2026-0311", "syncState": "VALIDATED", "trainerPayable": { "amount": 960000, "currency": "MYR" }, "realisedMarginRate": 0.41 } }
```

`POST /v1/actions` `type: ENGAGEMENT_CLOSE_OUT` returns `422` with `details.blockers: ["EVALUATION_SUMMARY_MISSING","CERTIFICATES_NOT_ISSUED"]` while incomplete.

### `GET /v1/engagements/{id}/attendance?day=1` · OPS, TRAINER · M10-S06

```json
{ "engagementRef": "ENG-0231", "day": 1, "date": "2026-11-12",
  "status": "LOCKED", "immutable": true,
  "approvedBy": { "id": "t_farah", "name": "Farah Aziz", "kind": "HUMAN" }, "approvedAt": "2026-11-14T10:01:00+08:00",
  "summary": { "registered": 30, "presentAm": 29, "presentPm": 29, "signatures": 58, "signaturesExpected": 60 },
  "rows": [ { "participantRef": "PAR-1182", "name": "Ahmad Firdaus", "department": "Production",
              "am": { "present": true, "at": "2026-11-12T09:02:00+08:00", "method": "QR" },
              "pm": { "present": true, "at": "2026-11-12T14:05:00+08:00", "method": "QR" },
              "signatureRef": "sig_9f21" },
            { "participantRef": "PAR-1189", "name": "Nur Aisyah", "department": "Logistics",
              "am": { "present": false, "reason": "MEDICAL_LEAVE" }, "pm": { "present": false, "reason": "MEDICAL_LEAVE" } } ],
  "captureModes": { "qr": false, "signature": false, "manual": false } }
```

`captureModes` are all `false` while locked — the UI disables from the response, not from its own logic.

`POST /v1/engagements/{id}/attendance/{day}/capture` → `409 ATTENDANCE_LOCKED` once approved:

```json
409 { "error": { "code": "ATTENDANCE_LOCKED", "message": "Attendance for ENG-0231 day 1 was approved on 14 Nov 2026 and cannot be modified.",
  "details": { "approvedAt": "2026-11-14T10:01:00+08:00", "unlockPath": "/v1/actions", "unlockActionType": "ATTENDANCE_UNLOCK" } } }
```

`POST /v1/actions` `type: ATTENDANCE_APPROVE` — **lock is one-way**. Emits `AttendanceLocked`.
`POST /v1/actions` `type: ATTENDANCE_UNLOCK` — requires `payload.reason`, voids the claim packet (`effects[]` says so explicitly), OPS + FINANCE both notified, always audited.

`GET /v1/engagements/{id}/attendance/export?format=HRDC` → `{ "url": "…", "expiresAt": "…" }`.

---

## 9 · HRD Corp and finance

### `GET /v1/hrdc/packets/{engagementRef}` · FINANCE, OPS · M12-S02

```json
{ "id": "…", "engagementRef": "ENG-0231", "organisationRef": "ORG-0114",
  "scheme": "SBL_KHAS", "employerCode": "HRDC-2201-8834",
  "claimValue": { "amount": 1850000, "currency": "MYR" },
  "levyAvailable": { "amount": 6100000, "currency": "MYR" },
  "completeness": 0.62, "status": "DRAFT",
  "deadlineAt": "2026-11-17T23:59:59+08:00", "daysRemaining": 3, "deadlineSeverity": "DANGER",
  "requiredDocuments": [
    { "type": "ATTENDANCE_SHEET", "label": "Attendance sheet", "status": "PRESENT", "ref": "ENG-0231/attendance", "meta": "Locked 14 Nov · 28/30 present" },
    { "type": "TRAINER_TTT_CERT", "status": "PRESENT", "ref": "TTT-2019-4471", "meta": "Valid to 30 Jun 2027" },
    { "type": "TAX_INVOICE", "status": "PRESENT", "ref": "INV-2026-0311", "meta": "MyInvois validated" },
    { "type": "EVALUATION_SUMMARY", "status": "MISSING", "meta": "24 of 30 responses collected" },
    { "type": "TRAINING_SCHEDULE", "status": "MISSING" } ],
  "grant": { "reference": "GRT-2026-77412", "submittedAt": "2026-10-02T09:14:00+08:00", "approvedAt": "2026-10-09T00:00:00+08:00" },
  "submission": null,
  "submissionLog": [ { "at": "2026-10-02T09:14:00+08:00", "actor": { "kind": "HUMAN", "name": "Jason Lee" }, "event": "GRANT_SUBMITTED", "reference": "GRT-2026-77412" },
                     { "at": "2026-11-14T10:30:00+08:00", "actor": { "kind": "AGENT", "name": "Compliance Agent" }, "event": "PACKET_ASSEMBLED", "completeness": 0.62 } ] }
```

`POST /v1/hrdc/packets/{id}/documents` attaches. `GET /v1/hrdc/packets/{id}/export` returns the eTRIS upload bundle.

`POST /v1/actions` `type: HRDC_PACKET_MARK_SUBMITTED`:

```json
{ "type": "HRDC_PACKET_MARK_SUBMITTED", "targetRef": "ENG-0231",
  "payload": { "reference": "CLM-2026-118834", "submittedAt": "2026-11-16T14:20:00+08:00" },
  "requestedBy": { "kind": "HUMAN", "id": "u_jason" } }
```

`422 VALIDATION_FAILED` while `completeness < 1`. **There is no submit-to-HRDC endpoint** — HRD Corp has no API; a human files on eTRIS and records the reference. Emits `HRDCPacketSubmitted`.

`GET /v1/hrdc/deadlines?filter[status][eq]=AT_RISK` powers the compliance badge.

### `GET /v1/invoices/{id}` · FINANCE · M13-S02

```json
{ "id": "…", "ref": "INV-2026-0311", "organisationRef": "ORG-0114", "engagementRef": "ENG-0231",
  "status": "SENT", "issuedAt": "2026-11-14T10:00:00+08:00", "dueAt": "2026-12-14", "termsDays": 30,
  "lines": [ { "description": "Leading Through Change · 2-day programme", "detail": "12–13 Nov 2026 · Aurora HQ Shah Alam",
               "qty": 30, "unit": { "amount": 61667, "currency": "MYR" }, "amount": { "amount": 1850000, "currency": "MYR" } } ],
  "subtotal": { "amount": 1850000, "currency": "MYR" }, "sst": { "amount": 0, "currency": "MYR" }, "sstReason": "TRAINING_EXEMPT",
  "total": { "amount": 1850000, "currency": "MYR" }, "outstanding": { "amount": 1850000, "currency": "MYR" },
  "sync": { "state": "VALIDATED", "provider": "ACCOUNTING", "uin": "MY-2026-XXXXXXXX-0311", "lastAttemptAt": "2026-11-14T10:04:00+08:00" },
  "syncLog": [ { "at": "2026-11-14T09:58:00+08:00", "state": "ERROR", "providerCode": "CUSTOMER_NOT_MAPPED",
                 "detail": "\"Aurora Mfg\" did not match a customer", "resolution": "Mapped ORG-0114 → ACC-1042" },
               { "at": "2026-11-14T10:02:00+08:00", "state": "SENT", "detail": "Pushed to accounting package" },
               { "at": "2026-11-14T10:04:00+08:00", "state": "VALIDATED", "detail": "MyInvois validation returned UIN" } ],
  "payments": [] }
```

Invoice creation is `POST /v1/actions` `type: INVOICE_CREATE` (policy FIN-01) and **means push to the accounting package** — TrainOS does not e-invoice; MyInvois validation happens downstream and is mirrored into `sync`.

`POST /v1/invoices/{id}/payments` · `GET /v1/receivables/aging` · `GET /v1/collections/queue`:

```json
{ "data": [ { "invoiceRef": "INV-2026-0288", "organisation": { "ref": "ORG-0114", "name": "Aurora Manufacturing Sdn Bhd" },
  "daysOverdue": 34, "amount": { "amount": 1240000, "currency": "MYR" }, "stage": "REMINDER_2",
  "nextAction": { "type": "REMINDER_SEND", "status": "DRAFT_READY", "autonomy": "ACT_WITH_APPROVAL" } } ],
  "aging": { "current": { "amount": 6130000, "currency": "MYR" }, "d1_30": { "amount": 2270000, "currency": "MYR" },
             "d31_60": { "amount": 1240000, "currency": "MYR" }, "d60_plus": { "amount": 0, "currency": "MYR" }, "dsoDays": 38 } }
```

`GET /v1/collections/{invoiceRef}/draft` mirrors the follow-up draft shape. `GET /v1/collections/rules` returns the escalation ladder (7 / 30 / 45 days, human call at 60, trading hold at 75 with MD approval).

---

## 10 · Agents, runs, dashboards

### `GET /v1/agents` · ADMIN, MD · M18-S01

```json
{ "data": [ { "id": "agent_proposal", "name": "Proposal Agent", "status": "ACTIVE",
  "scopes": ["proposals","quotations"],
  "autonomy": [ { "actionType": "PROPOSAL_DRAFT", "level": "AUTONOMOUS", "paused": false },
                { "actionType": "PROPOSAL_SEND", "level": "ACT_WITH_APPROVAL", "paused": false, "ceiling": "ACT_WITH_APPROVAL", "ceilingReason": "MONEY_MOVING" } ],
  "costMonth": { "amount": 1890, "currency": "MYR" }, "evalScore": 0.89, "lastRunAt": "2026-11-14T10:30:00+08:00", "killSwitch": false },
  { "id": "agent_knowledge", "name": "Knowledge Agent", "status": "PAUSED",
    "pausedAt": "2026-11-09T00:00:00+08:00", "pausedReason": "EVAL_REGRESSION",
    "resumeCondition": { "metric": "evalScore", "op": "gte", "value": 0.85 }, "evalScore": 0.71 } ],
  "summary": { "actionsMonth": 1284, "cost": { "amount": 8420, "currency": "MYR" }, "budget": { "amount": 25000, "currency": "MYR" },
               "approvalsRaised": 96, "autoApproved": 0, "medianEval": 0.91, "incidents30d": 1 } }
```

`PUT /v1/agents/{id}/autonomy` — `{ "actionType": "PROPOSAL_SEND", "level": "AUTONOMOUS" }` returns `422 VALIDATION_FAILED` with `details.reason: "MONEY_MOVING_CEILING"`. MD-gated.
`POST /v1/agents/{id}/pause` — `{ "actionType": "PROPOSAL_SEND" | null }` (null = whole agent). Immediate, audited, idempotent.

### `GET /v1/runs/{id}` · ADMIN · M18-S04

```json
{ "id": "run_4821", "ref": "#4821", "agentId": "agent_proposal", "trigger": { "type": "TNA_SIGNED_OFF", "ref": "TNA-0042" },
  "model": "sonnet-4.5", "startedAt": "2026-09-11T09:14:02+08:00", "durationMs": 14200,
  "cost": { "amount": 38, "currency": "MYR" }, "tokens": { "in": 31204, "out": 7208 },
  "status": "HALTED", "outcome": "QUEUED_FOR_APPROVAL",
  "guardrails": ["APV-01 value threshold","No PII in prompt","Rate card ≤ 24h old","Approved template version","Max 8 tool calls"],
  "steps": [
    { "seq": 1, "tool": "read_tna", "args": { "id": "TNA-0042" }, "result": { "gaps": 3, "audience": 30 }, "status": "OK", "retries": 0, "durationMs": 400, "cost": { "amount": 1, "currency": "MYR" } },
    { "seq": 4, "tool": "fetch_rate_card", "args": { "year": 2026 }, "result": { "trainerDay": 480000 }, "status": "RETRIED", "retries": 1, "durationMs": 6000, "cost": { "amount": 3, "currency": "MYR" }, "error": { "attempt": 1, "code": "TIMEOUT" } },
    { "seq": 6, "tool": "send_proposal", "args": { "id": "PRO-2026-0184" }, "status": "HALTED", "durationMs": 0,
      "haltedBy": { "policyId": "APV-01", "approvalRequestRef": "APV-2026-0771", "reason": "Value RM 18,500 exceeds RM 15,000" } } ] }
```

`haltedBy` is first-class — it is how the trace proves the agent never sent anything.

Failed runs carry `status: "FAILED"` and `failure: { code: "WA_TEMPLATE_REJECTED", message, attempts: 3, retryable: true, deadLettered: false }`.
`POST /v1/runs/{id}/retry` · `POST /v1/runs/{id}/dead-letter` `{ "reason": "…" }` · `POST /v1/runs/{id}/replay?mode=SANDBOX` (no side effects, returns a new sandbox run id).

### `GET /v1/dashboards/executive?period=2026-11` · MD · M01-S01

Returns `metrics[]` where each cell is self-describing:

```json
{ "metrics": [
  { "key": "OPEN_PIPELINE", "label": "Open pipeline", "value": { "amount": 21430000, "currency": "MYR" },
    "secondary": "12 opportunities", "drillTo": "/v1/opportunities?filter[stage][in]=QUALIFYING,PROPOSAL_SENT,NEGOTIATION" },
  { "key": "AR_OVERDUE", "label": "AR overdue", "value": { "amount": 1240000, "currency": "MYR" },
    "delta": { "rate": 0.18, "direction": "UP", "severity": "WARN", "comparedTo": "2026-10" },
    "drillTo": "/v1/receivables?filter[daysOverdue][gte]=1" },
  { "key": "ADMIN_HOURS_SAVED", "label": "Admin hours saved", "value": 41, "estimate": true,
    "formula": "agentActions × roleWeightedManualMinutes", "drillTo": "/v1/reports/hours-saved?period=2026-11" } ],
  "approvalsPending": [ … ], "agentActivity": [ … ],
  "autonomyMix": [ { "level": "OBSERVE", "rate": 0.12 }, { "level": "SUGGEST", "rate": 0.46 }, { "level": "ACT_WITH_APPROVAL", "rate": 0.34 }, { "level": "AUTONOMOUS", "rate": 0.08 } ],
  "agentSpend": { "spent": { "amount": 8420, "currency": "MYR" }, "budget": { "amount": 25000, "currency": "MYR" } } }
```

One endpoint per MetricStrip cell is also supported for record headers: `GET /v1/metrics/{key}?scope=ORGANISATION&id=…` returns `{ value, secondary?, delta?, drillTo }`.

`GET /v1/reports/proposals-vs-won?months=6` → `{ "series": [ { "period": "2026-06", "sent": 52, "won": 31 } ] }`.

---

## 11 · Client portal, realtime, webhooks

### `GET /v1/public/proposals/{token}` · CLIENT, unauthenticated signed link · M07-S07

Token is a signed, expiring link (30 days, revocable). Returns the client-safe projection only — **no margin, no cost lines, no internal provenance**:

```json
{ "ref": "PRO-2026-0184", "organisationName": "Aurora Manufacturing Sdn Bhd", "issuedAt": "2026-09-11",
  "sections": [ { "n": 1, "title": "Understanding your needs", "body": "Your 30 line managers…" } ],
  "investment": { "total": { "amount": 1850000, "currency": "MYR" }, "hrdcScheme": "SBL_KHAS", "hrdcClaimableUpTo": 1.0,
                  "levyAvailable": { "amount": 6100000, "currency": "MYR" } },
  "status": "ACCEPTED",
  "acceptance": { "acceptedBy": "Nurul Hassan", "role": "HR Manager", "acceptedAt": "2026-09-15T10:24:00+08:00", "signatureRef": "sig_c19a" },
  "comments": [ { "author": "Nurul Hassan", "authorKind": "CLIENT", "at": "2026-09-12T14:02:00+08:00", "body": "Can we confirm the November dates…" } ] }
```

`POST /v1/public/proposals/{token}/comments` · `POST /v1/public/proposals/{token}/accept` `{ "name": "Nurul Hassan", "role": "HR Manager" }` → creates the engagement, emits `ProposalAccepted`. Idempotent by token: a second accept returns the original acceptance.

### Realtime

SSE at `GET /v1/events?channels=…`, per-user filtered. Channels the UI needs:

| Channel | Payload | Used by |
|---|---|---|
| `badges` | `{ approvals: 7, hrdcDeadlines: 3, agentFailures: 2 }` | sidebar, every screen |
| `approvals` | `{ event: "CREATED"\|"DECIDED", approvalRef, urgencyGroup, slaBreached }` | M02-S01, M01-S01 |
| `enquiries` | `{ event: "RECEIVED"\|"CLASSIFIED", enquiryRef, channel, confidence }` | M03-S01 |
| `runs:{runId}` | `{ seq, tool, status, durationMs }` — step-level progress | M18-S04 |
| `invoices` | `{ invoiceRef, syncState, providerCode? }` | M13-S02, M13-S05 |

Everything else polls on navigation.

### Inbound webhooks

| Endpoint | Source | Idempotency key | Emits |
|---|---|---|---|
| `POST /v1/webhooks/email` | mail provider | `Message-ID` header | `EnquiryReceived` |
| `POST /v1/webhooks/whatsapp` | WhatsApp BSP | `messages[0].id` | `EnquiryReceived` |
| `POST /v1/webhooks/proposal-accepted` | portal (internal) | `token + acceptedAt` | `ProposalAccepted` |
| `POST /v1/webhooks/accounting` | accounting package | `provider + documentId + state` | `InvoicePushed` / `InvoiceValidated` |

Example accounting callback:

```json
{ "provider": "ACCOUNTING", "documentId": "ACC-INV-88213", "externalRef": "INV-2026-0311",
  "state": "VALIDATED", "uin": "MY-2026-XXXXXXXX-0311", "at": "2026-11-14T10:04:00+08:00" }
```

Replays of a seen key return `200 { "status": "IGNORED_DUPLICATE" }`.

---

## 12 · Enum catalogue

| Enum | Values |
|---|---|
| `ActorKind` | `HUMAN · AGENT · SYSTEM · CLIENT` |
| `Role` | `SALES · SALES_MANAGER · OPS · FINANCE · MD · ADMIN · TRAINER · CLIENT · AGENT` |
| `ProvenanceOrigin` | `HUMAN · SYSTEM · AI_SUGGESTED · AI_GENERATED · AI_EXECUTED` |
| `AutonomyLevel` | `OBSERVE · SUGGEST · ACT_WITH_APPROVAL · AUTONOMOUS` |
| `EnquiryChannel` | `EMAIL · WHATSAPP · WEB_FORM · PHONE` |
| `EnquiryStatus` | `OPEN · ASSIGNED · CONVERTED · ARCHIVED · NOT_AN_ENQUIRY` |
| `OpportunityStage` | `NEW · QUALIFYING · TNA_SENT · PROPOSAL_SENT · NEGOTIATION · WON · LOST` |
| `TNAStatus` | `DRAFT · SENT · COMPLETE · REOPENED` |
| `GapPriority` | `HIGH · MEDIUM · LOW` |
| `ProposalStatus` | `DRAFT · AWAITING_APPROVAL · SENT · VIEWED · ACCEPTED · LOST` |
| `ApprovalDecision` | `APPROVE · REQUEST_CHANGES · REJECT` |
| `ApprovalStatus` | `PENDING · APPROVED · CHANGES_REQUESTED · REJECTED · EXPIRED` |
| `UrgencyGroup` | `BREACHING · TODAY · THIS_WEEK · LATER` |
| `RiskLevel` | `LOW · MEDIUM · HIGH` |
| `LifecycleState` | `DONE · CURRENT · PENDING · BLOCKED · SKIPPED · FAILED` |
| `EngagementStatus` | `PROPOSED · CONFIRMED · SCHEDULED · IN_DELIVERY · DELIVERED · CLOSED · CANCELLED` |
| `AttendanceStatus` | `OPEN · PENDING_APPROVAL · LOCKED` |
| `CaptureMethod` | `QR · SIGNATURE · MANUAL` |
| `AbsenceReason` | `MEDICAL_LEAVE · WORK_CONFLICT · NO_SHOW · OTHER` |
| `HRDCScheme` | `SBL_KHAS · SBL · HRDC_PLACEMENT` |
| `HRDCDocumentType` | `ATTENDANCE_SHEET · TRAINER_TTT_CERT · TAX_INVOICE · EVALUATION_SUMMARY · TRAINING_SCHEDULE` |
| `PacketStatus` | `DRAFT · READY · SUBMITTED · PAID · REJECTED` |
| `InvoiceStatus` | `DRAFT · SENT · PARTIALLY_PAID · PAID · OVERDUE · VOID` |
| `SyncState` | `NOT_SENT · SENT · VALIDATED · ERROR` |
| `CollectionStage` | `REMINDER_1 · REMINDER_2 · REMINDER_3 · HUMAN_CALL · TRADING_HOLD` |
| `MessageCategory` | `MARKETING · UTILITY · SERVICE` |
| `AgentStatus` | `ACTIVE · PAUSED · RETIRED` |
| `RunStatus` | `RUNNING · SUCCEEDED · FAILED · HALTED` |
| `RunStepStatus` | `OK · RETRIED · FAILED · HALTED` |
| `ActionStatus` | `EXECUTED · QUEUED_FOR_APPROVAL · SUGGESTED · REJECTED` |
| `DiffOp` | `ADD · UPDATE · REMOVE` |

---

## 13 · Screen → endpoint matrix

| Screen | Endpoints |
|---|---|
| M01-S01 Executive dashboard | `GET /dashboards/executive` · `GET /reports/proposals-vs-won` · `GET /metrics/{key}` · `GET /approvals?page[size]=5` · SSE `badges`, `approvals` |
| M03-S01 Enquiry inbox | `GET /enquiries` · `GET /views?object=ENQUIRY` · `GET /enquiries/{id}` (preview pane) · `POST /actions` (`OPPORTUNITY_CONVERT`, `ENQUIRY_ARCHIVE`) · SSE `enquiries` |
| M03-S02 Enquiry detail | `GET /enquiries/{id}` · `PATCH /enquiries/{id}/extraction` · `POST /actions` (`OPPORTUNITY_CONVERT`) · `GET /organisations/{id}` (related strip) |
| M05-S02 TNA detail | `GET /tnas/{id}` · `GET /tnas/{id}/recommendations` · `POST /actions` (`TNA_RECOMMENDATION_ACCEPT`) · `POST /tnas/{id}/reopen` |
| M06-S02 Programme detail | `GET /programmes/{id}` · `GET /programmes/{id}/deliveries` · `GET /trainers?filter[programmeId][eq]=` |
| M07-S02 Proposal builder | `GET /proposals/{id}` · `GET /templates?type=PROPOSAL` · `PUT /proposals/{id}/sections/{n}` · `POST /proposals/{id}/sections/{n}/regenerate` · `GET /proposals/{id}/preview` · `POST /actions` (`PROPOSAL_SEND`) · `GET /policies/APV-01` |
| M07-S03 Costing worksheet | `GET /costings/{id}` · `PUT /costings/{id}` · `GET /programmes/{id}` (floor price) · `POST /actions` (`QUOTATION_APPLY`, `DISCOUNT_APPROVE`) |
| M02-S01 Approval inbox | `GET /approvals?group=URGENCY` · `GET /views?object=APPROVAL` · `POST /approvals/bulk-decide` · SSE `approvals` |
| M02-S02 Approval detail | `GET /approvals/{id}` · `GET /approvals/{id}` `.previewUrl` · `POST /approvals/{id}/decide` · `GET /runs/{runId}` (agent link) |
| M07-S07 Client proposal page | `GET /public/proposals/{token}` · `POST /public/proposals/{token}/comments` · `POST /public/proposals/{token}/accept` |
| M04-S02 Organisation 360 | `GET /organisations/{id}` · `GET /organisations/{id}/relations` · `GET /organisations/{id}/suggestions` · `GET /organisations/{id}/audit` · `GET /config/pipelines?object=ENGAGEMENT` |
| M09-S02 Engagement detail | `GET /engagements/{id}` · `GET /engagements/{id}/participants` · `GET /hrdc/packets/{engagementRef}` · `GET /invoices/{id}` · `POST /actions` (`ENGAGEMENT_CLOSE_OUT`) |
| M10-S06 Attendance capture | `GET /engagements/{id}/attendance?day=` · `POST /engagements/{id}/attendance/{day}/capture` · `POST /actions` (`ATTENDANCE_APPROVE`, `ATTENDANCE_UNLOCK`) · `GET /engagements/{id}/attendance/export?format=HRDC` |
| M12-S02 HRDC packet | `GET /hrdc/packets/{engagementRef}` · `POST /hrdc/packets/{id}/documents` · `GET /hrdc/packets/{id}/export` · `POST /actions` (`HRDC_PACKET_MARK_SUBMITTED`, `REMINDER_SEND`) |
| M13-S02 Invoice detail | `GET /invoices/{id}` · `POST /invoices/{id}/payments` · `POST /actions` (`INVOICE_PUSH`) · SSE `invoices` |
| M13-S05 Collections queue | `GET /collections/queue` · `GET /receivables/aging` · `GET /collections/{invoiceRef}/draft` · `GET /collections/rules` · `POST /actions` (`REMINDER_SEND`) |
| M18-S01 Agent registry | `GET /agents` · `PUT /agents/{id}/autonomy` · `POST /agents/{id}/pause` · `GET /evals?agentId=` |
| M18-S04 Run trace | `GET /runs` · `GET /runs/{id}` · `POST /runs/{id}/retry` · `POST /runs/{id}/dead-letter` · `POST /runs/{id}/replay` · SSE `runs:{runId}` |
| M03-S06 Follow-up queue | `GET /follow-ups` · `GET /follow-ups/{id}/draft` · `POST /actions` (`FOLLOWUP_SEND`) · `GET /contacts/{id}/consent` |
| M22-S04 Demo script | none — static document |

---

## 14 · Event catalogue

| Event | Emitted by | Payload |
|---|---|---|
| `EnquiryReceived` | `POST /webhooks/email`, `/webhooks/whatsapp` | `{ enquiryRef, channel, from, receivedAt }` |
| `EnquiryClassified` | agent run completion | `{ enquiryRef, label, confidence, agentId, runId }` |
| `OpportunityCreated` | `POST /actions` `OPPORTUNITY_CONVERT` | `{ opportunityRef, organisationRef, value, sourceEnquiryRef }` |
| `TNACompleted` | `POST /public/tnas/{token}/submit` | `{ tnaRef, opportunityRef, completedBy, completedAt }` |
| `ProposalDrafted` | `POST /proposals`, section regenerate | `{ proposalRef, templateId, agentId, runId, value }` |
| `ApprovalRequested` | `POST /actions` when policy routes | `{ approvalRef, policyId, actionType, targetRef, value, approverRole, slaDueAt }` |
| `ApprovalDecided` | `POST /approvals/{id}/decide` | `{ approvalRef, decision, decidedBy, decidedAt, effects[] }` |
| `ProposalSent` | approval effect / direct execute | `{ proposalRef, channel, to, sentAt }` |
| `ProposalAccepted` | `POST /public/proposals/{token}/accept` | `{ proposalRef, acceptedBy, acceptedAt, engagementRef }` |
| `EngagementCreated` | proposal acceptance | `{ engagementRef, organisationRef, programmeRef, dates }` |
| `AttendanceLocked` | `POST /actions` `ATTENDANCE_APPROVE` | `{ engagementRef, day, approvedBy, approvedAt, present, total }` |
| `HRDCPacketReady` | packet completeness hits 1.0 | `{ engagementRef, scheme, claimValue, deadlineAt }` |
| `HRDCPacketSubmitted` | `POST /actions` `HRDC_PACKET_MARK_SUBMITTED` | `{ engagementRef, reference, submittedBy, submittedAt }` |
| `InvoicePushed` | `POST /actions` `INVOICE_CREATE` / `INVOICE_PUSH` | `{ invoiceRef, provider, documentId, at }` |
| `InvoiceValidated` | `POST /webhooks/accounting` | `{ invoiceRef, uin, at }` |
| `ReminderDrafted` | agent run completion | `{ invoiceRef, stage, channel, estimatedCost, agentId, runId }` |
| `AgentRunCompleted` | run finaliser | `{ runId, agentId, status, durationMs, cost, outcome }` |
| `AgentRunFailed` | run finaliser | `{ runId, agentId, failureCode, attempts, deadLettered }` |

All events carry `{ eventId, occurredAt, tenantId, actor }` and are written to the outbox in the same transaction as the state change.

---

## 15 · Fields rendered with no source

Audited every field on all twenty screens against the responses above. Three have no first-class source and need a decision:

1. **`medianDecisionTime` on M02-S01** ("Median decision time this week: 3m 40s"). Computable from the audit log but not exposed. Proposal: add to `GET /v1/approvals` as `summary.medianDecisionSeconds`.
2. **`signaturesExpected` on M10-S06** (58 / 60). Derived as `registered × sessionsInDay`, currently computed client-side. Proposal: return it in the attendance `summary` so the rule lives server-side.
3. **`perParticipant` on M07-S03** (RM 617). Derived as `sellPrice ÷ pax`. Harmless client-side arithmetic, but rounding should match the invoice line unit price — return it in the costing response.

Everything else on every screen resolves to a documented field.

---

## 16 · Open questions

1. **Does an approval expire?** The SLA escalates to the MD at 6h, but nothing in the demo defines what happens at 24h. Expire, auto-reject, or nag forever?
2. **Diff staleness.** If the world changes between rendering `diff[]` and `POST /decide`, is a `409` with a recomputed diff acceptable UX, or should approvals hold a soft lock on the target?
3. **Who owns `firstProposalToOrg`?** Computed live, or a denormalised flag on the organisation? It changes the cost of every policy evaluation.
4. **WhatsApp rates** are billing facts that change. Cached from the BSP with what TTL, and what does the composer show if the rate lookup fails?
5. **Attendance unlock** voids the claim packet — should the API refuse outright once a claim reference exists, rather than allowing the void?
6. **Client portal token lifetime** — 30 days is assumed. Revoke on acceptance, or keep it live so the client can re-download?
7. **Agent service principals** — one credential per agent, or one per agent per tenant? Affects the scoping of `AGENT` role checks.
8. **Sandbox replay** — does it read live data or a snapshot pinned to the original run? Live reads make replays non-deterministic.
9. **Saved views** — shared or personal? The demo shows counts that imply shared team views.
10. **Money rounding** — invoice unit price is RM 616.67 × 30 = RM 18,500.10, not RM 18,500. Does the line unit derive from the total, or the total from the lines?


---

## 17 · AI operations (update pass)

Six screens added after the first contract: model tiers and routing, provider keys, usage and budgets, the HRD Corp rules registry, rule-change review, and knowledge sources. Everything below follows the same conventions.

### Model tiers and routing — M20-S20

| Method | Path | Roles | Notes |
|---|---|---|---|
| `GET` | `/v1/ai/tiers` | ADMIN, MD | tier table with live status |
| `PUT` | `/v1/ai/tiers/{key}` | ADMIN | routing, fallback chain, cache, cap, allowed hours |
| `GET` | `/v1/ai/routing` | ADMIN, MD | the assignment matrix |
| `PUT` | `/v1/ai/routing` | ADMIN | **applies to future runs only** — never retroactive |

```json
{ "data": [
  { "key": "STRONG_1", "model": "Claude Sonnet 5", "provider": "ANTHROPIC", "routing": "FIXED",
    "fallbackChain": ["STRONG_2","STRONG_3"], "cacheStrategy": "CONTEXT_1H", "maxOutputTokens": 8192,
    "allowedHours": [[0,24]], "monthlyCap": { "amount": 15000, "currency": "MYR" },
    "spend": { "amount": 9600, "currency": "MYR" }, "status": "HEALTHY" },
  { "key": "STRONG_2", "model": "Gemini 3.1 Pro", "provider": "GOOGLE", "routing": "PRICE",
    "fallbackChain": ["STRONG_3","MID"], "status": "DEGRADED",
    "degradation": { "since": "2026-11-14T09:12:00+08:00", "reason": "PROVIDER_5XX", "activeFallback": "DEEP_THINK" } },
  { "key": "SPECIAL", "model": "Claude Opus 5", "status": "PAUSED_BY_CAP",
    "monthlyCap": { "amount": 20000, "currency": "MYR" }, "spend": { "amount": 20000, "currency": "MYR" } } ] }
```

```json
// GET /v1/ai/routing
{ "data": [ { "actionType": "PROPOSAL_DRAFT", "tier": "STRONG_1",
    "escalationLadder": ["STRONG_1","STRONG_2"], "jury": { "enabled": true, "quorum": 2, "of": 3, "tiers": ["STRONG_1","STRONG_2","STRONG_3"] },
    "requiredForAutonomous": true } ],
  "unsavedChanges": 2 }
```

`allowedHours` is a list of `[startHour, endHour)` pairs in MYT. A run requested outside the window queues to the next window when the tier is batch-eligible, otherwise it escalates. Enum `TierStatus` ∈ `HEALTHY · DEGRADED · PAUSED_BY_CAP · DISABLED`; `RoutingStrategy` ∈ `THROUGHPUT · PRICE · FIXED`.

### Provider keys (BYOK) — M20-S21

| Method | Path | Roles | Notes |
|---|---|---|---|
| `GET` | `/v1/ai/providers` | ADMIN | keys always masked |
| `POST` | `/v1/ai/providers` | ADMIN | write-only key; returns the masked record |
| `POST` | `/v1/ai/providers/{id}/test` | ADMIN | live probe, updates `lastTestedAt` |
| `POST` | `/v1/ai/providers/{id}/rotate` | ADMIN | old key invalidated immediately |
| `DELETE` | `/v1/ai/providers/{id}` | ADMIN | `409` if a tier has no remaining key |

```json
{ "data": [ { "id": "prv_anthropic", "provider": "ANTHROPIC", "label": "Anthropic direct",
  "status": "INVALID", "maskedKey": "sk-ant-••••••••••••9a41", "scopeTiers": ["STRONG_1"],
  "spendMonth": { "amount": 9600, "currency": "MYR" }, "cap": { "amount": 15000, "currency": "MYR" },
  "rotationDate": "2027-03-01", "billingOwner": "CLIENT_ACCOUNT", "region": "US",
  "lastTestedAt": "2026-11-14T08:40:00+08:00",
  "invalidSince": "2026-11-14T08:40:00+08:00", "activeFallbackTier": "STRONG_2",
  "addedBy": { "id": "u_khairul", "name": "Khairul Anwar", "at": "2026-01-12T10:00:00+08:00" } } ] }
```

The API **never** returns a full key. Reveal is a separate audited call, `POST /v1/ai/providers/{id}/reveal`, which returns the key once and writes `ProviderKeyRevealed`. `BillingOwner` ∈ `CLIENT_ACCOUNT · PASS_THROUGH`. `region` is returned before a key is saved so the customer makes the PDPA residency call knowingly.

### Usage and budgets — M20-S16

| Method | Path | Roles |
|---|---|---|
| `GET` | `/v1/ai/usage?period=2026-11&groupBy=TIER|AGENT|ACTION_TYPE` | ADMIN, FINANCE, MD |
| `GET` | `/v1/ai/usage/forecast?period=2026-11` | ADMIN, FINANCE, MD |
| `GET` | `/v1/ai/budgets` · `PUT /v1/ai/budgets/{scope}/{key}` | ADMIN; raise is MD-gated |

```json
{ "period": "2026-11",
  "totals": { "llm": { "amount": 53700, "currency": "MYR" }, "whatsapp": { "amount": 3400, "currency": "MYR" },
              "compute": { "amount": 9600, "currency": "MYR" }, "cacheHitRate": 0.61, "offPeakShare": 0.44,
              "estimatedCacheSaving": { "amount": 24000, "currency": "MYR" } },
  "forecast": { "amount": 81200, "currency": "MYR" }, "cap": { "amount": 94000, "currency": "MYR" },
  "breakdown": [ { "key": "STRONG_1", "label": "Claude Sonnet 5", "spend": { "amount": 9600, "currency": "MYR" },
                   "drillTo": "/v1/runs?filter[tier][eq]=STRONG_1&filter[period][eq]=2026-11" } ],
  "budgets": [ { "scope": "TIER", "key": "SPECIAL", "cap": { "amount": 20000, "currency": "MYR" },
                 "spend": { "amount": 20000, "currency": "MYR" }, "state": "PAUSED" } ] }
```

Raising a cap goes through `POST /v1/actions` `type: BUDGET_CAP_RAISE` → `QUEUED_FOR_APPROVAL` with `approverRole: MD`. A tripped cap sets the affected routing entry to `PAUSED_BY_CAP`; runs requesting it get `409 AGENT_PAUSED` with `details.reason: "BUDGET_CAP"`.

### HRD Corp rules registry — M12-S07

| Method | Path | Roles |
|---|---|---|
| `GET` | `/v1/compliance/rules?filter[scheme][eq]=SBL_KHAS&filter[status][eq]=ACTIVE&asOf=2026-11-14` | FINANCE, OPS, ADMIN |
| `GET` | `/v1/compliance/rules/{id}` | includes the source excerpt and lineage |
| `POST` | `/v1/compliance/rules` · `PUT /v1/compliance/rules/{id}` | FINANCE + ADMIN; activation is approval-gated |

```json
{ "id": "HRD-014", "scheme": "SBL_KHAS", "subject": "In-house application lead time",
  "expression": { "field": "training_start", "op": "GTE", "reference": "grant_approval", "offsetDays": 14 },
  "effectiveFrom": "2026-06-15", "effectiveTo": null, "status": "ACTIVE",
  "source": { "documentId": "DOC-0188", "title": "Circular 04/2026", "section": "3.2", "page": 4,
    "excerpt": "Employers are required to submit grant applications at least fourteen (14) days before the commencement date of in-house training programmes." },
  "supersedesId": "HRD-006", "supersededById": null,
  "usedByChecks": ["CHK_LEAD_TIME"], "affectedOpenEngagements": 4,
  "verifiedBy": { "id": "u_jason", "name": "Jason Lee" }, "verifiedAt": "2026-06-20T00:00:00+08:00",
  "provenance": { "origin": "AI_SUGGESTED", "confidence": 0.93, "model": "Gemini 3.1 Pro", "generatedAt": "2026-06-18T00:00:00+08:00",
                  "editedBy": { "id": "u_jason", "name": "Jason Lee", "at": "2026-06-20T00:00:00+08:00" } } }
```

`asOf` is important: checks resolve rules **as at the training date**, not as at today, so a January engagement evaluates against HRD-022 while a November one evaluates against HRD-015.

### Rule-change review — M12-S08

| Method | Path | Roles |
|---|---|---|
| `GET` | `/v1/compliance/rule-changes?status=PROPOSED` | FINANCE, ADMIN |
| `GET` | `/v1/compliance/rule-changes/{documentId}` | document + proposed diffs |
| `POST` | `/v1/actions` `type: RULE_CHANGE_APPROVE` | Act-with-approval |

```json
{ "documentId": "DOC-0219", "title": "Circular 09/2026", "publishedAt": "2026-11-08", "ingestedAt": "2026-11-14T09:40:00+08:00",
  "extractedBy": { "model": "Gemini 3.1 Pro", "confidence": 0.91, "runId": "run_4912" },
  "effectiveFrom": "2027-01-01",
  "changes": [ { "id": "chg_1", "op": "SUPERSEDE", "targetRuleId": "HRD-015", "newRuleId": "HRD-022",
    "before": "training_start ≥ grant_approval + 3 days", "after": "training_start ≥ grant_approval + 14 days",
    "sourceSpan": { "page": 3, "section": "2.1", "excerpt": "With effect from 1 January 2027, employers are required to submit grant applications for public training programmes at least fourteen (14) days before the commencement date…" },
    "confidence": 0.94, "affectedEngagements": [ { "ref": "ENG-0244" }, { "ref": "ENG-0251" } ], "status": "PROPOSED" } ] }
```

Changes below `0.80` confidence are withheld from the diff view and flagged for manual transcription. Approval writes the rule with the **circular's** effective date, not the approval timestamp. Emits `RuleChangeApproved`.

### Knowledge sources — M16-S05

| Method | Path | Roles |
|---|---|---|
| `GET` | `/v1/knowledge/sources` | ADMIN, FINANCE |
| `POST` | `/v1/knowledge/sources` · `POST /v1/knowledge/sources/{id}/check` · `POST /v1/knowledge/sources/{id}/reingest` | ADMIN |

```json
{ "data": [ { "id": "src_0219", "name": "Circular 09/2026", "type": "HRDC_CIRCULAR", "version": "v1",
  "ingestedAt": "2026-11-14T09:40:00+08:00", "chunks": 142, "embeddingStatus": "INDEXED",
  "lastCheckedAt": "2026-11-14T09:40:00+08:00", "monitorStatus": "CHANGED_REVIEW_PENDING",
  "contentHash": "sha256:9f2c…", "retrievalScopes": ["COMPLIANCE","CLIENT_FACING"],
  "ruleChangeSetId": "DOC-0219" } ] }
```

`MonitorStatus` ∈ `WATCHING · CHANGED_REVIEW_PENDING · FAILED · MANUAL`. `EmbeddingStatus` ∈ `INDEXED · PENDING · FAILED`. A `CHANGED` source is quarantined from rule extraction until reviewed but stays searchable.

### Compliance checks — M12-S02, M09-S02

```
GET /v1/compliance/checks?engagementRef=ENG-0231
```

```json
{ "engagementRef": "ENG-0231", "evaluatedAt": "2026-11-14T10:32:00+08:00", "rulesAsOf": "2026-11-12",
  "summary": { "pass": 4, "warn": 1, "fail": 1 },
  "checks": [
    { "key": "CHK_LEAD_TIME", "state": "PASS", "label": "Application lead time · in-house",
      "computed": { "grantApproval": "2026-10-28", "earliestStart": "2026-11-11", "trainingStart": "2026-11-12" },
      "display": "grant approved 28 Oct → earliest start 11 Nov → training 12 Nov",
      "ruleId": "HRD-014", "provenance": { "origin": "SYSTEM", "method": "DETERMINISTIC" } },
    { "key": "CHK_MEAL_CEILING", "state": "WARN", "label": "Meal cost ceiling",
      "computed": { "perPax": { "amount": 2600, "currency": "MYR" }, "ceiling": { "amount": 2500, "currency": "MYR" } },
      "ruleId": "HRD-020", "provenance": { "origin": "SYSTEM", "method": "DETERMINISTIC" } },
    { "key": "CHK_DOCS_COMPLETE", "state": "FAIL", "label": "Required documents complete",
      "computed": { "present": 3, "required": 5, "missing": ["EVALUATION_SUMMARY","TRAINING_SCHEDULE"] },
      "ruleId": "HRD-011", "provenance": { "origin": "SYSTEM", "method": "DETERMINISTIC" } } ] }
```

`CheckState` ∈ `PASS · WARN · FAIL · NOT_APPLICABLE`. Deterministic checks carry `provenance.method: "DETERMINISTIC"` and no model; an interpreted check carries the model, confidence and sources instead. **Any `FAIL` sets the engagement's `HRDC_CLAIM` lifecycle step to `BLOCKED`** — the stepper renders that state, it does not compute it.

### Orchestrator trace — M18-S04

`GET /v1/runs/{id}` gains a node tree, events and the state card:

```json
{ "id": "run_4821", "orchestrator": "proposal_orchestrator", "status": "HALTED",
  "cacheHitRate": 0.58, "tiersUsed": ["FAST","MID","STRONG_1"],
  "nodes": [
    { "id": "n0", "parentId": null, "kind": "ORCHESTRATOR", "name": "Orchestrator",
      "tier": "MID", "model": "DeepSeek V4 Pro", "provider": "DEEPSEEK",
      "tokens": { "in": 6200, "out": 1100 }, "cacheHitRate": 0.44, "cost": { "amount": 6, "currency": "MYR" }, "durationMs": 2100, "status": "OK" },
    { "id": "n3", "parentId": "n0", "kind": "SUB_AGENT", "name": "Drafter", "tier": "STRONG_1", "model": "Claude Sonnet 5",
      "cacheHitRate": 0.41, "retries": 1, "status": "RETRIED", "durationMs": 6900, "cost": { "amount": 19, "currency": "MYR" } },
    { "id": "n5", "parentId": "n0", "kind": "TOOL", "name": "send_proposal", "status": "HALTED",
      "haltedBy": { "policyId": "APV-01", "approvalRequestRef": "APV-2026-0771", "reason": "Value RM 18,500 exceeds RM 15,000" } } ],
  "events": [
    { "type": "ESCALATION", "at": "2026-09-11T09:14:04+08:00", "detail": { "from": "FAST", "to": "MID", "confidence": 0.62, "threshold": 0.75, "node": "n2" } },
    { "type": "JURY", "at": "2026-09-11T09:14:11+08:00", "detail": { "quorum": 2, "of": 3,
        "votes": [ { "tier": "STRONG_1", "model": "Claude Sonnet 5", "agrees": true },
                   { "tier": "STRONG_2", "model": "Gemini 3.1 Pro", "agrees": true },
                   { "tier": "STRONG_3", "model": "GPT-5.6 Terra", "agrees": false, "dissent": "Prefers waiting for Daniel Wong in December" } ] } },
    { "type": "TRUNCATION", "detail": { "tool": "fetch_rate_card", "storedTokens": 3400, "fetchMoreAvailable": true } },
    { "type": "HANDOFF", "detail": { "atContextPct": 0.60, "restartedNodes": ["n3"] } },
    { "type": "CHECKPOINT", "detail": { "step": 4, "replayable": true } },
    { "type": "POLICY_HALT", "detail": { "policyId": "APV-01", "approvalRequestRef": "APV-2026-0771" } } ],
  "stateCard": { "goal": "Draft and send a proposal for OPP-0512 within the client's November window.",
    "plan": [ { "n": 1, "label": "Read TNA and org", "status": "DONE" }, { "n": 5, "label": "Send", "status": "HALTED" } ],
    "decisions": ["PRG-0031 over PRG-0018 (0.91 vs 0.78)","Farah Aziz — only accredited match in window","List price held"],
    "constraints": ["November delivery","max 2 days off-floor","margin ≥ 0.35","HRDC claimable"],
    "recordPointers": ["TNA-0042","PRG-0031","TRN-0007","QUO-2026-0184","PRO-2026-0184"],
    "openQuestions": ["Section 5 HRDC wording unverified for 2026 (0.41)"],
    "budgets": { "tokens": { "used": 38412, "limit": 60000 }, "cost": { "used": { "amount": 38, "currency": "MYR" }, "limit": { "amount": 120, "currency": "MYR" } } } } }
```

`POST /v1/runs/{id}/retry?from=checkpoint` resumes from the last checkpoint using the stored state card. `RunEventType` ∈ `ESCALATION · JURY · TRUNCATION · HANDOFF · CHECKPOINT · POLICY_HALT · CACHE_HIT · BUDGET_EXCEEDED`.

### Provenance envelope — extended

`provenance` gains four fields wherever a model produced the value. The AI badge popover renders exactly these:

```json
"provenance": { "origin": "AI_GENERATED", "confidence": 0.88,
  "tier": "STRONG_1", "model": "Claude Sonnet 5", "provider": "ANTHROPIC", "cacheHitRate": 0.41,
  "jury": { "quorum": 2, "of": 3, "agreed": ["Claude Sonnet 5","Gemini 3.1 Pro"], "dissented": [ { "model": "GPT-5.6 Terra", "note": "Preferred waiting for Daniel Wong in December" } ] },
  "agentId": "agent_proposal", "runId": "run_4821", "sources": [ … ], "generatedAt": "2026-09-11T09:14:09+08:00" }
```

`ApprovalRequest` gains `modelAgreement` when a jury ran, which is what the approval detail renders under the evidence list.

### New enums

| Enum | Values |
|---|---|
| `TierKey` | `FAST · FAST_UI · MID · CHEAP · STRONG_1 · STRONG_2 · STRONG_3 · DEEP_THINK · SPECIAL` |
| `TierStatus` | `HEALTHY · DEGRADED · PAUSED_BY_CAP · DISABLED` |
| `RoutingStrategy` | `THROUGHPUT · PRICE · FIXED` |
| `CacheStrategy` | `NONE · PROMPT_15M · PROMPT_1H · PROMPT_24H · CONTEXT_1H` |
| `ProviderKeyStatus` | `NOT_SET · VALID · INVALID · EXPIRING` |
| `BillingOwner` | `CLIENT_ACCOUNT · PASS_THROUGH` |
| `BudgetState` | `WITHIN · NEAR · PAUSED` |
| `RuleStatus` | `PROPOSED · ACTIVE · SUPERSEDED` |
| `RuleChangeOp` | `ADD · MODIFY · SUPERSEDE` |
| `CheckState` | `PASS · WARN · FAIL · NOT_APPLICABLE` |
| `MonitorStatus` | `WATCHING · CHANGED_REVIEW_PENDING · FAILED · MANUAL` |
| `EmbeddingStatus` | `INDEXED · PENDING · FAILED` |
| `TraceNodeKind` | `ORCHESTRATOR · SUB_AGENT · TOOL` |
| `RunEventType` | `ESCALATION · JURY · TRUNCATION · HANDOFF · CHECKPOINT · POLICY_HALT · CACHE_HIT · BUDGET_EXCEEDED` |

### New events

| Event | Emitted by | Payload |
|---|---|---|
| `TierDegraded` / `TierRecovered` | provider health monitor | `{ tier, reason, activeFallback, at }` |
| `BudgetCapTripped` | usage accounting | `{ scope, key, cap, spend, pausedActionTypes[] }` |
| `ProviderKeyInvalid` | key probe | `{ providerId, since, affectedTiers[], activeFallback }` |
| `ProviderKeyRevealed` | reveal endpoint | `{ providerId, actor, at }` |
| `SourceChanged` | corpus monitor | `{ sourceId, oldHash, newHash, detectedAt }` |
| `RuleChangeProposed` | ingestion | `{ documentId, changeCount, extractedBy, affectedEngagementCount }` |
| `RuleChangeApproved` | `RULE_CHANGE_APPROVE` | `{ ruleId, op, effectiveFrom, approvedBy }` |
| `ComplianceCheckFailed` | check evaluation | `{ engagementRef, checkKey, ruleId, computed }` |
| `AgentEscalated` | run engine | `{ runId, node, fromTier, toTier, confidence }` |
| `JuryDisagreed` | run engine | `{ runId, quorum, of, dissenters[] }` |

### New screen → endpoint rows

| Screen | Endpoints |
|---|---|
| M20-S20 AI models | `GET /ai/tiers` · `PUT /ai/tiers/{key}` · `GET /ai/routing` · `PUT /ai/routing` · `GET /ai/usage?groupBy=TIER` |
| M20-S21 Providers | `GET /ai/providers` · `POST /ai/providers` · `POST /ai/providers/{id}/test` · `POST /ai/providers/{id}/rotate` · `POST /ai/providers/{id}/reveal` |
| M20-S16 Usage | `GET /ai/usage` · `GET /ai/usage/forecast` · `GET /ai/budgets` · `POST /actions` (`BUDGET_CAP_RAISE`) |
| M12-S07 Rules registry | `GET /compliance/rules` · `GET /compliance/rules/{id}` · `POST /compliance/rules` |
| M12-S08 Rule changes | `GET /compliance/rule-changes/{documentId}` · `POST /actions` (`RULE_CHANGE_APPROVE`) · `GET /engagements?filter[ruleId][eq]=` |
| M16-S05 Sources | `GET /knowledge/sources` · `POST /knowledge/sources/{id}/check` · `POST /knowledge/sources/{id}/reingest` |
| M12-S02 · M09-S02 (updated) | `GET /compliance/checks?engagementRef=` |
| M18-S04 (updated) | `GET /runs/{id}` with `nodes`, `events`, `stateCard` · `POST /runs/{id}/retry?from=checkpoint` |
| M18-S01 (updated) | `GET /agents` with `defaultTier`, `escalationLadder`, `jury`, `cacheHitRate30d`, `costPerRun30d` |

### Open questions from this pass

1. **Rule resolution date.** Checks use `asOf = training_start`. Is that right for the claim window too, or should claim rules resolve as at submission?
2. **Jury cost.** Three STRONG calls to approve one action roughly triples that step's cost. Is the jury per action type, or only above a value threshold?
3. **Batch windows.** If a tier is restricted to off-peak and a user triggers it at 10:00, does the run queue or escalate? The UI currently implies queue for batch tiers, escalate otherwise.
4. **Key reveal.** Should reveal be possible at all once a key is saved, or only rotate-and-replace?
5. **Pass-through billing** needs a per-client meter — is that a TrainOS invoice line or a report the client reconciles themselves?


---

## 18 · Supersedes (decisions pass)

Three items in §17 and §12 are overridden by DECISIONS.md. Implement these, not the earlier text.

**Rule resolution date** — replaces `asOf = training_start`:

```
GET /v1/compliance/checks?engagementRef=ENG-0231
```

```json
{ "ruleResolution": {
    "grantSide": { "asOf": "2026-10-28", "basis": "GRANT_SUBMITTED", "ruleSetVersion": "rs_2026_06_15" },
    "claimSide": { "asOf": null, "basis": "CLAIM_SUBMITTED", "ruleSetVersion": null } },
  "versionDrift": [ { "checkKey": "CHK_LEAD_TIME", "appliedVersion": "rs_2026_06_15", "currentVersion": "rs_2027_01_01",
      "severity": "WARN", "message": "Applied 3-day public lead time in force at submission; 14 days applies from 1 Jan 2027." } ] }
```

The engagement stores `ruleSetVersion` at grant submission. Checks re-evaluate at every stage transition; a version change between stages produces a `versionDrift` warning citing both, never a silent switch.

**Jury** — `jury` on `/v1/ai/routing` is an object, not a boolean:

```json
"jury": { "mode": "ESCALATE", "quorum": 2, "of": 3, "tiers": ["STRONG_1","STRONG_2","STRONG_3"],
  "sampleRate": 0.05,
  "triggers": { "minConfidence": 0.70, "maxValue": { "amount": 5000000, "currency": "MYR" }, "firstOfKind": true } }
```

`GATE` runs at promotion time against the golden set only. `SAMPLE` runs asynchronously after the human decides and never blocks. `ESCALATE` blocks only when a trigger fires. Sampled results emit `JuryDisagreed` for drift monitoring without touching the decision.

**Money** — `total-from-lines`, integer sen, each line rounded half-up before summing; SST on the summed net. A package price is one line at `qty: 1`; any per-pax figure is `display.perPax`, never a line. `POST /v1/invoices` rejects a payload whose `total` does not equal the sum of its rounded lines with `422 VALIDATION_FAILED`, `details.reason: "TOTAL_NOT_RECONCILED"`.

**Rate card** — `RateCard{version,effectiveFrom,effectiveTo,currency,trainerDayRate{band,override},materialsPerPax{programmeType},venue{mode},travel{region},mealsPerPax{acmCeiling},commissionPct{role,band},marginFloorPct{programmeType},discountAuthority{role,maxPct}}`. Every `Quotation` stores `rateCardVersion`. Until Finance supplies values, the API returns `version: "v0-placeholder"` and clients render the placeholder label.

**Hours saved** — `GET /v1/reports/hours-saved` returns `{ hours, basis: "MEASURED"|"ILLUSTRATIVE", haircut: 0.7, baselineTableVersion, actionTypes[{key,baselineMinutes,humanMinutes,credited}] }`. The tile must render `basis` — it may not display a bare number.
