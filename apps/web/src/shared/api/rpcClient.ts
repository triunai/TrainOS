import type {
  ActionResponse,
  AgentEval,
  ApprovalBulkDecideResponse,
  ApprovalDecideResponse,
  ApprovalDetail,
  ApprovalListResponse,
  AuditEntry,
  ApprovalRequestRef,
  BadgeCounts,
  Budget,
  ChannelConsent,
  CollectionRule,
  CollectionsQueueResponse,
  ComplianceRule,
  Contact,
  Enquiry,
  EnquiryDetail,
  EnquiryExtractionPatch,
  ExecutiveDashboard,
  FollowUp,
  ErrorCode,
  ErrorDetails,
  HrdcDeadline,
  Invoice,
  KnowledgeSource,
  ListResponse,
  MessageChannel,
  MessageDraft,
  Me,
  MeProfile,
  ModelTier,
  NavigationTree,
  Opportunity,
  Organisation,
  OrganisationRelations,
  PageRequest,
  PipelineConfig,
  PipelineObject,
  Policy,
  Programme,
  ProgrammeDelivery,
  Proposal,
  ProposalSectionRegenerateResponse,
  ProposalsVsWonReport,
  Quotation,
  RateCard,
  ReceivablesAging,
  RuleChangeSet,
  SavedView,
  Template,
  TemplateType,
  Tna,
  TnaRecommendationsResponse,
  Trainer,
} from "@trainos/contract";
import { ERROR_STATUS } from "@trainos/contract";
import type { FixtureCommission } from "@trainos/fixtures";

import type {
  ActionInput,
  BulkDecideInput,
  DecideInput,
  ProposalInput,
  QuotationInput,
  SectionInput,
  SectionWriteInput,
  TrainOsClient,
} from "./client";
import {
  fail,
  ok,
  transportError,
  withDiagnostics,
  type ApiError,
  type DomainError,
  type Result,
} from "./errors";
import { getTransport } from "./supabase";
import type { TransportFailure, TransportResponse } from "./transport";

/**
 * The Supabase implementation of `TrainOsClient` — the ONLY place in the app
 * that calls `supabase.rpc()` or reads a table.
 *
 * Kept out of `client.ts` because the contract gate parses that file textually
 * and a class body at two spaces of indent is indistinguishable, to its regex,
 * from a malformed method signature. See the header of `client.ts`.
 *
 * WHY A TUPLE AND NOT A THROW. A `FORBIDDEN` or a `FLOOR_PRICE_BREACH` is the
 * server ANSWERING, not the request failing. Returned as a value, the refusal
 * path is something every caller has to get past in the type system; thrown, it
 * is something a caller can forget, and the result is a stack trace rendered
 * over a policy decision the reader could have acted on.
 */

/* ------------------------------------------------------------------ *
 * Transport shapes
 * ------------------------------------------------------------------ */

/**
 * The SQLSTATE the database raises for every deliberate domain refusal.
 *
 * 011 refuses by `RAISE EXCEPTION … USING ERRCODE = 'TRNOS', DETAIL = '<jsonb
 * carrying code>'` rather than by returning `app.err()`, so without this branch
 * every policy refusal in the app would arrive classified as a transport
 * failure: a retry button drawn over a decision the server already made, and
 * "Something went wrong" printed over a message that named the missing role.
 *
 * Matched on SQLSTATE, never on message text. A reworded error must not change
 * how a refusal is classified.
 */
const DOMAIN_SQLSTATE = "TRNOS";

/**
 * "That is not deployed." Matched on CODE, never on message text.
 *
 * A missing function is a deployment fact, not flakiness: the feature must
 * degrade to unsupported rather than to a generic failure that invites a retry
 * of something that can never succeed. Every RPC this client names is specified
 * but unbuilt today, so this path is the app's normal state until the
 * migrations lane lands.
 *
 * `PGRST106` is here on measured evidence, not on principle. The hosted project
 * answers EVERY call this client makes with
 * `{"code":"PGRST106","message":"Invalid schema: core","hint":"Only the
 * following schemas are exposed: public, graphql_public"}`. `config.toml:18`
 * exposes `core`, but that file configures the LOCAL CLI stack — the hosted
 * project's exposed-schema list is a separate setting that has not been
 * changed. Classified as a 500 it reads as "TrainOS is down"; classified here
 * it reads as "this endpoint is not deployed", which is both true and
 * actionable. `PGRST205` is the same fact for a table.
 */
