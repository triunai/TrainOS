/**
 * Slice 2 — the sales pipeline, from the email that arrives to the price the
 * client accepts.
 *
 * Everything here hangs off slice 1's organisations, contacts, programmes and
 * principals. Nothing here reaches forward: engagements, invoices and the
 * agent runs that produced half of this content belong to slices 3 and 4, so
 * `proposals.run_id`, `quotations.invoice_id` and
 * `quotations.discount_approval_id` are left NULL here and are slice 4's to
 * fill in once `core.runs` and `core.action_requests` exist.
 *
 * Two things in this file are worth reading before the rows.
 *
 * **Quotation headers are derived, not asserted.** `trg_quotation_lines_recalc`
 * overwrites `sell_price_sen` and `direct_cost_sen` from the lines every time a
 * line is written, and the two deferred constraint triggers then check the
 * header against the lines at COMMIT. The fixture world's quotation `lines` are
 * a COST sheet only — trainer fee, venue, materials, travel — with the sell
 * price held separately in `sellPrice`. A quotation with cost lines and no sell
 * line therefore recalculates to a sell price of zero and breaches its own
 * floor. So each quotation gets one non-cost line carrying `sellPrice`
 * verbatim; see `sellLine` below. The header values written are the fixture's
 * own, and the seed is a real test of the reconciliation trigger: if the
 * fixture's `directCost` ever stops equalling the sum of its lines, this file
 * fails to load rather than quietly loading a lie.
 *
 * **The rate card is landed ACTIVE, not PLACEHOLDER.** See `rateCardSql`.
 */

import { createHash } from "node:crypto";

import { AGENT_FOLLOWUP, AGENT_LEAD, AGENT_TNA } from "@trainos/contract";

import * as fx from "../../src/data/index.ts";
import { TENANT_UUID, childKey, uuidFor } from "../lib/ids.ts";
import { refUuid } from "../lib/refs.ts";
import type { Slice } from "../lib/slice.ts";
import { arr, banner, block, j, raw, upsert } from "../lib/sql.ts";
import { actorColumns } from "./01-tenant-and-parties.ts";

/**
 * The instant slice 1 stamps on the tenant and on everything that is
 * configuration rather than a record. Templates and saved views carry no
 * timestamp of their own in the fixture world; they are part of how the tenant
 * was set up, so they share its clock rather than getting one invented.
 */
const TENANT_EPOCH = "2022-01-04T09:00:00+08:00";

/** Configuration is Khairul Anwar's, as it is in slice 1. */
const ADMIN = { id: "u_khairul", name: "Khairul Anwar", kind: "HUMAN" };

/** An agent actor with the display name the agent fixture gives it. */
const agentActor = (agentId: string) => ({
  id: agentId,
  name: fx.agents.find((agent) => agent.id === agentId)?.name ?? agentId,
  kind: "AGENT",
});

const contactByRef = new Map(fx.contacts.map((contact) => [contact.ref, contact]));
const organisationByRef = new Map(fx.organisations.map((org) => [org.ref, org]));
const opportunityByRef = new Map(fx.opportunities.map((opportunity) => [opportunity.ref, opportunity]));

/* ── Shell configuration ────────────────────────────────────────────────── */

/**
 * Templates.
 *
 * The fixture world identifies a template by an opaque id (`tpl_proposal_std_v7`)
 * and never gives it a `ref`, but `core.templates` has a TPL ref format and an
 * `assign_ref` trigger that allocates one on any insert that omits it — which
 * would burn a counter on every re-run and make the seed's second pass visible
 * in `core.ref_formats`. So the refs are allocated here, in fixture order, the
 * same way slice 1 allocates `PIP-0001` for the pipelines it writes.
 *
 * `status` is not a fixture field. Every template here is one `GET /v1/templates`
 * serves to the app and that a proposal, quotation or message actually names, so
 * ACTIVE is the reading; the column's DRAFT default would be false of all of
 * them. The `sections` a PROPOSAL template carries (five titles with an
 * `aiEnabled` flag each) have no table — see the PR's schema-gap list.
 */
const templatesSql = (): string =>
  upsert({
    table: "core.templates",
    conflict: ["tenant_id", "template_type", "label", "version"],
    frozen: ["ref", "created_at"],
    note: "Every document and message template the fixture world names. Nothing is hardcoded in the frontend.",
    rows: fx.templates.map((template, index) => ({
      id: uuidFor(template.id),
      tenant_id: TENANT_UUID,
      ref: `TPL-${String(index + 1).padStart(4, "0")}`,
      template_type: template.type,
      version: template.version,
      label: template.label,
      merge_fields: arr(template.mergeFields),
      status: "ACTIVE",
      // The CHECK admits category and rate only on WHATSAPP, which is exactly
      // where the fixture world sets them.
      category: template.category ?? null,
      rate_per_message_sen: template.ratePerMessage?.amount ?? null,
      approved_provider_ref: null,
      created_at: TENANT_EPOCH,
      ...actorColumns(ADMIN),
    })),
  });

/**
 * Saved views.
 *
 * `owner_id` is NOT NULL and the fixture world's `SavedView` has no owner: these
 * are the pill tabs every user sees, with a `count` that is the same for
 * everyone. Landing them as one person's PRIVATE views would be wrong, so they
 * are TENANT-visible and owned by the admin who set the tenant up, which is the
 * same account slice 1 credits with the pipelines and the ref formats. `count`
 * has no column and should not: it is the result of running `filters`.
 */
const savedViewsSql = (): string =>
  upsert({
    table: "core.saved_views",
    conflict: ["tenant_id", "ref"],
    frozen: ["created_at"],
    note: "The pill tab groups on the lead, enquiry and approval lists.",
    rows: fx.savedViews.map((view, index) => ({
      id: uuidFor(view.id),
      tenant_id: TENANT_UUID,
      ref: `SVW-${String(index + 1).padStart(4, "0")}`,
      object: view.object,
      label: view.label,
      filters: j(view.filters),
      columns: arr(view.columns),
      is_default: view.isDefault,
      owner_id: uuidFor(ADMIN.id),
      visibility: "TENANT",
      deleted_at: null,
      created_at: TENANT_EPOCH,
      ...actorColumns(ADMIN),
    })),
  });

