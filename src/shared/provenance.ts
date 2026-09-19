/**
 * provenance.ts — Scientific Provenance Manifest Generator
 *
 * Assembles full cryptographic and algorithmic provenance for a variant analysis,
 * including data source releases, foundation model commit SHAs, database schema version,
 * structure resolution metadata, and service statuses.
 */

import type { AnalysisResult, StructureProvenance, EnergeticsData } from "./contracts.ts";

export const PROVENANCE_DATA_SOURCES = {
  dbnsfp: "4.4a",
  gnomad: "v4.1.0 (GraphQL API)",
  clinvar: "2024-latest (NCBI E-utilities)",
  foldx: "FoldX 5.0 (BuildModel & RepairPDB)",
  cacheSchemaVersion: "v3",
  stackerCalibration: "v1.2 (Calibrated Multi-Model Logistic Stacking)"
};

export const PROVENANCE_MODEL_REVISIONS = {
  "esm2-650m": {
    model: "facebook/esm2_t33_650M_UR50D",
    commitSha: "cd0e03e0586e3f2ff1129b0a1d4fb0fbff87a93a"
  },
  "esm2-150m": {
    model: "facebook/esm2_t30_150M_UR50D",
    commitSha: "1da72517de693da8f869818816c7cf54c46f4ebc"
  },
  "saprot-650m": {
    model: "westlake-repl/SaProt_650M_AF2",
    commitSha: "7ab10f272e276da35154378f44ff5fa3693e5072"
  },
  "vesm-150m": {
    model: "ntranoslab/vesm",
    weights: "VESM_150M.pth"
  }
};

export interface ProvenanceManifest {
  manifestVersion: string;
  generatedAt: string;
  application: {
    name: string;
    version: string;
    repository: string;
  };
  queryCoordinate: {
    gene: string;
    variant: string;
    uniprotId: string;
    acmgWeighting: string;
  };
  structureProvenance: StructureProvenance | null;
  dataSources: typeof PROVENANCE_DATA_SOURCES;
  foundationModels: typeof PROVENANCE_MODEL_REVISIONS;
  serviceStatuses: Record<string, string>;
  verdictSummary: {
    acmgVerdict: string | null;
    stabilityVerdict: string | null;
    /**
     * False when engines were still resolving, so the verdict rests on a partial engine set.
     *
     * The provisionality marker used to live INSIDE `stabilityVerdict` as a
     * " (Preliminary - pending: DynaMut2)" suffix. That suffix was removed to make the field a
     * closed-set value — correctly, since free text in a verdict cannot be compared or typed — but
     * nothing replaced it, so for a while the export carried an incomplete run's verdict with no
     * caveat at all. The caveat belongs in its own fields, where it can be read.
     */
    stabilityEvidenceComplete: boolean | null;
    /** Engines that had not resolved when this manifest was generated, by display name. */
    pendingEngines: string[];
  };
}

export function generateProvenanceManifest(
  gene: string,
  variant: string,
  uniprotId: string,
  analysisResult: AnalysisResult | null,
  settings?: { acmgWeighting?: string },
  foldingEnergetics?: EnergeticsData | null,
  /**
   * Everything about the verdict that only the caller can know.
   *
   * An options object rather than more positional parameters: this started as a single
   * `derivedStabilityVerdict` argument and immediately needed the provisionality facts too, and a
   * nine-parameter function is a signature nobody can call correctly from memory.
   *
   * `derivedVerdict` is the value computed from the CURRENT run state. `foldingEnergetics
   * .consensusVerdict` is a snapshot from when the server committed the FoldX job, and remote engines
   * keep resolving for up to ten minutes after that while the on-screen badge recomputes — so an
   * export built from the stored field could state a verdict the screen contradicts. A stored verdict
   * is a fact about the past; a manifest is a claim about this variant.
   */
  verdictContext?: {
    derivedVerdict?: string | null;
    evidenceComplete?: boolean | null;
    pendingTools?: string[];
  }
): ProvenanceManifest {
  const meta = (analysisResult as any)?.metadata || {};
  const status = (analysisResult as any)?.serviceStatus || meta?.serviceStatus || {};
  const structureProv: StructureProvenance | null =
    (foldingEnergetics as any)?.provenance ||
    (analysisResult as any)?.structureProvenance ||
    (meta?.structureProvenance) ||
    null;

  return {
    manifestVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    application: {
      name: "Missense-Structural-Explorer",
      version: "1.0.0",
      repository: "https://github.com/Huthaifa-HajAhmad/Missense-Structural-Explorer"
    },
    queryCoordinate: {
      gene,
      variant,
      uniprotId: uniprotId || meta.uniprotId || "",
      acmgWeighting: settings?.acmgWeighting || "standard"
    },
    structureProvenance: structureProv,
    dataSources: PROVENANCE_DATA_SOURCES,
    foundationModels: PROVENANCE_MODEL_REVISIONS,
    serviceStatuses: status,
    verdictSummary: {
      acmgVerdict: analysisResult?.ruleBasedInsights?.acmgVerdict || null,
      stabilityVerdict:
        verdictContext?.derivedVerdict ?? foldingEnergetics?.consensusVerdict ?? null,
      stabilityEvidenceComplete:
        verdictContext?.evidenceComplete ?? (foldingEnergetics as any)?.evidenceComplete ?? null,
      pendingEngines:
        verdictContext?.pendingTools ?? (foldingEnergetics as any)?.pendingTools ?? []
    }
  };
}
