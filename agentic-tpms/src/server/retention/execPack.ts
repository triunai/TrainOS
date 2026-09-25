import { sql } from "drizzle-orm";
import { formatRange } from "@/lib/dates";
import { type Executor, rows } from "../db/client";
import type { Client, TrainingPackage } from "../db/schema";
import { PdfBuilder } from "../documents/pdf";
import { deliveryLabel } from "../claims/invoice";

/**
 * T+14 executive delivery pack: what the client's decision maker needs to see
 * that the training worked — attendance, the Kirkpatrick cohort movement, and
 * a verification link for every certificate. Read straight from SQL (roster,
 * `participant_assessments`, `certificates`) so this lane does not depend on
 * lane D's modules; names only, no identity numbers, because the pack leaves
 * the building.
 */
export type ExecRosterRow = { fullName: string; attendanceRate: string; eligible: boolean; certificateSerial: string | null };

export type KirkpatrickCohort = {
  /** Participants with both a PRE and a POST score; the delta is computed on these only. */
  pairs: number;
  preAverage: string | null;
  postAverage: string | null;
  delta: string | null;
  /** Level 1 reaction (1-5), when participants gave one. */
  reactionAverage: string | null;
  reactionResponses: number;
};

export type CertificateLink = { serial: string; participant: string; url: string };

export type OutcomeData = {
  roster: ExecRosterRow[];
  active: number;
  eligible: number;
  averageAttendance: string | null;
  kirkpatrick: KirkpatrickCohort;
  certificates: CertificateLink[];
};

export async function loadOutcomeData(executor: Executor, packageId: string): Promise<OutcomeData> {
  const roster = await rows<ExecRosterRow>(
    executor,
    sql`select p.full_name as "fullName", p.attendance_rate::text as "attendanceRate", p.hrd_claim_eligible as eligible,
               (select c.certificate_serial from tpms.certificates c
                 where c.participant_id = p.id and not c.revoked limit 1) as "certificateSerial"
          from tpms.package_participants p
         where p.package_id = ${packageId}::uuid and p.registration_status <> 'WITHDRAWN'
         order by p.full_name, p.id`,
  );
  // Assessment rows win over the legacy per-participant columns. `to_jsonb(a)`
  // reads the optional reaction column without hard-depending on it.
  const [k] = await rows<KirkpatrickCohort>(
    executor,
    sql`with scores as (
          select p.id,
                 coalesce((select a.score from tpms.participant_assessments a where a.participant_id = p.id and a.kind = 'PRE'),
                          p.kirkpatrick_pre_score) as pre,
                 coalesce((select a.score from tpms.participant_assessments a where a.participant_id = p.id and a.kind = 'POST'),
                          p.kirkpatrick_post_score) as post,
                 (select (to_jsonb(a) ->> 'reaction_rating')::numeric from tpms.participant_assessments a
                   where a.participant_id = p.id and a.kind = 'POST') as reaction
            from tpms.package_participants p
           where p.package_id = ${packageId}::uuid and p.registration_status <> 'WITHDRAWN'
        )
        select count(*) filter (where pre is not null and post is not null)::int as pairs,
               round(avg(pre) filter (where pre is not null and post is not null), 1)::text as "preAverage",
               round(avg(post) filter (where pre is not null and post is not null), 1)::text as "postAverage",
               round(avg(post - pre) filter (where pre is not null and post is not null), 1)::text as delta,
               round(avg(reaction), 2)::text as "reactionAverage",
               count(reaction)::int as "reactionResponses"
          from scores`,
  );
  const certificates = await rows<CertificateLink>(
    executor,
    sql`select c.certificate_serial as serial, p.full_name as participant, c.public_verification_url as url
          from tpms.certificates c
          join tpms.package_participants p on p.id = c.participant_id
         where c.package_id = ${packageId}::uuid and not c.revoked
         order by p.full_name, c.certificate_serial`,
  );
  const active = roster.length;
  const eligible = roster.filter((r) => r.eligible).length;
  const averageAttendance = active ? (roster.reduce((acc, r) => acc + Number(r.attendanceRate), 0) / active).toFixed(1) : null;
  return { roster, active, eligible, averageAttendance, kirkpatrick: k, certificates };
}

export async function renderExecutivePack(pkg: TrainingPackage, client: Client, trainerName: string | null, data: OutcomeData): Promise<Uint8Array> {
  const b = await PdfBuilder.create({ title: "Executive Delivery Pack", reference: pkg.packageCode });
  b.letterhead(`${client.companyName} · ${pkg.title}`);
  b.keyValues([
    ["Programme", pkg.title],
    ["Training dates", formatRange(pkg.startDate, pkg.endDate)],
    ["Delivery", deliveryLabel(pkg.deliveryMode)],
    ["Trainer", trainerName ?? "-"],
    ["Participants", `${data.active} attended, ${data.eligible} completed at 80% attendance or more`],
    ["Average attendance", data.averageAttendance ? `${data.averageAttendance}%` : "-"],
  ]);

  b.heading("Learning outcome (Kirkpatrick)");
  const k = data.kirkpatrick;
  if (k.pairs > 0) {
    b.keyValues([
      ["Level 2 — pre-assessment average", `${k.preAverage}`],
      ["Level 2 — post-assessment average", `${k.postAverage}`],
      ["Cohort improvement", `${Number(k.delta) >= 0 ? "+" : ""}${k.delta} points (${k.pairs} participant(s) with both scores)`],
    ], { labelWidth: 210 });
  } else {
    b.text("Pre- and post-assessment scores were not captured for this cohort.", { size: 9.5, color: "secondary" });
  }
  if (k.reactionResponses > 0) {
    b.keyValues([["Level 1 — participant reaction", `${k.reactionAverage} / 5 (${k.reactionResponses} response(s))`]], { labelWidth: 210 });
  }

  b.heading("Attendance");
  b.table(
    [
      { label: "Participant", width: 5 },
      { label: "Attendance", width: 1.6, align: "right" },
      { label: "Completed", width: 1.4 },
      { label: "Certificate", width: 2.6 },
    ],
    data.roster.map((r) => [r.fullName, `${Number(r.attendanceRate).toFixed(0)}%`, r.eligible ? "Yes" : "No", r.certificateSerial ?? "-"]),
    { zebra: true },
  );

  b.heading("Certificate verification");
  if (data.certificates.length) {
    b.text("Each certificate can be verified online at the link below (or by scanning the QR code on the certificate).", { size: 9, color: "secondary" });
    b.table(
      [
        { label: "Serial", width: 2.6 },
        { label: "Participant", width: 3 },
        { label: "Verification link", width: 5 },
      ],
      data.certificates.map((c) => [c.serial, c.participant, c.url]),
      { size: 8 },
    );
  } else {
    b.text("Certificates are being issued; verification links follow in a separate email.", { size: 9, color: "secondary" });
  }
  return b.save({ footer: "Executive delivery pack" });
}
