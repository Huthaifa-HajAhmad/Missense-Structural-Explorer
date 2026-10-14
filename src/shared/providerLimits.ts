/**
 * providerLimits.ts — who a remote host is, and the sentence a reader sees when it is limiting us.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * A provider that answers 429 is not down: it is telling the team, which shares one server IP, to slow
 * down. The old wording for that case was the same as for an outage ("upstream server currently
 * unavailable"), so a reader was told to give up on a tool that would answer again in seconds. The
 * pause itself lives on the server (`server/services/infra/provider-pause.ts`, WP-I3); the words live
 * here so the server, the client and the tests read the same sentence.
 *
 * Purity is a boundary requirement: `src/shared` may not import from outside itself
 * (`scripts/check-boundaries.ts`, rule 3).
 */

/** Error code carried by every refusal the team-wide pause produces (server and HTTP payloads). */
export const PROVIDER_RATE_LIMITED = "PROVIDER_RATE_LIMITED";

/**
 * Reader-facing names for the remote hosts the server calls, keyed by hostname.
 *
 * One host can serve several tools (UQ BioSig serves DynaMut2 and DDMut), and the pause is per host,
 * because that is what the provider counts. Callers that know the tool pass its name instead.
 */
const HOST_LABELS: Readonly<Record<string, string>> = {
  "biosig.lab.uq.edu.au": "UQ BioSig (DynaMut2, DDMut)",
  "rest.ensembl.org": "Ensembl",
  "grch37.rest.ensembl.org": "Ensembl (GRCh37)",
  "rest.variantvalidator.org": "VariantValidator",
  "eutils.ncbi.nlm.nih.gov": "NCBI",
  "www.ncbi.nlm.nih.gov": "NCBI",
  "gnomad.broadinstitute.org": "gnomAD",
  "rest.uniprot.org": "UniProt",
  "www.ebi.ac.uk": "EMBL-EBI",
  "string-db.org": "STRING",
  "version-12-0.string-db.org": "STRING",
  "gtexportal.org": "GTEx",
  "api.esmatlas.com": "ESM Atlas",
  "alphafold.ebi.ac.uk": "AlphaFold DB",
  "files.rcsb.org": "RCSB PDB",
  "data.rcsb.org": "RCSB PDB",
  "api-inference.huggingface.co": "Hugging Face",
  "router.huggingface.co": "Hugging Face",
  "forge.evolutionaryscale.ai": "Biohub Forge",
  "api.japanfold.aiand.com": "JapanFold",
  "myvariant.info": "MyVariant.info",
  "app.tamarind.bio": "Tamarind Bio",
  "query.genos.us": "Genos",
  "zenodo.org": "Zenodo",
  "gpn.hf.space": "GPN (Hugging Face Space)",
  "www.alliancegenome.org": "Alliance of Genome Resources",
  "rest.genenames.org": "HGNC",
  "api.genome.ucsc.edu": "UCSC Genome Browser",
  "search.clinicalgenome.org": "ClinGen",
  "ontology.jax.org": "HPO (JAX)",
  "www.proteinatlas.org": "Human Protein Atlas",
  "huggingface.co": "Hugging Face",
  "biohub.ai": "Biohub",
};

/**
 * True for a provider this deployment calls on its own account. Anything else reached the server as a
 * request-chosen endpoint (a person's own AlphaGenome or GPN server), and its name is that person's
 * business: public health pages fold it into an anonymous count instead of naming it.
 */
export function isKnownProviderHost(hostname: string): boolean {
  return Object.prototype.hasOwnProperty.call(HOST_LABELS, hostname.toLowerCase());
}

/** The name a reader knows a host by; the bare hostname when it is not in the table. */
export function providerLabelForHost(hostname: string): string {
  // A person's own token at a provider is paused under `<host>#own:<id>` (WP-I4); it is that provider.
  const host = hostname.split("#")[0];
  return HOST_LABELS[host.toLowerCase()] ?? host;
}

/** Whole seconds, never below 1: "retrying in 0 s" reads as a bug. */
export function retryAfterSeconds(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000));
}

/**
 * "DynaMut2 is limiting requests; retrying in 8 s."
 *
 * Never "unavailable" or "down": the provider is answering, and it answers again after the pause.
 */
