import { describe, it, expect } from "vitest";
import { buildConstraintMetrics, buildLoeufMetric } from "../constraintMetrics";
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
  it("describes clamped off-scale values", () => {
    expect(buildConstraintMetrics(result({ ...constraint, missense_z: -2 }))[0].detail).toContain("outside the display range");
  });
  it("does not apply current bands to a different reported release", () => {
    const older = { ...constraint, provenance: { ...constraint.provenance, release: "2.1.1" } };
    expect(buildConstraintMetrics(result(older)).every(m => m.verdict === "Different release" && m.bands.length === 0)).toBe(true);
  });
});
