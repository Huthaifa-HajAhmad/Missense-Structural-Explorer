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
      variant: variantSentence(target, variantRevel, variantAm, rows),
      context,
      cautions,
      empty: true
    };
  }

  const pp3 = scored.filter((r) => bandKey("alphaMissense", residueSummary(r, "alphaMissense", mode))?.startsWith("pp3")).length;
  const bp4 = scored.filter((r) => bandKey("alphaMissense", residueSummary(r, "alphaMissense", mode))?.startsWith("bp4")).length;
  const stat = mode === "mean" ? "mean" : "maximum";
  const windowText =
    `Of ${scored.length} scored residues in ${window.start}–${window.end} (${width} aa), ${pp3} ${pp3 === 1 ? "has" : "have"} a ${stat} AlphaMissense score in the PP3 range and ${bp4} in the BP4 range` +
    ` (ClinGen bands, ${calibrationSourceShort("alphaMissense")}; on residue summaries they orient, they do not score evidence).`;

  return { window: windowText, variant: variantSentence(target, variantRevel, variantAm, rows), context, cautions, empty: false };
}

function variantSentence(
  target: LandscapeFindingInput["target"],
  revel: number | null,
  am: number | null,
  rows: LandscapeResidueItem[]
): string | null {
  if (!target || target.pos <= 0) return null;
  const name = target.wt && target.mut ? `${target.wt}${target.pos}${target.mut}` : `Residue ${target.pos}`;
  const parts: string[] = [];
  if (revel !== null) parts.push(`REVEL ${f3(revel)} (${bandLabel("revel", revel)})`);
  if (am !== null) parts.push(`AlphaMissense ${f3(am)} (${bandLabel("alphaMissense", am)})`);
  if (parts.length === 0) return `${name}: no variant-level REVEL or AlphaMissense score was returned.`;

  const row = rows.find((r) => r.residx === target.pos);
  const range = residueRange(row, "alphaMissense");
  const n = residueCount(row, "alphaMissense");
  let context = "";
  const subs = (row?.substitutions ?? []).filter((x) => x.am !== null);
  const own = subs.find((x) => x.alt === target.mut);
  if (am !== null && own && subs.length > 1) {
    const rank = subs.filter((x) => (x.am as number) > (own.am as number)).length + 1;
    context = `; it ranks ${rank} of ${subs.length} SNV-reachable substitutions at residue ${target.pos} by AlphaMissense (1 = highest)`;
  } else if (am !== null && range && n > 1) {
    const [lo, hi] = range;
    const where = am >= hi ? "the highest" : am <= lo ? "the lowest" : "within the range";
    context = `; among the ${n} scored substitutions at residue ${target.pos} (AlphaMissense ${f3(lo)}–${f3(hi)}) it is ${where}`;
  }
  return `${name}: ${parts.join(" · ")}${context}.`;
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
  if (context.regions === null) parts.push("regional constraint not loaded");
  else {
    const region = context.regions.find((r) => target.pos >= r.start && target.pos <= r.end);
    parts.push(
      region
        ? `regional missense O/E ${region.oe ?? "—"} for ${region.start}–${region.end} (gnomAD v2, GRCh37 numbering)`
        : context.regions.length
          ? "outside every gnomAD v2 constrained region"
          : "no regional missense constraint call for this gene"
    );
  }
  if (context.clinvar === null) parts.push("ClinVar not loaded");
  else {
    const plp = context.clinvar.filter((c) => c.cls === "plp");
    const here = plp.filter((c) => c.pos === target.pos).length;
    if (here) parts.push(`${here} ClinVar P/LP missense at this residue`);
    else if (plp.length) {
      const nearest = plp.reduce((a, b) => (Math.abs(b.pos - target.pos) < Math.abs(a.pos - target.pos) ? b : a));
      parts.push(`nearest ClinVar P/LP missense ${Math.abs(nearest.pos - target.pos)} residues away (residue ${nearest.pos})`);
    } else parts.push("no ClinVar P/LP missense in this gene");
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
