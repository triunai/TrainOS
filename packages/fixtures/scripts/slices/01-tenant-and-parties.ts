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
import { arr, banner, block, j, lit, upsert } from "../lib/sql.ts";

/** The tenant slug. Every anchor id and every `ref` in the seed belongs to it. */
export const TENANT_SLUG = "akademi-perdana";

/**
 * When the tenant and its staff came into existence.
 *
 * The fixture world dates its organisations and programmes but says nothing
 * about the training provider itself, and `created_at` is NOT NULL everywhere.
 * One instant, comfortably before the oldest organisation (ORG-0133, May 2022),
 * so nobody's account predates the company that owns it.
 */
const TENANT_CREATED_AT = "2022-01-04T09:00:00+08:00";

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
 * Provisioning the fixture tenant.
 *
 * 016 owns what a new tenant gets: `app.seed_ref_formats()` derives one
 * `core.ref_formats` row per `core.assign_ref` trigger, `app.seed_action_policies()`
 * writes the policy gate's twenty-two rows, and `app.seed_compliance_check_keys()`
 * writes the three HRD Corp check keys. All three run as AFTER INSERT triggers on
 * `public.tenants`, and all three are idempotent.
 *
 * The seed does NOT call `app.provision_tenant()`, and the reason is one line of
 * 016: that function allocates the id itself (`INSERT INTO public.tenants (slug,
 * name, timezone) ... RETURNING id`). The fixture world needs a FIXED tenant id —
 * seeds/README.md requires it, and the RPC tests and every screenshot quote it —
 * and there is no way to hand one in. Re-pointing the row afterwards is not an
 * option either: `core.ref_formats`, `core.action_policies` and `core.check_keys`
 * already reference it by then and none of those foreign keys is ON UPDATE CASCADE.
 *
 * So the row is inserted with its id, which fires exactly the three triggers
 * provisioning relies on; then the three seeders are called by name, so a disabled
 * or dropped trigger cannot produce a tenant that looks provisioned; then
 * `app.provision_tenant()`'s own two refusals are reproduced here. Everything 016
 * does, in other words, except choosing the id.
 *
 * The migrations lane has been asked for `p_id uuid DEFAULT NULL` on
 * `app.provision_tenant()`. When it lands this whole block becomes one PERFORM.
 */
const provisionSql = (): string =>
  `-- Tenant, provisioned through 016's own seeders.
DO $provision$
DECLARE
  v_tenant   CONSTANT uuid := '${TENANT_UUID}';
  v_formats  integer;
  v_policies integer;
BEGIN
  INSERT INTO public.tenants (id, slug, name, status, timezone, locale, created_at)
  VALUES (v_tenant, '${TENANT_SLUG}', ${lit(fx.tenant.name)}, 'ACTIVE',
          ${lit(fx.tenant.timezone)}, ${lit(fx.tenant.locale)}, ${lit(TENANT_CREATED_AT)})
  ON CONFLICT (id) DO NOTHING;

  -- Re-runnable in the same sense as every other statement in this pack: an
  -- unchanged fixture updates nothing.
  UPDATE public.tenants
     SET name = ${lit(fx.tenant.name)},
         status = 'ACTIVE',
         timezone = ${lit(fx.tenant.timezone)},
         locale = ${lit(fx.tenant.locale)}
   WHERE id = v_tenant
     AND (name, status, timezone, locale)
         IS DISTINCT FROM (${lit(fx.tenant.name)}, 'ACTIVE', ${lit(fx.tenant.timezone)}, ${lit(fx.tenant.locale)});

  PERFORM app.seed_ref_formats(v_tenant);
  PERFORM app.seed_action_policies(v_tenant);
  PERFORM app.seed_compliance_check_keys(v_tenant);

  SELECT count(*) INTO v_formats FROM core.ref_formats WHERE tenant_id = v_tenant;
  IF v_formats = 0 THEN
    RAISE EXCEPTION
      'fixture_world: tenant % has no ref_formats, so every ref''d table is unwritable', v_tenant;
  END IF;

  SELECT count(*) INTO v_policies FROM core.action_policies WHERE tenant_id = v_tenant;
  IF v_policies = 0 THEN
    RAISE EXCEPTION
      'fixture_world: tenant % has no action_policies, so every action would fall '
      'through the policy gate with nothing to evaluate', v_tenant;
  END IF;
END
$provision$;`;

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
      created_at: TENANT_CREATED_AT,
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
      created_at: TENANT_CREATED_AT,
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
      created_at: TENANT_CREATED_AT,
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
        created_at: TENANT_CREATED_AT,
      },
    ],
  });

const trainersSql = (): string =>
  upsert({
    table: "core.trainers",
    conflict: ["id"],
    frozen: ["ref", "created_at"],
    note: [
      "Four trainers. TRN-0007 is Farah Aziz, who also holds a TRAINER membership.",
      "--",
      "-- hrd_tdf is written FALSE on all four, and three of them are TDF-accredited in",
      "-- the fixture world. 017's trainers_hrd_tdf_needs_expiry refuses `hrd_tdf = true`",
      "-- without hrd_tdf_valid_to, and the fixture carries no TDF expiry and no TDF",
      "-- reference -- tttRef and tttValidTo are a different accreditation and using them",
      "-- here would be inventing a date an auditor could act on. A wrong boolean that",
      "-- the pin asserts and the PR names beats a fabricated expiry. See T2h.",
    ].join("\n"),
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
      // See the note above: the fixture says `trainer.hrdTdf` for three of these.
      hrd_tdf: false,
      hrd_tdf_valid_to: null,
      hrd_tdf_ref: null,
      rating: trainer.rating,
      status: "ACTIVE",
      created_at: TENANT_CREATED_AT,
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
      created_at: TENANT_CREATED_AT,
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
      created_at: TENANT_CREATED_AT,
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
        created_at: TENANT_CREATED_AT,
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
        // 017 requires a purpose. The fixture records a channel and a date and
        // never why consent was asked for, and UNSPECIFIED_PRE_017 is the member
        // 017 added for exactly that: consent captured before the purpose was.
        // contact_consents_no_new_unspecified admits it only below 2026-09-14,
        // and every fixture consent is 2022-2024.
        purpose: "UNSPECIFIED_PRE_017",
        notice_version: null,
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
    // Written by 016's provisioning seeders, not by an upsert here; listed so the
    // wipe removes them (their tenant FK is ON DELETE RESTRICT).
    "core.ref_formats",
    "core.action_policies",
    "core.check_keys",
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
      provisionSql(),
      banner("Principals"),
      authUsersSql(),
      agentPrincipalsSql(),
      userProfilesSql(),
      teamsSql(),
      trainersSql(),
      membershipsSql(),
      teamMembersSql(),
      banner("Pipeline configuration"),
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
