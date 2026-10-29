/**
 * Mints server/data/per/per-regions.json.gz from the PERs repository's burden tables.
 *
 *   npm run data:per -- <per_data dir>   (the dir holds gene-wise-results-*\/ and 1-family-wise\/)
 *
 * Source: https://github.com/dlal-group/PERs (MIT), db/*.7z extracted with tar. Only *.bin9.stats are read.
 * The mapping lives in src/shared/perRegions.ts so the loader's test checks the code that wrote this file.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { perRegionsFromStats, type PerAnalysis, type PerRegion, type PerRegionsFile } from "../src/shared/perRegions.ts";

const root = process.argv[2];
if (!root) throw new Error("usage: npm run data:per -- <per_data dir>");
const OUT = resolve("server/data/per/per-regions.json.gz");

const dirs = readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort();
const groups: Array<[keyof PerRegionsFile["sha256Inputs"], PerAnalysis, string[]]> = [
  ["geneWise", "gene", dirs.filter(d => d.startsWith("gene-wise-results-"))],
  ["familyWise", "family", dirs.filter(d => d === "1-family-wise")],
];

const genes = new Map<string, PerRegion[]>();
const sha256Inputs = { geneWise: "", familyWise: "" };
const regionCount: Record<PerAnalysis, number> = { gene: 0, family: 0 };
let statsFiles = 0;
let emptyWindows = 0;
for (const [key, analysis, groupDirs] of groups) {
  const hash = createHash("sha256");
  for (const dir of groupDirs) {
    for (const name of readdirSync(join(root, dir)).filter(f => f.endsWith(".bin9.stats")).sort()) {
      const text = readFileSync(join(root, dir, name), "utf8");
      hash.update(name).update(text);
      const mapped = perRegionsFromStats(text, analysis);
      statsFiles++;
      emptyWindows += mapped.emptyWindows;
      for (const [gene, regions] of mapped.genes) {
        genes.set(gene, [...(genes.get(gene) ?? []), ...regions]);
        regionCount[analysis] += regions.length;
      }
    }
  }
  sha256Inputs[key] = hash.digest("hex");
}

const file: PerRegionsFile = {
  schema: 1,
  source: {
    citation: "Pérez-Palma E, May P, Iqbal S, et al. Identification of pathogenic variant enriched regions across genes and gene families. Genome Res. 2020;30(1):62-71.",
    doi: "10.1101/gr.252601.119",
    repository: "https://github.com/dlal-group/PERs",
    commitDate: "2019-12-10",
    licence: "MIT (code); article CC BY-NC 4.0",
    data: "ClinVar 2019-10 P/LP + HGMD 2019.2 DM vs gnomAD 2.0.2 exomes, GRCh37 canonical transcripts",
    method: "9-residue windows centred every 5 residues, one-sided Fisher exact, Bonferroni within alignment, adj. p < 0.05, consecutive windows merged",
  },
  sha256Inputs,
  genes: Object.fromEntries([...genes]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([gene, regions]) => [gene, regions.sort((a, b) => a.start - b.start || a.end - b.end)])),
};
const bytes = gzipSync(JSON.stringify(file));
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, bytes);

console.log(`read ${statsFiles} stats files (gene-wise ${groups[0][2].length} dirs, family-wise ${groups[1][2].length} dir)`);
console.log(`genes with a PER: ${genes.size}; regions: ${regionCount.gene} gene-wise, ${regionCount.family} family-wise`);
console.log(`windows with no residue for a member (skipped): ${emptyWindows}`);
console.log(`wrote ${OUT}: ${bytes.length} bytes gzip`);
