/**
 * M22-S04 · Demo script, as a live index.
 *
 * "Aurora Manufacturing, September to November 2026. One enquiry followed end
 * to end. Every figure on every screen belongs to this story." Nineteen steps,
 * about twelve minutes.
 *
 * In the pack this is a printed script whose links point at other artboards.
 * Here it points at the running application, so the demo path is walkable
 * rather than readable — which is the only version of a demo script that stays
 * true as screens land.
 *
 * It is a DEVELOPMENT route (`/dev/demo`) and never reaches a production
 * bundle. That is deliberate: it is a rehearsal aid and a coverage map for the
 * people building the screens, not a product surface.
 */

import { Link } from "react-router-dom";
import { APPROVAL_AURORA } from "@trainos/contract";
import { Breadcrumb, StatusChip } from "@/shared/components/kit";
import { navPath } from "@/shared/config/nav";
import { APPROVALS_PATH, approvalPath } from "@/features/approvals";

interface DemoStep {
  /** 01 … 19, as the script numbers them. */
  n: string;
  /** The design pack's screen id. The index is a coverage map as well as a script. */
  screenId: string;
  title: string;
  /** What the presenter says. Verbatim from the artboard. */
  say: string;
  /** What the presenter points at. */
  pointAt: string;
  to: string;
}

/**
 * The nineteen steps, verbatim from `M22 Demo script.dc.html`.
 *
 * Every `to` is derived through `navPath` or through the owning feature's
 * exported path helper — never typed as a literal — so a nav-tree change moves
 * these links with it (CLAUDE.md R7).
 */
const STEPS: DemoStep[] = [
  {
    n: "01",
    screenId: "M01-S01",
    title: "Executive dashboard",
    say: "This is November. RM 214k in play, six trainings, three claims pending, and the agents saved 41 admin hours.",
    pointAt: "The admin-hours-saved metric — it is the reason the system exists.",
    to: navPath("Home", "Dashboard"),
  },
  {
    n: "02",
    screenId: "M03-S01",
    title: "Enquiry inbox",
    say: "Everything inbound lands in one queue — email, WhatsApp, web form, phone.",
    pointAt: "The WhatsApp row at 41% confidence flagged for human classification.",
    to: navPath("Sales", "Enquiries"),
  },
  {
    n: "03",
    screenId: "M03-S02",
    title: "Enquiry detail",
    say: "Nurul emails at 08:52. A minute later the agent has the topic, the audience, the timing and the account.",
    pointAt: "The four numbered source citations under the extraction.",
    to: navPath("Sales", "Enquiries"),
  },
  {
    n: "04",
    screenId: "M05-S02",
    title: "TNA detail",
    say: "The questionnaire comes back and the gaps are evidence-linked, not guessed.",
    pointAt: "Fit scores: 91%, 78%, 22% — the ranking is honest about the bad match.",
    to: navPath("Sales", "TNA"),
  },
  {
    n: "05",
    screenId: "M06-S02",
    title: "Programme detail",
    say: "This is the programme it lands on, and the trainer pool behind it.",
    pointAt: "Daniel Wong is booked 10–14 Nov — that single fact drives the risk rating later.",
    to: navPath("Training", "Programmes"),
  },
  {
    n: "06",
    screenId: "M07-S02",
    title: "Proposal builder",
    say: "The agent drafts each section from the template; every section says who wrote it.",
    pointAt: "Section 5 at 41% confidence, flagged before anyone sends it.",
    to: navPath("Sales", "Proposals"),
  },
  {
    n: "07",
    screenId: "M07-S03",
    title: "Costing worksheet",
    say: "Behind the number: trainer, materials, travel, commission, 41% margin.",
    pointAt: "Type a discount below the floor and the field goes red with the reason.",
    to: navPath("Finance", "Quotations"),
  },
  {
    n: "08",
    screenId: "M02-S01",
    title: "Approval inbox",
    say: "Every human decision in one queue, ordered by urgency, not by module.",
    pointAt: "Bulk approve is unavailable while a money action is selected.",
    to: APPROVALS_PATH,
  },
  {
    n: "09",
    screenId: "M02-S02",
    title: "Approval detail",
    say: "Kelvin gets why he is here, the recommendation, the evidence, the risk, and exactly what changes if he clicks.",
    pointAt: '"If you approve, this happens" — five changes, listed before the click.',
    to: approvalPath(APPROVAL_AURORA),
  },
  {
    n: "10",
    screenId: "M07-S07",
    title: "Client proposal page",
    say: "Nurul reads it, asks two questions, accepts on 15 September.",
    pointAt: "The reply that explains who files the HRDC claim — the client never sees margin.",
    to: "/p/tok_aurora_pro_0184",
  },
  {
    n: "11",
    screenId: "M04-S02",
    title: "Organisation 360",
    say: "One page for the whole relationship: pipeline, delivery, compliance, money.",
    pointAt: "The engagements table micro-steppers — one blocked, one lost.",
    to: navPath("Sales", "Organisations"),
  },
  {
    n: "12",
    screenId: "M09-S02",
    title: "Engagement detail",
    say: "Won becomes delivery: trainer, sessions, 30 participants, logistics.",
    pointAt: "The lifecycle stepper: attendance locked, HRDC claim blocked.",
    to: navPath("Training", "Engagements"),
  },
  {
    n: "13",
    screenId: "M10-S06",
    title: "Attendance capture",
    say: "Attendance is captured per session, approved, and then frozen.",
    pointAt: "Capture buttons are disabled — HRD Corp requires immutability after approval.",
    to: navPath("Training", "Participants"),
  },
  {
    n: "14",
    screenId: "M12-S02",
    title: "HRDC claim packet",
    say: "The packet assembles itself to 62%, and tells Jason exactly what is missing and how long he has.",
    pointAt: "No submit button. A human files on eTRIS and records the reference here.",
    to: navPath("Compliance", "HRD Corp"),
  },
  {
    n: "15",
    screenId: "M13-S02",
    title: "Invoice detail",
    say: "The invoice is pushed to the client's accounting package, which handles MyInvois.",
    pointAt: "The collapsed failed sync attempt and how it was fixed.",
    to: navPath("Finance", "Invoices"),
  },
  {
    n: "16",
    screenId: "M13-S05",
    title: "Collections queue",
    say: "The overdue invoice from July is being chased on a fixed ladder.",
    pointAt: "Where autonomy stops: at 60 days a human picks up the phone.",
    to: navPath("Finance", "Collections"),
  },
  {
    n: "17",
    screenId: "M18-S01",
    title: "Agent registry",
    say: "Eight agents, each with autonomy per action type and a kill switch.",
    pointAt: "The paused agent, with the eval score that paused it.",
    to: navPath("Automation", "Agents"),
  },
  {
    n: "18",
    screenId: "M18-S04",
    title: "Run trace #4821",
    say: "Here is the run that wrote the Aurora proposal: six tool calls, one retry, RM 0.38.",
    pointAt: "Step 6 halted by policy — the agent never sent anything.",
    to: navPath("Automation", "Runs"),
  },
  {
    n: "19",
    screenId: "M01-S01",
    title: "Back to the dashboard",
    say: "That whole path took eight minutes of human attention instead of a morning.",
    pointAt: "41 hours saved, and every one of those decisions is in the audit log.",
    to: navPath("Home", "Dashboard"),
  },
];

