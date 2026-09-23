import React from "react";
import { classifyLlr, isCalibrated, type ModelCalibration } from "../../../shared/modelCalibration";

interface PerturbationMetricsBarProps {
  activeEval: any;
  /** Three-letter display labels ("Ser"). Matching against model payloads happens elsewhere. */
  wtLabel: string;
  mutLabel: string;
  /** Governs whether ΔLLR may be tinted against a cut-point. */
  calibration?: ModelCalibration | null;
}

/**
 * The five decisive per-residue quantities for the selected model.
 *
 * Colour policy: only ΔLLR carries a risk tint, and only when the model has a published
 * cut-point. The probabilities are deliberately left neutral — a low P(mutant) is the
 * expected reading for a damaging substitution, so tinting it amber would imply the
 * number is reassuring when it is not. The model's own preference ranking, shown as a
 * rank out of 20, is what carries the qualitative read.
 */
export function PerturbationMetricsBar({
  activeEval,
  wtLabel,
  mutLabel,
  calibration = null
}: PerturbationMetricsBarProps) {
  const mutProb = typeof activeEval.mutProbability === "number" ? activeEval.mutProbability : null;
  const wtProb = typeof activeEval.wtProbability === "number" ? activeEval.wtProbability : null;

  /**
   * Relative depletion is the interpretable quantity here: how much of the wild-type
   * residue's likelihood the mutant retains. It is a ratio of two numbers from the same
   * model, so unlike ΔLLR it needs no cross-model calibration.
   */
  const retention = wtProb !== null && mutProb !== null && wtProb > 0
    ? mutProb / wtProb
    : null;

  const llrVal = typeof activeEval.llr === "number" ? activeEval.llr : null;
  const llrIsCalibrated = isCalibrated(calibration);
  const llrVerdict = classifyLlr(llrVal, calibration);
  const llrColor = !llrIsCalibrated
    ? "var(--cs-text-primary)"
    : llrVerdict === "pathogenic"
      ? "var(--cs-text-danger)"
      : "var(--cs-text-success)";

  const mutRank = typeof activeEval.mutRank === "number" ? activeEval.mutRank : null;
  const preferenceLabel = mutRank === null
    ? "Rank unavailable"
    : mutRank <= 3
      ? "Highly Preferred"
      : mutRank >= 15
        ? "Strongly Dispreferred"
        : "Neutral Preference";

  const entropy = typeof activeEval.positionalEntropy === "number" ? activeEval.positionalEntropy : null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      <div className="p-3 rounded-lg border transition-all duration-300 shadow-sm text-left" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
        <span className="block text-[9px] uppercase font-mono tracking-wider font-semibold text-cs-text-muted">P(Wildtype AA)</span>
        <strong className="text-base font-bold font-mono block mt-1 text-sky-700 dark:text-sky-400 tabular-nums">
          {wtProb === null ? "N/A" : wtProb.toFixed(4)}
        </strong>
        <span className="block text-[10px] mt-0.5 text-cs-text-muted">Expectation of native {wtLabel}</span>
      </div>

      <div className="p-3 rounded-lg border transition-all duration-300 shadow-sm text-left" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
        <span className="block text-[9px] uppercase font-mono tracking-wider font-semibold text-cs-text-muted">P(Mutant AA)</span>
        <strong className="text-base font-bold font-mono block mt-1 tabular-nums" style={{ color: "var(--cs-text-primary)" }}>
          {mutProb === null ? "N/A" : mutProb.toFixed(4)}
        </strong>
        <span className="block text-[10px] mt-0.5 text-cs-text-muted">
          {retention === null
            ? `Compatibility of variant ${mutLabel}`
            : `Retains ${(retention * 100) < 1 ? "<1" : (retention * 100).toFixed(0)}% of native likelihood`}
        </span>
      </div>

      <div className="p-3 rounded-lg border transition-all duration-300 shadow-sm text-left" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
        <span className="block text-[9px] uppercase font-mono tracking-wider font-semibold text-cs-text-muted">Δ LLR (nats)</span>
        <strong className="text-base font-bold font-mono block mt-1 tabular-nums" style={{ color: llrColor }}>
          {llrVal === null ? "N/A" : llrVal.toFixed(3)}
        </strong>
        <span className="block text-[10px] mt-0.5 text-cs-text-muted">
          {llrIsCalibrated ? "Against published cut-point" : "Model-native scale · uncalibrated"}
        </span>
      </div>

      <div className="p-3 rounded-lg border transition-all duration-300 shadow-sm text-left" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
        <span className="block text-[9px] uppercase font-mono tracking-wider font-semibold text-cs-text-muted">Mutant Preference</span>
        <strong className="text-base font-bold font-mono block mt-1 tabular-nums" style={{ color: "var(--cs-text-primary)" }}>
          {mutRank === null ? "N/A" : <>{mutRank} <span className="text-[10px] text-cs-text-muted">/ 20</span></>}
        </strong>
        <span className="block text-[10px] mt-0.5 text-cs-text-muted">{preferenceLabel}</span>
      </div>

      <div className="p-3 rounded-lg border transition-all duration-300 shadow-sm text-left" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
        <span className="block text-[9px] uppercase font-mono tracking-wider font-semibold text-cs-text-muted">Positional Entropy</span>
        <strong className="text-base font-bold font-mono block mt-1 text-indigo-700 dark:text-indigo-400 tabular-nums">
          {entropy === null ? "N/A" : entropy.toFixed(3)}
        </strong>
        <span className="block text-[10px] mt-0.5 text-cs-text-muted">
          {entropy === null
            ? "Residue flexibility"
            : entropy >= 2.5
              ? "Broadly tolerant site (bits)"
              : entropy <= 1.0
                ? "Strongly constrained (bits)"
                : "Residue flexibility (bits)"}
        </span>
      </div>
    </div>
  );
}
