import calibrationData from "./protein_class_calibration.json" with { type: "json" };

export type ProteinContext = "globular" | "transmembrane" | "disordered";

export interface CalibrationInfo {
  auc: number;
  weightMultiplier: number;
  comment?: string;
}

/**
 * Categorizes a specific residue position into a structural context
 * based on UniProt structural and sequence features.
 */
export function getResidueContext(
  features: Array<any> | undefined,
  residueIndex: number
): ProteinContext {
  if (!features || features.length === 0 || !residueIndex) {
    return "globular"; // Fallback default
  }

  for (const feature of features) {
    const beginVal = feature.start !== undefined ? feature.start : feature.begin;
    const endVal = feature.end !== undefined ? feature.end : feature.end;
    const begin = typeof beginVal === "number" ? beginVal : parseInt(beginVal, 10);
    const end = typeof endVal === "number" ? endVal : parseInt(endVal, 10);
    if (isNaN(begin) || isNaN(end)) continue;

    // Check if the residue sits inside this feature boundary
    if (residueIndex >= begin && residueIndex <= end) {
      const type = (feature.type || "").toUpperCase();
      const desc = (feature.description || "").toLowerCase();

      // Transmembrane matches
      if (type === "TRANSMEM" || desc.includes("transmembrane") || desc.includes("membrane spanning")) {
        return "transmembrane";
      }

      // Intrinsically Disordered Regions matches
      if (
        type === "COMPBIAS" || 
        type === "COILED" || 
        desc.includes("disorder") || 
        desc.includes("disordered") ||
        desc.includes("low complexity") ||
        desc.includes("unstructured")
      ) {
        return "disordered";
      }
    }
  }

  return "globular";
}

/**
 * Returns calibration statistics and weight adjustments for a given tool and context.
 */
export function getCalibration(
  tool: string,
  context: ProteinContext
): CalibrationInfo {
  const toolData = (calibrationData as any)[tool];
  if (!toolData) {
    return { auc: 0.80, weightMultiplier: 1.0 };
  }

  const contextData = toolData[context];
  if (!contextData) {
    return { auc: 0.80, weightMultiplier: 1.0 };
  }

  return {
    auc: contextData.auc,
    weightMultiplier: contextData.weightMultiplier,
    comment: contextData.comment
  };
}
