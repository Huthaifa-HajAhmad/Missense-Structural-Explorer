import { describe, it, expect } from "vitest";
import { buildFunctionEvidence, kindOfMatch } from "../functionEvidence";
import { isMetalBindingSite } from "../functionalSites";
import { SOD1_INPUT, SOD1_UNIPROT } from "./fixtures/sod1FunctionalDomains";

/**
 * SOD1 p.Ala5Val: the densest real case. Each test pins one finding of
 * doc/FUNCTIONAL_DOMAINS_PRESENTATION_AUDIT.md (A1-A12, B3, B6).
 */
describe("buildFunctionEvidence - SOD1 p.Ala5Val", () => {
  const ev = buildFunctionEvidence(SOD1_INPUT);

  it("A1: counts Cu/Zn ligands as metal binding, so the foot does not say it is not annotated", () => {
    expect(isMetalBindingSite({ type: "Binding site", description: "Ligand: Cu cation" })).toBe(true);
    expect(isMetalBindingSite({ type: "Binding site", description: "Ligand: Zn(2+)" })).toBe(true);
    expect(isMetalBindingSite({ type: "Binding site", description: "Ligand: ATP" })).toBe(false);
    expect(ev.notAnnotated).not.toContain("metal binding");
    expect(ev.notAnnotated).toContain("transmembrane segments");
  });

  it("A2: names the exact change A5V, not the first variant at the residue", () => {
    expect(ev.exactVariant?.name).toBe("Ala5Val");
    expect(ev.otherVariantsHere.map((r) => r.name).sort()).toEqual(["Ala5Ser", "Ala5Thr"]);
    expect(ev.finding.rest).toContain("UniProt lists this exact change, Ala5Val, as a disease variant");
    expect(ev.finding.rest).toContain("Other changes here: Ala5Ser, Ala5Thr (context, not scored)");
    const fact = ev.facts.find((f) => f.label === "Disease variant here");
    expect(fact?.value).toBe("A5V");
    expect(fact?.sub).toContain("2 others at 5");
  });

  it("A3: keeps what UniProt says the change does", () => {
    expect(ev.exactVariant?.note).toBe("In ALS1");
    expect(ev.exactVariant?.detail).toMatch(/^Severe form; reduces structural stability/);
    expect(ev.exactVariant?.detail).not.toMatch(/dbSNP/);
    expect(ev.finding.rest).toMatch(/severe form; reduces structural stability/);
  });

  it("A4: a variant's evidence is a report, not an experiment", () => {
    expect(ev.exactVariant?.evidenceLabel).toBe("Reported");
    const folded = ev.groups.find((g) => g.group === "variants")!.rows;
    expect(folded.every((r) => r.evidenceLabel === "Reported" || r.evidenceLabel === "No evidence cited")).toBe(true);
    // A site keeps its level.
    expect(ev.rows.find((r) => r.type === "Binding site")?.evidenceLabel).toBe("Experimental");
  });

  it("A5/B5: PROSITE patterns are conserved-site motifs, not domain boxes; Pfam is the one domain", () => {
    expect(ev.domains.map((d) => `${d.source} ${d.accession}`)).toEqual(["Pfam PF00080"]);
    expect(ev.motifs.map((m) => m.accession).sort()).toEqual(["PS00087", "PS00332"]);
    expect(ev.motifs.every((m) => m.entryType === "binding_site")).toBe(true);
  });

  it("A5: the match kind follows InterPro's entry type, and falls back to the PROSITE accession convention", () => {
    expect(kindOfMatch({ database: "PROSITE", accession: "PS00087", entryType: "binding_site" })).toBe("motif");
    expect(kindOfMatch({ database: "PROSITE", accession: "PS00087" })).toBe("motif");
    expect(kindOfMatch({ database: "PROSITE", accession: "PS50011" })).toBe("domain");
    expect(kindOfMatch({ database: "Pfam", accession: "PF00080", entryType: "domain" })).toBe("domain");
    expect(kindOfMatch({ database: "Pfam", accession: "PF99999", entryType: "family" })).toBe("family");
    // CDD / PRINTS carry the same entry as Pfam and would draw it twice.
    expect(kindOfMatch({ database: "CDD", accession: "cd00305", entryType: "domain" })).toBe("family");
    expect(kindOfMatch({ database: "Gene3D", accession: "G3DSA:2.60.40.200", entryType: "homologous_superfamily" })).toBe("structural");
  });

  it("B3: a whole-chain structural segment is listed, not drawn", () => {
    expect(ev.structuralDomains).toHaveLength(0);
    expect(ev.rows.some((r) => r.type === "Gene3D")).toBe(true);
  });

  it("A6: a Trp-Trp cross-link is not called ubiquitination", () => {
    const x = ev.rows.find((r) => r.type === "Cross-link" && r.start === 33)!;
    expect(x.shortLabel).toBe("W33–W33");
    expect(x.shortLabel).not.toMatch(/ub/);
    expect(x.name).toBe("Trp-Trp cross-link, interchain with W-33");
  });

  it("A7: the query's own variants are not 'annotations at the residue'", () => {
    expect(ev.finding.lead).toBe("No site, region or modification is annotated at residue 5.");
    expect(ev.finding.lead).not.toMatch(/carries/);
    expect(ev.trace[2].text).toBe("No site, region or specific domain covers residue 5.");
  });

  it("A8: gives the processed protein's number, A4V, as context", () => {
    expect(ev.matureNumbering).toMatchObject({ residue: 4, label: "A4V", chainStart: 2 });
    expect(ev.caveats.map((c) => c.lead)).toContain("Older literature may call this A4V.");
  });

  it("A8: says nothing about it when the payload predates `processedChain` and has no Chain feature", () => {
    const old = buildFunctionEvidence({ ...SOD1_INPUT, uniprot: { ...SOD1_UNIPROT, processedChain: undefined } });
    expect(old.matureNumbering).toBeNull();
  });

  it("A10: the Domain fact says only a whole-chain segment covers the residue", () => {
    const d = ev.facts.find((f) => f.label === "Domain")!;
    expect(d.value).toBe("None at this residue");
    expect(d.sub).toBe("1 annotated elsewhere · only a whole-chain Gene3D segment covers it");
  });

  it("A11: a multi-residue mutagenesis names its substitutions", () => {
    const m = ev.rows.find((r) => r.group === "mutagenesis" && r.start === 51 && r.end === 52)!;
    expect(m.name).toBe("Phe51Glu, Gly52Glu");
  });

  it("A12/B6: says what the 81 variants are and that PM1's hot-spot reading is untested", () => {
    expect(ev.density.total).toBe(81);
    expect(ev.density.atResidue).toBe(3);
    expect(ev.caveats.some((c) => /hot-spot reading.*not tested/.test(c.rest))).toBe(true);
    const g = ev.groups.find((x) => x.group === "variants")!;
    expect(g.summary).toMatch(/^81 disease/);
    // One table row per residue: the three at residue 5 are one row.
    const at5 = g.rows.filter((r) => r.start === 5);
    expect(at5).toHaveLength(1);
    expect(at5[0].name).toBe("Ala5 → Ser, Thr, Val");
    expect(at5[0].parts).toHaveLength(3);
    expect(g.rows.length).toBeLessThan(81);
  });

  it("every mark of a folded variant row points at that row", () => {
    const row = ev.groups.find((g) => g.group === "variants")!.rows.find((r) => r.start === 5)!;
    expect(ev.rows.filter((r) => r.group === "variants" && r.start === 5).every((r) => r.rowKey === row.key)).toBe(true);
  });

  it("PM1 is not met: nothing at 5 is a critical site", () => {
    expect(ev.verdictLabel).toBe("PM1 not met");
  });
});
