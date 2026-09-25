import type { HandlerMap } from "../queue/registry";

/**
 * Assessments are request-driven (the quiz page submits, an operator renders
 * the report), so no task type is handled here. The empty map keeps worker
 * composition uniform: every feature module exports `handlers`.
 */
export const handlers: HandlerMap = {};
