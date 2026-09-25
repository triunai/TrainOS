import { Body, PageHeader } from "@/components/kit";
import { NewPackageForm } from "@/components/demand/NewPackageForm";
import { Frame } from "@/components/shell/Frame";
import { plain } from "@/server/actions";
import { listClients } from "@/server/clients";
import { DELIVERY_MODES, DELIVERY_MODE_LABEL } from "@/server/domain/stages";
import type { ClientInput } from "@/server/ingestion";
import { listCourses } from "@/server/knowledge";
import { createClientAction, createPackageAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "New package" };

/** Exhaustive over the domain's account types: a new one is a compile error here, not a missing option. */
const ACCOUNT_TYPE_LABEL: Record<NonNullable<ClientInput["accountType"]>, string> = {
  SBL_KHAS_LEVY: "SBL-Khas (HRD Corp levy)",
  PRIVATE_CASH: "Private cash",
};

export default async function NewPackagePage({ searchParams }: { searchParams: { client?: string } }) {
  const [clients, courses] = await Promise.all([listClients(), listCourses()]);
  return (
    <Frame crumbs={[{ label: "Operations", href: "/operations" }, { label: "New package" }]}>
      <PageHeader
        title="New package"
        summary="For repeat business or a phone order — a client with no lead behind it. Enquiries convert from their own lead page."
      />
      <Body className="max-w-[960px]">
        <NewPackageForm
          clients={plain(clients).map((c) => ({ id: c.id, companyName: c.companyName, companyDomain: c.companyDomain, levyRegistered: c.levyRegistered, accountType: c.accountType }))}
          courses={courses.map((c) => ({ id: c.id, courseCode: c.courseCode, title: c.title, durationDays: c.durationDays, hrdFocusArea: c.hrdFocusArea }))}
          deliveryModes={DELIVERY_MODES.map((m) => ({ value: m, label: DELIVERY_MODE_LABEL[m] }))}
          accountTypes={Object.entries(ACCOUNT_TYPE_LABEL).map(([value, label]) => ({ value, label }))}
          defaultClientId={clients.some((c) => c.id === searchParams.client) ? searchParams.client : undefined}
          createPackage={createPackageAction}
          createClient={createClientAction}
        />
      </Body>
    </Frame>
  );
}
