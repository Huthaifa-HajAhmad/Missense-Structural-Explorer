import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AMINO_ACID_1_TO_3_TITLE } from "../../../src/shared/aminoAcids.ts";
import { hotspotContextSchema } from "../../../src/shared/hotspotEvidence.ts";

/**
 * The server half of the Hotspots view, with its network and compute edges replaced: the residue sets every rung
 * reads, the numbering gate, each rung's state, what is cached, and what is memoized. SOD1 is the protein
 * throughout; its AlphaFold DB model (tools/structure-focus/sod1-afdb.pdb) gives real coordinates and a real sequence,
 * and the ClinVar and gnomAD rows are built from that sequence so each rule is exercised on a known answer.
 */
const { rows, cspec, perRegions, alphafold, worker, sasa, http } = vi.hoisted(() => ({
  rows: vi.fn(), cspec: vi.fn(), perRegions: vi.fn(), alphafold: vi.fn(), worker: vi.fn(), sasa: vi.fn(), http: vi.fn(),
}));
vi.mock("../prediction/landscape-context.ts", async (original) => ({
  ...(await original<typeof import("../prediction/landscape-context.ts")>()),
  fetchGeneMissenseRows: rows,
  fetchLandscapeContext: vi.fn(async () => ({ regionsStatus: "none", regions: [], errors: [] })),
}));
vi.mock("./cspec.ts", () => ({ loadCspecPm1: cspec }));
vi.mock("./perRegions.ts", () => ({ loadPerRegions: perRegions }));
vi.mock("../structure/structure-fetcher.ts", () => ({ fetchAlphafoldPdb: alphafold, getResolvedAlphafoldVersion: () => "v6" }));
vi.mock("../stability/biophysics-pool.ts", () => ({ runSpatialClusteringInWorker: worker }));
vi.mock("../structure/sasa-runner.ts", () => ({ executeSasaAll: sasa }));
vi.mock("../infra/http-client.ts", async (original) => ({ ...(await original<typeof import("../infra/http-client.ts")>()), fetchWithRetry: http }));

import { checkNumbering, referenceSets } from "./hotspots.ts";

const PDB = readFileSync(new URL("../../../tools/structure-focus/sod1-afdb.pdb", import.meta.url), "utf8");
const SEQ = "MATKAVCVLKGDGPVQGIINFEQKESNGPVKVWGSIKGLTEGLHGFHVHEFGDNTAGCTSAGPHFNPLSRKHGGPKDEERHVGDLGNVTADKDGVADVSIEDSVISLSGDHCIIGRTLVVHEKADDLGKGGNEESTKTGNAGSRLACGVIGIAQ";
const CANONICAL = "ENST00000270142.11";

/** "p.Ala5Val" for position 5 of SOD1 and a chosen alternative; `wrongRef` swaps the reference residue. */
const hgvsp = (pos: number, alt: string, wrongRef?: string) => `p.${AMINO_ACID_1_TO_3_TITLE[wrongRef ?? SEQ[pos - 1]]}${pos}${AMINO_ACID_1_TO_3_TITLE[alt]}`;
const clinvar = (id: string, pos: number, alt: string, significance: string, stars: number | null, extra: object = {}) =>
  ({ variant_id: id, clinical_significance: significance, gold_stars: stars, hgvsp: hgvsp(pos, alt), transcript_id: CANONICAL, ...extra });
const gnomad = (id: string, pos: number, alt: string, exome: { ac: number; filters?: string[] } | null, extra: object = {}) =>
  ({ variant_id: id, consequence: "missense_variant", hgvsp: hgvsp(pos, alt), transcript_id: CANONICAL, exome: exome && { filters: [], ...exome }, genome: null, ...extra });

const CLINVAR = [
  clinvar("c-a5v", 5, "V", "Pathogenic", 2),
  clinvar("c-a5t", 5, "T", "Likely pathogenic", 1),
  clinvar("c-g94r", 94, "R", "Pathogenic/Likely pathogenic", 0),
  clinvar("c-l39v", 39, "V", "Conflicting classifications of pathogenicity", 1),
  clinvar("c-d125h", 125, "H", "Benign", 2),
  ...[7, 10, 14, 21, 38, 41, 44, 50].map((p) => clinvar(`c-${p}`, p, "A", "Pathogenic", 1)),
  clinvar("c-other-tx", 60, "A", "Pathogenic", 3, { transcript_id: "ENST00000999999.1" }),
  { ...clinvar("c-syn", 5, "A", "Pathogenic", 3), hgvsp: "p.Ala5=" },
];
const GNOMAD = [
  gnomad("g-a5t", 5, "T", { ac: 3 }),
  gnomad("c-g94r", 94, "R", { ac: 2 }),
  gnomad("c-l39v", 39, "V", { ac: 4 }),
  gnomad("g-filtered", 20, "A", { ac: 5, filters: ["AC0"] }),
  gnomad("g-zero", 30, "A", { ac: 0 }),
  gnomad("g-synonymous", 31, "A", { ac: 9 }, { consequence: "synonymous_variant" }),
  gnomad("g-other-tx", 33, "A", { ac: 9 }, { transcript_id: "ENST00000999999.1" }),
  ...[60, 70, 80, 90, 100, 110, 120, 130].map((p) => gnomad(`g-${p}`, p, "A", { ac: 6 })),
];
const settled = (value: unknown) => ({ status: "fulfilled" as const, value });
const answered = () => [settled({ canonical_transcript_id: CANONICAL, clinvar_variants: CLINVAR }), settled({ canonical_transcript_id: CANONICAL, variants: GNOMAD })];

