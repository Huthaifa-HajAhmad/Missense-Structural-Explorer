import { describe, it, expect } from "vitest";
import { buildSplicingEvidence, groupSpliceReadings, splicingFinding } from "../splicingEvidence.ts";
import { THRESHOLDS } from "../thresholds/constants.ts";
import { evaluateSplicePredictor } from "../thresholds/evaluators.ts";
import { nae1Reference } from "./fixtures/splicingReference.ts";

/**
 * Contract of the splicing model the RNA Splicing tab and its rail both render.
 *
 * The defects these pin were all on screen (doc/SPLICING_TAB_REVIEW.md): a splicing "PP3"/"BP4"
 * the engine never recorded; proximity and dbscSNV deciding PP3; BP4 only at ≤ 0.02 and > 12 bp; a
 * symmetric ±12 bp dbscSNV window; a signed SHAP printed as a percentage; "no SpliceAI score exists"
 * for an exonic SNV SpliceAI would have scored.
 */

const sai = (max_ds: number | null, extra: Record<string, any> = {}) => ({
  ds_ag: 0, ds_al: max_ds, ds_dg: 0, ds_dl: 0, max_ds, ...extra,
});
const build = (overrides: Record<string, any> = {}, opts: { isLoading?: boolean } = {}) =>
  buildSplicingEvidence({ result: nae1Reference(overrides), ...opts });

describe("reference variant — NAE1 p.Asp116Gly", () => {
  const ev = build();

  it("has no SpliceAI score, so the splicing rule cannot be applied", () => {
    expect(ev.rule.state).toBe("no-score");
    expect(ev.rule.code).toBeNull();
    expect(splicingFinding(ev).headline).toBe("No SpliceAI score reached this variant");
  });

  it("says a missing score for an exonic SNV is a failed request, not 'no score exists'", () => {
    expect(ev.spliceai.availability.state).toBe("no-result");
    expect(ev.spliceai.availability.reason).toMatch(/scores every single-nucleotide change/);
    expect(ev.spliceai.availability.reason).not.toMatch(/exist/);
  });

  it("places the variant as the 26th base of exon 6 from its acceptor", () => {
    const g = ev.geometry;
    expect(g.junction).toBe("acceptor");
    expect(g.position).toBe(26);
    expect(g.positionPhrase).toBe("the 26th base of exon 6 from its acceptor boundary");
    expect(g.isCanonicalDinucleotide).toBe(false);
    expect(g.transcriptId).toBe("NM_003905.4");
  });

  it("states that dbscSNV does not cover +26 — its acceptor window ends at +2", () => {
    expect(ev.geometry.inDbscsnvWindow).toBe(false);
    const ada = ev.readings.find(r => r.key === "dbscsnv-ada")!;
    expect(ada.availability.state).toBe("not-covered");
    expect(ada.availability.reason).toContain("−12 to +2 at an acceptor");
    expect(ada.availability.reason).toContain("+26");
  });

  it("surfaces AlphaGenome's reference-base mismatch as a coordinate problem", () => {
    expect(ev.referenceMismatch).toMatch(/reference base does not match/);
    const ag = ev.readings.find(r => r.key === "alphagenome-splicing")!;
    expect(ag.score).toBeNull();
    expect(ag.availability.state).toBe("upstream-error");
  });

  it("reads the missense vote as the engine's in-silico code, and flags BP4 as splicing-unchecked", () => {
    // No criteria list in this payload: the engine record is unknown, the vote supports BP4 (REVEL 0.231).
    expect(ev.engine.known).toBe(false);
    expect(ev.engine.voteCode).toBe("BP4");
    expect(ev.relation).toBe("bp4-unchecked");
  });
});

