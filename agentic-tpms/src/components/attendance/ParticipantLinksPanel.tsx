"use client";

import { useState } from "react";
import { toast } from "sonner";
import { GhostButton, IconButton, KitButton, Modal, SecondaryButton } from "@/components/kit";
import { useActionRunner } from "@/components/actions/ActionButton";
import { calendarDay, dayTimeMY } from "@/lib/dates";
import type { ActionResult } from "@/server/domain/errors";

/**
 * Track A personal links for the cohort. Issuing is idempotent: an unexpired
 * link whose window still matches the programme dates comes back as the same
 * URL that was emailed, so "Show links" never invalidates what participants
 * already have. Revoking kills a participant's live links; issuing again then
 * mints new ones.
 */
export interface LinkView {
  jti: string;
  url: string;
  expiresAt: string;
  reused: boolean;
}

export interface ParticipantLinkView {
  participantId: string;
  participantName: string;
  email: string | null;
  nricMasked: string;
  checkin: LinkView | null;
  quizPre: LinkView | null;
  quizPost: LinkView | null;
}

export interface LinkSummaryView {
  live: { CHECKIN: number; QUIZ_PRE: number; QUIZ_POST: number };
  revoked: number;
  used: number;
  lastIssuedAt: string | null;
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  return (
    <IconButton
      label={label}
      icon="⧉"
      className="h-7 w-7"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          toast.success("Link copied");
        } catch {
          toast.warning("Copy failed", { description: "Select the link and copy it by hand." });
        }
      }}
    />
  );
}

function LinkCell({ link, closedText, name, kind }: { link: LinkView | null; closedText: string; name: string; kind: string }) {
  if (!link) return <span className="text-[12px] text-ink-muted">{closedText}</span>;
  return (
    <div className="flex min-w-0 items-center gap-1">
      <CopyButton value={link.url} label={`Copy ${kind} link for ${name}`} />
      <a href={link.url} target="_blank" rel="noreferrer" className="min-w-0 truncate font-mono text-[11px] text-primary-hover hover:underline" title={link.url}>
        …{link.url.slice(-10)}
      </a>
      <span className="whitespace-nowrap text-[11px] text-ink-muted">until {dayTimeMY(link.expiresAt)}</span>
    </div>
  );
}

