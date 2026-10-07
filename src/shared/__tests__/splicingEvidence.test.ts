import { describe, it, expect } from "vitest";
import { buildSplicingEvidence, formatDelta, groupSpliceReadings, offsetBetweenPositions, splicingFinding } from "../splicingEvidence.ts";
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

  it("includes 0.10 in BP4 and 0.20 in PP3 (Walker 2023 Table 1)", () => {
    expect(build({ conservationData: { spliceai: sai(THRESHOLDS.spliceai.splicingBp4Below) } }).rule.state).toBe("bp4");
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

  it("names the channel and shift the maximum came from, in transcript direction", () => {
    // SpliceAI's DP is genomic. NAE1 is a reverse-strand gene, so a genomic −12 is 12 bases DOWNSTREAM
    // in the transcript; the tab speaks one direction everywhere, so it prints +12.
    const rev = build({ conservationData: { spliceai: { ds_ag: 0.01, ds_al: 0.34, ds_dg: 0, ds_dl: 0.02, max_ds: 0.34, dp: { ds_ag: 3, ds_al: -12, ds_dg: 0, ds_dl: 40 } } } });
    expect(rev.rule.maxChannel).toBe("ds_al");
    expect(rev.rule.maxShift).toBe(12);
    expect(splicingFinding(rev).headline).toBe("SpliceAI predicts a splicing change (acceptor loss at +12 bp)");
    const rows = groupSpliceReadings(rev.readings);
    expect(rows.map(g => g.group)).toEqual(["rule", "channels", "context"]);
    expect(rows[1].rows.find(r => r.key === "spliceai-ds_al")!.call?.label).toBe("Maximum");
    expect(rows[1].rows.find(r => r.key === "spliceai-ds_al")!.sub).toBe("at +12 bp from the variant");
    // A forward-strand gene keeps the sign.
    const fwd = build({ conservationData: { spliceProximity: { strand: "+" }, spliceai: { ds_ag: 0, ds_al: 0.34, ds_dg: 0, ds_dl: 0, max_ds: 0.34, dp: { ds_al: -12 } } } });
    expect(fwd.rule.maxShift).toBe(-12);
    // No strand: the genomic number is kept and labelled, never silently flipped or presented as transcript direction.
    const unk = build({ conservationData: { spliceProximity: { strand: null }, spliceai: { ds_ag: 0, ds_al: 0.34, ds_dg: 0, ds_dl: 0, max_ds: 0.34, dp: { ds_al: -12 } } } });
    expect(unk.readings.find(r => r.key === "spliceai-ds_al")!.sub).toBe("at −12 bp from the variant (genomic)");
  });

  it("gives no location for a score that is indistinguishable from zero", () => {
    const ev = build({ conservationData: { spliceai: { ds_ag: 0, ds_al: 0, ds_dg: 0.001, ds_dl: 0, max_ds: 0.001, dp: { ds_ag: -360, ds_al: 93, ds_dg: -208, ds_dl: -18 } } } });
    expect(ev.readings.find(r => r.key === "spliceai-ds_dg")!.sub).toBeNull();
    expect(splicingFinding(ev).headline).toBe("SpliceAI's score is below the splicing BP4 threshold");
    expect(splicingFinding(ev).predicate).toMatch(/\(donor gain\) is at or below 0\.1/);
  });

  it("marks the band the score sits in on the ruler", () => {
    const ev = build({ conservationData: { spliceai: sai(0.03) } });
    const r = ev.readings.find(x => x.key === "spliceai")!;
    expect(r.scale!.bands.find(b => b.active)!.side).toBe("benign");
    expect(r.call).toEqual({ label: "BP4 · splicing", tone: "good", isCode: true, unapplied: true });
  });

  it("prints a delta score one way everywhere, never 0.00 for a non-zero score or 0.10 inside BP4", () => {
    expect(formatDelta(0)).toBe("0.00");
    expect(formatDelta(0.001)).toBe("< 0.01");
    expect(formatDelta(0.34)).toBe("0.34");
    expect(formatDelta(0.0996)).toBe("0.100");
    expect(formatDelta(0.1)).toBe("0.10");
    expect(formatDelta(0.1996)).toBe("0.200");
    const ev = build({ conservationData: { spliceai: sai(0.001) } });
    expect(ev.readings.find(x => x.key === "spliceai")!.scoreText).toBe("< 0.01");
    expect(splicingFinding(ev).predicate).toMatch(/^a max Δ under 0\.01/);
  });

  it("keeps two scored dbscSNV models as two rows", () => {
    const ev = build({ conservationData: { dbscsnv: { ada_score: 0.9, rf_score: 0.4 } } });
    const ctx = groupSpliceReadings(ev.readings).find(g => g.group === "context")!.rows.map(r => r.key);
    expect(ctx).toContain("dbscsnv-ada");
    expect(ctx).toContain("dbscsnv-rf");
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

describe("splice map", () => {
  // BRCA1 exon 3 (ENST00000357654, reverse strand, 54 bp), variant at chr17:43115729 — the 4th exonic
  // base from the donor. Live SpliceAI (Broad, 2026-10-02) put the donor at DP −3 and the exon's
  // acceptor at DP +50, in GENOMIC coordinates; both must land on this exon's ends once the strand
  // flips them into transcript direction.
  const brca1 = (strand: "+" | "-" | null, ds: Record<string, number>, dp: Record<string, number>) =>
    build({
      conservationData: {
        spliceProximity: { distance: 3, junctionType: "donor", regionType: "exonic", exonNumber: 3, totalExons: 24, exonLength: 54, strand },
        spliceai: { ds_ag: 0, ds_al: 0, ds_dg: 0, ds_dl: 0, max_ds: Math.max(0, ...Object.values(ds)), ...ds, dp: { ds_ag: 50, ds_al: 0, ds_dg: -3, ds_dl: 1, ...dp } },
      },
    });

  it("converts the two numberings across the missing zero", () => {
    expect(offsetBetweenPositions(-7, 8)).toBe(14);
    expect(offsetBetweenPositions(-7, -3)).toBe(4);
    expect(offsetBetweenPositions(5, -1)).toBe(-5);
  });

  it("puts the junction, the exon and both annotated sites where the variant says", () => {
    const m = brca1("-", {}, {}).map!;
    expect(m.junctionOffset).toBe(3.5);
    expect(m.exon).toEqual({ start: -50.5, end: 3.5 });
    expect(m.sites).toEqual([
      { type: "acceptor", offset: -50, far: true },
      { type: "donor", offset: 3, far: false },
    ]);
  });

  it("flips SpliceAI's genomic delta positions on a reverse-strand gene and lands them on the exon's sites", () => {
    const m = brca1("-", { ds_ag: 0.4, ds_dg: 0.3 }, {}).map!;
    const byKey = Object.fromEntries(m.predictions.map(x => [x.key, x]));
    expect(byKey.ds_dg.offset).toBe(3);
    expect(byKey.ds_dg.atSite).toBe("donor");
    expect(byKey.ds_ag.offset).toBe(-50);
    expect(byKey.ds_ag.atSite).toBe("acceptor");
  });

  it("does not flip them on a forward-strand gene", () => {
    const m = brca1("+", { ds_dg: 0.3 }, {}).map!;
    expect(m.predictions[0].offset).toBe(-3);
    expect(m.predictions[0].atSite).toBeNull();
  });

  it("places nothing, and says why, when the strand is not resolved", () => {
    const m = brca1(null, { ds_dg: 0.3 }, {}).map!;
    expect(m.predictions).toEqual([]);
    expect(m.predictionsNote).toMatch(/strand is not resolved/);
  });

  it("leaves out scores indistinguishable from zero, and counts them as quiet, never as lollipops", () => {
    const m = brca1("-", { ds_dg: 0.3 }, {}).map!;
    expect(m.predictions.map(x => x.key)).toEqual(["ds_dg"]);
    expect(m.belowFloor).toBe(3);
    expect(m.quiet.map(q => q.key)).toEqual(["ds_ag", "ds_al", "ds_dl"]);
    expect(m.quiet.every(q => q.ds === 0)).toBe(true);
    // Gain/loss kind is carried for the row's own encoding.
    expect(m.quiet.find(q => q.key === "ds_ag")!.kind).toBe("gain");
    expect(m.quiet.find(q => q.key === "ds_dl")!.kind).toBe("loss");
    expect(m.quiet.find(q => q.key === "ds_ag")!.name).toBe("Acceptor gain");
  });

  it("widens the window to hold a distant prediction and the far junction, never past 2 kb", () => {
    expect(brca1("-", {}, {}).map!.halfWidth).toBe(50);
    expect(brca1("-", { ds_al: 0.5 }, { ds_al: 180 }).map!.halfWidth).toBe(200);
    expect(brca1("-", { ds_al: 0.5 }, { ds_al: 480 }).map!.halfWidth).toBe(1000);
    expect(brca1("-", { ds_al: 0.5 }, { ds_al: 9000 }).map!.halfWidth).toBe(2000);
  });

  it("is null when the variant cannot be placed at a donor or acceptor", () => {
    expect(build({ conservationData: { spliceProximity: { distance: 12, junctionType: "terminal", regionType: "exonic" } } }).map).toBeNull();
  });

  it("says in the channel row when a delta lands on an annotated site", () => {
    const ev = brca1("-", { ds_dg: 0.3 }, {});
    expect(ev.readings.find(x => x.key === "spliceai-ds_dg")!.note).toBe("Lands on the annotated donor");
  });
});

describe("splice map — neighbouring exons", () => {
  // Reverse strand, variant at genomic 1000 in exon 3 (genomic 960–1010, so its donor is at the LOW
  // end); exon 4 lies downstream in the transcript (genomic 700–760), exon 2 upstream (1100–1180).
  const withExons = (extra: Record<string, any> = {}) =>
    build({
      conservationData: {
        spliceProximity: {
          distance: 10, junctionType: "acceptor", regionType: "exonic", exonNumber: 3, totalExons: 6, exonLength: 51, strand: "-", genomicPos: 1000,
          nearbyExons: [
            { number: 4, start: 700, end: 760 },
            { number: 3, start: 960, end: 1010 },
            { number: 2, start: 1100, end: 1180 },
          ],
        },
        ...extra,
      },
    });

  it("takes every exon's bounds from the resolver's list, flipped into transcript direction", () => {
    const m = withExons().map!;
    // Exon 3: genomic 960–1010 around pos 1000 → transcript offsets [−10.5, +40.5].
    expect(m.exon).toEqual({ start: -10.5, end: 40.5 });
    expect(m.neighbours).toEqual([
      { number: 2, start: -180.5, end: -99.5 },
      { number: 4, start: 239.5, end: 300.5 },
    ]);
    expect(m.totalExons).toBe(6);
  });

  it("adds the neighbours' annotated sites, so a delta can land on them", () => {
    const m = withExons({ spliceai: { ds_ag: 0, ds_al: 0, ds_dg: 0.5, ds_dl: 0, max_ds: 0.5, dp: { ds_dg: -240 } } }).map!;
    // Genomic −240 on a reverse strand is transcript +240: exon 4's acceptor base (start 239.5 + 0.5)… which is an ACCEPTOR,
    // so a donor gain there is NOT on a site of its type.
    expect(m.sites.filter(x => x.far).length).toBeGreaterThanOrEqual(4);
    expect(m.predictions[0].offset).toBe(240);
    expect(m.predictions[0].atSite).toBeNull();
    const ac = withExons({ spliceai: { ds_ag: 0.5, ds_al: 0, ds_dg: 0, ds_dl: 0, max_ds: 0.5, dp: { ds_ag: -240 } } }).map!;
    expect(ac.predictions[0].atSite).toBe("acceptor");
  });

  it("falls back to the nearest exon alone when the payload predates the list", () => {
    const m = build({ conservationData: { spliceProximity: { distance: 10, junctionType: "acceptor", regionType: "exonic", exonNumber: 3, totalExons: 6, exonLength: 51, strand: "-", genomicPos: 1000 } } }).map!;
    expect(m.neighbours).toEqual([]);
    expect(m.exon.start).not.toBeNull();
  });
});

describe("why SpliceAI has no score", () => {
  const missed = (kind: string, extra: Record<string, any> = {}) =>
    build({ conservationData: { spliceai: null, spliceaiFailure: { kind, httpStatus: null, detail: null, ...extra } } });

  it("names a rate limit, a refused coordinate and a timeout, and labels the state", () => {
    const rl = missed("rate-limited", { httpStatus: 429 });
    expect(rl.spliceai.availability.reason).toMatch(/limits interactive use/);
    expect(rl.spliceai.availability.label).toBe("Provider busy");
    const rej = missed("coordinate-rejected", { httpStatus: 400, detail: "REF does not match" });
    expect(rej.spliceai.availability.reason).toMatch(/reference base does not match/);
    expect(rej.spliceai.availability.reason).toMatch(/REF does not match/);
    expect(rej.spliceai.availability.label).toBe("Coordinate rejected");
    expect(missed("timeout").spliceai.availability.reason).toMatch(/did not answer/);
  });

  it("falls back to the cautious wording when the payload predates the field", () => {
    expect(build().spliceai.availability.reason).toMatch(/does not record why/);
  });
});

describe("splice map — terminal boundaries and display filters", () => {
  const sod1 = () => nae1Reference({
    conservationData: {
      spliceProximity: { distance: 58, junctionType: "donor", regionType: "exonic", strand: "+", exonNumber: 1, totalExons: 5, exonLength: 149 },
      spliceai: { ds_ag: 0.003, ds_al: 0, ds_dg: 0.14, ds_dl: 0, max_ds: 0.14, dp: { ds_ag: -90, ds_dg: -2 } },
    },
  });

  it("does not invent an acceptor at exon 1 or match a prediction to a transcript start", () => {
    const ev = buildSplicingEvidence({ result: sod1(), showSmallSignals: true });
    expect(ev.map!.sites.map(s => s.type)).toEqual(["donor"]);
    expect(ev.map!.predictions.find(p => p.key === "ds_ag")!.atSite).toBeNull();
    expect(ev.rule.state).toBe("between");
  });

  it("excludes the last exon's end from annotated donors", () => {
    const result = sod1();
    Object.assign(result.conservationData.spliceProximity, { exonNumber: 5, junctionType: "acceptor" });
    expect(buildSplicingEvidence({ result }).map!.sites.map(s => s.type)).toEqual(["acceptor"]);
  });

  it.each(["terminal", "donor", "acceptor"])("does not invent a junction for a single-exon transcript labelled %s", junctionType => {
    const result = sod1();
    Object.assign(result.conservationData.spliceProximity, { totalExons: 1, junctionType });
    const ev = buildSplicingEvidence({ result });
    expect(ev.geometry.junction).toBe("terminal");
    expect(ev.geometry.position).toBeNull();
    expect(ev.map).toBeNull();
    expect(ev.rule.state).toBe("between");
  });

  it("retains high signals without positions and uses them for the score-axis limit", () => {
    const result = sod1();
    Object.assign(result.conservationData.spliceai, { ds_ag: 0.9, max_ds: 0.9, dp: { ds_ag: null, ds_dg: -2 } });
    const ev = buildSplicingEvidence({ result });
    expect(ev.map!.maxScore).toBe(0.9);
    expect(ev.map!.predictions.map(p => p.ds)).toEqual([0.14]);
    expect(ev.map!.missingPositions).toEqual([{ key: "ds_ag", name: "Acceptor gain", ds: 0.9 }]);
    expect(ev.map!.predictionsNote).toMatch(/no delta position/);
    expect(ev.rule.state).toBe("pp3");
  });

  it("makes small non-zero channels inspectable without changing evidence or the engine record", () => {
    const result = sod1();
    const normal = buildSplicingEvidence({ result });
    const detailed = buildSplicingEvidence({ result, showSmallSignals: true });
    expect(normal.map!.predictions).toHaveLength(1);
    expect(detailed.map!.predictions).toHaveLength(2);
    expect(detailed.rule).toEqual(normal.rule);
    expect(detailed.engine).toEqual(normal.engine);
    expect(detailed.map!.predictions.every(p => p.ds > 0)).toBe(true);
  });

  it("moves non-zero sub-floor channels to lollipops when asked, but never an exactly-zero one", () => {
    const result = sod1();
    const normal = buildSplicingEvidence({ result });
    const detailed = buildSplicingEvidence({ result, showSmallSignals: true });
    // Default: the 0.003 acceptor gain is quiet alongside the zeros.
    expect(normal.map!.quiet.map(q => q.key)).toEqual(["ds_ag", "ds_al", "ds_dl"]);
    expect(normal.map!.belowFloor).toBe(3);
    // Requested: the non-zero 0.003 moves to the axis; the two exact zeros stay in the no-signal row.
    expect(detailed.map!.quiet.map(q => q.key)).toEqual(["ds_al", "ds_dl"]);
    expect(detailed.map!.quiet.every(q => q.ds === 0)).toBe(true);
    expect(detailed.map!.belowFloor).toBe(2);
    expect(detailed.map!.predictions.find(p => p.key === "ds_ag")!.ds).toBe(0.003);
  });
});
