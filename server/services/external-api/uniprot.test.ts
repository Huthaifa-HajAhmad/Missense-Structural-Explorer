import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchUniprotEntryReferenceData,
  fetchUniprotFeatures,
  isUniprotEntryName,
  resolveUniprotEntryNameToAccession,
} from "./uniprot.ts";
import { clearAllCaches } from "../infra/cache.ts";

describe("UniProt Features Service", () => {
  beforeEach(() => {
    clearAllCaches(true);
    vi.restoreAllMocks();
  });

  it("should parse and retain Domain, Binding site with ligand, and Transmembrane features", async () => {
    const mockUniProtJson = {
      genes: [{ geneName: { value: "MAST2" } }],
      // UniProt REST's real shape: SUBUNIT text at `texts`, not `note.texts` (the old mock copied the
      // parser's wrong path, which is how every protein came to read as a monomer with tests green).
      comments: [{ commentType: "SUBUNIT", texts: [{ value: "Homodimer." }] }],
      features: [
        {
          type: "Domain",
          description: "Protein kinase",
          location: { start: { value: 512 }, end: { value: 785 } }
        },
        {
          type: "Active site",
          description: "Proton acceptor",
          location: { start: { value: 635 }, end: { value: 635 } }
        },
        {
          type: "Binding site",
          description: "",
          ligand: { name: "ATP" },
          location: { start: { value: 518 }, end: { value: 526 } }
        },
        {
          type: "Transmembrane",
          description: "Helical",
          location: { start: { value: 20 }, end: { value: 40 } }
        }
      ]
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockUniProtJson
    } as any);

    const result = await fetchUniprotFeatures("Q6P0Q8");
    expect(result).toBeDefined();
    expect(result?.geneName).toBe("MAST2");
    expect(result?.isMultimer).toBe(true);
    expect(result?.features.length).toBe(4);

    const domainFeature = result?.features.find(f => f.type === "Domain");
    expect(domainFeature).toBeDefined();
    expect(domainFeature?.description).toBe("Protein kinase");
    expect(domainFeature?.start).toBe(512);

    const bindingFeature = result?.features.find(f => f.type === "Binding site");
    expect(bindingFeature?.description).toBe("Ligand: ATP");
  });

  it("should extract InterPro cross-references with abbreviated database names and sequence length", async () => {
    const mockUniProtJson = {
      genes: [{ geneName: { value: "MAST2" } }],
      sequence: { length: 1798 },
      uniProtKBCrossReferences: [
        {
          database: "InterPro",
          id: "IPR000719",
          properties: [{ key: "EntryName", value: "Prot_kinase_dom" }]
        },
        {
          database: "InterPro",
          id: "IPR000961",
          properties: [{ key: "EntryName", value: "AGC-kinase_C" }]
        },
        {
          database: "InterPro",
          id: "IPR001478",
          properties: [{ key: "EntryName", value: "PDZ" }]
        }
      ],
      features: [
        {
          type: "Domain",
          description: "Protein kinase",
          location: { start: { value: 512 }, end: { value: 785 } }
        },
        {
          type: "Domain",
          description: "AGC-kinase C-terminal",
          location: { start: { value: 786 }, end: { value: 854 } }
        },
        {
          type: "Domain",
          description: "PDZ",
          location: { start: { value: 1104 }, end: { value: 1192 } }
        }
      ]
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockUniProtJson
    } as any);

    const result = await fetchUniprotFeatures("Q6P0Q8");
    expect(result).toBeDefined();
    expect(result?.sequenceLength).toBe(1798);

    const kinaseDomain = result?.features.find(f => f.description === "Protein kinase");
    expect(kinaseDomain?.interproId).toBe("IPR000719");

    const agcDomain = result?.features.find(f => f.description === "AGC-kinase C-terminal");
    expect(agcDomain?.interproId).toBe("IPR000961");

    const pdzDomain = result?.features.find(f => f.description === "PDZ");
    expect(pdzDomain?.interproId).toBe("IPR001478");
  });
});

/**
 * UniProt ENTRY NAME -> accession conversion.
 *
 * Regression context: Ensembl's GRCh37 archive answers VEP's `swissprot` field with the entry NAME
 * (`INT11_HUMAN`) where the GRCh38 host answers the accession (`Q5TA45.162`), and that name reached
 * `validateUniProt` as if it were an accession — `422 Invalid UniProt accession ID format`.
 */
