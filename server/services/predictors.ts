/**
 * Predictors and Conservation Services Facade (Strangler Fig pattern).
 *
 * This file preserves 100% backward-compatibility for all existing consumers
 * while delegating implementation to specialized domain modules in ./predictors/:
 * - ./predictors/normalizer.ts (parsing, coercion, AA conversions)
 * - ./predictors/transcript-resolver.ts (MANE Select, RefSeq, Ensembl)
 * - ./predictors/dbnsfp-query.ts (query.dbnsfp.org API queries)
 * - ./predictors/consurf-resolver.ts (ConSurf evolutionary scores)
 * - ./predictors/popeve-resolver.ts (Tabix and online PopEVE lookups)
 * - ./predictors/vep-orchestrator.ts (VEP and MyVariant fallbacks)
 * - ./predictors/conservation-orchestrator.ts (multi-tier conservation aggregation)
 */

export * from "./predictors/index.ts";
export type { PredictorData, ConservationData } from "../../src/shared/contracts.ts";
