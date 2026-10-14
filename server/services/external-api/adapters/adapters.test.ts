import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  adapterRegistry,
  initStandardAdapters,
  ClinVarAdapter,
  DbnsfpAdapter,
  GenosAdapter,
  UniProtAdapter,
  SidecarAdapter,
  EnsemblAdapter,
  EuropePmcAdapter,
  MyVariantAdapter,
  AlphaGenomeAdapter
} from "./service-adapters.ts";

describe("External Service Adapters & Registry Tests", () => {
  beforeEach(() => {
    initStandardAdapters();
  });

  it("should have all standard adapters registered in the registry", () => {
    const all = adapterRegistry.getAll();
    const ids = all.map(a => a.id);

    expect(ids).toContain("clinvar");
    expect(ids).toContain("dbnsfp");
    expect(ids).toContain("genos");
    expect(ids).toContain("uniprot");
    expect(ids).toContain("sidecar");
    expect(ids).toContain("ensembl");
    expect(ids).toContain("europepmc");
    expect(ids).toContain("myvariant");
    expect(ids).toContain("alphagenome");
  });

  it("should generate version-tagged cache keys", () => {
    const clinvar = adapterRegistry.get<{ gene: string; variant: string }, any>("clinvar");
    expect(clinvar).toBeDefined();
    const key = clinvar!.cacheKey({ gene: "TP53", variant: "p.R273H" });
    expect(key).toContain("clinvar_v");
    expect(key).toContain("TP53");
    expect(key).toContain("P.R273H");
  });

  it("should generate proper cache keys for ensembl, europepmc, myvariant, and alphagenome", () => {
    const ensembl = adapterRegistry.get<{ gene: string; variant: string }, any>("ensembl");
    expect(ensembl!.cacheKey({ gene: "BRCA1", variant: "p.C61G" })).toContain("ensembl_BRCA1_p.C61G");

    const europepmc = adapterRegistry.get<{ gene: string; query?: string }, any>("europepmc");
    expect(europepmc!.cacheKey({ gene: "TP53", query: "cancer" })).toContain("europepmc_TP53_cancer");

    const myvariant = adapterRegistry.get<{ gene: string; variant: string }, any>("myvariant");
    expect(myvariant!.cacheKey({ gene: "BRAF", variant: "p.V600E" })).toContain("myvariant_BRAF_p.V600E");

    const alphagenome = adapterRegistry.get<{ chrom: string; pos: number; ref: string; alt: string }, any>("alphagenome");
    expect(alphagenome!.cacheKey({ chrom: "chr7", pos: 140753336, ref: "A", alt: "T" })).toBe("alphagenome_chr7_140753336_A_T");
  });

  it("should execute checkAllHealth() and return status for all registered services", async () => {
    // Mock global fetch for health probes
    vi.stubGlobal("fetch", vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes("einfo.fcgi")) {
        return new Response("{}", { status: 200 });
      }
      if (u.includes("genos.app")) {
        return new Response("{}", { status: 200 });
      }
      if (u.includes("uniprotkb")) {
        return new Response("{}", { status: 200 });
      }
      if (u.includes("127.0.0.1:8000/health")) {
        return new Response(JSON.stringify({ status: "healthy" }), { status: 200 });
      }
      if (u.includes("rest.ensembl.org/info/ping")) {
        return new Response(JSON.stringify({ ping: 1 }), { status: 200 });
      }
      if (u.includes("europepmc/webservices/rest/search")) {
        return new Response(JSON.stringify({ hitCount: 1 }), { status: 200 });
      }
      if (u.includes("myvariant.info/v1/metadata")) {
        return new Response(JSON.stringify({ app_version: "v1" }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }));

    const health = await adapterRegistry.checkAllHealth(undefined, true);
    expect(health).toBeDefined();
    expect(health.clinvar).toBeDefined();
    expect(health.clinvar.healthy).toBe(true);
    expect(health.dbnsfp).toBeDefined();
    expect(health.dbnsfp.healthy).toBe(true);
    expect(health.genos).toBeDefined();
    expect(health.genos.healthy).toBe(true);
    expect(health.uniprot).toBeDefined();
    expect(health.uniprot.healthy).toBe(true);
    expect(health.sidecar).toBeDefined();
    expect(health.sidecar.healthy).toBe(true);
    expect(health.ensembl).toBeDefined();
    expect(health.ensembl.healthy).toBe(true);
    expect(health.europepmc).toBeDefined();
    expect(health.europepmc.healthy).toBe(true);
    expect(health.myvariant).toBeDefined();
    expect(health.myvariant.healthy).toBe(true);
    expect(health.alphagenome).toBeDefined();
    // Default without key should report standby (honest telemetry, no false positive)
    expect(health.alphagenome.healthy).toBe(false);
    expect(health.alphagenome.message).toContain("Standby");
  });

  it("should report AlphaGenome healthy when ALPHAGENOME_API_KEY is configured", async () => {
    const origKey = process.env.ALPHAGENOME_API_KEY;
    process.env.ALPHAGENOME_API_KEY = "test_key_live";
    try {
      const alphagenome = adapterRegistry.get("alphagenome");
      expect(alphagenome).toBeDefined();
      const status = await alphagenome!.healthCheck();
      expect(status.healthy).toBe(true);
      expect(status.message).toContain("AlphaGenome Bridge Active");
    } finally {
      if (origKey !== undefined) {
        process.env.ALPHAGENOME_API_KEY = origKey;
      } else {
        delete process.env.ALPHAGENOME_API_KEY;
      }
    }
  });
});

