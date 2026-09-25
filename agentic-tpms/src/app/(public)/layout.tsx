import type { ReactNode } from "react";
import { env } from "@/server/env";

export const dynamic = "force-dynamic";

/**
 * FORKED FROM TrainOS kit/ExternalMinimalShell — the participant-facing frame.
 * No navigation, no operator chrome: a trainee on a factory-floor phone behind
 * an MDM sees the provider's name, one card and nothing to log into.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  const provider = env().TPMS_PROVIDER_NAME;
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="flex h-14 items-center gap-2.5 px-5">
        <span aria-hidden="true" className="h-1 w-5 rounded-pill bg-primary" />
        <span className="text-[14px] font-semibold text-ink">{provider}</span>
        <span className="text-[12px] text-ink-muted">· HRD Corp registered training provider</span>
      </header>
      <main className="mx-auto flex w-full max-w-[560px] flex-1 flex-col px-4 pb-10">{children}</main>
      <footer className="px-5 py-4 text-center text-[11px] text-ink-muted">Zero-login link · your NRIC is never shown in full · verified by SHA-256</footer>
    </div>
  );
}
