/**
 * Predictors and Conservation Services Facade (Strangler Fig pattern).
 * 100% backward-compatibility facade for all existing consumers.
 */
export * from "./prediction/predictors/index.ts";
export type { PredictorData, ConservationData } from "../../src/shared/contracts.ts";
