/**
 * buildInterfacesEvidence: runs the sections in order (curation → observation → prediction → verdict →
 * partners → map → binding → words) and assembles the one model the tab, the rail and Insights render.
 * Each section lives in its own module; this file only wires their inputs.
 */
import type { PpiBindingData } from "../contracts.ts";
import { stringConfidenceLabel } from "../thresholds/evaluators.ts";
import { readChains, readCuration } from "./assembly.ts";
import { readBinding } from "./binding.ts";
import { readModel, type SolvedCoverage } from "./complexModel.ts";
import { readFacts, readFinding } from "./finding.ts";
import { availability, residueLabel, residueNamer, stringNetworkUrl } from "./format.ts";
import { readObserved } from "./observed.ts";
import { classifyRows, groupRows, summarisePartners } from "./partnerGroups.ts";
import { collectPartnerRows } from "./partnerRows.ts";
import { isStaleAssembly, isStalePpi } from "./stored.ts";
import { buildTrack, locationSentence } from "./track.ts";
import { readTrace } from "./trace.ts";
import { readVerdict } from "./verdict.ts";
import type { BuildInterfacesInput, InterfacesEvidence, PartnerRow } from "./types.ts";

function readSections(ppi: PpiBindingData | null, failed: boolean, loading: boolean, gene: string, hasCuration: boolean): InterfacesEvidence["sections"] {
  const status = (s: string | undefined) => s ?? (failed ? "failed" : undefined);
  return {
    uniprot: availability(status(ppi?.lookups?.uniprot), hasCuration, loading, {
      failed: "UniProt did not answer, so curated partners and mapped sites were not checked.",
      skipped: `No UniProt accession was resolved for ${gene}, so nothing curated was asked for.`,
      empty: `UniProt records no curated partner or mapped interaction site for ${gene}.`,
      unknown: "Curated partners and mapped sites have not been read yet.",
    }),
    intact: availability(status(ppi?.lookups?.intact), true, loading, {
      failed: "IntAct did not answer, so the methods behind each binary interaction are not shown.",
      skipped: "No UniProt accession was resolved, so IntAct was not asked.",
      empty: "",
      unknown: "IntAct has not been read yet.",
    }),
    stringPhysical: availability(status(ppi?.lookups?.stringPhysical), Boolean(ppi?.string?.physical?.length), loading, {
      failed: "STRING's physical network did not answer. This is not evidence that there is none.",
      empty: `STRING's physical network has no partner of ${gene} at or above 0.15.`,
      unknown: "STRING has not been read yet.",
    }),
    stringFunctional: availability(status(ppi?.lookups?.stringPartners), Boolean(ppi?.string?.functional?.length), loading, {
      failed: "STRING's functional network did not answer. This is not evidence that there is none.",
      empty: `STRING has no association for ${gene} at or above 0.15.`,
      unknown: "STRING has not been read yet.",
    }),
  };
}

/** "all two-hybrid, one study (PubMed …)", "3 from a two-hybrid screen only", "curated, structural or co-purified". */
function partnerSubtitle(rows: PartnerRow[], count: number, otherSpecies: number): string {
  const screen = rows.filter(p => p.group === "screen");
  const studies = new Set(screen.flatMap(p => p.intact?.pubmed ?? []));
  const sub = screen.length && screen.length === count
    ? `all two-hybrid${studies.size === 1 ? `, one study (PubMed ${[...studies][0]})` : ""}`
    : screen.length ? `${screen.length} from a two-hybrid screen only` : "curated, structural or co-purified";
  return otherSpecies ? `${sub}; ${otherSpecies} more from other species` : sub;
}

function solvedCoverage(native: InterfacesEvidence["observed"]["partners"]): SolvedCoverage {
  if (!native.length) return "none";
  return native.every(p => p.n === 0) ? "unmodelled" : "answers";
}

