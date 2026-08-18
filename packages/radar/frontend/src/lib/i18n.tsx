"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { en, type TranslationKey } from "./translations/en";
import { es } from "./translations/es";

type Locale = "en" | "es";

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey) => string;
}

const STORAGE_KEY = "ofr-locale";

const dictionaries: Record<Locale, Record<TranslationKey, string>> = {
  en,
  es,
};

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

/**
 * Detects the initial locale from localStorage or browser language.
 * Falls back to 'en' if detection fails.
 */
function detectInitialLocale(): Locale {
  if (typeof window === "undefined") return "en";

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "es") return stored;
  } catch {
    // localStorage may be unavailable
  }

  try {
    if (navigator.language.startsWith("es")) return "es";
  } catch {
    // navigator may be unavailable in some environments
  }

  return "en";
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  // Initialize locale on mount
  useEffect(() => {
    setLocaleState(detectInitialLocale());
  }, []);

  // Persist locale and update <html lang=""> on change
  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // localStorage may be unavailable
    }
  }, [locale]);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
  }, []);

  const t = useCallback(
    (key: TranslationKey): string => {
      return dictionaries[locale][key] ?? dictionaries.en[key] ?? key;
    },
    [locale]
  );

  const value = useMemo(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation(): I18nContextValue {
  const context = useContext(I18nContext);
  if (context === undefined) {
    throw new Error("useTranslation must be used within an I18nProvider");
  }
  return context;
}
