import { z } from "zod";
import type { PredictorConcordance } from "./thresholds/concordance";

// ============================================================================
// Numeric Validation Primitives
// ============================================================================
export const finiteNumber = z.number().refine(Number.isFinite, { message: "Number must be finite" });
export const nullableFiniteNumber = z.number().nullable().refine(val => val === null || Number.isFinite(val), { message: "Number must be finite" });

// ============================================================================
// 1. ACMG & Clinical Types
// ============================================================================
export const acmgEvidenceCodeSchema = z.enum([
  "PVS1", "PS1", "PS2", "PS3", "PS4",
  "PM1", "PM2", "PM3", "PM4", "PM5", "PM6",
  "PP1", "PP2", "PP3", "PP4",
  "BA1", "BS1", "BS2", "BS3", "BS4",
  "BP1", "BP2", "BP3", "BP4", "BP5", "BP7"
]);

export type AcmgEvidenceCode = z.infer<typeof acmgEvidenceCodeSchema>;

export const acmgCriteriaItemSchema = z.object({
  code: z.string(),
  reason: z.string(),
  source: z.enum(["database_verified", "ai_suggested"]).optional()
});

export type ACMGCriteriaItem = z.infer<typeof acmgCriteriaItemSchema>;

export const clinicalSignificanceSchema = z.union([
  z.enum([
    "Pathogenic",
    "Likely Pathogenic",
    "Uncertain Significance",
    "Likely Benign",
    "Benign",
    "Pathogenic/Likely pathogenic",
    "Benign/Likely benign",
    "Conflicting interpretations of pathogenicity",
    "not found"
  ]),
  z.string()
]);

export type ClinicalSignificance = z.infer<typeof clinicalSignificanceSchema>;

export const clinVarDataSchema = z.object({
  classification: clinicalSignificanceSchema,
  lastEvaluated: z.string(),
  reviewStatus: z.string(),
  alleleFrequencies: z.array(z.object({
    source: z.string(),
    value: z.preprocess(
      (val) => {
        if (val === null || val === undefined) return null;
        const parsed = typeof val === "number" ? val : parseFloat(String(val));
        return isNaN(parsed) ? null : parsed;
      },
      nullableFiniteNumber
    )
  })),
  trait: z.string(),
  uid: z.string().nullable(),
  hasOtherPathogenicVariantSameAA: z.boolean().optional()
});

export type ClinVarData = z.infer<typeof clinVarDataSchema>;

// ============================================================================
// 2. Structure Provenance & Energetics Contracts
// ============================================================================
export const structureProvenanceSchema = z.object({
  source: z.enum(["experimental", "alphafold", "homolog", "client-provided"]),
  pdbId: z.string().optional(),
  chainId: z.string().optional(),
  resolution: z.number().nullable().optional(),
  method: z.string().optional(),
  identity: z.number().optional(),
  foldxVersion: z.string().optional(),
  foldxRuns: z.number().optional(),
  seed: z.number().nullable().optional(),
  raspDatasetSnapshot: z.string().optional(),
  vesmModel: z.string().optional(),
  afdbVersion: z.string().optional(),
  modelSha: z.string().optional(),
  timestamp: z.string().optional()
});

export type StructureProvenance = z.infer<typeof structureProvenanceSchema>;

export const energeticsDataSchema = z.object({
  foldx: nullableFiniteNumber,
  foldxMean: nullableFiniteNumber.optional(),
  foldxSd: nullableFiniteNumber.optional(),
  vdw: nullableFiniteNumber.optional(),
  electrostatics: nullableFiniteNumber.optional(),
  stericClashWarning: z.boolean().optional(),
  localSidechainRmsd: nullableFiniteNumber.optional(),
  foldxRepairFailed: z.boolean().optional(),
  foldxBinaryMissing: z.boolean().optional(),
  foldxError: z.string().nullable().optional(),
  dynamut2: nullableFiniteNumber.optional(),
  ddmut: nullableFiniteNumber.optional(),
  rasp: nullableFiniteNumber.optional(),
  thermompnn: nullableFiniteNumber.optional(),
  consensusVerdict: z.string().nullable().optional(),
  raspReason: z.string().optional(),
  evidenceComplete: z.boolean().optional(),
  pendingTools: z.array(z.string()).optional(),
  rawDdGs: z.array(z.number()).nullable().optional(),
  stabilityoracle: nullableFiniteNumber.optional(),
  consensusProbability: nullableFiniteNumber.optional(),
  consensusConfMin: nullableFiniteNumber.optional(),
  consensusConfMax: nullableFiniteNumber.optional(),
  seed: nullableFiniteNumber.optional(),
  bFactorMetadata: z.object({
    source: z.string(),
    semantic: z.string(),
    inherited: z.boolean()
  }).nullable().optional(),
  structureProvenance: structureProvenanceSchema.nullable().optional()
}).passthrough();

export type EnergeticsData = z.infer<typeof energeticsDataSchema>;

// ============================================================================
// 3. Language Model Evaluations (ESM-C, ESM-2, SaProt)
// ============================================================================
export const esmcPreferenceSchema = z.object({
  aa: z.string(),
  prob: z.number()
});

export const esmcLocalShiftSchema = z.object({
  position: z.number(),
  residue: z.string(),
  shift: z.number()
});

export const esmcEvalResultSchema = z.object({
  wtProbability: z.number().optional(),
  mutProbability: z.number().optional(),
  llr: z.number().optional(),
  preferences: z.array(esmcPreferenceSchema).optional(),
  mutRank: z.number().optional(),
  positionalEntropy: z.number().optional(),
  embeddingShift: z.number().optional(),
  localEmbeddingShift: z.number().optional(),
  localShiftMap: z.array(esmcLocalShiftSchema).optional(),
  klDivergence: z.number().nullable().optional(),
  conformationState: z.string().nullable().optional(),
  provenance: z.string().optional(),
  error: z.string().optional(),
  status: z.string().optional()
});

