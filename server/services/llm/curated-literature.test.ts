import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Curated variant → PMID links (Phase 1b).
 *
 * The service is the only place that reads a provider's citation evidence and maps it to a variant, so
 * these tests pin the matching rule (exact accession/position/reference/alternate), the provider
 * boundaries (human only, PubMed only, isoform refused), the hydration verification (every returned id
 * must be a curated id), explicit failure states, and that a curated link is a metadata relationship —
 * never a fabricated quote.
 */

vi.mock("../infra/http-client.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../infra/http-client.ts")>();
  return { ...actual, fetchWithRetry: vi.fn() };
});
vi.mock("./literature-rag.ts", () => ({ fetchCitationsByPmids: vi.fn() }));

import { fetchWithRetry } from "../infra/http-client.ts";
import { fetchCitationsByPmids } from "./literature-rag.ts";
import {
  curatedLinksFromEntry,
  curatedVariantCitationsCache,
  getCuratedVariantCitations,
} from "./curated-literature.ts";

const mockedFetch = vi.mocked(fetchWithRetry);
const mockedHydrate = vi.mocked(fetchCitationsByPmids);

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const emptyResponse = (status: number) => new Response("", { status });

function entry(over: Record<string, unknown> = {}) {
  return {
    primaryAccession: "Q13564",
    organism: { taxonId: 9606 },
    genes: [{ geneName: { value: "NAE1" }, synonyms: [{ value: "APPBP1" }] }],
    features: [] as unknown[],
    ...over,
  };
}

function naturalVariant(over: Record<string, unknown> = {}) {
  return {
    type: "Natural variant",
    location: { start: { value: 49, modifier: "EXACT" }, end: { value: 49, modifier: "EXACT" } },
    featureId: "VAR_088123",
    description: "in NEDFIH; uncertain significance",
    alternativeSequence: { originalSequence: "L", alternativeSequences: ["F"] },
    evidences: [{ evidenceCode: "ECO:0000269", source: "PubMed", id: "36608681" }],
    ...over,
  };
}

function row(id: string, abstract = "A curated abstract.") {
  return {
    id,
    title: "Bi-allelic NAE1 variants",
    abstract,
    authors: "Author A",
    journal: "J",
    year: 2022,
    url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  curatedVariantCitationsCache.clear();
});

describe("getCuratedVariantCitations — exact match", () => {
  it("resolves the matching Natural variant's PubMed evidence and preserves provenance", async () => {
    mockedFetch.mockResolvedValue(jsonResponse(entry({ features: [naturalVariant()] })));
    mockedHydrate.mockResolvedValue([row("36608681")] as any);

    const result = await getCuratedVariantCitations("NAE1", "p.Leu49Phe", "Q13564");

    expect(result.state).toBe("complete");
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].id).toBe("36608681");
    const link = result.citations[0].curatedLinks![0];
    expect(link).toMatchObject({
      provider: "uniprot",
      featureId: "VAR_088123",
      accession: "Q13564",
      variant: "L49F",
      pmid: "36608681",
      evidenceCode: "ECO:0000269",
      source: "PubMed",
    });
    expect(link.sourceUrl).toContain("Q13564");
    expect(link.sourceUrl).toContain("VAR_088123");
    expect(link.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(mockedHydrate).toHaveBeenCalledWith(["36608681"], undefined);
  });

  it("carries no fabricated quote when the abstract never mentions the variant", async () => {
    mockedFetch.mockResolvedValue(jsonResponse(entry({ features: [naturalVariant()] })));
    mockedHydrate.mockResolvedValue([row("36608681", "")] as any);

    const result = await getCuratedVariantCitations("NAE1", "p.Leu49Phe", "Q13564");

    expect(result.state).toBe("complete");
    expect(result.citations[0].abstract).toBe("");
    expect(result.citations[0].curatedLinks?.[0].variantDescription).toContain("NEDFIH");
    // A relationship, not an observation: no quote field is ever synthesised on the link.
    expect(JSON.stringify(result.citations)).not.toMatch(/"(quote|snippet|abstractSentence)":/);
  });

  it("caches a completed lookup so a second call does not re-query the provider", async () => {
    mockedFetch.mockResolvedValue(jsonResponse(entry({ features: [naturalVariant()] })));
    mockedHydrate.mockResolvedValue([row("36608681")] as any);

    await getCuratedVariantCitations("NAE1", "p.Leu49Phe", "Q13564");
    const second = await getCuratedVariantCitations("NAE1", "p.Leu49Phe", "Q13564");

    expect(second.state).toBe("complete");
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedHydrate).toHaveBeenCalledTimes(1);
  });
});

