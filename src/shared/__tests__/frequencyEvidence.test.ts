/**
 * frequencyEvidence.test.ts — the Population Frequencies tab's claim-making rules.
 *
 * The invariants here are the ones the tab used to violate silently, so each one is asserted from
 * the module the surfaces actually render from rather than from a copy of its logic.
 */
import { describe, it, expect } from "vitest";
import {
  buildFrequencyEvidence,
  classifyAcmgFrequency,
  formatAlleleFrequency,
  formatCount,
  gnomadReleaseLabel,
  observationAbsence,
  readAppliedCriterion,
  type FrequencyEvidenceInput,
} from "../frequencyEvidence.ts";
import { THRESHOLDS } from "../thresholds/constants.ts";

const GZF1_GNOMAD = {
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
};

const input = (overrides: Partial<FrequencyEvidenceInput> = {}): FrequencyEvidenceInput => ({
  gnomadFrequency: GZF1_GNOMAD,
  serviceStatus: { gnomadFrequency: "ok" },
  assembly: "GRCh38",
  ...overrides,
});

function observation(overrides: Partial<FrequencyEvidenceInput>, id: string, key?: string) {
  const evidence = buildFrequencyEvidence(input(overrides));
  const found = key ? evidence.observations.find(o => o.key === key) : evidence.observations.find(o => o.id === id);
  if (!found) throw new Error(`no observation ${key ?? id}`);
  return found;
}

