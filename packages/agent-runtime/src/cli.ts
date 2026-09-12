/**
 * The CLI.
 *
 *   npx tsx src/cli.ts run lead-to-proposal --provider auto
 *   npx tsx src/cli.ts providers
 *
 * Prints the trace tree, the event log, the state card and the approval the
 * run was stopped by. What it shows is the `AutomationRun` itself — the same
 * object M18-S04 renders — so if it looks right here it will look right there.
 */

import { leadToProposalAgent, LEAD_TO_PROPOSAL_INPUT } from './agents/lead-to-proposal';
import { loadEnvLocal } from './keys/dotenv';
import { EnvKeyStore, maskKey, ENV_BINDINGS } from './keys/keystore';
import { formatMoney } from './providers/pricing';
import { runAgent, type AgentRunResult } from './orchestrator/run';
import { createRuntime, type ProviderChoice } from './runtime';
import type { AutomationRun, TraceNode } from '@trainos/contract';

const AGENTS = { 'lead-to-proposal': leadToProposalAgent } as const;
type AgentName = keyof typeof AGENTS;

async function main(argv: string[]): Promise<number> {
  // The README tells people to put a key in `.env.local`, so read it before
  // anything asks `process.env` what is configured.
  const env = loadEnvLocal();

  const [command, ...rest] = argv;

  if (!command || command === 'help' || command === '--help') {
    printUsage();
    return 0;
  }

  if (command === 'providers') {
    printProviders(env.path);
    return 0;
  }

  if (command !== 'run') {
    console.error(`Unknown command: ${command}`);
    printUsage();
    return 1;
  }

  const agentName = (rest[0] ?? 'lead-to-proposal') as AgentName;
  const agent = AGENTS[agentName];
  if (!agent) {
    console.error(`Unknown agent: ${agentName}. Known: ${Object.keys(AGENTS).join(', ')}`);
    return 1;
  }

  const provider = (flag(rest, '--provider') ?? 'auto') as ProviderChoice;
  const runtime = createRuntime({ agentId: agent.id, provider });

  console.log(bold(`\nTrainOS agent runtime · ${agent.name}`));
  console.log(
    dim(
      runtime.usingMock
        ? '  provider: MockProvider (no live key found — set one in .env.local to use a real model)'
        : `  provider: ${runtime.registry.ids().join(', ')}`,
    ),
  );
  console.log(dim(`  orchestrator: ${agent.orchestrator}`));
  console.log('');

  const result = await runAgent({
    agent,
    router: runtime.router,
    tools: runtime.tools,
    input: LEAD_TO_PROPOSAL_INPUT,
    runId: 'run_4821',
    runRef: '#4821',
  });

  printRun(result);
  return result.run.status === 'FAILED' ? 1 : 0;
}

/* ------------------------------------------------------------------ *
 * Output
 * ------------------------------------------------------------------ */

function printRun(result: AgentRunResult): void {
  const run = result.run;

  console.log(bold('Trace'));
  printTree(run, null, '  ');
  console.log('');

  console.log(bold('Events'));
  for (const event of run.events ?? []) {
    console.log(`  ${pad(event.type, 16)} ${dim(summariseDetail(event.detail))}`);
  }
  if ((run.events ?? []).length === 0) console.log(dim('  (none)'));
  console.log('');

  const card = run.stateCard;
  if (card) {
    console.log(bold('State card'));
    console.log(`  goal        ${card.goal}`);
    console.log('  plan');
    for (const step of card.plan) {
      console.log(`    ${step.n}. ${pad(`[${step.status}]`, 10)} ${step.label}`);
    }
    if (card.decisions.length) {
      console.log('  decisions');
      for (const decision of card.decisions) console.log(`    - ${decision}`);
    }
    if (card.openQuestions.length) {
      console.log('  open questions');
      for (const question of card.openQuestions) console.log(`    - ${question}`);
    }
    console.log(`  records     ${card.recordPointers.join(', ') || '(none)'}`);
    console.log(
      `  budgets     ${card.budgets.tokens.used} / ${card.budgets.tokens.limit} tokens · ` +
        `${formatMoney(card.budgets.cost.used)} / ${formatMoney(card.budgets.cost.limit)}`,
    );
    console.log('');
  }

  console.log(bold('Run'));
  console.log(`  ${pad('status', 14)} ${run.status}${run.outcome ? ` · ${run.outcome}` : ''}`);
  console.log(`  ${pad('duration', 14)} ${run.durationMs} ms`);
  console.log(`  ${pad('tokens', 14)} ${run.tokens.in} in / ${run.tokens.out} out`);
  console.log(`  ${pad('cost', 14)} ${formatMoney(run.cost)}`);
  console.log(`  ${pad('cache hit', 14)} ${((run.cacheHitRate ?? 0) * 100).toFixed(0)}%`);
  console.log(`  ${pad('tiers used', 14)} ${(run.tiersUsed ?? []).join(', ')}`);
  console.log('');

  if (result.approval && result.haltedBy) {
    console.log(bold('Halted at the policy gate'));
    console.log(`  ${pad('policy', 14)} ${result.haltedBy.policyId}`);
    console.log(`  ${pad('approval', 14)} ${result.approval.ref}`);
    console.log(`  ${pad('approver', 14)} ${result.approval.approverRole}` +
      (result.approval.assignedTo ? ` · ${result.approval.assignedTo.name}` : ''));
    console.log(`  ${pad('sla due', 14)} ${result.approval.slaDueAt}`);
    console.log(`  ${pad('reason', 14)} ${result.haltedBy.reason}`);
    console.log('');
    console.log(dim('  Nothing was sent. The approval is waiting on M02-S01.'));
    console.log('');
  }

  if (result.jury?.ran) {
    console.log(bold(`Jury · ${result.jury.trigger} · ${result.jury.reached ? 'quorum reached' : 'NO QUORUM'}`));
    for (const vote of result.jury.votes) {
      console.log(
        `  ${pad(vote.tier, 10)} ${pad(vote.model, 22)} ${vote.agrees ? 'agrees' : `dissents — ${vote.dissent}`}`,
      );
    }
    console.log('');
  }

  console.log(bold('Provenance'));
  console.log(
    `  ${result.provenance.origin} · confidence ${result.provenance.confidence ?? '—'} · ` +
      `${result.provenance.tier ?? '—'} ${result.provenance.model ?? ''} (${result.provenance.provider ?? '—'})`,
  );
  console.log('');
}

