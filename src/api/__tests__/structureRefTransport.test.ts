import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createStructureApi,
  buildStructureRequestBody,
  parseStructureRefFromHeaders,
} from "../structureApi";
import {
  registerStructureRefForPdb,
  clearStructureRefRegistry,
  getStructureRefRegistrySize,
} from "../structureRefRegistry";
import { STRUCTURE_REF_HEADER } from "../../shared/structureRefs";

/**
 * Scoped structure-reference transport.
 *
 * The contract under test: once this session has received a reference for some PDB text, pocket and
 * nearest-residue calls name those bytes instead of uploading them — and if the server can no longer
 * resolve the reference, the client re-sends the exact text ONCE rather than letting the server fall
 * back to re-resolving the accession into a different structure.
 */

const REF = "sref1_0123456789abcdef0123456789abcdef";
const PDB_TEXT = "ATOM      1  CA  ASP A   1      1.000   1.000   1.000  1.00  0.00           C";

const VALID_POCKET = {
  pocketResidues: [],
  pocketScore: 0.9,
  pocketVolume: 420,
  likelyCofactor: "",
  status: "success",
};

const VALID_NEAREST = { residues: [], source: "computed" };

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const headers = new Headers({ "content-type": "application/json", ...(init.headers ?? {}) });
  return {
    ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300,
    status: init.status ?? 200,
    headers,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function textResponse(body: string, headers: Record<string, string>) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "text/plain", ...headers }),
    text: async () => body,
    json: async () => { throw new Error("not json"); },
  } as unknown as Response;
}

