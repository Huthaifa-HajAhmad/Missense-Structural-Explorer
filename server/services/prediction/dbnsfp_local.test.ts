import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import * as local from "./dbnsfp_local.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ingestScript = path.join(repoRoot, "tools", "ingest_dbnsfp.ts");

// A small fixture in the real dbNSFP v5 column layout that tools/ingest_dbnsfp.ts reads.
const HEADER_COLS = [
  "#chr", "pos(1-based)", "ref", "alt", "aaref", "aaalt", "aapos", "genename",
  "Ensembl_transcriptid", "MANE", "VEP_canonical", "aachange",
  "REVEL_score", "AlphaMissense_score", "GERP++_RS", "phyloP100way_vertebrate",
  "BayesDel_noAF_score", "MetaRNN_score", "ClinPred_score", "DANN_score", "Eigen-phred", "ESM1b_score", "CADD_phred",
  "gnomAD_exomes_AC", "gnomAD_exomes_AN", "gnomAD_genomes_AC", "gnomAD_genomes_AN",
  "gnomAD_exomes_nhomalt", "gnomAD_genomes_nhomalt", "AoU_AC", "AoU_AN",
];
const line = (r: Record<string, string>) => HEADER_COLS.map(c => r[c] ?? ".").join("\t") + "\n";
const header = HEADER_COLS.join("\t") + "\n";

const R1 = { "#chr": "1", "pos(1-based)": "100", ref: "C", alt: "A", aaref: "Q", aaalt: "H", aapos: "867", genename: "TEST", Ensembl_transcriptid: "ENST00000001", aachange: "p.Gln867His", REVEL_score: "0.912345", AlphaMissense_score: "0.8", gnomAD_exomes_AC: "2", gnomAD_genomes_AC: "1", gnomAD_exomes_AN: "1000", gnomAD_genomes_AN: "500", AoU_AC: "3", AoU_AN: "100" };
// Multi-transcript: the MANE Select entry (second) must be the one stored.
const R2 = { "#chr": "1", "pos(1-based)": "101", ref: "G", alt: "T", aaref: "Q", aaalt: "H", aapos: "500;867", genename: "TEST;TEST", Ensembl_transcriptid: "ENST00000009;ENST00000002", MANE: ".;MANE_Select", VEP_canonical: ".;.", aachange: "p.Ala500Thr;p.Gln867His", REVEL_score: "0.1;0.2", AlphaMissense_score: "0.3;0.4" };
const R3 = { "#chr": "2", "pos(1-based)": "5", ref: "A", alt: "G", aaref: "N", aaalt: "S", aapos: "42", genename: "OTHER", Ensembl_transcriptid: "ENST00000003", aachange: "p.Asn42Ser", CADD_phred: "25.55555" };

/** Ingest the fixture through the real CLI, stdin path, two gzip members, with an explicit version. */
function ingestFixture(dbPath: string): void {
  const input = Buffer.concat([
    zlib.gzipSync(header + line(R1)),
    zlib.gzipSync(line(R2) + line(R3)),
  ]);
  const res = spawnSync(process.execPath, ["--import", "tsx", ingestScript, "-", "--db", dbPath, "--version", "5.3a"], {
    cwd: repoRoot, input, encoding: "utf8", timeout: 120000,
    env: { ...process.env, DBNSFP_VERSION: "" },
  });
  if (res.status !== 0) throw new Error(`ingest failed: ${res.stderr}`);
}

const ENV_KEYS = ["ENABLE_LOCAL_DBNSFP", "DBNSFP_SQLITE_PATH"] as const;
let saved: Record<string, string | undefined>;
let tmp: string;
let dbPath: string;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dbnsfp-local-"));
  dbPath = path.join(tmp, "dbnsfp_v5.sqlite");
  delete process.env.ENABLE_LOCAL_DBNSFP;
  process.env.DBNSFP_SQLITE_PATH = dbPath;
});

