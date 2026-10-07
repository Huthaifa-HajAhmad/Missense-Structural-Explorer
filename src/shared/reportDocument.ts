/**
 * reportDocument.ts — the Report as ONE document model that every surface renders.
 *
 * ONE QUESTION: what does the author want to hand to someone else, and does every line of it say only
 * what the app can back?
 *
 * The Report reads the Insights consolidator (`buildInsightsEvidence`) for the verdict, the counted
 * criteria and each evidence lane's recorded call, and adds only what that model does not carry: the
 * identity block, the stability and predictor tables, the structure facts, pinned literature and the
 * method statement. It adds no science and no second verdict. The screen, the print/PDF frame, the
 * html file, the plain-text copy and the JSON file are all renderings of this one object, so they
 * cannot disagree about what is included, what was edited or what was counted.
 *
 * INVARIANTS
 *   • Counted means the ENGINE recorded a code. Model proposals are listed once, as "not counted".
 *   • Only prose is editable. The verdict, the criteria table, every score and every fact are
 *     rendered from the run and cannot be overwritten, so an edited report can add a judgement but
 *     cannot alter a number.
 *   • Edits are marked, in every format. An edited block says "edited by the author"; a block edited
 *     before the evidence changed says so instead of silently disagreeing with the run.
 *   • Every block can be left out. What is left out is named in the footer's scope line, and a block
 *     whose criterion is still counted in the classification says that, so an omission is never
 *     silent. The footer itself (research use, generated-at, scope, document ID) is not a block.
 *   • Absence is a statement, never a blank row: an empty literature block, an unread lane and an
 *     unwritten summary each say what they are.
 *
 * Defects this replaced (doc/REPORT_TAB_REVIEW.md): "2 ACMG criteria applied" counting a model's PM2
 * beside a verdict the engine reached from PP3 alone; the narrative printed as the body with no
 * authorship line; "Validated Biomolecular Protocol" and "Compliance ACMG / AMP / ClinGen" claims; an
 * invented "MANE Select" transcript; a render-time date; a JSON export that ignored the section
 * ticks; a hash of the input data presented as an integrity check on the report.
 */
import type { AnalysisResult } from "./contracts.ts";
import type { EvidenceTabId, InsightsEvidence, Lane, LaneKey } from "./insightsEvidence.ts";
import { codeWeight } from "./acmgClassifier.ts";
import { variantNumberingView } from "./numbering.ts";
import { formatEvidenceCode } from "./thresholds.ts";
import { CAVEAT_TEXT, buildPredictorEvidence } from "./predictorEvidence.ts";
import { buildEnergeticsEvidence, energeticsSummary } from "./energeticsEvidence.ts";
import { buildFrequencyEvidence, formatAlleleFrequency, frequencySourceLabel, frequencyEvidenceInputFromResult } from "./frequencyEvidence.ts";
import { NARRATIVE_PROMPT_EVIDENCE } from "./narrativeSynthesis.ts";
import type { NarrativeAuthorship } from "./narrativeAuthorship.ts";
import type { DeepEvidenceContext } from "./deepModelEvidence.ts";
import { narrativeFreshness } from "./narrativeEvidence.ts";
import { PROVENANCE_DATA_SOURCES, APP_REPOSITORY } from "./provenance.ts";

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
  "language-models": "Sequence models",
  needed: "Still needed to decide",
  literature: "Literature",
  summary: "Written summary",
  notes: "Author's notes",
  method: "Limitations and method",
};

export type ReportPresetId = "one-page" | "full";

