/**
 * Slice 3 — delivery, compliance and finance.
 *
 * The heavy end of the fixture world: ten engagements, their cohorts, the
 * attendance that was actually taken, the HRD Corp packets built on top of it,
 * and the money.
 *
 * Three things shape almost every decision in this file.
 *
 * **The fixture world is finished, the schema's front door is not.** A
 * DELIVERED engagement, a PAID invoice and a LOCKED attendance day are all
 * states `app.enforce_state_transition` will only admit through an executing
 * `core.action_requests` row. The seed has no such rows and should not invent
 * hundreds of them, so `suspendTriggers` below takes the gates down for the
 * length of this file. It takes down nothing else: the invoice recalculation
 * triggers, the payment application trigger and the deferred reconciliation
 * constraint all stay live, and every total in here is a real test of them.
 *
 * **Slice 2 has not run.** Opportunities, proposals, quotations and templates
 * belong to it. Every pointer into one of those is left NULL here rather than
 * satisfied by writing a row this slice does not own — see the PR's cross-slice
 * list for which columns those are.
 *
 * **Where the fixture is silent the row is left out, not filled in.** Trainer
 * bookings, availability, signatures, credit notes and the tenant tax profile
 * have no fixture source at all, and a plausible-looking invented row is worse
 * than a missing one. They are in the PR's gap list instead of in this file.
 */

import * as fx from "../../src/data/index.ts";
import { TENANT_UUID, childKey, uuidFor } from "../lib/ids.ts";
import { refUuid } from "../lib/refs.ts";
import type { Slice } from "../lib/slice.ts";
import { arr, banner, block, j, raw, upsert } from "../lib/sql.ts";
import { actorColumns } from "./01-tenant-and-parties.ts";

/* ------------------------------------------------------------------ *
 * Shared derivations
 * ------------------------------------------------------------------ */

/**
 * A fixture `DateOnly` as an instant.
 *
 * Half the fixture world's timestamps are plain dates — a lifecycle step "at",
 * a certificate issue date, a grant approval — and every timestamptz column
 * needs an instant. `Asia/Kuala_Lumpur` is the tenant's timezone, so midnight
 * there is what the date means to the people who typed it. Letting Postgres
 * resolve a bare date against the SERVER's timezone would make the emitted seed
 * land on a different instant depending on where it runs.
 */
const TZ = "+08:00";
const startOfDay = (date: string): string => `${date}T00:00:00${TZ}`;

/** `2026-10-10` plus n days, as a date. Used for the collections clock. */
const addDays = (date: string, days: number): string => {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
};

type Engagement = (typeof fx.engagements)[number];

const engagementByRef = new Map(fx.engagements.map((engagement) => [engagement.ref, engagement]));

const engagementUuid = (ref: string): string => refUuid(ref);

/** The one ENGAGEMENT pipeline slice 1 wrote; its steps are keyed by stage. */
const ENGAGEMENT_PIPELINE = "pipeline:ENGAGEMENT";
const stepUuid = (stageKey: string): string =>
  uuidFor(childKey(ENGAGEMENT_PIPELINE, "step", stageKey));

/**
 * `core.engagements.venue_mode`, read off the venue string.
 *
 * The fixture world names venues rather than classifying them, but it does
 * classify one of them by accident: INV-2026-0279 bills "Venue hire · own
 * venue" against ENG-0228, whose venue is "Akademi Perdana, Petaling Jaya".
 * Everything else in the set is the client's own address.
 */
const venueMode = (venue: string): string =>
  venue.startsWith("Akademi Perdana") ? "OWN_VENUE" : "CLIENT_SITE";

/**
 * The grant-side pin: which rule set was in force when the grant was submitted.
 *
 * `engagements_grant_pin_pair` is all-or-nothing — a version without a date is
 * refused — so an engagement is pinned only where the fixture world actually
 * says when the grant went in. That is the compliance record's own
 * `ruleResolution.grantSide.asOf` where there is one, and the claim packet's
 * `grant.submittedAt` otherwise. Three engagements publish a `ruleSetVersion`
 * with neither; they go in unpinned rather than with a date chosen here.
 */
const grantPinnedOn = (engagementRef: string): string | null => {
  const checks = (fx.complianceChecks as Record<string, { ruleResolution?: { grantSide?: { asOf?: string | null } } }>)[engagementRef];
  const asOf = checks?.ruleResolution?.grantSide?.asOf;
  if (asOf) return startOfDay(asOf);
  const packet = fx.claimPackets.find((entry) => entry.engagementRef === engagementRef);
  return packet?.grant?.submittedAt ?? null;
};

/* ------------------------------------------------------------------ *
 * Engagements and their lifecycle
 * ------------------------------------------------------------------ */

const engagementsSql = (): string =>
  upsert({
    table: "core.engagements",
    conflict: ["id"],
    frozen: ["ref", "created_at"],
    note: [
      "Ten engagements. ENG-0259 is the in-flight Aurora deal the reviewer opens first:",
      "-- PROPOSED, every lifecycle step still PENDING, and the approval stage waiting.",
      "-- `opportunity_id` and `proposal_id` are NULL throughout: both point into slice 2,",
      "-- which owns those tables. ENG-0231 and ENG-0251 carry an `opportunityRef` in the",
      "-- fixtures that this slice cannot resolve without writing a table it does not own.",
    ].join("\n"),
    rows: fx.engagements.map((engagement) => {
      const pinnedAt = engagement.ruleSetVersion ? grantPinnedOn(engagement.ref) : null;
      return {
        id: uuidFor(engagement.id),
        tenant_id: TENANT_UUID,
        ref: engagement.ref,
        organisation_id: refUuid(engagement.organisationRef),
        opportunity_id: null,
        proposal_id: null,
        programme_id: refUuid(engagement.programmeRef),
        owner_id: uuidFor(engagement.owner.id),
        pipeline_id: uuidFor(ENGAGEMENT_PIPELINE),
        title: engagement.title,
        status: engagement.status,
        venue: engagement.venue ?? null,
        venue_mode: engagement.venue ? venueMode(engagement.venue) : null,
        value_sen: engagement.value?.amount ?? null,
        currency: engagement.value?.currency ?? "MYR",
        grant_rule_set_version_id: pinnedAt ? uuidFor(engagement.ruleSetVersion!) : null,
        grant_pinned_at: pinnedAt,
        starts_on: engagement.dates?.[0] ?? null,
        ends_on: engagement.dates?.[engagement.dates.length - 1] ?? null,
        // CLOSED is the only status that means "nothing more will happen to this
        // record", and the engagement's own updatedAt is when that became true.
        closed_out_at: engagement.status === "CLOSED" ? engagement.updatedAt : null,
        created_at: engagement.createdAt,
        ...actorColumns(engagement.createdBy),
      };
    }),
  });

const stepStatesSql = (): string =>
  upsert({
    table: "core.engagement_step_states",
    conflict: ["tenant_id", "engagement_id", "pipeline_step_id"],
    frozen: ["created_at"],
    note: [
      "The lifecycle stepper, one row per stage per engagement.",
      "-- Stage names and order live in core.pipeline_steps (slice 1); this table says only",
      "-- where each engagement has got to. ENG-0231's HRDC_CLAIM is BLOCKED because",
      "-- CHK_DOCS_COMPLETE fails below, not because a document count says so.",
    ].join("\n"),
    rows: fx.engagements.flatMap((engagement) =>
      engagement.lifecycle.map((step) => ({
        id: uuidFor(childKey(engagement.id, "step", step.key)),
        tenant_id: TENANT_UUID,
        engagement_id: uuidFor(engagement.id),
        pipeline_step_id: stepUuid(step.key),
        state: step.state,
        at: step.at ? startOfDay(step.at) : null,
        note: step.note ?? null,
        target_ref: step.ref ?? null,
        created_at: engagement.createdAt,
      })),
    ),
  });

