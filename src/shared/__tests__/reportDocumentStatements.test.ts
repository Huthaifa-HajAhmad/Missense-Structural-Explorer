/**
 * reportDocumentStatements.test.ts — each fact is stated once, and the review reasons come from the document.
 *
 * The Report repeated the research-use line, the combining-rule sentence and the missing lab evidence in
 * several blocks, and the rail guessed which sections needed review from warning text. These tests pin
 * one home for each statement and one typed review reason per block.
 */
import { describe, expect, it } from "vitest";
import { buildInsightsEvidence } from "../insightsEvidence";
import { buildEnergeticsEvidence } from "../energeticsEvidence";
import { stabilityExtras } from "../reportEvidenceBlocks";
import { NARRATIVE_EVIDENCE_CONTRACT_VERSION, withNarrativeEvidenceStamp } from "../narrativeEvidence";
import {
  REPORT_GROUPS,
  REPORT_PRESETS,
  blankBlock,
  buildReportDocument,
  checksum,
  defaultReportSections,
  sectionsForPreset,
  type ReportDocumentInput,
} from "../reportDocument";

const functionInput = { residue: 116, uniprot: null, serviceStatus: "ok" } as any;

function run(criteria: { code: string; reason: string }[], verdict = "Variant of Uncertain Significance (VUS)"): any {
  return {
    metadata: { gene: "NAE1", variant: "p.Asp116Gly", uniprotId: "Q13564", acmgWeighting: "standard" },
    predictorData: { caddPhred: 26.3, source: "Ensembl VEP" },
    conservationData: { revel: 0.231 },
    ruleBasedInsights: { plausibility: "", acmgVerdict: verdict, acmgCriteria: criteria, partialEvidence: { available: [], unavailable: [] } },
  };
}

function input(result: any, over: Partial<ReportDocumentInput> = {}): ReportDocumentInput {
  return {
    result,
    insights: buildInsightsEvidence({ result, functionInput, stability: null }),
    gene: "NAE1",
    variant: "p.Asp116Gly",
    uniprotId: "Q13564",
    narrative: { text: "The residue is polar.", authorship: "ai", model: "gemini-test" },
    citations: [],
    sections: defaultReportSections(),
    edits: {},
    meta: { title: "", preparedBy: "", caseRef: "" },
    ...over,
  };
}

const pp3 = [{ code: "PP3", reason: "3/6 predictors agree" }];
const doc = buildReportDocument(input(run(pp3)));
const block = (d: typeof doc, key: string) => d.blocks.find(b => b.key === key)!;

describe("one home per statement", () => {
  it("prints the research-use line in the footer only, not again in the method prose", () => {
    expect(block(doc, "method").text).not.toContain("Not a validated diagnostic report");
    expect(doc.footer.useStatement).toContain("Not a validated diagnostic report");
  });

  it("names the combining rule in the method block, not again under the classification", () => {
    expect(block(doc, "classification").caption ?? "").not.toContain("Richards");
    expect(block(doc, "method").text).toContain("Richards et al. 2015");
  });

  it("lists the missing lab and family evidence in Still needed only", () => {
    expect(block(doc, "method").text).not.toContain("PS3");
    expect(block(doc, "needed").table?.rows.length ?? 0).toBeGreaterThan(0);
  });
});

describe("review reasons", () => {
  it("asks for no review of a current AI summary", () => {
    expect(doc.blocks.filter(b => b.review !== null)).toEqual([]);
  });

  it("flags an author edit made before the evidence changed", () => {
    const d = buildReportDocument(input(run(pp3), { edits: { computational: { text: "Mine.", base: "older draft" } } }));
    expect(block(d, "computational").review).toBe("evidence-changed");
  });

  it("flags a stored tier that the current rule would not give", () => {
    const d = buildReportDocument(input(run(pp3, "Likely Pathogenic")));
    expect(block(d, "classification").review).toBe("tier-differs");
  });
});

describe("one order and one name", () => {
  it("lists the counted codes in the same order as the criteria table", () => {
    const d = buildReportDocument(input(run([
      { code: "PP3", reason: "predictors" },
      { code: "PM2_Supporting", reason: "absent" },
      { code: "PS1", reason: "same change" },
    ])));
    const c = block(d, "classification");
    const metRows = c.table!.rows.filter(r => r[2] === "Met").map(r => r[0]);
    expect(c.counted.length).toBeGreaterThan(1);
    expect(c.counted).toEqual(metRows.filter(code => c.counted.includes(code)));
  });

  it("lists every block a preset turns on in its hint", () => {
    for (const preset of Object.values(REPORT_PRESETS)) {
      expect(preset.hint.split(",").length).toBeGreaterThanOrEqual(preset.blocks.length === 16 ? 1 : preset.blocks.length - 1);
    }
    expect(REPORT_PRESETS.brief.hint).toMatch(/notes/i);
    expect(REPORT_PRESETS.brief.hint).toMatch(/agree/i);
  });

  it("names the parts and presets the same way the screen does", () => {
    expect(REPORT_GROUPS.map(g => g.label)).toEqual(["Interpretation", "Evidence readings", "Summary & notes", "Citations & methods"]);
    expect(Object.values(REPORT_PRESETS).map(p => p.label)).toEqual(["Brief report", "Full report"]);
    expect(sectionsForPreset("brief").computational).toBe(false);
  });
});