describe("the splicing rule is SpliceAI on the Walker 2023 bands", () => {
  it("agrees with evaluateSplicePredictor on every edge", () => {
    for (const v of [0, 0.004, 0.05, 0.099, 0.1, 0.15, 0.199, 0.2, 0.5, 0.99]) {
      const ev = build({ conservationData: { spliceai: sai(v) } });
      const signal = evaluateSplicePredictor(null, { max_ds: v });
      const expected = signal === "pathogenic" ? "pp3" : signal === "benign" ? "bp4" : "between";
      expect(ev.rule.state, `max Δ ${v}`).toBe(expected);
    }
  });

  it("puts 0.10 between the bands and 0.20 in PP3", () => {
    expect(build({ conservationData: { spliceai: sai(THRESHOLDS.spliceai.splicingBp4Below) } }).rule.state).toBe("between");
    expect(build({ conservationData: { spliceai: sai(THRESHOLDS.spliceai.splicingPp3) } }).rule.state).toBe("pp3");
  });

  it("does not let junction proximity or dbscSNV make a call", () => {
    const ev = build({
      conservationData: {
        spliceProximity: { distance: 1, isNearSpliceSite: true, junctionType: "donor", regionType: "intronic" },
        dbscsnv: { ada_score: 0.99, rf_score: 0.95 },
        spliceai: null,
      },
    });
    expect(ev.rule.state).toBe("no-score");
    expect(ev.geometry.isCanonicalDinucleotide).toBe(true);
    const ada = ev.readings.find(r => r.key === "dbscsnv-ada")!;
    expect(ada.call?.label).toBe("Altering (authors)");
    expect(ada.call?.isCode).toBe(false);
  });

  it("names the channel and shift the maximum came from", () => {
    const ev = build({ conservationData: { spliceai: { ds_ag: 0.01, ds_al: 0.34, ds_dg: 0, ds_dl: 0.02, max_ds: 0.34, dp: { ds_ag: 3, ds_al: -12, ds_dg: 0, ds_dl: 40 } } } });
    expect(ev.rule.maxChannel).toBe("ds_al");
    expect(ev.rule.maxShift).toBe(-12);
    expect(splicingFinding(ev).headline).toBe("SpliceAI predicts a splicing change (acceptor loss at −12 bp)");
    const rows = groupSpliceReadings(ev.readings);
    expect(rows.map(g => g.group)).toEqual(["rule", "channels", "context"]);
    expect(rows[1].rows.find(r => r.key === "spliceai-ds_al")!.call?.label).toBe("Maximum");
  });

  it("marks the band the score sits in on the ruler", () => {
    const ev = build({ conservationData: { spliceai: sai(0.03) } });
    const r = ev.readings.find(x => x.key === "spliceai")!;
    expect(r.scale!.bands.find(b => b.active)!.side).toBe("benign");
    expect(r.call).toEqual({ label: "BP4 (splicing)", tone: "good", isCode: true });
  });

  it("is pending, not absent, while SpliceAI is in flight", () => {
    const ev = build({}, { isLoading: true });
    expect(ev.rule.state).toBe("pending");
    expect(ev.pending).toBe(true);
  });

  it("names what served the score", () => {
    const live = build({ conservationData: { spliceai: sai(0.02, { provenance: { source: "broad-lookup", distanceBp: 500, masked: 1, computedLive: true } }) } });
    expect(live.spliceai.sourceText).toBe("Broad SpliceAI Lookup (model run for this request)");
    expect(live.spliceai.windowText).toBe("±500 bp");
    expect(live.spliceai.maskText).toBe("Masked");
    const frozen = build({ conservationData: { spliceai: sai(0.02, { provenance: { source: "precomputed-dbnsfp" } }) } });
    expect(frozen.spliceai.sourceText).toContain("GENCODE v24");
    expect(frozen.spliceai.windowText).toBe("Not stated");
    expect(build({ conservationData: { spliceai: sai(0.02) } }).spliceai.sourceText).toBe("Source not stated in the payload");
  });
});

describe("the engine record is read, never inferred from splicing", () => {
  const withEngine = (code: string | null, spliceScore: number | null) =>
    build({
      conservationData: { spliceai: spliceScore === null ? null : sai(spliceScore) },
      ruleBasedInsights: { acmgCriteria: code ? [{ code, reason: "vote" }] : [] },
    });

  it("reports a conflict when splicing supports PP3 and the engine recorded BP4", () => {
    const ev = withEngine("BP4", 0.45);
    expect(ev.engine).toMatchObject({ known: true, code: "BP4" });
    expect(ev.relation).toBe("conflict");
  });

  it("notes PP3 is counted once when both point that way", () => {
    expect(withEngine("PP3", 0.45).relation).toBe("same-pp3");
  });

  it("says nothing extra when splicing agrees with a BP4", () => {
    expect(withEngine("BP4", 0.02).relation).toBe("none");
  });

  it("never turns a splicing reading into an engine code", () => {
    const ev = withEngine(null, 0.9);
    expect(ev.engine.code).toBeNull();
    expect(ev.rule.code).toBe("PP3");
  });
});

