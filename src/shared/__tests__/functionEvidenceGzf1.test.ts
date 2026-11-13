import { describe, expect, it } from "vitest";
import { buildFunctionEvidence, kindOfMatch } from "../functionEvidence";
import { overlapsMostly } from "../domainUnits";
import { GZF1_INPUT } from "./fixtures/gzf1FunctionalDomains";

/**
 * GZF1 p.Arg591Trp: ten C2H2 zinc fingers modelled by four signatures of one InterPro entry, and one disease
 * variant over residues 289–711. The protein map drew each signature on its own row (forty boxes), drew the
 * PROSITE pattern as a domain, named the PROSITE match's ten locations as "the" domain of residue 591, and
 * pinned the 289–711 variant at residue 289.
 */
const ev = buildFunctionEvidence(GZF1_INPUT);

describe("GZF1 domain units", () => {
  it("draws a PROSITE pattern as a conserved-site tick even when its InterPro entry is a domain", () => {
    expect(kindOfMatch({ database: "PROSITE", accession: "PS00028", entryType: "domain" })).toBe("motif");
    expect(kindOfMatch({ database: "PROSITE", accession: "PS50157", entryType: "domain" })).toBe("domain");
    expect(ev.motifs.map((m) => m.accession)).toContain("PS00028");
    expect(ev.domains.map((d) => d.accession)).not.toContain("PS00028");
  });

  it("makes one unit per zinc finger, named by UniProt, with every database that reported it", () => {
    const zf = ev.domainUnits.filter((u) => u.entryKey === "IPR013087");
    expect(zf).toHaveLength(10);
    expect(zf.map((u) => u.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const tenth = zf[9];
    expect(tenth.name).toBe("C2H2-type 10 zinc finger");
    expect(tenth.sources.map((s) => `${s.source} ${s.accession}`).sort()).toEqual(["PROSITE PS50157", "Pfam PF00096", "SMART SM00355"]);
    // PROSITE's profile runs to 602; Pfam and SMART stop at 597. The union is drawn, the core is what all agree on.
    expect([tenth.start, tenth.end]).toEqual([575, 602]);
    expect(tenth.core).toEqual({ start: 575, end: 597 });
    expect(tenth.covers).toBe(true);
    // The unit selects UniProt's own zinc-finger row, and any of its database rows lights it.
    expect(tenth.rowKey).toMatch(/^zinc finger-575-597/);
    expect(tenth.memberKeys).toContain("match-Pfam-PF00096");
  });

  it("keeps the BTB matches as one unit and never merges two different entries", () => {
    const btb = ev.domainUnits.filter((u) => u.entryKey === "IPR000210");
    expect(btb).toHaveLength(1);
    expect(btb[0].name).toBe("BTB");
    expect(btb[0].sources).toHaveLength(3);
    for (const u of ev.domainUnits) expect(new Set(u.sources.map((s) => s.rowKey)).size).toBe(u.sources.length);
  });

  it("merges only spans that share half of the longer one", () => {
    expect(overlapsMostly({ start: 547, end: 569 }, { start: 547, end: 574 })).toBe(true);
    expect(overlapsMostly({ start: 90, end: 245 }, { start: 150, end: 410 })).toBe(false);
  });
});

describe("GZF1 finding", () => {
  it("names the zinc finger the residue sits in, not one PROSITE match's ten locations", () => {
    expect(ev.finding.lead).toContain("inside the C2H2-type 10 zinc finger (Pfam, SMART and PROSITE, 575–602)");
    const domain = ev.facts.find((f) => f.label === "Domain")!;
    expect(domain.value).toBe("C2H2-type 10 zinc finger");
    expect(domain.sub).toContain("10 of 10");
    expect(domain.sub).not.toMatch(/350–371/);
  });

  it("files a zinc finger under domains, not as a site at the residue", () => {
    expect(ev.groups.find((g) => g.group === "sites")?.rows.some((r) => r.type === "Zinc finger") ?? false).toBe(false);
    expect(ev.finding.lead).not.toMatch(/carries one annotation/);
  });

  it("states the 289–711 disease variant as a stretch over the residue, not a pin 0 residues away", () => {
    const spanRow = ev.rows.find((r) => r.group === "variants" && r.start === 289);
    expect(spanRow?.lane).toBe("span");
    expect(ev.finding.rest).toContain("a disease variant that spans this residue: residues 289–711");
    const fact = ev.facts.find((f) => f.label === "Disease variant over it");
    expect(fact?.value).toBe("289–711");
    expect(ev.facts.some((f) => f.value === "None in UniProtKB")).toBe(false);
    expect(ev.density).toMatchObject({ total: 1, residues: 0, spans: 1 });
    expect(ev.caveats.some((c) => c.lead === "UniProtKB lists 1 disease variant: one over a stretch (289–711).")).toBe(true);
  });
});

describe("GZF1 consumers of the model", () => {
  it("names the databases behind a unit on the pinned reading, from either of its rows", async () => {
    const { functionReadings } = await import("../molecularWorkspace");
    const readings = functionReadings(ev);
    const unit = ev.domainUnits.find((u) => u.name === "C2H2-type 10 zinc finger")!;
    for (const key of [unit.rowKey, "match-Pfam-PF00096"]) {
      const r = readings.find((x) => x.key === key) as { facts: Array<{ label: string; value: string }>; notes: string[] };
      expect(r.facts.find((f) => f.label === "Matched by")?.value).toBe("Pfam PF00096, SMART SM00355, PROSITE PS50157");
    }
    const zf = readings.find((x) => x.key === unit.rowKey) as { notes: string[] };
    expect(zf.notes.join(" ")).toContain("The databases agree on residues 575–597; only some extend to 575–602.");
  });

  it("still lists zinc fingers among the annotations the Hotspots view places near a hot spot", async () => {
    const { hotspotInputFrom } = await import("../hotspotInput");
    const input = hotspotInputFrom({ metadata: { gene: "GZF1" } } as never, ev, undefined, null);
    expect(input.annotations?.map((a) => a.name)).toContain("C2H2-type 10");
  });
});
