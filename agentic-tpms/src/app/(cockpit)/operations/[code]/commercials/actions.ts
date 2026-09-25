"use server";

import { act, plain } from "@/server/actions";
import { currentActor } from "@/server/auth/operator";
import { approveAndDispatch, clientAccepted, requestProposalDraft, requestRevision, saveQuotationRevision } from "@/server/commercial";
import { DomainError } from "@/server/domain/errors";
import { packageIdByCode } from "@/server/packages/queries";
import { recomputeFromCells } from "@/server/pricing";

async function idFor(code: string) {
  const id = await packageIdByCode(code);
  if (!id) throw new DomainError("PACKAGE_NOT_FOUND", code);
  return id;
}

export interface PreviewView {
  quotedFee: number;
  allowableCap: number;
  totalDirectCost: number;
  grossMargin: number;
  marginPct: number;
  warnings: string[];
  snapshot: Record<string, unknown>;
}

/** Server-side recompute of the operator's canvas edits by BOTH engines. Nothing is saved. */
export async function recomputeAction(code: string, edits: Record<string, unknown>) {
  return act(async (): Promise<PreviewView> => {
    const preview = await recomputeFromCells(await idFor(code), edits, currentActor());
    const r = preview.result;
    return plain({
      quotedFee: r.quotedFee / 100,
      allowableCap: r.allowableCap / 100,
      totalDirectCost: r.totalDirectCost / 100,
      grossMargin: r.grossMargin / 100,
      marginPct: r.marginPct,
      warnings: r.warnings,
      snapshot: preview.snapshot,
    });
  }, { message: "Recomputed by Univer and the L0 model — they agree", revalidate: [] });
}

export async function saveRevisionAction(code: string, edits: Record<string, unknown>) {
  return act(async () => {
    const q = await saveQuotationRevision(await idFor(code), edits, currentActor());
    return { version: q.version };
  }, { message: "Saved as a new version awaiting approval" });
}

export async function approveAndDispatchAction(code: string, quotationId: string) {
  return act(async () => {
    const result = await approveAndDispatch(await idFor(code), quotationId, currentActor());
    return { stage: result.outcome.pkg.operationalStage };
  }, { message: "Gate 1 approved — quotation dispatched, package QUOTED" });
}

export async function draftProposalAction(code: string) {
  return act(async () => requestProposalDraft(await idFor(code), currentActor()), { message: "Sourcing agent queued — the worker drafts the proposal" });
}

export async function clientAcceptedAction(code: string) {
  return act(async () => void (await clientAccepted(await idFor(code), currentActor())), { message: "Client accepted — grant reserved, e-TRiS dossier compiling" });
}

export async function requestRevisionAction(code: string, note?: string) {
  return act(async () => void (await requestRevision(await idFor(code), note ?? "", currentActor())), { message: "Back to draft for revision" });
}
