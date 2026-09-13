/**
 * Where a person was going before sign-in interrupted them.
 *
 * The path rides from the guard to the sign-in page in `?next=`, and from the
 * sign-in page to the callback in SESSION STORAGE — not in the OAuth
 * `redirectTo`. Supabase matches `redirectTo` against the project's Redirect
 * URLs allow-list, and a query string on the callback URL is one more thing
 * that has to match; the callback URL stays a constant so the allow-list entry
 * in `docs/deploy/google-auth.md` is a constant too. Session storage survives
 * the round trip to Google in the same tab and dies with it.
 */

export const SIGN_IN_PATH = "/sign-in";
export const AUTH_CALLBACK_PATH = "/auth/callback";

const STORAGE_KEY = "trainos.auth.returnTo";

/**
 * An in-app path, or `null`.
 *
 * `next` is attacker-controlled — anyone can mail a sign-in link — so only a
 * same-origin absolute PATH is accepted. `//evil.example` and `/\evil.example`
 * are protocol-relative to a browser and would leave the app; the two auth
 * paths themselves would loop.
 */
export function safeReturnPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || !raw.startsWith("/")) return null;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return null;
  const pathname = raw.split(/[?#]/, 1)[0];
  if (pathname === SIGN_IN_PATH || pathname === AUTH_CALLBACK_PATH) return null;
  return raw;
}

/** The guard's redirect: the sign-in page, carrying where the reader was. */
export function signInHref(path: string): string {
  const next = safeReturnPath(path);
  return next === null || next === "/"
    ? SIGN_IN_PATH
    : `${SIGN_IN_PATH}?next=${encodeURIComponent(next)}`;
}

export function rememberReturnPath(path: string | null): void {
  try {
    const safe = safeReturnPath(path);
    if (safe === null) window.sessionStorage.removeItem(STORAGE_KEY);
    else window.sessionStorage.setItem(STORAGE_KEY, safe);
  } catch {
    /* Blocked storage costs the deep link, not the sign-in. */
  }
}

/** Read once and forget, so a later sign-in does not replay an old path. */
export function takeReturnPath(): string | null {
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    window.sessionStorage.removeItem(STORAGE_KEY);
    return safeReturnPath(stored);
  } catch {
    return null;
  }
}

/**
 * The OAuth `redirectTo`: THIS origin's callback, always.
 *
 * Deliberately not `VITE_SITE_URL`. PKCE writes its code verifier to the
 * storage of the origin that STARTED the sign-in, and only that origin can
 * finish it. A build whose `VITE_SITE_URL` names the Render host, opened on
 * localhost, would send Google's code to Render, where no verifier exists, and
 * every sign-in would fail at the exchange. The current origin is the one value
 * that is correct on every host the same bundle is served from.
 */
export function callbackUrl(): string {
  return `${window.location.origin}${AUTH_CALLBACK_PATH}`;
}
