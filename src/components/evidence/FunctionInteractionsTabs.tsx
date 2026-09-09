import React from "react";
import { ShieldAlert } from "lucide-react";
import { TabComponentProps } from "./types";

export function FunctionTab({
  analysisState,
  computedPocket,
  isPocketLoading,
  pocketError
}: TabComponentProps) {
  const result = analysisState.result;
  if (!result) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="screen-title">Function</h1>
        <p className="screen-tab-description">Ligand-binding pocket proximity (P2Rank Machine Learning) and UniProt-curated functional site annotations at this residue.</p>
      </div>
      {isPocketLoading ? (
        <div className="flex flex-col items-center justify-center p-6 text-center">
          <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin mb-2" style={{ borderColor: "var(--cs-accent-clay)", borderTopColor: "transparent" }} />
          <span className="text-[10px]" style={{ color: "var(--cs-text-muted)" }}>Calculating ligand-binding pockets via P2Rank ML...</span>
        </div>
      ) : pocketError ? (
        <div className="p-3 text-center text-rose-455 border border-dashed border-rose-500/20 bg-rose-500/5 rounded-lg">
          <ShieldAlert className="w-5 h-5 mx-auto mb-1 text-rose-500" />
          <span>Failed to calculate pockets: {pocketError}</span>
        </div>
      ) : (
        <div className="space-y-4">
          {computedPocket ? (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h4 className="text-[11px] font-medium uppercase tracking-wider font-sans" style={{ color: "var(--cs-accent-clay)" }}>P2Rank Ligand-Binding Pocket Distance</h4>
                <span className="badge-data-source">
                  {computedPocket.status === "success"
                    ? "P2Rank ML"
                    : computedPocket.status === "none_detected"
                      ? "No Pocket Detected"
                      : "Model Offline"}
                </span>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="metric-card">
                  <span className="metric-card-label">Pocket Distance</span>
                  <span className={`metric-card-value ${
                    computedPocket.pocketDistance !== null && computedPocket.pocketDistance !== undefined && computedPocket.pocketDistance < 10
                      ? "text-[var(--cs-text-danger)]"
                      : ""
                  }`}>
                    {computedPocket.pocketDistance !== null && computedPocket.pocketDistance !== undefined 
                      ? `${computedPocket.pocketDistance.toFixed(2)} Å` 
                      : "N/A"}
                  </span>
                  <span className="metric-card-desc">Distance to pocket centroid</span>
                </div>

                <div className="metric-card">
                  <span className="metric-card-label">Binding Probability</span>
                  <span className="metric-card-value" style={{ color: "var(--cs-accent)" }}>
                    {computedPocket.status === "success" ? `${computedPocket.pocketScore}%` : "N/A"}
                  </span>
                  <span className="metric-card-desc">P2Rank affinity index</span>
                </div>

                <div className="metric-card">
                  <span className="metric-card-label">Pocket Volume</span>
                  <span className="metric-card-value" style={{ color: "var(--cs-accent)" }}>
                    {computedPocket.pocketVolume ? `${computedPocket.pocketVolume} Å³` : "N/A"}
                  </span>
                  <span className="metric-card-desc">Spatial cavity volume</span>
                </div>
              </div>

              {computedPocket.status !== "success" && (
                <div className="p-3 rounded-lg border text-[11px] leading-relaxed" style={{ background: "var(--cs-bg-warning)", borderColor: "var(--cs-text-warning)", color: "var(--cs-text-warning)" }}>
                  <span className="font-bold block uppercase text-[9px] mb-1 tracking-wider">
                    {computedPocket.status === "none_detected" ? "No Pocket Detected:" : "ML Model Offline:"}
                  </span>
                  {computedPocket.status === "none_detected"
                    ? "No ligand-binding pocket cavity was detected within proximity of this residue by P2Rank."
                    : "P2Rank machine learning service is currently unavailable. In accordance with project scientific standards, no heuristic fallbacks are used. Cavity affinity scores and pocket volumes remain unassigned."}
                </div>
              )}

              <div className="p-3.5 rounded-xl border space-y-2.5" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
                <div className="flex justify-between items-center text-xs">
                  <span className="font-medium font-sans text-[12px]" style={{ color: "var(--cs-text-secondary)" }}>Likely Co-Factor / Target Ligand:</span>
                  <span className="font-semibold font-mono text-[12px]" style={{ color: "var(--cs-text-primary)" }}>{computedPocket.likelyCofactor}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="font-medium font-sans text-[12px]" style={{ color: "var(--cs-text-secondary)" }}>Spatial Classification:</span>
                  <span className="badge-data-source">
                    {computedPocket.pocketDistance !== null && computedPocket.pocketDistance !== undefined && computedPocket.pocketDistance <= 8.0
                      ? "ACTIVE_SITE_PROXIMATE"
                      : "DISTAL_SURFACE"}
                  </span>
                </div>
              </div>

              {computedPocket.pocketResidues && computedPocket.pocketResidues.length > 0 && (
                <div className="space-y-2 mt-3.5">
                  <h4 className="text-[11px] font-medium uppercase tracking-wider font-sans" style={{ color: "var(--cs-accent-clay)" }}>
                    Pocket Lining Residues (Top 7)
                  </h4>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {computedPocket.pocketResidues.slice(0, 7).map((res: any, idx: number) => (
                      <div key={idx} className="p-2.5 px-3.5 rounded-lg flex justify-between items-center transition-all border border-[var(--cs-border)] bg-[var(--cs-bg-subtle)] shadow-none">
                        <span style={{ fontSize: "var(--cs-font-size-numeric)", fontFamily: "var(--cs-font-mono)", fontWeight: "var(--cs-font-weight-semibold)", color: "var(--cs-text-primary)" }}>{res.name}{res.index}</span>
                        <span style={{ fontSize: "var(--cs-font-size-caption)", fontFamily: "var(--cs-font-mono)", color: "var(--cs-text-muted)" }}>Dist: {res.distance} Å</span>
                      </div>
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

          {/* UniProt Curated Features */}
          {(() => {
            const features = result.uniprotFeatures?.features ?? [];
            const pos = result.metadata?.residueIndex;
            if (pos === null || pos === undefined) return null;

            const matchingFeatures = features.filter(
              (f) => pos >= f.start && pos <= f.end
            );

            return (
              <div className="space-y-3 pt-3 border-t" style={{ borderColor: "var(--cs-border-subtle)" }}>
                <h4 className="text-[11px] font-medium uppercase tracking-wider font-sans" style={{ color: "var(--cs-accent-clay)" }}>
                  UniProt Curated Site &amp; Interface Annotations
                </h4>

                {matchingFeatures.length > 0 ? (
                  <div className="space-y-2">
                    {matchingFeatures.map((f, idx) => {
                      let badgeColor = "badge-metric-neutral";

                      return (
                        <div
                          key={idx}
                          className="p-3 rounded-lg border leading-relaxed text-xs shadow-sm transition-all"
                          style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}
                        >
                          <div className="flex items-center justify-between">
                            <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold font-mono uppercase ${badgeColor}`}>
                              {f.type}
                            </span>
                            <span className="text-[10px] font-mono font-bold" style={{ color: "var(--cs-text-muted)" }}>
                              Residue {f.start === f.end ? f.start : `${f.start}-${f.end}`}
                            </span>
                          </div>
                          <p className="mt-1.5 text-xs font-sans" style={{ color: "var(--cs-text-secondary)" }}>
                            {f.description || "Curated functional feature at this site."}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="empty-state-box">
                    No curated UniProt functional features (active sites, metal bindings, interface regions) recorded at residue {pos}.
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

export { InteractionsTab } from "./InteractionsTab";

