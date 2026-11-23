// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchStructural } = vi.hoisted(() => ({ fetchStructural: vi.fn(async (..._args: unknown[]) => undefined) }));
vi.mock("../services/pipeline/biophysicalService", () => ({ fetchProgressiveStructuralAssessments: fetchStructural }));
vi.mock("../context/SettingsContext", () => ({
  useSettings: () => ({ settings: { acmgWeighting: "standard", energyUnit: "kcal/mol" }, updateSetting: vi.fn(), resetSettingsToDefault: vi.fn(), setSettings: vi.fn(), setShowPolarContacts: vi.fn(), setIsSettingsOpen: vi.fn() }),
}));
vi.mock("../apiClient", () => ({ useApiClient: () => ({ fetchWithAuth: vi.fn(), apiClient: {} }) }));
vi.mock("../hooks/useBiophysicalModeling", () => ({
  useBiophysicalModeling: () => ({ clearDynaMutPoll: vi.fn(), clearDdmutPoll: vi.fn(), clearThermoMpnnPoll: vi.fn() }),
}));
vi.mock("../hooks/useFoldxSuperposition", () => ({ useFoldxSuperposition: vi.fn() }));
vi.mock("../hooks/useAnalysisPipeline", () => ({ useAnalysisPipeline: () => ({ executeAnalysis: vi.fn(), activeRequestIdRef: { current: 0 } }) }));

import useVariantAnalysis from "../useVariantAnalysis";
import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";
import { createAnalysisCacheContext } from "../services/pipeline/analysisContext";

/**
 * A manual structural retry must ask the server about the same allele the run asked about. The run's
 * genome build, coordinates and numbering travel on its first request; the retry used to send only the
 * gene, protein change, accession and weighting, so a protein change with several possible DNA changes
 * could be recomputed for another one and written over the selected allele's rule insights.
 */
describe("retryStructuralAnalysis", () => {
  beforeEach(() => fetchStructural.mockClear());

  const withResult = (metadata: Record<string, unknown>) =>
    useVariantAnalysisStore.setState({
      gene: "PAH", variant: "p.Arg408Trp", uniprotId: "P00439",
      analysisState: { result: { metadata: { gene: "PAH", variant: "p.Arg408Trp", uniprotId: "P00439", ...metadata } }, isLoading: false, error: null },
    } as never);

  it("sends the run's saved genome build, coordinates and numbering", async () => {
    const pipelineContext = createAnalysisCacheContext(
      "P00439", { acmgWeighting: "conservative" },
      { assembly: "GRCh37", genomicCoordinates: "12-103234254", resolvedAssembly: "GRCh38", liftedGenomicCoordinates: "12-102840476" }, "", "uniprot"
    );
    withResult({ pipelineContext });
    const { result } = renderHook(() => useVariantAnalysis());
    await result.current.retryStructuralAnalysis();
    expect(fetchStructural.mock.calls[0][0]).toEqual({
      gene: "PAH", variant: "p.Arg408Trp", uniprotId: "P00439",
      acmgWeighting: "conservative", assembly: "GRCh37", genomicCoordinates: "12-103234254",
      resolvedAssembly: "GRCh38", liftedGenomicCoordinates: "12-102840476", numberingBasis: "uniprot",
    });
  });

  it("falls back to the weighting from settings for a save that predates the saved context", async () => {
    withResult({});
    const { result } = renderHook(() => useVariantAnalysis());
    await result.current.retryStructuralAnalysis();
    expect(fetchStructural.mock.calls[0][0]).toEqual({ gene: "PAH", variant: "p.Arg408Trp", uniprotId: "P00439", acmgWeighting: "standard" });
  });
});
