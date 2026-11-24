import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveCoordinate } from "./coordinate-resolver.ts";
import { clearAllCaches } from "../infra/cache.ts";
import { resetHostStateForTests } from "../infra/http-client.ts";

/**
 * Intent: a UniProt entry with ONE isoform (PAH, HBB, SOD1, BRCA2) is never named in Ensembl VEP's
 * `uniprot_isoform`, and UniProt's own cross-references name no isoform either. The numbering is
 * proven instead by comparing sequences: the Ensembl protein VEP numbered the variant on must be
 * identical to a UniProt sequence. Only that comparison may turn the answer `canonical`; every
 * failure keeps it `unverified`, and only a proven answer is cached.
 */

const NOTATION = "NM_000277.3:c.1222C>T";
const ACCESSION = "P00439";
// Arg at position 8, as in the variant below.
const CANONICAL = "MSTAVLERGGGGGGAAAAAAAAAAAAAAAA";
const ENSP = "ENSP00000448059.1";

/** A second transcript, numbered on the canonical isoform as VEP states, reporting the same change. */
const CANONICAL_SIBLING = {
  transcript_id: "ENST00000906693",
  hgvsp: "ENSP00000576752.1:p.Arg8Trp",
  amino_acids: "R/W",
  gene_symbol: "PAH",
  uniprot_isoform: [ACCESSION],
  swissprot: [`${ACCESSION}.266`],
};

const vepPayload = (hgvsp = `${ENSP}:p.Arg8Trp`, withSibling = false) => [
  {
    seq_region_name: "12",
    start: 102840507,
    allele_string: "C/T",
    transcript_consequences: [
      {
        transcript_id: "ENST00000553106",
        canonical: 1,
        mane_select: "NM_000277.3",
        hgvsp,
        amino_acids: "R/W",
        gene_symbol: "PAH",
        swissprot: [`${ACCESSION}.266`],
      },
      ...(withSibling ? [CANONICAL_SIBLING] : []),
    ],
  },
];

/** UniProt states the Ensembl transcript but no isoform id, as it does for single-isoform entries. */
const UNIPROT_ENTRY = {
  genes: [{ geneName: { value: "PAH" } }],
  uniProtKBCrossReferences: [
    {
      database: "Ensembl",
      id: "ENST00000553106.6",
      properties: [{ key: "ProteinId", value: "ENSP00000448059.1" }],
    },
  ],
};

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as any;

const textResponse = (body: string) =>
  ({ ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body }) as any;

interface Upstream {
  hgvsp?: string;
  enspSequence?: string;
  enspVersion?: number;
  enspStatus?: number;
  uniprotFasta?: string;
  withSibling?: boolean;
}

function mockUpstream(options: Upstream = {}) {
  return vi.spyOn(global, "fetch").mockImplementation(async (input: any) => {
    const url = String(input);
    if (url.includes("/vep/")) return jsonResponse(vepPayload(options.hgvsp, options.withSibling));
    if (url.includes("/sequence/id/")) {
      if (options.enspStatus) return jsonResponse({ error: "down" }, options.enspStatus);
      return jsonResponse({ seq: options.enspSequence ?? CANONICAL, version: options.enspVersion ?? 1 });
    }
    if (url.includes("/uniprotkb/stream")) {
      return textResponse(options.uniprotFasta ?? `>sp|${ACCESSION}|PH4H_HUMAN Phenylalanine-4-hydroxylase\n${CANONICAL}\n`);
    }
    if (url.includes(`/uniprotkb/${ACCESSION}.json`)) return jsonResponse(UNIPROT_ENTRY);
    throw new Error(`unexpected request ${url}`);
  });
}

