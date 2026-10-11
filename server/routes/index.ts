/**
 * index.ts — Route coordinator.
 * Registers all route groups on the shared apiRouter instance.
 */
import { type Router, type RequestHandler } from "express";
import { registerHealthRoutes } from "./health.ts";
import { registerCapabilitiesRoutes } from "./capabilities.ts";
import { registerVariantRoutes } from "./variant.ts";
import { registerStructureRoutes } from "./structure.ts";
import { registerBiophysicsRoutes } from "./biophysics.ts";
import { registerSessionRoutes } from "./session.ts";
import { docsRouter } from "./docs.ts";
import { registerEvidenceContextRoutes } from "./evidence-context.ts";
import { registerAuthRoutes } from "./auth.ts";
import { registerAdminRoutes } from "./admin.ts";
import { registerAgentRoutes } from "./agent.ts";

export function registerAllRoutes(
  apiRouter: Router,
  jsonParserRegular: RequestHandler,
  jsonParserPdb: RequestHandler
): void {
  registerHealthRoutes(apiRouter);
  registerCapabilitiesRoutes(apiRouter);
  registerEvidenceContextRoutes(apiRouter);
  apiRouter.use(docsRouter);
  registerVariantRoutes(apiRouter, jsonParserRegular);
  registerStructureRoutes(apiRouter, jsonParserRegular, jsonParserPdb);
  registerBiophysicsRoutes(apiRouter, jsonParserRegular, jsonParserPdb);
  registerSessionRoutes(apiRouter, jsonParserRegular);
  registerAuthRoutes(apiRouter, jsonParserRegular);
  registerAdminRoutes(apiRouter, jsonParserRegular);
  // After auth/admin: `/me` and `/admin` guards registered there also cover the agent module's routes.
  registerAgentRoutes(apiRouter, jsonParserRegular);
}
