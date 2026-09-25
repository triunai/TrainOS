import { dayLabel } from "@/components/attendance/labels";
import { PublicProblem } from "@/components/attendance/PublicProblem";
import { SessionQrIdentify } from "@/components/attendance/SessionQrIdentify";
import { sessionQrRoster } from "@/server/attendance";
import { isDomainError } from "@/server/domain/errors";
import { identifyAction } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Room check-in", robots: { index: false, follow: false } };

/** `/c/s/<jwt>` — the landing page of a projected session QR. Names only, never NRIC. */
export default async function SessionQrPage({ params }: { params: { token: string } }) {
  const token = decodeURIComponent(params.token);
  try {
    const roster = await sessionQrRoster(token);
    return (
      <SessionQrIdentify
        token={token}
        identify={identifyAction}
        roster={{
          packageTitle: roster.packageTitle,
          dayIndex: roster.dayIndex,
          session: roster.session,
          dateLabel: roster.date ? dayLabel(roster.date) : null,
          expiresAt: roster.expiresAt.toISOString(),
          participants: roster.participants.map((p) => ({ id: p.id, name: p.name })),
        }}
      />
    );
  } catch (error) {
    if (isDomainError(error)) return <PublicProblem code={error.code} details={error.details} heading="Room check-in" context="room" />;
    throw error;
  }
}
