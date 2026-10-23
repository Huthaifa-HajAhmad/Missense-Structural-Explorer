import { describe, it, expect } from "vitest";
import {
  buildStructure3dEvidence,
  plddtBand,
  pdbIdFromUrl,
  STRUCTURE_ENGINE_RECORD,
  type Structure3dInput,
} from "../structure3dEvidence";
import { scanBFactors, readResidueAt, identifyAlphaFoldHeader, plddtScale, isSitePair } from "../coordinateText";
import { LOCAL_ALIGNMENT_FIT_WINDOW, THRESHOLDS } from "../thresholds";
import { LEGACY_ENGINE_LABELS } from "../engineStatus";

/**
 * The 3D view's contract, on the variant from the audit's screenshots: NAE1 p.Asp116Gly
 * (Q13564, 534 aa). The pipeline's wild type is the AlphaFold DB model; FoldX built the variant on
 * PDB 1YOV chain A; the RCSB search listed 1YOV and 9QN5.
 */

function atom(serial: number, name: string, res: string, chain: string, seq: number, b: number): string {
  const x = (seq * 1.5).toFixed(3).padStart(8);
  return (
    "ATOM  " +
    String(serial).padStart(5) +
    " " +
    name.padEnd(4) +
    " " +
    res.padEnd(3) +
    " " +
    chain +
    String(seq).padStart(4) +
    "    " +
    x +
    "   0.000   0.000" +
    "  1.00" +
    b.toFixed(2).padStart(6) +
    "           C"
  );
}

/** A small AlphaFold-style file: header, residues 114–118, ASP at 116 with pLDDT 92.3. */
const AF_TEXT = [
  "TITLE     ALPHAFOLD MONOMER V2.0 PREDICTION FOR NEDD8-ACTIVATING ENZYME E1 REGULATORY SUBUNIT (Q13564)",
  atom(1, "CA", "LEU", "A", 114, 88.1),
  atom(2, "CA", "SER", "A", 115, 90.4),
  atom(3, "N", "ASP", "A", 116, 92.0),
  atom(4, "CA", "ASP", "A", 116, 92.3),
  atom(5, "CA", "GLY", "A", 117, 71.0),
  atom(6, "CA", "LYS", "A", 118, 45.2),
].join("\n");

/** A crystal chain: temperature factors, not pLDDT. ASP 116 carries B = 94.5 Å². */
const CRYSTAL_TEXT = [
  atom(1, "CA", "LEU", "A", 114, 31.0),
  atom(2, "CA", "SER", "A", 115, 40.2),
  atom(3, "CA", "ASP", "A", 116, 94.5),
  atom(4, "CA", "GLY", "A", 117, 52.8),
  atom(5, "CA", "LYS", "A", 118, 60.1),
].join("\n");

/** ESM Atlas style: pLDDT on 0–1. */
const ATLAS_TEXT = [atom(1, "CA", "ASP", "A", 116, 0.81), atom(2, "CA", "GLY", "A", 117, 0.64)].join("\n");

function baseInput(overrides: Partial<Structure3dInput> = {}): Structure3dInput {
  return {
    family: "alphafold",
    viewMode: "wildtype",
    representation: "confidence",
    variant: { position: 116, wildType: "Asp", mutant: "Gly", uniprotId: "Q13564", gene: "NAE1" },
    selectedResidue: null,
    wildType: {
      provenance: { source: "alphafold", afdbVersion: "v6" },
      customPdbUrl: null,
      scan: scanBFactors(AF_TEXT),
      site: readResidueAt(AF_TEXT, 116),
    },
    foldx: {
      running: false,
      phaseLabel: null,
      status: "success",
      error: null,
      ddG: 2.62,
      ddGSd: 0.11,
      runs: 5,
      template: { source: "experimental", pdbId: "1YOV", chainId: "A" },
      repairSkipped: false,
      repairSkippedReason: null,
      repairFailed: false,
      reference: { state: "idle", reason: null, provenance: null },
      aligned: false,
      referenceSite: null,
    },
    deNovo: {
      folding: false,
      error: null,
      wildTypeLoaded: false,
      variantLoaded: false,
      singleStructure: false,
      engines: null,
      scan: null,
      aligned: false,
      site: null,
    },
    alignmentScope: "global",
    metrics: null,
    esm3: null,
    region: null,
    burial: null,
    homologs: [
      { pdbId: "1YOV", organism: "Homo sapiens", method: "X-RAY DIFFRACTION", resolution: 2.6, identity: 100, querySeqFrom: 1, querySeqTo: 534 },
      { pdbId: "9QN5", organism: "Homo sapiens", method: "ELECTRON MICROSCOPY", resolution: 1.97, identity: null, querySeqFrom: null, querySeqTo: null },
    ],
    homologsLoading: false,
    ...overrides,
  };
}

