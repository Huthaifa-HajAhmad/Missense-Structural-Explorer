/**
 * Shared Thresholds & Calibrated Predictor Bands: Domain Facade
 *
 * Partitioned into single-responsibility domain sub-modules under `src/shared/thresholds/`:
 * - `constants.ts`: THRESHOLDS, THRESHOLDS_METADATA, LOCAL_STRUCTURAL_WINDOW, THRESHOLD_NOTES
 * - `evaluators.ts`: PredictorSignal type & individual tool cut-point evaluators
 * - `consensus.ts`: Calibrated stability consensus, score calibration & ΔΔG normalization
 * - `calibration.ts`: ClinGen SVI calibrated PP3/BP4 and regional PP2 bands
 *
 * 100% backward-compatible facade for all existing client, server, and test consumers.
 */

export * from "./thresholds/index.ts";
