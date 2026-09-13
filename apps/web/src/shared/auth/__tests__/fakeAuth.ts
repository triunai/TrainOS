import { vi } from "vitest";
import type { AuthPort, AuthUser } from "@/shared/api";

/**
 * An in-memory `AuthPort` standing in for supabase-js auth.
 *
 * Structural, like the transport double: it satisfies the port without a cast,
 * so a test drives the same provider code production runs. `signOut` behaves
 * as supabase-js does — clears the user and notifies every listener.
 */
export const ALEX: AuthUser = {
  id: "7b1c2f0e-0000-4000-8000-000000000001",
  email: "alex@example.my",
};

export function fakeAuth(initial: AuthUser | null, overrides: Partial<AuthPort> = {}): AuthPort {
  let user = initial;
  const listeners = new Set<(next: AuthUser | null) => void>();

  return {
    ready: vi.fn(async () => ({ error: null })),
    currentUser: vi.fn(async () => user),
    onChange: vi.fn((listener: (next: AuthUser | null) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    signInWithGoogle: vi.fn(async (_redirectTo: string) => ({ error: null })),
    refresh: vi.fn(async () => ({ error: null })),
    signOut: vi.fn(async () => {
      user = null;
      listeners.forEach((listener) => listener(null));
      return { error: null };
    }),
    ...overrides,
  };
}