export const modelEvalErrorSchema = z.object({
  error: z.string(),
  status: z.string().optional()
});

export type ModelEvalError = z.infer<typeof modelEvalErrorSchema>;

export type EsmcPreference = z.infer<typeof esmcPreferenceSchema>;
export type EsmcLocalShift = z.infer<typeof esmcLocalShiftSchema>;
export type EsmcEvalResult = z.infer<typeof esmcEvalResultSchema>;

// ============================================================================
// 4. Translate Variant & Resolve Gene Contracts
// ============================================================================
export const translateVariantRequestSchema = z.object({
  variant: z.string()
});

export const translateVariantResponseSchema = z.object({
  gene: z.string(),
  variant: z.string(),
  uniprotId: z.string(),
  transcriptId: z.string().optional(),
  isManeSelect: z.boolean().optional(),
  isManePlusClinical: z.boolean().optional(),
  /**
   * ENSEMBL canonical (VEP's `canonical` flag), NOT "numbered on the canonical UniProt isoform".
   * A MANE Select transcript is routinely the Ensembl canonical one while being numbered on a
   * different UniProt isoform, so this flag must never be read as a statement about numbering —
   * `numberingBasis`/`numberingVerified` are the fields that answer that.
   */
  isCanonical: z.boolean().optional(),
  maneRefSeqId: z.string().optional(),
  transcriptWarning: z.string().optional(),
  /** UniProt isoform the returned `variant` is numbered on (normally the canonical isoform). */
  uniprotIsoform: z.string().optional(),
  /**
   * Protein accession the numbering follows when the provider named no UniProt isoform
   * (VariantValidator reports `NP_…`). Present so an `unverified` basis is still checkable.
   */
  numberingProteinId: z.string().optional(),
  /**
   * How the numbering basis was established: `canonical` (verified against the canonical
   * accession), `remapped` (renumbered onto it), or `unverified` (the provider stated no basis,
   * so residue numbers may not match the canonical sequence). `unsupported` is never returned
   * with 200 — it is a 422 `ISOFORM_NUMBERING_MISMATCH`.
   */
  numberingBasis: z.enum(["canonical", "remapped", "unverified"]).optional(),
  /** False only for `unverified`; mirrored as a boolean so callers can gate on it directly. */
  numberingVerified: z.boolean().optional(),
  numberingUnverifiedReason: z.string().optional(),
  /**
   * Present when the MANE-resolved notation was renumbered onto the canonical UniProt
   * isoform, because the upstream structural pipeline (AlphaFold DB / PDB) models only
   * canonical sequences. Records both notations so a report can state what changed.
   */
  numberingRemap: z
    .object({
      reason: z.string(),
      from: z.object({
        hgvsp: z.string().optional(),
        transcriptId: z.string().optional(),
        isoform: z.string().optional(),
        maneRefSeqId: z.string().optional(),
        /**
         * Protein accession the ORIGINAL notation was numbered on, when it named one
         * (`NP_001032248.1`). Distinct from `isoform` (`Q9Y305-4`): for an accession-qualified
         * input it is the identifier a lab report used, and dropping it from this schema silently
         * removed it from the audit record on the client.
         */
        accession: z.string().optional(),
      }),
      to: z.object({
        hgvsp: z.string().optional(),
        transcriptId: z.string().optional(),
        isoform: z.string().optional(),
      }),
    })
    .optional(),
  genomicCoordinates: z.string().nullable().optional(),
  /** Genome build the notation was resolved against, from an inline "(GRCh38)" annotation. */
  assembly: z.enum(["GRCh37", "GRCh38"]).optional(),
  /** Canonical form of the submitted notation after normalization (annotation stripped). */
  notationNormalized: z.string().optional(),
  /** Present when an inline assembly annotation redirected the query (e.g. to GRCh37). */
  assemblyNote: z.string().optional(),
  /**
   * Which resolution provider answered, whether a fallback was used, and what else was
   * attempted. Offline-verifiable provenance for a clinical audit trail.
   */
  provenance: z
    .object({
      provider: z.string(),
      providerLabel: z.string(),
      usedFallback: z.boolean(),
      cacheHit: z.boolean(),
      attempts: z.array(
        z.object({
          provider: z.string(),
          ok: z.boolean(),
          durationMs: z.number(),
          reason: z.string().optional(),
          failureKind: z.string().optional()
        })
      )
    })
    .optional()
});

export const resolveGeneRequestSchema = z.object({
  gene: z.string()
});

export const resolveGeneResponseSchema = z.object({
  gene: z.string(),
  uniprotId: z.string(),
  pdbUrl: z.string().nullable().optional()
});

export type TranslateVariantRequest = z.infer<typeof translateVariantRequestSchema>;
export type TranslateVariantResponse = z.infer<typeof translateVariantResponseSchema>;
export type ResolveGeneRequest = z.infer<typeof resolveGeneRequestSchema>;
export type ResolveGeneResponse = z.infer<typeof resolveGeneResponseSchema>;

// ============================================================================
// 5. Nearest Residues Contract
// ============================================================================
export const nearestResiduesRequestSchema = z.object({
  pdbText: z.string().optional(),
  pdbRef: z.string().optional(),
  uniprotId: z.string().optional(),
  targetIndex: z.number(),
  distanceThreshold: z.number().positive().optional(),
  targetChain: z.string().optional()
}).refine(data => Boolean(data.pdbText || data.pdbRef || data.uniprotId), {
  message: "Either pdbText, pdbRef, or uniprotId must be provided."
});

export const nearestResidueItemSchema = z.object({
  index: z.number(),
  name: z.string(),
  distance: z.number(),
  properties: z.string(),
  role: z.string(),
  classBadge: z.string()
});

export const nearestResiduesResponseSchema = z.object({
  residues: z.array(nearestResidueItemSchema),
  source: z.string()
});

export type NearestResiduesRequest = z.infer<typeof nearestResiduesRequestSchema>;
export type NearestResiduesResponse = z.infer<typeof nearestResiduesResponseSchema>;

