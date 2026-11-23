// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import type { MasterView } from "../../types/ui";
import { canvasCoordinates, useStructureWorkspace, type CoordinateSources } from "../useStructureWorkspace";

// The hook reads the evidence model; it is replaced by a value the test controls.
const fake = vi.hoisted(() => ({
  modelViewMode: "wildtype" as "wildtype" | "mutant" | "superimposed",
}));
vi.mock("../useStructure3dEvidence", () => ({
  useStructure3dEvidence: () => ({ viewMode: fake.modelViewMode, canvas: { primary: null }, site: { position: null } }),
}));


const sources: CoordinateSources = {
  pdbText: "AFDB",
  mutantPdb: "FOLDX_MUT",
  foldxReferencePdb: "FOLDX_REF",
  foldxAlignedPdb: "FOLDX_ALIGNED",
  customPdbUrl: null,
  customPdbEntry: null,
};

describe("canvasCoordinates: what the 3D view draws", () => {
  it("the AlphaFold DB model, the FoldX variant, and the FoldX pair on its own template", () => {
    expect(canvasCoordinates("wildtype", sources)).toEqual({ primary: "AFDB", compare: null, allowFetch: true });
    expect(canvasCoordinates("mutant", sources)).toEqual({ primary: "FOLDX_MUT", compare: null, allowFetch: false });
    // Never the AlphaFold model under the FoldX variant: they are two templates in two frames.
    expect(canvasCoordinates("superimposed", sources)).toEqual({ primary: "FOLDX_REF", compare: "FOLDX_ALIGNED", allowFetch: false });
  });

  it("a chosen experimental entry is drawn only once the text for that URL has arrived, and is never replaced by a fetch", () => {
    const url = "https://files.rcsb.org/download/1YOV.pdb";
    const stale = { ...sources, customPdbUrl: url, customPdbEntry: { url: "https://files.rcsb.org/download/2ABC.pdb", text: "OLD" } };
    expect(canvasCoordinates("wildtype", stale)).toEqual({ primary: null, compare: null, allowFetch: false });
    const fresh = { ...sources, customPdbUrl: url, customPdbEntry: { url, text: "ENTRY" } };
    expect(canvasCoordinates("wildtype", fresh)).toEqual({ primary: "ENTRY", compare: null, allowFetch: false });
  });
});

const useWorkspace = (initial: MasterView) => renderHook(({ view }) => useStructureWorkspace(view), { initialProps: { view: initial } });

describe("useStructureWorkspace", () => {
  beforeEach(() => {
    fake.modelViewMode = "wildtype";
    useVariantAnalysisStore.setState({ viewMode: "wildtype", analysisState: { isLoading: false, error: null, result: null } as never });
  });
  afterEach(() => vi.restoreAllMocks());

  it("is active on the 3D structure views only", () => {
    const { result, rerender } = useWorkspace("structure_alphafold");
    expect(result.current.isActive).toBe(true);
    rerender({ view: "landscape" });
    expect(result.current.isActive).toBe(false);
    rerender({ view: "structure" });
    expect(result.current.isActive).toBe(true);
  });

  it("brings the stored view mode in line with the mode the model allows, only while the workspace is open", () => {
    fake.modelViewMode = "mutant";
    const { rerender } = useWorkspace("landscape");
    expect(useVariantAnalysisStore.getState().viewMode).toBe("wildtype");
    rerender({ view: "structure_alphafold" });
    expect(useVariantAnalysisStore.getState().viewMode).toBe("mutant");
  });
});