/* ── The rate card ──────────────────────────────────────────────────────── */

const RATE_CARD_KEY = `rate_card:${fx.rateCard.version}`;
const rateCardId = () => uuidFor(RATE_CARD_KEY);
const RATE_CARD_CREATED = `${fx.rateCard.effectiveFrom}T00:00:00+08:00`;

/**
 * The rate card, landed ACTIVE.
 *
 * Its version string is `v0-placeholder`, and `core.rate_card_status` has a
 * PLACEHOLDER member whose whole purpose is to stop anyone quoting from a card
 * Finance has not filled in — `core.quotation_block_placeholder` raises on any
 * APPLIED quotation pointing at one. But the fixture world has three quotations
 * against this card, two of them APPLIED, and the card itself carries real
 * numbers for every band, region, mode and programme type. A card that prices
 * live deals is ACTIVE by the schema's own definition, whatever the version
 * string it was given. The conflict between the two is real and is on the PR's
 * schema-gap list; it is not resolved by disabling the guard, which stays live.
 */
const rateCardSql = (): string =>
  upsert({
    table: "core.rate_cards",
    conflict: ["tenant_id", "version"],
    frozen: ["created_at"],
    note: "One rate card, effective from 2026-01-01 with no end. Every fixture quotation prices from it.",
    rows: [
      {
        id: rateCardId(),
        tenant_id: TENANT_UUID,
        version: fx.rateCard.version,
        currency: fx.rateCard.currency,
        status: "ACTIVE",
        effective_from: fx.rateCard.effectiveFrom,
        effective_to: fx.rateCard.effectiveTo,
        created_at: RATE_CARD_CREATED,
        ...actorColumns({ id: "u_jason", name: "Jason Lee", kind: "HUMAN" }),
      },
    ],
  });

/**
 * Trainer day rates.
 *
 * A band row carries no trainer; an override row names one. The table has no
 * unique index over `(rate_card_id, band, trainer_id)` — a card may hold several
 * overrides in one band — so the conflict target is the id, which is derived
 * from the band and the trainer ref and is therefore stable across regenerations.
 */
const trainerDaysSql = (): string =>
  upsert({
    table: "core.rate_card_trainer_days",
    conflict: ["id"],
    frozen: ["created_at"],
    rows: fx.rateCard.trainerDayRate.flatMap((band) => [
      {
        id: uuidFor(childKey(RATE_CARD_KEY, "trainer_day", band.band)),
        tenant_id: TENANT_UUID,
        rate_card_id: rateCardId(),
        band: band.band,
        trainer_id: null,
        day_rate_sen: band.rate.amount,
        created_at: RATE_CARD_CREATED,
      },
      ...(band.override ?? []).map((override) => ({
        id: uuidFor(childKey(RATE_CARD_KEY, "trainer_day", `${band.band}:${override.trainerRef}`)),
        tenant_id: TENANT_UUID,
        rate_card_id: rateCardId(),
        band: band.band,
        trainer_id: refUuid(override.trainerRef),
        day_rate_sen: override.rate.amount,
        created_at: RATE_CARD_CREATED,
      })),
    ]),
  });

const materialsSql = (): string =>
  upsert({
    table: "core.rate_card_materials",
    conflict: ["tenant_id", "rate_card_id", "programme_type"],
    frozen: ["created_at"],
    rows: fx.rateCard.materialsPerPax.map((line) => ({
      id: uuidFor(childKey(RATE_CARD_KEY, "materials", line.programmeType)),
      tenant_id: TENANT_UUID,
      rate_card_id: rateCardId(),
      programme_type: line.programmeType,
      per_pax_sen: line.rate.amount,
      created_at: RATE_CARD_CREATED,
    })),
  });

const venuesSql = (): string =>
  upsert({
    table: "core.rate_card_venues",
    conflict: ["tenant_id", "rate_card_id", "mode"],
    frozen: ["created_at"],
    note: "EXTERNAL carries no rate in the fixture world — it is priced per booking, and NULL says so.",
    rows: fx.rateCard.venue.map((line) => ({
      id: uuidFor(childKey(RATE_CARD_KEY, "venue", line.mode)),
      tenant_id: TENANT_UUID,
      rate_card_id: rateCardId(),
      mode: line.mode,
      day_rate_sen: line.rate?.amount ?? null,
      created_at: RATE_CARD_CREATED,
    })),
  });

const travelSql = (): string =>
  upsert({
    table: "core.rate_card_travel",
    conflict: ["tenant_id", "rate_card_id", "region"],
    frozen: ["created_at"],
    rows: fx.rateCard.travel.map((line) => ({
      id: uuidFor(childKey(RATE_CARD_KEY, "travel", line.region)),
      tenant_id: TENANT_UUID,
      rate_card_id: rateCardId(),
      region: line.region,
      per_trip_sen: line.rate.amount,
      created_at: RATE_CARD_CREATED,
    })),
  });

const marginFloorsSql = (): string =>
  upsert({
    table: "core.rate_card_margin_floors",
    conflict: ["tenant_id", "rate_card_id", "programme_type"],
    frozen: ["created_at"],
    note: "The 0.35 floor every quotation in the fixture world is measured against.",
    rows: fx.rateCard.marginFloorPct.map((line) => ({
      id: uuidFor(childKey(RATE_CARD_KEY, "margin_floor", line.programmeType)),
      tenant_id: TENANT_UUID,
      rate_card_id: rateCardId(),
      programme_type: line.programmeType,
      floor_pct: line.pct,
      created_at: RATE_CARD_CREATED,
    })),
  });

const discountAuthoritiesSql = (): string =>
  upsert({
    table: "core.rate_card_discount_authorities",
    conflict: ["tenant_id", "rate_card_id", "role"],
    frozen: ["created_at"],
    note: "How far below list each role may go before APV-02 is required.",
    rows: fx.rateCard.discountAuthority.map((line) => ({
      id: uuidFor(childKey(RATE_CARD_KEY, "discount_authority", line.role)),
      tenant_id: TENANT_UUID,
      rate_card_id: rateCardId(),
      role: line.role,
      max_pct: line.maxPct,
      created_at: RATE_CARD_CREATED,
    })),
  });