export const REPORT_PRESETS: Record<ReportPresetId, { label: string; hint: string; blocks: readonly BlockKey[] }> = {
  "one-page": {
    label: "Brief report",
    hint: "Identity, classification, what is missing, method",
    blocks: ["identity", "classification", "contrast", "needed", "notes", "method"],
  },
  full: {
    label: "Full",
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
}

export interface ReportFooter {
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
}

export const RESEARCH_USE_STATEMENT =
  "Research use. Not a validated diagnostic report. Any clinical use needs review by a qualified clinical geneticist.";

// ── Prose ────────────────────────────────────────────────────────────────────────────────────────

export interface ProseRun { text: string; bold: boolean }
export type ProseNode =
  | { type: "p"; runs: ProseRun[] }
  | { type: "h"; runs: ProseRun[] }
  | { type: "ul"; items: ProseRun[][] };

function runsOf(line: string): ProseRun[] {
  const runs: ProseRun[] = [];
  line.split("**").forEach((part, i) => {
    if (part) runs.push({ text: part, bold: i % 2 === 1 });
  });
  return runs;
}

/**
 * Reads the tiny markup the drafts and the editor share: blank-line paragraphs, `**bold**`, `- ` bullet
 * lines and `#` headings (the model's narrative uses them). Anything else is plain text, and nothing is
 * ever treated as HTML.
 */
export function parseProse(text: string): ProseNode[] {
  const nodes: ProseNode[] = [];
  for (const chunk of text.replace(/\r\n/g, "\n").split(/\n{2,}/)) {
    const lines = chunk.split("\n").map(l => l.trimEnd()).filter(l => l.trim().length > 0);
    if (lines.length === 0) continue;
    let pending: string[] = [];
    let bullets: ProseRun[][] = [];
    const flushP = () => {
      if (pending.length) nodes.push({ type: "p", runs: runsOf(pending.join(" ")) });
      pending = [];
    };
    const flushU = () => {
      if (bullets.length) nodes.push({ type: "ul", items: bullets });
      bullets = [];
    };
    for (const line of lines) {
      const heading = /^#{1,4}\s+(.*)$/.exec(line);
      const bullet = /^[-*•]\s+(.*)$/.exec(line);
      if (heading) {
        flushP(); flushU();
        nodes.push({ type: "h", runs: runsOf(heading[1]).map(r => ({ ...r, bold: true })) });
      } else if (bullet) {
        flushP();
        bullets.push(runsOf(bullet[1]));
      } else {
        flushU();
        pending.push(line.trim());
      }
    }
    flushP(); flushU();
  }
  return nodes;
}

const plainOf = (runs: ProseRun[]) => runs.map(r => r.text).join("");

/** Prose as plain text: markers removed, bullets as "- ". */
export function proseToPlain(text: string): string {
  return parseProse(text)
    .map(n => (n.type === "ul" ? n.items.map(i => `- ${plainOf(i)}`).join("\n") : plainOf(n.runs)))
    .join("\n\n");
}

/**
 * A short checksum (cyrb53, 14 hex digits) of a string. It is a change detector for the Document ID,
 * not a cryptographic digest, and the footer says what it does and does not prove.
 */
export function checksum(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hi = (h2 >>> 0).toString(16).padStart(8, "0");
  const lo = (h1 >>> 0).toString(16).padStart(8, "0");
  return (hi + lo).slice(2);
}

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────────

const PATHOGENIC_WORD: Record<number, string> = { 8: "Very strong", 4: "Strong", 2: "Moderate", 1: "Supporting" };
const BENIGN_WORD: Record<number, string> = { 8: "Stand-alone", 4: "Strong", 2: "Supporting" };

/** The strength the engine's combining rule gives a code, in words. Same weights the tier used. */
export function strengthWord(code: string): string {
  const w = codeWeight(code);
  if (w === 0) return "Not weighted";
  return (w > 0 ? PATHOGENIC_WORD : BENIGN_WORD)[Math.abs(w)] ?? "Not weighted";
}

const bold = (s: string) => `**${s}**`;
const sentence = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

function join(parts: Array<string | null | undefined>): string {
  return parts.map(p => (p ?? "").trim()).filter(Boolean).join(" ");
}

function laneDraft(lane: Lane): string {
  return join([bold(sentence(lane.lead)), lane.rest ? sentence(lane.rest) : ""]);
}

function laneChips(lane: Lane): ReportChip[] {
  const chips: ReportChip[] = [];
  if (lane.counted && lane.code) {
    chips.push({ label: `${formatEvidenceCode(lane.code)} counted`, tone: lane.lean === "benign" ? "good" : "danger" });
  } else if (lane.unconfirmed) {
    chips.push({ label: "Unconfirmed", tone: "accent", dashed: true });
  } else if (lane.state === "read") {
    chips.push({ label: "Not counted", tone: "muted" });
  }
  if (lane.state === "pending") chips.push({ label: "Still running", tone: "muted" });
  if (lane.state === "absent") chips.push({ label: "No reading", tone: "muted" });
  return chips;
}

function laneLinks(lane: Lane): ReportLink[] {
  return lane.links.map(l => ({ label: l.label, tab: l.tab }));
}

const AUTHORSHIP_CHIP: Record<NarrativeAuthorship, ReportChip> = {
  ai: { label: "AI-written", tone: "neutral" },
  "rule-based": { label: "Rule-based text, not model-written", tone: "warning" },
  none: { label: "Not generated", tone: "muted" },
};

function blank(key: BlockKey): ReportBlock {
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
  };
}

