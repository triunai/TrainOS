/**
 * Slice 1 — the tenant, its people, its reference formats and pipelines, the
 * catalogue, and the parties the rest of the world hangs off.
 *
 * Nothing here depends on a later slice. Everything in a later slice depends on
 * something here.
 */

import * as fx from "../../src/data/index.ts";
import { TENANT_UUID, childKey, uuidFor } from "../lib/ids.ts";
import { refUuid } from "../lib/refs.ts";
import type { Slice } from "../lib/slice.ts";
import { arr, banner, block, j, upsert } from "../lib/sql.ts";

/** The tenant slug. Every anchor id and every `ref` in the seed belongs to it. */
export const TENANT_SLUG = "akademi-perdana";

/** `Farah Aziz` → `farah.aziz@akademiperdana.my`, the pattern tenant.ts names. */
const staffEmail = (name: string): string =>
  `${name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/\s+/)
    .join(".")}@akademiperdana.my`;

/** `createdBy` → the three `created_by_*` columns every core table carries. */
export const actorColumns = (
  actor?: { id?: string; name?: string | null; kind?: string } | null,
) => ({
  created_by_kind: actor?.kind ?? "SYSTEM",
  created_by_id: actor?.id ?? "system",
  created_by_name: actor?.name ?? null,
});

/**
 * The reference prefixes `core.assign_ref` triggers hand to `core.next_ref`.
 *
 * A prefix with no `core.ref_formats` row raises `foreign_key_violation` the
 * first time anything inserts without an explicit `ref`, so every prefix the
 * schema has a trigger for gets a row here even where the fixture world has no
 * example of it. `dated` and `width` are read off the refs the fixture world
 * actually uses — `ENQ-2026-0912` is dated and four wide, `ORG-0114` is neither.
 */
const REF_FORMATS: readonly [prefix: string, entity: string, dated: boolean, width: number][] = [
  ["ACT", "action_request", true, 4],
  ["AGT", "agent", false, 3],
  ["APV", "approval_request", true, 4],
  ["ATT", "attachment", false, 4],
  ["COL", "collections_case", false, 4],
  ["CON", "contact", false, 4],
  ["CRN", "credit_note", true, 4],
  ["CRT", "certificate", true, 4],
  ["DRF", "suggested_draft", false, 4],
  ["ENG", "engagement", false, 4],
  ["ENQ", "enquiry", true, 4],
  ["FUP", "follow_up", false, 4],
  ["HPK", "hrdc_packet", true, 4],
  ["INV", "invoice", true, 4],
  ["MSG", "outbound_message", true, 4],
  ["OPP", "opportunity", false, 4],
  ["ORG", "organisation", false, 4],
  ["PAR", "participant", false, 4],
  ["PAY", "payment", true, 4],
  ["PIP", "pipeline", false, 4],
  ["PRG", "programme", false, 4],
  ["PRO", "proposal", true, 4],
  ["QUO", "quotation", true, 4],
  ["RUN", "run", true, 4],
  ["SES", "session", false, 4],
  ["SIG", "signature", false, 4],
  ["SRC", "knowledge_source", false, 4],
  ["SVW", "saved_view", false, 4],
  ["TBK", "trainer_booking", false, 4],
  ["TNA", "tna", false, 4],
  ["TPL", "template", false, 4],
  ["TRN", "trainer", false, 4],
];

const tenantsSql = (): string =>
  upsert({
    table: "public.tenants",
    conflict: ["id"],
    frozen: ["created_at"],
    note: "Akademi Perdana Sdn Bhd — the single tenant the whole fixture world belongs to.",
    rows: [
      {
        id: TENANT_UUID,
        slug: TENANT_SLUG,
        name: fx.tenant.name,
        status: "ACTIVE",
        timezone: fx.tenant.timezone,
        locale: fx.tenant.locale,
        created_at: "2022-01-04T09:00:00+08:00",
      },
    ],
  });