/*
 * Two rate-card children are deliberately NOT written; both are on the PR's
 * schema-gap list.
 *
 * `core.rate_card_meals` needs a `programme_type` per row and the fixture world
 * has one global `mealsPerPax`; splitting it four ways would invent a breakdown
 * nobody wrote. It would fail anyway: the fixture's RM 26.00 per pax is ABOVE
 * its own RM 25.00 ACM ceiling, and `rcme_within_acm_ceiling` requires the
 * opposite. That is a fixture-vs-HRDC-rule disagreement to settle, not a row to
 * bend into shape.
 *
 * `core.rate_card_commissions.band` is an `int8range` of deal value. The fixture
 * world's commission bands are named — STANDARD and STRATEGIC — and no source
 * states the sen boundaries between them. The rates themselves are not lost:
 * every quotation stores the rate it was priced at, which is where the screens
 * read them from.
 */

/* ── Enquiries ──────────────────────────────────────────────────────────── */

const enquiriesSql = (): string =>
  upsert({
    table: "core.enquiries",
    conflict: ["tenant_id", "ref"],
    frozen: ["ref", "created_at"],
    note: [
      "The 18-row inbox. ENQ-2026-0912 is the leadership email the demo starts on;",
      "-- ENQ-2026-0931 is the 0.41-confidence WhatsApp row the CHECK forbids archiving.",
    ].join("\n"),
    rows: fx.enquiries.map((enquiry) => ({
      id: uuidFor(enquiry.id),
      tenant_id: TENANT_UUID,
      ref: enquiry.ref,
      channel: enquiry.channel,
      status: enquiry.status,
      received_at: enquiry.receivedAt,
      from_name: enquiry.from.name,
      from_email: enquiry.from.email,
      from_phone: enquiry.from.phone,
      subject: enquiry.subject,
      preview: enquiry.preview,
      body: enquiry.body,
      classification_label: enquiry.classification.label,
      classification_confidence: enquiry.classification.provenance.confidence ?? null,
      needs_human_review: enquiry.classification.needsHumanReview ?? false,
      estimated_value_sen: enquiry.estimatedValue?.amount ?? null,
      currency: enquiry.estimatedValue?.currency ?? "MYR",
      matched_organisation_id: enquiry.matchedOrganisation
        ? refUuid(enquiry.matchedOrganisation.ref)
        : null,
      // The fixture world matches an enquiry to an organisation, never to a
      // person, so the contact half of the match is always NULL.
      matched_contact_id: null,
      match_reason: enquiry.matchedOrganisation?.matchReason ?? null,
      assigned_to_user_id: enquiry.assignedTo ? uuidFor(enquiry.assignedTo.id) : null,
      external_message_id: null,
      created_at: enquiry.createdAt,
      ...actorColumns(enquiry.createdBy),
    })),
  });

/**
 * The four extracted fields, one row each.
 *
 * A NULL `value` is kept rather than skipped: the Aurora enquiry's budget is a
 * *confident* null — the model is sure no budget was stated — and a missing row
 * would say "never looked", which is a different fact. The confidence itself has
 * nowhere to go; the table has no provenance columns. See the schema-gap list.
 */
const extractionFieldsSql = (): string =>
  upsert({
    table: "core.enquiry_extraction_fields",
    conflict: ["tenant_id", "enquiry_id", "field_key"],
    frozen: ["created_at"],
    rows: fx.enquiries.flatMap((enquiry) =>
      Object.entries(enquiry.extraction ?? {}).map(([key, field]) => ({
        id: uuidFor(childKey(enquiry.id, "extraction", key)),
        tenant_id: TENANT_UUID,
        enquiry_id: uuidFor(enquiry.id),
        field_key: key,
        value: (field as { value: string | null }).value,
        created_at: enquiry.createdAt,
        ...actorColumns(agentActor(AGENT_LEAD)),
      })),
    ),
  });

/* ── Opportunities ──────────────────────────────────────────────────────── */

/**
 * Why an opportunity was lost.
 *
 * `opportunities_lost_needs_reason` refuses a LOST row without one, and the
 * fixture world's `Opportunity` has no field for it. It does record it, though,
 * one level down: the engagement raised against the deal carries a deal-chain
 * step `{ key: "WON", state: "FAILED", note }`, and that note is the reason.
 * ENG-0197 Sutera says "Opportunity lost on price", which is OPP-0470's reason.
 * Read, not written.
 */
const lostReasonFor = (organisationRef: string): string | null => {
  for (const engagement of fx.engagements) {
    if (engagement.organisationRef !== organisationRef) continue;
    const failed = (engagement.lifecycle ?? []).find(
      (step) => step.key === "WON" && step.state === "FAILED",
    );
    if (failed?.note) return failed.note;
  }
  return null;
};

const opportunitiesSql = (): string =>
  upsert({
    table: "core.opportunities",
    conflict: ["tenant_id", "ref"],
    frozen: ["ref", "created_at"],
    note: "Five deals, one per active organisation. OPP-0512 is WON and is what ENG-0231 was raised from.",
    rows: fx.opportunities.map((opportunity) => ({
      id: uuidFor(opportunity.id),
      tenant_id: TENANT_UUID,
      ref: opportunity.ref,
      organisation_id: refUuid(opportunity.organisationRef),
      // The fixture world names no contact on a deal; the organisation's primary
      // contact is a different fact and is not silently promoted into one.
      primary_contact_id: null,
      source_enquiry_id: opportunity.sourceEnquiryRef
        ? refUuid(opportunity.sourceEnquiryRef)
        : null,
      owner_id: uuidFor(opportunity.owner.id),
      stage: opportunity.stage,
      value_sen: opportunity.value?.amount ?? null,
      currency: opportunity.value?.currency ?? "MYR",
      probability: opportunity.probability ?? null,
      // The last time the stage moved is the last time the record moved: every
      // fixture opportunity's `updatedAt` is its stage change.
      stage_changed_at: opportunity.updatedAt,
      lost_reason: opportunity.stage === "LOST" ? lostReasonFor(opportunity.organisationRef) : null,
      created_at: opportunity.createdAt,
      ...actorColumns(opportunity.createdBy),
    })),
  });