const MISSING_FUNCTION_CODES = new Set(["PGRST202", "PGRST106", "PGRST205", "42883", "42P01"]);

/** PostgREST's JWT rejections, plus Postgres' own privilege refusal. */
const UNAUTHENTICATED_CODES = new Set(["PGRST301", "PGRST302", "42501"]);

/** Any RFC 4122 layout; the database generates v4 but the check need not care. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A code the contract knows, or something the database invented? */
function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ERROR_STATUS, value);
}

/**
 * `app.err()` writes no `message` — its envelope is `{code[, details]}` only.
 *
 * The contract's `ErrorEnvelope` requires one and `readableMessage()` shows it
 * to a person, so the client supplies a floor rather than rendering `undefined`
 * into the UI. A server that does send a message always wins.
 */
export function messageForCode(code: ErrorCode): string {
  switch (code) {
    case "VALIDATION_FAILED":
      return "Some of what you entered is not valid.";
    case "NOT_FOUND":
      return "That record no longer exists.";
    case "FORBIDDEN":
      return "You do not have permission to do that.";
    case "POLICY_APPROVAL_REQUIRED":
      return "This needs an approval before it can run.";
    case "ATTENDANCE_LOCKED":
      return "Attendance is locked and cannot be edited.";
    case "FLOOR_PRICE_BREACH":
      return "This price is below the floor.";
    case "SYNC_FAILED":
      return "The accounting sync did not complete.";
    case "AGENT_PAUSED":
      return "That agent is paused.";
    case "SLA_BREACHED":
      return "This approval is past its SLA.";
    case "DIFF_CHANGED":
      return "The rendered diff is no longer current. Refresh and decide again.";
    case "BULK_NOT_PERMITTED":
      return "Some of those approvals must be decided one at a time.";
    default:
      return "That key was already used with a different request.";
  }
}

function domainError(code: ErrorCode, message: string, bag: Record<string, unknown>): DomainError {
  const { approvalRequestId, ...details } = bag;
  return {
    kind: "domain",
    code,
    message,
    status: ERROR_STATUS[code],
    ...(Object.keys(details).length === 0 ? {} : { details: details as ErrorDetails }),
    ...(typeof approvalRequestId === "string" ? { approvalRequestId } : {}),
  };
}

/* ------------------------------------------------------------------ *
 * The unwrap rule
 * ------------------------------------------------------------------ */

/**
 * Showroom's rule, unchanged: strip `success`; if exactly one key `data`
 * remains, unwrap it; otherwise pass the rest through.
 *
 * THIS IS A WHOLE INCIDENT CLASS IN FOUR LINES. One sibling key added beside
 * `data` silently flips every caller from auto-unwrap to pass-through, and a
 * consumer's cast hides the resulting shape change from the compiler — a live
 * page white-screened on exactly that, and only on the session-restore path.
 * It is why `app.ok()` carries the comment "never add a third top-level key",
 * why E1 forbids a hand-built envelope, and why this rule is implemented once
 * rather than re-derived per method.
 *
 * The four shapes collapse to one behaviour:
 *
 * ```
 * { success: true, data: T }                 -> T
 * { success: true, data: T, extra }          -> { data, extra }
 * { success: true }                          -> {}
 * { success: true, count, items }            -> { count, items }
 * a scalar or array with no `success` key    -> itself
 * ```
 */
export function unwrapEnvelope(body: unknown): Result<unknown> {
  if (!isRecord(body) || !("success" in body)) return ok(body);

  if (body.success === false) {
    const raw = isRecord(body.error) ? body.error : {};
    const { code, message, details, ...rest } = raw;
    const resolved: ErrorCode = isErrorCode(code) ? code : "VALIDATION_FAILED";
    const bag = isRecord(details) ? { ...details, ...rest } : rest;
    const text = typeof message === "string" ? message : messageForCode(resolved);
    return fail(domainError(resolved, text, bag));
  }

  const rest: Record<string, unknown> = { ...body };
  delete rest.success;
  const keys = Object.keys(rest);
  return ok(keys.length === 1 && keys[0] === "data" ? rest.data : rest);
}

