import { useState, type FormEvent } from "react";
import type { PortalAcceptance } from "@trainos/contract";
import {
  ContentCard,
  DateText,
  PrimaryButton,
  SecondaryButton,
  formatDate,
  formatTime,
} from "@/shared/components/kit";
import { readableMessage, type ApiError } from "@/shared/api";

/**
 * The acceptance panel — the one part of M07-S07 that changes state.
 *
 * ACCEPTED is the state the design pack shows, and in it the page carries NO
 * solid primary button: REPORT.md lists M07-S07 as one of the two deliberate
 * exceptions to the one-primary rule because nothing may be written any more.
 * So `PrimaryButton` appears ONLY on the branch where `acceptance` is null.
 *
 * The signature is name + timestamp + IP, not a certificate (§4 assumptions).
 * The panel says so in as many words, because a client signing something is
 * entitled to know what was recorded.
 */

export interface AcceptancePanelProps {
  acceptance: PortalAcceptance | null;
  onAccept: (body: { name: string; role: string }) => void;
  busy?: boolean;
  error?: ApiError;
  onDownload?: () => void;
}

export function AcceptancePanel({
  acceptance,
  onAccept,
  busy,
  error,
  onDownload,
}: AcceptancePanelProps) {
  if (acceptance) return <AcceptedPanel acceptance={acceptance} onDownload={onDownload} />;
  return <AcceptForm onAccept={onAccept} busy={busy} error={error} />;
}

function AcceptedPanel({
  acceptance,
  onDownload,
}: {
  acceptance: PortalAcceptance;
  onDownload?: () => void;
}) {
  return (
    <ContentCard title="Accepted">
      <div className="flex flex-col gap-2.5">
        <p className="text-[13px] leading-[1.6] text-ink-secondary">
          Signed electronically by {acceptance.acceptedBy}, {acceptance.role}, on{" "}
          {formatDate(acceptance.acceptedAt)} at {formatTime(acceptance.acceptedAt)} (GMT+8).
          Signature, IP address and audit record retained.
        </p>
        <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">
          {acceptance.signatureRef}
        </p>
        <div className="flex gap-2 pt-0.5">
          <SecondaryButton onClick={onDownload}>Download signed copy</SecondaryButton>
        </div>
      </div>
    </ContentCard>
  );
}

function AcceptForm({
  onAccept,
  busy,
  error,
}: {
  onAccept: (body: { name: string; role: string }) => void;
  busy?: boolean;
  error?: ApiError;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const complete = name.trim().length > 0 && role.trim().length > 0;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!complete || busy) return;
    onAccept({ name: name.trim(), role: role.trim() });
  }

  return (
    <ContentCard title="Accept this proposal">
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <p className="text-[13px] leading-[1.6] text-ink-secondary">
          Your name and role are recorded with the date, time and IP address as an electronic
          signature. This is not a certificate-based signature.
        </p>
        <Field label="Full name" value={name} onChange={setName} autoComplete="name" />
        <Field
          label="Your role"
          value={role}
          onChange={setRole}
          autoComplete="organization-title"
        />
        {error ? (
          <p role="alert" className="text-[12px] text-danger">
            {readableMessage(error)}
          </p>
        ) : null}
        <div className="pt-0.5">
          <PrimaryButton type="submit" disabled={!complete || busy}>
            Accept proposal
          </PrimaryButton>
        </div>
      </form>
    </ContentCard>
  );
}

/**
 * A plain labelled text input.
 *
 * The kit has no `TextField` yet — `MoneyInput` is the only input it ships — so
 * this is styled from tokens only and carries no colour of its own. Requested
 * from the `kit` agent; this call site collapses to `<TextField/>` when it
 * lands, and nothing else on the page changes.
 */
export function Field({
  label,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
        {label}
      </span>
      <input
        type="text"
        value={value}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-control border border-border bg-card px-2.5 text-[13px] text-ink outline-none placeholder:text-ink-disabled focus-visible:border-primary-border focus-visible:ring-2 focus-visible:ring-primary/30"
      />
    </label>
  );
}

/** The acceptance date, for the header chip. Exported so the chip cannot drift. */
export function AcceptedChipLabel({ acceptance }: { acceptance: PortalAcceptance }) {
  return (
    <>
      Accepted <DateText value={acceptance.acceptedAt} />
    </>
  );
}