describe("numbering proof by sequence identity (single-isoform UniProt entries)", () => {
  let fetchSpy: any;

  beforeEach(() => {
    clearAllCaches(true);
    resetHostStateForTests();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  it("proves canonical numbering when the Ensembl protein is identical to the canonical sequence", async () => {
    fetchSpy = mockUpstream();

    const outcome = await resolveCoordinate(NOTATION, "GRCh38");

    expect(outcome.numbering?.status).toBe("canonical");
    expect(outcome.numbering?.canonicalAccession).toBe(ACCESSION);
    expect(outcome.numbering?.numberingIsoform).toBe(ACCESSION);
  });

  it("caches the proven answer, so the next request asks no provider", async () => {
    fetchSpy = mockUpstream();
    await resolveCoordinate(NOTATION, "GRCh38");
    const callsAfterFirst = fetchSpy.mock.calls.length;

    const second = await resolveCoordinate(NOTATION, "GRCh38");

    expect(second.cacheHit).toBe(true);
    expect(second.numbering?.status).toBe("canonical");
    expect(fetchSpy.mock.calls.length).toBe(callsAfterFirst);
  });

  it("stays unverified, and is not cached, when Ensembl cannot serve the protein sequence", async () => {
    fetchSpy = mockUpstream({ enspStatus: 503 });

    const outcome = await resolveCoordinate(NOTATION, "GRCh38");
    expect(outcome.numbering?.status).toBe("unverified");

    const second = await resolveCoordinate(NOTATION, "GRCh38");
    expect(second.cacheHit).toBe(false);
  });

  it("stays unverified when Ensembl serves a different version of the protein", async () => {
    fetchSpy = mockUpstream({ enspVersion: 2 });

    const outcome = await resolveCoordinate(NOTATION, "GRCh38");

    expect(outcome.numbering?.status).toBe("unverified");
  });

  it("stays unverified when the Ensembl protein differs from every UniProt sequence", async () => {
    // One extra residue near the start shifts every later position by one.
    fetchSpy = mockUpstream({ enspSequence: `MS${CANONICAL.slice(1)}` });

    const outcome = await resolveCoordinate(NOTATION, "GRCh38");

    expect(outcome.numbering?.status).toBe("unverified");
  });

  it("stays unverified when the stated wild-type residue is not at that position", async () => {
    fetchSpy = mockUpstream({ hgvsp: `${ENSP}:p.Arg9Trp` });

    const outcome = await resolveCoordinate(NOTATION, "GRCh38");

    expect(outcome.numbering?.status).toBe("unverified");
  });

  it("stays unverified when the protein matches only a non-canonical record labelled <accession>-1", async () => {
    // UniProt labels the displayed (canonical) sequence with the bare accession; when the canonical
    // is not isoform 1 (COL2A1), a separate record `<accession>-1` is NOT canonical. Naming that
    // record would read as canonical downstream, so only the bare canonical record counts.
    const isoformOne = `M${"A".repeat(6)}R${"G".repeat(30)}`;
    fetchSpy = mockUpstream({
      enspSequence: isoformOne,
      uniprotFasta:
        `>sp|${ACCESSION}|PH4H_HUMAN canonical\n${CANONICAL}\n` +
        `>sp|${ACCESSION}-1|PH4H_HUMAN Isoform 1\n${isoformOne}\n`,
    });

    const outcome = await resolveCoordinate(NOTATION, "GRCh38");

    expect(outcome.numbering?.status).toBe("unverified");
  });

  it("compares no sequence for an answer a canonical sibling already proves, fresh or cached", async () => {
    fetchSpy = mockUpstream({ withSibling: true });
    const first = await resolveCoordinate(NOTATION, "GRCh38");
    expect(first.numbering?.status).toBe("canonical");
    const sequenceCalls = () =>
      fetchSpy.mock.calls.filter((call: any[]) => String(call[0]).includes("/sequence/id/")).length;

    await resolveCoordinate(NOTATION, "GRCh38");
    await resolveCoordinate(NOTATION, "GRCh38");

    expect(sequenceCalls()).toBe(0);
  });

  it("stays unverified when the protein id carries no version, since the version pins the sequence", async () => {
    fetchSpy = mockUpstream({ hgvsp: "ENSP00000448059:p.Arg8Trp" });

    const outcome = await resolveCoordinate(NOTATION, "GRCh38");

    expect(outcome.numbering?.status).toBe("unverified");
  });
});
