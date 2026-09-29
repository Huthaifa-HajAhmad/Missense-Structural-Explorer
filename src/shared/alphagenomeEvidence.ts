/**
 * alphagenomeEvidence.ts — the one reading of an AlphaGenome AVI payload that the tab and its
 * inspector rail both render, so the two panes cannot disagree about a number or a sentence.
 *
 * WHAT THE AVI IS (Cheng et al., AlphaGenome Atlas, medRxiv 2026, doi:10.64898/2026.09.16.26363192)
 *   • A supervised neural network over 18 features — ten AlphaGenome modality predictions (each the
 *     per-variant maximum predicted effect across biosamples), AlphaMissense, three VEP protein-
 *     termination indicators, two conservation scores and two indel indicators.
 *   • Trained to separate proxy-impactful (gnomAD FAF95 grpmax < 0.1%) from proxy-neutral
 *     (≥ 0.1%) variants. Its target is rarity under selection, not pathogenicity.
 *   • Reported as a Phred rank against all ~9 billion possible hg38 SNVs: 10 = top 10%, 20 = top 1%.
 *   • Attributed by SHAP (expected-gradients approximation); the 18 contributions sum to the raw
 *     score.
 *   • No ClinGen calibration exists, so nothing here maps it to PP3/BP4. (An earlier comment quoted
 *     the authors as calling the scores "not sufficient evidence on their own"; that sentence could
 *     not be found in the preprint, so no screen attributes it to them.)
 *
 * WHAT A RESEARCHER NEEDS FROM IT
 *   The rank is against all ~9 billion possible SNVs, most of them non-coding, and two of the inputs
 *   (AlphaMissense, conservation) are the same evidence the Predictors tab already reads. A missense
 *   change can therefore rank in the top 1% on evidence this workspace has already shown. So the
 *   model splits the score by origin — "new from AlphaGenome" (the ten molecular predictions) versus
 *   "already read elsewhere" — and the finding leads with that split. The previous finding only
 *   warned about overlap when AlphaMissense was the single largest group, so a conservation-led score
 *   (NAE1 p.Asp116Gly: 51% conservation, 26% AlphaMissense) never said 77% of it was re-read evidence.
 *
 * INVARIANTS
 *   • Absent is not zero: an unattributed feature is `null`, a measured 0 is 0.
 *   • `acmgStrength` on the payload is never read. It is an app-defined banding of the rank.
 *   • An Atlas deep link is only built from a coordinate whose build is known to be GRCh38.
 */
import type { AlphaGenomeAviData } from "./contracts";
import { generateAtlasUrls, parseGenomicCoordinateString, type AtlasUrls } from "./contracts";
import { resolveSourceAvailability, type EvidenceAvailability } from "./evidenceAvailability";

// ── Features ────────────────────────────────────────────────────────────────────────────────────

export type AviFeatureGroup = "molecular" | "coding" | "conservation" | "indicator";

export interface AviFeatureDef {
  id: string;
  name: string;
  group: AviFeatureGroup;
  description: string;
  /** Keys the payload may use: the raw scorer key (REST bridge) or the gRPC client's display name. */
  aliases: string[];
}

/**
 * The 18 features, in the order the Atlas feature-importance vector reports them within each group.
 * Descriptions say what the feature IS, per the Atlas preprint — not what it might imply.
 */
