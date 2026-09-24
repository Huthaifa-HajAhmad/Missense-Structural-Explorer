import React from "react";
import { LucideIcon, Loader2 } from "lucide-react";
import { classifyLlr, isCalibrated, type ModelCalibration } from "../../../shared/modelCalibration";

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
  /**
   * What is known about this model's score scale. Drives whether ΔLLR may be tinted
   * against a cut-point at all — see src/shared/modelCalibration.ts.
   */
  calibration?: ModelCalibration | null;
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
              className="relative p-4 rounded-xl border flex flex-col justify-between min-h-[158px] cursor-pointer transition-all duration-300 shadow-sm text-left focus:outline-none focus:ring-1 focus:ring-[var(--cs-accent-clay)] animate-pulse"
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
                <p className="text-[10px] mt-1 leading-normal line-clamp-2 text-cs-text-muted text-left">
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

          let badgeLabel = "Standby";
          let badgeBg = "rgba(148, 163, 184, 0.1)";
          let badgeColor = "var(--cs-text-secondary)";
          let badgeBorder = "rgba(148, 163, 184, 0.2)";

          if (isTimeout) {
            badgeLabel = "Timeout";
            badgeBg = "rgba(234, 179, 8, 0.1)";
            badgeColor = "var(--cs-accent-clay)";
            badgeBorder = "rgba(234, 179, 8, 0.2)";
          } else if (isWarming) {
            badgeLabel = "Initializing";
            badgeBg = "rgba(234, 179, 8, 0.1)";
            badgeColor = "var(--cs-accent-clay)";
            badgeBorder = "rgba(234, 179, 8, 0.2)";
          } else if (isDownloading) {
            badgeLabel = "Downloading";
            badgeBg = "rgba(56, 189, 248, 0.1)";
            badgeColor = "#0284c7";
            badgeBorder = "rgba(56, 189, 248, 0.2)";
          }

          const displayDesc = m.description;

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
              className="group relative p-4 rounded-xl border flex flex-col justify-between min-h-[158px] cursor-pointer transition-all duration-300 shadow-xs text-left opacity-85 hover:opacity-100 focus:outline-none focus:ring-1 focus:ring-[var(--cs-accent-clay)]"
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
                <p className="text-[10px] mt-1 leading-normal line-clamp-2 text-cs-text-muted text-left font-sans">
                  {displayDesc}
                </p>
              </div>
              <div className="flex items-center justify-between text-[10px] font-mono text-cs-text-muted border-t pt-2" style={{ borderColor: "var(--cs-border-subtle)" }}>
                <span>Score: —</span>
                <span className="text-[9.5px] text-cs-text-muted">Standby</span>
              </div>
            </div>
          );
        }

        const llrVal: number | null = typeof m.data.llr === "number" && Number.isFinite(m.data.llr) ? m.data.llr : null;
        /**
         * A cut-point may only be applied when the registry holds one for *this* model.
         * The previous single-constant comparison tinted SaProt (≈0) and ESMC (≈-8.4)
         * against ESM-1b's -5.0, which was defined for neither.
         */
        const llrIsCalibrated = isCalibrated(m.calibration ?? null);
        const llrVerdict = classifyLlr(llrVal, m.calibration ?? null);
        const llrColor = !llrIsCalibrated
          ? "var(--cs-text-primary)"
          : llrVerdict === "pathogenic"
            ? "var(--cs-text-danger)"
            : "var(--cs-text-success)";
        const shiftVal: number | null = typeof m.data.embeddingShift === "number" && Number.isFinite(m.data.embeddingShift) ? m.data.embeddingShift : null;

        /**
         * Two different tiers can each be the reason a card shows another model's numbers, and they
         * fail for different reasons: the remote engine and the local candidates. Only the remote one
         * used to be carried (`hfError`), so a card whose *local* SaProt load failed pointed the
         * reader at the wrong engine — and at a parse error that read like a defect in this code.
         * Each reason is now labelled with the tier that produced it.
         */
        const diagnostics: string[] = [];
        const remoteEngineNote = typeof m.data?.remoteEngineNote === "string"
          ? m.data.remoteEngineNote
          : (typeof m.data?.hfError === "string" ? m.data.hfError : null);
        if (remoteEngineNote) diagnostics.push(`Remote engine (HF serverless): ${remoteEngineNote}`);
        const fallbackReason = typeof m.data?.fallbackReason === "string" ? m.data.fallbackReason : null;
        if (fallbackReason) diagnostics.push(`Local SaProt candidates: ${fallbackReason}`);
        const diagnosticTooltip = diagnostics.length > 0 ? diagnostics.join("\n") : null;
        const isFallbackRun = /fallback|vesm/i.test(String(m.data?.provenance || ""));

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
            className="relative p-4 rounded-xl border flex flex-col justify-between min-h-[158px] cursor-pointer transition-all duration-300 shadow-sm text-left focus:outline-none focus:ring-1 focus:ring-[var(--cs-accent-clay)]"
            style={{
              background: isSelected ? "var(--cs-surface)" : "var(--cs-surface-2)",
              borderColor: isSelected ? "var(--cs-accent-clay)" : "var(--cs-border-subtle)",
              boxShadow: isSelected ? "0 0 0 1px var(--cs-accent-clay)" : "none"
            }}
          >
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1">
                  {(() => {
                    const prov = ((m.data as any).provenance || "").toLowerCase();
                    if (prov.includes("fallback") || prov.includes("vesm")) {
                      return (
                        <span className="text-[9px] font-mono px-2 py-0.5 rounded-full font-bold border bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
                          Fallback (CPU)
                        </span>
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
                  {/*
                    Rendered whenever *either* tier has something to report, not only on a fallback
                    card: a run that recovered locally after a failed remote attempt has a diagnostic
                    the reader is entitled to see too.
                  */}
                  {diagnosticTooltip && (
                    <span
                      title={diagnosticTooltip}
                      className="text-[10px] cursor-help px-1 rounded bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30"
                    >
                      ℹ️
                    </span>
                  )}
                </div>
                <div className="p-1 rounded" style={{ background: isSelected ? "rgba(196, 104, 73, 0.1)" : "var(--cs-bg-subtle)", color: isSelected ? "var(--cs-accent-clay)" : "var(--cs-text-secondary)" }}>
                  <IconComponent className="w-3.5 h-3.5" />
                </div>
              </div>
              <h3 className="text-xs font-bold text-left" style={{ color: "var(--cs-text-primary)" }}>{m.name}</h3>
              <p className="text-[10px] mt-0.5 leading-normal truncate text-cs-text-muted text-left">
                {(m.data as any).provenance ? (m.data as any).provenance : m.description}
              </p>
              {/*
                The cause is visible without a hover. "SaProt unavailable" was previously the whole
                explanation, which left the reader to guess between a token problem, an unserved
                model, a cache fault and a real scientific result.
              */}
              {isFallbackRun && fallbackReason && (
                <p
                  className="text-[9.5px] mt-0.5 leading-snug line-clamp-2 text-amber-600 dark:text-amber-400 text-left"
                  title={fallbackReason}
                >
                  Cause: {fallbackReason}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t text-left" style={{ borderColor: "var(--cs-border-subtle)" }}>
              <div>
                <span className="block text-[9.5px] uppercase font-bold tracking-wider text-cs-text-muted">Δ LLR (nats)</span>
                <span className="text-xs font-mono font-bold" style={{ color: llrColor }}>
                  {llrVal === null ? "N/A" : llrVal.toFixed(3)}
                </span>
                {!llrIsCalibrated && (
                  <span
                    className="block text-[9.5px] font-mono text-cs-text-muted leading-tight mt-0.5"
                    title="No published pathogenic/benign cut-point exists for this model's own score scale, so this value is reported uncalibrated rather than tinted against another model's threshold."
                  >
                    uncalibrated
                  </span>
                )}
              </div>
              <div>
                <span className="block text-[9.5px] uppercase font-bold tracking-wider text-cs-text-muted">Emb. Shift</span>
                <span className="text-xs font-mono font-bold" style={{ color: "var(--cs-accent-clay)" }}>
                  {shiftVal === null ? "N/A" : shiftVal.toFixed(3)}
                </span>
                {m.calibration?.embeddingDim && (
                  <span className="block text-[9.5px] font-mono text-cs-text-muted leading-tight mt-0.5">
                    {m.calibration.embeddingDim}-dim
                  </span>
                )}
              </div>
            </div>

            {m.conformation && (
              <div className="mt-1.5 text-[8px] font-mono font-bold px-1.5 py-0.5 rounded border bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20 inline-block w-fit">
                State: {m.conformation}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
