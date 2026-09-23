import React, { useState, useMemo, useCallback, useEffect } from "react";
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

/**
 * The one place that knows what each inventory chip means.
 *
 * The chip's count and the chip's filter used to be two independent predicates — the count used
 * the `isXxxSite` helpers while the track dimming re-derived the same question inline — so a chip
 * could claim "3 Transmembrane" and then filter by a different rule. Count and filter now read
 * `INVENTORY_MATCHERS`, and `null` (no chip selected) matches everything.
 */
type InventoryCategory = "domain" | "active" | "binding" | "ptm" | "disulfide" | "transmembrane" | "other";

function isRegionFeature(f?: { type?: string } | null): boolean {
  return getType(f) === "region";
}

/**
 * A point annotation the six named categories do not describe: UniProt's `Site`, `Motif`,
 * `Repeat`, `Zinc finger`, `DNA binding`, `Coiled coil`, `Compositional bias`, `Mutagenesis` —
 * all of which the server keeps (`RELEVANT_FEATURE_TYPES`) and the track plots as lollipops.
 * Without this category they were plotted but faded by every chip, with no chip able to restore
 * them, and the inventory row silently under-reported them.
 */
function isOtherSiteFeature(f?: { type?: string } | null): boolean {
  const t = getType(f);
  if (!t || t === "domain" || t === "chain" || t === "region") return false;
  return !(isActiveSite(f) || isBindingSite(f) || isPtmSite(f) || isDisulfideSite(f) || isTransmembraneSite(f));
}

/**
 * `satisfies` is load-bearing: adding a member to `InventoryCategory` without adding its matcher
 * is a compile error, so a category can no longer half-land (a missing key used to make a chip
 * with a non-zero count render as non-selectable, and a missing switch case silently matched
 * nothing and faded the whole track).
 */
const INVENTORY_MATCHERS = {
  domain: isDomainFeature,
  active: isActiveSite,
  binding: isBindingSite,
  ptm: isPtmSite,
  disulfide: isDisulfideSite,
  transmembrane: isTransmembraneSite,
  other: isOtherSiteFeature,
} satisfies Record<InventoryCategory, (f?: { type?: string } | null) => boolean>;

function matchesInventoryCategory(f: { type?: string } | null | undefined, category: InventoryCategory | null): boolean {
  if (!category) return true;
  return INVENTORY_MATCHERS[category](f);
}

/**
 * Pin colour per curated-site category. Same precedence the track always used, with the light-mode
 * values darkened one step (sky/cyan/amber/rose/purple 500 → 600) because the 500s measure
 * 2.1–2.7:1 against the light track surface, below the 3:1 non-text bar. The harness measures every
 * ratio rather than trusting these numbers.
 */
function sitePinColor(f?: { type?: string } | null): string {
  if (isActiveSite(f)) return "#e11d48";    // rose-600
  if (isBindingSite(f)) return "#9333ea";   // purple-600
  if (isPtmSite(f)) return "#0284c7";       // sky-600
  if (isDisulfideSite(f)) return "#d97706"; // amber-600
  if (isTransmembraneSite(f)) return "#0891b2"; // cyan-600
  return "#475569";                          // slate-600
}

/**
 * Selected pin colour. Deliberately a shade no category owns: the disulfide pin is `#d97706`
 * (amber-600), so selecting one used to be colour-identical to leaving it alone, with only the
 * radius (3.5 → 5.5) left to tell them apart.
 */
const SELECTED_PIN_COLOR = "#b45309"; // amber-700

/**
 * The inventory chips, in display order, with the colour language each category already had.
 * Every category is rendered on every protein — a conditional chip made "no disulfides" look
 * like "disulfides are not a thing we show" while "0 Active Sites" looked like a finding.
 *
 * `noun` is what the tooltips and the empty-state sentence use, because the chip label itself is
 * an adjective for the transmembrane category ("3 Transmembrane", not "3 Transmembranes").
 */
const INVENTORY_CHIPS: Array<{
  id: InventoryCategory;
  singular: string;
  plural: string;
  noun: string;
  onClass: string;
  offClass: string;
}> = [
  {
    id: "domain",
    singular: "Domain",
    plural: "Domains",
    noun: "domain",
    onClass: "bg-emerald-500 text-white border-emerald-600",
    offClass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20",
  },
  {
    id: "active",
    singular: "Active Site",
    plural: "Active Sites",
    noun: "active site",
    onClass: "bg-rose-500 text-white border-rose-600",
    offClass: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20 hover:bg-rose-500/20",
  },
  {
    id: "binding",
    singular: "Binding Site",
    plural: "Binding Sites",
    noun: "binding site",
    onClass: "bg-purple-500 text-white border-purple-600",
    offClass: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20 hover:bg-purple-500/20",
  },
  {
    id: "ptm",
    singular: "PTM",
    plural: "PTMs",
    noun: "PTM",
    onClass: "bg-sky-500 text-white border-sky-600",
    offClass: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20 hover:bg-sky-500/20",
  },
  {
    id: "disulfide",
    singular: "Disulfide",
    plural: "Disulfides",
    noun: "disulfide bond",
    onClass: "bg-amber-500 text-white border-amber-600",
    offClass: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 hover:bg-amber-500/20",
  },
  {
    id: "transmembrane",
    singular: "Transmembrane",
    plural: "Transmembrane",
    noun: "transmembrane region",
    onClass: "bg-cyan-500 text-white border-cyan-600",
    offClass: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20 hover:bg-cyan-500/20",
  },
  {
    id: "other",
    singular: "Other Site",
    plural: "Other Sites",
    noun: "other curated site",
    onClass: "bg-slate-600 text-white border-slate-700",
    offClass: "bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/20 hover:bg-slate-500/20",
  },
];

