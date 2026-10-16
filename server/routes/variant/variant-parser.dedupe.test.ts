import { describe, it, expect, vi, afterEach } from "vitest";

import * as externalServices from "../../services/external.ts";
import { getVerifiedSequenceAndNumbering } from "./variant-parser.ts";

/**
 * One query fires `/stream`, `/landscape` and `/structural` together. They must share ONE
 * sequence + numbering verification while it is in flight — and must NOT share it afterwards,
 * because the entry is a request-time dedupe, not a cache (the providers have their own).
 */
describe("getVerifiedSequenceAndNumbering", () => {
  afterEach(() => vi.restoreAllMocks());

  // Position 99 is out of bounds for the 6-residue sequence, so no numbering lookup is started:
  // the test isolates the sharing behaviour from the network.
  const params = { gene: "TEST1", uniprotId: "P00001", variant: "p.A99V", pos: 99, wt1Letter: "A" };

  it("shares one in-flight verification between identical concurrent requests", async () => {
    let release!: (seq: string) => void;
    const spy = vi
      .spyOn(externalServices, "fetchUniprotSequence")
      .mockImplementation(() => new Promise<string>((resolve) => (release = resolve)));

    const first = getVerifiedSequenceAndNumbering(params);
    const second = getVerifiedSequenceAndNumbering({ ...params, gene: "test1", uniprotId: "p00001" });
    release("MAPTVR");

    expect(await first).toEqual({ sequence: "MAPTVR" });
    expect(await second).toBe(await first);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does not keep a settled verification, so the next request re-reads the sequence", async () => {
    const spy = vi.spyOn(externalServices, "fetchUniprotSequence").mockResolvedValue("MAPTVR");
    await getVerifiedSequenceAndNumbering(params);
    await getVerifiedSequenceAndNumbering(params);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("does not keep a failure either", async () => {
    const spy = vi
      .spyOn(externalServices, "fetchUniprotSequence")
      .mockRejectedValueOnce(new Error("UniProt down"))
      .mockResolvedValueOnce("MAPTVR");
    await expect(getVerifiedSequenceAndNumbering(params)).rejects.toThrow("UniProt down");
    await expect(getVerifiedSequenceAndNumbering(params)).resolves.toEqual({ sequence: "MAPTVR" });
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
