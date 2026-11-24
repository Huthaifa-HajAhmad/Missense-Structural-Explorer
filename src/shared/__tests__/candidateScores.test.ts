import { describe, expect, it } from "vitest";
import { candidateCaddNote, decideCandidateCadd } from "../candidateScores";
import { buildPredictorComparison } from "../evidenceComparison";
import { buildInsightsEvidence } from "../insightsEvidence";
import { buildLadderEvidence } from "../ladderEvidence";
import { buildPredictorEvidence } from "../predictorEvidence";
import { buildReportDocument, defaultReportSections } from "../reportDocument";
import type { AlleleCandidate } from "../locusResolution";

const candidate = (alt: string, caddPhred: number | null, caddSource: string | null = "ProtVar"): AlleleCandidate =>
  ({ grch37Id: null, id: `4-1804392-G-${alt}`, canonicalBy: "protvar", retryable: false, caddPhred, caddSource });

const candidateRun = (candidates: AlleleCandidate[]) => ({
  metadata: { gene: "FGFR3", variant: "p.Gly380Arg", acmgWeighting: "standard" },
  predictorData: {
    amPathogenicity: 0.9, amClass: "likely_pathogenic", caddPhred: null, gnomadVariantId: null, gnomadVariantAssembly: null,
    locusResolution: { route: "fallback", canonicalBy: null, retryable: false, failureKind: "multiple-candidates", steps: [], candidates },
  },
  conservationData: { revel: 0.72, bayesdel: 0.09 },
} as any);

describe("candidateCaddNote", () => {
  it("names each candidate allele's own CADD and its source, and says CADD shows no call", () => {
    expect(candidateCaddNote([candidate("C", 24.5), candidate("A", 25.7, "dbNSFP 5.3a (local)")])).toBe(
      "Each candidate allele has its own CADD: G>C 24.5 from ProtVar; G>A 25.7 from dbNSFP 5.3a (local). No single allele was selected, so CADD shows no call.",
    );
  });

  it("names a candidate without a score, and says nothing for a run without candidates", () => {
    expect(candidateCaddNote([candidate("C", 24.5), candidate("A", null, null)])).toMatch(/G>A not reported/);
    expect(candidateCaddNote(undefined)).toBeNull();
  });
});

