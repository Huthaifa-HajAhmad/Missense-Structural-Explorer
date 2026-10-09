/**
 * landscapeEvidence.ts — the Landscape tab's reading rules, kept out of React so they can be tested.
 *
 * Three kinds of number appear on the tab and must never be confused:
 *   • a VARIANT score (the queried substitution's own REVEL / AlphaMissense);
 *   • a RESIDUE summary (mean or max over the distinct SNV-reachable missense substitutions at one
 *     residue, on one transcript);
 *   • a NUCLEOTIDE conservation score (GERP++ / phyloP), averaged over the codon's nucleotides.
 *
 * Colour for REVEL and AlphaMissense follows the ClinGen calibrated bands (`calibration.ts`). Those
 * bands were calibrated for single variants; on a residue summary they orient the eye and carry no
 * evidential weight, and the legend says so.
 */
import {
  calibratedCall,
  calibrationBands,
  formatEvidenceCode,
  CALIBRATION_SOURCES,
  PP3_BP4_CALIBRATION,
  type CalibratedToolKey
} from "./thresholds/calibration";
import type { LandscapeContext, LandscapeMeta, LandscapeResidueItem } from "./contracts";
import { AMINO_ACID_3_TO_1 } from "./aminoAcids";

export type LandscapeTool = "revel" | "alphaMissense";
export type SummaryMode = "mean" | "max";

/** Seven steps, diverging: BP4 (cool) ← indeterminate → PP3 (warm). VeryStrong folds into strong. */
export type BandKey =
  | "bp4-strong"
  | "bp4-moderate"
  | "bp4-supporting"
  | "indeterminate"
  | "pp3-supporting"
  | "pp3-moderate"
  | "pp3-strong";

export const BAND_ORDER: readonly BandKey[] = [
  "bp4-strong",
  "bp4-moderate",
  "bp4-supporting",
  "indeterminate",
  "pp3-supporting",
  "pp3-moderate",
  "pp3-strong"
];

export function bandKey(tool: LandscapeTool, value: number | null | undefined): BandKey | null {
  const call = calibratedCall(tool, value);
  if (!call) return null;
  if (!call.direction || !call.strength) return "indeterminate";
  const strength = call.strength === "VeryStrong" ? "strong" : call.strength.toLowerCase();
  return `${call.direction.toLowerCase()}-${strength}` as BandKey;
}

/** "PP3 Moderate" / "BP4" / "Indeterminate", as the calibration paper names the band. */
export function bandLabel(tool: LandscapeTool, value: number | null | undefined): string | null {
  const call = calibratedCall(tool, value);
  return call ? formatEvidenceCode(call.code) : null;
}

export interface LegendStep {
  key: BandKey;
  label: string;
  /** Human range, e.g. "≥ 0.932" or "0.644–0.773". */
  range: string;
}

const fmt = (n: number) => String(Number(n.toFixed(3)));

/** Legend rows for one tool, BP4 strongest → PP3 strongest, ranges from `calibration.ts`. */
export function legendSteps(tool: LandscapeTool): LegendStep[] {
  const bands = calibrationBands(tool);
  const cal = PP3_BP4_CALIBRATION[tool];
  const steps: LegendStep[] = [];
  const bp4 = bands.filter((b) => b.direction === "BP4").reverse();
  const pp3 = bands.filter((b) => b.direction === "PP3");
  for (const b of bp4) {
    if (b.strength === "VeryStrong") continue; // drawn in the Strong swatch
    const key = `bp4-${b.strength.toLowerCase()}` as BandKey;
    const until = b.strength === "Strong" ? null : b.until;
    steps.push({ key, label: formatEvidenceCode(b.code), range: until === null ? `≤ ${fmt(b.threshold)}` : `${fmt(until)}–${fmt(b.threshold)}` });
  }
  const bp4Edge = cal.bp4.Supporting;
  const pp3Edge = cal.pp3.Supporting;
  if (bp4Edge !== undefined && pp3Edge !== undefined) {
    steps.push({ key: "indeterminate", label: "Indeterminate", range: `${fmt(bp4Edge)}–${fmt(pp3Edge)}` });
  }
  for (const b of pp3) {
    const key = `pp3-${b.strength === "VeryStrong" ? "strong" : b.strength.toLowerCase()}` as BandKey;
    steps.push({ key, label: formatEvidenceCode(b.code), range: b.until === null ? `≥ ${fmt(b.threshold)}` : `${fmt(b.threshold)}–${fmt(b.until)}` });
  }
  return steps;
}

export function calibrationSourceShort(tool: CalibratedToolKey): string {
  return CALIBRATION_SOURCES[PP3_BP4_CALIBRATION[tool].source].short;
}

