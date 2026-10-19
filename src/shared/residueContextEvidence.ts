/**
 * residueContextEvidence.ts — the one model the Residue Shifts & Pockets tab and its inspector
 * rail both render.
 *
 * The tab used to derive its cards from three places (the contrast model, the burial model and the
 * pocket narrative) and the inspector re-derived its own copy, so the two panes printed different
 * pocket distances for one variant (22.97 Å "to pocket centroid" in the tab, 23.14 Å "from the
 * cavity centre" in the rail). This module composes the three once; both panes read it.
 *
 * INVARIANTS
 *   - No ACMG code is drawn from this evidence; the engine record says so.
 *   - Property values are the published scales in `residueScales.ts`, printed in native units.
 *   - Burial is a word only when accessibility was measured. The Cα count is a reading beside it.
 *   - The pocket has one distance (the cavity centre when reported) and one score format.
 *   - Every cut-point listed is the app's own and is labelled local.
 *
 * Defects it replaced: a hand-made property table cited as Kyte–Doolittle / vdW / IUPAC; a burial
 * word banded from an unsourced Cα count; a constant "likely co-factor" presented as a lookup; a
 * "top 8" pocket-residue list ordered by a hidden weight; raw engine codes (`DISTAL_SURFACE`) and
 * legacy state words ("Standby", "Model offline") on screen.
 *
 * Pure: no React, no fetching.
 */

import { BURIAL_RSA_BANDS, deriveBurialEvidence, type BurialEvidence } from "./burialEvidence.ts";
import { PDB_SOURCE_ALPHAFOLD, PDB_SOURCE_RCSB, isPdbSource } from "./contracts.ts";
import {
  RESIDUE_SCALE_SOURCES,
  formatNativeResidueValue,
  granthamDistance,
  nativeResidueValue,
  normaliseResidueValue,
  type ResidueScaleKey,
} from "./residueScales.ts";
import { diffSideChains, type SideChainDiff } from "./sideChainTopology.ts";
import {
  POCKET_PROXIMITY_BANDS,
  SHIFT_MAGNITUDE_BANDS,
  rankContrastRowsByMagnitude,
  type BiochemicalContrast,
  type BiochemicalContrastRow,
  type PocketNarrative,
  type PocketProximityBand,
} from "./residueShiftEvidence.ts";
export type { BiochemicalContrastRow } from "./residueShiftEvidence.ts";
import { ENGINE_STATE_LABELS } from "./engineStatus.ts";

/** A four-character PDB entry id, e.g. `1ABC` — the only id shape "RCSB PDB" may be fused to. */
const PDB_ENTRY_ID = /^[0-9][A-Za-z0-9]{3}$/;

/**
 * Name the structure these numbers came from, or say plainly that it is unnamed.
 *
 * The id is fused to a provenance label only when the two agree: a PDB-shaped id with RCSB PDB,
 * or a non-PDB-shaped id with AlphaFold. AlphaFold payloads carry no id (`core-data-fetcher` sets
 * `resolvedPdbId` only from a PDB mapping), so the predicted case has its own sentence.
 */
export function describeStructureSource(pdbId?: string | null, pdbSource?: string | null): string {
  const id = typeof pdbId === "string" && pdbId.trim() ? pdbId.trim() : null;
  const source = isPdbSource(pdbSource) ? pdbSource : null;

  if (source === PDB_SOURCE_ALPHAFOLD) {
    return id && !PDB_ENTRY_ID.test(id) ? `the AlphaFold model ${id}` : "an AlphaFold model of this protein";
  }
  if (source === PDB_SOURCE_RCSB) {
    if (id && PDB_ENTRY_ID.test(id)) return `experimental structure ${id} (RCSB PDB)`;
    return id ? `structure ${id}` : "an experimental structure (RCSB PDB)";
  }
  return id ? `structure ${id}` : "the structure used for this analysis";
}

/** Grantham distance classes, Li, Wu and Luo 1984. */
export type GranthamClass = "conservative" | "moderately conservative" | "moderately radical" | "radical";

export function granthamClass(distance: number): GranthamClass {
  if (distance <= 50) return "conservative";
  if (distance <= 100) return "moderately conservative";
  if (distance <= 150) return "moderately radical";
  return "radical";
}