/**
 * The delivery checklist.
 *
 * `eci_done_pair` refuses a ticked item with no timestamp, and the fixture
 * world records only the tick. `done_at` is therefore the engagement's own
 * `updatedAt` — the latest instant at which any of its checklist could have
 * been ticked, which is the most the fixture actually supports. The alternative
 * was to drop every ticked item, which would have inverted what the screen says
 * about seven of the eight engagements that have a checklist at all. See the
 * PR's gap list: the fixture wants a per-item `doneAt`.
 */
const checklistSql = (): string =>
  upsert({
    table: "core.engagement_checklist_items",
    conflict: ["tenant_id", "engagement_id", "item_key"],
    frozen: ["created_at"],
    rows: fx.engagements.flatMap((engagement) =>
      engagement.checklist.map((item) => ({
        id: uuidFor(childKey(engagement.id, "checklist", item.key)),
        tenant_id: TENANT_UUID,
        engagement_id: uuidFor(engagement.id),
        item_key: item.key,
        label: item.label,
        done: item.done,
        done_at: item.done ? engagement.updatedAt : null,
        // The fixture names no person against a checklist tick, only that it
        // happened. Nullable, so it stays null rather than guessing the owner.
        done_by_user_id: null,
        created_at: engagement.createdAt,
      })),
    ),
  });

/**
 * Who is on each engagement.
 *
 * `metrics.trainer` is the engagement's own published answer to that question,
 * including on the two cancelled deals where the stage was never reached — the
 * record still names them, and the pool screen reads this table. Written BEFORE
 * `core.sessions`, because `core.sync_engagement_trainers` inserts a bare
 * (engagement, trainer, LEAD) row on every session insert and would otherwise
 * win the `assigned_at` this file is trying to state.
 */
const engagementTrainersSql = (): string =>
  upsert({
    table: "core.engagement_trainers",
    conflict: ["tenant_id", "engagement_id", "trainer_id"],
    frozen: ["created_at"],
    rows: fx.engagements
      .filter((engagement) => Boolean(engagement.metrics?.trainer?.ref))
      .map((engagement) => {
        const confirmed = engagement.lifecycle.find((step) => step.key === "TRAINER_CONFIRMED");
        return {
          id: uuidFor(childKey(engagement.id, "trainer", engagement.metrics!.trainer!.ref)),
          tenant_id: TENANT_UUID,
          engagement_id: uuidFor(engagement.id),
          trainer_id: refUuid(engagement.metrics!.trainer!.ref),
          role: "LEAD",
          // The TRAINER_CONFIRMED step's own date where the stage was reached;
          // the engagement's creation otherwise, which is the earliest the
          // assignment can have existed.
          assigned_at: confirmed?.at ? startOfDay(confirmed.at) : engagement.createdAt,
          created_at: engagement.createdAt,
        };
      }),
  });

/**
 * Sessions.
 *
 * Only ENG-0231 has them; every other engagement carries `sessions: []`, and a
 * delivered cohort with attendance but no session rows is what the fixture
 * world says, not an omission here. `present`/`total` on the fixture session
 * have no columns — the attendance entries below are where that count comes
 * from — and `starts_at`/`ends_at` stay NULL because the fixture gives a date
 * and no times.
 */
const sessionsSql = (): string =>
  upsert({
    table: "core.sessions",
    conflict: ["id"],
    frozen: ["ref", "created_at"],
    rows: fx.engagements.flatMap((engagement) =>
      (engagement.sessions ?? []).map((session) => ({
        id: uuidFor(childKey(engagement.id, "session", session.ref)),
        tenant_id: TENANT_UUID,
        ref: session.ref,
        engagement_id: uuidFor(engagement.id),
        trainer_id: session.trainerRef ? refUuid(session.trainerRef) : null,
        day: session.day,
        on_date: session.date,
        title: session.title ?? null,
        venue: session.venue ?? null,
        starts_at: null,
        ends_at: null,
        created_at: engagement.createdAt,
        ...actorColumns(engagement.createdBy),
      })),
    ),
  });

/* ------------------------------------------------------------------ *
 * Participants and attendance
 * ------------------------------------------------------------------ */

const participantsSql = (): string =>
  upsert({
    table: "core.participants",
    conflict: ["id"],
    frozen: ["ref", "created_at"],
    note: [
      "136 participants across the five cohorts that have actually run.",
      "-- `contact_id` is NULL throughout: a participant is a name on a roster, and the",
      "-- fixture world never claims one of them is also a core.contacts row.",
      "-- Identity numbers are not in the fixture world at all, so the hash and last-four",
      "-- columns stay NULL rather than carrying an invented NRIC.",
    ].join("\n"),
    rows: fx.participants.map((participant) => ({
      id: uuidFor(participant.id),
      tenant_id: TENANT_UUID,
      ref: participant.ref,
      engagement_id: engagementUuid(participant.engagementRef),
      contact_id: null,
      name: participant.name,
      department: participant.department ?? null,
      email: participant.email ?? null,
      identity_no_hash: null,
      identity_no_last4: null,
      registered_at: participant.createdAt,
      withdrawn_at: null,
      redacted_at: null,
      created_at: participant.createdAt,
      ...actorColumns(participant.createdBy),
    })),
  });

type Sheet = (typeof fx.attendanceSheets)[string];

/** The ten sheets, in a stable order: engagement in fixture order, then day. */
const sheets = (): { key: string; sheet: Sheet }[] =>
  fx.engagements.flatMap((engagement) =>
    [1, 2]
      .map((day) => ({ key: `${engagement.ref}::${day}`, sheet: fx.attendanceSheets[`${engagement.ref}::${day}`] }))
      .filter((entry): entry is { key: string; sheet: Sheet } => Boolean(entry.sheet)),
  );

/**
 * Attendance days.
 *
 * Nine of the ten are LOCKED and immutable; ENG-0231 day 2 is the one still
 * PENDING_APPROVAL, which is what APV-2026-0774 decides. Three CHECKs make the
 * fixture's own invariants the database's — `ad_immutable_tracks_status`,
 * `ad_locked_disables_capture` and `ad_locked_needs_approver` — and the fixture
 * satisfies all three without help, which is why `immutable` and the three
 * capture flags are written from it rather than derived.
 *
 * `approved_by_id` is text and holds the fixture's own actor id verbatim: for
 * ENG-0231 that is the user `t_farah`, for the four cohorts it is the trainer
 * REFERENCE their sheet names. Neither is a foreign key, and normalising one
 * into the other would be inventing a fact about who pressed the button.
 */
