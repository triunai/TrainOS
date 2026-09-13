/**
 * Slice 4 — the agent fleet, the model and routing configuration it runs on,
 * the runs it produced, and the governance rows that watch it.
 *
 * Everything here depends on slice 1 (the tenant, the principals, the ref
 * formats) and on nothing in slices 2 and 3. That is deliberate: the approvals
 * in this slice point at quotations, proposals, invoices and engagements that
 * slices 2 and 3 own, and every one of those pointers is a nullable
 * `target_id`. The seed writes the business REFERENCE (`target_ref`, a text
 * column with no foreign key) and leaves the uuid NULL, so this file loads
 * against a database where slices 2 and 3 have not run. When those slices
 * land, the back-fill is one UPDATE per approval, not a re-shuffle of the
 * load order.
 *
 * Three things in here are worth a reviewer's attention before the rows are:
 *
 * 1. `core.action_policies` is NOT written. Inserting the tenant fires
 *    `app.seed_action_policies_on_tenant()`, which provisioned twenty-two
 *    policies in slice 1. The fixture world's thirteen `policies` are a
 *    DIFFERENT naming scheme that collides with two of them on the same id
 *    with a different action type, and `action_type` is frozen by
 *    `trg_action_policies_immutable`. See POLICY_DISAGREEMENT below.
 * 2. The fourteen-day `usageDaily` series has no table. `app.usage_rollup` is
 *    monthly by CHECK and has no peak/off-peak split. See USAGE_DAILY below.
 * 3. Eight agents need eight distinct principal users and the fixture world
 *    names none. See AGENT_PRINCIPALS below.
 */

import { createHash } from "node:crypto";

import * as fx from "../../src/data/index.ts";
import { TENANT_UUID, childKey, uuidFor } from "../lib/ids.ts";
import type { Slice } from "../lib/slice.ts";
import { arr, banner, block, j, raw, upsert, type Row } from "../lib/sql.ts";
import { actorColumns, agentPrincipalKey } from "./01-tenant-and-parties.ts";

// ── Derivation helpers ───────────────────────────────────────────────────────

/** Deterministic JSON, so a hash over a fixture value is stable across runs. */
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
};

/** 64 lowercase hex, which is the shape every `*_hash` column CHECKs for. */
const sha256Hex = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

/** `2026-11-14T08:30:00+08:00` + 240 → the same instant four hours later. */
const plusMinutes = (at: string, minutes: number): string =>
  new Date(new Date(at).getTime() + minutes * 60_000).toISOString();

/**
 * `STRONG_1` → `Strong 1`, `FAST_UI` → `Fast UI`. A SCREAMING_SNAKE key
 * rendered for a human, not a new fact. Tokens of one or two characters keep
 * their case, because they are initialisms (UI) or ordinals (1), not words.
 */
