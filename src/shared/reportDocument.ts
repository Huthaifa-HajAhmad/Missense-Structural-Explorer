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
import type { LaneKey } from "./insightsEvidence.ts";
import { strengthWord } from "./acmgClassifier.ts";
import { formatEvidenceCode } from "./thresholds.ts";
import { buildEnergeticsEvidence } from "./energeticsEvidence.ts";
import { APP_REPOSITORY } from "./provenance.ts";
import { BLOCK_ORDER, REPORT_SOURCES, RESEARCH_USE_STATEMENT, type ReportBlock, type ReportDocument, type ReportDocumentInput } from "./reportModel.ts";
import { checksum, proseToPlain } from "./reportProse.ts";
import { classificationBlock, contrastBlock, identityBlock, literatureBlock, methodBlock, neededBlock, notesBlock, summaryBlock } from "./reportCaseBlocks.ts";
import { computationalExtras, laneBlock, populationExtras, stabilityExtras, structureBlock } from "./reportEvidenceBlocks.ts";

// The document's shapes and text markup live in their own modules; every importer keeps using this one.
export * from "./reportModel.ts";
export { parseProse, proseToPlain, checksum, type ProseNode, type ProseRun } from "./reportProse.ts";
/** The strength the engine's combining rule gives a code, in words (`acmgClassifier.ts`). */
export { strengthWord };

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
  // Structure and stability both read the engines' structure record; build it once per document.
  const energetics = buildEnergeticsEvidence({ foldingEnergetics: input.foldingEnergetics ?? null, foldingDdG: input.foldingDdG ?? null });
  const blocks: ReportBlock[] = BLOCK_ORDER.map(key => {
    let b: ReportBlock;
    if (key === "identity") b = identityBlock(input);
    else if (key === "classification") b = classificationBlock(input);
    else if (key === "contrast") b = contrastBlock(input);
    else if ((LANE_KEYS as readonly string[]).includes(key)) {
      b = laneBlock(key as LaneKey, input);
      if (key === "computational") computationalExtras(b, input);
      if (key === "population") populationExtras(b, input);
      if (key === "stability") stabilityExtras(b, energetics);
    } else if (key === "structure") b = structureBlock(input, energetics);
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
    if (key === "language-models") b.caption = "Individual scores and their calibration are listed once in Computational evidence. These models do not set PP3/BP4 in this engine.";
    // `detail` only says how the screen folds a column, so it stays out of the evidence fingerprint.
    const evidenceTable = b.table && { headers: b.table.headers, rows: b.table.rows, numeric: b.table.numeric };
    b.evidenceId = checksum(JSON.stringify([b.drafted, b.facts, evidenceTable, b.verdict, b.warnings, b.references, b.counted]));
    const edit = input.edits[key];
    const hasEdit = Boolean(edit);
    b.edited = hasEdit;
    b.stale = hasEdit && (edit!.base !== b.drafted || Boolean(edit!.evidenceId && edit!.evidenceId !== b.evidenceId));
    // A reason the builder already set (a stored tier that differs from the rule) stays: the card
    // below shows the stale-edit notice as well, so nothing is hidden, only the rail's one line.
    if (b.stale) b.review ??= "evidence-changed";
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