describe("frequencyEvidence — absence is classified, never worded", () => {
  it("withholds the criterion on a provider outage instead of reading it as absence", () => {
    for (const status of ["timeout", "error"]) {
      const evidence = buildFrequencyEvidence(
        input({ gnomadFrequency: null, serviceStatus: { gnomadFrequency: status } }),
      );
      // The classifier must NOT reach PM2 (the server-side invariant, asserted here at the
      // rendering layer where it was previously broken).
      expect(evidence.criterion.code).toBe("withheld");
      expect(evidence.criterion.af).toBeNull();
      expect(evidence.hasProviderFault).toBe(true);
      // And no gnomAD row may claim the variant is absent from the cohort.
      for (const o of evidence.observations.filter(o => o.id.startsWith("gnomad"))) {
        expect(o.availability.state).toBe("upstream-error");
        expect(observationAbsence(o)).not.toMatch(/absent/i);
      }
    }
  });

  it("reports a confirmed absence as a zero frequency, which satisfies PM2", () => {
    const evidence = buildFrequencyEvidence(
      input({ gnomadFrequency: null, serviceStatus: { gnomadFrequency: "not_found" } }),
    );
    expect(evidence.criterion.code).toBe("PM2");
    expect(evidence.criterion.af).toBe(0);
    expect(evidence.hasProviderFault).toBe(false);
    const genomes = observation({ gnomadFrequency: null, serviceStatus: { gnomadFrequency: "not_found" } }, "gnomad-genomes");
    expect(genomes.availability.hasValue).toBe(false);
    expect(genomes.availability.state).toBe("no-result");
    expect(observationAbsence(genomes)).toContain("holds no record");
    // A confirmed absence is a result, not a fault: it must not offer a retry.
    expect(genomes.availability.userActionable).toBe(false);
  });

  it("keeps an outage distinct from a confirmed absence for the same empty payload", () => {
    const outage = observation({ gnomadFrequency: null, serviceStatus: { gnomadFrequency: "timeout" } }, "gnomad-exomes");
    const absent = observation({ gnomadFrequency: null, serviceStatus: { gnomadFrequency: "not_found" } }, "gnomad-exomes");
    expect(outage.availability.state).not.toBe(absent.availability.state);
    expect(outage.availability.action).toBe("retry");
    expect(absent.availability.action).toBeNull();
  });

  it("asserts no absence when no outcome was recorded for the query", () => {
    // `serviceStatus` is optional on the payload, and placeholder/demo shapes omit it entirely.
    for (const override of [
      { gnomadFrequency: null, serviceStatus: null },
      { gnomadFrequency: null, serviceStatus: {} },
      { gnomadFrequency: null, serviceStatus: { gnomadFrequency: "not-a-status" } },
    ] as Partial<FrequencyEvidenceInput>[]) {
      const evidence = buildFrequencyEvidence(input(override));
      const rows = evidence.observations.filter(o => o.id.startsWith("gnomad"));
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const sentence = observationAbsence(row);
        // Neither presence nor absence may be claimed from missing data.
        expect(sentence).not.toMatch(/not present|absent|holds no record/i);
        expect(sentence).toContain("no outcome was recorded");
      }
      expect(evidence.criterion.code).toBe("unknown");
    }
  });

  it("treats a build gnomAD does not serve as a refusal, not as an absence", () => {
    // gnomAD r4 answers by numeric position and serves GRCh38 only, so a GRCh37 coordinate was never
    // queried — yet the server's gate leaves `not_found` behind, the same value a genuine absence
    // carries. Without this guard the refusal becomes a zero frequency and PM2 support.
    const evidence = buildFrequencyEvidence(
      input({
        gnomadFrequency: null,
        serviceStatus: { gnomadFrequency: "not_found" },
        assembly: "GRCh37",
      }),
    );
    expect(evidence.criterion.code).toBe("withheld");
    expect(evidence.criterion.af).toBeNull();
    expect(evidence.criterion.statement).toContain("covers GRCh38");
    for (const row of evidence.observations.filter(o => o.id.startsWith("gnomad"))) {
      expect(row.availability.state).toBe("not-covered");
      expect(observationAbsence(row)).not.toMatch(/holds no record|absent/i);
    }
    // Not a run fault either: nothing failed, the coordinate is simply outside the source's scope.
    expect(evidence.hasProviderFault).toBe(false);
  });

  it("recognises the server's own build-refusal status, without the coordinate", () => {
    // The server records `unsupported-build` when its gate refuses (`core-data-fetcher.ts`), and that
    // must be enough on its own: a payload can reach the UI without `gnomadVariantAssembly`, and the
    // status was previously `not_found` — read as a confirmed absence and used to award PM2.
    const evidence = buildFrequencyEvidence(
      input({
        gnomadFrequency: null,
        serviceStatus: { gnomadFrequency: "unsupported-build" },
        assembly: null,
      }),
    );
    expect(evidence.criterion.code).toBe("withheld");
    expect(evidence.criterion.af).toBeNull();
    expect(evidence.criterion.statement).toMatch(/not one gnomAD r4 serves/);
    for (const row of evidence.observations.filter(o => o.id.startsWith("gnomad"))) {
      expect(row.availability.state).toBe("not-covered");
      expect(observationAbsence(row)).not.toMatch(/holds no record|absent/i);
    }
  });

  it("withholds rather than disclaims while a query is still in flight", () => {
    const evidence = buildFrequencyEvidence(
      input({ gnomadFrequency: null, serviceStatus: { gnomadFrequency: "pending" } }),
    );
    expect(evidence.criterion.code).toBe("withheld");
    expect(evidence.criterion.statement).toContain("still running");
    expect(evidence.hasPendingSource).toBe(true);
    expect(evidence.hasProviderFault).toBe(false);
    expect(observationAbsence(evidence.observations.find(o => o.id === "gnomad-exomes")!)).not.toMatch(
      /no frequency was available/i,
    );
  });

  it("lets a measured value outrank a fault signal on the same payload", () => {
    const exomes = observation(
      { gnomadFrequency: GZF1_GNOMAD, serviceStatus: { gnomadFrequency: "timeout" } },
      "gnomad-exomes",
    );
    expect(exomes.availability.hasValue).toBe(true);
    expect(exomes.af).toBe(5.5e-6);
  });

  it("treats a measured zero frequency as a value, not as missing", () => {
    const exomes = observation(
      {
        gnomadFrequency: { ...GZF1_GNOMAD, exomeAF: 0, exomeAC: 0 },
        serviceStatus: { gnomadFrequency: "ok" },
      },
      "gnomad-exomes",
    );
    expect(exomes.availability.hasValue).toBe(true);
    expect(exomes.af).toBe(0);
  });

  it("treats a non-finite frequency as no value at all", () => {
    for (const broken of [NaN, Infinity, -Infinity, undefined, "5.5e-6" as unknown as number]) {
      const evidence = buildFrequencyEvidence(
        input({ gnomadFrequency: { ...GZF1_GNOMAD, groupMaxAF: broken as number, maxAF: broken as number } }),
      );
      // Not a classification, and not a BA1 verdict from a nonsense magnitude.
      expect(evidence.criterion.code).not.toBe("BA1");
      expect(evidence.criterion.af === null || Number.isFinite(evidence.criterion.af)).toBe(true);
      expect(evidence.criterion.statement).not.toContain("— exceeds");
    }
  });
});

