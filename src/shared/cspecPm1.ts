/**
 * ClinGen Variant Curation Expert Panel (VCEP) specifications that cover one gene, and the PM1
 * ("mutational hot spot or critical functional domain") criterion each panel published in the ClinGen
 * Criteria Specification Registry (CSpec).
 *
 * INVARIANTS
 *  - Text is the registry's own and is shown verbatim beside its link. Nothing reads a residue or a
 *    position out of prose: some panels publish their hot-spot tables as images.
 *  - `released` is the registry's status word, exactly. "Approved For Release" and every "In Prep" or
 *    "Submitted" status are not released.
 *  - `status: "none"` means the registry answered and no specification lists the gene. A failed read is
 *    `"error"` with no specifications, so a failure never reads as absence.
 *  - A specification whose rule set could not be read keeps its place with `pm1: null` and a
 *    `pm1Reason`. `pm1: null` with `pm1Reason: null` means its rule set defines no PM1 criterion.
 *  - `applicable` is derived from the registry's applicability text, which is kept beside it. Any text
 *    that begins with "Applicable" applies, including "Applicable with VCEP specification".
 */
import { z } from 'zod';

export const CSPEC_SOURCE_URL = 'https://cspec.genome.network/cspec/api/svis?detail=high';

export const cspecCriterionSchema = z.object({
  description: z.string(),
  strengths: z.array(z.object({
    label: z.string(), applicable: z.boolean(), applicability: z.string(), description: z.string().nullable(),
  })),
});
export type CspecCriterion = z.infer<typeof cspecCriterionSchema>;

export const cspecSpecSchema = z.object({
  id: z.string(), url: z.string().url(), panel: z.string(), status: z.string(), released: z.boolean(),
  version: z.string().nullable(), diseases: z.array(z.string()),
  pm1: cspecCriterionSchema.nullable(), pm1Reason: z.string().nullable(),
});
export type CspecSpec = z.infer<typeof cspecSpecSchema>;

export const cspecPm1Schema = z.object({
  status: z.enum(['ok', 'none', 'error']), reason: z.string().nullable(), sourceUrl: z.string().url(),
  retrievedAt: z.string().nullable(), specs: z.array(cspecSpecSchema),
}).superRefine((response, ctx) => {
  const agrees = {
    ok: response.specs.length > 0 && response.reason === null && response.retrievedAt !== null,
    none: response.specs.length === 0 && response.reason !== null && response.retrievedAt !== null,
    error: response.specs.length === 0 && response.reason !== null && response.retrievedAt === null,
  }[response.status];
  if (!agrees) ctx.addIssue({ code: 'custom', path: ['status'], message: 'The status, reason, specifications and retrieval time do not agree.' });
});
export type CspecPm1 = z.infer<typeof cspecPm1Schema>;
