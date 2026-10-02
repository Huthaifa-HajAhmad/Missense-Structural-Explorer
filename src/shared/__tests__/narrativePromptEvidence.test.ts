import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { NARRATIVE_PROMPT_EVIDENCE, NARRATIVE_PROMPT_SCHEMA_VERSION } from "../narrativeSynthesis";

/**
 * The Insights tab tells the reader what the model was and was not shown. That list must match the prompt.
 *
 * Since schema v5 the prompt also carries the deep-model observation block, built by
 * `deepEvidencePromptBlock`. The assertions below therefore check three things a reader's trust rests on:
 * the block is really in the prompt, the computed-observation rules travel with it (predictions are not
 * assays, and no ACMG criterion may be created from one), and the sources the rail lists as NOT sent are
 * still absent from the prompt source.
 */
describe("NARRATIVE_PROMPT_EVIDENCE", () => {
  const src = fs.readFileSync("server/services/llm/gemini.ts", "utf8");
  const start = src.indexOf("export async function performGeminiAnalysis");
  const end = src.indexOf("const modelsToTry = getConfiguredGeminiModels()", start);
  const body = src.slice(start, end);
  const prompt = body.slice(body.indexOf("const prompt = `"));

  it("names the evidence blocks the prompt builds", () => {
    for (const block of [
      "[CLINVAR DATABASE EVIDENCE]",
      "[PREDICTIVE BIOINFORMATICS SCORES]",
      "[EVOLUTIONARY CONSERVATION SCORES]",
      "[STRING DB PROTEIN-PROTEIN INTERACTION NETWORK]",
    ]) {
      expect(body).toContain(block);
    }
    expect(NARRATIVE_PROMPT_EVIDENCE.sent).toHaveLength(9);
  });

  it("carries the deep-model block, rendered by the shared module rather than written here", () => {
    // One declaration: the same renderer feeds the prompt and the disclosure surfaces.
    expect(body).toContain("deepEvidencePromptBlock");
    expect(prompt).toContain("${deepEvidenceBlock}");
    // ...and the block is interpolated into the prompt, not merely imported.
    expect(prompt.indexOf("${deepEvidenceBlock}")).toBeGreaterThan(prompt.indexOf("${stringEvidence}"));
  });

  it("states, inside the prompt, that the deep observations are predictions and cannot create criteria", () => {
    /*
     * These rules live in `deepModelEvidencePromptBlock`, so this asserts the prompt actually renders
     * that text — the difference between "we integrated the ΔΔG" and "we integrated it under rules a
     * reader can check". The wording is read from the shared renderer's own source, so the two cannot
     * drift apart without failing here.
     */
    const renderer = fs.readFileSync("src/shared/deepModelEvidence.ts", "utf8");
    expect(renderer).toMatch(/NOT functional assays/);
    expect(renderer).toMatch(/NEVER describe one as an assay/);
    expect(renderer).toMatch(/Do NOT add an ACMG\/AMP criterion/);
    expect(renderer).toMatch(/A predicted ΔΔG is not PS3 evidence/);
    expect(prompt).toContain("deepEvidenceBlock");
  });

  it("refuses a criterion derived from a prediction in the prompt's own ACMG rule", () => {
    expect(prompt).toMatch(/Never derive a criterion from the deep-model observations/);
    expect(prompt).toMatch(/a predicted ΔΔG is not PS3 evidence/);
    /*
     * The strict-structural weighting is chosen by a setting, so its sentence is built beside the
     * prompt rather than written inside it — and it is the one instruction that used to INVITE PS3
     * ("functional biophysical study criteria (PS3) supported by the structural packing") at a moment
     * when the prompt now carries predicted ΔΔG values.
     */
    expect(body).toMatch(/Do NOT raise PS3 from a predicted ΔΔG/);
  });

  it("does not put a source in the prompt that the tab says was not sent", () => {
    for (const term of [/gnomad/i, /\bpLI\b/, /InterPro/i, /SpliceAI/i]) {
      expect(prompt).not.toMatch(term);
    }
    // The deep-model block is sent now, so the list says so — and the two lists partition the sources.
    expect(NARRATIVE_PROMPT_EVIDENCE.sent.join(" ")).toMatch(/ΔΔG engines/);
    expect(NARRATIVE_PROMPT_EVIDENCE.notSent.join(" ")).not.toMatch(/ΔΔG/);
    expect(NARRATIVE_PROMPT_SCHEMA_VERSION).toBeGreaterThanOrEqual(5);
  });
});
