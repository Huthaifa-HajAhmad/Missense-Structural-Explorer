/**
 * structure3dEvidence.ts — what the 3D structure view may say about the coordinates on its canvas.
 *
 * One pure model that the viewer's toolbar, its on-canvas legend and the inspector rail all render,
 * so the three can no longer tell three stories about one structure.
 *
 * INVARIANTS
 * ----------
 *  1. Identity comes from provenance, never from the numbers in the file. Each structure on the canvas
 *     is named by the endpoint or engine that produced it (AlphaFold DB, a PDB entry, FoldX on a named
 *     template, an ESMFold engine). The B-factor column's meaning follows from that identity.
 *  2. One colour channel per structure, stated. pLDDT is coloured with AlphaFold DB's published bands;
 *     crystallographic B-factors RELATIVE to their own entry (quartiles), never with absolute cut-points;
 *     displacement and ESM3 marks are labelled app-defined. A pLDDT filter exists only for a pLDDT column.
 *  3. A wild-type/variant comparison is shown only when both structures descend from the same coordinates.
 *     FoldX builds its variant on a template that is often NOT the AlphaFold model shown as wild type;
 *     the comparison then pairs the variant with its own template, or says why it cannot.
 *  4. Absence is a state. A missing χ1 is "not applicable" for Gly/Ala and "not measured" otherwise —
 *     never 0°. Nothing is printed as "N/A".
 *  5. The 3D view feeds no ACMG criterion, and says so. ΔΔG is a stability estimate, not pathogenicity.
 *
 * DEFECTS THIS REPLACED (NAE1 p.Asp116Gly, the audit's reference variant)
 * ----------------------------------------------------------------------
 *  - "RCSB PDB: 1YOV" over the AlphaFold model: the store's single `structureProvenance` was last-writer-
 *    wins, and the FoldX run wrote its template's provenance over the wild type's.
 *  - "pLDDT Confidence 94.5 (Very High)": the number was 1YOV's crystallographic B-factor.
 *  - The superposition overlaid the RAW FoldX variant (crystal frame) on the AlphaFold model — the
 *    alignment effect never ran — and coloured the variant's inherited temperature factors as Å of
 *    Cα displacement, so the two structures sat apart, both "severely displaced".
 *  - pLDDT colours and the pLDDT ≥ 70 filter applied to crystal B-factors (which keeps the MOST mobile
 *    atoms), and to ESM Atlas files whose pLDDT is on a 0–1 scale (which removed everything).
 *  - "ESMFold-2 … (Lin et al. 2023)": Lin 2023 is ESMFold v1; the Tier-1 engine is ESMFold2-Fast.
 *  - "Allosteric heatmap" for an embedding distance, banded at 0.05/0.15/0.35 while the engine used
 *    0.08/0.22/0.38; "±15 residue" for a ±5 window; χ1 "0.0°" for a glycine.
 */

import { ENGINE_STATE_LABELS } from "./engineStatus";
import {
  LOCAL_ALIGNMENT_FIT_WINDOW,
  LOCAL_STRUCTURAL_WINDOW,
  STRUCTURE_COLOUR_BANDS,
  THRESHOLDS,
} from "./thresholds";
import { AMINO_ACID_1_TO_3_TITLE, AMINO_ACID_3_TO_1 } from "./aminoAcids";
import type { BFactorScan, ResidueAt } from "./coordinateText";
import { describeDeNovoFoldTimeout, isFoldingTimeoutError } from "./foldingLimits";

/* ────────────────────────────────────────────────────────────────────────────
 * Types
 * ──────────────────────────────────────────────────────────────────────────── */

export type ModelFamily = "alphafold" | "esmfold";
export type ViewMode = "wildtype" | "mutant" | "superimposed";
export type RepresentationId = "confidence" | "plain" | "pair" | "displacement" | "esm3";
export type AlignmentScope = "local" | "global";

export interface CoordinateProvenance {
  source?: string | null;
  pdbId?: string | null;
  chainId?: string | null;
  resolution?: number | null;
  method?: string | null;
  identity?: number | null;
  afdbVersion?: string | null;
}

/** The engine ids the `/esmfold` route reports (`server/services/structure/esmfold.ts`). */
export type DeNovoEngineId = "japanfold-esmfold2-fast" | "forge-esmfold2-fast" | "esm-atlas-esmfold";

export type CoordinateOrigin =
  | "afdb"
  | "pdb-entry"
  | "pdb-homolog"
  | "foldx-variant"
  | "de-novo"
  | "client"
  | "unknown";

export type ChannelKind = "plddt" | "temperature-factor" | "displacement" | "unknown";

export interface BFactorChannel {
  kind: ChannelKind;
  /** Copied from another structure: FoldX writes its template's B column onto the variant model. */
  inherited: boolean;
  /** pLDDT only: 1 when the file stores 0–1 (ESM Atlas), 100 otherwise; null when unknown. */
  scale: 1 | 100 | null;
  note: string;
}

export interface CoordinateIdentity {
  origin: CoordinateOrigin;
  role: "wild type" | "variant" | "template";
  /** Short name for chips: "AF-Q13564-F1 v6", "PDB 1YOV chain A". */
  name: string;
  /** What kind of coordinates these are, in words. */
  kind: string;
  detail: string | null;
  href: string | null;
  channel: BFactorChannel;
  numbering: "uniprot" | "entry" | "unknown";
}

/**
 * How a PDB entry from the experimental list was loaded. The server returns the chain that maps to
 * the protein, renumbered to UniProt when the wild-type residue is verified at the variant's
 * position; otherwise the whole entry in its authors' numbering, with the reason.
 */
export interface LoadedEntryMeta {
  numbering: "uniprot" | "author";
  chainId: string | null;
  mapping: "sifts" | "needleman_wunsch" | null;
  /** Residues with no UniProt position (tags, linkers, insertions) the server left out. */
  unmappedResidues?: number | null;
  reason: string | null;
}

export interface LoadedEntry extends LoadedEntryMeta {
  /** The URL it was loaded from; an entry whose URL is no longer selected is stale. */
  url: string;
  text: string;
}

export interface StructuralMetricsLike {
  localWindowRmsd?: number | null;
  globalRmsd?: number | null;
  alignmentScope?: AlignmentScope | null;
  maxCaDisplacement?: number | null;
  wtChi1?: number | null;
  mutChi1?: number | null;
  chi1Deviation?: number | null;
  wtSasa?: number | null;
  mutSasa?: number | null;
  sasaChange?: number | null;
  lostHBonds?: number | null;
  gainedHBonds?: number | null;
  lostContacts?: number | null;
  gainedContacts?: number | null;
  displacements?: { resSeq: number; displacement: number }[] | null;
}

export interface HomologLike {
  pdbId: string;
  title?: string | null;
  organism?: string | null;
  method?: string | null;
  resolution?: number | null;
  identity?: number | null;
  coverage?: number | null;
  querySeqFrom?: number | null;
  querySeqTo?: number | null;
  coversPosition?: boolean | null;
}

export type ReferenceState = "idle" | "loading" | "ready" | "unavailable";

