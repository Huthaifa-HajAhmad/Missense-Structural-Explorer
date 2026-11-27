/**
 * Partner tiers: each row's STRING cells and evidence line, its tier, the folds a long tail collapses
 * into, and ONE count of partner proteins that the facts, the trace and the tier filter all read.
 *
 * ABCG1 showed three counts at once: "Binding evidence 8 entries" (its own other chain and the
 * "ABCG" subfamily included), "7 reported partners" (the subfamily included) and, truly, 6 proteins
 * (doc/INTERFACES_PPI_AUDIT_2026-11-26.md, H2).
 */
import type { PpiBindingData } from "../contracts.ts";
import { ENGINE_STATE_LABELS } from "../engineStatus.ts";
import { stringConfidenceLabel } from "../thresholds/evaluators.ts";
import { PARTNER_BANDS, PARTNER_GROUP_LABEL } from "./constants.ts";
import { bare, intactLine, plural, rangeText } from "./format.ts";
import type { PartnerRowStore } from "./partnerRows.ts";
import type { InterfacesEvidence, PartnerGroup, PartnerGroupView, PartnerRow, StringCell } from "./types.ts";

const GROUP_ORDER: PartnerGroup[] = ["assembly", "structural", "curated", "screen", "physical", "functional"];
const PHYSICAL_SHOWN = 8;
const FUNCTIONAL_SHOWN = 5;
const SCREEN_ALWAYS = 12;
const CURATED_SHOWN = 20;
const STRING_CORROBORATES = 0.4;

interface CellInput { ppi: PpiBindingData | null; loading: boolean; failed: boolean }

function stringCell(gene: string, which: "physical" | "functional", c: CellInput): StringCell {
  const list = which === "physical" ? c.ppi?.string?.physical : c.ppi?.string?.functional;
  // A failed lookup is not an absence: the cell says the provider errored, never "Not read".
  if (!list) return { score: null, band: null, note: c.loading ? null : c.failed ? ENGINE_STATE_LABELS["upstream-error"] : "Not read" };
  const hit = list.find(p => p.partner.toUpperCase() === gene.toUpperCase());
  if (hit) return { score: hit.score, band: stringConfidenceLabel(hit.score), note: null };
  const limit = c.ppi?.string?.limit ?? null;
  const minScore = c.ppi?.string?.minScore ?? 0.15;
  return { score: null, band: null, note: limit !== null && list.length >= limit ? `Not in STRING's top ${limit}` : `None ≥ ${minScore.toFixed(2)}` };
}

function groupOf(row: PartnerRow): PartnerGroup {
  if (row.group === "assembly" || row.group === "structural") return row.group;
  if (row.subunitNamed) return "curated";
  if (row.intactExperiments !== null || row.intact) return row.intact && row.intact.twoHybridOnly && row.intact.pubmed.length <= 1 ? "screen" : "curated";
  if (row.sites.length) return "curated";
  return row.physical.score !== null ? "physical" : "functional";
}

/** Fill each row's STRING cells, tier and one-line evidence. */
export function classifyRows(store: PartnerRowStore, uniprotId: string | null, c: CellInput): PartnerRow[] {
  for (const row of store.rows.values()) {
    if (row.family) continue;
    // The protein's own row (a homomer) has no STRING score with itself.
    const self = isSelfRow(row, uniprotId);
    // STRING here is the human network: a mouse protein has no score in it, and its human ortholog's is not its own.
    const foreign: StringCell = { score: null, band: null, note: `Not scored (${row.organism === "other species" ? "not human" : row.organism})` };
    const none: StringCell = { score: null, band: null, note: null };
    row.physical = self ? none : row.organism ? foreign : stringCell(row.gene, "physical", c);
    row.functional = self ? none : row.organism ? foreign : stringCell(row.gene, "functional", c);
    row.group = groupOf(row);
    const parts = [
      store.evidenceOf.get(row.key) ?? null,
      row.observed ? `Solved: ${plural(row.observed.total, "structure")} of this pair` : null,
      row.intactExperiments !== null || row.intact ? intactLine(row.intact, row.intactExperiments, c.ppi?.lookups?.intact === "ok") : null,
    ].filter((p): p is string => Boolean(p));
    if (row.sites.length && !parts.length) parts.push(`Mapped site ${row.sites.map(rangeText).join(", ")}`);
    row.evidence = parts.length ? parts.join(" · ") : row.group === "physical" ? "STRING physical association" : "STRING functional association";
  }
  const rank = (r: PartnerRow) => (r.variantInSite || r.variantAtObservedInterface ? 0 : 1) * 10 + (r.sites.length || r.observed ? 0 : 1) * 5 + (r.family ? 1 : 0);
  return [...store.rows.values()].sort((a, b) =>
    GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) ||
    rank(a) - rank(b) ||
    (b.physical.score ?? 0) - (a.physical.score ?? 0) ||
    (b.functional.score ?? 0) - (a.functional.score ?? 0) ||
    a.gene.localeCompare(b.gene)
  );
}

