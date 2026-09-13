# The golden path, as SQL RPC specs

What the migrations lane implements so the web client can stop running on
fixtures. One spec per endpoint in `08-rpc-pattern-from-showroom.md` §11, in the
order that doc gives them.

The client side is built and green: `apps/web/src/shared/api/client.ts` declares
the interface the contract gate reads, `rpcClient.ts` implements it against
PostgREST, and `apps/web/src/shared/api/__tests__/conformance.test.ts` runs one
set of cases against both the fixture oracle and the RPC client. **Every
function below is named by that client today and does not exist in the database.**
The client degrades a missing function to a transport failure on `PGRST202` /
`42883`, so the app boots and fails per-feature rather than all at once.

---

## 0 · The posture every function in this document shares

```sql
CREATE OR REPLACE FUNCTION core.<verb_noun>(…)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $fn$ … $fn$;

REVOKE ALL ON FUNCTION core.<verb_noun>(…) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION core.<verb_noun>(…) TO authenticated;
```

Five rules, each with a reason rather than a convention:

1. **`core`, not `app`.** `config.toml:18` exposes `["public", "core",
   "graphql_public"]`. `app` is deliberately absent, which is what keeps the
   policy gate's internals unreachable from a browser. A function a client calls
   must live in `core`; a function only a worker calls must not.
2. **`SET search_path = ''` and fully `pg_catalog.`-qualified bodies**, matching
   001–012. An empty search path means a caller cannot shadow a function name
   the body depends on.
3. **`SECURITY DEFINER`**, because the body reads `app.require_tenant_id()` and
   `app.current_actor()`, and calls `app.ok()` / `app.err()` — all of which are
   `REVOKE`d from `authenticated` (001 §6, 002:614-619). The definer owner keeps
   EXECUTE; the caller never gets it. Do **not** grant those to `authenticated`
   to make a function work. That is the failure this split exists to prevent.
4. **Every return is `app.ok(…)` or `app.err(…)`.** `check:rpc` E1 is BROKEN on
   any hand-built `jsonb_build_object('success', …)` outside 001. `app.ok`
   guarantees `data` is the sole non-`success` key, which is the precondition
   the client's auto-unwrap depends on.
5. **Tenant comes from `app.require_tenant_id()`, never from an argument.** The
   contract states tenant is implicit from auth and never appears in a path or
   body. A `p_tenant_id` argument is a cross-tenant read waiting for a caller to
   pass the wrong value.

### The envelope, exactly

`app.ok(p_data)` produces `{"success": true, "data": <p_data>}` and nothing
else. The client strips `success`, sees `data` as the only remaining key, and
unwraps it. **Adding any third top-level key flips every caller in the app from
auto-unwrap to pass-through at once** — that is the incident `check:rpc` exists
for, and 001's own `COMMENT ON FUNCTION app.ok` says so. New fields go inside
`data`.

So where this document writes "envelope keys", it means the keys **inside
`data`**, which are the contract's own field names in camelCase. SQL columns are
`snake_case`; the projection to camelCase happens in SQL, not in the client —
the client types everything from `@trainos/contract` and does no renaming.

### How a refusal travels

Two mechanisms, and they are not interchangeable.

| | `app.err(code, details)` | `RAISE … USING ERRCODE = 'TRNOS'` |
|---|---|---|
| Wire shape | `{success:false, error:{code[,details]}}` | PostgREST error, `code` = `TRNOS`, `details` = the jsonb |
| Transaction | commits | rolls back |
| `message` | **none** — `app.err` writes no message | the exception message |
| Seen by E1 | yes | no (documented limitation) |

011 uses the RAISE form throughout, with
`DETAIL = jsonb_build_object('code','FORBIDDEN', …)::text`. The client handles
both: `classifyTransportFailure()` parses a `TRNOS` detail bag into a
`DomainError`, and `unwrapEnvelope()` handles `app.err`. **Use RAISE for
anything that must not leave a partial write behind, and `app.err` only for a
refusal computed before any write.** Note the client supplies a fallback message
per code when `app.err` omits one, so a refusal is never rendered as
`undefined` — but a written message is always better than the fallback.

