import type { LearningOutcome } from "../db/schema";
import { outcome } from "./bloom";

/**
 * Seed course catalog and knowledge chunks for the pgvector knowledge base.
 *
 * ILLUSTRATIVE REFERENCE DATA — READ BEFORE PRODUCTION:
 *   - Every `matchedNossCode` below (the `ILLUS-NOSS-*` values) and every
 *     knowledge-chunk `sourceRef` is an ILLUSTRATIVE placeholder. They are NOT
 *     real Department of Skills Development (JPK) NOSS codes and must not be
 *     presented to HRD Corp or a client as such. Replace them with the codes
 *     from the current JPK NOSS registry when the catalog is curated.
 *   - The `hrdFocusArea` names are ILLUSTRATIVE groupings chosen for this
 *     demo catalog, not HRD Corp's published focus-area taxonomy.
 *   - Course content (titles, outcomes, outlines) is realistic sample
 *     material for Malaysian corporate training, written for this system.
 */
export type Seniority = "EXECUTIVE" | "SUPERVISORY" | "OPERATIONAL";

export interface CourseSeed {
  courseCode: string;
  title: string;
  hrdFocusArea: string;
  /** ILLUSTRATIVE placeholder, not a real JPK NOSS code. */
  matchedNossCode: string;
  targetSeniority: Seniority;
  level: number;
  nextCourseCode: string | null;
  durationDays: number;
  learningOutcomes: LearningOutcome[];
  masterOutlineMarkdown: string;
  /** Trainer specialty tags this course needs (matched against trainers.specialties). */
  specialties: string[];
}

const md = (title: string, modules: Array<[string, string[]]>): string =>
  [`# ${title}`, ...modules.flatMap(([name, topics], i) => [``, `## Module ${i + 1}: ${name}`, ...topics.map((t) => `- ${t}`)])].join("\n");