describe("frequencyEvidence — cut-points come from the shared constants", () => {
  const FREQ = THRESHOLDS.populationFrequency;

  it("names the ancestry-grouped maximum as the value the engine read", () => {
    const criterion = classifyAcmgFrequency(
      input({ gnomadFrequency: { ...GZF1_GNOMAD, maxAF: 0.00002, groupMaxAF: 0.00008 } }),
    );
    expect(criterion.af).toBe(0.00008);
    expect(criterion.usedGroupMax).toBe(true);
    expect(criterion.sourceId).toBe("gnomad-group");
  });

  it("falls back to the global maximum and reports the fallback", () => {
    const criterion = classifyAcmgFrequency(
      input({
        gnomadFrequency: { ...GZF1_GNOMAD, maxAF: 0.00002, groupMaxAF: 0.00002, groupMaxAFIsFallback: true },
      }),
    );
    expect(criterion.af).toBe(0.00002);
    expect(criterion.fallback).toBe(true);
  });

  it("uses the global maximum when groupMaxAF is absent rather than dropping the reading", () => {
    // `.optional()` on the wire, and persisted payloads predate the key. Reading `undefined` as a
    // magnitude is what silently dropped PM2 in the engine.
    const criterion = classifyAcmgFrequency(
      input({ gnomadFrequency: { maxAF: 0.00005, dataset: "gnomad_r4" } as never }),
    );
    expect(criterion.af).toBe(0.00005);
  });

  it("classifies either side of every published boundary", () => {
    const at = (af: number, pli?: number | null) =>
      classifyAcmgFrequency(
        input({ gnomadFrequency: { ...GZF1_GNOMAD, maxAF: af, groupMaxAF: af }, pli }),
      );

    // BA1 is strictly greater than the stand-alone-benign frequency.
    expect(at(FREQ.standAloneBenign).code).toBe("BS1");
    expect(at(FREQ.standAloneBenign + 1e-6).code).toBe("BA1");
    // BS1 is strictly greater than the too-common frequency.
    expect(at(FREQ.tooCommonForDisorder).code).toBe("none");
    expect(at(FREQ.tooCommonForDisorder + 1e-6).code).toBe("BS1");
    // PM2 is at or below its ceiling.
    expect(at(FREQ.extremelyRare).code).toBe("PM2");
    expect(at(FREQ.extremelyRare * 1.5).code).toBe("none");
  });

  it("raises the PM2 ceiling for a gene read as recessive", () => {
    const rare = 0.0005; // 0.05% — above the dominant ceiling, below the recessive one
    expect(classifyAcmgFrequency(input({ gnomadFrequency: { ...GZF1_GNOMAD, maxAF: rare, groupMaxAF: rare }, pli: 0.1 })).code).toBe("PM2");
    expect(classifyAcmgFrequency(input({ gnomadFrequency: { ...GZF1_GNOMAD, maxAF: rare, groupMaxAF: rare }, pli: 0.99 })).code).toBe("none");
  });

  it("states the threshold it applied, interpolated from the constant", () => {
    expect(FREQ.tooCommonForDisorder).toBe(0.01);
    const tooCommon = classifyAcmgFrequency(
      input({ gnomadFrequency: { ...GZF1_GNOMAD, maxAF: 0.02, groupMaxAF: 0.02 } }),
    );
    expect(tooCommon.statement).toContain("1.0%");
    expect(tooCommon.statement).not.toContain("0.1%");
    const pm2 = classifyAcmgFrequency(
      input({ gnomadFrequency: { ...GZF1_GNOMAD, maxAF: 0.00002, groupMaxAF: 0.00002 } }),
    );
    expect(pm2.code).toBe("PM2");
    expect(pm2.statement).toContain("0.01%");
  });
});

