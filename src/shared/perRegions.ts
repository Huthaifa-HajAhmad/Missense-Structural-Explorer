import { z } from "zod";

/**
 * Pathogenic-variant Enriched Regions (PERs): Pérez-Palma et al., Genome Research 2020, doi 10.1101/gr.252601.119.
 *
 * INVARIANTS
 * - start/end are protein positions in THIS gene (1-based, inclusive), not alignment Index units.
 * - sequence is this gene's residues over start..end with alignment gaps removed, so the app can check the
 *   numbering against its own sequence (verifyPerRegion) before drawing anything.
 * - A window with no residue of this gene yields no region for this gene.
 *
 * The mapping is pure so the importer and the loader's test run the same code.
 */
const PER_ANALYSES = ["gene", "family"] as const;
export type PerAnalysis = typeof PER_ANALYSES[number];

export const perRegionSourceSchema = z.object({
  citation: z.string(), doi: z.string(), repository: z.string(), commitDate: z.string(),
  licence: z.string(), data: z.string(), method: z.string(),
});
export const perRegionSchema = z.object({
  analysis: z.enum(PER_ANALYSES), family: z.array(z.string()).nullable(), tag: z.string(),
  start: z.number().int().positive(), end: z.number().int().positive(), sequence: z.string(),
  or: z.number().nullable(), ciLow: z.number().nullable(), adjP: z.number().nullable(),
});
export const perRegionsResponseSchema = z.object({ source: perRegionSourceSchema, regions: z.array(perRegionSchema) });
export const perRegionsFileSchema = z.object({
  schema: z.literal(1), source: perRegionSourceSchema,
  sha256Inputs: z.object({ geneWise: z.string(), familyWise: z.string() }),
  genes: z.record(z.string(), z.array(perRegionSchema)),
});
export type PerRegion = z.infer<typeof perRegionSchema>;
export type PerRegionSource = z.infer<typeof perRegionSourceSchema>;
export type PerRegionsResponse = z.infer<typeof perRegionsResponseSchema>;
export type PerRegionsFile = z.infer<typeof perRegionsFileSchema>;

const GAP = "-";
const RESIDUE = /^([A-Z])_(\d+)$/;
/** NA and Inf (an odds ratio on a zero cell) are not representable in JSON, so both become null. */
const numberOrNull = (cell: string) => { const n = Number(cell); return Number.isFinite(n) ? n : null; };

/**
 * Maps one burden table (.bin9.stats text) to per-gene regions. Gene columns sit between Index and Parazscore,
 * one per family member, so the layout is read from the header rather than assumed.
 */
export function perRegionsFromStats(text: string, analysis: PerAnalysis): { genes: Map<string, PerRegion[]>; emptyWindows: number } {
  const [header, ...rows] = text.split(/\r?\n/).filter(line => line !== "").map(line => line.split("\t"));
  const column = (name: string) => header.indexOf(name);
  if (column("Parazscore") < 0) throw new Error("Burden table has no Parazscore column");
  const members = header.slice(1, column("Parazscore"));
  const family = analysis === "family" ? members : null;
  const [iOr, iCiLow, iAdjP, iTag, iStart, iEnd] = ["or", "ci1", "adj.p", "per.tag", "per.start", "per.end"].map(column);

  const genes = new Map<string, PerRegion[]>();
  let emptyWindows = 0;
  for (const tagRow of rows) {
    if (tagRow[iTag] === "NA") continue;
    const start = Number(tagRow[iStart]);
    const end = Number(tagRow[iEnd]);
    const window = rows.filter(row => Number(row[0]) >= start && Number(row[0]) <= end);
    members.forEach((member, m) => {
      const residues = window.flatMap(row => {
        const cell = row[m + 1];
        if (cell === GAP) return [];
        const match = RESIDUE.exec(cell);
        if (!match) throw new Error(`Unexpected residue cell "${cell}" in ${member}`);
        return [{ letter: match[1], position: Number(match[2]) }];
      });
      if (!residues.length) { emptyWindows++; return; }
      const first = residues[0].position;
      const last = residues[residues.length - 1].position;
      if (last - first + 1 !== residues.length) throw new Error(`Non-contiguous residues for ${member} in ${tagRow[iTag]}`);
      const regions = genes.get(member) ?? [];
      regions.push({
        analysis, family, tag: tagRow[iTag], start: first, end: last,
        sequence: residues.map(r => r.letter).join(""),
        or: numberOrNull(tagRow[iOr]), ciLow: numberOrNull(tagRow[iCiLow]), adjP: numberOrNull(tagRow[iAdjP]),
      });
      genes.set(member, regions);
    });
  }
  return { genes, emptyWindows };
}
