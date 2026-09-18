import React, { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  Database,
  FlaskConical,
  Gauge,
  Info,
  Layers,
  Ruler,
  Sigma,
  Sparkles
} from "lucide-react";
import type { AnalysisResult } from "../../types";
import {
  classifyLlr,
  isCalibrated,
  describeWithinModelRank,
  describeScaleHomogeneity,
  type ModelCalibration
} from "../../shared/modelCalibration";
import {
  extractPerturbationEvaluations,
  describeModelRoster,
  toPooledEvaluationList,
  type PerturbationModelId
} from "../../shared/perturbationModels";
import { computeMultiModelLlr, calculateLps } from "../../shared/perturbationHelpers";

interface PerturbationInspectorProps {
  analysisResult: AnalysisResult | null;
  /** Which model card is selected in the main column, so both panes stay in step. */
  activePerturbationModel?: PerturbationModelId;
  /** SaProt's display name and calibration row both depend on the serving engine. */
  saprotEngine?: string | null;
  foldingEnergetics?: any;
  structuralDiff?: any;
  metrics?: any;
}

/**
 * Companion pane for the "Structural Perturbation" evidence tab.
 *
 * Division of labour — the main column owns the decisive numbers (model cards, the metric
 * row, the preference distribution, the embedding-shift trace, the geometry KPIs). This
 * pane owns everything a reader needs in order to interpret those numbers without the
 * main column having to carry prose between its panels:
 *
 *   1. Model registry        — what ran, on what scale, and whether that scale is calibrated
 *   2. How to read the scales— LLR, embedding shift and entropy, and their units
 *   3. Within-model position — the one cross-model statement that is actually defensible
 *   4. Verdict decomposition — the terms feeding the 0-100 perturbation score
 *   5. Geometry calibration  — FoldX's rigid backbone, contact cutoff, ΔSASA sign
 *   6. Caveats               — what these scores do not license
 *   7. ESM3 exploratory scope
 *   8. Provenance
 *
 * The calibration registry in src/shared/modelCalibration.ts is authoritative for section
 * 1: models with no published cut-point are reported as uncalibrated rather than tinted
 * against another model's threshold.
 */

function SectionLabel({
  Icon,
  children
}: {
  Icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <h3 className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5 m-0">
      <Icon className="w-3.5 h-3.5 text-cs-accent-clay" />
      {children}
    </h3>
  );
}

/** Human labels for the classification result. The raw tokens are internal only. */
const VERDICT_LABELS: Record<string, string> = {
  pathogenic: "Constrained",
  benign: "Tolerated",
  intermediate: "Intermediate",
  uncalibrated: "No cut-point",
  unavailable: "No score"
};
function statusBadgeClass(calibration: ModelCalibration | null): string {
  if (!calibration) return "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20";
  switch (calibration.status) {
    case "calibrated":
      return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";
    case "informational":
      return "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20";
    default:
      return "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20";
  }
}

function statusLabel(calibration: ModelCalibration | null): string {
  if (!calibration) return "Unknown";
  switch (calibration.status) {
    case "calibrated": return "Calibrated";
    case "informational": return "Informational";
    default: return "Uncalibrated";
  }
}

/** Formats a raw ΔLLR without implying a precision the model does not have. */
function formatLlr(llr: number | null): string {
  return llr === null ? "—" : `${llr >= 0 ? "+" : ""}${llr.toFixed(2)}`;
}

