import React, { useMemo } from "react";
import { Info, ShieldAlert, RotateCw, Box, PanelRightOpen } from "lucide-react";
import { TabComponentProps } from "./types";
import { AMINO_ACID_NAMES_MAP } from "../../useVariantAnalysis";
import { BiochemicalContrastScales } from "./ContrastScale";
import { resolveResidueShiftModel } from "../../lib/residueShiftModel";
import { useResidueScalesLoading } from "../../lib/residueScalesLoading";
import { INSPECTOR_SECTIONS, requestInspectorFocus } from "../../lib/inspectorFocus";
import { derivePocketNarrative } from "../../shared/residueShiftEvidence";

/**
 * Data-source badge for the pocket section.
 *
 * A lookup instead of a nested ternary (prohibited by the repository review
 * rules), and it keeps the four pipeline states distinguishable at a glance.
 */
function pocketSourceBadge(pocket: TabComponentProps["computedPocket"]): string {
  if (!pocket) return "Standby";
  if (pocket.status === "success") return "P2Rank ML";
  if (pocket.status === "none_detected") return "No Pocket Detected";
  return "Model Offline";
}

export function StructureTab({
  analysisState,
  setSelectedMetric,
  computedPocket,
  isPocketLoading,
  pocketError,
  isBiophysicalLoading,
  active3dModelTab,
  onRetryPocket,
  onSelectResidue,
  onNavigateToView
}: TabComponentProps) {
  const result = analysisState.result;
  const variantResidueIndex = result?.metadata?.residueIndex ?? null;

  /**
   * The contrast model is derived by the shared resolver, which the Residue Shifts
   * inspector and the Insights radar also call — so the scales, the sidebar prose
   * and the radar cannot describe different substitutions or label the axes
   * differently.
   */
  const model = useMemo(
    () =>
      resolveResidueShiftModel({
        wildType: result?.metadata?.wildType,
        mutant: result?.metadata?.mutant,
        variant: result?.metadata?.variant
      }),
    [result?.metadata?.wildType, result?.metadata?.mutant, result?.metadata?.variant]
  );

  const contrast = model.contrast;
  const normalWt = model.wildTypeLabel;
  const normalMut = model.mutantLabel;
  const wt1 = model.wildTypeCode;
  const mut1 = model.mutantCode;

  /*
   * Shared with the inspector so both panes give the same answer to "are these
   * values still coming?". Previously this passed `analysisState.isLoading` while
   * the inspector passed `isBiophysicalLoading`, so with one true and the other
   * false the two surfaces contradicted each other about the same missing datum.
   */
  const areScalesLoading = useResidueScalesLoading(isBiophysicalLoading);

  const pocketNarrative = useMemo(
    () =>
      derivePocketNarrative(computedPocket, {
        isLoading: isPocketLoading,
        error: pocketError,
        variantResidueIndex,
        variantResidueChain: (result?.metadata as { chain?: string } | undefined)?.chain ?? null
      }),
    [computedPocket, isPocketLoading, pocketError, variantResidueIndex, result?.metadata]
  );

  if (!result) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="screen-title">Residue Shifts &amp; Pockets</h1>
        <p className="screen-tab-description">
          Residue biochemical shifts, burial status, packing density, and P2Rank ligand-binding pocket proximity.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="p-3 rounded-lg border flex flex-col items-center justify-center" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
          <span className="block text-[10px] uppercase font-bold tracking-wider" style={{ color: "var(--cs-text-muted)" }}>Wild-Type Residue</span>
          <span className="text-3xl font-black text-emerald-500 mt-1">{normalWt}</span>
          <p className="text-xs mt-1.5 leading-normal" style={{ color: "var(--cs-text-muted)" }}>
            {AMINO_ACID_NAMES_MAP[wt1] || wt1}
          </p>
        </div>

        <div className="p-3 rounded-lg border flex flex-col items-center justify-center" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
          <span className="block text-[10px] uppercase font-bold tracking-wider" style={{ color: "var(--cs-text-muted)" }}>Mutant Substitution</span>
          <span className="text-3xl font-black text-rose-500 mt-1">{normalMut}</span>
          <p className="text-xs mt-1.5 leading-normal" style={{ color: "var(--cs-text-muted)" }}>
            {AMINO_ACID_NAMES_MAP[mut1] || mut1}
          </p>
        </div>
      </div>

      {/* Always rendered: the component owns the "scales unavailable" state, so an
          unresolved residue reads as missing data rather than as an absent card.
          The loading flag comes from the shared hook so this card and the inspector
          cannot describe the same missing value differently. */}
      <BiochemicalContrastScales contrast={contrast} isLoading={areScalesLoading} />

      {(result.disruptionPredictor?.burialStatus !== undefined || result.disruptionPredictor?.neighborCount !== undefined || result.disruptionPredictor?.rsa !== undefined) ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => setSelectedMetric("burial_status")}
            className="p-4 rounded-lg border text-left flex flex-col justify-between hover:border-[var(--cs-accent-clay)]/50 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)] w-full"
            style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
          >
            <div className="w-full">
              <div className="flex items-center justify-between w-full mb-1">
                <span className="block text-[11px] uppercase font-bold tracking-wider" style={{ color: "var(--cs-text-secondary)" }}>Burial / Exposure Status</span>
                <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[11px] font-black uppercase px-2 py-0.5 rounded border badge-metric-neutral">
                  {result.disruptionPredictor.burialStatus ?? "Unknown"}
                </span>
                {result.disruptionPredictor.rsa !== undefined && result.disruptionPredictor.rsa !== null && (
                  <span className="text-[11px] font-mono opacity-80" style={{ color: "var(--cs-text-secondary)" }}>
                    RSA: {(result.disruptionPredictor.rsa * 100).toFixed(1)}%
                  </span>
                )}
              </div>
              <p className="text-[12px] leading-relaxed mt-2 font-sans" style={{ color: "var(--cs-text-secondary)" }}>
                {result.disruptionPredictor.burialStatus === "core"
                  ? "Residue is deeply buried in the hydrophobic core (<15% RSA)."
                  : result.disruptionPredictor.burialStatus === "surface"
                  ? "Residue is solvent-exposed on the protein surface (>35% RSA)."
                  : result.disruptionPredictor.burialStatus === "boundary"
                  ? "Residue is located at a boundary or partial burial site."
                  : "Burial status is undetermined."}
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setSelectedMetric("contact_density")}
            className="p-4 rounded-lg border text-left flex flex-col justify-between hover:border-[var(--cs-accent-clay)]/50 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)] w-full"
            style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
          >
            <div className="w-full">
              <div className="flex items-center justify-between w-full mb-1">
                <span className="block text-[11px] uppercase font-bold tracking-wider" style={{ color: "var(--cs-text-secondary)" }}>Spatial Neighbor Density</span>
                <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </div>
              <div className="text-xl font-bold font-mono mt-1" style={{ color: "var(--cs-text-primary)" }}>
                {result.disruptionPredictor.neighborCount ?? 0}{" "}
                <span className="text-[10px] font-medium" style={{ color: "var(--cs-text-muted)" }}>neighbors (&lt;10Å)</span>
              </div>
              <p className="text-[10px] leading-normal mt-2" style={{ color: "var(--cs-text-secondary)" }}>
                Quantifies local packing density. Core is defined as &ge; 15 neighbors, boundary as 8-14, and surface as &lt; 8.
              </p>
            </div>
          </button>
        </div>
      ) : (
        <div className="empty-state-box">
          No 3D structural packing or burial metrics available for this variant.
        </div>
      )}

      {/* P2Rank Ligand-Binding Cavity Analysis */}
      <div className="space-y-3 pt-3 border-t" style={{ borderColor: "var(--cs-border-subtle)" }}>
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-1.5">
            <h4 className="text-[11px] font-medium uppercase tracking-wider font-sans" style={{ color: "var(--cs-accent-clay)" }}>
              P2Rank Ligand-Binding Pocket Proximity
            </h4>
            <button
              type="button"
              onClick={() => setSelectedMetric("p2rank")}
              className="text-slate-400 hover:text-cs-accent-clay transition-colors p-0.5 cursor-pointer"
              title="Explain P2Rank Pocket Predictor"
            >
              <Info className="w-3.5 h-3.5" />
            </button>
          </div>
          <span className="badge-data-source">{pocketSourceBadge(computedPocket)}</span>
        </div>

        {isPocketLoading ? (
          <div className="flex flex-col items-center justify-center p-6 text-center border border-dashed rounded-xl" style={{ borderColor: "var(--cs-border)" }}>
            <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin mb-2" style={{ borderColor: "var(--cs-accent-clay)", borderTopColor: "transparent" }} />
            <span className="text-[11px] font-mono" style={{ color: "var(--cs-text-muted)" }}>
              Calculating ligand-binding pockets via P2Rank ML...
            </span>
          </div>
        ) : pocketError ? (
          <div className="p-3 text-center text-rose-500 border border-dashed border-rose-500/20 bg-rose-500/5 rounded-lg space-y-2">
            <ShieldAlert className="w-5 h-5 mx-auto text-rose-500" />
            <span className="text-xs block">Failed to calculate pockets: {pocketError}</span>
            {onRetryPocket && (
              <button
                type="button"
                onClick={() => {
                  // `void`, not a bare call: the handler returns void|Promise and
                  // React discards a returned promise, which would surface as an
                  // unhandled rejection if the retry ever rejected.
                  void onRetryPocket();
                }}
                className="px-3 py-1 rounded text-[10.5px] font-mono font-semibold bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-600 dark:text-rose-400 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCw className="w-3 h-3" />
                Retry Pocket Detection
              </button>
            )}
          </div>
        ) : computedPocket ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="metric-card">
                <span className="metric-card-label">Pocket Distance</span>
                <span className={`metric-card-value ${
                  pocketNarrative.proximity.band === "lining" || pocketNarrative.proximity.band === "proximal"
                    ? "text-[var(--cs-text-danger)]"
                    : ""
                }`}>
                  {computedPocket.pocketDistance !== null && computedPocket.pocketDistance !== undefined 
                    ? `${computedPocket.pocketDistance.toFixed(2)} Å` 
                    : "N/A"}
                </span>
                <span className="metric-card-desc">{pocketNarrative.proximity.label} &middot; distance to pocket centroid</span>
              </div>

              <div className="metric-card">
                <span className="metric-card-label">Cavity Ranking Index</span>
                <span className="metric-card-value" style={{ color: "var(--cs-accent)" }}>
                  {computedPocket.status === "success" && pocketNarrative.ranking.score !== null
                    ? `${pocketNarrative.ranking.score} / 100`
                    : "N/A"}
                </span>
                {/* Not "Binding Probability": the runner writes a rescaled raw score
                    into this field whenever P2Rank's probability rounds to zero, so
                    a bare "%" would assert a calibration the payload cannot vouch for. */}
                <span className="metric-card-desc">{pocketNarrative.ranking.label} &middot; P2Rank ranking index</span>
              </div>

              <div className="metric-card">
                <span className="metric-card-label">
                  {pocketNarrative.volume.isMeasured ? "Pocket Volume" : "Cavity Surface"}
                </span>
                <span className="metric-card-value" style={{ color: "var(--cs-accent)" }}>
                  {pocketNarrative.volume.isMeasured && pocketNarrative.volume.volume !== null
                    ? `${pocketNarrative.volume.volume.toLocaleString()} Å³`
                    : pocketNarrative.volume.surfacePoints !== null
                      ? `${pocketNarrative.volume.surfacePoints} pts`
                      : "N/A"}
                </span>
                {/* Å³ is printed only when an engine reported a measured volume. The
                    production payload's "volume" is sas_points × 10, so quoting it as
                    a physical volume would manufacture a unit (see the shared module). */}
                <span className="metric-card-desc">
                  {pocketNarrative.volume.isMeasured
                    ? pocketNarrative.volume.label
                    : pocketNarrative.volume.surfacePoints !== null
                      ? "SA surface points · no volume reported"
                      : "No cavity size reported"}
                </span>
              </div>
            </div>

            {computedPocket.status !== "success" && (
              <div className="p-3.5 rounded-xl border text-[11px] leading-relaxed flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-amber-500/10 border-amber-500/30 text-amber-950 dark:text-amber-100">
                <div className="space-y-0.5">
                  <span className="font-bold block uppercase text-[9.5px] tracking-wider text-amber-800 dark:text-amber-400">
                    {computedPocket.status === "none_detected" ? "No Pocket Detected:" : "ML Model Offline / Standby:"}
                  </span>
                  <span className="text-[11.5px] leading-tight block text-cs-text-secondary">
                    {computedPocket.status === "none_detected"
                      ? "No ligand-binding pocket cavity was detected within proximity of this residue by P2Rank."
                      : "P2Rank machine learning service was unavailable during initial scan. If Java 17 has been initialized or runtime is now ready, retry detection."}
                  </span>
                </div>
                {onRetryPocket && (
                  <button
                    type="button"
                    onClick={() => {
                  // `void`, not a bare call: the handler returns void|Promise and
                  // React discards a returned promise, which would surface as an
                  // unhandled rejection if the retry ever rejected.
                  void onRetryPocket();
                }}
                    disabled={isPocketLoading}
                    className="px-3.5 py-1.5 rounded-lg font-mono text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all bg-amber-600 hover:bg-amber-500 active:scale-95 text-white border border-amber-600 shadow-sm shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    <RotateCw className={`w-3.5 h-3.5 ${isPocketLoading ? "animate-spin" : ""}`} />
                    Retry Pocket Detection
                  </button>
                )}
              </div>
            )}

            <div className="p-3.5 rounded-xl border space-y-2.5" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
              <div className="flex justify-between items-center text-xs">
                <span className="font-medium font-sans text-[12px]" style={{ color: "var(--cs-text-secondary)" }}>Likely Co-Factor / Target Ligand:</span>
                <span className="font-semibold font-mono text-[12px]" style={{ color: "var(--cs-text-primary)" }}>
                  {pocketNarrative.cofactor.name || "None recorded"}
                </span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="font-medium font-sans text-[12px]" style={{ color: "var(--cs-text-secondary)" }}>Spatial Classification:</span>
                <span className="flex items-center gap-1.5">
                  <span className="badge-data-source" title={pocketNarrative.classification.detail}>
                    {pocketNarrative.classification.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => requestInspectorFocus(INSPECTOR_SECTIONS.residueShiftPocket)}
                    className="p-1 rounded border border-cs-border text-cs-text-muted hover:text-cs-accent-clay hover:border-cs-accent-clay/40 transition-colors cursor-pointer"
                    title="Read the cavity interpretation in the inspector"
                    aria-label="Open the cavity interpretation in the inspector"
                  >
                    <PanelRightOpen className="w-3 h-3" />
                  </button>
                </span>
              </div>
            </div>

            {computedPocket.pocketResidues && computedPocket.pocketResidues.length > 0 && (
              <div className="space-y-2 mt-3.5">
                <div className="flex items-center justify-between">
                  <span className="flex items-baseline gap-2 min-w-0">
                    <h4 className="text-[11px] font-medium uppercase tracking-wider font-sans" style={{ color: "var(--cs-accent-clay)" }}>
                      Pocket Lining Residues (Top {Math.min(8, computedPocket.pocketResidues.length)})
                    </h4>
                    {/* Each chip's distance is measured to the variant residue, not to
                        the cavity. Without saying so, the numbers read as depth into
                        the pocket. */}
                    <span className="text-[9.5px] font-mono" style={{ color: "var(--cs-text-muted)" }}>
                      distance to this residue
                    </span>
                  </span>
                  {onNavigateToView && (
                    <button
                      type="button"
                      onClick={() => {
                        if (computedPocket.pocketResidues && computedPocket.pocketResidues[0]) {
                          onSelectResidue?.(computedPocket.pocketResidues[0].index);
                        }
                        onNavigateToView(active3dModelTab === "esm3" ? "structure_esmfold" : "structure_alphafold");
                      }}
                      className="text-[10.5px] font-mono text-cs-accent-clay hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Box className="w-3 h-3" />
                      <span>View in 3D &rarr;</span>
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 text-xs">
                  {computedPocket.pocketResidues.slice(0, 8).map(res => (
                    <button
                      key={`${res.name}-${res.index}`}
                      type="button"
                      onClick={() => onSelectResidue?.(res.index)}
                      className="p-2 px-3 rounded-lg flex justify-between items-center transition-all border border-[var(--cs-border)] bg-[var(--cs-bg-subtle)] hover:border-[var(--cs-accent-clay)] hover:bg-[var(--cs-surface-2)] text-left cursor-pointer group"
                    >
                      <span className="font-mono font-semibold text-[11px] text-cs-text-primary group-hover:text-cs-accent-clay">
                        {res.name}{res.index}
                      </span>
                      <span className="text-[9.5px] font-mono text-cs-text-muted">
                        {typeof res.distance === "number" ? res.distance.toFixed(1) : res.distance} Å
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="empty-state-box">
            No active pocket computations found. Click 3D coordinates on the model to trigger solver.
          </div>
        )}
      </div>
    </div>
  );
}
