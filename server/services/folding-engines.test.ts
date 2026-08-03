import { describe, it, expect, vi } from "vitest";
import { applyMutation } from "../utils/mutation.ts";
import { verifyStability } from "./biophysics-bridge.ts";
import { ESMFoldEngine } from "./folding-engines.ts";
import { apiRouter } from "../routes.ts";

describe("ThermoMPNN and Folding Engine verifyStability Bridges", () => {
  it("should correctly mutate sequences using applyMutation utility", () => {
    const seq = "MTEYKLVVVGAGGVGKSALTIQLI";
    const mutated = applyMutation(seq, { chain: "A", position: 12, wt: "G", mt: "V" });
    expect(mutated).toBe("MTEYKLVVVGAVGVGKSALTIQLI");
    expect(mutated[11]).toBe("V");

    expect(() => applyMutation(seq, { chain: "A", position: 100, wt: "G", mt: "V" })).toThrow();
  });

  it("should verify stability and coordinate FoldingEngine structure outputs", async () => {
    const globalFetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      if (url === "https://app.tamarind.bio/api/submit-job") {
        return {
          ok: true,
          json: async () => ({ jobId: "test-thermo-job", prediction: -2.3, status: "done" })
        } as any;
      }
      if (url === "https://biohub.ai/api/v1/fold_all_atom" || url === "http://127.0.0.1:8000/predict/esmfold" || (typeof url === "string" && url.includes("esmatlas"))) {
        return {
          ok: true,
          text: async () => "ATOM      1  CA  MET A   1       0.000   0.000   0.000  1.00 90.00           C\n",
          json: async () => ({
            status: "success",
            pdb: "ATOM      1  CA  MET A   1       0.000   0.000   0.000  1.00 90.00           C\n",
            complex: {
              sequence: ["MET", "ALA"],
              atom_positions: [[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]],
              atom_elements: ["C", "C"],
              atom_names: ["CA", "CA"],
              token_to_atoms: [[0, 1], [1, 2]],
              plddt: [0.9, 0.9]
            }
          })
        } as any;
      }
      return { ok: false, status: 404 } as any;
    });

    const engine = new ESMFoldEngine();
    const res = await verifyStability(
      "MA",
      { chain: "A", position: 2, wt: "A", mt: "V" },
      engine,
      {
        wtPdb: "ATOM ...",
        uniprotId: "P12345",
        jobDir: "./temp_jobs",
        mutationCode: "AA2V",
        biohubToken: "dummy-token"
      },
      "dummy-api-key"
    );

    expect(res.ddG).toBe(-2.3);
    expect(res.thermompnnStatus).toBe("done");
    expect(res.structure.status).toBe("success");
    expect(res.structure.pdb).toContain("ATOM");

    globalFetchSpy.mockRestore();
  });

  it("should mount and respond correctly on /biophysics/verify-stability endpoint", async () => {
    const route = apiRouter.stack.find(s => s.route && s.route.path === "/biophysics/verify-stability");
    expect(route).toBeDefined();

    const mockReq = {
      body: {
        uniprotId: "P00439",
        mutation: { chain: "A", position: 2, wt: "T", mt: "V" },
        engine: "esmfold",
        wtPdb: "ATOM 1 CA ALA A 1 0.000 0.000 0.000 1.00 90.00 C",
        wtSeq: "MTEYKL"
      },
      headers: {
        "x-tamarind-api-key": "test-key",
        "x-biohub-token": "test-token"
      }
    } as any;

    let responseJson: any = null;
    let responseStatus: number = 200;
    const mockRes = {
      status: (code: number) => {
        responseStatus = code;
        return mockRes;
      },
      json: (data: any) => {
        responseJson = data;
        return mockRes;
      },
      getHeader: () => undefined
    } as any;

    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      if (url === "https://app.tamarind.bio/api/submit-job") {
        return {
          ok: true,
          json: async () => ({ jobId: "thermo-job-123", prediction: 1.25, status: "done" })
        } as any;
      }
      if (url === "https://biohub.ai/api/v1/fold_all_atom" || url === "http://127.0.0.1:8000/predict/esmfold" || (typeof url === "string" && url.includes("esmatlas"))) {
        return {
          ok: true,
          text: async () => "ATOM      1  CA  MET A   1       0.000   0.000   0.000  1.00 90.00           C\n",
          json: async () => ({
            status: "success",
            pdb: "ATOM      1  CA  MET A   1       0.000   0.000   0.000  1.00 90.00           C\n",
            complex: {
              sequence: ["MET", "VAL", "GLU", "TYR", "LYS", "LEU"],
              atom_positions: [[0,0,0],[1,1,1],[2,2,2],[3,3,3],[4,4,4],[5,5,5]],
              atom_elements: ["C","C","C","C","C","C"],
              atom_names: ["CA","CA","CA","CA","CA","CA"],
              token_to_atoms: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6]],
              plddt: [0.8,0.8,0.8,0.8,0.8,0.8]
            }
          })
        } as any;
      }
      return { ok: false, status: 404 } as any;
    });

    if (route && route.route) {
      const handler = route.route.stack[route.route.stack.length - 1].handle;
      await handler(mockReq, mockRes, () => {});
    }
    expect(responseJson).toBeDefined();
    expect(responseJson.ddG).toBe(1.25);
    expect(responseJson.structure.status).toBe("success");
    expect(responseJson.structure.pdb).toContain("ATOM");

    fetchSpy.mockRestore();
  });
});
