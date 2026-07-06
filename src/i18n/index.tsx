import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  DICTIONARIES,
  errorMessageFor,
  LOCALES,
  translate,
  type Vars,
} from "./translate";

export { LOCALES } from "./translate";

const FALLBACK_LOCALE = "en";
const STORAGE_KEY = "backupper.locale";

function detectInitialLocale(): string {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  if (stored && DICTIONARIES[stored]) return stored;

  const navLang = (typeof navigator !== "undefined" && navigator.language) ||
    "";
  const short = navLang.slice(0, 2).toLowerCase();
  if (DICTIONARIES[short]) return short;

  return FALLBACK_LOCALE;
}

interface I18nContextValue {
  locale: string;
  setLocale: (locale: string) => void;
  t: (key: string, vars?: Vars) => string;
  errorMessage: (err: unknown) => string;
  locales: string[];
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<string>(detectInitialLocale);

  const setLocale = useCallback((next: string) => {
    if (!DICTIONARIES[next]) return;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    setLocaleState(next);
  }, []);

  const t = useCallback(
    (key: string, vars: Vars = {}) => translate(locale, key, vars),
    [locale],
  );

  const errorMessage = useCallback(
    (err: unknown) => errorMessageFor(locale, err),
    [locale],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, t, errorMessage, locales: LOCALES }),
    [locale, setLocale, t, errorMessage],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
