import { useState, useEffect } from "react";

const STORAGE_KEY = "variantHistoryObfuscated";

export interface HistoryItem {
  gene: string;
  variant: string;
  uniprotId: string;
}

// Obfuscate (simple Base64 to prevent raw plaintext visibility in local storage)
const encryptHistory = (data: HistoryItem[]): string => {
  try {
    const json = JSON.stringify(data);
    return btoa(unescape(encodeURIComponent(json)));
  } catch (e) {
    return "";
  }
};

const decryptHistory = (cipherText: string): HistoryItem[] => {
  try {
    const json = decodeURIComponent(escape(atob(cipherText)));
    return JSON.parse(json);
  } catch (e) {
    return [];
  }
};

export function useSearchHistory(maxHistoryItems: number = 30, saveHistoryEnabled: boolean = false) {
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    if (!saveHistoryEnabled) return [];
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return decryptHistory(saved);
      }
      // Clean up old key if present
      localStorage.removeItem("variantHistory");
      return [];
    } catch (e) {
      return [];
    }
  });

  // Keep history in sync if saveHistoryEnabled transitions to false
  useEffect(() => {
    if (!saveHistoryEnabled) {
      try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem("variantHistory");
      } catch (e) {}
      setHistory([]);
    } else {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          setHistory(decryptHistory(saved));
        }
      } catch (e) {}
    }
  }, [saveHistoryEnabled]);

  const addToHistory = (g: string, v: string, u: string) => {
    if (!saveHistoryEnabled) return;
    setHistory((prev) => {
      const filtered = prev.filter(
        (item) =>
          !(item.gene.toUpperCase() === g.toUpperCase() && item.variant.toLowerCase() === v.toLowerCase())
      );
      const updated = [{ gene: g.toUpperCase(), variant: v, uniprotId: u }, ...filtered].slice(0, maxHistoryItems);
      try {
        localStorage.setItem(STORAGE_KEY, encryptHistory(updated));
      } catch (e) {
        console.error(e);
      }
      return updated;
    });
  };

  const clearHistory = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem("variantHistory");
    } catch (e) {
      console.error(e);
    }
    setHistory([]);
  };

  return {
    history,
    setHistory,
    addToHistory,
    clearHistory
  };
}
