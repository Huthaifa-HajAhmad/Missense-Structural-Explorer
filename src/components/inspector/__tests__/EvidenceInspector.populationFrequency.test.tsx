// @vitest-environment jsdom
/**
 * EvidenceInspector.populationFrequency.test.tsx — the Population Data tab's right rail.
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
    const cuts = screen.getByTestId("cut-points");
    expect(within(cuts).getByText("> 1%")).toBeTruthy();
    expect(within(cuts).queryByText("> 0.1%")).toBeNull();

    // PM2's two ceilings are two rows, each with what selects it (curated inheritance first, pLI only without it).
    expect(within(cuts).getByText("≤ 0.01%")).toBeTruthy();
    expect(within(cuts).getByText("≤ 0.1%")).toBeTruthy();
    expect(within(cuts).getByText(/higher ceiling: curated autosomal recessive only, or pLI < 0\.9/)).toBeTruthy();
    expect(within(cuts).getByText("> 5%")).toBeTruthy();
    // The cut-point this variant's frequency supports is the one marked.
    const active = cuts.querySelectorAll("[data-active]");
    expect(active.length).toBe(1);
    expect(active[0].textContent).toMatch(/^PM2/);
  });

  it("does not assert a gnomAD patch release the code never reads", () => {
    renderRail();
    // "v4", the release name gnomAD uses — not the `gnomad_r4` API alias, and never a minor.
    expect(screen.getByText("v4")).toBeTruthy();
    expect(screen.queryByText(/v4\.0\.0|v4\.1\.0/)).toBeNull();
  });

  it("takes the release from the payload rather than a literal", () => {
    renderRail({ gnomadFrequency: { ...GNOMAD, dataset: "gnomad_r3" } });
    expect(screen.getByText("v3")).toBeTruthy();
    expect(screen.queryByText("v4")).toBeNull();
  });

  it("states where this run's reading came from", () => {
    renderRail({ ruleBasedInsights: { acmgCriteria: [{ code: "PM2", reason: "rare" }] } });
    const card = screen.getByTestId("rule-trace");
    /*
     * The counts carry their cohort. An unattributed `AC 8 · AN 1,459,156` sitting above
     * "From: gnomAD ancestry-grouped maximum" reads as though the grouped maximum produced them, and
     * nothing in the payload reports counts for that group — so the cohort name is part of the claim,
     * not decoration.
     */
    expect(card.textContent).toMatch(/Alleles observed: AC 8 · AN 1,459,156 · Exomes/);
    expect(within(card).getByText("AF the rule read")).toBeTruthy();
    expect(within(card).getByText("5.50e-6")).toBeTruthy();
    expect(within(card).getByText(/gnomAD ancestry-grouped maximum · v4/)).toBeTruthy();
    // Scoped to this card: the ACMG Frequency Criteria card below it also renders the code "PM2" as
    // a reference row, so a page-wide query would find two and prove nothing about this one.
    expect(within(card).getByText("PM2 · Supporting")).toBeTruthy();
  });

  it("states the weighting that decided whether the criterion was applied", () => {
    renderRail({
      metadata: { variant: "p.Arg591Trp", uniprotId: "Q9H116", acmgWeighting: "strict-structural" },
      ruleBasedInsights: { acmgCriteria: [{ code: "PP3", reason: "computational" }] },
    });
    const card = screen.getByTestId("rule-trace");
    expect(within(card).getByTestId("acmg-weighting").textContent).toBe("strict-structural");
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
    // Only a weighting that actually suppresses frequency evidence may be named as the cause.
    expect(screen.getByText(/strict-structural weighting is what withholds it/)).toBeTruthy();
  });

  it("does not blame a weighting that cannot withhold the criterion", () => {
    renderRail({
      metadata: { variant: "p.Arg591Trp", uniprotId: "Q9H116", acmgWeighting: "standard" },
      ruleBasedInsights: { acmgCriteria: [{ code: "PP3", reason: "computational" }] },
    });
    expect(screen.getByText(/the engine recorded no frequency criterion/)).toBeTruthy();
    expect(screen.queryByText(/weighting is what withholds it/)).toBeNull();
  });

  it("does not claim a ClinVar record was read when the query failed", () => {
    const { container } = renderRail({
      clinvar: { classification: null },
      serviceStatus: { gnomadFrequency: "ok", clinvar: "timeout" },
    });
    expect(container.textContent).not.toMatch(/Unindexed in ClinVar|Not in ClinVar/);
    expect(screen.getByText("Query failed — not read")).toBeTruthy();
  });

  it("words a confirmed ClinVar absence as an absence, not as a failed read", () => {
    renderRail({
      clinvar: { classification: "Not found in ClinVar" },
      serviceStatus: { gnomadFrequency: "ok", clinvar: "ok" },
    });
    expect(screen.getByText("Not in ClinVar")).toBeTruthy();
    expect(screen.queryByText(/not read|No ClinVar record read/)).toBeNull();
  });

  it("traces a recorded gnomAD absence as 'no record', not as a global maximum", () => {
    const { container } = renderRail({
      gnomadFrequency: null,
      serviceStatus: { gnomadFrequency: "not_found", clinvar: "ok" },
      gnomadConstraint: { pli: 1 },
    });
    const card = screen.getByTestId("rule-trace");
    expect(card.textContent).toMatch(/gnomAD — no record/);
    expect(card.textContent).toMatch(/lower ceiling \(no curated inheritance; pLI 1\.00 ≥ 0\.9\)/);
    expect(container.textContent).not.toMatch(/global maximum/);
  });
});

