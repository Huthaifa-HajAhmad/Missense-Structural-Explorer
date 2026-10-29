import { z } from 'zod';
import { LRUCache } from 'lru-cache';
import { CSPEC_SOURCE_URL, cspecPm1Schema, type CspecCriterion, type CspecPm1, type CspecSpec } from '../../../src/shared/cspecPm1.ts';
import { fetchWithRetry } from "../infra/http-client.ts";

/**
 * The CSpec list names every specification and the genes each one covers in a single document, and each
 * specification's rule set holds its criteria. The list is cached once and each rule set by its IRI, for
 * a day. Genes are matched by EXACT symbol (upper-cased), never by name similarity.
 *
 * The rule set keeps its criteria in a top-level `criteriaCodes` array, so PM1 is read from that one
 * place and the document is not walked. Checked on all 214 rule sets on 2026-10-28: PM1 appears in
 * exactly the 126 that have criteria, and nowhere else.
 */
const listSchema = z.object({
  data: z.array(z.object({
    // The registry IRI ends in the GN number, which is the specification's identifier.
    '@id': z.string().regex(/\/GN\d+$/).transform(iri => iri.slice(iri.lastIndexOf('/') + 1)),
    affiliation: z.object({ label: z.string().trim() }),
    ruleSets: z.array(z.object({
      '@id': z.string(),
      genes: z.array(z.object({ label: z.string(), diseases: z.array(z.object({ label: z.string() })).default([]) })).default([]),
    })),
    status: z.string(), version: z.string().nullable(), url: z.string().url(),
  })).min(1), // An empty registry is an incomplete answer, not a "none".
});
const ruleSetSchema = z.object({
  criteriaCodes: z.array(z.object({
    label: z.string(), description: z.string(),
    evidenceStrengths: z.array(z.object({
      label: z.string(), applicability: z.string(), description: z.string().nullish().transform(text => text ?? null),
    })),
  })).default([]),
});
type RuleSet = z.infer<typeof ruleSetSchema>;
type Registry = { specs: z.infer<typeof listSchema>['data']; retrievedAt: string };

const registryCache = new LRUCache<string, Registry>({ max: 1, ttl: 24 * 60 * 60 * 1000 });
// The registry holds about 214 rule sets; this bound leaves room for it to grow.
const ruleSetCache = new LRUCache<string, RuleSet>({ max: 512, ttl: 24 * 60 * 60 * 1000 });
let registryFlight: Promise<Registry> | null = null;
const ruleSetFlights = new Map<string, Promise<RuleSet>>();

class CspecHttpError extends Error {
  constructor(public status: number) { super(`CSpec HTTP ${status}`); }
}

/** The registry's own scheme and host. A rule set is fetched only on the same origin: a skewed or
 * poisoned registry entry (`ruleSets[].@id` is data, not code) must not make this server read an
 * arbitrary address (SSRF) — a misdirected rule set is a failed read, not a fetch. */
const REGISTRY_ORIGIN = new URL(CSPEC_SOURCE_URL).origin;
class CspecOriginError extends Error {
  constructor(iri: string) {
    super(`The registry named a rule set outside its own origin (${iri.slice(0, 200)})`);
    this.name = "CspecOriginError";
  }
}

/** Why a CSpec read failed, phrased to follow "CSpec ". Never includes a response body or a parser detail. */
function failureCause(error: unknown): string {
  if (error instanceof z.ZodError || error instanceof SyntaxError) return 'returned an unexpected response';
  if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) return 'request timed out';
  if (error instanceof CspecOriginError) return 'server refused to read: the registry named a rule set outside its own origin';
  const status = error instanceof CspecHttpError ? error.status : (error as { statusCode?: number } | null)?.statusCode;
  if (status && status >= 400) return `request failed (HTTP ${status})`;
  return 'could not be reached';
}