export const PerturbationInspector: React.FC<PerturbationInspectorProps> = ({
  analysisResult,
  activePerturbationModel = "saprot",
  saprotEngine = null,
  foldingEnergetics,
  structuralDiff,
  metrics
}) => {
  const [isScaleGuideOpen, setIsScaleGuideOpen] = useState(false);

  const evaluations = useMemo(
    () => extractPerturbationEvaluations(analysisResult),
    [analysisResult]
  );

  const roster = useMemo(
    () => describeModelRoster(evaluations, saprotEngine),
    [evaluations, saprotEngine]
  );

  const activeEntry = roster.find(entry => entry.id === activePerturbationModel) ?? roster[0];

  const pooled = useMemo(
    () => computeMultiModelLlr(toPooledEvaluationList(evaluations)),
    [evaluations]
  );

  const homogeneity = useMemo(
    () => describeScaleHomogeneity(roster.filter(r => r.available).map(r => r.calibration)),
    [roster]
  );

  /**
   * The score the main column shows is computed from these same terms, so the pane
   * itemises them rather than restating the total.
   */
  const lpsTerms = useMemo(() => {
    const sidechainRmsd = foldingEnergetics?.localSidechainRmsd ?? null;
    const vdw = foldingEnergetics?.vdw ?? null;
    const maxCaDisp = structuralDiff?.windowDisplacements?.length
      ? Math.max(...structuralDiff.windowDisplacements.map((d: any) => d.displacement))
      : null;
    const lps = calculateLps(pooled.llr, vdw, structuralDiff?.clashes?.diff, maxCaDisp);
    return { sidechainRmsd, vdw, maxCaDisp, lps };
  }, [foldingEnergetics, structuralDiff, pooled.llr]);

  if (!analysisResult) {
    return <div className="text-xs text-cs-text-muted italic p-2">Awaiting variant analysis data...</div>;
  }

  const activeData = evaluations[activePerturbationModel];
  const activeLlr = activeEntry?.llr ?? null;
  const activeVerdict = classifyLlr(activeLlr, activeEntry?.calibration ?? null);

  return (
    <div className="flex flex-col gap-4 text-xs font-sans">
      {/* ── 1. Model registry ── */}
      <div className="flex flex-col gap-3">
        <SectionLabel Icon={Layers}>Active Model Registry</SectionLabel>

        <div className="rounded-lg border border-cs-border bg-cs-surface-2 divide-y divide-cs-border-subtle">
          {roster.map(entry => {
            const isActive = entry.id === activePerturbationModel;
            return (
              <div
                key={entry.id}
                className={`p-2.5 space-y-1 ${isActive ? "border-l-2 border-l-cs-accent-clay" : "border-l-2 border-l-transparent"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10.5px] font-semibold text-cs-text-primary truncate">
                    {entry.displayName}
                  </span>
                  <span
                    className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border shrink-0 ${statusBadgeClass(entry.calibration)}`}
                  >
                    {statusLabel(entry.calibration)}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10.5px] font-semibold text-cs-text-primary tabular-nums">
                    ΔLLR {entry.available ? formatLlr(entry.llr) : "not returned"}
                  </span>
                  <span className="text-[9.5px] text-cs-text-muted">
                    {entry.calibration?.embeddingDim ? `${entry.calibration.embeddingDim}-dim` : "no embedding"}
                  </span>
                </div>

                {isActive && entry.calibration && (
                  <p className="text-[10px] text-cs-text-secondary leading-relaxed pt-0.5">
                    {entry.calibration.note}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {!isCalibrated(activeEntry?.calibration ?? null) && (
          <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 flex items-start gap-2">
            <Info className="w-3.5 h-3.5 text-cs-text-muted shrink-0 mt-0.5" />
            <p className="text-[10px] text-cs-text-secondary leading-relaxed">
              <strong className="text-cs-text-primary">No calibrated cut-point.</strong>{" "}
              {activeEntry?.calibration?.cutPointSource
                ? `The nearest published thresholds belong to ${activeEntry.calibration.cutPointSource}, a different model, and are not transferable.`
                : "This model's ΔLLR is on a model-native scale. Read it against the within-model residue rank below, not against a fixed number."}
            </p>
          </div>
        )}
      </div>

      {/* ── 2. Cross-model scale integrity ── */}
      <div className="flex flex-col gap-3 pt-1 border-t border-cs-border-subtle">
        <SectionLabel Icon={Sigma}>Cross-Model Score Integrity</SectionLabel>

        <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10.5px] text-cs-text-secondary">Models contributing</span>
            <span className="font-mono text-[10.5px] font-semibold text-cs-text-primary">{pooled.count}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10.5px] text-cs-text-secondary">Pooled mean ΔLLR</span>
            <span className="font-mono text-[10.5px] font-semibold text-cs-text-primary tabular-nums">
              {pooled.llr === null ? "—" : pooled.llr.toFixed(2)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10.5px] text-cs-text-secondary">Spread across models</span>
            <span className="font-mono text-[10.5px] font-semibold text-cs-text-primary tabular-nums">
              {pooled.spread === null ? "—" : `${pooled.spread.toFixed(2)} nats`}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 pt-1 border-t border-cs-border-subtle">
            <span className="text-[10.5px] text-cs-text-secondary">Shared scale</span>
            {/*
              "Shared scale" is only a question for a pool of two or more models. With no
              or one contributor there is nothing to share, and a green "Yes" beside
              "Models contributing 0" reported success over no data.
            */}
            {!homogeneity.sufficient ? (
              <span className="text-[9.5px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border bg-slate-500/10 text-cs-text-muted border-cs-border-subtle">
                n/a
              </span>
            ) : (
              <span
                className={`text-[9.5px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border ${
                  homogeneity.homogeneous
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                    : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                }`}
              >
                {homogeneity.homogeneous ? "Yes" : "No — mixed"}
              </span>
            )}
          </div>
        </div>

        {pooled.mixedScale && (
          <div className="p-2.5 rounded-lg border border-amber-500/25 bg-cs-bg-warning flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-[10px] text-cs-text-secondary leading-relaxed">
              These models do not share a score scale — their ΔLLR values span {pooled.spread?.toFixed(1)} nats
              {homogeneity.families.length > 1
                ? `, and they come from ${homogeneity.families.length} different model families (${homogeneity.families.join(", ")})`
                : ""}
              . The pooled mean is shown for continuity but is not a quantity on any model's axis, so no pooled
              strength classification is offered. Compare the models by their within-model residue rank instead, or
              read them individually.
            </p>
          </div>
        )}

        <p className="text-[10px] text-cs-text-muted leading-relaxed px-0.5">
          ΔLLR is <strong>model-native</strong>: its magnitude depends on each model's training objective,
          parameter count and output vocabulary. Two models reporting the same variant can legitimately differ by
          several nats without disagreeing about the biology.
        </p>
      </div>

      {/* ── 3. Within-model position ── */}
      <div className="flex flex-col gap-3 pt-1 border-t border-cs-border-subtle">
        <SectionLabel Icon={Gauge}>Within-Model Position</SectionLabel>

        <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10.5px] font-semibold text-cs-text-primary">
              {activeEntry?.displayName ?? "Selected model"}
            </span>
            <span className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border ${
              activeVerdict === "pathogenic"
                ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20"
                : activeVerdict === "benign"
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                  : "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20"
            }`}>
              {/*
                Every verdict is mapped to a human label. Printing the internal token meant
                a model that had not returned a score showed a lowercase "unavailable" inside
                an uppercase-styled badge, which reads as neither calibration nor absence.
              */}
              {VERDICT_LABELS[activeVerdict] ?? "Unknown"}
            </span>
          </div>
          <p className="text-[10.5px] text-cs-text-secondary leading-relaxed">
            {describeWithinModelRank(activeData?.mutRank, activeData?.positionalEntropy)}
          </p>
        </div>
      </div>

      {/* ── 4. Verdict decomposition ── */}
      <div className="flex flex-col gap-3 pt-1 border-t border-cs-border-subtle">
        <SectionLabel Icon={FlaskConical}>Perturbation Score Decomposition</SectionLabel>

        <div className="rounded-lg border border-cs-border bg-cs-surface-2 divide-y divide-cs-border-subtle">
          <div className="p-2.5 flex items-start justify-between gap-2">
            <span className="text-[10.5px] text-cs-text-secondary">Sequence ΔLLR</span>
            <span className="text-right min-w-0">
              <span className="block font-mono text-[10.5px] font-semibold text-cs-text-primary tabular-nums">
                {pooled.llr === null ? "—" : pooled.llr.toFixed(2)}
              </span>
              <span className="block font-mono text-[9.5px] text-cs-text-muted">weight 0.30</span>
            </span>
          </div>
          <div className="p-2.5 flex items-start justify-between gap-2">
            <span className="text-[10.5px] text-cs-text-secondary">FoldX VdW Δ</span>
            <span className="text-right min-w-0">
              <span className="block font-mono text-[10.5px] font-semibold text-cs-text-primary tabular-nums">
                {lpsTerms.vdw === null ? "—" : `${lpsTerms.vdw >= 0 ? "+" : ""}${lpsTerms.vdw.toFixed(2)}`}
              </span>
              <span className="block font-mono text-[9.5px] text-cs-text-muted">weight 0.25</span>
            </span>
          </div>
          <div className="p-2.5 flex items-start justify-between gap-2">
            <span className="text-[10.5px] text-cs-text-secondary">Clash count Δ</span>
            <span className="text-right min-w-0">
              <span className="block font-mono text-[10.5px] font-semibold text-cs-text-primary tabular-nums">
                {structuralDiff?.clashes?.diff ?? "—"}
              </span>
              <span className="block font-mono text-[9.5px] text-cs-text-muted">weight 0.20</span>
            </span>
          </div>
          <div className="p-2.5 flex items-start justify-between gap-2">
            <span className="text-[10.5px] text-cs-text-secondary">Max Cα displacement</span>
            <span className="text-right min-w-0">
              <span className="block font-mono text-[10.5px] font-semibold text-cs-text-primary tabular-nums">
                {lpsTerms.maxCaDisp === null ? "—" : `${lpsTerms.maxCaDisp.toFixed(2)} Å`}
              </span>
              <span className="block font-mono text-[9.5px] text-cs-text-muted">weight 0.25</span>
            </span>
          </div>
        </div>

        <p className="text-[10px] text-cs-text-muted leading-relaxed px-0.5">
          Weights are renormalised over whichever terms returned a value, so a score built from two terms is not
          comparable to one built from four. The sequence term maps ΔLLR through{" "}
          <span className="font-mono">(−ΔLLR − 2) / 8</span> — a heuristic transform, not a calibrated
          probability, and it inherits whatever scale the contributing models report.
        </p>
      </div>

      {/* ── 5. How to read the scales ── */}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setIsScaleGuideOpen(open => !open)}
          aria-expanded={isScaleGuideOpen}
          className="flex items-center justify-between gap-2 w-full cursor-pointer group"
        >
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
            <Ruler className="w-3.5 h-3.5 text-cs-accent-clay" />
            How To Read These Scales
          </span>
          <ChevronDown
            className={`w-3.5 h-3.5 text-cs-text-muted transition-transform ${isScaleGuideOpen ? "rotate-180" : ""}`}
          />
        </button>

        {isScaleGuideOpen && (
          <div className="space-y-2">
            <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1">
              <span className="text-[10.5px] font-semibold text-cs-text-primary block">ΔLLR (nats)</span>
              <p className="text-[10px] text-cs-text-secondary leading-relaxed">
                <span className="font-mono">log P(mutant) − log P(wild-type)</span> under the model's masked
                marginal. Negative means the model finds the substitution less likely than the native residue.
                Because it is a log ratio it is unbounded, and its typical range is a property of the model rather
                than of the variant.
              </p>
            </div>

            <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1">
              <span className="text-[10.5px] font-semibold text-cs-text-primary block">Embedding shift</span>
              <p className="text-[10px] text-cs-text-secondary leading-relaxed">
                Displacement between wild-type and mutant representations in the model's latent space. Its numeric
                scale tracks latent width — {roster.map(r => `${r.meta.familyLabel} ${r.calibration?.embeddingDim ?? "?"}`).join(", ")} — dims.
                ESMC reports cosine distance while SaProt and ESM-2 report Euclidean distance, so the values are not
                interchangeable across cards and a larger number is not automatically a larger effect. Compare a
                card only against its own baseline window.
              </p>
            </div>

            <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1">
              <span className="text-[10.5px] font-semibold text-cs-text-primary block">Positional entropy</span>
              <p className="text-[10px] text-cs-text-secondary leading-relaxed">
                Shannon entropy of the model's residue distribution at this position, in bits, ceiling{" "}
                <span className="font-mono">log₂(20) ≈ 4.32</span>. Near 4.32 the site is unconstrained and almost
                any substitution is acceptable; near 0 the model admits only the native residue. A given ΔLLR means
                more at a low-entropy position than at a high-entropy one.
              </p>
            </div>

            <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1">
              <span className="text-[10.5px] font-semibold text-cs-text-primary block">Mutant rank</span>
              <p className="text-[10px] text-cs-text-secondary leading-relaxed">
                Where the mutant falls among the 20 canonical substitutions at that position, inside one model.
                Rank is scale-free, so unlike ΔLLR it <em>is</em> comparable between models — which is why it
                carries the cross-model interpretation on this tab.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── 6. Physical geometry conventions ── */}
      <div className="flex flex-col gap-3 pt-1 border-t border-cs-border-subtle">
        <SectionLabel Icon={Activity}>Geometry Conventions</SectionLabel>

        <div className="rounded-lg border border-cs-border bg-cs-surface-2 divide-y divide-cs-border-subtle">
          <div className="p-2.5 space-y-1">
            <span className="text-[10.5px] font-semibold text-cs-text-primary block">Rigid-backbone caveat</span>
            <p className="text-[10px] text-cs-text-secondary leading-relaxed">
              FoldX BuildModel mutates onto a rigid Cα template, so backbone coordinates are identical by
              construction and global Cα RMSD is mathematically 0.0000 Å. That is a property of the method, not
              evidence that the backbone did not move.
            </p>
          </div>
          <div className="p-2.5 space-y-1">
            <span className="text-[10.5px] font-semibold text-cs-text-primary block">Contact counting</span>
            <p className="text-[10px] text-cs-text-secondary leading-relaxed">
              Lost and gained contacts are counted within a 4 Å heavy-atom cutoff after wild-type → mutant
              superposition. A change in contact count reflects local repacking, not a change in binding affinity.
            </p>
          </div>
          <div className="p-2.5 space-y-1">
            <span className="text-[10.5px] font-semibold text-cs-text-primary block">ΔSASA sign</span>
            <p className="text-[10px] text-cs-text-secondary leading-relaxed">
              Positive ΔSASA means the mutated residue is more solvent-exposed than the wild type; negative means
              more buried. Exposure is read off a single static conformer and does not average over an ensemble.
            </p>
          </div>
        </div>
      </div>

      {/* ── 7. Caveats ── */}
      <div className="flex flex-col gap-2 pt-1 border-t border-cs-border-subtle">
        <SectionLabel Icon={AlertTriangle}>Limitations</SectionLabel>
        <ul className="m-0 pl-4 space-y-1.5 list-disc">
          <li className="text-[10px] text-cs-text-secondary leading-relaxed">
            Zero-shot language-model scores are evolutionary plausibility estimates. They are not calibrated
            pathogenicity probabilities and carry no ACMG evidence weight on their own.
          </li>
          <li className="text-[10px] text-cs-text-secondary leading-relaxed">
            A structurally neutral variant can still be pathogenic — gain-of-function and neomorphic alleles need
            not destabilise a fold. Low perturbation is not evidence of a benign variant.
          </li>
          <li className="text-[10px] text-cs-text-secondary leading-relaxed">
            Structure-conditioned models inherit the errors of the AlphaFold or ESMFold backbone they were given.
          </li>
        </ul>
      </div>

      {/* ── 8. ESM3 exploratory scope ── */}
      {evaluations.esm3 && !("error" in evaluations.esm3) && (
        <div className="flex flex-col gap-3 pt-1 border-t border-cs-border-subtle">
          <SectionLabel Icon={Sparkles}>ESM3 Hypothesis Scope</SectionLabel>
          <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1.5">
            <span className="text-[9.5px] font-mono font-bold uppercase px-2 py-0.5 rounded border bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20 inline-block">
              Exploratory
            </span>
            <p className="text-[10px] text-cs-text-secondary leading-relaxed">
              Section C reports ESM3 template-conditioned structure generation. These are{" "}
              <strong>hypothesis-generating model predictions</strong>, produced without the physics-based
              refinement that FoldX applies, and they should not be read as experimentally validated structural
              changes. Treat them as a prompt for what to test, never as an observation.
            </p>
          </div>
        </div>
      )}

      {/* ── 9. Provenance ── */}
      <div className="flex flex-col gap-2">
        <SectionLabel Icon={Database}>Model Provenance</SectionLabel>
        <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1.5 text-[10.5px]">
          {roster.map(entry => (
            <div key={entry.id} className="space-y-0.5">
              <div className="flex justify-between items-center gap-2">
                <span className="font-semibold text-cs-text-primary truncate">{entry.displayName}</span>
                <span className="font-mono text-[9.5px] text-cs-text-muted shrink-0">
                  {statusLabel(entry.calibration)}
                </span>
              </div>
              {entry.calibration && (
                <p className="text-[9.5px] text-cs-text-muted leading-snug">{entry.calibration.provenance}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default React.memo(PerturbationInspector);
