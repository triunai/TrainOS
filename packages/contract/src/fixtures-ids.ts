/**
 * Canonical fixture references.
 *
 * §0 preamble: "Examples use the demo fixtures (Aurora Manufacturing,
 * PRO-2026-0184, APV-2026-0771, ENG-0231, run #4821), so they double as seed
 * data." Every id below is copied from a JSON example in API_CONTRACT.md, so
 * the React fixture client and the Supabase seed reference the same records.
 *
 * Types only elsewhere in this package; these constants are the one exception,
 * because two teams must agree on the literal strings.
 */

/* ------------------------------------------------------------------ *
 * People — §2, §7, §9, §17
 * ------------------------------------------------------------------ */

/** §2 the SALES user the demo is signed in as. */
export const USER_AMIRAH = 'u_amirah';
/** §7 the SALES_MANAGER who decides APV-2026-0771. */
export const USER_KELVIN = 'u_kelvin';
/** §8 the OPS owner of ENG-0231. */
export const USER_SITI = 'u_siti';
/** §9, §17 the FINANCE user who files on eTRIS and verifies rules. */
export const USER_JASON = 'u_jason';
/** §17 the ADMIN who added the Anthropic provider key. */
export const USER_KHAIRUL = 'u_khairul';
/** §8 the trainer who approved day-1 attendance. */
export const TRAINER_FARAH = 't_farah';
/** §6 the client contact who completed TNA-0042. */
export const CLIENT_NURUL = 'c_nurul';

/* ------------------------------------------------------------------ *
 * Agents and runs — §3, §4, §5, §6, §10, §17
 * ------------------------------------------------------------------ */

/** §3 drafts and sends proposals. */
export const AGENT_PROPOSAL = 'agent_proposal';
/** §4 classifies and extracts from enquiries. */
export const AGENT_LEAD = 'agent_lead';
/** §6 analyses the TNA and ranks programmes. */
export const AGENT_TNA = 'agent_tna';
/** §4 drafts follow-ups. */
export const AGENT_FOLLOWUP = 'agent_followup';
/** §5, §10 cross-sell suggestions; paused in the demo for eval regression. */
export const AGENT_KNOWLEDGE = 'agent_knowledge';

/** §3, §6, §10, §17 the proposal run that halted on APV-01. */
export const RUN_PROPOSAL = 'run_4821';
/** §4 the enquiry classification run. */
export const RUN_CLASSIFY = 'run_4788';
/** §6 the TNA analysis run. */
export const RUN_TNA = 'run_4884';
/** §4 the follow-up draft run. */
export const RUN_FOLLOWUP = 'run_4899';
/** §17 the circular extraction run behind DOC-0219. */
export const RUN_RULE_EXTRACT = 'run_4912';

/** §17 the orchestrator that owns RUN_PROPOSAL. */
export const ORCHESTRATOR_PROPOSAL = 'proposal_orchestrator';

/* ------------------------------------------------------------------ *
 * Records — §2 onwards
 * ------------------------------------------------------------------ */

/** §2, §5 Aurora Manufacturing Sdn Bhd. */
export const ORG_AURORA = 'ORG-0114';
/** §5 Nurul Hassan, HR Manager, consented on both channels. */
export const CONTACT_NURUL = 'CON-0233';
/** §5 Ravi Subramaniam, Plant Director, no consent (PDPA flag). */
export const CONTACT_RAVI = 'CON-0241';

/** §4 the leadership-training email that starts the demo. */
export const ENQUIRY_AURORA = 'ENQ-2026-0912';
/** §4 the opportunity the enquiry converts into. */
export const OPPORTUNITY_AURORA = 'OPP-0512';
/** §4, §6 the completed needs analysis. */
export const TNA_AURORA = 'TNA-0042';
/** §4 the follow-up queued after the proposal went quiet. */
export const FOLLOW_UP_AURORA = 'FUP-0311';

/** §6 Leading Through Change — 2 days, RM 18,500 / 30 pax. */
export const PROGRAMME_LEADING_CHANGE = 'PRG-0031';
/** §5, §6 Conflict to Collaboration — the cross-sell and the runner-up. */
export const PROGRAMME_CONFLICT = 'PRG-0018';
/** §6 Data Literacy for Managers — listed for completeness at fit 0.22. */
export const PROGRAMME_DATA_LITERACY = 'PRG-0044';

