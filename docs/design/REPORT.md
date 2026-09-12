# TrainOS demo pack — build report

Built 11 Sep 2026 · 20 screens across 13 files · one story, Aurora Manufacturing, September to November 2026.
Start at **M22 Demo script.dc.html** — it indexes and links every screen in demo order.

## Screens

| Screen | File | Primary actions | Blue (excl. AI tints) | States rendered | Wired to |
|---|---|---|---|---|---|
| M01-S01 Executive dashboard | M01 Dashboards | 1 · Open approvals | ~6% | AR warning delta, SLA-breached approval row | M02-S01, M13-S05, M18-S01 |
| M03-S01 Enquiry inbox | Kit (proof) | 1 · Accept & convert | ~8% | low-confidence classification, auto-archived item | M03-S02, M04-S02 |
| M03-S02 Enquiry detail | M03 Leads | 1 · Accept & convert | ~7% | field mid-edit, overdue-invoice exception | M05-S02, M04-S02, M13-S05 |
| M05-S02 TNA detail | M05 TNA | 1 · Use recommendation | ~7% | budget absent, 22% honest low-fit option | M07-S02, M06-S02 |
| M06-S02 Programme detail | M06 Programmes | 1 · Edit programme | ~4% | second trainer booked in window | M07-S03, M08-S02 |
| M07-S02 Proposal builder | M07 Proposals | 1 · Send for approval | ~8% | AI low-confidence section blocks clean send | M02-S01, M07-S03, M18-S04 |
| M07-S03 Costing worksheet | M07 Proposals | 1 · Apply to proposal | ~5% | below-floor discount error | M07-S02, M02-S03 |
| M02-S01 Approval inbox | M02 Approvals | 1 · Review next | ~7% | SLA breach, bulk approve blocked on money | M02-S02, M12-S02, M13-S02 |
| M02-S02 Approval detail | Kit (proof) | 1 · Approve & send | ~11% | awaiting approval, medium risk | M07-S07, M18-S04 |
| M07-S07 Client proposal page | M07 Proposals | 0 · accepted state | ~3% | accepted and locked | ENG-0231 / M09-S02 |
| M04-S02 Organisation 360 | Kit (proof) | 1 · New opportunity | ~7% | overdue AR, blocked claim, lost engagement, no-consent contact | M02-S02, M13-S05 |
| M09-S02 Engagement detail | M09 Operations | 1 · Close out | ~6% | claim blocked, partial attendance | M12-S02, M10-S06, M13-S02 |
| M10-S06 Attendance capture | M10 Participants | 0 · locked by rule | ~3% | locked, capture disabled, absentee | M12-S02 |
| M12-S02 HRDC claim packet | M12 HRD Corp | 1 · disabled until complete | ~5% | 2 docs missing, 3-day deadline, no submit button | M10-S06, M13-S02, M02-S01 |
| M13-S02 Invoice detail | M13 Finance | 1 · Record payment | ~5% | validated now, failed sync attempt retained, no payments | M09-S02, M12-S02, M13-S05 |
| M13-S05 Collections queue | M13 Finance | 1 · Approve & send | ~7% | 48-day item escalated past agent autonomy | M13-S02, M04-S02 |
| M18-S01 Agent registry | M18 Agents | 1 · Register agent | ~6% | agent paused on eval regression | M18-S04, M02-S01 |
| M18-S04 Run trace #4821 | M18 Agents | 1 · Open approval | ~6% | succeeded with retry, failed dead-letter run | M02-S02, M18-S01 |
| M22-S04 Demo script | M22 Demo script | 0 · document | ~2% | — | every screen |

Blue percentages are estimates of tinted area on the 1440×900 canvas, excluding the 6% AI tint, and all sit inside the 5–15% budget.

## Kit additions made during this build

Added in the kit's existing style, not invented per screen:

