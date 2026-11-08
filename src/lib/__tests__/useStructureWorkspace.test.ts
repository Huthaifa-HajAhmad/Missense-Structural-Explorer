// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import type { MasterView } from "../../types/ui";
import { canvasCoordinates, useStructureWorkspace, type CoordinateSources } from "../useStructureWorkspace";

// The hook reads three outside things; each is replaced by a value the test controls.
const fake = vi.hoisted(() => ({
  defaultStructureModel: "alphafold" as "alphafold" | "esmfold",
  modelViewMode: "wildtype" as "wildtype" | "mutant" | "superimposed",
  structuralAlign: vi.fn(),
}));
vi.mock("../../context/SettingsContext", () => ({ useSettings: () => ({ settings: { defaultStructureModel: fake.defaultStructureModel } }) }));
vi.mock("../../apiClient", () => ({ useApiClient: () => ({ apiClient: { structuralAlign: fake.structuralAlign } }) }));
vi.mock("../useStructure3dEvidence", () => ({
  useStructure3dEvidence: () => ({ viewMode: fake.modelViewMode, canvas: { primary: null }, site: { position: null } }),
}));


const sources: CoordinateSources = {
  pdbText: "AFDB",
  mutantPdb: "FOLDX_MUT",
  foldxReferencePdb: "FOLDX_REF",
  foldxAlignedPdb: "FOLDX_ALIGNED",
  esmFoldWtPdb: "ESM_WT",
  esmFoldMutPdb: "ESM_MUT",
  esmFoldAlignedPdb: "ESM_ALIGNED",
  customPdbUrl: null,
  customPdbEntry: null,
};

describe("canvasCoordinates: what each 3D tab draws", () => {
  it("AlphaFold tab: the AlphaFold DB model, the FoldX variant, and the FoldX pair on its own template", () => {
    expect(canvasCoordinates("alphafold", "wildtype", sources)).toEqual({ primary: "AFDB", compare: null, allowFetch: true });
    expect(canvasCoordinates("alphafold", "mutant", sources)).toEqual({ primary: "FOLDX_MUT", compare: null, allowFetch: false });
    // Never the AlphaFold model under the FoldX variant: they are two templates in two frames.
    expect(canvasCoordinates("alphafold", "superimposed", sources)).toEqual({ primary: "FOLDX_REF", compare: "FOLDX_ALIGNED", allowFetch: false });
  });

  it("ESMFold tab: the de novo folds only, and never a fetched AlphaFold model", () => {
    expect(canvasCoordinates("esmfold", "wildtype", { ...sources, esmFoldWtPdb: null })).toEqual({ primary: null, compare: null, allowFetch: false });
    expect(canvasCoordinates("esmfold", "mutant", sources)).toEqual({ primary: "ESM_MUT", compare: null, allowFetch: false });
    expect(canvasCoordinates("esmfold", "superimposed", sources)).toEqual({ primary: "ESM_WT", compare: "ESM_ALIGNED", allowFetch: false });
  });

  it("a chosen experimental entry is drawn only once the text for that URL has arrived, and is never replaced by a fetch", () => {
    const url = "https://files.rcsb.org/download/1YOV.pdb";
    const stale = { ...sources, customPdbUrl: url, customPdbEntry: { url: "https://files.rcsb.org/download/2ABC.pdb", text: "OLD" } };
    expect(canvasCoordinates("alphafold", "wildtype", stale)).toEqual({ primary: null, compare: null, allowFetch: false });
    const fresh = { ...sources, customPdbUrl: url, customPdbEntry: { url, text: "ENTRY" } };
    expect(canvasCoordinates("alphafold", "wildtype", fresh)).toEqual({ primary: "ENTRY", compare: null, allowFetch: false });
  });
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
};
const useWorkspace = (initial: MasterView) => renderHook(({ view }) => useStructureWorkspace(view), { initialProps: { view: initial } });

describe("useStructureWorkspace", () => {
  beforeEach(() => {
    fake.defaultStructureModel = "alphafold";
    fake.modelViewMode = "wildtype";
    fake.structuralAlign.mockReset();
    useVariantAnalysisStore.setState({ viewMode: "wildtype", esmAlignmentScope: "global", esmFoldWtPdb: null, esmFoldMutPdb: null, esmFoldAlignedPdb: null, analysisState: { isLoading: false, error: null, result: null } as never });
  });
  afterEach(() => vi.restoreAllMocks());

  it("remembers the tab while another workspace is open, so the canvas keeps its family", () => {
    const { result, rerender } = useWorkspace("structure_esmfold");
    expect(result.current.family).toBe("esmfold");
    rerender({ view: "landscape" });
    expect(result.current.family).toBe("esmfold");
    expect(result.current.isActive).toBe(false);
    rerender({ view: "structure_alphafold" });
    expect(result.current.family).toBe("alphafold");
  });

  it("opens on the reader's default model when no structure tab has been shown yet", () => {
    fake.defaultStructureModel = "esmfold";
    expect(useWorkspace("landscape").result.current.family).toBe("esmfold");
  });

  it("brings the stored view mode in line with the mode the model allows, only while the workspace is open", () => {
    fake.modelViewMode = "mutant";
    const { rerender } = useWorkspace("landscape");
    expect(useVariantAnalysisStore.getState().viewMode).toBe("wildtype");
    rerender({ view: "structure_alphafold" });
    expect(useVariantAnalysisStore.getState().viewMode).toBe("mutant");
  });

  describe("changing the ESMFold fit scope", () => {
    const seedFolds = () => useVariantAnalysisStore.setState({
      esmFoldWtPdb: "WT", esmFoldMutPdb: "MUT",
      analysisState: { isLoading: false, error: null, result: { metadata: { residueIndex: 116 } } } as never,
    });
    const reply = (alignedPdb: string) => ({ alignedPdb, metrics: { rmsd: alignedPdb.length } });

    it("stores only the answer to the latest request when an older one finishes last", async () => {
      seedFolds();
      const older = deferred<ReturnType<typeof reply>>();
      const newer = deferred<ReturnType<typeof reply>>();
      fake.structuralAlign.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
      const { result } = useWorkspace("structure_esmfold");

      let first!: Promise<void>, second!: Promise<void>;
      act(() => { first = result.current.changeAlignmentScope("local"); });
      act(() => { second = result.current.changeAlignmentScope("global"); });
      await act(async () => { newer.resolve(reply("NEWER")); await second; });
      await act(async () => { older.resolve(reply("OLDER-AND-STALE")); await first; });

      expect(useVariantAnalysisStore.getState().esmFoldAlignedPdb).toBe("NEWER");
      expect(fake.structuralAlign).toHaveBeenCalledWith(expect.objectContaining({ pdb1: "WT", pdb2: "MUT", targetIndex: 116, alignmentScope: "local" }));
    });

    it("does nothing on the AlphaFold tab, whose FoldX pair has no fit scope, or when the scope is unchanged", async () => {
      seedFolds();
      const alpha = useWorkspace("structure_alphafold");
      await act(async () => { await alpha.result.current.changeAlignmentScope("local"); });
      const esm = useWorkspace("structure_esmfold");
      await act(async () => { await esm.result.current.changeAlignmentScope("global"); });
      expect(fake.structuralAlign).not.toHaveBeenCalled();
      expect(useVariantAnalysisStore.getState().esmAlignmentScope).toBe("global");
    });
  });
});
