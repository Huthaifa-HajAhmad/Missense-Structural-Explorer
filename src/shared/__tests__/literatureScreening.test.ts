import { describe, expect, it } from "vitest";
import { parseVariantForms, readMentions, type Citation } from "../literatureEvidence";
import {
  LEXICON_VERSION,
  MULTI_VARIANT_THRESHOLD,
  mechanismFit,
  screenPaper,
  whyRead,
} from "../literatureScreening";

const gene = "PAH";
const forms = parseVariantForms("p.Arg408Trp")!;

function citation(abstract: string, extra: Partial<Citation> = {}): Citation {
  return {
    id: "1", title: "PAH study", abstract, authors: "A Author", journal: "Journal", year: 2026, ...extra,
  };
}

function screen(abstract: string, extra: Partial<Citation> = {}) {
  const paper = citation(abstract, extra);
  return screenPaper({ citation: paper, gene, forms, mentions: readMentions(paper, gene, forms) });
}

describe("literature screening synthetic abstracts (proposal §0.3)", () => {
  it("A: puts a variant-anchored patient assay paper first and builds a quote-backed line", () => {
    const result = screen("A patient with PAH p.Arg408Trp had reduced enzyme activity in vitro.");
    expect(result.tier).toBe(1);
    expect(result.tags).toEqual(expect.arrayContaining([
      expect.objectContaining({ tag: "functional-assay", source: "sentence-anchor" }),
      expect.objectContaining({ tag: "clinical-case", source: "sentence-anchor" }),
    ]));
    expect(whyRead(result)).toContain("Variant-anchored");
  });

  it("B: rescues a different one-letter or three-letter substitution at the same residue", () => {
    expect(screen("PAH p.Arg408Gln retained 12% residual activity.").tags).toEqual(
      expect.arrayContaining([expect.objectContaining({ tag: "same-residue" })]),
    );
    expect(screen("PAH R408Q retained 12% residual activity.").tier).toBe(3);
  });

  it("C: keeps abstract-wide false friends out of the variant-anchored tier", () => {
    const result = screen("Patients with PAH variants were diagnosed. We separately measured activity of recombinant enzyme.");
    expect(result.tags.find(tag => tag.tag === "clinical-case")?.source).toBe("lexicon");
    expect(result.tags.find(tag => tag.tag === "functional-assay")?.source).toBe("lexicon");
    expect(result.tier).toBe(4);
  });

  it("D: identifies a variant named among many notations", () => {
    const variants = ["A1V", "C2D", "D3E", "E4F", "F5G", "G6H", "H7I", "I8K", "K9L", "L10M"];
    const result = screen(`PAH p.Arg408Trp was screened alongside ${variants.join(", ")} for activity.`);
    expect(MULTI_VARIANT_THRESHOLD).toBe(10);
    expect(result.tags).toEqual(expect.arrayContaining([expect.objectContaining({ tag: "multi-variant" })]));
    expect(result.tier).toBe(2);
  });

  it("E: compares only loss-of-function terms; gain-of-function is constraint-silent", () => {
    const loss = screen("PAH p.Arg408Trp causes loss-of-function.");
    expect(mechanismFit(loss.mechanismTerms, { pli: null, loeuf: 0.9, missense_z: null, oe_mis: null }))
      .toEqual({ state: "compared", flag: "terms differ from context" });
    const gain = screen("PAH p.Arg408Trp causes gain-of-function.");
    expect(mechanismFit(gain.mechanismTerms, { pli: null, loeuf: 0.9, missense_z: null, oe_mis: null }))
      .toEqual({ state: "constraint-silent", flag: null });
    expect(mechanismFit(loss.mechanismTerms, null)).toEqual({ state: "unavailable", flag: null });
  });

  it("H: represents honest emptiness as full-text-only rather than inventing a variant observation", () => {
    const result = screen("Aquaculture genome editing methods are reviewed.", { title: "Fish genome editing" });
    expect(result.tags).toEqual(expect.arrayContaining([expect.objectContaining({ tag: "full-text-only" })]));
    expect(result.tags.map(tag => tag.tag)).not.toContain("names-variant");
    expect(result.tier).toBe(6);
  });
});

describe("lexical boundaries and structured publication types", () => {
  it("keeps reviews without the gene or variant out of the gene-context shortlist", () => {
    const result = screen("This review summarizes fish genome editing.", { title: "Fish editing", publicationTypes: ["Review"] });
    expect(result.tags.map(tag => tag.tag)).toContain("review");
    expect(result.tier).toBe(6);
    expect(screen("This review summarizes PAH biology.", { publicationTypes: ["Review"] }).tier).toBe(4);
  });
  it("uses whole words, preserves case, and deliberately does not interpret negation", () => {
    expect(screen("PAH p.Arg408Trp has inactivity.").tags.map(tag => tag.tag)).not.toContain("functional-assay");
    expect(screen("PAH p.Arg408Trp was non-functional.").tags).toEqual(expect.arrayContaining([
      expect.objectContaining({ tag: "functional-assay", source: "sentence-anchor" }),
    ]));
    expect(screen("PAH p.Arg408Trp Activity was measured.").tags.map(tag => tag.tag)).not.toContain("functional-assay");
  });

  it("lets a publication type beat the review lexicon and marks preprints from metadata", () => {
    const result = screen("This review discusses PAH p.Arg408Trp.", {
      publicationTypes: ["Review", "Preprint"],
    });
    expect(result.tags).toEqual(expect.arrayContaining([
      expect.objectContaining({ tag: "review", source: "pubtype", quote: "Review" }),
      expect.objectContaining({ tag: "preprint", source: "pubtype", quote: "Preprint" }),
    ]));
    expect(LEXICON_VERSION).toBeGreaterThan(0);
  });
});

describe("review fixes", () => {
  it("anchors on a later sentence when an earlier lexicon hit does not name the variant", () => {
    const result = screen(
      "Patients with PAH deficiency were diagnosed in the cohort. One proband carried PAH p.Arg408Trp and was diagnosed early.",
    );
    expect(result.tags.find(tag => tag.tag === "clinical-case")).toMatchObject({ source: "sentence-anchor" });
    expect(result.tier).toBe(1);
  });

  it("does not call a paper listing many other variants 'variant named'", () => {
    const others = ["R1Q", "R2Q", "R3Q", "R4Q", "R5Q", "R6Q", "R7Q", "R8Q", "R9Q", "R10Q"].map(v => `PAH ${v}`).join(", ");
    const result = screen(`We screened ${others}.`);
    expect(result.tags.some(tag => tag.tag === "multi-variant")).toBe(true);
    expect(result.tags.some(tag => tag.tag === "names-variant")).toBe(false);
    expect(result.tier).toBeGreaterThan(2);
  });
});
