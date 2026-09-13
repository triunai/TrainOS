# AI integration 5 — trainer matching and hold

> Pre-hard breadth pass, 2026-09-13. Companion: brainstorm item 5. An Opus lane goes deeper on this file — see §10.

## 1 · The job and the number

Rank accredited trainers against a programme by competency fit, HRD-TDF status, availability and rate; place a time-boxed hold on the winning slot instead of a bare recommendation; warn before a training date arrives on a trainer whose accreditation will have lapsed. Ops confirms the booking; the agent never confirms it itself.

The brainstorm's number: **~RM 8,000/month protected**, from "two engagements a quarter lost to availability." Recomputed: 2 ÷ 3 months × RM 12,000 average claimable value = RM 8,004/month, matching. It's a *protection* number, not revenue: it assumes those engagements were lost outright, not delayed — the optimistic case. What would firm it up is brainstorm question 6: how many accredited trainers Alex holds relationships with, and how often availability has cost an engagement in the last year. Until then "2 per quarter" is a guess anchored to the ~3,000-trainers-for-~8,000-providers scarcity in `value-chain-and-numbers.md`, not a measured rate.

## 2 · Data it needs

**Contract types:** `Trainer` (`packages/contract/src/domain/proposals.ts:154`) is marked "§none — ruled R8" in its own comment: the published contract never defines a trainer record, only `TrainerPoolEntry` (`:138`, the summary embedded on a programme) and `TrainerAvailability` (`:88`, a recommendation-time check). The type here is lifted from the fixture package. `TrainerBand`/`TrainerDayRate` (`:401`, `:416`) join into the rate card, itself still `v0-placeholder` (API_CONTRACT.md:1203).

**Endpoints:** `GET /v1/trainers?filter[programmeId][eq]=` is named in the §13 matrix for M06-S02 (API_CONTRACT.md:825), no documented response shape. The runtime's `trainers.availability` tool (`tools/definitions.ts:153`, dispatched at `fixture-adapter.ts:135`) takes `programmeRef, from, to`. `TRAINER_BOOK` is a listed action type (API_CONTRACT.md:197) with a routing entry (`routing/config.ts:269`: `MID` tier, escalate `STRONG_1`, `ESCALATE` jury, `requiredForAutonomous: true`) — but **no payload interface exists for it anywhere**, unlike every other action type (`proposals.ts:495-513`). Someone has to write `TrainerBookPayload` before this ships.

**Tables (001–011):** `core.trainers` (006:193) carries `band`, `day_rate_override_sen`, `ttt_certified`/`ttt_ref`/`ttt_valid_to` and `hrd_tdf boolean` — **no expiry date for HRD-TDF**, a flag only. `core.programme_trainers` (006:251) is per-programme pool membership with `certified_at`, the closest thing to a competency join; **no competency table exists anywhere in 001–011** (checked by grep). `core.trainer_availability` (006:271) is a declared AVAILABLE/BLOCKED/BOOKED calendar, synced only for `CONFIRMED` bookings by trigger (006:343). **A hold already has a home**: `core.trainer_bookings` (006:297) has `booking_state` (`SOFT_HOLD|CONFIRMED|RELEASED|CANCELLED`, enum 003:409), a `CHECK` requiring `hold_expires_at` on `SOFT_HOLD` (006:319), and an `EXCLUDE ... WHERE (state='CONFIRMED')` constraint (006:326) making double-booking a confirmed trainer structurally impossible, while letting soft holds overlap by design (006:28) — nothing surfaces how many holds sit on one trainer/date, so two salespeople could hold the same slot unwarned.

## 3 · Deterministic core vs model calls

Close to a pure scored query. **CODE**: the availability join (`trainer_availability` ⋈ `trainer_bookings`), the programme-pool filter, the HRD-TDF check, the TTT expiry math (`daysUntil`/`tttStateOf`, `accreditation.ts:47-63`), the rate lookup, the rank-by-rating sort. **MODEL**: only the one-sentence rationale and disambiguating a fuzzy client-stated programme name. Estimate: **≥85% deterministic**. Today's demo chain conflates this with org and programme matching in one `MID`-tier call, the `Matcher` stage (`agents/lead-to-proposal.ts:83`, tools `organisations.search, programmes.search, trainers.availability`) — fine for a demo, but it should split into its own SQL-first step before Autonomous.

## 4 · Policy and autonomy