const readyFoldx = (): Structure3dInput["foldx"] => ({
  ...baseInput().foldx,
  reference: { state: "ready", reason: null, provenance: { source: "experimental", pdbId: "1YOV", chainId: "A" } },
  aligned: true,
});

const NAE1_METRICS = {
  localWindowRmsd: 0,
  globalRmsd: 0,
  maxCaDisplacement: 0,
  wtChi1: -65.2,
  mutChi1: null,
  chi1Deviation: null,
  wtSasa: 41.3,
  mutSasa: 12.8,
  lostHBonds: 2,
  gainedHBonds: 0,
  lostContacts: 3,
  gainedContacts: 0,
};

describe("coordinateText", () => {
  it("reads Cα B-factors and their quartiles without interpreting them", () => {
    const scan = scanBFactors(CRYSTAL_TEXT);
    expect(scan.count).toBe(5);
    expect(scan.max).toBe(94.5);
    expect(scan.quartiles).not.toBeNull();
  });

  it("reads the residue and its Cα B at a position", () => {
    expect(readResidueAt(AF_TEXT, 116)).toEqual({ resName: "ASP", chain: "A", caBFactor: 92.3 });
    expect(readResidueAt(AF_TEXT, 999)).toBeNull();
  });

  it("identifies AlphaFold only from header records, never from an 'AF-' substring in atoms", () => {
    expect(identifyAlphaFoldHeader(AF_TEXT)).toEqual({ version: "v2.0" });
    expect(identifyAlphaFoldHeader(CRYSTAL_TEXT)).toBeNull();
    expect(identifyAlphaFoldHeader(atom(1, "CA", "ALA", "A", 1, 70) + " AF-")).toBeNull();
  });

  it("accepts a wild-type/variant pair only when they differ at the site alone", () => {
    const wt = [atom(1, "CA", "SER", "A", 115, 40), atom(2, "CA", "ASP", "A", 116, 50), atom(3, "CA", "GLY", "A", 117, 60)].join("\n");
    const variant = wt.replace("ASP A 116", "GLY A 116");
    expect(isSitePair(wt, variant, 116, "A")).toBe(true);
    // Another variant's run: the substitution sits elsewhere.
    expect(isSitePair(wt, wt.replace("SER A 115", "ALA A 115"), 116, "A")).toBe(false);
    // A different construct: one residue fewer.
    expect(isSitePair(wt, variant.split("\n").slice(0, 2).join("\n"), 116, "A")).toBe(false);
    // A calcium ion is not a residue.
    expect(isSitePair(wt + "\nHETATM    9 CA    CA A 301       0.000   0.000   0.000  1.00 20.00          CA", variant, 116, "A")).toBe(true);
  });

  it("reads a 0–1 pLDDT scale (ESM Atlas) apart from 0–100", () => {
    expect(plddtScale(scanBFactors(ATLAS_TEXT))).toBe(1);
    expect(plddtScale(scanBFactors(AF_TEXT))).toBe(100);
  });
});

describe("pLDDT bands follow AlphaFold DB / Mol* edges", () => {
  it("is exclusive below each edge", () => {
    expect(plddtBand(90).label).toBe("Confident");
    expect(plddtBand(90.1).label).toBe("Very high");
    expect(plddtBand(50).label).toBe("Very low");
    expect(plddtBand(70.5).label).toBe("Confident");
  });
});

