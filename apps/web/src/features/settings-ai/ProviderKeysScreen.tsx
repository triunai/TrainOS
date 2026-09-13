import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ProviderKey, ProviderKeyStatus } from "@trainos/contract";
import {
  BudgetBar,
  Breadcrumb,
  ContentCard,
  DateText,
  EmptyState,
  ErrorState,
  ExceptionBanner,
  GhostButton,
  LoadingState,
  MoneyText,
  PrimaryButton,
  RecordHeader,
  SecondaryButton,
  StatusChip,
  TierChip,
  humanise,
  tierLabel,
  type StatusTone,
} from "@/shared/components/kit";
import { AddProviderKeyDrawer } from "./AddProviderKeyDrawer";
import { RefusalBanner } from "./RefusalBanner";
import { useProviders, useRevealProvider, useTestProvider } from "./api";
import { AI_MODELS_PATH, USAGE_PATH } from "./paths";

/**
 * M20-S21 · Provider keys — BYOK.
 *
 * Primary user: System Admin only. Primary button: "Add provider key".
 *
 * The screen is the BYOK argument made visible. TrainOS owns the routing, the
 * escalation ladders, the jury and the budget caps; a provider owns nothing but
 * a wire format and a bill. So a customer can bring an Anthropic key, a Google
 * key, a DeepSeek key or any OpenAI-compatible endpoint, scope each one to the
 * tiers it should serve, cap it, and watch the same tier keep behaving the same
 * way underneath. That claim is only credible if the page shows what happens
 * when a key STOPS working — which is why the invalid card names the tier now
 * carrying its traffic rather than saying "invalid" and stopping.
 *
 * States rendered (§4): one invalid key with the live fallback named, one at
 * 90% of cap, one expiring, and one slot with no key at all.
 */

const STATUS_TONE: Record<ProviderKeyStatus, StatusTone> = {
  VALID: "success",
  INVALID: "danger",
  EXPIRING: "warning",
  NOT_SET: "neutral",
};

const STATUS_LABEL: Record<ProviderKeyStatus, string> = {
  VALID: "Valid",
  INVALID: "Invalid",
  EXPIRING: "Expiring",
  NOT_SET: "Not set",
};

/** `1 key`, `2 keys`. A metric sub-line reading "1 keys" undoes the care above it. */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Days until rotation, or null when there is no rotation date. */
function daysUntil(date: string | undefined, from = new Date("2026-11-14T10:32:00+08:00")) {
  if (!date) return null;
  const target = new Date(date);
  if (Number.isNaN(target.getTime())) return null;
  return Math.round((target.getTime() - from.getTime()) / 86_400_000);
}

