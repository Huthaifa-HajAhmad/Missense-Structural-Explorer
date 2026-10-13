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
  return HOST_LABELS[hostname.toLowerCase()] ?? hostname;
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
