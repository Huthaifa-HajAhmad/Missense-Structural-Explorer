import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  buildProteinNumberingRemapWarning,
  resolveAccessionedProteinNotation,
  resolveGeneProteinNumbering,
} from "./protein-numbering.ts";
import { CoordinateResolutionError } from "./types.ts";
import { clearAllCaches } from "../infra/cache.ts";
import { resetHostStateForTests } from "../infra/http-client.ts";
import { ACOT9_CANONICAL, ACOT9_INSERTION, withInsertion } from "./__fixtures__/acot9.ts";

/**
 * A synthetic isoform pair with the same SHAPE as the production case (real ACOT9 sequence with a
 * 10-residue insertion after position 20), so a position in the isoform maps to a different
 * canonical index — here 31 -> 21 — while the letters around it coincide elsewhere.
 */
const CANONICAL = ACOT9_CANONICAL;
const ISOFORM_2 = withInsertion(ACOT9_CANONICAL, 20, ACOT9_INSERTION + "V");

const ISOFORM_FASTA = `>sp|P00001|TESTGENE_HUMAN Test protein\n${CANONICAL}\n>sp|P00001-2|TESTGENE_HUMAN Isoform 2\n${ISOFORM_2}\n`;

const REFSEQ_SEARCH = {
  results: [
    {
      primaryAccession: "P00001",
      uniProtKBCrossReferences: [
        {
          database: "RefSeq",
          id: "NP_000001.1",
          properties: [{ key: "NucleotideSequenceId", value: "NM_000001.2" }],
          isoformId: "P00001-2",
        },
      ],
      genes: [{ geneName: { value: "TESTGENE" } }],
    },
  ],
};

const jsonOk = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }) as any;
const fastaOk = (text: string) =>
  ({ ok: true, status: 200, json: async () => ({}), text: async () => text }) as any;

function installFetch(overrides?: { search?: unknown; fasta?: string | Error }) {
  return vi.spyOn(global, "fetch").mockImplementation(async (url: any) => {
    const target = String(url);
    if (target.includes("/uniprotkb/search")) {
      if (overrides?.search instanceof Error) throw overrides.search;
      return jsonOk(overrides?.search ?? REFSEQ_SEARCH);
    }
    if (target.includes("/uniprotkb/stream") || target.includes("includeIsoform")) {
      if (overrides?.fasta instanceof Error) throw overrides.fasta;
      return fastaOk(overrides?.fasta ?? ISOFORM_FASTA);
    }
    throw new Error(`unexpected fetch: ${target}`);
  });
}

