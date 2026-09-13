/**
 * The pipeline seam, pinned in both directions.
 *
 * CLAUDE.md: stage names and order render from pipeline configuration, never
 * hardcoded. That is about the printed word and the sequence, and it holds —
 * both still come from `GET /v1/config/pipelines`. It does not help a screen
 * that has to FIND one stage: `EngagementDetailPage` names `ATTENDANCE_LOCKED`
 * to put the lock date under the attendance metric, and when
 * `LifecycleStep.key` was `string` a server-side rename made that `find`
 * return undefined. The sub-line disappeared and nothing failed.
 *
 * R14: the durable fix is to pin the seam as a table duplicated verbatim on
 * both sides. The contract publishes `ENGAGEMENT_STAGE_KEYS` and
 * `DEAL_CHAIN_STAGE_KEYS`; this asserts the served configuration carries
 * exactly those keys, in that order. Rename a stage on either side and one of
 * these fails, which is the point — the assertion is what a reviewer would
 * otherwise have to remember to check (R11).
 */

import { describe, expect, it } from "vitest";
import {
  DEAL_CHAIN_STAGE_KEYS,
  ENGAGEMENT_STAGE_KEYS,
  OPPORTUNITY_STAGES,
  PIPELINE_OBJECTS,
  STAGE_OUTCOMES,
} from "@trainos/contract";
import { createFixtureClient } from "../index";

const api = createFixtureClient({ latencyMs: 0 });

describe("pipeline configuration against the contract's stage vocabularies", () => {
  it("serves a pipeline for every object the contract names", async () => {
    const served = await Promise.all(
      PIPELINE_OBJECTS.map(async (object) => (await api.getPipelineConfig(object)).object),
    );
    expect(served).toEqual([...PIPELINE_OBJECTS]);
  });

  it("carries the §8 engagement stages verbatim, in order", async () => {
    const config = await api.getPipelineConfig("ENGAGEMENT");
    expect(config.stages.map((stage) => stage.key)).toEqual([...ENGAGEMENT_STAGE_KEYS]);
  });

  it("carries the §5 deal-chain stages verbatim, in order", async () => {
    const config = await api.getPipelineConfig("DEAL_CHAIN");
    expect(config.stages.map((stage) => stage.key)).toEqual([...DEAL_CHAIN_STAGE_KEYS]);
  });

  it("carries the §12 opportunity stages verbatim, in order", async () => {
    const config = await api.getPipelineConfig("OPPORTUNITY");
    expect(config.stages.map((stage) => stage.key)).toEqual([...OPPORTUNITY_STAGES]);
  });

  it("gives every stage an order that matches its position, so the client never sorts", async () => {
    for (const object of PIPELINE_OBJECTS) {
      const config = await api.getPipelineConfig(object);
      expect(config.stages.map((stage) => stage.order)).toEqual(
        config.stages.map((_, index) => index + 1),
      );
    }
  });

  it("labels every stage, because the screen prints the label and never the key", async () => {
    for (const object of PIPELINE_OBJECTS) {
      const config = await api.getPipelineConfig(object);
      for (const stage of config.stages) expect(stage.label.trim()).not.toBe("");
    }
  });

  it("keeps ATTENDANCE_LOCKED in the engagement pipeline, which one screen resolves by name", async () => {
    const config = await api.getPipelineConfig("ENGAGEMENT");
    expect(config.stages.map((stage) => stage.key)).toContain("ATTENDANCE_LOCKED");
  });
});

/**
 * §5 / §8 ruled R16 · which stages END a pipeline, and which way.
 *
 * `PipelineStage` carried key, label and order, so the sales screens could not
 * tell WON from LOST and hedged to "across the book" where they meant "in
 * play", and a chain computed from `order` alone would put LOST after WON —
 * because LOST is simply the last row.
 *
 * The asymmetry these assert is deliberate and is the thing a reviewer would
 * otherwise have to remember. Only OPPORTUNITY has a negative terminal,
 * because only OPPORTUNITY has a stage for losing: an engagement that falls
 * over is `status: CANCELLED`, which is the record's state rather than a rung
 * of its delivery ladder, and §8 lists exactly nine stages with no tenth.
 */
describe("pipeline stage outcomes", () => {
  it("ends every pipeline somewhere, and only at the end", async () => {
    for (const object of PIPELINE_OBJECTS) {
      const config = await api.getPipelineConfig(object);
      const terminals = config.stages.filter((stage) => stage.terminal);
      expect(terminals.length, `${object} has no terminal stage`).toBeGreaterThan(0);

      /* A terminal stage cannot be followed by a non-terminal one, or the
         chain continues past its own ending. */
      const firstTerminal = config.stages.findIndex((stage) => stage.terminal);
      for (const stage of config.stages.slice(firstTerminal)) {
        expect(stage.terminal, `${object}/${stage.key} follows a terminal stage`).toBe(true);
      }
    }
  });

  it("gives an outcome only to a terminal stage", async () => {
    for (const object of PIPELINE_OBJECTS) {
      const config = await api.getPipelineConfig(object);
      for (const stage of config.stages) {
        if (stage.outcome !== undefined) {
          expect(stage.terminal, `${object}/${stage.key} has an outcome but is not terminal`).toBe(
            true,
          );
        }
      }
    }
  });

  it("names at most one winning and one losing stage per pipeline", async () => {
    for (const object of PIPELINE_OBJECTS) {
      const config = await api.getPipelineConfig(object);
      for (const outcome of STAGE_OUTCOMES) {
        const matching = config.stages.filter((stage) => stage.outcome === outcome);
        expect(matching.length, `${object} has ${matching.length} ${outcome} stages`).toBeLessThan(2);
      }
    }
  });

  /* The pipeline the sales screens read. Both outcomes, so "in play" is
     computable: the open work is the stages with no outcome. */
  it("gives the opportunity pipeline both a won and a lost stage", async () => {
    const config = await api.getPipelineConfig("OPPORTUNITY");
    expect(config.stages.find((stage) => stage.outcome === "WON")?.key).toBe("WON");
    expect(config.stages.find((stage) => stage.outcome === "LOST")?.key).toBe("LOST");
    expect(config.stages.filter((stage) => !stage.outcome).every((stage) => !stage.terminal)).toBe(
      true,
    );
  });

  /* The case the pair of fields exists for, and the reason `outcome` is
     optional rather than required on a terminal stage: these two end their
     pipeline without winning or losing anything, because the winning already
     happened upstream. */
  it("ends delivery and the deal chain with no outcome at all", async () => {
    for (const [object, key] of [
      ["ENGAGEMENT", "PAID"],
      ["DEAL_CHAIN", "DELIVERY"],
    ] as const) {
      const config = await api.getPipelineConfig(object);
      const last = config.stages.find((stage) => stage.key === key);
      expect(last?.terminal).toBe(true);
      expect(last?.outcome).toBeUndefined();
    }
  });
});
