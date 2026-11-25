/**
 * reportCaseBlocks.ts — the Report blocks about the case as a whole: identity, classification, where
 * the evidence agrees, what is still needed, literature, the written summary, notes and method.
 *
 * Each builder reads the run (and the Insights consolidator) and returns one block. None of them adds
 * science: the verdict and the counted criteria come from `buildInsightsEvidence`.
 */
import { variantNumberingView } from "./numbering.ts";
import { NARRATIVE_PROMPT_EVIDENCE } from "./narrativeSynthesis.ts";
import type { NarrativeAuthorship } from "./narrativeAuthorship.ts";
import { narrativeFreshness } from "./narrativeEvidence.ts";
import { PROVENANCE_DATA_SOURCES } from "./provenance.ts";
import { paperIdentifier } from "./literatureEvidence.ts";
import { REPORT_SOURCES, blankBlock, reportReferenceUrl, type ReportBlock, type ReportChip, type ReportDocumentInput } from "./reportModel.ts";
import { bold, joinText, sentence } from "./reportProse.ts";

const AUTHORSHIP_CHIP: Record<NarrativeAuthorship, ReportChip> = {
  ai: { label: "AI-written", tone: "neutral" },
  "rule-based": { label: "Rule-based text, not model-written", tone: "warning" },
  none: { label: "Not generated", tone: "muted" },
};

export function identityBlock(input: ReportDocumentInput): ReportBlock {
  const { result } = input;
  const b = blankBlock("identity");
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

export function classificationBlock(input: ReportDocumentInput): ReportBlock {
  const b = blankBlock("classification");
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
  paragraphs.push(joinText([bold(ev.finding.headline), ev.finding.rest]));
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
  // Rows are sorted met, then withheld, so the criteria the engine counted ("Met") lead and form the
  // short list. A withheld criterion is not counted, so it is not in it.
  const countedRows = rows.filter(r => r[2] === "Met").length;
  const shortList = countedRows > 0 && countedRows < rows.length
    ? { rows: countedRows, more: "Show all checked criteria", less: "Show counted criteria" }
    : undefined;
  b.table = rows.length ? { headers: ["Criterion", "Strength", "State", "Basis"], rows, detail: { column: 3, label: "Recorded basis" }, shortList } : null;
  // The table's order (state, then the consolidator's strength order) is the one order every surface uses.
  const position = (code: string) => { const i = rows.findIndex(r => r[0] === code); return i === -1 ? rows.length : i; };
  b.counted = ev.engineCodes.map(c => c.code).sort((x, y) => position(x) - position(y));
  if (ev.recordMismatch) b.review = "tier-differs";
  b.caption = joinText([
    silent.length ? `Also checked, no evidence recorded: ${silent.map(c => c.code).join(", ")}.` : "",
    ev.droppedEngineOwned.length
      ? `${ev.droppedEngineOwned.length} model ${ev.droppedEngineOwned.length === 1 ? "proposal" : "proposals"} for a code the engine owns ${ev.droppedEngineOwned.length === 1 ? "was" : "were"} dropped.`
      : "",
  ]) || null;
  b.reads = [{ label: "Insights", tab: "insights" }];
  return b;
}

export function contrastBlock(input: ReportDocumentInput): ReportBlock {
  const b = blankBlock("contrast");
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

export function neededBlock(input: ReportDocumentInput): ReportBlock {
  const b = blankBlock("needed");
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

export function literatureBlock(input: ReportDocumentInput): ReportBlock {
  const b = blankBlock("literature");
  b.reads = [{ label: "Literature", tab: "literature" }];
  if (input.citations.length === 0) {
    b.status = "absent";
    b.empty = true;
    b.drafted = "";
    return b;
  }
  b.drafted = input.citations
    .map(c => {
      const bits = [c.title.replace(/\.$/, ""), c.authors, [c.journal, c.year].filter(Boolean).join(" "), c.id ? paperIdentifier(c.id).label : ""]
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

export function summaryBlock(input: ReportDocumentInput): ReportBlock {
  const b = blankBlock("summary");
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
  if (freshness === "outdated") b.review = "summary-outdated";
  if (freshness === "outdated") b.warnings.push("This summary describes earlier evidence. Regenerate or review it against the current report before sharing.");
  if (freshness === "unrecorded" && narrative.authorship === "ai") b.warnings.push("The evidence snapshot used to write this summary was not recorded; freshness cannot be verified.");
  if (narrative.authorship === "ai") b.warnings.push("AI-written interpretation is unverified. It does not override the automated classification or a source database assertion.");
  b.caption = narrative.authorship === "ai"
    ? `Not verified against the evidence above. The model was shown ${sent.join(", ")}; it was not shown ${notSent.join(", ")}.`
    : "Text assembled by rules from the evidence when the language model was not available; no model wrote it.";
  return b;
}

export function notesBlock(): ReportBlock {
  const b = blankBlock("notes");
  b.status = "absent";
  b.empty = true;
  return b;
}

export function methodBlock(input: ReportDocumentInput): ReportBlock {
  const b = blankBlock("method");
  const weighting = input.insights?.weighting ?? input.result?.metadata?.acmgWeighting ?? null;
  b.drafted = [
    `${bold("Classification.")} The tier follows the Richards et al. 2015 combining rule, run on the criteria the rule engine recorded${weighting ? `, with the ${weighting} weighting` : ""}. Model proposals and context-only evidence are not counted.`,
    `${bold("Report coverage.")} Gene-disease validity, expression and regulatory evidence are not reproduced in this document. Consult their evidence views and the full evidence bundle when available. Section counts describe document contents, not completeness of clinical evidence.`,
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