export const COURSE_SEEDS: readonly CourseSeed[] = [
  {
    courseCode: "SUP-101",
    title: "Effective Supervisory Skills",
    hrdFocusArea: "Leadership & People Management",
    matchedNossCode: "ILLUS-NOSS-MGT-L3",
    targetSeniority: "SUPERVISORY",
    level: 1,
    nextCourseCode: "LEAD-201",
    durationDays: 2,
    specialties: ["leadership", "supervisory", "people management", "management"],
    learningOutcomes: [
      outcome("Explain the role, authority and accountability of a first-line supervisor in a Malaysian workplace"),
      outcome("Apply the SMART framework to set team targets and delegate tasks with clear ownership"),
      outcome("Demonstrate structured coaching and feedback conversations using the GROW model"),
      outcome("Analyse common team performance problems and select an appropriate corrective action"),
      outcome("Plan a 30-day supervisory action plan for their own team"),
    ],
    masterOutlineMarkdown: md("Effective Supervisory Skills", [
      ["The Supervisor's Role", ["From peer to supervisor: authority, credibility and boundaries", "Supervisor responsibilities under company policy and the Employment Act 1955 basics", "Situational leadership styles"]],
      ["Planning, Delegation and Target Setting", ["SMART targets and daily/weekly planning", "Delegation matrix and task ownership", "Running an effective 10-minute team huddle"]],
      ["Coaching and Feedback", ["GROW coaching model", "Giving constructive and positive feedback", "Role-play: difficult feedback conversations"]],
      ["Managing Team Performance", ["Diagnosing performance gaps: skill vs will", "Documenting performance issues fairly", "Recognition that motivates a multigenerational team"]],
      ["Supervisory Action Plan", ["Personal leadership commitments", "30-day action plan and success measures", "Presentation and peer review"]],
    ]),
  },
  {
    courseCode: "LEAD-201",
    title: "Strategic Leadership & Conflict Management",
    hrdFocusArea: "Leadership & People Management",
    matchedNossCode: "ILLUS-NOSS-MGT-L5",
    targetSeniority: "EXECUTIVE",
    level: 2,
    nextCourseCode: null,
    durationDays: 2,
    specialties: ["leadership", "strategic leadership", "conflict management", "change management"],
    learningOutcomes: [
      outcome("Formulate a departmental strategy that links team goals to organisational priorities"),
      outcome("Analyse the sources and stages of workplace conflict using the Thomas-Kilmann model"),
      outcome("Apply interest-based negotiation to resolve conflicts between teams and stakeholders"),
      outcome("Evaluate leadership decisions for their impact on engagement, performance and risk"),
      outcome("Lead a change initiative using a structured stakeholder communication plan"),
    ],
    masterOutlineMarkdown: md("Strategic Leadership & Conflict Management", [
      ["Strategic Leadership", ["Leader as strategist: vision, priorities and trade-offs", "Cascading strategy into team objectives and KPIs", "Strategic thinking tools: PESTLE, SWOT, scenario planning"]],
      ["Leading Through Change", ["Why change fails: resistance and the change curve", "Stakeholder mapping and communication planning", "Leading hybrid and cross-functional teams"]],
      ["Understanding Conflict", ["Sources and stages of workplace conflict", "Thomas-Kilmann conflict modes self-assessment", "Cultural dimensions of conflict in Malaysian workplaces"]],
      ["Resolving Conflict", ["Interest-based negotiation and mediation steps", "Handling emotionally charged conversations", "Case clinic: inter-departmental disputes"]],
      ["Leadership Decisions and Accountability", ["Decision-making frameworks under uncertainty", "Evaluating decisions for engagement, performance and risk", "Personal leadership development plan"]],
    ]),
  },
  {
    courseCode: "COMM-101",
    title: "Business Communication & Report Writing",
    hrdFocusArea: "Communication",
    matchedNossCode: "ILLUS-NOSS-COM-L3",
    targetSeniority: "EXECUTIVE",
    level: 1,
    nextCourseCode: null,
    durationDays: 2,
    specialties: ["communication", "business writing", "presentation"],
    learningOutcomes: [
      outcome("Identify the purpose, audience and key message before writing any business document"),
      outcome("Write clear business emails, memos and minutes using plain-English principles"),
      outcome("Construct a structured business report with an executive summary and recommendations"),
      outcome("Demonstrate confident verbal delivery of a five-minute business briefing"),
    ],
    masterOutlineMarkdown: md("Business Communication & Report Writing", [
      ["Foundations of Business Communication", ["Purpose, audience and key message", "Tone and formality in Malaysian corporate settings", "Barriers to communication"]],
      ["Plain-English Business Writing", ["Emails that get action", "Memos, circulars and meeting minutes", "Editing for clarity and brevity"]],
      ["Report Writing", ["Report structures and the pyramid principle", "Executive summaries and recommendations", "Presenting data in tables and charts"]],
      ["Verbal Communication and Briefings", ["Structuring a five-minute briefing", "Handling questions confidently", "Practice briefings with feedback"]],
    ]),
  },
  {
    courseCode: "CSE-101",
    title: "Customer Service Excellence",
    hrdFocusArea: "Customer Service",
    matchedNossCode: "ILLUS-NOSS-CSV-L2",
    targetSeniority: "OPERATIONAL",
    level: 1,
    nextCourseCode: "COMM-101",
    durationDays: 2,
    specialties: ["customer service", "service excellence", "communication"],
    learningOutcomes: [
      outcome("Describe the customer journey and the moments that shape customer loyalty"),
      outcome("Demonstrate professional greeting, active listening and questioning techniques"),
      outcome("Apply the LAST model to handle complaints from difficult customers"),
      outcome("Measure service quality using simple customer satisfaction indicators"),
    ],
    masterOutlineMarkdown: md("Customer Service Excellence", [
      ["The Service Mindset", ["What customers expect today", "Customer journey and moments of truth", "Internal customers and service culture"]],
      ["Service Communication Skills", ["Professional greetings across channels (counter, phone, WhatsApp)", "Active listening and questioning", "Positive language and tone"]],
      ["Handling Complaints and Difficult Customers", ["The LAST model: Listen, Apologise, Solve, Thank", "De-escalation techniques", "Role-play: complaint scenarios"]],
      ["Measuring and Improving Service", ["Customer satisfaction and NPS basics", "Service recovery and follow-up", "Personal service improvement plan"]],
    ]),
  },
  {
    courseCode: "DATA-201",
    title: "Excel Data Analytics with Power Query & PivotTables",
    hrdFocusArea: "Digital & Data Skills",
    matchedNossCode: "ILLUS-NOSS-ICT-L4",
    targetSeniority: "EXECUTIVE",
    level: 2,
    nextCourseCode: null,
    durationDays: 2,
    specialties: ["excel", "data analytics", "power query", "microsoft office"],
    learningOutcomes: [
      outcome("Use Power Query to import, clean and combine data from multiple sources"),
      outcome("Build PivotTables and PivotCharts to summarise operational data"),
      outcome("Calculate key business metrics with XLOOKUP, SUMIFS and dynamic array functions"),
      outcome("Analyse trends and exceptions to support a management decision"),
      outcome("Design a refreshable one-page dashboard for monthly reporting"),
    ],
    masterOutlineMarkdown: md("Excel Data Analytics with Power Query & PivotTables", [
      ["Data Preparation with Power Query", ["Importing from CSV, Excel and folders", "Cleaning, splitting and unpivoting data", "Appending and merging queries"]],
      ["Formulas for Analysis", ["XLOOKUP, SUMIFS, COUNTIFS", "Dynamic arrays: FILTER, SORT, UNIQUE", "Error handling and data validation"]],
      ["PivotTables and PivotCharts", ["Summarising and grouping data", "Calculated fields and slicers", "PivotCharts for trend analysis"]],
      ["Dashboards and Reporting", ["Dashboard layout principles", "Building a refreshable monthly dashboard", "Presenting insights to management"]],
    ]),
  },
  {
    courseCode: "DMK-101",
    title: "Digital Marketing for Business Growth",
    hrdFocusArea: "Digital Marketing",
    matchedNossCode: "ILLUS-NOSS-MKT-L4",
    targetSeniority: "EXECUTIVE",
    level: 1,
    nextCourseCode: null,
    durationDays: 2,
    specialties: ["digital marketing", "social media", "marketing"],
    learningOutcomes: [
      outcome("Explain how search, social and marketplace channels drive customer acquisition in Malaysia"),
      outcome("Develop a content calendar aligned to buyer personas and campaign objectives"),
      outcome("Apply basic targeting and budgeting for Meta and Google advertising campaigns"),
      outcome("Evaluate campaign performance using reach, conversion and cost-per-lead metrics"),
    ],
    masterOutlineMarkdown: md("Digital Marketing for Business Growth", [
      ["The Digital Marketing Landscape", ["Channels: search, social, marketplaces, WhatsApp commerce", "Buyer personas and the customer funnel", "PDPA considerations for marketing data"]],
      ["Content and Social Media", ["Content pillars and content calendars", "Short-form video and creative basics", "Community management"]],
      ["Paid Advertising Fundamentals", ["Meta Ads targeting and budgeting", "Google Search campaigns and keywords", "Landing pages that convert"]],
      ["Measuring Results", ["Key metrics: reach, CTR, conversion, cost per lead", "Reading platform dashboards", "Campaign optimisation plan"]],
    ]),
  },
  {
    courseCode: "OSH-201",
    title: "OSH Hazard Identification, Risk Assessment & Risk Control (HIRARC)",
    hrdFocusArea: "Occupational Safety & Health",
    matchedNossCode: "ILLUS-NOSS-OSH-L3",
    targetSeniority: "SUPERVISORY",
    level: 2,
    nextCourseCode: null,
    durationDays: 2,
    specialties: ["osh", "safety", "hirarc", "risk assessment"],
    learningOutcomes: [
      outcome("Explain employer and employee duties under the Occupational Safety and Health Act 1994 (as amended 2022)"),
      outcome("Identify physical, chemical, biological, ergonomic and psychosocial hazards in the workplace"),
      outcome("Conduct a risk assessment using a likelihood-severity matrix"),
      outcome("Recommend risk controls using the hierarchy of controls"),
      outcome("Prepare a HIRARC register for a selected work activity"),
    ],
    masterOutlineMarkdown: md("OSH HIRARC", [
      ["OSH Legal Framework", ["OSHA 1994 and the 2022 amendments", "Duties of employers, employees and OSH coordinators", "DOSH HIRARC guidelines overview"]],
      ["Hazard Identification", ["Hazard categories and workplace walk-through", "Job hazard analysis techniques", "Incident and near-miss learning"]],
      ["Risk Assessment", ["Likelihood and severity scales", "Risk matrix and risk rating", "Group exercise: rating real workplace risks"]],
      ["Risk Control", ["Hierarchy of controls", "Selecting and verifying controls", "Residual risk and review"]],
      ["HIRARC Register Workshop", ["Completing a HIRARC register", "Presentation of team registers", "Implementation and monitoring plan"]],
    ]),
  },
  {
    courseCode: "QMS-201",
    title: "ISO 9001:2015 Internal Audit",
    hrdFocusArea: "Quality Management",
    matchedNossCode: "ILLUS-NOSS-QMS-L4",
    targetSeniority: "EXECUTIVE",
    level: 2,
    nextCourseCode: null,
    durationDays: 2,
    specialties: ["iso 9001", "quality management", "internal audit", "quality"],
    learningOutcomes: [
      outcome("Interpret the clauses of ISO 9001:2015 and their intent for an internal audit"),
      outcome("Plan an internal audit programme and prepare an audit checklist"),
      outcome("Conduct an audit interview and collect objective evidence"),
      outcome("Evaluate audit findings and classify nonconformities"),
      outcome("Write clear nonconformity reports and verify corrective actions"),
    ],
    masterOutlineMarkdown: md("ISO 9001:2015 Internal Audit", [
      ["ISO 9001:2015 Requirements", ["High-level structure and process approach", "Risk-based thinking", "Clauses 4 to 10 walk-through"]],
      ["Audit Principles and Planning", ["ISO 19011 audit principles", "Audit programme and audit plan", "Preparing checklists"]],
      ["Conducting the Audit", ["Opening meeting and audit interviews", "Sampling and objective evidence", "Audit simulation"]],
      ["Reporting and Follow-up", ["Classifying findings and nonconformities", "Writing nonconformity reports", "Verifying corrective action effectiveness"]],
    ]),
  },
  {
    courseCode: "LSS-101",
    title: "Lean Six Sigma Yellow Belt",
    hrdFocusArea: "Productivity & Continuous Improvement",
    matchedNossCode: "ILLUS-NOSS-PRD-L3",
    targetSeniority: "OPERATIONAL",
    level: 1,
    nextCourseCode: "QMS-201",
    durationDays: 3,
    specialties: ["lean six sigma", "continuous improvement", "productivity", "lean"],
    learningOutcomes: [
      outcome("Describe Lean principles and the eight wastes in manufacturing and service processes"),
      outcome("Map a current-state process and identify non-value-adding steps"),
      outcome("Apply the DMAIC roadmap to a small improvement project"),
      outcome("Use basic quality tools including Pareto charts, fishbone diagrams and check sheets"),
      outcome("Calculate simple process measures such as cycle time, yield and defect rate"),
    ],
    masterOutlineMarkdown: md("Lean Six Sigma Yellow Belt", [
      ["Lean Fundamentals", ["Value, flow and pull", "The eight wastes (TIMWOODS)", "5S and visual management"]],
      ["Process Mapping", ["SIPOC and process maps", "Value stream basics", "Identifying non-value-adding steps"]],
      ["DMAIC Roadmap", ["Define and measure phases", "Analyse and improve phases", "Control and sustain"]],
      ["Quality Tools", ["Pareto charts and check sheets", "Fishbone (Ishikawa) diagrams and 5 Whys", "Simple process metrics"]],
      ["Improvement Project Workshop", ["Selecting a Yellow Belt project", "Team project work", "Project presentations"]],
    ]),
  },
  {
    courseCode: "AI-101",
    title: "AI Productivity at Work: Generative AI for Professionals",
    hrdFocusArea: "Artificial Intelligence & Automation",
    matchedNossCode: "ILLUS-NOSS-ICT-L3",
    targetSeniority: "EXECUTIVE",
    level: 1,
    nextCourseCode: "DATA-201",
    durationDays: 1,
    specialties: ["artificial intelligence", "generative ai", "ai productivity", "productivity", "digital transformation"],
    learningOutcomes: [
      outcome("Explain what generative AI tools can and cannot do reliably at work"),
      outcome("Write structured prompts to draft, summarise and analyse business documents"),
      outcome("Apply company data-protection and PDPA rules when using AI tools"),
      outcome("Evaluate AI-generated output for accuracy, bias and fitness for purpose"),
    ],
    masterOutlineMarkdown: md("AI Productivity at Work", [
      ["Generative AI Foundations", ["How large language models work, in plain terms", "Strengths, limits and hallucinations", "Use cases across HR, finance, sales and operations"]],
      ["Prompting for Work", ["Prompt structure: role, task, context, format", "Drafting, summarising and rewriting", "Hands-on lab with participants' own tasks"]],
      ["Responsible Use", ["PDPA, confidentiality and company AI policy", "Checking output for accuracy and bias", "When not to use AI"]],
      ["Workflow Integration", ["Automating repetitive tasks", "Personal AI productivity plan", "Measuring time saved"]],
    ]),
  },
  {
    courseCode: "FIN-101",
    title: "Finance for Non-Finance Managers",
    hrdFocusArea: "Finance & Business Acumen",
    matchedNossCode: "ILLUS-NOSS-FIN-L4",
    targetSeniority: "SUPERVISORY",
    level: 1,
    nextCourseCode: null,
    durationDays: 2,
    specialties: ["finance", "accounting", "budgeting", "business acumen"],
    learningOutcomes: [
      outcome("Interpret the income statement, balance sheet and cash-flow statement"),
      outcome("Calculate key financial ratios for profitability, liquidity and efficiency"),
      outcome("Prepare a departmental budget and explain variances"),
      outcome("Evaluate the financial impact of an operational decision using simple ROI and payback analysis"),
    ],
    masterOutlineMarkdown: md("Finance for Non-Finance Managers", [
      ["Reading Financial Statements", ["Income statement, balance sheet, cash flow", "How operational decisions show up in the numbers", "Malaysian reporting context (MFRS basics)"]],
      ["Financial Ratios", ["Profitability, liquidity and efficiency ratios", "Working capital and the cash conversion cycle", "Ratio analysis exercise"]],
      ["Budgeting and Cost Control", ["Budget types and the budgeting process", "Fixed, variable and contribution margin", "Variance analysis"]],
      ["Financial Decision-Making", ["ROI, payback and break-even", "Building a business case", "Case study presentations"]],
    ]),
  },
  {
    courseCode: "TMG-101",
    title: "Time Management & Personal Productivity",
    hrdFocusArea: "Personal Effectiveness",
    matchedNossCode: "ILLUS-NOSS-PEF-L2",
    targetSeniority: "OPERATIONAL",
    level: 1,
    nextCourseCode: "SUP-101",
    durationDays: 1,
    specialties: ["time management", "productivity", "personal effectiveness"],
    learningOutcomes: [
      outcome("Identify personal time-wasters and their impact on work output"),
      outcome("Prioritise tasks using the Eisenhower matrix and daily planning"),
      outcome("Apply focus techniques to manage interruptions, meetings and email"),
      outcome("Plan a weekly routine that balances urgent work with important goals"),
    ],
    masterOutlineMarkdown: md("Time Management & Personal Productivity", [
      ["Understanding Time Use", ["Time audit and personal time-wasters", "Urgent versus important", "Energy and attention management"]],
      ["Prioritisation and Planning", ["Eisenhower matrix", "Daily and weekly planning", "Saying no professionally"]],
      ["Managing Interruptions", ["Email and messaging discipline", "Effective meetings", "Focus blocks and batching"]],
      ["Personal Productivity Plan", ["Habits that stick", "Weekly routine design", "Commitment and follow-up"]],
    ]),
  },
];

