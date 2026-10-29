import { describe, it, expect } from "vitest";
import { buildConstraintMetrics, buildLoeufMetric, buildMissenseZMetric, buildRmcMetric, constraintSourceLabel, releaseTag, tickLabelAlignments } from "../constraintMetrics";
import { THRESHOLDS } from "../../../shared/thresholds";
import { buildVariantHeaderModel } from "../variantHeaderModel";
import type { AnalysisResult } from "../../../types";
const constraint = {
  missense_z: 3.086, oe_mis: 0.5, pli: 0.99, loeuf: 0.449, isPP2Constrained: false,
  provenance: { release: "4.1.2", assembly: "GRCh38", geneId: "ENSG00000000001", transcriptId: "ENST00000000001", transcriptVersion: "1", selection: "matched", sourceUrl: "https://gnomad.broadinstitute.org/downloads", sourceSha256: "test" },
  regionalRelease: "4.1.1", regionalStatus: "unverified-locus",
};
const result = (gc: any = constraint, status = "ok") => ({ gnomadConstraint: gc, serviceStatus: { gnomadConstraint: status } }) as unknown as AnalysisResult;
describe("constraint source, precision and availability", () => {
  it("classifies LOEUF from raw values at the current release cutoff", () => {
    expect(buildLoeufMetric(0.449).verdict).toBe("LoF constrained");
    expect(buildLoeufMetric(0.45).verdict).toBe("Not LoF constrained");
    expect(buildLoeufMetric(0.359).verdict).toBe("Strong LoF intolerance");
    expect(buildLoeufMetric(0.36).verdict).toBe("LoF constrained");
  });
  it("shows the explicit regional identity refusal", () => {
    expect(buildConstraintMetrics(result())[2]).toMatchObject({ marker: null, verdict: "Unverified locus" });
  });
  it("does not call failed QC a significance failure", () => {
    expect(buildConstraintMetrics(result({ ...constraint, regionalStatus: "failed-qc" }))[2]).toMatchObject({ verdict: "QC warning", marker: null });
  });
  it("suppresses values and classifications when QC flags are present", () => {
    for (const metric of buildConstraintMetrics(result({ ...constraint, qualityFlags: ["low_coverage"], regionalStatus: "failed-qc" }))) {
      expect(metric.marker).toBeNull(); expect(metric.verdict).toBe("QC warning");
    }
  });
  it.each(["pending", "error", "timeout", "not_found"])("keeps visible absence for %s", status => {
    const metrics = buildConstraintMetrics(result(null, status));
    expect(metrics).toHaveLength(3);
    expect(metrics.every(m => m.marker === null && m.verdict !== "No depletion")).toBe(true);
    if (status === "pending") expect(metrics[0].verdict).toBe("Running");
    if (status === "error" || status === "timeout") expect(metrics[0].verdict).toBe("Provider error");
  });
  it("announces constraint errors independently of frequency availability", () => {
    expect(buildVariantHeaderModel({ gene: "TEST", variant: "p.Ala1Val", uniprotId: "TEST", analysisResult: result(null, "error") }).runState?.detail).toContain("Gene constraint");
  });
  it("withholds release-specific interpretation for a legacy payload", () => {
    const { provenance, ...legacy } = constraint;
    expect(buildConstraintMetrics(result(legacy)).every(m => m.verdict === "Release unreported" && m.bands.length === 0)).toBe(true);
  });
  it("keeps Missense Z as gene context: it states that PP2 is not read from Z", () => {
    // PP2 was Z ≥ 3.09 AND o/e < 0.6, an uncalibrated proxy; it is now the regional O/E row.
    const metric = buildMissenseZMetric(3.5);
    expect(metric.facts.join(" ")).toMatch(/PP2 is read from the regional O\/E/);
    expect(metric.tooltip).not.toMatch(/PP2 proxy/);
    expect(metric.detail).toContain(`Z ${THRESHOLDS.misZ.pathogenicSupporting.toFixed(1)} and ${THRESHOLDS.misZ.pathogenicStrong}`);
  });
  it("tags only a reading whose release differs from the group's, and only when it has a value and an interpretation", () => {
    const res = result();
    const [z, loeuf, rmc] = buildConstraintMetrics(res);
    const group = constraintSourceLabel(res);
    expect(releaseTag(z, group)).toBeNull();
    expect(releaseTag(loeuf, group)).toBeNull();
    // Regional O/E is measured against its own release; here it has no value (unverified locus).
    expect(releaseTag(rmc, group)).toBeNull();
    const measured = buildConstraintMetrics(result({ ...constraint, regionalStatus: undefined, hasRegionalData: true, regionalConstraint: { isConstrained: true, oeRatio: 0.5, pValue: 0.001, regionText: "A1 to B2" } }))[2];
    expect(releaseTag(measured, group)).toBe("v4.1.1");
  });
  it("words an unreported regional release without the wrapper parentheses", () => {
    const gc = { ...constraint, regionalRelease: undefined, regionalStatus: undefined, hasRegionalData: true, regionalConstraint: { isConstrained: true, oeRatio: 0.5, pValue: 0.001, regionText: "A1 to B2" } };
    const res = result(gc);
    expect(releaseTag(buildConstraintMetrics(res)[2], constraintSourceLabel(res))).toBe("regional release unreported");
  });
  it("shows no tag when interpretation is withheld, where it would contradict the verdict", () => {
    const older = { ...constraint, provenance: { ...constraint.provenance, release: "2.1.1" }, regionalStatus: undefined, hasRegionalData: true, regionalConstraint: { isConstrained: true, oeRatio: 0.5, pValue: 0.001, regionText: "A1 to B2" } };
    const res = result(older);
    for (const metric of buildConstraintMetrics(res)) expect(releaseTag(metric, constraintSourceLabel(res))).toBeNull();
  });
  it("fans close tick numerals outwards so LOEUF's 0.36 and 0.45 never overprint", () => {
    const loeuf = buildLoeufMetric(0.96);
    // Reversed axis: 0.45 is drawn left of 0.36. The left numeral ends at its tick, the right starts at its.
    expect(loeuf.ticks.map((t) => t.label)).toEqual(["0.36", "0.45"]);
    expect(tickLabelAlignments(loeuf)).toEqual(["start", "end"]);
    // Well-separated ticks and single ticks stay centred.
    expect(tickLabelAlignments(buildMissenseZMetric(1))).toEqual(["center", "center"]);
    expect(tickLabelAlignments(buildRmcMetric(true, null))).toEqual(["center", "center", "center"]);
    expect(tickLabelAlignments({ ...loeuf, ticks: [] })).toEqual([]);
  });
  it("describes clamped off-scale values", () => {
    expect(buildConstraintMetrics(result({ ...constraint, missense_z: -2 }))[0].detail).toContain("outside the display range");
  });
  it("does not apply current bands to a different reported release", () => {
    const older = { ...constraint, provenance: { ...constraint.provenance, release: "2.1.1" } };
    expect(buildConstraintMetrics(result(older)).every(m => m.verdict === "Different release" && m.bands.length === 0)).toBe(true);
  });
});

