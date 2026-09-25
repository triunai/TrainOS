import { explain } from "./publicCopy";

/** A refusal on a participant page: plain language, what to do next, the code small for the coordinator. No stack, no 500. */
export function PublicProblem({ code, details, heading, context }: { code: string; details?: Record<string, unknown>; heading?: string; context?: "room" }) {
  const e = explain(code, details, context);
  return (
    <div className="mt-6 flex flex-col gap-3">
      {heading ? <p className="text-[12px] font-medium text-ink-muted">{heading}</p> : null}
      <section role="alert" className="flex flex-col gap-2 rounded-card border border-border bg-card p-5 shadow-card">
        <h1 className="text-[20px] font-semibold leading-tight text-ink">{e.title}</h1>
        <p className="text-[14px] text-ink-secondary">{e.body}</p>
      </section>
      <p className="text-center font-mono text-[11px] text-ink-muted">ref {code}</p>
    </div>
  );
}