afterEach(() => {
  local.closeLocalDbnsfpStore();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("local dbNSFP store availability", () => {
  it("treats a 0-byte placeholder as unusable without the env flag", () => {
    fs.writeFileSync(dbPath, "");
    expect(local.isLocalDbnsfpAvailable()).toBe(false);
    expect(local.getDbInstance()).toBeNull();
    const info = local.inspectLocalDbnsfpFile();
    expect(info).toMatchObject({ path: dbPath, present: true, sizeBytes: 0, enabled: true, usable: false, version: null, rowCount: null });
    expect(info.reason).toMatch(/placeholder/);
  });

  it("reports a missing file as absent, not as an error", () => {
    expect(local.isLocalDbnsfpAvailable()).toBe(false);
    expect(local.inspectLocalDbnsfpFile()).toMatchObject({ present: false, sizeBytes: 0, usable: false, reason: "database file not found" });
  });

  it("refuses a store that has the table but no variant rows", () => {
    const d = new DatabaseSync(dbPath);
    d.exec("CREATE TABLE variant_scores (gene TEXT, pos INTEGER)");
    d.exec("CREATE TABLE pad (x TEXT)");
    const ins = d.prepare("INSERT INTO pad VALUES (?)");
    for (let i = 0; i < 200; i++) ins.run("x".repeat(100)); // clear the size threshold
    d.close();
    expect(fs.statSync(dbPath).size).toBeGreaterThan(4096);
    expect(local.isLocalDbnsfpAvailable()).toBe(false);
    expect(local.inspectLocalDbnsfpFile().reason).toMatch(/empty/);
  });

  it("refuses a large file that has no variant_scores table", () => {
    const d = new DatabaseSync(dbPath);
    d.exec("CREATE TABLE pad (x TEXT)");
    const ins = d.prepare("INSERT INTO pad VALUES (?)");
    for (let i = 0; i < 200; i++) ins.run("x".repeat(100));
    d.close();
    expect(local.isLocalDbnsfpAvailable()).toBe(false);
    expect(local.inspectLocalDbnsfpFile().reason).toMatch(/variant_scores table is missing/);
  });

  it("disables a populated store when ENABLE_LOCAL_DBNSFP=false", async () => {
    ingestFixture(dbPath);
    process.env.ENABLE_LOCAL_DBNSFP = "false";
    expect(local.isLocalDbnsfpAvailable()).toBe(false);
    expect(local.getDbInstance()).toBeNull();
    expect(await local.queryLocalDbnsfpVariant("TEST", 867, "C", "A")).toBeNull();
    expect(local.inspectLocalDbnsfpFile()).toMatchObject({ enabled: false, usable: false, reason: "disabled by ENABLE_LOCAL_DBNSFP=false" });
  });

  it("flips on a runtime env change without touching the file", () => {
    ingestFixture(dbPath);
    expect(local.isLocalDbnsfpAvailable()).toBe(true);
    process.env.ENABLE_LOCAL_DBNSFP = "false";
    expect(local.isLocalDbnsfpAvailable()).toBe(false);
    delete process.env.ENABLE_LOCAL_DBNSFP;
    expect(local.isLocalDbnsfpAvailable()).toBe(true);
  });

  it("picks up a store ingested after the server first looked, without a restart", () => {
    fs.writeFileSync(dbPath, "");
    expect(local.isLocalDbnsfpAvailable()).toBe(false);
    ingestFixture(dbPath);
    expect(local.isLocalDbnsfpAvailable()).toBe(true);
  });
});

describe("local dbNSFP store, ingested by tools/ingest_dbnsfp.ts and queried", () => {
  beforeEach(() => {
    ingestFixture(dbPath);
  });

  it("is usable without ENABLE_LOCAL_DBNSFP and serves allele-exact lookups", async () => {
    expect(local.isLocalDbnsfpAvailable()).toBe(true);

    const cAtoA = await local.queryLocalDbnsfpVariant("TEST", 867, "C", "A");
    expect(cAtoA).toMatchObject({ gene: "TEST", pos: 867, ref: "C", alt: "A", transcript: "ENST00000001", revel: 0.9123, gnomad_ac: 3, aou_ac: 3 });

    // The MANE Select transcript carries the second entry of each list.
    const gToT = await local.queryLocalDbnsfpVariant("TEST", 867, "G", "T");
    expect(gToT).toMatchObject({ transcript: "ENST00000002", revel: 0.2 });
  });

  it("returns null for an amino-acid change whose alleles are ambiguous, rather than picking one", async () => {
    expect(await local.queryLocalDbnsfpVariant("TEST", 867, null, null, "Q867H")).toBeNull();
  });

  it("serves genomic (chr, pos_genomic, ref, alt) lookups, with or without the chr prefix", async () => {
    expect(await local.queryLocalDbnsfpByGenomic("chr1", 101, "G", "T")).toMatchObject({ gene: "TEST", pos: 867 });
    expect(await local.queryLocalDbnsfpByGenomic("2", 5, "A", "G")).toMatchObject({ gene: "OTHER", pos: 42 });
    expect(await local.queryLocalDbnsfpByGenomic("1", 999, "A", "C")).toBeNull();
  });

  it("feeds the landscape query and reports the recorded transcript policy", async () => {
    const landscape = await local.queryLocalDbnsfpLandscapeRows("TEST");
    expect(landscape?.candidates).toHaveLength(2);
    expect(landscape?.transcriptBasis).toBe("mane");
  });

  it("reports provenance and per-chromosome row counts from build_meta", () => {
    expect(local.getLocalDbnsfpVersion()).toBe("5.3a");
    expect(local.readLocalDbnsfpVersion()).toBe("dbNSFP 5.3a (local)");
    const info = local.inspectLocalDbnsfpFile();
    expect(info).toMatchObject({ enabled: true, usable: true, version: "5.3a", rowCount: 3 });
    expect(info.sizeBytes).toBeGreaterThan(4096);
    expect(info.reason).toBeUndefined();
  });
});

describe("inspectLocalDbnsfpFileForPublic", () => {
  const saved = process.env.DBNSFP_SQLITE_PATH;
  afterEach(() => {
    if (saved === undefined) delete process.env.DBNSFP_SQLITE_PATH;
    else process.env.DBNSFP_SQLITE_PATH = saved;
  });

  it("publishes the store's file name, never the host's directory layout", () => {
    process.env.DBNSFP_SQLITE_PATH = path.join(os.tmpdir(), "private-layout", "dbnsfp_v5.sqlite");
    expect(local.inspectLocalDbnsfpFile().path).toContain("private-layout");
    expect(local.inspectLocalDbnsfpFileForPublic().path).toBe("dbnsfp_v5.sqlite");
  });
});
