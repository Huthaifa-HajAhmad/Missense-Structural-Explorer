import { describe, it, expect, vi, beforeEach } from "vitest";
import { adapterRegistry, initStandardAdapters, ClinVarAdapter, DbnsfpAdapter, GenosAdapter, UniProtAdapter, SidecarAdapter } from "./service-adapters.ts";

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
  });

  it("should generate version-tagged cache keys", () => {
    const clinvar = adapterRegistry.get<{ gene: string; variant: string }, any>("clinvar");
    expect(clinvar).toBeDefined();
    const key = clinvar!.cacheKey({ gene: "TP53", variant: "p.R273H" });
    expect(key).toContain("clinvar_v");
    expect(key).toContain("TP53");
    expect(key).toContain("P.R273H");
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
      return new Response("{}", { status: 200 });
    }));

    const health = await adapterRegistry.checkAllHealth();
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
  });
});
