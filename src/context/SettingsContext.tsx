import React, { createContext, useContext, useState, useEffect } from "react";
import { UserSettings } from "../types";

interface SettingsContextType {
  theme: "dark" | "light";
  isDark: boolean;
  setTheme: React.Dispatch<React.SetStateAction<"dark" | "light">>;
  toggleTheme: () => void;
  settings: UserSettings;
  setSettings: React.Dispatch<React.SetStateAction<UserSettings>>;
  updateSetting: <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => void;
  resetSettingsToDefault: () => void;
  showPolarContacts: boolean;
  setShowPolarContacts: React.Dispatch<React.SetStateAction<boolean>>;
  isSettingsOpen: boolean;
  setIsSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try {
      const saved = localStorage.getItem("theme");
      return saved === "light" || saved === "dark" ? saved : "dark";
    } catch {
      return "dark";
    }
  });

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      try {
        localStorage.setItem("theme", next);
      } catch (e) {
        console.error(e);
      }
      return next;
    });
  };

  const isDark = theme === "dark";

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
      const saved = localStorage.getItem("missenseUserSettings");
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
    const defaultSettings: UserSettings = {
      residueColor: "#F97316",
      primaryAccent: "indigo",
      geminiApiKey: "",
      geminiSessionId: "",
      geminiSessionExpiresAt: 0,
      cameraDuration: 1200,
      autoZoomOnSelect: true,
      showAtomInteractions: true,
      acmgWeighting: "standard",
      energyUnit: "kcal/mol",
      seqColorScheme: "chemical",
      seqScrollStep: 31,
      autoShowAlerts: true,
      bentoLeftControls: true,
      maxHistoryItems: 5,
      neonHighContrast: false,
      show3DLabels: true,
      saveHistory: false,
    };
    try {
      const saved = localStorage.getItem("missenseUserSettings");
      let parsed = saved ? JSON.parse(saved) : {};
      
      let modified = false;
      if (parsed.geminiApiKey !== undefined) {
        delete parsed.geminiApiKey;
        modified = true;
      }
      if (parsed.geminiSessionId !== undefined) {
        delete parsed.geminiSessionId;
        modified = true;
      }
      if (parsed.geminiSessionExpiresAt !== undefined) {
        delete parsed.geminiSessionExpiresAt;
        modified = true;
      }
      if (modified && saved) {
        try {
          localStorage.setItem("missenseUserSettings", JSON.stringify(parsed));
        } catch (e) {}
      }

      // Load transient credentials from sessionStorage
      let transient: { geminiApiKey?: string; geminiSessionId?: string; geminiSessionExpiresAt?: number } = {};
      try {
        const transSaved = sessionStorage.getItem("missenseTransientCredentials");
        if (transSaved) {
          transient = JSON.parse(transSaved);
        }
      } catch (e) {}

      return {
        ...defaultSettings,
        ...parsed,
        geminiApiKey: transient.geminiApiKey || "",
        geminiSessionId: transient.geminiSessionId || "",
        geminiSessionExpiresAt: transient.geminiSessionExpiresAt || 0,
        show3DLabels: parsed.show3DLabels !== undefined ? !!parsed.show3DLabels : true
      };
    } catch {
      return defaultSettings;
    }
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-accent", settings.primaryAccent || "indigo");
  }, [settings.primaryAccent]);

  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

  const updateSetting = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    setSettings((prev) => {
      const updated = { ...prev, [key]: value };
      try {
        const toSave = { ...updated };
        delete toSave.geminiApiKey; // Never save raw API key in localStorage
        delete toSave.geminiSessionId; // Never save session ID in localStorage (XSS-safe stateless token)
        delete toSave.geminiSessionExpiresAt;
        localStorage.setItem("missenseUserSettings", JSON.stringify(toSave));
      } catch (e) {
        console.error(e);
      }

      // Sync transient credentials to sessionStorage for refresh safety
      if (key === "geminiApiKey" || key === "geminiSessionId" || key === "geminiSessionExpiresAt") {
        try {
          const credentials = {
            geminiApiKey: updated.geminiApiKey || "",
            geminiSessionId: updated.geminiSessionId || "",
            geminiSessionExpiresAt: updated.geminiSessionExpiresAt || 0
          };
          sessionStorage.setItem("missenseTransientCredentials", JSON.stringify(credentials));
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
    const defaultSettings: UserSettings = {
      residueColor: "#F97316",
      primaryAccent: "indigo",
      geminiApiKey: "",
      geminiSessionId: "",
      geminiSessionExpiresAt: 0,
      cameraDuration: 1200,
      autoZoomOnSelect: true,
      showAtomInteractions: true,
      acmgWeighting: "standard",
      energyUnit: "kcal/mol",
      seqColorScheme: "chemical",
      seqScrollStep: 31,
      autoShowAlerts: true,
      bentoLeftControls: true,
      maxHistoryItems: 5,
      neonHighContrast: false,
      show3DLabels: true,
      saveHistory: false,
    };
    setSettings(defaultSettings);
    setShowPolarContacts(true);
    try {
      const toSave = { ...defaultSettings };
      delete toSave.geminiApiKey;
      localStorage.setItem("missenseUserSettings", JSON.stringify(toSave));
    } catch (e) {
      console.error(e);
    }
    try {
      sessionStorage.removeItem("missenseTransientCredentials");
    } catch (e) {}
  };

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
        resetSettingsToDefault,
        showPolarContacts,
        setShowPolarContacts,
        isSettingsOpen,
        setIsSettingsOpen,
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
