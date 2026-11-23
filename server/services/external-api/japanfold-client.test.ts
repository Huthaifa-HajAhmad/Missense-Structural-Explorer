import { describe, it, expect, vi, beforeEach } from "vitest";
import {
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

    it("sends a supplied per-call apiKey in the Authorization and X-API-Key headers", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(reply({ id: "job-key" }, 202));
      await runBoltz2Multimer(CHAINS, undefined, { waitMs: 20, pollMs: 10, apiKey: "jf_user_key_123456" });
      const init = fetchSpy.mock.calls[0]?.[1] as { headers?: Record<string, string> };
      expect(init?.headers?.["Authorization"]).toBe("Bearer jf_user_key_123456");
      expect(init?.headers?.["X-API-Key"]).toBe("jf_user_key_123456");
    });

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