const humanise = (key: string): string =>
  key
    .split("_")
    .map((token, index) => {
      if (token.length <= 2) return token;
      const lower = token.toLowerCase();
      return index === 0 ? lower[0]!.toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");

/**
 * `[[0, 9], [18, 24]]` → the 24-bit mask `core.model_tiers.allowed_hours` holds.
 * Bit 0 is 00:00–01:00 local; a tier with no restriction is all ones.
 */
const allowedHoursBits = (windows: readonly (readonly [number, number])[]): string => {
  const bits = Array.from({ length: 24 }, () => "0");
  for (const [from, to] of windows) for (let h = from; h < to; h += 1) bits[h] = "1";
  return bits.join("");
};

const FULL_DAY = "1".repeat(24);

/**
 * The §18 jury policy, as the database holds it.
 *
 * Identical to the fixture's object except that `triggers.maxValue` — a §1
 * Money object in the fixture — becomes `maxValueSen`, an integer. Money is
 * integer minor units everywhere below the API, and a jsonb column is not an
 * exception worth carving.
 */
type FixtureJury = {
  mode: string;
  quorum: number;
  of: number;
  tiers: readonly string[];
  sampleRate?: number;
  triggers?: { minConfidence?: number; maxValue?: { amount: number }; firstOfKind?: boolean };
};

const juryJson = (jury: FixtureJury): Record<string, unknown> => ({
  mode: jury.mode,
  quorum: jury.quorum,
  of: jury.of,
  tiers: jury.tiers,
  ...(jury.sampleRate === undefined ? {} : { sampleRate: jury.sampleRate }),
  ...(jury.triggers === undefined
    ? {}
    : {
        triggers: {
          ...(jury.triggers.minConfidence === undefined
            ? {}
            : { minConfidence: jury.triggers.minConfidence }),
          ...(jury.triggers.maxValue === undefined
            ? {}
            : { maxValueSen: jury.triggers.maxValue.amount }),
          ...(jury.triggers.firstOfKind === undefined
            ? {}
            : { firstOfKind: jury.triggers.firstOfKind }),
        },
      }),
});

/**
 * The action types `app.action_types` actually has a row for.
 *
 * `core.routing_entries`, `core.autonomy_grants`, `core.jury_configs`,
 * `core.hours_saved_baselines`, `core.action_requests` and
 * `core.approval_requests` all carry `FOREIGN KEY (action_type) REFERENCES
 * app.action_types(key) ON DELETE RESTRICT`, and that catalogue is provisioned
 * by migration 011, not by this seed. The fixture world routes, grants
 * autonomy over and measures hours saved on `PROPOSAL_DRAFT`, which the
 * catalogue does not have. Those rows are dropped here rather than inserted
 * against a key that does not exist — see the PR's schema-gap list.
 */
const KNOWN_ACTION_TYPES = new Set<string>([
  "ACCOUNT_TRADING_HOLD",
  "AGENT_AUTONOMY_CHANGE",
  "AGENT_PAUSE",
  "ATTENDANCE_APPROVE",
  "ATTENDANCE_UNLOCK",
  "BROADCAST_SEND",
  "BUDGET_CAP_RAISE",
  "DISCOUNT_APPROVE",
  "ENGAGEMENT_CLOSE_OUT",
  "ENQUIRY_ARCHIVE",
  "FOLLOWUP_SEND",
  "HRDC_PACKET_MARK_SUBMITTED",
  "INVOICE_CREATE",
  "INVOICE_PUSH",
  "OPPORTUNITY_CONVERT",
  "PAYMENT_RECORD",
  "PROPOSAL_SEND",
  "QUOTATION_APPLY",
  "REMINDER_SEND",
  "RULE_CHANGE_APPROVE",
  "TNA_RECOMMENDATION_ACCEPT",
  "TRAINER_BOOK",
]);

const knownActionType = (key: string): boolean => KNOWN_ACTION_TYPES.has(key);

// ── Tier keys and model tiers ────────────────────────────────────────────────

const tierKeysSql = (): string =>
  upsert({
    table: "core.tier_keys",
    conflict: ["tenant_id", "tier_key"],
    frozen: ["created_at"],
    note: [
      "The nine tier keys. Six other tables have a composite FK into this one, so it",
      "-- loads first. `label` is the key rendered for a human (STRONG_1 → Strong 1);",
      "-- the fixture world names the MODEL behind a tier, never the tier itself.",
    ].join("\n"),
    rows: fx.modelTiers.map((tier, index) => ({
      id: uuidFor(`tier:${tier.key}`),
      tenant_id: TENANT_UUID,
      tier_key: tier.key,
      label: humanise(tier.key),
      description: null,
      position: index,
      active: true,
      created_at: fx.NOW,
    })),
  });

const modelTiersSql = (): string =>
  upsert({
    table: "core.model_tiers",
    conflict: ["tenant_id", "tier_key"],
    frozen: ["created_at"],
    note: [
      "The model behind each tier, its routing strategy and its off-peak window.",
      "--",
      "-- `batch_eligible` is derived, not copied: §17 restricts batch-eligible tiers to",
      "-- off-peak hours and makes them queue rather than escalate, so a tier whose",
      "-- `allowedHours` are narrower than the full day IS the batch-eligible one. That",
      "-- picks out MID and CHEAP, which is what ai-ops.ts's own note on MID says.",
      "--",
      "-- SPECIAL's fixture status is PAUSED_BY_CAP and this table has no column for it:",
      "-- `admin_state` is ENABLED/DISABLED and `health` is HEALTHY/DEGRADED. Paused-by-cap",
      "-- is a derived read (spend against `monthly_cap_sen`, which for SPECIAL is exactly",
      "-- at its cap), so the row is stored ENABLED/HEALTHY. See the PR's schema-gap list.",
    ].join("\n"),
    rows: fx.modelTiers.map((tier) => {
      const hours = allowedHoursBits(tier.allowedHours as readonly (readonly [number, number])[]);
      return {
        id: uuidFor(`model_tier:${tier.key}`),
        tenant_id: TENANT_UUID,
        tier_key: tier.key,
        model: tier.model,
        provider: tier.provider,
        routing: tier.routing,
        fallback_chain: arr(tier.fallbackChain),
        cache_strategy: tier.cacheStrategy,
        max_output_tokens: tier.maxOutputTokens ?? null,
        allowed_hours: raw(`B'${hours}'`),
        batch_eligible: hours !== FULL_DAY,
        admin_state: "ENABLED",
        health: tier.status === "DEGRADED" ? "DEGRADED" : "HEALTHY",
        degraded_since: tier.degradation?.since ?? null,
        degraded_reason: tier.degradation?.reason ?? null,
        active_fallback_tier: tier.degradation?.activeFallback ?? null,
        monthly_cap_sen: tier.monthlyCap?.amount ?? null,
        currency: tier.monthlyCap?.currency ?? "MYR",
        created_at: fx.NOW,
      };
    }),
  });

// ── The agent fleet ──────────────────────────────────────────────────────────

/**
 * Agent principals live in slice 1.
 *
 * `core.agents.principal_user_id` is NOT NULL with `UNIQUE (tenant_id,
 * principal_user_id)`, so every agent acts as its own auth principal and no two
 * may share one. Slice 1 mints those eight `auth.users` rows beside the seven
 * humans, because `auth.users` has exactly one owner in this pack and the wipe
 * has to be able to find every row it wrote. This slice only points at them.
 */

/**
 * Agent refs.
 *
 * `core.assign_ref` honours an explicit ref and allocates one from
 * `core.ref_sequences` otherwise. Allocating would make the emitted SQL depend
 * on how many times it has been run, so the ref is written out: AGT is a
 * three-wide undated prefix, and the registry's own order is the only order
 * the fixture world gives these eight.
 */
const agentRef = (index: number): string => `AGT-${String(index + 1).padStart(3, "0")}`;

const agentsSql = (): string =>
  upsert({
    table: "core.agents",
    conflict: ["tenant_id", "agent_id"],
    frozen: ["ref", "created_at"],
    note: [
      "Eight agents. agent_knowledge is PAUSED on an eval regression and carries the",
      "-- resume condition that would lift it (evalScore ≥ 0.85).",
      "--",
      "-- `costMonth`, `evalScore`, `cacheHitRate30d` and `costPerRun30d` are read-side",
      "-- aggregates with no column here: the first lands in app.usage_rollup, the second",
      "-- in core.evals, and the last two have nowhere to go. See the PR's schema-gap list.",
    ].join("\n"),
    rows: fx.agents.map((agent, index) => ({
      id: uuidFor(agent.id),
      tenant_id: TENANT_UUID,
      ref: agentRef(index),
      agent_id: agent.id,
      name: agent.name,
      status: agent.status,
      principal_user_id: uuidFor(agentPrincipalKey(agent.id)),
      orchestrator: null,
      scopes: arr(agent.scopes),
      kill_switch: agent.killSwitch,
      paused_at: agent.pausedAt ?? null,
      paused_reason: agent.pausedReason ?? null,
      // The fixture world records that the Knowledge Agent was paused and why,
      // never by whom. A pauser is not derivable, so the column stays NULL.
      paused_by: j(null),
      resume_condition: j(agent.resumeCondition ?? null),
      default_tier: agent.defaultTier,
      escalation_ladder: arr(agent.escalationLadder),
      jury: j(juryJson(agent.jury as FixtureJury)),
      last_run_at: agent.lastRunAt,
      created_at: "2026-01-12T10:00:00+08:00",
    })),
  });

/**
 * Autonomy grants.
 *
 * `app.enforce_autonomy_ceiling` stays live — it is the guard that makes the
 * launch matrix mean something, and every fixture level sits at or below the
 * ceiling `app.action_types` publishes for its action type.
 *
 * Two fixture values do not survive the schema and are dropped rather than
 * bent:
 *
 *   • `agent_lead`'s OPPORTUNITY_CONVERT grant names `approverRole: "SALES"`
 *     (agents.ts:64), and `autonomy_grants_approver_role_check` admits only
 *     SALES_MANAGER / OPS / FINANCE / MD / ADMIN. The grant is written with a
 *     NULL approver rather than promoted to SALES_MANAGER, which would be a
 *     different policy.
 *   • `agent_proposal`'s PROPOSAL_SEND grant carries `thresholdValue`
 *     RM 15,000 (agents.ts:137) at level ACT_WITH_APPROVAL, and
 *     `autonomy_grants_threshold_needs_autonomous` allows a value threshold
 *     only on an AUTONOMOUS grant. The threshold is left NULL; the same
 *     RM 15,000 is expressed by the provisioned policy APV-01's condition, so
 *     nothing is lost from the behaviour, only from this row.
 *
 * `granted_by` is NOT NULL and names no person in the fixture world: agents.ts
 * describes this array as "the DECISIONS §1 launch matrix", which is a
 * configuration, so that is what is recorded.
 */
const APPROVER_ROLES = new Set(["SALES_MANAGER", "OPS", "FINANCE", "MD", "ADMIN"]);

const autonomyGrantsSql = (): string => {
  const rows = fx.agents.flatMap((agent) =>
    agent.autonomy
      .filter((grant) => knownActionType(grant.actionType))
      .map((grant) => ({
        id: uuidFor(childKey(agent.id, "autonomy", grant.actionType)),
        tenant_id: TENANT_UUID,
        agent_id: agent.id,
        action_type: grant.actionType,
        level: grant.level,
        approver_role:
          grant.approverRole && APPROVER_ROLES.has(grant.approverRole) ? grant.approverRole : null,
        value_threshold_sen: grant.level === "AUTONOMOUS" ? (grant.thresholdValue?.amount ?? null) : null,
        currency: "MYR",
        min_confidence: 0.7,
        paused: grant.paused,
        // A paused grant records no pause time in the fixture world; inventing
        // one would make the registry's "paused since" read as a fact.
        paused_at: null,
        paused_reason: null,
        resume_condition: j(null),
        promotion_condition: j(null),
        promoted_from_level: null,
        promoted_at: null,
        promoted_by: null,
        promotion_jury_verdict_id: null,
        promotion_blocked_reason: null,
        granted_by: "launch_matrix",
        granted_at: "2026-01-12T10:00:00+08:00",
      })),
  );
  return upsert({
    table: "core.autonomy_grants",
    // This table has no natural unique key — only the primary key on `id` — so
    // the conflict target is the derived id. See the PR's schema-gap list.
    conflict: ["id"],
    frozen: ["granted_at"],
    note: "The launch matrix, one row per agent and action type. The autonomy ceiling trigger stays live.",
    rows,
  });
};

/**
 * An eval's provenance, or a loud failure.
 *
 * `AgentEval.provenance` is optional in the contract and present on all eight
 * evals the fixture world carries. Defaulting a missing one to the fixture
 * clock would record a measurement as having been taken at a moment nobody
 * measured anything, so this refuses instead.
 */
const requireProvenance = (entry: {
  metric?: string;
  provenance?: { generatedAt?: string };
}): { generatedAt: string } => {
  const generatedAt = entry.provenance?.generatedAt;
  if (!generatedAt) {
    throw new Error(`agent eval ${entry.metric ?? "<unnamed>"} carries no provenance instant`);
  }
  return { generatedAt };
};

/**
 * Evals.
 *
 * `agentEvals` is a 30-day rolling score over 120 live samples, so `kind` is
 * LIVE_SAMPLE — the only member of the CHECK that describes a window over live
 * traffic. GOLDEN_SET would oblige a `golden_set_version` the fixture world
 * does not have. The window, the sample size and the deterministic method are
 * the fixture's own provenance fields and go to `detail`.
 */
const evalsSql = (): string =>
  upsert({
    table: "core.evals",
    conflict: ["id"],
    frozen: [
      "tenant_id",
      "agent_id",
      "action_type",
      "kind",
      "golden_set_version",
      "run_id",
      "score",
      "passed",
      "evaluated_at",
      "created_at",
    ],
    note: "One rolling eval per agent. `passed` has no fixture value — a score is not a verdict.",
    rows: fx.agentEvals.map((entry) => ({
      id: uuidFor(childKey(entry.agentId, "eval", entry.window)),
      tenant_id: TENANT_UUID,
      agent_id: entry.agentId,
      action_type: null,
      kind: "LIVE_SAMPLE",
      golden_set_version: null,
      run_id: null,
      score: entry.score,
      passed: null,
      detail: j({
        window: entry.window,
        sampleSize: entry.sampleSize,
        method: entry.provenance?.method,
        origin: entry.provenance?.origin,
      }),
      // An eval with no provenance is an eval nobody can attribute. Every one in
      // the fixture world has it; failing loudly is better than a NOW() that
      // makes the row look freshly measured.
      evaluated_at: requireProvenance(entry).generatedAt,
      created_at: requireProvenance(entry).generatedAt,
    })),
  });

// ── Routing and juries ───────────────────────────────────────────────────────

/**
 * One routing matrix version.
 *
 * `routing_matrix_versions_no_overlap` is a GiST exclusion on the generated
 * `applies` range, so a second open-ended version would be rejected — the
 * fixture world serves exactly one matrix and the `staged` edits on two of its
 * rows are PROPOSALS against it, not a second version. Nothing applies them,
 * and `core.routing_entries` has no column to hold them: see the PR's
 * schema-gap list.
 */
const ROUTING_VERSION_LABEL = "launch";

const routingVersionSql = (): string =>
  upsert({
    table: "core.routing_matrix_versions",
    conflict: ["tenant_id", "label"],
    frozen: ["effective_from", "created_at"],
    note: "The live routing matrix. One open-ended version; the exclusion constraint permits no second.",
    rows: [
      {
        id: uuidFor(`routing_version:${ROUTING_VERSION_LABEL}`),
        tenant_id: TENANT_UUID,
        label: ROUTING_VERSION_LABEL,
        effective_from: "2026-01-12T10:00:00+08:00",
        effective_to: null,
        note: "The assignment matrix M20-S20 renders. Staged edits are proposals and are not applied.",
        created_at: "2026-01-12T10:00:00+08:00",
      },
    ],
  });

const routableEntries = () => fx.routingEntries.filter((entry) => knownActionType(entry.actionType));

const routingEntriesSql = (): string =>
  upsert({
    table: "core.routing_entries",
    conflict: ["tenant_id", "version_id", "action_type"],
    frozen: ["created_at"],
    note: [
      "Eleven of the twelve assignment rows. PROPOSAL_DRAFT is dropped: this table has a",
      "-- foreign key into app.action_types and the catalogue migration 011 provisions has",
      "-- no PROPOSAL_DRAFT key. See the PR's schema-gap list.",
    ].join("\n"),
    rows: routableEntries().map((entry) => ({
      id: uuidFor(childKey(ROUTING_VERSION_LABEL, "routing", entry.actionType)),
      tenant_id: TENANT_UUID,
      version_id: uuidFor(`routing_version:${ROUTING_VERSION_LABEL}`),
      action_type: entry.actionType,
      tier_key: entry.tier,
      escalation_ladder: arr(entry.escalationLadder),
      jury: j(juryJson(entry.jury as FixtureJury)),
      required_for_autonomous: entry.requiredForAutonomous,
      created_at: "2026-01-12T10:00:00+08:00",
    })),
  });

/**
 * Jury configuration.
 *
 * The same object, normalised. `core.routing_entries.jury` is the jsonb the
 * router reads inline; `core.jury_configs` is the per-action-type row
 * `app.enqueue_jury` and `app.enqueue_jury_samples` read. Both come from the
 * one fixture value, so they cannot disagree.
 */
const juryConfigsSql = (): string =>
  upsert({
    table: "core.jury_configs",
    conflict: ["tenant_id", "action_type"],
    frozen: ["created_at"],
    note: "The routing matrix's jury policy, normalised out of the jsonb for the jury queue to read.",
    rows: routableEntries().map((entry) => {
      const jury = entry.jury as FixtureJury;
      return {
        id: uuidFor(childKey("jury_config", "action", entry.actionType)),
        tenant_id: TENANT_UUID,
        action_type: entry.actionType,
        mode: jury.mode,
        quorum: jury.quorum,
        of: jury.of,
        tiers: arr(jury.tiers),
        sample_rate: jury.sampleRate ?? null,
        trigger_min_confidence: jury.triggers?.minConfidence ?? null,
        trigger_max_value_sen: jury.triggers?.maxValue?.amount ?? null,
        trigger_first_of_kind: jury.triggers?.firstOfKind ?? false,
        active: true,
        created_at: "2026-01-12T10:00:00+08:00",
      };
    }),
  });

// ── Provider keys and budgets ────────────────────────────────────────────────

/**
 * Provider keys.
 *
 * Nothing in this table is key material and nothing here is derived from key
 * material, because the fixture world holds none: `maskedKey` is all the API
 * ever returns and all the fixture carries.
 *
 *   • `masked_key` is the fixture's own mask, which `app.is_masked_key`
 *     validates (8+ bullets, ≤ 9 trailing visible characters).
 *   • `key_fingerprint` is NOT NULL, `bytea`, exactly 32 octets, and unique per
 *     tenant. It is SHA-256 of the PUBLIC provider ref — `prv_anthropic`, a
 *     string printed in the fixture file. It is not a hash of any secret and
 *     must never be treated as one; it exists so the uniqueness index has
 *     something distinct per row until a real key is saved through the edge
 *     function that owns this column.
 *   • `key_ref` is NOT NULL and points at where a secret WOULD live. The
 *     fixture's slot has nothing behind it, so it names the fixture slot.
 *
 * `prv_embeddings` is NOT_SET with `maskedKey: ""` (ai-ops.ts:391) and is left
 * out entirely: `masked_key` is NOT NULL under `ai_provider_keys_masked_key_check`,
 * so the empty first-run slot the screen renders cannot be stored. See the PR's
 * schema-gap list.
 *
 * `spendMonth` has no column here; it is app.usage_rollup's job.
 */
const storableProviderKeys = () => fx.providerKeys.filter((key) => key.maskedKey.length > 0);

const providerKeysSql = (): string =>
  upsert({
    table: "core.ai_provider_keys",
    conflict: ["tenant_id", "provider_ref"],
    frozen: ["key_fingerprint", "added_by", "added_at", "created_at"],
    note: [
      "Five provider keys. A masked prefix and a fingerprint, never key material.",
      "-- `key_fingerprint` is SHA-256 of the PUBLIC provider ref, not of any secret.",
      "-- The NOT_SET embeddings slot cannot be stored — see the PR's schema-gap list.",
    ].join("\n"),
    rows: storableProviderKeys().map((key) => ({
      id: uuidFor(`provider_key:${key.id}`),
      tenant_id: TENANT_UUID,
      provider_ref: key.id,
      provider: key.provider,
      label: key.label,
      status: key.status,
      masked_key: key.maskedKey,
      key_fingerprint: raw(`'\\x${sha256Hex(key.id)}'::bytea`),
      key_ref: `fixture://provider-keys/${key.id}`,
      scope_tiers: arr(key.scopeTiers),
      cap_sen: key.cap?.amount ?? null,
      currency: key.cap?.currency ?? "MYR",
      rotation_date: key.rotationDate ?? null,
      billing_owner: key.billingOwner,
      region: key.region,
      last_tested_at: key.lastTestedAt ?? null,
      invalid_since: key.invalidSince ?? null,
      active_fallback_tier: key.activeFallbackTier ?? null,
      // `addedBy` in the fixture is `{ id, name, at }`; `app.is_valid_actor`
      // wants a `kind`. Khairul Anwar is one of slice 1's seven humans.
      added_by: j({ kind: "HUMAN", id: key.addedBy.id, name: key.addedBy.name }),
      added_at: key.addedBy.at,
      last_revealed_at: null,
      reveal_count: 0,
      created_at: key.addedBy.at,
    })),
  });

const budgetsSql = (): string =>
  upsert({
    table: "core.ai_budgets",
    conflict: ["tenant_id", "scope", "key"],
    frozen: ["created_at"],
    note: [
      "Seven caps. `spend` and `state` are NOT stored: both are reads against",
      "-- app.usage_rollup, and duplicating them here would be a second answer to one",
      "-- question. `near_threshold` keeps the schema default of 0.800 — the fixture",
      "-- publishes the resulting STATE, never the threshold that produced it.",
    ].join("\n"),
    rows: fx.budgets.map((budget) => ({
      id: uuidFor(childKey("budget", budget.scope, budget.key)),
      tenant_id: TENANT_UUID,
      scope: budget.scope,
      key: budget.key,
      cap_sen: budget.cap.amount,
      currency: budget.cap.currency,
      near_threshold: 0.8,
      note: null,
      created_at: "2026-01-12T10:00:00+08:00",
    })),
  });

/**
 * USAGE_DAILY — the one thing in this slice that does not land.
 *
 * `app.usage_rollup` is where spend lives, and it is monthly by construction:
 * `usage_rollup_period_check` is `period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`, so
 * `2026-11-01` is rejected outright, and the table has no peak/off-peak split
 * and no column for a day's run count that is not also a spend key.
 *
 * So `usageDaily` — the fourteen-day series ai-ops.ts:581 documents as the
 * whole point of the chart on M20-S16, the one whose off-peak share must equal
 * the 0.44 the monthly tile publishes — has nowhere to go. The migrations lane
 * needs, in a new migration:
 *
 *     app.usage_daily (
 *       id, tenant_id, day date NOT NULL,
 *       peak_spend_sen bigint NOT NULL, off_peak_spend_sen bigint NOT NULL,
 *       runs integer NOT NULL, currency core.currency_code,
 *       UNIQUE (tenant_id, day))
 *
 * or, less cleanly, a relaxed `period` CHECK on `app.usage_rollup` plus two
 * columns. Until then the three MONTHLY groupings below are all this slice can
 * land, and the daily chart has no rows behind it.
 *
 * The monthly rows carry spend only. `tokens_in`, `tokens_out`, `runs` and
 * `cache_saving_sen` stay at their zero defaults: the fixture's usage response
 * publishes those as PERIOD totals, not per key, and splitting a period total
 * across five breakdown keys would be an invention.
 */
const usageRollupSql = (): string => {
  const rows = Object.entries(fx.usageByGrouping).flatMap(([groupingKey, usage]) => {
    const scope = groupingKey.split("::")[1]!;
    return usage.breakdown.map((entry) => ({
      id: uuidFor(childKey(`usage:${usage.period}`, scope, entry.key)),
      tenant_id: TENANT_UUID,
      period: usage.period,
      scope,
      key: entry.key,
      spend_sen: entry.spend.amount,
      currency: entry.spend.currency,
      tokens_in: 0,
      tokens_out: 0,
      runs: 0,
      cache_saving_sen: 0,
      computed_at: fx.NOW,
      created_at: fx.NOW,
    }));
  });
  return upsert({
    table: "app.usage_rollup",
    conflict: ["tenant_id", "period", "scope", "key"],
    frozen: ["created_at"],
    note: [
      "November spend, by tier, by agent and by action type — the three groupings",
      "-- `GET /v1/ai/usage?groupBy=` serves. The fourteen-day series has no table:",
      "-- see USAGE_DAILY in the generator.",
    ].join("\n"),
    rows,
  });
};

// ── Governance: action requests and approvals ────────────────────────────────

/**
 * POLICY_DISAGREEMENT — why `core.action_policies` is not written here.
 *
 * `app.seed_action_policies_on_tenant()` fired when slice 1 inserted the tenant
 * and provisioned twenty-two policies (APV-01..08, CMP-01..05, FIN-01..07,
 * GOV-01..02). The fixture world's `approvals.ts` `policies` array is a
 * different, thirteen-row naming scheme. Where the two use the same id they
 * often disagree on SLA, and twice they use the same id for a DIFFERENT action
 * type:
 *
 *     fixture CMP-01 = RULE_CHANGE_APPROVE   provisioned CMP-01 = ATTENDANCE_APPROVE
 *     fixture FIN-04 = ACCOUNT_TRADING_HOLD  provisioned FIN-04 = REMINDER_SEND
 *
 * `trg_action_policies_immutable` freezes `action_type`, so upserting either
 * fixture row onto its provisioned namesake raises IMMUTABLE_COLUMN. Matching
 * by action type instead of by id is no better: DISCOUNT_APPROVE, REMINDER_SEND
 * and ATTENDANCE_UNLOCK each have two provisioned rows discriminated by
 * condition, and the fixture's single unconditional row names neither.
 *
 * The provisioned set is also the one that means something — `app.perform_action`
 * evaluates it, and the fixture's `policies` array is described in its own
 * header as "read-only for the demo". So this slice writes nothing to
 * `core.action_policies`, leaves the provisioning intact, and records every
 * disagreement in the PR. The approvals below store the FIXTURE's policy id
 * verbatim, which is what the screens render; `core.approval_requests.policy_id`
 * carries no foreign key, so a dangling `OPS-01` is storable and visible rather
 * than silently rewritten to `CMP-01`.
 */

/** The fixture policy behind an approval, for its SLA and escalation shape. */
const policyFor = (policyId: string) => fx.policies.find((policy) => policy.id === policyId);

/** A human requester's role, read off slice 1's `users`. Agents have no role. */
const roleFor = (userId: string): string | null =>
  fx.users.find((user) => user.id === userId)?.role ?? null;

/**
 * One action request per approval.
 *
 * `core.approval_requests.action_request_id` is NOT NULL: an approval is
 * always an approval OF something. The fixture world models the approval and
 * leaves the envelope implicit, so the envelope is reconstructed from it —
 * same action type, same requester, same value, same evidence, status
 * QUEUED_FOR_APPROVAL, which is what a pending approval means.
 *
 * `target_id` is NULL on every row. The targets are quotations, proposals,
 * invoices and engagements owned by slices 2 and 3; `target_ref` carries the
 * business reference, which is what the screens show and what
 * `app.resolve_action_target_id` resolves from.
 *
 * `ref` is derived from the approval's own ref (APV-2026-0771 → ACT-2026-0771)
 * rather than allocated: `core.assign_ref` honours an explicit ref, and
 * allocating would make the emitted file depend on how often it has been run.
 */
const actionRequestKey = (approvalId: string): string => `action_request:${approvalId}`;

const actionRequestsSql = (): string =>
  upsert({
    table: "core.action_requests",
    conflict: ["id"],
    frozen: ["ref", "created_at"],
    note: [
      "The envelope behind each pending approval. `target_id` is NULL throughout:",
      "-- every target belongs to slice 2 or slice 3, and `target_ref` is the pointer",
      "-- that does not need them. `approval_request_id` is filled in below, once the",
      "-- approvals exist — the two tables reference each other.",
    ].join("\n"),
    rows: fx.approvals.map((approval) => ({
      id: uuidFor(actionRequestKey(approval.id)),
      tenant_id: TENANT_UUID,
      ref: approval.ref.replace(/^APV-/, "ACT-"),
      action_type: approval.actionType,
      target_ref: approval.targetRef ?? null,
      target_entity: null,
      target_id: null,
      payload: j({}),
      value_sen: approval.value?.amount ?? null,
      currency: approval.value?.currency ?? null,
      requested_by_kind: approval.requestedBy.kind,
      requested_by_id: approval.requestedBy.id,
      requested_by_role:
        approval.requestedBy.kind === "HUMAN" ? roleFor(approval.requestedBy.id) : null,
      agent_run_id: approval.requestedBy.runId ?? null,
      confidence: approval.confidence ?? null,
      reasoning: approval.reason,
      evidence: j(approval.evidence),
      context_flags: j({}),
      autonomy_level: approval.autonomy ?? null,
      granted_level: null,
      matched_policy_id: approval.policyId,
      evaluation_trace: j([]),
      status: "QUEUED_FOR_APPROVAL",
      effects: j([]),
      effects_hash: null,
      // `approval_request_id` is deliberately absent from this column list, not
      // written as NULL: naming it here would make every re-run set it back to
      // NULL and the back-fill below set it again, which is two writes a second
      // run is supposed not to make. Omitted, it defaults to NULL on the insert
      // and is never compared afterwards.
      suggested_draft_id: null,
      error_code: null,
      error_details: j(null),
      idempotency_key_id: null,
      created_at: approval.createdAt,
      completed_at: null,
    })),
  });

/**
 * The seven pending approvals.
 *
 * Two NOT NULL columns have no fixture value and are derived rather than
 * invented:
 *
 *   • `diff_hash` is SHA-256 over the canonical JSON of `diff`. That is what
 *     the column is for — `app.decide_approval` takes an expected diff hash and
 *     refuses a decision made against a stale preview — so a hash of the diff
 *     itself is the only honest value.
 *   • `expires_at` is `createdAt` + 1440 minutes, which is the
 *     `expire_after_minutes` every provisioned policy behind these approvals
 *     carries. The fixture publishes `slaRemainingMinutes` and `slaDueAt` but
 *     never an expiry.
 *
 * `escalate_at` and `escalated_to_role` come from the fixture policy's own
 * `escalateAfterMinutes` / `escalateToRole`, and are NULL where it has none.
 * `slaRemainingMinutes` is a server-computed read with no column, by design.
 */
const approvalRequestsSql = (): string =>
  upsert({
    table: "core.approval_requests",
    conflict: ["id"],
    frozen: ["ref", "created_at"],
    note: [
      "Seven pending approvals: 1 breaching, 4 today, 2 this week. `policy_id` is the",
      "-- FIXTURE's policy id, which is not always the provisioned one — see",
      "-- POLICY_DISAGREEMENT in the generator. No decisions: every row is PENDING, so",
      "-- core.approval_decisions has nothing to hold.",
    ].join("\n"),
    rows: fx.approvals.map((approval) => {
      const policy = policyFor(approval.policyId);
      const escalateAfter = policy?.escalateAfterMinutes ?? null;
      return {
        id: uuidFor(`approval:${approval.id}`),
        tenant_id: TENANT_UUID,
        ref: approval.ref,
        action_request_id: uuidFor(actionRequestKey(approval.id)),
        policy_id: approval.policyId,
        action_type: approval.actionType,
        subject: approval.subject,
        target_ref: approval.targetRef ?? null,
        value_sen: approval.value?.amount ?? null,
        currency: approval.value?.currency ?? null,
        margin_rate: approval.marginRate ?? null,
        requested_by_kind: approval.requestedBy.kind,
        requested_by_id: approval.requestedBy.id,
        requested_by_name: approval.requestedBy.name,
        agent_run_id: approval.requestedBy.runId ?? null,
        confidence: approval.confidence ?? null,
        autonomy: approval.autonomy ?? null,
        reason: approval.reason,
        recommendation: j(approval.recommendation ?? null),
        evidence: j(approval.evidence),
        deviations: j(approval.deviations ?? []),
        risk: j(approval.risk ?? null),
        diff: j(approval.diff),
        diff_hash: sha256Hex(canonical(approval.diff)),
        preview_url: approval.previewUrl ?? null,
        approver_role: policy?.approverRole ?? "MD",
        assigned_to_id: null,
        assigned_to_name: null,
        sla_due_at: approval.slaDueAt,
        escalate_at: escalateAfter === null ? null : plusMinutes(approval.createdAt, escalateAfter),
        escalated_at: null,
        escalated_to_role: escalateAfter === null ? null : (policy?.escalateToRole ?? null),
        expires_at: plusMinutes(approval.createdAt, 1440),
        breach_notified_at: null,
        bulk_approvable: approval.bulkApprovable,
        status: "PENDING",
        decision: null,
        decision_note: null,
        decided_by_id: null,
        decided_by_name: null,
        decided_at: null,
        created_at: approval.createdAt,
      };
    }),
  });

/**
 * The back-pointer.
 *
 * `core.action_requests.approval_request_id` and
 * `core.approval_requests.action_request_id` reference each other, and the
 * second is NOT NULL, so the envelope has to be inserted first and pointed at
 * the approval afterwards. Neither foreign key is DEFERRABLE, so there is no
 * single statement that can write both.
 *
 * This is the one statement in the slice that is not an `upsert`. A narrow
 * upsert cannot do it: Postgres evaluates NOT NULL on the proposed tuple before
 * it arbitrates `ON CONFLICT`, so an INSERT naming only three columns fails on
 * `action_type` even though the conflicting row exists. So it is a plain UPDATE
 * carrying the same `IS DISTINCT FROM` guard every upsert here carries — a
 * second run touches no rows and moves no `updated_at`, and reports `UPDATE 0`
 * where the rest of the file reports `INSERT 0 0`.
 */
const actionRequestBackfillSql = (): string => {
  const pairs = fx.approvals
    .map(
      (approval) =>
        `    ('${uuidFor(actionRequestKey(approval.id))}'::uuid, '${uuidFor(`approval:${approval.id}`)}'::uuid)`,
    )
    .join(",\n");
  return [
    "-- Close the loop: each envelope now names the approval it is queued behind.",
    "UPDATE core.action_requests AS target",
    "   SET approval_request_id = pair.approval_request_id",
    "  FROM (VALUES",
    pairs,
    "  ) AS pair(action_request_id, approval_request_id)",
    ` WHERE target.tenant_id = '${TENANT_UUID}'`,
    "   AND target.id = pair.action_request_id",
    "   AND target.approval_request_id IS DISTINCT FROM pair.approval_request_id;",
  ].join("\n");
};

// ── Runs ─────────────────────────────────────────────────────────────────────

type FixtureRun = (typeof fx.runs)[number];

/** The approval a run is halted behind, if any — matched on the run's own id. */
const approvalForRun = (runId: string) =>
  fx.approvals.find((approval) => approval.requestedBy.runId === runId);

/** The step that halted a run, which is where the run's own `halted_by` comes from. */
const haltingStep = (run: FixtureRun) =>
  (run.steps ?? []).find((step) => step.status === "HALTED" && step.haltedBy);

const runsSql = (): string =>
  upsert({
    table: "core.runs",
    conflict: ["id"],
    frozen: ["ref", "trigger", "mode", "started_at", "correlation_id", "created_at"],
    note: [
      "Eight runs. run_4821 is the §17 trace in full, halted at send_proposal by APV-01,",
      "-- which is how the trace proves the agent never sent anything; run_4903 is the",
      "-- dead-lettered failure and run_4930 the one that only succeeded after a retry.",
      "--",
      "-- `finished_at` is `started_at` + `durationMs`: the fixture times the run and names",
      "-- its start, and a finish that contradicted the duration would be a third fact.",
      "-- The run-level `halted_by` is the halting STEP's, for the same reason.",
    ].join("\n"),
    rows: fx.runs.map((run) => {
      const halted = haltingStep(run);
      const approval = approvalForRun(run.id);
      return {
        id: uuidFor(run.id),
        tenant_id: TENANT_UUID,
        ref: run.ref,
        agent_id: run.agentId,
        orchestrator: run.orchestrator ?? null,
        trigger: j(run.trigger),
        mode: "LIVE",
        status: run.status,
        outcome: run.outcome ?? null,
        failure: j(run.failure ?? null),
        halted_by: j(run.status === "HALTED" ? (halted?.haltedBy ?? null) : null),
        model: run.model ?? null,
        tiers_used: arr(run.tiersUsed ?? []),
        cache_hit_rate: run.cacheHitRate ?? null,
        tokens_in: run.tokens?.in ?? 0,
        tokens_out: run.tokens?.out ?? 0,
        cost_sen: run.cost?.amount ?? 0,
        currency: run.cost?.currency ?? "MYR",
        guardrails: arr(run.guardrails ?? []),
        routing_version_id: uuidFor(`routing_version:${ROUTING_VERSION_LABEL}`),
        started_at: run.startedAt,
        finished_at: plusMinutes(run.startedAt, (run.durationMs ?? 0) / 60_000),
        duration_ms: run.durationMs ?? null,
        parent_run_id: null,
        replay_of_run_id: null,
        correlation_id: uuidFor(childKey(run.id, "correlation", 1)),
        action_request_id: approval ? uuidFor(actionRequestKey(approval.id)) : null,
        acknowledged_at: null,
        acknowledged_by: null,
        redacted_at: null,
        created_at: run.startedAt,
      };
    }),
  });

/**
 * Run nodes.
 *
 * Two shapes of run in one table. run_4821 carries the §17 execution TREE —
 * an orchestrator, four sub-agents and the tool that halted — and its nodes go
 * in as they stand. The other runs carry a flat list of tool `steps` instead,
 * and those become TOOL nodes keyed by the tool name: a step IS a node of kind
 * TOOL, and dropping them would lose the retry on run_4930 and the
 * WA_TEMPLATE_REJECTED failure on run_4903, which are the two things those runs
 * exist to show.
 *
 * `started_at` is the RUN's start on every node: the fixture world times each
 * node's duration and never its start, and staggering them by their durations
 * would invent an ordering the trace does not claim. `duration_ms` carries the
 * real number, and `finished_at` stays NULL rather than being back-computed
 * from a start that is not the node's own.
 */
const runNodeRows = (): Row[] =>
  fx.runs.flatMap((run): Row[] => {
    const nodes = run.nodes ?? [];
    if (nodes.length > 0) {
      return nodes.map((node, index) => ({
        id: uuidFor(childKey(run.id, "node", node.id)),
        tenant_id: TENANT_UUID,
        run_id: uuidFor(run.id),
        node_key: node.id,
        parent_node_id: node.parentId ? uuidFor(childKey(run.id, "node", node.parentId)) : null,
        seq: index,
        kind: node.kind,
        name: node.name,
        tier: node.tier ?? null,
        model: node.model ?? null,
        provider: node.provider ?? null,
        tokens_in: node.tokens?.in ?? null,
        tokens_out: node.tokens?.out ?? null,
        cache_hit_rate: node.cacheHitRate ?? null,
        cost_sen: node.cost?.amount ?? 0,
        status: node.status ?? null,
        retries: node.retries ?? 0,
        duration_ms: node.durationMs ?? null,
        args: j(null),
        result: j(null),
        error: j(null),
        halted_by: j(node.haltedBy ?? null),
        started_at: run.startedAt,
        finished_at: null,
        created_at: run.startedAt,
      }));
    }
    return (run.steps ?? []).map((step) => ({
      id: uuidFor(childKey(run.id, "node", step.tool)),
      tenant_id: TENANT_UUID,
      run_id: uuidFor(run.id),
      node_key: step.tool,
      parent_node_id: null,
      seq: step.seq,
      kind: "TOOL",
      name: step.tool,
      tier: null,
      model: null,
      provider: null,
      tokens_in: null,
      tokens_out: null,
      cache_hit_rate: null,
      cost_sen: step.cost?.amount ?? 0,
      status: step.status ?? null,
      retries: step.retries ?? 0,
      duration_ms: step.durationMs ?? null,
      args: j(step.args ?? null),
      result: j(step.result ?? null),
      error: j(step.error ?? null),
      halted_by: j(step.haltedBy ?? null),
      started_at: run.startedAt,
      finished_at: null,
      created_at: run.startedAt,
    }));
  });

const runNodesSql = (): string =>
  upsert({
    table: "core.run_nodes",
    conflict: ["tenant_id", "run_id", "node_key"],
    frozen: ["parent_node_id", "seq", "kind", "started_at", "created_at"],
    note: "The execution tree where the fixture gives one, the tool list where it gives that instead.",
    rows: runNodeRows(),
  });

/**
 * Tool snapshots for run_4821.
 *
 * `core.run_snapshots` is the captured tool response a replay reads instead of
 * calling out again, keyed by tool name and a hash of the arguments. run_4821
 * is the one run whose `nodes` and `steps` are different views of the same
 * work: its nodes are above, and its six tool `steps` — the arguments and the
 * responses — would otherwise have no home. `args_hash` is SHA-256 over the
 * canonical JSON of `args`, which is the CHECK's shape and the only thing the
 * column can honestly be.
 *
 * The other runs' steps ARE their nodes, so they are not snapshotted twice.
 * `send_proposal` halted and returned nothing, and `response` is NOT NULL, so
 * five of the six steps land.
 */
const runSnapshotsSql = (): string => {
  const run = fx.runs.find((candidate) => candidate.id === "run_4821");
  const rows = (run?.steps ?? [])
    .filter((step) => step.args && step.result)
    .map((step) => ({
      id: uuidFor(childKey(run!.id, "snapshot", step.tool)),
      tenant_id: TENANT_UUID,
      run_id: uuidFor(run!.id),
      tool_name: step.tool,
      args_hash: sha256Hex(canonical(step.args)),
      args: j(step.args),
      response: j(step.result),
      captured_at: run!.startedAt,
      created_at: run!.startedAt,
    }));
  return upsert({
    table: "core.run_snapshots",
    conflict: ["tenant_id", "run_id", "tool_name", "args_hash"],
    frozen: ["args", "response", "captured_at", "created_at"],
    note: "run_4821's tool calls and what came back, for replay. Every column is frozen, so this is an append.",
    rows,
  });
};

/**
 * The state card.
 *
 * Only run_4821 carries one. `budgets.cost` is `{ used: Money, limit: Money }`
 * in the fixture and `app.is_valid_state_card_budgets` requires numbers, so the
 * two Money objects become their integer sen — the same convention every other
 * money column in the schema uses.
 */
const runStateCardsSql = (): string => {
  const rows = fx.runs
    .filter((run) => run.stateCard)
    .map((run) => {
      const card = run.stateCard!;
      return {
        id: uuidFor(childKey(run.id, "state_card", 1)),
        tenant_id: TENANT_UUID,
        run_id: uuidFor(run.id),
        version: 1,
        goal: card.goal,
        plan: j(card.plan),
        decisions: arr(card.decisions),
        constraints: arr(card.constraints),
        record_pointers: arr(card.recordPointers),
        open_questions: arr(card.openQuestions),
        budgets: j({
          tokens: card.budgets.tokens,
          cost: { used: card.budgets.cost.used.amount, limit: card.budgets.cost.limit.amount },
        }),
        created_at: run.startedAt,
      };
    });
  return upsert({
    table: "core.run_state_cards",
    conflict: ["tenant_id", "run_id", "version"],
    frozen: ["created_at"],
    note: "run_4821's state card — the goal, the plan and the budget it was working inside when it halted.",
    rows,
  });
};

/**
 * Run events.
 *
 * `app.is_valid_run_event_detail` validates the detail per event type, and two
 * of run_4821's six events do not satisfy it:
 *
 *   • JURY needs `mode`, which agents.ts:497 omits. It is supplied from the
 *     agent's OWN jury policy — `agent_proposal.jury.mode` is ESCALATE and so
 *     is the PROPOSAL_SEND routing row's, and the event's `quorum: 2, of: 3`
 *     matches both. That is a derivation from the fixture, not a new fact.
 *   • HANDOFF needs `checkpointStep`, which agents.ts:522 omits — it carries
 *     `atContextPct` and `restartedNodes`. The run's only checkpoint is taken
 *     at 09:14:12, two seconds AFTER the handoff at 09:14:10, so no checkpoint
 *     existed to hand off from and there is nothing honest to put in the
 *     column. The event is dropped and `restartedNodes: ["n3"]` is lost with
 *     it. See the PR's schema-gap list.
 *
 * `seq` numbers the surviving events in time order, which is the order the
 * trace rail renders; the fixture array is grouped by type instead.
 */
type RunEventDetail = Record<string, unknown>;

const runEventDetail = (
  run: FixtureRun,
  type: string,
  detail: RunEventDetail,
): RunEventDetail | null => {
  if (type === "HANDOFF") return null;
  if (type === "JURY") {
    const agent = fx.agents.find((candidate) => candidate.id === run.agentId);
    return { mode: (agent?.jury as FixtureJury | undefined)?.mode ?? "ESCALATE", ...detail };
  }
  return detail;
};

const runEventRows = () =>
  fx.runs.flatMap((run) => {
    const ordered = [...(run.events ?? [])].sort((a, b) =>
      (a.at ?? "") === (b.at ?? "") ? 0 : (a.at ?? "") < (b.at ?? "") ? -1 : 1,
    );
    let seq = 0;
    return ordered.flatMap((event) => {
      const detail = runEventDetail(run, event.type, event.detail as RunEventDetail);
      if (!detail) return [];
      const row = {
        id: uuidFor(childKey(run.id, "event", `${event.type}:${event.at}`)),
        tenant_id: TENANT_UUID,
        run_id: uuidFor(run.id),
        seq,
        type: event.type,
        node_key: typeof detail.node === "string" ? detail.node : null,
        detail: j(detail),
        at: event.at,
        created_at: event.at,
      };
      seq += 1;
      return [row];
    });
  });

const runEventsSql = (): string =>
  upsert({
    table: "core.run_events",
    conflict: ["tenant_id", "run_id", "seq"],
    // Every column this table has beyond its natural key is immutable, so the
    // statement is an append: a re-run inserts nothing and updates nothing.
    frozen: ["id", "type", "node_key", "detail", "at", "created_at"],
    note: "Escalation, truncation, jury, checkpoint and the policy halt, in time order.",
    rows: runEventRows(),
  });

/**
 * Checkpoints.
 *
 * `run_checkpoints_card_fk` is a composite FK into
 * `core.run_state_cards (tenant_id, run_id, version)`, so a checkpoint needs a
 * state card at the version it names. run_4821 has one. run_4930 also emits a
 * CHECKPOINT event (step 2) but carries no state card, so its checkpoint cannot
 * be written — see the PR's schema-gap list.
 *
 * `cursor` needs `nodeKey` and `step`. The event names the step; it names no
 * node, and the validator admits a null `nodeKey`, so that is what it gets.
 */
const runCheckpointsSql = (): string => {
  const rows = fx.runs
    .filter((run) => run.stateCard)
    .flatMap((run) =>
      (run.events ?? [])
        .filter((event) => event.type === "CHECKPOINT")
        .map((event) => {
          const detail = event.detail as { step: number; replayable: boolean };
          return {
            id: uuidFor(childKey(run.id, "checkpoint", detail.step)),
            tenant_id: TENANT_UUID,
            run_id: uuidFor(run.id),
            step: detail.step,
            node_key: null,
            state_card_version: 1,
            cursor: j({ nodeKey: null, step: detail.step }),
            replayable: detail.replayable,
            created_at: event.at,
          };
        }),
    );
  return upsert({
    table: "core.run_checkpoints",
    conflict: ["tenant_id", "run_id", "step"],
    frozen: ["node_key", "state_card_version", "cursor", "created_at"],
    note: "run_4821's replayable checkpoint at step 4, against version 1 of its state card.",
    rows,
  });
};

// ── Knowledge ────────────────────────────────────────────────────────────────

/**
 * Knowledge sources.
 *
 * `ref` is written out rather than allocated, and derived from the fixture's
 * own id: `src_0219` is SRC-0219. The numeric part of the fixture key IS the
 * reference number — `DOCUMENT_CIRCULAR_09` is `DOC-0219` for the same source —
 * so this is a transcription, not a new numbering.
 *
 * `quarantined` is derived: `ks_changed_is_quarantined` requires a
 * CHANGED_REVIEW_PENDING source to be quarantined, and knowledge.ts:30 says
 * exactly that in prose — changed means quarantined from rule extraction while
 * still searchable.
 *
 * `core.knowledge_chunks` is NOT written. The fixture gives chunk COUNTS (142,
 * 118, 64, 0, 87, 203) and no chunk text, and `content` is NOT NULL. Six
 * hundred and fourteen rows of invented prose would be worse than none, and
 * the count itself is a real fixture value that lands in `chunk_count`.
 */
const knowledgeSourcesSql = (): string =>
  upsert({
    table: "core.knowledge_sources",
    conflict: ["id"],
    frozen: ["ref", "created_at"],
    note: [
      "Six sources: one changed and quarantined, one still embedding, one whose fetch",
      "-- has been failing since 07 Nov. `chunk_count` is the fixture's count; the chunks",
      "-- themselves are not in the fixture world and are not invented here.",
    ].join("\n"),
    rows: fx.knowledgeSources.map((source) => ({
      id: uuidFor(source.id),
      tenant_id: TENANT_UUID,
      ref: `SRC-${source.id.replace(/^src_/, "")}`,
      name: source.name,
      source_type: source.type,
      version: source.version,
      uri: null,
      attachment_id: null,
      ingested_at: source.ingestedAt ?? null,
      chunk_count: source.chunks,
      embedding_status: source.embeddingStatus,
      last_checked_at: source.lastCheckedAt ?? null,
      monitor_status: source.monitorStatus,
      content_hash: source.contentHash ?? null,
      retrieval_scopes: arr(source.retrievalScopes, "core.retrieval_scope"),
      quarantined: source.monitorStatus === "CHANGED_REVIEW_PENDING",
      archived_at: null,
      created_at: source.ingestedAt ?? fx.NOW,
      // The monitor ingests these, not a person.
      ...actorColumns(fx.SCHEDULER_ACTOR),
    })),
  });

// ── Metrics and hours saved ──────────────────────────────────────────────────

/**
 * Metric definitions.
 *
 * One row per metric the dashboard and the record screens can ask for, built
 * from `executiveMetrics` (tenant scope) and the scoped entries in
 * `metricResponses`. `value_kind` is read off the metric's own value: a §1
 * Money is MONEY, hours saved is a DURATION, everything else the fixture
 * publishes is a COUNT. `is_estimate` and `formula` are the fixture's own —
 * DECISIONS §4 requires the hours-saved tile to say it is illustrative, and
 * that flag lives here.
 */
type MetricSeed = {
  key: string;
  label: string;
  scope: string;
  valueKind: string;
  formula?: string | null;
  isEstimate?: boolean;
  drillTo?: string | null;
  comparePeriod?: string | null;
};

const metricSeeds = (): MetricSeed[] => {
  const isMoney = (value: unknown): boolean =>
    typeof value === "object" && value !== null && "amount" in (value as object);
  const tenantMetrics: MetricSeed[] = fx.executiveMetrics.map((metric) => ({
    key: metric.key,
    label: metric.label,
    scope: "TENANT",
    valueKind: isMoney(metric.value)
      ? "MONEY"
      : metric.key === "ADMIN_HOURS_SAVED"
        ? "DURATION"
        : "COUNT",
    formula: metric.formula ?? null,
    isEstimate: metric.estimate ?? false,
    drillTo: metric.drillTo ?? null,
    comparePeriod: metric.delta?.comparedTo ?? null,
  }));
  // The scoped metrics are keyed `KEY::scope::id`; the id is the record the
  // screen happened to ask about and is not part of the definition.
  const scoped: MetricSeed[] = Object.entries(fx.metricResponses)
    .filter(([key]) => key.includes("::"))
    .map(([key, response]) => {
      const [metricKey, scope] = key.split("::");
      return {
        key: metricKey!,
        label: humanise(metricKey!),
        scope: scope!,
        valueKind: isMoney(response.value) ? "MONEY" : "COUNT",
        formula: null,
        isEstimate: false,
        drillTo: response.drillTo ?? null,
        comparePeriod: response.delta?.comparedTo ?? null,
      };
    });
  const seen = new Set<string>();
  return [...tenantMetrics, ...scoped].filter((metric) => {
    const key = `${metric.key}::${metric.scope}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const metricDefinitionsSql = (): string =>
  upsert({
    table: "core.metric_definitions",
    conflict: ["tenant_id", "metric_key", "scope"],
    frozen: ["created_at"],
    note: "Every metric cell is self-describing and carries its own drill route — this is the row it reads.",
    rows: metricSeeds().map((metric) => ({
      id: uuidFor(childKey("metric", metric.scope, metric.key)),
      tenant_id: TENANT_UUID,
      metric_key: metric.key,
      label: metric.label,
      scope: metric.scope,
      value_kind: metric.valueKind,
      formula: metric.formula ?? null,
      is_estimate: metric.isEstimate ?? false,
      drill_to_template: metric.drillTo ?? null,
      sql_source: null,
      compare_period: metric.comparePeriod ?? null,
      created_at: fx.NOW,
    })),
  });

/**
 * The hours-saved baseline.
 *
 * DECISIONS §4: the basis is ILLUSTRATIVE until the time-and-motion sampling
 * produces a measured table, which is why `signed_off_by_user_id` is NULL —
 * `hours_saved_measured_needs_signoff` demands a sign-off only for MEASURED,
 * and signing off an illustrative table would be the exact claim the ruling
 * forbids.
 *
 * `effective_from` is a date the fixture does not give. The report is served
 * for period 2026-11, so the table takes effect at the start of it.
 *
 * `humanMinutes` and `credited` have no columns: the first is a per-run
 * measurement that belongs with the runs, the second is the OUTPUT of the
 * formula this table is the input to. Storing a credited figure next to the
 * baseline that produces it would be two answers to one question. See the PR's
 * schema-gap list.
 */
const HOURS_SAVED_VERSION = fx.hoursSaved.baselineTableVersion;

const hoursSavedTableSql = (): string =>
  upsert({
    table: "core.hours_saved_baseline_tables",
    conflict: ["tenant_id", "version"],
    frozen: ["created_at"],
    note: "Illustrative until measured, with the 0.7 haircut DECISIONS §4 requires.",
    rows: [
      {
        id: uuidFor(`hours_saved_table:${HOURS_SAVED_VERSION}`),
        tenant_id: TENANT_UUID,
        version: HOURS_SAVED_VERSION,
        basis: fx.hoursSaved.basis,
        haircut: fx.hoursSaved.haircut,
        effective_from: "2026-11-01",
        signed_off_by_user_id: null,
        signed_off_at: null,
        created_at: fx.NOW,
      },
    ],
  });

const hoursSavedBaselinesSql = (): string =>
  upsert({
    table: "core.hours_saved_baselines",
    conflict: ["tenant_id", "baseline_table_id", "action_type"],
    frozen: ["created_at"],
    note: [
      "Four of the report's five action types. PROPOSAL_DRAFT is dropped for the same",
      "-- reason as its routing row: app.action_types has no key for it.",
    ].join("\n"),
    rows: fx.hoursSaved.actionTypes
      .filter((entry) => knownActionType(entry.key))
      .map((entry) => ({
        id: uuidFor(childKey(HOURS_SAVED_VERSION, "baseline", entry.key)),
        tenant_id: TENANT_UUID,
        baseline_table_id: uuidFor(`hours_saved_table:${HOURS_SAVED_VERSION}`),
        action_type: entry.key,
        baseline_minutes: entry.baselineMinutes,
        sample_size: null,
        credited: true,
        created_at: fx.NOW,
      })),
  });

// ── The slice ────────────────────────────────────────────────────────────────

export const slice04: Slice = {
  file: "fixture_world_04_ai_ops_and_agents.sql",
  title: "Agents, routing, budgets, runs, approvals and knowledge",
  tables: [
    "core.tier_keys",
    "core.model_tiers",
    "core.agents",
    "core.autonomy_grants",
    "core.evals",
    "core.routing_matrix_versions",
    "core.routing_entries",
    "core.jury_configs",
    "core.ai_provider_keys",
    "core.ai_budgets",
    "app.usage_rollup",
    "core.action_requests",
    "core.approval_requests",
    "core.runs",
    "core.run_nodes",
    "core.run_snapshots",
    "core.run_state_cards",
    "core.run_events",
    "core.run_checkpoints",
    "core.knowledge_sources",
    "core.metric_definitions",
    "core.hours_saved_baseline_tables",
    "core.hours_saved_baselines",
  ],
  /**
   * Nothing is suspended.
   *
   * None of this slice's tables has a state gate: `core.state_transitions`
   * holds no edges for agents, runs, approvals or knowledge sources, and
   * `app.enforce_state_transition` is not attached to any of them. The freeze
   * triggers that ARE attached — `app.enforce_immutable_columns` on every table
   * here — are satisfied rather than disabled: every column they name is listed
   * in its statement's `frozen`, so a re-run never attempts to change one.
   *
   * Two guards are named in the brief and both stay live. `app.mask_run_io` is
   * moot because `core.run_node_io` is not written — the fixture world carries
   * tool arguments and results, never prompts or completions. And
   * `app.enforce_autonomy_ceiling` on `core.autonomy_grants` is the point of
   * the launch matrix, so it stays on and every grant is checked against it.
   */
  suspendTriggers: [],
  emit: () =>
    block(
      banner("Model tiers and routing configuration"),
      tierKeysSql(),
      modelTiersSql(),
      banner("The agent fleet"),
      agentsSql(),
      autonomyGrantsSql(),
      evalsSql(),
      banner("Routing matrix and juries"),
      routingVersionSql(),
      routingEntriesSql(),
      juryConfigsSql(),
      banner("Provider keys, budgets and usage"),
      providerKeysSql(),
      budgetsSql(),
      usageRollupSql(),
      banner("Action envelopes and approvals"),
      actionRequestsSql(),
      approvalRequestsSql(),
      actionRequestBackfillSql(),
      banner("Runs"),
      runsSql(),
      runNodesSql(),
      runSnapshotsSql(),
      runStateCardsSql(),
      runEventsSql(),
      runCheckpointsSql(),
      banner("Knowledge"),
      knowledgeSourcesSql(),
      banner("Metrics and hours saved"),
      metricDefinitionsSql(),
      hoursSavedTableSql(),
      hoursSavedBaselinesSql(),
    ),
};
