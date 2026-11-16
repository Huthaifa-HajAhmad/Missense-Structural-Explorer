/**
 * allele-candidates.ts — the candidate alleles of a protein-only input.
 *
 * Some protein changes can come from more than one single-base change at the same codon (FGFR3
 * p.Gly380Arg: codon GGG, so G>A and G>C both give Arg). The person carries one of them and the input
 * does not say which, so no allele is selected: every candidate is placed on GRCh38 and later
 * queried on its own (`server/services/external-api/candidate-frequencies.ts`).
 *
 * Two sources name the candidates:
 *  - ProtVar reads the GRCh38 reference codon on the UniProt canonical isoform. Its ids need no lift.
 *  - MyVariant.info searches dbNSFP by protein notation. Its ids are GRCh37 and are lifted one by one.
 * ProtVar is used first. When both answer with complete lists that name different alleles, neither is
 * trusted and the run is refused. When ProtVar cannot answer, the MyVariant list and its lift stand.
 */
import type { AlleleCandidate, LocusResolutionStep } from "../../../../src/shared/locusResolution.ts";
import { fetchProtVarProteinAlleles } from "../../external-api/protvar-protein.ts";
import { queryLocalDbnsfpByGenomic, readLocalDbnsfpVersion } from "../dbnsfp_local.ts";
import { recoverCanonicalLocus, type DbnsfpGrch38 } from "./locus-resolver.ts";

/** What one MyVariant.info hit says about its allele. */
export interface MyVariantCandidate {
  own: DbnsfpGrch38 | null;
  cadd: number | null;
}

const MYVARIANT_CADD = "myvariant.info dbNSFP (release not stated)";

/**
 * True when every id ("chrom-pos-ref-alt") sits on one chromosome within three bases: the alleles of
 * one codon. Matches further apart are other loci whose isoform numbering coincides, not candidates.
 */
export function withinOneCodon(ids: string[]): boolean {
  const parsed = ids.map(id => id.split("-"));
  const positions = parsed.map(p => Number(p[1]));
  return new Set(parsed.map(p => p[0])).size === 1 && Math.max(...positions) - Math.min(...positions) <= 2;
}

/** "4-1804392-G-A" → "G>A": the part of an id that is the same on GRCh37 and GRCh38. */
const change = (id: string) => id.split("-").slice(2).join(">");

/**
 * Lift each GRCh37 candidate to GRCh38 with the same verified routes a single allele uses.
 * A candidate that cannot be lifted keeps `id: null`, and a step names it in the trail.
 */
export async function liftAlleleCandidates(
  loci: ReadonlyArray<[string, MyVariantCandidate]>,
  steps: LocusResolutionStep[],
): Promise<AlleleCandidate[]> {
  return Promise.all(loci.map(async ([grch37Id, { own, cadd }]) => {
    const recovered = await recoverCanonicalLocus(grch37Id, own);
    const lifted = recovered.assembly === "GRCh38" && recovered.canonicalBy !== null;
    if (!lifted) {
      steps.push({ step: "ensembl-lift", outcome: "failed", detail: `candidate GRCh37 ${grch37Id}: no verified GRCh38 position${recovered.retryable ? " (temporary failure)" : ""}` });
    }
    return {
      grch37Id,
      id: lifted ? recovered.id : null,
      canonicalBy: lifted ? recovered.canonicalBy as AlleleCandidate["canonicalBy"] : null,
      retryable: !lifted && recovered.retryable,
      caddPhred: cadd,
      caddSource: cadd !== null ? MYVARIANT_CADD : null,
    };
  }));
}

export type ProtVarCheck =
  /** ProtVar named two or more alleles and nothing contradicts it. */
  | { kind: "candidates"; candidates: AlleleCandidate[] }
  /** ProtVar and a complete MyVariant list name different alleles. */
  | { kind: "disagree" }
  /** ProtVar gave no usable list (one allele, none, partial, or unreachable): keep the MyVariant outcome. */
  | { kind: "unchanged" };

/**
 * Ask ProtVar for every allele that gives `wt``position``mut` on `accession`, and compare it with a
 * complete MyVariant list (`myvariant`, keyed by GRCh37 id; null when that list was incomplete or
 * missing, so it cannot contradict anything).
 */
export async function candidatesFromProtVar(
  query: { accession: string; position: number; wt: string; mut: string },
  myvariant: ReadonlyMap<string, MyVariantCandidate> | null,
  steps: LocusResolutionStep[],
): Promise<ProtVarCheck> {
  const answer = await fetchProtVarProteinAlleles(query.accession, query.position, query.wt, query.mut)
    .catch((err: unknown) => ({ status: "failed" as const, reason: String((err as Error)?.message ?? err).slice(0, 80) }));
  if (answer.status !== "found") {
    steps.push({ step: "protvar", outcome: "failed", detail: `${answer.reason}; the MyVariant.info outcome stands` });
    return { kind: "unchanged" };
  }
  const protvarChanges = answer.alleles.map(a => change(a.id)).sort().join(",");
  const myvariantIds = myvariant ? [...myvariant.keys()] : [];
  if (myvariantIds.length > 0 &&
      (!withinOneCodon(myvariantIds) || myvariantIds.map(change).sort().join(",") !== protvarChanges)) {
    steps.push({ step: "protvar", outcome: "failed", detail: `ProtVar (${protvarChanges}) and MyVariant.info (${myvariantIds.join(", ")}) disagree on the candidate alleles; neither is trusted` });
    return { kind: "disagree" };
  }
  if (answer.alleles.length < 2) {
    steps.push({ step: "protvar", outcome: "ok", detail: "ProtVar names a single allele; the MyVariant.info outcome stands" });
    return { kind: "unchanged" };
  }
  steps.push({ step: "protvar", outcome: "ok", detail: `${answer.alleles.length} candidate alleles on GRCh38 (${answer.alleles.map(a => a.id).join(", ")}); none selected` });
  return {
    kind: "candidates",
    candidates: answer.alleles.map(a => ({
      grch37Id: myvariantIds.find(id => change(id) === change(a.id)) ?? null,
      id: a.id,
      canonicalBy: "protvar",
      retryable: false,
      caddPhred: a.caddPhred,
      caddSource: a.caddPhred !== null ? "ProtVar" : null,
    })),
  };
}

/**
 * Replace each candidate's CADD with the local dbNSFP store's, when the store holds that exact
 * GRCh38 allele: its release is known, unlike the remote copies. Without the store, nothing changes.
 */
export async function withLocalCadd(candidates: AlleleCandidate[], gene: string): Promise<AlleleCandidate[]> {
  return Promise.all(candidates.map(async candidate => {
    if (!candidate.id) return candidate;
    const [chrom, pos, ref, alt] = candidate.id.split("-");
    const record = await queryLocalDbnsfpByGenomic(chrom, Number(pos), ref, alt, gene).catch(() => null);
    const cadd = record?.cadd;
    return typeof cadd === "number" && Number.isFinite(cadd)
      ? { ...candidate, caddPhred: cadd, caddSource: readLocalDbnsfpVersion() ?? "local dbNSFP (version not recorded)" }
      : candidate;
  }));
}
