import Link from "next/link";
import { Banner, Body, Checkbox, DataTable, Field, LINK_BUTTON, MiniBar, MoneyInput, PageHeader, Section, Select, StatusChip, TextInput, type StatusTone } from "@/components/kit";
import { ActionButton } from "@/components/actions/ActionButton";
import { FormDrawer } from "@/components/forms/FormDrawer";
import { Frame } from "@/components/shell/Frame";
import { formatDate } from "@/lib/dates";
import { formatRM } from "@/lib/money";
import { plain } from "@/server/actions";
import { listProviderKeys, listTierConfig, PROVIDER_IDS, TIER_KEYS } from "@/server/ai";
import { addKeyAction, disableKeyAction, testKeyAction, updateTierAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI providers" };

const STATUS_TONE: Record<string, StatusTone> = { VALID: "success", INVALID: "danger", UNTESTED: "warning", DISABLED: "neutral" };
const PROVIDER_LABEL: Record<string, string> = { anthropic: "Anthropic", openrouter: "OpenRouter", deepseek: "DeepSeek", gemini: "Google Gemini", "openai-compatible": "OpenAI-compatible" };

export default async function ProviderKeysPage() {
  const [keys, tiers] = await Promise.all([listProviderKeys().then(plain), listTierConfig().then(plain)]);
  const valid = keys.filter((k) => k.status === "VALID" || k.source === "env").length;
  const invalid = keys.filter((k) => k.status === "INVALID");
  const spend = keys.reduce((a, k) => a + Number(k.monthToDateMyr), 0);
  return (
    <Frame crumbs={[{ label: "Settings" }, { label: "AI providers" }]}>
      <PageHeader
        title="Providers"
        summary={`${keys.length} key${keys.length === 1 ? "" : "s"} · ${valid} usable · ${formatRM(spend)} this month`}
        actions={
          <>
            <Link href="/settings/ai/usage" className={LINK_BUTTON.secondary}>Usage</Link>
            <FormDrawer trigger="Add provider key" title="Add provider key" subtitle="Encrypted at rest with AES-256-GCM · never logged · shown masked" action={addKeyAction} submitLabel="Store key">
              <Field label="Provider">
                <Select name="provider" defaultValue="deepseek">
                  {PROVIDER_IDS.map((p) => (
                    <option key={p} value={p}>{PROVIDER_LABEL[p] ?? p}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Label"><TextInput name="label" required placeholder="DeepSeek platform" /></Field>
              <Field label="API key"><TextInput name="key" type="password" autoComplete="off" required /></Field>
              <Field label="Base URL" hint="Only for OpenAI-compatible endpoints or a gateway"><TextInput name="baseUrl" placeholder="https://…" /></Field>
              <Field label="Serve tiers" hint="None ticked = any tier may use this key">
                <div className="flex flex-wrap gap-3">
                  {TIER_KEYS.map((t) => (
                    <Checkbox key={t} name="tiers" value={t} label={t} />
                  ))}
                </div>
              </Field>
              <Field label="Monthly cap (optional)" hint="At the cap, runs scoped to this key pause and the tier falls back"><MoneyInput name="monthlyCapMyr" /></Field>
            </FormDrawer>
          </>
        }
      />
      <Body>
        {invalid.map((k) => (
          <Banner key={k.id} tone="danger" title={`${k.label} key is invalid`}>
            Rejected since {formatDate(k.lastTestedAt, true)} — the tiers it served fall back to the next provider in their chain, and to the deterministic template when none is left. Nothing stops; replace the key.
          </Banner>
        ))}
        <p className="text-[13px] leading-relaxed text-ink-secondary">
          <span className="font-semibold text-ink">Any key works.</span> TPMS owns the tiers, the fallback chains and the caps; a provider owns the wire format and the invoice. With no key at all, every agent still
          runs on its deterministic template and says so in its provenance — add a DeepSeek key for L3, a Claude key for L4 and a Gemini key for L1 and the same agents switch to models on the next call.
        </p>
        {keys.length === 0 ? (
          <Section title="No keys yet">
            <p className="text-[13px] text-ink-secondary">Add keys here, or set <span className="font-mono">DEEPSEEK_API_KEY</span>, <span className="font-mono">ANTHROPIC_API_KEY</span>, <span className="font-mono">GEMINI_API_KEY</span> or <span className="font-mono">OPENROUTER_API_KEY</span> in the environment.</p>
          </Section>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {keys.map((k) => {
              const cap = k.monthlyCapMyr ? Number(k.monthlyCapMyr) : null;
              return (
                <section key={k.id} className="flex flex-col gap-3 rounded-card border border-border bg-card">
                  <div className="flex items-start gap-2 border-b border-divider px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">{PROVIDER_LABEL[k.provider] ?? k.provider}</p>
                      <p className="truncate text-[15px] font-semibold text-ink">{k.label}</p>
                    </div>
                    <StatusChip tone={k.source === "env" ? "info" : STATUS_TONE[k.status] ?? "neutral"}>{k.source === "env" ? "Environment" : k.status.toLowerCase()}</StatusChip>
                  </div>
                  <div className="flex flex-col gap-3 px-4 pb-4">
                    <p className="text-[12px] text-ink-muted">{k.lastTestedAt ? `Tested ${formatDate(k.lastTestedAt, true)}` : "Not tested yet"}{k.baseUrl ? ` · ${k.baseUrl}` : ""}</p>
                    <div className="rounded-control border border-border bg-surface px-3 py-2 font-mono text-[12px] text-ink">{k.maskedKey}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {(k.tiers.length ? k.tiers : ["ALL TIERS"]).map((t) => (
                        <span key={t} className="rounded-[4px] border border-border px-1.5 py-0.5 font-mono text-[11px] text-ink-secondary">{t}</span>
                      ))}
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between text-[12px]">
                        <span className="text-ink-secondary">Spend this month</span>
                        <span className="tabular-nums text-ink-secondary">{formatRM(k.monthToDateMyr)}{cap !== null ? ` of ${formatRM(cap)}` : ""}</span>
                      </div>
                      {cap !== null ? <MiniBar value={cap > 0 ? Number(k.monthToDateMyr) / cap : 1} state={k.capState === "PAUSED" ? "danger" : k.capState === "NEAR" ? "warning" : "neutral"} label="Spend against cap" /> : null}
                    </div>
                    {k.lastTestResult ? <p className="text-[12px] text-ink-secondary">{k.lastTestResult}</p> : null}
                    {k.readOnly ? (
                      <p className="text-[12px] text-ink-muted">Managed in the deployment environment.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <ActionButton action={testKeyAction} args={[k.id]} label="Test connection" />
                        {k.status !== "DISABLED" ? <ActionButton action={disableKeyAction} args={[k.id]} label="Disable" kind="ghost" confirm={{ title: `Disable ${k.label}?`, body: "Tiers served by this key fall back down their chains immediately." }} /> : null}
                      </div>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
        <Section eyebrow="Routing" title="Tier configuration" flush>
          <DataTable
            label="Tiers"
            rows={tiers}
            rowKey={(t) => t.tier}
            columns={[
              { key: "tier", label: "Tier", cell: (t) => <span className="font-mono">{t.tier}</span> },
              { key: "label", label: "Role", cell: (t) => t.label },
              { key: "primary", label: "Primary", cell: (t) => <span className="font-mono text-[12px]">{t.provider} · {t.model}</span> },
              { key: "fallback", label: "Fallback chain", cell: (t) => <span className="font-mono text-[12px] text-ink-secondary">{t.fallback.map((f) => `${f.provider}/${f.model}`).join(" → ") || "template"} → template</span> },
              { key: "cap", label: "Monthly cap", align: "right", cell: (t) => formatRM(t.monthlyCapMyr) },
              { key: "enabled", label: "State", cell: (t) => <StatusChip tone={t.enabled ? "neutral" : "warning"}>{t.enabled ? "enabled" : "template only"}</StatusChip> },
              {
                key: "edit",
                label: "",
                cell: (t) => (
                  <FormDrawer trigger="Edit" triggerKind="ghost" title={`Tier ${t.tier} · ${t.label}`} action={updateTierAction} submitLabel="Save routing">
                    <input type="hidden" name="tier" value={t.tier} />
                    <Field label="Provider">
                      <Select name="provider" defaultValue={t.provider}>
                        {PROVIDER_IDS.map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Model"><TextInput name="model" defaultValue={t.model} /></Field>
                    <Field label="Monthly cap"><MoneyInput name="monthlyCapMyr" defaultValue={t.monthlyCapMyr} /></Field>
                    <Field label="Max output tokens"><TextInput name="maxTokens" type="number" defaultValue={t.maxTokens} /></Field>
                    <Checkbox name="enabled" defaultChecked={t.enabled} label="Enabled (off = deterministic template only)" />
                  </FormDrawer>
                ),
              },
            ]}
          />
        </Section>
      </Body>
    </Frame>
  );
}
