import type { ReactNode } from "react";
import type { PipelineObject } from "@trainos/contract";
import {
  ContentCard,
  ErrorState,
  LifecycleStepper,
  LoadingState,
  RecordHeader,
  StatusChip,
  humanise,
} from "@/shared/components/kit";
import { useBreadcrumb } from "@/shared/components/layout";
import { useMeRecord, usePipeline, useTenant } from "./api";

/**
 * `/settings/organisation` — what this company is configured as.
 *
 * No artboard, and no write endpoint either. The contract keeps tenancy
 * implicit in the token (§1), so there is no `PATCH /v1/organisation` to build
 * a form against. That is the screen's shape rather than its limitation: it
 * answers "what is this console configured to believe" and says, per section,
 * who would have to change it.
 *
 * NO DISABLED SAVE BUTTON. A greyed-out control implies the write exists and
 * that the reader merely lacks the rights; here the write does not exist at
 * all, and rendering one would be a promise the API cannot keep. Each section
 * names the role instead — CLAUDE.md's rule that a filtered rail is a rendering
 * convenience and the API is the authorization boundary cuts both ways: the UI
 * must not hide a refusal, and it must not imply an affordance either.
 *
 * THE PIPELINES ARE THE POINT. Three configured objects, every stage name and
 * order read from `GET /v1/config/pipelines` — the one standing rule this
 * screen exists to make visible. A reader who wants to know what "Delivered"
 * means, or what comes after it, looks here and sees the server's answer.
 */

const PIPELINES: { object: PipelineObject; caption: string }[] = [
  { object: "ENGAGEMENT", caption: "Delivery, from won to paid" },
  { object: "DEAL_CHAIN", caption: "The commercial chain behind a deal" },
  { object: "OPPORTUNITY", caption: "How an opportunity is qualified" },
];

/** One labelled fact. Two columns so the values line up down the card. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-4 py-1.5">
      <dt className="w-40 shrink-0 text-[12px] text-ink-muted">{label}</dt>
      <dd className="min-w-0 flex-1 text-[13px] text-ink">{children}</dd>
    </div>
  );
}

/** Who has to be asked, said once and in the same words everywhere. */
function ChangedBy({ role, how }: { role: string; how: string }) {
  return (
    <p className="pt-3 text-[12px] leading-relaxed text-ink-muted">
      {`Changed by ${role}. ${how}`}
    </p>
  );
}

function PipelineCard({ object, caption }: { object: PipelineObject; caption: string }) {
  const pipeline = usePipeline(object);

  return (
    <div className="flex flex-col gap-2 border-t border-divider pt-4 first:border-t-0 first:pt-0">
      <div className="flex items-baseline gap-3">
        <h3 className="text-[13px] font-medium text-ink">{humanise(object)}</h3>
        <span className="text-[12px] text-ink-muted">{caption}</span>
        {pipeline.data ? (
          <span className="ml-auto text-[12px] tabular-nums text-ink-muted">
            {`${pipeline.data.stages.length} stages`}
          </span>
        ) : null}
      </div>

      {pipeline.isPending ? (
        <LoadingState rows={1} label={`Loading the ${humanise(object).toLowerCase()} pipeline`} />
      ) : null}

      {pipeline.isError ? (
        <ErrorState
          title={`The ${humanise(object).toLowerCase()} pipeline could not be loaded`}
          error={pipeline.error}
          onRetry={() => void pipeline.refetch()}
        />
      ) : null}

      {pipeline.data ? (
        /* Every stage neutral: this is the configured pipeline, not a record
           moving through one. A "current" dot here would claim a position no
           record holds. */
        <LifecycleStepper
          variant="header"
          stages={pipeline.data.stages}
          steps={pipeline.data.stages.map((stage) => ({
            key: stage.key,
            label: stage.label,
            state: "PENDING" as const,
          }))}
        />
      ) : null}
    </div>
  );
}