describe("referenceSets — which residues each rung reads", () => {
  const sets = referenceSets(CLINVAR, GNOMAD, CANONICAL);

  it("takes ClinVar germline P/LP missense per residue, counting changes and the best review status", () => {
    expect([...sets.plp.keys()].sort((a, b) => a - b)).toEqual([5, 7, 10, 14, 21, 38, 41, 44, 50, 94]);
    expect(sets.plp.get(5)).toEqual({ n: 2, maxStars: 2, changes: ["p.Ala5Val", "p.Ala5Thr"] });
  });

  it("leaves a conflicting record out of P, and a benign one in its own count", () => {
    expect(sets.plp.has(39)).toBe(false);
    expect(sets.blb.get(125)).toBe(1);
  });

  it("gives the 3D reading only residues with at least one review star", () => {
    expect(sets.plpStarred.has(5)).toBe(true);
    expect(sets.plpStarred.has(94)).toBe(false); // zero stars: in the table and the PER test, not in the benchmark's P set
  });

  it("ignores another transcript's rows and non-missense changes, in both sources", () => {
    expect(sets.plp.has(60)).toBe(false);
    expect([...sets.gn.keys()]).not.toContain(31);
    expect([...sets.gn.keys()]).not.toContain(33);
  });

  it("counts a gnomAD variant as observed only with AC > 0, and as counted only when no filter flag is set", () => {
    expect(sets.gn.get(20)).toEqual({ variants: 1, pass: 0 }); // seen, but only with a filter flag
    expect(sets.gn.has(30)).toBe(false); // AC 0
    expect(sets.populationAll.has(20)).toBe(false);
    expect(sets.populationAll.has(5)).toBe(true);
  });

  it("keeps ClinVar P/LP and conflicting variants out of the neutral set, but not out of the PER paper's population set", () => {
    expect(sets.populationAll.has(94)).toBe(true);
    expect(sets.neutral.has(94)).toBe(false); // the same variant is ClinVar P/LP
    expect(sets.populationAll.has(39)).toBe(true);
    expect(sets.neutral.has(39)).toBe(false); // conflicting
    expect(sets.neutral.has(5)).toBe(true); // a different allele at a P/LP residue stays neutral evidence
  });

  it("records the reference residue of every row it reads, for the numbering check", () => {
    expect(sets.refAt.get(5)).toBe("A");
    expect(sets.refAt.get(94)).toBe("G");
  });

  it("gives empty sets for a failed read, never a measured zero", () => {
    expect(referenceSets(null, null, CANONICAL).plp.size).toBe(0);
  });
});

describe("checkNumbering", () => {
  const model = new Map([...SEQ].map((aa, i) => [i + 1, aa] as [number, string]));
  it("verifies when every reference residue sits where the model has it", () => {
    expect(checkNumbering(referenceSets(CLINVAR, GNOMAD, CANONICAL).refAt, model)).toMatchObject({ status: "verified", mismatches: 0 });
  });
  it("reports a mismatch on one wrong reference residue, with the count", () => {
    const bad = referenceSets([...CLINVAR, { ...clinvar("c-bad", 50, "A", "Pathogenic", 1), hgvsp: hgvsp(50, "A", "W") }], GNOMAD, CANONICAL);
    expect(checkNumbering(bad.refAt, model)).toMatchObject({ status: "mismatch", mismatches: 1 });
  });
  it("says unchecked, not verified, without a model", () => {
    expect(checkNumbering(new Map([[5, "A"]]), null)).toEqual({ status: "unchecked", checked: 0, mismatches: 0 });
  });
});