- **MetricStrip cell with mini bar** — used for health, attendance and claim completeness.
- **Grouped approval table** — urgency group captions above table blocks, with a disabled checkbox for actions that may not be bulk-approved.
- **Escalation ladder** — vertical dot list showing where agent autonomy ends and a human takes over (collections).
- **Document checklist row** — tick, document thumb, metadata, attach/view action (HRDC packet).
- **Run step row** — tool call, arguments, outputs, duration, cost, status glyph, expandable (trace viewer).
- **Aging strip** — MetricStrip configured with AR buckets.
- **External minimal shell** — logo, language toggle, contact, no sidebar (client proposal page).

## Assumptions logged

1. **Sales role sees Training → Programmes** read-only so a consultant can check the catalogue without an Ops role. Edit rights stay with L&D.
2. **Admin hours saved** = agent actions × role-weighted manual minutes; presented as an estimate, not a measured figure.
3. **Fit score** in the TNA is a weighted match of gap coverage, audience size, delivery window and trainer availability; weights configurable.
4. **Floor price** = direct cost ÷ (1 − 0.35); commission 8% of sell, payable on collection.
5. **SBL-Khas claim window** taken as 5 working days after completion; grant application (GRT-2026-77412) approved before delivery.
6. **Training services SST-exempt**; MyInvois UIN shown masked because it is issued outside TrainOS.
7. **Collections cadence** 7 / 30 / 45 days, human call at 60, trading hold at 75 with MD approval.
8. **Money-moving action types cannot be Autonomous** — the ladder caps send, book and invoice at Act-with-approval.
9. **Traces** keep full inputs and outputs 30 days, metadata thereafter; participant PII redacted before storage.
10. **E-signature** on the client page is name + timestamp + IP, not certificate-based.
11. **Low-confidence AI sections** warn rather than hard-block; the flag travels to the approver.
12. **Attendance sessions** are AM/PM per day to match the HRD Corp sheet.

## Least-confident screens

1. **M12-S02 HRDC packet** — the five required documents and the 5-working-day window are from public scheme descriptions, not from a current HRD Corp circular. Verify the document list and deadline before build.
2. **M13-S02 invoice sync** — the accounting-package field mapping (customer, item, tax code) is modelled generically; the real integration will dictate the error taxonomy shown in the sync log.
3. **M18-S01 autonomy matrix** — per-action levels are a proposal, not a policy decision. The MD should set these before the ladder is coded.
4. **M07-S03 costing** — trainer day rate, materials per pax and commission are placeholders; Finance owns the real rate card.
5. **M01-S01 hours saved** — the headline metric of the demo rests on assumption 2. Agree the formula before it appears in front of a client.

## Handoff notes

Every screen's annotation panel (collapsed, at the bottom of the frame) carries: purpose, primary user, components used, **data contract**, actions and policy gates, states rendered, AI and approval behaviour, wiring, and assumptions. The data-contract lines are the first-pass DTOs.

Recurring entities across the pack:

```
Organisation{id,name,industry,location,ownerId,healthScore,levyAvailableRM}
Contact{id,orgId,name,role,consent{email,whatsapp},primary}
Enquiry{id,channel,receivedAt,from,body,status}
Extraction{topic,audience,timing,budget,confidence,sources[],agentId,runId}
Opportunity{id,orgId,stage,valueRM,probability,ownerId}
TNA{id,opportunityId,status,audience{},constraints[],gaps[]}
Programme{id,name,days,listPriceRM,floorPriceRM,hrdcScheme,modules[],trainerPool[]}
Proposal{id,opportunityId,templateId,status,sections[{n,origin,confidence,editedBy}],valueRM,marginPct}
Quotation{id,proposalId,lines[],sellRM,directCostRM,marginPct,commissionPct}
ApprovalRequest{id,policyId,type,subject,valueRM,requestedBy{kind,id},confidence,slaDueAt,autonomyLevel,status,evidence[],diff[]}
Engagement{id,opportunityId,programmeId,dates[],venue,status,valueRM}
Session{id,engagementId,day,date,trainerId,present,total}
Participant{id,engagementId,name,dept,attendance{},certificateId}
AttendanceSheet{engagementId,day,status,approvedBy,approvedAt,immutable}
ClaimPacket{engagementId,scheme,employerCode,claimValueRM,completenessPct,requiredDocs[],deadlineAt,submissionRef}
Invoice{id,orgId,engagementId,lines[],totalRM,sstRM,status,syncState,uin,dueAt}
Receivable{invoiceId,daysOverdue,amountRM,stage,nextActionAt}
Agent{id,name,status,scopes[],costMonthRM,evalScore,killSwitch}
AutonomyGrant{agentId,actionType,level,approverRole,thresholdRM}
AutomationRun{id,agentId,trigger,model,startedAt,durationMs,costRM,tokens,status,steps[]}
```

