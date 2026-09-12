/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Canonical origin for share links, callbacks and absolute URLs. */
  readonly VITE_SITE_URL: string;
  /** Base URL of the TrainOS API, including the `/v1` path segment. */
  readonly VITE_API_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
