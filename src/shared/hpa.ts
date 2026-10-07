/**
 * Human Protein Atlas summary for one gene: RNA tissue and single-cell-type specificity, and the
 * protein-level evidence. HPA's tissue consensus includes GTEx, so it is not independent
 * replication of the GTEx table. Units differ (nTPM tissue, nCPM cell type) and are never merged.
 * Only enriched tissues and cell types are listed by the summary endpoint: absence from the list
 * is not a zero measurement.
 */
import { z } from 'zod';
import { contextProvenanceSchema } from './diseaseFrame.ts';

const measureSchema = z.object({ name: z.string(), value: z.number().finite().nonnegative() });
export const hpaResponseSchema = z.object({
  gene: z.string(), status: z.enum(['ready', 'not-found', 'error']), ensemblId: z.string().nullable(),
  rna: z.object({ specificity: z.string().nullable(), distribution: z.string().nullable(), enrichedTissues: z.array(measureSchema) }).nullable(),
  cells: z.object({ specificity: z.string().nullable(), distribution: z.string().nullable(), enrichedCells: z.array(measureSchema) }).nullable(),
  protein: z.object({ evidence: z.string().nullable(), tissueSpecificity: z.string().nullable(), antibodies: z.array(z.string()),
    reliabilityIhc: z.string().nullable(), reliabilityIf: z.string().nullable() }).nullable(),
  provenance: contextProvenanceSchema.nullable(), message: z.string().nullable(),
});
export type HpaResponse = z.infer<typeof hpaResponseSchema>;
export type HpaMeasure = z.infer<typeof measureSchema>;

/** HPA delivers numbers as strings; an unparsable value is dropped, never turned into zero. */
export function parseHpaMeasures(raw: unknown): HpaMeasure[] {
  if (!raw || typeof raw !== 'object') return [];
  return Object.entries(raw as Record<string, unknown>).flatMap(([name, v]) => {
    const value = typeof v === 'number' ? v : Number.parseFloat(String(v));
    return Number.isFinite(value) && value >= 0 ? [{ name, value }] : [];
  }).sort((a, b) => b.value - a.value);
}
