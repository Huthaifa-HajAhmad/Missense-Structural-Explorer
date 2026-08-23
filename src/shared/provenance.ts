/**
 * provenance.ts — Scientific Provenance Manifest Generator
 *
 * Assembles full cryptographic and algorithmic provenance for a variant analysis,
 * including data source releases, foundation model commit SHAs, database schema version,
 * structure resolution metadata, and service statuses.
 */

import type { AnalysisResult, StructureProvenance, EnergeticsData, UserSettings } from "../types.ts";

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
  };
}

export function generateProvenanceManifest(
  gene: string,
  variant: string,
  uniprotId: string,
  analysisResult: AnalysisResult | null,
  settings?: UserSettings,
  foldingEnergetics?: EnergeticsData | null
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
      stabilityVerdict: foldingEnergetics?.consensusVerdict || null
    }
  };
}