### Idempotency

The contract carries `Idempotency-Key` as an HTTP header. PostgREST ignores it.
Every write below therefore takes `p_idempotency_key text` and the client passes
it as an RPC **argument**, derived from the request's own identity so a
double-click and a retry resolve to one governed action. `app.idempotency_keys`
and the hash-and-compare logic already exist in 011:1978 onward — reuse it,
never re-implement it, and a reused key with a different body is
`IDEMPOTENT_REPLAY`.

### The pin every function needs

001–012 assert their own invariants in a trailing `DO $verify$` block rather
than trusting review. Each function below names its pin; all of them belong in
one `DO $verify$` at the end of the migration, and each should also assert the
shared posture:

```sql
-- Posture pin, once per function, applied to every function in the migration.
IF NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'core' AND p.proname = '<name>'
     AND p.prosecdef
     AND p.proconfig @> ARRAY['search_path=']
) THEN
  RAISE EXCEPTION '0NN verify: core.<name> is not definer with an empty search_path';
END IF;
```

Assert the **exact stored string** for `search_path`. The quoted list form is a
silent no-op — a function that looks configured and is not.

---

## 1 · Where these ten stand against 011

| Spec | 011 status |
|---|---|
| `core.perform_action` | **wraps** `app.perform_action` (011:1978) |
| `core.decide_approval` | **wraps** `app.decide_approval` (011:2594) |
| `core.bulk_decide_approvals` | **wraps** `app.bulk_decide` (011:3178) |
| `core.list_approvals`, `core.get_approval` | read `core.v_approval_requests` (011:1408), which is **revoked from `authenticated`** |
| `core.navigation` | uses `app.open_approval_count` (011:1588) |
| `core.me`, `core.list_enquiries`, `core.get_enquiry`, `core.get_organisation`, `core.get_tna`, `core.create_proposal`, `core.get_proposal`, `core.get_quotation`, `core.put_quotation` | **new SQL** |

Three facts from 011 that change how the wrappers must be written:

- **`app.perform_action` does not return an envelope.** Its last statement is
  `RETURN v_result` where `v_result` is a bare
  `{status, result|approvalRequest|draft}`. The `core` wrapper must call
  `app.ok()` around it. Do not "fix" this in `app` — 012's worker path returns
  the same value and does not want an envelope.
- **All three are granted to `service_role` only** (011:3408-3415). The wrapper
  is what makes them reachable; the underlying grant must not change.
- **`POLICY_APPROVAL_REQUIRED` is already a success.** `app.perform_action`
  returns `{"status":"QUEUED_FOR_APPROVAL","approvalRequest":{…}}`, which is the
  §1 table's "202, not an error" row honoured in SQL. The wrapper must not
  reclassify it. The client has a `liftPolicyOutcome()` safety net for a
  database that answers with `app.err('POLICY_APPROVAL_REQUIRED', …)` instead,
  but that path should never fire.

---

## 2 · `core.perform_action` — the action gate

The one endpoint every write in the app goes through. Build it first: nothing
else unblocks a button.

```sql
core.perform_action(
  p_type            text,
  p_target_ref      text    DEFAULT NULL,
  p_payload         jsonb   DEFAULT '{}'::jsonb,
  p_requested_by    jsonb   DEFAULT NULL,
  p_confidence      numeric DEFAULT NULL,
  p_reasoning       text    DEFAULT NULL,
  p_evidence        jsonb   DEFAULT '[]'::jsonb,
  p_idempotency_key text    DEFAULT NULL
) RETURNS jsonb
```

The argument list is `app.perform_action`'s, verbatim and in order, and the
client sends exactly these names. Keeping them identical means the wrapper is a
one-line body and a rename on either side is a break a reader can see.

