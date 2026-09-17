import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildBiochemicalContrast,
  classifyPocketRanking,
  classifyPocketVolume,
  classifyShiftMagnitude,
  deriveBiochemicalNarrative,
  derivePocketNarrative,
  findNarrativeDiscrepancies,
  stripInlineMarkdown,
  type AminoAcidScaleValues,
  type PocketNarrativeInput
} from "../residueShiftEvidence";

/** The MACO1 p.Glu433Lys values the Residue Shifts tab renders. */
const GLU: AminoAcidScaleValues = { hydrophobicity: 10, charge: 0, size: 60, polarity: 100 };
const LYS: AminoAcidScaleValues = { hydrophobicity: 5, charge: 95, size: 80, polarity: 100 };

function contrastGluLys() {
  return buildBiochemicalContrast({
    wildTypeCode: "E",
    mutantCode: "K",
    wildTypeLabel: "Glu",
    mutantLabel: "Lys",
    wildTypeValues: GLU,
    mutantValues: LYS
  });
}

describe("buildBiochemicalContrast", () => {
  it("returns null when either residue's scale values are missing", () => {
    expect(
      buildBiochemicalContrast({
        wildTypeCode: "E",
        mutantCode: "K",
        wildTypeValues: null,
        mutantValues: LYS
      })
    ).toBeNull();
  });

  it("derives one row per scale axis in a stable order", () => {
    const contrast = contrastGluLys();
    expect(contrast).not.toBeNull();
    expect(contrast!.rows.map(row => row.key)).toEqual(["hydrophobicity", "size", "polarity", "charge"]);
  });

  it("classifies each axis direction and magnitude independently", () => {
    const rows = contrastGluLys()!.rows;
    const byKey = Object.fromEntries(rows.map(row => [row.key, row]));

    expect(byKey.hydrophobicity.delta).toBe(-5);
    expect(byKey.hydrophobicity.direction).toBe("decrease");
    expect(byKey.hydrophobicity.magnitude).toBe("slight");

    expect(byKey.size.delta).toBe(20);
    expect(byKey.size.direction).toBe("increase");
    expect(byKey.size.magnitude).toBe("moderate");

    expect(byKey.polarity.delta).toBe(0);
    expect(byKey.polarity.direction).toBe("unchanged");
    expect(byKey.polarity.magnitude).toBe("unchanged");

    expect(byKey.charge.delta).toBe(95);
    expect(byKey.charge.magnitude).toBe("marked");
    // Describes the index, not the chemistry: the table gives non-neutral values
    // to residues with no net charge at pH 7.4, so "(more basic)" would be false
    // for most pairs.
    expect(byKey.charge.plainChange).toBe("further toward the positive end of this index");
  });

  it("does not attribute acid/base character to a small move on the charge index", () => {
    // Trp 48 -> Ala 50 and Ser 45 -> Cys 35 are both non-neutral moves between
    // residues that are not basic/acidic. Neither may be described as such.
    const trpAla = buildBiochemicalContrast({
      wildTypeCode: "W",
      mutantCode: "A",
      wildTypeValues: { hydrophobicity: 65, charge: 48, size: 100, polarity: 20 },
      mutantValues: { hydrophobicity: 60, charge: 50, size: 25, polarity: 15 }
    })!.rows.find(row => row.key === "charge")!;
    expect(trpAla.plainChange).not.toMatch(/basic|acidic/);

    const serCys = buildBiochemicalContrast({
      wildTypeCode: "S",
      mutantCode: "C",
      wildTypeValues: { hydrophobicity: 30, charge: 45, size: 30, polarity: 70 },
      mutantValues: { hydrophobicity: 70, charge: 35, size: 40, polarity: 60 }
    })!.rows.find(row => row.key === "charge")!;
    expect(serCys.plainChange).not.toMatch(/basic|acidic/);
  });

  it("collapses the joined span to zero width when an axis is unchanged", () => {
    const polarity = contrastGluLys()!.rows.find(row => row.key === "polarity")!;
    expect(polarity.spanWidth).toBe(0);
    expect(polarity.wildTypePosition).toBe(100);
    expect(polarity.mutantPosition).toBe(100);
  });

  it("picks the largest absolute delta as the headline, not the first change", () => {
    const contrast = contrastGluLys()!;
    expect(contrast.changedRowCount).toBe(3);
    expect(contrast.headlineRow?.key).toBe("charge");
    expect(contrast.summary).toContain("3 of 4 axes move");
    expect(contrast.summary).toContain("charge");
  });

  it("uses a true minus sign rather than a hyphen in delta labels", () => {
    const hydrophobicity = contrastGluLys()!.rows.find(row => row.key === "hydrophobicity")!;
    expect(hydrophobicity.deltaLabel).toBe("\u22125");
  });

  it("reports an isosteric substitution without claiming an effect", () => {
    const contrast = buildBiochemicalContrast({
      wildTypeCode: "A",
      mutantCode: "A",
      wildTypeValues: GLU,
      mutantValues: GLU
    })!;
    expect(contrast.changedRowCount).toBe(0);
    expect(contrast.headlineRow).toBeNull();
    expect(contrast.summary).toContain("No axis moves");
  });
});

