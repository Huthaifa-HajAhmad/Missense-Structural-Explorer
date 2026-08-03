import { describe, it, expect, vi } from "vitest";
import { apiRouter } from "../routes.ts";
import * as externalServices from "../services/external.ts";

describe("Full Pipeline Integration Test (C-7)", () => {
  it("should walk through the main endpoints of the pipeline", async () => {
    // 1. Test /translate-variant
    const translateRoute: any = apiRouter.stack.find(s => s.route && s.route.path === "/translate-variant");
    expect(translateRoute).toBeDefined();
    const translateHandler = translateRoute.route.stack[translateRoute.route.stack.length - 1].handle;
    
    const fetchSpy = vi.spyOn(global, "fetch");
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          transcript_consequences: [
            {
              transcript_id: "ENST00000256078",
              canonical: true,
              hgvsp: "ENSP00000256078:p.Arg408His",
              gene_symbol: "PAH"
            }
          ]
        }
      ]
    } as any);

    let translateJson: any = null;
    const translateReq: any = { body: { variant: "NM_000277.5:c.1222C>T" }, headers: {} };
    const translateRes: any = {
      status(code: number) { this.statusCode = code; return this; },
      json(body: any) { translateJson = body; return this; }
    };
    await translateHandler(translateReq, translateRes, () => {});
    
    expect(translateJson).toBeDefined();
    expect(translateJson.gene).toBe("PAH");
    expect(translateJson.variant).toBe("p.Arg408His");
    expect(translateJson.uniprotId).toBe("");
    fetchSpy.mockRestore();

    // 1b. Test /translate-variant with dashed genomic coordinates
    const fetchSpyDashed = vi.spyOn(global, "fetch");
    fetchSpyDashed.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          seq_region_name: "20",
          start: 23365054,
          allele_string: "G/A",
          transcript_consequences: [
            {
              transcript_id: "ENST00000325888",
              canonical: true,
              hgvsp: "ENSP00000325888:p.Gly380Arg",
              gene_symbol: "CNNM2"
            }
          ]
        }
      ]
    } as any);

    let translateDashedJson: any = null;
    const translateDashedReq: any = { body: { variant: "20-23365054-G-A" }, headers: {} };
    const translateDashedRes: any = {
      status(code: number) { this.statusCode = code; return this; },
      json(body: any) { translateDashedJson = body; return this; }
    };
    await translateHandler(translateDashedReq, translateDashedRes, () => {});

    expect(translateDashedJson).toBeDefined();
    expect(translateDashedJson.gene).toBe("CNNM2");
    expect(translateDashedJson.variant).toBe("p.Gly380Arg");
    expect(translateDashedJson.genomicCoordinates).toBe("20-23365054-G-A");
    fetchSpyDashed.mockRestore();

    // 2. Test /resolve-gene
    const resolveRoute: any = apiRouter.stack.find(s => s.route && s.route.path === "/resolve-gene");
    expect(resolveRoute).toBeDefined();
    const resolveHandler = resolveRoute.route.stack[resolveRoute.route.stack.length - 1].handle;
    
    let resolveJson: any = null;
    const resolveReq: any = { body: { gene: "PAH" }, headers: {} };
    const resolveRes: any = {
      status(code: number) { this.statusCode = code; return this; },
      json(body: any) { resolveJson = body; return this; }
    };
    const uniprotSpy = vi.spyOn(externalServices, "resolveGeneToUniprot").mockResolvedValue("P00439");
    const pdbSpy = vi.spyOn(externalServices, "fetchAlphafoldPdb").mockResolvedValue("dummy-pdb-text");
    await resolveHandler(resolveReq, resolveRes, () => {});
    expect(resolveJson).toBeDefined();
    expect(resolveJson.uniprotId).toBe("P00439");
    uniprotSpy.mockRestore();
    pdbSpy.mockRestore();
  });

  describe("Public API routes", () => {
    it("should return ok status on GET /health", async () => {
      const route = apiRouter.stack.find(s => s.route && s.route.path === "/health");
      expect(route).toBeDefined();
      if (!route || !route.route) throw new Error("Route /health not found");
      const handler = route.route.stack[0].handle;
      let jsonVal: any = null;
      const req: any = {};
      const res: any = {
        json(body: any) {
          jsonVal = body;
          return this;
        }
      };
      
      await handler(req, res, () => {});
      expect(jsonVal.status).toBe("ok");
      expect(jsonVal.timestamp).toBeDefined();
    });

    it("should return version info on GET /version", async () => {
      const route = apiRouter.stack.find(s => s.route && s.route.path === "/version");
      expect(route).toBeDefined();
      if (!route || !route.route) throw new Error("Route /version not found");
      const handler = route.route.stack[0].handle;
      let jsonVal: any = null;
      const req: any = {};
      const res: any = {
        json(body: any) {
          jsonVal = body;
          return this;
        }
      };
      
      await handler(req, res, () => {});
      expect(jsonVal.version).toBe("1.0.0");
    });
  });
});