const authUsersSql = (): string =>
  upsert({
    table: "auth.users",
    conflict: ["id"],
    frozen: ["created_at"],
    note: [
      "The seven principals, as auth records.",
      "-- Every tenancy table in `public` has a composite FK into auth.users, so a seed",
      "-- that skips this cannot write a membership, an organisation owner, or a trainer.",
      "-- On a hosted project these rows would come from the auth admin API instead; the",
      "-- columns written here are the ones GoTrue itself fills for a confirmed user.",
    ].join("\n"),
    rows: fx.users.map((user) => ({
      id: uuidFor(user.id),
      aud: "authenticated",
      role: "authenticated",
      email: staffEmail(user.name),
      raw_app_meta_data: j({ provider: "email", providers: ["email"] }),
      raw_user_meta_data: j({ full_name: user.name }),
      created_at: "2022-01-04T09:00:00+08:00",
    })),
  });

/**
 * One auth principal per agent.
 *
 * `core.agents.principal_user_id` is NOT NULL with `UNIQUE (tenant_id,
 * principal_user_id)`: every agent acts as its own principal and no two agents
 * may share one. Seven humans cannot cover eight agents even in principle, and
 * the fixture world names no service account, so the principal is derived from
 * the agent it belongs to — the same move this slice makes for the single team
 * that `MY_TEAM` needs somewhere to point at. No fact is invented: the id comes
 * from the agent's id and the name from the agent's name.
 *
 * They are minted here rather than in slice 4 because `auth.users` has exactly
 * one owner in this pack, and because the wipe can only delete what one place
 * knows it wrote.
 *
 * What is deliberately NOT written is the matching `actor_kind = 'AGENT'`
 * membership. The schema plainly anticipates them — `public.memberships` CHECKs
 * `(actor_kind = 'AGENT') = (agent_id IS NOT NULL)` and forces `role = 'AGENT'`
 * — but the fixture world states no data scope for an agent, and nothing in the
 * seed has a foreign key into one. See the PR's deliberate-omissions list.
 */
export const agentPrincipalKey = (agentId: string): string => `agent_principal:${agentId}`;

const agentPrincipalsSql = (): string =>
  upsert({
    table: "auth.users",
    conflict: ["id"],
    frozen: ["created_at"],
    note: [
      "One auth principal per agent, for core.agents.principal_user_id.",
      "-- Derived from the agent, because the fixture world names no service account.",
    ].join("\n"),
    rows: fx.agents.map((agent) => ({
      id: uuidFor(agentPrincipalKey(agent.id)),
      aud: "authenticated",
      role: "authenticated",
      email: `${agent.id}@agents.akademiperdana.my`,
      raw_app_meta_data: j({ provider: "agent", providers: ["agent"], agentId: agent.id }),
      raw_user_meta_data: j({ full_name: agent.name }),
      created_at: "2022-01-04T09:00:00+08:00",
    })),
  });

const userProfilesSql = (): string =>
  upsert({
    table: "public.user_profiles",
    conflict: ["tenant_id", "user_id"],
    frozen: ["created_at"],
    rows: fx.users.map((user) => ({
      tenant_id: TENANT_UUID,
      user_id: uuidFor(user.id),
      display_name: user.name,
      email: staffEmail(user.name),
      locale: user.locale,
      timezone: user.timezone,
      theme: user.theme,
      avatar_url: null,
      created_at: "2022-01-04T09:00:00+08:00",
    })),
  });

/** One team. The fixture world's `MY_TEAM` scope needs somewhere to point. */
const TEAM_KEY = "team_delivery";

const teamsSql = (): string =>
  upsert({
    table: "public.teams",
    conflict: ["id"],
    frozen: ["created_at"],
    note: "One team: `dataScope.teams = MY_TEAM` has to resolve to a row.",
    rows: [
      {
        id: uuidFor(TEAM_KEY),
        tenant_id: TENANT_UUID,
        name: "Akademi Perdana",
        manager_user_id: uuidFor("u_kelvin"),
        created_at: "2022-01-04T09:00:00+08:00",
      },
    ],
  });

