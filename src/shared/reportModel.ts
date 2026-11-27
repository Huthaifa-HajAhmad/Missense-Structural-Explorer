/**
 * reportModel.ts — the Report document's shapes and fixed lists: blocks, parts, presets and sources.
 *
 * `reportDocument.ts` builds a document of these shapes, and every surface (the screen, the rail, the
 * html, text, Word, PowerPoint and JSON files) renders one. Kept apart from the builders so a renderer
 * can import the shapes without pulling in the evidence code.
 */
import type { AnalysisResult } from "./contracts.ts";
import type { EvidenceTabId, InsightsEvidence } from "./insightsEvidence.ts";
import type { NarrativeAuthorship } from "./narrativeAuthorship.ts";
import type { DeepEvidenceContext } from "./deepModelEvidence.ts";
import type { EnergyUnit } from "./engineStatus.ts";

// ── Blocks ───────────────────────────────────────────────────────────────────────────────────────

export type BlockKey =
  | "identity"
  | "classification"
  | "contrast"
  | "computational"
  | "population"
  | "splicing"
  | "function"
  | "structure"
  | "stability"
  | "assembly"
  | "language-models"
  | "needed"
  | "literature"
  | "summary"
  | "notes"
  | "method";

/** Reading order of the document. `summary` keeps its old key: the Insights card re-enables it by name. */
export const BLOCK_ORDER: readonly BlockKey[] = [
  "identity",
  "classification",
  "contrast",
  "computational",
  "population",
  "splicing",
  "function",
  "structure",
  "stability",
  "assembly",
  "language-models",
  "needed",
  "literature",
  "summary",
  "notes",
  "method",
];

export const BLOCK_TITLE: Record<BlockKey, string> = {
  identity: "Variant and sequence",
  classification: "Classification",
  contrast: "Where the evidence agrees and differs",
  computational: "Computational evidence",
  population: "Population data",
  splicing: "RNA splicing",
  function: "Protein function",
  structure: "Structure",
  stability: "Stability",
  assembly: "Assembly and interactions",
  "language-models": "Genome-wide scores",
  needed: "Still needed to decide",
  literature: "Literature",
  summary: "Written summary",
  notes: "Author's notes",
  method: "Limitations and method",
};

/**
 * The document's four parts. The Report screen's part tabs and the rail's contents list both read
 * this, so a block is filed in the same place on both sides. Together they cover `BLOCK_ORDER` once.
 */
export type ReportGroupId = "interpretation" | "evidence" | "writing" | "sources";

export const REPORT_GROUPS: readonly { id: ReportGroupId; label: string; keys: readonly BlockKey[] }[] = [
  { id: "interpretation", label: "Interpretation", keys: ["identity", "classification", "contrast", "needed"] },
  { id: "evidence", label: "Evidence readings", keys: ["computational", "population", "splicing", "function", "structure", "stability", "assembly", "language-models"] },
  { id: "writing", label: "Summary & notes", keys: ["summary", "notes"] },
  { id: "sources", label: "Citations & methods", keys: ["literature", "method"] },
];

export function reportGroupOf(key: BlockKey): ReportGroupId {
  return REPORT_GROUPS.find(g => g.keys.includes(key))!.id;
}

export type ReportPresetId = "brief" | "full";

export const REPORT_PRESETS: Record<ReportPresetId, { label: string; hint: string; blocks: readonly BlockKey[] }> = {
  brief: {
    label: "Brief report",
    hint: "Identity, classification, where the evidence agrees, what is missing, your notes, method",
    blocks: ["identity", "classification", "contrast", "needed", "notes", "method"],
  },
  full: {
    label: "Full report",
    hint: "Every block",
    blocks: BLOCK_ORDER,
  },
};

export function defaultReportSections(): Record<BlockKey, boolean> {
  return Object.fromEntries(BLOCK_ORDER.map(k => [k, true])) as Record<BlockKey, boolean>;
}

export function sectionsForPreset(preset: ReportPresetId): Record<BlockKey, boolean> {
  const on = new Set<BlockKey>(REPORT_PRESETS[preset].blocks);
  return Object.fromEntries(BLOCK_ORDER.map(k => [k, on.has(k)])) as Record<BlockKey, boolean>;
}

export type ChipTone = "danger" | "good" | "neutral" | "muted" | "warning" | "accent";

export interface ReportChip {
  label: string;
  tone: ChipTone;
  /** Dashed border: unconfirmed or author-edited, and nothing else. */
  dashed?: boolean;
}

export interface ReportTable {
  headers: string[];
  rows: string[][];
  /** Zero-based columns to right-align as numbers. */
  numeric?: number[];
  /**
   * A long-text column the screen folds into a disclosure under `label`. The table names it, so adding
   * a column never changes what folds. Exports print the column in full.
   */
  detail?: { column: number; label: string };
  /**
   * The screen first shows only the leading `rows` rows, with a button labelled `more` for the rest
   * (and `less` to go back). The table orders its rows so the short list comes first. Exports print
   * every row.
   */
  shortList?: { rows: number; more: string; less: string };
}

export interface ReportFact {
  label: string;
  value: string;
  mono?: boolean;
}

export interface ReportLink {
  label: string;
  tab: EvidenceTabId | "literature" | "insights";
}

export interface ReportVerdict {
  text: string | null;
  tier: string | null;
  tierIndex: number;
  weighting: string | null;
  recordMismatch: boolean;
  tiers: readonly string[];
}

export interface ReportReference { label: string; url: string }

