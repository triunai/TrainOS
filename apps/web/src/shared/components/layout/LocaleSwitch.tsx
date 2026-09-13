import { cn } from "@/shared/lib/utils";
import { FOCUS_RING } from "@/shared/components/kit/tokens";
import { LOCALES, LOCALE_LABEL, useI18n } from "@/shared/i18n";

/**
 * "EN | BM", from the pack's top bar.
 *
 * Two segments in one bordered track rather than a pill group: the pill group
 * is the page's tab vocabulary and this is chrome, and a second pill in the top
 * bar would read as a set of tabs for the whole application.
 *
 * It changes the SHELL's language today — the rail's captions, the footer, the
 * help drawer, the search placeholder — and not the screens. That is the honest
 * state of it, and it is why the switch exists now: the plumbing is easier to
 * verify while it visibly does something.
 */
export function LocaleSwitch({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();

  return (
    <div
      role="group"
      aria-label={t("shell.language")}
      className={cn(
        "inline-flex items-center rounded-control border border-border bg-card p-px",
        className,
      )}
    >
      {LOCALES.map((option) => {
        const active = option === locale;

        return (
          <button
            key={option}
            type="button"
            onClick={() => setLocale(option)}
            aria-pressed={active}
            className={cn(
              "rounded-[5px] px-2 py-0.5 text-[12px] transition-colors",
              active
                ? "bg-surface font-medium text-ink"
                : "text-ink-muted hover:text-ink-secondary",
              FOCUS_RING,
            )}
          >
            {LOCALE_LABEL[option]}
          </button>
        );
      })}
    </div>
  );
}
