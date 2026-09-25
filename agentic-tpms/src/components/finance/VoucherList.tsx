import { Field, MoneyInput, StatusChip, TextInput } from "@/components/kit";
import { FormDrawer } from "@/components/forms/FormDrawer";
import { formatDate } from "@/lib/dates";
import { formatRM } from "@/lib/money";
import type { ActionResult } from "@/server/domain/errors";
import { PAYEE_LABEL, PV_TONE } from "./tones";

type FormAction = (form: FormData) => Promise<ActionResult<unknown>>;

export interface VoucherLine {
  id: string;
  pvNumber: string;
  payeeType: string;
  payeeName: string;
  agreedAmount: string;
  finalAmount: string;
  adjustments: Array<{ kind: string; label: string; amount: number | string }>;
  status: string;
  bankReference: string | null;
  receiptVaultId: string | null;
  vaultId: string | null;
  paidAt: string | Date | null;
  paidBy: string | null;
}

/**
 * Payment vouchers with their Gate 3 AP actions: adjust & approve a draft,
 * record the payment (bank reference + receipt) of an approved one. Server-safe:
 * the drawers are client components bound to the server actions passed in.
 * Pay-when-paid: when the package is not payable yet, the row says so instead
 * of offering a button the database would refuse.
 */
export function VoucherList({ vouchers, payable, waitingReason, adjust, pay }: { vouchers: VoucherLine[]; payable: boolean; waitingReason: string; adjust: FormAction; pay: FormAction }) {
  return (
    <ul>
      {vouchers.map((v) => (
        <li key={v.id} className="flex flex-wrap items-center gap-3 border-b border-divider px-4 py-2.5 last:border-b-0">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-ink">
              {v.payeeName} <span className="font-normal text-ink-muted">· {PAYEE_LABEL[v.payeeType] ?? v.payeeType.toLowerCase()}</span>
            </p>
            <p className="text-[12px] text-ink-secondary">
              {v.vaultId ? (
                <a href={`/api/v1/vault/${v.vaultId}`} target="_blank" rel="noreferrer" className="font-mono text-primary-hover hover:underline">
                  {v.pvNumber}
                </a>
              ) : (
                <span className="font-mono">{v.pvNumber}</span>
              )}{" "}
              · agreed {formatRM(v.agreedAmount)}
              {v.adjustments.map((a) => ` · ${a.label} ${Number(a.amount) < 0 ? "−" : "+"}${formatRM(Math.abs(Number(a.amount)))}`).join("")}
              {v.bankReference ? ` · ref ${v.bankReference}` : ""}
              {v.paidAt ? ` · paid ${formatDate(v.paidAt)}` : ""}
              {v.receiptVaultId ? (
                <>
                  {" · "}
                  <a href={`/api/v1/vault/${v.receiptVaultId}`} target="_blank" rel="noreferrer" className="text-primary-hover hover:underline">
                    receipt
                  </a>
                </>
              ) : null}
            </p>
          </div>
          <span className="w-28 text-right text-[13px] font-medium tabular-nums text-ink">{formatRM(v.finalAmount)}</span>
          <span className="flex w-[84px] justify-end">
            <StatusChip tone={PV_TONE[v.status] ?? "neutral"}>{v.status.toLowerCase()}</StatusChip>
          </span>
          <div className="flex w-[160px] justify-end">
            {v.status === "PAID" || v.status === "CANCELLED" ? null : !payable ? (
              <StatusChip tone="neutral" title={waitingReason}>
                waiting on remittance
              </StatusChip>
            ) : v.status === "DRAFT" ? (
              <FormDrawer trigger="Adjust & approve" triggerKind="ghost" title={`Approve ${v.pvNumber}`} subtitle={v.payeeName} action={adjust} submitLabel="Approve voucher">
                <input type="hidden" name="pvId" value={v.id} />
                <p className="text-[13px] text-ink-secondary">Agreed {formatRM(v.agreedAmount)}. Enter verified adjustments; leave blank to approve as agreed.</p>
                <Field label="Mileage (add)">
                  <MoneyInput name="mileage" />
                </Field>
                <Field label="Travel allowance (add)">
                  <MoneyInput name="allowance" />
                </Field>
                <Field label="Withholding tax (deduct)">
                  <MoneyInput name="wht" />
                </Field>
              </FormDrawer>
            ) : (
              <FormDrawer trigger="Record payment" triggerKind="ghost" title={`Pay ${v.pvNumber}`} subtitle={`${v.payeeName} · ${formatRM(v.finalAmount)}`} action={pay} submitLabel="Record payment">
                <input type="hidden" name="pvId" value={v.id} />
                <p className="text-[13px] text-ink-secondary">Make the transfer in your bank, then record its reference and attach the receipt. Both are mandatory.</p>
                <Field label="Bank transfer reference">
                  <TextInput name="bankReference" required />
                </Field>
                <Field label="Transfer receipt">
                  <input name="receipt" type="file" accept="application/pdf,image/*" required className="text-[13px]" />
                </Field>
              </FormDrawer>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
