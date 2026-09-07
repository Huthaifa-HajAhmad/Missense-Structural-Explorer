import React from "react";
import { LucideIcon, Loader2 } from "lucide-react";
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
    <div className="space-y-2">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {models.map(m => {
        const isSelected = m.id === activeModelId;
        const IconComponent = m.icon;

        // 1. Loading State
        if (m.data?.loading) {
          return (
            <div
              key={m.id}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectModel(m.id);
                }
              }}
              onClick={() => onSelectModel(m.id)}
              className="relative p-4 rounded-xl border flex flex-col justify-between h-[155px] cursor-pointer transition-all duration-300 shadow-sm text-left focus:outline-none focus:ring-1 focus:ring-[var(--cs-accent-clay)] animate-pulse"
              style={{
                background: isSelected ? "var(--cs-surface)" : "var(--cs-surface-2)",
                borderColor: isSelected ? "var(--cs-accent-clay)" : "var(--cs-border-subtle)",
                boxShadow: isSelected ? "0 0 0 1px var(--cs-accent-clay)" : "none"
              }}
            >
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="flex items-center gap-1 text-[9px] font-mono px-2 py-0.5 rounded-full font-bold border bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20">
                    <Loader2 className="w-2.5 h-2.5 animate-spin" />
                    Calculating...
                  </span>
                  <div className="p-1 rounded" style={{ background: isSelected ? "rgba(196, 104, 73, 0.1)" : "var(--cs-bg-subtle)", color: isSelected ? "var(--cs-accent-clay)" : "var(--cs-text-muted)" }}>
                    <IconComponent className="w-3.5 h-3.5" />
                  </div>
                </div>
                <h3 className="text-xs font-bold transition-colors text-left" style={{ color: "var(--cs-text-primary)" }}>{m.name}</h3>
                <p className="text-[9px] mt-1 leading-normal line-clamp-2 text-slate-400 text-left">
                  Computing evolutionary sequence log-likelihood and residue embedding shifts...
                </p>
              </div>
              <div className="flex items-center gap-2 mt-2 pt-2 border-t text-[9px] font-mono text-purple-500" style={{ borderColor: "var(--cs-border-subtle)" }}>
                <span>Evaluating forward pass...</span>
              </div>
            </div>
          );
        }

        // 2. Error / Standby / Offline State
        if (!m.data || m.data.error) {
          const errStatus = m.data?.status || "offline";
          const isTimeout = errStatus === "timeout";
          const isWarming = errStatus === "warming_up" || (m.data?.error && /warming|initializing/i.test(m.data.error));
          const isDownloading = errStatus === "downloading" || (m.data?.error && /download/i.test(m.data.error));

          let badgeLabel = "Sidecar Standby";
          let badgeBg = "rgba(148, 163, 184, 0.1)";
          let badgeColor = "var(--cs-text-secondary)";
          let badgeBorder = "rgba(148, 163, 184, 0.2)";

          if (isTimeout) {
            badgeLabel = "Model Timeout";
            badgeBg = "rgba(234, 179, 8, 0.1)";
            badgeColor = "var(--cs-accent-clay)";
            badgeBorder = "rgba(234, 179, 8, 0.2)";
          } else if (isWarming) {
            badgeLabel = "Engine Initializing";
            badgeBg = "rgba(234, 179, 8, 0.1)";
            badgeColor = "var(--cs-accent-clay)";
            badgeBorder = "rgba(234, 179, 8, 0.2)";
          } else if (isDownloading) {
            badgeLabel = "Downloading Weights";
            badgeBg = "rgba(56, 189, 248, 0.1)";
            badgeColor = "#0284c7";
            badgeBorder = "rgba(56, 189, 248, 0.2)";
          }

          let displayDesc = m.description;
          if (m.data?.error) {
            if (/fetch failed|unreachable|ECONNREFUSED|connect|offline/i.test(m.data.error)) {
              displayDesc = "Sidecar microservice in standby. Click 'Check & Retry' or configure keys.";
            } else if (isWarming) {
              displayDesc = "Engine microservice is starting and pre-loading initial weights.";
            } else {
              displayDesc = m.data.error.replace(/https?:\/\/[^\s)]+/g, "microservice");
            }
          }

          return (
            <div
              key={m.id}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectModel(m.id);
                }
              }}
              onClick={() => onSelectModel(m.id)}
              className="group relative p-4 rounded-xl border flex flex-col justify-between h-[155px] cursor-pointer transition-all duration-300 shadow-sm text-left opacity-85 hover:opacity-100 focus:outline-none focus:ring-1 focus:ring-[var(--cs-accent-clay)]"
              style={{
                background: isSelected ? "var(--cs-surface)" : "var(--cs-surface-2)",
                borderColor: isSelected ? "var(--cs-accent-clay)" : "var(--cs-border-subtle)",
                boxShadow: isSelected ? "0 0 0 1px var(--cs-accent-clay)" : "none"
              }}
            >
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span
                    className={`text-[9px] font-mono px-2 py-0.5 rounded-full font-bold border ${isWarming || isDownloading ? "animate-pulse" : ""}`}
                    style={{
                      background: badgeBg,
                      color: badgeColor,
                      borderColor: badgeBorder
                    }}
                  >
                    {badgeLabel}
                  </span>
                  <div className="p-1 rounded" style={{ background: isSelected ? "rgba(196, 104, 73, 0.1)" : "var(--cs-bg-subtle)", color: isSelected ? "var(--cs-accent-clay)" : "var(--cs-text-muted)" }}>
                    <IconComponent className="w-3.5 h-3.5" />
                  </div>
                </div>
                <h3 className="text-xs font-bold transition-colors text-left" style={{ color: "var(--cs-text-primary)" }}>{m.name}</h3>
                <p className="text-[9px] mt-1 leading-normal line-clamp-2 text-slate-400 text-left">
                  {displayDesc}
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-[9px] font-semibold mt-2 text-left" style={{ color: "var(--cs-accent-clay)" }}>
                {!m.hasKey && onOpenSettings ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenSettings();
                    }}
                    className="hover:underline focus:outline-none flex items-center gap-1"
                  >
                    <span>🔑 Configure {m.tokenName.split(" ")[0]} key</span>
                  </button>
                ) : (
                  <span>{m.hasKey ? "⚡ Click to view diagnostic & remedy" : `🔑 Configure ${m.tokenName.split(" ")[0]} key`}</span>
                )}
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
            role="button"
            tabIndex={0}
            aria-pressed={isSelected}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelectModel(m.id);
              }
            }}
            onClick={() => onSelectModel(m.id)}
            className="relative p-4 rounded-xl border flex flex-col justify-between h-[155px] cursor-pointer transition-all duration-300 shadow-sm text-left focus:outline-none focus:ring-1 focus:ring-[var(--cs-accent-clay)]"
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
                  if (prov.includes("japanfold")) {
                    return <span className="text-[9px] font-mono px-2 py-0.5 rounded-full font-bold border bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20">JapanFold Cloud</span>;
                  }
                  if (prov.includes("fallback") || prov.includes("vesm")) {
                    return (
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] font-mono px-2 py-0.5 rounded-full font-bold border bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
                          Fallback (CPU)
                        </span>
                        {m.data?.hfError && (
                          <span 
                            title={`HF Diagnostic: ${m.data.hfError}`}
                            className="text-[10px] cursor-help px-1 rounded bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30"
                          >
                            ℹ️
                          </span>
                        )}
                      </div>
                    );
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
    <p className="text-[10px] text-slate-400 font-mono mt-2 px-1">
      Note: Embedding shift scale reflects latent model dimensionality (768-dim for VESM / SaProt 35M, 1280-dim for ESM-2 650M / SaProt 650M, 2560-dim for ESMC-6B).
    </p>
    </div>
  );
}