/**
 * The contract's audit resource type, in the database's spelling.
 *
 * The contract addresses a trail by its ROUTE SEGMENT — `/v1/approvals/{id}/audit`,
 * plural and lowercase, which is also the fixture store's key. The database
 * keys it by AGGREGATE TYPE: `core.audit_entries.subject_type` is CHECKed
 * `^[A-Z][A-Z0-9_]*$` (012:598) and written as the singular entity upper-cased
 * (`app.aggregate_type_for`, 012:1010). Sent as-is, `approvals` can never match
 * a row, and the trail is empty rather than an error — which is why nobody saw
 * it. The rule is derived rather than listed so a new record type needs no entry
 * here: singular, kebab to snake, upper-cased. A value already in UPPER_SNAKE
 * passes through untouched.
 */
export function aggregateTypeOf(resourceType: string): string {
  if (/^[A-Z][A-Z0-9_]*$/.test(resourceType)) return resourceType;
  return resourceType.replace(/s$/, "").replace(/-/g, "_").toUpperCase();
}

/**
 * A view read's failure. The same split, with one difference: `42501`.
 *
 * On an RPC, `42501` is the database refusing a principal with no tenant, and
 * sign-in reads it as "not linked", so it stays `UNAUTHENTICATED`. On a VIEW it
 * is a GRANT that has not shipped — a view is checked against the invoker for
 * every function in its body, and `v_organisation_relations`, `v_budgets` and
 * `v_model_tiers` call `app.*` helpers `authenticated` cannot execute (018:706,
 * 018:4705-4706). Drawn as "Your session has expired" it sent a signed-in reader
 * to sign in again; it is a deployment fact, so it reads as one. A signed-out
 * reader never reaches a view read — the session guard answers first.
 */
export function classifyViewFailure(failure: TransportFailure): ApiError {
  if (failure.code === "42501") {
    return withDiagnostics(
      transportError("NOT_DEPLOYED", `${failure.message} — view grant not deployed`, {
        status: 404,
      }),
      { sourceCode: failure.code },
    );
  }
  return classifyTransportFailure(failure);
}

/** A supabase-js failure, split into the domain and transport branches. */
export function classifyTransportFailure(failure: TransportFailure): ApiError {
  const code = failure.code ?? "";
  return code === ""
    ? classify(failure, code)
    : withDiagnostics(classify(failure, code), { sourceCode: code });
}

function classify(failure: TransportFailure, code: string): ApiError {
  if (code === DOMAIN_SQLSTATE) {
    let parsed: unknown = null;
    if (typeof failure.details === "string") {
      try {
        parsed = JSON.parse(failure.details);
      } catch {
        parsed = null;
      }
    }
    if (!isRecord(parsed)) return domainError("VALIDATION_FAILED", failure.message, {});
    const { code: raised, ...bag } = parsed;
    const resolved: ErrorCode = isErrorCode(raised) ? raised : "VALIDATION_FAILED";
    return domainError(resolved, failure.message, bag);
  }

  if (MISSING_FUNCTION_CODES.has(code)) {
    return transportError("NOT_DEPLOYED", `${failure.message} — endpoint not deployed`, {
      status: 404,
    });
  }

  if (UNAUTHENTICATED_CODES.has(code)) {
    return transportError("UNAUTHENTICATED", failure.message, { status: 401 });
  }

  return transportError("SERVER", failure.message, { status: 500, cause: failure });
}

/**
 * `POLICY_APPROVAL_REQUIRED` and `SLA_BREACHED` are NOT the error branch.
 *
 * The §1 table gives the first a 202 carrying `approvalRequestId` and the
 * second a 200 surfaced as a flag on the approval. A client that routes either
 * into `error` renders an approval queue as a failure — the write was
 * intercepted by policy, which is the system working rather than refusing.
 *
 * `app.perform_action` already returns the queued case as a success payload, so
 * this handles the other shape: a database that answers
 * `app.err('POLICY_APPROVAL_REQUIRED', {approvalRequest})`. Without the
 * `approvalRequest` there is nothing to route the user to, so the refusal
 * stands rather than being turned into a success with a hole in it.
 */
export function liftPolicyOutcome(result: Result<ActionResponse>): Result<ActionResponse> {
  if (result.error === null || result.error.kind !== "domain") return result;
  if (result.error.code !== "POLICY_APPROVAL_REQUIRED") return result;

  const approvalRequest = result.error.details?.approvalRequest;
  if (!isApprovalRequestRef(approvalRequest)) return result;
  return ok({ status: "QUEUED_FOR_APPROVAL", approvalRequest });
}

/**
 * A runtime guard rather than a cast.
 *
 * E2 forbids the double cast in this folder, and it is right to: the value here
 * came out of a jsonb `details` bag, which the type system knows nothing about.
 * Asserting the shape would turn "the database sent a partial approval" into
 * `undefined.ref` on the screen that routes the user to it. Checking it means a
 * partial payload leaves the refusal standing, which is the honest outcome.
 */