// ── Builders per block ───────────────────────────────────────────────────────────────────────────

function identityBlock(input: ReportDocumentInput): ReportBlock {
  const { result } = input;
  const b = blank("identity");
  const gene = input.gene || result?.metadata?.gene || "";
  const variant = input.variant || result?.metadata?.variant || "";
  const uniprot = input.uniprotId || result?.metadata?.uniprotId || "";
  const numbering = variantNumberingView({
    variant,
    uniprotId: uniprot || null,
    numberingRemap: (result as any)?.numberingRemap ?? (result?.metadata as any)?.numberingRemap ?? null,
  });
  const reported = numbering.reported
    ? `${numbering.reported}${numbering.reportedBasisId ? ` (${numbering.reportedBasisId})` : ""}`
    : numbering.display;
  /*
   * No "MANE Select" fallback. The old masthead and the rail's copy button printed that literal
   * whenever no transcript resolved, which asserts a specific reference-sequence designation the run
   * never established. The row is omitted instead.
   */
  const transcript = numbering.reportedTranscriptId || numbering.reportedRefSeqId || (result?.metadata as any)?.transcriptId || null;
  const genomicId = result?.predictorData?.gnomadVariantId ?? null;
  const assembly = result?.predictorData?.gnomadVariantAssembly ?? null;

  b.facts.push({ label: "Gene", value: gene || "Not resolved" });
  b.facts.push({ label: "Variant", value: reported || "Not resolved", mono: true });
  if (numbering.modelled && numbering.modelled !== (numbering.reported || numbering.display)) {
    b.facts.push({ label: "Modelled as", value: numbering.modelled, mono: true });
  }
  b.facts.push({ label: "Protein", value: uniprot || "Not resolved", mono: true });
  if (transcript) b.facts.push({ label: "Transcript", value: transcript, mono: true });
  b.facts.push({
    label: "Genomic",
    value: genomicId ? `${genomicId}${assembly ? ` (${assembly})` : " (build not reported)"}` : "Not reported for this run",
    mono: Boolean(genomicId),
  });
  b.drafted = numbering.basisNote ? sentence(`Numbering basis: ${numbering.basisNote}`) : "";
  b.status = result ? "read" : "absent";
  return b;
}