## Critique pass — what changed after review

- M03-S02: suggested-action button demoted; header keeps the only primary. Timing field left in its edit state so the "edit before use" affordance is visible rather than described.
- M05-S02: duplicate "Use recommendation" demoted inside the ranked card.
- M07-S02: editor header allowed to wrap — three controls plus a 16px title overflowed the 491px column by 22px. Footer send demoted.
- M07-S03: below-floor error kept as the shown state; the healthy price sits beside it so the comparison is visible without interaction.
- M12-S02: attach buttons and the agent suggestion demoted to secondary; the disabled primary is the only prominent action, which is the point of the screen.
- M13-S05: WhatsApp cost box collapsed to a single line — the detail column overflowed by 52px.
- M18-S01: registry row padding tightened from 10px to 7px; the table overflowed its pane by 35px with eight agents.
- All files: div balance verified at zero, one solid primary per screen (M07-S07 and M10-S06 intentionally have none — both are locked states), no panel clipping at 1440×900.


---

# Update pass — AI operations, BYOK, compliance rules, orchestrator UX

Six new screens, five updated, all in light and dark. No existing screen was restyled beyond the listed changes; no new colours were introduced.

## New screens

| Screen | File | Primary | States | Wired to |
|---|---|---|---|---|
| M20-S20 AI models — tiers and routing | M20 Settings AI | 1 · Apply to future runs | tier degraded with live fallback, tier paused by cap, 2 unsaved matrix edits | M20-S21, M20-S16, M18-S04 |
| M20-S21 Provider keys (BYOK) | M20 Settings AI | 1 · Add provider key | key invalid with fallback named, key at 90% cap, key expiring, embeddings empty state | M20-S20, M20-S16 |
| M20-S16 Usage, cost and budgets | M20 Settings AI | 1 · Raise SPECIAL cap | SPECIAL paused by cap, rule-extract at 98% | M18-S04 drill-through |
| M12-S07 HRD Corp rules registry | M12 HRD Corp | 1 · Add rule | superseded rule with dated replacement, proposed rule unverified | M12-S08, M16-S05, checks |
| M12-S08 Rule change review | M12 HRD Corp | 1 · Approve selected | one change affecting 4 open engagements | M12-S07, M09-S02 |
| M16-S05 Knowledge sources | M16 Knowledge | 1 · Add source | changed source, embedding pending, fetch failing since 07 Nov | M12-S08 |

## Updated screens

- **M12-S02** — rule-checks block with computed values and citation chips; labelled *Computed · no model*.
- **M09-S02** — same checks block; the HRDC lifecycle step is Blocked because a check fails, not because a document count says so.
- **M18-S04** — rebuilt as an execution tree (orchestrator → Reader / Matcher / Drafter / Verifier → tools) with per-node tier, model, cache-hit, tokens and cost; event rows for escalation, jury, truncation, handoff and policy halt; a state-card panel with goal, plan, decisions, constraints, open questions and budget bars; failed variant retries from checkpoint.
- **M18-S01** — default tier, jury, 30-day cache-hit and cost-per-run columns. Escalation ladder was dropped from this table during the fit pass; it lives in M20-S20, which is its owner.
- **M02-S02** — model-agreement line under the evidence list when a jury ran.
- **Kit** — AI badge popover and the canonical provenance block now carry model · provider · cache-hit · tier.

## Kit additions (section 10)