**Body.** `SELECT app.ok(app.perform_action(p_type, p_target_ref, p_payload,
p_requested_by, p_confidence, p_reasoning, p_evidence, p_idempotency_key));`
Nothing else. No re-validation, no second tenant check — `app.perform_action`
calls `app.require_tenant_id()` itself at line 1979 and resolves the actor from
`app.current_actor()`.

**Envelope.** `data` is one of the three §3 outcomes:

| `status` | further keys |
|---|---|
| `EXECUTED` | `result: { effects: Effect[] }` |
| `QUEUED_FOR_APPROVAL` | `approvalRequest: { id, ref, policyId, approverRole, assignedTo?, slaDueAt, createdAt }` |
| `SUGGESTED` | `draft: { id, type, body, expiresAt }` |

**Reads/writes.** Everything `app.perform_action` touches: `app.action_types`,
`app.idempotency_keys`, `core.autonomy_grants`, `core.action_policies`,
`core.action_requests`, `app.action_effects`, `core.approval_requests`,
`core.suggested_drafts`, `core.state_transitions`, `app.outbox`, `core.events`.

**Tenant.** Inherited; the wrapper adds none.

**Idempotency.** `p_idempotency_key`, handled entirely inside 011.

**Errors.** Raised by 011 as `TRNOS`: `VALIDATION_FAILED` (unknown type, payload
schema, bad `requestedBy`), `FORBIDDEN` (requester mismatch, no `app_role`,
`AAL2_REQUIRED` on money-moving actions), `AGENT_PAUSED` (tenant kill switch or
a paused agent), `IDEMPOTENT_REPLAY` (same key, different body).

**Pin.** Assert the wrapper body actually calls the gate and nothing else, so a
later edit cannot quietly inline a second policy evaluation:

```sql
IF pg_catalog.strpos(
     pg_catalog.regexp_replace(
       pg_catalog.pg_get_functiondef(
         'core.perform_action(text,text,jsonb,jsonb,numeric,text,jsonb,text)'::regprocedure),
       '\s+','','g'),
     'app.ok(app.perform_action(') = 0 THEN
  RAISE EXCEPTION '0NN verify: core.perform_action does not wrap app.perform_action';
END IF;
```

Pin the grants too: `core.perform_action` to `authenticated`, and
`app.perform_action` still **not** granted to `authenticated`.

---

## 3 · `core.me` — identity

Nothing else can be tested until identity is real. It replaces
`ACTOR_FOR_ROLE`'s fixture principal in `useApi.ts`.

```sql
core.me() RETURNS jsonb
```

**Body.** `app.require_tenant_id()`, then `app.current_actor()` for
`(actor_id, actor_kind, role)`, then the profile row and the tenant row.

**Envelope.** `data`: `{ id, name, email, role, permissions[], tenant: { id,
name, timezone, currency } }`. `permissions` comes from `app.role_permissions`
for the actor's role — sent as a list so the client can disable an affordance
without guessing at the role table, which is what makes a 403 surface
non-decorative.

**Reads.** `public.user_profiles`, `public.memberships`, `public.tenants`,
`app.role_permissions`.

**Errors.** `FORBIDDEN` when `app.current_actor()` yields no role — the same
condition 011:107 raises on. Never return a partial `me`: a shell that renders
with a null role renders every gate open.

**Pin.** Assert `core.me()` returns a `permissions` key, because a client that
gets `me` without it silently falls back to showing everything.

---

## 4 · `core.navigation` — sidebar and queue badges

```sql
core.navigation() RETURNS jsonb
```

**Body.** Builds the nav tree for `app.current_actor().role` and attaches badge
counts. Uses `app.open_approval_count(p_user_id)` (011:1588), which exists.

**Envelope.** `data`: `{ sections: [{ key, label, items: [{ key, label, route,
badge?: { count, severity } }] }] }`.

**Reads.** `core.approval_requests` via `app.open_approval_count`, plus whatever
counts the other queues need. **Stage names and pipeline entries render from
`core.pipelines` / `core.pipeline_steps`, never hardcoded** — CLAUDE.md's
standing rule, and the reason the nav is an RPC rather than a static file.