const attendanceDaysSql = (): string =>
  upsert({
    table: "core.attendance_days",
    conflict: ["tenant_id", "engagement_id", "day"],
    frozen: ["created_at"],
    rows: sheets().map(({ sheet }) => ({
      id: uuidFor(childKey(`eng:${sheet.engagementRef}`, "attendance", sheet.day)),
      tenant_id: TENANT_UUID,
      engagement_id: engagementUuid(sheet.engagementRef),
      day: sheet.day,
      on_date: sheet.date,
      status: sheet.status,
      immutable: sheet.immutable,
      approved_by_kind: sheet.approvedBy?.kind ?? null,
      approved_by_id: sheet.approvedBy?.id ?? null,
      approved_by_name: sheet.approvedBy?.name ?? null,
      approved_at: sheet.approvedAt ?? null,
      capture_qr: sheet.captureModes.qr,
      capture_signature: sheet.captureModes.signature,
      capture_manual: sheet.captureModes.manual,
      unlocked_at: null,
      unlock_reason: null,
      unlock_count: 0,
      // The day exists from the moment the sheet does; the fixture's own
      // approval instant is the only timestamp it carries, so an unapproved day
      // takes the engagement's clock instead.
      created_at: sheet.approvedAt ?? startOfDay(sheet.date),
      ...actorColumns(sheet.approvedBy ?? { id: "system", kind: "SYSTEM" }),
    })),
  });

/**
 * Attendance entries — 544 of them, one per participant per half-day.
 *
 * `signature_id` is NULL on every row. The fixture rows carry a `signatureRef`,
 * but `core.signatures` needs a `signer_name`, a `signed_at` and a `method`
 * constrained to DRAWN/TYPED/CLICKWRAP, and the only one of those the fixture
 * world supplies is the name. Capture happened by QR, which is not a signature
 * method. Rather than mint 544 signature rows around one honest column, the
 * signatures stay unseeded — see the PR's gap list.
 */
const attendanceEntriesSql = (): string =>
  upsert({
    table: "core.attendance_entries",
    conflict: ["tenant_id", "attendance_day_id", "participant_id", "half"],
    frozen: ["created_at"],
    rows: sheets().flatMap(({ sheet }) =>
      sheet.rows.flatMap((row) =>
        (["AM", "PM"] as const).map((half) => {
          const mark = half === "AM" ? row.am : row.pm;
          const dayId = uuidFor(childKey(`eng:${sheet.engagementRef}`, "attendance", sheet.day));
          return {
            id: uuidFor(childKey(`${dayId}:${row.participantRef}`, "entry", half)),
            tenant_id: TENANT_UUID,
            attendance_day_id: dayId,
            participant_id: refUuid(row.participantRef),
            half,
            present: mark.present,
            marked_at: mark.present ? mark.at : null,
            method: mark.present ? mark.method : null,
            absence_reason: mark.present ? null : mark.reason,
            signature_id: null,
            created_at: sheet.approvedAt ?? startOfDay(sheet.date),
            ...actorColumns(sheet.approvedBy ?? { id: "system", kind: "SYSTEM" }),
          };
        }),
      ),
    ),
  });

/**
 * Certificates — 78, one per participant who carries a `certificateId`.
 *
 * The fixture's `CERT-2026-0189-01` is the number PRINTED on the document, so
 * it lands in `serial`, which is unique per tenant and is what an auditor
 * quotes. `ref` is the tenant-side reference in the house CRT format, minted
 * here in issue order rather than left to `core.assign_ref`: a generated ref
 * would advance `core.ref_sequences` on every re-run of this file, including
 * the runs that insert nothing.
 *
 * `template_id` is NULL because `core.templates` belongs to slice 2.
 */
const certificatesSql = (): string => {
  const holders = fx.participants.filter((participant) => Boolean(participant.certificateId));
  return upsert({
    table: "core.certificates",
    conflict: ["tenant_id", "participant_id", "engagement_id"],
    frozen: ["ref", "created_at"],
    rows: holders.map((participant, index) => {
      const issuedOn = (participant as { certificateIssuedAt?: string | null }).certificateIssuedAt;
      return {
        id: uuidFor(childKey(participant.id, "certificate", participant.certificateId!)),
        tenant_id: TENANT_UUID,
        ref: `CRT-2026-${String(index + 1).padStart(4, "0")}`,
        participant_id: uuidFor(participant.id),
        engagement_id: engagementUuid(participant.engagementRef),
        issued_at: issuedOn ? startOfDay(issuedOn) : participant.updatedAt,
        template_id: null,
        attachment_id: null,
        serial: participant.certificateId!,
        created_at: issuedOn ? startOfDay(issuedOn) : participant.updatedAt,
        ...actorColumns({ id: "u_siti", name: "Siti Nordin", kind: "HUMAN" }),
      };
    }),
  });
};

/* ------------------------------------------------------------------ *
 * Compliance: the rule registry and what it decided
 * ------------------------------------------------------------------ */

/**
 * Rule set versions.
 *
 * A version is a point in the registry's history that a decision can be pinned
 * to. The fixture names two — `rs_2026_06_15`, which every pinned engagement
 * applied, and `rs_2027_01_01`, which the drift warning on ENG-0244 compares
 * against — and encodes the date in the key, so `registry_asof` is read off it
 * rather than chosen.
 */
const RULE_SET_KEYS = ["rs_2026_06_15", "rs_2027_01_01"] as const;

const ruleSetVersionsSql = (): string =>
  upsert({
    table: "core.rule_set_versions",
    conflict: ["version_key"],
    frozen: ["created_at"],
    rows: RULE_SET_KEYS.map((key) => ({
      id: uuidFor(key),
      tenant_id: TENANT_UUID,
      version_key: key,
      registry_asof: startOfDay(key.replace(/^rs_/, "").replace(/_/g, "-")),
      note: null,
      created_at: startOfDay(key.replace(/^rs_/, "").replace(/_/g, "-")),
    })),
  });

type ComplianceRecord = {
  engagementRef: string;
  evaluatedAt: string;
  ruleResolution: { grantSide: { asOf: string | null; basis: string; ruleSetVersion: string | null } };
  versionDrift: { checkKey: string; appliedVersion: string; currentVersion: string; severity: string; message: string }[];
  checks: {
    key: string;
    state: string;
    label: string;
    computed: Record<string, unknown>;
    display?: string;
    ruleId: string;
    provenance: { origin: string; method: string };
  }[];
};

const complianceRecords = (): ComplianceRecord[] =>
  fx.engagements
    .map((engagement) => (fx.complianceChecks as Record<string, ComplianceRecord>)[engagement.ref])
    .filter((record): record is ComplianceRecord => Boolean(record));

/**
 * The check catalogue.
 *
 * One row per check key the compliance records use, in first-appearance order.
 * `label` is the first label the fixture gives that key — CHK_LEAD_TIME reads
 * "· in-house" on an SBL_KHAS engagement and "· public" on an SBL one, and the
 * per-result label on `core.compliance_check_results` keeps both. This table is
 * the catalogue entry, not the rendering.
 */
const checkKeysSql = (): string => {
  const seen = new Map<string, string>();
  for (const record of complianceRecords()) {
    for (const check of record.checks) if (!seen.has(check.key)) seen.set(check.key, check.label);
  }
  return upsert({
    table: "core.check_keys",
    conflict: ["tenant_id", "check_key"],
    frozen: ["created_at"],
    rows: [...seen.entries()].map(([key, label], index) => ({
      id: uuidFor(`check_key:${key}`),
      tenant_id: TENANT_UUID,
      check_key: key,
      label,
      description: null,
      position: index,
      active: true,
      created_at: fx.NOW,
    })),
  });
};

