import { Body, DataTable, Field, MoneyInput, PageHeader, StatusChip, TextArea, TextInput } from "@/components/kit";
import { FormDrawer } from "@/components/forms/FormDrawer";
import { Frame } from "@/components/shell/Frame";
import { formatDate, todayMY } from "@/lib/dates";
import { formatRM } from "@/lib/money";
import { plain } from "@/server/actions";
import { listTrainers } from "@/server/resources/service";
import { createTrainerAction, verifyTttAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Trainers" };

export default async function TrainersPage() {
  const trainers = plain(await listTrainers());
  const today = todayMY();
  const unverified = trainers.filter((t) => !t.tttVerified).length;
  return (
    <Frame crumbs={[{ label: "Resources" }, { label: "Trainers" }]}>
      <PageHeader
        title="Trainers"
        summary={`${trainers.length} in the credential registry · ${unverified} TTT unverified · operations cannot lock on an unverified trainer`}
        actions={
          <FormDrawer trigger="Register trainer" title="Register trainer" subtitle="NRIC is hashed, encrypted (AES-256) and masked on arrival" action={createTrainerAction} submitLabel="Register">
            <Field label="Full name"><TextInput name="fullName" required /></Field>
            <Field label="NRIC / passport" hint="Never displayed again unmasked"><TextInput name="nric" required placeholder="800101-14-5567" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Email"><TextInput name="email" type="email" required /></Field>
              <Field label="Phone"><TextInput name="phone" required /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="HRD Corp TTT certificate no."><TextInput name="tttCertNumber" required /></Field>
              <Field label="TTT expiry"><TextInput name="tttCertExpiryDate" type="date" /></Field>
            </div>
            <Field label="Standard day rate"><MoneyInput name="standardDayRate" required placeholder="3000" /></Field>
            <Field label="Specialties" hint="Comma-separated, used for matching"><TextInput name="specialties" placeholder="leadership, communication" /></Field>
            <Field label="Bio"><TextArea name="bioSummary" /></Field>
          </FormDrawer>
        }
      />
      <Body>
        <DataTable
          label="Trainers"
          rows={trainers}
          rowKey={(t) => t.id}
          columns={[
            { key: "name", label: "Trainer", cell: (t) => (<div className="flex flex-col"><span className="font-medium">{t.fullName}</span><span className="text-[12px] text-ink-muted">{t.email} · {t.nricMasked}</span></div>) },
            { key: "ttt", label: "TTT certificate", cell: (t) => (<div className="flex flex-col"><span className="font-mono text-[12px]">{t.tttCertNumber}</span><span className="text-[12px] text-ink-muted">expires {formatDate(t.tttCertExpiryDate)}</span></div>) },
            {
              key: "status",
              label: "Verification",
              cell: (t) =>
                t.tttVerified ? (
                  <StatusChip tone={t.tttCertExpiryDate && t.tttCertExpiryDate < today ? "danger" : "success"}>{t.tttCertExpiryDate && t.tttCertExpiryDate < today ? "expired" : "verified"}</StatusChip>
                ) : (
                  <FormDrawer trigger="Verify TTT" triggerKind="ghost" title={`Verify TTT · ${t.fullName}`} subtitle={t.tttCertNumber} action={verifyTttAction} submitLabel="Mark verified">
                    <input type="hidden" name="trainerId" value={t.id} />
                    <p className="text-[13px] text-ink-secondary">Attach the certificate you checked. It is stored in the evidence vault and your name is recorded as the verifier.</p>
                    <Field label="Certificate file"><input name="certificate" type="file" accept="application/pdf,image/*" required className="text-[13px]" /></Field>
                    <Field label="Expiry on the certificate"><TextInput name="expiry" type="date" defaultValue={t.tttCertExpiryDate ?? ""} /></Field>
                  </FormDrawer>
                ),
            },
            { key: "spec", label: "Specialties", cell: (t) => <span className="text-[12px] text-ink-secondary">{t.specialties.join(", ") || "—"}</span> },
            { key: "rate", label: "Day rate", align: "right", cell: (t) => formatRM(t.standardDayRate) },
            { key: "active", label: "Active holds", align: "right", cell: (t) => String(t.activeEngagements) },
            { key: "days", label: "Delivered days", align: "right", cell: (t) => String(t.deliveredDays) },
          ]}
        />
      </Body>
    </Frame>
  );
}
