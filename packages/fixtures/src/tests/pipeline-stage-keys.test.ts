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