export function rateLimitedSentence(provider: string, retryAfterSec: number): string {
  const seconds = Math.max(1, Math.ceil(retryAfterSec));
  return `${provider} is limiting requests; retrying in ${seconds} s.`;
}

/** Error code when a call waited for its turn at a provider past its caller's deadline (WP-I1). */
export const EGRESS_WAIT_EXCEEDED = "EGRESS_WAIT_EXCEEDED";

/**
 * "Ensembl is busy with other requests from the team; try again in a moment."
 *
 * The provider is not down and has not refused us: the server held this call back so the team's
 * calls to it stay within what it allows, and the caller's time ran out first.
 */
export function egressBusySentence(provider: string): string {
  return `${provider} is busy with other requests from the team; try again in a moment.`;
}

/**
 * Response header naming the saved answers a response used past their expiry because a provider was
 * limiting requests (WP-I2). The server serves the newest saved copy instead of failing; this header is
 * how the reader learns the data is not fresh. Value: {@link encodeStaleData}.
 */
export const STALE_DATA_HEADER = "X-MSE-Stale";

/**
 * One saved answer served out of date: which data (the cache's label, for example `UniProt FASTA`),
 * the provider behind the hold-up, how old the answer is, and whether that provider refused requests
 * (`busy` false) or the team's calls only waited too long for their turn (`busy` true).
 */
export interface StaleDataNote {
  data: string;
  provider: string;
  ageSec: number;
  busy?: boolean;
}

const MAX_STALE_NOTES = 5;

/** One note per data/provider pair (the oldest age wins), at most five, as JSON. */
export function encodeStaleData(notes: readonly StaleDataNote[]): string {
  const merged = new Map<string, StaleDataNote>();
  for (const n of notes) {
    const key = `${n.data}\u0000${n.provider}\u0000${n.busy ? 1 : 0}`;
    const ageSec = Math.max(0, Math.round(n.ageSec));
    const prev = merged.get(key);
    if (!prev || ageSec > prev.ageSec) {
      merged.set(key, { data: n.data, provider: n.provider, ageSec, ...(n.busy ? { busy: true } : {}) });
    }
  }
  return JSON.stringify([...merged.values()].slice(0, MAX_STALE_NOTES));
}

const isLabel = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 200;

/** The notes in a {@link STALE_DATA_HEADER} value; empty for a missing or malformed value. */
export function parseStaleData(value: string | null | undefined): StaleDataNote[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((n): n is StaleDataNote =>
        Boolean(n) && isLabel(n.data) && isLabel(n.provider) && Number.isFinite(n.ageSec) && n.ageSec >= 0)
      .slice(0, MAX_STALE_NOTES)
      .map(n => ({ data: n.data, provider: n.provider, ageSec: n.ageSec, ...(n.busy === true ? { busy: true } : {}) }));
  } catch {
    return [];
  }
}

/** "under a minute", "12 min", "3 h", "2 d": the largest whole unit. */
export function formatDataAge(ageSec: number): string {
  const s = Math.max(0, Math.round(ageSec));
  if (s < 60) return "under a minute";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86_400)} d`;
}

function holdUp(n: StaleDataNote): string {
  return n.busy ? `${n.provider} is busy with other requests from the team` : `${n.provider} is limiting requests`;
}

/**
 * "Showing UniProt FASTA data saved 3 h ago; UniProt is limiting requests."
 *
 * The data is real and was correct when saved; the sentence says which data it is, how old, and why
 * nothing newer came back, so the reader can decide whether to try again later.
 */
export function staleDataSentence(notes: readonly StaleDataNote[]): string {
  if (notes.length === 0) return "";
  if (notes.length === 1) {
    const [n] = notes;
    return `Showing ${n.data} data saved ${formatDataAge(n.ageSec)} ago; ${holdUp(n)}.`;
  }
  const parts = notes.map(n => `${n.data} (${formatDataAge(n.ageSec)} old)`);
  const holdUps = [...new Set(notes.map(holdUp))];
  return `Showing saved data: ${parts.join(", ")}; ${holdUps.join("; ")}.`;
}
