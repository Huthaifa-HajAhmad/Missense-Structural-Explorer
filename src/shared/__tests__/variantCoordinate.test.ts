import { describe, it, expect } from "vitest";
import { parseVariantCoordinate, cleanVariantString, normalizeAminoAcid3 } from "../variantCoordinate.ts";

describe("VariantCoordinate Parser & Normalizer", () => {
  it("should correctly parse standard 3-letter HGVS notation (p.Arg408Trp)", () => {
    const coord = parseVariantCoordinate("p.Arg408Trp", { gene: "PAH" });
    expect(coord.gene).toBe("PAH");
    expect(coord.pos).toBe(408);
    expect(coord.wt1).toBe("R");
    expect(coord.wt3).toBe("Arg");
    expect(coord.mut1).toBe("W");
    expect(coord.mut3).toBe("Trp");
    expect(coord.foldxCode).toBe("RA408W");
    expect(coord.hgvsp1).toBe("p.R408W");
    expect(coord.hgvsp3).toBe("p.Arg408Trp");
    expect(coord.isSynonymous).toBe(false);
  });

  it("should parse 1-letter HGVS notation (p.R408W) and bare notation (R408W)", () => {
    const coord1 = parseVariantCoordinate("p.R408W");
    expect(coord1.pos).toBe(408);
    expect(coord1.wt1).toBe("R");
    expect(coord1.mut1).toBe("W");
    expect(coord1.foldxCode).toBe("RA408W");

    const coord2 = parseVariantCoordinate("R408W");
    expect(coord2.pos).toBe(408);
    expect(coord2.wt1).toBe("R");
    expect(coord2.mut1).toBe("W");
    expect(coord2.foldxCode).toBe("RA408W");
  });

  it("should parse FoldX format with chain (RB215H)", () => {
    const coord = parseVariantCoordinate("RB215H");
    expect(coord.pos).toBe(215);
    expect(coord.wt1).toBe("R");
    expect(coord.mut1).toBe("H");
    expect(coord.chain).toBe("B");
    expect(coord.foldxCode).toBe("RB215H");
  });

  it("should handle lowercase and prefix edge cases", () => {
    const coord = parseVariantCoordinate("ensto0000:arg408trp", { gene: "PAH" });
    expect(coord.pos).toBe(408);
    expect(coord.wt1).toBe("R");
    expect(coord.mut1).toBe("W");
    expect(coord.foldxCode).toBe("RA408W");
  });

  it("should detect synonymous variants", () => {
    const coord = parseVariantCoordinate("p.Ala40Ala");
    expect(coord.isSynonymous).toBe(true);
    expect(coord.wt1).toBe("A");
    expect(coord.mut1).toBe("A");
  });

  it("should parse variants with insertion codes (e.g. 408A) across all formats", () => {
    // 3-letter with insertion code
    const coord3 = parseVariantCoordinate("p.Arg408ATrp", { gene: "PAH" });
    expect(coord3.pos).toBe(408);
    expect(coord3.insCode).toBe("A");
    expect(coord3.wt1).toBe("R");
    expect(coord3.mut1).toBe("W");
    expect(coord3.foldxCode).toBe("RA408AW");
    expect(coord3.hgvsp1).toBe("p.R408AW");
    expect(coord3.hgvsp3).toBe("p.Arg408ATrp");
    expect(coord3.notation1).toBe("R408AW");

    // 1-letter with insertion code
    const coord1 = parseVariantCoordinate("R408AW");
    expect(coord1.pos).toBe(408);
    expect(coord1.insCode).toBe("A");
    expect(coord1.wt1).toBe("R");
    expect(coord1.mut1).toBe("W");
    expect(coord1.foldxCode).toBe("RA408AW");

    // FoldX with chain and insertion code
    const coordFoldx = parseVariantCoordinate("RB215BH");
    expect(coordFoldx.pos).toBe(215);
    expect(coordFoldx.chain).toBe("B");
    expect(coordFoldx.insCode).toBe("B");
    expect(coordFoldx.wt1).toBe("R");
    expect(coordFoldx.mut1).toBe("H");
    expect(coordFoldx.foldxCode).toBe("RB215BH");
  });

  it("should reject invalid amino acid strings", () => {
    expect(() => parseVariantCoordinate("p.Xyz100Abc")).toThrow();
    expect(() => parseVariantCoordinate("12345")).toThrow();
    expect(() => parseVariantCoordinate("")).toThrow();
  });
});
