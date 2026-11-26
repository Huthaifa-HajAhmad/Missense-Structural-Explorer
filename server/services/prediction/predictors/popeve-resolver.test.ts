/**
 * popEVE publishes one protein per gene, and it is not always UniProt's main isoform. ABCG1 is the
 * case that showed it: P45844's main isoform is NP_004906.3, popEVE scores only NP_997057.1 (isoform
 * 2, 11 residues longer at the start), and Gly358 there is Gly369. popEVE's own GRCh38 file confirms
 * it: chr21:42287987 G>A is `protein=NP_997057.1;mutant=G369R;popEVE=-3.032`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setBackoffScaleForTests, resetHostStateForTests } from "../../infra/http-client.ts";
import { popEveOnlineCache, refseqCache } from "../../infra/cache.ts";
import { parseSubstitution } from "./popeve-files.ts";
import { fetchPopEVEScoreOnline, parsePopEveInfo } from "./popeve-resolver.ts";

const respond = (body: unknown, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
const S3_MISSING = '<?xml version="1.0"?><Error><Code>AccessDenied</Code></Error>';

/** 40 residues, no repeated stretch, so every 21-residue window is unique. Residue 20 is G. */
const MAIN = "MACLMAAFSVKTWNDRYEHGIPQVSTLMCFAEKWRNDYHP";
/** Isoform 2: a different, longer start (11 residues more), then the same sequence. */
const ISO2 = "MRISLPRAPERDGGVS" + MAIN.slice(5);

/** popEVE's per-protein file: one row per possible substitution, numbered on that protein. */
function popEveCsv(seq: string, scores: Record<string, number>) {
  const rows = [...seq].map((wt, i) => `${wt}${i + 1}A,0.1,${scores[`${wt}${i + 1}A`] ?? ""}`);
  const extra = Object.entries(scores).filter(([k]) => !k.endsWith("A")).map(([k, v]) => `${k},0.1,${v}`);
  return ["mutant,gap frequency,popEVE", ...rows, ...extra].join("\n") + "\n";
}

function uniprot(displayedIsoform: string, sequence: string) {
  return {
    primaryAccession: "P45844",
    sequence: { value: sequence },
    uniProtKBCrossReferences: [
      { database: "RefSeq", id: "NP_004906.3", isoformId: "P45844-1" },
      { database: "RefSeq", id: "NP_997057.1", isoformId: "P45844-2" },
    ],
    comments: [{ isoforms: [{ isoformIds: [displayedIsoform], isoformSequenceStatus: "Displayed" }] }],
  };
}

function serve(files: Record<string, string>, entry = uniprot("P45844-1", MAIN)) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
    const url = String(input);
    if (url.includes("rest.uniprot.org")) return respond(entry);
    const id = url.match(/mutations\/(.+)\.csv$/)?.[1] ?? "";
    return id in files ? respond(files[id]) : respond(S3_MISSING, 403);
  });
}

beforeEach(() => {
  setBackoffScaleForTests(0);
  resetHostStateForTests();
  refseqCache.clear();
  popEveOnlineCache.clear();
  vi.restoreAllMocks();
});