describe("decideCandidateCadd", () => {
  it("votes PP3 at the weakest agreed band when all candidates support PP3 from the same source", () => {
    const d = decideCandidateCadd([candidate("A", 25.7), candidate("C", 28.5)]);
    expect(d).toEqual({
      kind: "agreed",
      signal: "pathogenic",
      calibrated: { direction: "PP3", strength: "Supporting", code: "PP3" },
      scoreText: "25.7–28.5",
      range: [25.7, 28.5],
      source: "ProtVar",
      weakestAdopted: true,
    });
  });

  it("keeps PP3_Moderate when every candidate reaches Moderate", () => {
    const d = decideCandidateCadd([candidate("A", 28.5), candidate("C", 31.2)]);
    expect(d).toMatchObject({
      kind: "agreed",
      signal: "pathogenic",
      calibrated: { direction: "PP3", strength: "Moderate", code: "PP3_Moderate" },
      scoreText: "28.5–31.2",
      weakestAdopted: false,
    });
  });

  it("votes BP4 when every candidate reaches BP4 from the same source", () => {
    const d = decideCandidateCadd([candidate("A", 22.5), candidate("C", 18.1)]);
    expect(d).toMatchObject({
      kind: "agreed",
      signal: "benign",
      calibrated: { direction: "BP4", strength: "Supporting", code: "BP4" },
      scoreText: "18.1–22.5",
    });
  });

  it("marks CADD indeterminate when all candidates fall in the indeterminate zone", () => {
    const d = decideCandidateCadd([candidate("A", 23.4), candidate("C", 24.5)]);
    expect(d).toMatchObject({
      kind: "indeterminate",
      signal: "vus",
      calibrated: { direction: null, strength: null, code: "Indeterminate" },
      scoreText: "23.4–24.5",
      source: "ProtVar",
    });
  });

  it("collapses identical candidate scores into one formatted score text", () => {
    const d = decideCandidateCadd([candidate("A", 26.0), candidate("C", 26.0)]);
    expect(d).toMatchObject({
      kind: "agreed",
      scoreText: "26.0",
      range: [26.0, 26.0],
    });
  });

  it("refuses to vote when candidates cross into different bands (Indeterminate vs PP3, or BP4 vs PP3)", () => {
    const mixedIndet = decideCandidateCadd([candidate("C", 24.5), candidate("A", 25.7)]);
    expect(mixedIndet).toMatchObject({
      kind: "disagree",
      signal: "unavailable",
      availabilityLabel: "Candidates disagree",
    });
    if (mixedIndet?.kind === "disagree") {
      expect(mixedIndet.unavailableEntry).toBe("CADD — CANDIDATE ALLELES DISAGREE (G>C 24.5 Indeterminate vs G>A 25.7 PP3 Supporting)");
    }

    const opposed = decideCandidateCadd([candidate("C", 19.0), candidate("A", 28.5)]);
    expect(opposed?.kind).toBe("disagree");
    if (opposed?.kind === "disagree") {
      expect(opposed.availabilityReason).toMatch(/G>C 19\.0 BP4 Supporting vs G>A 28\.5 PP3 Moderate/);
    }
  });

  it("refuses to vote across mixed or unverified CADD sources even if both scores look pathogenic", () => {
    const mixed = decideCandidateCadd([candidate("A", 27.0, "ProtVar"), candidate("C", 28.5, "dbNSFP 5.3a (local)")]);
    expect(mixed).toMatchObject({
      kind: "mixed-source",
      signal: "unavailable",
      availabilityLabel: "Mixed sources",
      unavailableEntry: "CADD — MIXED SOURCES (ProtVar vs dbNSFP 5.3a (local))",
    });

    const unverified = decideCandidateCadd([candidate("A", 27.0, "ProtVar"), candidate("C", 28.5, null)]);
    expect(unverified).toMatchObject({
      kind: "mixed-source",
      signal: "unavailable",
      availabilityLabel: "Unverified source",
      unavailableEntry: "CADD — UNVERIFIED SOURCE (G>C)",
    });
  });

  it("refuses to vote when any candidate lacks a CADD score or has a negative/non-finite score, while allowing scores above 50", () => {
    const partial = decideCandidateCadd([candidate("A", 27.0), candidate("C", null, null)]);
    expect(partial).toMatchObject({
      kind: "missing",
      signal: "unavailable",
      availabilityLabel: "Incomplete",
      unavailableEntry: "CADD — NO SCORE FOR G>C",
    });

    const negative = decideCandidateCadd([candidate("A", -1), candidate("C", -2)]);
    expect(negative).toMatchObject({
      kind: "missing",
      signal: "unavailable",
      availabilityLabel: "Invalid score",
      unavailableEntry: "CADD — NO VALID SCORE FOR G>A, G>C",
    });

    const oneInvalid = decideCandidateCadd([candidate("A", 29.0), candidate("C", -0.5)]);
    expect(oneInvalid).toMatchObject({
      kind: "missing",
      signal: "unavailable",
      unavailableEntry: "CADD — NO VALID SCORE FOR G>C",
    });

    const nonFinite = decideCandidateCadd([candidate("A", 29.0), candidate("C", Number.NaN)]);
    expect(nonFinite?.kind).toBe("missing");

    const aboveRulerMax = decideCandidateCadd([candidate("A", 52.3), candidate("C", 55.0)]);
    expect(aboveRulerMax).toMatchObject({
      kind: "agreed",
      signal: "pathogenic",
      calibrated: { direction: "PP3", strength: "Moderate", code: "PP3_Moderate" },
      scoreText: "52.3–55.0",
    });
  });

  it("refuses consensus when matching source labels explicitly state an unverified/unknown release", () => {
    const myvariant = decideCandidateCadd([
      candidate("A", 28.0, "myvariant.info dbNSFP (release not stated)"),
      candidate("C", 29.0, "myvariant.info dbNSFP (release not stated)"),
    ]);
    expect(myvariant).toMatchObject({
      kind: "mixed-source",
      signal: "unavailable",
      availabilityLabel: "Unverified source",
      unavailableEntry: "CADD — UNVERIFIED SOURCE (myvariant.info dbNSFP (release not stated))",
    });

    const localUnrecorded = decideCandidateCadd([
      candidate("A", 28.0, "local dbNSFP (version not recorded)"),
      candidate("C", 29.0, "local dbNSFP (version not recorded)"),
    ]);
    expect(localUnrecorded).toMatchObject({
      kind: "mixed-source",
      signal: "unavailable",
      availabilityLabel: "Unverified source",
      unavailableEntry: "CADD — UNVERIFIED SOURCE (local dbNSFP (version not recorded))",
    });
  });

  it("handles empty and single-candidate arrays explicitly and picks weakest BP4 strength", () => {
    expect(decideCandidateCadd([])).toBeNull();
    expect(decideCandidateCadd(null)).toBeNull();
    expect(decideCandidateCadd([candidate("A", 28.5)])).toMatchObject({
      kind: "agreed",
      calibrated: { direction: "PP3", strength: "Moderate", code: "PP3_Moderate" },
      scoreText: "28.5",
      weakestAdopted: false,
    });

    const strongAndMod = decideCandidateCadd([candidate("A", 0.1), candidate("C", 10.0)]);
    expect(strongAndMod).toMatchObject({
      kind: "agreed",
      signal: "benign",
      calibrated: { direction: "BP4", strength: "Moderate", code: "BP4_Moderate" },
      weakestAdopted: true,
    });

    const modAndSup = decideCandidateCadd([candidate("A", 10.0), candidate("C", 20.0)]);
    expect(modAndSup).toMatchObject({
      kind: "agreed",
      signal: "benign",
      calibrated: { direction: "BP4", strength: "Supporting", code: "BP4" },
      weakestAdopted: true,
    });
  });
});

