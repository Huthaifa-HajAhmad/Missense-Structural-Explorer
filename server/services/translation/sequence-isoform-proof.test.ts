import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveCoordinate } from "./coordinate-resolver.ts";
import { isCanonicalBySequence } from "./sequence-isoform-proof.ts";
import { fetchUniprotSequence } from "../external-api/uniprot.ts";
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

const vepPayload = (
  hgvsp = `${ENSP}:p.Arg8Trp`,
  withSibling = false,
  overrides: { amino_acids?: string; swissprot?: string[] } = {}
) => [
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
        amino_acids: overrides.amino_acids ?? "R/W",
        gene_symbol: "PAH",
        swissprot: overrides.swissprot ?? [`${ACCESSION}.266`],
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
  /** The canonical sequence UniProt serves for the accession. */
  canonicalSequence?: string;
  withSibling?: boolean;
  aminoAcids?: string;
  swissprot?: string[];
}

function mockUpstream(options: Upstream = {}) {
  return vi.spyOn(global, "fetch").mockImplementation(async (input: any) => {
    const url = String(input);
    if (url.includes("/vep/")) return jsonResponse(
        vepPayload(options.hgvsp, options.withSibling, {
          amino_acids: options.aminoAcids,
          swissprot: options.swissprot,
        })
      );
    if (url.includes("/sequence/id/")) {
      if (options.enspStatus) return jsonResponse({ error: "down" }, options.enspStatus);
      return jsonResponse({ seq: options.enspSequence ?? CANONICAL, version: options.enspVersion ?? 1 });
    }
    // Serves an isoform-qualified accession too, so a guard against one is what makes the difference.
    if (/\/uniprotkb\/P00439(-\d+)?\.fasta/.test(url)) {
      return textResponse(
        `>sp|${ACCESSION}|PH4H_HUMAN Phenylalanine-4-hydroxylase\n${options.canonicalSequence ?? CANONICAL}\n`
      );
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
    // Same residue at the stated position (Arg 8), but the last residue differs: only the full
    // comparison can tell the two proteins apart.
    fetchSpy = mockUpstream({ enspSequence: `${CANONICAL.slice(0, -1)}W` });

    const outcome = await resolveCoordinate(NOTATION, "GRCh38");

    expect(outcome.numbering?.status).toBe("unverified");
  });

  it("stays unverified when the stated wild-type residue is not at that position", async () => {
    fetchSpy = mockUpstream({ hgvsp: `${ENSP}:p.Arg9Trp` });

    const outcome = await resolveCoordinate(NOTATION, "GRCh38");

    expect(outcome.numbering?.status).toBe("unverified");
  });

  it("stays unverified when the protein is another isoform, even one UniProt labels <accession>-1", async () => {
    // When the canonical is not isoform 1 (COL2A1), `<accession>-1` is a different protein. Only the
    // canonical sequence is ever compared, so a protein equal to isoform 1 proves nothing.
    const isoformOne = `M${"A".repeat(6)}R${"G".repeat(30)}`;
    fetchSpy = mockUpstream({ enspSequence: isoformOne });

    const outcome = await resolveCoordinate(NOTATION, "GRCh38");

    expect(outcome.numbering?.status).toBe("unverified");
  });

  it.each([
    ["amino_acids names another wild-type than the notation", `${ENSP}:p.Lys8Trp`, "R/W"],
    ["amino_acids names another substitution than the notation", `${ENSP}:p.Arg8Trp`, "K/W"],
  ])("stays unverified when %s", async (_name, hgvsp, aminoAcids) => {
    // The signed proof is made from the notation, so the notation itself must be what was checked.
    fetchSpy = mockUpstream({ hgvsp, aminoAcids });

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

describe("the sequence proof never cancels a lookup other requests share", () => {
  beforeEach(() => {
    clearAllCaches(true);
    resetHostStateForTests();
    vi.restoreAllMocks();
  });

  const consequence = {
    transcript_id: "ENST00000553106",
    hgvsp: `${ENSP}:p.Arg8Trp`,
    amino_acids: "R/W",
    swissprot: [`${ACCESSION}.266`],
  } as any;

  it("stops waiting when the caller gives up, and leaves the shared UniProt fetch running", async () => {
    let uniprotSignal: AbortSignal | undefined;
    let finishUniprot: (response: any) => void = () => {};
    vi.spyOn(global, "fetch").mockImplementation((async (input: any, init?: any) => {
      const url = String(input);
      if (url.includes("/sequence/id/")) return jsonResponse({ seq: CANONICAL, version: 1 });
      uniprotSignal = init?.signal;
      return new Promise((resolve) => (finishUniprot = resolve));
    }) as any);

    const caller = new AbortController();
    const proof = isCanonicalBySequence(consequence, ACCESSION, caller.signal);
    await new Promise((resolve) => setTimeout(resolve, 20));
    caller.abort();

    await expect(proof).resolves.toBe(false);
    expect(uniprotSignal?.aborted).toBe(false);

    // Another request joining the same fetch still gets the sequence.
    const joined = fetchUniprotSequence(ACCESSION);
    finishUniprot(textResponse(`>sp|${ACCESSION}|PH4H_HUMAN x\n${CANONICAL}\n`));
    await expect(joined).resolves.toBe(CANONICAL);
  });

  it("refuses an accession that names an isoform, even when its sequence matches", async () => {
    // The caller passes an entry accession; an isoform id would let a non-canonical sequence pass.
    vi.spyOn(global, "fetch").mockImplementation((async (input: any) =>
      String(input).includes("/sequence/id/")
        ? jsonResponse({ seq: CANONICAL, version: 1 })
        : textResponse(`>sp|${ACCESSION}-4|PH4H_HUMAN x\n${CANONICAL}\n`)) as any);

    await expect(isCanonicalBySequence(consequence, `${ACCESSION}-4`)).resolves.toBe(false);
    await expect(isCanonicalBySequence(consequence, ACCESSION)).resolves.toBe(true);
  });
});
