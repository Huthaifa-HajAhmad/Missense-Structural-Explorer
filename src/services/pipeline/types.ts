import React from "react";
import { PdbHomolog, NearestResidue, DisruptionPredictorResult } from "../../types";
import type { CoordinateLiftRecord, NumberingRemapRecord, StructureProvenance } from "../../shared/contracts";
import type { FoldxProgress } from "../../shared/foldxPhase";

export interface TraceContext {
  activeTraceId: string | null;
  traceStart: number;
  addTraceSpan: (span: any) => void;
  finishTraceRun?: (traceId: string, status: "completed" | "failed") => void;
}

export interface RemoteJobStatuses {
  dynamut2JobId?: string | null;
  dynamut2Status?: "pending" | "unavailable" | "done" | null;
  ddmutJobId?: string | null;
  ddmutStatus?: "pending" | "unavailable" | "done" | null;
  thermompnnJobId?: string | null;
  thermompnnStatus?: "pending" | "unavailable" | "done" | "error" | null;
  thermompnnError?: string | null;
}

export interface PipelineSearchSink {
  setGene: (gene: string) => void;
  setVariant: (variant: string) => void;
  setUniprotId: (uniprotId: string) => void;
  setSearchVal: (searchVal: string) => void;
  setCustomGene: (gene: string) => void;
  setCustomVariant: (variant: string) => void;
  setCustomUniprot: (uniprotId: string) => void;
  setSelectedResidueIndex: (index: number | null) => void;
  addToHistory: (gene: string, variant: string, uniprotId: string) => void;
}

export interface PipelineAnalysisSink {
  setAnalysisState: React.Dispatch<React.SetStateAction<any>>;
  setLoadingStep: (step: string) => void;
  setIsBiophysicalLoading: (loading: boolean) => void;
  setIsStructuralLoading: (loading: boolean) => void;
  setIsClinicalLoading: (loading: boolean) => void;
  setIsNarrativeLoading: (loading: boolean) => void;
}

export interface PipelineBiophysicalSink {
  setIsFolding: (folding: boolean) => void;
  /**
   * The FoldX leg's REAL phase and age, as reported by the worker through the job record.
   *
   * Optional so every existing sink — and every test double built from one — keeps compiling;
   * callers guard with `?.`. A sink that does not accept progress simply renders the spinner as it
   * always did, which is strictly worse than reporting the phase but never wrong.
   */
  setFoldingProgress?: (progress: FoldxProgress | null) => void;
  setFoldingError: (err: string | null) => void;
  setFoldingStatus: (status: string | null) => void;
  setMutantPdb: (pdb: string | null) => void;
  /** FoldX's paired wild type from the same run. Optional, so existing sinks and test doubles compile. */
  setFoldxWtPdb?: (pdb: string | null) => void;
  setFoldedResidueIndex: (index: number | null) => void;
  setFoldingDdG: (ddG: number | null) => void;
  setFoldingEnergetics: React.Dispatch<React.SetStateAction<any>>;
  setDynamut2JobId: (id: string | null) => void;
  setDynamut2Status: (status: "pending" | "unavailable" | "done" | null) => void;
  setDdmutJobId: (id: string | null) => void;
  setDdmutStatus: (status: "pending" | "unavailable" | "done" | null) => void;
  setThermompnnJobId: (id: string | null) => void;
  setThermompnnStatus: (status: "pending" | "unavailable" | "done" | "error" | null) => void;
  setThermompnnError: (err: string | null) => void;
  lastFetchedFoldRef: React.MutableRefObject<string>;
}

export interface PipelineStructureSink {
  setPdbText: (pdb: string | null) => void;
  /** Where `pdbText` came from. FoldX's template is not this; it travels on the run's energetics. */
  setPdbTextProvenance?: (provenance: StructureProvenance | null) => void;
  setComputedPocket: (pocket: any) => void;
  setIsPocketLoading: (loading: boolean) => void;
  setPocketError: (err: string | null) => void;
  setHomologs: React.Dispatch<React.SetStateAction<PdbHomolog[]>>;
  setIsHomologsLoading: (loading: boolean) => void;
  setComputedResiduesCache: React.Dispatch<React.SetStateAction<Record<string, NearestResidue[]>>>;
  setDisruptionPredictor: React.Dispatch<React.SetStateAction<DisruptionPredictorResult | null>> | ((val: DisruptionPredictorResult | null) => void);
  resetViewerState: () => void;
  clearDynaMutPoll: () => void;
  clearDynaMutComparePoll: () => void;
  clearDdmutPoll?: () => void;
  clearDdmutComparePoll?: () => void;
  clearThermoMpnnPoll?: () => void;
  clearThermoMpnnComparePoll?: () => void;
}

export interface PipelineStateSinks {
  search: PipelineSearchSink;
  analysis: PipelineAnalysisSink;
  biophysical: PipelineBiophysicalSink;
  structure: PipelineStructureSink;
}

