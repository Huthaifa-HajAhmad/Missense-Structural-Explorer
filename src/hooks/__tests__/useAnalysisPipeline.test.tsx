// @vitest-environment jsdom
import React from "react";
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAnalysisPipeline } from "../useAnalysisPipeline";
import { setCachedVariant } from "../../services/pipeline/variantCache";
import { DevConsoleProvider } from "../../context/DevConsoleContext";

describe("useAnalysisPipeline Hook Integration", () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <DevConsoleProvider>{children}</DevConsoleProvider>
  );

  let mockApiClient: any;
  let mockFetchWithAuth: any;
  let mockOptions: any;

  beforeEach(() => {
    mockApiClient = {
      getPdb: vi.fn().mockResolvedValue("ATOM 1 N ..."),
      getHomologs: vi.fn().mockResolvedValue([{ pdbId: "1PAH", resolution: 1.8 }]),
      getBiophysicalAnalysis: vi.fn().mockResolvedValue({
        analysis: "Biophysical analysis complete",
        clinvar: { classification: "Pathogenic" },
        metadata: { uniprotId: "P00439", sequence: "MSAQ..." }
      }),
      getNarrative: vi.fn().mockResolvedValue({
        analysis: "Clinical narrative generated",
        insights: { biochemicalShift: "A->V", acmgVerdict: "Pathogenic" }
      }),
      getLandscapeData: vi.fn().mockResolvedValue({ landscapeData: [] }),
      getStructuralAssessments: vi.fn().mockResolvedValue({
        esm3Eval: { score: 0.9 },
        esmcEval: { score: 0.88 },
        esm2Eval: { score: 0.85 },
        saprotEval: { score: 0.92 }
      }),
      findPocket: vi.fn().mockResolvedValue({ pockets: [] }),
      translateVariant: vi.fn().mockResolvedValue({
        gene: "PAH",
        variant: "p.Arg408Trp",
        uniprotId: "P00439"
      })
    };

    mockFetchWithAuth = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "completed",
        pdb: "ATOM MUT ...",
        foldedResidueIndex: 408,
        ddG: 1.5,
        energetics: { totalEnergy: 12.0 }
      })
    });

    mockOptions = {
      fetchWithAuth: mockFetchWithAuth,
      apiClient: mockApiClient,
      settings: { acmgWeighting: {} },
      userDirections: "",
      setAnalysisState: vi.fn(),
      setLoadingStep: vi.fn(),
      setIsBiophysicalLoading: vi.fn(),
      setIsClinicalLoading: vi.fn(),
      setIsNarrativeLoading: vi.fn(),
      setGene: vi.fn(),
      setVariant: vi.fn(),
      setUniprotId: vi.fn(),
      setSearchVal: vi.fn(),
      setCustomGene: vi.fn(),
      setCustomVariant: vi.fn(),
      setCustomUniprot: vi.fn(),
      setSelectedResidueIndex: vi.fn(),
      setDisruptionPredictor: vi.fn(),
      setComputedPocket: vi.fn(),
      setIsPocketLoading: vi.fn(),
      setPocketError: vi.fn(),
      setPdbText: vi.fn(),
      addToHistory: vi.fn(),
      resetViewerState: vi.fn(),
      clearDynaMutPoll: vi.fn(),
      setIsFolding: vi.fn(),
      setFoldingProgress: vi.fn(),
      setFoldingError: vi.fn(),
      setFoldingStatus: vi.fn(),
      setMutantPdb: vi.fn(),
      setFoldedResidueIndex: vi.fn(),
      setFoldingDdG: vi.fn(),
      setFoldingEnergetics: vi.fn(),
      setDynamut2JobId: vi.fn(),
      setDynamut2Status: vi.fn(),
      setDdmutJobId: vi.fn(),
      setDdmutStatus: vi.fn(),
      setThermompnnJobId: vi.fn(),
      setThermompnnStatus: vi.fn(),
      setThermompnnError: vi.fn(),
      lastFetchedFoldRef: { current: "" }
    };
  });

  it("clears the run state an abort leaves behind, BEFORE the new run claims anything", async () => {
    /**
     * The stuck-run fix, and it has to be asserted by ORDER, not by "was it called".
     *
     * `setIsFolding(false)` also happens on a normal completion, so `toHaveBeenCalledWith(false)` alone
     * would pass with the fix removed. What is load-bearing is that the clear comes FIRST — before the
     * new run can skip Stage 3 and leave the flag set with nobody owning it.
     *
     * Mechanism: `abortAllPendingRequests` bumps the request id AND aborts, so `foldxService`'s finally
     * (`!signal.aborted && getActiveRequestId() === requestId`) is false on BOTH clauses and correctly
     * declines to write. If the new run then skips Stage 3 — the search form does, because
     * `lastFetchedFoldRef` still holds the variant, the backfill is cooldown-blocked, and the early
     * return needs no FoldX — nothing sets or clears the flag again, and all six engines render
     * "running" forever.
     */
    const foldRefWrites: string[] = [];
    mockOptions.lastFetchedFoldRef = {
      _value: "PAH_p.Arg408Trp",
      get current() {
        return this._value;
      },
      set current(next: string) {
        foldRefWrites.push(next);
        this._value = next;
      },
    };

    const { result } = renderHook(() => useAnalysisPipeline(), { wrapper });

    await act(async () => {
      await result.current.executeAnalysis("PAH", "p.Arg408Trp", "P00439", undefined, mockOptions);
    });

    expect(
      mockOptions.setIsFolding.mock.calls[0],
      "the first thing a new run does must be clearing what the abort left set"
    ).toEqual([false]);

    expect(
      foldRefWrites[0],
      "the fold ref must be cleared too, or the clear turns a permanent Running into a permanent FoldX no-result that re-searching cannot fix"
    ).toBe("");

    /**
     * ...and the FoldX progress object is cleared with the flag.
     *
     * Without it the previous run's stage, age and queue position stay on screen beside the new
     * run's spinner — the flag says "not folding" while the banner still says "Structure repair".
     * Also asserted by order: the clear must precede anything the new run writes.
     */
    expect(
      mockOptions.setFoldingProgress.mock.calls[0],
      "a new run must clear the previous run's FoldX progress before it claims the request"
    ).toEqual([null]);
  });

  it("orchestrates standard variant analysis end-to-end with legacy flat options", async () => {
    const { result } = renderHook(() => useAnalysisPipeline(), { wrapper });

    await act(async () => {
      await result.current.executeAnalysis("PAH", "p.Arg408Trp", "P00439", undefined, mockOptions);
    });

    expect(mockOptions.setGene).toHaveBeenCalledWith("PAH");
    expect(mockOptions.setVariant).toHaveBeenCalledWith("p.Arg408Trp");
    expect(mockApiClient.getPdb).toHaveBeenCalledWith("P00439", 408, expect.any(AbortSignal));
    expect(mockOptions.setAnalysisState).toHaveBeenCalled();
  });

  it("orchestrates standard variant analysis with structured PipelineStateSinks", async () => {
    const { result } = renderHook(() => useAnalysisPipeline(), { wrapper });

    const searchSink = {
      setGene: vi.fn(),
      setVariant: vi.fn(),
      setUniprotId: vi.fn(),
      setSearchVal: vi.fn(),
      setCustomGene: vi.fn(),
      setCustomVariant: vi.fn(),
      setCustomUniprot: vi.fn(),
      setSelectedResidueIndex: vi.fn(),
      addToHistory: vi.fn()
    };
    const analysisSink = {
      setAnalysisState: vi.fn(),
      setLoadingStep: vi.fn(),
      setIsBiophysicalLoading: vi.fn(),
      setIsStructuralLoading: vi.fn(),
      setIsClinicalLoading: vi.fn(),
      setIsNarrativeLoading: vi.fn()
    };
    const biophysicalSink = {
      setIsFolding: vi.fn(),
      setFoldingProgress: vi.fn(),
      setFoldingError: vi.fn(),
      setFoldingStatus: vi.fn(),
      setMutantPdb: vi.fn(),
      setFoldedResidueIndex: vi.fn(),
      setFoldingDdG: vi.fn(),
      setFoldingEnergetics: vi.fn(),
      setDynamut2JobId: vi.fn(),
      setDynamut2Status: vi.fn(),
      setDdmutJobId: vi.fn(),
      setDdmutStatus: vi.fn(),
      setThermompnnJobId: vi.fn(),
      setThermompnnStatus: vi.fn(),
      setThermompnnError: vi.fn(),
      lastFetchedFoldRef: { current: "" }
    };
    const structureSink = {
      setPdbText: vi.fn(),
      setComputedPocket: vi.fn(),
      setIsPocketLoading: vi.fn(),
      setPocketError: vi.fn(),
      setHomologs: vi.fn(),
      setIsHomologsLoading: vi.fn(),
      setComputedResiduesCache: vi.fn(),
      setDisruptionPredictor: vi.fn(),
      resetViewerState: vi.fn(),
      clearDynaMutPoll: vi.fn()
    };

    await act(async () => {
      await result.current.executeAnalysis("PAH", "p.Arg408Trp", "P00439", undefined, {
        fetchWithAuth: mockFetchWithAuth,
        apiClient: mockApiClient,
        settings: { acmgWeighting: {} },
        userDirections: "",
        sinks: {
          search: searchSink,
          analysis: analysisSink,
          biophysical: biophysicalSink,
          structure: structureSink
        }
      });
    });

    expect(searchSink.setGene).toHaveBeenCalledWith("PAH");
    expect(searchSink.setVariant).toHaveBeenCalledWith("p.Arg408Trp");
    expect(mockApiClient.getPdb).toHaveBeenCalledWith("P00439", 408, expect.any(AbortSignal));
    expect(analysisSink.setAnalysisState).toHaveBeenCalled();
  });

  it("handles genomic variant translation before analysis", async () => {
    const { result } = renderHook(() => useAnalysisPipeline(), { wrapper });

    await act(async () => {
      await result.current.executeAnalysis("PAH", "c.1222C>T", "", undefined, mockOptions);
    });

    expect(mockApiClient.translateVariant).toHaveBeenCalledWith("c.1222C>T", expect.any(AbortSignal));
    expect(mockOptions.setGene).toHaveBeenCalledWith("PAH");
    expect(mockOptions.setVariant).toHaveBeenCalledWith("p.Arg408Trp");
  });

  /**
   * The stale-verdict fix, from the reported Recents behaviour.
   *
   * A bundle is keyed on protein notation (build-free) but embeds an analysis result that is not: one
   * written while a GRCh37 coordinate could not be lifted replayed an older coordinate chip, an older
   * target build and withheld population evidence ("PM2 withheld — this coordinate's build is not one
   * gnomAD r4 serves") for a variant that scores PM2 on a fresh run. The first paint is where that
   * verdict reached the screen, so it is where this is asserted.
   */
  const cachedResult = (overrides: Record<string, unknown>) =>
    ({
      analysis: "Clinical narrative generated",
      insights: { biochemicalShift: "A->V", acmgVerdict: "Pathogenic" },
      ...overrides,
    }) as any;

  it("refuses to paint a cached verdict that was built against a non-canonical build", async () => {
    setCachedVariant("PAH", "p.Arg408Trp", "P00439", {
      analysisResult: cachedResult({
        // The state the old run left: the lift was refused and gnomAD was asked with GRCh37.
        coordinateLift: {
          status: "unavailable",
          fromAssembly: "GRCh37",
          toAssembly: "GRCh37",
          reasonCode: "map-unavailable",
        },
        predictorData: { gnomadVariantId: "16-66857184-T-C", gnomadVariantAssembly: "GRCh37" },
      }),
    });

    const { result } = renderHook(() => useAnalysisPipeline(), { wrapper });
    await act(async () => {
      await result.current.executeAnalysis("PAH", "p.Arg408Trp", "P00439", undefined, mockOptions);
    });

    expect(
      mockOptions.setAnalysisState.mock.calls[0]?.[0],
      "a build-degraded verdict must not be painted as the current answer"
    ).toMatchObject({ isLoading: true, result: null });
  });

  it("still paints a cached verdict whose build was settled", async () => {
    // The control: the guard must not disable the cache. A lifted (canonical) bundle still paints.
    setCachedVariant("PAH", "p.Arg408Trp", "P00439", {
      analysisResult: cachedResult({
        coordinateLift: {
          status: "lifted",
          fromAssembly: "GRCh37",
          toAssembly: "GRCh38",
          reverseVerified: true,
        },
        predictorData: { gnomadVariantId: "16-66823281-T-C", gnomadVariantAssembly: "GRCh38" },
      }),
    });

    const { result } = renderHook(() => useAnalysisPipeline(), { wrapper });
    await act(async () => {
      await result.current.executeAnalysis("PAH", "p.Arg408Trp", "P00439", undefined, mockOptions);
    });

    const firstPaint = mockOptions.setAnalysisState.mock.calls[0]?.[0];
    expect(firstPaint).toMatchObject({ isLoading: false });
    expect(firstPaint.result?.analysis).toBe("Clinical narrative generated");
  });

  /**
   * …and a permanent refusal is NOT re-run: a reference discontinuity is a fact about the coordinate,
   * so its bundle may still be served rather than spending a ladder to hear the same answer.
   */
  it("still paints a cached verdict whose lift refusal was definitive", async () => {
    setCachedVariant("PAH", "p.Arg408Trp", "P00439", {
      analysisResult: cachedResult({
        coordinateLift: {
          status: "unavailable",
          fromAssembly: "GRCh37",
          toAssembly: "GRCh37",
          reasonCode: "reference-discontinuity",
        },
        predictorData: { gnomadVariantId: "16-66857184-T-C", gnomadVariantAssembly: "GRCh37" },
      }),
    });

    const { result } = renderHook(() => useAnalysisPipeline(), { wrapper });
    await act(async () => {
      await result.current.executeAnalysis("PAH", "p.Arg408Trp", "P00439", undefined, mockOptions);
    });

    expect(mockOptions.setAnalysisState.mock.calls[0]?.[0]).toMatchObject({ isLoading: false });
  });

  it("aborts pending requests on demand and increments active request ID", () => {
    const { result } = renderHook(() => useAnalysisPipeline(), { wrapper });

    const initialId = result.current.activeRequestIdRef.current;
    const clearPollMock = vi.fn();

    act(() => {
      result.current.abortAllPendingRequests(clearPollMock);
    });

    expect(clearPollMock).toHaveBeenCalled();
    expect(result.current.activeRequestIdRef.current).toBe(initialId + 1);
  });
});