/** §6 Farah Aziz, TTT certified, the only match in the November window. */
export const TRAINER_FARAH_REF = 'TRN-0007';
/** §6 Daniel Wong, the December alternative the jury dissenter preferred. */
export const TRAINER_DANIEL_REF = 'TRN-0012';
/** §6, §9 Farah Aziz's TTT certificate, valid to 30 Jun 2027. */
export const TTT_FARAH = 'TTT-2019-4471';

/** §3, §6, §7 the proposal that triggers APV-01. */
export const PROPOSAL_AURORA = 'PRO-2026-0184';
/** §6 the costing behind it: margin 0.41 against a 0.35 floor. */
export const QUOTATION_AURORA = 'QUO-2026-0184';
/** §3, §7 the approval Kelvin Tan decides. */
export const APPROVAL_AURORA = 'APV-2026-0771';

/** §5, §8, §9 the delivered engagement. */
export const ENGAGEMENT_AURORA = 'ENG-0231';
/** §5 the earlier engagement whose packet is blocked. */
export const ENGAGEMENT_BLOCKED = 'ENG-0198';
/** §17 engagements affected by the 2027 lead-time change. */
export const ENGAGEMENT_AFFECTED_1 = 'ENG-0244';
export const ENGAGEMENT_AFFECTED_2 = 'ENG-0251';
/** §8 day 1 of the delivery. */
export const SESSION_DAY_1 = 'SES-0461';
/** §8 a present participant and an absent one. */
export const PARTICIPANT_AHMAD = 'PAR-1182';
export const PARTICIPANT_AISYAH = 'PAR-1189';

/** §9 the invoice for ENG-0231, MyInvois validated. */
export const INVOICE_AURORA = 'INV-2026-0311';
/** §4, §9 the overdue invoice, 34 days, RM 12,400. */
export const INVOICE_OVERDUE = 'INV-2026-0288';

/** §5, §9 Aurora's HRD Corp employer code. */
export const HRDC_EMPLOYER_CODE = 'HRDC-2201-8834';
/** §9 the approved grant behind the claim. */
export const HRDC_GRANT = 'GRT-2026-77412';
/** §9 the eTRIS claim reference a human records. */
export const HRDC_CLAIM = 'CLM-2026-118834';

/* ------------------------------------------------------------------ *
 * Templates and policies — §2, §3, §4, §6
 * ------------------------------------------------------------------ */

/** §2, §6 the standard proposal template, version 7. */
export const TEMPLATE_PROPOSAL = 'tpl_proposal_std_v7';
/** §3 the proposal covering email. */
export const TEMPLATE_EMAIL_PROPOSAL = 'tpl_email_proposal_v3';
/** §4 the WhatsApp follow-up, UTILITY category. */
export const TEMPLATE_FOLLOWUP_WHATSAPP = 'tpl_followup_proposal_v2';
/** §4 the TNA questionnaire sent on conversion. */
export const TEMPLATE_TNA = 'tpl_tna_std_v3';

/** §2, §3, §7 proposal send above RM 15,000 or first proposal to an organisation. */
export const POLICY_PROPOSAL_SEND = 'APV-01';
/** §6 discount below the floor price. */
export const POLICY_DISCOUNT = 'APV-02';
/** §9 invoice creation. */
export const POLICY_INVOICE_CREATE = 'FIN-01';
/** §9 collections reminder send. */
export const POLICY_REMINDER_SEND = 'FIN-03';

/* ------------------------------------------------------------------ *
 * Compliance and knowledge — §17
 * ------------------------------------------------------------------ */

/** §17 in-house application lead time, 14 days, effective 15 Jun 2026. */
export const RULE_LEAD_TIME_INHOUSE = 'HRD-014';
/** §17 the rule HRD-014 superseded. */
export const RULE_SUPERSEDED = 'HRD-006';
/** §17 the 3-day public lead time superseded from 1 Jan 2027. */
export const RULE_LEAD_TIME_PUBLIC = 'HRD-015';
/** §17 its 14-day replacement. */
export const RULE_LEAD_TIME_PUBLIC_2027 = 'HRD-022';
/** §17 required-documents rule. */
export const RULE_DOCS_COMPLETE = 'HRD-011';
/** §17 ACM meal ceiling rule. */
export const RULE_MEAL_CEILING = 'HRD-020';

/** §17 the check keys the engagement evaluates. */
export const CHECK_LEAD_TIME = 'CHK_LEAD_TIME';
export const CHECK_MEAL_CEILING = 'CHK_MEAL_CEILING';
export const CHECK_DOCS_COMPLETE = 'CHK_DOCS_COMPLETE';