export function ProviderKeysScreen() {
  const navigate = useNavigate();
  const providers = useProviders();
  const test = useTestProvider();
  const reveal = useRevealProvider();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [revealedFor, setRevealedFor] = useState<string | null>(null);

  const keys = useMemo(() => providers.data?.data ?? [], [providers.data]);
  const invalid = keys.find((provider) => provider.status === "INVALID");

  if (providers.isPending) return <LoadingState rows={8} label="Loading provider keys" />;
  if (providers.isError) {
    return (
      <ErrorState
        title="Provider keys could not be loaded"
        error={providers.error}
        onRetry={() => void providers.refetch()}
      />
    );
  }

  const valid = keys.filter((provider) => provider.status === "VALID").length;
  const spendMonth = keys.reduce((total, provider) => total + provider.spendMonth.amount, 0);
  const passThrough = keys
    .filter((provider) => provider.billingOwner === "PASS_THROUGH")
    .reduce((total, provider) => total + provider.spendMonth.amount, 0);
  const nearCap = keys.filter(
    (provider) => provider.cap && provider.spendMonth.amount / provider.cap.amount >= 0.9,
  ).length;
  const nextRotation = keys
    .map((provider) => provider.rotationDate)
    .filter((date): date is string => Boolean(date))
    .sort()[0];

  return (
    <div className="flex flex-col gap-4 pb-10">
      <div className="px-5 pt-4">
        <Breadcrumb items={[{ label: "Settings" }, { label: "Providers" }, { label: "Keys" }]} />
      </div>

      <RecordHeader
        withoutCondensed
        title="Providers"
        meta={[
          `${keys.length} providers`,
          invalid ? "1 invalid" : "none invalid",
          `${nearCap} at 90% of cap`,
        ]}
        actions={
          <>
            <SecondaryButton onClick={() => navigate(AI_MODELS_PATH)}>Tiers</SecondaryButton>
            <SecondaryButton onClick={() => navigate(USAGE_PATH)}>Usage</SecondaryButton>
          </>
        }
        primaryAction={
          /* AddProviderKeyDrawer's footer holds the solid "Add provider key".
             This opens the drawer, which is not the view's action. */
          <SecondaryButton onClick={() => setDrawerOpen(true)}>Add provider key</SecondaryButton>
        }
        metrics={[
          { label: "Keys valid", value: `${valid} of ${keys.length}` },
          { label: "Spend this month", value: { amount: spendMonth, currency: "MYR" } },
          {
            label: "Pass-through billed",
            value: { amount: passThrough, currency: "MYR" },
            sub: plural(
              keys.filter((provider) => provider.billingOwner === "PASS_THROUGH").length,
              "key",
            ),
          },
          {
            label: "Nearest rotation",
            value: nextRotation ? <DateText value={nextRotation} /> : "—",
          },
          { label: "Keys at 90% cap", value: nearCap },
        ]}
      />

      {/* The danger banner §4 asks for. It names the fallback, because "your key
          is invalid" is an alarm and "your key is invalid and STRONG-1 is being
          served by STRONG-2 in the meantime" is an explanation. */}
      {invalid ? (
        <div className="px-5">
          <ExceptionBanner
            severity="DANGER"
            title={`${invalid.label} key is invalid`}
            subtitle={`Rejected since ${new Date(invalid.invalidSince ?? invalid.lastTestedAt ?? "").toLocaleString("en-MY", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}${
              invalid.activeFallbackTier
                ? ` — ${invalid.scopeTiers.map(tierLabel).join(", ")} has fallen back to ${tierLabel(invalid.activeFallbackTier)} and is still serving traffic.`
                : " — the tiers it scoped have no other key."
            } Nothing has stopped; it is running on the fallback until this is replaced.`}
            action={<GhostButton onClick={() => setDrawerOpen(true)}>Replace key</GhostButton>}
          />
        </div>
      ) : null}

      {test.isError ? (
        <div className="px-5">
          <RefusalBanner title="The connection test failed" error={test.error} />
        </div>
      ) : null}
      {reveal.isError ? (
        <div className="px-5">
          <RefusalBanner title="The key was not revealed" error={reveal.error} />
        </div>
      ) : null}

      <div className="px-5">
        <p className="text-[13px] leading-relaxed text-ink-secondary">
          <strong className="font-medium text-ink">Any key works.</strong> TrainOS owns the tiers,
          the fallback chains, the escalation ladders, the jury and the caps; a provider owns the
          wire format and the invoice. Scope a key to the tiers it should serve and the tier keeps
          behaving identically whichever vendor is underneath — which is also why a dead key
          degrades to a named fallback instead of taking a feature down.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 px-5 md:grid-cols-2 xl:grid-cols-3">
        {keys.map((provider) =>
          provider.status === "NOT_SET" ? (
            <NotSetCard key={provider.id} provider={provider} onAdd={() => setDrawerOpen(true)} />
          ) : (
            <ProviderCard
              key={provider.id}
              provider={provider}
              revealedKey={revealedFor === provider.id ? reveal.data?.key : undefined}
              testing={test.isPending && test.variables === provider.id}
              onTest={() => test.mutate(provider.id)}
              onReveal={() => {
                setRevealedFor(provider.id);
                reveal.mutate(provider.id);
              }}
            />
          ),
        )}
      </div>

      <p className="px-5 text-[12px] leading-relaxed text-ink-muted">
        Keys are stored encrypted and never returned in full by the API. Revealing one is a separate
        call that returns it once and writes a <code>ProviderKeyRevealed</code> entry naming who
        asked and when — so a reveal is a thing that happened to the key, not a property of the
        screen.
      </p>

      <AddProviderKeyDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  );
}

