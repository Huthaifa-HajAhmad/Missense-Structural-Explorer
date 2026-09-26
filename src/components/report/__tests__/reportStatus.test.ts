import { describe, it, expect } from "vitest";
import {
  buildEvidenceInventory,
  computeReportFingerprint,
  deriveAiStatus,
  formatDeltaG,
  generateStructuredEhrReport,
  summarizeEvidence,
} from "../reportStatus";

const BASE_INPUT = {
  isFallback: false,
  fallbackReason: undefined,
  fallbackMessage: undefined,
  fallbackRetryable: undefined,
  providerDetail: undefined,
  attemptedModels: undefined,
  isKeyActive: true,
  hasNarrative: false,
  isNarrativeLoading: false,
};

describe("deriveAiStatus", () => {
  it("never reports a ready state while the report is a fallback", () => {
    const status = deriveAiStatus({
      ...BASE_INPUT,
      isFallback: true,
      fallbackReason: "PROVIDER_OVERLOADED",
      hasNarrative: true,
    });

    // Regression: the old banner announced "AI Session Token Ready" above an offline report
    // because it branched on key presence rather than on the report's actual state.
    expect(status.state).toBe("degraded");
    expect(status.label).not.toMatch(/ready/i);
    expect(status.tone).toBe("warn");
    expect(status.retryable).toBe(true);
  });

  it("treats a missing key as an unconfigured setup state, not a failure", () => {
    const status = deriveAiStatus({
      ...BASE_INPUT,
      isFallback: true,
      fallbackReason: "API_KEY_MISSING",
      isKeyActive: false,
    });

    expect(status.state).toBe("unconfigured");
    expect(status.canSynthesize).toBe(false);
    expect(status.tone).toBe("neutral");
  });

  it("honours the server's retryability flag over the reason default", () => {
    const notRetryable = deriveAiStatus({
      ...BASE_INPUT,
      isFallback: true,
      fallbackReason: "PROVIDER_OVERLOADED",
      fallbackRetryable: false,
    });
    expect(notRetryable.retryable).toBe(false);

    const retryable = deriveAiStatus({
      ...BASE_INPUT,
      isFallback: true,
      fallbackReason: "MODEL_UNAVAILABLE",
      fallbackRetryable: true,
    });
    expect(retryable.retryable).toBe(true);
  });

  it("prefers the server's sanitised message over generic copy", () => {
    const status = deriveAiStatus({
      ...BASE_INPUT,
      isFallback: true,
      fallbackReason: "DEADLINE_EXCEEDED",
      fallbackMessage: "No model responded within the synthesis time budget.",
    });
    expect(status.detail).toBe("No model responded within the synthesis time budget.");
  });

  it("exposes diagnostics for the console without putting them in the prose", () => {
    const status = deriveAiStatus({
      ...BASE_INPUT,
      isFallback: true,
      fallbackReason: "PROVIDER_OVERLOADED",
      providerDetail: "This model is currently experiencing high demand.",
      attemptedModels: ["gemini-3.5-flash", "gemini-2.5-flash"],
    });

    expect(status.diagnostics?.providerDetail).toContain("high demand");
    expect(status.diagnostics?.attemptedModels).toEqual(["gemini-3.5-flash", "gemini-2.5-flash"]);
    expect(status.diagnostics?.reason).toBe("PROVIDER_OVERLOADED");
  });

  it("reports live synthesis when a narrative exists without a fallback flag", () => {
    const status = deriveAiStatus({ ...BASE_INPUT, hasNarrative: true });
    expect(status.state).toBe("live");
    expect(status.tone).toBe("good");
    expect(status.retryable).toBe(false);
  });

  it("reports loading ahead of every other state", () => {
    const status = deriveAiStatus({
      ...BASE_INPUT,
      isNarrativeLoading: true,
      hasNarrative: true,
      isFallback: true,
      fallbackReason: "PROVIDER_OVERLOADED",
    });
    expect(status.state).toBe("idle");
    expect(status.canSynthesize).toBe(false);
  });

  it("distinguishes idle-with-key from unconfigured-without-key", () => {
    expect(deriveAiStatus({ ...BASE_INPUT, isKeyActive: true }).canSynthesize).toBe(true);
    expect(deriveAiStatus({ ...BASE_INPUT, isKeyActive: false }).state).toBe("unconfigured");
  });
});

