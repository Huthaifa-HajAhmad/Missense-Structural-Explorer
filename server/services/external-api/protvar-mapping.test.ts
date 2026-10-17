import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../infra/http-client.ts", () => ({ fetchWithRetry: vi.fn() }));

import { fetchWithRetry } from "../infra/http-client.ts";
import { fetchProtVarCoordinateMapping } from "./protvar.ts";

const json = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as any;

/** Shape taken from the live endpoint (GET /ProtVar/api/mapping?q=17-7675088-C-T, TP53 R175H). */
const mapping = (genes: Array<{ geneName: string; isoforms: Array<Record<string, unknown>> }>) => ({
  content: {
    inputs: [
      { inputStr: "17-7675088-C-T", type: "GENOMIC", derivedGenomicVariants: [{ chromosome: "17", position: 7675088, genes }] },
    ],
  },
});
const canonical = { accession: "P04637", canonical: true, isoformPosition: 175, refAA: "Arg", variantAA: "His", consequences: "missense" };

describe("fetchProtVarCoordinateMapping", () => {
  beforeEach(() => vi.mocked(fetchWithRetry).mockReset());

  it("reads the canonical isoform's missense change and ignores other isoforms", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValueOnce(
      json(mapping([{ geneName: "TP53", isoforms: [canonical, { ...canonical, accession: "P04637-2", canonical: false, isoformPosition: 136 }] }]))
    );
    expect(await fetchProtVarCoordinateMapping("chr17", 7675088, "c", "t")).toEqual({
      status: "found", gene: "TP53", accession: "P04637", position: 175, wt: "R", mut: "H",
    });
    expect(vi.mocked(fetchWithRetry).mock.calls[0][0]).toContain("q=17-7675088-C-T&assembly=GRCh38");
  });

  it("treats a change that is synonymous on the canonical protein as absent, not as an answer", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValueOnce(json(mapping([{ geneName: "UGT2B7", isoforms: [{ ...canonical, variantAA: "Arg" }] }])));
    expect(await fetchProtVarCoordinateMapping("4", 69098595, "A", "C")).toMatchObject({ status: "absent" });
  });

  it("chooses no gene when two genes read the coordinate", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValueOnce(
      json(mapping([
        { geneName: "OVA", isoforms: [{ ...canonical, accession: "Q00001", isoformPosition: 5 }] },
        { geneName: "OVB", isoforms: [{ ...canonical, accession: "Q00002", isoformPosition: 7 }] },
      ]))
    );
    expect(await fetchProtVarCoordinateMapping("5", 20, "A", "G")).toMatchObject({
      status: "absent",
      reason: expect.stringContaining("more than one gene"),
    });
  });

  it("throws on an HTTP failure, since an outage is not a fact about the variant", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValueOnce(json({}, 503));
    await expect(fetchProtVarCoordinateMapping("17", 7675088, "C", "T")).rejects.toThrow("503");
  });
});