/* ── TNAs ───────────────────────────────────────────────────────────────── */

const tnasSql = (): string =>
  upsert({
    table: "core.tnas",
    conflict: ["tenant_id", "ref"],
    frozen: ["ref", "created_at"],
    note: "TNA-0042's budget is NULL because the client stated none — not zero, and the screen must render the absence.",
    rows: fx.tnas.map((tna) => ({
      id: uuidFor(tna.id),
      tenant_id: TENANT_UUID,
      ref: tna.ref,
      opportunity_id: refUuid(tna.opportunityRef),
      // Which questionnaire a TNA was built from is stated only on the enquiry's
      // proposed convert action, never on the TNA itself. Left unresolved.
      questionnaire_template_id: null,
      status: tna.status,
      // TNA-0054 is SENT and the fixture world does not say when; a completed
      // TNA's `completedAt` is the only send-side timestamp it carries.
      sent_at: null,
      completed_at: tna.completedAt ?? null,
      completed_by_kind: tna.completedBy?.kind ?? null,
      completed_by_id: tna.completedBy?.id ?? null,
      completed_by_name: tna.completedBy?.name ?? null,
      audience_headcount: tna.audience?.headcount ?? null,
      audience_level: tna.audience?.level ?? null,
      audience_sites: arr(tna.audience?.sites),
      audience_language: tna.audience?.language ?? null,
      budget_sen: tna.budget?.amount ?? null,
      currency: tna.budget?.currency ?? "MYR",
      reopened_at: null,
      created_at: tna.createdAt,
      ...actorColumns(tna.createdBy),
    })),
  });

const tnaGapsSql = (): string =>
  upsert({
    table: "core.tna_gaps",
    conflict: ["id"],
    frozen: ["created_at"],
    note: "Gaps keep their questionnaire evidence refs (Q4, Q7…) — the TNA screen cites them beside each gap.",
    rows: fx.tnas.flatMap((tna) =>
      (tna.gaps ?? []).map((gap) => ({
        id: uuidFor(childKey(tna.id, "gap", gap.name)),
        tenant_id: TENANT_UUID,
        tna_id: uuidFor(tna.id),
        name: gap.name,
        description: gap.description ?? null,
        priority: gap.priority,
        evidence_refs: arr(gap.evidenceRefs ?? []),
        created_at: tna.createdAt,
        ...actorColumns(agentActor(gap.provenance?.agentId ?? AGENT_TNA)),
      })),
    ),
  });

const tnaConstraintsSql = (): string =>
  upsert({
    table: "core.tna_constraints",
    conflict: ["tenant_id", "tna_id", "code"],
    frozen: ["created_at"],
    rows: fx.tnas.flatMap((tna) =>
      (tna.constraints ?? []).map((constraint) => ({
        id: uuidFor(childKey(tna.id, "constraint", constraint.code)),
        tenant_id: TENANT_UUID,
        tna_id: uuidFor(tna.id),
        code: constraint.code,
        label: constraint.label,
        severity: constraint.severity ?? null,
        created_at: tna.createdAt,
        ...actorColumns(tna.createdBy),
      })),
    ),
  });

const tnaEvidenceSql = (): string =>
  upsert({
    table: "core.tna_evidence",
    conflict: ["id"],
    frozen: ["created_at"],
    note: "What the analysis read. `source_ref` is the fixture's own citation string, verbatim.",
    rows: fx.tnas.flatMap((tna) =>
      (tna.evidence ?? []).map((source) => ({
        id: uuidFor(childKey(tna.id, "evidence", `${source.type}:${source.ref}`)),
        tenant_id: TENANT_UUID,
        tna_id: uuidFor(tna.id),
        source_type: source.type,
        source_ref: source.ref,
        excerpt: null,
        created_at: tna.createdAt,
        ...actorColumns(agentActor(AGENT_TNA)),
      })),
    ),
  });

/**
 * Programme recommendations.
 *
 * The 0.22 fit on PRG-0044 is kept on purpose — the screen has to be able to
 * show a bad match — and `fit_score`'s CHECK admits it. `trainerAvailability`,
 * which is what makes the 0.91 row actionable, has no column; see the gap list.
 */
const tnaRecommendationsSql = (): string =>
  upsert({
    table: "core.tna_recommendations",
    conflict: ["tenant_id", "tna_id", "programme_id"],
    frozen: ["created_at"],
    rows: Object.entries(fx.tnaRecommendations).flatMap(([tnaRef, response]) =>
      response.data.map((recommendation, index) => ({
        id: uuidFor(childKey(`tna:${tnaRef}`, "recommendation", recommendation.programmeId)),
        tenant_id: TENANT_UUID,
        tna_id: refUuid(tnaRef),
        programme_id: refUuid(recommendation.programmeId),
        fit_score: recommendation.fitScore,
        rationale: recommendation.rationale ?? null,
        price_indication_sen: recommendation.priceIndication?.amount ?? null,
        currency: recommendation.priceIndication?.currency ?? "MYR",
        rank: index + 1,
        scoring_model_version: response.scoringModel.version,
        scoring_weights: j(response.scoringModel.weights),
        accepted_at: null,
        created_at: response.provenance.generatedAt ?? fx.NOW,
        ...actorColumns(agentActor(response.provenance.agentId ?? AGENT_TNA)),
      })),
    ),
  });

/* ── Proposals ──────────────────────────────────────────────────────────── */

/**
 * Proposals.
 *
 * A proposal names its opportunity but not its organisation, and
 * `organisation_id` is NOT NULL; the opportunity is where the organisation
 * comes from, which is also the only place it could come from without
 * disagreeing with itself.
 *
 * `lost_at` on PRO-2026-0166 is the record's own `updatedAt`: a terminal
 * fixture record's last update IS the moment it went terminal. `sent_at` and
 * `first_viewed_at` are left NULL even on the VIEWED proposal, because the
 * fixture world never says when either happened and a plausible date is still
 * an invented one.
 */
