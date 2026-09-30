import { describe, it, expect } from "vitest";
import { buildPerturbationEvidence, perturbationFinding } from "../perturbationEvidence";
import { NAE1_ENERGETICS, NAE1_RESIDUES, NAE1_RESULT } from "./fixtures/nae1Perturbation";
import { LEGACY_ENGINE_LABELS } from "../engineStatus";

const build = (over: Partial<Parameters<typeof buildPerturbationEvidence>[0]> = {}) =>
  buildPerturbationEvidence({
    result: NAE1_RESULT,
    residues: NAE1_RESIDUES,
    foldingEnergetics: NAE1_ENERGETICS,
    structuralDiff: null,
    metrics: null,
    saprotEngine: "remote-hf",
    ...over
  });

describe("buildPerturbationEvidence — NAE1 p.Asp116Gly", () => {
  it("describes SaProt by the model that served it, not by the settings engine", () => {
    const saprot = build().lms.find(l => l.id === "saprot")!;
    // Settings said remote-hf (→ 650M); the payload says SaProt_35M_AF2 ran.
    expect(saprot.calibration?.id).toBe("saprot35m");
    expect(saprot.embedding.dim).toBe(480);
    expect(saprot.calibration?.note).not.toMatch(/near zero/);
    expect(saprot.served.engine).toBe("remote");
  });

  it("never pools ΔLLR across families; the cross-model statement is the within-model rank", () => {
    const ev = build();
    expect(ev.scale.mixed).toBe(true);
    expect(ev.scale.families.sort()).toEqual(["esm2", "esmc", "saprot"]);
    expect(ev.consensus).toMatchObject({ nRanked: 3, nLeast: 3, agree: true, band: "least" });
    expect(ev).not.toHaveProperty("lps");
  });

  it("states the finding without a composite or a pathogenicity claim", () => {
    const f = perturbationFinding(build());
    expect(f.headline).toBe("All 3 models place Gly among the three least-preferred residues at this position");
    expect(f.predicate).toContain("−7.2 to −5.8 nats");
    expect(f.predicate).toContain("Neither is calibrated pathogenicity evidence");
    expect(`${f.headline} ${f.predicate}`).not.toMatch(/stability|disruption|consensus verdict/i);
  });

  it("reads the engine's own concordance: the language models are informational", () => {
    const ev = build();
    expect(ev.engine.informational).toBe(true);
    expect(ev.lms.every(l => !l.votes)).toBe(true);
  });

  it("does not attach the ΔΔG SD to the VdW term, and uses only local marks", () => {
    const vdw = build().physical.readings.find(r => r.key === "vdw")!;
    expect(vdw.text).toBe("+0.62");
    expect(vdw.text).not.toContain("±");
    expect(vdw.markKind).toBe("local");
    expect(vdw.call).toEqual({ label: "Below clash mark", tone: "neutral" });
    expect(build().physical.runsIdentical).toBe(true);
  });

  it("reports Cα displacement on FoldX's rigid backbone as not measured, never as 0", () => {
    const ev = build({
      structuralDiff: { rmsd: 0, localRmsd: 0, windowDisplacements: [{ resSeq: 116, resName: "ASP", displacement: 0 }], clashes: { wtClashCount: 2, mutClashCount: 2, diff: 0 } }
    });
    const ca = ev.physical.readings.find(r => r.key === "ca-max")!;
    expect(ev.physical.rigidBackbone).toBe(true);
    expect(ca.value).toBeNull();
    expect(ca.availability.label).toBe("Not measured");
  });

  it("names what the neighbour side-chain RMSD was measured against", () => {
    const paired = build({ foldingEnergetics: { ...NAE1_ENERGETICS, localSidechainRmsd: 0.41, localSidechainRmsdReference: "foldx-paired" } });
    expect(paired.physical.readings.find(r => r.key === "neighbour-rmsd")!.note).toBe("Against FoldX's paired wild type from the same run");
    // Results cached before the pair was kept were measured against the input template.
    const older = build({ foldingEnergetics: { ...NAE1_ENERGETICS, localSidechainRmsd: 0.41 } });
    expect(older.physical.readings.find(r => r.key === "neighbour-rmsd")!.note).toMatch(/before RepairPDB/);
  });

  it("keeps absent contact counts absent instead of printing 0", () => {
    const contacts = build().physical.readings.find(r => r.key === "contacts")!;
    expect(contacts.value).toBeNull();
    expect(contacts.text).toBe("—");
  });

  it("treats a missing rank or entropy as missing, not as rank 1 or 0 bits", () => {
    const result = { ...NAE1_RESULT, esm2Eval: { ...NAE1_RESULT.esm2Eval, mutRank: undefined, positionalEntropy: 0 } };
    const esm2 = build({ result }).lms.find(l => l.id === "esm2")!;
    expect(esm2.rank).toBeNull();
    expect(esm2.entropy).toBeNull();
  });

  it("flags a VESM fallback under the ESMC row and a sequence-only SaProt", () => {
    const result = {
      ...NAE1_RESULT,
      esmcEval: { ...NAE1_RESULT.esmcEval, provenance: "VESM-150M (CPU Fallback - remote failed)" },
      saprotEval: { ...NAE1_RESULT.saprotEval, conformationState: "#" }
    };
    const ev = build({ result });
    const esmc = ev.lms.find(l => l.id === "esmc")!;
    expect(esmc.caveats).toContain("fallback-model");
    expect(esmc.calibration?.id).toBe("vesm150m");
    expect(esmc.embedding.dim).toBe(640);
    expect(ev.lms.find(l => l.id === "saprot")!.caveats).toContain("sequence-only");
  });

  it("names ESM3's quantity for what it is and drops the heuristic impact line", () => {
    const esm3 = build().esm3!;
    expect(esm3.drift).toBeCloseTo(0.05);
    expect(esm3.driftBand).toBe("none");
    expect(esm3.templateConfidence).toBe(94.5);
    expect(esm3.burial).toBeNull();
    expect(JSON.stringify(esm3)).not.toContain("rotamer");
  });

  it("uses only canonical status words", () => {
    const ev = build({ result: { ...NAE1_RESULT, esm2Eval: { error: "Request timed out" }, esmcEval: { loading: true } } });
    const labels = ev.lms.map(l => l.availability.label);
    for (const legacy of LEGACY_ENGINE_LABELS) expect(labels).not.toContain(legacy);
    expect(ev.lms.find(l => l.id === "esmc")!.availability.state).toBe("pending");
    expect(ev.pending).toBe(true);
  });
});
