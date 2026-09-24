// @vitest-environment jsdom
/**
 * ClinicalTab.test.tsx — what the Population Frequencies screen is allowed to claim.
 *
 * Every assertion here pins a claim the screen previously got wrong:
 *
 *   • an outage rendered as a confirmed absence (the UI-side instance of the "timeout never implies
 *     absence" invariant that `server/invariants.test.ts` enforces for the classifier);
 *   • the allele frequency the ACMG engine classified on appeared nowhere on the screen;
 *   • the criterion shown was the module's own classification, so a screen could display PM2 while
 *     the engine's ACMG weighting had withheld it;
 *   • a source's allele counts vanished whenever its frequency could not be derived.
 *
 * The screen renders from `src/shared/frequencyEvidence.ts`, so these assertions hold the surface to
 * the module's contract rather than to a copy of its logic.
 */
import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ClinicalTab } from "../evidence/ClinicalTab";

/** The GZF1 p.Arg591Trp payload the redesign was reviewed against. */
function gzf1Result(overrides: Record<string, unknown> = {}) {
  return {
    metadata: { gene: "GZF1", variant: "p.Arg591Trp", uniprotId: "Q9H116" },
    transcriptId: "ENST00000338121",
    isManeSelect: true,
    clinvar: { classification: "Not found in ClinVar" },
    gnomadFrequency: {
      maxAF: 5.5e-6,
      groupMaxAF: 5.5e-6,
      genomeAF: null,
      exomeAF: 5.5e-6,
      genomeAC: null,
      exomeAC: 8,
      genomeAN: null,
      exomeAN: 1459156,
      nHomozygous: null,
      dataset: "gnomad_r4",
    },
    serviceStatus: { gnomadFrequency: "ok", clinvar: "ok" },
    predictorData: { gnomadVariantAssembly: "GRCh38" },
    gnomadConstraint: { pli: 0.42 },
    ...overrides,
  } as any;
}

function renderTab(result: any) {
  // The tab declares the full dashboard prop bundle; this screen reads only `analysisState`, so the
  // fixture supplies that and nothing else rather than inventing 12 unused props.
  return render(<ClinicalTab {...({ analysisState: { result } } as any)} />);
}

describe("ClinicalTab — a missing frequency is explained, not asserted", () => {
  it("names a provider outage as a provider error, never as an absence", () => {
    const { container } = renderTab(
      gzf1Result({
        gnomadFrequency: null,
        serviceStatus: { gnomadFrequency: "timeout", clinvar: "ok" },
      }),
    );

    // The criterion is withheld: an outage must not be classified as PM2. The withheld sentence
    // names the criteria it declined to apply, so the check is on the verdict itself.
    expect(screen.getByText("Withheld")).toBeTruthy();
    expect(screen.queryByText(/Extremely rare/)).toBeNull();
    // The state is stated in the canonical engine vocabulary, and the failure is flagged once.
    expect(screen.getAllByText("Provider error").length).toBe(2);
    expect(screen.getByText(/did not deliver a reading for this run/i)).toBeTruthy();
    // The old copy asserted the variant was absent from the cohort. It must not appear anywhere.
    expect(container.textContent).not.toMatch(/absent from gnomad/i);
  });

  it("reports a confirmed absence as a zero frequency that satisfies PM2", () => {
    renderTab(
      gzf1Result({
        gnomadFrequency: null,
        serviceStatus: { gnomadFrequency: "not_found", clinvar: "ok" },
      }),
    );
    // The chip shows the supported criterion behind a DASHED border — this fixture carries no engine
    // criteria, so it is what the frequency SUPPORTS, not a confirmed engine verdict.
    const chip = screen.getByText("PM2");
    expect(chip.getAttribute("style") ?? "").toContain("dashed");
    // Both gnomAD datasets report the same classified cause.
    expect(screen.getAllByText(/holds no record of this variant/i).length).toBe(2);
    // A confirmed absence is a result, not a fault: no incomplete-read notice.
    expect(screen.queryByText(/did not deliver a reading for this run/i)).toBeNull();
  });

  it("keeps an outage and an absence distinct in both text and state", () => {
    const outage = renderTab(
      gzf1Result({ gnomadFrequency: null, serviceStatus: { gnomadFrequency: "timeout" } }),
    );
    const outageText = outage.container.textContent ?? "";
    outage.unmount();

    const absent = renderTab(
      gzf1Result({ gnomadFrequency: null, serviceStatus: { gnomadFrequency: "not_found" } }),
    );
    const absentText = absent.container.textContent ?? "";

    expect(outageText).not.toBe(absentText);
    expect(absentText).toContain("holds no record");
    expect(outageText).not.toContain("holds no record");
  });

  it("asserts no absence when no outcome was recorded for the query", () => {
    // `serviceStatus` is optional and placeholder/demo payloads omit it entirely.
    const { container } = renderTab(
      gzf1Result({ gnomadFrequency: null, serviceStatus: undefined }),
    );
    expect(container.textContent).not.toMatch(/not present in gnomAD|holds no record/i);
    expect(screen.getAllByText(/no outcome was recorded/i).length).toBe(2);
  });

  it("treats a build gnomAD does not serve as a refusal, not as a zero frequency", () => {
    renderTab(
      gzf1Result({
        gnomadFrequency: null,
        serviceStatus: { gnomadFrequency: "not_found" },
        predictorData: { gnomadVariantAssembly: "GRCh37" },
      }),
    );
    // The server's gate leaves `not_found` behind for a coordinate it never queried.
    expect(screen.queryByText(/holds no record/)).toBeNull();
    expect(screen.queryByText(/Extremely rare/)).toBeNull();
    expect(screen.getAllByText("Not covered").length).toBe(2);
  });

  it("says a query is still running rather than that nothing was available", () => {
    renderTab(
      gzf1Result({
        gnomadFrequency: null,
        serviceStatus: { gnomadFrequency: "pending", clinvar: "ok" },
      }),
    );
    expect(screen.getByText(/still running/)).toBeTruthy();
    expect(screen.queryByText(/No population frequency was available/)).toBeNull();
    expect(screen.getByText(/still being queried/)).toBeTruthy();
  });
});

