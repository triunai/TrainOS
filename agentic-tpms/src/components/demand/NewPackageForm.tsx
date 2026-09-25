"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { AIChip, Checkbox, Drawer, Field, GhostButton, KitButton, LINK_BUTTON, PrimaryButton, SecondaryButton, Section, Select, StatusChip, TextInput } from "@/components/kit";
import { useActionRunner } from "@/components/actions/ActionButton";
import type { ActionResult } from "@/server/domain/errors";

export interface ClientOption {
  id: string;
  companyName: string;
  companyDomain: string | null;
  levyRegistered: boolean;
  accountType: string;
}

export interface CourseOption {
  id: string;
  courseCode: string;
  title: string;
  durationDays: number;
  hrdFocusArea: string;
}

export interface NewPackagePayload {
  clientId: string;
  title: string;
  deliveryMode: string;
  startDate: string | null;
  endDate: string | null;
  pax: number;
  minParticipants?: number;
  courseId: string | null;
  venueByClient: boolean;
  draftProposal: boolean;
}

export interface NewClientPayload {
  companyName: string;
  companyDomain: string | null;
  ssmRegistration: string | null;
  hrdcorpMycoid: string | null;
  industrySector: string | null;
  malaysianHeadcount: number | null;
  levyRegistered: boolean;
  fiscalYearEndMonth: number | null;
  accountType: string;
  primaryPicName: string;
  primaryPicEmail: string;
  primaryPicPhone: string;
}

const s = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
const n = (form: FormData, key: string) => {
  const v = s(form, key);
  return v === null ? null : Number(v);
};