async function getJson(url: string): Promise<unknown> {
  // At most two attempts within one 30s budget, below the client's 40s deadline. The shared client
  // honours rate limits and refusals; a body that does not parse is never retried here.
  const response = await fetchWithRetry(url, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30000),
    timeout: 12000, deadlineAt: Date.now() + 30000,
  }, 2, 500);
  if (!response.ok) throw new CspecHttpError(response.status);
  return JSON.parse(await response.text());
}

async function loadRegistry(): Promise<Registry> {
  const hit = registryCache.get('registry'); if (hit) return hit;
  registryFlight ??= (async () => {
    const value = { specs: listSchema.parse(await getJson(CSPEC_SOURCE_URL)).data, retrievedAt: new Date().toISOString() };
    registryCache.set('registry', value); return value;
  })().finally(() => { registryFlight = null; });
  return registryFlight;
}

async function loadRuleSet(iri: string): Promise<RuleSet> {
  // Origin allowlist before any network use: the IRI arrives as registry data, never code.
  const target = new URL(iri, CSPEC_SOURCE_URL);
  if (target.origin !== REGISTRY_ORIGIN) throw new CspecOriginError(iri);
  const hit = ruleSetCache.get(iri); if (hit) return hit;
  let flight = ruleSetFlights.get(iri);
  if (!flight) {
    // A failed read is not cached, so the next request for this specification tries again.
    flight = (async () => {
      const value = ruleSetSchema.parse(await getJson(`${target.toString()}?detail=high`));
      ruleSetCache.set(iri, value); return value;
    })().finally(() => { ruleSetFlights.delete(iri); });
    ruleSetFlights.set(iri, flight);
  }
  return flight;
}

/** The applicability text is kept verbatim; `applicable` reads only that it begins with "Applicable". */
function criterionOf(ruleSet: RuleSet): CspecCriterion | null {
  const code = ruleSet.criteriaCodes.find(candidate => candidate.label === 'PM1');
  if (!code) return null;
  return {
    description: code.description,
    strengths: code.evidenceStrengths.map(strength => ({
      label: strength.label, applicable: /^applicable/i.test(strength.applicability),
      applicability: strength.applicability, description: strength.description,
    })),
  };
}

export async function loadCspecPm1(gene: string): Promise<CspecPm1> {
  const symbol = gene.toUpperCase();
  try {
    const registry = await loadRegistry();
    const covering = registry.specs.flatMap(spec => spec.ruleSets.flatMap(ruleSet => {
      const entry = ruleSet.genes.find(candidate => candidate.label.toUpperCase() === symbol);
      return entry ? [{ spec, ruleSetIri: ruleSet['@id'], diseases: entry.diseases.map(disease => disease.label) }] : [];
    }));
    // Settled, not all-or-nothing: one unreadable rule set must not hide the specifications around it.
    const reads = await Promise.allSettled(covering.map(match => loadRuleSet(match.ruleSetIri)));
    const specs: CspecSpec[] = covering.map(({ spec, diseases }, index) => {
      const read = reads[index];
      const base = {
        id: spec['@id'], url: spec.url, panel: spec.affiliation.label, status: spec.status,
        released: spec.status === 'Released', version: spec.version, diseases,
      };
      if (read.status === 'rejected') {
        return { ...base, pm1: null, pm1Reason: `CSpec ${failureCause(read.reason)}. The PM1 text for ${spec['@id']} could not be read.` };
      }
      return { ...base, pm1: criterionOf(read.value), pm1Reason: null };
    });
    return cspecPm1Schema.parse({
      status: specs.length ? 'ok' : 'none',
      reason: specs.length ? null : `No ClinGen VCEP specification in CSpec lists ${symbol}.`,
      sourceUrl: CSPEC_SOURCE_URL, retrievedAt: registry.retrievedAt, specs,
    });
  } catch (error) {
    return {
      status: 'error', reason: `CSpec ${failureCause(error)}. Specifications for ${symbol} could not be checked, so this is not a negative result.`,
      sourceUrl: CSPEC_SOURCE_URL, retrievedAt: null, specs: [],
    };
  }
}