describe("getCuratedVariantCitations — matching boundaries", () => {
  it("does not promote a different substitution at the same residue", async () => {
    mockedFetch.mockResolvedValue(jsonResponse(entry({ features: [naturalVariant()] })));

    const result = await getCuratedVariantCitations("NAE1", "p.Leu49Arg", "Q13564");

    expect(result.state).toBe("complete");
    expect(result.citations).toEqual([]);
    expect(mockedHydrate).not.toHaveBeenCalled();
  });

  it("treats a same-position feature for another substitution as a separate relationship", () => {
    const links = curatedLinksFromEntry(
      entry({ features: [naturalVariant()] }),
      "Q13564",
      { wildType: "L", position: 49, alternate: "R" },
    );
    expect(links).toEqual([]);
  });

  it("ignores evidence whose source is not PubMed, and non-numeric ids", () => {
    const links = curatedLinksFromEntry(
      entry({
        features: [naturalVariant({
          evidences: [
            { evidenceCode: "ECO:0000006", source: "PDB", id: "1ABC" },
            { evidenceCode: "ECO:0000305", source: "UniProt", id: "PROSITE" },
            { evidenceCode: "ECO:0000269", source: "PubMed", id: "not-a-pmid" },
          ],
        })],
      }),
      "Q13564",
      { wildType: "L", position: 49, alternate: "F" },
    );
    expect(links).toEqual([]);
  });

  it("refuses a range or non-exact location", () => {
    const ranged = naturalVariant({ location: { start: { value: 49, modifier: "EXACT" }, end: { value: 50, modifier: "EXACT" } } });
    const unknown = naturalVariant({ location: { start: { value: 49, modifier: "UNKNOWN" }, end: { value: 49, modifier: "UNKNOWN" } } });
    for (const feature of [ranged, unknown]) {
      expect(curatedLinksFromEntry(entry({ features: [feature] }), "Q13564", { wildType: "L", position: 49, alternate: "F" })).toEqual([]);
    }
  });

  it("deduplicates a PMID cited twice by one feature but keeps two distinct features", () => {
    const duplicate = naturalVariant({
      evidences: [
        { evidenceCode: "ECO:0000269", source: "PubMed", id: "36608681" },
        { evidenceCode: "ECO:0007744", source: "PubMed", id: "36608681" },
      ],
    });
    const secondFeature = naturalVariant({ featureId: "VAR_099999" });
    expect(curatedLinksFromEntry(entry({ features: [duplicate] }), "Q13564", { wildType: "L", position: 49, alternate: "F" })).toHaveLength(1);
    const two = curatedLinksFromEntry(entry({ features: [naturalVariant(), secondFeature] }), "Q13564", { wildType: "L", position: 49, alternate: "F" });
    expect(two).toHaveLength(2);
    expect(new Set(two.map(link => link.featureId)).size).toBe(2);
  });
});

