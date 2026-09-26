import { describe, it, expect } from "vitest";
import { parseVariantQuery } from "../variantQuery";

/**
 * The palette turns one free-text line into a query, so every rule that decides "what did the
 * user mean" is pinned here — including the ones that look innocuous.
 */
describe("parseVariantQuery — gene + protein", () => {
  it("splits a symbol and a 1-letter substitution", () => {
    const q = parseVariantQuery("BRCA1 R175H");
    expect(q).toMatchObject({
      gene: "BRCA1",
      variant: "R175H",
      genomic: null,
      uniprot: null,
      recognised: true,
      runnable: true,
      needsResolution: false,
      label: "BRCA1 · R175H",
    });
  });

  it("is order-independent", () => {
    expect(parseVariantQuery("R175H BRCA1")).toMatchObject({ gene: "BRCA1", variant: "R175H" });
  });

  it("accepts 3-letter HGVS and tolerates a comma", () => {
    expect(parseVariantQuery("TP53, p.Arg175His")).toMatchObject({
      gene: "TP53",
      variant: "p.Arg175His",
      runnable: true,
    });
  });

  it("reads a lower-case gene once a variant proves the intent", () => {
    expect(parseVariantQuery("brca1 r175h")).toMatchObject({ gene: "BRCA1", variant: "r175h" });
  });

  it("keeps the gene upper-cased as typed", () => {
    expect(parseVariantQuery("MECP2 R133C").gene).toBe("MECP2");
  });
});

describe("parseVariantQuery — coordinates and accessions", () => {
  it("treats a dashed coordinate as a run on its own", () => {
    const q = parseVariantQuery("20-23365054-G-A");
    expect(q).toMatchObject({
      gene: null,
      variant: null,
      genomic: "20-23365054-G-A",
      runnable: true,
      needsResolution: true,
      label: "20-23365054-G-A",
    });
  });

  it("recognises genomic HGVS with an inline assembly annotation", () => {
    const q = parseVariantQuery("Chr1(GRCh38):g.25484258G>A");
    expect(q.genomic).toBe("Chr1(GRCh38):g.25484258G>A");
    expect(q.runnable).toBe(true);
    expect(q.needsResolution).toBe(true);
  });

  it("captures a transcript cDNA notation as the coordinate slot", () => {
    expect(parseVariantQuery("NM_004333.6:c.1799T>A")).toMatchObject({
      genomic: "NM_004333.6:c.1799T>A",
      runnable: true,
      needsResolution: true,
    });
  });

  it("splits a symbol from a UniProt accession instead of reading it as a gene", () => {
    expect(parseVariantQuery("SCN9A Q9Y305")).toMatchObject({ gene: "SCN9A", uniprot: "Q9Y305" });
  });

  it("keeps an isoform-suffixed accession intact", () => {
    expect(parseVariantQuery("Q9Y305-4").uniprot).toBe("Q9Y305-4");
  });

  it("prefers the coordinate over a protein token when both are present", () => {
    const q = parseVariantQuery("BRCA1 17-7676154-C-T R175H");
    expect(q.genomic).toBe("17-7676154-C-T");
    expect(q.label).toBe("BRCA1 · 17-7676154-C-T");
  });
});

describe("parseVariantQuery — build annotations and look-alike words", () => {
  /* A pasted coordinate very often leads with its build. Left in the token stream, `GRCh37`
     matched the symbol shape and became the gene — so the run analysed a gene called
     `GRCH37`, which does not exist, against a real coordinate. */
  it("does not read a build annotation as a gene", () => {
    expect(parseVariantQuery("GRCh37 17-7676154-C-T")).toMatchObject({
      gene: null,
      genomic: "17-7676154-C-T",
      runnable: true,
    });
    expect(parseVariantQuery("hg19 17-7676154-C-T").gene).toBeNull();
  });

  it("recognises nothing at all in a bare build", () => {
    expect(parseVariantQuery("GRCh38").recognised).toBe(false);
  });

  /* The case-sensitive symbol test already rejects `settings`; this is the same trap under
     caps lock, and for the vocabulary the palette itself prints. */
  it.each(["DNA", "RNA", "AND", "OR", "OK", "NO", "A", "ANY", "THE", "YOUR"])(
    "does not read %j as a gene",
    (word) => {
      const q = parseVariantQuery(word);
      expect(q.gene).toBeNull();
      expect(q.recognised).toBe(false);
    },
  );

  /* The exclusion list must not grow over real symbols. MY (myoglobin) and AS (asporin) are
     genuine gene symbols, and both fit the shape. */
  it("still accepts real two-letter symbols", () => {
    expect(parseVariantQuery("MY R175H")).toMatchObject({ gene: "MY", variant: "R175H" });
    expect(parseVariantQuery("AS").gene).toBe("AS");
  });
});

describe("parseVariantQuery — accessions as a runnable partner", () => {
  /* An accession plus a substitution is a complete query: the pipeline resolves a gene from an
     accession in Stage 1.5. It used to report `runnable: false` and offer only a field-fill,
     for a query that was ready to run. */
  it("runs an accession qualified substitution", () => {
    expect(parseVariantQuery("P51587 R175H")).toMatchObject({
      uniprot: "P51587",
      variant: "R175H",
      runnable: true,
    });
  });

  /* The label is the only place the reader sees what they typed, and it used to drop the
     accession entirely — `P51587 R175H` rendered as bare `R175H`, and a bare accession
     rendered as an empty string, giving a row that read `Open in Search · ` with nothing
     after it. */
  it("names every part in the label", () => {
    expect(parseVariantQuery("P51587 R175H").label).toBe("R175H · P51587");
    expect(parseVariantQuery("P04637").label).toBe("P04637");
    expect(parseVariantQuery("SCN9A Q9Y305").label).toBe("SCN9A · Q9Y305");
  });

  it("offers no run for an accession on its own", () => {
    expect(parseVariantQuery("P04637")).toMatchObject({
      uniprot: "P04637",
      runnable: false,
      recognised: true,
    });
  });
});

describe("parseVariantQuery — refuses to invent a query", () => {
  it.each(["", "   ", "\n"])("treats %j as no query", (input) => {
    const q = parseVariantQuery(input);
    expect(q.recognised).toBe(false);
    expect(q.runnable).toBe(false);
    expect(q.label).toBe("");
  });

  it("does not read an English word as a gene symbol", () => {
    const q = parseVariantQuery("settings");
    expect(q.recognised).toBe(false);
    expect(q.gene).toBeNull();
  });

  it("does not read a plain number as a gene symbol", () => {
    expect(parseVariantQuery("2024").recognised).toBe(false);
  });

  it("offers no run for a gene on its own", () => {
    const q = parseVariantQuery("BRCA1");
    expect(q).toMatchObject({ gene: "BRCA1", runnable: false, recognised: true });
    expect(q.label).toBe("BRCA1");
  });

  it("offers no run for a substitution on its own", () => {
    const q = parseVariantQuery("R175H");
    expect(q).toMatchObject({ variant: "R175H", runnable: false, recognised: true });
  });

  it("survives null and undefined", () => {
    expect(parseVariantQuery(null).recognised).toBe(false);
    expect(parseVariantQuery(undefined).recognised).toBe(false);
  });

  it("ignores tokens beyond the sixth", () => {
    const q = parseVariantQuery("BRCA1 R175H a b c d e f g");
    expect(q).toMatchObject({ gene: "BRCA1", variant: "R175H", runnable: true });
  });
});