describe("structure reference transport", () => {
  beforeEach(() => {
    clearStructureRefRegistry();
  });

  describe("buildStructureRequestBody", () => {
    it("sends the reference instead of the text when this session has one", () => {
      registerStructureRefForPdb(PDB_TEXT, REF);
      const { body, textRetryBody } = buildStructureRequestBody({
        pdbText: PDB_TEXT,
        pdbRef: "P00439",
        targetIndex: 408,
      });

      expect(body).toEqual({ structureRef: REF, pdbRef: "P00439", targetIndex: 408 });
      expect(body).not.toHaveProperty("pdbText");
      // The text is retained ONLY as the one-shot recovery payload for a stale reference.
      expect(textRetryBody).toEqual({ pdbText: PDB_TEXT, pdbRef: "P00439", targetIndex: 408 });
      expect(textRetryBody).not.toHaveProperty("structureRef");
    });

    it("keeps uploading the text when no reference is known (local upload)", () => {
      const { body, textRetryBody } = buildStructureRequestBody({
        pdbText: PDB_TEXT,
        targetIndex: 408,
      });

      expect(body).toEqual({ pdbText: PDB_TEXT, targetIndex: 408 });
      expect(textRetryBody).toBeNull();
    });

    it("has no retry payload when there is no text to fall back to", () => {
      const { body, textRetryBody } = buildStructureRequestBody({
        structureRef: REF,
        targetIndex: 408,
      });
      expect(body).toEqual({ structureRef: REF, targetIndex: 408 });
      expect(textRetryBody).toBeNull();
    });
  });

  describe("parseStructureRefFromHeaders", () => {
    it("reads a well-formed reference and ignores anything else", () => {
      expect(parseStructureRefFromHeaders(textResponse("ATOM", { [STRUCTURE_REF_HEADER]: REF }))).toBe(REF);
      expect(parseStructureRefFromHeaders(textResponse("ATOM", { [STRUCTURE_REF_HEADER]: "not-a-ref" }))).toBeUndefined();
      expect(parseStructureRefFromHeaders(textResponse("ATOM", {}))).toBeUndefined();
    });
  });

  describe("trusted fetch results", () => {
    it("carries the reference returned by the PDB routes", async () => {
      const fetchWithAuth = vi.fn().mockResolvedValue(
        textResponse(PDB_TEXT, { "X-Template-Source": "alphafold", [STRUCTURE_REF_HEADER]: REF })
      );
      const api = createStructureApi(fetchWithAuth as any);

      const result = await api.getAlphaFoldPdbWithProvenance("P00439");
      expect(result.pdbText).toBe(PDB_TEXT);
      expect(result.provenance.source).toBe("alphafold");
      expect(result.structureRef).toBe(REF);

      const withProvenance = await api.getPdbWithProvenance("P00439", 408);
      expect(withProvenance.structureRef).toBe(REF);
    });
  });

  describe("pocket and nearest calls", () => {
    it("does not upload the text once a reference is known", async () => {
      registerStructureRefForPdb(PDB_TEXT, REF);
      const fetchWithAuth = vi.fn().mockResolvedValue(jsonResponse(VALID_NEAREST));
      const api = createStructureApi(fetchWithAuth as any);

      await api.getNearestResidues({
        pdbText: PDB_TEXT,
        pdbRef: "P00439",
        targetIndex: 1,
        distanceThreshold: 5,
      });

      const body = JSON.parse(fetchWithAuth.mock.calls[0][1].body);
      expect(body.structureRef).toBe(REF);
      expect(body.pdbText).toBeUndefined();
    });

    it("retries once with the exact text when the server reports a stale reference", async () => {
      registerStructureRefForPdb(PDB_TEXT, REF);
      const fetchWithAuth = vi.fn()
        .mockResolvedValueOnce(jsonResponse({ error: { code: "STALE_STRUCTURE_REF", message: "gone" } }, { status: 409 }))
        .mockResolvedValueOnce(jsonResponse(VALID_NEAREST));
      const api = createStructureApi(fetchWithAuth as any);

      const result = await api.getNearestResidues({
        pdbText: PDB_TEXT,
        targetIndex: 1,
        distanceThreshold: 5,
      });

      expect(result.source).toBe("computed");
      expect(fetchWithAuth).toHaveBeenCalledTimes(2);
      const firstBody = JSON.parse(fetchWithAuth.mock.calls[0][1].body);
      const retryBody = JSON.parse(fetchWithAuth.mock.calls[1][1].body);
      expect(firstBody.structureRef).toBe(REF);
      expect(retryBody.pdbText).toBe(PDB_TEXT);
      expect(retryBody.structureRef).toBeUndefined();
    });

    it("surfaces the stale-reference failure when there is no text to retry with", async () => {
      const fetchWithAuth = vi.fn().mockResolvedValue(
        jsonResponse({ error: { code: "STALE_STRUCTURE_REF", message: "gone" } }, { status: 409 })
      );
      const api = createStructureApi(fetchWithAuth as any);

      await expect(
        api.getNearestResidues({ structureRef: REF, targetIndex: 1, distanceThreshold: 5 })
      ).rejects.toThrow(/gone/);
      expect(fetchWithAuth).toHaveBeenCalledTimes(1);
    });

    it("sends the reference for pocket detection and keeps the accession for the AF fallback", async () => {
      registerStructureRefForPdb(PDB_TEXT, REF);
      const fetchWithAuth = vi.fn().mockResolvedValue(jsonResponse(VALID_POCKET));
      const api = createStructureApi(fetchWithAuth as any);

      await api.detectPocket({
        pdbText: PDB_TEXT,
        pdbRef: "P00439",
        uniprotId: "P00439",
        targetIndex: 408,
      });

      const body = JSON.parse(fetchWithAuth.mock.calls[0][1].body);
      expect(body.structureRef).toBe(REF);
      expect(body.pdbText).toBeUndefined();
      expect(body.pdbRef).toBe("P00439");
    });

    it("still uploads a local structure that has no reference", async () => {
      const fetchWithAuth = vi.fn().mockResolvedValue(jsonResponse(VALID_NEAREST));
      const api = createStructureApi(fetchWithAuth as any);

      await api.getNearestResidues({ pdbText: PDB_TEXT, targetIndex: 1, distanceThreshold: 5 });

      const body = JSON.parse(fetchWithAuth.mock.calls[0][1].body);
      expect(body.pdbText).toBe(PDB_TEXT);
      expect(body.structureRef).toBeUndefined();
      expect(getStructureRefRegistrySize()).toBe(0);
    });
  });
});
