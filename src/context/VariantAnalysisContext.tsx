import React, { createContext, useContext } from "react";

interface VariantAnalysisContextType {
  state: any;
  actions: any;
}

const VariantAnalysisContext = createContext<VariantAnalysisContextType | null>(null);

export function VariantAnalysisProvider({ 
  value, 
  children 
}: { 
  value: VariantAnalysisContextType; 
  children: React.ReactNode; 
}) {
  return (
    <VariantAnalysisContext.Provider value={value}>
      {children}
    </VariantAnalysisContext.Provider>
  );
}

export function useVariantAnalysisContext(): VariantAnalysisContextType {
  const context = useContext(VariantAnalysisContext);
  if (!context) {
    return { state: {} as any, actions: {} as any };
  }
  return context;
}