describe("ClinicalTab — the frequency the engine read is on the screen", () => {
  it("shows the governing frequency, its source and the counts behind it", () => {
    renderTab(gzf1Result());

    // The row subject and its two figures: the frequency (the screen's answer) and the AC/AN line
    // (the sanity check). Figures carry no visible field labels any more — the words live in
    // title/sr-only — so the assertion is on the subject and the values, not on labels.
    expect(screen.getByText("Exomes")).toBeTruthy();
    expect(screen.getByText(/AC 8 · AN 1,459,156/)).toBeTruthy();
    // The value renders as the headline figure AND as the exome row's figure AND as the grouped
    // maximum row's figure (this payload's groupMaxAF equals its exome AF by coincidence).
    expect(screen.getAllByText("5.50e-6").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/gnomAD ancestry-grouped maximum/)).toBeTruthy();
    // Unconfirmed criterion: the chip shows the code behind a dashed border, not a "PM2?" plus a
    // paragraph explaining the "?".
    const chip = screen.getByText("PM2");
    expect(chip.getAttribute("style") ?? "").toContain("dashed");
    expect(screen.queryByText(/rather than a confirmed engine decision/)).toBeNull();
    // The prose states the finding WITHOUT restating the lead value. The headline is its own
    // emphasis span, so the two halves are asserted separately (a single regex cannot cross the
    // element boundary).
    expect(screen.getByText("Extremely rare")).toBeTruthy();
    expect(screen.getByText(/at or below the 0\.10% PM2 ceiling/)).toBeTruthy();
  });

  it("makes the value the criterion used traceable in the cards", () => {
    // The grouped maximum is neither dataset's global AF, so without a row of its own the headline
    // is a number the reader cannot find on the screen.
    renderTab(
      gzf1Result({
        gnomadFrequency: {
          maxAF: 0.0004, groupMaxAF: 0.0004, genomeAF: 0.0004, exomeAF: 0.0004,
          genomeAC: 6, exomeAC: 6, genomeAN: 15000, exomeAN: 15000,
          nHomozygous: null, dataset: "gnomad_r4",
        },
      }),
    );
    expect(screen.getByText("Used for classification")).toBeTruthy();
    // Scoped to the row itself: the same value is also the finding and both dataset readings.
    const row = screen.getByText("Ancestry-grouped maximum").closest("div.px-4") as HTMLElement;
    expect(row).toBeTruthy();
    expect(within(row).getByText("0.040%")).toBeTruthy();
    // The AN floor is READ from the shared constant the server filters on, not hard-coded in copy.
    expect(within(row).getByText(/≥ 2,000 alleles/)).toBeTruthy();
  });

  it("prints the fallback note only when the grouped maximum actually fell back", () => {
    // The dataset list that used to sit in the footer duplicated the cards' Measured chips and is
    // gone; the footer now carries only the fallback, which nothing else states.
    const noFallback = renderTab(gzf1Result());
    expect(noFallback.container.textContent).not.toMatch(/fell back to the global maximum/);
    noFallback.unmount();

    renderTab(
      gzf1Result({
        gnomadFrequency: { ...gzf1Result().gnomadFrequency, groupMaxAFIsFallback: true },
      }),
    );
    expect(screen.getByText(/grouped maximum fell back to the global maximum/)).toBeTruthy();
    expect(screen.queryByText(/Datasets reporting a frequency/)).toBeNull();
    expect(screen.queryByText(/Source readings:\s*\d/)).toBeNull();
  });

  it("keeps a source's counts when its frequency cannot be derived", () => {
    // Real shape: the pipeline keeps All of Us unless ALL FOUR fields are null, and parses them
    // independently, so counts without a denominator are reachable.
    renderTab(
      gzf1Result({
        gnomadFrequency: null,
        aouFrequency: { aouAC: 12, aouAN: null, aouHet: 12, aouHom: 0 },
      }),
    );
    expect(screen.getByText(/AC 12/)).toBeTruthy();
    expect(screen.getByText(/no usable allele number/)).toBeTruthy();
    // The genotype breakdown the old card dropped must survive too.
    expect(screen.getByText("12 · 0")).toBeTruthy();
  });

  it("attributes a ClinVar-submitted frequency to ClinVar rather than to gnomAD", () => {
    renderTab(
      gzf1Result({
        gnomadFrequency: null,
        serviceStatus: { gnomadFrequency: "not_found" },
        clinvar: {
          classification: "Uncertain significance",
          reviewStatus: "criteria provided, single submitter",
          trait: "Connective tissue disorder",
          alleleFrequencies: [{ source: "ExAC", value: 0.0003 }],
        },
      }),
    );
    // Scoped: asserting the strings exist would pass even if the row still rendered inside the
    // gnomAD card, which is the defect being pinned. The row must be INSIDE the ClinVar card.
    const clinvarCard = screen.getByText("Uncertain significance").closest("div.rounded-xl") as HTMLElement;
    expect(within(clinvarCard).getByText("ExAC")).toBeTruthy();
    expect(within(clinvarCard).getByText("0.030%")).toBeTruthy();

    const gnomadCard = screen.getByText("gnomAD").closest("div.rounded-xl") as HTMLElement;
    expect(within(gnomadCard).queryByText("ExAC")).toBeNull();
  });

  it("keeps one row per ClinVar submitter instead of collapsing them", () => {
    renderTab(
      gzf1Result({
        gnomadFrequency: null,
        serviceStatus: { gnomadFrequency: "not_found" },
        clinvar: {
          classification: "Uncertain significance",
          alleleFrequencies: [
            { source: "ExAC", value: 0.0003 },
            { source: "gnomAD", value: 0.0009 },
          ],
        },
      }),
    );
    expect(screen.getByText("ExAC")).toBeTruthy();
    expect(screen.getByText("0.030%")).toBeTruthy();
    expect(screen.getByText("0.090%")).toBeTruthy();
  });

  it("names the gnomAD release the way gnomAD does, and asserts no minor", () => {
    renderTab(gzf1Result());
    // "v4" — the release name, not the `gnomad_r4` API alias, and never a patch the code cannot read.
    expect(screen.getByText("v4")).toBeTruthy();
    expect(screen.queryByText(/v4\.0\.0|v4\.1\.0|gnomad_r4/)).toBeNull();

    renderTab(
      gzf1Result({ gnomadFrequency: { ...gzf1Result().gnomadFrequency, dataset: "gnomad_r3" } }),
    );
    expect(screen.getAllByText("v3").length).toBeGreaterThan(0);
  });
});