const proposalsSql = (): string =>
  upsert({
    table: "core.proposals",
    conflict: ["tenant_id", "ref"],
    frozen: ["ref", "created_at"],
    note: "PRO-2026-0184 is DRAFT internally while its portal page reads ACCEPTED — both states are in the pack, on purpose.",
    rows: fx.proposals.map((proposal) => {
      const opportunity = opportunityByRef.get(proposal.opportunityRef);
      if (!opportunity) throw new Error(`proposal ${proposal.ref} names unknown ${proposal.opportunityRef}`);
      return {
        id: uuidFor(proposal.id),
        tenant_id: TENANT_UUID,
        ref: proposal.ref,
        opportunity_id: refUuid(proposal.opportunityRef),
        organisation_id: refUuid(opportunity.organisationRef),
        template_id: uuidFor(proposal.templateId),
        // Which programme a proposal recommends is prose in section 2, not a
        // field; the TNA recommendation is where that link is modelled.
        programme_id: null,
        // `core.runs` is slice 4's. The proposal fixtures name run_4821.
        run_id: null,
        status: proposal.status,
        value_sen: proposal.value?.amount ?? null,
        currency: proposal.value?.currency ?? "MYR",
        margin_rate: proposal.marginRate ?? null,
        sent_at: null,
        first_viewed_at: null,
        accepted_at: null,
        lost_at: proposal.status === "LOST" ? proposal.updatedAt : null,
        created_at: proposal.createdAt,
        ...actorColumns(proposal.createdBy),
      };
    }),
  });

/**
 * Sections.
 *
 * Section 5 of PRO-2026-0184 carries `needs_review`, which is the flag that
 * blocks a clean send and travels to the approver. The confidence behind it
 * (0.41) lives in the proposal's `warnings` in the fixture world and has no
 * column here; the boolean survives, the number does not. See the gap list.
 */
const proposalSectionsSql = (): string =>
  upsert({
    table: "core.proposal_sections",
    conflict: ["tenant_id", "proposal_id", "n"],
    frozen: ["created_at"],
    rows: fx.proposals.flatMap((proposal) =>
      (proposal.sections ?? []).map((section) => ({
        id: uuidFor(childKey(proposal.id, "section", section.n)),
        tenant_id: TENANT_UUID,
        proposal_id: uuidFor(proposal.id),
        n: section.n,
        title: section.title,
        body: section.body ?? null,
        merge_fields_used: arr(section.mergeFieldsUsed),
        needs_review: section.needsReview ?? false,
        created_at: proposal.createdAt,
        ...actorColumns(section.provenance?.agentId ? agentActor(section.provenance.agentId) : proposal.createdBy),
      })),
    ),
  });

/* ── Quotations ─────────────────────────────────────────────────────────── */

type FixtureQuotation = (typeof fx.quotations)[number];
type FixtureLine = FixtureQuotation["lines"][number];

/**
 * How many people the quotation is priced for.
 *
 * `core.quotations.pax` is NOT NULL and the fixture world's `Quotation` has no
 * pax field — but it has two independent statements of it. The MATERIALS line's
 * `qty` is a per-pax quantity, and `display.perPax` is the sell price divided by
 * the head count and rounded the §18 way. So pax is read off the materials line
 * and then CHECKED against the displayed per-pax figure; if the two ever stop
 * agreeing this throws rather than seeding a head count nobody stated.
 */
const paxFor = (quotation: FixtureQuotation): number => {
  const materials = quotation.lines.find((line) => line.item === "MATERIALS");
  if (!materials) throw new Error(`quotation ${quotation.ref} has no MATERIALS line to read pax from`);
  const pax = materials.qty;
  const perPax = fx.roundHalfUpSen(quotation.sellPrice.amount / pax);
  const stated = quotation.display?.perPax?.amount;
  if (stated !== undefined && stated !== perPax) {
    throw new Error(
      `quotation ${quotation.ref}: ${pax} pax gives ${perPax} sen per pax, fixture displays ${stated}`,
    );
  }
  return pax;
};

/**
 * A cost line's basis and unit.
 *
 * `basis` is NOT NULL and the fixture world states only `unit`, and only on
 * some lines. So basis is read off the unit where there is one and falls back
 * to the column's own PER_UNIT default where there is not. Nothing is inferred
 * from the item name: MATERIALS priced per head and TRAVEL priced per trip look
 * identical in the fixture (`qty` and a rate, no unit), and guessing which is
 * which would put a claim in the database that the fixture world never made.
 */
const basisFor = (line: FixtureLine): string =>
  line.unit === "DAY" ? "PER_DAY" : line.unit === "PAX" ? "PER_PAX" : "PER_UNIT";

/**
 * The sell line.
 *
 * `core.quotation_recalc` derives the header from the lines: sell price is the
 * sum of the non-cost lines, direct cost the sum of the cost ones. The fixture
 * world's `lines` are the cost sheet, and `sellPrice` sits outside them, so
 * without this line every quotation would recalculate to a sell price of zero
 * and then fail its own floor assertion. The amount is `sellPrice` verbatim; it
 * is one PACKAGE line because a quoted price is one number, not a rate times a
 * quantity.
 */
const sellLine = (quotation: FixtureQuotation, n: number) => ({
  id: uuidFor(childKey(quotation.id, "line", n)),
  tenant_id: TENANT_UUID,
  quotation_id: uuidFor(quotation.id),
  n,
  item: "SELL_PRICE",
  detail: "Quoted price to the client",
  basis: "PACKAGE",
  qty: 1,
  unit: null,
  unit_price_sen: quotation.sellPrice.amount,
  currency: quotation.sellPrice.currency,
  is_cost: false,
  created_at: quotation.createdAt,
});

