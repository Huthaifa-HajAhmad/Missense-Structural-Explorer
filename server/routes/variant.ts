/**
 * variant.ts — Variant routes gateway delegating to specialized sub-routers:
 *   - analysis.ts (/analyze-variant)
 *   - narrative.ts (/analyze-variant-narrative)
 *   - translation.ts (/translate-variant)
 *   - gene.ts (/resolve-gene)
 *   - numbering-intake.ts (/numbering-proof)
 */
import { type Router } from "express";
import { registerAnalysisRoutes } from "./variant/analysis.ts";
import { registerNarrativeRoutes } from "./variant/narrative.ts";
import { registerTranslationRoutes } from "./variant/translation.ts";
import { registerGeneRoutes } from "./variant/gene.ts";
import { registerNumberingIntakeRoute } from "./variant/numbering-intake.ts";
import { registerLiteratureRoutes } from "./variant/literature.ts";
import { registerAlphaGenomeRoutes } from "./variant/alphagenome.ts";
import { registerSpliceAiRoutes } from "./variant/spliceai.ts";

export function registerVariantRoutes(apiRouter: Router, jsonParserRegular: any): void {
  registerAnalysisRoutes(apiRouter, jsonParserRegular);
  registerNarrativeRoutes(apiRouter, jsonParserRegular);
  registerTranslationRoutes(apiRouter, jsonParserRegular);
  registerGeneRoutes(apiRouter, jsonParserRegular);
  registerNumberingIntakeRoute(apiRouter, jsonParserRegular);
  registerLiteratureRoutes(apiRouter);
  registerAlphaGenomeRoutes(apiRouter, jsonParserRegular);
  registerSpliceAiRoutes(apiRouter, jsonParserRegular);
}