export function ParticipantLinksPanel({
  code,
  summary,
  startDate,
  endDate,
  issue,
  revoke,
  disabledReason,
}: {
  code: string;
  summary: LinkSummaryView;
  startDate: string | null;
  endDate: string | null;
  issue: (code: string) => Promise<ActionResult<ParticipantLinkView[]>>;
  revoke: (code: string, jtis: string[]) => Promise<ActionResult<unknown>>;
  disabledReason?: string | null;
}) {
  const [links, setLinks] = useState<ParticipantLinkView[] | null>(null);
  const [revoking, setRevoking] = useState<ParticipantLinkView | null>(null);
  const { pending, runAction } = useActionRunner();
  const anyLive = summary.live.CHECKIN + summary.live.QUIZ_PRE + summary.live.QUIZ_POST > 0;

  const load = () =>
    runAction("Links", () => issue(code), (result) => {
      if (result.ok) setLinks((result as { ok: true; data: ParticipantLinkView[] }).data);
    });

  const postClosedText = endDate ? `opens ${calendarDay(endDate)}` : "—";

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-divider px-4 py-3">
        <p className="min-w-0 flex-1 text-[12px] text-ink-secondary">
          {anyLive ? (
            <>
              <span className="text-ink">{summary.live.CHECKIN}</span> check-in · <span className="text-ink">{summary.live.QUIZ_PRE}</span> pre-quiz ·{" "}
              <span className="text-ink">{summary.live.QUIZ_POST}</span> post-quiz links live
              {summary.lastIssuedAt ? ` · last issued ${dayTimeMY(summary.lastIssuedAt)}` : ""}
              {summary.used ? ` · ${summary.used} check-in link${summary.used === 1 ? "" : "s"} used` : ""}
              {summary.revoked ? ` · ${summary.revoked} revoked` : ""}
            </>
          ) : (
            "No links issued yet. Each participant gets one check-in link (every session), a pre-quiz link (until day 1 ends) and a post-quiz link (from the last day)."
          )}
        </p>
        {disabledReason ? (
          <span className="text-[12px] text-ink-muted">{disabledReason}</span>
        ) : (
          <SecondaryButton busy={pending} onClick={load}>
            {links ? "Refresh links" : anyLive ? "Show links" : "Issue links"}
          </SecondaryButton>
        )}
      </div>
      {links ? (
        links.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-ink-muted">No active participants.</p>
        ) : (
          <div className="min-w-0 overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <caption className="sr-only">Participant links</caption>
              <thead className="bg-surface text-left">
                <tr className="border-b border-border">
                  {["Participant", "Check-in (every session)", "Pre-quiz", "Post-quiz", ""].map((h) => (
                    <th key={h || "actions"} scope="col" className="whitespace-nowrap px-3 py-2 text-[12px] font-medium text-ink-muted">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {links.map((l, i) => {
                  const live = [l.checkin, l.quizPre, l.quizPost].filter((x): x is LinkView => Boolean(x));
                  return (
                    <tr key={l.participantId} className={i % 2 ? "border-b border-divider bg-surface/60" : "border-b border-divider"}>
                      <td className="px-3 py-1.5">
                        <div className="flex flex-col">
                          <span className="font-medium">{l.participantName}</span>
                          <span className="text-[11px] text-ink-muted">{l.email ?? "no email — share the link by hand"}</span>
                        </div>
                      </td>
                      <td className="max-w-[260px] px-3 py-1.5">
                        <LinkCell link={l.checkin} name={l.participantName} kind="check-in" closedText={startDate ? "window closed" : "—"} />
                      </td>
                      <td className="max-w-[240px] px-3 py-1.5">
                        <LinkCell link={l.quizPre} name={l.participantName} kind="pre-quiz" closedText="closed after day 1" />
                      </td>
                      <td className="max-w-[240px] px-3 py-1.5">
                        <LinkCell link={l.quizPost} name={l.participantName} kind="post-quiz" closedText={postClosedText} />
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        {live.length ? (
                          <GhostButton className="px-2.5 py-1" onClick={() => setRevoking(l)} aria-label={`Revoke links for ${l.participantName}`}>
                            Revoke
                          </GhostButton>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="px-4 py-2 text-[11px] text-ink-muted">
              {links.some((l) => [l.checkin, l.quizPre, l.quizPost].some((x) => x && !x.reused)) ? "New links were minted for some participants — send them. " : "Every link above is the one already sent. "}
              Links are personal: a check-in link signs only its owner in.
            </p>
          </div>
        )
      ) : null}
      <Modal
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        title={`Revoke ${revoking?.participantName ?? ""}'s links?`}
        footer={
          <>
            <GhostButton onClick={() => setRevoking(null)}>Back</GhostButton>
            <KitButton
              kind="danger"
              busy={pending}
              onClick={() => {
                const target = revoking;
                if (!target) return;
                const jtis = [target.checkin, target.quizPre, target.quizPost].filter((x): x is LinkView => Boolean(x)).map((x) => x.jti);
                runAction("Revoke links", () => revoke(code, jtis), (result) => {
                  if (!result.ok) return;
                  setRevoking(null);
                  setLinks((prev) => prev?.map((row) => (row.participantId === target.participantId ? { ...row, checkin: null, quizPre: null, quizPost: null } : row)) ?? null);
                });
              }}
            >
              Revoke links
            </KitButton>
          </>
        }
      >
        <p>
          The links already sent stop working at once and show &ldquo;withdrawn&rdquo;. Signatures and scores already recorded stay. Use this when a phone is lost or a link was forwarded, then issue links again and send the new ones.
        </p>
      </Modal>
    </div>
  );
}
