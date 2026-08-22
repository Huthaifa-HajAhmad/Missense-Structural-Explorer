import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiRouter } from "../../routes.ts";
import * as externalServices from "../../services/external.ts";
import * as orchestrator from "../../services/analysis-orchestrator.ts";

describe("Variant Analysis Route Handlers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("POST /analyze-variant", () => {
    it("should return 400 when gene or variant is missing or invalid", async () => {
      const route: any = apiRouter.stack.find(
        (layer: any) => layer.route && layer.route.path === "/analyze-variant"
      );
      expect(route).toBeDefined();
      const handler = route.route.stack[route.route.stack.length - 1].handle;

      let responseCode = 200;
      let responseBody: any = null;
      const req: any = { body: { gene: "" }, headers: {} };
      const res: any = {
        status(code: number) {
          responseCode = code;
          return this;
        },
        json(body: any) {
          responseBody = body;
          return this;
        }
      };

      await handler(req, res, () => {});
      expect(responseCode).toBe(400);
      expect(responseBody.error).toBeDefined();
    });

    it("should return 422 when wildtype amino acid mismatches sequence", async () => {
      const route: any = apiRouter.stack.find(
        (layer: any) => layer.route && layer.route.path === "/analyze-variant"
      );
      const handler = route.route.stack[route.route.stack.length - 1].handle;

      vi.spyOn(externalServices, "resolveGeneToUniprot").mockResolvedValue("P00439");
      vi.spyOn(externalServices, "fetchUniprotSequence").mockResolvedValue("MATVAL"); // Pos 1 is M, Pos 2 is A

      let responseCode = 200;
      let responseBody: any = null;
      const req: any = { body: { gene: "PAH", variant: "p.Val1Ala" }, headers: {} };
      const res: any = {
        status(code: number) {
          responseCode = code;
          return this;
        },
        json(body: any) {
          responseBody = body;
          return this;
        }
      };

      await handler(req, res, () => {});
      expect(responseCode).toBe(422);
      expect(responseBody.error.code).toBe("UNPROCESSABLE_ENTITY");
      expect(responseBody.error.message).toContain("Wild-type residue mismatch");
    });

    it("should execute core analysis and return structured payload on valid request", async () => {
      const route: any = apiRouter.stack.find(
        (layer: any) => layer.route && layer.route.path === "/analyze-variant"
      );
      const handler = route.route.stack[route.route.stack.length - 1].handle;

      vi.spyOn(externalServices, "resolveGeneToUniprot").mockResolvedValue("P00439");
      vi.spyOn(externalServices, "fetchUniprotSequence").mockResolvedValue("MAPTVR");

      const mockAnalysisResult: any = {
        analysis: null,
        insights: null,
        ruleBasedInsights: { classification: "Uncertain Significance", criteria: [] },
        disclaimer: "test disclaimer",
        clinvar: null,
        predictorData: null,
        conservationData: null,
        landscapeData: null,
        stringInteractions: null,
        disruptionPredictor: { level: "low", reason: "none" },
        gnomadConstraint: null,
        uniprotFeatures: null,
        gnomadFrequency: null,
        aouFrequency: null,
        esm2: null,
        esm3Eval: null,
        esmcEval: null,
        esm2Eval: null,
        saprotEval: null,
        metadata: {
          gene: "PAH",
          variant: "p.Met1Val",
          uniprotId: "P00439",
          residueIndex: 1,
          wildType: "Met",
          mutant: "Val",
          pdbId: null,
          pdbSource: "AlphaFold",
          alternativeVariants: [],
          mutatedSequence: "VAPTVR"
        },
        _internal: {
          pdbMapping: null
        }
      };

      vi.spyOn(orchestrator, "runCoreAnalysis").mockResolvedValue(mockAnalysisResult);

      let responseBody: any = null;
      const req: any = { body: { gene: "PAH", variant: "p.Met1Val" }, headers: {} };
      const res: any = {
        status(code: number) {
          return this;
        },
        json(body: any) {
          responseBody = body;
          return this;
        }
      };

      await handler(req, res, () => {});
      expect(responseBody).toBeDefined();
      expect(responseBody.ruleBasedInsights.classification).toBe("Uncertain Significance");
      expect(responseBody.metadata.mutatedSequence).toBe("VAPTVR");
      expect(responseBody._internal).toBeUndefined(); // _internal must be stripped
    });
  });

  describe("POST /analyze-variant/landscape", () => {
    it("should calculate window and return landscape data", async () => {
      const route: any = apiRouter.stack.find(
        (layer: any) => layer.route && layer.route.path === "/analyze-variant/landscape"
      );
      expect(route).toBeDefined();
      const handler = route.route.stack[route.route.stack.length - 1].handle;

      vi.spyOn(externalServices, "resolveGeneToUniprot").mockResolvedValue("P00439");
      vi.spyOn(externalServices, "fetchUniprotSequence").mockResolvedValue("MAPTVR".repeat(20));
      const landscapeSpy = vi.spyOn(externalServices, "fetchLandscapeData").mockResolvedValue({
        variants: []
      } as any);

      let responseBody: any = null;
      const req: any = { body: { gene: "PAH", variant: "p.Met1Val" }, headers: {} };
      const res: any = {
        status(code: number) {
          return this;
        },
        json(body: any) {
          responseBody = body;
          return this;
        }
      };

      await handler(req, res, () => {});
      expect(landscapeSpy).toHaveBeenCalledWith("PAH", 1, 26);
      expect(responseBody.landscapeData).toBeDefined();
    });
  });

  describe("POST /analyze-variant/structural", () => {
    it("should invoke structural analysis and return predictions", async () => {
      const route: any = apiRouter.stack.find(
        (layer: any) => layer.route && layer.route.path === "/analyze-variant/structural"
      );
      expect(route).toBeDefined();
      const handler = route.route.stack[route.route.stack.length - 1].handle;

      vi.spyOn(externalServices, "resolveGeneToUniprot").mockResolvedValue("P00439");
      vi.spyOn(externalServices, "fetchUniprotSequence").mockResolvedValue("MAPTVR");

      const mockStructuralResult: any = {
        esm3Eval: { score: 0.9 },
        esmcEval: null,
        esm2Eval: null,
        saprotEval: null,
        ruleBasedInsights: { classification: "Pathogenic" }
      };

      const structuralSpy = vi.spyOn(orchestrator, "runStructuralAnalysis").mockResolvedValue(mockStructuralResult);

      let responseBody: any = null;
      const req: any = {
        body: { gene: "PAH", variant: "p.Met1Val" },
        headers: { "x-biohub-token": "test-token" }
      };
      const res: any = {
        status(code: number) {
          return this;
        },
        json(body: any) {
          responseBody = body;
          return this;
        }
      };

      await handler(req, res, () => {});
      expect(structuralSpy).toHaveBeenCalled();
      expect(responseBody.esm3Eval.score).toBe(0.9);
      expect(responseBody.ruleBasedInsights.classification).toBe("Pathogenic");
    });
  });

  describe("POST /analyze-variant/stream", () => {
    it("should stream NDJSON chunks over chunked HTTP connection", async () => {
      const route: any = apiRouter.stack.find(
        (layer: any) => layer.route && layer.route.path === "/analyze-variant/stream"
      );
      expect(route).toBeDefined();
      const handler = route.route.stack[route.route.stack.length - 1].handle;

      vi.spyOn(externalServices, "resolveGeneToUniprot").mockResolvedValue("P00439");
      vi.spyOn(externalServices, "fetchUniprotSequence").mockResolvedValue("MAPTVR");

      vi.spyOn(orchestrator, "streamCoreAnalysis").mockImplementation(async (_ctx, onChunk) => {
        onChunk({ chunkIndex: 1, isFinal: false, data: { metadata: { gene: "PAH" } } });
        onChunk({ chunkIndex: 2, isFinal: true, data: { metadata: { gene: "PAH" }, ruleBasedInsights: {} } });
        return { metadata: { gene: "PAH" } };
      });

      const writtenChunks: string[] = [];
      const req: any = { body: { gene: "PAH", variant: "p.Met1Val" }, headers: {}, on: vi.fn() };
      const res: any = {
        setHeader() {},
        flushHeaders() {},
        write(chunk: string) {
          writtenChunks.push(chunk);
          return true;
        },
        end() {}
      };

      await handler(req, res, () => {});
      expect(writtenChunks.length).toBe(2);
      const parsedFirstChunk = JSON.parse(writtenChunks[0]);
      expect(parsedFirstChunk.chunkIndex).toBe(1);
      expect(parsedFirstChunk.data).toBeDefined();
    });
  });
});
