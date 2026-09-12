/**
 * @trainos/contract — the shared type surface derived from the TrainOS API
 * contract (API_CONTRACT.md §1–§18, with §18 "Supersedes" and DECISIONS.md
 * applied over the earlier text).
 *
 * Types only: no runtime code beyond enum value arrays, the endpoint table and
 * the canonical fixture ids. See README.md for the section map, the three
 * supersedes applied, and the fields the contract leaves without a source.
 */

export * from './envelope';
export * from './enums';
export * from './actions';
export * from './events';
export * from './endpoints';
export * from './fixtures-ids';

export * from './domain/shell';
export * from './domain/enquiries';
export * from './domain/organisations';
export * from './domain/proposals';
export * from './domain/approvals';
export * from './domain/engagements';
export * from './domain/hrdc-finance';
export * from './domain/agents';
export * from './domain/ai-ops';
export * from './domain/knowledge';
export * from './domain/client-portal';