// ============================================================================
// 6. Pocket Finder / Pocket Detect Contract
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
  status: z.enum(["success", "fallback", "none_detected", "unavailable"]).catch("unavailable"),
  pocketDistance: z.number().nullable().optional(),
  /**
   * Distance to P2Rank's own cavity centre (`center_x/y/z`), which the client
   * prefers over `pocketDistance` — the latter is measured to the centroid of the
   * pocket's residues and grows with pocket size. Absent for fpocket results and
   * for payloads cached before the field existed.
   */
  cavityCentreDistance: z.number().nullable().optional(),
  sasPoints: z.number().optional(),
  surfaceAtoms: z.number().optional(),
  /**
   * Where the ambiguous numbers came from. `pocketScore` may be a calibrated
   * probability or a rescaled raw score, and `pocketVolume` a measured volume or
   * nothing at all; the client refuses to print a unit or a probability label it
   * cannot vouch for. Absent means unverified, never assumed.
   */
  provenance: z
    .object({
      engine: z.enum(["p2rank", "fpocket"]).optional(),
      scoreSource: z.enum(["probability", "rescaled_raw_score", "unavailable"]).optional(),
      volumeSource: z.enum(["measured", "unavailable", "scaled_surface_points"]).optional()
    })
    .optional()
});

export type PocketFinderRequest = z.infer<typeof pocketFinderRequestSchema>;
export type PocketFinderResponse = z.infer<typeof pocketFinderResponseSchema>;

// ============================================================================
// 7. Biophysical Analysis Contract
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
  biochemicalShift: z.string().optional(),
  structuralImpact: z.string().optional(),
  insights: z.object({
    biochemicalShift: z.string().optional(),
    structuralImpact: z.string().optional(),
    plausibility: z.string().optional(),
    acmgCriteria: z.array(z.object({
      code: z.string(),
      reason: z.string()
    })).optional()
  }).nullable().optional(),
  ruleBasedInsights: z.object({
    plausibility: z.string().optional(),
    acmgVerdict: z.string().optional(),
    acmgCriteria: z.array(z.object({
      code: z.string(),
      reason: z.string()
    })).optional()
  }).nullable().optional(),
  metadata: z.object({
    gene: z.string().optional(),
    variant: z.string().optional(),
    uniprotId: z.string().optional(),
    residueIndex: z.number().nullable().optional(),
    wildType: z.string().optional(),
    mutant: z.string().optional()
  }).optional()
}).passthrough().transform((data: any) => {
  const shift = data.insights?.biochemicalShift || data.biochemicalShift;
  const impact = data.insights?.structuralImpact || data.structuralImpact;
  return {
    ...data,
    insights: data.insights || (shift || impact ? {
      biochemicalShift: shift || "",
      structuralImpact: impact || "",
      plausibility: data.insights?.plausibility,
      acmgCriteria: data.insights?.acmgCriteria || []
    } : null)
  };
});

export type BiophysicalAnalysisRequest = z.infer<typeof biophysicalAnalysisRequestSchema>;
export type BiophysicalAnalysisResponse = z.infer<typeof biophysicalAnalysisResponseSchema>;