/** UROD p.Gly318Arg as the local ingest serves it, with All of Us holding the most copies. */
describe("EvidenceInspector — clinical pane, local ingest", () => {
  const combined = 1674 / 1613998;
  const UROD: any = {
    ...CLINICAL_RESULT,
    metadata: { variant: "p.Gly318Arg", uniprotId: "P06132" },
    gnomadFrequency: {
      maxAF: combined, groupMaxAF: combined, genomeAF: combined, exomeAF: null,
      genomeAC: 1674, exomeAC: null, genomeAN: 1613998, exomeAN: null,
      nHomozygous: 15, dataset: "gnomad_r4_local",
    },
    aouFrequency: { aouAC: 2085, aouAN: 490780, aouHet: null, aouHom: null },
    aouLookup: { localTable: "found", remoteDbnsfp: "not-reported" },
    gnomadConstraint: { pli: 0 },
    ruleBasedInsights: { acmgCriteria: [{ code: "BS2", reason: "15 homozygotes" }] },
  };

  it("does not call the combined AF an ancestry-grouped maximum", () => {
    render(<EvidenceInspector analysisResult={UROD} activeEvidenceTab="clinical" />);
    const card = screen.getByTestId("rule-trace");
    expect(card.textContent).toMatch(/gnomAD combined frequency/);
    expect(card.textContent).not.toMatch(/Highest across ancestry groups/);
    expect(card.textContent).toMatch(/no ancestry breakdown/);
  });

  it("does not credit another cohort's counts to the rule's source", () => {
    render(<EvidenceInspector analysisResult={UROD} activeEvidenceTab="clinical" />);
    const card = screen.getByTestId("rule-trace");
    expect(card.textContent).toMatch(/Most copies in any one cohort: AC 2,085 · AN 490,780 · All of Us/);
    expect(card.textContent).not.toMatch(/Alleles observed/);
  });

  it("shows a recorded BS2 beside an absent frequency criterion", () => {
    render(<EvidenceInspector analysisResult={UROD} activeEvidenceTab="clinical" />);
    expect(screen.getByText("None recorded")).toBeTruthy();
    expect(screen.getByTestId("bs2-recorded").textContent).toMatch(/BS2 from 15 gnomAD homozygotes/);
  });
});