describe("UniProt entry-name resolution", () => {
  beforeEach(() => {
    clearAllCaches(true);
    vi.restoreAllMocks();
    // The suite above installs its own `global.fetch` directly, which `restoreAllMocks` cannot
    // undo — without a fresh mock here, spy history leaks between tests and call counts lie.
    global.fetch = vi.fn() as any;
  });

  it("recognises entry names without mistaking accessions for them", () => {
    // The underscore is what separates the two grammars — no accession contains one.
    expect(isUniprotEntryName("INT11_HUMAN")).toBe(true);
    expect(isUniprotEntryName(" A0A087WXT8_HUMAN ")).toBe(true);

    expect(isUniprotEntryName("Q5TA45")).toBe(false);
    expect(isUniprotEntryName("P04637-2")).toBe(false);
    expect(isUniprotEntryName("Q5TA45.162")).toBe(false);
    expect(isUniprotEntryName("ENSP00000445001.1")).toBe(false);
    expect(isUniprotEntryName("")).toBe(false);
    expect(isUniprotEntryName(undefined)).toBe(false);
  });

  it("converts an entry name to its accession via UniProt's exact `id:` query", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          {
            entryType: "UniProtKB reviewed (Swiss-Prot)",
            primaryAccession: "Q5TA45",
            uniProtkbId: "INT11_HUMAN",
          },
        ],
      }),
    } as any);

    await expect(resolveUniprotEntryNameToAccession("INT11_HUMAN")).resolves.toBe("Q5TA45");

    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain("rest.uniprot.org/uniprotkb/search");
    expect(decodeURIComponent(url)).toContain("id:INT11_HUMAN");
  });

  it("ignores a hit whose entry name is not the one asked for", async () => {
    // A differently-shaped payload must not attach a neighbouring entry's accession to this name.
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [{ primaryAccession: "P04637", uniProtkbId: "P53_HUMAN" }] }),
    } as any);

    await expect(resolveUniprotEntryNameToAccession("INT11_HUMAN")).resolves.toBeNull();
  });

  it("rejects an accession-shaped payload rather than forwarding it unvalidated", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [{ primaryAccession: "not-an-accession", uniProtkbId: "INT11_HUMAN" }] }),
    } as any);

    await expect(resolveUniprotEntryNameToAccession("INT11_HUMAN")).resolves.toBeNull();
  });

  it("does not query UniProt for a value that is already an accession", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");

    await expect(resolveUniprotEntryNameToAccession("Q5TA45")).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("surfaces a provider failure to the caller instead of reporting 'no such entry'", async () => {
    // "UniProt is unavailable" and "UniProt has no such name" must not collapse into one value:
    // the caller degrades either way, but only the second is safe to cache.
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "service unavailable",
      json: async () => ({}),
    } as any);

    await expect(resolveUniprotEntryNameToAccession("INT11_HUMAN")).rejects.toThrow(/503/);
  });
});

/**
 * Entry reference data: the current gene symbol and per-transcript isoform assignment.
 *
 * This is what repairs Ensembl's GRCh37 archive payloads, which state neither
 * (`gene_symbol: "CPSF3L"` — retired — and no `uniprot_isoform`).
 */
describe("UniProt entry reference data", () => {
  beforeEach(() => {
    clearAllCaches(true);
    vi.restoreAllMocks();
    global.fetch = vi.fn() as any;
  });

  /** `GET /uniprotkb/Q5TA45.json?fields=xref_ensembl,gene_primary,gene_synonym`, verbatim. */
  const ENTRY_PAYLOAD = {
    genes: [
      { geneName: { value: "INTS11" }, synonyms: [{ value: "CPSF3L" }, { value: "RC68" }] },
    ],
    uniProtKBCrossReferences: [
      {
        database: "Ensembl",
        id: "ENST00000435064.6",
        properties: [{ key: "ProteinId", value: "ENSP00000413493.2" }],
        isoformId: "Q5TA45-1",
      },
      {
        database: "Ensembl",
        id: "ENST00000540437.5",
        properties: [{ key: "ProteinId", value: "ENSP00000445001.1" }],
        isoformId: "Q5TA45-5",
      },
      // A neighbouring entry's isoform: must never be attached to this accession.
      {
        database: "Ensembl",
        id: "ENST00000224051",
        properties: [{ key: "ProteinId", value: "ENSP00000224051.1" }],
        isoformId: "Q8N5G0-2",
      },
    ],
  };

  it("reads the current symbol, its synonyms and the per-transcript isoforms, versionless", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ENTRY_PAYLOAD,
    } as any);

    const data = await fetchUniprotEntryReferenceData("Q5TA45");

    expect(data.geneSymbol).toBe("INTS11");
    expect(data.geneSymbols).toEqual(["INTS11", "CPSF3L", "RC68"]);
    // Versions are stripped on both sides: the provider writes `ENST00000540437.1` and UniProt
    // `ENST00000540437.5`, so a literal comparison would never match.
    expect(data.isoforms).toEqual([
      { transcriptId: "ENST00000435064", proteinId: "ENSP00000413493", isoformId: "Q5TA45-1" },
      { transcriptId: "ENST00000540437", proteinId: "ENSP00000445001", isoformId: "Q5TA45-5" },
    ]);
  });

  it("reports a definitive miss for an accession UniProt does not know", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "not found",
      json: async () => ({}),
    } as any);

    await expect(fetchUniprotEntryReferenceData("Q00000")).resolves.toEqual({
      geneSymbols: [],
      isoforms: [],
    });
  });

  it("throws on a provider failure so the caller keeps the answer and discloses the gap", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "service unavailable",
      json: async () => ({}),
    } as any);

    await expect(fetchUniprotEntryReferenceData("Q5TA45")).rejects.toThrow(/503/);
  });
});
