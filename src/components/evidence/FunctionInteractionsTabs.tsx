import React from "react";
import { ShieldAlert, Layers, Target, Compass } from "lucide-react";
import { TabComponentProps } from "./types";

function getFeatureBadgeStyle(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("active") || t.includes("catalytic")) {
    return "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30";
  }
  if (t.includes("metal") || t.includes("binding")) {
    return "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30";
  }
  if (t.includes("modified") || t.includes("phospho") || t.includes("methyl") || t.includes("acetyl")) {
    return "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30";
  }
  if (t.includes("domain")) {
    return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30";
  }
  if (t.includes("transmembrane") || t.includes("membrane")) {
    return "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/30";
  }
  if (t.includes("disulfide") || t.includes("cysteine")) {
    return "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30";
  }
  return "bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30";
}

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
        <div className="p-3 text-center text-rose-500 border border-dashed border-rose-500/20 bg-rose-500/5 rounded-lg">
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

          {/* UniProt Curated Features & Domain Architecture */}
          {(() => {
            const features = result.uniprotFeatures?.features ?? [];
            const pos = result.metadata?.residueIndex;
            const serviceStatus = result.serviceStatus?.uniprotFeatures || result.metadata?.serviceStatus?.uniprotFeatures;
            if (pos === null || pos === undefined) return null;

            if (serviceStatus === "timeout" || serviceStatus === "error" || serviceStatus === "failed" || serviceStatus === "offline") {
              return (
                <div className="space-y-3 pt-3 border-t" style={{ borderColor: "var(--cs-border-subtle)" }}>
                  <h4 className="text-[11px] font-medium uppercase tracking-wider font-sans flex items-center gap-1.5" style={{ color: "var(--cs-accent-clay)" }}>
                    <Layers className="w-3.5 h-3.5" />
                    UniProt Curated Site &amp; Domain Annotations
                  </h4>
                  <div className="p-3 rounded-lg border text-xs leading-relaxed" style={{ background: "var(--cs-bg-warning)", borderColor: "var(--cs-text-warning)", color: "var(--cs-text-warning)" }}>
                    <span className="font-bold block uppercase text-[9px] mb-1 tracking-wider">UniProt Service Notice</span>
                    {serviceStatus === "timeout"
                      ? "UniProt KB query timed out. Curated functional annotations and domain definitions could not be retrieved in time."
                      : "UniProt KB service was unreachable or returned an error. Curated functional annotations are temporarily unavailable."}
                  </div>
                </div>
              );
            }

            const domains = features.filter((f) => f.type === "Domain");
            const activeDomain = domains.find((d) => pos >= d.start && pos <= d.end);
            
            // If not in a domain, find closest flanking domain
            let nearestDomain: { domain: typeof domains[0]; distance: number; direction: "upstream" | "downstream" } | null = null;
            if (!activeDomain && domains.length > 0) {
              let minDomainDist = Infinity;
              for (const d of domains) {
                if (pos < d.start) {
                  const dist = d.start - pos;
                  if (dist < minDomainDist) {
                    minDomainDist = dist;
                    nearestDomain = { domain: d, distance: dist, direction: "downstream" };
                  }
                } else if (pos > d.end) {
                  const dist = pos - d.end;
                  if (dist < minDomainDist) {
                    minDomainDist = dist;
                    nearestDomain = { domain: d, distance: dist, direction: "upstream" };
                  }
                }
              }
            }

            // Direct point matches at residue pos (excluding high-level whole-chain and structural domains)
            const matchingFeatures = features.filter(
              (f) => pos >= f.start && pos <= f.end && f.type !== "Chain" && f.type !== "Domain"
            );

            // If no direct point feature, compute nearest functional site (Active site, Binding site, Metal, PTM, Motif)
            let nearestSite: { feature: typeof features[0]; distance: number; direction: "upstream" | "downstream"; boundaryRes: number } | null = null;
            const functionalSites = features.filter(
              (f) => f.type !== "Domain" && f.type !== "Chain" && f.type !== "Region"
            );
            if (matchingFeatures.length === 0 && functionalSites.length > 0) {
              let minSiteDist = Infinity;
              for (const s of functionalSites) {
                if (pos < s.start) {
                  const dist = s.start - pos;
                  if (dist < minSiteDist) {
                    minSiteDist = dist;
                    nearestSite = { feature: s, distance: dist, direction: "downstream", boundaryRes: s.start };
                  }
                } else if (pos > s.end) {
                  const dist = pos - s.end;
                  if (dist < minSiteDist) {
                    minSiteDist = dist;
                    nearestSite = { feature: s, distance: dist, direction: "upstream", boundaryRes: s.end };
                  }
                }
              }
            }

            return (
              <div className="space-y-3 pt-3 border-t" style={{ borderColor: "var(--cs-border-subtle)" }}>
                <div className="flex items-center justify-between">
                  <h4 className="text-[11px] font-medium uppercase tracking-wider font-sans flex items-center gap-1.5" style={{ color: "var(--cs-accent-clay)" }}>
                    <Layers className="w-3.5 h-3.5" />
                    UniProt Curated Site &amp; Domain Annotations
                  </h4>
                  <span className="text-[10px] font-mono text-cs-text-muted">
                    {features.length} features indexed
                  </span>
                </div>

                {/* 1. Protein Domain Architecture Card */}
                {activeDomain ? (
                  <div
                    className="p-3 rounded-lg border text-xs leading-relaxed"
                    style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[9.5px] px-2 py-0.5 rounded border font-bold font-mono uppercase bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 flex items-center gap-1">
                        <Layers className="w-3 h-3" />
                        Within Domain
                      </span>
                      <span className="text-[10.5px] font-mono font-bold" style={{ color: "var(--cs-text-primary)" }}>
                        Residues {activeDomain.start}–{activeDomain.end}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-baseline justify-between">
                      <span className="font-semibold text-xs text-cs-text-primary">
                        {activeDomain.description || "Annotated Protein Domain"}
                      </span>
                      <span className="text-[10px] font-mono text-cs-text-muted">
                        Position {pos - activeDomain.start + 1} of {activeDomain.end - activeDomain.start + 1} aa
                      </span>
                    </div>
                  </div>
                ) : nearestDomain ? (
                  <div
                    className="p-2.5 rounded-lg border text-xs leading-relaxed flex items-center justify-between"
                    style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
                  >
                    <div className="flex items-center gap-1.5">
                      <Compass className="w-3.5 h-3.5 text-cs-accent-clay" />
                      <span className="text-[11px] text-cs-text-secondary">
                        Flanking Domain: <strong className="text-cs-text-primary">{nearestDomain.domain.description}</strong>
                      </span>
                    </div>
                    <span className="text-[10px] font-mono font-bold text-cs-accent-clay">
                      {nearestDomain.distance} aa {nearestDomain.direction} ({nearestDomain.domain.start}–{nearestDomain.domain.end})
                    </span>
                  </div>
                ) : null}

                {/* 2. Direct Matching Features at Residue pos */}
                {matchingFeatures.length > 0 ? (
                  <div className="space-y-2">
                    {matchingFeatures.map((f, idx) => {
                      const badgeClass = getFeatureBadgeStyle(f.type);
                      return (
                        <div
                          key={idx}
                          className="p-3 rounded-lg border leading-relaxed text-xs shadow-sm transition-all"
                          style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}
                        >
                          <div className="flex items-center justify-between">
                            <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold font-mono uppercase ${badgeClass}`}>
                              {f.type}
                            </span>
                            <span className="text-[10px] font-mono font-bold" style={{ color: "var(--cs-text-muted)" }}>
                              Residue {f.start === f.end ? f.start : `${f.start}–${f.end}`}
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
                  <div className="space-y-2">
                    <div className="empty-state-box">
                      No catalytic active site, binding pocket, or metal coordination recorded directly at residue {pos}.
                    </div>

                    {/* 3. Proximity Radar to Nearest Curated Functional Site */}
                    {nearestSite && (
                      <div
                        className="p-2.5 rounded-lg border text-xs leading-relaxed flex items-center justify-between"
                        style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
                      >
                        <div className="flex items-center gap-1.5">
                          <Target className="w-3.5 h-3.5 text-cs-text-muted" />
                          <span className="text-[11px] text-cs-text-secondary">
                            Nearest Curated Site: <strong className="text-cs-text-primary">{nearestSite.feature.type}</strong>
                            {nearestSite.feature.description ? ` (${nearestSite.feature.description})` : ""}
                          </span>
                        </div>
                        <span className="text-[10px] font-mono font-bold" style={{ color: "var(--cs-text-muted)" }}>
                          {nearestSite.direction === "downstream" ? `+${nearestSite.distance}` : `-${nearestSite.distance}`} aa (
                          {nearestSite.feature.start === nearestSite.feature.end
                            ? `Residue ${nearestSite.feature.start}`
                            : `${nearestSite.feature.start}–${nearestSite.feature.end} (nearest: ${nearestSite.boundaryRes})`}
                          )
                        </span>
                      </div>
                    )}
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

