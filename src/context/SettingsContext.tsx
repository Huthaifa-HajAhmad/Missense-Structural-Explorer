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
      cameraDuration: 1200,
      autoZoomOnSelect: true,
      showAtomInteractions: true,
      acmgWeighting: "standard",
      energyUnit: "kcal/mol",
      seqColorScheme: "chemical",
      seqScrollStep: 21,
      autoShowAlerts: true,
      bentoLeftControls: true,
      maxHistoryItems: 5,
      neonHighContrast: false,
      show3DLabels: true,
    };
    try {
      const saved = localStorage.getItem("missenseUserSettings");
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          ...defaultSettings,
          ...parsed,
          show3DLabels: parsed.show3DLabels !== undefined ? !!parsed.show3DLabels : true
        };
      }
      return defaultSettings;
    } catch {
      return defaultSettings;
    }
  });

  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

  const updateSetting = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    setSettings((prev) => {
      const updated = { ...prev, [key]: value };
      try {
        localStorage.setItem("missenseUserSettings", JSON.stringify(updated));
      } catch (e) {
        console.error(e);
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
      cameraDuration: 1200,
      autoZoomOnSelect: true,
      showAtomInteractions: true,
      acmgWeighting: "standard",
      energyUnit: "kcal/mol",
      seqColorScheme: "chemical",
      seqScrollStep: 21,
      autoShowAlerts: true,
      bentoLeftControls: true,
      maxHistoryItems: 5,
      neonHighContrast: false,
      show3DLabels: true,
    };
    setSettings(defaultSettings);
    setShowPolarContacts(true);
    try {
      localStorage.setItem("missenseUserSettings", JSON.stringify(defaultSettings));
    } catch (e) {
      console.error(e);
    }
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