type FixtureRule = (typeof fx.complianceRules)[number];

/** `core.rule_op` has no member for `IMMUTABLE_AFTER`; HRD-018 is the only rule that uses it. */
const STORABLE_OPS = new Set(["GTE", "LTE", "GT", "LT", "EQ", "NEQ", "COMPLETE"]);

const storableRules = (): FixtureRule[] =>
  fx.complianceRules.filter((rule) => STORABLE_OPS.has(rule.expression.op));

/**
 * What kind of thing the rule's right-hand side names.
 *
 * The fixture writes the reference as a bare string and leaves its kind to be
 * read off the value, which is unambiguous across the set: two field names, one
 * boolean literal, one document set, one rate-card ceiling.
 */
const referenceKind = (reference: string): string => {
  if (reference === "true" || reference === "false") return "LITERAL_BOOL";
  if (reference === "documents_required") return "DOCUMENT_SET";
  if (reference.startsWith("acm_")) return "RATE_CARD";
  return "FIELD";
};

/**
 * The rule registry.
 *
 * `family_key` is what `cr_no_bitemporal_overlap` groups on — the identity of
 * "the rule that keeps being reissued" — and the check key a rule serves is
 * exactly that identity: HRD-006 and HRD-014 are both CHK_LEAD_TIME for
 * SBL_KHAS, with adjacent and non-overlapping validity, which is the shape the
 * exclusion constraint exists to police.
 *
 * `registry_from` is written rather than defaulted. It is immutable after
 * insert and defaults to `now()`, so a defaulted value would differ on every
 * emission and the second run would try — and be refused — an update. The
 * fixture's verification date is when the rule entered this registry; for the
 * two still-proposed rules it is when the extraction run produced them.
 *
 * `kind` and `fail_state` take their column defaults (BINDING, FAIL). The
 * fixture publishes neither per rule, though CHK_MEAL_CEILING is observed
 * WARNing rather than failing — see the PR's gap list.
 */
const complianceRulesSql = (): string =>
  upsert({
    table: "core.compliance_rules",
    conflict: ["id"],
    frozen: ["created_at"],
    note: [
      "The HRD Corp rule registry as the fixture world knows it.",
      "-- `knowledge_source_id` is NULL: core.knowledge_sources belongs to slice 4, and the",
      "-- fixture's citation (document id, title, section, page, excerpt) is carried on the",
      "-- rule itself, which is what the rule detail screen reads.",
    ].join("\n"),
    rows: storableRules().map((rule) => {
      const provenance = (rule as { provenance?: { generatedAt?: string } }).provenance;
      const registryFrom =
        rule.verifiedAt ?? provenance?.generatedAt ?? startOfDay(rule.effectiveFrom);
      return {
        id: uuidFor(`rule:${rule.id}`),
        tenant_id: TENANT_UUID,
        rule_code: rule.id,
        family_key: rule.usedByChecks[0] ?? rule.id,
        check_key: rule.usedByChecks[0] ?? rule.id,
        scheme: rule.scheme,
        scheme_key: rule.scheme,
        // The fixture separates in-house from public by SCHEME (SBL_KHAS against
        // SBL), which is already part of the exclusion key. Claiming a
        // delivery_mode on top of that would be a second, unsourced answer.
        delivery_mode: "ANY",
        side: rule.usedByChecks.includes("CHK_CLAIM_WINDOW") ? "CLAIM" : "GRANT",
        kind: "BINDING",
        subject: rule.subject,
        fail_state: "FAIL",
        subject_field: rule.expression.field,
        op: rule.expression.op,
        reference_kind: referenceKind(rule.expression.reference),
        reference: rule.expression.reference,
        offset_amount: rule.expression.offsetDays ?? 0,
        offset_unit: "DAY",
        applies_when: j({}),
        effective_from: rule.effectiveFrom,
        effective_to: rule.effectiveTo ?? null,
        registry_from: registryFrom,
        registry_to: null,
        status: rule.status,
        supersedes_rule_id: rule.supersedesId ? uuidFor(`rule:${rule.supersedesId}`) : null,
        superseded_by_rule_id: rule.supersededById ? uuidFor(`rule:${rule.supersededById}`) : null,
        knowledge_source_id: null,
        source_document_id: rule.source.documentId,
        source_title: rule.source.title,
        source_section: rule.source.section ?? null,
        source_page: rule.source.page ?? null,
        source_excerpt: rule.source.excerpt ?? null,
        used_by_check_keys: arr(rule.usedByChecks),
        verified_by_user_id: rule.verifiedBy ? uuidFor(rule.verifiedBy.id) : null,
        verified_at: rule.verifiedAt ?? null,
        created_at: registryFrom,
        ...actorColumns({ id: "agent_knowledge", name: "Knowledge agent", kind: "AGENT" }),
      };
    }),
  });

const checkResultUuid = (engagementRef: string, checkKey: string): string =>
  uuidFor(childKey(`eng:${engagementRef}`, "check", checkKey));

/**
 * What the checks decided.
 *
 * Every result is recorded on the GRANT side. `rule_set_version_id` is NOT
 * NULL, and the fixture's claim side resolves to nothing on all four records —
 * no claim has been submitted yet, so there is no claim-side registry instant
 * to pin to. Recording a claim-side result would therefore mean inventing the
 * version it was decided under, and the four records the fixture publishes are
 * grant-side resolutions in any case.
 *
 * `stage_key` stays NULL: the fixture does not say which lifecycle stage each
 * individual check gates, only that the engagement's HRDC_CLAIM step is blocked
 * when one fails, and that relationship is already on the step state.
 */
const checkResultsSql = (): string =>
  upsert({
    table: "core.compliance_check_results",
    conflict: ["id"],
    frozen: ["created_at"],
    rows: complianceRecords().flatMap((record) =>
      record.checks.map((check) => ({
        id: checkResultUuid(record.engagementRef, check.key),
        tenant_id: TENANT_UUID,
        engagement_id: engagementUuid(record.engagementRef),
        check_key: check.key,
        state: check.state,
        label: check.label,
        computed: j(check.computed),
        display: check.display ?? null,
        compliance_rule_id: uuidFor(`rule:${check.ruleId}`),
        rule_set_version_id: uuidFor(record.ruleResolution.grantSide.ruleSetVersion!),
        rule_side: "GRANT",
        rules_as_of: record.ruleResolution.grantSide.asOf,
        basis: record.ruleResolution.grantSide.basis,
        method: check.provenance.method,
        evaluated_at: record.evaluatedAt,
        stage_key: null,
        created_at: record.evaluatedAt,
        ...actorColumns({ id: "system", kind: "SYSTEM" }),
      })),
    ),
  });

/** The one drift warning: ENG-0244 applied the 3-day public lead time, 14 days lands in 2027. */
const versionDriftsSql = (): string =>
  upsert({
    table: "core.compliance_version_drifts",
    conflict: ["id"],
    frozen: ["created_at"],
    rows: complianceRecords().flatMap((record) =>
      record.versionDrift.map((drift) => ({
        id: uuidFor(childKey(`eng:${record.engagementRef}`, "drift", drift.checkKey)),
        tenant_id: TENANT_UUID,
        compliance_check_result_id: checkResultUuid(record.engagementRef, drift.checkKey),
        applied_version_id: uuidFor(drift.appliedVersion),
        current_version_id: uuidFor(drift.currentVersion),
        severity: drift.severity,
        message: drift.message,
        created_at: record.evaluatedAt,
      })),
    ),
  });

