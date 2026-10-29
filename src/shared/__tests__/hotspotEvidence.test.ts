/**
 * hotspotEvidence — what the Hotspots view may claim, on live captures of SOD1 p.Ala5Val (dense ClinVar,
 * ALS expert panel in preparation) and VHL p.Tyr98His (released VHL expert panel with a PM1 rule).
 * Fixtures: src/shared/__tests__/fixtures/hotspots{Sod1,Vhl}.json, from server/services/evidence-context/hotspots.ts.
 */
import { describe, it, expect } from "vitest";
import { buildHotspotEvidence, hotspotContextSchema, HOTSPOT_GRADE_LABEL, type HotspotContext } from "../hotspotEvidence";
import sod1Raw from "./fixtures/hotspotsSod1.json";
import vhlRaw from "./fixtures/hotspotsVhl.json";

const sod1 = hotspotContextSchema.parse(sod1Raw);
const vhl = hotspotContextSchema.parse(vhlRaw);
const build = (context: HotspotContext | null, residue: number, residueLabel: string, extra: object = {}) =>
  buildHotspotEvidence({ context, loadState: context ? "ready" : "loading", residue, residueLabel, ...extra });
const rung = (ev: ReturnType<typeof build>, key: string) => ev.rungs.find((r) => r.key === key)!;

describe("buildHotspotEvidence — SOD1 p.Ala5Val", () => {
  const ev = build(sod1, 5, "Ala5");

  it("keeps six definitions apart, each with its own grade, and merges none", () => {
    expect(ev.rungs.map((r) => [r.key, HOTSPOT_GRADE_LABEL[r.grade]])).toEqual([
      ["cspec", "Expert specification"], ["regional", "Calibrated (preprint)"], ["per-published", "Published region"],
      ["per-rerun", "Published method, not validated here"], ["spatial", "Published method, benchmarked here"], ["distribution", "Measurement"],
    ]);
  });

  it("says the ALS panel's rules are not released, rather than that no expert definition exists", () => {
    expect(rung(ev, "cspec").state).toBe("none");
    expect(rung(ev, "cspec").headline).toMatch(/not released \(Pilot Rules In Prep\)/);
  });

  it("reads the regional O/E 0.70 as no calibrated band, and as PP2 input rather than PM1", () => {
    expect(rung(ev, "regional").headline).toMatch(/O\/E 0\.70, between the calibrated bands/);
    expect(rung(ev, "regional").details.join(" ")).toMatch(/so it is PP2, not PM1/);
    expect(rung(ev, "regional").details.join(" ")).toMatch(/One interval spans the protein/);
  });

  it("states the re-run's power problem and never presents its negative as tolerance", () => {
    const r = rung(ev, "per-rerun");
    expect(r.headline).toMatch(/No window is enriched/);
    expect(r.details.join(" ")).toMatch(/a negative is not evidence of no hot spot/);
  });

  it("shows the 3D score because SOD1's clustering gate passed, with the gate's p-values beside it", () => {
    const r = rung(ev, "spatial");
    expect(sod1.spatial.status).toBe("ok");
    expect(r.state).toBe("read");
    expect(r.headline).toMatch(/^PathProx [+-]\d\.\d\d/);
    expect(r.details[0]).toMatch(/both must be < 0\.05/);
  });

  it("lists ClinVar P/LP residues nearest in 3D first, with Cα–Cα distances on the model", () => {
    expect(ev.rows.length).toBe(sod1.distribution.plp.length);
    expect(ev.rows[0].residue).toBe(5); // the variant's own residue carries P/LP (A5V is ALS1)
    const d = ev.rows.slice(1).map((r) => r.distanceA!);
    expect(d).toEqual([...d].sort((a, b) => a - b));
    expect(ev.nearest3d?.distanceA).toBeGreaterThan(0);
  });

  it("keeps PM1 as the engine records it and says nothing here changes a criterion", () => {
    expect(ev.pm1Note).toMatch(/critical functional site only/);
    expect(ev.pm1Note).toMatch(/hot-spot PM1 is an open decision/);
  });
});