function isApprovalRequestRef(value: unknown): value is ApprovalRequestRef {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.ref === "string" &&
    typeof value.policyId === "string" &&
    typeof value.approverRole === "string" &&
    typeof value.slaDueAt === "string" &&
    typeof value.createdAt === "string"
  );
}

/* ------------------------------------------------------------------ *
 * The §8 buckets, named
 * ------------------------------------------------------------------ */

/**
 * The §8 PostgREST view reads — the ONE place TrainOS departs from showroom's
 * "RPC only" rule, licensed by `config.toml` exposing the `core` schema.
 *
 * A read qualifies only when one view row maps 1:1 onto the contract shape:
 * no `page` envelope to compose, no provenance to assemble. Everything else is
 * an RPC, because a flat table read cannot build `{ data, page,
 * appliedFilters }`.
 *
 * 020 built every view below except `v_pipeline_configs` (nothing in the web
 * calls it — `get_pipeline_config` is the RPC every screen uses). `contactConsent`
 * reads `v_contact_channel_consents` (020), not 005's `v_contact_consent_current`:
 * that view's columns are snake_case (`recorded_at`, not `recordedAt`) and were
 * never contract-shaped for a browser `select("*")`.
 */
export const VIEW_READS = {
  templates: "v_templates",
  policies: "v_policies",
  pipelines: "v_pipeline_configs",
  views: "v_saved_views",
  trainers: "v_trainers",
  contacts: "v_contacts",
  contactConsent: "v_contact_channel_consents",
  programmes: "v_programmes",
  programmeDeliveries: "v_programme_deliveries",
  organisationRelations: "v_organisation_relations",
  hrdcDeadlines: "v_hrdc_deadlines",
  collectionRules: "v_collection_rules",
  complianceRules: "v_compliance_rules",
  ruleChanges: "v_rule_change_sets",
  evals: "v_agent_evals",
  knowledgeSources: "v_knowledge_sources",
  aiTiers: "v_model_tiers",
  aiBudgets: "v_budgets",
} as const;

/**
 * Every RPC name this client calls, so the gap between "the client asks for it"
 * and "001–011 defines it" is one grep rather than a code read.
 *
 * NONE of these exists in `core` today. 011 defines `app.perform_action`,
 * `app.decide_approval` and `app.bulk_decide`, but all three are granted to
 * `service_role` only and `app` is deliberately not a PostgREST-exposed schema
 * — so there is no path from a browser to any of them. The three marked
 * `wraps011` need a thin `core` wrapper and a grant; the rest are new SQL.
 * Both are specified in `docs/architecture/09-golden-path-rpc-specs.md`.
 */
export const RPC_NAMES = {
  wraps011: ["perform_action", "decide_approval", "bulk_decide_approvals"],
  newSql: [
    "me",
    "me_profile",
    "navigation",
    "badge_counts",
    "get_executive_dashboard",
    "get_proposals_vs_won",
    "list_enquiries",
    "get_enquiry",
    "patch_enquiry_extraction",
    "list_follow_ups",
    "get_follow_up_draft",
    "get_organisation",
    "get_opportunity",
    "get_tna",
    "get_tna_recommendations",
    "create_proposal",
    "list_proposals",
    "get_proposal",
    "add_proposal_section",
    "put_proposal_section",
    "regenerate_proposal_section",
    "list_quotations",
    "get_quotation",
    "put_quotation",
    "get_rate_card",
    "list_approvals",
    "get_approval",
    "get_audit",
    "get_policy",
    "get_pipeline_config",
    "get_contact",
    "get_programme",
    "get_compliance_rule",
    "list_invoices",
    "get_invoice",
    "get_receivables_aging",
    "get_collections_queue",
    "get_collection_draft",
    "list_commissions",
  ],
} as const;

/**
 * The §1 query grammar, flattened into RPC arguments.
 *
 * `filter[field][op]=value` is a URL grammar; an RPC takes jsonb. The three
 * parts stay separate rather than collapsing into one bag so a SQL function can
 * validate each independently — a malformed sort must not read as a missing
 * filter.
 */
export function pageArgs(query: PageRequest): Record<string, unknown> {
  return {
    p_filter: query.filter ?? [],
    p_sort: query.sort ?? null,
    p_page: { size: query.page?.size ?? 50, cursor: query.page?.cursor ?? null },
    p_view: query.view ?? null,
  };
}