type ChangeSet = (typeof fx.ruleChangeSets)[number];

/**
 * Ingested circulars and the changes read out of them.
 *
 * `run_id` is NULL: the extraction run `run_4912` that the fixture cites lives
 * in `core.runs`, which belongs to slice 4. The model and its confidence are
 * on the change set itself, so the provenance survives the missing pointer.
 */
const ruleChangeSetsSql = (): string =>
  upsert({
    table: "core.rule_change_sets",
    conflict: ["tenant_id", "document_id"],
    frozen: ["created_at"],
    rows: fx.ruleChangeSets.map((set: ChangeSet) => ({
      id: uuidFor(`rule_change_set:${set.documentId}`),
      tenant_id: TENANT_UUID,
      document_id: set.documentId,
      title: set.title,
      published_at: set.publishedAt ?? null,
      ingested_at: set.ingestedAt,
      effective_from: set.effectiveFrom ?? null,
      knowledge_source_id: null,
      run_id: null,
      extracted_by_model: set.extractedBy?.model ?? null,
      extraction_confidence: set.extractedBy?.confidence ?? null,
      status: "PROPOSED",
      created_at: set.ingestedAt,
      ...actorColumns({ id: "agent_knowledge", name: "Knowledge agent", kind: "AGENT" }),
    })),
  });

/**
 * `rc_low_confidence_withheld` refuses a change under 0.800 that is not marked
 * withheld, which is the same rule the diff view applies — hrdc.ts calls chg_2
 * "below RULE_CHANGE_MIN_CONFIDENCE — withheld from the diff view" in so many
 * words. So `withheld` is derived from the confidence the fixture publishes
 * rather than carried as a field it does not have.
 */
const RULE_CHANGE_MIN_CONFIDENCE = 0.8;

const ruleChangesSql = (): string =>
  upsert({
    table: "core.rule_changes",
    conflict: ["tenant_id", "rule_change_set_id", "change_key"],
    frozen: ["created_at"],
    rows: fx.ruleChangeSets.flatMap((set: ChangeSet) =>
      set.changes.map((change) => ({
        id: uuidFor(childKey(`rule_change_set:${set.documentId}`, "change", change.id)),
        tenant_id: TENANT_UUID,
        rule_change_set_id: uuidFor(`rule_change_set:${set.documentId}`),
        change_key: change.id,
        op: change.op,
        target_rule_id: change.targetRuleId ? uuidFor(`rule:${change.targetRuleId}`) : null,
        new_rule_id: change.newRuleId ? uuidFor(`rule:${change.newRuleId}`) : null,
        before_text: change.before ?? null,
        after_text: change.after ?? null,
        source_page: change.sourceSpan?.page ?? null,
        source_section: change.sourceSpan?.section ?? null,
        source_excerpt: change.sourceSpan?.excerpt ?? null,
        confidence: change.confidence ?? null,
        withheld: (change.confidence ?? 1) < RULE_CHANGE_MIN_CONFIDENCE,
        status: change.status,
        created_at: set.ingestedAt,
      })),
    ),
  });

const ruleChangeAffectedSql = (): string =>
  upsert({
    table: "core.rule_change_affected_engagements",
    conflict: ["tenant_id", "rule_change_id", "engagement_id"],
    frozen: ["created_at"],
    note: "The two engagements the January lead-time change would move, as the diff view lists them.",
    rows: fx.ruleChangeSets.flatMap((set: ChangeSet) =>
      set.changes.flatMap((change) =>
        (change.affectedEngagements ?? []).map((affected) => ({
          id: uuidFor(childKey(`${set.documentId}:${change.id}`, "affected", affected.ref)),
          tenant_id: TENANT_UUID,
          rule_change_id: uuidFor(childKey(`rule_change_set:${set.documentId}`, "change", change.id)),
          engagement_id: engagementUuid(affected.ref),
          created_at: set.ingestedAt,
        })),
      ),
    ),
  });

/* ------------------------------------------------------------------ *
 * HRD Corp claim packets
 * ------------------------------------------------------------------ */

/**
 * HRD Corp's own names for the five claim documents.
 *
 * Copied from `apps/web/src/features/compliance/labels.ts`, which is where the
 * product settled them and explains why they are a table rather than a
 * `humanise()` — these are proper nouns. The packet's own `label` still wins
 * where the fixture sends one; this is the catalogue behind it. The generator
 * cannot import from `apps/web`, so the table is restated here and the two must
 * be kept in step.
 */
const HRDC_DOCUMENT_LABEL: Readonly<Record<string, string>> = {
  ATTENDANCE_SHEET: "Attendance sheet",
  TRAINER_TTT_CERT: "Trainer TTT certificate",
  TAX_INVOICE: "Tax invoice",
  EVALUATION_SUMMARY: "Evaluation summary",
  TRAINING_SCHEDULE: "Training schedule",
};

const documentTypesSql = (): string => {
  const seen: string[] = [];
  for (const packet of fx.claimPackets) {
    for (const document of packet.requiredDocuments) {
      if (!seen.includes(document.type)) seen.push(document.type);
    }
  }
  return upsert({
    table: "core.hrdc_document_types",
    conflict: ["tenant_id", "document_type"],
    frozen: ["created_at"],
    rows: seen.map((type, index) => ({
      id: uuidFor(`hrdc_document_type:${type}`),
      tenant_id: TENANT_UUID,
      document_type: type,
      label: HRDC_DOCUMENT_LABEL[type] ?? type,
      description: null,
      position: index,
      active: true,
      created_at: fx.NOW,
    })),
  });
};

type Packet = (typeof fx.claimPackets)[number];

/** The packet's assembly event — the fixture's own record of when and by whom. */
const packetAssembled = (packet: Packet) =>
  packet.submissionLog.find((entry) => entry.event === "PACKET_ASSEMBLED");

/**
 * `core.hrdc_packets.panel_state` is the deadline panel's summary, and the
 * fixture publishes exactly that judgement per engagement in `hrdcDeadlines`:
 * AT_RISK for the two whose window closes in three days, BLOCKED for the two a
 * failing check is holding up.
 */
const PANEL_STATE: Readonly<Record<string, string>> = {
  AT_RISK: "DEADLINE_AT_RISK",
  BLOCKED: "BLOCKED",
  ON_TRACK: "ON_TRACK",
  SUBMITTED: "SUBMITTED",
};