/**
 * What the four scales cannot see: glycine and proline act on the backbone, not through the side
 * chain. Asp→Gly is exactly that case, and the tab used to say nothing about it.
 */
export function backboneCaveat(wildTypeCode: string, mutantCode: string): { title: string; body: string } | null {
  const wt = wildTypeCode.toUpperCase();
  const mut = mutantCode.toUpperCase();
  if (wt === mut) return null;
  if (mut === "G") {
    return {
      title: "Not on these scales: glycine frees the backbone.",
      body: "Losing the Cβ lets the chain take conformations other residues cannot, which can matter in a helix or a tight turn.",
    };
  }
  if (mut === "P") {
    return {
      title: "Not on these scales: proline locks the backbone.",
      body: "Its ring fixes the φ angle and removes a backbone hydrogen-bond donor, which disrupts helices and strands.",
    };
  }
  if (wt === "G") {
    return {
      title: "Not on these scales: the glycine was flexible.",
      body: "Any side chain restricts the backbone conformations glycine allowed, which matters where the fold needs them.",
    };
  }
  if (wt === "P") {
    return {
      title: "Not on these scales: the proline fixed the backbone.",
      body: "Losing its ring releases a constrained φ angle, which can matter in a turn or a polyproline stretch.",
    };
  }
  return null;
}

export interface ResidueContextInput {
  wildTypeCode: string;
  mutantCode: string;
  wildTypeLabel: string;
  mutantLabel: string;
  wildTypeName?: string | null;
  mutantName?: string | null;
  position: number | null;
  contrast: BiochemicalContrast | null;
  scalesLoading?: boolean;
  /** `result.disruptionPredictor`, or null when the structure step returned nothing. */
  disruption?: {
    burialStatus?: string | null;
    neighborCount?: number | null;
    rsa?: number | null;
    sasaUnavailableReason?: string | null;
  } | null;
  pdbId?: string | null;
  pdbSource?: string | null;
  chain?: string | null;
  pocket: PocketNarrative;
}

export type TraceState = "done" | "warn" | "idle";

export interface ResidueContextFact {
  label: string;
  value: string;
  sub: string;
  mono?: boolean;
  /** Render the value as a dashed "unconfirmed" chip. */
  dashed?: boolean;
}

export interface ResidueContextStep {
  label: string;
  value: string;
  sub: string | null;
  state: TraceState;
}

export interface ResidueContextCut {
  group: string;
  rule: string;
  active: boolean;
  /** Short reason the row is marked, e.g. "this variant". */
  here: string | null;
}

/**
 * One tick on a published scale: every residue sharing a native value, other than the pair.
 * Merged by value so a three-valued scale (net charge) draws three ticks, not twenty.
 */
export interface ScaleTick {
  /** Position on the scale, 0–100. */
  position: number;
  /** Native value, formatted with the scale's precision and a true minus sign. */
  native: string;
  /** One-letter codes sharing this value, alphabetical. */
  codes: string[];
}

export interface PocketStripResidue {
  index: number;
  chain: string | null;
  /** e.g. "Leu131". */
  label: string;
  /** Å from the variant residue's centroid to this residue's centroid. */
  distance: number;
  /** Position on the axis, 0–100. */
  position: number;
  /** Row the label sits in, so neighbouring labels do not overprint. */
  lane: number;
}

/**
 * The pocket distance drawn as one axis: the variant residue at 0, the app's own marks, the
 * reference the tab's distance is measured to, and the pocket's residues nearest first. All
 * distances start at the variant residue's centroid, so they share a frame.
 */
export interface PocketStrip {
  /** Axis end in Å; stretched to contain every marker, never fewer than 20. */
  max: number;
  /** The app's own cut-points, in Å. */
  marks: number[];
  /** What the distances start from, e.g. "residue 116". */
  origin: string;
  /** The distance the tab prints and bands, and what it is measured to. */
  centre: { distance: number; reference: string; position: number } | null;
  residues: PocketStripResidue[];
  lanes: number;
}

/** Percentage points of axis a residue label needs before the next may share its lane. */
export const POCKET_STRIP_LABEL_GAP = 10;