export function OrganisationSettingsScreen() {
  useBreadcrumb([{ label: "Settings" }, { label: "Organisation" }]);

  const tenant = useTenant();
  const me = useMeRecord();

  if (tenant.isPending && me.isPending) {
    return <LoadingState rows={8} label="Loading the organisation settings" />;
  }

  if (tenant.isError && me.isError) {
    return (
      <ErrorState
        title="The organisation settings could not be loaded"
        error={tenant.error}
        onRetry={() => {
          void tenant.refetch();
          void me.refetch();
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-10">
      <RecordHeader
        withoutCondensed
        title="Organisation"
        meta={[
          tenant.data?.name ?? null,
          tenant.data ? `${tenant.data.currency} · ${tenant.data.timezone}` : null,
          "read-only",
        ]}
        /* No actions and no primary. Nothing on this page writes, and the
           sections say who would have to. */
      />

      <div className="px-5">
        <ContentCard title="Profile">
          {tenant.isPending ? <LoadingState rows={4} label="Loading the organisation" /> : null}

          {tenant.isError ? (
            <ErrorState
              title="The organisation could not be loaded"
              error={tenant.error}
              onRetry={() => void tenant.refetch()}
            />
          ) : null}

          {tenant.data ? (
            <>
              <dl className="flex flex-col divide-y divide-divider">
                <Row label="Registered name">{tenant.data.name}</Row>
                <Row label="Currency">
                  {/* Not a preference. Money is integer minor units across the
                      contract, so this is the unit every figure in the console
                      is denominated in. */}
                  <span className="font-mono text-[12px]">{tenant.data.currency}</span>
                </Row>
                <Row label="Time zone">
                  <span className="font-mono text-[12px]">{tenant.data.timezone}</span>
                </Row>
                <Row label="Locale">
                  <span className="font-mono text-[12px]">{tenant.data.locale}</span>
                </Row>
              </dl>
              <ChangedBy
                role="an administrator"
                how="The contract keeps the tenant implicit in the token, so there is no organisation endpoint to write to — a change here is a change to the account, made outside this console."
              />
            </>
          ) : null}
        </ContentCard>
      </div>

      <div className="px-5">
        <ContentCard title="Pipelines">
          <div className="flex flex-col gap-4">
            {PIPELINES.map((entry) => (
              <PipelineCard key={entry.object} object={entry.object} caption={entry.caption} />
            ))}
          </div>
          <ChangedBy
            role="an administrator"
            how="Stage names and their order come from the pipeline configuration and never from this console, so renaming a stage moves every stepper on every screen at once."
          />
        </ContentCard>
      </div>

      <div className="px-5">
        <ContentCard title="Your access">
          {me.isPending ? <LoadingState rows={4} label="Loading your account" /> : null}

          {me.isError ? (
            <ErrorState
              title="Your account could not be loaded"
              error={me.error}
              onRetry={() => void me.refetch()}
            />
          ) : null}

          {me.data ? (
            <>
              <dl className="flex flex-col divide-y divide-divider">
                <Row label="Signed in as">{me.data.name}</Row>
                <Row label="Role">
                  <StatusChip tone="neutral">{humanise(me.data.role)}</StatusChip>
                </Row>
                <Row label="Clients you can see">{humanise(me.data.dataScope.clients)}</Row>
                <Row label="Teams you can see">{humanise(me.data.dataScope.teams)}</Row>
                <Row label="Permissions">
                  {me.data.permissions.length === 0 ? (
                    <span className="text-ink-muted">None recorded</span>
                  ) : (
                    <span className="flex flex-wrap gap-1.5">
                      {me.data.permissions.map((permission) => (
                        <span
                          key={permission}
                          className="rounded-control border border-border px-1.5 py-0.5 font-mono text-[11px] text-ink-secondary"
                        >
                          {permission}
                        </span>
                      ))}
                    </span>
                  )}
                </Row>
              </dl>
              <ChangedBy
                role="an administrator"
                how="This is what the server believes about you, not what the role switcher in the sidebar is painting. When the two disagree, the server wins and a denied write says so."
              />
            </>
          ) : null}
        </ContentCard>
      </div>
    </div>
  );
}
