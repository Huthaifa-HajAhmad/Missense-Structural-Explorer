import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { CONSTRAINT_RELEASE, REGIONAL_CONSTRAINT_RELEASE } from "../../../src/shared/constraintSource.ts";

/** Portable snapshot shipped with the server; no network request or operator setup on the critical path. */
export interface ConstraintRow {
  gene: string; geneId: string; transcriptId: string; transcriptVersion: string;
  canonical: boolean; mane: boolean; missense_z: number | null; oe_mis: number | null;
  pli: number | null; loeuf: number | null; percentile: number | null;
  flags: string[]; expected: { syn: number | null; mis: number | null; lof: number | null };
}
export interface RegionalRow {
  transcriptId: string; chrom: string; start: number; end: number;
  oe: number; p: number; highCoverage: boolean;
}
export interface ConstraintSnapshot {
  schema: 1; release: string; regionalRelease: string;
  sourceSha256: string; regionalSha256: string;
  rows: ConstraintRow[]; regions: RegionalRow[];
}
export interface ConstraintIndex {
  snapshot: ConstraintSnapshot;
  genes: Map<string, ConstraintRow[]>;
  transcripts: Map<string, ConstraintRow>;
  regions: Map<string, RegionalRow[]>;
}
export function indexConstraintSnapshot(snapshot: ConstraintSnapshot): ConstraintIndex {
  if (snapshot.schema !== 1 || snapshot.release !== CONSTRAINT_RELEASE || snapshot.regionalRelease !== REGIONAL_CONSTRAINT_RELEASE || !snapshot.rows.length) {
    throw new Error("Unsupported or empty gnomAD constraint snapshot; run npm run data:constraint");
  }
  const genes = new Map<string, ConstraintRow[]>();
  const transcripts = new Map<string, ConstraintRow>();
  const regions = new Map<string, RegionalRow[]>();
  for (const row of snapshot.rows) {
    if (transcripts.has(row.transcriptId)) throw new Error(`Duplicate constraint transcript ${row.transcriptId}`);
    transcripts.set(row.transcriptId, row);
    const geneRows = genes.get(row.gene.toUpperCase()) ?? [];
    geneRows.push(row); genes.set(row.gene.toUpperCase(), geneRows);
  }
  for (const row of snapshot.regions) {
    const list = regions.get(row.transcriptId) ?? [];
    list.push(row); regions.set(row.transcriptId, list);
  }
  return { snapshot, genes, transcripts, regions };
}
let index: ConstraintIndex | undefined;
export function getConstraintIndex(): ConstraintIndex {
  if (!index) {
    // cwd is the project root in both tsx and the compiled server, including Docker.
    const base = existsSync(resolve("dist/constraint/manifest.json")) && process.env.NODE_ENV === "production" ? resolve("dist/constraint") : resolve("server/data/constraint");
    const bytes = readFileSync(resolve(base, "gnomad-4.1.2.json.gz"));
    const manifest = JSON.parse(readFileSync(resolve(base, "manifest.json"), "utf8"));
    if (createHash("sha256").update(bytes).digest("hex") !== manifest.snapshotSha256) throw new Error("gnomAD constraint snapshot checksum mismatch");
    index = indexConstraintSnapshot(JSON.parse(gunzipSync(bytes).toString("utf8")));
  }
  return index;
}