/**
 * Greedy lane assignment for labels on one axis. `positions` are 0–100 and ascending; each label
 * takes the first lane whose last label is at least `minGap` away, else opens a new lane.
 */
export function assignLanes(positions: readonly number[], minGap: number): number[] {
  const lastInLane: number[] = [];
  return positions.map(position => {
    const free = lastInLane.findIndex(last => position - last >= minGap);
    const lane = free === -1 ? lastInLane.length : free;
    lastInLane[lane] = position;
    return lane;
  });
}

const STANDARD_RESIDUES = "ACDEFGHIKLMNPQRSTVWY";

function buildScaleContext(wildTypeCode: string, mutantCode: string): Record<ResidueScaleKey, ScaleTick[]> {
  const pair = new Set([wildTypeCode.toUpperCase(), mutantCode.toUpperCase()]);
  const out = {} as Record<ResidueScaleKey, ScaleTick[]>;
  for (const key of Object.keys(RESIDUE_SCALE_SOURCES) as ResidueScaleKey[]) {
    const byValue = new Map<number, string[]>();
    for (const code of STANDARD_RESIDUES) {
      if (pair.has(code)) continue;
      const value = nativeResidueValue(key, code);
      if (value === null) continue;
      byValue.set(value, [...(byValue.get(value) ?? []), code]);
    }
    out[key] = [...byValue.entries()]
      .map(([value, codes]) => ({
        position: normaliseResidueValue(key, value),
        native: formatNativeResidueValue(key, value),
        codes: [...codes].sort(),
      }))
      .sort((a, b) => a.position - b.position);
  }
  return out;
}

export interface ResidueContextEvidence {
  pair: {
    wildType: string;
    mutant: string;
    wildTypeName: string | null;
    mutantName: string | null;
    position: number | null;
    grantham: number | null;
    granthamClass: string | null;
  };
  /** Rows largest shift first; null while the scales are unresolved. */
  properties: BiochemicalContrastRow[] | null;
  propertiesState: "ready" | "loading" | "unavailable";
  /** Which side-chain atoms the substitution keeps, loses and gains; null for a non-standard pair. */
  glyph: SideChainDiff | null;
  /** The other residues on each published scale, for reading the pair against the alphabet. */
  scaleContext: Record<ResidueScaleKey, ScaleTick[]>;
  backbone: { title: string; body: string } | null;
  burial: (BurialEvidence & { structure: string; reason: string | null }) | null;
  pocket: PocketNarrative;
  /** The pocket distance axis with the cavity reference and the pocket's residues; null until a result. */
  pocketStrip: PocketStrip | null;
  finding: { headline: string; detail: string };
  facts: ResidueContextFact[];
  trace: ResidueContextStep[];
  cuts: ResidueContextCut[];
  notes: string[];
  sources: { citation: string; doi: string }[];
}

const PROXIMITY_PHRASE: Record<PocketProximityBand, (d: string) => string> = {
  lining: () => "on the wall of a predicted pocket",
  proximal: d => `${d} from a predicted pocket`,
  peripheral: d => `on the rim of a predicted pocket, ${d} away`,
  distal: d => `${d} from the nearest predicted pocket`,
  unknown: () => "at an unmapped distance from any pocket",
};

function formatAngstrom(value: number): string {
  return `${value.toFixed(1)} Å`;
}

function joinClauses(rows: BiochemicalContrastRow[]): string {
  const predicates = rows.map(row => row.changePredicate);
  if (predicates.length === 0) return "";
  if (predicates.length === 1) return predicates[0];
  return `${predicates.slice(0, -1).join(", ")} and ${predicates[predicates.length - 1]}`;
}

