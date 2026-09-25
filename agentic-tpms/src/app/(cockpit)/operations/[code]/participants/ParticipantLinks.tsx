import { Section } from "@/components/kit";
import { ParticipantLinksPanel } from "@/components/attendance/ParticipantLinksPanel";
import { SessionQrPanel } from "@/components/attendance/SessionQrPanel";
import { dayLabel } from "@/components/attendance/labels";
import { TZ, addDays } from "@/lib/dates";
import { plain } from "@/server/actions";
import { linkIssuanceSummary } from "@/server/attendance";
import { loadPackageRecord } from "@/server/packages/record";
import { issueLinksAction, issueSessionQrAction, revokeLinksAction } from "../attendance/actions";

/**
 * Track A on the participants tab: personal magic links (check-in, pre-quiz,
 * post-quiz) and the room QR. Props are unchanged ({code, stage}); the record
 * load is React-cached, so re-reading it here costs nothing.
 */
const QR_STAGES = new Set(["READY_FOR_EVENT", "DELIVERY_IN_PROGRESS"]);
const NO_LINK_STAGES = new Set(["CANCELLED", "DRAFT", "QUOTED"]);

export async function ParticipantLinks({ code, stage }: { code: string; stage: string }) {
  const { snapshot: s } = await loadPackageRecord(code);
  const p = s.pkg;
  const summary = plain(await linkIssuanceSummary(p.id));
  const days = Array.from({ length: p.durationDays ?? 0 }, (_, i) => {
    const date = p.startDate ? addDays(p.startDate, i) : null;
    return { dayIndex: i + 1, date, label: `Day ${i + 1}${date ? ` · ${dayLabel(date)}` : ""}` };
  });
  const todayIndex = days.find((d) => d.date === s.today)?.dayIndex ?? 1;
  const hourMY = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(new Date()));
  const disabledReason = NO_LINK_STAGES.has(stage)
    ? "Links are issued once the client has accepted the quotation"
    : !p.startDate || !p.endDate
      ? "Set the training dates first"
      : null;

  return (
    <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_520px]">
      <Section eyebrow="Track A · zero-login" title="Participant links" flush>
        <ParticipantLinksPanel
          code={code}
          summary={summary}
          startDate={p.startDate}
          endDate={p.endDate}
          issue={issueLinksAction}
          revoke={revokeLinksAction}
          disabledReason={disabledReason}
        />
      </Section>
      <Section eyebrow="Track A · room display" title="Session QR">
        {QR_STAGES.has(stage) && days.length > 0 ? (
          <SessionQrPanel code={code} title={p.title} days={days} defaultDay={todayIndex} defaultSession={hourMY >= 13 ? "PM" : "AM"} issue={issueSessionQrAction} />
        ) : (
          <p className="text-[13px] text-ink-muted">The room QR is available from Ready for event until delivery completes.</p>
        )}
      </Section>
    </div>
  );
}
