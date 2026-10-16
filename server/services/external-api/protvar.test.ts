import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../infra/http-client.ts", () => ({ fetchWithRetry: vi.fn() }));

import { fetchWithRetry } from "../infra/http-client.ts";
import { clearAllCaches } from "../infra/cache.ts";
import { fetchProtVarFoldx, protvarErrorFields, protvarJobFields } from "./protvar.ts";

const json = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as any;

/** Shape taken from the live endpoint (BRAF P15056/600 and TTN Q8WZ42/20000). */
const row = (over: Record<string, unknown> = {}) => ({
  proteinAcc: "P15056",
  position: 600,
  afId: "F1",
  afPos: 600,
  wildType: "V",
  mutatedType: "E",
  foldxDdg: 2.09408,
  plddt: 49.51,
  numFragments: 1,
  ...over,
});

describe("fetchProtVarFoldx", () => {
  beforeEach(() => {
    clearAllCaches();
    vi.mocked(fetchWithRetry).mockReset();
  });
  afterEach(() => vi.mocked(fetchWithRetry).mockReset());

  it("returns the FoldX ΔΔG with the model and the pLDDT it ran at", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(json([row({ mutatedType: "K", foldxDdg: 0.27 }), row()]));
    expect(await fetchProtVarFoldx("P15056", 600, "V", "E")).toEqual({
      status: "found",
      ddg: 2.09408,
      plddt: 49.51,
      model: "AF-P15056-F1",
    });
    expect(String(vi.mocked(fetchWithRetry).mock.calls[0][0])).toBe(
      "https://www.ebi.ac.uk/ProtVar/api/prediction/foldx/P15056/600"
    );
  });

  it("refuses to pick between AlphaFold fragment models that disagree", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(
      json([
        row({ proteinAcc: "Q8WZ42", position: 20000, afId: "F100", wildType: "G", mutatedType: "A", foldxDdg: 3.21913 }),
        row({ proteinAcc: "Q8WZ42", position: 20000, afId: "F94", wildType: "G", mutatedType: "A", foldxDdg: 2.10623 }),
      ])
    );
    const outcome = await fetchProtVarFoldx("Q8WZ42", 20000, "G", "A");
    expect(outcome.status).toBe("absent");
    expect(outcome.status === "absent" && outcome.reason).toMatch(/fragment models disagree.*F100 \+3\.22.*F94 \+2\.11/);
  });

  it("reports fragments that agree as one value", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(
      json([row({ afId: "F1", foldxDdg: 1.5 }), row({ afId: "F2", foldxDdg: 1.52 })])
    );
    expect(await fetchProtVarFoldx("P15056", 600, "V", "E")).toMatchObject({ status: "found", ddg: 1.5 });
  });

  it("gives no value when ProtVar's residue is a different wild type", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(json([row({ wildType: "A" })]));
    const outcome = await fetchProtVarFoldx("P15056", 600, "V", "E");
    expect(outcome).toEqual({ status: "absent", reason: "ProtVar's residue 600 is A, not V" });
  });

  it("treats 404 as an answer and anything else as an outage", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(json({}, 404));
    expect((await fetchProtVarFoldx("P00000", 5, "A", "G")).status).toBe("absent");
    vi.mocked(fetchWithRetry).mockResolvedValue(json({}, 503));
    await expect(fetchProtVarFoldx("P00001", 5, "A", "G")).rejects.toThrow("HTTP 503");
  });

  it("reads the canonical accession of an isoform id, and caches the answer", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(json([row()]));
    await fetchProtVarFoldx("p15056-1", 600, "v", "e");
    await fetchProtVarFoldx("P15056", 600, "V", "E");
    expect(fetchWithRetry).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetchWithRetry).mock.calls[0][0])).toContain("/foldx/P15056/600");
  });

  it("maps outcomes onto the run's job fields", () => {
    expect(protvarJobFields({ status: "found", ddg: 2.1, plddt: 49.5, model: "AF-P15056-F1" })).toEqual({
      protvarStatus: "done", protvarVal: 2.1, protvarPlddt: 49.5, protvarModel: "AF-P15056-F1", protvarReason: null, protvarError: null,
    });
    expect(protvarJobFields({ status: "absent", reason: "none" })).toMatchObject({ protvarStatus: "done", protvarVal: null, protvarReason: "none" });
    expect(protvarErrorFields(new Error("down"))).toMatchObject({ protvarStatus: "error", protvarError: "down" });
  });
});
