import React from "react";
import { 
  Database, 
  Cpu, 
  Layers, 
  Activity, 
  TrendingUp, 
  Share2, 
  ShieldAlert 
} from "lucide-react";
import { TabType } from "./types";

interface EvidenceHeaderAndNavProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  classBorderSec: string;
}

export function EvidenceHeaderAndNav({
  activeTab,
  setActiveTab,
  classBorderSec
}: EvidenceHeaderAndNavProps) {
  const tabs: { id: TabType; label: string; icon: any }[] = [
    { id: "clinical", label: "Databases", icon: Database },
    { id: "predictors", label: "Predictors", icon: Cpu },
    { id: "structure", label: "Structure", icon: Layers },
    { id: "perturbation", label: "Structural Perturbation", icon: Activity },
    { id: "function", label: "Function", icon: TrendingUp },
    { id: "interactions", label: "Interactions", icon: Share2 },
    { id: "guidelines", label: "Threshold Guide", icon: ShieldAlert }
  ];

  return (
    <div className={`flex border-b flex-nowrap overflow-x-auto ${classBorderSec} px-3`} style={{ borderColor: "var(--cs-border)" }}>
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold whitespace-nowrap transition-all border-b-2 -mb-px ${
              isActive
                ? "border-[var(--cs-accent-clay)] text-[var(--cs-accent-clay)]"
                : "border-transparent text-[var(--cs-text-secondary)] hover:text-[var(--cs-text-primary)] hover:border-[var(--cs-border-subtle)]"
            }`}
          >
            <Icon className={`w-3.5 h-3.5 ${isActive ? "text-[var(--cs-accent-clay)]" : "text-[var(--cs-text-muted)]"}`} />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
