import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { perRegionsFileSchema, type PerRegion, type PerRegionsFile, type PerRegionsResponse } from "../../../src/shared/perRegions.ts";

/**
 * Bundled Pathogenic-variant Enriched Regions, read offline from server/data/per (dist/per in production).
 *
 * INVARIANTS
 * - Nothing is fetched at request time: scripts/import-per-regions.ts mints the file from the published tables.
 * - Keys are HGNC symbols upper-cased (the committed bundle holds 1,336, every one uppercase). The reader
 *   that loads them (`hotspots.ts` build) upper-cases before the lookup, so a symbol like C10orf10 is read as
 *   C10ORF10 on both sides. If an importer ever stops upper-casing, lookups go silent-empty instead of erroring —
 *   keep the two sides in step.
 * - A region is drawn only after verifyPerRegion agrees with the app's own protein sequence.
 */
let bundle: PerRegionsFile | undefined;
export function loadPerRegions(gene: string): PerRegionsResponse {
  if (!bundle) {
    // cwd is the project root in both tsx and the compiled server, including Docker.
    const base = existsSync(resolve("dist/per/per-regions.json.gz")) && process.env.NODE_ENV === "production" ? resolve("dist/per") : resolve("server/data/per");
    bundle = perRegionsFileSchema.parse(JSON.parse(gunzipSync(readFileSync(resolve(base, "per-regions.json.gz"))).toString("utf8")));
  }
  return { source: bundle.source, regions: Object.hasOwn(bundle.genes, gene) ? bundle.genes[gene] : [] };
}

/** The app's residues must equal the bundled ones over start..end; any disagreement means the numbering differs. */
export function verifyPerRegion(region: PerRegion, proteinSequence: string): { verified: boolean; mismatches: number } {
  const expected = proteinSequence.slice(region.start - 1, region.end);
  const length = Math.max(expected.length, region.sequence.length);
  let mismatches = 0;
  for (let i = 0; i < length; i++) if (expected[i] !== region.sequence[i]) mismatches++;
  return { verified: mismatches === 0, mismatches };
}