function classificationBlock(input: ReportDocumentInput): ReportBlock {
  const b = blank("classification");
  const ev = input.insights;
  if (!ev) {
    b.status = "absent";
    b.drafted = bold("No classification is available.") + " No analysis is loaded.";
    return b;
  }
  b.status = ev.pending ? "pending" : ev.ready ? "read" : "absent";
  b.chips.push({ label: "Rule-engine classification", tone: ev.tierIndex >= 3 ? "danger" : ev.tierIndex <= 1 ? "good" : "neutral" });
  if (ev.weighting) b.chips.push({ label: `Weighting: ${ev.weighting}`, tone: "muted" });
  b.verdict = {
    text: ev.verdictText,
    tier: ev.tier,
    tierIndex: ev.tierIndex,
    weighting: ev.weighting,
    recordMismatch: ev.recordMismatch,
    tiers: ["Benign", "Likely benign", "Uncertain", "Likely pathogenic", "Pathogenic"],
  };

  const paragraphs: string[] = [];
  paragraphs.push(join([bold(ev.finding.headline), ev.finding.rest]));
  if (ev.gap) paragraphs.push(`${bold("What would move it.")} ${ev.gap.sentence}`);
  if (ev.recordMismatch) {
    paragraphs.push(
      `${bold("Recorded tier and current rule differ.")} The tier stored with this run differs from the combining rule applied to its recorded criteria, so an earlier engine version classified it.`
    );
  }
  b.drafted = paragraphs.join("\n\n");

  const order: Record<string, number> = { met: 0, withheld: 1, "not met": 2, "not recorded": 3 };
  // A not-met code with nothing to say about it is listed once in the caption, not as a row.
  const GENERIC = "The engine recorded no criterion for this code.";
  const silent = ev.criteria.filter(c => c.state !== "met" && c.state !== "withheld" && c.reason === GENERIC);
  const rows: string[][] = ev.criteria
    .filter(c => !silent.includes(c))
    .sort((x, y) => order[x.state] - order[y.state])
    .map(c => [c.code, c.strength, c.state === "met" ? "Met" : c.state === "withheld" ? "Withheld" : c.state === "not met" ? "Not met" : "Not recorded", c.reason]);
  for (const p of ev.proposals) rows.push([p.code, "n/a", "Not counted", `Proposed by the language model, which the engine cannot compute. ${p.reason}`.trim()]);
  b.table = rows.length ? { headers: ["Criterion", "Strength", "State", "Basis"], rows } : null;
  b.counted = ev.engineCodes.map(c => c.code);
  b.caption = join([
    "The tier follows the Richards et al. 2015 combining rule, run on the criteria the engine recorded.",
    silent.length ? `Also checked, no evidence recorded: ${silent.map(c => c.code).join(", ")}.` : "",
    ev.droppedEngineOwned.length
      ? `${ev.droppedEngineOwned.length} model ${ev.droppedEngineOwned.length === 1 ? "proposal" : "proposals"} for a code the engine owns ${ev.droppedEngineOwned.length === 1 ? "was" : "were"} dropped.`
      : "",
  ]);
  b.reads = [{ label: "Insights", tab: "insights" }];
  return b;
}

function contrastBlock(input: ReportDocumentInput): ReportBlock {
  const b = blank("contrast");
  const ev = input.insights;
  if (!ev) {
    b.status = "absent";
    return b;
  }
  const parts: string[] = [];
  if (ev.agree.length) parts.push(`${bold("Where the evidence agrees")}\n${ev.agree.map(a => `- ${a.text}`).join("\n")}`);
  if (ev.differ.length) parts.push(`${bold("Where it pulls apart")}\n${ev.differ.map(a => `- ${a.text}`).join("\n")}`);
  b.drafted = parts.join("\n\n");
  b.status = parts.length ? "read" : "absent";
  if (!parts.length) b.drafted = "Nothing to compare yet: fewer than two evidence areas returned a reading.";
  b.caption = "Each line is generated from the evidence tabs' own recorded calls. No new score is invented.";
  b.reads = [{ label: "Insights", tab: "insights" }];
  return b;
}

function laneBlock(key: LaneKey, input: ReportDocumentInput): ReportBlock {
  const b = blank(key);
  const lane = input.insights?.lanes.find(l => l.key === key);
  if (!lane) {
    b.status = "absent";
    b.drafted = bold("No reading.") + " No analysis is loaded.";
    return b;
  }
  b.status = lane.state;
  b.chips = laneChips(lane);
  b.drafted = laneDraft(lane);
  b.reads = laneLinks(lane);
  b.counted = lane.counted && lane.code ? [lane.code] : [];
  return b;
}

function computationalExtras(b: ReportBlock, input: ReportDocumentInput) {
  const { result } = input;
  if (!result) return;
  const pe = buildPredictorEvidence({ result, isLoading: Boolean(input.isLoading) });
  const rows = pe.readings
    .filter(r => r.availability.state === "available" && r.score !== null)
    .map(r => [r.name, `${r.scoreText}${r.unit ? ` ${r.unit}` : ""}`, formatEvidenceCode(r.callLabel),
      r.votes ? "Voting predictor" : r.group === "conservation" ? "Conservation" : "Informational",
      `${r.cutpoints.source ?? "No published calibration"}; ${r.orientation === "higher" ? "higher" : "lower"} scores indicate ${r.group === "conservation" ? "greater evolutionary constraint" : "greater predicted impact"}${r.note ? `; ${r.note}` : ""}${r.caveats.length ? `; ${r.caveats.map(c => CAVEAT_TEXT[c].detail).join("; ")}` : ""}`]);
  if (rows.length) {
    b.table = { headers: ["Tool", "Score", "Reading", "Role", "Method and caveats"], rows, numeric: [1] };
    b.caption = "Scores are not probabilities; correlated tools are not independent evidence. Per-tool calibrated strengths describe each score, not the aggregate engine criterion.";
  }
  b.warnings.push("The engine uses an app-defined multi-tool vote at Supporting strength. This is not the pre-specified single-tool policy recommended by ClinGen SVI.");
  b.references = [...REPORT_SOURCES.slice(1, 3)];
}

