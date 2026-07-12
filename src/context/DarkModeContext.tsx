"use client";

import { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from "react";

const STORAGE_KEY = "cv-orman-dark-mode";

function readIsDark(): boolean {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved !== null ? JSON.parse(saved) : true;
  } catch {
    return true;
  }
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

/** Fixed, matches layout.tsx's pre-hydration script default -- server and first client render always agree. */
function getServerSnapshot(): boolean {
  return true;
}

interface DarkModeContextValue {
  isDark: boolean;
  toggleDarkMode: () => void;
}

const DarkModeContext = createContext<DarkModeContextValue | undefined>(undefined);

export function useDarkMode(): DarkModeContextValue {
  const ctx = useContext(DarkModeContext);
  if (!ctx) throw new Error("useDarkMode must be used within DarkModeProvider");
  return ctx;
}

/**
 * Dark-by-default, own localStorage key (independent of mertsoylu.dev's own
 * toggle state). Reads localStorage via useSyncExternalStore rather than
 * state+effect, since "apply saved preference" is synchronizing with an
 * external store, not deriving React state -- the effect below only mutates
 * the DOM (a legitimate effect use), it never calls setState.
 */
export function DarkModeProvider({ children }: { children: React.ReactNode }) {
  const isDark = useSyncExternalStore(subscribe, readIsDark, getServerSnapshot);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  const toggleDarkMode = useCallback(() => {
    const next = !readIsDark();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore (private browsing / storage disabled)
    }
    notify();
  }, []);

  return <DarkModeContext.Provider value={{ isDark, toggleDarkMode }}>{children}</DarkModeContext.Provider>;
}
