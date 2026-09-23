/**
 * provenance.ts — Scientific Provenance Manifest Generator
 *
 * Assembles full cryptographic and algorithmic provenance for a variant analysis,
 * including data source releases, foundation model commit SHAs, database schema version,
 * structure resolution metadata, and service statuses.
 */

import type { AnalysisResult, StructureProvenance, EnergeticsData } from "./contracts.ts";
import { variantNumberingView } from "./numbering.ts";

export const PROVENANCE_DATA_SOURCES = {
  dbnsfp: "4.4a",
  /**
   * The dataset the pipeline pins — `gnomad_r4` (`external-api/gnomad.ts:68`).
   *
   * This read "v4.1.0 (GraphQL API)" while `EvidenceInspector` printed "v4.0.0" for the same query:
   * two patch claims, neither requested nor read, exported in a manifest that is attached to a
   * clinical write-up. The major release is what the code establishes.
   */
  gnomad: "r4 (GraphQL API)",
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
  /**
   * Which protein the residue numbers in this manifest belong to.
   *
   * "p.Lys281Asn" is not a complete description of a variant: it is only a variant GIVEN a protein.
   * A lab reports MANE numbering (`Q9Y305-4`), structures are canonical (`Q9Y305`), and the same
   * notation can therefore name two different residues — so an exported report that omits this
   * cannot be re-derived or safely compared with another report.
   */
  numberingProvenance: {
    /**
     * Notation a clinician should read: the source report's numbering when the analysis was converted
     * onto canonical (`p.Lys281Asn`), otherwise the modelled notation.
     */
    reportedNotation: string | null;
    /** The same in a form this platform re-resolves exactly (`Q9Y305-4:p.Lys281Asn`). */
    reportedQualifiedNotation: string | null;
    /** Notation actually modelled, in canonical numbering. */
    modelledNotation: string;
    /** Isoform the returned substitution is numbered on (`variant` in `queryCoordinate`). */
    isoform: string | null;
    basis: "canonical" | "remapped" | "unverified" | null;
    /** Present when the input notation was converted onto canonical numbering. */
    remap: {
      reason: string;
      fromHgvsp?: string | null;
      fromIsoform?: string | null;
      /** Protein accession the input notation was numbered on (`NP_…`), when it named one. */
      fromAccession?: string | null;
      toHgvsp?: string | null;
    } | null;
    /** False when the numbering could not be verified across the gene's isoforms. */
    verified: boolean | null;
    unverifiedReason: string | null;
    /** True when the notation declared its own basis (accession-qualified input). */
    declaredByInput: boolean;
  };
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

/**
 * Reads the numbering provenance off an analysis result.
 *
 * Top-level fields are preferred (the pipeline copies them from the translation or the analysis
 * route) with a fallback to `metadata`, because bundles persisted before those fields were promoted
 * carry them there. `verified` is DERIVED when the run did not state it: `basis: "canonical"` means
 * the numbering was proven to follow the canonical accession, whereas `unverified` means it was not.
 */
function buildNumberingProvenance(
  analysisResult: AnalysisResult | null,
  /** The modelled notation and the accession it was modelled on; the report leads with these. */
  query: { variant: string; uniprotId?: string | null }
): ProvenanceManifest["numberingProvenance"] {
  const meta: any = (analysisResult as any)?.metadata || {};
  const pick = (key: string): any => (analysisResult as any)?.[key] ?? meta?.[key] ?? undefined;

  const basis = (pick("numberingBasis") ?? null) as ProvenanceManifest["numberingProvenance"]["basis"];
  const remap = pick("numberingRemap") ?? null;
  const statedVerified = pick("numberingVerified");

  const view = variantNumberingView({
    variant: query.variant,
    uniprotId: query.uniprotId || meta.uniprotId || null,
    numberingRemap: remap,
  });

  return {
    // Report-first ordering: the manifest is what gets attached to a clinical write-up, so it leads
    // with the notation the source report used and states the modelled basis beside it.
    reportedNotation: view.reported,
    reportedQualifiedNotation: view.reportedQualified,
    modelledNotation: view.modelled,
    isoform: pick("uniprotIsoform") ?? null,
    basis,
    remap: remap
      ? {
          reason: remap.reason,
          fromHgvsp: remap.from?.hgvsp ?? null,
          fromIsoform: remap.from?.isoform ?? null,
          fromAccession: remap.from?.accession ?? null,
          toHgvsp: remap.to?.hgvsp ?? null,
        }
      : null,
    verified:
      typeof statedVerified === "boolean"
        ? statedVerified
        : basis === "canonical"
          ? true
          : basis === "unverified"
            ? false
            : null,
    unverifiedReason: pick("numberingUnverifiedReason") ?? null,
    declaredByInput: Boolean(remap?.from?.accession),
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
    numberingProvenance: buildNumberingProvenance(analysisResult, { variant, uniprotId }),
    dataSources: PROVENANCE_DATA_SOURCES,
    foundationModels: PROVENANCE_MODEL_REVISIONS,
    serviceStatuses: status,
    verdictSummary: {
      acmgVerdict: analysisResult?.ruleBasedInsights?.acmgVerdict || null,
      /**
       * A SUPPLIED context is authoritative — including a `null` verdict.
       *
       * The plain `??` chain made `derivedVerdict: null` indistinguishable from "no context supplied",
       * so a run with no result to derive from fell through to the STORED snapshot: the export stated a
       * verdict the screen had no basis for. That is the same class this function's derived value
       * exists to close, and it is reachable — `variantCache` deliberately persists bundles with
       * `analysisResult: undefined` while keeping `foldingEnergetics` (its persistence guard drops only
       * preliminary and failed ones).
       *
       * The stored field is used ONLY for callers that supply no context at all, which is the case it
       * was always meant for.
       */
      stabilityVerdict: verdictContext
        ? verdictContext.derivedVerdict ?? null
        : foldingEnergetics?.consensusVerdict ?? null,
      // Same rule for the caveat, so a context cannot half-apply: a caller that speaks for the verdict
      // speaks for the fields that qualify it too.
      stabilityEvidenceComplete: verdictContext
        ? verdictContext.evidenceComplete ?? null
        : (foldingEnergetics as any)?.evidenceComplete ?? null,
      pendingEngines: verdictContext
        ? verdictContext.pendingTools ?? []
        : (foldingEnergetics as any)?.pendingTools ?? []
    }
  };
}
