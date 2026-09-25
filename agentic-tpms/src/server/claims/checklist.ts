import { formatRM, fromSen, toSen } from "@/lib/money";
import type { VaultDocument } from "../db/schema";
import { claimableSen } from "../fsm/guards";
import { docsOf, type PackageSnapshot } from "../packages/snapshot";

/**
 * The SBL-Khas claim evidence checklist — pure over a package snapshot.
 *
 * It is deliberately a superset of the L0 guard for CLAIM_EVIDENCE_VERIFIED:
 * the guard is the minimum the database-backed FSM will accept, the checklist
 * is what the collator needs to build a pack HRD Corp will not query (it adds
 * the eligible-participant check and the venue BEO/DO). The Claims desk
 * renders it as-is, so every item says what is missing in operator language.
 */
export type ChecklistCode =
  | "FORM_T3"
  | "FORM_JD14"
  | "PHOTOS"
  | "ELIGIBLE_PARTICIPANTS"
  | "BEO_DO"
  | "INVOICE"
  | "EVIDENCE_INTEGRITY"
  | "KIRKPATRICK_REPORT"
  | "FSM_GUARD";

export type ChecklistItem = {
  code: ChecklistCode;
  label: string;
  /** Optional items are reported but never block the claim. */
  required: boolean;
  ok: boolean;
  detail: string;
  vaultIds: string[];
};

export type ClaimChecklist = {
  ready: boolean;
  items: ChecklistItem[];
  missing: ChecklistCode[];
};

/** The evidence the pack is built from: verified where verification is required, present otherwise. */
export interface EvidenceSelection {
  t3: VaultDocument[];
  jd14: VaultDocument | null;
  photos: VaultDocument[];
  beoDo: VaultDocument[];
  kirkpatrick: VaultDocument | null;
}

const oldestFirst = (docs: VaultDocument[]) =>
  [...docs].sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0) || a.id.localeCompare(b.id));

export function selectEvidence(s: PackageSnapshot): EvidenceSelection {
  return {
    t3: oldestFirst(docsOf(s, "FORM_T3", "VERIFIED")),
    // snapshot.vault is newest first: the latest verified JD/14 is the one that counts.
    jd14: docsOf(s, "FORM_JD14", "VERIFIED")[0] ?? null,
    photos: oldestFirst(docsOf(s, "PHOTO_EVIDENCE", "VERIFIED")),
    beoDo: oldestFirst([...docsOf(s, "BEO"), ...docsOf(s, "DO")]),
    kirkpatrick: docsOf(s, "KIRKPATRICK_REPORT")[0] ?? null,
  };
}

/** A venue was used when delivery is physical, the provider booked it, and a venue commitment stands. */
export function venueUsed(s: PackageSnapshot): boolean {
  return (
    s.pkg.deliveryMode !== "ROT_VIRTUAL" &&
    !s.pkg.venueByClient &&
    s.commitments.some((c) => c.vendorType === "VENUE" && c.status !== "CANCELLED")
  );
}

function jd14Detail(s: PackageSnapshot): string {
  const any = docsOf(s, "FORM_JD14");
  if (any.length === 0) return "Upload the employer's Form JD/14 (signed by a manager and company-stamped)";
  return "Form JD/14 is uploaded but not verified — confirm the managerial signature and the company stamp";
}

export function evaluateChecklist(s: PackageSnapshot, opts: { invoiceProblem?: string } = {}): ClaimChecklist {
  const sel = selectEvidence(s);
  const pendingT3 = docsOf(s, "FORM_T3", "PENDING").length;
  const pendingPhotos = docsOf(s, "PHOTO_EVIDENCE", "PENDING").length;
  const claimable = claimableSen(s);
  const invoiceOk = Boolean(s.invoice) && toSen(s.invoice?.total) === claimable && claimable > 0;
  const needsVenueDocs = venueUsed(s);
  const belowEighty = s.participants.active - s.participants.eligible;

  const items: ChecklistItem[] = [
    {
      code: "FORM_T3",
      label: "Form T3 (attendance) verified",
      required: true,
      ok: sel.t3.length > 0,
      detail: sel.t3.length > 0
        ? `${sel.t3.length} verified`
        : pendingT3 > 0 ? `${pendingT3} uploaded, awaiting verification` : "No Form T3 in the vault",
      vaultIds: sel.t3.map((d) => d.id),
    },
    {
      code: "FORM_JD14",
      label: "Form JD/14 (employer verification) verified",
      required: true,
      ok: Boolean(sel.jd14),
      detail: sel.jd14 ? "Verified: managerial signature and company stamp confirmed" : jd14Detail(s),
      vaultIds: sel.jd14 ? [sel.jd14.id] : [],
    },
    {
      code: "PHOTOS",
      label: "At least two session photos verified",
      required: true,
      ok: sel.photos.length >= 2,
      detail: `${sel.photos.length} verified${pendingPhotos ? `, ${pendingPhotos} awaiting verification` : ""}`,
      vaultIds: sel.photos.map((d) => d.id),
    },
    {
      code: "ELIGIBLE_PARTICIPANTS",
      label: "At least one participant at 80% attendance",
      required: true,
      ok: s.participants.eligible >= 1,
      detail: `${s.participants.eligible} of ${s.participants.active} eligible${belowEighty > 0 ? `; ${belowEighty} below 80% are not claimable` : ""}`,
      vaultIds: [],
    },
    {
      code: "BEO_DO",
      label: "Venue BEO / delivery order on file",
      required: needsVenueDocs,
      ok: !needsVenueDocs || sel.beoDo.length > 0,
      detail: !needsVenueDocs
        ? "Not required (no provider-booked venue)"
        : sel.beoDo.length > 0 ? `${sel.beoDo.length} on file` : "A provider-booked venue was used; upload the signed BEO or the DO",
      vaultIds: sel.beoDo.map((d) => d.id),
    },
    {
      code: "INVOICE",
      label: "HRD Corp tax invoice drafted at the claimable amount",
      required: true,
      ok: invoiceOk,
      detail: invoiceOk
        ? `${s.invoice?.invoiceNumber} for ${formatRM(s.invoice?.total)}`
        : opts.invoiceProblem ?? (s.invoice ? `Invoice total ${formatRM(s.invoice.total)} differs from claimable ${formatRM(fromSen(claimable))}` : "Not drafted"),
      vaultIds: s.invoice?.vaultId ? [s.invoice.vaultId] : [],
    },
    {
      code: "KIRKPATRICK_REPORT",
      label: "Kirkpatrick evaluation report",
      required: false,
      ok: Boolean(sel.kirkpatrick),
      detail: sel.kirkpatrick ? "Attached to the pack" : "Not in the vault yet (optional for the claim)",
      vaultIds: sel.kirkpatrick ? [sel.kirkpatrick.id] : [],
    },
  ];
  return summarise(items);
}

export function summarise(items: ChecklistItem[]): ClaimChecklist {
  const missing = items.filter((i) => i.required && !i.ok).map((i) => i.code);
  return { ready: missing.length === 0, items, missing };
}

/** Add (or replace) a blocking item discovered after the pure evaluation — integrity or an FSM guard refusal. */
export function withBlockingItem(checklist: ClaimChecklist, item: Omit<ChecklistItem, "required" | "ok">): ClaimChecklist {
  return summarise([...checklist.items.filter((i) => i.code !== item.code), { ...item, required: true, ok: false }]);
}