describe("ClinicalTab — the verdict is the engine's, and a disagreement is stated", () => {
  it("reports the criterion the engine recorded", () => {
    renderTab(gzf1Result({ ruleBasedInsights: { acmgCriteria: [{ code: "PM2", reason: "rare" }] } }));
    expect(screen.getByText("PM2")).toBeTruthy();
    expect(screen.queryByText(/The engine applied no frequency criterion/)).toBeNull();
  });

  it("says when the weighting withheld a criterion the frequency supports", () => {
    renderTab(
      gzf1Result({
        metadata: { gene: "GZF1", variant: "p.Arg591Trp", uniprotId: "Q9H116", acmgWeighting: "strict-structural" },
        ruleBasedInsights: { acmgCriteria: [{ code: "PP3", reason: "computational" }] },
      }),
    );
    expect(screen.getByText(/the engine recorded no frequency criterion/i)).toBeTruthy();
    expect(screen.getByText(/strict-structural weighting is what withholds it/)).toBeTruthy();
    // The supported criterion is NOT presented as the engine's verdict.
    expect(screen.getByText("No criterion")).toBeTruthy();
  });

  it("does not blame a weighting that cannot withhold the criterion", () => {
    // `standard` never suppresses frequency evidence, so a run in that mode which recorded no PM2 has
    // some other cause — and naming the weighting would be inventing one.
    renderTab(
      gzf1Result({
        metadata: { gene: "GZF1", variant: "p.Arg591Trp", uniprotId: "Q9H116", acmgWeighting: "standard" },
        ruleBasedInsights: { acmgCriteria: [{ code: "PP3", reason: "computational" }] },
      }),
    );
    expect(screen.getByText(/the engine recorded no frequency criterion/i)).toBeTruthy();
    expect(screen.queryByText(/weighting is what withholds it/)).toBeNull();
  });

  it("marks the criterion unconfirmed with the chip itself, not a paragraph explaining a '?'", () => {
    renderTab(gzf1Result());
    // The dashed border IS the "suggested, not confirmed" state; the qualifier lives in the
    // accessible name and the hover title, so the screen no longer says it twice.
    const chip = screen.getByText("PM2");
    expect(chip.getAttribute("style") ?? "").toContain("dashed");
    expect(chip.getAttribute("aria-label") ?? "").toMatch(/unconfirmed by the engine record/);
    expect(chip.getAttribute("title") ?? "").toMatch(/no engine record to confirm it against/);
  });
});