const asList = <T>(rows: T[]): ListResponse<T> => ({
  data: rows,
  page: { next: null, total: rows.length },
});

/* ------------------------------------------------------------------ *
 * The client
 * ------------------------------------------------------------------ */

export class SupabaseRpcClient implements TrainOsClient {
  /**
   * Every `supabase.rpc()` call in the app funnels through here.
   *
   * `.schema("core")` because PostgREST's default is `public` and every
   * client-callable function lives in `core`. `app` is deliberately unexposed,
   * which is what keeps the gate internals unreachable from a browser.
   */
  private async call<T>(name: string, args: Record<string, unknown> = {}): Promise<Result<T>> {
    let response: TransportResponse;
    try {
      response = await getTransport().rpc(name, args);
    } catch (thrown) {
      const message = thrown instanceof Error ? thrown.message : "Request failed";
      return fail(
        withDiagnostics(transportError("NETWORK", message, { cause: thrown }), { operation: name }),
      );
    }
    if (response.error !== null) {
      return fail(withDiagnostics(classifyTransportFailure(response.error), { operation: name }));
    }

    const unwrapped = unwrapEnvelope(response.data);
    if (unwrapped.error !== null) {
      return fail(withDiagnostics(unwrapped.error, { operation: name }));
    }
    return ok(unwrapped.data as T);
  }

  /**
   * A §8 view read, wrapped in the same `Result` and split the same way.
   *
   * `page.total` is the count of what came back, not a server-side total. These
   * endpoints were bucketed as views precisely because the contract gives them
   * no `page` envelope; a view that later needs real keyset paging is a view
   * that should have been an RPC.
   */
  private async view<T>(
    name: string,
    match?: Record<string, string>,
  ): Promise<Result<ListResponse<T>>> {
    let response: TransportResponse;
    try {
      const query = getTransport().from(name).select("*");
      response = await (match === undefined ? query : query.match(match));
    } catch (thrown) {
      const message = thrown instanceof Error ? thrown.message : "Request failed";
      return fail(
        withDiagnostics(transportError("NETWORK", message, { cause: thrown }), { operation: name }),
      );
    }
    if (response.error !== null) {
      return fail(withDiagnostics(classifyViewFailure(response.error), { operation: name }));
    }
    return ok(asList((response.data ?? []) as T[]));
  }

  /**
   * The UUID a uuid-keyed view is matched on, from whatever the caller holds.
   *
   * `v_organisation_relations`, `v_contact_channel_consents` and
   * `v_programme_deliveries` key their rows by uuid, but the screens hold
   * REFS — a route segment, `organisationRef` — and
   * a ref in a uuid `.match()` is 22P02, which reads as a server fault. The
   * record's own RPC already accepts id or ref, so it resolves one to the other;
   * a value that is already a uuid costs no round trip.
   */
  private async uuidOf(rpc: string, idOrRef: string): Promise<Result<string>> {
    if (UUID.test(idOrRef)) return ok(idOrRef);
    const record = await this.call<{ id: string }>(rpc, { p_id: idOrRef });
    if (record.error !== null) return fail(record.error);
    return ok(record.data.id);
  }

  me(): Promise<Result<Me>> {
    return this.call<Me>("me");
  }

  meProfile(): Promise<Result<MeProfile>> {
    return this.call<MeProfile>("me_profile");
  }

  navigation(): Promise<Result<NavigationTree>> {
    return this.call<NavigationTree>("navigation");
  }

  badges(): Promise<Result<BadgeCounts>> {
    return this.call<BadgeCounts>("badge_counts");
  }

  getExecutiveDashboard(period: string): Promise<Result<ExecutiveDashboard>> {
    return this.call<ExecutiveDashboard>("get_executive_dashboard", { p_period: period });
  }

  getProposalsVsWon(months: number): Promise<Result<ProposalsVsWonReport>> {
    return this.call<ProposalsVsWonReport>("get_proposals_vs_won", { p_months: months });
  }

  listEnquiries(query: PageRequest): Promise<Result<ListResponse<Enquiry>>> {
    return this.call<ListResponse<Enquiry>>("list_enquiries", pageArgs(query));
  }

  getEnquiry(id: string): Promise<Result<EnquiryDetail>> {
    return this.call<EnquiryDetail>("get_enquiry", { p_id: id });
  }

