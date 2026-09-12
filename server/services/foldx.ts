/**
 * Server Biophysical Modeling Service: FoldX Facade
 *
 * Deconstructed into single-responsibility domain sub-modules under `server/services/foldx/`:
 * - `cache.ts`: In-memory LRU + disk persistence (`logs/foldx_cache`) and dynamic registry
 * - `detector.ts`: Platform binary discovery (Windows exe vs Linux ELF via Box64)
 * - `parser.ts`: .dif file parsing and stochastic ΔΔG aggregation
 * - `pdb-utils.ts`: PDB cleaning, ATOM formatting, and B-factor provenance detection
 * - `runner.ts`: Execution orchestrator, semaphore concurrency, and local energy model integration
 *
 * 100% backward-compatible facade for all existing callers.
 */

export * from "./foldx/index.ts";
