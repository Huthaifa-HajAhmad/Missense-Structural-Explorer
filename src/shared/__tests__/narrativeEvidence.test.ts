import { describe, expect, it } from "vitest";
import {
  NARRATIVE_DEEP_EVIDENCE,
  NARRATIVE_EVIDENCE_CONTRACT_VERSION,
  buildNarrativeEvidenceContract,
  canonicalNarrativeEvidence,
  narrativeDeepEvidenceStatus,
  narrativeEvidenceDigest,
  narrativeEvidenceRevision,
  narrativeEvidenceSourceFromResult,
  narrativeFreshness,
  pipelineRunIdOf,
  planNarrativeSynthesis,
  readNarrativeEvidenceStamp,
  withNarrativeEvidenceStamp,
  type NarrativeEvidenceSourceInput,
} from "../narrativeEvidence";
import { DEEP_EVIDENCE_MODEL_IDS, deepModelEvidenceFor } from "../deepModelEvidence";

/**
 * The narrative evidence contract.
 *
 * The load-bearing assertions here are (1) a FAILED source does not hash as an ABSENT one — the defect
 * that let a narrative written for a ClinVar timeout be served to a run that never queried ClinVar —
 * and (2) the client's request and the server's received body produce one revision, or the contract is
 * decoration.
 */

const IDENTITY = { gene: "PAH", variant: "p.Arg408Trp", uniprotId: "P00439" };

const EVIDENCE: NarrativeEvidenceSourceInput = {
  clinvar: { classification: "Pathogenic", uid: "12345" },
  predictorData: { caddPhred: 27.4, amClass: "likely_pathogenic" },
  conservationData: { revel: 0.81 },
  stringInteractions: [{ partner: "GCH1", score: 0.91 }],
  gnomadConstraint: { pli: 0.98 },
  gnomadFrequency: { groupMaxAF: 0.00001 },
  aouFrequency: { aouAC: 3, aouAN: 100000 },
  aouLookup: { localTable: "found", remoteDbnsfp: "not-reported" },
  uniprotFeatures: { features: [] },
  sequence: "MSTAVL",
};