describe("frequencyEvidence — what the ENGINE did, versus what the frequency supports", () => {
  const rareInput = (overrides: Partial<FrequencyEvidenceInput> = {}) =>
    input({
      gnomadFrequency: { ...GZF1_GNOMAD, maxAF: 0.00001, groupMaxAF: 0.00001 },
      ...overrides,
    });

  it("reports the criterion the engine recorded, not a recomputation of it", () => {
    const supporting = buildFrequencyEvidence(rareInput());
    expect(supporting.criterion.code).toBe("PM2");
    // The engine recorded nothing for this payload, so the module must not claim it applied PM2.
    const suppressed = buildFrequencyEvidence(
      rareInput({ engineCriteria: [{ code: "PP3" }], acmgWeighting: "strict-structural" }),
    );
    expect(suppressed.applied.known).toBe(true);
    expect(suppressed.applied.code).toBeNull();
    expect(suppressed.applied.suppressed).toBe(true);
    expect(suppressed.applied.withheldByWeighting).toBe(true);
    expect(suppressed.applied.weighting).toBe("strict-structural");
  });

  it("does not blame the weighting for a withholding it cannot cause", () => {
    /**
     * `suppressed` says the engine recorded no criterion the frequency supports; it does NOT say why.
     * Only `strict-structural` and `conservative` suppress frequency evidence, so a `standard` run
     * that records no PM2 must not be worded as a weighting decision — that would name a cause the
     * module cannot see, which is the defect class this whole change exists to close.
     */
    const standard = buildFrequencyEvidence(
      rareInput({ engineCriteria: [{ code: "PP3" }], acmgWeighting: "standard" }),
    );
    expect(standard.applied.suppressed).toBe(true);
    expect(standard.applied.withheldByWeighting).toBe(false);

    // And with no weighting stated at all, the same holds.
    const unstated = buildFrequencyEvidence(rareInput({ engineCriteria: [] }));
    expect(unstated.applied.suppressed).toBe(true);
    expect(unstated.applied.withheldByWeighting).toBe(false);
  });

  it("does not call a genuine engine agreement a suppression", () => {
    const evidence = buildFrequencyEvidence(rareInput({ engineCriteria: [{ code: "PM2" }] }));
    expect(evidence.applied.code).toBe("PM2");
    expect(evidence.applied.suppressed).toBe(false);
  });

  it("distinguishes 'the engine applied none' from 'we cannot tell'", () => {
    expect(readAppliedCriterion(rareInput()).known).toBe(false);
    expect(readAppliedCriterion(rareInput({ engineCriteria: [] })).known).toBe(true);
    expect(readAppliedCriterion(rareInput({ engineCriteria: [] })).code).toBeNull();
  });
});

