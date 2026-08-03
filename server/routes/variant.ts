/**
 * variant.ts — Variant routes gateway delegating to specialized sub-routers:
 *   - analysis.ts (/analyze-variant)
 *   - narrative.ts (/analyze-variant-narrative)
 *   - translation.ts (/translate-variant)
 *   - gene.ts (/resolve-gene)
 */
import { type Router } from "express";
import { registerAnalysisRoutes } from "./variant/analysis.ts";
import { registerNarrativeRoutes } from "./variant/narrative.ts";
import { registerTranslationRoutes } from "./variant/translation.ts";
import { registerGeneRoutes } from "./variant/gene.ts";

export function registerVariantRoutes(apiRouter: Router, jsonParserRegular: any): void {
  registerAnalysisRoutes(apiRouter, jsonParserRegular);
  registerNarrativeRoutes(apiRouter, jsonParserRegular);
  registerTranslationRoutes(apiRouter, jsonParserRegular);
  registerGeneRoutes(apiRouter, jsonParserRegular);
}
