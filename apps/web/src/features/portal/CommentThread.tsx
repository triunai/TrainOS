import { useState, type FormEvent } from "react";
import type { PortalComment } from "@trainos/contract";
import { EmptyState, SecondaryButton, formatDate, formatTime } from "@/shared/components/kit";
import { readableMessage, type ApiError } from "@/shared/api";
import { Field } from "./AcceptancePanel";

/**
 * The comment thread on the client proposal page.
 *
 * A client comment indents nothing; a reply from the vendor is inset by 16px,
 * which is the whole visual grammar of the thread in the artboard — no avatars,
 * no rails, no borders beyond the card itself.
 *
 * Posting stays a `SecondaryButton` even though it is the only write on the
 * page. The accepted-and-locked state must carry zero solid primaries, and a
 * button that is solid in one state and bordered in another teaches the reader
 * that solid means nothing.
 */

export interface CommentThreadProps {
  comments: PortalComment[];
  onPost: (body: { author: string; body: string }) => void;
  /** Defaults the author field to whoever the link was issued to. */
  defaultAuthor?: string;
  busy?: boolean;
  error?: ApiError;
}

export function CommentThread({
  comments,
  onPost,
  defaultAuthor = "",
  busy,
  error,
}: CommentThreadProps) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
        Comments · {comments.length}
      </h2>

      {comments.length === 0 ? (
        <EmptyState
          title="No comments yet"
          description="Ask a question here and it reaches the team that prepared this proposal."
        />
      ) : (
        <ol className="flex flex-col gap-3">
          {comments.map((comment, index) => (
            <li
              key={`${comment.at}-${index}`}
              className={
                comment.authorKind === "CLIENT"
                  ? "rounded-card border border-border bg-card p-3"
                  : "ml-4 rounded-card border border-border bg-card p-3"
              }
            >
              <div className="flex items-baseline gap-2">
                <span className="text-[13px] font-semibold text-ink">{comment.author}</span>
                <span className="text-[11px] text-ink-muted">
                  {formatDate(comment.at)} {formatTime(comment.at)}
                </span>
              </div>
              <p className="pt-1 text-[13px] leading-[1.55] text-ink-secondary">{comment.body}</p>
            </li>
          ))}
        </ol>
      )}

      <CommentComposer onPost={onPost} defaultAuthor={defaultAuthor} busy={busy} error={error} />
    </section>
  );
}

function CommentComposer({
  onPost,
  defaultAuthor,
  busy,
  error,
}: {
  onPost: (body: { author: string; body: string }) => void;
  defaultAuthor: string;
  busy?: boolean;
  error?: ApiError;
}) {
  const [author, setAuthor] = useState(defaultAuthor);
  const [body, setBody] = useState("");
  const complete = author.trim().length > 0 && body.trim().length > 0;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!complete || busy) return;
    onPost({ author: author.trim(), body: body.trim() });
    setBody("");
  }

  return (
    <form className="flex flex-col gap-2 pt-1" onSubmit={submit}>
      <Field label="Your name" value={author} onChange={setAuthor} autoComplete="name" />
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
          Add a comment
        </span>
        <textarea
          value={body}
          rows={3}
          onChange={(event) => setBody(event.target.value)}
          className="resize-none rounded-control border border-border bg-card px-2.5 py-2 text-[13px] leading-[1.55] text-ink outline-none placeholder:text-ink-disabled focus-visible:border-primary-border focus-visible:ring-2 focus-visible:ring-primary/30"
        />
      </label>
      {error ? (
        <p role="alert" className="text-[12px] text-danger">
          {readableMessage(error)}
        </p>
      ) : null}
      <div>
        <SecondaryButton type="submit" disabled={!complete || busy}>
          Post comment
        </SecondaryButton>
      </div>
    </form>
  );
}
