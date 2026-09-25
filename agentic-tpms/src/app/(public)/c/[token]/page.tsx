import { CheckInFlow, type CheckInContextView } from "@/components/attendance/CheckInFlow";
import { PublicProblem } from "@/components/attendance/PublicProblem";
import { checkInContext } from "@/server/attendance";
import { isDomainError } from "@/server/domain/errors";
import { checkInAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Attendance check-in", robots: { index: false, follow: false } };

/** `/c/<jwt>` — a participant's personal (or one-time, from the room QR) check-in link. */
export default async function CheckInPage({ params }: { params: { token: string } }) {
  const token = decodeURIComponent(params.token);
  try {
    const ctx = await checkInContext(token);
    const context: CheckInContextView = {
      participantName: ctx.participantName,
      packageTitle: ctx.packageTitle,
      packageCode: ctx.packageCode,
      expiresAt: ctx.expiresAt.toISOString(),
      boundTo: ctx.boundTo,
      current: ctx.current,
      days: ctx.days.map((d) => ({
        dayIndex: d.dayIndex,
        date: d.date,
        sessions: d.sessions.map((x) => ({ session: x.session, opensAt: x.opensAt.toISOString(), closesAt: x.closesAt.toISOString(), open: x.open, signed: x.signed })),
      })),
    };
    return <CheckInFlow token={token} context={context} serverNow={new Date().toISOString()} checkIn={checkInAction} />;
  } catch (error) {
    if (isDomainError(error)) return <PublicProblem code={error.code} details={error.details} heading="Attendance check-in" />;
    throw error;
  }
}
