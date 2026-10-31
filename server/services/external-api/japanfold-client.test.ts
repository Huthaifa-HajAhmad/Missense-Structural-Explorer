import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  queryEsmc,
  queryEsmfold2,
  querySaProt,
  queryBoltz2Multimer,
  runBoltz2Multimer,
  resolveResultsUrl,
  clearBoltzJobs,
  clearJapanFoldCache
} from "./japanfold-client.ts";

describe("JapanFold API Client", () => {
  beforeEach(() => {
    clearJapanFoldCache();
    clearBoltzJobs();
    vi.restoreAllMocks();
  });

  describe("fields the service did not return", () => {
    it.each([
      ["ESMC", () => queryEsmc("MSLSK", 3, "L", "P")],
      ["SaProt", () => querySaProt("MSLSK", 3, "L", "P", null)]
    ])("%s keeps them absent instead of reporting 0", async (_name, call) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: "success", llr: -1.5 })
      } as any);
      const result = await call();
      expect(result).toMatchObject({ llr: -1.5 });
      for (const field of ["wtProbability", "mutProbability", "positionalEntropy", "embeddingShift"] as const) {
        expect(result![field]).toBeUndefined();
      }
    });
  });

  describe("queryEsmc", () => {
    it("returns parsed zero-shot metrics on successful API response", async () => {
      const mockResponse = {
        status: "success",
        llr: -2.345,
        wtProbability: 0.12,
        mutProbability: 0.015,
        mutRank: 6,
        positionalEntropy: 2.1,
        embeddingShift: 0.45,
        preferences: [{ aa: "R", prob: 0.12 }, { aa: "H", prob: 0.015 }],
        localShiftMap: [{ position: 408, residue: "R", shift: 0.45 }]
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse
      } as any);

      const result = await queryEsmc("MSLSK", 3, "L", "P");
      expect(result).not.toBeNull();
      expect(result?.llr).toBe(-2.345);
      expect(result?.provenance).toBe("JapanFold ESMC (Tier 1)");
      expect(result?.wtProbability).toBe(0.12);
      expect(result?.embeddingShift).toBe(0.45);
    });

    it("caches identical queries without repeating HTTP requests", async () => {
      const mockResponse = { status: "success", llr: -1.2, wtProbability: 0.2, mutProbability: 0.05 };
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse
      } as any);

      const res1 = await queryEsmc("MSLSK", 3, "L", "P");
      const res2 = await queryEsmc("MSLSK", 3, "L", "P");

      expect(res1?.llr).toBe(-1.2);
      expect(res2?.llr).toBe(-1.2);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("returns null on network failure without throwing unhandled exceptions", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Connection refused"));

      const result = await queryEsmc("MSLSK", 3, "L", "P");
      expect(result).toBeNull();
    });

    it("remembers HTTP 401/402 refusals across ESMC and SaProt instead of repeating doomed calls", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized"
      } as any);

      expect(await queryEsmc("MSLSK", 3, "L", "P")).toBeNull();
      expect(await querySaProt("MSLSK", 3, "L", "P", "ATOM...")).toBeNull();
      expect(await queryEsmc("MSLSK", 4, "S", "A")).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("queryEsmfold2", () => {
    it("returns PDB coordinate string on successful 3D folding", async () => {
      const mockPdb = "ATOM      1  N   MET A   1       0.000   0.000   0.000  1.00 90.00           N\nTER";
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: "success", pdb: mockPdb })
      } as any);

      const pdb = await queryEsmfold2("MSLSK");
      expect(pdb).toBe(mockPdb);
    });

    it("returns null when folding request fails or returns non-200", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Service Unavailable"
      } as any);

      const pdb = await queryEsmfold2("MSLSK");
      expect(pdb).toBeNull();
    });
  });

  describe("querySaProt", () => {
    it("returns structure-aware evaluation metrics", async () => {
      const mockResponse = {
        status: "success",
        llr: -3.12,
        wtProbability: 0.18,
        mutProbability: 0.008,
        conformationState: "A",
        klDivergence: 0.85
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse
      } as any);

      const result = await querySaProt("MSLSK", 3, "L", "P", "ATOM...");
      expect(result).not.toBeNull();
      expect(result?.llr).toBe(-3.12);
      expect(result?.conformationState).toBe("A");
      expect(result?.provenance).toBe("JapanFold SaProt (Tier 1)");
    });
  });

  describe("queryBoltz2Multimer", () => {
    it("returns multi-chain assembly PDB and ipTM scores", async () => {
      const mockResponse = {
        status: "success",
        complexPdb: "ATOM... Chain A... ATOM... Chain B...",
        ipTm: 0.84,
        pTm: 0.91,
        interfaceContacts: [{ resA: 408, resB: 315, distance: 2.8 }]
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse
      } as any);

      const result = await queryBoltz2Multimer([
        { chainId: "A", sequence: "MSLSK" },
        { chainId: "B", sequence: "MSLSK" }
      ]);

      expect(result).not.toBeNull();
      expect(result?.ipTm).toBe(0.84);
      expect(result?.interfaceContacts.length).toBe(1);
      expect(result?.provenance).toBe("Boltz-2 via JapanFold");
    });

    it("returns null for ipTm and pTm when upstream does not provide them", async () => {
      const mockResponse = {
        status: "success",
        complexPdb: "ATOM... Chain A... ATOM... Chain B...",
        interfaceContacts: []
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse
      } as any);

      const result = await queryBoltz2Multimer([
        { chainId: "A", sequence: "MSLSK" },
        { chainId: "B", sequence: "MSLSK" }
      ]);

      expect(result).not.toBeNull();
      expect(result?.ipTm).toBeNull();
      expect(result?.pTm).toBeNull();
    });
  });

  describe("runBoltz2Multimer", () => {
    const CHAINS = [
      { chainId: "A", sequence: "MSLSK" },
      { chainId: "B", sequence: "MSLSK" },
    ];
    const reply = (body: unknown, status = 200) =>
      ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }) as any;

    it("submits ONCE when two requests for the same complex arrive together", async () => {
      // The job is only recorded after the service answers; without a shared in-flight submission both
      // callers found no job and both submitted.
      let submits = 0;
      let release: () => void = () => {};
      const gate = new Promise<void>(r => (release = r));
      vi.spyOn(globalThis, "fetch").mockImplementation(async (u: any) => {
        const s = String(u);
        if (s.includes("/v1/predictions")) {
          submits++;
          await gate;
          return reply({ id: "job-1" }, 202);
        }
        return reply({ status: "running" });
      });
      const a = runBoltz2Multimer(CHAINS, undefined, { waitMs: 40, pollMs: 10 });
      const b = runBoltz2Multimer(CHAINS, undefined, { waitMs: 40, pollMs: 10 });
      release();
      const [ra, rb] = await Promise.all([a, b]);
      expect(submits).toBe(1);
      expect(ra).toMatchObject({ status: "running", jobId: "job-1" });
      expect(rb).toMatchObject({ status: "running", jobId: "job-1" });
    });

    it("lets one caller leave without cancelling the submission another is waiting on", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async (u: any) =>
        String(u).includes("/v1/predictions") ? reply({ id: "job-2" }, 202) : reply({ status: "running" })
      );
      const leaver = new AbortController();
      const a = runBoltz2Multimer(CHAINS, leaver.signal, { waitMs: 40, pollMs: 10 });
      const b = runBoltz2Multimer(CHAINS, undefined, { waitMs: 40, pollMs: 10 });
      leaver.abort();
      await expect(a).rejects.toMatchObject({ name: "AbortError" });
      await expect(b).resolves.toMatchObject({ status: "running", jobId: "job-2" });
    });

    it("never sends our credentials to a results URL on another host", async () => {
      const calls: string[] = [];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (u: any) => {
        calls.push(String(u));
        return String(u).includes("/v1/predictions") ? reply({ id: "job-3", links: { results: "https://evil.example/steal" } }, 202) : reply({});
      });
      const out = await runBoltz2Multimer(CHAINS, undefined, { waitMs: 40, pollMs: 10 });
      expect(out).toMatchObject({ status: "failed", failure: { kind: "no-model" } });
      expect(calls.some(u => u.includes("evil.example"))).toBe(false);
      // Nothing is kept for a later call to follow either.
      expect(calls.filter(u => u.includes("/v1/predictions"))).toHaveLength(1);
    });
  });

  describe("resolveResultsUrl", () => {
    const BASE = "https://api.japanfold.example";
    it("follows a path, or an absolute URL on the configured origin", () => {
      expect(resolveResultsUrl("/v1/jobs/1/results", BASE)).toBe("https://api.japanfold.example/v1/jobs/1/results");
      expect(resolveResultsUrl("https://api.japanfold.example/v1/jobs/1/results", BASE)).toBe("https://api.japanfold.example/v1/jobs/1/results");
    });
    it("refuses another host, another scheme or port, and a protocol-relative URL", () => {
      expect(resolveResultsUrl("https://evil.example/x", BASE)).toBeNull();
      expect(resolveResultsUrl("http://api.japanfold.example/x", BASE)).toBeNull();
      expect(resolveResultsUrl("https://api.japanfold.example:8443/x", BASE)).toBeNull();
      expect(resolveResultsUrl("//evil.example/x", BASE)).toBeNull();
      expect(resolveResultsUrl("https://api.japanfold.example.evil.example/x", BASE)).toBeNull();
    });
  });
});