/**
 * The seven band swatches as numeric spans on [0, 1], from `calibration.ts` directly.
 *
 * The substitution strip used to re-parse the legend's *formatted* range strings
 * ("0.644–0.773", "≥ 0.932") back into geometry — an inverse of a display string that broke
 * silently the day a range was reworded. This is the one numeric source for drawing; `legendSteps`
 * stays textual for the legend. Half-open spans tile [0, 1]; a strength the source does not publish
 * (e.g. AlphaMissense BP4 Strong) gets no span, exactly as it gets no legend row.
 */
export function bandSpans(tool: LandscapeTool): Array<{ key: BandKey; lo: number; hi: number }> {
  const b = PP3_BP4_CALIBRATION[tool].bp4;
  const p = PP3_BP4_CALIBRATION[tool].pp3;
  const out: Array<{ key: BandKey; lo: number; hi: number }> = [];
  // BP4 side runs from 0 upward, strongest first; VeryStrong folds into the Strong swatch,
  // the same fold `bandKey` makes.
  const strongEdge = b.Strong ?? b.VeryStrong;
  let lo = 0;
  if (strongEdge !== undefined) {
    out.push({ key: "bp4-strong", lo: 0, hi: strongEdge });
    lo = strongEdge;
  }
  if (b.Moderate !== undefined) {
    out.push({ key: "bp4-moderate", lo, hi: b.Moderate });
    lo = b.Moderate;
  }
  const bp4Sup = b.Supporting;
  if (bp4Sup !== undefined) {
    out.push({ key: "bp4-supporting", lo, hi: bp4Sup });
    lo = bp4Sup;
  }
  // Indeterminate middle: between the two Supporting edges.
  const pp3Sup = p.Supporting;
  if (bp4Sup !== undefined && pp3Sup !== undefined) {
    out.push({ key: "indeterminate", lo: bp4Sup, hi: pp3Sup });
  } else if (pp3Sup !== undefined) {
    out.push({ key: "indeterminate", lo: 0, hi: pp3Sup });
    lo = pp3Sup;
  }
  // PP3 side runs to 1, weakest first; the strongest band holds whatever remains.
  if (pp3Sup !== undefined) {
    out.push({ key: "pp3-supporting", lo: pp3Sup, hi: p.Moderate ?? p.Strong ?? 1 });
    if (p.Moderate !== undefined) out.push({ key: "pp3-moderate", lo: p.Moderate, hi: p.Strong ?? 1 });
    if (p.Strong !== undefined) out.push({ key: "pp3-strong", lo: p.Strong, hi: 1 });
  }
  return out;
}

/**
 * Conservation shading, 0–3. The breaks are this app's display breaks, not evidence: GERP++ RS
 * 2 / 4 (Davydov 2010 read RS > 2 as constrained), phyloP100way 1.5 / 4. The only published
 * evidence bands are ClinGen's phyloP (PP3 ≥ 7.367, BP4 ≤ 1.879) — level 3 for phyloP is set at
 * that PP3 edge so the darkest step coincides with a published cut-point.
 */
export const CONSERVATION_BREAKS = {
  gerp: [2, 4, 5.5],
  phylop: [1.5, 4, PP3_BP4_CALIBRATION.phylop.pp3.Supporting as number]
} as const;

export function conservationLevel(tool: "gerp" | "phylop", value: number | null | undefined): 0 | 1 | 2 | 3 | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const [a, b, c] = CONSERVATION_BREAKS[tool];
  if (value >= c) return 3;
  if (value >= b) return 2;
  if (value >= a) return 1;
  return 0;
}