function printTree(run: AutomationRun, parentId: string | null, indent: string): void {
  const children = (run.nodes ?? []).filter((n) => n.parentId === parentId);
  children.forEach((node, index) => {
    const last = index === children.length - 1;
    console.log(`${indent}${last ? '└─ ' : '├─ '}${describeNode(node)}`);
    printTree(run, node.id, `${indent}${last ? '   ' : '│  '}`);
  });
}

function describeNode(node: TraceNode): string {
  const bits: string[] = [pad(node.name, 22)];
  bits.push(pad(node.kind, 13));
  bits.push(pad(node.status, 8));
  if (node.tier) bits.push(pad(node.tier, 9));
  if (node.model) bits.push(pad(node.model, 18));
  if (node.tokens) bits.push(pad(`${node.tokens.in}/${node.tokens.out} tok`, 14));
  if (node.cost) bits.push(pad(formatMoney(node.cost), 12));
  if (node.durationMs !== undefined) bits.push(`${node.durationMs}ms`);
  if (node.haltedBy) bits.push(`⛔ ${node.haltedBy.policyId} → ${node.haltedBy.approvalRequestRef}`);
  return bits.join(' ');
}

function summariseDetail(detail: Record<string, unknown>): string {
  return Object.entries(detail)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${short(value)}`)
    .join(' ');
}

function short(value: unknown): string {
  if (Array.isArray(value)) return `[${value.length}]`;
  if (value && typeof value === 'object') return JSON.stringify(value).slice(0, 60);
  return String(value);
}

function printProviders(envPath?: string): void {
  const store = new EnvKeyStore();
  console.log(bold('\nProvider keys\n'));
  if (envPath) console.log(dim(`  read from ${envPath}\n`));
  for (const binding of ENV_BINDINGS) {
    const ref = store.list().find((r) => r.id === binding.env);
    const key = ref ? store.get(ref) : undefined;
    console.log(
      `  ${pad(binding.env, 30)} ${pad(binding.provider, 20)} ${key ? maskKey(key) : dim('NOT_SET')}`,
    );
  }
  console.log('');
  console.log(dim('  Set any one of these in .env.local at the repo root. Any key works.'));
  console.log('');
}

function printUsage(): void {
  console.log(
    [
      '',
      bold('TrainOS agent runtime'),
      '',
      '  tsx src/cli.ts run lead-to-proposal [--provider auto|anthropic|openrouter|deepseek|mock]',
      '  tsx src/cli.ts providers',
      '',
      '  --provider auto   use the first configured key, or the mock if there is none',
      '  --provider mock   force the scripted provider; no network, no key',
      '',
    ].join('\n'),
  );
}

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

function flag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

const useColour = process.stdout.isTTY === true && process.env['NO_COLOR'] === undefined;
const bold = (s: string): string => (useColour ? `[1m${s}[0m` : s);
const dim = (s: string): string => (useColour ? `[2m${s}[0m` : s);

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error('\nRun failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
