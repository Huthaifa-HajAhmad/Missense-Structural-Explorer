import React, { useState, useMemo, useCallback } from "react";
import {
  Layers,
  ExternalLink,
  ArrowLeft,
  ArrowRight,
  Dna,
  Box,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Crosshair,
  ShieldCheck,
  Sliders,
  Sparkles
} from "lucide-react";
import { TabComponentProps } from "./types";

function getType(f?: { type?: string } | null): string {
  return f?.type?.toLowerCase() || "";
}

function isDomainFeature(f?: { type?: string } | null): boolean {
  return getType(f) === "domain";
}

function isActiveSite(f?: { type?: string } | null): boolean {
  const t = getType(f);
  return t.includes("active") || t.includes("catalytic");
}

function isBindingSite(f?: { type?: string } | null): boolean {
  const t = getType(f);
  return t.includes("binding") || t.includes("metal");
}

function isPtmSite(f?: { type?: string } | null): boolean {
  const t = getType(f);
  return t.includes("modified") || t.includes("phospho") || t.includes("methyl") || t.includes("acetyl");
}

function isDisulfideSite(f?: { type?: string } | null): boolean {
  const t = getType(f);
  return t.includes("disulfide") || t.includes("cysteine");
}

function isTransmembraneSite(f?: { type?: string } | null): boolean {
  const t = getType(f);
  return t.includes("transmembrane") || t.includes("membrane");
}

function getFeatureBadgeStyle(type?: string): string {
  const t = (type || "").toLowerCase();
  if (t.includes("active") || t.includes("catalytic")) {
    return "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30";
  }
  if (t.includes("metal") || t.includes("binding")) {
    return "bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/30";
  }
  if (t.includes("modified") || t.includes("phospho") || t.includes("methyl") || t.includes("acetyl")) {
    return "bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/30";
  }
  if (t.includes("domain")) {
    return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30";
  }
  if (t.includes("transmembrane") || t.includes("membrane")) {
    return "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border-cyan-500/30";
  }
  if (t.includes("disulfide") || t.includes("cysteine")) {
    return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30";
  }
  return "bg-slate-500/15 text-slate-700 dark:text-slate-400 border-slate-500/30";
}

interface SelectedFeatureState {
  type: "domain" | "site" | "flank";
  name: string;
  start: number;
  end: number;
  category?: string;
  description?: string;
  interproId?: string;
  distanceFromVariant?: number;
  isEnclosing?: boolean;
}

