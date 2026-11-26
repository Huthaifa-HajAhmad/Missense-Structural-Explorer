import { describe, it, expect, vi, beforeEach } from "vitest";
import { NO_DBNSFP_SCORES, scoresFromLocalRecord } from "./dbnsfp-scores.ts";

const mocks = vi.hoisted(() => ({
  localAvailable: vi.fn(),
  local: vi.fn(),
  org: vi.fn(),
  myVariant: vi.fn(),
}));
vi.mock("../dbnsfp_local.ts", () => ({
  isLocalDbnsfpAvailable: mocks.localAvailable,
  queryLocalDbnsfpVariant: mocks.local,
  readLocalDbnsfpVersion: () => "dbNSFP 5.4a",
}));
vi.mock("./dbnsfp-query.ts", () => ({ queryDbnsfpOrg: mocks.org }));
vi.mock("./myvariant-dbnsfp.ts", () => ({ queryMyVariantDbnsfp: mocks.myVariant }));

import { firstDbnsfpAnswer } from "./dbnsfp-sources.ts";

const req = { gene: "TP53", variant: "p.Arg273His", resolvedPos: 273, grch38AlleleId: "17-7673802-C-T" };
const orgRow = { ...NO_DBNSFP_SCORES, revel: 0.7, gerp: 4 };
const myVariantRow = { ...NO_DBNSFP_SCORES, revel: 0.6 };

describe("firstDbnsfpAnswer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.localAvailable.mockReturnValue(true);
    mocks.local.mockResolvedValue(null);
    mocks.org.mockResolvedValue(null);
    mocks.myVariant.mockResolvedValue(null);
  });

  it("answers from the local store and asks no remote source", async () => {
    mocks.local.mockResolvedValue({ revel: 0.9, gerp: 5, aou_ac: 2, aou_an: 1000, aou_het: 2, aou_hom: 0 });
    const answer = await firstDbnsfpAnswer(req);
    expect(answer?.source).toBe("local dbNSFP");
    expect(answer?.revelProvenance).toBe("dbNSFP 5.4a");
    expect(answer?.scores.aouFrequency).toEqual({ aouAC: 2, aouAN: 1000, aouHet: 2, aouHom: 0 });
    expect(mocks.org).not.toHaveBeenCalled();
    expect(mocks.myVariant).not.toHaveBeenCalled();
  });

  it("passes the GRCh38 allele to the local store", async () => {
    await firstDbnsfpAnswer(req);
    expect(mocks.local).toHaveBeenCalledWith("TP53", 273, null, null, "p.Arg273His",
      { chrom: "17", pos: 7673802, ref: "C", alt: "T", assembly: "GRCh38" });
  });

  it("skips the local store when it is absent, and asks query.dbnsfp.org by allele", async () => {
    mocks.localAvailable.mockReturnValue(false);
    mocks.org.mockResolvedValue(orgRow);
    const answer = await firstDbnsfpAnswer(req);
    expect(mocks.local).not.toHaveBeenCalled();
    expect(mocks.org).toHaveBeenCalledWith("TP53", "p.Arg273His", "17-7673802-C-T");
    expect(answer?.source).toBe("Public dbNSFP (dbnsfp.org)");
    expect(mocks.myVariant).not.toHaveBeenCalled();
  });

  it("falls through when the local store throws", async () => {
    mocks.local.mockRejectedValue(new Error("database is locked"));
    mocks.org.mockResolvedValue(orgRow);
    expect((await firstDbnsfpAnswer(req))?.source).toBe("Public dbNSFP (dbnsfp.org)");
  });

  it("falls through to MyVariant when query.dbnsfp.org has only a secondary score", async () => {
    mocks.org.mockResolvedValue({ ...NO_DBNSFP_SCORES, esm1b: -7 });
    mocks.myVariant.mockResolvedValue(myVariantRow);
    const answer = await firstDbnsfpAnswer(req);
    expect(answer?.source).toBe("myvariant.info");
    expect(answer?.scores.revel).toBe(0.6);
    expect(mocks.myVariant).toHaveBeenCalledWith("TP53", "p.Arg273His", 273);
  });

  it("is null when no source has the variant", async () => {
    expect(await firstDbnsfpAnswer(req)).toBeNull();
  });
});

describe("popEVE from the local store", () => {
  const record = (popeve: number | null) => ({ popeve, transcript: "ENST00000646891" }) as any;

  it("names the transcript the stored score was read on, and no source without a score", () => {
    expect(scoresFromLocalRecord(record(-4.382)).popeveSource)
      .toEqual({ protein: null, substitution: null, match: "dbnsfp", transcript: "ENST00000646891" });
    expect(scoresFromLocalRecord(record(null)).popeveSource).toBeNull();
  });
});
