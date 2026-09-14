import React from "react";
import { PdbHomolog, NearestResidue, DisruptionPredictorResult } from "../../types";

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
  lastFetchedFoldRef: React.MutableRefObject<string>;
}

export interface PipelineStructureSink {
  setPdbText: (pdb: string | null) => void;
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
  };
}

export interface StructuredPipelineOptions {
  fetchWithAuth: (url: string, options?: any) => Promise<Response>;
  apiClient: any;
  settings: any;
  userDirections: string;
  sinks: PipelineStateSinks;
}

export type UseAnalysisPipelineOptions =
  | StructuredPipelineOptions
  | (Record<string, any> & {
      fetchWithAuth: (url: string, options?: any) => Promise<Response>;
      apiClient: any;
      settings: any;
      userDirections: string;
      sinks?: PipelineStateSinks;
    });

