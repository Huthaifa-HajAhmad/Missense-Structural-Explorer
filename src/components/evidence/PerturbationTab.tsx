import React, { useState } from "react";
import { Activity, Layers, Sparkles, Info } from "lucide-react";
import { TabComponentProps } from "./types";
import { useSettings } from "../../context/SettingsContext";
import { THRESHOLDS } from "../../shared/thresholds";
import {
  calculateLps,
  getLpsDetails,
  getSequenceEvidenceText,
  getEnergeticEvidenceText,
  getGeometricEvidenceText,
  getOverallInterpretationText
} from "../../shared/perturbationHelpers";

export function PerturbationTab({
  analysisState,
  foldingEnergetics,
  structuralDiff,
  metrics,
  onOpenSettings
}: TabComponentProps) {
  const result = analysisState.result;
  const { settings } = useSettings();
  const [activePerturbModel, setActivePerturbModel] = useState<"saprot" | "esm2" | "esmc">("esmc");

  if (!result) return null;

  const wtRes = result.metadata?.wildType || "R";
  const mutRes = result.metadata?.mutant || "H";
  const pos = result.metadata?.residueIndex || 408;

  const models = [
    {
      id: "saprot" as const,
      name: "SaProt 650M AF2",
      description: "Structure-Aware Residue & Conformation Predictor",
      data: result.saprotEval,
      icon: Layers,
      tokenName: "Hugging Face Access Token",
      tokenSettingKey: "hfToken",
      hasKey: !!settings.hfToken,
      conformation: result.saprotEval?.conformationState || null
    },
    {
      id: "esm2" as const,
      name: "ESM-2 3B",
      description: "Genomic Sequence Evolutionary Scale Transformer",
      data: result.esm2Eval,
      icon: Activity,
      tokenName: "Hugging Face Access Token",
      tokenSettingKey: "hfToken",
      hasKey: !!settings.hfToken
    },
    {
      id: "esmc" as const,
      name: "ESMC 6B / VESM-150M",
      description: "Evolutionary Scale Foundation Model",
      data: result.esmcEval,
      icon: Sparkles,
      tokenName: "Biohub API Token",
      tokenSettingKey: "biohubApiToken",
      hasKey: !!settings.biohubApiToken
    }
  ];

  const activeList = models.filter(m => !!m.data);
  const hasAnyToken = !!settings.hfToken || !!settings.biohubApiToken;

  if (models.every(m => !m.data)) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center rounded-xl border border-dashed my-2" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}>
        <div className="w-8 h-8 rounded-full flex items-center justify-center mb-2.5" style={{ background: "var(--cs-bg-subtle)", color: "var(--cs-text-muted)" }}>
          <Activity className="w-4 h-4 animate-pulse" />
        </div>
        <span className="font-mono text-xs font-semibold mb-1" style={{ color: "var(--cs-text-primary)" }}>
          {hasAnyToken ? "Structural Perturbation Analysis Unavailable" : "Structural Perturbation Analysis Offline"}
        </span>
        <p className="text-[11px] max-w-md font-sans leading-relaxed mb-3" style={{ color: "var(--cs-text-secondary)" }}>
          {hasAnyToken
            ? "The local ML model server (VESM-150M / SaProt) did not return results. It may still be loading or the analysis timed out. Try re-running the analysis."
            : "Deep transformer representation metrics (SaProt, ESM-2 3B, ESMC-6B) require an active Hugging Face Access Token or Biohub API Token."}
        </p>
        <button
          type="button"
          onClick={() => onOpenSettings?.()}
          className="px-4 py-1.5 rounded-lg border text-xs font-semibold hover:bg-[var(--cs-surface-2)] cursor-pointer transition-colors shadow-sm"
          style={{ background: "var(--cs-surface)", color: "var(--cs-text-primary)", borderColor: "var(--cs-border)" }}
        >
          {hasAnyToken ? "Review API Keys" : "Configure API Keys"}
        </button>
      </div>
    );
  }

  const currentModel = models.find(m => m.id === activePerturbModel) || activeList[0];
  const activeEval = currentModel.data;

  if (!activeEval) {
    return null;
  }

  const allShifts = (activeEval.localShiftMap || []).map(d => d.shift);
  const maxShift = allShifts.length > 0 ? Math.max(...allShifts) : 1.0;
  const shiftScale = maxShift > 0 ? (110 / (maxShift * 1.15)) : 110;
  const points = (activeEval.localShiftMap || []).map((d, index) => {
    const x = 40 + index * 24;
    const rawY = 140 - d.shift * shiftScale;
    const y = Math.max(12, Math.min(138, rawY));
    return { x, y, position: d.position, residue: d.residue, shift: d.shift };
  });
  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

  const mutProbColor = activeEval.mutProbability >= 0.1 
    ? "var(--cs-text-success)" 
    : activeEval.mutProbability < 0.01 
      ? "var(--cs-text-danger)" 
      : "var(--cs-text-warning)";

  const preferenceLabel = activeEval.mutRank <= 3 
    ? "Highly Preferred" 
    : activeEval.mutRank >= 15 
      ? "Strongly Dispreferred" 
      : "Neutral Preference";

  const isEsmc = activePerturbModel === "esmc";
  const shiftMetric = isEsmc ? "Cosine Distance" : "Euclidean Distance";
  const meanShift = allShifts.length > 0 ? (allShifts.reduce((a, b) => a + b, 0) / allShifts.length) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="screen-title flex items-center gap-1.5 text-left">
          <Activity className="w-5 h-5 text-[var(--cs-accent-clay)]" />
          Structural &amp; Evolutionary Perturbations
        </h1>
        <p className="screen-tab-description text-left">
          Zero-shot evolutionary sequence likelihoods, local embedding disruptions, and structural conformation state predictions from language models.
        </p>
      </div>

      {/* SECTION A HEADER */}
      <div className="flex items-center gap-3 pt-1">
        <span className="text-[10px] uppercase font-mono font-bold tracking-wider text-slate-400">
          Section A: Sequence-Language-Model representation perturbation
        </span>
        <div className="flex-1 border-t" style={{ borderColor: "var(--cs-border-subtle)" }} />
      </div>

      {/* Grid 1: 3 Model Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {models.map(m => {
          const isSelected = m.id === currentModel.id;
          const IconComponent = m.icon;
          
          if (!m.data) {
            return (
              <div 
                key={m.id}
                onClick={() => onOpenSettings?.()}
                className="group relative p-4 rounded-xl border border-dashed flex flex-col justify-between h-[155px] cursor-pointer transition-all duration-300 opacity-60 hover:opacity-85 animate-pulse"
                style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-mono tracking-wider uppercase font-bold" style={{ color: "var(--cs-text-muted)" }}>Offline Method</span>
                    <div className="p-1 rounded" style={{ background: "var(--cs-bg-subtle)", color: "var(--cs-text-muted)" }}>
                      <IconComponent className="w-3.5 h-3.5" />
                    </div>
                  </div>
                  <h3 className="text-xs font-bold transition-colors" style={{ color: "var(--cs-text-primary)" }}>{m.name}</h3>
                  <p className="text-[9px] mt-1 leading-normal" style={{ color: "var(--cs-text-muted)" }}>{m.description}</p>
                </div>
                <div className="flex items-center gap-1.5 text-[9px] font-semibold mt-2" style={{ color: "var(--cs-accent-clay)" }}>
                  <span>⚙️ Configure {m.tokenName.split(" ")[0]} key</span>
                </div>
              </div>
            );
          }

          const isModelDangerous = m.data.llr <= THRESHOLDS.esm.pathogenic;
          return (
            <div
              key={m.id}
              onClick={() => setActivePerturbModel(m.id)}
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
                    const prov = (m.data as any).provenance || "";
                    const isFallback = prov.toLowerCase().includes("fallback") || prov.toLowerCase().includes("vesm");
                    return isFallback
                      ? <span className="text-[9px] font-mono px-2 py-0.5 rounded-full font-bold border bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">Fallback</span>
                      : <span className="text-[9px] font-mono px-2 py-0.5 rounded-full font-bold border bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">Active</span>;
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
                    {m.data.llr.toFixed(3)}
                  </span>
                </div>
                <div>
                  <span className="block text-[8px] uppercase font-bold tracking-wider text-slate-400">Emb. Shift</span>
                  <span className="text-xs font-mono font-bold" style={{ color: "var(--cs-accent-clay)" }}>
                    {m.data.embeddingShift.toFixed(3)}
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

      {/* Grid 2: Core Metrics of Selected Model */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="p-3 rounded-lg border transition-all duration-300 shadow-sm text-left" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
          <span className="block text-[9px] uppercase font-mono tracking-wider font-semibold text-slate-400">P(Wildtype AA)</span>
          <strong className="text-base font-bold font-mono block mt-1 text-sky-400">{activeEval.wtProbability.toFixed(4)}</strong>
          <span className="block text-[8px] mt-0.5 text-slate-500">Expectation of native {wtRes}</span>
        </div>
        <div className="p-3 rounded-lg border transition-all duration-300 shadow-sm text-left" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
          <span className="block text-[9px] uppercase font-mono tracking-wider font-semibold text-slate-400">P(Mutant AA)</span>
          <strong className="text-base font-bold font-mono block mt-1" style={{ color: mutProbColor }}>{activeEval.mutProbability.toFixed(4)}</strong>
          <span className="block text-[8px] mt-0.5 text-slate-500">Compatibility of variant {mutRes}</span>
        </div>
        <div className="p-3 rounded-lg border transition-all duration-300 shadow-sm text-left" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
          <span className="block text-[9px] uppercase font-mono tracking-wider font-semibold text-slate-400">Δ LLR (nats)</span>
          <strong className="text-base font-bold font-mono block mt-1" style={{ color: activeEval.llr <= THRESHOLDS.esm.pathogenic ? "var(--cs-text-danger)" : "var(--cs-text-success)" }}>{activeEval.llr.toFixed(3)}</strong>
          <span className="block text-[8px] mt-0.5 text-slate-500">Mutation penalty index</span>
        </div>
        <div className="p-3 rounded-lg border transition-all duration-300 shadow-sm text-left" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
          <span className="block text-[9px] uppercase font-mono tracking-wider font-semibold text-slate-400">Mutant Preference</span>
          <strong className="text-base font-bold font-mono block mt-1 text-slate-200">
            {activeEval.mutRank} <span className="text-[10px] text-slate-500">/ 20</span>
          </strong>
          <span className="block text-[8px] mt-0.5 text-slate-500">{preferenceLabel}</span>
        </div>
        <div className="p-3 rounded-lg border transition-all duration-300 shadow-sm text-left" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
          <span className="block text-[9px] uppercase font-mono tracking-wider font-semibold text-slate-400">Positional Entropy</span>
          <strong className="text-base font-bold font-mono block mt-1 text-indigo-400">{activeEval.positionalEntropy.toFixed(3)}</strong>
          <span className="block text-[8px] mt-0.5 text-slate-500">Residue flexibility (bits)</span>
        </div>
      </div>

      {/* Grid 3: Preference list & embedding shift chart */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Preference List */}
        <div className="p-4 rounded-xl border transition-all duration-300 shadow-sm space-y-3" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
          <div className="flex justify-between items-center border-b pb-2 text-left" style={{ borderColor: "var(--cs-border-subtle)" }}>
            <span className="text-[11px] uppercase font-bold tracking-wider font-sans text-slate-400">Residue Preference Distribution</span>
            <span className="text-[9px] px-2 py-0.5 rounded font-mono font-medium border bg-slate-500/5 text-slate-400 border-slate-500/10">Position {pos}</span>
          </div>
          
          <div className="space-y-2 h-[220px] overflow-y-auto pr-1">
            {activeEval.preferences.map((pref) => {
              const isWt = pref.aa === wtRes;
              const isMut = pref.aa === mutRes;
              const widthPercent = `${Math.max(1, pref.prob * 100)}%`;
              return (
                <div key={pref.aa} className="flex items-center gap-3 text-xs">
                  <span 
                    className="w-6 text-center font-mono font-bold py-0.5 rounded border text-[10px]"
                    style={
                      isWt 
                        ? { background: "rgba(2, 132, 199, 0.1)", color: "#0284C7", borderColor: "rgba(2, 132, 199, 0.2)" } 
                        : isMut 
                          ? { background: "var(--cs-bg-warning)", color: "var(--cs-text-warning)", borderColor: "rgba(217, 119, 6, 0.2)" } 
                          : { color: "var(--cs-text-secondary)", borderColor: "transparent" }
                    }
                  >
                    {pref.aa}
                  </span>
                  <div className="flex-1 h-3 rounded overflow-hidden relative" style={{ background: "var(--cs-bg-subtle)" }}>
                    <div 
                      className="h-full rounded-r transition-all duration-300" 
                      style={{ 
                        width: widthPercent,
                        background: isWt 
                          ? "#0284C7" 
                          : isMut 
                            ? "var(--cs-text-warning)" 
                            : "var(--cs-text-muted)"
                      }} 
                    />
                  </div>
                  <span className="w-12 text-right font-mono text-[10px]" style={{ color: "var(--cs-text-muted)" }}>
                    {(pref.prob * 100).toFixed(2)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Local Embedding Shift Line Chart */}
        <div className="p-4 rounded-xl border transition-all duration-300 shadow-sm space-y-3" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
          <div className="flex justify-between items-center border-b pb-2 text-left" style={{ borderColor: "var(--cs-border-subtle)" }}>
            <span className="text-[11px] uppercase font-bold tracking-wider font-sans text-slate-400">Local Contextual Embedding Shift</span>
            <span className="text-[9px] font-mono flex items-center gap-2" style={{ color: "var(--cs-accent-clay)" }}>
              {(activeEval as any).klDivergence !== undefined && (activeEval as any).klDivergence !== null && (
                <span style={{ color: "var(--cs-text-secondary)" }}>KL Div: {(activeEval as any).klDivergence.toFixed(3)}</span>
              )}
              <span className="font-bold text-slate-350">Max: {activeEval.embeddingShift.toFixed(3)}</span>
            </span>
          </div>

          {points.length > 0 ? (
            <div className="relative w-full overflow-x-auto flex justify-center py-2">
              <svg className="w-full max-w-[580px] h-[170px]" viewBox="0 0 580 170">
                <line x1="40" y1="140" x2="560" y2="140" stroke="var(--cs-border-subtle)" strokeWidth="1" />
                <line x1="40" y1="85" x2="560" y2="85" stroke="var(--cs-border-subtle)" strokeDasharray="3,3" strokeWidth="1" />
                <line x1="40" y1="30" x2="560" y2="30" stroke="var(--cs-border-subtle)" strokeDasharray="3,3" strokeWidth="1" />

                <path 
                  d={`${pathD} L ${points[points.length - 1].x} 140 L 40 140 Z`} 
                  fill="url(#esmc-gradient)" 
                  opacity="0.15" 
                />

                <path 
                  d={pathD} 
                  fill="none" 
                  stroke="var(--cs-accent-clay)" 
                  strokeWidth="2" 
                />

                {points.map((p, idx) => {
                  const isMutSite = p.position === pos;
                  return (
                    <g key={idx}>
                      <circle 
                        cx={p.x} 
                        cy={p.y} 
                        r={isMutSite ? 5 : 3.5} 
                        fill={isMutSite ? "var(--cs-accent-clay)" : "var(--cs-surface)"} 
                        stroke="var(--cs-accent-clay)" 
                        strokeWidth="2" 
                      />
                      {idx % 3 === 0 || isMutSite ? (
                        <text 
                          x={p.x} 
                          y="155" 
                          textAnchor="middle" 
                          fontSize="9" 
                          fontFamily="monospace"
                          fill={isMutSite ? "var(--cs-text-primary)" : "var(--cs-text-muted)"}
                          fontWeight={isMutSite ? "bold" : "normal"}
                        >
                          {isMutSite ? `Mut:${p.position}` : p.position}
                        </text>
                      ) : null}
                    </g>
                  );
                })}

                <defs>
                  <linearGradient id="esmc-gradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--cs-accent-clay)" />
                    <stop offset="100%" stopColor="var(--cs-accent-clay)" stopOpacity="0" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
          ) : (
            <div className="py-8 text-center text-[11px] font-mono animate-pulse text-slate-500">
              Local contextual embedding shift data unavailable for this window.
            </div>
          )}
          <p className="text-[10px] leading-normal text-left text-slate-500">
            * Line plots trace {shiftMetric} shifts in model embedding coordinates across the structural neighborhood (± 10 residues). Average local shift is {meanShift.toFixed(3)}.
          </p>
        </div>
      </div>

      {/* Section B: Physical Structural Geometry */}
      {(foldingEnergetics || structuralDiff) && (() => {
        const sidechainRmsd = foldingEnergetics?.localSidechainRmsd ?? null;
        const vdw = foldingEnergetics?.vdw ?? null;
        const electrostatics = foldingEnergetics?.electrostatics ?? null;
        const stericClashWarning = foldingEnergetics?.stericClashWarning ?? false;

        const maxCaDisp = structuralDiff?.windowDisplacements && structuralDiff.windowDisplacements.length > 0
          ? Math.max(...structuralDiff.windowDisplacements.map(d => d.displacement))
          : null;

        const lpsScore = calculateLps(activeEval?.llr, vdw, structuralDiff?.clashes.diff, maxCaDisp);
        const lpsDetails = getLpsDetails(lpsScore);

        const seqEvidence = getSequenceEvidenceText(activeEval?.llr, currentModel.name.split(" ")[0]);
        const energyEvidence = getEnergeticEvidenceText(vdw, foldingEnergetics?.foldxSd);
        const geomEvidence = getGeometricEvidenceText(maxCaDisp);
        const overallInterpretation = getOverallInterpretationText(maxCaDisp, vdw);

        return (
          <div className="space-y-5">
            <div className="flex items-center gap-3 pt-2">
              <span className="text-[10px] uppercase font-mono font-bold tracking-wider text-slate-400">
                Section B: Physical structural perturbation &amp; geometry
              </span>
              <div className="flex-1 border-t" style={{ borderColor: "var(--cs-border-subtle)" }} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2 p-4 rounded-xl border flex flex-col gap-3 transition-all duration-300 shadow-sm text-left" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
                <div className="flex items-center gap-2 border-b pb-2" style={{ borderColor: "var(--cs-border-subtle)" }}>
                  <Sparkles className="w-4 h-4 text-purple-500 shrink-0" />
                  <span className="text-[11px] uppercase font-bold tracking-wider font-sans text-slate-300" style={{ color: "var(--cs-text-secondary)" }}>
                    Local perturbation summary
                  </span>
                </div>
                <ul className="list-disc pl-5 space-y-1.5 text-[11px] leading-relaxed text-slate-300">
                  <li>
                    <strong>Sequence-model evidence</strong>: {seqEvidence.replace(/Sequence-model evidence:\s*/i, "")}
                  </li>
                  <li>
                    <strong>Energetic evidence</strong>: {energyEvidence.replace(/Energetic evidence:\s*/i, "")}
                  </li>
                  <li>
                    <strong>Geometric evidence</strong>: {geomEvidence.replace(/Geometric evidence:\s*/i, "")}
                  </li>
                  <li>
                    <strong>Overall interpretation</strong>: {overallInterpretation}
                  </li>
                </ul>
              </div>

              <div className="p-4 rounded-xl border flex flex-col justify-between transition-all duration-300 shadow-sm text-left" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
                <div className="border-b pb-2 flex items-center justify-between" style={{ borderColor: "var(--cs-border-subtle)" }}>
                  <span className="text-[10px] uppercase font-mono tracking-wider font-bold text-slate-400">
                    Consensus Verdict
                  </span>
                  <span className={`text-[8px] uppercase font-mono px-2 py-0.5 rounded border font-bold ${lpsDetails.badgeClass}`}>
                    {lpsDetails.labelText}
                  </span>
                </div>
                <div className="my-2.5">
                  <p className="text-[9px] text-slate-400 leading-normal">
                    Experimental score combining sequence LLR penalty, FoldX steric energy, clash differences, and backbone Cα displacement.
                  </p>
                </div>
                <div className="flex items-baseline gap-1 mt-auto">
                  {lpsDetails.score !== null ? (
                    <>
                      <strong className="text-2xl font-bold font-mono" style={{ color: lpsDetails.color }}>
                        {lpsDetails.score.toFixed(1)}
                      </strong>
                      <span className="text-[10px] font-mono text-slate-500">/ 100</span>
                    </>
                  ) : (
                    <strong className="text-sm font-bold font-mono text-slate-500">N/A</strong>
                  )}
                </div>
              </div>
            </div>

            {foldingEnergetics && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
                <div
                  className="p-3 rounded-xl border flex flex-col justify-between w-full transition-all duration-200 shadow-sm"
                  style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="block text-[9px] uppercase font-bold tracking-wider text-slate-400">Sidechain RMSD</span>
                    <Info className="w-3 h-3 shrink-0 text-slate-500" />
                  </div>
                  <strong className="text-base font-bold font-mono block mt-1.5" style={{
                    color: sidechainRmsd !== null && sidechainRmsd > 1.5 ? "var(--cs-text-danger)"
                      : sidechainRmsd !== null && sidechainRmsd > 0.8 ? "var(--cs-text-warning)"
                      : "var(--cs-text-success)"
                  }}>
                    {sidechainRmsd !== null ? `${sidechainRmsd.toFixed(2)} Å` : "N/A"}
                  </strong>
                  <span className="text-[8px] mt-0.5 text-slate-500">Local sidechain displacement (FoldX)</span>
                </div>

                <div
                  className="p-3 rounded-xl border flex flex-col justify-between w-full transition-all duration-200 shadow-sm"
                  style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="block text-[9px] uppercase font-bold tracking-wider text-slate-400">VdW Clash Δ</span>
                    <Info className="w-3 h-3 shrink-0 text-slate-500" />
                  </div>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <strong className="text-base font-bold font-mono" style={{ color: stericClashWarning ? "var(--cs-text-danger)" : "var(--cs-text-success)" }}>
                      {vdw !== null ? `${vdw >= 0 ? "+" : ""}${vdw.toFixed(2)}` : "N/A"}
                      {foldingEnergetics.foldxSd !== undefined && foldingEnergetics.foldxSd !== null && ` ± ${foldingEnergetics.foldxSd.toFixed(2)}`}
                      {vdw !== null && " kcal/mol"}
                    </strong>
                    {stericClashWarning && (
                      <span className="text-[7px] px-1 py-0.5 rounded font-bold uppercase border bg-rose-500/10 text-rose-500 border-rose-500/20">
                        Clash
                      </span>
                    )}
                  </div>
                  <span className="text-[8px] mt-0.5 text-slate-500">Steric repulsion energy delta</span>
                </div>

                <div
                  className="p-3 rounded-xl border flex flex-col justify-between w-full transition-all duration-200 shadow-sm"
                  style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="block text-[9px] uppercase font-bold tracking-wider text-slate-400">Electrostatic Δ</span>
                    <Info className="w-3 h-3 shrink-0 text-slate-500" />
                  </div>
                  <strong className="text-base font-bold font-mono block mt-1.5" style={{ color: "var(--cs-text-primary)" }}>
                    {electrostatics !== null ? `${electrostatics >= 0 ? "+" : ""}${electrostatics.toFixed(2)} kcal/mol` : "N/A"}
                  </strong>
                  <span className="text-[8px] mt-0.5 text-slate-500">Charge interaction shift</span>
                </div>
              </div>
            )}

            {metrics && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(metrics.lostContacts !== undefined || metrics.gainedContacts !== undefined) && (
                  <div className="p-4 rounded-xl border space-y-3 transition-all duration-300 shadow-sm text-left" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
                    <div className="flex items-center gap-1.5 border-b pb-2" style={{ borderColor: "var(--cs-border-subtle)" }}>
                      <Layers className="w-4 h-4 text-teal-500 shrink-0" />
                      <span className="text-[11px] uppercase font-bold tracking-wider font-sans text-slate-400">
                        Local contact network
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 py-1 text-center font-mono">
                      <div>
                        <span className="block text-[8px] uppercase font-bold tracking-wider text-slate-400">Lost contacts</span>
                        <strong className="text-sm font-bold block mt-1" style={{ color: "var(--cs-text-danger)" }}>
                          {metrics.lostContacts ?? 0}
                        </strong>
                      </div>
                      <div>
                        <span className="block text-[8px] uppercase font-bold tracking-wider text-slate-400">Gained contacts</span>
                        <strong className="text-sm font-bold block mt-1" style={{ color: "var(--cs-text-success)" }}>
                          {metrics.gainedContacts ?? 0}
                        </strong>
                      </div>
                      <div>
                        <span className="block text-[8px] uppercase font-bold tracking-wider text-slate-400">Net change</span>
                        {(() => {
                          const net = (metrics.gainedContacts ?? 0) - (metrics.lostContacts ?? 0);
                          return (
                            <strong className="text-sm font-bold block mt-1" style={{ color: net < 0 ? "var(--cs-text-danger)" : net > 0 ? "var(--cs-text-success)" : "var(--cs-text-primary)" }}>
                              {net > 0 ? `+${net}` : net}
                            </strong>
                          );
                        })()}
                      </div>
                    </div>
                    <p className="text-[9px] font-sans leading-normal text-slate-500 mt-2">
                      Contacts counted within a 4 Å heavy-atom cutoff after WT→MT superposition.
                    </p>
                  </div>
                )}

                {metrics.deltaSasa !== undefined && metrics.deltaSasa !== null && (
                  <div className="p-4 rounded-xl border space-y-3 transition-all duration-300 shadow-sm text-left flex flex-col justify-between" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
                    <div>
                      <div className="flex items-center gap-1.5 border-b pb-2" style={{ borderColor: "var(--cs-border-subtle)" }}>
                        <Layers className="w-4 h-4 text-sky-500 shrink-0" />
                        <span className="text-[11px] uppercase font-bold tracking-wider font-sans text-slate-400">
                          ΔSASA (mutation site)
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-3 font-mono">
                        <span className="text-[10px] font-bold text-slate-400">Exposure delta</span>
                        <strong className="text-sm font-bold" style={{ color: metrics.deltaSasa > 0 ? "var(--cs-text-warning)" : "var(--cs-text-success)" }}>
                          {metrics.deltaSasa >= 0 ? `+${metrics.deltaSasa.toFixed(1)}` : metrics.deltaSasa.toFixed(1)} Å² {metrics.deltaSasa > 0 ? "more exposed" : "more buried"}
                        </strong>
                      </div>
                    </div>
                    <p className="text-[9px] font-sans leading-normal text-slate-500 mt-3 pt-2 border-t border-dashed" style={{ borderColor: "var(--cs-border-subtle)" }}>
                      Positive values indicate the mutated residue becomes more solvent exposed relative to the WT structure.
                    </p>
                  </div>
                )}
              </div>
            )}

            {structuralDiff && (() => {
              const isFoldxRigid = structuralDiff.rmsd === 0;
              return (
                <div className="p-4 rounded-xl border space-y-3.5 transition-all duration-300 shadow-sm text-left" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
                  <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: "var(--cs-border-subtle)" }}>
                    <span className="text-[11px] uppercase font-bold tracking-wider font-sans text-slate-400">
                      Kabsch-Aligned Structural Displacements
                    </span>
                    <span className="text-[9px] font-mono px-2 py-0.5 rounded border bg-slate-500/5 text-slate-400 border-slate-500/10">
                      {isFoldxRigid ? "Rigid Backbone (FoldX)" : "Flexible Backbone"}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                    <div className="p-2.5 border rounded-lg" style={{ borderColor: "var(--cs-border-subtle)", background: "var(--cs-surface-2)" }}>
                      <div className="text-[9px] font-bold uppercase tracking-wider font-mono text-slate-400">Global RMSD</div>
                      <div className="text-sm font-bold font-mono mt-1" style={{ color: "var(--cs-text-primary)" }}>
                        {isFoldxRigid ? "0.0000 Å" : `${structuralDiff.rmsd.toFixed(4)} Å`}
                      </div>
                    </div>
                    <div className="p-2.5 border rounded-lg" style={{ borderColor: "var(--cs-border-subtle)", background: "var(--cs-surface-2)" }}>
                      <div className="text-[9px] font-bold uppercase tracking-wider font-mono text-slate-400">Local RMSD</div>
                      <div className="text-sm font-bold font-mono mt-1" style={{ color: "var(--cs-text-primary)" }}>
                        {structuralDiff.localRmsd !== null ? `${structuralDiff.localRmsd.toFixed(4)} Å` : "N/A"}
                      </div>
                    </div>
                    <div className="p-2.5 border rounded-lg" style={{ borderColor: "var(--cs-border-subtle)", background: "var(--cs-surface-2)" }}>
                      <div className="text-[9px] font-bold uppercase tracking-wider font-mono text-slate-400">WT Clashes</div>
                      <div className="text-sm font-bold font-mono mt-1" style={{ color: "var(--cs-text-primary)" }}>{structuralDiff.clashes.wtClashCount}</div>
                    </div>
                    <div className="p-2.5 border rounded-lg" style={{ borderColor: "var(--cs-border-subtle)", background: "var(--cs-surface-2)" }}>
                      <div className="text-[9px] font-bold uppercase tracking-wider font-mono text-slate-400">Clash Diff</div>
                      <div className="text-sm font-bold font-mono mt-1" style={{ color: structuralDiff.clashes.diff > 0 ? "var(--cs-text-danger)" : "var(--cs-text-success)" }}>
                        {structuralDiff.clashes.diff > 0 ? `+${structuralDiff.clashes.diff}` : structuralDiff.clashes.diff}
                      </div>
                    </div>
                  </div>

                  {isFoldxRigid && (
                    <div className="p-2.5 rounded-lg border text-[10px] leading-relaxed flex gap-2 items-start" style={{ background: "rgba(245, 158, 11, 0.04)", borderColor: "rgba(245, 158, 11, 0.15)", color: "var(--cs-text-warning)" }}>
                      <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-500" />
                      <p>
                        <strong>Template-constrained alignment notice</strong>: FoldX mutation uses a rigid Cα backbone template, meaning backbone coordinates remain identical and global Cα RMSD is mathematically 0.0 Å.
                      </p>
                    </div>
                  )}

                  {structuralDiff.windowDisplacements && structuralDiff.windowDisplacements.length > 0 && (
                    <div className="pt-3 border-t border-dashed" style={{ borderColor: "var(--cs-border-subtle)" }}>
                      <span className="block text-[11px] uppercase font-bold tracking-wider mb-3 font-sans text-left text-slate-400">
                        Local Backbone Displacement Profile
                      </span>
                      {(() => {
                        const displacements = structuralDiff.windowDisplacements;
                        const maxDispVal = displacements.length > 0 ? Math.max(...displacements.map(d => d.displacement)) : 0.6;
                        const yMax = Math.max(1.0, Math.ceil(maxDispVal * 2) / 2);
                        
                        const chartHeight = 130;
                        const chartWidth = 560;
                        const paddingLeft = 45;
                        const paddingRight = 20;
                        const paddingTop = 15;
                        const paddingBottom = 25;
                        
                        const graphWidth = chartWidth - paddingLeft - paddingRight;
                        const graphHeight = chartHeight - paddingTop - paddingBottom;
                        
                        const barWidth = displacements.length > 0 ? Math.max(12, Math.floor(graphWidth / displacements.length) - 6) : 20;
                        const getX = (index: number) => paddingLeft + index * (graphWidth / displacements.length) + (graphWidth / displacements.length - barWidth) / 2;
                        const getY = (val: number) => paddingTop + graphHeight - (val / yMax) * graphHeight;

                        const gridValues = [0, 0.5, 1.0, 1.5].filter(v => v <= yMax);

                        return (
                          <div className="relative w-full overflow-x-auto flex justify-center py-2.5 border rounded-lg" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}>
                            <svg className="w-full max-w-[560px] h-[130px]" viewBox={`0 0 560 130`}>
                              {gridValues.map(v => (
                                <g key={v}>
                                  <line
                                    x1={paddingLeft}
                                    y1={getY(v)}
                                    x2={chartWidth - paddingRight}
                                    y2={getY(v)}
                                    stroke="var(--cs-border-subtle)"
                                    strokeWidth="1"
                                    strokeDasharray={v === 0 ? "none" : "3,3"}
                                  />
                                  <text
                                    x={paddingLeft - 8}
                                    y={getY(v) + 3}
                                    textAnchor="end"
                                    fontSize="8"
                                    fontFamily="monospace"
                                    fill="var(--cs-text-muted)"
                                  >
                                    {v.toFixed(1)} Å
                                  </text>
                                </g>
                              ))}

                              {yMax >= 0.5 && (
                                <g>
                                  <line
                                    x1={paddingLeft}
                                    y1={getY(0.5)}
                                    x2={chartWidth - paddingRight}
                                    y2={getY(0.5)}
                                    stroke="rgba(239, 68, 68, 0.45)"
                                    strokeDasharray="4,4"
                                    strokeWidth="1.5"
                                  />
                                  <text
                                    x={chartWidth - paddingRight - 5}
                                    y={getY(0.5) - 3}
                                    textAnchor="end"
                                    fontSize="8"
                                    fontFamily="sans-serif"
                                    fill="rgba(239, 68, 68, 0.85)"
                                    fontWeight="bold"
                                  >
                                    High Disruption (0.5 Å)
                                  </text>
                                </g>
                              )}

                              {displacements.map((d: any, idx: number) => {
                                const x = getX(idx);
                                const y = getY(d.displacement);
                                const barH = paddingTop + graphHeight - y;
                                const isMut = d.resSeq === pos;
                                const isHigh = d.displacement > 0.5;
                                
                                return (
                                  <g key={idx}>
                                    <rect
                                      x={x}
                                      y={y}
                                      width={barWidth}
                                      height={Math.max(1, barH)}
                                      rx="1.5"
                                      fill={isHigh ? "rgba(239, 68, 68, 0.65)" : isMut ? "var(--cs-accent-clay)" : "rgba(13, 148, 136, 0.5)"}
                                      stroke={isHigh ? "rgb(239, 68, 68)" : isMut ? "var(--cs-accent-clay)" : "rgb(13, 148, 136)"}
                                      strokeWidth="1.2"
                                    />
                                    <text
                                      x={x + barWidth / 2}
                                      y={chartHeight - 8}
                                      textAnchor="middle"
                                      fontSize="8"
                                      fontFamily="monospace"
                                      fill={isMut ? "var(--cs-text-primary)" : "var(--cs-text-muted)"}
                                      fontWeight={isMut ? "bold" : "normal"}
                                    >
                                      {d.resName}{d.resSeq}
                                    </text>
                                  </g>
                                );
                              })}
                            </svg>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        );
      })()}

      {/* Section C: ESM3 exploratory structural hypotheses */}
      {result.esm3Eval && !("error" in result.esm3Eval) && (() => {
        const esm3 = result.esm3Eval;
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-3 pt-4">
              <span className="text-[10px] uppercase font-mono font-bold tracking-wider text-slate-400">
                Section C: ESM3 exploratory structural hypotheses
              </span>
              <div className="flex-1 border-t" style={{ borderColor: "var(--cs-border-subtle)" }} />
            </div>

            <div className="p-4 rounded-xl border space-y-3.5 transition-all duration-300 shadow-sm text-left" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
              <div className="flex items-center justify-between border-b pb-2.5" style={{ borderColor: "var(--cs-border-subtle)" }}>
                <div className="flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-purple-500 shrink-0" />
                  <span className="text-[11px] uppercase font-bold tracking-wider font-sans text-slate-300">
                    ESM3 Exploratory Structural Hypotheses
                  </span>
                </div>
                <span className="text-[8px] uppercase tracking-wider font-mono font-bold px-2 py-0.5 rounded border bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20 shadow-sm animate-pulse">
                  Exploratory
                </span>
              </div>

              <div className="p-3 rounded-lg border text-[10px] leading-relaxed flex gap-2 items-start" style={{ background: "rgba(147, 51, 234, 0.03)", borderColor: "rgba(147, 51, 234, 0.15)", color: "var(--cs-text-secondary)" }}>
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-purple-500" />
                <p>
                  Derived from ESM3 template-conditioned structure generation. These outputs are <strong>hypothesis-generating model predictions</strong> and should not be interpreted as experimentally validated structural changes.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="p-2.5 border rounded-lg flex flex-col justify-between" style={{ borderColor: "var(--cs-border-subtle)", background: "var(--cs-surface-2)" }}>
                  <span className="text-[8px] font-bold uppercase tracking-wider font-mono text-slate-400">Refinement Drift</span>
                  <strong className="text-sm font-bold font-mono mt-1" style={{
                    color: esm3.structuralChangeLevel === "major" ? "var(--cs-text-danger)"
                      : esm3.structuralChangeLevel === "moderate" ? "var(--cs-text-warning)"
                      : "var(--cs-text-success)"
                  }}>
                    {esm3.structuralChangeLevel.toUpperCase()}
                  </strong>
                  <span className="text-[8px] mt-0.5 text-slate-400">De novo backbone realignment</span>
                </div>

                <div className="p-2.5 border rounded-lg flex flex-col justify-between" style={{ borderColor: "var(--cs-border-subtle)", background: "var(--cs-surface-2)" }}>
                  <span className="text-[8px] font-bold uppercase tracking-wider font-mono text-slate-400">Confidence</span>
                  <strong className="text-sm font-bold font-mono mt-1" style={{ color: "var(--cs-text-primary)" }}>
                    {esm3.confidence?.level ? esm3.confidence.level.toUpperCase() : "N/A"}
                    {esm3.confidence?.plddt !== undefined && esm3.confidence?.plddt !== null && ` (${esm3.confidence.plddt.toFixed(1)})`}
                  </strong>
                  <span className="text-[8px] mt-0.5 text-slate-400">Model prediction confidence</span>
                </div>

                <div className="p-2.5 border rounded-lg flex flex-col justify-between" style={{ borderColor: "var(--cs-border-subtle)", background: "var(--cs-surface-2)" }}>
                  <span className="text-[8px] font-bold uppercase tracking-wider font-mono text-slate-400">Microenvironment</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {esm3.microenvironments?.map((env: string, i: number) => (
                      <span key={i} className="text-[8px] px-1 py-0.5 rounded bg-purple-500/5 text-purple-400 border border-purple-500/10 font-bold uppercase">
                        {env}
                      </span>
                    )) || "N/A"}
                  </div>
                  <span className="text-[8px] mt-0.5 text-slate-400">Local coordinate classification</span>
                </div>
              </div>

              {esm3.putativeStructuralChanges && esm3.putativeStructuralChanges.length > 0 && (
                <div className="pt-2.5 border-t border-dashed" style={{ borderColor: "var(--cs-border-subtle)" }}>
                  <span className="block text-[9px] uppercase font-bold tracking-wider mb-2 font-mono text-slate-400 text-left">
                    Putative Structural Impact
                  </span>
                  <ul className="list-disc pl-4 space-y-1 text-[10px] text-slate-300 text-left">
                    {esm3.putativeStructuralChanges.map((change: string, i: number) => (
                      <li key={i}>{change}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
