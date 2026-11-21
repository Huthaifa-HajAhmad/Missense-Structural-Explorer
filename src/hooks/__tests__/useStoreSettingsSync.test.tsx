// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useStoreSettingsSync } from "../useStoreSettingsSync";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { DEFAULT_USER_SETTINGS } from "../../components/settings/defaults";

describe("useStoreSettingsSync", () => {
  it("hands the history and alert choices to the store, and follows later changes", () => {
    const { rerender } = renderHook(({ settings }) => useStoreSettingsSync(settings), {
      initialProps: { settings: { ...DEFAULT_USER_SETTINGS, saveHistory: true, maxHistoryItems: 20, autoShowAlerts: false } }
    });
    expect(useVariantAnalysisStore.getState().historyPolicy).toEqual({ save: true, limit: 20 });
    expect(useVariantAnalysisStore.getState().autoShowAlerts).toBe(false);

    rerender({ settings: { ...DEFAULT_USER_SETTINGS, saveHistory: false, maxHistoryItems: 5, autoShowAlerts: true } });
    expect(useVariantAnalysisStore.getState().historyPolicy).toEqual({ save: false, limit: 5 });
    expect(useVariantAnalysisStore.getState().autoShowAlerts).toBe(true);
  });
});