describe("narrativeEvidence — the contract", () => {
  it("distinguishes a failed source from an absent one", () => {
    const neverAsked = buildNarrativeEvidenceContract({ ...EVIDENCE, serviceStatus: undefined });
    const notAsked = buildNarrativeEvidenceContract({ ...EVIDENCE, serviceStatus: {} });
    const timedOut = buildNarrativeEvidenceContract({ ...EVIDENCE, serviceStatus: { clinvar: "timeout" } });
    const held = buildNarrativeEvidenceContract({ ...EVIDENCE, serviceStatus: { clinvar: "ok" } });

    const revisions = [neverAsked, notAsked, timedOut, held].map(narrativeEvidenceRevision);
    // The first two ARE the same evidence ("no outcome was recorded"); the last two are not, and
    // neither is equal to them. `clinvarPresence` says `unqueried` for the first pair and `unread`
    // for the timeout, so a shared revision would serve prose written for the other state.
    expect(revisions[0]).toBe(revisions[1]);
    expect(new Set(revisions).size).toBe(3);
    expect(revisions[2]).not.toBe(revisions[0]);
    expect(revisions[3]).not.toBe(revisions[2]);
  });

  it("carries the contract version inside the revision and the canonical string", () => {
    const contract = buildNarrativeEvidenceContract(EVIDENCE);
    expect(narrativeEvidenceRevision(contract)).toMatch(
      new RegExp(`^nev${NARRATIVE_EVIDENCE_CONTRACT_VERSION}:[0-9a-f]{32}$`)
    );

    // A version bump must invalidate a cached narrative by construction, even with identical evidence.
    const bumped = { ...contract, contractVersion: contract.contractVersion + 1 };
    expect(canonicalNarrativeEvidence(bumped)).not.toBe(canonicalNarrativeEvidence(contract));
    expect(narrativeEvidenceRevision(bumped)).not.toBe(narrativeEvidenceRevision(contract));
  });

  it("is a pure function of the evidence, not of key order or omission style", () => {
    const orderedA = buildNarrativeEvidenceContract({
      clinvar: EVIDENCE.clinvar,
      predictorData: EVIDENCE.predictorData,
      sequence: EVIDENCE.sequence,
    });
    const orderedB = buildNarrativeEvidenceContract({
      sequence: EVIDENCE.sequence,
      predictorData: EVIDENCE.predictorData,
      clinvar: EVIDENCE.clinvar,
    });
    expect(narrativeEvidenceRevision(orderedA)).toBe(narrativeEvidenceRevision(orderedB));

    // "omitted" and "explicitly null" are the same absence, so a payload that drops a key and one
    // that sends null cannot produce two cache entries for one run.
    const omitted = buildNarrativeEvidenceContract({ sequence: "MSTAVL" });
    const explicit = buildNarrativeEvidenceContract({ sequence: "MSTAVL", clinvar: null });
    expect(narrativeEvidenceRevision(omitted)).toBe(narrativeEvidenceRevision(explicit));
  });

  it("changes when a value changes", () => {
    const base = buildNarrativeEvidenceContract(EVIDENCE);
    const other = buildNarrativeEvidenceContract({ ...EVIDENCE, conservationData: { revel: 0.4 } });
    expect(narrativeEvidenceDigest(other)).not.toBe(narrativeEvidenceDigest(base));
  });

  it("gives the client's request and the server's received body one revision", () => {
    const plan = planNarrativeSynthesis(IDENTITY, EVIDENCE, {
      userDirections: "focus on the active site",
      acmgWeighting: "strict-structural",
    });

    /*
     * The request survives JSON unchanged, so the revision the client stamps is the revision its
     * evidence describes.
     *
     * The ROUTE hashes a hand-written list of the contract's fields rather than the body wholesale,
     * so the list must name every field `NARRATIVE_EVIDENCE_FIELDS` declares. That side is pinned
     * where it can fail: `server/routes/variant/narrativeEvidenceHash.test.ts`.
     */
    const received = buildNarrativeEvidenceContract(JSON.parse(JSON.stringify(plan.request)));

    expect(narrativeEvidenceRevision(received)).toBe(plan.revision);
    expect(canonicalNarrativeEvidence(received)).toBe(canonicalNarrativeEvidence(plan.contract));
  });

  it("states the identity and instructions beside the evidence, not inside it", () => {
    const plan = planNarrativeSynthesis(IDENTITY, EVIDENCE, { userDirections: "x", acmgWeighting: "standard" });
    expect(plan.request).toMatchObject({
      gene: "PAH",
      variant: "p.Arg408Trp",
      uniprotId: "P00439",
      userDirections: "x",
      acmgWeighting: "standard",
    });
    expect(plan.request.serviceStatus).toBeNull();
    // Instructions are not evidence: changing them must not move the evidence revision.
    const other = planNarrativeSynthesis(IDENTITY, EVIDENCE, { userDirections: "y", acmgWeighting: "standard" });
    expect(other.revision).toBe(plan.revision);
  });

  it("reads the evidence and the run identity off a result object in one place", () => {
    const result = {
      ...EVIDENCE,
      metadata: { sequence: "PKLMN", serviceStatus: { clinvar: "timeout" }, pipelineRunId: "7:1700" },
      serviceStatus: { clinvar: "timeout" },
    };
    const source = narrativeEvidenceSourceFromResult(result);
    expect(source.sequence).toBe("PKLMN");
    expect(source.serviceStatus).toEqual({ clinvar: "timeout" });
    expect(pipelineRunIdOf(result)).toBe("7:1700");

    // A result with no metadata still yields a contract rather than throwing.
    expect(narrativeEvidenceRevision(buildNarrativeEvidenceContract(narrativeEvidenceSourceFromResult(null)))).toMatch(
      /^nev\d+:/
    );
    expect(pipelineRunIdOf({})).toBeNull();
  });
});

describe("narrativeEvidence — the stamp and freshness", () => {
  const result = {
    ...EVIDENCE,
    metadata: { serviceStatus: { clinvar: "ok" }, pipelineRunId: "3:1700" },
  };
  const revision = narrativeEvidenceRevision(
    buildNarrativeEvidenceContract(narrativeEvidenceSourceFromResult(result))
  );

  it("round-trips through metadata and reports current", () => {
    const stamped = withNarrativeEvidenceStamp(result as any, {
      contractVersion: NARRATIVE_EVIDENCE_CONTRACT_VERSION,
      revision,
      synthesizedAt: 1_700_000_000_000,
      pipelineRunId: "3:1700",
      deepEvidenceIntegrated: false,
    });
    expect(readNarrativeEvidenceStamp(stamped)?.revision).toBe(revision);
    // `metadata` is the field the analysis response schema passes through, so the stamp reaches the
    // client; the original result is not mutated.
    expect(readNarrativeEvidenceStamp(result)).toBeNull();
    expect(narrativeFreshness(stamped)).toBe("current");
  });

  it("reports outdated when the evidence has moved on", () => {
    const stamped = withNarrativeEvidenceStamp(result as any, {
      contractVersion: NARRATIVE_EVIDENCE_CONTRACT_VERSION,
      revision,
      synthesizedAt: 1,
      deepEvidenceIntegrated: true,
    });

    // Evidence the synthesis WAS given changing underneath it.
    expect(narrativeFreshness({ ...stamped, clinvar: { classification: "Benign" } })).toBe("outdated");
    expect(
      narrativeFreshness({
        ...stamped,
        metadata: { ...stamped.metadata, serviceStatus: { clinvar: "timeout" } },
      })
    ).toBe("outdated");

    /*
     * A deep-model reading that arrived after the request is now part of the evidence too: the
     * synthesis was planned without it, and saying so is the whole point of the integration rather than
     * a side effect of it.
     */
    expect(narrativeFreshness({ ...stamped, foldingDdG: 2.85 })).toBe("outdated");
    expect(narrativeFreshness({ ...stamped, esm2Eval: { llr: -3.1 } })).toBe("outdated");

    /*
     * ...but an artefact that is NOT narrative evidence does not make it outdated: a structure download,
     * a multimer assembly or a landscape scan does not change what the prose was written from, and a
     * status surface that refreshed on those would re-synthesize for nothing.
     */
    expect(narrativeFreshness({ ...stamped, pdbText: "ATOM", multimerData: { chains: 2 } })).toBe("current");
  });

  it("reports outdated for a narrative written under an older contract", () => {
    const stamped = withNarrativeEvidenceStamp(result as any, {
      contractVersion: NARRATIVE_EVIDENCE_CONTRACT_VERSION - 1,
      revision,
      synthesizedAt: 1,
      deepEvidenceIntegrated: false,
    });
    expect(narrativeFreshness(stamped)).toBe("outdated");
  });

  it("reports unrecorded rather than guessing, for a payload with no stamp", () => {
    expect(narrativeFreshness(result)).toBe("unrecorded");
    expect(narrativeFreshness({ metadata: { narrativeEvidence: { revision: "" } } })).toBe("unrecorded");
    expect(narrativeFreshness(null)).toBe("unrecorded");
  });
});