const trainersSql = (): string =>
  upsert({
    table: "core.trainers",
    conflict: ["id"],
    frozen: ["ref", "created_at"],
    note: "Four trainers. `TRN-0007` is Farah Aziz, who also holds a TRAINER membership.",
    rows: fx.trainers.map((trainer) => ({
      id: uuidFor(trainer.id),
      tenant_id: TENANT_UUID,
      ref: trainer.ref,
      name: trainer.name,
      email: trainer.email,
      phone: null,
      user_id: trainer.ref === "TRN-0007" ? uuidFor("t_farah") : null,
      band: trainer.bands,
      day_rate_override_sen: null,
      ttt_certified: trainer.tttCertified,
      ttt_ref: trainer.tttRef,
      ttt_valid_to: trainer.tttValidTo,
      hrd_tdf: trainer.hrdTdf,
      rating: trainer.rating,
      status: "ACTIVE",
      created_at: "2022-01-04T09:00:00+08:00",
      ...actorColumns({ id: "u_khairul", name: "Khairul Anwar", kind: "HUMAN" }),
    })),
  });

const membershipsSql = (): string =>
  upsert({
    table: "public.memberships",
    conflict: ["tenant_id", "user_id"],
    frozen: ["created_at"],
    note: "Roles and data scopes, straight off `users[].role` and `users[].dataScope`.",
    rows: fx.users.map((user) => ({
      tenant_id: TENANT_UUID,
      user_id: uuidFor(user.id),
      role: user.role,
      actor_kind: "HUMAN",
      agent_id: null,
      primary_team_id: uuidFor(TEAM_KEY),
      // A TRAINER membership without a trainer row fails a CHECK, by design.
      trainer_id: user.role === "TRAINER" ? uuidFor("trn_farah") : null,
      client_scope: user.dataScope.clients,
      team_scope: user.dataScope.teams,
      mfa_required: user.role === "MD" || user.role === "ADMIN",
      status: "ACTIVE",
      is_default: true,
      created_at: "2022-01-04T09:00:00+08:00",
    })),
  });

const teamMembersSql = (): string =>
  upsert({
    table: "public.team_members",
    conflict: ["team_id", "user_id"],
    rows: fx.users.map((user) => ({
      tenant_id: TENANT_UUID,
      team_id: uuidFor(TEAM_KEY),
      user_id: uuidFor(user.id),
    })),
  });

const refFormatsSql = (): string =>
  upsert({
    table: "core.ref_formats",
    conflict: ["tenant_id", "prefix"],
    frozen: ["created_at"],
    note: "Every prefix `core.assign_ref` can be handed. A missing row raises on the first insert without an explicit ref.",
    rows: REF_FORMATS.map(([prefix, entity, dated, width]) => ({
      id: uuidFor(`ref_format:${prefix}`),
      tenant_id: TENANT_UUID,
      prefix,
      entity,
      dated,
      width,
      gapless: false,
      created_at: "2022-01-04T09:00:00+08:00",
    })),
  });

/**
 * Pipelines.
 *
 * `core.pipelines.object` admits ENGAGEMENT, OPPORTUNITY and PACKET. The
 * fixture world also configures a `DEAL_CHAIN` pipeline — the six-key strip the
 * relations panel renders — which the CHECK has no member for, so it is not
 * seeded. See the PR's schema-gap list.
 */
const STORABLE_PIPELINE_OBJECTS = new Set(["ENGAGEMENT", "OPPORTUNITY", "PACKET"]);

const storablePipelines = () =>
  fx.pipelines.filter((pipeline) => STORABLE_PIPELINE_OBJECTS.has(pipeline.object));