export interface ChunkSeed {
  sourceType: "NOSS" | "FOCUS_AREA";
  /** ILLUSTRATIVE placeholder reference — not a real JPK NOSS code or HRD Corp document id. */
  sourceRef: string;
  title: string;
  body: string;
}

export const KNOWLEDGE_CHUNK_SEEDS: readonly ChunkSeed[] = [
  {
    sourceType: "NOSS",
    sourceRef: "ILLUS-NOSS-MGT-L3",
    title: "Supervisory management competencies (illustrative NOSS summary)",
    body: "Illustrative competency summary for first-line supervisors: plan and allocate team work, set targets, delegate, coach and give feedback, monitor performance and take corrective action, communicate company policy, and maintain discipline fairly.",
  },
  {
    sourceType: "NOSS",
    sourceRef: "ILLUS-NOSS-MGT-L5",
    title: "Strategic leadership competencies (illustrative NOSS summary)",
    body: "Illustrative competency summary for managers and executives: formulate departmental strategy, lead organisational change, manage conflict and negotiate between stakeholders, make decisions under uncertainty and evaluate their impact on people and performance.",
  },
  {
    sourceType: "NOSS",
    sourceRef: "ILLUS-NOSS-OSH-L3",
    title: "Workplace hazard identification and risk control (illustrative NOSS summary)",
    body: "Illustrative competency summary: identify workplace hazards, assess risk using likelihood and severity, select controls following the hierarchy of controls, document a HIRARC register and monitor control effectiveness in line with OSHA 1994.",
  },
  {
    sourceType: "NOSS",
    sourceRef: "ILLUS-NOSS-QMS-L4",
    title: "Quality management system internal audit (illustrative NOSS summary)",
    body: "Illustrative competency summary: plan internal audits against ISO 9001:2015, collect objective evidence, classify nonconformities, report findings and verify corrective actions.",
  },
  {
    sourceType: "NOSS",
    sourceRef: "ILLUS-NOSS-CSV-L2",
    title: "Customer service delivery (illustrative NOSS summary)",
    body: "Illustrative competency summary: greet and serve customers across channels, listen actively, resolve complaints, recover service failures and record customer feedback for improvement.",
  },
  {
    sourceType: "FOCUS_AREA",
    sourceRef: "ILLUS-FA-LEADERSHIP",
    title: "Leadership & People Management (illustrative focus area)",
    body: "Programmes that build supervisory and managerial capability: leadership, coaching, performance management, conflict management and change leadership for supervisors, managers and executives.",
  },
  {
    sourceType: "FOCUS_AREA",
    sourceRef: "ILLUS-FA-DIGITAL",
    title: "Digital, Data & AI Skills (illustrative focus area)",
    body: "Programmes that raise workforce digital capability: spreadsheet data analytics, dashboards, digital marketing, generative AI productivity and automation of routine office work.",
  },
  {
    sourceType: "FOCUS_AREA",
    sourceRef: "ILLUS-FA-OSH",
    title: "Occupational Safety & Health (illustrative focus area)",
    body: "Programmes that reduce workplace incidents: hazard identification, risk assessment and risk control, OSH legal duties, safety committees and emergency preparedness.",
  },
  {
    sourceType: "FOCUS_AREA",
    sourceRef: "ILLUS-FA-QUALITY",
    title: "Quality & Productivity (illustrative focus area)",
    body: "Programmes that improve quality and productivity: ISO 9001 quality management and internal audit, Lean, Six Sigma, 5S and continuous improvement projects.",
  },
  {
    sourceType: "FOCUS_AREA",
    sourceRef: "ILLUS-FA-COMMUNICATION",
    title: "Communication & Customer Service (illustrative focus area)",
    body: "Programmes that improve internal and external communication: business writing, report writing, presentations, customer service excellence and complaint handling.",
  },
];