export const AVI_FEATURES: AviFeatureDef[] = [
  // Ten AlphaGenome modalities: each is the largest predicted effect across biosamples.
  { id: "MERGED_SPLICING", name: "Splicing", group: "molecular", description: "Predicted change in splice-site use and splice junctions.", aliases: ["fi_MERGED_SPLICING", "Splicing", "SPLICE_SITES", "SPLICE_JUNCTIONS"] },
  { id: "MAX_ABS_RNA_SEQ", name: "RNA-seq", group: "molecular", description: "Predicted change in RNA-seq expression coverage.", aliases: ["fi_MAX_ABS_RNA_SEQ", "RNA-seq", "RNA_SEQ"] },
  { id: "MAX_ABS_CAGE", name: "CAGE", group: "molecular", description: "Predicted change in transcription start-site activity (CAGE).", aliases: ["fi_CAGE", "fi_MAX_ABS_CAGE", "CAGE"] },
  { id: "MAX_ABS_PROCAP", name: "PRO-cap", group: "molecular", description: "Predicted change in transcription initiation (PRO-cap).", aliases: ["fi_PROCAP", "fi_MAX_ABS_PROCAP", "PRO-cap", "PROCAP"] },
  { id: "MAX_ABS_POLYADENYLATION", name: "Polyadenylation", group: "molecular", description: "Predicted change in polyadenylation-site use.", aliases: ["fi_POLYADENYLATION", "fi_MAX_ABS_POLYADENYLATION", "Polyadenylation", "POLYADENYLATION"] },
  { id: "MAX_ABS_ATAC", name: "ATAC-seq", group: "molecular", description: "Predicted change in chromatin accessibility (ATAC-seq).", aliases: ["fi_MAX_ABS_ATAC", "ATAC-seq", "ATAC"] },
  { id: "MAX_ABS_DNASE", name: "DNase-seq", group: "molecular", description: "Predicted change in chromatin accessibility (DNase-seq).", aliases: ["fi_DNASE", "fi_MAX_ABS_DNASE", "DNase-seq", "DNASE-seq", "DNASE"] },
  { id: "MAX_ABS_CHIP_TF", name: "TF binding", group: "molecular", description: "Predicted change in transcription-factor binding (TF ChIP-seq).", aliases: ["fi_CHIP_TF", "fi_MAX_ABS_CHIP_TF", "ChIP-TF", "CHIP_TF"] },
  { id: "MAX_ABS_CHIP_HISTONE", name: "Histone marks", group: "molecular", description: "Predicted change in histone-mark signal (histone ChIP-seq).", aliases: ["fi_MAX_ABS_CHIP_HISTONE", "ChIP-Histone", "CHIP_HISTONE"] },
  { id: "MAX_ABS_CONTACT_MAPS", name: "3D contacts", group: "molecular", description: "Predicted change in 3D chromatin contacts (contact maps).", aliases: ["fi_CONTACT_MAPS", "fi_MAX_ABS_CONTACT_MAPS", "3D Genome Contacts", "CONTACT_MAPS"] },

  // AlphaMissense: a separate model, fed in as one feature.
  { id: "ALPHAMISSENSE", name: "AlphaMissense", group: "coding", description: "The AlphaMissense score for this substitution — a separate predictor, fed in as a feature.", aliases: ["fi_ALPHAMISSENSE", "AlphaMissense"] },

  // Conservation.
  { id: "CACTUS_241_WAY", name: "Cactus 241-way", group: "conservation", description: "Conservation across the Zoonomia 241-mammal alignment.", aliases: ["fi_CACTUS_241_WAY", "Cactus", "Cactus (241-way)"] },
  { id: "PHASTCONS_470_WAY", name: "PhastCons 470-way", group: "conservation", description: "Conservation across the 470-mammal alignment.", aliases: ["fi_PHASTCONS_470_WAY", "PhastCons 470", "PHASTCONS_470_WAY"] },

  // Indicators: set by the variant's type, not predicted.
  { id: "PROTEIN_TERMINATION", name: "Stop gained / frameshift", group: "indicator", description: "VEP indicator.", aliases: ["fi_PROTEIN_TERMINATION", "Protein Termination", "PROTEIN_TERMINATION"] },
  { id: "START_LOST", name: "Start lost", group: "indicator", description: "VEP indicator.", aliases: ["fi_START_LOST", "Start Lost", "START_LOST"] },
  { id: "STOP_LOST", name: "Stop lost", group: "indicator", description: "VEP indicator.", aliases: ["fi_STOP_LOST", "Stop Lost", "STOP_LOST"] },
  { id: "IS_INSERTION", name: "Insertion", group: "indicator", description: "Indel indicator.", aliases: ["fi_IS_INSERTION", "Insertion", "IS_INSERTION"] },
  { id: "IS_DELETION", name: "Deletion", group: "indicator", description: "Indel indicator.", aliases: ["fi_IS_DELETION", "Deletion", "IS_DELETION"] },
];