function populationExtras(b: ReportBlock, input: ReportDocumentInput) {
  const { result } = input;
  if (!result) return;
  // The report reads only the rule engine's criteria (not the narrative's), so that stays explicit.
  const fe = buildFrequencyEvidence(frequencyEvidenceInputFromResult(result, {
    engineCriteria: result.ruleBasedInsights?.acmgCriteria ?? null,
  }));
  const c = fe.criterion;
  if (c.absent) {
    b.facts.push({ label: "Allele frequency", value: "Not observed" });
    b.facts.push({ label: "Read from", value: frequencySourceLabel(fe) });
  } else if (c.af !== null) {
    b.facts.push({ label: "Allele frequency", value: formatAlleleFrequency(c.af), mono: true });
    b.facts.push({ label: "Read from", value: frequencySourceLabel(fe) });
  }
}

function stabilityExtras(b: ReportBlock, input: ReportDocumentInput) {
  const energetics = buildEnergeticsEvidence({
    foldingEnergetics: input.foldingEnergetics ?? null,
    foldingDdG: input.foldingDdG ?? null,
  });
  const rows = energetics.readings
    .filter(r => r.ddg !== null)
    .map(r => [r.name, r.ddg! > 0 ? `+${r.ddg!.toFixed(2)}` : r.ddg! < 0 ? `−${Math.abs(r.ddg!).toFixed(2)}` : "0.00", r.callLabel ?? "Reading", r.counted ? "Counted in agreement" : "Not counted"]);
  if (rows.length) {
    b.table = { headers: ["Engine", "ΔΔG (kcal/mol)", "Call", "Role"], rows, numeric: [1] };
    const s = energeticsSummary(energetics);
    b.drafted = join([bold(sentence(s.lead)), s.rest.map(sentence).join(" ")]);
    b.status = "read";
  }
  b.caption = "Positive ΔΔG means destabilising. Stability is not pathogenicity, and it is not an ACMG input.";
}

function structureBlock(input: ReportDocumentInput): ReportBlock {
  const b = blank("structure");
  const { result } = input;
  const meta: any = result?.metadata ?? {};
  const energetics = buildEnergeticsEvidence({ foldingEnergetics: input.foldingEnergetics ?? null, foldingDdG: input.foldingDdG ?? null });
  const s = energetics.structure;
  const hasModel = Boolean(meta.pdbId || meta.pdbSource || s);
  b.status = hasModel ? "read" : "absent";
  b.reads = [{ label: "Residue shifts & pockets", tab: "structure" }];
  if (!hasModel) {
    b.drafted = `${bold("No macromolecular model is loaded for this variant.")} Structural reasoning is not part of this report.`;
    return b;
  }
  const modelName = s?.pdbId ?? meta.pdbId ?? null;
  if (modelName) b.facts.push({ label: "Model", value: String(modelName), mono: true });
  if (meta.pdbSource) b.facts.push({ label: "Source", value: String(meta.pdbSource) });
  if (s?.chainId) b.facts.push({ label: "Chain", value: s.chainId, mono: true });
  if (typeof s?.resolution === "number") b.facts.push({ label: "Resolution", value: `${s.resolution.toFixed(2)} Å`, mono: true });
  if (typeof s?.identity === "number") b.facts.push({ label: "Identity to the canonical sequence", value: `${(s.identity * (s.identity <= 1 ? 100 : 1)).toFixed(0)}%`, mono: true });
  if (s?.repair) b.facts.push({ label: "Template repair", value: s.repair });
  if (typeof meta.residueIndex === "number") b.facts.push({ label: "Residue", value: `#${meta.residueIndex}`, mono: true });
  if (meta.wildType && meta.mutant) b.facts.push({ label: "Substitution", value: `${meta.wildType} → ${meta.mutant}`, mono: true });
  const mutant = input.foldingStatus === "success" ? "Built" : input.foldingStatus === "failed" ? "Failed" : input.foldingStatus === "unavailable" ? "Not built" : null;
  if (mutant) b.facts.push({ label: "Mutant model", value: mutant });
  const gaps = [
    typeof s?.resolution === "number" ? null : "resolution",
    s?.chainId ? null : "chain",
  ].filter(Boolean);
  b.drafted = gaps.length
    ? `The payload does not state the model's ${gaps.join(" or ")}, so this report does not either.`
    : "";
  return b;
}