describe("geometry — positions in splice-site convention, dbscSNV's asymmetric windows", () => {
  const at = (junctionType: string, regionType: string, distance: number) =>
    build({ conservationData: { spliceProximity: { distance, junctionType, regionType, isNearSpliceSite: false } } }).geometry;

  it("numbers donor exonic bases negative and intronic positive", () => {
    expect(at("donor", "exonic", 0).position).toBe(-1);
    expect(at("donor", "exonic", 2).position).toBe(-3);
    expect(at("donor", "intronic", 1).position).toBe(1);
  });

  it("numbers acceptor intronic bases negative and exonic positive", () => {
    expect(at("acceptor", "intronic", 12).position).toBe(-12);
    expect(at("acceptor", "exonic", 0).position).toBe(1);
  });

  it("uses dbscSNV's real windows: −3..+8 donor, −12..+2 acceptor", () => {
    expect(at("donor", "exonic", 2).inDbscsnvWindow).toBe(true); // −3
    expect(at("donor", "exonic", 3).inDbscsnvWindow).toBe(false); // −4
    expect(at("donor", "intronic", 8).inDbscsnvWindow).toBe(true);
    expect(at("donor", "intronic", 9).inDbscsnvWindow).toBe(false);
    expect(at("acceptor", "intronic", 12).inDbscsnvWindow).toBe(true);
    expect(at("acceptor", "intronic", 13).inDbscsnvWindow).toBe(false);
    expect(at("acceptor", "exonic", 1).inDbscsnvWindow).toBe(true); // +2
    // The old symmetric ±12 flank called this "inside": an exonic base 5 from the acceptor.
    expect(at("acceptor", "exonic", 4).inDbscsnvWindow).toBe(false); // +5
  });

  it("flags only intronic ±1/±2 as the canonical dinucleotide", () => {
    expect(at("donor", "intronic", 2).isCanonicalDinucleotide).toBe(true);
    expect(at("donor", "intronic", 3).isCanonicalDinucleotide).toBe(false);
    expect(at("acceptor", "exonic", 0).isCanonicalDinucleotide).toBe(false);
  });

  it("claims no position or window at a transcript terminus (F-15)", () => {
    const g = at("terminal", "exonic", 2);
    expect(g.junction).toBe("terminal");
    expect(g.position).toBeNull();
    expect(g.inDbscsnvWindow).toBeNull();
    expect(g.junctionLabel).toContain("terminus");
  });

  it("keeps the legacy donor inference only for payloads without junctionType, and claims no position", () => {
    const legacy = build({ conservationData: { spliceProximity: { distance: 2, isNearSpliceSite: false, junctionType: undefined, regionType: undefined } } }).geometry;
    expect(legacy.junction).toBe("donor");
    expect(legacy.position).toBeNull();
    const explicitNull = build({ conservationData: { spliceProximity: { distance: 2, isNearSpliceSite: false, junctionType: null } } }).geometry;
    expect(explicitNull.junction).toBe("unresolved");
  });

  it("carries a build-gate refusal verbatim (F-13), and no reason when none was recorded", () => {
    const ev = build({
      conservationData: {
        spliceProximity: null,
        assemblyRefusals: [{ source: "splice-proximity", reason: "splice-proximity covers GRCh38 / hg38; this coordinate is GRCh37 / hg19 and was not scored." }],
      },
    });
    expect(ev.geometry.refusal).toMatch(/^Splice-junction geometry covers/);
    expect(build().geometry.refusal).toBeNull();
  });
});

describe("AlphaGenome splicing attribution is the AlphaGenome tab's reading", () => {
  const live = (featureAttributions: Record<string, number> | null) =>
    build({ conservationData: { alphagenome: { status: "live", aviPhred: 18, message: null, featureAttributions } } });

  it("reports the splicing feature's share of |SHAP|, not the signed SHAP ×100", () => {
    const ev = live({ Splicing: -0.3, AlphaMissense: 0.6, Cactus: 0.1 });
    expect(ev.alphagenome.share).toBeCloseTo(0.3, 5);
    expect(ev.alphagenome.shap).toBeCloseTo(-0.3, 5);
    const row = ev.readings.find(r => r.key === "alphagenome-splicing")!;
    expect(row.scoreText).toBe("30%");
    expect(row.sub).toBe("SHAP −0.300");
    expect(row.call?.label).toBe("Informational");
  });

  it("reads the raw REST key too", () => {
    expect(live({ fi_MERGED_SPLICING: 0.5, AlphaMissense: 0.5 }).alphagenome.share).toBeCloseTo(0.5, 5);
  });

  it("says why when AlphaGenome answered without attributions", () => {
    const ev = live(null);
    expect(ev.alphagenome.share).toBeNull();
    expect(ev.alphagenome.availability.reason).toMatch(/no feature attributions/);
  });
});
