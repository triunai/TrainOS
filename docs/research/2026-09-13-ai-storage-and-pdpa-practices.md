# AI storage and PDPA practices

Research for proposal §3.4/§3.5/§4.1/§8 and the run/audit design in migration
011 and `packages/contract/src/domain/ai-ops.ts` / `agents.ts`. All claims
below are cited; access date 2026-09-13 unless noted.

## 1. Malaysian PDPA as amended (Personal Data Protection (Amendment) Act 2024)

The amendment commenced in three tranches (1 Jan, 1 Apr, 1 Jun 2025) with
Commissioner guidelines following through 2025.

- **DPO appointment**: mandatory once a controller holds data on more than
  20,000 individuals, or more than 10,000 individuals' sensitive personal
  data (including biometric), or conducts regular systematic large-scale
  monitoring; appointment must be registered with the Commissioner within 21
  days. Effective 1 June 2025. [DLA Piper Privacy Matters](https://privacymatters.dlapiper.com/2025/03/malaysia-guidelines-issued-on-data-breach-notification-and-data-protection-officer-appointment/), [Lexology](https://www.lexology.com/library/detail.aspx?g=b96a764d-55e7-4b0d-8fbd-8b5637449226).
- **Breach notification**: notify the Commissioner "as soon as practicable"
  and in any event within **72 hours** of becoming aware of a breach that
  causes or is likely to cause significant harm; affected data subjects must
  be notified within **7 days** of the Commissioner notification. Same
  source as above.
- **Cross-border transfer**: amended s.129 (in force 1 April 2025) removes
  the old Minister-approved whitelist and replaces it with a risk-based
  regime — the **controller** must itself assess whether the receiving
  jurisdiction has laws substantially similar to, or affording adequate
  protection comparable to, the PDPA, or rely on a listed exception
  (consent, contract necessity, etc.). Commissioner guidelines issued 29
  April 2025: [GP_CBPDT_EN-1.pdf, pdp.gov.my](https://www.pdp.gov.my/ppdpv1/wp-content/uploads/2025/08/GP_CBPDT_EN-1.pdf), [Mayer Brown](https://www.mayerbrown.com/en/insights/publications/2025/07/from-legislative-reform-to-practical-guidance-key-amendments-to-malaysias-pdpa-and-the-launch-of-cross-border-transfer-guidelines).
- **Data subject rights**: existing access/correction/withdraw-consent
  rights plus a new **right to data portability** (s.43A, from June 2025),
  limited to data the subject provided or that was processed by automated
  means, subject to technical feasibility. [Rahmat Lim & Partners](https://www.rahmatlim.com/perspectives/articles/28434/mykh-personal-data-protection-amendment-bill-2024-passed-by-parliament).
- **Penalties**: general breach of the seven data protection principles now
  up to **RM1,000,000 fine and/or 3 years' imprisonment** (up from RM300,000
  / 2 years); failure to notify the Commissioner of a breach up to RM250,000
  and/or 2 years. Critically, the amendment makes **data processors directly
  liable** for the Security Principle for the first time, with the same
  RM1,000,000/3-year exposure. [Sidley](https://www.sidley.com/en/insights/newsupdates/2024/08/important-changes-to-malaysias-data-protection-laws), [One Asia Lawyers](https://oneasia.legal/en/6060).

**Applied to TrainOS**: the training-provider client is the controller for
enquiry/TNA/participant data; the vendor operating TrainOS's agents is a
processor and now carries direct statutory exposure on the Security
Principle regardless of whether the client crosses the DPO threshold. Both
parties should appoint a DPO (proposal §3.4 already assumes this).

## 2. What each provider's current terms allow

| Provider | Training on inputs | Retention default | ZDR available | DPA / region |
|---|---|---|---|---|
| Anthropic API | Never by default | 7 days (was 30, changed 2025-09-14) | Yes, Messages/Token Counting only, not Batch/Files/Managed Agents; enterprise-qualified | DPA on Team/Enterprise/API, 2021 SCCs + EU-US DPF |
| OpenAI API | Never by default (with or without ZDR) | Up to 30 days, abuse monitoring | Yes, eligible customers, removes the 30-day window | DPA available |
| Google Gemini (paid API/Vertex) | Not without explicit permission (Cloud DPA §17 Training Restriction) | Per Cloud DPA | Yes, Vertex AI ZDR | Cloud DPA, region selection at project creation |
| DeepSeek direct API | — | Stored on PRC servers per DeepSeek's own privacy policy | No | Not usable for PII — matches proposal §3.4/§8 prohibition |
| DeepSeek via OpenRouter | Provider-dependent | In-region routing (US/EU) on Business/Enterprise plans; V4 Pro servable from US hosts (Baseten, Fireworks, Azure) | Depends on host | Must pin to a non-China host explicitly — default routing is not guaranteed non-China |
| Cerebras | No | Zero retention baseline for inference (prompts, requests, responses, logs) | Yes, standard | US data centers, DPA available |
| Groq | No | Zero by default; optional 30-day troubleshooting/abuse logs unless self-serve ZDR toggled | Yes, self-serve for all customers since the 2026 update | DPA commits to deletion within 180 days post-termination |

Sources: [Anthropic retention](https://anarlog.so/blog/anthropic-data-retention-policy/), [Anthropic DPA](https://sonomos.ai/blog/claude-dpa-explained-2026/), [OpenAI ZDR](https://openai.com/index/offering-zero-data-retention-for-frontier-models/), [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data), [Google Gemini terms](https://redact.dev/blog/gemini-api-terms-2025), [Google Vertex ZDR](https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/zero-data-retention), [DeepSeek privacy policy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html), [OpenRouter in-region routing](https://openrouter.ai/blog/announcements/us-in-region-routing/), [Cerebras retention](https://support.cerebras.net/articles/1811589793-does-cerebras-retain-my-data), [Groq data controls](https://console.groq.com/docs/your-data), [Groq DPA](https://console.groq.com/docs/legal/customer-data-processing-addendum).

## 3. Per-tier data-handling matrix

| Tier | Allowed data classes | Redaction required | Provider/region | Prompt-response log retention |
|---|---|---|---|---|
| FAST / CHEAP (DeepSeek Flash, Qwen) | Pseudonymized text only, no raw NRIC/DOB | Yes, mandatory pre-call | OpenRouter, pinned to non-China host | Per host DPA (7–30d) |
| FAST-UI (gpt-oss on Cerebras/Groq) | Pseudonymized UI-classification text | Yes | US (Cerebras/Groq) | Zero at provider |
| MID (DeepSeek V4 Pro) | Pseudonymized TNA/participant extraction text | Yes | Non-China host only | Per host DPA |
| STRONG ×3 (Sonnet 5, Gemini 3.1 Pro, GPT-5.6 Terra) | Pseudonymized long-form for named-individual content; commercial-only content (pricing/scope) may pass unredacted | Yes for participant-identifying content | Anthropic/Google/OpenAI enterprise API + DPA | Anthropic 7d (30d if opted in), OpenAI 30d (0 with ZDR), Google per Cloud DPA |
| DEEP THINK / SPECIAL (Opus 5) | Same rule, reserved for rule-conflict/high-value cases | Yes | Same as STRONG | Same |

**What the source documents actually contain**: enquiry email — contact
name/email/phone/company, low sensitivity unless it names employees; TNA
document — participant names, job titles, sometimes NRIC and performance
data, high sensitivity; participant list — full name, NRIC/passport, DOB,
contact info, high sensitivity; proposal — mostly commercial content
(pricing, course design), low sensitivity except a named signatory.

**Recommended approach**: pseudonymization (a reversible, tenant-scoped
token map held inside the trust boundary) rather than one-way redaction or
whole-document tokenization — TNA/participant extraction agents must reason
over named individuals in context, so removing names outright breaks the
agent's job; a token map lets the app re-hydrate names locally after the
model call returns. Pseudonymized data is still "personal data" under the
PDPA, so the transfer-mechanism analysis in §1 still applies per provider
region.

## 4. Storing prompts, responses, and traces

Langfuse (self-hosted) stores trace data indefinitely by default and does
not train on it; masking is applied server-side in the ingestion pipeline
before ClickHouse writes, or client-side via a masking callback (including
OTel spans since June 2026). [Langfuse security FAQ](https://langfuse.com/security/security-faq), [Langfuse masking](https://langfuse.com/self-hosting/security/data-masking).

**Recommended retention table**:

| Data | Retention | Rationale |
|---|---|---|
| Raw model I/O (Langfuse traces) | 90 days, auto-purge | PDPA storage limitation; not the audit record of truth |
| `AutomationRun`/`RunStep` (contract, migration 011 audit ledger) | Per 011's own audit/evidentiary window | Keeps hashes/redacted summaries only, not raw PII payloads |
| Token↔plaintext pseudonymization map | Tenant-scoped, deleted on data-subject erasure request | Reversal key, not an audit artifact |
| Provider keys (Vault) | Until rotated/revoked | See §5 |

Postgres encryption at rest is Supabase's default; per-tenant isolation
follows the existing RLS design (`docs/architecture/02-tenancy-auth-rls.md`).
Deletion on request needs a workflow that walks Postgres rows, the
pseudonymization map, and Langfuse trace IDs together — Langfuse's default
indefinite retention must be overridden per-project.

## 5. Per-tenant BYOK key isolation

`packages/agent-runtime/src/keys/keystore.ts` already treats keys as
opaque references (`KeyRef`) resolved by a `KeyStore`, never logged or
persisted by the runtime itself; production resolves against the §17
`/v1/ai/providers` record (`packages/contract/src/domain/ai-ops.ts`), which
already carries `maskedKey`, `scopeTiers`, `cap`, `rotationDate`,
`billingOwner`, and `region` (returned pre-save so the customer makes the
residency call knowingly) with reveal as a separate audited call. The
underlying storage should be **Supabase Vault** (pgsodium AEAD, per-project
root key) — a good match to the contract's write-only/masked-read pattern.
[Supabase Vault](https://supabase.com/docs/guides/database/vault).

## 6. Malaysia hosting

AWS's Asia Pacific (Malaysia) region, `ap-southeast-5`, is generally
available, but Supabase's documented managed regions do not currently
include it (Singapore `ap-southeast-1` is the nearest managed option).
"Malaysia hosting" therefore means self-hosting the open-source Supabase
stack on AWS `ap-southeast-5` directly, which shifts patching/backup/HA
onto the vendor, matching proposal §3.4's "unchanged deployment on
self-hosted Supabase in AWS Malaysia." [Supabase regions discussion](https://github.com/orgs/supabase/discussions/4815), [AWS Malaysia region announcement](https://aws.amazon.com/blogs/aws/now-open-aws-asia-pacific-malaysia-region/).

## Schema/runtime changes

1. Token-vault reference on `RunStep`/`TraceNode`: args/result should carry
   pseudonymized tokens only, with a separate `redaction_map_ref` column
   pointing at the tenant-scoped token↔plaintext table (no raw PII in the
   trace or run record itself).
2. `pii_class` column on `RunStep` so a DPO can query which data classes a
   given tool call touched without opening the raw payload.
3. `retention_until`/`purge_at` on the trace store, decoupled from the
   (likely longer) 011 audit ledger's own retention, to drive an automated
   purge job.
4. Extend `ProviderKey` (ai-ops.ts) with `zeroRetentionEnabled` and
   `dpaOnFile` booleans — `region` alone doesn't say whether ZDR is actually
   turned on with that provider.
5. `hostConstraint`/provider allow-list on `RoutingEntry`/`ModelTier` to
   pin DeepSeek-via-OpenRouter calls to non-China hosts explicitly, since
   OpenRouter's default routing is not guaranteed to avoid PRC-hosted
   DeepSeek infrastructure.
6. A data-subject erasure workflow (new `DataSubjectErasureRequested/
   Completed` audit event, analogous to the existing GOV-07 registry
   pattern) that walks Postgres, the token map, and Langfuse trace IDs
   together.

## Open questions for a DPO

1. Does the vendor need its own DPO as processor regardless of the client's
   20,000/10,000-individual threshold, given the amendment's direct
   processor liability on the Security Principle?
2. Is tenant-scoped pseudonymization an acceptable substitute for
   anonymization before a STRONG-tier call, and which cross-border transfer
   mechanism (adequacy-style self-assessment vs. consent) applies per
   provider region?
3. What retention period should the trace store use, balancing PDPA
   storage-limitation against the 011 audit trail's evidentiary needs?
4. Does OpenRouter's US in-region routing for DeepSeek satisfy the
   "no PII to DeepSeek's own API" commitment, or is a contractual/technical
   guarantee (not just a routing config) required?
5. If a client insists on Malaysia residency, should self-hosted Supabase
   on `ap-southeast-5` be priced and scoped as a distinct SKU given the
   added ops burden?
