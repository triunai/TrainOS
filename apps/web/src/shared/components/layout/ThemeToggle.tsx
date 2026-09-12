import { useEffect, useState } from "react";
import { THEME_CHOICES, useTheme } from "@/shared/theme";

/**
 * Three states: light, dark, system. `system` is the default and is what most
 * readers will stay on, so it is a real option rather than an implicit fallback.
 *
 * Mounted-gate: next-themes cannot know the resolved theme during SSR or the
 * first client render, so rendering the current value before mount produces a
 * flash of the wrong label.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return (
    <label className="flex items-center gap-2">
      <span className="sr-only">Theme</span>
      <select
        value={mounted ? (theme ?? "system") : "system"}
        onChange={(event) => setTheme(event.target.value)}
        className="rounded-control border border-border bg-card px-2 py-1 text-[13px] text-ink-secondary"
      >
        {THEME_CHOICES.map((choice) => (
          <option key={choice} value={choice}>
            {choice[0]?.toUpperCase()}
            {choice.slice(1)}
          </option>
        ))}
      </select>
    </label>
  );
}