describe("EvidenceInspector — clinical pane, UROD from gnomAD r4", () => {
  const UROD_REMOTE: any = {
    ...CLINICAL_RESULT,
    metadata: { variant: "p.Gly318Arg", uniprotId: "P06132" },
    gnomadFrequency: {
      maxAF: 0.004872, groupMaxAF: 1272 / 75018, genomeAF: 0.004872, exomeAF: 0.000638,
      genomeAC: 742, exomeAC: 932, genomeAN: 152292, exomeAN: 1461706, nHomozygous: 15,
      dataset: "gnomad_r4", groupMaxPopulation: "afr", faf95: 0.01618, faf95Population: "afr",
    },
    gnomadConstraint: { pli: 0 },
    curatedInheritance: { source: "GenCC", modes: ["Autosomal dominant", "Autosomal recessive", "Semidominant"], recessiveOnly: false, sexOrMitoOnly: false, records: 3 },
    ruleBasedInsights: { acmgCriteria: [{ code: "BS1" }, { code: "BS2" }] },
  };

  it("traces both inputs: FAF95 for BA1/BS1 and the grouped maximum for PM2, each with its group", () => {
    render(<EvidenceInspector analysisResult={UROD_REMOTE} activeEvidenceTab="clinical" />);
    const card = screen.getByTestId("rule-trace");
    expect(card.textContent).toMatch(/1\.62% · BA1\/BS1 read FAF95 \(African\/African American \(afr\)\)/);
    expect(card.textContent).toMatch(/1\.70% · PM2 reads the grouped maximum \(African\/African American \(afr\)\)/);
  });

  /** A "none" verdict: FAF95 far under the BS1 cut-point, while the grouped maximum (0.05%) sits
   *  above the 0.01% curated-dominant ceiling — so the ceiling is genuinely the threshold the
   *  verdict failed, and the rail may say so. */
  const UROD_NONE: any = {
    ...UROD_REMOTE,
    gnomadFrequency: {
      maxAF: 0.0005, groupMaxAF: 0.0005, genomeAF: 0.0005, exomeAF: 0.0003,
      genomeAC: 214, exomeAC: 96, genomeAN: 428482, exomeAN: 320000, nHomozygous: 0,
      dataset: "gnomad_r4", groupMaxPopulation: "afr", faf95: 0.00001, faf95Population: "afr",
    },
    ruleBasedInsights: { acmgCriteria: [] },
  };

  it("names the curated inheritance that set the PM2 ceiling, ahead of pLI", () => {
    render(<EvidenceInspector analysisResult={UROD_NONE} activeEvidenceTab="clinical" />);
    expect(screen.getByTestId("ceiling-basis").textContent).toMatch(/curated GenCC inheritance includes Autosomal dominant/);
  });

  it("marks BS1 as this variant's cut-point", () => {
    render(<EvidenceInspector analysisResult={UROD_REMOTE} activeEvidenceTab="clinical" />);
    const active = screen.getByTestId("cut-points").querySelectorAll("[data-active]");
    expect(active.length).toBe(1);
    expect(active[0].textContent).toMatch(/^BS1/);
  });

  it("marks the PM2 ceiling as this verdict's threshold when no criterion fired between the cut-points", () => {
    render(<EvidenceInspector analysisResult={UROD_NONE} activeEvidenceTab="clinical" />);
    // No row is "active" (no criterion fired), but the ceiling the verdict failed IS marked as applied.
    const cuts = screen.getByTestId("cut-points").textContent ?? "";
    expect(cuts).toContain("ceiling applied");
  });

  it("does not claim a PM2 ceiling was applied to a benign-side verdict", () => {
    render(<EvidenceInspector analysisResult={UROD_REMOTE} activeEvidenceTab="clinical" />);
    // BA1/BS1 decided on FAF95 before any ceiling was read: marking a PM2 row "ceiling applied"
    // (and rendering the basis as consulted) certified a step the engine never took.
    expect(screen.getByTestId("cut-points").textContent).not.toMatch(/ceiling applied/);
    expect(screen.getByTestId("rule-trace").textContent).toMatch(/PM2 ceiling \(not reached\)/);
    expect(screen.getByTestId("rule-trace").textContent).toMatch(/The benign cut-points fired before the ceiling was consulted\./);
  });
});
