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
  Sliders,
  Sparkles
} from "lucide-react";
import { TabComponentProps } from "./types";
import {
  CHIPPED_KINDS,
  CHIPPED_KIND_KEYS,
  FEATURE_KINDS,
  featureColorFor,
  featureGeometryFor,
  featureKindLabel,
  type FeatureKindKey,
} from "../../shared/featurePalette";

function getType(f?: { type?: string } | null): string {
  return f?.type?.toLowerCase() || "";
}

function isDomainFeature(f?: { type?: string } | null): boolean {
  return getType(f) === "domain";
}

/**
 * The inventory categories, their colours and their predicates all come from
 * `src/shared/featurePalette.ts`, which the inspector's palette legend also reads. They used to be
 * duplicated here, which is how the legend ended up advertising colours the track never painted.
 *
 * `featurePalette` deals in UniProt *type strings* (a taxonomy); the track has feature objects, so
 * the adaptation happens here — once, with no cast. An earlier version built this table with
 * `Object.fromEntries(...) as Record<InventoryCategory, …>`, and that assertion hid a real
 * argument-type mismatch until the browser threw it at render time.
 */
type InventoryCategory = FeatureKindKey;

function featureMatchesKind(f: { type?: string } | null | undefined, key: InventoryCategory): boolean {
  const kind = FEATURE_KINDS.find((k) => k.key === key);
  return kind ? kind.matches(getType(f)) : false;
}

function matchesInventoryCategory(f: { type?: string } | null | undefined, category: InventoryCategory | null): boolean {
  if (!category) return true;
  return featureMatchesKind(f, category);
}

/** Pin colour per curated-site category, from the shared palette. */
function sitePinColor(f?: { type?: string } | null): string {
  return featureColorFor(getType(f));
}

/**
 * Selected pin colour. Deliberately a shade no category owns: the disulfide pin is `#d97706`
 * (amber-600), so selecting one used to be colour-identical to leaving it alone, with only the
 * radius (3.5 → 5.5) left to tell them apart.
 */
const SELECTED_PIN_COLOR = "#b45309"; // amber-700

/**
 * The inventory chips, in display order, rendered from the shared palette. Every category is
 * rendered on every protein — a conditional chip made "no disulfides" look like "disulfides are not
 * a thing we show" while "0 Active Sites" looked like a finding — and each chip's label, tooltip
 * noun and colours come from the same entry the pin colour does.
 */
const INVENTORY_CHIPS = CHIPPED_KINDS.map((kind) => ({
  id: kind.key,
  singular: kind.singular,
  plural: kind.plural,
  noun: kind.noun,
  onClass: kind.onClass,
  offClass: kind.offClass,
}));

