import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useMe } from "@/shared/hooks/useMe";
import { en, type MessageKey, type Messages } from "./en";
import { ms } from "./ms";

/**
 * Locale, and the shell's own strings in it.
 *
 * PLUMBING, deliberately. The switch in the top bar is real, the two shell
 * catalogues are real, `<html lang>` is real, and the choice survives a reload.
 * The screens are NOT translated: a full catalogue is a pass with a reviewer
 * who speaks the language, and half a product in Bahasa Malaysia reads worse
 * than none of it.
 *
 * The initial value comes from `getMe().locale` — the contract already carries
 * a BCP-47 locale on the principal, so a stored preference is an OVERRIDE of
 * the account's, not the source of truth. When `PATCH /v1/me` exists this
 * writes through to it and the localStorage line goes.
 *
 * `t` returns the English string for a key with no translation rather than the
 * key itself. A reader who sees an English label knows less than they might; a
 * reader who sees `shortcuts.close` knows nothing and files a bug.
 */

export const LOCALES = ["en-MY", "ms-MY"] as const;
export type Locale = (typeof LOCALES)[number];

const CATALOGUES: Readonly<Record<Locale, Messages>> = { "en-MY": en, "ms-MY": ms };

/** What the top bar draws for each, per the pack's "EN | BM". */
export const LOCALE_LABEL: Readonly<Record<Locale, string>> = {
  "en-MY": "EN",
  "ms-MY": "BM",
};

const STORAGE_KEY = "trainos.locale";

export interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (LOCALES as readonly string[]).includes(value);

function readStored(): Locale | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isLocale(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const { me } = useMe();
  const accountLocale: Locale = isLocale(me.locale) ? me.locale : "en-MY";
  const [locale, setLocaleState] = useState<Locale>(() => readStored() ?? accountLocale);

  /* The lang attribute is not decoration: it is what a screen reader picks a
     voice from, and what a browser offers to translate. */
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* A blocked store is not worth a broken switch. */
    }
  }, []);

  const value = useMemo<I18nContextValue>(() => {
    const catalogue = CATALOGUES[locale];
    return { locale, setLocale, t: (key) => catalogue[key] ?? en[key] };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside <I18nProvider>");
  return value;
}

/** The common case: just the translator. */
export function useT(): (key: MessageKey) => string {
  return useI18n().t;
}

export function useLocale(): Locale {
  return useI18n().locale;
}
