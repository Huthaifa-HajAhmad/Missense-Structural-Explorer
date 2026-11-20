// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppEffects } from "../useAppEffects";
import { useVariantUrlSync } from "../useVariantUrlSync";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { clearClientVariantCache } from "../../services/pipeline/variantCache";

beforeEach(() => {
  clearClientVariantCache();
  localStorage.clear();
  useVariantAnalysisStore.setState({
    gene: "FGFR3", variant: "p.Gly380Arg", uniprotId: "P22607", history: [],
    analysisState: { result: null, isLoading: false, error: null },
  });
});
afterEach(() => window.history.replaceState({}, "", "/"));

it.each(["A", "C"])("restores the exact G>%s allele when application hooks mount together", (alt) => {
  window.history.replaceState({}, "", "/?gene=FGFR3&variant=p.Gly380Arg&uniprot=P22607" +
    "&allele=4-1804392-G-" + alt + "&assembly=GRCh38&transcript=NM_000142.5");
  const executeAnalysis = vi.fn();
  renderHook(() => {
    useVariantUrlSync();
    useAppEffects({
      masterView: "search",
      setMasterView: vi.fn(), setActiveEvidenceTab: vi.fn(), setIsOffline: vi.fn(),
      fetchWithAuth: vi.fn(), consoleDispatch: vi.fn(), executeAnalysis,
      settings: { acmgWeighting: "standard", narrativeMode: "off" },
    });
  });
  expect(executeAnalysis).toHaveBeenCalledWith("FGFR3", "Chr4(GRCh38):g.1804392G>" + alt, "P22607");
  expect(new URLSearchParams(window.location.search).get("allele")).toBe("4-1804392-G-" + alt);
});

it("updates the address bar after the restored result arrives", () => {
  window.history.replaceState({}, "", "/?gene=FGFR3&variant=p.Gly380Arg&uniprot=P22607");
  const { rerender } = renderHook(() => useVariantUrlSync());
  useVariantAnalysisStore.setState({
    analysisState: {
      result: {
        metadata: {
          gene: "FGFR3", variant: "p.Gly380Arg", uniprotId: "P22607",
          residueIndex: 380, wildType: "G", mutant: "R",
        },
        predictorData: {
          gnomadVariantId: "4-1804392-G-C", gnomadVariantAssembly: "GRCh38",
          amPathogenicity: null, amClass: null, caddPhred: null,
        },
        maneRefSeqId: "NM_000142.5",
      },
      isLoading: false, error: null,
    },
  });
  rerender();
  const params = new URLSearchParams(window.location.search);
  expect(params.get("allele")).toBe("4-1804392-G-C");
  expect(params.get("assembly")).toBe("GRCh38");
  expect(params.get("transcript")).toBe("NM_000142.5");
});
