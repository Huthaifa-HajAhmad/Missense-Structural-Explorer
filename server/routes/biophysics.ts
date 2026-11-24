/**
 * biophysics.ts — Biophysics routes gateway delegating to specialized sub-routers:
 *   - generation.ts (/generate-mutant, /analyze-variant-biophysical)
 *   - polling.ts (/foldx-job, /thermompnn-submit, /jobs/events, /my-jobs, /jobs/:jobId/cancel)
 *   - pocket.ts (/pocket-finder, /nearest-residues)
 */
import { type Router } from "express";
import { registerGenerationRoutes } from "./biophysics/generation.ts";
import { registerPollingRoutes } from "./biophysics/polling.ts";
import { registerPocketRoutes } from "./biophysics/pocket.ts";

export function registerBiophysicsRoutes(apiRouter: Router, _jsonParserRegular: any, jsonParserPdb: any): void {
  registerGenerationRoutes(apiRouter, jsonParserPdb);
  registerPollingRoutes(apiRouter, jsonParserPdb);
  registerPocketRoutes(apiRouter, jsonParserPdb);
}