**Errors.** None expected; an empty tree is a bug, not an empty state.

**Pin.** Assert the function reads `core.pipeline_steps`, so a later edit cannot
inline a stage list.

---

## 5 · `core.list_enquiries` — the first `ListResponse`

This establishes the pagination convention for all thirty-odd collection
endpoints. Get it right once.

```sql
core.list_enquiries(
  p_filter jsonb DEFAULT '[]'::jsonb,
  p_sort   text  DEFAULT NULL,
  p_page   jsonb DEFAULT '{"size":50}'::jsonb,
  p_view   text  DEFAULT NULL
) RETURNS jsonb
```

The client sends exactly these four (`pageArgs()` in `rpcClient.ts`). They stay
separate rather than collapsing into one bag so SQL can validate each
independently — a malformed sort must not read as a missing filter.

- `p_filter`: `[{ "field": …, "op": …, "value": … }]`, the §1 filter grammar.
- `p_sort`: a field name, `-` prefix for descending.
- `p_page`: `{ "size": int, "cursor": text|null }` — **keyset, not offset.**
- `p_view`: a `core.saved_views` id whose filters merge in; request filters win.

**Envelope.** `data`: `{ data: Enquiry[], page: { next: string|null, total: int
}, appliedFilters: [{ field, op, value, source }] }`.

Two things this must get right, because thirty endpoints will copy it:

- **`next` is `null` on the last page, never absent.** The client's unwrap rule
  is sensitive to key sets; an omitted key changes shape.
- **`appliedFilters[].source`** distinguishes a filter the caller sent from one
  the saved view contributed. Without it the UI cannot show a reader why rows
  are missing.

**Reads.** `core.enquiries`, joined to `core.organisations` for the matched
organisation name, and `core.provenance` for the classification confidence.

**Errors.** `VALIDATION_FAILED` with `details.fields[]` for an unknown filter
field, an unsupported op, or a malformed cursor. Fail closed — an unrecognised
filter must not be ignored, because ignoring it shows rows the reader asked to
exclude.

**Pin.** Assert `page.next` is present-and-null rather than absent on a terminal
page. That is the one a test catches and a reviewer does not.

---

## 6 · `core.get_enquiry` — the first provenance composition

```sql
core.get_enquiry(p_id text) RETURNS jsonb
```

`p_id` is `text` and accepts **either the uuid or the `ref`** (`ENQ-2026-0912`),
matching the fixture client's `byIdOrRef`. The app routes on refs.

**Envelope.** `data` is `EnquiryDetail`: the `EntityEnvelope` (`id`, `ref`,
`createdAt`, `updatedAt`, `createdBy {id,name,kind}`) plus the enquiry fields,
plus `extraction`, which is the shape that matters:

```json
"extraction": {
  "headcount": { "value": 40, "provenance": { "origin": "AI_EXTRACTED",
    "confidence": 0.86, "agentId": "…", "runId": "…", "model": "…",
    "tier": "…", "sources": [{ "type": "EMAIL", "ref": "…", "excerpt": "…" }] } }
}
```

**Absent provenance means human-authored.** Emit no `provenance` key rather than
a null one — the AI badge renders on presence, so a null would badge every
hand-typed field.

**Reads.** `core.enquiries`, `core.enquiry_extraction_fields`, `core.provenance`
joined on `(subject_table, subject_id, field)`, `core.organisations`,
`core.contacts`.

**Errors.** `NOT_FOUND` when no row matches in this tenant. Do **not**
distinguish "exists in another tenant" from "does not exist" — that is a
cross-tenant existence oracle.

**Pin.** Assert a field with no `core.provenance` row emits no `provenance` key.

---

## 7 · `core.get_organisation` and the relations view — organisation 360

```sql
core.get_organisation(p_id text) RETURNS jsonb
```

