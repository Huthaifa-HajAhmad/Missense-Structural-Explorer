import React, { createContext, useContext, useState, useEffect } from "react";
import { UserSettings } from "../types";
import {
  DEFAULT_USER_SETTINGS,
  TRANSIENT_SETTING_KEYS,
  TransientSettingKey,
  prefersReducedMotion
} from "../components/settings/defaults";

export const SETTINGS_SECTIONS = [
  "appearance",
  "viewport",
  "sequence",
  "analysis",
  "workspace",
  "connections",
  "data"
] as const;

export type SettingsTabId = (typeof SETTINGS_SECTIONS)[number];

/** Tab ids used by call sites before the settings drawer redesign. */
export type LegacySettingsTabId = "api" | "biophysics" | "about";

const LEGACY_TAB_MAP: Partial<Record<LegacySettingsTabId, SettingsTabId>> = {
  api: "connections",
  biophysics: "analysis",
  about: "data"
};

export type ThemeMode = "light" | "dark" | "system";

interface SettingsContextType {
  theme: ThemeMode;
  isDark: boolean;
  setTheme: React.Dispatch<React.SetStateAction<ThemeMode>>;
  toggleTheme: () => void;
  settings: UserSettings;
  setSettings: React.Dispatch<React.SetStateAction<UserSettings>>;
  updateSetting: <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => void;
  /** Bulk-merge a partial settings object (used by settings import); persists like updateSetting. */
  applySettings: (partial: Partial<UserSettings>) => void;
  resetSettingsToDefault: () => void;
  showPolarContacts: boolean;
  setShowPolarContacts: React.Dispatch<React.SetStateAction<boolean>>;
  isSettingsOpen: boolean;
  setIsSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  settingsTab: SettingsTabId;
  setSettingsTab: React.Dispatch<React.SetStateAction<SettingsTabId>>;
  openSettingsTab: (tab?: SettingsTabId | LegacySettingsTabId) => void;
  hasConfiguredGeminiKey: boolean;
  serverGeminiReady: boolean;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

const SETTINGS_STORAGE_KEY = "missenseUserSettings";
const TRANSIENT_STORAGE_KEY = "missenseTransientCredentials";
const THEME_STORAGE_KEY = "theme";

type TransientCredentials = Pick<UserSettings, TransientSettingKey>;

function readTransientCredentials(): Partial<TransientCredentials> {
  try {
    const raw = sessionStorage.getItem(TRANSIENT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>("appearance");

  /**
   * First run lands on LIGHT.
   *
   * Dark used to be the default, so a first-time visitor on the deployed workspace was dropped
   * into dark mode unasked — and since the choice is written to `theme` on first render (below),
   * that first impression then persisted as if the reader had chosen it. Only the fallback
   * changes: a stored `theme` still wins, including an explicit `system` that follows the OS.
   * Nobody loses a preference they made; only the unasked-for guess does.
   */
  const [theme, setTheme] = useState<ThemeMode>(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      return saved === "light" || saved === "dark" || saved === "system" ? saved : "light";
    } catch {
      return "light";
    }
  });

  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() => {
    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    } catch {
      return;
    }
  }, []);

  const isDark = theme === "system" ? systemPrefersDark : theme === "dark";

  useEffect(() => {
    setTheme((prev) => {
      try {
        localStorage.setItem(THEME_STORAGE_KEY, prev);
      } catch (e) {
        console.error(e);
      }
      return prev;
    });
  }, [theme]);

  const toggleTheme = () => {
    setTheme(isDark ? "light" : "dark");
  };

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add("dark");
      root.style.colorScheme = "dark";
    } else {
      root.classList.remove("dark");
      root.style.colorScheme = "light";
    }
  }, [isDark]);

  const [showPolarContacts, setShowPolarContacts] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if ("showAtomInteractions" in parsed) {
          return !!parsed.showAtomInteractions;
        }
      }
    } catch {}
    return true;
  });

  const [settings, setSettings] = useState<UserSettings>(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
      const parsed = saved ? JSON.parse(saved) : {};

      // Scrub any credential that an older release may have persisted in
      // plaintext (tamarindApiKey and hfToken were leaked here historically).
      let modified = false;
      for (const key of TRANSIENT_SETTING_KEYS) {
        if (parsed[key] !== undefined) {
          delete parsed[key];
          modified = true;
        }
      }
      if (modified && saved) {
        try {
          localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(parsed));
        } catch (e) {}
      }

      const transient = readTransientCredentials();
      // Legacy settings migration: ensure autoZoomOnSelect defaults to false
      // unless explicitly enabled by the user in this version.
      const legacyAutoZoomMigrated = parsed.__autoZoomMigrated === true;
      let effectiveAutoZoom = DEFAULT_USER_SETTINGS.autoZoomOnSelect;
      if (legacyAutoZoomMigrated && parsed.autoZoomOnSelect !== undefined) {
        effectiveAutoZoom = !!parsed.autoZoomOnSelect;
      } else if (!legacyAutoZoomMigrated && parsed.autoZoomOnSelect !== undefined) {
        parsed.autoZoomOnSelect = false;
        parsed.__autoZoomMigrated = true;
        try {
          localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(parsed));
        } catch (_) {}
        effectiveAutoZoom = false;
      }

      const merged: UserSettings = {
        ...DEFAULT_USER_SETTINGS,
        ...parsed,
        autoZoomOnSelect: effectiveAutoZoom,
        geminiApiKey: transient.geminiApiKey || "",
        geminiSessionId: transient.geminiSessionId || "",
        geminiSessionExpiresAt: transient.geminiSessionExpiresAt || 0,
        appApiToken: transient.appApiToken || "",
        biohubApiToken: transient.biohubApiToken || "",
        hfToken: transient.hfToken || "",
        tamarindApiKey: transient.tamarindApiKey || "",
        gpnApiUrl: transient.gpnApiUrl || "",
        alphagenomeApiKey: transient.alphagenomeApiKey || "",
        alphagenomeApiUrl: transient.alphagenomeApiUrl || "",
        show3DLabels: parsed.show3DLabels !== undefined ? !!parsed.show3DLabels : true,
        reducedMotion: parsed.reducedMotion !== undefined ? !!parsed.reducedMotion : prefersReducedMotion(),
        biophysicsConditions: {
          ...DEFAULT_USER_SETTINGS.biophysicsConditions,
          ...(parsed.biophysicsConditions || {})
        }
      };
      return merged;
    } catch {
      return DEFAULT_USER_SETTINGS;
    }
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-accent", settings.primaryAccent || "indigo");
  }, [settings.primaryAccent]);

  const [osReducedMotion, setOsReducedMotion] = useState<boolean>(() => prefersReducedMotion());

  useEffect(() => {
    try {
      const media = window.matchMedia("(prefers-reduced-motion: reduce)");
      const onChange = (e: MediaQueryListEvent) => setOsReducedMotion(e.matches);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    } catch {
      return;
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("reduce-motion", settings.reducedMotion);
    // An explicit "off" overrides the OS-level preference; without the optout
    // class the CSS media query would keep animations suppressed.
    root.classList.toggle("reduce-motion-optout", !settings.reducedMotion && osReducedMotion);
  }, [settings.reducedMotion, osReducedMotion]);

  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

  const updateSetting = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    setSettings((prev) => {
      const updated = { ...prev, [key]: value };
      try {
        const toSave = { ...updated, __autoZoomMigrated: true } as Partial<Record<TransientSettingKey, unknown>> & UserSettings;
        // Credentials live only in sessionStorage for the tab lifetime — never
        // in localStorage, which persists across sessions on disk.
        for (const transientKey of TRANSIENT_SETTING_KEYS) {
          delete toSave[transientKey];
        }
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(toSave));
      } catch (e) {
        console.error(e);
      }

      if ((TRANSIENT_SETTING_KEYS as readonly string[]).includes(key as string)) {
        try {
          const transient = readTransientCredentials();
          (transient as Record<string, unknown>)[key as string] = value;
          sessionStorage.setItem(TRANSIENT_STORAGE_KEY, JSON.stringify(transient));
        } catch (e) {
          console.error("[Settings] sessionStorage write error:", e);
        }
      }

      return updated;
    });
    if (key === "showAtomInteractions") {
      setShowPolarContacts(value as boolean);
    }
  };

  const resetSettingsToDefault = () => {
    setSettings(DEFAULT_USER_SETTINGS);
    setShowPolarContacts(true);
    try {
      const toSave = { ...DEFAULT_USER_SETTINGS } as Partial<Record<TransientSettingKey, unknown>> & UserSettings;
      for (const transientKey of TRANSIENT_SETTING_KEYS) {
        delete toSave[transientKey];
      }
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(toSave));
    } catch (e) {
      console.error(e);
    }
    try {
      sessionStorage.removeItem(TRANSIENT_STORAGE_KEY);
    } catch (e) {}
  };

  const applySettings = (partial: Partial<UserSettings>) => {
    const safe: Partial<UserSettings> = { ...partial };
    // Imported files must never inject credentials into persisted storage.
    for (const transientKey of TRANSIENT_SETTING_KEYS) {
      delete safe[transientKey];
    }
    setSettings((prev) => {
      const updated: UserSettings = {
        ...prev,
        ...safe,
        biophysicsConditions: {
          ...DEFAULT_USER_SETTINGS.biophysicsConditions,
          ...(prev.biophysicsConditions || {}),
          ...(safe.biophysicsConditions || {})
        }
      };
      try {
        const toSave = { ...updated } as Partial<Record<TransientSettingKey, unknown>> & UserSettings;
        for (const transientKey of TRANSIENT_SETTING_KEYS) {
          delete toSave[transientKey];
        }
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(toSave));
      } catch (e) {
        console.error(e);
      }
      if (safe.showAtomInteractions !== undefined) {
        setShowPolarContacts(safe.showAtomInteractions);
      }
      return updated;
    });
  };

  const [serverGeminiReady, setServerGeminiReady] = useState(false);

  useEffect(() => {
    fetch("/api/v1/diagnostics")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.geminiReady) {
          setServerGeminiReady(true);
        }
      })
      .catch(() => {});
  }, []);

  const openSettingsTab = (tab: SettingsTabId | LegacySettingsTabId = "appearance") => {
    setSettingsTab(LEGACY_TAB_MAP[tab as LegacySettingsTabId] ?? (tab as SettingsTabId));
    setIsSettingsOpen(true);
  };

  const hasConfiguredGeminiKey = Boolean(
    serverGeminiReady ||
    settings.geminiApiKey?.trim() ||
    (settings.geminiSessionId && typeof settings.geminiSessionExpiresAt === "number" && settings.geminiSessionExpiresAt > Date.now())
  );

  return (
    <SettingsContext.Provider
      value={{
        theme,
        isDark,
        setTheme,
        toggleTheme,
        settings,
        setSettings,
        updateSetting,
        applySettings,
        resetSettingsToDefault,
        showPolarContacts,
        setShowPolarContacts,
        isSettingsOpen,
        setIsSettingsOpen,
        settingsTab,
        setSettingsTab,
        openSettingsTab,
        hasConfiguredGeminiKey,
        serverGeminiReady,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return context;
}