function neededBlock(input: ReportDocumentInput): ReportBlock {
  const b = blank("needed");
  const e = input.insights;
  if (!e || e.needed.length === 0) {
    b.status = "absent";
    b.empty = true;
    return b;
  }
  b.table = { headers: ["Criterion", "What is missing"], rows: e.needed.map(n => [`${n.title} (${n.code})`, n.text]) };
  b.caption = "The app holds no lab or family evidence; these are the criteria that would need it.";
  return b;
}

function literatureBlock(input: ReportDocumentInput): ReportBlock {
  const b = blank("literature");
  b.reads = [{ label: "Literature", tab: "literature" }];
  if (input.citations.length === 0) {
    b.status = "absent";
    b.empty = true;
    b.drafted = "";
    return b;
  }
  b.drafted = input.citations
    .map(c => {
      const bits = [c.title.replace(/\.$/, ""), c.authors, [c.journal, c.year].filter(Boolean).join(" "), c.id ? `PMID ${c.id}` : ""]
        .map(s => (s ?? "").toString().trim())
        .filter(Boolean);
      return `- ${bits.join(". ")}.`;
    })
    .join("\n");
  b.references = input.citations.flatMap(c => {
    const url = reportReferenceUrl(c.url) ?? (/^\d+$/.test(c.id) ? `https://pubmed.ncbi.nlm.nih.gov/${c.id}/` : null);
    return url ? [{ label: c.title, url }] : [];
  });
  b.caption = "Only papers the author pinned from the Literature tab are cited. This is not a search result.";
  return b;
}

function summaryBlock(input: ReportDocumentInput): ReportBlock {
  const b = blank("summary");
  const { narrative } = input;
  const sent = input.insights?.narrative.sent ?? NARRATIVE_PROMPT_EVIDENCE.sent;
  const notSent = input.insights?.narrative.notSent ?? NARRATIVE_PROMPT_EVIDENCE.notSent;
  b.reads = [{ label: "Insights", tab: "insights" }];
  b.chips.push(AUTHORSHIP_CHIP[narrative.authorship]);
  if (narrative.authorship === "ai" && narrative.model) b.chips.push({ label: narrative.model, tone: "muted" });
  if (!narrative.text.trim()) {
    b.status = "absent";
    b.empty = true;
    return b;
  }
  b.drafted = narrative.text.trim();
  const freshness = narrativeFreshness(input.result, input.narrativeContext ?? { stability: { foldingEnergetics: input.foldingEnergetics, foldingDdG: input.foldingDdG, foldingStatus: input.foldingStatus as "success" | "failed" | "unavailable" | null } });
  if (freshness === "outdated") b.warnings.push("This summary describes earlier evidence. Regenerate or review it against the current report before sharing.");
  if (freshness === "unrecorded" && narrative.authorship === "ai") b.warnings.push("The evidence snapshot used to write this summary was not recorded; freshness cannot be verified.");
  if (narrative.authorship === "ai") b.warnings.push("AI-written interpretation is unverified. It does not override the automated classification or a source database assertion.");
  b.caption = narrative.authorship === "ai"
    ? `Not verified against the evidence above. The model was shown ${sent.join(", ")}; it was not shown ${notSent.join(", ")}.`
    : "Text assembled by rules from the evidence when the language model was not available; no model wrote it.";
  return b;
}

