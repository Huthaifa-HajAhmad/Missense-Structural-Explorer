// @vitest-environment jsdom
/**
 * EvidenceInspector.populationFrequency.test.tsx — the Population Frequencies tab's right rail.
 *
 * A separate file from `EvidenceInspector.test.tsx` on purpose: that suite covers the Thresholds
 * pane, this one covers the clinical pane, and neither reads the other's fixtures.
 *
 * These assertions pin corrections to claims the rail was making:
 *
 *   • the transcript tier badge read "MANE Select (Gold)";
 *   • the ACMG Frequency Criteria card printed "BS1 … MAF > 0.1%" beside a classifier that branches
 *     at 1% — a provenance card contradicting the rule it documents, which is the class of defect
 *     `server/invariants.test.ts` and the audit's §2D both exist to catch;
 *   • the provenance footer printed "v4.0.0" for a query that pins no patch, and a "E-Fetch API"
 *     badge named a mechanism the client never calls.
 *
 * The rail now renders its frequency facts from the same module as the main column, so a release
 * name or a criterion restated here would be a claim nothing checks — the release assertion below
 * proves it follows the payload rather than a literal.
 */
import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EvidenceInspector } from "../EvidenceInspector";
import { THRESHOLDS } from "../../../shared/thresholds";

const GNOMAD = {
  maxAF: 5.5e-6, groupMaxAF: 5.5e-6, genomeAF: null, exomeAF: 5.5e-6,
  genomeAC: null, exomeAC: 8, genomeAN: null, exomeAN: 1459156,
  nHomozygous: null, dataset: "gnomad_r4",
};

const CLINICAL_RESULT: any = {
  metadata: { variant: "p.Arg591Trp", uniprotId: "Q9H116" },
  transcriptId: "ENST00000338121",
  maneRefSeqId: "NM_022482.5",
  isManeSelect: true,
  predictorData: { gnomadVariantAssembly: "GRCh38" },
  gnomadFrequency: GNOMAD,
  serviceStatus: { gnomadFrequency: "ok" },
  gnomadConstraint: { pli: 0.42 },
};

function renderRail(overrides: Record<string, unknown> = {}) {
  return render(
    <EvidenceInspector
      analysisResult={{ ...CLINICAL_RESULT, ...overrides }}
      activeEvidenceTab="clinical"
    />,
  );
}

describe("EvidenceInspector — clinical pane", () => {
  it("names the transcript tier without editorialising the tier", () => {
    renderRail();
    expect(screen.getByText("MANE Select")).toBeTruthy();
    // The badge is uppercased by CSS; the source text must not carry the suffix either.
    expect(screen.queryByText(/Gold/i)).toBeNull();
  });

  it("states the frequency cut-points the rule engine actually branches on", () => {
    renderRail();
    const freq = THRESHOLDS.populationFrequency;

    // BS1 is the one that was wrong: the card said 0.1%, the engine tests 1%.
    expect(freq.tooCommonForDisorder).toBe(0.01);
    expect(screen.getByText(/Frequency greater than expected for the disorder \(MAF > 1\.0%\)/)).toBeTruthy();
    expect(screen.queryByText(/MAF > 0\.1%/)).toBeNull();

    // PM2 documents both ceilings, including the recessive branch the card omitted entirely.
    expect(screen.getByText(/MAF ≤ 0\.01%, or ≤ 0\.1% when pLI < 0\.9/)).toBeTruthy();
    expect(screen.getByText(/Stand-alone benign \(MAF > 5% in population cohorts\)/)).toBeTruthy();
  });

  it("does not assert a gnomAD patch release the code never reads", () => {
    renderRail();
    expect(screen.getByText("r4")).toBeTruthy();
    expect(screen.queryByText(/v4\.0\.0|v4\.1\.0/)).toBeNull();
  });

  it("takes the release from the payload rather than a literal", () => {
    renderRail({ gnomadFrequency: { ...GNOMAD, dataset: "gnomad_r3" } });
    expect(screen.getByText("gnomad_r3")).toBeTruthy();
    expect(screen.queryByText("r4")).toBeNull();
  });

  it("states this run's own frequency reading", () => {
    renderRail({ ruleBasedInsights: { acmgCriteria: [{ code: "PM2", reason: "rare" }] } });
    expect(screen.getByText("This run's frequency reading")).toBeTruthy();
    expect(screen.getByText("5.50e-6")).toBeTruthy();
    // Scoped to this card: the ACMG Frequency Criteria card below it also renders the code "PM2" as
    // a reference row, so a page-wide query would find two and prove nothing about this one.
    // `closest("div")` is the card itself — going one level further up would include that card.
    const card = screen.getByText("This run's frequency reading").closest("div")!;
    expect(within(card).getByText("PM2")).toBeTruthy();
  });

  it("marks the criterion unconfirmed when the payload carries no engine criteria", () => {
    renderRail();
    expect(screen.getByText(/unconfirmed \(supports PM2\)/)).toBeTruthy();
  });

  it("names a suppression rather than showing the withheld criterion as the engine's", () => {
    renderRail({
      metadata: { variant: "p.Arg591Trp", uniprotId: "Q9H116", acmgWeighting: "strict-structural" },
      ruleBasedInsights: { acmgCriteria: [{ code: "PP3", reason: "computational" }] },
    });
    expect(screen.getByText("None recorded")).toBeTruthy();
    expect(screen.getByText(/strict-structural weighting withheld it/)).toBeTruthy();
  });

  it("does not claim a ClinVar record was read when the query failed", () => {
    const { container } = renderRail({
      clinvar: { classification: null },
      serviceStatus: { gnomadFrequency: "ok", clinvar: "timeout" },
    });
    expect(container.textContent).not.toMatch(/Unindexed in ClinVar/);
    expect(screen.getByText(/No ClinVar record read/)).toBeTruthy();
  });
});