export const AVI_GROUP_ORDER: AviFeatureGroup[] = ["molecular", "coding", "conservation", "indicator"];

export const AVI_GROUP_LABEL: Record<AviFeatureGroup, string> = {
  molecular: "Predicted molecular effects",
  coding: "Missense predictor",
  conservation: "Conservation",
  indicator: "Variant-type indicators",
};

/**
 * Where each group's evidence already appears in this workspace. The Predictors tab reads phyloP and
 * GERP, not Cactus 241-way or PhastCons 470-way: the same kind of evidence, not the same scores.
 */
export const AVI_GROUP_NOTE: Record<AviFeatureGroup, string> = {
  molecular: "largest predicted effect across biosamples",
  coding: "also a voting tool on the Predictors tab",
  conservation: "same kind of evidence as phyloP and GERP; constraint, not mechanism",
  indicator: "fixed by the variant type, not predicted",
};

/** New evidence (AlphaGenome's own predictions) versus evidence this workspace already reads. */
export type AviOrigin = "new" | "reused";
export const AVI_ORIGIN: Record<AviFeatureGroup, AviOrigin> = {
  molecular: "new",
  coding: "reused",
  conservation: "reused",
  indicator: "reused",
};
export const AVI_ORIGIN_LABEL: Record<AviOrigin, string> = {
  new: "New from AlphaGenome",
  reused: "Already read elsewhere",
};
export const AVI_ORIGIN_NOTE: Record<AviOrigin, string> = {
  new: "its ten predicted molecular effects",
  reused: "the same evidence as the Predictors tab, not independent of it",
};

/** Short names for the composition bar and sentence. */
export const AVI_GROUP_SHORT: Record<AviFeatureGroup, string> = {
  molecular: "new from AlphaGenome",
  coding: "AlphaMissense",
  conservation: "conservation",
  indicator: "variant type",
};

// ── Reading ─────────────────────────────────────────────────────────────────────────────────────

export interface AviFeatureReading extends AviFeatureDef {
  /** Signed SHAP contribution, or null when the payload did not attribute this feature. */
  shap: number | null;
  /** |shap| as a fraction of the summed |shap| over all 18, or null when unattributed / total is 0. */
  share: number | null;
}

export interface AviGroupReading {
  group: AviFeatureGroup;
  rows: AviFeatureReading[];
  /** Summed |shap| of the group as a fraction of the total, or null when nothing is attributed. */
  share: number | null;
}

export interface AviOriginReading {
  origin: AviOrigin;
  /** Largest |contribution| first, unattributed last. */
  rows: AviFeatureReading[];
  share: number | null;
}

export interface AviAtlasTarget {
  urls: AtlasUrls;
  /** "chr20:23369727 C>T" */
  label: string;
  /** Where the coordinate came from, for the rail. */
  origin: "queried" | "grch38-input" | "lifted";
}

export interface AlphaGenomeEvidence {
  availability: EvidenceAvailability;
  assessed: boolean;
  phred: number | null;
  quantile: number | null;
  raw: number | null;
  /** Percentage of all possible SNVs scoring at least this high (e.g. 0.229). */
  topPercent: number | null;
  /** "1 in N" form of the same rank. */
  oneIn: number | null;
  /** Null when no feature vector arrived (distinct from an all-zero vector). */
  groups: AviGroupReading[] | null;
  totalAbs: number | null;
  largest: AviFeatureReading | null;
  dominantGroup: AviGroupReading | null;
  /** The score split by origin, new first; null when no feature vector arrived. */
  origins: AviOriginReading[] | null;
  /** Share of the summed |contribution| from AlphaGenome's own predictions. */
  newShare: number | null;
  /** The largest non-zero AlphaGenome molecular contribution. */
  largestMolecular: AviFeatureReading | null;
  splicing: AviFeatureReading | null;
  atlas: AviAtlasTarget | null;
  /** Gene-level Atlas search, when no GRCh38 coordinate is known. */
  atlasSearchUrl: string;
}