/** The four objections the script prepares for, and where the answer lives. */
const IF_ASKED: { question: string; answer: string; where: string }[] = [
  {
    question: "What if the agent approves something wrong?",
    answer:
      "It cannot. Money, sending and compliance actions are capped at Act-with-approval, and every agent has a per-action kill switch.",
    where: "M18-S01 registry + M02-S02 evidence panel",
  },
  {
    question: "Does this file our HRD Corp claims?",
    answer:
      "No, and nothing claims to. TrainOS assembles the packet, tracks the deadline and stores the reference a human enters after filing on eTRIS.",
    where: "M12-S02 packet builder",
  },
  {
    question: "Is this e-invoicing?",
    answer:
      "No. The invoice is pushed to your accounting package, which handles LHDN MyInvois validation. TrainOS shows sync status.",
    where: "M13-S02 sync log",
  },
  {
    question: "Where does our data go?",
    answer:
      "PDPA consent is tracked per contact and channel, participant PII is redacted from prompts, traces keep metadata after 30 days.",
    where: "M20 settings · reference only in this pack",
  },
];

const NOTES: { label: string; value: string }[] = [
  { label: "Open with", value: "the dashboard, not the login" },
  { label: "Close with", value: "step 19 — hours saved, fully audited" },
  { label: "Do not demo", value: "settings, templates, imports; say they exist" },
  { label: "Timing", value: "90 seconds on step 09, 60 on step 14, 30 elsewhere" },
];

export function DemoIndex() {
  return (
    <div className="flex flex-col gap-6 pb-10">
      <div className="px-5 pt-4">
        <Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Demo script" }]} />
      </div>

      <header className="flex flex-col gap-2 px-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em]">Demo script</h1>
          <StatusChip tone="neutral">M22-S04</StatusChip>
          <StatusChip tone="info">19 steps · about 12 minutes</StatusChip>
        </div>
        <p className="max-w-[68ch] text-[13px] leading-[1.6] text-ink-secondary">
          Aurora Manufacturing, September to November 2026. One enquiry followed end to end. Every
          figure on every screen belongs to this story. Each step links to the running screen, so a
          step that lands on a placeholder is a screen still to be built.
        </p>
      </header>

      <ol aria-label="Demo steps" className="flex flex-col px-5">
        {STEPS.map((step) => (
          <li key={step.n} className="border-t border-divider py-3.5 first:border-t-0">
            <div className="flex gap-4">
              <span className="w-7 shrink-0 pt-0.5 font-mono text-[13px] text-ink-muted">
                {step.n}
              </span>
              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <Link
                    to={step.to}
                    className="text-[15px] font-semibold text-primary-hover hover:underline"
                  >
                    {step.title}
                  </Link>
                  <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">
                    {step.screenId}
                  </span>
                  <span className="font-mono text-[11px] text-ink-disabled">{step.to}</span>
                </div>
                <p className="text-[13px] leading-[1.6] text-ink-secondary">“{step.say}”</p>
                <p className="text-[12px] leading-[1.55] text-ink-muted">
                  <span className="font-semibold text-ink-secondary">Point at:</span> {step.pointAt}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ol>

      <section className="flex flex-col gap-3 px-5">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
          If asked
        </h2>
        <ul className="flex flex-col gap-3">
          {IF_ASKED.map((item) => (
            <li key={item.question} className="flex flex-col gap-1">
              <p className="text-[13px] font-semibold text-ink">{item.question}</p>
              <p className="max-w-[68ch] text-[13px] leading-[1.6] text-ink-secondary">
                {item.answer}
              </p>
              <p className="font-mono text-[11px] text-ink-muted">{item.where}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-wrap gap-x-8 gap-y-3 border-t border-divider px-5 pt-4">
        {NOTES.map((note) => (
          <div key={note.label} className="flex flex-col gap-0.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
              {note.label}
            </span>
            <span className="text-[13px] text-ink-secondary">{note.value}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
