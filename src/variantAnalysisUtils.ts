
import { AMINO_ACID_3_TO_1, AMINO_ACID_1_TO_3 } from "./aminoAcids";
import { residueScalePositions } from "./shared/residueScales";
import { z } from "zod";
import { parseVariantCoordinate, type VariantCoordinate } from "./shared/variantCoordinate.ts";
import { isGenomicOrCdnaNotation } from "./shared/variantNotation.ts";

import {
  finiteNumber,
  nullableFiniteNumber,
  analyzeVariantResponseSchema,
  generateMutantResponseSchema,
  nearestResiduesResponseSchema,
  pocketFinderResponseSchema,
  resolveGeneResponseSchema,
  translateVariantResponseSchema,
  type EnergeticsData
} from "./shared/contracts.ts";

export {
  finiteNumber,
  nullableFiniteNumber,
  analyzeVariantResponseSchema,
  generateMutantResponseSchema,
  nearestResiduesResponseSchema,
  pocketFinderResponseSchema,
  resolveGeneResponseSchema,
  translateVariantResponseSchema
};

/**
 * In-flight request deduplication (F-A2).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY EACH ENTRY CARRIES ITS SIGNAL (read before changing the key)
 * ─────────────────────────────────────────────────────────────────────────────
 * The key alone is not enough to identify a request. `useAnalysisPipeline.executeAnalysis` aborts
 * the previous run and then synchronously starts the next one, so for any repeated query — the same
 * preset clicked twice, Search pressed again on the same notation, a history row re-opened — the
 * aborted run's entry is still in this table when the new run asks for it. The new run was handed
 * the OLD promise, which the abort had already doomed, and so it failed instantly with
 * "Biophysical analysis stream aborted by client." while its own signal was alive and healthy.
 * Verified by driving the real function twice in a row: run 2 issued ZERO requests.
 *
 * A promise created under an aborted signal is therefore not reusable, and the entry is evicted
 * eagerly on the `abort` event — which is the mechanism that makes the race unwinnable rather than
 * merely unlikely — plus defensively on lookup, for the case where the entry was created before its
 * owner's signal aborted and the listener has not run yet.
 *
 * An entry created WITHOUT a signal is not evictable by this mechanism, and the lookup treats it as
 * reusable (nothing is known to be wrong with it). Callers that can abort should therefore pass
 * their signal; `useInterfacesData` (Interfaces & PPI) shares a key with the pipeline and does exactly that.
 */
interface InFlightRequest {
  promise: Promise<any>;
  /** The signal the request was created under, when the caller supplied one. */
  signal?: AbortSignal;
}

const inFlightRequests = new Map<string, InFlightRequest>();

export function getDeduplicatedPromise<T>(
  key: string,
  promiseCreator: () => Promise<T>,
  /**
   * The run this request belongs to.
   *
   * Optional so existing two-argument callers keep working, but every pipeline call site passes it:
   * without it, a re-query can still inherit the aborted request it replaced.
   */
  signal?: AbortSignal
): Promise<T> {
  const existing = inFlightRequests.get(key);
  if (existing) {
    const ownerIsGone = Boolean(existing.signal?.aborted);
    if (!ownerIsGone) {
      return existing.promise;
    }
    inFlightRequests.delete(key);
  }

  let promise: Promise<T>;
  promise = promiseCreator().finally(() => {
    // Identity-checked: a replacement request may already own this key, and its entry must not be
    // deleted by the settlement of the request it replaced.
    if (inFlightRequests.get(key)?.promise === promise) {
      inFlightRequests.delete(key);
    }
  });

  const entry: InFlightRequest = { promise, signal };
  inFlightRequests.set(key, entry);

  if (signal) {
    const evictOnAbort = () => {
      if (inFlightRequests.get(key) === entry) {
        inFlightRequests.delete(key);
      }
    };
    signal.addEventListener("abort", evictOnAbort, { once: true });
    // The listener outlives the request otherwise, and a long-lived parent signal (the analysis run
    // aborts once, at the end of the whole pipeline) would accumulate one listener per request.
    const detach = () => signal.removeEventListener("abort", evictOnAbort);
    promise.then(detach, detach);
  }

  return promise;
}

