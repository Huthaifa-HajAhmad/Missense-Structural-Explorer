import React from "react";
import { PdbHomolog, NearestResidue, DisruptionPredictorResult } from "../../types";
import type { NumberingRemapRecord, StructureProvenance } from "../../shared/contracts";

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
  setFoldingError: (err: string | null) => void;
  setFoldingStatus: (status: string | null) => void;
  setMutantPdb: (pdb: string | null) => void;
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
  setStructureProvenance?: (provenance: StructureProvenance | null) => void;
  lastFetchedFoldRef: React.MutableRefObject<string>;
}

export interface PipelineStructureSink {
  setPdbText: (pdb: string | null) => void;
  setStructureProvenance?: (provenance: StructureProvenance | null) => void;
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

