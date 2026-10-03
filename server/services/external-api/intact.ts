/**
 * intact.ts — how IntAct records each binary interaction of one protein: detection methods and the
 * studies behind them.
 *
 * Why: UniProt's INTERACTION list gives a partner and an "experiments" count. For SLC12A4 all eight
 * partners come from ONE yeast two-hybrid screen (Luck et al., Nature 2020, HuRI); "3 experiments" is
 * three assay versions in that paper. Shown bare, it read as three independent confirmations, and
 * the grid labelled the lot "Curated physical interaction". With methods and studies the screen can
 * say what the evidence is.
 *
 * Endpoint: IntAct PSICQUIC, MITAB 2.5
 *   https://www.ebi.ac.uk/Tools/webservices/psicquic/intact/webservices/current/search/interactor/{acc}?format=tab25
 * Columns used: 0/1 interactor ids, 6 detection method, 8 publication ids.
 */
import { LRUCache } from "lru-cache";
import { fetchWithRetry } from "../infra/http-client.ts";
import type { IntactEvidence } from "../../../src/shared/contracts.ts";

const cache = new LRUCache<string, Map<string, IntactEvidence>>({ max: 300, ttl: 7 * 24 * 60 * 60 * 1000 });

const MAX_ROWS = 5000;

function acc(field: string): string | null {
  const m = /uniprotkb:([A-Z0-9]{6,10})(?:-\d+)?/i.exec(field ?? "");
  return m ? m[1].toUpperCase() : null;
}

/** Parse MITAB 2.5 rows into evidence per partner accession. Exported for tests. */
export function parseIntactMitab(text: string, accession: string): Map<string, IntactEvidence> {
  const self = accession.toUpperCase().replace(/-\d+$/, "");
  const work = new Map<string, { methods: Set<string>; pubmed: Set<string> }>();
  for (const line of text.split("\n")) {
    const cols = line.split("\t");
    if (cols.length < 9) continue;
    const a = acc(cols[0]);
    const b = acc(cols[1]);
    const partner = a === self ? b : b === self ? a : null;
    if (!partner) continue;
    const entry = work.get(partner) ?? { methods: new Set<string>(), pubmed: new Set<string>() };
    for (const m of cols[6].matchAll(/\(([^)]+)\)/g)) entry.methods.add(m[1].trim());
    for (const m of cols[8].matchAll(/pubmed:(\d+)/gi)) entry.pubmed.add(m[1]);
    work.set(partner, entry);
  }
  const out = new Map<string, IntactEvidence>();
  for (const [partner, e] of work) {
    const methods = [...e.methods].sort();
    out.set(partner, {
      methods,
      pubmed: [...e.pubmed].sort(),
      twoHybridOnly: methods.length > 0 && methods.every(m => /two hybrid/i.test(m)),
    });
  }
  return out;
}

export type IntactLookup = { status: "ok"; byPartner: Map<string, IntactEvidence> } | { status: "failed"; byPartner: Map<string, IntactEvidence> };

export async function fetchIntactEvidence(accession: string, signal?: AbortSignal): Promise<IntactLookup> {
  const key = accession.toUpperCase().replace(/-\d+$/, "");
  const hit = cache.get(key);
  if (hit) return { status: "ok", byPartner: hit };
  try {
    const res = await fetchWithRetry(
      `https://www.ebi.ac.uk/Tools/webservices/psicquic/intact/webservices/current/search/interactor/${key}?format=tab25&maxResults=${MAX_ROWS}`,
      { timeout: 20000, signal }
    );
    // PSICQUIC answers 200 with an empty body for a protein with no interactions.
    if (!res.ok) return { status: "failed", byPartner: new Map() };
    const byPartner = parseIntactMitab(await res.text(), key);
    cache.set(key, byPartner);
    return { status: "ok", byPartner };
  } catch (err: any) {
    if (err?.name === "AbortError") throw err;
    return { status: "failed", byPartner: new Map() };
  }
}