export interface Structure3dInput {
  family: ModelFamily;
  viewMode: ViewMode;
  /** The representation the reader picked; the model falls back when it is not valid here. */
  representation: RepresentationId;
  variant: {
    position: number | null;
    wildType: string | null;
    mutant: string | null;
    uniprotId: string | null;
    gene: string | null;
  };
  /** A residue the reader clicked, when it is not the variant's position. */
  selectedResidue: number | null;
  wildType: {
    /** Provenance of the wild-type coordinates the AlphaFold view draws (the pipeline's structure). */
    provenance: CoordinateProvenance | null;
    /** Positive header identification, used only when provenance is missing (cached runs). */
    headerSaysAlphaFold?: { version: string | null } | null;
    /** A PDB entry the reader loaded from the experimental list. */
    customPdbUrl: string | null;
    /** How that entry was loaded, once it has been (null while it loads). */
    entry?: LoadedEntryMeta | null;
    scan: BFactorScan | null;
    site: ResidueAt | null;
  };
  foldx: {
    running: boolean;
    phaseLabel: string | null;
    status: "success" | "failed" | "unavailable" | null;
    error: string | null;
    ddG: number | null;
    ddGSd: number | null;
    runs: number | null;
    /** The template FoldX built on, as the run reported it. */
    template: CoordinateProvenance | null;
    repairSkipped: boolean;
    repairSkippedReason: string | null;
    repairFailed: boolean;
    reference: {
      state: ReferenceState;
      reason: string | null;
      provenance: CoordinateProvenance | null;
      /** FoldX's own paired wild type from the same run, or the template re-fetched (older results). */
      basis?: "foldx-paired" | "template" | null;
    };
    aligned: boolean;
    referenceSite: ResidueAt | null;
  };
  deNovo: {
    folding: boolean;
    error: string | null;
    wildTypeLoaded: boolean;
    variantLoaded: boolean;
    /** The server returned ONE structure; there is no separate variant model. */
    singleStructure: boolean;
    engines: { wildType: string | null; variant: string | null } | null;
    scan: BFactorScan | null;
    aligned: boolean;
    site: ResidueAt | null;
  };
  alignmentScope: AlignmentScope;
  metrics: StructuralMetricsLike | null;
  esm3: { scoreCount: number | null; error: string | null } | null;
  region: string | null;
  burial: { rsa: number | null; label: string | null; structure: string | null } | null;
  homologs: HomologLike[];
  homologsLoading: boolean;
}

export interface ModeOption {
  id: ViewMode;
  label: string;
  available: boolean;
  /** Why not, or what is happening; null when available. */
  reason: string | null;
  busy: boolean;
}

export interface RepresentationOption {
  id: RepresentationId;
  label: string;
  available: boolean;
  reason: string | null;
}

export type ThemePlan =
  | { theme: "plddt"; scale: 1 | 100 }
  | { theme: "bfactor-quartile" }
  | { theme: "displacement" }
  | { theme: "esm3" }
  | { theme: "uniform"; color: number; alpha: number };

export interface ColourPlan {
  primary: ThemePlan;
  secondary: ThemePlan | null;
  /**
   * Draw the second structure's cartoon. False for FoldX: its variant shares the template's backbone
   * atom for atom, so a second cartoon only z-fights with the first. The variant residue is still
   * drawn at the site.
   */
  secondaryCartoon: boolean;
}

export interface LegendEntry {
  label: string;
  range: string | null;
  color: number;
}

export interface Legend {
  title: string;
  provenance: "published" | "relative" | "app-defined" | "pair";
  provenanceNote: string;
  entries: LegendEntry[];
}

export interface Comparison {
  state: "ready" | "pending" | "unavailable" | "not-applicable";
  headline: string;
  reason: string | null;
  template: CoordinateIdentity | null;
  variant: CoordinateIdentity | null;
  rigidBackbone: boolean;
  fit: string | null;
  /** The AlphaFold model shown as wild type is not the structure FoldX built on. */
  canvasWildTypeIsNotTemplate: boolean;
}

export interface Reading {
  key: string;
  label: string;
  note: string;
  value: string | null;
  state: "measured" | "not-applicable" | "not-measured";
  caveat: string | null;
}

export interface SiteContext {
  position: number | null;
  substitution: string | null;
  check: { state: "match" | "mismatch" | "absent" | "unknown"; text: string };
  confidence: { kind: "plddt" | "b-factor" | "none"; value: number | null; text: string; note: string };
  region: string | null;
  burial: string | null;
  selected: number | null;
  /** True only when the canvas uses verified UniProt residue numbering. */
  canAddressVariantSite: boolean;
}

export interface TraceStep {
  n: number;
  label: string;
  value: string;
  sub: string | null;
  state: "done" | "warn" | "idle";
  warn: string | null;
}

export interface Notice {
  key: string;
  tone: "warning" | "info";
  title: string;
  body: string;
}

export interface ExperimentalRow {
  pdbId: string;
  title: string | null;
  organism: string | null;
  method: string | null;
  resolution: string | null;
  identity: string;
  range: string | null;
  coversSite: "yes" | "no" | "unknown";
  loaded: boolean;
  url: string;
}

