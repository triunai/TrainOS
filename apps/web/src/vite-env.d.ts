/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Canonical origin for share links, callbacks and absolute URLs. */
  readonly VITE_SITE_URL: string;
  /** Base URL of the TrainOS API, including the `/v1` path segment. */
  readonly VITE_API_BASE_URL: string;
  /**
   * Which client the data seam mounts: `fixtures` (default) or `supabase`.
   *
   * Optional, and the default is deliberately the safe one — a build that
   * forgets this variable serves the demo dataset rather than pointing a
   * half-configured app at a real tenant's data.
   */
  readonly VITE_API_MODE?: "fixtures" | "supabase";
  /** Supabase project URL. Required only when `VITE_API_MODE=supabase`. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase publishable (anon) key. Required only in `supabase` mode. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