export function FunctionTab({
  analysisState,
  active3dModelTab,
  onSelectResidue,
  onNavigateToView
}: TabComponentProps) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [panOffset, setPanOffset] = useState<number>(0);
  const [selectedFeature, setSelectedFeature] = useState<SelectedFeatureState | null>(null);

  const result = analysisState.result;
  const features = useMemo(() => result?.uniprotFeatures?.features ?? [], [result?.uniprotFeatures?.features]);
  const pos = result?.metadata?.residueIndex;
  const wt = result?.metadata?.wildType || "";
  const mut = result?.metadata?.mutant || "";
  const serviceStatus = result?.serviceStatus?.uniprotFeatures || result?.metadata?.serviceStatus?.uniprotFeatures;
  const hasServiceNotice = serviceStatus === "timeout" || serviceStatus === "error" || serviceStatus === "failed" || serviceStatus === "offline";

  // Defensive sequence length calculation preventing NaN cascade
  const seqLength = useMemo(() => {
    if (!result) return 500;
    const explicitLen = result.uniprotFeatures?.sequenceLength;
    if (typeof explicitLen === "number" && Number.isFinite(explicitLen) && explicitLen > 0) {
      return explicitLen;
    }
    const maxFeatureEnd = features.reduce((max, f) => {
      const end = typeof f?.end === "number" && Number.isFinite(f.end)
        ? f.end
        : (typeof f?.start === "number" && Number.isFinite(f.start) ? f.start : 0);
      return Math.max(max, end);
    }, typeof pos === "number" && Number.isFinite(pos) ? pos : 1);

    return Math.max(1, Math.round(maxFeatureEnd));
  }, [result, features, pos]);

  // Window calculations for continuous zoom and pan
  const windowSize = useMemo(() => Math.max(20, Math.round(seqLength / Math.max(1, zoomLevel))), [seqLength, zoomLevel]);
  const maxPanSpan = useMemo(() => Math.max(0, seqLength - windowSize), [seqLength, windowSize]);
  const visibleStart = useMemo(() => {
    if (zoomLevel <= 1) return 1;
    return Math.max(1, Math.min(seqLength - windowSize + 1, 1 + Math.round(panOffset * maxPanSpan)));
  }, [zoomLevel, seqLength, windowSize, panOffset, maxPanSpan]);
  const visibleEnd = useMemo(() => {
    if (zoomLevel <= 1) return seqLength;
    return Math.min(seqLength, visibleStart + windowSize - 1);
  }, [zoomLevel, seqLength, visibleStart, windowSize]);

  // Coordinate mapping function
  const getTrackX = useCallback((res: number) => {
    if (zoomLevel <= 1) {
      const clamped = Math.max(1, Math.min(res, seqLength));
      return 32 + ((clamped - 1) / Math.max(seqLength - 1, 1)) * 736;
    }
    const visibleSpan = Math.max(visibleEnd - visibleStart, 1);
    return 32 + ((res - visibleStart) / visibleSpan) * 736;
  }, [zoomLevel, seqLength, visibleStart, visibleEnd]);

  // Unified feature selection handler
  const handleFeatureSelect = useCallback((feat: SelectedFeatureState) => {
    setSelectedFeature(prev => (prev?.start === feat.start && prev?.end === feat.end && prev?.type === feat.type ? null : feat));
    if (feat.start) {
      onSelectResidue?.(feat.start);
    }
  }, [onSelectResidue]);

  // Unified selection predicate
  const isFeatureSelected = useCallback((feat: { type: string; start: number; end: number }) => {
    if (!selectedFeature) return false;
    return selectedFeature.type === feat.type && selectedFeature.start === feat.start && selectedFeature.end === feat.end;
  }, [selectedFeature]);

  // Group features by category
  const { domains, activeDomain, activeSites, bindingSites, ptms, disulfides, transmembranes, functionalSites } = useMemo(() => {
    const d = features.filter(isDomainFeature);
    const actDom = typeof pos === "number" ? d.find((item) => pos >= item.start && pos <= item.end) : undefined;
    const actSites = features.filter(isActiveSite);
    const bindSites = features.filter(isBindingSite);
    const ptmList = features.filter(isPtmSite);
    const disulfList = features.filter(isDisulfideSite);
    const tmList = features.filter(isTransmembraneSite);
    const fSites = features.filter((f) => {
      const t = getType(f);
      return t !== "domain" && t !== "chain" && t !== "region";
    });

    return {
      domains: d,
      activeDomain: actDom,
      activeSites: actSites,
      bindingSites: bindSites,
      ptms: ptmList,
      disulfides: disulfList,
      transmembranes: tmList,
      functionalSites: fSites,
    };
  }, [features, pos]);

  // Staggered non-colliding tier heights for functional site lollipops
  const sortedFunctionalSites = useMemo(() => {
    return [...functionalSites].sort((a, b) => a.start - b.start);
  }, [functionalSites]);

  const siteTiers = useMemo(() => {
    const tiers: number[] = [];
    let lastX = -999;
    let curTier = 0;
    for (const s of sortedFunctionalSites) {
      const x = getTrackX(s.start);
      if (Math.abs(x - lastX) < 14) {
        curTier = (curTier + 1) % 3;
      } else {
        curTier = 0;
      }
      tiers.push(curTier);
      lastX = x;
    }
    return tiers;
  }, [sortedFunctionalSites, getTrackX]);

  // Flanking proximity calculations
  const { nearestUpstream, nearestDownstream } = useMemo(() => {
    if (typeof pos !== "number") return { nearestUpstream: null, nearestDownstream: null };

    let up: { feature: typeof features[0]; distance: number; boundaryRes: number } | null = null;
    let down: { feature: typeof features[0]; distance: number; boundaryRes: number } | null = null;
    let minUpDist = Infinity;
    let minDownDist = Infinity;

    for (const f of features) {
      const t = getType(f);
      if (t === "chain" || t === "region") continue;
      const fStart = typeof f.start === "number" && Number.isFinite(f.start) ? f.start : 0;
      const fEnd = typeof f.end === "number" && Number.isFinite(f.end) ? f.end : fStart;

      if (pos > fEnd) {
        const dist = pos - fEnd;
        if (dist < minUpDist) {
          minUpDist = dist;
          up = { feature: f, distance: dist, boundaryRes: fEnd };
        }
      } else if (pos < fStart) {
        const dist = fStart - pos;
        if (dist < minDownDist) {
          minDownDist = dist;
          down = { feature: f, distance: dist, boundaryRes: fStart };
        }
      }
    }

    return { nearestUpstream: up, nearestDownstream: down };
  }, [features, pos]);

  // Direct point matches at residue pos
  const displayedMatchingFeatures = useMemo(() => {
    if (typeof pos !== "number") return [];
    const matching = features.filter((f) => {
      const t = getType(f);
      if (t === "chain" || t === "region") return false;
      const fStart = typeof f.start === "number" && Number.isFinite(f.start) ? f.start : 0;
      const fEnd = typeof f.end === "number" && Number.isFinite(f.end) ? f.end : fStart;
      if (selectedCategory === "domain") return t === "domain" && pos >= fStart && pos <= fEnd;
      return pos >= fStart && pos <= fEnd && t !== "domain";
    });

    if (!selectedCategory) return matching;

    return matching.filter((f) => {
      if (selectedCategory === "domain") return isDomainFeature(f);
      if (selectedCategory === "active") return isActiveSite(f);
      if (selectedCategory === "binding") return isBindingSite(f);
      if (selectedCategory === "ptm") return isPtmSite(f);
      if (selectedCategory === "disulfide") return isDisulfideSite(f);
      if (selectedCategory === "transmembrane") return isTransmembraneSite(f);
      return true;
    });
  }, [features, pos, selectedCategory]);

  // Quick preset actions
  const resetZoom = useCallback(() => {
    setZoomLevel(1);
    setPanOffset(0);
  }, []);

  const focusOnVariant = useCallback(() => {
    if (typeof pos !== "number") return;
    const targetZoom = Math.min(5, Math.max(2.5, seqLength / 250));
    setZoomLevel(targetZoom);
    const win = Math.round(seqLength / targetZoom);
    const maxPan = Math.max(1, seqLength - win);
    const idealStart = Math.max(1, pos - Math.round(win / 2));
    const newPan = Math.max(0, Math.min(1, (idealStart - 1) / maxPan));
    setPanOffset(newPan);
  }, [pos, seqLength]);

  if (!result || typeof pos !== "number") return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="screen-title">Functional Domains</h1>
        <p className="screen-tab-description">
          Full-length sequence domain architecture, curated functional sites, and flanking proximity vectors (UniProtKB &amp; InterPro).
        </p>
      </div>

      <div className="space-y-4">
            {hasServiceNotice && (
              <div className="p-3 rounded-lg border text-xs leading-relaxed" style={{ background: "var(--cs-bg-warning)", borderColor: "var(--cs-text-warning)", color: "var(--cs-text-warning)" }}>
                <span className="font-bold block uppercase text-[9px] mb-1 tracking-wider">Service Notice</span>
                {serviceStatus === "timeout"
                  ? "UniProt KB query timed out. Curated functional annotations and domain definitions could not be retrieved in time."
                  : "UniProt KB service was unreachable or returned an error. Curated functional annotations are temporarily unavailable."}
              </div>
            )}

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

            {/* 1. Curated Feature Category Breakdown Pills (Grammatically Correct) */}
            <div className="flex flex-wrap items-center gap-1.5 py-1">
              <span className="text-[10px] font-mono uppercase text-cs-text-muted mr-1 font-semibold">Inventory:</span>
              <button
                type="button"
                onClick={() => setSelectedCategory(prev => prev === "domain" ? null : "domain")}
                className={`px-2 py-0.5 rounded-full text-[9.5px] font-mono font-bold border transition-all cursor-pointer ${
                  selectedCategory === "domain"
                    ? "bg-emerald-500 text-white border-emerald-600 shadow-sm"
                    : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20"
                }`}
              >
                {domains.length} Domain{domains.length === 1 ? "" : "s"}
              </button>
              <button
                type="button"
                onClick={() => setSelectedCategory(prev => prev === "active" ? null : "active")}
                className={`px-2 py-0.5 rounded-full text-[9.5px] font-mono font-bold border transition-all cursor-pointer ${
                  selectedCategory === "active"
                    ? "bg-rose-500 text-white border-rose-600 shadow-sm"
                    : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20 hover:bg-rose-500/20"
                }`}
              >
                {activeSites.length} Active Site{activeSites.length === 1 ? "" : "s"}
              </button>
              <button
                type="button"
                onClick={() => setSelectedCategory(prev => prev === "binding" ? null : "binding")}
                className={`px-2 py-0.5 rounded-full text-[9.5px] font-mono font-bold border transition-all cursor-pointer ${
                  selectedCategory === "binding"
                    ? "bg-purple-500 text-white border-purple-600 shadow-sm"
                    : "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20 hover:bg-purple-500/20"
                }`}
              >
                {bindingSites.length} Binding Site{bindingSites.length === 1 ? "" : "s"}
              </button>
              <button
                type="button"
                onClick={() => setSelectedCategory(prev => prev === "ptm" ? null : "ptm")}
                className={`px-2 py-0.5 rounded-full text-[9.5px] font-mono font-bold border transition-all cursor-pointer ${
                  selectedCategory === "ptm"
                    ? "bg-sky-500 text-white border-sky-600 shadow-sm"
                    : "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20 hover:bg-sky-500/20"
                }`}
              >
                {ptms.length} PTM{ptms.length === 1 ? "" : "s"}
              </button>
              {disulfides.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedCategory(prev => prev === "disulfide" ? null : "disulfide")}
                  className={`px-2 py-0.5 rounded-full text-[9.5px] font-mono font-bold border transition-all cursor-pointer ${
                    selectedCategory === "disulfide"
                      ? "bg-amber-500 text-white border-amber-600 shadow-sm"
                      : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 hover:bg-amber-500/20"
                  }`}
                >
                  {disulfides.length} Disulfide{disulfides.length === 1 ? "" : "s"}
                </button>
              )}
              {transmembranes.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedCategory(prev => prev === "transmembrane" ? null : "transmembrane")}
                  className={`px-2 py-0.5 rounded-full text-[9.5px] font-mono font-bold border transition-all cursor-pointer ${
                    selectedCategory === "transmembrane"
                      ? "bg-cyan-500 text-white border-cyan-600 shadow-sm"
                      : "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20 hover:bg-cyan-500/20"
                  }`}
                >
                  {transmembranes.length} Transmembrane
                </button>
              )}
              {selectedCategory && (
                <button
                  type="button"
                  onClick={() => setSelectedCategory(null)}
                  className="text-[9.5px] font-mono text-cs-text-muted hover:text-cs-text-primary underline ml-1 cursor-pointer"
                >
                  Reset filter
                </button>
              )}
            </div>

            {/* 2. Interactive Multi-Tiered Full-Length Protein Architecture SVG Track */}
            <div className="p-3.5 rounded-xl border bg-cs-surface-2 border-cs-border space-y-2.5">
              {/* Header Title & Subtitle */}
              <div className="flex items-center justify-between text-[10.5px] font-mono text-cs-text-muted">
                <span className="flex items-center gap-1 font-semibold">
                  <Dna className="w-3.5 h-3.5 text-cs-accent-clay" />
                  Sequence Track (1 → {seqLength} aa)
                </span>
                <span className="text-[9.5px] text-cs-text-muted">
                  Click any domain or curated site to inspect &amp; focus in 3D
                </span>
              </div>

              {/* Fine-Tuned Zoom & Pan Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-cs-surface border border-cs-border-subtle text-xs">
                {/* Viewport Bounds Indicator */}
                <div className="flex items-center gap-1.5 min-w-0">
                  <Sliders className="w-3.5 h-3.5 text-cs-accent-clay shrink-0" />
                  <span className="text-[10px] font-mono text-cs-text-secondary">
                    Window:
                  </span>
                  <strong className="text-[10.5px] font-mono text-cs-text-primary bg-cs-surface-2 px-1.5 py-0.5 rounded border border-cs-border-subtle">
                    {visibleStart}–{visibleEnd} aa
                  </strong>
                  <span className="text-cs-text-muted text-[9.5px] font-mono hidden sm:inline">
                    ({visibleEnd - visibleStart + 1} aa / {seqLength} aa)
                  </span>
                </div>

                {/* Quick Preset Buttons */}
                <div className="flex items-center gap-1.5">
                  {zoomLevel > 1 && (
                    <button
                      type="button"
                      onClick={resetZoom}
                      className="px-2 py-0.5 rounded text-[9.5px] font-mono font-semibold bg-cs-surface-2 hover:bg-cs-bg-subtle border border-cs-border text-cs-text-secondary hover:text-cs-text-primary flex items-center gap-1 cursor-pointer transition-all"
                      title="Reset zoom to full length (1x)"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>1.0× Reset</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={focusOnVariant}
                    className={`px-2 py-0.5 rounded text-[9.5px] font-mono font-semibold border transition-all flex items-center gap-1 cursor-pointer ${
                      pos >= visibleStart && pos <= visibleEnd && zoomLevel > 1.5
                        ? "bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40"
                        : "bg-cs-surface-2 hover:bg-cs-bg-subtle border-cs-border text-cs-text-secondary hover:text-cs-text-primary"
                    }`}
                    title={`Focus sequence window on variant ${wt}${pos}${mut}`}
                  >
                    <Crosshair className="w-3 h-3 text-amber-500" />
                    <span>Focus Variant ({pos})</span>
                  </button>
                </div>

                {/* Sliders: Pan & Zoom */}
                <div className="flex items-center gap-3">
                  {/* Pan Scrubber */}
                  {zoomLevel > 1 && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9.5px] font-mono uppercase text-cs-text-muted">Pan:</span>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={panOffset}
                        onChange={(e) => setPanOffset(parseFloat(e.target.value))}
                        className="w-16 sm:w-24 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cs-accent-clay"
                        title="Pan horizontally across sequence"
                      />
                    </div>
                  )}

                  {/* Zoom Slider */}
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setZoomLevel(prev => Math.max(1, parseFloat((prev - 0.5).toFixed(1))))}
                      disabled={zoomLevel <= 1}
                      className="p-0.5 rounded text-cs-text-muted hover:text-cs-text-primary disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                      title="Zoom out (-0.5x)"
                    >
                      <ZoomOut className="w-3 h-3" />
                    </button>

                    <input
                      type="range"
                      min="1"
                      max="10"
                      step="0.1"
                      value={zoomLevel}
                      onChange={(e) => {
                        const newZoom = parseFloat(e.target.value);
                        setZoomLevel(newZoom);
                        if (newZoom === 1) setPanOffset(0);
                      }}
                      className="w-16 sm:w-24 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cs-accent-clay"
                      title={`Zoom: ${zoomLevel.toFixed(1)}x`}
                    />

                    <button
                      type="button"
                      onClick={() => setZoomLevel(prev => Math.min(10, parseFloat((prev + 0.5).toFixed(1))))}
                      disabled={zoomLevel >= 10}
                      className="p-0.5 rounded text-cs-text-muted hover:text-cs-text-primary disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                      title="Zoom in (+0.5x)"
                    >
                      <ZoomIn className="w-3 h-3" />
                    </button>

                    <span className="font-mono text-[10px] font-bold text-cs-text-primary w-8 text-right">
                      {zoomLevel.toFixed(1)}×
                    </span>
                  </div>
                </div>
              </div>

              {/* Main SVG Track Area */}
              <div className="w-full overflow-x-auto py-1">
                <svg
                  viewBox="0 0 800 138"
                  className="w-full h-auto min-w-[500px] overflow-visible select-none"
                >
                  <defs>
                    <clipPath id="sequenceTrackClip">
                      <rect x="18" y="0" width="764" height="138" />
                    </clipPath>
                    <linearGradient id="domainGradOpaque" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#059669" stopOpacity="1" />
                      <stop offset="100%" stopColor="#047857" stopOpacity="1" />
                    </linearGradient>
                    <linearGradient id="activeDomainGradOpaque" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#10b981" stopOpacity="1" />
                      <stop offset="100%" stopColor="#059669" stopOpacity="1" />
                    </linearGradient>
                  </defs>

                  {/* Backbone track rail (Polypeptide Bar) */}
                  <rect
                    x="32"
                    y="44"
                    width="736"
                    height="6"
                    rx="3"
                    className="fill-slate-700 dark:fill-slate-800 stroke-slate-600 dark:stroke-slate-700 stroke-[0.5]"
                  />

                  {/* Clipped Sequence Track Elements */}
                  <g clipPath="url(#sequenceTrackClip)">
                    {/* Domain Blocks with solid opaque underlay */}
                    {domains.map((d: any, idx: number) => {
                      const x1 = getTrackX(d.start);
                      const x2 = getTrackX(d.end);
                      const w = Math.max(x2 - x1, 6);
                      const isTargetInside = typeof pos === "number" && pos >= d.start && pos <= d.end;
                      const isSelected = isFeatureSelected({ type: "domain", start: d.start, end: d.end });
                      const isDimmed = selectedCategory && selectedCategory !== "domain";

                      // Visible subsegment for centered label under zoom
                      const clampedStart = Math.max(d.start, visibleStart);
                      const clampedEnd = Math.min(d.end, visibleEnd);
                      const isPartiallyVisible = clampedStart <= clampedEnd;
                      const segX1 = isPartiallyVisible ? getTrackX(clampedStart) : x1;
                      const segX2 = isPartiallyVisible ? getTrackX(clampedEnd) : x2;
                      const visibleSegWidth = Math.max(0, segX2 - segX1);
                      const labelCenterX = segX1 + visibleSegWidth / 2;

                      return (
                        <g
                          key={idx}
                          role="button"
                          tabIndex={0}
                          aria-label={`Domain: ${d.description || "Domain"}, residues ${d.start} to ${d.end}`}
                          className="cursor-pointer group focus-visible:outline-none"
                          style={{ opacity: isDimmed ? 0.35 : 1, transition: "opacity 0.2s" }}
                          onClick={() => handleFeatureSelect({
                            type: "domain",
                            name: d.description || "Domain",
                            start: d.start,
                            end: d.end,
                            description: d.description,
                            interproId: d.interproId,
                            isEnclosing: isTargetInside,
                            distanceFromVariant: pos < d.start ? d.start - pos : pos > d.end ? pos - d.end : 0
                          })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              handleFeatureSelect({
                                type: "domain",
                                name: d.description || "Domain",
                                start: d.start,
                                end: d.end,
                                description: d.description,
                                interproId: d.interproId,
                                isEnclosing: isTargetInside,
                                distanceFromVariant: pos < d.start ? d.start - pos : pos > d.end ? pos - d.end : 0
                              });
                            }
                          }}
                        >
                          {/* 1. Solid underlay to prevent backbone rail from bleeding through */}
                          <rect
                            x={x1}
                            y="33"
                            width={w}
                            height="28"
                            rx="6"
                            className="fill-[#FAF9F6] dark:fill-[#201E1B]"
                          />
                          {/* 2. Main Domain Block with single clean focus border */}
                          <rect
                            x={x1}
                            y="33"
                            width={w}
                            height="28"
                            rx="6"
                            fill={isTargetInside ? "url(#activeDomainGradOpaque)" : "url(#domainGradOpaque)"}
                            className={`transition-all ${
                              isSelected
                                ? "stroke-amber-400 stroke-[2.5]"
                                : isTargetInside
                                  ? "stroke-emerald-300 stroke-1 group-hover:stroke-white"
                                  : "stroke-emerald-600/60 stroke-1 hover:stroke-emerald-300"
                            }`}
                          />
                          {/* Domain Label Centered in Visible Segment */}
                          {visibleSegWidth > 38 && (
                            <text
                              x={labelCenterX}
                              y="50"
                              textAnchor="middle"
                              className="text-[9.5px] font-mono font-bold fill-white pointer-events-none select-none drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]"
                            >
                              {d.description && d.description.length > 20
                                ? `${d.description.slice(0, 18)}…`
                                : d.description || "Domain"}
                            </text>
                          )}
                          <title>{`${d.description || "Domain"} (${d.start}–${d.end})${d.interproId ? ` [InterPro: ${d.interproId}]` : ""}`}</title>
                        </g>
                      );
                    })}

                    {/* Dedicated Functional Site Rail Guideline */}
                    <line
                      x1="32"
                      y1="74"
                      x2="768"
                      y2="74"
                      className="stroke-slate-300 dark:stroke-slate-700 stroke-[0.75]"
                      strokeDasharray="2 3"
                    />

                    {/* Staggered Non-Colliding Curated Site Lollipops (Anchored directly to rail bottom y=48) */}
                    {sortedFunctionalSites.map((s: any, idx: number) => {
                      const cx = getTrackX(s.start);
                      const isRose = isActiveSite(s);
                      const isPurple = isBindingSite(s);
                      const isSky = isPtmSite(s);
                      const isAmber = isDisulfideSite(s);
                      const isCyan = isTransmembraneSite(s);
                      const pinColor = isRose ? "#f43f5e" : isPurple ? "#a855f7" : isSky ? "#0ea5e9" : isAmber ? "#f59e0b" : isCyan ? "#06b6d4" : "#64748b";
                      const siteEnd = typeof s.end === "number" && Number.isFinite(s.end) ? s.end : s.start;
                      const isSelected = isFeatureSelected({ type: "site", start: s.start, end: siteEnd });

                      const matchesCategory = !selectedCategory || (
                        (selectedCategory === "active" && isRose) ||
                        (selectedCategory === "binding" && isPurple) ||
                        (selectedCategory === "ptm" && isSky) ||
                        (selectedCategory === "disulfide" && isAmber) ||
                        (selectedCategory === "transmembrane" && isCyan)
                      );

                      const isEnclosing = pos >= s.start && pos <= siteEnd;
                      const distance = isEnclosing ? 0 : (pos < s.start ? s.start - pos : pos - siteEnd);

                      // Determine tiered pin height to avoid collisions
                      const tier = siteTiers[idx] || 0;
                      const pinY = 74 + tier * 14; // Y: 74, 88, 102

                      const selectSite = () => handleFeatureSelect({
                        type: "site",
                        name: s.description || s.type,
                        start: s.start,
                        end: siteEnd,
                        category: s.type,
                        description: s.description,
                        isEnclosing,
                        distanceFromVariant: distance
                      });

                      return (
                        <g
                          key={idx}
                          role="button"
                          tabIndex={0}
                          aria-label={`Functional site: ${s.type || "Site"} at residue ${s.start}${siteEnd !== s.start ? `–${siteEnd}` : ""}${s.description ? `, ${s.description}` : ""}`}
                          className="cursor-pointer group focus-visible:outline-none"
                          style={{ opacity: matchesCategory ? 1 : 0.2, transition: "opacity 0.2s" }}
                          onClick={selectSite}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              selectSite();
                            }
                          }}
                        >
                          {/* Localized circular hit area centered directly on the pinhead (no stem occlusion) */}
                          <circle
                            cx={cx}
                            cy={pinY}
                            r="11"
                            fill="transparent"
                            className="cursor-pointer"
                          />

                          {/* Lollipop stem: Connected directly from polypeptide rail (y1=48) to pin (y2=pinY) */}
                          <line
                            x1={cx}
                            y1="48"
                            x2={cx}
                            y2={pinY}
                            className={`transition-colors pointer-events-none ${
                              isSelected
                                ? "stroke-amber-400 stroke-[2]"
                                : "stroke-slate-400 dark:stroke-slate-600 stroke-[1] group-hover:stroke-slate-300"
                            }`}
                          />

                          {/* Active selection glow ring */}
                          {isSelected && (
                            <circle
                              cx={cx}
                              cy={pinY}
                              r="8.5"
                              fill="none"
                              stroke="#f59e0b"
                              strokeWidth="1.5"
                              className="animate-pulse pointer-events-none"
                            />
                          )}

                          {/* Site circle pin */}
                          <circle
                            cx={cx}
                            cy={pinY}
                            r={isSelected ? 5.5 : 3.5}
                            fill={isSelected ? "#f59e0b" : pinColor}
                            className={`stroke-white dark:stroke-slate-900 stroke-[1.5] transition-all duration-150 pointer-events-none group-hover:r-[5px] ${
                              isSelected ? "stroke-amber-300" : ""
                            }`}
                          />
                          <title>{`${s.type}: ${s.description || ""} (${s.start}${siteEnd !== s.start ? `–${siteEnd}` : ""})`}</title>
                        </g>
                      );
                    })}
                  </g>

                  {/* Tier 1: Variant Indicator Pin & Callout Pill (Rendered on top of tracks) */}
                  {typeof pos === "number" && pos > 0 && (() => {
                    const varX = getTrackX(pos);
                    const pillWidth = 98;
                    const isVisibleInWindow = pos >= visibleStart && pos <= visibleEnd;
                    const clampedPillX = Math.max(32, Math.min(varX - pillWidth / 2, 768 - pillWidth));

                    if (!isVisibleInWindow) {
                      // Out of window indicator with keyboard accessibility
                      const isLeft = pos < visibleStart;
                      return (
                        <g
                          role="button"
                          tabIndex={0}
                          aria-label={`Jump sequence viewport to variant position ${pos}`}
                          className="cursor-pointer group focus-visible:outline-none"
                          onClick={focusOnVariant}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              focusOnVariant();
                            }
                          }}
                        >
                          <rect
                            x={isLeft ? 32 : 768 - 110}
                            y="4"
                            width="110"
                            height="18"
                            rx="5"
                            className="fill-amber-500/20 stroke-amber-500/50 stroke-[1] group-hover:fill-amber-500/30 transition-colors"
                          />
                          <text
                            x={isLeft ? 32 + 55 : 768 - 55}
                            y="16.5"
                            textAnchor="middle"
                            className="text-[8.5px] font-mono font-bold fill-amber-700 dark:fill-amber-300 select-none"
                          >
                            {isLeft ? `← Variant (${pos})` : `Variant (${pos}) →`}
                          </text>
                        </g>
                      );
                    }

                    return (
                      <g className="cursor-default">
                        {/* Callout Pill Background */}
                        <rect
                          x={clampedPillX}
                          y="3"
                          width={pillWidth}
                          height="18"
                          rx="5"
                          className="fill-amber-500/20 dark:fill-amber-500/30 stroke-amber-500/60 stroke-[1]"
                        />
                        <text
                          x={clampedPillX + pillWidth / 2}
                          y="15.5"
                          textAnchor="middle"
                          className="text-[9px] font-mono font-extrabold fill-amber-700 dark:fill-amber-300 select-none"
                        >
                          ▼ {wt || "p."}{pos}{mut ? ` → ${mut}` : ""}
                        </text>
                        {/* Guide line down to domain rail */}
                        <line
                          x1={varX}
                          y1="21"
                          x2={varX}
                          y2="44"
                          className="stroke-amber-500 dark:stroke-amber-400 stroke-[1.5]"
                          strokeDasharray="2 1.5"
                        />
                        {/* Glowing Beacon */}
                        <circle
                          cx={varX}
                          cy="47"
                          r="7.5"
                          className="fill-amber-500/25 animate-ping pointer-events-none"
                        />
                        <circle
                          cx={varX}
                          cy="47"
                          r="4"
                          className="fill-amber-500 stroke-white dark:stroke-slate-950 stroke-[1.5]"
                        />
                      </g>
                    );
                  })()}

                  {/* Tier 4: Sequence Scale Ruler */}
                  <line
                    x1="32"
                    y1="118"
                    x2="768"
                    y2="118"
                    className="stroke-slate-300 dark:stroke-slate-700 stroke-[0.75]"
                  />
                  <line x1="32" y1="115" x2="32" y2="121" className="stroke-slate-400 stroke-[1]" />
                  <line x1="216" y1="116" x2="216" y2="120" className="stroke-slate-300 dark:stroke-slate-700 stroke-[0.5]" />
                  <line x1="400" y1="115" x2="400" y2="121" className="stroke-slate-400 stroke-[1]" />
                  <line x1="584" y1="116" x2="584" y2="120" className="stroke-slate-300 dark:stroke-slate-700 stroke-[0.5]" />
                  <line x1="768" y1="115" x2="768" y2="121" className="stroke-slate-400 stroke-[1]" />

                  <text x="32" y="132" textAnchor="start" className="text-[9px] font-mono fill-slate-500 dark:fill-slate-400 font-semibold">
                    {visibleStart}
                  </text>
                  <text x="400" y="132" textAnchor="middle" className="text-[8.5px] font-mono fill-slate-500 dark:fill-slate-400">
                    {Math.round((visibleStart + visibleEnd) / 2)}
                  </text>
                  <text x="768" y="132" textAnchor="end" className="text-[9px] font-mono fill-slate-500 dark:fill-slate-400 font-semibold">
                    {visibleEnd} aa
                  </text>
                </svg>
              </div>

              {/* Interactive Selected Feature Inspector Bar */}
              {selectedFeature && (
                <div className="p-3 rounded-xl border bg-cs-surface border-amber-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in duration-200">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[9px] font-mono font-bold uppercase px-2 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                        Targeted {selectedFeature.type === "domain" ? "Domain" : "Curated Site"}
                      </span>
                      <span className="font-bold text-xs text-cs-text-primary truncate">
                        {selectedFeature.name}
                      </span>
                      <span className="text-[10px] font-mono text-cs-text-muted">
                        Residues {selectedFeature.start}{selectedFeature.end !== selectedFeature.start ? `–${selectedFeature.end}` : ""} ({selectedFeature.end - selectedFeature.start + 1} aa)
                      </span>
                    </div>
                    <p className="text-[11px] text-cs-text-secondary leading-snug">
                      {selectedFeature.description || "Curated functional site annotation."}
                      {selectedFeature.isEnclosing ? (
                        <strong className="ml-1 text-emerald-600 dark:text-emerald-400">
                          — Variant {wt}{pos}{mut ? `→${mut}` : ""} resides within this {selectedFeature.type === "domain" ? "domain" : "feature"}.
                        </strong>
                      ) : selectedFeature.distanceFromVariant !== undefined && selectedFeature.distanceFromVariant > 0 ? (
                        <span className="ml-1 text-cs-text-muted font-mono text-[10.5px]">
                          — {selectedFeature.distanceFromVariant} aa from variant site {pos}.
                        </span>
                      ) : null}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {selectedFeature.interproId && (
                      <a
                        href={`https://www.ebi.ac.uk/interpro/entry/InterPro/${encodeURIComponent(selectedFeature.interproId)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-1.5 rounded-lg border text-[10.5px] font-mono font-semibold flex items-center gap-1 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20"
                      >
                        <span>{selectedFeature.interproId}</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    {onNavigateToView && (
                      <button
                        type="button"
                        onClick={() => {
                          onSelectResidue?.(selectedFeature.start);
                          onNavigateToView(active3dModelTab === "esm3" ? "structure_esmfold" : "structure_alphafold");
                        }}
                        className="px-3 py-1.5 rounded-lg text-[10.5px] font-mono font-bold bg-amber-600 hover:bg-amber-500 text-white flex items-center gap-1.5 shadow-sm transition-all cursor-pointer active:scale-[0.98]"
                      >
                        <Box className="w-3.5 h-3.5" />
                        <span>Focus in 3D Structure Viewer</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setSelectedFeature(null)}
                      className="px-2 py-1.5 rounded-lg text-[10px] font-mono text-cs-text-muted hover:text-cs-text-primary border border-cs-border hover:bg-cs-surface-2 cursor-pointer transition-all"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}

              {/* InterPro Domain Cards List */}
              {domains.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-cs-border-subtle">
                  {domains.map((d: any, idx: number) => {
                    const isInside = typeof pos === "number" && pos >= d.start && pos <= d.end;
                    const isSelected = isFeatureSelected({ type: "domain", start: d.start, end: d.end });

                    return (
                      <div
                        key={idx}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleFeatureSelect({
                          type: "domain",
                          name: d.description || "Domain",
                          start: d.start,
                          end: d.end,
                          description: d.description,
                          interproId: d.interproId,
                          isEnclosing: isInside,
                          distanceFromVariant: pos < d.start ? d.start - pos : pos > d.end ? pos - d.end : 0
                        })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleFeatureSelect({
                              type: "domain",
                              name: d.description || "Domain",
                              start: d.start,
                              end: d.end,
                              description: d.description,
                              interproId: d.interproId,
                              isEnclosing: isInside,
                              distanceFromVariant: pos < d.start ? d.start - pos : pos > d.end ? pos - d.end : 0
                            });
                          }
                        }}
                        className={`p-2.5 rounded-lg border transition-all text-left cursor-pointer group ${
                          isSelected
                            ? "bg-amber-500/15 border-amber-500/60 ring-2 ring-amber-500/30 shadow-sm"
                            : isInside
                              ? "bg-emerald-500/10 border-emerald-500/40 hover:border-emerald-500/60"
                              : "bg-cs-surface border-cs-border hover:border-cs-accent-clay"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-[11.5px] text-cs-text-primary group-hover:text-cs-accent-clay">
                            {d.description || "Domain"}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {isSelected && (
                              <span className="text-[8.5px] px-1.5 py-0.5 rounded font-mono font-bold uppercase bg-amber-500/25 text-amber-700 dark:text-amber-300 border border-amber-500/40">
                                Selected
                              </span>
                            )}
                            {isInside ? (
                              <span className="text-[9px] px-1.5 py-0.5 rounded font-mono font-bold uppercase bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                                Inside ({pos - d.start + 1}/{d.end - d.start + 1} aa)
                              </span>
                            ) : (
                              <span className="text-[9px] font-mono text-cs-text-muted">
                                {pos < d.start ? `${d.start - pos} aa downstream` : `${pos - d.end} aa upstream`}
                              </span>
                            )}
                          </div>
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
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 text-[9.5px] font-mono font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
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
                {/* Upstream Vector (Synchronized with SVG selection) */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (nearestUpstream) {
                      const isDom = isDomainFeature(nearestUpstream.feature);
                      const featEnd = typeof nearestUpstream.feature.end === "number" && Number.isFinite(nearestUpstream.feature.end) ? nearestUpstream.feature.end : nearestUpstream.feature.start;
                      handleFeatureSelect({
                        type: isDom ? "domain" : "site",
                        name: nearestUpstream.feature.description || nearestUpstream.feature.type,
                        start: nearestUpstream.feature.start,
                        end: featEnd,
                        category: nearestUpstream.feature.type,
                        description: nearestUpstream.feature.description,
                        interproId: nearestUpstream.feature.interproId,
                        isEnclosing: typeof pos === "number" && pos >= nearestUpstream.feature.start && pos <= featEnd,
                        distanceFromVariant: nearestUpstream.distance
                      });
                    }
                  }}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === " ") && nearestUpstream) {
                      e.preventDefault();
                      const isDom = isDomainFeature(nearestUpstream.feature);
                      const featEnd = typeof nearestUpstream.feature.end === "number" && Number.isFinite(nearestUpstream.feature.end) ? nearestUpstream.feature.end : nearestUpstream.feature.start;
                      handleFeatureSelect({
                        type: isDom ? "domain" : "site",
                        name: nearestUpstream.feature.description || nearestUpstream.feature.type,
                        start: nearestUpstream.feature.start,
                        end: featEnd,
                        category: nearestUpstream.feature.type,
                        description: nearestUpstream.feature.description,
                        interproId: nearestUpstream.feature.interproId,
                        isEnclosing: typeof pos === "number" && pos >= nearestUpstream.feature.start && pos <= featEnd,
                        distanceFromVariant: nearestUpstream.distance
                      });
                    }
                  }}
                  className="p-2.5 rounded-lg border bg-cs-surface border-cs-border-subtle hover:border-cs-accent-clay cursor-pointer transition-all flex flex-col justify-between group text-left active:scale-[0.98]"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono font-bold text-sky-700 dark:text-sky-400 group-hover:underline">
                      {nearestUpstream ? `← ${nearestUpstream.distance} aa` : "← N-terminus"}
                    </span>
                    {nearestUpstream && (
                      <span className={`text-[8.5px] px-1.5 py-0.5 rounded font-mono font-bold uppercase border ${getFeatureBadgeStyle(nearestUpstream.feature.type)}`}>
                        {nearestUpstream.feature.type}
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] font-semibold text-cs-text-primary mt-1 group-hover:text-cs-accent-clay">
                    {nearestUpstream ? (nearestUpstream.feature.description || nearestUpstream.feature.type) : "Residue 1 (Start)"}
                  </span>
                  <span className="text-[9.5px] font-mono text-cs-text-muted mt-0.5">
                    {nearestUpstream ? `Residues ${nearestUpstream.feature.start}${nearestUpstream.feature.end && nearestUpstream.feature.end !== nearestUpstream.feature.start ? `–${nearestUpstream.feature.end}` : ""} (Click to inspect)` : "Sequence start"}
                  </span>
                </div>

                {/* Center Target Badge */}
                <div className="p-2.5 rounded-lg border bg-amber-500/10 border-amber-500/30 flex flex-col justify-between items-center text-center">
                  <span className="text-[9.5px] font-mono font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                    Variant Position
                  </span>
                  <span className="text-base font-mono font-extrabold text-cs-text-primary my-0.5">
                    {wt}{pos}{mut ? ` → ${mut}` : ""}
                  </span>
                  <span className="text-[9.5px] font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                    {activeDomain ? `Within ${activeDomain.description || "Domain"}` : "Inter-Domain Region"}
                  </span>
                </div>

                {/* Downstream Vector (Synchronized with SVG selection) */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (nearestDownstream) {
                      const isDom = isDomainFeature(nearestDownstream.feature);
                      const featEnd = typeof nearestDownstream.feature.end === "number" && Number.isFinite(nearestDownstream.feature.end) ? nearestDownstream.feature.end : nearestDownstream.feature.start;
                      handleFeatureSelect({
                        type: isDom ? "domain" : "site",
                        name: nearestDownstream.feature.description || nearestDownstream.feature.type,
                        start: nearestDownstream.feature.start,
                        end: featEnd,
                        category: nearestDownstream.feature.type,
                        description: nearestDownstream.feature.description,
                        interproId: nearestDownstream.feature.interproId,
                        isEnclosing: typeof pos === "number" && pos >= nearestDownstream.feature.start && pos <= featEnd,
                        distanceFromVariant: nearestDownstream.distance
                      });
                    }
                  }}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === " ") && nearestDownstream) {
                      e.preventDefault();
                      const isDom = isDomainFeature(nearestDownstream.feature);
                      const featEnd = typeof nearestDownstream.feature.end === "number" && Number.isFinite(nearestDownstream.feature.end) ? nearestDownstream.feature.end : nearestDownstream.feature.start;
                      handleFeatureSelect({
                        type: isDom ? "domain" : "site",
                        name: nearestDownstream.feature.description || nearestDownstream.feature.type,
                        start: nearestDownstream.feature.start,
                        end: featEnd,
                        category: nearestDownstream.feature.type,
                        description: nearestDownstream.feature.description,
                        interproId: nearestDownstream.feature.interproId,
                        isEnclosing: typeof pos === "number" && pos >= nearestDownstream.feature.start && pos <= featEnd,
                        distanceFromVariant: nearestDownstream.distance
                      });
                    }
                  }}
                  className="p-2.5 rounded-lg border bg-cs-surface border-cs-border-subtle hover:border-cs-accent-clay cursor-pointer transition-all flex flex-col justify-between text-right group active:scale-[0.98]"
                >
                  <div className="flex items-center justify-between">
                    {nearestDownstream && (
                      <span className={`text-[8.5px] px-1.5 py-0.5 rounded font-mono font-bold uppercase border ${getFeatureBadgeStyle(nearestDownstream.feature.type)}`}>
                        {nearestDownstream.feature.type}
                      </span>
                    )}
                    <span className="text-[10px] font-mono font-bold text-emerald-700 dark:text-emerald-400 ml-auto group-hover:underline">
                      {nearestDownstream ? `+${nearestDownstream.distance} aa →` : `C-terminus →`}
                    </span>
                  </div>
                  <span className="text-[11px] font-semibold text-cs-text-primary mt-1 group-hover:text-cs-accent-clay">
                    {nearestDownstream ? (nearestDownstream.feature.description || nearestDownstream.feature.type) : `Residue ${seqLength} (End)`}
                  </span>
                  <span className="text-[9.5px] font-mono text-cs-text-muted mt-0.5">
                    {nearestDownstream ? `Residues ${nearestDownstream.feature.start}${nearestDownstream.feature.end && nearestDownstream.feature.end !== nearestDownstream.feature.start ? `–${nearestDownstream.feature.end}` : ""} (Click to inspect)` : "Sequence terminus"}
                  </span>
                </div>
              </div>
            </div>

            {/* 4. Direct Curated Feature Site Matches at Residue pos or Prominent Clinical Assessment */}
            {displayedMatchingFeatures.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10.5px] font-mono font-bold uppercase text-cs-text-muted block">
                    Direct Site Annotations at Position {pos}:
                  </span>
                  {selectedCategory && (
                    <span className="text-[9.5px] font-mono text-cs-accent-clay">
                      Filtered by {selectedCategory} ({displayedMatchingFeatures.length} match{displayedMatchingFeatures.length === 1 ? "" : "es"})
                    </span>
                  )}
                </div>
                {displayedMatchingFeatures.map((f, idx) => {
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
              /* Prominent Residue-Level Curated Site Assessment Card */
              <div className="p-4 rounded-xl border bg-cs-surface border-cs-border space-y-2.5 shadow-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-slate-500/10 dark:bg-slate-500/20 text-slate-600 dark:text-slate-400 flex items-center justify-center">
                      <ShieldCheck className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-xs font-mono font-bold uppercase text-cs-text-primary tracking-wide">
                      Residue-Level Curated Site Assessment
                    </span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full font-bold uppercase bg-slate-500/10 text-slate-700 dark:text-slate-400 border border-slate-500/20">
                    Position {pos} ({wt}{pos}{mut ? `→${mut}` : ""})
                  </span>
                </div>
                <p className="text-xs text-cs-text-secondary leading-relaxed">
                  {selectedCategory
                    ? `No direct ${selectedCategory} annotations are recorded specifically at residue ${pos} in UniProtKB.`
                    : `No catalytic active site, binding pocket, metal coordination, or post-translational modification is recorded directly at wild-type residue ${wt}${pos} in UniProtKB.`}
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-cs-border-subtle text-[10px] font-mono text-cs-text-muted">
                  <span className="font-semibold text-cs-text-secondary">Nearest functional anchors:</span>
                  {nearestUpstream && (
                    <span className="px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-700 dark:text-sky-300 border border-sky-500/20">
                      {nearestUpstream.feature.description || nearestUpstream.feature.type} (← {nearestUpstream.distance} aa at res {nearestUpstream.boundaryRes})
                    </span>
                  )}
                  {nearestDownstream && (
                    <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20">
                      {nearestDownstream.feature.description || nearestDownstream.feature.type} (+{nearestDownstream.distance} aa → at res {nearestDownstream.boundaryRes})
                    </span>
                  )}
                </div>
              </div>
            )}
      </div>
    </div>
  );
}

export { InteractionsTab } from "./InteractionsTab";



