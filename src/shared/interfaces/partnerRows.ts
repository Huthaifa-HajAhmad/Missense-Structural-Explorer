/**
 * Partner rows: one per protein, whichever source named it first (SUBUNIT's "CCS" and PDBe's O14618
 * are one row). Sources: SUBUNIT statements, SUBUNIT binders, solved interfaces, IntAct, UniProt
 * mapped sites, STRING. A family named without genes is its own unresolved row, never a gene.
 */
import type { PpiBindingData, PpiInteractionSite } from "../contracts.ts";
import { subunitPartnerMentions, type SubunitStatement } from "../multimerAssembly.ts";
import { bare, statementQualifier } from "./format.ts";
import type { AssemblyRecord } from "./assembly.ts";
import type { ObservedView, PartnerRow } from "./types.ts";

const emptyCells = () => ({ physical: { score: null, band: null, note: null }, functional: { score: null, band: null, note: null } });

function blankRow(key: string, gene: string, accession: string | null, organism: string | null): PartnerRow {
  return {
    key, gene, accession, group: "functional", evidence: "", qualifier: null, family: false, subunitNamed: false,
    intact: null, intactExperiments: null, observed: null, sites: [], ...emptyCells(),
    variantInSite: false, variantAtObservedInterface: false, organism,
  };
}

/** The row store: keys by accession first, then by human gene symbol. */
export class PartnerRowStore {
  readonly rows = new Map<string, PartnerRow>();
  /** Text attached to a row by SUBUNIT ("Homodimer: another copy of ABCG1", "Binds (SUBUNIT)"). */
  readonly evidenceOf = new Map<string, string>();
  private readonly byGene = new Map<string, string>();
  private readonly byAcc = new Map<string, string>();

  private keyFor(g: string | null, acc: string | null): string {
    if (acc && this.byAcc.has(bare(acc))) return this.byAcc.get(bare(acc))!;
    if (g && this.byGene.has(g.toUpperCase())) return this.byGene.get(g.toUpperCase())!;
    return bare(acc) || g?.toUpperCase() || `row${this.rows.size}`;
  }

  find(g: string | null): PartnerRow | undefined {
    return this.rows.get(this.keyFor(g, null));
  }

  upsert(g: string | null, acc: string | null): PartnerRow {
    const key = this.keyFor(g, acc);
    let row = this.rows.get(key);
    if (!row) {
      row = blankRow(key, g ?? acc ?? "Partner", acc, null);
      this.rows.set(key, row);
    }
    if (acc && !row.accession) row.accession = acc;
    if (row.accession) this.byAcc.set(bare(row.accession), key);
    if (g && (row.gene === row.accession || row.gene === "Partner")) row.gene = g;
    // A protein from another species is matched by accession only: its gene name ("Sod1", "Hspa5")
    // must not fold it into the human row, or into the query itself.
    if (row.gene && !row.organism) this.byGene.set(row.gene.toUpperCase(), key);
    return row;
  }

  /** A partner from another species: its own row, keyed by accession. */
  upsertForeign(g: string | null, acc: string, organism: string): PartnerRow {
    const key = this.byAcc.get(bare(acc)) ?? bare(acc);
    let row = this.rows.get(key);
    if (!row) {
      row = blankRow(key, g ?? acc, acc, organism);
      this.rows.set(key, row);
      this.byAcc.set(bare(acc), key);
    }
    return row;
  }

  addFamily(st: SubunitStatement): void {
    const key = `family:${st.family}`;
    this.rows.set(key, {
      ...blankRow(key, st.family!.charAt(0).toUpperCase() + st.family!.slice(1), null, null),
      group: "assembly",
      family: true,
      qualifier: st.qualifier,
      evidence: `${st.label}${st.qualifier ? ` (${st.qualifier.toLowerCase()})` : ""}, named as a family; not resolved to genes`,
    });
  }
}

interface RowSources {
  gene: string;
  uniprotId: string | null;
  rec: AssemblyRecord;
  statements: SubunitStatement[];
  subunitText: string | null;
  observed: ObservedView[];
  intact: NonNullable<PpiBindingData["curatedInteractions"]>;
  sites: PpiInteractionSite[];
  ppi: PpiBindingData | null;
}