/** Text embedded for a course: everything a TNA query might mention. */
export function courseEmbeddingText(c: Pick<CourseSeed, "title" | "hrdFocusArea" | "targetSeniority" | "learningOutcomes" | "masterOutlineMarkdown">): string {
  return [
    c.title,
    c.title,
    c.hrdFocusArea,
    `${c.targetSeniority.toLowerCase()} level`,
    ...c.learningOutcomes.map((o) => o.outcome),
    c.masterOutlineMarkdown.replace(/[#-]/g, " "),
  ].join("\n");
}

const SPECIALTIES_BY_CODE: ReadonlyMap<string, readonly string[]> = new Map(COURSE_SEEDS.map((c) => [c.courseCode, c.specialties]));

const TAG_STOPWORDS = new Set(["and", "for", "with", "the", "at", "work", "skills", "course", "professionals", "effective", "business"]);

/**
 * Trainer-matching tags for a course: the curated tags for seeded courses,
 * plus the meaningful words of the title and focus area so an operator-added
 * course still matches a trainer whose specialties name its subject.
 */
export function specialtyTagsFor(course: { courseCode: string; title: string; hrdFocusArea: string }): string[] {
  const words = `${course.title} ${course.hrdFocusArea}`
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !TAG_STOPWORDS.has(w));
  return [...new Set([...(SPECIALTIES_BY_CODE.get(course.courseCode) ?? []), ...words])];
}
