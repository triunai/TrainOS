import { useEffect, useState } from "react";
import { cn } from "@/shared/lib/utils";
import { Switch } from "@/shared/components/ui/switch";
import { useTheme } from "@/shared/theme";
import { useT } from "@/shared/i18n";

/**
 * Light or dark, in one click, beside the profile row.
 *
 * It used to be a three-value select in the top bar and then a radio group
 * inside a menu. Both made the commonest preference in the product cost two
 * interactions and a read. A switch costs one and is legible without opening
 * anything.
 *
 * That trades away `system` as an explicit choice, and the trade is deliberate:
 * `system` is still the DEFAULT and stays in effect until someone touches this,
 * at which point they have expressed a preference and the switch should honour
 * it rather than argue. `resolvedTheme` is what the switch reflects, so while
 * the reader is on `system` the thumb still shows what they are actually
 * looking at.
 *
 * Mounted-gate: next-themes cannot know the resolved theme on the first client
 * render, and a switch that starts in the wrong position and jumps is worse
 * than one that arrives a frame late.
 */
export function ThemeSwitch({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const t = useT();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const dark = mounted && resolvedTheme === "dark";

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span aria-hidden="true" className="text-[11px] text-ink-muted">
        ☀
      </span>
      <Switch
        checked={dark}
        onCheckedChange={(next) => setTheme(next ? "dark" : "light")}
        aria-label={t("shell.darkMode")}
        className="h-4 w-7 border-border bg-border-strong data-[state=checked]:bg-primary"
      />
      <span aria-hidden="true" className="text-[11px] text-ink-muted">
        ☾
      </span>
    </span>
  );
}
