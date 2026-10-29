import { describe, expect, it } from "vitest";
import { loadPerRegions, verifyPerRegion } from "./perRegions.ts";
import { perRegionsFromStats, perRegionsResponseSchema, type PerRegion } from "../../../src/shared/perRegions.ts";

const cols = (...cells: string[]) => cells.join("\t");
const plain = (index: number, aaa: string, bbb: string, aaPer = "PER") =>
  cols(String(index), aaa, bbb, "0.66", "", "", "N/A", "0.01", "5", "1", "9", "0.02", "-1.7", aaPer, "NA", "NA", "0", "0", "0");
const tag = (index: number, aaa: string, bbb: string, or: string, ci1: string, adjP: string, name: string, start: number, end: number) =>
  cols(String(index), aaa, bbb, "0.66", "1", "5", "N/A", "0.01", or, ci1, "9", adjP, "-1.7", "PER", "proxy-tag", name, String(start), String(end), String(end - start + 1));

// Two-member family table. BBB has alignment gaps where AAA has residues; PER2 falls where BBB is all gaps.
const FAMILY = [
  cols("Index", "AAA", "BBB", "Parazscore", "Adj_bin_count", "DM_adj_bin_count", "Gene:Disease", "fisher.p", "or", "ci1", "ci2", "adj.p", "log.adj.p", "aa.per", "proxy", "per.tag", "per.start", "per.end", "size"),
  plain(1, "M_1", "-", "Neutral"),
  plain(2, "K_2", "-"),
  plain(3, "L_3", "E_1"),
  tag(4, "A_4", "-", "12.5", "2.1", "0.01", "PER1", 2, 5),
  plain(5, "V_5", "Q_2"),
  plain(6, "G_6", "-"),
  tag(7, "S_7", "-", "Inf", "0", "0.03", "PER2", 6, 8),
  plain(8, "T_8", "-"),
].join("\n");

describe("family burden table mapping", () => {
  it("maps each member's residues in a PER window to its own protein positions, skipping gaps", () => {
    const { genes, emptyWindows } = perRegionsFromStats(FAMILY, "family");
    const family = ["AAA", "BBB"];
    const perOne = { analysis: "family", family, tag: "PER1", or: 12.5, ciLow: 2.1, adjP: 0.01 };
    expect([...genes.keys()]).toEqual(["AAA", "BBB"]);
    expect(genes.get("AAA")).toEqual([
      { ...perOne, start: 2, end: 5, sequence: "KLAV" },
      { analysis: "family", family, tag: "PER2", start: 6, end: 8, sequence: "GST", or: null, ciLow: 0, adjP: 0.03 },
    ]);
    expect(genes.get("BBB")).toEqual([{ ...perOne, start: 1, end: 2, sequence: "EQ" }]);
    expect(emptyWindows).toBe(1);
  });
});

describe("verifyPerRegion", () => {
  const region: PerRegion = { analysis: "family", family: null, tag: "PER1", start: 2, end: 5, sequence: "KLAV", or: null, ciLow: null, adjP: null };
  it("verifies when the app's residues match start..end", () => {
    expect(verifyPerRegion(region, "MKLAVQ")).toEqual({ verified: true, mismatches: 0 });
  });
  it("counts each disagreeing residue, including a protein too short to cover the region", () => {
    expect(verifyPerRegion(region, "MKLGVQ")).toEqual({ verified: false, mismatches: 1 });
    expect(verifyPerRegion(region, "MK")).toEqual({ verified: false, mismatches: 3 });
  });
});

describe("bundled PER regions", () => {
  it("returns MAFB's gene-wise PER1 at protein 56-69 and its two family-wise PERs with the MAF partner", () => {
    const response = perRegionsResponseSchema.parse(loadPerRegions("MAFB"));
    expect(response.source.doi).toBe("10.1101/gr.252601.119");
    expect(response.regions).toEqual([
      { analysis: "family", family: ["MAFB", "MAF"], tag: "PER1", start: 55, end: 73, sequence: "VSSTPLSTPCSSVPSSPSF", or: 24.8802168083384, ciLow: 7.64627081031003, adjP: 0.000027124825423959 },
      { analysis: "gene", family: null, tag: "PER1", start: 56, end: 69, sequence: "SSTPLSTPCSSVPS", or: 61.7354087828469, ciLow: 8.13254727231774, adjP: 0.000866058067801987 },
      { analysis: "family", family: ["MAFB", "MAF"], tag: "PER2", start: 248, end: 256, sequence: "NRGYAQSCR", or: 36.7492245340519, ciLow: 4.60347357037112, adjP: 0.0418151425101322 },
    ]);
  });
  it("has no PER for SOD1, VHL or NAE1 in the published data", () => {
    for (const gene of ["SOD1", "VHL", "NAE1"]) expect(loadPerRegions(gene).regions).toEqual([]);
  });
});
