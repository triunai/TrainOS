"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { FOCUS_RING } from "@/components/kit/tokens";

import { THEME_KEY } from "./theme";

/** FORKED FROM TrainOS layout/ThemeSwitch.tsx — a token swap on <html data-theme>. */

export function ThemeSwitch() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.dataset.theme === "dark"), []);
  const flip = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    try {
      window.localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    } catch {
      /* theme is a preference, not data */
    }
  };
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label="Dark theme"
      title="Toggle dark theme"
      onClick={flip}
      data-rail-exempt=""
      className={cn("flex items-center gap-1 rounded-pill px-1 text-[11px] text-ink-muted", FOCUS_RING)}
    >
      <span aria-hidden="true" className="relative inline-flex h-4 w-7 items-center rounded-pill border border-border bg-surface">
        <span className={cn("absolute h-3 w-3 rounded-full bg-ink transition-transform", dark ? "translate-x-3.5" : "translate-x-0.5")} />
      </span>
    </button>
  );
}