const packetsSql = (): string =>
  upsert({
    table: "core.hrdc_packets",
    conflict: ["tenant_id", "engagement_id"],
    frozen: ["ref", "created_at"],
    note: [
      "Four claim packets. `ref` is minted in the house HPK format rather than left to",
      "-- core.assign_ref, which would advance core.ref_sequences on every re-run.",
      "-- `claim_rule_set_version_id` is NULL on all four: no claim has been submitted, so",
      "-- there is no claim-side registry instant to pin one to.",
    ].join("\n"),
    rows: fx.claimPackets.map((packet, index) => {
      const deadline = fx.hrdcDeadlines.find((entry) => entry.engagementRef === packet.engagementRef);
      const assembled = packetAssembled(packet);
      return {
        id: uuidFor(packet.id),
        tenant_id: TENANT_UUID,
        ref: `HPK-2026-${String(index + 1).padStart(4, "0")}`,
        engagement_id: engagementUuid(packet.engagementRef),
        organisation_id: refUuid(packet.organisationRef),
        scheme: packet.scheme,
        employer_code: packet.employerCode,
        claim_value_sen: packet.claimValue.amount,
        levy_available_sen: packet.levyAvailable?.amount ?? null,
        currency: packet.claimValue.currency,
        completeness: packet.completeness,
        status: packet.status,
        panel_state: PANEL_STATE[deadline?.status ?? "ON_TRACK"] ?? "ON_TRACK",
        deadline_at: packet.deadlineAt ?? null,
        deadline_severity: packet.deadlineSeverity ?? null,
        grant_reference: packet.grant?.reference ?? null,
        grant_submitted_at: packet.grant?.submittedAt ?? null,
        grant_approved_at: packet.grant?.approvedAt ?? null,
        claim_reference: null,
        claim_submitted_at: null,
        claim_rule_set_version_id: null,
        voided_at: null,
        void_reason: null,
        created_at: assembled?.at ?? fx.NOW,
        ...actorColumns(assembled?.actor ?? { id: "agent_compliance", name: "Compliance Agent", kind: "AGENT" }),
      };
    }),
  });

/**
 * The documents in each packet.
 *
 * `hpd_present_needs_evidence` refuses a PRESENT document that points at
 * nothing, and the fixture gives a `ref` for three of the five types but not
 * for EVALUATION_SUMMARY or TRAINING_SCHEDULE. Those two get the same
 * engagement-scoped reference the fixture itself uses for the attendance sheet
 * (`ENG-0187/attendance`), which is the shape the packet screen already
 * renders. See the PR's gap list: the fixture should carry the ref.
 */
const packetDocumentsSql = (): string =>
  upsert({
    table: "core.hrdc_packet_documents",
    conflict: ["tenant_id", "hrdc_packet_id", "document_type"],
    frozen: ["created_at"],
    rows: fx.claimPackets.flatMap((packet) => {
      const assembled = packetAssembled(packet);
      return packet.requiredDocuments.map((document) => ({
        id: uuidFor(childKey(packet.id, "document", document.type)),
        tenant_id: TENANT_UUID,
        hrdc_packet_id: uuidFor(packet.id),
        document_type: document.type,
        status: document.status,
        attachment_id: null,
        source_ref:
          document.status === "PRESENT"
            ? document.ref ?? `${packet.engagementRef}/${document.type.toLowerCase()}`
            : document.ref ?? null,
        // The fixture's `meta` is a rendered sentence ("24 of 30 responses
        // collected"), not structured data, so it is stored as the note it is.
        meta: j(document.meta ? { note: document.meta } : {}),
        attached_at: document.status === "PRESENT" ? assembled?.at ?? null : null,
        created_at: assembled?.at ?? fx.NOW,
      }));
    }),
  });

/**
 * Levy balances.
 *
 * Two employers, one statement each. The fixture carries the balance on every
 * packet without dating it, so `as_of` is the fixture clock: the levy figure on
 * the screen is what is available NOW, and `NOW` is the one instant the whole
 * pack is computed against.
 */
const levyStatementsSql = (): string => {
  const byOrg = new Map<string, Packet>();
  for (const packet of fx.claimPackets) {
    if (packet.levyAvailable && !byOrg.has(packet.organisationRef)) byOrg.set(packet.organisationRef, packet);
  }
  return upsert({
    table: "core.hrdc_levy_statements",
    conflict: ["tenant_id", "organisation_id", "as_of"],
    frozen: ["created_at"],
    rows: [...byOrg.entries()].map(([organisationRef, packet]) => ({
      id: uuidFor(childKey(`org:${organisationRef}`, "levy", fx.NOW.slice(0, 10))),
      tenant_id: TENANT_UUID,
      organisation_id: refUuid(organisationRef),
      employer_code: packet.employerCode,
      as_of: fx.NOW.slice(0, 10),
      levy_available_sen: packet.levyAvailable!.amount,
      currency: packet.levyAvailable!.currency,
      attachment_id: null,
      created_at: fx.NOW,
    })),
  });
};

/* ------------------------------------------------------------------ *
 * Finance
 * ------------------------------------------------------------------ */

type Invoice = (typeof fx.invoices)[number];

const paidOn = (invoice: Invoice): number =>
  (invoice.payments ?? []).reduce((total, payment) => total + payment.amount.amount, 0);

/**
 * Invoices.
 *
 * `subtotal_sen` and `outstanding_sen` are written from the fixture and then
 * genuinely checked: `core.invoice_recalc` rewrites the subtotal from the lines
 * and the deferred `trg_invoice_reconciled` refuses the transaction at COMMIT
 * if the header and the lines disagree, or if outstanding does not equal total
 * minus payments. Both hold across all ten without adjustment here, which is
 * the point of not suspending those triggers.
 *
 * The e-invoice columns stay at their defaults. `invoices_valid_has_identifiers`
 * needs a UUID, a long id and a validation instant before `einvoice_status` can
 * read VALID, and the fixture supplies only the MyInvois UIN — which is carried
 * on `sync_uin`, where it came from. See the PR's gap list.
 */
const invoicesSql = (): string =>
  upsert({
    table: "core.invoices",
    conflict: ["id"],
    frozen: ["ref", "created_at"],
    rows: fx.invoices.map((invoice) => ({
      id: uuidFor(invoice.id),
      tenant_id: TENANT_UUID,
      ref: invoice.ref,
      organisation_id: refUuid(invoice.organisationRef),
      engagement_id: invoice.engagementRef ? engagementUuid(invoice.engagementRef) : null,
      status: invoice.status,
      issued_at: invoice.issuedAt ?? null,
      due_at: invoice.dueAt ?? null,
      terms_days: invoice.termsDays,
      subtotal_sen: invoice.subtotal.amount,
      sst_rate: 0,
      sst_reason: invoice.sstReason,
      outstanding_sen: invoice.outstanding.amount,
      currency: invoice.subtotal.currency,
      exchange_rate: null,
      sync_state: invoice.sync.state,
      sync_provider: invoice.sync.provider ?? null,
      sync_uin: invoice.sync.uin ?? null,
      sync_document_id: null,
      sync_last_attempt_at: invoice.sync.lastAttemptAt ?? null,
      voided_at: null,
      void_reason: null,
      created_at: invoice.createdAt,
      ...actorColumns(invoice.createdBy),
    })),
  });

const invoiceLinesSql = (): string =>
  upsert({
    table: "core.invoice_lines",
    conflict: ["tenant_id", "invoice_id", "n"],
    frozen: ["created_at"],
    note: [
      "Invoice lines. `amount_sen` is GENERATED from unit price × quantity, half-up to the",
      "-- sen, so it is not written here — the fixture's own line amounts are checked",
      "-- against the column rather than copied into it.",
      "-- The MyInvois classification and UoM codes have no fixture source and stay NULL.",
    ].join("\n"),
    rows: fx.invoices.flatMap((invoice) =>
      invoice.lines.map((line, index) => ({
        id: uuidFor(childKey(invoice.id, "line", index + 1)),
        tenant_id: TENANT_UUID,
        invoice_id: uuidFor(invoice.id),
        n: index + 1,
        description: line.description,
        detail: line.detail ?? null,
        qty: line.qty,
        unit_price_sen: line.unit.amount,
        currency: line.unit.currency,
        tax_code: null,
        classification_code: null,
        uom_code: null,
        created_at: invoice.createdAt,
      })),
    ),
  });

