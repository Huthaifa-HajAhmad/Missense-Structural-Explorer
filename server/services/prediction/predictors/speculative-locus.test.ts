import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import type { PredictorData } from "../../../../src/shared/contracts.ts";
import { LOCUS_POLICY_VERSION } from "../../../../src/shared/locusResolution.ts";
import { locusInputs, makeLocusRunner, speculativeCoordinateLocus } from "./speculative-locus.ts";
import { closeLocalDbnsfpStore } from "../dbnsfp_local.ts";

/** What fetchPredictorData returns on a successful coordinate-first VEP answer (withTrail, route vep-coordinate). */
function vepAnswer(over: Partial<PredictorData> = {}): PredictorData {
  return {
    available: true,
    amPathogenicity: 0.9,
    amClass: "likely_pathogenic",
    caddPhred: 25,
    gnomadVariantId: "4-10-C-T",
    gnomadVariantAssembly: "GRCh38",
    transcriptId: "ENST00000020",
    isManeSelect: true,
    isManePlusClinical: false,
    isCanonical: true,
    maneRefSeqId: "NM_000001.1",
    canonicalEnsemblId: null,
    source: "Ensembl VEP API (coordinate)",
    locusResolution: { route: "vep-coordinate", canonicalBy: "vep", retryable: false, policyVersion: LOCUS_POLICY_VERSION, steps: [{ step: "vep-coordinate", outcome: "ok", detail: "region 4:10" }] },
    ...over,
  } as PredictorData;
}

function speculative(over: Partial<PredictorData> = {}): PredictorData {
  return {
    ...vepAnswer(),
    amPathogenicity: null, amClass: null, caddPhred: null, maneRefSeqId: undefined, isCanonical: false,
    source: "speculative locus (local store; superseded by Ensembl VEP)",
    locusResolution: { route: "vep-coordinate", canonicalBy: "vep", retryable: false, policyVersion: LOCUS_POLICY_VERSION, steps: [] },
    ...over,
  } as PredictorData;
}

describe("locusInputs: what the locus-dependent sources read", () => {
  it("is equal for the speculative locus and VEP's answer at the same locus, whatever the scores", () => {
    expect(locusInputs(speculative())).toBe(locusInputs(vepAnswer()));
    expect(locusInputs(speculative())).toBe(locusInputs(vepAnswer({ amPathogenicity: 0.1, caddPhred: 3 })));
  });

  it("differs when VEP picked another transcript, another coordinate, or did not answer", () => {
    expect(locusInputs(speculative())).not.toBe(locusInputs(vepAnswer({ transcriptId: "ENST00000099" })));
    expect(locusInputs(speculative())).not.toBe(locusInputs(vepAnswer({ gnomadVariantId: "4-10-C-G" })));
    expect(locusInputs(speculative())).not.toBe(locusInputs(null));
    // A fallback branch answering instead of VEP changes the population gate.
    expect(locusInputs(speculative())).not.toBe(locusInputs(vepAnswer({
      source: "local dbNSFP (coordinate fallback)",
      locusResolution: { route: "fallback", canonicalBy: null, retryable: true, policyVersion: LOCUS_POLICY_VERSION, steps: [] },
    })));
  });
});

describe("makeLocusRunner", () => {
  it("without a speculative locus, hands the dependent VEP's own promise and runs it once", async () => {
    const pred = vepAnswer();
    const runner = makeLocusRunner(Promise.resolve(null), Promise.resolve(pred));
    const seen: Array<PredictorData | null> = [];
    const out = await runner.run(async locus => { const p = await locus; seen.push(p); return p?.transcriptId; });
    expect(out).toBe("ENST00000020");
    expect(seen).toEqual([pred]);
    expect(runner.outcome()).toBe("none");
  });

  it("keeps the early result when VEP's locus inputs match, and runs the dependent once", async () => {
    let release!: (p: PredictorData) => void;
    const vep = new Promise<PredictorData>(r => { release = r; });
    const runner = makeLocusRunner(Promise.resolve(speculative()), vep);
    let calls = 0;
    const started: number[] = [];
    const result = runner.run(async locus => { calls++; const p = await locus; started.push(Date.now()); return { withheld: !p?.gnomadVariantId }; });
    await new Promise(r => setTimeout(r, 20));
    expect(started).toHaveLength(1); // ran before VEP answered
    release(vepAnswer());
    expect(await result).toEqual({ withheld: false });
    expect(calls).toBe(1);
    expect(runner.outcome()).toBe("kept");
  });

  it("re-runs on VEP's answer when the locus differs, discards the early result and its flags, and swallows its rejection", async () => {
    const real = vepAnswer({ transcriptId: "ENST00000099", gnomadVariantId: null as any, gnomadVariantAssembly: null as any });
    const runner = makeLocusRunner(Promise.resolve(speculative()), Promise.resolve(real));
    const inputs: Array<string | null | undefined> = [];
    const result = await runner.run(async locus => {
      const p = await locus;
      inputs.push(p?.transcriptId);
      if (p?.transcriptId === "ENST00000020") throw new Error("early run fails"); // must not surface
      return { withheld: !p?.gnomadVariantId, transcript: p?.transcriptId };
    });
    expect(inputs).toEqual(["ENST00000020", "ENST00000099"]);
    expect(result).toEqual({ withheld: true, transcript: "ENST00000099" });
    expect(runner.outcome()).toBe("discarded");
  });

  it("in shadow mode runs every dependent once on VEP's own promise, and only records what speculation would have done", async () => {
    const pred = vepAnswer();
    const vep = Promise.resolve(pred);
    const runner = makeLocusRunner(Promise.resolve(speculative()), vep, false);
    const seen: Array<Promise<PredictorData | null>> = [];
    await runner.run(async locus => { seen.push(locus); return (await locus)?.transcriptId; });
    expect(seen).toEqual([vep]);
    expect(await runner.decided()).toBe("would-keep");
    const differing = makeLocusRunner(Promise.resolve(speculative()), Promise.resolve(vepAnswer({ transcriptId: "ENST00000099" })), false);
    expect(await differing.decided()).toBe("would-discard");
  });

  it("treats a VEP failure (null) as a different locus and re-runs on it", async () => {
    const runner = makeLocusRunner(Promise.resolve(speculative()), Promise.resolve(null));
    const result = await runner.run(async locus => (await locus)?.transcriptId ?? "no locus");
    expect(result).toBe("no locus");
    expect(runner.outcome()).toBe("discarded");
  });
});

