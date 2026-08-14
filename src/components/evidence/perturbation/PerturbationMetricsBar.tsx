import React from "react";
import { THRESHOLDS } from "../../../shared/thresholds";

interface PerturbationMetricsBarProps {
  activeEval: any;
  wtRes: string;
  mutRes: string;
}

export function PerturbationMetricsBar({
  activeEval,
  wtRes,
  mutRes
}: PerturbationMetricsBarProps) {
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

  return (
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
  );
}