/**
 * SST on a quotation, resolved rather than typed.
 *
 * 017 seeds two national tax policies — `SST-G-TRAINING-8` at 800 bps, the
 * default, and `SST-EDU-ACT-EXEMPT` — and both carry `gen_random_uuid()` ids,
 * so there is no literal to write: the id differs on every database the
 * migration is applied to. `app.resolve_tax_policy()` is the resolution 017
 * ships (tenant override first, then national; ACTIVE before PROPOSED; bounded
 * by the policy's validity and registry windows), and it is what fix-014's
 * table-level trigger will call for a bare insert.
 *
 * Resolving here rather than writing 0.08 is what keeps the two in step: an
 * explicit value has to equal what that trigger would have produced, and the
 * only way to guarantee that without a second implementation is to call the
 * same function. The fixture world states no SST treatment of its own, so the
 * schema's default is the seed's answer until somebody rules otherwise — see
 * the PR's open ruling, and T7d, which asserts the stored rate against the
 * resolver rather than against a number.
 *
 * `CORPORATE_TRAINING` is the category: Akademi Perdana's programmes are
 * corporate training, and the Education Act exemption is a different category
 * that would need the company's status ruled on before it could be claimed.
 */
const sstColumn = (onDate: string, column: "policy_id" | "rate") =>
  raw(
    `(SELECT ${column} FROM app.resolve_tax_policy(` +
      `'${TENANT_UUID}'::uuid, 'CORPORATE_TRAINING', DATE '${onDate}'))`,
  );

/**
 * The reason is resolved too, and that is what makes the seed fail rather than
 * lie if the ruling changes.
 *
 * Writing `STANDARD_RATED` as a literal beside a resolved rate is the shape of
 * bug worth avoiding: flip akademi-perdana to an exempt policy and the seed
 * would happily store a standard-rated supply at 0%, which no constraint
 * forbids and no screen would question. Derived, an exempt policy produces
 * `TRAINING_EXEMPT` with no `sst_exempt_reason`, and
 * `quotations_exempt_needs_reason` refuses the insert by name. An exemption
 * needs a stated reason; a reason is a ruling, and a seed has no business
 * inventing one.
 */
const sstReason = (onDate: string) =>
  raw(
    `(SELECT CASE WHEN exempt THEN 'TRAINING_EXEMPT' ELSE 'STANDARD_RATED' END` +
      ` FROM app.resolve_tax_policy(` +
      `'${TENANT_UUID}'::uuid, 'CORPORATE_TRAINING', DATE '${onDate}'))`,
  );

const quotationsSql = (): string =>
  upsert({
    table: "core.quotations",
    conflict: ["tenant_id", "ref"],
    frozen: ["ref", "created_at"],
    note: [
      "Three costings. QUO-2026-0184's margin floor binds; QUO-2026-0179's catalogue floor does.",
      "-- sell_price_sen and direct_cost_sen are written as the fixture states them and are then",
      "-- recomputed from the lines by trg_quotation_lines_recalc; the deferred reconciliation",
      "-- trigger fails this file at COMMIT if the two ever disagree.",
      "--",
      "-- SST is resolved through app.resolve_tax_policy() rather than typed, so the",
      "-- stored rate is by construction what fix-014's resolver trigger would produce.",
      "-- The fixture world states no SST treatment; this is the schema's default",
      "-- (SST-G-TRAINING-8, 800 bps) standing in until the user rules. See the PR.",
    ].join("\n"),
    rows: fx.quotations.map((quotation) => ({
      id: uuidFor(quotation.id),
      tenant_id: TENANT_UUID,
      ref: quotation.ref,
      proposal_id: refUuid(quotation.proposalRef),
      supersedes_quotation_id: null,
      version: 1,
      rate_card_id: rateCardId(),
      pax: paxFor(quotation),
      sell_price_sen: quotation.sellPrice.amount,
      direct_cost_sen: quotation.directCost.amount,
      currency: quotation.sellPrice.currency,
      // The catalogue floor. `floor_price_sen` and `binding_floor_basis` are
      // generated from this and the margin floor, so the fixture's own
      // `floorPrice` is not written — it is checked by being recomputed.
      programme_floor_price_sen: quotation.absoluteFloorPrice.amount,
      floor_margin_rate: quotation.floorMarginRate,
      commission_rate: quotation.commissionRate ?? null,
      commission_payable_on: quotation.commissionPayableOn ?? null,
      // A below-floor quotation would need an APV-02 action behind it. None of
      // these is below its floor, and `core.action_requests` is slice 4's.
      discount_approval_id: null,
      invoice_id: null,
      status: quotation.status,
      // Resolved from 017's tax policy registry as at the quotation's own date.
      sst_policy_id: sstColumn(quotation.createdAt.slice(0, 10), "policy_id"),
      sst_rate: sstColumn(quotation.createdAt.slice(0, 10), "rate"),
      sst_reason: sstReason(quotation.createdAt.slice(0, 10)),
      sst_exempt_reason: null,
      created_at: quotation.createdAt,
      ...actorColumns(quotation.createdBy),
    })),
  });

const quotationLinesSql = (): string =>
  upsert({
    table: "core.quotation_lines",
    conflict: ["tenant_id", "quotation_id", "n"],
    frozen: ["created_at"],
    note: "`total_sen` is generated — app.round_half_up_sen(unit_price × qty) — so the §18 rounding rule is the database's, not the fixture's.",
    rows: fx.quotations.flatMap((quotation) => {
      const costLines = quotation.lines.map((line, index) => {
        const unitPrice = line.rate?.amount ?? 0;
        const computed = fx.roundHalfUpSen(unitPrice * line.qty);
        if (computed !== line.total.amount) {
          throw new Error(
            `quotation ${quotation.ref} line ${line.item}: ${unitPrice} × ${line.qty} = ${computed}, fixture says ${line.total.amount}`,
          );
        }
        return {
          id: uuidFor(childKey(quotation.id, "line", index + 1)),
          tenant_id: TENANT_UUID,
          quotation_id: uuidFor(quotation.id),
          n: index + 1,
          item: line.item,
          detail: line.detail ?? null,
          basis: basisFor(line),
          qty: line.qty,
          unit: line.unit ?? null,
          unit_price_sen: unitPrice,
          currency: line.total.currency,
          is_cost: true,
          created_at: quotation.createdAt,
        };
      });
      return [...costLines, sellLine(quotation, costLines.length + 1)];
    }),
  });

