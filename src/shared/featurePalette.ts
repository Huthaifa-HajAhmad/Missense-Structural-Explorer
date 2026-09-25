/**
 * What a curated UniProtKB feature *is*, in one place: how it is classified, what colour it is
 * painted, and what the filter chips call it.
 *
 * Two consumers read this — the Functional Domains track (pin colour, filter chips, band fill) and
 * the inspector's "Feature Types & Palette" legend — because they had drifted apart in exactly the
 * way a duplicated palette always does. The legend advertised indigo domains, amber binding sites,
 * emerald PTM anchors and cyan disulfides while the track painted emerald, purple, sky and amber,
 * and it had no entry at all for transmembrane regions or for the curated site types no other
 * category covers. Anyone reading the legend to interpret the track was being misled.
 *
 * Independent verification lives in `tools/function-track-geometry`, which re-implements these
 * predicates as its own oracle and measures every colour's contrast against the track surface. Do
 * not import this module there.
 */
export type FeatureKindKey =
  | "domain"
  | "active"
  | "binding"
  | "ptm"
  | "disulfide"
  | "transmembrane"
  | "region"
  | "other";

export interface FeatureKind {
  key: FeatureKindKey;
  /** Chip label, singular and plural ("1 Domain" / "3 Domains"). */
  singular: string;
  plural: string;
  /** What tooltips and empty-state copy call one of these — the chip label is an adjective for
   *  transmembrane regions, so prose cannot reuse it. */
  noun: string;
  /**
   * Light-mode colour, used for the SVG pin and for the legend swatch. Every value clears the 3:1
   * non-text bar against the track surface (#FAF9F6) — measured, not assumed, by the geometry
   * harness, which reports the ratios.
   */
  color: string;
  /** Active / inactive filter-chip classes, kept beside the colour they express. */
  onClass: string;
  offClass: string;
  /**
   * Whether the category also gets an inventory chip. Omitted means it does; only disordered regions
   * opt out. They are a structural descriptor rather than a functional annotation, so they are painted
   * as span bars, listed in the legend and counted by the Spans chip, but they are not a filter of
   * their own, and they stay out of the default match set and the flank vectors. They briefly shared
   * the neutral "other" colour, which made an ordered low-complexity segment indistinguishable from an
   * unclassified curated site.
   */
  chipped?: boolean;
  matches: (type?: string | null) => boolean;
}

const lower = (type?: string | null) => (type || "").toLowerCase();

/** Precedence matters: "Metal binding" is a binding site, not an "other" site. */
const NAMED_KINDS: FeatureKind[] = [
  {
    key: "domain",
    singular: "Domain",
    plural: "Domains",
    noun: "domain",
    color: "#059669", // emerald-600 — the domain band's gradient: its start at rest, its end when the band is highlighted
    onClass: "bg-emerald-500 text-white border-emerald-600",
    offClass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20",
    matches: (t) => lower(t) === "domain",
  },
  {
    key: "active",
    singular: "Active Site",
    plural: "Active Sites",
    noun: "active site",
    color: "#e11d48", // rose-600
    onClass: "bg-rose-500 text-white border-rose-600",
    offClass: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20 hover:bg-rose-500/20",
    matches: (t) => lower(t).includes("active") || lower(t).includes("catalytic"),
  },
  {
    key: "binding",
    singular: "Binding Site",
    plural: "Binding Sites",
    noun: "binding site",
    color: "#9333ea", // purple-600
    onClass: "bg-purple-500 text-white border-purple-600",
    offClass: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20 hover:bg-purple-500/20",
    matches: (t) => lower(t).includes("binding") || lower(t).includes("metal"),
  },
  {
    key: "ptm",
    singular: "PTM",
    plural: "PTMs",
    noun: "PTM",
    color: "#0284c7", // sky-600
    onClass: "bg-sky-500 text-white border-sky-600",
    offClass: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20 hover:bg-sky-500/20",
    matches: (t) => {
      const k = lower(t);
      return k.includes("modified") || k.includes("phospho") || k.includes("methyl") || k.includes("acetyl");
    },
  },
  {
    key: "disulfide",
    singular: "Disulfide",
    plural: "Disulfides",
    noun: "disulfide bond",
    color: "#d97706", // amber-600 — the tightest of the palette at 3.03:1
    onClass: "bg-amber-500 text-white border-amber-600",
    offClass: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 hover:bg-amber-500/20",
    matches: (t) => lower(t).includes("disulfide") || lower(t).includes("cysteine"),
  },
  {
    key: "transmembrane",
    singular: "Transmembrane",
    plural: "Transmembrane",
    noun: "transmembrane region",
    color: "#0891b2", // cyan-600
    onClass: "bg-cyan-500 text-white border-cyan-600",
    offClass: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20 hover:bg-cyan-500/20",
    matches: (t) => lower(t).includes("transmembrane") || lower(t).includes("membrane"),
  },
  /**
   * Disordered / low-complexity regions: a structural descriptor rather than a functional annotation,
   * so it is painted and legended but not chipped, and it is not part of any filter.
   *
   * stone-500 rather than a grey borrowed from "other": these bars sit in the same lane as the
   * zinc-finger and low-complexity bars, and on GZF1 there are enough of both that one neutral for the
   * two of them made an ordered segment and an unclassified site the same colour. Warm stone against
   * cool slate separates them by hue and by lightness, and the harness checks both the 3:1 non-text bar
   * and a minimum perceptual distance between every pair of swatches.
   */
  {
    key: "region",
    singular: "Disordered Region",
    plural: "Disordered Regions",
    noun: "disordered region",
    color: "#78716c", // stone-500
    onClass: "bg-stone-500 text-white border-stone-600",
    offClass: "bg-stone-500/10 text-stone-600 dark:text-stone-300 border-stone-500/20 hover:bg-stone-500/20",
    chipped: false,
    matches: (t) => lower(t) === "region",
  },
];

