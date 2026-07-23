/**
 * index.ts — Route coordinator.
 * Registers all route groups on the shared apiRouter instance.
 */
import { type Router } from "express";
import { registerHealthRoutes } from "./health.ts";
import { registerVariantRoutes } from "./variant.ts";
import { registerStructureRoutes } from "./structure.ts";
import { registerBiophysicsRoutes } from "./biophysics.ts";
import { registerSessionRoutes } from "./session.ts";

export function registerAllRoutes(
  apiRouter: Router,
  jsonParserRegular: any,
  jsonParserPdb: any
): void {
  registerHealthRoutes(apiRouter);
  registerVariantRoutes(apiRouter, jsonParserRegular);
  registerStructureRoutes(apiRouter, jsonParserRegular, jsonParserPdb);
  registerBiophysicsRoutes(apiRouter, jsonParserRegular, jsonParserPdb);
  registerSessionRoutes(apiRouter, jsonParserRegular);
}