  /**
   * §4 edit-before-use on one extracted field.
   *
   * The patch is a VALUE, not a merge the client computes: the field's
   * provenance flips to `AI_SUGGESTED` with `editedBy` on the server, and a
   * client that assembled the new record itself would be inventing the
   * provenance the chip on that field reads.
   */
  patchExtraction(id: string, patch: EnquiryExtractionPatch): Promise<Result<EnquiryDetail>> {
    return this.call<EnquiryDetail>("patch_enquiry_extraction", { p_id: id, p_patch: patch });
  }

  listFollowUps(query: PageRequest): Promise<Result<ListResponse<FollowUp>>> {
    return this.call<ListResponse<FollowUp>>("list_follow_ups", pageArgs(query));
  }

  getFollowUpDraft(id: string, channel: MessageChannel): Promise<Result<MessageDraft>> {
    return this.call<MessageDraft>("get_follow_up_draft", { p_id: id, p_channel: channel });
  }

  getOrganisation(id: string): Promise<Result<Organisation>> {
    return this.call<Organisation>("get_organisation", { p_id: id });
  }

  /**
   * A view read that returns ONE row, so the empty case is a 404 and not an
   * empty list. The contract types this endpoint as a record, not a collection.
   */
  async getOrganisationRelations(id: string): Promise<Result<OrganisationRelations>> {
    const uuid = await this.uuidOf("get_organisation", id);
    if (uuid.error !== null) return fail(uuid.error);
    const rows = await this.view<OrganisationRelations>(VIEW_READS.organisationRelations, {
      organisation_id: uuid.data,
    });
    if (rows.error !== null) return fail(rows.error);
    const first = rows.data.data[0];
    if (first === undefined) {
      return fail(domainError("NOT_FOUND", messageForCode("NOT_FOUND"), { id }));
    }
    return ok(first);
  }

  getOpportunity(id: string): Promise<Result<Opportunity>> {
    return this.call<Opportunity>("get_opportunity", { p_id: id });
  }

  getTna(id: string): Promise<Result<Tna>> {
    return this.call<Tna>("get_tna", { p_id: id });
  }

  getTnaRecommendations(id: string): Promise<Result<TnaRecommendationsResponse>> {
    return this.call<TnaRecommendationsResponse>("get_tna_recommendations", { p_id: id });
  }

  createProposal(input: ProposalInput): Promise<Result<Proposal>> {
    const { idempotencyKey, ...body } = input;
    return this.call<Proposal>("create_proposal", {
      p_body: body,
      p_idempotency_key: idempotencyKey,
    });
  }

  listProposals(query: PageRequest): Promise<Result<ListResponse<Proposal>>> {
    return this.call<ListResponse<Proposal>>("list_proposals", pageArgs(query));
  }

  getProposal(id: string): Promise<Result<Proposal>> {
    return this.call<Proposal>("get_proposal", { p_id: id });
  }

  addSection(id: string, input: SectionInput): Promise<Result<Proposal>> {
    const { idempotencyKey, ...body } = input;
    return this.call<Proposal>("add_proposal_section", {
      p_id: id,
      p_body: body,
      p_idempotency_key: idempotencyKey,
    });
  }

  putSection(id: string, n: number, input: SectionWriteInput): Promise<Result<Proposal>> {
    const { idempotencyKey, ...body } = input;
    return this.call<Proposal>("put_proposal_section", {
      p_id: id,
      p_n: n,
      p_body: body,
      p_idempotency_key: idempotencyKey,
    });
  }

  /**
   * A fresh generation, and the run that produced it.
   *
   * Not idempotent by key on purpose: a second "Regenerate" is a second
   * request for a new draft, and replaying the first response would hand the
   * reader the text they just rejected.
   */
  regenerateSection(id: string, n: number): Promise<Result<ProposalSectionRegenerateResponse>> {
    return this.call<ProposalSectionRegenerateResponse>("regenerate_proposal_section", {
      p_id: id,
      p_n: n,
    });
  }

  /**
   * §6 every quotation, priced.
   *
   * An RPC rather than a §8 view read, and not because of the page envelope
   * alone: `quotation:read` is withheld from OPS, and the refusal has to be
   * the server's. A view with RLS on it answers an unauthorised reader with an
   * EMPTY LIST, which the screen would draw as "no quotations" — a refusal
   * rendered as a fact about the data.
   */
  listQuotations(query: PageRequest): Promise<Result<ListResponse<Quotation>>> {
    return this.call<ListResponse<Quotation>>("list_quotations", pageArgs(query));
  }

