import { describe, it, expect, vi } from "vitest";
import { fetchPdbCoordinates, fetchHomologStructures, fetchBindingPocket, fetchNearestResidues } from "../structureService";

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
});
