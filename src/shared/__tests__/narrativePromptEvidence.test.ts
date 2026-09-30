import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { NARRATIVE_PROMPT_EVIDENCE } from "../narrativeSynthesis";

/** The Insights tab tells the reader what the model was and was not shown. That list must match the prompt. */
describe("NARRATIVE_PROMPT_EVIDENCE", () => {
  const src = fs.readFileSync("server/services/llm/gemini.ts", "utf8");
  const start = src.indexOf("export async function performGeminiAnalysis");
  const end = src.indexOf("const modelsToTry = getConfiguredGeminiModels()", start);
  const body = src.slice(start, end);

  it("names the evidence blocks the prompt builds", () => {
    for (const block of ["[CLINVAR DATABASE EVIDENCE]", "[PREDICTIVE BIOINFORMATICS SCORES]", "[EVOLUTIONARY CONSERVATION SCORES]", "[STRING DB PROTEIN-PROTEIN INTERACTION NETWORK]"]) {
      expect(body).toContain(block);
    }
    expect(NARRATIVE_PROMPT_EVIDENCE.sent.length).toBe(7);
  });

  it("does not put a source in the prompt that the tab says was not sent", () => {
    const prompt = body.slice(body.indexOf("const prompt = `"));
    for (const term of [/gnomad/i, /\bpLI\b/, /InterPro/i, /kcal\/mol/i, /SpliceAI/i]) {
      expect(prompt).not.toMatch(term);
    }
  });
});