describe("buildHotspotEvidence — VHL", () => {
  it("names the released VHL panel's PM1 rule as the authority, without parsing residues from its text", () => {
    const ev = build(vhl, 98, "Tyr98");
    const r = rung(ev, "cspec");
    expect(r.state).toBe("read");
    expect(r.headline).toMatch(/VHL Variant Curation Expert Panel publishes a PM1 rule/);
    expect(r.headline).toMatch(/residue lists are not parsed/);
    expect(r.bands).toEqual([]);
    expect(ev.finding.rest).toMatch(/expert panel's PM1 text is the authority/);
  });

  it("reads O/E 1.12 as the calibrated BP1 band that the engine does not apply", () => {
    expect(rung(build(vhl, 98, "Tyr98"), "regional").headline).toMatch(/BP1 band, which the engine does not apply/);
  });
});

describe("buildHotspotEvidence — states", () => {
  it("is loading, never empty, before the context arrives", () => {
    expect(build(null, 5, "Ala5").state).toBe("loading");
  });
  it("reports a failed read as a provider error, not as 'no hot spot'", () => {
    const ev = buildHotspotEvidence({ context: null, loadState: "error", loadError: "Request timed out.", residue: 5, residueLabel: "Ala5" });
    expect(ev.state).toBe("failed");
    expect(ev.failure).toBe("Request timed out.");
  });
  it("withholds the 3D score when the clustering gate fails, and says why", () => {
    const ctx = { ...sod1, spatial: { ...sod1.spatial, status: "not-clustered" as const, scores: [], reason: "Not shown: not clustered." } };
    const ev = build(ctx, 5, "Ala5");
    expect(rung(ev, "spatial").state).toBe("not-shown");
    expect(ev.rows.every((r) => r.pathprox === null)).toBe(true);
  });
  it("reads the engine's own PP2 record beside the regional rung", () => {
    const ev = build(sod1, 5, "Ala5", { engineCriteria: [{ code: "PP2_Moderate" }] });
    expect(rung(ev, "regional").details.join(" ")).toMatch(/Engine record: PP2_Moderate/);
  });
});

/**
 * The honesty rules: a test that could not run is never reported as a negative, a source that did not
 * answer is never reported as a zero, and a number is never printed where it would contradict its own band.
 */
describe("buildHotspotEvidence — what an unrun or unanswered test may say", () => {
  it("withholds a published region it cannot place instead of calling the residue outside it", () => {
    const ctx: HotspotContext = { ...sod1, perPublished: { status: "ok", reason: null, regions: [
      { analysis: "gene", family: null, tag: "PER", start: 10, end: 40, adjP: 0.01, verified: false, mismatches: 0, checked: 0 },
    ] } };
    const ev = build(ctx, 5, "Ala5");
    const r = rung(ev, "per-published");
    expect(r.state).toBe("not-shown");
    expect(r.atVariant).toBeNull();
    expect(r.headline).toMatch(/could not be placed/);
    expect(r.details.join(" ")).toMatch(/nothing to compare/);
    expect(ev.finding.lead).not.toMatch(/outside/);
  });

  it("counts only the definitions that returned a verdict, and says how many", () => {
    const ev = build(sod1, 5, "Ala5");
    const answered = ev.rungs.filter((r) => r.atVariant !== null).length;
    expect(answered).toBeGreaterThan(0);
    expect(ev.finding.lead).toContain(`${answered} definition${answered === 1 ? "" : "s"}`);
  });

  it("does not report a withheld mapping as 'no region'", () => {
    const ctx: HotspotContext = { ...sod1, regional: { status: "withheld-mapping", reason: null, regions: [] } };
    expect(rung(build(ctx, 5, "Ala5"), "regional").state).toBe("not-shown");
  });

  it("withholds 3D distances on a numbering mismatch, with the rung that withholds the score", () => {
    const ctx: HotspotContext = { ...sod1, spatial: { ...sod1.spatial, status: "numbering-mismatch" } };
    const ev = build(ctx, 5, "Ala5");
    expect(ev.rows.every((r) => r.distanceA === null)).toBe(true);
    expect(ev.nearest3d).toBeNull();
    expect(ev.finding.rest).not.toMatch(/Nearest ClinVar/);
  });

  it("marks the gnomAD count unknown, not zero, when gnomAD was not read", () => {
    const ctx: HotspotContext = { ...sod1, distribution: { ...sod1.distribution, status: "unavailable", reason: "gnomAD timed out.", gnomad: [] } };
    const ev = build(ctx, 5, "Ala5");
    expect(ev.rows.length).toBeGreaterThan(0);
    expect(ev.rows.every((r) => r.gnomad === null)).toBe(true);
  });

  it("does not print an in-gene AUROC below the benchmark's informative-gene floor", () => {
    const ctx: HotspotContext = { ...sod1, spatial: { ...sod1.spatial, selfCheck: { auroc: 0.91, pathogenic: 3, neutral: 3 } } };
    expect(rung(build(ctx, 5, "Ala5"), "spatial").details.join(" ")).toMatch(/below the benchmark's floor/);
    expect(rung(build(sod1, 5, "Ala5"), "spatial").details.join(" ")).toMatch(/in-sample AUROC 0\.73/);
  });

  it("prints a third decimal where two would contradict the band edge it states", () => {
    const ctx: HotspotContext = { ...sod1, regional: { status: "available", reason: null, regions: [{ start: 1, end: 154, oe: 0.3601, pValue: 0.01 }] } };
    const r = rung(build(ctx, 5, "Ala5"), "regional");
    // 0.3601 is above the 0.36 Moderate edge, so it is Supporting; printing "0.36" would contradict its own band.
    expect(r.headline).toMatch(/O\/E 0\.360/);
    expect(r.headline).toMatch(/PP2 Supporting/);
  });

  it("treats a gene outside the published table as uncovered, not as a tested negative", () => {
    const ev = build(sod1, 5, "Ala5");
    expect(rung(ev, "per-published").details.join(" ")).toMatch(/not a tested negative/);
  });
});

describe("buildHotspotEvidence — the residue columns (accessibility, UniProt site, native interface)", () => {
  const rowOf = (e: ReturnType<typeof build>, residue: number) => e.rows.find((r) => r.residue === residue)!;
  const support = { status: "ok" as const, reason: null, byResidue: new Map([[7, [{ label: "SOD1, other chain", k: 104, n: 118 }]]]) };

  it("reads the measured RSA at each P/LP residue, as a fraction, and nowhere else", () => {
    const e = build(sod1, 5, "Ala5");
    expect(rowOf(e, 5).rsa).toBe(0.0166);
    expect(e.columns.rsa).toEqual({ state: "ok", reason: null });
    expect(e.rows.every((r) => r.rsa !== null)).toBe(true);
  });

  it("says why accessibility is missing instead of printing zeros, whatever the reason", () => {
    for (const status of ["unavailable", "no-model", "numbering-mismatch"] as const) {
      const e = build({ ...sod1, accessibility: { status, reason: `because ${status}`, values: [] } }, 5, "Ala5");
      expect(e.columns.rsa).toEqual({ state: "unavailable", reason: `because ${status}` });
      expect(e.rows.every((r) => r.rsa === null)).toBe(true);
    }
  });

  it("parses an answer from before the field as unavailable, not as a failure", () => {
    const { accessibility: _gone, ...older } = sod1Raw as Record<string, unknown>;
    const parsed = hotspotContextSchema.parse(older);
    expect(parsed.accessibility.status).toBe("unavailable");
  });

  it("lists the UniProt sites at a residue with their evidence level; a disulfide is its two residues, not the span between", () => {
    // Residues are taken from the capture's own P/LP rows, so the test does not depend on which residues ClinVar lists.
    const res = build(sod1, 5, "Ala5").rows.map((r) => r.residue).sort((x, y) => x - y);
    const [a, between, , b, , spanStart, inSpan, , spanEnd] = res;
    const annotations = [
      { start: a, end: a, isPair: false, name: "Metal binding (Cu²⁺)", evidence: "Experimental" },
      { start: a, end: b, isPair: true, name: "Disulfide bond", evidence: "Experimental" },
      { start: spanStart, end: spanEnd, isPair: false, name: "Region", evidence: "By similarity" },
    ];
    const e = build(sod1, 5, "Ala5", { annotations });
    expect(rowOf(e, a).sites.map((x) => x.name)).toEqual(["Metal binding (Cu²⁺)", "Disulfide bond"]);
    expect(rowOf(e, a).sites[0]).toEqual({ name: "Metal binding (Cu²⁺)", evidence: "Experimental" });
    expect(rowOf(e, b).sites).toEqual([{ name: "Disulfide bond", evidence: "Experimental" }]);
    expect(rowOf(e, between).sites).toEqual([]); // between the two cysteines: a pair is not its span
    expect(rowOf(e, inSpan).sites).toEqual([{ name: "Region", evidence: "By similarity" }]); // inside an ordinary span
  });

  it("marks the site column not read when the feature table was not read, never as 'none'", () => {
    expect(build(sod1, 5, "Ala5").columns.sites).toMatchObject({ state: "unavailable" });
    expect(build(sod1, 5, "Ala5", { annotations: null }).columns.sites).toMatchObject({ state: "unavailable" });
    expect(build(sod1, 5, "Ala5", { annotations: [] }).columns.sites).toEqual({ state: "ok", reason: null });
  });

  it("carries the native interface partners at a residue, and separates 'read, none' from 'not read'", () => {
    const e = build(sod1, 5, "Ala5", { interfaces: support });
    expect(rowOf(e, 7).interfaceSupport).toEqual([{ label: "SOD1, other chain", k: 104, n: 118 }]);
    expect(rowOf(e, 4).interfaceSupport).toEqual([]);
    expect(e.columns.interface).toEqual({ state: "ok", reason: null });
    expect(build(sod1, 5, "Ala5", { interfaces: { status: "none", reason: null, byResidue: new Map() } }).columns.interface.reason).toMatch(/No native solved interface/);
    expect(build(sod1, 5, "Ala5", { interfaces: { status: "unavailable", reason: "The assembly was not read.", byResidue: new Map() } }).columns.interface).toEqual({ state: "unavailable", reason: "The assembly was not read." });
    expect(build(sod1, 5, "Ala5").columns.interface.state).toBe("unavailable");
  });
});
