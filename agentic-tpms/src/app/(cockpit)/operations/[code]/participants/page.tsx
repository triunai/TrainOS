import { Body, Checkbox, DataTable, Field, Section, StatusChip, TextArea, TextInput, type StatusTone } from "@/components/kit";
import { ActionButton } from "@/components/actions/ActionButton";
import { FormDrawer } from "@/components/forms/FormDrawer";
import { plain } from "@/server/actions";
import { listRoster } from "@/server/participants/service";
import { loadPackageRecord } from "@/server/packages/record";
import { addParticipantAction, importCsvAction, setStatusAction } from "./actions";
import { ParticipantLinks } from "./ParticipantLinks";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, StatusTone> = { REGISTERED: "neutral", CONFIRMED: "success", WITHDRAWN: "neutral" };

export default async function ParticipantsPage({ params }: { params: { code: string } }) {
  const { snapshot: s } = await loadPackageRecord(params.code);
  const roster = plain(await listRoster(s.pkg.id));
  const frozen = ["DELIVERY_COMPLETED", "CANCELLED"].includes(s.pkg.operationalStage);
  const overApproved = s.pkg.grantApprovedPax !== null && s.participants.active > (s.pkg.grantApprovedPax ?? 0);
  return (
    <Body>
      <Section
        eyebrow={`${s.participants.active} active · ${s.participants.confirmed} confirmed · minimum ${s.pkg.minParticipants}${s.pkg.grantApprovedPax ? ` · ${s.pkg.grantApprovedPax} approved by HRD Corp` : ""}`}
        title="Cohort roster"
        actions={
          frozen ? (
            <span className="text-[12px] text-ink-muted">Roster frozen at delivery completion</span>
          ) : (
            <>
              <FormDrawer trigger="Import CSV" title="Import participants" subtitle="name, nric, email, phone, dietary — header row optional" action={importCsvAction} submitLabel="Import">
                <input type="hidden" name="code" value={s.pkg.packageCode} />
                <Field label="CSV file"><input name="file" type="file" accept=".csv,text/csv" className="text-[13px]" /></Field>
                <Field label="…or paste rows"><TextArea name="csv" placeholder={"Ahmad Faizal,900512-14-5561,ahmad@client.my,0123456789,Halal"} /></Field>
                <p className="text-[12px] text-ink-muted">Each row is validated on its own: an invalid MyKad or a duplicate person is reported and skipped, the rest are imported.</p>
              </FormDrawer>
              <FormDrawer trigger="Add participant" title="Register participant" subtitle="NRIC is HMAC-hashed, AES-256 encrypted and masked on arrival" action={addParticipantAction} submitLabel="Register">
                <input type="hidden" name="code" value={s.pkg.packageCode} />
                <Field label="Full name (as per NRIC)"><TextInput name="fullName" required /></Field>
                <Field label="NRIC / passport"><TextInput name="nric" required placeholder="900512-14-5561" /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Work email"><TextInput name="workEmail" type="email" /></Field>
                  <Field label="Mobile"><TextInput name="phone" /></Field>
                </div>
                <Field label="Dietary"><TextInput name="dietaryPreference" placeholder="Halal / Vegetarian" /></Field>
                <Checkbox name="confirmed" label="Confirmed by client HR" />
              </FormDrawer>
            </>
          )
        }
        flush
      >
        {overApproved ? <p className="border-b border-divider bg-warning-fill px-4 py-2 text-[12px] text-warning">More active participants than HRD Corp approved — only the approved headcount is claimable on per-pax programmes.</p> : null}
        <DataTable
          label="Roster"
          rows={roster}
          rowKey={(r) => r.id}
          empty={<p className="px-4 py-6 text-[13px] text-ink-muted">No participants yet. The T-14 viability check counts this roster.</p>}
          columns={[
            { key: "name", label: "Participant", cell: (r) => (<div className="flex flex-col"><span className="font-medium">{r.fullName}</span><span className="text-[12px] text-ink-muted">{r.workEmail ?? r.phone ?? "—"}</span></div>) },
            { key: "nric", label: "NRIC", cell: (r) => <span className="font-mono text-[12px]">{r.nricMasked}</span> },
            { key: "status", label: "Registration", cell: (r) => <StatusChip tone={STATUS_TONE[r.registrationStatus] ?? "neutral"}>{r.registrationStatus.toLowerCase()}</StatusChip> },
            { key: "att", label: "Attendance", align: "right", cell: (r) => `${Number(r.attendanceRate).toFixed(0)}%` },
            { key: "elig", label: "≥ 80%", cell: (r) => (r.registrationStatus === "WITHDRAWN" ? "—" : <StatusChip tone={r.hrdClaimEligible ? "success" : "neutral"} shape="square">{r.hrdClaimEligible ? "claimable" : "not yet"}</StatusChip>) },
            { key: "kirk", label: "Pre → post", align: "right", cell: (r) => (r.preScore || r.postScore ? `${r.preScore ? Number(r.preScore).toFixed(0) : "–"} → ${r.postScore ? Number(r.postScore).toFixed(0) : "–"}` : "—") },
            { key: "cert", label: "Certificate", cell: (r) => (r.certSerial ? <a href={`/verify/${r.certSerial}`} target="_blank" rel="noreferrer" className="font-mono text-[12px] text-primary-hover hover:underline">{r.certSerial}</a> : "—") },
            {
              key: "act",
              label: "",
              cell: (r) =>
                frozen ? null : r.registrationStatus === "WITHDRAWN" ? (
                  <ActionButton action={setStatusAction} args={[r.id, "REGISTERED"]} label="Reinstate" kind="ghost" />
                ) : (
                  <div className="flex gap-1">
                    {r.registrationStatus !== "CONFIRMED" ? <ActionButton action={setStatusAction} args={[r.id, "CONFIRMED"]} label="Confirm" kind="ghost" /> : null}
                    <ActionButton action={setStatusAction} args={[r.id, "WITHDRAWN"]} label="Withdraw" kind="ghost" confirm={{ title: `Withdraw ${r.fullName}?`, body: "Withdrawn participants leave the viability count, attendance and the claim." }} />
                  </div>
                ),
            },
          ]}
        />
      </Section>
      <ParticipantLinks code={s.pkg.packageCode} stage={s.pkg.operationalStage} />
    </Body>
  );
}