const pipelinesSql = (): string =>
  upsert({
    table: "core.pipelines",
    conflict: ["id"],
    frozen: ["ref", "created_at"],
    note: "Stage names and order are configuration, never hardcoded — this is the row the UI renders from.",
    rows: storablePipelines().map((pipeline, index) => ({
      id: uuidFor(`pipeline:${pipeline.object}`),
      tenant_id: TENANT_UUID,
      ref: `PIP-${String(index + 1).padStart(4, "0")}`,
      object: pipeline.object,
      name: `${pipeline.object[0]}${pipeline.object.slice(1).toLowerCase().replace(/_/g, " ")} lifecycle`,
      is_default: true,
      version: 1,
      status: "ACTIVE",
      created_at: "2022-01-04T09:00:00+08:00",
      ...actorColumns({ id: "u_khairul", name: "Khairul Anwar", kind: "HUMAN" }),
    })),
  });

const pipelineStepsSql = (): string =>
  upsert({
    table: "core.pipeline_steps",
    conflict: ["tenant_id", "pipeline_id", "step_key"],
    frozen: ["created_at"],
    note: "`outcome` (WON/LOST on the two terminal opportunity stages) has no column yet — see the PR's schema-gap list.",
    rows: storablePipelines().flatMap((pipeline) =>
      pipeline.stages.map((stage) => ({
        id: uuidFor(childKey(`pipeline:${pipeline.object}`, "step", stage.key)),
        tenant_id: TENANT_UUID,
        pipeline_id: uuidFor(`pipeline:${pipeline.object}`),
        step_key: stage.key,
        label: stage.label,
        position: stage.order,
        terminal: stage.terminal ?? false,
        blocking_check_keys: arr([]),
        created_at: "2022-01-04T09:00:00+08:00",
      })),
    ),
  });

const programmesSql = (): string =>
  upsert({
    table: "core.programmes",
    conflict: ["id"],
    frozen: ["ref", "created_at"],
    note: "Five programmes. PRG-0022 Safety Leadership Essentials is the one whose delivered margin sits below its floor.",
    rows: fx.programmes.map((programme) => ({
      id: uuidFor(programme.id),
      tenant_id: TENANT_UUID,
      ref: programme.ref,
      name: programme.name,
      category: programme.category,
      days: programme.days,
      version: programme.version,
      status: programme.status,
      hrdc_scheme: programme.hrdcScheme ?? null,
      hrdc_claimable: programme.hrdcClaimable,
      list_price_sen: programme.listPrice.amount,
      list_price_pax: programme.listPricePax,
      floor_price_sen: programme.floorPrice.amount,
      floor_margin_rate: programme.floorMarginRate,
      currency: programme.listPrice.currency,
      outcomes: arr(programme.outcomes),
      deliveries_count: programme.stats?.deliveries ?? 0,
      average_evaluation: programme.stats?.averageEvaluation ?? null,
      archived_at: null,
      created_at: programme.createdAt,
      ...actorColumns(programme.createdBy),
    })),
  });

const pricingTiersSql = (): string =>
  upsert({
    table: "core.programme_pricing_tiers",
    conflict: ["tenant_id", "programme_id", "max_pax"],
    frozen: ["created_at"],
    note: "A tier carries no floor of its own in the contract; the programme's floor rate applies to the tier price.",
    rows: fx.programmes.flatMap((programme) =>
      (programme.pricingTiers ?? []).map((tier) => ({
        id: uuidFor(childKey(programme.id, "tier", tier.maxPax)),
        tenant_id: TENANT_UUID,
        programme_id: uuidFor(programme.id),
        max_pax: tier.maxPax,
        price_sen: tier.price.amount,
        floor_price_sen: Math.round(tier.price.amount * (1 - programme.floorMarginRate)),
        currency: tier.price.currency,
        created_at: programme.createdAt,
        ...actorColumns(programme.createdBy),
      })),
    ),
  });

const programmeTrainersSql = (): string =>
  upsert({
    table: "core.programme_trainers",
    conflict: ["tenant_id", "programme_id", "trainer_id"],
    frozen: ["created_at"],
    rows: fx.programmes.flatMap((programme) =>
      (programme.trainerPool ?? []).map((member) => ({
        id: uuidFor(childKey(programme.id, "trainer", member.trainerRef)),
        tenant_id: TENANT_UUID,
        programme_id: uuidFor(programme.id),
        trainer_id: refUuid(member.trainerRef),
        certified_at: null,
        rating_override: member.rating ?? null,
        created_at: programme.createdAt,
        ...actorColumns(programme.createdBy),
      })),
    ),
  });

