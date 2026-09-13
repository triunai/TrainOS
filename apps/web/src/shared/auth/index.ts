/**
 * The session layer. Supabase mode only; every export is inert in fixtures.
 *
 * Nothing here imports supabase-js. The client lives in `shared/api`, behind
 * the `AuthPort`, for the same reason the RPC client does.
 */
export { AuthProvider, type AuthProviderProps } from "./AuthProvider";
export { useAuth, type AuthContextValue, type SessionState } from "./authContext";
export { RequireSession } from "./RequireSession";
export {
  AUTH_CALLBACK_PATH,
  SIGN_IN_PATH,
  callbackUrl,
  safeReturnPath,
  signInHref,
  takeReturnPath,
} from "./returnPath";
