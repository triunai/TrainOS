/**
 * Key storage — the one thing this package deliberately does not do.
 *
 * The runtime never reads `process.env` for a key outside {@link EnvKeyStore},
 * never writes a key anywhere, and never puts one in a log line, an error
 * message or a trace. Everything above this file receives a {@link KeyStore}
 * and asks it for a key by reference. In production that reference resolves
 * against the §17 `/v1/ai/providers` record; here it resolves against the
 * environment. Same interface, different implementation, no code change.
 */

import type { ProviderId } from '../providers/types';

/** A named key. The secret itself is only ever returned by {@link KeyStore.get}. */
export interface KeyRef {
  /** Stable id, e.g. `ANTHROPIC_API_KEY` or the §17 `prv_anthropic`. */
  id: string;
  /** Which adapter this key drives. */
  provider: ProviderId;
  /** Optional label for the provider matrix and CLI output. */
  label?: string;
  /**
   * Base URL override. Required for `openai-compatible`, optional elsewhere —
   * it is how a self-hosted or proxied endpoint is plugged in without code.
   */
  baseUrl?: string;
}

export interface KeyStore {
  /** Every key this store can serve, without the secrets. */
  list(): KeyRef[];
  /** The secret for a reference, or `undefined` when it is not configured. */
  get(ref: KeyRef): string | undefined;
}

/* ------------------------------------------------------------------ *
 * Masking
 * ------------------------------------------------------------------ */

/**
 * `sk-ant-api03-abcd…9a41` → `sk-ant-••••••••••••9a41`.
 *
 * Matches the §17 `ProviderKey.maskedKey` example exactly, so the same helper
 * serves the CLI here and the M20-S21 provider card later. A key too short to
 * mask meaningfully is replaced wholesale rather than partly revealed.
 */
export function maskKey(key: string | undefined): string {
  if (!key) return 'NOT_SET';
  const trimmed = key.trim();
  if (trimmed.length < 12) return '••••••••••••';
  const prefixMatch = /^(sk-[a-z]+-|sk-)/.exec(trimmed);
  const prefix = prefixMatch?.[1] ?? '';
  const tail = trimmed.slice(-4);
  return `${prefix}••••••••••••${tail}`;
}

/* ------------------------------------------------------------------ *
 * Provider detection
 * ------------------------------------------------------------------ */

/**
 * Guess the provider from the key's own prefix.
 *
 * Anthropic and OpenRouter both stamp their keys, so those are certain.
 * DeepSeek issues a bare `sk-` followed by hex with nothing to distinguish it
 * from a plain OpenAI key, so a bare `sk-` returns `undefined` rather than a
 * guess — {@link EnvKeyStore} carries the provider on the reference instead,
 * which is where that knowledge actually lives.
 */
export function detectProviderFromKey(key: string): ProviderId | undefined {
  const k = key.trim();
  if (k.startsWith('sk-ant-')) return 'anthropic';
  if (k.startsWith('sk-or-')) return 'openrouter';
  return undefined;
}

/* ------------------------------------------------------------------ *
 * Environment-backed store
 * ------------------------------------------------------------------ */

/** One environment variable the store knows how to read. */
interface EnvBinding {
  env: string;
  provider: ProviderId;
  label: string;
  /** Env var holding a base-URL override, for the generic adapter. */
  baseUrlEnv?: string;
  defaultBaseUrl?: string;
}

/**
 * The variables the runtime looks for, in preference order.
 *
 * Order matters only for `resolveProvider('auto')`: the first configured key
 * wins. Anthropic leads because the demo's STRONG tiers are Claude models.
 */
export const ENV_BINDINGS: readonly EnvBinding[] = [
  { env: 'ANTHROPIC_API_KEY', provider: 'anthropic', label: 'Anthropic direct' },
  {
    env: 'OPENROUTER_API_KEY',
    provider: 'openrouter',
    label: 'OpenRouter',
    baseUrlEnv: 'OPENROUTER_BASE_URL',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
  },
  {
    env: 'DEEPSEEK_API_KEY',
    provider: 'deepseek',
    label: 'DeepSeek',
    baseUrlEnv: 'DEEPSEEK_BASE_URL',
    defaultBaseUrl: 'https://api.deepseek.com',
  },
  {
    env: 'OPENAI_COMPATIBLE_API_KEY',
    provider: 'openai-compatible',
    label: 'OpenAI-compatible endpoint',
    baseUrlEnv: 'OPENAI_COMPATIBLE_BASE_URL',
  },
] as const;

/**
 * The ambient environment, or nothing at all.
 *
 * `process` does not exist in a browser, and this package's default entry is
 * imported by the web app to run the mock agent on M18-S04. Reading
 * `process.env` as a constructor default threw a `ReferenceError` before the
 * caller could pass their own environment — so the guard lives here rather
 * than in every call site. No ambient environment means no keys, which sends
 * the runtime to its mock provider: the correct answer in a browser.
 */
function ambientEnv(): Record<string, string | undefined> {
  if (typeof process === 'undefined') return {};
  return process.env ?? {};
}

/**
 * Reads keys from the ambient environment and nothing else.
 *
 * A variable that is absent or blank is simply not offered, so `list()` is the
 * honest answer to "what can this machine actually call".
 */
export class EnvKeyStore implements KeyStore {
  private readonly env: Record<string, string | undefined>;

  constructor(env?: Record<string, string | undefined>) {
    this.env = env ?? ambientEnv();
  }

  list(): KeyRef[] {
    const refs: KeyRef[] = [];
    for (const binding of ENV_BINDINGS) {
      const value = this.env[binding.env];
      if (!value || value.trim() === '') continue;
      const baseUrl = binding.baseUrlEnv
        ? (this.env[binding.baseUrlEnv] ?? binding.defaultBaseUrl)
        : binding.defaultBaseUrl;
      refs.push({
        id: binding.env,
        provider: binding.provider,
        label: binding.label,
        baseUrl,
      });
    }
    return refs;
  }

  get(ref: KeyRef): string | undefined {
    const value = this.env[ref.id];
    return value && value.trim() !== '' ? value.trim() : undefined;
  }
}

/** A store with nothing in it. The runtime then falls back to `MockProvider`. */
export class EmptyKeyStore implements KeyStore {
  list(): KeyRef[] {
    return [];
  }
  get(): undefined {
    return undefined;
  }
}

/** A store built from an explicit map. Used by tests and by embedders. */
export class StaticKeyStore implements KeyStore {
  private readonly entries: Map<string, { ref: KeyRef; key: string }>;

  constructor(entries: Array<{ ref: KeyRef; key: string }>) {
    this.entries = new Map(entries.map((e) => [e.ref.id, e]));
  }

  list(): KeyRef[] {
    return [...this.entries.values()].map((e) => e.ref);
  }

  get(ref: KeyRef): string | undefined {
    return this.entries.get(ref.id)?.key;
  }
}
