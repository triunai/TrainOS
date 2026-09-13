import { useState } from "react";
import { KNOWLEDGE_SOURCE_TYPES, RETRIEVAL_SCOPES } from "@trainos/contract";
import type { KnowledgeSourceType, RetrievalScope } from "@trainos/contract";
import { Drawer, ExceptionBanner, PrimaryButton, SecondaryButton } from "@/shared/components/kit";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { useCreateSource } from "./api";

/**
 * "Add source" — the drawer behind M16-S05's primary button.
 *
 * The consequential field is the retrieval scope, and it is the reason this is
 * a drawer rather than a URL box. Scope decides what the agents may cite a
 * document FOR: a compliance-only source can inform a rule check and can never
 * reach client-facing text. Choosing it at ingest is the whole control, and a
 * form that let a source in without asking would make the retrieval policy on
 * the page below a description of a default rather than a decision.
 *
 * A new source lands unindexed. Nothing pretends otherwise: the confirmation
 * says the embedding is queued, because a source that answers from keyword
 * matching until it is vectorised is a different thing from one that is ready.
 */

const TYPE_LABEL: Record<KnowledgeSourceType, string> = {
  HRDC_CIRCULAR: "HRD Corp circular",
};

const SCOPE_LABEL: Record<RetrievalScope, string> = {
  COMPLIANCE: "Compliance answers and rule extraction",
  CLIENT_FACING: "Client-facing generation",
};

export interface AddSourceDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function AddSourceDrawer({ open, onClose }: AddSourceDrawerProps) {
  const create = useCreateSource();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [type, setType] = useState<KnowledgeSourceType>("HRDC_CIRCULAR");
  const [scopes, setScopes] = useState<RetrievalScope[]>(["COMPLIANCE"]);

  const valid = name.trim().length > 0 && scopes.length > 0;

  function submit() {
    create.mutate(
      {
        name: name.trim(),
        type,
        retrievalScopes: scopes,
        ...(url.trim() ? { url: url.trim() } : {}),
      },
      {
        onSuccess: () => {
          setName("");
          setUrl("");
          setScopes(["COMPLIANCE"]);
          onClose();
        },
      },
    );
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="440px"
      title="Add source"
      subtitle="What the agents may read, and what they may cite it for."
      footer={
        <div className="flex items-center justify-end gap-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton disabled={!valid || create.isPending} onClick={submit}>
            Add source
          </PrimaryButton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {create.isError ? (
          <ExceptionBanner
            severity="DANGER"
            title="The source was not added"
            subtitle={`${create.error.message} Nothing was ingested.`}
          />
        ) : null}

        <Field label="Name">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Circular 10/2026"
            className="w-full rounded-control border border-border bg-card px-3 py-2 text-[13px] text-ink"
          />
        </Field>

        <Field label="Type">
          <select
            value={type}
            onChange={(event) => setType(event.target.value as KnowledgeSourceType)}
            className="w-full rounded-control border border-border bg-card px-3 py-2 text-[13px] text-ink"
          >
            {KNOWLEDGE_SOURCE_TYPES.map((option) => (
              <option key={option} value={option}>
                {TYPE_LABEL[option]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Source URL">
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://hrdcorp.gov.my/…"
            className="w-full rounded-control border border-border bg-card px-3 py-2 font-mono text-[13px] text-ink"
          />
          <p className="text-[12px] text-ink-muted">
            A source with a URL is fetched weekly and hashed, so a change opens a rule-change
            review. One without is maintained by hand and the monitor leaves it alone.
          </p>
        </Field>

        <Field label="Retrievable for">
          <div className="flex flex-col gap-2">
            {RETRIEVAL_SCOPES.map((scope) => (
              <label
                key={scope}
                className="flex items-start gap-2.5 text-[13px] text-ink-secondary"
              >
                <Checkbox
                  className="mt-0.5"
                  checked={scopes.includes(scope)}
                  onCheckedChange={(checked) =>
                    setScopes((previous) =>
                      checked === true
                        ? [...previous, scope]
                        : previous.filter((candidate) => candidate !== scope),
                    )
                  }
                />
                {SCOPE_LABEL[scope]}
              </label>
            ))}
          </div>
          <p className="text-[12px] leading-relaxed text-ink-muted">
            Scope is the control, not a tag. A source excluded from client-facing generation can
            inform an internal answer and can never reach a proposal — which is how an internal SOP
            stays useful without ending up in front of a client.
          </p>
        </Field>

        <p className="rounded-control border border-border bg-surface px-3 py-2.5 text-[12px] leading-relaxed text-ink-muted">
          A new source is ingested unindexed. Until its embedding finishes it answers from keyword
          matching, which the table records as{" "}
          <strong className="text-ink-secondary">Pending</strong> rather than showing it as ready.
        </p>
      </div>
    </Drawer>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
        {label}
      </span>
      {children}
    </div>
  );
}
