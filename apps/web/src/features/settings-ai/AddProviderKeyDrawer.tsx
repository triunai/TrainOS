import { useState } from "react";
import { AI_PROVIDERS, TIER_KEYS } from "@trainos/contract";
import type { AiProvider, BillingOwner, Money, TierKey } from "@trainos/contract";
import {
  DateField,
  Drawer,
  Field,
  humanise,
  MoneyInput,
  PrimaryButton,
  RefusalBanner,
  SecondaryButton,
  TextField,
  tierLabel,
} from "@/shared/components/kit";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { useCreateProvider } from "./api";

/**
 * "Add provider key" — the drawer behind M20-S21's primary button.
 *
 * §4 lists the fields the pack drew: provider, key, label, scope, cap, billing
 * owner and a residency note. All seven are here, and the residency note is
 * shown BEFORE the key is saved rather than after, because the PDPA call it
 * asks the customer to make is only a real choice while the key is still in
 * their hands.
 *
 * The key itself is write-only. §17: the API never returns it, so this form
 * posts it once and the record that comes back is masked. There is no state in
 * this component that holds the key after the request resolves.
 */

/** Where each provider's traffic physically lands. Shown before the key is saved. */
const RESIDENCY: Record<AiProvider, string> = {
  ANTHROPIC: "US",
  GOOGLE: "SG",
  OPENAI: "US",
  DEEPSEEK: "CN",
  /* Contract R4 added the two BYOK entries. A gateway routes to whichever
     upstream it picks and a self-declared endpoint is wherever its operator
     put it, so neither can be stated as a fact. Saying "unknown" is the honest
     rendering; inventing a country here would be worse than the gap. */
  OPENROUTER: "Routed — varies by upstream",
  OTHER: "Unknown",
};

export interface AddProviderKeyDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function AddProviderKeyDrawer({ open, onClose }: AddProviderKeyDrawerProps) {
  const create = useCreateProvider();
  const [provider, setProvider] = useState<AiProvider>("ANTHROPIC");
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [scopeTiers, setScopeTiers] = useState<TierKey[]>([]);
  const [cap, setCap] = useState<Money | null>(null);
  const [billingOwner, setBillingOwner] = useState<BillingOwner>("CLIENT_ACCOUNT");
  const [rotationDate, setRotationDate] = useState("");

  const valid = label.trim().length > 0 && key.trim().length > 0 && scopeTiers.length > 0;

  function submit() {
    create.mutate(
      {
        provider,
        label: label.trim(),
        key: key.trim(),
        scopeTiers,
        billingOwner,
        region: RESIDENCY[provider],
        ...(cap ? { cap } : {}),
        ...(rotationDate ? { rotationDate } : {}),
      },
      {
        onSuccess: () => {
          /* The key never outlives the request. */
          setKey("");
          setLabel("");
          setScopeTiers([]);
          setCap(null);
          onClose();
        },
      },
    );
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="460px"
      title="Add provider key"
      subtitle="Bring your own key — the tier keeps its behaviour whichever provider serves it."
      footer={
        <div className="flex items-center justify-end gap-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton disabled={!valid || create.isPending} onClick={submit}>
            Add provider key
          </PrimaryButton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {create.isError ? (
          <RefusalBanner title="The key was not saved" error={create.error} />
        ) : null}

        <Field
          label="Provider"
          hint="Any OpenAI-compatible endpoint also works — OpenRouter, Cerebras, Groq or your own host — because routing, escalation and the jury are ours and only the wire format is theirs."
        >
          {(control) => (
            <select
              {...control}
              value={provider}
              onChange={(event) => setProvider(event.target.value as AiProvider)}
              className="w-full rounded-control border border-border bg-card px-3 py-2 text-[13px] text-ink"
            >
              {AI_PROVIDERS.map((option) => (
                <option key={option} value={option}>
                  {humanise(option)}
                </option>
              ))}
            </select>
          )}
        </Field>

        <TextField label="Label" value={label} onChange={setLabel} placeholder="Anthropic direct" />

        <TextField
          label="Key"
          type="password"
          value={key}
          onChange={setKey}
          placeholder="sk-…"
          autoComplete="off"
          mono
          hint="Stored encrypted and never returned in full. Every read gives back the masked form; revealing it again is a separate, audited action."
        />

        <Field label="Scope — which tiers this key serves">
          {(control) => (
            <div {...control} className="grid grid-cols-3 gap-2">
              {TIER_KEYS.map((tier) => (
                <label
                  key={tier}
                  className="flex items-center gap-2 text-[12px] text-ink-secondary"
                >
                  <Checkbox
                    checked={scopeTiers.includes(tier)}
                    onCheckedChange={(checked) =>
                      setScopeTiers((previous) =>
                        checked === true
                          ? [...previous, tier]
                          : previous.filter((candidate) => candidate !== tier),
                      )
                    }
                  />
                  {tierLabel(tier)}
                </label>
              ))}
            </div>
          )}
        </Field>

        <MoneyInput
          label="Monthly cap"
          value={cap}
          onChange={setCap}
          hint="A tripped cap pauses every run requesting this key rather than spending past it."
        />

        <Field label="Billing owner">
          {(control) => (
            <select
              {...control}
              value={billingOwner}
              onChange={(event) => setBillingOwner(event.target.value as BillingOwner)}
              className="w-full rounded-control border border-border bg-card px-3 py-2 text-[13px] text-ink"
            >
              <option value="CLIENT_ACCOUNT">Client account</option>
              <option value="PASS_THROUGH">Pass-through</option>
            </select>
          )}
        </Field>

        <DateField label="Rotation date" value={rotationDate} onChange={setRotationDate} />

        <div className="rounded-control border border-border bg-surface px-3 py-2.5">
          <p className="text-[12px] font-medium text-ink">Data residency · {RESIDENCY[provider]}</p>
          <p className="pt-0.5 text-[12px] leading-relaxed text-ink-muted">
            Prompts sent through this key are processed in {RESIDENCY[provider]}. Shown before the
            key is saved so the PDPA decision is made knowingly rather than discovered afterwards.
          </p>
        </div>
      </div>
    </Drawer>
  );
}
