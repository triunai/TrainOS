import { Body, DataTable, Field, MoneyInput, PageHeader, Select, TextInput } from "@/components/kit";
import { FormDrawer } from "@/components/forms/FormDrawer";
import { Frame } from "@/components/shell/Frame";
import { formatRM } from "@/lib/money";
import { plain } from "@/server/actions";
import { listVendors } from "@/server/resources/service";
import { createVendorAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Venues & vendors" };

export default async function VendorsPage() {
  const vendors = plain(await listVendors());
  return (
    <Frame crumbs={[{ label: "Resources" }, { label: "Venues & vendors" }]}>
      <PageHeader
        title="Venues & vendors"
        summary="Venues (DDR: 2 tea breaks + lunch), caterers and printers · free postponement and cancellation windows drive the T-14 exposure maths"
        actions={
          <FormDrawer trigger="Add vendor" title="Add vendor" action={createVendorAction} submitLabel="Add vendor">
            <Field label="Type">
              <Select name="vendorType" defaultValue="VENUE">
                <option value="VENUE">Venue</option>
                <option value="CATERING">Catering</option>
                <option value="PRINTING">Printing</option>
              </Select>
            </Field>
            <Field label="Name"><TextInput name="name" required /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="City"><TextInput name="city" /></Field>
              <Field label="Capacity (pax)"><TextInput name="capacity" type="number" min={1} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Latitude" hint="Photo EXIF is checked against this"><TextInput name="latitude" /></Field>
              <Field label="Longitude"><TextInput name="longitude" /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="DDR per pax / day"><MoneyInput name="ddrPerPax" /></Field>
              <Field label="Unit cost (printing)"><MoneyInput name="unitCost" /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Free postponement (days before)"><TextInput name="freePostponementDays" type="number" defaultValue={7} /></Field>
              <Field label="Cancellation notice (days)"><TextInput name="cancellationNoticeDays" type="number" defaultValue={14} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Contact email"><TextInput name="contactEmail" type="email" /></Field>
              <Field label="Contact phone"><TextInput name="contactPhone" /></Field>
            </div>
          </FormDrawer>
        }
      />
      <Body>
        <DataTable
          label="Vendors"
          rows={vendors}
          rowKey={(v) => v.id}
          columns={[
            { key: "name", label: "Vendor", cell: (v) => (<div className="flex flex-col"><span className="font-medium">{v.name}</span><span className="text-[12px] text-ink-muted">{v.vendorType.toLowerCase()} · {v.city ?? "—"}</span></div>) },
            { key: "cap", label: "Capacity", align: "right", cell: (v) => (v.capacity ? `${v.capacity} pax` : "—") },
            { key: "ddr", label: "DDR / pax", align: "right", cell: (v) => (v.ddrPerPax ? formatRM(v.ddrPerPax) : v.unitCost ? `${formatRM(v.unitCost)} unit` : "—") },
            { key: "windows", label: "Free postpone / cancel notice", cell: (v) => `T-${v.freePostponementDays} / T-${v.cancellationNoticeDays}` },
            { key: "geo", label: "Geo", cell: (v) => (v.latitude ? <span className="font-mono text-[11px]">{Number(v.latitude).toFixed(4)}, {Number(v.longitude).toFixed(4)}</span> : "—") },
            { key: "contact", label: "Contact", cell: (v) => <span className="text-[12px] text-ink-secondary">{v.contactEmail ?? v.contactPhone ?? "—"}</span> },
          ]}
        />
      </Body>
    </Frame>
  );
}