  getQuotation(id: string): Promise<Result<Quotation>> {
    return this.call<Quotation>("get_quotation", { p_id: id });
  }

  rateCard(): Promise<Result<RateCard>> {
    return this.call<RateCard>("get_rate_card");
  }

  putQuotation(id: string, input: QuotationInput): Promise<Result<Quotation>> {
    const { idempotencyKey, ...body } = input;
    return this.call<Quotation>("put_quotation", {
      p_id: id,
      p_body: body,
      p_idempotency_key: idempotencyKey,
    });
  }

  listApprovals(query: PageRequest): Promise<Result<ApprovalListResponse>> {
    return this.call<ApprovalListResponse>("list_approvals", pageArgs(query));
  }

  getApproval(id: string): Promise<Result<ApprovalDetail>> {
    return this.call<ApprovalDetail>("get_approval", { p_id: id });
  }

  decideApproval(id: string, input: DecideInput): Promise<Result<ApprovalDecideResponse>> {
    return this.call<ApprovalDecideResponse>("decide_approval", {
      p_approval_id: id,
      p_decision: input.decision,
      p_note: input.note,
      /* 011:2598,2781-2787 — the optimistic-concurrency guard this call must
         not silently defeat. See finding #6,
         docs/reviews/2026-09-13-codex-retrofit-014-017.md. */
      p_expected_diff_hash: input.diffHash,
      p_idempotency_key: input.idempotencyKey,
    });
  }

  bulkDecide(input: BulkDecideInput): Promise<Result<ApprovalBulkDecideResponse>> {
    return this.call<ApprovalBulkDecideResponse>("bulk_decide_approvals", {
      /* 011:3407-3419 (062e5e2) — `p_items jsonb`, not `p_ids uuid[]`: a hash
         per approval cannot travel in an array of ids. Each item is the same
         diffHash the single decide path sends as `p_expected_diff_hash`. */
      p_items: input.items.map((item) => ({
        approvalId: item.approvalId,
        expectedDiffHash: item.diffHash,
      })),
      p_decision: input.decision,
      p_note: input.note ?? null,
      p_idempotency_key: input.idempotencyKey,
    });
  }

  /**
   * §2 `GET /v1/{resourceType}/{id}/audit`.
   *
   * `resourceType` is a plain string because the contract keys the trail by
   * one: `approvals::{ref}`, `proposals::{ref}`. Narrowing it to a union here
   * would be a shape this client invented, and E3 exists to stop exactly that.
   *
   * The approval IS the resource on M02-S02, not the thing it acts on: the
   * trail an approver needs is how this decision reached them.
   */
  audit(resourceType: string, id: string): Promise<Result<ListResponse<AuditEntry>>> {
    return this.call<ListResponse<AuditEntry>>("get_audit", {
      p_resource_type: aggregateTypeOf(resourceType),
      p_id: id,
    });
  }

  /**
   * `POST /v1/actions`, the one endpoint every write in the app goes through.
   *
   * The argument names are `app.perform_action`'s own, passed straight through
   * the `core` wrapper. A rename on either side is a break the compiler cannot
   * see, so the two lists are kept identical on purpose.
   */
  async performAction(input: ActionInput): Promise<Result<ActionResponse>> {
    const result = await this.call<ActionResponse>("perform_action", {
      p_type: input.type,
      p_target_ref: input.targetRef,
      p_payload: input.payload ?? {},
      p_requested_by: input.requestedBy,
      p_confidence: input.confidence ?? null,
      p_reasoning: input.reasoning ?? null,
      p_evidence: input.evidence ?? [],
      p_idempotency_key: input.idempotencyKey,
    });
    return liftPolicyOutcome(result);
  }

  listTemplates(type?: TemplateType): Promise<Result<ListResponse<Template>>> {
    return this.view<Template>(VIEW_READS.templates, type === undefined ? undefined : { type });
  }

  listPolicies(): Promise<Result<ListResponse<Policy>>> {
    return this.view<Policy>(VIEW_READS.policies);
  }

  getPolicy(id: string): Promise<Result<Policy>> {
    return this.call<Policy>("get_policy", { p_id: id });
  }

  getPipelineConfig(object: PipelineObject): Promise<Result<PipelineConfig>> {
    return this.call<PipelineConfig>("get_pipeline_config", { p_object: object });
  }

  listViews(): Promise<Result<ListResponse<SavedView>>> {
    return this.view<SavedView>(VIEW_READS.views);
  }

