import { describe, it, expect } from "vitest";
import { buildFunctionEvidence } from "../functionEvidence";
import { NAE1_INPUT, NAE1_UNIPROT } from "./fixtures/nae1FunctionalDomains";

describe("buildFunctionEvidence — NAE1 p.Asp116Gly", () => {
  const ev = buildFunctionEvidence(NAE1_INPUT);

  it("reads PM1 from the engine record: not met, and nothing specific covers 116", () => {
    expect(ev.verdict).toBe("not-met");
    expect(ev.verdictLabel).toBe("PM1 not met");
    expect(ev.verdictUnconfirmed).toBe(false);
    expect(ev.engineMismatch).toBeNull();
    expect(ev.atResidue.filter((r) => r.group !== "domains")).toHaveLength(0);
  });

  it("draws the Pfam ThiF fold as the domain, with Gene3D as structural segments", () => {
    expect(ev.domains.map((d) => `${d.source} ${d.accession}`)).toEqual(["Pfam PF00899"]);
    expect(ev.domains[0].covers).toBe(true);
    expect(ev.structuralDomains[0].segments).toEqual([{ start: 2, end: 289 }, { start: 376, end: 534 }]);
    // CDD, PANTHER, PIRSF and SUPFAM are family-level: listed, not drawn.
    expect(ev.familyMatches.map((m) => m.source).sort()).toEqual(["CDD", "PANTHER", "PIRSF", "SUPFAM"]);
  });

  it("never calls the residue inter-domain, and flags a fold covering 97% of the protein as uninformative", () => {
    expect(ev.finding.lead).toContain("inside the THIF-type NAD/FAD binding fold (Pfam, 13–530)");
    expect(JSON.stringify(ev)).not.toMatch(/inter-domain/i);
    expect(ev.caveats[0].lead).toContain("97%");
  });

  it("places 116 in the two-residue link between helices 109–114 and 117–122", () => {
    expect(ev.structureContext?.value).toBe("Between helices");
    expect(ev.finding.rest).toContain("2-residue link between helices 109–114 and 117–122");
  });

  it("names R85Q as the nearest disease variant, 31 aa upstream, and keeps the dbSNP polymorphism off the schematic", () => {
    expect(ev.nearestDiseaseVariant?.shortLabel).toBe("R85Q");
    expect(ev.nearestDiseaseVariant?.distance).toBe(-31);
    const poly = ev.rows.find((r) => r.start === 101);
    expect(poly?.disease).toBe(false);
    expect(poly?.lane).toBe("none");
  });

  it("classifies the UBA3 region as a functional region, not disorder", () => {
    const region = ev.rows.find((r) => r.type === "Region");
    expect(region?.group).toBe("sites");
    expect(region?.lane).toBe("region");
  });

  it("keeps each annotation's evidence level (K341 acetylation is by similarity)", () => {
    const k341 = ev.rows.find((r) => r.start === 341 && r.group === "modifications");
    expect(k341?.evidenceLabel).toBe("By similarity");
    expect(k341?.shortLabel).toBe("K341ac");
    expect(ev.rows.find((r) => r.type === "Site")?.evidenceLabel).toBe("No evidence cited");
  });

  it("lists what UniProt does not annotate, and sources from the payload", () => {
    expect(ev.notAnnotated).toContain("active sites");
    expect(ev.notAnnotated).not.toContain("domains");
    expect(ev.sources.map((s) => s.label)).toContain("InterPro via UniParc");
    expect(JSON.stringify(ev.sources)).not.toMatch(/v2024|Swiss-Prot Verified/);
  });
});

describe("buildFunctionEvidence — states and the engine", () => {
  it("is Running while the record is in flight and claims no absence", () => {
    const ev = buildFunctionEvidence({ ...NAE1_INPUT, uniprot: null, serviceStatus: "pending" });
    expect(ev.availability.label).toBe("Running");
    expect(ev.verdict).toBe("not-assessed");
    expect(ev.notAnnotated).toEqual([]);
  });

  it("is a provider error after a timeout", () => {
    const ev = buildFunctionEvidence({ ...NAE1_INPUT, uniprot: null, serviceStatus: "timeout" });
    expect(ev.availability.label).toBe("Provider error");
  });

  it("marks the chip unconfirmed when the payload has no engine record", () => {
    const ev = buildFunctionEvidence({ ...NAE1_INPUT, engineCriteria: null });
    expect(ev.verdictUnconfirmed).toBe(true);
  });

  it("says the payload was classified by an earlier engine when PM1 was recorded but the rule no longer finds a site", () => {
    const ev = buildFunctionEvidence({ ...NAE1_INPUT, engineCriteria: [{ code: "PM1" }] });
    expect(ev.verdict).toBe("met");
    expect(ev.engineMismatch).toContain("earlier engine");
  });

  it("says InterPro was not read when UniParc failed", () => {
    const ev = buildFunctionEvidence({ ...NAE1_INPUT, uniprot: { ...NAE1_UNIPROT, domainMatches: [], domainMatchesStatus: "error" } });
    expect(ev.interproMissing).toBe(true);
    expect(ev.domains).toHaveLength(0);
    expect(ev.finding.lead).toBe("UniProtKB annotates nothing at residue 116.");
  });

  it("finds a PM1 site from an experimentally evidenced disulfide cysteine only at the cysteine", () => {
    const uniprot = { ...NAE1_UNIPROT, features: [{ type: "Disulfide bond", description: "", start: 100, end: 130, evidence: [{ code: "ECO:0000269" }] }] };
    expect(buildFunctionEvidence({ ...NAE1_INPUT, residue: 116, uniprot, engineCriteria: null }).pm1.status).toBe("not-met");
    expect(buildFunctionEvidence({ ...NAE1_INPUT, residue: 130, uniprot, engineCriteria: null }).pm1.status).toBe("met");
  });
});

