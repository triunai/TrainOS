-- ============================================================================
-- Migration 013: AI operations — the agent roster and its credentials, BYOK
-- provider keys, model tiers and routing, budgets and usage, agent run traces
-- and evals.
-- ============================================================================
--
-- FEATURE. 011 built the gate that decides whether an agent may act. 012 built
-- the event log and the queue that carry what it did. 013 is the migration that
-- says WHO the agent is, WHAT credential it presents, WHICH model it may reach,
-- WHAT that is allowed to cost, and WHAT the run actually did — the record the
-- trace viewer renders and the record a regulator would ask for.
--
-- OBJECTS. Nineteen tables, two security-invoker views, twenty-seven functions,
-- three composite foreign keys added to tables 007 and 009 left open by name for
-- this migration, and zero policies. No new type: every status vocabulary here
-- already exists as a 003 enum, and $verify$ asserts the eight it uses by
-- pg_type oid rather than by spelling.
--
--   core.agents                   §10  the roster. agent_id stays `text`.
--   public.agent_api_keys         02 §3.1  metadata only — see H-09
--   app.agent_api_key_secrets     H-09  the hash, moved out of the exposed schema
--   core.tier_keys                the tier-key reference table 003 deferred to
--                                 004 and 004 did not build
--   core.model_tiers              04 §5.1
--   core.routing_matrix_versions  04 §5.3
--   core.routing_entries          04 §5.3, and the jury CHECK's home
--   core.ai_provider_keys         04 §5.4 + 02 §6 — mask, fingerprint, locator
--   core.ai_budgets               §17
--   app.usage_rollup              M-03 — defined at last
--   app.key_access_audit          05 §5.4, append-only
--   core.runs                     05 §6.1
--   core.run_nodes                05 §6.2
--   core.run_node_io              05 §6.3 — prompts and completions
--   core.run_events               05 §6.4
--   core.run_state_cards          05 §6.5
--   core.run_checkpoints          05 §6.5
--   core.run_snapshots            05 §6.6
--   core.evals                    05 §6.8
--   core.model_tier_status  view  04 §5.1, security_invoker = true
--   core.budget_status      view  04 §5.5, security_invoker = true
--
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠ THE `run_id` DIVERGENCE — SETTLED HERE, BY RECONCILIATION
-- ════════════════════════════════════════════════════════════════════════════
--
-- Two representations of one concept existed before this file:
--
--   core.action_requests.agent_run_id  text   011
--   core.suggested_drafts.agent_run_id text   011
--   core.events.run_id                 text   012
--   app.outbox.run_id                  text   012
--   core.provenance.run_id             uuid   007
--   core.proposals.run_id              uuid   007   "-- FK added by 013"
--   core.rule_change_sets.run_id       uuid   009   "-- FK added by 013"
--
-- DECISION. `core.runs.id` is `uuid`. The six columns above are NOT retyped.
-- The two representations are reconciled by giving the text one a DEFINITION it
-- did not have: a text run id is `core.runs.ref`, the human run reference, and
-- `core.runs` carries `UNIQUE (tenant_id, ref)` — which app.finalise_table
-- creates — so text resolves to uuid in one index lookup inside the tenant.
--
-- WHY NOT `uuid` EVERYWHERE. Retyping core.events.run_id and app.outbox.run_id
-- to uuid discards every event and every queued job already carrying a
-- non-uuid run id, and the design pack's own demo run id is the string
-- `run_4821`. 011 does not generate that value: app.perform_action reads it
-- straight off the caller's payload (`p_payload ->> 'runId'`, 011:2496), so its
-- shape is the client's, not the database's. A cast would fail on the only
-- example anybody has written down.
--
-- WHY NOT `text` EVERYWHERE. 007 and 009 wrote `run_id uuid` with the comment
-- "FK added by 013" against three tables this migration does not own. Widening
-- them to text drops that invitation on the floor, silently changes the type of
-- a column two other migrations declared, and gives up referential integrity on
-- the only three places where the pack actually asked for it.
--
-- WHAT HAS TO HAPPEN TO THE ROWS. On this database: nothing. Before 013 no
-- migration WRITES any of the six columns except by copying the caller's
-- string — app.emit_event's p_run_id defaults NULL, and nothing in 001–012
-- inserts a non-null run_id of its own. On a database that has already carried
-- agent traffic, the backfill is: for each distinct non-null
-- core.action_requests.agent_run_id / core.events.run_id / app.outbox.run_id,
-- insert the core.runs row whose `ref` is that string, then the text columns are
-- already correct and no UPDATE is needed. That is the whole cost of this
-- choice on the text side, and it is one INSERT per historical run.
--
-- WHAT THIS COSTS, ON THE SIDE THAT PAYS. The text columns get NO foreign key.
-- A typo'd `runId` in an action payload still writes an event whose trace cannot
-- be followed, and the database will not say so. That is a real loss and it is
-- not closeable here: adding a FK to core.events.run_id would require every row
-- already written to name an existing run, which is exactly the data this
-- migration must not destroy. What IS enforced is a shape: `core.runs.ref` is
-- allocated by core.assign_ref with prefix `RUN`, and a future migration that
-- wants the FK has a backfill that can be written, because `ref` is unique per
-- tenant.
--
-- REGISTERED, NOT DECIDED HERE. Whether the API should stop accepting a
-- caller-supplied `runId` at all and have app.perform_action look the run up by
-- ref (making the text column a derived copy rather than an input) is a contract
-- change, not a schema one. It is the right answer and it is not mine: recorded
-- as D-59, owner the API contract, blocking before the first agent writes a run.
--
-- ── FINDINGS CLOSED HERE, WITH THEIR MECHANICAL EVIDENCE ──────────────────
--
--   C-03  Every CLIENT-READABLE table doc 04 placed in `app` is created in
--         `core` with doc 01's plural names: core.model_tiers (04's
--         app.model_tier), core.routing_matrix_versions (04's
--         app.routing_matrix_version), core.ai_budgets (04's app.budget),
--         core.ai_provider_keys (04's app.ai_provider_key), and both views.
--         `app` keeps exactly two tables, and only because no client reads
--         them: app.usage_rollup (aggregated behind core.budget_status) and
--         app.key_access_audit. Same placement 007 and 009 took for the same
--         finding, not a third one. ⚠ SEE CONTRADICTIONS: doc 05 §5.4 says the
--         provider detail screen reads app.key_access_audit directly. It
--         cannot — `app` is not in config.toml's exposed schemas — so that
--         screen needs an RPC in 014/016. Recorded, not silently reshaped.
--
--   H-08  Every one of the nineteen tables is RLS-ENABLED AND FORCED before
--         this migration commits, with ZERO policies. Seventeen go through
--         app.finalise_table. core.tier_keys and core.run_node_io go through it
--         too — there is no exception in this pack, because core.run_node_io is
--         the table the finding is actually about: it holds full prompt and
--         completion text. $verify$ asserts enabled AND forced PER TABLE off
--         pg_class, and asserts the policy count across the whole set is zero.
--
--   H-09  TWO HALVES, and only one of them was still open.
--         (a) core.public_share_tokens — CHECKED, NOT RE-DERIVED. On the
--             applied 001–012 set the table is `relrowsecurity = true`,
--             `relforcerowsecurity = true`, zero policies: 007 created it
--             through app.finalise_table, which enables and forces. The finding
--             described doc 02's prose, and the executable schema had already
--             overtaken it. Closed with that evidence; 013 does not touch the
--             table, and $verify$ re-asserts the posture so a later edit that
--             loosens it fails THIS migration's guard too.
--         (b) public.agent_api_keys did not exist. It is created here, enabled
--             AND forced at creation through app.finalise_table.
--         `key_hash` IS NOT ON IT. MECHANISM, stated because the finding asks
--         for the mechanism and not the intent: the hash lives in
--         `app.agent_api_key_secrets`, a separate table in the `app` schema.
--         `app` is not in config.toml's exposed schemas, so PostgREST cannot
--         reach it AT ALL — `select=*` on public.agent_api_keys cannot name a
--         column that is not in the table, and cannot embed a relation in a
--         schema the Data API does not serve. That is strictly stronger than
--         omitting a column from a grant, which survives exactly as long as
--         nobody writes `GRANT SELECT ON public.agent_api_keys`.
--
--   M-03  app.usage_rollup EXISTS. It is the per (tenant, period, scope, key)
--         aggregate the usage screen reads, and core.budget_status is defined
--         against it rather than against a phantom. The NEAR / PAUSED
--         transition the budget screen reads is defined once, in that view:
--         PAUSED at spend >= cap, NEAR at spend >= cap * near_threshold,
--         WITHIN otherwise, with near_threshold a per-budget numeric(4,3)
--         defaulting to 0.800. Ordering matters and is asserted: a budget at
--         exactly its cap is PAUSED, not NEAR.
--
--   M-10  All four halves, and the mechanism for each is named.
--         (1) THE RAW KEY IS NOT A PARAMETER ANYWHERE. public.ai_provider_key_set
--             and _rotate take `p_masked_key`, `p_fingerprint bytea` and
--             `p_key_ref text` — never the key. The material is written to the
--             platform secret store by the Edge Function that holds it and never
--             transits Postgres, so there is no parameter position for
--             log_min_duration_statement or pg_stat_activity to expose.
--             RESIDUAL EXPOSURE, STATED HONESTLY AND NOT MINIMISED: doc 02 §6.1
--             requires the mask to be computed IN THE DATABASE so it cannot be
--             faked. With the key out of the database that is no longer
--             possible, and a caller can present a mask that does not correspond
--             to the key it stored. What survives is (i) app.mask_key(), kept
--             here as the ONE definition of the mask so the Edge Function and
--             any future in-database path cannot disagree, (ii) a CHECK that
--             refuses a masked_key which is not mask-SHAPED, and (iii) the
--             fingerprint, which is what actually detects "this key was already
--             added". A faked mask is a display defect; a leaked key is not.
--             That trade is deliberate and it is the finding's own priority
--             order.
--         (2) app.aal2_verified(), not app.aal(). The reveal grant calls the
--             function 011 created, which grounds the assertion in an
--             auth.sessions row GoTrue wrote rather than in a claim the caller
--             presents. The pin proves both directions with real auth.sessions
--             fixtures.
--         (3) THE 24-HOUR CEILING IS IN THE DATABASE. One reveal per provider
--             key per 24 hours, enforced by an
--             `UPDATE ... WHERE last_revealed_at IS NULL OR last_revealed_at <=
--             now() - interval '24 hours' ... RETURNING` on the key row. It is
--             an UPDATE and not a SELECT-then-decide on purpose: the guard is
--             the predicate of the write itself, so two concurrent reveals
--             cannot both pass it.
--         (4) THE AUDIT ROW IS STRUCTURALLY INSEPARABLE FROM THE REVEAL.
--             Following app.redact_event_actor's shape (012, the one audited
--             exemption): the function writes the app.key_access_audit row
--             FIRST, publishes its id into the transaction-local GUC
--             `app.key_reveal_audit`, and only then bumps last_revealed_at. A
--             BEFORE UPDATE trigger on core.ai_provider_keys REFUSES any change
--             to last_revealed_at whose GUC does not name an audit row for this
--             tenant, this key and this transaction. So a reveal that cannot
--             write its audit row cannot bump the ceiling, and a reveal that
--             skips the audit entirely is refused by the trigger rather than by
--             the function's good intentions. The pin executes the refusal.
--
--   M-11  AGENT KEY GENERATOR, SPECIFIED, AND SALTED ANYWAY — with the reason.
--         The generator is `extensions.gen_random_bytes(32)` rendered base64url
--         behind the prefix `tk_ag_`: 256 bits from the platform CSPRNG, which
--         is the same argument that makes 02 §5.1's portal tokens safe under
--         plain SHA-256. Under that entropy a work-factor KDF (bcrypt, argon2)
--         buys nothing — a work factor defends a LOW-entropy secret, and it
--         would put a deliberate delay on the agent authentication path, which
--         runs on every agent turn. So: SHA-256, one round, but with a per-key
--         16-byte salt, because the salt is free HERE and the unsalted form
--         leaks a real fact: identical digests across tenants would reveal that
--         two tenants hold the same key. COMPARISON STAYS AN INDEXED EQUALITY:
--         the lookup is by `key_prefix`, which is UNIQUE and indexed, and the
--         digest comparison is a single bytea equality on the one row that
--         returns. app.verify_agent_key() is that lookup, and it is the only
--         reader of app.agent_api_key_secrets.
--
--   M-16  core.evals.run_id is indexed — `evals_run_idx (tenant_id, run_id)
--         WHERE run_id IS NOT NULL`, the COMPOSITE the FK actually needs rather
--         than the single column the finding names, because every FK in this
--         pack is composite. Every other FK created here gets the same
--         treatment; $verify$ re-derives the list from pg_constraint and fails
--         on an unindexed one rather than trusting this paragraph.
--
--   M-25  RUN I/O MASKING, AND WHAT IS STILL ONLY IN THE WORKER.
--         WHAT IS NOW IN THE DATABASE: a BEFORE INSERT OR UPDATE trigger on
--         core.run_node_io runs app.redact_pii() over `prompt` and `completion`
--         and RE-DERIVES `redaction` from what it found, so the counts are the
--         database's observation and not the worker's claim. The five patterns
--         are the five doc 05 §6.7 names — email, Malaysian mobile, NRIC,
--         passport, bank account — and the trigger is idempotent: masking
--         already-masked text is a no-op, so the worker's pass and the
--         database's pass compose instead of double-numbering.
--         WHAT IS STILL ONLY IN THE WORKER, AND IS THEREFORE UNVERIFIABLE BY
--         ANY TEST IN THIS PACK — said plainly, because an unverifiable control
--         described as a control is the failure mode the finding is about:
--           * NAMES. Not masked by anything, anywhere. No pattern can find
--             "Alex Selvarajah" in a sentence without a name list.
--           * ADDRESSES, JOB TITLES and COMPANY-IDENTIFYING TEXT. Same.
--           * core.run_state_cards.goal / decisions / constraints /
--             open_questions. Doc 05 §6.7 concedes these MAY carry client text
--             verbatim and keeps them indefinitely. 013 does not mask them and
--             does not put them under the 30-day rule, because doc 05 says they
--             are authored summaries; if that is ever found to be false the
--             columns move under app.redact_run_io and this paragraph is the
--             record of the assumption.
--           * core.run_nodes.args / result. Nulled at 30 days by
--             app.redact_run_io, not masked at write time — tool arguments are
--             arbitrary jsonb and a regex over a json document masks the keys
--             as readily as the values.
--         AND THE INDEX THE FINDING ASKS FOR: core.run_node_io carries
--         `subject_type` / `subject_id` and
--         `run_node_io_subject_idx (tenant_id, subject_type, subject_id)`, so a
--         manual erasure can find the rows. RESIDUE, NAMED: those two columns
--         are WRITTEN BY THE WORKER. An unpopulated subject is an erasure that
--         still cannot find its rows, and no constraint here can make the worker
--         populate them, because a node that legitimately touches no record must
--         still be storable.
--
--   N-02 / R-JSONB  Every jsonb column 013 creates carries a CHECK asserting KEY
--         PRESENCE with `?` AND type with jsonb_typeof, following doc 04 §4.3's
--         pattern — the one it arrived at by EXECUTION, after
--         `{"enabled":true,"quorum":2,"of":3}` was accepted by a constraint that
--         looked careful. The five doc 05 names — core.runs.trigger,
--         core.runs.halted_by, core.run_state_cards.plan,
--         core.run_state_cards.budgets, core.run_checkpoints.cursor — are
--         covered, and so are the eleven it does not name. $verify$ re-derives
--         the coverage from pg_attribute rather than from this list: a jsonb
--         column added later with no constraint fails the migration.
--
--   N-09  ONE actor vocabulary, and it is 012's. Every actor column here —
--         app.key_access_audit.actor, core.agents.paused_by,
--         core.ai_provider_keys.added_by — points its CHECK at
--         app.is_valid_actor, the function 012 created. 013 declares NO second
--         copy. Doc 05 §5.4 documents key_access_audit.actor with THREE kinds
--         (HUMAN|AGENT|SYSTEM); the constraint admits FOUR, because doc 02 §0
--         fixes four as the cross-lane convention and 003's app.actor_kind enum
--         is the four. $verify$ asserts the validator still matches that enum.
--
--   C-04 residue  NOTHING here is granted to anon or authenticated — no table,
--         no view, no sequence, no function. Grants land in 014 beside the
--         policies. $verify$ asserts zero client privileges per table and per
--         function, and the pin re-probes it by impersonation.
--
-- ── THE RLS/DEFINER RESIDUE, CARRIED NOT CLOSED ───────────────────────────
--
-- Every table here is FORCE ROW LEVEL SECURITY with zero policies. FORCE removes
-- the owner's exemption, so on a platform whose migration owner lacks BYPASSRLS
-- a SECURITY DEFINER function of 013's reads ZERO ROWS from its own tables,
-- silently (supabase/CLAUDE.md §2, measured at 002). 011 and 012 took that
-- posture and handed it to 014; 013 does the same rather than closing it with a
-- `USING (true)` policy, which on a tenant-scoped table is a cross-tenant read
-- grant arriving before the grant layer exists.
--
-- WHAT 013 DOES ABOUT IT, BECAUSE ONE OF ITS FUNCTIONS IS A SECURITY CONTROL:
-- the reveal ceiling and the key-access audit are written so they FAIL CLOSED
-- under that residue rather than open. The ceiling is the predicate of an
-- UPDATE, so no visible row means no reveal. The audit is an INSERT, so a
-- refused WITH CHECK aborts the transaction and the reveal with it. A ceiling
-- implemented as `SELECT count(*) ... IF v < 1 THEN allow` would have degraded
-- to "always allow" under exactly the same residue, and that is the shape this
-- file deliberately does not use. Verifiable today only where the cluster's
-- owner is not a superuser, which the local harness's is: recorded, and the
-- SHAPE is what the pin can prove.
--
-- ── AUTHORIZATION ────────────────────────────────────────────────────────
--   Nothing to anon or authenticated. service_role receives EXECUTE on exactly
--   the run-engine and worker surface: app.verify_agent_key, app.redact_run_io,
--   app.record_key_access and app.roll_up_usage. It does NOT receive the four
--   provider-key RPCs — those are an ADMIN's, through PostgREST, in 014 — and it
--   does not receive app.mask_key or any validator.
--
-- ── THE 7-POINT RPC CONTRACT CHECK, worked ───────────────────────────────
--   1. Envelope: five client-callable RPCs are added
--      (public.ai_provider_key_set / _test / _rotate / _delete / _reveal). Every
--      one returns SUCCESS through app.ok(), so the envelope is BUILT rather
--      than conventional. 013 is the FIRST migration to call app.ok at all:
--      001's header says "every RPC in 011 and 016 returns through these two
--      functions" and 011 in fact calls neither, raising with a DETAIL code
--      instead. Errors here follow 011's actual shape and not 001's claim -
--      RAISE with an ERRCODE and a jsonb DETAIL carrying `code` - because an
--      exception is what rolls the transaction back, and app.err() returning
--      normally would commit a half-done write. Recorded in CONTRADICTIONS.
--      None is granted to a client role yet (C-04 residue), so
--      they are unreachable until 014 — declared now because the table they
--      guard exists now, and a table with no write path is a table somebody
--      writes to directly.
--   2. Unwrap: app.ok(p_data) emits exactly {success, data}. No RPC here adds a
--      sibling key at the top level; the 037 mechanism is satisfied by
--      construction because none of them builds its own object.
--   3. RpcMap: five entries to add in 014 when the grants land —
--      POST /v1/ai/providers, /{id}/test, /{id}/rotate, DELETE /{id},
--      POST /{id}/reveal. NOT added here: an RpcMap entry for a function no role
--      can execute describes a route that 404s.
--   4. Call sites: app.finalise_table (004) x19. app.is_valid_actor (012) on
--      three columns. app.emit_event (012, 13-arg) from _reveal ONLY: doc 05
--      5.4 says "only REVEAL emits a domain event", and inventing event names
--      for set/test/rotate/delete would put unsigned-off 1.7 catalogue
--      additions into the database. app.aal2_verified
--      (011) from _reveal. app.has_permission (002) from all five.
--   5. Casts: core.budget_status is the ONLY place spend becomes a
--      core.budget_state, and core.model_tier_status the only place a tier
--      becomes a core.tier_status. Neither vocabulary is written to a column
--      anywhere, which is why both are views (04 §5.1: "storing one column means
--      three writers racing to keep it true").
--   6. Reload/restore: no client-visible behaviour yet.
--   7. Public routes: none. anon receives nothing.
--
-- ── CONTRADICTIONS · where the docs disagree with the applied schema ──────
--
-- The SCHEMA wins in every one of these (R13). Recorded rather than silently
-- reshaped, and none of them is edited in another migration's file.
--
--   1. Doc 04 s5.1 types core.model_tiers with app.tier_key, app.admin_state and
--      app.tier_health. NONE of those three exists: 003 generated 62 enums from
--      packages/contract/src/enums.ts and the contract has no admin_state or
--      tier_health, only the DERIVED TierStatus. tier_key becomes an FK to
--      core.tier_keys (003's own routing for an open set); the other two become
--      text + CHECK, doc 03 s1's stated convention.
--   2. Doc 04 s5.1 / s5.3 / s5.4 / s5.5 place model_tier, routing_matrix_version,
--      ai_provider_key and budget in `app`. C-03: `app` is not exposed to
--      PostgREST, and doc 02 s0 says a table there is unreachable by the Data API
--      with no error to explain it. All four are in `core`, plural, as 007 and
--      009 did.
--   3. Doc 05 s6.2 writes a five-value node status CHECK including RUNNING. 003's
--      core.run_step_status has four and the contract's RunStepStatus has the
--      same four. Status is NULLABLE here and "finished implies a status" is the
--      constraint; no fifth enum member is created, because an enum member
--      cannot be removed.
--   4. Doc 05 s5.4 documents app.key_access_audit.actor with THREE actor kinds.
--      Doc 02 s0 fixes four and 003's app.actor_kind is four. The constraint is
--      012's app.is_valid_actor. N-09.
--   5. Doc 05 s5.4 types the vault locator `secret_id uuid` and says the provider
--      detail screen reads the table directly. The locator is `key_ref text`,
--      opaque by 02 s6.1, and the table is in `app`, so that screen needs an RPC
--      in 014/016 - it cannot read it at all today.
--   6. Doc 05 s6.4 gives core.run_events.detail a `default '{}'::jsonb` that
--      satisfies none of its own eight shapes. There is no default here.
--   7. Doc 02 s6.2 says all four provider-key RPCs assert ADMIN plus AAL2. Doc 02
--      s7.2a, later and better argued, says ground the assertion in an
--      auth.sessions row only for the two worst gates and keep the cheap claim
--      check elsewhere. s7.2a is followed.
--   8. Doc 02 s6.1 requires masked_key to be computed IN the database. With the
--      raw key deliberately out of the database (M-10(1)) that is impossible;
--      app.is_masked_key shape-checks it instead. The loss is stated at M-10(1)
--      rather than papered over.
--   9. Doc 05 s6.1 gives core.runs a `unique (tenant_id, ref)` and no ref
--      allocator. app.finalise_table supplies both the constraint and the
--      core.assign_ref trigger, with prefix RUN. No migration seeds the
--      core.ref_formats row; 016 does, and until then core.runs cannot be
--      written for a tenant - the same standing condition every ref'd table in
--      004-010 already has.
--  10. 001's header states "every RPC in 011 and 016 returns through
--      app.ok/app.err". 011 calls NEITHER - checked against the applied set, not
--      assumed. 013 is the first migration that actually does, and only for
--      success; errors RAISE, because an exception is what rolls back.
--  11. Doc 02 s3.1 indexes public.agent_api_keys `where revoked_at is null`. That
--      index cannot also serve the composite FK to core.agents, so it is not
--      partial here.
--  12. core.rate (007) is numeric(6,5) while root CLAUDE.md prescribes
--      numeric(6,4) for rates and numeric(4,3) for scores. 013 uses the explicit
--      types the rule names and does not use the domain, so nothing here inherits
--      the disagreement. Not 013's to settle.
--
-- SPINE: untouched. app.perform_action, the policy gate and the effect ledger
-- are neither read nor rewritten; no action type is added (BUDGET_CAP_RAISE is
-- already one of 011's 22 and needs no branch here); no trigger of 011's or
-- 012's is altered. core.autonomy_grants.agent_id stays `text` WITH NO FOREIGN
-- KEY to core.agents, deliberately: 011 owns that column, an agent is not a row
-- in auth.users, and adding the FK would make 011's kill switch depend on a
-- roster row existing before a grant can. Pipeline configuration is not touched.
--
-- Rollback: rollbacks/013_ai_ops_agents_keys_runs_and_budgets_rollback.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '180s';

-- ═══ 1 · Shared validators, the mask, and the PII pass ══════════════════════
--
-- N-02 in one place per shape rather than one CHECK per column that drifts. Each
-- of these is IMMUTABLE because a CHECK constraint requires it, which is also
-- why the vocabularies below are written out rather than read from pg_enum —
-- reading the catalogue makes a function STABLE and unusable in a constraint.
-- $verify$ asserts each written-out list against the 003 enum it copies, so the
-- copies cannot drift without failing this migration.
--
-- app.is_valid_actor is NOT redeclared. It is 012's, it already enumerates doc
-- 02 §0's four kinds, and a second copy here is exactly the divergence N-09 is
-- about.

-- Doc 02 §6.1's mask, as ONE definition. The Edge Function that holds the raw
-- key computes the same string; this function is what it is computing, so the
-- two cannot disagree about where the dots go. See M-10(1) in the header for why
-- the database can no longer compute it from the key itself, and what that
-- costs.
CREATE OR REPLACE FUNCTION app.mask_key(p_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT CASE
           WHEN p_key IS NULL OR pg_catalog.length(p_key) < 12 THEN NULL
           ELSE pg_catalog."left"(p_key, 7)
                || pg_catalog.repeat('•', 12)
                || pg_catalog."right"(p_key, 4)
         END;
$fn$;

COMMENT ON FUNCTION app.mask_key(text) IS
  'Doc 02 s6.1 masking: left(key,7) || 12 bullets || right(key,4). NULL for a '
  'key too short to mask without revealing most of it - 11 characters masked '
  'this way would show 11 of 11. The ONE definition of the mask.';

-- The shape guard that survives the key not being in the database. A mask is
-- refused unless it actually masks: at least eight consecutive bullets or stars,
-- and no run of more than eight unmasked characters after the prefix.
CREATE OR REPLACE FUNCTION app.is_masked_key(p_value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT p_value IS NOT NULL
     AND pg_catalog.length(p_value) BETWEEN 12 AND 64
     AND p_value ~ '[•*]{8,}'
     AND p_value !~ '[•*][^•*]{9,}$';
$fn$;

COMMENT ON FUNCTION app.is_masked_key(text) IS
  'M-10(1). With the raw key out of the database the mask can no longer be '
  'DERIVED, so it is SHAPE-checked instead: eight or more masking characters, '
  'and no more than eight visible characters after the last of them. A caller '
  'can still present a mask that does not belong to the key it stored; that is '
  'stated in the header as the residual exposure of keeping the key out of a '
  'logged parameter position.';

-- M-11. The digest is salted, and the salt is a column, so this is a pure
-- function of (key, salt) and the lookup stays an indexed equality on
-- key_prefix followed by one bytea comparison.
CREATE OR REPLACE FUNCTION app.agent_key_digest(p_key text, p_salt bytea)
RETURNS bytea
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT pg_catalog.sha256(p_salt || pg_catalog.convert_to(p_key, 'UTF8'));
$fn$;

COMMENT ON FUNCTION app.agent_key_digest(text, bytea) IS
  'M-11. SHA-256 over (16-byte salt || key). One round, deliberately: the key is '
  'extensions.gen_random_bytes(32) rendered base64url, so there are 256 bits of '
  'CSPRNG entropy and a work-factor KDF defends nothing while adding latency to '
  'every agent turn. The salt is here because it is free - the lookup is by '
  'key_prefix, not by digest - and it removes the cross-tenant correlation an '
  'unsalted digest leaks.';

-- ── N-02 validators ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION app.is_valid_run_trigger(p_value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT p_value IS NOT NULL
     AND pg_catalog.jsonb_typeof(p_value) = 'object'
     AND p_value ? 'type'
     AND pg_catalog.jsonb_typeof(p_value -> 'type') = 'string'
     AND NULLIF(pg_catalog.btrim(p_value ->> 'type'), '') IS NOT NULL
     AND (NOT p_value ? 'ref'
          OR pg_catalog.jsonb_typeof(p_value -> 'ref') IN ('string', 'null'));
$fn$;

COMMENT ON FUNCTION app.is_valid_run_trigger(jsonb) IS
  'core.runs.trigger, one of the five N-02 names doc 05 gives. {type, ref?} per '
  'the contract RunTrigger. `type` must be present AND a non-blank string: the '
  'naive `trigger->>''type'' IS NOT NULL` passes an object with no type key at '
  'all, which is doc 04 s735''s trap.';

CREATE OR REPLACE FUNCTION app.is_valid_halted_by(p_value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT p_value IS NOT NULL
     AND pg_catalog.jsonb_typeof(p_value) = 'object'
     AND p_value ? 'policyId'
     AND p_value ? 'approvalRequestRef'
     AND p_value ? 'reason'
     AND pg_catalog.jsonb_typeof(p_value -> 'policyId') = 'string'
     AND pg_catalog.jsonb_typeof(p_value -> 'approvalRequestRef') IN ('string','null')
     AND pg_catalog.jsonb_typeof(p_value -> 'reason') = 'string';
$fn$;

COMMENT ON FUNCTION app.is_valid_halted_by(jsonb) IS
  'core.runs.halted_by and core.run_nodes.halted_by. The contract HaltedBy is '
  '{policyId, approvalRequestRef, reason} and doc 05 s6.2 calls it the thing '
  'that PROVES the agent never sent anything - so a halt with no policy named is '
  'not evidence and is refused.';

CREATE OR REPLACE FUNCTION app.is_valid_run_failure(p_value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT p_value IS NOT NULL
     AND pg_catalog.jsonb_typeof(p_value) = 'object'
     AND p_value ? 'code'
     AND p_value ? 'message'
     AND p_value ? 'attempts'
     AND p_value ? 'retryable'
     AND p_value ? 'deadLettered'
     AND pg_catalog.jsonb_typeof(p_value -> 'code') = 'string'
     AND pg_catalog.jsonb_typeof(p_value -> 'message') = 'string'
     AND pg_catalog.jsonb_typeof(p_value -> 'attempts') = 'number'
     AND pg_catalog.jsonb_typeof(p_value -> 'retryable') = 'boolean'
     AND pg_catalog.jsonb_typeof(p_value -> 'deadLettered') = 'boolean';
$fn$;

CREATE OR REPLACE FUNCTION app.is_valid_plan(p_value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT p_value IS NOT NULL
     AND pg_catalog.jsonb_typeof(p_value) = 'array'
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.jsonb_array_elements(p_value) AS step(value)
        WHERE NOT (
              pg_catalog.jsonb_typeof(step.value) = 'object'
          AND step.value ? 'n'
          AND step.value ? 'label'
          AND step.value ? 'status'
          AND pg_catalog.jsonb_typeof(step.value -> 'n') = 'number'
          AND pg_catalog.jsonb_typeof(step.value -> 'label') = 'string'
          AND pg_catalog.jsonb_typeof(step.value -> 'status') = 'string'
          AND step.value ->> 'status' IN
              ('PENDING','RUNNING','DONE','SKIPPED','HALTED','FAILED')));
$fn$;

COMMENT ON FUNCTION app.is_valid_plan(jsonb) IS
  'core.run_state_cards.plan, an N-02 name. The contract StateCardPlanStep is '
  '{n, label, status} with status a PlanStepStatus - ruling R10 made it an enum '
  'because "a plan step that has not started and one that failed were the same '
  'untyped string before". 003 did not create a plan_step_status type (the six '
  'values are in enums.ts but not among the 62 it generated), so the vocabulary '
  'is written out here and this is the only copy.';

CREATE OR REPLACE FUNCTION app.is_valid_state_card_budgets(p_value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT p_value IS NOT NULL
     AND pg_catalog.jsonb_typeof(p_value) = 'object'
     AND p_value ? 'tokens'
     AND p_value ? 'cost'
     AND pg_catalog.jsonb_typeof(p_value -> 'tokens') = 'object'
     AND pg_catalog.jsonb_typeof(p_value -> 'cost') = 'object'
     AND (p_value -> 'tokens') ? 'used'
     AND (p_value -> 'tokens') ? 'limit'
     AND (p_value -> 'cost') ? 'used'
     AND (p_value -> 'cost') ? 'limit'
     AND pg_catalog.jsonb_typeof(p_value -> 'tokens' -> 'used')  = 'number'
     AND pg_catalog.jsonb_typeof(p_value -> 'tokens' -> 'limit') = 'number'
     AND pg_catalog.jsonb_typeof(p_value -> 'cost' -> 'used')    = 'number'
     AND pg_catalog.jsonb_typeof(p_value -> 'cost' -> 'limit')   = 'number';
$fn$;

COMMENT ON FUNCTION app.is_valid_state_card_budgets(jsonb) IS
  'core.run_state_cards.budgets, an N-02 name. Doc 05 s6.5: this object is what '
  'the M18-S04 budget bars render and what a BUDGET_EXCEEDED run event is fired '
  'against. A card whose budgets carry a limit and no used renders a bar with no '
  'fill and reports nothing.';

CREATE OR REPLACE FUNCTION app.is_valid_checkpoint_cursor(p_value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT p_value IS NOT NULL
     AND pg_catalog.jsonb_typeof(p_value) = 'object'
     AND p_value ? 'nodeKey'
     AND p_value ? 'step'
     AND pg_catalog.jsonb_typeof(p_value -> 'nodeKey') IN ('string','null')
     AND pg_catalog.jsonb_typeof(p_value -> 'step') = 'number';
$fn$;

COMMENT ON FUNCTION app.is_valid_checkpoint_cursor(jsonb) IS
  'core.run_checkpoints.cursor, an N-02 name. Doc 05 s6.5 calls it "engine '
  'resume position" and gives no shape, so the two things a resume cannot happen '
  'without are required: which node to resume at (nullable - resuming at the '
  'orchestrator is a real case) and which step. An empty object is refused, '
  'because a checkpoint that cannot be resumed from is not replayable and the '
  'retry endpoint would find nothing to do.';

-- Doc 04 s4.3's pattern, reproduced so the routing matrix's jury and 007's
-- provenance jury are the same rule. 007 wrote it inline on one column; this is
-- that expression as a function, and $verify$ asserts the two agree by feeding
-- both the legacy boolean form.
CREATE OR REPLACE FUNCTION app.is_valid_jury_policy(p_value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT p_value IS NOT NULL
     AND pg_catalog.jsonb_typeof(p_value) = 'object'
     AND p_value ? 'mode'
     AND p_value ? 'quorum'
     AND p_value ? 'of'
     AND p_value ->> 'mode' IN ('GATE','SAMPLE','ESCALATE')
     AND pg_catalog.jsonb_typeof(p_value -> 'quorum') = 'number'
     AND pg_catalog.jsonb_typeof(p_value -> 'of') = 'number'
     AND (p_value ->> 'quorum')::int >= 1
     AND (p_value ->> 'quorum')::int <= (p_value ->> 'of')::int
     AND (p_value ->> 'mode' <> 'SAMPLE'
          OR (p_value ? 'sampleRate'
              AND pg_catalog.jsonb_typeof(p_value -> 'sampleRate') = 'number'
              AND (p_value ->> 'sampleRate')::numeric > 0
              AND (p_value ->> 'sampleRate')::numeric <= 1))
     AND (p_value ->> 'mode' <> 'ESCALATE'
          OR (p_value ? 'triggers'
              AND pg_catalog.jsonb_typeof(p_value -> 'triggers') = 'object'));
$fn$;

COMMENT ON FUNCTION app.is_valid_jury_policy(jsonb) IS
  'DECISIONS s2 / doc 04 s4.3, structurally. The legacy boolean form '
  '{"enabled":true,"quorum":2,"of":3} is REFUSED - it has no `mode` key, and the '
  'naive spelling that reads mode before testing for it evaluates to NULL, which '
  'a CHECK satisfies. 007 carries the same expression inline on '
  'core.provenance.jury; $verify$ feeds the boolean form to both.';

CREATE OR REPLACE FUNCTION app.is_valid_metric_condition(p_value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT p_value IS NOT NULL
     AND pg_catalog.jsonb_typeof(p_value) = 'object'
     AND p_value ? 'metric'
     AND p_value ? 'op'
     AND p_value ? 'value'
     AND pg_catalog.jsonb_typeof(p_value -> 'metric') = 'string'
     AND pg_catalog.jsonb_typeof(p_value -> 'op') = 'string'
     AND pg_catalog.jsonb_typeof(p_value -> 'value') = 'number';
$fn$;

COMMENT ON FUNCTION app.is_valid_metric_condition(jsonb) IS
  'core.agents.resume_condition. The SAME shape 011 wrote inline on '
  'core.autonomy_grants.resume_condition and promotion_condition, as a function '
  'this time so there is one rule. 011 is NOT edited to call it - a fix made '
  'silently in another migration''s file is a fix nobody can find - but $verify$ '
  'asserts the two agree on the legacy form.';

CREATE OR REPLACE FUNCTION app.is_valid_run_event_detail(p_type core.run_event_type, p_detail jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT p_detail IS NOT NULL
     AND pg_catalog.jsonb_typeof(p_detail) = 'object'
     AND CASE p_type
           WHEN 'ESCALATION' THEN
             p_detail ? 'from' AND p_detail ? 'to' AND p_detail ? 'confidence'
             AND pg_catalog.jsonb_typeof(p_detail -> 'confidence') = 'number'
           WHEN 'JURY' THEN
             p_detail ? 'mode' AND p_detail ? 'quorum' AND p_detail ? 'of'
             AND p_detail ? 'votes'
             AND pg_catalog.jsonb_typeof(p_detail -> 'votes') = 'array'
             AND p_detail ->> 'mode' IN ('GATE','SAMPLE','ESCALATE')
           WHEN 'TRUNCATION' THEN
             p_detail ? 'tool' AND p_detail ? 'storedTokens'
             AND pg_catalog.jsonb_typeof(p_detail -> 'storedTokens') = 'number'
           WHEN 'HANDOFF' THEN
             p_detail ? 'atContextPct' AND p_detail ? 'checkpointStep'
             AND pg_catalog.jsonb_typeof(p_detail -> 'atContextPct') = 'number'
           WHEN 'CHECKPOINT' THEN
             p_detail ? 'step' AND p_detail ? 'replayable'
             AND pg_catalog.jsonb_typeof(p_detail -> 'step') = 'number'
             AND pg_catalog.jsonb_typeof(p_detail -> 'replayable') = 'boolean'
           WHEN 'POLICY_HALT' THEN
             p_detail ? 'policyId' AND p_detail ? 'approvalRequestRef'
           WHEN 'CACHE_HIT' THEN
             p_detail ? 'node' AND p_detail ? 'savedTokens'
             AND pg_catalog.jsonb_typeof(p_detail -> 'savedTokens') = 'number'
           WHEN 'BUDGET_EXCEEDED' THEN
             p_detail ? 'scope' AND p_detail ? 'limit' AND p_detail ? 'used'
             AND pg_catalog.jsonb_typeof(p_detail -> 'limit') = 'number'
             AND pg_catalog.jsonb_typeof(p_detail -> 'used') = 'number'
           ELSE false
         END;
$fn$;

COMMENT ON FUNCTION app.is_valid_run_event_detail(core.run_event_type, jsonb) IS
  'N-02, per run event type. Doc 05 s6.4 gives eight exact detail shapes and no '
  'constraint at all; this is those eight, keyed on the 003 enum so a ninth '
  'member added to core.run_event_type reaches the ELSE and is refused rather '
  'than admitted unchecked. That is deliberate: an unconstrained new type is how '
  'a shape stops being enforced without anybody editing a constraint.';

-- ── M-25 · the PII pass that is actually IN the database ───────────────────
--
-- Doc 05 s6.7 masks five patterns IN THE WORKER, which is outside every test in
-- this pack. These three functions put the same five patterns inside the
-- database, on a trigger, so the masking is a property of the stored row rather
-- than a property of a worker nobody here can run. Read the header for the list
-- of what is STILL only in the worker; it is longer than this list and that is
-- the honest part.
--
-- Numbering is per document so co-reference survives: the same email twice is
-- «email:1» twice, which is the whole reason doc 05 numbers them.

CREATE OR REPLACE FUNCTION app.redact_pattern(p_text text, p_pattern text, p_label text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
DECLARE
  v_out  text := p_text;
  v_hit  text;
  v_seen text[] := ARRAY[]::text[];
  v_n    integer := 0;
BEGIN
  IF v_out IS NULL THEN
    RETURN NULL;
  END IF;
  -- The match set is computed ONCE, off the value as it arrives. Replacements
  -- below rewrite v_out, and re-scanning a partly-masked document would find the
  -- placeholders it had just written.
  FOR v_hit IN
    SELECT found.match[1]
      FROM pg_catalog.regexp_matches(v_out, '(' || p_pattern || ')', 'g') AS found(match)
  LOOP
    IF NOT (v_hit = ANY (v_seen)) THEN
      v_seen := v_seen || v_hit;
      v_n := v_n + 1;
      v_out := pg_catalog.replace(v_out, v_hit, '«' || p_label || ':' || v_n::text || '»');
    END IF;
  END LOOP;
  RETURN v_out;
END;
$fn$;

CREATE OR REPLACE FUNCTION app.redact_pii(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
  -- Order is load-bearing. Email first, or the digits inside an address are
  -- taken for an account number. NRIC before the bare digit run, or
  -- `880101-14-5501` loses its shape. Passport before the digit run for the
  -- same reason.
  SELECT app.redact_pattern(
           app.redact_pattern(
             app.redact_pattern(
               app.redact_pattern(
                 app.redact_pattern(p_text,
                   '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', 'email'),
                 '(\+?60|0)1\d[- ]?\d{3,4}[- ]?\d{4}', 'phone'),
               '\d{6}-\d{2}-\d{4}', 'nric'),
             '\y[A-Z]{1,2}\d{7,8}\y', 'passport'),
           '\y\d{10,16}\y', 'acct');
$fn$;

COMMENT ON FUNCTION app.redact_pii(text) IS
  'Doc 05 s6.7''s five patterns, in the database. IDEMPOTENT by construction: a '
  'placeholder «email:1» matches none of the five, so running this over text the '
  'worker already masked changes nothing and the two passes compose rather than '
  'double-number. Postgres ARE uses \y for a word boundary, not \b - \b is a '
  'backspace here and the passport and account patterns would match inside '
  'longer runs.';

CREATE OR REPLACE FUNCTION app.placeholder_count(p_text text, p_label text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT COALESCE((
    SELECT pg_catalog.count(DISTINCT found.match[1])::integer
      FROM pg_catalog.regexp_matches(
             COALESCE(p_text, ''), '«' || p_label || ':(\d+)»', 'g') AS found(match)
  ), 0);
$fn$;

CREATE OR REPLACE FUNCTION app.pii_counts(p_text text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
    'emails',    app.placeholder_count(p_text, 'email'),
    'phones',    app.placeholder_count(p_text, 'phone'),
    'nric',      app.placeholder_count(p_text, 'nric'),
    'passports', app.placeholder_count(p_text, 'passport'),
    'accounts',  app.placeholder_count(p_text, 'acct'));
$fn$;

COMMENT ON FUNCTION app.pii_counts(text) IS
  'Doc 05 s6.7''s redaction counts, DERIVED from the stored text rather than '
  'taken from the worker''s word. Counting placeholders and not matches is what '
  'makes the figure right when the worker has already masked: the database sees '
  '«email:1» and reports one email, which is true, instead of finding no raw '
  'email and reporting none, which is not.';

CREATE OR REPLACE FUNCTION app.mask_run_io()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
DECLARE
  -- One document, so numbering is shared across prompt and completion: an email
  -- that appears in both is «email:1» in both, which is the co-reference doc 05
  -- s6.7 asks for. US (0x1F) is the join because it is a control character no
  -- model emits; any that arrives is replaced first so the split cannot be
  -- steered by the content.
  v_sep  constant text := pg_catalog.chr(31);
  v_doc  text;
  v_out  text;
BEGIN
  v_doc := pg_catalog.replace(COALESCE(NEW.prompt, ''), v_sep, ' ')
           || v_sep
           || pg_catalog.replace(COALESCE(NEW.completion, ''), v_sep, ' ');

  v_out := app.redact_pii(v_doc);

  NEW.prompt := CASE WHEN NEW.prompt IS NULL THEN NULL
                     ELSE pg_catalog.split_part(v_out, v_sep, 1) END;
  NEW.completion := CASE WHEN NEW.completion IS NULL THEN NULL
                         ELSE pg_catalog.split_part(v_out, v_sep, 2) END;
  NEW.redaction := app.pii_counts(v_out);
  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION app.mask_run_io() IS
  'M-25. BEFORE INSERT OR UPDATE on core.run_node_io. The database''s own pass '
  'over doc 05 s6.7''s five patterns, and the derivation of the redaction '
  'counts. It does NOT replace the worker''s pass - the worker''s pass is what '
  'keeps the raw value off the wire - and it does NOT mask names, addresses, job '
  'titles or company-identifying text, which nothing in this system masks. The '
  'header says so at length; this comment says so too, because the next reader '
  'will find this function before they find the header.';

-- ═══ 2 · core.tier_keys · the reference table 003 deferred and 004 did not build
--
-- 003's header splits the world: closed catalogues the contract froze become
-- native enums; "open, config-driven sets become `text` with a foreign key to a
-- reference table. Never `text + CHECK`", and it names the tier key among the
-- eight that "arrive in 004 as tables, not here as types". 004 does not create
-- it - checked against pg_class on the applied set, not assumed - so the FK
-- 013's tier columns need has nothing to point at. It is created here rather
-- than replaced by a CHECK, because a CHECK is code and this table is edited by
-- an admin screen.
--
-- PER TENANT, with no seed. That is core.check_keys' shape (004) and the same
-- reasoning: TIER_KEYS has nine members in the contract today, a tenant on a
-- single provider will use three of them, and 016 provisions the rows. A
-- migration that seeded nine tier keys into every tenant would be putting
-- routing configuration into the database before anybody chose it.
CREATE TABLE core.tier_keys (
  id          uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  tier_key    text        NOT NULL CHECK (tier_key ~ '^[A-Z][A-Z0-9_]*$'),
  label       text        NOT NULL,
  description text,
  position    smallint    NOT NULL DEFAULT 0,
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at  timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT tier_keys_natural_key UNIQUE (tenant_id, tier_key)
);

COMMENT ON TABLE core.tier_keys IS
  'The 17 TierKey reference table. 003 routed the tier key to a reference table '
  'in 004 and 004 did not create one; every tier column in 013 has a composite '
  'FK to this. No rows are seeded - 016 provisions them per tenant, the same way '
  'core.check_keys and core.ref_formats are provisioned.';

SELECT app.finalise_table('core','tier_keys',false,NULL,
  ARRAY['tier_key']);

CREATE INDEX tier_keys_active_idx
  ON core.tier_keys (tenant_id, position, tier_key) WHERE active;

-- ═══ 3 · core.agents and the agent credential ═══════════════════════════════

CREATE TABLE core.agents (
  id                uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  ref               text,

  -- The STABLE slug, and the reason this table's key story is unusual. Doc 02
  -- 3.1 and 011's core.autonomy_grants both address an agent by a text id, and
  -- public.memberships.agent_id (002) is text. That is kept: an agent is not a
  -- row in auth.users, `agent_id` is what the JWT carries (app.agent_id()), and
  -- retyping it to this table's uuid would break the claim, the membership row
  -- and every autonomy grant at once.
  agent_id          text        NOT NULL
                                CHECK (agent_id ~ '^[a-z][a-z0-9_]*$'),
  name              text        NOT NULL
                                CHECK (NULLIF(pg_catalog.btrim(name), '') IS NOT NULL),
  status            core.agent_status NOT NULL DEFAULT 'ACTIVE',

  -- Doc 02 3.1: "core.agents gains principal_user_id uuid not null references
  -- auth.users(id)". One inert auth.users row per agent per tenant, so `sub`
  -- points at something, auth.uid() is not null, and every created_by column in
  -- the estate keeps its FK.
  principal_user_id uuid        NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,

  orchestrator      text,
  scopes            text[]      NOT NULL DEFAULT ARRAY[]::text[],

  -- 02 3.3's kill switch, as a column on the roster. 011 owns the GATE that
  -- reads it; this is where the bit lives.
  kill_switch       boolean     NOT NULL DEFAULT false,
  paused_at         timestamptz,
  paused_reason     text,
  paused_by         jsonb,
  resume_condition  jsonb,

  default_tier      text,
  escalation_ladder text[]      NOT NULL DEFAULT ARRAY[]::text[],
  jury              jsonb,

  last_run_at       timestamptz,

  created_at        timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at        timestamptz NOT NULL DEFAULT pg_catalog.now(),

  CONSTRAINT agents_natural_key UNIQUE (tenant_id, agent_id),
  CONSTRAINT agents_principal_key UNIQUE (tenant_id, principal_user_id),
  CONSTRAINT agents_paused_has_time CHECK (
    status <> 'PAUSED' OR paused_at IS NOT NULL),
  CONSTRAINT agents_paused_by_shape CHECK (
    paused_by IS NULL OR app.is_valid_actor(paused_by)),
  CONSTRAINT agents_resume_shape CHECK (
    resume_condition IS NULL OR app.is_valid_metric_condition(resume_condition)),
  CONSTRAINT agents_jury_shape CHECK (
    jury IS NULL OR app.is_valid_jury_policy(jury)),
  CONSTRAINT agents_default_tier_fk FOREIGN KEY (tenant_id, default_tier)
    REFERENCES core.tier_keys (tenant_id, tier_key) ON DELETE RESTRICT
);

COMMENT ON TABLE core.agents IS
  'The agent roster (contract 10 Agent). `agent_id` is text and stays text: '
  'public.memberships.agent_id (002) and core.autonomy_grants.agent_id (011) '
  'both address an agent that way and an agent is not a row in auth.users. NO '
  'foreign key is added to core.autonomy_grants - 011 owns that column, and a '
  'grant that cannot exist until a roster row does would make the kill switch '
  'depend on provisioning order.';

COMMENT ON COLUMN core.agents.escalation_ladder IS
  'Kept on the roster because contract 10 Agent still carries it, with the '
  'comment that "the escalation ladder was dropped from this table during the '
  'fit pass; it lives on M20-S20". Both are true: core.routing_entries owns the '
  'per-action ladder, this is the agent-level default. Recorded so the '
  'duplication reads as a decision.';

SELECT app.finalise_table('core','agents',true,'AGT',
  ARRAY['agent_id','principal_user_id']);

CREATE INDEX agents_status_idx ON core.agents (tenant_id, status, agent_id);
CREATE INDEX agents_killed_idx ON core.agents (tenant_id) WHERE kill_switch;
CREATE INDEX agents_default_tier_idx
  ON core.agents (tenant_id, default_tier) WHERE default_tier IS NOT NULL;
-- M-16 generalised: EVERY foreign key this migration creates gets a covering
-- index, the single-column ones into auth.users and app.action_types included.
-- principal_user_id is ON DELETE RESTRICT, so without this a user deletion
-- sequentially scans the roster under an exclusive lock, which is the exact
-- shape M-16 found on memberships.primary_team_id.
CREATE INDEX agents_principal_user_idx ON core.agents (principal_user_id);

-- ── H-09 · the credential, split in two ────────────────────────────────────
--
-- `public`, because doc 02 3.1 owns it and public is the exposed identity
-- schema. RLS enabled AND forced at creation, which is the half of H-09 that was
-- genuinely open. What is NOT here is `key_hash`: see app.agent_api_key_secrets
-- below and the mechanism paragraph in the header.
CREATE TABLE public.agent_api_keys (
  id           uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  agent_id     text        NOT NULL,
  label        text,
  -- 'tk_ag_' + the first ten characters of the key body. Support and logs quote
  -- this; it is also the lookup key, which is what keeps verification an indexed
  -- equality after the digest was salted (M-11).
  key_prefix   text        NOT NULL
                           CHECK (key_prefix ~ '^tk_ag_[A-Za-z0-9_-]{10}$'),
  created_by   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  last_used_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at   timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT agent_api_keys_prefix_key UNIQUE (key_prefix),
  CONSTRAINT agent_api_keys_agent_fk FOREIGN KEY (tenant_id, agent_id)
    REFERENCES core.agents (tenant_id, agent_id) ON DELETE CASCADE
);

COMMENT ON TABLE public.agent_api_keys IS
  'Doc 02 3.1, H-09. Metadata ONLY. The digest and its salt are in '
  'app.agent_api_key_secrets, in a schema config.toml does not expose, so '
  'PostgREST cannot reach them through select=* or through an embed - which is '
  'stronger than omitting a column from a grant, a protection that lasts exactly '
  'until somebody writes GRANT SELECT on this table. RLS is enabled AND FORCED '
  'here; doc 02 wrote two policies for this table and never enabled RLS, so they '
  'would have been inert.';

SELECT app.finalise_table('public','agent_api_keys',false,NULL,
  ARRAY['agent_id','key_prefix','created_by']);

-- Doc 02 3.1 writes this `where revoked_at is null`. It is NOT partial here,
-- deliberately: the same index has to serve agent_api_keys_agent_fk, and a
-- partial index cannot enforce a foreign key over the rows it excludes. One
-- index that does both jobs beats two that nearly agree.
CREATE INDEX agent_api_keys_tenant_agent_idx
  ON public.agent_api_keys (tenant_id, agent_id);
CREATE INDEX agent_api_keys_created_by_idx
  ON public.agent_api_keys (created_by) WHERE created_by IS NOT NULL;

CREATE TABLE app.agent_api_key_secrets (
  id         uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  api_key_id uuid        NOT NULL,
  key_salt   bytea       NOT NULL CHECK (pg_catalog.octet_length(key_salt) = 16),
  key_digest bytea       NOT NULL CHECK (pg_catalog.octet_length(key_digest) = 32),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT agent_api_key_secrets_one_per_key UNIQUE (tenant_id, api_key_id),
  CONSTRAINT agent_api_key_secrets_digest_key UNIQUE (key_digest),
  CONSTRAINT agent_api_key_secrets_key_fk FOREIGN KEY (tenant_id, api_key_id)
    REFERENCES public.agent_api_keys (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE app.agent_api_key_secrets IS
  'H-09''s mechanism. The salted SHA-256 of an agent key, in the schema the Data '
  'API does not serve. Read by exactly one function, app.verify_agent_key. The '
  'UNIQUE on key_digest is not a lookup path - it is the assertion that two keys '
  'cannot collide, which with a 16-byte salt also means the same raw key issued '
  'twice produces two different rows and neither reveals the other.';

SELECT app.finalise_table('app','agent_api_key_secrets',false,NULL,
  ARRAY['api_key_id','key_salt','key_digest']);

-- M-11. THE GENERATOR IS HERE, in the database, so it is a fact rather than a
-- promise an Edge Function makes. extensions.gen_random_bytes(32) is the
-- platform CSPRNG - the same call 02 5.1 names for portal tokens and the reason
-- those are safe under plain SHA-256.
--
-- The raw key is a RETURN VALUE, never a parameter. That is deliberate and it is
-- the same reasoning as M-10(1): a parameter lands in the statement text, in
-- log_min_duration_statement output and in pg_stat_activity; a result set lands
-- in none of those.
CREATE OR REPLACE FUNCTION app.mint_agent_key(
  p_tenant_id  uuid,
  p_agent_id   text,
  p_label      text DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_key    text;
  v_salt   bytea;
  v_prefix text;
  v_id     uuid;
BEGIN
  IF p_tenant_id IS NULL OR p_agent_id IS NULL THEN
    RAISE EXCEPTION 'mint_agent_key: tenant and agent are required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 32 bytes rendered base64url: 43 characters, 256 bits. translate() maps + and
  -- / and DELETES the padding (three source characters, two replacements), which
  -- is what makes the result url-safe and fixed-length.
  v_key := 'tk_ag_' || pg_catalog.translate(
             pg_catalog.replace(
               pg_catalog.encode(extensions.gen_random_bytes(32), 'base64'),
               pg_catalog.chr(10), ''),
             '+/=', '-_');
  v_prefix := pg_catalog."left"(v_key, 16);
  v_salt := extensions.gen_random_bytes(16);

  INSERT INTO public.agent_api_keys
    (tenant_id, agent_id, label, key_prefix, expires_at)
  VALUES
    (p_tenant_id, p_agent_id, p_label, v_prefix, p_expires_at)
  RETURNING id INTO v_id;

  INSERT INTO app.agent_api_key_secrets
    (tenant_id, api_key_id, key_salt, key_digest)
  VALUES
    (p_tenant_id, v_id, v_salt, app.agent_key_digest(v_key, v_salt));

  -- The ONLY time the raw key exists anywhere. It is not stored, not logged and
  -- not recoverable; a lost key is rotated, never recovered.
  RETURN pg_catalog.jsonb_build_object(
    'id', v_id, 'keyPrefix', v_prefix, 'key', v_key, 'expiresAt', p_expires_at);
END;
$fn$;

COMMENT ON FUNCTION app.mint_agent_key(uuid, text, text, timestamptz) IS
  'M-11. Issues an agent key: extensions.gen_random_bytes(32) base64url behind '
  'the tk_ag_ prefix, a 16-byte salt, and the salted SHA-256 in '
  'app.agent_api_key_secrets. Returns the raw key ONCE, in a result set rather '
  'than through a parameter, and it is unrecoverable afterwards. Granted to '
  'nobody here (C-04 residue); 014 decides whether ADMIN reaches it through '
  'PostgREST or only the exchange Edge Function does.';

CREATE OR REPLACE FUNCTION app.verify_agent_key(p_key text)
RETURNS TABLE (tenant_id uuid, agent_id text, api_key_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_prefix text;
BEGIN
  IF p_key IS NULL OR p_key !~ '^tk_ag_[A-Za-z0-9_-]{10,}$' THEN
    RETURN;
  END IF;
  v_prefix := pg_catalog."left"(p_key, 16);

  -- ONE indexed equality on agent_api_keys_prefix_key, then ONE bytea
  -- comparison on the single row it returns (M-11: "comparison stays an indexed
  -- equality"). The agent's own status and kill switch are checked here as well
  -- as in the Edge Function, because 02 3.1 puts them on the 401 path and a
  -- check that lives only in the caller is a check the next caller forgets.
  RETURN QUERY
  SELECT api_key.tenant_id, api_key.agent_id, api_key.id
    FROM public.agent_api_keys AS api_key
    JOIN app.agent_api_key_secrets AS secret
      ON secret.tenant_id = api_key.tenant_id
     AND secret.api_key_id = api_key.id
    JOIN core.agents AS agent
      ON agent.tenant_id = api_key.tenant_id
     AND agent.agent_id = api_key.agent_id
   WHERE api_key.key_prefix = v_prefix
     AND api_key.revoked_at IS NULL
     AND (api_key.expires_at IS NULL OR api_key.expires_at > pg_catalog.now())
     AND agent.status = 'ACTIVE'
     AND NOT agent.kill_switch
     AND secret.key_digest = app.agent_key_digest(p_key, secret.key_salt);
END;
$fn$;

COMMENT ON FUNCTION app.verify_agent_key(text) IS
  'The exchange Edge Function''s lookup (doc 02 3.1 step 1). Returns no row for '
  'a wrong key, a revoked key, an expired key, a retired agent or an agent under '
  'the kill switch - deliberately the same empty answer for all six, so the '
  'caller cannot distinguish "no such key" from "that agent is paused".';

-- ═══ 4 · Model tiers and the versioned routing matrix ═══════════════════════
--
-- C-03. Doc 04 5.1 writes these as `app.model_tier` and `app.routing_matrix_*`.
-- M20-S20 reads them, `app` is not exposed to PostgREST, and doc 02 0 says
-- plainly that a table in `app` is unreachable by the Data API with no error to
-- explain it. They are in `core` with doc 01's plural names, which is what 007
-- and 009 did for the same finding.
--
-- ⚠ CONTRADICTION, RECORDED. Doc 04 5.1 types four columns with enums that do
-- not exist: app.tier_key, app.ai_provider, app.routing_strategy,
-- app.cache_strategy, app.admin_state, app.tier_health. 003 created
-- core.ai_provider, core.routing_strategy and core.cache_strategy (from the
-- contract package) and created NEITHER admin_state NOR tier_health - the
-- contract has no such enums, only the DERIVED TierStatus. The schema wins:
-- three become the core enums, the tier key becomes an FK to core.tier_keys
-- (003's own routing for an open set), and admin_state and health become
-- text + CHECK, which is doc 03 1's stated convention for exactly this case.
CREATE TABLE core.model_tiers (
  id                uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  tier_key          text        NOT NULL,
  model             text        NOT NULL
                                CHECK (NULLIF(pg_catalog.btrim(model), '') IS NOT NULL),
  provider          core.ai_provider,
  routing           core.routing_strategy NOT NULL DEFAULT 'FIXED',
  fallback_chain    text[]      NOT NULL DEFAULT ARRAY[]::text[],
  cache_strategy    core.cache_strategy NOT NULL DEFAULT 'NONE',
  max_output_tokens integer     CHECK (max_output_tokens IS NULL OR max_output_tokens > 0),
  -- 04 5.2: one bit per MYT hour. Eligibility is
  -- get_bit(allowed_hours, date_part('hour', now() AT TIME ZONE
  -- 'Asia/Kuala_Lumpur')::int) = 1 - note date_part, not EXTRACT: under
  -- search_path = '' the EXTRACT grammar cannot be schema-qualified at all.
  allowed_hours     bit(24)     NOT NULL DEFAULT B'111111111111111111111111',
  batch_eligible    boolean     NOT NULL DEFAULT false,
  admin_state       text        NOT NULL DEFAULT 'ENABLED'
                                CHECK (admin_state IN ('ENABLED','DISABLED')),
  health            text        NOT NULL DEFAULT 'HEALTHY'
                                CHECK (health IN ('HEALTHY','DEGRADED')),
  degraded_since    timestamptz,
  degraded_reason   text,
  active_fallback_tier text,
  monthly_cap_sen   bigint      CHECK (monthly_cap_sen IS NULL OR monthly_cap_sen >= 0),
  currency          core.currency_code NOT NULL DEFAULT 'MYR',
  created_at        timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at        timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT model_tiers_natural_key UNIQUE (tenant_id, tier_key),
  CONSTRAINT model_tiers_no_self_fallback CHECK (NOT (tier_key = ANY (fallback_chain))),
  CONSTRAINT model_tiers_degraded_has_since CHECK (
    health <> 'DEGRADED' OR degraded_since IS NOT NULL),
  CONSTRAINT model_tiers_tier_fk FOREIGN KEY (tenant_id, tier_key)
    REFERENCES core.tier_keys (tenant_id, tier_key) ON DELETE RESTRICT,
  CONSTRAINT model_tiers_fallback_tier_fk FOREIGN KEY (tenant_id, active_fallback_tier)
    REFERENCES core.tier_keys (tenant_id, tier_key) ON DELETE RESTRICT
);

COMMENT ON TABLE core.model_tiers IS
  'Doc 04 5.1 (its app.model_tier), in core per C-03. STATUS IS NOT A COLUMN: '
  'the contract''s four TierStatus values have three independent causes and '
  'storing one column means three writers racing to keep it true. '
  'core.model_tier_status derives it.';

COMMENT ON COLUMN core.model_tiers.fallback_chain IS
  'An array of tier keys, and therefore NOT referentially checked - an array '
  'element cannot carry a foreign key, and a validating trigger would have to '
  'read core.tier_keys, which is FORCE ROW LEVEL SECURITY with no policy until '
  '014 and would refuse every write. Stated rather than solved: 014 adds the '
  'policy and a validating trigger becomes possible. The self-reference CHECK '
  'above needs no lookup and is enforced today.';

SELECT app.finalise_table('core','model_tiers',false,NULL,
  ARRAY['tier_key']);

CREATE INDEX model_tiers_health_idx
  ON core.model_tiers (tenant_id, health) WHERE health = 'DEGRADED';
CREATE INDEX model_tiers_fallback_idx
  ON core.model_tiers (tenant_id, active_fallback_tier)
  WHERE active_fallback_tier IS NOT NULL;

-- 04 5.3. 17 requires PUT /ai/routing to apply to FUTURE runs only, which is a
-- versioning problem rather than an update problem: the matrix is versioned with
-- a non-overlapping validity range and each run stamps the version it used.
CREATE TABLE core.routing_matrix_versions (
  id             uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  label          text        NOT NULL
                             CHECK (NULLIF(pg_catalog.btrim(label), '') IS NOT NULL),
  effective_from timestamptz NOT NULL DEFAULT pg_catalog.now(),
  effective_to   timestamptz,
  applies        tstzrange   GENERATED ALWAYS AS
                             (tstzrange(effective_from, effective_to, '[)')) STORED,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at     timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT routing_matrix_versions_label_key UNIQUE (tenant_id, label),
  CONSTRAINT routing_matrix_versions_order CHECK (
    effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT routing_matrix_versions_no_overlap
    EXCLUDE USING gist (tenant_id WITH =, applies WITH &&)
);

COMMENT ON TABLE core.routing_matrix_versions IS
  'Doc 04 5.3, in core per C-03. The EXCLUDE is what makes "never retroactive" '
  'structural: two versions cannot both be in force for one tenant at one '
  'instant, so "which matrix did this run use" has exactly one answer. Needs '
  'btree_gist for the uuid equality operator class, which 001 installs.';

SELECT app.finalise_table('core','routing_matrix_versions',false,NULL,
  ARRAY['label','effective_from']);

CREATE INDEX routing_matrix_versions_live_idx
  ON core.routing_matrix_versions (tenant_id, effective_from DESC);

CREATE TABLE core.routing_entries (
  id                      uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id               uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  version_id              uuid        NOT NULL,
  action_type             text        NOT NULL
                                      REFERENCES app.action_types(key) ON DELETE RESTRICT,
  tier_key                text        NOT NULL,
  escalation_ladder       text[]      NOT NULL DEFAULT ARRAY[]::text[],
  jury                    jsonb       NOT NULL,
  required_for_autonomous boolean     NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at              timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT routing_entries_natural_key UNIQUE (tenant_id, version_id, action_type),
  CONSTRAINT routing_entries_jury_shape CHECK (app.is_valid_jury_policy(jury)),
  CONSTRAINT routing_entries_version_fk FOREIGN KEY (tenant_id, version_id)
    REFERENCES core.routing_matrix_versions (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT routing_entries_tier_fk FOREIGN KEY (tenant_id, tier_key)
    REFERENCES core.tier_keys (tenant_id, tier_key) ON DELETE RESTRICT
);

COMMENT ON TABLE core.routing_entries IS
  'One action type''s assignment inside one matrix version (doc 04 5.3, '
  'contract RoutingEntry). `jury` is NOT NULL and constrained by '
  'app.is_valid_jury_policy: DECISIONS s2''s supersede of the boolean form is '
  'enforced structurally here rather than described, which is the whole of '
  'doc 04 s4.3''s lesson.';

SELECT app.finalise_table('core','routing_entries',false,NULL,
  ARRAY['version_id','action_type']);

CREATE INDEX routing_entries_version_idx
  ON core.routing_entries (tenant_id, version_id);
CREATE INDEX routing_entries_tier_idx
  ON core.routing_entries (tenant_id, tier_key);
CREATE INDEX routing_entries_action_idx
  ON core.routing_entries (tenant_id, action_type);
CREATE INDEX routing_entries_action_type_idx
  ON core.routing_entries (action_type);

-- ═══ 5 · core.ai_provider_keys · BYOK metadata, and nothing else ════════════
--
-- supabase/CLAUDE.md 8 is not negotiable: secrets are never stored in
-- plaintext. This table holds a masked prefix, a fingerprint and an opaque
-- locator. The MATERIAL lives in the platform secret store and does not transit
-- this database at all - see M-10(1) in the header for the mechanism and for
-- what that costs.
CREATE TABLE core.ai_provider_keys (
  id              uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  -- The contract's ProviderKey.id, the segment /v1/ai/providers/{id} carries.
  provider_ref    text        NOT NULL CHECK (provider_ref ~ '^prv_[a-z0-9_]+$'),
  provider        core.ai_provider NOT NULL,
  label           text        NOT NULL
                              CHECK (NULLIF(pg_catalog.btrim(label), '') IS NOT NULL),
  status          core.provider_key_status NOT NULL DEFAULT 'NOT_SET',

  -- The three columns that touch the secret, and the only three.
  masked_key      text        NOT NULL CHECK (app.is_masked_key(masked_key)),
  key_fingerprint bytea       NOT NULL CHECK (pg_catalog.octet_length(key_fingerprint) = 32),
  key_ref         text        NOT NULL
                              CHECK (NULLIF(pg_catalog.btrim(key_ref), '') IS NOT NULL),

  scope_tiers     text[]      NOT NULL DEFAULT ARRAY[]::text[],
  cap_sen         bigint      CHECK (cap_sen IS NULL OR cap_sen >= 0),
  currency        core.currency_code NOT NULL DEFAULT 'MYR',
  rotation_date   date,
  billing_owner   core.billing_owner NOT NULL DEFAULT 'CLIENT_ACCOUNT',
  region          text        NOT NULL
                              CHECK (NULLIF(pg_catalog.btrim(region), '') IS NOT NULL),
  last_tested_at  timestamptz,
  invalid_since   timestamptz,
  active_fallback_tier text,
  added_by        jsonb       NOT NULL,
  added_at        timestamptz NOT NULL DEFAULT pg_catalog.now(),

  -- M-10(3). The ceiling's state, and the ONLY column the reveal path writes.
  last_revealed_at timestamptz,
  reveal_count     integer    NOT NULL DEFAULT 0 CHECK (reveal_count >= 0),

  created_at      timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at      timestamptz NOT NULL DEFAULT pg_catalog.now(),

  CONSTRAINT ai_provider_keys_ref_key UNIQUE (tenant_id, provider_ref),
  -- 02 6.1: the fingerprint exists ONLY to detect "this key was already added".
  -- It never authenticates - BYOK needs reversible decryption, so a hash is the
  -- wrong primitive for that job and the right one for this.
  CONSTRAINT ai_provider_keys_fingerprint_key UNIQUE (tenant_id, key_fingerprint),
  CONSTRAINT ai_provider_keys_added_by_shape CHECK (app.is_valid_actor(added_by)),
  CONSTRAINT ai_provider_keys_invalid_has_since CHECK (
    status <> 'INVALID' OR invalid_since IS NOT NULL),
  CONSTRAINT ai_provider_keys_fallback_tier_fk FOREIGN KEY (tenant_id, active_fallback_tier)
    REFERENCES core.tier_keys (tenant_id, tier_key) ON DELETE RESTRICT
);

COMMENT ON TABLE core.ai_provider_keys IS
  'BYOK metadata. THREE columns touch the secret and none of them is the secret: '
  'masked_key (display, shape-checked), key_fingerprint (duplicate detection '
  'only, never authentication - 02 6.1), key_ref (an opaque locator in the '
  'platform secret store; 02 6.1 establishes that a Vault secret id is not '
  'itself a capability, because decrypting needs SELECT on '
  'vault.decrypted_secrets and no login role has it). $verify$ asserts this '
  'column list is exactly the set whose name matches key/secret/token, so a '
  'fourth one cannot appear without failing the migration.';

-- ⚠ `key_fingerprint` IS NOT IN THE IMMUTABLE SET, AND IT USED TO BE.
--
-- A rotation issues NEW key material, so its fingerprint differs by definition —
-- that is what a fingerprint is for. Freezing the column therefore made
-- `ai_provider_key_rotate` impossible: its own UPDATE writes
-- `key_fingerprint = p_fingerprint` and was refused with IMMUTABLE_COLUMN,
-- permanently, for every key. Reproduced live on a clean 001-017 database; no pin
-- caught it because `test_013` T11c only exercises the `authenticated`-role
-- refusal and never a successful rotate. Rotation has never worked.
--
-- The column is not simply unfrozen. The protection it was reaching for is real —
-- nobody should be able to point a key row at different material without going
-- through the rotate path — and it is re-expressed below as the thing that is
-- actually true of a rotation: the fingerprint may change ONLY when `key_ref`,
-- the vault locator, changes in the same statement. `key_ref` was never in the
-- frozen list (rotate writes it too), which is what made the list inconsistent
-- with itself and hid the defect: one half of "the material changed" was frozen
-- and the other was not.
SELECT app.finalise_table('core','ai_provider_keys',false,NULL,
  ARRAY['provider_ref','provider','added_by','added_at']);

CREATE OR REPLACE FUNCTION app.enforce_key_material_pairing()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
  -- ⚠ SYMMETRIC. The first version fired only when the FINGERPRINT changed, so
  -- `UPDATE core.ai_provider_keys SET key_ref = 'vault:elsewhere'` passed
  -- untouched — and the reveal-audit trigger beside it only fires on
  -- `last_revealed_at`, so that write left NO audit row at all. Repointing a key
  -- row at a different vault entry while keeping the old fingerprint is the same
  -- substitution as the one this trigger was written to stop, approached from the
  -- other side: afterwards the row's fingerprint describes material the key_ref no
  -- longer names, and the next reveal hands out whatever is at the new locator.
  IF NEW.key_fingerprint IS NOT DISTINCT FROM OLD.key_fingerprint
     AND NEW.key_ref IS NOT DISTINCT FROM OLD.key_ref THEN
    RETURN NEW;
  END IF;

  IF NEW.key_fingerprint IS NOT DISTINCT FROM OLD.key_fingerprint THEN
    RAISE EXCEPTION
      'IMMUTABLE_COLUMN: core.ai_provider_keys.key_ref changed while '
      'key_fingerprint did not. The locator and the material identify the same '
      'secret; moving one without the other points this row at a different vault '
      'entry while still claiming the old fingerprint, and leaves no audit row '
      'because the reveal trigger only watches last_revealed_at.'
      USING ERRCODE = 'integrity_constraint_violation',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','IMMUTABLE_COLUMN','column','key_ref')::text;
  END IF;

  IF NEW.key_ref IS NOT DISTINCT FROM OLD.key_ref THEN
    RAISE EXCEPTION
      'IMMUTABLE_COLUMN: core.ai_provider_keys.key_fingerprint changed while '
      'key_ref did not. A fingerprint identifies the key material; changing it '
      'alone points this row at a different secret while still naming the old '
      'vault locator, which is either a rotation that forgot half of itself or '
      'somebody swapping material without going through ai_provider_key_rotate.'
      USING ERRCODE = 'integrity_constraint_violation',
            DETAIL = pg_catalog.jsonb_build_object(
              'code','IMMUTABLE_COLUMN','column','key_fingerprint')::text;
  END IF;

  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION app.enforce_key_material_pairing() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION app.enforce_key_material_pairing() IS
  'core.ai_provider_keys: key_fingerprint may change only when key_ref changes in '
  'the same statement, which is what a rotation is. Replaces freezing the column '
  'outright, which made rotation impossible for every key. 013.';

DROP TRIGGER IF EXISTS ai_provider_keys_material_pairing ON core.ai_provider_keys;
CREATE TRIGGER ai_provider_keys_material_pairing
  BEFORE UPDATE ON core.ai_provider_keys
  FOR EACH ROW EXECUTE FUNCTION app.enforce_key_material_pairing();

CREATE INDEX ai_provider_keys_status_idx
  ON core.ai_provider_keys (tenant_id, status, provider);
CREATE INDEX ai_provider_keys_rotation_idx
  ON core.ai_provider_keys (tenant_id, rotation_date)
  WHERE rotation_date IS NOT NULL;
CREATE INDEX ai_provider_keys_fallback_idx
  ON core.ai_provider_keys (tenant_id, active_fallback_tier)
  WHERE active_fallback_tier IS NOT NULL;

-- ═══ 6 · Budgets and the usage rollup (M-03) ════════════════════════════════

CREATE TABLE core.ai_budgets (
  id             uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  scope          core.budget_scope NOT NULL,
  key            text        NOT NULL
                             CHECK (NULLIF(pg_catalog.btrim(key), '') IS NOT NULL),
  cap_sen        bigint      NOT NULL CHECK (cap_sen >= 0),
  currency       core.currency_code NOT NULL DEFAULT 'MYR',
  -- M-03. The NEAR boundary is DATA, not a constant buried in the view, because
  -- "warn me at 80%" is a tenant preference and a hardcoded 0.8 is the same
  -- defect as a hardcoded stage list.
  near_threshold numeric(4,3) NOT NULL DEFAULT 0.800
                             CHECK (near_threshold >= 0 AND near_threshold <= 1),
  note           text,
  created_at     timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at     timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT ai_budgets_natural_key UNIQUE (tenant_id, scope, key)
);

COMMENT ON TABLE core.ai_budgets IS
  'Contract 17 Budget. In core per C-03 - PUT /v1/ai/budgets/{scope}/{key} '
  'reads and writes it. `state` is NOT a column: core.budget_status derives it '
  'from spend against cap, so PAUSED is a fact computed identically everywhere '
  'rather than a flag three writers race to keep true. Raising cap_sen is '
  'BUDGET_CAP_RAISE through 011''s envelope, MD-gated; 013 adds no branch for '
  'that - the action type already exists and the handler is 016''s.';

SELECT app.finalise_table('core','ai_budgets',false,NULL,
  ARRAY['scope','key']);

-- M-03. THE PHANTOM, DEFINED. Doc 04 5.5 says "the usage screen reads
-- app.usage_rollup, never the events", joins it in app.budget_status, and never
-- creates it. In `app` and not `core` because no client reads it: the three
-- endpoints read it THROUGH core.budget_status and the usage RPC 016 adds.
CREATE TABLE app.usage_rollup (
  id               uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id        uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  period           text        NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  scope            core.budget_scope NOT NULL,
  key              text        NOT NULL,
  spend_sen        bigint      NOT NULL DEFAULT 0 CHECK (spend_sen >= 0),
  currency         core.currency_code NOT NULL DEFAULT 'MYR',
  tokens_in        bigint      NOT NULL DEFAULT 0 CHECK (tokens_in >= 0),
  tokens_out       bigint      NOT NULL DEFAULT 0 CHECK (tokens_out >= 0),
  runs             integer     NOT NULL DEFAULT 0 CHECK (runs >= 0),
  cache_saving_sen bigint      NOT NULL DEFAULT 0 CHECK (cache_saving_sen >= 0),
  computed_at      timestamptz NOT NULL DEFAULT pg_catalog.now(),
  created_at       timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at       timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT usage_rollup_natural_key UNIQUE (tenant_id, period, scope, key)
);

COMMENT ON TABLE app.usage_rollup IS
  'M-03. The per (tenant, period, scope, key) aggregate GET /v1/ai/usage, '
  '/usage/forecast and PUT /v1/ai/budgets/{scope}/{key} read, and the relation '
  'core.budget_status joins - which was a phantom until now. `period` is '
  'YYYY-MM, matching to_char(now(),''YYYY-MM'') in doc 04 5.1''s own join. '
  'DELIBERATELY NOT BUILT ALONGSIDE IT: doc 04 5.5''s range-partitioned '
  'app.usage_event with its BRIN index, and the peak / off-peak split of ruling '
  'R13 - see the header.';

SELECT app.finalise_table('app','usage_rollup',false,NULL,
  ARRAY['period','scope','key']);

CREATE INDEX usage_rollup_period_idx
  ON app.usage_rollup (tenant_id, period, scope);

-- ═══ 7 · Agent runs · the trace the viewer renders ══════════════════════════
--
-- H-08 is ABOUT THIS SECTION. The finding names nine exposed core tables with no
-- RLS, no FORCE and no policy, and singles out core.run_node_io because it holds
-- full prompt and completion text. Every table below goes through
-- app.finalise_table, which enables and forces with zero policies, and $verify$
-- asserts it per table off pg_class rather than from this paragraph.

CREATE TABLE core.runs (
  id                uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  -- THE RECONCILIATION. `ref` is allocated by core.assign_ref with prefix RUN
  -- and app.finalise_table puts UNIQUE (tenant_id, ref) on it. It is what the
  -- six text run-id columns in 007, 009, 011 and 012 carry. See the header.
  ref               text,

  agent_id          text        NOT NULL,
  orchestrator      text,

  trigger           jsonb       NOT NULL,
  mode              text        NOT NULL DEFAULT 'LIVE'
                                CHECK (mode IN ('LIVE','SANDBOX')),

  status            core.run_status NOT NULL DEFAULT 'RUNNING',
  outcome           text,
  failure           jsonb,
  halted_by         jsonb,

  model             text,
  tiers_used        text[]      NOT NULL DEFAULT ARRAY[]::text[],
  cache_hit_rate    numeric(4,3) CHECK (cache_hit_rate IS NULL
                                        OR (cache_hit_rate >= 0 AND cache_hit_rate <= 1)),
  tokens_in         bigint      NOT NULL DEFAULT 0 CHECK (tokens_in >= 0),
  tokens_out        bigint      NOT NULL DEFAULT 0 CHECK (tokens_out >= 0),
  cost_sen          bigint      NOT NULL DEFAULT 0 CHECK (cost_sen >= 0),
  currency          core.currency_code NOT NULL DEFAULT 'MYR',
  guardrails        text[]      NOT NULL DEFAULT ARRAY[]::text[],

  -- Doc 04 5.3: "each run stamps the routing version it used", which is what
  -- makes PUT /ai/routing non-retroactive provable after the fact rather than
  -- promised.
  routing_version_id uuid,

  started_at        timestamptz NOT NULL DEFAULT pg_catalog.now(),
  finished_at       timestamptz,
  duration_ms       integer     CHECK (duration_ms IS NULL OR duration_ms >= 0),

  parent_run_id     uuid,
  replay_of_run_id  uuid,
  correlation_id    uuid        NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  action_request_id uuid,

  acknowledged_at   timestamptz,
  acknowledged_by   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  redacted_at       timestamptz,

  created_at        timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at        timestamptz NOT NULL DEFAULT pg_catalog.now(),

  CONSTRAINT runs_trigger_shape CHECK (app.is_valid_run_trigger(trigger)),
  CONSTRAINT runs_failure_shape CHECK (
    failure IS NULL OR app.is_valid_run_failure(failure)),
  CONSTRAINT runs_halted_by_shape CHECK (
    halted_by IS NULL OR app.is_valid_halted_by(halted_by)),
  -- A halt is a status, not a decoration: halted_by without status HALTED is a
  -- trace that says the agent was stopped and a status that says it was not.
  CONSTRAINT runs_halted_needs_status CHECK (
    halted_by IS NULL OR status = 'HALTED'),
  CONSTRAINT runs_failure_needs_status CHECK (
    failure IS NULL OR status = 'FAILED'),
  CONSTRAINT runs_finish_order CHECK (
    finished_at IS NULL OR finished_at >= started_at),
  -- Doc 05 6.6: a replay is a SANDBOX run, and sandbox runs emit no events and
  -- enqueue no jobs. The second half is the engine's; the first is structural.
  CONSTRAINT runs_replay_is_sandbox CHECK (
    replay_of_run_id IS NULL OR mode = 'SANDBOX'),
  CONSTRAINT runs_agent_fk FOREIGN KEY (tenant_id, agent_id)
    REFERENCES core.agents (tenant_id, agent_id) ON DELETE RESTRICT,
  CONSTRAINT runs_routing_version_fk FOREIGN KEY (tenant_id, routing_version_id)
    REFERENCES core.routing_matrix_versions (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT runs_action_request_fk FOREIGN KEY (tenant_id, action_request_id)
    REFERENCES core.action_requests (tenant_id, id) ON DELETE SET NULL
);

COMMENT ON TABLE core.runs IS
  'Doc 05 6.1. `id` is uuid and `ref` is the human reference the six text '
  'run-id columns elsewhere carry - that is the run_id reconciliation, stated in '
  'full in the migration header. `cost_sen` is integer sen per ruling R-PROV; '
  '`duration_ms` is stored rather than generated because finished_at is null '
  'while the run is in flight and the trace viewer shows elapsed time.';

COMMENT ON COLUMN core.runs.acknowledged_at IS
  'Doc 05 6.1 proposes this as a CONTRACT ADDITION, not a contract member: '
  'GET /badges returns agentFailures and without an acknowledgement the count '
  'can only grow. Built, and flagged here as an addition the contract has not '
  'signed off.';

SELECT app.finalise_table('core','runs',true,'RUN',
  ARRAY['agent_id','trigger','mode','started_at','correlation_id',
        'parent_run_id','replay_of_run_id']);

-- The two self-references, added AFTER finalise_table because the composite key
-- they point at - UNIQUE (tenant_id, id) - is what finalise_table creates.
ALTER TABLE core.runs
  ADD CONSTRAINT runs_parent_fk FOREIGN KEY (tenant_id, parent_run_id)
    REFERENCES core.runs (tenant_id, id) ON DELETE SET NULL,
  ADD CONSTRAINT runs_replay_of_fk FOREIGN KEY (tenant_id, replay_of_run_id)
    REFERENCES core.runs (tenant_id, id) ON DELETE SET NULL;

CREATE INDEX runs_tenant_started_idx ON core.runs (tenant_id, started_at DESC);
CREATE INDEX runs_agent_idx ON core.runs (tenant_id, agent_id, started_at DESC);
CREATE INDEX runs_failed_idx ON core.runs (tenant_id, finished_at DESC)
  WHERE status = 'FAILED' AND acknowledged_at IS NULL;
CREATE INDEX runs_parent_idx ON core.runs (tenant_id, parent_run_id)
  WHERE parent_run_id IS NOT NULL;
CREATE INDEX runs_replay_idx ON core.runs (tenant_id, replay_of_run_id)
  WHERE replay_of_run_id IS NOT NULL;
CREATE INDEX runs_correlation_idx ON core.runs (tenant_id, correlation_id);
CREATE INDEX runs_action_idx ON core.runs (tenant_id, action_request_id)
  WHERE action_request_id IS NOT NULL;
CREATE INDEX runs_routing_version_idx ON core.runs (tenant_id, routing_version_id)
  WHERE routing_version_id IS NOT NULL;
-- The 30-day sweep's own access path (doc 05 6.7).
CREATE INDEX runs_redaction_due_idx ON core.runs (finished_at)
  WHERE finished_at IS NOT NULL AND redacted_at IS NULL;
CREATE INDEX runs_acknowledged_by_idx ON core.runs (acknowledged_by)
  WHERE acknowledged_by IS NOT NULL;

-- ── core.run_nodes · the execution tree ────────────────────────────────────
--
-- ⚠ CONTRADICTION, RECORDED, SCHEMA WINS. Doc 05 6.2 writes
-- `check (status in ('RUNNING','OK','RETRIED','FAILED','HALTED'))` - five
-- values. 003's core.run_step_status has FOUR (OK, RETRIED, FAILED, HALTED),
-- generated from packages/contract/src/enums.ts :: RUN_STEP_STATUSES, and the
-- contract's TraceNode.status is that same four-member union. An enum member
-- cannot be removed once added, so inventing a fifth to match one document's
-- prose is a permanent decision taken to settle a disagreement. Instead: status
-- is NULLABLE and a node that has FINISHED must have one. "Running" is the
-- absence of a terminal status, which is the same information without a fifth
-- member, and the CHECK below makes it enforceable.
CREATE TABLE core.run_nodes (
  id             uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  run_id         uuid        NOT NULL,
  node_key       text        NOT NULL CHECK (node_key ~ '^[a-z0-9_]{1,32}$'),
  parent_node_id uuid,
  seq            integer     NOT NULL CHECK (seq >= 0),
  kind           core.trace_node_kind NOT NULL,
  name           text        NOT NULL
                             CHECK (NULLIF(pg_catalog.btrim(name), '') IS NOT NULL),

  tier           text,
  model          text,
  provider       core.ai_provider,
  tokens_in      integer     CHECK (tokens_in IS NULL OR tokens_in >= 0),
  tokens_out     integer     CHECK (tokens_out IS NULL OR tokens_out >= 0),
  cache_hit_rate numeric(4,3) CHECK (cache_hit_rate IS NULL
                                     OR (cache_hit_rate >= 0 AND cache_hit_rate <= 1)),
  cost_sen       bigint      NOT NULL DEFAULT 0 CHECK (cost_sen >= 0),

  status         core.run_step_status,
  retries        integer     NOT NULL DEFAULT 0 CHECK (retries >= 0),
  duration_ms    integer     CHECK (duration_ms IS NULL OR duration_ms >= 0),

  args           jsonb,
  result         jsonb,
  error          jsonb,
  halted_by      jsonb,

  started_at     timestamptz NOT NULL DEFAULT pg_catalog.now(),
  finished_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at     timestamptz NOT NULL DEFAULT pg_catalog.now(),

  CONSTRAINT run_nodes_natural_key UNIQUE (tenant_id, run_id, node_key),
  CONSTRAINT run_nodes_finished_has_status CHECK (
    finished_at IS NULL OR status IS NOT NULL),
  -- R-JSONB, TYPE HALF ONLY, AND SAID SO. A tool's arguments and a tool's
  -- result have no fixed key set - that is what makes them tool arguments - so
  -- there is no key to assert presence of. These two columns and core.evals.detail
  -- are the only jsonb in this pack where the key-presence half of N-02 is not
  -- applicable, and $verify$ carries them as a NAMED exemption rather than
  -- naming them in $verify$ rather than letting the sweep quietly pass
  -- anything.
  CONSTRAINT run_nodes_args_shape CHECK (
    args IS NULL OR pg_catalog.jsonb_typeof(args) = 'object'),
  CONSTRAINT run_nodes_result_shape CHECK (
    result IS NULL OR pg_catalog.jsonb_typeof(result) = 'object'),
  CONSTRAINT run_nodes_error_shape CHECK (
    error IS NULL OR (
         pg_catalog.jsonb_typeof(error) = 'object'
     AND error ? 'attempt' AND error ? 'code'
     AND pg_catalog.jsonb_typeof(error -> 'attempt') = 'number'
     AND pg_catalog.jsonb_typeof(error -> 'code') = 'string')),
  CONSTRAINT run_nodes_halted_by_shape CHECK (
    halted_by IS NULL OR app.is_valid_halted_by(halted_by)),
  -- Doc 05 6.2, made enforceable: "A halted node has duration_ms = 0 and no
  -- result." That sentence is the whole evidentiary value of haltedBy - it is
  -- how the trace proves the agent never sent anything - so it is a constraint
  -- rather than a convention.
  CONSTRAINT run_nodes_halt_is_evidence CHECK (
    halted_by IS NULL OR (
      status = 'HALTED' AND result IS NULL AND COALESCE(duration_ms, 0) = 0)),
  CONSTRAINT run_nodes_run_fk FOREIGN KEY (tenant_id, run_id)
    REFERENCES core.runs (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT run_nodes_tier_fk FOREIGN KEY (tenant_id, tier)
    REFERENCES core.tier_keys (tenant_id, tier_key) ON DELETE RESTRICT
);

COMMENT ON TABLE core.run_nodes IS
  'Doc 05 6.2, the orchestrator -> sub-agent -> tool tree. `status` is nullable '
  'and `finished_at IS NULL` is what RUNNING means: 003''s core.run_step_status '
  'has four members and the contract''s RunStepStatus has the same four, while '
  'doc 05''s prose CHECK has five. An enum member is permanent; the '
  'disagreement is not worth one.';

SELECT app.finalise_table('core','run_nodes',false,NULL,
  ARRAY['run_id','node_key','parent_node_id','seq','kind','started_at']);

ALTER TABLE core.run_nodes
  ADD CONSTRAINT run_nodes_parent_fk FOREIGN KEY (tenant_id, parent_node_id)
    REFERENCES core.run_nodes (tenant_id, id) ON DELETE CASCADE;

CREATE INDEX run_nodes_tree_idx ON core.run_nodes (tenant_id, run_id, seq);
CREATE INDEX run_nodes_parent_idx ON core.run_nodes (tenant_id, parent_node_id)
  WHERE parent_node_id IS NOT NULL;
CREATE INDEX run_nodes_tier_idx ON core.run_nodes (tenant_id, tier)
  WHERE tier IS NOT NULL;
CREATE INDEX run_nodes_redaction_due_idx ON core.run_nodes (finished_at)
  WHERE finished_at IS NOT NULL AND (args IS NOT NULL OR result IS NOT NULL);

-- ── core.run_node_io · the table H-08 is actually about ────────────────────

CREATE OR REPLACE FUNCTION app.is_valid_redaction_counts(p_value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT p_value IS NOT NULL
     AND pg_catalog.jsonb_typeof(p_value) = 'object'
     AND p_value ? 'emails' AND p_value ? 'phones' AND p_value ? 'nric'
     AND p_value ? 'passports' AND p_value ? 'accounts'
     AND pg_catalog.jsonb_typeof(p_value -> 'emails')    = 'number'
     AND pg_catalog.jsonb_typeof(p_value -> 'phones')    = 'number'
     AND pg_catalog.jsonb_typeof(p_value -> 'nric')      = 'number'
     AND pg_catalog.jsonb_typeof(p_value -> 'passports') = 'number'
     AND pg_catalog.jsonb_typeof(p_value -> 'accounts')  = 'number';
$fn$;

COMMENT ON FUNCTION app.is_valid_redaction_counts(jsonb) IS
  'core.run_node_io.redaction. Doc 05 6.7 shows { emails: 2, phones: 1, nric: 0 '
  '} - three keys for five patterns, with passport and bank account counted by '
  'nothing. All five are required, because the point of the column is that an '
  'operator can see masking RAN and what it caught; a missing key is '
  'indistinguishable from a pattern that was never applied.';

CREATE TABLE core.run_node_io (
  id           uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  run_node_id  uuid        NOT NULL,
  prompt       text,
  completion   text,
  redaction    jsonb       NOT NULL
                           DEFAULT '{"emails":0,"phones":0,"nric":0,"passports":0,"accounts":0}'::jsonb,
  -- M-25's index needs something to index. WRITTEN BY THE WORKER; an
  -- unpopulated subject is an erasure that still cannot find its rows, and the
  -- header says so.
  subject_type text        CHECK (subject_type IS NULL OR subject_type ~ '^[A-Z][A-Z0-9_]*$'),
  subject_id   uuid,
  created_at   timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at   timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT run_node_io_node_key UNIQUE (tenant_id, run_node_id),
  CONSTRAINT run_node_io_redaction_shape CHECK (app.is_valid_redaction_counts(redaction)),
  CONSTRAINT run_node_io_subject_pair CHECK (
    pg_catalog.num_nonnulls(subject_type, subject_id) <> 1),
  CONSTRAINT run_node_io_node_fk FOREIGN KEY (tenant_id, run_node_id)
    REFERENCES core.run_nodes (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE core.run_node_io IS
  'Doc 05 6.3. Full prompt and completion text, and the reason H-08 is a HIGH: '
  'one GRANT SELECT ON ALL TABLES IN SCHEMA core in a future migration is total '
  'disclosure of every tenant''s raw LLM traffic, and 001 measured that ALTER '
  'DEFAULT PRIVILEGES ... REVOKE gives no backstop. RLS enabled AND forced, zero '
  'policies, zero grants. Separate from core.run_nodes so the 30-day deletion is '
  'a DELETE of a side table rather than an UPDATE that bloats the table the '
  'trace viewer reads.';

SELECT app.finalise_table('core','run_node_io',false,NULL,
  ARRAY['run_node_id']);

-- M-25. The database''s own masking pass. See app.mask_run_io for what it does
-- and, more importantly, for what it does not.
CREATE TRIGGER run_node_io_mask
  BEFORE INSERT OR UPDATE ON core.run_node_io
  FOR EACH ROW EXECUTE FUNCTION app.mask_run_io();

CREATE INDEX run_node_io_age_idx ON core.run_node_io (created_at);
-- M-25's index, by name.
CREATE INDEX run_node_io_subject_idx
  ON core.run_node_io (tenant_id, subject_type, subject_id)
  WHERE subject_id IS NOT NULL;
CREATE INDEX run_node_io_node_idx ON core.run_node_io (tenant_id, run_node_id);

-- ── core.run_events, state cards, checkpoints, snapshots ───────────────────

CREATE TABLE core.run_events (
  id         uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  run_id     uuid        NOT NULL,
  seq        integer     NOT NULL CHECK (seq >= 0),
  type       core.run_event_type NOT NULL,
  node_key   text,
  detail     jsonb       NOT NULL,
  at         timestamptz NOT NULL DEFAULT pg_catalog.now(),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT run_events_natural_key UNIQUE (tenant_id, run_id, seq),
  CONSTRAINT run_events_detail_shape CHECK (app.is_valid_run_event_detail(type, detail)),
  CONSTRAINT run_events_run_fk FOREIGN KEY (tenant_id, run_id)
    REFERENCES core.runs (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE core.run_events IS
  'Doc 05 6.4. `detail` has NO DEFAULT: doc 05 writes '
  'default ''{}''::jsonb, and an empty object satisfies none of the eight '
  'shapes, so the default would have made every insert that relied on it fail '
  'at the constraint instead of at the caller. This is NOT core.events - that is '
  '012''s domain event log and app.emit_event is still its only write path.';

SELECT app.finalise_table('core','run_events',false,NULL,
  ARRAY['run_id','seq','type','node_key','detail','at']);

CREATE INDEX run_events_run_idx ON core.run_events (tenant_id, run_id, seq);
CREATE INDEX run_events_type_idx ON core.run_events (tenant_id, type, at DESC);

CREATE TABLE core.run_state_cards (
  id              uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  run_id          uuid        NOT NULL,
  version         integer     NOT NULL CHECK (version >= 1),
  goal            text        NOT NULL
                              CHECK (NULLIF(pg_catalog.btrim(goal), '') IS NOT NULL),
  plan            jsonb       NOT NULL DEFAULT '[]'::jsonb,
  decisions       text[]      NOT NULL DEFAULT ARRAY[]::text[],
  constraints     text[]      NOT NULL DEFAULT ARRAY[]::text[],
  record_pointers text[]      NOT NULL DEFAULT ARRAY[]::text[],
  open_questions  text[]      NOT NULL DEFAULT ARRAY[]::text[],
  budgets         jsonb       NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at      timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT run_state_cards_natural_key UNIQUE (tenant_id, run_id, version),
  CONSTRAINT run_state_cards_plan_shape CHECK (app.is_valid_plan(plan)),
  CONSTRAINT run_state_cards_budgets_shape CHECK (app.is_valid_state_card_budgets(budgets)),
  CONSTRAINT run_state_cards_run_fk FOREIGN KEY (tenant_id, run_id)
    REFERENCES core.runs (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE core.run_state_cards IS
  'Doc 05 6.5, versioned because retry-from-checkpoint needs the card as it was '
  'at that checkpoint. NOT under the 30-day redaction: doc 05 6.7 keeps these '
  'indefinitely on the ground that goal, decisions and constraints are authored '
  'summaries rather than transcripts, and CONCEDES they may carry client text '
  'verbatim. 013 takes that at its word and masks nothing here. If it is ever '
  'found to be false these four columns move under app.redact_run_io, and this '
  'comment is the record of the assumption rather than a claim it is safe.';

SELECT app.finalise_table('core','run_state_cards',false,NULL,
  ARRAY['run_id','version']);

CREATE INDEX run_state_cards_run_idx
  ON core.run_state_cards (tenant_id, run_id, version DESC);

CREATE TABLE core.run_checkpoints (
  id                 uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id          uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  run_id             uuid        NOT NULL,
  step               integer     NOT NULL CHECK (step >= 0),
  node_key           text,
  state_card_version integer     NOT NULL CHECK (state_card_version >= 1),
  cursor             jsonb       NOT NULL,
  replayable         boolean     NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at         timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT run_checkpoints_natural_key UNIQUE (tenant_id, run_id, step),
  CONSTRAINT run_checkpoints_cursor_shape CHECK (app.is_valid_checkpoint_cursor(cursor)),
  CONSTRAINT run_checkpoints_run_fk FOREIGN KEY (tenant_id, run_id)
    REFERENCES core.runs (tenant_id, id) ON DELETE CASCADE,
  -- Doc 05 6.5's `foreign key (run_id, state_card_version)`, made tenant-safe by
  -- leading with tenant_id like every other FK in this pack.
  CONSTRAINT run_checkpoints_card_fk
    FOREIGN KEY (tenant_id, run_id, state_card_version)
    REFERENCES core.run_state_cards (tenant_id, run_id, version) ON DELETE RESTRICT
);

COMMENT ON TABLE core.run_checkpoints IS
  'Doc 05 6.5. POST /v1/runs/{id}/retry?from=checkpoint reads the latest '
  'replayable row, creates a NEW run with parent_run_id set and the same '
  'correlation_id, and never mutates the original - which is why there is no '
  '"consumed" flag here.';

SELECT app.finalise_table('core','run_checkpoints',false,NULL,
  ARRAY['run_id','step','state_card_version','cursor']);

CREATE INDEX run_checkpoints_replay_idx
  ON core.run_checkpoints (tenant_id, run_id, step DESC) WHERE replayable;
CREATE INDEX run_checkpoints_card_idx
  ON core.run_checkpoints (tenant_id, run_id, state_card_version);

CREATE TABLE core.run_snapshots (
  id          uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  run_id      uuid        NOT NULL,
  tool_name   text        NOT NULL
                          CHECK (NULLIF(pg_catalog.btrim(tool_name), '') IS NOT NULL),
  args_hash   text        NOT NULL CHECK (args_hash ~ '^[0-9a-f]{64}$'),
  args        jsonb       NOT NULL,
  response    jsonb       NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  created_at  timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at  timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT run_snapshots_natural_key UNIQUE (tenant_id, run_id, tool_name, args_hash),
  CONSTRAINT run_snapshots_args_shape CHECK (pg_catalog.jsonb_typeof(args) = 'object'),
  CONSTRAINT run_snapshots_response_shape CHECK (
    pg_catalog.jsonb_typeof(response) IN ('object','array')),
  CONSTRAINT run_snapshots_run_fk FOREIGN KEY (tenant_id, run_id)
    REFERENCES core.runs (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE core.run_snapshots IS
  'Doc 05 6.6. Every tool READ during a LIVE run, so a SANDBOX replay resolves '
  'from the snapshot and a miss is a hard SANDBOX_SNAPSHOT_MISS rather than a '
  'live read - live reads make a replay non-deterministic, which removes the '
  'only reason to run one. args_hash is the sha256 of canonicalised args and is '
  'CHECKed to be 64 lowercase hex, so a caller that forgets to hash is refused '
  'rather than silently creating a second snapshot that never matches.';

SELECT app.finalise_table('core','run_snapshots',false,NULL,
  ARRAY['run_id','tool_name','args_hash','args','response','captured_at']);

CREATE INDEX run_snapshots_run_idx ON core.run_snapshots (tenant_id, run_id);
CREATE INDEX run_snapshots_age_idx ON core.run_snapshots (captured_at);

-- ── core.evals ─────────────────────────────────────────────────────────────

CREATE TABLE core.evals (
  id                 uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id          uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  agent_id           text        NOT NULL,
  action_type        text        REFERENCES app.action_types(key) ON DELETE RESTRICT,
  kind               text        NOT NULL
                                 CHECK (kind IN ('GOLDEN_SET','LIVE_SAMPLE','JURY_GATE','HUMAN_LABEL')),
  golden_set_version text,
  run_id             uuid,
  -- Rule 5, and the reason the rule exists. numeric(4,3) with the bounds, not a
  -- float and not an unbounded numeric: an eval score outside [0,1] makes the
  -- rolling median that gates an agent''s promotion meaningless.
  score              numeric(4,3) CHECK (score IS NULL OR (score >= 0 AND score <= 1)),
  passed             boolean,
  detail             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  evaluated_at       timestamptz NOT NULL DEFAULT pg_catalog.now(),
  created_at         timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at         timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT evals_detail_shape CHECK (pg_catalog.jsonb_typeof(detail) = 'object'),
  CONSTRAINT evals_golden_set_has_version CHECK (
    kind <> 'GOLDEN_SET' OR golden_set_version IS NOT NULL),
  CONSTRAINT evals_agent_fk FOREIGN KEY (tenant_id, agent_id)
    REFERENCES core.agents (tenant_id, agent_id) ON DELETE CASCADE,
  CONSTRAINT evals_run_fk FOREIGN KEY (tenant_id, run_id)
    REFERENCES core.runs (tenant_id, id) ON DELETE SET NULL
);

COMMENT ON TABLE core.evals IS
  'Doc 05 6.8. GOLDEN_SET and JURY_GATE feed GET /v1/agents evalScore (a '
  'rolling median) and the resumeCondition on a paused agent; LIVE_SAMPLE comes '
  'from the 5% JURY_SAMPLE job. One table on purpose - the gate score and the '
  'live sample score for the same action type are directly comparable, which is '
  'what makes drift visible.';

SELECT app.finalise_table('core','evals',false,NULL,
  ARRAY['agent_id','action_type','kind','golden_set_version','run_id',
        'score','passed','evaluated_at']);

CREATE INDEX evals_agent_idx ON core.evals (tenant_id, agent_id, evaluated_at DESC);
-- M-16, as the COMPOSITE the FK actually needs rather than the single column the
-- finding names.
CREATE INDEX evals_run_idx ON core.evals (tenant_id, run_id) WHERE run_id IS NOT NULL;
CREATE INDEX evals_action_idx ON core.evals (tenant_id, action_type, kind, evaluated_at DESC)
  WHERE action_type IS NOT NULL;
CREATE INDEX evals_action_type_idx ON core.evals (action_type)
  WHERE action_type IS NOT NULL;

-- ═══ 8 · app.key_access_audit and the provider-key RPCs ═════════════════════
--
-- Doc 05 5.4's rule #1: "the audit row is written in the same transaction as
-- the decrypt ... 'decrypt' and 'log' are one operation or the log is fiction."
-- M-10(4) is that rule made structural rather than promised - see the trigger
-- below.
--
-- ⚠ CONTRADICTIONS, RECORDED. (a) Doc 05 types `secret_id uuid` for the vault
-- secret. The locator on core.ai_provider_keys is `key_ref text`, opaque by
-- design (02 6.1), so this column is text and named key_ref to match the
-- column it copies - a uuid here would force every non-Vault secret store to be
-- misrepresented. (b) Doc 05 documents actor.kind as HUMAN|AGENT|SYSTEM, three
-- kinds; doc 02 0 fixes FOUR as the cross-lane convention and 003's
-- app.actor_kind is the four. The constraint is app.is_valid_actor, 012's
-- function, unchanged - N-09 closed once rather than copied. (c) Doc 05 5.4
-- says the provider detail screen reads this table directly. It cannot: `app`
-- is not exposed to PostgREST. That screen needs an RPC, which belongs with the
-- grants in 014/016.
CREATE TABLE app.key_access_audit (
  id                 uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id          uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  provider_key_id    uuid        NOT NULL,
  provider_ref       text        NOT NULL,
  key_ref            text        NOT NULL,
  actor              jsonb       NOT NULL,
  purpose            text        NOT NULL
                                 CHECK (purpose IN ('REVEAL','RUN_CALL','PROBE','ROTATE')),
  edge_function_name text        NOT NULL
                                 CHECK (NULLIF(pg_catalog.btrim(edge_function_name), '') IS NOT NULL),
  request_id         text,
  run_id             uuid,
  aal                text,
  reason             text,
  decrypted_at       timestamptz NOT NULL DEFAULT pg_catalog.now(),
  created_at         timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at         timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT key_access_audit_actor_shape CHECK (app.is_valid_actor(actor)),
  CONSTRAINT key_access_audit_reveal_has_reason CHECK (
    purpose <> 'REVEAL' OR NULLIF(pg_catalog.btrim(COALESCE(reason, '')), '') IS NOT NULL),
  CONSTRAINT key_access_audit_key_fk FOREIGN KEY (tenant_id, provider_key_id)
    REFERENCES core.ai_provider_keys (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT key_access_audit_run_fk FOREIGN KEY (tenant_id, run_id)
    REFERENCES core.runs (tenant_id, id) ON DELETE SET NULL
);

COMMENT ON TABLE app.key_access_audit IS
  'Doc 05 5.4. Every BYOK decrypt, append-only, retained indefinitely - it is '
  'the record of who saw a credential, and doc 05 5.5 puts it outside the '
  '30-day run redaction because it holds neither key material nor prompt text. '
  'ON DELETE RESTRICT on the provider key, not CASCADE: deleting a key must not '
  'delete the record of who read it.';

SELECT app.finalise_table('app','key_access_audit',false,NULL,
  ARRAY['provider_key_id','provider_ref','key_ref','actor','purpose',
        'edge_function_name','request_id','run_id','aal','reason','decrypted_at']);

-- Append-only, BOTH halves, reusing 012's app.reject_mutation rather than
-- declaring a second one. A FOR EACH ROW trigger does not fire for TRUNCATE -
-- measured in 012, not reasoned - so the statement-level guard is the half that
-- makes the guarantee true. The redaction exemption inside reject_mutation is
-- keyed to core.events rows by id AND to the app.event_redaction GUC, neither of
-- which any writer here sets, so this table has no exemption at all.
CREATE TRIGGER key_access_audit_append_only
  BEFORE UPDATE OR DELETE ON app.key_access_audit
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();

CREATE TRIGGER key_access_audit_no_truncate
  BEFORE TRUNCATE ON app.key_access_audit
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON app.key_access_audit FROM service_role;

CREATE INDEX key_access_audit_tenant_idx
  ON app.key_access_audit (tenant_id, decrypted_at DESC);
CREATE INDEX key_access_audit_secret_idx
  ON app.key_access_audit (tenant_id, key_ref, decrypted_at DESC);
-- The ceiling's own access path: "has this key been revealed in the last 24
-- hours" is a two-column range scan, not a filter over every decrypt the run
-- engine has ever made.
CREATE INDEX key_access_audit_reveal_idx
  ON app.key_access_audit (tenant_id, provider_key_id, decrypted_at DESC)
  WHERE purpose = 'REVEAL';
-- The FK's own index. The partial one above cannot serve it: a RESTRICT check
-- has to see the RUN_CALL rows too.
CREATE INDEX key_access_audit_key_idx
  ON app.key_access_audit (tenant_id, provider_key_id);
CREATE INDEX key_access_audit_run_idx
  ON app.key_access_audit (tenant_id, run_id) WHERE run_id IS NOT NULL;

-- ── M-10(4) · the audit row is not separable from the reveal ───────────────
--
-- Following app.redact_event_actor's shape (012): a transaction-local GUC names
-- the audit row, and the trigger RE-DERIVES from the catalogue that the row
-- exists, for this tenant, this key, this purpose and this transaction, rather
-- than trusting the caller to have written it.
--
-- FAILS CLOSED under the RLS residue: this is a SELECT inside a trigger, so on a
-- platform whose owner lacks BYPASSRLS it finds nothing and REFUSES the reveal.
-- That direction is deliberate; the header says why.
CREATE OR REPLACE FUNCTION app.require_reveal_audit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
DECLARE
  v_audit_id uuid;
BEGIN
  IF NEW.last_revealed_at IS NOT DISTINCT FROM OLD.last_revealed_at THEN
    RETURN NEW;
  END IF;

  -- ⚠ A ROTATION IS NOT A REVEAL, AND THIS TRIGGER USED TO DISAGREE.
  --
  -- `ai_provider_key_rotate` issues new key material and CLEARS `last_revealed_at`,
  -- because the 24-hour reveal ceiling is per key material and the previous
  -- reveal no longer constrains the new one. That clear is a write to this column,
  -- so the check below demanded an `app.key_reveal_audit` GUC that `rotate` has no
  -- reason to set — and raised REVEAL_AUDIT_REQUIRED. Permanently, for any key
  -- that had ever been revealed, which is exactly the key a security team needs to
  -- rotate. Reproduced live: set -> reveal -> rotate on one provider_ref gives
  --   42501  core.ai_provider_keys.last_revealed_at may only be written by the
  --          audited reveal path (M-10) ... {"code":"REVEAL_AUDIT_REQUIRED"}
  -- and `test_013` never caught it because T11c only exercises the `authenticated`
  -- role refusal, never a successful rotate.
  --
  -- The exemption is narrow on purpose. It is not "any NULL write": it is a write
  -- that CLEARS the stamp AND changes the key material in the same statement.
  -- Nothing about that shape can leak a secret — the column is being emptied, not
  -- filled, and the row is getting a new `key_ref` — whereas the attack this
  -- trigger exists to stop is a caller BUMPING the stamp to move the ceiling
  -- without leaving an audit row. Clearing the stamp without changing the material
  -- is still refused, because that is the shape of somebody resetting the ceiling.
  IF NEW.last_revealed_at IS NULL
     AND NEW.key_ref IS DISTINCT FROM OLD.key_ref
     AND NEW.key_fingerprint IS DISTINCT FROM OLD.key_fingerprint THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_audit_id := NULLIF(
      pg_catalog.current_setting('app.key_reveal_audit', true), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_audit_id := NULL;
  END;

  -- ⚠ 'TRNOS' HERE TOO, AND MY EARLIER REASONING FOR KEEPING 42501 WAS WRONG.
  --
  -- I argued these two were trigger integrity guards "that no RPC path can
  -- reach", so the client's code mapping could not misrender them. The re-review
  -- showed the path: under the carried FORCE-RLS-with-no-policy residue an
  -- authenticated caller can reach REVEAL_AUDIT_MISMATCH through
  -- ai_provider_key_reveal itself. 42501 is in the web client's
  -- UNAUTHENTICATED_CODES set, so it would have rendered "Your session has
  -- expired. Sign in again." to somebody whose session is fine and whose key
  -- audit just failed — sending them to re-login instead of to an incident.
  --
  -- "No RPC path reaches it" is a claim about every current and future caller of
  -- a shared trigger, which is not a claim worth defending for the sake of a
  -- SQLSTATE. Both raise 'TRNOS' now; the DETAIL bags already carried the real
  -- codes, so nothing else changes.
  IF v_audit_id IS NULL THEN
    RAISE EXCEPTION
      'core.ai_provider_keys.last_revealed_at may only be written by the '
      'audited reveal path (M-10): no app.key_reveal_audit row is named for '
      'this transaction'
      USING ERRCODE = 'TRNOS',
            DETAIL  = pg_catalog.jsonb_build_object(
                        'code', 'REVEAL_AUDIT_REQUIRED')::text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM app.key_access_audit AS audit
     WHERE audit.id = v_audit_id
       AND audit.tenant_id = NEW.tenant_id
       AND audit.provider_key_id = NEW.id
       AND audit.purpose = 'REVEAL'
       AND audit.decrypted_at >= pg_catalog.transaction_timestamp()) THEN
    RAISE EXCEPTION
      'core.ai_provider_keys.last_revealed_at was bumped but audit row % is not '
      'a REVEAL of this key in this transaction. A reveal that succeeds while '
      'its audit row fails is the one case that must not be possible.', v_audit_id
      USING ERRCODE = 'TRNOS',
            DETAIL  = pg_catalog.jsonb_build_object(
                        'code', 'REVEAL_AUDIT_MISMATCH')::text;
  END IF;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION app.require_reveal_audit() IS
  'M-10(4). BEFORE UPDATE on core.ai_provider_keys. Refuses any change to '
  'last_revealed_at that is not accompanied by an app.key_access_audit REVEAL '
  'row for the same tenant, key and transaction. It checks the CATALOGUE, not '
  'the caller''s promise - the same shape app.redact_event_actor''s trigger uses '
  'in 012.';

CREATE TRIGGER ai_provider_keys_reveal_audit
  BEFORE UPDATE ON core.ai_provider_keys
  FOR EACH ROW EXECUTE FUNCTION app.require_reveal_audit();

-- The ONE writer of app.key_access_audit, used by BOTH callers doc 05 5.4
-- names: the reveal endpoint (REVEAL, actor.kind HUMAN, with the aal) and the
-- run engine's per-call decrypt (RUN_CALL, actor.kind AGENT, with a run_id).
-- They are the same table because they are the same risk, and separating them is
-- how one of them ends up unaudited.
CREATE OR REPLACE FUNCTION app.record_key_access(
  p_tenant_id          uuid,
  p_provider_ref       text,
  p_purpose            text,
  p_actor              jsonb,
  p_edge_function_name text,
  p_request_id         text DEFAULT NULL,
  p_run_id             uuid DEFAULT NULL,
  p_aal                text DEFAULT NULL,
  p_reason             text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_key   core.ai_provider_keys;
  v_audit uuid;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'record_key_access: tenant_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT app.is_valid_actor(p_actor) THEN
    RAISE EXCEPTION 'record_key_access: actor must be {kind,id,name} with kind '
      'one of HUMAN, AGENT, SYSTEM, CLIENT'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_key
    FROM core.ai_provider_keys AS provider_key
   WHERE provider_key.tenant_id = p_tenant_id
     AND provider_key.provider_ref = p_provider_ref;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'record_key_access: no provider key % in this tenant',
      p_provider_ref USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO app.key_access_audit
    (tenant_id, provider_key_id, provider_ref, key_ref, actor, purpose,
     edge_function_name, request_id, run_id, aal, reason)
  VALUES
    (p_tenant_id, v_key.id, v_key.provider_ref, v_key.key_ref, p_actor, p_purpose,
     p_edge_function_name, p_request_id, p_run_id, p_aal, p_reason)
  RETURNING id INTO v_audit;

  RETURN v_audit;
END;
$fn$;

COMMENT ON FUNCTION app.record_key_access(uuid,text,text,jsonb,text,text,uuid,text,text) IS
  'Doc 05 5.4''s single audit writer. Both callers use it - the reveal RPC '
  'below and the run engine''s per-call decrypt, which holds service_role. '
  'Nothing else may write app.key_access_audit; it is append-only by trigger and '
  'by revoke, and there is no update path at all.';

-- ── The four write RPCs, and the reveal grant ──────────────────────────────
--
-- M-10(1). NOT ONE OF THESE TAKES THE RAW KEY. The Edge Function that holds the
-- key writes it to the platform secret store and calls these with the mask, the
-- fingerprint and the opaque locator, so there is no parameter position for
-- log_min_duration_statement or pg_stat_activity to expose. What that costs -
-- the mask can no longer be DERIVED in the database - is stated in the header
-- and is why app.is_masked_key exists.
--
-- STEP-UP, per doc 02 7.2a rather than per 02 6.2. 7.2a is explicit: ground
-- the assertion in an auth.sessions row "for the two gates where the consequence
-- is worst - revealing a provider key, and raising an agent's autonomy", and
-- keep the cheap claim check everywhere else "because the extra lookup on every
-- privileged write is not worth it when the attacker who defeats it has already
-- defeated everything". So _reveal calls app.aal2_verified(); _set, _rotate and
-- _delete check app.aal(). That is a deliberate difference from 02 6.2's "each
-- asserting ADMIN plus AAL2" and it follows the later, better-argued section.

CREATE OR REPLACE FUNCTION public.ai_provider_key_set(
  p_provider_ref   text,
  p_provider       text,
  p_label          text,
  p_masked_key     text,
  p_fingerprint    bytea,
  p_key_ref        text,
  p_scope_tiers    text[],
  p_region         text,
  p_billing_owner  text DEFAULT 'CLIENT_ACCOUNT',
  p_cap_sen        bigint DEFAULT NULL,
  p_rotation_date  date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
  v_row    core.ai_provider_keys;
BEGIN
  IF app.is_agent() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'TRNOS',
      DETAIL = pg_catalog.jsonb_build_object('code','FORBIDDEN','reason','AGENT')::text;
  END IF;
  IF NOT app.has_permission('ai:provider:write') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'TRNOS',
      DETAIL = pg_catalog.jsonb_build_object('code','FORBIDDEN')::text;
  END IF;
  IF app.aal() <> 'aal2' THEN
    RAISE EXCEPTION 'MFA_REQUIRED' USING ERRCODE = 'TRNOS',
      DETAIL = pg_catalog.jsonb_build_object('code','MFA_REQUIRED')::text;
  END IF;

  INSERT INTO core.ai_provider_keys
    (tenant_id, provider_ref, provider, label, status, masked_key, key_fingerprint,
     key_ref, scope_tiers, cap_sen, rotation_date, billing_owner, region, added_by)
  VALUES
    (v_tenant, p_provider_ref, p_provider::core.ai_provider, p_label, 'NOT_SET',
     p_masked_key, p_fingerprint, p_key_ref,
     COALESCE(p_scope_tiers, ARRAY[]::text[]), p_cap_sen, p_rotation_date,
     p_billing_owner::core.billing_owner, p_region,
     pg_catalog.jsonb_build_object(
       'kind', app.actor_kind()::text,
       'id',   COALESCE(app.jwt() ->> 'sub', 'unknown'),
       'name', NULL))
  RETURNING * INTO v_row;

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'id', v_row.provider_ref, 'provider', v_row.provider,
    'label', v_row.label, 'status', v_row.status,
    'maskedKey', v_row.masked_key, 'region', v_row.region,
    'billingOwner', v_row.billing_owner));
END;
$fn$;

COMMENT ON FUNCTION public.ai_provider_key_set(text,text,text,text,bytea,text,text[],text,text,bigint,date) IS
  'POST /v1/ai/providers. Write-only in the contract''s sense: it returns the '
  'MASKED record and never the key, because it never had the key. M-10(1).';

CREATE OR REPLACE FUNCTION public.ai_provider_key_test(
  p_provider_ref text,
  p_status       text,
  p_message      text DEFAULT NULL,
  p_request_id   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_tenant uuid := app.require_tenant_id();
  v_row    core.ai_provider_keys;
BEGIN
  IF app.is_agent() OR NOT app.has_permission('ai:provider:test') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'TRNOS',
      DETAIL = pg_catalog.jsonb_build_object('code','FORBIDDEN')::text;
  END IF;

  UPDATE core.ai_provider_keys AS provider_key
     SET status         = p_status::core.provider_key_status,
         last_tested_at = pg_catalog.now(),
         invalid_since  = CASE
                            WHEN p_status = 'INVALID'
                              THEN COALESCE(provider_key.invalid_since, pg_catalog.now())
                            ELSE NULL
                          END
   WHERE provider_key.tenant_id = v_tenant
     AND provider_key.provider_ref = p_provider_ref
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'no_data_found',
      DETAIL = pg_catalog.jsonb_build_object('code','NOT_FOUND')::text;
  END IF;

  -- The probe itself happened in the Edge Function, which held the key. That
  -- decrypt is auditable exactly like any other: PROBE.
  PERFORM app.record_key_access(
    v_tenant, p_provider_ref, 'PROBE',
    pg_catalog.jsonb_build_object(
      'kind', app.actor_kind()::text,
      'id',   COALESCE(app.jwt() ->> 'sub', 'unknown'),
      'name', NULL),
    'ai-provider-test', p_request_id, NULL, app.aal(), NULL);

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'status', v_row.status, 'lastTestedAt', v_row.last_tested_at,
    'message', p_message));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.ai_provider_key_rotate(
  p_provider_ref text,
  p_masked_key   text,
  p_fingerprint  bytea,
  p_key_ref      text,
  p_request_id   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_tenant  uuid := app.require_tenant_id();
  v_old_ref text;
  v_row     core.ai_provider_keys;
BEGIN
  IF app.is_agent() OR NOT app.has_permission('ai:provider:rotate') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'TRNOS',
      DETAIL = pg_catalog.jsonb_build_object('code','FORBIDDEN')::text;
  END IF;
  IF app.aal() <> 'aal2' THEN
    RAISE EXCEPTION 'MFA_REQUIRED' USING ERRCODE = 'TRNOS',
      DETAIL = pg_catalog.jsonb_build_object('code','MFA_REQUIRED')::text;
  END IF;

  -- Audited BEFORE the row moves, so the locator recorded is the one that was
  -- in force when the rotation was authorised.
  PERFORM app.record_key_access(
    v_tenant, p_provider_ref, 'ROTATE',
    pg_catalog.jsonb_build_object(
      'kind', app.actor_kind()::text,
      'id',   COALESCE(app.jwt() ->> 'sub', 'unknown'),
      'name', NULL),
    'ai-provider-rotate', p_request_id, NULL, app.aal(), NULL);

  UPDATE core.ai_provider_keys AS provider_key
     SET masked_key      = p_masked_key,
         key_fingerprint = p_fingerprint,
         key_ref         = p_key_ref,
         -- 17: "old key invalidated immediately". A rotated key has not been
         -- tested, so it is NOT_SET until a probe says otherwise - carrying the
         -- old VALID forward would claim a key nobody has exercised works.
         status          = 'NOT_SET',
         last_tested_at  = NULL,
         invalid_since   = NULL,
         -- The ceiling is per KEY MATERIAL, not per row: a rotation issues new
         -- material, so the previous reveal no longer constrains it.
         last_revealed_at = NULL
   WHERE provider_key.tenant_id = v_tenant
     AND provider_key.provider_ref = p_provider_ref
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'no_data_found',
      DETAIL = pg_catalog.jsonb_build_object('code','NOT_FOUND')::text;
  END IF;

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'id', v_row.provider_ref, 'maskedKey', v_row.masked_key,
    'status', v_row.status));
END;
$fn$;

COMMENT ON FUNCTION public.ai_provider_key_rotate(text,text,bytea,text,text) IS
  'POST /v1/ai/providers/{id}/rotate. Doc 02 6.4''s warning belongs in the '
  'runbook, not here: THIS is per-secret rotation. Root encryption key rotation '
  'is a Management API operation that makes every existing secret unreadable and '
  'has no automated re-encryption; it is not reachable from SQL and this '
  'function is not it.';

CREATE OR REPLACE FUNCTION public.ai_provider_key_delete(p_provider_ref text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_tenant  uuid := app.require_tenant_id();
  v_row     core.ai_provider_keys;
  v_orphan  text;
BEGIN
  IF app.is_agent() OR NOT app.has_permission('ai:provider:delete') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'TRNOS',
      DETAIL = pg_catalog.jsonb_build_object('code','FORBIDDEN')::text;
  END IF;
  IF app.aal() <> 'aal2' THEN
    RAISE EXCEPTION 'MFA_REQUIRED' USING ERRCODE = 'TRNOS',
      DETAIL = pg_catalog.jsonb_build_object('code','MFA_REQUIRED')::text;
  END IF;

  SELECT * INTO v_row
    FROM core.ai_provider_keys AS provider_key
   WHERE provider_key.tenant_id = v_tenant
     AND provider_key.provider_ref = p_provider_ref;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'no_data_found',
      DETAIL = pg_catalog.jsonb_build_object('code','NOT_FOUND')::text;
  END IF;

  -- 17: refuse if any tier in scope_tiers would be left with no VALID key.
  SELECT tier.value INTO v_orphan
    FROM pg_catalog.unnest(v_row.scope_tiers) AS tier(value)
   WHERE NOT EXISTS (
     SELECT 1 FROM core.ai_provider_keys AS survivor
      WHERE survivor.tenant_id = v_tenant
        AND survivor.id <> v_row.id
        AND survivor.status = 'VALID'
        AND tier.value = ANY (survivor.scope_tiers))
   LIMIT 1;

  IF v_orphan IS NOT NULL THEN
    RAISE EXCEPTION 'CONFLICT' USING ERRCODE = 'raise_exception',
      DETAIL = pg_catalog.jsonb_build_object(
        'code','CONFLICT','reason','TIER_WOULD_HAVE_NO_KEY','tier',v_orphan)::text;
  END IF;

  DELETE FROM core.ai_provider_keys AS provider_key
   WHERE provider_key.tenant_id = v_tenant AND provider_key.id = v_row.id;

  RETURN app.ok(pg_catalog.jsonb_build_object('id', p_provider_ref, 'deleted', true));
END;
$fn$;

COMMENT ON FUNCTION public.ai_provider_key_delete(text) IS
  'DELETE /v1/ai/providers/{id}. The orphan check reads this migration''s own '
  'forced table and would therefore find nothing on a platform whose owner lacks '
  'BYPASSRLS - i.e. it degrades OPEN. That does not matter here and the reason is '
  'worth writing down: the SELECT above it degrades CLOSED, so under the residue '
  'the function raises NOT_FOUND and never reaches the check at all. 014''s '
  'policies restore both.';

-- ── M-10(2)(3)(4) · the audited reveal ─────────────────────────────────────
--
-- THIS FUNCTION DOES NOT RETURN A KEY, and that is the design rather than a
-- limitation. It is the GATE and the LEDGER: it checks the permission, the
-- step-up, the reason and the 24-hour ceiling, writes the audit row, emits
-- ProviderKeyRevealed, and returns the opaque locator plus the audit id. The
-- Edge Function performs the decrypt against the platform secret store. The key
-- therefore never transits Postgres in either direction.
--
-- RESIDUE, NAMED: a caller that already holds the platform secret store's own
-- credentials can decrypt without ever calling this, and no SQL can prevent
-- that. What this closes is the path anon, authenticated and every application
-- role actually have.
CREATE OR REPLACE FUNCTION public.ai_provider_key_reveal(
  p_provider_ref text,
  p_reason       text,
  p_request_id   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_tenant   uuid := app.require_tenant_id();
  v_row      core.ai_provider_keys;
  v_audit    uuid;
  v_actor    jsonb;
  v_bumped   uuid;
BEGIN
  IF app.is_agent() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'TRNOS',
      DETAIL = pg_catalog.jsonb_build_object('code','FORBIDDEN','reason','AGENT')::text;
  END IF;
  IF NOT app.has_permission('ai:provider:reveal') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'TRNOS',
      DETAIL = pg_catalog.jsonb_build_object('code','FORBIDDEN')::text;
  END IF;
  -- M-10(2). app.aal2_verified(), not app.aal(): a forged token can claim any
  -- session_id it likes but cannot conjure a matching auth.sessions row at aal2.
  IF NOT app.aal2_verified() THEN
    RAISE EXCEPTION 'MFA_REQUIRED' USING ERRCODE = 'TRNOS',
      DETAIL = pg_catalog.jsonb_build_object('code','MFA_REQUIRED')::text;
  END IF;
  IF COALESCE(pg_catalog.length(pg_catalog.btrim(COALESCE(p_reason, ''))), 0) < 10 THEN
    RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = 'check_violation',
      DETAIL = pg_catalog.jsonb_build_object('code','REASON_REQUIRED')::text;
  END IF;

  SELECT * INTO v_row
    FROM core.ai_provider_keys AS provider_key
   WHERE provider_key.tenant_id = v_tenant
     AND provider_key.provider_ref = p_provider_ref;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'no_data_found',
      DETAIL = pg_catalog.jsonb_build_object('code','NOT_FOUND')::text;
  END IF;

  -- M-10(3), read first so the caller gets the right error, ENFORCED below as
  -- the predicate of the write so two concurrent reveals cannot both pass.
  IF v_row.last_revealed_at IS NOT NULL
     AND v_row.last_revealed_at > pg_catalog.now() - interval '24 hours' THEN
    RAISE EXCEPTION 'RATE_LIMITED' USING ERRCODE = 'raise_exception',
      DETAIL = pg_catalog.jsonb_build_object(
        'code','RATE_LIMITED','reason','ONE_REVEAL_PER_24H',
        'lastRevealedAt', v_row.last_revealed_at)::text;
  END IF;

  v_actor := pg_catalog.jsonb_build_object(
    'kind', app.actor_kind()::text,
    'id',   COALESCE(app.jwt() ->> 'sub', 'unknown'),
    'name', NULL);

  -- ORDER IS THE CONTROL. Audit first; publish its id; only then bump. The
  -- trigger on core.ai_provider_keys refuses the bump if the audit row is not
  -- there, so there is no ordering in which the reveal succeeds and the audit
  -- does not.
  v_audit := app.record_key_access(
    v_tenant, p_provider_ref, 'REVEAL', v_actor,
    'ai-provider-reveal', p_request_id, NULL, 'aal2', p_reason);

  PERFORM pg_catalog.set_config('app.key_reveal_audit', v_audit::text, true);

  UPDATE core.ai_provider_keys AS provider_key
     SET last_revealed_at = pg_catalog.now(),
         reveal_count     = provider_key.reveal_count + 1
   WHERE provider_key.tenant_id = v_tenant
     AND provider_key.id = v_row.id
     AND (provider_key.last_revealed_at IS NULL
          OR provider_key.last_revealed_at <= pg_catalog.now() - interval '24 hours')
  RETURNING provider_key.id INTO v_bumped;

  PERFORM pg_catalog.set_config('app.key_reveal_audit', '', true);

  IF v_bumped IS NULL THEN
    RAISE EXCEPTION 'RATE_LIMITED' USING ERRCODE = 'raise_exception',
      DETAIL = pg_catalog.jsonb_build_object(
        'code','RATE_LIMITED','reason','ONE_REVEAL_PER_24H')::text;
  END IF;

  -- Doc 05 5.4: only REVEAL emits a domain event, and it emits through 012's
  -- app.emit_event. There is no second event path.
  PERFORM app.emit_event(
    p_tenant_id      => v_tenant,
    p_type           => 'ProviderKeyRevealed',
    p_aggregate_type => 'PROVIDER_KEY',
    p_aggregate_id   => v_row.id,
    p_aggregate_ref  => v_row.provider_ref,
    p_payload        => pg_catalog.jsonb_build_object(
                          'providerId', v_row.provider_ref,
                          'reason', p_reason,
                          'aal', 'aal2'),
    p_summary        => pg_catalog.format(
                          '%s provider key revealed', v_row.provider_ref),
    p_actor          => v_actor);

  RETURN app.ok(pg_catalog.jsonb_build_object(
    'providerId',  v_row.provider_ref,
    'keyRef',      v_row.key_ref,
    'auditId',     v_audit,
    'revealedAt',  pg_catalog.now()));
END;
$fn$;

COMMENT ON FUNCTION public.ai_provider_key_reveal(text,text,text) IS
  'POST /v1/ai/providers/{id}/reveal. Closes all four halves of M-10. Returns '
  'the OPAQUE LOCATOR and the audit id, never the key: the decrypt is the Edge '
  'Function''s, so no reveal path puts key material into a database statement, a '
  'log line or a result set. 17 Q4 asked whether reveal should exist at all; '
  'doc 02 6.3 recommends keeping it behind three gates plus a 24-hour ceiling, '
  'and all four are here and executed by the pin.';

-- ═══ 9 · Retention and the usage rollup writer ══════════════════════════════
--
-- Doc 05 6.7's RETENTION_REDACT job, with 012's reaper conventions applied:
-- batched by a LIMIT, and RETURNING a count so 015 can alarm on a reaper that
-- silently stops. The SCHEDULE is 015's; the FUNCTION is here.
CREATE OR REPLACE FUNCTION app.redact_run_io(p_limit integer DEFAULT 5000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_cut  timestamptz := pg_catalog.now() - interval '30 days';
  v_io   integer := 0;
  v_snap integer := 0;
  v_node integer := 0;
  v_run  integer := 0;
BEGIN
  WITH doomed AS (
    SELECT io.id
      FROM core.run_node_io AS io
     WHERE io.created_at < v_cut
     ORDER BY io.created_at
     LIMIT GREATEST(p_limit, 0)
       FOR UPDATE SKIP LOCKED
  ), gone AS (
    DELETE FROM core.run_node_io AS io
     USING doomed
     WHERE io.id = doomed.id
    RETURNING io.id
  )
  SELECT pg_catalog.count(*)::integer INTO v_io FROM gone;

  WITH doomed AS (
    SELECT snapshot.id
      FROM core.run_snapshots AS snapshot
     WHERE snapshot.captured_at < v_cut
     ORDER BY snapshot.captured_at
     LIMIT GREATEST(p_limit, 0)
       FOR UPDATE SKIP LOCKED
  ), gone AS (
    DELETE FROM core.run_snapshots AS snapshot
     USING doomed
     WHERE snapshot.id = doomed.id
    RETURNING snapshot.id
  )
  SELECT pg_catalog.count(*)::integer INTO v_snap FROM gone;

  -- Tool args and results are nulled rather than masked: they are arbitrary
  -- jsonb, and a regex over a json document masks the keys as readily as the
  -- values. Doc 05 6.7 nulls them too.
  WITH doomed AS (
    SELECT node.id
      FROM core.run_nodes AS node
     WHERE node.finished_at < v_cut
       AND (node.args IS NOT NULL OR node.result IS NOT NULL)
     ORDER BY node.finished_at
     LIMIT GREATEST(p_limit, 0)
       FOR UPDATE SKIP LOCKED
  ), cleared AS (
    UPDATE core.run_nodes AS node
       SET args = NULL, result = NULL
      FROM doomed
     WHERE node.id = doomed.id
    RETURNING node.id
  )
  SELECT pg_catalog.count(*)::integer INTO v_node FROM cleared;

  WITH doomed AS (
    SELECT run.id
      FROM core.runs AS run
     WHERE run.finished_at < v_cut
       AND run.redacted_at IS NULL
     ORDER BY run.finished_at
     LIMIT GREATEST(p_limit, 0)
       FOR UPDATE SKIP LOCKED
  ), stamped AS (
    UPDATE core.runs AS run
       SET redacted_at = pg_catalog.now()
      FROM doomed
     WHERE run.id = doomed.id
    RETURNING run.id
  )
  SELECT pg_catalog.count(*)::integer INTO v_run FROM stamped;

  RETURN v_io + v_snap + v_node + v_run;
END;
$fn$;

COMMENT ON FUNCTION app.redact_run_io(integer) IS
  'Doc 05 6.7''s RETENTION_REDACT, batched. What SURVIVES indefinitely is run '
  'status, outcome, tier, model, provider, token counts, cache hit rate, cost, '
  'durations, retries, halted_by, run events, state cards and checkpoints - '
  'enough to answer "what did the agents cost and how often did they halt" a '
  'year later without keeping a word of anyone''s correspondence. Doc 05 writes '
  'this unbatched; a 30-day backlog on a busy tenant would be one unbounded '
  'DELETE per cron tick, which is H-18''s finding in another table.';

-- M-03's writer. app.usage_rollup would otherwise be defined and never written,
-- which is the same defect the finding names in the other direction.
--
-- SOURCE: core.runs and core.run_nodes, not an app.usage_event table. Doc 04
-- 5.5 proposes a range-partitioned per-call event ledger in micro-MYR; it is
-- NOT built here - see the header - so the rollup aggregates the run record,
-- which is where cost_sen and the token counts actually live.
CREATE OR REPLACE FUNCTION app.roll_up_usage(p_tenant_id uuid, p_period text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_rows integer;
BEGIN
  IF p_tenant_id IS NULL OR p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'roll_up_usage: tenant and a YYYY-MM period are required, got %',
      COALESCE(p_period, 'NULL') USING ERRCODE = 'invalid_parameter_value';
  END IF;

  WITH agent_scope AS (
    SELECT 'AGENT'::core.budget_scope AS scope,
           run.agent_id               AS key,
           pg_catalog.sum(run.cost_sen)::bigint   AS spend_sen,
           pg_catalog.sum(run.tokens_in)::bigint  AS tokens_in,
           pg_catalog.sum(run.tokens_out)::bigint AS tokens_out,
           pg_catalog.count(*)::integer           AS runs
      FROM core.runs AS run
     WHERE run.tenant_id = p_tenant_id
       AND run.mode = 'LIVE'
       AND pg_catalog.to_char(run.started_at, 'YYYY-MM') = p_period
     GROUP BY run.agent_id
  ), tier_scope AS (
    SELECT 'TIER'::core.budget_scope AS scope,
           node.tier                  AS key,
           pg_catalog.sum(node.cost_sen)::bigint                      AS spend_sen,
           pg_catalog.sum(COALESCE(node.tokens_in, 0))::bigint        AS tokens_in,
           pg_catalog.sum(COALESCE(node.tokens_out, 0))::bigint       AS tokens_out,
           pg_catalog.count(DISTINCT node.run_id)::integer            AS runs
      FROM core.run_nodes AS node
      JOIN core.runs AS run
        ON run.tenant_id = node.tenant_id AND run.id = node.run_id
     WHERE node.tenant_id = p_tenant_id
       AND node.tier IS NOT NULL
       AND run.mode = 'LIVE'
       AND pg_catalog.to_char(run.started_at, 'YYYY-MM') = p_period
     GROUP BY node.tier
  ), action_scope AS (
    SELECT 'ACTION_TYPE'::core.budget_scope AS scope,
           request.action_type              AS key,
           pg_catalog.sum(run.cost_sen)::bigint   AS spend_sen,
           pg_catalog.sum(run.tokens_in)::bigint  AS tokens_in,
           pg_catalog.sum(run.tokens_out)::bigint AS tokens_out,
           pg_catalog.count(*)::integer           AS runs
      FROM core.runs AS run
      JOIN core.action_requests AS request
        ON request.tenant_id = run.tenant_id AND request.id = run.action_request_id
     WHERE run.tenant_id = p_tenant_id
       AND run.mode = 'LIVE'
       AND pg_catalog.to_char(run.started_at, 'YYYY-MM') = p_period
     GROUP BY request.action_type
  ), combined AS (
    SELECT * FROM agent_scope
    UNION ALL SELECT * FROM tier_scope
    UNION ALL SELECT * FROM action_scope
  ), written AS (
    INSERT INTO app.usage_rollup
      (tenant_id, period, scope, key, spend_sen, tokens_in, tokens_out, runs, computed_at)
    SELECT p_tenant_id, p_period, combined.scope, combined.key,
           combined.spend_sen, combined.tokens_in, combined.tokens_out,
           combined.runs, pg_catalog.now()
      FROM combined
    ON CONFLICT (tenant_id, period, scope, key) DO UPDATE
      SET spend_sen   = EXCLUDED.spend_sen,
          tokens_in   = EXCLUDED.tokens_in,
          tokens_out  = EXCLUDED.tokens_out,
          runs        = EXCLUDED.runs,
          computed_at = EXCLUDED.computed_at
    RETURNING 1 AS written
  )
  SELECT pg_catalog.count(*)::integer INTO v_rows FROM written;

  RETURN v_rows;
END;
$fn$;

COMMENT ON FUNCTION app.roll_up_usage(uuid, text) IS
  'M-03''s writer. Aggregates LIVE runs only: a SANDBOX replay costs real '
  'tokens but is a debugging act, and counting it against a tenant''s budget cap '
  'would pause their agents for reproducing a bug. The three scopes are exactly '
  'core.budget_scope''s three members, so every budget row has a rollup row it '
  'can join to.';

-- ═══ 10 · The two derived-status views ══════════════════════════════════════
--
-- security_invoker = true at creation, not bolted on (M-02). Both are in `core`
-- because PostgREST exposes it and the screens read them; neither adds any
-- privilege of its own, and until 014 grants SELECT nobody can read either.
--
-- core.budget_status is FIRST because core.model_tier_status reads it. That is
-- also the drop order in the rollback, reversed.

CREATE VIEW core.budget_status WITH (security_invoker = true) AS
SELECT
  budget.id,
  budget.tenant_id,
  budget.scope,
  budget.key,
  budget.cap_sen,
  budget.currency,
  budget.near_threshold,
  pg_catalog.to_char(pg_catalog.now(), 'YYYY-MM')      AS period,
  COALESCE(rollup.spend_sen, 0)                        AS spend_sen,
  -- M-03. The NEAR / PAUSED transition, defined ONCE. Order matters and is
  -- pinned: spend EXACTLY at cap is PAUSED, not NEAR - the >= on the first
  -- branch is what makes "a tripped cap" a fact about spend against cap rather
  -- than a flag somebody remembered to set.
  CASE
    WHEN COALESCE(rollup.spend_sen, 0) >= budget.cap_sen THEN 'PAUSED'
    WHEN COALESCE(rollup.spend_sen, 0)
         >= (budget.cap_sen::numeric * budget.near_threshold) THEN 'NEAR'
    ELSE 'WITHIN'
  END::core.budget_state                               AS state
FROM core.ai_budgets AS budget
LEFT JOIN app.usage_rollup AS rollup
  ON rollup.tenant_id = budget.tenant_id
 AND rollup.scope = budget.scope
 AND rollup.key = budget.key
 AND rollup.period = pg_catalog.to_char(pg_catalog.now(), 'YYYY-MM');

COMMENT ON VIEW core.budget_status IS
  'Doc 04 5.5 (its app.budget_status), in core per C-03 and M-02. M-03: the '
  'relation it joins, app.usage_rollup, now exists. A budget with no rollup row '
  'reads WITHIN at zero spend rather than disappearing, which is why the join is '
  'LEFT - an inner join would hide every budget nobody has spent against yet, '
  'and those are the ones a new tenant has.';

CREATE VIEW core.model_tier_status WITH (security_invoker = true) AS
SELECT
  tier.id,
  tier.tenant_id,
  tier.tier_key,
  tier.model,
  tier.provider,
  tier.routing,
  tier.fallback_chain,
  tier.cache_strategy,
  tier.max_output_tokens,
  tier.allowed_hours,
  tier.batch_eligible,
  tier.admin_state,
  tier.health,
  tier.degraded_since,
  tier.degraded_reason,
  tier.active_fallback_tier,
  tier.monthly_cap_sen,
  tier.currency,
  -- Doc 04 5.1. Three independent causes, one derived value. Nothing ever
  -- writes PAUSED_BY_CAP anywhere: it is what a tier IS when its budget is
  -- PAUSED, computed here and nowhere else.
  CASE
    WHEN tier.admin_state = 'DISABLED'  THEN 'DISABLED'
    WHEN budget.state = 'PAUSED'        THEN 'PAUSED_BY_CAP'
    WHEN tier.health = 'DEGRADED'       THEN 'DEGRADED'
    ELSE 'HEALTHY'
  END::core.tier_status AS status
FROM core.model_tiers AS tier
LEFT JOIN core.budget_status AS budget
  ON budget.tenant_id = tier.tenant_id
 AND budget.scope = 'TIER'
 AND budget.key = tier.tier_key;

COMMENT ON VIEW core.model_tier_status IS
  'Doc 04 5.1 (its app.model_tier_status), in core per C-03 and M-02. The '
  'precedence is the document''s: an admin DISABLE outranks a budget pause, '
  'which outranks provider degradation. Columns are listed explicitly rather '
  'than `tier.*`, so a column added to core.model_tiers later is a deliberate '
  'edit here rather than a silent change to what the API returns.';

-- ═══ 11 · The run_id reconciliation, in three foreign keys ══════════════════
--
-- 007 and 009 wrote `run_id uuid` with the comment "FK added by 013, which
-- creates core.runs" against three tables. This is that FK, composite and
-- tenant-safe like every other in the pack, and it is the uuid half of the
-- decision the header states in full.
--
-- ON DELETE SET NULL, not CASCADE: deleting a run must not delete the proposal
-- it drafted. The run is the trace; the proposal is the business record.
--
-- These ALTERs are the ONLY thing 013 does to a table it does not own. They add
-- a constraint, they remove nothing, and they are dropped by name in the
-- rollback. On this database they validate against zero rows: nothing in
-- 001-012 writes any of the three columns.
ALTER TABLE core.proposals
  ADD CONSTRAINT proposals_run_fk FOREIGN KEY (tenant_id, run_id)
    REFERENCES core.runs (tenant_id, id) ON DELETE SET NULL;

ALTER TABLE core.provenance
  ADD CONSTRAINT provenance_run_fk FOREIGN KEY (tenant_id, run_id)
    REFERENCES core.runs (tenant_id, id) ON DELETE SET NULL;

ALTER TABLE core.rule_change_sets
  ADD CONSTRAINT rule_change_sets_run_fk FOREIGN KEY (tenant_id, run_id)
    REFERENCES core.runs (tenant_id, id) ON DELETE SET NULL;

-- 007 already carries provenance_run_idx (tenant_id, run_id). The other two did
-- not need an index before they had a foreign key, and do now.
CREATE INDEX IF NOT EXISTS proposals_run_idx
  ON core.proposals (tenant_id, run_id) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS rule_change_sets_run_idx
  ON core.rule_change_sets (tenant_id, run_id) WHERE run_id IS NOT NULL;

-- ═══ 12 · Privilege boundary ════════════════════════════════════════════════
--
-- Functions default to PUBLIC EXECUTE. 001 measured that
-- ALTER DEFAULT PRIVILEGES ... REVOKE does NOT take for functions, so this loop
-- is the guard and not a formality. It names the 013 set exactly; a blanket
-- schema revoke would damage 002's caller-context RLS helpers (M-04).
--
-- The loop iterates oid::regprocedure - the FULL signature - which is M-09's
-- lesson: a REVOKE naming only the function name errors with "function name is
-- not unique" the moment a second overload exists, and leaves both executable.
DO $revoke$
DECLARE v_function regprocedure;
BEGIN
  FOR v_function IN
    SELECT procedure.oid::regprocedure
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
     WHERE (namespace.nspname = 'app' AND procedure.proname = ANY (ARRAY[
             'mask_key','is_masked_key','agent_key_digest','is_valid_run_trigger',
             'is_valid_halted_by','is_valid_run_failure','is_valid_plan',
             'is_valid_state_card_budgets','is_valid_checkpoint_cursor',
             'is_valid_jury_policy','is_valid_metric_condition',
             'is_valid_run_event_detail','is_valid_redaction_counts',
             'redact_pattern','redact_pii','placeholder_count','pii_counts',
             'mask_run_io','require_reveal_audit','record_key_access',
             'mint_agent_key','verify_agent_key','redact_run_io','roll_up_usage']))
        OR (namespace.nspname = 'public' AND procedure.proname = ANY (ARRAY[
             'ai_provider_key_set','ai_provider_key_test','ai_provider_key_rotate',
             'ai_provider_key_delete','ai_provider_key_reveal']))
  LOOP
    -- ⚠ `service_role` IS IN THIS LIST, AND IT WAS NOT.
    --
    -- The comment beside this block says the intent is that NOBODY holds EXECUTE
    -- on the five `public.ai_provider_key_*` definers — they are reached through
    -- the Edge Function's own credential, not through PostgREST. The revoke named
    -- PUBLIC, anon and authenticated and stopped, which is the whole set on a
    -- vanilla Postgres and NOT the whole set on Supabase: the platform bootstrap
    -- grants `service_role` EXECUTE on functions in `public` by default unless
    -- something explicitly takes it away. So on hosted — and only on hosted — the
    -- five key RPCs were callable by the one role every server-side integration
    -- already holds.
    --
    -- ⚠ THIS CANNOT BE PROVED ON THIS HARNESS, and saying so is the point. The
    -- shim is vanilla Postgres with no Supabase ALTER DEFAULT PRIVILEGES
    -- bootstrap, so `service_role` has no EXECUTE here either way and the pin
    -- below passes identically before and after this line. The revoke is correct
    -- regardless — revoking a privilege nobody holds costs nothing — but the
    -- CONFIRMATION is owed against a real project. Recorded in the catalog as
    -- such rather than reported as verified.
    EXECUTE pg_catalog.format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', v_function);
  END LOOP;
END;
$revoke$;

-- The run engine's surface, and nothing else.
--
-- app.verify_agent_key    the exchange Edge Function's lookup (02 3.1 step 1).
-- app.record_key_access   the run engine's per-call decrypt audit (05 5.4
--                         rule #2) - the RUN_CALL half of the same table the
--                         reveal endpoint writes.
--
-- DELIBERATELY NOT GRANTED, each for a reason:
--   app.mint_agent_key       issuing a credential is an ADMIN act, and 014
--                            decides whether it reaches PostgREST at all.
--   app.redact_run_io        015's scheduler runs it, as with 012's five reapers.
--   app.roll_up_usage        same.
--   the five provider-key RPCs  an ADMIN's, through PostgREST, in 014. A worker
--                            holding service_role must not be able to rotate or
--                            reveal a tenant's BYOK key.
GRANT EXECUTE ON FUNCTION app.verify_agent_key(text) TO service_role;
GRANT EXECUTE ON FUNCTION app.record_key_access(
  uuid, text, text, jsonb, text, text, uuid, text, text)             TO service_role;

-- ═══ 13 · Structural verification ═══════════════════════════════════════════
--
-- Off the catalogues, not a re-reading of the DDL above. If any of this is false
-- the transaction never commits. Nothing here is a text search of a function
-- body: 011 learned that a pg_get_functiondef tripwire fails on its own
-- whitespace and gets deleted by the next author. The BEHAVIOUR is proved by
-- test_013.

DO $verify$
DECLARE
  v_tables    text[] := ARRAY[
    'core.tier_keys','core.agents','public.agent_api_keys',
    'app.agent_api_key_secrets','core.model_tiers',
    'core.routing_matrix_versions','core.routing_entries',
    'core.ai_provider_keys','core.ai_budgets','app.usage_rollup',
    'core.runs','core.run_nodes','core.run_node_io','core.run_events',
    'core.run_state_cards','core.run_checkpoints','core.run_snapshots',
    'core.evals','app.key_access_audit'];
  v_app_fns   text[] := ARRAY[
    'mask_key','is_masked_key','agent_key_digest','is_valid_run_trigger',
    'is_valid_halted_by','is_valid_run_failure','is_valid_plan',
    'is_valid_state_card_budgets','is_valid_checkpoint_cursor',
    'is_valid_jury_policy','is_valid_metric_condition',
    'is_valid_run_event_detail','is_valid_redaction_counts',
    'redact_pattern','redact_pii','placeholder_count','pii_counts',
    'mask_run_io','require_reveal_audit','record_key_access',
    'mint_agent_key','verify_agent_key','redact_run_io','roll_up_usage'];
  v_pub_fns   text[] := ARRAY[
    'ai_provider_key_set','ai_provider_key_test','ai_provider_key_rotate',
    'ai_provider_key_delete','ai_provider_key_reveal'];
  -- Every column on a 013 table whose name could plausibly hold key material.
  -- The assertion is EQUALITY, not containment: a new column called
  -- `provider_key` or `api_secret` fails this migration rather than shipping.
  v_key_cols  text[] := ARRAY[
    'app.agent_api_key_secrets.api_key_id','app.agent_api_key_secrets.key_digest',
    'app.agent_api_key_secrets.key_salt','app.key_access_audit.key_ref',
    'app.key_access_audit.provider_key_id','app.usage_rollup.key',
    'app.usage_rollup.tokens_in','app.usage_rollup.tokens_out',
    'core.ai_budgets.key','core.ai_provider_keys.key_fingerprint',
    'core.ai_provider_keys.key_ref','core.ai_provider_keys.masked_key',
    'core.model_tiers.max_output_tokens','core.model_tiers.tier_key',
    'core.routing_entries.tier_key','core.run_checkpoints.node_key',
    'core.run_events.node_key','core.run_nodes.node_key',
    'core.run_nodes.tokens_in','core.run_nodes.tokens_out',
    'core.runs.tokens_in','core.runs.tokens_out','core.tier_keys.tier_key',
    'public.agent_api_keys.key_prefix'];
  -- N-02's NAMED exemption: jsonb whose key set is open by definition, so only
  -- the jsonb_typeof half of R-JSONB applies. Named here rather than allowed to
  -- slip through the sweep below unremarked.
  v_open_json text[] := ARRAY[
    'core.run_nodes.args','core.run_nodes.result',
    'core.run_snapshots.args','core.run_snapshots.response',
    'core.evals.detail'];
  v_count     integer;
  v_offender  text;
  v_kinds     text[];
  v_found     text[];
BEGIN
  -- ── Inventory ───────────────────────────────────────────────────────────
  SELECT pg_catalog.count(*)::integer INTO v_count
    FROM pg_catalog.unnest(v_tables) AS expected(name)
   WHERE pg_catalog.to_regclass(expected.name) IS NOT NULL;
  IF v_count <> 19 THEN
    RAISE EXCEPTION '013 verify: expected 19 tables, found %', v_count;
  END IF;

  IF pg_catalog.to_regclass('core.budget_status') IS NULL
     OR pg_catalog.to_regclass('core.model_tier_status') IS NULL THEN
    RAISE EXCEPTION '013 verify: a derived-status view is missing';
  END IF;

  -- Rule 8. security_invoker on BOTH views, at creation, not bolted on (M-02).
  SELECT pg_catalog.string_agg(class.relname, ', ') INTO v_offender
    FROM pg_catalog.pg_class AS class
   WHERE class.oid IN ('core.budget_status'::regclass,
                       'core.model_tier_status'::regclass)
     AND NOT COALESCE(
           (SELECT option_value
              FROM pg_catalog.pg_options_to_table(class.reloptions)
             WHERE option_name = 'security_invoker'), 'false')::boolean;
  IF v_offender IS NOT NULL THEN
    RAISE EXCEPTION
      '013 verify: view(s) % are not security_invoker = true. A definer-rights '
      'view sidesteps every policy 014 will add (M-02).', v_offender;
  END IF;

  -- ── H-08 · enabled AND forced, per table, before this commits ───────────
  SELECT pg_catalog.string_agg(expected.name, ', ') INTO v_offender
    FROM pg_catalog.unnest(v_tables) AS expected(name)
    JOIN pg_catalog.pg_class AS class ON class.oid = expected.name::regclass
   WHERE NOT (class.relrowsecurity AND class.relforcerowsecurity);
  IF v_offender IS NOT NULL THEN
    RAISE EXCEPTION
      '013 verify (H-08): table(s) % are not RLS enabled AND forced. '
      'core.run_node_io holds full prompt and completion text and 001 measured '
      'that ALTER DEFAULT PRIVILEGES gives no backstop.', v_offender;
  END IF;

  -- Zero policies. A permissive policy on any of these before 014 would be a
  -- cross-tenant read grant arriving before the grant layer exists.
  SELECT pg_catalog.count(*)::integer INTO v_count
    FROM pg_catalog.pg_policy AS policy
   WHERE policy.polrelid IN (
     SELECT expected.name::regclass FROM pg_catalog.unnest(v_tables) AS expected(name));
  IF v_count <> 0 THEN
    RAISE EXCEPTION
      '013 verify (H-08): expected 0 policies across the 013 set, found %', v_count;
  END IF;

  -- ── H-09(a) · core.public_share_tokens, CHECKED not re-derived ──────────
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS class
     WHERE class.oid = 'core.public_share_tokens'::regclass
       AND class.relrowsecurity AND class.relforcerowsecurity) THEN
    RAISE EXCEPTION
      '013 verify (H-09): core.public_share_tokens is no longer RLS enabled and '
      'forced. 007 created it through app.finalise_table, which is the evidence '
      'that closed the first half of H-09; if that has changed, the finding is '
      'open again and 013''s header is wrong.';
  END IF;

  -- ── H-09(b) · key_hash is not on the exposed table ──────────────────────
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid = 'public.agent_api_keys'::regclass
       AND attribute.attnum > 0 AND NOT attribute.attisdropped
       AND attribute.attname IN ('key_hash','key_digest','key_salt','key')) THEN
    RAISE EXCEPTION
      '013 verify (H-09): public.agent_api_keys has grown a hash column. The '
      'digest belongs in app.agent_api_key_secrets, in a schema PostgREST does '
      'not serve - which is the mechanism, and a column omitted from a grant is '
      'not.';
  END IF;

  -- ── No column in this pack can hold plaintext key material ──────────────
  SELECT pg_catalog.array_agg(
           namespace.nspname || '.' || class.relname || '.' || attribute.attname
           ORDER BY namespace.nspname, class.relname, attribute.attname)
    INTO v_found
    FROM pg_catalog.pg_attribute AS attribute
    JOIN pg_catalog.pg_class AS class ON class.oid = attribute.attrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
   WHERE class.oid IN (
     SELECT expected.name::regclass FROM pg_catalog.unnest(v_tables) AS expected(name))
     AND attribute.attnum > 0 AND NOT attribute.attisdropped
     AND attribute.attname ~ '(key|secret|token|password|credential)';
  IF v_found IS DISTINCT FROM (SELECT pg_catalog.array_agg(c ORDER BY c)
                                 FROM pg_catalog.unnest(v_key_cols) AS t(c)) THEN
    RAISE EXCEPTION
      '013 verify: the set of key-ish columns in this pack changed. Expected %, '
      'found %. Every one of the allowlisted columns is a mask, a digest, a '
      'salt, an opaque locator, a tier key, a node key or a token COUNT; a new '
      'column here needs a human to say which it is.',
      pg_catalog.array_to_string(v_key_cols, ', '),
      pg_catalog.array_to_string(v_found, ', ');
  END IF;

  -- core.ai_provider_keys' three secret-adjacent columns, by type and rule.
  IF (SELECT attribute.atttypid FROM pg_catalog.pg_attribute AS attribute
       WHERE attribute.attrelid = 'core.ai_provider_keys'::regclass
         AND attribute.attname = 'key_fingerprint') <> 'bytea'::regtype THEN
    RAISE EXCEPTION '013 verify: core.ai_provider_keys.key_fingerprint is not bytea';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint AS con
     WHERE con.conrelid = 'core.ai_provider_keys'::regclass
       AND con.contype = 'c'
       AND pg_catalog.pg_get_constraintdef(con.oid) LIKE '%is_masked_key%') THEN
    RAISE EXCEPTION
      '013 verify (M-10): core.ai_provider_keys.masked_key has lost its mask '
      'shape CHECK. With the raw key out of the database that constraint is the '
      'only thing standing between the display column and a pasted key.';
  END IF;

  -- ── The reveal path cannot run without writing an audit row (M-10(4)) ───
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger
     WHERE trigger.tgrelid = 'core.ai_provider_keys'::regclass
       AND NOT trigger.tgisinternal
       AND trigger.tgname = 'ai_provider_keys_reveal_audit'
       AND trigger.tgfoid = 'app.require_reveal_audit()'::regprocedure
       AND (trigger.tgtype & 1) = 1        -- FOR EACH ROW
       AND (trigger.tgtype & 2) = 2        -- BEFORE
       AND (trigger.tgtype & 16) = 16) THEN -- UPDATE
    RAISE EXCEPTION
      '013 verify (M-10): the reveal-audit trigger is missing. Without it '
      'last_revealed_at can be bumped with no app.key_access_audit row, which is '
      'the one case the finding says must not be possible.';
  END IF;

  -- app.key_access_audit is append-only on BOTH halves. A FOR EACH ROW trigger
  -- does not fire for TRUNCATE - measured in 012 - so the statement trigger is
  -- what makes the guarantee true.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger
     WHERE trigger.tgrelid = 'app.key_access_audit'::regclass
       AND NOT trigger.tgisinternal
       AND trigger.tgname = 'key_access_audit_append_only'
       AND (trigger.tgtype & 8) = 8 AND (trigger.tgtype & 16) = 16
       AND (trigger.tgtype & 4) = 0) THEN
    RAISE EXCEPTION
      '013 verify: app.key_access_audit is missing its BEFORE UPDATE OR DELETE '
      'row trigger, or it has grown an INSERT branch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger
     WHERE trigger.tgrelid = 'app.key_access_audit'::regclass
       AND NOT trigger.tgisinternal
       AND trigger.tgname = 'key_access_audit_no_truncate'
       AND (trigger.tgtype & 32) = 32 AND (trigger.tgtype & 1) = 0) THEN
    RAISE EXCEPTION
      '013 verify: app.key_access_audit is missing its BEFORE TRUNCATE statement '
      'trigger; a row trigger does not fire for TRUNCATE and the whole credential '
      'audit would be removable in one statement';
  END IF;

  -- M-25's masking trigger.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger
     WHERE trigger.tgrelid = 'core.run_node_io'::regclass
       AND NOT trigger.tgisinternal
       AND trigger.tgname = 'run_node_io_mask'
       AND trigger.tgfoid = 'app.mask_run_io()'::regprocedure
       AND (trigger.tgtype & 2) = 2 AND (trigger.tgtype & 4) = 4
       AND (trigger.tgtype & 16) = 16) THEN
    RAISE EXCEPTION
      '013 verify (M-25): core.run_node_io is missing its BEFORE INSERT OR '
      'UPDATE masking trigger, which is the only part of run I/O redaction that '
      'is inside the database at all';
  END IF;

  -- M-25's index, by name and by column list.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS index_class
     WHERE index_class.relname = 'run_node_io_subject_idx'
       AND index_class.relkind = 'i') THEN
    RAISE EXCEPTION
      '013 verify (M-25): run_node_io_subject_idx is missing - without it a '
      'manual erasure cannot find the rows, which is the finding''s own words';
  END IF;

  -- ── search_path, on every function, as the exact stored string ──────────
  SELECT pg_catalog.count(*)::integer INTO v_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
   WHERE ((namespace.nspname = 'app'    AND procedure.proname = ANY (v_app_fns))
       OR (namespace.nspname = 'public' AND procedure.proname = ANY (v_pub_fns)))
     AND 'search_path=""' = ANY (procedure.proconfig);
  IF v_count <> pg_catalog.array_length(v_app_fns, 1)
              + pg_catalog.array_length(v_pub_fns, 1) THEN
    RAISE EXCEPTION
      '013 verify: expected % functions at the exact string search_path="", '
      'found %. test_001 T3 asserts the same string across the whole applied '
      'set, so one of mine failing this fails 001''s pin too.',
      pg_catalog.array_length(v_app_fns, 1) + pg_catalog.array_length(v_pub_fns, 1),
      v_count;
  END IF;

  -- ── C-04 residue · zero client privileges, per table and per function ───
  SELECT pg_catalog.string_agg(DISTINCT expected.name, ', ') INTO v_offender
    FROM pg_catalog.unnest(v_tables
           || ARRAY['core.budget_status','core.model_tier_status']) AS expected(name)
    JOIN pg_catalog.pg_class AS class ON class.oid = expected.name::regclass
   -- LATERAL over relacl itself, not over COALESCE(..., '{}'): an empty
   -- aclitem[] literal is ZERO-dimensional and aclexplode raises "ACL arrays
   -- must be one-dimensional" on it. Found by executing this block, not by
   -- reading it. A NULL relacl yields no rows through the strict SRF, which is
   -- the right answer for a table: NULL relacl means owner-only.
   CROSS JOIN LATERAL pg_catalog.aclexplode(class.relacl) AS acl
   WHERE acl.grantee IN ('anon'::regrole, 'authenticated'::regrole, 0::oid::regrole);
  IF v_offender IS NOT NULL THEN
    RAISE EXCEPTION
      '013 verify (C-04 residue): relation(s) % carry a grant to anon, '
      'authenticated or PUBLIC. Grants land in 014 beside the policies.',
      v_offender;
  END IF;

  SELECT pg_catalog.string_agg(DISTINCT procedure.oid::regprocedure::text, ', ')
    INTO v_offender
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
   CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
   WHERE ((namespace.nspname = 'app'    AND procedure.proname = ANY (v_app_fns))
       OR (namespace.nspname = 'public' AND procedure.proname = ANY (v_pub_fns)))
     AND acl.grantee IN ('anon'::regrole, 'authenticated'::regrole, 0::oid::regrole);
  IF v_offender IS NOT NULL THEN
    RAISE EXCEPTION
      '013 verify (C-04 residue): function(s) % are executable by anon, '
      'authenticated or PUBLIC. Functions default to PUBLIC EXECUTE and 001 '
      'measured that ALTER DEFAULT PRIVILEGES does not take, so an empty proacl '
      'is the bug, not the clean state.', v_offender;
  END IF;

  -- A NULL proacl IS PUBLIC EXECUTE. Checked separately because aclexplode over
  -- an empty array finds nothing and the check above would pass vacuously.
  SELECT pg_catalog.string_agg(procedure.oid::regprocedure::text, ', ')
    INTO v_offender
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
   WHERE ((namespace.nspname = 'app'    AND procedure.proname = ANY (v_app_fns))
       OR (namespace.nspname = 'public' AND procedure.proname = ANY (v_pub_fns)))
     AND procedure.proacl IS NULL;
  IF v_offender IS NOT NULL THEN
    RAISE EXCEPTION
      '013 verify (C-04 residue): function(s) % still carry a NULL proacl, which '
      'IS the default PUBLIC EXECUTE grant. The revoke loop missed them.',
      v_offender;
  END IF;

  -- ── N-02 · the sweep, re-derived from pg_attribute ──────────────────────
  SELECT pg_catalog.string_agg(
           namespace.nspname || '.' || class.relname || '.' || attribute.attname, ', ')
    INTO v_offender
    FROM pg_catalog.pg_attribute AS attribute
    JOIN pg_catalog.pg_class AS class ON class.oid = attribute.attrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
   WHERE class.oid IN (
     SELECT expected.name::regclass FROM pg_catalog.unnest(v_tables) AS expected(name))
     AND attribute.attnum > 0 AND NOT attribute.attisdropped
     AND attribute.atttypid = 'jsonb'::regtype
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint AS con
        WHERE con.conrelid = class.oid AND con.contype = 'c'
          AND attribute.attnum = ANY (con.conkey));
  IF v_offender IS NOT NULL THEN
    RAISE EXCEPTION
      '013 verify (N-02/R-JSONB): jsonb column(s) % carry no CHECK. Doc 04 s735 '
      'reproduced this by execution: a constraint that reads a key before '
      'testing for it evaluates to NULL, and a CHECK that is NULL passes.',
      v_offender;
  END IF;

  -- The named exemption, asserted to still BE the exemption. If one of these
  -- acquires a key set worth asserting, this line is where somebody notices.
  SELECT pg_catalog.count(*)::integer INTO v_count
    FROM pg_catalog.unnest(v_open_json) AS expected(name)
   WHERE pg_catalog.to_regclass(
           pg_catalog.split_part(expected.name, '.', 1) || '.' ||
           pg_catalog.split_part(expected.name, '.', 2)) IS NOT NULL;
  IF v_count <> 5 THEN
    RAISE EXCEPTION
      '013 verify: the five open-shape jsonb columns named in the header no '
      'longer resolve; found %', v_count;
  END IF;

  -- ── N-09 · one actor vocabulary, and it is 012''s ───────────────────────
  SELECT pg_catalog.array_agg(enum.enumlabel::text ORDER BY enum.enumsortorder)
    INTO v_kinds
    FROM pg_catalog.pg_enum AS enum
   WHERE enum.enumtypid = 'app.actor_kind'::regtype;
  IF v_kinds <> ARRAY['HUMAN','AGENT','SYSTEM','CLIENT'] THEN
    RAISE EXCEPTION
      '013 verify (N-09): app.actor_kind is now %, and app.key_access_audit '
      'points its CHECK at app.is_valid_actor, which enumerates the four. Doc '
      '05 s5.4 documents three. One of them has to move and it is not this file.',
      pg_catalog.array_to_string(v_kinds, ', ');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint AS con
     WHERE con.conrelid = 'app.key_access_audit'::regclass
       AND con.conname = 'key_access_audit_actor_shape'
       AND pg_catalog.pg_get_constraintdef(con.oid) LIKE '%is_valid_actor%') THEN
    RAISE EXCEPTION
      '013 verify (N-09): app.key_access_audit.actor does not point at 012''s '
      'app.is_valid_actor. A second copy of the vocabulary is the finding.';
  END IF;

  -- ── The 003 enums are REUSED, by oid, not by spelling ───────────────────
  FOR v_offender IN
    SELECT * FROM (VALUES
      ('core.runs',            'status',         'core.run_status'),
      ('core.run_nodes',       'status',         'core.run_step_status'),
      ('core.run_nodes',       'kind',           'core.trace_node_kind'),
      ('core.run_events',      'type',           'core.run_event_type'),
      ('core.agents',          'status',         'core.agent_status'),
      ('core.ai_provider_keys','status',         'core.provider_key_status'),
      ('core.ai_provider_keys','billing_owner',  'core.billing_owner'),
      ('core.ai_budgets',      'scope',          'core.budget_scope'),
      ('core.model_tiers',     'routing',        'core.routing_strategy'),
      ('core.model_tiers',     'cache_strategy', 'core.cache_strategy'),
      ('core.model_tiers',     'provider',       'core.ai_provider')
    ) AS expected(rel, col, typ)
    WHERE (SELECT attribute.atttypid FROM pg_catalog.pg_attribute AS attribute
            WHERE attribute.attrelid = expected.rel::regclass
              AND attribute.attname = expected.col)
          IS DISTINCT FROM expected.typ::regtype
  LOOP
    RAISE EXCEPTION
      '013 verify: a status column is not the 003 enum it must be (%). No new '
      'type is created by this migration; every vocabulary here already exists.',
      v_offender;
  END LOOP;

  -- ── Every FK is composite and covered by an index (rule 4, M-16) ────────
  SELECT pg_catalog.string_agg(con.conname, ', ') INTO v_offender
    FROM pg_catalog.pg_constraint AS con
   WHERE con.contype = 'f'
     AND con.conrelid IN (
       SELECT expected.name::regclass FROM pg_catalog.unnest(v_tables) AS expected(name))
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_index AS idx
        WHERE idx.indrelid = con.conrelid
          AND (pg_catalog.string_to_array(idx.indkey::text, ' ')::smallint[]
               )[1:pg_catalog.cardinality(con.conkey)] = con.conkey);
  IF v_offender IS NOT NULL THEN
    RAISE EXCEPTION
      '013 verify (M-16): foreign key(s) % have no index whose leading columns '
      'are the key. An unindexed FK is a sequential scan under an exclusive lock '
      'on every parent delete.', v_offender;
  END IF;

  -- ── The run_id reconciliation, asserted on BOTH sides ───────────────────
  IF (SELECT attribute.atttypid FROM pg_catalog.pg_attribute AS attribute
       WHERE attribute.attrelid = 'core.runs'::regclass
         AND attribute.attname = 'id') <> 'uuid'::regtype THEN
    RAISE EXCEPTION '013 verify: core.runs.id is not uuid';
  END IF;
  SELECT pg_catalog.string_agg(expected.rel || '.' || expected.col, ', ')
    INTO v_offender
    FROM (VALUES
      ('core.events',           'run_id'),
      ('app.outbox',            'run_id'),
      ('core.action_requests',  'agent_run_id'),
      ('core.suggested_drafts', 'agent_run_id')
    ) AS expected(rel, col)
   WHERE (SELECT attribute.atttypid FROM pg_catalog.pg_attribute AS attribute
           WHERE attribute.attrelid = expected.rel::regclass
             AND attribute.attname = expected.col) <> 'text'::regtype;
  IF v_offender IS NOT NULL THEN
    RAISE EXCEPTION
      '013 verify: % changed away from text. 013 RECONCILES the run_id '
      'divergence; it does not retype these, because every event and every '
      'queued job already carrying a non-uuid run id would lose its trace.',
      v_offender;
  END IF;
  SELECT pg_catalog.count(*)::integer INTO v_count
    FROM pg_catalog.pg_constraint AS con
   WHERE con.contype = 'f'
     AND con.conname IN ('proposals_run_fk','provenance_run_fk',
                         'rule_change_sets_run_fk')
     AND con.confrelid = 'core.runs'::regclass;
  IF v_count <> 3 THEN
    RAISE EXCEPTION
      '013 verify: expected the 3 foreign keys 007 and 009 left for 013 by name, '
      'found %', v_count;
  END IF;

  -- ── Behavioural spot checks on the validators ───────────────────────────
  -- Doc 04 s735's case, reproduced. The legacy boolean jury looks careful and
  -- was ACCEPTED by the naive constraint.
  IF app.is_valid_jury_policy('{"enabled":true,"quorum":2,"of":3}'::jsonb)
     OR app.is_valid_jury_policy('{"mode":"SAMPLE","quorum":1,"of":3}'::jsonb)
     OR app.is_valid_jury_policy('{"mode":"GATE","quorum":4,"of":3}'::jsonb)
     OR NOT app.is_valid_jury_policy('{"mode":"GATE","quorum":2,"of":3}'::jsonb) THEN
    RAISE EXCEPTION '013 verify: app.is_valid_jury_policy does not match doc 04 s4.3';
  END IF;
  IF app.is_valid_run_trigger('{"ref":"TNA-0042"}'::jsonb)
     OR app.is_valid_run_trigger('{"type":""}'::jsonb)
     OR NOT app.is_valid_run_trigger('{"type":"TNA_SIGNED_OFF","ref":"TNA-0042"}'::jsonb) THEN
    RAISE EXCEPTION '013 verify: app.is_valid_run_trigger accepts a wrong shape';
  END IF;
  IF app.is_valid_plan('[{"n":1,"label":"x","status":"ALMOST"}]'::jsonb)
     OR app.is_valid_plan('[{"n":1,"label":"x"}]'::jsonb)
     OR NOT app.is_valid_plan('[{"n":1,"label":"x","status":"PENDING"}]'::jsonb) THEN
    RAISE EXCEPTION '013 verify: app.is_valid_plan accepts a wrong shape';
  END IF;
  IF app.is_valid_state_card_budgets('{"tokens":{"used":1},"cost":{"used":1,"limit":2}}'::jsonb)
     OR app.is_valid_checkpoint_cursor('{}'::jsonb)
     OR app.is_valid_halted_by('{"policyId":"APV-01","reason":"x"}'::jsonb) THEN
    RAISE EXCEPTION
      '013 verify: one of the five N-02 columns doc 05 names accepts a partially '
      'formed object';
  END IF;
  IF app.is_valid_run_event_detail('CHECKPOINT',
       '{"from":"FAST","to":"MID","confidence":0.6}'::jsonb) THEN
    RAISE EXCEPTION
      '013 verify: app.is_valid_run_event_detail accepts an ESCALATION body for '
      'a CHECKPOINT - the detail shape is per type or it is not a shape';
  END IF;

  -- M-10(1)'s mask, and M-25's pass.
  IF app.mask_key('sk-ant-api03-abcdefghijklmnop9a41')
     <> 'sk-ant-••••••••••••9a41' THEN
    RAISE EXCEPTION '013 verify: app.mask_key no longer produces doc 02 s6.1''s mask';
  END IF;
  IF app.is_masked_key('sk-ant-api03-abcdefghijklmnop9a41')
     OR NOT app.is_masked_key('sk-ant-••••••••••••9a41') THEN
    RAISE EXCEPTION '013 verify: app.is_masked_key would admit an unmasked key';
  END IF;
  IF app.redact_pii('write to nurul.hassan@example.com now')
     <> 'write to «email:1» now' THEN
    RAISE EXCEPTION '013 verify (M-25): app.redact_pii does not mask an email address';
  END IF;
  IF app.redact_pii(app.redact_pii('mail nurul@example.com and nurul@example.com'))
     <> app.redact_pii('mail nurul@example.com and nurul@example.com') THEN
    RAISE EXCEPTION
      '013 verify (M-25): app.redact_pii is not idempotent, so the worker''s pass '
      'and the database''s pass would double-number the same document';
  END IF;
  IF (app.pii_counts('a «email:1» b «email:1» c «phone:1»') ->> 'emails') <> '1'
     OR (app.pii_counts('a «email:1» b «email:1» c «phone:1»') ->> 'phones') <> '1' THEN
    RAISE EXCEPTION '013 verify (M-25): app.pii_counts miscounts co-referenced placeholders';
  END IF;

  RAISE NOTICE
    '013 verify: complete - 19 tables (all RLS enabled and forced, zero '
    'policies), 2 security_invoker views, 29 functions at search_path="", 3 '
    'reconciliation foreign keys onto core.runs, zero client privileges.';
END;
$verify$;

COMMIT;
