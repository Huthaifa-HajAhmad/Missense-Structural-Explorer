/**
 * Shared Thresholds & Predictor Concordance: Domain Facade
 *
 * Partitioned into single-responsibility domain sub-modules under `src/shared/thresholds/`:
 * - `constants.ts`: THRESHOLDS, THRESHOLDS_METADATA, LOCAL_STRUCTURAL_WINDOW, THRESHOLD_NOTES
 * - `evaluators.ts`: PredictorSignal type & individual tool cut-point evaluators
 * - `concordance.ts`: PredictorToolDetails, PredictorConcordance, countPredictorConcordance
 * - `consensus.ts`: Calibrated stability consensus, score calibration & ΔΔG normalization
 *
 * 100% backward-compatible facade for all existing client, server, and test consumers.
 */

export * from "./thresholds/index.ts";
