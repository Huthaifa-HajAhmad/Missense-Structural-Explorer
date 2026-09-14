/**
 * Domain barrel for server/services/external-api
 */
export * from "./clinvar.ts";
export * from "./uniprot.ts";
export * from "./gnomad.ts";
export * from "./genos_web.ts";
export * from "./string.ts";
export * from "./ppi.ts";
export * from "./japanfold.ts";
export * from "./japanfold-client.ts";
export * from "./esmc.ts";
export {
  runSaprotAnalysis,
  type SaprotEvalResult
} from "./saprot.ts";
export {
  runEsm2Analysis
} from "./esm2.ts";
export * from "./esm3_forge.ts";
export * from "./gpn.ts";
export type { EvolutionaryScaleResult } from "./evolutionaryscale.ts";
export * from "./alphagenome-client.ts";
export * from "./alphagenome-bridge.ts";
export * from "./core-data-fetcher.ts";
