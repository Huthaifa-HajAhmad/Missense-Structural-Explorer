import {
  fetchEvo2Score,
  clearEvo2Cache,
  type ModelInferenceResult
} from "./evo2.ts";

import {
  fetchGpnStarScore,
  clearGpnCache
} from "./gpn.ts";

export type EvolutionaryScaleResult = ModelInferenceResult;

export {
  fetchEvo2Score,
  clearEvo2Cache,
  fetchGpnStarScore,
  clearGpnCache
};