**Envelope.** `data` is `Organisation`: envelope fields plus `name`, `industry`,
`location`, `owner`, `status`, `hrdcRegistered`, `hrdcEmployerCode`,
`proposalCount`, `firstProposalSentAt`, `healthScore`, and the rolled-up
finance and engagement summary the 360 screen renders.

**Reads.** `core.organisations`, `core.organisation_health_snapshots`,
`core.contacts`, `core.opportunities`, `core.engagements`, `core.invoices`.

Relations are the **one endpoint in this set that is a view, not an RPC**
(§8 bucket list):

```sql
CREATE VIEW core.v_organisation_relations WITH (security_invoker = true) AS …;
GRANT SELECT ON core.v_organisation_relations TO authenticated;
```

One row per organisation, keyed `organisation_id`, whose columns compose the
`OrganisationRelations` shape. The client reads it with
`.from("v_organisation_relations").select("*").match({organisation_id})` and
treats an empty result as `NOT_FOUND`, because the contract types this endpoint
as a record rather than a collection.

`security_invoker = true` is not optional: a view without it runs as its owner
and returns every tenant's rows. 011:1408 and 012:2640 both set it; match them.

**Pin.** Assert `relispopulated = false` and that `reloptions` contains
`security_invoker=true` for every `core.v_*` view the client reads.

---

## 8 · `core.get_tna` — a read of worker-produced rows

```sql
core.get_tna(p_id text) RETURNS jsonb
core.get_tna_recommendations(p_id text) RETURNS jsonb
```

**Envelope (`get_tna`).** `data` is `Tna`: envelope fields, `status`, `sentAt`,
`completedAt`, `completedBy {id,name,kind}` (kind may be `CLIENT`, §12), the
audience block (`headcount`, `level`, `sites`, `language`), `budget` as
`Money`, `gaps[]`, `constraints[]`, `evidence[]`.

**Envelope (`get_tna_recommendations`).** `data`: `{ recommendations: [{
programmeId, programmeRef, fitScore, rationale, priceIndication: Money, rank,
provenance }], scoringModelVersion, scoringWeights }`.

**This must never generate on demand.** `core.tna_recommendations` holds rows a
worker produced; the endpoint reads them. An LLM call inside a request is the
thing the worker split in §10 of the pattern doc exists to prevent, and it would
blow the 10s statement timeout under load.

**Reads.** `core.tnas`, `core.tna_gaps`, `core.tna_constraints`,
`core.tna_evidence`, `core.tna_recommendations`, `core.programmes`,
`core.provenance`.

**Errors.** `NOT_FOUND`. An empty `recommendations` array is a legitimate
answer — the worker has not run yet — and must not be a 404.

**Pin.** Assert the function body contains no `net.http_post` and no reference
to `core.runs`, so "generate on read" cannot be added later without tripping it.

---

## 9 · `core.create_proposal` and `core.get_proposal`

```sql
core.create_proposal(p_body jsonb, p_idempotency_key text) RETURNS jsonb
core.get_proposal(p_id text) RETURNS jsonb
```

`p_body` is the contract's `ProposalCreateRequest`, passed whole rather than
exploded into arguments: the shape is the contract's and belongs in one place.
The client strips its own `idempotencyKey` before sending, so `p_body` is
exactly the contract shape.

**Create — envelope.** `data` is the created `Proposal`. Status `201` has no
meaning over PostgREST; the created record is the response.

**Create — idempotency.** Required, not optional. Two governed writes were
already found sending no key at all, which is how a double-click becomes two
proposals. Reuse `app.idempotency_keys` the way 011 does.

**Get — envelope.** `data` is `Proposal`: envelope fields, `status`, `value`
(`Money`), `marginRate`, `sentAt`, `firstViewedAt`, `acceptedAt`, `sections[]`
with `{ n, title, body, mergeFieldsUsed, needsReview, provenance? }`, and the
floor-price fields the `FLOOR_PRICE_BREACH` detail bag references —
`floorPrice`, `absoluteFloorPrice`, `marginFloorPrice`, `bindingFloorBasis`,
`resultingMarginRate` (Ruling R6).