// ============================================================================
// 8. ESMFold Contract
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
// 9. Structural Align Contract
// ============================================================================
export const structuralAlignRequestSchema = z.object({
  pdb1: z.string(),
  pdb2: z.string(),
  targetIndex: z.number().optional(),
  alignmentScope: z.enum(["local", "global"]).optional()
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

// ============================================================================
// 10. Predictor & Conservation Canonical Domain Contracts
// ============================================================================
export const predictorDataSchema = z.object({
  available: z.boolean().optional(),
  amPathogenicity: z.number().nullable(),
  amClass: z.string().nullable(),
  caddPhred: z.number().nullable(),
  gnomadVariantId: z.string().nullable().optional(),
  /**
   * Genome build that `gnomadVariantId`'s numeric coordinates belong to.
   *
   * REQUIRED TO BE EXPLICIT, and deliberately nullable. The id is produced two ways and they
   * disagree: the Ensembl VEP path queries the GRCh38 host, while the MyVariant.info fallback
   * parses `hit._id`, which is hg19 by default and carries no build marker. Several downstream
   * sources are single-build (GPN-Star, local dbNSFP, Genos, dbnsfp.org, gnomAD r4, AlphaGenome,
   * and one SpliceAI service per build), and a wrong-build coordinate does not merely miss —
   * when the other build's base at that numeric position coincides, it scores a DIFFERENT LOCUS
   * and the result is attributed to this variant.
   *
   * `null` therefore means "build unknown" and must never be treated as a default: an inferred
   * build is indistinguishable from a verified one, which is exactly how the wrong-locus case
   * slipped through. Consumers refuse a coordinate with an unknown or unsupported build.
   */
  gnomadVariantAssembly: z.enum(["GRCh37", "GRCh38"]).nullable().optional(),
  proteinName: z.string().nullable().optional(),
  transcriptId: z.string().optional(),
  isManeSelect: z.boolean().optional(),
  isManePlusClinical: z.boolean().optional(),
  isCanonical: z.boolean().optional(),
  maneRefSeqId: z.string().optional(),
  transcriptWarning: z.string().nullable().optional(),
  source: z.string().optional()
});

export const alphagenomeAviSchema = z.object({
  status: z.enum(["live", "unavailable", "pending"]).default("unavailable"),
  aviPhred: z.number().nullable().optional(),
  aviRaw: z.number().nullable().optional(),
  aviQuantile: z.number().nullable().optional(),
  topPercentile: z.number().nullable().optional(),
  topModality: z.string().nullable().optional(),
  topFeatureImportance: z.number().nullable().optional(),
  featureAttributions: z.record(z.string(), z.number()).nullable().optional(),
  acmgStrength: z.enum([
    "PP3_Strong",
    "PP3_Moderate",
    "PP3_Supporting",
    "BP4_Supporting",
    "BP4_Moderate",
    "indeterminate"
  ]).default("indeterminate"),
  atlasUrl: z.string().optional(),
  message: z.string().nullable().optional()
}).nullable();

export type AlphaGenomeAviData = z.infer<typeof alphagenomeAviSchema>;

export const alphaGenomeRegionSaturationRequestSchema = z.object({
  chrom: z.string(),
  start: z.number().int().positive(),
  end: z.number().int().positive(),
  transcriptId: z.string().optional(),
  strand: z.enum(["+", "-"]).optional(),
  exonNumber: z.number().int().optional(),
  exonStart: z.number().int().optional(),
  exonEnd: z.number().int().optional()
}).refine((data) => data.start <= data.end, {
  message: "start must be less than or equal to end",
  path: ["end"]
}).refine((data) => (data.end - data.start) <= 5000, {
  message: "Genomic window size cannot exceed 5,000 bp",
  path: ["end"]
});
export type AlphaGenomeRegionSaturationRequest = z.infer<typeof alphaGenomeRegionSaturationRequestSchema>;

export const alphaGenomeSaturationVariantSchema = z.object({
  alt: z.enum(["A", "C", "G", "T"]),
  phred: z.number().nullable(),
  raw: z.number().nullable().optional(),
  acmgStrength: z.enum([
    "PP3_Strong",
    "PP3_Moderate",
    "PP3_Supporting",
    "BP4_Supporting",
    "BP4_Moderate",
    "indeterminate"
  ]),
  topModality: z.string().nullable().optional()
});
export type AlphaGenomeSaturationVariant = z.infer<typeof alphaGenomeSaturationVariantSchema>;

export const alphaGenomeSaturationPositionSchema = z.object({
  pos: z.number().int().positive(),
  ref: z.enum(["A", "C", "G", "T"]),
  isExonic: z.boolean(),
  codonIndex: z.number().int().nullable().optional(),
  codonPosition: z.number().int().min(1).max(3).nullable().optional(),
  variants: z.record(z.string(), alphaGenomeSaturationVariantSchema),
  meanPhred: z.number().nullable(),
  maxPhred: z.number().nullable(),
  topModality: z.string().nullable().optional()
});
export type AlphaGenomeSaturationPosition = z.infer<typeof alphaGenomeSaturationPositionSchema>;

export const alphaGenomeRegionSaturationResponseSchema = z.object({
  status: z.enum(["live", "unavailable", "pending"]),
  chrom: z.string(),
  start: z.number(),
  end: z.number(),
  strand: z.enum(["+", "-"]).nullable().optional(),
  transcriptId: z.string().nullable().optional(),
  exonNumber: z.number().nullable().optional(),
  exonStart: z.number().nullable().optional(),
  exonEnd: z.number().nullable().optional(),
  positions: z.array(alphaGenomeSaturationPositionSchema),
  atlasLocusUrl: z.string().optional(),
  message: z.string().nullable().optional()
});
export type AlphaGenomeRegionSaturationResponse = z.infer<typeof alphaGenomeRegionSaturationResponseSchema>;

export interface AtlasUrls {
  variantUrl: string;
  trackPredictionsUrl: string;
  locusUrl: string;
  variantStr: string;
}

/**
 * Robustly parses genomic coordinate strings in hyphen, colon, or Ensembl notation:
 * e.g., "chr9:128225994:G>A", "9-128225994-G-A", "chr11:5225488:A-T".
 */
export function parseGenomicCoordinateString(rawId?: string | null): { chrom: string; pos: number; ref: string; alt: string } | null {
  if (!rawId || typeof rawId !== "string") return null;
  const parts = rawId.trim().replace(/[:>/_]/g, "-").split("-");
  if (parts.length >= 4) {
    const chrom = parts[0];
    const pos = parseInt(parts[1], 10);
    const ref = parts[2].toUpperCase();
    const alt = parts[3].toUpperCase();
    const validChrom = /^(chr)?([1-9]|1\d|2[0-2]|X|Y|M|MT)$/i.test(chrom);
    const validBases = /^[ACGTN]+$/.test(ref) && /^[ACGTN]+$/.test(alt);
    if (validChrom && !isNaN(pos) && pos > 0 && validBases) {
      return { chrom, pos, ref, alt };
    }
  }
  return null;
}

/**
 * Constructs validated deep-link URLs to the Google DeepMind AlphaGenome Atlas with RFC 3986 encoding.
 */
export function generateAtlasUrls(
  chrom: string,
  pos: number,
  ref: string,
  alt: string,
  flankBp = 20000
): AtlasUrls {
  const normChrom = chrom.toLowerCase().startsWith("chr") ? chrom : `chr${chrom}`;
  const variantStr = `${normChrom}:${pos}:${ref.toUpperCase()}>${alt.toUpperCase()}`;
  const encodedVariant = variantStr.replace(/>/g, "%3E");

  const startCoord = Math.max(1, pos - flankBp);
  const endCoord = pos + flankBp;
  const intervalStr = `${normChrom}:${startCoord}-${endCoord}`;

  return {
    variantUrl: `https://deepmind.google.com/science/alphagenome/atlas/variant/${encodedVariant}`,
    trackPredictionsUrl: `https://deepmind.google.com/science/alphagenome/atlas/track-predictions?v=${encodedVariant}`,
    locusUrl: `https://deepmind.google.com/science/alphagenome/atlas/locus?interval=${intervalStr}`,
    variantStr
  };
}

export const conservationDataSchema = z.object({
  available: z.boolean().optional(),
  revel: z.number().nullable(),
  gerp: z.number().nullable(),
  phylop: z.number().nullable(),
  consurf: z.number().nullable(),
  bayesdel: z.number().nullable().optional(),
  metarnn: z.number().nullable().optional(),
  metarnnPred: z.string().nullable().optional(),
  clinpred: z.number().nullable().optional(),
  clinpredPred: z.string().nullable().optional(),
  eigenPhred: z.number().nullable().optional(),
  eigenRaw: z.number().nullable().optional(),
  dann: z.number().nullable().optional(),
  esm1b: z.number().nullable().optional(),
  esm1bPred: z.string().nullable().optional(),
  popeve: z.number().nullable().optional(),
  gpnStar: z.number().nullable().optional(),
  gpnStarStatus: z.enum(["live", "token_required", "unavailable"]).optional(),
  gpnStarMessage: z.string().nullable().optional(),
  aouFrequency: z.object({
    aouAC: z.number().nullable(),
    aouAN: z.number().nullable(),
    aouHet: z.number().nullable(),
    aouHom: z.number().nullable(),
    aouAF: z.number().nullable().optional()
  }).nullable().optional(),
  spliceProximity: z.object({
    distance: z.number(),
    isNearSpliceSite: z.boolean(),
    /**
     * Nearest boundary is a genuine exon/intron junction (donor/acceptor), not a
     * transcript terminus. Optional so payloads predating the field still parse.
     */
    isCanonicalJunction: z.boolean().optional(),
    exonNumber: z.number().nullable().optional(),
    totalExons: z.number().nullable().optional(),
    exonId: z.string().nullable().optional(),
    exonStart: z.number().nullable().optional(),
    exonEnd: z.number().nullable().optional(),
    exonLength: z.number().nullable().optional(),
    intronNumber: z.number().nullable().optional(),
    junctionType: z.enum(["donor", "acceptor", "terminal"]).nullable().optional(),
    adjacentIntronNumber: z.number().nullable().optional(),
    regionType: z.enum(["exonic", "intronic"]).nullable().optional(),
    strand: z.enum(["+", "-"]).nullable().optional(),
    transcriptId: z.string().nullable().optional(),
    genomicPos: z.number().nullable().optional(),
    nearestJunctionCoord: z.number().nullable().optional(),
    mutationPosition: z.number().nullable().optional(),
    closestBoundary: z.enum(["start", "end", "unknown"]).optional(),
    closestSpliceType: z.enum(["acceptor", "donor", "unknown"]).optional()
  }).nullable().optional(),
  spliceai: z.object({
    ds_ag: z.number().nullable(),
    ds_al: z.number().nullable(),
    ds_dg: z.number().nullable(),
    ds_dl: z.number().nullable(),
    max_ds: z.number().nullable(),
    /**
     * Where splicing changes relative to the variant (negative = upstream). A large |dp|
     * alongside a small delta score is the signature of a variant far from any junction,
     * which the delta score alone cannot convey. Absent for payloads scored before the
     * Broad Lookup API became the source.
     */
    dp: z.object({
      ds_ag: z.number().nullable(),
      ds_al: z.number().nullable(),
      ds_dg: z.number().nullable(),
      ds_dl: z.number().nullable()
    }).optional(),
    /**
     * Provenance for the score, so a reader can tell a live model computation from a
     * frozen precomputed table. Illumina's precomputed columns were generated against
     * GENCODE v24 with a 50 bp reporting window; the Broad Lookup API computes against a
     * current annotation. Those differences move scores, so the source must be visible.
     */
    provenance: z.object({
      /** "broad-lookup" (live) or "precomputed-dbnsfp" (frozen table). */
      source: z.enum(["broad-lookup", "precomputed-dbnsfp", "genos"]),
      /** Reporting window the score was produced under (SpliceAI -D). */
      distanceBp: z.number().nullable().optional(),
      /** 1 = masked (recommended for interpretation), 0 = raw. */
      masked: z.number().nullable().optional(),
      /** True when the model ran for this request rather than a table answering. */
      computedLive: z.boolean().optional(),
      annotationSet: z.string().nullable().optional()
    }).optional()
  }).nullable().optional(),
  dbscsnv: z.object({
    ada_score: z.number().nullable(),
    rf_score: z.number().nullable()
  }).nullable().optional(),
  alphagenome: alphagenomeAviSchema.optional(),
  source: z.string().optional()
});

export type PredictorData = z.infer<typeof predictorDataSchema>;
export type ConservationData = z.infer<typeof conservationDataSchema>;

// ============================================================================
// 11. Generate Mutant & Full Pipeline Analysis Response Schemas
// ============================================================================
export const generateMutantResponseSchema = z.object({
  pdb: z.string().nullable().optional(),
  ddG: nullableFiniteNumber,
  status: z.string(),
  error: z.string().nullable().optional(),
  foldedResidueIndex: nullableFiniteNumber.optional(),
  foldxJobId: z.string().nullable().optional(),
  energetics: energeticsDataSchema.optional(),
  dynamut2JobId: z.string().nullable().optional(),
  dynamut2Status: z.string().nullable().optional(),
  ddmutJobId: z.string().nullable().optional(),
  ddmutStatus: z.string().nullable().optional(),
  thermompnnJobId: z.string().nullable().optional(),
  thermompnnStatus: z.string().nullable().optional(),
  thermompnnError: z.string().nullable().optional(),
  provenance: structureProvenanceSchema.passthrough().optional()
}).passthrough();

export type GenerateMutantResponse = z.infer<typeof generateMutantResponseSchema>;

export const analyzeVariantResponseSchema = z.object({
  analysis: z.string().nullable().optional(),
  isFallback: z.boolean().optional(),
  fallbackReason: z.string().optional(),
  fallbackMessage: z.string().optional(),
  fallbackRetryable: z.boolean().optional(),
  providerDetail: z.string().optional(),
  attemptedModels: z.array(z.string()).optional(),
  insights: z.object({
    biochemicalShift: z.string(),
    structuralImpact: z.string(),
    pathogenicity: z.string().optional(),
    plausibility: z.string().optional(),
    acmgCriteria: z.preprocess(
      (val) => val ?? [],
      z.array(acmgCriteriaItemSchema)
    ),
    acmgVerdict: z.string().optional(),
    partialEvidence: z.object({
      available: z.array(z.string()),
      unavailable: z.array(z.string())
    }).optional()
  }).nullable().optional(),
  ruleBasedInsights: z.object({
    plausibility: z.string(),
    acmgVerdict: z.string(),
    acmgCriteria: z.array(acmgCriteriaItemSchema),
    partialEvidence: z.object({
      available: z.array(z.string()),
      unavailable: z.array(z.string())
    }).optional()
  }).nullable().optional(),
  clinvar: clinVarDataSchema.nullable().optional(),
  metadata: z.object({
    gene: z.string(),
    variant: z.string(),
    uniprotId: z.string(),
    residueIndex: nullableFiniteNumber,
    wildType: z.string(),
    mutant: z.string(),
    pdbId: z.string().nullable().optional(),
    pdbSource: z.string().nullable().optional(),
    sequence: z.string().nullable().optional(),
    serviceTimings: z.record(z.string(), z.number()).optional(),
    serviceStatus: z.record(z.string(), z.string()).optional()
  }).passthrough(),
  predictorData: predictorDataSchema.nullable().optional(),
  conservationData: conservationDataSchema.nullable().optional(),
  landscapeData: z.array(z.object({
    residx: z.number(),
    revelMean: z.number().nullable().optional(),
    revelMedian: z.number().nullable().optional(),
    revelMin: z.number().nullable().optional(),
    revelMax: z.number().nullable().optional(),
    revelCount: z.number().optional(),
    amMean: z.number().nullable().optional(),
    amMedian: z.number().nullable().optional(),
    amMin: z.number().nullable().optional(),
    amMax: z.number().nullable().optional(),
    amCount: z.number().optional(),
    gerp: z.number().nullable(),
    phylop: z.number().nullable()
  })).nullable().optional(),
  stringInteractions: z.array(z.object({
    partner: z.string(),
    score: finiteNumber
  })).nullable().optional(),
  disruptionPredictor: z.object({
    level: z.enum(["high", "low", "unknown"]),
    reason: z.string(),
    plddt: z.number().nullable(),
    burialStatus: z.enum(["core", "surface", "boundary"]).optional(),
    neighborCount: z.number().optional(),
    rsa: z.number().nullable().optional(),
    sasa: z.number().nullable().optional()
  }).optional(),
  uniprotFeatures: z.object({
    features: z.array(z.object({
      type: z.string(),
      description: z.string(),
      start: z.number(),
      end: z.number(),
      interproId: z.string().optional()
    })),
    geneName: z.string().optional(),
    subunitComment: z.string().nullable().optional(),
    isMultimer: z.boolean().optional(),
    sequenceLength: z.number().optional()
  }).nullable().optional(),
  gnomadConstraint: z.object({
    missense_z: z.number().nullable(),
    oe_mis: z.number().nullable(),
    pli: z.number().nullable(),
    loeuf: z.number().nullable().optional(),
    isPP2Constrained: z.boolean(),
    hasRegionalData: z.boolean().optional(),
    regionalConstraint: z.object({
      isConstrained: z.boolean(),
      oeRatio: z.number().nullable(),
      pValue: z.number().nullable(),
      regionText: z.string().nullable()
    }).nullable().optional()
  }).nullable().optional(),
  transcriptId: z.string().nullable().optional(),
  isManeSelect: z.boolean().optional(),
  isManePlusClinical: z.boolean().optional(),
  isCanonical: z.boolean().optional(),
  maneRefSeqId: z.string().nullable().optional(),
  transcriptWarning: z.string().nullable().optional(),
  /**
   * Numbering basis of `metadata.variant`, carried into the analysis result so a report can
   * state which isoform's residue numbers a prediction refers to (and that a remap happened).
   */
  uniprotIsoform: z.string().nullable().optional(),
  numberingBasis: z.enum(["canonical", "remapped", "unverified"]).nullable().optional(),
  /**
   * False when the residue matched the canonical sequence but another isoform numbering could not be
   * ruled out (the isoform model was unreachable). Disclosed rather than silent, and cited by the
   * exported report — the prose twin of `numberingUnverifiedReason` lives in `transcriptWarning`.
   */
  numberingVerified: z.boolean().nullable().optional(),
  numberingUnverifiedReason: z.string().nullable().optional(),
  numberingRemap: z
    .object({
      reason: z.string(),
      from: z.object({
        hgvsp: z.string().optional(),
        transcriptId: z.string().optional(),
        isoform: z.string().optional(),
        maneRefSeqId: z.string().optional(),
        accession: z.string().optional(),
      }),
      to: z.object({
        hgvsp: z.string().optional(),
        transcriptId: z.string().optional(),
        isoform: z.string().optional(),
      }),
    })
    .nullable()
    .optional(),
  gnomadFrequency: z.object({
    maxAF: z.number().nullable(),
    groupMaxAF: z.number().nullable().optional(),
    genomeAF: z.number().nullable(),
    exomeAF: z.number().nullable(),
    genomeAC: z.number().nullable().optional(),
    exomeAC: z.number().nullable().optional(),
    genomeAN: z.number().nullable().optional(),
    exomeAN: z.number().nullable().optional(),
    nHomozygous: z.number().nullable(),
    dataset: z.string()
  }).nullable().optional(),
  aouFrequency: z.object({
    aouAC: z.number().nullable().optional(),
    aouAN: z.number().nullable().optional(),
    aouHet: z.number().nullable().optional(),
    aouHom: z.number().nullable().optional()
  }).nullable().optional(),
  esm2: z.object({
    llr: z.number().nullable(),
    verdict: z.string().nullable().optional()
  }).nullable().optional(),
  esm3Eval: z.union([
    z.object({
      uniprotId: z.string().optional(),
      position: z.number().optional(),
      wtResidue: z.string().optional(),
      mutResidue: z.string().optional(),
      pdbText: z.string().nullable().optional(),
      perturbationScores: z.array(z.number()).optional(),
      maxDriftResidue: z.number().optional(),
      structuralChangeLevel: z.enum(["none", "minor", "moderate", "major"]).optional(),
      microenvironments: z.array(z.string()).optional(),
      putativeStructuralChanges: z.array(z.string()).optional(),
      confidence: z.object({
        level: z.enum(["high", "moderate", "low"]),
        plddt: z.number().nullable().optional(),
        sequenceCoverage: z.number().nullable().optional()
      }).optional(),
      provenance: z.string().optional(),
      status: z.string().optional()
    }).passthrough(),
    z.object({
      error: z.string(),
      status: z.string().optional()
    })
  ]).nullable().optional(),
  esmcEval: esmcEvalResultSchema.nullable().optional(),
  esm2Eval: esmcEvalResultSchema.nullable().optional(),
  saprotEval: esmcEvalResultSchema.nullable().optional(),
  serviceTimings: z.record(z.string(), z.number()).optional(),
  serviceStatus: z.record(z.string(), z.string()).optional()
}).passthrough();

export type AnalyzeVariantResponse = z.infer<typeof analyzeVariantResponseSchema>;

// ============================================================================
// 17. Shared Wire & Payload Models
// ============================================================================

export interface NearestResidue {
  name: string;
  distance: string;
  properties: string;
  role: string;
  classBadge: string;
  source?: "curated" | "computed";
}

export interface PdbHomolog {
  pdbId: string;
  score: number;
  identity: number;
  coverage: number;
  title: string;
  organism: string;
  method: string;
  resolution: number | null;
  isHuman: boolean;
  unpStart?: number;
  structStart?: number;
  querySeqFrom?: number;
  querySeqTo?: number;
  coversPosition?: boolean;
}

export interface VariantMetadata {
  gene: string;
  variant: string;
  uniprotId: string;
  residueIndex: number | null;
  wildType: string;
  mutant: string;
  acmgWeighting?: string;
  pdbId?: string | null;
  pdbSource?: string | null;
  alternativeVariants?: any;
  mutatedSequence?: string | null;
  analysisVersion?: {
    thresholds: string;
    geminiModel: string;
    foldxVersion: string;
    timestamp: string;
  } | null;
  serviceStatus?: Record<string, string>;
}

/**
 * One way a genuinely ambiguous protein notation can be read, as returned in the
 * `AMBIGUOUS_PROTEIN_NUMBERING` error's `details.candidates`.
 *
 * This is what turns a refusal into a decision: each candidate is already expressed in CANONICAL
 * numbering, which is the notation the whole pipeline downstream expects, so choosing one is just a
 * re-submit — no client-side translation and no second source of truth.
 */
export const numberingChoiceSchema = z.object({
  /** Canonical-numbered substitution to submit if the user means this reading. */
  variant: z.string(),
  /** Protein whose numbering this reading follows (`Q9Y305` canonical, `Q9Y305-4` an isoform). */
  basisId: z.string(),
  basisKind: z.enum(["canonical", "isoform"]),
  canonicalPosition: z.number(),
  /** Human label for a chooser, e.g. "Canonical numbering (Q9Y305)". */
  label: z.string().optional(),
});
export type NumberingChoice = z.infer<typeof numberingChoiceSchema>;

export interface TranscriptMetadata {
  transcriptId?: string | null;
  isManeSelect?: boolean;
  isManePlusClinical?: boolean;
  isCanonical?: boolean;
  maneRefSeqId?: string | null;
  transcriptWarning?: string | null;
  /**
   * Numbering provenance of the variant these predictions refer to.
   *
   * Declared on the INTERFACE, not only on the Zod schema: `pipelineStateFactory` spread these
   * fields into every analysis result, but a type that did not name them meant no consumer could
   * read them without a cast — which is how a structured remap record came to be "carried" into
   * reports that never actually cited it.
   */
  uniprotIsoform?: string | null;
  numberingBasis?: "canonical" | "remapped" | "unverified" | null;
  numberingVerified?: boolean | null;
  /** Machine-readable reason the numbering is unverified; the prose twin is `transcriptWarning`. */
  numberingUnverifiedReason?: string | null;
  numberingRemap?: {
    reason: string;
    from: {
      hgvsp?: string;
      transcriptId?: string;
      isoform?: string;
      maneRefSeqId?: string;
      accession?: string;
    };
    to: { hgvsp?: string; transcriptId?: string; isoform?: string };
  } | null;
}

export type AcmgVerdict = "Pathogenic" | "Likely Pathogenic" | "VUS" | "Likely Benign" | "Benign";

export interface ClinicalInsight {
  biochemicalShift: string;
  structuralImpact: string;
  acmgCriteria: ACMGCriteriaItem[];
  pathogenicity?: string;
  plausibility?: string;
  acmgVerdict?: AcmgVerdict;
  partialEvidence?: { available: string[]; unavailable: string[] };
}

export interface RuleBasedInsights {
  plausibility: string;
  acmgVerdict: AcmgVerdict;
  acmgCriteria: ACMGCriteriaItem[];
  partialEvidence?: { available: string[]; unavailable: string[] };
}

export interface LandscapeResidueItem {
  residx: number;
  revelMean?: number | null;
  revelMedian?: number | null;
  revelMin?: number | null;
  revelMax?: number | null;
  revelCount?: number;
  amMean?: number | null;
  amMedian?: number | null;
  amMin?: number | null;
  amMax?: number | null;
  amCount?: number;
  gerp: number | null;
  phylop: number | null;
  consurf?: number | null;
  residue?: string;
}

export interface StringInteractionItem {
  partner: string;
  score: number;
}

export interface Esm3EvalResult {
  uniprotId: string;
  position: number;
  wtResidue: string;
  mutResidue: string;
  pdbText: string | null;
  perturbationScores: number[];
  maxDriftResidue: number;
  structuralChangeLevel: "none" | "minor" | "moderate" | "major";
  microenvironments: string[];
  putativeStructuralChanges: string[];
  confidence: {
    level: "high" | "moderate" | "low";
    plddt?: number | null;
    sequenceCoverage?: number | null;
  };
}

export interface Esm2ScoreData {
  llr: number | null;
  verdict: string | null;
}

export interface BiophysicalModelingData {
  dynamut2?: number | null;
  dynamut2Status?: string | null;
  dynamut2JobId?: string | null;
  ddmut?: number | null;
  ddmutStatus?: string | null;
  ddmutJobId?: string | null;
  rasp?: number | null;
  thermompnn?: number | null;
  thermompnnStatus?: string | null;
  thermompnnJobId?: string | null;
  foldingEnergetics?: EnergeticsData | null;
  biophysicalEnergetics?: any;
}

export interface LanguageModelEvaluations {
  esm3Eval?: Esm3EvalResult | { error: string } | null;
  esmcEval?: EsmcEvalResult | null;
  esm2Eval?: EsmcEvalResult | null;
  saprotEval?: (EsmcEvalResult & { conformationState?: string | null; klDivergence?: number | null; hfError?: string | null }) | null;
  esm2?: Esm2ScoreData | null;
}

export interface PpiBindingData {
  status: "success" | "unavailable" | "failed";
  gene: string;
  variant: string;
  uniprotId?: string;
  stringPartners: Array<{ partner: string; score: number }>;
  bindingShift: {
    ddgBind: number | null;
    unit: string;
    classification: "INTERFACE_DISRUPTIVE" | "ALLOSTERIC_PERTURBATION" | "SURFACE_NEUTRAL" | "UNKNOWN";
    provenance: string;
  } | null;
  interfaceResidues: Array<{
    pos: number;
    description: string;
    isVariantPosition: boolean;
  }>;
  error?: string;
}

export interface MultimerData {
  status: "success" | "monomeric" | "failed";
  gene: string;
  uniprotId: string;
  oligomericState: string;
  chainCount: number;
  chainIds: string[];
  complexPdb: string | null;
  ipTm: number | null;
  pTm: number | null;
  interfaceContacts: Array<{ resA: number; resB: number; distance: number }>;
  mutationInterfaceDisrupted: boolean;
  provenance: string;
  subunitComment?: string | null;
  error?: string;
}

export type UniprotFeatureType = 
  | "DOMAIN" | "REGION" | "ACTIVE_SITE" | "BINDING" | "MUTAGEN" | "DISULFID" | "METAL" | "SITE" 
  | (string & {});

export interface UniprotFeatureItem {
  type: UniprotFeatureType;
  description: string;
  start: number;
  end: number;
  interproId?: string;
}

export interface UniprotFeaturesData {
  features: UniprotFeatureItem[];
  geneName?: string;
  subunitComment?: string | null;
  isMultimer?: boolean;
  sequenceLength?: number;
}

export interface DisruptionPredictorResult {
  level: "high" | "low" | "unknown";
  reason: string;
  plddt: number | null;
  burialStatus?: "core" | "surface" | "boundary";
  neighborCount?: number;
  rsa?: number | null;
  sasa?: number | null;
}

export interface GnomadConstraintData {
  missense_z: number | null;
  oe_mis: number | null;
  pli: number | null;
  loeuf?: number | null;
  isPP2Constrained: boolean;
  hasRegionalData?: boolean;
  regionalConstraint?: {
    isConstrained: boolean;
    oeRatio: number | null;
    pValue: number | null;
    regionText: string | null;
  } | null;
}

export interface GnomadFrequencyData {
  maxAF: number | null;
  groupMaxAF: number | null;
  genomeAF: number | null;
  exomeAF: number | null;
  genomeAC: number | null;
  exomeAC: number | null;
  genomeAN: number | null;
  exomeAN: number | null;
  nHomozygous: number | null;
  dataset: string;
  groupMaxAFIsFallback?: boolean;
}

export interface AouFrequencyData {
  aouAC: number | null;
  aouAN: number | null;
  aouHet: number | null;
  aouHom: number | null;
}

export interface AnalysisResult extends BiophysicalModelingData, TranscriptMetadata, LanguageModelEvaluations {
  /**
   * Present when the run was REFUSED because the notation's numbering is genuinely ambiguous.
   *
   * Each entry is already canonical-numbered, so the UI can offer the readings and re-submit the
   * chosen one — a decision instead of a dead end. Carried on the result (not only in the error
   * string) because the choice has to survive to the component that renders it.
   */
  numberingChoices?: NumberingChoice[] | null;
  /** The ambiguous notation as written, echoed so the prompt can quote it. */
  numberingNotation?: string | null;
  analysis?: string | null;
  isFallback?: boolean;
  /** Stable degradation code — see src/shared/narrativeFallback.ts. */
  fallbackReason?: string;
  /** Safe one-line explanation of the degradation, suitable for clinical UI. */
  fallbackMessage?: string;
  /** Whether re-running the same request may succeed. */
  fallbackRetryable?: boolean;
  /** Sanitized provider diagnostics — surfaced in the Developer Console only. */
  providerDetail?: string;
  /** Models the request attempted, in order. */
  attemptedModels?: string[];
  insights?: ClinicalInsight | null;
  ruleBasedInsights?: RuleBasedInsights | null;
  clinvar?: ClinVarData | null;
  predictorData?: PredictorData | null;
  conservationData?: ConservationData | null;
  landscapeData?: LandscapeResidueItem[] | null;
  stringInteractions?: StringInteractionItem[] | null;
  multimerData?: MultimerData | null;
  ppiBindingData?: PpiBindingData | null;
  isDemoData?: boolean;
  metadata?: VariantMetadata;
  disruptionPredictor?: DisruptionPredictorResult;
  uniprotFeatures?: UniprotFeaturesData | null;
  gnomadConstraint?: GnomadConstraintData | null;
  gnomadFrequency?: GnomadFrequencyData | null;
  aouFrequency?: AouFrequencyData | null;
  serviceStatus?: Record<string, string>;
  inSilicoConcordance?: PredictorConcordance | null;
}