/** Display name for a category, for copy that must not leak the internal id ("No ptm annotation…"). */
function inventoryCategoryLabel(category: InventoryCategory | null): string {
  return INVENTORY_CHIPS.find((c) => c.id === category)?.singular ?? "curated";
}

/**
 * Sequence-track lanes, in SVG user units.
 *
 * Every shape in the track derives from these, including the callout lane and the ruler ticks:
 * the stems used to start at a hand-written y=48 while the backbone rail's bottom edge is y=50,
 * so each lollipop began *inside* the domain band and cut straight through the domain label ink.
 */
const TRACK = {
  viewWidth: 800,
  viewHeight: 138,
  x0: 32,   // x of residue 1
  x1: 768,  // x of the final residue
  railTop: 44,
  railHeight: 6,
  bandTop: 33,
  bandHeight: 28,
  labelBaseline: 50,
  siteRailY: 74,
  tierStep: 14,
  rulerY: 118,
  /** The variant callout lane, above the band. `gap` is the connector's length. */
  callout: {
    pillTop: 3,
    pillHeight: 18,
    pillTextBaseline: 15.5,
    pillWidth: 98,
    caretHeight: 8,
    caretHalfWidth: 4.5,
  },
} as const;
/** Bottom edge of the backbone rail — the anchor for a lollipop whose residue is not in a domain. */
const RAIL_BOTTOM = TRACK.railTop + TRACK.railHeight;
/** Bottom edge of the domain band — the anchor for a lollipop whose residue IS in a domain. */
const BAND_BOTTOM = TRACK.bandTop + TRACK.bandHeight;
/** Bottom edge of the callout pill — where the connector to the marker starts. */
const CALLOUT_PILL_BOTTOM = TRACK.callout.pillTop + TRACK.callout.pillHeight;

/**
 * Residue → x, derived from the rail's own span. Every band edge, stem and marker is placed with
 * this, so the ruler, the bands and the lollipops cannot drift apart.
 */
function residueToX(residue: number, seqLength: number, visibleStart: number, visibleEnd: number): number {
  const span = TRACK.x1 - TRACK.x0;
  const clamped = Math.max(1, Math.min(residue, seqLength));
  return TRACK.x0 + ((clamped - visibleStart) / Math.max(visibleEnd - visibleStart, 1)) * span;
}