describe("Regional O/E reads Chao et al. v3's calibrated bands, the engine's PP2 rule", () => {
  const at = (oe: number, isConstrained = true) => buildRmcMetric(true, { isConstrained, oeRatio: oe, pValue: 0.001, regionText: "1:100 to 200 (GRCh38)" });
  it("draws the PP2 edges as calibrated cut-points with their source", () => {
    const m = at(0.5);
    expect(m.cutPoints?.origin).toBe("calibrated");
    expect(m.cutPoints?.href).toBe("https://doi.org/10.1101/2024.04.11.588920");
    expect(m.ticks.map(t => t.at)).toEqual([0.36, 0.59, 1]);
  });
  it("bands an O/E by its calibrated edges (≤ 0.36 Moderate, ≤ 0.59 Supporting), whatever the interval's p", () => {
    expect([at(0.36).verdict, at(0.36).tone]).toEqual(["PP2 Moderate band", "path"]);
    expect([at(0.59).verdict, at(0.59).tone]).toEqual(["PP2 Supporting band", "warn"]);
    // UROD's significant interval at 0.81 used to read "Subgenic constrained" in red; no calibrated band holds it.
    expect([at(0.81).verdict, at(0.81).tone]).toEqual(["No calibrated band", "muted"]);
    expect(at(0.5, false).verdict).toBe("PP2 Supporting band");
  });
  it("names the BP1 band as context the engine does not apply", () => {
    expect(at(1.3).verdict).toBe("BP1 band (not applied)");
    expect(at(1.3).facts.join(" ")).toMatch(/does not apply BP1/);
  });
});