function notesBlock(): ReportBlock {
  const b = blank("notes");
  b.status = "absent";
  b.empty = true;
  return b;
}

function methodBlock(input: ReportDocumentInput): ReportBlock {
  const b = blank("method");
  const weighting = input.insights?.weighting ?? input.result?.metadata?.acmgWeighting ?? null;
  b.drafted = [
    RESEARCH_USE_STATEMENT,
    `${bold("Classification.")} The tier follows the Richards et al. 2015 combining rule, run on the criteria the rule engine recorded${weighting ? `, with the ${weighting} weighting` : ""}. Model proposals and context-only evidence are not counted.`,
    `${bold("Report coverage.")} Gene-disease validity, expression and regulatory evidence are not reproduced in this document. Consult their evidence views and the full evidence bundle when available. Section counts describe document contents, not completeness of clinical evidence.`,
    `${bold("Not in this app.")} Lab function (PS3), family segregation (PP1) and de novo status (PS2) need evidence the app does not hold.`,
  ].join("\n\n");
  b.facts.push({ label: "gnomAD - configured dataset", value: PROVENANCE_DATA_SOURCES.gnomad });
  b.facts.push({ label: "dbNSFP - configured dataset", value: PROVENANCE_DATA_SOURCES.dbnsfp });
  b.facts.push({ label: "ClinVar - configured provider", value: "NCBI E-utilities; release not recorded" });
  const run = input.result?.metadata as any;
  b.facts.push({ label: "Analysis run", value: run?.pipelineRunId ?? "Not recorded", mono: true });
  b.facts.push({ label: "gnomAD - returned dataset", value: input.result?.gnomadFrequency?.dataset ?? "Not recorded" });
  b.references = [...REPORT_SOURCES];
  b.caption = "Configured datasets are app settings, not verified per-run releases. Full service outcomes and provenance are in the evidence bundle.";
  return b;
}

// ── Assembly ─────────────────────────────────────────────────────────────────────────────────────

const LANE_KEYS: readonly LaneKey[] = ["computational", "population", "splicing", "function", "stability", "assembly", "language-models"];

function canonicalBlock(b: ReportBlock): string {
  return [
    b.title,
    JSON.stringify(b.chips), JSON.stringify(b.warnings), JSON.stringify(b.references),
    b.stale ? "[evidence changed]" : "",
    b.edited ? "[edited by the author]" : "",
    b.verdict ? `verdict:${b.verdict.text ?? ""}` : "",
    b.facts.map(f => `${f.label}=${f.value}`).join(";"),
    b.table ? [b.table.headers.join("|"), ...b.table.rows.map(r => r.join("|"))].join("\n") : "",
    proseToPlain(b.text),
    b.caption ?? "",
  ].join("\n");
}