/**
 * Payments.
 *
 * Every column outside the conflict target is declared frozen, which makes this
 * an `ON CONFLICT DO NOTHING`. That is not a shortcut: `core.payments` is
 * append-only and `core.payment_reject_mutation` raises on any UPDATE, so a
 * statement that could emit one would be a statement that can fail on a second
 * run. A payment that needs correcting is a reversal row, not an edit.
 *
 * Inserting one fires `core.payment_apply`, which rewrites the invoice's
 * outstanding balance and status from the payments that now exist. That trigger
 * stays live — it is the thing under test.
 */
const paymentsSql = (): string =>
  upsert({
    table: "core.payments",
    conflict: ["id"],
    frozen: [
      "tenant_id",
      "ref",
      "invoice_id",
      "amount_sen",
      "currency",
      "received_at",
      "method",
      "external_reference",
      "recorded_by_user_id",
      "is_reversal",
      "reverses_payment_id",
      "reversal_reason",
      "created_at",
      "created_by_kind",
      "created_by_id",
      "created_by_name",
    ],
    rows: fx.invoices.flatMap((invoice) =>
      (invoice.payments ?? []).map((payment, index) => ({
        id: uuidFor(`payment:${payment.id}`),
        tenant_id: TENANT_UUID,
        ref: `PAY-2026-${invoice.ref.slice(-4)}${index + 1}`,
        invoice_id: uuidFor(invoice.id),
        amount_sen: payment.amount.amount,
        currency: payment.amount.currency,
        received_at: payment.at,
        method: payment.method,
        external_reference: payment.reference ?? null,
        recorded_by_user_id: uuidFor(invoice.createdBy.id),
        is_reversal: false,
        reverses_payment_id: null,
        reversal_reason: null,
        created_at: payment.at,
        ...actorColumns(invoice.createdBy),
      })),
    ),
  });

/**
 * The status `core.payment_apply` will leave an invoice in.
 *
 * Transcribed from the trigger, minus the date-dependent branch: that one is
 * only reachable when no payment exists, and this function is asked only about
 * invoices that have one.
 */
const statusAfterPayments = (invoice: Invoice): string => {
  if (invoice.status === "VOID" || invoice.status === "DRAFT") return invoice.status;
  const paid = paidOn(invoice);
  const total = invoice.total.amount;
  if (paid >= total && total > 0) return "PAID";
  return "PARTIALLY_PAID";
};

/**
 * Settling the invoices the payment trigger disagrees with.
 *
 * `core.payment_apply` deliberately does NOT return an invoice to OVERDUE —
 * overdue is a function of the date and is settled by the sweep in 015, not by
 * money arriving. So a part-paid invoice that the fixture world calls OVERDUE
 * comes out of the payment insert as PARTIALLY_PAID, and this puts it back:
 * PARTIALLY_PAID → OVERDUE is a legal, ungated edge.
 *
 * One invoice needs it (INV-2026-0288). The `IS DISTINCT FROM` guard is what
 * makes it idempotent — the second run matches nothing and updates nothing.
 */
const settleInvoiceStatusSql = (): string => {
  const drifted = fx.invoices.filter(
    (invoice) => (invoice.payments ?? []).length > 0 && statusAfterPayments(invoice) !== invoice.status,
  );
  if (drifted.length === 0) return "";
  return [
    "-- core.payment_apply leaves a part-paid invoice PARTIALLY_PAID; the fixture world",
    "-- calls this one OVERDUE, which is the date talking, not the payment. Restored here",
    "-- over a legal PARTIALLY_PAID -> OVERDUE edge.",
    ...drifted.map((invoice) =>
      [
        "UPDATE core.invoices",
        `   SET status = '${invoice.status}'`,
        ` WHERE tenant_id = '${TENANT_UUID}'`,
        `   AND ref = '${invoice.ref}'`,
        `   AND status IS DISTINCT FROM '${invoice.status}';`,
      ].join("\n"),
    ),
  ].join("\n");
};

const syncEntriesSql = (): string =>
  upsert({
    table: "core.invoice_sync_entries",
    conflict: ["id"],
    frozen: ["created_at"],
    note: "The accounting-package sync log, including INV-2026-0311's CUSTOMER_NOT_MAPPED failure and how it was resolved.",
    rows: fx.invoices.flatMap((invoice) =>
      (invoice.syncLog ?? []).map((entry, index) => ({
        id: uuidFor(childKey(invoice.id, "sync", index)),
        tenant_id: TENANT_UUID,
        invoice_id: uuidFor(invoice.id),
        at: entry.at,
        state: entry.state,
        einvoice_status: null,
        provider_code: entry.providerCode ?? null,
        detail: entry.detail ?? null,
        resolution: entry.resolution ?? null,
        webhook_receipt_id: null,
        created_at: entry.at,
      })),
    ),
  });

/**
 * Aging buckets.
 *
 * `core.receivables_aging` matches an invoice with `b.days @> GREATEST(0, as_of
 * - due_at)`, so the bucket definition is the only place the boundaries exist
 * and everything not yet due collapses into day zero. These four reproduce the
 * fixture's published aging exactly — 61,300 / 22,700 / 35,100 / 9,400 ringgit
 * against the eight open invoices — which is what makes them read off the data
 * rather than chosen. Labels are the ones `AgingStrip` renders.
 */
const AGING_BUCKETS: readonly [code: string, label: string, days: string, sort: number][] = [
  ["current", "Current", "int4range(0, 1, '[)')", 1],
  ["d1_30", "1–30 days", "int4range(1, 31, '[)')", 2],
  ["d31_60", "31–60 days", "int4range(31, 61, '[)')", 3],
  ["d60_plus", "60+ days", "int4range(61, NULL, '[)')", 4],
];

const agingBucketsSql = (): string =>
  upsert({
    table: "core.aging_buckets",
    conflict: ["tenant_id", "code"],
    frozen: ["created_at"],
    rows: AGING_BUCKETS.map(([code, label, days, sort]) => ({
      id: uuidFor(`aging_bucket:${code}`),
      tenant_id: TENANT_UUID,
      code,
      label,
      days: raw(days),
      sort,
      created_at: fx.NOW,
    })),
  });

/**
 * The collections ladder.
 *
 * Four of the fixture's five stages. TRADING_HOLD is left out: `channel` is NOT
 * NULL and the fixture gives it none, correctly — a trading hold is a decision,
 * not a message, and the stage carries `requiresApprovalFromRole: MD` instead.
 * Inventing a channel to satisfy the column would make the ladder say the
 * system sends something it does not. See the PR's gap list.
 */
const collectionRulesSql = (): string =>
  upsert({
    table: "core.collection_rules",
    conflict: ["tenant_id", "stage"],
    frozen: ["created_at"],
    rows: fx.collectionRules
      .filter((rule) => Boolean(rule.channel))
      .map((rule) => ({
        id: uuidFor(`collection_rule:${rule.stage}`),
        tenant_id: TENANT_UUID,
        stage: rule.stage,
        trigger_days_overdue: rule.afterDays,
        channel: rule.channel!,
        // core.templates belongs to slice 2; the reminder bodies the drafts use
        // are template-shaped but this pointer cannot be resolved from here.
        template_id: null,
        requires_role: (rule as { requiresApprovalFromRole?: string }).requiresApprovalFromRole ?? null,
        autonomy: rule.autonomy,
        created_at: fx.NOW,
      })),
  });

