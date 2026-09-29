/**
 * thresholdEvidence — the Score thresholds tab's contract on NAE1 p.Asp116Gly (the owner's
 * 2026-09-29 screenshots): what the tab may claim, and what it must never claim again.
 */
import { describe, it, expect } from "vitest";
import {
  buildThresholdEvidence,
  thresholdDisagreement,
  thresholdFinding,
  groupThresholdRows,
  CLINGEN_CLASS_BANDS,
} from "../thresholdEvidence";
import { isPp2Constrained } from "../thresholds";
import { NAE1_RESULT } from "./fixtures/nae1Thresholds";

const build = (over: any = {}) =>
  buildThresholdEvidence({
    result: { ...NAE1_RESULT, ...over },
    foldingDdG: 2.62,
    foldingEnergetics: { thermompnn: -0.36 } as any,
  });

describe("buildThresholdEvidence — NAE1 p.Asp116Gly", () => {
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

  it("gives no stability score an ACMG code, and uses RaSP's own 1.0 mark, not FoldX's 0.5", () => {
    const ev = build({ rasp: 0.8 });
    const stability = ev.rows.filter(r => r.group === "stability");
    for (const row of stability) {
      expect(row.reading.callLabel).not.toMatch(/PM1|BP3|PP3|BP4/);
      expect(row.reading.callTone === "danger" || row.reading.callTone === "good").toBe(false);
    }
    expect(stability.find(r => r.reading.key === "foldx")!.reading.callLabel).toBe("Destabilising");
    expect(stability.find(r => r.reading.key === "rasp")!.reading.callLabel).toBe("Below mark");
    expect(stability.find(r => r.reading.key === "thermompnn")!.reading.callLabel).toBe("Below mark");
  });

  it("reports DynaMut2 / DDMut on the canonical sign (their raw negative = destabilising)", () => {
    const ev = build({ dynamut2: -1.4 });
    const row = ev.rows.find(r => r.reading.key === "dynamut2")!;
    expect(row.reading.score).toBeCloseTo(1.4);
    expect(row.reading.callLabel).toBe("Destabilising");
  });

  it("tests PP2 with the engine's rule (Z ≥ 3.09 and o/e < 0.6), never BP1", () => {
    const ev = build();
    const misZ = ev.rows.find(r => r.reading.key === "misZ")!;
    expect(misZ.reading.callLabel).toBe("PP2 not met");
    expect(ev.rows.some(r => /BP1/.test(r.reading.callLabel))).toBe(false);
    const loeuf = ev.rows.find(r => r.reading.key === "loeuf")!;
    expect(loeuf.reading.callLabel).toBe("Context only");
    expect(isPp2Constrained(3.2, 0.5)).toBe(true);
    expect(isPp2Constrained(3.2, 0.7)).toBe(false);
    expect(isPp2Constrained(2.5, 0.4)).toBe(false);
    expect(isPp2Constrained(3.2, null)).toBeNull();
  });

  it("flags a BP1 in the payload as an earlier engine's", () => {
    const ev = build({ ruleBasedInsights: { acmgCriteria: [{ code: "PP3" }, { code: "BP1" }] } });
    expect(ev.engine.bp1Stale).toBe(true);
  });

  it("says the finding once, from the engine record, with no cross-modal verdict", () => {
    const f = thresholdFinding(build());
    expect(f.lead).toBe("The engine applied PP3 at Supporting strength from the in-silico vote, and no other computational criterion.");
    expect(f.rest[0]).toBe(
      "Of the 7 ClinGen-calibrated tools, CADD and phyloP reach a PP3 band, REVEL reaches BP4, and 3 are indeterminate; 1 has no result.",
    );
    expect([f.lead, ...f.rest].join(" ")).not.toMatch(/concordance/i);
  });

  it("names the disagreement between the calibrated reference and the vote", () => {
    expect(thresholdDisagreement(build())).toBe(
      "REVEL, the calibrated reference, reads BP4. The vote's PP3 rests on CADD plus MetaRNN and ClinPred, uncalibrated tools that use allele frequency.",
    );
  });

  it("groups rows in the order the tab reads them", () => {
    expect(groupThresholdRows(build().rows).map(g => g.group)).toEqual(["vote", "calibrated", "constraint", "stability", "uncalibrated"]);
  });

  it("carries Tavtigian 2020's class bands", () => {
    expect(CLINGEN_CLASS_BANDS.map(b => [b.id, b.min, b.max])).toEqual([
      ["B", null, -7], ["LB", -6, -1], ["VUS", 0, 5], ["LP", 6, 9], ["P", 10, null],
    ]);
  });
});
