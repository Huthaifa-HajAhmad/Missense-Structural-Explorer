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
import { BackboneDisplacementChart } from "./BackboneDisplacementChart";

interface PhysicalPerturbationSectionProps {
  activeEval: any;
  currentModelName: string;
  allEvaluations?: any[];
  foldingEnergetics?: any;
  structuralDiff?: any;
  metrics?: any;
  pos: number;
}

export function PhysicalPerturbationSection({
  activeEval,
  currentModelName,
  allEvaluations,
  foldingEnergetics,
  structuralDiff,
  metrics,
  pos
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
  const effectiveSequenceLlr = multiModel.llr ?? activeEval?.llr;

  const lpsScore = calculateLps(effectiveSequenceLlr, vdw, structuralDiff?.clashes?.diff, maxCaDisp);
  const lpsDetails = getLpsDetails(lpsScore);

  const seqEvidence = getSequenceEvidenceText(activeEval?.llr, currentModelName.split(" ")[0], multiModel);
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
            <span className="text-[11px] uppercase font-bold tracking-wider font-sans text-slate-300" style={{ color: "var(--cs-text-secondary)" }}>
              Local perturbation summary
            </span>
          </div>
          <ul className="list-disc pl-5 space-y-1.5 text-[11px] leading-relaxed text-slate-300">
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

      {structuralDiff && (
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
