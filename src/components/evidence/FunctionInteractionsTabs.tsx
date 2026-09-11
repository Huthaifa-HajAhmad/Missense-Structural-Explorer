import React from "react";
import {
  ShieldAlert,
  Layers,
  Target,
  Compass,
  ExternalLink,
  RotateCw,
  ArrowLeft,
  ArrowRight,
  Dna
} from "lucide-react";
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
  pocketError,
  onRetryPocket,
  onSelectResidue
}: TabComponentProps) {
  const result = analysisState.result;
  if (!result) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="screen-title">Function &amp; Domain Architecture</h1>
        <p className="screen-tab-description">
          Ligand-binding pocket proximity (P2Rank Machine Learning) and dual-source functional site annotations (UniProtKB &amp; InterPro).
        </p>
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
              onClick={() => onRetryPocket()}
              className="px-3 py-1 rounded text-[10.5px] font-mono font-semibold bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-600 dark:text-rose-400 inline-flex items-center gap-1.5"
            >
              <RotateCw className="w-3 h-3" />
              Retry Pocket Detection
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {computedPocket ? (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h4 className="text-[11px] font-medium uppercase tracking-wider font-sans" style={{ color: "var(--cs-accent-clay)" }}>
                  P2Rank Ligand-Binding Pocket Distance
                </h4>
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
                  <span className="metric-card-desc">
                    {computedPocket.sasPoints
                      ? `${computedPocket.sasPoints} SAS points${computedPocket.surfaceAtoms ? ` · ${computedPocket.surfaceAtoms} surf atoms` : ""}`
                      : "Spatial cavity volume"}
                  </span>
                </div>
              </div>

              {computedPocket.status !== "success" && (
                <div className="p-3 rounded-lg border text-[11px] leading-relaxed flex flex-col sm:flex-row sm:items-center justify-between gap-2.5" style={{ background: "var(--cs-bg-warning)", borderColor: "var(--cs-text-warning)", color: "var(--cs-text-warning)" }}>
                  <div>
                    <span className="font-bold block uppercase text-[9px] mb-0.5 tracking-wider">
                      {computedPocket.status === "none_detected" ? "No Pocket Detected:" : "ML Model Offline / Standby:"}
                    </span>
                    <span className="text-[11px] leading-tight block">
                      {computedPocket.status === "none_detected"
                        ? "No ligand-binding pocket cavity was detected within proximity of this residue by P2Rank."
                        : "P2Rank machine learning service was unavailable during initial scan. If Java 17 has been initialized or runtime is now ready, retry detection."}
                    </span>
                  </div>
                  {onRetryPocket && (
                    <button
                      type="button"
                      onClick={() => onRetryPocket()}
                      disabled={isPocketLoading}
                      className="px-3 py-1.5 rounded-md font-mono text-[10.5px] font-semibold flex items-center justify-center gap-1.5 transition-all bg-amber-500/20 hover:bg-amber-500/30 text-amber-900 dark:text-amber-200 border border-amber-500/40 shrink-0"
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
                    Pocket Lining Residues (Top {Math.min(8, computedPocket.pocketResidues.length)})
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 text-xs">
                    {computedPocket.pocketResidues.slice(0, 8).map((res: any, idx: number) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => onSelectResidue?.(res.index)}
                        className="p-2 px-3 rounded-lg flex justify-between items-center transition-all border border-[var(--cs-border)] bg-[var(--cs-bg-subtle)] hover:border-[var(--cs-accent-clay)] hover:bg-[var(--cs-surface-2)] text-left cursor-pointer group"
                      >
                        <span className="font-mono font-semibold text-[11px] text-cs-text-primary group-hover:text-cs-accent-clay">
                          {res.name}{res.index}
                        </span>
                        <span className="text-[9.5px] font-mono text-cs-text-muted">
                          {res.distance} Å
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

          {/* UniProt & InterPro Curated Features & Architecture */}
          {(() => {
            const features = result.uniprotFeatures?.features ?? [];
            const pos = result.metadata?.residueIndex;
            const wt = result.metadata?.wildType || "";
            const mut = result.metadata?.mutant || "";
            const serviceStatus = result.serviceStatus?.uniprotFeatures || result.metadata?.serviceStatus?.uniprotFeatures;
            if (pos === null || pos === undefined) return null;

            if (serviceStatus === "timeout" || serviceStatus === "error" || serviceStatus === "failed" || serviceStatus === "offline") {
              return (
                <div className="space-y-3 pt-3 border-t" style={{ borderColor: "var(--cs-border-subtle)" }}>
                  <h4 className="text-[11px] font-medium uppercase tracking-wider font-sans flex items-center gap-1.5" style={{ color: "var(--cs-accent-clay)" }}>
                    <Layers className="w-3.5 h-3.5" />
                    UniProt &amp; InterPro Curated Architecture
                  </h4>
                  <div className="p-3 rounded-lg border text-xs leading-relaxed" style={{ background: "var(--cs-bg-warning)", borderColor: "var(--cs-text-warning)", color: "var(--cs-text-warning)" }}>
                    <span className="font-bold block uppercase text-[9px] mb-1 tracking-wider">Service Notice</span>
                    {serviceStatus === "timeout"
                      ? "UniProt KB query timed out. Curated functional annotations and domain definitions could not be retrieved in time."
                      : "UniProt KB service was unreachable or returned an error. Curated functional annotations are temporarily unavailable."}
                  </div>
                </div>
              );
            }

            // Group features by category
            const domains = features.filter((f) => f.type === "Domain");
            const activeDomain = domains.find((d) => pos >= d.start && pos <= d.end);

            const activeSites = features.filter(f => f.type.toLowerCase().includes("active") || f.type.toLowerCase().includes("catalytic"));
            const bindingSites = features.filter(f => f.type.toLowerCase().includes("binding") || f.type.toLowerCase().includes("metal"));
            const ptms = features.filter(f => f.type.toLowerCase().includes("modified") || f.type.toLowerCase().includes("phospho") || f.type.toLowerCase().includes("acetyl") || f.type.toLowerCase().includes("methyl"));
            const disulfides = features.filter(f => f.type.toLowerCase().includes("disulfide") || f.type.toLowerCase().includes("cysteine"));
            const transmembranes = features.filter(f => f.type.toLowerCase().includes("transmembrane") || f.type.toLowerCase().includes("membrane"));

            const functionalSites = features.filter(
              (f) => f.type !== "Domain" && f.type !== "Chain" && f.type !== "Region"
            );

            // Compute length of sequence
            const seqLength = result.uniprotFeatures?.sequenceLength ||
              (features.length > 0 ? features.reduce((max, f) => Math.max(max, f.end), pos || 1) : (pos ? pos + 50 : 500));

            const getTrackX = (res: number) => {
              const clamped = Math.max(1, Math.min(res, seqLength));
              return 32 + ((clamped - 1) / Math.max(seqLength - 1, 1)) * 736;
            };

            // Flanking proximity calculations
            let nearestUpstream: { feature: typeof features[0]; distance: number; boundaryRes: number } | null = null;
            let nearestDownstream: { feature: typeof features[0]; distance: number; boundaryRes: number } | null = null;

            let minUpstreamDist = Infinity;
            let minDownstreamDist = Infinity;

            for (const f of features) {
              if (f.type === "Chain" || f.type === "Region") continue;
              if (pos > f.end) {
                const dist = pos - f.end;
                if (dist < minUpstreamDist) {
                  minUpstreamDist = dist;
                  nearestUpstream = { feature: f, distance: dist, boundaryRes: f.end };
                }
              } else if (pos < f.start) {
                const dist = f.start - pos;
                if (dist < minDownstreamDist) {
                  minDownstreamDist = dist;
                  nearestDownstream = { feature: f, distance: dist, boundaryRes: f.start };
                }
              }
            }

            // Direct point matches at residue pos (excluding high-level whole-chain and structural domains)
            const matchingFeatures = features.filter(
              (f) => pos >= f.start && pos <= f.end && f.type !== "Chain" && f.type !== "Domain"
            );

            return (
              <div className="space-y-4 pt-3 border-t" style={{ borderColor: "var(--cs-border-subtle)" }}>
                {/* Section Header with dual sources */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <h4 className="text-[11px] font-medium uppercase tracking-wider font-sans flex items-center gap-1.5" style={{ color: "var(--cs-accent-clay)" }}>
                    <Layers className="w-3.5 h-3.5" />
                    Full-Length Domain Architecture &amp; Curated Sites
                  </h4>
                  <div className="flex items-center gap-2">
                    <span className="text-[9.5px] font-mono px-2 py-0.5 rounded border bg-cs-surface-2 border-cs-border text-cs-text-muted">
                      Length: <strong className="text-cs-text-primary">{seqLength} aa</strong>
                    </span>
                    <span className="badge-data-source">
                      UniProtKB &amp; InterPro
                    </span>
                  </div>
                </div>

                {/* 1. Curated Feature Category Breakdown Pills */}
                <div className="flex flex-wrap items-center gap-1.5 py-1">
                  <span className="text-[10px] font-mono uppercase text-cs-text-muted mr-1 font-semibold">Inventory:</span>
                  <span className="px-2 py-0.5 rounded-full text-[9.5px] font-mono font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                    {domains.length} Domains
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[9.5px] font-mono font-bold bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                    {activeSites.length} Active Sites
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[9.5px] font-mono font-bold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
                    {bindingSites.length} Binding Sites
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[9.5px] font-mono font-bold bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20">
                    {ptms.length} PTMs
                  </span>
                  {disulfides.length > 0 && (
                    <span className="px-2 py-0.5 rounded-full text-[9.5px] font-mono font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                      {disulfides.length} Disulfides
                    </span>
                  )}
                  {transmembranes.length > 0 && (
                    <span className="px-2 py-0.5 rounded-full text-[9.5px] font-mono font-bold bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20">
                      {transmembranes.length} Transmembrane
                    </span>
                  )}
                </div>

                {/* 2. Interactive Full-Length Protein Architecture SVG Track */}
                <div className="p-3.5 rounded-xl border bg-cs-surface-2 border-cs-border space-y-2">
                  <div className="flex items-center justify-between text-[10.5px] font-mono text-cs-text-muted">
                    <span className="flex items-center gap-1">
                      <Dna className="w-3 h-3 text-cs-accent-clay" />
                      Sequence Scale (1 → {seqLength})
                    </span>
                    <span className="text-[9.5px]">Click any domain or site to target 3D viewer</span>
                  </div>

                  <div className="w-full overflow-x-auto py-1">
                    <svg
                      viewBox="0 0 800 74"
                      className="w-full h-auto min-w-[500px] overflow-visible select-none"
                    >
                      <defs>
                        <linearGradient id="domainGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                          <stop offset="0%" stopColor="#10b981" stopOpacity="0.4" />
                          <stop offset="100%" stopColor="#059669" stopOpacity="0.6" />
                        </linearGradient>
                        <linearGradient id="activeDomainGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                          <stop offset="0%" stopColor="#10b981" stopOpacity="0.75" />
                          <stop offset="100%" stopColor="#047857" stopOpacity="0.95" />
                        </linearGradient>
                      </defs>

                      {/* Backbone track rail */}
                      <rect
                        x="32"
                        y="28"
                        width="736"
                        height="8"
                        rx="4"
                        className="fill-slate-200 dark:fill-slate-800 stroke-slate-300 dark:stroke-slate-700 stroke-[0.5]"
                      />

                      {/* Scale endpoint labels */}
                      <text x="32" y="52" textAnchor="start" className="text-[9px] font-mono fill-slate-400">1</text>
                      <text x="400" y="52" textAnchor="middle" className="text-[8.5px] font-mono fill-slate-400">{Math.round(seqLength / 2)}</text>
                      <text x="768" y="52" textAnchor="end" className="text-[9px] font-mono fill-slate-400">{seqLength} aa</text>

                      {/* Domain Blocks */}
                      {domains.map((d: any, idx: number) => {
                        const x1 = getTrackX(d.start);
                        const x2 = getTrackX(d.end);
                        const w = Math.max(x2 - x1, 5);
                        const isTargetInside = pos >= d.start && pos <= d.end;
                        return (
                          <g
                            key={idx}
                            className="cursor-pointer group"
                            onClick={() => onSelectResidue?.(d.start)}
                          >
                            <rect
                              x={x1}
                              y="20"
                              width={w}
                              height="24"
                              rx="5"
                              fill={isTargetInside ? "url(#activeDomainGrad)" : "url(#domainGrad)"}
                              className={`stroke-1 transition-all ${
                                isTargetInside
                                  ? "stroke-emerald-400"
                                  : "stroke-emerald-500/70 hover:stroke-emerald-300"
                              }`}
                            />
                            {w > 42 && (
                              <text
                                x={x1 + w / 2}
                                y="36"
                                textAnchor="middle"
                                className="text-[9px] font-mono font-bold fill-emerald-950 dark:fill-emerald-100 pointer-events-none select-none"
                              >
                                {d.description && d.description.length > 18
                                  ? `${d.description.slice(0, 16)}…`
                                  : d.description || "Domain"}
                              </text>
                            )}
                            <title>{`${d.description || "Domain"} (${d.start}–${d.end})${d.interproId ? ` [InterPro: ${d.interproId}]` : ""}`}</title>
                          </g>
                        );
                      })}

                      {/* Curated Point Site Pins / Ticks */}
                      {functionalSites.map((s: any, idx: number) => {
                        const cx = getTrackX(s.start);
                        const isRose = s.type.toLowerCase().includes("active") || s.type.toLowerCase().includes("catalytic");
                        const isPurple = s.type.toLowerCase().includes("binding") || s.type.toLowerCase().includes("metal");
                        const isSky = s.type.toLowerCase().includes("modified") || s.type.toLowerCase().includes("phospho") || s.type.toLowerCase().includes("acetyl");
                        const isAmber = s.type.toLowerCase().includes("disulfide") || s.type.toLowerCase().includes("cysteine");
                        const pinColor = isRose ? "#f43f5e" : isPurple ? "#a855f7" : isSky ? "#38bdf8" : isAmber ? "#f59e0b" : "#94a3b8";
                        return (
                          <circle
                            key={idx}
                            cx={cx}
                            cy="32"
                            r="3"
                            fill={pinColor}
                            className="stroke-white dark:stroke-slate-900 stroke-[1] cursor-pointer hover:scale-125 transition-transform"
                            onClick={() => onSelectResidue?.(s.start)}
                          >
                            <title>{`${s.type}: ${s.description || ""} (${s.start}${s.end !== s.start ? `–${s.end}` : ""})`}</title>
                          </circle>
                        );
                      })}

                      {/* Variant Indicator Pin & Beacon */}
                      {pos && (
                        <g className="cursor-default">
                          <circle
                            cx={getTrackX(pos)}
                            cy="32"
                            r="7"
                            className="fill-amber-500/25 animate-ping pointer-events-none"
                          />
                          <circle
                            cx={getTrackX(pos)}
                            cy="32"
                            r="4.5"
                            className="fill-amber-500 stroke-white dark:stroke-slate-950 stroke-[1.5]"
                          />
                          <line
                            x1={getTrackX(pos)}
                            y1="12"
                            x2={getTrackX(pos)}
                            y2="28"
                            className="stroke-amber-500 dark:stroke-amber-400 stroke-[1.5]"
                            strokeDasharray="2 1"
                          />
                          <polygon
                            points={`${getTrackX(pos) - 4},10 ${getTrackX(pos) + 4},10 ${getTrackX(pos)},16`}
                            className="fill-amber-500 dark:fill-amber-400"
                          />
                          <text
                            x={getTrackX(pos)}
                            y="8"
                            textAnchor="middle"
                            className="text-[9.5px] font-mono font-extrabold fill-amber-600 dark:fill-amber-400 select-none"
                          >
                            ▼ {wt || "p."}{pos}{mut ? `>${mut}` : ""}
                          </text>
                        </g>
                      )}
                    </svg>
                  </div>

                  {/* InterPro Domain Cards List */}
                  {domains.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-cs-border-subtle">
                      {domains.map((d: any, idx: number) => {
                        const isInside = pos >= d.start && pos <= d.end;
                        return (
                          <div
                            key={idx}
                            className={`p-2.5 rounded-lg border transition-all ${
                              isInside
                                ? "bg-emerald-500/10 border-emerald-500/40"
                                : "bg-cs-surface border-cs-border hover:border-cs-border-subtle"
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-[11.5px] text-cs-text-primary">
                                {d.description || "Domain"}
                              </span>
                              {isInside ? (
                                <span className="text-[9px] px-1.5 py-0.5 rounded font-mono font-bold uppercase bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                                  Inside ({pos - d.start + 1}/{d.end - d.start + 1} aa)
                                </span>
                              ) : (
                                <span className="text-[9px] font-mono text-cs-text-muted">
                                  {pos < d.start ? `${d.start - pos} aa downstream` : `${pos - d.end} aa upstream`}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center justify-between mt-1.5">
                              <span className="text-[10px] font-mono text-cs-text-muted">
                                Residues {d.start}–{d.end} ({d.end - d.start + 1} aa)
                              </span>
                              {d.interproId ? (
                                <a
                                  href={`https://www.ebi.ac.uk/interpro/entry/InterPro/${encodeURIComponent(d.interproId)}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-[9.5px] font-mono font-semibold text-emerald-600 dark:text-emerald-400 hover:underline"
                                >
                                  <span>{d.interproId}</span>
                                  <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                              ) : (
                                <span className="text-[9px] font-mono text-cs-text-muted">UniProtKB</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 3. Bi-Directional Flanking Proximity Vector Gauge */}
                <div className="p-3.5 rounded-xl border bg-cs-surface-2 border-cs-border space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-mono font-semibold uppercase text-cs-text-muted">
                    <span className="flex items-center gap-1">
                      <ArrowLeft className="w-3.5 h-3.5 text-cs-accent-clay" />
                      Upstream Flank
                    </span>
                    <span className="text-amber-600 dark:text-amber-400 font-bold">Target Residue</span>
                    <span className="flex items-center gap-1">
                      Downstream Flank
                      <ArrowRight className="w-3.5 h-3.5 text-cs-accent-clay" />
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 items-stretch">
                    {/* Upstream Vector */}
                    <div className="p-2.5 rounded-lg border bg-cs-surface border-cs-border-subtle flex flex-col justify-between">
                      <span className="text-[10px] font-mono font-bold text-sky-600 dark:text-sky-400">
                        {nearestUpstream ? `← -${nearestUpstream.distance} aa` : "← N-terminus"}
                      </span>
                      <span className="text-[11px] font-semibold text-cs-text-primary mt-1">
                        {nearestUpstream ? (nearestUpstream.feature.description || nearestUpstream.feature.type) : "Residue 1 (Start)"}
                      </span>
                      <span className="text-[9.5px] font-mono text-cs-text-muted mt-0.5">
                        {nearestUpstream ? `Residue ${nearestUpstream.boundaryRes}` : "Sequence start"}
                      </span>
                    </div>

                    {/* Center Target Badge */}
                    <div className="p-2.5 rounded-lg border bg-amber-500/10 border-amber-500/30 flex flex-col justify-between items-center text-center">
                      <span className="text-[9.5px] font-mono font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                        Variant Position
                      </span>
                      <span className="text-base font-mono font-extrabold text-cs-text-primary my-0.5">
                        {wt}{pos}{mut ? ` → ${mut}` : ""}
                      </span>
                      <span className="text-[9.5px] font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                        {activeDomain ? `Within ${activeDomain.description || "Domain"}` : "Inter-Domain Region"}
                      </span>
                    </div>

                    {/* Downstream Vector */}
                    <div className="p-2.5 rounded-lg border bg-cs-surface border-cs-border-subtle flex flex-col justify-between text-right">
                      <span className="text-[10px] font-mono font-bold text-emerald-600 dark:text-emerald-400">
                        {nearestDownstream ? `+${nearestDownstream.distance} aa →` : `C-terminus →`}
                      </span>
                      <span className="text-[11px] font-semibold text-cs-text-primary mt-1">
                        {nearestDownstream ? (nearestDownstream.feature.description || nearestDownstream.feature.type) : `Residue ${seqLength} (End)`}
                      </span>
                      <span className="text-[9.5px] font-mono text-cs-text-muted mt-0.5">
                        {nearestDownstream ? `Residue ${nearestDownstream.boundaryRes}` : "Sequence terminus"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 4. Direct Curated Feature Site Matches at Residue pos */}
                {matchingFeatures.length > 0 ? (
                  <div className="space-y-2">
                    <span className="text-[10.5px] font-mono font-bold uppercase text-cs-text-muted block">
                      Direct Site Annotations at Position {pos}:
                    </span>
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
                  <div className="empty-state-box">
                    No catalytic active site, binding pocket, or metal coordination recorded directly at residue {pos}.
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