describe("loadHotspotContext — the assembled answer", () => {
  // A fresh module per test: the answer cache and the memo of the two expensive computations are module state, and
  // identical inputs across tests would otherwise be served from the previous test's work.
  let loadHotspotContext: typeof import("./hotspots.ts").loadHotspotContext;
  let n = 0;
  const gene = () => `SOD1T${n++}`;
  const clustered = { structureResidues: 154, pathogenicResidues: 9, neutralResidues: 8, permutations: 2000, univariate: { area: 1, p: 0.001 }, bivariate: { area: 2, p: 0.002 }, clustered: true, threshold: 9.5, scores: [[5, 0.1], [7, -0.2]], selfCheck: null };

  beforeEach(async () => {
    vi.resetModules();
    ({ loadHotspotContext } = await import("./hotspots.ts"));
    vi.clearAllMocks();
    rows.mockResolvedValue(answered());
    cspec.mockResolvedValue({ status: "none", reason: "No specification lists SOD1.", sourceUrl: "https://cspec.genome.network/", retrievedAt: "2026-10-29T00:00:00Z", specs: [] });
    perRegions.mockReturnValue({ source: {}, regions: [] });
    alphafold.mockResolvedValue(PDB);
    worker.mockResolvedValue(clustered);
    sasa.mockResolvedValue({ status: "success", residues: [{ resId: 5, resName: "ALA", rsa: 0.0166 }, { resId: 7, resName: "CYS", rsa: 0 }, { resId: 60, resName: "GLY", rsa: 0.5 }] });
    http.mockResolvedValue({ status: 200, body: { cancel: async () => {} } });
  });

  it("returns a schema-valid answer: the distribution, six rungs' data, numbering verified, accessibility for P/LP residues only", async () => {
    const ctx = hotspotContextSchema.parse(await loadHotspotContext(gene(), { uniprot: "P00441" }));
    expect(ctx.numbering).toMatchObject({ status: "verified", mismatches: 0 });
    expect(ctx.distribution.plp.map((p) => p.pos)).toEqual([5, 7, 10, 14, 21, 38, 41, 44, 50, 94]);
    expect(ctx.accessibility).toMatchObject({ status: "ok", values: [[5, 0.0166], [7, 0]] }); // residue 60 is not a P/LP residue here
    expect(ctx.spatial).toMatchObject({ status: "ok", model: { entryId: "AF-P00441-F1", version: "v6" } });
    expect(ctx.perRerun.status).toBe("ok");
    expect(sasa).toHaveBeenCalledWith(PDB, "A");
  });

  it("runs the 3D statistic on the benchmark's sets: starred P/LP residues and neutral gnomAD residues in the confident model", async () => {
    await loadHotspotContext(gene(), { uniprot: "P00441" });
    const input = worker.mock.calls[0][0];
    expect(input.pathogenic.sort((a: number, b: number) => a - b)).toEqual([5, 7, 10, 14, 21, 38, 41, 44, 50]); // 94 has no review star
    expect(input.neutral).toContain(5);
    expect(input.neutral).not.toContain(94);
  });

  it("withholds every position-dependent rung on a numbering mismatch and spends no compute on them", async () => {
    rows.mockResolvedValue([settled({ canonical_transcript_id: CANONICAL, clinvar_variants: [...CLINVAR, { ...clinvar("c-bad", 50, "A", "Pathogenic", 1), hgvsp: hgvsp(50, "A", "W") }] }), settled({ canonical_transcript_id: CANONICAL, variants: GNOMAD })]);
    const ctx = hotspotContextSchema.parse(await loadHotspotContext(gene(), { uniprot: "P00441" }));
    expect(ctx.numbering.status).toBe("mismatch");
    expect(ctx.spatial.status).toBe("numbering-mismatch");
    expect(ctx.perRerun.status).toBe("unavailable");
    expect(ctx.accessibility.status).toBe("numbering-mismatch");
    expect(worker).not.toHaveBeenCalled();
    expect(sasa).not.toHaveBeenCalled();
  });

  it("says no model only when AlphaFold DB answers 404, and a provider error for anything else", async () => {
    alphafold.mockResolvedValue(null);
    http.mockResolvedValue({ status: 404, body: { cancel: async () => {} } });
    const absent = hotspotContextSchema.parse(await loadHotspotContext(gene(), { uniprot: "P00441" }));
    expect(absent.spatial.status).toBe("no-model");
    expect(absent.accessibility.status).toBe("no-model");
    expect(absent.errors).toEqual([]);

    http.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const unreachable = hotspotContextSchema.parse(await loadHotspotContext(gene(), { uniprot: "P00441" }));
    expect(unreachable.spatial.status).toBe("error");
    expect(unreachable.accessibility.status).toBe("unavailable");
    expect(unreachable.errors.join(" ")).toMatch(/AlphaFold DB model could not be read/);
  });

  it("reports a failed ClinVar/gnomAD read as unavailable rungs, never as empty variant lists", async () => {
    rows.mockResolvedValue([{ status: "rejected", reason: new Error("gnomAD API 503") }, { status: "rejected", reason: new Error("gnomAD API 503") }]);
    const ctx = hotspotContextSchema.parse(await loadHotspotContext(gene(), { uniprot: "P00441" }));
    expect(ctx.distribution).toMatchObject({ status: "unavailable" });
    expect(ctx.perRerun.status).toBe("unavailable");
    expect(ctx.spatial.status).toBe("error");
    expect(worker).not.toHaveBeenCalled();
  });

  it("does not show the 3D score when the clustering gate fails, and says why", async () => {
    worker.mockResolvedValue({ ...clustered, clustered: false, scores: [] });
    const ctx = hotspotContextSchema.parse(await loadHotspotContext(gene(), { uniprot: "P00441" }));
    expect(ctx.spatial).toMatchObject({ status: "not-clustered", scores: [] });
    expect(ctx.spatial.reason).toMatch(/pre-registered condition/);
  });

  it("reports a degenerate distance grid as an error about the model, not as 'too few variants'", async () => {
    worker.mockResolvedValue(null);
    const ctx = hotspotContextSchema.parse(await loadHotspotContext(gene(), { uniprot: "P00441" }));
    expect(ctx.spatial.status).toBe("error");
    expect(ctx.spatial.reason).toMatch(/degenerate/);
  });

  it("answers model-free rungs without a UniProt accession", async () => {
    const ctx = hotspotContextSchema.parse(await loadHotspotContext(gene(), {}));
    expect(ctx.spatial.status).toBe("no-model");
    expect(ctx.distribution.status).toBe("ok");
    expect(alphafold).not.toHaveBeenCalled();
  });

  it("degrades a missing published-region table to its own rung, not a rejected request", async () => {
    perRegions.mockImplementation(() => { throw new Error("ENOENT per-regions.json.gz"); });
    const ctx = hotspotContextSchema.parse(await loadHotspotContext(gene(), { uniprot: "P00441" }));
    expect(ctx.perPublished.status).toBe("unavailable");
    expect(ctx.distribution.status).toBe("ok");
    expect(ctx.errors.join(" ")).toMatch(/Published regions/);
  });

  it("keeps a complete answer for the next request, but not a degraded one", async () => {
    const complete = gene();
    await loadHotspotContext(complete, { uniprot: "P00441" });
    await loadHotspotContext(complete, { uniprot: "P00441" });
    expect(rows).toHaveBeenCalledTimes(1);

    rows.mockClear();
    cspec.mockResolvedValueOnce({ status: "error", reason: "registry unreachable", sourceUrl: "https://cspec.genome.network/", retrievedAt: null, specs: [] });
    const degraded = gene();
    await loadHotspotContext(degraded, { uniprot: "P00441" });
    await new Promise((r) => setTimeout(r, 0)); // the eviction runs on the answer's settlement
    await loadHotspotContext(degraded, { uniprot: "P00441" });
    expect(rows).toHaveBeenCalledTimes(2);
  });

  it("repairs a degraded rung without redoing the 3D statistic or the accessibility run", async () => {
    cspec.mockResolvedValueOnce({ status: "error", reason: "registry unreachable", sourceUrl: "https://cspec.genome.network/", retrievedAt: null, specs: [] });
    const g = gene();
    await loadHotspotContext(g, { uniprot: "P00441" });
    await new Promise((r) => setTimeout(r, 0));
    const repaired = hotspotContextSchema.parse(await loadHotspotContext(g, { uniprot: "P00441" }));
    expect(repaired.cspec.status).toBe("none");
    expect(worker).toHaveBeenCalledTimes(1);
    expect(sasa).toHaveBeenCalledTimes(1);
  });

  it("does not remember a failed accessibility run: the next read tries again", async () => {
    sasa.mockResolvedValueOnce({ status: "error", message: "neither Python venv nor uv was found" });
    const g = gene();
    const failed = hotspotContextSchema.parse(await loadHotspotContext(g, { uniprot: "P00441" }));
    expect(failed.accessibility).toMatchObject({ status: "unavailable" });
    expect(failed.accessibility.reason).toMatch(/neither Python venv nor uv/);
    expect(failed.errors.join(" ")).toMatch(/^Accessibility:/);
    await new Promise((r) => setTimeout(r, 0)); // a degraded answer is evicted when it settles
    const again = hotspotContextSchema.parse(await loadHotspotContext(g, { uniprot: "P00441" }));
    expect(again.accessibility.status).toBe("ok");
    expect(sasa).toHaveBeenCalledTimes(2);
  });
});