export function buildReportDocument(input: ReportDocumentInput): ReportDocument {
  const hasResult = Boolean(input.result);
  const blocks: ReportBlock[] = BLOCK_ORDER.map(key => {
    let b: ReportBlock;
    if (key === "identity") b = identityBlock(input);
    else if (key === "classification") b = classificationBlock(input);
    else if (key === "contrast") b = contrastBlock(input);
    else if ((LANE_KEYS as readonly string[]).includes(key)) {
      b = laneBlock(key as LaneKey, input);
      if (key === "computational") computationalExtras(b, input);
      if (key === "population") populationExtras(b, input);
      if (key === "stability") stabilityExtras(b, input);
    } else if (key === "structure") b = structureBlock(input);
    else if (key === "needed") b = neededBlock(input);
    else if (key === "literature") b = literatureBlock(input);
    else if (key === "summary") b = summaryBlock(input);
    else if (key === "notes") b = notesBlock();
    else b = methodBlock(input);

    if (key === "classification") {
      b.warnings.push("Automated classification from the criteria this engine can assess. It is not a comprehensive clinical interpretation.");
      b.references = [REPORT_SOURCES[0], REPORT_SOURCES[4]];
      if (b.verdict?.recordMismatch) b.warnings.push("The recorded tier differs from the current combining rule.");
    }
    if (key === "population") {
      b.warnings.push("The PM2 ceiling uses an app-defined pLI heuristic. pLI measures truncating-variant constraint and does not establish disease-specific inheritance.");
      const cv = input.result?.clinvar;
      if (cv) {
        b.facts.push({ label: "ClinVar assertion", value: cv.classification },
          { label: "Condition", value: cv.trait || "Not recorded" },
          { label: "Review status", value: cv.reviewStatus || "Not recorded" },
          { label: "Last evaluated", value: cv.lastEvaluated || "Not recorded" });
        if (cv.uid && /^\d+$/.test(cv.uid)) b.references.push({ label: `ClinVar variation ${cv.uid}`, url: `https://www.ncbi.nlm.nih.gov/clinvar/variation/${cv.uid}/` });
        b.warnings.push("ClinVar is a source assertion, distinct from the automated classification; review its condition and evidence independently.");
      }
    }
    if (key === "language-models") b.caption = "Individual scores and their calibration are listed once in Computational evidence. These models do not vote in this engine.";
    b.evidenceId = checksum(JSON.stringify([b.drafted, b.facts, b.table, b.verdict, b.warnings, b.references, b.counted]));
    const edit = input.edits[key];
    const hasEdit = Boolean(edit);
    b.edited = hasEdit;
    b.stale = hasEdit && (edit!.base !== b.drafted || Boolean(edit!.evidenceId && edit!.evidenceId !== b.evidenceId));
    if (b.stale) b.warnings.push("Evidence changed after this text was edited. The author wording has been preserved and needs review.");
    b.text = hasEdit ? edit!.text : b.drafted;
    if (hasEdit) b.empty = false;
    if (hasEdit) b.chips = [...b.chips, { label: "Edited by the author", tone: "accent", dashed: true }];
    b.included = input.sections[key] !== false;
    return b;
  });

  const counted = new Set(blocks.find(x => x.key === "classification")?.counted ?? []);
  for (const b of blocks) {
    if (!b.included) b.stillCounted = b.counted.filter(c => counted.has(c)).map(formatEvidenceCode);
  }

  const omitted = blocks
    .filter(b => !b.included && !b.empty)
    .map(b => (b.stillCounted.length ? `${b.title} (its ${b.stillCounted.join(", ")} is still counted in the classification)` : b.title));

  const shown = blocks.filter(b => b.included && !b.empty);
  const documentId = checksum(
    [input.meta.title, input.meta.preparedBy, input.meta.caseRef, ...shown.map(canonicalBlock), omitted.join(";")].join("\n\n")
  );

  const gene = input.gene || input.result?.metadata?.gene || "";
  const variant = input.variant || input.result?.metadata?.variant || "";
  const subject = [gene, variant].filter(Boolean).join(" ");

  return {
    title: input.meta.title.trim() || (subject ? `${subject} evidence report` : "Variant evidence report"),
    subject,
    hasResult,
    meta: { preparedBy: input.meta.preparedBy.trim(), caseRef: input.meta.caseRef.trim() },
    blocks,
    footer: {
      app: "Missense Structural Explorer",
      repository: APP_REPOSITORY,
      useStatement: RESEARCH_USE_STATEMENT,
      generatedAt: input.generatedAt ?? null,
      weighting: input.insights?.weighting ?? null,
      omitted,
      documentId,
    },
  };
}

/** Blocks an export carries: included and not empty. */
export function exportedBlocks(doc: ReportDocument): ReportBlock[] {
  return doc.blocks.filter(b => b.included && !b.empty);
}

/** Semantic annotations shared by every export renderer. */
export function reportBlockAnnotations(b: ReportBlock): string[] {
  return [...b.chips.map(c => c.label), ...b.warnings];
}

/** Complete block content for summary-deck notes, including facts and numeric tables. */
export function reportBlockText(b: ReportBlock): string {
  return [b.title, ...reportBlockAnnotations(b), b.verdict?.text ?? "", ...b.facts.map(f => `${f.label}: ${f.value}`),
    proseToPlain(b.text), b.table ? [b.table.headers.join(" | "), ...b.table.rows.map(r => r.join(" | "))].join("\n") : "",
    b.caption ?? "", ...b.references.map(r => `${r.label}: ${r.url}`)].filter(Boolean).join("\n\n");
}