const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function extractShap(def: AviFeatureDef, attributions: Record<string, number> | null): number | null {
  if (!attributions) return null;
  for (const key of [def.id, def.name, ...def.aliases]) {
    const v = attributions[key];
    if (key in attributions && Number.isFinite(v)) return v;
  }
  return null;
}

/** "chr20:23369727:C%3ET" → coordinate, from the payload's own Atlas URL (the locus actually queried). */
function coordinateFromAtlasUrl(url: string | null | undefined) {
  if (!url) return null;
  const m = /[?&]v=([^&]+)/.exec(url);
  if (!m) return null;
  const decoded = decodeURIComponent(m[1]); // chr20:23369727:C>T
  const parts = /^(chr[\w]+):(\d+):([ACGT]+)>([ACGT]+)$/i.exec(decoded);
  if (!parts) return null;
  return { chrom: parts[1], pos: Number(parts[2]), ref: parts[3].toUpperCase(), alt: parts[4].toUpperCase() };
}

/**
 * The GRCh38 coordinate to deep-link, or null. The Atlas indexes hg38 only, so an hg19 position
 * handed to it opens a different locus — the wrong-locus hazard `assembly.ts` exists to prevent.
 */
function resolveAtlasTarget(result: any, alphagenome: AlphaGenomeAviData | null): AviAtlasTarget | null {
  const make = (c: { chrom: string; pos: number; ref: string; alt: string }, origin: AviAtlasTarget["origin"]): AviAtlasTarget => {
    const chrom = c.chrom.toLowerCase().startsWith("chr") ? c.chrom : `chr${c.chrom}`;
    return { urls: generateAtlasUrls(chrom, c.pos, c.ref, c.alt), label: `${chrom}:${c.pos} ${c.ref}>${c.alt}`, origin };
  };

  const queried = coordinateFromAtlasUrl(alphagenome?.atlasUrl);
  if (queried) return make(queried, "queried");

  const pd = result?.predictorData;
  if (pd?.gnomadVariantAssembly === "GRCh38") {
    const c = parseGenomicCoordinateString(pd.gnomadVariantId);
    if (c) return make(c, "grch38-input");
  }

  const md = result?.metadata;
  if (md?.resolvedAssembly === "GRCh38" && md?.liftedGenomicCoordinates) {
    const c = parseGenomicCoordinateString(md.liftedGenomicCoordinates);
    if (c) return make(c, "lifted");
  }
  if (md?.assembly === "GRCh38" && md?.genomicCoordinates) {
    const c = parseGenomicCoordinateString(md.genomicCoordinates);
    if (c) return make(c, "grch38-input");
  }
  return null;
}

