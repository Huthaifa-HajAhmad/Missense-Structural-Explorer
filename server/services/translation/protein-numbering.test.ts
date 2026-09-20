import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  buildProteinNumberingRemapWarning,
  resolveAccessionedProteinNotation,
  resolveGeneProteinNumbering,
  withNumberingBudget,
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

function installFetch(overrides?: {
  search?: unknown;
  fasta?: string | Error;
  mane?: { proteinId: string; isoformId?: string } | Error;
}) {
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
    // The MANE lookup reads the FULL entry (`fields=xref_mane_select` is rejected with HTTP 400).
    if (target.includes(".json")) {
      if (overrides?.mane instanceof Error) throw overrides.mane;
      return jsonOk(
        overrides?.mane
          ? {
              uniProtKBCrossReferences: [
                {
                  database: "MANE-Select",
                  id: "ENST00000000001.1",
                  ...(overrides.mane.isoformId ? { isoformId: overrides.mane.isoformId } : {}),
                  properties: [{ key: "RefSeqProteinId", value: overrides.mane.proteinId }],
                },
              ],
            }
          : { uniProtKBCrossReferences: [] }
      );
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
    expect(unknownAccession.reason).toContain("no entry cross-referenced");
    expect(unknownAccession.reason).toContain("reviewed, human");

    fetchSpy.mockRestore();
    fetchSpy = installFetch();
    const unknownIsoform = await resolveAccessionedProteinNotation({
      accession: "P00001-9",
      proteinNotation: "p.Gly49Ala",
    });
    // UNVERIFIED, not unresolved: nothing establishes the numbering, so the caller must refuse
    // rather than convert — and must not be told the protein simply lacks that residue.
    expect(unknownIsoform.status).toBe("unverified");
    expect(unknownIsoform.reason).toContain("lists no isoform P00001-9");
  });

  /**
   * Regressions from the review panel, each demonstrated live against the previous version:
   *   - `<acc>-1` is how UniProt writes the CANONICAL isoform (measured: ~15 of 70 RefSeq xrefs,
   *     and 59 of 130 sampled MANE proteins). Comparing it literally refused the
   *     canonical-numbered notation — the one case needing no conversion — with a false "no such
   *     isoform" claim (CFTR `NP_000483.3` was the reported example).
   *   - a RefSeq record with NO isoformId was assumed canonical, so an isoform-numbered position
   *     was applied to the canonical sequence whenever the letters coincided (RHOT1
   *     `NP_001028739.2`: isoform 4, 491 aa, against 618 aa canonical) and reported as verified.
   */
  it("treats a `<acc>-1` declared isoform as the canonical sequence", async () => {
    fetchSpy = installFetch({
      search: {
        results: [
          {
            primaryAccession: "P00001",
            uniProtKBCrossReferences: [
              {
                database: "RefSeq",
                id: "NP_000001.1",
                properties: [{ key: "NucleotideSequenceId", value: "NM_000001.2" }],
                isoformId: "P00001-1",
              },
            ],
            genes: [{ geneName: { value: "TESTGENE" } }],
          },
        ],
      },
    });

    const outcome = await resolveAccessionedProteinNotation({
      accession: "NP_000001.1",
      proteinNotation: "p.Gly49Ala",
    });

    expect(outcome.status).toBe("canonical");
    expect(outcome.canonicalVariant).toBe("p.Gly49Ala");
    expect(outcome.basisId).toBe("P00001");
  });

  it("REFUSES a RefSeq record with no isoformId instead of assuming canonical", async () => {
    fetchSpy = installFetch({
      search: {
        results: [
          {
            primaryAccession: "P00001",
            uniProtKBCrossReferences: [{ database: "RefSeq", id: "NP_000001.1", properties: [] }],
            genes: [{ geneName: { value: "TESTGENE" } }],
          },
        ],
      },
    });

    const outcome = await resolveAccessionedProteinNotation({
      accession: "NP_000001.1",
      proteinNotation: "p.Gly61Ala",
    });

    // Never a canonical 200: without the isoformId nothing ties those numbers to a protein.
    expect(outcome.status).toBe("unverified");
    expect(outcome.reason).toContain("does not state which isoform");
  });

  it("filters the RefSeq search to reviewed human entries", async () => {
    fetchSpy = installFetch();
    await resolveAccessionedProteinNotation({
      accession: "NP_000001.1",
      proteinNotation: "p.Gly59Ala",
    });

    const searchCall = fetchSpy.mock.calls.find((c: any[]) =>
      String(c[0]).includes("/uniprotkb/search")
    );
    expect(searchCall).toBeDefined();
    // Without both filters the first ranked hit is frequently an unreviewed TrEMBL record
    // (measured: 9 of 12 sampled accessions), and the caller would number against that protein.
    expect(String(searchCall![0])).toContain("reviewed:true");
    expect(String(searchCall![0])).toContain("organism_id:9606");
  });

  it("reports a FAILED RefSeq lookup as upstream-unavailable, and caches no verdict", async () => {
    fetchSpy = installFetch({ search: new Error("network down") });

    const error: any = await resolveAccessionedProteinNotation({
      accession: "NP_000001.1",
      proteinNotation: "p.Gly59Ala",
    }).catch((e) => e);
    expect(error).toBeInstanceOf(CoordinateResolutionError);
    expect(error.kind).toBe("upstream_unavailable");

    // The failure must not have been stored as "this accession does not exist": with the provider
    // healthy again the same accession must resolve (previously a 30-day L1+L2 poison).
    fetchSpy.mockRestore();
    fetchSpy = installFetch();
    const recovered = await resolveAccessionedProteinNotation({
      accession: "NP_000001.1",
      proteinNotation: "p.Gly59Ala",
    });
    expect(recovered.status).toBe("remapped");
    expect(recovered.canonicalVariant).toBe("p.Gly49Ala");
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

describe("analysis-path verification bounds", () => {
  let fetchSpy: any;

  beforeEach(() => {
    clearAllCaches(true);
    resetHostStateForTests();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  it("gives a verification lookup a budget instead of letting it dominate the request", async () => {
    // Unbounded, a UniProt outage cost up to ~110s BEFORE the analysis started (the isoform fetch
    // retries 3x20s, then the MANE fetch 3x15s). The lookup is advisory, so it must yield.
    const never = new Promise<string>(() => {});
    const startedAt = Date.now();

    const result = await withNumberingBudget(never, 40);

    expect(result).toBeNull();
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it("scopes to MANE even when UniProt spells the canonical isoform `<acc>-1`", async () => {
    // The MANE xref states `P00001-1` while the FASTA labels canonical as the bare accession, so a
    // literal comparison matched nothing and silently skipped the scoping — restoring the 14.8%
    // over-refusal (versus 3.4% for the canonical-vs-MANE pair) on exactly the entries where that
    // spelling is most likely.
    const shifted = withInsertion(ACOT9_CANONICAL, 20, ACOT9_INSERTION); // 9-residue insertion
    const other = withInsertion(ACOT9_CANONICAL, 20, `${ACOT9_INSERTION}V`); // 10-residue insertion
    fetchSpy = installFetch({
      fasta:
        `>sp|P00001|TESTGENE_HUMAN\n${ACOT9_CANONICAL}\n` +
        `>sp|P00001-2|TESTGENE_HUMAN Isoform 2\n${shifted}\n` +
        `>sp|P00001-3|TESTGENE_HUMAN Isoform 3\n${other}\n`,
      mane: { proteinId: "NP_000001.1", isoformId: "P00001-1" },
    });

    // Position 64 collides between canonical and the 9-residue-shifted isoform (the same letter at
    // two positions), so WITHOUT the scoping this resolves as ambiguous and is refused.
    const outcome = await resolveGeneProteinNumbering({
      gene: "TESTGENE",
      notation: "p.Arg64Ala",
      canonicalAccession: "P00001",
      basisScope: "mane",
    });

    expect(outcome?.status).toBe("canonical");
    expect(outcome?.canonicalVariant).toBe("p.Arg64Ala");
  });
});
