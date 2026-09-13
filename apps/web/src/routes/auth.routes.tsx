import { lazy, Suspense } from "react";
import { apiMode } from "@/shared/api";
import { AUTH_CALLBACK_PATH, SIGN_IN_PATH } from "@/shared/auth";
import { LoadingState } from "@/shared/components/states";
import type { PublicRoute } from "./portal.routes";

/**
 * The account routes, mounted OUTSIDE the principal layout because they are
 * what a person sees before there is a principal.
 *
 * Supabase mode only. In fixtures the identity is the fixture principal and
 * there is nothing to sign in to, so these paths do not exist and fall through
 * to the shell's not-found page exactly as they did before.
 */

const SignInPage = lazy(() =>
  import("@/pages/SignInPage").then((module) => ({ default: module.SignInPage })),
);

const AuthCallbackPage = lazy(() =>
  import("@/pages/AuthCallbackPage").then((module) => ({ default: module.AuthCallbackPage })),
);

export const authRoutes: PublicRoute[] =
  apiMode() === "supabase"
    ? [
        {
          path: SIGN_IN_PATH,
          label: "Sign in",
          element: (
            <Suspense fallback={<LoadingState label="Loading sign-in" />}>
              <SignInPage />
            </Suspense>
          ),
        },
        {
          path: AUTH_CALLBACK_PATH,
          label: "Finishing sign-in",
          element: (
            <Suspense fallback={<LoadingState label="Finishing sign-in" />}>
              <AuthCallbackPage />
            </Suspense>
          ),
        },
      ]
    : [];