  listTrainers(): Promise<Result<ListResponse<Trainer>>> {
    return this.view<Trainer>(VIEW_READS.trainers);
  }

  listContacts(): Promise<Result<ListResponse<Contact>>> {
    return this.view<Contact>(VIEW_READS.contacts);
  }

  getContact(id: string): Promise<Result<Contact>> {
    return this.call<Contact>("get_contact", { p_id: id });
  }

  async getContactConsent(id: string): Promise<Result<ListResponse<ChannelConsent>>> {
    const uuid = await this.uuidOf("get_contact", id);
    if (uuid.error !== null) return fail(uuid.error);
    return this.view<ChannelConsent>(VIEW_READS.contactConsent, { contact_id: uuid.data });
  }

  listProgrammes(): Promise<Result<ListResponse<Programme>>> {
    return this.view<Programme>(VIEW_READS.programmes);
  }

  getProgramme(id: string): Promise<Result<Programme>> {
    return this.call<Programme>("get_programme", { p_id: id });
  }

  async getProgrammeDeliveries(id: string): Promise<Result<ListResponse<ProgrammeDelivery>>> {
    const uuid = await this.uuidOf("get_programme", id);
    if (uuid.error !== null) return fail(uuid.error);
    return this.view<ProgrammeDelivery>(VIEW_READS.programmeDeliveries, {
      programme_id: uuid.data,
    });
  }

  listHrdcDeadlines(): Promise<Result<ListResponse<HrdcDeadline>>> {
    return this.view<HrdcDeadline>(VIEW_READS.hrdcDeadlines);
  }

  listCollectionRules(): Promise<Result<ListResponse<CollectionRule>>> {
    return this.view<CollectionRule>(VIEW_READS.collectionRules);
  }

  /* ---- 026 · finance receivables ------------------------------------ */

  listInvoices(query: PageRequest): Promise<Result<ListResponse<Invoice>>> {
    return this.call<ListResponse<Invoice>>("list_invoices", pageArgs(query));
  }

  getInvoice(id: string): Promise<Result<Invoice>> {
    return this.call<Invoice>("get_invoice", { p_id: id });
  }

  getReceivablesAging(): Promise<Result<ReceivablesAging>> {
    return this.call<ReceivablesAging>("get_receivables_aging");
  }

  getCollectionsQueue(query: PageRequest): Promise<Result<CollectionsQueueResponse>> {
    return this.call<CollectionsQueueResponse>("get_collections_queue", {
      p_page: { size: query.page?.size ?? 50 },
    });
  }

  getCollectionDraft(invoiceRef: string): Promise<Result<MessageDraft>> {
    return this.call<MessageDraft>("get_collection_draft", { p_invoice_ref: invoiceRef });
  }

  /** See client.ts: no contract type exists for a commission row (matrix §b2). */
  listCommissions(query: PageRequest): Promise<Result<ListResponse<FixtureCommission>>> {
    return this.call<ListResponse<FixtureCommission>>("list_commissions", {
      p_filter: query.filter ?? [],
      p_sort: query.sort ?? null,
      p_page: { size: query.page?.size ?? 50 },
    });
  }

  listComplianceRules(): Promise<Result<ListResponse<ComplianceRule>>> {
    return this.view<ComplianceRule>(VIEW_READS.complianceRules);
  }

  getComplianceRule(id: string): Promise<Result<ComplianceRule>> {
    return this.call<ComplianceRule>("get_compliance_rule", { p_id: id });
  }

  listRuleChanges(): Promise<Result<ListResponse<RuleChangeSet>>> {
    return this.view<RuleChangeSet>(VIEW_READS.ruleChanges);
  }

  listEvals(): Promise<Result<ListResponse<AgentEval>>> {
    return this.view<AgentEval>(VIEW_READS.evals);
  }

  listKnowledgeSources(): Promise<Result<ListResponse<KnowledgeSource>>> {
    return this.view<KnowledgeSource>(VIEW_READS.knowledgeSources);
  }

  listAiTiers(): Promise<Result<ListResponse<ModelTier>>> {
    return this.view<ModelTier>(VIEW_READS.aiTiers);
  }

  listBudgets(): Promise<Result<ListResponse<Budget>>> {
    return this.view<Budget>(VIEW_READS.aiBudgets);
  }
}

/** The client the seam mounts when `VITE_API_MODE=supabase`. */
export const createRpcClient = (): TrainOsClient => new SupabaseRpcClient();