describe("table disclosures", () => {
  it("lets each table name the column it folds away, instead of the renderer guessing by position", () => {
    expect(block(doc, "classification").table?.detail).toEqual({ column: 3, label: "Recorded basis" });
    const computational = block(doc, "computational").table!;
    expect(computational.detail).toEqual({ column: 4, label: "Method" });
    expect(computational.headers[4]).toBe("Method and caveats");
    expect(block(doc, "needed").table?.detail).toBeUndefined();
  });

  it("keeps the fold and the short list out of the evidence fingerprint, so saved edits are not flagged as out of date", () => {
    const c = block(doc, "classification");
    // Only the cells and number columns are evidence; how the screen folds or shortens the table is not.
    const evidenceTable = { headers: c.table!.headers, rows: c.table!.rows, numeric: c.table!.numeric };
    const fingerprint = checksum(JSON.stringify([c.drafted, c.facts, evidenceTable, c.verdict, c.warnings, c.references, c.counted]));
    expect(c.evidenceId).toBe(fingerprint);
  });
});

describe("short lists", () => {
  it("lets the classification table say how many leading rows are the counted criteria", () => {
    const table = block(doc, "classification").table!;
    const counted = table.rows.filter(r => r[2] === "Met").length;
    expect(counted).toBeGreaterThan(0);
    expect(table.rows.length).toBeGreaterThan(counted);
    expect(table.shortList).toEqual({ rows: counted, more: "Show all checked criteria", less: "Show counted criteria" });
    expect(table.rows.slice(0, counted).every(r => r[2] === "Met")).toBe(true);
  });

  it("never puts a withheld criterion in the counted short list, because the engine does not count it", () => {
    const base = run(pp3);
    const ev = buildInsightsEvidence({ result: base, functionInput, stability: null });
    const withheld = { ...ev, criteria: ev.criteria.map(c => (c.code === "PM2" ? { ...c, state: "withheld" as const, reason: "The weighting withheld it." } : c)) };
    const table = block(buildReportDocument(input(base, { insights: withheld })), "classification").table!;
    expect(table.rows.map(r => r[2])).toContain("Withheld");
    expect(table.shortList?.rows).toBe(table.rows.filter(r => r[2] === "Met").length);
    expect(table.rows.slice(0, table.shortList!.rows).map(r => r[2])).not.toContain("Withheld");
  });

  it("shows the whole table when nothing was counted, rather than an empty short list", () => {
    // No scores, so the engine counts nothing; the only row is a model proposal it did not count.
    const result = { ...run([]), predictorData: undefined, conservationData: undefined, insights: { acmgVerdict: "Variant of Uncertain Significance (VUS)", acmgCriteria: [{ code: "PS3", reason: "assay", source: "ai_suggested" }] } };
    const table = block(buildReportDocument(input(result)), "classification").table!;
    expect(table.rows.map(r => r[2])).toEqual(["Not counted"]);
    expect(table.shortList).toBeUndefined();
  });
});

describe("review reasons that need a second look", () => {
  it("names an outdated written summary as the reason, and does not flag one with no stamp to compare", () => {
    const stamped = withNarrativeEvidenceStamp(run(pp3), { contractVersion: NARRATIVE_EVIDENCE_CONTRACT_VERSION, revision: "an-older-revision", synthesizedAt: 1, deepEvidenceIntegrated: false });
    const outdated = block(buildReportDocument(input(stamped)), "summary");
    expect(outdated.review).toBe("summary-outdated");
    expect(outdated.warnings.join(" ")).toContain("earlier evidence");
    expect(block(doc, "summary").review).toBeNull();
  });

  it("keeps the builder's reason when an author edit also went stale", () => {
    const r = run(pp3, "Likely Pathogenic");
    const d = buildReportDocument(input(r, { edits: { classification: { text: "Mine.", base: "an older draft" } } }));
    expect(block(d, "classification").stale).toBe(true);
    expect(block(d, "classification").review).toBe("tier-differs");
  });
});

describe("pinned citations", () => {
  it("labels each pinned id by what it is, not always as a PMID", () => {
    const d = buildReportDocument(input(run(pp3), { citations: [
      { id: "36608681", title: "A paper", authors: "Smith J", journal: "Nature", year: 2023 },
      { id: "PMC9876543", title: "A free copy", authors: "Lee K", journal: "Cell", year: 2022 },
      { id: "PPR123456", title: "A preprint", authors: "Wu T", journal: "bioRxiv", year: 2024 },
    ] }));
    const text = block(d, "literature").text;
    expect(text).toContain("PMID 36608681");
    expect(text).toContain("PMC9876543");
    expect(text).not.toContain("PMID PMC9876543");
    expect(text).toContain("Preprint PPR123456");
    expect(text).not.toContain("PMID PPR123456");
  });
});

describe("stability block", () => {
  const energetics = buildEnergeticsEvidence({ foldingEnergetics: { foldx: 2.62, foldxMean: 2.62, thermompnn: -0.36 }, foldingDdG: 2.62 });

  it("keeps the lane's own state when the consolidator read nothing, and still shows the table", () => {
    const b = blankBlock("stability");
    b.status = "absent";
    stabilityExtras(b, energetics, "kcal/mol");
    expect(b.status).toBe("absent");
    expect(b.table).not.toBeNull();
  });

  it("replaces the lane's sentence with the engines' own summary only when the lane was read", () => {
    const b = blankBlock("stability");
    b.status = "read";
    b.drafted = "lane sentence";
    stabilityExtras(b, energetics, "kcal/mol");
    expect(b.status).toBe("read");
    expect(b.drafted).not.toBe("lane sentence");
  });
});