describe("narrativeEvidence — deep-model evidence is integrated, and its identity is in the hash", () => {
  it("declares the models a synthesis is given, from the projection's own labels", () => {
    expect(NARRATIVE_DEEP_EVIDENCE.integrated).toBe(true);
    // One label per model id, so the rail cannot advertise a model the prompt block does not print.
    expect(Object.keys(NARRATIVE_DEEP_EVIDENCE.sources).sort()).toEqual(
      [...DEEP_EVIDENCE_MODEL_IDS].sort()
    );
  });

  it("moves the revision when the deep-model block changes", () => {
    const withoutDeep = buildNarrativeEvidenceContract({ ...EVIDENCE });
    const withDeep = buildNarrativeEvidenceContract({
      ...EVIDENCE,
      deepEvidence: {
        version: 1,
        observations: [
          {
            id: "foldx",
            source: "FoldX folding stability (ΔΔG)",
            state: "computed",
            value: 2.62,
            unit: "kcal/mol",
            call: "Destabilizing",
            provenance: "Experimental structure · 1ABC",
            note: null,
          },
        ],
      },
    });

    expect(narrativeEvidenceRevision(withDeep)).not.toBe(narrativeEvidenceRevision(withoutDeep));
    // The canonical form is order-insensitive: the same observation listed later is the same evidence.
    const twoRows = buildNarrativeEvidenceContract({
      ...EVIDENCE,
      deepEvidence: {
        version: 1,
        observations: [
          { id: "thermompnn", source: "ThermoMPNN ΔΔG", state: "no-result", value: null, unit: null, call: null, provenance: null, note: null },
          { id: "foldx", source: "FoldX folding stability (ΔΔG)", state: "computed", value: 2.62, unit: "kcal/mol", call: "Destabilizing", provenance: "Experimental structure · 1ABC", note: null },
        ],
      },
    });
    expect(canonicalNarrativeEvidence(twoRows)).toContain("foldx");
    expect(narrativeEvidenceRevision(twoRows)).not.toBe(narrativeEvidenceRevision(withDeep));
  });

  it("round-trips the deep block through the request body the server hashes", () => {
    const deepEvidence = deepModelEvidenceFor(
      { foldingEnergetics: { foldx: 2.62 } } as any,
      { stability: { foldingEnergetics: { foldx: 2.62 } } }
    );
    const plan = planNarrativeSynthesis(IDENTITY, EVIDENCE, { deepEvidence });
    const received = buildNarrativeEvidenceContract(JSON.parse(JSON.stringify(plan.request)));
    expect(received.deepEvidence).toBe(plan.contract.deepEvidence);
    expect(narrativeEvidenceRevision(received)).toBe(plan.revision);
    expect(plan.request.deepEvidence).toEqual(deepEvidence);
  });

  it("reports the observations a result carries, from the same projection the prompt uses", () => {
    const status = narrativeDeepEvidenceStatus({
      foldingEnergetics: { foldx: 2.62, dynamut2: -1.4, raspSource: "experimental" },
      dynamut2Status: "done",
      esm2Eval: { llr: -3.2 },
    });
    expect(status.integrated).toBe(true);
    expect(status.present).toContain("FoldX folding stability (ΔΔG)");
    expect(status.present).toContain("ESM-2 variant-effect ΔLLR");
    // The engine that returned nothing is still named: the prompt lists it so the model cannot infer a
    // value for it, and the rail must therefore not present it as absent from the synthesis.
    expect(status.present).toContain("RaSP ΔΔG (precomputed table)");
    expect(status.excluded).toEqual([]);
  });
});
