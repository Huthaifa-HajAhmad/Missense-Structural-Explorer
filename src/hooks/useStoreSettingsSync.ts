import { useEffect } from "react";
import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";
import type { UserSettings } from "../types";

/**
 * Settings live in React context; the store acts on some of them outside React (saving a search,
 * raising a banner). This hands those choices to the store on load and whenever they change.
 */
export function useStoreSettingsSync(
  settings: Pick<UserSettings, "saveHistory" | "maxHistoryItems" | "autoShowAlerts">
): void {
  const { saveHistory, maxHistoryItems, autoShowAlerts } = settings;
  useEffect(() => {
    useVariantAnalysisStore.getState().setHistoryPolicy({ save: saveHistory, limit: maxHistoryItems });
  }, [saveHistory, maxHistoryItems]);
  useEffect(() => {
    useVariantAnalysisStore.getState().setAutoShowAlerts(autoShowAlerts);
  }, [autoShowAlerts]);
}
