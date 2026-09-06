import React from "react";
import { LucideIcon } from "lucide-react";
import { THRESHOLDS } from "../../../shared/thresholds";

export interface PerturbModelDef {
  id: "saprot" | "esm2" | "esmc";
  name: string;
  description: string;
  data: any;
  icon: LucideIcon;
  tokenName: string;
  tokenSettingKey: string;
  hasKey: boolean;
  conformation?: string | null;
}

interface PerturbationModelCardsProps {
  models: PerturbModelDef[];
  activeModelId: "saprot" | "esm2" | "esmc";
  onSelectModel: (id: "saprot" | "esm2" | "esmc") => void;
  onOpenSettings?: () => void;
}

export function PerturbationModelCards({
  models,
  activeModelId,
  onSelectModel,
  onOpenSettings
}: PerturbationModelCardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {models.map(m => {
        const isSelected = m.id === activeModelId;
        const IconComponent = m.icon;

        if (!m.data || m.data.error) {
          const errStatus = m.data?.status || "offline";
          const isTimeout = errStatus === "timeout";
          return (
            <div
              key={m.id}
              onClick={() => onOpenSettings?.()}
              className="group relative p-4 rounded-xl border border-dashed flex flex-col justify-between h-[155px] cursor-pointer transition-all duration-300 opacity-75 hover:opacity-95"
              style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}
            >
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-mono tracking-wider uppercase font-bold" style={{ color: isTimeout ? "var(--cs-accent-clay)" : "var(--cs-text-muted)" }}>
                    {isTimeout ? "Model Timeout" : "Offline / Unreachable"}
                  </span>
                  <div className="p-1 rounded" style={{ background: "var(--cs-bg-subtle)", color: "var(--cs-text-muted)" }}>
                    <IconComponent className="w-3.5 h-3.5" />
                  </div>
                </div>
                <h3 className="text-xs font-bold transition-colors" style={{ color: "var(--cs-text-primary)" }}>{m.name}</h3>
                <p className="text-[9px] mt-1 leading-normal line-clamp-2" style={{ color: "var(--cs-text-muted)" }}>
                  {m.data?.error || m.description}
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-[9px] font-semibold mt-2" style={{ color: "var(--cs-accent-clay)" }}>
                <span>⚙️ {m.hasKey ? "Check model server / keys" : `Configure ${m.tokenName.split(" ")[0]} key`}</span>
              </div>
            </div>
          );
        }

        const llrVal = typeof m.data.llr === "number" ? m.data.llr : 0;
        const isModelDangerous = llrVal <= THRESHOLDS.esm.pathogenic;
        const shiftVal = typeof m.data.embeddingShift === "number" ? m.data.embeddingShift : 0;

        return (
          <div
            key={m.id}
            onClick={() => onSelectModel(m.id)}
            className="relative p-4 rounded-xl border flex flex-col justify-between h-[155px] cursor-pointer transition-all duration-300 shadow-sm text-left"
            style={{
              background: isSelected ? "var(--cs-surface)" : "var(--cs-surface-2)",
              borderColor: isSelected ? "var(--cs-accent-clay)" : "var(--cs-border-subtle)",
              boxShadow: isSelected ? "0 0 0 1px var(--cs-accent-clay)" : "none"
            }}
          >
            <div>
              <div className="flex items-center justify-between mb-1.5">
                {(() => {
                  const prov = ((m.data as any).provenance || "").toLowerCase();
                  if (prov.includes("fallback") || prov.includes("vesm")) {
                    return <span className="text-[9px] font-mono px-2 py-0.5 rounded-full font-bold border bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">Fallback (CPU)</span>;
                  }
                  if (prov.includes("remote") || prov.includes("biohub") || prov.includes("hf")) {
                    return <span className="text-[9px] font-mono px-2 py-0.5 rounded-full font-bold border bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20">Cloud Remote</span>;
                  }
                  if (prov.includes("gpu") || prov.includes("local")) {
                    return <span className="text-[9px] font-mono px-2 py-0.5 rounded-full font-bold border bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">Local GPU</span>;
                  }
                  return <span className="text-[9px] font-mono px-2 py-0.5 rounded-full font-bold border bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">Active</span>;
                })()}
                <div className="p-1 rounded" style={{ background: isSelected ? "rgba(196, 104, 73, 0.1)" : "var(--cs-bg-subtle)", color: isSelected ? "var(--cs-accent-clay)" : "var(--cs-text-secondary)" }}>
                  <IconComponent className="w-3.5 h-3.5" />
                </div>
              </div>
              <h3 className="text-xs font-bold text-left" style={{ color: "var(--cs-text-primary)" }}>{m.name}</h3>
              <p className="text-[9px] mt-0.5 leading-normal truncate text-slate-400 text-left">
                {(m.data as any).provenance ? (m.data as any).provenance : m.description}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t text-left" style={{ borderColor: "var(--cs-border-subtle)" }}>
              <div>
                <span className="block text-[8px] uppercase font-bold tracking-wider text-slate-400">Δ LLR (nats)</span>
                <span className="text-xs font-mono font-bold" style={{ color: isModelDangerous ? "var(--cs-text-danger)" : "var(--cs-text-success)" }}>
                  {llrVal.toFixed(3)}
                </span>
              </div>
              <div>
                <span className="block text-[8px] uppercase font-bold tracking-wider text-slate-400">Emb. Shift</span>
                <span className="text-xs font-mono font-bold" style={{ color: "var(--cs-accent-clay)" }}>
                  {shiftVal.toFixed(3)}
                </span>
              </div>
            </div>

            {m.conformation && (
              <div className="absolute top-4 right-12 text-[8px] font-mono font-bold px-1.5 py-0.5 rounded border bg-teal-500/10 text-teal-600 border-teal-500/20">
                State: {m.conformation}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