function ProviderCard({
  provider,
  revealedKey,
  testing,
  onTest,
  onReveal,
}: {
  provider: ProviderKey;
  revealedKey?: string;
  testing: boolean;
  onTest: () => void;
  onReveal: () => void;
}) {
  const days = daysUntil(provider.rotationDate);
  const nearCap =
    provider.cap !== undefined && provider.spendMonth.amount / provider.cap.amount >= 0.9;

  return (
    <ContentCard
      title={provider.label}
      eyebrow={humanise(provider.provider)}
      actions={
        <StatusChip tone={STATUS_TONE[provider.status]} shape="square">
          {STATUS_LABEL[provider.status]}
        </StatusChip>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-muted">
          <span>Residency {provider.region}</span>
          <span aria-hidden="true">·</span>
          <span>
            Tested <DateText value={provider.lastTestedAt} withTime />
          </span>
        </div>

        <p className="break-all rounded-control border border-border bg-surface px-2.5 py-1.5 font-mono text-[12px] text-ink-secondary">
          {revealedKey ?? provider.maskedKey}
        </p>

        {revealedKey ? (
          <p className="text-[11px] text-ink-muted">
            Shown once. This reveal has been written to the audit log.
          </p>
        ) : null}

        <div className="flex flex-wrap gap-1.5">
          {provider.scopeTiers.length === 0 ? (
            <span className="text-[12px] text-ink-muted">No tiers scoped</span>
          ) : (
            provider.scopeTiers.map((tier) => <TierChip key={tier} tier={tier} />)
          )}
        </div>

        {provider.cap ? (
          <BudgetBar
            label="Spend this month"
            budget={{
              spend: provider.spendMonth,
              cap: provider.cap,
              /* A key at or past its cap is PAUSED; the 90% band is the
                 contract's own NEAR threshold on budgets, applied here because
                 a provider key has no server-sent BudgetState of its own. */
              state:
                provider.spendMonth.amount >= provider.cap.amount
                  ? "PAUSED"
                  : nearCap
                    ? "NEAR"
                    : "WITHIN",
            }}
          />
        ) : (
          <p className="text-[12px] text-ink-muted">
            Uncapped · <MoneyText value={provider.spendMonth} /> this month
          </p>
        )}

        {nearCap ? (
          <p className="text-[12px] text-warning">
            At {Math.round((provider.spendMonth.amount / (provider.cap?.amount ?? 1)) * 100)}% of
            its cap. Past it, every run scoped to this key pauses rather than overspending.
          </p>
        ) : null}

        {provider.status === "INVALID" && provider.activeFallbackTier ? (
          <p className="text-[12px] text-danger">
            Key rejected · {provider.scopeTiers.map(tierLabel).join(", ")} is served by{" "}
            {tierLabel(provider.activeFallbackTier)} until replaced.
          </p>
        ) : null}

        {provider.status === "EXPIRING" && days !== null ? (
          <p className="text-[12px] text-warning">
            Expires in {days} days. Rotate it before the date or the fallback chain carries the load
            unannounced.
          </p>
        ) : null}

        <p className="text-[12px] text-ink-muted">
          {provider.rotationDate ? (
            <>
              Rotates <DateText value={provider.rotationDate} />
            </>
          ) : (
            "No rotation date set"
          )}{" "}
          · Billed to {provider.billingOwner === "PASS_THROUGH" ? "pass-through" : "client account"}{" "}
          · Added by {provider.addedBy.name}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <SecondaryButton onClick={onTest} disabled={testing}>
            {testing ? "Testing…" : "Test connection"}
          </SecondaryButton>
          <SecondaryButton onClick={onReveal}>Reveal key</SecondaryButton>
          <GhostButton>Audit</GhostButton>
        </div>
      </div>
    </ContentCard>
  );
}

/** The first-run empty state: a slot exists and no key has been saved into it. */
function NotSetCard({ provider, onAdd }: { provider: ProviderKey; onAdd: () => void }) {
  return (
    <ContentCard
      className="border-dashed"
      title={provider.label}
      eyebrow={humanise(provider.provider)}
      actions={<StatusChip>{STATUS_LABEL.NOT_SET}</StatusChip>}
    >
      <EmptyState
        glyph="⌗"
        title="No embeddings key"
        description="Knowledge search and rule extraction fall back to keyword matching until an embeddings key is added. Residency for this provider is shown before the key is saved."
        action={<SecondaryButton onClick={onAdd}>Add key</SecondaryButton>}
      />
    </ContentCard>
  );
}