export function buildResidueContextEvidence(input: ResidueContextInput): ResidueContextEvidence {
  const { contrast, pocket } = input;
  const grantham = granthamDistance(input.wildTypeCode, input.mutantCode);
  const ranked = contrast ? rankContrastRowsByMagnitude(contrast.rows) : null;
  const headlineRow = contrast?.headlineRow ?? null;

  let propertiesState: ResidueContextEvidence["propertiesState"] = "ready";
  if (!contrast) propertiesState = input.scalesLoading ? "loading" : "unavailable";

  // ── Burial ──
  const d = input.disruption;
  const hasBurialData =
    !!d && (d.burialStatus != null || d.neighborCount != null || d.rsa != null || !!d.sasaUnavailableReason);
  const structure = describeStructureSource(input.pdbId, input.pdbSource);
  const burial = hasBurialData
    ? {
        ...deriveBurialEvidence({ burialStatus: d!.burialStatus, neighbourCount: d!.neighborCount, rsa: d!.rsa }),
        structure,
        reason: d!.rsa == null ? d!.sasaUnavailableReason?.trim() || "The accessibility step did not run for this variant." : null,
      }
    : null;

  // ── Pocket strip ──
  const distance = pocket.status === "success" ? pocket.proximity.distance : null;
  const pocketMarks = [POCKET_PROXIMITY_BANDS.lining, POCKET_PROXIMITY_BANDS.proximal, POCKET_PROXIMITY_BANDS.peripheral];
  let pocketStrip: PocketStrip | null = null;
  if (pocket.status === "success") {
    const nearest = pocket.lining.byDistance.slice(0, 8);
    const farthest = Math.max(distance ?? 0, ...nearest.map(r => r.distance));
    const max = Math.max(20, Math.ceil(farthest / 5) * 5);
    const at = (value: number) => Math.max(0, Math.min(100, (value / max) * 100));
    const positions = nearest.map(r => at(r.distance));
    const lanes = assignLanes(positions, POCKET_STRIP_LABEL_GAP);
    pocketStrip = {
      max,
      marks: pocketMarks,
      origin: input.position ? `residue ${input.position}` : "the variant residue",
      centre: distance === null ? null : { distance, reference: pocket.proximity.reference, position: at(distance) },
      residues: nearest.map((r, i) => ({
        index: r.index,
        chain: r.chain ?? null,
        label: `${r.name.charAt(0)}${r.name.slice(1).toLowerCase()}${r.index}`,
        distance: r.distance,
        position: positions[i],
        lane: lanes[i],
      })),
      lanes: lanes.length === 0 ? 0 : Math.max(...lanes) + 1,
    };
  }

  // ── Finding ──
  const large = (ranked ?? []).filter(row => row.magnitude === "marked").slice(0, 2);
  const leadRows = large.length > 0 ? large : headlineRow ? [headlineRow] : [];
  const propertyClause = leadRows.length > 0 ? `The side chain ${joinClauses(leadRows)}` : null;
  const pocketClause =
    pocket.status === "success"
      ? PROXIMITY_PHRASE[pocket.proximity.band](distance === null ? "" : formatAngstrom(distance))
      : null;

  let headline: string;
  if (propertyClause && pocketClause) headline = `${propertyClause}, ${pocketClause}.`;
  else if (propertyClause) headline = `${propertyClause}.`;
  else if (pocketClause) headline = `The residue sits ${pocketClause}.`;
  else headline = "No property, burial or pocket reading is available for this substitution yet.";

  const detailParts: string[] = [];
  if (burial) {
    if (burial.status === "undetermined") {
      detailParts.push("Burial was not measured, because the accessibility step did not run.");
    } else {
      detailParts.push(
        `The residue reads as ${burial.label.toLowerCase()} at ${burial.indicators.rsa.valueLabel} relative accessibility.`
      );
    }
  } else {
    detailParts.push("No structure reading was returned for this residue.");
  }
  if (pocket.status !== "success" && pocket.status !== "loading") {
    detailParts.push(`${pocket.headline}.`);
  }

  // ── Facts ──
  const facts: ResidueContextFact[] = [
    headlineRow
      ? {
          label: "Largest shift",
          value: headlineRow.label,
          sub:
            headlineRow.wildTypeNative !== null
              ? `${headlineRow.wildTypeNative} → ${headlineRow.mutantNative}${headlineRow.unit ? ` ${headlineRow.unit}` : ""}`
              : `${headlineRow.deltaLabel} points`,
          mono: false,
        }
      : { label: "Largest shift", value: propertiesState === "loading" ? ENGINE_STATE_LABELS.running : "None", sub: propertiesState === "ready" ? "No axis moves" : "Scales not resolved" },
    burial && burial.status !== "undetermined"
      ? { label: "Burial", value: burial.label, sub: `${burial.indicators.rsa.valueLabel} relative accessibility` }
      : { label: "Burial", value: "Not measured", sub: burial?.indicators.packing.valueLabel ? `${burial.indicators.packing.valueLabel} Cα neighbours, a reading only` : "No structure reading" },
    distance !== null
      ? {
          label: "Nearest pocket",
          value: formatAngstrom(distance),
          sub: `From ${pocket.proximity.reference}`,
          mono: true,
        }
      : { label: "Nearest pocket", value: pocket.badge || ENGINE_STATE_LABELS["no-result"], sub: pocket.status === "loading" ? "P2Rank is running" : "No distance reported" },
    // The engine record is stated by the eyebrow, the "Informational" chip and the last trace step;
    // a fourth fact slot says how much to trust the pocket instead. Named as the table names it:
    // P2Rank calls this number a probability, and a rescaled raw score must not wear that word.
    pocket.status === "success" && pocket.ranking.display
      ? {
          label: pocket.ranking.kind === "probability" ? "Ligand-site probability" : "P2Rank score",
          value: pocket.ranking.display,
          sub: pocket.ranking.kind === "probability" ? "P2Rank, this profile only" : "P2Rank score, not a probability",
          mono: true,
        }
      : { label: "Ligand-site probability", value: pocket.status === "loading" ? ENGINE_STATE_LABELS.running : ENGINE_STATE_LABELS["no-result"], sub: "No P2Rank score reported" },
  ];

  // ── Trace ──
  const burialStep: ResidueContextStep = !burial
    ? { label: "Burial", value: "No structure reading", sub: null, state: "idle" }
    : burial.status === "undetermined"
      ? {
          label: "Burial",
          value: "Not measured",
          sub: [burial.reason, burial.staleWord].filter(Boolean).join(" "),
          state: "warn",
        }
      : {
          label: "Burial",
          value: `${burial.label}, ${burial.indicators.rsa.valueLabel} accessibility`,
          sub: burial.disagreement ?? `Measured in ${structure}.`,
          state: burial.disagreement ? "warn" : "done",
        };

  const pocketStep: ResidueContextStep =
    pocket.status === "success"
      ? {
          label: "Pocket",
          value:
            distance !== null
              ? `${formatAngstrom(distance)} from ${pocket.proximity.reference}: ${pocket.classification.label.toLowerCase()}`
              : pocket.classification.label,
          sub: pocket.ranking.profile ? `P2Rank, ${pocket.ranking.profile} profile` : "P2Rank",
          state: "done",
        }
      : { label: "Pocket", value: pocket.headline, sub: null, state: pocket.status === "loading" ? "idle" : "warn" };

  const trace: ResidueContextStep[] = [
    {
      label: "Residue pair",
      value: `${input.wildTypeLabel} → ${input.mutantLabel}${input.position ? ` at ${input.position}` : ""}`,
      sub: grantham !== null ? `Grantham distance ${grantham}, ${granthamClass(grantham)}` : null,
      state: input.wildTypeCode && input.mutantCode ? "done" : "idle",
    },
    {
      label: "Property scales",
      value: headlineRow ? `Largest shift: ${headlineRow.label.toLowerCase()}` : "No shift",
      sub: contrast ? contrast.summary : null,
      state: contrast ? "done" : "idle",
    },
    burialStep,
    pocketStep,
    { label: "Engine record", value: "No ACMG criterion reads this tab", sub: null, state: "done" },
  ];

  // ── Cut-points (all local) ──
  const shiftBand = headlineRow?.magnitude ?? null;
  const rsaBand = burial?.indicators.rsa.band ?? null;
  const proximity = pocket.status === "success" ? pocket.proximity.band : null;
  const coreMax = (BURIAL_RSA_BANDS.coreMax * 100).toFixed(0);
  const surfaceMin = (BURIAL_RSA_BANDS.surfaceMin * 100).toFixed(0);
  const cuts: ResidueContextCut[] = [
    // |delta| carries one decimal, so the lower edges are strict ("> 9") rather than "10": a 9.6 is
    // moderate. The word is the model's own ("marked"), which the tab's interpretation text uses.
    { group: "Property shift, points of 0–100", rule: `> ${SHIFT_MAGNITUDE_BANDS.moderate} marked`, active: shiftBand === "marked", here: shiftBand === "marked" ? "largest shift" : null },
    { group: "Property shift, points of 0–100", rule: `> ${SHIFT_MAGNITUDE_BANDS.slight} to ≤ ${SHIFT_MAGNITUDE_BANDS.moderate} moderate`, active: shiftBand === "moderate", here: shiftBand === "moderate" ? "largest shift" : null },
    { group: "Property shift, points of 0–100", rule: `> ${SHIFT_MAGNITUDE_BANDS.unchanged} to ≤ ${SHIFT_MAGNITUDE_BANDS.slight} slight`, active: shiftBand === "slight", here: shiftBand === "slight" ? "largest shift" : null },
    { group: "Relative accessibility", rule: `≤ ${coreMax}% core`, active: rsaBand === "core", here: rsaBand === "core" ? "this variant" : null },
    { group: "Relative accessibility", rule: `${coreMax}% to ${surfaceMin}% boundary`, active: rsaBand === "boundary", here: rsaBand === "boundary" ? "this variant" : null },
    { group: "Relative accessibility", rule: `≥ ${surfaceMin}% surface`, active: rsaBand === "surface", here: rsaBand === "surface" ? "this variant" : null },
    // classifyProximity: a pocket residue is lining whatever its distance, then ≤ 4, ≤ 8, ≤ 12 Å.
    { group: "Pocket distance", rule: `Pocket residue, or ≤ ${POCKET_PROXIMITY_BANDS.lining} Å lining`, active: proximity === "lining", here: proximity === "lining" ? "this variant" : null },
    { group: "Pocket distance", rule: `> ${POCKET_PROXIMITY_BANDS.lining} to ≤ ${POCKET_PROXIMITY_BANDS.proximal} Å near`, active: proximity === "proximal", here: proximity === "proximal" ? "this variant" : null },
    { group: "Pocket distance", rule: `> ${POCKET_PROXIMITY_BANDS.proximal} to ≤ ${POCKET_PROXIMITY_BANDS.peripheral} Å rim`, active: proximity === "peripheral", here: proximity === "peripheral" ? "this variant" : null },
    { group: "Pocket distance", rule: `> ${POCKET_PROXIMITY_BANDS.peripheral} Å distal`, active: proximity === "distal", here: proximity === "distal" ? "this variant" : null },
  ];

  const notes = [
    "A marked shift is a large move on the scale, not a large effect on this protein.",
    "Burial comes only from measured solvent accessibility; the Cα count is a reading.",
    "The pocket is computed on the structure loaded in 3D, which can differ from the one burial was measured in.",
  ];

  const sources = [
    { citation: "Grantham 1974, Science", doi: "10.1126/science.185.4154.862" },
    { citation: "Kyte and Doolittle 1982, J Mol Biol", doi: "10.1016/0022-2836(82)90515-0" },
    { citation: "Li, Wu and Luo 1984, J Mol Evol (Grantham classes)", doi: "10.1007/BF02100628" },
    { citation: "Tien et al. 2013, PLoS ONE (maximum accessibility)", doi: "10.1371/journal.pone.0080635" },
    { citation: "Krivák and Hoksza 2018, J Cheminform (P2Rank)", doi: "10.1186/s13321-018-0285-8" },
  ];

  return {
    pair: {
      wildType: input.wildTypeLabel,
      mutant: input.mutantLabel,
      wildTypeName: input.wildTypeName ?? null,
      mutantName: input.mutantName ?? null,
      position: input.position,
      grantham,
      granthamClass: grantham === null ? null : granthamClass(grantham),
    },
    properties: ranked,
    propertiesState,
    glyph: diffSideChains(input.wildTypeCode, input.mutantCode),
    scaleContext: buildScaleContext(input.wildTypeCode, input.mutantCode),
    backbone: backboneCaveat(input.wildTypeCode, input.mutantCode),
    burial,
    pocket,
    pocketStrip,
    finding: { headline, detail: detailParts.join(" ") },
    facts,
    trace,
    cuts,
    notes,
    sources,
  };
}