**Reads.** `core.proposals`, `core.proposal_sections`, `core.templates`,
`core.template_sections`, `core.provenance` per section,
`core.rate_card_margin_floors`, `core.quotations`.

**Errors.** `VALIDATION_FAILED`; `NOT_FOUND` for an unknown `opportunityRef`;
`FLOOR_PRICE_BREACH` with the full R6 detail bag if creation prices below the
floor. Note `PROPOSAL_SEND` is **not** here — it is an action type and goes
through `core.perform_action`.

**Pin.** Assert `core.create_proposal` writes an `app.idempotency_keys` row, so
the key can never become decorative.

---

## 10 · `core.get_quotation` and `core.put_quotation` — the money rule

```sql
core.get_quotation(p_id text) RETURNS jsonb
core.put_quotation(p_id text, p_body jsonb, p_idempotency_key text) RETURNS jsonb
```

**Envelope.** `data` is `Quotation`: envelope fields, `version`,
`supersedesQuotationId`, `pax`, `lines[]` with `{ n, item, detail, basis, qty,
unit, unitPrice: Money, total: Money, isCost }`, `sellPrice`, `directCost`,
`margin`, `marginRate`, `floorPrice`, `marginFloorPrice`, `absoluteFloorPrice`,
`bindingFloorBasis`, `belowFloor`, `commission`, `displayPerPax`, `status`.

**The §18 money rule, and it is the whole of this endpoint.** Integer sen, never
floats. **Lines are truth.** Each line is `unitPrice × qty` rounded half-up to
the sen through `app.round_half_up_sen` (001:372, already exists); totals sum
the **rounded** lines; SST is computed on the summed net. A per-pax figure that
does not multiply cleanly is `displayPerPax` — display only, never a line.

Getting this wrong does not look like a bug. It looks like an invoice that is
one sen out, and `reconcileInvoice` rejects it later with
`details.reason: "TOTAL_NOT_RECONCILED"`.

**Reads/writes.** `core.quotations`, `core.quotation_lines`, `core.rate_cards`
and the seven `core.rate_card_*` tables, `core.tenant_tax_profiles` for SST.

**Errors.** `VALIDATION_FAILED` (`TOTAL_NOT_RECONCILED` when the submitted total
does not equal the sum of rounded lines); `FLOOR_PRICE_BREACH` with the R6 bag;
`POLICY_APPROVAL_REQUIRED` is **not** raised here — a discount that needs
approval goes through `DISCOUNT_APPROVE` on `core.perform_action`.

**Pin.** Assert every money projection in the body routes through
`app.round_half_up_sen`, and that no `float8`/`numeric`-to-float cast appears.

---

## 11 · Approvals — list, detail, decide

This closes the loop `core.perform_action` opens.

```sql
core.list_approvals(p_filter jsonb, p_sort text, p_page jsonb, p_view text) RETURNS jsonb
core.get_approval(p_id text) RETURNS jsonb
core.decide_approval(p_approval_id uuid, p_decision text, p_note text, p_idempotency_key text) RETURNS jsonb
core.bulk_decide_approvals(p_ids uuid[], p_decision text, p_note text, p_idempotency_key text) RETURNS jsonb
```

**`core.v_approval_requests` already computes the hard parts** — `sla_breached`,
`sla_remaining_minutes` and `urgency_group`, tenant-timezone-aware (011:1408).
Read it rather than recomputing; a second copy of the urgency boundaries will
drift from the first.

**It is currently `REVOKE ALL … FROM PUBLIC, anon, authenticated` (011:1428).**
That is why these are RPCs: a `SECURITY DEFINER` function in `core` can read the
view, a browser cannot. **Do not grant the view to `authenticated` to shortcut
this** — it carries `diff`, `diff_hash`, `recommendation` and `evidence` for
every approval in the tenant regardless of approver role.

