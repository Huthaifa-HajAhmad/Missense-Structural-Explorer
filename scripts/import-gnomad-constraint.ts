/** Rebuild the pinned compact snapshot from official sources. Streams the large BGZF without saving it. */
import { createHash } from "node:crypto";
import { mkdir, writeFile, rename } from "node:fs/promises";
import { createGunzip, gzipSync } from "node:zlib";
import { Readable, Transform } from "node:stream";
import { createInterface } from "node:readline";
import { CONSTRAINT_RELEASE, REGIONAL_CONSTRAINT_RELEASE, CONSTRAINT_URL, REGIONAL_CONSTRAINT_URL } from "../src/shared/constraintSource.ts";
import type { ConstraintRow, RegionalRow, ConstraintSnapshot } from "../server/services/external-api/constraint-snapshot.ts";

const missing = new Set(["", "NA", "NaN", "nan", "None", "null"]);
export function numeric(value: string): number | null {
  if (missing.has(value)) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`Invalid numeric value: ${value}`);
  return n;
}
export function flags(value: string): string[] {
  if (missing.has(value)) return [];
  const parsed = JSON.parse(value || "[]");
  if (!Array.isArray(parsed) || parsed.some(v => typeof v !== "string")) throw new Error("Invalid quality flags");
  return parsed;
}
async function table(url: string, compressed: boolean, consume: (row: Record<string, string>) => void): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15 * 60 * 1000) });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}): ${url}`);
  const hash = createHash("sha256");
  const source = Readable.fromWeb(response.body as any);
  const hashing = new Transform({ transform(chunk, _encoding, done) { hash.update(chunk); done(null, chunk); } });
  source.on("error", err => hashing.destroy(err));
  const stream = compressed ? hashing.pipe(createGunzip()) : hashing;
  hashing.on("error", err => stream.destroy(err));
  source.pipe(hashing);
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let columns: string[] | undefined;
  let count = 0;
  for await (const line of lines) {
    if (!line) continue;
    if (!columns) { columns = line.split("\t"); continue; }
    const values = line.split("\t");
    if (values.length !== columns.length) throw new Error("Constraint TSV column count mismatch");
    consume(Object.fromEntries(columns.map((name, i) => [name, values[i]])));
    count++;
  }
  if (!count) throw new Error("Empty constraint download");
  console.log(`Read ${count} rows from ${url}`);
  return hash.digest("hex");
}
async function main() {
  const rows: ConstraintRow[] = [];
  const regions: RegionalRow[] = [];
  const sourceSha256 = await table(CONSTRAINT_URL, true, r => {
    if (!/^ENST\d+$/.test(r.transcript) || r.transcript_type !== "protein_coding") return;
    rows.push({ gene: r.gene, geneId: r.gene_id, transcriptId: r.transcript, transcriptVersion: r.transcript_version.split(".").at(-1)!,
      canonical: r.canonical === "true", mane: r.mane_select === "true",
      missense_z: numeric(r["mis.z_score"]), oe_mis: numeric(r["mis.oe"]), pli: numeric(r["lof.pLI"]),
      loeuf: numeric(r["lof.oe_ci.upper"]), percentile: numeric(r["lof.oe_ci.upper_bin_percentile"]),
      flags: [...new Set([...flags(r.gene_flags), ...flags(r.constraint_flags)])],
      expected: { syn: numeric(r["syn.exp"]), mis: numeric(r["mis.exp"]), lof: numeric(r["lof.exp"]) } });
  });
  const regionalSha256 = await table(REGIONAL_CONSTRAINT_URL, false, r => {
    const start = numeric(r.region_start), end = numeric(r.region_end), oe = numeric(r.region_oe), p = numeric(r.region_oe_chisq_p);
    if (!start || !end || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start || oe === null || oe < 0 || p === null || p < 0 || p > 1) throw new Error("Invalid MCR interval/statistic");
    if (!["true", "false"].includes(r.is_high_coverage)) throw new Error("Missing regional QC");
    regions.push({ transcriptId: r.transcript, chrom: r.chr.replace(/^chr/, ""), start, end, oe, p, highCoverage: r.is_high_coverage === "true" });
  });
  rows.sort((a,b) => a.transcriptId.localeCompare(b.transcriptId));
  regions.sort((a,b) => a.transcriptId.localeCompare(b.transcriptId) || a.start-b.start);
  if (rows.length < 18000 || regions.length < 18000) throw new Error("Incomplete constraint snapshot");
  const snapshot: ConstraintSnapshot = { schema: 1, release: CONSTRAINT_RELEASE, regionalRelease: REGIONAL_CONSTRAINT_RELEASE, sourceSha256, regionalSha256, rows, regions };
  const bytes = gzipSync(JSON.stringify(snapshot), { level: 9 });
  const dir = "server/data/constraint";
  await mkdir(dir, { recursive: true });
  const target = `${dir}/gnomad-4.1.2.json.gz`;
  await writeFile(`${target}.tmp`, bytes); await rename(`${target}.tmp`, target);
  await writeFile(`${dir}/manifest.json`, JSON.stringify({ schema: 1, release: CONSTRAINT_RELEASE, regionalRelease: REGIONAL_CONSTRAINT_RELEASE,
    sourceUrl: CONSTRAINT_URL, regionalUrl: REGIONAL_CONSTRAINT_URL, sourceSha256, regionalSha256,
    snapshotSha256: createHash("sha256").update(bytes).digest("hex"), transcripts: rows.length, regions: regions.length }, null, 2)+"\n");
  console.log(`Wrote ${target} (${bytes.length} bytes)`);
}
if (process.argv[1]?.endsWith("import-gnomad-constraint.ts")) await main();
