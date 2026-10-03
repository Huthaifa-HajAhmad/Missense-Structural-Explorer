// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateClinicalNarrative } from "../narrativeService";
import {
  setCachedVariant,
  getCachedVariant,
  purgeFallbackNarratives,
  clearClientVariantCache,
} from "../variantCache";
import {
  narrativeFreshness,
  narrativeEvidenceSourceFromResult,
  planNarrativeSynthesis,
  readNarrativeEvidenceStamp,
} from "../../../shared/narrativeEvidence";
import {
  DEEP_EVIDENCE_MODEL_IDS,
  DEEP_MODEL_EVIDENCE_VERSION,
  deepModelEvidenceFor,
} from "../../../shared/deepModelEvidence";
import {
  acquireNarrativeFlight,
  narrativeActivityOutstanding,
  narrativeFlightKey,
  resetNarrativeActivity,
  resetNarrativeFlights,
} from "../../../shared/narrativeResynthesis";

describe("narrativeService", () => {
  beforeEach(() => {
    sessionStorage.clear();
    /*
     * The deep-evidence block is read from the run's latest recorded result (`getCachedVariant`), so a
     * bundle left by a previous case would be this case's evidence. Clearing is what keeps each case's
     * evidence its own.
     */
    clearClientVariantCache();
    // The activity and flight registries are module scope, so they outlive a test case otherwise.
    resetNarrativeActivity();
    resetNarrativeFlights();
  });
  it("generates narrative and updates analysis state insights", async () => {
    const mockApiClient = {
      getNarrative: vi.fn().mockResolvedValue({
        analysis: "Detailed clinical narrative explaining Arg408Trp disruption.",
        insights: {
          biochemicalShift: "Positive to hydrophobic",
          structuralImpact: "Steric clash in core",
          acmgCriteria: [{ code: "PS3", category: "pathogenic" }],
          acmgVerdict: "Likely Pathogenic",
          /*
           * The two inference-provenance fields. This reducer names every field it keeps, so anything
           * not named was dropped — and `model`/`source` were both, which made the report's
           * "AI synthesis · <model>" chip fall back to its generic label on this path while the retry
           * path (`useNarrativeResynthesis`, a wholesale spread) kept them. Same synthesis, two
           * renderings, decided by which control the user pressed.
           */
          model: "gemini-3.7-flash",
          source: "ai_inference"
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
    // The inference provenance survives the merge, so the report chip can name the model that
    // answered. Before the spread this reducer kept eight named fields and dropped these two.
    expect(state.result.insights.model).toBe("gemini-3.7-flash");
    expect(state.result.insights.source).toBe("ai_inference");
    /*
     * The narrative span is ADDED, and the trace run is NOT finished here.
     *
     * `finishTraceRun` used to be called from this function, which finished the whole pipeline's trace
     * as soon as the narrative returned — the narrative is triggered fire-and-forget, so the run was
     * often already finished before this span was appended and the waterfall lost the stage entirely.
     * Finishing a run belongs to `usePipelineTelemetry`.
     */
    expect(addTraceSpan).toHaveBeenCalledWith(
      expect.objectContaining({ name: "AI Clinical Narrative & ACMG Synthesis", stage: "clinical", status: "success" })
    );
    expect(finishTraceRun).not.toHaveBeenCalled();
  });

  it("clears the previous model when a re-synthesis degrades, rather than naming the old one", async () => {
    /*
     * The route `delete`s `model` on a degraded response instead of sending null, so a merge that
     * starts from the previous insights would restore the PREVIOUS pass's model beside
     * `source: "rule_based"` — a payload naming a model that did not write this text.
     */
    const mockApiClient = {
      getNarrative: vi.fn().mockResolvedValue({
        analysis: "### Clinical Narrative Unavailable\n\nRule-based evidence only.",
        isFallback: true,
        fallbackReason: "PROVIDER_OVERLOADED",
        insights: { biochemicalShift: "Not synthesized", structuralImpact: "Not synthesized", acmgCriteria: [], source: "rule_based" }
      })
    };

    let state: any = {
      result: {
        analysis: "An earlier AI narrative.",
        insights: { biochemicalShift: "s", structuralImpact: "i", acmgCriteria: [], model: "gemini-3.7-flash", source: "ai_inference" }
      }
    };
    const setAnalysisState = vi.fn((updater) => {
      state = typeof updater === "function" ? updater(state) : updater;
    });

    await generateClinicalNarrative(
      { gene: "PAH", variant: "p.Arg408Trp", uniprotId: "P00439", settings: { acmgWeighting: {} }, bpResult: {} },
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

    expect(state.result.insights.source).toBe("rule_based");
    expect(state.result.insights.model, "the old model must not be inherited").toBeUndefined();
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

  /**
   * The evidence the synthesis was given, and the provenance of the install.
   *
   * `serviceStatus` inside the request is not decoration: the route hashes it into the narrative cache
   * key, and without it a ClinVar TIMEOUT (which arrives as `clinvar: null`) hashes identically to a
   * ClinVar query that was never made — while the two produce different prompt text.
   */
  it("forwards the run's per-source outcomes and the evidence the route hashes", async () => {
    const mockApiClient = { getNarrative: vi.fn().mockResolvedValue({ analysis: "Narrative", insights: null }) };
    const setAnalysisState = vi.fn();
    const bpResult = {
      clinvar: null,
      serviceStatus: { clinvar: "timeout", gnomad: "ok" },
      gnomadFrequency: { groupMaxAF: 0.0001 },
      aouFrequency: { aouAC: 2, aouAN: 50000 },
      energetics: { foldx: 2.2, dynamut2: -1.4 },
      dynamut2Status: "done",
      metadata: { sequence: "MSTAVL" }
    };

    await generateClinicalNarrative(
      // A variant of its own: `getCachedVariant` is consulted for the deep block, and another test in this
      // file leaves a bundle for the shared fixture's variant.
      { gene: "PAH", variant: "p.Gly222Asp", uniprotId: "P00439", settings: { acmgWeighting: "standard" }, bpResult },
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

    const [payload] = mockApiClient.getNarrative.mock.calls[0];
    expect(payload.serviceStatus).toEqual({ clinvar: "timeout", gnomad: "ok" });
    // `aouFrequency` was accepted by the route's schema, read by the route's frequency sentence, and
    // forwarded by no client path at all. It is part of the shared contract now.
    expect(payload.aouFrequency).toEqual({ aouAC: 2, aouAN: 50000 });
    expect(payload.sequence).toBe("MSTAVL");

    // The deep-model block travels with it, in the shape the route's schema validates.
    expect(payload.deepEvidence.version).toBe(DEEP_MODEL_EVIDENCE_VERSION);
    expect(payload.deepEvidence.observations).toHaveLength(DEEP_EVIDENCE_MODEL_IDS.length);
    const foldx = payload.deepEvidence.observations.find((o: any) => o.id === "foldx");
    expect(foldx.value).toBe(2.2);
    expect(foldx.state).toBe("computed");
  });

  it("sends the deep evidence the run recorded on its analysis result, not only the biophysical payload", async () => {
    /*
     * The language-model evaluations land on the ANALYSIS result (the structural stage merges them
     * there and into the cache bundle), while the stability values arrive on the biophysical response.
     * The automatic pass used to build its request from the biophysical payload alone, so it saw less
     * than the explicit Re-synthesize control did for the same run — one run with two evidence sets,
     * decided by which control asked.
     */
    setCachedVariant("PAH", "p.Arg408Trp", "P00439", {
      analysisResult: {
        metadata: { gene: "PAH", variant: "p.Arg408Trp", uniprotId: "P00439" },
        esm2Eval: { llr: -3.2, provenance: "ESM-2 650M (local)" }
      }
    });
    const mockApiClient = { getNarrative: vi.fn().mockResolvedValue({ analysis: "Narrative", insights: null }) };

    await generateClinicalNarrative(
      {
        gene: "PAH",
        variant: "p.Arg408Trp",
        uniprotId: "P00439",
        settings: { acmgWeighting: "standard" },
        bpResult: { energetics: { foldx: 1.5 } }
      },
      mockApiClient,
      { addToHistory: vi.fn(), setSelectedResidueIndex: vi.fn() },
      {
        setAnalysisState: vi.fn(),
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

    const [payload] = mockApiClient.getNarrative.mock.calls[0];
    const esm2 = payload.deepEvidence.observations.find((o: any) => o.id === "esm2");
    expect(esm2.value).toBe(-3.2);
    expect(esm2.provenance).toContain("ESM-2 650M");
    // ...and the stability side still comes from this pass's own payload.
    expect(payload.deepEvidence.observations.find((o: any) => o.id === "foldx").value).toBe(1.5);
  });

  it("records the evidence revision the narrative was written from", async () => {
    const mockApiClient = {
      getNarrative: vi.fn().mockResolvedValue({ analysis: "Narrative", insights: { biochemicalShift: "s" } })
    };
    const bpResult = {
      clinvar: { classification: "Pathogenic" },
      predictorData: { caddPhred: 27.4 },
      metadata: { sequence: "MSTAVL", pipelineRunId: "1:1700" }
    };
    let state: any = { result: bpResult };
    const setAnalysisState = vi.fn((updater) => {
      state = typeof updater === "function" ? updater(state) : updater;
    });

    await generateClinicalNarrative(
      { gene: "PAH", variant: "p.Arg408Trp", uniprotId: "P00439", settings: { acmgWeighting: "standard" }, bpResult },
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

    const stamp = readNarrativeEvidenceStamp(state.result);
    expect(stamp?.revision).toMatch(/^nev\d+:[0-9a-f]{32}$/);
    expect(stamp?.pipelineRunId).toBe("1:1700");
    // The deep-model observations are part of this synthesis, and the install says so rather than
    // leaving a surface to infer it from the presence of a ΔΔG.
    expect(stamp?.deepEvidenceIntegrated).toBe(true);
    // The evidence in hand is the evidence the prose describes.
    expect(narrativeFreshness(state.result)).toBe("current");
  });

  it("does not write a superseded request's failure over the current report", async () => {
    /*
     * A rejected promise carries no payload to compare, so a transport error used to be written
     * whenever the signal was still live — including for the variant the reader had already left.
     * `getActiveRequestId()` is the pipeline's own answer to "has this run been superseded".
     */
    const mockApiClient = { getNarrative: vi.fn().mockRejectedValue(new Error("socket hang up")) };
    let state: any = { result: { analysis: "current report", insights: { model: "gemini-3.7-flash" } } };
    const setAnalysisState = vi.fn((updater) => {
      state = typeof updater === "function" ? updater(state) : updater;
    });

    await generateClinicalNarrative(
      { gene: "PAH", variant: "p.Arg408Trp", uniprotId: "P00439", settings: { acmgWeighting: "standard" }, bpResult: {} },
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
      // The store has moved on to request 2.
      () => 2
    );

    expect(setAnalysisState).not.toHaveBeenCalled();
    expect(state.result.analysis).toBe("current report");
    expect(state.result.providerDetail).toBeUndefined();
  });

  it("clears AI provenance when the request itself fails", async () => {
    /*
     * The transport-failure branch replaced the prose and the degradation flags but kept `prev.result`
     * wholesale, so the previous pass's plausibility paragraph, model and `source: "ai_inference"` sat
     * beside a rule-based status strip — the same contradiction the response path was fixed for.
     */
    const mockApiClient = { getNarrative: vi.fn().mockRejectedValue(new Error("Rate limit exceeded")) };
    let state: any = {
      result: {
        analysis: "previous AI narrative",
        insights: {
          biochemicalShift: "old shift",
          structuralImpact: "old impact",
          plausibility: "AI said this was plausible.",
          model: "gemini-3.7-flash",
          source: "ai_inference",
          acmgCriteria: [{ code: "PP3", reason: "old" }]
        },
        ruleBasedInsights: {
          acmgVerdict: "Variant of Uncertain Significance (VUS)",
          acmgCriteria: [{ code: "PM2", reason: "rare" }]
        }
      }
    };
    const setAnalysisState = vi.fn((updater) => {
      state = typeof updater === "function" ? updater(state) : updater;
    });

    await generateClinicalNarrative(
      { gene: "PAH", variant: "p.Arg408Trp", uniprotId: "P00439", settings: { acmgWeighting: "standard" }, bpResult: null },
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

    expect(state.result.insights.plausibility).toBe("");
    expect(state.result.insights.model).toBeUndefined();
    expect(state.result.insights.source).toBe("rule_based");
    // An empty list is not an empty panel: `acmgCriteriaView` falls back to the engine's own codes,
    // so this drops the previous synthesis's suggestions rather than the reader's criteria.
    expect(state.result.insights.acmgCriteria).toEqual([]);
    expect(state.result.insights.acmgVerdict).toBe("Variant of Uncertain Significance (VUS)");
    expect(state.result.providerDetail).toBe("Rate limit exceeded");
  });

  it("records a failed span, and still does not finish the run", async () => {
    const mockApiClient = { getNarrative: vi.fn().mockRejectedValue(new Error("socket hang up")) };
    let state: any = { result: { analysis: "current" } };
    const setAnalysisState = vi.fn((updater) => {
      state = typeof updater === "function" ? updater(state) : updater;
    });
    const addTraceSpan = vi.fn();
    const finishTraceRun = vi.fn();

    await generateClinicalNarrative(
      { gene: "PAH", variant: "p.Arg408Trp", uniprotId: "P00439", settings: { acmgWeighting: "standard" }, bpResult: {} },
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
      () => 1,
      { activeTraceId: "t-nar", traceStart: performance.now(), addTraceSpan, finishTraceRun }
    );

    expect(addTraceSpan).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "clinical", status: "failed", error: "socket hang up" })
    );
    expect(finishTraceRun).not.toHaveBeenCalled();
  });

  it("does not synthesize automatically when the reader's narrative mode is on-demand or off", async () => {
    /*
     * THIS function is the automatic pass. `on-demand` means a narrative is produced when the reader
     * asks for one, and `off` means never — honoured here as well as in the orchestrator, because the
     * trigger that runs on every analysis is the one a reader notices.
     */
    for (const narrativeMode of ["on-demand", "off"]) {
      const mockApiClient = { getNarrative: vi.fn().mockResolvedValue({ analysis: "Narrative", insights: null }) };
      const setAnalysisState = vi.fn();
      const setIsNarrativeLoading = vi.fn();

      await generateClinicalNarrative(
        {
          gene: "PAH",
          variant: "p.Arg408Trp",
          uniprotId: "P00439",
          settings: { acmgWeighting: "standard", narrativeMode },
          bpResult: { clinvar: { classification: "Pathogenic" } }
        },
        mockApiClient,
        { addToHistory: vi.fn(), setSelectedResidueIndex: vi.fn() },
        {
          setAnalysisState,
          setLoadingStep: vi.fn(),
          setIsBiophysicalLoading: vi.fn(),
          setIsStructuralLoading: vi.fn(),
          setIsClinicalLoading: vi.fn(),
          setIsNarrativeLoading
        },
        new AbortController().signal,
        1,
        () => 1
      );

      expect(mockApiClient.getNarrative, `${narrativeMode} must not spend a model call`).not.toHaveBeenCalled();
      expect(setAnalysisState).not.toHaveBeenCalled();
      // Nothing is claimed: the report keeps its evidence and no provenance field is touched.
      expect(setIsNarrativeLoading).not.toHaveBeenCalledWith(true);
    }
  });

  it("adds no span when the trace context has no active run", async () => {
    const mockApiClient = { getNarrative: vi.fn().mockResolvedValue({ analysis: "Narrative", insights: null }) };
    let state: any = { result: { analysis: "base" } };
    const setAnalysisState = vi.fn((updater) => {
      state = typeof updater === "function" ? updater(state) : updater;
    });
    const addTraceSpan = vi.fn();

    await generateClinicalNarrative(
      { gene: "PAH", variant: "p.Arg408Trp", uniprotId: "P00439", settings: { acmgWeighting: "standard" }, bpResult: {} },
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
      () => 1,
      { activeTraceId: null, traceStart: 0, addTraceSpan }
    );

    expect(addTraceSpan).not.toHaveBeenCalled();
  });

  /**
   * The run's CURRENT evidence, when the orchestrator can vouch for it.
   *
   * `bpResult` carries no FoldX energetics — the stability route does not return them and
   * `createCompletedAnalysisState` never copies them — so without this snapshot the automatic pass
   * described itself from a weaker evidence set than the explicit Re-synthesize control, and the two
   * could not coalesce because they hashed different evidence.
   */
  const CURRENT_RUN = {
    result: {
      metadata: { gene: "PAH", variant: "p.Gly222Asp", uniprotId: "P00439", pipelineRunId: "1:1700" },
      clinvar: { classification: "Pathogenic" },
      esm2Eval: { llr: -3.2, provenance: "ESM-2 650M (local)" }
    },
    context: { stability: { foldingEnergetics: { foldx: 2.85 }, foldingStatus: "success" as const } }
  };

  it("describes itself from the run's current evidence snapshot when one is supplied", async () => {
    const mockApiClient = { getNarrative: vi.fn().mockResolvedValue({ analysis: "Narrative", insights: null }) };
    const setAnalysisState = vi.fn();

    await generateClinicalNarrative(
      {
        gene: "PAH",
        variant: "p.Gly222Asp",
        uniprotId: "P00439",
        settings: { acmgWeighting: "standard" },
        // The weaker payload the pass used to rely on: no energetic values at all.
        bpResult: { metadata: { sequence: "MSTAVL" } }
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
      () => 1,
      undefined,
      () => CURRENT_RUN as any
    );

    const [payload] = mockApiClient.getNarrative.mock.calls[0];
    // Deep side: the FoldX reading from the store context and the ESM evaluation from the recorded
    // result — the two locations the snapshot exists to join.
    expect(payload.deepEvidence.observations.find((o: any) => o.id === "foldx").value).toBe(2.85);
    expect(payload.deepEvidence.observations.find((o: any) => o.id === "esm2").value).toBe(-3.2);
    // Fast side: the snapshot is the whole evidence set, not just the deep half.
    expect(payload.clinvar).toEqual({ classification: "Pathogenic" });
  });

  it("ignores a snapshot that names another run, and a getter that throws", async () => {
    const mockApiClient = { getNarrative: vi.fn().mockResolvedValue({ analysis: "Narrative", insights: null }) };
    const bpResult = { metadata: { sequence: "MSTAVL" }, predictorData: { caddPhred: 27.4 } };

    for (const getCurrentEvidence of [
      // Another variant's result: planning from it would describe this run with that run's evidence.
      () => ({ ...CURRENT_RUN, result: { ...CURRENT_RUN.result, metadata: { gene: "GZF1", variant: "p.Arg591Trp" } } }) as any,
      () => {
        throw new Error("store not ready");
      },
    ]) {
      mockApiClient.getNarrative.mockClear();
      await generateClinicalNarrative(
        { gene: "PAH", variant: "p.Gly222Asp", uniprotId: "P00439", settings: { acmgWeighting: "standard" }, bpResult },
        mockApiClient,
        { addToHistory: vi.fn(), setSelectedResidueIndex: vi.fn() },
        {
          setAnalysisState: vi.fn(),
          setLoadingStep: vi.fn(),
          setIsBiophysicalLoading: vi.fn(),
          setIsStructuralLoading: vi.fn(),
          setIsClinicalLoading: vi.fn(),
          setIsNarrativeLoading: vi.fn()
        },
        new AbortController().signal,
        1,
        () => 1,
        undefined,
        getCurrentEvidence
      );

      const [payload] = mockApiClient.getNarrative.mock.calls[0];
      expect(payload.predictorData).toEqual({ caddPhred: 27.4 });
      expect(payload.deepEvidence.observations.find((o: any) => o.id === "foldx").value).toBeNull();
    }
  });

  it("does not consult the snapshot when the narrative mode skips the pass", async () => {
    const getCurrentEvidence = vi.fn(() => CURRENT_RUN as any);

    await generateClinicalNarrative(
      {
        gene: "PAH",
        variant: "p.Gly222Asp",
        uniprotId: "P00439",
        settings: { acmgWeighting: "standard", narrativeMode: "off" },
        bpResult: {},
        getCurrentEvidence
      },
      { getNarrative: vi.fn() },
      { addToHistory: vi.fn(), setSelectedResidueIndex: vi.fn() },
      {
        setAnalysisState: vi.fn(),
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

    expect(getCurrentEvidence).not.toHaveBeenCalled();
  });

  it("joins a synthesis already in flight for the same identity and evidence", async () => {
    /*
     * The automatic pass and the explicit control now compute the same plan from the same evidence, so
     * they must share one provider call: a reader who presses Re-synthesize while the automatic
     * synthesis is running waits for it instead of paying for a second one.
     */
    const mockApiClient = { getNarrative: vi.fn().mockResolvedValue({ analysis: "Narrative", insights: null }) };
    let joinedState: any = { result: { metadata: { gene: "PAH", variant: "p.Gly222Asp" } } };
    const setAnalysisState = vi.fn((updater: any) => {
      joinedState = typeof updater === "function" ? updater(joinedState) : updater;
    });

    // The flight the manual control would already own, keyed from the SAME plan.
    const plan = planNarrativeSynthesis(
      { gene: "PAH", variant: "p.Gly222Asp", uniprotId: "P00439" },
      narrativeEvidenceSourceFromResult(CURRENT_RUN.result, CURRENT_RUN.context),
      { acmgWeighting: "standard", deepEvidence: deepModelEvidenceFor(CURRENT_RUN.result, CURRENT_RUN.context) }
    );
    let releaseOwner: () => void = () => {};
    const ownerGate = new Promise<void>(resolve => {
      releaseOwner = resolve;
    });
    const owner = acquireNarrativeFlight(
      // The same identity, RUN and revision the pass will compute — the run is part of the key, so it
      // must be the one the snapshot declares.
      narrativeFlightKey({ gene: "PAH", variant: "p.Gly222Asp", uniprotId: "P00439" }, plan.revision, "1:1700"),
      async () => {
        await ownerGate;
      }
    );

    const run = generateClinicalNarrative(
      {
        gene: "PAH",
        variant: "p.Gly222Asp",
        uniprotId: "P00439",
        settings: { acmgWeighting: "standard" },
        bpResult: {},
        getCurrentEvidence: () => CURRENT_RUN as any
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

    // It is waiting on the owner's synthesis, not running its own: no provider call, and no install.
    // The one write it does make is the stage's `running` stamp — which belongs to the same run and
    // which the owner's terminal outcome will replace.
    await Promise.resolve();
    expect(mockApiClient.getNarrative).not.toHaveBeenCalled();
    expect(joinedState.result.analysis).toBeUndefined();
    expect(joinedState.result.metadata.pipelineStages.narrative).toBe("running");

    releaseOwner();
    await run;

    expect(mockApiClient.getNarrative).not.toHaveBeenCalled();
    expect(joinedState.result.analysis).toBeUndefined();
    expect(owner.owner).toBe(true);
    owner.release();
    expect(narrativeActivityOutstanding()).toBe(false);
  });

  it("does not hand one run's synthesis to another run of the same variant", async () => {
    /*
     * A re-analysis of one variant can produce evidence byte-identical to the previous run's — the same
     * ClinVar record, the same ΔΔG, the same sequence — so a key of identity+revision alone made the two
     * runs ONE flight. The owner's install then refused the other run (its identity guard compares
     * `pipelineRunId`), so the run that asked second got no narrative and its spinner resolved to
     * nothing. Both runs must reach their own install, from their own request.
     */
    const gates: Array<(value: any) => void> = [];
    const mockApiClient = {
      getNarrative: vi.fn(() => new Promise(resolve => gates.push(resolve))),
    };

    const stateFor = () => {
      let state: any = { result: { analysis: "base", metadata: { gene: "PAH", variant: "p.Gly222Asp" } } };
      const setAnalysisState = vi.fn((updater: any) => {
        state = typeof updater === "function" ? updater(state) : updater;
      });
      return {
        get state() {
          return state;
        },
        setAnalysisState,
      };
    };

    const evidence = (runId: string) => ({
      result: {
        metadata: { gene: "PAH", variant: "p.Gly222Asp", uniprotId: "P00439", pipelineRunId: runId },
        clinvar: { classification: "Pathogenic" },
        esm2Eval: { llr: -3.2 }
      },
      context: { stability: { foldingEnergetics: { foldx: 2.85 } } }
    });

    const sinks = (target: ReturnType<typeof stateFor>) => ({
      setAnalysisState: target.setAnalysisState,
      setLoadingStep: vi.fn(),
      setIsBiophysicalLoading: vi.fn(),
      setIsStructuralLoading: vi.fn(),
      setIsClinicalLoading: vi.fn(),
      setIsNarrativeLoading: vi.fn()
    });

    const runA = stateFor();
    const runB = stateFor();
    const a = generateClinicalNarrative(
      {
        gene: "PAH",
        variant: "p.Gly222Asp",
        uniprotId: "P00439",
        settings: { acmgWeighting: "standard" },
        bpResult: {},
        getCurrentEvidence: () => evidence("1:1700") as any
      },
      mockApiClient,
      { addToHistory: vi.fn(), setSelectedResidueIndex: vi.fn() },
      sinks(runA),
      new AbortController().signal,
      1,
      () => 1
    );
    const b = generateClinicalNarrative(
      {
        gene: "PAH",
        variant: "p.Gly222Asp",
        uniprotId: "P00439",
        settings: { acmgWeighting: "standard" },
        bpResult: {},
        getCurrentEvidence: () => evidence("2:1800") as any
      },
      mockApiClient,
      { addToHistory: vi.fn(), setSelectedResidueIndex: vi.fn() },
      sinks(runB),
      new AbortController().signal,
      1,
      () => 1
    );

    // Two runs, two requests — not one shared call.
    await Promise.resolve();
    expect(mockApiClient.getNarrative).toHaveBeenCalledTimes(2);

    // Each run's own install lands, with its own run recorded on the stamp.
    gates[0]({ analysis: "Narrative for run A", insights: null });
    gates[1]({ analysis: "Narrative for run B", insights: null });
    await Promise.all([a, b]);

    expect(runA.state.result.analysis).toBe("Narrative for run A");
    expect(runB.state.result.analysis).toBe("Narrative for run B");
    expect(readNarrativeEvidenceStamp(runA.state.result)?.pipelineRunId).toBe("1:1700");
    expect(readNarrativeEvidenceStamp(runB.state.result)?.pipelineRunId).toBe("2:1800");
    expect(narrativeActivityOutstanding()).toBe(false);
  });

  /**
   * `metadata.pipelineStages.narrative` — the stage no synthesis recorded, so a run that had produced a
   * narrative was indistinguishable from one that never asked for it.
   */
  const runWithSiblingStages = () => {
    let state: any = {
      result: {
        analysis: "base",
        ruleBasedInsights: { acmgVerdict: "VUS", acmgCriteria: [{ code: "PM2", reason: "rare" }] },
        metadata: {
          gene: "PAH",
          variant: "p.Gly222Asp",
          uniprotId: "P00439",
          pipelineRunId: "1:1700",
          pipelineStages: { core: "complete", landscape: "complete", structural: "degraded" }
        }
      }
    };
    const seen: any[] = [];
    const setAnalysisState = vi.fn((updater: any) => {
      state = typeof updater === "function" ? updater(state) : updater;
      seen.push({ ...state.result.metadata.pipelineStages });
    });
    return {
      seen,
      setAnalysisState,
      get state() {
        return state;
      }
    };
  };

  const runNarrative = (mockApiClient: any, target: ReturnType<typeof runWithSiblingStages>) =>
    generateClinicalNarrative(
      {
        gene: "PAH",
        variant: "p.Gly222Asp",
        uniprotId: "P00439",
        settings: { acmgWeighting: "standard" },
        bpResult: {},
        getCurrentEvidence: () => CURRENT_RUN as any
      },
      mockApiClient,
      { addToHistory: vi.fn(), setSelectedResidueIndex: vi.fn() },
      {
        setAnalysisState: target.setAnalysisState,
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

  it("marks the narrative stage running, then complete, with sibling stages intact", async () => {
    const mockApiClient = {
      getNarrative: vi.fn().mockResolvedValue({ analysis: "AI prose", insights: { biochemicalShift: "s" } }),
    };
    const target = runWithSiblingStages();

    await runNarrative(mockApiClient, target);

    // The first write of the pass says the stage is running; the last says how it actually ended.
    expect(target.seen[0]).toEqual({
      core: "complete",
      landscape: "complete",
      structural: "degraded",
      narrative: "running",
    });
    expect(target.state.result.metadata.pipelineStages).toEqual({
      core: "complete",
      landscape: "complete",
      structural: "degraded",
      narrative: "complete",
    });
    // The rest of the metadata, and the run it belongs to, survive the stage write.
    expect(target.state.result.metadata.pipelineRunId).toBe("1:1700");
    expect(readNarrativeEvidenceStamp(target.state.result)?.pipelineRunId).toBe("1:1700");
  });

  it("ends the stage degraded for a provider's rule-based report, error for a request that never arrived", async () => {
    const providerFallback = runWithSiblingStages();
    await runNarrative(
      {
        getNarrative: vi.fn().mockResolvedValue({
          analysis: "### Rule-Based Clinical Summary\n\nLive AI synthesis was not applied.",
          isFallback: true,
          fallbackReason: "PROVIDER_OVERLOADED",
          fallbackMessage: "Gemini reported that the requested models are overloaded.",
          fallbackRetryable: true,
          insights: { biochemicalShift: "Not synthesized", structuralImpact: "Not synthesized", acmgCriteria: [] },
        }),
      },
      providerFallback
    );
    expect(providerFallback.state.result.metadata.pipelineStages.narrative).toBe("degraded");
    // Siblings survive, and the report's own reconciled criteria are untouched by the stage write.
    expect(providerFallback.state.result.metadata.pipelineStages.structural).toBe("degraded");
    expect(providerFallback.state.result.insights.acmgVerdict).toBe("VUS");

    const transportFailure = runWithSiblingStages();
    await runNarrative({ getNarrative: vi.fn().mockRejectedValue(new Error("socket hang up")) }, transportFailure);
    expect(transportFailure.state.result.metadata.pipelineStages).toEqual({
      core: "complete",
      landscape: "complete",
      structural: "degraded",
      narrative: "error",
    });
  });
});

