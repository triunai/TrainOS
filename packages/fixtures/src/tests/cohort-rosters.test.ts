/**
 * §8 · every cohort that ran has the people who were in the room.
 *
 * `/training/participants` fans out over every engagement, so a tree where
 * only ENG-0231 carried a roster read "30 participants · 9 cohorts" — true,
 * and wrong about the product: eight cohorts that had run appeared to have
 * trained nobody.
 *
 * These pin the three things that make the seeded rosters data rather than
 * filler, because each is an invariant a reseeding could break silently.
 *
 * A separate file rather than a block in `screens.test.ts`: several agents
 * work this tree at once and a new file cannot collide with theirs.
 */

import { describe, expect, it } from "vitest";
import { createFixtureClient } from "../index";
import { engagements } from "../data/engagements";
import { programmes } from "../data/programmes";

const api = createFixtureClient({ latencyMs: 0 });

/** Delivered or closed: the days have run, so there were people in the room. */
const HAS_RUN = new Set(["DELIVERED", "CLOSED", "IN_DELIVERY"]);

describe("cohort rosters", () => {
  it("gives every cohort that has run a roster the size its own metric claims", async () => {
    const run = engagements.filter((engagement) => HAS_RUN.has(engagement.status));
    expect(run.length).toBeGreaterThan(1);

    for (const engagement of run) {
      const roster = await api.getEngagementParticipants(engagement.ref);
      expect(roster.data.length, `${engagement.ref} ${engagement.title}`).toBe(
        engagement.metrics.participants,
      );
    }
  });

  /* Nobody has attended a course that has not happened, and a registration
     list for a cancelled engagement would be a claim about people who were
     stood down. */
  it("gives no roster to a cohort that has not run", async () => {
    const notRun = engagements.filter((engagement) => !HAS_RUN.has(engagement.status));
    expect(notRun.length).toBeGreaterThan(0);

    for (const engagement of notRun) {
      const roster = await api.getEngagementParticipants(engagement.ref);
      expect(roster.data, `${engagement.ref} ${engagement.status}`).toHaveLength(0);
    }
  });

  it("names each person once, at one client, on one cohort", async () => {
    const refs = new Set<string>();
    for (const engagement of engagements) {
      const roster = await api.getEngagementParticipants(engagement.ref);
      for (const person of roster.data) {
        expect(refs.has(person.ref), `${person.ref} appears twice`).toBe(false);
        refs.add(person.ref);
        expect(person.engagementRef).toBe(engagement.ref);
        expect(person.email).toContain("@");
      }
    }
  });

  /**
   * `metrics.attended` is the people who made it through EVERY day, not the
   * best day — which is why it is the minimum across the sheets rather than
   * the last one. ENG-0231 is the case that distinguishes them: 29 present on
   * day 1, 28 on day 2 after a work conflict, and the metric says 28.
   */
  it("reconciles each cohort's attendance sheets with its attended metric", async () => {
    for (const engagement of engagements) {
      const days: number[] = [];
      for (const day of [1, 2] as const) {
        try {
          const sheet = await api.getAttendance(engagement.ref, day);
          days.push(sheet.summary.presentPm);
        } catch {
          /* No sheet for that day. Cohorts that never ran have none at all. */
        }
      }
      if (days.length === 0) continue;
      expect(Math.min(...days), `${engagement.ref} ${engagement.title}`).toBe(
        engagement.metrics.attended,
      );
    }
  });

  it("locks every sheet whose cohort has already delivered", async () => {
    for (const engagement of engagements.filter((row) => HAS_RUN.has(row.status))) {
      const sheet = await api.getAttendance(engagement.ref, 1);
      expect(sheet.summary.registered).toBe(engagement.metrics.participants);
      expect(sheet.rows).toHaveLength(engagement.metrics.participants);
      /* Signatures are two per attendee — morning and afternoon. */
      expect(sheet.summary.signaturesExpected).toBe(engagement.metrics.participants * 2);
    }
  });
});

/**
 * Ruling R17 · the roll-up and the per-person records agree about certificates.
 *
 * Three engagements carried `CERTIFICATES_ISSUED` as done while no participant
 * record carried a `certificateId`. The claim packet cites the PARTICIPANT
 * records, which makes that the expensive direction to be wrong in — HRD Corp
 * reads the per-person artefact, not the checklist.
 */
