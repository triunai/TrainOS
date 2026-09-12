import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

/**
 * Theme is a straight token swap: `data-theme="dark"` flips the custom
 * properties in `src/styles/tokens.css` and nothing else changes. No component
 * reads the theme to decide how to look.
 *
 * `attribute="data-theme"` rather than a class, because the tokens file is
 * written against that attribute and the design pack's dark map is defined the
 * same way.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      themes={["light", "dark"]}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}

/** The three states a reader can choose between. */
export const THEME_CHOICES = ["light", "dark", "system"] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];
