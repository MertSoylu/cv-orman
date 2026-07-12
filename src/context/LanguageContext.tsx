"use client";

import { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from "react";

const STORAGE_KEY = "cv-orman-language";

export type Language = "tr" | "en";

function readLanguage(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "tr" || saved === "en") return saved;
  } catch {
    // ignore
  }
  return "tr";
}

const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

function notify() {
  listeners.forEach((l) => l());
}

/** Fixed, matches the RootLayout's hardcoded lang="tr" default -- server and first client render always agree. */
function getServerSnapshot(): Language {
  return "tr";
}

interface LanguageContextValue {
  language: Language;
  isTurkish: boolean;
  toggleLanguage: () => void;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider");
  return ctx;
}

/** Turkish-by-default -- same useSyncExternalStore pattern as DarkModeContext, see there for why. */
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const language = useSyncExternalStore(subscribe, readLanguage, getServerSnapshot);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const toggleLanguage = useCallback(() => {
    const next: Language = readLanguage() === "tr" ? "en" : "tr";
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
    notify();
  }, []);

  return (
    <LanguageContext.Provider value={{ language, isTurkish: language === "tr", toggleLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}