describe("getCuratedVariantCitations — provider boundaries are explicit", () => {
  it("refuses an isoform accession instead of matching canonical numbering", async () => {
    const result = await getCuratedVariantCitations("NAE1", "p.Leu49Phe", "Q13564-2");
    expect(result.state).toBe("unavailable");
    expect(result.reason).toMatch(/isoform/i);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("refuses an accession that is not a UniProt accession", async () => {
    const result = await getCuratedVariantCitations("NAE1", "p.Leu49Phe", "not-an-accession");
    expect(result.state).toBe("unavailable");
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("refuses an entry whose returned accession differs from the requested one", async () => {
    mockedFetch.mockResolvedValue(jsonResponse(entry({ primaryAccession: "P99999" })));
    const result = await getCuratedVariantCitations("NAE1", "p.Leu49Phe", "Q13564");
    expect(result.state).toBe("unavailable");
    expect(result.reason).toContain("P99999");
    expect(mockedHydrate).not.toHaveBeenCalled();
  });

  it("refuses a non-human entry", async () => {
    mockedFetch.mockResolvedValue(jsonResponse(entry({ organism: { taxonId: 10090 } })));
    const result = await getCuratedVariantCitations("NAE1", "p.Leu49Phe", "Q13564");
    expect(result.state).toBe("unavailable");
    expect(result.reason).toMatch(/not human/i);
  });

  it("refuses an entry that does not name the query gene", async () => {
    mockedFetch.mockResolvedValue(jsonResponse(entry({ genes: [{ geneName: { value: "NAE9" } }] })));
    const result = await getCuratedVariantCitations("NAE1", "p.Leu49Phe", "Q13564");
    expect(result.state).toBe("unavailable");
    expect(result.reason).toContain("NAE1");
    expect(mockedHydrate).not.toHaveBeenCalled();
  });

  it("refuses an entry with no gene metadata instead of assuming compatibility", async () => {
    mockedFetch.mockResolvedValue(jsonResponse(entry({ genes: [] })));
    const result = await getCuratedVariantCitations("NAE1", "p.Leu49Phe", "Q13564");
    expect(result.state).toBe("unavailable");
    expect(result.reason).toMatch(/no gene name/i);
    expect(mockedHydrate).not.toHaveBeenCalled();
  });

  it("keys the cache by gene, so a wrong-gene result cannot poison the correct gene", async () => {
    // The entry names NAE1, so a WRONG1 query is a cached `unavailable`.
    mockedFetch.mockResolvedValueOnce(jsonResponse(entry({ features: [naturalVariant()] })));
    const wrong = await getCuratedVariantCitations("WRONG1", "p.Leu49Phe", "Q13564");
    expect(wrong.state).toBe("unavailable");

    // Same accession and substitution, correct gene: must re-resolve, not reuse the wrong-gene answer.
    mockedFetch.mockResolvedValueOnce(jsonResponse(entry({ features: [naturalVariant()] })));
    mockedHydrate.mockResolvedValueOnce([row("36608681")] as any);
    const right = await getCuratedVariantCitations("NAE1", "p.Leu49Phe", "Q13564");
    expect(right.state).toBe("complete");
    expect(right.citations).toHaveLength(1);
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it("reports a definitive absence as complete with no links", async () => {
    mockedFetch.mockResolvedValue(jsonResponse(entry({ features: [naturalVariant({ evidences: [] })] })));
    const result = await getCuratedVariantCitations("NAE1", "p.Leu49Phe", "Q13564");
    expect(result).toEqual({ citations: [], state: "complete" });
  });

  it("reports a 404 as unavailable, not an error", async () => {
    mockedFetch.mockResolvedValue(emptyResponse(404));
    const result = await getCuratedVariantCitations("NAE1", "p.Leu49Phe", "Q13564");
    expect(result.state).toBe("unavailable");
  });

  it("reports a provider failure as error and does not cache it", async () => {
    mockedFetch.mockRejectedValueOnce(new Error("socket hang up"));
    const first = await getCuratedVariantCitations("NAE1", "p.Leu49Phe", "Q13564");
    expect(first.state).toBe("error");

    mockedFetch.mockResolvedValueOnce(jsonResponse(entry({ features: [naturalVariant()] })));
    mockedHydrate.mockResolvedValueOnce([row("36608681")] as any);
    const second = await getCuratedVariantCitations("NAE1", "p.Leu49Phe", "Q13564");
    expect(second.state).toBe("complete");
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it("reports a hydration failure explicitly instead of an empty list", async () => {
    mockedFetch.mockResolvedValue(jsonResponse(entry({ features: [naturalVariant()] })));
    mockedHydrate.mockRejectedValue(new Error("did not return every curated PMID"));
    const result = await getCuratedVariantCitations("NAE1", "p.Leu49Phe", "Q13564");
    expect(result.state).toBe("error");
    expect(result.citations).toEqual([]);
    expect(result.reason).toMatch(/curated citation lookup failed/i);
  });

  it("keeps only returned records that are curated links", async () => {
    mockedFetch.mockResolvedValue(jsonResponse(entry({ features: [naturalVariant()] })));
    mockedHydrate.mockResolvedValue([row("36608681"), row("99999999")] as any);
    const result = await getCuratedVariantCitations("NAE1", "p.Leu49Phe", "Q13564");
    expect(result.citations.map(citation => citation.id)).toEqual(["36608681"]);
  });
});