describe("buildFunctionEvidence — SLC12A4 p.Gln867His (membrane transporter audit)", () => {
  const ENS = [{ code: "ECO:0000269", source: "PubMed", id: "31649201" }];
  const uniprot = {
    ...NAE1_UNIPROT,
    sequenceLength: 1085,
    domainMatches: [],
    secondaryStructure: [
      { kind: "helix" as const, start: 855, end: 866, pdb: "6KKR" },
      { kind: "helix" as const, start: 869, end: 871, pdb: "6KKR" },
    ],
    features: [
      { type: "Topological domain", description: "Cytoplasmic", start: 652, end: 1085, evidence: ENS },
      { type: "Transmembrane", description: "Helical; Name=4", start: 249, end: 271, evidence: ENS },
      { type: "Transmembrane", description: "Discontinuously helical; Name=1", start: 120, end: 141, evidence: ENS },
      { type: "Binding site", description: "Ligand: K(+)", start: 131, end: 131, evidence: ENS },
    ],
  };
  const ev = buildFunctionEvidence({ ...NAE1_INPUT, residue: 867, wildType: "Gln", mutant: "His", uniprot, engineCriteria: [] });

  it("tidies UniProt's machine names for display", () => {
    expect(ev.rows.find((r) => r.start === 249)?.name).toBe("TM4");
    expect(ev.rows.find((r) => r.start === 120)?.name).toBe("TM1 (discontinuous)");
    expect(ev.rows.find((r) => r.start === 131)?.name).toBe("K⁺ binding");
  });

  it("treats a broad topological span as context, not an annotation at the residue", () => {
    expect(ev.finding.lead).not.toMatch(/carries one annotation/);
    expect(ev.finding.rest).toContain("a broad span rather than a site");
    expect(ev.verdict).toBe("not-met");
  });

  it("summarises the topology group", () => {
    expect(ev.groups.find((g) => g.group === "topology")?.summary).toBe("2 transmembrane segments");
  });

  it("calls a two-residue gap a link, but never a long unassigned stretch", () => {
    expect(ev.finding.rest).toContain("2-residue link between helices");
    const far = buildFunctionEvidence({ ...NAE1_INPUT, residue: 900, uniprot, engineCriteria: [] });
    expect(far.structureContext?.value).toBe("Terminal, no regular structure");
    const gap = buildFunctionEvidence({
      ...NAE1_INPUT,
      residue: 500,
      uniprot: { ...uniprot, secondaryStructure: [{ kind: "helix" as const, start: 400, end: 410, pdb: "6KKR" }, { kind: "helix" as const, start: 600, end: 620, pdb: "6KKR" }] },
      engineCriteria: [],
    });
    expect(gap.structureContext?.value).toBe("No helix or strand assigned");
    expect(gap.finding.rest).not.toContain("link between");
  });

  it("does not read an absent disease-variant list as a negative finding", () => {
    expect(ev.facts.find((f) => f.label === "Disease variants")?.value).toBe("None in UniProtKB");
  });
});

describe("buildFunctionEvidence — context for PM1 and mutagenesis at the residue", () => {
  it("D2: names mutagenesis at the residue itself and says it is not counted", () => {
    const ev = buildFunctionEvidence({ ...NAE1_INPUT, residue: 331, engineCriteria: [] });
    expect(ev.finding.rest).toContain("mutagenesis at this residue");
    expect(ev.finding.rest).toContain("not counted for PM1");
    expect(ev.verdict).toBe("not-met");
  });

  it("D1: reports the regional missense O/E as context, with no cut-point and no effect on PM1", () => {
    const withRc = buildFunctionEvidence({ ...NAE1_INPUT, regionalConstraint: { isConstrained: true, oeRatio: 0.88, regionText: "600–900" } });
    const caveat = withRc.caveats.find((c) => c.lead.startsWith("Benign variation in the region is not tested"));
    expect(caveat?.rest).toContain("0.88");
    expect(caveat?.rest).toContain("It is not used by PM1");
    expect(withRc.verdict).toBe(buildFunctionEvidence(NAE1_INPUT).verdict);
    expect(buildFunctionEvidence({ ...NAE1_INPUT, regionalConstraint: null }).caveats.some((c) => c.lead.includes("Benign variation"))).toBe(false);
  });

  it("numbers unnamed transmembrane helices by position and says the number is ours", () => {
    const tm = (s: number, e: number) => ({ type: "Transmembrane", description: "Helical", start: s, end: e, evidence: [] });
    const ev = buildFunctionEvidence({ ...NAE1_INPUT, uniprot: { ...NAE1_UNIPROT, features: [tm(300, 320), tm(100, 120)] }, engineCriteria: [] });
    const rows = ev.rows.filter((r) => r.type === "Transmembrane").sort((a, b) => a.start - b.start);
    expect(rows.map((r) => r.name)).toEqual(["TM1", "TM2"]);
    expect(rows[0].note).toBe("Transmembrane, numbered here by position");
    expect(rows.every((r) => r.lane === "membrane")).toBe(true);
  });
});