describe("frequencyEvidence — source attribution", () => {
  it("attributes ClinVar-submitted frequencies to ClinVar, not to gnomAD", () => {
    const withGnomad = buildFrequencyEvidence(
      input({
        gnomadFrequency: null,
        serviceStatus: { gnomadFrequency: "not_found" },
        clinvar: { alleleFrequencies: [{ source: "ExAC", value: 0.0003 }] },
      }),
    );
    // not_found already yields a zero-frequency reading, so gnomAD remains the attributed source.
    expect(withGnomad.criterion.sourceId).toBe("gnomad-group");

    const clinvarOnly = buildFrequencyEvidence(
      input({
        gnomadFrequency: null,
        serviceStatus: null,
        clinvar: { alleleFrequencies: [{ source: "ExAC", value: 0.0003 }] },
      }),
    );
    expect(clinvarOnly.criterion.sourceId).toBe("clinvar-submissions");
    expect(clinvarOnly.criterion.af).toBeCloseTo(0.0003, 10);
  });

  it("keeps one row per ClinVar submitter instead of collapsing them to a maximum", () => {
    const evidence = buildFrequencyEvidence(
      input({
        gnomadFrequency: null,
        serviceStatus: null,
        clinvar: {
          alleleFrequencies: [
            { source: "ExAC", value: 0.0003 },
            { source: "gnomAD", value: 0.0009 },
          ],
        },
      }),
    );
    const rows = evidence.observations.filter(o => o.id === "clinvar-submissions");
    expect(rows.map(r => r.label)).toEqual(["ExAC", "gnomAD"]);
    expect(rows.map(r => r.af)).toEqual([0.0003, 0.0009]);
    expect(new Set(rows.map(r => r.key)).size).toBe(2);
    // The criterion reads the maximum, which is the engine's rule.
    expect(evidence.criterion.af).toBeCloseTo(0.0009, 10);
  });

  it("never manufactures a frequency from an unparseable ClinVar value", () => {
    const evidence = buildFrequencyEvidence(
      input({
        gnomadFrequency: null,
        serviceStatus: null,
        clinvar: { alleleFrequencies: [{ source: "ExAC", value: "not-a-number" }] },
      }),
    );
    expect(evidence.criterion.code).toBe("unknown");
    expect(evidence.criterion.af).toBeNull();
    expect(evidence.observations.some(o => o.id === "clinvar-submissions")).toBe(false);
    expect(evidence.contributing.length).toBe(0);
  });

  it("derives the All of Us frequency from its counts and never from its numerator alone", () => {
    const withDenominator = observation({ aouFrequency: { aouAC: 12, aouAN: 98000, aouHet: 12, aouHom: 0 } }, "all-of-us");
    expect(withDenominator.af).toBeCloseTo(12 / 98000, 12);
    expect(withDenominator.availability.hasValue).toBe(true);
  });

  it("names which All of Us field is missing, for every shape the contract permits", () => {
    const cases: { aou: FrequencyEvidenceInput["aouFrequency"]; expected: RegExp; keeps: ("ac" | "an" | "het" | "hom")[] }[] = [
      { aou: { aouAC: null, aouAN: 100000, aouHet: null, aouHom: null }, expected: /no allele count/, keeps: ["an"] },
      { aou: { aouAC: 12, aouAN: null, aouHet: 12, aouHom: 0 }, expected: /no usable allele number/, keeps: ["ac", "het", "hom"] },
      { aou: { aouAC: 12, aouAN: 0, aouHet: 12, aouHom: 0 }, expected: /no usable allele number/, keeps: ["ac", "het", "hom"] },
      { aou: { aouAC: null, aouAN: null, aouHet: 4, aouHom: 0 }, expected: /genotype counts/, keeps: ["het", "hom"] },
    ];
    for (const { aou, expected, keeps } of cases) {
      const row = observation({ aouFrequency: aou }, "all-of-us");
      expect(row.af).toBeNull();
      expect(observationAbsence(row)).toMatch(expected);
      // The counts the row does hold must survive onto the observation, so a surface can show them.
      if (keeps.includes("ac")) expect(row.ac).not.toBeNull();
      if (keeps.includes("an")) expect(row.an).not.toBeNull();
      if (keeps.includes("het")) expect(row.heterozygotes).not.toBeNull();
      if (keeps.includes("hom")) expect(row.homozygotes).not.toBeNull();
    }
  });

  it("bounds the All of Us absence claim to what the pipeline knows", () => {
    const aou = observation({ gnomadFrequency: GZF1_GNOMAD }, "all-of-us");
    // No per-source status exists for this cohort, so the sentence must not claim the cohort lacks
    // the variant — only that our table does.
    expect(observationAbsence(aou)).toContain("frequency table holds no entry");
    expect(observationAbsence(aou)).not.toMatch(/absent from/i);
  });

  it("reports the local dbNSFP ingest as one combined reading, not as an exome reading", () => {
    const evidence = buildFrequencyEvidence(
      input({
        gnomadFrequency: {
          maxAF: 0.0004, groupMaxAF: 0.0004, genomeAF: 0.0004, exomeAF: 0.0004,
          genomeAC: 6, exomeAC: 0, genomeAN: 15000, exomeAN: 0,
          nHomozygous: 0, dataset: "gnomad_r4_local",
        },
      }),
    );
    const gnomadRows = evidence.observations.filter(o => o.id.startsWith("gnomad"));
    expect(gnomadRows).toHaveLength(1);
    expect(gnomadRows[0].id).toBe("gnomad-local");
    expect(gnomadRows[0].label).toContain("combined");
    // And the release is named rather than passed through as a machine token.
    expect(gnomadRows[0].dataset).toBe("v4 (local dbNSFP ingest)");
  });

  it("counts only the sources that produced a finite frequency as contributing", () => {
    const evidence = buildFrequencyEvidence(
      input({
        aouFrequency: { aouAC: 3, aouAN: 40000, aouHet: 3, aouHom: 0 },
        clinvar: { alleleFrequencies: [{ source: "ExAC", value: "not-a-number" }] },
      }),
    );
    expect(evidence.contributing.map(o => o.id).sort()).toEqual(["all-of-us", "gnomad-exomes"]);
    expect(evidence.gnomadHomozygotes).toBeNull();
  });

  it("does not count a row that holds only counts as a source reading", () => {
    // The `af !== null` half of the filter, which has no other guard: a row with an allele count and
    // no denominator is a value-bearing row on the card and NOT a frequency the criterion could use.
    const evidence = buildFrequencyEvidence(
      input({
        gnomadFrequency: null,
        serviceStatus: null,
        aouFrequency: { aouAC: 3, aouAN: null, aouHet: 3, aouHom: 0 },
      }),
    );
    const aou = evidence.observations.find(o => o.id === "all-of-us")!;
    // The counts survive (the surface renders them) …
    expect(aou.ac).toBe(3);
    expect(aou.heterozygotes).toBe(3);
    // … and the row is not counted as a reading, nor read as a frequency.
    expect(aou.availability.hasValue).toBe(false);
    expect(evidence.contributing).toHaveLength(0);
    expect(evidence.criterion.af).toBeNull();
  });
});