export function buildAlphaGenomeEvidence({
  result,
  configured,
}: {
  result: any;
  /** Whether the browser holds a key. `undefined` = cannot know (the server may hold one). */
  configured?: boolean;
}): AlphaGenomeEvidence {
  const alphagenome: AlphaGenomeAviData | null = result?.conservationData?.alphagenome ?? null;
  const availability = resolveSourceAvailability({
    source: "alphagenome",
    refusals: result?.conservationData?.assemblyRefusals ?? null,
    value: alphagenome?.aviPhred ?? null,
    status: alphagenome?.status ?? null,
    configured,
    message: alphagenome?.message ?? null,
  });
  const assessed = availability.state === "available";

  const phred = assessed ? finite(alphagenome?.aviPhred) : null;
  const quantile = assessed ? finite(alphagenome?.aviQuantile) : null;
  const raw = assessed ? finite(alphagenome?.aviRaw) : null;
  const topPercent = !assessed
    ? null
    : finite(alphagenome?.topPercentile) ?? (phred !== null && phred >= 0 ? Math.pow(10, -phred / 10) * 100 : null);
  const oneIn = topPercent !== null && topPercent > 0 ? Math.round(100 / topPercent) : null;

  const attributions = assessed ? (alphagenome?.featureAttributions ?? null) : null;

  let groups: AviGroupReading[] | null = null;
  let totalAbs: number | null = null;
  let largest: AviFeatureReading | null = null;
  let dominantGroup: AviGroupReading | null = null;
  let origins: AviOriginReading[] | null = null;
  let largestMolecular: AviFeatureReading | null = null;

  const rowsAll: AviFeatureReading[] = AVI_FEATURES.map(def => ({ ...def, shap: extractShap(def, attributions), share: null }));

  if (attributions) {
    totalAbs = rowsAll.reduce((s, r) => s + (r.shap === null ? 0 : Math.abs(r.shap)), 0);
    for (const r of rowsAll) r.share = r.shap === null || totalAbs === 0 ? null : Math.abs(r.shap) / totalAbs;

    groups = AVI_GROUP_ORDER.map(group => {
      const rows = rowsAll
        .filter(r => r.group === group)
        // Largest first; unattributed last; stable within ties (declared order).
        .sort((a, b) => {
          if (a.shap === null && b.shap === null) return 0;
          if (a.shap === null) return 1;
          if (b.shap === null) return -1;
          return Math.abs(b.shap) - Math.abs(a.shap);
        });
      const attributed = rows.some(r => r.shap !== null);
      const sum = rows.reduce((s, r) => s + (r.shap === null ? 0 : Math.abs(r.shap)), 0);
      return { group, rows, share: attributed && totalAbs ? sum / totalAbs : null };
    });

    if (totalAbs > 0) {
      for (const r of rowsAll) {
        if (r.shap === null || r.shap === 0) continue;
        if (!largest || Math.abs(r.shap) > Math.abs(largest.shap as number)) largest = r;
      }
      for (const g of groups) {
        if (g.share === null) continue;
        if (!dominantGroup || g.share > (dominantGroup.share as number)) dominantGroup = g;
      }
    }
  }

  if (groups) {
    const byMagnitude = (a: AviFeatureReading, b: AviFeatureReading) => {
      if (a.shap === null && b.shap === null) return 0;
      if (a.shap === null) return 1;
      if (b.shap === null) return -1;
      return Math.abs(b.shap) - Math.abs(a.shap);
    };
    origins = (["new", "reused"] as AviOrigin[]).map(origin => {
      const members = groups!.filter(g => AVI_ORIGIN[g.group] === origin);
      const rows = members.flatMap(g => g.rows).sort(byMagnitude);
      const attributed = members.some(g => g.share !== null);
      return { origin, rows, share: attributed ? members.reduce((s, g) => s + (g.share ?? 0), 0) : null };
    });
    largestMolecular =
      origins[0].rows.find(r => r.shap !== null && r.shap !== 0) ?? null;
  }

  const splicing = attributions ? rowsAll.find(r => r.id === "MERGED_SPLICING") ?? null : null;
  const gene = result?.metadata?.gene ?? "";

  return {
    availability,
    assessed,
    phred,
    quantile,
    raw,
    topPercent,
    oneIn,
    groups,
    totalAbs,
    largest,
    dominantGroup,
    origins,
    newShare: origins ? origins[0].share : null,
    largestMolecular,
    splicing,
    atlas: resolveAtlasTarget(result, alphagenome),
    atlasSearchUrl: `https://deepmind.google.com/science/alphagenome/atlas/variant?q=${encodeURIComponent(gene)}`,
  };
}

// ── Words ───────────────────────────────────────────────────────────────────────────────────────

