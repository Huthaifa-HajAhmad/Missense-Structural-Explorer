import { describe, expect, it } from "vitest";
import {
  attachCuratedLinks,
  curatedOnlyCitations,
  dedupeCuratedLinks,
  mergeCuratedCitations,
  type CuratedVariantLink,
} from "../curatedLiterature";
import { attentionTier, screenPaper, whyRead } from "../literatureScreening";
import { parseVariantForms, readMentions, type Citation } from "../literatureEvidence";

const gene = "PAH";
const forms = parseVariantForms("p.Arg408Trp")!;

function link(over: Partial<CuratedVariantLink> = {}): CuratedVariantLink {
  return {
    provider: "uniprot",
    featureId: "VAR_000001",
    accession: "P00439",
    variant: "R408W",
    variantDescription: "in phenylketonuria",
    evidenceCode: "ECO:0000269",
    pmid: "1",
    source: "PubMed",
    sourceUrl: "https://www.uniprot.org/uniprotkb/P00439/variant/VAR_000001",
    retrievedAt: "2026-10-05T00:00:00.000Z",
    ...over,
  };
}

function citation(over: Partial<Citation> = {}): Citation {
  return {
    id: "1",
    title: "PAH study",
    abstract: "A study of PAH genetics.",
    authors: "A Author",
    journal: "J",
    year: 2026,
    ...over,
  };
}

function screen(c: Citation, curatedLinks: CuratedVariantLink[] | null, formsOverride: ReturnType<typeof parseVariantForms> = forms) {
  return screenPaper({
    citation: c,
    gene,
    forms: formsOverride,
    mentions: readMentions(c, gene, formsOverride),
    curatedLinks,
  });
}

describe("curated link merging", () => {
  it("unions links onto the ordinary record without adding records, and returns non-matches separately", () => {
    const ordinary = [citation({ id: "1" }), citation({ id: "2" })];
    const curA = { ...citation({ id: "1" }), curatedLinks: [link({ pmid: "1", featureId: "VAR_A" })] };
    const curB = { ...citation({ id: "1" }), curatedLinks: [link({ pmid: "1", featureId: "VAR_B" })] };
    const curOnly = { ...citation({ id: "3", title: "Only curated", abstract: "" }), curatedLinks: [link({ pmid: "3" })] };

    const annotated = attachCuratedLinks(ordinary, [curA, curB, curOnly]);
    expect(annotated).toHaveLength(2);
    expect(annotated[0].curatedLinks?.map(l => l.featureId)).toEqual(["VAR_A", "VAR_B"]);
    expect(annotated[1].curatedLinks).toBeUndefined();

    const additions = curatedOnlyCitations(ordinary, [curA, curB, curOnly]);
    expect(additions.map(c => c.id)).toEqual(["3"]);
    expect(mergeCuratedCitations(ordinary, [curA, curB, curOnly]).map(c => c.id)).toEqual(["1", "2", "3"]);
  });

  it("deduplicates identical provider relationships but keeps distinct features for one paper", () => {
    expect(dedupeCuratedLinks([link(), link()])).toHaveLength(1);
    expect(dedupeCuratedLinks([link({ featureId: "VAR_A" }), link({ featureId: "VAR_B" })])).toHaveLength(2);
    expect(dedupeCuratedLinks([link({ provider: "uniprot" }), link({ provider: "clinvar" })])).toHaveLength(2);
  });
});

describe("screening enforces the curated link's own variant", () => {
  it("promotes a matching curated link with no abstract mention, as provider provenance not a tag", () => {
    const result = screen(citation(), [link({ variant: "R408W" })]);
    expect(result.citedBy).toHaveLength(1);
    expect(result.citedBy?.[0].label).toBe("Cited by UniProt variant record");
    expect(result.tier).toBe(1);
    expect(result.tags.map(tag => tag.tag)).not.toContain("names-variant");
    expect(whyRead(result)).toContain("Cited by UniProt variant record");
  });

  it("does not promote a same-pmid link for a neighbouring substitution", () => {
    // Regression: filtering by pmid alone promoted an R408Q relationship onto an R408W query.
    const result = screen(citation(), [link({ variant: "R408Q" })]);
    expect(result.citedBy).toBeUndefined();
    expect(result.tier).not.toBe(1);
  });

  it("does not promote when the query has no parseable target", () => {
    const result = screen(citation(), [link()], null);
    expect(result.citedBy).toBeUndefined();
  });

  it("does not promote a link whose pmid is a different record", () => {
    const result = screen(citation({ id: "1" }), [link({ pmid: "2" })]);
    expect(result.citedBy).toBeUndefined();
  });

  it("keeps a quote-backed names-variant tag distinct from the curated relationship", () => {
    const result = screen(citation({ abstract: "PAH p.Arg408Trp was found." }), [link({ variant: "R408W" })]);
    expect(result.citedBy).toHaveLength(1);
    expect(result.tags.find(tag => tag.tag === "names-variant")?.source).toBe("curated");
    // The tag still carries its own quote; the curated reading is provenance, not the quote.
    expect(result.tags.find(tag => tag.tag === "names-variant")?.quote).toContain("p.Arg408Trp");
  });

  it("does not put a curated relationship ahead of a review", () => {
    const result = screen(citation({ publicationTypes: ["Review"] }), [link({ variant: "R408W" })]);
    expect(result.tier).not.toBe(1);
  });

  it("counts a curated reading for ordering only, with no ACMG surface", () => {
    expect(attentionTier({ tags: [], citedBy: [{ provider: "uniprot", label: "x", detail: "", sourceUrl: "", pmid: "1", retrievedAt: "" }] })).toBe(1);
  });
});