export function buildEnergeticsQueryString(energetics: EnergeticsData | null): string {
  if (!energetics) return "";
  const q = new URLSearchParams();
  const foldxVal = energetics.foldxMean ?? energetics.foldx;
  if (foldxVal !== null && foldxVal !== undefined) q.set("foldx", foldxVal.toString());
  if (energetics.rasp !== null && energetics.rasp !== undefined) q.set("rasp", energetics.rasp.toString());
  if (energetics.ddmut !== null && energetics.ddmut !== undefined) q.set("ddmut", energetics.ddmut.toString());
  if (energetics.dynamut2 !== null && energetics.dynamut2 !== undefined) q.set("dynamut2", energetics.dynamut2.toString());
  if (energetics.thermompnn !== null && energetics.thermompnn !== undefined) q.set("thermompnn", energetics.thermompnn.toString());
  if (energetics.foldxRepairFailed) q.set("foldxRepairFailed", "true");
  return q.toString();
}


export function getErrorMessage(data: any, defaultMsg = "Request failed"): string {
  if (!data) return defaultMsg;
  if (typeof data.error === "string") return data.error;
  if (data.error && typeof data.error.message === "string") return data.error.message;
  if (typeof data === "string") return data;
  return defaultMsg;
}

// Local storage key for non-sensitive public variant history cache (non-PHI)
export const STORAGE_KEY = "variantHistory";

// Coordinate pattern checkers for VCF and cDNA (F-3)
//
// The grammar itself lives in src/shared/variantNotation.ts. This thin delegate is kept
// so existing imports keep resolving.
export function isVcfOrCdnaNotation(input: string): boolean {
  return isGenomicOrCdnaNotation(input);
}

export const AMINO_ACID_NAMES_MAP: Record<string, string> = {
  A: "Alanine [Ala]",
  R: "Arginine [Arg]",
  N: "Asparagine [Asn]",
  D: "Aspartate [Asp]",
  C: "Cysteine [Cys]",
  Q: "Glutamine [Gln]",
  E: "Glutamate [Glu]",
  G: "Glycine [Gly]",
  H: "Histidine [His]",
  I: "Isoleucine [Ile]",
  L: "Leucine [Leu]",
  K: "Lysine [Lys]",
  M: "Methionine [Met]",
  F: "Phenylalanine [Phe]",
  P: "Proline [Pro]",
  S: "Serine [Ser]",
  T: "Threonine [Thr]",
  W: "Tryptophan [Trp]",
  Y: "Tyrosine [Tyr]",
  V: "Valine [Val]"
};

/**
 * Amino-acid property positions on a 0–100 scale, derived from published values.
 *
 * This used to be a hand-made table labelled with sources it did not follow (see
 * `src/shared/residueScales.ts`). It is now computed from those sources, so every consumer that
 * still reads it gets the published positions.
 */
export const AMINO_ACID_PROPERTIES: Record<string, { hydrophobicity: number; charge: number; size: number; polarity: number }> =
  Object.fromEntries(
    "ARNDCQEGHILKMFPSTWYV".split("").map(code => [code, residueScalePositions(code)!])
  );

export function parseMutationResidues(variantStr: string): { wt: string; mut: string } {
  const coord = parseVariantCoordinate(variantStr);
  return { wt: coord.wt1, mut: coord.mut1 };
}

export const getAlternativeVariants = (currentGene: string): string[] => {
  const normalized = currentGene.toUpperCase();
  if (normalized === "PAH") {
    return ["p.Arg408Trp", "p.Arg261Gln", "p.Ala259Thr", "p.Gly272Cys"];
  }
  if (normalized === "FGFR3") {
    return ["p.Gly380Arg", "p.Ala391Glu", "p.Lys650Glu", "p.Asn540Lys"];
  }
  if (normalized === "GBA1" || normalized === "GBA") {
    return ["p.Leu483Pro", "p.Asn409Ser", "p.Asp448His", "p.Glu365Lys"];
  }
  if (normalized === "KIF1A") {
    return ["p.Arg254Trp", "p.Val8Met", "p.Ala255Val", "p.Thr99Met"];
  }
  return ["p.Ala40Val", "p.Leu100Pro", "p.Glu150Lys"];
};

export function mapMutationToFoldXFormat(variantStr: string): string {
  const coord = parseVariantCoordinate(variantStr);
  return coord.foldxCode;
}