export interface Structure3dEvidence {
  family: ModelFamily;
  viewMode: ViewMode;
  canvas: {
    primary: CoordinateIdentity | null;
    secondary: CoordinateIdentity | null;
    chip: { label: string; title: string; tone: "predicted" | "experimental" | "model" | "none" };
    relationshipNote: string | null;
  };
  modes: ModeOption[];
  representations: RepresentationOption[];
  representation: RepresentationId;
  colour: ColourPlan;
  legend: Legend | null;
  plddtFilter: { available: boolean; reason: string | null; scale: 1 | 100 | null };
  alignment: { scopeToggle: boolean; scope: AlignmentScope; fitLabel: string };
  comparison: Comparison;
  readings: Reading[];
  site: SiteContext;
  trace: TraceStep[];
  notices: Notice[];
  notes: string[];
  sources: { citation: string; doi: string }[];
  experimental: { rows: ExperimentalRow[]; loading: boolean; best: ExperimentalRow | null; note: string };
  engineRecord: string;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Vocabulary
 * ──────────────────────────────────────────────────────────────────────────── */

const DE_NOVO_ENGINES: Record<DeNovoEngineId, { name: string; model: string; scale: 1 | 100 | null }> = {
  "japanfold-esmfold2-fast": { name: "ESMFold2-Fast via JapanFold", model: "ESMFold2-Fast", scale: null },
  "forge-esmfold2-fast": { name: "ESMFold2-Fast via EvolutionaryScale Forge", model: "ESMFold2-Fast", scale: null },
  "esm-atlas-esmfold": { name: "ESMFold v1 via the ESM Atlas", model: "ESMFold", scale: 1 },
};

export const STRUCTURE_SOURCES = {
  jumper2021: { citation: "Jumper et al. 2021, Nature — AlphaFold2 and pLDDT", doi: "10.1038/s41586-021-03819-2" },
  varadi2022: { citation: "Varadi et al. 2022, Nucleic Acids Res — AlphaFold DB and its pLDDT bands", doi: "10.1093/nar/gkab1061" },
  delgado2019: { citation: "Delgado et al. 2019, Bioinformatics — FoldX 5.0", doi: "10.1093/bioinformatics/btz184" },
  schymkowitz2005: { citation: "Schymkowitz et al. 2005, Nucleic Acids Res — the FoldX force field", doi: "10.1093/nar/gki387" },
  lin2023: { citation: "Lin et al. 2023, Science — ESM-2 and ESMFold (v1)", doi: "10.1126/science.ade2574" },
  candido2026: { citation: "Candido et al. 2026, bioRxiv — ESMC and ESMFold2", doi: "10.64898/2026.06.03.729735" },
  hayes2025: { citation: "Hayes et al. 2025, Science — ESM3", doi: "10.1126/science.ads0018" },
  kabsch1976: { citation: "Kabsch 1976, Acta Cryst A — least-squares superposition", doi: "10.1107/S0567739476001873" },
  sun2019: { citation: "Sun et al. 2019, Chem Rev — interpreting and normalising B-factors", doi: "10.1021/acs.chemrev.8b00290" },
  sehnal2021: { citation: "Sehnal et al. 2021, Nucleic Acids Res — Mol* Viewer", doi: "10.1093/nar/gkab314" },
} as const;

export const STRUCTURE_ENGINE_RECORD =
  "Not an ACMG input. No criterion in the rule engine reads the 3D view, the superposition or its measurements.";

const REPRESENTATION_LABELS: Record<RepresentationId, string> = {
  confidence: "Confidence",
  plain: "Plain cartoon",
  pair: "Wild type and variant",
  displacement: "Cα displacement",
  esm3: "ESM3 sequence shift",
};

/** Neutral reference and clay variant for the superposition pair. Clay is `--cs-accent-clay`. */
export const PAIR_COLOURS = { template: 0x9a948c, variant: 0xc46849 } as const;
const PLAIN_COLOUR = 0x5b7fa6;

/* ────────────────────────────────────────────────────────────────────────────
 * Small helpers
 * ──────────────────────────────────────────────────────────────────────────── */

function upper(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed.toUpperCase() : null;
}

function toThree(code: string | null | undefined): string | null {
  if (!code) return null;
  const c = code.trim();
  if (c.length === 1) return AMINO_ACID_1_TO_3_TITLE[c.toUpperCase()] ?? null;
  if (c.length === 3) return c.charAt(0).toUpperCase() + c.slice(1).toLowerCase();
  return null;
}

function toOne(code: string | null | undefined): string | null {
  if (!code) return null;
  const c = code.trim();
  if (c.length === 1) return c.toUpperCase();
  return AMINO_ACID_3_TO_1[c.toUpperCase()] ?? AMINO_ACID_3_TO_1[c] ?? null;
}

function fmt(value: number | null | undefined, digits: number): string | null {
  return value === null || value === undefined || !Number.isFinite(value) ? null : value.toFixed(digits);
}

/** A sentence continued after a colon: lower-cased first word (not an acronym), no final stop. */
function sentenceTail(text: string): string {
  const trimmed = text.trim().replace(/\.$/, "");
  return /^[A-Z][a-z]/.test(trimmed) ? trimmed.charAt(0).toLowerCase() + trimmed.slice(1) : trimmed;
}

function signed(value: number, digits: number): string {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(digits)}`;
}

/** The PDB id the reader loaded, from `/api/v1/pdb/entry/<id>[?…]` or an RCSB download URL. */
export function pdbIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const last = url.split(/[?#]/)[0].split("/").pop() ?? "";
  const id = last.replace(/\.(pdb|ent|cif)$/i, "");
  return /^[0-9A-Za-z]{4}$/.test(id) ? id.toUpperCase() : null;
}

export function plddtBand(value: number): (typeof STRUCTURE_COLOUR_BANDS.plddt)[number] {
  return STRUCTURE_COLOUR_BANDS.plddt.find(b => value > b.min) ?? STRUCTURE_COLOUR_BANDS.plddt[3];
}

function quartileOf(value: number, scan: BFactorScan | null): number | null {
  if (!scan?.quartiles) return null;
  const [q1, q2, q3] = scan.quartiles;
  return value <= q1 ? 0 : value <= q2 ? 1 : value <= q3 ? 2 : 3;
}

const QUARTILE_WORDS = ["lowest quarter", "second quarter", "third quarter", "highest quarter"];

/* ────────────────────────────────────────────────────────────────────────────
 * Identities
 * ──────────────────────────────────────────────────────────────────────────── */

function plddtChannel(scale: 1 | 100 | null, source: string, inherited = false): BFactorChannel {
  return {
    kind: "plddt",
    inherited,
    scale,
    note: inherited
      ? `B-factor column copied from the template: ${source} pLDDT, not a property of the variant model.`
      : `B-factor column holds ${source} pLDDT${scale === 1 ? " on a 0–1 scale (shown ×100)" : " (0–100)"}.`,
  };
}

function temperatureChannel(inherited = false): BFactorChannel {
  return {
    kind: "temperature-factor",
    inherited,
    scale: null,
    note: inherited
      ? "B-factor column copied from the crystal template: temperature factors of the wild-type entry, not of the variant."
      : "B-factor column holds crystallographic temperature factors (Å²): atomic mobility and disorder in the crystal, not prediction confidence.",
  };
}

const UNKNOWN_CHANNEL: BFactorChannel = {
  kind: "unknown",
  inherited: false,
  scale: null,
  note: "The source of these coordinates is not reported, so the B-factor column is not interpreted.",
};

function isExperimentalSource(source: string | null | undefined): boolean {
  return source === "experimental" || source === "homolog";
}

function methodLine(prov: CoordinateProvenance | null | undefined): string | null {
  const parts: string[] = [];
  if (prov?.method) parts.push(prov.method.charAt(0).toUpperCase() + prov.method.slice(1).toLowerCase());
  if (prov?.resolution !== null && prov?.resolution !== undefined && Number.isFinite(prov.resolution)) parts.push(`${prov.resolution} Å`);
  if (prov?.identity !== null && prov?.identity !== undefined && Number.isFinite(prov.identity)) parts.push(`${prov.identity}% identity`);
  return parts.length ? parts.join(" · ") : null;
}

/** The structure a provenance record names, as the wild type or as a FoldX template. */
export function identifyFromProvenance(
  prov: CoordinateProvenance | null | undefined,
  uniprotId: string | null,
  role: CoordinateIdentity["role"],
  headerSaysAlphaFold?: { version: string | null } | null
): CoordinateIdentity {
  const source = prov?.source ?? (headerSaysAlphaFold ? "alphafold" : null);
  if (source === "alphafold") {
    const version = prov?.afdbVersion ?? headerSaysAlphaFold?.version ?? null;
    const acc = upper(uniprotId);
    return {
      origin: "afdb",
      role,
      name: acc ? `AF-${acc}-F1${version ? ` ${version}` : ""}` : `AlphaFold DB model${version ? ` ${version}` : ""}`,
      kind: "AlphaFold DB predicted model, full length",
      detail: version ? `AlphaFold DB ${version}` : "AlphaFold DB version not reported",
      href: acc ? `https://alphafold.ebi.ac.uk/entry/${acc}` : null,
      channel: plddtChannel(100, "AlphaFold"),
      numbering: "uniprot",
    };
  }
  if (isExperimentalSource(source)) {
    const id = upper(prov?.pdbId);
    const chain = upper(prov?.chainId);
    const homolog = source === "homolog";
    return {
      origin: homolog ? "pdb-homolog" : "pdb-entry",
      role,
      name: `${id ? `PDB ${id}` : "PDB entry"}${chain ? ` chain ${chain}` : ""}`,
      kind: homolog ? "Experimental structure of a sequence homolog" : "Experimental structure mapped to this protein",
      detail: methodLine(prov),
      href: id ? `https://www.rcsb.org/structure/${id}` : null,
      channel: temperatureChannel(),
      // `/pdb/:accession` provenance lacks the residue-level validation marker returned by
      // `/pdb/entry`; an experimental source alone is not enough to address a UniProt site.
      numbering: "unknown",
    };
  }
  if (source === "client-provided") {
    return {
      origin: "client",
      role,
      name: "Structure supplied by the client",
      kind: "Coordinates supplied with the request",
      detail: null,
      href: null,
      channel: UNKNOWN_CHANNEL,
      numbering: "unknown",
    };
  }
  return {
    origin: "unknown",
    role,
    name: "Structure source not reported",
    kind: "Coordinates of unreported origin",
    detail: null,
    href: null,
    channel: UNKNOWN_CHANNEL,
    numbering: "unknown",
  };
}

function identifyLoadedEntry(url: string, homologs: HomologLike[], entry: LoadedEntryMeta | null): CoordinateIdentity {
  const id = pdbIdFromUrl(url);
  const hit = id ? homologs.find(h => upper(h.pdbId) === id) : undefined;
  const renumbered = entry?.numbering === "uniprot" && !!entry.chainId;
  return {
    origin: "pdb-entry",
    role: "wild type",
    name: id ? `PDB ${id}${renumbered ? ` chain ${entry!.chainId}` : ""}` : "PDB entry",
    kind: renumbered
      ? `Experimental entry, the chain mapped to this protein, in UniProt numbering (${entry!.mapping === "sifts" ? "PDBe SIFTS" : "sequence alignment"})`
      : "Experimental entry, all chains, in its own numbering",
    detail: methodLine({ method: hit?.method ?? null, resolution: hit?.resolution ?? null }),
    href: id ? `https://www.rcsb.org/structure/${id}` : null,
    channel: temperatureChannel(),
    numbering: renumbered ? "uniprot" : "entry",
  };
}

/** BuildModel's paired wild type: the template after RepairPDB, repacked in the variant's own run. */
function identifyFoldxPairedWildType(template: CoordinateIdentity, runs: number | null): CoordinateIdentity {
  const variantLike = identifyFoldxVariant(template, null);
  return {
    ...variantLike,
    origin: "foldx-variant",
    role: "template",
    name: `FoldX wild type on ${template.name}`,
    kind: "FoldX BuildModel's paired wild type: the repaired template, repacked in the same run as the variant",
    detail: runs ? `Paired with the first of ${runs} BuildModel runs` : null,
  };
}

