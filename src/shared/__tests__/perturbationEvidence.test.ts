import { describe, it, expect } from "vitest";
import { buildPerturbationEvidence, perturbationFinding } from "../perturbationEvidence";
import { NAE1_ENERGETICS, NAE1_RESIDUES, NAE1_RESULT } from "./fixtures/nae1Perturbation";
import { SLC12A4_RESIDUES, SLC12A4_RESULT } from "./fixtures/slc12a4Perturbation";
import { LEGACY_ENGINE_LABELS } from "../engineStatus";
import { GATA4_RESULT } from "./fixtures/gata4Perturbation";

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
  it("preserves embedding coverage gaps and measured zeros at their original positions", () => {
    const evidence = build({ result: { ...NAE1_RESULT, esm3Eval: { perturbationScores: [0, -1, 0.2] } } });
    expect(evidence.esm3?.perPosition).toEqual([{ position: 1, value: 0 }, { position: 2, value: null }, { position: 3, value: 0.2 }]);
  });
  it("describes SaProt by the model that served it, not by the settings engine", () => {
    const saprot = build().lms.find(l => l.id === "saprot")!;
    // Settings said remote-hf (→ 650M); the payload says SaProt_35M_AF2 ran.
    expect(saprot.calibration?.id).toBe("saprot35m");
    expect(saprot.embedding.dim).toBe(480);
    expect(saprot.calibration?.note).not.toMatch(/near zero/);
    expect(saprot.served.engine).toBe("remote");
  });

  it("never pools ΔLLR across families; the cross-model statement is each model's own direction", () => {
    const ev = build();
    expect(ev.scale.mixed).toBe(true);
    expect(ev.scale.families.sort()).toEqual(["esm2", "esmc", "saprot"]);
    expect(ev.consensus).toMatchObject({ nRanked: 3, nLeast: 3, agree: true, band: "least" });
    expect(ev).not.toHaveProperty("lps");
  });

  it("states the finding as each model's direction and its own odds, without a pathogenicity claim", () => {
    const f = perturbationFinding(build());
    expect(f.headline).toBe("SaProt, ESM-2 and ESMC favour native Asp over Gly");
    // exp(6.991) ≈ 1,087 — the ΔLLR restated per model, never pooled.
    expect(f.predicate).toContain("Asp 1,087× as likely as Gly in SaProt");
    expect(f.predicate).toContain("each on its own model's scale");
    expect(f.predicate).toContain("None of this is calibrated pathogenicity evidence");
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

  it("does not double-count VESM-150M when both ESM-2 and ESMC fall back to it", () => {
    const result = {
      ...NAE1_RESULT,
      esm2Eval: { ...NAE1_RESULT.esm2Eval, llr: -9.55, provenance: "VESM-150M (CPU Fallback - remote failed)" },
      esmcEval: { ...NAE1_RESULT.esmcEval, llr: -9.55, provenance: "VESM-150M (Local)" },
    };
    const ev = build({ result });
    // Both cards remain in lms and scored so caveat callouts still render on both rows.
    expect(ev.lms).toHaveLength(3);
    expect(ev.scored).toHaveLength(3);
    // Cross-model direction and rank consensus count distinct serving checkpoints (SaProt + VESM-150M = 2).
    expect(ev.direction.nScored).toBe(2);
    expect(ev.direction.nFavourNative).toBe(2);
    expect(ev.consensus.nRanked).toBe(2);
    const f = perturbationFinding(ev);
    // Named by the checkpoint that ran: "ESMC" here credited ESMC with VESM-150M's reading.
    expect(f.headline).toBe("SaProt and VESM-150M favour native Asp over Gly");
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

describe("buildPerturbationEvidence — SLC12A4 p.Gln867His", () => {
  const ev = buildPerturbationEvidence({
    result: SLC12A4_RESULT,
    residues: SLC12A4_RESIDUES,
    foldingEnergetics: null,
    structuralDiff: null,
    metrics: null,
    saprotEngine: "remote-hf"
  });
  const lm = (id: string) => ev.lms.find(l => l.id === id)!;

  it("reads ESM-2 and ESMC as favouring Gln, whatever their rank band", () => {
    // Ranks 5 and 3 used to print "Upper half" and "Most preferred" beside ΔLLR −5.95 and −6.98.
    expect(lm("esm2").direction).toBe("favours-native");
    expect(lm("esmc").direction).toBe("favours-native");
    expect(lm("esm2").nativeRank).toBe(1);
    expect(Math.round(lm("esm2").odds!)).toBe(384);
    expect(Math.round(lm("esmc").odds!)).toBe(1075);
    expect(lm("esmc").bandLabel).toBe("Top 3");
    expect(lm("esmc").rankSentence).toMatch(/Gln itself takes 99% of the model's probability/);
  });

  it("sets aside a near-flat SaProt instead of reading its rank", () => {
    const saprot = lm("saprot");
    expect(saprot.direction).toBe("flat");
    expect(saprot.caveats).toEqual(expect.arrayContaining(["sequence-only", "flat"]));
    expect(saprot.rankSentence).toMatch(/no preference at this site/);
    expect(ev.direction).toEqual({ nScored: 3, nFavourNative: 2, nFavourVariant: 0, nEven: 0, nFlat: 1 });
    // The flat model stays out of the band agreement that used to say "the models disagree".
    expect(ev.consensus.nRanked).toBe(2);
  });

  it("states the finding the right way round", () => {
    const f = perturbationFinding(ev);
    expect(f.headline).toBe("ESM-2 and ESMC favour native Gln over His");
    expect(f.predicate).toContain("Gln 384× as likely as His in ESM-2");
    expect(f.predicate).toContain("Gln 1,075× as likely as His in ESMC");
    expect(f.predicate).toContain("SaProt spreads its probability almost evenly here");
    expect(`${f.headline} ${f.predicate}`).not.toMatch(/disagree|dispreferred half/);
  });

  it("gives ESM3's drift at the variant and how far its peak is", () => {
    const e = ev.esm3!;
    expect(e.drift).toBeCloseTo(0.004);
    expect(e.driftResidue).toBe(4);
    expect(e.peakDistance).toBe(863);
    expect(e.siteDrift).toBeCloseTo(0.001);
    expect(e.confidenceBand).toBe("Confident");
  });

  it("names a failed FoldX run instead of 'not built'", () => {
    const failed = buildPerturbationEvidence({
      result: SLC12A4_RESULT,
      residues: SLC12A4_RESIDUES,
      foldingStatus: "failed",
      foldingError: "RepairPDB exceeded its time budget."
    });
    expect(failed.physical.reason).toBe("The FoldX run failed: RepairPDB exceeded its time budget.");
    const none = buildPerturbationEvidence({ result: SLC12A4_RESULT, residues: SLC12A4_RESIDUES });
    expect(none.physical.reason).toBe("No FoldX mutant model was built for this variant.");
  });
});

/**
 * GATA4 p.Ser159Cys — the 2026-10 screenshot: Hugging Face answered 402 (no inference credits), the
 * host had no CUDA, and VESM-150M filled the ESM-2 card while the finding still credited "ESM-2".
 */
describe("buildPerturbationEvidence — the ESM-2 card after a Hugging Face refusal", () => {
  const withEsm2 = (esm2Eval: any) => build({ result: { ...NAE1_RESULT, esm2Eval: { ...NAE1_RESULT.esm2Eval, ...esm2Eval } } });
  const billing = { provider: "huggingface", code: "billing" };

  it("names the stand-in that produced the numbers, in the row and in the finding", () => {
    const ev = withEsm2({ provenance: "VESM-150M (Local Fallback)", remoteFailure: billing, fallbackReason: "esm2_t33_650M_UR50D: OSError: weights unavailable" });
    const esm2 = ev.lms.find(l => l.id === "esm2")!;
    expect(esm2.family).toBe("ESM-2");
    expect(esm2.name).toBe("VESM-150M");
    expect(esm2.caveats).toContain("fallback-model");
    expect(esm2.serviceNote).toBe("Hugging Face has no inference credits left on the saved token");
    const f = perturbationFinding(ev);
    expect(f.predicate).toContain("in VESM-150M");
    expect(f.predicate).not.toContain("in ESM-2");
  });

  it("reads genuine ESM-2 on this server as ESM-2, with the refusal kept as a note", () => {
    const ev = withEsm2({ provenance: "ESM-2 (esm2_t33_650M_UR50D - Local CPU)", remoteFailure: billing, scoringMethod: "masked-marginal" });
    const esm2 = ev.lms.find(l => l.id === "esm2")!;
    expect(esm2.name).toBe("ESM-2");
    expect(esm2.caveats).not.toContain("fallback-model");
    expect(esm2.calibration?.id).toBe("esm2_650m");
    expect(esm2.served.engine).toBe("local");
    expect(esm2.scoringMethod).toBe("masked-marginal");
    expect(esm2.serviceNote).toMatch(/no inference credits/);
  });

  it("resolves the 150M checkpoint to its own row instead of inferring 650M", () => {
    const esm2 = withEsm2({ provenance: "ESM-2 (esm2_t30_150M_UR50D - Local CPU)" }).lms.find(l => l.id === "esm2")!;
    expect(esm2.served.inferred).toBe(false);
    expect(esm2.calibration?.id).toBe("esm2_150m");
    expect(esm2.embedding.dim).toBe(640);
  });

  it("ignores a failure code it does not know rather than inventing a cause", () => {
    const esm2 = withEsm2({ remoteFailure: { provider: "huggingface", code: "solar-flare" } }).lms.find(l => l.id === "esm2")!;
    expect(esm2.remoteFailure).toBeNull();
    expect(esm2.serviceNote).toBeNull();
  });

  it("keeps a provider's raw error out of the reason and in the engine notes", () => {
    const raw = "upstream 503: <html>Service Unavailable</html>";
    const esm2 = build({ result: { ...NAE1_RESULT, esm2Eval: { error: raw, status: "offline" } } }).lms.find(l => l.id === "esm2")!;
    expect(esm2.availability.reason).not.toContain("<html>");
    expect(esm2.diagnostics).toContainEqual({ tier: "Engine error", text: raw });
  });
});

describe("buildPerturbationEvidence — method, input confidence and engine notes", () => {
  const diff = { rmsd: 0, localRmsd: 0, windowDisplacements: [], clashes: { wtClashCount: 2, mutClashCount: 5, diff: 3 } };

  it("states FoldX's fixed backbone from the recorded method, not from a zero RMSD", () => {
    const recorded = build({ structuralDiff: { ...diff, rmsd: 0.4, mutantModel: "foldx-buildmodel" } }).physical;
    expect(recorded.rigidBackbone).toBe(true);
    expect(recorded.method).toMatch(/^FoldX BuildModel/);
    const legacy = build({ structuralDiff: diff }).physical;
    expect(legacy.method).toMatch(/RMSD 0/);
  });

  it("carries clash counts and contact change as numbers for the figures", () => {
    const ev = build({ structuralDiff: diff, metrics: { lostContacts: 3, gainedContacts: 1, deltaSasa: 4.2 } });
    expect(ev.physical.clashCounts).toEqual({ wt: 2, mut: 5 });
    expect(ev.physical.contactChange).toEqual({ lost: 3, gained: 1 });
  });

  it("reads the site pLDDT only when the B-factor column holds pLDDT", () => {
    const at = (bFactorKind: string) =>
      build({ result: { ...NAE1_RESULT, disruptionPredictor: { level: "low", reason: "", plddt: 42.1, bFactorKind } } }).physical.inputConfidence;
    expect(at("plddt")).toEqual({ plddt: 42.1, band: expect.any(String) });
    expect(at("temperature-factor")).toBeNull();
  });

  it("gives the engine's own reason when the shift trace was skipped for time", () => {
    const note = "The embedding shift was not computed: its two passes would not finish in time. The score is complete.";
    const esm2 = build({ result: { ...NAE1_RESULT, esm2Eval: { ...NAE1_RESULT.esm2Eval, provenance: "ESM-2 (esm2_t33_650M_UR50D - Local CPU)", embeddingNote: note } } })
      .lms.find(l => l.id === "esm2")!;
    expect(esm2.embedding.absentReason).toBe(note);
  });

  it("codes an ESM-3 refusal as a plain service note", () => {
    const esm3 = build({ result: { ...NAE1_RESULT, esm3Eval: { ...NAE1_RESULT.esm3Eval, provenance: "VESM-150M (Local Fallback - ESM-3 remote failed)", remoteEngineNote: "HTTP 451", remoteFailure: { provider: "biohub", code: "region" } } } }).esm3!;
    expect(esm3.serviceNote).toBe("Biohub is not available from this server's region");
  });
});

describe("buildPerturbationEvidence — GATA4 p.Ser159Cys (VESM stands in after a billing refusal)", () => {
  const ev = buildPerturbationEvidence({
    result: GATA4_RESULT,
    residues: { wtCode: "S", mutCode: "C", wtLabel: "Ser", mutLabel: "Cys" }
  });

  it("credits the finding to the models that ran, not to the card's name", () => {
    expect(perturbationFinding(ev).headline).toBe("SaProt, VESM-150M and ESMC favour native Ser over Cys");
  });

  it("states the cause from the engine's code and keeps the raw error in the notes", () => {
    const esm2 = ev.lms.find(l => l.id === "esm2")!;
    expect(esm2.name).toBe("VESM-150M");
    expect(esm2.caveats).toContain("fallback-model");
    expect(esm2.serviceNote).toBe("Hugging Face has no inference credits left on the saved token");
    expect(esm2.diagnostics.map(d => d.tier)).toEqual(["Remote engine", "Local engine"]);
    expect(esm2.scoringMethod).toBe("masked-marginal");
  });
});

describe("buildPerturbationEvidence — failed states come from the status code, not from the error text", () => {
  const failed = (esm2Eval: any) => build({ result: { ...NAE1_RESULT, esm2Eval } }).lms.find(l => l.id === "esm2")!.availability;

  it("reads a timeout from its status even when the text says 'warming up'", () => {
    const a = failed({ error: "ESM-2 inference in standby (local sidecar warming up or offline)", status: "timeout" });
    expect(a.reason).toBe("The model timed out.");
    expect(a.action).toBe("retry");
  });

  it("offers settings only for a refused credential", () => {
    expect(failed({ error: "refused", status: "unauthorized" })).toMatchObject({ action: "settings" });
    // The word "token" in a message is not a status.
    expect(failed({ error: "Unexpected token < in JSON", status: "error" }).action).toBe("retry");
  });

  it("says the server did not answer when it was offline", () => {
    expect(failed({ error: "x", status: "offline" }).reason).toMatch(/did not answer/);
  });
});

describe("buildPerturbationEvidence — embedding coverage", () => {
  it("counts the residues that have a measurement", () => {
    const e = build({ result: { ...NAE1_RESULT, esm3Eval: { perturbationScores: [-1, -1, 0.2, 0, 0.3] } } }).esm3!;
    expect(e.coverage).toEqual({ measured: 3, total: 5 });
  });
});