export const REPORT_SOURCES: readonly ReportReference[] = [
  { label: "Richards et al. 2015 - combining rules", url: "https://doi.org/10.1038/gim.2015.30" },
  { label: "Pejaver et al. 2022 - calibrated predictors", url: "https://doi.org/10.1016/j.ajhg.2022.10.013" },
  { label: "Bergquist et al. 2025 - protein models", url: "https://doi.org/10.1016/j.gim.2025.101402" },
  { label: "Walker et al. 2023 - splicing", url: "https://doi.org/10.1016/j.ajhg.2023.06.002" },
  { label: "ClinGen SVI - recommendations", url: "https://www.clinicalgenome.org/working-groups/sequence-variant-interpretation/" },
];

/** Reject executable URLs from payloads and imported drafts. */
export function reportReferenceUrl(value: string | null | undefined): string | null {
  try { const url = new URL(value ?? ""); return ["https:", "http:"].includes(url.protocol) ? url.href : null; } catch { return null; }
}

/**
 * Why a block needs the author's eyes before export. Set by the builder, so the rail and every export
 * read the same reason instead of guessing it from warning text.
 *   evidence-changed  the author edited the block, then the evidence under it changed
 *   summary-outdated  the written summary describes an earlier evidence snapshot
 *   tier-differs      the tier stored with the run is not what the current combining rule gives
 */
export type ReportReview = "evidence-changed" | "summary-outdated" | "tier-differs";

export const REPORT_REVIEW_LABEL: Record<ReportReview, string> = {
  "evidence-changed": "Evidence changed after your edit",
  "summary-outdated": "Summary describes earlier evidence",
  "tier-differs": "Stored tier differs from the current rule",
};

export interface ReportBlock {
  warnings: string[];
  references: ReportReference[];
  evidenceId: string;
  key: BlockKey;
  title: string;
  included: boolean;
  /** No engine value or drafted text yet, and nothing the author wrote. Exports skip an empty block. */
  empty: boolean;
  /** `read`: the evidence was read. `pending`: still running. `absent`: nothing came back. */
  status: "read" | "pending" | "absent";
  chips: ReportChip[];
  /** Prose from the evidence, in the small markup `parseProse` reads. */
  drafted: string;
  /** What the block says now: the author's text when there is one, otherwise the drafted text. */
  text: string;
  edited: boolean;
  /** Edited, and the drafted text has changed since. */
  stale: boolean;
  facts: ReportFact[];
  table: ReportTable | null;
  /** One muted line under the block's content. */
  caption: string | null;
  reads: ReportLink[];
  /** ACMG codes the engine counted from this block's lane. */
  counted: string[];
  /** Present on the classification block only. */
  verdict: ReportVerdict | null;
  /** Set when the block is excluded but its result is still counted in the classification. */
  stillCounted: string[];
  /** Why the author should read this block before export; null when nothing needs review. */
  review: ReportReview | null;
}

export interface ReportFooter {
  completeness: string;
  app: string;
  repository: string;
  useStatement: string;
  /** ISO time of export; null while the report has not been exported. */
  generatedAt: string | null;
  weighting: string | null;
  /** Titles of blocks the author left out (empty blocks are not listed). */
  omitted: string[];
  /** The canonical content identifier, excluding export timestamp and format. Does not prove authorship. */
  documentId: string;
}

export interface ReportDocument {
  title: string;
  subject: string;
  hasResult: boolean;
  meta: { preparedBy: string; caseRef: string };
  blocks: ReportBlock[];
  footer: ReportFooter;
}

export interface ReportEdit {
  evidenceId?: string;
  text: string;
  /** The drafted text at the time of the edit; a different draft later marks the edit stale. */
  base: string;
}

export interface ReportCitation {
  id: string;
  title: string;
  authors: string;
  journal: string;
  year: number | null;
  url?: string | null;
}

export interface ReportDocumentInput {
  result: AnalysisResult | null;
  insights: InsightsEvidence | null;
  gene: string;
  variant: string;
  uniprotId: string;
  foldingEnergetics?: Record<string, any> | null;
  foldingDdG?: number | null;
  foldingStatus?: string | null;
  narrativeContext?: DeepEvidenceContext;
  isLoading?: boolean;
  narrative: { text: string; authorship: NarrativeAuthorship; model: string | null };
  citations: readonly ReportCitation[];
  sections: Partial<Record<BlockKey, boolean>>;
  edits: Partial<Record<BlockKey, ReportEdit>>;
  meta: { title: string; preparedBy: string; caseRef: string };
  /** ISO time to stamp on the footer; leave null on screen and set it when exporting. */
  generatedAt?: string | null;
  /** The energy unit the user chose for ΔΔG columns. kcal/mol when omitted. */
  energyUnit?: EnergyUnit;
}

export const RESEARCH_USE_STATEMENT =
  "Research use. Not a validated diagnostic report. Any clinical use needs review by a qualified clinical geneticist.";

/** An included, read block with nothing in it yet; each builder fills in what it knows. */
export function blankBlock(key: BlockKey): ReportBlock {
  return {
    key,
    warnings: [], references: [], evidenceId: "",
    title: BLOCK_TITLE[key],
    included: true,
    empty: false,
    status: "read",
    chips: [],
    drafted: "",
    text: "",
    edited: false,
    stale: false,
    facts: [],
    table: null,
    caption: null,
    reads: [],
    counted: [],
    verdict: null,
    stillCounted: [],
    review: null,
  };
}
