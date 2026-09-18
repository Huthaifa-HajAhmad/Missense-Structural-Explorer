import React from "react";
import { Sparkles, Info, Layers } from "lucide-react";
import {
  calculateLps,
  getLpsDetails,
  getSequenceEvidenceText,
  getEnergeticEvidenceText,
  getGeometricEvidenceText,
  getOverallInterpretationText,
  computeMultiModelLlr
} from "../../../shared/perturbationHelpers";
import type { ModelCalibration } from "../../../shared/modelCalibration";
import { BackboneDisplacementChart } from "./BackboneDisplacementChart";

interface PhysicalPerturbationSectionProps {
  activeEval: any;
  currentModelName: string;
  allEvaluations?: any[];
  foldingEnergetics?: any;
  structuralDiff?: any;
  metrics?: any;
  pos: number;
  /** Governs whether the sequence term may be described in calibrated language. */
  calibration?: ModelCalibration | null;
  /**
   * Registry family per entry of `allEvaluations`, in the same order. Supplies the
   * mixed-scale decision so it reflects which models contributed rather than how far
   * apart their numbers happen to sit. See `computeMultiModelLlr`.
   */
  poolFamilies?: (string | null | undefined)[];
}

export function PhysicalPerturbationSection({
  activeEval,
  currentModelName,
  allEvaluations,
  foldingEnergetics,
  structuralDiff,
  metrics,
  pos,
  calibration = null,
  poolFamilies
}: PhysicalPerturbationSectionProps) {
  if (!foldingEnergetics && !structuralDiff) return null;

  const sidechainRmsd = foldingEnergetics?.localSidechainRmsd ?? null;
  const vdw = foldingEnergetics?.vdw ?? null;
  const electrostatics = foldingEnergetics?.electrostatics ?? null;
  const stericClashWarning = foldingEnergetics?.stericClashWarning ?? false;

  const maxCaDisp = structuralDiff?.windowDisplacements && structuralDiff.windowDisplacements.length > 0
    ? Math.max(...structuralDiff.windowDisplacements.map((d: any) => d.displacement))
    : null;

  const multiModel = computeMultiModelLlr(allEvaluations && allEvaluations.length > 0 ? allEvaluations : [activeEval]);

  /**
   * A mean of raw ΔLLR across model families is not a score on any model's axis, so it
   * must not silently become the sequence term of the 0-100 verdict. When the pool mixes
   * scales the term is withheld, and `calculateLps` renormalises over the physical terms
   * it still has. A single model's own score is always on a scale, so it is kept.
   */
  const poolIsMixed = multiModel.count > 1 && multiModel.mixedScale;
  const effectiveSequenceLlr = poolIsMixed ? null : (multiModel.llr ?? activeEval?.llr);

  const lpsScore = calculateLps(effectiveSequenceLlr, vdw, structuralDiff?.clashes?.diff, maxCaDisp);
  const lpsDetails = getLpsDetails(lpsScore);

  const seqEvidence = getSequenceEvidenceText(
    activeEval?.llr,
    currentModelName.split(" ")[0],
    multiModel,
    calibration
  );
  const energyEvidence = getEnergeticEvidenceText(vdw, foldingEnergetics?.foldxSd);
  const geomEvidence = getGeometricEvidenceText(maxCaDisp);
  const overallInterpretation = getOverallInterpretationText(maxCaDisp, vdw);

  const isFoldxRigid = structuralDiff?.rmsd === 0;

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
            <span className="text-[11px] uppercase font-bold tracking-wider font-sans text-cs-text-secondary">
              Local perturbation summary
            </span>
          </div>
          <ul className="list-disc pl-5 space-y-1.5 text-[11.5px] leading-relaxed text-cs-text-secondary">
            <li>
              <strong>Sequence-model evidence</strong>: {seqEvidence.replace(/^Sequence-model (?:evidence|consensus(?:\s*\([^)]*\))?):\s*/i, "")}
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
          <div className="border-b pb-2 flex items-center justify-between gap-2" style={{ borderColor: "var(--cs-border-subtle)" }}>
            <span className="text-[10px] uppercase font-mono tracking-wider font-bold text-cs-text-muted">
              {poolIsMixed ? "Physical Verdict" : "Consensus Verdict"}
            </span>
            <span className={`text-[8px] uppercase font-mono px-2 py-0.5 rounded border font-bold shrink-0 ${lpsDetails.badgeClass}`}>
              {lpsDetails.labelText}
            </span>
          </div>

          {/* The score leads: it is the reason this card exists, and the term breakdown
              now lives in the inspector beside the tab. */}
          <div className="flex items-baseline gap-1 mt-3">
            {lpsDetails.score !== null ? (
              <>
                <strong className="text-3xl font-bold font-mono tabular-nums" style={{ color: lpsDetails.color }}>
                  {lpsDetails.score.toFixed(1)}
                </strong>
                <span className="text-[10px] font-mono text-slate-500">/ 100</span>
              </>
            ) : (
              <strong className="text-sm font-bold font-mono text-slate-500">N/A</strong>
            )}
          </div>

          <p className="text-[10px] text-cs-text-muted leading-normal mt-2">
            {lpsDetails.score === null
              ? "No scored terms were returned, so no combined verdict can be formed."
              : poolIsMixed
                ? `Physical terms only: FoldX steric energy, clash difference and backbone Cα displacement. The sequence term is excluded because the ${multiModel.count} contributing models do not share a score scale.`
                : "Sequence penalty, FoldX steric energy, clash difference and backbone Cα displacement, renormalised over the terms that returned a value."}
          </p>
        </div>
      </div>

      {foldingEnergetics && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
          <div
            className="p-3 rounded-xl border flex flex-col justify-between w-full transition-all duration-200 shadow-sm"
            style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
          >
            <div className="flex items-center justify-between w-full">
              <span className="block text-[9.5px] uppercase font-bold tracking-wider text-cs-text-muted">Sidechain RMSD</span>
              <Info className="w-3 h-3 shrink-0 text-slate-500" />
            </div>
            <strong className="text-base font-bold font-mono block mt-1.5" style={{
              color: sidechainRmsd !== null && sidechainRmsd > 1.5 ? "var(--cs-text-danger)"
                : sidechainRmsd !== null && sidechainRmsd > 0.8 ? "var(--cs-text-warning)"
                : "var(--cs-text-success)"
            }}>
              {sidechainRmsd !== null ? `${sidechainRmsd.toFixed(2)} Å` : "N/A"}
            </strong>
            <span className="text-[10px] mt-0.5 text-cs-text-muted">Local sidechain displacement (FoldX)</span>
          </div>

          <div
            className="p-3 rounded-xl border flex flex-col justify-between w-full transition-all duration-200 shadow-sm"
            style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
          >
            <div className="flex items-center justify-between w-full">
              <span className="block text-[9.5px] uppercase font-bold tracking-wider text-cs-text-muted">VdW Clash Δ</span>
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
            <span className="text-[10px] mt-0.5 text-cs-text-muted">Steric repulsion energy delta</span>
          </div>

          <div
            className="p-3 rounded-xl border flex flex-col justify-between w-full transition-all duration-200 shadow-sm"
            style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
          >
            <div className="flex items-center justify-between w-full">
              <span className="block text-[9.5px] uppercase font-bold tracking-wider text-cs-text-muted">Electrostatic Δ</span>
              <Info className="w-3 h-3 shrink-0 text-slate-500" />
            </div>
            <strong className="text-base font-bold font-mono block mt-1.5" style={{ color: "var(--cs-text-primary)" }}>
              {electrostatics !== null ? `${electrostatics >= 0 ? "+" : ""}${electrostatics.toFixed(2)} kcal/mol` : "N/A"}
            </strong>
            <span className="text-[10px] mt-0.5 text-cs-text-muted">Charge interaction shift</span>
          </div>
        </div>
      )}

      {metrics && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(metrics.lostContacts !== undefined || metrics.gainedContacts !== undefined) && (
            <div className="p-4 rounded-xl border space-y-3 transition-all duration-300 shadow-sm text-left" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
              <div className="flex items-center gap-1.5 border-b pb-2" style={{ borderColor: "var(--cs-border-subtle)" }}>
                <Layers className="w-4 h-4 text-teal-500 shrink-0" />
                <span className="text-[11px] uppercase font-bold tracking-wider font-sans text-cs-text-muted">
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
            </div>
          )}

          {metrics.deltaSasa !== undefined && metrics.deltaSasa !== null && (
            <div className="p-4 rounded-xl border space-y-3 transition-all duration-300 shadow-sm text-left" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
              <div className="border-b pb-2" style={{ borderColor: "var(--cs-border-subtle)" }}>
                <div className="flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-sky-500 shrink-0" />
                  <span className="text-[11px] uppercase font-bold tracking-wider font-sans text-cs-text-muted">
                    ΔSASA (mutation site)
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between font-mono">
                <span className="text-[10px] font-bold text-slate-400">Exposure delta</span>
                <strong className="text-sm font-bold tabular-nums" style={{ color: metrics.deltaSasa > 0 ? "var(--cs-text-warning)" : "var(--cs-text-success)" }}>
                  {metrics.deltaSasa >= 0 ? `+${metrics.deltaSasa.toFixed(1)}` : metrics.deltaSasa.toFixed(1)} Å² {metrics.deltaSasa > 0 ? "more exposed" : "more buried"}
                </strong>
              </div>
            </div>
          )}
        </div>
      )}

      {structuralDiff && (
        <div className="p-4 rounded-xl border space-y-3.5 transition-all duration-300 shadow-sm text-left" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
          <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: "var(--cs-border-subtle)" }}>
            <span className="text-[11px] uppercase font-bold tracking-wider font-sans text-cs-text-muted">
              Kabsch-Aligned Structural Displacements
            </span>
            <span className="text-[9px] font-mono px-2 py-0.5 rounded border bg-slate-500/5 text-slate-400 border-slate-500/10">
              {isFoldxRigid ? "Rigid Backbone (FoldX)" : "Flexible Backbone"}
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
            <div className="p-2.5 border rounded-lg" style={{ borderColor: "var(--cs-border-subtle)", background: "var(--cs-surface-2)" }}>
              <div className="text-[9.5px] font-bold uppercase tracking-wider font-mono text-cs-text-muted">Global RMSD</div>
              <div className="text-sm font-bold font-mono mt-1 tabular-nums" style={{ color: "var(--cs-text-primary)" }}>
                {isFoldxRigid ? "0.0000 Å" : `${structuralDiff.rmsd.toFixed(4)} Å`}
              </div>
              {isFoldxRigid && (
                <div
                  className="text-[8px] font-sans text-slate-500 mt-0.5 leading-tight"
                  title="FoldX mutates onto a rigid Cα template, so backbone coordinates are identical by construction. This zero is a property of the method, not evidence that the backbone did not move."
                >
                  rigid template by construction
                </div>
              )}
            </div>
            <div className="p-2.5 border rounded-lg" style={{ borderColor: "var(--cs-border-subtle)", background: "var(--cs-surface-2)" }}>
              <div className="text-[9.5px] font-bold uppercase tracking-wider font-mono text-cs-text-muted">Local RMSD</div>
              <div className="text-sm font-bold font-mono mt-1 tabular-nums" style={{ color: "var(--cs-text-primary)" }}>
                {structuralDiff.localRmsd !== null ? `${structuralDiff.localRmsd.toFixed(4)} Å` : "N/A"}
              </div>
            </div>
            <div className="p-2.5 border rounded-lg" style={{ borderColor: "var(--cs-border-subtle)", background: "var(--cs-surface-2)" }}>
              <div className="text-[9.5px] font-bold uppercase tracking-wider font-mono text-cs-text-muted">WT Clashes</div>
              <div className="text-sm font-bold font-mono mt-1 tabular-nums" style={{ color: "var(--cs-text-primary)" }}>{structuralDiff.clashes.wtClashCount}</div>
            </div>
            <div className="p-2.5 border rounded-lg" style={{ borderColor: "var(--cs-border-subtle)", background: "var(--cs-surface-2)" }}>
              <div className="text-[9.5px] font-bold uppercase tracking-wider font-mono text-cs-text-muted">Clash Diff</div>
              <div className="text-sm font-bold font-mono mt-1 tabular-nums" style={{ color: structuralDiff.clashes.diff > 0 ? "var(--cs-text-danger)" : "var(--cs-text-success)" }}>
                {structuralDiff.clashes.diff > 0 ? `+${structuralDiff.clashes.diff}` : structuralDiff.clashes.diff}
              </div>
            </div>
          </div>

          {structuralDiff.windowDisplacements && structuralDiff.windowDisplacements.length > 0 && (
            <BackboneDisplacementChart
              displacements={structuralDiff.windowDisplacements}
              pos={pos}
            />
          )}
        </div>
      )}
    </div>
  );
}