describe("frequencyEvidence — the ClinVar reading carries its own status", () => {
  it("does not turn a ClinVar outage into 'no submitter has classified it'", () => {
    for (const status of ["timeout", "error"]) {
      const evidence = buildFrequencyEvidence(
        input({ clinvar: { classification: null }, serviceStatus: { gnomadFrequency: "ok", clinvar: status } }),
      );
      expect(evidence.clinvar.availability.hasValue).toBe(false);
      expect(evidence.clinvar.availability.state).toBe("upstream-error");
      expect(evidence.clinvar.availability.reason).toMatch(/could not be read/);
    }
  });

  it("reads a present classification as a value", () => {
    const evidence = buildFrequencyEvidence(
      input({ clinvar: { classification: "Uncertain significance" }, serviceStatus: { gnomadFrequency: "ok", clinvar: "ok" } }),
    );
    expect(evidence.clinvar.availability.hasValue).toBe(true);
    expect(evidence.clinvar.classification).toBe("Uncertain significance");
  });
});

describe("frequencyEvidence — display formatting", () => {
  it("distinguishes zero, a tiny frequency, a percentage and a missing value", () => {
    expect(formatAlleleFrequency(0)).toBe("0");
    expect(formatAlleleFrequency(null)).toBe("—");
    expect(formatAlleleFrequency(5.5e-6)).toBe("5.50e-6");
    expect(formatAlleleFrequency(0.0001)).toBe("0.010%");
    expect(formatAlleleFrequency(0.02)).toBe("2.00%");
    expect(formatAlleleFrequency(NaN)).toBe("—");
    expect(formatAlleleFrequency(Infinity)).toBe("—");
  });

  it("renders a missing count as an em dash rather than a zero", () => {
    expect(formatCount(null)).toBe("—");
    expect(formatCount(0)).toBe("0");
    expect(formatCount(1459156)).toBe("1,459,156");
  });

  it("names the gnomAD release the pipeline pinned, in the name gnomAD itself uses", () => {
    // `gnomad_r4` is the GraphQL dataset alias; "v4" is the release name a reader recognises, and no
    // MINOR version is asserted because the alias moves with the latest v4 minor and the code never
    // reads one. The defect this replaced was the patch claim ("v4.0.0" / "v4.1.0" for one query).
    expect(gnomadReleaseLabel("gnomad_r4")).toBe("v4");
    expect(gnomadReleaseLabel("gnomad_r4_local")).toBe("v4 (local dbNSFP ingest)");
    expect(gnomadReleaseLabel("gnomad_r3")).toBe("v3");
    expect(gnomadReleaseLabel(null)).toBe("release not reported");
    // An unrecognised identifier is passed through rather than guessed at.
    expect(gnomadReleaseLabel("something_else")).toBe("something_else");
  });
});
