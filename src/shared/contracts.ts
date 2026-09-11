import { z } from "zod";

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
  isCanonical: z.boolean().optional(),
  maneRefSeqId: z.string().optional(),
  transcriptWarning: z.string().optional(),
  genomicCoordinates: z.string().nullable().optional()
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
  pocketDistance: z.number().nullable().optional()
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
  proteinName: z.string().nullable().optional(),
  transcriptId: z.string().optional(),
  isManeSelect: z.boolean().optional(),
  isManePlusClinical: z.boolean().optional(),
  isCanonical: z.boolean().optional(),
  maneRefSeqId: z.string().optional(),
  source: z.string().optional()
});

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
  evo2: z.number().nullable().optional(),
  evo2Status: z.enum(["live", "token_required", "unavailable"]).optional(),
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
    max_ds: z.number().nullable()
  }).nullable().optional(),
  dbscsnv: z.object({
    ada_score: z.number().nullable(),
    rf_score: z.number().nullable()
  }).nullable().optional(),
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
      end: z.number()
    })),
    geneName: z.string().optional(),
    subunitComment: z.string().nullable().optional(),
    isMultimer: z.boolean().optional()
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
  transcriptId: z.string().optional(),
  isManeSelect: z.boolean().optional(),
  isManePlusClinical: z.boolean().optional(),
  isCanonical: z.boolean().optional(),
  maneRefSeqId: z.string().optional(),
  transcriptWarning: z.string().optional(),
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
