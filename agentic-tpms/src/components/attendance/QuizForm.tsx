"use client";

import { useState, useTransition } from "react";
import { Banner, PrimaryButton, SELECTED_TINT } from "@/components/kit";
import { cn } from "@/lib/cn";
import { type PublicResult, explain, whenMY } from "./publicCopy";

/**
 * Kirkpatrick Level 2 pre/post quiz on the participant's phone. One page, all
 * questions, large tap targets; submit is enabled once every question is
 * answered. The post-assessment also asks a 1–5 usefulness rating (Level 1,
 * optional). The result is the score only — no per-question key, so the
 * pre-assessment cannot hand anyone the post-assessment's answers.
 */
export interface QuizFormView {
  kind: "PRE" | "POST";
  participantName: string;
  programmeTitle: string;
  quizVersion: string;
  questionCount: number;
  status: "OPEN" | "SUBMITTED" | "CLOSED";
  submitted: { score: number; submittedAt: string } | null;
  questions: Array<{ id: string; prompt: string; options: string[] }>;
}

export interface QuizResultView {
  kind: "PRE" | "POST";
  score: number;
  correct: number;
  total: number;
  delta: number | null;
  submittedAt: string;
}

const KIND_TITLE = { PRE: "Pre-assessment", POST: "Post-assessment" } as const;

function Score({ result }: { result: { kind: "PRE" | "POST"; score: number; correct?: number; total?: number; delta?: number | null; submittedAt: string } }) {
  return (
    <section className="flex flex-col gap-2 rounded-card border border-border bg-card p-5 shadow-card" aria-live="polite">
      <p className="text-[12px] font-medium text-ink-muted">Your score</p>
      <p className="text-[40px] font-semibold leading-none tracking-[-0.02em] text-ink tabular-nums">{Math.round(result.score)}%</p>
      {typeof result.correct === "number" ? (
        <p className="text-[14px] text-ink-secondary">
          {result.correct} of {result.total} correct
        </p>
      ) : null}
      {typeof result.delta === "number" ? (
        <p className="text-[14px] text-ink">
          {result.delta >= 0 ? `Up ${Math.round(result.delta)} points` : `Down ${Math.round(-result.delta)} points`} from your pre-assessment.
        </p>
      ) : null}
      <p className="text-[14px] text-ink-secondary">
        {result.kind === "PRE"
          ? "Thank you. This is your starting point — the post-assessment on the last day shows how far the programme took you."
          : "Thank you for completing the programme assessment. Your trainer sees the group's results, not a ranking."}
      </p>
      <p className="text-[12px] text-ink-muted">Submitted {whenMY(result.submittedAt)} (Malaysia time).</p>
    </section>
  );
}