/* ── The client portal ──────────────────────────────────────────────────── */

/** `core.public_share_tokens` stores a hash; the fixture world stores the token. */
const tokenHash = (token: string) =>
  raw(`'\\x${createHash("sha256").update(token, "utf8").digest("hex")}'::bytea`);

const addDays = (iso: string, days: number): string =>
  new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();

const shareTokensSql = (): string =>
  upsert({
    table: "core.public_share_tokens",
    conflict: ["id"],
    frozen: ["created_at"],
    note: [
      "The two links a client opens. `issued_at` is the portal page's own `issuedAt`;",
      "-- `expires_at` is the column's 30-day default written out, so the emitted SQL is a",
      "-- literal rather than a `now()` that differs on every machine that loads it.",
    ].join("\n"),
    rows: Object.entries(fx.portalProposals).map(([token, page]) => {
      const issuedAt = `${page.issuedAt}T00:00:00+08:00`;
      return {
        id: uuidFor(`share_token:${token}`),
        tenant_id: TENANT_UUID,
        target_kind: "PROPOSAL",
        proposal_id: refUuid(page.ref),
        tna_id: null,
        token_hash: tokenHash(token),
        issued_at: issuedAt,
        expires_at: addDays(issuedAt, 30),
        revoked_at: null,
        // The fixture world has no portal access log — only the acceptance,
        // which is recorded on its own row.
        last_accessed_at: null,
        access_count: 0,
        created_at: issuedAt,
        ...actorColumns({ id: "u_amirah", name: "Amirah Yusof", kind: "HUMAN" }),
      };
    }),
  });

/**
 * Acceptance.
 *
 * One row: Nurul Hassan accepted PRO-2026-0184 on 15 September. The signature
 * the fixture world cites (`sig_c19a`) is a ref into `core.signatures`, which no
 * slice writes, so `signature_id` is NULL and the acceptance is recorded without
 * the artefact behind it. `engagement_id` is slice 3's.
 */
const portalAcceptancesSql = (): string =>
  upsert({
    table: "core.portal_acceptances",
    conflict: ["tenant_id", "proposal_id"],
    frozen: ["created_at"],
    rows: Object.entries(fx.portalProposals).flatMap(([token, page]) => {
      if (!page.acceptance) return [];
      return [
        {
          id: uuidFor(childKey(`share_token:${token}`, "acceptance", page.ref)),
          tenant_id: TENANT_UUID,
          proposal_id: refUuid(page.ref),
          accepted_by_name: page.acceptance.acceptedBy,
          accepted_by_role: page.acceptance.role ?? null,
          accepted_at: page.acceptance.acceptedAt,
          signature_id: null,
          engagement_id: null,
          share_token_id: uuidFor(`share_token:${token}`),
          created_at: page.acceptance.acceptedAt,
          created_by_kind: "CLIENT",
          created_by_id: "portal",
          created_by_name: page.acceptance.acceptedBy,
        },
      ];
    }),
  });

/**
 * Portal comments.
 *
 * The thread is two messages, one from each side, and `author_kind` is what
 * tells them apart. `contact_id` stays NULL: the fixture world gives the
 * commenter a name and not a ref, and matching a person by display name is how
 * a seed ends up attributing a comment to the wrong contact.
 */
const portalCommentsSql = (): string =>
  upsert({
    table: "core.portal_comments",
    conflict: ["id"],
    frozen: ["created_at"],
    rows: Object.values(fx.portalProposals).flatMap((page) =>
      (page.comments ?? []).map((comment, index) => ({
        id: uuidFor(childKey(`proposal:${page.ref}`, "comment", index)),
        tenant_id: TENANT_UUID,
        proposal_id: refUuid(page.ref),
        contact_id: null,
        author_name: comment.author,
        author_kind: comment.authorKind,
        body: comment.body,
        posted_at: comment.at,
        created_at: comment.at,
        created_by_kind: comment.authorKind,
        created_by_id: "portal",
        created_by_name: comment.author,
      })),
    ),
  });

/* ── The follow-up queue ────────────────────────────────────────────────── */

/**
 * Follow-ups.
 *
 * `owner_id` is NOT NULL and a `FollowUp` has no owner in the fixture world. It
 * has an organisation, and an organisation has an owner — the account owner
 * chases their own accounts — so the owner is read from there rather than
 * assigned. `proposal_id` and `invoice_id` stay NULL: FUP-0311's reason names
 * PRO-2026-0184 in prose, but prose is not a foreign key, and the other eight
 * rows name nothing at all.
 */
const followUpsSql = (): string =>
  upsert({
    table: "core.follow_ups",
    conflict: ["tenant_id", "ref"],
    frozen: ["ref", "created_at"],
    note: "Nine rows. FUP-0304 and FUP-0307 are the two OVERDUE ones the queue renders in danger.",
    rows: fx.followUps.map((followUp) => {
      const organisation = organisationByRef.get(followUp.organisation.ref);
      if (!organisation) throw new Error(`follow-up ${followUp.ref} names unknown ${followUp.organisation.ref}`);
      return {
        id: uuidFor(followUp.id),
        tenant_id: TENANT_UUID,
        ref: followUp.ref,
        organisation_id: refUuid(followUp.organisation.ref),
        contact_id: refUuid(followUp.contact.ref),
        proposal_id: null,
        invoice_id: null,
        reason: followUp.reason,
        due_date: followUp.dueDate,
        status: followUp.status,
        autonomy: followUp.autonomy,
        owner_id: uuidFor(organisation.owner.id),
        // The queue is the follow-up agent's output; its autonomy level is on
        // the row above.
        created_at: fx.NOW,
        ...actorColumns(agentActor(AGENT_FOLLOWUP)),
      };
    }),
  });

