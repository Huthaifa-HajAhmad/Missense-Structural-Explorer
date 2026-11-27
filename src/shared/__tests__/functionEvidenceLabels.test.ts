import { describe, expect, it } from "vitest";
import type { AnalysisResult } from "../contracts.ts";
import { buildFunctionEvidence } from "../functionEvidence";
import { functionEvidenceInputFrom } from "../functionEvidenceInput";
import { NAE1_INPUT, NAE1_UNIPROT } from "./fixtures/nae1FunctionalDomains";

const ABCG1_UNIPROT = { ...structuredClone(NAE1_UNIPROT), sequenceLength: 678 };
const ABCG1 = {
  ...NAE1_INPUT,
  uniprotId: "P45844",
  residue: 358,
  wildType: "Gly",
  mutant: "Arg",
  uniprot: ABCG1_UNIPROT,
  numberingBasis: "canonical" as const,
  transcriptId: "ENST00000398449.8",
};

describe("residue numbering label names the transcript of the UniProt isoform (B1/B2)", () => {
  it("names the canonical transcript, and says the MANE transcript is a different isoform when they differ", () => {
    const ev = buildFunctionEvidence({ ...ABCG1, canonicalTranscriptId: "ENST00000361802.7" });
    expect(ev.trace[0]).toMatchObject({ text: "Residue numbered on UniProt ", strong: "P45844 (678 aa, ENST00000361802.7)." });
    expect(ev.trace[1]).toEqual({
      text: "The MANE Select transcript ENST00000398449.8 encodes a different isoform.",
      strong: "",
    });
    expect(JSON.stringify(ev.trace)).not.toMatch(/canonical P45844/);
  });

  it("reads the canonical transcript from the predictor data of the run", () => {
    const ev = functionEvidenceInputFrom({ metadata: { gene: "ABCG1", uniprotId: "P45844", residueIndex: 358, transcriptId: "ENST00000398449.8" }, predictorData: { canonicalEnsemblId: "ENST00000361802.7" } } as unknown as AnalysisResult);
    expect(ev.canonicalTranscriptId).toBe("ENST00000361802.7");
  });

  it("writes no 'different isoform' sentence when the canonical and MANE transcripts are the same", () => {
    const ev = buildFunctionEvidence({ ...ABCG1, canonicalTranscriptId: "ENST00000398449.8" });
    expect(ev.trace[0].strong).toBe("P45844 (678 aa, ENST00000398449.8).");
    expect(JSON.stringify(ev.trace)).not.toMatch(/different isoform/);
  });
});

describe("protein-map sentences (B19)", () => {
  it("does not repeat the feature type when it equals the feature name", () => {
    const uniprot = structuredClone(NAE1_UNIPROT);
    uniprot.domainMatches = [];
    uniprot.features = [{ type: "DNA binding", description: "DNA binding", start: 1, end: 400, evidence: [] }];
    const ev = buildFunctionEvidence({ ...NAE1_INPUT, uniprot });
    expect(ev.finding.rest).toContain("It lies in the dna binding (1–400)");
  });
});

describe("transmembrane count (B9)", () => {
  it("counts a span once when UniProt lists it in more than one feature row", () => {
    const uniprot = structuredClone(NAE1_UNIPROT);
    const tm = { type: "Transmembrane", description: "Helical", start: 427, end: 445, evidence: [] };
    uniprot.features = [tm, { ...tm }, { ...tm, start: 457, end: 477 }];
    const topology = buildFunctionEvidence({ ...NAE1_INPUT, uniprot }).groups.find((g) => g.group === "topology");
    expect(topology?.summary).toBe("2 transmembrane segments");
  });
});

describe("PM1 where an expert panel owns the rule (B30, display only)", () => {
  it("says the expert panel's PM1 specification applies instead of 'PM1 not met'", () => {
    const ev = buildFunctionEvidence({ ...NAE1_INPUT, expertPm1Specified: true });
    expect(ev.verdict).toBe("not-assessed");
    expect(ev.verdictLabel).toBe("PM1 not assessed — the expert panel's PM1 specification applies");
  });

  it("keeps 'PM1 not met' when no expert panel specification covers the gene", () => {
    const ev = buildFunctionEvidence({ ...NAE1_INPUT, expertPm1Specified: false });
    expect(ev.verdictLabel).toBe("PM1 not met");
  });
});