describe("structure3dEvidence — NAE1 p.Asp116Gly, AlphaFold view", () => {
  it("names the AlphaFold model on the canvas, not FoldX's 1YOV template", () => {
    const m = buildStructure3dEvidence(baseInput());
    expect(m.canvas.primary?.origin).toBe("afdb");
    expect(m.canvas.chip.label).toBe("AF-Q13564-F1 v6");
    expect(m.canvas.chip.label).not.toContain("1YOV");
    expect(m.canvas.chip.tone).toBe("predicted");
  });

  it("reports AlphaFold DB coverage from the protein length, and leaves it unknown otherwise", () => {
    expect(buildStructure3dEvidence(baseInput()).alphaFold).toEqual({ coverage: "unknown", residues: null });
    expect(buildStructure3dEvidence(baseInput({ proteinLength: 534 })).alphaFold).toEqual({
      coverage: "within-limit",
      residues: 534,
    });
    // PKD1: no full-length AlphaFold DB model can exist, whatever the lookup returns.
    expect(buildStructure3dEvidence(baseInput({ proteinLength: 4302 })).alphaFold).toEqual({
      coverage: "beyond-limit",
      residues: 4302,
    });
  });

  it("colours the AlphaFold model with AlphaFold DB's published pLDDT bands and allows the pLDDT filter", () => {
    const m = buildStructure3dEvidence(baseInput());
    expect(m.representation).toBe("confidence");
    expect(m.colour.primary).toEqual({ theme: "plddt", scale: 100 });
    expect(m.legend?.provenance).toBe("published");
    expect(m.plddtFilter.available).toBe(true);
  });

  it("reads site pLDDT from the displayed AlphaFold model", () => {
    const m = buildStructure3dEvidence(baseInput());
    expect(m.site.confidence.kind).toBe("plddt");
    expect(m.site.confidence.text).toBe("pLDDT 92.3 · very high");
    expect(m.site.check.state).toBe("match");
    expect(m.site.substitution).toBe("Asp116Gly");
  });

  it("colours experimental B-factors relatively without claiming an unverified site value", () => {
    const m = buildStructure3dEvidence(
      baseInput({
        wildType: {
          provenance: { source: "experimental", pdbId: "1YOV", chainId: "A", resolution: 2.6 },
          customPdbUrl: null,
          scan: scanBFactors(CRYSTAL_TEXT),
          site: readResidueAt(CRYSTAL_TEXT, 116),
        },
      })
    );
    expect(m.site.confidence.kind).toBe("none");
    expect(m.site.canAddressVariantSite).toBe(false);
    expect(JSON.stringify(m.site)).not.toMatch(/pLDDT/);
    expect(m.colour.primary).toEqual({ theme: "bfactor-quartile" });
    expect(m.legend?.provenance).toBe("relative");
    expect(m.plddtFilter.available).toBe(false);
    expect(m.plddtFilter.reason).toMatch(/most mobile atoms/);
  });

  it("describes the FoldX variant by its template and its copied B-factor column", () => {
    const m = buildStructure3dEvidence(baseInput({ viewMode: "mutant" }));
    expect(m.viewMode).toBe("mutant");
    expect(m.canvas.primary?.origin).toBe("foldx-variant");
    expect(m.canvas.primary?.name).toBe("FoldX variant on PDB 1YOV chain A");
    expect(m.canvas.primary?.channel).toMatchObject({ kind: "temperature-factor", inherited: true });
    expect(m.representations.find(r => r.id === "confidence")?.label).toBe("Template B-factor (copied)");
    expect(m.plddtFilter.available).toBe(false);
    expect(m.notices.map(n => n.key)).toContain("template");
  });

  it("keeps the superposition unavailable until the variant is paired with its own template", () => {
    const pending = buildStructure3dEvidence(baseInput({ viewMode: "superimposed" }));
    expect(pending.modes.find(x => x.id === "superimposed")?.available).toBe(false);
    expect(pending.viewMode).toBe("wildtype");

    const failed = buildStructure3dEvidence(
      baseInput({
        viewMode: "superimposed",
        foldx: { ...baseInput().foldx, reference: { state: "unavailable", reason: "The server resolved PDB 2ABC, not FoldX's 1YOV.", provenance: null } },
      })
    );
    expect(failed.modes.find(x => x.id === "superimposed")?.reason).toBe("The server resolved PDB 2ABC, not FoldX's 1YOV.");
    expect(failed.comparison.state).toBe("unavailable");
  });

  it("pairs the FoldX variant with 1YOV, not with the AlphaFold wild type, and never offers a rigid-backbone displacement map", () => {
    const m = buildStructure3dEvidence(baseInput({ viewMode: "superimposed", foldx: readyFoldx(), metrics: NAE1_METRICS, representation: "displacement" }));
    expect(m.viewMode).toBe("superimposed");
    expect(m.canvas.primary?.name).toBe("PDB 1YOV chain A");
    expect(m.canvas.secondary?.channel.kind).toBe("temperature-factor");
    expect(m.comparison.state).toBe("ready");
    expect(m.comparison.canvasWildTypeIsNotTemplate).toBe(true);
    const disp = m.representations.find(r => r.id === "displacement");
    expect(disp).toBeUndefined();
    expect(m.representation).toBe("pair");
    expect(m.alignment.scopeToggle).toBe(false);
  });

  it("names FoldX's own paired wild type when the run returned it, and caveats nothing about repair", () => {
    const foldx = { ...readyFoldx(), reference: { ...readyFoldx().reference, basis: "foldx-paired" as const } };
    const m = buildStructure3dEvidence(baseInput({ viewMode: "superimposed", foldx, metrics: NAE1_METRICS }));
    expect(m.canvas.primary?.name).toBe("FoldX wild type on PDB 1YOV chain A");
    expect(m.canvas.primary?.channel.inherited).toBe(true);
    expect(m.comparison.headline).toBe("Variant against FoldX's own wild type on PDB 1YOV chain A");
    expect(m.trace[2].sub).toMatch(/from one run/);
    expect(m.readings.find(r => r.key === "contacts")?.caveat).toBeNull();
  });

  it("warns that an older result's pair counts RepairPDB's side-chain changes", () => {
    const foldx = { ...readyFoldx(), reference: { ...readyFoldx().reference, basis: "template" as const } };
    const m = buildStructure3dEvidence(baseInput({ viewMode: "superimposed", foldx, metrics: NAE1_METRICS }));
    expect(m.canvas.primary?.name).toBe("PDB 1YOV chain A");
    expect(m.trace[2].sub).toMatch(/not repaired/);
    expect(m.readings.find(r => r.key === "contacts")?.caveat).toMatch(/before RepairPDB/);
    expect(m.readings.find(r => r.key === "polar")?.caveat).toMatch(/before RepairPDB/);
  });

  it("states χ1 as not applicable for a glycine instead of printing 0.0°", () => {
    const m = buildStructure3dEvidence(baseInput({ viewMode: "superimposed", foldx: readyFoldx(), metrics: NAE1_METRICS }));
    const chi = m.readings.find(r => r.key === "chi1")!;
    expect(chi.state).toBe("not-applicable");
    expect(chi.value).toBeNull();
    expect(chi.caveat).toMatch(/Gly has no χ1/);
    expect(JSON.stringify(m)).not.toContain("0.0°");
  });

  it("omits FoldX's fixed-backbone geometry rows and keeps measured side-chain changes", () => {
    const m = buildStructure3dEvidence(baseInput({ viewMode: "superimposed", foldx: readyFoldx(), metrics: NAE1_METRICS }));
    expect(m.readings.some(r => ["local-rmsd", "global-rmsd", "max-shift"].includes(r.key))).toBe(false);
    expect(m.readings.find(r => r.key === "sasa")?.value).toBeTruthy();
    expect(m.readings.find(r => r.key === "polar")?.value).toBeTruthy();
  });

  it("calls the 3.5 Å polar-atom count a proxy, not hydrogen bonds", () => {
    const m = buildStructure3dEvidence(baseInput({ viewMode: "superimposed", foldx: readyFoldx(), metrics: NAE1_METRICS }));
    const polar = m.readings.find(r => r.key === "polar")!;
    expect(polar.label).toBe("Polar contacts at the site");
    expect(polar.note).toMatch(/proxy for hydrogen bonds/);
    expect(polar.value).toBe("2 lost · 0 gained");
  });

  it("gives the trace five steps ending in the engine record, with ΔΔG called a stability estimate", () => {
    const m = buildStructure3dEvidence(baseInput());
    expect(m.trace).toHaveLength(5);
    expect(m.trace[4].label).toBe("Engine record");
    expect(m.trace[1].sub).toMatch(/ΔΔG \+2\.62 ± 0\.11 kcal\/mol over 5 runs — a stability estimate, not pathogenicity/);
    expect(m.engineRecord).toBe(STRUCTURE_ENGINE_RECORD);
  });

  it("reports homolog identity and range as not reported rather than inventing them", () => {
    const m = buildStructure3dEvidence(baseInput());
    const qn5 = m.experimental.rows.find(r => r.pdbId === "9QN5")!;
    expect(qn5.identity).toBe("Not reported");
    expect(qn5.coversSite).toBe("unknown");
    expect(m.experimental.best?.pdbId).toBe("1YOV");
  });

  it("does not compare an author-numbered entry position with the UniProt variant site", () => {
    const shifted = CRYSTAL_TEXT.replace(/ASP A 116/, "LEU A 116");
    const m = buildStructure3dEvidence(
      baseInput({
        wildType: {
          provenance: { source: "alphafold", afdbVersion: "v6" },
          customPdbUrl: "/api/v1/pdb/entry/9QN5",
          scan: scanBFactors(shifted),
          site: readResidueAt(shifted, 116),
        },
      })
    );
    expect(m.canvas.primary?.name).toBe("PDB 9QN5");
    expect(m.canvas.primary?.numbering).toBe("entry");
    expect(m.site.check.state).toBe("unknown");
    expect(m.site.canAddressVariantSite).toBe(false);
    expect(m.site.confidence.kind).toBe("none");
    expect(m.notices.map(n => n.key)).toEqual(expect.arrayContaining(["numbering", "entry"]));
  });

  it("withholds site highlights and pLDDT when a numbered model disagrees with the query residue", () => {
    const wrongSite = AF_TEXT.replaceAll("ASP", "LEU");
    const m = buildStructure3dEvidence(baseInput({
      wildType: {
        provenance: { source: "alphafold", afdbVersion: "v6" }, customPdbUrl: null,
        scan: scanBFactors(wrongSite), site: readResidueAt(wrongSite, 116),
      },
    }));
    expect(m.site.check.state).toBe("mismatch");
    expect(m.site.canAddressVariantSite).toBe(false);
    expect(m.site.confidence.kind).toBe("none");
  });

  it("names the chain of an entry the server renumbered to UniProt, and asks for it in the variant's numbering", () => {
    const m = buildStructure3dEvidence(
      baseInput({
        wildType: {
          provenance: { source: "alphafold", afdbVersion: "v6" },
          customPdbUrl: "/api/v1/pdb/entry/9QN5?uniprot=Q13564&pos=116&wt=D",
          entry: { numbering: "uniprot", chainId: "B", mapping: "sifts", unmappedResidues: 6, reason: null },
          scan: scanBFactors(CRYSTAL_TEXT),
          site: readResidueAt(CRYSTAL_TEXT, 116),
        },
      })
    );
    expect(m.canvas.primary?.name).toBe("PDB 9QN5 chain B");
    expect(m.canvas.primary?.numbering).toBe("uniprot");
    expect(m.canvas.primary?.kind).toMatch(/in UniProt numbering \(PDBe SIFTS\)/);
    expect(m.site.check.state).toBe("match");
    expect(m.site.canAddressVariantSite).toBe(true);
    expect(m.site.confidence.kind).toBe("b-factor");
    expect(m.notices.find(n => n.key === "entry")?.body).toMatch(/^Chain B is shown, renumbered to UniProt residue by residue through PDBe's SIFTS mapping/);
    expect(m.notices.find(n => n.key === "entry")?.body).toContain("and so are 6 residues with no UniProt position (tags, linkers or insertions)");
    const row = m.experimental.rows.find(r => r.pdbId === "9QN5")!;
    expect(row.loaded).toBe(true);
    expect(row.url).toBe("/api/v1/pdb/entry/9QN5?uniprot=Q13564&pos=116&wt=D");
  });

  it("says why an entry kept its own numbering", () => {
    const m = buildStructure3dEvidence(
      baseInput({
        wildType: {
          provenance: { source: "alphafold", afdbVersion: "v6" },
          customPdbUrl: "/api/v1/pdb/entry/9QN5?uniprot=Q13564&pos=116&wt=D",
          entry: { numbering: "author", chainId: null, mapping: null, reason: "No chain of 9QN5 carries D116 under a verified mapping to Q13564." },
          scan: scanBFactors(CRYSTAL_TEXT),
          site: readResidueAt(CRYSTAL_TEXT, 116),
        },
      })
    );
    expect(m.canvas.primary?.name).toBe("PDB 9QN5");
    expect(m.canvas.primary?.numbering).toBe("entry");
    expect(m.notices.find(n => n.key === "entry")?.body).toBe(
      "The entry keeps its own residue numbering and all of its chains: no chain of 9QN5 carries D116 under a verified mapping to Q13564. The variant model and the superposition still refer to FoldX's template."
    );
  });
});

describe("structure3dEvidence — ESMFold view", () => {
  const deNovoInput = (engines: { wildType: string | null; variant: string | null } | null, text = ATLAS_TEXT) =>
    baseInput({
      family: "esmfold",
      deNovo: {
        folding: false,
        error: null,
        wildTypeLoaded: true,
        variantLoaded: true,
        singleStructure: false,
        engines,
        scan: scanBFactors(text),
        aligned: true,
        site: readResidueAt(text, 116),
      },
    });

  it("reads ESM Atlas pLDDT on its 0–1 scale and cites ESMFold v1, not ESMFold2", () => {
    const m = buildStructure3dEvidence(deNovoInput({ wildType: "esm-atlas-esmfold", variant: "esm-atlas-esmfold" }));
    expect(m.colour.primary).toEqual({ theme: "plddt", scale: 1 });
    expect(m.site.confidence.text).toBe("pLDDT 81.0 · confident");
    expect(m.sources.map(s => s.doi)).toContain("10.1126/science.ade2574");
    expect(m.sources.map(s => s.doi)).not.toContain("10.64898/2026.06.03.729735");
  });

  it("cites ESMFold2 for the JapanFold engine and never pairs it with Lin et al. 2023", () => {
    const m = buildStructure3dEvidence(deNovoInput({ wildType: "japanfold-esmfold2-fast", variant: "japanfold-esmfold2-fast" }, AF_TEXT));
    expect(m.canvas.primary?.detail).toBe("Folded by ESMFold2-Fast via JapanFold");
    expect(m.sources.map(s => s.doi)).toContain("10.64898/2026.06.03.729735");
    expect(m.sources.map(s => s.doi)).not.toContain("10.1126/science.ade2574");
  });

  it("warns when the wild type and the variant came from different engines", () => {
    const m = buildStructure3dEvidence(deNovoInput({ wildType: "japanfold-esmfold2-fast", variant: "esm-atlas-esmfold" }));
    expect(m.notices.find(n => n.key === "engines")?.tone).toBe("warning");
  });

  it("does not offer a variant or superposition when the server returned one structure", () => {
    const input = deNovoInput(null);
    input.deNovo.singleStructure = true;
    const m = buildStructure3dEvidence({ ...input, viewMode: "superimposed" });
    expect(m.modes.find(x => x.id === "mutant")?.available).toBe(false);
    expect(m.viewMode).toBe("wildtype");
  });

  it("offers the alignment-scope toggle for de novo pairs, with the local-fit caveat", () => {
    const input = deNovoInput({ wildType: "esm-atlas-esmfold", variant: "esm-atlas-esmfold" });
    const m = buildStructure3dEvidence({ ...input, viewMode: "superimposed", alignmentScope: "local", metrics: { localWindowRmsd: 0.4, globalRmsd: 6.1 } });
    expect(m.alignment.scopeToggle).toBe(true);
    expect(m.readings.find(r => r.key === "local-rmsd")?.caveat).toBe(`Measured inside the ±${LOCAL_ALIGNMENT_FIT_WINDOW} fitted window, so small by construction.`);
    expect(m.readings.find(r => r.key === "global-rmsd")?.note).toMatch(/not a whole-chain fit/);
    expect(m.representations.find(r => r.id === "displacement")?.available).toBe(true);
  });

  it("describes the readings by the fit that was measured, not the toggle's pending choice", () => {
    const input = deNovoInput({ wildType: "esm-atlas-esmfold", variant: "esm-atlas-esmfold" });
    // The toggle says local; the metrics on screen are still the whole-chain fit's.
    const m = buildStructure3dEvidence({
      ...input,
      viewMode: "superimposed",
      alignmentScope: "local",
      metrics: { localWindowRmsd: 1.2, globalRmsd: 6.1, alignmentScope: "global" },
    });
    expect(m.alignment.scope).toBe("local");
    expect(m.comparison.fit).toBe("whole chain");
    expect(m.readings.find(r => r.key === "global-rmsd")?.note).toBe("after a whole-chain fit");
    expect(m.readings.find(r => r.key === "local-rmsd")?.caveat).toBeNull();
  });
});

describe("ESM3 sequence shift overlay", () => {
  it.each([
    ['VESM-150M fallback', 'VESM embedding drift', '10.1038/s41592-026-03050-9'],
    ['ESM3-Medium', 'ESM3 embedding drift', '10.1126/science.ads0018'],
  ])('keeps overlay labels and citations tied to %s', (provenance, label, doi) => {
    const model = buildStructure3dEvidence(baseInput({ esm3: { scoreCount: 534, error: null, provenance }, representation: 'esm3' }));
    expect(model.legend?.title).toBe(`${label} on wild type`);
    expect(model.representations.find(r => r.id === 'esm3')?.label).toBe(label);
    expect(JSON.stringify(model)).toContain(doi);
    if (provenance.includes('VESM')) expect(JSON.stringify(model)).not.toContain('10.1126/science.ads0018');
  });
  it("projects variant-conditioned scores only onto the predicted wild type and uses app-defined bands", () => {
    const m = buildStructure3dEvidence(baseInput({ esm3: { scoreCount: 534, error: null }, representation: "esm3" }));
    expect(m.representation).toBe("esm3");
    expect(m.legend?.title).toBe("Sequence embedding drift on wild type");
    expect(m.legend?.provenanceNote).toMatch(/Wild-type versus variant sequence embeddings, projected/);
    const d = THRESHOLDS.esm3Drift;
    expect(m.legend?.entries.map(e => e.label).slice(0, 4)).toEqual([`< ${d.none}`, `${d.none}–${d.minor}`, `${d.minor}–${d.moderate}`, `≥ ${d.moderate}`]);
    expect(m.legend?.provenance).toBe("app-defined");
    expect(JSON.stringify(m)).not.toMatch(/Allosteric (Hub|Heatmap)/);
  });

  it("does not offer the sequence overlay on a FoldX variant or an experimental entry", () => {
    const variant = buildStructure3dEvidence(baseInput({
      viewMode: "mutant", foldx: readyFoldx(), esm3: { scoreCount: 534, error: null }, representation: "esm3",
    }));
    expect(variant.representations.some(option => option.id === "esm3")).toBe(false);
    expect(variant.representation).not.toBe("esm3");

    const entry = buildStructure3dEvidence(baseInput({
      esm3: { scoreCount: 534, error: null }, representation: "esm3",
      wildType: {
        provenance: { source: "alphafold", afdbVersion: "v6" },
        customPdbUrl: "/api/v1/pdb/entry/1YOV?uniprot=Q13564&pos=116&wt=D",
        entry: { numbering: "uniprot", chainId: "A", mapping: "sifts", reason: null },
        scan: scanBFactors(CRYSTAL_TEXT), site: readResidueAt(CRYSTAL_TEXT, 116),
      },
    }));
    expect(entry.representations.find(option => option.id === "esm3")?.available).toBe(false);
    expect(entry.representation).not.toBe("esm3");
    expect(entry.canvas.relationshipNote).toMatch(/AlphaFold–PDB coordinate RMSD/);
    const variantWithEntry = buildStructure3dEvidence(baseInput({
      viewMode: "mutant", foldx: readyFoldx(),
      wildType: {
        provenance: { source: "alphafold", afdbVersion: "v6" },
        customPdbUrl: "/api/v1/pdb/entry/1YOV?uniprot=Q13564&pos=116&wt=D",
        entry: { numbering: "uniprot", chainId: "A", mapping: "sifts", reason: null },
        scan: scanBFactors(CRYSTAL_TEXT), site: readResidueAt(CRYSTAL_TEXT, 116),
      },
    }));
    expect(variantWithEntry.canvas.relationshipNote).toBeNull();
  });
});

describe("vocabulary", () => {
  it("prints no legacy status word and no N/A anywhere in the model", () => {
    const variants: Structure3dInput[] = [
      baseInput(),
      baseInput({ viewMode: "mutant" }),
      baseInput({ viewMode: "superimposed", foldx: readyFoldx(), metrics: { ...NAE1_METRICS, wtSasa: null } }),
      baseInput({ foldx: { ...baseInput().foldx, status: "failed", error: "BuildModel failed" } }),
    ];
    for (const input of variants) {
      const text = JSON.stringify(buildStructure3dEvidence(input));
      expect(text).not.toMatch(/\bN\/A\b/);
      for (const legacy of LEGACY_ENGINE_LABELS) expect(text).not.toContain(legacy);
    }
  });

  it("extracts the PDB id the reader loaded", () => {
    expect(pdbIdFromUrl("/api/v1/pdb/entry/1yov")).toBe("1YOV");
    expect(pdbIdFromUrl("/api/v1/pdb/entry/9QN5?uniprot=Q13564&pos=116&wt=D")).toBe("9QN5");
    expect(pdbIdFromUrl("https://files.rcsb.org/download/9QN5.pdb")).toBe("9QN5");
    expect(pdbIdFromUrl(null)).toBeNull();
  });

  it("populates pure sideChain topology, Grantham class, and glycine backbone caveat on site", () => {
    const m = buildStructure3dEvidence(baseInput());
    expect(m.site.sideChain).not.toBeNull();
    expect(m.site.sideChain?.wildTypeCode).toBe("D");
    expect(m.site.sideChain?.mutantCode).toBe("G");
    expect(m.site.sideChain?.wildTypeName).toBe("Aspartate");
    expect(m.site.sideChain?.mutantName).toBe("Glycine");
    expect(m.site.sideChain?.grantham).toBe(94);
    expect(m.site.sideChain?.granthamClass).toBe("moderately conservative");
    expect(m.site.sideChain?.backboneCaveat?.title).toMatch(/glycine/i);
    expect(m.site.sideChain?.diff.lost.length).toBeGreaterThan(0);
  });

  it("keeps canAddressVariantSite true in Variant and Superposition modes when FoldX's template is verified even if an unmapped PDB entry is loaded on the wild-type canvas", () => {
    const unmappedWildType = {
      provenance: { source: "alphafold", afdbVersion: "v6" },
      customPdbUrl: "/api/v1/pdb/entry/9XYZ",
      entry: { numbering: "author" as const, chainId: null, mapping: null, reason: "No SIFTS mapping" },
      scan: scanBFactors(CRYSTAL_TEXT),
      site: null,
    };
    const wtMode = buildStructure3dEvidence(baseInput({
      viewMode: "wildtype",
      wildType: unmappedWildType,
      foldx: readyFoldx(),
    }));
    expect(wtMode.site.canAddressVariantSite).toBe(false);

    const verifiedFoldx = {
      ...readyFoldx(),
      referenceSite: readResidueAt(CRYSTAL_TEXT, 116),
    };
    const mutMode = buildStructure3dEvidence(baseInput({
      viewMode: "mutant",
      wildType: unmappedWildType,
      foldx: verifiedFoldx,
    }));
    expect(mutMode.site.canAddressVariantSite).toBe(true);

    const supMode = buildStructure3dEvidence(baseInput({
      viewMode: "superimposed",
      wildType: unmappedWildType,
      foldx: verifiedFoldx,
    }));
    expect(supMode.site.canAddressVariantSite).toBe(true);
  });

  it("explains repairSkippedReason: 'repair-exceeds-budget' in the variant model trace step", () => {
    const m = buildStructure3dEvidence(baseInput({
      viewMode: "mutant",
      foldx: {
        ...readyFoldx(),
        repairSkipped: true,
        repairSkippedReason: "repair-exceeds-budget",
      },
    }));
    const step2 = m.trace.find(s => s.n === 2);
    expect(step2?.sub).toContain("Template not repaired (repair too slow on this server)");
  });
});