describe("classifyShiftMagnitude", () => {
  it("bands magnitude at the documented boundaries", () => {
    expect(classifyShiftMagnitude(0)).toBe("unchanged");
    expect(classifyShiftMagnitude(9)).toBe("slight");
    expect(classifyShiftMagnitude(10)).toBe("moderate");
    expect(classifyShiftMagnitude(29)).toBe("moderate");
    expect(classifyShiftMagnitude(30)).toBe("marked");
  });

  it("treats non-finite deltas as unchanged rather than marked", () => {
    expect(classifyShiftMagnitude(Number.NaN)).toBe("unchanged");
  });
});

describe("findNarrativeDiscrepancies", () => {
  it("flags the axis the AI prose claims changed while the scales hold it flat", () => {
    const prose = "Charge swap: Negative (Glu) to Positive (Lys). Size increase. Significant change in pKa and polarity.";
    const discrepancies = findNarrativeDiscrepancies(prose, contrastGluLys());

    expect(discrepancies).toHaveLength(1);
    expect(discrepancies[0].axisKey).toBe("polarity");
    expect(discrepancies[0].values).toBe("100 \u2192 100");
  });

  it("never flags axes the prose describes as changing that the scales also move", () => {
    const prose = "Hydrophobicity decreases. Size increases. Charge becomes positive.";
    const discrepancies = findNarrativeDiscrepancies(prose, contrastGluLys());
    expect(discrepancies).toHaveLength(0);
  });

  it("does not flag an omitted axis, only a contradicted one", () => {
    expect(findNarrativeDiscrepancies("Charge swap only.", contrastGluLys())).toHaveLength(0);
  });

  it("does not flag a sentence that denies a change", () => {
    // "unchanged" contains "change"; the previous substring matcher reported the
    // exact inverse of the prose, telling the reader the narrative claimed a
    // change it had just denied.
    expect(findNarrativeDiscrepancies("Polarity is unchanged.", contrastGluLys())).toHaveLength(0);
    expect(findNarrativeDiscrepancies("No change in polarity or charge.", contrastGluLys())).toHaveLength(0);
    expect(
      findNarrativeDiscrepancies("No significant change in polarity is expected.", contrastGluLys())
    ).toHaveLength(0);
    expect(
      findNarrativeDiscrepancies("Polarity is not altered by this substitution.", contrastGluLys())
    ).toHaveLength(0);
  });

  it("does not match an axis keyword inside a longer word", () => {
    // "nonpolar" is a hydrophobicity word, not a polarity claim. The old matcher
    // used includes("polar"), so this sentence was reported against polarity.
    const prose = "Loss of the nonpolar side chain.";
    const discrepancies = findNarrativeDiscrepancies(prose, contrastGluLys());
    expect(discrepancies.map(d => d.axisKey)).not.toContain("polarity");
  });

  it("detects a claim phrased with the hydrophilic anchor", () => {
    // "hydrophilic" was missing from the keyword list even though it is the
    // module's own low anchor. Asp/Glu keep the same hydropathy value (10), so a
    // claim that the side chain *becomes* hydrophilic is testable against a flat
    // hydrophobicity axis.
    const asnAsp = buildBiochemicalContrast({
      wildTypeCode: "D",
      mutantCode: "E",
      wildTypeValues: { hydrophobicity: 10, charge: 0, size: 45, polarity: 100 },
      mutantValues: { hydrophobicity: 10, charge: 0, size: 60, polarity: 100 }
    })!;
    expect(asnAsp.rows.find(row => row.key === "hydrophobicity")!.direction).toBe("unchanged");

    const discrepancies = findNarrativeDiscrepancies("The side chain becomes hydrophilic.", asnAsp);
    expect(discrepancies.map(d => d.axisKey)).toContain("hydrophobicity");
  });

  it("contains no regex lookbehind, which would throw at runtime on older Safari", () => {
    // Vite targets browsers without lookbehind support, and esbuild lowers an
    // unsupported lookbehind literal into `new RegExp(...)` — a runtime SyntaxError
    // during render, invisible to tsc and to the build. This pane sits outside
    // every ErrorBoundary, so that throw replaces the whole app.
    //
    // Comments are stripped first: this file legitimately *mentions* the
    // construct, and only executable code matters.
    const source = readFileSync(new URL("../residueShiftEvidence.ts", import.meta.url), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\(\?<[=!]/);
  });

  it("returns nothing when either input is absent", () => {
    expect(findNarrativeDiscrepancies(null, contrastGluLys())).toHaveLength(0);
    expect(findNarrativeDiscrepancies("Size increase.", null)).toHaveLength(0);
  });
});

describe("deriveBiochemicalNarrative", () => {
  it("treats a missing narrative as unavailable rather than empty prose", () => {
    const narrative = deriveBiochemicalNarrative(null);
    expect(narrative.state).toBe("unavailable");
    expect(narrative.prose).toBeNull();
    expect(narrative.detail).toBeTruthy();
  });

  it("reports loading while synthesis is in flight", () => {
    expect(deriveBiochemicalNarrative("", { isLoading: true }).state).toBe("loading");
  });

  it("recognises the pipeline's fallback marker and never renders its markdown", () => {
    const narrative = deriveBiochemicalNarrative("\u26a0\ufe0f **Biochemical Shift Unavailable** (Failed)");
    expect(narrative.state).toBe("unavailable");
    expect(narrative.prose).toBeNull();
    expect(narrative.detail).not.toContain("**");
  });

  it("keeps real prose and strips emphasis markers", () => {
    const narrative = deriveBiochemicalNarrative("**Charge swap**: Negative to Positive.");
    expect(narrative.state).toBe("ready");
    expect(narrative.prose).toBe("Charge swap: Negative to Positive.");
  });

  it("treats the literal 'Not synthesized' placeholder as unavailable", () => {
    expect(deriveBiochemicalNarrative("Not synthesized").state).toBe("unavailable");
  });
});

describe("stripInlineMarkdown", () => {
  it("removes bold, underscore emphasis and code ticks", () => {
    expect(stripInlineMarkdown("**a** __b__ `c`")).toBe("a b c");
  });
});

/** The P2Rank payload behind the MACO1 screenshot: 28 Å away, 2% index. */
const DISTAL_POCKET: PocketNarrativeInput = {
  status: "success",
  pocketDistance: 28.14,
  pocketScore: 2,
  pocketVolume: 370,
  likelyCofactor: "None recorded in curated annotations",
  sasPoints: 37,
  surfaceAtoms: 20,
  pocketResidues: [
    { name: "HIS", index: 292, distance: 29.9 },
    { name: "TYR", index: 173, distance: 30.6 }
  ]
};

describe("classifyPocketRanking / classifyPocketVolume", () => {
  it("bands the ranking index and treats a reported zero as the weakest band", () => {
    // P2Rank reporting 0 is a real result, not an absent one; only null/NaN are
    // "not reported".
    expect(classifyPocketRanking(0)).toBe("weak");
    expect(classifyPocketRanking(2)).toBe("weak");
    expect(classifyPocketRanking(20)).toBe("weak");
    expect(classifyPocketRanking(21)).toBe("moderate");
    expect(classifyPocketRanking(100)).toBe("very_strong");
    expect(classifyPocketRanking(null)).toBe("unknown");
    expect(classifyPocketRanking(Number.NaN)).toBe("unknown");
    expect(classifyPocketRanking(-1)).toBe("unknown");
  });

  it("bands cavity volume and treats zero as not reported", () => {
    expect(classifyPocketVolume(0)).toBe("unknown");
    expect(classifyPocketVolume(199)).toBe("compact");
    expect(classifyPocketVolume(370)).toBe("small");
    expect(classifyPocketVolume(600)).toBe("drug_like");
    expect(classifyPocketVolume(1500)).toBe("large");
  });
});

describe("derivePocketNarrative", () => {
  it("separates 'never computed' from 'searched and not found'", () => {
    const absent = derivePocketNarrative(null);
    const noneDetected = derivePocketNarrative({ status: "none_detected" });

    expect(absent.status).toBe("absent");
    expect(absent.headline).toContain("No cavity scan requested");
    expect(noneDetected.status).toBe("none_detected");
    expect(noneDetected.headline).toContain("No cavity returned for this residue");
    expect(absent.headline).not.toBe(noneDetected.headline);
  });

  it("does not turn a data-availability failure into a biological negative", () => {
    // The runner returns `none_detected` both when its search finds nothing and
    // when the residue is missing from the model. The copy must not resolve that
    // ambiguity into a confident negative.
    const narrative = derivePocketNarrative({ status: "none_detected" });
    expect(narrative.plainLanguage).toMatch(/could not be located in the modelled structure/i);
    expect(narrative.plainLanguage).not.toMatch(/therefore has no predicted cavity/i);
    expect(narrative.bottomLine).toMatch(/absent evidence, not as a negative finding/i);
  });

  it("reports a fallback-engine result as real data, not an unavailable service", () => {
    // `fallback` means fpocket produced the numbers after P2Rank did not.
    const narrative = derivePocketNarrative({ status: "fallback" });
    expect(narrative.status).toBe("fallback_engine");
    expect(narrative.badge).toBe("fpocket fallback");
    expect(narrative.plainLanguage).toMatch(/fpocket fallback engine/i);
    expect(narrative.plainLanguage).not.toMatch(/P2Rank did not run/i);
  });

  it("treats a present-but-statusless payload as unavailable, not as a scan never requested", () => {
    const narrative = derivePocketNarrative({ pocketDistance: 5, pocketScore: 40, pocketVolume: 500 });
    expect(narrative.status).toBe("unavailable");
    expect(narrative.headline).toBe("P2Rank unavailable");
  });

  it("treats a failed scan as missing evidence, not negative evidence", () => {
    const narrative = derivePocketNarrative(null, { error: "Java 17 not initialised" });
    expect(narrative.status).toBe("error");
    expect(narrative.plainLanguage).toContain("Java 17 not initialised");
    expect(narrative.bottomLine).toContain("missing evidence, not negative evidence");
  });

  it("explains a distal result in plain language without implying safety", () => {
    const narrative = derivePocketNarrative(DISTAL_POCKET, { variantResidueIndex: 433 });

    expect(narrative.status).toBe("success");
    expect(narrative.classification.code).toBe("DISTAL_SURFACE");
    expect(narrative.proximity.band).toBe("distal");
    expect(narrative.proximity.distance).toBe(28.14);
    expect(narrative.ranking.band).toBe("weak");
    expect(narrative.ranking.score).toBe(2);
    expect(narrative.plainLanguage).toContain("28.14");
    expect(narrative.bottomLine).toContain("unlikely to act by reshaping it");
    expect(narrative.badge).toBe("DISTAL_SURFACE");
  });

  it("names the measured reference point instead of calling it the cavity centre", () => {
    // The runner computes the centroid of the pocket's own residues, not the
    // cavity's geometric centre, so the wording must not claim the latter.
    const narrative = derivePocketNarrative(DISTAL_POCKET, { variantResidueIndex: 433 });
    expect(narrative.plainLanguage).toContain("centroid of the pocket residues");
    expect(narrative.plainLanguage).not.toMatch(/cavity centre/i);
    expect(narrative.proximity.detail).not.toMatch(/cavity centre/i);
    expect(narrative.glossary.find(entry => entry.term === "Pocket distance")!.meaning).not.toMatch(
      /centre of the nearest cavity/i
    );
  });

  it("refuses to print a fabricated volume as Å³ and quotes the surface count instead", () => {
    // Production payloads carry pocketVolume = sas_points * 10 because the real
    // P2Rank predictions CSV has no volume column. With no provenance saying the
    // volume was measured, no unit may be printed.
    const narrative = derivePocketNarrative(DISTAL_POCKET, { variantResidueIndex: 433 });
    expect(narrative.volume.isMeasured).toBe(false);
    expect(narrative.volume.volume).toBeNull();
    expect(narrative.volume.band).toBe("unknown");
    expect(narrative.volume.surfacePoints).toBe(37);
    expect(narrative.plainLanguage).not.toContain("Å³");
    expect(narrative.plainLanguage).toContain("37");
    expect(narrative.plainLanguage).not.toMatch(/drug-like|ligand-sized|encloses about/i);
  });

  it("prints a volume only when provenance declares it measured", () => {
    const narrative = derivePocketNarrative(
      { ...DISTAL_POCKET, provenance: { engine: "p2rank", volumeSource: "measured" } },
      { variantResidueIndex: 433 }
    );
    expect(narrative.volume.isMeasured).toBe(true);
    expect(narrative.volume.volume).toBe(370);
    expect(narrative.volume.band).toBe("small");
    expect(narrative.plainLanguage).toContain("Å³");
  });

  it("describes the ranking index accurately rather than denying it is calibrated", () => {
    // P2Rank's own documentation describes this field as a calibrated probability
    // of being a ligand-binding site, per model profile. The earlier copy claimed
    // the opposite ("not a calibrated probability"), which was simply false.
    const narrative = derivePocketNarrative(DISTAL_POCKET, { variantResidueIndex: 433 });
    const rankingMeaning = narrative.glossary.find(entry => entry.term === "P2Rank ranking index")!.meaning;

    expect(rankingMeaning).toMatch(/calibrated/i);
    expect(rankingMeaning).toMatch(/per model profile/i);
    expect(rankingMeaning).toMatch(/not an affinity/i);
    expect(rankingMeaning).not.toMatch(/not a calibrated probability/i);
  });

  it("does not surface the placeholder cofactor string as a ligand", () => {
    const narrative = derivePocketNarrative(DISTAL_POCKET, { variantResidueIndex: 433 });
    expect(narrative.cofactor.name).toBeNull();
    expect(narrative.cofactor.detail).toContain("No curated ligand");
  });

  it("keeps a real curated cofactor", () => {
    const narrative = derivePocketNarrative(
      { ...DISTAL_POCKET, likelyCofactor: "HEME" },
      { variantResidueIndex: 433 }
    );
    expect(narrative.cofactor.name).toBe("HEME");
  });

  it("promotes a residue that lines the cavity regardless of centroid distance", () => {
    const narrative = derivePocketNarrative(DISTAL_POCKET, { variantResidueIndex: 173 });
    expect(narrative.lining.includesVariantResidue).toBe(true);
    expect(narrative.proximity.band).toBe("lining");
    expect(narrative.classification.code).toBe("ACTIVE_SITE_LINING");
    expect(narrative.plainLanguage).toContain("lining it");
  });

  it("reports the nearest lining residue and the lining count", () => {
    const narrative = derivePocketNarrative(DISTAL_POCKET, { variantResidueIndex: 433 });
    expect(narrative.lining.count).toBe(2);
    expect(narrative.lining.nearest?.index).toBe(292);
  });

  it("bands a close, well-ranked cavity as active-site proximate and accents it", () => {
    const narrative = derivePocketNarrative(
      {
        status: "success",
        pocketDistance: 6.4,
        pocketScore: 88,
        pocketVolume: 620,
        likelyCofactor: "None",
        pocketResidues: [{ name: "ASP", index: 12, distance: 3.1 }]
      },
      { variantResidueIndex: 433 }
    );
    expect(narrative.proximity.band).toBe("proximal");
    expect(narrative.classification.code).toBe("ACTIVE_SITE_PROXIMATE");
    expect(narrative.ranking.band).toBe("very_strong");
    expect(narrative.badgeTone).toBe("accent");
    expect(narrative.caveats.join(" ")).toContain("detects cavity geometry, not function");
  });

  it("warns when a cavity is adjacent but poorly ranked", () => {
    const narrative = derivePocketNarrative(
      { status: "success", pocketDistance: 7.2, pocketScore: 4, pocketVolume: 120, likelyCofactor: "None" },
      { variantResidueIndex: 433 }
    );
    expect(narrative.badgeTone).toBe("warn");
    expect(narrative.bottomLine).toContain("P2Rank ranks that cavity poorly");
    expect(narrative.caveats.join(" ")).toContain("not near a validated binding site");
  });

  it("does not attribute a rejection to P2Rank on a middling score", () => {
    // score 40 is the "moderate" band. The panel shows that band beside the
    // number, so the sentence may not claim the tool rejected the cavity.
    const narrative = derivePocketNarrative(
      { status: "success", pocketDistance: 6.1, pocketScore: 40, pocketVolume: 400, likelyCofactor: "None" },
      { variantResidueIndex: 433 }
    );
    expect(narrative.ranking.band).toBe("moderate");
    expect(narrative.bottomLine).toMatch(/middling/i);
    expect(narrative.bottomLine).not.toMatch(/does not consider that cavity a likely ligand-binding site/i);
  });

  it("never claims a retryable infrastructure failure is a biological negative", () => {
    const narrative = derivePocketNarrative({ status: "unavailable" });
    expect(narrative.status).toBe("unavailable");
    expect(narrative.bottomLine).toContain("not evidence that the residue is distant");
  });

  it("always ships the glossary so the KPI numbers are self-explaining", () => {
    for (const pocket of [null, { status: "none_detected" }, DISTAL_POCKET] as const) {
      const narrative = derivePocketNarrative(pocket as PocketNarrativeInput | null);
      expect(narrative.glossary.map(entry => entry.term)).toEqual([
        "Pocket distance",
        "P2Rank ranking index",
        "Pocket volume"
      ]);
    }
  });

  it("handles a loading scan with a provisional caveat", () => {
    const narrative = derivePocketNarrative(null, { isLoading: true });
    expect(narrative.status).toBe("loading");
    expect(narrative.caveats).toHaveLength(1);
  });

  it("reports the nearest lining residue without describing the variant residue as its own neighbour", () => {
    const narrative = derivePocketNarrative(DISTAL_POCKET, { variantResidueIndex: 292 });
    expect(narrative.lining.includesVariantResidue).toBe(true);
    // 292 is a member and 173 is not, so the nearest neighbour must be 173.
    expect(narrative.lining.nearest?.index).toBe(173);
  });

  it("matches cavity membership on chain as well as residue number", () => {
    // Same numbering on two chains: an index-only match would claim the variant
    // residue lines the cavity when the pocket belongs to the other copy.
    const pocket = {
      status: "success",
      pocketDistance: 12.5,
      pocketScore: 60,
      pocketVolume: 700,
      likelyCofactor: "None",
      pocketResidues: [{ name: "GLY", index: 433, distance: 4.1, chain: "B" }]
    };
    const onChainB = derivePocketNarrative(pocket, { variantResidueIndex: 433, variantResidueChain: "B" });
    expect(onChainB.lining.includesVariantResidue).toBe(true);

    const onChainA = derivePocketNarrative(pocket, { variantResidueIndex: 433, variantResidueChain: "A" });
    expect(onChainA.lining.includesVariantResidue).toBe(false);
    expect(onChainA.proximity.band).toBe("distal");
  });

  it("ignores a null element inside the residue array instead of throwing", () => {
    const narrative = derivePocketNarrative(
      { status: "success", pocketDistance: 5, pocketScore: 55, pocketVolume: 400, pocketResidues: [null as never] },
      { variantResidueIndex: 433 }
    );
    expect(narrative.lining.count).toBe(0);
    expect(narrative.lining.nearest).toBeNull();
  });

  it("handles a success payload with null numerics instead of throwing", () => {
    const narrative = derivePocketNarrative(
      { status: "success", pocketDistance: null, pocketScore: null, pocketVolume: null, pocketResidues: [] },
      { variantResidueIndex: 433 }
    );
    expect(narrative.status).toBe("success");
    expect(narrative.proximity.band).toBe("unknown");
    expect(narrative.classification.code).toBe("UNCLASSIFIED");
    expect(narrative.ranking.band).toBe("unknown");
    expect(narrative.volume.band).toBe("unknown");
  });
});
