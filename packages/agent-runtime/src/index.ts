/**
 * @trainos/agent-runtime — a provider-agnostic agent runtime.
 *
 * Bring your own key. The runtime resolves whatever you have configured —
 * Anthropic, OpenRouter, DeepSeek, or any OpenAI-compatible endpoint — runs a
 * real orchestrator against it, and emits a trace in exactly the shape
 * `GET /v1/runs/{id}` returns, so M18-S04 renders genuine agent output.
 *
 * Every tool call goes through a `ToolAdapter` over fixture data. Nothing in
 * this package can reach a client.
 */

export * from './keys/keystore';
export * from './keys/dotenv';
export * from './providers';
export * from './routing';
export * from './tools';
export * from './orchestrator';

export { LocalFixtureClient, createLocalFixtureClient, APV_01_THRESHOLD, toMyt } from './fixtures/local-client';
export type { LocalFixtureClientOptions } from './fixtures/local-client';

export { leadToProposalAgent, LEAD_TO_PROPOSAL_INPUT } from './agents/lead-to-proposal';
export { createDemoMockProvider, demoResponder } from './agents/demo-script';

export { createRuntime, type RuntimeOptions, type Runtime } from './runtime';
