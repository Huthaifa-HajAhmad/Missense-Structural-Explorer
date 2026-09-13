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