function identifyFoldxVariant(template: CoordinateIdentity, runs: number | null): CoordinateIdentity {
  const inherited: BFactorChannel =
    template.channel.kind === "plddt"
      ? plddtChannel(template.channel.scale, "AlphaFold", true)
      : template.channel.kind === "temperature-factor"
        ? temperatureChannel(true)
        : { ...UNKNOWN_CHANNEL, inherited: true };
  return {
    origin: "foldx-variant",
    role: "variant",
    name: `FoldX variant on ${template.name}`,
    kind: "FoldX BuildModel variant: side chains repacked on the template's fixed backbone",
    detail: runs ? `First of ${runs} BuildModel runs` : "BuildModel run count not reported",
    href: null,
    channel: inherited,
    numbering: template.numbering,
  };
}

export function describeDeNovoEngine(engine: string | null | undefined): { name: string; model: string; scale: 1 | 100 | null } | null {
  if (!engine) return null;
  return (DE_NOVO_ENGINES as Record<string, { name: string; model: string; scale: 1 | 100 | null }>)[engine] ?? null;
}

function identifyDeNovo(role: "wild type" | "variant", engine: string | null, scale: 1 | 100 | null): CoordinateIdentity {
  const known = describeDeNovoEngine(engine);
  const effectiveScale = known?.scale ?? scale;
  return {
    origin: "de-novo",
    role,
    name: known ? `${known.model} ${role}` : `De novo ${role}`,
    kind: "Single-sequence de novo prediction",
    detail: known ? `Folded by ${known.name}` : "The folding engine was not reported by the server",
    href: null,
    channel: plddtChannel(effectiveScale, known?.model ?? "de novo"),
    numbering: "uniprot",
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * The model
 * ──────────────────────────────────────────────────────────────────────────── */

export function buildStructure3dEvidence(input: Structure3dInput): Structure3dEvidence {
  const { family, viewMode, variant, foldx, deNovo, metrics } = input;
  const isAf = family === "alphafold";
  const position = variant.position;
  const wt3 = toThree(variant.wildType);
  const mt3 = toThree(variant.mutant);
  const mt1 = toOne(variant.mutant);
  const wt1 = toOne(variant.wildType);

  /* ── Structures ──────────────────────────────────────────────────────── */
  /** De novo pLDDT scale as read from the file; an engine known to write 0–1 overrides it. */
  const deNovoScale: 1 | 100 | null =
    deNovo.scan?.max === null || deNovo.scan?.max === undefined ? null : deNovo.scan.max <= 1 ? 1 : 100;
  const canvasWildType: CoordinateIdentity | null = isAf
    ? input.wildType.customPdbUrl
      ? identifyLoadedEntry(input.wildType.customPdbUrl, input.homologs, input.wildType.entry ?? null)
      : identifyFromProvenance(input.wildType.provenance, variant.uniprotId, "wild type", input.wildType.headerSaysAlphaFold)
    : deNovo.wildTypeLoaded
      ? identifyDeNovo("wild type", deNovo.engines?.wildType ?? null, deNovoScale)
      : null;

  const foldxTemplate: CoordinateIdentity | null =
    isAf && foldx.template ? identifyFromProvenance(foldx.template, variant.uniprotId, "template") : null;
  const foldxVariant: CoordinateIdentity | null =
    isAf && foldx.status === "success" && foldxTemplate ? identifyFoldxVariant(foldxTemplate, foldx.runs) : null;
  const deNovoVariant: CoordinateIdentity | null =
    !isAf && deNovo.variantLoaded && !deNovo.singleStructure
      ? identifyDeNovo("variant", deNovo.engines?.variant ?? null, deNovoScale)
      : null;

  /** Does the AlphaFold model on the canvas descend from the same coordinates FoldX used? */
  const templateIsCanvasWildType =
    !!foldxTemplate &&
    !!canvasWildType &&
    !input.wildType.customPdbUrl &&
    foldxTemplate.origin === canvasWildType.origin &&
    (foldxTemplate.origin === "afdb" || upper(foldx.template?.pdbId) === upper(input.wildType.provenance?.pdbId));

  /* ── Modes ───────────────────────────────────────────────────────────── */
  const mutantReason: string | null = isAf
    ? foldx.running
      ? `FoldX is running${foldx.phaseLabel ? `: ${foldx.phaseLabel.toLowerCase()}` : ""}.`
      : foldx.status === "success"
        ? foldxTemplate
          ? null
          : "FoldX did not report which structure it built on, so its model is not shown."
        : foldx.status === "unavailable"
          ? "FoldX is not available on this server."
          : foldx.status === "failed"
            ? `FoldX did not produce a variant model${foldx.error ? `: ${foldx.error}` : "."}`
            : "FoldX has not run for this variant."
    : deNovo.folding
      ? "Folding the wild type and the variant."
      : deNovo.error
        ? "De novo folding did not return coordinates."
        : deNovo.singleStructure
          ? "The server returned one structure, so there is no separate variant model."
          : deNovo.variantLoaded
            ? null
            : "No de novo variant model yet.";

  const referenceReady = isAf ? foldx.reference.state === "ready" && foldx.aligned : deNovo.aligned;
  const superReason: string | null =
    mutantReason ??
    (isAf
      ? foldx.reference.state === "loading" || (foldx.reference.state === "ready" && !foldx.aligned)
        ? "Superposing the variant on its template."
        : foldx.reference.state === "unavailable"
          ? foldx.reference.reason ?? "The template FoldX used could not be loaded."
          : referenceReady
            ? null
            : "The superposition has not been computed."
      : referenceReady
        ? null
        : "The superposition has not been computed.");

  const modes: ModeOption[] = [
    {
      id: "wildtype",
      label: "Wild type",
      available: isAf ? true : deNovo.wildTypeLoaded,
      reason: isAf ? null : deNovo.wildTypeLoaded ? null : deNovo.folding ? "Folding the wild type." : "No de novo wild-type model.",
      busy: !isAf && deNovo.folding,
    },
    {
      id: "mutant",
      label: "Variant",
      available: mutantReason === null,
      reason: mutantReason,
      busy: isAf ? foldx.running : deNovo.folding,
    },
    {
      id: "superimposed",
      label: "Superposition",
      available: superReason === null,
      reason: superReason,
      busy: isAf ? foldx.running || foldx.reference.state === "loading" : deNovo.folding,
    },
  ];
  const effectiveMode: ViewMode = modes.find(m => m.id === viewMode)?.available ? viewMode : "wildtype";

  /* ── What is on the canvas in this mode ───────────────────────────────── */
  const template: CoordinateIdentity | null = isAf ? foldxTemplate : canvasWildType;
  const variantModel: CoordinateIdentity | null = isAf ? foldxVariant : deNovoVariant;
  let primary: CoordinateIdentity | null = canvasWildType;
  let secondary: CoordinateIdentity | null = null;
  if (effectiveMode === "mutant") primary = variantModel;
  const pairedByFoldx = isAf && foldx.reference.state === "ready" && foldx.reference.basis === "foldx-paired";
  if (effectiveMode === "superimposed") {
    primary = template
      ? pairedByFoldx
        ? identifyFoldxPairedWildType(template, foldx.runs)
        : { ...template, role: "template" }
      : canvasWildType;
    secondary = variantModel
      ? {
          ...variantModel,
          channel: isAf
            ? { ...variantModel.channel, note: "FoldX keeps the template backbone fixed; its Cα displacement is not a variant measurement." }
            : {
                kind: "displacement",
                inherited: false,
                scale: null,
                note: "B-factor column rewritten by the superposition: each residue's Cα displacement in Å.",
              },
        }
      : null;
  }

  /* ── Representations ──────────────────────────────────────────────────── */
  const primaryChannel = primary?.channel ?? UNKNOWN_CHANNEL;
  const confidenceLabel =
    primaryChannel.kind === "plddt"
      ? primaryChannel.inherited
        ? "Template pLDDT (copied)"
        : "pLDDT"
      : primaryChannel.kind === "temperature-factor"
        ? primaryChannel.inherited
          ? "Template B-factor (copied)"
          : "B-factor, relative"
        : "Confidence";
  // ESM3 scores compare the two sequences. They can be projected onto a numbered predicted
  // wild type, but are not an experimental measurement or a property of a FoldX variant model.
  const esm3ProjectionReady =
    effectiveMode === "wildtype" && primary?.numbering === "uniprot" &&
    (primary.origin === "afdb" || primary.origin === "de-novo");
  const rigid = isAf;
  const representations: RepresentationOption[] = [
    {
      id: "confidence",
      label: confidenceLabel,
      available: primaryChannel.kind === "plddt" || primaryChannel.kind === "temperature-factor",
      reason:
        primaryChannel.kind === "unknown"
          ? "The B-factor column's meaning is not reported for these coordinates."
          : null,
    },
    {
      id: effectiveMode === "superimposed" ? "pair" : "plain",
      label: effectiveMode === "superimposed" ? REPRESENTATION_LABELS.pair : REPRESENTATION_LABELS.plain,
      available: true,
      reason: null,
    },
    ...(effectiveMode === "superimposed" && !rigid
      ? [
          {
            id: "displacement" as const,
            label: REPRESENTATION_LABELS.displacement,
            available: referenceReady,
            reason: referenceReady ? null : "No superposition to measure.",
          },
        ]
      : effectiveMode === "wildtype"
      ? [
          {
            id: "esm3" as const,
            label: REPRESENTATION_LABELS.esm3,
            available: Boolean(input.esm3?.scoreCount) && esm3ProjectionReady,
            reason: !input.esm3
              ? "ESM3 was not run for this variant."
              : input.esm3.error
                ? `ESM3 did not return scores: ${input.esm3.error}`
                : !input.esm3.scoreCount
                  ? "ESM3 returned no per-residue scores."
                  : esm3ProjectionReady
                    ? null
                    : "ESM3 sequence scores are projected only onto a numbered predicted wild-type model.",
          },
        ] : []),
  ];

  const preferred: RepresentationId =
    effectiveMode === "superimposed" && input.representation === "plain"
      ? "pair"
      : effectiveMode !== "superimposed" && (input.representation === "pair" || input.representation === "displacement")
        ? "confidence"
        : input.representation;
  const chosen = representations.find(r => r.id === preferred && r.available);
  const fallback =
    effectiveMode === "superimposed"
      ? representations.find(r => r.id === "displacement" && r.available) ?? representations.find(r => r.id === "pair")!
      : representations.find(r => r.id === "confidence" && r.available) ?? representations.find(r => r.id === "plain")!;
  const representation = (chosen ?? fallback).id;

  /* ── Colour plan and its legend ───────────────────────────────────────── */
  const confidenceTheme = (channel: BFactorChannel): ThemePlan =>
    channel.kind === "plddt"
      ? { theme: "plddt", scale: channel.scale ?? 100 }
      : channel.kind === "temperature-factor"
        ? { theme: "bfactor-quartile" }
        : { theme: "uniform", color: PLAIN_COLOUR, alpha: 1 };

  let colour: ColourPlan;
  let legend: Legend | null;
  const plddtLegend = (inherited: boolean, scale: 1 | 100 | null): Legend => ({
    title: inherited ? "Template pLDDT, copied onto the variant" : "pLDDT",
    provenance: "published",
    provenanceNote: isAf
      ? `AlphaFold DB bands (Jumper 2021; Varadi 2022)${scale === 1 ? " · file stores 0–1, read ×100" : ""}`
      : `pLDDT bands used as a display convention; this de novo engine's confidence is not AlphaFold DB confidence${scale === 1 ? " · file stores 0–1, read ×100" : ""}`,
    entries: STRUCTURE_COLOUR_BANDS.plddt.map(b => ({ label: b.label, range: b.range, color: b.color })),
  });
  const quartileLegend = (inherited: boolean): Legend => ({
    title: inherited ? "Template B-factor, copied onto the variant" : "B-factor",
    provenance: "relative",
    provenanceNote: "Quartiles of this entry's own Cα B-factors — mobility in the crystal, not confidence",
    entries: STRUCTURE_COLOUR_BANDS.bFactorQuartile.map(b => ({ label: b.label, range: null, color: b.color })),
  });

  if (representation === "confidence") {
    colour = {
      primary: confidenceTheme(primaryChannel),
      secondary: secondary ? { theme: "uniform", color: PAIR_COLOURS.variant, alpha: 0.85 } : null,
      secondaryCartoon: !rigid,
    };
    legend =
      primaryChannel.kind === "plddt"
        ? plddtLegend(primaryChannel.inherited, primaryChannel.scale)
        : primaryChannel.kind === "temperature-factor"
          ? quartileLegend(primaryChannel.inherited)
          : null;
    if (legend && secondary) {
      legend.entries = [...legend.entries, { label: rigid ? "Variant residue" : "Variant", range: null, color: PAIR_COLOURS.variant }];
    }
  } else if (representation === "pair") {
    colour = {
      primary: { theme: "uniform", color: PAIR_COLOURS.template, alpha: rigid ? 1 : 0.55 },
      secondary: { theme: "uniform", color: PAIR_COLOURS.variant, alpha: 1 },
      secondaryCartoon: !rigid,
    };
    legend = {
      title: "Superposition",
      provenance: "pair",
      provenanceNote: rigid
        ? "Colours identify the two structures only. The backbones coincide, so the variant is drawn at its residue"
        : "Colours identify the two structures only",
      entries: [
        { label: isAf ? "Template (wild type)" : "Wild type", range: null, color: PAIR_COLOURS.template },
        { label: rigid ? "Variant residue" : "Variant", range: null, color: PAIR_COLOURS.variant },
      ],
    };
  } else if (representation === "displacement") {
    colour = {
      primary: { theme: "uniform", color: PAIR_COLOURS.template, alpha: 0.35 },
      secondary: { theme: "displacement" },
      secondaryCartoon: true,
    };
    legend = {
      title: "Cα displacement after superposition",
      provenance: "app-defined",
      provenanceNote: "This app's own marks, not published cut-points",
      entries: [
        ...STRUCTURE_COLOUR_BANDS.displacement.map(b => ({ label: b.label, range: null, color: b.color })),
        { label: "Wild type", range: null, color: PAIR_COLOURS.template },
      ],
    };
  } else if (representation === "esm3") {
    const d = THRESHOLDS.esm3Drift;
    colour = { primary: { theme: "esm3" }, secondary: null, secondaryCartoon: false };
    legend = {
      title: "ESM3 sequence shift on wild type",
      provenance: "app-defined",
      provenanceNote: "Wild-type versus variant sequence embeddings, projected by residue onto the predicted wild-type coordinates. App-defined bands; not structural movement or allostery.",
      entries: [
        { label: `< ${d.none}`, range: null, color: STRUCTURE_COLOUR_BANDS.esm3Shift[0] },
        { label: `${d.none}–${d.minor}`, range: null, color: STRUCTURE_COLOUR_BANDS.esm3Shift[1] },
        { label: `${d.minor}–${d.moderate}`, range: null, color: STRUCTURE_COLOUR_BANDS.esm3Shift[2] },
        { label: `≥ ${d.moderate}`, range: null, color: STRUCTURE_COLOUR_BANDS.esm3Shift[3] },
        { label: "No score", range: null, color: STRUCTURE_COLOUR_BANDS.none },
      ],
    };
  } else {
    colour = { primary: { theme: "uniform", color: PLAIN_COLOUR, alpha: 1 }, secondary: null, secondaryCartoon: false };
    legend = null;
  }

  const plddtFilter = {
    available: effectiveMode !== "superimposed" && primaryChannel.kind === "plddt",
    reason:
      effectiveMode === "superimposed"
        ? "The filter applies to one structure at a time."
        : primaryChannel.kind === "temperature-factor"
          ? "These coordinates carry temperature factors, not pLDDT; a pLDDT cut would keep the most mobile atoms."
          : primaryChannel.kind === "plddt"
            ? null
            : "The B-factor column is not known to hold pLDDT.",
    scale: primaryChannel.kind === "plddt" ? primaryChannel.scale ?? 100 : null,
  };

  /* ── Comparison ───────────────────────────────────────────────────────── */
  const scope: AlignmentScope = isAf ? "global" : input.alignmentScope;
  // The readings and the drawn pair describe the fit the aligner applied, which trails the
  // toggle while a new fit runs (and is whole-chain when a local fit had too few pairs).
  const measuredScope: AlignmentScope = isAf ? "global" : metrics?.alignmentScope ?? scope;
  const fitWords = (s: AlignmentScope) => (s === "global" ? "whole chain" : `±${LOCAL_ALIGNMENT_FIT_WINDOW} residues around ${position ?? "the site"}`);
  const fitLabel = fitWords(scope);
  let comparison: Comparison;
  if (isAf) {
    const canvasWildTypeIsNotTemplate = !!foldxTemplate && !templateIsCanvasWildType;
    if (foldx.status !== "success" || !foldxVariant) {
      comparison = {
        state: foldx.running ? "pending" : "unavailable",
        headline: foldx.running ? "Waiting for the FoldX model" : "No variant model to compare",
        reason: mutantReason,
        template: foldxTemplate,
        variant: null,
        rigidBackbone: true,
        fit: null,
        canvasWildTypeIsNotTemplate,
      };
    } else if (!referenceReady) {
      comparison = {
        state: foldx.reference.state === "unavailable" ? "unavailable" : "pending",
        headline: foldx.reference.state === "unavailable" ? "The template could not be paired" : "Superposing on the template",
        reason: superReason,
        template: foldxTemplate,
        variant: foldxVariant,
        rigidBackbone: true,
        fit: null,
        canvasWildTypeIsNotTemplate,
      };
    } else {
      comparison = {
        state: "ready",
        headline: pairedByFoldx
          ? `Variant against FoldX's own wild type on ${foldxTemplate!.name}`
          : `Variant against its own template, ${foldxTemplate!.name}`,
        reason: null,
        template: foldxTemplate,
        variant: foldxVariant,
        rigidBackbone: true,
        fit: "whole chain",
        canvasWildTypeIsNotTemplate,
      };
    }
  } else {
    comparison =
      deNovoVariant && deNovo.aligned
        ? {
            state: "ready",
            headline: "Two independent de novo predictions",
            reason: null,
            template: canvasWildType,
            variant: deNovoVariant,
            rigidBackbone: false,
            fit: fitWords(measuredScope),
            canvasWildTypeIsNotTemplate: false,
          }
        : {
            state: deNovo.folding ? "pending" : "unavailable",
            headline: deNovo.folding ? "Folding" : "No de novo pair to compare",
            reason: mutantReason ?? superReason,
            template: canvasWildType,
            variant: deNovoVariant,
            rigidBackbone: false,
            fit: null,
            canvasWildTypeIsNotTemplate: false,
          };
  }

  /* ── Readings ─────────────────────────────────────────────────────────── */
  const readings: Reading[] = [];
  if (comparison.state === "ready" && metrics) {
    if (!comparison.rigidBackbone) {
    const local = fmt(metrics.localWindowRmsd, 2);
    readings.push({
      key: "local-rmsd",
      label: "Local Cα RMSD",
      note: `±${LOCAL_STRUCTURAL_WINDOW} residues around ${position ?? "the site"}`,
      value: local ? `${local} Å` : null,
      state: local ? "measured" : "not-measured",
      caveat: measuredScope === "local"
          ? `Measured inside the ±${LOCAL_ALIGNMENT_FIT_WINDOW} fitted window, so small by construction.`
          : null,
    });
    const global = fmt(metrics.globalRmsd, 2);
    readings.push({
      key: "global-rmsd",
      label: "Whole-chain Cα RMSD",
      note: measuredScope === "global" ? "after a whole-chain fit" : `in the ±${LOCAL_ALIGNMENT_FIT_WINDOW} frame, not a whole-chain fit`,
      value: global ? `${global} Å` : null,
      state: global ? "measured" : "not-measured",
      caveat: "Two separate predictions: part of any difference can come from the predictions, not the substitution.",
    });
    const shift = fmt(metrics.maxCaDisplacement, 2);
    readings.push({
      key: "max-shift",
      label: "Largest Cα shift",
      note: `within ±${LOCAL_STRUCTURAL_WINDOW} residues`,
      value: shift ? `${shift} Å` : null,
      state: shift ? "measured" : "not-measured",
      caveat: null,
    });
    }
    // Older results carry no paired wild type: the variant is then read against the template as
    // fetched, before RepairPDB, and the repair's own side-chain moves count as differences.
    const unrepaired =
      isAf && foldx.reference.basis === "template"
        ? "Read against the template before RepairPDB, so part of this can be the repair's side-chain changes rather than the substitution's."
        : null;
    const noChi = (code: string | null) => code === "G" || code === "A";
    const chiNA = noChi(mt1) || noChi(wt1);
    const dev = fmt(metrics.chi1Deviation, 0);
    readings.push({
      key: "chi1",
      label: "χ1 change at the site",
      note: "side-chain rotamer",
      value: chiNA ? null : dev ? `${dev}°` : null,
      state: chiNA ? "not-applicable" : dev ? "measured" : "not-measured",
      caveat: chiNA ? `${noChi(mt1) ? toThree(mt1) : toThree(wt1)} has no χ1, so there is no angle to compare.` : dev ? unrepaired : null,
    });
    const wtS = fmt(metrics.wtSasa, 0);
    const mtS = fmt(metrics.mutSasa, 0);
    readings.push({
      key: "sasa",
      label: "Site accessible surface",
      note: "wild type → variant residue",
      value: wtS && mtS ? `${wtS} → ${mtS} Å²` : null,
      state: wtS && mtS ? "measured" : "not-measured",
      caveat:
        wt1 && mt1 && wt1 !== mt1
          ? "Different residues: a smaller side chain exposes less surface whatever the fold does."
          : null,
    });
    const countPair = (lost: number | null | undefined, gained: number | null | undefined) =>
      lost === null || lost === undefined || gained === null || gained === undefined ? null : `${lost} lost · ${gained} gained`;
    const polar = countPair(metrics.lostHBonds, metrics.gainedHBonds);
    readings.push({
      key: "polar",
      label: "Polar contacts at the site",
      note: "N/O/S pairs ≤ 3.5 Å, no angle test — a proxy for hydrogen bonds",
      value: polar,
      state: polar ? "measured" : "not-measured",
      caveat: polar ? unrepaired : null,
    });
    const contacts = countPair(metrics.lostContacts, metrics.gainedContacts);
    readings.push({
      key: "contacts",
      label: "Residue contacts at the site",
      note: "heavy atoms ≤ 4.0 Å, neighbours ±1 excluded",
      value: contacts,
      state: contacts ? "measured" : "not-measured",
      caveat: contacts ? unrepaired : null,
    });
  }

  /* ── Site ─────────────────────────────────────────────────────────────── */
  const siteStructure = isAf ? input.wildType.site : deNovo.site;
  const siteIdentity = canvasWildType;
  const canAddressVariantSite = siteIdentity?.numbering === "uniprot";
  const expected = wt3 ? wt3.toUpperCase() : null;
  let check: SiteContext["check"];
  if (!canAddressVariantSite && siteIdentity && siteStructure && expected && siteStructure.resName !== expected) {
    check = {
      state: "mismatch",
      text: `The structure has ${toThree(siteStructure.resName) ?? siteStructure.resName} at ${position}, not ${wt3}: its numbering does not follow UniProt here, so the highlighted residue is not the variant's.`,
    };
  } else if (!canAddressVariantSite && siteIdentity) {
    check = { state: "unknown", text: `${siteIdentity.name} keeps entry numbering, so the variant's UniProt residue is not highlighted or compared.` };
  } else if (!siteStructure) {
    check = siteIdentity
      ? { state: "absent", text: `Residue ${position ?? "?"} is not in ${siteIdentity.name}.` }
      : { state: "unknown", text: "No wild-type coordinates loaded." };
  } else if (!expected) {
    check = { state: "unknown", text: `${toThree(siteStructure.resName) ?? siteStructure.resName} at ${position} in the structure.` };
  } else if (siteStructure.resName === expected) {
    check = { state: "match", text: `${wt3} ${position} in the structure matches the variant's wild-type residue.` };
  } else {
    check = {
      state: "mismatch",
      text: `The structure has ${toThree(siteStructure.resName) ?? siteStructure.resName} at ${position}, not ${wt3}: its numbering does not follow UniProt here, so the highlighted residue is not the variant's.`,
    };
  }

  let confidence: SiteContext["confidence"] = { kind: "none", value: null, text: "Not read", note: "No wild-type coordinates at the site." };
  const siteB = siteStructure?.caBFactor ?? null;
  const channel = siteIdentity?.channel;
  if (siteB !== null && canAddressVariantSite && channel?.kind === "plddt") {
    const value = channel.scale === 1 ? siteB * 100 : siteB;
    const band = plddtBand(value);
    confidence = {
      kind: "plddt",
      value,
      text: `pLDDT ${value.toFixed(1)} · ${band.label.toLowerCase()}`,
      note: isAf
        ? `From ${siteIdentity!.name}, this view's wild type; AlphaFold DB band ${band.range}.`
        : `From ${siteIdentity!.name}, this view's wild type; displayed in the ${band.label.toLowerCase()} pLDDT band, not an AlphaFold DB classification.`,
    };
  } else if (siteB !== null && channel?.kind === "temperature-factor") {
    const scan = isAf ? input.wildType.scan : null;
    const q = quartileOf(siteB, scan);
    confidence = {
      kind: "b-factor",
      value: siteB,
      text: `B-factor ${siteB.toFixed(1)} Å²${q !== null ? ` · ${QUARTILE_WORDS[q]} of this entry` : ""}`,
      note: "A crystallographic temperature factor measures mobility in the crystal; it is not a confidence score.",
    };
  } else if (siteStructure && channel) {
    confidence = { kind: "none", value: null, text: "Not interpreted", note: channel.note };
  }

  const substitution = wt3 && mt3 && position !== null ? `${wt3}${position}${mt3}` : null;
  const site: SiteContext = {
    position,
    substitution,
    check,
    confidence,
    region: input.region,
    burial:
      input.burial && (input.burial.label || input.burial.rsa !== null)
        ? `${input.burial.label ?? "Accessibility measured"}${input.burial.rsa !== null ? ` · RSA ${Math.round(input.burial.rsa * 100)}%` : ""}${input.burial.structure ? ` · on ${input.burial.structure}` : ""}`
        : null,
    selected: input.selectedResidue !== null && input.selectedResidue !== position ? input.selectedResidue : null,
    canAddressVariantSite,
  };

  /* ── Notices ──────────────────────────────────────────────────────────── */
  const notices: Notice[] = [];
  if (isAf && foldxTemplate && comparison.canvasWildTypeIsNotTemplate && effectiveMode !== "wildtype") {
    notices.push({
      key: "template",
      tone: "info",
      title: "The variant is not built on the wild type shown",
      body: `FoldX built the variant on ${foldxTemplate.name}${input.wildType.customPdbUrl ? "" : `, not on ${canvasWildType?.name ?? "the AlphaFold model"}`}. The superposition and its measurements pair the variant with ${pairedByFoldx ? "FoldX's own wild type on that template" : "that template"}, so they describe the substitution rather than the difference between two structures.`,
    });
  }
  if (check.state === "mismatch") {
    notices.push({ key: "numbering", tone: "warning", title: "Highlighted residue is not the variant's", body: check.text });
  }
  if (!isAf && deNovo.engines?.wildType && deNovo.engines?.variant && deNovo.engines.wildType !== deNovo.engines.variant) {
    notices.push({
      key: "engines",
      tone: "warning",
      title: "Wild type and variant came from different engines",
      body: `The wild type was folded by ${describeDeNovoEngine(deNovo.engines.wildType)?.name ?? deNovo.engines.wildType} and the variant by ${describeDeNovoEngine(deNovo.engines.variant)?.name ?? deNovo.engines.variant}. Their differences mix two models' behaviour with the substitution; do not read the superposition as the variant's effect.`,
    });
  }
  if (!isAf && deNovo.singleStructure) {
    notices.push({
      key: "single",
      tone: "info",
      title: "One structure returned",
      body: "The folding service returned a single structure. It is shown as the wild type; there is no variant model to compare.",
    });
  }
  if (input.wildType.customPdbUrl && isAf) {
    const entry = input.wildType.entry ?? null;
    notices.push({
      key: "entry",
      tone: "info",
      title: "Showing a PDB entry you loaded",
      body: !entry
        ? "Loading the entry. The variant model and the superposition still refer to FoldX's template."
        : entry.numbering === "uniprot" && entry.chainId
          ? `Chain ${entry.chainId} is shown, renumbered to UniProt residue by residue through ${entry.mapping === "sifts" ? "PDBe's SIFTS mapping" : "a sequence alignment"}; other chains are left out${
              entry.unmappedResidues ? `, and so ${entry.unmappedResidues === 1 ? "is 1 residue" : `are ${entry.unmappedResidues} residues`} with no UniProt position (tags, linkers or insertions)` : ""
            }. The variant model and the superposition still refer to FoldX's template.`
          : `The entry keeps its own residue numbering and all of its chains${entry.reason ? `: ${sentenceTail(entry.reason)}` : ""}. The variant model and the superposition still refer to FoldX's template.`,
    });
  }

  /* ── Trace ────────────────────────────────────────────────────────────── */
  const trace: TraceStep[] = [];
  trace.push({
    n: 1,
    label: "Wild-type coordinates",
    value: canvasWildType ? canvasWildType.name : isAf ? "Loading" : deNovo.folding ? ENGINE_STATE_LABELS.running : ENGINE_STATE_LABELS["no-result"],
    sub: canvasWildType ? [canvasWildType.kind, canvasWildType.detail].filter(Boolean).join(" · ") : null,
    state: canvasWildType ? (canvasWildType.origin === "unknown" ? "warn" : "done") : "idle",
    warn: canvasWildType?.origin === "unknown" ? "The server did not say where these coordinates came from." : null,
  });
  if (isAf) {
    const ddG = foldx.ddG;
    trace.push({
      n: 2,
      label: "Variant model",
      value: foldxVariant
        ? `FoldX on ${foldxTemplate!.name}`
        : foldx.running
          ? `FoldX ${foldx.phaseLabel ? foldx.phaseLabel.toLowerCase() : "running"}`
          : mutantReason ?? ENGINE_STATE_LABELS["no-result"],
      sub: foldxVariant
        ? [
            ddG !== null ? `ΔΔG ${signed(ddG, 2)}${foldx.ddGSd !== null ? ` ± ${foldx.ddGSd.toFixed(2)}` : ""} kcal/mol${foldx.runs ? ` over ${foldx.runs} runs` : ""} — a stability estimate, not pathogenicity` : null,
            foldx.repairSkipped
              ? `Template not repaired${foldx.repairSkippedReason === "alphafold-plddt" ? " (AlphaFold model)" : foldx.repairSkippedReason === "large-structure" ? " (large structure)" : ""}`
              : foldx.repairFailed
                ? "RepairPDB failed; built on the unrepaired template"
                : "Built on the RepairPDB-minimised template",
          ]
            .filter(Boolean)
            .join(" · ")
        : null,
      state: foldxVariant ? "done" : foldx.status === "failed" ? "warn" : "idle",
      warn: null,
    });
  } else {
    const engineName = describeDeNovoEngine(deNovo.engines?.variant ?? deNovo.engines?.wildType)?.name ?? null;
    // The failure's own explanation, hedged for a timeout: a client abort carries no information
    // about the provider's load (see `describeDeNovoFoldTimeout`).
    const failure = deNovo.error
      ? isFoldingTimeoutError(deNovo.error)
        ? describeDeNovoFoldTimeout({ verbosity: "brief" })
        : deNovo.error
      : null;
    trace.push({
      n: 2,
      label: "Variant model",
      value: deNovoVariant
        ? deNovoVariant.name
        : deNovo.folding
          ? ENGINE_STATE_LABELS.running
          : deNovo.error
            ? "De novo folding failed"
            : mutantReason ?? ENGINE_STATE_LABELS["no-result"],
      sub: deNovoVariant
        ? `${engineName ? `Folded by ${engineName}` : "Engine not reported"} · the variant sequence folded separately from the wild type`
        : failure,
      state: deNovoVariant ? (notices.some(n => n.key === "engines") ? "warn" : "done") : deNovo.error ? "warn" : "idle",
      warn: notices.some(n => n.key === "engines") ? "Different engines folded the two sequences." : null,
    });
  }
  trace.push({
    n: 3,
    label: "Superposition",
    value:
      comparison.state === "ready"
        ? `Kabsch fit on Cα, ${comparison.fit}`
        : comparison.state === "pending"
          ? ENGINE_STATE_LABELS.running
          : "Not computed",
    sub:
      comparison.state === "ready"
        ? comparison.rigidBackbone
          ? pairedByFoldx
            ? `FoldX's own wild type and variant on ${comparison.template?.name ?? "the template"}, from one run. The backbone is fixed, so only side chains can differ.`
            : `${comparison.template?.name ?? "Template"} as fetched + FoldX variant. The backbone is fixed, so only side chains can differ; the template was not repaired, so RepairPDB's side-chain changes count as differences too.`
          : "Wild-type and variant predictions."
        : comparison.reason,
    state: comparison.state === "ready" ? "done" : comparison.state === "unavailable" && (isAf ? foldx.status === "success" : deNovo.variantLoaded) ? "warn" : "idle",
    warn: comparison.canvasWildTypeIsNotTemplate && comparison.state === "ready"
      ? `Paired with ${pairedByFoldx ? "FoldX's own wild type" : "FoldX's template"}, not with ${canvasWildType?.name ?? "the wild type on the canvas"}.`
      : null,
  });
  trace.push({
    n: 4,
    label: "Colour",
    value: legend ? legend.title : REPRESENTATION_LABELS[representation],
    sub: legend ? legend.provenanceNote : "Uniform colour; no value is encoded.",
    state: "done",
    warn: null,
  });
  trace.push({
    n: 5,
    label: "Engine record",
    value: "Informational — no ACMG criterion",
    sub: "The rule engine reads no 3D measurement.",
    state: "done",
    warn: null,
  });

  /* ── Experimental structures ──────────────────────────────────────────── */
  const loadedId = pdbIdFromUrl(input.wildType.customPdbUrl);
  // With the variant's accession, position and residue, the server returns the mapped chain in
  // UniProt numbering; without them, the whole entry in its own.
  const entryUrl = (id: string) =>
    variant.uniprotId && position !== null && wt1
      ? `/api/v1/pdb/entry/${id}?uniprot=${encodeURIComponent(variant.uniprotId)}&pos=${position}&wt=${wt1}`
      : `/api/v1/pdb/entry/${id}`;
  const rows: ExperimentalRow[] = input.homologs.map(h => {
    const hasRange = typeof h.querySeqFrom === "number" && typeof h.querySeqTo === "number";
    const covers: ExperimentalRow["coversSite"] =
      position !== null && hasRange ? (position >= h.querySeqFrom! && position <= h.querySeqTo! ? "yes" : "no") : "unknown";
    return {
      pdbId: h.pdbId.toUpperCase(),
      title: h.title ?? null,
      organism: h.organism ?? null,
      method: h.method ?? null,
      resolution: typeof h.resolution === "number" && Number.isFinite(h.resolution) ? `${h.resolution} Å` : null,
      identity: typeof h.identity === "number" && Number.isFinite(h.identity) ? `${h.identity}%` : "Not reported",
      range: hasRange ? `${h.querySeqFrom}–${h.querySeqTo}` : null,
      coversSite: covers,
      loaded: loadedId === h.pdbId.toUpperCase(),
      url: entryUrl(h.pdbId.toUpperCase()),
    };
  });
  const bestCandidates = rows
    .map((row, i) => ({ row, h: input.homologs[i] }))
    .filter(({ row, h }) => row.coversSite === "yes" && typeof h.identity === "number");
  bestCandidates.sort(
    (a, b) => (b.h.identity! - a.h.identity!) || ((a.h.resolution ?? 99) - (b.h.resolution ?? 99))
  );
  const best = isAf ? bestCandidates[0]?.row ?? null : null;
  const loadedRow = rows.find(row => row.loaded);
  const relationshipNote =
    isAf && input.wildType.customPdbUrl && loadedRow
      ? loadedRow.identity === "100%"
        ? "This experimental entry and AlphaFold represent the same wild-type protein sequence across the aligned range. A similar ribbon fold is expected; this view has not calculated an AlphaFold–PDB coordinate RMSD."
        : "This experimental entry is related to the queried protein. A similar ribbon fold does not mean the coordinates are identical; this view has not calculated an AlphaFold–PDB coordinate RMSD."
      : null;

  /* ── Notes and sources ────────────────────────────────────────────────── */
  const notes: string[] = [];
  const sources: { citation: string; doi: string }[] = [];
  const addSource = (key: keyof typeof STRUCTURE_SOURCES) => {
    if (!sources.some(s => s.doi === STRUCTURE_SOURCES[key].doi)) sources.push(STRUCTURE_SOURCES[key]);
  };
  if (isAf) {
    notes.push("pLDDT is AlphaFold's per-residue estimate of local accuracy. It says how far to trust the coordinates, not whether the residue matters.");
    addSource("jumper2021");
    addSource("varadi2022");
    if (foldxTemplate?.channel.kind === "temperature-factor" || canvasWildType?.channel.kind === "temperature-factor") {
      notes.push("Crystallographic B-factors depend on resolution and refinement, so they are coloured by quartile within their own entry, never against fixed cut-points.");
      addSource("sun2019");
    }
    notes.push("FoldX BuildModel mutates the residue and repacks nearby side chains on the template's fixed backbone. Cα positions cannot move, so backbone measures are zero by construction; the model shows side-chain changes only.");
    notes.push("ΔΔG is FoldX's folding free-energy change. Destabilisation is not pathogenicity, and FoldX's error is of the order of 1 kcal/mol.");
    addSource("schymkowitz2005");
    addSource("delgado2019");
  } else {
    notes.push("The wild type and the variant are folded as two separate single-sequence predictions. Nothing ties their coordinate errors together, so part of any difference between them can come from the predictions rather than the substitution.");
    notes.push("De novo pLDDT is the folding model's own confidence; ESMFold v1 via the ESM Atlas stores it on a 0–1 scale, which the view reads ×100.");
    const engineIds = [deNovo.engines?.wildType, deNovo.engines?.variant].filter(Boolean) as string[];
    if (engineIds.length === 0 || engineIds.some(e => e !== "esm-atlas-esmfold")) addSource("candido2026");
    if (engineIds.length === 0 || engineIds.includes("esm-atlas-esmfold")) addSource("lin2023");
  }
  notes.push(
    `Superposition is a Kabsch least-squares fit on matched Cα atoms. "Local" fits ±${LOCAL_ALIGNMENT_FIT_WINDOW} residues around the site; the local RMSD is read over ±${LOCAL_STRUCTURAL_WINDOW}, inside that fit.`
  );
  addSource("kabsch1976");
  if (representation === "esm3") {
    notes.push("ESM3 embedding shift is the cosine distance between wild-type and variant ESM3 representations per residue. It is a language-model signal with this app's own bands; it does not measure allostery or motion.");
    addSource("hayes2025");
  }
  addSource("sehnal2021");

  /* ── Chip ─────────────────────────────────────────────────────────────── */
  const chipIdentity = primary;
  const chip = chipIdentity
    ? {
        label: secondary ? `${chipIdentity.name} + variant` : chipIdentity.name,
        title: [chipIdentity.kind, chipIdentity.detail, chipIdentity.channel.note].filter(Boolean).join(". "),
        tone:
          chipIdentity.origin === "pdb-entry" || chipIdentity.origin === "pdb-homolog"
            ? ("experimental" as const)
            : chipIdentity.origin === "foldx-variant" || secondary
              ? ("model" as const)
              : chipIdentity.origin === "unknown"
                ? ("none" as const)
                : ("predicted" as const),
      }
    : { label: isAf ? "Loading structure" : deNovo.folding ? "Folding" : "No structure", title: "", tone: "none" as const };

  return {
    family,
    viewMode: effectiveMode,
    canvas: { primary, secondary, chip, relationshipNote },
    modes,
    representations,
    representation,
    colour,
    legend,
    plddtFilter,
    alignment: {
      scopeToggle: !isAf && effectiveMode === "superimposed",
      scope,
      fitLabel,
    },
    comparison,
    readings,
    site,
    trace,
    notices,
    notes,
    sources,
    experimental: {
      rows,
      loading: input.homologsLoading,
      best,
      note: "Identity and aligned range come from RCSB's sequence search. Show loads the chain mapped to this protein in UniProt numbering, or the whole entry in its own numbering when that mapping cannot be verified at the site.",
    },
    engineRecord: STRUCTURE_ENGINE_RECORD,
  };
}
