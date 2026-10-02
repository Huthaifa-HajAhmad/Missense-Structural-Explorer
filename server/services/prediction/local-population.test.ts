import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import * as local from "./dbnsfp_local.ts";
import { fetchLocalPopulationFrequencies } from "./local-population.ts";

let db: DatabaseSync;
const coordinate = { chrom: "1", pos: 100, ref: "C", alt: "A", assembly: "GRCh38" as const };
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE variant_scores (
    gene TEXT, pos INTEGER, chr TEXT, pos_genomic INTEGER, ref TEXT, alt TEXT, aa_change TEXT,
    gnomad_ac INTEGER, gnomad_an INTEGER, gnomad_hom INTEGER,
    aou_ac INTEGER, aou_an INTEGER, aou_het INTEGER, aou_hom INTEGER
  )`);
  vi.spyOn(local, "getDbInstance").mockReturnValue(db);
  vi.spyOn(local, "isLocalDbnsfpAvailable").mockReturnValue(true);
});
afterEach(() => { vi.restoreAllMocks(); db.close(); });
function row(options: { alt?: string; change?: string; chr?: string | null; genomicPos?: number | null; ac?: number | null; an?: number | null; aouAc?: number | null; aouAn?: number | null; hom?: number | null; aouHet?: number | null; aouHom?: number | null } = {}) {
  db.prepare("INSERT INTO variant_scores VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "TEST", 867, options.chr === undefined ? "1" : options.chr, options.genomicPos === undefined ? 100 : options.genomicPos,
    "C", options.alt ?? "A", options.change ?? "p.Gln867His", options.ac === undefined ? 2 : options.ac,
    options.an === undefined ? 1000 : options.an, options.hom ?? null, options.aouAc ?? null, options.aouAn ?? null, options.aouHet ?? null, options.aouHom ?? null,
  );
}

describe("local dbNSFP allele binding", () => {
  it("returns null instead of the first row when the requested amino-acid change is absent", async () => {
    row({ change: "p.Gln867Arg" });
    expect(await local.queryLocalDbnsfpVariant("TEST", 867, null, null, "Q867H")).toBeNull();
    expect(await local.queryLocalDbnsfpVariant("TEST", 867, "C", "A", "Q867H", coordinate)).toBeNull();
  });

  it("refuses two matching protein substitutions with different alternate alleles", async () => {
    row(); row({ alt: "G" });
    expect(await local.queryLocalDbnsfpVariant("TEST", 867, null, null, "Q867H")).toBeNull();
    expect(await fetchLocalPopulationFrequencies("TEST", 867, "Q867H")).toBeNull();
  });

  it("binds the verified exact allele even when another ALT encodes the same substitution", async () => {
    row({ alt: "G", ac: 100 }); row({ ac: 2, aouAc: 3, aouAn: 1000 });
    const result = await fetchLocalPopulationFrequencies("TEST", 867, "Q867H", coordinate);
    expect(result?.gnomad.genomeAC).toBe(2);
    expect(result?.gnomad.genomeAN).toBe(1000);
    expect(result?.gnomad.maxAF).toBe(0.002);
    expect(result?.aou).toMatchObject({ aouAC: 3, aouAN: 1000 });
  });

  it.each([
    { ...coordinate, pos: 101 }, { ...coordinate, chrom: "2" }, { ...coordinate, alt: "G" },
    { ...coordinate, assembly: "GRCh37" as const },
  ])("refuses local population records not matching canonical coordinate %j", async (requested) => {
    row();
    expect(await fetchLocalPopulationFrequencies("TEST", 867, "Q867H", requested)).toBeNull();
  });

  it("refuses records with missing genomic provenance", async () => {
    row({ chr: null, genomicPos: null });
    expect(await fetchLocalPopulationFrequencies("TEST", 867, "Q867H", coordinate)).toBeNull();
  });

  it("never turns missing AC into zero merely because AN is known", async () => {
    row({ ac: null, an: 1000 });
    const result = await fetchLocalPopulationFrequencies("TEST", 867, "Q867H", coordinate);
    expect(result?.gnomad.maxAF).toBeNull();
    expect(result?.gnomad.genomeAC).toBeNull();
    expect(result?.gnomad.genomeAN).toBe(1000);
  });

  it("keeps measured zero AC and known AN as a genuine zero frequency", async () => {
    row({ ac: 0, an: 1000 });
    expect((await fetchLocalPopulationFrequencies("TEST", 867, "Q867H", coordinate))?.gnomad.maxAF).toBe(0);
  });

  it.each([
    { ac: -1 }, { ac: 0.5 }, { ac: Infinity }, { an: -1 }, { an: 0.5 }, { an: Infinity },
    { ac: 1001, an: 1000 }, { ac: 1, an: 0 }, { ac: 2, hom: 2 }, { hom: -1 },
  ])("rejects invalid gnomAD counts without rejecting the independent valid AoU cohort: %j", async (counts) => {
    row({ ...counts, aouAc: 3, aouAn: 1000, aouHet: 3, aouHom: 0 });
    const result = await fetchLocalPopulationFrequencies("TEST", 867, "Q867H", coordinate);
    expect(result?.gnomad).toBeNull();
    expect(result?.aou).toEqual({ aouAC: 3, aouAN: 1000, aouHet: 3, aouHom: 0 });
  });

  it.each([
    { aouAc: -1 }, { aouAc: 0.5 }, { aouAc: Infinity }, { aouAn: -1 }, { aouAn: 0.5 }, { aouAn: Infinity },
    { aouAc: 1001, aouAn: 1000 }, { aouAc: 2, aouHom: 2 }, { aouHet: -1 },
    { aouAc: 3, aouHet: 2, aouHom: 0 }, { aouAn: 1, aouHom: 1 },
  ])("rejects invalid AoU counts without claiming physical absence: %j", async (counts) => {
    row({ aouAc: 3, aouAn: 1000, ...counts });
    const result = await fetchLocalPopulationFrequencies("TEST", 867, "Q867H", coordinate);
    expect(result?.aou).toBeNull();
    expect(result?.aouInvalidCounts).toBe(true);
    expect(result?.gnomad.maxAF).toBe(0.002);
  });

  it.each(["X", "chrX", "Y", "M", "MT"])("preserves non-diploid %s counts with unreported hemizygous copies", async (chrom) => {
    row({ chr: chrom, ac: 3, an: 100, hom: 0, aouAc: 3, aouAn: 100, aouHet: 1, aouHom: 0 });
    const result = await fetchLocalPopulationFrequencies("TEST", 867, "Q867H", { ...coordinate, chrom });
    expect(result?.gnomad.maxAF).toBe(0.03);
    expect(result?.aou).toEqual({ aouAC: 3, aouAN: 100, aouHet: 1, aouHom: 0 });
    expect(result?.aouInvalidCounts).toBeUndefined();
  });

  it.each(["X", "Y", "M", "MT"])("does not assume two copies per reported homozygote on %s", async (chrom) => {
    row({ chr: chrom, ac: 2, an: 100, hom: 2, aouAc: 2, aouAn: 100, aouHet: 0, aouHom: 2 });
    const result = await fetchLocalPopulationFrequencies("TEST", 867, "Q867H", { ...coordinate, chrom });
    expect(result?.gnomad.maxAF).toBe(0.02);
    expect(result?.aou?.aouHom).toBe(2);
    expect(result?.aouInvalidCounts).toBeUndefined();
  });

  it("still rejects non-diploid genotype counts exceeding known alternate copies", async () => {
    row({ chr: "X", ac: 2, an: 100, hom: 3, aouAc: 2, aouAn: 100, aouHet: 1, aouHom: 2 });
    const result = await fetchLocalPopulationFrequencies("TEST", 867, "Q867H", { ...coordinate, chrom: "X" });
    expect(result?.gnomad).toBeNull();
    expect(result?.aou).toBeNull();
    expect(result?.aouInvalidCounts).toBe(true);
  });

  it("applies complete diploid genotype correlation on chr-prefixed autosomes", async () => {
    row({ chr: "chr22", aouAc: 3, aouAn: 100, aouHet: 1, aouHom: 0 });
    const result = await fetchLocalPopulationFrequencies("TEST", 867, "Q867H", { ...coordinate, chrom: "chr22" });
    expect(result?.gnomad.maxAF).toBe(0.002);
    expect(result?.aou).toBeNull();
    expect(result?.aouInvalidCounts).toBe(true);
  });

  it.each([
    { ...coordinate, chrom: "NaN" }, { ...coordinate, pos: Infinity }, { ...coordinate, pos: 100.5 },
    { ...coordinate, ref: "N" }, { ...coordinate, alt: "NaN" }, { ...coordinate, alt: "C" },
  ])("rejects malformed coordinates before accepting any cohort: %j", async (requested) => {
    row();
    expect(await fetchLocalPopulationFrequencies("TEST", 867, "Q867H", requested)).toBeNull();
  });

  it("returns null cohort objects for an all-null row", async () => {
    row({ ac: null, an: null });
    expect(await fetchLocalPopulationFrequencies("TEST", 867, "Q867H", coordinate)).toEqual({ gnomad: null, aou: null });
  });
});
