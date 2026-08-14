import { z } from "zod";

// ============================================================================
// 1. Translate Variant Contract
// ============================================================================
export const translateVariantRequestSchema = z.object({
  variant: z.string()
});

// Mirrors POST /api/v1/translate-variant. The route returns the selected
// transcript metadata rather than a sequence/position projection.
export const translateVariantResponseSchema = z.object({
  gene: z.string(),
  variant: z.string(),
  uniprotId: z.string(),
  transcriptId: z.string().optional(),
  isManeSelect: z.boolean().optional(),
  isManePlusClinical: z.boolean().optional(),
  isCanonical: z.boolean().optional(),
  maneRefSeqId: z.string().optional(),
  transcriptWarning: z.string().optional(),
  genomicCoordinates: z.string().nullable().optional()
});

export type TranslateVariantRequest = z.infer<typeof translateVariantRequestSchema>;
export type TranslateVariantResponse = z.infer<typeof translateVariantResponseSchema>;

// ============================================================================
// 2. Nearest Residues Contract
// ============================================================================
export const nearestResiduesRequestSchema = z.object({
  pdbText: z.string(),
  targetIndex: z.number(),
  distanceThreshold: z.number().positive().optional(),
  targetChain: z.string().optional()
});

export const nearestResidueItemSchema = z.object({
  index: z.number(),
  name: z.string(),
  distance: z.number(),
  properties: z.string(),
  role: z.string(),
  classBadge: z.string()
});

// The backend wraps computed neighbors with provenance metadata.
export const nearestResiduesResponseSchema = z.object({
  residues: z.array(nearestResidueItemSchema),
  source: z.string()
});

export type NearestResiduesRequest = z.infer<typeof nearestResiduesRequestSchema>;
export type NearestResiduesResponse = z.infer<typeof nearestResiduesResponseSchema>;

// ============================================================================
// 3. Pocket Finder / Pocket Detect Contract
// ============================================================================
export const pocketFinderRequestSchema = z.object({
  pdbText: z.string(),
  mutIndex: z.number(),
  targetChain: z.string().optional()
});

export const pocketResidueSchema = z.object({
  index: z.number(),
  chain: z.string(),
  name: z.string(),
  distance: z.number(),
  score: z.number(),
  role: z.string(),
  type: z.string()
});

export const pocketFinderResponseSchema = z.object({
  pocketResidues: z.array(pocketResidueSchema),
  pocketScore: z.number(),
  pocketVolume: z.number(),
  likelyCofactor: z.string(),
  status: z.enum(["success", "fallback"]),
  pocketDistance: z.number().nullable().optional()
});

export type PocketFinderRequest = z.infer<typeof pocketFinderRequestSchema>;
export type PocketFinderResponse = z.infer<typeof pocketFinderResponseSchema>;

// ============================================================================
// 4. Biophysical Analysis Contract
// ============================================================================
export const biophysicalAnalysisRequestSchema = z.object({
  gene: z.string(),
  uniprotId: z.string(),
  variant: z.string(),
  wtPdb: z.string().optional(),
  options: z.any().optional()
});

export const biophysicalAnalysisResponseSchema = z.object({
  analysis: z.string().nullable().optional(),
  insights: z.object({
    biochemicalShift: z.string(),
    structuralImpact: z.string(),
    plausibility: z.string().optional(),
    acmgCriteria: z.array(z.object({
      code: z.string(),
      reason: z.string()
    }))
  }).nullable().optional(),
  ruleBasedInsights: z.object({
    plausibility: z.string(),
    acmgVerdict: z.string(),
    acmgCriteria: z.array(z.object({
      code: z.string(),
      reason: z.string()
    }))
  }).nullable().optional(),
  metadata: z.object({
    gene: z.string(),
    variant: z.string(),
    uniprotId: z.string(),
    residueIndex: z.number().nullable(),
    wildType: z.string(),
    mutant: z.string()
  }).optional()
}).passthrough();

export type BiophysicalAnalysisRequest = z.infer<typeof biophysicalAnalysisRequestSchema>;
export type BiophysicalAnalysisResponse = z.infer<typeof biophysicalAnalysisResponseSchema>;

// ============================================================================
// 5. ESMFold Contract
// ============================================================================
export const esmFoldRequestSchema = z.object({
  sequence: z.string().optional(),
  uniprotId: z.string().optional(),
  variant: z.string().optional(),
  wtSeq: z.string().optional(),
  mutSeq: z.string().optional()
});

export const esmFoldResponseSchema = z.object({
  pdb: z.string().optional(),
  wtPdb: z.string().optional(),
  mutPdb: z.string().optional(),
  chain: z.string().optional(),
  plddt: z.array(z.number()).optional(),
  status: z.enum(["success", "cached", "failed"])
});

export type EsmFoldRequest = z.infer<typeof esmFoldRequestSchema>;
export type EsmFoldResponse = z.infer<typeof esmFoldResponseSchema>;

// ============================================================================
// 6. Structural Align Contract
// ============================================================================
export const structuralAlignRequestSchema = z.object({
  pdb1: z.string(),
  pdb2: z.string(),
  targetIndex: z.number().optional()
});

export const structuralAlignResponseSchema = z.object({
  alignedPdb: z.string(),
  metrics: z.any()
});

export const structuralDiffResponseSchema = z.object({
  rmsd: z.number(),
  localRmsd: z.number().nullable().optional(),
  windowDisplacements: z.array(z.object({
    resSeq: z.number(),
    resName: z.string(),
    displacement: z.number()
  })),
  clashes: z.object({
    wtClashCount: z.number(),
    mutClashCount: z.number(),
    diff: z.number()
  })
});

export type StructuralAlignRequest = z.infer<typeof structuralAlignRequestSchema>;
export type StructuralAlignResponse = z.infer<typeof structuralAlignResponseSchema>;
export type StructuralDiffResponse = z.infer<typeof structuralDiffResponseSchema>;
