import { useState, useRef } from "react";
import type { PdbHomolog, NearestResidue } from "../../types.ts";

export interface DisruptionPredictorState {
  level: "high" | "low" | "unknown";
  reason: string;
  plddt: number | null;
}

/**
 * Manages state for structural inspection elements (homologs, nearest residues cache, disruption predictor).
 */
export function useStructuralInspectors() {
  const [homologs, setHomologs] = useState<PdbHomolog[]>([]);
  const [isHomologsLoading, setIsHomologsLoading] = useState(false);
  const [computedResiduesCache, setComputedResiduesCache] = useState<Record<string, NearestResidue[]>>({});
  const [disruptionPredictor, setDisruptionPredictor] = useState<DisruptionPredictorState | null>(null);
  const pendingResiduesRef = useRef<Set<string>>(new Set());

  return {
    homologs,
    setHomologs,
    isHomologsLoading,
    setIsHomologsLoading,
    computedResiduesCache,
    setComputedResiduesCache,
    disruptionPredictor,
    setDisruptionPredictor,
    pendingResiduesRef
  };
}