export function buildInterfacesEvidence(input: BuildInterfacesInput): InterfacesEvidence {
  const md: any = (input.result as any)?.metadata ?? {};
  const features: any = (input.result as any)?.uniprotFeatures ?? null;
  const gene: string = md.gene ?? input.assembly?.gene ?? input.ppi?.gene ?? "This protein";
  const uniprotId: string | null = md.uniprotId ?? input.assembly?.uniprotId ?? input.ppi?.uniprotId ?? null;
  const stale = isStaleAssembly(input.assembly);
  const asmData = input.assembly && !stale ? input.assembly : null;
  const ppi = input.ppi && !isStalePpi(input.ppi) ? input.ppi : null;
  const asmLoading = input.assemblyStatus === "loading" && !asmData;
  const ppiLoading = input.ppiStatus === "loading" && !ppi;
  const ppiFailed = input.ppiStatus === "error" && !ppi;
  const position: number | null = asmData?.variantPosition ?? ppi?.position ?? (Number.isFinite(md.residueIndex) && md.residueIndex > 0 ? md.residueIndex : null);
  const resLabel = residueLabel(md.variant, position);
  const residueName = residueNamer(typeof md.sequence === "string" ? md.sequence : "");
  const sequenceLength: number | null = features?.sequenceLength ?? ppi?.sequenceLength ?? null;

  const cur = readCuration(asmData, ppi, features, gene);
  const observed = readObserved(asmData, input, gene, asmLoading);
  const native = observed.partners;
  const chains = readChains(asmData, cur.rec, gene, uniprotId);
  const model = readModel({ input, asmData, stale, loading: asmLoading, rec: cur.rec, chains, position, resLabel, solved: solvedCoverage(native) });
  const iface = readVerdict({ observed, model, pending: asmLoading || stale, homomer: cur.rec.kind === "homomer", gene, position, resLabel, residueName });

  const sites = ppi?.interactionSites ?? [];
  const intact = ppi?.curatedInteractions ?? [];
  const sections = readSections(ppi, ppiFailed, ppiLoading, gene, Boolean(intact.length || sites.length || cur.subunitText));
  const store = collectPartnerRows({ gene, uniprotId, rec: cur.rec, statements: cur.statements, subunitText: cur.subunitText, observed: native, intact, sites, ppi });
  const sorted = classifyRows(store, uniprotId, { ppi, loading: ppiLoading, failed: input.ppiStatus === "error" });
  const { groups, hidden } = groupRows(sorted, ppi);
  const partners = groups.flatMap(g => g.rows);
  const partnerSummary = summarisePartners(sorted, groups, uniprotId);
  const partnerSub = partnerSubtitle([...store.rows.values()], partnerSummary.binding, partnerSummary.otherSpecies);

  const track = buildTrack({ features, position, sequenceLength, resLabel, sites, native, fibrils: observed.fibrils, model, residueName });
  const binding = readBinding({ input, iface, native, solvedPending: observed.availability.state === "pending", chainCount: chains.length, gene, resLabel, assemblyLabel: cur.rec.label, monomer: cur.rec.kind === "monomer", coverageChecked: observed.coverageChecked });
  const finding = readFinding({
    iface, model, native, sites, gene, resLabel,
    solvedFailed: observed.availability.state === "failed",
    homomerLabel: cur.rec.kind === "homomer" ? cur.rec.label : null,
    location: locationSentence(track, position, resLabel),
    coverageChecked: observed.coverageChecked,
  });
  const facts = readFacts({
    iface, binding, assemblyLabel: cur.rec.label, subunitText: cur.subunitText, qualifier: cur.qualifier,
    partnerCount: partnerSummary.binding, partnerSub, partnersLoading: ppiLoading, partnersFailed: sections.uniprot.state === "failed",
    coverageChecked: observed.coverageChecked,
  });
  const curationPending = !cur.subunitText && (asmLoading || ppiLoading);
  const trace = readTrace({
    statements: cur.statements, subunitText: cur.subunitText, curationPending,
    curationFailed: !cur.subunitText && !curationPending && ((input.assemblyStatus === "error" && !asmData) || ppiFailed),
    observed, entryKindsFailed: asmData?.experimental?.status === "ok" && asmData.experimental.entryKinds === "failed",
    iface, model, partnerCount: partnerSummary.binding, partnerSub, sections, ppi, ppiLoading, binding,
  });

  // STRING band counts (physical) for the rail's cut-point list.
  const bandCounts = new Map<string, number>();
  for (const p of ppi?.string?.physical ?? []) {
    const b = stringConfidenceLabel(p.score);
    if (b) bandCounts.set(b, (bandCounts.get(b) ?? 0) + 1);
  }
  return {
    status: { assembly: stale ? "stale" : asmLoading ? "loading" : input.assemblyStatus === "error" && !asmData ? "error" : "ready", lookups: ppiLoading ? "loading" : ppiFailed ? "error" : "ready" },
    gene, uniprotId, position, residueLabel: resLabel, sequenceLength,
    assembly: cur.view, chains, observed, model, interface: iface, sites, sections, partners, groups, partnerSummary,
    hiddenPartners: hidden,
    columns: { solved: partners.some(p => p.observed), site: sites.length > 0 },
    track, binding, finding, facts, trace,
    string: { version: ppi?.stringVersion ?? null, limit: ppi?.string?.limit ?? null, minScore: ppi?.string?.minScore ?? null, bands: [...bandCounts].map(([id, count]) => ({ id, count })) },
    stringUrl: md.gene ? stringNetworkUrl(md.gene, undefined, true) : null,
  };
}

/** The assembly sentence alone, for surfaces (Insights) that show one line. */
export function assemblySentence(ev: InterfacesEvidence): string {
  const a = ev.assembly;
  return a.kind === "unstated" ? `UniProt states no assembly for ${ev.gene}.` : `${a.label}${a.qualifier ? ` (${a.qualifier.toLowerCase()})` : ""}, per UniProt SUBUNIT.`;
}