describe("buildEvidenceInventory", () => {
  it("reports every source as absent for an empty result", () => {
    const sources = buildEvidenceInventory(null);
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every((source) => source.status === "absent")).toBe(true);
    expect(summarizeEvidence(sources)).toEqual({ present: 0, total: sources.length });
  });

  it("distinguishes 'absent from ClinVar' from 'ClinVar not queried'", () => {
    // `classification` explicitly saying "Not found" means ClinVar WAS queried and had no entry.
    const queried = buildEvidenceInventory({ clinvar: { classification: "Not found in ClinVar" } });
    const clinvarQueried = queried.find((s) => s.id === "clinvar");
    expect(clinvarQueried?.status).toBe("absent");
    expect(clinvarQueried?.detail).toMatch(/no submission/i);

    const notQueried = buildEvidenceInventory({});
    expect(notQueried.find((s) => s.id === "clinvar")?.detail).toMatch(/no submission/i);
  });

  it("records a ClinVar classification when one exists", () => {
    const sources = buildEvidenceInventory({ clinvar: { classification: "Pathogenic" } });
    const clinvar = sources.find((s) => s.id === "clinvar");
    expect(clinvar?.status).toBe("present");
    expect(clinvar?.detail).toBe("Pathogenic");
  });

  it("summarises which predictors contributed", () => {
    const sources = buildEvidenceInventory({
      predictorData: { amPathogenicity: 0.9, caddPhred: 32 },
      conservationData: { revel: 0.527 },
    });
    const inSilico = sources.find((s) => s.id === "in-silico");

    expect(inSilico?.status).toBe("present");
    expect(inSilico?.detail).toContain("AlphaMissense");
    expect(inSilico?.detail).toContain("CADD");
    expect(inSilico?.detail).toContain("REVEL");
  });

  it("lists which stability tools produced a value from EnergeticsData and foldingDdG", () => {
    const result = { metadata: { gene: "ACOT9" } };
    const energetics = {
      foldx: 1.42,
      dynamut2: -0.3,
      rasp: 0.85,
    } as any;
    const sources = buildEvidenceInventory(result, energetics, 1.42);
    const item = sources.find((s) => s.id === "energetics");

    expect(item?.status).toBe("present");
    expect(item?.detail).toContain("FoldX");
    expect(item?.detail).toContain("DynaMut2");
    expect(item?.detail).toContain("RaSP");
    expect(item?.detail).not.toContain("DDMut");
  });

  it("distinguishes pending calculations from absence", () => {
    const energetics = { pendingTools: ["DynaMut2", "DDMut"] } as any;
    const sources = buildEvidenceInventory({}, energetics, null);
    const item = sources.find((s) => s.id === "energetics");

    expect(item?.status).toBe("absent");
    expect(item?.detail).toBe("Calculations pending (DynaMut2, DDMut)");
  });

  it("reports FoldX binary missing honestly", () => {
    const energetics = { foldxBinaryMissing: true } as any;
    const sources = buildEvidenceInventory({}, energetics, null);
    const item = sources.find((s) => s.id === "energetics");

    expect(item?.status).toBe("absent");
    expect(item?.detail).toBe("FoldX binary not installed");
  });

  it("reports FoldX repair failure honestly", () => {
    const energetics = { foldxRepairFailed: true } as any;
    const sources = buildEvidenceInventory({}, energetics, null);
    const item = sources.find((s) => s.id === "energetics");

    expect(item?.status).toBe("absent");
    expect(item?.detail).toBe("FoldX structure repair failed");
  });

  it("supports legacy bundles with flat keys on result as fallback", () => {
    const sources = buildEvidenceInventory({ foldingDdG: 1.42, dynamut2: -0.3 });
    const energetics = sources.find((s) => s.id === "energetics");

    expect(energetics?.status).toBe("present");
    expect(energetics?.detail).toContain("FoldX");
    expect(energetics?.detail).toContain("DynaMut2");
  });

  it("counts present sources and their total", () => {
    const sources = buildEvidenceInventory({
      clinvar: { classification: "Benign" },
      metadata: { pdbId: "1ABC", pdbSource: "AlphaFold" },
      foldingDdG: 0.5,
    });
    const summary = summarizeEvidence(sources);

    expect(summary.total).toBe(sources.length);
    expect(summary.present).toBe(3);
  });
});

