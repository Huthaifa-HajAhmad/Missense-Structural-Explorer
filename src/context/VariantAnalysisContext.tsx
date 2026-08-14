import React, { createContext, useContext, useRef, useEffect } from "react";
import { createStore, StoreApi } from "zustand";
import { useStore } from "zustand";

interface StoreState {
  state: any;
  actions: any;
}

export const VariantAnalysisStoreContext = createContext<StoreApi<StoreState> | null>(null);

export function VariantAnalysisProvider({ 
  state,
  actions, 
  children 
}: { 
  state: any;
  actions: any;
  children: React.ReactNode; 
}) {
  const storeRef = useRef<StoreApi<StoreState> | null>(null);
  if (!storeRef.current) {
    storeRef.current = createStore<StoreState>(() => ({
      state,
      actions,
    }));
  }

  // Sync state and actions to the store asynchronously after render commits
  useEffect(() => {
    if (storeRef.current) {
      const currentStore = storeRef.current.getState();
      if (currentStore.state !== state || currentStore.actions !== actions) {
        storeRef.current.setState({ state, actions });
      }
    }
  }, [state, actions]);

  return (
    <VariantAnalysisStoreContext.Provider value={storeRef.current}>
      {children}
    </VariantAnalysisStoreContext.Provider>
  );
}

// 1. Selector-based hook for fine-grained state subscriptions
export function useVariantAnalysisStore<T>(selector: (state: any) => T): T {
  const store = useContext(VariantAnalysisStoreContext);
  if (!store) {
    throw new Error("useVariantAnalysisStore must be used within a VariantAnalysisProvider");
  }
  return useStore(store, (s) => selector(s.state));
}

// 2. Hook to fetch actions (static, doesn't cause re-renders)
export function useVariantAnalysisActions(): any {
  const store = useContext(VariantAnalysisStoreContext);
  if (!store) return {};
  return store.getState().actions;
}

// 3. Legacy compatibility hooks:
export function useVariantAnalysisState(): any {
  const store = useContext(VariantAnalysisStoreContext);
  if (!store) return {};
  return useStore(store, (s) => s.state);
}

export function useVariantAnalysisContext(): { state: any; actions: any } {
  const store = useContext(VariantAnalysisStoreContext);
  if (!store) return { state: {}, actions: {} };
  const storeState = useStore(store);
  return { state: storeState.state, actions: storeState.actions };
}