describe("popEVE on another isoform", () => {
  it("scores ABCG1 Gly20Arg on the isoform popEVE publishes, renumbered and labelled", async () => {
    serve({ "NP_997057.1": popEveCsv(ISO2, { G31R: -3.032, G20R: -9.9 }) });
    const hit = await fetchPopEVEScoreOnline("P45844", "p.Gly20Arg");
    // G20R exists in that file too, but it is a different residue there: it must never be read.
    expect(hit).toEqual({ score: -3.032, protein: "NP_997057.1", substitution: "G31R", match: "other-isoform" });
  });

  it("gives no score when the residue's neighbourhood is not found exactly once", async () => {
    const changed = ISO2.slice(0, 28) + "W" + ISO2.slice(29);
    serve({ "NP_997057.1": popEveCsv(changed, { G31R: -3.032 }) });
    expect(await fetchPopEVEScoreOnline("P45844", "p.Gly20Arg")).toBeNull();
  });

  it("gives no score when the variant's wild-type residue is not the one at that position", async () => {
    serve({ "NP_997057.1": popEveCsv(ISO2, { G31R: -3.032 }) });
    expect(await fetchPopEVEScoreOnline("P45844", "p.Ala20Arg")).toBeNull();
  });

  it("stays on the main isoform's file when popEVE has one, even without a row for this change", async () => {
    const fetchSpy = serve({
      "NP_004906.3": popEveCsv(MAIN, { G20A: -2 }),
      "NP_997057.1": popEveCsv(ISO2, { G31R: -3.032 }),
    });
    expect(await fetchPopEVEScoreOnline("P45844", "p.Gly20Arg")).toBeNull();
    expect(fetchSpy.mock.calls.some(([u]) => String(u).includes("NP_997057.1"))).toBe(false);
  });

  it("reads the main isoform's own score with its source", async () => {
    serve({ "NP_004906.3": popEveCsv(MAIN, { G20R: -4.8 }) });
    expect(await fetchPopEVEScoreOnline("P45844", "G20R"))
      .toEqual({ score: -4.8, protein: "NP_004906.3", substitution: "G20R", match: "displayed" });
  });

  /** A third isoform, listed before the one that maps; its file shares nothing with residue 20. */
  const unrelated = "MPPPPPPPPPPKKKKKKKKKKEEEEEEEEEE";
  const threeIsoforms = () => {
    const entry = uniprot("P45844-1", MAIN);
    entry.uniProtKBCrossReferences.splice(1, 0, { database: "RefSeq", id: "NP_058198.2", isoformId: "P45844-4" });
    return entry;
  };

  it("tries every isoform popEVE has until one holds the residue", async () => {
    serve({ "NP_058198.2": popEveCsv(unrelated, {}), "NP_997057.1": popEveCsv(ISO2, { G31R: -3.032 }) }, threeIsoforms());
    expect(await fetchPopEVEScoreOnline("P45844", "p.Gly20Arg")).toMatchObject({ protein: "NP_997057.1", substitution: "G31R" });
  });

  it("does not remember a miss while one isoform's file is unanswered", async () => {
    const base = serve({ "NP_058198.2": popEveCsv(unrelated, {}) }, threeIsoforms()).getMockImplementation()!;
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) =>
      String(input).includes("NP_997057.1") ? respond("refused for another reason", 403) : base(input, init));
    expect(await fetchPopEVEScoreOnline("P45844", "p.Gly20Arg")).toBeNull();
    expect(popEveOnlineCache.has("P45844_p.Gly20Arg")).toBe(false);
  });

  it("does not remember a miss when the other isoforms could not be checked", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async input =>
      String(input).includes("rest.uniprot.org/uniprotkb/P45844.json?fields=xref_refseq,cc_alternative_products")
        ? respond(uniprot("P45844-1", MAIN))
        : String(input).includes("rest.uniprot.org") ? respond("busy", 503) : respond(S3_MISSING, 403));
    expect(await fetchPopEVEScoreOnline("P45844", "p.Gly20Arg")).toBeNull();
    expect(popEveOnlineCache.has("P45844_p.Gly20Arg")).toBe(false);
  });
});

describe("popEVE substitutions", () => {
  it("reads only a change between two of the 20 amino acids", async () => {
    expect(parseSubstitution("p.Arg175His")).toEqual({ wt: "R", pos: 175, alt: "H" });
    for (const other of ["p.Gly358Ter", "p.Gly358Xaa", "p.Gly358fs"]) expect(parseSubstitution(other)).toBeNull();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await fetchPopEVEScoreOnline("P45844", "p.Gly358Ter")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("popEVE's GRCh38 file", () => {
  it("reads the protein and substitution popEVE scored for a DNA change", () => {
    const info = "protein=NP_997057.1;gene=ABCG1;mutant=G369R;gap_frequency=0.497;popEVE=-3.032;pop-adjusted_EVE=-3.01";
    expect(parsePopEveInfo(info)).toEqual({ score: -3.032, protein: "NP_997057.1", substitution: "G369R", match: "dna" });
  });

  it("keeps a score from a slimmed file that dropped the protein", () => {
    expect(parsePopEveInfo("popEVE=-5.66")).toEqual({ score: -5.66, protein: null, substitution: null, match: "dna" });
    expect(parsePopEveInfo("gene=X")).toBeNull();
  });
});
