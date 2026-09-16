// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateClinicalNarrative } from "../narrativeService";
import { setCachedVariant, getCachedVariant, purgeFallbackNarratives } from "../variantCache";

describe("narrativeService", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  it("generates narrative and updates analysis state insights", async () => {
    const mockApiClient = {
      getNarrative: vi.fn().mockResolvedValue({
        analysis: "Detailed clinical narrative explaining Arg408Trp disruption.",
        insights: {
          biochemicalShift: "Positive to hydrophobic",
          structuralImpact: "Steric clash in core",
          acmgCriteria: [{ code: "PS3", category: "pathogenic" }],
          acmgVerdict: "Likely Pathogenic"
        }
      })
    };

    const addToHistory = vi.fn();
    const setSelectedResidueIndex = vi.fn();
    let state: any = {
      result: {
        analysis: "Base analysis",
        insights: null
      }
    };
    const setAnalysisState = vi.fn((updater) => {
      state = typeof updater === "function" ? updater(state) : updater;
    });
    const setLoadingStep = vi.fn();
    const setIsClinicalLoading = vi.fn();
    const setIsNarrativeLoading = vi.fn();
    const addTraceSpan = vi.fn();
    const finishTraceRun = vi.fn();

    await generateClinicalNarrative(
      {
        gene: "PAH",
        variant: "p.Arg408Trp",
        uniprotId: "P00439",
        settings: { acmgWeighting: {} },
        bpResult: { clinvar: { classification: "Pathogenic" } }
      },
      mockApiClient,
      { addToHistory, setSelectedResidueIndex },
      {
        setAnalysisState,
        setLoadingStep,
        setIsBiophysicalLoading: vi.fn(),
        setIsStructuralLoading: vi.fn(),
        setIsClinicalLoading,
        setIsNarrativeLoading
      },
      new AbortController().signal,
      1,
      () => 1,
      {
        activeTraceId: "t-nar",
        traceStart: performance.now(),
        addTraceSpan,
        finishTraceRun
      }
    );

    expect(addToHistory).toHaveBeenCalledWith("PAH", "p.Arg408Trp", "P00439");
    expect(setSelectedResidueIndex).toHaveBeenCalledWith(408);
    expect(setIsClinicalLoading).toHaveBeenCalledWith(false);
    expect(setIsNarrativeLoading).toHaveBeenCalledWith(true);
    expect(setIsNarrativeLoading).toHaveBeenLastCalledWith(false);
    expect(state.result.analysis).toBe("Detailed clinical narrative explaining Arg408Trp disruption.");
    expect(state.result.insights.acmgVerdict).toBe("Likely Pathogenic");
    expect(finishTraceRun).toHaveBeenCalledWith("t-nar", "completed");
  });

  it("degrades to a clean clinical summary without leaking the transport error into prose", async () => {
    const mockApiClient = {
      getNarrative: vi.fn().mockRejectedValue(new Error("Rate limit exceeded"))
    };

    let state: any = { result: { analysis: "Initial" } };
    const setAnalysisState = vi.fn((updater) => {
      state = typeof updater === "function" ? updater(state) : updater;
    });

    await generateClinicalNarrative(
      {
        gene: "PAH",
        variant: "p.Arg408Trp",
        uniprotId: "P00439",
        settings: { acmgWeighting: {} },
        bpResult: null
      },
      mockApiClient,
      { addToHistory: vi.fn(), setSelectedResidueIndex: vi.fn() },
      {
        setAnalysisState,
        setLoadingStep: vi.fn(),
        setIsBiophysicalLoading: vi.fn(),
        setIsStructuralLoading: vi.fn(),
        setIsClinicalLoading: vi.fn(),
        setIsNarrativeLoading: vi.fn()
      },
      new AbortController().signal,
      1,
      () => 1
    );

    // The report body stays a clinical document: no infrastructure error text in the prose.
    expect(state.result.analysis).toContain("Clinical Narrative Unavailable");
    expect(state.result.analysis).not.toContain("Rate limit exceeded");

    // Degradation is described by structured fields the UI can branch on.
    expect(state.result.isFallback).toBe(true);
    expect(state.result.fallbackReason).toBe("SERVICE_UNAVAILABLE");
    expect(state.result.providerDetail).toBe("Rate limit exceeded");

    // Must NOT persist degraded fallback result into long-term sessionStorage
    const storageKeys = Object.keys(sessionStorage).filter(k => k.includes("PAH_p.arg408trp"));
    expect(storageKeys.length).toBe(0);
  });

  it("does not let a degraded narrative stick in the cache, while keeping biophysical artefacts", () => {
    // Seed variant bundle with biophysical calculations and a fallback narrative
    setCachedVariant("GZF1", "p.Arg591Trp", "Q9H116", {
      pdbText: "ATOM 1 CA ALA 1 10.0 10.0 10.0",
      mutantPdb: "ATOM 1 CA TRP 1 10.0 10.0 10.0",
      foldingDdG: 2.85,
      foldingStatus: "completed",
      computedPocket: { pocketScore: 0.92, drugScore: 0.81 },
      analysisResult: {
        analysis: "### ⚠️ BIOCHEMICAL SHIFT NARRATIVE: Unavailable (AI Service Offline)",
        isFallback: true
      }
    });

    // Regression: the fallback used to be retained in the in-memory cache for 24h, so a single
    // transient provider 503 pinned the offline report for that variant for the whole session and
    // later lookups never retried the model.
    const afterWrite = getCachedVariant("GZF1", "p.Arg591Trp");
    expect(afterWrite?.analysisResult).toBeUndefined();

    // Biophysical artefacts survive the narrative eviction.
    expect(afterWrite?.pdbText).toBe("ATOM 1 CA ALA 1 10.0 10.0 10.0");
    expect(afterWrite?.foldingDdG).toBe(2.85);

    purgeFallbackNarratives();

    const afterPurge = getCachedVariant("GZF1", "p.Arg591Trp");
    expect(afterPurge).toBeDefined();
    expect(afterPurge?.analysisResult).toBeUndefined();
    // Critical biophysical computations MUST remain intact:
    expect(afterPurge?.pdbText).toBe("ATOM 1 CA ALA 1 10.0 10.0 10.0");
    expect(afterPurge?.mutantPdb).toBe("ATOM 1 CA TRP 1 10.0 10.0 10.0");
    expect(afterPurge?.foldingDdG).toBe(2.85);
    expect(afterPurge?.foldingStatus).toBe("completed");
    expect(afterPurge?.computedPocket?.pocketScore).toBe(0.92);
  });

  it("keeps successfully synthesized narratives in the cache", () => {
    setCachedVariant("GZF1", "p.Gly100Asp", "Q9H116", {
      pdbText: "ATOM 1 CA ALA 1 10.0 10.0 10.0",
      analysisResult: {
        analysis: "### 🧬 Molecular and Chemical Shift\n\nGenuine AI narrative.",
        isFallback: false
      }
    });

    const cached = getCachedVariant("GZF1", "p.Gly100Asp");
    expect(cached?.analysisResult?.analysis).toContain("Genuine AI narrative");
  });
});