describe("resolveAccessionedProteinNotation", () => {
  let fetchSpy: any;

  beforeEach(() => {
    clearAllCaches(true);
    resetHostStateForTests();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  it("resolves a RefSeq-qualified notation through UniProt's isoform model", async () => {
    fetchSpy = installFetch();

    const outcome = await resolveAccessionedProteinNotation({
      accession: "NP_000001.1",
      proteinNotation: "p.Gly59Ala",
    });

    expect(outcome.status).toBe("remapped");
    expect(outcome.canonicalAccession).toBe("P00001");
    expect(outcome.canonicalVariant).toBe("p.Gly49Ala");
    expect(outcome.basisId).toBe("P00001-2");
    expect(outcome.basisKind).toBe("isoform");
    expect(outcome.transcriptId).toBe("NM_000001.2");
    expect(outcome.geneSymbol).toBe("TESTGENE");

    const warning = buildProteinNumberingRemapWarning(outcome, "p.Gly59Ala");
    expect(warning).toContain("NP_000001.1");
    expect(warning).toContain("p.Gly49Ala");
    expect(warning).toContain("P00001");

    // The isoform set MUST come from the `stream` resolver: the single-entry
    // `/uniprotkb/{acc}.fasta` endpoint silently ignores `includeIsoform=true` and returns only
    // the canonical record, which made every isoform-numbered notation look unknown. The mocked
    // response cannot catch that, so the URL itself is pinned here.
    const isoformCall = fetchSpy.mock.calls.find((c: any[]) =>
      String(c[0]).includes("includeIsoform")
    );
    expect(isoformCall).toBeDefined();
    expect(String(isoformCall![0])).toContain("/uniprotkb/stream?query=accession:P00001");
    expect(String(isoformCall![0])).not.toContain(".fasta?includeIsoform");
  });

  it("accepts a UniProt isoform accession directly, with no RefSeq lookup", async () => {
    fetchSpy = installFetch();

    const outcome = await resolveAccessionedProteinNotation({
      accession: "P00001-2",
      proteinNotation: "p.Gly59Ala",
    });

    expect(outcome.status).toBe("remapped");
    expect(outcome.canonicalVariant).toBe("p.Gly49Ala");
    // Gene taken from the FASTA mnemonic, so this path needs no second call.
    expect(outcome.geneSymbol).toBe("TESTGENE");
    const searchCalls = fetchSpy.mock.calls.filter((c: any[]) => String(c[0]).includes("/search"));
    expect(searchCalls).toHaveLength(0);
  });

  it("reports canonical numbering without a remap when the accession IS the canonical protein", async () => {
    fetchSpy = installFetch();

    const outcome = await resolveAccessionedProteinNotation({
      accession: "P00001",
      proteinNotation: "p.Gly49Ala",
    });

    expect(outcome.status).toBe("canonical");
    expect(outcome.canonicalVariant).toBe("p.Gly49Ala");
    expect(buildProteinNumberingRemapWarning(outcome, "p.Gly49Ala")).toBeUndefined();
  });

  it("refuses when the declared protein does not carry the stated wild-type residue", async () => {
    fetchSpy = installFetch();

    const outcome = await resolveAccessionedProteinNotation({
      accession: "P00001-2",
      proteinNotation: "p.Lys59Ala",
    });

    expect(outcome.status).toBe("unresolved");
    expect(outcome.reason).toContain("P00001-2 has G at position 59");
  });

  it("refuses an accession UniProt does not know, and one with no such isoform", async () => {
    fetchSpy = installFetch({ search: { results: [] } });
    const unknownAccession = await resolveAccessionedProteinNotation({
      accession: "NP_999999.9",
      proteinNotation: "p.Gly59Ala",
    });
    expect(unknownAccession.status).toBe("unresolved");
    expect(unknownAccession.reason).toContain("no reviewed human entry");

    fetchSpy.mockRestore();
    fetchSpy = installFetch();
    const unknownIsoform = await resolveAccessionedProteinNotation({
      accession: "P00001-9",
      proteinNotation: "p.Gly49Ala",
    });
    expect(unknownIsoform.status).toBe("unresolved");
    expect(unknownIsoform.reason).toContain("does not list an isoform P00001-9");
  });

  it("surfaces a provider outage as an upstream-unavailable resolution error", async () => {
    fetchSpy = installFetch({ fasta: new Error("network down") });

    const error: any = await resolveAccessionedProteinNotation({
      accession: "P00001-2",
      proteinNotation: "p.Gly59Ala",
    }).catch((e) => e);

    expect(error).toBeInstanceOf(CoordinateResolutionError);
    expect(error.kind).toBe("upstream_unavailable");
    expect(error.message).toContain("protein-level substitution");
  });
});

describe("resolveGeneProteinNumbering (bare protein notation + gene)", () => {
  let fetchSpy: any;

  beforeEach(() => {
    clearAllCaches(true);
    resetHostStateForTests();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  it("identifies a MANE-numbered notation and returns the canonical equivalent", async () => {
    fetchSpy = installFetch();

    const outcome = await resolveGeneProteinNumbering({
      gene: "TESTGENE",
      notation: "p.Gly59Ala",
      canonicalAccession: "P00001",
    });

    expect(outcome?.status).toBe("remapped");
    expect(outcome?.canonicalVariant).toBe("p.Gly49Ala");
    expect(outcome?.basisId).toBe("P00001-2");
  });

  it("accepts a canonical notation whose canonical position matches", async () => {
    fetchSpy = installFetch();

    const outcome = await resolveGeneProteinNumbering({
      gene: "TESTGENE",
      notation: "p.Gly49Ala",
      canonicalAccession: "P00001",
    });

    expect(outcome?.status).toBe("canonical");
  });

  it("returns null (not an error) when UniProt cannot be reached, so callers keep working", async () => {
    fetchSpy = installFetch({ fasta: new Error("network down") });

    const outcome = await resolveGeneProteinNumbering({
      gene: "TESTGENE",
      notation: "p.Gly59Ala",
      canonicalAccession: "P00001",
    });

    expect(outcome).toBeNull();
  });
});