/** "2026-11-17" + 2 days -> "2026-11-18" (the last training day), on calendar strings. */
function lastDay(start: string, days: number): string {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.max(1, days) - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The New package form: an existing client (or one created inline), the
 * programme, and whether the L3 sourcing agent drafts the proposal. On
 * success the operator lands on the package's commercials desk (Gate 1).
 */
export function NewPackageForm({
  clients,
  courses,
  deliveryModes,
  accountTypes,
  defaultClientId,
  createPackage,
  createClient,
}: {
  clients: ClientOption[];
  courses: CourseOption[];
  deliveryModes: Array<{ value: string; label: string }>;
  accountTypes: Array<{ value: string; label: string }>;
  defaultClientId?: string;
  createPackage: (input: NewPackagePayload) => Promise<ActionResult<{ code: string; proposalQueued: boolean }>>;
  createClient: (input: NewClientPayload) => Promise<ActionResult<{ id: string; companyName: string }>>;
}) {
  const router = useRouter();
  const { pending, runAction } = useActionRunner();
  const client = useActionRunner();
  const [clientId, setClientId] = useState(defaultClientId ?? "");
  const [title, setTitle] = useState("");
  const [courseId, setCourseId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [drawer, setDrawer] = useState(false);
  const clientForm = useRef<HTMLFormElement>(null);
  const chosen = clients.find((c) => c.id === clientId);
  const course = courses.find((c) => c.id === courseId);

  const onCourse = (id: string) => {
    setCourseId(id);
    const c = courses.find((x) => x.id === id);
    if (!c) return;
    if (!title.trim()) setTitle(c.title);
    if (startDate && !endDate) setEndDate(lastDay(startDate, c.durationDays));
  };
  const onStart = (value: string) => {
    setStartDate(value);
    if (value && course && !endDate) setEndDate(lastDay(value, course.durationDays));
  };

  return (
    <>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const payload: NewPackagePayload = {
            clientId,
            title: title.trim(),
            deliveryMode: s(form, "deliveryMode") ?? "",
            startDate: startDate || null,
            endDate: endDate || null,
            pax: n(form, "pax") ?? Number.NaN,
            minParticipants: n(form, "minParticipants") ?? undefined,
            courseId: courseId || null,
            venueByClient: form.get("venueByClient") === "on",
            draftProposal: form.get("draftProposal") === "on",
          };
          runAction("Create package", () => createPackage(payload), (result) => {
            if (result.ok) router.push(`/operations/${(result.data as { code: string }).code}/commercials`);
          });
        }}
      >
        <Section eyebrow="Step 1" title="Client">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Corporate client" className="min-w-[320px] flex-1">
              <Select name="clientId" required value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">Choose a client…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.companyName}
                    {c.companyDomain ? ` · ${c.companyDomain}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <SecondaryButton onClick={() => setDrawer(true)}>New client</SecondaryButton>
          </div>
          {chosen ? (
            <p className="flex items-center gap-2 pt-2 text-[12px] text-ink-secondary">
              <StatusChip tone={chosen.accountType === "PRIVATE_CASH" ? "neutral" : chosen.levyRegistered ? "success" : "warning"}>
                {chosen.accountType === "PRIVATE_CASH" ? "Private cash" : chosen.levyRegistered ? "Levy verified" : "Levy unverified"}
              </StatusChip>
              <Link href={`/clients/${chosen.id}`} className="text-primary-hover hover:underline">Open client</Link>
            </p>
          ) : null}
        </Section>

        <Section eyebrow="Step 2" title="Programme">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Catalog course" hint={course ? `${course.hrdFocusArea} · ${course.durationDays} day(s)` : "Optional — the sourcing agent matches one by pgvector search if left empty"} className="md:col-span-2">
              <Select name="courseId" value={courseId} onChange={(e) => onCourse(e.target.value)}>
                <option value="">No catalog course</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>{`${c.courseCode} · ${c.title}`}</option>
                ))}
              </Select>
            </Field>
            <Field label="Programme title" className="md:col-span-2">
              <TextInput name="title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Effective Supervisory Skills for Line Leaders" />
            </Field>
            <Field label="Delivery mode">
              <Select name="deliveryMode" defaultValue={deliveryModes[0]?.value}>
                {deliveryModes.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </Select>
            </Field>
            <div className="flex items-center md:pt-6">
              <Checkbox name="venueByClient" label="The client provides the venue" />
            </div>
            <Field label="Start date" hint="Optional until the grant is filed">
              <TextInput name="startDate" type="date" value={startDate} onChange={(e) => onStart(e.target.value)} />
            </Field>
            <Field label="End date">
              <TextInput name="endDate" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
            <Field label="Participants (pax)">
              <TextInput name="pax" required inputMode="numeric" placeholder="e.g. 20" />
            </Field>
            <Field label="Minimum to run" hint="Gate 2 checks this at T-14">
              <TextInput name="minParticipants" inputMode="numeric" defaultValue="5" />
            </Field>
          </div>
        </Section>

        <Section eyebrow="Step 3" title="Proposal" actions={<AIChip label="L3 sourcing agent" />}>
          <div className="flex flex-col gap-2">
            <Checkbox name="draftProposal" defaultChecked label="Draft the proposal with AI" />
            <p className="text-[12px] text-ink-secondary">
              The agent matches a course, proposes a TTT-verified trainer and a venue, prices the job with the headless Univer engine against the Allowable Cost Matrix and drafts the Form HRD-L&amp;D outline. Without model keys it runs its deterministic template and says so. Nothing reaches the client until you approve at Gate 1.
            </p>
          </div>
        </Section>

        <div className="flex items-center gap-2">
          <PrimaryButton type="submit" busy={pending}>
            Create package
          </PrimaryButton>
          <Link href="/operations" className={LINK_BUTTON.ghost}>
            Cancel
          </Link>
        </div>
      </form>

      <Drawer
        open={drawer}
        onClose={() => setDrawer(false)}
        title="New client"
        subtitle="Deduplicated by company domain and SSM number"
        footer={
          <>
            <KitButton kind="primary" busy={client.pending} onClick={() => clientForm.current?.requestSubmit()}>
              Create client
            </KitButton>
            <GhostButton onClick={() => setDrawer(false)}>Cancel</GhostButton>
          </>
        }
      >
        <form
          ref={clientForm}
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const payload: NewClientPayload = {
              companyName: s(form, "companyName") ?? "",
              companyDomain: s(form, "companyDomain"),
              ssmRegistration: s(form, "ssmRegistration"),
              hrdcorpMycoid: s(form, "hrdcorpMycoid"),
              industrySector: s(form, "industrySector"),
              malaysianHeadcount: n(form, "malaysianHeadcount"),
              levyRegistered: form.get("levyRegistered") === "on",
              fiscalYearEndMonth: n(form, "fiscalYearEndMonth"),
              accountType: s(form, "accountType") ?? accountTypes[0]?.value ?? "",
              primaryPicName: s(form, "primaryPicName") ?? "",
              primaryPicEmail: s(form, "primaryPicEmail") ?? "",
              primaryPicPhone: s(form, "primaryPicPhone") ?? "",
            };
            client.runAction("Create client", () => createClient(payload), (result) => {
              if (!result.ok) return;
              setClientId((result.data as { id: string }).id);
              setDrawer(false);
            });
          }}
        >
          <p className="text-[13px] text-ink-secondary">A free-mail domain is refused as a company domain, and an existing domain or SSM number is refused with the client&apos;s name.</p>
          <Field label="Company name"><TextInput name="companyName" required placeholder="e.g. Hartalega Holdings Berhad" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Company domain"><TextInput name="companyDomain" placeholder="hartalega.com.my" /></Field>
            <Field label="SSM number"><TextInput name="ssmRegistration" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="HRD Corp MyCoID"><TextInput name="hrdcorpMycoid" /></Field>
            <Field label="Industry"><TextInput name="industrySector" placeholder="Manufacturing" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Malaysian headcount" hint="10 or more is levy-liable"><TextInput name="malaysianHeadcount" inputMode="numeric" /></Field>
            <Field label="Fiscal year end">
              <Select name="fiscalYearEndMonth" defaultValue="12">
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {new Date(Date.UTC(2026, i, 1)).toLocaleString("en-GB", { month: "long", timeZone: "UTC" })}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 items-end gap-3">
            <Field label="Account type">
              <Select name="accountType" defaultValue={accountTypes[0]?.value}>
                {accountTypes.map((a) => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </Select>
            </Field>
            <Checkbox name="levyRegistered" label="Levy registration verified" />
          </div>
          <Field label="PIC name"><TextInput name="primaryPicName" required /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="PIC email"><TextInput name="primaryPicEmail" type="email" required /></Field>
            <Field label="PIC phone"><TextInput name="primaryPicPhone" required placeholder="012-345 6789" /></Field>
          </div>
        </form>
      </Drawer>
    </>
  );
}