Table 2.3 (`proposal-content-pack-v2.md:102`) puts the agent at "match and hold," the human at "confirm booking" — Act-with-approval, already encoded: `TRAINER_BOOK` at `MID`, `ESCALATE` jury, `requiredForAutonomous: true` (`routing/config.ts:269`). Per §18's jury object (API_CONTRACT.md:1194), `ESCALATE` fires on `minConfidence < 0.70`, `value > RM 50,000` or `firstOfKind` — a day-rate booking rarely crosses RM 50k, so it mostly fires on low confidence or a first booking of that trainer/programme pair. The context flags (§3 step 3) need a new one, e.g. `overlappingSoftHold`, since the schema explicitly allows concurrent holds. Promotion to Autonomous needs the standard bar: evals on Alex's history, 2-of-3 jury, a human decision record agreeing (proposal-content-pack-v2.md:92).

## 5 · Screens

- **Programme detail** (`ProgrammeDetailPage.tsx:108,156-161,444`) already renders the trainer pool with booked/delivering conflict badges. Change: add a "Hold" action per available row that submits `TRAINER_BOOK` and shows the resulting `hold_expires_at` countdown.
- **Trainer record** (`TrainerRecordPage.tsx:29,181`) already imports `accreditationOf`/`nextBookedDay` with an availability tab. Change: split the accreditation chip so HRD-TDF (claimability) reads independently of TTT (certification) — `accreditation.ts:23-42` already models them as two gates a single chip would conflate.
- **Training calendar** (`TrainingCalendarScreen.tsx:1-49`) is engagement-centric, drawing from `Engagement.dates[]`, not trainer bookings — no trainer-facing schedule view exists today. This is the real gap: a booking board showing SOFT_HOLD vs CONFIRMED per trainer does not exist yet.

## 6 · Evals

Golden set: every fixture trainer against every programme window — small today (Farah Aziz, Daniel Wong, Lee Chin Hoe, Noora Idris, `fixtures/src/data/programmes.ts:57-117`) but the shape scales. Three concrete cases:
1. Farah Aziz, HRD-TDF true, TTT valid to 2027-06-30, booked 2026-11-12/13 — must rank available for PRG-0031 in that exact window, unavailable a day either side.
2. Daniel Wong, booked 2026-11-10 through 13 — must be rejected for any overlapping window despite a TTT valid to 2028.
3. Noora Idris, `tttCertified: false`, `hrdTdf: false` — must never be recommended for a claimable programme regardless of rating; the confidently-wrong case that matters most, since a wrong call here is a rejected HRD Corp claim.

Shadow-exit: 100% exclusion accuracy on non-accredited trainers (gates a real claim, so a bug bar not a target), availability-window exact match ≥ 0.98, zero double-bookings created in shadow (the `tb_no_double_booking` constraint never firing on a hold the agent placed).

## 7 · Risks

- **Regulator**: an unaccredited trainer recommended on a claimable programme — gate `hrd_tdf = true` in SQL before any model sees the list, never post-hoc.
- **PII**: trainer contact/rating data is internal, low sensitivity — standard row-level tenancy covers it.
- **Prompt injection**: low — reads structured rows, not free text — keep model input to tool results only.
- **Cost**: negligible per §8 — don't let a routine rank escalate to `STRONG`.

## 8 · Monthly token cost

At baseline (25 engagements/month, one call each, `MID` tier per proposal-content-pack-v2.md:190): ~800 in / 300 out tokens × 25 = 20,000 in / 7,500 out. At `MID` off-peak USD 0.66/1.98 per 1M: (0.02×0.66)+(0.0075×1.98) ≈ **USD 0.03/month**, folded into §4.2's baseline USD 25–40, not its own budget line.

## 9 · Smallest viable slice

One week, fixtures only: wire `GET /v1/trainers?filter[programmeId][eq]=` to return real `Trainer` rows (define the missing type first), add `TrainerBookPayload`, and let the "Hold" button write a `SOFT_HOLD` row with a 72-hour `hold_expires_at`. No model call needed for this slice — it proves the deterministic 85% before any ranking is added.

## 10 · For the Opus pass

1. Will `hrd_tdf` ever carry an expiry date? `CHK_TRAINER_ACCREDITATION` (API_CONTRACT §17/Appendix B) reads a boolean today; HRD Corp's TDF registration presumably lapses in reality, and nothing in 001–011 models that. Confirm with Alex whether this is a real gap or a deliberate simplification.
2. Nothing enforces the 72-hour hold expiry — `hold_expires_at` is a column, not a release job. Where does release happen: cron, a read-time check, or `pg_cron`? Migration 006 doesn't say.
3. Concurrent soft holds are allowed by design but invisible to a second salesperson — push on whether the UI needs a "holds pending" indicator, or whether Alex's volume is low enough it never collides.