/** §17 Circular 04/2026 — the source of HRD-014. */
export const DOCUMENT_CIRCULAR_04 = 'DOC-0188';
/** §17 Circular 09/2026 — the ingested change set on M12-S08. */
export const DOCUMENT_CIRCULAR_09 = 'DOC-0219';
/** §17 the knowledge source for Circular 09/2026. */
export const SOURCE_CIRCULAR_09 = 'src_0219';

/** §18 rule-set versions cited by a version-drift warning. */
export const RULE_SET_2026_06_15 = 'rs_2026_06_15';
export const RULE_SET_2027_01_01 = 'rs_2027_01_01';

/** §17 the Anthropic provider key record. */
export const PROVIDER_ANTHROPIC = 'prv_anthropic';

/** §8, §11 signature refs recorded on attendance and on portal acceptance. */
export const SIGNATURE_ATTENDANCE = 'sig_9f21';
export const SIGNATURE_ACCEPTANCE = 'sig_c19a';

/** §9 the accounting-package customer ORG-0114 was mapped to. */
export const ACCOUNTING_CUSTOMER = 'ACC-1042';
/** §9 the accounting document id for INV-2026-0311. */
export const ACCOUNTING_DOCUMENT = 'ACC-INV-88213';
/** §9 the MyInvois unique identifier mirrored back onto the invoice. */
export const INVOICE_UIN = 'MY-2026-XXXXXXXX-0311';

/** Every fixture id, so a seed script can assert it covered them all. */
export const FIXTURE_IDS = {
  USER_AMIRAH,
  USER_KELVIN,
  USER_SITI,
  USER_JASON,
  USER_KHAIRUL,
  TRAINER_FARAH,
  CLIENT_NURUL,
  AGENT_PROPOSAL,
  AGENT_LEAD,
  AGENT_TNA,
  AGENT_FOLLOWUP,
  AGENT_KNOWLEDGE,
  RUN_PROPOSAL,
  RUN_CLASSIFY,
  RUN_TNA,
  RUN_FOLLOWUP,
  RUN_RULE_EXTRACT,
  ORCHESTRATOR_PROPOSAL,
  ORG_AURORA,
  CONTACT_NURUL,
  CONTACT_RAVI,
  ENQUIRY_AURORA,
  OPPORTUNITY_AURORA,
  TNA_AURORA,
  FOLLOW_UP_AURORA,
  PROGRAMME_LEADING_CHANGE,
  PROGRAMME_CONFLICT,
  PROGRAMME_DATA_LITERACY,
  TRAINER_FARAH_REF,
  TRAINER_DANIEL_REF,
  TTT_FARAH,
  PROPOSAL_AURORA,
  QUOTATION_AURORA,
  APPROVAL_AURORA,
  ENGAGEMENT_AURORA,
  ENGAGEMENT_BLOCKED,
  ENGAGEMENT_AFFECTED_1,
  ENGAGEMENT_AFFECTED_2,
  SESSION_DAY_1,
  PARTICIPANT_AHMAD,
  PARTICIPANT_AISYAH,
  INVOICE_AURORA,
  INVOICE_OVERDUE,
  HRDC_EMPLOYER_CODE,
  HRDC_GRANT,
  HRDC_CLAIM,
  TEMPLATE_PROPOSAL,
  TEMPLATE_EMAIL_PROPOSAL,
  TEMPLATE_FOLLOWUP_WHATSAPP,
  TEMPLATE_TNA,
  POLICY_PROPOSAL_SEND,
  POLICY_DISCOUNT,
  POLICY_INVOICE_CREATE,
  POLICY_REMINDER_SEND,
  RULE_LEAD_TIME_INHOUSE,
  RULE_SUPERSEDED,
  RULE_LEAD_TIME_PUBLIC,
  RULE_LEAD_TIME_PUBLIC_2027,
  RULE_DOCS_COMPLETE,
  RULE_MEAL_CEILING,
  CHECK_LEAD_TIME,
  CHECK_MEAL_CEILING,
  CHECK_DOCS_COMPLETE,
  DOCUMENT_CIRCULAR_04,
  DOCUMENT_CIRCULAR_09,
  SOURCE_CIRCULAR_09,
  RULE_SET_2026_06_15,
  RULE_SET_2027_01_01,
  PROVIDER_ANTHROPIC,
  SIGNATURE_ATTENDANCE,
  SIGNATURE_ACCEPTANCE,
  ACCOUNTING_CUSTOMER,
  ACCOUNTING_DOCUMENT,
  INVOICE_UIN,
} as const;

/** The name of any canonical fixture. */
export type FixtureIdKey = keyof typeof FIXTURE_IDS;
