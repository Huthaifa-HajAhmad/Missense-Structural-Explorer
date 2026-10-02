/**
 * ladderEvidence — the strength ladder's contract on NAE1 p.Asp116Gly (the owner's 2026-09-29
 * screenshots): what the ladder may claim, and what it must never claim again.
 */
import { describe, it, expect } from "vitest";
import { buildLadderEvidence, CLINGEN_CLASS_BANDS } from "../ladderEvidence";
import { isPp2Constrained } from "../thresholds";
import { NAE1_RESULT } from "./fixtures/nae1Result";

const build = (over: any = {}) => buildLadderEvidence({ result: { ...NAE1_RESULT, ...over } });

describe("buildLadderEvidence — NAE1 p.Asp116Gly", () => {
  it("reads the engine's PP3 and the same 3–1 vote the Predictors tab counts", () => {
    const ev = build();
    expect(ev.engine.codes).toEqual(["PP3"]);
    expect(ev.predictor.vote.nPathogenic).toBe(3);
    expect(ev.predictor.vote.nBenign).toBe(1);
    expect(ev.predictor.vote.nIndeterminate).toBe(2);
  });

  it("places the calibrated tools on the strength ladder: REVEL BP4, CADD and phyloP PP3", () => {
    const ev = build();
    const at = Object.fromEntries(ev.ladder.map(l => [l.key, l.at]));
    expect(at).toMatchObject({
      revel: "BP4:Supporting",
      cadd: "PP3:Supporting",
      phylop: "PP3:Supporting",
      am: "none",
      bayesdel: "none",
      gerp: "none",
      esm: null,
    });
    // GERP++ publishes no PP3 band (Pejaver 2022), so no PP3 cell is reachable.
    expect(ev.ladder.find(l => l.key === "gerp")!.reachable.some(c => c.startsWith("PP3"))).toBe(false);
    // Columns span BP4 Very strong (−8) to PP3 Strong (+4) — nothing publishes PP3 Very strong.
    expect(ev.columns.map(c => c.points)).toEqual([-8, -4, -2, -1, 0, 1, 2, 4]);
  });

  it("gives the authors' cut-point tools a side, never a strength", () => {
    const ev = build();
    const side = Object.fromEntries(ev.directional.map(d => [d.key, d.side]));
    // MetaRNN 0.529 and ClinPred 0.977 are at or above their 0.5 cut; popEVE has no score here.
    expect(side).toEqual({ metarnn: "pathogenic", clinpred: "pathogenic", popeve: null });
    // Every directional tool is one the engine counts, and none of them is a calibrated ladder row.
    expect(ev.directional.every(d => d.votes)).toBe(true);
    expect(ev.directional.some(d => ev.ladder.some(l => l.key === d.key))).toBe(false);
    expect(ev.directional.find(d => d.key === "metarnn")!.cutText).toBe("≥ 0.5");
  });

  it("puts a score below the authors' cut off the pathogenic side", () => {
    const ev = build({ conservationData: { ...NAE1_RESULT.conservationData, metarnn: 0.05, clinpred: 0.2 } });
    const side = Object.fromEntries(ev.directional.map(d => [d.key, d.side]));
    expect(side.metarnn).not.toBe("pathogenic");
    expect(side.clinpred).not.toBe("pathogenic");
  });

  it("writes the cut-points in words, weakest first", () => {
    const revel = build().ladder.find(l => l.key === "revel")!;
    expect(revel.cutLines).toEqual(["PP3 ≥ 0.644 · 0.773 · 0.932", "BP4 ≤ 0.29 · 0.183 · 0.016 · 0.003"]);
  });

  it("tests PP2 with the engine's rule (Z ≥ 3.09 and o/e < 0.6), never BP1", () => {
    const ev = build();
    expect(ev.constraint.pp2RuleMet).toBe(false);
    expect(ev.engine.pp2).toBe(false);
    expect(ev.engine.codes.some(c => /BP1/.test(c))).toBe(false);
    expect(isPp2Constrained(3.2, 0.5)).toBe(true);
    expect(isPp2Constrained(3.2, 0.7)).toBe(false);
    expect(isPp2Constrained(2.5, 0.4)).toBe(false);
    expect(isPp2Constrained(3.2, null)).toBeNull();
  });

  it("flags a BP1 in the payload as an earlier engine's", () => {
    const ev = build({ ruleBasedInsights: { acmgCriteria: [{ code: "PP3" }, { code: "BP1" }] } });
    expect(ev.engine.bp1Stale).toBe(true);
  });

  it("summarises where the calibrated tools landed", () => {
    const { calibratedReached: c } = build();
    expect(c.pp3.map(l => l.name)).toEqual(["CADD", "phyloP"]);
    expect(c.bp4.map(l => l.name)).toEqual(["REVEL"]);
    expect(c.indeterminate.length).toBe(3);
    expect(c.missing.length).toBe(1);
  });

  it("carries Tavtigian 2020's class bands", () => {
    expect(CLINGEN_CLASS_BANDS.map(b => [b.id, b.min, b.max])).toEqual([
      ["B", null, -7], ["LB", -6, -1], ["VUS", 0, 5], ["LP", 6, 9], ["P", 10, null],
    ]);
  });
});