const programmeMaterialsSql = (): string =>
  upsert({
    table: "core.programme_materials",
    conflict: ["tenant_id", "programme_id", "material_type", "version"],
    frozen: ["created_at"],
    rows: fx.programmes.flatMap((programme) =>
      (programme.materials ?? []).map((material) => ({
        id: uuidFor(childKey(programme.id, "material", `${material.type}:${material.version}`)),
        tenant_id: TENANT_UUID,
        programme_id: uuidFor(programme.id),
        material_type: material.type,
        version: material.version,
        languages: arr(material.languages ?? [], "char(2)"),
        attachment_id: null,
        created_at: programme.createdAt,
        ...actorColumns(programme.createdBy),
      })),
    ),
  });

const organisationsSql = (): string =>
  upsert({
    table: "core.organisations",
    conflict: ["id"],
    frozen: ["ref", "created_at"],
    note: "Six organisations. ORG-0114 Aurora Manufacturing carries the in-flight deal ENG-0259.",
    rows: fx.organisations.map((org) => ({
      id: uuidFor(org.id),
      tenant_id: TENANT_UUID,
      ref: org.ref,
      name: org.name,
      industry: org.industry ?? null,
      location: org.location ?? null,
      owner_id: uuidFor(org.owner.id),
      status: org.status,
      hrdc_registered: org.hrdcRegistered,
      hrdc_employer_code: org.hrdcEmployerCode ?? null,
      proposal_count: 0,
      first_proposal_sent_at: null,
      health_score: org.metrics?.healthScore?.value ?? null,
      archived_at: null,
      created_at: org.createdAt,
      ...actorColumns(org.owner),
      tax_identifier_kind: null,
      tax_identifier: null,
      tin: null,
      sst_registration_no: null,
      address_line1: null,
      address_line2: null,
      city: org.location ?? null,
      state_code: null,
      postcode: null,
      country_code: "MYS",
    })),
  });

const healthSnapshotsSql = (): string => {
  const scored = fx.organisations.filter((org) => typeof org.metrics?.healthScore?.value === "number");
  return upsert({
    table: "core.organisation_health_snapshots",
    conflict: ["id"],
    frozen: ["created_at"],
    note: "One snapshot per scored organisation, at the fixture clock. The account screen reads the latest.",
    rows: scored.map((org) => ({
      id: uuidFor(childKey(org.id, "health", "now")),
      tenant_id: TENANT_UUID,
      organisation_id: uuidFor(org.id),
      score: org.metrics!.healthScore!.value as number,
      components: j({ source: "fixture", note: org.metrics!.healthScore!.secondary ?? null }),
      computed_at: fx.NOW,
      model_version: "fixture-v1",
      created_at: fx.NOW,
      ...actorColumns({ id: "system", name: null, kind: "SYSTEM" }),
    })),
  });
};

const contactsSql = (): string =>
  upsert({
    table: "core.contacts",
    conflict: ["id"],
    frozen: ["ref", "created_at"],
    rows: fx.contacts.map((contact) => ({
      id: uuidFor(contact.id),
      tenant_id: TENANT_UUID,
      ref: contact.ref,
      organisation_id: refUuid(contact.organisationRef),
      name: contact.name,
      job_title: contact.role ?? null,
      email: contact.email ?? null,
      phone: contact.phone ?? null,
      is_primary: contact.primary ?? false,
      pdpa_flag: contact.pdpaFlag ?? null,
      redacted_at: null,
      created_at: contact.createdAt,
      ...actorColumns(contact.createdBy),
    })),
  });