Tier chip (neutral by design — a tier is a routing fact, not a status) · jury chip (AI tint) · budget bar (ink until near or at cap) · allowed-hours strip (24 cells, peak bands shaded) · rule check row with citation chip · trace tree node · state-card panel.

## Self-review — one line per screen

- **M20-S20** — tier table and 12-row matrix did not fit 900px; the matrix now scrolls in its own pane rather than being truncated, and the banner sits outside the scroll flow.
- **M20-S21** — six provider cards in a 3-column grid; the invalid card names the tier now serving its traffic instead of only saying "invalid".
- **M20-S16** — cost lists trimmed to top 4/5 with the totals still exact; every bar keeps its drill-through.
- **M12-S07** — source column abbreviated to stop the table overflowing; the drawer carries the full citation.
- **M12-S08** — highlight in the document pane matches the span quoted on the diff card, so the two read as one artefact.
- **M16-S05** — retrieval policy and monitoring stated on-screen; a changed source is quarantined from extraction but stays searchable.
- **M12-S02** — checks trimmed to four visible with "3 more"; the fail row is what blocks the packet.
- **M09-S02** — three checks only, since the packet screen owns the full list.
- **M18-S04** — dropped two events and one state-card row to fit; the kept events are the ones a reviewer acts on.
- **M18-S01** — row padding tightened twice and a column moved to its owning screen rather than shrinking type.

## Assumptions added

13. Peak bands 09–12 and 14–18 MYT reflect DeepSeek pricing; batch-eligible tiers are restricted to off-peak and queue rather than escalate.
14. Money-moving action types cannot exceed Act-with-approval regardless of jury result.
15. Rules resolve as at the training date, not as at today.
16. Rule extraction below 0.80 confidence is withheld from the diff view for manual transcription.
17. Corpus monitoring is weekly and hash-based; internal SOPs are searchable internally but excluded from client-facing generation.
18. Per-run token and cost budgets trigger a HANDOFF and restart at 60% context rather than silent truncation.

## Least-confident, this pass

1. **Jury economics** — three STRONG calls per gated action roughly triples that step's cost. Needs a value threshold before it ships.
2. **Rule expression grammar** — the declarative form shown (field, operator, reference, offset) covers the six demo rules; real circulars will have conditions it cannot express.
3. **Provider residency** — the PDPA note per provider is a placeholder; legal should write the actual wording.


---

# Decisions with proposed defaults

**DECISIONS.md** now holds the seven items that are client decisions, not design ones, each with a defensible default so discovery confirms rather than invents: autonomy matrix, jury economics, HRD Corp rule set, admin-hours-saved formula, rate card schema, rule resolution date, and money rounding. It ends with a sequenced discovery agenda.

Three of those supersede earlier assumptions in this report and in API_CONTRACT.md:

- **Assumption 5 was wrong.** There is no 5-working-day claim window; it came from a practitioner note, not a circular. The claim window is 6 months from completion, and lead times are 14 calendar days in-house, 3 days public until 31 Dec 2026, 14 days from 1 Jan 2027 — all loading as Proposed until compliance verifies against the circular PDFs.
- **Assumption 15 is replaced.** Rules do not resolve as at the training date. Grant-side rules resolve as at grant submission, claim-side as at claim submission, re-evaluated at every stage transition, with both versions cited when they differ across stages.
- **Rounding is settled:** total-from-lines, integer sen, each line rounded half-up. The RM 616.67 case is a modelling error — RM 18,500 for 30 pax is a package price, one line at qty 1, per-pax informational only.

Jury also changes shape in the contract: `jury` becomes `{ mode: "GATE" | "SAMPLE" | "ESCALATE", … }` rather than a boolean, because a per-action jury roughly triples that step's cost and buys nothing once the action type is stable.

## Screen edits from these decisions

- **M01-S01** — admin-hours-saved now reads "illustrative · baseline not yet measured" instead of implying a measured figure.
- **M07-S03** — costing header shows "rate card v0 · placeholder" so nobody quotes from the demo numbers.
- **M12-S02** — deadline banner and claim-window check corrected to the 6-month rule; citations point at Circular 2/2026.
