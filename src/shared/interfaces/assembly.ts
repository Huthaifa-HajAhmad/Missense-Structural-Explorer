/** Curation: the assembly UniProt's SUBUNIT record states, and the chains a complex would hold. */
import type { MultimerData, PpiBindingData } from "../contracts.ts";
import { parseSubunitAssembly, subunitStatements, type SubunitStatement } from "../multimerAssembly.ts";
import { COUNT_WORD, bare } from "./format.ts";
import type { ChainView, InterfacesEvidence } from "./types.ts";

export type AssemblyRecord = {
  kind: string;
  label: string;
  copies: number | null;
  homoAssumed: boolean;
  partners: Array<{ gene: string; accession: string | null; resolvedBy: string | null }>;
};

export interface Curation {
  subunitText: string | null;
  rec: AssemblyRecord;
  statements: SubunitStatement[];
  qualifier: string | null;
  view: InterfacesEvidence["assembly"];
}

function compositionOf(rec: AssemblyRecord, subunitText: string | null): string {
  if (rec.kind === "monomer") return "a single chain";
  if (rec.kind === "homomer") return `${COUNT_WORD[rec.copies ?? 0] ?? rec.copies} identical chains`;
  if (rec.kind === "heteromer") return rec.partners.length ? `with ${rec.partners.map(p => p.gene).join(" and ")}` : `${COUNT_WORD[rec.copies ?? 0] ?? "several"} different chains`;
  if (rec.kind === "complex") return "part of a larger complex";
  if (rec.kind === "interactions-only") return "binding partners listed, no assembly";
  return subunitText ? "no assembly in the record" : "no SUBUNIT record";
}

export function readCuration(asmData: MultimerData | null, ppi: PpiBindingData | null, features: any, gene: string): Curation {
  const subunitText: string | null = asmData?.subunitComment ?? ppi?.subunitComment ?? features?.subunitComment ?? null;
  const parsed = parseSubunitAssembly(subunitText, gene);
  const rec: AssemblyRecord = asmData?.assembly ?? {
    ...parsed,
    partners: parsed.kind === "heteromer" ? parsed.partnerGenes.map(g => ({ gene: g, accession: null, resolvedBy: null })) : [],
  };
  // Re-read from the text, not the stored record: a record written before the subfamily rule
  // (ABCG1's "partners of the ABCG subfamily") named "ABCG" as a gene.
  const statements = subunitText ? subunitStatements(subunitText, gene) : ((asmData?.assembly?.statements as SubunitStatement[] | undefined) ?? []);
  const qualifier = (rec as any).qualifier ?? parsed.qualifier ?? null;
  return {
    subunitText,
    rec,
    statements,
    qualifier,
    view: {
      kind: rec.kind,
      label: rec.label,
      copies: rec.copies,
      homoAssumed: rec.homoAssumed,
      qualifier,
      subunitText,
      statements,
      partners: rec.partners,
      composition: compositionOf(rec, subunitText),
    },
  };
}

/** The chains the server planned, or the ones the SUBUNIT record implies when nothing was planned. */
export function readChains(asmData: MultimerData | null, rec: AssemblyRecord, gene: string, uniprotId: string | null): ChainView[] {
  if (asmData?.chains?.length) {
    return asmData.chains.map(c => ({
      id: c.id,
      label: c.gene ?? c.accession,
      accession: c.accession,
      carriesVariant: c.carriesVariant,
      role: bare(c.accession) === bare(uniprotId) ? "self" : "partner",
    }));
  }
  const n = rec.kind === "homomer" ? Math.min(rec.copies ?? 2, 12) : rec.kind === "heteromer" ? Math.max(2, Math.min(rec.copies ?? 2, 12)) : 1;
  return Array.from({ length: n }, (_, i) => {
    const isPartner = rec.kind === "heteromer" && i > 0;
    return {
      id: String.fromCharCode(65 + i),
      label: (isPartner ? rec.partners[i - 1]?.gene : gene) ?? "Partner",
      accession: isPartner ? rec.partners[i - 1]?.accession ?? "" : uniprotId ?? "",
      carriesVariant: i === 0,
      role: isPartner ? "partner" : "self",
    };
  });
}