/** A single-screen tail folds behind one line, keeping rows another source corroborates. */
function foldScreen(all: PartnerRow[]): { rows: PartnerRow[]; folded: PartnerGroupView["folded"]; meta: string | null } {
  const studies = new Set(all.flatMap(r => r.intact?.pubmed ?? []));
  let meta: string | null = null;
  if (studies.size === 1) {
    // One study for the whole tier: said once in the head, not on every row.
    meta = `Yeast two-hybrid in one study (PubMed ${[...studies][0]}), no other method`;
    for (const r of all) r.evidence = r.organism ? `Yeast two-hybrid, ${r.organism} protein` : "Yeast two-hybrid";
  }
  if (all.length <= SCREEN_ALWAYS) return { rows: all, folded: null, meta };
  const keep = (r: PartnerRow) => (r.physical.score ?? 0) >= STRING_CORROBORATES || r.sites.length > 0 || Boolean(r.observed);
  const rest = all.filter(r => !keep(r));
  return {
    rows: all.filter(keep),
    folded: rest.length ? { rows: rest, summary: `${plural(rest.length, "more partner")} from ${studies.size === 1 ? "the same screen" : "two-hybrid screens"}, none with STRING physical support of ${STRING_CORROBORATES.toFixed(2)} or more` } : null,
    meta,
  };
}

export function groupRows(sorted: PartnerRow[], ppi: PpiBindingData | null): { groups: PartnerGroupView[]; hidden: Partial<Record<PartnerGroup, number>> } {
  const limit = ppi?.string?.limit ?? null;
  const groups: PartnerGroupView[] = [];
  const hidden: Partial<Record<PartnerGroup, number>> = {};
  for (const id of GROUP_ORDER) {
    const all = sorted.filter(r => r.group === id);
    if (!all.length) continue;
    const list = id === "physical" ? ppi?.string?.physical : id === "functional" ? ppi?.string?.functional : null;
    const capped = Boolean(list && limit !== null && list.length >= limit);
    let shown = { rows: all, folded: null as PartnerGroupView["folded"], meta: null as string | null };
    if (id === "screen") shown = foldScreen(all);
    else if (id === "curated" && all.length > CURATED_SHOWN) {
      shown = { rows: all.slice(0, CURATED_SHOWN), folded: { rows: all.slice(CURATED_SHOWN), summary: `${plural(all.length - CURATED_SHOWN, "more reported partner")} with weaker STRING support` }, meta: null };
    } else if (id === "physical" || id === "functional") {
      const cap = id === "physical" ? PHYSICAL_SHOWN : FUNCTIONAL_SHOWN;
      const rest = all.slice(cap);
      if (rest.length) hidden[id] = rest.length;
      shown = { rows: all.slice(0, cap), folded: rest.length ? { rows: rest, summary: `${rest.length}${capped ? "+" : ""} more on STRING${capped ? `, which returns its top ${limit}` : ""}` } : null, meta: null };
    }
    groups.push({ id, title: PARTNER_GROUP_LABEL[id].title, meta: shown.meta ?? PARTNER_GROUP_LABEL[id].meta, total: all.length, capped, rows: shown.rows, folded: shown.folded, hidden: 0 });
  }
  return { groups, hidden };
}

/** The protein's own row (a homomer's other chain): one definition for the count, the STRING cells and the table. An isoform suffix is ignored. */
export function isSelfRow(r: Pick<PartnerRow, "family" | "accession">, uniprotId: string | null): boolean {
  return !r.family && Boolean(uniprotId) && bare(r.accession) === bare(uniprotId);
}

/** Partner proteins: human, not the protein itself, not a family named without genes. */
export function isPartnerProtein(r: PartnerRow, uniprotId: string | null): boolean {
  return !r.family && !r.organism && !isSelfRow(r, uniprotId);
}

export function summarisePartners(sorted: PartnerRow[], groups: PartnerGroupView[], uniprotId: string | null): InterfacesEvidence["partnerSummary"] {
  const inBand = (band: "binding" | "association") => sorted.filter(r => PARTNER_BANDS[r.group] === band);
  return {
    binding: inBand("binding").filter(r => isPartnerProtein(r, uniprotId)).length,
    association: inBand("association").filter(r => isPartnerProtein(r, uniprotId)).length,
    capped: groups.some(g => g.capped),
    otherSpecies: inBand("binding").filter(r => r.organism).length,
  };
}

/**
 * The partner list as the reader narrowed it: one tier, a name query, or both. A query reaches folded
 * and STRING-tail rows too, and shows each match as a full row; nothing is filtered on the screen.
 */
export function filterPartnerGroups(groups: PartnerGroupView[], view: { tier: PartnerGroup | null; query: string }): PartnerGroupView[] {
  const q = view.query.trim().toUpperCase();
  const match = (r: PartnerRow) => !q || r.gene.toUpperCase().includes(q) || (r.accession ?? "").toUpperCase().includes(q);
  return groups
    .filter(g => !view.tier || g.id === view.tier)
    .map(g => (q ? { ...g, rows: [...g.rows, ...(g.folded?.rows ?? [])].filter(match), folded: null } : g))
    .filter(g => g.rows.length > 0 || g.folded);
}