describe("ClinicalTab — absence from ClinVar is not benignity", () => {
  it("says what absence from ClinVar means", () => {
    renderTab(gzf1Result());
    expect(screen.getByText(/Absence from ClinVar is not evidence of benignity/i)).toBeTruthy();
  });

  it("does not turn a ClinVar outage into 'no submitter has classified it'", () => {
    const { container } = renderTab(
      gzf1Result({
        clinvar: { classification: null },
        serviceStatus: { gnomadFrequency: "ok", clinvar: "timeout" },
      }),
    );
    expect(container.textContent).not.toMatch(/no submitter has classified it/i);
    expect(screen.getByText(/could not be read/)).toBeTruthy();
  });

  it("reads a successful ClinVar query that carried no classification as a recorded outcome", () => {
    // `ok` + null classification is reachable on legacy/cached payloads. The sentence must not
    // claim "no outcome was recorded" — the query SUCCEEDED, it just returned nothing classifiable.
    // Scoped to the ClinVar card: the gnomAD Genomes row legitimately carries its own "no outcome"
    // sentence for this fixture (genomeAF is null with status `ok`), so a container-wide assertion
    // would test the wrong card.
    renderTab(
      gzf1Result({
        clinvar: { classification: null },
        serviceStatus: { gnomadFrequency: "ok", clinvar: "ok" },
      }),
    );
    const clinvarCard = screen.getByText("ClinVar").closest("div.rounded-xl") as HTMLElement;
    expect(clinvarCard.textContent ?? "").not.toMatch(/no outcome was recorded/i);
    expect(within(clinvarCard).getByText(/Absence from ClinVar is not evidence of benignity/i)).toBeTruthy();
  });

  it("does not paint a conflicting interpretation with the pathogenic tone", () => {
    renderTab(gzf1Result({ clinvar: { classification: "Conflicting interpretations of pathogenicity" } }));
    const badge = screen.getByText("Conflicting interpretations of pathogenicity");
    // `--cs-bg-danger` is the pathogenic tone; the danger token legitimately appears elsewhere on
    // the screen (the PM2 verdict chip), so the assertion is scoped to this badge.
    expect(badge.getAttribute("style") ?? "").not.toContain("--cs-bg-danger");
  });
});
