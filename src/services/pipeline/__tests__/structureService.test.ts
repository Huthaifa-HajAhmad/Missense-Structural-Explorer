import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchPdbCoordinates, fetchHomologStructures, fetchBindingPocket, fetchNearestResidues } from "../structureService";
import { clearStructureRefRegistry, registerStructureRefForPdb, resolveStructureRefForPdb } from "../../../api/structureRefRegistry";

const STRUCTURE_REF = "sref1_0123456789abcdef0123456789abcdef";
const PDB_TEXT = "ATOM      1  CA  ASP A   1      1.000   1.000   1.000  1.00  0.00           C";

describe("structureService", () => {
  describe("fetchPdbCoordinates", () => {
    it("fetches PDB coordinates and records success trace", async () => {
      const mockApiClient = {
        getPdb: vi.fn().mockResolvedValue("ATOM 1 N ...")
      };
      const addTraceSpan = vi.fn();
      const signal = new AbortController().signal;

      const result = await fetchPdbCoordinates(
        "PAH",
        "p.Arg408Trp",
        "P00439",
        408,
        mockApiClient,
        signal,
        {
          activeTraceId: "trace-456",
          traceStart: performance.now(),
          addTraceSpan
        }
      );

      expect(result).toBe("ATOM 1 N ...");
      expect(mockApiClient.getPdb).toHaveBeenCalledWith("P00439", 408, signal);
      expect(addTraceSpan).toHaveBeenCalledWith(expect.objectContaining({ status: "success" }));
    });

    it("handles failure gracefully and returns null", async () => {
      const mockApiClient = {
        getPdb: vi.fn().mockRejectedValue(new Error("Network timeout"))
      };
      const addTraceSpan = vi.fn();
      const signal = new AbortController().signal;

      const result = await fetchPdbCoordinates(
        "PAH",
        "p.Arg408Trp",
        "P00439",
        408,
        mockApiClient,
        signal,
        {
          activeTraceId: "trace-456",
          traceStart: performance.now(),
          addTraceSpan
        }
      );

      expect(result).toBeNull();
      expect(addTraceSpan).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
    });
  });

  describe("fetchHomologStructures", () => {
    it("fetches homolog list and updates sinks", async () => {
      const mockApiClient = {
        getHomologs: vi.fn().mockResolvedValue([{ pdbId: "1PAH", resolution: 2.0 }])
      };
      const setHomologs = vi.fn();
      const setIsHomologsLoading = vi.fn();
      const addTraceSpan = vi.fn();

      await fetchHomologStructures(
        "P00439",
        mockApiClient,
        { setHomologs, setIsHomologsLoading },
        new AbortController().signal,
        { activeTraceId: "t1", traceStart: performance.now(), addTraceSpan }
      );

      expect(setIsHomologsLoading).toHaveBeenCalledWith(true);
      expect(setHomologs).toHaveBeenCalledWith([{ pdbId: "1PAH", resolution: 2.0 }]);
      expect(setIsHomologsLoading).toHaveBeenCalledWith(false);
    });

    it("fetches homolog list with pos parameter and updates sinks", async () => {
      const mockApiClient = {
        getHomologs: vi.fn().mockResolvedValue([{ pdbId: "5V3M", identity: 45.2 }])
      };
      const setHomologs = vi.fn();
      const setIsHomologsLoading = vi.fn();
      const addTraceSpan = vi.fn();
      const controller = new AbortController();

      await fetchHomologStructures(
        "Q9H116",
        mockApiClient,
        { setHomologs, setIsHomologsLoading },
        591,
        controller.signal,
        { activeTraceId: "t2", traceStart: performance.now(), addTraceSpan }
      );

      expect(mockApiClient.getHomologs).toHaveBeenCalledWith("Q9H116", 591, controller.signal);
      expect(setHomologs).toHaveBeenCalledWith([{ pdbId: "5V3M", identity: 45.2 }]);
      expect(setIsHomologsLoading).toHaveBeenCalledWith(false);
    });
  });

  describe("fetchBindingPocket", () => {
    it("finds binding pocket data and updates sinks", async () => {
      const mockApiClient = {
        findPocket: vi.fn().mockResolvedValue({ pockets: [{ id: "pocket-1", score: 0.95 }] })
      };
      const setIsPocketLoading = vi.fn();
      const setPocketError = vi.fn();
      const setComputedPocket = vi.fn();

      await fetchBindingPocket(
        "P00439",
        408,
        "ATOM ...",
        mockApiClient,
        { setIsPocketLoading, setPocketError, setComputedPocket },
        new AbortController().signal
      );

      expect(setIsPocketLoading).toHaveBeenCalledWith(true);
      expect(setPocketError).toHaveBeenCalledWith(null);
      expect(setComputedPocket).toHaveBeenCalledWith({ pockets: [{ id: "pocket-1", score: 0.95 }] });
      expect(setIsPocketLoading).toHaveBeenCalledWith(false);
    });
  });

  describe("fetchNearestResidues", () => {
    it("computes nearest residues and caches them", async () => {
      const mockApiClient = {
        getNearestResidues: vi.fn().mockResolvedValue({
          residues: [{ name: "GLU", index: 280, distance: 3.5, properties: [], role: "Active Site", classBadge: "active" }]
        })
      };
      let cache: any = {};
      const setComputedResiduesCache = vi.fn((updater) => {
        cache = typeof updater === "function" ? updater(cache) : updater;
      });
      const pendingSet = new Set<string>();

      await fetchNearestResidues(
        "P00439",
        "p.Arg408Trp",
        408,
        "ATOM ...",
        mockApiClient,
        cache,
        setComputedResiduesCache,
        pendingSet,
        new AbortController().signal
      );

      expect(setComputedResiduesCache).toHaveBeenCalled();
      expect(cache["P00439_408"]).toBeDefined();
      expect(cache["P00439_408"][0].name).toBe("GLU280");
      expect(cache["P00439_408"][0].distance).toBe("3.5 Å");
    });
  });

  /**
   * The scoped-structure-reference contract, from the pipeline's side.
   *
   * The orchestrator hands these helpers nothing but `pdbText`, so the association between the text
   * and the server's opaque reference has to be captured when the trusted fetch result arrives — and
   * then used, or the pocket/nearest calls go back to uploading the whole structure (or, worse,
   * letting the server re-resolve the accession into a template the reader is not looking at).
   */
  describe("structure reference propagation", () => {
    beforeEach(() => {
      clearStructureRefRegistry();
    });

    it("remembers the reference carried by the trusted fetch result", async () => {
      const mockApiClient = {
        getAlphaFoldPdbWithProvenance: vi.fn().mockResolvedValue({
          pdbText: PDB_TEXT,
          provenance: { source: "alphafold" },
          structureRef: STRUCTURE_REF
        })
      };

      const result = await fetchPdbCoordinates(
        "PAH", "p.Arg408Trp", "P00439", 408, mockApiClient, new AbortController().signal
      );

      expect((result as any).structureRef).toBe(STRUCTURE_REF);
      expect(resolveStructureRefForPdb(PDB_TEXT)).toBe(STRUCTURE_REF);
    });

    it("names the exact structure for the pocket instead of re-uploading it", async () => {
      registerStructureRefForPdb(PDB_TEXT, STRUCTURE_REF);
      const mockApiClient = { detectPocket: vi.fn().mockResolvedValue({ pockets: [] }) };

      await fetchBindingPocket(
        "P00439",
        408,
        PDB_TEXT,
        mockApiClient,
        { setIsPocketLoading: vi.fn(), setPocketError: vi.fn(), setComputedPocket: vi.fn() },
        new AbortController().signal
      );

      const params = mockApiClient.detectPocket.mock.calls[0][0];
      expect(params.structureRef).toBe(STRUCTURE_REF);
      // Retained for the one-shot fallback only; the API layer drops it when the reference is sent.
      expect(params.pdbText).toBe(PDB_TEXT);
    });

    it("measures nearest residues on the displayed structure, never by re-resolving the accession", async () => {
      registerStructureRefForPdb(PDB_TEXT, STRUCTURE_REF);
      const mockApiClient = { getNearestResidues: vi.fn().mockResolvedValue({ residues: [] }) };
      let cache: any = {};
      const setCache = vi.fn((updater: any) => {
        cache = typeof updater === "function" ? updater(cache) : updater;
      });

      await fetchNearestResidues(
        "P00439", "p.Arg408Trp", 408, PDB_TEXT, mockApiClient, cache, setCache,
        new Set<string>(), new AbortController().signal
      );

      const params = mockApiClient.getNearestResidues.mock.calls[0][0];
      expect(params.structureRef).toBe(STRUCTURE_REF);
      expect(params.pdbText).toBe(PDB_TEXT);
      // The accession is NOT what identifies the structure to measure: sending it would let the
      // server's 3-tier ladder answer with a different molecule than the one on screen.
      expect(params.pdbRef).toBeUndefined();
    });

    it("still sends a local upload's text when no reference is registered for it", async () => {
      const mockApiClient = { getNearestResidues: vi.fn().mockResolvedValue({ residues: [] }) };
      let cache: any = {};
      const setCache = vi.fn((updater: any) => {
        cache = typeof updater === "function" ? updater(cache) : updater;
      });

      await fetchNearestResidues(
        "P00439", "p.Arg408Trp", 408, PDB_TEXT, mockApiClient, cache, setCache,
        new Set<string>(), new AbortController().signal
      );

      const params = mockApiClient.getNearestResidues.mock.calls[0][0];
      expect(params.pdbText).toBe(PDB_TEXT);
      expect(params.structureRef).toBeUndefined();
      expect(params.pdbRef).toBeUndefined();
    });

    it("falls back to the accession only when no usable text is available", async () => {
      const mockApiClient = { getNearestResidues: vi.fn().mockResolvedValue({ residues: [] }) };
      let cache: any = {};
      const setCache = vi.fn((updater: any) => {
        cache = typeof updater === "function" ? updater(cache) : updater;
      });

      await fetchNearestResidues(
        "P00439", "p.Arg408Trp", 408, "", mockApiClient, cache, setCache,
        new Set<string>(), new AbortController().signal
      );

      const params = mockApiClient.getNearestResidues.mock.calls[0][0];
      expect(params.pdbRef).toBe("P00439");
      expect(params.pdbText).toBeUndefined();
    });
  });

  /**
   * The trace's `cached` flag must be a FACT the API reported, never an inference from timing.
   *
   * The span used to carry `cached: durationMs < 40`, which labelled any quick response — a warm
   * connection, a small model, a genuinely empty cache — as a cache hit, and could miss a real hit
   * on a large structure. Both readings are wrong claims in a diagnostics panel, so the flag is now
   * omitted unless the API says it served one.
   */
  describe("PDB trace span cache flag", () => {
    const successSpan = (addTraceSpan: any) =>
      addTraceSpan.mock.calls.map((c: any[]) => c[0]).find((s: any) => s.status === "success");

    it("does not call a fast response a cache hit", async () => {
      const addTraceSpan = vi.fn();
      // Resolves immediately: this is exactly the response the old `< 40 ms` heuristic mislabelled.
      const mockApiClient = { getPdb: vi.fn().mockResolvedValue("ATOM 1 N ...") };

      await fetchPdbCoordinates(
        "PAH", "p.Arg408Trp", "P00439", 408, mockApiClient, new AbortController().signal,
        { activeTraceId: "trace-cache-1", traceStart: performance.now(), addTraceSpan }
      );

      expect(successSpan(addTraceSpan)?.cached).toBeUndefined();
    });

    it("records a cache hit when the API reports one", async () => {
      const addTraceSpan = vi.fn();
      const mockApiClient = {
        getPdbWithProvenance: vi.fn().mockResolvedValue({
          pdbText: "ATOM 1 N ...",
          provenance: { source: "alphafold" },
          cached: true
        })
      };

      await fetchPdbCoordinates(
        "PAH", "p.Arg408Trp", "P00440", 408, mockApiClient, new AbortController().signal,
        { activeTraceId: "trace-cache-2", traceStart: performance.now(), addTraceSpan }
      );

      expect(successSpan(addTraceSpan)?.cached).toBe(true);
    });
  });
});