/**
 * Genome-build provenance of the analysed variant, as carried on an analysis result.
 *
 * The translate route lifts a submitted GRCh37 coordinate onto the canonical build (GRCh38) with a
 * reverse-verified lift before annotating, so ONE variant has two build facts and a reader must be
 * able to tell them apart: `assembly` is the build the SUBMITTED coordinate was expressed in,
 * `resolvedAssembly` is the build the annotation actually came from, `liftedGenomicCoordinates` is
 * the verified canonical locus (hyphen form), and `coordinateLift` is the machine-readable decision
 * that connects them. All optional: a payload that predates the lift policy carries none of them,
 * and a surface must then render exactly what it rendered before.
 *
 * The SHAPE lives in `src/shared/contracts.ts` (it is a subset of `TranscriptMetadata`, which the
 * response schema and the server payload both use) and is re-exported here so the client pipeline
 * has one import path for it. Do not re-declare it: a second copy drifts silently, because every
 * field is optional and a drifted field simply reads as absent.
 */
export type { AssemblyProvenance } from "../../shared/contracts";

export interface TranslatedVariantResult {
  gene: string;
  variant: string;
  uniprotId: string;
  transcriptMeta: {
    transcriptId?: string;
    isManeSelect?: boolean;
    isManePlusClinical?: boolean;
    isCanonical?: boolean;
    maneRefSeqId?: string;
    transcriptWarning?: string;
    /** UniProt isoform the analysed `variant` is numbered on (normally the canonical isoform). */
    uniprotIsoform?: string;
    /** canonical | remapped | unverified — how that numbering basis was established. */
    numberingBasis?: string;
    /** Present only for `unverified`: why the basis could not be tied to the canonical isoform. */
    numberingUnverifiedReason?: string;
    /**
     * Set when the MANE-resolved notation was renumbered onto the canonical UniProt isoform
     * (the only sequence with a modellable structure). Carried through so reports can disclose
     * both notations rather than silently presenting a different residue number.
     */
    numberingRemap?: NumberingRemapRecord;
    /** Genome build the notation was resolved against (from an inline "(GRCh38)" annotation). */
    assembly?: string;
    /** Explanation emitted when an inline assembly annotation redirected the query. */
    assemblyNote?: string;
    /**
     * The genomic coordinate the protein notation was translated from (hyphen form, e.g.
     * "X-23723975-C-A"), in the build named by `assembly`. Forwarded with the analysis request
     * so the predictor can query VEP by coordinate; present only for genomic/cDNA inputs.
     */
    genomicCoordinates?: string | null;
    /**
     * The build the returned `variant`/`uniprotId` were ANNOTATED on (equals `assembly` unless a
     * reverse-verified lift moved the coordinate onto the canonical build first).
     */
    resolvedAssembly?: string;
    /**
     * Verified canonical locus (hyphen form) the lift produced. Present only alongside a lift, and
     * forwarded beside — never instead of — the submitted coordinate in `genomicCoordinates`.
     */
    liftedGenomicCoordinates?: string | null;
    /** Lifted | unavailable | not-needed | not-applicable, with both builds and the reason. */
    coordinateLift?: CoordinateLiftRecord | null;
    /** Set when the provider's retired gene symbol was refreshed to the current HGNC one. */
    geneSymbolUpdated?: { from: string; to: string } | null;
  };
  /**
   * Which provider actually answered, and whether the ladder fell back.
   *
   * The server has always computed this (see the `provenance` block in shared/contracts.ts) and
   * the client used to drop it, so every surface attributed the translation to Ensembl VEP —
   * including the progress text and the trace span — even when VariantValidator had answered.
   * That matters beyond labelling: the fallback tier returns no UniProt accession and no Ensembl
   * transcript id, so a degraded resolution is materially poorer and was reaching the readout
   * undisclosed.
   */
  provenance?: {
    provider: string;
    providerLabel: string;
    usedFallback: boolean;
    cacheHit: boolean;
  };
}

export interface StructuredPipelineOptions {
  fetchWithAuth: (url: string, options?: any) => Promise<Response>;
  apiClient: any;
  settings: any;
  serverGeminiReady?: boolean;
  userDirections: string;
  /**
   * The reader's answer to the ambiguity prompt, forwarded to the analysis request.
   *
   * Only `canonical` needs to travel: the isoform reading is submitted as its canonical-numbered
   * equivalent, which is unambiguous on its own. Without this the canonical reading is unselectable —
   * the same bare string is refused again, forever.
   */
  numberingBasis?: "canonical";
  sinks: PipelineStateSinks;
}

export type UseAnalysisPipelineOptions =
  | StructuredPipelineOptions
  | (Record<string, any> & {
      fetchWithAuth: (url: string, options?: any) => Promise<Response>;
      apiClient: any;
      settings: any;
      serverGeminiReady?: boolean;
      userDirections: string;
      numberingBasis?: "canonical";
      sinks?: PipelineStateSinks;
    });