describe("Predictors tab CADD reading on a candidate run", () => {
  it("keeps score null when candidates disagree and carries every allele's CADD in its note", () => {
    const evidence = buildPredictorEvidence({ result: candidateRun([candidate("C", 24.5), candidate("A", 25.7)]) });
    const cadd = evidence.readings.find(r => r.key === "cadd")!;
    expect(cadd.score).toBeNull();
    expect(cadd.availability).toMatchObject({ state: "absent", label: "Candidates disagree" });
    expect(cadd.note).toMatch(/G>C 24\.5 from ProtVar; G>A 25\.7 from ProtVar/);
    expect(cadd.chainKey).toBeNull();
  });

  it("reads PP3 with range 25.7–28.5 across evidence, ladder, comparison, and report when all candidates agree", () => {
    const result = candidateRun([candidate("A", 25.7), candidate("C", 28.5)]);
    const evidence = buildPredictorEvidence({ result });
    const cadd = evidence.readings.find(r => r.key === "cadd")!;
    expect(cadd.score).toBeNull();
    expect(cadd.scoreText).toBe("25.7–28.5");
    expect(cadd.scoreRange).toEqual([25.7, 28.5]);
    expect(cadd.signal).toBe("pathogenic");
    expect(cadd.callLabel).toBe("PP3");
    expect(cadd.availability.state).toBe("available");
    expect(cadd.source).toBe("ProtVar");
    expect(cadd.note).toMatch(/weakest agreed band/);
    // CADD is shown with its band but never sets PP3/BP4: REVEL 0.72 does (PP3 Supporting).
    expect(cadd.chainKey).toBeNull();
    expect(evidence.primary.activeTool).toBe("revel");
    expect(evidence.primary.code).toBe("PP3");

    const ladder = buildLadderEvidence({ result, predictor: evidence });
    expect(ladder.ladder.find(l => l.key === "cadd")?.at).toBe("PP3:Supporting");

    const comparison = buildPredictorComparison(evidence, ladder);
    const caddRow = comparison.rows.find(r => r.key === "cadd")!;
    expect(caddRow.value).not.toBeNull();
    expect(caddRow.valueText).toBe("25.7–28.5");

    const report = buildReportDocument({
      result,
      insights: buildInsightsEvidence({ result, functionInput: { residue: 380, uniprot: null, serviceStatus: "ok" } as any, stability: null }),
      gene: "FGFR3",
      variant: "p.Gly380Arg",
      uniprotId: "P22607",
      foldingEnergetics: null,
      foldingDdG: null,
      foldingStatus: "unavailable",
      narrative: { text: "", authorship: "none", model: null },
      citations: [],
      sections: defaultReportSections(),
      edits: {},
      meta: { title: "", preparedBy: "", caseRef: "" },
    });
    const compBlock = report.blocks.find(b => b.key === "computational")!;
    expect(compBlock.table?.rows.some(row => row[0] === "CADD" && row[1] === "25.7–28.5 PHRED" && row[2] === "PP3")).toBe(true);
  });

  it("propagates indeterminate candidate range across evidence, ladder, comparison, and report", () => {
    const result = candidateRun([candidate("A", 23.4), candidate("C", 24.5)]);
    const evidence = buildPredictorEvidence({ result });
    const cadd = evidence.readings.find(r => r.key === "cadd")!;
    expect(cadd.score).toBeNull();
    expect(cadd.scoreText).toBe("23.4–24.5");
    expect(cadd.scoreRange).toEqual([23.4, 24.5]);
    expect(cadd.signal).toBe("vus");
    expect(cadd.callLabel).toBe("Indeterminate");
    expect(cadd.availability.state).toBe("available");

    const ladder = buildLadderEvidence({ result, predictor: evidence });
    expect(ladder.ladder.find(l => l.key === "cadd")?.at).toBe("none");

    const comparison = buildPredictorComparison(evidence, ladder);
    expect(comparison.rows.find(r => r.key === "cadd")?.valueText).toBe("23.4–24.5");

    const report = buildReportDocument({
      result,
      insights: buildInsightsEvidence({ result, functionInput: { residue: 380, uniprot: null, serviceStatus: "ok" } as any, stability: null }),
      gene: "FGFR3",
      variant: "p.Gly380Arg",
      uniprotId: "P22607",
      foldingEnergetics: null,
      foldingDdG: null,
      foldingStatus: "unavailable",
      narrative: { text: "", authorship: "none", model: null },
      citations: [],
      sections: defaultReportSections(),
      edits: {},
      meta: { title: "", preparedBy: "", caseRef: "" },
    });
    const compBlock = report.blocks.find(b => b.key === "computational")!;
    expect(compBlock.table?.rows.some(row => row[0] === "CADD" && row[1] === "23.4–24.5 PHRED" && row[2] === "Indeterminate")).toBe(true);
  });

  it("reads the candidates' agreed CADD when the scalar caddPhred is NaN, Infinity, or negative", () => {
    const candidates = [candidate("A", 26.0), candidate("C", 28.5)];
    for (const badScalar of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const evidence = buildPredictorEvidence({
        result: {
          ...candidateRun(candidates),
          predictorData: {
            ...candidateRun(candidates).predictorData,
            caddPhred: badScalar,
          },
        },
      });
      const cadd = evidence.readings.find(r => r.key === "cadd");
      expect(cadd?.signal).toBe("pathogenic");
      expect(cadd?.scoreText).toBe("26.0–28.5");
    }
  });
});

