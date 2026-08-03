/**
 * biophysics.ts — Biophysics routes gateway delegating to specialized sub-routers:
 *   - generation.ts (/generate-mutant, /analyze-variant-biophysical)
 *   - stability.ts (/verify-stability, connection diagnostic endpoints)
 *   - polling.ts (DynaMut2, DDMut, ThermoMPNN submission & polling)
 *   - pocket.ts (/pocket-finder, /nearest-residues)
 */
import { type Router } from "express";
import { registerGenerationRoutes } from "./biophysics/generation.ts";
import { registerStabilityRoutes } from "./biophysics/stability.ts";
import { registerPollingRoutes } from "./biophysics/polling.ts";
import { registerPocketRoutes } from "./biophysics/pocket.ts";

export function registerBiophysicsRoutes(apiRouter: Router, jsonParserRegular: any, jsonParserPdb: any): void {
  registerGenerationRoutes(apiRouter, jsonParserPdb);
  registerStabilityRoutes(apiRouter, jsonParserRegular, jsonParserPdb);
  registerPollingRoutes(apiRouter, jsonParserPdb);
  registerPocketRoutes(apiRouter, jsonParserPdb);
}
