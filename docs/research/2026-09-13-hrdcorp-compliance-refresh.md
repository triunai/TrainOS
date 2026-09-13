# HRD Corp compliance refresh — 13 Sep 2026

> Re-verifies proposal-content-pack-v2.md §1.5 and Appendices B and H against HRD Corp primary sources where reachable, secondary sources otherwise. URLs accessed 13 Sep 2026.

## (a) Rule-by-rule table

| # | Rule | Condition | Effective | Source | vs. pack |
|---|---|---|---|---|---|
| 1 | In-house lead time | start ≥ approval + 14d | 15 Jun 2026 → | [Circular 2/2026 PDF](https://hrdcorp.gov.my/wp-content/uploads/2026/05/Employer-Circular-22026.pdf); [Nexus Consultancy](https://nexustac.com/3-crucial-hrd-corp-grant-changes-effective-15-june-2026-circular-no-2-2026/) | Matches |
| 2 | Public lead time, phase 1 | start ≥ approval + 3d | 15 Jun–31 Dec 2026 | Same | Matches |
| 3 | Public lead time, phase 2 | start ≥ approval + 14d | 1 Jan 2027 → | Same | Matches |
| 4 | Commencement window | start ≤ approval + 90d | 15 Jun 2026 → | Same | Matches |
| 5 | No amendments | approved grant locked; cancel + resubmit for changes; postponement reportedly negotiable directly with HRD Corp | 15 Jun 2026 → | Same | Matches, with an undocumented postponement exception the pack doesn't mention |
| 6 | Single query round | 1 query per application, **5 calendar days** to respond or application expires | 15 Jun 2026 → | Same | **New detail** — §1.5 names "single query round" but not the 5-day deadline, which is claim-relevant |
| 7 | Claim window | claim ≤ completion + 6mo | current | Secondary sources only; circular PDF text unreachable | Matches, unconfirmed against primary text |
| 8 | HRD-TDF mandatory | trainer must hold active accreditation | **1 Jan 2025, Circular 6/2024** | [HRD-TDF FAQ PDF](https://hrdcorp.gov.my/wp-content/uploads/2025/01/HRD-TDF-FAQ-022024-1.pdf) | **Misattributed** — §1.5 lists this under 2/2026; it's a separate, earlier circular |
| 9 | HRD-TDF renewal | 3-yr validity; 360 active-training hours to renew (or assessment route); apply ≥3mo before expiry | ongoing | [HRD Corp HRD-TDF page](https://hrdcorp.gov.my/hrd-tdf) | **New**, not in pack — needed for trainer-sourcing agent (§2.3) |
| 10 | ACM course-fee ceiling | up to RM1,500/hr, capped RM10,500/day in-house (per group); RM1,750/pax/day public | rate set **1 Nov 2024**, restated in Jan 2026 guidebook | [aitraining2u](https://www.aitraining2u.com/hrdc-allowable-cost-matrix-guide-malaysia-2026.html); [Carriera Group](https://carrieragroup.com.my/hrd-corp-allowable-cost-matrix-malaysia-employer-guide.html) | **Number right, vintage wrong** — a 2024 rate, not a new 2026 tightening |
| 11 | ACM meal ceiling | RM15–25/pax (3 of 4 sources: per meal); 1 source says RM100/pax/day | Jan 2026 ACM | [aitraining2u](https://www.aitraining2u.com/hrdc-allowable-cost-matrix-guide-malaysia-2026.html); [CorporateTrainingMalaysia](https://corporatetrainingmalaysia.com/hrdf-claimable-rates-malaysia); vs [Carriera Group](https://carrieragroup.com.my/hrd-corp-allowable-cost-matrix-malaysia-employer-guide.html) | Matches pack's figure; **unresolved outlier** — needs primary PDF |
| 12 | Forfeiture | balance >RM10,000 forfeited after 24mo no claim | 1 Jan 2020, **Circular 7/2019** | [Levy Forfeiture KB](https://supportcentre.hrdcorp.gov.my/portal/en/kb/articles/hrd-levy-forfeiture) | Matches exactly |
| 13 | 15% deduction | balance >RM50,000 and utilisation <50% of year's contribution → 15% of excess | 1 Mar 2025 | [ajobthing](https://www.ajobthing.com/resources/blog/hrdcorp-avoid-15-deduction-to-your-hrdf); [OTC](https://otc.com.my/15-deduction-of-unused-hrd-corp-levy-starting-1-march-2025/) | Matches |
| 14 | eTRIS no API/bulk upload | none found anywhere | current | absence of evidence across HRD Corp and integrator sites | Matches pack's assumption |
| 15 | Attendance immutability | locked once saved/approved in claim submission | current | [claim-steps guide](https://hrdtraining.mohdibrahim.com/7-steps-to-claim-hrd-corp-claimable-training/) | Matches, no primary-source quote found |
| 16 | Education levy exemption | private education employers fully exempt | 1 Jan–31 Dec 2026, **Circular 1/2026** | [HRD Corp circulars](https://hrdcorp.gov.my/circulars); [BusinessToday](https://www.businesstoday.com.my/2026/01/14/private-education-sector-exempted-from-hrd-levy-payments-from-january/) | Matches, now citable by circular number |
| 17 | New circulars since Jun 2026 | Circular 3/2026 (Aug 2026), patriotic-songs requirement — not scheduling-relevant | Aug 2026 | [HRD Corp circulars](https://hrdcorp.gov.my/circulars) | New, immaterial to compliance logic |

## (b) Diff against the proposal pack

1. **§1.5 bullet 2**: split "HRD-TDF accreditation mandatory" out of the Circular 2/2026 list — it's Circular 6/2024 (1 Jan 2025). Also relabel the ACM ceiling as a 2024 rate restated in 2026, not a new 2026 change.
2. **§1.5 bullet 2**: add the 5-calendar-day query-response deadline behind "single query round" — missing it silently expires the whole application.
3. **Appendix B**, HRD-TDF row's "Effective: current" → cite Circular 6/2024, 1 Jan 2025.
4. **Appendix B**, meal-allowance row: keep RM15–25 but flag the one conflicting RM100/pax/day source pending a primary-PDF read.
5. **Appendix H**: add `hrdcorp.gov.my/circulars`, Circular 1/2026, Circular 6/2024, and the HRD-TDF FAQ PDF as primary sources.
6. **§1.4**: cite the education exemption as Circular 1/2026 by name.

## (c) Proposed rule-registry rows

Shape of `core.compliance_rules` (migration 009): `rule_code, family_key, check_key, scheme, delivery_mode, subject_field, op, reference, offset, effective_from, effective_to, source`.

```
HRD-014  LEAD_TIME_INHOUSE    CHK_LEAD_TIME             *  IN_HOUSE  start<=approval+14d           2026-06-15  —
HRD-015  LEAD_TIME_PUBLIC     CHK_LEAD_TIME             *  PUBLIC    start>=approval+3d             2026-06-15  2026-12-31
HRD-022  LEAD_TIME_PUBLIC     CHK_LEAD_TIME             *  PUBLIC    start>=approval+14d            2027-01-01  —   (supersedes HRD-015)
HRD-007  COMMENCEMENT_WINDOW  CHK_COMMENCEMENT_WINDOW   *  ANY       start<=approval+90d            2026-06-15  —
HRD-009  CLAIM_WINDOW         CHK_CLAIM_WINDOW          *  ANY       claim<=completion+6mo          unconfirmed —  needs primary cite before ACTIVE
HRD-018  NO_AMENDMENT         (write-guard, not CHK_)   *  ANY       blocks UPDATE on approved grant 2026-06-15  —
NEW      QUERY_RESPONSE       CHK_QUERY_DEADLINE (new)  *  ANY       response<=query_raised+5d      2026-06-15  —   not in Appendix B; recommend adding
HRD-023  TRAINER_ACCREDITATION CHK_TRAINER_ACCREDITATION * ANY       trainer.hrd_tdf_status=ACCREDITED 2025-01-01 —  reattributed from 2/2026
HRD-020  MEAL_CEILING         CHK_MEAL_CEILING          *  ANY       meal_cost_per_pax in [15,25] RM 2024-11-01  —   pending RM100 outlier resolution
NEW      FEE_CEILING_INHOUSE  CHK_FEE_CEILING (new)     *  IN_HOUSE  fee<=RM1,500/hr, <=RM10,500/day 2024-11-01 —  no existing check key covers this; gap vs §2.3's "flag ACM ceilings" promise
```

All rows load `status = 'PROPOSED'` per `cr_active_needs_verification` until a named Finance verifier confirms each against the circular text — none should be inserted `ACTIVE` from this document alone.

## (d) HRD Corp's definition of "utilisation"

No formal, quotable definition exists on any HRD Corp page reached. Every source (primary and secondary) states only the condition it triggers ("less than 50% of the employer's total contribution between 1 Jan and 31 Dec"), never a named formula. Best-supported reading: utilisation = claims approved within the calendar year ÷ that year's levy contribution (not the accumulated balance). Treat this as an inferred assumption, not a published fact — state it explicitly to the client and validate against a real eTRIS utilisation display during discovery.

## (e) Open questions

1. Both official Circular 2/2026 PDF URLs 404'd on direct fetch; rules 1–7 rest on secondary sources that cite the circular, not a direct read. Confirm by opening the PDF in a browser.
2. The Jan 2026 ACM guidebook PDF downloaded but resisted text extraction (font-subset encoding); the RM1,500/hr and RM15–25/pax figures rest on three converging secondary sources, not the guidebook itself.
3. Meal-allowance conflict (RM15–25/pax vs one source's RM100/pax/day) unresolved — needs a human reading the actual PDF table.
4. No primary HRD Corp page states the 6-month claim window or attendance immutability in its own words; both rest on provider workflow guides. Worth checking HRD Corp's own `6-Process-Flow-for-Claim-Application.pdf`.
5. No published utilisation formula — see (d).
6. Whether the "no amendments" postponement exception is real HRD Corp practice or informal provider workaround — worth confirming with an HRD Corp account manager before building it as a system behaviour.