export function residueSummary(row: LandscapeResidueItem | undefined, tool: LandscapeTool, mode: SummaryMode): number | null {
  if (!row) return null;
  const v = tool === "revel" ? (mode === "mean" ? row.revelMean : row.revelMax) : mode === "mean" ? row.amMean : row.amMax;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function residueCount(row: LandscapeResidueItem | undefined, tool: LandscapeTool): number {
  if (!row) return 0;
  return (tool === "revel" ? row.revelCount : row.amCount) ?? 0;
}

export function residueRange(row: LandscapeResidueItem | undefined, tool: LandscapeTool): [number, number] | null {
  if (!row) return null;
  const lo = tool === "revel" ? row.revelMin : row.amMin;
  const hi = tool === "revel" ? row.revelMax : row.amMax;
  return typeof lo === "number" && typeof hi === "number" ? [lo, hi] : null;
}

/* ─────────────────────────── strand ─────────────────────────── */

const COMPLEMENT: Record<string, string> = { A: "T", C: "G", G: "C", T: "A" };

/** Complement of one base; anything else passes through. */
export function complementBase(base: string): string {
  return COMPLEMENT[base.toUpperCase()] ?? base;
}

/**
 * The base a reader sees for a genomic (+ strand) base. On a − strand gene the grid is drawn on
 * the CODING strand, so the reference row reads as codons (GAT, not CTA) and the substitution rows
 * are the coding-strand alt bases.
 */
export function displayBase(genomicBase: string, strand: "+" | "-" | null | undefined): string {
  return strand === "-" ? complementBase(genomicBase) : genomicBase.toUpperCase();
}

/* ─────────────────────────── finding ─────────────────────────── */

export interface LandscapeFindingInput {
  rows: LandscapeResidueItem[];
  window: { start: number; end: number };
  target: { pos: number; wt: string; mut: string } | null;
  variantRevel: number | null;
  variantAm: number | null;
  mode: SummaryMode;
  meta: LandscapeMeta | null | undefined;
  /** Gene-wide context; `undefined` while loading, `null` when it failed. */
  context?: LandscapeContext | null;
  domains?: Array<{ name: string; start: number; end: number }>;
  /**
   * The predictors pipeline's own provenance for the variant-level scores (`predictorData
   * .amProvenance` / `conservationData.revelProvenance`). When the cross-check below finds the
   * pipeline and dbNSFP tables disagreeing, the releases are named so the reader can see WHY.
   */
  predictorProvenance?: { am?: string | null; revel?: string | null } | null;
}

export interface LandscapeFinding {
  /** One sentence on the window. */
  window: string;
  /** One sentence on the queried substitution, or null without a target. */
  variant: string | null;
  /** Gene-wide facts around the target (domain, regional constraint, ClinVar, gnomAD), or null. */
  context: string | null;
  /** Data-quality warnings the reader must see before trusting the rows. */
  cautions: string[];
  /** True when there were no scores to summarise at all. */
  empty: boolean;
}

const f3 = (n: number) => n.toFixed(3);

/** Two readings of one substitution agree at the precision both surfaces print (3dp). */
const agree = (a: number | null, b: number | null): boolean =>
  a !== null && b !== null && Math.abs(a - b) < 0.0005;

/**
 * The tab's headline, stated from data only. It names no ACMG criterion as met: PM1 (hotspot /
 * critical domain) needs expert review of regional data this tab only partly shows, and the band
 * colours on residue summaries are orientation, not evidence.
 */
export function landscapeFinding(input: LandscapeFindingInput): LandscapeFinding {
  const { rows, window, target, variantRevel, variantAm, mode, meta } = input;
  const context = contextSentence(input);
  const inWindow = rows.filter((r) => r.residx >= window.start && r.residx <= window.end);
  const scored = inWindow.filter((r) => residueSummary(r, "alphaMissense", mode) !== null);
  const width = window.end - window.start + 1;
  const cautions: string[] = [];

  // The queried substitution's sentence, and a cross-check of the two tables that touch it:
  // the headline shows the pipeline's variant-level score, while any rank is read within the
  // dbNSFP table. When they disagree the rank is withheld and the mismatch is named, so the
  // sentence can never show a score that ranks differently from the rank it states.
  const variantRead = variantSentence(target, variantRevel, variantAm, rows, {
    am: input.predictorProvenance?.am ?? null,
    revel: input.predictorProvenance?.revel ?? null,
    table: meta?.sourceVersion ?? null
  });
  if (variantRead.mismatch) cautions.push(variantRead.mismatch);

  for (const flag of meta?.qualityFlags ?? []) {
    if (flag.startsWith("ref-mismatch:")) {
      cautions.push(
        `${flag.split(":")[1]} residue(s) in the scored window carry a different reference amino acid in dbNSFP than the displayed UniProt sequence; the two numberings may differ there.`
      );
    } else if (flag.startsWith("truncated:")) {
      cautions.push("The source stopped at its row limit for this gene; residues past it may read as unscored.");
    } else if (flag.startsWith("overcount:")) {
      cautions.push(`Residue ${flag.split(":")[1]} reports more substitutions than one codon admits; its summary is unreliable.`);
    }
  }
  if (!meta && rows.length > 0) {
    // Rows without a provenance block predate per-transcript counting (they may pool isoforms).
    cautions.push("These scores were cached before per-transcript counting and may pool isoforms; re-run the analysis to refresh them.");
  }
  if (meta && (meta.transcriptBasis === "unknown" || meta.transcriptBasis === "most-covered")) {
    cautions.push("The transcript behind these scores could not be confirmed as MANE or canonical.");
  }

  if (scored.length === 0) {
    return {
      window: `No AlphaMissense residue summaries were returned for residues ${window.start}–${window.end}.`,
      variant: variantRead.text,
      context,
      cautions,
      empty: true
    };
  }

  const pp3 = scored.filter((r) => bandKey("alphaMissense", residueSummary(r, "alphaMissense", mode))?.startsWith("pp3")).length;
  const bp4 = scored.filter((r) => bandKey("alphaMissense", residueSummary(r, "alphaMissense", mode))?.startsWith("bp4")).length;
  // The remainder is stated so the counts reconcile: PP3 + BP4 + indeterminate = scored.
  const indet = scored.length - pp3 - bp4;
  const stat = mode === "mean" ? "mean" : "maximum";
  const windowText =
    `Of ${scored.length} scored residues in ${window.start}–${window.end} (${width} aa), ${pp3} ${pp3 === 1 ? "has" : "have"} a ${stat} AlphaMissense score in the PP3 range, ${bp4} in the BP4 range and ${indet} ${indet === 1 ? "remains" : "remain"} indeterminate` +
    ` (ClinGen bands, ${calibrationSourceShort("alphaMissense")}; on residue summaries they orient, they do not score evidence).`;
  // A residue with no dbNSFP missense record (a codon the database does not score) is a gap in the data,
  // not a benign reading, so the finding names it instead of letting the count quietly skip it.
  // A residue that does carry REVEL but no AlphaMissense score is a different gap; the old text called
  // both "no dbNSFP missense record", which was false for the second kind.
  const unscored = inWindow.filter((r) => residueSummary(r, "alphaMissense", mode) === null);
  const noRecord = unscored.filter((r) => residueCount(r, "revel") === 0 && residueCount(r, "alphaMissense") === 0).map((r) => r.residx);
  const noAm = unscored.filter((r) => !noRecord.includes(r.residx)).map((r) => r.residx);
  const nameList = (xs: number[], suffix: string) =>
    xs.length ? ` No dbNSFP missense record for residue${xs.length === 1 ? "" : "s"} ${xs.slice(0, 4).join(", ")}${xs.length > 4 ? ` and ${xs.length - 4} more` : ""}${suffix}` : "";
  const gapText =
    nameList(noRecord, ".") +
    (noAm.length
      ? ` No AlphaMissense score for residue${noAm.length === 1 ? "" : "s"} ${noAm.slice(0, 4).join(", ")}${noAm.length > 4 ? ` and ${noAm.length - 4} more` : ""} (dbNSFP has a REVEL record there).`
      : "");

  return { window: windowText + gapText, variant: variantRead.text, context, cautions, empty: false };
}

/* ─────────────────────────── rail verdict ─────────────────────────── */
/**
 * The chip colour for a band as the design system reads it: PP3 red, BP4 good, the middle neutral,
 * nothing muted. One mapping so the tab, the rail and any future surface never disagree.
 */
export function bandTone(band: string | null | undefined): "danger" | "good" | "neutral" | "muted" {
  if (!band) return "muted";
  if (band.startsWith("PP3")) return "danger";
  if (band.startsWith("BP4")) return "good";
  return "neutral";
}

export interface LandscapeVerdictCall {
  tool: LandscapeTool;
  score: number | null;
  /** Formatted band ("PP3 Moderate"), or null without a score. */
  band: string | null;
}

/** One plain clause for a tool's band, as the 'Reads as' lead box states it. */
function bandPhrase(tool: LandscapeTool, call: LandscapeVerdictCall | undefined): string {
  if (!call || call.score === null) return `no ${TOOL_DISPLAY[tool]} score`;
  if (!call.band || call.band === "Indeterminate") return `indeterminate for ${TOOL_DISPLAY[tool]} (${call.score.toFixed(3)})`;
  const side = call.band.startsWith("PP3") ? "the PP3 range" : "the BP4 range";
  return `in ${side} for ${TOOL_DISPLAY[tool]} (${call.score.toFixed(3)} · ${call.band})`;
}

export const TOOL_DISPLAY: Record<LandscapeTool, string> = { revel: "REVEL", alphaMissense: "AlphaMissense" };

/**
 * The verdict as one plain sentence for the rail's tinted lead box — the first thing a reader
 * meets. Names what the reading applies to, then each tool's band. Same precedence as
 * `landscapeVerdict` (picked substitution → queried variant → residue summary, orientation only).
 */
export function readsAsSentence(verdict: {
  kind: "variant" | "substitution" | "residue";
  label: string;
  scope: string;
  stat: "mean" | "max";
  isQuery: boolean;
  calls: Array<LandscapeVerdictCall>;
}): string {
  const clauses = verdict.calls.map((c) => bandPhrase(c.tool, c)).join(" and ");
  const what =
    verdict.kind === "variant" && verdict.isQuery
      ? `The queried substitution ${verdict.label} reads`
      : verdict.kind === "substitution"
        ? `Substitution ${verdict.label} reads`
        : `${/^Residue\b/.test(verdict.label) ? verdict.label : `Residue ${verdict.label}`}'s ${verdict.stat} (orientation only) reads`;
  return `${what} ${clauses}.`;
}

/**
 * What the rail's verdict chips are read on, decided in one place so the chips can never show a
 * residue summary while implying a variant-level call. Precedence: a picked substitution → the
 * queried variant → the residue summary (orientation only). The old rail drew the two strips first
 * and left the reader to find the verdict in a second line of small text.
 */
export function landscapeVerdict(input: {
  target: { pos: number; wt: string; mut: string } | null;
  /** The residue being read, or null. */
  residx: number | null;
  row: Parameters<typeof residueSummary>[0];
  variantRevel: number | null;
  variantAm: number | null;
  mode: SummaryMode;
  /** The substitution the reader picked on the tab, when one is selected. */
  selectedAlt?: string | null;
  provenance?: { am?: string | null; revel?: string | null; table?: string | null };
}): {
  kind: "variant" | "substitution" | "residue";
  label: string;
  scope: string;
  /** The residue statistic the reading is taken on (for the residue kind). */
  stat: SummaryMode;
  /** True when the scored substitution IS the queried variant. */
  isQuery: boolean;
  calls: Array<LandscapeVerdictCall>;
  rank: { rank: number; of: number } | null;
  mismatch: string | null;
  /** dbNSFP row exists with scores (else "no record" state). */
  hasRecord: boolean;
} {
  const { target, residx, row, variantRevel, variantAm, mode, selectedAlt } = input;
  // The wild-type letter: the queried one on its own residue, else dbNSFP's reference amino acid.
  const wtLetter = target && residx === target.pos && target.wt ? target.wt : row?.aaref || null;
  const aaName = residx === null ? "" : wtLetter ? `${wtLetter}${residx}` : `Residue ${residx}`;
  const subs = (row?.substitutions ?? []).filter((x) => x.am !== null);
  const hasRecord = Boolean(row && (residueCount(row, "revel") > 0 || residueCount(row, "alphaMissense") > 0));
  const isTargetResidue = Boolean(target && residx === target.pos && target.pos > 0);

  // A picked substitution — the reader clicked a letter. Its own dbNSFP scores; the queried
  // variant's pipeline score stands in when the picked letter is the query itself.
  const alt = selectedAlt ?? (isTargetResidue ? target!.mut : null);
  if (alt && hasRecord) {
    const hit = row?.substitutions?.find((x) => x.alt === alt) ?? null;
    const own = isTargetResidue && alt === target!.mut;
    // The queried variant is read on the pipeline's variant-level score (the one the rest of the
    // app reports); the table value only stands in when the pipeline has none. A disagreement
    // between the two is surfaced by the finding's mismatch caution, never hidden here.
    const am = own ? variantAm ?? hit?.am ?? null : hit?.am ?? null;
    const revel = own ? variantRevel ?? hit?.revel ?? null : hit?.revel ?? null;
    // The rank orders the table's own values against each other, so it uses the table's score.
    const mismatch = own ? variantSentence(target, variantRevel, variantAm, row ? [row] : [], input.provenance).mismatch : null;
    const rankAm = hit?.am ?? null;
    const rank = !mismatch && rankAm !== null && subs.length > 1 ? { rank: subs.filter((x) => (x.am as number) > rankAm).length + 1, of: subs.length } : null;
    return {
      kind: own ? "variant" : "substitution",
      label: wtLetter ? `${aaName}${alt}` : `${alt} at ${aaName}`,
      scope: own
        ? "The queried substitution's own scores — a variant-level score, so its band applies to the variant."
        : `One substitution at residue ${residx} — a variant-level score, so its band applies to it.`,
      stat: mode,
      isQuery: own,
      calls: [
        { tool: "revel", score: revel, band: bandLabel("revel", revel) },
        { tool: "alphaMissense", score: am, band: bandLabel("alphaMissense", am) }
      ],
      rank,
      mismatch,
      hasRecord
    };
  }

  // The queried variant, no substitution picked: the pipeline's variant-level scores.
  if (isTargetResidue && (variantRevel !== null || variantAm !== null)) {
    return {
      kind: "variant",
      label: `${target!.wt}${target!.pos}${target!.mut}`,
      scope: "The queried substitution's own scores — a variant-level score, so its band applies to the variant.",
      stat: mode,
      isQuery: true,
      calls: [
        { tool: "revel", score: variantRevel, band: bandLabel("revel", variantRevel) },
        { tool: "alphaMissense", score: variantAm, band: bandLabel("alphaMissense", variantAm) }
      ],
      rank: null,
      mismatch: null,
      hasRecord
    };
  }

  // A residue: the summary orients the eye and never scores evidence.
  const revel = residueSummary(row, "revel", mode);
  const am = residueSummary(row, "alphaMissense", mode);
  return {
    kind: "residue",
    label: aaName,
    scope: `Residue ${mode} over its scored substitutions — orientation only; a band here is not variant-level evidence.`,
    stat: mode,
    isQuery: isTargetResidue,
    calls: [
      { tool: "revel", score: revel, band: bandLabel("revel", revel) },
      { tool: "alphaMissense", score: am, band: bandLabel("alphaMissense", am) }
    ],
    rank: null,
    mismatch: null,
    hasRecord
  };
}

function variantSentence(
  target: LandscapeFindingInput["target"],
  revel: number | null,
  am: number | null,
  rows: LandscapeResidueItem[],
  provenance?: { am?: string | null; revel?: string | null; table?: string | null }
): { text: string | null; mismatch: string | null } {
  if (!target || target.pos <= 0) return { text: null, mismatch: null };
  const name = target.wt && target.mut ? `${target.wt}${target.pos}${target.mut}` : `Residue ${target.pos}`;
  const parts: string[] = [];
  if (revel !== null) parts.push(`REVEL ${f3(revel)} (${bandLabel("revel", revel)})`);
  if (am !== null) parts.push(`AlphaMissense ${f3(am)} (${bandLabel("alphaMissense", am)})`);
  if (parts.length === 0)
    return { text: `${name}: no variant-level REVEL or AlphaMissense score was returned.`, mismatch: null };

  const row = rows.find((r) => r.residx === target.pos);
  const range = residueRange(row, "alphaMissense");
  const n = residueCount(row, "alphaMissense");
  /**
   * The disagreement is decided BEFORE any ranking claim: when the pipeline's variant-level score
   * and the dbNSFP table disagree on this substitution, every "highest / lowest / rank N" sentence
   * is withheld — the mismatch note below already says so. The rank branch previously read its own
   * agreement first, so a REVEL-only disagreement fell through to the range sentence and asserted
   * "the highest" in the same frame where the tab said the ranking was withheld.
   */
  const ownSub = row?.substitutions?.find((x) => x.alt === target.mut) ?? null;
  const mismatchParts: string[] = [];
  if (am !== null && ownSub?.am != null && !agree(am, ownSub.am))
    mismatchParts.push(`AlphaMissense ${f3(am)} from the predictors pipeline vs ${f3(ownSub.am)} in dbNSFP`);
  if (revel !== null && ownSub?.revel != null && !agree(revel, ownSub.revel))
    mismatchParts.push(`REVEL ${f3(revel)} from the predictors pipeline vs ${f3(ownSub.revel)} in dbNSFP`);
  let context = "";
  const subs = (row?.substitutions ?? []).filter((x) => x.am !== null);
  const own = subs.find((x) => x.alt === target.mut);
  if (am !== null && own && subs.length > 1 && agree(am, own.am) && (revel === null || own.revel === null || agree(revel, own.revel)) && mismatchParts.length === 0) {
    const rank = subs.filter((x) => (x.am as number) > (own.am as number)).length + 1;
    // "of the N substitutions scored here" — the set is what dbNSFP scored, which can be fewer
    // than the SNV-reachable set. The old wording ("of 6 SNV-reachable substitutions") claimed a
    // coverage of the codon that the scored subset does not have.
    context = `; it ranks ${rank} of the ${subs.length} substitutions with an AlphaMissense score at residue ${target.pos} (1 = highest)`;
  } else if (am !== null && mismatchParts.length === 0 && range && n > 1 && own) {
    // Only place the variant in the table's range when the table holds that substitution; otherwise the
    // ordinal claim would be about a substitution the table does not contain.
    const [lo, hi] = range;
    const where = am >= hi ? "the highest" : am <= lo ? "the lowest" : "within the range";
    context = `; among the ${n} scored substitutions at residue ${target.pos} (AlphaMissense ${f3(lo)}–${f3(hi)}) it is ${where}`;
  } else if (am !== null && n > 1 && target.mut && !own) {
    context = `; dbNSFP has no row for ${target.mut} at residue ${target.pos}, so it is not placed among that residue's ${n} scored substitutions`;
  }

  // A mismatch between the pipeline's variant-level score and the dbNSFP table (next to the
  // "this variant" marker and any rank) is a data-quality fact, not a reading: name both values
  // and both sources. When both sides name their release and the releases differ, that is the
  // likely cause and the reader is told; when the releases agree, the numbers disagreeing points
  // at a reading or numbering problem instead.
  let mismatch: string | null = null;
  if (mismatchParts.length) {
    const why = releaseGap(provenance?.am ?? null, provenance?.table ?? null) ?? releaseGap(provenance?.revel ?? null, provenance?.table ?? null);
    mismatch = `The predictors pipeline and dbNSFP disagree on ${name}: ${mismatchParts.join("; ")}.${why ? ` ${why}` : " The two fetch paths read different releases or numberings; re-run the analysis to refresh both."} The substitution ranking is withheld while the tables disagree.`;
  }

  return { text: `${name}: ${parts.join(" · ")}${context}.`, mismatch };
}

/** When the pipeline's provenance and the landscape table name different releases, say so. */
function releaseGap(pipeline: string | null, table: string | null): string | null {
  if (!pipeline || !table) return null;
  const v = (s: string) => s.match(/dbNSFP\s*[\d.]+[a-z]?/i)?.[0] ?? null;
  const pv = v(pipeline);
  const tv = v(table);
  if (pv && tv && pv.toLowerCase() !== tv.toLowerCase())
    return `The predictors read ${pipeline.toLowerCase().includes(pv.toLowerCase()) ? pipeline : `${pv} (${pipeline})`}, while this tab's table is ${tv} — a different release is the likely cause.`;
  if (pv && tv) return "Both sides report the same dbNSFP release, so the readings disagree for another reason (numbering or a stale cache).";
  return null;
}

/** True when a ClinVar missense record is the queried substitution itself (same residue, same alternative). */
export function clinvarIsQuery(
  c: { pos: number; hgvsp: string },
  target: { pos: number; mut: string } | null
): boolean {
  if (!target || !target.mut || c.pos !== target.pos) return false;
  const m = c.hgvsp.replace(/^p\./i, "").match(/^[A-Za-z]{3}\d+([A-Za-z]{3})$/);
  return Boolean(m && AMINO_ACID_3_TO_1[m[1]] === target.mut);
}

function contextSentence(input: LandscapeFindingInput): string | null {
  const { target, context, domains } = input;
  if (!target || target.pos <= 0) return null;
  if (context === undefined) return "Gene-wide ClinVar, gnomAD and regional-constraint context is loading…";
  const parts: string[] = [];
  const dom = (domains ?? []).find((d) => target.pos >= d.start && target.pos <= d.end);
  parts.push(dom ? `Inside ${dom.name} (${dom.start}–${dom.end})` : "Not in an annotated UniProt domain or region");
  if (context === null) {
    parts.push("ClinVar, gnomAD and regional constraint could not be loaded");
    return parts.join(" · ") + ".";
  }
  if (context.regions === null) {
    parts.push(
      context.regionsStatus === "withheld-mapping"
        ? "regional constraint withheld pending a verified transcript-to-protein mapping"
        : "regional constraint not loaded"
    );
  } else {
    const region = context.regions.find((r) => target.pos >= r.start && target.pos <= r.end);
    parts.push(
      region
        ? `regional missense O/E ${region.oe ?? "—"} for ${region.start}–${region.end} (${context.regionsBasis})`
        : context.regions.length
          ? `outside every constrained sub-region (${context.regionsBasis})`
          : "no regional missense constraint call for this gene"
    );
  }
  if (context.clinvar === null) parts.push("ClinVar not loaded");
  else {
    // The queried variant is the thing being interpreted: counting its own ClinVar record as
    // "pathogenic variants here" would make the context circular, so it is named apart.
    const own = context.clinvar.find((c) => clinvarIsQuery(c, target));
    const plp = context.clinvar.filter((c) => c.cls === "plp" && c !== own);
    const here = plp.filter((c) => c.pos === target.pos).length;
    if (own) parts.push(`the queried variant is itself in ClinVar (${own.significance})`);
    if (here) parts.push(`${here} other ClinVar P/LP missense ${here === 1 ? "variant" : "variants"} at this residue`);
    else if (plp.length) {
      const nearest = plp.reduce((a, b) => (Math.abs(b.pos - target.pos) < Math.abs(a.pos - target.pos) ? b : a));
      parts.push(`nearest other ClinVar P/LP missense ${Math.abs(nearest.pos - target.pos)} residues away (residue ${nearest.pos})`);
    } else parts.push(own ? "no other ClinVar P/LP missense in this gene" : "no ClinVar P/LP missense in this gene");
  }
  if (context.gnomad === null) parts.push("gnomAD not loaded");
  else {
    const near = context.gnomad.filter((g) => Math.abs(g.pos - target.pos) <= 5).reduce((n, g) => n + g.variants, 0);
    parts.push(`${near} gnomAD missense variant${near === 1 ? "" : "s"} within ±5 residues`);
  }
  return parts.join(" · ") + ".";
}

/* ─────────────────────────── genetic code ─────────────────────────── */

const BASES = "TCAG";
const TABLE = "FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG";

/** Standard genetic code; `*` for stop, null for anything that is not a DNA codon. */
export function translateCodon(codon: string): string | null {
  const c = codon.toUpperCase();
  if (!/^[ACGT]{3}$/.test(c)) return null;
  return TABLE[16 * BASES.indexOf(c[0]) + 4 * BASES.indexOf(c[1]) + BASES.indexOf(c[2])];
}

/** Amino acids one SNV away from `codon` (stop and synonymous excluded). */
export function snvReachableAminoAcids(codon: string): Set<string> {
  const out = new Set<string>();
  const wt = translateCodon(codon);
  if (!wt) return out;
  for (let k = 0; k < 3; k++) {
    for (const b of "ACGT") {
      if (b === codon[k].toUpperCase()) continue;
      const aa = translateCodon(codon.slice(0, k) + b + codon.slice(k + 1));
      if (aa && aa !== "*" && aa !== wt) out.add(aa);
    }
  }
  return out;
}

/** Heatmap row order: physicochemical groups, so a row block reads as a property. */
export const HEATMAP_AA_ORDER = ["A", "V", "L", "I", "M", "F", "W", "Y", "S", "T", "N", "Q", "C", "G", "P", "D", "E", "K", "R", "H"] as const;

/* ─────────────────────────── store keys ─────────────────────────── */

/**
 * Key for the per-query Landscape state in the store (navigated rows, overview, selection). The
 * accession is part of it: the same gene and variant re-run against another UniProt entry is laid
 * out on a different sequence, so none of the previous state may be reused.
 */
export function landscapeKey(gene: string | null | undefined, variant: string | null | undefined, uniprotId: string | null | undefined): string {
  return `${(gene ?? "").toUpperCase()}|${variant ?? ""}|${(uniprotId ?? "").toUpperCase()}`;
}

/* ─────────────────────────── provenance ─────────────────────────── */

const BASIS_TEXT: Record<LandscapeMeta["transcriptBasis"], string> = {
  mane: "MANE Select",
  "ensembl-canonical": "Ensembl canonical",
  "sequence-match": "chosen by agreement with the UniProt sequence",
  "most-covered": "most-covered transcript (not confirmed MANE)",
  unknown: "transcript not recorded"
};

export function provenanceLine(meta: LandscapeMeta | null | undefined): string {
  if (!meta) return "Source not reported";
  if (meta.source === "none") return "No landscape source answered for this window";
  const src = meta.source === "dbnsfp-local" ? "local dbNSFP" : "myvariant.info";
  const version = meta.sourceVersion ?? "dbNSFP version not reported";
  const tx = meta.transcript ? `${meta.transcript} (${BASIS_TEXT[meta.transcriptBasis]})` : BASIS_TEXT[meta.transcriptBasis];
  return `${version} via ${src} · ${tx}${meta.cached ? " · cached" : ""}`;
}

/* ─────────────────────────── agreement ─────────────────────────── */

export type Agreement = "both-pp3" | "both-bp4" | "discordant" | "other";

/**
 * Where two calibrated readings stand relative to each other. Raw equality of REVEL and
 * AlphaMissense means nothing (their PP3 edges are 0.644 and 0.792), so agreement is read on the
 * bands: both in PP3, both in BP4, one in each (discordant), or anything involving the middle.
 */
export function agreementClass(revel: number | null, am: number | null): Agreement | null {
  if (revel === null || am === null) return null;
  const r = calibratedCall("revel", revel)?.direction ?? null;
  const a = calibratedCall("alphaMissense", am)?.direction ?? null;
  if (r === "PP3" && a === "PP3") return "both-pp3";
  if (r === "BP4" && a === "BP4") return "both-bp4";
  if ((r === "PP3" && a === "BP4") || (r === "BP4" && a === "PP3")) return "discordant";
  return "other";
}
