import React from "react";
import {
  useVariantAnalysisStore,
  useVariantAnalysisActions,
  type VariantAnalysisStore
} from "../stores/useVariantAnalysisStore";

export { useVariantAnalysisStore, useVariantAnalysisActions };
export type { VariantAnalysisStore };

/**
 * Backward-compatible Provider component.
 * Slices are now canonically managed by Zustand without needing an asynchronous useEffect sync bridge.
 */
export function VariantAnalysisProvider({
  children
}: {
  state?: any;
  actions?: any;
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

/**
 * Legacy compatibility hook to read entire store state.
 */
export function useVariantAnalysisState(): VariantAnalysisStore {
  return useVariantAnalysisStore();
}

/**
 * Legacy compatibility hook returning { state, actions }.
 */
export function useVariantAnalysisContext(): { state: VariantAnalysisStore; actions: VariantAnalysisStore } {
  const store = useVariantAnalysisStore();
  return { state: store, actions: store };
}