/** Display name for a category, for copy that must not leak the internal id ("No ptm annotation…"). */
function inventoryCategoryLabel(category: InventoryCategory | null): string {
  return featureKindLabel(category);
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
  /**
   * The span lane: curated features annotated over a run of residues (transmembrane helices, zinc
   * fingers, repeats, low-complexity segments, disordered regions, motifs) are drawn as thin bars
   * here rather than as point lollipops on the site rail. It sits between the domain band's bottom
   * edge and the site rail, and holds up to three tiers so nested spans (a low-complexity segment
   * inside a disordered region) stay legible.
   */
  spanLaneTop: 62,
  spanHeight: 3.5,
  spanTierStep: 5,
  spanTiers: 3,
  siteRailY: 74,
  tierStep: 14,
  /**
   * Point-lollipop tiering. Pins that would collide are stacked in tiers: two pins on the same tier
   * must be at least `pinSeparation` apart in x, and there are `pinTiers` tiers to spend. Three tiers
   * cannot separate more than three mutually-close pins — that is a layout budget, not an algorithm —
   * which is why every annotation is also offered as a large-target control in the list below.
   */
  pinSeparation: 14,
  pinTiers: 3,
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
  /**
   * The annotation control list can be narrowed to the features that cover the variant residue. It is the
   * one place the "what is at my residue?" question is answered now: the separate card list that used to
   * answer it said the same things about the same features one surface further down.
   */
  const [showAtPositionOnly, setShowAtPositionOnly] = useState(false);

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

  // Group features for drawing
  const { domains, activeDomain, pointSites, spanFeatures } = useMemo(() => {
    const d = features.filter(isDomainFeature);
    const actDom = typeof pos === "number" ? d.find((item) => coversResidue(item, pos)) : undefined;
    // Drawn by geometry, not by type name: a feature annotated over a run of residues goes to the
    // span lane, a feature annotated at a residue becomes a lollipop. Chains are sequence
    // constructs rather than annotations and are dropped entirely.
    const plotted = features.filter((f) => {
      const t = getType(f);
      return t !== "domain" && t !== "chain";
    });
    const points = plotted.filter((f) => featureGeometryFor(getType(f)) === "point");
    const spans = plotted.filter((f) => featureGeometryFor(getType(f)) === "span");

    return { domains: d, activeDomain: actDom, pointSites: points, spanFeatures: spans };
  }, [features, pos, coversResidue]);

  /** True once the curated-annotation payload has actually arrived (or definitively failed). */
  const curatedAnnotationsAvailable = !!result?.uniprotFeatures;

  /**
   * Count and filter for every inventory chip, both read from the shared palette's predicates. A
   * category with nothing annotated cannot narrow anything: selecting it dims the whole track and
   * can only ever produce an empty result, so it is rendered as information instead of a filter.
   */
  const inventory = useMemo(() => {
    const counts = {} as Record<InventoryCategory, number>;
    const has = {} as Record<InventoryCategory, boolean>;
    for (const category of CHIPPED_KIND_KEYS) {
      const n = features.filter((f) => featureMatchesKind(f, category)).length;
      counts[category] = n;
      has[category] = n > 0;
    }
    return {
      counts,
      has,
      spans: spanFeatures.length,
      /** Curated features the track actually plots (bands + spans + points) vs everything fetched. */
      plotted: domains.length + spanFeatures.length + pointSites.length,
      curated: features.filter((f) => getType(f) !== "chain").length,
    };
  }, [features, spanFeatures, pointSites, domains]);

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
    return [...pointSites].sort((a, b) => a.start - b.start);
  }, [pointSites]);

  /**
   * Tier assignment for the point lollipops: first-fit interval packing.
   *
   * Each pin takes the lowest tier whose rightmost pin is at least `TRACK.pinSeparation` away in x,
   * reading the actual occupancy of every tier. The previous rule compared each site with its
   * immediate predecessor only and cycled the tier modulo three, which is not a packing rule at all:
   * it never asks whether the tier it wraps onto is free, and it compares against one neighbour when
   * the conflict is with any of them.
   *
   * When every tier is occupied the pin joins the tier whose rightmost pin is furthest left — the same
   * policy the span lane uses — so an over-subscribed cluster degrades predictably instead of doubling
   * up on tier 0.
   */
  const siteTiers = useMemo(() => {
    const rightmostX: number[] = [];
    return sortedFunctionalSites.map((s) => {
      const x = getTrackX(s.start);
      let tier = rightmostX.findIndex((placedX) => x - placedX >= TRACK.pinSeparation);
      if (tier === -1) {
        tier =
          rightmostX.length < TRACK.pinTiers
            ? rightmostX.length
            : rightmostX.indexOf(Math.min(...rightmostX));
      }
      rightmostX[tier] = x;
      return tier;
    });
  }, [sortedFunctionalSites, getTrackX]);

  /**
   * Every annotation the track draws, flat and in N→C order, for the large-target control list below
   * the track. Domains, span bars and pins are three different shapes in the SVG but one thing to a
   * reader, so the list is the accessible twin of the picture rather than a subset of it.
   */
  const plottedAnnotations = useMemo(() => {
    const rows: Array<{ feature: any; kind: "domain" | "site"; start: number; end: number }> = [
      ...domains.map((f: any) => ({ feature: f, kind: "domain" as const })),
      ...spanFeatures.map((f: any) => ({ feature: f, kind: "site" as const })),
      ...pointSites.map((f: any) => ({ feature: f, kind: "site" as const })),
    ].map((row) => {
      const end = typeof row.feature.end === "number" && Number.isFinite(row.feature.end) ? row.feature.end : row.feature.start;
      return { ...row, start: row.feature.start, end };
    });
    return rows.sort((a, b) => a.start - b.start || a.end - b.end);
  }, [domains, spanFeatures, pointSites]);

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

  /**
   * Span-lane layout.
   *
   * Spans overlap by nature — five of GZF1's low-complexity segments sit inside its two disordered
   * regions — so each is packed into the first tier whose already-placed intervals do not overlap
   * it. A span that would need a fourth tier shares the last one rather than disappearing.
   */
  const spanLayout = useMemo(() => {
    const sorted = [...spanFeatures]
      .map((f) => ({
        feature: f,
        start: typeof f.start === "number" && Number.isFinite(f.start) ? f.start : 0,
        end: typeof f.end === "number" && Number.isFinite(f.end) ? f.end : f.start,
      }))
      .sort((a, b) => a.start - b.start);
    const tierEnds: number[] = [];
    const placed = sorted.map((span) => {
      let tier = tierEnds.findIndex((end) => span.start > end);
      if (tier === -1) {
        if (tierEnds.length < TRACK.spanTiers) {
          tierEnds.push(span.end);
          tier = tierEnds.length - 1;
        } else {
          // Deeper nesting than the lane can show: share the last tier rather than dropping the
          // annotation silently.
          tier = TRACK.spanTiers - 1;
          tierEnds[tier] = Math.max(tierEnds[tier], span.end);
        }
      } else {
        tierEnds[tier] = span.end;
      }
      return { ...span, tier };
    });
    return { placed, tierCount: Math.max(1, tierEnds.length) };
  }, [spanFeatures]);

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

  /**
   * Selecting one of the flank cards, from the pointer or from the keyboard.
   *
   * The click handler and the keydown handler each carried their own copy of this body — two copies per
   * flank, four in all, ~17 lines each — so any behaviour fix had to be made in all four or in none. The
   * keyboard path is the same selection plus `preventDefault` on the activating key, which is all that is
   * left of the duplication.
   */
  const selectFlank = useCallback(
    (
      flank: {
        feature: { type: string; description?: string; start: number; end?: number; interproId?: string };
        distance: number;
      } | null
    ) => {
      if (!flank || typeof pos !== "number") return;
      const featEnd =
        typeof flank.feature.end === "number" && Number.isFinite(flank.feature.end)
          ? flank.feature.end
          : flank.feature.start;
      handleFeatureSelect({
        type: isDomainFeature(flank.feature) ? "domain" : "site",
        name: flank.feature.description || flank.feature.type,
        start: flank.feature.start,
        end: featEnd,
        category: flank.feature.type,
        description: flank.feature.description,
        interproId: flank.feature.interproId,
        isEnclosing: pos >= flank.feature.start && pos <= featEnd,
        distanceFromVariant: flank.distance,
      });
    },
    [handleFeatureSelect, pos]
  );

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
                <span className="badge-metric">
                  Length: <strong>{seqLength} aa</strong>
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
                  title={`${inventory.spans} curated annotation${inventory.spans === 1 ? "" : "s"} drawn on the span lane below the backbone — features annotated over a run of residues (transmembrane helices, zinc fingers, repeats, low-complexity segments, disordered regions, motifs). They are not point sites, so they are drawn as spans, not lollipops.`}
                >
                  {inventory.spans} Span{inventory.spans === 1 ? "" : "s"} <span className="font-normal">(span lane)</span>
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
                            /*
                             * The surface token, not a literal. This was `fill-[#FAF9F6]
                             * dark:fill-[#1C1A17]` — a hand-copied pair that was correct only while the
                             * token happened to hold the same hex, so re-deriving the neutral ramp left
                             * this band 3.3 lightness points off every other nested panel. `dark:fill-`
                             * also cannot be flattened by the print pass, which reaches tokens only.
                             */
                            className="fill-[var(--cs-surface-2)]"
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

                    {/*
                      Curated spans: features annotated over a run of residues, drawn as thin bars in
                      their own lane instead of as point lollipops. GZF1's ten C2H2 zinc fingers are
                      23–24 residues each; as pins they were fifteen near-black dots claiming a
                      24-residue finger sits at one residue. Bars are painted after the lollipops so a
                      stem passing behind one does not cut it in half.
                    */}
                    {spanLayout.placed.map((span, idx) => {
                      const x1 = getTrackX(span.start);
                      const x2 = getTrackX(span.end);
                      const w = Math.max(x2 - x1, 2.5);
                      const y = TRACK.spanLaneTop + span.tier * TRACK.spanTierStep;
                      const isSelected = isFeatureSelected({ type: "site", start: span.start, end: span.end });
                      const isEnclosing = coversResidue(span.feature, pos);
                      const matchesCategory = matchesInventoryCategory(span.feature, selectedCategory);
                      const distance = isEnclosing ? 0 : pos < span.start ? span.start - pos : pos - span.end;
                      const selectSpan = () => handleFeatureSelect({
                        type: "site",
                        name: span.feature.description || span.feature.type,
                        start: span.start,
                        end: span.end,
                        category: span.feature.type,
                        description: span.feature.description,
                        isEnclosing,
                        distanceFromVariant: distance,
                      });
                      return (
                        <g
                          key={`span-${idx}`}
                          role="button"
                          tabIndex={0}
                          aria-pressed={isSelected}
                          aria-label={
                            `Curated span: ${span.feature.type} ${span.feature.description || ""} at residues ${span.start} to ${span.end}`.trim() +
                            (isEnclosing ? `, contains the variant residue ${pos}` : "") +
                            (isSelected ? ", selected" : "")
                          }
                          className="cursor-pointer group focus-visible:outline-hidden"
                          style={{ opacity: matchesCategory ? 1 : 0.2, transition: "opacity 0.2s" }}
                          onClick={selectSpan}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              selectSpan();
                            }
                          }}
                        >
                          <title>{`${span.feature.type}: ${span.feature.description || ""} (${span.start}–${span.end}, ${span.end - span.start + 1} aa)`}</title>
                          <rect
                            x={x1}
                            y={y}
                            width={w}
                            height={TRACK.spanHeight}
                            rx={TRACK.spanHeight / 2}
                            fill={sitePinColor(span.feature)}
                            className={`transition-colors ${
                              isSelected
                                ? "stroke-amber-600 stroke-[1.5]"
                                : isEnclosing
                                  ? "stroke-amber-500/60 stroke-[0.75] group-hover:stroke-amber-500"
                                  : "stroke-transparent group-hover:stroke-slate-400 stroke-[0.75] group-focus-visible:stroke-amber-300 group-focus-visible:stroke-[2]"
                            }`}
                          />
                          {/* A span that contains the variant gets an underline: the bar alone cannot
                              say "the variant is in here" once several spans share the window. */}
                          {isEnclosing && (
                            <rect
                              x={x1}
                              y={y + TRACK.spanHeight + 0.75}
                              width={w}
                              height="1.25"
                              rx="0.6"
                              className="fill-amber-600 dark:fill-amber-400 pointer-events-none"
                            />
                          )}
                        </g>
                      );
                    })}

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

              {/*
                WCAG 2.5.8 (Target Size). The SVG pins are r=11 user units: roughly 28 CSS px at a wide
                container, but about 14 CSS px at this container's 500px floor, below the 24px minimum.
                Enlarging the radius is not the fix — at 875 aa adjacent pins are ~25 units apart, so
                r>12 makes neighbouring targets overlap and steal each other's clicks, and a cluster
                denser than the three tiers can separate cannot be fixed by geometry at all.

                So the track's shapes are also offered here as controls: full width, at least 24px tall,
                keyboard-reachable (a summary element, so it is a real disclosure rather than a div with
                a click handler), and selecting a row uses the same selection language the SVG does.
              */}
              {plottedAnnotations.length > 0 && (
                <details className="rounded-xl border bg-cs-surface-2 border-cs-border" data-annotation-list>
                  <summary className="px-3 py-2 min-h-[28px] flex items-center cursor-pointer text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted rounded-xl focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cs-accent-clay/50">
                    All curated annotations ({plottedAnnotations.length})
                    <span className="ml-2 font-sans font-normal normal-case tracking-normal">
                      — every shape on the track as a full-size control
                    </span>
                  </summary>
                  {/*
                    The variant-position framing lives here rather than in a second list below. The tab
                    used to carry both: these rows for the whole protein and a card list filtered to the
                    residue, saying the same things about the same features in two places. The filter is
                    the cards' question ("what is at my residue?") asked of the one list, and the absence
                    sentence — which must not appear until the payload has arrived, or it claims a
                    protein with three domains has none — moved here with it.
                  */}
                  <div className="px-2 pb-2" data-annotation-position-heading>
                    <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-1.5">
                      <button
                        type="button"
                        aria-pressed={showAtPositionOnly}
                        onClick={() => setShowAtPositionOnly((prev) => !prev)}
                        title={
                          showAtPositionOnly
                            ? `Showing only the annotations containing residue ${pos} — click to show every annotation`
                            : `Show only the annotations containing residue ${pos}`
                        }
                        className={`inline-flex items-center gap-1.5 min-h-[28px] px-2 rounded-full text-[9.5px] font-mono font-bold border cursor-pointer transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cs-accent-clay/50 ${
                          showAtPositionOnly
                            ? "bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40"
                            : "bg-cs-surface border-cs-border text-cs-text-muted hover:text-cs-text-primary"
                        }`}
                      >
                        <Crosshair className="w-3 h-3" />
                        <span>Direct Curated Annotations at Position {pos} ({displayedMatchingFeatures.length})</span>
                      </button>
                      {selectedCategory && (
                        <span className="text-[9.5px] font-mono text-cs-accent-clay">
                          Filtered by {inventoryCategoryLabel(selectedCategory)} ({displayedMatchingFeatures.length}{" "}
                          match{displayedMatchingFeatures.length === 1 ? "" : "es"})
                        </span>
                      )}
                    </div>
                    {displayedMatchingFeatures.length === 0 && (
                      <p className="px-1 pb-1.5 text-[11px] font-sans leading-relaxed" style={{ color: "var(--cs-text-secondary)" }}>
                        {!curatedAnnotationsAvailable
                          ? hasServiceNotice
                            ? "Curated UniProtKB annotations could not be retrieved for this run, so nothing is claimed about this residue."
                            : "Curated UniProtKB annotations are still being retrieved, so nothing is claimed about this residue yet."
                          : selectedCategory
                            ? `No ${inventoryCategoryLabel(selectedCategory)} annotation is recorded at residue ${pos} in UniProtKB.`
                            : `No domain, catalytic active site, binding pocket, metal coordination, or post-translational modification contains wild-type residue ${wt}${pos} in UniProtKB.`}
                      </p>
                    )}
                  </div>
                  <div className="px-2 pb-2 space-y-1">
                    {(showAtPositionOnly
                      ? plottedAnnotations.filter((row) => displayedMatchingFeatures.includes(row.feature))
                      : plottedAnnotations
                    ).map((row, idx) => {
                      const f = row.feature;
                      const geometry = featureGeometryFor(f.type);
                      const isSelected = isFeatureSelected({ type: row.kind, start: row.start, end: row.end });
                      const length = row.end - row.start + 1;
                      const isEnclosing = typeof pos === "number" && pos >= row.start && pos <= row.end;
                      return (
                        <button
                          key={`${row.kind}-${f.type}-${row.start}-${idx}`}
                          type="button"
                          data-annotation-row
                          data-annotation-kind={row.kind}
                          data-annotation-start={row.start}
                          data-annotation-end={row.end}
                          data-annotation-at-position={isEnclosing ? "true" : undefined}
                          aria-pressed={isSelected}
                          onClick={() =>
                            handleFeatureSelect({
                              type: row.kind,
                              name: f.description || f.type,
                              start: row.start,
                              end: row.end,
                              category: f.type,
                              description: f.description,
                              interproId: f.interproId,
                              isEnclosing,
                              distanceFromVariant: isEnclosing
                                ? 0
                                : pos < row.start
                                  ? row.start - pos
                                  : pos - row.end,
                            })
                          }
                          className={`w-full min-h-[28px] flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-left transition-colors cursor-pointer group focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cs-accent-clay/50 ${
                            isSelected
                              ? "border-amber-500/70 bg-amber-500/10"
                              : "border-cs-border hover:border-cs-accent-clay"
                          }`}
                        >
                          <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold font-mono uppercase shrink-0 ${getFeatureBadgeStyle(f.type)}`}>
                            {f.type}
                          </span>
                          <span className="text-[11px] font-sans truncate flex-1" style={{ color: "var(--cs-text-secondary)" }}>
                            {f.description || "Curated functional feature"}
                          </span>
                          {/* Containment is not selection: this row holds the residue under inspection. */}
                          {isEnclosing && (
                            <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0 bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                              at {pos}
                            </span>
                          )}
                          <span className="text-[9.5px] font-mono shrink-0" style={{ color: "var(--cs-text-muted)" }}>
                            {geometry === "band" ? "Residues" : geometry === "span" ? "Span" : "Residue"}{" "}
                            {row.start === row.end ? row.start : `${row.start}–${row.end}`}
                            {length > 1 ? ` (${length} aa)` : ""}
                          </span>
                          <span className="opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity shrink-0">
                            <Crosshair className="w-3 h-3 text-cs-accent-clay" />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </details>
              )}

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
                        onClick: () => selectFlank(nearestUpstream),
                        onKeyDown: (e: React.KeyboardEvent) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            selectFlank(nearestUpstream);
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
                        onClick: () => selectFlank(nearestDownstream),
                        onKeyDown: (e: React.KeyboardEvent) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            selectFlank(nearestDownstream);
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

            {/*
              4. There is deliberately no second list of the annotations at this residue here. The
              position framing — the count, the active chip's "Filtered by … (n match)", the absence
              sentence and the "at 489" marker on the rows that hold the residue — lives in the
              annotation control list above, which is the same set of features with the same selection
              behaviour. What used to be a card list here also repeated the nearest-anchor row that the
              flank cards above already show.
            */}
      </div>
    </div>
  );
}

export { InteractionsTab } from "./InteractionsTab";



