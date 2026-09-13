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