/**
 * A curated annotation none of the named categories describes: UniProt's `Site`, `Motif`, `Repeat`,
 * `Zinc finger`, `DNA binding`, `Coiled coil`, `Compositional bias`, `Mutagenesis` — all of which the
 * server keeps (`RELEVANT_FEATURE_TYPES`) and the track draws. Whether one is drawn as a lollipop or
 * as a span bar is a separate question, answered by `featureGeometryFor`.
 *
 * It is a real complement, not a catch-all: a predicate that always matched would make this chip's
 * count the whole protein and its filter dim nothing. `chain` and `region` are excluded — a chain is
 * a sequence construct rather than an annotation, and a region has its own kind above.
 */
const OTHER_KIND: FeatureKind = {
  key: "other",
  singular: "Other Site",
  plural: "Other Sites",
  noun: "other curated site",
  color: "#475569", // slate-600
  onClass: "bg-slate-600 text-white border-slate-700",
  offClass: "bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/20 hover:bg-slate-500/20",
  matches: (t) => {
    const k = lower(t);
    if (!k || k === "chain" || k === "region") return false;
    return !NAMED_KINDS.some((kind) => kind.matches(t));
  },
};

/**
 * Every kind, in display order, with the complement last. The legend renders all of them; the chip row
 * renders `CHIPPED_KINDS` only, so adding a kind for the legend's sake cannot silently add a filter.
 */
export const FEATURE_KINDS: FeatureKind[] = [...NAMED_KINDS, OTHER_KIND];

/** The kinds that are also inventory filters. */
export const CHIPPED_KINDS: FeatureKind[] = FEATURE_KINDS.filter((kind) => kind.chipped !== false);
export const CHIPPED_KIND_KEYS = CHIPPED_KINDS.map((kind) => kind.key);

/**
 * How a feature should be drawn.
 *
 * `span` types are annotated over a *run* of residues and must not be drawn as a point: GZF1's ten
 * C2H2 zinc fingers are 23–24 residues each, and plotting them as lollipops put fifteen near-black
 * dots on one track while claiming a 24-residue finger sits at a single residue. `point` types are
 * annotated at a residue. The split is by the nature of the annotation, not by its length.
 */
export type FeatureGeometry = "band" | "span" | "point";

const SPAN_TYPES = new Set([
  "transmembrane",
  "region",
  "zinc finger",
  "repeat",
  "coiled coil",
  "compositional bias",
  "motif",
  "dna binding",
]);

export function featureGeometryFor(type?: string | null): FeatureGeometry {
  const k = lower(type);
  if (k === "domain") return "band";
  return SPAN_TYPES.has(k) ? "span" : "point";
}

export const FEATURE_KIND_KEYS = FEATURE_KINDS.map((k) => k.key);

/** The kind a feature belongs to: the first whose predicate matches, "other" last. */
export function featureKindFor(type?: string | null): FeatureKind {
  return FEATURE_KINDS.find((k) => k.matches(type)) ?? FEATURE_KINDS[FEATURE_KINDS.length - 1];
}

/** Pin colour for a feature. */
export function featureColorFor(type?: string | null): string {
  return featureKindFor(type).color;
}

/** Display name for copy that must not leak the internal id ("No ptm annotation at 556"). */
export function featureKindLabel(key: FeatureKindKey | null | undefined): string {
  return FEATURE_KINDS.find((k) => k.key === key)?.singular ?? "curated";
}
