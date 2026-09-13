/**
 * Per-tenant BYOK keys, read through an RPC.
 *
 * Two rules this file exists to enforce.
 *
 * 1. **Never the anon key.** The worker's only database identity is
 *    `service_role` over a direct connection; the anon key is a browser
 *    credential and appears nowhere in this app.
 * 2. **Never a key in a log, an error or a trace.** The secret leaves this
 *    module only through {@link TenantKeyResolver.get} and through the
 *    {@link KeyStore} handed to the agent runtime. `toString`, `toJSON` and
 *    the logger's redaction pass all cover the paths where one would otherwise
 *    escape.
 *
 * **What does not exist yet.** Migrations 001-012 define
 * `core.provider_key_status` (`003:302`) and nothing else: there is no table
 * of tenant provider keys, no Vault reference column, and no function that
 * returns a decrypted secret. So the RPC this resolver calls is named by
 * configuration and defaults to `app.provider_key_for_tenant(uuid, text)`,
 * which a later migration must supply. With it absent the resolver reports no
 * keys, and an LLM-shaped job fails with a reason that says exactly that
 * rather than silently running against the process environment.
 */

import type { KeyRef, KeyStore, ProviderId } from "@trainos/agent-runtime";
import type { SqlTransport } from "./transport";
import type { TenantKeys } from "./jobs/types";

/** What the BYOK RPC is expected to return, one row per configured provider. */
export interface ProviderKeyRow {
  provider: string;
  api_key: string;
  base_url?: string | null;
  label?: string | null;
}

export interface TenantKeyResolverOptions {
  transport: SqlTransport;
  /**
   * `schema.function` taking `(p_tenant_id uuid, p_provider text)` and
   * returning `SETOF (provider, api_key, base_url, label)`. A NULL provider
   * asks for every key the tenant has.
   */
  rpc?: string;
  /** How long a resolved key is reused before the RPC is asked again. */
  ttlMs?: number;
  now?: () => number;
}

export const DEFAULT_BYOK_RPC = "app.provider_key_for_tenant";

interface CacheEntry {
  rows: ProviderKeyRow[];
  expiresAt: number;
}

/**
 * Reads a tenant's provider keys and caches them briefly.
 *
 * The cache is per tenant and short-lived on purpose: a revoked key that stays
 * usable for an hour is a security property nobody agreed to, and an RPC per
 * model call is a cost nobody agreed to either.
 */
export class TenantKeyResolver {
  private readonly transport: SqlTransport;
  private readonly rpc: string;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(opts: TenantKeyResolverOptions) {
    this.transport = opts.transport;
    this.rpc = opts.rpc ?? DEFAULT_BYOK_RPC;
    this.ttlMs = opts.ttlMs ?? 60_000;
    this.now = opts.now ?? Date.now;
    assertQualifiedFunction(this.rpc);
  }

  /** Every provider key configured for one tenant. */
  async rows(tenantId: string): Promise<ProviderKeyRow[]> {
    const hit = this.cache.get(tenantId);
    if (hit && hit.expiresAt > this.now()) return hit.rows;
    const rows = await this.transport.query<ProviderKeyRow>(
      `SELECT provider, api_key, base_url, label FROM ${this.rpc}($1, $2)`,
      [tenantId, null],
    );
    const usable = rows.filter(
      (row) => typeof row.api_key === "string" && row.api_key.trim() !== "",
    );
    this.cache.set(tenantId, { rows: usable, expiresAt: this.now() + this.ttlMs });
    return usable;
  }

  /** Drop one tenant's cached keys, e.g. after a provider rejects one. */
  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  /** The handler-facing view, bound to one tenant. */
  forTenant(tenantId: string): TenantKeys {
    return {
      get: async (provider: string) => {
        const rows = await this.rows(tenantId);
        return rows.find((row) => row.provider === provider)?.api_key;
      },
      list: async () => (await this.rows(tenantId)).map((row) => row.provider),
    };
  }

  /**
   * A {@link KeyStore} the agent runtime can use.
   *
   * `KeyStore.get` is synchronous and the RPC is not, so the rows are loaded
   * once before the run and served from that snapshot. A run therefore holds
   * one consistent set of keys from start to finish, which is also the right
   * answer for a multi-slice run: swapping a key mid-run would change what the
   * trace means.
   */
  async keyStoreFor(tenantId: string): Promise<KeyStore> {
    const rows = await this.rows(tenantId);
    const refs = new Map<string, { ref: KeyRef; key: string }>();
    for (const row of rows) {
      const ref: KeyRef = {
        id: `${tenantId}:${row.provider}`,
        provider: row.provider as ProviderId,
        label: row.label ?? row.provider,
        ...(row.base_url ? { baseUrl: row.base_url } : {}),
      };
      refs.set(ref.id, { ref, key: row.api_key });
    }
    return {
      list: () => [...refs.values()].map((entry) => entry.ref),
      get: (ref: KeyRef) => refs.get(ref.id)?.key,
    };
  }
}

/**
 * The RPC name is interpolated into SQL because a function name is an
 * identifier, so it is checked to be exactly `schema.name` first. Anything
 * else — a quote, a space, a semicolon — is refused rather than escaped.
 */
export function assertQualifiedFunction(name: string): void {
  if (!/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/i.test(name)) {
    throw new Error(
      `BYOK rpc must be a schema-qualified function name, got ${JSON.stringify(name)}`,
    );
  }
}