export function fmtSigned(v: number, digits = 3): string {
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}`;
}

export function fmtPercent(p: number): string {
  if (p >= 10) return `${p.toFixed(0)}%`;
  if (p >= 1) return `${p.toFixed(1)}%`;
  if (p >= 0.01) return `${Number(p.toPrecision(2))}%`;
  return `${p.toExponential(1)}%`;
}

export function fmtShare(s: number): string {
  const pct = s * 100;
  if (pct > 0 && pct < 1) return "<1%";
  return `${Math.round(pct)}%`;
}

/**
 * The finding: a bold headline saying where the score comes from, and one sentence with the split.
 * Returns null when no feature vector arrived — the tab states that absence on its own line.
 */
export function aviFinding(ev: AlphaGenomeEvidence): { headline: string; detail: string } | null {
  if (!ev.groups || !ev.origins) return null;
  if (!ev.largest || ev.totalAbs === null || ev.totalAbs === 0) {
    return { headline: "No feature contributed to the score.", detail: "Every attribution is zero." };
  }
  const newShare = ev.newShare ?? 0;
  const reused = ev.groups
    .filter(g => AVI_ORIGIN[g.group] === "reused" && g.share !== null && g.share >= 0.005)
    .sort((a, b) => (b.share as number) - (a.share as number));
  const reusedShare = 1 - newShare;
  const reusedList = reused.map(g => `${AVI_GROUP_SHORT[g.group]} (${fmtShare(g.share as number)})`);
  const joined =
    reusedList.length <= 1 ? reusedList.join("") : `${reusedList.slice(0, -1).join(", ")} and ${reusedList[reusedList.length - 1]}`;
  const lm = ev.largestMolecular;
  // Common nouns read lower-case mid-sentence; assay names (CAGE, RNA-seq, TF binding) keep theirs.
  const lmName = lm ? (/^(Splicing|Polyadenylation|Histone marks)$/.test(lm.name) ? lm.name.toLowerCase() : lm.name) : "";
  const led = lm ? `, led by ${lmName} (${fmtSigned(lm.shap as number)})` : "";

  if (newShare >= 0.5) {
    return {
      headline: "Mostly AlphaGenome's own predictions.",
      detail:
        `${fmtShare(newShare)} of the score comes from AlphaGenome's predicted molecular effects${led}.` +
        (reused.length ? ` The rest comes from ${joined}, which the Predictors tab already reflects.` : ""),
    };
  }
  return {
    headline: "Mostly evidence this workspace already reads.",
    detail:
      `${fmtShare(reusedShare)} of the score comes from ${joined}, which the Predictors tab already reflects. ` +
      (newShare === 0 || !lm
        ? "AlphaGenome's own molecular predictions add nothing to it."
        : `AlphaGenome's own molecular predictions add ${fmtShare(newShare)}${led}.`),
  };
}

/**
 * The rank decade a Phred falls in, for surfaces that shade many scores at once (the saturation
 * heatmap, the Landscape inspector). Level 0 = below the top 10%, 4 = top 0.01% or rarer. These are
 * the decades of the Phred definition itself, not evidence thresholds: they replaced the app-defined
 * "PP3 Strong ≥ 35 … BP4 Moderate ≤ 5" bands those surfaces drew, which no ClinGen calibration backs.
 */
export function aviRankBand(phred: number | null | undefined): { level: 0 | 1 | 2 | 3 | 4; label: string } | null {
  if (phred === null || phred === undefined || !Number.isFinite(phred) || phred < 0) return null;
  if (phred >= 40) return { level: 4, label: "top 0.01%" };
  if (phred >= 30) return { level: 3, label: "top 0.1%" };
  if (phred >= 20) return { level: 2, label: "top 1%" };
  if (phred >= 10) return { level: 1, label: "top 10%" };
  return { level: 0, label: "below the top 10%" };
}

/** Phred → rank reference rows for the rail. */
export const PHRED_RANK_ROWS: Array<{ phred: number; top: string }> = [
  { phred: 10, top: "top 10%" },
  { phred: 20, top: "top 1%" },
  { phred: 30, top: "top 0.1%" },
  { phred: 40, top: "top 0.01%" },
];

export const ALPHAGENOME_SOURCES = [
  {
    citation: "Cheng J, Taylor KR, et al. AlphaGenome Atlas: in silico mutagenesis of the entire human genome. medRxiv 2026 (preprint).",
    doi: "10.64898/2026.09.16.26363192",
  },
  {
    citation: "Avsec Ž, et al. AlphaGenome: advancing regulatory variant effect prediction with a unified DNA sequence model. bioRxiv 2025.",
    doi: "10.1101/2025.06.25.661532",
  },
  {
    citation: "Cheng J, et al. Accurate proteome-wide missense variant effect prediction with AlphaMissense. Science 2023;381:eadg7492.",
    doi: "10.1126/science.adg7492",
  },
];