describe("formatDeltaG", () => {
  it("preserves the sign so destabilisation is explicit", () => {
    expect(formatDeltaG(1.5)).toBe("+1.50 kcal/mol");
    expect(formatDeltaG(-1.5)).toBe("-1.50 kcal/mol");
    expect(formatDeltaG(0)).toBe("0.00 kcal/mol");
  });

  it("renders an em dash for missing or non-finite values", () => {
    expect(formatDeltaG(null)).toBe("—");
    expect(formatDeltaG(undefined)).toBe("—");
    expect(formatDeltaG(Number.NaN)).toBe("—");
    expect(formatDeltaG(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("computeReportFingerprint", () => {
  it("computes a deterministic SHA-256 digest regardless of object key order", async () => {
    const objA = { z: 1, a: "hello", m: { beta: 2, alpha: 1 } };
    const objB = { a: "hello", m: { alpha: 1, beta: 2 }, z: 1 };

    const hashA = await computeReportFingerprint(objA);
    const hashB = await computeReportFingerprint(objB);

    expect(hashA).not.toBeNull();
    expect(hashA?.algorithm).toBe("SHA-256");
    expect(hashA?.digest).toHaveLength(64);
    expect(hashA?.digest).toBe(hashB?.digest);
  });

  it("produces distinct digests for different content", async () => {
    const hash1 = await computeReportFingerprint({ gene: "ACOT9", variant: "p.Lys272Asn" });
    const hash2 = await computeReportFingerprint({ gene: "BRAF", variant: "p.Val600Glu" });

    expect(hash1?.digest).not.toBe(hash2?.digest);
  });

  it("filters undefined object keys so undefined does not alter canonical serialization", async () => {
    const objWithUndef = { a: 1, b: undefined };
    const objWithoutUndef = { a: 1 };

    const hashWith = await computeReportFingerprint(objWithUndef);
    const hashWithout = await computeReportFingerprint(objWithoutUndef);

    expect(hashWith?.digest).toBe(hashWithout?.digest);
  });

  it("distinguishes reports with different live energetics values", async () => {
    const base = { gene: "ACOT9", variant: "p.Lys272Asn" };
    const hashUncomputed = await computeReportFingerprint({ ...base, energetics: null });
    const hashComputed = await computeReportFingerprint({
      ...base,
      energetics: { foldx: 1.45, consensusVerdict: "Destabilizing" },
    });

    expect(hashUncomputed?.digest).not.toBe(hashComputed?.digest);
  });
});

describe("ClinVar case-insensitive 'not found' detection in buildEvidenceInventory", () => {
  it("treats various case variations of 'not found' as absent", () => {
    for (const testClass of ["not found", "Not found in ClinVar", "NOT FOUND", "  Not Found  "]) {
      const sources = buildEvidenceInventory({
        clinvar: { classification: testClass } as any,
      });
      const clinvarSource = sources.find((s) => s.id === "clinvar");
      expect(clinvarSource?.status).toBe("absent");
      expect(clinvarSource?.detail).toBe("No submission for this variant");
    }
  });

  it("treats valid clinical classifications as present", () => {
    const sources = buildEvidenceInventory({
      clinvar: { classification: "Pathogenic/Likely pathogenic" } as any,
    });
    const clinvarSource = sources.find((s) => s.id === "clinvar");
    expect(clinvarSource?.status).toBe("present");
    expect(clinvarSource?.detail).toBe("Pathogenic/Likely pathogenic");
  });
});

describe("generateStructuredEhrReport", () => {
  it("generates a complete formatted EHR report with all clinical sections", () => {
    const reportText = generateStructuredEhrReport({
      gene: "CNNM2",
      variant: "p.Ser489Cys",
      reportedVariant: "p.Ser489Cys (NM_017649.5)",
      modelledVariant: "p.Ser489Cys",
      uniprotId: "Q9H8M5",
      reportedTranscriptId: "MANE Select",
      assessmentDate: "2026-09-26",
      headlineVerdict: "Variant of Uncertain Significance (VUS)",
      plausibility: "Plausibly uncertain in pathogenicity",
      acmgCriteria: [
        { code: "PM2", reason: "Absent from controls", source: "gnomad" },
        { code: "PP3", reason: "Multiple computational evidence supports", source: "database_verified" },
      ],
      energetics: {
        foldx: 1.85,
        consensusVerdict: "Destabilizing",
        consensusProbability: 0.88,
        consensusConfMin: 1.2,
        consensusConfMax: 2.5,
        dynamut2: 1.4,
      } as any,
      narrative: "Wild-type Ser489 participates in key hydrogen bonds.",
      evidenceSummary: { present: 6, total: 7 },
    });

    expect(reportText).toContain("CLINICAL GENOMICS & BIOPHYSICAL ASSESSMENT REPORT");
    expect(reportText).toContain("Gene:               CNNM2");
    expect(reportText).toContain("Reported Variant:   p.Ser489Cys (NM_017649.5)");
    expect(reportText).toContain("Canonical UniProt:  Q9H8M5");
    expect(reportText).toContain("Headline Verdict:   Variant of Uncertain Significance (VUS)");
    expect(reportText).toContain("[PM2] Absent from controls (Source: gnomad)");
    expect(reportText).toContain("[PP3] Multiple computational evidence supports (Source: database_verified)");
    expect(reportText).toContain("FoldX ΔΔG:          +1.85 kcal/mol");
    expect(reportText).toContain("Consensus Verdict:  Destabilizing (P = 88%), 95% CI: [+1.20 kcal/mol, +2.50 kcal/mol]");
    expect(reportText).toContain("DynaMut2 ΔΔG:       +1.40 kcal/mol");
    expect(reportText).toContain("Wild-type Ser489 participates in key hydrogen bonds.");
    expect(reportText).toContain("Evidence Completeness: 6 of 7 sources retrieved.");
  });

  it("handles fallback and missing values cleanly without throwing", () => {
    const reportText = generateStructuredEhrReport({
      gene: "",
      variant: "",
    });

    expect(reportText).toContain("Gene:               Unknown");
    expect(reportText).toContain("Headline Verdict:   No classification available");
    expect(reportText).toContain("No ACMG/AMP criteria recorded.");
    expect(reportText).toContain("FoldX ΔΔG:          —");
  });

  it("filters omitted sections based on user-configured report sections", () => {
    const reportText = generateStructuredEhrReport({
      gene: "BRAF",
      variant: "p.Val600Glu",
      acmgCriteria: [{ code: "PS1", reason: "Same amino acid change" }],
      energetics: { foldx: 2.1 } as any,
      narrative: "Well-established pathogenic variant in melanoma.",
      sections: {
        acmg: false,
        energetics: true,
        summary: false,
      },
    });

    expect(reportText).toContain("Gene:               BRAF");
    // ACMG section is disabled
    expect(reportText).not.toContain("ACMG / AMP EVIDENCE CRITERIA");
    expect(reportText).not.toContain("[PS1]");
    // Energetics section is enabled
    expect(reportText).toContain("BIOPHYSICAL STABILITY & FREE-ENERGY ESTIMATES");
    expect(reportText).toContain("FoldX ΔΔG:          +2.10 kcal/mol");
    // Summary/narrative is disabled
    expect(reportText).not.toContain("CLINICAL NARRATIVE & SYNTHESIS");
    expect(reportText).not.toContain("Well-established pathogenic variant");
  });
});