// ── speculativeCoordinateLocus, against a real ingested store ──
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const ingestScript = path.join(repoRoot, "tools", "ingest_dbnsfp.ts");
const HEADER_COLS = [
  "#chr", "pos(1-based)", "ref", "alt", "aaref", "aaalt", "aapos", "genename",
  "Ensembl_transcriptid", "MANE", "VEP_canonical", "aachange",
  "REVEL_score", "AlphaMissense_score", "GERP++_RS", "phyloP100way_vertebrate",
  "BayesDel_noAF_score", "MetaRNN_score", "ClinPred_score", "DANN_score", "Eigen-phred", "ESM1b_score", "CADD_phred",
  "gnomAD_exomes_AC", "gnomAD_exomes_AN", "gnomAD_genomes_AC", "gnomAD_genomes_AN",
  "gnomAD_exomes_nhomalt", "gnomAD_genomes_nhomalt", "AoU_AC", "AoU_AN",
];
const line = (r: Record<string, string>) => HEADER_COLS.map(c => r[c] ?? ".").join("\t") + "\n";
const ISO = { "#chr": "4", "pos(1-based)": "10", ref: "C", alt: "T", aaref: "P", aaalt: "L", aapos: "100;100", genename: "ISO;ISO", Ensembl_transcriptid: "ENST00000020;ENST00000022", MANE: "MANE_Select;.", VEP_canonical: ".;.", aachange: "p.Pro100Leu;p.Pro100Leu", REVEL_score: "0.5;0.5", AlphaMissense_score: "0.9;0.9" };
const LONE = { "#chr": "5", "pos(1-based)": "20", ref: "A", alt: "G", aaref: "K", aaalt: "R", aapos: "5", genename: "LONE", Ensembl_transcriptid: "ENST00000030", MANE: "MANE_Select", aachange: "p.Lys5Arg", AlphaMissense_score: "0.5" };

describe("speculativeCoordinateLocus", () => {
  let tmp: string;
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.DBNSFP_SQLITE_PATH;
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "spec-locus-"));
    const dbPath = path.join(tmp, "dbnsfp_v5.sqlite");
    const res = spawnSync(process.execPath, ["--import", "tsx", ingestScript, "-", "--db", dbPath, "--version", "5.4a"], {
      cwd: repoRoot, input: zlib.gzipSync(HEADER_COLS.join("\t") + "\n" + line(ISO) + line(LONE)), encoding: "utf8", timeout: 120000,
      env: { ...process.env, DBNSFP_VERSION: "" },
    });
    if (res.status !== 0) throw new Error(`ingest failed: ${res.stderr}`);
    process.env.DBNSFP_SQLITE_PATH = dbPath;
  });
  afterEach(async () => {
    await closeLocalDbnsfpStore();
    if (saved === undefined) delete process.env.DBNSFP_SQLITE_PATH; else process.env.DBNSFP_SQLITE_PATH = saved;
    delete process.env.PREDICTOR_SPECULATIVE_LOCUS;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const coord = (chrom: string, pos: number, ref: string, alt: string) => ({ chrom, pos, ref, alt, assembly: "GRCh38" as const });

  it("reads the MANE locus for the exact allele, gene and substitution, with the inputs VEP's answer would carry", async () => {
    const spec = await speculativeCoordinateLocus("ISO", "p.Pro100Leu", undefined, coord("4", 10, "C", "T"));
    expect(spec).toMatchObject({ transcriptId: "ENST00000020", gnomadVariantId: "4-10-C-T", gnomadVariantAssembly: "GRCh38", amPathogenicity: null });
    expect(locusInputs(spec)).toBe(locusInputs(vepAnswer()));
  });

  it("declines anything it cannot vouch for", async () => {
    expect(await speculativeCoordinateLocus("ISO", "p.Pro100Ser", undefined, coord("4", 10, "C", "T"))).toBeNull(); // other substitution
    expect(await speculativeCoordinateLocus("ISO", "p.Pro101Leu", undefined, coord("4", 10, "C", "T"))).toBeNull(); // other residue
    expect(await speculativeCoordinateLocus("OTHER", "p.Pro100Leu", undefined, coord("4", 10, "C", "T"))).toBeNull(); // other gene
    expect(await speculativeCoordinateLocus("ISO", "p.Pro100Leu", undefined, { ...coord("4", 10, "C", "T"), assembly: "GRCh37" as const })).toBeNull();
    expect(await speculativeCoordinateLocus("ISO", "p.Pro100Leu", undefined, null)).toBeNull();
    // A lone transcript is stored `single`: its numbering is unconfirmed, so no speculation.
    expect(await speculativeCoordinateLocus("LONE", "p.Lys5Arg", undefined, coord("5", 20, "A", "G"))).toBeNull();
    process.env.PREDICTOR_SPECULATIVE_LOCUS = "off";
    expect(await speculativeCoordinateLocus("ISO", "p.Pro100Leu", undefined, coord("4", 10, "C", "T"))).toBeNull();
  });
});