/**
 * The drafted messages.
 *
 * Every one is DRAFT — nothing in the fixture world has been sent — so
 * `consent_id` stays NULL; the CHECK only demands one on a SENT row, and
 * pinning a consent record to a message that was never sent would claim a
 * decision nobody made. `message_rate_id` is NULL for the same reason the rate
 * is copied onto the row: `core.message_rates` is not seeded by any slice, and
 * the BSP rate the draft was costed at is a fact about the draft.
 *
 * The WhatsApp draft for Ravi Subramaniam (FUP-0314) is NOT written:
 * `to_address` is NOT NULL and CON-0241 has no phone number in the fixture
 * world. That draft exists precisely to show the PDPA block, and the block is
 * still visible — the contact's refusal is recorded in `core.contact_consents`
 * by slice 1. See the PR's gap list.
 */
const outboundMessagesSql = (): string => {
  const followUpByRef = new Map(fx.followUps.map((followUp) => [followUp.ref, followUp]));
  const rows: Record<string, unknown>[] = [];

  for (const [key, draft] of Object.entries(fx.followUpDrafts)) {
    const [followUpRef, channel] = key.split("::");
    const followUp = followUpByRef.get(followUpRef!);
    if (!followUp) throw new Error(`draft ${key} names unknown follow-up ${followUpRef}`);
    const contact = contactByRef.get(followUp.contact.ref);
    if (!contact) throw new Error(`draft ${key} names unknown contact ${followUp.contact.ref}`);

    const toAddress = channel === "EMAIL" ? contact.email : contact.phone;
    if (!toAddress) continue;

    rows.push({
      id: uuidFor(`outbound:${key}`),
      tenant_id: TENANT_UUID,
      ref: `MSG-2026-${String(rows.length + 1).padStart(4, "0")}`,
      purpose: "FOLLOWUP",
      channel: draft.channel,
      template_id: uuidFor(draft.templateId),
      category: draft.category ?? null,
      contact_id: uuidFor(contact.id),
      to_address: toAddress,
      follow_up_id: uuidFor(followUp.id),
      invoice_id: null,
      engagement_id: null,
      body: draft.body,
      status: "DRAFT",
      sent_at: null,
      // Both money fields are optional on a draft: a failed BSP rate lookup is a
      // missing value, not a zero, and the schema's columns are nullable for it.
      rate_per_message_sen: draft.ratePerMessage?.amount ?? null,
      rate_per_message_exact: draft.ratePerMessageExact ?? null,
      estimated_cost_sen: draft.estimatedCost?.amount ?? null,
      actual_cost_sen: null,
      currency: draft.estimatedCost?.currency ?? "MYR",
      message_rate_id: null,
      consent_id: null,
      provider_message_id: null,
      created_at: draft.provenance?.generatedAt ?? fx.NOW,
      ...actorColumns(agentActor(draft.provenance?.agentId ?? AGENT_FOLLOWUP)),
    });
  }

  return upsert({
    table: "core.outbound_messages",
    conflict: ["tenant_id", "ref"],
    frozen: ["ref", "created_at"],
    note: "Drafted follow-ups, costed at the BSP rate the draft quotes. None has been sent.",
    rows,
  });
};

export const slice02: Slice = {
  file: "fixture_world_02_sales_and_money.sql",
  title: "Enquiries, TNAs, proposals, quotations and the client portal",
  tables: [
    "core.templates",
    "core.saved_views",
    "core.rate_cards",
    "core.rate_card_trainer_days",
    "core.rate_card_materials",
    "core.rate_card_venues",
    "core.rate_card_travel",
    "core.rate_card_margin_floors",
    "core.rate_card_discount_authorities",
    "core.enquiries",
    "core.enquiry_extraction_fields",
    "core.opportunities",
    "core.tnas",
    "core.tna_gaps",
    "core.tna_constraints",
    "core.tna_evidence",
    "core.tna_recommendations",
    "core.proposals",
    "core.proposal_sections",
    "core.quotations",
    "core.quotation_lines",
    "core.public_share_tokens",
    "core.portal_acceptances",
    "core.portal_comments",
    "core.follow_ups",
    "core.outbound_messages",
  ],
  /**
   * Five state gates and one freeze guard.
   *
   * The gates admit only the initial status on INSERT — OPEN, NEW, DRAFT — and
   * every later status needs an `EXECUTING`/`EXECUTED` action request naming
   * that exact row. A world whose enquiries are CONVERTED, whose opportunities
   * are WON and whose quotations are APPLIED cannot come through that door.
   *
   * `trg_quotations_freeze_applied` is here for a subtler reason: it refuses any
   * UPDATE to an APPLIED quotation, and `trg_quotation_lines_recalc` UPDATES the
   * header every time a line is written. Writing the lines of the two APPLIED
   * quotations trips it. The recalculation trigger itself stays live — the
   * headers here genuinely reconcile against their lines, and the two deferred
   * constraint triggers check that at COMMIT.
   */
  suspendTriggers: [
    "core.enquiries:enquiries_state_gate",
    "core.opportunities:opportunities_state_gate",
    "core.tnas:tnas_state_gate",
    "core.proposals:proposals_state_gate",
    "core.quotations:quotations_state_gate",
    "core.quotations:trg_quotations_freeze_applied",
  ],
  emit: () =>
    block(
      banner("Templates and saved views"),
      templatesSql(),
      savedViewsSql(),
      banner("Rate card"),
      rateCardSql(),
      trainerDaysSql(),
      materialsSql(),
      venuesSql(),
      travelSql(),
      marginFloorsSql(),
      discountAuthoritiesSql(),
      banner("Enquiries"),
      enquiriesSql(),
      extractionFieldsSql(),
      banner("Opportunities"),
      opportunitiesSql(),
      banner("Needs analysis"),
      tnasSql(),
      tnaGapsSql(),
      tnaConstraintsSql(),
      tnaEvidenceSql(),
      tnaRecommendationsSql(),
      banner("Proposals"),
      proposalsSql(),
      proposalSectionsSql(),
      banner("Quotations"),
      quotationsSql(),
      quotationLinesSql(),
      banner("Client portal"),
      shareTokensSql(),
      portalAcceptancesSql(),
      portalCommentsSql(),
      banner("Follow-up queue"),
      followUpsSql(),
      outboundMessagesSql(),
    ),
};