describe("certificates", () => {
  const issuedFor = (engagement: (typeof engagements)[number]) =>
    engagement.checklist.find((item) => item.key === "CERTIFICATES_ISSUED")?.done === true;

  it("gives every present participant a certificate when the cohort says it issued them", async () => {
    const issued = engagements.filter(issuedFor);
    expect(issued.length).toBeGreaterThan(0);

    for (const engagement of issued) {
      const roster = await api.getEngagementParticipants(engagement.ref);
      expect(roster.data.length, `${engagement.ref} has no roster`).toBeGreaterThan(0);

      const sheet = await api.getAttendance(engagement.ref, 2);
      const present = new Set(
        sheet.rows.filter((row) => row.am.present && row.pm.present).map((row) => row.participantRef),
      );

      for (const participant of roster.data) {
        if (!present.has(participant.ref)) continue;
        expect(participant.certificateId, `${participant.ref} attended and has none`).toBeTruthy();
        expect(participant.certificateIssuedAt, `${participant.ref} has no issue date`).toBeTruthy();
      }
    }
  });

  /* A certificate certifies attendance. Issuing one to somebody who was not
     there is the failure an auditor looks for, so it is asserted rather than
     assumed. */
  it("gives a certificate to nobody who was absent, and to nobody on a cohort that issued none", async () => {
    for (const engagement of engagements) {
      const roster = await api.getEngagementParticipants(engagement.ref);
      const withCertificate = roster.data.filter((person) => person.certificateId);

      if (!issuedFor(engagement)) {
        expect(withCertificate, `${engagement.ref} issued none`).toHaveLength(0);
        continue;
      }
      expect(withCertificate.length).toBe(engagement.metrics.attended);
    }
  });

  /* `certificateId` is exempt from the referential-integrity sweep, because it
     numbers a document that lives outside this dataset rather than pointing at
     a record inside it. Uniqueness is the thing that sweep would otherwise
     have caught, so it is caught here. */
  it("numbers every certificate once across the whole dataset", async () => {
    const seen = new Set<string>();
    for (const engagement of engagements) {
      const roster = await api.getEngagementParticipants(engagement.ref);
      for (const person of roster.data) {
        if (!person.certificateId) continue;
        expect(seen.has(person.certificateId), `${person.certificateId} issued twice`).toBe(false);
        seen.add(person.certificateId);
      }
    }
    expect(seen.size).toBeGreaterThan(0);
  });

  it("dates every certificate after the cohort finished delivering", async () => {
    for (const engagement of engagements.filter(issuedFor)) {
      const roster = await api.getEngagementParticipants(engagement.ref);
      const lastDay = engagement.dates.at(-1);
      expect(lastDay, `${engagement.ref} has no delivery dates`).toBeDefined();
      for (const person of roster.data) {
        if (!person.certificateIssuedAt) continue;
        expect(
          person.certificateIssuedAt >= (lastDay as string),
          `${person.certificateId} predates the delivery`,
        ).toBe(true);
      }
    }
  });
});

/**
 * The profitability screen's unhappy path has to exist in the data.
 *
 * Every realised margin in the seed used to sit above the rate card's 0.35, so
 * the below-floor banner and the danger chip were only ever proven ABSENT —
 * a control nothing had exercised. One engagement is under it now, and this is
 * what stops a later reseeding quietly retiring that path.
 */
describe("realised margin against the floor", () => {
  const floorFor = (programmeRef: string) =>
    programmes.find((p) => p.ref === programmeRef || p.id === programmeRef)?.floorMarginRate ?? 0.35;

  it("has at least one delivered engagement below its programme's margin floor", () => {
    const below = engagements.filter(
      (engagement) =>
        engagement.status !== "CANCELLED" &&
        engagement.finance !== undefined &&
        engagement.finance.realisedMarginRate < floorFor(engagement.programmeRef),
    );
    expect(below.length).toBeGreaterThan(0);
  });

  /* And not so many that below-floor reads as the normal case. A screen where
     most rows are flagged says nothing, which is the same defect as one where
     none are. */
  it("keeps below-floor the exception rather than the rule", () => {
    const priced = engagements.filter(
      (engagement) => engagement.status !== "CANCELLED" && engagement.finance !== undefined,
    );
    const below = priced.filter(
      (engagement) => engagement.finance!.realisedMarginRate < floorFor(engagement.programmeRef),
    );
    expect(below.length).toBeLessThan(priced.length / 2);
  });
});