**`list_approvals` envelope.** `data`: `{ data: ApprovalRequest[], page: { next,
total }, groups: [{ key: UrgencyGroup, count }], summary?: {
medianDecisionSeconds } }`. Note `groups` sits **beside** `data` inside the
`data` object — that is fine, it is one level down from the envelope. It would
be a live incident one level up.

`bulkApprovable` is server-decided and is `false` for any action carrying a
monetary value. `slaBreached` never blocks — it is the §1 table's
"`SLA_BREACHED` is a 200 plus a flag" row, and the client explicitly keeps it
out of the error branch.

**`get_approval` envelope.** `ApprovalDetail`: the list fields plus `reason`,
`recommendation { verdict, rationale, provenance? }`, `evidence[] { n, type,
ref, label }`, `deviations[]`, `risk { level, note }`, `diff[] { op, entity,
ref?, description }`, `previewUrl?`, `modelAgreement?`.

**`decide_approval`.** Wraps `app.decide_approval(p_approval_id, p_decision,
p_note, p_expected_diff_hash, p_idempotency_key)` in `app.ok()`. The client does
not send `p_expected_diff_hash` today, so the wrapper passes `NULL`; **wire it
through as soon as the detail screen can carry the hash it rendered**, because
that argument is the whole §7 guarantee that `effects[]` matches the `diff[]`
the approver actually read. Until then, a `409 diffChanged` cannot be detected.

**`decide_approval` envelope.** `data`: `{ status, decidedBy { id, name, kind },
decidedAt, effects[] }`, and `effects[]` **must equal** the `diff[]` the detail
screen showed, field for field.

**Errors.** `FORBIDDEN` (wrong approver role, or approving your own request —
§3 step 5); `NOT_FOUND`; `VALIDATION_FAILED` when `note` is absent for `REJECT`
or `REQUEST_CHANGES`; conflict with `details.diffChanged: true` and the
recomputed diff once the hash is wired; `409` on bulk if any id has
`bulkApprovable: false`.

**Pin.** Assert `core.decide_approval` passes all five arguments to
`app.decide_approval` — a wrapper that drops the hash argument silently disables
the diff guarantee, and its signature would still typecheck.

---

## 12 · What the client still cannot reach, and why that is fine

The interface in `client.ts` also names the §8 view reads (`v_templates`,
`v_policies`, `v_pipeline_configs`, `v_saved_views`, `v_trainers`, `v_contacts`,
`v_programmes`, `v_programme_deliveries`, `v_hrdc_deadlines`,
`v_collection_rules`, `v_compliance_rules`, `v_rule_change_sets`,
`v_agent_evals`, `v_knowledge_sources`, `v_model_tiers`, `v_budgets`). Only
`core.v_contact_consent_current` (005:222) exists. Each needs
`security_invoker = true`, RLS on the underlying tables, and
`GRANT SELECT … TO authenticated`.

Everything else in the app — engagements, attendance, HRDC packets, invoices,
collections, agents, runs, the executive dashboard, the client portal — reaches
the Supabase client through a `Proxy` that rejects by name with a message
pointing back at this document. That is deliberate: a stub returning an empty
list reads as "no records" and ships as a bug, while "not implemented by the
Supabase client" is something a reader can act on.

## 13 · Verification the client already gives you

Run these before and after the migration:

| Command | What it proves |
|---|---|
| `npm run check:rpc` | E1 envelope, E2 no double casts, E3 every client method typed from the contract |
| `npm run check:grants` | nothing client-callable is over-granted |
| `npm run lint:sql` | the migration parses |
| `npm test -w apps/web --` | the conformance suite: both clients answer identically through the envelope round trip |

The conformance suite is the useful one here. It drives the real RPC client
through the real port with a double that answers each function from the fixture
oracle and wraps it the way `app.ok()` would. A shape that survives it is a
shape the client can read; reverting the unwrap rule to unconditional
pass-through fails 13 of its 21 cases. It cannot prove the SQL exists, returns
this shape, or passes RLS — those need a database, and they are the migrations
lane's to prove.