/** Ruler tick x positions: both ends, the midpoint and the two quarter marks. */
const RULER_TICKS = [TRACK.x0, TRACK.x0 + (TRACK.x1 - TRACK.x0) / 4, (TRACK.x0 + TRACK.x1) / 2, TRACK.x1 - (TRACK.x1 - TRACK.x0) / 4, TRACK.x1];


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
  const [selectedCategory, setSelectedCategory] = useState<InventoryCategory | null>(null);
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

  // Coordinate mapping: one function for every shape, zoomed or not.
  const getTrackX = useCallback(
    (res: number) =>
      zoomLevel <= 1
        ? residueToX(res, seqLength, 1, seqLength)
        : residueToX(res, seqLength, visibleStart, visibleEnd),
    [zoomLevel, seqLength, visibleStart, visibleEnd]
  );

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

  /**
   * Can a residue be said to sit inside a feature? One derivation, used by the band highlight, the
   * stem anchor, the variant marker, the flank gauge and the read-out. They used to re-derive it
   * inline with three different rules, so a malformed feature (`end` missing) could be "inside a
   * domain" in the list while the picture anchored its stem to the rail — and a non-finite `start`
   * silently matched everything.
   */
  const coversResidue = useCallback((f: { start?: number; end?: number } | null | undefined, residue: number) => {
    if (!f) return false;
    const start = typeof f.start === "number" && Number.isFinite(f.start) ? f.start : null;
    if (start === null || typeof residue !== "number" || !Number.isFinite(residue)) return false;
    const end = typeof f.end === "number" && Number.isFinite(f.end) ? f.end : start;
    return residue >= start && residue <= end;
  }, []);

  // Group features by category
  const { domains, activeDomain, activeSites, bindingSites, ptms, disulfides, transmembranes, regions, otherSites, functionalSites } = useMemo(() => {
    const d = features.filter(isDomainFeature);
    const actDom = typeof pos === "number" ? d.find((item) => coversResidue(item, pos)) : undefined;
    const actSites = features.filter(isActiveSite);
    const bindSites = features.filter(isBindingSite);
    const ptmList = features.filter(isPtmSite);
    const disulfList = features.filter(isDisulfideSite);
    const tmList = features.filter(isTransmembraneSite);
    // Disordered/structural regions are curated, but they are spans rather than point sites, so
    // they are counted for the inventory and deliberately not plotted as lollipops.
    const regionList = features.filter(isRegionFeature);
    const otherList = features.filter(isOtherSiteFeature);
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
      regions: regionList,
      otherSites: otherList,
      functionalSites: fSites,
    };
  }, [features, pos, coversResidue]);

  /** True once the curated-annotation payload has actually arrived (or definitively failed). */
  const curatedAnnotationsAvailable = !!result?.uniprotFeatures;

  /**
   * Count and filter for every inventory chip, both read from `INVENTORY_MATCHERS`. A category
   * with nothing annotated cannot narrow anything: selecting it dims the whole track and can only
   * ever produce an empty result, so it is rendered as information instead of a filter.
   */
  const inventory = useMemo(() => {
    const counts = {} as Record<InventoryCategory, number>;
    const has = {} as Record<InventoryCategory, boolean>;
    for (const category of Object.keys(INVENTORY_MATCHERS) as InventoryCategory[]) {
      const n = features.filter((f) => INVENTORY_MATCHERS[category](f)).length;
      counts[category] = n;
      has[category] = n > 0;
    }
    return {
      counts,
      has,
      regions: regions.length,
      /** Curated features the track actually plots (domains + point sites) vs everything fetched. */
      plotted: functionalSites.length + domains.length,
      curated: features.filter((f) => getType(f) !== "chain").length,
    };
  }, [features, regions, functionalSites, domains]);

  /**
   * A category can lose every feature it counted while a chip is selected (a re-run, a streamed
   * chunk, a different protein). The chip then becomes non-selectable, so without this the filter
   * could not be un-pressed by clicking it and the track would stay dimmed.
   */
  useEffect(() => {
    if (selectedCategory && !inventory.has[selectedCategory]) setSelectedCategory(null);
  }, [selectedCategory, inventory]);

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

  /**
   * Where each lollipop stem attaches.
   *
   * The domain band is painted over the backbone rail, so a stem anchored at the rail starts
   * *inside* the band — visibly detached from anything and drawn straight through the domain
   * label's ink. Each stem now starts at the bottom edge of the surface that actually covers its
   * residue: the domain band where there is one, the rail where there is not.
   */
  const siteStemAnchors = useMemo(
    () =>
      sortedFunctionalSites.map((s) =>
        domains.some((d) => coversResidue(d, s.start)) ? BAND_BOTTOM : RAIL_BOTTOM
      ),
    [sortedFunctionalSites, domains, coversResidue]
  );

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

  /**
   * Curated annotations that actually cover the variant residue.
   *
   * The unfiltered read-out used to exclude domains while the Domain chip included them, so the
   * same residue reported "no direct annotations" by default and "1 match" the moment the Domain
   * chip was pressed — the flank gauge and the domain cards, which both say the variant sits in
   * CBS 1, disagreed with it. Domains are now part of the default set; a chip narrows it.
   */
  const displayedMatchingFeatures = useMemo(() => {
    if (typeof pos !== "number") return [];
    return features.filter((f) => {
      const t = getType(f);
      if (t === "chain" || t === "region") return false;
      if (!coversResidue(f, pos)) return false;
      return matchesInventoryCategory(f, selectedCategory);
    });
  }, [features, pos, selectedCategory, coversResidue]);

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

            {/*
              1. Curated feature inventory — every count and every filter reads one predicate.
              A category with nothing annotated is rendered as information, not as a filter: it
              cannot narrow anything (selecting it dims the entire track and can only produce an
              empty result), and a disabled <button> would leave the explanation unreachable.
            */}
            <div role="group" aria-label="Feature inventory filters" className="flex flex-wrap items-center gap-1.5 py-1">
              <span className="text-[10px] font-mono uppercase text-cs-text-muted mr-1 font-semibold">
                {curatedAnnotationsAvailable ? "Inventory:" : "Inventory"}
              </span>
              {curatedAnnotationsAvailable &&
                INVENTORY_CHIPS.map((chip) => {
                  const count = inventory.counts[chip.id];
                  const active = selectedCategory === chip.id;
                  const filterable = inventory.has[chip.id];
                  const label = `${count} ${count === 1 ? chip.singular : chip.plural}`;
                  if (!filterable) {
                    return (
                      <span
                        key={chip.id}
                        title={`No ${chip.noun} annotated in UniProtKB for this protein — nothing to filter.`}
                        className="px-2.5 py-1 rounded-full text-[9.5px] font-mono font-bold border bg-slate-500/5 text-cs-text-muted border-cs-border-subtle"
                      >
                        {label}
                      </span>
                    );
                  }
                  return (
                    <button
                      key={chip.id}
                      type="button"
                      aria-pressed={active}
                      title={active ? `Clear the ${chip.noun} filter` : `Filter the track to ${chip.noun}s`}
                      onClick={() => setSelectedCategory((prev) => (prev === chip.id ? null : chip.id))}
                      className={`px-2.5 py-1 rounded-full text-[9.5px] font-mono font-bold border transition-all cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cs-accent-clay/50 ${
                        active ? `${chip.onClass} shadow-sm` : chip.offClass
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              {curatedAnnotationsAvailable && (
                <span
                  className="px-2.5 py-1 rounded-full text-[9.5px] font-mono font-bold border bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20"
                  title={`${inventory.regions} curated region annotation${inventory.regions === 1 ? "" : "s"} (e.g. disordered regions). Regions are residue spans rather than point sites, so they are counted here but not plotted as lollipops.`}
                >
                  {inventory.regions} Region{inventory.regions === 1 ? "" : "s"} <span className="font-normal">(not plotted)</span>
                </span>
              )}
              {selectedCategory && (
                <button
                  type="button"
                  onClick={() => setSelectedCategory(null)}
                  className="text-[9.5px] font-mono text-cs-text-muted hover:text-cs-text-primary underline ml-1 cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cs-accent-clay/50"
                >
                  Reset filter
                </button>
              )}
            </div>

            {/*
              Nothing below may assert that curated annotations are absent until the payload has
              actually arrived: during the PDB warmup `uniprotFeatures` is null, and on a UniProt
              timeout it stays null — in both cases an "0 Domains / no domain contains residue 489"
              read-out is a false negative about a protein that has three domains.
            */}
            {!curatedAnnotationsAvailable && (
              <div
                role="status"
                className="p-3 rounded-lg border border-cs-border-subtle bg-cs-surface-2 text-[11px] font-mono"
                style={{ color: "var(--cs-text-secondary)" }}
              >
                {hasServiceNotice
                  ? "Curated domain and site annotations are unavailable for this run — no absence is asserted below."
                  : "Retrieving curated domain and site annotations…"}
              </div>
            )}

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
                  viewBox={`0 0 ${TRACK.viewWidth} ${TRACK.viewHeight}`}
                  className="w-full h-auto min-w-[500px] overflow-visible select-none"
                >
                  <defs>
                    <clipPath id="sequenceTrackClip">
                      <rect x={TRACK.x0 - 14} y="0" width={TRACK.x1 - TRACK.x0 + 28} height={TRACK.viewHeight} />
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
                    x={TRACK.x0}
                    y={TRACK.railTop}
                    width={TRACK.x1 - TRACK.x0}
                    height={TRACK.railHeight}
                    rx={TRACK.railHeight / 2}
                    className="fill-slate-700 dark:fill-slate-800 stroke-slate-600 dark:stroke-slate-700 stroke-[0.5]"
                  />

                  {/* Clipped Sequence Track Elements */}
                  <g clipPath="url(#sequenceTrackClip)">
                    {/* Domain Blocks with solid opaque underlay */}
                    {domains.map((d: any, idx: number) => {
                      const x1 = getTrackX(d.start);
                      const x2 = getTrackX(d.end);
                      const w = Math.max(x2 - x1, 6);
                      const isTargetInside = coversResidue(d, pos);
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
                          aria-pressed={isSelected}
                          aria-label={
                            `Domain: ${d.description || "Domain"}, residues ${d.start} to ${d.end}` +
                            (isTargetInside ? `, contains the variant residue ${pos}` : "") +
                            (isSelected ? ", selected" : "")
                          }
                          /*
                           * `outline-hidden` (not `outline-none`) keeps the forced-colors ring, and the
                           * keyboard indicator is an explicit stroke on the band drawn only for
                           * `:focus-visible` — a mouse click never matches that, so the ring a click
                           * used to leave behind cannot come back. Nothing else paints it.
                           */
                          className="cursor-pointer group focus-visible:outline-hidden"
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
                          {/* SVG 2 wants <title> first; browsers are inconsistent about other positions. */}
                          <title>{`${d.description || "Domain"} (${d.start}–${d.end})${d.interproId ? ` [InterPro: ${d.interproId}]` : ""}`}</title>
                          {/* 1. Solid underlay to prevent backbone rail from bleeding through */}
                          <rect
                            x={x1}
                            y={TRACK.bandTop}
                            width={w}
                            height={TRACK.bandHeight}
                            rx="6"
                            className="fill-[#FAF9F6] dark:fill-[#1C1A17]"
                          />
                          {/*
                            2. Domain band. Every block carries the SAME stroke in every state: the
                            "variant is inside this domain" and "this domain is selected" states are
                            carried by the brighter fill (plus the card badge and the inspector bar),
                            never by a ring around the block. The separate `group-focus-visible` stroke
                            is the keyboard focus indicator — it cannot appear from a click, because a
                            click does not match `:focus-visible`.
                          */}
                          <rect
                            x={x1}
                            y={TRACK.bandTop}
                            width={w}
                            height={TRACK.bandHeight}
                            rx="6"
                            fill={isTargetInside || isSelected ? "url(#activeDomainGradOpaque)" : "url(#domainGradOpaque)"}
                            className="stroke-emerald-600/60 stroke-1 group-hover:stroke-emerald-300 group-focus-visible:stroke-amber-300 group-focus-visible:stroke-[2.5] transition-colors"
                          />
                          {/* Domain Label Centered in Visible Segment */}
                          {visibleSegWidth > 38 && (
                            <text
                              x={labelCenterX}
                              y={TRACK.labelBaseline}
                              textAnchor="middle"
                              className="text-[9.5px] font-mono font-bold fill-white pointer-events-none select-none drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]"
                            >
                              {d.description && d.description.length > 20
                                ? `${d.description.slice(0, 18)}…`
                                : d.description || "Domain"}
                            </text>
                          )}
                        </g>
                      );
                    })}

                    {/* Dedicated Functional Site Rail Guideline */}
                    <line
                      x1={TRACK.x0}
                      y1={TRACK.siteRailY}
                      x2={TRACK.x1}
                      y2={TRACK.siteRailY}
                      className="stroke-slate-300 dark:stroke-slate-700 stroke-[0.75]"
                      strokeDasharray="2 3"
                    />

                    {/* Staggered curated-site lollipops, each anchored to the edge its residue sits on */}
                    {sortedFunctionalSites.map((s: any, idx: number) => {
                      const cx = getTrackX(s.start);
                      const siteEnd = typeof s.end === "number" && Number.isFinite(s.end) ? s.end : s.start;
                      const isSelected = isFeatureSelected({ type: "site", start: s.start, end: siteEnd });
                      const pinColor = sitePinColor(s);

                      // Count and filter are the same predicate; "domain" is the only category a
                      // site can never belong to, so every site fades when that chip is active.
                      const matchesCategory = matchesInventoryCategory(s, selectedCategory);

                      const isEnclosing = pos >= s.start && pos <= siteEnd;
                      const distance = isEnclosing ? 0 : (pos < s.start ? s.start - pos : pos - siteEnd);

                      // Determine tiered pin height to avoid collisions
                      const tier = siteTiers[idx] || 0;
                      const pinY = TRACK.siteRailY + tier * TRACK.tierStep;

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
                          aria-pressed={isSelected}
                          aria-label={
                            `Functional site: ${s.type || "Site"} at residue ${s.start}${siteEnd !== s.start ? `–${siteEnd}` : ""}${s.description ? `, ${s.description}` : ""}` +
                            (isEnclosing ? `, contains the variant residue ${pos}` : "") +
                            (isSelected ? ", selected" : "")
                          }
                          /* `outline-hidden` keeps the forced-colors ring; the keyboard indicator is the
                             pin's own `group-focus-visible` stroke, which a click cannot trigger. */
                          className="cursor-pointer group focus-visible:outline-hidden"
                          style={{ opacity: matchesCategory ? 1 : 0.2, transition: "opacity 0.2s" }}
                          onClick={selectSite}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              selectSite();
                            }
                          }}
                        >
                          {/* Connectivity check target: the stem must start on the covered band/rail edge */}
                          <title>{`${s.type}: ${s.description || ""} (${s.start}${siteEnd !== s.start ? `–${siteEnd}` : ""})`}</title>

                          {/* Localized circular hit area centered directly on the pinhead (no stem occlusion) */}
                          <circle
                            cx={cx}
                            cy={pinY}
                            r="11"
                            fill="transparent"
                            className="cursor-pointer"
                          />

                          {/* Lollipop stem: from the visible edge of the band/rail down to the pin */}
                          <line
                            x1={cx}
                            y1={siteStemAnchors[idx] ?? RAIL_BOTTOM}
                            x2={cx}
                            y2={pinY}
                            className={`transition-colors pointer-events-none ${
                              isSelected
                                ? "stroke-amber-600 stroke-[2]"
                                : "stroke-slate-400 dark:stroke-slate-600 stroke-[1] group-hover:stroke-slate-500 dark:group-hover:stroke-slate-400"
                            }`}
                          />

                          {/*
                            Selected state: a larger, solid pin in a colour no category owns (a selected
                            disulfide pin used to be colour-identical to an unselected one), plus the
                            amber stem. Deliberately NO ring around the pinhead — a stroked circle left
                            behind by a click reads as a stuck focus ring. `group-hover:[r:5px]` keeps the
                            hover cue on the thing the pointer is actually over.
                          */}
                          <circle
                            cx={cx}
                            cy={pinY}
                            r={isSelected ? 5.5 : 3.5}
                            fill={isSelected ? SELECTED_PIN_COLOR : pinColor}
                            className="stroke-white dark:stroke-slate-900 stroke-[1.5] transition-all duration-150 pointer-events-none group-hover:[r:5px] group-focus-visible:stroke-amber-300 group-focus-visible:stroke-[2.5]"
                          />
                        </g>
                      );
                    })}
                  </g>

                  {/* Tier 1: Variant Indicator Pin & Callout Pill (Rendered on top of tracks) */}
                  {typeof pos === "number" && pos > 0 && (() => {
                    const { pillTop, pillHeight, pillTextBaseline, pillWidth, caretHeight, caretHalfWidth } = TRACK.callout;
                    const varX = getTrackX(pos);
                    const isVisibleInWindow = pos >= visibleStart && pos <= visibleEnd;
                    const clampedPillX = Math.max(TRACK.x0, Math.min(varX - pillWidth / 2, TRACK.x1 - pillWidth));
                    /*
                     * The marker lives in the free lane between the callout pill and the top of the
                     * domain band, and points down at the residue's lane.
                     *
                     * It used to be a glowing beacon painted on the backbone rail (y=47) — which is the
                     * same line the domain label occupies (baseline y=50), so on CNNM2 the variant
                     * marker covered the "S" of "CBS 1" and the callout read "CBS•1". Nothing is painted
                     * inside the band now, so a label can never be occluded.
                     */
                    const coversVariant = domains.some((d) => coversResidue(d, pos));
                    const caretTipY = TRACK.bandTop;
                    const caretTopY = caretTipY - caretHeight;

                    if (!isVisibleInWindow) {
                      // Out of window indicator with keyboard accessibility
                      const isLeft = pos < visibleStart;
                      return (
                        <g
                          role="button"
                          tabIndex={0}
                          aria-label={`Jump sequence viewport to variant position ${pos}`}
                          className="cursor-pointer group focus-visible:outline-hidden"
                          onClick={focusOnVariant}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              focusOnVariant();
                            }
                          }}
                        >
                          <rect
                            x={isLeft ? TRACK.x0 : TRACK.x1 - 110}
                            y={pillTop + 1}
                            width="110"
                            height={pillHeight}
                            rx="5"
                            className="fill-amber-500/20 stroke-amber-500/50 stroke-[1] group-hover:fill-amber-500/30 group-focus-visible:stroke-amber-300 group-focus-visible:stroke-[2] transition-colors"
                          />
                          <text
                            x={isLeft ? TRACK.x0 + 55 : TRACK.x1 - 55}
                            y={pillTop + 13.5}
                            textAnchor="middle"
                            className="text-[8.5px] font-mono font-bold fill-amber-700 dark:fill-amber-300 select-none"
                          >
                            {isLeft ? `← Variant (${pos})` : `Variant (${pos}) →`}
                          </text>
                        </g>
                      );
                    }

                    return (
                      /* `data-track` is the harness's stable handle: a styling class is not a contract. */
                      <g
                        className="cursor-default"
                        data-track="variant-marker"
                        role="img"
                        aria-label={`Variant ${wt || ""}${pos}${mut ? ` to ${mut}` : ""}${coversVariant ? ", inside a curated domain" : ""}`}
                      >
                        {/* Callout Pill Background */}
                        <rect
                          x={clampedPillX}
                          y={pillTop}
                          width={pillWidth}
                          height={pillHeight}
                          rx="5"
                          className="fill-amber-500/20 dark:fill-amber-500/30 stroke-amber-500/60 stroke-[1]"
                        />
                        <text
                          x={clampedPillX + pillWidth / 2}
                          y={pillTextBaseline}
                          textAnchor="middle"
                          className="text-[9px] font-mono font-extrabold fill-amber-700 dark:fill-amber-300 select-none"
                        >
                          {wt || "p."}{pos}{mut ? ` → ${mut}` : ""}
                        </text>
                        {/*
                          Connector: only when the pill had to be clamped away from the residue's x,
                          where it is the only thing tying the callout to the caret. When the pill sits
                          over the residue it would be a 4-unit stub, which reads as a stray dash.
                        */}
                        {Math.abs(clampedPillX + pillWidth / 2 - varX) > 12 && (
                          <line
                            x1={varX}
                            y1={CALLOUT_PILL_BOTTOM}
                            x2={varX}
                            y2={caretTopY}
                            className="stroke-amber-500 dark:stroke-amber-400 stroke-[1.5]"
                            strokeDasharray="2 1.5"
                          />
                        )}
                        {/* Marker: points at the residue's lane from the free lane above the band.
                            amber-700 rather than amber-500: the caret is the only thing marking the
                            residue on the track, and amber-500 measures ~2.1:1 on the light surface. */}
                        <polygon
                          points={`${varX - caretHalfWidth},${caretTopY} ${varX + caretHalfWidth},${caretTopY} ${varX},${caretTipY}`}
                          className="fill-amber-700 stroke-amber-800/70 dark:fill-amber-500 dark:stroke-amber-300 stroke-[0.75] pointer-events-none"
                        />
                        {/* Between domains there is no band edge to land on: reach the backbone itself */}
                        {!coversVariant && (
                          <line
                            x1={varX}
                            y1={caretTipY}
                            x2={varX}
                            y2={TRACK.railTop}
                            className="stroke-amber-500 dark:stroke-amber-400 stroke-[1] pointer-events-none"
                          />
                        )}
                      </g>
                    );
                  })()}

                  {/* Tier 4: Sequence Scale Ruler (ticks derived from the same span as every band) */}
                  <line
                    x1={TRACK.x0}
                    y1={TRACK.rulerY}
                    x2={TRACK.x1}
                    y2={TRACK.rulerY}
                    className="stroke-slate-300 dark:stroke-slate-700 stroke-[0.75]"
                  />
                  {RULER_TICKS.map((tickX, i) => {
                    const isMajor = i % 2 === 0;
                    return (
                      <line
                        key={tickX}
                        x1={tickX}
                        y1={TRACK.rulerY - (isMajor ? 3 : 2)}
                        x2={tickX}
                        y2={TRACK.rulerY + (isMajor ? 3 : 2)}
                        className={isMajor ? "stroke-slate-400 stroke-[1]" : "stroke-slate-300 dark:stroke-slate-700 stroke-[0.5]"}
                      />
                    );
                  })}

                  <text x={TRACK.x0} y={TRACK.rulerY + 14} textAnchor="start" className="text-[9px] font-mono fill-slate-500 dark:fill-slate-400 font-semibold">
                    {visibleStart}
                  </text>
                  <text x={(TRACK.x0 + TRACK.x1) / 2} y={TRACK.rulerY + 14} textAnchor="middle" className="text-[8.5px] font-mono fill-slate-500 dark:fill-slate-400">
                    {Math.round((visibleStart + visibleEnd) / 2)}
                  </text>
                  <text x={TRACK.x1} y={TRACK.rulerY + 14} textAnchor="end" className="text-[9px] font-mono fill-slate-500 dark:fill-slate-400 font-semibold">
                    {visibleEnd} aa
                  </text>
                </svg>
              </div>

              {/* Interactive Selected Feature Inspector Bar. A live region, because selecting a
                  domain or a lollipop in the SVG changes only this bar — otherwise activation is
                  announced to nobody. */}
              {selectedFeature && (
                <div
                  role="status"
                  aria-live="polite"
                  className="p-3 rounded-xl border bg-cs-surface border-amber-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in duration-200"
                >
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
                    const isInside = coversResidue(d, pos);
                    const isSelected = isFeatureSelected({ type: "domain", start: d.start, end: d.end });

                    return (
                      /*
                       * Only the header is the activation target, and it is a real <button>: the
                       * InterPro link in the footer used to live INSIDE a `role="button"` card, which
                       * puts an interactive control inside another one — ambiguous name and role for
                       * assistive tech, and two overlapping tab stops.
                       */
                      <div
                        key={idx}
                        className={`p-2.5 rounded-lg border text-left group transition-colors ${
                          isSelected
                            ? "bg-amber-500/15 border-amber-500/70 shadow-sm"
                            : isInside
                              ? "bg-emerald-500/10 border-emerald-500/40 hover:border-emerald-500/60"
                              : "bg-cs-surface border-cs-border hover:border-cs-accent-clay"
                        }`}
                      >
                        <button
                          type="button"
                          aria-pressed={isSelected}
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
                          className="w-full text-left cursor-pointer rounded focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cs-accent-clay/50"
                        >
                          <span className="flex items-center justify-between">
                            <span className="font-semibold text-[11.5px] text-cs-text-primary group-hover:text-cs-accent-clay">
                              {d.description || "Domain"}
                            </span>
                            <span className="flex items-center gap-1.5">
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
                            </span>
                          </span>
                        </button>
                        <div className="flex items-center justify-between mt-1.5">
                          <span className="text-[10px] font-mono text-cs-text-muted">
                            Residues {d.start}–{d.end} ({d.end - d.start + 1} aa)
                          </span>
                          {d.interproId ? (
                            <a
                              href={`https://www.ebi.ac.uk/interpro/entry/InterPro/${encodeURIComponent(d.interproId)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[9.5px] font-mono font-semibold text-emerald-700 dark:text-emerald-400 hover:underline rounded focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cs-accent-clay/50"
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
                {/*
                  Upstream Vector (Synchronized with SVG selection). The interactivity is attached
                  only when there IS a nearest feature: an inert `role="button"` that is still in the
                  tab order and does nothing on activation is worse than plain text.
                */}
                <div
                  {...(nearestUpstream
                    ? {
                        role: "button" as const,
                        tabIndex: 0,
                        onClick: () => {
                          if (!nearestUpstream) return;
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
                        },
                        onKeyDown: (e: React.KeyboardEvent) => {
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
                        },
                      }
                    : { "aria-disabled": true as const })}
                  className={`p-2.5 rounded-lg border bg-cs-surface border-cs-border-subtle flex flex-col justify-between group text-left ${
                    nearestUpstream
                      ? "hover:border-cs-accent-clay cursor-pointer transition-all active:scale-[0.98] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cs-accent-clay/50"
                      : ""
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono font-bold text-sky-700 dark:text-sky-400 group-hover:underline">
                      {nearestUpstream ? `← ${nearestUpstream.distance} aa` : curatedAnnotationsAvailable ? "← N-terminus" : "← not retrieved"}
                    </span>
                    {nearestUpstream && (
                      <span className={`text-[8.5px] px-1.5 py-0.5 rounded font-mono font-bold uppercase border ${getFeatureBadgeStyle(nearestUpstream.feature.type)}`}>
                        {nearestUpstream.feature.type}
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] font-semibold text-cs-text-primary mt-1 group-hover:text-cs-accent-clay">
                    {nearestUpstream ? (nearestUpstream.feature.description || nearestUpstream.feature.type) : curatedAnnotationsAvailable ? "Residue 1 (Start)" : "Annotations unavailable"}
                  </span>
                  <span className="text-[9.5px] font-mono text-cs-text-muted mt-0.5">
                    {nearestUpstream ? `Residues ${nearestUpstream.feature.start}${nearestUpstream.feature.end && nearestUpstream.feature.end !== nearestUpstream.feature.start ? `–${nearestUpstream.feature.end}` : ""} (Click to inspect)` : curatedAnnotationsAvailable ? "Sequence start" : "No curated feature context"}
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
                    {!curatedAnnotationsAvailable
                      ? "Domain context not retrieved"
                      : activeDomain
                        ? `Within ${activeDomain.description || "Domain"}`
                        : "Inter-Domain Region"}
                  </span>
                </div>

                {/* Downstream Vector (Synchronized with SVG selection) — interactive only when there
                    is something to inspect */}
                <div
                  {...(nearestDownstream
                    ? {
                        role: "button" as const,
                        tabIndex: 0,
                        onClick: () => {
                          if (!nearestDownstream) return;
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
                        },
                        onKeyDown: (e: React.KeyboardEvent) => {
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
                        },
                      }
                    : { "aria-disabled": true as const })}
                  className={`p-2.5 rounded-lg border bg-cs-surface border-cs-border-subtle flex flex-col justify-between text-right group ${
                    nearestDownstream
                      ? "hover:border-cs-accent-clay cursor-pointer transition-all active:scale-[0.98] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cs-accent-clay/50"
                      : ""
                  }`}
                >
                  <div className="flex items-center justify-between">
                    {nearestDownstream && (
                      <span className={`text-[8.5px] px-1.5 py-0.5 rounded font-mono font-bold uppercase border ${getFeatureBadgeStyle(nearestDownstream.feature.type)}`}>
                        {nearestDownstream.feature.type}
                      </span>
                    )}
                    <span className="text-[10px] font-mono font-bold text-emerald-700 dark:text-emerald-400 ml-auto group-hover:underline">
                      {nearestDownstream ? `+${nearestDownstream.distance} aa →` : curatedAnnotationsAvailable ? `C-terminus →` : "not retrieved →"}
                    </span>
                  </div>
                  <span className="text-[11px] font-semibold text-cs-text-primary mt-1 group-hover:text-cs-accent-clay">
                    {nearestDownstream ? (nearestDownstream.feature.description || nearestDownstream.feature.type) : curatedAnnotationsAvailable ? `Residue ${seqLength} (End)` : "Annotations unavailable"}
                  </span>
                  <span className="text-[9.5px] font-mono text-cs-text-muted mt-0.5">
                    {nearestDownstream ? `Residues ${nearestDownstream.feature.start}${nearestDownstream.feature.end && nearestDownstream.feature.end !== nearestDownstream.feature.start ? `–${nearestDownstream.feature.end}` : ""} (Click to inspect)` : curatedAnnotationsAvailable ? "Sequence terminus" : "No curated feature context"}
                  </span>
                </div>
              </div>
            </div>

            {/* 4. Curated feature matches at the variant residue, or the residue-level assessment */}
            {displayedMatchingFeatures.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10.5px] font-mono font-bold uppercase text-cs-text-muted block">
                    {/* The set includes domains, so the heading must not call every match a "site" */}
                    Direct Curated Annotations at Position {pos}:
                  </span>
                  {selectedCategory && (
                    <span className="text-[9.5px] font-mono text-cs-accent-clay">
                      Filtered by {inventoryCategoryLabel(selectedCategory)} ({displayedMatchingFeatures.length} match{displayedMatchingFeatures.length === 1 ? "" : "es"})
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
                  {!curatedAnnotationsAvailable
                    ? hasServiceNotice
                      ? "Curated UniProtKB annotations could not be retrieved for this run, so nothing is claimed about this residue."
                      : "Curated UniProtKB annotations are still being retrieved, so nothing is claimed about this residue yet."
                    : selectedCategory
                      ? `No ${inventoryCategoryLabel(selectedCategory)} annotation is recorded at residue ${pos} in UniProtKB.`
                      : `No domain, catalytic active site, binding pocket, metal coordination, or post-translational modification contains wild-type residue ${wt}${pos} in UniProtKB.`}
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