/**
 * `core.collections_cases.next_action_status` admits DRAFT_READY, SCHEDULED and
 * BLOCKED. The fixture uses four values, two of which have no member:
 * BLOCKED_ON_SYNC is BLOCKED with the reason attached — the reason survives on
 * the invoice's own sync state — but AWAITING_MD and HUMAN_REQUIRED say
 * something the column cannot, and are recorded as NULL rather than flattened
 * into a state that means something else. See the PR's gap list.
 */
const NEXT_ACTION_STATUS: Readonly<Record<string, string | null>> = {
  DRAFT_READY: "DRAFT_READY",
  SCHEDULED: "SCHEDULED",
  BLOCKED: "BLOCKED",
  BLOCKED_ON_SYNC: "BLOCKED",
  AWAITING_MD: null,
  HUMAN_REQUIRED: null,
};

/**
 * Open collections cases.
 *
 * Four of the five receivables. The fifth, INV-2026-0244 at TRADING_HOLD, is
 * refused by `collections_cases_hold_needs_approval`: the stage requires the
 * `core.action_requests` row that carries the MD's approval, and action
 * requests belong to slice 4. Writing one from here to satisfy the constraint
 * would be manufacturing an approval, so the case is left out and reported.
 *
 * `stage_entered_at` is NOT NULL and defaults to `now()`, which would make the
 * emitted seed differ run to run. It is derived instead from the ladder above:
 * a case enters a stage its trigger's number of days after the invoice fell
 * due, which is the rule the fixture's own stages were assigned by.
 */
const collectionsCasesSql = (): string => {
  const invoiceByRef = new Map(fx.invoices.map((invoice) => [invoice.ref, invoice]));
  const daysForStage = new Map(fx.collectionRules.map((rule) => [rule.stage, rule.afterDays]));
  const openStage = fx.collectionRules[0]!.afterDays;

  const cases = fx.receivables.filter((receivable) => receivable.stage !== "TRADING_HOLD");

  return upsert({
    table: "core.collections_cases",
    conflict: ["id"],
    frozen: ["ref", "created_at"],
    rows: cases.map((receivable, index) => {
      const invoice = invoiceByRef.get(receivable.invoiceRef)!;
      const dueAt = invoice.dueAt!;
      const openedOn = addDays(dueAt, openStage);
      return {
        id: uuidFor(childKey(invoice.id, "collections", receivable.stage)),
        tenant_id: TENANT_UUID,
        ref: `COL-${String(index + 1).padStart(4, "0")}`,
        invoice_id: uuidFor(invoice.id),
        organisation_id: refUuid(receivable.organisation.ref),
        stage: receivable.stage,
        stage_entered_at: startOfDay(addDays(dueAt, daysForStage.get(receivable.stage) ?? openStage)),
        next_action_at: receivable.nextActionAt ?? null,
        next_action_type: receivable.nextAction?.type ?? null,
        next_action_status: NEXT_ACTION_STATUS[receivable.nextAction?.status ?? ""] ?? null,
        autonomy: receivable.nextAction?.autonomy ?? "OBSERVE",
        trading_hold_action_id: null,
        closed_at: null,
        closed_reason: null,
        created_at: startOfDay(openedOn),
        ...actorColumns({ id: "agent_collections", name: "Collections Agent", kind: "AGENT" }),
      };
    }),
  });
};

/* ------------------------------------------------------------------ */

export const slice03: Slice = {
  file: "fixture_world_03_delivery_compliance_finance.sql",
  title: "Engagements, cohorts, attendance, HRDC compliance and finance",
  tables: [
    "core.rule_set_versions",
    "core.engagements",
    "core.engagement_step_states",
    "core.engagement_checklist_items",
    "core.engagement_trainers",
    "core.sessions",
    "core.participants",
    "core.attendance_days",
    "core.attendance_entries",
    "core.certificates",
    "core.check_keys",
    "core.compliance_rules",
    "core.compliance_check_results",
    "core.compliance_version_drifts",
    "core.rule_change_sets",
    "core.rule_changes",
    "core.rule_change_affected_engagements",
    "core.hrdc_document_types",
    "core.hrdc_packets",
    "core.hrdc_packet_documents",
    "core.hrdc_levy_statements",
    "core.invoices",
    "core.invoice_lines",
    "core.payments",
    "core.invoice_sync_entries",
    "core.aging_buckets",
    "core.collection_rules",
    "core.collections_cases",
  ],
  /**
   * Every one of these is a state gate or a lock guard, and nothing else.
   *
   * The gates admit only an entity's INITIAL status on INSERT — `(new) -> OPEN`
   * for an attendance day, `(new) -> DRAFT` for an invoice — and every later
   * status is reachable only through an executing action request. This seed
   * lands a world that has already happened, so it takes the gates down, writes
   * the terminal states, and the framework puts them back at the foot of the
   * emitted file.
   *
   * `trg_attendance_entries_lock` is a lock guard of the same kind: it refuses
   * an INSERT into a LOCKED day, and nine of the ten days in here are locked.
   * The day-level guard is BEFORE UPDATE only, so it needs no suspension —
   * inserting an already-locked day never touches it.
   *
   * Not suspended, on purpose: `trg_invoice_lines_recalc`,
   * `trg_credit_note_lines_recalc`, `trg_payments_apply` and the deferred
   * `trg_invoice_reconciled`. Every total this file writes has to survive them.
   */
  suspendTriggers: [
    "core.engagements:engagements_state_gate",
    "core.attendance_days:attendance_days_state_gate",
    "core.attendance_entries:trg_attendance_entries_lock",
    "core.compliance_rules:compliance_rules_state_gate",
    "core.hrdc_packets:hrdc_packets_state_gate",
    "core.invoices:invoices_state_gate",
    "core.invoices:invoices_sync_gate",
    "core.collections_cases:collections_cases_state_gate",
  ],
  emit: () =>
    block(
      banner("Rule set versions"),
      ruleSetVersionsSql(),
      banner("Engagements"),
      engagementsSql(),
      stepStatesSql(),
      checklistSql(),
      engagementTrainersSql(),
      sessionsSql(),
      banner("Cohorts and attendance"),
      participantsSql(),
      attendanceDaysSql(),
      attendanceEntriesSql(),
      certificatesSql(),
      banner("Compliance"),
      checkKeysSql(),
      complianceRulesSql(),
      checkResultsSql(),
      versionDriftsSql(),
      ruleChangeSetsSql(),
      ruleChangesSql(),
      ruleChangeAffectedSql(),
      banner("HRD Corp claim packets"),
      documentTypesSql(),
      packetsSql(),
      packetDocumentsSql(),
      levyStatementsSql(),
      banner("Finance"),
      invoicesSql(),
      invoiceLinesSql(),
      paymentsSql(),
      settleInvoiceStatusSql(),
      syncEntriesSql(),
      banner("Collections"),
      agingBucketsSql(),
      collectionRulesSql(),
      collectionsCasesSql(),
    ),
};
