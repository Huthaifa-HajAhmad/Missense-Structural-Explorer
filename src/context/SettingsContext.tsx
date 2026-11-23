import React, { createContext, useCallback, useContext, useState, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { UserSettings } from "../types";
import {
  DEFAULT_USER_SETTINGS,
  TRANSIENT_SETTING_KEYS,
  TransientSettingKey,
  prefersReducedMotion
} from "../components/settings/defaults";
import { useDiagnostics } from "../hooks/useDiagnostics";
import { geminiCredentials } from "../shared/geminiCredentials";

export const SETTINGS_SECTIONS = [
  "appearance",
  "viewport",
  "sequence",
  "analysis",
  "workspace",
  "connections",
  "data",
  "account",
  "team"
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

function serializePersistedSettingsPayload(target: UserSettings): string {
  const toSave = {
    ...target,
    __autoZoomMigrated: true
  } as Partial<Record<TransientSettingKey, unknown>> & UserSettings & { __autoZoomMigrated: boolean };
  // Credentials live only in sessionStorage for the tab lifetime — never
  // in localStorage, which persists across sessions on disk.
  for (const transientKey of TRANSIENT_SETTING_KEYS) {
    delete toSave[transientKey];
  }
  return JSON.stringify(toSave);
}

function loadInitialSettingsState(): { initialSettings: UserSettings; needsPersistOnMount: boolean } {
  try {
    const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : {};

    // Scrub any credential that an older release may have persisted in
    // plaintext (tamarindApiKey and hfToken were leaked here historically).
    let needsPersistOnMount = false;
    // `hfToken` and `gpnApiUrl` belonged to the retired GPN-MSA integration; `biohubApiToken` and
    // `defaultStructureModel` to the retired ESMFold view.
    for (const key of [...TRANSIENT_SETTING_KEYS, "hfToken", "gpnApiUrl", "biohubApiToken", "defaultStructureModel"]) {
      if (parsed[key] !== undefined) {
        delete parsed[key];
        if (saved) needsPersistOnMount = true;
      }
    }

    const transient = readTransientCredentials();
    // A Biohub token an older release kept for this tab: drop it from the stored copy too, so a later
    // credential write does not carry it forward.
    if ("biohubApiToken" in transient) {
      delete (transient as Record<string, unknown>).biohubApiToken;
      try {
        sessionStorage.setItem(TRANSIENT_STORAGE_KEY, JSON.stringify(transient));
      } catch {
        // Session storage may be blocked; the token is then not stored either.
      }
    }
    // Legacy settings migration: ensure autoZoomOnSelect defaults to false
    // unless explicitly enabled by the user in this version.
    const legacyAutoZoomMigrated = parsed.__autoZoomMigrated === true;
    delete parsed.__autoZoomMigrated;
    let effectiveAutoZoom = DEFAULT_USER_SETTINGS.autoZoomOnSelect;
    if (legacyAutoZoomMigrated && parsed.autoZoomOnSelect !== undefined) {
      effectiveAutoZoom = !!parsed.autoZoomOnSelect;
    } else if (!legacyAutoZoomMigrated && parsed.autoZoomOnSelect !== undefined) {
      parsed.autoZoomOnSelect = false;
      needsPersistOnMount = true;
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
      japanfoldApiKey: transient.japanfoldApiKey || "",
      tamarindApiKey: transient.tamarindApiKey || "",
      alphagenomeApiKey: transient.alphagenomeApiKey || "",
      alphagenomeApiUrl: transient.alphagenomeApiUrl || "",
      show3DLabels: parsed.show3DLabels !== undefined ? !!parsed.show3DLabels : true,
      reducedMotion: parsed.reducedMotion !== undefined ? !!parsed.reducedMotion : prefersReducedMotion(),
      biophysicsConditions: {
        ...DEFAULT_USER_SETTINGS.biophysicsConditions,
        ...(parsed.biophysicsConditions || {})
      }
    };
    return { initialSettings: merged, needsPersistOnMount };
  } catch {
    return { initialSettings: { ...DEFAULT_USER_SETTINGS }, needsPersistOnMount: false };
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
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (e) {
      console.warn("[Settings] Could not save the theme preference:", e);
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(isDark ? "light" : "dark");
  }, [isDark]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    // Theme changes are one paint, not independent surface and text crossfades.
    const freeze = document.createElement("style");
    freeze.textContent = "*, *::before, *::after { transition: none !important; }";
    document.head.appendChild(freeze);
    if (isDark) {
      root.classList.add("dark");
      root.style.colorScheme = "dark";
    } else {
      root.classList.remove("dark");
      root.style.colorScheme = "light";
    }
    void root.offsetHeight;
    const frame = requestAnimationFrame(() => freeze.remove());
    return () => {
      cancelAnimationFrame(frame);
      freeze.remove();
    };
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

  const initialSettingsMetaRef = useRef<{ initialSettings: UserSettings; needsPersistOnMount: boolean } | null>(null);
  if (initialSettingsMetaRef.current === null) {
    initialSettingsMetaRef.current = loadInitialSettingsState();
  }

  const [settings, setSettings] = useState<UserSettings>(() => initialSettingsMetaRef.current!.initialSettings);

  useEffect(() => {
    const meta = initialSettingsMetaRef.current;
    const isInitialState = meta !== null && settings === meta.initialSettings;
    if (isInitialState && !meta.needsPersistOnMount) {
      return;
    }
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, serializePersistedSettingsPayload(settings));
      if (isInitialState && meta) {
        meta.needsPersistOnMount = false;
      }
    } catch (e) {
      console.warn("[Settings] Could not save settings:", e);
    }
  }, [settings]);

  useEffect(() => {
    document.documentElement.setAttribute("data-accent", settings.primaryAccent || "clay");
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

  // Memoised on purpose: the value is one of `fetchWithAuth`'s dependency inputs, so a fresh
  // identity on every provider render re-created `fetchWithAuth`, invalidated every `useApiClient`
  // memo and re-ran each context-loading effect whenever any settings state changed — even
  // opening the settings panel. The setters used below are stable `useState` dispatchers.
  const updateSetting = useCallback(<K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    if ((TRANSIENT_SETTING_KEYS as readonly string[]).includes(key as string)) {
      try {
        const transient = readTransientCredentials();
        (transient as Record<string, unknown>)[key as string] = value;
        sessionStorage.setItem(TRANSIENT_STORAGE_KEY, JSON.stringify(transient));
      } catch (e) {
        console.error("[Settings] sessionStorage write error:", e);
      }
    }
    if (key === "showAtomInteractions") {
      setShowPolarContacts(value as boolean);
    }
  }, []);

  const resetSettingsToDefault = useCallback(() => {
    setSettings({
      ...DEFAULT_USER_SETTINGS,
      biophysicsConditions: { ...DEFAULT_USER_SETTINGS.biophysicsConditions }
    });
    setShowPolarContacts(true);
    // Theme is stored apart from the other settings but is still a preference a reset returns.
    setTheme("light");
    try {
      sessionStorage.removeItem(TRANSIENT_STORAGE_KEY);
    } catch (e) {}
  }, []);

  const applySettings = useCallback((partial: Partial<UserSettings>) => {
    const safe: Partial<UserSettings> = { ...partial };
    delete (safe as Record<string, unknown>).__autoZoomMigrated;
    // Imported files must never inject credentials into persisted storage.
    for (const transientKey of TRANSIENT_SETTING_KEYS) {
      delete safe[transientKey];
    }
    setSettings((prev) => ({
      ...prev,
      ...safe,
      biophysicsConditions: {
        ...DEFAULT_USER_SETTINGS.biophysicsConditions,
        ...(prev.biophysicsConditions || {}),
        ...(safe.biophysicsConditions || {})
      }
    }));
    if (safe.showAtomInteractions !== undefined) {
      setShowPolarContacts(safe.showAtomInteractions);
    }
  }, []);

  const serverGeminiReady = Boolean(useDiagnostics({ geminiReadyOnly: true }).diagnostics?.geminiReady);

  const openSettingsTab = useCallback((tab: SettingsTabId | LegacySettingsTabId = "appearance") => {
    setSettingsTab(LEGACY_TAB_MAP[tab as LegacySettingsTabId] ?? (tab as SettingsTabId));
    setIsSettingsOpen(true);
  }, []);

  const hasConfiguredGeminiKey = geminiCredentials(settings, serverGeminiReady, Date.now()).canAttemptNarrative;

  const value = useMemo<SettingsContextType>(
    () => ({
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
    }),
    [
      theme,
      isDark,
      toggleTheme,
      settings,
      updateSetting,
      applySettings,
      resetSettingsToDefault,
      showPolarContacts,
      isSettingsOpen,
      settingsTab,
      openSettingsTab,
      hasConfiguredGeminiKey,
      serverGeminiReady,
    ]
  );

  return (
    <SettingsContext.Provider value={value}>
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