/**
 * The sidecar's `/health` returns `status: "healthy"` from the moment uvicorn binds — up to ~180 s
 * before the weights it was spawned to load are usable — and reports that window only in `state`.
 * These tests pin that a bound-but-cold sidecar is NOT reported healthy, because reading `status`
 * alone is what put a green "Neural Sidecar Live" on the status rail over engines that would have
 * refused the next request.
 */
describe("SidecarAdapter health probe — cold start vs readiness", () => {
  const sidecarHealth = (over: Record<string, unknown> = {}) =>
    Promise.resolve({
      ok: true,
      json: async () => ({
        status: "healthy",
        state: "ready",
        models: {},
        model_status: {},
        ...over
      })
    }) as any;

  beforeEach(() => {
    initStandardAdapters();
    vi.unstubAllGlobals();
  });

  it("reports a ready sidecar as healthy", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sidecarHealth({ state: "ready" })));

    const status = await adapterRegistry.get("sidecar")!.healthCheck();

    expect(status.healthy).toBe(true);
    expect(status.state).toBe("ready");
    expect(status.message).toBe("ML Model Server Healthy");
  });

  it("reports a bound-but-cold sidecar as NOT healthy, and says warming", async () => {
    // `status` is "healthy" here on purpose: that is exactly what the real sidecar sends while the
    // weights are still loading, and reading it alone is the defect these tests exist to prevent.
    vi.stubGlobal("fetch", vi.fn(async () => sidecarHealth({ state: "warming_up" })));

    const status = await adapterRegistry.get("sidecar")!.healthCheck();

    expect(status.healthy).toBe(false);
    expect(status.state).toBe("warming_up");
    expect(status.message).toMatch(/model weights/i);
  });

  it.each(['unhealthy', 'failed', undefined])("does not claim ready for status %s", async status => {
    vi.stubGlobal("fetch", vi.fn(async () => sidecarHealth({ status, state: 'ready' })));
    const result = await adapterRegistry.get('sidecar')!.healthCheck();
    expect(result.healthy).toBe(false);
    expect(result.state).toBeUndefined();
    expect(result.message).not.toContain('Healthy');
  });

  it("reports an unreachable sidecar as unhealthy with no state claimed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Connection refused");
      })
    );

    const status = await adapterRegistry.get("sidecar")!.healthCheck();

    expect(status.healthy).toBe(false);
    // Absence of a probe must never be dressed up as a cold start: "offline" and "warming" call
    // for different reactions from whoever reads this.
    expect(status.state).toBeUndefined();
  });
});