/**
 * Consent.
 *
 * `core.contact_consents.recorded_at` is NOT NULL: a row is a record of somebody
 * asking on a date. The fixture world also carries `granted: false` with
 * `recordedAt: null`, which means "never asked" rather than "refused", and the
 * table has no way to say that. Those are left out rather than given an invented
 * date — see the PR's schema-gap list.
 */
const consentsSql = (): string => {
  const byRef = new Map(fx.contacts.map((c) => [c.ref, c]));
  const rows = Object.entries(fx.contactConsents).flatMap(([contactRef, consents]) => {
    const contact = byRef.get(contactRef);
    if (!contact) return [];
    return consents
      .filter((consent) => Boolean(consent.recordedAt))
      .map((consent) => ({
        id: uuidFor(childKey(contact.id, "consent", consent.channel)),
        tenant_id: TENANT_UUID,
        contact_id: uuidFor(contact.id),
        channel: consent.channel,
        granted: consent.granted,
        recorded_at: consent.recordedAt as string,
        source: "fixture",
        withdrawn_at: null,
        created_at: consent.recordedAt as string,
        ...actorColumns(contact.createdBy),
      }));
  });
  return upsert({
    table: "core.contact_consents",
    conflict: ["tenant_id", "contact_id", "channel", "recorded_at"],
    frozen: ["created_at"],
    note: "PDPA consent, one row per channel a contact was actually asked about.",
    rows,
  });
};

const organisationSuggestionsSql = (): string => {
  const rows = Object.entries(fx.organisationSuggestions).flatMap(([orgRef, suggestions]) =>
    suggestions.map((suggestion, index) => ({
      id: uuidFor(childKey(`org:${orgRef}`, "suggestion", index)),
      tenant_id: TENANT_UUID,
      organisation_id: refUuid(orgRef),
      suggestion_type: suggestion.type ?? "PROGRAMME",
      // `programmeId` holds a business reference (PRG-0018), not an opaque id.
      programme_id: suggestion.programmeId ? refUuid(suggestion.programmeId) : null,
      title: suggestion.title,
      rationale: suggestion.rationale,
      status: "OPEN",
      dismissed_at: null,
      dismissed_by_user_id: null,
      created_at: fx.NOW,
      created_by_kind: "AGENT",
      created_by_id: "agent_knowledge",
      created_by_name: "Knowledge agent",
    })),
  );
  return upsert({
    table: "core.organisation_suggestions",
    conflict: ["id"],
    frozen: ["created_at"],
    note: "Agent-proposed next programmes on the account screen.",
    rows,
  });
};

export const slice01: Slice = {
  file: "fixture_world_01_tenant_and_parties.sql",
  title: "Tenant, principals, reference formats, pipelines, catalogue and parties",
  tables: [
    "public.tenants",
    "auth.users",
    "public.user_profiles",
    "public.teams",
    "core.trainers",
    "public.memberships",
    "public.team_members",
    "core.ref_formats",
    "core.pipelines",
    "core.pipeline_steps",
    "core.programmes",
    "core.programme_pricing_tiers",
    "core.programme_trainers",
    "core.programme_materials",
    "core.organisations",
    "core.organisation_health_snapshots",
    "core.contacts",
    "core.contact_consents",
    "core.organisation_suggestions",
  ],
  emit: () =>
    block(
      banner("Tenant"),
      tenantsSql(),
      banner("Principals"),
      authUsersSql(),
      agentPrincipalsSql(),
      userProfilesSql(),
      teamsSql(),
      trainersSql(),
      membershipsSql(),
      teamMembersSql(),
      banner("Reference formats and pipeline configuration"),
      refFormatsSql(),
      pipelinesSql(),
      pipelineStepsSql(),
      banner("Catalogue"),
      programmesSql(),
      pricingTiersSql(),
      programmeTrainersSql(),
      programmeMaterialsSql(),
      banner("Parties"),
      organisationsSql(),
      healthSnapshotsSql(),
      contactsSql(),
      consentsSql(),
      organisationSuggestionsSql(),
    ),
};
