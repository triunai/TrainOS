import { useQuery } from "@tanstack/react-query";
import type { PageRequest } from "@trainos/contract";
import { queryKeys, useApi } from "@/shared/api";

/** The contacts data layer — §5, read through the one boundary. */

export function useContacts(page?: PageRequest) {
  const client = useApi();
  return useQuery({
    queryKey: queryKeys.contacts.list(page),
    queryFn: () => client.listContacts(page),
  });
}

export function useContact(id: string | undefined) {
  const client = useApi();
  return useQuery({
    queryKey: queryKeys.contacts.detail(id ?? ""),
    queryFn: () => client.getContact(id as string),
    enabled: Boolean(id),
  });
}

/**
 * §4 `GET /v1/contacts/{id}/consent` — PDPA consent per channel.
 *
 * The `Contact` record already carries a two-boolean `consent` summary, and
 * this is not that. The summary says whether consent is held; this says WHEN it
 * was recorded, which is the half a person needs before sending anything and
 * the half an auditor asks for. Both are rendered, and the record's booleans
 * are never used to stand in for the dated answer.
 */
export function useContactConsent(id: string | undefined) {
  const client = useApi();
  return useQuery({
    queryKey: [...queryKeys.contacts.detail(id ?? ""), "consent"] as const,
    queryFn: () => client.getContactConsent(id as string),
    enabled: Boolean(id),
  });
}

/**
 * §5 `GET /v1/organisations/{id}/relations`.
 *
 * The contact pane borrows M04-S02's relations anatomy, and these are the
 * ORGANISATION's relations rather than the person's — the pane says so, because
 * attributing a company's engagements and invoices to one employee would be a
 * lie the layout tells silently.
 */
export function useOrganisationRelations(ref: string | undefined) {
  const client = useApi();
  return useQuery({
    queryKey: [...queryKeys.organisations.detail(ref ?? ""), "relations"] as const,
    queryFn: () => client.getOrganisationRelations(ref as string),
    enabled: Boolean(ref),
  });
}