export function QuizForm({
  token,
  quiz,
  submit,
}: {
  token: string;
  quiz: QuizFormView;
  submit: (token: string, answers: Array<{ questionId: string; optionIndex: number }>, quizVersion: string, rating: number | null) => Promise<PublicResult<QuizResultView>>;
}) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [rating, setRating] = useState<number | null>(null);
  const [result, setResult] = useState<QuizResultView | null>(null);
  const [error, setError] = useState<{ code: string; details?: Record<string, unknown> } | null>(null);
  const [pending, start] = useTransition();
  const answered = Object.keys(answers).length;
  const complete = answered === quiz.questions.length && quiz.questions.length > 0;

  const header = (
    <header className="flex flex-col gap-1">
      <p className="text-[12px] font-medium text-ink-muted">{KIND_TITLE[quiz.kind]}</p>
      <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.015em] text-ink">{quiz.programmeTitle}</h1>
      <p className="text-[14px] text-ink-secondary">{quiz.participantName}</p>
    </header>
  );

  if (result) return <div className="mt-2 flex flex-col gap-4">{header}<Score result={result} /></div>;
  if (quiz.status === "SUBMITTED" && quiz.submitted) {
    return (
      <div className="mt-2 flex flex-col gap-4">
        {header}
        <Banner tone="success" title="You have already completed this assessment">
          Each assessment is taken once. Here is the score that was recorded.
        </Banner>
        <Score result={{ kind: quiz.kind, score: quiz.submitted.score, submittedAt: quiz.submitted.submittedAt }} />
      </div>
    );
  }
  if (quiz.status === "CLOSED") {
    const e = explain("PRE_AFTER_POST");
    return (
      <div className="mt-2 flex flex-col gap-4">
        {header}
        <Banner tone="neutral" title={e.title}>
          {e.body}
        </Banner>
      </div>
    );
  }

  const send = () => {
    if (!complete) return;
    setError(null);
    start(async () => {
      const r = await submit(token, quiz.questions.map((q) => ({ questionId: q.id, optionIndex: answers[q.id] })), quiz.quizVersion, rating);
      if (r.ok) setResult(r.data);
      else setError({ code: r.code, details: r.details });
    });
  };
  const problem = error ? explain(error.code, error.details) : null;

  return (
    <div className="mt-2 flex flex-col gap-4">
      {header}
      <p className="text-[14px] text-ink-secondary">
        {quiz.questions.length} short questions{quiz.kind === "PRE" ? " before the programme starts" : " on what the programme covered"}. There is no pass mark; answer what you think is right — it takes about five minutes.
      </p>
      <ol className="flex flex-col gap-3">
        {quiz.questions.map((q, n) => (
          <li key={q.id}>
            <fieldset className="flex flex-col gap-2 rounded-card border border-border bg-card p-4">
              <legend className="sr-only">Question {n + 1}</legend>
              <p className="text-[15px] font-medium leading-snug text-ink">
                <span className="mr-1.5 text-ink-muted">{n + 1}.</span>
                {q.prompt}
              </p>
              <div className="flex flex-col gap-1.5">
                {q.options.map((option, i) => {
                  const selected = answers[q.id] === i;
                  return (
                    <label
                      key={i}
                      className={cn(
                        "flex min-h-11 cursor-pointer items-start gap-3 rounded-control border px-3 py-2.5 text-[14px] leading-snug text-ink",
                        selected ? cn("border-primary-border", SELECTED_TINT) : "border-border hover:bg-surface-hover",
                      )}
                    >
                      <input
                        type="radio"
                        name={q.id}
                        value={i}
                        checked={selected}
                        onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: i }))}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                      />
                      <span>{option}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </li>
        ))}
      </ol>
      {quiz.kind === "POST" ? (
        <fieldset className="flex flex-col gap-2 rounded-card border border-border bg-card p-4">
          <legend className="sr-only">Usefulness rating</legend>
          <p className="text-[15px] font-medium text-ink">How useful was this programme for your work? <span className="text-[13px] font-normal text-ink-muted">(optional)</span></p>
          <div className="grid grid-cols-5 gap-1.5">
            {[1, 2, 3, 4, 5].map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={rating === r}
                aria-label={`${r} of 5`}
                onClick={() => setRating(rating === r ? null : r)}
                className={cn("h-11 rounded-control border text-[15px] font-medium tabular-nums", rating === r ? cn("border-primary-border text-primary-hover", SELECTED_TINT) : "border-border text-ink hover:bg-surface-hover")}
              >
                {r}
              </button>
            ))}
          </div>
          <p className="flex justify-between text-[12px] text-ink-muted">
            <span>Not useful</span>
            <span>Very useful</span>
          </p>
        </fieldset>
      ) : null}
      {problem ? (
        <Banner tone={problem.retry ? "warning" : "danger"} title={problem.title}>
          {problem.body}
        </Banner>
      ) : null}
      <div className="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t border-border bg-canvas px-4 pb-4 pt-3">
        <p className="text-center text-[13px] text-ink-secondary tabular-nums">
          {answered} of {quiz.questions.length} answered
        </p>
        <PrimaryButton className="w-full py-3 text-[15px]" busy={pending} disabled={!complete} onClick={send}>
          {pending ? "Submitting…" : complete ? "Submit answers" : `Answer all ${quiz.questions.length} to submit`}
        </PrimaryButton>
      </div>
    </div>
  );
}