function addAssembly(store: PartnerRowStore, s: RowSources, accessionOf: Map<string, string>): void {
  for (const st of s.statements) {
    const label = `${st.label}${st.qualifier ? ` (${st.qualifier.toLowerCase()})` : ""}`;
    if (st.kind === "homomer") {
      const row = store.upsert(s.gene, s.uniprotId);
      Object.assign(row, { gene: s.gene, group: "assembly", qualifier: row.qualifier ?? st.qualifier });
      store.evidenceOf.set(row.key, `${label}: another copy of ${s.gene}`);
    } else if (st.kind === "heteromer" && st.family) {
      store.addFamily(st);
    } else {
      for (const g of st.partnerGenes) {
        const resolved = s.rec.partners.find(p => p.gene === g);
        const row = store.upsert(g, resolved?.accession ?? accessionOf.get(g.toUpperCase()) ?? null);
        Object.assign(row, { group: "assembly", qualifier: row.qualifier ?? st.qualifier });
        if (!store.evidenceOf.has(row.key)) store.evidenceOf.set(row.key, label);
      }
    }
  }
  // Binders the record names outside an assembly statement ("Binds APP and TP53BP2."): curated, not assembly.
  const assemblyPartnerName = s.rec.partners[0]?.gene ?? null;
  for (const m of subunitPartnerMentions(s.subunitText, s.gene)) {
    if (store.find(m.gene)?.group === "assembly") continue;
    const row = store.upsert(m.gene, null);
    row.subunitNamed = true;
    row.qualifier = row.qualifier ?? statementQualifier(m.sentence);
    store.evidenceOf.set(row.key, /\bcomplex binds\b/i.test(m.sentence) ? `Binds the ${assemblyPartnerName ? `${s.gene}–${assemblyPartnerName}` : s.gene} complex (SUBUNIT)` : "Binds (SUBUNIT)");
  }
}

/** Every partner row the payloads name, before STRING cells and groups are assigned. */
export function collectPartnerRows(s: RowSources): PartnerRowStore {
  const store = new PartnerRowStore();
  // Accessions IntAct gives for gene names, so SUBUNIT's "CCS" and PDBe's O14618 meet in one row.
  const accessionOf = new Map<string, string>();
  for (const c of s.intact) if (c.gene && c.accession && !c.organismDiffer && !c.evidence?.organism) accessionOf.set(c.gene.toUpperCase(), c.accession);
  for (const o of s.observed) if (o.gene && !o.organism) accessionOf.set(o.gene.toUpperCase(), o.accession);
  addAssembly(store, s, accessionOf);
  for (const o of s.observed) {
    const row = o.homomeric ? store.upsert(s.gene, s.uniprotId) : o.organism ? store.upsertForeign(o.gene ?? o.name, o.accession, o.organism) : store.upsert(o.gene ?? null, o.accession);
    if (row.gene === o.accession) row.gene = o.gene ?? o.name;
    row.observed = o;
    row.variantAtObservedInterface = o.variantAtInterface;
    if (row.group !== "assembly") row.group = "structural";
  }
  for (const c of s.intact) {
    if (bare(c.accession) === bare(s.uniprotId)) continue;
    const foreign = c.evidence?.organism ?? (c.organismDiffer ? "other species" : null);
    const row = foreign ? store.upsertForeign(c.gene, c.accession, foreign) : store.upsert(c.gene, c.accession);
    row.intactExperiments = c.experiments ?? null;
    row.intact = c.evidence ?? null;
  }
  for (const site of s.sites) {
    for (const p of site.partners) {
      if (p.toUpperCase() === s.gene.toUpperCase()) continue;
      const row = store.upsert(p, null);
      row.sites.push(site);
      if (site.containsVariant) row.variantInSite = true;
    }
  }
  for (const p of s.ppi?.string?.physical ?? []) store.upsert(p.partner, null);
  for (const p of s.ppi?.string?.functional ?? []) store.upsert(p.partner, null);
  return store;
}
