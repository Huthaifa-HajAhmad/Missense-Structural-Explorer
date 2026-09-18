import React from "react";
import { Sparkles } from "lucide-react";

interface Esm3ExploratorySectionProps {
  esm3Eval: any;
}

export function Esm3ExploratorySection({ esm3Eval }: Esm3ExploratorySectionProps) {
  if (!esm3Eval || "error" in esm3Eval) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 pt-4">
        <span className="text-[10px] uppercase font-mono font-bold tracking-wider text-cs-text-muted">
          Section C: ESM3 exploratory structural hypotheses
        </span>
        <div className="flex-1 border-t" style={{ borderColor: "var(--cs-border-subtle)" }} />
      </div>

      <div className="p-4 rounded-xl border space-y-3.5 transition-all duration-300 shadow-sm text-left" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
        <div className="flex items-center justify-between border-b pb-2.5" style={{ borderColor: "var(--cs-border-subtle)" }}>
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-purple-500 shrink-0" />
            <span className="text-[11px] uppercase font-bold tracking-wider font-sans text-cs-text-secondary">
              ESM3 Exploratory Structural Hypotheses
            </span>
          </div>
          <span
            className="text-[8px] uppercase tracking-wider font-mono font-bold px-2 py-0.5 rounded border bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20 shadow-sm"
            title="These are hypothesis-generating model predictions. They should not be interpreted as experimentally validated structural changes."
          >
            Exploratory · not validated
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="p-2.5 border rounded-lg flex flex-col justify-between" style={{ borderColor: "var(--cs-border-subtle)", background: "var(--cs-surface-2)" }}>
            <span className="text-[9.5px] font-bold uppercase tracking-wider font-mono text-cs-text-muted">Refinement Drift</span>
            <strong className="text-sm font-bold font-mono mt-1" style={{
              color: esm3Eval.structuralChangeLevel === "major" ? "var(--cs-text-danger)"
                : esm3Eval.structuralChangeLevel === "moderate" ? "var(--cs-text-warning)"
                : "var(--cs-text-success)"
            }}>
              {esm3Eval.structuralChangeLevel.toUpperCase()}
            </strong>
            <span className="text-[10px] mt-0.5 text-cs-text-muted">De novo backbone realignment</span>
          </div>

          <div className="p-2.5 border rounded-lg flex flex-col justify-between" style={{ borderColor: "var(--cs-border-subtle)", background: "var(--cs-surface-2)" }}>
            <span className="text-[9.5px] font-bold uppercase tracking-wider font-mono text-cs-text-muted">Confidence</span>
            <strong className="text-sm font-bold font-mono mt-1" style={{ color: "var(--cs-text-primary)" }}>
              {esm3Eval.confidence?.level ? esm3Eval.confidence.level.toUpperCase() : "N/A"}
              {esm3Eval.confidence?.plddt !== undefined && esm3Eval.confidence?.plddt !== null && ` (${esm3Eval.confidence.plddt.toFixed(1)})`}
            </strong>
            <span className="text-[10px] mt-0.5 text-cs-text-muted">Model prediction confidence</span>
          </div>

          <div className="p-2.5 border rounded-lg flex flex-col justify-between" style={{ borderColor: "var(--cs-border-subtle)", background: "var(--cs-surface-2)" }}>
            <span className="text-[9.5px] font-bold uppercase tracking-wider font-mono text-cs-text-muted">Microenvironment</span>
            <div className="mt-1 flex flex-wrap gap-1">
              {esm3Eval.microenvironments?.map((env: string, i: number) => (
                <span key={i} className="text-[8px] px-1 py-0.5 rounded bg-purple-500/5 text-purple-400 border border-purple-500/10 font-bold uppercase">
                  {env}
                </span>
              )) || "N/A"}
            </div>
            <span className="text-[10px] mt-0.5 text-cs-text-muted">Local coordinate classification</span>
          </div>
        </div>

        {esm3Eval.putativeStructuralChanges && esm3Eval.putativeStructuralChanges.length > 0 && (
          <div className="pt-2.5 border-t border-dashed" style={{ borderColor: "var(--cs-border-subtle)" }}>
            <span className="block text-[9.5px] uppercase font-bold tracking-wider mb-2 font-mono text-cs-text-muted text-left">
              Putative Structural Impact
            </span>
            <ul className="list-disc pl-4 space-y-1.5 text-[11px] text-cs-text-secondary text-left">
              {esm3Eval.putativeStructuralChanges.map((change: string, i: number) => (
                <li key={i}>{change}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
