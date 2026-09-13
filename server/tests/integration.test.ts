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

    // 1c. Test /translate-variant with nonsense genomic coordinate (Chr20:g.23365248G>T)
    const fetchSpyNonsense = vi.spyOn(global, "fetch");
    fetchSpyNonsense.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          seq_region_name: "20",
          start: 23365248,
          allele_string: "G/T",
          transcript_consequences: [
            {
              transcript_id: "ENST00000338121",
              canonical: 1,
              mane_select: "NM_022482.5",
              hgvsp: "ENSP00000338290.5:p.Glu289Ter",
              gene_symbol: "GZF1",
              consequence_terms: ["stop_gained"],
              swissprot: ["Q9H116.200"]
            }
          ]
        }
      ]
    } as any);

    let translateNonsenseJson: any = null;
    let translateNonsenseStatus: number = 200;
    const translateNonsenseReq: any = { body: { variant: "Chr20:g.23365248G>T" }, headers: {} };
    const translateNonsenseRes: any = {
      status(code: number) { translateNonsenseStatus = code; return this; },
      json(body: any) { translateNonsenseJson = body; return this; }
    };
    await translateHandler(translateNonsenseReq, translateNonsenseRes, () => {});

    expect(translateNonsenseStatus).toBe(422);
    expect(translateNonsenseJson.error.code).toBe("NON_MISSENSE_VARIANT");
    expect(translateNonsenseJson.error.message).toContain("Nonsense / stop-gain variant detected");
    expect(translateNonsenseJson.error.details.gene).toBe("GZF1");
    fetchSpyNonsense.mockRestore();

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

    it("should enforce authorization on /debug/clear-caches when APP_API_TOKEN is configured", async () => {
      const { authCheck } = await import("../middleware.ts");
      const originalToken = process.env.APP_API_TOKEN;
      process.env.APP_API_TOKEN = "test-secret-token";

      try {
        let nextCalled = false;
        let statusCode: number | null = null;
        const unauthReq: any = { path: "/debug/clear-caches", headers: {} };
        const unauthRes: any = {
          status(code: number) { statusCode = code; return this; },
          json() { return this; }
        };

        authCheck(unauthReq, unauthRes, () => {
          nextCalled = true;
        });

        // Unauthenticated request must be blocked
        expect(nextCalled).toBe(false);
        expect(statusCode).toBe(401);

        // Authenticated request with Bearer token must pass
        nextCalled = false;
        const authReq: any = { path: "/debug/clear-caches", headers: { authorization: "Bearer test-secret-token" } };
        authCheck(authReq, unauthRes, () => {
          nextCalled = true;
        });
        expect(nextCalled).toBe(true);

        const route = apiRouter.stack.find(s => s.route && s.route.path === "/debug/clear-caches");
        expect(route).toBeDefined();
        if (!route || !route.route) throw new Error("Route /debug/clear-caches not found");
        const handler = route.route.stack[0].handle;

        let purgeJson: any = null;
        const purgeRes: any = {
          json(body: any) { purgeJson = body; return this; },
          status(code: number) { this.statusCode = code; return this; }
        };

        await handler(authReq, purgeRes, () => {});
        expect(purgeJson.status).toBe("success");
      } finally {
        process.env.APP_API_TOKEN = originalToken;
      }
    });
  });
});
